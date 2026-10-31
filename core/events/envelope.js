// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// envelope.js — uyandırma zarfları VAKA_UYANDIR (0xC0) ve VAKA_DUR (0xC1) (RFC-0006 §11.5)
//
//   body = sig dışındaki alanların kodlaması; sig = Ed25519(imzalayan, hash('<etiket>', familyId, body))
// Zarf yalnız ipucudur; vakanın durumunu kayıtlar belirler. Emanet ve Posta Kutusu yolunda RFC-0003 §6.4 mührüyle
// kapatılır (anahtar derive(pair, 'ctrl'); seal.js 0x80–0xFE türlerini kapsar).
const c = require('compact-encoding')
const b4a = require('b4a')
const sodium = require('sodium-native')
const { kdf: { hash } } = require('@havenfold/core')
const { kodlama: { struct, decodeCanonical }, yetki: { readerSet, writerSet } } = require('@havenfold/records')

const hex = (b) => b4a.toString(b, 'hex')
function fail (code) { throw new Error(code) }

const Z = { VAKA_UYANDIR: 0xc0, VAKA_DUR: 0xc1 }
const ETIKET = { UYANDIR: 'hf/vaka-uyandir/', DUR: 'hf/vaka-dur/' }
const MAX_BASLIK = 120
const SAATTE = 30
const HOUR = 3_600_000

const uyandirBody = struct([
  ['collectionId', c.fixed16], ['vaka', c.fixed16], ['basamak', c.uint], ['sira', c.uint], ['onem', c.uint],
  ['baslik', c.string], ['senderId', c.fixed16]
])
const durBody = struct([['collectionId', c.fixed16], ['vaka', c.fixed16], ['tur', c.uint], ['byId', c.fixed16]])

function validateUyandir (m) {
  if (b4a.byteLength(m.baslik) > MAX_BASLIK || m.onem > 3) fail('INVALID_MESSAGE')
  return m
}
function validateDur (m) {
  if (m.tur > 1) fail('INVALID_MESSAGE')
  return m
}

const digestOf = (tag, familyId, body) => hash(tag, familyId, body)

function encode (enc, validate, tag, familyId, m, signer) {
  const body = c.encode(enc, validate({ ...m }))
  const sig = b4a.alloc(64)
  sodium.crypto_sign_detached(sig, digestOf(tag, familyId, body), signer.signKeyPair.secretKey)
  return b4a.concat([body, sig])
}

function decode (enc, validate, buf) {
  if (!b4a.isBuffer(buf) || buf.byteLength < 64) fail('INVALID_MESSAGE')
  const body = buf.subarray(0, buf.byteLength - 64)
  const sig = buf.subarray(buf.byteLength - 64)
  return { m: validate(decodeCanonical(enc, body, 'INVALID_MESSAGE')), body, sig }
}

const encodeUyandir = (familyId, m, signer) => encode(uyandirBody, validateUyandir, ETIKET.UYANDIR, familyId, { ...m, senderId: signer.memberId }, signer)
const decodeUyandir = (buf) => decode(uyandirBody, validateUyandir, buf)
const encodeDur = (familyId, m, signer) => encode(durBody, validateDur, ETIKET.DUR, familyId, { ...m, byId: signer.memberId }, signer)
const decodeDur = (buf) => decode(durBody, validateDur, buf)

const imzaTutar = (L, tag, body, sig, idHex) => {
  const e = L.entity(idHex)
  return !!e && sodium.crypto_sign_verify_detached(sig, digestOf(tag, L.familyId, body), e.signPub)
}

// Alıcı. me: alıcının kimliği (hex). Bugünkü defter durumuna göre denetler.
class UyandirmaKapisi {
  constructor ({ ledger, me, now = Date.now }) {
    this.ledger = ledger
    this.me = typeof me === 'string' ? me : hex(me)
    this.now = now
    this.alinan = new Set() // vaka,basamak,sira
    this.sayac = new Map() // senderHex → [an, …] son bir saat
  }

  // Dönüş: { ok: true, zarf } ya da { ok: false, neden } (atılır; 'REPLAY' sessizce)
  uyandir (bytes) {
    let d
    try { d = decodeUyandir(bytes) } catch { return { ok: false, neden: 'INVALID_MESSAGE' } }
    const { m, body, sig } = d
    const L = this.ledger
    const sender = hex(m.senderId)
    const col = L.collections.get(hex(m.collectionId))
    // 1. İmza
    if (!imzaTutar(L, ETIKET.UYANDIR, body, sig, sender)) return { ok: false, neden: 'INVALID_SIGNATURE' }
    if (!col) return { ok: false, neden: 'UNAUTHORIZED' }
    // 2. Gönderen bugün koleksiyonun yazarı: üye ya da writers'ta device: olarak bulunan cihaz (RFC-0019 §11.5 g)
    const okur = readerSet(L, col)
    const yazar = writerSet(L, col).get(sender)
    const yazanUye = yazar === 'uye' && L.sessionRole(sender) === 'uye'
    if (!yazanUye && yazar !== 'cihaz') return { ok: false, neden: 'UNAUTHORIZED' }
    // 3. Alıcı bugün okuyucu
    if (!okur.has(this.me)) return { ok: false, neden: 'NOT_READER' }
    // 4. Basamak
    if (m.basamak < 1 || m.basamak > 5) return { ok: false, neden: 'INVALID_MESSAGE' }
    // 5. Aynı (vaka, basamak, sıra) bir kez
    const k = hex(m.vaka) + ',' + m.basamak + ',' + m.sira
    if (this.alinan.has(k)) return { ok: false, neden: 'REPLAY' }
    // 6. Gönderen başına saatte en çok 30
    const now = this.now()
    const son = (this.sayac.get(sender) || []).filter((t) => t > now - HOUR)
    if (son.length >= SAATTE) { this.sayac.set(sender, son); return { ok: false, neden: 'LIMIT_REACHED' } }
    son.push(now)
    this.sayac.set(sender, son)
    this.alinan.add(k)
    return { ok: true, zarf: m }
  }

  // VAKA_DUR: byId koleksiyonun yazarı olan bir üye, imza geçerli
  dur (bytes) {
    let d
    try { d = decodeDur(bytes) } catch { return { ok: false, neden: 'INVALID_MESSAGE' } }
    const { m, body, sig } = d
    const L = this.ledger
    const by = hex(m.byId)
    const col = L.collections.get(hex(m.collectionId))
    if (!imzaTutar(L, ETIKET.DUR, body, sig, by)) return { ok: false, neden: 'INVALID_SIGNATURE' }
    if (!col || writerSet(L, col).get(by) !== 'uye') return { ok: false, neden: 'UNAUTHORIZED' }
    return { ok: true, zarf: m }
  }
}

module.exports = { Z, ETIKET, MAX_BASLIK, SAATTE, uyandirBody, durBody, digestOf, encodeUyandir, decodeUyandir, encodeDur, decodeDur, UyandirmaKapisi }
