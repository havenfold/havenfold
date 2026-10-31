// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// protocol/local-channel.js — aynı telefonda iki uygulamanın eşleşmesi (RFC-0017 §6.2)
//
// Taşıyıcıdan bağımsız kısım: eşleşme durum makinesi, APP_PAIR_REQ (0xE8), APP_PAIR_OK (0xE9) ve APP_LOCAL_SYNC (0xEA).
// APP_PAIR_REQ2 (0xEB, RFC-0034 §4.6): aynı istek ve sonda familyId; yeni uygulama hangi aileye eklenmek istediğini söyler.
// Eski uygulama isteğin ailesi kendi defteri değilse NO_FAMILY verir (birden çok aileli telefonda doğru örnek cevaplar).
// iOS App Group ve Android ContentProvider taşıyıcısı uygulamanın işidir. Kanalda kalıcı sır tutulmaz; eski uygulama
// hiçbir anahtarını ve çift sırrını vermez. Eşleşme dosyaları 5 dakika sonra silinir.
const c = require('compact-encoding')
const b4a = require('b4a')
const sodium = require('sodium-native')
const { hash } = require('../crypto/kdf')
const { deviceCertDigest, verifyDeviceCert } = require('../crypto/device-cert')
const { deviceCert } = require('./messages')
const { Ledger, T, createEvent, signEvent, encodeEvent, decodeEvent, memberIdOf } = require('../ledger/ledger')
const { decodeBody, canonical } = require('../ledger/encoding')
const { encodeEvents, decodeEvents } = require('../ledger/sync')
const { sealEnvelope, sealEnvelopeVektor, openEnvelope } = require('../messaging/seal')

const hex = (b) => b4a.toString(b, 'hex')
function fail (code) { throw new Error(code) }

const Z = { APP_PAIR_REQ: 0xe8, APP_PAIR_OK: 0xe9, APP_LOCAL_SYNC: 0xea, APP_PAIR_REQ2: 0xeb }
const PAIR_TTL_MS = 5 * 60 * 1000

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

const pairReq = struct([['deviceCert', deviceCert], ['appId', c.string], ['nonce', c.fixed32]])
const pairReq2 = struct([['deviceCert', deviceCert], ['appId', c.string], ['nonce', c.fixed32], ['familyId', c.fixed32]])
const pairOk = struct([['event', c.buffer], ['ledger', c.buffer], ['nonce', c.fixed32]])
// APP_LOCAL_SYNC'in açık gövdesi: içte taşınan zarfın türü ve baytları (defter, kayıt, anahtar; İstekler)
const localSync = struct([['type', c.uint], ['body', c.buffer]])

// §6.2: APP_PAIR_REQ ve APP_PAIR_OK yalnız yerel kanalda geçerlidir; ağdan (doğrudan oturum, emanet, Posta Kutusu)
// gelirse atılır. kanal: 'yerel' | 'ag'
function acceptOn (type, kanal) {
  if (type === Z.APP_PAIR_REQ || type === Z.APP_PAIR_OK || type === Z.APP_PAIR_REQ2) return kanal === 'yerel'
  return true
}

// APP_LOCAL_SYNC'in taşıyabildiği iç türler (RFC-0019 §11.8 e): defter eşitlemesi ve kayıt katmanı. Eşleşme
// türleri ve diğerleri içte de reddedilir.
const IC_TURLER = new Set([0x10, 0x11, 0x12, 0x80, 0x81, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88])
const icTurIzinli = (type) => IC_TURLER.has(type)

const transcriptOf = (nonce, cert, appId) => hash('hf/app-pair/', nonce, deviceCertDigest(cert), appId)

// --- Yeni uygulama ---------------------------------------------------------------------------------------------

class PairNew {
  // me: yeni uygulamanın kimliği. nonce yalnız test vektörü için verilir.
  // familyId (32 bayt): verilirse istek APP_PAIR_REQ2 (RFC-0034 §4.6); cevaptaki defter bu aileninki olmalı
  constructor ({ me, appId, now = Date.now, nonce = null, familyId = null }) {
    if (familyId !== null && !(b4a.isBuffer(familyId) && familyId.byteLength === 32)) fail('NO_FAMILY')
    this.me = me
    this.familyId = familyId
    this.appId = appId
    this.now = now
    this.nonce = nonce || randomBytes(32)
    this.state = 'bos'
    this.at = 0
  }

  request () {
    this.state = 'istek'
    this.at = this.now()
    const m = { deviceCert: this.me.deviceCert, appId: this.appId, nonce: this.nonce }
    return this.familyId ? c.encode(pairReq2, { ...m, familyId: this.familyId }) : c.encode(pairReq, m)
  }

  // İsteğin türü (yerel kanala bırakılırken)
  get tur () { return this.familyId ? Z.APP_PAIR_REQ2 : Z.APP_PAIR_REQ }

