# Kriptografi envanteri

> Kaynak: `grep -o "sodium\.[a-z_0-9]*("` ve `require(...)` taraması (test dışı `.js`, `core sdk worklet node tools
> scripts installer services`; `node_modules` ve `test/` dizinleri hariç), `installer/` kabuk betikleri, kilit dosyaları.
> Satırlar dosya ve işleve bağlıdır.

## 1. İlke: kendi kriptomuz yazmayız (H7, §13.2)

Kurucu belge H7: "Yalnız §13.2'deki algoritmalar ve denetlenmiş kütüphaneler." §13.2: "Kütüphane: `sodium-native`
(libsodium). Listeye ekleme RFC ve bağımsız inceleme ister." Koddaki durum:

- Çekirdek, SDK, worklet ve düğüm çekirdeğindeki bütün ilkeller `sodium-native` çağrılarıdır. İstisnalar:
  - Shamir: `shamir-secret-sharing` (kurucu §10.3'te adı geçen kütüphane).
  - Noise: taşıyıcıda `hyperdht` içinde, afet bağında `@hyperswarm/secret-stream` içinde (`noise-handshake`,
    `noise-curve-ed`); kalıp kodu bizim değil.
  - SHA-256: `node/scripts/release-common.js` `dosyaOzetleri` Node `crypto.createHash('sha256')` ile `SHA256SUMS` üretir
    (dosya başı: "protokol dışı, kullanıcı herhangi bir araçla denetlesin diye"). Protokol özeti aynı işlevde BLAKE2b'dir
    (`node/release.js` `dosyaOzeti`). `node/scripts/image-try.js` (yalnız CI deneme aracı) görev kimliği için
    `crypto.randomBytes` kullanır.
  - Kurulum (`installer/`): var olan Ubuntu'da Node olmadığı için `installer/install/notification.sh` sürüm bildiriminin
    imzasını OpenSSL 3 ile (`openssl pkeyutl -verify -rawin`, Ed25519), etiketli özeti `b2sum -l 256` ile denetler
    (`hf_ozet_etiketli`; dosya başı "Kendi kriptomuz yok"). `installer/target/common.sh` paket özetini `b2sum` ile, ISO
    derlemesi Canonical ISO'sunu `sha256sum` ile denetler (`installer/build/havenfold-usb-build.sh`). Disk şifrelemesi
    cryptsetup (LUKS2) ve Clevis TPM bağıdır (`installer/lib/luks.js`, `installer/target/hf-luks-yenile`).
  - TPM mührü: `node/tpm.js` `sistemTpm` tpm2-tools'u çağırır (`tpm2_createprimary`, `tpm2_create`, `tpm2_load`,
    `tpm2_unseal`); şifreleme yine libsodium'dur.
- Havenfold'un kendi yaptığı: etiketli türetme (`kdf.derive`/`kdf.hash`, `kdf.deriveLP`/`kdf.hashLP`), tel biçimleri, AD
  seçimi, anahtar hiyerarşisi. H7'nin dediği gibi bunlar protokol tasarımıdır ve denetimin asıl konusudur.
- `core/vault/test/helpers/shamir-reference.js` GF(2^8) (0x11b) Shamir'in kısa bir başvuru gerçeklemesidir. **Yalnız
  testte** kullanılır (tek kullanan `core/vault/test/d60.js`); paket `files` listesi (`core/vault/package.json`:
  `index.js`, `*.js`, `bare-crypto/`) `test/`'i almaz, `exports` yalnız `.`'dır.
- `node/qr.js` kendi GF(256)'sını (0x11D) içerir: QR Reed–Solomon hata düzeltmesi, kriptografi değildir (dosya başı
  "Kriptografi değildir").
- `core/export/zip.js` CRC-32 hesaplar (`crcAkis`): bütünlük değil, ZIP biçimi içindir; güvenlik kap AEAD'indedir.
- `core/services/encoding.js` `b32`/`b32Coz` ve hizmet QR'ının 4 baytlık `hf/service-card-qr/` sağlaması biçimdir; kartın
  güvenliği imzasından gelir (`core/services/card.js` `kartCoz`).

## 2. İlkeller

