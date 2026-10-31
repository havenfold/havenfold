// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// box.js — kutunun kör emaneti (RFC-0001 §12.2)
//
// Kutu okuyucu değildir: yazarı, saati ve içeriği göremez; yalnız koleksiyon kimliğini, dönemi ve boyutu görür.
// Bir işlemi yalnız o koleksiyonun okuyucusu olan bir üyenin ya da writers listesinde device: olarak yer alan bir
// cihazın oturumundan kabul eder. Kendiliğinden silmez: yalnız koleksiyonun yazarı olan üyenin imzalı REC_PRUNE'u ile
// (RFC-0019 §11.1 e) ya da koleksiyonun 30 gündür hiç okuyucusu yoksa.
//
// Kopyalar (RFC-0019 §11.1 n): opId imzayı kapsamaz ve kutu imzayı yazarın anahtarıyla doğrulayamaz. Bu yüzden aynı
// opId için imzası (dolayısıyla baytları) farklı en çok 4 kopya tutulur ve hepsi sunulur; tekrar denetimi opId ‖ sig
// iledir. Bir gönderen bir opId için tek kopya tutar; yenisi eskisinin yerine geçer.
// Budama (§11.1 r): kutu gerekçeyi denetleyemez; her budamayı (kim, ne zaman, kaç işlem) saklar ve ebeveyne gösterir.
// Mezar kalıcı değildir: budanmış opId'yi, imzası gönderenin anahtarıyla doğrulanan (yazarın kendisi) yeniden yüklerse
// kabul edilir.
const b4a = require('b4a')
const sodium = require('sodium-native')
const { Yetki } = require('./permission')
const { peekOp, sigDigest } = require('./operation')
const { decodeRecDrop, MAX_OP_BYTES } = require('./encoding')
const { dropOpIdOf, dropSigDigest } = require('./replica')
const E = require('./sync')

const hex = (b) => b4a.toString(b, 'hex')
const SENDER_QUOTA = 256 * 1024 * 1024
const NO_READER_MS = 30 * 86_400_000
const MAX_KOPYA = 4

// Kutudaki bir opId: bütün kopyaları; bytes ilk kopyadır (eşitleme özetleri opId ile çalışır)
class Girdi {
  constructor (kind, opId) { this.kind = kind; this.opId = opId; this.kopyalar = [] }
  get bytes () { return this.kopyalar[0].bytes }
}

class Kutu {
  constructor ({ ledger, now = Date.now, quota = SENDER_QUOTA, capacity = Infinity }) {
    this.ledger = ledger
    this.now = now
    this.quota = quota
    this.capacity = capacity
    this.used = 0
    this.yetki = new Yetki()
    this.cols = new Map() // cid → { ops: Map<opIdHex, Girdi>, tomb: Set, usage: Map<sender, bytes>, noReaderSince, budamalar }
    this.events = [] // durum mesajları (ör. hf.kayit.kutu-dolu)
  }

  _col (cid) {
    let c = this.cols.get(cid)
    if (!c) { c = { ops: new Map(), tomb: new Set(), usage: new Map(), noReaderSince: null, budamalar: [] }; this.cols.set(cid, c) }
    return c
  }

