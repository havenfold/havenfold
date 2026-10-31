#!/usr/bin/env bash
# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
# was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
# test-iso-build.sh — YALNIZ CI: Kurulum USB'si ISO'sunu baştan sona derler (.github/workflows/install.yml).
#
# Üretim derlemesiyle aynı araçlar ve aynı sıra (BENIOKU.md "Derleme"); tek fark kök anahtardır: bildirim burada
# üretilen GEÇİCİ bir test kök anahtarıyla imzalanır ve ISO'ya bu test kökünün kok.durum'u girer. Anahtar imzadan
# hemen sonra silinir, yazdırılmaz, yüklenmez. Üretim yolu (sürüm hattı, Kerem'in çevrimdışı imzası) değişmez.
#
#   bash installer/test/vm/test-iso-build.sh --ubuntu-iso F --ubuntu-sha256 S --surum X.Y.Z --cikti D
#
# Linux CI makinesinde çalışır; sudo ister (deb-collect.sh ve erase-root-build.sh kök olarak). Depo kökünde
# `npm ci --omit=dev` ve worklet/ içinde `npm ci --omit=dev` yapılmış olmalı.
# Çıktı: D/havenfold-kurulum-<sürüm>-amd64.iso, D/SHA256SUMS, D/ozet/ (bildirim JSON'u, paket.json, deb listesi).
set -euo pipefail

DEPO=$(cd "$(dirname "$0")/../../.." && pwd)
hata () { echo "HATA: $*" >&2; exit 1; }
UISO="" USHA="" SURUM="" CIKTI=""
while [ $# -gt 0 ]; do
  case "$1" in
    --ubuntu-iso) UISO=$2 ;; --ubuntu-sha256) USHA=$2 ;; --surum) SURUM=$2 ;; --cikti) CIKTI=$2 ;;
    *) hata "bilinmeyen seçenek: $1" ;;
  esac
  shift 2
done
[ -n "$UISO" ] && [ -n "$USHA" ] && [ -n "$SURUM" ] && [ -n "$CIKTI" ] || hata "--ubuntu-iso, --ubuntu-sha256, --surum ve --cikti gerekli"
mkdir -p "$CIKTI/ozet"
CIKTI=$(cd "$CIKTI" && pwd)
IS=$(mktemp -d "${RUNNER_TEMP:-/tmp}/hf-iso.XXXXXX")
trap 'sudo rm -rf "$IS"' EXIT
adim () { printf '\n==== %s (%s)\n' "$1" "$(date -u +%H:%M:%S)"; }

adim "1. Çalışma zamanları (Node, Bare)"
bash "$DEPO/node/scripts/runtime.sh" amd64 "$IS/cz"

adim "2. Çevrimdışı Ubuntu paketleri (installerDebs)"
sudo bash "$DEPO/installer/build/deb-collect.sh" --iso "$UISO" --cikti "$IS/deb"
ls -1 "$IS/deb" > "$CIKTI/ozet/deb-listesi.txt"

adim "3. Geçici test kökü"
( umask 077; openssl genpkey -algorithm ed25519 -out "$IS/test-kok.pem" 2>/dev/null )
node "$DEPO/installer/test/vm/test-root.js" --anahtar "$IS/test-kok.pem" --cikti "$IS/kok.durum"

adim "4. Düğüm paketi ve imzasız bildirim (release-build.js paket)"
node "$DEPO/node/scripts/release-build.js" paket --surum "$SURUM" --kanal deneme --arch amd64 \
  --node "$IS/cz/node" --bare "$IS/cz/bare" --kok-durum "$IS/kok.durum" --deb-dizini "$IS/deb" --cikti "$IS/paket"

adim "5. Bildirimi test köküyle imzala, anahtarı sil"
node "$DEPO/node/scripts/release-sign.js" imzala --bildirim "$IS/paket/havenfold-node.bildirim.imzasiz" \
  --anahtar "$IS/test-kok.pem" --kok-durum "$IS/kok.durum" --cikti "$IS/imzali"
shred -u "$IS/test-kok.pem"
cp "$IS/paket/havenfold-node.bildirim.json" "$CIKTI/ozet/"

adim "6. Silme ortamı (erase-root-build.sh, mmdebstrap)"
sudo env PATH="$PATH" bash "$DEPO/installer/build/erase-root-build.sh" --surum "$SURUM" --node "$IS/cz/node" --cikti "$IS/erase-mode"

adim "7. Kurulum USB'si imajı (havenfold-usb-build.sh)"
bash "$DEPO/installer/build/havenfold-usb-build.sh" --iso "$UISO" --iso-sha256 "$USHA" --surum "$SURUM" \
  --paket "$IS/paket/havenfold-node-$SURUM-amd64.zip" --bildirim "$IS/imzali/havenfold-node.bildirim" \
  --kok-durum "$IS/kok.durum" --deb-dizini "$IS/deb" --silme-dizini "$IS/erase-mode" --cikti "$CIKTI"

adim "8. Özet"
# Yalnız bilgi: bu adımdaki bir hata derlemeyi düşürmez
I="$CIKTI/havenfold-kurulum-$SURUM-amd64.iso"
for d in /havenfold /havenfold/deb /havenfold/kurulum /erase-mode /nocloud /boot/grub; do
  xorriso -indev "$I" -lsl "$d" 2>/dev/null || true
done > "$CIKTI/ozet/iso-icerik.txt"
tail -n 40 "$CIKTI/ozet/iso-icerik.txt"
xorriso -indev "$I" -report_el_torito plain -report_system_area plain > "$CIKTI/ozet/iso-onyukleme.txt" 2>&1 || true
cat "$CIKTI/ozet/iso-onyukleme.txt"
cp "$CIKTI/SHA256SUMS" "$CIKTI/ozet/"
ls -l "$CIKTI"
