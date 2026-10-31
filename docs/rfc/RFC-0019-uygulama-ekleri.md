# RFC-0019 — Uygulamadan dönen ekler: hata kodları, açık bırakılmış biçimler, kararlar

> Durum: **Onaylandı** (Kerem, 23 Ekim 2026) · 23 Ekim 2026 · Yazan: Havenfold çekirdek ekibi · Onay: Kerem
> Kaynak: dell kolunun D0–D8 uygulaması sırasında `kollar/D-durum.md` "İstekler" bölümüne yazdığı 68 madde ve Mac'in kod incelemesi (PR #3).
> Kurucu belge: §6, §8, §10, §12, §13, §22. Etkilenen RFC'ler: 0001, 0002, 0003, 0004, 0006, 0014, 0015, 0017.

## 1. Sorun

Onaylı RFC'ler çekirdeği yazmaya yetti; ama bazı yerlerde hata adı, alan türü, sınır ya da sıra yazılmamıştı. Dell bu boşlukları en dar ve belgeye en sadık yorumla doldurdu ve her birini not etti. Bu RFC o seçimleri belgeye işler, birkaçını düzeltir ve yeni bir mesaj ekler. Amaç: aynı soruyu ikinci bir uygulayıcının farklı cevaplamaması.

Bu RFC protokolün anlamını değiştirmez. Tek yeni mesaj §9'daki `BLOB_HAVE`'dir.

## 2. Genel kural: hata kodları

- Her RFC'nin sonuna bir **"Hata kodları"** tablosu eklenir. Bu RFC'nin §10'undaki listeler o tablolara taşınır.
- Kod adları büyük harf, ASCII, alt çizgilidir (`VAULT_RULE`). Ad tek başına anlaşılır olmalı.
- Bir RFC'de olmayan bir hata durumuna rastlayan uygulayıcı yeni ad seçer, durum dosyasına yazar; ad bir sonraki ekte belgeye girer.

## 3. RFC-0001 (kayıt katmanı) ekleri

| # | Bölüm | Ek |
|---|-------|----|
| 3.1 | §4.2 | `int` değer aralığı **−(2^52 − 1) … 2^52 − 1**'dir (compact-encoding 3.5.2 `c.int`). Kesirli sayı yoktur; ürün kuruş, onda bir derece gibi tamsayıya ya da metne çevirir. |
| 3.2 | §4.1 | Kayıt türü önekleri `hf.`, `yuva.`, `mekan.`'dır. Yeni ürün ailesi öneki RFC ile eklenir. |
| 3.3 | §8 | `REC_CUTOFF` parçaları 0'dan başlar; parça başına en çok 1.500 opId (emanet zarfına sığar). |
| 3.4 | §10 | `REC_DROP` eşitleme özetinde `epochSeq = 0`, `keyId = dropKeyHash` yazılır. 0 hiçbir koleksiyonun dönemi olamaz (GENESIS). |
| 3.5 | §11.1 | Boş dosya tek, boş bir parçadır. |
| 3.6 | §9.3 | Dönem anahtarını **alıcı da süzer**: okuyucusu olmadığı koleksiyonun anahtarını reddeder (`NOT_READER`). `history: false` koleksiyonda dönem anında okuyucu olmak gerekir. |
| 3.7 | §15 | Bilinen sınır: misafir, `GUEST_VIEW.epochs` dönemin okuyucu listesini taşımadığı için dönem anındaki okuyuculuğu denetleyemez; görünümdeki ebeveynin imzasına güvenir. |
| 3.8 | §11 | Dosya tutucunun kabul bildirimi `BLOB_HAVE` (§9). |

## 4. RFC-0002 (görev katmanı) ekleri

