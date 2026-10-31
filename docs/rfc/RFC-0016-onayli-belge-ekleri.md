# RFC-0016 — Onaylı belgelere ekler (kurucu belge 1.2)

> Durum: **Onaylandı** (Kerem, 23 Ekim 2026) · 23 Ekim 2026 · Yazan: Havenfold çekirdek ekibi · Onay: Kerem
> Amaç: RFC-0005–0015'in onaylı belgelere (kurucu belge 1.1, RFC-0001–0004) getirdiği değişiklikleri tek yerde toplamak. Bu RFC onaylanınca aşağıdakiler işlenir ve kurucu belge 1.2 olur.

## 1. Neden ayrı bir RFC

Yeni RFC'ler onaylı belgelere dokunuyor. Her biri kendi "Kurucu belgede değişecekler" bölümünde öneri yazdı. Bu öneriler bu RFC'de birleştirildi, tekrarlar ayıklandı ve numara çakışmaları çözüldü. Onaylı belgeler yalnız bu RFC'nin onayıyla değişir.

## 2. Onaylı RFC'lere ekler

| Belge | Ek |
|-------|----|
| RFC-0001 §4.1 | "`_` ile başlayan alanlar çekirdeğe ayrılmıştır" cümlesi şöyle olur: "Ayrılmış alanlar RFC-0015 §2'dedir: `_src` kaynak başvuruları listesi, `_conf` 0–100 güven, `_ai`, `_aiyol`, `_keep`, `_subj`, `_v`, `_t`." |
| RFC-0001 §11.2 | Konteyner uygulamalarının yedek dosyaları için 90 günlük silme beklemesi uygulanmaz (RFC-0011). |
| RFC-0001 §13 | Süreli kayıtlar (`_keep`) süresi dolunca bütün işlemleriyle silinir (RFC-0006 §7.2). |
| RFC-0002 §4 | `maxTaskRamMB` hesabından konteyner uygulamalarına ayrılan bellek düşülür. `NODE_CAPS`, uygulama barındıran düğüme de gider. |
| RFC-0002 §5 | Yeni görev türü `hf.task.embed` (RFC-0013). |
| RFC-0002 §11.3 | Konteynersiz işçi RFC-0008'e göre çalışır. |
| RFC-0003 §5.8 | `KIND = 'ekip'` RFC-0005 ile geçerlidir; RFC-0005'in olayları 24–26. |
| RFC-0003 §6.1 | Oturum tablosuna eklenenler: `UPDATE_*`, `NODE_PROFILE`, `UC_*`, `APP_WIPE_REPORT`, `APP_LINK`, `VAKA_*`, `EKIP_CIKIS*`, `HIZMET_*`. Her mesajın hangi oturumda geçerli olduğu kendi RFC'sinde yazılıdır. |
| RFC-0003 §6.4 | Mühür kuralı genişler: "Topluluk içi bütün zarf türleri (0x80–0xFE), emanet ya da Posta Kutusu yolundan geçerken K12 mührüyle kapatılır. 0x90–0x97 için anahtar `derive(pair, 'hf/task/')`, diğerleri için `derive(pair, 'ctrl')`. `CTRL_TYPES` hepsini kapsar. Yalnız doğrudan oturumda geçerli olan bir tür emanetten gelirse atılır." |
| RFC-0003 §8 | Silme anahtarı QR'ı `HFK1` biçimindedir (`ids`, `hostId`, `retireNonce`). Çok diskli cihazda rapor kümesinin özeti `hf/wipe-report-set/` etiketiyle alınır (RFC-0007). İşletim sistemi silinmeyen cihaz `uygulama-verisi-silindi` raporu verir (RFC-0008). |
| RFC-0003 §10 | HELLO bitleri: `BAGLANTI 256` (RFC-0009), `AFET 512` (RFC-0012), `YZ 1024` (RFC-0013), `UYGULAMA 2048` (RFC-0011), `HIDE_PRESENCE 4096` (RFC-0015). Çekirdek komutları: 260–269 RFC-0006, 270–279 RFC-0013, 280–289 RFC-0005, 290–299 RFC-0009, 300–309 RFC-0010, 310–319 RFC-0012, 320–329 RFC-0011, 330–339 RFC-0007, 340–349 RFC-0008, 350–359 RFC-0015. Zarf aralıkları: 0xA0–0xA7 RFC-0009, 0xA8–0xAF RFC-0011, 0xB0–0xB7 RFC-0012, 0xB8–0xBF RFC-0013, 0xC0–0xC7 RFC-0006, 0xC8–0xCF RFC-0005, 0xD0–0xD7 RFC-0010, 0xD8–0xDF RFC-0007, 0xE0–0xE7 RFC-0008; 0xE8–0xFE boş, 0xFF ayrılmış. |
| RFC-0004 §3.1 | Cihaz payı yalnız Linux konteyner düğümünde ve TPM mührü doğrulanmışsa tutulur. Tepsi uygulaması (Windows/macOS) ve eski Android kutu pay tutmaz. Mekan'da kişi tarafı sahip, yönetici ve çalışandır (RFC-0005). |

