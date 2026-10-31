# RFC-0002 — Görev katmanı

> Durum: **Onaylandı** (Kerem, 23 Ekim 2026) · Kurucu belge 1.1 ile yürürlükte · Yazan: Havenfold çekirdek ekibi · Onay: Kerem
> Kurucu belge: §8, §9, §13. Bağımlılık: RFC-0003 (cihaz kaydı, cihazın tam defteri, cihaz çift sırrı, `TASK_PERMIT`, emanet mührü), RFC-0001 (koleksiyon, dosya, `append-event`).
> Kod yeri: `havenfold/core/gorev` (`@havenfold/tasks`), `havenfold/node` (denetçi), `havenfold/images`.

## 1. Sorun

Evdeki eski laptoplar OCR, ses yazıya dökme, yedek, yerel model ve kamera analizi yapacak. Şunlar tanımlı olmalı:

- işi kimin verdiği;
- işin hangi cihaza, hangi yetkiyle gittiği;
- işçinin içeriği ne kadar ve ne zamana kadar gördüğü.

Merkezi bir zamanlayıcı olmayacak (kurucu belge H1).

## 2. Öneri özeti

- Cihazlar ne yapabildiğini `NODE_CAPS` ile bildirir. İsteyen telefon işçiyi kendisi seçer.
- Görev, cihaz çift kanalında giden imzalı bir `TASK` mesajıdır.
- İşçi her görevi kendi defter kopyasıyla doğrular. İşi imzalı bir konteynerde, ağ kapalıyken çalıştırır, sonucu geri yollar ve her şeyi siler.
- Uzun işler için süreli koordinatör yetkisi verilir.
- Sürekli işlerde (kamera) işçi koleksiyona yalnız olay bırakır.

## 3. İmza ve kodlama

- Kodlama kuralları RFC-0001 §3'tekiyle aynıdır: `compact-encoding`, en kısa `c.uint`, seçimli alanlarda varlık bayrağı. İmza gönderilen baytlar üzerinden doğrulanır.
- Bu RFC'deki her imzalı mesaj için:
  - `body` = `sig` alanı dışındaki alanların kodlaması;
  - `sig = Ed25519(imzalayan, hash('<etiket>', familyId, body))`.
- Etiketler: `hf/node-caps/`, `hf/task/`, `hf/task-sub/`, `hf/task-cancel/`, `hf/task-delegation/`. Etiket yazımı RFC-0001 §3'teki kurala uyar (`hf/` ile başlar, `/` ile biter).

## 4. Yetenek bildirimi (`NODE_CAPS`, 0x96)

```
NODE_CAPS {
  nodeId       : fixed16               // bağlı cihazda deviceId, kutuda memberId
  class        : string ('kutu' | 'isci' | 'uc' | 'aksesuar')
  seq          : uint                  // her bildirimde artar
  os, arch, cpuModel : string
  cores        : uint
  ramTotalMB, ramFreeMB : uint
  diskTotalGB, diskFreeGB : uint
  accel        : array<string>         // 'openvino', 'cuda', 'npu', 'vaapi'
  battery      : null | { percent: uint, healthPct: uint (0 = bilinmiyor), cycles: uint, tempC: int, onAC: bool }
  tempC        : int
  uptimeSec    : uint
  load1x100    : uint                  // 1 dakikalık yük × 100
  tpm          : bool                  // cihazın kendi beyanı; kasa için yeterli değildir (RFC-0004 §3.1)
  tasks        : array<{ type: string, version: string, maxRamMB: uint, standing: bool, splittable: bool }>
  maxTaskRamMB : uint
  storage      : { holdGB: uint, blobGB: uint }
  status       : string ('hazir' | 'mesgul' | 'sicak' | 'pil' | 'bakim')
  running      : array<{ taskId: fixed16, type: string, pct: uint }>
  sig          : fixed64               // etiket 'hf/node-caps/'
}
```

