# RFC-0008 — Konteynersiz işçi (Windows, macOS) ve Android uç cihaz

> Durum: **Onaylandı** (Kerem, 23 Ekim 2026) · 23 Ekim 2026 · Yazan: Havenfold çekirdek ekibi · Onay: Kerem
> Kurucu belge: §3 (ilke 7, H3, H4, "asla yapılmayanlar"), §5.2, §6.5–§6.8, §7.6, §8.3–§8.7, §9.2, §9.5, §10.2, §11, §13, §16.2.
> Bağımlılık: RFC-0002 (§4 `NODE_CAPS`, §6 görev mesajları, §8 yerleştirme, §10 sürekli görev, §11.3), RFC-0003 (§5.1–5.2 cihaz olayları, §6 oturum ve emanet mührü, §8 emeklilik), RFC-0004 (§3.1 cihaz payı), RFC-0007 (süreç modeli, yerel IPC, sürüm bildirimi, `RETIRE_STATE`, `NODE_HEALTH`).
> Kod yeri: `havenfold/node/tepsi` (Windows ve macOS tepsi uygulaması), `havenfold/node/gorev-yerel` (imzalı görev sarmalayıcıları), `havenfold/core/uc` (`@havenfold/edge`, uç modu çekirdek kodu), uç modu ekranları onu kullanan ürünün uygulamasında (RFC-0029 §3), `havenfold/protocol/vectors/uc.json`.

## 1. Sorun

Kurucu belge iki cihaz türünü bu RFC'ye bağlıyor:

- **Silinmeden kullanılan Windows ve macOS bilgisayar.** §5.2 bunları "işçi ✓ sınırlı, konteynersiz" sayıyor. §8.7 ve RFC-0002 §11.3 "Faz 3 RFC'si gelene kadar işçi olarak eklenemez" diyor. Linux işçinin güvenliği konteynere ve ağsız çalışmaya dayanıyor; bu bilgisayarlarda Podman yok.
- **Eski Android telefon ve tablet.** §5.2 bunları kamera, ekran ve sensör olarak "uç" sayıyor. Docker yok, arka plan sınırlı, Play kuralları sıkı. Kamera görüntüsünün işçiye nasıl, hangi izinle ve ev ağına açılmadan gideceği tanımlı değil.

Ayrıca iki ortak soru var:

- İşletim sistemi silinmeyen bir cihaz emekliye ayrılınca "silindi" ne demek?
- Bu cihazlar defterde ve yerleştirmede Linux düğümünden nasıl ayırt edilir?

## 2. Öneri özeti

- **Tepsi uygulaması:** Bare çekirdeği + Node denetçisi + küçük bir tepsi arayüzü. Çekirdek ve denetçi işletim sistemi servisi olarak, ayrı servis hesaplarıyla çalışır. Süreç modeli RFC-0007 §4'ün aynısıdır.
- **Konteynersiz görev:** Yalnız Havenfold'un derleyip imzaladığı, sürüm bildiriminde özeti bulunan sarmalayıcılar çalışır: OCR (yalnız metin çıktısı) ve ses yazıya dökme. Yedek yerleşiktir. Yerel model, kamera analizi ve ürün imajları konteynersiz işçide **çalışmaz**.
- **Kum havuzu:** Windows'ta AppContainer (LPAC) + Job Object, macOS'ta App Sandbox + ayrı kullanıcı. Ağ kapalıdır. Girdi ve çıktı dosya tanıtıcısıyla geçer; görev süreci dosya sistemine yol ile erişmez.
- **Veri:** Bütün Havenfold verisi uygulama düzeyinde şifrelidir. Veri anahtarı donanıma (TPM, Secure Enclave) sarılıdır. Emeklilikte bu anahtar yok edilir. Rapor türü `uygulama-verisi-silindi`'dir ve işletim sistemini silmediğini açıkça söyler.
- **Kasa payı:** Tepsi uygulaması (işçi ya da kutu) kasa payı tutmaz.
- **Android uç:** Onu kullanan ürünün uygulamasındaki uç modu (kamera: Yuva Pati, Yuva Bakım; sensör: Yuva Bakım; ekran: Yuva Hat; RFC-0029 §3). Kamera, sensör ya da ekran olur; görev çalıştırmaz. Kamera görüntüsü yalnız ebeveynin imzaladığı yapılandırmadaki işçiye ya da üyeye, yalnız doğrudan Noise oturumunda, arama kodunun çerçeve biçimiyle ve XChaCha20-Poly1305 ile şifreli gider. Telefonda açık port yoktur. İşçi tarafında görüntü, yalnız görev konteynerinin görebildiği bir yerel RTSP adresine verilir.
- **Görünür izleme:** Kamera açıkken bütün yetişkin üyeler bunu ve görüntünün kime gittiğini görür.
- **iOS** hiçbir zaman kamera ya da sensör uç olmaz; eski iPhone ya da iPad yalnız ön planda "ekran" olabilir.

## 3. Tanımlar

| Ad | Anlam |
|----|-------|
| **Tepsi uygulaması** | Windows ya da macOS'ta Havenfold düğümünü çalıştıran kurulu uygulama ve servisleri. |
| **Konteynersiz işçi** | Tepsi uygulamasının işçi kimliği. Defterde `DEVICE_ATTACH { class: 'isci' }`. |
| **Görev sarmalayıcısı** | Bir görev türünü yerel ikili olarak yapan, Havenfold'un derleyip imzaladığı program (`hf-gorev-ocr`, `hf-gorev-ses`). |
| **Uç** | Defterde `DEVICE_ATTACH { class: 'uc' }` olan cihaz. Bu RFC'de eski Android telefon/tablet ya da ekran modundaki eski iOS cihaz. |
| **Uç modu** | `kamera`, `sensor`, `ekran` ya da `kapali`. Bir uç aynı anda tek moddadır. |
| **Akış** | Bir uçtan bir alıcıya giden şifreli görüntü dizisi. `streamId` ile tanınır. |
| **Çalışma profili** | Cihazın hangi ortamda, hangi kısıtlarla çalıştığının imzalı bildirimi (`NODE_PROFILE`, §10). |

Kodlama ve imza kuralları RFC-0001 §3 ve RFC-0002 §3'tekiyle aynıdır: `sig = Ed25519(imzalayan, hash('<etiket>', familyId, body))`.

## 4. Tepsi uygulaması: mimari

### 4.1 Süreçler

| Süreç | Windows | macOS | Ne yapar |
|-------|---------|-------|----------|
| İşçi çekirdeği (Bare) | Servis `HavenfoldIsci`, hesap `NT SERVICE\HavenfoldIsci` | LaunchDaemon `io.havenfold.isci`, kullanıcı `_havenfoldisci` | RFC-0007 §4.1'deki işçi çekirdeği |
| Kutu çekirdeği (Bare, isteğe bağlı) | Servis `HavenfoldKutu`, `NT SERVICE\HavenfoldKutu` | `io.havenfold.kutu`, `_havenfoldkutu` | Kutu rolü (§4.4) |
| Denetçi (Node 24 LTS) | Servis `HavenfoldDenetci`, `NT SERVICE\HavenfoldDenetci` | `io.havenfold.denetci`, `_havenfolddenetci` | Görev çalıştırma, yedek, sağlık, güncelleme indirme |
| Yetki yardımcısı | Servis `HavenfoldYetki`, `LocalSystem`, isteğe bağlı başlatma | LaunchDaemon `io.havenfold.yetki`, `root`, isteğe bağlı | Güncelleme paketini kurma, güvenlik duvarı kuralı, servis yeniden başlatma |
| Görev süreci | AppContainer (LPAC) + Job Object | App Sandbox, kullanıcı `_havenfoldgorev` | §6 |
| Tepsi arayüzü | Kullanıcı oturumunda | Kullanıcı oturumunda, oturum açma öğesi (`SMAppService`) | Durum, tören QR'ı, onaylar, kullanıcı boşta mı bilgisi |

- **Tepsi arayüzü Tauri 2 ile yazılır** (MIT/Apache-2.0). İşletim sisteminin kendi web görünümünü kullanır (WebView2, WKWebView), bellek izi küçüktür. Electron eski bilgisayarlarda fazla bellek tutar. Arayüz yalnız görüntüdür; kimlik, defter ve anahtar görmez.
- Servisler kullanıcı oturumu açılmadan çalışır. Arayüz kapalıyken de düğüm çalışır.
- Kurulum bir kez yönetici izni ister. Sonrasında kullanıcı yönetici olmadan arayüzü kullanır.

### 4.2 Yerel IPC

RFC-0007 §6'daki çerçeve ve mesajlar aynen kullanılır. Taşıma farkı:

| | Windows | macOS |
|-|---------|-------|
| Kanal | Adlandırılmış boru: `\\.\pipe\havenfold-<kimlik>-denetci`, `\\.\pipe\havenfold-yonetim` | Unix soketi: `/var/run/havenfold/<kimlik>/denetci.sock`, `/var/run/havenfold/yonetim.sock` |
| Erişim | Boru DACL'ı yalnız ilgili servis SID'lerine izin verir. Yönetim borusu kurulumun açtığı yerel `Havenfold Yöneticileri` grubuna açıktır; kuran kullanıcı bu gruba eklenir. | Dosya izinleri RFC-0007 §6.1'deki gibi. |
| Karşı uç denetimi | `GetNamedPipeClientProcessId` + süreç belirtecinin SID'i | `getpeereid` |

Tepsi arayüzü yalnız yönetim kanalına bağlanır. Arayüzün bildirdiği tek veri, kullanıcının son girdiden bu yana geçen süresidir (§8.2).

### 4.3 Anahtar ve veri saklama

Linux düğümünde diski LUKS korur (RFC-0007 §8.5). Tepsi uygulamasında disk şifrelemesi kullanıcıya aittir ve Havenfold onu bilemez. Bu yüzden **bütün Havenfold verisi uygulama düzeyinde şifrelidir.**

