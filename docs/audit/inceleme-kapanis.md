# İç incelemeler 12–18: kapanış tablosu

> Kaynak: iç inceleme notları 12–18 (bulgular) ve çekirdek durum kaydının "Biten" satırları (D29, D36, D38, D44, D49,
> D54); ikisi de kapalı çalışma arşivindedir. Eşleme görev satırındaki açık ifadeyle yapıldı; satırda adı geçmeyen eşleme
> "doğrulanmadı" diye işaretli. Test dosyalarının varlığı denetlendi (hepsi depoda). Durum: **kapandı** (Biten satırı
> açıkça söylüyor), **kısmen**, **İstek'e** (durum dosyasındaki istek numarası), **doğrulanmadı**.

## İnceleme 12: telefondaki çekirdek paketi (PR #4)

Kapanış görevi D29; saldırı testleri `worklet/test/attack.js` (S1–S12 tersine çevrildi, +15).

| Bulgu | Şiddet | Kapanış (D29 satırı) | Durum |
|-------|--------|----------------------|-------|
| 1 Platform anahtarı isteğe bağlı | YÜKSEK | (a) `NO_KEY`, açık kip yalnız `testKipi`; göç. Sonra inceleme 13 bulgu 1 ile genişletildi (D36) | kapandı |
| 2 Düz kipte durum doğrulanmadan yükleniyor | YÜKSEK→ORTA | "Bulgu 2": mezardaki, reddedilen işlem ve doğrulanmayan anahtar `STATE_CORRUPT` | kapandı |
| 3 Kasa anahtarları `durum`'da | YÜKSEK | (b) `arsiv`, `crypto_box_seal`, 224/19 | kapandı |
| 4 Silinen/eski dosya sessizce açılıyor | ORTA | (c) kimlik özeti, `sayac`, `STATE_ROLLED_BACK` | kapandı |
| 5 İki kez başlatma, aynı dizin | ORTA | (f) `ALREADY_STARTED`, `DIR_LOCKED` | kapandı |
| 6 IPC önek kayması | ORTA | (d) `INVALID_FRAME`, akış kapanır | kapandı |
| 7 Fırlatan komutta `id: null` | DÜŞÜK-ORTA | (d) `{ id, hata }` | kapandı |
| 8 1 MiB üstü geri çağrı sessiz | DÜŞÜK-ORTA | (d) ilgili komut reddedilir | kapandı |
| 9 Açılan dosyalar geçicide düz | ORTA | (e) başlatma, kapanış, LOCK ve en geç 10 dk | kapandı |
| 10 `check.sh` Node sürümü | DÜŞÜK | "Bulgu 10" Node ≥ 22 denetimi | kapandı |
| Ş `__proto__` | — | "prototip anahtarları reddedilir" | kapandı |
| Ş `writeSync` 0 | — | `WRITE_STOPPED` | kapandı |
| Ş `dosyaOku` her yolu okuyor | — | "çekirdeğin dizinindeki dosya kayda eklenemez" | kapandı |
| Ş IPC dışı değişiklik | — | "1 sn sonra yazılır" | kapandı |
| Ş `STATE_VERSION` göç iskeleti | — | "durum göç iskeleti (sürüm 1 → 2)" | kapandı |

## İnceleme 13: çekirdek PR #5

Kapanış görevi D36; testler `worklet/test/attack-pr5.js` (B1a–B11), `worklet/test/clean-pr5.js`, ayrıca
`sdk/test/d36.js`, `worklet/test/d36.js`, `worklet/test/vault.js`. İnceleme 14 doğrulaması aşağıda.