| Alan | Kural |
|------|-------|
| `maxTaskRamMB` | `ramTotalMB − 1024 − Σ(çalışan görevlerin limits.ramMB) − Σ(konteyner uygulamalarına ayrılan bellek)`, en az 0. Ekrandaki "en büyük tek iş" bu değerdir. Uygulama belleği RFC-0011'dedir. |
| `status = 'sicak'` | Herhangi bir sıcaklık 90 °C'nin üstündeyse. 80 °C'nin altına inince `hazir`'a döner. |
| `status = 'pil'` | `onAC = false` ise. |
| Kime gider | Topluluğun üyelerine, canlı bağlantıda: bağlanınca bir kez, sonra 5 dakikada bir. Ayrıca bir koordinatöre, kendisini listeleyen bir `TASK_DELEGATION` aldığında (§9). Uygulama barındıran düğüme de gider (RFC-0011, `APP_LINK`). Kutu emanetine ve Posta Kutusu'na gitmez. |
| Saklama | Telefon her cihazın son bildirimini saklar. 15 dakikadan eski bildirim "çevrimdışı" sayılır. |

Kişisel veri taşımaz. Donanım parmak izi taşıdığı için topluluk dışına çıkmaz.

## 5. Görev türleri

- Tür adı ad alanlıdır: `hf.task.*` Havenfold, `yuva.task.*` ve `mekan.task.*` ürünler.
- Her tür bir **sözleşmedir**: girdi, parametre, çıktı, kaynak ihtiyacı ve bölünebilirlik. Sözleşme `images/<tür>/CONTRACT.md` dosyasındadır.
- Sürüm `MAJOR.MINOR.PATCH` biçimindedir. İsteyen, `MAJOR` değeri aynı ve `MINOR` değeri istenene eşit ya da büyük olan işçiyi seçer.

| Tür | Girdi | Parametre | Çıktı | Bölünür | Faz |
|-----|-------|-----------|-------|---------|-----|
| `hf.task.backup` | Şifreli yedek blokları (dosya) | `{ ownerId, setId }` | `{ stored: blobId[] }` | Hayır | 1 |
| `hf.task.ocr` | PDF ya da görüntü | `{ langs, pages?: [a, b], output: 'text' \| 'pdf' }` | Metin ya da aranabilir PDF | Sayfa | 1 |
| `hf.task.transcribe` | Ses | `{ lang, model: 'small' \| 'medium' }` | Metin + zaman damgaları (JSON) | Dakika | 2 |
| `hf.task.llm` | Metin (≤ 32 KB) | `{ task: 'ozet' \| 'alan-cikar' \| 'cevap', schema?, model }` | Metin ya da JSON | Hayır | 2 |
| `hf.task.vision` | Kayıtlı kaynak | `{ sourceId, rules, collectionId }` | Sürekli `append-event` | Hayır | 3 |
| `hf.task.embed` | Metin parçaları, JSON dizi, ≤ 32 KB | `{ model, rol: 'parca' \| 'sorgu' }` | int8 vektörler | Parça | 2 |

`hf.task.embed` RFC-0013 §4.3'te tanımlıdır. İşçi vektörleri döner, hiçbir şey saklamaz.

Silme raporu bir görev **değildir**. Raporu Kurulum USB'sinin silme ortamı üretir (RFC-0003 §8).

## 6. Görev mesajları

### 6.1 `TASK` (0x90)

```
TASK {
  taskId       : fixed16 (rastgele)
  parentTaskId : fixed16 (alt görevde ana görev; değilse 16 sıfır)
  workerId     : fixed16              // görevin gönderildiği işçi; başka işçiye yeniden gönderilemez
  type, version: string
  requester    : fixed16              // memberId; misafir görev veremez (alt görevde de isteyen)
  inputs       : array<{ blobId: fixed32, fileKey: fixed32, size: uint, mime: string }>
  params       : buffer               // türün sözleşmesine göre
  collectionId : fixed16              // verinin geldiği koleksiyon; hf.task.backup'ta 16 sıfır
  ledgerSeq    : uint
  deadline     : uint                 // ms, Unix
  limits       : { ramMB: uint, minutes: uint, diskMB: uint }
  standing     : bool
  delegation?  : TASK_DELEGATION      // alt görevde dolu (§9)
  sig          : fixed64              // isteyen: etiket 'hf/task/'; alt görevde koordinatör: etiket 'hf/task-sub/'
}
```

