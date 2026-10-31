// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// protocol/team-exit.js — ayrılan çalışanın iş verisinin temizliği: EKIP_CIKIS (0xC8), EKIP_CIKIS_OK (0xC9)
// (RFC-0005 §10.3, §10.4)
//
//   EKIP_CIKIS    { familyId, seq, event }   event: REMOVE_MEMBER olayının kodlanmış hali (imzalarıyla)
//   EKIP_CIKIS_OK { familyId, memberId, eventHash, scope (1 iş, 2 tam), collections, convs, blobs, finishedAt, sig }
//                 sig = Ed25519(üye, hash('hf/ekip-cikis-ok/', familyId, sig hariç gövde))
// Makbuz, uygulamanın silmeyi yaptığına dair imzalı beyandır; kanıt değildir.
const c = require('compact-encoding')
const b4a = require('b4a')
const sodium = require('sodium-native')
const { hash } = require('../crypto/kdf')
const { T, decodeBody, encodeEvent, decodeEvent, eventHash, canonical } = require('../ledger/encoding')
const { roller, alanda, yerleri } = require('../ledger/team')

const hex = (b) => b4a.toString(b, 'hex')
function fail (code) { throw new Error(code) }

const Z = { EKIP_CIKIS: 0xc8, EKIP_CIKIS_OK: 0xc9 }
const KAPSAM = { IS: 1, TAM: 2 }
const BEKLEME_MS = 7 * 86_400_000 // kopya eskiyse bağlanamadan geçen süre (§10.4 madde 4)
const MAKBUZ_MS = 30 * 86_400_000

function struct (fields) {
  return {
    preencode (state, m) { for (const [k, enc] of fields) enc.preencode(state, m[k]) },
    encode (state, m) { for (const [k, enc] of fields) enc.encode(state, m[k]) },
    decode (state) { const m = {}; for (const [k, enc] of fields) m[k] = enc.decode(state); return m }
  }
}

const cikis = struct([['familyId', c.fixed32], ['seq', c.uint], ['event', c.buffer]])
const okGovde = struct([
  ['familyId', c.fixed32], ['memberId', c.fixed16], ['eventHash', c.fixed32], ['scope', c.uint], ['collections', c.uint],
  ['convs', c.uint], ['blobs', c.uint], ['finishedAt', c.uint]
])
const okDigest = (familyId, body) => hash('hf/ekip-cikis-ok/', familyId, body)

const encodeCikis = (L, e) => c.encode(cikis, { familyId: L.familyId, seq: e.seq, event: encodeEvent(e) })

// Ayrılan cihazın denetimi (§10.4, RFC-0022 d). L: cihazın kendi defter kopyası, me: kendi kimliği (hex).
// Dönüş: { sil: true, kapsam, event } · { sil: false, kapsam: 0, event } · { bekle: true } (kopya eski) · hata
//   - Kopya güncelse (seq = defter uzunluğu ve prev = baş) olay kopyayla denetlenir; her hata kesin rettir.
//   - Kopya eskiyse 7 gün bağlanamadıktan sonra, kopyada hedefi yönetebilen bir imzacıyla yalnız iş kapsamı silinir.
//   - Sahibin cihazı hiçbir yoldan tam silinmez; başka sahiplerce çıkarılan sahip iş kapsamını da kendiliğinden silmez.
function cikisDenetle (L, bytes, me, { simdi = Date.now(), sonBaglanti = simdi } = {}) {
  let m
  try { m = canonical(cikis, bytes, 'INVALID_MESSAGE') } catch { fail('INVALID_MESSAGE') }
  if (!b4a.equals(m.familyId, L.familyId)) fail('INVALID_MESSAGE')
  let e
  try { e = decodeEvent(m.event) } catch { fail('INVALID_MESSAGE') }
  if (e.type !== T.REMOVE_MEMBER || e.seq !== m.seq) fail('INVALID_MESSAGE') // 1. olay REMOVE_MEMBER
  const body = decodeBody(T.REMOVE_MEMBER, e.body)
  if (hex(body.memberId) !== me) fail('TARGET_NOT_ME')
  const tm = L.members.get(me)
  const sahip = tm && tm.role === 'sahip'
  const sonuc = (tam) => (sahip ? { sil: false, kapsam: 0, event: e } : { sil: true, kapsam: tam ? KAPSAM.TAM : KAPSAM.IS, event: e })
  // Olay kopyada zaten uygulanmışsa özetler aynı olmalı
  if (e.seq < L.len) {
    if (!b4a.equals(L.hashAt(e.seq), eventHash(e))) fail('LEDGER_FORK')
    return sonuc(body.wipe)
  }
  // 2–3. Kopya güncel: kendi kopyasıyla imzalar ve yeter sayı; hata kesin ret
  if (e.seq === L.len && (L.len === 0 || b4a.equals(e.prev, L.head))) {
    L.check(e)
    return sonuc(body.wipe)
  }
  // 4. Kopya eski: 7 gün bağlanamazsa, kopyada hedefi yönetebilen imzacıyla (sahip ya da alanındaki yönetici)
  if (simdi - sonBaglanti < BEKLEME_MS) return { bekle: true }
  const h = eventHash(e)
  const gecerli = e.sigs.filter((s) => {
    const u = L.members.get(hex(s.memberId))
    return u && u.active && sodium.crypto_sign_verify_detached(s.sig, h, u.signPub)
  }).map((s) => hex(s.memberId))
  const { S, Y } = roller(L)
  if (gecerli.some((x) => S.includes(x))) return sonuc(false)
  if (!sahip && gecerli.some((x) => Y.includes(x) && alanda(L, x, yerleri(L, me)))) return sonuc(false)
  if (gecerli.some((x) => Y.includes(x))) fail('OUT_OF_SCOPE')
  fail('INVALID_SIGNATURE')
}

