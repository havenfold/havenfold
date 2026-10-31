// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Adım 1: N, tetik, tarih ve rakam çözücüleri, engel süzgeci, güven ve kural tabanlı çıkarma (RFC-0013 §19 4–8).
// Beklenen değerler elle yazılmıştır.
const test = require('brittle')
const { metin: { N, tokenTahmini }, cozucu: cz, engel: { engel, sinifBelirle, enSiki }, asistan: { tetik }, cikarma: c } = require('..')

const IBAN = 'TR33 0006 1005 1978 6457 8413 26'

test('vektör 5: N', (t) => {
  t.is(N('İSTANBUL  Kombi Servisi'), 'istanbul kombi servisi')
  t.is(N('IŞIK'), 'ışık')
  t.is(N('Ali’nin'), 'alinin')
  t.is(N('  “Kombi”\t\n servisi '), 'kombi servisi')
  t.is(N('ﬁ'), 'fi', 'NFKC')
  t.is(N('i̇'), 'i', 'birleşen nokta silinir')
  t.is(tokenTahmini('abc'), 1)
  t.is(tokenTahmini('abcd'), 2)
  t.is(tokenTahmini('ş'), 1, '2 bayt')
  t.is(tokenTahmini(''), 0)
})

test('vektör 4: tetik', (t) => {
  t.alike(tetik('@asistan wifi şifresi'), { soru: 'wifi şifresi' })
  t.alike(tetik('  @Asistan: kombi'), { soru: 'kombi' })
  t.alike(tetik('@ASİSTAN ne var'), { soru: 'ne var' })
  t.is(tetik('@asistanlar'), null)
  t.alike(tetik('@YUVA', { takma: 'yuva' }), { soru: '' })
  t.is(tetik('@YUVA'), null, 'takma ad verilmeden yuva tetiklemez')
  t.alike(tetik('@asistan,bak'), { soru: 'bak' })
  t.is(tetik('merhaba @asistan'), null, 'başta değil')
  t.is(tetik('@yuvacik', { takma: 'yuva' }), null)
})

test('vektör 6: tarih çözücü', (t) => {
  const d = (s) => cz.tarihler(s).map((x) => x.deger)
  t.alike(d('14 Mart 2028'), ['2028-03-14'])
  t.alike(d('14.03.2028'), ['2028-03-14'])
  t.alike(d('14/3/28'), [])
  t.alike(d('3 eyl 2027'), ['2027-09-03'])
  t.alike(d('2028-03-14'), ['2028-03-14'])
  t.alike(d('14-03-2028'), ['2028-03-14'])
  t.alike(d('1 Şubat 2029 ile 29 şub 2028'), ['2029-02-01', '2028-02-29'])
  t.alike(d('29.02.2027'), [], 'artık yıl değil')
  t.alike(d('31 nisan 2028'), [])
  t.alike(d('14.03/2028'), [], 'ayırıcılar aynı olmalı')
  t.alike(d('5 ARALIK 2026 ve 6 ara. 2026'), ['2026-12-05', '2026-12-06'])
  t.alike(d('3 marto 2027'), [], 'ay adı tam kelime')
  t.alike(cz.tarihler('Bitiş: 14.03.2028'), [{ deger: '2028-03-14', bas: 7, bit: 17 }])
  t.alike(cz.saatler('saat 9:05 ile 14:30, 24:00 değil').map((x) => x.deger), ['09:05', '14:30'])
})

