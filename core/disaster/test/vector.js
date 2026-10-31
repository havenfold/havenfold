// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// protocol/vectors/disaster.json (RFC-0012 §14): her madde dosyadaki girdilerden yeniden hesaplanır.
const test = require('brittle')
const F = require('../../../protocol/vectors/disaster.json')
const { vektorler, calistir, ZINCIR } = require('./helpers/disaster-vector')

test('vektörler: disaster.json üretici aynı dosyayı verir (belirlenimci)', (t) => {
  t.alike(JSON.parse(JSON.stringify(vektorler())), F)
})

test('vektörler: afet zinciri ledger-v21 ana zinciri (son REVOKE yok)', (t) => {
  t.alike(F.zincir, ZINCIR)
})

test('vektörler: afet maddeleri yeniden hesaplanır', (t) => {
  for (const m of F.maddeler) t.alike(JSON.parse(JSON.stringify(calistir(m))), m.beklenen, m.no + ': ' + m.aciklama)
})
