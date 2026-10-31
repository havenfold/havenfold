// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// worklet/ledger/encoding.js — LedgerEvent ve gövdelerin tel biçimi (docs/04 §4.1–§4.2, K5)
//
// eventHash = hash('ledger-event', encodeUnsigned(e)); imzalar hash'e girmez.
// Gövde olayın içinde ham bayt olarak taşınır; hash bu baytların üstünden alınır. Çözme kanoniktir (RFC-0019
// §11.3 d): çözülen değer yeniden kodlanınca aynı baytları vermelidir; en kısa olmayan uint, 0/1 dışı bool ve
// sondaki fazla bayt reddedilir.
const c = require('compact-encoding')
const b4a = require('b4a')
const { hash } = require('../crypto/kdf')
const { deviceCert } = require('../protocol/messages')

// Gövdenin sonundaki seçimli bool: yoksa hiç bayt yazılmaz (eski biçimle bayt bayt aynı), varsa 0/1
const sondaBool = {
  preencode (state, v) { if (v !== null && v !== undefined) c.bool.preencode(state, v) },
  encode (state, v) { if (v !== null && v !== undefined) c.bool.encode(state, v) },
  decode (state) { return state.start < state.end ? c.bool.decode(state) : null }
}

const T = {
  GENESIS: 0,
  ADD_MEMBER: 1,
  REMOVE_MEMBER: 2,
  LEAVE: 3,
  ROTATE_DEVICE: 4,
  POLICY: 5,
  PLAN: 6,
  PREKEY: 7,
  SET_ROLE: 8,
  LINK: 9,
  UNLINK: 10,
  INTRO: 11,
  ACTIVATE_MEMBER: 12, // K15: bekleyen (uzaktan ya da ebeveyn cihaz değişimi) üyeyi etkinleştirir
  // Protokol v2.1 (RFC-0003 §5, §10)
  DEVICE_ATTACH: 13,
  DEVICE_DETACH: 14,
  PLACE: 15,
  BEING: 16,
  GRANT: 17,
  REVOKE: 18,
  SHARE_CONSENT: 19,
  KIND: 20,
  COLLECTION: 21,
  PROTOCOL_LEVEL: 22,
  TASK_PERMIT: 23,
  // Ekip (RFC-0005 §7); yalnız KIND = 'ekip' toplulukta. 27–29 ayrılmış.
  ASSIGN: 24,
  TERM: 25,
  NOTICE: 26,
  // Protokol v2.2 (RFC-0017 §4.1). 30–33 başka RFC'lere ayrılmış.
  APP_ATTACH: 34,
  APP_PRIMARY: 35,
  // Protokol v2.3 (RFC-0030 §3)
  GRANT_WRITE: 36
}
const T_NAME = Object.fromEntries(Object.entries(T).map(([k, v]) => [v, k]))

const fixed16 = c.fixed16
const fixed8 = c.fixed(8)

// Alan listesinden kodlayıcı: [[ad, kodlayıcı], ...]
function struct (fields) {
  return {
    preencode (state, m) { for (const [k, enc] of fields) enc.preencode(state, m[k]) },
    encode (state, m) { for (const [k, enc] of fields) enc.encode(state, m[k]) },
    decode (state) {
      const m = {}
      for (const [k, enc] of fields) m[k] = enc.decode(state)
      return m
    }
  }
}

// Seçimli alan: önce c.bool varlık bayrağı, sonra değer; null "bayrak false" demektir
function optional (enc) {
  return {
    preencode (state, v) { c.bool.preencode(state, v !== null && v !== undefined); if (v !== null && v !== undefined) enc.preencode(state, v) },
    encode (state, v) { c.bool.encode(state, v !== null && v !== undefined); if (v !== null && v !== undefined) enc.encode(state, v) },
    decode (state) { return c.bool.decode(state) ? enc.decode(state) : null }
  }
}

const policy = struct([
  ['maxMembers', c.uint],
  ['inviteTtlSec', c.uint],
  ['defaultDisappearSec', c.uint],
  ['requireInPersonCeremony', c.bool],
  ['removeQuorum', c.string],
  ['addQuorum', c.string],
  ['prekeyRotateDays', c.uint],
  ['prekeyGraceDays', c.uint]
])