test('rakam çözücüleri', (t) => {
  t.ok(cz.tcknGecerli('10000000146'))
  t.absent(cz.tcknGecerli('10000000147'))
  t.absent(cz.tcknGecerli('00000000146'))
  t.ok(cz.ibanGecerli('TR330006100519786457841326'))
  t.absent(cz.ibanGecerli('TR330006100519786457841327'))
  t.alike(cz.ibanlar('IBAN: ' + IBAN).map((x) => x.deger), ['TR330006100519786457841326'])
  t.ok(cz.luhn('4111111111111111'))
  t.absent(cz.luhn('4111111111111112'))
  t.alike(cz.kartlar('kart 4111 1111 1111 1111').map((x) => x.deger), ['4111111111111111'])
  t.alike(cz.telefonlar('0532 123 45 67').map((x) => x.deger), ['+905321234567'])
  t.alike(cz.telefonlar('+90 532 123-45-67').map((x) => x.deger), ['+905321234567'])
  t.alike(cz.telefonlar('5321234567').map((x) => x.deger), ['+905321234567'])
  t.alike(cz.telefonlar('10000000146').map((x) => x.deger), [])
  t.alike(cz.epostalar('yaz: Ali.Veli@Ornek.com.tr').map((x) => x.deger), ['ali.veli@ornek.com.tr'])
  t.alike(cz.tutarlar('1.250,50 TL ödendi, 3 adet').map((x) => [x.deger, x.birim]), [[125050, 'TRY'], [300, null]])
  t.alike(cz.tutarlar('1250 ₺').map((x) => x.deger), [125000])
  const r = cz.rakamDizileri('Model 2024 1250 TL, tel 0532-123')
  t.ok(r.has('20241250'))
  t.ok(r.has('1250'))
  t.ok(r.has('0532123'))
  t.absent(r.has('125'))
  t.ok(cz.plakaVar('araba 34 ABC 123'))
  t.ok(cz.plakaVar('06a1234'))
  t.absent(cz.plakaVar('Kombi E1 hatası'))
  t.ok(cz.adresVar('Gül Sok. No:5'))
  t.ok(cz.adresVar('Atatürk caddesi 12'))
  t.absent(cz.adresVar('vergi dairesi 2 gün'), 'daire tam kelime')
  t.absent(cz.adresVar('Bağdat Caddesinde'))
})

test('vektör 8: engel süzgeci', (t) => {
  t.alike(engel('10000000146 nedir'), ['tckn'])
  t.alike(engel(IBAN), ['iban'])
  t.alike(engel('Kombi E1 hatası ne demek'), [])
  t.alike(engel('Coki neden kusar', { adlar: ['Coki'] }), ['ad'])
  t.alike(engel('0532 123 45 67'), ['telefon'])
  t.alike(engel('Coki neden kusar'), [], 'ad defterde değilse geçer')
  t.alike(engel("Coki'nin maması", { adlar: ['Coki'] }), ['ad'], 'kesmeden sonraki ek')
  t.alike(engel('cokilerin', { adlar: ['Coki'] }), ['ad'], 'kelime başı (RFC-0023 §2 c)')
  t.alike(engel('Ev nerede', { adlar: ['Ev', 'Al Ka'] }), [], '3 harften kısa parça atlanır')
  t.alike(engel('AYŞE hanım geldi', { adlar: ['Ayşe Yılmaz'] }), ['ad'], 'ad parçası')
  t.alike(engel('ali@ornek.com yaz'), ['eposta'])
  t.alike(engel('4111 1111 1111 1111'), ['kart'])
  t.alike(engel('Gül Sok. No:5'), ['adres'])
  t.alike(engel('34 ABC 123 kimin'), ['plaka'])
  t.alike(engel('a'.repeat(1024)), [])
  t.alike(engel('a'.repeat(1025)), ['uzun'])
  t.is(sinifBelirle('Kombi E1 hatası ne demek'), 'genel')
  t.is(sinifBelirle('Kombi E1 hatası ne demek', { bagli: true }), 'aile')
  t.is(sinifBelirle('0532 123 45 67'), 'aile')
  t.is(sinifBelirle('ne demek', { kaynaklar: ['aile', 'kasa'] }), 'kasa')
  t.is(enSiki('genel', 'aile'), 'aile')
})

