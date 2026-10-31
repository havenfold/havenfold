#!/usr/bin/env bash
# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
# was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
# erase-root-build.sh — silme ortamını üretir (RFC-0007 §13.2): vmlinuz, initrd, kok.squashfs.
#
# Taban: Ubuntu 24.04 (noble) paketlerinden kurulmuş küçük kök dosya sistemi. Çekirdek Ubuntu arşivindeki imzalı
# linux-image-generic'tir (Güvenli Önyükleme açık cihazda da açılır); initrd casper'ın kancalarıyla kökün içinde
# üretilir, kök açılışta tamamen RAM'e kopyalanır (çekirdek satırında `toram`). Ağ kapalıdır, takas yoktur. Paketler
# noble, noble-updates ve noble-security'den. Konsol yazı tipi Uni2 (QR'ın yarım blok karakterleri ve Türkçe harfler).
# İçinde: util-linux, nvme-cli, hdparm, sg3-utils, smartmontools, mmc-utils, cryptsetup, dmidecode, nftables ve
# havenfold-sil (paketteki Node + installer/erase + core/core + gereken node_modules).
#
# Yalnız Linux'ta; kök olarak çalışır (mmdebstrap root kipi: kök dosya sistemindeki sahiplikler ve 0600 çekirdek
# dosyası ancak böyle doğru kalır; unshare kipinde dizin çıktısı alt kimliklere ait olur ve squashfs'e yanlış sahiple
# girer). mmdebstrap ve squashfs-tools gerekir. Hiçbir diske yazmaz; yalnız geçici dizin ve --cikti.
#
#   sudo env PATH="$PATH" bash installer/build/erase-root-build.sh --surum 1.2.3 --node <paketteki node> --cikti erase-mode/ [--ayna URL]
set -euo pipefail

DEPO=$(cd "$(dirname "$0")/../.." && pwd)
hata () { echo "HATA: $*" >&2; exit 1; }
SURUM="" NODE_BIN="" CIKTI="" AYNA=http://archive.ubuntu.com/ubuntu
while [ $# -gt 0 ]; do
  case "$1" in
    --surum) SURUM=$2 ;; --node) NODE_BIN=$2 ;; --cikti) CIKTI=$2 ;; --ayna) AYNA=$2 ;; *) hata "bilinmeyen seçenek: $1" ;;
  esac
  shift 2
done
[ -n "$SURUM" ] && [ -n "$NODE_BIN" ] && [ -n "$CIKTI" ] || hata "--surum, --node ve --cikti gerekli"
[ "$(uname -s)" = Linux ] || hata "yalnız Linux'ta çalışır"
[ "$(id -u)" = 0 ] || hata "kök olarak çalışır (sudo env PATH=\"\$PATH\" bash $0 …)"
for a in mmdebstrap mksquashfs node; do command -v "$a" >/dev/null || hata "$a yok"; done
[ -d "$DEPO/node_modules/sodium-native" ] || hata "depoda node_modules yok: kökte 'npm ci'"

PAKETLER=linux-image-generic,casper,initramfs-tools,systemd-sysv,udev,kbd,console-setup,util-linux,nvme-cli,hdparm,sg3-utils,smartmontools,mmc-utils,cryptsetup,dmidecode,nftables,iproute2

IS=$(mktemp -d)
trap 'rm -rf "$IS"' EXIT
UYGULAMA=$IS/uygulama/opt/havenfold-sil