| # | Bölüm | Ek |
|---|-------|----|
| 4.1 | §6.2 | İşçinin `status = 'bakim'` hâli `MESGUL` döner. Durum önceliği: sıcak > pil > bakım > meşgul. |
| 4.2 | §9 | Oturum denetimi tabloya eklenir: işçi, doğrudan görevde çift kanalın karşı tarafını `requester` ile, alt görevde `coordinatorId` ile karşılaştırır; uymazsa `UNAUTHORIZED`. |
| 4.3 | §6.1 | Tür izni ve görev erişimi de, `ledgerSeq` anında **ve** bugün aranır (en dar yorum). `TASK_DELEGATION` için isteyen `delegation.ledgerSeq` anında ve bugün aktif olmalı. |
| 4.4 | §6.1 | **Değişiklik:** İşçi, `requester`'ın görevin `collectionId`'sinin okuyucusu olduğunu tam defterden denetler; değilse `UNAUTHORIZED`. ("Dürüst sınır" daralır.) |
| 4.5 | §9 | Belgenin süresi: `şimdi < expiresAt ≤ şimdi + 24 sa`. |
| 4.6 | §16 | Bilinen sınır: `maxParts` işçi başınadır; kötü niyetli koordinatör her işçiye ayrı `maxParts` verebilir. |
| 4.7 | §8 | Koordinatör NODE_CAPS'i istemez; işçi, kendisini listeleyen, süresi geçmemiş geçerli bir belgenin koordinatörüne kendiliğinden gönderir. |
| 4.8 | §8 | İçerik gören işi yalnız `class = 'isci'` alır; `hf.task.backup`'ı kutu da alabilir. Uç ve aksesuar görev almaz. |
| 4.9 | §8 | Sürekli görevde işçinin bildiriminde türün `standing: true` olması aranır (`NOT_SUPPORTED`). `maxRamMB` ve `splittable` bilgi amaçlıdır; bölme kararı türün sözleşmesinden gelir. |
| 4.10 | §11 | Emanet mührünün AD'sindeki zarf kimliği görev zarflarında `taskId ‖ sıra`dır; `sıra` aynı görevde gönderenin artan sayacıdır. |
| 4.11 | §8 | Yeniden deneme: sıradaki aday, güncel sıralı listede son denenenden sonraki, bu parça için denenmemiş ilk adaydır. `TASK_REJECT`, `hata` ve `sure` yeniden denenir; `iptal` parçayı bitirir. Zaman aşımında eski işçiye `TASK_CANCEL` gider. |
| 4.12 | §12 | Sürekli görev, son tarihinden 24 saat önce yenilenir. |
| 4.13 | §10 | Birleştirme: alt sonuçlar parça sırasıyla eklenir; 32 KB'ı aşarsa yeni `fileKey`'le dosya olur. Türe özgü birleştirme `images/<tür>/CONTRACT.md`'dedir. |
| 4.14 | §7 | **Değişiklik:** İlk kullanım onayı **kişi** başınadır (RFC-0017 §4.3): anahtar `(personId, deviceId)`. Aynı telefondaki uygulamalar onayı yerel kanaldan paylaşır; ikinci uygulama yeniden sormaz. |

## 5. RFC-0003 (defter v2.1) ekleri

| # | Bölüm | Ek |
|---|-------|----|
| 5.1 | §5.8 | `KIND = 'ekip'` RFC-0005 uygulanana kadar `EKIP_HENUZ_YOK` ile reddedilir. Bu ad yalnız uygulama durumudur; RFC-0005 uygulanınca kalkar. |
| 5.2 | §8 | `RETIRE_LIST` alanları: `holds: array<fixed16>` (emanet tutulan kimlikler), `blobs: array<fixed32>`, `shares: array<fixed32>` (pay tutulan sırların kimliği). |
| 5.3 | §7 | `GUEST_VIEW`'e `successorOf: fixed16 \| null` eklenir: imzacı ebeveynin telefonu değiştiyse önceki kimliği. Misafir yeni imzacıyı, önceki görünümdeki imzacının `successorOf` ile bildirilmiş halefiyse kabul eder. |
| 5.4 | §7 | `GUEST_REVOKED.sig` = Ed25519(ebeveyn, `hash('hf/guest-revoked/', familyId, grantId)`). İmzacı, misafirin son görünümündeki ebeveynlerden biri olmalı. |
| 5.5 | §9 | **Düzeltme:** Çatallanmada cihazın **kendi imzaladığı** `DEVICE_DETACH` güçlü olay değildir; yalnız ebeveynin imzaladığı güçlüdür (§11 vektör 8 ile uyum). |
| 5.6 | §5.9 | `COLLECTION`'daki `device:` ve `grant:` öğelerinin defterde var olması aranmaz. Neden: bakıcı koleksiyonu `GRANT`'tan önce kurulur (Yuva Defteri 01 §2.2). |
| 5.7 | §2.2 | `PROTOCOL_LEVEL` yalnız yükselir ve düzey atlayabilir (2.0 → 2.2). |

## 6. RFC-0004 (kasa) ekleri