const SEMA = {
  id: 'test.odeme',
  v: 1,
  hedef: 'test.odeme',
  alanlar: [
    { ad: 'alici', tur: 'metin', zorunlu: true, dayanak: 'alinti' },
    { ad: 'iban', tur: 'iban', zorunlu: false, dayanak: 'alinti' },
    { ad: 'son', tur: 'tarih', zorunlu: false, dayanak: 'alinti' },
    { ad: 'tutar', tur: 'tutar', zorunlu: false, dayanak: 'alinti' },
    { ad: 'gun', tur: 'sayi', zorunlu: false, dayanak: 'cikarim' }
  ]
}
const KAYNAK = 'Alıcı: Kombi Servisi. IBAN ' + IBAN + '. Son ödeme 14.03.2028, tutar 1.250,50 TL.'
const SRC = ['msg:' + 'ab'.repeat(32) + '/' + 'cd'.repeat(16)]

test('vektör 7: güven tablosu', (t) => {
  t.is(c.guven({ dayanak: 'alinti', yol: 'telefon', bulundu: true }), 85)
  t.is(c.guven({ dayanak: 'alinti', yol: 'isci', bulundu: true }), 85)
  t.is(c.guven({ dayanak: 'alinti', yol: 'kural', bulundu: true }), 90)
  t.is(c.guven({ dayanak: 'alinti', yol: 'kural', bulundu: true, denetimHanesi: true }), 95)
  t.is(c.guven({ dayanak: 'alinti', yol: 'telefon', bulundu: false }), 40)
  t.is(c.guven({ dayanak: 'cikarim', yol: 'telefon' }), 60)
  t.is(c.guven({ dayanak: 'cikarim', yol: 'kural' }), 70)
  t.is(c.ikisiAyni(85, 90), 100)
  t.is(c.ikisiAyni(60, 70), 80)
  t.exception(() => c.guven({ dayanak: 'alinti', yol: 'bulut', bulundu: true }), /INVALID_PATH/)
})

test('vektör 7: model çıktısının denetimi, kural motoru ve birleşim', (t) => {
  const ham = { alici: 'Kombi servisi', iban: 'TR330006100519786457841326', son: '2028-03-15', tutar: 125050, gun: 30, fazla: 'x' }
  const m = c.denetle(SEMA, ham, KAYNAK, { yol: 'telefon', model: 'telefon/apple-fm@26.1', kaynak: SRC })
  t.is(m.sema, 'test.odeme@1')
  t.alike(m.alanlar, [
    { ad: 'alici', deger: 'Kombi servisi', conf: 85 },
    { ad: 'iban', deger: 'TR330006100519786457841326', conf: 85 },
    { ad: 'son', deger: '2028-03-15', conf: 40 }, // kaynakta 14.03.2028 var, 15 yok
    { ad: 'tutar', deger: 125050, conf: 85 },
    { ad: 'gun', deger: 30, conf: 60 }
  ], 'şemada olmayan alan atıldı')
  const bozuk = c.denetle(SEMA, { alici: '', iban: 'TR330006100519786457841327', son: '2028-02-30', tutar: -1 }, KAYNAK, { yol: 'isci', model: 'isci/qwen3-4b' })
  t.alike(bozuk.alanlar, [], 'çözülemeyen değerler atıldı')

  const k = c.kuralCikar(SEMA, KAYNAK, { kaynak: SRC, hesap: { gun: () => 30 } })
  t.is(k.model, 'kural/1')
  t.alike(k.alanlar.map((x) => [x.ad, x.deger, x.conf]), [
    ['iban', 'TR330006100519786457841326', 95],
    ['son', '2028-03-14', 90],
    ['tutar', 125050, 90],
    ['gun', 30, 70]
  ], 'metin türü kuralla çıkarılmaz')

  const b = c.birlestir(SEMA, m, k)
  t.alike(b.alanlar.map((x) => [x.ad, x.deger, x.conf]), [
    ['alici', 'Kombi servisi', 85],
    ['iban', 'TR330006100519786457841326', 100],
    ['son', '2028-03-14', 90], // farklı değer: güveni yüksek olan
    ['tutar', 125050, 100],
    ['gun', 30, 80] // cikarim: model 60, kural 70, aynı değer
  ])
})

