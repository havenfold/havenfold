# Saldırı yüzeyi

> Dışarıdan bayt alan her giriş (§12–§15: afet, hizmet, uç, kurulum ve silme ortamı). "Bulanık hedef" `scripts/fuzz.js` `HEDEFLER` anahtarıdır (18 hedef: `ipc`, `zarf`,
> `hello`, `kap-baslik`, `kap-akis`, `kap-zip`, `kopru`, `pay`, `dosya`, `cozuculer`, `tasiyici`, `gomme-dosya`,
> `kutu-pay`, `node-ipc`, `afet`, `uc`, `hizmet`, `qr`). Bulanık koşunun kuralı: girdi ya kabul edilir ya kodlu hata (`BUYUK_HARF_KODU`) verir;
> `TypeError`, `RangeError` ya da kodsuz mesaj çökmedir; tek girdi 100 ms'yi aşamaz (`scripts/fuzz.js` başlık).

## Genel hata biçimi

- Çekirdek ve SDK `throw new Error('KOD')` kullanır (`fail(code)` yardımcısı hemen her dosyada). Kod büyük harf ve
  alt çizgidir.
- `worklet/persistence.js` `hata(kod, dosya)` ayrıca `err.dosya` (ve bozuk durumda `err.neden`) taşır.
- Ağ girişi: `core/core/protocol/ingress.js` `gelenZarf` çözücü hatalarının hepsini `INVALID_MESSAGE`'e çevirir
  (inceleme 18: bulanık test bu yüzden gerçek çözücüyü `giris.cozucu(type)` ile ayrıca çağırır).
- HELLO doğrulaması fırlatmaz, `{ ok: false, code }` döner (`core/core/protocol/hello.js` `verifyHello`).

## 1. Telefon: uygulama ↔ worklet kanal çerçevesi

| Alan | Değer |
|------|-------|
| Giriş | `worklet/ipc.js` `Ayirici.yaz`, `ipcBagla` (Bare Kit IPC akışı) |
| Kimden | Aynı uygulamanın yerel kodu (React Native tarafı). Ağdan değil |
| Biçim | `uzunluk (u32be) ‖ UTF-8 JSON`, uzunluk 1..1 MiB (`EN_COK`) |
| Doğrulama | Sınır dışı uzunlukta `{ id: null, olay: 'channel', govde: { hata: 'INVALID_FRAME' } }` ve akış kapanır (worklet tarafında `durOnGecersiz`); 1 MiB'ı aşan cevap/geri çağrı ilgili komutu `INVALID_FRAME` ile reddeder; fırlatan komut `{ id, hata }` |
| Sonrası | Komut gövdeleri ürünün komut sunucusunda (`sunucu.isle`); örnek `worklet/example/product.js` (`$b` bayt gövdesi, `INVALID_BODY`) |
| Bulanık | `ipc` (ayırıcı ve `ipcBagla`, parçalı akış, giden çerçeve denetimi). Komut gövdelerinin kendisi hedef değil |

## 2. Ağ zarfları (RFC-0003 türleri)

| Alan | Değer |
|------|-------|
| Tek giriş | `core/core/protocol/ingress.js` `gelenZarf({ myRole, peerRole, type, bytes, L, gonderen, kanal, yol })` |
| Çağıranlar | `worklet/synchronizer.js` `Esitleyici.al` (SDK giriş noktası olmayan türler; ürün zarfı SHARE_PREVIEW `URUN_ZARFLARI` ile işleyicisine gider); SDK `sdk/api.js` `ENTRY_POINTS` = `RecordApi.blobReceived`, `RecordApi.blobHaveReceived`, `TaskApi.receive`, `LedgerApi.receiveProposal`, `LedgerApi.pairApprove`, `LedgerApi.pairAccept`, `VaultApi.receiveShare`, `VaultApi.receiveAck`, `VaultApi.receiveVersionRequest`, `VaultApi.receiveVersionReply`, `VaultApi.receiveShareRequest`, `VaultApi.receiveShareReply`, `VaultApi.receiveEnvelopeAck`, `VaultApi.receiveEnvelopeReply`, `TeamApi.receiveExit`, `TeamApi.receiveReceipt`, `ServiceApi.receivePreview`, uç cihaz (RFC-0008 §13) `CameraApi.configSeen`, `CameraApi.receiveStatus`, `CameraApi.receiveAccept`, `CameraApi.receiveClose`, `CameraApi.receiveWipeReport`, `EdgeDevice.receiveConfig`, `EdgeDevice.receiveStreamRequest`, `EdgeDevice.receiveClose`, `EdgeDevice.receiveRemoval`, `EdgeDevice.receiveScreen`, `EdgeDevice.receiveTask`, `TaskApi.receiveProfile` (listeyi ve kaynağı `sdk/test/ingress.js` denetler); düğümde `node/node-envelope.js` `DugumZarf.al`, `node/box-share.js` `ENTRY_POINTS` = `KutuPaylari.payAl`, `surumIstegiAl`, `payIstegiAl`, `zarfAl`, `zarfIstegiAl` (`node/box.js` beşini de bağlar), işçide `node/edge/worker-stream.js` `yapilandirmaAl`, `kabulAl`, `kapatAl` (`node/worker.js` yönlendirir); afet bağının yerel ağ yolunda `core/disaster/local.js` `olaganOturum` (§12) |
| Sıra | (1) yol: `kanal` `'ag'` ise `yol` zorunlu (`dogrudan`/`emanet`/`posta`; yoksa `INVALID_CHANNEL`); emanetten doğrudan-düğüm türü ve postadan 0xD8–0xDF `DIRECT_ONLY`; postadan pay teslimi `MAILBOX_FORBIDDEN` (`POSTASIZ`). (2) Ekipte çıkarılmış üyeden yalnız `EKIP_CIKIS_OK`. (3) Oturum tablosu `typeAllowed(myRole, peerRole, type, 'gelen')` (`core/core/protocol/envelope.js`; `TYPE_NOT_ALLOWED`). (4) Kayıtlı kanonik çözücü (`INVALID_MESSAGE`); çözücüsü olmayan izinli tür ham bayt döner, işleyen katman kendi kanonik çözücüsünü kullanır |
| Emanet mührü | Emanet ve Posta Kutusu yolunda 0x80–0xFE türleri `core/core/messaging/seal.js` `openEnvelope` (AD: gönderen ‖ alıcı ‖ tür ‖ zarf id; `UNSEALED_AUDIT`). Yalnız yerel kanal türleri (0xE8, 0xE9) mühürlenmez (`DIRECT_ONLY`) |
| Not | `Esitleyici.al(peerHex, type, bytes, yol = 'dogrudan')` varsayılan yol taşır; `gelenZarf`'ın kendisinde varsayılan yoktur (inceleme 11 bulgu 9). Bugün taşıyıcı her zaman `'dogrudan'` verir (emanet yok) |
| Bulanık | `zarf` (bütün türler × üç yol × üç oturum rolü, yerel kanal; her türün gerçek çözücüsü, düğüm zarfları dahil), `cozuculer` (JOIN_HELLO, emeklilik, misafir görünümü, ekip çıkışı ve makbuzu, kasa isteği ve sürüm, VAKA uyandırma ve dur, kayıt iç biçimi ve işlemleri, defter olayı ve eşitleme), `pay` (pay teslimi) |

