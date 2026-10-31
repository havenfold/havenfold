#!/usr/bin/env bash
# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
# was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
# erase-prepare.sh — YALNIZ CI: silme modu denemesinin iki sanal diskini hazırlar (driver.js --kip sil).
#
#   sil-nvme.img  2 GiB rastgele veri; diskin tamamı LUKS2 (silme önce yuvaları ve başlığı siler, RFC-0007 §13.4)
#   sil-sata.img  2 GiB rastgele veri; GPT, 100 MiB ESP ve içinde EFI/havenfold/emekli.bilet (test bileti, §13.2 adım 2)
#   ornek.json    silmeden önce rastgele konumlardaki blokların özetleri (erase-test.js ornek-denetle karşılaştırır)
#
#   bash installer/test/vm/erase-prepare.sh <is-dizini>
# Gerekenler: cryptsetup, sgdisk, mkfs.vfat, mtools (mmd, mcopy), Node ve depoda node_modules. LUKS için sudo.
set -euo pipefail
BURA=$(cd "$(dirname "$0")" && pwd)
IS=$(cd "${1:?iş dizini}" && pwd)
cd "$IS"
GiB=$((1024 * 1024 * 1024))
head -c "$((2 * GiB))" /dev/urandom > sil-nvme.img
head -c "$((2 * GiB))" /dev/urandom > sil-sata.img

( umask 077; head -c 32 /dev/urandom > luks.anahtar )
sudo cryptsetup luksFormat --type luks2 -q --pbkdf pbkdf2 --pbkdf-force-iterations 1000 --key-file luks.anahtar sil-nvme.img
shred -u luks.anahtar
sudo cryptsetup luksDump sil-nvme.img | sed -n '1,12p'

export MTOOLS_SKIP_CHECK=1
sgdisk -n 1:2048:+100M -t 1:EF00 -c 1:EFI sil-sata.img
mkfs.vfat -F 32 -n EFI --offset 2048 sil-sata.img $((100 * 1024))
node "$BURA/erase-test.js" bilet bilet.bin bilet.json
mmd -i sil-sata.img@@1048576 ::EFI ::EFI/havenfold
mcopy -i sil-sata.img@@1048576 bilet.bin ::EFI/havenfold/emekli.bilet
mdir -i sil-sata.img@@1048576 ::EFI/havenfold
sgdisk -p sil-sata.img

node "$BURA/erase-test.js" ornek-kaydet ornek.json "$IS/sil-nvme.img" "$IS/sil-sata.img"
