# Yuva Cihaz Platformu: Eski Dizüstü ve Tabletleri "Yuva'nın Cihazları"na Dönüştürme — Teknik Araştırma Raporu

> **Kuruluş öncesi araştırma** (22 Ekim 2026). Havenfold'un kuruluşuna temel olan rapordur; olduğu gibi korunur. Kararlar `KURUCU-BELGE.md`'dedir; rapor belgeyle çelişirse belge geçerlidir (§24).

En gerçekçi yol, cihazları gerçekten tek bir makineye "birleştirmek" değil; her birini Linux'a çevirip Yuva'ya kayıtlı birer "düğüm" (node) yapmak, üstüne bir orkestrasyon katmanı (ilk aşamada Docker + özel Yuva ajanı, sonra k3s veya Nomad) koymak ve kullanıcıya toplam çekirdek/RAM/diski tek bir "Sanal Yuva Makinesi" gibi gösteren bir panel sunmaktır. Bu, istediğiniz "VMware'in tersi" deneyiminin görünürdeki karşılığını verir; arka plandaki gerçeklik ise bir küme (cluster) ve iş zamanlayıcıdır (scheduler).

## TL;DR

- **"Tek makine" illüzyonu mümkün, gerçek RAM/CPU birleştirme değil:** İki tüketici dizüstünün belleğini Wi-Fi/Ethernet üzerinden tek bir işletim sistemi altında birleştirmek (MOSIX/openMosix, Kerrighed, TidalScale, Popcorn Linux çizgisi) bugün pratik değil; openMosix 1 Mart 2008'de sonlandırıldı, TidalScale ise PitchBook'a göre 1 Aralık 2022'de HPE'ye satıldı. Yapılabilir olan: Yuva'nın kümeyi tek kaynak havuzu olarak göstermesi ve işleri (OCR, indeksleme, yedekleme) etiketlerle doğru cihaza yönlendirmesi. Ray bu modeli doğrudan sunar; k3s/Nomad etiket ve kısıtlarla aynı işi yapar.
- **Önerilen başlangıç (Kademe 1):** Ubuntu Server 26.04 LTS (resmî minimum 1,5 GB RAM) otomatik kurulum (autoinstall) USB'si → ilk açılışta Yuva ajanı + Tailscale/Headscale + Docker kurulumu → Yuva panelinde "Bağlı Cihazlar" listesi. 4 çekirdekli ana bilgisayar "ana düğüm", 2 çekirdekli yedek bilgisayar "işçi/yedek düğüm". Sonra Kademe 2'de k3s (sunucu ≈1,6 GB, ajan ≈275 MB RAM) veya Nomad'a geçin; Talos/balenaOS gibi "cihaz tamamen Yuva'nın olur" değişmez (immutable) işletim sistemleri Kademe 3 hedefidir.
- **Tablet ve Windows gerçekleri:** Android tablet ancak Termux + sınırlı bir ajanla "hafif işçi/sensör" olur (Android 12+ "phantom process killer" arka plan süreçlerini öldürür); iPad sunucu olarak yeniden kullanılamaz; Intel/Atom Windows tablet Linux kurulabilir bir x86 cihazdır. Çalışan bir Windows'u USB'siz Linux'a çevirmek mümkün (GRUB/Grub2Win ile diskteki ISO'dan önyükleme, PXE/iPXE), fakat Secure Boot, BitLocker ve UEFI ayarları yüzünden "tek tık, uzaktan" dönüşüm güvenilir değildir; ilk dönüşüm için bir kez fiziksel USB/PXE kullanmayı planlayın.

## Key Findings

| Konu | Gerçekçi mi? | Kısa değerlendirme |
|---|---|---|
| İki dizüstünün RAM/CPU'sunu tek bir OS altında birleştirmek (SSI/DSM) | **Hayır** (pratik değil) | Ağ gecikmesi bellek erişiminden yaklaşık 1.000–10.000 kat yavaş; projeler ölü veya kurumsal/araştırma düzeyinde |
| Kümeyi "tek sanal Yuva makinesi" olarak *göstermek* | **Evet** | Toplam kaynak paneli + scheduler; Ray, k3s, Nomad hazır API'ler sunuyor |
| Her cihaza ayrı görev atamak (OCR, yedek, medya) | **Evet** | k3s etiket/nodeSelector, Nomad constraint/meta, Ray labels/custom resources |
| Cihazı Yuva uygulamasından Linux'a çevirmek | **Kısmen** | Otomatik kurulum USB/PXE çok iyi çalışır; Windows içinden tam uzaktan dönüşüm kırılgan |
| Diskleri silip "Yuva cihazı" yapmak | **Evet** | Autoinstall/Talos/balenaOS kurulumu diski siler; ek olarak blkdiscard/nvme format |
| Eski cihazları yedek düğümü yapmak | **Evet** | restic/Kopia/Borg + Syncthing; S3 gerekiyorsa Garage (MinIO CE deposu 25 Nisan 2026'da arşivlendi) |
| Proxmox/Incus kümesi (2 dizüstü) | **Mümkün ama gereksiz** | 2 düğümde quorum için QDevice gerekir; 8 GB RAM'de VM katmanı israf |
| Android tablette sürekli çalışan sunucu | **Sınırlı** | Termux çalışır ama Android süreç öldürme ve pil/ısı sınırları var |
| iPad'i sunucu yapmak | **Hayır** | Yalnızca istemci/ekran (Yuva paneli, kiosk) olarak kullanılabilir |

## Details

### A. "Birleşik" kavramının iki yorumu

#### A1. Gerçek Tek Sistem Görüntüsü (Single System Image, SSI) ve kaynak havuzlama

**Tarihçe ve durum:**

- **MOSIX / openMosix:** Süreçleri (thread değil) ağdaki daha uygun makineye taşıyan Linux çekirdek yamasıydı. openMosix kurucusu Moshe Bar, projeyi 1 Mart 2008 itibarıyla sonlandırdı; gerekçe, "düşük maliyetli çok çekirdekli işlemcilerin artan gücü ve erişilebilirliğinin SSI kümelemeyi hızla daha az önemli hâle getirmesi" idi. Orijinal MOSIX'in son kararlı sürümü 4.4.4 (24 Ekim 2017) olarak görünüyor; yani bu çizgi fiilen durdu.
- **Kerrighed / OpenSSI:** Aynı dönemin açık kaynak SSI projeleri; Kerrighed'in git etiketleri kerrighed-3.0.0'da biter, SourceForge sayfası "Status: Beta, Last Update: 2013-05-22" gösterir ve desteklenen son çekirdek 2.6.30'dur (Ekim 2011'den beri geliştirme yok); güncel çekirdeklerle çalışan bakımlı bir dağıtım yoktur.
- **ScaleMP vSMP / TidalScale:** Ticari "yazılım tanımlı sunucu" yaklaşımı. TidalScale, Ethernet ile bağlanmış standart sunucuları "neredeyse her boyutta sanal bir sunucuya" birleştirdi (TidalScale 4.0'da düğüm başına 24 TB'a, toplam 128 TB belleğe kadar). PitchBook'a göre TidalScale 1 Aralık 2022'de Hewlett Packard Enterprise tarafından satın alındı. Hedef kitlesi veri merkezi sunucularıdır; tüketici dizüstüleri değil.
- **Popcorn Linux (Virginia Tech):** Birden çok çekirdek örneğinin dağıtık paylaşılan sanal bellek (DSM) ile tek bir işletim sistemi görüntüsü sunduğu araştırma projesi. Değerlendirmeler, ARM ve x86 işlemcinin PCIe üzerinden noktadan noktaya bağlandığı özel donanımlarda yapıldı. Aynı grubun 2026 tarihli "Stretch" çalışması, DSM'yi güncel Linux bellek yönetimi arabirimleriyle yeniden ele alıyor ve tutarlılık gecikmesini düşürmek için RDMA kullanıyor; bu yine bir araştırma prototipidir.

