#!/usr/bin/env bash
# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
# was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
# havenfold-usb-build.sh — Havenfold Kurulum USB'si imajını üretir (RFC-0007 §8.1–8.3).
#
# Resmî Ubuntu Server 24.04.x LTS (amd64) ISO'su değiştirilmeden alınır (Canonical'ın imzalı shim, grub ve çekirdeği),
# xorriso ile yeniden paketlenir ve üstüne şunlar eklenir:
#   /nocloud/user-data, /nocloud/meta-data            otomatik kurulum dosyası (meta-data boş)
#   /havenfold/<paket>.zip, bildirim.bin, kok.durum    imzalı bildirimdeki düğüm paketi ve kök durumu
#   /havenfold/deb/                                    çevrimdışı Ubuntu paketleri (bildirimin installerDebs listesi)
#   /havenfold/bin/                                    hf-on-kontrol, hf-depolama-yaz, hf-hedefe-kur
#   /havenfold/kurulum/                                kurulum aracı (Node, lib/, target/) — paketteki Node ile çalışır
#   /havenfold/paket.json, ozetler                     sürüm bilgisi ve kurulumda yeniden denetlenen özetler
#   /erase-mode/vmlinuz, initrd, kok.squashfs               silme ortamı (erase-root-build.sh üretir)
#   /boot/grub/grub.cfg                                menü (§8.2): varsayılan "Diskten başlat"
# USB'de sır yoktur. Betik anahtar üretmez, imzalamaz; bildirim ve kök durumu dışarıdan, imzalı gelir.
#
# Yalnız Linux'ta çalışır. Gerekenler: xorriso, sha256sum, b2sum, Node 22+ ve bu deponun kökünde `npm ci`.
# Kök yetkisi gerekmez; hiçbir diske yazmaz (çıktı ISO ve imzasız SHA256SUMS). USB'ye yazmak ayrı adımdır (BENIOKU.md).
#
#   bash installer/build/havenfold-usb-build.sh \
#     --iso ubuntu-24.04.3-live-server-amd64.iso --iso-sha256 <64 onaltılık hane> \
#     --surum 1.2.3 --paket havenfold-node-1.2.3-amd64.zip --bildirim havenfold-node.bildirim \
#     --kok-durum kok.durum [--kok-zinciri kok-zinciri.bin] --deb-dizini deb/ --silme-dizini erase-mode/ --cikti cikti/
set -euo pipefail

DEPO=$(cd "$(dirname "$0")/../.." && pwd)
kullanim () { sed -n '2,/^set -euo/p' "$0" | sed 's/^# \{0,1\}//' | sed '$d' >&2; exit 1; }
hata () { echo "HATA: $*" >&2; exit 1; }

ISO="" ISO_SHA="" SURUM="" PAKET="" BILDIRIM="" KOK_DURUM="" KOK_ZINCIRI="" DEB="" SILME="" CIKTI=""
while [ $# -gt 0 ]; do
  case "$1" in
    --iso) ISO=$2 ;; --iso-sha256) ISO_SHA=$2 ;; --surum) SURUM=$2 ;; --paket) PAKET=$2 ;; --bildirim) BILDIRIM=$2 ;;
    --kok-durum) KOK_DURUM=$2 ;; --kok-zinciri) KOK_ZINCIRI=$2 ;; --deb-dizini) DEB=$2 ;; --silme-dizini) SILME=$2 ;;
    --cikti) CIKTI=$2 ;; -h|--yardim) kullanim ;; *) hata "bilinmeyen seçenek: $1" ;;
  esac
  shift 2
done
for v in ISO ISO_SHA SURUM PAKET BILDIRIM KOK_DURUM DEB SILME CIKTI; do [ -n "${!v}" ] || { echo "Eksik: --$(echo "$v" | tr 'A-Z_' 'a-z-')" >&2; kullanim; }; done

