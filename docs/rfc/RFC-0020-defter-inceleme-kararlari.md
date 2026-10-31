# RFC-0020 — Defter incelemesinden kararlar: olay kipi, bekleyen ana kimlik, misafir halefi

> Durum: **Onaylandı** (Kerem, 23 Ekim 2026) · 23 Ekim 2026 · Yazan: Havenfold çekirdek ekibi · Onay: Kerem
> Kaynak: dell'in D9 defter düzeltmeleri (`f71cddb`) üstüne Mac'in üçüncü incelemesi (`kollar/D-inceleme-3.md`) ve dell'in durum dosyasındaki 69–74. istekler.
> Kurucu belge: §6, §7, §22. Etkilenen RFC'ler: 0001, 0003, 0017, 0019.

## 1. Sorun

D9 defter düzeltmeleri testlerden geçti, ama inceleme beş açık buldu. Bunları kodla kapatmak yetmiyor, protokol kararı gerekiyor:

- Aynı olay, farklı imza kümesiyle farklı replikalarda farklı etki yapıyor. Aile kalıcı olarak bölünebiliyor.
- Bekleyen ek kimlik devri (`APP_PRIMARY`), ana kimlik bu arada el değiştirse bile etkinleşiyor. Çalınmış bir tablet, sahibin yeni telefonunu düşürebiliyor.
- RFC-0019 §8.11 ile Mac'in ilk incelemesi (D-inceleme-1, RFC-0017 bulgu 7) çelişiyor.
- Misafir, başka bir ebeveynin tek başına verdiği "halef" kanıtına inanıyor. Meşru telefon değişimlerinde ise halefi tanıyamıyor.
- Ebeveynlikten indirilen kişinin verdiği misafirlik açık kalıyor.

## 2. Kararlar

| # | Karar | Neden |
|---|-------|-------|
| a | **Olayın kipi gövdededir.** Bir olayın bekleyen mi hemen geçerli mi olacağını belirleyen her imza koşulu gövdede bayrak olarak yazılır ve olay özetine girer. `ROTATE_DEVICE`'a `oldSigned: bool` eklenir. `APP_PRIMARY`'de `oldSigned` vardır, buna `parentSigned: bool` eklenir. Bayrak doğruysa ilgili imza zorunludur; yanlışsa o imza olayda bulunamaz (`MODE_MISMATCH`). İmza birleştirme bir olayın kipini değiştiremez. Genel kural: olayın etkisi yalnız gövdeden ve imzacıların rolünden çıkar. | Olay özeti imzaları kapsamıyor. Hırsız, bekleyen bir değişime eski kimliğin imzasını ekleyip bazı replikalara yayınca baş aynı, durum farklı kalıyordu. Veto bir yarıda geçerli, öbür yarıda geçersizdi. |
| b | **Bekleyen ana kimlik devri, yazıldığı ana kimliğe bağlıdır.** `APP_PRIMARY` gövdesine `against: fixed16` eklenir: olay yazıldığı anda kişinin ana kimliği. `ACTIVATE_MEMBER` anında `against` hâlâ kişinin ana kimliği değilse ret (`CHANGE_DROPPED`). Kişinin ana kimliğine ait her `ROTATE_DEVICE`, bekleyenler dahil, kişinin bekleyen `APP_PRIMARY`'lerini düşürür; bu, veto sayılır. Bekleyen bir `APP_PRIMARY`, `ROTATE_DEVICE`'ı engellemez. | Çalınan tabletin bekleyen devri, sahip yeni telefona geçtikten sonra da etkinleşiyor ve yeni telefonu düşürüyordu. Tek ebeveynli ailede veto edecek kimse yoktu. |
| c | **RFC-0019 §8.11 geçerlidir:** çatallanmada `ACTIVATE_MEMBER` güçlü olay sayılmaz. D-inceleme-1'in RFC-0017 bulgu 7'si geri çekilir ve kodda geri alınır. | Tek imzalı bir ACTIVATE, iki ebeveyn imzalı eşzamanlı dalı yeniyordu. Çelişki Mac'in incelemesindeydi. |
| d | **Misafir halefi yalnız güçlü kanıtla tanır.** RFC-0019 §5.3'teki `successorOf` yerine `GUEST_VIEW`'e `successorProof: array` gelir; en çok 4 adım. Her adım şunlardan biridir: (i) eski imzacının imzasını taşıyan `ROTATE_DEVICE` ya da `APP_PRIMARY` olayı (`oldSigned`), ya da (ii) kutu tanıklı değişimde olayın kutu tanık imzası (RFC-0003). Misafir zinciri önceki görünümün imzacısından başlayıp sırayla doğrular. Başka bir ebeveynin imzası tek başına kanıt değildir. Kanıt yoksa (eski telefon kayıp, tanık yok) misafir yeniden davet edilir; misafirin ekranı "davetin yenilenmesi gerekiyor" der. | Hüsniye, defterin reddedeceği bir değişimle Kerem'in misafirini ele geçirebiliyordu. Ek kimlik devri ve kutu tanıklı değişimde ise meşru halef tanınmıyordu. |
| e | **Ebeveynlikten indirilenin misafirlikleri düşer.** `SET_ROLE` bir kişiyi ebeveynlikten çıkarınca, `grantedBy`'ı o kişi olan bütün misafirlikler düşer. `GUEST_REVOKED`, `SET_ROLE` olayını da taşıyabilir. | Misafirlik defterde açık kalıyor ve misafir koleksiyonu okumayı sürdürüyordu, ama kimse görünüm imzalayamıyordu. Eski ebeveyn, defterin eski kopyasından görünüm verebiliyordu. |
| f | **Kova özeti imzayı kapsar.** `REC_BUCKETS` kova özeti `opId` yerine `hash(opId ‖ sig)` üstünden hesaplanır. | Kutuda yalnız bozuk kopya, telefonda gerçeği varken kovalar eşit görünüyordu. Gerçek kopya ancak doğrudan yüklemeyle gidiyordu (dell 71). |

