#!/usr/bin/env bash
# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
# was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
# havenfold-install-sudo.sh — Bu makineyi Havenfold Aile Kutusu yapar (D76; RFC-0007 §8.6 "Var olan Ubuntu").
#
# Çalıştırma:  sudo bash ~/havenfold-install-sudo.sh
#
# Ne yapar (her adım yeniden çalıştırılabilir; ikinci çalıştırma yalnız yazılımı günceller ve servisi yeniden başlatır):
#   1. tpm2-tools paketini kurar (kutu paylarını ve durum anahtarını TPM 2.0'a mühürler).
#   2. Sistem kullanıcılarını ve gruplarını oluşturur (/usr/lib/sysusers.d/havenfold.conf, systemd-sysusers).
#   3. Dizinleri izinleriyle oluşturur (/usr/lib/tmpfiles.d/havenfold.conf, systemd-tmpfiles):
#      /var/lib/havenfold/kutu (0700, havenfold-kutu), /run/havenfold/kutu (0750, grup havenfold-yonetim).
#   4. Yazılımı depodan /opt/havenfold/surumler/<kayıt> altına kopyalar (Node 22 dahil, salt okunur, sahibi root) ve
#      /opt/havenfold/guncel bağını ona çevirir.
#   5. /usr/local/bin/havenfold komutunu kurar; yönetici kullanıcıyı havenfold-yonetim grubuna ekler
#      (havenfold durum ve havenfold katil için; etkisi için oturumu kapatıp açın ya da `newgrp havenfold-yonetim`).
#   6. havenfold-kutu.service birimini kurar, açılışta başlayacak şekilde etkinleştirir ve (yeniden) başlatır.
#   Ayrıca (D91) kutunun afet modu için D-Bus izin kuralını kurar (/usr/share/dbus-1/system.d/havenfold.conf: kutu
#   kullanıcısı yalnız org.bluez'e çağrı). Bluetooth'u açmaz: afet modu /etc/havenfold/dugum.toml `afet = "acik"` ile
#   açılır; BlueZ ayrıca kurulur (apt install bluez; systemctl enable --now bluetooth).
#
# Dokunmadıkları: SSH, var olan servisler, ağ ayarları, güvenlik duvarı, disk ve bölümler. Disk şifresiz olduğu için
# kutu "disk: sifresiz" bildirir (RFC-0007 §8.6). Kaldırmak için en altta.
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "HATA: sudo ile çalıştırın: sudo bash $0" >&2; exit 1; }

# Yönetici: sudo'yu çağıran kullanıcı. Depo: betik depodan çalışıyorsa o depo, değilse yöneticinin ~/projeler/havenfold'u
# (ajan makinelerindeki düzen, kurucu §18.2). Üçü de ortam değişkeniyle verilebilir.
YONETICI=${HAVENFOLD_YONETICI:-${SUDO_USER:-}}
[ -n "$YONETICI" ] || { echo "HATA: yönetici kullanıcı bulunamadı (sudo ile çalıştırın ya da HAVENFOLD_YONETICI verin)" >&2; exit 1; }
YONETICI_EV=$(getent passwd "$YONETICI" | cut -d: -f6)
BETIK_DEPO=$(cd "$(dirname "$0")/../.." 2>/dev/null && pwd)
if [ -z "${HAVENFOLD_KAYNAK:-}" ] && [ -f "$BETIK_DEPO/node/box.js" ]; then KAYNAK=$BETIK_DEPO; else KAYNAK=${HAVENFOLD_KAYNAK:-$YONETICI_EV/projeler/havenfold}; fi
# Node 22: HAVENFOLD_NODE, yoksa yöneticinin nvm'deki v22'si, yoksa PATH'teki node (sürümü 22 ise; 24 desteklenmiyor)
NODE_BIN=${HAVENFOLD_NODE:-$( (ls -d "$YONETICI_EV"/.nvm/versions/node/v22*/bin/node 2>/dev/null || true) | sort -V | tail -1)}
if [ -z "$NODE_BIN" ] && command -v node >/dev/null && [ "$(node -p 'process.versions.node.split(".")[0]')" -eq 22 ]; then
  NODE_BIN=$(readlink -f "$(command -v node)")
