# Tehdit modeli özeti

> Kaynak: `KURUCU-BELGE.md` §13.1 (T1–T30) ve `docs/rfc/*.md` "Güvenlik değerlendirmesi" bölümleri. Her tehdit için
> bu depodaki önlemin yeri. Önlem platformda ya da başka depodaysa "platformda" / "kodda yok" yazılır.

## 1. Kurucu belge §13.1

| # | Tehdit | Beklenen davranış (kurucu, kısaltılmış) | Bu depodaki önlem |
|---|--------|------------------------------------------|-------------------|
| T1 | Kutu çalınır | Diskte şifreli zarflar ve paylar; içerik açılmaz; ebeveyn çıkarır, kasa sırrı döndürülür | Kör emanet şifreli metin tutar (`core/records/box.js` `Kutu.accept`; kutu okuyucu değildir). Cihaz payı sınırı `core/vault/threshold.js` `yaEsik` (≤ t−2), `kraEsik` (≤ t−1). Kutu payı TPM mührüyle (`node/box-share.js`, `node/tpm.js` `sistemTpm`, D76); TPM yoksa kutu cihaz payı tutmaz. Döndürme: `VaultApi.rotateVault` (403). |
| T2 | İşçi çalınır | Koleksiyon anahtarı yok; TPM'siz pay yok | Dönem anahtarı yalnız okuyuculara: `core/records/replica.js` `generateKey` (`to` okuyucu listesi). Cihaz payı adayları `threshold.js` `cihazAdaylari(L, uygunCihaz)`; uygunluk dışarıdan (`uygunCihaz` kancası; İstek 67, 127). |
| T3 | İşçide kötü amaçlı yazılım | Yalnız verilen işin dosyaları; ağ kapalı; ilk kullanım onayı; silme raporunu USB üretir | İlk kullanım onayı `core/tasks/approval.js` `OnayDefteri`; görev denetimi `core/tasks/audit.js`. Konteyner: `node/podman.js` (kök olmayan Podman, `--network=none`, kök salt okunur, `--cap-drop=all`, no-new-privileges, imaj `@sha256:` özetiyle; RFC-0002 §11.1). Silme raporu doğrulaması `core/core/protocol/retirement.js` `verifyWipeReport`; silme ortamı `installer/erase/` (`havenfold-sil`, rapor `installer/erase/report.js`; derleme `installer/build/erase-root-build.sh`). |
| T4 | Telefon kaybolur | Yedek ve kasa §10 ile geri gelir | Pay üretimi ve teslimi var (`core/vault/share.js`, `delivery.js`, `sdk/vault.js`). Kurtarma SDK'da (`sdk/vault.js`, 400–405: `payIste`, `pay.birlestir`, `zarfAc`) ve kutuda (`node/box-share.js` `payIstegiAl`). Yedek dizininin açılması (`yedek.dizinAc`) yalnız çekirdekte. |
| T5 | Zorlama | Zorlama PIN'i sessizce temizler | Kodda yok (platformda). |
| T6 | Eser'in servisleri ele geçirilir | Posta Kutusu yalnız şifreli bayt görür | Posta Kutusu mührü `core/core/messaging/seal.js` `sealMailbox`/`openMailbox` var, kullanan yok; Posta Kutusu kodda yok. Pay teslimi postadan yasak (`ingress.js` `MAILBOX_FORBIDDEN`). |
| T7 | Kötü niyetli güncelleme | Yalnız kök imzalı bildirimdeki paket; sürüm düşürme ebeveyn onayı | `node/release.js` `bildirimCoz` (biçim, kök dönemi, imza, `nextRootHash` taahhüdü), `dosyaDenetle` (BLAKE2b özet ve boy), UPDATE_APPROVE (`hf/update-approve/`); `node/privilege-helper.js` yeniden doğrular, sabit işlem listesi; `node/update.js` durum makinesi. İlk kurulumda aynı denetimler: USB derlemesinde `installer/build/notification-check.js`, var olan Ubuntu'da kabukta `installer/install/notification.sh` (OpenSSL Ed25519, `b2sum`). Telefon güncellemesi mağazada (platformda). |
| T8 | Sahte cihaz ekleme | Yüz yüze; QR 60 sn'de yenilenir; 5 resim; biyometri | `core/transport/ceremony.js` (deneysel): 5 resim el sıkışma özetine ve iki geçici anahtara bağlı (`sas`); davet sırrıyla tek bağlantı (`goster`). QR ekranda 60 sn'de yenilenir (yeni davet sırrı ve buluşma anahtarı), tek QR en çok 180 sn (`YENILE_MS`, `TTL_SN`; D65, RFC-0028 §5 d). JOIN_HELLO `caps`'i tören MAC'inin kapsamında (RFC-0021 §2 madde 81). Ekleme olayı ebeveyn imzalı defter önerisi (`d.defter.addMember`). Biyometri platformda. |
| T9 | Ele geçirilmiş DVR/kamera | İnternet kapalı, yalnız okuma | Kodda yok: IP kamera kaynağı ve kamera ağı bu sürümde yok (`node/podman.js` başlık: "IP kamera kaynağı (KAYNAK_AG, kamera-ag) bu sürümde yok"; `node/privilege-helper.js` `kamera-ag` `BU_SURUMDE`'de değil). Görüntü görevi yalnız aile üyesi uç cihazdan (sınıf `uc`) kaynak alır (`node/edge/worker-stream.js` `baslat`, `INVALID_SOURCE`); uç cihazın kendisi T22. |
| T10 | Görev imajı değiştirilmiş | İmaj özeti imzalı bildirimde | Bildirimde özet alanları `node/release.js` (`manifestGovde`); imaj yükleme ve çalıştırma `node/podman.js` `imajYukle`/`imajBul`: arşiv özeti bildirimle, yüklenen imaj `ociDigest` ile denetlenir; kayıtta olmayan imaj çalışmaz. |
| T11 | Güncelleme sunucusu izlenir | IP ve sürüm görülür | Dürüst sınır; kodda önlem yok. NODE_HEALTH seri numarası taşımaz (`node/health.js` başlık). |
| T12 | Atılan üye yazmaya devam eder | `ledgerSeq` yetkisi, kesim, yeni dönem | `core/records/permission.js` (`epochAllowed`, aralıklar), `core/records/cutoff.js`, `replica.js` `receiveCutoff` (`CUTOFF_UNAUTHORIZED`, `RANGE_NOT_ENDED`), yeni dönemde anahtar üretimi `_autoKeys`. |
| T13 | Ebeveyn kişisel veriye erişir | Kişisel koleksiyonu ebeveyn değiştiremez; onaysız işçiye gitmez | `COLLECTION` kuralları defterde (`core/core/ledger/v21.js`; RFC-0003 §5.9); ilk kullanım onayı `core/tasks/approval.js`. |
| T14 | Mekan izleme aracına döner | Bildirim incelemesi, işçi denetimi, `_subj` kuralı | `_subj` ayrılmış alan `core/records/fields.js` `RESERVED`, türü belirleyen işlemden (`core/records/merge.js` `SAHIP_ALANLARI`). Bildirim incelemesi kodda yok. |
| T15 | Ayrılan çalışan okumaya devam eder | Yeni dönem, kesim, HELLO reddi, iş verisi silinir | HELLO reddi `hello.js` `verifyHello` (`NOT_MEMBER`); iş kapsamı silme `Replika.isKapsaminiSil`, `sdk/team.js` (çıkış makbuzu `team-exit.js`); ekipte çıkarılmış üyeden yalnız `EKIP_CIKIS_OK` (`ingress.js`). |
| T16 | Hizmet geçidi ele geçirilir | İçerik açılmaz; sahte cevap yazılamaz | Çekirdek: paket hizmetin `encPub`'ına şifreli (`core/services/package.js` `paketKur`: geçici X25519, `hf/share-key/`, AD `hf/share-ad/`); alıcı yalnız dış kabuğu görür (`services/receiver/receiver.js` `paketCoz`). Cevap hizmetin `signPub`'ıyla imzalı ve `replyPub`'a şifreli (`core/services/reply.js` `cevapAc`, `INVALID_SIGNATURE`); hizmetin alıcıdaki istekleri `x-hf-auth` (`YetkiDefteri`). Üst veri (sahip özeti, boy, zaman, IP) alıcıda görünür. Eser'in geçidi bu depoda yok; referans alıcı var (`saldiri-yuzeyi.md` §13). |
| T17 | Sahte hizmet | Dizin doğrulaması, çevrimdışı dizin anahtarı, iptal listesi; yüz yüze eklenende "Eser doğrulamadı" | Dizin imzası uygulamanın bildiği dizin anahtarlarıyla (`core/services/card.js` `dizinCoz`, `INVALID_SIGNATURE`), iptal listesi (`hizmetKarti`, `NOT_SERVICE_ELIGIBLE`), kart imzası ve `serviceId` bağı (`kartCoz`), anahtar değişimi reddi (`kartSec`, `SERVICE_MISMATCH`). Rozet: güncel dizinde varsa `dizin`, yoksa `yuz-yuze` (`sdk/service.js` `_rozet`, `hizmetKarti` `trust`). Dizin anahtarının çevrimdışı saklanması ve ekrandaki "Eser doğrulamadı" metni platformda / bu depoda değil (`dizinImzala` yalnız araç ve vektör). |
| T18 | İstem enjeksiyonu | Asistanın eli yok; sabit istem; çıktı denetimi | `core/ai/assistant.js`, `core/ai/block-filter.js`, `core/ai/child.js` (ayrıntısı bu paketin kapsamında incelenmedi). |
| T19 | Değiştirilmiş model dosyası | Kök imzalı model bildirimi | Kodda yok: `core/ai/capability.js` `yetenekKur` model bildirimini geçerli olarak alır; kök imzalı model bildiriminin çözücüsü ve imza denetimi `core/ai`, `sdk/ai.js` içinde bulunamadı (platformda ya da sonraki iş). |
| T20 | Uyandırma yağdırma | İmzalı; yazar olmalı; saatte 30; basamak bir kez | `core/events/envelope.js` (imza `hf/vaka-uyandir/`, `hf/vaka-dur/`; `SAATTE = 30`, `LIMIT_REACHED`). |
| T21 | Kök anahtar çalınır | Önceden taahhüt edilen yedek kök | `node/release.js` `rotasyonUygula` (`COMMITMENT_ERROR`: `hash('hf/release-root/', newRoot)` = `nextRootHash`; `ROOT_EPOCH_ERROR` +1), `zinciriUygula`. |
| T22 | Uç kamera yetkisiz izlenir | Ebeveyn imzalı `UC_CONFIG`; çocuk ve misafir hedef olamaz | `core/edge/config.js` `yapilandirmaDenetle` (imzacı `ledgerSeq` anında ve bugün aktif ebeveyn, `UNAUTHORIZED`; çocuk rolü ve `grant:` hedef olamaz, `INVALID_TARGET`); `core/edge/stream.js` `akisAcDenetle` (isteyen imzası, hedef ve amaç `hedefUyar`, pencere, yalnız doğrudan oturum `ROLE_FORBIDDEN`, en çok 2 akış); uçta `sdk/edge.js` `EdgeDevice.receiveStreamRequest` ve görünür izleme kapısı (güncel UC_STATUS olmadan kare mühürlenmez, dosya başı). Kare şifrelemesi akış başına anahtarla (`core/edge/frame.js`). Kamera, kodlayıcı ve ön plan hizmeti uygulamanın yerli modülünde (RFC-0029 §3). |
| T23 | Konteynersiz işçide yönetici yazılım | Koruma yok; kasa gitmez | Kasa koleksiyonunda `taskAccess` false zorlanır (`sdk/api.js` `openCollection`/değişiklik yolu: `sensitivity === 'kasa' ? false`). |
| T24–T26 | Bağlantı hizmeti, konteyner uygulaması, yerel tünel | RFC-0009, RFC-0011 | Kodda yok (grep: `RFC-0009`, `RFC-0011` test dışı kodda yalnız yorumlarda, `core/records/file.js`, `core/tasks/capability.js`). |
| T27 | Bluetooth ile izleme | Dönen, doldurulmuş etiket listesi | `core/disaster/local.js` `etiketListesi`: her çift için `hf/afet-near/` etiketi (4 B, 15 dakikalık dilim, `core/disaster/derivation.js`), rastgele baytla 25'e tamamlanır ve karışır; `EtiketKaynagi` dilim boyunca aynı listeyi verir (iki okumanın kesişimi aile büyüklüğünü vermesin). Bağın Noise anahtarı günlük (`hf/afet-noise/`). Bluetooth reklamı ve adres döndürme platformda; düğümde BlueZ (`node/disaster/bluez.js`). |
| T28 | Kötü niyetli afet taşıyıcısı | Açamaz, değiştiremez, teslimi sahteleyemez; yalnız geciktirir ya da atar | AFET_MSG `afetKey` ile AEAD (çift sırrından, `hf/afet/`; `core/disaster/message.js` `muhurle`/`ac`); AD `mid`, `toTag`, `prio`, `expiresDay`, `doneHash`'i kapsar. Teslim kanıtı `doneHash = hashLP('hf/afet-done-hash/', doneSecret)`, `doneSecret` yalnız gönderen ve alıcıda (`core/disaster/store.js` `teslimEt`). `hops` AD dışında: taşıyıcı değiştirebilir, sınır `core/disaster/engine.js` `Oturum._mesaj` (≤ 4) ve komşu kotası. Geciktirme ve atma kabul edilen sınır. |
| T29 | Başka uygulama ek kimlik olmaya çalışır | İmzalı uygulamalara açık yerel kanal; biyometri; ek kimlik oy vermez, pay tutmaz | `core/core/protocol/local-channel.js` `PairOld` (`NO_APPROVAL`, `NOT_PRIMARY_IDENTITY`); ek kimlik oy vermez `SECONDARY_IDENTITY_CANNOT_VOTE` (`core/core/ledger/`); pay tutmaz `core/vault/threshold.js` `kisiAdaylari` (yalnız ana kimlik). Uygulama imzası denetimi platformda. |
| T30 | İki ailenin üyeliği aynı telefona bağlanır | Aile başına rastgele kimlik; ortak anahtar, kişi kimliği ve belirteç yok; IP düzeyindeki bağ kabul edilmiş sınır (RFC-0034 §12) | `worklet/start.js`: aile başına ayrı çekirdek örneği (ayrı `Kalici`, SDK, eşitleyici, taşıyıcı cihazı), en çok 3 aile (`FAMILY_LIMIT`), aynı aile iki kez yok (`FAMILY_EXISTS`; QR'daki `famHint`), kutu, uç ve işçi tek aile (`DEVICE_SINGLE_COMMUNITY`). Ek örneğin depo anahtarı ayrı türetilir (`worklet/persistence.js` `derive(platform anahtarı, 'hf/worklet/kalici', yerelNo)`). Ortak kalanlar dosya başında yazılı: IPC bağı, HyperDHT düğümü (aynı IP ve DHT düğümü: kabul edilen sınır), platform anahtarı (örnek başına türetilir), Arşiv açık anahtarı, dizin kilidi. |

## 2. RFC güvenlik bölümleri (bu depoda kodu olanlar)

### RFC-0001 kayıt katmanı (§18)

| Tehdit | Koddaki önlem |
|--------|---------------|
| Kutu içeriği/yazarı görmek ister | Yazar, saat, içerik şifreli metinde: `core/records/operation.js` `sealOp` (AD yalnız aile, koleksiyon, dönem, `keyId`) |
| Kutu kendiliğinden işlem atar | `core/records/box.js`: yalnız yazarın imzalı REC_PRUNE'u ya da 30 gün okuyucusuz (`prune`, `gc`) |
| Kutu diski sahte işlemle dolar | Okuyucu/yazar oturumundan kabul, gönderen kotası `SENDER_QUOTA`, `MAX_KOPYA` |
| Yetkisi biten yazar geçmişe yazar | `cutoff.js`, `replica.js` `receiveCutoff` |
| Çıkarılan okuyucu anahtar yayar | `key.js` `verifyKeyEntry`: üreten dönem anında okuyucu (`KEY_UNAUTHORIZED`), imza (`INVALID_SIGNATURE`) |
| Başkasının dosyasını silmek | `file.js` BLOB_DEL imzalı, `silebilenler` (ebeveyn/sahip) |
| Bilinen sınır: AEAD anahtara bağlayıcı değil | `keyId = hash('hf/rec-epoch/', key)` (`operation.js` `keyIdOf`), anahtar girdisi imzalı |

### RFC-0002 görev katmanı (§16)

Görev tekrarı, delegasyon, koordinatör belgesi: `core/tasks/audit.js`, `coordinator.js`, `encoding.js` (imzalar
`hf/task/`, `hf/task-delegation/`). Ağı kapalı konteyner ve imaj özeti: `node/podman.js`. "İşçi veriyi saklar" kabul edilmiş
sınırdır.

### RFC-0003 defter v2.1 (§12)

| Tehdit | Koddaki önlem |
|--------|---------------|
| Sessiz ayrışma | Sürüm kapısı: `hello.js` `CAPS`, `join-hello.js` `checkJoinCaps` |
| Misafir aile bilgisini görür | `guest-view.js` (yalnız ilgili kişiler; imzacı yalnız GRANT veren ebeveyn; `ledgerLen` artar) |
| Kutu emanet anahtarlarını görür | `seal.js` `CTRL_TYPES` 0x80–0xFE emanet mührü |
| Sahte silme raporu | `retirement.js` `verifyWipeReport` (rapor anahtarı QR'dan) |

### RFC-0004 kasa (§9)

| Tehdit | Koddaki önlem |
|--------|---------------|
| Evdeki bütün cihazlar çalınır | `threshold.js` `yaEsik`/`kraEsik`; evdeki kâğıt pay sayılmaz (`yaDagitim`) |
| Kurtarma bahanesiyle yedek çalma | 72 saat `request.js` `BEKLEME_MS`, `bekleyenDegisimler`; tazelik `TAZELIK_MS` 5 dk |
| Eski paylar toplanır | `VaultApi.rotateVault` (403; yeni sır) |
| Shamir uygulama hatası | Denetlenmiş kütüphane, sabit integrity (`scripts/license-check.js`), `commit` (`share.js` `birlestir`), rastgelelik öz denetimi (`random.js` `ozDenetim`), x = 0 reddi (`decodeShare`), D60 bağımsız başvuruyla karşılaştırma (`core/vault/test/d60.js`) |

### RFC-0005 ekip (§19)

Yönetici yetki toplaması, geçici süre sınırı, çıkış makbuzu: `core/core/ledger/team.js`, `quorum.js`,
`proposals.js` (`TERM_LIMIT`, `TEMPORARY_CANNOT_VOTE`), `core/core/protocol/team-exit.js`, `sdk/team.js`. Köprü:
`core/core/protocol/bridge.js` (§6 `saldiri-yuzeyi.md`). Lisans belgesi taklidi kodda yok.

### RFC-0006 olay ve rutin (§18)

Uyandırma yağdırma `core/events/envelope.js`; olay ve vaka kayıt işleminin şifreli metninde (`core/records/operation.js`); ileri saat
sınırı `core/records/hlc.js` `FUTURE_MS = 5 dk`; olay katmanında `_t ≤ hlc + 5 dk` denetimi `core/events/event.js`
`olayHatasi` (`GELECEK_MS`, sonuç `'GELECEK'`).

### RFC-0007 düğüm (§17)

Kodda olan: bildirim ve kök döndürme (`node/release.js`), yetki yardımcısı (`node/privilege-helper.js`; kök dizini 0700,
dosyalar 0600), soket izni ve SO_PEERCRED kancası (`node/ipc/socket.js`, `server.js`), NODE_HEALTH yalnız doğrudan
oturum (`ingress.js` `YALNIZ_DOGRUDAN_DUGUM`). Ayrıca: Podman'da görev (`node/podman.js`), LUKS2 + TPM (Clevis) ve PCR 7 bağı (`installer/lib/luks.js`, `installer/target/hf-luks-yenile`, `havenfold-luks-yenile.service`), silme ortamı (`installer/erase/`), kurulum USB'si (`installer/build/havenfold-usb-build.sh`), var olan Ubuntu'ya kurulumda kabukta bildirim doğrulaması (`installer/install/notification.sh`). Aşırı ısınma (RFC-0007 §11): sıcaklık sysfs'ten okunur (`node/temperature.js` `sicaklikOku`, en sıcak bölge; 0 ve 150 °C üstü yok sayılır), işçi her bildirimde durum hesaplar: 90 °C üstünde `sicak` (görev almaz), 80 °C altına inene kadar öyle kalır (`node/worker.js` `caps`, `core/tasks/capability.js` `durumHesapla`). Kalan: TPM'siz makinede disk şifrelenmez (kurucu §9.2); CI'da gerçek TPM yok, kurulum sanal makinede (`installer/test/vm`) sınanır; disk sağlığı ölçülmez (`sinirlar-ve-kapsam-disi.md` madde 23).

### RFC-0008 uç cihaz (§15)

Yetkisiz izleme: T22. Uç akışı yalnız doğrudan oturumda (`core/core/protocol/envelope.js` `YALNIZ_DOGRUDAN_DUGUM`, `stream.js`
`ROLE_FORBIDDEN`); kare anahtarı akış başına ve yön başına (`core/edge/frame.js`, `hf/uc-stream/`, `hf/uc-stream-ters/`), tekrar
penceresi 64. Ucun kaldırılmasında uygulama verisinin silindiği imzalı raporla bildirilir (`core/edge/erasure.js`, `encoding.js`
`silmeDenetle`: anahtar imhası ya da dosya silmesi yoksa sonuç `hata`; korumalı anahtar deposu dışında `dogrulanamadi`);
gerçek silme yerli modülde. Konteynersiz işçi: T23.

### RFC-0010 hizmet paylaşımı (§18)

Geçit ve sahte hizmet: T16, T17. Gönderim onaydan sonra (`sdk/service.js` `confirm`: gövde özeti `SUMMARY_MISMATCH`, özel
nitelikli kategoride rıza metni `CONSENT_TEXT_REQUIRED`, yurt dışında ayrı rıza `ABROAD_CONSENT_REQUIRED`, imzacı
`NOT_SIGNER`); hizmet her üyeyi hizmet başına ayrı takma adla görür (`core/services/package.js` `takmaAd`); gizli paylaşımın
hizmet kimliği tuzlu özetle yazılır (`core/services/approval.js` `gizliService`, `hf/share-svc/`). Alıcıdaki kötüye kullanım
sınırları `services/receiver/receiver.js` (`saldiri-yuzeyi.md` §13).

### RFC-0012 afet modu (§15)

Bluetooth izleme ve kötü niyetli taşıyıcı: T27, T28. Misafir taşımaz ve ailenin trafiğini görmez (`core/disaster/engine.js`
`TASIR`, `Oturum.basla`: misafire yalnız kendi bıraktığı mesajların teslim bilgisi ve ona giden mesajlar); gönderim
sınırları (METİN saatte 30, UYARI tür başına dakikada 1) ve komşu kotası (10 dakikada 100) `core/disaster/limit.js`; konum
yuvarlama `core/disaster/message.js` `konumYuvarla`. Afet bağlarında yalnız afet türleri (`core/disaster/local.js` `kapi`).

### RFC-0013 yapay zeka (§20)

"Dizin dosyası kopyalanır": `core/ai/embedding.js` dosya anahtarı dönem anahtarından (`hf/yz/dizin`), metin özeti
anahtarlı. "Çıkarılan üyenin cihazında dizin kalır": `sdk/ai.js` açılış süpürmesi (inceleme 18 B1). Model bildirimi
doğrulaması kodda yok (T19). İstem ve geçit satırları bu pakette koda bağlanmadı (T18).

### RFC-0014 kap (§12)

Argon2id alt/üst sınırları, başlık AD'de, `TAG_FINAL` zorunlu: `core/export/export.js` (`LIMIT_REACHED`, `baslikDenetle`,
`EXPORT_TRUNCATED`, `EXPORT_EXCESS`). "Unutulan geçici dosya 10 dakikada silinir": worklet açılan dosyaları 10 dakikada siler
(`worklet/start.js` `ACILAN_OMUR_MS = 10 * 60_000`); RFC-0014 ile aynı.

### RFC-0017 birden çok uygulama (§15)

Yerel kanal `core/core/protocol/local-channel.js`; ek kimlik oy ve pay kuralları yukarıda T29.

### RFC-0028 telefon taşıyıcısı (§8)

Buluşma anahtarları çift sırrından, saatlik (`pairSubkeys` `listenSeed`/`dialSeed`, `transport/index.js` `DILIM_MS`);
çıkarılanın çift sırrı üretilmez (`PairBook.get` → `sessionAllowed`); 5 resim el sıkışma özetine bağlı (`ceremony.js`
`sas`). Taşıyıcı ve tören `deneysel: true` olmadan kurulmaz: telefonda uygulama bayrağı verir (varsayılan kapalı), düğümde (kutu, işçi) bayrak koddadır ve taşıyıcı açıktır.