## 3. Kabul edilen uygulama ayrıntıları (dell 69–74)

| # | Ayrıntı |
|---|---------|
| 69 | Olay kataloğu `protocol/event-types.json`'dadır. Paketler yayımlanırken katalog pakete kopyalanır (yayın betiği). |
| 70 | Katalogdaki yazar sınıfı yalnız `hf.` türlerine uygulanır: `uye`, işlemin `ledgerSeq` anında üye (cihaz değil); `cihaz`, cihaz; `ikisi`, ikisi de. `hf.saklama` ayrıca yalnız ebeveyndir. Tür işleminin yazarı sınıfa uymuyorsa kaydın türü yok sayılır. Misafir, rol geçmişini bilmediği için görünümdeki rolü kullanır. |
| 71 | Kutu, bir gönderenden bir `opId` için tek kopya tutar; yenisi eskisinin yerine geçer. 4 kopya dolunca `COPY_LIMIT`. |
| 72 | Kalıcı olmayan kutu mezarında "yazarı yeniden yüklerse" denetimi, imzanın oturumdaki gönderenin anahtarıyla doğrulanmasıdır. Budama kaydı `{ by, at, istenen, silinen }` biçimindedir ve yalnız ebeveyne gösterilir. |
| 73 | Yeni kodlar: `DUPLICATE`, `COPY_LIMIT`, `UNKNOWN_AUTHOR` (mezarsız), `VERSION_UNSUPPORTED` (bekler). Misafir replikası hiçbir reddi mezara koymaz. |
| 74 | `BLOB_DEL` alan sırası: `{ blobIds, at, by, sig }`. SDK artan `at` verir; aynı milisaniyedeki ikinci silme yok sayılır. |

## 4. Hata kodları

| RFC | Kodlar |
|-----|--------|
| 0001 | `DUPLICATE`, `COPY_LIMIT`, `UNKNOWN_AUTHOR`, `VERSION_UNSUPPORTED` |
| 0003 / 0017 | `MODE_MISMATCH`, `CHANGE_DROPPED` |

## 5. Koda yansıyan düzeltmeler

§2'nin bütün maddeleri dell'in kodunda değişiklik ister. Biçim değişen yerler `ROTATE_DEVICE`, `APP_PRIMARY`, `GUEST_VIEW` ve `REC_BUCKETS`'tir; `-v2` vektörleri bunlarla bir kez yeniden üretilir. Görevi `kollar/D-cekirdek.md` D9'dadır; bulgular `kollar/D-inceleme-3.md`'dedir.

## 6. Kurucu belgede değişecekler

| Bölüm | Değişiklik |
|-------|------------|
| §22 | HF52: "Bir olayın etkisi yalnız gövdesinden ve imzacılarının rolünden çıkar; kipi belirleyen imza gövdede bayrakla yazılır (RFC-0020)." |