test('vektör 7: onay ekranı, jeton, _conf ve _ai', (t) => {
  let an = 1_000_000
  const ekran = new c.OnayEkrani({ simdi: () => an })
  const cik = {
    sema: 'test.odeme@1',
    alanlar: [
      { ad: 'alici', deger: 'Kombi servisi', conf: 85 },
      { ad: 'iban', deger: 'TR330006100519786457841326', conf: 95 },
      { ad: 'son', deger: '2028-03-15', conf: 40 },
      { ad: 'tutar', deger: 125050, conf: 60 }
    ],
    kaynak: SRC,
    model: 'telefon/apple-fm@26.1'
  }
  const g = ekran.goster(SEMA, cik)
  t.alike(g.alanlar.map((x) => [x.ad, x.deger, x.isaret]), [
    ['alici', 'Kombi servisi', null],
    ['iban', 'TR330006100519786457841326', null],
    ['son', null, 'bos'], // conf < 50: boş gelir
    ['tutar', 125050, 'sari'], // 50–79: sarı
    ['gun', null, 'bos']
  ])
  // Kullanıcı tutarı düzeltti, son tarihi elle yazdı
  const son = { alici: 'Kombi servisi', iban: 'TR330006100519786457841326', son: '2028-03-14', tutar: 120000 }
  const j = ekran.kaydetDokunusu(g.id, son)
  t.exception(() => ekran.tuket('00'.repeat(32), cik, son), /NO_APPROVAL/)
  const kayit = ekran.tuket(j, cik, son)
  t.is(kayit.type, 'test.odeme')
  t.alike(kayit.fields, {
    alici: 'Kombi servisi',
    iban: 'TR330006100519786457841326',
    son: '2028-03-14',
    tutar: 120000,
    _src: SRC,
    _conf: 85, // değiştirilmeyen alici (85) ve iban (95) arasında en küçüğü
    _ai: ['alici', 'iban'],
    _aiyol: 'telefon/apple-fm@26.1'
  })
  t.exception(() => ekran.tuket(j, cik, son), /NO_APPROVAL/, 'tek kullanımlık')

  // Hepsi elle değiştirildi → _conf ve _ai yazılmaz
  const g2 = ekran.goster(SEMA, cik)
  const son2 = { alici: 'Başka', tutar: 1 }
  const j2 = ekran.kaydetDokunusu(g2.id, son2)
  t.alike(ekran.tuket(j2, cik, son2).fields, { alici: 'Başka', tutar: 1, _src: SRC, _aiyol: 'telefon/apple-fm@26.1' })

  // Jeton ekrandaki içeriğe bağlı
  const g3 = ekran.goster(SEMA, cik)
  const j3 = ekran.kaydetDokunusu(g3.id, son)
  t.exception(() => ekran.tuket(j3, cik, { ...son, tutar: 999 }), /APPROVAL_MISMATCH/)
  const g4 = ekran.goster(SEMA, cik)
  const j4 = ekran.kaydetDokunusu(g4.id, son)
  an += 10 * 60_000 + 1
  t.exception(() => ekran.tuket(j4, cik, son), /APPROVAL_EXPIRED/)

  const g5 = ekran.goster(SEMA, cik)
  t.exception(() => ekran.kaydetDokunusu(g5.id, { iban: 'TR330006100519786457841326' }), /NO_REQUIRED_FIELD/)
  t.exception(() => ekran.kaydetDokunusu(g5.id, { alici: 'x', fazla: 1 }), /INVALID_FIELD/)
  const j5 = ekran.kaydetDokunusu(g5.id, son)
  t.exception(() => ekran.tuket(j5, cik, son, { koleksiyon: { sensitivity: 'normal', kind: 'genel' }, kasaKaynakli: true }), /VAULT_SOURCE/)
  t.exception(() => c.ekranAlanlari(SEMA, cik, { bos: 40 }), /THRESHOLD_TOO_LOW/)
})
