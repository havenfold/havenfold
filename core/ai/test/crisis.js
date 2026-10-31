// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// İnceleme 8: kriz listesi (core/ai/crisis-list.json). Çalışma setinde ve dell'in ayrı cümlelerinde yakalama ≥ %95,
// yanlış alarm ≤ %5. Oranlar çıktıya yazılır. Çalışma seti protocol/vectors/crisis-set.json (Yuva Defteri'ndekiyle aynı).
const test = require('brittle')
const SET = require('../../../protocol/vectors/crisis-set.json')
const EK = require('./helpers/crisis-extra.json')
const LISTE = require('../crisis-list.json')
const { cocuk: k } = require('..')

function oran (t, ad, s) {
  const yakalanan = s.kriz.filter((x) => k.krizMi(x)).length
  const yanlis = s.zararsiz.filter((x) => k.krizMi(x)).length
  t.comment(`${ad}: kriz ${yakalanan}/${s.kriz.length} (%${Math.round((100 * yakalanan) / s.kriz.length)}), yanlış alarm ${yanlis}/${s.zararsiz.length} (%${Math.round((100 * yanlis) / s.zararsiz.length)})`)
  t.ok(yakalanan * 100 >= 95 * s.kriz.length, ad + ': yakalama ≥ %95')
  t.ok(yanlis * 100 <= 5 * s.zararsiz.length, ad + ': yanlış alarm ≤ %5')
}

test('kriz listesi: sürüm ve biçim', (t) => {
  t.ok(Number.isSafeInteger(LISTE.surum) && LISTE.surum >= 1)
  t.is(k.KRIZ_SURUM, LISTE.surum)
  t.ok(LISTE.kumeler.every((x) => typeof x.ad === 'string' && x.kaliplar.length > 0))
})

test('kriz oranları: çalışma seti', (t) => oran(t, 'çalışma seti', SET))
test('kriz oranları: dell\'in ayrı cümleleri', (t) => oran(t, 'dell ek', EK))

test('Lenovo\'nun eksik bulduğu örnekler', (t) => {
  for (const m of ['kendimi bırakmak istiyorum', 'silah bulsam kendimi vururum', 'hap sayısını hesapladım', 'beni soyunmaya zorladılar', 'abimden korkuyorum beni dövüyor', 'pipimi tuttu', 'beni kucağına oturtup elledi']) t.ok(k.krizMi(m), m)
  for (const m of ['kendimi kaybettim konserde', 'öldürücü gol', 'kafayı kırdım fıkraya', 'dövme dükkânı']) t.absent(k.krizMi(m), m)
})

test('katlama: yazım hatası ve yinelenen harf', (t) => {
  t.is(k.katla('ÖLMEEEK İstiyom'), 'olmek istiyom')
  t.ok(k.krizMi('olmeeek istiyommm'))
  t.alike(k.krizKumeleri('gülmekten öldüm'), [])
  t.is(k.TASLAK, 'Konuşmam lazım, müsait misin?')
})

test('D14: kural listesinin bağlam dışlamaları (deyim, abartma, anlatım, şaka, kaza) gerçek krizi susturmaz', (t) => {
  for (const m of ['bu bulmaca beni öldürecek ama çözeceğim', 'ödevimi yapmadım annem beni öldürecek', 'intihar oranları hakkında sosyoloji ödevi', 'filmde tecavüz sahnesi vardı kapattım', 'yastıkla kafama vurdu çok güldük', 'dağ bisikletinde düştüm kolum çizildi', 'kendimi aşmak için koşuyorum', 'bu ders bitmezse öleceğim sıkıntıdan']) t.absent(k.krizMi(m), m)
  for (const m of ['beni öldürecek diye korktum', 'babam beni öldürecek', 'kendimi asmak için ip aldım', 'öğretmenim derste bana dokundu', 'okulda bana şaka diye vuruyorlar her gün']) t.ok(k.krizMi(m), m)
})