## 3. Kurucu belge 1.2 değişiklikleri

### 3.1 Katman, kavram, bileşen

- **§2, §5.1:** Eser'in işlettiği servislere iki satır eklenir:
  - **Yapay zeka geçidi** (RFC-0013): "Dışarı sor" ve Yuva Aile bulut kotası.
  - **Hizmet geçidi** (RFC-0010): Türkiye'de barındırılır.
  - İkisinin de protokolü açık, işletimi Eser'in.
- **§4 kavramlar:** Hizmet, Rutin, Kural, Kart, Vaka (RFC-0006). Dışa aktarma Havenfold kabıyla yapılır (RFC-0014).
- **§5.1:**
  - Çekirdek Bare üzerinde, denetçi Node üzerinde çalışır.
  - `havenfold-yetki` adlı kök yardımcı birim eklenir (RFC-0007).
  - SDK ortak alanları RFC-0015'tedir.
- **§5.2:**
  - Windows ve macOS işçi yalnız OCR ve ses yazıya dökme yapar (RFC-0008).
  - Eski iPhone yalnız ekran ucu olabilir.
  - Android'de kutu ve uç aynı cihazda olmaz.

### 3.2 Topluluk ve cihazlar

- **§6 genel not:** Ekip topluluğunda "ebeveyn" kuralları sahip ya da yönetici olarak okunur; ayrıntı RFC-0005'tedir.
- **§6.1:** Birleşik cihaz, tek kurulumda art arda iki törenle eklenir.
- **§6.2 Mekan sütunu:**
  - Kişi üye sınırı 32; 8'in üstünde kutu zorunlu.
  - Sahip en çok 3.
  - Yer başına 1 kutu.
  - Yer başına 16, toplamda 64 bağlı cihaz.
  - En çok 8 misafir.
