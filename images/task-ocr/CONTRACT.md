# `hf.task.ocr` 1.0.0 — sözleşme

RFC-0002 §5'teki satır: girdi PDF ya da görüntü; parametre `{ langs, pages?: [a, b], output: 'text' | 'pdf' }`;
çıktı metin ya da aranabilir PDF; sayfa sayfa bölünür; Faz 1. Çalışma ortamı RFC-0002 §11.1 (`node/podman.js`).

Bu dosyadaki ayrıntılar (dosya adları, `params` kodlaması, çıkış kodları) RFC'de yoktur; bu imajın kararıdır.

## Girdi

| Yol | İçerik |
|-----|--------|
| `/in/params` | `TASK.params` baytları: UTF-8 JSON |
| `/in/girdiler.json` | `[{ "ad": "0", "mime": "...", "size": n }]`, `TASK.inputs` sırasıyla. Bu tür tam bir girdi alır. |
| `/in/0` | Çözülmüş girdi. `application/pdf`, `image/png`, `image/jpeg` ya da `image/tiff`. |

`/in` salt okunurdur ve işçi çekirdeği yazar (`node/worker.js` `gorevYurut`).

## Parametre

```json
{ "langs": ["tur", "eng"], "pages": [1, 20], "output": "text" }
```

| Alan | Kural |
|------|-------|
| `langs` | 1–4 Tesseract dil kodu (`[a-z]{3}`, isteğe bağlı `_xxx` eki). İmajda `tur` ve `eng` vardır; başkası `DIL_YOK`. |
| `pages` | İsteğe bağlı, 1'den başlar, iki uç dahil. Bölünmüş işte her parça kendi aralığını alır (RFC-0002 §8). Görüntüde yalnız `[1, 1]`. |
| `output` | `text` ya da `pdf` |

Başka alan `INVALID_INPUT`'dir.

## Çıktı

| `output` | Dosya | Not |
|----------|-------|-----|
| `text` | `/out/metin.txt` | UTF-8; sayfalar arasında `\f`. PDF'te her sayfa yeniden tanınır (var olan metin katmanı da). |
| `pdf` | `/out/cikti.pdf` | Aranabilir PDF (PDF/A değil). Metni olan sayfaya dokunulmaz. `pages` verilmişse yalnız o sayfalar. |

32 KB'a kadar metin `TASK_RESULT.inline`'da, büyüğü yeni anahtarla şifreli dosya olarak gider (RFC-0002 §6.3); bunu
işçi çekirdeği yapar.

## Çıkış kodları

| Kod | Ad | Ne zaman |
|-----|----|----------|
| 0 | — | Tamam (`status = 'ok'`) |
| 2 | `INVALID_INPUT` | `params` ya da girdi listesi sözleşmeye uymuyor, girdi okunamıyor |
| 3 | `DIL_YOK` | İstenen dil imajda yok |
| 4 | `SAYFA_GECERSIZ` | Aralık ters, belgenin dışında ya da görüntüde 1'den farklı |
| 5 | `PDF_SIFRELI` | Parolalı PDF |
| 10 | `ARAC_HATASI` | OCRmyPDF, Tesseract ya da qpdf başka bir hatayla bitti |

Sıfırdan farklı her kod `status = 'hata'` olur; süre dolarsa `sure`, iptalde `iptal` (çalıştırıcı belirler).
Günlüğe yalnız `hf: <AD>` satırı ve aracın son beş satırı yazılır; belge içeriği yazılmaz.

## Kaynak

| | |
|---|---|
| `ramMB` | 1024 (`imaj-bildirimi.json`) |
| `limits.diskMB` | Girdinin en az 4 katı önerilir (rasterleştirme `/work`'te) |
| Ağ | Yok |
