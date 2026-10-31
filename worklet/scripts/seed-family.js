// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// seed-family.js — tanıtım ailesinin verisi (D35): Rivera ailesi (uydurma), Cuma 23 Ekim 2026.
//
// Kayıtların düzeni Yuva Defteri'nin taklit çekirdeğindeki örnek veriden (kapalı ürün deposundaki örnek veri
// dosyası) elle aktarıldı. Açılış öncesi (25 Ekim 2026) kişiler, adresler, telefonlar,
// sağlık, okul ve kasa değerleri açıkça uydurma değerlerle değiştirildi; veri artık o dosyadakiyle aynı değildir.
// Telefonlar kurgu için ayrılmış +1 555 01xx aralığındandır; adresler ve kurumlar yoktur.
// Kimlikler gerçek çekirdekte üretildiği için sabit kimlik yoktur; başvurular sembolik yazılır ve seed.js kurulumda çözer:
//   '@kisi:<ad>'          → 'uye:<kişi kimliği>' (alex, maya, lina, rosa)
//   '@kayit:<kol>/<ad>'   → 'kayit:<collectionId>/<recordId>' (kol: tumAile, ebeveynler, kasa, saglik, kisisel:<kişi>)
//   '@dosya:<ad>'         → BlobRef (DOSYALAR'dan; içerik küçük yer tutucudur)
//   '@zaman:<gün> <saat>' → ms (Türkiye saati)
// Yapay zeka alanları (_src, _ai, _aiyol, _conf) ve asistan konuşmaları alınmadı: onlar onay jetonuyla yazılır (AiApi).
// Bakıcı (misafir) ve Salon PC (işçi) yok: misafir ve işçi töreni ister.
'use strict'

const BUGUN = '2026-10-23'

// Alex ve Maya ebeveyn, Lina çocuk, Rosa büyükanne
const KISILER = [
  { ad: 'alex', gorunen: 'Alex', rol: 'ebeveyn' },
  { ad: 'maya', gorunen: 'Maya', rol: 'ebeveyn' },
  { ad: 'lina', gorunen: 'Lina', rol: 'cocuk' },
  { ad: 'rosa', gorunen: 'Rosa', rol: 'yetiskin' }
]

const DOSYALAR = {
  fatura: { mime: 'image/gif', name: 'fatura.gif' },
  garantiBelgesi: { mime: 'image/gif', name: 'garanti-belgesi.gif' },
  bulasikKilavuz: { mime: 'application/pdf', name: 'kullanim-kilavuzu.pdf' },
  recete: { mime: 'image/gif', name: 'recete.gif' },
  kutuPlacebin: { mime: 'image/gif', name: 'placebin-kutu.gif' },
  kutuFiktamin: { mime: 'image/gif', name: 'fiktamin-kutu.gif' },
  kombiKilavuz: { mime: 'application/pdf', name: 'kombi-kilavuzu.pdf' },
  pasaport: { mime: 'image/gif', name: 'pasaport.gif' },
  dask: { mime: 'application/pdf', name: 'dask-policesi.pdf' },
  tvFatura: { mime: 'image/gif', name: 'tv-fatura.gif' }
}

