# RFC-0029 — Yuva Acil, Yuva Pati ve Yuva Bakım ayrı uygulamalardır

> Durum: **Onaylandı** (Kerem, 24 Ekim 2026), kurucu belge 1.14 · 24 Ekim 2026 · Yazan: Havenfold çekirdek ekibi · Onay: Kerem
> Karar kaynağı: Kerem, 24 Ekim 2026 — "Ayrı olması gerekli. Zaten Yuva Hat'la Yuva Defteri'ni ayırdık." Sıra: Acil, Pati, Bakım.
> Kurucu belge: §2, §14.1, §15.1, §15.3, §20, §21, §22. Etkilenen RFC'ler: 0006 (§6.1 notu), 0008 (§2, §11.1, kod yeri), 0012 (kod yeri), 0017 (§9). RFC-0018 §3'te açık bırakılan kararın bir kısmını kapatır.
> Protokol değişikliği yoktur. Yeni defter olayı, yeni zarf türü, yeni yetenek biti yoktur.

## 1. Sorun

- Kurucu belge §14.1 "her ürün kendi uygulamasıdır" der. §15.1 ise "Bakım, Pati, Acil, Çocuk modülleri Yuva Hat'ın içinde gelir" der. RFC-0018 §3 bu çelişkiyi açık bıraktı.
- RFC-0008, Android uç modunu Yuva Hat'ın içine koyar. RFC-0012, afet modunun telefon köprülerini Yuva Hat'ın yerel modülüne koyar. RFC-0017 §9, Bakım, Pati ve Acil'in bildirimini "Yuva Hat'ın içinde oldukları için" Yuva Hat'a verir.
- Çekirdekte (`sdk/care.js`) Yuva Defteri'nin Bakım Masası, kaçırılan doz olayına `yuva.bakim.doz-kacirildi` adını verdi. `yuva.bakim` ad alanı kamera ürünü Bakım'ındır (RFC-0006 §5.1). Bildiren uygulama olay türünden seçildiği için (RFC-0017 §9) bu ad, Defter'in hatırlatmasını yanlış uygulamaya bildirtir.
- Bugün Yuva Hat'ta SOS, pati, bakım ve çocuk kodu yoktur; mağaza metninde bunlara söz verilmemiştir. Ayırmak Hat'tan bir şey eksiltmez.

## 2. Karar

Yuva'da üç yeni ayrı mağaza uygulaması açılır. Her biri kendi başına aile kurar ve aileye katılır; aynı telefonda başka Yuva uygulaması varsa aynı kişinin ek kimliği olur (RFC-0017).

| Uygulama | Kapsam | Ad alanı | Depo |
|----------|--------|----------|------|
| **Yuva Acil** | SOS, "İyiyim" ve aile durumu, evde kim var, aile acil planı, buluşma noktası, afet modu ekranları, Yuva Kutusu deprem uyarısı | `yuva.acil` | Ayrı, kapalı ürün deposu |
| **Yuva Pati** | Evcil hayvan profili, günlük, aşı ve ilaç, veteriner, bakıcı erişimi, rutin ve sapma; kamera ve akşam raporu | `yuva.pet` | Ayrı, kapalı ürün deposu |
| **Yuva Bakım** | Yaşlı: kamerasız ritim (eski adıyla Annemin Ritmi), "iyi misin?" sorusu, kamera ile hareketsizlik ve düşme şüphesi. Çocuk: "eve vardı", "okuldan çıktı". | `yuva.bakim`, `yuva.cocuk` | Ayrı, kapalı ürün deposu |

- Katalogdaki **Çocuk** ve **Annemin Ritmi** ayrı ürün değildir; Yuva Bakım'ın bölümleridir.
- **Yuva Kamera** ayrı bir uygulama değildir; uç modunun adıdır (§3).
- Yuva Hat'ta ürün modülü kalmaz. Yuva Hat'ın içinde yalnız mesajlaşma, bas-konuş, arama ve eski Android kutu modu (09 §1.2) vardır.
- Uygulama sırası: **Acil, Pati, Bakım** (§8).

## 3. Uç modu

- Uç modu (RFC-0008 §11) **onu kullanan ürünün uygulamasında** gelir. Ayrı bir "kamera uygulaması" yoktur.

  | Mod | Uygulama |
  |-----|----------|
  | `kamera` | Yuva Pati ve Yuva Bakım |
  | `sensor` | Yuva Bakım |
  | `ekran` | Yuva Hat (aile kartlarını gösterir) |

