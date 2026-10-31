# RFC-0027 — Uygulamadan dönen ekler 5: kasa ve kap komutları, taşıma, gövde düzeltmeleri

> Durum: **Onaylandı** · 23–24 Ekim 2026 · Yazan: Havenfold çekirdek ekibi · Onay: Kerem (24 Ekim 2026)
> Kaynak: Yuva Defteri L13 dilim 3 (`kol/defter` `058aca1`) ve sonraki dilimler; `kollar/L-durum.md` İstekler. L13 bitince tamamlanıp onaya sunulur.
> Etkilenen RFC'ler: 0001, 0003, 0004, 0014, 0017, 0021, 0024, 0025.

## 1. Kasa komutları

Yuva Hat çizelgesindeki numaralar korunur (RFC-0024 §3a gerekçesi):

| No | Ad | Gövde → sonuç |
|----|----|---------------|
| 19 | `LOCK` | `{}` → `null` |
| 224 | `UNLOCK` | `{ archiveKeyHex }` → `null`; yanlış anahtar `WRONG_LOCK_KEY` |

- Kilit durumu worklet'tedir. Kilitliyken kasa koleksiyonunda okuma, yazma, geçmiş, onaylı kayıt ve kasa kaydındaki dosyayı açma `VAULT_LOCKED` döner; arama ve soru kasayı atlar. 5 dakika işlemsizlikte kendiliğinden kilitlenir (Yuva Defteri 05 §2.3).
- Kilit durumu: 365 `VAULT_STATUS {}` → `{ kilitli, ya, kasalar }` (§1a). dell D25'te 229 vermişti; 200–239 Yuva Hat çizelgesinin büyüme alanı sayılır, ürün yöntemleri oraya girmez (dell D28).
- `kasa` olayının türleri: `acildi`, `kilitlendi`, `kuruldu`, `kagit_gerekli`.

## 1a. Ürün yöntemlerinin kanal numaraları (dell D24, D25)