## 3. Oturum açılışı (HELLO)

| Alan | Değer |
|------|-------|
| Giriş | `core/transport/transport.js` `_oturum` içindeki `socket.on('data')`: ilk çerçeve `0x01` olmalı, `c.decode(M.hello, govde)`, sonra `core/core/protocol/hello.js` `verifyHello` |
| Doğrulama | `VERSION`, `FAMILY_MISMATCH`, `NOT_MEMBER`, `MIXED_IDENTITY` (buluşma çiftiyle aynı kimlik), `CERTIFICATE_MISMATCH`, `CERTIFICATE_INTERNAL_INCONSISTENT`, `SIGNATURE_ERROR` (el sıkışma özeti üstünde ÜKA imzası). Taşıyıcı ayrıca rol `uye` ister |
| Sınır | 10 sn içinde HELLO yoksa kapanır (`HELLO_MS`; devamdan sonra 3 sn); aynı uzak anahtardan aynı dilimde 3 başarısız HELLO o dilimi kapatır (`HELLO_SINIRI`, `_basarisiz`). Doğrulanmadan hiçbir zarf eşitleyiciye gitmez |
| Bulanık | `hello` (kanonik çözme ve doğrulama, yanlış kabul), `tasiyici` (kimliği doğrulanmamış eşten gelen çerçeveler) |

## 4. Taşıyıcı (telefonda bayrakla, düğümde açık)

