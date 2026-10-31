// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D19: şema kimliğinde alt çizgi (18), liste ve zaman türleri (19), kural motorunda aynı türün sıralı adayları (21).
// Beklenen değerler elle yazılmıştır.
const test = require('brittle')
const { cikarma: c } = require('..')

const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const KISI = 'uye:' + 'ab'.repeat(16)

const SEMA = {
  id: 'yuva.defter.ev_cihazi',
  v: 1,
  hedef: 'yuva.defter.ev_cihazi',
  alanlar: [
    { ad: 'baslangic', tur: 'tarih', zorunlu: false, dayanak: 'alinti' },
    { ad: 'bitis', tur: 'tarih', zorunlu: false, dayanak: 'alinti' },
    { ad: 'telefonlar', tur: 'liste', oge: 'telefon', zorunlu: false, dayanak: 'alinti' },
    { ad: 'kimler', tur: 'liste', oge: 'kisi', zorunlu: false, dayanak: 'alinti' },
    { ad: 'zaman', tur: 'zaman', zorunlu: false, dayanak: 'alinti' }
  ]
}

test('(18) şema kimliğinde alt çizgi', (t) => {
  t.is(c.semaDogrula(SEMA), SEMA)
  t.is(hataOf(() => c.semaDogrula({ ...SEMA, id: '_yuva' })), 'INVALID_SCHEMA', 'ilk karakter harf ya da rakam')
  t.is(hataOf(() => c.semaDogrula({ ...SEMA, id: 'Yuva.x' })), 'INVALID_SCHEMA')
})

test('(19) liste ve zaman şemada', (t) => {
  t.is(hataOf(() => c.semaDogrula({ ...SEMA, alanlar: [{ ad: 'x', tur: 'liste', zorunlu: false, dayanak: 'alinti' }] })), 'INVALID_SCHEMA', 'öğe türü zorunlu')
  t.is(hataOf(() => c.semaDogrula({ ...SEMA, alanlar: [{ ad: 'x', tur: 'liste', oge: 'liste', zorunlu: false, dayanak: 'alinti' }] })), 'INVALID_SCHEMA', 'iç içe liste yok')
  t.is(hataOf(() => c.semaDogrula({ ...SEMA, alanlar: [{ ad: 'x', tur: 'liste', oge: 'secim', zorunlu: false, dayanak: 'alinti' }] })), 'INVALID_SCHEMA', 'seçim öğesi seçenek ister')
  t.ok(c.semaDogrula({ ...SEMA, alanlar: [{ ad: 'gunler', tur: 'liste', oge: 'secim', secenekler: ['pzt', 'sal'], zorunlu: false, dayanak: 'alinti' }] }))
})

test('(19) liste değeri: her öğe öğe türünde; çözülemeyen öğe listeyi düşürür; tekrar bir kez', (t) => {
  const tel = SEMA.alanlar[2]
  t.alike(c.degerCoz(tel, ['+905321112233', '+905321112233', '+902124445566']), ['+905321112233', '+902124445566'])
  t.is(c.degerCoz(tel, ['+905321112233', '0532']), null)
  t.is(c.degerCoz(tel, []), null)
  t.is(c.degerCoz(tel, '+905321112233'), null, 'tek değer liste değil')
  t.is(c.degerCoz(tel, new Array(33).fill('+905321112233')), null, 'en çok 32 öğe')
  t.alike(c.degerCoz(SEMA.alanlar[3], [KISI], { kisiler: new Map([[KISI, 'Maya']]) }), [KISI])
})

test('(19) zaman: ms tamsayı; dayanak metindeki tarih ve saatin Türkiye saatiyle karşılığı', (t) => {
  const z = SEMA.alanlar[4]
  const ms = Date.UTC(2027, 2, 14, 12, 30) // 14.03.2027 15:30 (UTC+3)
  t.is(c.degerCoz(z, ms), ms)
  t.is(c.degerCoz(z, -1), null)
  t.is(c.degerCoz(z, '2027-03-14'), null)
  t.ok(c.dayanakVar(z, ms, 'Toplantı 14.03.2027 saat 15:30'))
  t.absent(c.dayanakVar(z, ms, 'Toplantı 14.03.2027 saat 16:30'))
  t.absent(c.dayanakVar(z, ms, 'Saat 15:30, tarih 14.03.2027'), 'saat tarihten sonra gelmeli')
})