const BODY = {
  [T.GENESIS]: struct([['familyName', c.string], ['policy', policy], ['founder', deviceCert], ['displayName', c.string]]),
  // remote = true ise uzaktan katılım: activatesAt'e kadar beklemede (docs/04 §4.2 rol tablosu)
  [T.ADD_MEMBER]: struct([
    ['deviceCert', deviceCert], ['displayName', c.string], ['role', c.string], ['inviterId', fixed16],
    ['ceremonyTranscriptHash', c.fixed32], ['remote', c.bool], ['activatesAt', c.uint]
  ]),
  [T.REMOVE_MEMBER]: struct([['memberId', fixed16], ['reason', c.string], ['wipe', c.bool]]),
  [T.LEAVE]: struct([['memberId', fixed16]]),
  // oldSigned: olayın kipi gövdededir (RFC-0020 a); v1 zincirlerinde (Yuva Hat) yoktur, v2.1+ ailede zorunludur
  [T.ROTATE_DEVICE]: struct([['oldMemberId', fixed16], ['newDeviceCert', deviceCert], ['ceremonyTranscriptHash', c.fixed32], ['oldSigned', sondaBool]]),
  [T.POLICY]: struct([['policy', policy]]),
  [T.PLAN]: struct([['storeReceiptJws', c.string], ['product', c.string], ['expiresAt', c.uint]]),
  // K5: { prekeyId, pub, sig, createdAt }. Sahibi olayın tek imzacısıdır.
  [T.PREKEY]: struct([['prekeyId', fixed8], ['pub', c.fixed32], ['sig', c.fixed64], ['createdAt', c.uint]]),
  [T.SET_ROLE]: struct([['memberId', fixed16], ['role', c.string]]),
  [T.LINK]: struct([
    ['linkId', fixed16], ['otherFamilyHint', c.fixed32], ['otherName', c.string], ['bridgeLocalId', fixed16],
    ['bridgeRemoteCert', deviceCert], ['crossSig', c.fixed64], ['visibility', c.string]
  ]),
  [T.UNLINK]: struct([['linkId', fixed16], ['reason', c.string]]),
  [T.ACTIVATE_MEMBER]: struct([['memberId', fixed16]]),
  [T.INTRO]: struct([['linkId', fixed16], ['introducedCert', deviceCert], ['displayName', c.string], ['scope', c.string]]),

  // Protokol v2.1 (RFC-0003 §5). placeId yoksa 16 sıfır, dropKey yoksa 32 sıfır.
  [T.DEVICE_ATTACH]: struct([
    ['deviceCert', deviceCert], ['class', c.string], ['name', c.string], ['placeId', fixed16],
    ['caps', c.buffer], ['ceremonyTranscriptHash', c.fixed32]
  ]),
  [T.DEVICE_DETACH]: struct([['deviceId', fixed16], ['reason', c.string], ['wipe', c.bool], ['wipeReportHash', c.fixed32]]),
  [T.PLACE]: struct([['placeId', fixed16], ['name', c.string], ['kind', c.string], ['remove', c.bool]]),
  [T.BEING]: struct([['beingId', fixed16], ['kind', c.string], ['name', c.string], ['placeId', fixed16], ['remove', c.bool]]),
  // grantedBy: misafirliğin bağlı olduğu ebeveyn; imzacılardan biri (RFC-0019 §11.3 a)
  [T.GRANT]: struct([
    ['to', deviceCert], ['name', c.string], ['collections', c.array(fixed16)], ['taskTypes', c.array(c.string)],
    ['expiresAt', c.uint], ['ceremonyTranscriptHash', c.fixed32], ['grantedBy', fixed16]
  ]),
  [T.REVOKE]: struct([['grantId', fixed16], ['reason', c.string]]),
  [T.SHARE_CONSENT]: struct([
    ['shareId', fixed16], ['service', c.string], ['scope', c.string], ['ownerId', fixed16],
    ['expiresAt', c.uint], ['payloadHash', c.fixed32]
  ]),
  [T.KIND]: struct([['kind', c.string]]),
  [T.COLLECTION]: struct([
    ['collectionId', fixed16], ['name', c.string], ['kind', c.string],
    ['readers', c.array(c.string)], ['writers', c.array(c.string)],
    ['sensitivity', c.string], ['taskAccess', c.bool], ['history', c.bool], ['dropKey', c.fixed32]
  ]),
  [T.PROTOCOL_LEVEL]: struct([['level', c.string]]),
  [T.TASK_PERMIT]: struct([['subject', c.string], ['taskTypes', c.array(c.string)], ['allow', c.bool]]),

  // Ekip (RFC-0005 §7)
  [T.ASSIGN]: struct([['subjectId', fixed16], ['placeIds', c.array(fixed16)]]),
  [T.TERM]: struct([['memberId', fixed16], ['expiresAt', c.uint]]),
  [T.NOTICE]: struct([
    ['placeId', fixed16], ['textBlobId', c.fixed32], ['signBlobId', c.fixed32], ['textVersion', c.string],
    ['cameraCount', c.uint], ['outbound', c.array(c.string)], ['remove', c.bool]
  ]),

  // Protokol v2.2 (RFC-0017 §4.1). replaces seçimlidir: c.bool varlık bayrağı + değer (RFC-0001 §3).
  [T.APP_ATTACH]: struct([
    ['deviceCert', deviceCert], ['personId', fixed16], ['appId', c.string], ['sameDevice', c.bool],
    ['replaces', optional(fixed16)], ['ceremonyTranscriptHash', c.fixed32]
  ]),
  // against: yazıldığı anda kişinin ana kimliği (RFC-0020 b); oldSigned ve parentSigned kip bayrakları (RFC-0020 a)
  [T.APP_PRIMARY]: struct([['personId', fixed16], ['newPrimaryId', fixed16], ['against', fixed16], ['oldSigned', c.bool], ['parentSigned', c.bool]]),

  // Protokol v2.3 (RFC-0030 §3): misafirin bırakma izni; types boşsa izin kalkar
  [T.GRANT_WRITE]: struct([['grantId', fixed16], ['collectionId', fixed16], ['types', c.array(c.string)], ['subjects', c.array(c.string)]])
}

