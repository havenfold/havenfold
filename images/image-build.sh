#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# image-build.sh — görev imajını Podman ile derler, oci-archive olarak kaydeder ve düğümün göreceği OCI özetini çıkarır
# (RFC-0007 §12.1 images: ociDigest, archive; node/podman.js imajYukle).
#
# Kullanım: images/image-build.sh <imaj-dizini> <çıktı-dizini>
#   <imaj-dizini>  ör. images/task-ocr (Containerfile, imaj-bildirimi.json)
#   HF_TABAN       taban imaj (varsayılan: ubuntu:24.04, çok mimarili dizin özetiyle sabit)
#
# Çıktı dizinine:
#   hf-task-<ad>-<sürüm>-<arch>.tar   oci-archive (podman save --format oci-archive)
#   imaj.env                          TUR, SURUM, ARCH, REF, ARSIV, OCI_DIGEST (kabukta source edilir)
#
# Özet, düğümün yaptığı gibi bulunur: derlenen imaj silinir, arşiv podman load ile yeniden yüklenir ve yüklenen imajın
# özeti okunur (podman image inspect {{.Digest}}). Yalnız derleme makinesinde, ağ açıkken çalışır; mimari makinenin
# kendi mimarisidir (çapraz derleme yok).
set -euo pipefail

DIZIN=${1:?kullanım: image-build.sh <imaj-dizini> <çıktı-dizini>}
CIKTI=${2:?kullanım: image-build.sh <imaj-dizini> <çıktı-dizini>}
# ubuntu:24.04, 25 Ekim 2026'daki çok mimarili dizin özeti (amd64 ve arm64 aynı özetten)
TABAN=${HF_TABAN:-docker.io/library/ubuntu:24.04@sha256:68ee22004a9109b44973313b02ff7b1de250f1de0f5ecb628d73f579aaff33ac}

command -v podman >/dev/null || { echo "HATA: podman yok" >&2; exit 1; }
[ -f "$DIZIN/Containerfile" ] && [ -f "$DIZIN/imaj-bildirimi.json" ] || { echo "HATA: $DIZIN'de Containerfile ya da imaj-bildirimi.json yok" >&2; exit 1; }

alan () { node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))[process.argv[2]]))" "$DIZIN/imaj-bildirimi.json" "$1"; }
TUR=$(alan type)
SURUM=$(alan version)
[[ "$TUR" =~ ^hf\.task\.[a-z0-9-]+$ ]] || { echo "HATA: tür adı: $TUR" >&2; exit 1; }
[[ "$SURUM" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "HATA: sürüm: $SURUM" >&2; exit 1; }
case "$(uname -m)" in
  x86_64) ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) echo "HATA: desteklenmeyen mimari $(uname -m)" >&2; exit 1 ;;
esac

AD="localhost/${TUR//./-}"
ETIKET="$AD:$SURUM"
mkdir -p "$CIKTI"
ARSIV="$CIKTI/${TUR//./-}-$SURUM-$ARCH.tar"

echo "== $TUR $SURUM ($ARCH) · taban $TABAN"
podman build --pull=missing --build-arg "TABAN=$TABAN" --build-arg "HF_SURUM=$SURUM" -t "$ETIKET" "$DIZIN"

# Etiketler imaj bildirimiyle uyuşmalı (source-archive.sh bunlardan okur)
[ "$(podman image inspect --format '{{ index .Config.Labels "org.havenfold.task.type" }}' "$ETIKET")" = "$TUR" ] || { echo "HATA: imaj etiketi türle uyuşmuyor" >&2; exit 1; }
[ "$(podman image inspect --format '{{ index .Config.Labels "org.havenfold.task.version" }}' "$ETIKET")" = "$SURUM" ] || { echo "HATA: imaj etiketi sürümle uyuşmuyor" >&2; exit 1; }

rm -f "$ARSIV"
podman save --format oci-archive -o "$ARSIV" "$ETIKET"
podman rmi "$ETIKET" >/dev/null
YUKLENEN=$(podman load --quiet --input "$ARSIV" | sed -n 's/^Loaded image[^:]*: *//p' | tail -n 1)
[ -n "$YUKLENEN" ] || { echo "HATA: arşiv yüklenemedi" >&2; exit 1; }
OCI_DIGEST=$(podman image inspect --format '{{.Digest}}' "$YUKLENEN")
[[ "$OCI_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "HATA: imaj özeti okunamadı: $OCI_DIGEST" >&2; exit 1; }
# Yüklenen imaj aynı adla durur (source-archive.sh ve deneme bunu kullanır)
[ "$YUKLENEN" = "$ETIKET" ] || podman tag "$YUKLENEN" "$ETIKET"

{
  printf 'TUR=%s\nSURUM=%s\nARCH=%s\nREF=%s\n' "$TUR" "$SURUM" "$ARCH" "$ETIKET"
  printf 'ARSIV=%s\nOCI_DIGEST=%s\n' "$ARSIV" "$OCI_DIGEST"
} > "$CIKTI/imaj.env"
echo "== $(du -h "$ARSIV" | cut -f1) $ARSIV"
echo "== yüklenen: $YUKLENEN · özet $OCI_DIGEST"