- **Taşıma:** Cihaz çift kanalında gider. Doğrudan oturumda Noise içinde. Emanet yolunda RFC-0003 §6.4'teki mühürle (anahtar `derive(pair, 'hf/task/')`).
- **Girdiler:** İşçi girdi dosyalarını `BLOB_REQ` ile isteyenden ya da dosyayı tutan kutudan çeker. Görevle birlikte dosyanın kendi anahtarı (`fileKey`) gider. Telefon dosyayı yeniden şifrelemez. Bedeli: işçi o dosyanın kalıcı anahtarını görmüş olur (kurucu belge §8.4).
- **Dürüst sınır:** `collectionId` ile girdiler arasında kriptografik bağ yoktur. Kasa verisinin işçiye gitmemesi, isteyen telefonun doğru davranmasına dayanır. Ele geçirilmiş bir telefon kendi görebildiği her veriyi zaten dışarı çıkarabilir. Bu RFC o durumu korumaz.

### 6.2 İşçinin denetimi

İşçi tam defteri tutar (RFC-0003 §7). Görevi kabul etmeden önce sırayla denetler. Biri tutmazsa `TASK_REJECT { taskId, code }` gönderir.

| # | Denetim | Hata |
|---|---------|------|
| 0 | `workerId` işçinin kendi kimliği | `YANLIS_ISCI` |
| 1a | Doğrudan görevde: `sig` (etiket `task`) `requester`'ın anahtarıyla geçerli | `IMZA_GECERSIZ` |
| 1b | Alt görevde: `delegation.sig` isteyenin anahtarıyla, `sig` (etiket `task-sub`) `delegation.coordinatorId`'nin anahtarıyla geçerli; `parentTaskId = delegation.taskId`; işçi `delegation.workers` içinde; tür `delegation.types` içinde; `requester = delegation.requester`; `collectionId = delegation.collectionId`; her girdi `delegation.inputBlobIds` içinde; `delegation.expiresAt` geçmemiş; bu `parentTaskId` için gelen alt görev sayısı `maxParts`'ı aşmıyor | `IMZA_GECERSIZ`, `YETKISIZ` |
| 2 | `requester`, `ledgerSeq` anında **ve** bugün aktif üye. Misafir görev veremez. | `YETKISIZ` |
| 3 | `TASK_PERMIT` kurallarına göre bu türü verebiliyor (RFC-0003 §5.11). `standing` ise isteyen ebeveyn. | `TUR_IZNI_YOK` |
| 4 | `collectionId` koleksiyonunda `taskAccess = true` ve `sensitivity ≠ 'kasa'`. `hf.task.backup`'ta `collectionId` 16 sıfırdır ve bu denetim atlanır: yedek blokları zaten şifreli gelir. | `KOLEKSIYON_KAPALI` |
| 5 | İşçi bu tür ve sürümü destekliyor; `limits.ramMB ≤ maxTaskRamMB` | `DESTEK_YOK`, `KAYNAK_YOK` |
| 6 | `status = 'hazir'` | `MESGUL`, `SICAK`, `PIL` |
| 7 | `deadline > şimdi`; standing değilse `deadline ≤ şimdi + 7 gün`; standing ise `≤ şimdi + 30 gün` | `SURE_GECERSIZ` |
| 8 | Aynı `taskId` daha önce görülmemiş. İşçi gördüğü `taskId`'leri kendi `deadline`'ları geçene kadar saklar. | `TEKRAR` |

Kabul ederse `TASK_ACCEPT { taskId, etaSec }` gönderir.

### 6.3 Diğer mesajlar

