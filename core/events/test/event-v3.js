// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// protocol/vectors/event-v3.json (RFC-0032 §8): biçim 2 kural. Her madde dosyadaki girdilerden yeniden hesaplanır;
// beklenen değerler üretimde RFC'nin sayılarıyla denetlendi.
const test = require('brittle')
const F = require('../../../protocol/vectors/event-v3.json')
const { vektorler, calistir } = require('./helpers/event-v3-vector')
const O = require('./helpers/event')

test('vektörler: event-v3.json üretici aynı dosyayı verir (belirlenimci)', (t) => {
  t.alike(JSON.parse(JSON.stringify(vektorler())), F)
})

test('vektörler: olay-v3 zinciri olay vektörleriyle aynı; RFC-0032 §8\'in 13 maddesi', (t) => {
  t.alike(F.zincir, O.ZINCIR)
  t.alike([...new Set(F.maddeler.map((m) => m.no))], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])
})

test('vektörler: olay-v3 maddeleri yeniden hesaplanır', (t) => {
  for (const m of F.maddeler) t.alike(JSON.parse(JSON.stringify(calistir(m))), m.beklenen, m.no + ': ' + m.aciklama)
})
