# Sürüm nasıl çıkar

RFC-0007 §12.1 (sürüm bildirimi), §12.2 (kök anahtar), RFC-0033 §3 (CI imzasız üretir, Kerem çevrimdışı imzalar),
§9 g (paket `.zip`), §9 h (ayrı `SHA256SUMS`). İlk sürüm: **`v0.1.0-alfa`** (sürüm `0.1.0`, kanal `deneme`).

## 1. CI ne üretir

Etiket gönderilince `.github/workflows/release.yml` çalışır:

```sh
git tag -a v0.1.0-alfa -m "Havenfold 0.1.0 alfa" && git push origin v0.1.0-alfa
```

| Dosya | Ne |
|-------|----|
| `havenfold-node-0.1.0-amd64.zip`, `…-arm64.zip` | Düğüm paketi: kanonik ZIP (`node/scripts/zip-write.js`), içinde resmî Node 22 ve Bare ikilileri |
| `hf-task-ocr-1.0.0-amd64.tar` | `hf.task.ocr` görev imajı, `oci-archive` |
| `hf.task.ocr-1.0.0-amd64-kaynak.tar` | İmajdaki GPL/AGPL paketlerin tam kaynağı (`images/source-archive.sh`) |
| `havenfold-node.bildirim.imzasiz` | İmzasız `RELEASE_MANIFEST` gövdesi; `.json` okunur kopyası |
| `SHA256SUMS` | Yukarıdaki dosyaların SHA-256'sı, imzasız |

Hepsi taslak GitHub Release'e yüklenir. Etiketteki `-alfa`, `-beta`, `-rc…` eki kanalı `deneme` yapar; eksiz etiket
`kararli`. Yayın zamanı (`publishedAt`) etiketlenen kaydın zamanıdır; aynı kayıttan aynı paket ve aynı bildirim çıkar.
Bildirimin `keyEpoch` ve `nextRootHash` alanları boştur: imzada kök durumundan dolar. `installer` listesi boştur (ISO
kendi özetini taşıyamaz); `installerDebs` sürüm iş akışında boştur; Kurulum USB'si iş akışı (`install.yml`) debleri `installer/build/deb-collect.sh` ile toplayıp `release-build.js paket --deb-dizini` ile doldurur.

İndirme yeri GitHub Releases'tir (alan adı yok): paketlerin `urls` alanı
`https://github.com/havenfold/havenfold/releases/download/<etiket>/<dosya>`'dır. `havenfold-kur` sürüm bildirimini
kararlı kanalda `…/releases/latest/download/havenfold-node.bildirim`'den (en son yayımlanmış kararlı sürüm), deneme
kanalında GitHub API'sinden bulduğu en yeni yayımlanmış ön sürümden alır; `--etiket vX.Y.Z[-ek]` belirli sürümü,
`--kaynak` aynı düzende bir yansıyı seçer. Taslak release'ler görünmez: dosyalar imzalanıp release yayımlanınca iner.

Denemek için elle: Actions → `release` → "Run workflow" (etiket boşsa `v0.0.0-deneme`; "taslak" seçilmezse yalnız
bildirim ve `SHA256SUMS` iş akışı çıktısı olur).

## 2. Kerem'in çevrimdışı adımları

Kök anahtar yalnız çevrimdışı makinede durur; CI'da, ajan makinelerinde ve bu depoda yoktur. Gerekenler: bu deponun
etiketli kopyası, Node 22, kökte `npm ci`, kök durumu dosyası `kok.durum` (`{ keyEpoch, rootPub, nextRootHash }`,
açık bilgi) ve kök anahtar.

