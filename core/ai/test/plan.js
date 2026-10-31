// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Sohbetten Plana (RFC-0013 §7.7, D19 20). Beklenen değerler elle yazılmıştır: mesaj 23 Ekim 2026 cuma 12:00 (TR).
const test = require('brittle')
const { plan: P } = require('..')

const AT = Date.UTC(2026, 9, 23, 9, 0)
const MAYA = 'uye:' + '11'.repeat(16)
const ALI = 'uye:' + '22'.repeat(16)
const KISILER = new Map([[MAYA, 'Maya'], [ALI, 'Ali']])
const ETKINLIK = { id: 'yuva.defter.etkinlik', v: 1, hedef: 'yuva.defter.etkinlik', alanlar: [
  { ad: 'baslik', tur: 'metin', zorunlu: true, dayanak: 'cikarim' },
  { ad: 'tarih', tur: 'tarih', zorunlu: false, dayanak: 'alinti' },
  { ad: 'saat', tur: 'saat', zorunlu: false, dayanak: 'alinti' },
  { ad: 'baslangic', tur: 'zaman', zorunlu: false, dayanak: 'alinti' },
  { ad: 'kimler', tur: 'liste', oge: 'kisi', zorunlu: false, dayanak: 'alinti' }
] }
const YAPILACAK = { id: 'yuva.defter.yapilacak', v: 1, hedef: 'yuva.defter.yapilacak', alanlar: [
  { ad: 'baslik', tur: 'metin', zorunlu: true, dayanak: 'cikarim' },
  { ad: 'tarih', tur: 'tarih', zorunlu: false, dayanak: 'alinti' },
  { ad: 'sorumlu', tur: 'kisi', zorunlu: false, dayanak: 'cikarim' }
] }
const S = { etkinlik: ETKINLIK, yapilacak: YAPILACAK }
const cik = (metin, ek = {}) => P.planCikar(metin, { at: AT, kaynak: ['msg:' + 'aa'.repeat(16)], kisiler: KISILER, semalar: S, ...ek })
const alanlar = (r) => Object.fromEntries(r.cikarim.alanlar.map((x) => [x.ad, [x.deger, x.conf]]))

test('ön süzgeç: tarih, saat, gün adı, göreli ifade yoksa kart yok', (t) => {
  t.is(cik('Merhaba nasılsın'), null)
  t.is(cik('Ekmek bitti'), null)
  t.ok(P.onSuzgec('yarın gelirim'))
  t.ok(P.onSuzgec('cumaya bakarız'))
  t.ok(P.onSuzgec('saat 15:30'))
})

test('göreli gün kaynak mesajın gününe göre ve çıkarım (70); metindeki saat alıntı (90)', (t) => {
  const r = cik("Yarın 15:00'te dişçi")
  t.is(r.tur, 'etkinlik')
  t.is(r.sema, 'yuva.defter.etkinlik@1')
  t.alike(alanlar(r), {
    baslik: ['Dişçi', 70],
    tarih: ['2026-10-24', 70],
    saat: ['15:00', 90],
    baslangic: [Date.UTC(2026, 9, 24, 12, 0), 70]
  })
  t.alike(r.cikarim.kaynak, ['msg:' + 'aa'.repeat(16)])
  t.is(r.cikarim.model, 'kural/1')
})

test('gün adları: bugün o günse gelecek hafta; "haftaya X" gelecek haftanın X\'i; öbür gün', (t) => {
  t.is(alanlar(cik("Cuma Maya'yla sinema")).tarih[0], '2026-10-30')
  t.is(alanlar(cik('Pazar kahvaltı')).tarih[0], '2026-10-25')
  t.is(alanlar(cik('Haftaya salı faturayı unutma')).tarih[0], '2026-10-27')
  t.is(alanlar(cik('Haftaya pazar piknik')).tarih[0], '2026-11-01')
  t.is(alanlar(cik('Öbür gün kurs')).tarih[0], '2026-10-25')
  t.is(alanlar(cik('Bugün akşam yemek')).tarih[0], '2026-10-23')
  // Gece yarısından sonra (TR): 24 Ekim cumartesi 01:00 = 23 Ekim 22:00 UTC
  t.is(alanlar(P.planCikar('yarın kurs', { at: Date.UTC(2026, 9, 23, 22, 0), semalar: S })).tarih[0], '2026-10-25')
})

test('metinde yazan tarih ve saat alıntı; başlangıç zaman damgası', (t) => {
  const r = cik('14.11.2026 saat 10:30 veli toplantısı')
  t.alike(alanlar(r), {
    baslik: ['Veli toplantısı', 70],
    tarih: ['2026-11-14', 90],
    saat: ['10:30', 90],
    baslangic: [Date.UTC(2026, 10, 14, 7, 30), 90]
  })
})

test('plan türü, sorumlu ve kimler', (t) => {
  const a = cik('Haftaya salı faturayı unutma')
  t.is(a.tur, 'yapilacak', 'saat yok, yapılacak sözü var')
  t.is(a.sema, 'yuva.defter.yapilacak@1')
  const b = cik('Maya ekmek alsın yarın')
  t.is(b.tur, 'yapilacak')
  t.alike(alanlar(b).sorumlu, [MAYA, 70])
  const c = cik("Cuma Maya'yla ve Ali ile sinema 20:00")
  t.is(c.tur, 'etkinlik')
  t.alike(alanlar(c).kimler, [[MAYA, ALI], 90])
  const d = P.planCikar('Yarın ben alırım ekmeği, unutma', { at: AT, kisiler: KISILER, yazar: ALI, semalar: S })
  t.alike(alanlar(d).sorumlu, [ALI, 70], '"ben …ırım" mesajın yazarı')
})