| Aralık | Kullanım |
|--------|----------|
| 3 `INVITE_START`, 4 `INVITE_CONFIRM`, 5 `JOIN`, 205 `INVITE_CANCEL` | Tören (Yuva Hat çizelgesi) |
| 352 `LOCAL_DRAFT`, 353 `PERSONAL_MODE_START`, 354 `PERSONAL_MODE_MOVE` | Yerel kanal ve kişisel mod (RFC-0017) |
| 355 `CARE_PROCESS`, 356 `CARE_MISSED`, 357 `CARE_CLAIM`, 358 `SHIELD_ENABLE`, 359 `SHIELD_REPORT` | Bakım Masası ve Kalkan |
| 365–369 | Kasa ürün yöntemleri: 365 `VAULT_STATUS` (kilit durumu dahil), 366 `VAULT_PAPER_SHARE`, 367 `VAULT_PAPER_PRINTED`, 368 `VAULT_PERSONAL`, 369 `VAULT_CHILD_BACKUP` |
| 387 `VAULT_SETUP_BK`, 388 `VAULT_SETUP_VRK` | Kasa kurulumu (Yuva Defteri 05 §2.2: kasa duyarlılıklı koleksiyon, yetişkin anahtarı ve KRA payları; dell D33). 389 `VAULT_ARCHIVE_MOVE { eskiArchiveKeyHex, yeniArchivePubHex }` (Arşiv anahtarı değişince `arsiv`'in atomik taşınması; dell D40) |
| 400–404 | Kasa kurtarma ve döndürme (RFC-0004 §5–§6, dell D67): 400 `VAULT_RECOVERY_START` (pay isteği), 401 `VAULT_RECOVERY_SHARE` (gelen payı ekle), 402 `VAULT_RECOVERY_FINISH` (birleştir), 403 `VAULT_ROTATE` (yeni sürüm, paylar yeniden), 404 `VAULT_RECOVERY_STATUS`, 405 `VAULT_SHARE_APPROVE` (tutucu telefonun onayı; dell D67) |
| 370–386 | Bakım, Kalkan ve yerel kanalın kalan ürün yöntemleri (`dozlar`, `dozIsaretle`, `durum`, `saglikKoleksiyonuKur`, Kalkan `kapat`, `koruyucuAyarla`, `davetCevapla`, `sonucYaz`, `bildirimler`, `gorunurlukAyarla`, `LocalApi.dropMessage`); sırayı dell verir ve `CHANNEL_COMMAND`'a yazar |

## 1b. Kabul edilen uygulama seçimleri

- RFC-0026 f (dell 117 b): `/run/havenfold/denetci` 0750 `havenfold-denetci:havenfold-cekirdek` (yeni grup; yalnız kutu ve işçi); denetçinin yönetim soketi ayrı dizinde. Kabul.
- RFC-0004 §4.4 kâğıt pay satırı (dell 118 c): `hfk1:` ayrı satır, sonra 4 karakterlik gruplar, satırda 6 grup. Kabul.
- RFC-0007 §6.4 ek işlemler ve hata kodları (dell 117 a) RFC-0026 §3'e eklenmiş sayılır.
- Kanal numaraları dell D28 ile `protocol/command-ranges.json`'daki aralık tablosuna bağlandı; aynı numaranın iki ada verilmesini ve aralık dışı numarayı test yakalar. 366–386 dell'in sırasıyla `channel-v4.json`'dadır (geçerli tablo).
- **Pay teslimi (RFC-0004 §4.4 eki, dell 121):** kurulumda üretilen kişi ve cihaz payları sahibine `KASA_SHARE_PUT (0xF1) { share }` ile gider, sahip `KASA_SHARE_ACK (0xF2) { secretId, version, holderId }` döner. Mühür gönderen ile sahibin çift sırrından türetilen anahtarla (RFC-0003 §6.4); yalnız doğrudan oturum ya da emanet. Sahip payı telefonda Arşiv katmanında, kutuda TPM mührüyle saklar. ACK gelmeyen pay "bekliyor" görünür (`VaultApi.status` sahip başına `teslim`). Aynı pay tekrar gelirse yok sayılır; aynı sürümde farklı pay `DUPLICATE_HOLDER`. Kabul.

## 2. Kap komutu

RFC-0014 §10 "çekirdek komutu yok" der; RFC-0024'ten beri kap worklet'te çalışır. Kap ve dışa aktarma için **390–399** ayrılır (RFC-0003 tablosuna eklenir):

| No | Ad | Gövde → sonuç |
|----|----|---------------|
| 390 | `EXPORT` | `{ koleksiyonlar, gizliDahil, parola }` → `{ dosyaAdi, bytes, ogeSayisi, eksikDosya }`; kasa kilitliyse `VAULT_LOCKED`, parola 12 karakterden kısaysa `PASSWORD_TOO_SHORT` |
| 391 | `IMPORT` | `{ bytes, parola }` → içerik (telefon sınırlarıyla, RFC-0021 h); geri yükleme üründe |

- dell D25'te 280/281 vermişti; 280–289 RFC-0005 ekip komutlarıdır (280 `TEAM_CREATE`). D28'de 390/391'e taşınır.
- Kap içeriği SDK'da genel biçimdedir: `{ bicim, bicimSurum, olusturma, koleksiyonlar: [{ ad, tur, kasa, kayitlar: [{ tur, olusturma, degisme, alanlar, yapay_zeka_alanlari }] }] }`. Kişiler görünen adla çıkar; iç kimlik ve başvuru çıkmaz. Ürünün kendi arşiv şeması (Yuva Defteri `yuva-defter-arsiv` 1) bunu sarmalar; gizli alanlar ürünün `gizliAlanlar(type)` kancasından gelir.

## 3. Taşıma

`RecordApi.move` (yapay zeka alanları korunarak, kasa kaynaklı yalnız kasaya; dell D15 (6)) için kanal numarası **249** olur (RFC-0024 §3'te ayrılmıştı): `{ collectionId, recordId, hedefCollectionId, degisiklik? }` → yeni `recordId`.

## 4. RFC-0024 §3a gövdeleri uygulamaya uyar

Uygulama ve testler aşağıdaki gövdelerle yazıldı; RFC buna uyar:
- 2 `CREATE_FAMILY`: `{ ad, benimAdim }` (aile adı ve kurucunun adı).
- 13 `MEMBER_REMOVE`: `{ memberId, wipe }`.
- 200 `FAMILY_INFO`: uygulamanın döndürdüğü biçim (`kollar/L-durum.md` L13 notu).

## 5. Telefondaki çekirdeğin kalıcılığı (PR #4, inceleme 12)

Air'in A2 İstek 3 ve 4'ü ile `kollar/D-inceleme-12.md`'nin kararları:

a. **Platform anahtarı zorunlu.** Uygulama başlatırken 32 baytlık platform anahtarını verir (iOS Keychain `AfterFirstUnlockThisDeviceOnly`, Android Keystore ile sarılmış; Yuva Hat'taki `START { hatKeyHex }` gibi). Bare'de anahtar yoksa `NO_KEY`. Düz kip yalnız açık `testKipi: true` ile açılır ve telefon paketinde kapalıdır. Düz kipte yazılmış bir dizin şifreli kiple açılınca bir kez şifreli kipe taşınır (`STATE_MODE_MISMATCH` yalnız şifreliden düze geçişte).
b. **Kasa anahtarları ayrı `arsiv` dosyasında.** Kasa duyarlılıklı koleksiyonların dönem anahtarları `durum`'a girmez; `arsiv` dosyasına Arşiv açık anahtarıyla mühürlenerek (`crypto_box_seal`, başlatmada `archivePubHex`) yazılır. 224 `UNLOCK { archiveKeyHex }` dosyayı açar ve anahtarları belleğe alır; 19 `LOCK` ve 5 dakikalık işlemsizlik onları bellekten siler. Kilitliyken gelen kasa işlemleri şifreli hâlde kuyrukta bekler, açılınca işlenir. Yeni kasa anahtarı kilitliyken de mühürlenip eklenebilir (açık anahtar yeter).
c. **Silme ve geri alma.** `durum` içinde `kimlik` dosyasının özeti durur; biri varken öbürü yoksa ya da özet uyuşmazsa `STATE_CORRUPT` (sessiz yeni kimlik ya da ailesiz açılış yok). `durum` her yazımda tekdüze artan bir `sayac` taşır; worklet yazımdan sonra `kalici { sayac }` olayı yollar, uygulama son değeri platform kasasında tutar ve başlatırken verir. Diskteki değer daha küçükse `STATE_ROLLED_BACK`. Kurtarma yolu: aile yedeğinden geri yükleme (RFC-0021).
d. **IPC çerçevesi (RFC-0024 §2, §4'e eklenir).** 4 baytlık büyük sonlu işaretsiz uzunluk, ardından UTF-8 JSON, uzunluk 1..1 MiB. Sınır dışı uzunluk eşzamanlamanın kaybıdır: worklet `{ id: null, olay: "kanal", govde: { hata: "INVALID_FRAME" } }` yollar, akışı kapatır; uygulama worklet'i yeniden başlatır. Fırlatan komut `{ id, hata }` ile döner. 1 MiB'ı aşan geri çağrı ya da olay atılmaz, ilgili komut `INVALID_FRAME` ile reddedilir. Olay listesine `kalici` (`{ hata }` ya da `{ sayac }`) eklenir.
e. **Açılan dosyalar.** Çözülmüş dosyalar yalnız worklet'in geçici `acilan` dizininde durur; başlatmada, kapatışta ve `LOCK`'ta silinir (kasa kaynaklıları), en geç 10 dakika sonra kendiliğinden silinir (RFC-0014'teki süre; RFC-0001 §16'ya eklenir).
g. **İnceleme 13 kararları.** Şifreli dizinde açık kip dosyası yalnız ilk göçte okunur, sonra `STATE_MODE_MISMATCH`; telefon paketinde açık kip ve `testKipi` derleme anında kapalı. Kasa koleksiyonlarının REC_KEY ve kesim öğeleri `arsiv`'e mühürlenir, LOCK'ta bellekten silinir. `durum` `arsiv` ve `hlc` özetini taşır. Kasa dosyalarının blobId listesi `durum`'da açık dizindir; kilitliyken açılmaz. Diskte açık pay dizini (secretId, sürüm, pay özeti) kilitliyken tutucu kurallarını sağlar; kilitliyken gelen ACK yalnız `teslim`'i işaretler. YA kurulumunu yalnız sırrın sahibi yapar. Cihaz tutucularda `canonical` yoksa tam kimlik eşitliği.
h. **Arşiv anahtarı taşıması (389, inceleme 15).** `arsiv` yeni anahtarla yazıldıysa taşıma işlenmiştir; ardından `durum` yazılamazsa komut `ARCHIVE_MOVED_STATE_WRITE_FAILED` ile döner (geri alınmış sayılmaz). Uygulama eski ve yeni Arşiv anahtar çiftini, yeni anahtarla bir kilit açılışı başarılı olana kadar saklar. Yeni açık anahtar deneme mühürlemesiyle denetlenir (`INVALID_KEY`). Kasa koleksiyonlarının bekleyen anahtar mesajları LOCK'ta mühürlenir, bellekten silinir.
f. **Tek örnek.** İkinci `baslat` `ALREADY_STARTED`; kalıcı dizinde kilit dosyası, dizin başka süreçte açıksa `DIR_LOCKED`.

## 7. Kişisel köprü (RFC-0005 §15, dell D46, inceleme 17)

a. **Kaynak.** Köprü paketi yalnız gönderen uygulamanın kendi yön klasörüne yazılır (`kopru/ekip→aile/`, `kopru/aile→ekip/`); iOS'ta App Group içinde klasör, Android'de imza düzeyinde izinli içerik sağlayıcıda çağıran paketin adı denetlenir. Alan uygulama yalnız karşı yönün klasöründen okur. Önizleme gönderen uygulamanın adını platformdan alır, paketteki `from`'dan değil.
b. **Bağlantı yasak.** Paket derin bağlantıya, panoya ya da bildirim içeriğine yazılmaz; yalnız ortak kaptan geçer (RFC-0017 §10: bağlantı yalnız rastgele kimlik taşır). Bağlantı yalnız "köprüde yeni paket var" der.
c. **Tazelik ve tekrar.** `at` geçmişe 7 gün, ileriye 5 dakika içinde olmalı (`BRIDGE_STALE`, `BRIDGE_AHEAD`); nonce defteri en çok 1000 kayıt. Alan uygulama paketi başarıyla alınca kanaldan siler.
d. **Ayrılış.** Ekipten ayrılınca ya da çıkarılınca iki yöndeki köprü düğmeleri kapanır, gönderilmemiş paketler silinir.

## 8. Anahtar türetme ve özet kuralı (dell D66, `kollar/D-turetme-analizi.md`)

a. `kdf.derive` ve `hash` parçaları uzunluk öneksiz birleştirir; Yuva Hat'la 19 ortak etiket ve bütün vektörler buna bağlı olduğu için **değişmez**.
b. **Yeni etiketler** (bu RFC'den sonra eklenen) uzunluk önekli `deriveLP` / `hashLP` ile yazılır: her parça `uzunluk (4 bayt, büyük sonlu) ‖ parça`. Var olan etiketlere geçiş yoktur.
c. Var olan etiketlerde birden çok değişken uzunlukta parça birleştirilmez; belgede sabit boylu denen parçaların boyu kodda zorlanır (RFC-0006 §4.5 olay anahtarı).
d. Hiçbir etiket başka bir etiketin önekiyle başlamaz; kontrol betiği bütün etiketleri ikili karşılaştırır.

## 9. Kasa kurtarma zarfının yaşam döngüsü (dell D67, İstek 146; Kerem'in onayı)

a. **Tutucu onayı (RFC-0004 §5.2'ye).** Telefon, gelen pay isteğine yalnız kullanıcı kasayı biyometriyle (ya da PIN'le) açtıktan sonra 405 ile onay verir. Kutu, kurulumdaki kurala göre sormadan verir. Kilitliyken pay dizininden yalnız sürüm sorusuna cevap verilir.
b. **KRA zarfı (Mac önerisi).** Kurtarma anahtarıyla şifreli kasa zarfı, kasa duyarlılıklı koleksiyonda bir dosya kaydı (`hf.kasa.zarf`, sürümlü) olarak durur; böylece kasa eşitlemesi ve kilidiyle taşınır, okuyucu telefonlarda Arşiv mühürlü kalır, kutu ve TPM'li işçi opak dosya olarak tutar. Her dönem değişiminde (RFC-0004 §4.6) kilidi açık bir sahip telefonu zarfı yeniden üretir ve eskisini siler. Kurtarmada açılan dönem anahtarları replikaya `anahtarEkle` ile girer.
c. **Cihaz değişimi** (ROTATE_DEVICE, ACTIVATE_MEMBER) kanal komutları: Yuva Hat çizelgesindeki numaralar (varsa) korunur; yoksa 406–409 (dell D71).
d. YA'nın yedek dizini ve gece yedeği (RFC-0004 §4.5) bu RFC'nin kapsamı dışında; ayrı görev.
e. **Eşzamanlı döndürme (Kerem kararı, 24 Ekim 2026; inceleme 19 B6).** İki okuyucu aynı sürümden döndürürse kesin kural kazanır: yeni dağıtımın `commit` özeti küçük olan (RFC-0004 §6, `rotation.js` `kraKazanan`). Tutucular kazananın paylarını tutar; kaybeden telefon kendi dağıtımını geri çeker ve kazananın sürümüne geçer. Döndüren telefon eski sırrı, yeni paylardan eşik kadar alındı gelene kadar tutar.
f. **Döndürmeden sonra eski kâğıt pay (Kerem kararı, 24 Ekim 2026; inceleme 19 B7).** Döndürmeden sonra eski sürümün kâğıt payları geçersizdir: bilinen daha yeni bir sürüm varken eski sürümle kurtarma `STALE_VERSION` ile reddedilir (402 eski sürümle bitmez); yeni kâğıt basılana kadar her gün hatırlatılır (Yuva Defteri K17). Görülen en büyük sürüm sır kurtarıldıktan sonra da saklanır; döndürme her zaman ondan bir fazlasıdır.
g. **Tam felakette zarf (Kerem kararı, 24 Ekim 2026).** Ailede Aile Kutusu varsa kutu, kasa zarfının opak (kutunun açamadığı) bir kopyasını da tutar; KRA'yı kurtaran yeni telefon zarfı kutudan, KRA'dan türetilen bir etiketle ister (yalnız KRA'yı bilen isteyebilir; kutu etiketi doğrulayıp verir). Zarf her yenilendiğinde kutudaki kopya da yenilenir. Kutusu olmayan ailede tam felakette (bütün okuyucu telefonlar kayıp ya da kilitli) kurtarma olmaz; kurulumda kullanıcıya söylenir. Zarf türleri (RFC-0003 §10, Posta Kutusu'ndan geçmez): `0xF3 KASA_ENV_PUT` `{ etiket: fixed32, zarf }` okuyucu → kutu, `0xF4 KASA_ENV_ACK` `{ collectionId, version, envSeq }` kutu → telefon, `0xF5 KASA_ENV_REQ` `{ collectionId, etiket }` KRA'yı kurtaran telefon → kutu, `0xF6 KASA_ENV_RES` `{ zarf }`. Etiket `deriveLP(KRA, 'hf/kasa-zarf-etiket/', familyId, collectionId)`. Kutu yazanın imzasını ve kasanın bugünkü okuyucusu olduğunu doğrular, koleksiyon başına en büyük sürümü tutar (daha küçüğü `STALE_VERSION`, aynı etikette geri giden `STALE_ENVELOPE`; aynı sürümde en çok 4 etiket), kopyayı TPM mühürlü dosyada saklar; zarfı yalnız doğru etiketle, bugünkü okuyucuya ve istekçi başına 24 saatte 10 istekle verir, yanlış etikete sessiz ret. 402 sonucu `kutu: 'istendi' | 'alindi' | 'yok'`, 404'te `kurtarma.kutuZarfi`; kutusuz ailede tam felakette 402 `NO_ENVELOPE`. Döndürme yarışını kaybeden telefona `kasa` olayı `dondurme_geri_cekildi`, geç gelen payı tutucuda `ROTATION_LOST`.
h. **Kilitli kasada kesim (Kerem kararı, 24 Ekim 2026; RFC-0001 §8.3'e).** Kasa koleksiyonunda okuyucu telefonların kasası kilitliyken bir üye çıkarılırsa, çıkarılanın kasa kayıtları için kesim (`REC_CUTOFF`) ertelenir; erteleme kalıcıdır (yeniden başlamada kaybolmaz) ve kilit açılınca kesim bir kez verilir. Böylece çıkarılan üyenin kasa kayıtları kilit yüzünden kesimin dışında kalıp kaybolmaz.

## 6. Hata kodları

| RFC | Kodlar |
|-----|--------|
| 0004 | `VAULT_LOCKED`, `WRONG_LOCK_KEY`, `INVALID_KEY` |
| 0014 | `PASSWORD_TOO_SHORT`, `COLLECTION_REQUIRED`, `FORMAT_MISMATCH` |
| 0024 | `STATE_CORRUPT`, `STATE_VERSION`, `STATE_MODE_MISMATCH`, `STATE_ROLLED_BACK`, `IDENTITY_MISMATCH`, `NO_DIR`, `DIR_LOCKED`, `NO_KEY`, `ALREADY_STARTED`, `INVALID_NAME`, `NO_IPC`, `NO_PRODUCT_SERVER`, `INVALID_FRAME` |
| 0005 | `BRIDGE_STALE`, `BRIDGE_AHEAD`, `BRIDGE_VERSION`, `BRIDGE_TEXT`, `BRIDGE_DISABLED` |
| 0019 | `RESERVED_FIELD` (taşımada `_` ile başlayan alan değiştirilemez) |