[ "$(uname -s)" = Linux ] || hata "yalnız Linux'ta çalışır"
for a in xorriso sha256sum b2sum node; do command -v "$a" >/dev/null || hata "$a yok"; done
[[ "$SURUM" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || hata "sürüm MAJOR.MINOR.PATCH olmalı"
[[ "$ISO_SHA" =~ ^[0-9a-fA-F]{64}$ ]] || hata "--iso-sha256 64 onaltılık hane olmalı"
for f in "$SILME/vmlinuz" "$SILME/initrd" "$SILME/kok.squashfs"; do [ -f "$f" ] || hata "silme ortamı eksik: $f (erase-root-build.sh)"; done
[ -d "$DEPO/node_modules/b4a" ] || hata "depoda node_modules yok: kökte 'npm ci'"

echo "== 1. Ubuntu ISO özeti (SHA-256)"
GERCEK=$(sha256sum "$ISO" | cut -d' ' -f1)
[ "$GERCEK" = "$(echo "$ISO_SHA" | tr 'A-F' 'a-f')" ] || hata "ISO özeti tutmuyor: $GERCEK"
echo "tamam: $GERCEK"

SAHNE=$(mktemp -d)
trap 'rm -rf "$SAHNE"' EXIT
H=$SAHNE/havenfold
mkdir -p "$H/bin" "$H/deb" "$H/kurulum" "$SAHNE/nocloud" "$SAHNE/erase-mode" "$SAHNE/boot/grub"

echo "== 2. Sürüm bildirimi, paket ve Ubuntu paketleri"
EK=()
[ -n "$KOK_ZINCIRI" ] && EK=(--kok-zinciri "$KOK_ZINCIRI")
node "$DEPO/installer/build/notification-check.js" --bildirim "$BILDIRIM" --kok-durum "$KOK_DURUM" ${EK[@]+"${EK[@]}"} \
  --paket "$PAKET" --deb-dizini "$DEB" --surum "$SURUM" --cikti "$SAHNE/denetim"
install -m 0644 "$PAKET" "$H/$(basename "$PAKET")"
install -m 0644 "$BILDIRIM" "$H/bildirim.bin"
install -m 0644 "$SAHNE/denetim/kok.durum" "$H/kok.durum"
install -m 0644 "$SAHNE/denetim/paket.json" "$H/paket.json"
install -m 0644 "$SAHNE/denetim/ozetler" "$H/ozetler"
install -m 0644 "$DEB"/*.deb "$H/deb/"

echo "== 3. Kurulum aracı"
install -m 0755 "$SAHNE/denetim/node" "$H/kurulum/node"
mkdir -p "$H/kurulum/lib" "$H/kurulum/erase" "$H/kurulum/target/systemd" "$H/kurulum/vendor" "$H/kurulum/node_modules"
install -m 0644 "$DEPO"/installer/lib/*.js "$H/kurulum/lib/"
install -m 0644 "$DEPO"/installer/erase/{discovery,nvme,ata}.js "$H/kurulum/erase/"
install -m 0644 "$DEPO/installer/target/common.sh" "$H/kurulum/target/"
install -m 0755 "$DEPO/installer/target/hf-ilk-acilis" "$DEPO/installer/target/hf-luks-yenile" "$H/kurulum/target/"
install -m 0644 "$DEPO"/installer/target/systemd/*.service "$H/kurulum/target/systemd/"
install -m 0644 "$DEPO/core/export/zip.js" "$H/kurulum/vendor/zip.js"
cp -a "$DEPO/node_modules/b4a" "$H/kurulum/node_modules/b4a"
install -m 0755 "$DEPO"/installer/bin/hf-{on-kontrol,depolama-yaz,hedefe-kur} "$H/bin/"
echo "$SURUM" > "$H/surum"

echo "== 4. Otomatik kurulum dosyası, menü, silme ortamı"
install -m 0644 "$DEPO/installer/build/nocloud/user-data" "$SAHNE/nocloud/user-data"
: > "$SAHNE/nocloud/meta-data"
install -m 0644 "$DEPO/installer/build/grub.cfg" "$SAHNE/boot/grub/grub.cfg"
install -m 0644 "$SILME/vmlinuz" "$SILME/initrd" "$SILME/kok.squashfs" "$SAHNE/erase-mode/"

echo "== 5. xorriso ile yeniden paketleme (önyükleme düzeni olduğu gibi)"
mkdir -p "$CIKTI"
CIKTI_ISO="$CIKTI/havenfold-kurulum-$SURUM-amd64.iso"
rm -f "$CIKTI_ISO"
xorriso -indev "$ISO" -outdev "$CIKTI_ISO" \
  -map "$SAHNE/nocloud" /nocloud \
  -map "$SAHNE/havenfold" /havenfold \
  -map "$SAHNE/erase-mode" /erase-mode \
  -map "$SAHNE/boot/grub/grub.cfg" /boot/grub/grub.cfg \
  -boot_image any replay
# ISO'nun özeti sürüm bildirimine girmez (ISO bildirimi taşır). Yayında ayrı SHA256SUMS olur; sürüm kök anahtarıyla
# ayrıca imzalanır (SHA256SUMS.sig). Betik dosyayı imzasız üretir; imzayı Kerem çevrimdışı atar.
(cd "$CIKTI" && sha256sum "$(basename "$CIKTI_ISO")" > SHA256SUMS)

echo
echo "Hazır: $CIKTI_ISO"
cat "$CIKTI/SHA256SUMS"
echo "SHA256SUMS imzasızdır: yayından önce sürüm kök anahtarıyla çevrimdışı imzalanır (SHA256SUMS.sig)."
