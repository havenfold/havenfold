# RFC-0011 — Konteyner uygulamaları (`havenfold.yaml`) ve yerel servis tüneli

> Durum: **Onaylandı** (Kerem, 23 Ekim 2026) · 23 Ekim 2026 · Yazan: Havenfold çekirdek ekibi · Onay: Kerem
> Kurucu belge: §3 (H1, H3, H4, H7; ilke 4, 5, 9), §8.3, §8.7, §9.4, §11 (yerel servis tüneli), §14.2, §16.2, §20 (Faz 4).
> Bağımlılık: RFC-0002 (`NODE_CAPS`, çalıştırma ortamı, görev imajlarının imza düzeni), RFC-0003 (bağlı cihaz, oturum rolleri, emanet mührü), RFC-0001 (dosya biçimi, `BLOB_*`), RFC-0009 (düğüme dışarıdan ulaşma yolları).
> Kod yeri: `havenfold/node/uygulama` (denetçinin uygulama yöneticisi ve HTTP vekili), `havenfold/core/uygulama` (`@havenfold/uygulama`: zarflar, tünel istemcisi), `havenfold/katalog` (Eser seçkisi), `havenfold/integrations/home-assistant` (Apache-2.0).

## 1. Sorun

Aileler evdeki işçide Home Assistant, Immich, Paperless-ngx, Jellyfin ya da Vaultwarden gibi hazır yazılımlar çalıştırmak istiyor. Bugün bunun için:

- yazılımın portunu ev ağına ya da internete açmak,
- ayrı bir VPN kurmak,
- her uygulamaya ayrı güvenmek

gerekiyor. Kurucu belge §14.2 bir bildirim biçimi önerdi ama izinleri, imzayı, kurulumu, telefondan erişimi ve yedeği tanımlamadı.

## 2. Öneri özeti

- **Biçim:** Özetle sabitlenmiş OCI imajı + `havenfold.yaml` bildirimi. Ağ, cihaz ve veri izinleri varsayılan olarak **kapalıdır**; her açılan izin ebeveyne tek tek gösterilir.
- **Köken:** Eser'in imzalı seçkisi (katalog) ya da kullanıcının kendi eklediği uygulama. İkincisi kırmızı uyarı ve ayrı bir onay ister.
- **Yönetim:** Kurma, güncelleme, kaldırma ve erişim listesi yalnız ebeveynin imzalı komutuyla olur. Uygulama yalnız işçide çalışır; kutuda ve telefonda hiç çalışmaz.
- **Yerleştirme:** `NODE_CAPS` ve düğümün uygulama durumundan, belirlenimci sıralamayla.
- **Erişim:** Telefon uygulamanın web arayüzüne var olan Noise oturumunun içinden açılan **yerel servis tüneliyle** ulaşır. Uygulamanın portu ev ağına ve internete açılmaz. Kim hangi uygulamayı açabilir, defterdeki kimliğe göre düğüm karar verir.
- **Veri:** Dışa aktarma açık biçimde (tar). Gece yedeği, ailenin başka bir düğümüne şifreli.
- **İlk uygulama Home Assistant.** Havenfold düğümleri Home Assistant'ta cihaz olarak görünür. Ters yön v1'de yoktur.
- **Dürüst not:** Uygulama içeriği uçtan uca şifreli değildir. Evdedir, internete açık değildir.
- Yeni algoritma yok. Yeni defter olayı yok.

## 3. Tanımlar ve kodlama

| Ad | Anlam |
|----|-------|
| **Uygulama** | Bir işçide sürekli çalışan konteyner yazılımı. Görevden (RFC-0002) farkı: süresizdir, kendi kalıcı verisi ve web arayüzü vardır. |
| **Ev sahibi düğüm** | Uygulamanın çalıştığı işçi. |
| **Bildirim** | `havenfold.yaml` dosyasının baytları. |
| **Seçki** | Eser'in incelediği uygulamaların imzalı listesi (katalog). |
| `appId` | Ters alan adı biçiminde kimlik (`org.home-assistant.core`), ≤ 128 B, `[a-z0-9.-]`. |
| `rev` | Uygulamanın ev sahibi düğümdeki değişiklik sayacı. Kurulumda 0, uygulanan her komutta 1 artar. |

