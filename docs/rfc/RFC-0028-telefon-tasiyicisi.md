# RFC-0028 — Telefon taşıyıcısı: buluşma, oturum ve tören ağ üstünde

> Durum: **Onaylandı** · 24 Ekim 2026 · Yazan: Havenfold çekirdek ekibi · Onay: Kerem (24 Ekim 2026; §7 a–l Mac önerileriyle)
> Kaynak: dell D43 önerisi (`kollar/D-tasiyici-oneri.md`), deneme sürümü `worklet/tasiyici/` (bayrak arkasında), test `worklet/test/transport.js`. Yuva Hat'ın telefondaki taşıyıcısı yalnız okunarak incelendi; kod kopyalanmadı.
> Etkilenen RFC'ler: 0001, 0003, 0005 (§11.2, §11.3), 0017, 0024, 0027. Kurucu belge §18.4.

## 1. Sorun

Tören (3/4/5/205) ve eşitleme bugün yalnız süreçler arası test borusuyla yürüyor (dell D34). Telefonda ağ taşıyıcısı yok; Yuva Defteri gerçek çekirdekte aileye davet edemiyor ve eşitleyemiyor. `esitleyici.js` neyin gideceğini ve gelenin nereye gideceğini biliyor. Eksik olan, zarfları doğrulanmış bir aile oturumunda taşıyan katman. Havenfold'da bunu tanımlayan bir RFC yok.

## 2. Katmanlar