echo "== 1. havenfold-sil"
mkdir -p "$UYGULAMA/bin" "$UYGULAMA/installer/erase" "$UYGULAMA/core" "$UYGULAMA/node" "$UYGULAMA/node_modules" "$IS/uygulama/etc/havenfold" "$IS/uygulama/etc/systemd/system"
# Çalışma zamanı bin/node: node/ dizini kodundur (installer/erase/shell.js ../../node/qr.js ve qr-screen.js'i ister)
install -m 0755 "$NODE_BIN" "$UYGULAMA/bin/node"
install -m 0644 "$DEPO"/installer/erase/*.js "$UYGULAMA/installer/erase/"
install -m 0755 "$DEPO/installer/erase/havenfold-sil" "$UYGULAMA/installer/erase/havenfold-sil"
echo "$SURUM" > "$UYGULAMA/installer/erase/VERSION"
cp -a "$DEPO/core/core" "$UYGULAMA/core/core"
rm -rf "$UYGULAMA/core/core/test"
install -m 0644 "$DEPO/node/qr.js" "$DEPO/node/qr-screen.js" "$UYGULAMA/node/"
# Çalışma zamanı bağımlılıkları: b4a, compact-encoding, sodium-native ve geçişli bağımlılıkları (paket.json'lardan)
node -e '
const fs = require("fs"), path = require("path")
const kok = process.argv[1], gerek = ["b4a", "compact-encoding", "sodium-native"], gorulen = new Set()
while (gerek.length) {
  const p = gerek.pop()
  if (gorulen.has(p)) continue
  gorulen.add(p)
  const j = JSON.parse(fs.readFileSync(path.join(kok, "node_modules", p, "package.json"), "utf8"))
  gerek.push(...Object.keys(j.dependencies || {}))
}
console.log([...gorulen].sort().join("\n"))' "$DEPO" | while read -r p; do
  mkdir -p "$UYGULAMA/node_modules/$(dirname "$p")"
  cp -a "$DEPO/node_modules/$p" "$UYGULAMA/node_modules/$p"
done
install -m 0644 "$DEPO/installer/erase-mode/havenfold-sil.service" "$DEPO/installer/erase-mode/havenfold-ag-kapali.service" "$IS/uygulama/etc/systemd/system/"
install -m 0644 "$DEPO/installer/erase-mode/ag-kapali.nft" "$IS/uygulama/etc/havenfold/ag-kapali.nft"
echo "Havenfold silme ortamı $SURUM" > "$IS/uygulama/etc/havenfold-silme"

echo "== 2. Kök dosya sistemi (Ubuntu 24.04 paketleri)"
mmdebstrap --mode=root --variant=apt --components=main,universe --include="$PAKETLER" \
  --customize-hook="tar -C '$IS/uygulama' --owner=0 --group=0 -c . | tar -C \"\$1\" -x" \
  --customize-hook='chroot "$1" systemctl enable havenfold-sil.service havenfold-ag-kapali.service' \
  --customize-hook='chroot "$1" systemctl mask getty@tty1.service systemd-networkd.service systemd-resolved.service systemd-timesyncd.service' \
  --customize-hook='rm -f "$1"/etc/netplan/*.yaml; printf "XKBLAYOUT=\"tr\"\n" > "$1/etc/default/keyboard"' \
  --customize-hook='printf "ACTIVE_CONSOLES=\"/dev/tty[1-6]\"\nCHARMAP=\"UTF-8\"\nCODESET=\"Uni2\"\nFONTFACE=\"Fixed\"\nFONTSIZE=\"8x16\"\n" > "$1/etc/default/console-setup"' \
  --customize-hook='chroot "$1" sh -c "update-initramfs -u -k all || update-initramfs -c -k all"' \
  --customize-hook="cp \"\$1\"/boot/vmlinuz-* '$IS/vmlinuz'; cp \"\$1\"/boot/initrd.img-* '$IS/initrd'" \
  noble "$IS/kok" "$AYNA" "deb $AYNA noble-updates main universe" "deb $AYNA noble-security main universe"

echo "== 3. squashfs"
mkdir -p "$CIKTI"
mksquashfs "$IS/kok" "$CIKTI/kok.squashfs" -noappend -comp xz -e boot
install -m 0644 "$IS/vmlinuz" "$CIKTI/vmlinuz"
install -m 0644 "$IS/initrd" "$CIKTI/initrd"
ls -l "$CIKTI"
