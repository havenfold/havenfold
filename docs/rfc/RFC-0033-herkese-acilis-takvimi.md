# RFC-0033 — Herkese açılış takvimi ve kapının netleşmesi

> Durum: **Onaylandı** (Kerem, 24 Ekim 2026), kurucu belge 1.18 · 24 Ekim 2026 · Yazan: Havenfold çekirdek ekibi · Onay: Kerem
> Kaynak: Kerem'in 24 Ekim 2026 kararı ("Aralık ne demek?"); kurucu belge §17, §18, §20, §20.1, §20.2.
> Etkilenen bölümler: kurucu belge §18.2, §20 (Faz 4 satırı), §20.2, §22.
> **Protokol değişikliği: yok.** Numara, zarf, olay, düzey değişmez. Yalnız takvim, kapı maddelerinin anlamı ve açılış günü adımları.

## 1. Sorun

- §20 depoyu Faz 4'te (Haziran 2027 →) açar. Bu tarih insan ekibi hızıyla yazılmıştı.
- Çekirdeğin bugünkü hali (yaklaşık 25 bin satır kod, 25 bin satır test, D0–D81) 23–24 Ekim'de, iki günde yazıldı. Kapıdaki kod ve belge işleri gün ölçeğindedir.
- Kapıyı uzatan kod değil dış işlerdir: patent kararı, alan adı, marka başvurusu, evlerde fiziksel kurulum.
- Kapının iki maddesi yoruma açık: "Ev Makinesi v0 en az üç evde çalışıyor" (süre şartı var mı?) ve "CI: imzalı sürüm bildirimi" (imzayı kim atar?).
- Açılış işlerinin bir kısmı Dell'in ve Air'in dosyalarında; iki makine de dolu.

## 2. Öneri özeti

1. Açılış Faz 4'ten ayrılır. Tarih takvime değil **kapıya** bağlıdır: kapının bütün maddeleri tamamlanınca açılır. Hedef: **2–3 Kasım 2026**.
2. Kapı maddeleri aynen kalır; iki madde netleşir (§3).
3. Açık depo **yeni ve temiz bir geçmişle** başlar. Bugünkü kapalı depo arşiv olur (§5).
4. Açılış işleri için Mac'e kod yazma istisnası verilir (§4).
5. Bağımsız güvenlik denetimi açılış koşulu değildir; Faz 3'te kalır. README ve SECURITY bunu açıkça yazar.

## 3. Kapının netleşen maddeleri

