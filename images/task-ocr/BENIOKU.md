# task-ocr — `hf.task.ocr` görev imajı

PDF ya da fotoğraftan metin veya aranabilir PDF üretir (RFC-0002 §5). OCRmyPDF + Tesseract (Türkçe ve İngilizce),
Ghostscript ve qpdf; Ubuntu 24.04 tabanı.

| Dosya | Ne |
|-------|----|
| `Containerfile` | İmaj tarifi. Taban sürüm etiketiyle, paketler Ubuntu arşiv anlık görüntüsüyle (`UBUNTU_SNAPSHOT`) sabit. |
| `hf-gorev` | Giriş betiği: `/in`'i okur, `/out`'a yazar, çıkış kodu döner |
| `CONTRACT.md` | Girdi, parametre, çıktı, çıkış kodları |
| `imaj-bildirimi.json` | Sürüm bildirimindeki `images` satırının bu dizinden gelen alanları (RFC-0007 §12.1) |
| `LICENSES.md` | İmajdaki bileşenlerin lisansları ve kaynak arşivi |
| `LICENSE` | Apache-2.0 |

## Derleme

```sh
podman build -t localhost/hf-task-ocr:1.0.0 --build-arg HF_SURUM=1.0.0 images/task-ocr
podman save --format oci-archive -o hf-task-ocr-1.0.0.tar localhost/hf-task-ocr:1.0.0
images/source-archive.sh localhost/hf-task-ocr:1.0.0 cikti/
```

Derleme hattı `imaj-bildirimi.json`'a `arch`, `ociDigest` (yüklenen imajın `sha256:` özeti), `archive` (`oci-archive`
dosyasının adı, boyutu, `hash('hf/release-pkg/', …)` özeti, adresleri) ve `sourceArchive` (kaynak arşivinin adı, özeti,
adresleri) alanlarını ekleyip satırı bildirime koyar. `"sourceArchive": true` arşivin zorunlu olduğunu söyler.
`caps` işçinin `NODE_CAPS.tasks` girdisidir (`maxRamMB` = `ramMB`).

Düğümde: denetçi arşivin özetini denetler, `podman load` ile yükler, yüklenen özetin `ociDigest` olduğunu doğrular
(`node/podman.js` `imajYukle`) ve görevi her zaman `@sha256:` ile çalıştırır.

**Durum:** İmaj GitHub Actions'ta (amd64) derlenip düğümün yolundan denendi (`.github/workflows/image.yml`,
`images/image-build.sh`, `node/scripts/image-try.js`): `node/podman.js` arşivin özetini ve `ociDigest`'i doğruladı, görev
düğümdeki bayraklarla (ağ yok, kök salt okunur, `--userns=keep-id`) PNG ve iki sayfalık PDF'te çalıştı; metin, aranabilir
PDF, sayfa aralığı ve 2, 3, 4 çıkış kodları beklendiği gibi. Anlık görüntü sunucusu HTTPS olduğu için `ca-certificates`
tabanın arşivinden kurulur (sürümü derleme gününe bağlı); kalan paketler anlık görüntüden. arm64 derlemesi depo
herkese açılınca çalışır. Gerçek bir düğümde (havenfold-task kullanıcısı, `podman.socket`) henüz denenmedi.
