# RFC-0031 — `hf.sos` alanları: konum, sessiz SOS ve afet bağı

> Durum: **Onaylandı** (Kerem, 24 Ekim 2026), kurucu belge 1.16 · 24 Ekim 2026 · Yazan: Havenfold çekirdek ekibi · Onay: Kerem
> Onayla gelen ek (Kerem, 24 Ekim 2026): "Bakıcı SOS gönderebilsin." → §4.1.
> Kaynak: RFC-0006 §6.1 notu ("`hf.sos` olayının konum ve afet alanları Yuva Acil'in RFC'sinde tanımlanır"), RFC-0029 §4 (SOS her Yuva uygulamasında alınır; sessiz SOS Yuva Hat'ın zorlama PIN'inde), Yuva Acil `docs/01`, `docs/02`.
> Kurucu belge: §11 (afet modu), §12 (olay zarfı). Etkilenen RFC'ler: 0006 (§6.1), 0012 (§7, §8.4), 0029 (§4.4).
> **Protokol değişikliği:** `hf.sos` türüne isteğe bağlı alanlar eklenir; `v` 1 kalır, eski istemci bilmediği alanı yok sayar (RFC-0006 §4.2). Misafirin SOS'u (§4.1) RFC-0030'un bırakma yolunu kullanır ve onun düzeyine (2.3) bağlıdır; yeni defter olayı, zarf türü ya da yetenek biti yoktur.

## 1. Sorun

- `hf.sos` bugün yalnız ad, koleksiyon (Tüm Aile) ve merdivenle tanımlı (RFC-0006 §6.1, §9.4). Alanı yok: konum, kısa not, nasıl gönderildiği yazılamıyor.
- Yuva Hat'ın zorlama PIN'i "Aileme sessiz alarm gönder" seçeneğiyle sessiz SOS göndermeli (RFC-0029 §4.4). Sessiz SOS'un alıcıda nasıl görüneceği tanımlı değil; bu yüzden Yuva Hat anahtarı gizli tutuyor.
- İnternet yokken SOS afet mesajıyla gider (RFC-0012 `SOS`, kind 3). Normal yol dönünce aynı SOS'un `hf.sos` kaydı da gelirse aile iki kez haber almamalı.

## 2. Öneri özeti

- `hf.sos`'a altı isteğe bağlı alan eklenir: `yol`, `konum`, `metin`, `pil`, `afetMid`, `sessiz`.
- `yol` SOS'un nereden geldiğini söyler: `dugme` (Yuva Acil), `zorlama-pin` (Yuva Hat), `afet` (afet modunda gönderildi).
- **Sessiz SOS:** gönderenin telefonunda hiçbir iz bırakmaz; alıcıda "aramadan önce düşün" uyarısıyla görünür.
- **Afet bağı:** afet modunda gönderilen SOS'un `hf.sos` kaydı aynı `afetMid`'i taşır. Alıcı, aynı `afetMid` için ikinci kez bildirim göstermez.

## 3. Alanlar

| Alan | Değer türü | Zorunlu | Anlam |
|------|------------|---------|-------|
| `yol` | string | Hayır | `dugme`, `zorlama-pin`, `afet`. Yoksa `dugme` sayılır. |
| `konum` | map | Hayır | `{ latE5: int, lonE5: int, accM: int, at: int }`. RFC-0012 §7.3 ile aynı biçim. SOS'ta yuvarlanmaz. |
| `metin` | string | Hayır | ≤ 64 bayt UTF-8. Kısa not ("Mutfaktayım, düştüm"). |
| `pil` | int | Hayır | Gönderenin pil yüzdesi, 0–100. |
| `afetMid` | bytes (16) | Hayır | Bu SOS afet modunda da gönderildiyse `AFET_MSG.mid` (RFC-0012 §7.2). |
| `sessiz` | bool | Hayır | `true`: sessiz SOS (§5). Yalnız `yol = 'zorlama-pin'` ile geçerlidir. |

- Çekirdek alanlar (`_v`, `_t`, `_subj = uye:<gönderen>`, `_keep = 365`) RFC-0006 §6.1'deki gibidir.
- Kurallar sağlanmazsa (ör. `sessiz` var ama `yol` başka, `metin` 64 baytı aşıyor) olay **motor için geçersizdir** (RFC-0006 §4.5): kaydedilir ve eşitlenir ama vaka açmaz. Alıcı uygulaması yine "SOS" olarak gösterir; güvenlik olayı hiçbir zaman sessizce yutulmaz.
- Konum yalnız gönderen eklerse gider (ilke 7). Kimse başkasından konum isteyemez; böyle bir tür yoktur.