**Neden iki dizüstünde pratik değil (fizik):**

| Ölçü | Yerel bellek (DDR4) | Gigabit Ethernet | Ev Wi-Fi'si |
|---|---|---|---|
| Gecikme | ~100 ns | ~0,1–0,5 ms (100.000–500.000 ns) | ~1–10 ms, değişken |
| Bant genişliği | ~20+ GB/s | ~0,125 GB/s | ~0,02–0,1 GB/s |

(Değerler genel mühendislik büyüklük sıralarıdır, belirli bir ölçüm değildir.) DSM sistemleri bir sayfa hatasında 4 KB'lık sayfayı ağdan çeker; bu, her uzak bellek erişiminin binlerce kat yavaşlaması anlamına gelir. Çok iş parçacıklı bir uygulama iki makineye yayıldığında kilitler ve paylaşılan değişkenler sayfaların makineler arasında "ping-pong" yapmasına yol açar; sonuç genellikle tek makineden *daha yavaş* çalışmadır. Barbalace ve arkadaşlarının Ottawa Linux Symposium 2014 makalesi bile en kötü durumda (16 çekirdekte FT testi) Popcorn'un SMP Linux'tan %30 daha yavaş kaldığını raporluyor. Ayrıca bir dizüstünün kapanması veya Wi-Fi'nin kopması tüm "birleşik makineyi" çökertir; bu, ev ortamında kabul edilemez bir hata alanıdır.

**Hâlâ yapılabilir olan:** İşi bölünebilir görevlere ayırmak (her PDF ayrı OCR görevi, her klasör ayrı indeksleme görevi) ve bu görevleri düğümlere dağıtmak. Bu "görev paralelliği", ağ gecikmesinden etkilenmez çünkü görev başına yalnızca girdi ve çıktı aktarılır. Yuva'nın "birleşik makine" deneyimi bu model üzerine kurulmalıdır.

#### A2. Orkestrasyon / "filoyu tek havuz gibi göstermek"

Cihazlar kendi işletim sistemlerini çalıştırır; Yuva bir **kontrol düzlemi** (control plane) ve **panel** sunar: toplam çekirdek, toplam RAM, toplam disk, çevrimiçi düğümler ve çalışan işler. Kullanıcı "OCR işi başlat" der; Yuva zamanlayıcısı hangi düğümde çalışacağına karar verir.

**Kaynak tüketimi ve uygunluk karşılaştırması (8 GB / 2–4 çekirdek için):**

| Katman | Kontrol düğümü RAM | İşçi düğümü RAM | Düğüm ekleme | ARM | Görev sabitleme yöntemi | Yuva için yorum |
|---|---|---|---|---|---|---|
| Docker + özel ajan (Kademe 1) | ~100–200 MB (Docker) | aynı | Ajan kurulumu + token | Evet | Yuva kendi kararını verir | En basit, tam kontrol |
| Docker Swarm | Düşük (~100 MB düzeyi) | Düşük | `docker swarm join --token` | Evet | `node.labels` kısıtları | Basit ama ekosistemi durgun |
| HashiCorp Nomad | ~60–80 MB ajan (topluluk ölçümü) | ~60–80 MB | Ajan + sunucu adresi | Evet | `constraint`, `meta`, `node_class` | Konteyner + yalın ikili (exec) çalıştırır; lisans BSL |
| k3s | 2 çekirdek / 2 GB minimum; iş yüküyle ~1,6 GB ölçüldü | 1 çekirdek / 512 MB minimum; ~275 MB ölçüldü | `K3S_TOKEN` ile tek komut | Evet (armhf, arm64) | Etiket, nodeSelector, affinity, taint | Standart Kubernetes API'si; en iyi ekosistem |
| k0s | 1 GB | 0,5 GB | `k0s token create` | Evet | Kubernetes ile aynı | k3s'e yakın, daha "saf" upstream |
| MicroK8s | 540 MB taban; 4 GB önerilir | ~200 MB düzeyi | `microk8s add-node` | Evet | Kubernetes ile aynı | snapd bağımlılığı, daha ağır |
| Ray | Başlık düğümü GCS + dashboard taşır | Python süreçleri | `ray start --address=...` | Evet (sınırlı) | `resources={...}`, label_selector | OCR/ML için ideal "tek havuz" API'si |
| Celery/RQ + Redis | Redis ~10–50 MB | İşçi süreçleri | İşçiyi kuyruğa bağla | Evet | Kuyruk adı = düğüm/rol | Python iş kuyruğu; çok hafif |
| NATS | ~20 MB düzeyi | Hafif | Kimlik bilgisiyle bağlan | Evet | Konu (subject) adlandırma | Ajan↔sunucu mesajlaşması için çok uygun |
| Temporal | Ağır (sunucu + DB) | Hafif işçiler | İşçi kaydı | Evet | Görev kuyruğu | Uzun iş akışları için; 8 GB'ta ağır |

Notlar: k3s rakamları resmî k3s "Resource Profiling" sayfasından (Intel 8375C üzerinde, SQLite ile sunucu + iş yükü 1596 MB, ajan 275 MB). k0s ve MicroK8s minimumları resmî belgelere atıf yapan ikincil kaynaklardan; Nomad'ın ~60–80 MB değeri bir topluluk ölçümüdür ve Consul/Vault eklenince artar. Bu minimumlar farklı koşullarda ölçüldüğü için birebir karşılaştırılmamalıdır.

**Görev atama örnekleri (kısa):**

k3s (Kubernetes) — düğüm etiketleme ve sabitleme:
```bash
kubectl label node ana-pc yuva.role=ocr yuva.tier=primary
kubectl label node yedek-pc yuva.role=backup
kubectl taint node yedek-pc yuva.role=backup:NoSchedule   # yalnızca yedek işleri
```
```yaml
spec:
  nodeSelector:
    yuva.role: ocr
```

Nomad — istemci meta + kısıt:
```hcl
client { meta { "yuva_role" = "ocr" } }
# iş tanımında:
constraint { attribute = "${meta.yuva_role}"  value = "ocr" }
```
Nomad 1.5+ ile düğüm meta verisi `/v1/client/metadata` API'siyle yeniden başlatmadan güncellenebilir (sunucuya ~10 sn içinde yansır); bu, Yuva panelinden "bu cihaza OCR rolü ver" düğmesi için idealdir.

