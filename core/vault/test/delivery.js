// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// RFC-0027 §1b (D31): pay teslimi zarfları — protocol/vectors/vault-share.json
const test = require('brittle')
const b4a = require('b4a')
const T = require('../delivery')
const I = require('../request')
const A = require('../../records/test/helpers/family')
const { giris, zarf: { Z } } = require('@havenfold/core')
const { vektorler } = require('./helpers/vault-share-vector')
const F = require('../../../protocol/vectors/vault-share.json')

const buf = (h) => b4a.from(h, 'hex')
const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const bellek = () => { const m = new Map(); return { get: (k) => m.get(k), has: (k) => m.has(k), set: (k, v) => m.set(k, v) } }

test('vektörler: vault-share.json üretici aynı dosyayı verir (belirlenimci)', (t) => {
  t.alike(JSON.parse(JSON.stringify(vektorler())), F)
})

test('vault-share.json girdilerinden yeniden hesap: tutucunun kararları', (t) => {
  const L = A.anaDefter()
  const tutucular = { h: A.K.husniye, h2: A.K.husniye, i: A.K.irem }
  const ornek = {}
  for (const d of F.durumlar) {
    ornek[d.grup] = ornek[d.grup] || new I.PayTutucu({ ledger: L, me: tutucular[d.grup], now: () => A.TS0, ilkGorulme: bellek(), sayac: bellek() })
    let r
    try { r = T.teslimAl(ornek[d.grup], d.gonderen, buf(d.bytes)).durum } catch (err) { r = err.message }
    t.is(r, d.beklenen, d.aciklama)
  }
  const ack = T.alindiCoz(buf(F.ack))
  t.alike({ secretId: b4a.toString(ack.secretId, 'hex'), version: ack.version, holderId: b4a.toString(ack.holderId, 'hex') }, F.ackAlanlari)
  t.is(hataOf(() => T.alindiCoz(b4a.concat([buf(F.ack), b4a.from([0])]))), 'INVALID_MESSAGE')
})

test('elle yazılmış beklenenler; zarf numaraları; Posta Kutusu yasak, emanet serbest', (t) => {
  t.alike(F.durumlar.map((d) => d.beklenen), ['yeni', 'tekrar', 'DUPLICATE_HOLDER', 'WRONG_HOLDER', 'UNAUTHORIZED', 'INVALID_MESSAGE', 'INVALID_SHARE', 'INVALID_MESSAGE', 'UNAUTHORIZED', 'yeni', 'yeni'])
  t.alike([Z.KASA_SHARE_PUT, Z.KASA_SHARE_ACK], [0xf1, 0xf2])
  t.alike(F.zarf, { KASA_SHARE_PUT: 0xf1, KASA_SHARE_ACK: 0xf2 })
  const g = (yol, peerRole = 'uye') => hataOf(() => giris.gelenZarf({ myRole: 'uye', peerRole, type: Z.KASA_SHARE_PUT, bytes: buf(F.put), yol }))
  t.is(g('posta'), 'MAILBOX_FORBIDDEN')
  t.is(g('emanet'), null)
  t.is(g('dogrudan'), null)
  t.is(g('dogrudan', 'cihaz'), null, 'TPM\'li işçi pay tutar')
  t.is(g('dogrudan', 'misafir'), 'TYPE_NOT_ALLOWED')
})
