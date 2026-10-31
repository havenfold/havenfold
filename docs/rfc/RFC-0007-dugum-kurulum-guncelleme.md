# RFC-0007 — Düğüm yazılımı, Kurulum USB'si, silme ortamı ve güncelleme

> Durum: **Onaylandı** (Kerem, 23 Ekim 2026) · 23 Ekim 2026 · Yazan: Havenfold çekirdek ekibi · Onay: Kerem
> Kurucu belge: §5.1, §5.2, §6.1, §6.4, §6.8, §9 (tamamı), §11, §13.1 (T1–T3, T7, T10, T11), §17.1.
> Bağımlılık: RFC-0002 (§4 `NODE_CAPS`, §11 çalıştırma ortamı, `hf.task.backup`), RFC-0003 (§6 oturum ve emanet mührü, §8 emeklilik ve silme raporu), RFC-0004 (§3.1 cihaz payı uygunluğu).
> Kod yeri: `havenfold/node` (denetçi, `havenfold` komutu, systemd birimleri, yetki yardımcısı), `havenfold/installer` (Kurulum USB'si ve silme ortamı), `havenfold/protocol/vectors/dugum.json`.

## 1. Sorun

Kurucu belge §9 düğüm yazılımının parçalarını ve ilkelerini sayıyor. Kod yazılabilmesi için şunlar eksik:

- Hangi sürecin hangi kullanıcıyla çalıştığı, hangi dosyaya dokunabildiği.
- Çekirdek ile denetçinin aynı makinede nasıl konuştuğu.
- Kurulum USB'sinin içinde tam olarak ne olduğu ve ilk açılışın törene nasıl vardığı.
- Silme ortamının diski nasıl tanıdığı, yöntemi nasıl seçtiği, raporu nasıl taşıdığı.
- Sürüm bildiriminin biçimi, kök anahtarın kendisinin nasıl döndürüleceği, sürüm düşürmenin nasıl onaylandığı.
- Sağlık bilgisinin hangi alanlarla, kime gittiği.

Bu RFC bunları tanımlar. Kapsam Linux düğümüdür (Kurulum USB'si ve var olan Ubuntu). Windows, macOS ve Android RFC-0008'dedir.

## 2. Öneri özeti

- Bir düğümde en çok dört uzun ömürlü süreç vardır: `havenfold-kutu`, `havenfold-isci` (çekirdekler, Bare), `havenfold-denetci` (Node 24 LTS) ve istek üzerine açılan kök yetkili `havenfold-yetki`. Her biri ayrı kullanıcıdır. Birleşik cihazda iki çekirdek ayrı kullanıcı, ayrı dizin, ayrı anahtar dosyasıyla çalışır.
- Çekirdekler denetçiyle Unix soketi üzerinden, uzunluk önekli `compact-encoding` çerçeveleriyle konuşur. Soketin karşı ucu çekirdek tarafından `SO_PEERCRED` ile doğrulanır.
- Kurulum USB'si, Ubuntu Server 24.04 LTS imajı + otomatik kurulum dosyası + imzalı düğüm paketi + imzalı sürüm bildirimi + silme ortamıdır. USB'de hiçbir sır yoktur. Varsayılan önyükleme seçeneği hiçbir şey silmez.
- TPM 2.0 varsa disk LUKS2 ile şifrelenir ve Clevis ile TPM'den açılır. Kurtarma anahtarı törenden sonra ebeveyn telefonuna geçer ve kasaya yazılır.
- Silme ortamı RAM'de, ağ kapalı çalışır. Rapor anahtarını kendisi üretir. Disk türüne göre sanitize yöntemi seçer. Raporu QR ile telefona verir.
- Sürüm bildirimi çevrimdışı Ed25519 kök anahtarıyla imzalanır. Kök anahtarın yerine geçecek yedek anahtarın özeti her bildirimde önceden taahhüt edilir. Böylece çalınan kök anahtar kendi yerine başka bir anahtar koyamaz.
- Sürüm numarası yalnız artar. Düşürme ve kanal değişimi ebeveyn imzalı `UPDATE_APPROVE` ister.
- Paketler ve görev imajları dosya olarak dağıtılır. Bir düğüm indirdiğini topluluk içindeki diğer düğümlere verebilir. Bütünlük her zaman imzalı bildirimdeki özetten gelir, kaynaktan değil.
- Sağlık bilgisi (`NODE_HEALTH`) yalnız ebeveynlere, yalnız canlı oturumda gider. Eser'e hiçbir telemetri gitmez.

## 3. Tanımlar ve kodlama

| Ad | Anlam |
|----|-------|
| **Düğüm** | `havenfold-node` paketinin kurulu olduğu Linux bilgisayar. Bir ya da iki kimlik taşır. |
| **Kimlik** | Kutu (`ADD_MEMBER { role: 'kutu' }`) ya da işçi (`DEVICE_ATTACH { class: 'isci' }`). Her kimlik bir çekirdek sürecidir. |
| **Birleşik cihaz** | İki kimliği birlikte taşıyan düğüm (kurucu belge §6.1). |
| **`hostId`** | Kurulumda üretilen rastgele 16 bayt. Aynı donanımdaki kimlikleri gruplar. Donanım seri numarasından türetilmez. |
| **Sürüm kodu** | `versionCode = MAJOR × 1 000 000 + MINOR × 1 000 + PATCH`. `MINOR` ve `PATCH` 1000'den küçüktür. |
| **Kök durumu** | Düğümün sakladığı `{ keyEpoch, rootPub, nextRootHash }` üçlüsü (§12.2). |
| **Silme ortamı** | Kurulum USB'sinin "Silme modu" seçeneğiyle açılan, RAM'de çalışan ortam. |

**Kodlama kuralları** RFC-0001 §3'teki gibidir: `compact-encoding`, en kısa `c.uint`, seçimli alanda `c.bool` varlık bayrağı, imza gönderilen baytlar üzerinden, özete giren tamsayılar `u64be`.

**İmzalı zarflar** RFC-0002 §3'teki düzeni izler:

- `body` = `sig` dışındaki alanların kodlaması;
- `sig = Ed25519(imzalayan, hash('<etiket>', familyId, body))`.

**Topluluğa bağlı olmayan imzalar** (sürüm bildirimi, kök döndürme) `familyId` içermez: `sig = Ed25519(kök, hash('<etiket>', body))`.

**Özetler:**

| Ne | Özet | Neden |
|----|------|-------|
| Düğüm paketi, `oci-archive` dosyası, ek ikili (`assets`) | `hash('hf/release-pkg/', dosya baytları)` (BLAKE2b-256, akışla hesaplanır) | Protokolün kendi özeti |
| OCI imaj kimliği | `sha256:` imaj özeti | Podman'ın kendi denetimi; protokol dışı araç mekanizması (kurucu belge §13.2) |
| Kurulum USB'si imajı (`.iso`) | SHA-256 | Kullanıcı herhangi bir araçla denetleyebilsin; protokol dışı |

## 4. Süreç modeli

### 4.1 Süreçler ve kullanıcılar

| Süreç | systemd birimi | Kullanıcı | Çalışma ortamı | Ne yapar | Ne yapamaz |
|-------|----------------|-----------|----------------|----------|------------|
| Kutu çekirdeği | `havenfold-kutu.service` | `havenfold-kutu` | Bare | Röle, emanet, zil, defter kopyası, kutu kimliği | Görev çalıştırmaz, işçi dizinini okuyamaz |
| İşçi çekirdeği | `havenfold-isci.service` | `havenfold-isci` | Bare | Görev denetimi (RFC-0002 §6.2), girdi çözme, sonuç şifreleme, işçi kimliği | Emanete ve kutu dizinine erişemez, konteyner başlatamaz |
| Denetçi | `havenfold-denetci.service` | `havenfold-denetci` | Node 24 LTS | Görev çalıştırıcı (Podman API'si), yedek deposu, sağlık ölçümü, güncelleme indirme ve doğrulama | Kimlik anahtarı görmez, defter tutmaz, kök yetkisi yoktur |
| Yetki yardımcısı | `havenfold-yetki.socket` + `.service` | `root` | Node 24 LTS, tek dosya | §6.4'teki sabit işlem listesi | Liste dışı hiçbir şey |
| Görev konteyneri | Podman, kullanıcı birimi | `havenfold-task` | OCI | RFC-0002 §11.1 | Ağ yok, kimlik yok |

**Neden çekirdek Bare, denetçi Node:** Çekirdek telefondaki kodun aynısıdır ve aynı yerel eklentilerle (`sodium-native`, `udx-native`) aynı ortamda çalışmalıdır (H2). Denetçi Mekan Edge Runtime'dan gelen TypeScript koddur ve Node ekosistemine (Podman API istemcisi, `systeminformation` benzeri ölçüm kodu) dayanır. İki çalışma ortamı da düğüm paketinin içinde gelir; sistemin Node'u kullanılmaz.

**Neden ayrı yetki yardımcısı:** Paket açma, sembolik bağ değiştirme, kamera ağ ad alanı, pil eşiği ve yeniden başlatma kök yetkisi ister. Denetçi internete çıkan ve dışarıdan dosya alan süreçtir. Ona kök yetkisi vermek yerine, girdisini kendisi doğrulayan küçük bir yardımcı yalnız gerektiğinde açılır.

**Gruplar:**

| Grup | Üyeler | Ne için |
|------|--------|---------|
| `havenfold-gorev` | `havenfold-isci`, `havenfold-denetci`, `havenfold-task` | Görev dizinleri (`/run/havenfold/gorev/`) |
| `havenfold-yonetim` | Kurulumun oluşturduğu yerel yönetici kullanıcı | `havenfold` komutunun soketleri |
| `tss` | `havenfold-kutu`, `havenfold-isci`, `havenfold-denetci` | `/dev/tpmrm0` |

### 4.2 Birleşik cihaz

- İki çekirdek iki ayrı kullanıcıyla çalışır. Dizinleri `0700`'dür; biri öbürünün anahtarını, defter kopyasını ya da kasasını okuyamaz.
- İkisi de TPM'yi kullanır, ama her biri yalnız kendi dizinindeki mühürlü nesneyi yükleyebilir. Mühürlü nesneyi okuyamayan süreç TPM'den onu açtıramaz.
- Tek denetçi ikisine de hizmet eder, ama her çekirdeğe ayrı soketten bağlanır ve bir çekirdeğin isteğini öbürünün verisine uygulamaz (§6.3).
- **Kurucu belgeden ayrılan nokta:** Kurucu belge §6.1 "tek törende iki kimlik birlikte eklenir" diyor. Bu RFC tören kodunu değiştirmez. Birleşik cihaz **tek kurulum oturumunda art arda iki tören** yapar: önce kutu (QR `kind = 1`), hemen ardından işçi (`kind = 2`). Her törenin kendi 5 resmi vardır. Telefon iki töreni aynı ekran akışında gösterir ve ikincisinde "Aynı cihazın işçi kimliği" yazar. Gerekçe: tören protokolüne yeni bir biçim eklemek, iki kez QR okutmaktan daha pahalı ve daha risklidir.
- Kurulum ekranı ve telefon, kurucu belge §6.1'deki dürüstlük notunu gösterir: "Bu cihazı ele geçiren biri kutu ve işçi kimliklerinin ikisine de ulaşabilir."

### 4.3 systemd birimleri ve sertleştirme

| Birim | Tür | Not |
|-------|-----|-----|
| `havenfold-denetci.service` | Sürekli | Önce başlar. |
| `havenfold-kutu.service` | Sürekli | `After=havenfold-denetci`. Yalnız kutu kimliği varsa etkin. |
| `havenfold-isci.service` | Sürekli | `After=havenfold-denetci`. Yalnız işçi kimliği varsa etkin. |
| `havenfold-yetki.socket` / `.service` | Soketle açılır, işi bitince kapanır | Kök. |
| `havenfold-ilk-acilis.service` | Tek seferlik, `tty1` | §9. Bitince kendini devre dışı bırakır. |
| `havenfold-ekran.service` | Sürekli, `tty1` | Durum ekranı ve tören QR'ı. |
| `havenfold-pil.service` | Tek seferlik, açılışta | Pil eşiğini yazar (§10). |
| `havenfold-luks-yenile.service` | Tek seferlik, açılışta | TPM bağını gerekirse yeniler (§8.5). |
| `podman.socket` | `havenfold-task` kullanıcı birimi (`loginctl enable-linger`) | Denetçinin kullandığı Podman API'si |

Çekirdek ve denetçi birimlerinde ortak sertleştirme:

```ini
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
DevicePolicy=closed
DeviceAllow=/dev/tpmrm0 rw  # yalnız TPM; başka aygıt yok
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
LockPersonality=yes
RestrictRealtime=yes
CapabilityBoundingSet=
AmbientCapabilities=
SystemCallFilter=@system-service
SystemCallArchitectures=native
UMask=0077
ReadWritePaths=/var/lib/havenfold/<kendi dizini> /run/havenfold/<kendi dizini>
```

- `MemoryDenyWriteExecute` kullanılmaz: V8'in JIT derleyicisi yazılabilir ve çalıştırılabilir bellek ister.
- Çekirdeklerde `RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6`. Denetçide aynı.
- **Bluetooth (afet modu):** Bluetooth donanımı olan düğümde, afet bağlarını yürüten çekirdeğin biriminde (RFC-0012 §6.4: birleşik cihazda kutu, tek kimlikli düğümde o kimlik) `AF_BLUETOOTH` eklenir. BlueZ'in D-Bus arayüzüne yalnız o kullanıcıya izin veren bir D-Bus politikası kurulur. Diğer birimlerde Bluetooth yoktur.
- Denetçi `ReadWritePaths` listesinde ayrıca `/var/lib/havenfold/yedek` ve `/run/havenfold/gorev` vardır.

## 5. Dosya düzeni ve izinler

| Yol | Sahip:grup | İzin | İçerik |
|-----|-----------|------|--------|
| `/opt/havenfold/surumler/<sürüm>/` | `root:root` | `0755`, dosyalar `0644`/`0755` | Paket: `bin/havenfold`, `bare`, `node`, çekirdek ve denetçi kodu |
| `/opt/havenfold/guncel` | `root:root` | sembolik bağ | Etkin sürüm |
| `/opt/havenfold/onceki` | `root:root` | sembolik bağ | Geri dönüş için bir önceki sürüm |
| `/usr/local/bin/havenfold` | `root:root` | sembolik bağ | `/opt/havenfold/guncel/bin/havenfold` |
| `/etc/havenfold/dugum.toml` | `root:root` | `0644` | Rol, kanal, pil eşikleri, bakım penceresi. Sır içermez. |
| `/var/lib/havenfold/kutu/` | `havenfold-kutu` | `0700` | `kimlik.tpm` ya da `kimlik.anahtar` (`0600`), `kasa/`, `defter/`, `emanet/`, `blob/` |
| `/var/lib/havenfold/isci/` | `havenfold-isci` | `0700` | `kimlik.tpm` ya da `kimlik.anahtar` (`0600`), `kasa/`, `defter/`, `gorev-kayit/` (görülen `taskId`'ler, RFC-0002 §6.2 madde 8) |
| `/var/lib/havenfold/denetci/` | `havenfold-denetci` | `0700` | `kok.durum`, `surum.durum`, `host.id`, `onbellek/` (paket, `oci-archive`, model), `saglik/` |
| `/var/lib/havenfold/yetki/` | `root:root` | `0700` | `luks-kurtarma` (yalnız teslimine kadar, §8.5) |
| `/var/lib/havenfold/yedek/kutu/`, `/yedek/isci/` | `havenfold-denetci` | `0700` | `hf.task.backup` blokları, kimlik başına ayrı |
| `/var/lib/havenfold/gorev-ev/` | `havenfold-task` | `0700` | Podman deposu (kök olmayan) |
| `/var/lib/havenfold/uygulama/<appId>/` | `hfapp-<özet>` | `0700` | Konteyner uygulamasının birimleri (RFC-0011 §7.3) |
| `/run/havenfold/gorev/<taskId>/` | `havenfold-denetci:havenfold-gorev` | `2770` (tmpfs) | `in/`, `out/`, `params` |
| `/run/havenfold/kutu/`, `/run/havenfold/isci/` | ilgili çekirdek | `0750` | Soketler (§6.1) |
| `/run/havenfold/denetci/` | `havenfold-denetci:havenfold-cekirdek` | `0750` | Çekirdeklerin bağlandığı soketler `kutu.sock`, `isci.sock` (RFC-0026 f) |
| `/run/havenfold/denetci-yonetim/` | `havenfold-denetci:havenfold-yonetim` | `2750` (setgid) | `yonetim.sock` (yönetim grubu çekirdeklerin dizinine giremez; RFC-0026 f). Denetçi yönetim grubunun üyesi değildir; soketin grubu setgid dizinden gelir (açılış güvenlik incelemesi, 25 Ekim 2026) |
| `/run/havenfold/yetki/` | `root:havenfold-denetci` | `0750` | Yetki yardımcısının dizini (RFC-0033) |
| `/run/havenfold/yetki/yetki.sock` | `root:havenfold-denetci` | `0660` | Yetki yardımcısı |
| `/boot/efi/EFI/havenfold/emekli.bilet` | `root:root` | ESP (FAT) | Yalnız emeklilikte (§13.1) |

**Kimlik anahtarı diskte:**

- TPM 2.0 varsa: Ed25519 gizli anahtarı (64 B), sahip hiyerarşisindeki saklama kökünün altında bir mühürlü veri nesnesidir (`tpm2-tss`, `TPM2_Create`). `kimlik.tpm` dosyası nesnenin açık ve kapalı yarısını tutar. PCR'a bağlı değildir (RFC-0004 §3.1 dürüst sınırıyla aynı). Çekirdek açılışta `TPM2_Load` + `TPM2_Unseal` ile anahtarı belleğe alır, `sodium_malloc` alanında tutar.
- TPM yoksa: `kimlik.anahtar` (`0600`) ham anahtardır. Bu durumda disk de şifresizdir (§8.5). Kurucu belge §9.2'deki sonuçlar geçerlidir.
- Kurulum, her kimlik için mühürle–aç–karşılaştır denemesi yapar. Sonuç `NODE_HEALTH.platform.tpm = 'muhur-ok'` olarak bildirilir. RFC-0004 §3.1'deki "mühürlemenin başarılı olduğu doğrulanmalı" koşulu budur.
- **Kasa payları** (`kasa/`) kimlik anahtarıyla aynı biçimde, kimliğin kendi dizininde, PCR'a bağlı olmayan ayrı mühürlü nesneler olarak durur (RFC-0004 §4.4). Disk şifrelemesinin PCR 7 bağı (§8.5) paylara ek bir koşul getirmez. TPM'siz düğüm pay tutmaz.

**Düz metin diske düşmez:** Görev girdileri ve çıktıları `/run/havenfold/gorev/` altında, tmpfs'tedir. Görev RAM'e sığmıyorsa ve disk LUKS'luysa `/var/lib/havenfold/tasma/<taskId>/` (`havenfold-denetci:havenfold-gorev`, `2770`) kullanılır ve görev bitince silinir. Disk şifresizse sığmayan görev `NO_SOURCE` ile reddedilir. Bu, RFC-0002 §11.1'deki "/work tmpfs; sığmazsa LUKS'lu diskte" kuralının girdi ve çıktıya genişlemesidir.

**Günlük:** Yalnız journald. Saklama 14 gün (`MaxRetentionSec=14day`). Günlüğe içerik, anahtar, dosya adı, kayıt alanı, üye adı yazılmaz; kimlikler ilk 4 baytlarıyla yazılır.

## 6. Yerel IPC

### 6.1 Soketler

| Soket | Dinleyen | Bağlanan | İzin |
|-------|----------|----------|------|
| `/run/havenfold/kutu/denetci.sock` | Denetçi | Kutu çekirdeği | `havenfold-denetci:havenfold-kutu 0660` |
| `/run/havenfold/isci/denetci.sock` | Denetçi | İşçi çekirdeği | `havenfold-denetci:havenfold-isci 0660` |
| `/run/havenfold/kutu/yonetim.sock` | Kutu çekirdeği | `havenfold` komutu | `havenfold-kutu:havenfold-yonetim 0660` |
| `/run/havenfold/isci/yonetim.sock` | İşçi çekirdeği | `havenfold` komutu | `havenfold-isci:havenfold-yonetim 0660` |
| `/run/havenfold/denetci-yonetim/yonetim.sock` | Denetçi | `havenfold` komutu | `havenfold-denetci:havenfold-yonetim 0660` |
| `/run/havenfold/yetki/yetki.sock` | Yetki yardımcısı | Denetçi, `havenfold` komutu (sudo ile) | `root:havenfold-denetci 0660` |

- Dinleyen taraf her bağlantıda `SO_PEERCRED` ile karşı ucun kullanıcı kimliğini okur. Beklenen kullanıcı değilse bağlantıyı kapatır. Yetki yardımcısı yalnız `havenfold-denetci` ve `root` kabul eder.
- Denetçi, bir soketten gelen isteği yalnız o soketin kimliğine uygular. Kutu soketinden gelen `YEDEK_OKU` yalnız `/var/lib/havenfold/yedek/kutu/` içine bakar.

### 6.2 Çerçeve

```
çerçeve = uzunluk (u32be) ‖ IPC_MSG
IPC_MSG { type: uint, reqId: uint, body: buffer }      // compact-encoding
```

- En büyük çerçeve 1 MiB. Daha büyük veri soketten geçmez; dosya olarak `/run/havenfold/gorev/<taskId>/` altına yazılır, IPC'de yalnız yolu gider.
- `reqId` isteği cevaba bağlar. Cevabı olmayan bildirimlerde 0'dır.
- Bu türler **zarf türü değildir**, ağa çıkmaz ve `zarf-turleri.js` ile çakışmaz. Ayrı ad alanıdır: `node/ipc/types.js`. 1–39 bu RFC'nindir, 40–49 RFC-0008'e ayrılır.

### 6.3 Mesajlar

| No | Ad | Yön | Gövde | Not |
|----|----|-----|-------|-----|
| 1 | `MERHABA` | Ç → D | `{ rol: 'kutu' \| 'isci', surum: string }` | Cevap: `{ hostId: fixed16, denetciSurum }` |
| 2 | `SAGLIK_ANLIK` | D → Ç | `{ olcum, caps }`: `NODE_HEALTH` ve `NODE_CAPS` için ölçümler (imzasız). `olcum` NODE_HEALTH'in kimlik, sıra, uyarı ve imza dışındaki alanları; `caps` UTF-8 JSON: NODE_CAPS'in ölçüm alanları ve kayıtlı imajlardan `tasks` (çekirdek kimliği, sırayı, durumu ve çalışan görevleri ekler) | 60 saniyede bir. Çekirdek bunları imzalayıp gönderir. |
| 3 | `GOREV_HAZIRLA` | İ → D | `{ taskId, type, version, limits, standing, sourceId? }` | Denetçi dizini kurar. |
| 4 | `GOREV_HAZIR` | D → İ | `{ taskId, dir: string, ok: bool, code: string }` | `code`: RFC-0002 §6.2 hata kodları |
| 5 | `GOREV_BASLAT` | İ → D | `{ taskId }` | Girdiler `dir/in/` içine yazılmış olmalı. |
| 6 | `GOREV_ILERLEME` | D → İ | `{ taskId, pct, note }` | En çok 10 saniyede bir |
| 7 | `GOREV_BITTI` | D → İ | `{ taskId, status, exitCode: int, log: string (≤ 4 KB) }` | Çıktı `dir/out/` içinde |
| 8 | `TASK_CANCEL` | İ → D | `{ taskId }` | |
| 9 | `GOREV_TEMIZLE` | İ → D | `{ taskId }` | Dizin silinir, konteyner kaldırılır. |
| 10 | `YEDEK_YAZ` | Ç → D | `{ blobId, path, size }` | Şifreli blok |
| 11 | `YEDEK_OKU` | Ç → D | `{ blobId }` | Cevap 13 |
| 12 | `YEDEK_SIL` | Ç → D | `{ blobId }` | |
| 13 | `YEDEK_CEVAP` | D → Ç | `{ blobId, ok, path }` | |
| 14 | `GUNCELLEME_BILDIRIMI` | Ç → D | `{ manifest: buffer }` | Ağdan gelen `UPDATE_HAVE` içeriği |
| 15 | `GUNCELLEME_ONAYI` | Ç → D | `{ approve: buffer, signerPub: fixed32, signerRole: string }` | Çekirdek defterden rolü doğrulamıştır; denetçi imzayı `signerPub` ile yeniden doğrular. |
| 16 | `GUNCELLEME_DURUM` | D → Ç | `{ state, pendingVersion, error }` | |
| 17 | `PAKET_ISTE` | D → Ç | `{ digest, size }` | Denetçi, paketi topluluktaki bir düğümden istemesini ister (§12.5). |
| 18 | `PAKET_PARCA` | Ç → D | `{ digest, offset, path }` | Gelen parça dosyaya yazılmıştır. |
| 19 | `RETIRE_STATUS` | Ç → D | `{ phase, retireNonce: fixed16 }` | `hazir` olunca denetçi bileti yazdırır (§13.1). |
| 20 | `KAYNAK_AG` | İ → D | `{ taskId, addr: string, port: uint }` | `hf.task.vision` için kamera ad alanı (RFC-0002 §11.1) |
| 21 | `DURDUR` | D → Ç | `{ neden: 'guncelleme' \| 'yeniden-baslatma' \| 'emeklilik' }` | Çekirdek oturumlarını düzgün kapatır. |
| 22 | `RECOVERY_KEY` | Ç → D | `{ istek: 'oku' \| 'sil' }` | Yalnız işçi ya da tek kimlikli düğümde kutu; §8.5 |
| 23 | `HATA` | iki yön | `{ reqId, code, detail }` | |
| 40–43 | `AKIS_AC`, `AKIS_KARE`, `AKIS_KAPAT`, `ANAHTAR_KARE_ISTE` | İ ↔ D | RFC-0008 §11.5 | Uç kamera akışı |

### 6.4 Yetki yardımcısının işlemleri

Yardımcı her isteği kendisi doğrular. Liste dışı işlem yoktur.

| İşlem | Girdi | Kendi denetimi |
|-------|-------|----------------|
| `paket-ac` | `{ surum, dosya, ozet }` | Dosyanın özetini yeniden hesaplar; `kok.durum` ile imzalı bildirimi kendisi yeniden doğrular; hedef dizin yoksa açar. |
| `surum-gec` | `{ surum }` | Dizin var ve doğrulanmış olmalı. `guncel` ve `onceki` bağlarını atomik değiştirir (`rename`), birimleri yeniden başlatır. |
| `surum-geri` | — | `onceki` bağına döner. |
| `kamera-ag` / `kamera-ag-sil` | `{ taskId, addr, port }` | Adres özel ağ aralığında olmalı (RFC 1918, ULA). Ad alanı `hf-<taskId>`, nftables yalnız bu adres ve porta izin verir. |
| `pil-esigi` | `{ start, stop }` | `40 ≤ start < stop ≤ 100` |
| `yeniden-baslat` | `{ neden }` | Kayda yazar, `systemctl reboot` |
| `efi-bilet-yaz` / `efi-bilet-sil` | `{ bilet: buffer ≤ 512 B }` | Biçim `HFRT1` olmalı (§13.1) |
| `usb-yaz` | `{ aygit, iso }` | Aygıt çıkarılabilir olmalı, sistem diski ya da bağlı bir bölüm olmamalı; ISO'nun SHA-256'sı bildirimdeki değerle eşleşmeli; yazdıktan sonra geri okuyup karşılaştırır. |
| `smart-oku` | — | `smartctl -j` ve `nvme smart-log -o json` çıktısını ayrıştırıp döner; seri numarasını çıkarır. |
| `luks-kurtarma` | `{ istek: 'oku' \| 'sil' }` | §8.5 |
| `uc-akis-ag` / `uc-akis-ag-sil` | `{ taskId }` | Uç kamera akışı için yalnız geri döngü arayüzlü ad alanı `hf-<taskId>` ve içinde `havenfold-rtsp` (RFC-0008 §11.5). İkilinin özeti bildirimin `assets` listesinde olmalı. |
| `uygulama-kur` / `uygulama-sil` | `{ appId, grants }` | Uygulama kullanıcısı `hfapp-<özet>`, iç veth çifti, `internet` ve `lan` kipleri, nftables kuralları, aygıt udev kuralı (RFC-0011 §8). `grants`, çekirdeğin doğruladığı `APP_CMD`'nin alt kümesi olmalı; yardımcı izin listesi dışında hiçbir ağ ya da aygıt kuralı yazmaz. |
| `afet-ag` | `{ acik: bool, tcpPort }` | Afet modu HAZIR ya da ETKİN iken yerel alt ağdan UDP `239.255.72.70:47870` ve verilen TCP portu için gelen kuralı açar; kapanınca siler (RFC-0012 §6.6). |

## 7. `havenfold` komutu

Yerel yönetici kullanıcı `havenfold-yonetim` grubundadır. Kök gerektiren komutlar `sudo` ister.

| Komut | Yetki | Ne yapar |
|-------|-------|----------|
| `havenfold durum` | grup | Roller, kimliklerin kısa hâli, topluluğa bağlı mı, defter düzeyi, açık oturum sayısı, çalışan görevler, sağlık uyarıları, sürüm ve kanal, TPM ve disk şifreleme, pil sınırı. |
| `havenfold katil [--rol isci\|kutu\|birlesik]` | grup | Töreni başlatır. QR'ı terminalde yarım blok karakterlerle çizer, 60 saniyede yeniler. 5 resmin adını metin olarak yazar. Birleşik rolde iki töreni art arda yürütür (§4.2). |
| `havenfold kur [--rol …] [--kanal kararli\|deneme] [--laptop evet\|hayir]` | sudo | Var olan Ubuntu Server 24.04'e kurulum (§8.6). Diski silmez. |
| `havenfold emekli` | grup | Emeklilik durumunu gösterir: taşınacak emanet, dosya, pay sayısı. Emekliliği **başlatmaz**; başlatma yalnız ebeveyn telefonundandır (H3). Durum `hazir` olunca silme adımlarını yazar. |
| `havenfold usb-hazirla <aygıt>` | sudo | Etkin sürümün Kurulum USB'si imajını önbellekten (yoksa indirerek) doğrular ve yazar. |
| `havenfold sil-usb-hazirla <aygıt>` | sudo | `usb-hazirla` ile aynı imajı yazar. Ek olarak emeklilik durumunun `hazir` olduğunu denetler, bileti ESP'ye yazar ve "yeniden başlatın, menüden **Silme modu**nu seçin" yönergesini gösterir. Durum `hazir` değilse yazmaz. |
| `havenfold guncelle [--denetle\|--simdi]` | sudo | Bildirimi hemen denetler; `--simdi` doğrulanmış ve daha yüksek bir sürümü bakım penceresini beklemeden kurar. Sürüm düşürmez. |
| `havenfold geri-al` | sudo | Yalnız ebeveyn onayı varsa önceki sürüme döner (§12.3). |
| `havenfold kanal` | grup | Kanalı gösterir. Değişiklik ebeveyn telefonundan yapılır. |
| `havenfold pil [--esik 60-80]` | sudo | Pil durumunu gösterir, eşiği değiştirir. |
| `havenfold wifi` | sudo | Kablolu ağ yoksa Wi-Fi ağı seçtirir, parolayı yerelde sorar (§9). |
| `havenfold gunluk [--saat N]` | grup | Journald kayıtlarını içerik olmadan gösterir. |
| `havenfold tani --cikti <dosya>` | sudo | Sorun bildirmek için **yerel** bir tanı dosyası üretir: sürümler, sağlık, son 24 saatin hata kodları. İçerik, kimlik, IP yoktur. Dosyayı kimseye kendisi göndermez (ilke 6). |
| `havenfold kok-sabitle <dosya>` | sudo, yerel konsol | §12.2'deki son çare: kök durumunu elle değiştirir. Uzaktan yolu yoktur. |
| `havenfold kaldir` | sudo | Yalnız var olan Ubuntu kurulumunda ve yalnız kimlik topluluktan çıkarılmışsa ya da hiç katılmamışsa: birimleri, kullanıcıları ve `/var/lib/havenfold`'u siler. Bu sanitize değildir; ekranda yazar. |
| `havenfold surum` | herkes | Paket, çekirdek, denetçi, kök anahtar parmak izi. |

Çıkış kodları: `0` tamam, `1` kullanım hatası, `2` yetki yok, `3` durum uygun değil, `4` ağ, `5` doğrulama başarısız.

## 8. Kurulum USB'si

### 8.1 İçerik

Tek imaj, iki mod: kurulum ve silme. Adı `havenfold-kurulum-<sürüm>-amd64.iso`. En az 8 GB USB bellek.

| Yol | İçerik |
|-----|--------|
| `/` | Ubuntu Server 24.04.x LTS canlı kurulum imajı (Canonical'ın imzalı `shim`, `grub` ve çekirdeği değiştirilmeden) |
| `/nocloud/user-data`, `/nocloud/meta-data` | Otomatik kurulum dosyası (§8.3); `meta-data` boş |
| `/havenfold/havenfold-node-<sürüm>-amd64.tar.zst` | Düğüm paketi |
| `/havenfold/bildirim.bin` | Kök anahtarla imzalı sürüm bildirimi (§12.1) |
| `/havenfold/kok.durum` | `{ keyEpoch, rootPub, nextRootHash }` ve varsa kök döndürme zinciri (§12.2) |
| `/havenfold/deb/` | Çevrimdışı kurulum için Ubuntu paketleri: `podman`, `uidmap`, `slirp4netns`, `clevis`, `clevis-luks`, `clevis-tpm2`, `clevis-initramfs`, `tpm2-tools`, `smartmontools`, `nvme-cli`, `nftables`, `wpasupplicant`. Özetleri bildirimin `installerDebs` listesindedir. |
| `/havenfold/bin/` | `hf-on-kontrol`, `hf-depolama-yaz`, `hf-hedefe-kur` (kurulum betikleri) |
| `/silme/vmlinuz`, `/silme/initrd`, `/silme/kok.squashfs` | Silme ortamı (§13.2). Çekirdek Ubuntu'nun imzalı çekirdeğidir. |
| `/boot/grub/grub.cfg` | Menü (§8.2) |

**USB'de olmayanlar:** Topluluk sırrı, davet, jeton, Wi-Fi parolası, SSH anahtarı, kullanıcı parolası, disk parolası. Kurucu belge HF13 ve §6.4 geçerlidir. İmaj her düğüm için aynıdır; kişiye özel imaj üretilmez.

**Görev imajları USB'de yoktur.** Boyutları büyüktür ve sürümleri USB'den hızlı değişir. Kurulumdan sonra indirilir (§12.5).

### 8.2 Önyükleme menüsü

| Sıra | Seçenek | Ne yapar |
|------|---------|----------|
| 1 (varsayılan, 15 sn) | **Diskten başlat** | Hiçbir şey silmez. USB yanlışlıkla takılı kaldıysa bilgisayar normal açılır. |
| 2 | **Havenfold kur — bu bilgisayarın diski SİLİNİR** | `autoinstall ds=nocloud;s=/cdrom/nocloud/` |
| 3 | **Havenfold silme modu — emeklilik** | Silme ortamını RAM'e yükler (§13.2) |

Yıkıcı seçenekler hiçbir zaman varsayılan değildir.

### 8.3 Otomatik kurulum dosyası (iskelet)

```yaml
#cloud-config
autoinstall:
  version: 1
  interactive-sections: []
  refresh-installer: { update: false }
  locale: tr_TR.UTF-8
  keyboard: { layout: tr }
  timezone: Europe/Istanbul
  source: { id: ubuntu-server-minimal }
  network:
    version: 2
    ethernets:
      kablolu: { match: { name: "en*" }, dhcp4: true, dhcp6: true, optional: true }
  apt:
    fallback: offline-install
  drivers: { install: false }
  ssh: { install-server: false }
  updates: security
  user-data:                                 # identity yerine; parola yok, ilk açılışta belirlenir
    hostname: havenfold-XXXX                 # hf-on-kontrol rastgele 4 onaltılık hane yazar
    users:
      - name: yonetici
        groups: [sudo]
        lock_passwd: true
        shell: /bin/bash
  early-commands:
    - /cdrom/havenfold/bin/hf-on-kontrol      # §8.4: donanım, pil, disk seçimi, "SIL" onayı, TPM algılama
    - /cdrom/havenfold/bin/hf-depolama-yaz    # /autoinstall.yaml'a storage bölümünü ve geçici LUKS parolasını yazar (yalnız RAM)
  late-commands:
    - /cdrom/havenfold/bin/hf-hedefe-kur /target   # paket doğrulama ve açma, kullanıcılar, birimler, laptop ayarları, Clevis
    - curtin in-target -- /opt/havenfold/guncel/bin/havenfold ilk-ayar --kurulum
    - /cdrom/havenfold/bin/hf-hedefe-kur --gunluk-temizle /target   # kurulum günlüklerinden geçici parolayı içeren dosyaları siler
  shutdown: reboot
```

`hf-depolama-yaz`'ın yazdığı bölüm (TPM varsa):

```yaml
  storage:
    layout:
      name: lvm
      match: { serial: "<seçilen diskin seri numarası>" }
      password: "<kurulum ortamının RAM'inde üretilen 32 baytlık rastgele parola, base32>"
```

TPM yoksa aynı bölüm `password` olmadan yazılır.

- Subiquity, `early-commands` bittikten sonra `/autoinstall.yaml`'ı yeniden okur. Bu sayede parola USB'ye hiç yazılmadan yalnız kurulum ortamının belleğinde kalır.
- `updates: security` kurulum sırasında yalnız güvenlik güncellemelerini alır. Ağ yoksa kurulum çevrimdışı sürer.
- `drivers: { install: false }`: kapalı sürücü kurulmaz. Kapalı sürücü isteyen Wi-Fi kartlarında kablolu ağ gerekir. Kurulum ekranı bunu söyler.

### 8.4 Ön kontrol (`hf-on-kontrol`)

`tty1`'de, kurulumdan önce çalışır. Bir adım tutmazsa kurulum durur ve bilgisayar 60 saniye sonra kapanır.

| # | Denetim | Tutmazsa |
|---|---------|----------|
| 1 | İşlemci x86-64 ve `x86-64-v2` | "Bu işlemci desteklenmiyor." |
| 2 | RAM ≥ 4 GB | Durur. 4–8 GB arası "işçi hafif çalışır" uyarısıyla geçer. |
| 3 | En az bir iç disk ≥ 64 GB | Durur. |
| 4 | **Pil görsel kontrolü** (pil varsa): "Kasada kabarma, touchpad'in yükselmesi, kapağın tam kapanmaması var mı? (E/H)" | `E` → "Şişmiş pilli cihaz eklenmez. Pili çıkarın ya da cihazı kullanmayın." Durur (kurucu belge §9.6). |
| 5 | Hedef disk seçimi: USB ve çıkarılabilir diskler hariç; tek iç disk varsa o; birden çoksa NVMe, sonra SSD, sonra en büyük | Seçilen disk ekranda model, boyut ve son 4 seri hanesiyle yazar. |
| 6 | **Onay:** "Bu disk tamamen silinecek. Devam etmek için SIL yazın." 120 saniye | Yanlış ya da süre dolarsa durur. |
| 7 | TPM 2.0 algılama (`/sys/class/tpm/tpm0/tpm_version_major = 2`) ve basit bir mühürle–aç denemesi | TPM yoksa ekranda: "Disk şifrelenmeyecek. Bu cihaz kasa payı tutmayacak. Çalınırsa kimliği ve emanet üst bilgisi açığa çıkar; içerik çıkmaz." Kullanıcı `TAMAM` yazınca sürer. |
| 8 | Birden çok iç disk varsa | Diğer diskler kurulumda dokunulmadan kalır. Ekranda yazar. |

### 8.5 Disk şifreleme ve kurtarma anahtarı

**TPM varsa:**

1. Kurulum, LUKS2 + LVM düzenini geçici parolayla kurar (§8.3).
2. `hf-hedefe-kur`, Clevis ile TPM bağı ekler. Kurulum ortamı USB'den açıldığı için ilk bağ **PCR'sız** yapılır: `clevis luks bind -d <luks> tpm2 '{}'`.
3. **İlk açılışta** (`havenfold-luks-yenile.service`): diskten açılmış sistemde bağ PCR 7'ye taşınır (`clevis luks regen` yerine yeni bağ + eskisinin kaldırılması). 32 baytlık rastgele bir **kurtarma anahtarı** yeni bir anahtar yuvasına eklenir. Geçici parolanın yuvası silinir. Kurtarma anahtarı `/var/lib/havenfold/yetki/luks-kurtarma` (`0600`, kök) dosyasına yazılır.
4. Tören bitince işçi çekirdeği (tek kimlikli kutuda kutu çekirdeği) kurtarma anahtarını denetçi ve yetki yardımcısı üzerinden okur ve **töreni yapan ebeveynin telefonuna** `NODE_RECOVERY` (0xDE) ile, yalnız doğrudan Noise oturumunda gönderir.
5. Telefon anahtarı **Kasa** koleksiyonuna `hf.node.luks-kurtarma` kaydı olarak yazar. Kasa koleksiyonu yoksa **Ebeveynler** koleksiyonuna yazar ve kasa kurulunca taşır. Yazınca aynı türle onay döner (`kind = 'alindi'`).
6. Onay gelince düğüm dosyayı siler. 7 gün içinde onay gelmezse kartta "Kurtarma anahtarı teslim edilmedi" uyarısı durur; anahtar silinmez.

**Neden PCR 7:** PCR 7 Güvenli Önyükleme durumunu ölçer. Değişmeyen bir donanımda yeniden başlatmalar ve çekirdek güncellemeleri bağı bozmaz; Güvenli Önyükleme kapatılırsa ya da anahtar veritabanı değişirse bozar. PCR 4 de eklenseydi her `shim`, `grub` ve çekirdek güncellemesinde düğüm gözetimsiz açılamazdı.

**Dürüst sınır:** Aynı bilgisayarı Microsoft imzalı başka bir sistemle (ör. herhangi bir canlı Linux USB'si) Güvenli Önyükleme açıkken başlatan saldırgan PCR 7'yi aynı tutabilir ve diski açabilir. Bu şifreleme asıl olarak **diskin sökülüp başka makinede okunmasına** ve Güvenli Önyükleme kapatılarak yapılan saldırıya karşı korur. Zarflar ve kayıtlar zaten uçtan uca şifrelidir; açığa çıkabilecek olan kimlik ve emanet üst bilgisidir (T1).

**PCR 7 değişirse:** Düğüm açılışta parola sorar. Ebeveyn telefonunda "Ev Makinesi → <cihaz> → Kurtarma anahtarı" anahtarı gösterir (biyometriyle). Anahtar konsola yazılınca `havenfold-luks-yenile.service` bağı yeni PCR 7 değeriyle kurar. Bunu tetikleyen bilinen güncellemeler (`secureboot-db`) gözetimsiz güncellemeden tutulur (`apt-mark hold`); denetçi bu paketin yeni sürümü yayınlanınca kartta "Güvenli önyükleme güncellemesi var; bir kez kurtarma anahtarıyla açılış gerekecek" uyarısı gösterir ve kurulumu `havenfold guncelle --os` ile yerel onaya bırakır. `fwupd` kurulmaz.

**TPM yoksa:** Disk şifrelenmez (kurucu belge §9.2). Kurtarma anahtarı yoktur.

### 8.6 Var olan Ubuntu (`havenfold kur`)

- Yalnız Ubuntu Server 24.04 LTS, amd64 ya da arm64. Başka sürümde durur.
- Dağıtım: tek dosya `havenfold-kur` (sürüm sayfasında, SHA-256'sı ile). İçinde kök durumu sabittir. Önce bildirimi indirip doğrular, sonra paketi.
  - *Uygulama notu (açılış öncesi inceleme, 25 Ekim 2026):* Var olan kurulumda makinenin kök durumu (`/var/lib/havenfold/yetki/kok.durum`) gömülüden yeni dönemdeyse bildirim onunla doğrulanır; aynı dönemde başka kök `ROOT_CONFLICT`. Kökü döndürülmüş makinede eski `havenfold-kur`, eski kökle imzalanmış bildirimi kabul etmez. Kurulu düğümde (kimlik işareti ya da durum dosyalarından biri var) kök ya da sürüm durumu eksikse kurulum durur (`STATE_INCOMPLETE`); `yetki.durum`'un şeması kesin denetlenir. Sürüm düşürme ve geri çekilmiş sürüm (`yetki.durum` ve bildirimin `revoked` listesi) paket inmeden, paketteki Node çalışmadan ve kalıcı araçlar değişmeden sistemin `python3`'üyle reddedilir (`installer/install/notification.sh` `hf_kurulu_kok_sec`, `hf_surum_denetle`).
- Ubuntu paketlerini Ubuntu arşivinden `apt` ile kurar (Ubuntu'nun kendi imzası). Bu yolda paket listesinden `clevis*` çıkarılır: diske dokunulmaz.
- Disk şifreli değilse `NODE_HEALTH.platform.disk = 'sifresiz'` bildirilir. TPM varsa kimlik yine TPM'ye mühürlenir ve kasa payı tutulabilir (RFC-0004 §3.1 koşulu TPM mührüdür; pay diskte değil, TPM mührünün içindedir). Kartta "Disk şifresiz" yazar.
- **Kurucu belgeden ayrılan nokta:** Kurucu belge §9.2 "TPM varsa LUKS + TPM ile otomatik açılış" diyor. Bu yolda disk silinmediği için şifreleme sonradan kurulamaz. TPM'li ama diski şifresiz düğümde, diski çalınan kişiye kimlik değil, emanet üst verisi ve uygulama verisi açığa çıkar; zarflar uçtan uca şifrelidir. Kurulum ekranı bunu söyler ve "diski şifrelemek için Kurulum USB'siyle yeniden kurun" önerisini gösterir. Bu fark §18'de listelidir.
- Laptop ayarlarını (§10) yalnız pil algılanırsa ve kullanıcı `E` derse uygular; `--laptop` bayrağı soruyu atlar.
- SSH, güvenlik duvarı ve var olan servislere dokunmaz; yalnız kendi nftables tablosunu (`inet havenfold`) ekler.

## 9. İlk açılış ve tören

`havenfold-ilk-acilis.service`, `tty1`'de sırayla:

| # | Adım | Not |
|---|------|-----|
| 1 | Disk TPM'den açılır (TPM varsa) | §8.5 adım 3 bu açılışta çalışır. |
| 2 | **Ağ.** Kablolu bağlantı varsa geçer. Yoksa Wi-Fi ağları listelenir, parola yerelde sorulur, netplan dosyasına `0600` yazılır. | Wi-Fi parolası USB'de hiç olmaz. |
| 3 | **Saat.** `systemd-timesyncd` eşitlemesi 60 saniye beklenir. | Olmazsa "Saat eşitlenemedi" uyarısıyla sürer; tören QR'ının süresi yerel saate bağlıdır. |
| 4 | **Yerel yönetici parolası** belirlenir (`yonetici`). En az 12 karakter. | SSH sunucusu kurulu değildir; parola yalnız konsol içindir. |
| 5 | **Durum özeti:** RAM, çekirdek, disk, TPM, disk şifreleme, pil ve pil sınırı, ağ türü. Uyarılar: TPM yok, Wi-Fi, pil sınırı yok, BIOS'ta "elektrik gelince aç" ayarını açma önerisi. | |
| 6 | **Rol seçimi:** `isci` (varsayılan), `kutu`, `birlesik`. | Ailede zaten kutu varsa telefon `kutu` törenini reddeder (kurucu belge §6.2). |
| 7 | **Kimlikler** üretilir ve mühürlenir. `hostId` üretilir. | §5 |
| 8 | **Tören:** `havenfold katil` QR'ı gösterir. Ebeveyn Yuva Hat'ta "Cihaz ekle"yi seçip okutur. 5 resim karşılaştırılır; ekransız cihazda resimlerin adları metin olarak da yazar. Ebeveyn biyometriyle imzalar. `DEVICE_ATTACH` (ve kutuda `ADD_MEMBER`) yazılır. | Kurucu belge §6.4; birleşikte §4.2 |
| 9 | **Kök anahtar denetimi:** Telefon, düğümün `NODE_HEALTH.software.rootFp` değerini uygulamanın içinde gelen resmi kök parmak izleriyle karşılaştırır. Eşleşmezse "Bu cihaz resmî Havenfold sürümünü kullanmıyor" uyarısı gösterir ve ebeveynden ikinci onay ister. | Topluluk derlemeleri yasak değildir ama görünür olur. |
| 10 | **Kurtarma anahtarı** teslimi | §8.5 |
| 11 | **Görev imajları:** Denetçi, bildirimdeki ve RAM'e sığan türlerin `oci-archive` dosyalarını indirir ve yükler. | Arka planda; tören beklemez. |
| 12 | Birim kendini devre dışı bırakır; `havenfold-ekran.service` durum ekranına geçer. Ekran 60 saniye sonra kararır. | |

Tören 10 dakika içinde tamamlanmazsa QR durur; ekranda "Yeniden denemek için Enter" yazar.

## 10. Laptopu sunucu yapma ayarları

Kurulum (ya da `havenfold kur --laptop evet`) bunları yapar:

| Ayar | Nasıl |
|------|-------|
| Kapak kapanınca uyuma yok | `/etc/systemd/logind.conf.d/havenfold.conf`: `HandleLidSwitch=ignore`, `HandleLidSwitchExternalPower=ignore`, `HandleLidSwitchDocked=ignore`, `HandleSuspendKey=ignore`, `HandleHibernateKey=ignore`, `IdleAction=ignore` |
| Uyku hedefleri kapalı | `systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target suspend-then-hibernate.target` |
| Ekran ışığı 60 sn'de söner | Çekirdek satırına `consoleblank=60` |
| Pil şarj sınırı | §10.1 |
| Güvenlik yamaları | `unattended-upgrades` yalnız `${distro_id}:${distro_codename}-security`; `Automatic-Reboot "false"` (yeniden başlatmayı denetçi sıralar, §12.7) |
| Isı | Intel işlemcide `thermald` kurulur |
| Bellek | 4 GB takas dosyası, `vm.swappiness=10` |
| Ağ adı | `havenfold-XXXX` (rastgele). Ev ağında aile adı görünmez. mDNS servisi kurulmaz. |
| Güvenlik duvarı | nftables `inet havenfold` tablosu: gelen trafikte yalnız kurulu bağlantılar ve çekirdeğin HyperDHT UDP portu; geri kalanı düşer. Ev ağına açık servis yoktur. İki istisna yalnız ilgili özellik açıkken eklenir: afet modunun yerel ağ yolu (`afet-ag`, RFC-0012 §6.6) ve bir uygulamanın ebeveynin verdiği `lanInbound` portları (RFC-0011 §4.3). |
| Ağ tercihi | Kablolu ağ varsa varsayılan yol odur. Wi-Fi kullanılıyorsa `NODE_HEALTH.net.wired = false` ve kartta "Wi-Fi" uyarısı. |

### 10.1 Pil şarj sınırı

Sıra:

1. **Çekirdeğin standart arayüzü:** `/sys/class/power_supply/BAT*/charge_control_start_threshold` ve `charge_control_end_threshold`. İkisi de varsa `60` / `80`. Yalnız bitiş varsa `80`. `limit = 'cekirdek'`.
2. **Üreticinin platform sürücüsü:** Bazı cihazlar tek bitlik bir "pil koruma modu" sunar (sürücüye göre değişen bir `sysfs` dosyası). Denetçi bilinen yolların listesini paketle taşır. Varsa açılır. `limit = 'uretici'`, eşikler sürücünün sabit değeridir.
3. **Hiçbiri yoksa:** `limit = 'yok'`. Kartta "Pil sınırı yok" uyarısı durur. Kurulum ekranı "BIOS'ta pil koruma ya da 'çoğunlukla prizde' ayarı varsa açın" der.

Eşik her açılışta `havenfold-pil.service` ile yeniden yazılır; bazı sürücüler yeniden başlatmada sıfırlar.

## 11. Sağlık bilgisi

### 11.1 `NODE_HEALTH` (0xD8)

`NODE_CAPS` (RFC-0002 §4) iş yerleştirme içindir. `NODE_HEALTH` bakım ve uyarı içindir. İkisi ayrıdır, çünkü `NODE_HEALTH` donanım ayrıntısı taşır ve yalnız ebeveynlere gider.

```
NODE_HEALTH {
  nodeId     : fixed16
  hostId     : fixed16
  seq        : uint
  software   : { product: string, version: string, versionCode: uint, channel: string,
                 keyEpoch: uint, rootFp: fixed32,              // hash('hf/release-root/', rootPub)
                 lastManifestAt: uint,                         // ms; son doğrulanan bildirimin publishedAt'i
                 update: string ('guncel' | 'indiriliyor' | 'pencere-bekliyor' | 'onay-bekliyor' | 'geri-alindi' | 'hata'),
                 pendingVersion: string, osSecurityPending: uint, rebootRequired: bool }
  platform   : { osRelease: string, kernel: string, secureBoot: bool,
                 tpm: string ('yok' | 'var' | 'muhur-ok'),
                 disk: string ('luks-tpm' | 'sifresiz' | 'uygulama-sifreli'), recoveryDelivered: bool }   // 'uygulama-sifreli': RFC-0008 §4.3
  power      : { onAC: bool, acLoss24h: uint,
                 battery?: { percent: uint, healthPct: uint (0 = bilinmiyor), cycles: uint, tempC: int,
                             limit: string ('cekirdek' | 'uretici' | 'yok'), limitStart: uint, limitStop: uint } }
  thermal    : { cpuMaxC: int, hotMinutes24h: uint }
  disks      : array<{ kind: string ('nvme' | 'ssd' | 'hdd' | 'emmc' | 'usb'), sizeGB: uint, usedPct: uint,
                       wearPct: int (−1 = bilinmiyor), smart: string ('iyi' | 'uyari' | 'kritik' | 'bilinmiyor'),
                       reallocated: uint, tempC: int }>
  net        : { wired: bool, wifiDbm: int (0 = kablolu) }
  sleepGuard : { lid: bool, targetsMasked: bool }
  retire     : string ('yok' | 'tasiniyor' | 'hazir')
  warnings   : array<string>                                   // §11.3
  sig        : fixed64                                         // etiket 'hf/node-health/'
}
```

| Konu | Kural |
|------|-------|
| Kim imzalar | Kimliğin kendisi. Birleşik cihazda iki çekirdek ayrı ayrı gönderir; telefon `hostId` ile tek kartta birleştirir. |
| Kime gider | Yalnız **ebeveyn** rolündeki aktif üyelere, canlı doğrudan oturumda. Bağlanınca bir kez, sonra 15 dakikada bir, ayrıca `warnings` değişince hemen. |
| Nereye gitmez | Kutu emanetine, Posta Kutusu'na, başka cihazlara, Eser'e. |
| Seri numarası | Taşımaz. Disk ve cihaz seri numarası yalnız silme raporundadır. |
| Saklama | Telefon her düğümün son bildirimini saklar. Geçmiş tutulmaz. |

### 11.2 Eşikler

| Ölçü | Eşik | Sonuç |
|------|------|-------|
| İşlemci sıcaklığı | > 90 °C | `NODE_CAPS.status = 'sicak'` (RFC-0002 §4); 80 °C altında `hazir` |
| İşlemci sıcaklığı | Son 24 saatte toplam `sicak` süresi > 60 dk | `ISI_SUREKLI` |
| Pil sağlığı | `healthPct` < 60 | `PIL_SAGLIK_DUSUK`: "Pili çıkarın ya da cihazı emekliye ayırın" |
| Pil sağlığı | `healthPct` < 40 | `PIL_KRITIK`; düğüm `bakim` durumuna geçer, iş kabul etmez |
| Pil sıcaklığı | ≥ 45 °C, 30 dk sürekli | `PIL_SICAK` |
| Pil sıcaklığı | ≥ 50 °C, 10 dk sürekli | `PIL_KRITIK`; `bakim` |
| Prizden çıkma | `onAC = false` | `status = 'pil'` (RFC-0002); çekirdekler çalışmayı sürdürür |
| Pil yüzdesi (prizde değilken) | ≤ %25 | `PIL_AZ`; ebeveyne bildirim |
| Pil yüzdesi (prizde değilken) | ≤ %15 | Düzgün kapanış (`systemctl poweroff`), dosya sistemini korumak için |
| Pil sınırı | `limit = 'yok'` | `PIL_SINIRI_YOK` (kalıcı uyarı) |
| Disk aşınması | `wearPct` ≥ 90 | `DISK_ASINMA` |
| Disk sağlığı | SMART başarısız, NVMe `critical_warning ≠ 0` ya da yeniden atanmış sektör artışı | `DISK_KRITIK`; yeni yedek ve emanet kabul edilmez, telefon taşıma önerir |
| Disk doluluğu | `usedPct` ≥ 90 | `DISK_DOLU`; yeni yedek ve emanet kabul edilmez |
| Güncelleme | `lastManifestAt` 30 günden eski | `GUNCELLEME_GECIKTI` |
| Güncelleme | `update = 'hata'` ya da `'geri-alindi'` | `GUNCELLEME_HATA` |
| İşletim sistemi | `rebootRequired` 7 günden uzun | `YENIDEN_BASLATMA` |
| Disk şifreleme | `disk = 'sifresiz'` | `SIFRESIZ_DISK` (kalıcı bilgi) |
| Kurtarma anahtarı | 7 gün içinde teslim edilmedi | `KURTARMA_TESLIM_YOK` |
| Uyku koruması | `lid = false` ya da `targetsMasked = false` | `UYKU_KORUMASI_YOK` |
| Güvenli önyükleme veritabanı | Tutulan `secureboot-db` güncellemesi var | `SB_GUNCELLEME` |

- Telefon uyarıyı yerel bildirim olarak gösterir. Aynı uyarı aynı düğüm için en çok haftada bir bildirilir; kartta sürekli görünür.
- Yılda bir kez, kurulum gününde, "Kutunun ve işçilerin pilini kontrol edin: şişme, ısınma var mı?" hatırlatması gelir (kurucu belge §9.6). `PIL_SINIRI_YOK` olan cihazda 6 ayda bir gelir.
- 30 gün `NODE_CAPS` gelmeyen cihaz için kurucu belge §6.8 geçerlidir.

### 11.3 Uyarı kodları

`ISI_SUREKLI`, `PIL_SAGLIK_DUSUK`, `PIL_KRITIK`, `PIL_SICAK`, `PIL_AZ`, `PIL_SINIRI_YOK`, `DISK_ASINMA`, `DISK_KRITIK`, `DISK_DOLU`, `GUNCELLEME_GECIKTI`, `GUNCELLEME_HATA`, `YENIDEN_BASLATMA`, `SIFRESIZ_DISK`, `KURTARMA_TESLIM_YOK`, `UYKU_KORUMASI_YOK`, `SB_GUNCELLEME`, `WIFI`.

## 12. Güncelleme

### 12.1 Sürüm bildirimi

```
RELEASE_MANIFEST {
  format       : uint                  // 1
  product      : string                // 'havenfold-node', 'havenfold-tepsi' (RFC-0008), 'mekan-gorev', 'yuva-gorev'
  version      : string                // 'MAJOR.MINOR.PATCH'
  versionCode  : uint
  channel      : string ('kararli' | 'deneme')
  publishedAt  : uint                  // ms
  minFrom      : uint                  // doğrudan bu sürüme geçebilecek en küçük versionCode
  urgent       : bool                  // güvenlik düzeltmesi: bakım penceresi beklenmez
  packages     : array<{ os: string, arch: string, name: string, size: uint, digest: fixed32, urls: array<string> }>
  images       : array<{ type: string, version: string, arch: string, ociDigest: string,
                         archive: { name: string, size: uint, digest: fixed32, urls: array<string> },
                         sourceArchive: { name: string, digest: fixed32, urls: array<string> } | null,
                         ramMB: uint,
                         policy: { ekip: bool, kisiOlcer: bool, yuz: bool, plaka: bool } }>   // RFC-0005 §12.1
  assets       : array<{ name: string, size: uint, digest: fixed32, urls: array<string> }>   // ek ikililer: cloudflared (RFC-0009), havenfold-rtsp (RFC-0008)
  installer    : array<{ arch: string, name: string, size: uint, sha256: fixed32, urls: array<string> }>
  installerDebs: array<{ name: string, version: string, digest: fixed32 }>
  revoked      : array<uint>           // geri çekilen versionCode'lar
  catalogKeys  : array<{ pub: fixed32, validUntil: uint }>   // uygulama seçkisi anahtarları (RFC-0011 §5.1); yalnız 'havenfold-node'da dolu
  keyEpoch     : uint
  nextRootHash : fixed32               // bir sonraki kök anahtarın taahhüdü (§12.2)
  notes        : string (≤ 4 KB)
  sig          : fixed64               // Ed25519(kök, hash('hf/release/', body))
}
```

**Doğrulama sırası (düğüm):**

| # | Denetim | Hata |
|---|---------|------|
| 1 | `format = 1`, kodlama en kısa | `FORMAT_ERROR` |
| 2 | `keyEpoch = kök durumu.keyEpoch`; büyükse önce kök döndürme zinciri istenir (§12.2) | `ROOT_EPOCH_ERROR` |
| 3 | `sig`, `rootPub` ile geçerli | `SIGNATURE_ERROR` |
| 4 | `nextRootHash = kök durumu.nextRootHash` | `COMMITMENT_ERROR` |
| 5 | `product` bu düğümde kuruludur ya da düğümün desteklediği bir ürün imajıdır | yok sayılır |
| 6 | `channel` düğümün kanalı | yok sayılır |
| 7 | `versionCode > kurulu` (§12.3) | eşitse yok sayılır; küçükse onay gerekir |
| 8 | `minFrom ≤ kurulu`; değilse aradaki sürümün bildirimi istenir ve önce o kurulur | `ARA_SURUM` |
| 9 | Her indirilen dosyanın boyutu ve özeti listede yazanla aynı | `DIGEST_MISMATCH` |

- **Ürün bildirimleri:** Eser'in kapalı görev imajları (`mekan-gorev`, `yuva-gorev`) aynı kök anahtarla imzalanan ayrı bildirimlerle gelir. Her ürünün kendi `versionCode` dizisi vardır. Kurucu belge §8.7'deki "imaj özeti imzalı sürüm bildiriminde olmalıdır" kuralı böyle sağlanır.
- **Kaynak arşivi:** GPL ya da AGPL araç içeren imajda `sourceArchive` boş olamaz (kurucu belge §17.1). Derleme hattı bunu denetler.
- **Model dosyaları** bu bildirimde değildir. Aynı kök anahtarla imzalanan model bildiriminden (RFC-0013) gelir; o bildirim de bu bölümdeki kök durumuyla (`keyEpoch`, kök döndürme) doğrulanır.
- **İmaj ilkesi (`policy`):** Alanların anlamı ve `ekip: true` koşulu RFC-0005 §12.1'dedir. İşçi bu alanları görev kabulünde okur; düğüm yazılımı başka bir yorum yapmaz.
- **Seçki anahtarları (`catalogKeys`):** Konteyner uygulaması seçkisini imzalayan, kök anahtardan ayrı çevrimdışı anahtarlar (RFC-0011 §5.1). Düğüm, en son doğruladığı `havenfold-node` bildirimindeki listeyi kullanır; listeden çıkan anahtarın imzaladığı katalog reddedilir.
- **Görev imajı bütünlüğü:** Denetçi `archive.digest`'i doğrular, `podman load` ile yükler, yüklenen imajın özetinin `ociDigest` ile aynı olduğunu denetler. Görev her zaman `@sha256:` ile çağrılır (RFC-0002 §11.1). Bir imaj bildirimde yoksa çalıştırılmaz (T10).

### 12.2 Kök anahtar ve döndürülmesi

**Kök durumu:** `{ keyEpoch, rootPub, nextRootHash }`. İlk değer Kurulum USB'sinden ya da `havenfold-kur` dosyasından gelir.

**Önceden taahhüt edilen yedek kök:**

- Kök anahtarla birlikte bir **yedek kök anahtar** üretilir ve ayrı bir yerde, çevrimdışı saklanır (ayrı donanım anahtarı; kök anahtarla aynı yerde değil).
- Her bildirim `nextRootHash = hash('hf/release-root/', yedekPub)` taşır.
- Kök anahtarın yerini **yalnız** bu özete uyan anahtar alabilir.

Böylece kök anahtarı çalan biri sahte bildirim imzalayabilir, ama kendi anahtarını kök yapamaz. Asıl sahip yedek anahtara geçince çalınan anahtarın imzaları geçersiz olur.

```
ROOT_ROTATION {
  keyEpoch        : uint               // eski + 1
  newRoot         : fixed32
  newNextRootHash : fixed32            // yeni yedeğin taahhüdü
  reason          : string ('planli' | 'calinti' | 'kayip')
  publishedAt     : uint
  sigNew          : fixed64            // Ed25519(newRoot, hash('hf/root-rotation/', body))
}
```

| Kural | Hata |
|-------|------|
| `keyEpoch = yerel + 1` | `ROOT_EPOCH_ERROR` |
| `hash('hf/release-root/', newRoot) = yerel nextRootHash` | `COMMITMENT_ERROR` |
| `sigNew` geçerli | `SIGNATURE_ERROR` |

- Kabul edilince kök durumu `{ keyEpoch, newRoot, newNextRootHash }` olur. Eski anahtarla imzalı bildirimler bundan sonra reddedilir.
- Döndürme kayıtları sürüm sayfasında `kok-zinciri.bin` dosyasında art arda durur. Geride kalan düğüm zinciri baştan uygular.
- **Eski kökün imzası istenmez:** Eski anahtar kaybolmuş olabilir. Yeni anahtarın taahhüde uyması ve kendi imzası yeterlidir.
- **İki anahtar birden kaybolursa:** Uzaktan yol yoktur. Yeni kurulum imajları yeni kökle çıkar. Var olan düğümler yerel konsolda `sudo havenfold kok-sabitle <dosya>` ile geçirilir. Dosyanın SHA-256'sı resmî sayfada ve telefon uygulamasının yeni mağaza sürümünde yayımlanır; telefon §9 adım 9'daki denetimle yeni parmak izini tanır. Uzaktan bir "kök değiştir" komutu tanımlanmaz: ele geçirilmiş bir telefonun düğümlere kod kurdurabilmesi daha büyük bir risktir.
- **Telefonun bildiği kökler:** Yuva Hat her mağaza sürümünde geçerli `(keyEpoch, rootFp)` listesini taşır. Bu, mağaza imzasına dayanan ikinci, bağımsız bir güven yoludur.

### 12.3 Kanallar ve sürüm tekdüzeliği

- **Kanallar:** `kararli` ve `deneme`. Aile düğümleri `kararli`dadır. Kanal `/etc/havenfold/dugum.toml`'dadır.
- **Kanal değişimi** ebeveyn imzalı `UPDATE_APPROVE { op: 'kanal' }` ister (§12.4). Kanal değişince düğüm sürüm düşürmez: `deneme`den `kararli`ya geçen düğüm, `kararli` kanalı kendi sürümünü geçene kadar bekler.
- **Tekdüzelik:** `surum.durum` dosyası ürün başına `enYuksek` (kurulup sağlık denetiminden geçmiş en büyük `versionCode`) tutar. Yeni sürüm ancak sağlık denetimini geçince (§12.6) `enYuksek` olur.
- **Düşürme:** `versionCode < enYuksek` olan bir sürüm yalnız geçerli bir `UPDATE_APPROVE { op: 'dusur' }` ile kurulur. Bu kural `havenfold geri-al` için de geçerlidir.
- **İstisna, kendiliğinden geri dönüş:** Yeni sürüm sağlık denetiminden geçmezse düğüm `onceki`ye döner. Bu düşürme sayılmaz, çünkü yeni sürüm hiç `enYuksek` olmamıştır.
- **Geri çekilen sürüm:** Kurulu sürüm daha yeni bir bildirimin `revoked` listesindeyse güncelleme `urgent` gibi hemen yapılır.
- **Donma saldırısı:** Kötü niyetli bir indirme kaynağı yeni bildirimleri saklayabilir. Bu tek kök anahtarla tam engellenemez. Önlem: telefon uygulaması her mağaza sürümünde `minNodeVersionCode` taşır; düğümün sürümü bundan küçükse ve 30 gündür bildirim gelmiyorsa ebeveyne "Ev Makinesi güncelleme alamıyor" uyarısı gider.

### 12.4 `UPDATE_APPROVE` (0xDC)

```
UPDATE_APPROVE {
  nodeId        : fixed16              // hedef kimlik; birleşik cihazda iki kimlik için ayrı ayrı
  op            : string ('dusur' | 'kanal')
  product       : string
  toVersionCode : uint                 // dusur: hedef; kanal: 0
  manifestHash  : fixed32              // dusur: hedef bildirimin hash('hf/release/', body)'si; kanal: 32 sıfır
  channel       : string               // kanal: yeni kanal; dusur: ''
  expiresAt     : uint                 // ms
  ledgerSeq     : uint
  signerId      : fixed16
  sig           : fixed64              // etiket 'hf/update-approve/'
}
```

| # | Düğümün denetimi | Hata |
|---|------------------|------|
| 1 | `nodeId` kendi kimliği | `WRONG_NODE` |
| 2 | `signerId`, `ledgerSeq` anında ve bugün aktif **ebeveyn** | `UNAUTHORIZED` |
| 3 | `sig` geçerli | `INVALID_SIGNATURE` |
| 4 | `expiresAt > şimdi` ve `expiresAt ≤ şimdi + 24 saat` | `INVALID_DURATION` |
| 5 | `dusur`: hedef bildirim §12.1'deki 1–4 ve 9 denetimlerinden geçer; özeti `manifestHash` | `MANIFEST_ERROR` |
| 6 | Aynı onay ikinci kez kullanılmaz (özeti `expiresAt`'e kadar saklanır) | `REPLAY` |

- Telefon onayı yalnız ebeveynin biyometrisiyle imzalar. Ekranda "Bu cihaz <a> sürümünden <b> sürümüne düşürülecek. Düşük sürümde kapatılmış güvenlik açıkları olabilir." yazar.
- Taşıma: doğrudan oturum ya da kutu emaneti (`HOLD`, RFC-0003 §6.4 mührüyle). Posta Kutusu'na gitmez.

### 12.5 Taşıma

**Kaynaklar:**

- Birincil: GitHub Releases (`github.com/havenfold/havenfold/releases`).
- Yansı: Eser'in indirme sunucusu (alan adı alınınca `indir.havenfold.io`).
- Bildirim adresleri sabittir: `…/kanal/<kanal>/<product>.bildirim` ve `…/kok-zinciri.bin`.
  - *Uygulama notu (açılış incelemesi, 25 Ekim 2026):* GitHub Releases kanal başına sabit yol vermez. `havenfold-kur` kararlı kanalda `…/releases/latest/download/havenfold-node.bildirim`, deneme kanalında GitHub API'sinden bulunan en yeni yayımlanmış ön sürümün `…/releases/download/<etiket>/havenfold-node.bildirim` adresini kullanır; yansı aynı düzeni izler (`docs/surum.md`). Kanal yine imzalı bildirimden denetlenir.
- Kaynak güvenilir sayılmaz. Bütün bütünlük imzalı bildirimden ve özetlerden gelir. TLS yalnız gizlilik ve bozulmayı erken yakalamak içindir.

**Ne zaman bakılır:** Her 6 saatte bir, 0–60 dakikalık rastgele gecikmeyle. `--denetle` ile hemen.

**Topluluk içi paylaşım:**

```
UPDATE_HAVE (0xD9) { product: string, versionCode: uint, manifest: buffer, have: array<fixed32> }
UPDATE_REQ  (0xDA) { digest: fixed32, offset: uint, length: uint }          // length ≤ 256 KiB
UPDATE_DATA (0xDB) { digest: fixed32, offset: uint, data: buffer }
```

- Bu üç zarf yalnız **cihaz ↔ cihaz** ve **kutu ↔ cihaz** doğrudan oturumlarında gider. Emanete ve Posta Kutusu'na girmez. İmzasızdırlar: `manifest` kendisi imzalıdır, dosyalar özetle doğrulanır.
- Düğüm bir oturum açılınca ve yeni bir bildirimi doğruladığında `UPDATE_HAVE` gönderir.
- **Kim internete bakar:** Son 24 saatte `UPDATE_HAVE` aldığı düğümler arasında `nodeId`'si bayt sırasıyla en küçük olan. Diğerleri yalnız 24 saattir hiç `UPDATE_HAVE` almadıysa kendileri bakar. Böylece bir evden çoğu zaman tek düğüm sunucuya gider.
- Bir dosya bir eşte varsa önce eşten, yoksa kaynaktan indirilir. Aynı anda bir eşten en çok bir dosya istenir.

**İşletim sistemi paketleri** Ubuntu arşivinden `unattended-upgrades` ile gelir (§12.7). Bu yol Ubuntu'nun kendi imzasına dayanır; Havenfold bildirimi bunları kapsamaz.

### 12.6 Kurma ve geri dönüş

1. Denetçi bildirimi ve paketi doğrular, `onbellek/`'e yazar.
2. Yetki yardımcısı `paket-ac` ile `/opt/havenfold/surumler/<sürüm>/` dizinini açar. Paket içindeki `bin/havenfold kendini-sina --kuru` çalıştırılır (veri biçimi geçişlerinin kuru denemesi).
3. **Zaman:** `kararli` kanalda bakım penceresi beklenir (§12.7). `deneme` kanalda ve `urgent` bildirimde hemen. Sürekli olmayan bir görev çalışıyorsa bitmesi en çok 6 saat beklenir; sürekli görevler (`hf.task.vision`) duraklatılır ve güncelleme sonrası sürdürülür.
4. Denetçi çekirdeklere `DURDUR { neden: 'guncelleme' }` gönderir. Yetki yardımcısı `surum-gec` ile bağları değiştirir ve birimleri yeniden başlatır.
5. **Sağlık denetimi (10 dk):** Bütün birimler `active`, her çekirdek kendi defterini açmış ve denetçiye `MERHABA` demiş, denetçinin kendi sınaması geçmiş olmalı.
6. Geçerse `enYuksek` güncellenir. En çok iki sürüm dizini tutulur (`guncel`, `onceki`); daha eskisi silinir. Önceki sürümün görev imajları geri dönüş için tutulur, ondan eskileri silinir.
7. Geçmezse `surum-geri` ile dönülür. Sürüm yerelde `bozuk` işaretlenir ve aynı `versionCode` yeniden denenmez. `NODE_HEALTH.software.update = 'geri-alindi'`.

**Veri biçimi geçişleri** yalnız ileri yöndedir ve geri alınabilir olmalıdır: yeni sürüm eski dosyaları değiştirmeden yeni dosya yazar, eskisini ancak bir sonraki başarılı güncellemede siler. Böylece `onceki`ye dönen sürüm kendi dosyalarını bulur.

### 12.7 İşletim sistemi yamaları ve yeniden başlatma

- `unattended-upgrades` yalnız güvenlik yamalarını kurar. `secureboot-db` tutulur (§8.5).
- Yeniden başlatma gerekirse (`/var/run/reboot-required`) düğüm **kendi sırasında** başlar:
  - Sıra: defterdeki aktif kutu ve cihaz kimlikleri `nodeId`'ye göre sıralanır, düğüm kendi en küçük kimliğinin sırasını alır (`i`).
  - Zaman: yerel saatle `03:00 + 20 × (i mod 6)` dakika.
  - Görev çalışıyorsa §12.6 madde 3'teki bekleme kuralı geçerlidir.
- Aynı pencere Havenfold güncellemesi için de kullanılır.
- 7 günden uzun bekleyen yeniden başlatma `YENIDEN_BASLATMA` uyarısı olur.

### 12.8 Dürüst not

- Güncelleme kaynağı (GitHub ya da Eser'in sunucusu), istek yapan düğümün **IP adresini**, **istek zamanını** ve **indirdiği sürümü** (adres yolundan) görür (T11).
- Düğüm kaynağa topluluk kimliği, `nodeId`, `hostId`, donanım bilgisi ya da çerez göndermez. `User-Agent` sabittir: `havenfold-node`; sürüm içermez.
- Ubuntu arşivi ve zaman sunucusu (`ntp.ubuntu.com`) da IP adresini görür.
- Eser'e çökme raporu, kullanım ölçümü ya da sağlık bilgisi gitmez. Sorun bildirmek isteyen kişi `havenfold tani` dosyasını kendisi seçip gönderir.

## 13. Emeklilik ve silme modu

### 13.1 Düğüm tarafı

RFC-0003 §8'deki akışa düğüm şunları ekler:

1. `RETIRE_BEGIN` gelince düğüm `retire = 'tasiniyor'` olur, `NODE_CAPS.status = 'bakim'` bildirir, yeni görev, emanet ve yedek kabul etmez.
2. `RETIRE_LIST` gönderir; taşıma RFC-0001 ve RFC-0002 yollarıyla yapılır.
3. Liste boşalınca (ya da ebeveyn kalanları onaylayınca) düğüm 16 baytlık rastgele bir `retireNonce` üretir ve gönderir:

```
RETIRE_STATE (0xDD) {
  nodeId      : fixed16
  phase       : string ('tasiniyor' | 'hazir' | 'iptal')
  remaining   : { holds: uint, blobs: uint, shares: uint }
  retireNonce : fixed16                 // 'hazir'da dolu, diğerlerinde 16 sıfır
  ticket      : bool                    // ESP bileti yazıldı mı
  sig         : fixed64                 // etiket 'hf/retire-state/'
}
```

4. Denetçi, yetki yardımcısıyla ESP'ye **emeklilik biletini** yazar:

```
HFRT1 bileti = 'HFRT1' (5 B) ‖ EMEKLI_BILET
EMEKLI_BILET { v: uint (1), hostId: fixed16, ids: array<fixed16>, retireNonce: fixed16 }
```

   - `ids`: bu donanımdaki bütün kimlikler (birleşik cihazda kutu ve işçi).
   - Bilet sır değildir. Silme ortamının bu donanımın kimliğini bilmesini sağlar.
5. `RETIRE_STATE` her ebeveyne gider: doğrudan oturum ya da kutu emaneti (mühürlü). Kutunun kendisi emekliye ayrılıyorsa yalnız doğrudan.
6. Ebeveyn emekliliği iptal ederse (`RETIRE_BEGIN` ile aynı ekrandan) düğüm `phase = 'iptal'` gönderir, bileti siler ve normale döner.
7. `havenfold durum` ve ekran şunu yazar: "Kurulum USB'sini takın, yeniden başlatın, menüden **Silme modu**nu seçin." `havenfold sil-usb-hazirla` bu noktada kullanılır.

### 13.2 Silme ortamı

| Özellik | Değer |
|---------|-------|
| Taban | Ubuntu 24.04 paketlerinden kurulmuş küçük kök dosya sistemi (`kok.squashfs`), açılışta tamamen RAM'e kopyalanır (`toram`). Çekirdek, Kurulum USB'sindeki imzalı Ubuntu çekirdeğidir; Güvenli Önyükleme açık cihazda da açılır. |
| İçinde | `util-linux`, `nvme-cli`, `hdparm`, `sg3-utils`, `smartmontools`, `mmc-utils`, `cryptsetup`, `dmidecode`, Bare + `sodium-native`, silme aracı `havenfold-sil` |
| Ağ | **Kapalı.** Ağ arayüzleri açılmaz, yapılandırma dosyası yoktur, nftables her şeyi düşürür. Rapor yalnız QR ile çıkar. |
| Takas | Yok |
| Ekran | QR, çerçeve arabelleğine (`/dev/fb0`, `simpledrm`) piksel olarak çizilir. Çerçeve arabelleği yoksa metin konsolunda yarım blok karakterlerle çizilir ve parça boyutu küçülür (§13.5). |
| Rapor anahtarı | `crypto_sign_keypair`, gizli yarısı `sodium_malloc` + `mlock` alanında. Diske, USB'ye ya da ağa hiç yazılmaz. Oturum bitince `sodium_memzero`. |

**Akış:**

1. Açılış ekranı: "Havenfold silme modu. Bu bilgisayardaki diskler silinecek."
2. **Bilet:** Bütün ESP bölümleri salt okunur bağlanır, `/EFI/havenfold/emekli.bilet` aranır. Bulunursa `ids` ve `retireNonce` okunur. Bulunamazsa "Bilet yok: cihaz kimliği doğrulanamayacak" yazar; `deviceId` 16 sıfır olur.
3. **Disk keşfi** (§13.3) ve tablo.
4. **Anahtar QR'ı** (§13.5, `HFK1`). Ebeveyn telefonuyla okutur. Telefon `ids` içinde emekliye ayırdığı kimliğin bulunduğunu ve `retireNonce`'un o kimliğin son `RETIRE_STATE`'iyle aynı olduğunu denetler. Bilet yoksa telefon "Kimlik doğrulanamadı; bu cihazı siz mi seçtiniz?" diye sorar.
5. **Onay:** "N disk silinecek. Devam için SIL yazın."
6. **Sanitize** (§13.4). Her disk için ilerleme ve tahmini süre.
7. **Rapor** her disk için ayrı `WIPE_REPORT` (RFC-0003 §8 adım 4). Rapor QR'ları (`HFW1`) dönen sırayla gösterilir.
8. Telefon "Rapor alındı" deyince kullanıcı Enter'a basar. Seçenekler: **Kapat** ya da **Havenfold'u yeniden kur** (Kurulum USB'si menüsüne döner). Anahtar her iki durumda da silinir.

Silme ortamı topluluğa üye olmayan bir bilgisayarı da silebilir (ör. elden çıkarmadan önce). Bilet yoksa ve telefon okutulmazsa rapor yalnız ekranda gösterilir.

### 13.3 Disk keşfi

- `/sys/block/*` taranır. `loop`, `ram`, `zram`, `sr` ve silme ortamının açıldığı USB (açılış ortamını taşıyan aygıt) dışlanır.
- Her disk için: yol, veri yolu (NVMe, SATA, USB, MMC), dönen disk mi (`queue/rotational`), çıkarılabilir mi, model, seri, boyut, `nvme id-ctrl` / `hdparm -I` yetenekleri, LUKS başlığı olan bölümler (`cryptsetup isLuks`).
- **İç diskler** varsayılan olarak seçilidir. **Harici ve çıkarılabilir diskler** listelenir ama seçili değildir; kullanıcı her biri için ayrıca `E` der. Düğüme takılı yedek diski de silinmesi gerekiyorsa böyle seçilir.

### 13.4 Yöntem seçimi

Her disk için yukarıdan aşağı ilk uyan yöntem uygulanır.

**Önce LUKS:** Diskte LUKS başlığı olan her bölüm için `cryptsetup erase` (bütün anahtar yuvaları) ve başlık alanının (ilk 16 MiB) üzerine yazılması. Sonra diskin kendi yöntemi.

**Önce örnek:** SSD ve NVMe'de, sanitize öncesi 256 rastgele 4 KiB blok okunur ve `hash`'leri bellekte tutulur. Sanitize sonrası aynı bloklar yeniden okunur. Herhangi biri sıfırdan farklı ve öncekiyle aynıysa `result = 'hata'`. Bu bir doğrulama değil, bariz başarısızlığı yakalayan bir kontroldür.

| Disk | Koşul | `method` | Bitiş denetimi | `result` |
|------|-------|----------|----------------|----------|
| NVMe | `SANICAP` blok silme destekli | `nvme-sanitize-block` | `sanitize-log` `SSTAT` başarı + örnek | `ok` |
| NVMe | `SANICAP` şifreleme silme destekli | `nvme-sanitize-crypto` | aynı | `ok` |
| NVMe | Sanitize yok; Format NVM, `SES = 2` ya da `1` destekli | `clear-unverified` (`driveStatus`: `format-ses=<n>`) | Komut başarısı + örnek | `dogrulanamadi` |
| NVMe | Hiçbiri | `clear-unverified` (tam üzerine yazma) | Örnek | `dogrulanamadi` |
| SATA SSD | ATA Sanitize, blok silme ya da şifreleme karıştırma; disk donmuş değil | `ata-sanitize` | `--sanitize-status` başarı + örnek | `ok` |
| SATA SSD | ATA Security Erase (geliştirilmiş tercih); donmuş değil | `ata-secure-erase` | Komut başarısı + güvenlik durumunun kilitsiz dönmesi + örnek | `ok` |
| SATA SSD | Disk donmuş; bir uyku–uyanma döngüsünden (`rtcwake -m mem -s 5`) sonra da donmuş | `clear-unverified` (tam üzerine yazma) | Örnek | `dogrulanamadi` |
| HDD (dönen) | — | `overwrite-verify` | Tam okuma ve karşılaştırma | `ok`; gizli alan kaldırılamazsa ya da yeniden atanmış sektör > 0 ise `dogrulanamadi` |
| eMMC | — | `clear-unverified` (tam üzerine yazma + `mmc sanitize`) | — | `dogrulanamadi` |
| USB ya da SD | Dönen diskse HDD satırı; değilse | `clear-unverified` | — | `dogrulanamadi` |
| Herhangi | Komut hata verdi | denenen yöntem | — | `hata` |

- **Blok silme neden önce:** NVMe ve ATA blok silme, diskin iç şifreleme uygulamasının doğruluğuna dayanmaz. Şifreleme silme ancak blok silme yoksa seçilir.
- **`blkdiscard` (TRIM) hiçbir satırda yoktur.** Sanitize sayılmaz (kurucu belge §9.5).
- **ATA Security Erase** geçici bir kullanıcı parolası ister. Parola rastgele üretilir, yalnız bellekte durur. Silme başarısız olursa `--security-disable` denenir; disk kilitli kalırsa raporda yazar.
- **HDD üzerine yazma deseni:** Rastgele bir anahtarla `crypto_stream_xchacha20` akışı. Doğrulama aynı akışı yeniden üretip okunanla karşılaştırır. Sıfır deseni kullanılmaz, çünkü yazmayı yok sayıp sıfır döndüren bir disk sıfır doğrulamasını geçer. Önce gizli alan denetlenir: HPA varsa kaldırılır (`hdparm -N p<yerel>`), DCO varsa (`--dco-identify`) raporda yazar ve sonuç `dogrulanamadi` olur.
- **`clear-unverified` olan her raporda** ekran ve telefon şunu yazar: "Temizlendi, doğrulanamadı; fiziksel imha önerilir."
- **`driveStatus`:** Sürücünün ham cevabının kısa metni (ör. `sstat=0x0101 sprog=65535`, `security: not enabled, not locked`). 512 bayttan uzunsa kısaltılır.
- **Süre:** NVMe ve SSD birkaç dakika. HDD'de yazma ve okuma birlikte, 1 TB için yaklaşık 5–6 saat. Ekran tahmini gösterir.

### 13.5 Rapor ve QR biçimleri

**Rapor alanları** RFC-0003 §8 adım 4'tedir. Bu RFC'nin doldurma kuralları:

| Alan | Kaynak |
|------|--------|
| `deviceId` | Biletteki `ids`'in ilki (işçi kimliği varsa o, yoksa kutu). Bilet yoksa 16 sıfır. |
| `serial`, `model` | DMI: `product_serial`, `sys_vendor` + `product_name` |
| `diskModel`, `diskSerial` | Diskin kimlik bilgisi |
| `tool`, `toolVersion` | `havenfold-sil`, Kurulum USB'sinin sürümü |
| `startedAt`, `finishedAt` | Donanım saati (ms). **Dürüst not:** Silme ortamında ağ olmadığı için saat eşitlenmez; telefon okutma anındaki kendi saatini de kayda yazar. |

**Anahtar QR'ı:**

```
'HFK1:' ‖ base45(WIPE_KEY_QR)
WIPE_KEY_QR { v: uint (1), hostId: fixed16, ids: array<fixed16>, retireNonce: fixed16,
              reportPub: fixed32, disks: uint, toolVersion: string }
```

Bilet yoksa `hostId`, `retireNonce` 16 sıfır, `ids` boştur.

**Rapor QR'ları:** Biçim RFC-0003 §8 adım 5'teki gibidir: `HFW1:<sıra>/<toplam>:<base45>`.

- Taşınan yük: `WIPE_SET { reports: array<buffer> }` (her öğe bir `WIPE_REPORT`'un tam kodlaması).
- Yük, sırayla en çok **384 baytlık** parçalara bölünür. `sıra` 1'den başlar. Metin konsolunda parça boyutu **128 bayttır**.
- `base45` RFC 9285'tir; QR'ın alfanümerik kipine sığar. `HFW1:`, `/` ve `:` da alfanümerik kümededir.
- QR hata düzeltme düzeyi `M`. Parçalar 1,5 saniyede bir döner; ok tuşlarıyla elle de geçilir.
- Telefon parçaları sıraya göre birleştirir, `WIPE_SET`'i çözer, her raporu RFC-0003 §8 adım 6'daki gibi doğrular. Bir parça başka bir silme oturumundan geldiyse imza tutmaz ve telefon baştan okutmayı ister.

**Birden çok disk:** RFC-0003 §8 tek rapor varsayıyor. Bu RFC şunu ekler:

- Telefon her raporu "Ebeveynler" koleksiyonuna ayrı `hf.wipe.report` kaydı olarak yazar.
- Tek disk varsa `wipeReportHash` RFC-0003'teki gibidir.
- Birden çok disk varsa: `wipeReportHash = hash('hf/wipe-report-set/', h₁ ‖ h₂ ‖ … )`. `hᵢ` her raporun `hash('hf/wipe-report-id/', …)` değeridir ve bayt sırasıyla küçükten büyüğe dizilir.
- Herhangi bir rapor `hata` ise telefon `DEVICE_DETACH` yazmadan önce uyarır ve ebeveynden açık onay ister.

**Birleşik cihazda** aynı rapor kümesi iki kimliği de kapatır: telefon işçi için `DEVICE_DETACH { wipe: true, wipeReportHash }`, kutu için `REMOVE_MEMBER { reason: 'wipe:' + hex(wipeReportHash) }` yazar.

### 13.6 `NODE_RECOVERY` (0xDE)

```
NODE_RECOVERY {
  nodeId : fixed16
  kind   : string ('luks-kurtarma' | 'alindi')
  secret : buffer                       // luks-kurtarma: 32 B anahtar; alindi: boş
  sig    : fixed64                      // gönderen; etiket 'hf/node-recovery/'
}
```

- Düğümden yalnız törendeki ebeveynin telefonuna, yalnız doğrudan Noise oturumunda gider. Emanete ve Posta Kutusu'na hiç girmez.
- Telefon kaydı yazınca `kind = 'alindi'`, kendi imzasıyla döner. Düğüm imzacının töreni yapan ebeveyn olduğunu denetler ve dosyayı siler.

## 14. Numaralar

| Tür | Numara |
|-----|--------|
| Zarflar | `0xD8 NODE_HEALTH`, `0xD9 UPDATE_HAVE`, `0xDA UPDATE_REQ`, `0xDB UPDATE_DATA`, `0xDC UPDATE_APPROVE`, `0xDD RETIRE_STATE`, `0xDE NODE_RECOVERY`. `0xDF` bu RFC'ye ayrılmış, boş. |
| Emanet mührü | RFC-0003 §6.4'teki K12 mühür kuralı `0xD8–0xDF` aralığının tamamını kapsar: bu aralıktaki bir zarf emanet yolundan geçecekse aynı mühürle (`derive(pair, 'ctrl')`, AD = gönderen ‖ alıcı ‖ tür ‖ zarf id) kapatılır; `CTRL_TYPES` bunları kapsar. Bugün emanetten geçebilenler yalnız `UPDATE_APPROVE` ve `RETIRE_STATE`'tir. `NODE_HEALTH`, `UPDATE_HAVE`, `UPDATE_REQ`, `UPDATE_DATA` ve `NODE_RECOVERY` yalnız doğrudan oturumdadır; emanetten gelirlerse atılır. Posta Kutusu'na hiçbiri gitmez. |
| Etiketler | `hf/node-health/`, `hf/update-approve/`, `hf/retire-state/`, `hf/node-recovery/`, `hf/release/`, `hf/release-pkg/`, `hf/release-root/`, `hf/root-rotation/`, `hf/wipe-report-set/`. RFC-0003'ten kullanılan: `hf/wipe-report/`, `hf/wipe-report-id/`. |
| QR önekleri | `HFK1:` anahtar QR'ı, `HFW1:` rapor parçaları (RFC-0003), `HFRT1` ESP bileti (QR değil) |
| Yerel IPC türleri | 1–23 (§6.3); 24–39 bu RFC'ye ayrılmış; 40–49 RFC-0008 (40–43 kullanılıyor). Zarf türü değildir. |
| Defter olayı, HELLO biti | Yok |
| Çekirdek komutları | **330–339** bu RFC'nindir: `330 HOME_MACHINE_HEALTH` (`health`), `331 HOME_MACHINE_HOSTS` (`hosts`), `332 UPDATE_APPROVE` (`approveUpdate`), `333 RECOVERY_KEY` (`recoveryKey`), `334 WIPE_KEY_READ` (`scanWipeKey`), `335 WIPE_PART_READ` (`scanWipePart`), `336 RETIRE_STATUS` (`retire-state` olayları). `337–339` ayrılmış, boş. |

`KARARLAR.md`'ye koda yazıldığı gün işlenir.

## 15. SDK yüzeyi (telefon)

Komut numaraları §14'tedir.

```ts
interface EvMakinesi {
  health(nodeId): Promise<NodeHealth | null>
  hosts(): Promise<Array<{ hostId, nodeIds: string[] }>>
  approveUpdate(nodeId, op: 'dusur' | 'kanal', target: { versionCode?, manifestHash?, channel? }): Promise<void>
  recoveryKey(nodeId): Promise<string>                 // biyometri ister
  scanWipeKey(qr: string): Promise<WipeSession>
  scanWipePart(session, qr: string): Promise<{ done: boolean, reports?: WipeReport[] }>
  on('health' | 'retire-state', (nodeId, data) => void)
}
```

## 16. Test vektörleri

`protocol/vectors/node.json`:

1. `RELEASE_MANIFEST` kodlaması ve imzası. Geçerli bildirim; bir bayt değişmiş paket → `DIGEST_MISMATCH`; yanlış `nextRootHash` → `COMMITMENT_ERROR`; `keyEpoch` ileri → `ROOT_EPOCH_ERROR`.
2. `ROOT_ROTATION`: taahhüde uyan anahtar → kabul; uymayan anahtar (eski kökle imzalı olsa bile) → `COMMITMENT_ERROR`; dönemi atlayan → `ROOT_EPOCH_ERROR`. Döndürmeden sonra eski kökle imzalı bildirim → `SIGNATURE_ERROR`.
3. Sürüm kararı tablosu: `(kurulu, enYuksek, gelen, onay var mı)` → `kur` / `yok-say` / `onay-gerekli` / `ara-surum`. `bozuk` işaretli sürüm yeniden denenmez.
4. `versionCode`: `'1.2.3'` → 1002003; `'1.1000.0'` → geçersiz.
5. `UPDATE_APPROVE`: geçerli düşürme; yetişkin imzası → `UNAUTHORIZED`; 25 saatlik `expiresAt` → `INVALID_DURATION`; aynı onay ikinci kez → `REPLAY`.
6. `NODE_HEALTH` kodlaması ve imzası; seçimli `battery` alanının varlık bayrağı.
7. Eşik tablosu: ölçüm girdileri → `status` ve `warnings` (ör. `healthPct = 39` → `PIL_KRITIK`, `bakim`).
8. Yeniden başlatma sırası: 7 kimlikli bir defterde her düğümün dakika kaydırması.
9. `HFRT1` bileti, `HFK1` anahtar QR'ı ve 3 diskli bir `WIPE_SET`'in 384 ve 128 baytlık parçalara bölünmesi; parça birleştirme; başka oturumdan gelen parçayla imza hatası.
10. `wipeReportHash`: tek disk (RFC-0003 tanımı) ve üç disk (küme özeti, sıralama).
11. Yöntem seçimi: disk yetenekleri girdisi → `method` ve `result` (NVMe yalnız şifreleme silme; donmuş SATA SSD; HPA'lı HDD; eMMC).
12. Yerel IPC çerçevesi: uzunluk öneki, 1 MiB sınırı, bilinmeyen tür → `HATA`.

## 17. Güvenlik değerlendirmesi

| Tehdit | Önlem |
|--------|-------|
| Kutu süreci işçinin gördüğü içeriği okur (birleşik cihaz) | Ayrı kullanıcılar, `0700` dizinler, ayrı mühürlü anahtarlar, ayrı soketler. Kök yetkisi alan saldırgana karşı korumaz; kurulum ekranı bunu söyler. |
| Görev konteynerinden kaçış | Kök olmayan Podman, ayrı kullanıcı `havenfold-task`, ağ kapalı (RFC-0002 §11.1). Kaçan süreç denetçinin güncelleme yetkisini ve çekirdeklerin anahtarlarını alamaz. |
| Denetçi ele geçirilir (indirdiği dosyadan) | Kök yetkisi yoktur. Yetki yardımcısı bildirimi ve özeti kendisi yeniden doğrular; liste dışı işlem yapmaz. Kimlik anahtarı denetçide yoktur. |
| Kötü niyetli güncelleme (T7) | Çevrimdışı kökle imzalı bildirim; özet denetimi; sürüm düşürme ebeveyn imzası ister. |
| T21 · Kök anahtar çalınır | Önceden taahhüt edilen yedek kök: hırsız kendi anahtarını kök yapamaz. Asıl sahip yedeğe geçince çalınan anahtar etkisiz kalır. Geçiş süresince hırsız sahte bildirim imzalayabilir; bu sürede düğümler `kararli` kanalda gece penceresini bekler, bu da fark etme süresi kazandırır. |
| İndirme kaynağı yeni sürümü saklar (donma) | Telefondaki `minNodeVersionCode` ve 30 günlük uyarı (§12.3). |
| Sahte görev imajı (T10) | `oci-archive` özeti ve `ociDigest` iki kez denetlenir; çağrı özetle yapılır. |
| Topluluktaki bir düğüm bozuk paket verir | Özet tutmaz, dosya atılır; eş 24 saat kaynak dışı bırakılır. |
| USB'den sır sızması | USB'de sır yoktur. LUKS geçici parolası yalnız kurulum ortamının RAM'indedir; ilk açılışta yuvası silinir; kurulum günlükleri temizlenir. |
| Disk sökülüp okunur (T1, T2) | TPM'li düğümde LUKS2 + PCR 7. TPM'siz düğümde kurucu belge §9.2'deki sınırlar. |
| Aynı makine imzalı başka sistemle açılır | PCR 7 aynı kalabilir; disk açılabilir (§8.5 dürüst sınır). Açığa çıkan, kimlik ve emanet üst bilgisidir; içerik değil. |
| Sahte silme raporu (T3) | Rapor anahtarını ağsız, RAM'de çalışan silme ortamı üretir; açık yarısı silmeden önce QR ile telefona geçer; bilet ve `retireNonce` silme oturumunu bu emekliliğe bağlar. |
| Silme ortamı yanlış diski siler | Varsayılan menü seçeneği silmez; açılış USB'si dışlanır; harici diskler ayrıca onay ister; "SIL" yazılmadan başlamaz. |
| Sağlık bilgisinden parmak izi | `NODE_HEALTH` yalnız ebeveynlere, doğrudan oturumda gider; seri numarası taşımaz; Eser'e gitmez. |
| Kurtarma anahtarı sızar | Yalnız doğrudan oturumda, töreni yapan ebeveyne; telefonda Kasa koleksiyonunda; düğümde teslimden sonra silinir. Kurtarma anahtarı yalnız o düğümün diskini açar; zarflar yine uçtan uca şifrelidir. |
| Güncelleme sunucusu izler (T11) | §12.8: IP, zaman, sürüm görülür; kimlik ve donanım bilgisi gönderilmez; topluluk içi paylaşım istek sayısını azaltır. |

## 18. Kurucu belgede değişecekler

| Bölüm | Değişiklik |
|-------|------------|
| §5.1 tablo, "Düğüm yazılımı" | Çekirdekler Bare, denetçi Node 24 LTS (§4.1). "Görev imajları" satırına: `oci-archive` dosyası olarak, bildirimdeki özetle dağıtılır. |
| §6.1 Birleşik cihaz | "Tek törende iki kimlik birlikte eklenir" yerine: "Tek kurulum oturumunda art arda iki tören yapılır (önce kutu, sonra işçi). Kimlikler `hostId` ile aynı kartta gösterilir." |
| §9.1 tablo, "Servis" | Birimlere `havenfold-yetki` (soketle açılan, sabit işlem listeli kök yardımcısı) eklenir. "Çalışma ortamı" satırı: "Çekirdek Bare, denetçi Node 24 LTS; ikisi de paketle gelir." |
| §9.2 Disk şifreleme | "LUKS + TPM ile otomatik açılış" yerine: "Kurulum USB'siyle kurulan TPM'li düğümde LUKS2 + Clevis, PCR 7. Kurtarma anahtarı törenden sonra ebeveyn telefonuna geçer ve Kasa koleksiyonuna yazılır. Aynı makineyi imzalı başka sistemle açan saldırgana karşı koruma sınırlıdır (RFC-0007 §8.5). Var olan Ubuntu'ya `havenfold kur` ile kurulan düğümde disk şifrelenmez; TPM varsa kimlik ve kasa payları yine TPM'ye mühürlüdür." Ayrıca: "Wi-Fi parolası USB'de bulunmaz; ilk açılışta yerelde sorulur." |
| §9.2 TPM ve kasa payı | Ek: "Kimlik anahtarı ve kasa payları TPM'ye PCR'sız mühürlüdür (RFC-0004 §3.1 dürüst sınırı); disk şifrelemesinin PCR 7 bağı paylara koşul getirmez." |
| §6.5 | "0x80–0x9F aralığındaki bütün zarflar…" kuralı `0xD8–0xDF`'yi de kapsar. |
| §13.2 "Protokolün dışında" | Eklenir: "SHA-256 (OCI imaj özeti ve Kurulum USB'si imajı; araçların kendi denetimi için)". |
| §9.3 | Pil maddesindeki üreticiye ve belirli cihazlara ait örnekler çıkarılır. Yerine: "Önce çekirdeğin `charge_control_*_threshold` arayüzü (%60–80), sonra üreticinin koruma modu, yoksa 'pil sınırı yok' uyarısı." Yeniden başlatma sırası RFC-0007 §12.7'ye bağlanır. |
| §9.4 Kök anahtar | "Tek bir çevrimdışı Ed25519 sürüm anahtarı" yerine: "Çevrimdışı Ed25519 kök anahtar ve ayrı yerde saklanan, özeti her bildirimde önceden taahhüt edilen yedek kök anahtar (RFC-0007 §12.2)." |
| §9.4 Sürüm bildirimi | Ürün bildirimleri (kapalı görev imajları aynı kökle, ayrı bildirimle), topluluk içi paylaşım, kanal değişiminin de ebeveyn onayı istediği ve donma saldırısı notu eklenir. |
| §9.5 | Adım 2'ye ESP bileti ve `retireNonce`; adım 4 tablosuna eMMC satırı ve "blok silme şifreleme silmeden önce"; adım 5'e "birden çok diskte rapor kümesi özeti" eklenir. |
| §9.6 | Eşikler RFC-0007 §11.2'ye bağlanır (%60 uyarı, %40 ve 50 °C'de bakım durumu, prizden çıkınca %15'te düzgün kapanış). |
| §11 tablo | Satır eklenir: "Güncelleme kaynağı · bildirim, paket, imaj · IP, zaman, sürüm". `NODE_HEALTH` Posta Kutusu'na gitmez notu. |
| §13.1 | T7'ye "kanal değişimi de onay ister"; yeni satır: "T21 · Kök anahtar çalınır → önceden taahhüt edilen yedek köke geçiş". |
| §20 Faz 1 | `hf.task.wipe-report` ifadesi çıkarılır (kurucu belge §22.2'de zaten değişti, tablo düzeltilir). |
| RFC-0003 §6.1 oturum tablosu | "Cihaz ↔ cihaz" ve "üye(kutu) ↔ cihaz" satırlarına `UPDATE_HAVE`, `UPDATE_REQ`, `UPDATE_DATA` eklenir. |
| RFC-0003 §6.4 | Mühür kuralı `0xD8–0xDF` için de geçerlidir (`ctrl` anahtarı). |
| RFC-0003 §8 adım 3 ve 7 | Anahtar QR'ı `HFK1` biçimindedir ve `deviceId` yerine bilet kimliklerini (`ids`, `hostId`, `retireNonce`) taşır. Birden çok disk için `hf/wipe-report-set/` kuralı eklenir. |
| Numara tablosu | Çekirdek komutları 330–339 bu RFC'nindir. |

## 19. Uygulama sırası

1. Paket düzeni, kullanıcılar, systemd birimleri, yerel IPC (1–13, 21, 23), `havenfold durum` ve `katil`. Vektör 12.
2. `NODE_HEALTH` ve eşikler; telefonda Ev Makinesi sağlık görünümü. Vektörler 6–7.
3. Sürüm bildirimi, kök durumu ve döndürme, `surum.durum`, yetki yardımcısının `paket-ac` / `surum-gec` / `surum-geri` işlemleri, sağlık denetimli geri dönüş. Vektörler 1–5.
4. `havenfold kur` (var olan Ubuntu) ve laptop ayarları. Faz 1'in çıkış ölçütü (kurucu belge §20) bu adımla denenir.
5. Silme ortamı: disk keşfi, yöntem seçimi, rapor ve QR; telefon tarafında okutma ve kayıt. Vektörler 9–11.
6. Kurulum USB'si: autoinstall, ön kontrol, LUKS + Clevis, ilk açılış, kurtarma anahtarı. Elle kurulum Faz 1, herkese Faz 3.
7. Topluluk içi paylaşım (`UPDATE_HAVE/REQ/DATA`) ve `UPDATE_APPROVE`.
8. Yeniden başlatma sırası ve bakım penceresi. Vektör 8.

## Ek: RFC-0033 (onaylı, 24 Ekim 2026)

- **Çalışma ortamı** (RFC-0033 §9 c): kutu, işçi ve silme ortamı Bare desteği gelene kadar (İstek 151) Node'da çalışır; birimler paketteki `node`'u çağırır.
- **Soketler** (§9 d, f): denetçi yönetim soketi `/run/havenfold/denetci-yonetim/yonetim.sock` (§5 ve §6.1 güncellendi; RFC-0026 f). Podman soketi `/run/havenfold/podman/podman.sock`, `havenfold-podman` grubu (görev kullanıcısı ve denetçi; işçi konteyner başlatamaz).
- **`SAGLIK_ANLIK`** (§9 e, p): `caps` yerel IPC'de JSON (§6.3); `MERHABA`'dan sonra bir kez gönderilir, değişen alanları işçi kendi ölçer.
- **SO_PEERCRED** (§9 l): yerel eklenti yazılmaz; yerel soketlerde yetki dosya izni ve grup üyeliğiyle verilir. Birleşik düğümde `PEERCRED_YOK` ile açılmama kuralı sürer.
- **Paket biçimi** (§9 g): düğüm paketi kanonik `.zip` (yetki yardımcısı ve `node.json` vektörleriyle aynı); §8.1'deki `.tar.zst` yerine.
- **ISO özeti** (§9 h): ISO'nun SHA-256'sı sürüm bildirimine girmez; yayında ayrı `SHA256SUMS`, sürüm kök anahtarıyla ayrıca imzalı (`SHA256SUMS.sig`).
- **Silme ortamı** (§9 i, j): QR metin konsolunda 128 baytlık parçalar. Biletsiz oturum `verifyWipe(..., { biletsiz: true })` ile yalnız §13.5'teki sıfır alanlarla kabul edilir, sonuçta `biletsiz: true`; telefon §13.2 adım 4'teki soruyu sorar.
- **`havenfold ilk-ayar`** (§9 k): `--kurulum` yalnız `host.id` üretir; `--rol isci|kutu|birlesik` rolün kimliğini kutu çekirdeğinin kalıcı katmanıyla yazar (`<rol dizini>/cekirdek`, anahtarlar TPM'ye mühürlü `platform.muhur`, `arsiv.muhur`); `<rol dizini>/kimlik` işareti sır taşımaz.
- **Yetki yardımcısının soketi** (RFC-0033 §9 l): `/run/havenfold/yetki/yetki.sock`, dizin `0750 root:havenfold-denetci`, soket `0660` (`havenfold-yetki.socket`). `/run/havenfold` herkese açık olduğu için soket kendi dizinindedir. Dizine yalnız denetçi (ve kök) girer; soketten gelen istek denetçi sayılır, yardımcı yine her işlemin kendi çağıran kuralını uygular. `havenfold` komutu sudo ile köktür.
- **Çekirdeklerin sağlık bildirimi** (RFC-0026 d): çekirdekler yardımcının soketine giremez; sağlığı denetçiye bildirir, denetçi kendi kimliğiyle yardımcıya iletir (`saglik-bildir`).
- **IPC 22 (`RECOVERY_KEY`)**: cevap gövdesi `{ var, anahtar }`, aynı türün cevap yönü (`MERHABA` gibi); `NODE_RECOVERY` (0xDE) yalnız törendeki ebeveyne gider, onun imzalı alındısıyla düğümde silinir; telefon anahtarı Kasa'ya, Kasa yoksa Ebeveynler'e `hf.node.luks-kurtarma` kaydı olarak yazar; kasa kilitliyse alındı vermez, düğüm sonra yeniden yollar.
- **Disk şifreleme** Clevis ile (§8.5, değişmedi); kurtarma parolası Crockford base32, küçük harf, 52 karakter; kurtarma yuvası `havenfold-kurtarma` LUKS2 jetonuyla işaretli.