```
TASK_ACCEPT   (0x91) { taskId, etaSec: uint }
TASK_REJECT   (0x92) { taskId, code: string }
TASK_PROGRESS (0x93) { taskId, pct: uint, note: string }       // en çok 10 saniyede bir
TASK_RESULT   (0x94) { taskId, status: 'ok' | 'hata' | 'iptal' | 'sure',
                       outputs: array<{ blobId, fileKey, size, mime }>,
                       inline: buffer (≤ 32 KB), log: string (≤ 4 KB) }
TASK_CANCEL   (0x95) { taskId, by: fixed16, sig }              // isteyen ya da koordinatör, etiket 'hf/task-cancel/'
```

- **Çıktı:** Küçük çıktı (≤ 32 KB, ör. OCR metni) `inline` içinde gider. Büyük çıktı, yeni ve rastgele bir `fileKey` ile yeni bir dosya olarak şifrelenir ve `BLOB_DATA` ile aktarılır.
- **Sonucu kaydeden:** Sonucu koleksiyona isteyen telefon yazar. İşçi koleksiyona yazmaz; tek istisna sürekli görevdir (§10).
- **İsteyen çevrimdışıysa:** İşçi `TASK_RESULT`'ı kutuya `HOLD { forMemberId, fromMemberId, sealed }` ile bırakır. `sealed`, RFC-0003 §6.4 mührüyle kapatılır; kutu içeriği göremez. Çıktı dosyaları kutuya şifreli olarak `BLOB_DATA` ile gider. Kutu yoksa sonuç işçide 7 gün bekler.

## 7. İlk kullanım onayı

- Telefon, bir üyenin verisini bir işçiye **ilk kez** göndermeden önce üyeye sorar: "Bu iş evdeki Lenovo'da yapılacak. Lenovo belgeyi işi bitirene kadar görür, sonra siler. İzin veriyor musun?"
- Cevap, üyenin telefonunda `(üye, deviceId)` çifti için Arşiv katmanında saklanır ve üyenin yedeğine girer (RFC-0004). Aile ile paylaşılmaz.
- "Ayarlar → Ev Makinesi → <cihaz> → Verilerimi bu cihaza gönder" anahtarından geri alınır.
- Onaylanmamış işçi o üyenin işleri için seçilmez. Koordinatörlü işte, belgedeki her işçi için onay aranır.
- İşçi çıkarılıp yeniden eklenirse (yeni `deviceId`) onay yeniden sorulur.

## 8. Yerleştirme

İsteyen telefon:

1. **Adaylar:** Son 15 dakikada bildirimi gelmiş, türü ve uyumlu sürümü olan, `maxTaskRamMB ≥ limits.ramMB`, `status = 'hazir'`, üyenin onayı olan cihazlar.
2. **Sıralama:** `a`, `b`'den önce gelir eğer `a.load1x100 × b.cores < b.load1x100 × a.cores`. Eşitlikte `onAC = true` olan, sonra `deviceId` bayt sırasıyla küçük olan önce gelir.
3. **Bölme:** Tür `splittable` ise birim sayısı (sayfa ya da dakika) adayların `cores` değerleriyle orantılı paylaştırılır:
   - Önce her adaya `floor(birim × cores / Σcores)` verilir.
   - Kalan birimler, kesirli kısmı en büyük olandan başlayarak birer birer dağıtılır. Eşitlikte sıralamada önce gelen alır.
   - Her parça en az 1 birim. Parça başına ayrı `taskId` kullanılır.
   - Örnek: 40 sayfa, 4 + 2 çekirdek → 27 + 13.
4. **Hata ve zaman aşımı:** `TASK_ACCEPT` 30 saniyede gelmezse ya da `TASK_RESULT` `deadline`'a kadar gelmezse parça sıradaki adaya verilir. Aynı parça en çok 3 kez denenir.
5. **Aday yoksa:** İş telefonda yapılabiliyorsa telefonda yapılır. Yapılamıyorsa kullanıcıya "Bu iş için evde uygun cihaz yok" denir.

## 9. Koordinatör