| Katman | Ne yapar | Yer |
|---|---|---|
| Ağ | UDP, NAT delme, aktarma; Noise IK (`hyperdht`'nin el sıkışması; kurucu §13.2) | `hyperdht` 6.34.1 |
| Buluşma | Çift başına, saatlik dilimle türetilen anahtarlarla dinleme ve arama; güvenlik duvarı | `worklet/tasiyici/index.js` |
| Oturum | HELLO: üye imzası el sıkışma özetine bağlı, defter başı ve uzunluğu, yetenek bitleri | `core/core/protocol/hello.js` |
| Zarf | `tür (1 bayt, RFC-0003 numaraları) ‖ gövde`; doğrulanmadan işlenmez | `worklet/tasiyici/index.js` |
| Eşitleme | Defter, kayıt, kutu kovaları, dosya, kasa payı | `worklet/synchronizer.js` |
| Tören | QR, davet sırrı, JOIN sırası, 5 resim | `worklet/tasiyici/toren.js` |

## 3. Kütüphane

HyperDHT 6.34.1 (MIT); dolaylı bağımlılıklar Apache-2.0, MIT ve ISC (`scripts/license-check.js` temiz, `npm audit --omit=dev` 0). Gerekçe:
- Bare'de ve telefonda çalışıyor; Yuva Hat mağazada aynı yığınla.
- Sunucusuz NAT delme; Noise ile karşılıklı kimlik doğrulama ve ileri gizlilik. Havenfold kendi kriptosunu yazmaz (H7): yalnız anahtar türetir (BLAKE2b).
- Konu tabanlı keşif (`hyperswarm`) kullanılmaz: aile üyeleri birbirini bilir, konu duyurusu kimin kiminle konuştuğunu sızdırırdı.

## 4. Buluşma ve oturum (karar)

Bu RFC'deki türetme etiketleri (`rv/listen`, `hf/toren/...`) telde çekirdeğin önekiyle yazılır (`yuva/v2/` + etiket; `core/core/crypto` `PREFIX`).


a. **Anahtarlar.** DHT'de konu ve duyuru yoktur. Her çift için çift sırrından saatlik dilimle türetilen anahtar çiftleri: dinleme `derive(çift, 'rv/listen', ben, dilim)`, arama `derive(çift, 'rv/dial', ben, dilim)`. Üyenin imza anahtarı DHT'de görünmez.
b. **Güvenlik duvarı.** Dinleyen yalnız o çiftin karşı tarafının e−1, e, e+1 dilimlerindeki arama anahtarını kabul eder; öbür her bağlantı el sıkışmadan önce reddedilir. Aynı anahtardan 3 başarısız HELLO o dilim için kapatır.
c. **Tek oturum.** Aynı çiftte memberId'si küçük olan arar, büyük olan dinler.
d. **HELLO.** `v=2`, familyId, memberId, cihaz sertifikası, defter uzunluğu ve başı, yetenek bitleri; imza `hash('hello', el sıkışma özeti, familyId, memberId, defter başı, uzunluk)` üstünde. Doğrulama: aynı aile, aktif üye, buluşma anahtarının çiftiyle aynı kimlik, defterdeki sertifika, imza. 10 sn içinde HELLO gelmezse oturum kapanır. Doğrulanmadan hiçbir zarf işlenmez.
e. **Zarf.** Doğrudan oturumda ek mühür yoktur (Noise yeter); emanet yolunda çift sırrından mühür (RFC-0003 §6.4).
f. **Eşitleyiciye yüz.** `ag = { gonder(peerHex, tür, gövde), dinle({ baglandi, koptu, al }) }`. Defter değişince buluşma yeniden kurulur; çıkarılan üyenin çift sırrı üretilmez.

## 5. Tören (karar)

a. **QR.** `yuva://j/2/ ‖ base64url(v=2, kind, famHint(8), inv(16), rv(32), sec(16), exp)`; `rv` gösterenin geçici buluşma açık anahtarı, `sec` davet sırrı. Gösteren yalnız `derive(sec, 'hf/toren/arama')` anahtarıyla gelen tek bağlantıyı kabul eder.
b. **Sıra.** JOIN_HELLO ⇄; iki tarafta 5 resim; aile tarafı onaylayınca JOIN_DRAFT (davet edenin imzalı ADD_MEMBER'ı); yeni gelen onaylayınca JOIN_SIG; aile tarafı uygular ve JOIN_LEDGER. "Farklı" denirse oturum kapanır.
c. **5 resim.** Tören anahtarı `derive(X25519(geçici anahtarlar), 'hf/toren/anahtar', sec, transkript)`; transkript el sıkışma özetini ve iki sertifikayı kapsar. Resimler `derive(tören anahtarı, 'hf/toren/sas')`'ın ilk 30 biti (5 × 6 bit, 64 resim).
d. **Süreler.** QR ekranda 60 sn'de yenilenir (kurucu T8; ekranda geri sayım), tek QR'ın ömrü en çok 180 sn; tarayan 3 deneme, 500 ms arayla. Yenileme D65'ten beri kodda (`worklet/test/d65.js`).
d2. **Uzaktan katılım (D106, İstek 181 kararı; Kerem 25 Ekim 2026).** `INVITE_START { tur: 'uye', uzaktan: true }` aynı töreni kurar; QR metni bağlantı olarak herhangi bir yoldan (mesaj) gönderilir, taşıyıcı güvenilmez sayılır. Güvence 5 resmin sesli ya da görüntülü aramada karşılaştırılmasıdır.
   - **K1:** Uzaktan kod tektir, yenilenmez; ömrü **10 dakika** (yüz yüze 180 sn kalır). Taslak `ADD_MEMBER { remote: true, activatesAt ≥ ts + 24 saat }`. 24 saatlik beklemede ailenin ebeveynlerine "<ad> uzaktan ekleniyor, <saat>'e kadar iptal edebilirsiniz" bildirimi (SDK `security` olayı `uzaktan_ekleniyor`); herhangi bir ebeveyn `REVOKE` ile iptal eder (RFC-0003 §5.6). Uzaktan törende aile tarafı yeni gelenin `JOIN_HELLO` bitlerinde `UZAKTAN_IPTAL`'i ister, yoksa `UPDATE_REQUIRED` (Codex 10. tur): bekleyen telefon oturumu olmadığı için bitini başka yoldan bildiremez, iptal ise onun defterine de girer.
   - **K2:** Yeter sayı (bütün ebeveynler; tek ebeveynde bir yetişkin de) tören içinde bu telefon ve yeni gelenle tamamlanmıyorsa tören, öbür imzacıların `LEDGER_SIGN`'ını beklerken **en çok 10 dakika** açık kalır (öneri olağan eşitlemeyle onlara gider; aile tarafına `onay-bekleniyor`, yeni gelenin süresi de uzar). Yeni üye deftere girince (öneri hangi telefonda tamamlanırsa) `JOIN_LEDGER` gider. Süre dolarsa tören `QUORUM_TIMEOUT` ile kapanır, öneri yerelde reddedilir; defterde iz kalmaz. Yüz yüze törende davranış değişmez.
     - **Son tarih bütün telefonlarda (Codex 10. tur, 28 Ekim 2026):** Süre önerinin kendi (imzalı) zamanından sayılır: son tarih `ts + 10 dakika`. Her telefon uzaktan `ADD_MEMBER` önerisini bu son tarihten sonra kabul etmez, imzalamaz (`PROPOSAL_EXPIRED`) ve uygulamaz; bekleyen öneri düşer (`core/core/ledger/proposals.js`). Tören son tarihten sonra **1 dakika** daha açık kalır: son anda başka telefonda tamamlanan ekleme eşitlemeyle gelsin. Telefon saatleri arasındaki fark bu payın içinde kalmalıdır; fazlası `docs/audit/sinirlar-ve-kapsam-disi.md` madde 29'da.
     - **Tekrar:** Aynı `JOIN_SIG`'in tekrarı yok sayılır: bekleme bir kez başlar, süre uzamaz, ikinci yoklama zamanlayıcısı kurulmaz.
   - **K3:** `ACTIVATE_MEMBER`'ı daveti başlatan ebeveynin telefonu bekleme bitince kendiliğinden yazar; öbür ebeveynler bekleme bitiminden 1 saat sonrasına kadar `INVITE_ER_PENDING` alır, sonra ürün düğmesiyle yazar (kanal 450 `REMOTE_MEMBER_ACTIVATE`; iptal 451 `MEMBER_REVOKE`). Aynı üyeye ikinci `ACTIVATE_MEMBER` etkisizdir; çatallanmada iki dal tek etkin üyeye varır.
   - **K4:** Yeni gelenin ekranı `LedgerApi.waiting(me)` (`tur: 'uzaktan'`, `bitis`); iptalde worklet `davet-iptal` olayı ve yerel aile silinir. İptal yeni gelene sınırlı iptal oturumuyla ulaşır (RFC-0003 §5.6 ve §6.1, rol `davetli`; Codex 10. tur): bekleyen telefon beklerken yalnız yetkilileri arar; aile tarafı onu yalnız iptalden sonraki 30 gün içinde tanır ve yalnız imzalı `GUEST_REVOKED` yollar.
e. **Yuva Hat'tan farklar.** Yuva Hat JOIN_LEDGER'ı 5 resimden önce gönderir, QR'ı 60 sn'de yeniler ve tören anahtarını çift sırrına katar. Havenfold'da defter, iki taraf 5 resmi onaylamadan gitmez (yeni gelen aile defterini onaydan önce görmez). Mac önerisi: bu fark kalır; QR yenileme 60 sn (Yuva Hat'la aynı, ekranda geri sayım); tören anahtarı çift sırrına katılır ve gizli olarak saklanır (§7 c).

## 6. Pil ve arka plan (karar)

- Bare `suspend`: yeniden arama durur, oturumlar kapanır, `dht.suspend()`. `resume`: `dht.resume()`, buluşma yenilenir, üyeler kısa HELLO süresiyle aranır. Ağ türü değişince oturumlar kapanır ve yeniden kurulur.
- Yeniden arama normalde 30 sn; başlangıçta, yeni üyede ve kopuşta 3 dk boyunca 5 sn'de bir. Zamanlayıcılar `unref`.
- Bağlantı sayısı üye sayısıyla sınırlı.

## 7. Kararlar (Kerem 24 Ekim 2026'da her maddede Mac önerisini onayladı)

a. **Emanet ve Posta Kutusu.** Kayıt eşitlemesi kutu kovalarıyla çevrimdışını zaten kapsıyor; pay teslimi Posta Kutusu'ndan yasak (RFC-0027 §1b). **Öneri:** v1'de Havenfold Posta Kutusu kullanmaz. Çevrimiçi telefonda ve Aile Kutusu'nda emanet (7 gün, 50 MB, gönderen başına 10 MB) yeter. Kutusu olmayan ve iki telefonu hiç aynı anda açık olmayan aile için Posta Kutusu ayrı bir RFC'de.
b. **Zil.** iOS'ta bildirimle uyandırma (25 sn sınırı). **Öneri:** v1'de yok. Bakım Masası'nın kaçırılan doz merdiveni gibi zamanlı uyarılar her telefonun kendi yerel bildirimiyle çalışır.
c. **Tören anahtarının saklanması.** **Öneri:** çift sırrına girer; iki tarafta `durum`'da gizli alan olarak saklanır (kasa değil). Yuva Hat'la aynı. **Kapsam (Mac kararı, 24 Ekim 2026; dell D74):** tören anahtarı bugün yalnız taşıyıcının çift defterine (buluşma ve oturum) girer; çift sırrını kullanan öbür yerler (emanet mührü, yerel kanal) Yuva Hat uyumu için değişmez. Bir taraf anahtarı kaydetmeden düşerse o çift taşıyıcıda buluşamaz ve tören yinelenir.
d. **Kutu ↔ telefon.** **Öneri:** kutu aynı buluşmayı kullanır (rolü `kutu`); düğüm yazılımı aynı yığını Node'da çalıştırır.
e. **Önyükleme düğümleri.** **Öneri:** v1'de HyperDHT'nin genel önyükleme düğümleri, yedek olarak EserX'in iki kendi düğümü. Düğüm adresleri sürümle gelir, uzaktan değiştirilmez.
f. **Aynı telefonda iki uygulama.** **Öneri:** her uygulama kendi DHT düğümünü açar (v1, basit ve yalıtılmış); taşıyıcının yerel kanaldan paylaşılması (RFC-0017 §10) pil ölçümünden sonra ayrı karar.

g. **Dilim geçişi ve dinleme bütçesi (dell D47 ölçümü, `kollar/D-olcum.md`).** Her dinleme sunucusu saatte yaklaşık 3.600 DHT isteği üretir. Çift başına iki dilim (`e`, `e+1`) açık tutulursa maliyet ikiye katlanır. **Öneri:** `e+1` yalnız dilim bitmeden 5 dakika önce açılır (kısa örtüşme). RFC-0005 §11.3'teki bütçe "16 çift" yerine "en çok 16 dinleme sunucusu" olur. RFC-0005 §11.2'deki kutu zorunluluğu (8 kişinin üstü) kalır, gerekçesine dinleme maliyeti eklenir.
h. **Arka planda dinleme.** **Öneri:** kutulu ailede ve ekipte kişiler arası dinleme yalnız uygulama öndeyken; arka planda yalnız kutu dinlenir. Kutusuz ailede (8 kişiye kadar) arka plan davranışı §6'daki gibidir. **Bağlantı (Mac, 24 Ekim 2026; dell D74, Air A45):** taşıyıcı `arkaPlan(bool)` ile bildirilir; Yuva Defteri bugün bunu uygulamanın kendi worklet girişinde ayrılan bir yaşam çerçevesiyle (`{ id: null, yasam: { arkaPlan } }`) taşır. RFC-0024'e kanal komutu olarak alınması sonraki iş; alınınca uygulama ona geçer.
i. **Çift başına sunucu mu, tek sunucu mu?** Çift başına ayrı dinleme sunucusu, dışarıdan bakanın çiftleri birbirine bağlayamaması içindir. Tek sunucu ve güvenlik duvarında bütün çiftlerin arama anahtarları maliyeti sabitler, ama bir kişinin bütün çiftlerdeki dinleme anahtarı aynı olur ve bağlanabilir. **Öneri:** çift başına kalsın (gizlilik); maliyet g ve h ile sınırlanır.

j. **Kutu her zaman dinleyen taraf (dell D58).** "Büyük kimlik dinler" kuralıyla kutu, kimliği kendisinden küçük her üyeyi iki dilimde dinler (32 kişilik ekipte en kötü 62 sunucu, saatte ~220 000 DHT isteği, ~2,4 MB/saat). **Öneri:** kutu her zaman dinler, telefonlar kutuyu arar; telefon başına kutu için tek sunucu, telefonların dinleme bütçesinden çıkar.
k. **Paket sınırı.** Taşıyıcı bugün `worklet/` içinde; düğüm yazılımı oradan alıyor. **Öneri:** onaydan sonra ortak bir pakete (`@havenfold/transport`) taşınır.
l. **Kutunun çalışma ortamı.** Düğümün sistem birimi kutu çekirdeğini Bare'de çalıştırır (RFC-0007). **Mac kararı (RFC-0007 ile tutarlılık):** kutu çekirdeği Bare'dedir; `node/box-share.js` gibi Node'a özgü modüller `#fs` eşlemesiyle Bare'de de çalışır (dell D62).

## 8. Güvenlik değerlendirmesi

- Dışarıdan bakan biri buluşma anahtarlarını üye kimliklerine bağlayamaz (çift sırrından türetilir, saatte bir değişir). Bir çiftin aynı dilimdeki trafiğini IP düzeyinde görebilir; bu HyperDHT'nin doğasıdır.
- Çıkarılan üyenin çift sırrı üretilmez; buluşma anahtarı bilinse bile güvenlik duvarı ve HELLO doğrulaması oturumu reddeder; eşitleyici çıkarılana zarf göndermez.
- Tören: QR'ı görmeyen biri buluşmaya bağlanamaz. QR'ı görüp araya giren biri 5 resmi iki tarafta eşleştiremez, çünkü resimler el sıkışma özetine ve iki geçici anahtara bağlıdır.
- Yerel testnette düğümler `firewalled: false` ile kuruludur (aynı makinede delik açma arada bir yarıda kalıyor). Telefonda bu seçenek kullanılmaz.

## 9. Üretime açılmadan önce

- Deneme sürümünde olmayanlar: HELLO başarısızlık sınırı, emanet, suspend/resume, ağ değişimi, tören anahtarının çift sırrına girmesi.
- İzinler: Yuva Defteri'nin Android sürüm derlemesinde bugün internet izni yok (yalnız hata ayıklamada; Lenovo L30). Taşıyıcı açılınca `INTERNET` ve `ACCESS_NETWORK_STATE`, iOS'ta yerel ağ açıklaması (`NSLocalNetworkUsageDescription`) gerekir; mağaza gizlilik yanıtları (`docs/magaza/gizlilik.md`) buna göre güncellenir.
- Gerçek iki telefonla deneme: aynı Wi-Fi, farklı ağlar (mobil veri ↔ ev), NAT arkası; pil ölçümü (bir saat arka planda).
- Bağımsız güvenlik incelemesi (Mac), sonra bayrak kalkar. O zamana kadar `deneysel: true` olmadan `EXPERIMENTAL_DISABLED`; telefon paketi taşıyıcıyı içermez.

## 10. Uygulama sırası

1. ~~Bu RFC onaylanır (Kerem).~~ Onaylandı, 24 Ekim 2026.
2. dell: §7 kararlarına göre deneme sürümünü tamamlar (§9 ilk madde) ve testleri.
3. Mac: bağımsız inceleme.
4. Yuva Defteri: `HENUZ_BAGLANMAYANLAR`'dan `toren.*` çıkar; gerçek iki telefonla deneme.

## Ek: RFC-0033 (onaylı, 24 Ekim 2026)

- **Cihaz oturumu** (RFC-0033 §9 a, o): taşıyıcı `cihazlar: true` ile işçiyle de oturum açar. İşçi dinler, telefon arar (§7 j'deki kutu kuralı gibi); HELLO'da `cihaz` rolü kabul edilir; §4 d'deki "aktif üye" koşulu cihaza genişler. İşçi yalnız üyelerle oturum kurar. Telefonda defterde aktif cihaz varsa açıktır, düğümde bayrakla. Üye ↔ cihaz oturumunda yalnız defter eşitlenir (LEDGER_REQ / LEDGER_EVENTS); telefon işçinin `BLOB_REQ`'ini dosya deposundan cevaplar.
- **Cihaz töreni** (§9 n): kind 2 QR'ı düğüm gösterir, aile tarafı okutur. Taslak `DEVICE_ATTACH`, imzacılar yeni cihaz ve ebeveyn; yeni cihazın imzası `JOIN_SIG` ile gelir; `JOIN_LEDGER`'da yeni gelenin aktif cihaz olması aranır. Kod: `core/transport/ceremony.js` `isciDavet` (`kutuDavet` ile ortak `dugumDavet`).
- **Çerçeve sınırı** (§9 b): gövde en çok 1 MiB (`EN_BUYUK_GOVDE`); aşan gelen çerçeve işlenmez, oturum kapanır (HELLO'dan önceyse başarısız HELLO sayılır), `FRAME_TOO_LARGE`. Tören soketinde aynı sınır. `LEDGER_EVENTS` 1 MiB'ı aşan defter için parçalanmalıdır (açık iş).