- **Veri anahtarı:** Kurulumda her kimlik için rastgele 32 bayt. Her dosya `XChaCha20-Poly1305(derive(veriAnahtari, 'hf/tepsi-veri/'), nonce, içerik, AD = göreli yol)` ile yazılır. Bu, çekirdeğin depolama katmanına (`storage/fs-node.js`) eklenen bir sarmalayıcıdır; Linux düğümünde kapalıdır.
- **Kimlik anahtarı ve veri anahtarı** birlikte bir **sarma anahtarıyla** şifrelenip `kimlik.sarili` dosyasında durur:

| Platform | Sarma anahtarı | `keyStore` değeri |
|----------|----------------|-------------------|
| Windows, TPM 2.0 var | Microsoft Platform Crypto Provider'da (TPM) servis hesabına ait RSA-2048 anahtar; OAEP ile şifreleme | `tpm` |
| Windows, TPM yok | DPAPI, servis hesabının kullanıcı kapsamı | `dpapi` |
| macOS, Secure Enclave var | Secure Enclave P-256 anahtarı; ECIES ile şifreleme | `secure-enclave` |
| macOS, Secure Enclave yok | Sistem anahtar zinciri öğesi, erişimi denetçi ve çekirdek ikililerine sınırlı | `macos-keychain` |

- Sarma anahtarı silinince veri anahtarı ve kimlik anahtarı geri getirilemez. Emeklilikte "şifreli silme" budur (§9).
- Bu algoritmalar (RSA-OAEP, ECIES) protokolün dışında, işletim sisteminin standart anahtar saklama mekanizmalarıdır (kurucu belge §13.2 son paragraf). Protokol içinde yeni algoritma yoktur.

**Dizinler ve izinler:**

| | Windows | macOS |
|-|---------|-------|
| Program | `C:\Program Files\Havenfold\surumler\<sürüm>\` | `/Applications/Havenfold.app` (arayüz ve gömülü ikililer) |
| Veri | `C:\ProgramData\Havenfold\{isci,kutu,denetci,yedek,varliklar,gorev}` | `/Library/Application Support/Havenfold/{isci,kutu,denetci,yedek,varliklar,gorev}` |
| İzin | Her dizinde yalnız ilgili servis SID'i ve `SYSTEM`; kalıtım kapalı | Her dizin ilgili kullanıcıya ait, `0700` |
| Yedekleme ve dizin | Windows Arama dizinine alınmaz | Time Machine dışı (`tmutil addexclusion -p`), Spotlight dışı (`.metadata_never_index`) |

**Dürüst sınır:** Bilgisayarın yöneticisi (Windows'ta `Administrators`, macOS'ta `root`) bu dizinlerin sahipliğini alabilir, çalışan süreçlerin belleğini okuyabilir. Konteynersiz işçide çalışan bir görevin girdisini bilgisayarın yöneticisi görebilir. Tören ekranı ve ilk kullanım onayı (RFC-0002 §7) bunu söyler (§10.3).

### 4.4 Kutu rolü

- Tepsi uygulaması kutu rolünü de çalıştırabilir (09 §1.3). Birleşik kullanım RFC-0007 §4.2'deki gibidir: iki servis, iki hesap, iki anahtar.
- Kutu rolü yalnız kullanıcı "Bu bilgisayar sürekli açık ve prizde duracak" onayını verirse açılır. Uyuyan bir kutu emanet ve röle işini yapamaz.
- Tepsi kutusu **kasa payı tutmaz** (§10.2).

## 5. Konteynersiz görev türleri

| Tür | Konteynersiz işçide | Nasıl | Özellikler (`features`) | Sınır |
|-----|---------------------|-------|-------------------------|-------|
| `hf.task.backup` | ✓ | Denetçinin içinde (RFC-0002 §11.2); içerik açılmaz | — | Kullanıcının seçtiği `holdGB` |
| `hf.task.ocr` | ✓ | `hf-gorev-ocr`: Tesseract 5 (Apache-2.0), Leptonica (BSD-2), PDFium (BSD-3/Apache-2.0) | `metin` | `output: 'pdf'` yok: aranabilir PDF üretimi OCRmyPDF ve Ghostscript (AGPL) ister, bunlar yalnız Linux görev imajında çalışır. |
| `hf.task.transcribe` | ✓ | `hf-gorev-ses`: whisper.cpp (MIT), libopus (BSD-3) | `wav`, `opus` | Diğer ses biçimleri yok (çözücü FFmpeg gerektirir). Model `small` ve `medium`. |
| `hf.task.llm` | ✗ | — | — | Bellek sınırı macOS'ta katı uygulanamaz (§6.4); kişinin günlük kullandığı bilgisayarda uzun süre yüksek bellek tutar. Ayrı RFC'ye kadar kapalı. |
| `hf.task.vision` | ✗ | — | — | Kamera ağına erişim ister; ağsız kum havuzuyla çelişir. Sürekli yük. |
| `yuva.task.*`, `mekan.task.*` | ✗ | — | — | Ürün imajları OCI'dir. |

- Sarmalayıcıların özetleri `havenfold-tepsi` sürüm bildiriminin `packages` listesindedir (RFC-0007 §12.1). Ses modelleri (`small`, `medium`) aynı kök anahtarla imzalı model bildiriminden gelir (RFC-0013). Özeti eşleşmeyen sarmalayıcı ya da model çalıştırılmaz.
- Linux işçi bildirdiğinde `hf.task.ocr` özellikleri `metin`, `pdf`; `hf.task.transcribe` özellikleri `wav`, `opus`, `m4a`, `mp3`'tür.
- **Yerleştirme kuralı (RFC-0002 §8 madde 1'e ek):** Telefon, isteğin gerektirdiği özelliği (`output: 'pdf'` → `pdf`; girdinin MIME türü → biçim) adayın `NODE_PROFILE.features` listesinde arar. Yoksa aday değildir. `NODE_PROFILE` göndermeyen cihaz Linux düğümü sayılır ve yukarıdaki Linux listesine sahiptir.
- İşçi yine de denetler: desteklemediği parametreyi `TASK_REJECT { code: 'DESTEK_YOK' }` ile reddeder (RFC-0002 §6.2 madde 5).

## 6. Kum havuzu

### 6.1 Ortak kurallar

| Kural | Neden |
|-------|-------|
| Görev süreci ayrı bir hesapta ya da kapsayıcıda çalışır; denetçinin, çekirdeğin ve kullanıcının dosyalarına erişemez. | H4 |
| **Ağ kapalıdır.** | Kurucu belge §8.7, T3 |
| **Girdi ve çıktı dosya tanıtıcısıyla geçer.** Denetçi çözülmüş girdiyi bir anonim belleğe ya da geçici dosyaya yazar ve tanıtıcısını görev sürecine miras verir (fd 3). Parametreler standart girdiden, sonuç JSON olarak standart çıktıdan gelir. Görev süreci dosya sistemine yol ile yalnız salt okunur `varliklar/` (modeller) ve kendi geçici dizinine erişir. | Kum havuzu kuralları daha dar yazılabilir; yol tabanlı izin hatası riski kalkar. |
| Görev süreci alt süreç açamaz. | Kaçış yüzeyini daraltır. |
| Süre `limits.minutes` ile sınırlıdır; dolunca süreç ağacı öldürülür, `TASK_RESULT { status: 'sure' }`. | RFC-0002 |
| Bitince geçici dizin silinir, tanıtıcılar kapanır, `fileKey`'ler `sodium_memzero` ile sıfırlanır. | RFC-0002 §11.1 |
| Düz metin girdi yalnız bellekte ya da şifreli geçici dosyada durur. Geçici dosya gerekiyorsa (büyük ses) denetçi onu görev başına rastgele anahtarla şifreler ve sarmalayıcıya yalnız şifre çözülmüş bir boru verir. | Disk şifrelemesi bilinmez (§4.3). |

### 6.2 Windows

- **AppContainer, LPAC (az ayrıcalıklı uygulama kapsayıcısı):** Yetenek (capability) listesi boştur. `internetClient`, `internetClientServer`, `privateNetworkClientServer` yoktur; kapsayıcı ağ soketi açamaz.
- **Job Object:**
  - `JOB_OBJECT_LIMIT_PROCESS_MEMORY = limits.ramMB`;
  - `JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 1` (alt süreç yok);
  - `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, `JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION`;
  - CPU oranı sert sınırı: çekirdeklerin %75'i (RFC-0002 §11.1 ile aynı); işlemci sıcaklığı okunamayan cihazda %50;
  - UI kısıtları: masaüstü, pano ve genel atomlar kapalı.