## 4. Kim yazar

| Yol | Yazan | Koşul |
|-----|-------|-------|
| `dugme` | Yuva Acil (kişinin ana ya da ek kimliği) | 3 saniye basılı tutma (Yuva Acil 02 §2) |
| `zorlama-pin` | Yuva Hat (kişinin ana kimliği) | Kişi zorlama PIN'ini girer ve "Aileme sessiz alarm gönder" açıktır |
| `afet` | Yuva Acil | Afet modunda SOS gönderildi; kayıt yerelde kuyruğa alınır, yerel ağ ya da normal yol açılınca eşitlenir |

- Üye `hf.sos`'u olağan kayıt olarak yazar. Misafir (bakıcı) §4.1'deki bırakma yoluyla yazar.
- Koleksiyon Tüm Aile'dir. Bütün okuyucular, çocuklar dahil, kitlededir (RFC-0006 §9.4, §11.1).

### 4.1 Misafirin SOS'u

Bakıcı da SOS gönderebilir (Kerem, 24 Ekim 2026).

| Konu | Kural |
|------|-------|
| İzin | Her aktif misafirin, ayrıca `GRANT_WRITE` gerekmeden, **örtük bir bırakma izni** vardır: koleksiyon Tüm Aile, tür yalnız `hf.sos`, özne yalnız `grant:<kendi kimliği>`. |
| Yol | RFC-0030 §4'teki `REC_DROP` denetimleri aynen; koşul 2 bu örtük izinle sağlanır, koşul 3 ve 4 için tür `hf.sos`, özne `grant:<grantId>`'dir. |
| Bırakma anahtarı | Düzey 2.3'te misafir ekleyen ya da düzeyi yazan ebeveyn telefonu, Tüm Aile'de `dropKey` yoksa ekler (RFC-0030 §5). `GUEST_VIEW.drops` her zaman Tüm Aile için `{ types: ['hf.sos'], subjects: ['grant:<id>'] }` satırını içerir. |
| Alanlar | `yol` yalnız `dugme` ya da `afet`; `zorlama-pin` ve `sessiz: true` misafirde geçersizdir (motor için geçersiz, yine de SOS olarak gösterilir, §3). |
| Vaka | RFC-0006 §9.4 aynen: kitle Tüm Aile'nin bütün okuyucuları. Sorumlu listesi ebeveynlerdir (misafirin kartı yoktur). Misafir vakayı sahiplenemez ve kapatamaz. |
| Düzey 2.3'ten önce | Misafirin SOS'u yalnız afet mesajı olarak gider (RFC-0012 §7.1). |
| Neden `GRANT_WRITE` değil | RFC-0030 `GRANT_WRITE`'ta `hf.` türlerini yasaklar; bu yasak sürer. Tek istisna bu örtük izindir ve yalnız `hf.sos` içindir. |

## 5. Sessiz SOS

Zorlama PIN'i, biri kişiyi uygulamayı açmaya zorladığında girilir. Uygulama her şeyi siler ve yeni yüklenmiş gibi görünür. Sessiz SOS bu sırada aileye haber verir.

**Gönderen telefonda:**

1. Yuva Hat silmeden önce `hf.sos { yol: 'zorlama-pin', sessiz: true, konum? }` yazar ve gönderir. Konum yalnız Yuva Hat'ın konum izni varsa ve kişi "sessiz alarma konum ekle" seçtiyse eklenir.
2. Gönderim ekranda hiçbir iz bırakmaz: bildirim, ses, titreşim, "gönderildi" yazısı yok. Teslim onayı beklenmez.
3. Kayıt gittikten ya da 10 saniye dolduktan sonra silme başlar. Gönderilemeyen kayıt silmeyle birlikte kaybolur; bu bilinçli olarak kabul edilir (silme ertelenmez).
4. Afet modu açılmaz; SOS afet mesajı olarak yayılmaz. Bluetooth yayını telefonun yakınındaki birine görünebilir.

**Alıcıda:**

- Bildirim acil önemdedir (RFC-0006 §9.4), ama metni farklıdır: "Rosa zorlandığını bildirdi."
- Açılan ekranın ilk satırı: "Aramak onu tehlikeye atabilir. Önce yakınındakilere ya da 112'ye haber vermeyi düşünün."
- "Ara" düğmesi yine vardır ama birincil düğme değildir.
- Gönderenin telefonu silindiği için ona "Ben bakıyorum" ya da mesaj ulaşmaz; arayüz bunu yazar.