| Bulgu | Şiddet | Kapanış | Durum |
|-------|--------|---------|-------|
| 1 Şifreli dizinde açık kip dosyası | YÜKSEK | D36 (1): göç kuralları, `sifreli: true`, telefon paketinde `#mode`. İnceleme 14: test boşluğu → Y1 testi ve bayrağın okunması D38 | kapandı |
| 2 Kasa REC_KEY `durum`'da ve bellekte | YÜKSEK | D36 (2) | kapandı |
| 3 Kilitliyken ACK öbür payları siliyor | YÜKSEK | D36 (3) `silinecek:`; yan etkisi Y2 → D38 | kapandı |
| 4 Yeniden kurulum `arsiv`'e yazılmıyor | YÜKSEK | D36 (4) öğe kimliği içerik özeti | kapandı |
| 5 Sahte ACK, yanlış tutucu | ORTA | D36 (5) `ayniKimlik` | kapandı |
| 6 Kilitliyken tutucu kuralları atlanıyor | ORTA | D36 (6) `PayTutucu.dizin` | kapandı |
| 7 `arsiv` geri alma koruması dışında | ORTA | D36 (7) sayaç; inceleme 14 "kısmen" → Y4 D38 (`arsivOzetleri`) | kapandı (D38 ile) |
| 8 Kilitliyken kasa dosyası açılıyor | ORTA | D36 (8) `kasaDosyalari`; inceleme 14 "kısmen" → Y5 D38 | kapandı (D38 ile) |
| 9 Çocuğun YA'sı ebeveynden | DÜŞÜK-ORTA | D36 (9) `UNAUTHORIZED` | kapandı |
| 10 Kişisel mod `_ai` | DÜŞÜK-ORTA | D36 (10) | kapandı |
| 11 Kişisel mod taşıma atomik değil | DÜŞÜK | D36 (11) | kapandı |
| Ş D31 uçtan uca, ACK diske yazılmadan | — | D36 "alındı pay diske yazılmadan gitmez" | kapandı |
| Ş Kutu tarafında pay tutma | — | D39 (`node/box-share.js`, `node/test/d39.js`); gerçek TPM o gün yok → İstek 127; sonradan D76 (`node/tpm.js` `sistemTpm`, `node/test/d76-tpm.js`; `sinirlar-ve-kapsam-disi.md` madde 2) | kapandı (D76 ile) |
| Ş `teslimAl` tampon kopyası | — | D36 | kapandı |
| Ş `arsivAc` yarıda; arşiv anahtarı göçü | — | D36 "kilit açılışı bölünmez"; göç D40 (389) | kapandı |
| Ş Bağlanınca son sayaç | — | D36 | kapandı |
| Ş Tören yarışı | — | D36 `CEREMONY_IN_PROGRESS` | kapandı |
| Ş Kap gizli alan kancası | — | D36 `NO_EXPORT_SECRET_HOOK` | kapandı |
| Ş 387 `sirHex` | — | D36 `{ $b }` kabul; dizgi yolu duruyor | kısmen |
| Belge: RFC-0017 aralığı, `vector-check.js` | — | D36 "Belge" (aralık testi, `check.sh`) | kapandı |

## İnceleme 14: PR #5 düzeltmelerinin doğrulaması

Kapanış görevi D38; testler `worklet/test/attack-pr5-y.js` (Y1–Y6), `worklet/test/d38.js`.

| Bulgu | Şiddet | Kapanış | Durum |
|-------|--------|---------|-------|
| Y1 B1b test boşluğu | — | Y1 testi eklendi; `sifreli: true` okunuyor | kapandı |
| Y2 `silinecek:` sürümsüz | ORTA | `{ version, kimler }` | kapandı |
| Y3 | — | yeşil kalması gereken | kapandı (yeşil) |
| Y4 Arsiv başlığı yalnız sayaç | DÜŞÜK | İki aşamalı yazım, `arsivOzetleri`, LOCK hemen yazar | kapandı |
| Y5 Kilitliyken kasa dosyası dizine girmiyor | ORTA | Kilit açılınca dizine, uygulamaya değişiklik | kapandı |
| Y6 | — | yeşil kalması gereken | kapandı (yeşil) |
| Ş `anahtarEkle` kısmi uygulama | — | Arsivdeki anahtar girdileri önce doğrulanır | kapandı |

## İnceleme 15: D39–D41

Kapanış görevi D44; testler `node/test/review-15.js`, `worklet/test/review-15-d40.js`,
`worklet/test/review-15-d41.js`, `sdk/test/d44.js`. Bulgu → test dosyası eşlemesi dosya adından yapıldı (D39 →
`node/`, D40 → `-d40`, D41 → `-d41`); içerik tek tek eşlenmedi.

