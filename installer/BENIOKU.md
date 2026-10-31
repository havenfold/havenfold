# installer — Kurulum USB'si, var olan Ubuntu'ya kurulum ve silme ortamı

RFC-0007 §8 (Kurulum USB'si), §9 (ilk açılış), §10 (laptopu sunucu yapma), §13.2–13.5 (silme ortamı) ve RFC-0026
(kökün durumu, sabit yoldan çalışan kök kodu). Lisans MPL-2.0 (kurucu belge §17.1).

> **Durum:** ISO GitHub Actions'ta derlenir ve sanal makinede (QEMU + KVM, OVMF Güvenli Önyükleme açık, swtpm TPM 2.0)
> baştan sona denenir: `.github/workflows/install.yml` (aşağıda "Sanal makine denemesi"). Gerçek donanımda henüz
> denenmedi; kalanlar en alttaki listededir.

## Dizinler

| Yol | Ne |
|-----|----|
| `build/havenfold-usb-build.sh` | Ubuntu Server 24.04 ISO'sundan `havenfold-kurulum-<sürüm>-amd64.iso` üretir (xorriso). |
| `build/notification-check.js` | Derlemede imzalı bildirimi, paketi ve `.deb`'leri denetler; USB'ye `paket.json`, `ozetler`, `kok.durum`, `node` çıkarır. |
| `build/erase-root-build.sh` | Silme ortamı: `vmlinuz`, `initrd`, `kok.squashfs` (mmdebstrap, Ubuntu noble). |
| `build/deb-collect.sh` | Çevrimdışı `.deb`'ler (`installerDebs`): ISO'daki `ubuntu-server-minimal` katmanında `apt --download-only`. |
| `build/havenfold-install-build.sh` | Tek dosyalık `havenfold-kur` (§8.6): kök durumu sabit, kurulum aracı gömülü. |
| `build/grub.cfg`, `build/nocloud/` | Menü (§8.2) ve otomatik kurulum dosyası (§8.3). |
| `bin/hf-on-kontrol`, `bin/hf-depolama-yaz`, `bin/hf-hedefe-kur` | USB'de `/havenfold/bin/`: §8.4 ön kontrol, §8.3 depolama bölümü, late-commands. |
| `target/common.sh` | USB yolu ve `havenfold-kur`un ortak adımları (paket, kullanıcılar, kökün durumu, birimler, §10). |
| `target/hf-ilk-acilis`, `target/hf-luks-yenile`, `target/systemd/` | §9 ilk açılış, §8.5 TPM bağı ve kurtarma anahtarı, `havenfold-nft`. Hedefte `/usr/lib/havenfold/kurulum/`. |
| `install/havenfold-kur.sablon`, `install/notification.sh` | §8.6 betiği ve kabukta bildirim doğrulayıcısı (OpenSSL Ed25519 + b2sum). |
| `lib/` | Kurulumun saf mantığı (bağımlılıksız JS; USB'de paketteki Node ile çalışır), `lib/cli.js` kabuk girişi. |
| `erase/` | Silme ortamı: keşif, yöntem, örnek, desen, bilet, rapor, oturum (saf) ve `shell.js` (komut çalıştıran ince kabuk). |
| `erase-mode/` | Silme kök dosya sisteminin birimleri ve ağ kapatma kuralları. |
| `test/` | `brittle` testleri; `test/helpers/tools/` macOS için `b2sum` ve `base32` taklitleri. |
| `test/vm/` | Yalnız CI (`.github/workflows/install.yml`): test köklü ISO derlemesi, test ISO'su, QEMU sürücüsü, hedef kancaları. |

USB'deki düzen (§8.1'e eklenenler işaretli):

```
/nocloud/user-data, meta-data
/havenfold/<paket>.zip, bildirim.bin, kok.durum, deb/, bin/
/havenfold/paket.json, ozetler, surum            (ek: sürüm bilgisi, kurulumda yeniden denetlenen özetler)
/havenfold/kurulum/                              (ek: node, lib/, erase/, target/, vendor/zip.js, node_modules/b4a)
/erase-mode/vmlinuz, initrd, kok.squashfs
/boot/grub/grub.cfg
```

## Derleme (Linux)

Düğüm paketi (`havenfold-node-<sürüm>-amd64.zip`) ve imzalı bildirim (`havenfold-node.bildirim`) sürüm hattından gelir:
`.github/workflows/release.yml` derler, Kerem çevrimdışı imzalar (`docs/surum.md`).

Gerekenler: xorriso, sha256sum, b2sum, mmdebstrap, squashfs-tools, Node 22+, depo kökünde `npm ci`. `deb-collect.sh` ve
`erase-root-build.sh` kök olarak çalışır (chroot, mmdebstrap root kipi); betikler hiçbir diske yazmaz. İmza anahtarı
gerekmez: bildirim ve kök durumu imzalı olarak dışarıdan gelir. CI'da aynı adımlar `test/vm/test-iso-build.sh`'tadır.

```sh
# 0) Çevrimdışı Ubuntu paketleri; dizin, sürüm hattında release-build.js paket --deb-dizini ile bildirime girer
sudo bash installer/build/deb-collect.sh --iso ubuntu-24.04.5-live-server-amd64.iso --cikti deb/

# 1) Silme ortamı (paketteki Node çalışma zamanı ile)
sudo env PATH="$PATH" bash installer/build/erase-root-build.sh --surum 1.2.3 --node <paketten çıkarılmış node> --cikti erase-mode/

# 2) Kurulum USB'si imajı
bash installer/build/havenfold-usb-build.sh \
  --iso ubuntu-24.04.5-live-server-amd64.iso --iso-sha256 <Canonical'ın SHA256SUMS'undaki değer> \
  --surum 1.2.3 --paket havenfold-node-1.2.3-amd64.zip --bildirim havenfold-node.bildirim \
  --kok-durum kok.durum [--kok-zinciri kok-zinciri.bin] --deb-dizini deb/ --silme-dizini erase-mode/ --cikti cikti/

# 3) Var olan Ubuntu için tek dosya (macOS'ta da çalışır)
bash installer/build/havenfold-install-build.sh --kok-durum kok.durum --surum 1.2.3 --cikti havenfold-kur
```

`deb/` bildirimin `installerDebs` listesindeki dosyaların tamamıdır (bağımlılıklarıyla); dizinde listede olmayan ya da
listede olup dizinde olmayan dosya derlemeyi durdurur.

## USB'ye yazma

En az 8 GB bellek. Önce özeti ve imzasını denetleyin: `SHA256SUMS.sig`'in sürüm kök anahtarıyla geçerli olduğunu, sonra
`sha256sum -c SHA256SUMS`.

- Linux: `lsblk` ile USB'nin adını bulun (ör. `/dev/sdX`; **sistem diskini seçmeyin**), sonra
  `sudo dd if=havenfold-kurulum-1.2.3-amd64.iso of=/dev/sdX bs=4M conv=fsync status=progress`.
- macOS / Windows: balenaEtcher ya da Rufus (DD kipi).
- `havenfold usb-hazirla <aygıt>` (RFC-0007 §7, yetki yardımcısının `usb-yaz` işlemi) henüz yok.

## ISO özeti: SHA256SUMS

ISO'nun SHA-256'sı sürüm bildirimine girmez: ISO bildirimi taşıdığı için kendi özetini taşıyan bildirim üretilemez.
Yayında ayrı bir `SHA256SUMS` dosyası olur ve sürüm kök anahtarıyla ayrıca imzalanır (`SHA256SUMS.sig`).
`havenfold-usb-build.sh` `SHA256SUMS`'u imzasız üretir; imzayı Kerem çevrimdışı atar. Ajan makinelerinde ve derleme
makinesinde kök anahtar yoktur. Bildirimin `installer` listesi bu kararla boş kalabilir.

## Kurulum akışı

1. Menü (15 sn): **Diskten başlat** (varsayılan, hiçbir şey silmez) · **Havenfold kur — diski SİLİNİR** · **Silme modu**.
2. `hf-on-kontrol` (tty3): x86-64-v2, RAM, ≥ 64 GB iç disk, pil görsel kontrolü, hedef disk (NVMe → SSD → en büyük),
   120 sn içinde `SIL`, TPM 2.0 mühürle–aç denemesi (yoksa `TAMAM`). Ağ adı `havenfold-xxxx`.
3. `hf-depolama-yaz`: LVM; TPM varsa LUKS2 ve 32 baytlık geçici parola (yalnız RAM'de); 4 GB takas.
4. Subiquity Ubuntu'yu kurar; `hf-hedefe-kur /target`: özetleri b2sum ile yeniden denetler, `.deb`'leri çevrimdışı
   kurar, paketi `/opt/havenfold/surumler/<sürüm>`'e açar, kullanıcılar/dizinler, `kok.durum` ve `yetki.durum`
   (`/var/lib/havenfold/yetki`, 0700), §10 ayarları, nftables, birimler, TPM varsa Clevis bağı (PCR'sız).
5. İlk açılış: `havenfold-luks-yenile` bağı PCR 7'ye taşır, kurtarma anahtarını ekler (yuva LUKS2 jetonuyla işaretli),
   geçici parolanın yuvasını siler. `hf-ilk-acilis` (tty1): ağ/Wi-Fi, saat, yönetici parolası, durum özeti, rol,
   kimlikler, tören; sonra durum ekranı.

## Silme modu

`havenfold-sil` RAM'de, ağ kapalı çalışır: bileti ESP'lerden salt okunur arar, diskleri keşfeder (iç diskler seçili,
harici diskler ayrıca `E`), rapor anahtarını üretip `HFK1` QR'ını gösterir, `SIL` onayından sonra her diske §13.4
sırasıyla yöntem uygular (önce LUKS yuvaları ve başlık; TRIM hiçbir yolda yok), her disk için `WIPE_REPORT` imzalar ve
`HFW1` parçalarını (metin konsolunda 128 bayt) döndürür. Raporlar `core/core/protocol/retirement.js` `verifyWipe` ile
doğrulanır (testler bunu yapar). Bilet yoksa (`ids` boş, `hostId` ve `retireNonce` sıfır, raporların `deviceId`'si sıfır)
telefon `verifyWipe(..., { biletsiz: true })` çağırır; sonuçtaki `biletsiz: true` kullanıcıya "Kimlik doğrulanamadı; bu
cihazı siz mi seçtiniz?" diye sorulması gerektiğini söyler (RFC-0007 §13.2 adım 4). Seçenek verilmezse davranış eskisi gibidir. `shell.js` yalnız Linux'ta, çekirdek satırında `havenfold.silme=1` ve
`/etc/havenfold-silme` işaretiyle açılır; başka makinede hiçbir komut çalıştırmaz.

## Testler

```sh
export PATH=/opt/homebrew/opt/node@22/bin:$PATH   # macOS
node_modules/.bin/brittle-node installer/test/*.js   # depo kökünden; ya da installer/ içinde npm test
node_modules/.bin/brittle-node node/test/setup.js node/test/luks-recovery.js
```

Vektörler: `protocol/vectors/erasure.json` (RFC-0007 §16 madde 9–11), üretici `test/helpers/erasure-vector.js`.

## Sanal makine denemesi (CI)

`.github/workflows/install.yml` elle çalışır (Actions → `install` → "Run workflow"); Actions dakikası sınırlı olduğu
için zamanlanmış çalışma kapalıdır. Üç iş:

1. **ISO derlemesi** (`test/vm/test-iso-build.sh`): resmî Ubuntu Server 24.04.x ISO'su (`SHA256SUMS`, önbellekte),
   `runtime.sh`, `deb-collect.sh`, `release-build.js paket`, `erase-root-build.sh`, `havenfold-usb-build.sh`. Tek
   fark: bildirim iş akışında üretilen **geçici test kök anahtarıyla** imzalanır, anahtar hemen silinir ve ISO'ya bu
   kökün `kok.durum`'u girer. Aynı kaynaktan derlenen ISO önbellekteyse yeniden derlenmez.
2. **Sanal kurulum**: boş 80 GB NVMe; ISO USB bellek olarak takılır. `test/vm/test-iso.sh` üretim ISO'sundan test ISO'su
   türetir: zaman aşımı 3 sn, varsayılan girdi "kur", seri konsol; user-data'da komutlar `/hf-test/calistir` ile sarılır
   (sorular ve çıktı ttyS1'e), late-commands'a test kancaları eklenir. Sürücü (`test/vm/driver.js`) "SIL" yazar;
   kurulumdan sonra USB'siz iki açılış: ilk açılış ttyS1'de (test drop-in'i), yönetici parolası iş akışında üretilir ve
   günlüğe yazılmaz, rol işçi. `hf-test-denetim` sonuçları seri konsola yazar, bir kez yeniden başlatır (PCR 7 bağı
   sınanır), sonra kapatır.
3. **Silme modu**: NVMe (diskin tamamı LUKS2) ve SATA (ESP'de test bileti) rastgele veriyle; varsayılan girdi "sil".
   QR'lar ekran görüntüsünden (QMP screendump + zbarimg) okunur, tuşlar QMP ile basılır; sonra `verifyWipe` ve önceden
   kaydedilen rastgele blokların değiştiği denetlenir.

Seri konsollar, sürücü günlükleri ve ekran görüntüleri iş akışı çıktısıdır.

## Ne doğrulandı, ne doğrulanmadı

Sanal makinede doğrulandı (Ubuntu Server 24.04.5, install.yml, Ekim 2026):

- ISO derlemesi (`-boot_image any replay`), Güvenli Önyükleme açık UEFI'de USB'den GRUB menüsü, Türkçe menü yazıları,
  kurulum ve silme girdileri; Canonical imzalı çekirdekle silme ortamının açılması.
- `deb-collect.sh` ile 63 `.deb`; `notification-check.js` test köklü imzalı bildirimle; kurulumda b2sum denetimi ve
  `dpkg -i` ile çevrimdışı kurulum.
- `hf-on-kontrol` (ttyS1'de): hedef NVMe seçimi, `SIL` onayı, USB'deki tpm2-tools ile TPM 2.0 mühürle–aç denemesi.
  `hf-depolama-yaz`: subiquity'nin `/autoinstall.yaml`'ı yeniden okuması, `match: serial` glob'u, LUKS2 + LVM.
- `hf-hedefe-kur`: paket, kullanıcılar, kökün durumu, §10 ayarları, nftables, birimler, PCR'sız Clevis bağı,
  `ilk-ayar --kurulum`.
- Kurulum günlüklerinde geçici parola kalmadı (`/var/log`, `/etc`, `/root`, `/var/lib/cloud`, `/home` tarandı).
- İlk açılış: TPM ile parolasız açılış; `havenfold-luks-yenile` bağı PCR 7'ye taşıdı, kurtarma yuvasını
  `havenfold-kurtarma` jetonuyla ekledi, geçici yuvayı sildi; kurtarma dosyası (0600, 32 bayt) Crockford kodlanınca
  diski açıyor. `hf-ilk-acilis`: ağ, saat, yönetici parolası, durum özeti, rol, `ilk-ayar --rol isci` (TPM mühürlü
  kimlik, `tpm: muhur-ok`), tören QR'ı. Denetçi, işçi, yetki soketi, nftables tablosu ayakta, başarısız birim yok.
- İkinci açılış: PCR 7 bağıyla parolasız açılış, kimlik aynı.
- Silme modu: casper `live-media-path=/erase-mode` + `toram`, ağ kapalı, ESP'den bilet, `cryptsetup erase` + başlık,
  `nvme format --ses=1` (QEMU'da sanitize yok), SATA'da `hdparm -I` ve overwrite-verify, anahtar ve rapor QR'larının
  ekrandan okunması, `verifyWipe`, disklerdeki örnek blokların değişmesi; açılış USB'si listede görünmedi.

Doğrulanmadı: gerçek donanım (aşağıdaki liste), BIOS ve Güvenli Önyükleme kapalı UEFI, "Diskten başlat"ın iç diske
düşmesi, Wi-Fi, pil, NVMe sanitize ve ATA Sanitize/Security Erase (QEMU sunmuyor), QR'ın telefonla okunması.

## RFC'den sapmalar (Kerem kabul etti, 24 Ekim 2026)

- **Disk şifreleme Clevis ile** (RFC-0007 §8.5'e uygun; görevdeki systemd-cryptenroll değil).
- **Düğüm paketi `.zip`** (RFC-0007 §8.1 `.tar.zst` diyor): yetki yardımcısının `paket-ac`'ıyla aynı kanonik ZIP.
- **Silme ortamı Node ile çalışır** (RFC-0007 §13.2 Bare diyor); Bare desteği İstek 151'e kadar.
- **Rapor QR'ları 128 baytlık parçalar**; QR çerçeve arabelleğine (`/dev/fb0`) piksel olarak çizilir, yoksa metin
  konsoluna. 384 baytlık parça kullanılmıyor.
- USB'de §8.1'e ek dosyalar (`/havenfold/kurulum/`, `paket.json`, `ozetler`, `surum`); user-data'da `yonetici`'nin
  grubuna `havenfold-yonetim` (kullanıcıyı ilk açılışta cloud-init açar).
- HyperDHT için sabit port yok: nftables `hyperdht_udp` kümesi boş başlar, taşıyıcı portunu çalışma anında ekler
  (`target/systemd/havenfold-nft.service`).

## Düğüm yazılımıyla bağlar

- `havenfold setup` (eski adı `ilk-ayar`; `node/setup.js`, `node/command.js` kancası): `--install` (eski `--kurulum`) hostId'yi, `--role` (eski `--rol`) kimlikleri üretir.
  Kimlik kutu çekirdeğinin kalıcı katmanıyla (`worklet/persistence.js`, `<rol dizini>/cekirdek`, TPM mühürlü
  `platform.muhur` ve `arsiv.muhur`; yardımcılar `node/box.js`'ten) üretilir. **İşçi çekirdeği (`isci.js`) kimliğini
  aynı biçimde açmalıdır.** `<rol dizini>/kimlik` birimlerin `ConditionPathExists` işaretidir, sır taşımaz.
- `luks-kurtarma` yetki işlemi (`node/privilege-helper.js`): `oku` / `sil`; dosya `/var/lib/havenfold/yetki/luks-kurtarma`
  (ham 32 bayt). Telefon anahtarı Crockford base32 küçük harfle (52 karakter) göstermeli; LUKS yuvasındaki parola budur.

## Açık işler

- Paket düzeni `node/scripts/pack.sh`'tadır (kökte `node`, `bare`, `bin/havenfold`, `cekirdek/`, `denetci/`; kod,
  `systemd/` ve `deploy/` `lib/node/` altında; yardımcının kopyası `yetki/`). `target/common.sh` bu düzeni okur.
- `NODE_RECOVERY` (0xDE) çekirdekte var (işçi → denetçi → yetki yardımcısının soketi `/run/havenfold/yetki/yetki.sock`
  → töreni yapan ebeveynin telefonu, alındıdan sonra silme; uçtan uca test `node/test/task-network.js`). Soket dizini
  `tmpfiles.conf`'tan açılışta gelir (`common.sh` yalnız `/var/lib` ve `/etc`'yi kurar; `/run` tmpfs'tir). Gerçek
  donanımda `havenfold-yetki.socket` ile denenmedi. Tek kimlikli kutu düğümünde kutu çekirdeği tarafı yazılmadı.
- Silme ortamının Bare uyarlaması (bare-subprocess, bare-fs).
- Tören QR'ı (`havenfold katil`) Linux konsolunda (çıktı `/dev/ttyN` ve etkin VT, ya da `TERM=linux`; SSH değil;
  `/dev/fb0` yazılabilir) silme ortamıyla aynı çerçeve arabelleği çizimiyle piksel olarak çizilir (`node/qr-screen.js`;
  konsol yazı tipi yarım blokları taşımıyor). Resimlerin adları ve süre QR'ın altında metin olarak sürer, her yeni QR
  yeniden çizilir; `~/havenfold-katil.png` aynen yazılır. SSH'ta, terminal emülatöründe ve seri konsolda yarım blok
  kalır. İlk açılış kök olarak tty1'de koştuğu için fb0 yazılabilir; yönetici tty1'de elle çalıştırırsa `video`
  grubunda değilse yarım bloğa düşer. Sanal makinede ilk açılış ttyS1'de koştuğu için piksel yolu denenmedi; gerçek
  ekranda (ve sanal makinede tty1'de) telefonla okunması denenmeli. `havenfold ekran` (havenfold-ekran.service) yalnız
  durum metnini gösterir (10 saniyede bir okur, değişince çizer, ekran 1 dakikada kararır); tören QR'ı göstermez. QR
  eklenirse aynı modülü kullanmalı ve birim `video` grubunu almalı (birim kullanıcısı `havenfold-ekran`).

## Gerçek donanımda denenecekler

✓ sanal makinede denendi (install.yml), ◐ kısmen; işaretsizler hiç denenmedi. Sanal makine gerçek donanımın yerini
tutmaz: işaretli maddeler de gerçek cihazda bir kez yinelenmeli.

1. ◐ ISO derlemesi ✓; UEFI + Güvenli Önyükleme açık makinede menü ✓; UEFI kapalı ve BIOS makinede menü; "Diskten
   başlat"ın iç diske düşmesi.
2. ◐ Tek NVMe'li dizüstü: ön kontrol (tty3'e geçiş, pil sorusu), TPM mühürle–aç denemesi (USB'deki tpm2-tools ile) ✓,
   LUKS2 + LVM kurulumu ✓, Clevis PCR'sız bağ ✓, ilk açılışta PCR 7'ye geçiş ✓, kurtarma yuvası ve geçici yuvanın
   silinmesi ✓. tty3 ve pil sorusu sanal makinede ttyS1'deydi, pil yoktu.
3. ✓ Kurulum günlüklerinde geçici parolanın kalmadığı (`/var/log/installer`), subiquity'nin günlükleri late-commands'tan
   sonra kopyalayıp kopyalamadığı (kurulan sistemde `/var/log/installer`'da yalnız `media-info` kaldı).
4. Güvenli Önyükleme kapatılıp açılınca kurtarma anahtarıyla açılış ve `havenfold-luks-yenile`'nin yeniden bağlaması.
5. TPM'siz makine: şifresiz kurulum ve uyarılar (sanal makinede TPM denemesi tutmadığında bu yol çalıştı ve kurulum
   şifresiz bitti). İki iç diskli makine: diğer diskin dokunulmadan kalması.
6. Pil eşiği: ThinkPad (`charge_control_*`), IdeaPad (`conservation_mode`), eşiksiz bir makine (sanal makine: "Pil
   sınırı yok" uyarısı).
7. Wi-Fi'lı ilk açılış (`iw` yoksa elle SSID), kapalı sürücülü kartta kablolu ağ uyarısı.
8. ◐ Silme modu: NVMe sanitize (blok ve şifreleme), Format NVM ✓ (QEMU), ATA Sanitize, Security Erase, donmuş SSD ve
   `rtcwake`, HPA'lı HDD, eMMC, USB disk; açılış USB'sinin listede görünmemesi ✓; LVM/RAID'in diski meşgul tutup
   tutmadığı; QR'ların telefonla okunması (ekran görüntüsünden okundu ✓) ve `verifyWipe` ✓.
9. Var olan Ubuntu 24.04'te `havenfold-kur` (amd64 ve arm64): SSH ve ufw'nin etkilenmemesi.
