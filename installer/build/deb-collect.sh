#!/usr/bin/env bash
# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
# was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
# deb-collect.sh — Kurulum USB'sinin çevrimdışı Ubuntu paketleri (RFC-0007 §8.1 /havenfold/deb/; bildirimin
# installerDebs listesi, release-build.js paket --deb-dizini).
#
# Kurulan sistemin tabanı Ubuntu ISO'sundaki ubuntu-server-minimal katmanıdır (curtin bu katmanı diske açar). Betik
# katmanı geçici bir dizine açar, içinde apt ile listedeki paketleri ve tabanda olmayan bağımlılıklarını yalnız indirir
# (--download-only, önerilenler yok). Böylece USB'deki .deb'ler kurulan sistemin eksiğini tam karşılar ve hf-hedefe-kur
# hepsini `dpkg -i` ile tek seferde kurabilir. Paketler Ubuntu arşivinden apt'nin kendi imza denetimiyle gelir.
#
# Yalnız Linux'ta, kök olarak (unsquashfs sahiplikleri ve chroot). Gerekenler: xorriso, unsquashfs (squashfs-tools).
# Hiçbir diske yazmaz; yalnız geçici dizin ve --cikti.
#
#   sudo bash installer/build/deb-collect.sh --iso ubuntu-24.04.x-live-server-amd64.iso --cikti deb/ [--ayna URL]
set -euo pipefail

hata () { echo "HATA: $*" >&2; exit 1; }
# RFC-0007 §8.1
PAKETLER=(podman uidmap slirp4netns clevis clevis-luks clevis-tpm2 clevis-initramfs tpm2-tools smartmontools nvme-cli
  nftables wpasupplicant)
ISO="" CIKTI="" AYNA=http://archive.ubuntu.com/ubuntu
while [ $# -gt 0 ]; do
  case "$1" in
    --iso) ISO=$2 ;; --cikti) CIKTI=$2 ;; --ayna) AYNA=$2 ;; *) hata "bilinmeyen seçenek: $1" ;;
  esac
  shift 2
done
[ -n "$ISO" ] && [ -n "$CIKTI" ] || hata "--iso ve --cikti gerekli"
[ "$(uname -s)" = Linux ] || hata "yalnız Linux'ta çalışır"
[ "$(id -u)" = 0 ] || hata "kök olarak çalışır (chroot)"
for a in xorriso unsquashfs chroot; do command -v "$a" >/dev/null || hata "$a yok"; done
[ -f "$ISO" ] || hata "ISO yok: $ISO"

IS=$(mktemp -d)
K=$IS/kok
temizle () {
  umount "$K/proc" 2>/dev/null || true
  rm -rf "$IS"
}
trap temizle EXIT

echo "== 1. Tabanın katmanı: casper/ubuntu-server-minimal.squashfs"
xorriso -osirrox on -indev "$ISO" -extract /casper/ubuntu-server-minimal.squashfs "$IS/taban.squashfs" 2>/dev/null
unsquashfs -q -d "$K" "$IS/taban.squashfs"
rm -f "$IS/taban.squashfs"

echo "== 2. apt (noble, noble-updates, noble-security)"
rm -f "$K/etc/resolv.conf"
cp -L /etc/resolv.conf "$K/etc/resolv.conf"
rm -f "$K"/etc/apt/sources.list.d/*
: > "$K/etc/apt/sources.list"
cat > "$K/etc/apt/sources.list.d/ubuntu.sources" <<EOF
Types: deb
URIs: $AYNA
Suites: noble noble-updates noble-security
Components: main restricted universe
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
EOF
mount -t proc proc "$K/proc"
mkdir -p "$K/var/cache/hf-deb/partial"
chroot "$K" apt-get -q update
chroot "$K" env DEBIAN_FRONTEND=noninteractive apt-get -q -y --download-only --no-install-recommends \
  -o Dir::Cache::archives=/var/cache/hf-deb install "${PAKETLER[@]}"

echo "== 3. Paketler"
mkdir -p "$CIKTI"
n=0
for f in "$K"/var/cache/hf-deb/*.deb; do
  [ -e "$f" ] || continue
  install -m 0644 "$f" "$CIKTI/"
  n=$((n + 1))
done
[ "$n" -gt 0 ] || hata "hiç paket indirilmedi"
ls -1 "$CIKTI"
echo "tamam: $n paket ($(du -sh "$CIKTI" | cut -f1))"