// Kayıt: [kol, ad, tür, alanlar, yazan, zaman, sonrakiler?]; sonrakiler: [[yazan, zaman, alanlar], ...]
const T = 'tumAile'
const E = 'ebeveynler'
const KAYITLAR = [
  // Ev (01 §4.1)
  [T, 'anaEv', 'yuva.defter.ev', { sema: 1, baslik: 'Ana ev', adres: '42 Maple Street, Springfield (örnek adres)', apartman: 'Maple Court, daire 4B', sayac_no: ['elektrik=EX 0000 0001'] }, 'alex', '2025-09-03 10:00'],
  [T, 'wifi', 'yuva.defter.wifi', { sema: 1, baslik: 'Ev wifi', ag_adi: 'OrnekEv_5G', sifre: 'ornek-wifi-2025', guvenlik: 'wpa3', misafir_agi: false, ev: '@kayit:tumAile/anaEv' }, 'alex', '2025-09-03 10:05', [['maya', '2026-10-03 18:40', { sifre: 'ornek-wifi-2026' }]]],
  [T, 'wifiEski', 'yuva.defter.wifi', { sema: 1, baslik: 'Modem', ag_adi: 'OrnekEv', sifre: 'eski-ornek-2025', guvenlik: 'wpa2', misafir_agi: false, ev: '@kayit:tumAile/anaEv' }, 'alex', '2025-09-03 10:06'],
  [T, 'misafirWifi', 'yuva.defter.wifi', { sema: 1, baslik: 'Misafir ağı', ag_adi: 'OrnekMisafir', sifre: 'ornek-misafir-2026', guvenlik: 'wpa2', misafir_agi: true, ev: '@kayit:tumAile/anaEv' }, 'alex', '2025-09-03 10:07', [['maya', '2026-10-20 09:00', { notlar: 'Şifre bakıcıyla paylaşılabilir' }]]],
  [T, 'demirdokumServis', 'yuva.defter.kisi', { sema: 1, baslik: 'Demirdöküm yetkili servis', rol: 'usta', telefonlar: ['is=+1 555 0105'], notlar: 'kombi' }, 'alex', '2025-09-03 10:30'],
  [T, 'boschServis', 'yuva.defter.kisi', { sema: 1, baslik: 'Bosch yetkili servis', rol: 'usta', telefonlar: ['is=+1 555 0106'], notlar: 'bulaşık makinesi' }, 'alex', '2025-09-03 10:31'],
  [T, 'bayChen', 'yuva.defter.kisi', { sema: 1, baslik: 'Bay Chen', rol: 'yonetici', telefonlar: ['cep=+1 555 0100'], notlar: 'Apartman yöneticisi' }, 'alex', '2025-09-03 10:32'],
  [T, 'kombi', 'yuva.defter.ev_sistemi', { sema: 1, baslik: 'Kombi', tur: 'kombi', marka: 'Demirdöküm', model: 'Nitromix', konum: 'Mutfak balkonu', son_bakim: '2026-10-01', sonraki_bakim: '2027-09-15', servis: '@kayit:tumAile/demirdokumServis', kilavuz: '@dosya:kombiKilavuz', ev: '@kayit:tumAile/anaEv' }, 'alex', '2025-09-03 10:40', [['maya', '2026-10-02 21:14', { son_bakim: '2026-09-15' }]]],
  [T, 'kombiE1', 'yuva.defter.not', { sema: 1, baslik: 'E1 hatası', metin: "Basınç düşük. Kombinin altındaki musluğu aç, ibre 1,5 bar'a gelince kapat.", bagli: '@kayit:tumAile/kombi' }, 'maya', '2026-10-22 09:10'],
  // Cihazlar (01 §4.3)
  [T, 'bulasik', 'yuva.defter.ev_cihazi', { sema: 1, baslik: 'Bulaşık makinesi', kategori: 'beyaz_esya', marka: 'Bosch', model: 'SMS4HVI33E', seri_no: 'FD 0000 00001', alis_tarihi: '2025-03-14', satici: 'Örnek Beyaz Eşya, Springfield', fiyat: '18.499 TL', garanti_bitis: '2027-03-14', fatura: '@dosya:fatura', garanti_belgesi: '@dosya:garantiBelgesi', kilavuz: '@dosya:bulasikKilavuz', servis: '@kayit:tumAile/boschServis', ev: '@kayit:tumAile/anaEv' }, 'alex', '2026-10-23 10:30'],
  [T, 'bulasikE15', 'yuva.defter.not', { sema: 1, baslik: 'E15 hatası', metin: 'Altta su var; fişi çek, servisi ara.', bagli: '@kayit:tumAile/bulasik' }, 'maya', '2026-10-23 10:35'],
  [T, 'buzdolabi', 'yuva.defter.ev_cihazi', { sema: 1, baslik: 'Buzdolabı', kategori: 'beyaz_esya', marka: 'Arçelik', garanti_bitis: '2029-06-30', notlar: '5 yıl motor garantisi' }, 'alex', '2025-09-04 11:00'],
  [T, 'firin', 'yuva.defter.ev_cihazi', { sema: 1, baslik: 'Fırın', kategori: 'mutfak' }, 'maya', '2025-09-04 11:05'],
  [T, 'camasir', 'yuva.defter.ev_cihazi', { sema: 1, baslik: 'Çamaşır makinesi', kategori: 'beyaz_esya', marka: 'Vestel', garanti_bitis: '2026-11-15', notlar: 'servis kaydı 1' }, 'alex', '2024-11-15 12:00'],
  [T, 'tv', 'yuva.defter.ev_cihazi', { sema: 1, baslik: 'Televizyon', kategori: 'elektronik', marka: 'LG', garanti_bitis: '2025-05-20', fatura: '@dosya:tvFatura' }, 'alex', '2023-05-20 12:00'],
  // Kişiler (01 §4.2)
  [T, 'drCosta', 'yuva.defter.kisi', { sema: 1, baslik: 'Dr. Ana Costa', rol: 'doktor', kurum: 'Maple Diş Kliniği', telefonlar: ['cep=+1 555 0101', 'is=+1 555 0102'], adres: '17 Oak Avenue, Springfield (örnek adres)', kimin_icin: ['@kisi:lina'], notlar: 'Diş hekimi' }, 'maya', '2026-01-10 09:00'],
  [T, 'drNair', 'yuva.defter.kisi', { sema: 1, baslik: 'Dr. Priya Nair', rol: 'doktor', kurum: 'Springfield Göğüs Merkezi', telefonlar: ['is=+1 555 0144'], notlar: 'Göğüs hastalıkları doktoru', kimin_icin: ['@kisi:rosa'] }, 'rosa', '2026-08-12 11:00'],
  [T, 'drBecker', 'yuva.defter.kisi', { sema: 1, baslik: 'Dr. Tom Becker', rol: 'doktor', kurum: 'Springfield Çocuk Kliniği', telefonlar: ['is=+1 555 0104'], kimin_icin: ['@kisi:lina'], notlar: 'Çocuk doktoru' }, 'maya', '2025-09-10 09:00'],
  [T, 'okul', 'yuva.defter.kisi', { sema: 1, baslik: 'Riverside İlkokulu · 2-C', rol: 'okul', kurum: 'Riverside İlkokulu', telefonlar: ['cep=+1 555 0103'], kimin_icin: ['@kisi:lina'], notlar: 'Öğretmen Ms. Kim' }, 'maya', '2026-09-15 09:00'],
  [E, 'avukat', 'yuva.defter.kisi', { sema: 1, baslik: 'Av. Sam Okafor', rol: 'diger', kurum: 'Okafor Hukuk', telefonlar: ['is=+1 555 0107'], notlar: 'Avukat' }, 'alex', '2026-03-01 09:00'],
  // Belgeler (01 §4.4)
  [T, 'ogrenciBelgesi', 'yuva.defter.belge', { sema: 1, baslik: 'Öğrenci belgesi · Lina', tur: 'okul', kurum: 'Riverside İlkokulu', kisi: '@kisi:lina', baslangic: '2026-09-14', bitis: '2027-06-20', sayfa_sayisi: 1 }, 'maya', '2026-09-16 09:00'],
  [T, 'elektrikFaturasi', 'yuva.defter.belge', { sema: 1, baslik: 'Elektrik faturası · Ekim', tur: 'fatura', kurum: 'Şehir Enerji', sayfa_sayisi: 1 }, 'maya', '2026-10-18 09:00'],
  [T, 'dask', 'yuva.defter.belge', { sema: 1, baslik: 'DASK poliçesi 2026–2027', tur: 'dask', kurum: 'DASK', belge_no: '0000-00000001', baslangic: '2026-03-12', bitis: '2027-03-12', dosyalar: ['@dosya:dask'], sayfa_sayisi: 2 }, 'alex', '2026-10-20 14:00'],
  [E, 'tapu', 'yuva.defter.belge', { sema: 1, baslik: 'Tapu · Springfield daire', tur: 'tapu', kurum: 'Springfield Tapu Müdürlüğü', sayfa_sayisi: 1 }, 'alex', '2025-09-05 09:00'],
  [E, 'pasaportLina', 'yuva.defter.belge', { sema: 1, baslik: 'Pasaport · Lina', tur: 'pasaport', kurum: 'Springfield Nüfus Müdürlüğü', belge_no: 'X00000001', kisi: '@kisi:lina', baslangic: '2022-01-14', bitis: '2027-01-14', dosyalar: ['@dosya:pasaport'], sayfa_sayisi: 1 }, 'alex', '2026-02-02 09:00'],
  [E, 'kiraSozlesmesi', 'yuva.defter.belge', { sema: 1, baslik: 'Kira sözleşmesi', tur: 'sozlesme', kurum: 'Ev sahibi · Jordan Lee', baslangic: '2026-01-01', bitis: '2026-12-31', sayfa_sayisi: 4 }, 'alex', '2026-01-02 09:00'],
  [E, 'aracSigortasi', 'yuva.defter.belge', { sema: 1, baslik: 'Araç sigortası', tur: 'arac_sigortasi', kurum: 'Örnek Sigorta', belge_no: '0000-2025', baslangic: '2025-10-01', bitis: '2026-10-01', sayfa_sayisi: 3 }, 'alex', '2025-10-01 09:00'],
  // Sağlık özetleri (01 §4.5)
  [E, 'saglikLina', 'yuva.defter.saglik_ozeti', { sema: 1, kisi: '@kisi:lina', kan_grubu: 'A Rh+', alerjiler: ['Polen'], kronik: [], surekli_ilaclar: [], doktor: '@kayit:tumAile/drBecker', acil_kisi: ['Maya +1 555 0110', 'Alex +1 555 0111'], boy_kilo_beden: ['ayakkabı=31', 'beden=7–8 yaş'] }, 'maya', '2025-09-12 09:00', [['maya', '2026-10-09 20:00', { alerjiler: ['Polen', 'Kivi'] }]]],
  [E, 'saglikAlex', 'yuva.defter.saglik_ozeti', { sema: 1, kisi: '@kisi:alex', kan_grubu: 'B Rh+', alerjiler: [], kronik: [], surekli_ilaclar: [] }, 'alex', '2025-09-12 09:05'],
  ['kisisel:rosa', 'saglikRosa', 'yuva.defter.saglik_ozeti', { sema: 1, kisi: '@kisi:rosa', kan_grubu: 'AB Rh-', alerjiler: ['Lateks'], kronik: ['Astım'], surekli_ilaclar: ['Placebin 5 mg, sabah', 'Fiktamin 10 mg, akşam'] }, 'rosa', '2026-10-15 09:00'],
  // Takvim (01 §4.6)
  [T, 'disci', 'yuva.defter.etkinlik', { sema: 1, baslik: 'Lina dişçi', baslangic: '@zaman:2026-10-27 16:30', bitis: '@zaman:2026-10-27 17:30', tum_gun: false, saat_dilimi: 'Europe/Istanbul', yer_metni: 'Maple Diş Kliniği · Springfield', kimler: ['@kisi:lina'], sorumlu_gerekli: true, hatirlatma: [60], durum: 'planli' }, 'alex', '2026-10-21 09:35', [['maya', '2026-10-21 10:02', { sorumlu: '@kisi:maya' }]]],
  [T, 'veliToplantisi', 'yuva.defter.etkinlik', { sema: 1, baslik: 'Veli toplantısı · 2-C', baslangic: '@zaman:2026-10-30 19:00', tum_gun: false, saat_dilimi: 'Europe/Istanbul', yer_metni: 'Riverside İlkokulu, 2-C sınıfı', kimler: ['@kisi:lina'], sorumlu_gerekli: true, hatirlatma: [60], durum: 'planli' }, 'alex', '2026-10-22 18:00'],
  [T, 'buyukanne', 'yuva.defter.etkinlik', { sema: 1, baslik: 'Büyükannede öğle yemeği', baslangic: '@zaman:2026-10-31 13:00', tum_gun: false, saat_dilimi: 'Europe/Istanbul', kimler: ['@kisi:alex', '@kisi:maya', '@kisi:lina', '@kisi:rosa'], sorumlu_gerekli: false, hatirlatma: [60], durum: 'planli' }, 'maya', '2026-10-19 18:00'],
  [T, 'buyukanneyiAl', 'yuva.defter.yapilacak', { sema: 1, baslik: 'Büyükanneyi almak', son_gun: '2026-10-31', son_saat: '12:30', sorumlu: '@kisi:alex', durum: 'acik', bagli: '@kayit:tumAile/buyukanne' }, 'maya', '2026-10-19 18:05'],
  [T, 'okulAidati', 'yuva.defter.yapilacak', { sema: 1, baslik: 'Okul aidatı', son_gun: '2026-11-02', sorumlu: '@kisi:alex', durum: 'acik', hatirlatma: [0] }, 'alex', '2026-10-10 09:00'],
  [T, 'kombiBakimi', 'yuva.defter.yapilacak', { sema: 1, baslik: 'Kombi bakımı için servisi ara', son_gun: '2026-09-30', sorumlu: '@kisi:maya', durum: 'acik', bagli: '@kayit:tumAile/kombi' }, 'alex', '2026-09-01 09:00'],
  [T, 'kitapOzeti', 'yuva.defter.yapilacak', { sema: 1, baslik: 'Kitap özeti', son_gun: '2026-10-30', sorumlu: '@kisi:lina', durum: 'acik' }, 'lina', '2026-10-21 17:00'],
  [T, 'elektrikOdendi', 'yuva.defter.yapilacak', { sema: 1, baslik: 'Elektrik faturası', son_gun: '2026-10-20', sorumlu: '@kisi:maya', durum: 'tamam', tamamlayan: '@kisi:maya', tamamlanma: '@zaman:2026-10-20 11:00', bagli: '@kayit:tumAile/elektrikFaturasi' }, 'maya', '2026-10-18 09:05']
]