test('(21) kural motoru: aynı türdeki i. alan i. adayı alır; liste bütün adayları; zaman tarih + saat', (t) => {
  const metin = 'Başlangıç 01.01.2026 bitiş 31.12.2027. Servis 0532 111 22 33 ya da 0212 444 55 66. Kurulum 05.01.2026 10:00'
  const r = c.kuralCikar(SEMA, metin)
  const d = Object.fromEntries(r.alanlar.map((x) => [x.ad, x.deger]))
  t.is(d.baslangic, '2026-01-01')
  t.is(d.bitis, '2027-12-31')
  t.alike(d.telefonlar, ['+905321112233', '+902124445566'])
  t.is(d.zaman, Date.UTC(2026, 0, 5, 7, 0))
  t.is(d.kimler, undefined, 'defterde kişi yok')
  const tek = c.kuralCikar(SEMA, 'Bitiş 31.12.2027')
  t.alike(tek.alanlar.map((x) => [x.ad, x.deger]), [['bitis', '2027-12-31']], 'tek tarih "bitiş" sözcüğüyle bitiş alanına (D32; önce ilk tarih alanına gidiyordu)')
})

test('(19) liste onay ekranından kayda: değişmeyen liste yapay zeka alanı sayılır', (t) => {
  const cikarim = { sema: 'yuva.defter.ev_cihazi@1', alanlar: [{ ad: 'telefonlar', deger: ['+905321112233'], conf: 90 }, { ad: 'kimler', deger: [KISI], conf: 90 }], kaynak: [], model: 'kural/1' }
  const g = c.ekranAlanlari(SEMA, cikarim)
  const son = c.sonDogrula(SEMA, { telefonlar: ['+905321112233'], kimler: [KISI, KISI] })
  t.alike(son, { telefonlar: ['+905321112233'], kimler: [KISI] })
  const f = c.kayitAlanlari(SEMA, cikarim, g, son)
  t.alike(f._ai, ['telefonlar', 'kimler'])
  t.is(hataOf(() => c.sonDogrula(SEMA, { kimler: ['ali'] })), 'INVALID_FIELD')
})

test('D32 (L13 uyum): tek tarihli belgede "geçerlilik", "son", "bitiş" sözcüğünün yanındaki tarih bitiş alanına', (t) => {
  const BELGE = { id: 'yuva.defter.belge', v: 1, hedef: 'yuva.defter.belge', alanlar: [
    { ad: 'baslangic', tur: 'tarih', zorunlu: false, dayanak: 'alinti' },
    { ad: 'bitis', tur: 'tarih', zorunlu: false, dayanak: 'alinti' }
  ] }
  const d = (m) => Object.fromEntries(c.kuralCikar(BELGE, m).alanlar.map((x) => [x.ad, x.deger]))
  t.alike(d('Pasaport geçerlilik 14.03.2030'), { bitis: '2030-03-14' })
  t.alike(d('Poliçe son gün: 01.09.2027'), { bitis: '2027-09-01' })
  t.alike(d('Bitiş tarihi 31.12.2026'), { bitis: '2026-12-31' })
  t.alike(d('Düzenleme tarihi 05.01.2026'), { baslangic: '2026-01-05' })
  t.alike(d('Belge 05.01.2026'), { baslangic: '2026-01-05' }, 'sözcük yoksa sırayla')
  t.alike(d('Başlangıç 01.01.2026 bitiş 31.12.2027'), { baslangic: '2026-01-01', bitis: '2027-12-31' }, 'yeterli adayda sırayla')
})