## 6. Afet bağı

- Yuva Acil afet modunda SOS gönderirken iki şey yapar: `AFET_MSG { kind: 3 }` gönderir (RFC-0012 §7) ve aynı anda `hf.sos { yol: 'afet', afetMid: <mid> }` kaydını yerelde kuyruğa alır.
- Alıcı bir SOS'u önce afet mesajıyla, sonra kayıtla (ya da tersi) alabilir. Alıcı telefonu bildirim gösterdiği `afetMid`'leri 7 gün tutar; aynı `afetMid`'li ikinci geliş bildirim göstermez, yalnız ekrandaki SOS'u günceller.
- Vaka anahtarı RFC-0006 §10.1'deki gibidir; afet mesajı vaka açmaz (kayıt değildir). Vaka, `hf.sos` kaydı eşitlenince açılır. İnternet ve yerel ağ hiç dönmezse ailede yalnız afet mesajı vardır; Yuva Acil onu kendi ekranında gösterir (Yuva Acil 04 §5).

## 7. Konum güncellemesi

Konum güncellemesi çekirdekte değildir. Yuva Acil, SOS açıkken konum değişirse `yuva.acil.konum` ürün olayı yazar (Yuva Acil 01 §4). `hf.sos`'un `konum` alanı yalnız gönderim anını taşır.

## 8. Kurucu belgede ve RFC'lerde değişecekler

| Yer | Değişiklik |
|-----|------------|
| RFC-0006 §6.1 son not | "`hf.sos` olayının konum ve afet alanları RFC-0031'dedir." |
| RFC-0012 §8.4 | "Afet modunda gönderilen SOS'un `hf.sos` kaydı `afetMid` taşır; alıcı aynı `afetMid` için ikinci kez bildirim göstermez (RFC-0031 §6)." |
| RFC-0029 §4.4 | "Sessiz SOS'un alanları ve alıcıdaki görünüşü RFC-0031 §5'tedir. Yuva Hat anahtarı bu RFC onaylanınca açar." |
| `protocol/event-types.json` | `hf.sos.alanlar` §3'teki altı alanla doldurulur (dell). |
| RFC-0030 §3, §6 | `hf.` türü yasağına istisna: misafirin örtük `hf.sos` izni (§4.1); `GUEST_VIEW.drops` bu satırı her zaman içerir. |
| Kurucu belge §22 | HF63. |

## 9. Test vektörleri

`protocol/vectors/sos.json`: misafirin Tüm Aile'ye `hf.sos` bırakması (geçerli; özne `grant:<kendisi>`); misafirin başka özneyle ya da `sessiz: true` ile SOS'u (motor için geçersiz, gösterilir); alanı olmayan `hf.sos` (geçerli, `yol = dugme` sayılır); tam alanlı `dugme`; `sessiz: true` ve `yol = 'zorlama-pin'` (geçerli); `sessiz: true` ve `yol = 'dugme'` (motor için geçersiz, gösterilir); 65 baytlık `metin` (motor için geçersiz); aynı `afetMid`'li afet mesajı + kayıt (tek bildirim).

## 10. Açık noktalar

| Konu | Neden açık |
|------|------------|
| Saatten SOS | Kurucu §6.1'de saat "aksesuar"; SOS gönderip göndermeyeceği tanımlı değil. Yuva Acil'de kapsam dışı (Yuva Acil 07). |

## 11. Güvenlik değerlendirmesi

| Tehdit | Önlem |
|--------|-------|
| Saldırgan sessiz SOS'u fark eder | Gönderen telefonda iz yok; afet yayını yapılmaz; silme 10 saniyeden fazla ertelenmez. |
| Aile, zorlanan kişiyi arayıp tehlikeye atar | Alıcı ekranı aramadan önce uyarır; "Ara" birincil düğme değil. |
| Konum istemeden paylaşılır | Konum yalnız gönderenin seçimiyle; SOS dışında yuvarlanır (RFC-0012 §7.3). |
| Çift bildirim, gürültü | `afetMid` ile tekilleştirme; RFC-0006 §11.3 tek bildirim kuralı. |
| Bozuk alanlı SOS sessizce kaybolur | Motor için geçersiz olsa da her zaman SOS olarak gösterilir (§3). |

## 12. Geri dönüş yolu

Alanlar isteğe bağlıdır ve henüz hiçbir ailede yazılmadı. Karar geri alınırsa alanlar yok sayılır; `hf.sos` bugünkü haliyle çalışır. Yuva Hat'ın sessiz alarm anahtarı gizli kalır.
