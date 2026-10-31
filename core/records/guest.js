// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// guest.js — misafirin kayıt kuralları (RFC-0001 §15)
//
// Misafirin tam defteri yoktur; kabul ettiği GUEST_VIEW'e göre çalışır (RFC-0003 §7):
//   - İşlem: yazarı, peers içinde writerOf listesinde o koleksiyon bulunan bir üye olmalı.
//   - Anahtar: yalnız peers içindeki bir ebeveynin imzaladığı keyEntry; dönemler görünümdeki epochs listesinden.
//   - Kesim uygulamaz. Yazar görünümden çıkınca o yazarın yeni işlemleri kabul edilmez.
// Misafir okuduğu koleksiyonlara işlem yazmaz. GRANT_WRITE izni olan koleksiyona yalnız mühürlü olay bırakır
// (birakmaHazirla; RFC-0030 §4, §6): o koleksiyonu okuyamaz, bıraktığını kendi telefonunda ayrıca tutar.
const b4a = require('b4a')
const { reduceAll, view } = require('./merge')
const { sinifaUyar } = require('./class')
const I = require('./operation')
const A = require('./key')
const MAX_KOPYA = 4

const hex = (b) => b4a.toString(b, 'hex')
const unhex = (s) => b4a.from(s, 'hex')

class MisafirReplika {
  // gv: core guestView.acceptGuestView sonucu
  constructor (gv) {
    this.keys = new A.KeyStore()
    this.ops = new Map()
    this.tomb = new Set()
    this.setView(gv)
  }

  setView (gv) {
    this.view = gv
    this.familyId = gv.familyId
    this.epochs = new Map(gv.epochs.map((e) => [hex(e.collectionId) + '|' + e.epochSeq, e]))
    for (const o of [...this.ops.values()]) if (o.status === 'bekliyor') this._evaluate(o)
  }

  receiveKey (bytes) {
    let m
    try { m = A.decodeRecKey(bytes) } catch (err) { return { status: 'reddedildi', code: err.message } }
    const cid = hex(m.collectionId)
    const e = this.epochs.get(cid + '|' + m.epochSeq)
    if (!e || !b4a.equals(e.epochHash, m.epochHash)) return { status: 'reddedildi', code: 'EPOCH_MISMATCH' }
    // Görünümde dönemin okuyucu listesi yok: imzacı görünümdeki bir ebeveyn olmalı (misafirli koleksiyonda anahtarı
    // zaten yalnız ebeveyn üretir, RFC-0001 §9.2)
    const parents = new Map([...this.view.peers].filter(([, p]) => ['ebeveyn', 'sahip', 'yonetici'].includes(p.role)).map(([id, p]) => [id, p.role]))
    const ep = { seq: m.epochSeq, hash: m.epochHash, readers: parents }
    let bad = null
    for (const entry of m.keys) {
      try {
        A.verifyKeyEntry({ familyId: this.familyId, collectionId: m.collectionId, epoch: ep, entry, signPubOf: (id) => this.view.peers.get(id)?.signPub })
        this.keys.add(cid, ep, entry, parents.get(hex(entry.issuerId)))
      } catch (err) { bad = err.message }
    }
    for (const o of [...this.ops.values()]) if (o.cid === cid && o.code === 'NO_KEY') this._evaluate(o)
    return bad ? { status: 'reddedildi', code: bad } : { status: 'tamam', code: null }
  }

  receiveOp (bytes, kind = 0) {
    if (kind !== 0) return { status: 'reddedildi', code: 'INVALID_OPERATION_TYPE' } // misafire bırakma işlemi gitmez
    let p
    try { p = I.peekOp(bytes) } catch (err) { return { status: 'reddedildi', code: err.message } }
    const k = hex(p.opId)
    if (this.tomb.has(k)) return { status: 'reddedildi', code: 'TOMBSTONED' }
    const var_ = this.ops.get(k)
    if (var_) {
      // İmzası doğrulanmamış girdi opId'yi kilitlemez (RFC-0019 §11.1 n)
      const alt = var_.alternatifler || (var_.alternatifler = [])
      if (!var_.sigOk && !b4a.equals(var_.bytes, bytes) && !alt.some((x) => b4a.equals(x.bytes, bytes)) && alt.length + 1 < MAX_KOPYA) {
        alt.push({ bytes: b4a.from(bytes), wire: p.wire })
        return { status: var_.status, code: 'DUPLICATE' }
      }
      return { status: var_.status, code: 'REPLAY' }
    }
    const o = { bytes: b4a.from(bytes), wire: p.wire, opId: p.opId, cid: hex(p.wire.collectionId) }
    this.ops.set(k, o)
    this._evaluate(o)
    return { status: o.status, code: o.code }
  }