| # | Bölüm | Ek |
|---|-------|----|
| 6.1 | §4.4 | Kâğıt pay: `hfk1:` + base32(KASA_SHARE ‖ 4 baytlık sağlama), büyük harf, dolgusuz; okurken küçük harf de kabul edilir. Önek, emeklilik QR'ındaki `HFK1` ile karışmasın diye küçük harf ve iki noktalıdır. |
| 6.2 | §4.5 | Mühürlü dizinin dış biçimi `{ secretId, version, seq, sealed }`; açıktaki değerler mühürün içindekiyle aynı olmalı. |
| 6.3 | §5.2 | 72 saatin başlangıcı, pay sahibinin olayı ilk gördüğü andır; pay sahibi bunu kendisi saklar. Uygulama yeniden kurulursa süre baştan sayılır. |
| 6.4 | §3.1 | Cihaz payı uygunluğu (TPM mührü, `runtime`) RFC-0007/0008 kurulum kaydından gelir. |
| 6.5 | §3.3 | Shamir kütüphanesi n ≥ 2 ister; kurulabilen her dağıtımda n ≥ t ≥ 2'dir. |
| 6.6 | §4.1 | Kütüphanenin denetim raporları `arastirma/denetim/` altındadır. |

## 7. RFC-0006 (olay ve rutin) ekleri

| # | Bölüm | Ek |
|---|-------|----|
| 7.1 | §5.3 | Çekirdek katalog `protocol/event-types.json`'dadır. Katalog satırlarına `onem`, `onem_kutu`, `koleksiyon` ve `anahtar` alanları eklenir. |
| 7.2 | §10.2 | `hf.vaka` kaydına `pencere: [bas, son]` eklenir; açılış, anahtarı bu pencereyle yeniden hesaplar, tutmazsa yok sayılır. Biçim 2 kuralında `pencere = [S, E]` (RFC-0032 §5.1). |
| 7.3 | §9.4 | Önemi ≥ 2 olan bütün çekirdek olayları 1 günlük pencereyle vaka açar. `hf.sos`'un son basamağı 5'tir (112 önerisi). |
| 7.4 | §8.3 | Gözlem kesintisi olayları yazan cihazlardan hesaplanır; kaynaklardan biri %25'i aşarsa kesinti sayılır. |
| 7.5 | §8.2 | Rutinin ilk sayılır olayından önceki günler geçerli gün sayılmaz. |
| 7.6 | §8.5 | Motor yalnız süren ve son 24 saatte biten pencereleri değerlendirir. `bosluk`'un `cok` sapması güven denetiminden muaftır. |
| 7.7 | §9.3 | Susturma kuralı olayla tetiklenen anlarda değerlendirilir; penceresi örtüşen rutin vakası bastırılır. |
| 7.8 | §4.6 | **Ebeveynler koleksiyonu:** `kind = genel`, `sensitivity = normal`, okuyucusu yalnız `rol:ebeveyn`. Özel nitelikli olaylar (`ozel: true`) yalnız bu koleksiyona ya da sahibinin `kisisel` sağlık koleksiyonuna yazılır. |
| 7.9 | §11.4 | Vakayı cihaz açtıysa telefonların sırası bir geriden başlar. `sureler` sırası: `[2→3, 3→4, sıra arası, →5]`. |

## 8. RFC-0014 (dışa aktarma kabı), RFC-0015 (SDK) ve RFC-0017 ekleri