// Kasa (05): 14 şifre, 3 güvenli not, 4 belge; aktarma günlüğü Ebeveynler'de. Parolalar ve belge numaraları uydurmadır.
const sifre = (ad, baslik, kullanici, parola, adres, kategori, sahip, degisim, yazan) =>
  ['kasa', ad, 'yuva.defter.sifre', { sema: 1, baslik, kullanici_adi: kullanici, sifre: parola, adresler: adres ? [adres] : [], kategori, ...(sahip ? { sahip: '@kisi:' + sahip } : {}), sifre_degisim: '@zaman:' + degisim + ' 10:00' }, yazan, degisim + ' 10:00']
const KASA_KAYITLARI = [
  sifre('sEdevlet', 'E-Devlet', '00000000000', 'Ornek!2024-giris', 'https://giris.turkiye.gov.tr', 'devlet', 'alex', '2024-03-02', 'alex'),
  sifre('sNetflix', 'Netflix', 'rivera.aile@posta.example', 'q3#Vn8bW!eK2yH6p&Rd5', 'https://www.netflix.com', 'eglence', null, '2025-03-10', 'alex'),
  sifre('sMuzik', 'Müzik aboneliği', 'rivera.aile@posta.example', 'q3#Vn8bW!eK2yH6p&Rd5', 'https://muzik.example', 'eglence', null, '2025-05-01', 'alex'),
  sifre('sBanka', 'Banka · ortak hesap', '0000001', 'Ornek-Hesap!2026#Ba', 'https://internet.banka.example', 'banka', 'maya', '2026-01-20', 'maya'),
  sifre('sModem', 'Modem yönetim paneli', 'admin', 'admin123', 'http://192.0.2.1', 'ev', null, '2026-01-15', 'alex'),
  sifre('sElektrik', 'Elektrik · Şehir Enerji', 'alex.rivera', 'Enerji-2026!abone-01', 'https://enerji.example', 'ev', 'alex', '2026-02-01', 'alex'),
  sifre('sSu', 'Su idaresi online işlem', '0000000001', 'Su!idaresi-2026-Ornek', 'https://su.example', 'ev', null, '2026-02-01', 'maya'),
  sifre('sDogalgaz', 'Doğalgaz · Şehir Gaz', 'alex.rivera', 'Gaz!2025-kombi-Nitro', 'https://gaz.example', 'ev', 'alex', '2025-11-05', 'alex'),
  sifre('sOkul', 'Okul veli portalı', 'maya.rivera', 'Veli!2026-2C-Ornek', 'https://okul.example', 'diger', 'maya', '2026-09-15', 'maya'),
  sifre('sEposta', 'E-posta · aile', 'rivera.aile@posta.example', 'Posta!2023-aile-kutu', 'https://posta.example', 'eposta', null, '2023-06-10', 'alex'),
  sifre('sAlisveris', 'Alışveriş · Örnek Market', 'maya.rivera', 'Sepet!2026-Alis-Veris', 'https://market.example', 'alisveris', 'maya', '2026-03-03', 'maya'),
  sifre('sSigorta', 'Sigorta portalı', 'alex.rivera', 'Polic3!2022-Ornek', 'https://sigorta.example', 'diger', 'alex', '2022-01-12', 'alex'),
  sifre('sKargo', 'Kargo takip', 'rivera.aile@posta.example', 'Kargo!2026-paket-33', 'https://kargo.example', 'alisveris', null, '2026-04-18', 'maya'),
  sifre('sAidat', 'Apartman aidat portalı', 'daire4b', 'Aidat!2026-Maple-4B', 'https://aidat.example', 'ev', null, '2026-05-02', 'alex'),
  ['kasa', 'nKrediKarti', 'yuva.defter.guvenli_not', { sema: 1, baslik: 'Kredi kartı · Maya', metin: 'Ortak hesap kartı. Limit sorusu için bankayı ara.', kaynak_tur: 'kart', sahip: '@kisi:maya', ozel_alanlar: [['Kart numarası', '4111 1111 1111 1111', 'gizli'], ['Son kullanma', '08/2028', 'gizli'], ['Kart sahibi', 'MAYA RIVERA', 'acik']] }, 'maya', '2026-02-01 12:00'],
  ['kasa', 'nKombiServis', 'yuva.defter.guvenli_not', { sema: 1, baslik: 'Kombi servis şifresi', metin: 'Teknisyen menüsü: 1234 basılı tutun, kod 0000', kaynak_tur: 'diger' }, 'alex', '2025-09-15 12:00'],
  ['kasa', 'nBankaSorulari', 'yuva.defter.guvenli_not', { sema: 1, baslik: 'Banka güvenlik soruları', metin: 'İlk okul: Lakeside İlkokulu · İlk evcil hayvan: Pickles', kaynak_tur: 'banka_hesabi', sahip: '@kisi:maya' }, 'maya', '2026-01-20 12:00'],
  ['kasa', 'bKimlikAlex', 'yuva.defter.belge', { sema: 1, baslik: 'Kimlik · Alex', tur: 'kimlik', kurum: 'Springfield Nüfus Müdürlüğü', belge_no: 'X00A00001', kisi: '@kisi:alex', baslangic: '2021-04-10', bitis: '2031-04-10', sayfa_sayisi: 1 }, 'alex', '2026-03-02 12:00'],
  ['kasa', 'bKimlikMaya', 'yuva.defter.belge', { sema: 1, baslik: 'Kimlik · Maya', tur: 'kimlik', kurum: 'Springfield Nüfus Müdürlüğü', belge_no: 'X00A00002', kisi: '@kisi:maya', baslangic: '2020-08-21', bitis: '2030-08-21', sayfa_sayisi: 1 }, 'maya', '2026-03-02 12:05'],
  ['kasa', 'bEhliyetAlex', 'yuva.defter.belge', { sema: 1, baslik: 'Ehliyet · Alex', tur: 'ehliyet', kurum: 'Springfield Nüfus Müdürlüğü', belge_no: '00-0000001', kisi: '@kisi:alex', baslangic: '2019-05-15', bitis: '2029-05-15', sayfa_sayisi: 1 }, 'alex', '2026-03-02 12:10'],
  ['kasa', 'bKrediSozlesmesi', 'yuva.defter.belge', { sema: 1, baslik: 'Konut kredisi sözleşmesi', tur: 'sozlesme', kurum: 'Banka', baslangic: '2024-06-01', bitis: '2034-06-01', sayfa_sayisi: 12 }, 'alex', '2026-03-03 12:00'],
  [E, 'gunluk1', 'yuva.defter.aktarma_gunlugu', { sema: 1, yon: 'ice', bicim: '1pux', kapsam: 'kasa', oge_sayisi: 1, kim: '@kisi:maya', zaman: '@zaman:2026-02-01 12:00', _t: '@zaman:2026-02-01 12:00', _keep: 730 }, 'maya', '2026-02-01 12:00']
]

