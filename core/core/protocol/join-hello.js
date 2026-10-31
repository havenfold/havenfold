// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// protocol/join-hello.js — tören JOIN_HELLO gövdesi ve yetenek bitleri (RFC-0003 §2.2 madde 2, 6)
//
// Gövde Yuva Hat worklet/ceremony/protocol.js'teki joinHello'dur; sonuna `caps` eklenir. Eski istemcinin
// JOIN_HELLO'sunda bu alan yoktur; yokluğu caps = 0 sayılır. Tören akışının kendisi (ağ) bu pakette değil.
// RFC-0036 §4.2: caps'ten sonra isteğe bağlı familyName (UTF-8, 1–256 bayt); yalnız caps'te AILE_ADI varken yazılır,
// yazılmışsa boş olamaz. Uymayan INVALID_MESSAGE. Eski çözücü sondaki adı reddeder; bit koşulu bu yüzdendir.
const c = require('compact-encoding')
const { deviceCert } = require('./messages')
const { CAPS } = require('./hello')
const { levelAtLeast } = require('../ledger/v21')

// QR'daki tören türü (RFC-0003 §10)
const TOREN = { UYE: 0, KUTU: 1, CIHAZ: 2, MISAFIR: 3, EK_KIMLIK: 4 } // 4: kişinin başka cihazı (RFC-0017 §6.3)

// caps = 0 iken alan hiç yazılmaz (eski istemcinin biçimi); yazılmışsa 0 olamaz. Böylece her JOIN_HELLO'nun tek
// kodlaması vardır (inceleme 3: caps = 0 için iki bayt dizisi kabul ediliyordu).
const joinHello = {
  preencode (state, m) {
    deviceCert.preencode(state, m.cert)
    c.string.preencode(state, m.name)
    c.string.preencode(state, m.device)
    c.fixed32.preencode(state, m.eph)
    c.fixed32.preencode(state, m.mac)
    if (m.caps) c.uint.preencode(state, m.caps)
    if (m.familyName != null) c.string.preencode(state, m.familyName)
  },
  encode (state, m) {
    deviceCert.encode(state, m.cert)
    c.string.encode(state, m.name)
    c.string.encode(state, m.device)
    c.fixed32.encode(state, m.eph)
    c.fixed32.encode(state, m.mac)
    if (m.caps) c.uint.encode(state, m.caps)
    if (m.familyName != null) c.string.encode(state, m.familyName)
  },
  decode (state) {
    const m = { cert: deviceCert.decode(state), name: c.string.decode(state), device: c.string.decode(state), eph: c.fixed32.decode(state), mac: c.fixed32.decode(state) }
    m.caps = state.start < state.end ? c.uint.decode(state) : 0
    m.familyName = state.start < state.end ? c.string.decode(state) : null
    return m
  }
}

// Kanonik çözme (RFC-0019 §11.3 d): yeniden kodlanınca aynı baytlar
const AILE_ADI_EN_UZUN = 256

// familyName kuralı (RFC-0036 §4.2): bit varken, 1–256 bayt
function aileAdiGecerli (m) {
  if (m.familyName == null) return true
  if (typeof m.familyName !== 'string' || (m.caps & CAPS.AILE_ADI) === 0) return false
  const n = require('b4a').byteLength(m.familyName)
  return n >= 1 && n <= AILE_ADI_EN_UZUN
}

function encodeJoinHello (m) {
  if (!aileAdiGecerli(m)) throw new Error('INVALID_MESSAGE')
  return c.encode(joinHello, m)
}

function decodeJoinHello (buf) {
  let m
  try { m = c.decode(joinHello, buf) } catch { throw new Error('INVALID_MESSAGE') }
  if (!aileAdiGecerli(m) || !require('b4a').equals(c.encode(joinHello, m), buf)) throw new Error('INVALID_MESSAGE')
  return m
}

// §2.2 madde 6: düzey 2.1 yazıldıktan sonra LEDGER_V21 bitini taşımayan cihaz katılamaz
// RFC-0017 §4.4: düzey 2.2'den sonra COKLU_UYGULAMA bitini taşımayan JOIN_HELLO da reddedilir
// RFC-0030 §8: düzey 2.3'ten sonra MISAFIR_YAZAR biti de
function checkJoinCaps (ledger, caps) {
  if (levelAtLeast(ledger.level, '2.1') && (caps & CAPS.LEDGER_V21) === 0) throw new Error('UPDATE_REQUIRED')
  if (levelAtLeast(ledger.level, '2.2') && (caps & CAPS.COKLU_UYGULAMA) === 0) throw new Error('UPDATE_REQUIRED')
  if (levelAtLeast(ledger.level, '2.3') && (caps & CAPS.MISAFIR_YAZAR) === 0) throw new Error('UPDATE_REQUIRED')
}

// Aile tarafının yeni gelene ilk göndereceği: misafir töreninde JOIN_LEDGER yerine GUEST_VIEW (§6.1)
const firstPayloadOf = (kind) => (kind === TOREN.MISAFIR ? 'GUEST_VIEW' : 'JOIN_LEDGER')

module.exports = { TOREN, joinHello, encodeJoinHello, decodeJoinHello, checkJoinCaps, firstPayloadOf, AILE_ADI_EN_UZUN }
