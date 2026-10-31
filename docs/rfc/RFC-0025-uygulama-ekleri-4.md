# RFC-0025 — Uygulamadan dönen ekler 4: yeni dosyanın sınıfı ve kanalın eksik komutları

> Durum: **Onaylandı** (Kerem, 23 Ekim 2026) · 23 Ekim 2026 · Yazan: Havenfold çekirdek ekibi · Onay: Kerem
> Kaynak: Yuva Defteri L13 dilim 2 (`kol/defter` `1c3d950`), `kollar/L-durum.md` İstekler "L13 dilim 2".
> Etkilenen RFC'ler: 0002, 0013, 0023, 0024.

## 1. Yeni dosyanın sınıfı (RFC-0023 §2 a eki)

**Sorun.** RFC-0023 §2 a, çıkarımın sınıfını kaynaktan hesaplar. Telefonda yeni taranan ya da seçilen bir belge, henüz hiçbir kayda bağlı değildir. Çekirdek böyle bir `dosya:` kaynağını en sıkı sınıf olan `kasa` sayıyor. Sonuç: "Belge tara → Deftere ekle" akışı (D45 → D05) yalnız Kasa'ya kaydedebiliyor; Tüm Aile'ye ya da Ebeveynler'e kayıt `VAULT_SOURCE` ile reddediliyor.

| # | Karar |
|---|-------|
| a | Bu telefonda yeni eklenen (`attach`) ve hiçbir kayıtta başvurusu olmayan dosya `aile` sınıfıdır. Onay ekranında seçilen hedef koleksiyon kasa ise kayıt `kasa` olur. |
| b | Bir kasa koleksiyonundaki kayda bağlı dosya `kasa`, başka koleksiyondaki kayda bağlı dosya o koleksiyonun sınıfıdır. Birden çok kayda bağlıysa en sıkısı. |
| c | Başka bir cihazdan gelen ve bu telefonda hiçbir kayda bağlı olmayan dosya (ör. yarım kalmış eşitleme) `kasa` sayılmaya devam eder. |

## 2. Kanalın eksik komutları (RFC-0024 eki)

Yuva Hat çizelgesindeki numaralar korunur (RFC-0024 §3a ile aynı gerekçe):

| No | Ad | Gövde → sonuç |
|----|----|---------------|
| 14 | `LEDGER_SIGN` | `{ proposalId }` → `{ durum }` |
| 225 | `PROPOSALS` | `{}` → `[{ proposalId, type, hedef, imzalar, waitingFor, zaman }]` |
| 226 | `PROPOSAL_REJECT` | `{ proposalId }` → `null` (yerel ret) |
| 254 | `TASK_CONSENT` | `{ deviceId, allow }` → `null` (RFC-0002 §14 sırası; 250–253 makine, cihazlar, çalıştır, iptal için ayrılmış) |

Gövdeler:
- 272 `AI_EXTRACT`: `{ sema, girdi: { metin } | { blobRef } | { bytes, mime }, kaynak }`. Dosya girdisinde platformun yazı tanıması worklet'te çalışır.
- 273 `AI_SAVE`: `{ collectionId, cikarim, ek? }` → `recordId | null`.
- Geri çağrı `onayEkrani`: veri `{ collectionId, sema, hedef, alanlar, sinif }` → `{ son } | null`. Uygulamada işleyici yoksa `GERI_CAGRI_YOK`.
- Taşıyıcı çerçeveleri sıraya sokmaz: bir geri çağrı beklenirken başka istek ve cevaplar akmaya devam eder.
- Cevap 1 MiB'ı geçecekse sunucu `INVALID_FRAME` döner; büyük sorgular `limit` ile parçalanır.

## 3. Hata kodları

| RFC | Kodlar |
|-----|--------|
| 0013 | `GERI_CAGRI_YOK`, `NO_APPROVAL_SCREEN`, `VAULT_SOURCE` |
