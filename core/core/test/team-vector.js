// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
const test = require('brittle')
const b4a = require('b4a')
const { Ledger, decodeEvent } = require('../ledger/ledger')
const F = require('../../../protocol/vectors/team.json')
const { vektorler } = require('./helpers/team-vector')

const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const ev = (h) => decodeEvent(b4a.from(h, 'hex'))

test('vektörler: team.json üretici aynı dosyayı verir (belirlenimci)', (t) => {
  t.alike(JSON.parse(JSON.stringify(vektorler())), F)
})

test('vektörler: ekip zinciri uygulanır; her durum beklenen sonucu verir', (t) => {
  const kur = (n) => { const L = new Ledger(); for (const z of F.zincir.slice(0, n)) L.apply(ev(z.olay)); return L }
  t.is(kur(F.zincir.length).kind, 'ekip')
  for (const d of F.durumlar) {
    const L = kur(d.onek)
    for (const h of d.hazirlik) L.apply(ev(h))
    t.is(hataOf(() => L.check(ev(d.olay))), d.beklenen, d.no + ': ' + d.aciklama)
  }
  const A = new Ledger()
  for (const h of F.aile.zincir) A.apply(ev(h))
  t.is(hataOf(() => A.check(ev(F.aile.olay))), F.aile.beklenen)
})