Ray — özel kaynak / etiket:
```bash
ray start --address=ana-pc:6379 --resources='{"ocr": 1}' --labels='{"yuva-role":"ocr"}'
```
```python
@ray.remote(resources={"ocr": 1})
def ocr_page(path): ...
```
Ray 2.49 ile gelen etiket seçicileri (label selectors) güncel belgelerde (Ray 2.59) hâlâ "beta" olarak işaretli; Ray, sayısal kapasite gerektiğinde özel kaynakları, basit yerleştirme için etiketleri öneriyor. Ray'in büyük küme rehberi başlık düğümünün GCS gibi sistem süreçleri nedeniyle "ekstra stres" taşıdığını söyler ve `num-cpus=0` ayarını büyük kümeler için önerir; iki-üç düğümlü Yuva'da ana bilgisayarın CPU'larını işe açık bırakmak daha verimlidir, ancak başlık düğümü belleğini izlemek gerekir (Ray'in "Head Node Memory Management" belgesi, başlık düğümü belleğinin "zamanla sürekli artabileceği" ve tüm kümeyi kullanılamaz kılan OOM hatalarına yol açabileceği uyarısını yapar).

**"Sanal Yuva Makinesi" görünümü nasıl kurulur:** Yuva kontrol servisi, düğüm kayıt defterinden (registry) çevrimiçi düğümleri okur ve şu toplamları hesaplar: `Σ çekirdek`, `Σ RAM`, `Σ boş disk`, `Σ çalışan iş`. Kullanıcıya tek bir kart gösterilir: "Yuva Makinesi — 6 çekirdek, 16 GB RAM, ~X GB depolama, 2 düğüm çevrimiçi". Kart açıldığında düğüm ayrıntısı ve "Görevler" sekmesi görünür. Kullanıcı bir görev başlattığında Yuva, görev türünü (ör. `ocr`) bir rol etiketine eşler ve altta k3s/Nomad/Ray'e iletir. Önemli tasarım ilkesi: Kullanıcıya hiçbir zaman "16 GB'lık tek bir uygulama çalıştırabilirsiniz" vaadi verilmemelidir; tek bir görev en fazla tek düğümün belleğini (~6–7 GB) kullanabilir. Panelde bunu "en büyük tek görev kapasitesi" olarak ayrıca göstermek dürüst bir çözümdür.

#### A3. Orta yol: Proxmox VE kümesi / Incus (LXD) kümesi

- **Proxmox VE:** İki düğümlü kümede her düğümün bir oyu vardır; biri düşünce kalan düğüm çoğunluğu kaybeder ve `/etc/pve` salt okunur olur. Proxmox belgeleri, yüksek erişilebilirlik (HA) için "güvenilir quorum için en az üç düğüm" ister ve iki düğümlü kümelerde üçüncü oyu bir **QDevice** (ayrı bir hafif makinede `corosync-qnetd`) ile sağlamayı önerir. Yuva'da QDevice görevini Android tablet değil, ancak sürekli açık bir üçüncü Linux cihaz (ör. Raspberry Pi) üstlenebilir.
- **Incus/LXD kümesi:** Sistem konteynerleri (LXC) VM'lerden çok daha hafiftir; kümeleme ve canlıya yakın taşıma sunar. Kubernetes'e göre daha "makine gibi" bir yönetim modelidir.
- **Karar:** 8 GB RAM'li iki dizüstünde hipervizör + VM katmanı belleği bölüştürür ve Yuva'nın amacına (görev dağıtımı) bir şey katmaz. Proxmox'u yalnızca "Yuva'da VM'ler de çalıştırmak istiyoruz" (ör. bir Windows VM'i, Home Assistant OS VM'i) gereksinimi doğarsa düşünün; aksi hâlde k3s/Nomad/Docker daha uygun.

### B. Cihazları Linux'a çevirmek ("Yuva uygulaması dönüştürsün")

#### B1. Otomatik kurulum mekanizmaları

- **Ubuntu autoinstall (Subiquity + cloud-init):** Ubuntu Server ISO'su `autoinstall` çekirdek parametresi ve bir `user-data` dosyasıyla insan müdahalesi olmadan kurulur. Subiquity, diski yıkıcı biçimde değiştirmeden önce `autoinstall` parametresini arar; yoksa onay ister. Bu, yanlışlıkla silmeye karşı güvenlik mekanizmasıdır. `late-commands` kurulum bittikten ve yeniden başlatmadan hemen önce çalışır; hedef sistem `/target`'e bağlıdır ve `curtin in-target -- komut` ile kurulu sistemin içinde komut çalıştırılır.
- **Debian preseed:** Debian kurucusunun eşdeğeri; `preseed/late_command` ile aynı işi yapar.
- **Kickstart:** Fedora/RHEL ailesinin otomatik kurulum biçimi.
- **Hangi Ubuntu?** Ubuntu 26.04 LTS ("Resolute Raccoon") 23 Nisan 2026'da yayımlandı, Nisan 2031'e kadar standart destek alır. documentation.ubuntu.com'daki Ubuntu 26.04 LTS sürüm notlarına göre Server gereksinimleri "1,5 GB RAM ve 4 GB depolamadan" başlar; masaüstü için "en az 6 GB RAM" gerekir. Bu yüzden Yuva düğümlerinde **masaüstü değil Server** kullanılmalıdır; 8 GB'lık makinelerde masaüstü, iş yüklerine yer bırakmaz.

**Autoinstall iskeleti (kısa, açıklayıcı):**
```yaml
#cloud-config
autoinstall:
  version: 1
  identity: {hostname: yuva-node, username: yuva, password: "<sha512-hash>"}
  ssh: {install-server: true, authorized-keys: ["ssh-ed25519 AAAA... yuva-admin"]}
  storage:
    layout: {name: lvm, password: "<LUKS-parolası>"}   # tam disk şifreleme
  early-commands:
    - blkdiscard -f /dev/nvme0n1 || true                # SSD'yi hızlı sil
  late-commands:
    - curtin in-target -- sh -c 'curl -fsSL https://yuva.lan/enroll.sh | sh -s -- --token=ENROLL_TOKEN'
```

#### B2. Özel ISO/USB ve ağdan önyükleme (PXE)

- **Özel ISO:** Cubic (Ubuntu için grafik ISO özelleştirici) veya `xorriso` ile ISO'yu açıp `nocloud/` klasörüne `user-data` ve `meta-data` koymak, GRUB satırına `autoinstall ds=nocloud;s=/cdrom/nocloud/` eklemek yeterlidir. Yuva uygulaması bu ISO'yu her cihaz için tek kullanımlık kayıt token'ı gömülü olarak üretebilir.
- **Ventoy:** Tek USB'de birden çok ISO; aile içinde "Yuva kurulum çubuğu" olarak pratik.
- **PXE / iPXE / netboot.xyz:** Yuva sunucusu (ana bilgisayar) LAN'da DHCP (veya proxy-DHCP, ör. dnsmasq) + TFTP/HTTP sunarak diğer cihazları ağdan önyükler ve `ds=nocloud-net;s=http://yuva.lan/autoinstall/` ile otomatik kurulum dosyasını verir. netboot.xyz hazır bir menü sunar. Kısıt: Çoğu dizüstü yalnızca kablolu Ethernet üzerinden PXE yapar (Wi-Fi PXE yoktur); Ethernet portu olmayan modeller için USB-Ethernet adaptörünün PXE desteği BIOS'a bağlıdır.

#### B3. Güvenli silme

| Disk türü | Yöntem | Not |
|---|---|---|
| SATA SSD | `blkdiscard -f /dev/sdX` veya ATA Secure Erase (`hdparm --security-erase`) | Bazı BIOS'lar diski "frozen" kilitler; uyku/uyandırma ile açılabilir |
| NVMe SSD | `nvme format /dev/nvme0n1 --ses=1` (kullanıcı verisi silme) veya `--ses=2` (kriptografik) | Kriptografik silme anlıktır |
| HDD | `shred -n 1 -z /dev/sdX` | SSD'lerde `shred` güvenilir değildir (aşınma dengeleme) |
| Tümü | LUKS ile şifreli kurulum | Sonradan silmede LUKS başlığını yok etmek tüm veriyi okunamaz kılar |

