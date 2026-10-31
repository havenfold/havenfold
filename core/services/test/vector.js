// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// protocol/vectors/service.json (RFC-0010 §17, vektörler 1–8, 11–14): her madde dosyadaki girdilerden yeniden hesaplanır.
const test = require('brittle')
const F = require('../../../protocol/vectors/service.json')
const { vektorler, calistir } = require('./helpers/service-vector')

test('vektörler: service.json üretici aynı dosyayı verir (belirlenimci)', (t) => {
  t.alike(JSON.parse(JSON.stringify(vektorler())), F)
})

test('vektörler: hizmet maddeleri yeniden hesaplanır', (t) => {
  t.alike(F.maddeler.map((m) => m.no), [1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 13, 14])
  for (const m of F.maddeler) t.alike(JSON.parse(JSON.stringify(calistir(m))), m.beklenen, m.no + ': ' + m.aciklama)
})