| # | Bölüm | Ek |
|---|-------|----|
| 8.1 | 0014 §3 | Son parça dışındaki her parça tam 65.536 bayttır; okuyucu tam boyu olmayan ara parçayı reddeder. |
| 8.2 | 0014 §4 | Çekirdek kap sıkıştırmasız yazar; deflate'li girdiyi yalnız çağıran açarsa okur. `export-open` ikisini de açar. |
| 8.3 | 0014 §11 | Vektör 1'in akış başı libsodium'un ürettiği değerdir; vektör kabın baytlarını sabitler. |
| 8.4 | 0014 §7 | Dışa aktarma günlüğü kayıt türü `hf.kayit.disa-aktarma`: `{ _t, bicim, kapsam, oge_sayisi, kim }`, içeriksiz; Ebeveynler'e ya da dışa aktaranın Kişisel'ine yazılır. |
| 8.5 | 0014 §8 | `export-open`, `@havenfold/export`'ı kullanmaz; aynı kuralları bağımsız kodla uygular. Bağımsız denetim ikisini birlikte görür. |
| 8.6 | 0015 §2 | `_aiyol` RFC-0013 §8.5'teki beş yol önekiyle sınırlıdır; `_obs` `kaynak:` ya da `device:` olabilir. |
| 8.7 | 0015 §3 | `HIDE_PRESENCE` üyenin son bildirdiği `HELLO.caps`'ten okunur. Emanet gözleminin zamanı mesajın `hlc`'sidir; ileri saat telefonun saatine kısılır. |
| 8.8 | 0015 §6 | SDK `open(blobRef)` `{ bytes }` döner (yol platformun işi); `attach` yükleme mesajlarını da döner; sürekli görev için `standingPermit` (yazar izninin `COLLECTION` gövdesi) verilir. |
| 8.9 | 0017 §4.3 | Ana kimlik `LEAVE` yazınca da kişinin ek kimlikleri kapanır. |
| 8.10 | 0017 §7 | `APP_PRIMARY` vetosu ayrı olay değildir: bekleyen yeni ana kimliğe `REMOVE_MEMBER` (eski ana kimliğin ya da herhangi bir ebeveynin tek imzası). |
| 8.11 | 0017 §4.5 | Çatallanmada `ACTIVATE_MEMBER` güçlü sayılmaz; yalnız eski imzalı ya da ebeveyn imzalı `APP_PRIMARY` güçlüdür. |
| 8.12 | 0017 §6.2 | `APP_LOCAL_SYNC` gövdesi `{ type: uint, body: buffer }`; `type` içte taşınan zarfın türüdür. |
| 8.13 | 0013 §7.6 | `hf.ai.konusma` kaydına iki alan eklenir: `kaynak_sohbet` (bool; soru bir sohbetten geldiyse) ve `bildirildi` (bool; kişi cevabı "Bildir" ile işaretlediyse). |
| 8.14 | 0002 §7 | SDK ilk kullanım onayını geri alma yolunu da verir: `Gorev.consent(deviceId, false)`. Geri alınan onay o işçiye yeni iş gitmesini durdurur; süren işi iptal eder. |
| 8.15 | 0001 §16 | SDK'nın `Record` biçimi kaydın son işleminin `authorId` ve `hlc`'sinden türetilen `degistiren` ve `degisme` alanlarını, ilk `put`'tan türetilen `olusturan` ve `olusturma` alanlarını taşır. `history(recordId)` geçmiş satırlarını (`put`, `del`, `append`) verir. |

## 9. Yeni mesaj: `BLOB_HAVE` (0xF0)

Yuva Defteri "Bu dosyanın yedeği yalnız 2 telefonda" der (Yuva Defteri 01 §6). Bunun için telefonun hangi tutucunun dosyayı tam aldığını bilmesi gerekir; RFC-0001'de bunu bildiren mesaj yoktu.

```
BLOB_HAVE (0xF0) { blobIds: array<fixed32>, holder: fixed16, sig }
// Ed25519(holder, hash('hf/blob-have/', familyId, blobIds))
```

- Tutucu (kutu ya da depolama yapan işçi) bir dosyanın bütün parçalarını aldığında yükleyene gönderir.
- Telefon bunu yerelde saklar ve kayıtla eşitlemez; sayım her telefonda kendi bildiğidir. Arayüz "en az" diye gösterir.
- Aralık: 0xF0–0xF7 bu RFC'ye ayrılır; 0xF8–0xFE boş, 0xFF ayrılmış.

## 10. Hata kodları (ilgili RFC'lerin tablolarına taşınır)

