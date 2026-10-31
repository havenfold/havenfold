// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D93: RFC-0034 §4.6 ve §11 madde 14 — yerel kanalda aile seçen eşleşme isteği APP_PAIR_REQ2 (0xEB). Eski uygulama
// isteğin ailesi kendi defteri değilse NO_FAMILY verir; yeni uygulama cevaptaki defterin ailesini denetler; 0xEB ağdan
// gelirse atılır; tek aileli uygulama 0xE8 ile eşleşmeyi sürdürür. Beklenenler RFC'den elle yazıldı.
'use strict'
const test = require('brittle')
const b4a = require('b4a')
const { Ledger, T, encodeEvent, decodeEvent } = require('../ledger/ledger')
const { canonical } = require('../ledger/encoding')
const Y = require('../protocol/local-channel')
const Zr = require('../protocol/envelope')
const giris = require('../protocol/ingress')
const D = require('./helpers/ledger')
const { C0, E: EKS } = require('../../records/test/helpers/multi-vector')
const V = require('../../../protocol/vectors/multi-family.json')

const hataOf = (f) => { try { f(); return null } catch (err) { return err.message } }
// Düzey 2.2 çok uygulamalı aile (coklu-uygulama vektörü); Kerem ana kimlik
const cokluDefter = () => { const L = new Ledger({ now: () => D.TS0 }); for (const e of C0) L.apply(decodeEvent(encodeEvent(e))); return L }
const yeni = (o = {}) => new Y.PairNew({ me: EKS.keremU3, appId: 'yuva-bakim', now: () => D.TS0, nonce: b4a.alloc(32, 0x34), ...o })

test('vektör 14: APP_PAIR_REQ2 — aile kendi defterinde değilse NO_FAMILY; doğru ailede eşleşir; yeni uygulama defterin ailesini denetler', (t) => {
  const L = cokluDefter() // Eser: Kerem ana kimlik
  const eski = new Y.PairOld({ me: D.K.kerem, ledger: L, now: () => D.TS0 })
  // Doğru aile: istek 0xEB, cevap 0xE9, olay APP_ATTACH
  const y = yeni({ familyId: L.familyId })
  const istek = y.request()
  t.is(y.tur, Y.Z.APP_PAIR_REQ2)
  t.is(Zr.Z.APP_PAIR_REQ2, 0xeb)
  t.ok(canonical(Y.pairReq2, istek, 'INVALID_MESSAGE'), 'kanonik 0xEB gövdesi')
  t.exception(() => canonical(Y.pairReq, istek, 'INVALID_MESSAGE'), /INVALID_MESSAGE/, '0xE8 olarak çözülmez (sonda familyId)')
  t.ok(giris.gelenZarf({ kanal: 'yerel', type: 0xeb, bytes: istek }), 'yerel kanal girişi kabul eder')
  const r = y.accept(eski.answer(istek, { approved: true }))
  t.is(r.event.type, T.APP_ATTACH)
  // Başka aile: eski uygulama NO_FAMILY
  const y2 = yeni({ familyId: b4a.alloc(32, 9) })
  t.is(hataOf(() => eski.answer(y2.request(), { approved: true })), V.yerelKanal[0].hata)
  // Yeni uygulama: 0xEB ile istediği aile dışında bir defter gelirse NO_FAMILY
  const y3 = yeni({ familyId: b4a.alloc(32, 9) })
  y3.request()
  const ok = eski.answer(yeni().request(), { approved: true }) // aynı nonce, ailesiz istek
  t.is(hataOf(() => y3.accept(ok)), 'NO_FAMILY')
  t.is(hataOf(() => yeni({ familyId: b4a.alloc(16) })), 'NO_FAMILY', 'familyId 32 bayt')
})

test('vektör 14: 0xEB ağdan gelirse atılır; tek aileli uygulama 0xE8 ile eşleşmeyi sürdürür', (t) => {
  for (const [a, b] of [['uye', 'uye'], ['cihaz', 'uye'], ['misafir', 'uye']]) t.absent(Zr.typeAllowed(a, b, 0xeb), a + '|' + b + ' 0xEB')
  t.absent(Y.acceptOn(0xeb, 'ag'))
  t.ok(Y.acceptOn(0xeb, 'yerel'))
  const istek = yeni({ familyId: cokluDefter().familyId }).request()
  t.is(hataOf(() => giris.gelenZarf({ myRole: 'uye', peerRole: 'uye', type: 0xeb, bytes: istek, yol: 'dogrudan' })), V.yerelKanal[1].hata)
  t.absent(Y.icTurIzinli(0xeb), 'APP_LOCAL_SYNC içinde de yok')
  // 0xE8: bugünkü gibi
  const L = cokluDefter()
  const y = yeni()
  t.is(y.tur, Y.Z.APP_PAIR_REQ)
  t.is(y.accept(new Y.PairOld({ me: D.K.kerem, ledger: L, now: () => D.TS0 }).answer(y.request(), { approved: true })).event.type, T.APP_ATTACH)
})