- Bir uç cihaz **tek ürüne bağlıdır.** Hangi uygulamayla kurulduysa onun uç modunu çalıştırır; görüntüsünü yalnız o ürünün görev imajı işler ("Pati imajı" ya da "Bakım imajı"). Gerekçe: Bakım'ın rıza kuralları (ilke 7) kameranın gördüğü kişiye bağlıdır. Bir kameranın iki ürüne birden hizmet etmesi sonraki bir RFC'nin işidir.
- Uç modunun çekirdek kodu değişmez (`@havenfold/edge`). Ekranları ürün uygulamasındadır.
- Aynı cihazda kutu ve uç birlikte çalışmaz kuralı (RFC-0008 §11.1) aynen geçerlidir. Kutu modu Yuva Hat'ta kalır.

## 4. SOS her Yuva uygulamasında alınır

SOS'u yalnız Yuva Acil'i kuran üyenin görmesi kabul edilemez. Bu yüzden:

1. **Alma ve gösterme her Yuva uygulamasında vardır** (Yuva Hat, Yuva Defteri, Yuva Acil, Yuva Pati, Yuva Bakım). `hf.sos` çekirdek olayıdır (RFC-0006 §6.1); her uygulama onu okur.
2. **Ortak SOS ekranı:** kim, ne zaman, varsa konum; "Ara" (telefonun kendi araması), "Ben bakıyorum" (`hf.vaka.sahip`, RFC-0006 §10.2), "Yuva Acil'de aç" ya da "Yuva Acil'i yükle". Metni ve düzeni her uygulamada aynıdır; Yuva Acil'in tasarım belgesi tanımlar.
3. **Bildiren uygulama:** Cihazda Yuva Acil varsa `hf.sos`'u Yuva Acil bildirir. Yoksa kişinin o cihazdaki ana kimliği bildirir (RFC-0017 §9 geri düşme kuralı). Bir cihazda bir kez bildirilir.
4. **SOS göndermek** Yuva Acil'dedir. Tek istisna Yuva Hat'ın zorlama PIN'idir: "Aileme sessiz alarm gönder" seçiliyse zorlama PIN'i girilince Yuva Hat `hf.sos` yazar. Sessiz SOS'un alanları ve alıcıdaki görünüşü RFC-0031 §5'tedir (onaylı); Yuva Hat anahtarı bir sonraki sürümde açar.
5. **"İyiyim"** ve aile durumu ekranı yalnız Yuva Acil'dedir.
6. **Afet modu köprüleri** (Bluetooth, Wi-Fi Direct, Multipeer; RFC-0012) yalnız Yuva Acil'dedir. Bedeli: Yuva Acil'i kurmamış üye internetsiz kaldığında ulaşılamaz. Yuva Acil'in aile durumu ekranı bunu kişi kişi yazar: "Ayşe'de Yuva Acil yok; internet yokken ona ulaşamayız."
7. SOS ve deprem uyarısı hiçbir zaman parayla kilitlenmez (çatı §11.2).

## 5. Bildirim (RFC-0017 §9'un yeni satırları)