| RFC | Kodlar |
|-----|--------|
| 0001 | `NO_KEY`, `LEDGER_BEHIND`, `LEDGER_FORK`, `NO_PERMISSION`, `INVALID_OPERATION_TYPE`, `INVALID_OPERATION`, `OPERATION_TOO_LARGE`, `INVALID_FIELD_NAME`, `INVALID_RECORD_ID`, `INVALID_DROP_KEY`, `DECRYPT_FAILED`, `FUTURE_CLOCK`, `NOT_IN_CUTOFF`, `TIME_LIMIT`, `RANGE_NOT_ENDED`, `CUTOFF_UNAUTHORIZED`, `INVALID_LIST`, `KEY_UNAUTHORIZED`, `INVALID_KEY`, `NOT_READER`, `PURGED`, `TOMBSTONED`, `BOX_FULL`, `UNAUTHORIZED`, `RESERVED_FIELD`, `INVALID_FIELD_VALUE`, `GUEST_CANNOT_WRITE`, `INVALID_FILE`, `INVALID_MESSAGE`, `INVALID_VALUE`, `EPOCH_MISMATCH`, `VERSION_UNSUPPORTED` |
| 0002 | `LEDGER_BEHIND`, `INVALID_MESSAGE`, `STALE_MANIFEST`, `NO_TASK`, `NO_APPROVAL`, `CHUNK_LIMIT`, `INVALID_DIVISION`, `NO_ELIGIBLE_DEVICE`, `TRIAL_ENDED`, `CANCELLED`, `PATH_FORBIDDEN`, `NOT_COLLECTION_ELIGIBLE`, `MESGUL`, `NOT_SUPPORTED`, `UNAUTHORIZED` |
| 0003 | `KIND_ERROR`, `PLACE_LIMIT` (8 aktif yer), `BEING_LIMIT` (32 aktif varlık), `NO_OWNER_APPROVAL`, `INVALID_BODY`, `NOT_SIGNER`, `INVALID_VIEW`, `VIEW_STALE`, `INVALID_REPORT`, `REPORT_KEY_MISMATCH`, `REPORT_COUNT_MISMATCH`, `NO_REPORT`, `CHUNK_MISSING`, `INVALID_QR`, `INVALID_BASE45`, `NO_SEAL_TYPE`, `DIRECT_ONLY`, `EKIP_HENUZ_YOK` |
| 0004 | `INSUFFICIENT_SHARE`, `SHARE_CORRUPT`, `INVALID_SHARE`, `PAY_YOK`, `NOT_SHARE_OWNER_ELIGIBLE`, `PAPER_LIMIT`, `INVALID_PAPER`, `PAPER_CHECKSUM`, `PERSON_SHARE_INSUFFICIENT`, `NOT_RECOVERABLE_ON_LOST_PHONE`, `INVALID_SECRET`, `INVALID_THRESHOLD`, `DIZIN_*`, `ZARF_*`, `DAILY_LIMIT` |
| 0014 | `INVALID_EXPORT`, `EXPORT_VERSION`, `EXPORT_PARAMETER`, `EXPORT_UNVERIFIED`, `EXPORT_CORRUPT`, `EXPORT_TRUNCATED`, `EXPORT_EXCESS`, `PASSWORD_TOO_SHORT`, `ZIP_*`, `INVALID_ARCHIVE` |
| 0017 | `INVALID_ROLE`, `INVALID_BODY`, `PENDING_CHANGE`, `NOT_PRIMARY_IDENTITY`, `NO_APPROVAL`, `PAIRING_STATUS`, `PAIRING_EXPIRED`, `PAIRING_NONCE`, `PAIRING_EVENT`, `OUT_OF_GROUP` |

`DIZIN_*`, `ZARF_*` ve `ZIP_*` ailelerinin tam listesi kodla birlikte ilgili RFC tablosuna yazılır.

## 11. İncelemeden gelen kararlar

Mac'in PR #3 incelemesi (`kollar/D-inceleme-1.md`) bazı açıkları RFC'lerin kendisinde buldu. Kararlar:

### 11.1 RFC-0001 (kayıt)

