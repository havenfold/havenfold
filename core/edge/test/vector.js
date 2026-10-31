// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// protocol/vectors/edge.json (RFC-0008 §14, vektörler 1–9): her madde dosyadaki girdilerden yeniden hesaplanır.
const test = require('brittle')
const F = require('../../../protocol/vectors/edge.json')
const { vektorler, calistir } = require('./helpers/edge-vector')

test('vektörler: edge.json üretici aynı dosyayı verir (belirlenimci)', (t) => {
  t.alike(JSON.parse(JSON.stringify(vektorler())), F)
})

test('vektörler: uç maddeleri yeniden hesaplanır', (t) => {
  t.alike(F.maddeler.map((m) => m.no), [1, 2, 3, 4, 5, 6, 7, 8, 9])
  for (const m of F.maddeler) t.alike(JSON.parse(JSON.stringify(calistir(m))), m.beklenen, m.no + ': ' + m.aciklama)
})