Silme işlemi geri alınamaz; Yuva uygulaması kullanıcıdan cihaz adını yazarak onay almalı ve önce "eski verileri yedekle" adımını sunmalıdır.

#### B4. İlk açılışta otomatik kayıt (enrollment)

Akış: `late-commands` veya cloud-init `runcmd` → `enroll.sh` → (1) Tailscale/Headscale'e ön-yetkili anahtarla katıl, (2) Yuva ajanını kur ve token'la kendini kaydet, (3) seçilen kademeye göre k3s ajanı / Nomad istemcisi / Ray işçisi olarak kümeye katıl.

```bash
tailscale up --login-server https://hs.yuva.lan --authkey "$HS_KEY" --hostname "$(hostname)"
curl -sfL https://get.k3s.io | K3S_URL=https://ana-pc:6443 K3S_TOKEN="$K3S_TOKEN" \
  sh -s - agent --node-label yuva.role=worker
```

Headscale (Tailscale kontrol sunucusunun açık kaynak eşdeğeri) 0.28.0 sürümüyle (4 Şubat 2026) etiketli (tag-only) ön-yetki anahtarlarını ve anahtarların bcrypt ile saklanmasını getirdi; etiketli anahtarla kaydolan düğüm bir kullanıcıya değil `tagged-devices` sahibine aittir. Bu, "cihaz Yuva'nındır, bir aile üyesinin değil" modeline birebir uyar. Varsayılan ön-yetki anahtarı tek kullanımlıktır ve bir saat geçerlidir. Güncel sürüm 0.29.x'tir (0.29.4: 23 Eylül 2026).

#### B5. Çalışan bir Windows'u USB'siz dönüştürmek

| Yöntem | Nasıl çalışır | Güvenilirlik | Yuva için |
|---|---|---|---|
| Grub2Win | Windows'a GRUB önyükleme girdisi ekler; diskteki ISO'dan önyükler | Orta | Yuva Windows uygulaması ISO'yu indirip girdi ekleyebilir |
| UNetbootin "Hard Disk" modu | ISO içeriğini diske kopyalayıp önyükleme girdisi oluşturur | Orta, eski | Yedek seçenek |
| WubiUEFI (topluluk çatalı) | Linux'u Windows bölümündeki bir dosyaya kurar | Düşük; resmî değil | Önerilmez |
| Bölüm küçült + FAT32 kurulum bölümü | Disk Yönetimi ile 8–16 GB bölüm açıp ISO'yu oraya yazmak | Orta | "Kurulum bölümüne yeniden başlat" senaryosu |
| Windows'tan iPXE zincirleme | iPXE EFI ikilisini önyükleme girdisi olarak ekleyip Yuva sunucusundan kurulum çekmek | Orta | En "Yuva'dan yönetilen" yol; Secure Boot sorunlu |
| LinuxGate vb. yeni araçlar | Bölümleme + ISO + GRUB otomasyonu | Alfa düzeyinde | Önerilmez |

**Engeller:**
- **Secure Boot:** Ubuntu'nun imzalı shim/GRUB'ı ile genelde sorun çıkmaz; ancak Grub2Win veya özel iPXE ikilileri Secure Boot'u kapatmayı gerektirebilir. Uzaktan BIOS ayarı değiştirmek tüketici dizüstülerinde genelde mümkün değildir.
- **BitLocker:** Windows 11'de cihaz şifrelemesi açıksa önyükleme sırasını değiştirmek kurtarma anahtarı sorabilir. Dönüşümden önce BitLocker'ı askıya almak veya kurtarma anahtarını not etmek gerekir.
- **UEFI vs legacy BIOS:** Eski Dell/Lenovo modellerde CSM/legacy modu açık olabilir; autoinstall her ikisini destekler ama Talos/balena gibi görüntüler GPT/UEFI'yi tercih eder.
- **Hızlı Başlatma (Fast Startup):** Windows NTFS'i kilitli bırakır; dönüşüm aracı bunu kapatmalıdır.

**Sonuç:** "Yuva uygulaması Windows içinden tek tıkla dönüştürür" bir **hedef deneyimdir**, ancak ilk sürümde güvenilir yol şudur: Yuva Windows yardımcı uygulaması (1) yedek alır, (2) BitLocker'ı askıya alır, (3) Grub2Win benzeri bir mekanizmayla Yuva autoinstall ISO'suna tek seferlik önyükleme girdisi ekler, (4) yeniden başlatır. Başarısızlık durumunda yedek plan bir kez USB ile kurulumdur.

#### B6. Silmeden katılmak: Windows'ta Yuva ajanı

- **Yerel Windows servisi:** psutil tabanlı Python ajanı (PyInstaller ile .exe) veya Go ile yazılmış tek ikili; Windows Hizmeti olarak çalışır. En az sürtünmeli yol.
- **WSL2:** Linux iş yüklerini (Tesseract, OCRmyPDF konteynerleri) çalıştırmak için uygundur; fakat WSL2 bir Hyper-V VM'idir, varsayılan olarak NAT arkasındadır ve Windows uyuyunca durur. 8 GB makinede Windows + WSL2 birlikte belleği zorlar. Bu mod "misafir cihaz" olarak işaretlenmeli, kritik görevler (yedek hedefi, kontrol düzlemi) verilmemelidir.

#### B7. Dizüstüyü sunucu olarak çalıştırma ipuçları

```ini
# /etc/systemd/logind.conf.d/yuva-lid.conf
[Login]
HandleLidSwitch=ignore
HandleLidSwitchExternalPower=ignore
HandleLidSwitchDocked=ignore
```
```bash
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
```
- Bazı modellerde kapak kapanınca Wi-Fi kopabilir; mümkünse kablolu Ethernet kullanın.
- Ekran arka ışığını kapatmak için `consoleblank=60` çekirdek parametresi kullanılabilir.
- **Pil = dahili UPS:** Kısa elektrik kesintilerini atlatır; ancak sürekli %100 şarj lityum pilleri şişirir. Dell (`smbios-battery-ctl` / BIOS "Primarily AC Use") ve Lenovo (BIOS veya `conservation_mode`) şarj limitini %60–80'e ayarlayın; şişmiş pil fiziksel güvenlik riskidir.
- **Isı:** Fanları temizleyin, kapağı hafif aralık bırakın veya dikey stant kullanın; `lm-sensors` ile sıcaklığı ajana raporlatın, 90 °C üstünde görev kabulünü durdurun.
- **Sürücüler:** Eski Dell/Lenovo'larda Intel Wi-Fi genelde kutudan çıktığı gibi çalışır; Broadcom kartlar `bcmwl-kernel-source` gibi ek paket ister. Autoinstall'da kablolu ağ yoksa kurulum sırasında Wi-Fi yapılandırması ek iş gerektirir.

#### B8. Hafif ve "cihaz" odaklı dağıtımlar