| # | Karar | Neden |
|---|-------|-------|
| a | HLC yalnız geçerli kümeye giren ve ileri saat sınırındaki işlemin saatini gözler (§6). Milisaniye kısmı 2^48'i, sayaç 2^16'yı aşamaz; aşan işlem `INVALID_VALUE`. | Geçersiz işlem başkasının saatini bozup bütün yazımlarını kaybettiriyordu. |
| b | **İmza hatası mezara girmez** (§12.1); bu işlemler için `REC_PRUNE` gönderilmez. Aynı `opId` ile sonradan gelen geçerli kopya kabul edilir. | `opId` imzayı kapsamadığı için bozulmuş bir kopya gerçek işlemi gömüyordu. |
| c | **Kayıt sahipliği:** yeni kaydın `recordId`'si `hash('hf/rec-new/', authorId, nonce)`'dur; `nonce` 16 rastgele bayt olarak türü belirleyen işlemde taşınır. `type`, `_t`, `_keep`, `_subj` yalnız bu yazarın işleminden alınır; başka yazarın işlemindeki bu alanlar yok sayılır. | Geriye tarihli bir işlemle başkasının kaydı geri dönülmez siliniyordu. |
| d | `hf.saklama`'yı yalnız ebeveyn yazar; cihaz yazamaz. Olay olmayan bütün `hf.` türlerinde katalogdaki `yazar` sınıfı uygulanır. | Bir kamera koleksiyonu toptan sildirebiliyordu. |
| e | `REC_PRUNE`'u yalnız koleksiyonun **yazarı** gönderir ve yalnız temizlenmiş ya da süresi dolmuş kayıtlar ile imzadan bağımsız kesin retler için. | Kör kutu bir okuyucuyu kandırarak işlem sildirebiliyordu. |
| f | Dönem anahtarı `(collectionId, epochSeq, epochHash)` ile tutulur; çatallanmada eşleşmeyenler atılır. | Eski dalın anahtarı yeni dalda kullanılıyordu. |
| g | Katılma paketi yalnız katılan şu an okuyucuysa gider; `history: true`'da da her dönemde okuyuculuk aranır. | Çıkarılmış okuyucuya yeni anahtar gidiyordu. |
| h | İlk okuyucunun anahtarı 10 dakika görünmezse sıradaki okuyucu üretir (§9.2). | Anahtar üretimi tek kişiye bağlıydı. |
| i | `grant:` içeren koleksiyonda en az bir ebeveyn okuyucudur; aktif GRANT'ın gösterdiği koleksiyon `kasa` yapılamaz; `readers: []` ile kapatma misafiri de kapsar. | Misafir kasa okuyucusu olabiliyordu; anahtar üretilemiyordu. |
| j | Tutucu işlediği `BLOB_DEL` imzalarını saklar; silme iptali yalnız tam ve doğrulanmış yeniden yüklemeyle olur. | `BLOB_DEL` yeniden oynatılabiliyordu. |
| k | `_conf` da sahiplik alanıdır: `type`, `_t`, `_keep`, `_subj`, `_key` gibi yalnız türü belirleyen işlemden alınır. | Bir çocuk başkasının kaydına `_conf: 0` yazıp süreyi 7 güne indiriyor, kaydı geri dönülmez sildiriyordu. |
| l | Katalogda `yazar` sınıfı olan `hf.` türlerinde (`hf.saklama` dahil) sınıfa uymayan yazarın işlemi geçerli kümede kalır ama görünüme ve temizliğe katılmaz. Sınıf, işlemin `ledgerSeq` anındaki role göre denetlenir. Yalnız türü belirleyen işlemin yazarına bakmak yetmez. | Ebeveynin `hf.saklama` kaydına çocuk `gun: 1` yazıp koleksiyonu temizletebiliyordu. |
| m | Katılma paketinin ve anahtar yanıtının **alıcısı olan kimlik** şu an aktif okuyucu olmalıdır. Kişi düzeyindeki okuyuculuk (RFC-0017 §5, cihaz değişimi zinciri) yalnız hangi geçmiş dönemlerin gideceğini seçer. | Cihaz değişiminde kayıp telefonu dışarıda bırakmak için açılan dönemin anahtarı o telefona gidiyordu. |
| n | İmzası doğrulanmamış kopya `opId`'yi kilitlemez. Replika ve kutu, aynı `opId` için baytları farklı en çok 4 kopya tutar ve hepsini sunar; imza hatasında sıradaki denenir; geçerlisi kabul edilince diğerleri atılır. Kutuda tekrar denetimi `hash(opId ‖ sig)` iledir. | Bir okuyucu, imzasını bozduğu kopyayı önce yükleyerek gerçek işlemin dağılmasını engelliyordu. |
| o | Denetim sırası: defter dalı (koşul 3) → yazar ve imza (koşul 2) → yetki. **Mezara yalnız** `PURGED` ve imzası doğrulanmış işlemin kesin retleri girer. Çözme ya da biçim hatası, bilinmeyen yazar ve şifre çözme hatası mezarsız atılır; bunlar için `REC_PRUNE` gönderilmez. | Çatallanmada başka dalın yazarının işlemi `NO_PERMISSION` ile mezara giriyor ve kutudan budanıyordu. |
| p | İç gövdenin (`opInner`) başında `v: uint` sürüm alanı vardır; bu sürüm 1'dir. Bilinmeyen sürüm `VERSION_UNSUPPORTED` ile bekler, mezara girmez. Yayın öncesi olduğu için mevcut `-v2` vektörleri buna göre yeniden üretilir. | Biçim değişikliğinde karışık sürümlü aile birbirinin işlemlerini mezara koyup budayacaktı. |
| q | `BLOB_DEL`'e `at: uint` (ms) eklenir: `Ed25519(by, hash('hf/blob-del/', familyId, at, blobIds))`. Tutucu `(by, blobId)` başına son işlediği `at`'ı saklar ve yalnız daha büyüğünü işler; (j)'deki yeniden oynatma koruması budur. Silmeyi iptal eden yeniden yükleme yalnız ilk yükleyenden ya da bir ebeveynden kabul edilir. | Ed25519 belirlenimci olduğu için aynı kişinin ikinci silmesi aynı imzayı üretiyor ve yok sayılıyordu; dosya silinemez hale getirilebiliyordu. |
| r | Bilinen sınır: kör kutu `REC_PRUNE`'un gerekçesini denetleyemez; koleksiyonun herhangi bir yazarı kutudan işlem budatabilir. Kutu her budamayı (kim, ne zaman, kaç işlem) saklar ve ebeveyne gösterir. Kutu mezarı kalıcı değildir: budanmış `opId`'nin imzası geçerli kopyasını yazarı yeniden yüklerse kabul edilir. | Kötü niyetli yazarın kutu üzerinden sessiz sansürü görünür olsun ve geri alınabilsin. |