- **Miras tanıtıcı listesi** (`PROC_THREAD_ATTRIBUTE_HANDLE_LIST`): yalnız fd 0, 1, 2 ve 3 karşılıkları.
- `varliklar\` dizinine yalnız kapsayıcı SID'i için okuma izni verilir.
- **Ek savunma:** Kurulum, `hf-gorev-*.exe` için giden trafiği engelleyen bir Windows Güvenlik Duvarı kuralı yazar. Birincil koruma AppContainer'dır; kural ikinci kattır.

### 6.3 macOS

- **App Sandbox:** Sarmalayıcılar `com.apple.security.app-sandbox` yetkisiyle imzalanır. Ağ yetkileri (`com.apple.security.network.client`, `.server`) **yoktur**; süreç ağ soketi açamaz.
- `varliklar/` için yalnız salt okunur mutlak yol istisnası (`com.apple.security.temporary-exception.files.absolute-path.read-only`). Bu istisna Mac App Store dışı, Developer ID ile dağıtımda geçerlidir.
- Hardened Runtime açıktır, kütüphane doğrulaması zorunludur.
- Görev süreci `_havenfoldgorev` kullanıcısıyla başlar; kapsayıcısı bu kullanıcının ev dizinindedir (`/Library/Application Support/Havenfold/gorev`).
- **Bellek sınırı:** macOS'ta süreç başına katı bellek sınırı yoktur. Denetçi görev sürecinin yerleşik belleğini 500 ms'de bir okur (`proc_pid_rusage`); `limits.ramMB`'yi aşarsa süreci öldürür ve `TASK_RESULT { status: 'hata', log: 'BELLEK' }` döner.
- **CPU:** Süreç `QOS_CLASS_UTILITY` sınıfında başlar; kullanıcı etkinken `QOS_CLASS_BACKGROUND`'a indirilir (§8.2).

### 6.4 Kum havuzu sınaması

Kurulumda ve her güncellemeden sonra denetçi, aynı kum havuzunda `hf-gorev-sina` adlı imzalı bir sınama programı çalıştırır. Program şunları dener ve hepsinin **başarısız** olmasını bekler:

1. Bir internet adresine TCP bağlantısı;
2. Ev ağından bir özel adrese UDP gönderimi;
3. Kullanıcı ev dizininde bir dosyayı okuma;
4. Havenfold veri dizinini okuma;
5. Alt süreç başlatma;
6. `limits.ramMB + 256 MB` bellek ayırma (bu denemede sürecin öldürülmesi beklenir).

Herhangi biri başarılı olursa denetçi bütün görev türlerini kapatır (`hf.task.backup` hariç), `NODE_PROFILE.sandbox = 'yok'` bildirir ve kartta "Görev güvenliği doğrulanamadı" uyarısı gösterir.

**Dürüst karşılaştırma:**

| Özellik | Linux (Podman) | Windows (LPAC + Job) | macOS (App Sandbox) |
|---------|----------------|----------------------|---------------------|
| Ağ kapalı | Ad alanı | Yetenek yok | Yetki yok |
| Bellek sınırı | Katı (cgroup) | Katı (Job) | İzlemeyle, kısa aşım olabilir |
| Ayrı dosya sistemi | Evet | Hayır, ACL ile | Hayır, kapsayıcı ile |
| Yönetici görevi görebilir mi | Kök görebilir | Evet | Evet |

## 7. Kurulum, güncelleme, kaldırma

### 7.1 Kurulum

| | Windows | macOS |
|-|---------|-------|
| Paket | MSI, Authenticode imzalı, zaman damgalı | `.pkg`, Developer ID Installer imzalı ve noter onaylı; uygulama Developer ID Application imzalı |
| Alt sınır | Windows 10 22H2 ve 11, x64 | macOS 13, Apple Silicon ve Intel |
| Yönetici izni | Bir kez (UAC) | Bir kez (yükleyici parolası) |
| Kurulumun yaptıkları | Servisler, sanal hesaplar, veri dizinleri ve ACL'ler, `Havenfold Yöneticileri` grubu, güvenlik duvarı kuralları (çekirdeğin UDP portu yalnız Özel ağ profilinde gelen; sarmalayıcılara giden engel) | Kullanıcılar (`_havenfold*`, UID 300–399 arasında boş olanlar), LaunchDaemon dosyaları, veri dizinleri, Time Machine ve Spotlight dışlamaları |
| Yapmadıkları | Güç planını, Defender ayarlarını, BitLocker'ı değiştirmez | `pmset` ayarlarını, FileVault'u değiştirmez |

**İlk açılış ve tören:**

1. Arayüz donanım özetini ve uyarıları gösterir: "Bu bilgisayar başka işlere de kullanılıyor. Havenfold yalnız kendi verisini görür; bilgisayarın yöneticisi Havenfold'a gelen işleri görebilir."
2. Rol seçimi: işçi (varsayılan), kutu, ikisi.
3. Kum havuzu sınaması (§6.4).
4. Tören: arayüz QR'ı gösterir (`kind = 2`, kutuda `kind = 1`). 5 resim karşılaştırılır. RFC-0007 §9 madde 9'daki kök anahtar denetimi telefonda aynen yapılır.
5. Model dosyaları arka planda indirilir.

### 7.2 Güncelleme

- Ürün adı `havenfold-tepsi`. Bildirim, kök anahtar, kanal, sürüm tekdüzeliği, `UPDATE_APPROVE` ve topluluk içi paylaşım RFC-0007 §12'nin aynısıdır.
- Paket iki imzayla doğrulanır; ikisi de tutmalıdır:
  1. Bildirimdeki `hash('hf/release-pkg/', …)` özeti;
  2. İşletim sisteminin imzası: Windows'ta `WinVerifyTrust` ve imzalayan sertifikanın konusu (Eser Teknoloji); macOS'ta `pkgutil --check-signature`, `spctl -a -t install` ve Apple ekip kimliği. Beklenen imzalayan kimliği paketin içinde sabittir.
- Yetki yardımcısı doğrulanmış paketi sessiz kurar (`msiexec /qn`, `installer -pkg`). Sağlık denetimi ve geri dönüş RFC-0007 §12.6 gibidir; Windows'ta önceki MSI önbellekte tutulur, macOS'ta önceki uygulama paketi `onceki/` altında saklanır.
- İşletim sistemi güncellemeleri Havenfold'un işi değildir.

### 7.3 Kaldırma

- Doğru yol emekliliktir (§9). Arayüzdeki "Havenfold'u kaldır" düğmesi önce "Bu cihaz ailenin kaydında duruyor. Önce bir ebeveyn 'Emekliye ayır' demeli." der ve ebeveyne bildirim gönderir.
- Kullanıcı yine de kaldırırsa (ya da işletim sisteminin kaldırma ekranını kullanırsa):
  1. Kaldırıcı servisleri durdurur.
  2. §9.2'deki silme adımlarını uygular; rapor `trigger = 'kaldirma'` ile hazırlanır.
  3. Çevrimiçiyse raporu 10 saniye içinde en az bir ebeveyne göndermeyi dener; gönderemezse yine de sürer.
  4. Servisleri, hesapları, grubu, güvenlik duvarı kurallarını, dizinleri siler.
- Rapor gelmezse telefon cihazı 30 gün sonra kurucu belge §6.8'deki "sessiz cihaz" sorusuyla sorar.

## 8. Uyku, kullanıcı etkinliği ve güç

### 8.1 Uyku

- Uygulama işletim sisteminin güç planını kendiliğinden **değiştirmez**. Bu bilgisayar başkasının günlük bilgisayarıdır.
- **Görev sürerken ve prizdeyken** uyku geçici olarak engellenir:
  - Windows: `SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)`;
  - macOS: `IOPMAssertionCreateWithName(kIOPMAssertionTypePreventSystemSleep, …)` (yalnız prizde etkilidir).
  - Görev bitince engel kalkar.
- **Kutu rolünde** engel prizdeyken sürekli tutulur.
- **Kapak:** Engel kapak kapanınca uykuyu durdurmaz. Arayüz bunu söyler. Windows'ta kullanıcı isterse "Prizdeyken kapak kapanınca hiçbir şey yapma" düğmesi `powercfg` ile bu tek ayarı değiştirir; yönetici izni ister ve açık bir kullanıcı seçimidir. macOS'ta kapak kapalı çalışma yalnız harici ekranlı kapalı kapak kipinde olur; uygulama bunu değiştirmez.
- **Uyku bildirimi** (Windows `SERVICE_CONTROL_POWEREVENT` / `PBT_APMSUSPEND`, macOS `kIOMessageSystemWillSleep`):
  - Çalışan görevler durdurulur, `TASK_RESULT { status: 'iptal', log: 'UYKU' }` gönderilmeye çalışılır. Telefon bunu bir deneme sayar ve parçayı sıradaki adaya verir (RFC-0002 §8 madde 4).
  - `NODE_CAPS { status: 'bakim' }` gönderilmeye çalışılır.
- **Uyanınca:** Oturumlar yeniden kurulur, güncel `NODE_CAPS` gider.

### 8.2 Kullanıcı etkinliği

- `NODE_PROFILE.idlePolicy`:
  - `bostayken` (varsayılan): Son girdiden bu yana 5 dakika geçmediyse `NODE_CAPS.status = 'mesgul'`. Yeni görev kabul edilmez.
  - `her-zaman`: Kullanıcı açıkça seçerse.
- Görev sürerken kullanıcı dönerse görev iptal edilmez; önceliği düşürülür (Windows'ta Job önceliği `IDLE_PRIORITY_CLASS`, macOS'ta `QOS_CLASS_BACKGROUND`).
- Son girdi süresini yalnız tepsi arayüzü okur (Windows `GetLastInputInfo`, macOS `CGEventSourceSecondsSinceLastEventType`) ve yönetim kanalından denetçiye bildirir. Ne yazıldığı, hangi uygulamanın açık olduğu okunmaz.

### 8.3 Güç ve ısı

- Prizden çıkınca `status = 'pil'` (RFC-0002 §4).
- Isı: macOS'ta `ProcessInfo.thermalState` `serious` ya da `critical` ise `status = 'sicak'`. Windows'ta ACPI ısı bölgesi okunabiliyorsa RFC-0002'deki 90 °C kuralı; okunamıyorsa `tempC = 0` bildirilir ve CPU sınırı %50'dir (§6.2).
- `NODE_HEALTH` (RFC-0007 §11) tepsi uygulamasında da gönderilir. Farklar: `platform.disk = 'uygulama-sifreli'`; `platform.tpm` değeri `keyStore`'a göre (`tpm` ve `secure-enclave` → `muhur-ok`, diğerleri `yok`); `sleepGuard` alanları `false`'tur ve `UYKU_KORUMASI_YOK` uyarısı tepsi uygulamasında gösterilmez.

## 9. Emeklilik ve `uygulama-verisi-silindi` raporu

### 9.1 Neden ayrı bir rapor

Silme ortamı (RFC-0007 §13) diski sanitize eder ve raporu cihazın işletim sisteminden bağımsız bir ortamda imzalar. Tepsi uygulamasında ve Android uçta işletim sistemi silinmez. Bu cihazlarda yapılabilen tek şey **Havenfold verisinin** yok edilmesidir ve rapor cihazın **kendi beyanıdır**. Bu farkı gizlememek için ayrı bir zarf ve ayrı bir rapor türü kullanılır. `WIPE_REPORT` (RFC-0003 §8) değiştirilmez.

### 9.2 Akış

1. Ebeveyn "Emekliye ayır" der. `RETIRE_BEGIN`, `RETIRE_LIST` ve taşıma RFC-0003 §8 ve RFC-0007 §13.1'deki gibidir. ESP bileti yazılmaz; `RETIRE_STATE.ticket = false`.
2. `RETIRE_STATE { phase: 'hazir' }` gelince telefon "Bilgisayarda (ya da cihazda) onaylayın" der.
3. Cihazın kendi ekranında "Havenfold verisini sil" onayı istenir. **İki taraflı onay:** Ebeveyn başlatır, cihazın başındaki kişi onaylar. Böylece ne uzaktaki biri sessizce, ne de cihazın başındaki biri ebeveynsiz bir rapor üretebilir.
4. Cihaz silme adımlarını uygular:

   | # | Ne | Yöntem |
   |---|----|--------|
   | 1 | Servisler durur, açık görevler iptal edilir | — |
   | 2 | Sarma anahtarı yok edilir (TPM anahtarı, Secure Enclave anahtarı, Keystore anahtarı ya da anahtar zinciri öğesi) | `anahtar-imha` |
   | 3 | Veri dizinleri silinir (defter, kasa, emanet, dosyalar, yedek blokları, görev geçmişi, günlükler) | `dosya-silme` |
   | 4 | Model dosyaları ve sarmalayıcılar silinir | `dosya-silme` |
   | 5 | Kimlik anahtarı yalnız bellekte kalır; rapor imzalanır | — |

5. Rapor ebeveynlere gönderilir: doğrudan oturumda ya da kutu emanetinde (mühürlü).
6. İlk ebeveyn zarfı aldığını bildirince (mevcut `ACK`, 0x21) cihaz kimlik anahtarını bellekten siler ve "Havenfold verisi silindi. Uygulamayı kaldırabilirsiniz." der. `ACK` 10 dakikada gelmezse yine siler.
7. Telefon raporu doğrular (imzayı defterdeki cihaz anahtarıyla), "Ebeveynler" koleksiyonuna `hf.wipe.report` kaydı olarak yazar (`kind: 'uygulama-verisi-silindi'`) ve `DEVICE_DETACH { wipe: true, wipeReportHash: appWipeReportHash }` yazar. Kutuda `REMOVE_MEMBER { reason: 'wipe:' + hex(appWipeReportHash) }`.
8. Rapor gelmezse telefon RFC-0003 §8'deki gibi `wipeReportHash = 0` ile çıkarır.

### 9.3 `APP_WIPE_REPORT` (0xE7)

```
APP_WIPE_REPORT {
  deviceId    : fixed16                  // kutuda memberId
  hostId      : fixed16
  kind        : string ('uygulama-verisi-silindi')
  trigger     : string ('emeklilik' | 'kaldirma')
  os          : string ('windows' | 'macos' | 'android' | 'ios')
  osVersion   : string
  appVersion  : string
  keyStore    : string ('tpm' | 'secure-enclave' | 'strongbox' | 'android-keystore' | 'ios-keychain' | 'dpapi' | 'macos-keychain')
  items       : array<{ what: string, method: string ('anahtar-imha' | 'dosya-silme'), ok: bool }>
  residue     : array<string>            // §9.4
  startedAt, finishedAt : uint
  result      : string ('ok' | 'dogrulanamadi' | 'hata')
  sig         : fixed64                  // cihazın kimlik anahtarı; etiket 'hf/app-wipe-report/'
}
appWipeReportHash = hash('hf/app-wipe-report-id/', APP_WIPE_REPORT'un tam kodlaması)
```

| `result` | Koşul |
|----------|-------|
| `ok` | Bütün `items` başarılı **ve** `keyStore ∈ { tpm, secure-enclave, strongbox, android-keystore, ios-keychain }` (sarma anahtarı donanımda ya da işletim sisteminin korumalı deposundaydı ve yok edildi) |
| `dogrulanamadi` | Bütün `items` başarılı, ama `keyStore ∈ { dpapi, macos-keychain }` |
| `hata` | Herhangi bir öğe başarısız |

Telefon raporu kaydederken ve PDF'ini üretirken en üste şunu yazar: **"Bu rapor cihazın kendi beyanıdır. İşletim sistemi silinmedi. Cihazı satacak ya da verecekseniz işletim sistemini de sıfırlayın ya da Kurulum USB'sinin silme modunu kullanın."**

### 9.4 Kalıntılar (`residue`)

Cihaz, Havenfold'un silemediği ve bilinen kalıntı yerlerini rapora yazar:

| Kod | Ne zaman |
|-----|----------|
| `sayfa-dosyasi` | Windows `pagefile.sys` ya da macOS takas dosyaları; görev belleği oraya düşmüş olabilir |
| `hazirda-bekletme` | Hazırda bekletme dosyası açıksa |
| `isletim-sistemi-yedegi` | Dosya Geçmişi, sistem geri yükleme noktası ya da Time Machine açıksa (Havenfold dizini dışlanmış olsa bile kurulumdan önceki bir yedek olabilir) |
| `disk-sifresiz` | BitLocker ya da FileVault kapalıysa |
| `fabrika-ayari-yapilmadi` | Android ve iOS'ta her zaman (uygulama bunu yapamaz ve doğrulayamaz) |

### 9.5 Eski Android ve iOS için ek

Kurucu belge §9.5 "Eski Android'de" maddesi bu akışla birleşir. Silme bittikten sonra cihaz ekranında sırayla:

1. "Cihazdaki Google hesabını kaldırın" (fabrika ayarından sonra kilitlenmesin diye). Play malzemesi dışındaki bu iç metin Android uygulamasındadır.
2. Depolama şifrelemesinin açık olduğu denetlenir (`DevicePolicyManager.getStorageEncryptionStatus`); Android 10 ve sonrasında her zaman açıktır, ekranda "açık" yazar.
3. "Şimdi fabrika ayarlarına dönün" ve ayar ekranına bağlantı.

iOS ekran cihazında aynı adımların iOS karşılığı gösterilir.

## 10. Çalışma profili ve sınıf farkları

### 10.1 `NODE_PROFILE` (0xE0)

```
NODE_PROFILE {
  nodeId        : fixed16
  hostId        : fixed16
  seq           : uint
  runtime       : string ('linux-konteyner' | 'windows-yerel' | 'macos-yerel' | 'android-uc' | 'android-kutu' | 'ios-ekran')
  sandbox       : string ('podman' | 'appcontainer-job' | 'app-sandbox' | 'yok')
  features      : array<{ type: string, features: array<string> }>
  sharedComputer: bool                  // bilgisayar başka işlere de kullanılıyor
  idlePolicy    : string ('her-zaman' | 'bostayken')
  shareEligible : bool                  // RFC-0004 cihaz payı adayı olabilir mi
  ucModes       : array<string>         // uçta desteklenen modlar
  appVersion    : string
  versionCode   : uint
  sig           : fixed64               // etiket 'hf/node-profile/'
}
```

| Konu | Kural |
|------|-------|
| Kime gider | `NODE_CAPS` ile aynı yerlere (RFC-0002 §4): üyelere ve koordinatöre, canlı oturumda; bağlanınca ve değişince. Emanete ve Posta Kutusu'na gitmez. |
| Kim gönderir | Tepsi uygulaması, Android uç, Yuva Hat kutu modundaki eski Android (`android-kutu`) ve iOS ekran her zaman. Linux düğümü (RFC-0007) de gönderir (`runtime = 'linux-konteyner'`). Profil göndermeyen cihaz yerleştirmede Linux düğümü sayılır, ama kasa payı adayı sayılmaz. |
| `shareEligible` | Yalnız `runtime = 'linux-konteyner'` ve `NODE_HEALTH.platform.tpm = 'muhur-ok'` olan cihazda `true` olabilir. Telefon bu kuralı kendisi de uygular; cihazın beyanına güvenmez. Eski Android kutu TPM'siz düğümdür ve pay tutmaz (kurucu belge §9.2, §10.2; RFC-0004 §3.1). |

### 10.2 Sınıf ve yetenek farkları

Defterde yeni sınıf yoktur. `DEVICE_ATTACH.class` değerleri RFC-0003 §5.1'deki gibidir. `DEVICE_ATTACH.caps`, ilk `NODE_CAPS`'in kodlamasıdır; ilk `NODE_PROFILE` törenden hemen sonra gelir.

| Cihaz | Defter | `NODE_CAPS.os` | `tasks` | Kasa payı | Emanet | `runtime` |
|-------|--------|----------------|---------|-----------|--------|-----------|
| Linux düğümü | `isci` / kutu üyesi | `linux` | Bildirimdeki bütün imajlar | TPM mührü doğrulanmışsa | Kutuysa | `linux-konteyner` |
| Windows tepsi | `isci` / kutu üyesi | `windows` | `backup`, `ocr` (`metin`), `transcribe` (`wav`, `opus`) | **Hayır** | Kutuysa | `windows-yerel` |
| macOS tepsi | `isci` / kutu üyesi | `macos` | Aynı | **Hayır** | Kutuysa | `macos-yerel` |
| Eski Android, uç | `uc` | `android` | Yok (`maxTaskRamMB = 0`) | Hayır | Hayır | `android-uc` |
| Eski Android, kutu (Yuva Hat kutu modu) | kutu üyesi | `android` | Yalnız `hf.task.backup` deposu | Hayır (TPM yok) | Evet | `android-kutu` |
| Eski iPhone/iPad, ekran | `uc` | `ios` | Yok | Hayır | Hayır | `ios-ekran` |

**Neden tepsi uygulaması kasa payı tutmaz:** RFC-0004 cihaz paylarını "tek bir kişinin erişebileceği paylar" sayar ve sayısını sınırlar. Günlük kullanılan, yöneticisi aile dışından biri de olabilen, kötü amaçlı yazılım riski daha yüksek bir bilgisayarda bu varsayım zayıflar. Payı tutmaması kurtarmayı bozmaz: kasa zaten yalnız kişilerle kurtarılabilir olmak zorundadır (RFC-0004 §3.2).

### 10.3 Tören ve ilk kullanım onayındaki metin

- Tören ekranı (telefon): "Bu cihaz Windows'ta (macOS'ta) çalışan, başka işlere de kullanılan bir bilgisayar. Yalnız belge okuma ve ses yazıya dökme işi yapar. Kasa payı tutmaz. Bilgisayarın yöneticisi bu cihaza gelen işleri görebilir."
- İlk kullanım onayı (RFC-0002 §7) bu cihazlar için şu cümleyi ekler: "Bu bilgisayar başka işlere de kullanılıyor; yöneticisi işini görebilir."

## 11. Android uç

### 11.1 Modlar

| Mod | Ne yapar | Ön plan servisi türü | İzinler | Ekran |
|-----|----------|----------------------|---------|-------|
| `kamera` | Görüntüyü yetkili alıcıya akıtır (§11.5) | `camera` | `CAMERA`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_CAMERA`, `POST_NOTIFICATIONS` | Karartılmış durum ekranı; üstte sürekli "Kamera açık → <alıcı adları>" |
| `sensor` | Telefonun ivme, ışık, yakınlık ve basınç sensörlerinden olay bırakır (§11.7) | `specialUse` | `FOREGROUND_SERVICE_SPECIAL_USE`, `POST_NOTIFICATIONS` | Karartılmış durum ekranı |
| `ekran` | Üyelerin gönderdiği kartları gösterir (§11.8) | Yok (ön planda etkinlik, ekran açık tutulur) | — | Kartlar |
| `kapali` | Yalnız bağlı kalır, `NODE_CAPS` gönderir | `specialUse` | Aynı | Durum ekranı |

- Uç modu onu kullanan ürünün uygulamasındadır; ayrı kamera uygulaması yoktur. Bir uç tek ürüne bağlıdır ve görüntüsünü yalnız o ürünün görev imajı işler (RFC-0029 §3). Kod uygulamayla mağazadan gelir (kurucu belge §3, §16.2).
- Bir Android cihaz ya üye telefonu, ya kutu, ya da uçtur (RFC-0003 §3 tek kimlik kuralı). **Aynı cihazda kutu ve uç birlikte çalışmaz.** Gerekçe: kutu trafik üst bilgisini, kamera ucu görüntüyü görür; H4 bunları ayırır ve Android'de iki çekirdeği ayrı süreç ve ayrı anahtarla güvenle çalıştırmanın yolu yoktur.
- **Mikrofon kullanılmaz** (v1). Kamera yalnız görüntü akıtır. Gerekçe: ilke 7 ve Play kuralları; ses ayrı bir ürün kararıdır.
- Alt sınır: Android 10 (API 29), uygulamanın kendi alt sınırı.
- Kutu modu (09 §1.2) da `specialUse` türünü kullanır; Play beyanı ortaktır.

### 11.2 Açılış ve yeniden başlatma

- Android 14 ve sonrasında `BOOT_COMPLETED` alıcısından `camera` türünde ön plan servisi başlatılamaz. Bu yüzden kamera modu yeniden başlatmadan sonra **kendiliğinden açılmaz.**
- Çözüm, kullanıcının seçimine bırakılır:
  1. **Uç ana ekranı (önerilen):** Kurulumda "Bu cihazda Yuva ana ekran olsun" seçeneği. Uygulama Android'in ana ekran uygulaması olarak seçilirse yeniden başlatmadan sonra ön plana kendisi gelir ve kamerayı ön plandaki etkinlikten başlatır.
  2. Seçilmezse açılışta kalıcı bir bildirim çıkar: "Kamerayı başlatmak için dokunun". Ebeveynlere `UC_STATUS { camera.active: false }` ve "Kamera yeniden başladı, dokunulması gerekiyor" uyarısı gider.
- `sensor` ve `kapali` modları (`specialUse`) açılışta kendiliğinden başlar.
- Uygulama `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` iznini **istemez** (Play politikasında kısıtlı). Kurulum, kullanıcıyı pil iyileştirme ayar ekranına yönlendirir (`ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS`) ve üreticiye özgü arka plan ayarları için yol gösterir (09 §1.2).

### 11.3 Pil ve ısı

Android'de üçüncü taraf uygulama şarjı sınırlayamaz. Kurulum, üreticinin pil koruma ayarına yönlendirir; ayar yoksa açık bir uyarı gösterir.

| Ölçü | Eşik | Sonuç |
|------|------|-------|
| Pil sıcaklığı (`EXTRA_TEMPERATURE`) | ≥ 42 °C, 10 dk | Akış kısılır: çözünürlük ve kare hızı yarıya iner. `UC_STATUS.thermal = 'kisildi'`. |
| Pil sıcaklığı | ≥ 47 °C | Kamera durur. `thermal = 'durdu'`, `NODE_CAPS.status = 'sicak'`, ebeveyne uyarı. |
| Pil sıcaklığı | < 40 °C, 10 dk | Normale döner. |
| `EXTRA_HEALTH` | `OVERHEAT`, `DEAD`, `OVER_VOLTAGE` | Kamera durur; `PIL_KRITIK` uyarısı. |
| İşletim sisteminin bildirdiği sağlık yüzdesi (varsa) | < 60 | `PIL_SAGLIK_DUSUK` |
| Prizden çıkma | `onAC = false` | Akış sürer; `status = 'pil'` |
| Pil yüzdesi (prizde değilken) | ≤ %20 | Kamera durur; ebeveyne uyarı |
| Şarj sınırı ayarı yok | — | Kurulumda uyarı; 6 ayda bir "pili kontrol edin" hatırlatması |

Uç, sağlık için `NODE_HEALTH` göndermez; pil bilgisi `NODE_CAPS.battery` ve `UC_STATUS` iledir.

### 11.4 Uç yapılandırması: `UC_CONFIG` (0xE1)

Uçun ne yapacağına ve görüntüsünün kime gideceğine ebeveyn karar verir (H3: cihaz karar vermez).

```
UC_CONFIG {
  ucId        : fixed16
  seq         : uint
  mode        : string ('kamera' | 'sensor' | 'ekran' | 'kapali')
  targets     : array<string>           // 'device:<hex16>' (işçi), 'rol:ebeveyn', 'rol:yetiskin', 'uye:<hex16>'
  video       : { maxWidth: uint, maxHeight: uint, fps: uint, kbps: uint }
  windows     : array<{ days: uint, startMin: uint, endMin: uint }>   // days: bit 0 Pazartesi … bit 6 Pazar; boşsa her zaman
  sensors     : array<string>           // 'ivme', 'isik', 'yakinlik', 'basinc'
  screenFrom  : array<string>           // ekran modunda kart gönderebilecekler: 'rol:…', 'uye:…'
  ledgerSeq   : uint
  signerId    : fixed16
  sig         : fixed64                 // etiket 'hf/uc-config/'
}
```

| # | Uçun denetimi | Hata |
|---|---------------|------|
| 1 | `ucId` kendi kimliği | `WRONG_EDGE` |
| 2 | `signerId`, `ledgerSeq` anında ve bugün aktif ebeveyn; `sig` geçerli | `UNAUTHORIZED` |
| 3 | `device:` öğeleri aktif ve `class = 'isci'` olan cihazlar | `INVALID_TARGET` |
| 4 | `rol:cocuk` ve `grant:` hiçbir listede yok | `INVALID_TARGET` |
| 5 | `mode = 'kamera'` değilse `targets` boş; `mode = 'ekran'` değilse `screenFrom` boş | `INVALID_BODY` |
| 6 | `video` sınırları: en çok 1920×1080, 15 kare/sn, 4000 kbps | `INVALID_BODY` |
| 7 | Sıra: `seq`, saklanan yapılandırmanınkinden büyük. Eşitse `hash('hf/uc-config/', familyId, body)` bayt sırasıyla büyük olan kazanır. Küçükse yok sayılır. | — |

- Sıra kuralı yalnız gövdeye bakar; geliş sırasına ve saate bağlı değildir. İki ebeveyn aynı anda yazarsa bütün cihazlar aynı yapılandırmada birleşir.
- `windows` uçun yerel saatine göre uygulanır. Bu paylaşılan bir durum değildir; yalnız uçun kendi davranışıdır.
- Yeni yapılandırma kabul edilince uyuşmayan akışlar hemen kapatılır (`UC_STREAM_CLOSE { code: 'YAPILANDIRMA_DEGISTI' }`).
- Varsayılan `video`: 1280×720, 10 kare/sn, 1000 kbps, 2 saniyede bir anahtar kare.
- Taşıma: doğrudan oturum ya da kutu emaneti (RFC-0003 §6.4 mührü, `ctrl` anahtarı). Posta Kutusu'na gitmez.
- **Çocuk rolü** v1'de kamera izleyemez ve ekrana kart gönderemez. Gerekçe: kurucu belge §15.2'deki çocuk kuralları ve evin içindeki yetişkinlerin görünmez izlenmesini önlemek.

### 11.5 Kamera akışı

**Mesajlar:**

```
UC_STREAM_OPEN (0xE2) {
  streamId    : fixed16                 // rastgele
  ucId        : fixed16
  requesterId : fixed16
  purpose     : string ('analiz' | 'canli')
  taskId      : fixed16                 // analizde sürekli görevin taskId'si; canlıda 16 sıfır
  want        : { width: uint, height: uint, fps: uint }
  configSeq   : uint
  ledgerSeq   : uint
  sig         : fixed64                 // isteyen; etiket 'hf/uc-stream-open/'
}
UC_STREAM_ACCEPT (0xE3) { streamId, codec: string ('h264'), profile: string, width: uint, height: uint, fps: uint, ssrc: uint }
UC_STREAM_CLOSE  (0xE4) { streamId, code: string, by: fixed16 }
```

**Akışı açan alıcıdır** (RTSP'deki istemci gibi). Uç kendiliğinden görüntü göndermez.

| # | Uçun denetimi | `UC_STREAM_CLOSE.code` |
|---|---------------|------------------------|
| 1 | `sig` geçerli; isteyen aktif bir üye ya da aktif bir işçi | `IZIN_YOK` |
| 2 | `mode = 'kamera'` | `IZIN_YOK` |
| 3 | İsteyen `targets` ile eşleşiyor: işçi için `device:<id>` ve `purpose = 'analiz'`; üye için `rol:` ya da `uye:` ve `purpose = 'canli'` | `IZIN_YOK` |
| 4 | `configSeq` uçtaki yapılandırmanın `seq`'i | `YAPILANDIRMA_DEGISTI` |
| 5 | Şu an `windows` içinde | `PENCERE_DISI` |
| 6 | Oturum **doğrudan** (HyperDHT doğrudan bağlantı; kutu rölesi ya da başka bir yol değil) | `ROLE_YASAK` |
| 7 | Isı ve pil uygun (§11.3) | `SICAK`, `PIL` |
| 8 | Açık akış sayısı < 2 | `MESGUL` |

Geçerse uç `UC_STREAM_ACCEPT` gönderir ve kareleri akıtır. İsteğin `want` değerleri yapılandırmanın `video` sınırlarına indirilir.

**Neden yalnız doğrudan:** Görüntü sürekli ve büyük bir akıştır. Kutu rölesinden geçerse kutu üst bilgiyi (kim, kime, ne kadar) sürekli görür ve kutunun bant genişliği dolar. Posta Kutusu zaten yalnız zarf taşır. Aynı evdeki uç ile işçi her zaman doğrudan bağlanır; evin dışından canlı izleme ise delik açma başarılıysa olur, değilse "Canlı görüntü şu an açılamıyor" denir.

**Çerçeve şifrelemesi:** Arama kodunun çerçeve biçimi (`worklet/media/frame.js`, `video.js`) kullanılır: aynı başlık, aynı parçalama, aynı sayaç ve tekrar penceresi. Tek fark AEAD'dir. Arama kodu bugün ChaCha20-Poly1305 (IETF, 12 baytlık nonce) kullanıyor; bu, kurucu belge §13.2 tablosunda yoktur. Uç akışı tablodaki XChaCha20-Poly1305'i kullanır (H7):

```
keyShare  = derive(pair, 'hf/uc-stream/')            // pair: uç ile alıcının çift sırrı (RFC-0003 §6.2)
mediaKey  = derive(keyShare, 'media', streamId, 0)    // frame.js: mediaKey(keyShare, callId = streamId, dönem = 0)
nonce12   = ssrc(4) ‖ dönem(2) ‖ sayaç(6)            // frame.js nonceOf; tele konmaz, başlıktan türetilir
nonce24   = nonce12 ‖ 12 sıfır bayt
çerçeve   = başlık(12) ‖ XChaCha20-Poly1305(mediaKey, nonce24, yük, AD = başlık)
```

- `frame.js`'e AEAD seçimi eklenir (`aead: 'xchacha'`). Uç akışı her zaman bu seçimle açılır; arama yolu bu RFC'yle değişmez. Etiket boyu (16 B) ve çerçeve boyu aynıdır.
- `nonce12` her çerçevede tekildir (sayaç 48 bit, `streamId` başına yeni anahtar). Sıfır dolgu güvenlidir: XChaCha20'nin alt anahtar türetmesi ilk 16 baytı alır, sayaç bu baytların içindedir.
- Görüntü izi (tip 1) H.264 karelerini `video.js` ile parçalar. Denetim izi (tip 2) anahtar kare isteği taşır.
- Kareler, aramaların kullandığı Noise oturumunun sırasız kanalından gider. Ayrı port, ayrı bağlantı yoktur.
- Her akış yeni `streamId`, dolayısıyla yeni anahtar alır. Bir akış en çok 24 saat sürer; işçi süre dolmadan yeni bir akış açar. Dönem 0'da kalır; 48 bitlik sayaç 24 saatte tükenmez.
- Kodlama: Android `MediaCodec` donanım kodlayıcısı, H.264 Baseline ya da Main. Kodlanmış kareler, aramadaki `MEDIA_OUT` yolunun aynısıyla Bare çekirdeğine geçer.
- **Ev ağına açık port yoktur.** IP kameralardan farkı budur: uçta RTSP sunucusu, web arayüzü ya da dinleyen soket çalışmaz.

**İşçi tarafı (yalnız Linux işçi):**

1. `hf.task.vision` sürekli görevi `params.sourceId = ucId` ile gelir. İşçi uçun aktif ve `class = 'uc'` olduğunu defterden denetler.
2. İşçi çekirdeği akışı açar, kareleri çözer ve denetçiye yerel IPC ile verir:

   | No | Ad | Yön | Gövde |
   |----|----|-----|-------|
   | 40 | `AKIS_AC` | İ → D | `{ taskId, sourceId, streamId, codec, width, height, fps }` |
   | 41 | `AKIS_KARE` | İ → D | `{ streamId, ts, key: bool, data: buffer }` |
   | 42 | `AKIS_KAPAT` | iki yön | `{ streamId, code }` |
   | 43 | `ANAHTAR_KARE_ISTE` | D → İ | `{ streamId }` |

3. Denetçi, yetki yardımcısına RFC-0007 §6.4 listesine eklenen `uc-akis-ag { taskId }` işlemini yaptırır: görev için yalnız geri döngü arayüzü olan bir ağ ad alanı (`hf-<taskId>`) kurulur ve içinde `havenfold-rtsp` başlatılır. `havenfold-rtsp`, MIT lisanslı mediamtx'in sabit sürümüdür; özeti `havenfold-node` bildiriminin `assets` listesindedir.
4. `havenfold-rtsp` yalnız `127.0.0.1:8554` adresini dinler ve kareleri denetçiden `/run/havenfold/gorev/<taskId>/akis.sock` Unix soketiyle alır.
5. Görev konteyneri aynı ad alanına katılır (`--network=ns:/run/netns/hf-<taskId>`) ve görüntüyü `rtsp://127.0.0.1:8554/<sourceId hex>` adresinden okur. Görev imajı IP kamera ile uç arasında fark görmez.
6. Ad alanında başka arayüz yoktur. Ev ağı, internet ve diğer görevler bu adrese ulaşamaz.

**Canlı izleme (üye telefonu):** Telefon aynı mesajlarla akışı açar ve kareleri arama ekranının görüntü çözücüsüyle gösterir. Kayıt yapılmaz; kayıt ayrı bir ürün özelliğidir (RFC-0002 §10).

### 11.6 Görünür izleme: `UC_STATUS` (0xE6)

```
UC_STATUS {
  ucId     : fixed16
  seq      : uint
  mode     : string
  camera   : { active: bool, streams: array<{ toId: fixed16, purpose: string }>, since: uint }
  battery  : { percent: uint, tempC: int, onAC: bool }
  thermal  : string ('normal' | 'kisildi' | 'durdu')
  sig      : fixed64                    // etiket 'hf/uc-status/'
}
```

- Bütün aktif **ebeveyn ve yetişkin** üyelere gider: kamera açılınca, kapanınca, alıcı değişince ve 15 dakikada bir. Doğrudan oturum ya da kutu emaneti (mühürlü).
- Yuva Hat'ta "Ev Makinesi" ve sohbet listesinin üstünde "Kamera açık: <uç adı> → <alıcılar>" satırı görünür. Bu satır kapatılamaz.
- Uçun kendi ekranında aynı bilgi sürekli yazar. Android'in kendi kamera göstergesi de yanar.
- Bu üçü birlikte kurucu belgenin ilke 7'sini ("yetişkin gizlice izlenemez") uç kamerada sağlar: evdeki her yetişkin kameranın açık olduğunu ve görüntünün kime gittiğini görür.

### 11.7 Sensör modu

- Uç, `UC_CONFIG.sensors` listesindeki sensörleri okur. Eşik aşımında olay üretir.
- Olaylar RFC-0001 §10'daki `REC_DROP` ile `kind = 'olaylar'` koleksiyonuna bırakılır. Bunun için koleksiyonun `writers` listesinde `device:<ucId>` bulunmalıdır; ebeveyn bunu `COLLECTION` olayıyla ekler (RFC-0003 §5.9). Uç olayları okuyamaz.
- Olay türleri: `hf.uc.hareket` (ivme eşiği), `hf.uc.isik` (aydınlık–karanlık geçişi), `hf.uc.yakinlik`, `hf.uc.basinc`. Gövde: RFC-0006 §4.2 alanları (`_v: 1`, `_t`, `_subj: 'device:<uç hex16>'`) + `sensor`, `value`.
- Her olay türü en çok dakikada bir bırakılır.
- Uçta rutin motoru çalışmaz (kurucu belge §8.6: telefonda ya da işçide).
- Deprem algılama bu RFC'nin konusu değildir; Acil ve Deprem ürününün RFC'si sensör modunu kullanabilir.

### 11.8 Ekran modu: `UC_SCREEN_PUSH` (0xE5)

Uç koleksiyon anahtarı almaz (kurucu belge §7.4). Ekranda gösterilecek her şeyi bir üye **kendisi seçerek** gönderir.

```
UC_SCREEN_PUSH {
  ucId    : fixed16
  fromId  : fixed16
  seq     : uint
  cards   : array<{ id: string, title: string, lines: array<string>, until: uint }>
  sig     : fixed64                     // etiket 'hf/uc-screen/'
}
```

- Gönderen `UC_CONFIG.screenFrom` ile eşleşmeli; değilse uç mesajı atar.
- Gövde en çok 32 KB, en çok 12 kart.
- Uç kartları yalnız bellekte tutar; `until` geçince ya da aynı gönderenden daha büyük `seq` gelince eskisini siler. Yeniden başlatmada kartlar silinir.
- Telefon gönderirken uyarır: "Bu kart evdeki ekranda, odadaki herkesin göreceği şekilde gösterilecek."
- Ekran ayrıca kendi bilgisini (saat, bağlantı durumu) gösterir.
- Taşıma: doğrudan oturum ya da kutu emaneti (mühürlü).

### 11.9 Uç ne yapabilir, ne yapamaz

| | Uç | İşçi |
|-|----|------|
| Görev çalıştırma | Hayır. `TASK` gelirse `TASK_REJECT { code: 'DESTEK_YOK' }`. | Evet |
| Koleksiyon okuma | Hayır | Hayır (yalnız görevin dosyaları) |
| Koleksiyona yazma | Yalnız sensör modunda, `olaylar` koleksiyonuna, bırakma anahtarıyla | Yalnız sürekli görevde, aynı kuralla |
| Görüntü kaynağı | Evet, yalnız `UC_CONFIG` alıcılarına | Görüntüyü işler |
| Emanet, yedek, kasa payı | Hayır | Linux'ta evet (RFC-0004 kurallarıyla) |
| Oy, olay imzalama | Hayır (H3). Yalnız kendi `DEVICE_DETACH`'ı | Aynı |
| Koordinatör olma | Hayır | Evet |
| Dosya tutma | Hayır | Evet |

### 11.10 Play kuralları

| Kural | Uygulama |
|-------|----------|
| Ön plan servisi türleri | `camera` ve `specialUse` bildirilir. `specialUse` için `PROPERTY_SPECIAL_USE_FGS_SUBTYPE` gerekçesi: "Aile cihazları arasında uçtan uca şifreli bağlantıyı açık tutan ev cihazı modu". Play Console'daki ön plan servisi beyanı videoyla yapılır. |
| Kamera kullanımı | Belirgin açıklama ekranı (kamera ne için, görüntü nereye gider, kim görür) izin isteğinden önce gösterilir. Kalıcı bildirim kapatılamaz. |
| Gizli izleme yasağı | Uç modu yalnız törenle eklenmiş, ayrılmış bir cihazda açılır. Uygulama simgesi gizlenmez, bildirim gizlenmez, ekran göstergesi kapatılamaz. Kamera açıkken bütün yetişkinler `UC_STATUS` görür. |
| Pil iyileştirme muafiyeti | İzin istenmez; ayar ekranına yönlendirilir (§11.2). |
| Tam ekran bildirim | `USE_FULL_SCREEN_INTENT` kullanılmaz (Android 14'te arama ve alarm uygulamalarıyla sınırlı). |
| Uzaktan kod | Yok. Uç modu uygulamanın içinde gelir. |
| Veri güvenliği formu | Görüntü geliştiriciye (Eser'e) gitmez; "toplanmaz" doğru beyandır. Görüntü yalnız ailenin kendi cihazları arasında, uçtan uca şifreli gider. |
| Hedef API | Play'in yıllık hedef API kuralı izlenir. |
| Metin | Kurucu belge §16.2: Play malzemesinde ve Android uygulama içi metinlerde iPhone, iOS, Apple geçmez. |
| Aile politikası | Uç modu çocuk hesaplı cihazda açılmaz; kurulum ekranı ebeveyn biyometrisi ister. |

### 11.11 iOS

- iPhone ve iPad **hiçbir zaman kamera ya da sensör uç olmaz.** iOS kamerayı ve sensörleri arka planda çalıştırmaz (kurucu belge §3, 09 §1.4).
- Eski bir iPhone ya da iPad yalnız **ekran** modunda uç olabilir:
  - `DEVICE_ATTACH { class: 'uc' }`, `NODE_PROFILE.runtime = 'ios-ekran'`, `ucModes = ['ekran']`.
  - Yalnız uygulama ön plandayken çalışır. Ekran açık kalır (`isIdleTimerDisabled`). Kurulum Yönlendirmeli Erişim'i önerir.
  - Arka plana geçince çevrimdışı sayılır; `UC_SCREEN_PUSH` emanette bekler.
- Üyenin kendi telefonu uç olamaz (tek kimlik kuralı).
- App Store malzemesinde ve iOS uygulama içi metinlerde Android, Google, Play geçmez (§16.2).

> **Açıklama 1 (25 Ekim 2026, inceleme L1):**
> 1. **Görünür izleme çekirdekte zorunludur:** uç, güncel bir `UC_STATUS` (kamera açık, alıcılar) üretip yayınlamadan hiçbir kareyi mühürlemez; akış kabulü `UC_STATUS` baytlarını da döner (§11.6, ilke 7).
> 2. **Sıra numaraları kalıcı ve monotondur:** `UC_STATUS`, `NODE_PROFILE` ve yapılandırma `seq`'leri cihazda saklanır, yeniden başlayınca kaldığı yerden artar. Uç saklanan son geçerli `UC_CONFIG`'i yeniden başlayınca geri yükler; eski `seq`'li yapılandırma reddedilir.
> 3. **`UC_STATUS.configSeq`** alanı eklenir: izleyen ve yapılandıran taraf güncel yapılandırmayı buradan öğrenir; ebeveyne "uygulandı / uygulanmadı" bilgisi bununla döner.
> 4. **Akış ömrü sürekli denetlenir:** izin penceresi (`windows`) bitince, ısı ya da pil durdurunca, defter değişince (izleyici çıkarıldı ya da rolü değişti, işçi ayrıldı) açık akış kapanır. Yapılandırmayı imzalayan ebeveyn defterden çıkınca yapılandırma yeni imzaya kadar geçersizdir ve uç `kapali`'ya geçer.
> 5. **Ters yön:** alıcıdan uca giden her çerçeve (anahtar kare isteği, denetim izi) ayrı `ssrc` ve yön etiketiyle türetilmiş ayrı anahtar kullanır; aynı anahtar iki yönde kullanılmaz.
> 6. **`UC_STATUS`'ta `yenidenBasladi`** (dokunulması gerekiyor, §11.2) durumu vardır.
> 7. Aynı `streamId` ile ikinci `UC_STREAM_OPEN` reddedilir; `ciftSirri` zorunludur (tören anahtarsız çift sırrına inilmez).

> **Açıklama 2 (25 Ekim 2026, inceleme L3):**
> 1. **Sensör modu görünürdür:** `UC_STATUS` açık sensörleri ve olayların gittiği koleksiyonları taşır; telefonlar "Sensör açık" satırını kamera satırı gibi gösterir (ilke 7). Hedef koleksiyon yapılandırmada açıkça seçilir; uç olayları yalnız oraya yazar. Hedef koleksiyonun okuyucuları evin bütün ebeveyn ve yetişkinlerini kapsamalıdır; kapsamıyorsa yapılandırma reddedilir. Hedef değişince `UC_STATUS` yeniden yayınlanmadan olay yazılmaz.
> 2. **Ekran kartı sırası** gönderen telefonda `max(son + 1, şimdiki ms)`'dir; telefon verisi silinse de kartlar eski sayılmaz.
> 3. **Yetki her çağrıda denetlenir:** sensör olayı, ekran kartı alma ve gösterme, yapılandırmayı imzalayan ebeveynin ve kart gönderenin hâlâ yetkili olduğunu her seferinde sorar (açıklama 1 madde 4'ün bu modlara uygulanışı).
> 4. Ekran kartında §11.8 uyarısı kart gönderilmeden önce gösterilir; SDK uyarı onayı olmadan imzalamaz.

## 12. Numaralar

| Tür | Numara |
|-----|--------|
| Zarflar | `0xE0 NODE_PROFILE`, `0xE1 UC_CONFIG`, `0xE2 UC_STREAM_OPEN`, `0xE3 UC_STREAM_ACCEPT`, `0xE4 UC_STREAM_CLOSE`, `0xE5 UC_SCREEN_PUSH`, `0xE6 UC_STATUS`, `0xE7 APP_WIPE_REPORT` |
| Emanet mührü | RFC-0003 §6.4'teki K12 mühür kuralı `0xE0–0xE7` aralığının tamamını kapsar: bu aralıktaki bir zarf emanet yolundan geçecekse aynı mühürle (`derive(pair, 'ctrl')`, AD = gönderen ‖ alıcı ‖ tür ‖ zarf id) kapatılır; `CTRL_TYPES` bunları kapsar. Bugün emanetten geçebilenler `UC_CONFIG`, `UC_SCREEN_PUSH`, `UC_STATUS` ve `APP_WIPE_REPORT`'tur. `NODE_PROFILE` ve `UC_STREAM_*` yalnız doğrudan oturumdadır; emanetten gelirlerse atılır. Posta Kutusu'na hiçbiri gitmez. |
| Etiketler | `hf/node-profile/`, `hf/uc-config/`, `hf/uc-stream-open/`, `hf/uc-stream/` (türetme), `hf/uc-screen/`, `hf/uc-status/`, `hf/app-wipe-report/`, `hf/app-wipe-report-id/`, `hf/tepsi-veri/` (türetme) |
| Yerel IPC türleri | 40–43 (RFC-0007 §6.2'nin bu RFC'ye ayırdığı 40–49 aralığından); 44–49 boş |
| Olay türleri | `hf.uc.hareket`, `hf.uc.isik`, `hf.uc.yakinlik`, `hf.uc.basinc`; kayıt türü `hf.wipe.report` alanı `kind` |
| Defter olayı, HELLO biti | Yok |
| Çekirdek komutları | **340–349** bu RFC'nindir: `340 EDGE_BECOME` (`becomeEndpoint`), `341 EDGE_CONFIGURE` (`configure`), `342 EDGE_STATUS` (`status`), `343 EDGE_WATCH` (`watch`), `344 EDGE_WATCH_CLOSE`, `345 EDGE_CARD_SEND` (`pushCards`), `346 TRAY_PROFILE` (`profile`), `347 APP_WIPE_REPORTS` (`appWipeReports`), `348 APP_DATA_WIPE` (cihazdaki iki taraflı onay). `349` ayrılmış, boş. |

`KARARLAR.md`'ye koda yazıldığı gün işlenir.

## 13. SDK yüzeyi (telefon)

```ts
interface Uc {
  becomeEndpoint(mode: 'kamera' | 'sensor' | 'ekran'): Promise<void>      // bu cihazı uç yap (tören sonrası)
  configure(ucId, cfg: UcConfig): Promise<void>                            // ebeveyn; biyometri
  status(ucId): Promise<UcStatus | null>
  watch(ucId): Promise<StreamHandle>                                       // canlı izleme
  pushCards(ucId, cards: Card[]): Promise<void>
  on('status', (ucId, s: UcStatus) => void)
}
interface Tepsi {
  profile(nodeId): Promise<NodeProfile | null>
  appWipeReports(): Promise<AppWipeReport[]>
}
```

## 14. Test vektörleri

`protocol/vectors/edge.json`:

1. `NODE_PROFILE` kodlaması ve imzası.
2. Yerleştirme: `output: 'pdf'` isteyen OCR → tepsi işçisi aday değil; `metin` → aday; `audio/mp4` ses → tepsi işçisi aday değil; profil göndermeyen cihaz → Linux listesi.
3. Kasa payı adaylığı: `runtime = 'windows-yerel'` → aday değil; `linux-konteyner` + `muhur-ok` → aday; `linux-konteyner` + `var` → aday değil.
4. `UC_CONFIG`: geçerli; yetişkin imzası → `UNAUTHORIZED`; `device:` hedefi bir uç → `INVALID_TARGET`; `rol:cocuk` → `INVALID_TARGET`; 30 kare/sn → `INVALID_BODY`; eşit `seq`'li iki yapılandırmanın her iki geliş sırasında da aynı sonuca varılması.
5. `UC_STREAM_OPEN` denetim tablosu: her satır için girdi → `code`.
6. Akış anahtarı: verilen `pair` ve `streamId` için `keyShare`, `mediaKey`, `nonce24` ve bir görüntü parçasının XChaCha20-Poly1305 ile mühürlü çerçevesi; başlığı değiştirilmiş çerçeve → açılmaz.
7. `APP_WIPE_REPORT` kodlaması, imzası, `appWipeReportHash`; `result` kuralı (`dpapi` → `dogrulanamadi`; bir öğe başarısız → `hata`).
8. `UC_SCREEN_PUSH`: `screenFrom` dışından → atılır; 33 KB → atılır.
9. Uç `TASK` alır → `TASK_REJECT { code: 'DESTEK_YOK' }`.

Platform sınamaları (vektör değil, CI'da gerçek cihazda): §6.4'teki kum havuzu sınaması Windows ve macOS'ta; Android'de `camera` türü ön plan servisinin açılış davranışı.

## 15. Güvenlik değerlendirmesi

| Tehdit | Önlem |
|--------|-------|
| Bilgisayardaki kötü amaçlı yazılım görev verisini okur | Konteynersiz işçi yalnız kendisine verilen işi görür (T3 ile aynı sınır). Yönetici yetkili yazılıma karşı koruma yoktur; bu tören ve ilk kullanım onayında söylenir. Kasa payı ve kasa verisi bu cihaza hiç gitmez. |
| Görev sarmalayıcısı istismar edilir (bozuk PDF, bozuk ses) | Ağ kapalı, alt süreç yok, dosya sistemine yol erişimi yok, bellek ve süre sınırı. Sarmalayıcılar bildirimdeki özetle ve işletim sistemi imzasıyla doğrulanır. |
| Kum havuzu sessizce çalışmaz (yanlış yapılandırma) | §6.4 sınaması kurulumda ve her güncellemede; başarısızsa görevler kapanır. |
| Tepsi güncellemesi ele geçirilir | Bildirim özeti **ve** işletim sistemi imzası birlikte; beklenen imzalayan paketin içinde sabit. |
| Emeklilikte veri kalır | Veri uygulama düzeyinde şifreli; sarma anahtarı donanımdan silinir. Kalıntılar (`residue`) dürüstçe raporlanır; rapor "cihazın kendi beyanı" etiketini taşır. |
| Sahte "silindi" raporu | Rapor cihazın kendi anahtarıyla imzalıdır; ele geçirilmiş bir cihaz yalan söyleyebilir. Bu yüzden rapor `WIPE_REPORT`'tan ayrı bir türdür ve arayüz bunu açıkça yazar. İki taraflı onay, raporun ebeveynsiz üretilmesini önler. |
| Yetkisiz biri uç kamerayı izler | Akışı yalnız ebeveyn imzalı `UC_CONFIG` hedefleri açabilir. Çocuk ve misafir hedef olamaz. |
| Ev ağındaki biri görüntüyü yakalar | Uçta açık port yok; görüntü Noise oturumunun içinde, çerçeve başına şifreli. İşçide RTSP adresi yalnız görevin ağ ad alanında, geri döngüde. |
| Yetişkin gizlice izlenir (ilke 7) | `UC_STATUS` bütün yetişkinlere; uç ekranında ve Android göstergesinde sürekli işaret; kapatılamayan bildirim. |
| İki ebeveyn çelişen yapılandırma yazar | `seq` ve gövde özetiyle belirlenimci birleşme (§11.4 madde 7). |
| Kutu uç görüntüsünü görür | Akış kutu rölesinden geçmez. Aynı cihazda kutu ve uç birlikte çalışmaz. |
| Çalınan uç | Ebeveyn `DEVICE_DETACH`; çift sırları geçersiz. Uçta koleksiyon anahtarı, emanet, pay yoktur. Uygulama verisi Keystore'a sarılı anahtarla şifrelidir. |
| Ekran kartları yanlış kişilere görünür | Kartı üye bilerek gönderir; uyarı metni; kartlar yalnız bellekte. |
| Uç sensörüyle olay seli | Tür başına dakikada bir; yalnız `olaylar` koleksiyonuna, bırakma anahtarıyla. |

## 16. Kurucu belgede değişecekler

| Bölüm | Değişiklik |
|-------|------------|
| §5.2 tablo | "Eski laptop (Windows/macOS, silinmeden)": İşçi "✓ yalnız OCR (metin) ve ses yazıya dökme, konteynersiz (RFC-0008)"; kutu "✓ yalnız sürekli açık onayıyla". "iPhone" satırı: Uç "yalnız eski cihaz, ekran modu, ön planda". "Eski Android telefon/tablet" notu: "Aynı cihazda kutu ve uç birlikte çalışmaz." |
| §6.7 | Eski Android uç kameranın IP kameradan farkı eklenir: topluluğa uç olarak eklenir, açık portu yoktur, görüntü yalnız `UC_CONFIG` hedeflerine Noise içinde gider. |
| §8.5 | Yerleştirme adaylığına `NODE_PROFILE.features` uyumu eklenir. |
| §8.7 son madde | "Windows ve macOS işçi Faz 3 RFC'si gelene kadar eklenemez" yerine: "Windows ve macOS işçi RFC-0008'e göre, yalnız imzalı yerel sarmalayıcılarla (OCR metin, ses) ve AppContainer / App Sandbox içinde, ağ kapalı çalışır." |
| §9.2 tablo, "Windows/macOS, silmeden" | Kurulum: imzalı MSI / noter onaylı `.pkg`; güncelleme bildirim özeti + işletim sistemi imzası. |
| §9.5 | "Eski Android'de" maddesi RFC-0008 §9'a bağlanır. İşletim sistemi silinmeyen cihazlar için `uygulama-verisi-silindi` raporu ve "cihazın kendi beyanı" etiketi eklenir. |
| §10.2 ve RFC-0004 §3.1 | Cihaz tarafına: "Tepsi uygulaması (Windows, macOS; işçi ya da kutu) pay tutmaz. Cihaz payı yalnız `runtime = 'linux-konteyner'` bildiren ve TPM mührü doğrulanmış düğümlerde olur. Eski Android kutu TPM'siz düğümdür ve pay tutmaz." |
| §11 | "Uç kamera akışı yalnız doğrudan bağlantıda; kutu rölesi ve Posta Kutusu kullanılmaz" satırı. |
| §13.1 | Yeni satırlar: "Uç kamera yetkisiz izlenir" ve "Konteynersiz işçide yönetici yetkili yazılım" (§15). |
| §13.2 "Protokolün içinde" | Tablo değişmez. Uç akışı XChaCha20-Poly1305 kullanır (§11.5). Not eklenir: "Yuva Hat'ın bugünkü arama çerçeveleri (`media/frame.js`) ChaCha20-Poly1305 (IETF) kullanıyor; bu tabloda yoktur. Varsayılan: arama yolu, protokolün bir sonraki arama sürümünde uç akışıyla aynı `aead: 'xchacha'` seçimine geçer; geçişe kadar mevcut durum bilinen bir istisnadır." (Varsayılan, değiştirilebilir.) |
| §13.2 "Protokolün dışında" | Eklenir: "İşletim sisteminin anahtar saklama ve paket imza mekanizmaları: Windows TPM anahtar sağlayıcısı (RSA-OAEP) ve DPAPI, Secure Enclave (P-256 ECIES), macOS anahtar zinciri, Android Keystore/StrongBox; Authenticode, Apple Developer ID imzası ve noter onayı." |
| §15.3 Yuva Kamera, Bakım | "Eski Android uç cihaz" ifadesi RFC-0008 §11'e bağlanır; mikrofon v1'de yoktur. |
| §16.2 | Play için ön plan servisi beyanı (`camera`, `specialUse`) ve kamera belirgin açıklaması zorunlu maddelere eklenir. |
| RFC-0002 §11.3 | "Faz 3 RFC'sinde tanımlanır" yerine RFC-0008'e bağlantı. |
| RFC-0003 §6.1 oturum tablosu | "Üye ↔ cihaz" satırına `NODE_PROFILE`, `UC_*`, `APP_WIPE_REPORT`. "Cihaz ↔ cihaz" satırına: "uç ile `UC_CONFIG` hedefi işçi arasında `UC_STREAM_*` ve akış kareleri". |
| RFC-0007 | İşlendi (taslaklar birlikte): IPC 40–43 (§6.3), yetki işlemi `uc-akis-ag` (§6.4), `NODE_HEALTH.platform.disk` değeri `uygulama-sifreli` (§11.1). |
| §6.5 | "0x80–0x9F aralığındaki bütün zarflar…" kuralı `0xE0–0xE7`'yi de kapsar. |
| Numara tablosu | Çekirdek komutları 340–349 bu RFC'nindir. |

## 17. Uygulama sırası

1. `NODE_PROFILE` (Linux düğümü dahil) ve telefonda yerleştirme özellik denetimi; kasa payı adaylık kuralı. Vektörler 1–3.
2. Android uç: `UC_CONFIG`, `UC_STATUS`, kamera modu, ön plan servisi ve açılış davranışı, Play beyanları. Vektör 4.
3. Akış: `UC_STREAM_*`, çerçeve şifrelemesi, canlı izleme. Vektörler 5–6.
4. Linux işçide uç kaynağı: IPC 40–43, `uc-akis-ag`, `havenfold-rtsp`; `hf.task.vision` ile uçtan uca deneme (Faz 3, Bakım ile birlikte).
5. Tepsi uygulaması iskeleti (Windows, macOS): servisler, IPC, depolama şifrelemesi, tören.
6. Kum havuzu, `hf-gorev-ocr`, `hf-gorev-ses`, §6.4 sınaması.
7. Tepsi kurulum, güncelleme, kaldırma; uyku ve kullanıcı etkinliği.
8. `APP_WIPE_REPORT` (tepsi, Android uç, iOS ekran). Vektör 7.
9. Sensör ve ekran modları; iOS ekran. Vektörler 8–9.