// Bakım Masası (01 §4.11): Rosa'nın Sağlık koleksiyonu; dozlar CareDeskApi.markDose ile. İlaç adları uydurmadır.
const SAGLIK_KAYITLARI = [
  ['saglik', 'ilacPlacebin', 'yuva.defter.ilac', { sema: 1, kisi: '@kisi:rosa', baslik: 'Placebin 5 mg', doz_metni: 'Günde 1 tablet, sabah', saatler: ['09:00'], baslangic: '2026-08-12', recete: '@dosya:recete', kutu_foto: '@dosya:kutuPlacebin', aktif: true }, 'rosa', '2026-08-12 12:00'],
  ['saglik', 'ilacFiktamin', 'yuva.defter.ilac', { sema: 1, kisi: '@kisi:rosa', baslik: 'Fiktamin 10 mg', doz_metni: 'Günde 1 tablet', saatler: ['21:00'], baslangic: '2026-08-12', kutu_foto: '@dosya:kutuFiktamin', aktif: true }, 'rosa', '2026-08-12 12:05'],
  ['saglik', 'acilKartRosa', 'yuva.defter.acil_kart', { sema: 1, kisi: '@kisi:rosa', kan_grubu: 'AB Rh-', alerjiler: ['Lateks'], ilaclar_ozet: 'Placebin 5 mg sabah · Fiktamin 10 mg akşam', doktor: '@kayit:tumAile/drNair', acil_kisiler: ['Alex=+1 555 0111', 'Maya=+1 555 0112'], notlar: '', cevrimdisi: false }, 'rosa', '2026-08-12 12:10'],
  ['saglik', 'randevuGogus', 'yuva.defter.randevu', { sema: 1, kisi: '@kisi:rosa', baslik: 'Göğüs hastalıkları kontrolü', kurum: 'Springfield Göğüs Merkezi', doktor: '@kayit:tumAile/drNair', baslangic: '@zaman:2026-11-04 10:30', bitis: '@zaman:2026-11-04 11:00', yer_metni: 'Springfield Göğüs Merkezi', sorumlu: '@kisi:maya', hatirlatma: [1440, 60], hatirlat_kime: ['@kisi:maya', '@kisi:rosa'], durum: 'planli', saat_dilimi: 'Europe/Istanbul' }, 'rosa', '2026-10-20 14:00']
]

