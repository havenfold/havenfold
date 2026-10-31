# `hf.task.ocr` — imajdaki bileşenlerin lisansları

Bu dizindeki dosyalar (Containerfile, `hf-gorev`, belgeler) Apache-2.0'dır (`LICENSE`). İmajdaki araçlar kendi
lisanslarıyladır ve ayrı süreç olarak çalışır; hiçbiri telefona ya da düğüm yazılımına girmez (kurucu §17.1).

| Bileşen | Ubuntu paketi | Lisans | Not |
|---------|---------------|--------|-----|
| OCRmyPDF | `ocrmypdf` | MPL-2.0 | |
| Tesseract | `tesseract-ocr` | Apache-2.0 | |
| Tesseract dil verisi | `tesseract-ocr-tur`, `-eng`, `-osd` | Apache-2.0 | |
| Leptonica | `liblept5` | BSD-2-Clause benzeri (Leptonica lisansı) | |
| **Ghostscript** | `ghostscript`, `libgs10` | **AGPL-3.0** | PDF rasterleştirme. Kaynak arşivi zorunlu. |
| qpdf | `qpdf`, `libqpdf29` | Apache-2.0 | Sayfa aralığı |
| pikepdf | `python3-pikepdf` | MPL-2.0 | OCRmyPDF bağımlılığı |
| img2pdf | `python3-img2pdf`, `img2pdf` | LGPL-3.0 | OCRmyPDF bağımlılığı |
| Pillow | `python3-pil` | HPND (MIT-CMU) | |
| Python | `python3` | PSF-2.0 | |
| Ubuntu 24.04 taban imajı | `bash`, `coreutils`, `libc6` … | GPL-2.0/3.0, LGPL ve diğerleri | |

Tablo özettir; sürümlerle birlikte tam liste kaynak arşivindeki `paketler.tsv` ve `KAYNAKLAR.txt`'tedir, her paketin
lisans metni imajda `/usr/share/doc/<paket>/copyright`'tadır.

## Kaynak arşivi (GPLv3 §6, AGPL-3.0 §6)

GPL, LGPL ya da AGPL lisanslı her Ubuntu paketinin tam kaynağı `images/source-archive.sh` ile, imajın derlendiği arşiv
anlık görüntüsünden (`org.havenfold.ubuntu-snapshot` etiketi) toplanır. Arşiv imajla aynı yerde ve aynı sürüm
etiketiyle yayımlanır; sürüm bildiriminde `sourceArchive` boş olamaz (RFC-0007 §12.1).

AGPL-3.0 §13 (ağ üzerinden etkileşim) burada uygulanmaz: Ghostscript ağa hizmet vermez, konteynerin ağı yoktur.
