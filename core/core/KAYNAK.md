# @havenfold/core — kaynak kaydı

Bu paketin başlangıç kodu Yuva Hat deposundan **kopyalandı** (kurucu belge §18.4 aşama A). Aşama C'de Yuva Hat geçmişi bu depoya taşınırken bu dosya eşleme tablosu olarak kullanılır.

- Kaynak depo: `keremeser35/yuva-hat`
- Kaynak kayıt: `origin/main` = `a3df1343d04a8b6dcb080777f7af4db0bf2d3b88` (2026-10-19 05:45 +0300)
- Kopyalama tarihi: 23 Ekim 2026 (görev D0)
- Yuva Hat çalışma kopyasına dokunulmadı; dosyalar `git show origin/main:<yol>` ile alındı.

## Kopyalanan dosyalar

24 Ekim 2026'dan beri her dosyanın başında SPDX lisans satırı (`// SPDX-License-Identifier: MPL-2.0`, RFC-0033), 25 Ekim 2026'dan beri onun altında MPL-2.0 Exhibit A bildirimi (iki satır, RFC-0038) var; tablodaki "Değişiklik: yok" bu satırlar dışındaki içerik içindir.

Yol eşlemesi `worklet/<yol>` → `core/core/<yol>`'dur (aşağıdaki istisnalar dışında). "Blob" sütunu `git rev-parse origin/main:<kaynak>` değeridir; "Son kayıt" dosyaya dokunan son Yuva Hat kaydıdır.

