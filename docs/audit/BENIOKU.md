# Havenfold bağımsız güvenlik denetimine hazırlık paketi

> 24 Ekim 2026; açılış öncesi (25 Ekim 2026) koda göre güncellendi.
>
> **Güncellik notu (25 Ekim 2026, bağımsız inceleme sonrası):** Bütün paket `f80eacb` kaydının koduna ve onun üstündeki
> açılış değişikliklerine (düğümde sıcaklık ölçümü `node/temperature.js`; referans hizmet alıcısında `GET /kaynak` ve
> `x-hf-kaynak`) göre eşlendi. Önceki notta eski sayılan dökümler yeniden üretildi: `kripto-envanteri.md` §2 ve §6 (türetme
> etiketleri `scripts/label-check.js` yöntemiyle ve sabitlerdeki bütün `hf/` dizgileriyle; `sodium_memzero` yerleri
> `grep -c` ile), `saldiri-yuzeyi.md` §2 ve §10 (`ENTRY_POINTS`, kutu payının beş girişi) ve yeni §12–§15 (afet,
> hizmet, uç, kurulum ve silme ortamı). Kodu ileride değişen satırın kaynağı satırın kendisindeki dosya ve işlevdir.

## Amaç

Dış denetçiye Havenfold çekirdeğini (protokol, çekirdek paketleri, telefondaki çekirdek paketi, düğüm yazılımı, SDK)
koddan izlenebilir biçimde tanıtır. Her satır bir dosyaya ve mümkünse bir işleve bağlıdır. Koddan doğrulanamayan şeyler
yazılmadı. RFC'de olup kodda olmayanlar "RFC'de; kodda yok" diye ayrıldı.

Dayanak: `KURUCU-BELGE.md` §13.3 ("Bağımsız güvenlik denetimi açılıştan sonra, Faz 3'te yapılır; kasa denetimden önce yayına girmez"),
H7 ("yeni bir yapı protokol tasarımıdır, algoritma değildir; bağımsız denetime gider"), §20.2 (herkese açılma kapısı:
"Tehdit modeli dokümanları").

## Sürüm

| Alan | Değer | Kaynak |
|------|-------|--------|
| Kayıt | Açık deponun ilk kaydı | `git log` |

Denetim bu kayda ya da denetçiyle kararlaştırılan sonraki bir sürüm etiketine göre yapılır.

## Dosyalar ve okuma sırası

1. `tehdit-modeli.md`: neye karşı korunuyoruz (kurucu §13.1 T1–T30, RFC güvenlik bölümleri), koddaki karşılığı.
2. `kripto-envanteri.md`: her ilkel nerede, hangi kütüphane ve sürüm, hangi anahtarla. Bütün türetme etiketleri.
3. `anahtar-yasam-dongusu.md`: her anahtarın üretimi, saklanması, döndürülmesi ve silinmesi.
4. `saldiri-yuzeyi.md`: dışarıdan bayt alan her giriş, doğrulama noktası, hata kodu, bulanık test hedefi.
5. `inceleme-kapanis.md`: 12–18 numaralı iç incelemelerin bulgu bulgu kapanışı.
6. `sinirlar-ve-kapsam-disi.md`: bilinen sınırlar, bu depoda olmayanlar, açık istekler.

## Kapsam

Kapsamda (bu depoda kodu olan):

| Yol | Ne |
|-----|----|
| `core/core/` | Kimlik, çift sırrı, defter, mühür, oturum (HELLO), giriş süzgeci, köprü, yerel kanal, emeklilik |
| `core/records/` | Kayıt katmanı: dönem anahtarları, işlem şifreleme, dosyalar, kutu kör emaneti |
| `core/vault/` | Shamir payları, eşik, kasa zarfı, yedek dizini, pay isteme ve teslimi |
| `core/export/`, `tools/export-open/` | Dışa aktarma kabı (Argon2id + secretstream) ve bağımsız açıcı |
| `core/tasks/`, `core/events/`, `core/ai/` | Görev, olay/vaka, yapay zeka (gömme dizini şifrelemesi dahil) |
| `sdk/` | Uygulamaların kullandığı yüzey; ağ girişleri `ENTRY_POINTS` |
| `worklet/` | Telefondaki çekirdek paketi: kalıcı depo, kanal çerçevesi, eşitleyici; taşıyıcıyı (`core/transport`) bayrakla açar |
| `node/` | Düğüm yazılımı: sürüm bildirimi, kök döndürme, TPM arayüzü, kutu payı ve zarf kopyası, yerel IPC, yetki yardımcısı, sağlık ve sıcaklık, düğümde afet (`node/disaster/`, BlueZ) ve uç akışı (`node/edge/`) |
| `core/disaster/` (`sdk/disaster.js`) | Afet modu: türetmeler, AFET_MSG mührü, keşif etiketleri, Noise IK + HELLO ile yerel bağ, sakla-ilet, sınırlar (RFC-0012) |
| `core/edge/` (`sdk/edge.js`) | Uç cihaz: NODE_PROFILE, UC_CONFIG, akış açma ve kare şifrelemesi, durum, ekran kartı, uygulama silme raporu (RFC-0008) |
| `core/services/` (`sdk/service.js`), `services/receiver/` | Hizmet paylaşımı: kart, dizin, paket şifrelemesi, onay, önizleme, cevap; referans alıcı (AGPL-3.0) (RFC-0010) |
| `installer/` | Kurulum USB'si ve var olan Ubuntu'ya kurulum (bildirim doğrulaması, LUKS2 + Clevis PCR 7), silme ortamı (disk keşfi, yöntem, desen, emeklilik bileti, silme raporu) (RFC-0007 §8–§13) |