| Bildirim | Bildiren |
|----------|----------|
| `hf.sos` | Yuva Acil; cihazda yoksa ana kimlik (§4.3) |
| `yuva.acil.*` | Yuva Acil |
| `yuva.pet.*` vaka ve merdiveni | Yuva Pati |
| `yuva.bakim.*`, `yuva.cocuk.*` vaka ve merdiveni | Yuva Bakım |
| `yuva.defter.*` (Bakım Masası'nın kaçırılan doz ve randevusu dahil) | Yuva Defteri |

Geri düşme kuralı aynen geçerlidir: bildiren uygulama cihazda yoksa önce ana kimlik, o da yoksa `appId` sırasıyla ilk uygulama bildirir.

## 6. Ad alanları ve Defter'in doz olayı

- `yuva.bakim` ve `yuva.cocuk` yalnız Yuva Bakım'ındır. `yuva.pet` yalnız Yuva Pati'nin, `yuva.acil` yalnız Yuva Acil'indir.
- Yuva Defteri'nin Bakım Masası kendi ad alanını kullanır:

  | Bugün (`sdk/care.js`) | Yeni |
  |------------------------|------|
  | `yuva.bakim.doz-kacirildi` | `yuva.defter.doz-kacirildi` |
  | Kural kaynağı `yuva.bakim` | `yuva.defter` |
  | Test verisindeki `yuva.bakim.ilac` | `yuva.defter.ilac` |

  Bu türler henüz hiçbir ailede yazılmadı; ad değişikliği geçiş gerektirmez. SDK'daki `BakimApi` adı `CareDeskApi` olur; kanal numaraları (355–357) değişmez.
- Yuva Defteri belgelerindeki `yuva.defter.reminder` adı da `yuva.defter.doz-kacirildi` ve `yuva.defter.randevu-yaklasti` olarak netleşir.
- `hf.sos`'un konum, sessiz SOS ve afet alanları Yuva Acil'in kendi RFC'sinde tanımlanır (RFC-0006 §6.1 notu). Bu RFC yalnız SOS'un hangi uygulamada alındığını ve bildirildiğini bağlar.

## 7. Mekan AI Care

- Mekan AI Care'in kodu Yuva Bakım'a **taşınmaz**. Bugünkü kod hesaplı ve bulut tabanlıdır, Havenfold ilkelerine uymaz; düşme ya da hareketsizlik tespit eden kodu yoktur.
- Yuva Bakım sıfırdan, Havenfold üstünde yazılır. Mekan'dan yalnız rıza türleri fikri alınır.
- Kurucu §15.3'teki "`home_care_event_state.py` mantığı Bakım imajına taşınır" cümlesi kalkar.
- Mekan AI Care'in web sitesindeki kanıtsız iddiaların ("düşme tespiti %85+", "KVKK uyumlu") kaldırılması Mekan'ın işidir; bu RFC'nin konusu değildir, ama Yuva Bakım bu iddiaları hiçbir yerde kullanmaz.

## 8. Yol haritası (kurucu §20)

| Faz | Yuva Acil | Yuva Pati | Yuva Bakım |
|-----|-----------|-----------|------------|
| 2 · Aralık 2026–Şubat 2027 | v0: SOS, aile durumu, acil plan, buluşma noktası, evde kim var. Her Yuva uygulamasında SOS ekranı (§4). | — | — |
| 3 · Mart–Mayıs 2027 | v1: afet modu ekranları (çekirdekte RFC-0012 uygulandıktan sonra) | v0–v1: profil, günlük, sağlık, veteriner paketi, bakıcı, rutin | v0–v1: yaşlı ritmi, rıza, çocuk bölgeleri |
| 4 · Haziran 2027 → | Deprem uyarısı (Yuva Kutusu) | v2: kamera ve akşam raporu | v2: kamera, hareketsizlik ve düşme şüphesi |

Kamera sürümleri uç modu, işçide sürekli görev ve Apache lisanslı görüntü modeli hazır olmadan çıkmaz.

## 9. Açık bırakılan

- **Evine Sor, Kuş Penceresi ve Anılar**'ın uygulama yeri sonra kararlaştırılır. RFC-0018 §3'ün bu kısmı açık kalır.
- `hf.sos` alanları: Yuva Acil'in RFC'si.
- Yalnız yaşayan yaşlının Aile Ağı'yla mı (köprü kişi) yoksa çekirdek ailede yetişkin üye olarak mı izleneceği: Yuva Bakım'ın belgesi.
- "Yuva Bakım" ile Defter'deki "Bakım Masası" adlarının karışması: Bakım Masası'nın arayüz adı Yuva Defteri belgesinde yeniden ele alınır.

## 10. Kurucu belgede değişecekler (1.14)

| Bölüm | Değişiklik |
|-------|------------|
| §1 Bugünkü durum | "Yuva Acil, Yuva Pati ve Yuva Bakım da ayrı uygulama olarak açıldı (RFC-0029)." eklenir. |
| §2 şema | `YO` kutusu: "Yuva Acil, Yuva Pati, Yuva Bakım" ve ayrı kutu "Anılar, Evine Sor…". |
| §2 tablo, Ev ürünleri | "Yuva Hat, Yuva Defteri, Yuva Acil, Yuva Pati, Yuva Bakım, Anılar, Yuva Kutusu… Her biri ayrı uygulamadır ve kendi başına kurulur (RFC-0017, RFC-0029)." |
| §2.2 | Ek: "**Yuva Bakım / Bakım Masası:** Yuva Bakım yaşlı ve çocuk bakımı uygulamasıdır. Bakım Masası, Yuva Defteri'nin ilaç ve randevu bölümüdür." |
| §14.1 | Örnek "(ör. Bakım, Pati)" → "(ör. Yuva Hat'ın kutu modu, Yuva Pati'nin uç modu)". Ürün listesine Yuva Acil, Yuva Pati, Yuva Bakım eklenir. |
| §15.1 Modüller | "Yuva Hat'ta ürün modülü yoktur. Bakım, Pati ve Acil ayrı uygulamalardır (RFC-0029). Yuva Hat SOS'u alır ve gösterir (RFC-0029 §4). Eski Android kutu modu ve uç `ekran` modu Yuva Hat'tadır." |
| §15.3 | Tablo uygulama adlarıyla yenilenir: Yuva Acil, Yuva Pati, Yuva Bakım (Çocuk ve Annemin Ritmi dahil). Bakım satırındaki `home_care_event_state.py` cümlesi çıkar, yerine §7. "Yuva Kamera" satırı: "Ayrı uygulama değil; uç modu, onu kullanan ürünün uygulamasında (RFC-0029 §3)." |
| §20 | Faz 2 Ürünler: "Yuva Acil v0; her Yuva uygulamasında SOS ekranı." Faz 3: "Yuva Acil v1 (afet modu), Yuva Pati v0–v1, Yuva Bakım v0–v1." Faz 4: "Yuva Pati ve Yuva Bakım kamera sürümleri; deprem uyarısı." |
| §21 | "Afet modu ürün ekranları … Yuva S4" satırı kalkar (Faz 3'e alındı). |
| §22 | HF61 eklenir. |

**HF61:** Yuva Acil, Yuva Pati ve Yuva Bakım ayrı uygulamalardır; Yuva Hat'ta ürün modülü kalmaz. Uç modu onu kullanan ürünün uygulamasındadır ve bir uç tek ürüne bağlıdır. SOS her Yuva uygulamasında alınır ve gösterilir; gönderme, "İyiyim" ve afet modu Yuva Acil'dedir. `yuva.bakim` ad alanı Yuva Bakım'ındır; Defter'in doz olayı `yuva.defter.*`'dır (RFC-0029). — Gerekçe: Her ürün daha çok insana kendi kapısından ulaşır; SOS'u kaçırmamak için alma her uygulamadadır (Kerem, 24 Ekim 2026).

## 11. Diğer RFC'lerde değişecekler

| RFC | Yer | Değişiklik |
|-----|-----|------------|
| 0006 | §6.1 son not | "Acil ve Deprem ürününün RFC'sinde" → "Yuva Acil'in RFC'sinde". |
| 0008 | Kod yeri, §2, §11.1 | "Yuva Hat içinde uç modu ekranları" → "uç modunu kullanan ürünün uygulamasında (RFC-0029 §3)". "Uç modu Yuva Hat'ın içindedir; ayrı uygulama yoktur" → "Uç modu onu kullanan ürünün uygulamasındadır; ayrı kamera uygulaması yoktur. Bir uç tek ürüne bağlıdır." |
| 0012 | Kod yeri | "(Yuva Hat'ta `native-modules/yuva-afet`)" → "(Yuva Acil'de `native-modules/yuva-afet`)". |
| 0017 | §9 tablo | "Bakım, Pati ve Acil Yuva Hat'ın içinde olduğu için Yuva Hat." cümlesi çıkar; §5'teki satırlar eklenir. |

## 12. Kod ve ürün belgelerine etkisi

| Yer | İş | Kim |
|-----|----|-----|
| `sdk/care.js`, `sdk/index.d.ts`, `core/events/test/*` | §6 ad değişikliği | dell (Havenfold) |
| Yuva Defteri `docs/00`, `07` | `yuva.defter.reminder` → §6 adları; SOS ekranı eklenir (§4) | mac belge, lenovo kod |
| Yuva Hat | Sonraki mağaza sürümünde: SOS ekranı (§4), sessiz alarm anahtarı gizlenir (§4.4). Mağaza incelemesi sürerken dokunulmaz. | mac belge |
| EserX `yuva/docs/19` katalog | Yeni uygulama listesiyle yenilenir | mac |
| `yuva-acil`, `yuva-pati`, `yuva-bakim` `docs/00` | "RFC-0024 (yazılacak)" → "RFC-0029" | mac |

## 13. Alternatifler

| Seçenek | Neden seçilmedi |
|---------|-----------------|
| Üçü Yuva Hat'ın modülü | Mesajlaşmayı kullanmayan kişiye ulaşmaz; Hat'ın izinleri ve mağaza incelemesi büyür; Kerem'in "ayrı olmalı" kararına ters. |
| Tek "Yuva" süper uygulaması | Aynı sorun; yaş derecelendirmesi ve izinler tek uygulamada birikir. |
| SOS yalnız Yuva Acil'de | Acil'i kurmayan üye SOS'u kaçırır. |
| Afet köprüleri her uygulamada | Her uygulamaya Bluetooth arka plan izni ve mağaza gerekçesi gerekir; pil yükü katlanır. Bedeli §4.6'da açıkça söylenir. |
| Ayrı "Yuva Kamera" uygulaması | Kamerayı kuran kişi hangi ürün için kurduğunu bilir; rıza ve görev imajı ürüne bağlıdır. |

## 14. Geri dönüş yolu

- Uygulamaların hiçbiri yayında değil. Karar geri alınırsa ürünler bir uygulamanın modülü olarak birleştirilir; ad alanları aynı kalır.
- §6'daki ad değişikliği yazılmış veri olmadığı için geri alınabilir.