Kodlama kuralları RFC-0001 §3'tekiyle aynıdır. İmzalı her mesajda `body` = `sig` dışındaki alanların kodlaması, `sig = Ed25519(imzalayan, hash('<etiket>', familyId, body))`. Tek istisna topluluğa bağlı olmayan `KATALOG`'dur: `sig = Ed25519(katalog anahtarı, hash('hf/app-catalog/', body))` (RFC-0007 §3'teki sürüm bildirimi düzeni).

## 4. Bildirim: `havenfold.yaml`

### 4.1 Örnek

```yaml
format: 1
id: org.home-assistant.core
name: Home Assistant
version: 2026.10.2
license: Apache-2.0
source: https://github.com/home-assistant/core
image:
  amd64: ghcr.io/home-assistant/home-assistant@sha256:<64 hex>
  arm64: ghcr.io/home-assistant/home-assistant@sha256:<64 hex>
needs: { ramMB: 1024, ramMaxMB: 2048, diskGB: 10, cpus: 2, onAC: true }
ui:
  - { name: Arayüz, port: 8123, path: /, websocket: true }
auth: { mode: none }
network: [lan, internet]
lanInbound: []
devices:
  - { kind: usb, vid: "10c4", pid: "ea60", optional: true, why: "Zigbee çubuğu" }
caps: [NET_RAW]
data: [node-status]
volumes:
  - { name: config, path: /config, backup: true, sizeGB: 5 }
seed:
  - { from: "havenfold:integrations/home-assistant", to: "config:custom_components/havenfold" }
secrets: []
env: { TZ: Europe/Istanbul }
health: { http: { port: 8123, path: /manifest.json }, startSec: 300 }
```

### 4.2 Alanlar

| Alan | Zorunlu | Kural |
|------|---------|-------|
| `format` | ✓ | `1` |
| `id`, `name`, `version` | ✓ | `version` serbest metin, ≤ 32 B |
| `license`, `source` | ✓ | SPDX adı ve kaynak adresi. Arayüzde gösterilir. |
| `image` | ✓ | Mimari → `<depo>@sha256:<özet>`. Etiket (`:latest`) kabul edilmez. Mimariler: `amd64`, `arm64`. |
| `needs` | ✓ | `ramMB` (ayrılan), `ramMaxMB` (sert sınır, varsayılan `2 × ramMB`), `diskGB`, `cpus`, `onAC` (varsayılan `true`) |
| `ui` | — | En çok 4 arayüz. `port` konteyner içindeki TCP portu. Tünelin hedefidir. Ağ izni sayılmaz. |
| `auth` | — | `mode: none` (uygulamanın kendi girişi) ya da `mode: header` + `header: <ad>` + `value: memberId | name` (§9.4) |
| `network` | — | Boş liste ya da `lan`, `internet`. Varsayılan boş. |
| `lanInbound` | — | Ev ağından gelen bağlantıya açılacak TCP portları. Varsayılan boş. Yalnız `lan` ile. |
| `devices` | — | `{ kind: usb, vid, pid, optional, why }` ya da `{ kind: gpu, why }` |
| `caps` | — | Yalnız `NET_RAW`, yalnız `lan` ile |
| `data` | — | Boş liste ya da `node-status` (§11.2). Varsayılan boş. |
| `volumes` | — | En çok 8. `backup` varsayılan `true`. `sizeGB` uyarı eşiğidir. |
| `seed` | — | Yalnız Havenfold sürüm paketindeki dosyalardan (`havenfold:` öneki). Kurulumda bir kez kopyalanır. |
| `secrets` | — | `{ name, bytes }`. Düğüm kurulumda rastgele üretir, dosya olarak verir. Düğümden çıkmaz. |
| `env` | — | Gizli olmayan ayarlar |
| `health` | — | HTTP denetimi ve ilk açılış süresi. Güncellemede geri dönüş kararı buna bakar (§7.4). |

**Bilinmeyen alan bildirimi geçersiz kılar** (`BILDIRIM_GECERSIZ`). Yeni alan yeni `format` ile gelir.

### 4.3 İzinlerin anlamı

| İzin | Kapalıyken | Açılınca |
|------|------------|----------|
| (yok) | Uygulamanın tek ağ bağı düğümle arasındaki iç arayüzdür. Dışarı yolu yoktur. | — |
| `internet` | — | Genel internete çıkış. Özel adreslere (RFC 1918, `100.64.0.0/10`, bağlantı-yerel, ULA, çok noktaya yayın) ve düğümün kendi adreslerine çıkış kapalı. DNS, özel adres döndüren cevapları atan düğüm içi bir iletici üzerinden. |
| `lan` | — | Ev ağında kendi adresiyle (macvlan) bulunur. Ev ağına çıkış ve keşif (mDNS 5353, SSDP 1900) açık. Düğümün kendi adreslerine çıkış kapalı. Gelen bağlantı yalnız kurulmuş bağlantılara cevap. |
| `lanInbound` | — | Listelenen TCP portlarına ev ağından gelen bağlantı. İnternetten asla. |
| `devices` | — | Yalnız eşleşen USB aygıtı ya da `/dev/dri` render düğümü. |
| `caps: [NET_RAW]` | — | Kendi ağ ad alanında ham soket (ör. DHCP keşfi). |
| `data: [node-status]` | — | Ailenin düğümlerinin durum bilgisine salt okunur erişim (§11.2). |

**Hiçbir zaman verilmeyenler:** düğümün ağ ad alanı (`--network=host`), ayrıcalıklı konteyner, konteyner çalıştırıcısının soketi, düğümün dosya sistemi, Havenfold anahtarları ve soketleri, Bluetooth.

- **Bluetooth v1'de yoktur.** Paylaşmak için düğümün BlueZ D-Bus'ına erişim gerekir. Bu, konteynere düğümün sistem servislerine kapı açar ve afet modunun (RFC-0012) Bluetooth kullanımıyla çakışır.
- **`collection:*` v1'de yoktur.** Kurucu §14.2: uygulamalar koleksiyonları okuyamaz. SDK'daki açık izin ayrı bir RFC'yle gelir. Bildirimde `collection:` görülürse `VERI_IZNI_YOK`.

### 4.4 Özet

```
manifestHash = hash('hf/app-manifest/', bildirimin baytları)
```

Bildirim yeniden kodlanmaz; dosyanın baytları imzalanır ve özetlenir (RFC-0001 §3 kuralı).

## 5. Köken

### 5.1 Eser seçkisi

```
KATALOG {
  seq      : uint                   // yalnız artar
  issuedAt : uint
  entries  : array<{
    id           : string
    version      : string
    manifestHash : fixed32
    images       : array<{ arch: string, digest: fixed32 }>
    risk         : string            // 'dusuk' | 'orta' | 'yuksek'
    security     : bool              // güvenlik düzeltmesi
    revoked      : bool
    advisory     : string            // geri çekmede ya da uyarıda gösterilecek metin
    minNode      : string            // en düşük havenfold-node sürümü
  }>
  sig      : fixed64                 // Ed25519(katalog anahtarı, hash('hf/app-catalog/', body)); familyId yok
}
```

- **Anahtar zinciri:** Kök sürüm anahtarı (kurucu §9.4) imzalı `havenfold-node` sürüm bildirimine katalog anahtarının açık yarısını ve geçerlilik sonunu yazar: `catalogKeys: [{ pub, validUntil }]` (RFC-0007 §12.1). Katalog anahtarı da çevrimdışıdır ama kök anahtardan ayrıdır. Böylece her uygulama güncellemesi için kök anahtar çıkarılmaz; katalog anahtarı ele geçirilirse kök anahtar yeni sürüm bildirimiyle onu değiştirir.
- **İnceleme:** Eser imajı kendisi derlemez. Üst kaynağın imajını inceler: lisans, istenen izinler, varsayılan parolalar, dışarı veri gönderen özellikler. Özeti sabitler. `risk` bu incelemenin özetidir.
- **Dağıtım:** Düğüm kataloğu günde bir kez Eser'in dağıtım adresinden çeker. `seq` düşükse reddeder (geri sarma koruması). Dağıtım sunucusu düğümün IP'sini görür (kurucu T11).

### 5.2 Kullanıcının eklediği uygulama

- **Varsayılan kapalıdır.** Ebeveyn "Ayarlar → Ev Makinesi → Kendi uygulamalarımı ekleyebileyim" anahtarını açar.
- Bildirim bir HTTPS adresinden ya da dosyadan gelir. İmaj yalnız özetle kabul edilir; kullanıcı etiket verirse telefon bir kez çözer, özeti gösterir ve onu sabitler.
- Kurulum ekranı kırmızı uyarı gösterir: "Eser bu uygulamayı incelemedi. Ailenizin evindeki bir bilgisayarda, istediği izinlerle çalışacak." Her izin ayrı satırda, ayrı onay kutusuyla.
- Komutta `grants.userAck = true` zorunludur. Ebeveyn biyometriyle imzalar.
- Kendiliğinden güncellenmez.

### 5.3 Geri çekme

Seçki bir sürümü `revoked = true` yaparsa:

- Düğüm ebeveynlere `advisory` metniyle bildirim gönderir.
- Uygulama **durdurulmaz**. Evdeki otomasyonu bir anda kesmek ailenin güvenliğini de bozabilir.
- `risk = 'yuksek'` ise düğüm uygulamanın `internet` ve `lanInbound` izinlerini askıya alır. Ebeveyn güncelleyene ya da "Yine de aç" diyene kadar askıda kalır.

## 6. Yerleştirme

Telefon ev sahibi düğümü önerir. Ebeveyn başka bir işçi seçebilir.

1. **Adaylar:** Aşağıdakilerin hepsini sağlayan bağlı cihazlar:
   - `class = 'isci'`, `os` Linux, son 15 dakikada `NODE_CAPS` gelmiş;
   - `arch` bildirimin `image` anahtarlarından biri;
   - `status ∉ {'sicak', 'bakim'}`; `needs.onAC` ise `battery = null` ya da `onAC = true`;
   - `ramTotalMB − 2048 − reservedRamMB ≥ needs.ramMB` (`reservedRamMB` düğümün `APP_STATE`'inden);
   - `diskFreeGB ≥ needs.diskGB + Σ volumes.sizeGB + 5`;
   - zorunlu (`optional: false`) her USB aygıtı düğümün `APP_STATE.usb` listesinde.
2. **Sıralama:** Önce diski şifreli düğümler (`NODE_HEALTH.platform.disk = 'luks-tpm'`, RFC-0007 §11.1; öneriyi yapan ebeveyn telefonu bu bildirimi alır); sonra yerleştirmeden sonra kalan bellek büyük olan; sonra `deviceId` bayt sırasıyla küçük olan.
3. **Aday yoksa:** "Bu uygulama için evde uygun bilgisayar yok" ve eksik olan yazılır.

- Kutu, telefon, eski Android ve uç cihazlar hiçbir zaman aday değildir. Birleşik cihazda uygulama işçi kimliğiyle çalışır (H4).
- **Görevlerle ilişki:** Ev sahibi düğüm `NODE_CAPS.maxTaskRamMB`'yi `ramTotalMB − 1024 − Σ görev limits.ramMB − reservedRamMB` olarak hesaplar. Uygulamalar her zaman en az 1 GB'ı görevlere bırakır (`2048` payı).

## 7. Kurma, güncelleme, kaldırma

### 7.1 `APP_CMD` (0xAD)

```
APP_CMD {
  cmdId     : fixed16
  nodeId    : fixed16                // ev sahibi düğüm
  appId     : string
  op        : uint                   // 0 kur, 1 güncelle, 2 kaldır, 3 erişim, 4 durdur, 5 başlat, 6 geri yükle, 7 dışa aktar
  rev       : uint                   // düğümdeki güncel rev; kurulumda 0
  origin?   : uint                   // 0, 1: 0 Eser seçkisi, 1 kullanıcı
  manifest? : buffer                 // 0, 1: bildirimin baytları
  grants?   : Grants                 // 0, 1
  access?   : array<string>          // 0, 3
  keepData? : bool                   // 2
  restore?  : { key: fixed32, from: fixed16, indexBlobId: fixed32 }   // 6; 0 ile birlikte "yedekten kur"
  exportKey?: fixed32                // 7
  by        : fixed16
  ledgerSeq : uint
  sig       : fixed64                // ebeveyn, etiket 'hf/app-cmd/'
}

Grants {
  network      : array<string>
  lanInbound   : array<uint>
  devices      : array<string>       // 'usb:<vid>:<pid>' | 'gpu'
  caps         : array<string>
  data         : array<string>
  autoSecurity : bool                // seçki güvenlik düzeltmelerini kendiliğinden kur (varsayılan true)
  backup       : { targets: array<fixed16>, maxGB: uint }
  userAck      : bool
}
```

- **Taşıma:** Doğrudan oturumda; emanet ve Posta Kutusu yolunda RFC-0003 §6.4 mührüyle (`ctrl`).
- **Kim:** Yalnız aktif ebeveyn. Uygulamalar ailenin donanımında, ağ izinleriyle çalışır; işçiyi de yalnız ebeveyn ekler (RFC-0003 §5.1). Yetişkin ve çocuk komut veremez, erişim listesindeyse açabilir.

### 7.2 Düğümün denetimi

Düğüm komutu sırayla denetler. Biri tutmazsa `APP_CMD_RES { ok: false, code }` döner.

| # | Denetim | Hata |
|---|---------|------|
| 1 | `nodeId` kendisi; `sig` `by`'ın anahtarıyla geçerli | `WRONG_NODE`, `INVALID_SIGNATURE` |
| 2 | `by` düğümün güncel defterinde aktif ebeveyn | `UNAUTHORIZED` |
| 3 | `rev` düğümdeki güncel değer. Kurulumda uygulama yok ve `rev = 0`. | `REV_ESKI`, `UYGULAMA_VAR`, `UYGULAMA_YOK` |
| 4 | Aynı `cmdId` daha önce görülmemiş (30 gün saklanır) | `REPLAY` |
| 5 | Bildirim geçerli (§4.2), `appId` bildirimdekiyle aynı | `BILDIRIM_GECERSIZ` |
| 6 | `origin = 0` ise düğümün en güncel kataloğunda `(id, version, manifestHash)` var, `revoked = false`, imaj özeti eşleşiyor. Katalog eskiyse önce yenilenir. | `KATALOGDA_YOK`, `GERI_CEKILMIS` |
| 7 | `origin = 1` ise ailenin ayarı açık ve `userAck = true` | `KULLANICI_UYGULAMASI_KAPALI` |
| 8 | `grants` bildirimde istenenin alt kümesi. İstenip verilmeyen izin olabilir; uygulama onsuz çalışır. | `IZIN_FAZLA` |
| 9 | `access` öğeleri geçerli öznelerdir (§9.5) | `ERISIM_GECERSIZ` |
| 10 | §6'daki kaynak koşulları bu düğümde sağlanıyor | `NO_SOURCE` |
| 11 | `backup.targets` aktif kutu ya da işçi; ev sahibi değil | `YEDEK_HEDEFI_GECERSIZ` |

**Belirlenimcilik:** Uygulamanın durumu yalnız ev sahibi düğümde tutulur; paylaşılan, çoğaltılan bir durum değildir. İki ebeveynin çakışan komutu `rev` ile çözülür: ilk uygulanan `rev`'i artırır, ikincisi `REV_ESKI` alır ve telefon güncel durumu gösterip yeniden sorar. Saat ve geliş sırası başka hiçbir kararda kullanılmaz.

### 7.3 Kurma

1. İmaj özetle çekilir ve doğrulanır. İmajı çekmek için düğüm internete çıkar; konteyner çıkmaz.
2. Uygulamaya ayrı bir sistem kullanıcısı açılır (`hfapp-<appId özeti, 8 hex>`), Podman kök olmayan kip.
3. Birimler `/var/lib/havenfold/uygulama/<appId>/` altında açılır. Kurulum USB'siyle kurulmuş TPM'li düğümde disk LUKS ile şifrelidir. Diski şifresiz düğümde (`disk = 'sifresiz'`) arayüz yazar: "Bu bilgisayarda disk şifrelemesi yok. Bilgisayar çalınırsa uygulamanın verisi okunabilir."
4. `seed` dosyaları kopyalanır, `secrets` üretilir.
5. Ağ ad alanı ve kurallar kurulur (§8), konteyner başlar, `health` beklenir.
6. Düğüm 32 baytlık rastgele `appBackupKey` üretir. `APP_CMD_RES` ile komutu veren ebeveyne gider (§10.2).

### 7.4 Güncelleme

| Durum | Kim başlatır |
|-------|--------------|
| Seçkide `security = true`, yeni izin istemiyor, `autoSecurity = true` | Düğüm kendisi, gece 03:00–05:00 arası |
| Diğer seçki güncellemeleri | `APP_STATE.updateAvailable` ebeveyne görünür; ebeveyn `op = 1` yollar |
| Yeni izin isteyen sürüm | Her zaman ebeveyn; yeni izinler ayrı satırda gösterilir |
| Kullanıcının eklediği uygulama | Yalnız ebeveyn, yeni bildirimle |

Adımlar:

1. Yeni imaj çekilir ve doğrulanır.
2. Uygulama durdurulur. Birimlerin anlık kopyası alınır (son bir kopya tutulur).
3. Yeni sürüm başlar. `health.startSec` içinde sağlıklı olmazsa durdurulur, kopya geri yüklenir, eski sürüm başlar. Sonuç kodu `GUNCELLEME_GERI_ALINDI`.

### 7.5 Kaldırma

1. Arayüz önce dışa aktarmayı önerir (§10.1).
2. Uygulama durdurulur, konteyner ve imaj silinir, kullanıcı ve ağ kuralları kaldırılır.
3. `keepData = false` ise birimler silinir. Diğer düğümlerdeki yedekler 30 gün sonra ev sahibinin `BLOB_DEL`'iyle silinir; bu sürede "Geri getir" mümkündür.
4. `keepData = true` ise birimler 90 gün durur, sonra ebeveyne sorulur.

### 7.6 Durum ve cevap

```
APP_CMD_RES (0xAF) {
  cmdId      : fixed16
  ok         : bool
  code       : string
  rev        : uint
  backupKey? : fixed32               // yalnız op 0'ın başarılı cevabında
}

APP_STATE (0xAE) {
  nodeId        : fixed16
  seq           : uint
  reservedRamMB : uint
  usb           : array<{ vid: string, pid: string, name: string }>
  apps          : array<{
    appId, name, version : string
    rev           : uint
    status        : string           // 'kuruluyor' | 'calisiyor' | 'durdu' | 'hata' | 'guncelleniyor'
    origin        : uint
    ui            : array<string>
    access        : array<string>
    grants        : Grants
    ramMB, diskMB : uint
    lastBackupAt  : uint
    updateAvailable : string         // boşsa yok
    advisory      : string
  }>
  sig           : fixed64            // düğüm, etiket 'hf/app-state/'
}
```

- `APP_STATE` ebeveynlere tam gider. Diğer üyelere yalnız açabildikleri uygulamalar listelenir; düğüm her alıcı için ayrı imzalar.
- İkisi de emanet ve Posta Kutusu yolunda RFC-0003 §6.4 mührüyle gider. `backupKey` taşıyan cevap yalnız doğrudan oturumda ya da mühürlü emanetle gider; Posta Kutusu'na gitmez.

## 8. Çalıştırma ortamı

| Ayar | Değer |
|------|-------|
| Çalıştırıcı | Podman, kök olmayan, uygulama başına ayrı kullanıcı |
| Kök dosya sistemi | Salt okunur. `/tmp` tmpfs. Birimler bildirimdeki yollarda. |
| Yetki | `--cap-drop=ALL` + verilen `caps`; `no-new-privileges`; varsayılan seccomp; `--pids-limit=1024` |
| Bellek ve işlemci | `--memory=ramMaxMB`, ayrılan `ramMB`; `--cpus=cpus` |
| İç arayüz | Her uygulamaya düğümle arasında ayrı bir veth çifti; `169.254.200.0/21` içinden uygulama başına bir `/30`. Tünel bu arayüzden uygulamanın `ui.port`'una bağlanır. |
| `internet` | Ayrı ağ ad alanında NAT ile çıkış. nftables §4.3'teki adresleri düşürür. DNS düğümdeki iletici üzerinden. |
| `lan` | macvlan ile ev ağında ayrı adres (DHCP). Gelen yalnız kurulmuş bağlantı ve keşif cevapları; `lanInbound` portları ayrıca açılır. |
| Aygıtlar | udev kuralı yalnız eşleşen aygıtı uygulama kullanıcısına verir. |
| Ağ kurulumu | Denetçi, yetki yardımcısının `uygulama-kur` / `uygulama-sil` işlemleriyle kurar (RFC-0007 §6.4; RFC-0002 §11.1'deki kamera ağ ad alanı gibi). Kök olmayan Podman bunu tek başına yapamaz. |
| Günlük | Konteyner günlüğü düğümde 7 gün, 50 MB. Telefona yalnız ebeveyn isteyince gider. |

Düğümün Havenfold süreçleri (`havenfold-kutu`, `havenfold-isci`, `havenfold-denetci`) uygulamaların iç arayüz adresinde hiçbir port dinlemez. Uygulama düğümün yalnız iki şeyine ulaşır: DNS ileticisi (izin varsa) ve `node-status` soketi (izin varsa).

## 9. Yerel servis tüneli

### 9.1 Akış zarfları

```
SVC_OPEN   (0xA8) { stream: uint, appId: string, ui: uint, window: uint }
SVC_DATA   (0xA9) { stream: uint, data: buffer }             // ≤ 16384 B
SVC_WINDOW (0xAA) { stream: uint, credit: uint }
SVC_CLOSE  (0xAB) { stream: uint, code: uint }
```

- Akışı yalnız telefon açar. `stream` tek sayıdır ve oturum içinde artar.
- Düğüm kabul ederse ilk `SVC_WINDOW` ile cevap verir. Reddederse `SVC_CLOSE` gönderir.
- `SVC_CLOSE.code`: `0` normal, `1` yetkisiz, `2` uygulama yok, `3` uygulama çalışmıyor, `4` sınır, `5` zaman aşımı, `6` bozuk istek.
- **Yalnız canlı oturumda:** Bu dört tür emanete ve Posta Kutusu'na hiç gitmez. Böyle gelirse atılır.
- **Tekrar kümesi:** Bu türler protokol §8.1'deki 7 günlük `Envelope.id` kümesine yazılmaz. Noise oturumu tekrarı zaten engeller; yazılsaydı akış verisi kümeyi doldururdu.

### 9.2 Akış denetimi

| Sınır | Değer |
|-------|-------|
| İlk pencere | 256 KiB (iki yön için ayrı) |
| Çerçeve | ≤ 16 KiB |
| Oturum başına açık akış | 32 |
| Oturum başına bekleyen bayt | 4 MiB |
| Boşta kalan akış | 10 dakika veri yoksa kapanır. WebSocket'in kendi canlılık çerçeveleri veri sayılır. |

Gönderen, karşıdan `credit` gelmeden pencereyi aşan veri göndermez. Aşan akış `SVC_CLOSE { code: 4 }` ile kapanır.

### 9.3 Telefondaki yerel dinleyici

Uygulamanın web arayüzü Yuva Hat'ın içindeki bir web görünümünde açılır. Web görünümü TCP konuşur; tünel ona yerel bir dinleyiciyle bağlanır.

- **Adres:** Yalnız `127.0.0.1`. Port her (düğüm, uygulama) için sabittir: `40000 + (u16be(hash('hf/app-port/', nodeId, appId)[0..2]) mod 20000)`. Doluysa bir sonraki boş port seçilir ve saklanır. Sabit port sabit köken demektir: uygulamanın kendi oturumu ve yerel depolaması korunur. Her uygulama ayrı kökendedir; birinin betiği ötekinin verisini okuyamaz.
- **Ne zaman açık:** Yalnız uygulama ön plandayken ve o uygulamanın ekranı açıkken. Ekrandan çıkınca 60 sn sonra kapanır.
- **Başka uygulamalara karşı kilit:** Telefondaki başka bir uygulama da `127.0.0.1`'e bağlanabilir. Bu yüzden her açılışta 32 baytlık rastgele bir oturum değeri üretilir ve web görünümünün çerez deposuna `hf_svc` çerezi olarak yazılır. Her yeni TCP bağlantısının ilk isteğinde bu çerez olmalıdır; yoksa dinleyici yerelde `403` döner ve hiçbir şey tünele gitmez. Çerez tünele gitmeden silinir.
- **Web görünümü:**
  - JavaScript köprüsü yoktur. Uygulamanın sayfası Yuva Hat'ın çekirdeğine, kişilerine ya da mesajlarına hiçbir yoldan ulaşamaz.
  - Gezinme yalnız kendi `127.0.0.1:port` kökeninde. Dış bağlantılar sistem tarayıcısında açılır.
  - Dosya erişimi kapalı. iOS'ta yalnız yerel ağ istisnası açıktır.
- **Mağaza kuralı (kurucu §16.2):** Web görünümü, ailenin kendi bilgisayarındaki bir sayfayı tarayıcı gibi gösterir. Uygulamaya kod indirmez, uygulamanın davranışını değiştirmez, köprü yoktur. Mağaza metinlerinde bu özellik platforma özgü metin kuralıyla ayrı ayrı yazılır.

### 9.4 Düğümdeki HTTP vekili

Düğüm `SVC_DATA` baytlarını ham geçirmez; küçük bir HTTP/1.1 vekilinden geçirir:

1. İstek başlığını okur (≤ 16 KiB, ≤ 100 başlık). `CONNECT` ve HTTP/2 reddedilir (`6`).
2. Şu başlıkları siler: `Forwarded`, `X-Forwarded-*`, `X-Real-IP`, bütün `X-Havenfold-*`, bildirimdeki `auth.header`.
3. `auth.mode = header` ise `auth.header`'ı ekler. Değer, oturumu açan üyenin `memberId`'si (hex) ya da defterdeki adıdır. Böylece "uzak kullanıcı" girişini destekleyen uygulamalar (ör. Paperless-ngx) aile kimliğiyle açılır ve ayrı parola gerekmez.
4. İsteği uygulamanın iç arayüz adresine iletir. Cevabı değiştirmeden geri yollar.
5. `Upgrade` (WebSocket) cevabı `101` ise o andan sonra iki yönü ham bağlar.

`auth.mode = none` ise uygulama kendi girişini ister. Vekil hiçbir başlık eklemez. Home Assistant böyledir.

### 9.5 Kim hangi uygulamayı açar

- **Erişim listesi** (`access`) öğeleri: `rol:ebeveyn`, `rol:yetiskin`, `rol:cocuk`, `uye:<hex16>`. `uye:` öğeleri RFC-0003 §5.13'teki gibi `rotatedTo` zincirinin aktif ucuna çözülür.
- **Varsayılan:** `['rol:ebeveyn']`. Kurulum ekranı "Ebeveynler", "Ebeveynler ve yetişkinler" ve "Kişi seç" seçeneklerini sunar. Çocuk yalnız açıkça seçilirse açabilir.
- **Düğümün kararı (`SVC_OPEN` anında):**
  - Oturum rolü `uye` olmalı (RFC-0003 §6.1). Misafir ve cihaz oturumları hiçbir uygulamayı açamaz.
  - Oturumu açan kimlik, düğümün güncel defterinde aktif bir telefon üyesi olmalı ve erişim listesine uymalı.
  - Uygulama `calisiyor` durumunda olmalı.
- Üye aileden çıkarılınca açık akışları düğüm defteri uyguladığı anda kapatır (`1`).
- Erişim listesi uygulamanın kendi kullanıcı hesaplarının yerine geçmez. Uygulamanın içinde kim neyi görür, uygulamanın kendi işidir.

### 9.6 Hangi yoldan

Tünel, düğümle kurulmuş **her** Noise oturumunun içinden çalışır:

| Yol | Not |
|-----|-----|
| Evde, aynı ağda | Doğrudan; en hızlısı |
| Dışarıda, doğrudan ya da delik açarak | Ücretsiz (RFC-0009 a, b) |
| Ailenin Cloudflare Tunnel'ı | Ücretsiz (RFC-0009 c) |
| Kutunun aile içi rölesi | Ücretsiz. Kutu yalnız şifreli bayt görür; kutunun röle kotası geçerlidir. |
| Bağlantı rölesi | Yuva Bağlantı (RFC-0009 d) |

Hiçbiri yoksa ekranda "Uygulamaya şu an ulaşılamıyor" yazar. Uygulamanın portu hiçbir durumda internete açılmaz.

## 10. Veri: dışa aktarma ve yedek

### 10.1 Dışa aktarma

- **Telefona:** Ebeveyn `op = 7` yollar, `exportKey` ekler. Düğüm uygulamayı kısa süre durdurur, birimleri ve bildirimi bir `tar` (POSIX pax) dosyasına koyar, uygulamayı yeniden başlatır. Dosya RFC-0001 §11 biçiminde `exportKey` ile şifrelenir. Telefon `BLOB_REQ` ile çeker, çözer, sistemin paylaş menüsüyle verir. En çok 2 GB.
- **Diske:** Düğümün terminalinde `havenfold uygulama disa-aktar <appId> <hedef>`. Hedef, düğüme takılı bir disk. Boyut sınırı yok. Dosya şifresiz `tar`'dır; terminal bunu yazar.
- İçerik uygulamanın kendi biçimindedir (Home Assistant'ta YAML ve SQLite). Havenfold'a özgü bir sarma yoktur (ilke 9).

### 10.2 Gece yedeği

- **Anahtar:** `appBackupKey` kurulumda ev sahibi düğümde üretilir (§7.3) ve komutu veren ebeveynin telefonuna gider. Telefon bunu "Ebeveynler" koleksiyonuna `hf.app.yedek` türünde kayıt olarak yazar: `{ nodeId, appId, key, targets }`. Böylece ev sahibi düğüm kaybolsa da her ebeveyn geri yükleyebilir. Kutu ve hedef düğüm bu anahtarı görmez.
- **Ne zaman:** Her gece 03:00'te. Yalnız `backup: true` birimler. Uygulama tutarlı kopya için en çok 60 sn durdurulur.
- **Biçim:** Birimlerin `tar`'ı 64 MiB'lik parçalara bölünür. Her parça RFC-0001 §11 biçiminde, yeni ve rastgele bir `fileKey` ile şifrelenmiş bir dosyadır. Parçaların listesi bir dizindir:

  ```
  APP_BACKUP_INDEX { nodeId, appId, rev, seq, createdAt, pieces: array<{ blobId, fileKey, size }> }
  sealed = nonce(24) ‖ XChaCha20-Poly1305(appBackupKey, encode(APP_BACKUP_INDEX), AD = hash('hf/app-backup-ad/', nodeId, appId, u64be(seq)))
  ```

  Mühürlü dizin de bir dosya olarak saklanır.
- **Nereye:** `grants.backup.targets`'teki düğümlere (varsayılan: kutu varsa kutu, yoksa ev sahibi dışında `storage.blobGB` değeri en büyük işçi). Hedef en çok `maxGB` kabul eder (varsayılan 5).
- **Saklama:** Son 3 gece ve son 2 hafta. Ev sahibi düğüm eskileri `BLOB_DEL` ile siler. Bu kümede hedef, silmeyi RFC-0001 §11.2'deki 90 günlük bekleme olmadan uygular; yükleyen tek kaynaktır ve geri dönüş saklama düzeniyle sağlanır.

### 10.3 `APP_LINK` (0xAC): düğümler arası yetki

Bağlı cihazlar arasında bugün yalnız görev ve dosya geçer (RFC-0003 §6.1). Yedek ve durum aboneliği için ebeveyn imzalı bir dayanak gerekir:

```
APP_LINK {
  kind         : uint        // 0 durum aboneliği, 1 yedek notu, 2 yedek sorgusu, 3 yedek cevabı
  hostId       : fixed16
  appId        : string
  grant?       : buffer      // kind 0, 1: yetkiyi veren APP_CMD'nin gönderilen baytları (ebeveyn imzalı)
  until?       : uint        // kind 0: aboneliğin sonu, en çok 7 gün sonrası
  setId?       : fixed32     // kind 1, 2, 3: hash('hf/app-backup-set/', hostId, appId)
  seq?         : uint        // kind 1, 3
  indexBlobId? : fixed32     // kind 1, 3
  by           : fixed16
  sig          : fixed64     // etiket 'hf/app-link/'
}
```

| Tür | Kimden kime | Alıcının denetimi | Etki |
|-----|-------------|--------------------|------|
| 0 | Ev sahibi → diğer düğümler | `grant` aktif bir ebeveynin imzalı `APP_CMD`'si; `nodeId = hostId`; `grants.data` içinde `node-status` | Alıcı `until`'e kadar 5 dakikada bir ev sahibine `NODE_CAPS` gönderir |
| 1 | Ev sahibi → yedek hedefi | `grant` aktif ebeveynin `APP_CMD`'si; hedef `grants.backup.targets` içinde | Hedef, ev sahibinin o gece gönderdiği dosyaları `setId` altında kabul eder ve en büyük `seq`'li `indexBlobId`'yi saklar |
| 2 | Ebeveyn telefonu → yedek hedefi | Gönderen aktif ebeveyn | Hedef tür 3 ile cevap verir |
| 3 | Yedek hedefi → ebeveyn telefonu | — | Telefon en son dizinin yerini öğrenir |

- Ev sahibi, yedek dosyalarını tür 1 notundan önce `BLOB_DATA` ile hedefe gönderir. Hedef, geçerli bir tür 1 yetkisi olmadan gelen istenmemiş `BLOB_DATA`'yı kabul etmez.
- Ebeveynin sonraki bir `APP_CMD`'si izni geri almışsa diğer düğümler bunu göremeyebilir. Bu yüzden durum aboneliği en çok 7 gün sürer; ev sahibi yalnız izin sürüyorsa yeniler.

### 10.4 Geri yükleme

1. Ebeveyn telefonu kayıttan `appBackupKey`'i ve hedefi alır, hedefe `APP_LINK { kind: 2 }` gönderir.
2. Gelen `indexBlobId` ile yeni ev sahibine `APP_CMD { op: 0, restore: { key, from, indexBlobId } }` yollar.
3. Yeni ev sahibi dizini ve parçaları hedeften `BLOB_REQ` ile çeker, çözer, birimleri kurar ve uygulamayı başlatır. Yeni bir `appBackupKey` üretir; eski anahtarla alınmış yedekler 30 gün sonra silinir.

## 11. Home Assistant: ilk uygulama ve entegrasyon yönü

### 11.1 İlk uygulama

- Eser seçkisinin ilk kaydıdır. Bildirim §4.1'deki gibidir.
- **Giriş:** Home Assistant'ın kendi kullanıcıları ve girişi kullanılır (`auth.mode = none`). Home Assistant'ın üçüncü taraf giriş sağlayıcısı resmî olarak desteklenmediği için aile kimliğiyle otomatik giriş v1'de yoktur. Kurulum ekranı her aile üyesi için Home Assistant'ta ayrı kullanıcı açılmasını önerir.
- **Home Assistant'ın kendi telefon uygulaması** tünelden geçemez; doğrudan bir adres ister. İki seçenek vardır ve ikisi de ebeveynin açık seçimidir:
  - `lanInbound: [8123]`: yalnız ev Wi-Fi'sinde ulaşılır. İnternetten asla.
  - `internet` izniyle Home Assistant'ın kendi uzaktan erişim hizmeti: Havenfold'un dışındadır; arayüz "Bu yol Havenfold tünelinden geçmez" der.
- Zigbee ya da Z-Wave çubuğu `devices` ile verilir.

### 11.2 Havenfold düğümleri Home Assistant'ta cihaz

- **Entegrasyon:** `havenfold/integrations/home-assistant` (Apache-2.0). Kurulumda `seed` ile Home Assistant'ın `custom_components/havenfold` klasörüne konur. Ayrıca HACS üzerinden de dağıtılır.
- **Kaynak:** `data: [node-status]` izni verilmiş uygulamaya düğüm salt okunur bir Unix soketi bağlar: `/run/havenfold/app.sock`.

  | İstek | Cevap |
  |-------|-------|
  | `GET /v1/nodes` | `[{ id, name, class, status, online, tempC, load1x100, cores, ramTotalMB, ramFreeMB, diskFreeGB, battery, lastSeen }]` |
  | `GET /v1/events` | `text/event-stream`: `hf.device.online`, `hf.device.offline`, `hf.device.overheat`, `hf.device.battery` |

- Veri, ev sahibinin kendi `NODE_CAPS`'inden ve `APP_LINK { kind: 0 }` ile abone olduğu diğer düğümlerin bildirimlerinden gelir.
- **Home Assistant'ta:** Her kutu, işçi ve uç bir cihaz olur: durum, sıcaklık, yük, boş bellek, boş disk, pil yüzdesi ve sağlığı, prizde mi algılayıcıları; "çevrimiçi" ikili algılayıcısı. Aile böylece "Laptopun pili ısınınca uyar" gibi otomasyonları Home Assistant'ta kurabilir.
- **Bilinçli olarak yok:**
  - Telefonlar ve kişiler Home Assistant'a gitmez. Kimin evde olduğu bir izleme bilgisidir (ilke 7).
  - Koleksiyonlar, mesajlar, kasa: hiçbiri.
  - Home Assistant Havenfold'a komut veremez. Soket salt okunurdur.

### 11.3 Ters yön (v1'de yok)

Home Assistant olaylarının ailenin `olaylar` koleksiyonuna yazılması (ör. "kapı açıldı" kartı) bu RFC'de yoktur. Gerekçe:

- Uygulamanın defterde kimliği yoktur; yalnız yazan cihaz modeli (RFC-0001 §10) bir `device:` kimliği ister.
- Uygulama içeriği uçtan uca şifreli değildir. Ondan gelen olayın güveni bir cihazınkine eşit değildir.

Ayrı bir RFC, uygulamaya ev sahibi düğüm üzerinden süreli ve dar bir bırakma yetkisi vermeyi tanımlayacak (Faz 4 sonrası).

## 12. Dürüst not: içerik uçtan uca şifreli değil

Arayüz kurulumda ve uygulamanın bilgi ekranında şunu yazar:

> "Bu uygulamanın verisi ailenizin evindeki <düğüm adı> bilgisayarında durur. Havenfold'un mesajları ve kasası gibi uçtan uca şifreli değildir: o bilgisayarı ele geçiren biri görebilir. İnternete açık değildir; telefonunuz ona ailenizin şifreli bağlantısıyla ulaşır. Eser bu veriyi göremez."

| Kim görür | Ne |
|-----------|----|
| Ev sahibi düğümde kök yetkisi olan | Uygulamanın bütün verisi (TPM'li düğümde disk şifreli olsa da çalışırken açıktır) |
| Uygulamanın kendisi | Kendi verisi; izin verildiyse ev ağı ve internet |
| Kutu, röleler, Cloudflare | Yalnız Noise ile şifreli bayt |
| Eser | Hiçbir şey. Seçki dağıtım sunucusu yalnız düğümün IP'sini ve sürümünü görür. |
| Yedek hedefi | Yalnız şifreli parçalar |

`internet` izni olan bir uygulama kendi verisini dışarı gönderebilir. Bu izin kurulumda kırmızıyla gösterilir.

## 13. Numaralar

| Tür | Numara |
|-----|--------|
| Defter olayı | Yok |
| Zarf türleri | `0xA8 SVC_OPEN`, `0xA9 SVC_DATA`, `0xAA SVC_WINDOW`, `0xAB SVC_CLOSE`, `0xAC APP_LINK`, `0xAD APP_CMD`, `0xAE APP_STATE`, `0xAF APP_CMD_RES` |
| HELLO yetenek biti | `UYGULAMA = 2048`: düğümde uygulama çalıştırabilir; telefonda tünel açabilir |
| Çekirdek komutları | `320 APP_CATALOG`, `321 APP_INSTALL`, `322 APP_UPDATE`, `323 APP_REMOVE`, `324 APP_ACCESS`, `325 APP_STATE_GET`, `326 APP_OPEN` (yerel dinleyiciyi açar; adres ve çerez döner), `327 APP_CLOSE`, `328 APP_EXPORT`, `329 APP_RESTORE` |
| Türetme etiketleri | `hf/app-manifest/`, `hf/app-catalog/`, `hf/app-cmd/`, `hf/app-state/`, `hf/app-link/`, `hf/app-port/`, `hf/app-backup-ad/`, `hf/app-backup-set/` |
| Emanet mührü | RFC-0003 §6.4'teki K12 mühür kuralı `0xA8–0xAF` aralığının tamamını kapsar: bu aralıktaki bir zarf emanet ya da Posta Kutusu yolundan geçecekse aynı mühürle (`derive(pair, 'ctrl')`, AD = gönderen ‖ alıcı ‖ tür ‖ zarf id) kapatılır; `CTRL_TYPES` bunları kapsar. `0xAC–0xAF` bu yollardan geçebilir (`backupKey` taşıyan `APP_CMD_RES` Posta Kutusu'na gitmez, §7.6). `0xA8–0xAB` bu yollarda hiç taşınmaz; gelirse atılır. |
| Ağ | İç arayüzler `169.254.200.0/21`; telefon dinleyicisi `127.0.0.1:40000–59999`; düğüm soketi `/run/havenfold/app.sock` |
| `hf.task.backup` | Kullanılmaz; uygulama yedeği §10.2–10.3'teki ayrı yoldur |

Koda yazılınca `KARARLAR.md`'ye işlenir.

## 14. Test vektörleri

`protocol/vectors/uygulama.json`:

1. §4.1 bildiriminin baytları → `manifestHash`.
2. Geçersiz bildirimler: etiketli imaj, bilinmeyen alan, `collection:` verisi, `caps: [SYS_ADMIN]`, `lanInbound` var ama `lan` yok → hepsi `BILDIRIM_GECERSIZ` ya da `VERI_IZNI_YOK`.
3. `KATALOG` kodlama ve imza; sürüm bildirimindeki katalog anahtarı sertifikası; düşük `seq` → red.
4. `APP_CMD` kodlama ve imzalar. Denetim tablosu: yetişkinden komut → `UNAUTHORIZED`; eski `rev` → `REV_ESKI`; istenmemiş izin → `IZIN_FAZLA`; `userAck` olmadan kullanıcı uygulaması → `KULLANICI_UYGULAMASI_KAPALI`.
5. İki ebeveynin aynı `rev` ile iki komutu → ilki uygulanır, ikincisi `REV_ESKI`.
6. Yerleştirme: aynı `NODE_CAPS` ve `APP_STATE` kümesinden aynı seçim; diski şifreli (`luks-tpm`) ama belleği az düğüm, diski şifresiz ve belleği çok düğümden önce gelir.
7. Erişim: `['rol:ebeveyn']` ile çocuk → `1`; `uye:` öğesi cihaz değiştirmiş üyeye çözülür; misafir oturumu → `1`.
8. `SVC_*` kodlama; pencere aşımı → `4`; emanetten gelen `SVC_DATA` → atılır.
9. Port türetmesi: sabit `nodeId` ve `appId` için port.
10. HTTP vekili: `X-Forwarded-For` ve sahte `auth.header` silinir; `auth.mode = header` ile doğru üye değeri eklenir; `CONNECT` → `6`.
11. `APP_BACKUP_INDEX` mühürü ve AD; `setId` türetmesi.
12. `APP_LINK` tür 0: `node-status` içermeyen `grant` → red; çocuktan gelen `grant` → red.

## 15. Güvenlik değerlendirmesi

| Tehdit | Önlem |
|--------|-------|
| Kötü niyetli uygulama Havenfold anahtarlarına ulaşır | Ayrı kullanıcı, kök olmayan Podman, salt okunur kök, yetkisiz; anahtarlar ve soketler bağlanmaz; düğümün adreslerine ağ yolu yok |
| Uygulama ev ağındaki cihazlara saldırır | `lan` ayrı izin, kırmızı uyarı; varsayılan kapalı |
| Uygulama veriyi dışarı gönderir | `internet` ayrı izin; özel adresler kapalı; DNS yeniden bağlama koruması |
| Seçki anahtarı ele geçirilir | Kök anahtardan ayrı; kök anahtar yeni sürüm bildirimiyle değiştirir; `seq` geri sarma koruması |
| Üst kaynak imajı değişir | Yalnız özetle çekilir; etiket kabul edilmez |
| Telefondaki başka bir uygulama yerel dinleyiciye bağlanır | Oturum başına rastgele çerez; dinleyici yalnız ekran açıkken |
| Uygulamanın sayfası Yuva Hat'a saldırır | JavaScript köprüsü yok; ayrı köken; dış gezinme sistem tarayıcısında |
| Çocuk ya da misafir ebeveynin uygulamasını açar | Düğüm defterdeki kimliğe ve erişim listesine göre karar verir; misafir ve cihaz hiç açamaz |
| Atılan üye açık akışla devam eder | Düğüm defteri uyguladığı anda akışları kapatır |
| Kutu tünel trafiğini okur | Tünel uçtan uca Noise içindedir |
| Port taramasıyla uygulama bulunur | Port ev ağına ve internete açılmaz (`lanInbound` hariç, o da yalnız ev ağına) |
| Yedek hedefi yedeği okur | `appBackupKey` hedefte yok; parçalar ayrı anahtarlarla şifreli |
| Sahte durum aboneliğiyle donanım bilgisi toplanır | Ebeveyn imzalı `grant`; en çok 7 gün; bilgi topluluk içinde kalır |

**Bilinen sınırlar:**

- Uygulama içeriği uçtan uca şifreli değildir (§12).
- Ev sahibi düğümde kök yetkisi alan biri her şeyi görür.
- Ebeveynin izni geri alması diğer düğümlere en geç 7 gün içinde yansır.

## 16. Kurucu belgede değişecekler

| Bölüm | Değişiklik |
|-------|------------|
| §14.2 bildirim örneği | §4.1'deki örnekle değişir. `needs.class` kalkar: uygulama yalnız işçide çalışır. `network: [local-tunnel]` kalkar: tünel bir ağ izni değildir, `ui` alanından gelir. `network` değerleri `lan` ve `internet`; varsayılan boş. `data: collection:none` yerine `data: []`; v1'de tek değer `node-status`. |
| §14.2 "Biçim: imzalı OCI imajı" | "Özetle sabitlenmiş OCI imajı. Eser seçkisindeki uygulamada bildirim özeti ve imaj özeti katalog anahtarıyla imzalıdır. Kullanıcının eklediği uygulamada üst kaynak imzası aranmaz; özet, ebeveynin biyometriyle imzaladığı `APP_CMD`'dedir." |
| §14.2 ek maddeler | "Uygulamayı yalnız ebeveyn kurar, günceller ve kaldırır." "Köken: Eser seçkisi (katalog anahtarıyla imzalı) ya da kullanıcı eklemesi (varsayılan kapalı, kırmızı uyarı)." "Bluetooth v1'de verilmez." |
| §14.2 Home Assistant maddesi | "Havenfold düğümleri Home Assistant'ta cihaz olarak görünür (salt okunur). Ters yön ayrı RFC'dir." |
| §11 yerel servis tüneli | "Tünel düğümle kurulan her Noise oturumunun içinden çalışır (RFC-0011 §9). Telefonda yalnız `127.0.0.1`'de, oturum çereziyle korunan bir dinleyici; web görünümünde köprü yok." |
| §9.4 | "Kök anahtar, sürüm bildiriminde uygulama seçkisinin katalog anahtarını da sertifikalar." |
| §8.3 ve RFC-0002 §4 | `maxTaskRamMB` hesabından uygulamaların ayrılmış belleği de düşer. `NODE_CAPS`, `APP_LINK { kind: 0 }` ile abone olan ev sahibi düğüme de gider. |
| RFC-0003 §6.1 tablo | Cihaz ↔ cihaz satırına "`APP_LINK` ve onunla yetkilendirilmiş `NODE_CAPS` ile yedek dosyaları" eklenir. |
| RFC-0001 §11.2 | "Uygulama yedeği kümelerinde tutucu, yükleyenin `BLOB_DEL`'ini 90 gün beklemeden uygular." |
| §6.5 | Emanet mührü `0xA8–0xAF` aralığını da kapsar. |
| §13.1 | İki yeni tehdit satırı (numaraları işlenirken verilir): "Kötü niyetli konteyner uygulaması → Yalnız kendi verisine ve verilen izinlere ulaşır; Havenfold anahtarlarına ve düğüme ağ yolu yoktur." ve "Telefondaki başka bir uygulama yerel tünel dinleyicisine bağlanır → Oturum çerezi olmadan istek tünele gitmez." |
| §16.2 | "Yerel servis tünelinin web görünümünde JavaScript köprüsü bulunmaz." |

## 17. Uygulama sırası

1. Bildirim ayrıştırıcı ve doğrulayıcı, `manifestHash`, katalog biçimi ve anahtar zinciri; vektörler 1–3.
2. Denetçide uygulama yöneticisi: kullanıcı, birimler, Podman, iç arayüz; `network: []` ile kurma ve kaldırma.
3. `APP_CMD` / `APP_CMD_RES` / `APP_STATE`, denetim tablosu, `rev`; vektörler 4–5. Telefonda geliştirici ekranı.
4. Yerel servis tüneli: `SVC_*`, akış denetimi, HTTP vekili, telefon dinleyicisi ve web görünümü; vektörler 8–10.
5. Erişim listesi ve yerleştirme; vektörler 6, 7, 9.
6. `internet` ve `lan` ağ kipleri, nftables, DNS ileticisi; aygıt izinleri.
7. Home Assistant seçki kaydı ve `havenfold` entegrasyonu; `node-status` soketi; `APP_LINK { kind: 0 }`; vektör 12.
8. Güncelleme, geri dönüş, geri çekme.
9. Dışa aktarma, gece yedeği, geri yükleme; vektör 11.
10. Kullanıcı eklemesi akışı ve uyarı ekranları; mağaza metinleri.