Bu dizinlerin hepsi eşlendi: giriş noktaları `saldiri-yuzeyi.md`, ilkeller ve etiketler `kripto-envanteri.md`, anahtarlar
`anahtar-yasam-dongusu.md`, tehditler `tehdit-modeli.md`. Eşlemede ayrıntısıyla incelenmeyenler adıyla yazılıdır (ör.
yapay zekanın istem ve çıktı denetimi, T18).

Kapsam dışı (ayrıntı: `sinirlar-ve-kapsam-disi.md`): telefon platform kodu (Keychain/Keystore, biyometri, Arşiv
anahtarının üretimi), radyo, kamera ve kodlayıcı gibi yerli modüller, Posta Kutusu sunucusu, Eser'in hizmet geçidi,
Yuva Hat. Gerçek TPM, LUKS ve silme ortamı yalnız sanal makinede denendi, gerçek donanımda denenmedi.

## Denetimde koşulacak komutlar

Önkoşul: Node ≥ 22 (`scripts/check.sh` başta denetler), ağ gerekmez (yalnız `npm ci` ilk kurulumda). nvm varsa
`. ~/.nvm/nvm.sh && nvm use 22`.

| Komut | Ne yapar | Kaynak |
|-------|----------|--------|
| `bash scripts/check.sh` | Bütün paket testleri Node'da ve Bare'de; Bare sürümü `v1.33.4` olmalı; çekirdekte Node'a özel modül yok denetimi; vektör JSON geçerliliği; Yuva Hat vektörleri `SHA256SUMS`; lisans denetimi; vektörlerin bağımsız yeniden üretimi; worklet denetimi; türetme etiketlerinin önek denetimi; bulanık testin kısa sürümü ve kalıcı örnekleri. Sonunda `KONTROL: YEŞİL` | `scripts/check.sh` |
| `node scripts/fuzz.js` | 18 hedef, hedef başına 200 000 girdi (`--sayi`, `--tohum`, `--hedef <ad>`, `--kisa`) | `scripts/fuzz.js` `HEDEFLER` |
| `node scripts/fuzz.js --ornekler` | `test/fuzz/corpus/*.hex` kalıcı bulguları yeniden koşar | `scripts/fuzz.js` `ornekleriKos` |
| `bare scripts/fuzz.js` | Aynı koşu Bare'de | `scripts/fuzz.js` başlık yorumu |
| `node scripts/label-check.js` (`--liste`) | Test dışı koddaki `derive`/`deriveLP`/`hash`/`hashLP` etiketlerini toplar; bir etiket başka bir etiketin önekiyse ve izin listesinde değilse hata; `ETIKET_DENETIMI TAMAM` (`check.sh` de koşar) | `scripts/label-check.js` `IZINLI` |
| `node scripts/vector-check.js` | `protocol/vectors/*.json`'u üreticiyi çalıştırmadan, okuyan testlerle yeniden hesaplar; `VEKTOR_DENETIMI TAMAM` | `scripts/vector-check.js` |
| `node scripts/license-check.js` | Üretim bağımlılıklarının lisansı, kilitte sabit sürüm ve `shamir-secret-sharing` integrity özeti | `scripts/license-check.js` `SABIT_OZET` |

Saldırı testleri (incelemelerden alınanlar) olağan test kümesinin içindedir; dosya adları `inceleme-kapanis.md`'de.

## Okurken dikkat

- Bütün türetme etiketlerinin önünde `yuva/v2/` vardır (`core/core/crypto/kdf.js` `PREFIX`). Belgelerde `hf/...` diye
  geçen etiket telde `yuva/v2/hf/...` olur.
- Dosya başlarındaki `// worklet/...` yolları Yuva Hat'tan taşınma döneminden kalmıştır (ör. `core/core/crypto/kdf.js`
  ilk satırı `worklet/crypto/kdf.js` der); gerçek yol dosyanın bugünkü yeridir.
- `kollar/` iç çalışma notlarıdır; denetçiye verilecek kopyada kurucu §20.2 gereği temizlenir.