### 11.2 RFC-0002 (görev)

| # | Karar |
|---|-------|
| a | Alt görevde `deadline ≤ delegation.expiresAt` ve `standing = false` (§6.2 madde 1b). |
| b | İşçi `maxParts`'ta yalnız kabul ettiği alt görevleri sayar. |
| c | Saat toleransı: telefon üst sınırların 5 dakika altında üretir; işçi 2 dakika tolerans tanır. |
| d | Yeniden denemede yeni deadline (`şimdi + ilk süre`, üst sınırla); imzalanamazsa parça başarısız. |
| e | Kutuya `TASK_PERMIT` ile yalnız `hf.task.backup` verilebilir (kurucu §8.4). |
| f | NODE_CAPS, yalnız imzası doğrulanmış geçerli bir belgenin koordinatörüne gider. |

### 11.3 RFC-0003 (defter v2.1)

| # | Karar |
|---|-------|
| a | `GRANT` gövdesine `grantedBy: fixed16` eklenir; imzacılardan biri olmalıdır; misafirliğin bağlı olduğu ebeveyn bu alandır. |
| b | `GUEST_REVOKED`, misafirliği düşüren `REMOVE_MEMBER` ya da `LEAVE` olayını da taşıyabilir; düşmüş misafirliğe `REVOKE` yazılabilir. Misafir, imzacısı artık ebeveyn olmayan görünümü reddeder. |
| c | Okuyucularının hepsi aileden çıkmış koleksiyonu herhangi bir ebeveyn tek imzayla kapatabilir. |
| d | Bütün gövde ve mesajlar kanonik çözülür; bool yalnız 0 ya da 1; sonda bayt kalmaz. |
| e | 8 kişi sınırı bekleyen üyeleri de sayar; `ACTIVATE` sınırı yeniden denetler. |
| f | `RETIRE_LIST.shares`: `array<fixed16>`. |

### 11.4 RFC-0004 (kasa)

| # | Karar |
|---|-------|
| a | Pay isteği gövdesine `holderId` (istenen tutucu) ve `at` (an) eklenir; tutucu kendisine olmayan ya da 5 dakikadan eski isteği reddeder. |
| b | 72 saat kuralı istekçinin `rotatedFrom` zincirinin tamamına ve imzasız `APP_PRIMARY` ile `replaces`'e uygulanır; ilk görülme olay özetiyle tutulur. |
| c | YA isteğinde istekçi, YA sahibinin `rootId` zincirinin bugünkü ucudur (ana kimliğe çözülmez). Ek kimlik KRA payı istemez. |
| d | Kurtarma zarfı içeriği `keyEntry` listesi (`issuerId`, `sig` dahil) ve `dropSecrets` dizisidir; birleştirme belirlenimcidir. |
| e | §4.1 metni: kütüphanenin rastgelelik kaynağı yamayla sodium'dur; test akışı `hash('hf/kasa-test-akis/', tohum, u64be(sayaç))` ve kütüphanenin bayt tüketim sırası (önce x için 255, sonra her bayt için t−1) vektörle birlikte yazılır. |

### 11.5 RFC-0006 (olay)