  _evaluate (o) {
    const set = (status, code) => {
      o.status = status
      o.code = code
      // Misafirin retleri mezara girmez (RFC-0019 §11.1 o): çözme ve imza hataları kesin ret değildir
      if (status === 'reddedildi') this.ops.delete(hex(o.opId))
    }
    // Görünümde (henüz) olmayan koleksiyonun işlemi bekler; sonraki görünümde gelebilir (inceleme kayıt 19)
    if (!this.view.collections.has(o.cid)) return set(MisafirReplika.prototype._koleksiyonYoksa, 'NO_COLLECTION')
    if (!o.inner) {
      const ep = this.view.epochs.find((e) => hex(e.collectionId) === o.cid && e.epochSeq === o.wire.epochSeq)
      const key = ep && this.keys.get(o.cid, o.wire.epochSeq, ep.epochHash, o.wire.keyId)
      if (!key) return set('bekliyor', 'NO_KEY')
      try { o.inner = I.openOp(o.wire, this.familyId, key) } catch (err) { return set(err.message === 'VERSION_UNSUPPORTED' ? 'bekliyor' : 'reddedildi', err.message) }
    }
    const author = hex(o.inner.authorId)
    const p = this.view.peers.get(author)
    // Yazar görünümde değilse: önceden kabul edilmemiş işlem bekler (yazar görünümden çıkarıldıysa hiç gelmez)
    if (!p || !p.writerOf.some((c) => hex(c) === o.cid)) return set('bekliyor', 'AUTHOR_NOT_IN_VIEW')
    // İmza hatası mezara girmez (RFC-0019 §11.1 b): işlem atılır, geçerli kopyası sonra gelebilir
    if (!o.sigOk) {
      while (!I.verifyOpSig(this.familyId, o.opId, o.wire.sig, p.signPub)) {
        const alt = o.alternatifler && o.alternatifler.shift()
        if (!alt) return set('reddedildi', 'INVALID_SIGNATURE')
        o.bytes = alt.bytes
        o.wire = alt.wire
      }
      o.sigOk = true
      o.alternatifler = null
    }
    set('gecerli', null)
  }

  records (cid) {
    cid = typeof cid === 'string' ? cid : hex(cid)
    const valid = [...this.ops.values()].filter((o) => o.cid === cid && o.status === 'gecerli')
    const out = []
    // Yazar sınıfı (RFC-0019 §11.1 l): misafir rol geçmişini bilmez; görünümdeki rol kullanılır
    const rol = (o) => this.view.peers.get(hex(o.inner.authorId))?.role || null
    for (const [rid, st] of reduceAll(valid, (o, type, st) => sinifaUyar(type, rol(o), o, st))) {
      const v = view(unhex(rid), st)
      if (v) out.push(v)
    }
    return out.sort((a, b) => (a.recordId < b.recordId ? -1 : 1))
  }

  put () { throw new Error('GUEST_CANNOT_WRITE') }
  del () { throw new Error('GUEST_CANNOT_WRITE') }
}

// Üye tarafı (Replika): misafirin görünümüne girecek dönemler ve misafire gönderilecekler.
// Misafir koleksiyonlarının, misafirin okuyucu olduğu dönemleri (history: true ise hepsi).
function guestEpochs (r, grantHex) {
  const g = r.ledger.grants.get(grantHex)
  if (!g) return []
  const out = []
  for (const cid of g.collections) {
    const col = r.ledger.collections.get(cid)
    for (const ep of r.yetki.epochs(cid)) {
      if (col.history || ep.readers.has(grantHex)) out.push({ collectionId: unhex(cid), epochSeq: ep.seq, epochHash: ep.hash })
    }
  }
  return out
}

