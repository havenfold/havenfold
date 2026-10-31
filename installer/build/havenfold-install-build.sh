#!/usr/bin/env bash
# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
# was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
# havenfold-install-build.sh — tek dosyalık `havenfold-kur`u üretir (RFC-0007 §8.6). Kök anahtar durumu dosyanın içine
# sabitlenir; kurulum aracı (lib/, target/, bildirim doğrulayıcısı, zip okuyucu) dosyanın sonuna gömülür. Node
# çalışma zamanı gömülmez: kurulumda doğrulanan düğüm paketinden alınır. Betik anahtar üretmez, imzalamaz.
#
#   bash installer/build/havenfold-install-build.sh --kok-durum kok.durum --surum 1.2.3 --cikti havenfold-kur
#
# macOS'ta da çalışır (yalnız tar, base64, od); çıktının SHA-256'sı sürüm sayfasında yayımlanır.
set -euo pipefail

DEPO=$(cd "$(dirname "$0")/../.." && pwd)
hata () { echo "HATA: $*" >&2; exit 1; }
KOK_DURUM="" SURUM="" CIKTI=""
while [ $# -gt 0 ]; do
  case "$1" in --kok-durum) KOK_DURUM=$2 ;; --surum) SURUM=$2 ;; --cikti) CIKTI=$2 ;; *) hata "bilinmeyen seçenek: $1" ;; esac
  shift 2
done
[ -n "$KOK_DURUM" ] && [ -n "$SURUM" ] && [ -n "$CIKTI" ] || hata "--kok-durum, --surum ve --cikti gerekli"
[[ "$SURUM" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || hata "sürüm MAJOR.MINOR.PATCH olmalı"
[ -d "$DEPO/node_modules/b4a" ] || hata "depoda node_modules yok: kökte 'npm ci'"
KOK_HEX=$(od -An -v -tx1 "$KOK_DURUM" | tr -d ' \n')
[ "${#KOK_HEX}" -ge 130 ] && [ "${#KOK_HEX}" -le 146 ] || hata "kök durumu beklenen boyutta değil (keyEpoch ‖ 32 ‖ 32 bayt)"

IS=$(mktemp -d)
trap 'rm -rf "$IS"' EXIT
Y=$IS/yuk
mkdir -p "$Y/lib" "$Y/erase" "$Y/install" "$Y/target/systemd" "$Y/vendor" "$Y/node_modules"
cp "$DEPO"/installer/lib/*.js "$Y/lib/"
cp "$DEPO"/installer/erase/{discovery,nvme,ata}.js "$Y/erase/"
cp "$DEPO/installer/install/notification.sh" "$Y/install/"
cp "$DEPO/installer/target/common.sh" "$DEPO/installer/target/hf-ilk-acilis" "$DEPO/installer/target/hf-luks-yenile" "$Y/target/"
cp "$DEPO"/installer/target/systemd/*.service "$Y/target/systemd/"
cp "$DEPO/core/export/zip.js" "$Y/vendor/zip.js"
cp -R "$DEPO/node_modules/b4a" "$Y/node_modules/b4a"
chmod 0755 "$Y/target/hf-ilk-acilis" "$Y/target/hf-luks-yenile"

sed -e "s/@KOK_DURUMU@/$KOK_HEX/" -e "s/@SURUM@/$SURUM/" "$DEPO/installer/install/havenfold-kur.sablon" > "$CIKTI"
COPYFILE_DISABLE=1 tar -C "$Y" -cz . | base64 >> "$CIKTI"
chmod 0755 "$CIKTI"
if command -v sha256sum >/dev/null; then sha256sum "$CIKTI"; else shasum -a 256 "$CIKTI"; fi