| Havenfold yolu | Yuva Hat kaynağı | Blob | Son kayıt | Değişiklik |
|----------------|------------------|------|-----------|------------|
| `ledger/encoding.js` | `worklet/ledger/encoding.js` | `f591efac` | `a1b8297` | yok |
| `ledger/ledger.js` | `worklet/ledger/ledger.js` | `efea993c` | `fa9ba07` | yok |
| `ledger/policy.js` | `worklet/ledger/policy.js` | `94bd07a6` | `51f047e` | yok |
| `ledger/proposals.js` | `worklet/ledger/proposals.js` | `410fdab5` | `4c6f0f6` | yok |
| `ledger/quorum.js` | `worklet/ledger/quorum.js` | `91412868` | `a1b8297` | yok |
| `ledger/sync.js` | `worklet/ledger/sync.js` | `a53b2f23` | `cc15e4d` | yok |
| `crypto/kdf.js` | `worklet/crypto/kdf.js` | `4fa1faed` | `7a61d9d` | yok |
| `crypto/pair.js` | `worklet/crypto/pair.js` | `f392347b` | `7a61d9d` | yok |
| `crypto/device-cert.js` | `worklet/crypto/device-cert.js` | `c52161a6` | `7a61d9d` | yok |
| `protocol/messages.js` | `worklet/protocol/messages.js` | `09a437f2` | `873df03` | yok (listede yok; `encoding.js` `deviceCert` kodlayıcısını buradan alıyor) |
| `protocol/hello.js` | `worklet/protocol/hello.js` | `4ab59ab6` | `a35780b` | yok (listede yok; `test/ledger.js` HELLO testini kullanıyor, D1'de `caps` buraya gelecek) |
| `core/identity.js` | `worklet/core/identity.js` | `745637ec` | `51f047e` | yok (listede yok; test yardımcısı `createIdentity` kullanıyor) |
| `test/ledger.js` | `worklet/test/ledger.js` | `8f089dea` | `a35780b` | Vektör yolu: `../../packages/protocol/vectors/` → `./vektorler/yuva-hat/` |
| `test/kdf.js` | `worklet/test/kdf.js` | `e45283f5` | `7a61d9d` | yok |
| `test/pair.js` | `worklet/test/pair.js` | `e5b4385b` | `7a61d9d` | `../core/spike-family` → `./yardimci/spike-family` |
| `test/yardimci/defter.js` | `worklet/test/yardimci/defter.js` | `e386b92f` | `a35780b` | yok |
| `test/yardimci/defter-vektor.js` | `worklet/test/yardimci/defter-vektor.js` | `e5fb244a` | `a1b8297` | yok |
| `test/yardimci/spike-family.js` | `worklet/core/spike-family.js` | `81404ab3` | `7a61d9d` | Yalnız testte kullanılan geliştirme ailesi; pakete girmesin diye `test/yardimci/`'ye alındı. `require('../crypto/…')` → `require('../../crypto/…')`. |

### D1'de eklenen kopyalar

| Havenfold yolu | Yuva Hat kaynağı | Blob | Son kayıt | Değişiklik |
|----------------|------------------|------|-----------|------------|
| `core/pairs.js` | `worklet/core/pairs.js` | `d9bdae30` | `a35780b` | RFC-0003 §6.2: cihaz ve misafirle çift sırrı, oturum tablosu denetimi |
| `messaging/seal.js` | `worklet/messaging/seal.js` | `fabdbdb3` | `a1b8297` | RFC-0003 §6.4: `CTRL_TYPES` 0x80–0xFE, `sealEnvelope`/`openEnvelope`, test vektörü için isteğe bağlı nonce |

### D1'de kopyalardaki değişiklikler (RFC-0003)

Aşama C birleştirmesinde bu satırlar Yuva Hat'a gidecek farkı gösterir. Ayrıntı git geçmişindedir.

- `ledger/encoding.js`: olaylar 13–23 ve gövdeleri.
- `ledger/ledger.js`: v2.1 durum alanları, sürüm kapısı, tek kimlik kuralı (`KIMLIK_ZATEN_VAR`), cihaz ve misafir imzacıları, `resolveMember`, `entity`, `sessionRole`, `anchorFor` genişlemesi, misafirliğin ebeveynle düşmesi. Kurallar yeni `ledger/v21.js`'te.
- `ledger/quorum.js`: 13–23 `checkV21`'e gider; `OKUYUCU_ONAYI_YOK` öneride beklenebilir.
- `ledger/proposals.js`: `PROPOSABLE` genişledi; yeni cihaz, misafir ve cihazın kendi çıkış imzası.
- `ledger/sync.js`: §9 güçlü olaylar ve çıkarmalar; çatallanmada yalnız üye imzaları sayılır.
- `protocol/hello.js`: yetenek bitleri 32–4096; `verifyHello` oturum rolünü döner.
- `crypto/pair.js`: `taskKey = derive(pair, 'hf/task/')`.

### D2–D3'te kopyalardaki değişiklikler

- `crypto/kdf.js`: `toBuf` BigInt dalı (u64be, RFC-0001 §3); `toBuf` dışa açıldı.
- `ledger/encoding.js`: olaylar 34 `APP_ATTACH`, 35 `APP_PRIMARY`; seçimli alan kodlayıcısı.
- `ledger/ledger.js`: kişi modeli (`persons`, `personIdOf`, `canonical`, `personIds`, `identitiesOf`), ek kimlik imza sınırı, ana kimlik çıkınca ve cihaz değişiminde ek kimliklerin kapanması, `APP_PRIMARY` beklemesi. Kurallar yeni `ledger/v22.js`'te.
- `ledger/quorum.js`: sınırlar ve yeter sayılar kişileri sayar; ek kimlik çıkarma ve veto.
- `ledger/sync.js`: `APP_PRIMARY` güçlü olay.
- `protocol/hello.js`: `COKLU_UYGULAMA = 8192`.

## Kopyalanan vektörler

`packages/protocol/vectors/<ad>.json` → `test/vektorler/yuva-hat/<ad>.json`, bayt bayt aynı. Özetler `test/vektorler/yuva-hat/SHA256SUMS`'tadır; `scripts/kontrol.sh` bunları denetler.

| Dosya | Son kayıt | Kullanan test |
|-------|-----------|---------------|
| `ledger-valid.json` | `a1b8297` | `test/ledger.js` (zincir uygulanır, üretici aynı dosyayı verir) |
| `ledger-invalid.json` | `a1b8297` | `test/ledger.js` (her durum beklenen hatayla reddedilir) |
| `kdf.json` | `165e973` | `test/yuva-hat-vektor.js` (yeni) |
| `pair.json` | `165e973` | `test/yuva-hat-vektor.js` (yeni) |

Vektörler `protocol/vectors/` altına konmadı: o klasöre yalnız RFC'lerin adını verdiği yeni vektör dosyaları girer (`AGENTS.md`). Aşama C'de `packages/protocol` taşınınca bu kopyalar kalkar.

## Yeni dosyalar (Yuva Hat'ta yok)

- `index.js`: paket girişi, modülleri dışa açar.
- `test/yuva-hat-vektor.js`: `kdf.json` ve `pair.json` vektörlerini kopyalanan kodla doğrular (Yuva Hat'ta bu iki dosya yalnız biçim olarak denetleniyordu).
- `package.json`: bağımlılık sürümleri Yuva Hat `worklet/package.json` ile aynı (`b4a 1.9.0`, `compact-encoding 3.5.2`, `sodium-native 5.2.0`, `brittle 4.5.0`).

## Kopyalanmayanlar ve arayüzler

Kopyalanan dosyaların hiçbiri ağ ya da Bare'e özel modül çekmiyor (yalnız `sodium-native`, `b4a`, `compact-encoding`). Bu yüzden D0'da arayüz bırakmak gerekmedi.

- `protocol/hello.js` bir `socket` nesnesinden yalnız `handshakeHash` alanını okur. Noise oturumu bu pakette yok; çağıran taraf `{ handshakeHash }` biçiminde bir nesne verir. Testler sahte nesne kullanır.
- `protocol/messages.js`'teki `TEXT`, `ACK`, `ENVELOPE` çerçeveleri Yuva Hat'ın spike çerçeveleridir; bu pakette yalnız `deviceCert` ve `hello` kodlayıcıları kullanılır. Dosya, aşama C eşlemesi kolay olsun diye bütün olarak kopyalandı.
- `worklet/crypto/` altındaki diğer dosyalar (ratchet, vault, envelope …) ve `worklet/protocol/` altındaki ağ kodu (`connection-manager.js`, `messenger.js`, tören) kopyalanmadı. RFC-0003 §6'daki oturum rolleri ve emanet mührü için gereken saf kısımlar D1'de bu pakette ayrı modüller olarak yazılacak.

## Bilinen not

- `crypto/kdf.js` öneki `yuva/v2/`'dir. RFC'lerin `hf/…/` etiketleri bu önekin arkasına eklenir (`derive(k, 'hf/task/')` → `yuva/v2/hf/task/`). Önek protokolün parçasıdır, değişmez.
- `test/yardimci/defter.js`'teki test kimliklerinin adları (`kerem`, `husniye`, `irem`, `ecem`, `yeniKerem`), imzalı görünen adları ve aile adı (`Eser`) Yuva Hat'tan gelen donmuş vektör çapasıdır: kimlikler `createIdentity({ seed: 'defter-vektor/<ad>' })` ile bu adlardan türer ve `protocol/vectors/` dosyalarının, `vektorler/yuva-hat/` dosyalarının (SHA256SUMS) baytlarına girer. Değiştirmek bütün vektörlerin yeniden üretilmesini ve Yuva Hat vektörleriyle bayt eşliğinin bozulmasını gerektirir; bu yüzden açılış öncesi örnek aile değişikliğinde (25 Ekim 2026) bu adlar kaldı. Tanıtım ailesi ve belgelerdeki örnekler uydurma Rivera ailesidir (`worklet/scripts/tohum-aile.js`).