| Alan | Değer |
|------|-------|
| Dosyalar | `core/transport/transport.js` `DhtTasiyici`, `core/transport/ceremony.js` `dhtTorenTasiyici`, `node/box-transport.js` `kutuTasiyici` |
| Kapı | Kurucular `deneysel: true` olmadan `EXPERIMENTAL_DISABLED` verir. Telefonda (`worklet/start.js`) uygulama `tasiyici: { deneysel: true }` vermedikçe taşıyıcı kurulmaz. Düğümde bayrak koddadır: kutu (`node/box.js` → `kutuTasiyici({ deneysel: true })`) ve işçi (`node/worker.js`, ağ açıkken) taşıyıcıyı ve töreni her zaman açar; düğümün işi için gereklidir. Yani düğüm servisi çalışan her makinede HyperDHT dinlemesi açıktır |
| Ağ | HyperDHT; Noise IK (`hyperdht`); güvenlik duvarı yalnız çiftin `e−1, e, e+1` dilim arama anahtarlarını kabul eder (`_dinle`) |
| Çerçeve | `tür (1 B) ‖ gövde`, uzunluk öneki yok: ileti sınırı alttaki şifreli akıştan gelir. Gövde en çok `EN_BUYUK_GOVDE` (1 MiB, `core/transport/transport.js`): aşan gelen çerçeve işlenmez, oturum kapanır (HELLO'dan önceyse başarısız HELLO sayılır), `FRAME_TOO_LARGE` bildirilir; gönderen aşan zarfı yollamaz |
| Kutu | `kutuTasiyici`: ailedeyken yalnız defterde rolü `kutu` olan kimlik buluşmaya girer (`kutuOlarak`) |
| Bulanık | `tasiyici` |

## 5. Tören ve QR

| Alan | Değer |
|------|-------|
| QR çözücü | `core/transport/ceremony.js` `qrCoz`: önek `yuva://j/2/`, en çok 512 karakter, base64url alfabesi, yeniden yazımı aynı, sonda bayt yok; `INVALID_QR`, `QR_VERSION`; süre `QR_EXPIRY_EXPIRED` (`katil`) |
| SDK QR türü | `sdk/ceremony.js` `qrKind`: yalnız `v` ve `kind` okur (`INVALID_QR`, `QR_VERSION`, `QR_TYPE`); kanoniklik denetimi `qrCoz`'dadır |
| Tören akışı | `ceremony.js` `al`: JOIN_HELLO (`J.decodeJoinHello`, MAC `sodium_memcmp`), JOIN_DRAFT, JOIN_SIG (olay özeti taslakla aynı olmalı, öneri `tryApply` `'applied'`), JOIN_LEDGER (`S.ingest`, kendi kimliği defterde olmalı); her hata `INVALID_CEREMONY` ve oturum `kapandi` |
| Gösteren tarafı | `goster`: güvenlik duvarı yalnız `derive(sec, 'hf/toren/arama')` anahtarını ve tek bağlantıyı kabul eder; 180 sn |
| SDK kuralları | `sdk/ceremony.js` `CeremonyApi` (kim davet eder, kim hangi QR'ı tarar, aynı anda tek tören `CEREMONY_IN_PROGRESS`, `ALREADY_IN_FAMILY`) |
| Bulanık | `qr` (`qrCoz` ve `qrKind`), `cozuculer` (JOIN_HELLO). Tören durum makinesi (`al`) doğrudan hedef değil |

## 6. Kişisel köprü

| Alan | Değer |
|------|-------|
| Giriş | `core/core/protocol/bridge.js` `kopruCoz(metin, { kendi, simdi, kaynak })`; SDK `sdk/bridge.js` `BridgeApi.receive(metin, { kaynak, uygulama, sil })` |
| Kimden | Aynı telefondaki öbür EserX uygulaması, işletim sisteminin uygulamalar arası yolu; ağa çıkmaz, kripto yok (dosya başı) |
| Doğrulama | Önek `hfkopru1:`, ≤ 1 KB; base64url kanonik; önce sürüm (`BRIDGE_VERSION`); kanonik çözme; yön yalnız kendi alanlarından (`yonVar`); tür listesi (`BRIDGE_TYPE`); metin ≤ 280 B, Cc/Cf atılıp boş değil, bidi denetim karakteri yok (`BRIDGE_TEXT`); `at` geçmişe 7 gün (`BRIDGE_STALE`), ileriye 5 dk (`BRIDGE_AHEAD`); nonce tekrarı `BRIDGE_REPLAY` (en çok 1000 kayıt); yön `BRIDGE_DIRECTION`, kaynak `BRIDGE_SOURCE` |
| Bulanık | `kopru` (yanlış kabul denetimiyle) |

## 7. Yerel kanal (aynı telefonda iki uygulama)

| Alan | Değer |
|------|-------|
| Giriş | `gelenZarf({ kanal: 'yerel' })`: yalnız APP_PAIR_REQ (0xE8), APP_PAIR_OK (0xE9), APP_LOCAL_SYNC (0xEA); `core/core/protocol/local-channel.js` `PairNew`, `PairOld`, `openLocalSync` |
| Doğrulama | Eşleşme süresi `PAIR_TTL_MS` (`PAIRING_EXPIRED`), nonce (`PAIRING_NONCE`), olay biçimi (`PAIRING_EVENT`), sertifika (`INVALID_CERTIFICATE`), ana kimlik (`NOT_PRIMARY_IDENTITY`), biyometri onayı platformda (`NO_APPROVAL`); APP_LOCAL_SYNC çift sırrıyla mühürlü, iç tür listesi `icTurIzinli`, grup `OUT_OF_GROUP` |
| Bulanık | `zarf` (yerel kanal kipi) |

## 8. Kalıcı dosyalar (telefon)

| Alan | Değer |
|------|-------|
| Dosyalar | `worklet/persistence.js`: `kimlik`, `hlc`, `durum`, `arsiv`, `dosyalar/<blobId>`, `gomme/<cid>`, `kilit` |
| Saldırgan | Dizine yazabilen ama platform anahtarını bilmeyen (yedekten geri yükleme, başka uygulama, adli kopya) |
| Doğrulama | `Depo.oku`: sihir `HFW1`, sürüm (`STATE_VERSION`), kip; şifreli kipte AEAD (AD = sihir ‖ sürüm ‖ kip ‖ dosya adı; `STATE_CORRUPT`); şifreli dizinde açık kip dosyası `STATE_MODE_MISMATCH`; ad kuralı `AD_KURALI` (`adDenetle`). `Kalici._ac`/`_durumuAc`: kimlik ve durum birlikte, kimlik özeti, sayaç (`STATE_ROLLED_BACK`), `arsivOzetleri` ve `hlc` bağı (`_yanDosyalar`), Arşiv açık anahtarı (`ARCHIVE_KEY_MISMATCH`), durumdaki olay ve işlemler çekirdeğin doğrulamasından (`STATE_CORRUPT`, `err.neden`); prototip anahtarları reddedilir (`YASAK_ANAHTAR`). Arşiv öğeleri `arsivAc`'ta önce hepsi açılıp denetlenir, sonra uygulanır |
| Kilit | `kilitAl` (`DIR_LOCKED`), tek örnek `ALREADY_STARTED` (`worklet/start.js`) |
| Gömme dosyası | `core/ai/embedding.js` `GommeDizini.yukle`: kanonik (`INDEX_CORRUPT`), dönem kimliği (`INDEX_EPOCH`); okunamazsa silinir ve yeniden gömülür, `KALICI_*` dışarı çıkmaz |
| Bulanık | `dosya` (kimlik, durum bayt ve yapı düzeyinde, arsiv, hlc), `gomme-dosya` |

## 9. Kap dosyası

| Alan | Değer |
|------|-------|
| Giriş | `core/export/export.js` `baslikOku`, `ac`/`acAsync`, `kapOkuyucu`; `core/export/zip.js`, `core/export/archive.js`; bağımsız açıcı `tools/export-open/open.js`, `export-open.js` |
| Doğrulama | Sihir `HFKAP`, sürüm (`EXPORT_VERSION`), başlık ≤ 4096 B, JSON, parametre aralıkları (`EXPORT_PARAMETER`), tuz biçimi; telefonda `EXPORT_MEMORY`; akış: `EXPORT_TRUNCATED`, `EXPORT_EXCESS`, parça boyu; ZIP: `INVALID_ZIP`, `ZIP_TOO_LARGE` (2 GiB), `INVALID_ZIP_NAME`, `ZIP_CHECKSUM`, `ZIP_ENCRYPTED`, `ZIP_COMPRESSION`; yorumlu ZIP reddedilir. `export-open`: yol geçişi, tekrar eden ad (NFC, büyük/küçük harf), zip bombası, hedef klasör var olmamalı (`TARGET_EXISTS`) |
| Bulanık | `kap-baslik`, `kap-akis`, `kap-zip`. `tools/export-open/open.js` hedef değil (testi aynı vektörlerden geçer) |

## 10. Kutu: kör emanet ve pay

| Alan | Değer |
|------|-------|
| Kör emanet | `core/records/box.js` `Kutu.accept(senderHex, kind, bytes)`, `prune`, `onBuckets`, `onBucketIds`: yalnız okuyucu ya da `device:` yazar oturumundan (`UNAUTHORIZED`), gönderen kotası 256 MiB (`SENDER_QUOTA`, `BOX_FULL`), opId başına en çok 4 kopya (`COPY_LIMIT`), `TOMBSTONED`, `REPLAY`, `OPERATION_TOO_LARGE`, `INVALID_MESSAGE` |
| Kutu payı: giriş noktaları | `node/box-share.js` `ENTRY_POINTS` (beşi de önce `giris.gelenZarf`: oturum süzgeci, `POSTASIZ` türlerde Posta Kutusu yasağı, kanonik çözme; `myRole: 'uye'`, `peerRole` defterden). Açılışta `paylar.muhur` (`SEAL_CORRUPT`); kurucu yalnız gerçek TPM (`tpmGercekMi`) ya da test kipinde taklidi kabul eder, yoksa `NO_TPM` |
| `payAl` (KASA_SHARE_PUT 0xF1 → ACK 0xF2) | `core/vault/delivery.js` `teslimAl` (`WRONG_HOLDER`, `UNAUTHORIZED`, `DUPLICATE_HOLDER`, `STALE_VERSION`, beklemedeki gönderen `ON_HOLD`), mühürlü yazım, sonra alındı; yazım düşerse pay geri alınır, alındı gitmez |
| `surumIstegiAl` (KASA_VERSION_REQ 0x9E → RES 0x9F) | `core/vault/request.js` `PayTutucu.surum`: kanonik (`INVALID_MESSAGE`); yalnız yetkili istekçiye cevap (`yetkili`), değilse ya da pay yoksa `null` (ağa hata yok). TPM yazımı yaptırmaz (inceleme 19 B13) |
| `payIstegiAl` (KASA_SHARE_REQ 0x9B → RES 0x9C) | `PayTutucu.iste` → `_denetle`: imza (`INVALID_SIGNATURE`), istekçi oturumun karşı tarafı ve tutucu kutu (`UNAUTHORIZED`), tazelik 5 dk geçmiş / ileri sınır (`REQUEST_STALE`), kutu rolü istekçi olamaz, pay var mı (`PAY_YOK`), YA'da istekçi sırrın kök zinciri, KRA'da kasa okuyucusu ve ana kimlik (`UNAUTHORIZED`), zincirdeki beklemeli değişimden 72 saat (`bekle`), istekçi/sır/sürüm başına günde bir (`DAILY_LIMIT`). Ret `null`; 72 saat başlayınca ilk görülme mühürlü yazılır, pay verilecekse verilen kaydı yazılmadan pay gitmez |
| `zarfAl` (KASA_ENV_PUT 0xF3 → ACK 0xF4) | Beklemedeki gönderen `ON_HOLD`; `core/vault/box-envelope.js` `putCoz` (zarf ≤ 256 KiB, `INVALID_ENVELOPE`), `ZarfKopyalari.al`: yazan = gönderen ve kasanın bugünkü okuyucusu, ek kimlik değil (`UNAUTHORIZED`), yazanın imzası (`INVALID_SIGNATURE`), daha büyük sürüm varsa `STALE_VERSION`, aynı etiket ve sürümde küçük `envSeq` ya da geri giden `lastEpochSeq` `STALE_ENVELOPE`; koleksiyon başına en çok 4 kopya (`COPY_LIMIT`). Yeni kopya mühürlü yazılmadan alındı gitmez. Kutu zarfı açamaz |
| `zarfIstegiAl` (KASA_ENV_REQ 0xF5 → RES 0xF6) | `ZarfKopyalari.iste`: istekçi başına 24 saatte 10 istek (`ISTEK_SINIRI`, bellekte), kasanın okuyucusu, etiket `sodium_memcmp` ile; tutmayan her durum `null` (sessiz ret) |
| Bulanık | `kutu-pay` (yalnız `payAl`). Diğer dört girişin kanonik çözücüleri `giris.kaydet` ile kayıtlı (`core/vault/index.js`) olduğundan `zarf` hedefi bunları çözücü düzeyinde koşar; `surum`/`iste`/`ZarfKopyalari` durum mantığı bulanık hedef değil (testleri `node/test/d39.js`, `core/vault/test/`). `Kutu.accept` için ayrı hedef yok; kayıt çözücüleri `cozuculer`'de (D54). Kutu durum görüntüsü `dosya` hedefinin `durum` yolundan (`kutuKur`); doğrulanmadı |

## 11. Düğüm: yerel IPC ve düğüm zarfları

| Alan | Değer |
|------|-------|
| IPC çerçevesi | `node/ipc/frame.js` `CerceveOkuyucu`, `mesajCoz`: `uzunluk (u32be) ‖ IPC_MSG { type, reqId, body }`, en çok 1 MiB (`FRAME_TOO_LARGE`), kanonik (`INVALID_FRAME`), `BILINMEYEN_TUR`, `INVALID_BODY` |
| IPC bağlantısı | `node/ipc/server.js` `IpcUcu`/`Baglanti`: karşı ucun kullanıcısı beklenen değilse kurulmaz (`NO_EXPECTED_USER`), istek yalnız o soketin kapsamına; `node/ipc/socket.js` `dinle`: `kimlikBul` yoksa `NO_PEERCRED`, soket izni 0660 |
| Yetki yardımcısı | `node/privilege-helper.js`: sabit işlem listesi `ISLEMLER`, bu sürümde yalnız `BU_SURUMDE` (diğerleri `NOT_IN_THIS_VERSION`); işlem başına kullanıcı denetimi; bildirimi kendisi yeniden doğrular |
| Düğüm zarfları | `node/node-envelope.js` `DugumZarf.al`: `gelenZarf` + kayıtlı çözücüler (UPDATE_HAVE/REQ/DATA kanonik ve parça sınırı, UPDATE_APPROVE ve NODE_HEALTH imzalı gövde ‖ 64 B) |
| Sürüm bildirimi | `node/release.js` `bildirimCoz` (`FORMAT_ERROR`, `ROOT_EPOCH_ERROR`, `SIGNATURE_ERROR`, `COMMITMENT_ERROR`), `dosyaDenetle` (`DIGEST_MISMATCH`), `rotasyonUygula` |
| Bulanık | `node-ipc` (akış okuyucusu ve mesaj çözücüsü), `zarf` (düğüm zarfları). `privilege-helper.js` ve `release.js` bildirim çözücüsü ayrı hedef değil; testleri `node/test/` altında |

## 12. Afet modu: keşif, yerel bağ, olağan yol (RFC-0012)

| Alan | Değer |
|------|-------|
| Giriş | Keşif: `sdk/disaster.js` `DisasterApi.match({ bayt \| duyuru })` (taranan cihazın Bluetooth TAGS niteliği ya da yerel ağ UDP duyurusu, `core/disaster/local.js` `YEREL_AG` 239.255.72.70:47870; düğümde `node/disaster/bluez.js` aynı yolu çağırır) → `local.js` `duyuruCoz`, `core/disaster/message.js` `coz(AFET_TAGS)`, `eslestir`. Bağ: `DisasterApi.connect` (317) → `local.js` `bagKur` (ham akış: yerel ağda TCP, telefonda platformun Bluetooth / Wi-Fi Direct / Multipeer akışı, düğümde `node/disaster/gatt-stream.js` `GattAkisi`), sonra `afetEsitle` → `core/disaster/engine.js` `Oturum.al`. Olağan oturum ve emanetten gelen AFET_MSG gövdesi: `DisasterApi.takeFromNormalPath` → `Motor.normalYoldanAl`; kutuda işçinin UYARI'sı `DisasterApi.fromWorker` → `Motor.tasimayaAl` |
| Kimden | Keşif ve bağın ilk 4 baytı: kimliği doğrulanmamış yakındaki herhangi bir cihaz. Noise ve HELLO'dan sonra aile cihazı |
| Keşif denetimi | `duyuruCoz`: ilk bayt AFET_TAGS, en az 4 B (`DISASTER_CORRUPT`), port 0 değil (`DISASTER_PORT`); TAGS kanonik, `v = 1`, tam 25 etiket (`DISASTER_CORRUPT`); `DisasterApi.match` her hatada `null`. Eşleşme her çift için bu ve önceki dilimin etiketi (`hf/afet-near/`, 15 dk) |
| Bağ denetimi | Karşılayan ilk 4 baytı etiket sayar; çiftlerinden hiçbiriyle tutmazsa `DISASTER_LABEL`. Noise IK (`@hyperswarm/secret-stream`), anahtarlar çift sırrından günlük (`hf/afet-noise/`); karşılayanda gelen statik anahtar çiftin o günkü anahtarı olmalı (`DISASTER_NOISE`). İlk çerçeve HELLO (`DISASTER_HELLO_CORRUPT`), `verifyHello` (`DISASTER_HELLO_<kod>`), `caps`'te AFET (`DISASTER_CAPS`); 10 sn (`HELLO_MS`, `DISASTER_HELLO_TIMEOUT`). Düğümde aynı anda en çok 3 bağ (`node/disaster/bluez.js` `EN_COK_BAG`) |
| Tür kapısı | Bluetooth, Wi-Fi Direct ve Multipeer bağında yalnız HELLO, HELLO_OK, PING, PONG ve 0xB0–0xB5; başka tür bağı hemen kapatır (`local.js` `kapi`, `BagOturumu._al`, `DISASTER_TYPE_FORBIDDEN`). Yerel ağ bağı HELLO'dan sonra olağan doğrudan oturumdur: `olaganOturum` her zarfı `al(peer, tür, gövde, 'dogrudan')` ile çekirdeğin giriş noktasına verir (§2). Olağan oturum tablosunda 0xB1–0xB5 hiçbir rolde yok (`core/core/protocol/envelope.js` `AFET_BAGI`); AFET_MSG üye, cihaz ve misafir oturumlarında izinli |
| Eşitleme denetimi | `message.js` `coz`: kanonik (`DISASTER_CORRUPT`), AFET_MSG ≤ 600 B (`DISASTER_LENGTH`), HAVE ≤ 64 öğe. `engine.js` `Oturum`: aile dışı karşı `DISASTER_NOT_IN_FAMILY`; istenmeyen MSG atılır; taşıyıcıda `hops ≤ 4` ve `expiresDay` penceresi, komşu kotası (`core/disaster/limit.js` `Komsular`), pil eşiği; DONE yalnız `doneHash` tutarsa uygulanır (`core/disaster/store.js` `teslimEt`); açma `afetKey` ile AEAD, açılmazsa sessizce atılır (`message.js` `ac` → `null`). Hata fırlarsa `afetEsitle` bağı hemen kapatır; eşitleme en çok 30 sn. `tasimayaAl`: yalnız taşıyıcı, kaynak bağlı cihaz, öncelik UYARI, sınır, tekrar ve kota |
| Sınır | Bağ katmanında (`BagOturumu._al`) genel çerçeve sınırı bağ türüne göre: Bluetooth, Wi-Fi Direct ve Multipeer bağında en çok 1 + 256 KiB (`message.js` `SINIR.cerceve`); yerel ağ bağında en çok 1 + 1 MiB (`local.js` `YEREL_CERCEVE`; olağan doğrudan oturum, taşıyıcının `EN_BUYUK_GOVDE`'siyle aynı, `REC_OPS` 1 MiB'a kadar paketlenir). Aşan çerçeve bağı hemen kapatır (`DISASTER_LENGTH`). AFET_MSG en çok 600 B; HAVE ve WANT en çok 64 öğe, DONE en çok 4096 öğe (`message.js` `coz`, `DISASTER_CORRUPT`). En büyük meşru DONE (4096 öğe) 256 KiB sınırının altındadır |
| Bulanık | `afet` hedefi (`scripts/fuzz.js`): bütün türlerin `message.js` `coz`'u ve `duyuruCoz`. `bagKur` (HELLO el sıkışması) hedef değil; `zarf` hedefi AFET_MSG türünü `gelenZarf`'tan geçirir. Bozuk girdi testleri: `core/disaster/test/step-1.js` (kanonik, boy ve liste sınırları), `step-2.js` (aile dışı, bozuk ve büyük çerçeve), `step-3.js` (duyuru, HELLO bozuk, büyük zarf, süre aşımı, çerçeve ve öğe sınırları); düğüm `node/test/disaster.js`, `disaster-dbus.js`, `disaster-box.js` |

## 13. Hizmet paylaşımı: dizin, kart, önizleme, cevap, alıcı (RFC-0010)

| Alan | Değer |
|------|-------|
| Dizin | `sdk/service.js` `ServiceApi.directory({ bytes })` (300; baytları platform Eser geçidinden indirir) → `core/services/card.js` `dizinCoz`: kanonik (`INDEX_CORRUPT`), imza uygulamanın bildiği dizin anahtarlarından biriyle (`INVALID_SIGNATURE`), `validUntil ≤ issuedAt + 14 gün` (`INDEX_CORRUPT`); geçersiz kart yalnız kendisi atlanır (`atlanan`), dizin düşmez; aynı ilin eski sürümü `INDEX_STALE`. Bu katmanda bayt sınırı yok |
| Kart (yüz yüze QR) | `ServiceApi.addCard({ qr })` (301) → `card.js` `qrCoz`: önek `HFH1:`, kanonik base32 (`INVALID_QR`), 4 B sağlama, sonra `kartCoz`: kanonik (`CARD_CORRUPT`), `serviceId = hashLP('hf/service-id/', signPub)[0..16]`, alan kuralları (`kartAlanlari`), imza (`INVALID_SIGNATURE`). İptal listesindeki hizmet `NOT_SERVICE_ELIGIBLE`; eski kart `CARD_STALE`, farklı imza anahtarı `SERVICE_MISMATCH` (`kartSec`). Topluluk koleksiyonundaki kart kayıtları (`hf.hizmet.kart`) okunurken yine `kartCoz`'dan geçer, bozuk olan atlanır (`_eklenen`) |
| Önizleme (SHARE_PREVIEW 0xD0) | `ServiceApi.receivePreview` (`ENTRY_POINTS`): `gelenZarf` (kayıtlı çözücü `onizlemeBicim`, `PREVIEW_CORRUPT`; `POSTASIZ` değil). `core/services/preview.js` `onizlemeCoz`: aile (`FAMILY_MISMATCH`), gönderen oturumdaki gönderen (`SENDER_MISMATCH`), aktif üye (`UNAUTHORIZED`), imza `hf/share-preview/` (`INVALID_SIGNATURE`), içteki kart `kartCoz`, gövde aynı `shareId` ve hizmet, tür `tek` (`PREVIEW_CORRUPT`). Sonra başlatanın rolü (`UNAUTHORIZED`), tekrar (`PREVIEW_EXISTS`), gövdedeki her öğe bu telefondaki kaynak kayıtla alan alan aynı (`SOURCE_MISMATCH`), tek sahip (`MIXED_OWNER`), imzacı bu telefon (`NOT_SIGNER`). Kayıtlar henüz eşitlenmediyse bekletilir |
| Cevap | `ServiceApi.receiveReply({ shareId, cevaplar })` (309; platform alıcıdan `GET /v1/r` ile çeker) → `core/services/reply.js` `cevapAc`: kanonik (`REPLY_CORRUPT`), `packageId` paketinki (`PACKAGE_MISMATCH`), `n < 16` (`REPLY_LIMIT`), AEAD (`REPLY_OPEN_FAILED`), iç kanonik, hizmetin `signPub`'ıyla imza (`INVALID_SIGNATURE`), alan kuralları (`icAlanlari`). Geçersiz cevap atlanır (`atlanan`), aynı `n` ikinci kez yazılmaz |
| Referans alıcı (hizmet tarafı) | `services/receiver/` (AGPL-3.0; TLS önündeki ters vekilde). `server.js` `sunucuKur`: her cevapta `x-hf-source` (eski adı `x-hf-kaynak`) başlığı; `GET /source` (eski adı `/kaynak`) gövdeyi okumadan sabit metin döner (`HF_SOURCE` ya da eski `HF_KAYNAK` ortam değişkeni ya da `KAYNAK`; AGPL §13); diğer isteklerde gövde en çok 26 MiB, aşan istek `413` ve bağlantı kapanır. `receiver.js` `Alici.istek`: yalnız `/v1/` altındaki kalıplar (onaltılık kimlik biçimleri düzenli ifadeyle), dizin `404`; paket `PUT /v1/p/...` sahip özeti (`x-hf-owner`) zorunlu, ≤ 25 MiB, hizmet kartı yoksa `410`, adres başına saatte 60 yeni paket ya da sahip (`429`), tekrar `409`, `paketCoz` kanonik ve kimlikler yolla aynı, `expiresAt` ≤ 7 gün (`400`); silme sahip sırrıyla (`x-hf-owner-secret`, `403`); hizmetin istekleri (`inbox`, `ack`, dosya çekme, cevap yazma) `x-hf-auth` (`reply.js` `YetkiDefteri.denetle`: ±5 dk, imza `hf/share-inbox/`, aynı nonce 10 dk içinde `NONCE_REPLAY`; başarısızsa `401`); cevap ≤ 10 MiB + 64 KiB, `cevapCoz` kanonik, en çok 16, yalnız ack edilmiş pakete ve pencere içinde. Ters vekil adresi `HF_VEKIL` ile verilirse istemci adresi `x-forwarded-for`'un son değeri (vekilin eklediği; `_adres`), IPv6 /64 önekine indirilir (`adresAnahtari`). Depo bellek içi; sınırları (açılış öncesi inceleme): boş dosya parçası `400`; sahip başına hizmette paketler ve dosyalar birlikte min(maxMB, 25 MiB), en çok 64 parça (`413`); adres başına saatte 256 MiB yükleme (`429`; yeni sahip ve paket sayısı ayrıca saatte 60); hizmet başına 512 MiB, bütün depo 1 GiB ve 50 000 kayıt (`507`). Tek adres saatte en çok 256 MiB ekleyebilir; bir hizmeti dolduran adres öbür hizmetleri durdurmaz. Gelen kutusu sayfalı (en çok 100 paket ve 64 MiB; `devam`, `afterId`). Süpürme en çok saniyede bir. Sunucu (`server.js`): en çok 512 eşzamanlı bağlantı; gövde okunmadan alıcının ön denetimi (`onDenetim`: bilinmeyen yol `404`, yanlış yöntem `405`, sahip başlığı yok `400`, hizmet yok `410`) ve yolun gövde sınırı (bildirilen boy aşıyorsa `413`); istemci (alıcının adres anahtarı) başına en çok 8 eşzamanlı istek (`429`); bütün bekleyen gövdeler birlikte en çok 256 MiB (`503`); istek en çok 120 sn; alıcının beklenmedik hatası `500` (süreç düşmez). Gelen kutusu imleci `(t, packageId)` (`afterId`'siz `after > 0` `400`), sayfa sınırı kesin; cevaplar hizmet deposuna sayılır; vekil adresi `::ffff:` eşlemesinden arındırılarak karşılaştırılır (`adresNormal`) |
| Bulanık | `hizmet` hedefi: `card.js` `kartCoz`, `dizinCoz`, `qrCoz` ve `reply.js` `cevapCoz`. Referans alıcının HTTP katmanı hedef değil; `zarf` hedefi SHARE_PREVIEW'un kayıtlı çözücüsünü (`onizlemeBicim`) koşar. Bozuk girdi testleri `core/services/test/service.js` (kart, dizin, QR, gövde, onay), `step-45.js` (cevap sınırları ve açma hataları), `services/receiver/test/` |

## 14. Uç cihaz: yapılandırma, akış, çerçeve (RFC-0008)

| Alan | Değer |
|------|-------|
| Giriş | Üye telefonunda `sdk/edge.js` `CameraApi` (`configSeen`, `receiveStatus`, `receiveAccept`, `receiveClose`, `receiveWipeReport`) ve `sdk/api.js` `TaskApi.receiveProfile` (NODE_PROFILE); uç modundaki cihazda `EdgeDevice` (`receiveConfig`, `receiveStreamRequest`, `receiveClose`, `receiveScreen`, `receiveTask`, `receiveRemoval`); işçide `node/edge/worker-stream.js` (`yapilandirmaAl`, `kabulAl`, `kapatAl`). Hepsi önce `giris.gelenZarf` (§2). Uç modülü `giris.kaydet` ile çözücü kaydetmez: tür oturum süzgecinden geçer, gövdeyi modül kanonik çözer (`core/edge/encoding.js` `imzaliCoz`, `duzCoz`; `INVALID_MESSAGE`) |
| Oturum kuralları | `core/core/protocol/envelope.js`: UC türleri yalnız ilgili oturumlarda (`UC`, `UC_AKIS`); NODE_PROFILE ve UC_STREAM_* yalnız doğrudan oturum (`YALNIZ_DOGRUDAN_DUGUM`); UC türleri Posta Kutusu'ndan gelmez (`POSTASIZ`) |
| İmza ve yetki | İmza `hashLP('<etiket>', familyId, body)` (`encoding.js` `imzaGecerli`). UC_CONFIG `core/edge/config.js` `yapilandirmaDenetle`: doğru uç (`WRONG_EDGE`), defter yetişmiş (`LEDGER_BEHIND`), imzacı hem `ledgerSeq` anında hem bugün aktif ebeveyn ve imza (`UNAUTHORIZED`); çocuk rolü ve misafir izni (`grant:`) hiçbir listede olamaz (`INVALID_TARGET`); kip, video sınırları, pencereler, sensörler (`INVALID_BODY`). UC_STREAM_OPEN `core/edge/stream.js` `akisAcDenetle` (§11.5 sırası): imza ve isteyen (aktif üye, kutu değil, ya da aktif işçi; `ledgerSeq` anında da), kip kamera, hedef ve amaç (`hedefUyar`: işçi yalnız `analiz`, üye yalnız `canli`, çocuk hiç) → `IZIN_YOK`; `YAPILANDIRMA_DEGISTI`, `PENCERE_DISI`, `ROLE_YASAK` (yalnız doğrudan; uç akışı kapatma kodları telde Türkçe), `SICAK`, `PIL`, en çok 2 akış `MESGUL`. UC_STATUS ve NODE_PROFILE: gönderen imzacı, sınıf, imza, `seq` geri gidemez (`UNAUTHORIZED`, `INVALID_SIGNATURE`, `STALE_MANIFEST`; `core/edge/status.js`, `core/edge/profile.js`). APP_WIPE_REPORT `encoding.js` `silmeDenetle` (`INVALID_MESSAGE`) |
| Medya çerçevesi | `core/edge/frame.js` `AkisAcici.ac`: başlık + etiketten kısa `FRAME_TOO_SHORT`, sürüm `FRAME_VERSION`, tip ve yön `FRAME_TYPE`, ssrc ve dönem ya da AEAD (AD = başlık) `FRAME_DECODE_FAILED`, 64 çerçevelik tekrar penceresi `REPLAY`. Üst boy sınırı bu katmanda yok. Kareleri ağda taşıyan yol taşıyıcıda henüz yok (`node/worker.js`: `cerceveGonder` false, İstek 168; `node/edge/worker-stream.js` `cerceveAl` bağlanmamış); telefonda taşıma platformda (`sdk/edge.js` dosya başı) |
| İşçi akış soketi | `node/edge/stream-socket.js` `Okuyucu`: `uzunluk (u32be) ‖ tür ‖ gövde`, 0 ya da 4 MiB üstü uzunluk `STREAM_FRAME_TOO_LARGE`; denetçi ile görevin yerel akış sunucusu arasında Unix soket (`/run/havenfold/gorev/<taskId>/akis.sock`) |
| Bulanık | `uc` hedefi: imzalı gövdeler (profil, akış açma, durum, silme raporu), `kabulCoz`, `kapatCoz` ve `AkisAcici.ac`. Akış soketi hedef değil; `zarf` hedefi UC türlerini `gelenZarf` süzgecinden geçirir. Bozuk girdi testleri `core/edge/test/edge.js` (imzalı mesajın kısa ve bozuk gövdesi), `core/edge/test/edge-modes.js`, `node/test/edge-worker.js` |

## 15. Kurulum ve silme ortamı (`installer/`)

| Alan | Değer |
|------|-------|
| Sürüm bildirimi ve paket | USB derlemesinde `installer/build/notification-check.js` (`node/release.js` `bildirimCoz`, `paketOzeti`; RFC-0007 §12.1 madde 1–4, ürün, sürüm). Var olan Ubuntu'da `installer/install/notification.sh` kabukta: compact-encoding en kısa kodlama, sürüm biçimi ve kanal (`FORMAT_ERROR`), kök dönemi (`ROOT_EPOCH_ERROR`), OpenSSL Ed25519 imza (`SIGNATURE_ERROR`), taahhüt (`COMMITMENT_ERROR`), ürün ve kanal (`URUN`, `KANAL`), paket özeti `b2sum` (`DIGEST_MISMATCH`). Kurulu düğümün kök ya da sürüm durumu kaybolmuşsa ilk kurulum sayılmaz (`hf_kurulum_durumu`, `STATE_INCOMPLETE`). Güven kökü, makinede kurulu kök durumu gömülüden yeniyse odur (`hf_kurulu_kok_sec`, `ROOT_CONFLICT`, `ROOT_STATE_CORRUPT`); `yetki.durum` şeması kesin (`PRIVILEGE_STATE_CORRUPT`); sürüm düşürme ve geri çekilmiş sürüm paketteki Node çalışmadan reddedilir (`hf_surum_denetle`, `python3 -I`). Hedefte paket özeti yeniden (`installer/target/common.sh`); paket `core/export/zip.js` okuyucusuyla açılır (`installer/lib/package.js`) |
| Disk şifrelemesi | `installer/lib/luks.js`: girdi `cryptsetup luksDump --dump-json-metadata` ve `clevis luks list` çıktıları (`INVALID_LUKS_DUMP`), kurtarma anahtarı 32 B (`INVALID_RECOVERY`); adımları `installer/target/hf-luks-yenile` uygular (PCR 7 bağı) |
| Emeklilik bileti | `installer/erase/ticket.js` `biletCoz`: ESP'de `EFI/havenfold/emekli.bilet`, önek `HFRT1`, en çok 512 B, kanonik, `v = 1`, kimlik listesi boş değil (`INVALID_TICKET`); birden çok ESP'de farklı bilet `TICKET_CONFLICT`; bilet yoksa `BILETSIZ`. Bilet sır değildir (dosya başı). Düğümün bileti yazan işlemi (`efi-bilet-yaz`) bu sürümde yok (`node/privilege-helper.js` `BU_SURUMDE`) |
| Disk keşfi | `installer/erase/discovery.js`, `nvme.js`, `ata.js`: `lsblk -J`, `nvme id-ctrl`, `hdparm` çıktılarını ayrıştırır (saf; komutları `shell.js` çalıştırır). Silme ortamında ağ kapalı (`installer/erase-mode/ag-kapali.nft`, `havenfold-ag-kapali.service`) |
| Bulanık | Yok. Testler `installer/test/` (`erase-parsing.js`: bozuk lsblk ve araç çıktıları dahil; `install-lib.js`, `scripts.js`, `vector.js`); baştan sona deneme yalnız sanal makinede (`installer/test/vm`, CI) |
