// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D23 (28): modeli olmayan telefonda da kademeli kriz sınırı "Yardım" önerisiyle döner (RFC-0024 §5 c)
const test = require('brittle')
const { krizAnlam: { KrizAnlam }, asistan: { Asistan } } = require('..')
const { sahteGom } = require('./helpers/fake-embedding')

const ORNEK = 'artık var olmak istemiyorum'
const UZAK = 'bugün hava çok güzel parka gidelim'

test('(28) cihazda model yokken de sınırda yardimOner; sınır yoksa yok; hata cevabı korunur', async (t) => {
  const s = () => new Asistan({
    yetenek: { platform: null, isciler: [], bulut: { acik: false } },
    krizAnlam: new KrizAnlam({ gom: sahteGom, esik: { esik: 1.01, fark: 0, k: 1 }, dusuk: { esik: 0.5, fark: 0, k: 1 } }),
    model: async () => { throw new Error('çağrılmamalı') }
  })
  const c = await s().sor({ metin: ORNEK })
  t.is(c.hata, 'NO_ELIGIBLE_DEVICE')
  t.alike([c.yardimOner, c.yardimSatiri], [true, 'Zor bir şey mi yaşıyorsun?'])
  t.absent(c.kriz)
  const n = await s().sor({ metin: UZAK })
  t.is(n.hata, 'NO_ELIGIBLE_DEVICE')
  t.is(n.yardimOner, undefined)
})