| Bulgu | Şiddet | Kapanış | Durum |
|-------|--------|---------|-------|
| B1 389 hata döndürüyor ama taşıma işlenmiş | ORTA | `ARCHIVE_MOVED_STATE_WRITE_FAILED`; RFC notu İstek 130 | kapandı (RFC notu İstek'e) |
| B2 Kasa REC_KEY `bekleyen`'de düz | ORTA | Çıkışa geri konur, kilitlemede sıfırlanır | kapandı |
| B3 Yeni açık anahtar yalnız biçimce | DÜŞÜK-ORTA | Deneme mühürlemesi, `INVALID_KEY` (`Kalici.arsivTasi`) | kapandı |
| B4 Mühürleme düşünce eski pay | DÜŞÜK | `PayTutucu` erteleme kipi | kapandı |
| B5 Hata sonrası yarım çıktı | DÜŞÜK-ORTA | `oncesi` denetimi, `eksikDosya`, `iptal()` | kapandı |
| B6 Aynı boyda farklı veri | DÜŞÜK | Yazım geçişinde CRC (`INVALID_ZIP`) | kapandı |
| Ş Taklit TPM tanıma | — | WeakSet, `tpmGercekMi`/`taklitMi` (`node/tpm.js`) | kapandı |
| Ş `yaz` Promise geri basınç | — | Beklenir; ölçüm `scripts/measure-phone.js` | kapandı |
| Ş `KapYazici.state` | — | `iptal()` sıfırlar | kapandı |
| Ş Yükseltilen dizinde `arsivDonemleri` | — | İlk açılışa kadar üretim yok; `otomatikAnahtar: false` (`worklet/test/d40.js` +1) | kapandı |

## İnceleme 16: D45 ekip SDK yüzeyi

Kapanış görevi D49; testler `sdk/test/review-16.js`, `sdk/test/review-16-clean.js`, `sdk/test/d49.js`.

| Bulgu | Şiddet | Kapanış | Durum |
|-------|--------|---------|-------|
| K1 Geçici bekleyen öneriyi düşürür | ORTA | `SIG_ERRORS`, `_valid` | kapandı |
| K2 Alan dışı yönetici | DÜŞÜK-ORTA | İmza atılır, `waitingFor` | kapandı |
| K3 TERM 90 gün yalnız SDK'da | ORTA | Çekirdekte `TERM_LIMIT`; RFC metni İstek 134 a | kapandı (RFC metni İstek'e) |
| K4 Aynı LEAVE ikinci makbuz | DÜŞÜK | Sıfır özetli makbuz | kapandı |
| K5 Silmesiz makbuz | DÜŞÜK | Makbuz yok | kapandı |
| K6 Bırakma gizlisi kimsede yok | ORTA | `crypto_box_keypair` (`sdk/team.js` `birakmaCifti`), `addDropSecret` | kapandı |
| K7 Silmede öneriler kalıyor | DÜŞÜK | Silinir, `job-scope` olayı | kapandı |
| K8 Var olan `placeId` | DÜŞÜK | `PLACE_ALREADY_EXISTS` (karardaki ad `YER_VAR`; testin adı alındı) | kapandı (ad farkı) |
| Ş `NEEDS_MORE` ailede değişmiş | — | Ailede eski hâl; ekip kodları yalnız `KIND ekip` | kapandı |
| Ş Süresi dolan öneri yeniden | — | Ömür olayın imzalı zamanından | kapandı |
| Ş `receiveExit` TAM makbuz, geçici süre, `waitingFor`, `exitStatus`, `leave` sırası, `NO_DISCLOSURE`/`PERSON_EVENT` | — | D49 satırında her biri anılıyor | kapandı |

## İnceleme 17: D46 kişisel köprü

Kapanış görevi D49; testler `sdk/test/review-17.js`, `sdk/test/review-17-clean.js`, `worklet/test/bridge.js`;
vektör `protocol/vectors/bridge.json` yeniden üretildi.