  // Oturumu açanın kimliği HELLO'dan gelir (senderHex). Dönüş: { ok, code }
  accept (senderHex, kind, bytes) {
    if (kind !== 0 && kind !== 1) return { ok: false, code: 'INVALID_MESSAGE' }
    this.yetki.update(this.ledger)
    let opId, cid, sig, digest
    try {
      if (bytes.byteLength > MAX_OP_BYTES) throw new Error('OPERATION_TOO_LARGE')
      if (kind === 0) {
        const p = peekOp(bytes)
        opId = p.opId
        cid = hex(p.wire.collectionId)
        sig = p.wire.sig
        digest = () => sigDigest(this.ledger.familyId, opId)
      } else {
        const w = decodeRecDrop(bytes)
        opId = dropOpIdOf(w)
        cid = hex(w.collectionId)
        sig = w.sig
        digest = () => dropSigDigest(this.ledger.familyId, opId)
      }
    } catch (err) { return { ok: false, code: err.message } }
    const L = this.ledger
    const seq = L.len - 1
    const reader = L.members.has(senderHex) && L.members.get(senderHex).role !== 'kutu' && this.yetki.isReader(cid, senderHex, seq)
    const deviceWriter = kind === 1 && L.devices.get(senderHex)?.active && this.yetki.isWriter(cid, senderHex, seq)
    if (!reader && !deviceWriter) return { ok: false, code: 'UNAUTHORIZED' }
    const c = this._col(cid)
    const k = hex(opId)
    let mezardan = false
    if (c.tomb.has(k)) {
      // Yazarın kendisi yeniden yüklüyorsa (imza gönderenin anahtarıyla doğrulanır) mezar kalkar
      const pub = L.entity(senderHex)?.signPub
      if (!pub || !sodium.crypto_sign_verify_detached(sig, digest(), pub)) return { ok: false, code: 'TOMBSTONED' }
      mezardan = true
    }
    const g = c.ops.get(k)
    if (g && g.kopyalar.some((x) => b4a.equals(x.sig, sig))) return { ok: true, code: 'REPLAY' }
    const eski = g ? g.kopyalar.find((x) => x.from === senderHex) : null
    if (g && !eski && g.kopyalar.length >= MAX_KOPYA) return { ok: false, code: 'COPY_LIMIT' }
    const used = (c.usage.get(senderHex) || 0) - (eski ? eski.bytes.byteLength : 0)
    const toplam = this.used - (eski ? eski.bytes.byteLength : 0)
    if (used + bytes.byteLength > this.quota || toplam + bytes.byteLength > this.capacity) {
      this.events.push({ type: 'hf.kayit.kutu-dolu', cid })
      return { ok: false, code: 'BOX_FULL' }
    }
    if (mezardan) c.tomb.delete(k)
    c.usage.set(senderHex, used + bytes.byteLength)
    this.used = toplam + bytes.byteLength
    const kopya = { bytes: b4a.from(bytes), sig: b4a.from(sig), from: senderHex }
    if (eski) g.kopyalar[g.kopyalar.indexOf(eski)] = kopya
    else if (g) g.kopyalar.push(kopya)
    else {
      const yeni = new Girdi(kind, opId)
      yeni.kopyalar.push(kopya)
      c.ops.set(k, yeni)
    }
    return { ok: true, code: null }
  }

  // REC_PRUNE: by, o koleksiyonun yazarı olan üye (okuyucu olmak yetmez)
  prune (bytes) {
    this.yetki.update(this.ledger)
    let m
    try { m = E.decodePrune(bytes) } catch (err) { return { ok: false, code: err.message } }
    const cid = hex(m.collectionId)
    const by = hex(m.by)
    const L = this.ledger
    if (!L.members.has(by) || L.sessionRole(by) !== 'uye' || !this.yetki.isWriter(cid, by, L.len - 1)) return { ok: false, code: 'UNAUTHORIZED' }
    if (!E.verifyPrune(L.familyId, m, L.members.get(by).signPub)) return { ok: false, code: 'INVALID_SIGNATURE' }
    const c = this._col(cid)
    let n = 0
    for (const id of m.opIds) {
      const k = hex(id)
      const it = c.ops.get(k)
      if (it) {
        c.ops.delete(k)
        n++
        for (const x of it.kopyalar) {
          this.used -= x.bytes.byteLength
          c.usage.set(x.from, (c.usage.get(x.from) || 0) - x.bytes.byteLength)
        }
      }
      c.tomb.add(k)
    }
    c.budamalar.push({ by, at: this.now(), istenen: m.opIds.length, silinen: n })
    return { ok: true, code: null }
  }

  // Budama kaydı (RFC-0019 §11.1 r): yalnız ebeveyne gösterilir
  budamalar (cid, isteyenHex) {
    if (!this.ledger.authorityIds().includes(isteyenHex)) throw new Error('UNAUTHORIZED') // ailede ebeveyn, ekipte yönetim
    return (this.cols.get(cid)?.budamalar || []).map((x) => ({ ...x }))
  }

  // Okuyucusu kalmayan koleksiyon 30 gün sonra silinir; kural defterdeki okuyucu listesine bağlıdır
  gc () {
    this.yetki.update(this.ledger)
    const seq = this.ledger.len - 1
    for (const [cid, c] of this.cols) {
      if (this.yetki.readersAt(cid, seq).length > 0) { c.noReaderSince = null; continue }
      if (c.noReaderSince === null) c.noReaderSince = this.now()
      if (this.now() - c.noReaderSince >= NO_READER_MS) {
        for (const it of c.ops.values()) for (const x of it.kopyalar) this.used -= x.bytes.byteLength
        this.cols.delete(cid)
      }
    }
  }

  set (cid) { return this.cols.get(cid)?.ops || new Map() }
  bucketsMsg (cid) { return E.bucketsMsg(cid, this.set(cid)) }
  onBuckets (cid, bytes) { return E.onBuckets(cid, this.set(cid), bytes) }
  onBucketIds (cid, bytes) { return E.onBucketIds(cid, this.set(cid), bytes) }
}

module.exports = { Kutu, SENDER_QUOTA, NO_READER_MS, MAX_KOPYA }
