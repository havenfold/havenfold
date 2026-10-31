// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// protocol/vectors/ai-v2.json (D16): üretici aynı dosyayı verir; kademeli sonuç elle yazılmış beklenenlerle
const test = require('brittle')
const F = require('../../../protocol/vectors/ai-v2.json')
const F1 = require('../../../protocol/vectors/ai.json')
const { vektorlerV2 } = require('./helpers/ai-vector')
const { krizAnlam: { KrizAnlam }, cocuk: k } = require('..')
const { sahteGom } = require('./helpers/fake-embedding')

test('ai-v2.json üretici aynı dosyayı verir; ai.json içeriği aynen içinde', async (t) => {
  t.alike(JSON.parse(JSON.stringify(await vektorlerV2())), F)
  for (const n of ['3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '16']) t.alike(F[n], F1[n], 'vektör ' + n)
})

test('vektör 14 kademe: elle yazılmış beklenenler ve dosyadan yeniden hesap', async (t) => {
  const kd = F[14].kademe
  t.alike(kd.durumlar.map((x) => x.duzey), ['tam', 'sinir', null])
  t.alike(kd.sinirCevabi, { modelCagrilir: true, yardimOner: true, yardimSatiri: 'Zor bir şey mi yaşıyorsun?', gecmiseSinirYazilir: false })
  const katman = new KrizAnlam({ gom: sahteGom, esik: kd.yuksek, dusuk: kd.dusuk })
  for (const d of kd.durumlar) t.is(k.krizDuzeyi(d.metin, { anlam: await katman.skor(d.metin) }), d.duzey, d.metin)
})