| İlkel | Nerede (dosya → işlev) | Kütüphane çağrısı | Anahtar | Not |
|-------|------------------------|-------------------|---------|-----|
| Ed25519 anahtar üretimi | `core/core/core/identity.js` `createIdentity`; `core/services/package.js` `takmaAd` (her üye, her hizmet için takma ad); `core/disaster/derivation.js` `anahtarCifti` (afet bağının Noise anahtarı, `hf/afet-noise/` tohumundan); `installer/erase/report.js` `raporAnahtari`; `node/scripts/release-sign.js` (çevrimdışı imza aracı, tohum `sodium_malloc`'ta) | `crypto_sign_seed_keypair`, `crypto_sign_keypair` | ÜKA tohumu (`randombytes_buf`; testte `derive(hash('identity/seed', seed), 'identity/uka')`); takma ad; afet günlük tohumu; silme raporu anahtarı; sürüm kök anahtarı | Üye kimliği; `memberId = hash('member-id', ÜKA)[0..16]` (`core/core/ledger/ledger.js` `memberIdOf`) |
| Ed25519 imza | `core/core/ledger/ledger.js` (`signEvent`, doğrulama), `proposals.js`, `protocol/hello.js` `createHello`/`verifyHello`, `protocol/guest-view.js`, `protocol/team-exit.js`, `protocol/retirement.js` `signWipeReport`/`verifyWipeReport`, `protocol/recovery.js` (NODE_RECOVERY); `core/records/operation.js` `sign`, `records/key.js` `makeKeyEntry`/`verifyKeyEntry`, `records/cutoff.js`, `records/file.js` (BLOB_DEL, BLOB_HAVE), `records/replica.js` `sealDrop`, `records/sync.js`, `records/box.js`; `core/tasks/encoding.js`; `core/events/envelope.js`; `core/vault/request.js`, `core/vault/envelope.js` `zarfYaz`, `core/vault/box-envelope.js` (kutu zarf kopyasının imzasını doğrular); `core/edge/encoding.js` `imzala`/`imzaGecerli` (NODE_PROFILE, UC_CONFIG, UC_STREAM_OPEN, UC_STATUS, UC_SCREEN_PUSH, APP_WIPE_REPORT); `core/services/card.js` `imzala`/`dogrula` (kart, dizin, paket içi, cevap içi, önizleme, delege, `x-hf-auth`); `node/health.js`, `node/release.js`; `installer/install/notification.sh` (OpenSSL, yalnız doğrulama) | `crypto_sign_detached`, `crypto_sign_verify_detached` | ÜKA (`signKeyPair.secretKey`); sürümde kök anahtar (yalnız doğrulama); silme raporunda rapor anahtarı; hizmette hizmetin `signPub`'ı, takma ad, dizin anahtarı | İmzalanan her zaman etiketli özettir: `hash('<etiket>', familyId, gövde)` ya da yeni modüllerde `hashLP(...)` |
| X25519 anahtar üretimi | `identity.js` `createIdentity` (ÜDA), `sdk/team.js` `birakmaCifti`, `sdk/api.js` (`openDropKey`), `core/transport/ceremony.js` `benimHello` (geçici); `core/services/package.js` `sifreCifti` (hizmetin şifreleme çifti), `paketKur` ve `core/services/reply.js` (geçici `eph`); `node/box.js` `arsivAcik`, `node/worker.js` `anahtarlariAc` (düğümün Arşiv çifti) | `crypto_box_seed_keypair`, `crypto_box_keypair`, `crypto_scalarmult_base` | ÜDA; bırakma anahtarı; tören geçici anahtarı; hizmet `encPub`/geçici anahtar; düğüm Arşiv anahtarı | Düğümde Arşiv gizli yarısı TPM'ye mühürlü (`arsiv.muhur`); TPM yoksa işçide şifresiz dosya (`arsiv.anahtar`) |
| X25519 DH | `core/core/crypto/pair.js` `pairSecret`; `core/transport/ceremony.js` `sas`; `core/services/package.js` `x25519` (paket ve cevap) | `crypto_scalarmult` | ÜDA gizli × karşı ÜDA açık; tören geçici anahtarları; hizmetin `encPub`'ı × geçici gizli, cevapta `replyPub` × hizmetin geçicisi | `pairSecret` ve `ceremony.js` `sas` sıfır sonucu `WEAK_KEY` ile reddeder; `services/package.js` `x25519` sodium'un hatasını `INVALID_KEY`'e çevirir |
| X25519 açık anahtar türetme | `core/records/key.js` `dropPubOf`; `worklet/persistence.js` `arsivTasi`, `arsivAc`; `core/services/package.js` `paketKur`/`paketAc`, `core/services/reply.js`; `node/box.js`, `node/worker.js` | `crypto_scalarmult_base` | Bırakma gizlisi; Arşiv gizli anahtarı; hizmet ve cevap anahtarları | Arşivde gizli anahtarın doğru olduğunun kanıtı (`WRONG_LOCK_KEY`) |
| `crypto_box_seal` | `core/records/replica.js` `sealDrop` (yazma; açma `_evaluate` içinde `crypto_box_seal_open`); `worklet/persistence.js` `_muhurle`, `arsivTasi`, `arsivAc` | `crypto_box_seal`, `crypto_box_seal_open` | Bırakma açık anahtarı (`COLLECTION.dropKey`); Arşiv açık anahtarı (`archivePubHex`) | Arşiv: her kasa öğesi ayrı mühürlü |
| XChaCha20-Poly1305 (IETF AEAD) | `core/core/messaging/seal.js` `aeadSeal`/`aeadOpen`; `core/records/operation.js` `sealOp`; `core/records/file.js` `encrypt`/`decryptBlob`; `core/vault/envelope.js` `zarfYaz`/`zarfAc`; `core/vault/backup.js` `dizinMuhurle`/`dizinAc`; `core/ai/embedding.js` (dosya), `core/ai/search-index.js` (bloklar); `core/disaster/message.js` `muhurle`/`ac` (AFET_MSG); `core/edge/frame.js` `AkisMuhurleyici.muhurle`/`AkisAcici.ac` (uç akış kareleri); `core/services/package.js` `paketKur`/`paketAc`, `core/services/reply.js` (cevap); `worklet/persistence.js` `Depo.yaz`/`Depo.oku`; `node/tpm.js` `sistemTpm` (`aeadNesnesi`, AD `hf/node/tpm`) ve `taklitTpm` (yalnız test, AD `hf/node/tpm-taklit`) | `crypto_aead_xchacha20poly1305_ietf_encrypt/decrypt` | Çift alt anahtarı; dönem anahtarı; `fileKey`; KRA; YA; gömme dosya anahtarı; platform anahtarından türeyen depo anahtarı; `afetKey`; uç `mediaKey`/`tersAnahtar`; hizmet paketi ve cevap anahtarı (`hf/share-key/`, `hf/share-reply-key/`); TPM'de mühürlü 32 baytlık anahtar | Nonce: çoğu yerde `randombytes_buf` (24 B). Dosyada belirlenimci: `nonce_i = u64be(i) ‖ 16 sıfır` (`file.js` `nonceOf`), anahtar her yüklemede rastgele (`randomKey`). Uç karesinde belirlenimci: `ssrc ‖ dönem ‖ sayaç(48 bit) ‖ 12 sıfır`, akış başına yeni anahtar, 64 çerçevelik tekrar penceresi (`frame.js` başlık) |
| `crypto_secretstream_xchacha20poly1305` | `core/export/export.js` (`KapYazici`, `kapOkuyucu`, `acIle`); `tools/export-open/open.js` | `init_push`, `push`, `init_pull`, `pull` | Kap anahtarı (Argon2id'den) | 1. parçanın AD'si sihir ‖ sürüm ‖ başlık uzunluğu ‖ başlık; `TAG_FINAL` zorunlu (`EXPORT_TRUNCATED`, `EXPORT_EXCESS`) |
| XChaCha20 akışı (AEAD'siz) | `installer/erase/pattern.js` `Desen.parca` | `crypto_stream_xchacha20_xor_ic` | Rastgele, `sodium_malloc` alanında; iş bitince `sodium_memzero` | Gizlilik için değil: dönen diske yazılan ve geri okunarak doğrulanan desen (dosya başı) |
| Argon2id | `core/export/export.js` `anahtarTuret`, `anahtarTuretAsync`; `tools/export-open/open.js` | `crypto_pwhash(_async)`, `ALG_ARGON2ID13` | Parola (NFC, UTF-8; `parolaBaytlari`), 16 B tuz | Varsayılan `opslimit 4`, `memlimit 128 MiB`; kabul aralığı `ops 3–16`, `mem 64 MiB–1 GiB`; telefonda `ops ≤ 8`, `mem ≤ 512 MiB` (`telefonSiniri`); en az 12 karakter (`EN_AZ_PAROLA`) |
| BLAKE2b-256 anahtarlı türetme | `core/core/crypto/kdf.js` `derive(key, label, ...parts)`; uzunluk önekli `deriveLP` | `crypto_generichash_batch(out, [PREFIX+label, ...parts], key)`; `deriveLP` her parçayı `u32be(boy) ‖ bayt` yapar | Çağıranın anahtarı | Bütün alt anahtarlar buradan. `deriveLP`/`hashLP` RFC-0027 §8 b, D69: yeni etiketler bunu kullanır (bkz. §5.1) |
| BLAKE2b-256 özet | `kdf.js` `hash(label, ...parts)`, `hashLP`; `node/release.js` `dosyaOzeti` (akışlı: `crypto_generichash_init/update/final`, ilk girdi `PREFIX + 'hf/release-pkg/'`); `installer/erase/example.js` `ozet` (etiketsiz, silme doğrulamasında okunan blokların karşılaştırılması); kabukta `b2sum -l 256` (`installer/install/notification.sh`, `installer/target/common.sh`) | `crypto_generichash_batch`, `crypto_generichash` | Anahtarsız | Kimlikler, AD'ler, imza özetleri, bütünlük |
| Shamir GF(256) | `core/vault/share.js` `paylariUret` (`split`), `birlestir` (`combine`) | `shamir-secret-sharing` 0.0.4 | Sır: YA ya da KRA (32 B) | Rastgelelik yaması: `core/vault/random.js` (`csprng.getRandomBytes` → `sodium.randombytes_buf`, öz denetim `ozDenetim`); Bare'de `crypto` paketi `core/vault/bare-crypto/index.js` `randomBytes` |
| Noise IK | `core/transport/transport.js` (`dht.createServer`, `dht.connect`), `core/transport/ceremony.js`; `core/disaster/local.js` `bagKur` (`new NoiseSecretStream(baslatan, akis, { pattern: 'IK', keyPair })`, karşılayan gelen statik anahtarı çiftin o günkü anahtarıyla karşılaştırır, `DISASTER_NOISE`) | `hyperdht` 6.34.1 → `noise-handshake` 4.2.0 (`'IK'`, `hyperdht/lib/noise-wrap.js`), `noise-curve-ed` 2.1.0; afet: `@hyperswarm/secret-stream` 6.9.2 (`lib/handshake.js`, `noise-curve-ed`) | Taşıyıcı: `DHT.keyPair(seed)`, tohum çift sırrından (`listenSeed`/`dialSeed`) ya da tören sırrından (`hf/toren/arama`). Afet: `anahtarCifti(pair, id, gün)` (`hf/afet-noise/`) | Kalıp kodu `hyperdht` ve `secret-stream` içindedir; afette `pattern: 'IK'` açıkça verilir (secret-stream varsayılanı `'XX'`) |
| Rastgelelik | Her `randombytes_buf` çağrısı (yukarıdaki dosyalar; ayrıca `sdk/api.js`, `sdk/vault.js`, `sdk/bridge.js`, `sdk/local.js`, `sdk/ai.js`, `sdk/service.js`, `sdk/edge.js`, `core/services/approval.js`, `core/ai/assistant.js`, `core/ai/extraction.js`, `core/core/protocol/local-channel.js`, `node/setup.js`, `node/supervisor-main.js`, `node/edge/worker-stream.js`) | `randombytes_buf` | — | Tek kaynak libsodium (istisna: §1, `image-try.js`) |
| Bellek sıfırlama | `sodium_memzero`, 34 dosyada 119 çağrı (test dışı): `sdk/vault.js` (21), `core/export/export.js` (11), `worklet/persistence.js` (11), `core/services/reply.js` (6), `core/transport/ceremony.js` (6), `core/services/package.js` (5), `node/worker.js` (5), `node/scripts/release-sign.js` (5), `core/vault/share.js` (4), `core/ai/embedding.js` (4), `core/vault/request.js` (3), `core/ai/search-index.js` (3), `node/tpm.js` (3), `tools/export-open/open.js` (3), iki çağrılılar `core/core/core/identity.js`, `core/core/messaging/seal.js`, `core/tasks/audit.js`, `core/tasks/delivery.js`, `core/transport/transport.js`, `core/edge/frame.js`, `node/box-share.js`, `node/box.js`; tek çağrılılar `core/core/core/pairs.js`, `core/core/crypto/pair.js`, `core/vault/backup.js`, `core/vault/envelope.js`, `core/records/key.js`, `core/records/replica.js`, `installer/erase/pattern.js`, `installer/erase/report.js`, `node/setup.js`, `sdk/api.js`, `sdk/team.js`, `worklet/synchronizer.js`. `sodium_malloc`: `installer/erase/pattern.js`, `installer/erase/report.js` (ayrıca `sodium_mlock`/`sodium_munlock`), `node/scripts/release-sign.js` | `sodium_memzero`, `sodium_malloc`, `sodium_mlock` | — | Sayım: `grep -c "sodium_memzero("`. JS dizgileri sıfırlanamaz (bkz. `anahtar-yasam-dongusu.md` §4) |
| Sabit zamanlı karşılaştırma | `core/transport/ceremony.js` `al` (JOIN_HELLO MAC); `core/vault/box-envelope.js` `ZarfKopyalari.iste` (zarf etiketi) | `sodium_memcmp`; sıfır denetimi `sodium_is_zero` (`pair.js`, `ceremony.js`, `worklet/persistence.js`) | — | Diğer eşitlik denetimleri `b4a.equals` (sabit zamanlı değil); çoğu açık veride. Afet etiket eşleşmesi (`core/disaster/local.js` `eslestir`, `bagKur`) ve hizmet QR sağlaması `b4a.equals`'tır |

## 3. §13.2'de olup kodda olmayanlar

| §13.2 satırı | Koddaki durum |
|--------------|---------------|
| Double Ratchet (mesajlar) | RFC'de; kodda yok. Yalnız `pairSubkeys` `ratchetRoot: derive(pair, 'ratchet-root')` türetir (`core/core/crypto/pair.js`); kullanan yok. |
| P-256 donanım anahtarı (telefonda) | RFC'de; kodda yok. `core/core/crypto/device-cert.js`: `dbaPub`, `dbaSig` boş; `verifyDeviceCert` dolu `dbaSig`'i reddeder. |
| HMAC-SHA256 (zil) | RFC'de; kodda yok. `pairSubkeys` `bellKey: derive(pair, 'bell')` türetir; kullanan yok. |
| Noise IK | `hyperdht` ve `@hyperswarm/secret-stream` içinde var (yukarıda). RFC-0028 §2 "Noise XX" yazar; kod `IK` kullanır (bkz. §5). |
| Protokol dışı: LUKS2, TPM 2.0, TLS, SHA-256 imaj özetleri, ES256 | TPM: `node/tpm.js` `sistemTpm` tpm2-tools ile mühürler (D76); TPM ya da araç yoksa `NO_TPM`. LUKS2 ve Clevis (PCR 7): `installer/lib/luks.js`, `installer/target/hf-luks-yenile`. SHA-256: sürüm betiği (`node/scripts/release-common.js`, Node `crypto`), ISO denetimi (`installer/build/havenfold-usb-build.sh`, `sha256sum`) ve Podman imaj özeti denetimi (`node/podman.js`). TLS: referans hizmet alıcısı TLS'i önündeki ters vekilde sonlandırır (`services/receiver/server.js` dosya başı); TLS kodu bu depoda yok. ES256 bu depoda yok. |

## 4. Kütüphaneler ve sürümler

| Paket | Sürüm | Lisans | Kilit | Kullanan |
|-------|-------|--------|-------|----------|
| `sodium-native` | 5.2.0 | MIT | `package-lock.json` ve `worklet/package-lock.json` (ikisinde de dev değil) | `core/*`, `sdk`, `node`, `tools/export-open`, `worklet`, `installer/erase` |
| `shamir-secret-sharing` | 0.0.4, integrity `sha512-ui8u/cIg…` | Apache-2.0 | `package-lock.json`; worklet kilidinde ayrı girdi yok, `../core/vault` bağımlılığı olarak | `core/vault/share.js`, `random.js`. Integrity `scripts/license-check.js` `SABIT_OZET` ve `core/vault/test/d60.js` ile sabit |
| `crypto` (yerel) | `file:bare-crypto` | MPL-2.0 | kök kilit `node_modules/crypto` → `core/vault/bare-crypto` | Yalnız Bare'de `shamir-secret-sharing`'in `randomBytes`'ı |
| `hyperdht` | 6.34.1 | MIT | kök ve worklet | `core/transport/*` (telefonda bayrakla, düğümde açık), `node/box-transport.js` |
| `@hyperswarm/secret-stream` | 6.9.2 | Apache-2.0 | kök ve worklet | hyperdht üstü şifreli akış; `core/disaster/local.js` doğrudan (`core/disaster/package.json`) |
| `noise-handshake` | 4.2.0 | Apache-2.0 | kök ve worklet | hyperdht, secret-stream |
| `noise-curve-ed` | 2.1.0 | ISC | kök ve worklet | hyperdht, secret-stream |
| `sodium-universal` | 5.0.1 | MIT | worklet | hyperdht bağımlılığı (`sodium-native`'e çözülür) |
| `hypercore-crypto` | 3.7.0 | MIT | worklet | hyperdht bağımlılığı |
| `sodium-secretstream` | 1.2.0 | MIT | worklet | secret-stream bağımlılığı |
| `bare-crypto` | 1.15.4 | Apache-2.0 | kök ve worklet | `bare-ws`'in bağımlılığı; Havenfold kodu çağırmaz |

Sistem araçları (npm dışı, kurulum ortamında): OpenSSL 3 (`openssl pkeyutl`), coreutils `b2sum`/`sha256sum`, cryptsetup,
Clevis (`clevis-luks`, `clevis-tpm2`; `installer/build/deb-collect.sh`), tpm2-tools (`node/tpm.js`). Sürümleri Ubuntu 24.04
paketlerinden gelir; bu depoda sabitlenmez.

## 5. Denetçinin dikkatine (koddan çıkan sorular)

1. **Eski etiketlerde parça sınırı yok; yeni etiketlerde var.** `kdf.derive`/`kdf.hash` parçaları uzunluk öneki olmadan
   art arda verir (`crypto_generichash_batch`). `core/core/crypto/kdf.js` `deriveLP`/`hashLP` (RFC-0027 §8 b, D69) her
   parçayı (etiket dahil) `u32be(boy) ‖ bayt` yapar; ilk bayt 0 olduğu için `derive`/`hash` girdisiyle (önek `y` ile
   başlar) çakışmaz, parça 16 MiB'ı aşarsa `CHUNK_TOO_LARGE`. Kullananlar: `core/disaster` (`derivation.js`, `message.js`), `core/edge`
   (`encoding.js` `ozetOf`, `frame.js` `anahtarPayi`/`tersAnahtar`, `erasure.js`), `core/services` (bütün etiketler,
   `encoding.js` `ETIKET`), `core/vault/box-envelope.js` `zarfEtiketi`. Var olan etiketler `derive`/`hash`'te kaldı (kdf.js
   yorumu); değişken boyutlu birden çok parça alanlar: `hf/worklet/ozet` (dosya adı içeren AD ‖ içerik),
   `hf/toren/transkript` (iki kodlanmış sertifika), `hf/yz-onay/` (tür, kimlik, sınıf metinleri), `hf/yz/dizin-ad/`
   (kimlik metni). Uçtaki `media` etiketi (`core/edge/frame.js` `medyaAnahtari`) Yuva Hat çerçeve biçimiyle aynı kalmak
   için `derive`'dır; parçaları sabit boyludur (`streamId` 16 B, dönem u64). Bunlarda çakışma üretilebilir mi bakılmalı.
   Etiketlerin önek çifti denetimi: `scripts/label-check.js` (`check.sh` her koşuda; izinli beş çift `IZINLI`).
2. **Aynı etiket iki bağlamda.** `'hf/task/'` hem `derive(pair, 'hf/task/')` (görev emanet anahtarı,
   `core/core/crypto/pair.js` `pairSubkeys`) hem `hash('hf/task/', familyId, body)` (TASK imza özeti,
   `core/tasks/encoding.js`) olarak geçer. Biri anahtarlı biri anahtarsız BLAKE2b.
3. **Yakın etiketler.** `derive(dosya anahtarı, 'hf/yz/ozet')` ve `hash('hf/yz/ozet/', anahtar, metin)`
   (`core/ai/embedding.js` `metinOzeti`). Anahtarlı özet BLAKE2b'nin anahtar parametresiyle değil, anahtarın girdiye
   eklenmesiyle yapılır; inceleme 18 B6 kararı "HMAC" der.
4. ~~Tören DH'sinde sıfır denetimi yok~~ **Kapatıldı.** `core/transport/ceremony.js` `sas` sıfır sonucu `WEAK_KEY`
   ile reddeder; tören anahtarı tamamlanmayan törende `bitir`'de sıfırlanır.
5. **Noise kalıbı belgelerde tutarsız.** Kurucu §13.2 "Noise IK", RFC-0028 §2 "Noise XX"; kod `hyperdht` 6.34.1
   `lib/noise-wrap.js` `new NoiseHandshake('IK', …)`; afet bağı da `IK` (`core/disaster/local.js` `bagKur`).
6. **HELLO imzası `caps`'i kapsamaz.** `core/core/protocol/hello.js` `helloDigest(handshakeHash, familyId,
   memberId, ledgerHead, ledgerLen)`; `caps`'in bütünlüğü Noise oturumuna dayanır.
7. **Dönem anahtarı ve KRA/YA doğrudan AEAD anahtarı.** `core/records/operation.js` `sealOp` dönem anahtarını, `core/vault/envelope.js`
   KRA'yı, `core/vault/backup.js` YA'yı türetmeden kullanır. RFC-0001 §18: XChaCha20-Poly1305 anahtara bağlayıcı
   değildir; bu yüzden `keyId = hash('hf/rec-epoch/', key)` ve her anahtar imzalıdır.
8. **Afet zarfında `hops` AD'nin dışında.** `core/disaster/message.js` AD = `hashLP('hf/afet-ad/', mid, toTag, prio,
   expiresDay, doneHash)`; `hops` taşıyıcılar azalttığı için girmez. Taşıyıcı sınırı kendisi uygular
   (`core/disaster/engine.js` `Oturum._mesaj`: `hops ≤ 4`, `expiresDay` penceresi).
9. **Hizmet anahtarı DH çıktısının özetinden.** `core/services/package.js` `anahtar`: `dh = hashLP('hf/share-dh/',
   X25519(...), ephPub, encPub)`, `k = deriveLP(dh, 'hf/share-key/')`; cevapta aynı kalıp `hf/share-reply-*`
   (`core/services/reply.js`). Paket içi imzası takma adla (`hf/share-pkg/`), cevap içi hizmetin `signPub`'ıyla.

## 6. Türetme etiketleri (etiket → dosya)

Toplama yöntemi: `scripts/label-check.js`'in yöntemi (test dışı `core sdk worklet node tools` içindeki `derive`,
`deriveLP`, `hash`, `hashLP` çağrılarının düz yazılmış etiketleri), ayrıca etiketi sabitten alan çağrılar için test dışı
koddaki bütün `'hf/...'` dizgileri (`core/services/encoding.js` `ETIKET`, `core/edge/encoding.js` `ETIKET`,
`core/tasks/encoding.js`, `core/core/protocol/recovery.js` `ETIKET`) ve `scripts/`, `installer/`. Telde her etiketin önü
`yuva/v2/`'dir. "d" = `derive` (anahtarlı), "h" = `hash` (anahtarsız), "dLP"/"hLP" = uzunluk önekli biçim.

### Yuva Hat'tan gelen etiketler (`hf/` öneksiz)

| Etiket | Tür | Dosya |
|--------|-----|-------|
| `identity/seed`, `identity/uka`, `identity/uda` | h, d, d | `core/core/core/identity.js` (yalnız tohumlu, test ve vektör yolu) |
| `member-id` | h | `core/core/ledger/ledger.js` `memberIdOf` |
| `family-id` | h | `core/core/ledger/ledger.js` (GENESIS) |
| `ledger-event` | h | `core/core/ledger/encoding.js` `eventHash` |
| `prekey`, `prekey-id` | h | `core/core/ledger/ledger.js`, `ledger/quorum.js` `prekeyIdOf` |
| `device-cert` | h | `core/core/crypto/device-cert.js` `deviceCertDigest` |
| `hello` | h | `core/core/protocol/hello.js` `helloDigest` |
| `pair` | d | `core/core/crypto/pair.js` `pairSecret` |
| `ratchet-root`, `bell`, `relay` | d | `pair.js` `pairSubkeys` (kullanan yok) |
| `rv/listen`, `rv/dial` | d | `pair.js` `pairSubkeys` → `core/transport/transport.js` `_dinle`, `_ara` |
| `mailbox` | d | `pair.js` `pairSubkeys` (Posta Kutusu kimliği; kullanan yok) |
| `ctrl` | d | `core/core/messaging/seal.js` `sealCtrl`, `envelopeKey`; `local-channel.js` (APP_LOCAL_SYNC) |
| `mailbox-seal` | d | `seal.js` `sealMailbox` (kullanan yok) |
| `media` | d | `core/edge/frame.js` `medyaAnahtari` (`derive(keyShare, 'media', streamId, 0)`; Yuva Hat `frame.js` biçimi) |

### Havenfold etiketleri

| Etiket | Tür | Dosya |
|--------|-----|-------|
| `hf/task/` | d ve h | `pair.js` (emanet anahtarı), `seal.js` `envelopeKey`; `core/tasks/encoding.js` (TASK imzası) |
| `hf/task-zarf/` | h | `core/tasks/delivery.js` `zarfKimligi` (emanet zarf kimliği) |
| `hf/node-caps/`, `hf/task-sub/`, `hf/task-cancel/`, `hf/task-delegation/` | h | `core/tasks/encoding.js` `digestOf` |
| `hf/app-pair/` | h | `core/core/protocol/local-channel.js` `transcriptOf` |
| `hf/guest-view/`, `hf/guest-revoked/` | h | `core/core/protocol/guest-view.js` |
| `hf/ekip-cikis-ok/` | h | `core/core/protocol/team-exit.js` `okDigest` |
| `hf/wipe-report/`, `hf/wipe-report-id/`, `hf/wipe-report-set/` | h | `core/core/protocol/retirement.js` |
| `hf/node-recovery/` | h | `core/core/protocol/recovery.js` `ozet` (NODE_RECOVERY imzası) |
| `hf/rec-epoch/` | h | `core/records/operation.js` `keyIdOf`, `core/records/key.js` |
| `hf/rec-ad/`, `hf/rec-op/`, `hf/rec-op-sig/` | h | `core/records/operation.js` |
| `hf/rec-key/`, `hf/rec-key-commit/` | h | `core/records/key.js` `keyDigest` |
| `hf/rec-drop/` | h | `core/records/key.js` `dropKeyHashOf`, `records/sync.js` |
| `hf/rec-drop-op/`, `hf/rec-drop-sig/` | h | `core/records/replica.js` |
| `hf/rec-new/`, `hf/rec-append/` | h | `core/records/merge.js`, `encoding.js`, `replica.js` |
| `hf/rec-cutoff/`, `hf/rec-cutoff-list/` | h | `core/records/cutoff.js` |
| `hf/rec-copy/`, `hf/rec-set/`, `hf/rec-bucket/`, `hf/rec-prune/` | h | `core/records/sync.js` |
| `hf/blob-ad/`, `hf/blob-chunk/`, `hf/blob-id/`, `hf/blob-del/`, `hf/blob-have/` | h | `core/records/file.js` |
| `hf/kasa-ya-id/`, `hf/kasa-commit/`, `hf/kasa-paper/` | h | `core/vault/share.js` |
| `hf/kasa-env-ad/`, `hf/kasa-env/` | h | `core/vault/envelope.js` |
| `hf/kasa-zarf-etiket/` | dLP | `core/vault/box-envelope.js` `zarfEtiketi` (KRA'dan; kutudaki zarf kopyasının etiketi) |
| `hf/kasa-index-ad/` | h | `core/vault/backup.js` |
| `hf/kasa-kra/` | h | `core/vault/rotation.js` `kraKazanan` |
| `hf/kasa-req/`, `hf/kasa/pay-dizini` | h | `core/vault/request.js` |
| `hf/kasa-test-akis/` | h | `core/vault/test-flow.js` (yalnız test akışı; paketten yüklenemez) |
| `hf/olay-anahtar/`, `hf/olay-tur/` | h | `core/events/event.js` `anahtar` |
| `hf/ozne/`, `hf/vaka/` | h | `core/events/case.js` |
| `hf/vaka-cekirdek/` | h | `core/events/rule.js` |
| `hf/vaka-uyandir/`, `hf/vaka-dur/` | h | `core/events/envelope.js` |
| `hf/ai-index/` | d | `core/ai/search-index.js` `indexKey` (blok biçimi; telefonda kullanılmıyor, İstek 137) |
| `hf/ai-index-ad/` | h | `core/ai/search-index.js` |
| `hf/ai-index-parca/` | h | `core/ai/embedding.js` `metinOzeti` (anahtarsız, yalnız bellek) |
| `hf/yz/dizin` | d | `core/ai/embedding.js` `_dosyaAnahtari` |
| `hf/yz/dizin-ad/` | h | `core/ai/embedding.js` |
| `hf/yz/ozet` | d | `core/ai/embedding.js` |
| `hf/yz/ozet/` | h | `core/ai/embedding.js` `metinOzeti` |
| `hf/yz-onay/` | h | `sdk/ai.js` `approvalSummary` |
| `hf/toren/arama`, `hf/toren/mac`, `hf/toren/anahtar`, `hf/toren/sas` | d | `core/transport/ceremony.js` |
| `hf/toren/transkript` | h | `core/transport/ceremony.js` `sas` |
| `hf/worklet/kalici` | d | `worklet/persistence.js` `Depo` kurucusu (ek aile örneğinde ayrıca `yerelNo` parçası; RFC-0034 §5.2) |
| `hf/worklet/ozet`, `hf/worklet/kimlik`, `hf/worklet/durum`, `hf/worklet/arsiv`, `hf/worklet/arsiv-oge` | h | `worklet/persistence.js` |
| `hf/release/`, `hf/release-pkg/`, `hf/release-root/`, `hf/root-rotation/`, `hf/update-approve/` | h | `node/release.js` (`hf/release-root/` ayrıca `node/health.js`); `hf/release/` ve `hf/release-pkg/` kabukta da (`installer/install/notification.sh` `hf_ozet_etiketli`, `installer/target/common.sh`, `b2sum`) |
| `hf/node-health/` | h | `node/health.js` |
| `hf/afet/` | dLP | `core/disaster/derivation.js` `afetKey` (çift sırrından; AFET_MSG AEAD anahtarı) |
| `hf/afet-near/` | dLP | `core/disaster/derivation.js` `etiket` (keşif etiketi, ilk 4 B, 15 dakikalık dilim) |
| `hf/afet-to/` | dLP | `core/disaster/derivation.js` `toTag` (alıcı etiketi, ilk 8 B, gün) |
| `hf/afet-noise/` | dLP | `core/disaster/derivation.js` `afetSeed` → `anahtarCifti` (bağın Noise anahtarı, gün) |
| `hf/afet-done/`, `hf/afet-done-hash/` | dLP, hLP | `core/disaster/derivation.js` `doneSecret`, `doneHash` (teslim kanıtı) |
| `hf/afet-ad/` | hLP | `core/disaster/message.js` `ad` |
| `hf/uc-stream/`, `hf/uc-stream-ters/` | dLP | `core/edge/frame.js` `anahtarPayi`, `tersAnahtar` |
| `hf/node-profile/`, `hf/uc-config/`, `hf/uc-stream-open/`, `hf/uc-status/`, `hf/uc-screen/`, `hf/app-wipe-report/` | hLP | `core/edge/encoding.js` `ETIKET` → `ozetOf` (imza özeti; kullananlar `profile.js`, `config.js`, `stream.js`, `status.js`, `screen.js`, `erasure.js`) |
| `hf/app-wipe-report-id/` | hLP | `core/edge/erasure.js` `silmeRaporuOzeti` (DEVICE_DETACH `wipeReportHash`) |
| `hf/service-id/`, `hf/service-card/`, `hf/service-card-qr/`, `hf/service-dir/` | hLP | `core/services/card.js` (`serviceIdOf`, `kartCoz`, `qrCoz`, `dizinCoz`) |
| `hf/share-svc/` | hLP | `core/services/approval.js` `gizliService` |
| `hf/share-payload/`, `hf/share-ct/`, `hf/share-owner/`, `hf/share-pkg/`, `hf/share-dh/`, `hf/share-ad/`, `hf/share-rule/`, `hf/share-deleg/` | hLP | `core/services/package.js` |
| `hf/share-key/` | dLP | `core/services/package.js` `anahtar` |
| `hf/share-reply-dh/`, `hf/share-reply-ad/`, `hf/share-reply/`, `hf/share-inbox/` | hLP | `core/services/reply.js` |
| `hf/share-reply-key/` | dLP | `core/services/reply.js` `anahtar` |
| `hf/share-preview/` | hLP | `core/services/preview.js` |
| `hf/node/tpm`, `hf/node/tpm-taklit` | AD dizgisi (kdf etiketi değil, `yuva/v2/` öneki yok) | `node/tpm.js` `sistemTpm`, `taklitTpm` (yalnız test) |
| `hf/bulanik` | h | `scripts/fuzz.js` (örnek dosya adı; üretim değil) |