| Dağıtım | Model | Yönetim | Yuva için uygunluk |
|---|---|---|---|
| Ubuntu Server 26.04 LTS | Klasik, paket tabanlı | SSH, Ansible, cloud-init | **Kademe 1 için en iyisi**; geniş sürücü desteği |
| Debian minimal | Klasik, çok hafif | Aynı | Ubuntu'ya hafif alternatif |
| Alpine | musl, çok küçük | apk | Konteyner içi için harika; ana OS olarak sürücü/araç desteği sınırlı |
| Fedora IoT | rpm-ostree, değişmez | OTA, geri alma | İyi ama küçük topluluk |
| Talos Linux | Değişmez, yalnızca API (SSH/kabuk yok), yalnızca Kubernetes | `talosctl` + YAML makine yapılandırması | **"Tamamen Yuva'nın cihazı" fikrine en uygun**; Kademe 3 |
| Flatcar | Değişmez, konteyner odaklı | Ignition, otomatik güncelleme | Talos'a alternatif; SSH erişimi var |
| NixOS | Bildirimsel, tekrar üretilebilir | Tek yapılandırma dosyası | Güçlü ama öğrenme eğrisi dik |
| Ubuntu Core | Snap tabanlı, değişmez | snapd, Canonical mağazası | IoT için; Yuva için kısıtlayıcı |
| balenaOS | Değişmez, konteyner tabanlı, bulut panelli | balenaCloud / openBalena | **Cihaz filosu deneyimine en yakın hazır ürün** |

**Talos ayrıntısı:** Resmî minimumlar kontrol düzlemi için 2 GiB RAM / 2 çekirdek / 10 GiB disk, işçi için 1 GiB / 1 çekirdek / 10 GiB; önerilen kontrol düzlemi 4 GiB / 4 çekirdek. amd64 görüntüleri **x86-64-v2** mikro mimari düzeyini destekleyen CPU ister (kabaca 2009 sonrası Intel/AMD); yedek bilgisayarın işlemci modelini bu açıdan kontrol edin. Talos'un kabuğu yoktur; makine yalnızca API ile yönetilir. Bu, "cihaz Yuva'ya teslim edildi" fikrini teknik olarak garanti eder, fakat Yuva'nın Kubernetes'i birinci sınıf hedef alması gerekir.

**balenaOS ayrıntısı:** "Generic x86_64 (GPT)" cihaz türü seçilir, görüntü USB'ye yazılır, dizüstü USB'den açılır ve balenaOS dahili diske kurulur; resmî belge "bu işlem dahili depolama ortamını da tamamen siler, lütfen önce yedek alın" uyarısını yapar. Cihaz panelde görünür ve konteyner sürümlerini alır. balenaCloud 10 cihaza kadar ücretsizdir. openBalena (kendi sunucunuzda) ise hâlâ beta, tek kullanıcılı ve web paneli yok; delta güncellemeleri de içermez. Yani Yuva'nın kendi panelini yazması gerekir. Generic x86_64 (GPT) için Secure Boot + tam disk şifreleme balenaOS v2.114.21'den beri desteklenir.

### C. Tabletler