// Üyeler misafire yalnız kendi geçerli kümelerindeki işlemleri gönderir; hariç ya da bekleyenleri göndermez
function opsForGuest (r, grantHex) {
  const g = r.ledger.grants.get(grantHex)
  if (!g || !g.active) return []
  const epochs = new Set(guestEpochs(r, grantHex).map((e) => hex(e.collectionId) + '|' + e.epochSeq))
  return [...r.ops.values()]
    .filter((o) => g.collections.includes(o.cid) && o.status === 'gecerli' && o.kind === 0 && epochs.has(o.cid + '|' + o.wire.epochSeq))
    .map((o) => ({ kind: 0, bytes: o.bytes }))
}

// Misafire gidecek anahtarlar: yalnız ebeveyn üretimleri, görünümdeki dönemler
function keysForGuest (r, grantHex) {
  const out = []
  for (const e of guestEpochs(r, grantHex)) {
    const cid = hex(e.collectionId)
    const entries = r.keys.entries(cid, e.epochSeq, e.epochHash).filter((x) => r.ledger.authorityIds().includes(hex(x.issuerId)))
    if (entries.length) out.push(A.encodeRecKey({ collectionId: e.collectionId, epochSeq: e.epochSeq, epochHash: e.epochHash, keys: entries, dropSecrets: [] }))
  }
  return out
}

// Misafir tarafı (RFC-0030 §4, §6): görünümdeki izinle REC_DROP. Ailenin telefonları aynı koşulları denetler; burada
// önceden bakılır ki atılacak bir olay hiç gönderilmesin. gv: acceptGuestView sonucu. fields: [{ name, value }], _subj
// içinde. Dönüş: { bytes, opId, recordId, inner }
function birakmaHazirla ({ gv, signer, collectionId, type, fields, hlc }) {
  const { sealDrop, appendRecordId, dropOpIdOf, MAX_MISAFIR_BIRAKMA, ekli } = require('./replica')
  const { decodeRecDrop, OP } = require('./encoding')
  const cid = typeof collectionId === 'string' ? collectionId : hex(collectionId)
  // Bir koleksiyonda birden çok satır olabilir (GRANT_WRITE ve örtük SOS izni, RFC-0031 §4.1); tür ve özne aynı satırdan
  const satirlar = gv.drops.filter((d) => d.collectionId === cid)
  if (!satirlar.length) throw new Error('NOT_PERMITTED')
  const turlu = satirlar.filter((d) => d.types.includes(type))
  if (!turlu.length) throw new Error('TYPE_NOT_ALLOWED')
  const subj = fields.find((f) => f.name === '_subj')?.value
  const izin = turlu.find((d) => d.subjects.includes(subj))
  if (!izin) throw new Error('SUBJECT_NOT_ALLOWED')
  if (fields.some((f) => ekli(f.value))) throw new Error('EXTRA_FORBIDDEN')
  const inner = {
    recordId: appendRecordId(signer.memberId, hlc), op: OP.APPEND, type, fields, hlc, authorId: signer.memberId,
    ledgerSeq: gv.ledgerLen - 1, ledgerHash: gv.ledgerHead
  }
  const bytes = sealDrop({ familyId: gv.familyId, collectionId: unhex(cid), dropKey: izin.dropKey, inner, signer })
  const w = decodeRecDrop(bytes)
  if (w.sealed.byteLength - require('sodium-native').crypto_box_SEALBYTES > MAX_MISAFIR_BIRAKMA) throw new Error('DROP_TOO_LARGE')
  return { bytes, opId: dropOpIdOf(w), recordId: inner.recordId, inner }
}

MisafirReplika.prototype._koleksiyonYoksa = 'bekliyor'

module.exports = { MisafirReplika, guestEpochs, opsForGuest, keysForGuest, birakmaHazirla }
