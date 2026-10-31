// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
const test = require('brittle')
const b4a = require('b4a')
const { Ledger, decodeEvent } = require('../ledger/ledger')
const { forkWinner } = require('../ledger/sync')
const F = require('../../../protocol/vectors/team-v2.json')
const { vektorlerV2 } = require('./helpers/team-vector')

const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const ev = (h) => decodeEvent(b4a.from(h, 'hex'))
const kur = (n) => { const L = new Ledger(); for (const z of F.zincir.slice(0, n)) L.apply(ev(z.olay)); return L }

test('vektörler: team-v2.json üretici aynı dosyayı verir (belirlenimci)', (t) => {
  t.alike(JSON.parse(JSON.stringify(vektorlerV2())), F)
})

test('vektörler: ekip-v2 durumları ve çatallanma', (t) => {
  for (const d of F.durumlar) {
    const L = kur(d.onek)
    for (const h of d.hazirlik) L.apply(ev(h))
    t.is(hataOf(() => L.check(ev(d.olay))), d.beklenen, d.no + ': ' + d.aciklama)
  }
  for (const c of F.catallanma) {
    const L = kur(c.onek)
    const a = ev(c.a)
    const b = ev(c.b)
    t.is(forkWinner(a, b, L) === a ? 'a' : 'b', c.kazanan, c.aciklama)
  }
  t.alike(F.durumlar.filter((d) => [4, 5, 6, 7].includes(d.no) && d.hazirlik.length).map((d) => d.beklenen), ['PLACE_BOX_LIMIT', null, 'OWNER_LIMIT', null, 'OWNER_LIMIT', 'BOX_REQUIRED', null, 'MEMBER_LIMIT', 'PLACE_DEVICE_LIMIT'])
})