fi
adim () { printf '\n== %s\n' "$1"; }

[ -f "$KAYNAK/node/box.js" ] || { echo "HATA: depo bulunamadı: $KAYNAK" >&2; exit 1; }
[ -x "${NODE_BIN:-}" ] || { echo "HATA: Node 22 bulunamadı (HAVENFOLD_NODE=/yol/node ile verin)" >&2; exit 1; }
[ -e /dev/tpmrm0 ] || { echo "HATA: /dev/tpmrm0 yok: TPM 2.0 gerekir" >&2; exit 1; }
KAYIT=$(git -c safe.directory="$KAYNAK" -C "$KAYNAK" rev-parse --short HEAD)

adim "1. tpm2-tools"
if command -v tpm2_createprimary >/dev/null; then echo "kurulu"; else DEBIAN_FRONTEND=noninteractive apt-get install -y tpm2-tools; fi

adim "2. Sistem kullanıcıları ve grupları"
install -m 0644 "$KAYNAK/node/deploy/sysusers.conf" /usr/lib/sysusers.d/havenfold.conf
systemd-sysusers /usr/lib/sysusers.d/havenfold.conf
id havenfold-kutu

adim "3. Dizinler"
install -m 0644 "$KAYNAK/node/deploy/tmpfiles.conf" /usr/lib/tmpfiles.d/havenfold.conf
systemd-tmpfiles --create /usr/lib/tmpfiles.d/havenfold.conf
ls -ld /var/lib/havenfold/kutu /run/havenfold/kutu

adim "4. Yazılım: /opt/havenfold/surumler/$KAYIT"
HEDEF=/opt/havenfold/surumler/$KAYIT
mkdir -p "$HEDEF/bin"
for d in core sdk node worklet node_modules; do
  rsync -a --delete --exclude '.git' --exclude '.gecici' --exclude '.kapsam*' "$KAYNAK/$d/" "$HEDEF/$d/"
done
install -m 0644 "$KAYNAK/package.json" "$HEDEF/package.json"
install -m 0755 "$NODE_BIN" "$HEDEF/bin/node"
chown -R root:root "$HEDEF"
chmod -R go-w "$HEDEF"
ln -sfn "$HEDEF" /opt/havenfold/guncel
echo "guncel → $(readlink /opt/havenfold/guncel) · node $("$HEDEF/bin/node" -v)"

adim "5. havenfold komutu ve yönetim grubu"
cat > /usr/local/bin/havenfold <<'KOMUT'
#!/bin/sh
exec /opt/havenfold/guncel/bin/node /opt/havenfold/guncel/node/bin/havenfold "$@"
KOMUT
chmod 0755 /usr/local/bin/havenfold
usermod -aG havenfold-yonetim "$YONETICI"
id "$YONETICI"

adim "6. havenfold-kutu.service"
install -m 0644 "$KAYNAK/node/deploy/havenfold-dbus.conf" /usr/share/dbus-1/system.d/havenfold.conf
install -m 0644 "$KAYNAK/node/deploy/havenfold-kutu-ubuntu.service" /etc/systemd/system/havenfold-kutu.service
systemctl daemon-reload
systemctl enable havenfold-kutu.service
systemctl restart havenfold-kutu.service
sleep 3
systemctl --no-pager --lines=5 status havenfold-kutu.service || true

printf '\nTamam. Tören için (yönetim grubuna girdikten sonra): havenfold katil --rol kutu\nDurum: havenfold durum · günlük: journalctl -u havenfold-kutu -f\n'

# Kaldırmak (veriyi de siler; kutu payları ve emanet gider):
#   systemctl disable --now havenfold-kutu.service; rm /etc/systemd/system/havenfold-kutu.service /usr/local/bin/havenfold
#   rm -rf /opt/havenfold /var/lib/havenfold /run/havenfold; rm /usr/lib/sysusers.d/havenfold.conf /usr/lib/tmpfiles.d/havenfold.conf
#   rm /usr/share/dbus-1/system.d/havenfold.conf