| # | Karar |
|---|-------|
| a | Cihaz `hf.rutin`, `hf.kural`, `hf.kart`, `hf.kart.not`, `hf.saklama` yazamaz. |
| b | Vakanın `onem`, `ilk` ve `son`'u kayıttan değil kaynaktan (kural, rutin, katalog) türetilir. |
| c | Kural da yalnız süren ve son 24 saatte biten pencerelerde vaka açar; kuralın türü belirleyen işleminden önceki pencereler değerlendirilmez. |
| d | Bastırma kararı vaka kaydına (`bastirildi`) yazılır; olaylar temizlenince geri dönmez. |
| e | Gözlem kesintisinin içeriksiz bir kopyası olayların koleksiyonuna da yazılır; motor yalnız oradaki kesintiye bakar. |
| f | İşçinin görev parametresine `sessiz` ve `utc_dk` eklenir; işçi sessiz saatlere uyar. |
| g | `VAKA_UYANDIR`'ı yalnız koleksiyonun yazarı gönderebilir (§18 ile §11.5 tablosu uyumlu hale gelir). |

### 11.6 RFC-0014 (kap)

| # | Karar |
|---|-------|
| a | Parola NFC'ye çevrilip UTF-8 olarak verilir; vektör eklenir. |
| b | v1'de kap en çok 2 GiB'dir (ZIP64 yok); aşarsa `ZIP_TOO_LARGE`. Okuma ve yazma akışla yapılır. |
| c | Çekirdek sıkıştırmasız yazar; açarken her girdi bildirilen boyutla sınırlı açılır (zip bombasına karşı). |
| d | Argon2id telefonda eşzamansız çalışır; telefonda açılacak kapta `memlimit` en çok 512 MiB; bellek yetmezse `EXPORT_MEMORY`. |
| e | §8: `export-open` "standart ZIP okuyucu" yerine bağımsız ve sertleştirilmiş bir okuyucu kullanabilir (yol geçişi, tekrar eden ad, büyük/küçük harf çakışması, boyut sınırı, 0600 izin). |

### 11.7 RFC-0015 (SDK) ve RFC-0013

| # | Karar |
|---|-------|
| a | `presenceWithin` yalnız 24 saat ile çağrılır; son görülme kişinin bütün kimliklerinden hesaplanır, birinde `HIDE_PRESENCE` varsa kişi gizlidir. |
| b | `collections()` okunamayan koleksiyonu da `okur: false` ile döndürür; `readers` ve `writers` alanlarını verir. |
| c | Yapay zeka alanları (`_ai`, `_aiyol`) yalnız RFC-0013 §8.5 `kaydet` ile, onay ekranının ürettiği tek kullanımlık jetonla yazılır; genel `put` bunları reddeder. |

### 11.8 RFC-0017 (ek kimlik)

| # | Karar |
|---|-------|
| a | Kişinin ana kimliği için bekleyen `ROTATE_DEVICE` varken `APP_PRIMARY` `PENDING_CHANGE` ile reddedilir; bekleyen `ACTIVATE`, eski kimlik artık kişinin ana kimliği değilse geçersizdir. |
| b | `ROTATE_DEVICE` yeni kimliğe eski kimliğin `personOf`'unu taşır. |
| c | `ACTIVATE` hedefi aktif bir `pendingPrimary` ve `persons`'ta duran bir kişi olmalı; `pendingPrimary` `REMOVE` ve `replaces`'te temizlenir. |
| d | Sonradan birleşen imza, bekleyen bir olayın durumunu değiştiriyorsa birleştirilmez; hızlandırma ayrı `ACTIVATE` ile yapılır. |
| e | `APP_PAIR_REQ` ve `APP_PAIR_OK` ağdan gelen her oturumda reddedilir; `APP_LOCAL_SYNC` iç türleri bir izin listesiyle sınırlıdır. |
| f | `levelReady('2.2')` alt düzeylerin bitlerini de ister. |

## 12. Koda yansıyan düzeltmeler

Bu RFC'nin 4.4, 4.10, 4.14, 5.3, 5.4, 5.5, 7.1, 8.4, 8.14, 8.15, §9 ve §11'in bütün maddeleri dell'in kodunda değişiklik ister. Görevi `kollar/D-cekirdek.md` D9'dadır; bulgular `kollar/D-inceleme-1.md` ve `kollar/D-inceleme-2.md`'dedir.

## 13. Kurucu belgede değişecekler

| Bölüm | Değişiklik |
|-------|------------|
| §22 | HF51: "Uygulamadan dönen ekler RFC-0019'dadır; her RFC'nin sonunda hata kodları tablosu vardır." |
| Zarf aralıkları | 0xF0–0xF7 RFC-0019. |