  // Eski uygulamanın cevabı → { ledger, event }: defter doğrulanmış, olay bizim imzamızla tamamlanmış.
  // Olay eşitlemeyle ailenin bütün cihazlarına yayılır.
  accept (bytes) {
    if (this.state !== 'istek') fail('PAIRING_STATUS')
    if (this.now() - this.at > PAIR_TTL_MS) { this.state = 'sona_erdi'; fail('PAIRING_EXPIRED') }
    let m
    try { m = canonical(pairOk, bytes, 'INVALID_MESSAGE') } catch { fail('INVALID_MESSAGE') }
    if (!b4a.equals(m.nonce, this.nonce)) fail('PAIRING_NONCE')
    const ledger = Ledger.fromEvents(decodeEvents(m.ledger).events.map(decodeEvent))
    if (this.familyId && !b4a.equals(ledger.familyId, this.familyId)) fail('NO_FAMILY')
    const e = decodeEvent(m.event)
    if (e.type !== T.APP_ATTACH || e.seq !== ledger.len || !b4a.equals(e.prev, ledger.head)) fail('PAIRING_EVENT')
    const body = decodeBody(T.APP_ATTACH, e.body)
    if (!b4a.equals(body.deviceCert.ukaPub, this.me.deviceCert.ukaPub) || body.appId !== this.appId || !body.sameDevice) fail('PAIRING_EVENT')
    if (!b4a.equals(body.ceremonyTranscriptHash, transcriptOf(this.nonce, this.me.deviceCert, this.appId))) fail('PAIRING_EVENT')
    if (e.sigs.some((s) => b4a.equals(s.memberId, this.me.memberId))) fail('PAIRING_EVENT')
    signEvent(e, this.me)
    ledger.check(e) // ana kimliğin imzası ve bütün kurallar
    this.state = 'tamam'
    return { ledger, event: e }
  }
}

// --- Eski uygulama (ana kimlik) ------------------------------------------------------------------------------------

class PairOld {
  constructor ({ me, ledger, now = Date.now }) {
    this.me = me
    this.ledger = ledger
    this.now = now
  }

  // approved: kullanıcının biyometri onayı (uygulama sorar). replaces: yeniden kurulan uygulamanın eski kimliği.
  answer (reqBytes, { approved, replaces = null, ts = this.now() }) {
    if (!approved) fail('NO_APPROVAL')
    // APP_PAIR_REQ ile APP_PAIR_REQ2 kanonik çözmeyle ayrılır (sonda 32 bayt familyId)
    let req
    try { req = canonical(pairReq, reqBytes, 'INVALID_MESSAGE') } catch {
      try { req = canonical(pairReq2, reqBytes, 'INVALID_MESSAGE') } catch { fail('INVALID_MESSAGE') }
    }
    if (!verifyDeviceCert(req.deviceCert)) fail('INVALID_CERTIFICATE')
    const L = this.ledger
    if (req.familyId && !b4a.equals(req.familyId, L.familyId)) fail('NO_FAMILY') // RFC-0034 §4.6
    const me = hex(this.me.memberId)
    const personId = L.personIdOf(me)
    if (!personId || L.persons.get(personId)?.primary !== me) fail('NOT_PRIMARY_IDENTITY') // ek kimlik eşleştiremez
    const e = createEvent(L, T.APP_ATTACH, {
      deviceCert: req.deviceCert,
      personId: b4a.from(personId, 'hex'),
      appId: req.appId,
      sameDevice: true,
      replaces,
      ceremonyTranscriptHash: transcriptOf(req.nonce, req.deviceCert, req.appId)
    }, ts)
    signEvent(e, this.me)
    return c.encode(pairOk, { event: encodeEvent(e), ledger: encodeEvents({ fromSeq: 0, events: L.events.map(encodeEvent) }), nonce: req.nonce })
  }
}

// --- APP_LOCAL_SYNC ----------------------------------------------------------------------------------------------

// Aynı cihaz grubundaki iki kimlik (RFC-0017 §3)
function sameGroup (L, a, b) {
  const ma = L.members.get(typeof a === 'string' ? a : hex(a))
  const mb = L.members.get(typeof b === 'string' ? b : hex(b))
  return !!ma && !!mb && ma.active && mb.active && !!ma.group && ma.group === mb.group
}

// İki kimliğin çift sırrıyla RFC-0003 §6.4'teki gibi mühürlenir (anahtar derive(pair, 'ctrl'))
function sealLocalSync ({ ledger, pair, me, peerId, type, body, id }) {
  if (!sameGroup(ledger, me.memberId, peerId)) fail('OUT_OF_GROUP')
  if (!icTurIzinli(type)) fail('INVALID_MESSAGE')
  return sealEnvelope(pair, me.memberId, peerId, Z.APP_LOCAL_SYNC, c.encode(localSync, { type, body }), id)
}

// Yalnız test vektörleri: sabit nonce
function sealLocalSyncVektor ({ ledger, pair, me, peerId, type, body, id, nonce }) {
  if (!sameGroup(ledger, me.memberId, peerId)) fail('OUT_OF_GROUP')
  return sealEnvelopeVektor(pair, me.memberId, peerId, Z.APP_LOCAL_SYNC, c.encode(localSync, { type, body }), id, nonce)
}

function openLocalSync ({ ledger, pair, me, peerId, box, id }) {
  if (!sameGroup(ledger, me.memberId, peerId)) fail('OUT_OF_GROUP')
  const pt = openEnvelope(pair, peerId, me.memberId, Z.APP_LOCAL_SYNC, box, id)
  let m
  try { m = canonical(localSync, pt, 'INVALID_MESSAGE') } catch { fail('INVALID_MESSAGE') }
  if (!icTurIzinli(m.type)) fail('INVALID_MESSAGE')
  return m
}

function randomBytes (n) { const b = b4a.alloc(n); sodium.randombytes_buf(b); return b }

module.exports = { Z, PAIR_TTL_MS, pairReq, pairReq2, pairOk, localSync, acceptOn, icTurIzinli, transcriptOf, PairNew, PairOld, sameGroup, sealLocalSync, sealLocalSyncVektor, openLocalSync, memberIdOf }