| Bulgu | Şiddet | Kapanış (`core/core/protocol/bridge.js`, `sdk/bridge.js`) | Durum |
|-------|--------|-------------------------|-------|
| B1 7 gün sonra yeniden kabul | ORTA | `BRIDGE_STALE`; vektör beklentisi ret | kapandı |
| B2 `at` tazelik yok | ORTA | Geçmiş 7 gün, ileri 5 dk (`BRIDGE_AHEAD`) | kapandı |
| B3 Nonce defteri sınırsız | ORTA | En çok 1000 (`NONCE_MAX`), nonce başına anahtar | kapandı |
| B4 `__proto__` yön | DÜŞÜK | `yonVar` | kapandı |
| B5 Görünmez ve bidi karakterler | DÜŞÜK | `GORUNMEZ`, `BIDI` → `BRIDGE_TEXT` | kapandı |
| B6 Sürüm ileriye uyumsuz | DÜŞÜK | Önce `v` (`BRIDGE_VERSION`) | kapandı |
| Test kalitesi (`worklet/test/bridge.js`) | — | Yön klasörleri, gerçek pakette tür denetimi | kapandı |
| Ş1 Kaynak doğrulaması yok | — | `receive(metin, { kaynak })` → `BRIDGE_SOURCE`; kaynak verilmezse denetlenmez | kısmen (kaynağı platform verir) |
| Ş1b Bağlantıyla taşıma | — | D49 satırında anılmıyor | doğrulanmadı |
| Ş2 Çok süreçte nonce kaybı | — | Nonce başına anahtar | kapandı |
| Ş3 Ayrılınca köprü | — | `close()`, `TeamApi({ kopru })` | kapandı |

## İnceleme 18: D52 anlamsal arama ve D50 bulanık test kapsamı

Kapanış görevi D54; testler `sdk/test/review-18.js`, `worklet/test/review-18.js`.

| Bulgu | Şiddet | Kapanış | Durum |
|-------|--------|---------|-------|
| B1 Çıkarılan okuyucunun gömme dosyası | ORTA-YÜKSEK | Dizin bekçiden önce; açılış süpürmesi (`gommeSaklama().liste()`) | kapandı |
| B2 Kasaya çevrilen koleksiyonun vektörleri | ORTA | Duyarlılık değişince silinip yeniden dizinlenir | kapandı |
| B3 LOCK'ta bellekten silme yok | ORTA | `vault` olayına abonelik, aramadan sonra yeniden süzme | kapandı |
| B4 Kanca hatası aramayı düşürüyor | ORTA | Anahtar kelimeyle dönüş, `anlamsalHata` | kapandı |
| W1/W2 Bozuk dizin dosyası `KALICI_*` | ORTA | Silinir ve yeniden gömülür | kapandı |
| B5a/B5b/B5c Sınır dışı parçalar | ORTA/DÜŞÜK-ORTA | Sınır gömmeden önce, yalnız kalıcı parçalar | kapandı |
| B6 Anahtarsız saklama, tuzsuz özet | DÜŞÜK | Anahtarlı özet `derive(dosya anahtarı, 'hf/yz/ozet')` (biçim: `kripto-envanteri.md` §5 madde 3) | kapandı |
| B7 Model silinince dosyalar | DÜŞÜK-ORTA | Kanca yokken silinir | kapandı |
| W3 `gomme/` geçici kopyaları | DÜŞÜK | `Depo.temizle` `gomme/` dahil | kapandı |
| RFC sapması: dizin anahtarı | — | `derive(dönem anahtarı, 'hf/yz/dizin', platform anahtarı)`; RFC metni İstek 140 b | kapandı (RFC metni İstek'e) |
| Ş Parça kimliği koleksiyonsuz | — | `cid|rid#i` | kapandı |
| Ş `lastPut`'suz kayıtlar hlc 0 | — | D54 satırında anılmıyor | doğrulanmadı |
| Ş Gömme dosyaları durum sayacına bağlı değil | — | İstek 139 d (karar bekliyor) | İstek'e (139) |
| D50 kapsamı | — | `giris.cozucu`, `zarf` gerçek çözücüler, yeni hedefler `cozuculer`, `tasiyici`, `gomme-dosya`, `kutu-pay` (D62'den beri Bare'de de), `node-ipc` | kapandı |
| D50 kapsamı: `ceremony.js` durum makinesi, `records/encoding.js` | — | `ceremony.js` için yalnız `qrCoz` hedefte; `al` akışı hedef değil. `encoding.js` `cozuculer` içinde ("kayıt iç biçimi") | kısmen |