// Makbuz (me: { memberId, signKeyPair }). eventHash: REMOVE_MEMBER'ın özeti; LEAVE'den önce 32 sıfır
function makbuzYaz (familyId, me, { eventHash: eh = b4a.alloc(32), scope, collections, convs, blobs, finishedAt }) {
  const body = c.encode(okGovde, { familyId, memberId: me.memberId, eventHash: eh, scope, collections, convs, blobs, finishedAt })
  const sig = b4a.alloc(64)
  sodium.crypto_sign_detached(sig, okDigest(familyId, body), me.signKeyPair.secretKey)
  return b4a.concat([body, sig])
}

// Yönetim tarafı (RFC-0022 e): makbuz yalnız son 30 günde çıkarılmış (ya da ayrılmak üzere olan) üyeden, o üyenin
// cihazdaki son kimliğinden kabul edilir. Çıkarılmış üyede özet çıkarma olayınınkidir; kapsam olayın istediğinden dar
// olamaz (wipe: true → tam). gorulen: kabul edilmiş makbuzların anahtarları (kalıcı küme); ikinci makbuz DUPLICATE_RECEIPT.
function makbuzDenetle (L, bytes, { simdi = Date.now(), gorulen = null } = {}) {
  if (!b4a.isBuffer(bytes) || bytes.byteLength < 64) fail('INVALID_MESSAGE')
  const body = bytes.subarray(0, bytes.byteLength - 64)
  const sig = bytes.subarray(bytes.byteLength - 64)
  let m
  try { m = canonical(okGovde, body, 'INVALID_MESSAGE') } catch { fail('INVALID_MESSAGE') }
  if (!b4a.equals(m.familyId, L.familyId) || ![KAPSAM.IS, KAPSAM.TAM].includes(m.scope)) fail('INVALID_MESSAGE')
  const id = hex(m.memberId)
  const u = L.members.get(id)
  if (!u) fail('UNAUTHORIZED')
  if (!sodium.crypto_sign_verify_detached(sig, okDigest(L.familyId, body), u.signPub)) fail('INVALID_SIGNATURE')
  if (u.rotatedTo) fail('INVALID_RECEIPT') // telefon değişimiyle düşmüş kimlik
  if (!u.active) {
    const ev = L.events[u.removedSeq]
    if (!ev || simdi - ev.ts > MAKBUZ_MS) fail('UNAUTHORIZED')
    // Kendi isteğiyle ayrılan LEAVE'den önce makbuz yazar (özet 32 sıfır, §10.3); LEAVE uygulandıktan sonra da gelebilir.
    // LEAVE'de yalnız sıfır özet: LEAVE'in özetiyle ikinci makbuz olmasın (inceleme 16 K4, RFC-0022 e)
    const sifir = m.eventHash.every((x) => x === 0)
    if (ev.type === T.LEAVE ? !sifir : !b4a.equals(m.eventHash, eventHash(ev))) fail('INVALID_RECEIPT')
    if (ev.type === T.REMOVE_MEMBER && decodeBody(T.REMOVE_MEMBER, ev.body).wipe && m.scope !== KAPSAM.TAM) fail('INVALID_RECEIPT')
  } else if (!m.eventHash.every((x) => x === 0)) fail('INVALID_RECEIPT') // LEAVE'den önce
  const anahtar = id + '|' + hex(m.eventHash)
  if (gorulen) {
    if (gorulen.has(anahtar)) fail('DUPLICATE_RECEIPT')
    gorulen.add(anahtar)
  }
  return m
}

module.exports = { Z, KAPSAM, BEKLEME_MS, MAKBUZ_MS, cikis, okGovde, okDigest, encodeCikis, cikisDenetle, makbuzYaz, makbuzDenetle }