// Son 7 gün (17–23 Ekim): Placebin 09:00 her gün (Salı 20 Ekim hariç) alındı; Fiktamin 21:00 17–21 Ekim alındı,
// 22 Ekim işaretlenmedi (kaçırılan doz). [ilaç, planlanan gün ve saat, işaretleme saati]
const DOZLAR = []
for (const g of ['2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']) {
  if (g !== '2026-10-20') DOZLAR.push(['ilacPlacebin', g + ' 09:00', g + (g === BUGUN ? ' 09:12' : ' 09:05')])
  if (g < '2026-10-22') DOZLAR.push(['ilacFiktamin', g + ' 21:00', g + ' 21:08'])
}

// Kalkan (04): kelime "mor çaydanlık" (Maya, 3 Mart); Rosa'nın koruyucuları Alex ve Maya (kabul); bugün 11:05 bildirim
const KALKAN = {
  kelime: { kelime: 'mor çaydanlık', yazan: 'maya', zaman: '2026-03-03 19:00' },
  korunan: 'rosa',
  koruyucular: ['alex', 'maya'],
  acilis: '2026-10-16 10:00',
  kabuller: [['alex', '2026-10-16 10:05'], ['maya', '2026-10-16 10:20']],
  bildirim: { tur: 'arama', anlatim: 'Biri aradı. Alex kaza yapmış, hastanedeymiş, hemen para göndermem lazım dedi. Kimseye söylememi istemedi.', isaretler: ['kaza:kaza', 'kaza:hastanede', 'acele:hemen', 'para:para gönder', 'acele:kimseye söyleme'], zaman: BUGUN + ' 11:05' }
}

module.exports = { BUGUN, KISILER, DOSYALAR, KAYITLAR, KASA_KAYITLARI, SAGLIK_KAYITLARI, DOZLAR, KALKAN, KAGIT_BASILDI: '2026-03-02 11:00' }