iPhone arka planda askıya alındığı için uzun bir işi telefon yönetemez. Bu durumda telefon işi bir işçiye koordinatör olarak verir.

```
TASK_DELEGATION (0x97) {
  taskId        : fixed16              // ana görev
  coordinatorId : fixed16
  workers       : array<fixed16>       // koordinatör dahil
  types         : array<string>
  collectionId  : fixed16
  inputBlobIds  : array<fixed32>       // ana görevin girdileri; alt görevler yalnız bunları kullanabilir
  maxParts      : uint
  expiresAt     : uint                 // ms; en çok 24 saat sonrası
  requester     : fixed16
  ledgerSeq     : uint
  sig           : fixed64              // isteyen, etiket 'hf/task-delegation/'
}
```

- Telefon belgeyi ve ana `TASK`'ı koordinatöre gönderir. Ana görev normal bir görevdir; `requester` imzalı, `parentTaskId` sıfırdır.
- **Cihazlar arası bağlantı:** Bağlı cihazlar birbirlerinin HELLO'sunu kabul eder (RFC-0003 §6.1). Ama bir cihaz başka bir cihazdan gelen `TASK`'ı yalnız geçerli bir `delegation` taşıyorsa işler.
- Koordinatör, belgedeki her işçiden güncel `NODE_CAPS` ister ve §8'deki kurallarla böler. Alt görevleri gönderir (§6.2 madde 1b).
- Alt sonuçlar koordinatöre gelir. Koordinatör birleştirir ve tek bir `TASK_RESULT` ile isteyene yollar; isteyen çevrimdışıysa kutuya bırakır.
- Koordinatörlük yalnız bu iş ve `expiresAt` için geçerlidir. Belgede adı geçmeyen işçiye iş verilemez.

## 10. Sürekli görev

- `TASK.standing = true` ile verilir. `deadline` en çok 30 gün sonrasıdır. Telefon süre dolmadan görevi yeni bir `taskId` ile yeniler.
- Yalnız ebeveyn verebilir. Mekan'da sahip ya da yönetici verebilir (RFC-0005).
- **Çıktı:** İşçi olayları RFC-0001 §10'daki `REC_DROP` ile `kind = 'olaylar'` koleksiyonuna bırakır. Bunun için koleksiyonun `writers` listesinde `device:<deviceId>` bulunmalıdır. Telefon görevi vermeden önce bu izni `COLLECTION` olayıyla ekler. Görev bitince ya da iptal edilince izni kaldırır; bu da cihaz için kesim üretir.
- İşçi olayları okuyamaz, değiştiremez.
- **Rutin motoru:** Telefonda ya da işçide çalışır, kutuda çalışmaz.
- **Görüntü:** Kamera görüntüsü işçinin belleğinde işlenir. Olay için gereken kırpılmış kare, şifreli dosya olarak koleksiyona gider. Ham görüntü kaydı ayrı bir ürün özelliğidir.

## 11. Çalıştırma ortamı

### 11.1 Konteyner (Linux işçi)

