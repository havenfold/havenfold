# Havenfold

**Havenfold, bir ailenin ya da küçük bir işletmenin zaten sahip olduğu cihazları, hesapsız ve merkezsiz, uçtan uca
şifreli kendi bulutuna çeviren açık kaynak çekirdektir.**

Web sitesi: [havenfolddev.com/tr](https://havenfolddev.com/tr)

[English: README.md](README.md)

## Neden

Çoğu evde ve dükkânda çekmecede duran, hâlâ çalışan cihazlar var: eski bir laptop, emekli bir telefon, kimsenin
kullanmadığı bir tablet. Fotoğraflar, belgeler ve şifreler ise bulut şirketlerinde duruyor; şirket hizmeti kapatınca
ya da fiyatı artırınca veri de gidiyor ya da pahalılaşıyor. Havenfold bu cihazları ailenin telefonlarıyla birlikte
ailenin (ya da ekibin) kendi bulutuna çevirir: insanlar yüz yüze katılır, her cihaz kendi anahtarını tutar, içerik
uçtan uca şifrelidir, ortada tek bir cihaz ya da şirket yoktur. İçeriğinizi biz bile göremeyiz, kim olduğunuzu da
bilmeyiz.

> **Durum: alfa öncesi.** Gerçek veri için kullanmayın. İlk etiketli sürüme kadar arayüzler, aktarım biçimleri ve
> disk biçimleri haber verilmeden değişebilir.

## Bugün evimde ne kurabilirim?

Dürüst cevap: **son kullanıcı için henüz kurulacak bir şey yok.**

- Telefon uygulamaları (Yuva) bu depoda değil; ayrı, kapalı ürün depolarında geliştiriliyor.
- Aile Kutusu, boş bir makinesi olan geliştiriciler için deneyseldir: Ubuntu Server 24.04, TPM 2.0 ve kutunun QR'ını
  tarayacak, Havenfold üstüne kurulmuş bir telefon uygulaması gerekir ([README](README.md#running-a-family-box-experimental-needs-spare-hardware)).
- Kurulum USB'si GitHub'da sanal makinede baştan sona denendi; gerçek donanımda henüz denenmedi.
- Kendi bilgisayarınızda beş dakikada görmek için: `npm ci`, `(cd worklet && npm ci)`, `npm run demo`. İki "telefon"
  yerel bir ağda aile kurar ve bir kaydı eşitler; `--box` ile Aile Kutusu da katılır.

## Durum (kısaca)

| Parça | Bugün |
|-------|-------|
| Defter ve tören, kayıt, görev, olay katmanları | Yazıldı; Node.js ve Bare'de testli, çok cihazlı testler yerel ağda |
| Kasa | Kod var; bağımsız denetimden önce yayına girmez |
| Taşıyıcı | Telefonda bayrak arkasında, düğümde açık |
| Düğüm yazılımı ve Kurulum USB'si | Sanal makinede baştan sona kuruldu; gerçek donanımda denenmedi |
| OCR görev imajı | CI'da amd64'te derlenip çalıştı |
| Telefon uygulamaları, Posta Kutusu | Bu depoda değil |
| Güvenlik | Bağımsız güvenlik denetimi henüz yok |
| Gerçek kullanım | Henüz gerçek bir evde çalışmadı |

Tasarım 35'ten fazla RFC ile yazılı olarak sabitlendi ([`docs/rfc/`](docs/rfc/)); RFC'lerdeki "Onaylandı" tek kişinin,
proje sahibinin onayıdır ([GOVERNANCE.md](GOVERNANCE.md)). Ayrıntılı tablo: [README, Status](README.md#status).

## Yuva ve Mekan

Havenfold'u Eser Teknoloji geliştirir. Ev ürünleri ([Yuva](https://yuvaapp.org): Yuva Defteri, Acil, Pati ve Bakım) bu
çekirdeğin üstüne kurulur; iş yeri ürünleri ([Mekan](https://mekanapp.com)) sonraki aşamada aynı çekirdeğe geçer. İkisi de
ayrı ve kapalı ürünlerdir. Çekirdek açıktır: ürünler onu kullanır, çekirdek dosyalarındaki değişiklikler açık kalır
(MPL-2.0).

## Yol haritası

- **Şimdi:** depo herkese açıldı; çekirdek paketleri, düğüm yazılımı, OCR imajı ve Kurulum USB'si var.
- **Sıradaki:** Ev Makinesi'nin gerçek evlerde çalışması, bağımsız güvenlik denetimi ve ilk imzalı sürüm (`v0.1.0-alfa`).
- **Sonra:** kasanın yayını, herkes için Kurulum USB'si, Windows, macOS ve Raspberry Pi işçileri.

Tam yol haritası: kurucu belge §20.

## Nereden başlanır

- [`KURUCU-BELGE.md`](KURUCU-BELGE.md): ilkeler, mimari, adlar, numaralar, lisanslar ve yol haritası.
- [`docs/rfc/`](docs/rfc/): protokole ve çekirdeğe dokunan her değişiklik RFC ile yapılır.
- [`docs/mimari.md`](docs/mimari.md): yeni katılan geliştirici için mimari turu.
- [`docs/audit/`](docs/audit/): denetim paketi (kripto envanteri, anahtar yaşam döngüsü, saldırı yüzeyi,
  tehdit modeli, bilinen sınırlar).

## Geliştirme

Gerekenler: Node.js 22 (`.nvmrc`; CI yalnız 22'yi sınar, 24'te bazı adımlar bugün düşüyor), npm, git; macOS ya da Linux.

```bash
npm ci
(cd worklet && npm ci)
npm test
```

Tek paket için hızlı yol: `cd core/records && npx brittle-node test/*.js`. `npm test`, `scripts/check.sh`'ı koşar:
bütün testler Node.js'te, çekirdek paketleri ve SDK Bare'de de; vektörlerin bağımsız yeniden üretimi, lisans ve SPDX
denetimi, türetme etiketleri, kapsam eşikleri ve kısa bulanık test.

## Lisanslar

Çekirdek, telefondaki çekirdek paketi, düğüm yazılımı ve kurulum aracı MPL-2.0; test vektörleri ve numara tabloları,
SDK, `export-open` ve görev imajları Apache-2.0; sunucu tarafı referans kod (bugün `services/receiver`) AGPL-3.0-only;
belgeler CC BY 4.0. Ayrıntı: kurucu belge §17.1 ve [`LICENSES/`](LICENSES/).

## Taahhüt

Yayımlanmış kod daha kısıtlayıcı bir lisansa çevrilmeyecek. Ücretsiz bir özellik ücretli katmana taşınmayacak.
Proje satılırsa marka ve depo bir vakfa devredilecek.

Katkı: [CONTRIBUTING.md](CONTRIBUTING.md) (DCO, `Signed-off-by`; Türkçe ya da İngilizce). Güvenlik açığı bildirimi:
[SECURITY.md](SECURITY.md).