| Tablet türü | Ne yapılabilir | Sınırlar |
|---|---|---|
| **Android** | Termux (F-Droid sürümü) + Python/Go ajanı; Termux:Boot ile açılışta başlatma; Termux:API ile pil/sensör okuma; hafif görevler (dosya eşitleme, küçük OCR, bildirim, kiosk paneli) | Android 12+ "phantom process killer": AOSP varsayılanı sistem genelinde (uygulama başına değil) 32 phantom süreçtir (XDA Developers'ın aktardığı AOSP kodu; Termux #2366: max_phantom_processes=32); bu sınır aşılınca veya aşırı CPU kullanımında süreçler öldürülür; Android 12/13'te ADB ile kapatılır, Android 14+'da Geliştirici Seçenekleri'nde "Disable child process restrictions" anahtarı var. `termux-wake-lock` gerekir, pil optimizasyonu kapatılmalı; Doze modu ağ erişimini kısıtlar. Root yoksa Docker/k3s çalışmaz. |
| **Android + postmarketOS** | Desteklenen cihazlarda gerçek Linux; ajan/Docker çalışabilir | Yalnızca belirli modeller; Wi-Fi/şarj/kamera sürücüleri eksik olabilir; bootloader kilidi açmak gerekir |
| **iPad** | Yalnızca istemci: Yuva paneli (PWA), "duvar ekranı", Yuva defteri/mesajı için arabirim | iPadOS arka planda sürekli çalışan sunucu süreçlerine izin vermez; işletim sistemi değiştirilemez. Sunucu düğümü olarak **kullanılamaz** |
| **Windows tablet (Intel Atom/Core)** | x86 olduğu için Ubuntu Server kurulabilir; hafif işçi veya Yuva ekranı | Bazı Atom tabletler 32-bit UEFI kullanır (64-bit CPU'ya rağmen); dokunmatik/Wi-Fi/ses sürücüleri sorunlu olabilir; 2–4 GB RAM ile yalnızca hafif ajan çalıştırın |

**Öneri:** Tableti önce işletim sistemine göre sınıflandırın. Android ise "Yuva Ekranı + hafif sensör düğümü" rolü verin (pil yüzdesi, şarj durumu, çevrimiçi durumu raporlar; panel gösterir). Görev zamanlayıcıya "güvenilmez/kesintili düğüm" olarak işaretleyin (k3s'te taint, Ray'de özel kaynak yok). Windows/Intel ise Linux'a çevirip hafif işçi yapın.

### D. Yuva cihaz yönetim katmanı

#### D1. "Bağlı Cihazlar" listesi için ajan

**Hazır araç seçenekleri:**

| Araç | Ne sağlar | RAM | Yuva'daki rolü |
|---|---|---|---|
| node_exporter + Prometheus | Standart metrikler (CPU, RAM, disk, sıcaklık) | Exporter ~10–20 MB | Zaman serisi grafikleri |
| Netdata | Gerçek zamanlı panel, otomatik keşif | ~100+ MB | Ayrıntılı tanılama; 8 GB'ta kabul edilebilir |
| Glances | Tek araç, REST API | ~30–60 MB | Basit API ile Yuva'ya veri |
| osquery / Fleet | Cihaz envanteri SQL ile | Orta | Güvenlik/envanter (ileri aşama) |
| Cockpit | Web tabanlı sunucu yönetimi | Hafif (istek üzerine) | Yönetici için "derin erişim" bağlantısı |
| **Özel psutil ajanı** | Tam kontrol | ~20–40 MB (Python) | **Önerilen**: Yuva'ya özgü kayıt ve görev mantığı |

**Minimal ajan tanımı (öneri):**
- **Kimlik:** Kurulumda üretilen Ed25519 anahtar çifti; `device_id = hash(public_key)`.
- **Kayıt (enroll):** `POST /api/devices/enroll {token, public_key, hostname, hw}` → sunucu cihaz sertifikası/JWT döner. Token tek kullanımlık ve 1 saat geçerli olmalı.
- **Kalp atışı (her 15 sn):** `hostname, os, kernel, cpu_model, cores, cpu_percent, ram_total, ram_used, disk_total, disk_free, temps, battery_percent, on_ac, uptime, tailscale_ip, roles[]`.
- **Görev kanalı:** NATS konusu `yuva.tasks.<device_id>` veya WebSocket; görev = `{id, type, image, args, inputs, outputs, limits}`.
- **Uygulama:** Kademe 1'de ajan görevi `docker run` ile çalıştırır; Kademe 2'de ajan görev çalıştırmaz, yalnızca durum raporlar ve görevleri k3s/Nomad'a bırakır.

```python
import psutil, socket, time
def snapshot():
    b = psutil.sensors_battery()
    return {"host": socket.gethostname(), "cores": psutil.cpu_count(),
            "cpu": psutil.cpu_percent(1), "ram": psutil.virtual_memory()._asdict(),
            "disk": psutil.disk_usage("/")._asdict(),
            "battery": b.percent if b else None, "on_ac": b.power_plugged if b else True,
            "uptime": time.time() - psutil.boot_time()}
```

#### D2. Güvenli kaplama ağı (overlay)

| Seçenek | Model | Artı | Eksi |
|---|---|---|---|
| Tailscale | WireGuard tabanlı, SaaS kontrol | Kurulum çok kolay, ücretsiz kişisel plan | Kontrol sunucusu üçüncü tarafta |
| **Headscale** | Tailscale istemcileriyle uyumlu, kendi sunucunuz | Etiketli ön-yetki anahtarları (0.28+), tam kontrol | Kendi sunucunuzu çalıştırmalısınız (ana bilgisayar veya küçük VPS) |
| NetBird | WireGuard, açık kaynak, kendi sunucu seçeneği | Web paneli | Daha az olgun |
| ZeroTier | Kendi protokolü | Kolay | Lisans/kontrol modeli farklı |
| Saf WireGuard | Manuel | En hafif | Anahtar yönetimi Yuva'ya kalır |

**Öneri:** Başlangıçta Tailscale (en hızlı), Yuva olgunlaşınca Headscale. Headscale'i ana bilgisayarda çalıştırmak, o kapalıyken yeni cihaz kaydını engeller; kritik hâle gelince küçük bir VPS'e taşıyın.

#### D3. Uzaktan kontrol ve güncelleme

- **SSH + Ansible (pull modu):** `ansible-pull` her cihazda cron/systemd timer ile Yuva Git deposundan yapılandırma çeker; sunucunun cihazlara ulaşması gerekmez.
- **Mender:** A/B bölümlü OTA güncelleme; gömülü cihazlar için. Dizüstülerde kurulumu zahmetli.
- **balena/openBalena:** Konteyner tabanlı filo güncellemesi (yukarıda).
- **k3s system-upgrade-controller / Talos `talosctl upgrade`:** Kademe 2–3'te işletim sistemi ve küme yükseltmesi.
- **unattended-upgrades:** Ubuntu güvenlik yamalarını otomatik uygular; Yuva ajanı yeniden başlatma gerektiğini (`/var/run/reboot-required`) panele raporlar.

#### D4. Görevleri düğümlere eşlemek

| Görev | Araç (konteyner) | Kaynak ihtiyacı | Önerilen düğüm |
|---|---|---|---|
| OCR (PDF → aranabilir PDF) | OCRmyPDF (Tesseract içerir) | Sayfa başına CPU yoğun, 0,5–1 GB RAM | Ana bilgisayar (4 çekirdek) |
| Gelişmiş OCR (el yazısı, tablo) | PaddleOCR | 2–4 GB RAM, GPU yok → yavaş | Ana bilgisayar, tek seferde bir iş |
| Belge arşivi/indeksleme | Paperless-ngx (+ Redis, PostgreSQL, Tika/Gotenberg isteğe bağlı) | ~1–2 GB RAM | Ana bilgisayar (kalıcı servis) |
| Yedek hedefi | restic REST server / Kopia / Syncthing | Düşük CPU, çok disk | Yedek bilgisayar |
| Medya | Jellyfin | Donanım kod çözme yoksa CPU yoğun | Ana bilgisayar (Intel Quick Sync varsa) |
| Ev otomasyonu | Home Assistant (konteyner) | ~300–500 MB | Sürekli açık düğüm (ana bilgisayar) |
| Yuva defteri/mesajı arka ucu | Yuva servisleri + PostgreSQL | ~0,5–1 GB | Ana bilgisayar |
| Panel ekranı | Tarayıcı/PWA | — | Tablet |

Yuva, görev türü → rol etiketi → düğüm zinciriyle çalışmalı; örneğin `type=ocr` → `yuva.role=ocr` etiketi olan düğümler arasında en düşük CPU yükü olana. Ray kullanılırsa, binlerce sayfalık OCR işi sayfa başına Ray görevine bölünür ve iki makinenin toplam çekirdeklerinde paralel çalışır; bu, "birleşik makine" hissinin en somut karşılığıdır.

### E. Yedekleme rolü

**3-2-1 ilkesi:** 3 kopya, 2 farklı ortam, 1 kopya evin dışında. Evdeki iki eski dizüstü "2" kısmını karşılar; "1 kopya dışarıda" için şifreli bir bulut deposu (S3 uyumlu, Backblaze B2 vb.) veya bir akrabanın evindeki Yuva düğümü (Tailscale üzerinden) gerekir. Aynı evde, aynı prizde duran iki dizüstü yangın/hırsızlık/aşırı gerilime karşı koruma sağlamaz.

| Araç | Tür | Şifreleme | Tekilleştirme | Yuva için |
|---|---|---|---|---|
| restic | Anlık görüntü yedekleme | Evet (zorunlu) | Evet | **Önerilen**; REST server veya S3 hedefi |
| Kopia | Anlık görüntü yedekleme + GUI | Evet | Evet | Restic'e GUI'li alternatif |
| BorgBackup | Anlık görüntü (SSH) | Evet | Evet | Olgun; hedefte borg gerekir |
| Syncthing | Sürekli eşitleme | Aktarımda | Hayır | Yedek **değil** (silme de eşitlenir); "dosya versiyonlama" açılmalı |
| rsync | Dosya kopyalama | Hayır (SSH ile aktarımda) | Hayır | Basit ayna |
| Garage | Dağıtık S3 | Aktarımda (TLS) | — | 2–3 düğüm S3 gerekiyorsa |
| SeaweedFS | Dağıtık dosya/S3 | — | — | Daha karmaşık |
| MinIO CE | S3 | — | — | **Kullanmayın**: Aralık 2025'te bakım moduna alındı; GitHub'daki minio/minio deposu 25 Nisan 2026'da salt okunur arşive alındı ("THIS REPOSITORY IS NO LONGER MAINTAINED") |
| GlusterFS | Dağıtık dosya sistemi | — | — | Bakım durumu zayıf; 2 düğümde split-brain riski |
| Ceph | Dağıtık blok/nesne/dosya | — | — | **Aşırı**: en az 3 düğüm, ciddi RAM (OSD başına GB'larca); 8 GB dizüstülerde uygun değil |
| Longhorn (k3s) | Kubernetes blok depolama, replikasyon | — | — | Kademe 2'de kalıcı birimler için; 2 düğümde replika=2 |
| ZFS send/receive | Dosya sistemi anlık görüntü aktarımı | Yerel ZFS şifreleme | — | Güçlü; 8 GB RAM'de ARC sınırlanmalı |

**Garage ayrıntısı:** Resmî gereksinimler: son 10 yıldaki herhangi bir x86_64 CPU veya ARMv7/ARMv8, 1 GB RAM, en az 16 GB disk, ≤200 ms gecikme ve ≥50 Mbps ağ; ikinci el, heterojen makinelerle küme kurmak açıkça hedefleniyor. `replication_factor = 2` ile bir düğüm düştüğünde veri salt okunur kalır, yazmalar başarısız olur; `3` ile tek düğüm kaybında okuma-yazma normal sürer. Bu yüzden iki dizüstüyle Garage'ın değeri sınırlıdır; üçüncü bir düğüm (ör. uzak akraba evi) eklenince anlamlı hâle gelir. Ayrıca replikasyon faktörünü sonradan değiştirmek resmî olarak desteklenmeyen tehlikeli bir işlemdir; baştan doğru seçilmelidir.

**"Yeni cihaz geldi → eski cihaz yedek düğümü olur" otomasyonu:**
1. Yeni cihaz Yuva'ya kaydolur, `tier=primary` etiketi alır.
2. Yuva, eski birincil düğümdeki kalıcı servisleri (Paperless, veritabanları) yeni düğüme taşır: k3s'te etiket değiştirip pod'u yeniden planlamak; Docker modunda ajan `docker compose down` → veriyi `restic restore` → yeni düğümde `up`.
3. Eski düğüm `tier=backup`, `yuva.role=backup` etiketi ve `NoSchedule` taint'i alır; yalnızca restic REST server / Kopia deposu / Syncthing hedefi çalıştırır.
4. Yuva her gece yedeği eski düğüme alır, haftalık `restic check` ve aylık rastgele geri yükleme testi yapar; sonucu panelde "Son doğrulanmış yedek: …" olarak gösterir.

### F. Somut çözüm yolları (kademeli yol haritası)

**Donanım rolleri (tüm kademeler için):**
- **Ana bilgisayar (4 çekirdek, 8 GB, 256 GB SSD):** Kontrol düğümü + ana işçi (OCR, Paperless, Yuva arka ucu).
- **Yedek bilgisayar (2 çekirdek, 8 GB):** İşçi + yedek hedefi. Diski küçükse harici USB disk ekleyin.
- **Tablet:** Yuva ekranı / hafif düğüm.

**Gerçekçi performans beklentileri:**
- 8 GB RAM'de Ubuntu Server boşta ~300–500 MB kullanır; k3s sunucusu + iş yüküyle ~1,6 GB; geriye uygulamalar için ~5–6 GB kalır. İşçi düğümde k3s ajanı ~275 MB.
- OCRmyPDF/Tesseract eski 4 çekirdekli bir dizüstünde sayfa başına kabaca birkaç saniye ile onlarca saniye arasında sürer (çözünürlük ve dile bağlı; bu bir tahmindir, kendi belgelerinizle ölçün). İki düğüme dağıtmak toplu işlerde süreyi yaklaşık ana ve yedek bilgisayarın çekirdek oranında (4+2 → ~1,5 kat) kısaltır.
- Wi-Fi üzerindeki düğümler büyük dosya aktarımında darboğaz olur; ana ve yedek bilgisayarı kabloyla yönlendiriciye bağlayın.

| | **Kademe 1: Basit** | **Kademe 2: Küme** | **Kademe 3: Cihaz (appliance) OS** |
|---|---|---|---|
| OS | Ubuntu Server 26.04 LTS | Ubuntu Server 26.04 LTS | Talos Linux veya balenaOS |
| Kurulum | Autoinstall USB (Yuva üretir) | Autoinstall USB/PXE | PXE (iPXE) + makine yapılandırması |
| Ağ | Tailscale | Tailscale → Headscale | Headscale (Talos uzantısı / balena VPN) |
| Çalıştırma | Docker + Yuva ajanı (+ Portainer isteğe bağlı) | k3s (veya Nomad) + Yuva denetleyicisi; OCR toplu işleri için Ray isteğe bağlı | Talos: Kubernetes; balena: konteyner sürümleri |
| Görev atama | Yuva ajanı kendi kararını verir | Etiket/taint/affinity veya Nomad constraint | Kubernetes etiketleri / balena fleet değişkenleri |
| Ek RAM yükü | ~150–250 MB/düğüm | Sunucu ~1,6 GB, ajan ~275 MB (k3s); Nomad ~60–80 MB | Talos işçi minimumu 1 GiB; balenaOS hafif |
| Yuva yazılım işi | Kayıt defteri, ajan, görev kuyruğu, panel | + Kubernetes/Nomad API entegrasyonu, etiket yönetimi | + PXE sunucusu, makine yapılandırması üretimi, OTA akışı |
| Karmaşıklık / tahmini süre | Düşük; 1 geliştirici, ~2–4 hafta (tahmin) | Orta; ~1–2 ay (tahmin) | Yüksek; ~2–4 ay (tahmin) |
| Temel tuzak | Ajanın görev mantığı zamanla mini bir orkestratöre dönüşür | Kubernetes öğrenme eğrisi; 2 düğümde HA yok | Talos'ta kabuk yok, hata ayıklama zor; balenaOS'ta panel ya bulut (10 cihaz ücretsiz) ya da kendi paneliniz |

**Kademe 1 adımları:**
1. Yuva sunucusunda "Cihaz Ekle" → tek kullanımlık kayıt token'ı + Headscale/Tailscale anahtarı içeren autoinstall `user-data` üret → ISO veya Ventoy USB'si hazırla.
2. Cihaz USB'den açılır, disk silinir (LUKS'lu kurulum), Ubuntu Server kurulur.
3. `late-commands` → `enroll.sh`: Tailscale'e katıl, Docker'ı kur, Yuva ajanını systemd servisi olarak başlat, logind kapak ayarlarını yaz.
4. Ajan `POST /enroll` yapar; cihaz "Bağlı Cihazlar" listesinde görünür.
5. Kullanıcı cihaza rol atar (OCR/yedek/medya); ajan ilgili Docker Compose yığınını çeker.
6. "Yuva Makinesi" kartı toplam kaynakları gösterir; görevler kuyruğa (Redis/NATS) düşer, uygun ajan alır.

**Kademe 2 adımları:**
1. Ana bilgisayarda `curl -sfL https://get.k3s.io | sh -` (sunucu); token'ı Yuva'nın gizli kasasına koy.
2. Diğer düğümler enroll sırasında `K3S_URL`/`K3S_TOKEN` ile ajan olarak katılır, `--node-label yuva.role=...` alır.
3. Yuva denetleyicisi Kubernetes API'sini izler: `kubectl get nodes -o json` → panel; görev = Kubernetes `Job` (nodeSelector ile).
4. Kalıcı veri için Longhorn (replika 2) veya basit `local-path` + restic yedekleri.
5. İsteğe bağlı: KubeRay veya düz `ray start` ile OCR toplu işleri.
6. Nomad'ı seçerseniz: tek ikili, `client.meta` ile roller, parameterized batch job'lar ile "OCR çalıştır" görevleri; konteyner olmayan ikilileri de `exec` sürücüsüyle çalıştırabilirsiniz.

**Kademe 3 adımları:**
1. Ana bilgisayarda (veya küçük bir sürekli açık kutuda) dnsmasq proxy-DHCP + iPXE + HTTP sunucusu.
2. Talos Image Factory'den Tailscale uzantılı görüntü; Yuva her cihaz için `controlplane.yaml`/`worker.yaml` üretir (`install.disk`, `wipe: true`).
3. Cihaz ağdan açılır, Talos kurulur, kümeye katılır; Yuva API ile yönetir.
4. Alternatif: balenaOS Generic x86_64 (GPT) + balenaCloud (≤10 cihaz ücretsiz) veya openBalena + Yuva'nın kendi paneli.

**Yuva'nın kendi yazılımında olması gerekenler (tüm kademeler):**
- **Düğüm kayıt defteri:** `devices(id, name, public_key, roles, tier, hw_json, last_seen, status, owner='yuva')`.
- **Kayıt token akışı:** Tek kullanımlık, kısa ömürlü token; QR kod ile tablet/telefon kaydı; iptal (revoke) düğmesi.
- **Görev zamanlayıcı:** Görev türü → rol eşlemesi, kuyruk, yeniden deneme, zaman aşımı, sonuç depolama.
- **Toplu "sanal makine" görünümü:** Toplam/serbest kaynaklar, "en büyük tek görev kapasitesi", düğüm sağlık durumu.
- **Yaşam döngüsü:** "Birincil → yedek" geçişi, "cihazı emekliye ayır" (veri boşalt + sil), "yeniden kur" (PXE/USB).

### G. Güvenlik ve gizlilik

- **Veri silme:** Dönüşümden önce yedek → kullanıcı onayı → SSD'de `blkdiscard`/`nvme format`, HDD'de `shred`. Yeni kurulumda LUKS; emeklilikte LUKS başlığını silmek kriptografik silme sağlar.
- **Disk şifreleme:** Autoinstall'da LUKS. Gözetimsiz yeniden başlatma için parola yerine TPM2 bağlama (`systemd-cryptenroll --tpm2-device=auto`) veya ağ tabanlı kilit açma (Clevis + Tang, Tang sunucusu ana bilgisayarda) kullanılabilir; ancak Tang sunucusu ve istemci aynı evdeyse cihazla birlikte çalınma senaryosunda koruma zayıflar.
- **Kayıt güvenliği:** Token'lar tek kullanımlık ve kısa ömürlü; Headscale'de etiketli ön-yetki anahtarları; ACL ile cihazlar yalnızca Yuva kontrol düğümüyle konuşsun, birbirlerine SSH yalnızca `group:admins`'ten. k3s token'ı ISO'ya gömülüyse ISO'yu "gizli" kabul edin; tercihen ajan kayıttan sonra token'ı Yuva API'sinden alsın.
- **Ağ ayrımı:** Yönlendirici destekliyorsa Yuva düğümlerini ayrı bir VLAN'a veya en azından misafir ağı benzeri ayrı bir SSID'ye alın; aile cihazlarından Yuva'ya yalnızca panel portu açık olsun. Eski dizüstüler artık Windows güncellemesi almadığı için Linux'a geçiş başlı başına bir güvenlik kazancıdır.
- **Güncelleme stratejisi:** Ubuntu'da `unattended-upgrades` (yalnızca güvenlik), çekirdek yeniden başlatmaları Yuva'nın planladığı bakım penceresinde ve düğümler sırayla; Kademe 2'de system-upgrade-controller ile k3s yükseltmeleri; Kademe 3'te Talos/balena A/B güncellemeleri (başarısızlıkta otomatik geri dönüş).
- **Gizlilik:** OCR ve belge indeksleme tamamen yerel çalışır; bulut OCR API'lerine veri gönderilmez. Dış yedekler restic/Kopia ile istemci tarafında şifrelenir.

## Recommendations

1. **Hemen başlayın (Kademe 1):** Ana bilgisayarı Ubuntu Server 26.04 LTS + Docker + Tailscale ile "Yuva Ana Düğümü" yapın; yedek bilgisayarı aynı autoinstall USB'siyle "Yuva Yedek/İşçi Düğümü" yapın. Masaüstü sürümü kullanmayın (26.04 masaüstü minimumu 6 GB RAM).
2. **Yuva ajanını kendiniz yazın** (Python + psutil veya Go): kayıt, kalp atışı, rol, görev çalıştırma. Bu, sonraki tüm kademelerde değişmeden kalacak "Bağlı Cihazlar" altyapısıdır.
3. **"Birleşik makine" vaadini panelde dürüstçe tasarlayın:** Toplam kaynakları tek kartta gösterin ama "en büyük tek görev kapasitesini" ayrı belirtin. Gerçek RAM birleştirme peşine düşmeyin.
4. **OCR'yi ilk "dağıtık" özellik yapın:** OCRmyPDF konteyneri, sayfa/dosya bazında bölme; ileride Ray ile iki makinede paralel çalıştırma. Bu, kullanıcıya birleşik gücün en görünür kanıtıdır.
5. **Kademe 2 için k3s'i seçin** (Kubernetes ekosistemi, Longhorn, standart API); yalnızca konteyner dışı ikililer de çalıştıracaksanız veya RAM her MB önemliyse Nomad'ı tercih edin. Proxmox/Ceph'e iki dizüstüyle girmeyin.
6. **Yedek için restic + yedek bilgisayar + bir dış kopya** kurun; MinIO yerine gerekiyorsa Garage kullanın ve üçüncü düğüm olana kadar S3 kümelemesini ertelemeyi düşünün.
7. **Windows dönüşümünü ikinci aşamaya bırakın:** İlk sürümde USB ile kurulum; "Windows içinden tek tık dönüşüm" yardımcısını (yedek → BitLocker askıya alma → tek seferlik GRUB/iPXE girdisi) sonra geliştirin.
8. **Tableti önce tanımlayın:** Ayarlar → Hakkında ekranından OS'u öğrenin. Android → Yuva ekranı + Termux hafif ajanı; Intel Windows → Linux'a çevirip hafif işçi; iPad → yalnızca panel istemcisi.

## Caveats

- **Kaynak kalitesi:** k3s, Talos, Ubuntu, Proxmox, Headscale, Garage, balena ve Ray rakamları resmî belgelerden; k0s/MicroK8s minimumları ve Nomad'ın ~60–80 MB değeri ikincil kaynaklardan ve topluluk ölçümlerinden gelir. Bu minimumlar farklı koşullarda ölçüldüğü için birebir karşılaştırılmamalıdır.
- **Tahminler:** Geliştirme süreleri, OCR hızları ve gecikme/bant genişliği tablosu büyüklük sırası tahminleridir; kendi donanımınızda ölçün.
- **Yedek bilgisayarın işlemcisi bilinmiyor:** 2 çekirdekli eski bir model x86-64-v2 desteklemiyorsa Talos çalışmaz; Ubuntu Server yine çalışır. Ayrıca 2 çekirdek k3s *sunucusu* için minimum sınırdadır; yedek bilgisayarı yalnızca işçi yapın.
- **Lisans/ürün değişkenliği:** MinIO örneği, açık kaynak altyapıların hızla durum değiştirebildiğini gösterdi; Nomad'ın BSL lisansı ev kullanımını engellemez ama Yuva'yı ticari bir ürün olarak dağıtacaksanız lisansı ayrıca inceleyin. openBalena hâlâ beta.
- **Windows içinden uzaktan dönüşüm** aracı (Grub2Win, WubiUEFI, LinuxGate) resmî değildir ve model/BIOS'a göre başarısız olabilir; her zaman USB/PXE yedek planı bulundurun.
- **İki düğümde yüksek erişilebilirlik yoktur:** Ana bilgisayar kapanırsa k3s kontrol düzlemi de kapanır. Gerçek HA için üç düğüm (veya Proxmox'ta QDevice) gerekir; ev senaryosunda bu çoğu zaman gereksizdir, ancak beklentiyi buna göre kurun.