| Madde (§20.2) | Bu RFC'den sonra anlamı |
|---------------|--------------------------|
| Ev Makinesi v0 en az üç evde çalışıyor | Üç ayrı evde: bir kutu ve en az bir işçi törenle topluluğa katılmış; bir `hf.task.ocr` ve bir `hf.task.backup` işi başarıyla bitmiş; Ev Makinesi kartı cihazları gösteriyor. **Süre şartı yoktur.** "14 gün kesintisiz" Faz 1'in çıkış ölçütü olarak kalır, açılış koşulu değildir. |
| CI: test, lint, amd64/arm64 derleme, imzalı sürüm bildirimi | CI testleri ve kabuk denetimini koşar, sürüm bildirimini **imzasız** üretir. İmzayı sürüm kök anahtarıyla Kerem çevrimdışı atar (§9.4; kök anahtar CI'da ve ajan makinelerinde bulunmaz). Kapı, ilk etiketli sürümün bildirimi Kerem imzalıyken geçer. arm64 işi depo açılınca çalışır (GitHub'ın arm64 makineleri kapalı depoda ücretli). |
| `kollar/`, iç notlar, makine adları ve kişisel bilgiler temizlendi | §5'teki temiz geçmişle yapılır. Ayrıca: `node/deploy/` varsayılanlarında makine yolu kalmaz; `scripts/` ve `kontrol.sh` `kollar/`'a başvurmaz (kapsam tablosu `docs/`'a taşınır). |
| `havenfold.io` ve `havenfold.org` alındı | Ayrıca `security@`, `hello@` ve `conduct@havenfold.io` adresleri çalışıyor (SECURITY.md, TRADEMARKS.md, CODE_OF_CONDUCT.md bu adresleri yazar). |

## 4. Mac'e kod yazma istisnası

- Kerem 24 Ekim 2026'da açılış işlerinin kodunu Mac'e verdi; `AGENTS.md`'deki dosya sahipliği bu işler için askıya alınır.
- Mac yalnız `kol/acilis-*` dallarında yazar: `kol/acilis-belge` (lisanslar, açılış belgeleri, CI, bu RFC, kurucu belgenin İngilizcesi), `kol/acilis-imaj` (görev imajları, Podman çalıştırıcısı, giriş betikleri), `kol/acilis-guvenlik` (belge–kod farkı olan güvenlik açıkları), `kol/acilis-kurulum` (Kurulum USB'si ve silme ortamı).
- Her dal PR ile girer. Dell'in ve Air'in açık dallarıyla çakışma birleştirmeden önce çözülür; kendi dosyalarına dokunulan kol PR'da anılır.
- Açılış bitince istisna kalkar.

## 5. Açılış günü

1. Kapının bütün maddeleri işaretli (§6 tablosu).
2. Kapalı depo `havenfold/havenfold-arsiv` adını alır, kapalı kalır. Geçmişi, PR'ları ve `kollar/` orada durur.
3. Temizlenmiş ağacın tek bir anlık görüntüsü yeni `havenfold/havenfold` deposuna ilk kayıt olarak girer. İlk kayıt GitHub'ın noreply adresiyle ve `Signed-off-by` ile atılır.
4. Gizli bilgi taraması (gitleaks) yeni depoda koşar; bulgu yalnız test vektörlerindeki örnek anahtarlardır ve `.gitleaks.toml`'da tek tek gerekçeli yazılıdır.
5. GitHub ayarları: özel güvenlik açığı bildirimi açık, `main` dal koruması (PR, yeşil `kontrol`, bir onay), organizasyonda zorunlu iki adımlı doğrulama, ikinci organizasyon sahibi.
6. Depo herkese açılır; ilk sürüm etiketi `v0.1.0-alfa` Kerem imzalı bildirimle.

**Ek (30 Ekim 2026, Codex 12. tur): 5. ve 6. adımların açıklığı.** Yeni depo eskisinin ayarlarını taşımaz; şunlar
yeni depoda elle kurulur:
- "Yeşil `kontrol`" `check.yml`'nin üç denetimidir: `check (ubuntu-24.04)`, `check (ubuntu-24.04-arm)` ve
  `shell scripts`. arm64 denetimi yalnız açık depoda koşar ve dal koruması ücretsiz planda kapalı depoda kurulamaz;
  bu yüzden sıra: depo açılır, `check.yml` elle bir kez koşturulur (`workflow_dispatch`), üç denetim yeşil görülür,
  sonra `main` koruması bu üç adla kurulur.
- Dependency graph, Dependabot uyarıları ve Dependabot güvenlik güncellemeleri açılır. `.github/dependabot.yml` npm
  sürüm PR'larını kapatır (`open-pull-requests-limit: 0`); npm'deki açıklar yalnız bu ayarlarla gelir.
- GitHub Discussions açılır (sorun şablonlarının soru bağlantısı oraya gider) ve `rfc` etiketi oluşturulur (RFC sorun
  şablonu bu etiketi verir).

**Neden yeni geçmiş:** Bugünkü geçmişte `kollar/`, makine adları, iç ağ adresi ve 12 kayıtta kişisel e-posta var. Geçmişi yeniden yazmak `--force` ister ve `AGENTS.md` bunu yasaklar. Yeni depo, geçmişi bozmadan aynı sonucu verir.

## 6. Kapı tablosu (24 Ekim 2026)

| Madde | Durum | Kim |
|-------|-------|-----|
| Ev Makinesi v0 üç evde (§3) | Kod: `kol/acilis-imaj`, `kol/acilis-kurulum`. Kurulum: yok | Mac (kod), Kerem (evler) |
| `LICENSE` dosyaları, SPDX başlıkları | `LICENSE`, `LICENSES/`, dizin lisansları `kol/acilis-belge`'de. SPDX: açık dallar birleşince tek kayıtta | Mac |
| İngilizce `README.md` | `kol/acilis-belge` | Mac |
| `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `TRADEMARKS.md`, `GOVERNANCE.md` | `kol/acilis-belge` | Mac |
| Kurucu belgenin İngilizcesi | `docs/en/FOUNDING-DOCUMENT.md`, `kol/acilis-belge` | Mac |
| Tehdit modeli (kayıt, görev, kasa) | `docs/audit/tehdit-modeli.md` var | — |
| Temizlik ve gizli bilgi taraması | §5; açılış günü | Mac |
| Alan adları, marka başvurusu, adresler | yok | Kerem |
| Patent kararı (§20.1) | yok | Kerem |
| Görev imajlarının kaynak arşivleri | `images/source-archive.sh`, `kol/acilis-imaj`; yayın açılış günü | Mac |
| CI (§3) | `.github/workflows/check.yml`, `kol/acilis-belge`; imzalı bildirim: Kerem | Mac, Kerem |

## 7. Güvenlik ve risk değerlendirmesi

- **Denetimsiz kod herkese açılır.** README ve SECURITY "alfa öncesi, denetlenmedi, gerçek veri için kullanmayın" der; kasa paketi denetimden önce yayına girmez (paket açıklaması). Açık kod denetimi hızlandırır, ama ilk bulguların herkesin önünde gelmesi beklenmelidir.
- **Patent.** Açılış, patent adaylarının yayımlanmasıdır (§20.1). Avrupa Patent Ofisi'nde yayından sonra başvuru yapılamaz. Bu yüzden patent kararı kapıda kalır ve açılıştan önce §22'ye yazılır.
- **Marka.** Başvuru yapılmadan ad herkese görünür olursa başkası başvurabilir. Başvuru kapıdadır; tescil beklenmez.
- **Kişisel bilgi.** Temiz geçmiş (§5) ve tarama birlikte yapılır; yalnız biri yetmez.

## 8. Kurucu belgede değişecekler

- §20 tablosu: Faz 4 satırındaki "Depo herkese açılır (§20.2)" çıkar; Faz 1 satırına "Kapı tamamlanınca depo herkese açılır (RFC-0033, hedef 2–3 Kasım 2026)" eklenir. Faz 4'ün çıkış ölçütü "§20.2 kapısı geçildi" yerine "Mekan Kutusu ve Yuva Kutusu Havenfold'da" olur.
- §20.2: §3 tablosundaki netleşmeler maddelerin altına yazılır.
- §18.2: `README.md` ve `README.tr.md` var; `installer/` ve `images/` "açılış işleri" olarak işaretlenir; açık deponun yeni geçmişle başlayacağı (§5) yazılır.
- §22.1: "RFC-0033: açılış kapıya bağlı, hedef 2–3 Kasım 2026; açık depo yeni geçmişle; açılış işleri için Mac'e kod istisnası" satırı.

## 9. Açılış işlerinde çıkan ekler

Açılış dallarında onaylı RFC'lerin yazmadığı ya da kodla çeliştiği yerler çıktı. Mac karar verdi, kod buna göre yazıldı. Bu RFC onaylanınca aşağıdakiler ilgili RFC'lere işlenir. **Yeni numara, zarf türü ya da olay türü yok.**

| # | Ek | Etkilenen | Dal |
|---|----|-----------|-----|
| a | **Cihaz oturumu:** taşıyıcı `cihazlar: true` ile işçiyle de oturum açar. İşçi dinler, telefon arar (kutunun §7 j kuralı gibi); HELLO'da `cihaz` rolü kabul edilir; §4 d'deki "aktif üye" koşulu cihaza genişler. Telefonda defterde aktif cihaz varsa açık, düğümde bayrakla. | RFC-0028 §7 | `kol/acilis-imaj` |
| b | **Taşıyıcı çerçeve sınırı:** gövde en çok 1 MiB; aşan çerçeve oturumu kapatır, `FRAME_TOO_LARGE`. Tören soketinde aynı sınır. `LEDGER_EVENTS` 1 MiB'ı aşan defter için parçalanmalı (Dell). | RFC-0028 §6 | `kol/acilis-guvenlik` |
| c | **Çekirdekler Node'da:** kutu, işçi ve silme ortamı Bare desteği gelene kadar (İstek 151) Node'da çalışır. Gerçek kutu (D76) zaten Node'da. | RFC-0007 §4, §13.2 | `kol/acilis-imaj`, `kol/acilis-kurulum` |
| d | **Denetçi yönetim soketi:** `/run/havenfold/denetci-yonetim/yonetim.sock`. RFC-0026 f `denetci/` dizinini çekirdeklere verdiği için yönetim grubu oraya giremez. | RFC-0007 §5, §6.1 | `kol/acilis-imaj` |
| e | **`SAGLIK_ANLIK` içindeki `caps`:** yerel IPC'de JSON. | RFC-0007 §6.3 | `kol/acilis-imaj` |
| f | **Podman soketi:** `/run/havenfold/podman/podman.sock`, `havenfold-podman` grubu (yalnız görev kullanıcısı ve denetçi; işçi konteyner başlatamaz). | RFC-0007 §4, §5 | `kol/acilis-imaj` |
| g | **Düğüm paketi `.zip`:** yetki yardımcısı ve `node.json` vektörleri kanonik ZIP kullanıyor; §8.1'deki `.tar.zst` koda uyarlanır. | RFC-0007 §8.1 | `kol/acilis-kurulum` |
| h | **ISO özeti:** ISO kendi sürüm bildirimini taşıdığı için kendi özeti o bildirime giremez. Yayında ayrı `SHA256SUMS` olur, sürüm kök anahtarıyla ayrıca imzalanır (`SHA256SUMS.sig`, Kerem çevrimdışı). | RFC-0007 §8.1, §12.1 | `kol/acilis-kurulum` |
| i | **Silme ortamında QR:** çerçeve arabelleğinde piksel QR yerine metin konsolunda 128 baytlık parçalar. | RFC-0007 §13.5 | `kol/acilis-kurulum` |
| j | **Biletsiz silme raporu:** `verifyWipe(..., { biletsiz: true })` yalnız §13.5'teki sıfır alanlarla kimliksiz oturumu kabul eder, sonuçta `biletsiz: true` döner; telefon §13.2 adım 4'teki soruyu sorar. Seçenek verilmezse davranış aynı. | RFC-0007 §13.2, §13.5 | `kol/acilis-kurulum` |
| k | **`havenfold ilk-ayar`:** `--kurulum` yalnız `host.id` üretir; `--rol` rolün kimliğini kutu çekirdeğinin kalıcı katmanıyla yazar, anahtarlar TPM'ye mühürlü; işaret dosyası `<rol dizini>/kimlik` sır taşımaz. | RFC-0007 §8.3, §9 | `kol/acilis-kurulum` |
| l | **SO_PEERCRED:** yerel eklenti yazılmaz. Yerel soketlerde yetki dosya izni ve grup üyeliğiyle verilir; birleşik düğümde `PEERCRED_YOK` ile açılmama kuralı sürer. İstek 107 kapanır. | RFC-0007 §6 | `kol/acilis-guvenlik` |
| m | **`hf.task.backup` imajı yok:** RFC-0002 §11.2'ye göre yerleşik iştir; `images/task-backup/` yalnız sözleşmeyi taşır. | kurucu §8.7, §17.1 | `kol/acilis-imaj` |
| n | **Cihaz töreni ağ üstünde:** kind 2 QR'ı düğüm gösterir, aile tarafı okutur (kutu akışı gibi). Taslak `DEVICE_ATTACH`; imzacılar yeni cihaz ve ebeveyn, yeni cihazın imzası `JOIN_SIG` ile gelir; `JOIN_LEDGER`'da yeni gelenin aktif cihaz olması aranır. Tören anahtarı ebeveyn ↔ cihaz çiftinin sırrına girer. Törende `class` taşınmaz (düğümün cihaz töreni `isci`), `caps` boştur (ilk `NODE_CAPS` törenden sonra gelir), `placeId` 0, `name` JOIN_HELLO'daki ad. SDK, yeni cihazın imzası eksik `DEVICE_ATTACH`'ı reddetmez, öneri sayar. | RFC-0003 §5.1, §6.2; RFC-0028 §5 | `kol/acilis-imaj` |
| o | **Üye ↔ cihaz oturumunda eşitleme:** yalnız defter (LEDGER_REQ / LEDGER_EVENTS); kayıt özeti, LEDGER_PROPOSE ve kayıt dosyası isteği cihaza gitmez. Telefon işçinin `BLOB_REQ`'ini dosya deposundan cevaplar. İşçi yalnız üyelerle oturum kurar. | RFC-0003 §6.1; RFC-0028 §4 d | `kol/acilis-imaj` |
| p | **`NODE_CAPS.seq`** yeniden başlamada geri gitmez: `max(önceki + 1, şimdiki ms)`. `SAGLIK_ANLIK` `MERHABA`'dan sonra bir kez gelir; değişen alanları işçi kendi ölçer. | RFC-0002 §8.3; RFC-0007 §6.3 | `kol/acilis-imaj` |
| q | **Görev sözleşmesi:** `params` UTF-8 JSON; konteynerde `/in/params`, `/in/girdiler.json`, `/in/<i>`, `/out/`; çıkış kodları 0/2/3/4/5/10 (`images/*/CONTRACT.md`). | RFC-0002 §5, §12 | `kol/acilis-imaj` |
| r | **Sonuç teslimi:** tek ve 32 KB'tan küçük çıktı satır içinde; birden çok dosyada her dosya yeni anahtarla şifreli ayrı `BLOB_DATA`; MIME türü uzantıdan. İsteyen çevrimdışıysa sonuç işçide bekler (emanet sonra). | RFC-0002 §9 | `kol/acilis-imaj` |
| s | **Görev kanal komutları (numara önerisi, onaydan sonra kodlanır):** 250 `TASK_REQUEST` (run), 251 `TASK_CANCEL` (cancel), 252 `MACHINE` (machine), 253 `DEVICES` (devices), 254 `TASK_CONSENT` (var), 255 `STANDING_START` (startStanding); ilerleme ve sonuç RFC-0024 olay çerçevesiyle `gorev` olayı olarak; 256–259 boş. Aralık RFC-0002 §14'te zaten görevin. | RFC-0002 §14; RFC-0024 | Onaylandı (24 Ekim 2026); kodda ve `protocol/vectors/channel-task.json`'ta |

## 10. Alternatifler

| Seçenek | Neden seçilmedi |
|---------|-----------------|
| Haziran 2027'yi beklemek | Kapının kod işleri gün ölçeğinde; yedi ay beklemenin teknik sebebi yok. |
| Kapısız "önizleme" olarak hemen açmak | Patent ve marka kararı verilmeden yayın geri alınamaz; ilk gelenler kurulamayan bir düğümle karşılaşır. |
| 14 gün saha şartını kapıda tutmak | Açılışı en az iki hafta kaydırır; kodun doğruluğunu değil süreklilik ölçer. Faz 1 ölçütü olarak kalır, açılıştan sonra da ölçülür. |
| Geçmişi yeniden yazıp aynı depoyu açmak | `--force` ister (yasak); PR'lar ve bağlantılar bozulur. |

## 11. Geri dönüş yolu

- Açılıştan önce her şey geri alınabilir: dallar birleşmeden atılır, tarih değiştirilir.
- Açılıştan sonra geri alınamaz: kopyalar (fork) ve arşivler kalır. Bu yüzden §5'in 1. adımı (kapı tablosu tam) atlanmaz.