const unsigned = struct([['v', c.uint], ['seq', c.uint], ['prev', c.fixed32], ['type', c.uint], ['ts', c.uint], ['body', c.buffer]])
const sigEntry = struct([['memberId', fixed16], ['sig', c.fixed64]])

const event = {
  preencode (state, e) { unsigned.preencode(state, e); c.array(sigEntry).preencode(state, e.sigs) },
  encode (state, e) { unsigned.encode(state, e); c.array(sigEntry).encode(state, e.sigs) },
  decode (state) {
    const e = unsigned.decode(state)
    e.body = e.body || b4a.alloc(0)
    e.sigs = c.array(sigEntry).decode(state)
    return e
  }
}

function encodeBody (type, body) {
  const enc = BODY[type]
  if (!enc) throw new Error('UNKNOWN_EVENT')
  return c.encode(enc, body)
}

// Kanonik çözme: çöz, yeniden kodla, baytlar aynı olmalı
function canonical (enc, buf, code) {
  let m
  try { m = c.decode(enc, buf) } catch { throw new Error(code) }
  let again
  try { again = c.encode(enc, m) } catch { throw new Error(code) }
  if (!b4a.equals(again, buf)) throw new Error(code)
  return m
}

function decodeBody (type, buf) {
  const enc = BODY[type]
  if (!enc) throw new Error('UNKNOWN_EVENT')
  return canonical(enc, buf, 'CORRUPT_BODY')
}

const encodeUnsigned = (e) => c.encode(unsigned, e)
const eventHash = (e) => hash('ledger-event', encodeUnsigned(e))
const encodeEvent = (e) => c.encode(event, e)
function decodeEvent (buf) {
  return canonical(event, buf, 'CORRUPT_EVENT')
}

module.exports = { T, T_NAME, BODY, policy, event, canonical, encodeBody, decodeBody, encodeUnsigned, eventHash, encodeEvent, decodeEvent }