- **§6.3:** `KIND ekip` geçerli olur; olaylar 24–26 eklenir (RFC-0005).
- **§6.5:** Mühür bütün 0x80–0xFE türlerini kapsar (§2'deki RFC-0003 §6.4 eki).
- **§6.7:** Android uç kamera tanımı eklenir. Kamera akışı yalnız doğrudan bağlantıda gider (RFC-0008).

### 3.3 Kayıt ve görev

- **§7.2:** Süreli kayıt (`_keep`) temizliği.
- **§7.6:**
  - Ekipte kişisel koleksiyon yoktur.
  - Konu alanı `_subj` olur (`yer:`, `device:` önekleriyle).
  - Kasa'yı ekipte tüm sahipler imzalar.
- **§7.7:**
  - Olaylar koleksiyonuna yetişkin de yazar ("Ben bakıyorum" diyebilsin diye).
  - Yeni koleksiyon: Paylaşımlar (RFC-0010).
  - Yuva Defteri'nin ürün koleksiyonları (Kalkan, Kalkan:<korunan>, Sağlık:<üye>) §7.6 kurallarına uyar.
- **Yeni §7.8:** Mekan varsayılan koleksiyonları (RFC-0005).
- **§8.4:** Mekan görev izinleri ve sürekli görevler (RFC-0005). Kişi başına ölçüm yapan görev türleri ekipte yasaktır.
- **§8.5:** Yerleştirme `NODE_PROFILE.features` uyumuna da bakar.
- **§8.6, §12:**
  - İşçi yalnız kuralları çalıştırır.
  - Olay bir kayıttır.
  - `_conf` yüzdedir (RFC-0006).
- **§8.7:**
  - Yeni tür `hf.task.embed`.
  - Windows ve macOS işçi RFC-0008'e göre çalışır.

### 3.4 Düğüm

- **§9.2:**
  - Disk şifreleme LUKS2 + Clevis, PCR 7 bağlı; kurtarma anahtarı Kasa'da.
  - `havenfold kur` yolunda disk şifresiz olabilir; arayüz söyler.
  - Kasa payı ve kimlik TPM'ye PCR'sız mühürlüdür.
  - Wi-Fi parolası Kurulum USB'sinde bulunmaz.
- **§9.3:** Üretici ve cihaz örnekleri kaldırılır; eşikler RFC-0007'ye bağlanır.
- **§9.4:**
  - Yedek kök anahtar önceden taahhüt edilir.
  - Ürün bildirimleri ve kanal değişimi onay ister.
  - Güncellemeler topluluk içinde paylaşılabilir.
  - Katalog anahtarı (RFC-0011) ve model bildirimi (RFC-0013) aynı kökle imzalanır.
- **§9.5:**
  - EFI bölümünde silme bileti.
  - eMMC satırı eklenir.
  - Blok silme, şifreleme silmeden önce yapılır.
  - Çok diskli cihazlarda rapor kümesi verilir.
- **§9.6:** Eşikler RFC-0007 §11.2'ye bağlanır.

### 3.5 Kasa, ağ, güvenlik

- **§10.2:**
  - Tepsi uygulaması ve eski Android kutu pay tutmaz.
  - Mekan'da kişi tarafı sahip, yönetici ve çalışandır.
- **§11:**
  - Yeni satırlar: Yuva Bağlantı rölesi (ücretli, kör, jeton cihaz başına; RFC-0009), büyük aktarım deposu, güncelleme kaynağı, yapay zeka ve hizmet geçitleri.
  - "Cloudflare Tunnel" satırı "ailenin kendi Tunnel'ı" olur.
  - **HF11 açıklaması:** Bağlantı rölesi bir Tunnel ya da VPN değildir. Eser aile cihazlarını birbirine bağlayamaz; gördüğü, Posta Kutusu düzeyindedir.
  - Afet modu: yerel ağda tam oturum, Bluetooth'ta kısa metin (RFC-0012).
  - Yerel tünel ayrıntısı RFC-0011'dedir.
- **§12:** Yuva Kutusu'nda deprem uyarısını işçi kimliği açar. Yakındaki cihazlar listesi yalnız işçinin kendi oturumlarından gelir (H4).
- **§13.1:** Tehdit numaraları:
  - T14–T17: RFC-0005 ve RFC-0010.
  - T18–T19: RFC-0013.
  - T20: RFC-0006.
  - T21: kök anahtarın çalınması (RFC-0007).
  - RFC-0008, 0009, 0011 ve 0012'nin tehditleri T22'den itibaren sırayla numaralanır: uç kameranın yetkisiz izlenmesi, konteynersiz işçide yönetici yetkili yazılım, Bağlantı hizmetinin ele geçirilmesi, kötü niyetli konteyner uygulaması, telefondaki yerel tünel dinleyicisi, Bluetooth ile izleme, kötü niyetli afet taşıyıcısı.
- **§13.2 protokol içi:**
  - `crypto_secretstream_xchacha20poly1305` ve Argon2id kap için eklenir (RFC-0014).
  - **Bilinen istisna:** Yuva Hat'ın bugünkü arama çerçevesi ChaCha20-Poly1305 (IETF) kullanıyor. Varsayılan olarak bir sonraki arama sürümünde XChaCha20-Poly1305'e geçer.
- **§13.2 protokol dışı:**
  - SHA-256 (ISO, OCI ve geçit özetleri)
  - Mağaza fişi doğrulaması (ES256/X.509)
  - İşletim sistemi anahtar saklama ve paket imzaları
  - Mekan lisans anahtarı
  - Hizmet dizini anahtarı
  - Geçitlerin TLS'si

### 3.6 Uygulama, ürünler, hukuk

- **§14.2:**
  - Bildirim örneği değişir: `needs.class` ve `local-tunnel` kalkar.
  - Uygulamayı yalnız ebeveyn yönetir.
  - Köken: Eser seçkisi ya da kullanıcı eklemesi (uyarıyla).
  - Uygulamalara Bluetooth verilmez.
  - Havenfold düğümleri Home Assistant'ta salt okunur cihaz olarak görünür.
- **§15.2 Yuva Defteri:**
  - Platform modelleri (Apple ve Gemini Nano) Türkçe kabul testinden geçmeden kullanılmaz.
  - Telefona yalnız gömme modeli indirilir.
  - Asistanın çekirdekteki adı @asistan, Yuva'daki adı @Yuva.
  - Bulut kotası varsayılanı: aile başına ayda 300 soru, kişi başına günde 30. Bu bir varsayılandır, değiştirilebilir.
  - Ek koleksiyonlar: Kalkan, Sağlık.
  - Kaynağı olan her kayıt `_src` ile bağlanır.
- **§15.3:** Yuva Kamera RFC-0008'e, Acil ve Deprem RFC-0012'ye bağlanır.
- **§15.5:**
  - Kişi algılamada Apache-2.0 ya da MIT lisanslı modeller (YOLOX, RT-DETR, RTMPose) kullanılır.
  - Mekanapp'in Havenfold'a taşınması M0–M4 aşamalarıyla yapılır (RFC-0005).
- **§16.1:**
  - Yapay zeka çıktısı işaretlenir (AB Yapay Zekâ Yasası md. 50(2)).
  - Geçitler Türkiye'de barındırılır.
  - Sağlık verisi sahibinin kişisel koleksiyonlarında da (Kişisel, Sağlık:<üye>) tutulabilir.
  - Bağlantı rölesi ve aktarım deposu yurt dışı aktarım listesine girer.
- **§16.2:**
  - Play ön plan servisi beyanı ve kamera açıklaması.
  - Afet modu için Bluetooth izinleri.
  - Tünel web görünümünde dışarı bağlantı yoktur.
- **§16.3:** Yapay zeka kuralları 7–11 eklenir (RFC-0013): modeller veridir, kod değildir; içerik enjeksiyonu savunması; çocuk modu; günlük cihazdan çıkmaz; ilk etkileşimde bildirim.
- **§17.1:**
  - Posta Kutusu ve Bağlantı hizmeti kodu AGPL-3.0.
  - `export-open` Apache-2.0.
  - Hizmet başvuru alıcısı AGPL-3.0.
- **§19.3:** Uyum tablosunda topluluk türü "aile / ekip".

### 3.7 Yol haritası ve kararlar

- **§20:**
  - Faz 1'deki `wipe-report` ifadesi kaldırılır.
  - Faz 3'e Yuva Bağlantı ve RFC-0005 eklenir.
- **§21:**
  - "Büyük ekiplerde MLS" satırı "32 kişiden büyük ekip için RFC" olur; ilk müşteri ihtiyacında açılır.
  - Afet modunun çekirdek tarafı tanımlandı; LoRa için mevzuat notu.
- **§22.1:** RFC-0005–0016 kararları birer satırla eklenir.
- **§22.2:** "09 §11: deprem uyarısını işçi açar" satırı eklenir.

## 4. Uygulama

Bu RFC onaylanınca §2'deki ekler onaylı RFC'lere, §3'teki değişiklikler kurucu belgeye işlenir. Kurucu belge 1.2 olur. RFC-0005–0015'in "Kurucu belgede değişecekler" bölümleri bu RFC'ye bağlanır.