1. Taslak release'ten `havenfold-node.bildirim.imzasiz` ve `SHA256SUMS`'u indirip çevrimdışı makineye taşı.
2. Denetle ve imzala (anahtar dosyası 32 baytlık tohum, 64 baytlık libsodium anahtarı ya da OpenSSL Ed25519 PEM'i):

   ```sh
   node node/scripts/release-sign.js imzala --bildirim havenfold-node.bildirim.imzasiz \
     --sums SHA256SUMS --kok-durum kok.durum --anahtar /anahtar/yolu --cikti imzali/
   ```

   Araç önce özeti yazar (sürüm, kanal, paketlerin ve imajın özetleri, kök parmak izi): CI günlüğündeki değerlerle
   karşılaştır. Anahtarın açık yarısı `kok.durum`'daki kök değilse imzalamaz. İmzalı bildirimi düğümün doğrulayıcısıyla
   (`node/release.js` `bildirimCoz`) ve `SHA256SUMS.sig`'i kökle doğrulamadan hiçbir şey yazmaz.

   Anahtar başka bir araçta (donanım anahtarı, OpenSSL) duruyorsa:

   ```sh
   node node/scripts/release-sign.js hazirla --bildirim havenfold-node.bildirim.imzasiz --sums SHA256SUMS \
     --kok-durum kok.durum --cikti imza/
   openssl pkeyutl -sign -inkey kok.pem -rawin -in imza/bildirim.imzalanacak -out imza/bildirim.imza
   openssl pkeyutl -sign -inkey kok.pem -rawin -in imza/SHA256SUMS -out imza/SHA256SUMS.sig
   node node/scripts/release-sign.js birlestir --bildirim imza/havenfold-node.bildirim.imzasiz --imza imza/bildirim.imza \
     --sums imza/SHA256SUMS --sums-imza imza/SHA256SUMS.sig --kok-durum kok.durum --cikti imzali/
   ```

3. `imzali/` içindekileri taslak release'e ekle: `havenfold-node.bildirim`, `SHA256SUMS` (imzalının aynısı),
   `SHA256SUMS.sig`, `kok-acik.pem`. İmzasız dosyaları sil, release'i yayımla.
4. Kurulum USB'si (isteğe bağlı, Linux): imzalı bildirim ve paketle `installer/build/havenfold-usb-build.sh`
   (`installer/BENIOKU.md`). ISO'nun satırını `SHA256SUMS`'a ekleyip 2. adımı yalnız `SHA256SUMS` için yinele.

İmzaların biçimi: bildirimde `Ed25519(kök, hash('hf/release/', gövde))` (RFC-0007 §12.1), `SHA256SUMS.sig`'de dosyanın
ham baytları üstünde Ed25519 (64 bayt). Kullanıcı OpenSSL ile denetler:

```sh
openssl pkeyutl -verify -pubin -inkey kok-acik.pem -rawin -in SHA256SUMS -sigfile SHA256SUMS.sig && sha256sum -c SHA256SUMS
```

## 3. Araçlar

| Dosya | Ne |
|-------|----|
| `node/scripts/pack.sh` | Paket dizini (RFC-0007 §5 düzeni) |
| `node/scripts/zip-write.js` | Dizinden kanonik ZIP (`core/export/zip.js` yazıcısı; okuyucusu yetki yardımcısının `paket-ac`'ı) |
| `node/scripts/runtime.sh` | Resmî Node 22 (SHASUMS256.txt) ve Bare (`package-lock.json` sha512) ikilileri |
| `node/scripts/release-build.js` | `paket`, `imaj-satiri`, `birlestir`: ZIP, özetler, imzasız bildirim, `SHA256SUMS` |
| `node/scripts/release-sign.js` | `hazirla`, `birlestir`, `imzala`: çevrimdışı imza ve doğrulama |
| `images/image-build.sh` | Görev imajı: `podman build`, `oci-archive`, düğümün göreceği `ociDigest` |
| `node/scripts/image-try.js` | İmajı düğümün kodundan (`node/podman.js`) yükleyip örnek girdilerle çalıştırır |
| `.github/workflows/image.yml` | `images/` değişince imaj derlemesi ve denemesi |
| `.github/workflows/release.yml` | Sürüm |

Paket ZIP'i sıkıştırmasızdır (okuyucu yalnız `stored` açar) ve `node` ile `yetki/node` ayrı kopyalardır; paket büyüktür.