| Ayar | Değer |
|------|-------|
| Çalıştırıcı | Podman, kök olmayan kullanıcı `havenfold-task` |
| Ağ | `--network=none`. `hf.task.vision` için ayrı bir ağ ad alanı; nftables kuralı yalnız kayıtlı kamera adresine ve portuna izin verir. Podman'ın kendi seçenekleri tek adres izni vermediği için denetçi bu ad alanını kendisi kurar. |
| Dosya sistemi | Kök salt okunur. `/in` salt okunur. `/out` ayrı. `/work` tmpfs (`limits.diskMB`, en çok RAM'in yarısı); sığmazsa LUKS'lu diskte geçici alan. |
| Sınırlar | `--memory=limits.ramMB`; `--cpus` = çekirdek sayısının %75'i; `--pids-limit=256`; süre `limits.minutes` |
| Yetki | `--cap-drop=ALL`, `--security-opt=no-new-privileges`, varsayılan seccomp |
| İmaj | Özetle (`@sha256:`) çağrılır. Özet, kök anahtarla imzalı sürüm bildiriminde bulunmalıdır (kurucu belge §9.4). |
| Bitiş | Konteyner, `/in`, `/work`, `/out` silinir. `fileKey`'ler `sodium_memzero` ile sıfırlanır. |

### 11.2 Yerleşik iş

`hf.task.backup` konteynersiz, denetçinin içinde çalışır. İçerik açmaz: bloklar şifreli gelir, şifreli saklanır.

### 11.3 Konteynersiz işçi (Windows, macOS)

RFC-0008'e göre çalışır: yalnız imzalı yerel sarmalayıcılarla OCR (metin) ve ses yazıya dökme, AppContainer / App Sandbox içinde, ağ kapalı.

## 12. İmajlar ve lisans

- Görev imajları `havenfold/images/<tür>/` altındadır. Her imajda şunlar bulunur:
  - `Containerfile`;
  - `CONTRACT.md`;
  - `LICENSES.md`.
- GPL ya da AGPL araç içeren imajın tam kaynak arşivi, imajla aynı yerde ve aynı sürüm etiketiyle yayımlanır. Örnek: OCRmyPDF'in kullandığı Ghostscript AGPL'dir.
- Ürünlerin kapalı imajları (Mekan, Bakım) kendi depolarında yapılır ve aynı sözleşme ve sürüm bildirimi kurallarına uyar. Bu imajlarda AGPL ya da GPL bileşen kullanılmaz.

## 13. Ev Makinesi kartı

Telefon son `NODE_CAPS` bildirimlerinden şunları hesaplar:

- toplam çekirdek, toplam bellek, toplam boş disk;
- açık cihaz sayısı;
- **en büyük tek iş**: en büyük `maxTaskRamMB`;
- çalışan işler.

Sıcaklık ve pil uyarıları ebeveynlere `hf.device.*` olayı olarak gider (kurucu belge §9.6).

## 14. SDK yüzeyi

```ts
interface Gorev {
  machine(): Promise<MachineSummary>
  devices(): Promise<DeviceInfo[]>
  run(type, version, inputs: BlobRef[], params, opts: { collectionId, ramMB, minutes, deadline }): Promise<TaskHandle>
  on('progress' | 'result', (taskId, data) => void)
  cancel(taskId): Promise<void>
  consent(deviceId, allow: boolean): Promise<void>
  startStanding(type, params, collectionId): Promise<TaskId>
}
```

Yuva Hat çekirdek komutlarında (`packages/protocol/komutlar.js`) 250–259 aralığı ayrılır.

## 15. Test vektörleri

`protocol/vectors/task.json`:

1. `NODE_CAPS`, `TASK`, `TASK_DELEGATION` kodlama ve imzalar.
2. İşçi denetimi: geçerli görev; çocuk isteyen → `TUR_IZNI_YOK`; kasa koleksiyonu → `KOLEKSIYON_KAPALI`; atılmış üye → `YETKISIZ`; 8 günlük `deadline` → `SURE_GECERSIZ`.
3. Koordinatör: geçerli alt görev; belgede olmayan işçi → `YETKISIZ`; süresi geçmiş belge; `maxParts` aşımı.
4. Yerleştirme: aynı bildirimlerden aynı seçim.
5. Bölme: 40 sayfa, 4 + 2 çekirdek → 27 + 13; 7 sayfa, 3 + 3 + 2 → 3 + 2 + 2 (kalan dağıtımı ve eşitlik).

## 16. Güvenlik değerlendirmesi

| Tehdit | Önlem |
|--------|-------|
| Sahte görevle işçiden veri sızdırmak | İşçi yalnız kendisine gelen girdiyi işler. Ağı kapalıdır. Sonucu yalnız isteyene yollar. |
| Atılmış üye görev verir | §6.2 madde 2 |
| Görev tekrar gönderilir | `taskId` en az `deadline`'a kadar saklanır |
| Koordinatör yetkisini kötüye kullanır | Belge süreli; işçi listesi, tür listesi ve parça sayısı sınırlı; isteyen imzalı |
| Başka bir cihaz kendiliğinden görev verir | Cihazdan gelen görev yalnız geçerli bir delegasyonla işlenir |
| Kötü amaçlı görev imajı | İmzalı sürüm bildiriminde özet; ağ kapalı; yetkisiz kullanıcı |
| İşçi veriyi saklar | Yazılım her şeyi siler. Ele geçirilmiş işçi kendisine verilen dosyaları saklayabilir; bu bilinçli olarak kabul edilmiştir. Önlemler: işçiyi yalnız ebeveyn ekler, üye başına ilk kullanım onayı, kasa verisi gitmez. |
| `NODE_CAPS` ile parmak izi | Yalnız topluluk içinde dolaşır |

## 17. Kurucu belgede değişecekler

- §8.8 tablosundan `hf.task.wipe-report` çıkarılır; silme raporunu USB'deki silme ortamı üretir.
- §8.2 tablosuna `TASK_DELEGATION 0x97` zaten var; `NODE_CAPS`'in koordinatöre de gittiği §8.3'e eklenir.

## 18. Uygulama sırası

1. `NODE_CAPS` üretimi (denetçi) ve telefonda okunması; Ev Makinesi kartı (geliştirici ekranı).
2. `TASK` / `TASK_RESULT`, işçi denetimi, ilk kullanım onayı.
3. `hf.task.backup` ve `hf.task.ocr` imajları; konteyner çalıştırıcı.
4. Bölme ve yeniden deneme.
5. Koordinatör.
6. Sürekli görev (Faz 3, `hf.task.vision` ile birlikte).

## Ek (RFC-0016, 23 Ekim 2026)

- §4: `maxTaskRamMB` hesabından konteyner uygulamalarının belleği düşülür; `NODE_CAPS` uygulama barındıran düğüme de gider (RFC-0011).
- §5: Yeni görev türü `hf.task.embed` (RFC-0013).
- §11.3: Konteynersiz işçi RFC-0008'e göre çalışır.

## Ek: RFC-0033 (onaylı, 24 Ekim 2026)

- **`NODE_CAPS.seq`** (RFC-0033 §9 p) yeniden başlamada geri gitmez: `max(önceki + 1, şimdiki ms)`.
- **Görev sözleşmesi** (§9 q): `params` UTF-8 JSON. Konteynerde girdiler `/in/params`, `/in/girdiler.json`, `/in/<i>`; çıktılar `/out/`; çıkış kodları 0/2/3/4/5/10 (`images/*/CONTRACT.md`). İmaj dizini `images/task-<tür>/`.
- **Sonuç teslimi** (§9 r): tek ve 32 KB'tan küçük çıktı `TASK_RESULT` içinde; birden çok dosyada her dosya yeni anahtarla şifreli ayrı `BLOB_DATA`; MIME türü uzantıdan. İsteyen çevrimdışıysa sonuç işçide bekler; emanete bırakma sonraki iş.
- **`hf.task.backup`** (§9 m) yerleşiktir (§11.2); `images/task-backup/` yalnız sözleşmeyi taşır.
- **Kanal komutları** (§9 s; §14'teki 250–259 aralığı): 250 `TASK_REQUEST` (run), 251 `TASK_CANCEL` (cancel), 252 `MACHINE` (machine), 253 `DEVICES` (devices), 254 `TASK_CONSENT` (consent, var olan), 255 `STANDING_START` (startStanding). İlerleme ve sonuç RFC-0024 olay çerçevesiyle `gorev` olayı olarak gelir: `{ olay: 'gorev', veri: { id, tur: 'progress' | 'result' | 'hata', … } }`; gövde ayrıntıları `protocol/vectors/channel-task.json`'da. 255 koddaki `(type, version, deviceId, params, opts)` imzasıyla çalışır (§14'teki `startStanding(type, params, collectionId)` yerine). 256–259 boş.
