#!/usr/bin/env bash
# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
# was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
# test-iso.sh — YALNIZ CI: üretim ISO'sundan sanal makine denemesi için test ISO'su türetir. Üretim ISO'su ve depodaki
# grub.cfg ile user-data değişmez; burada kopyaları şöyle değişir:
#
#   grub.cfg   zaman aşımı 3 sn, varsayılan girdi "kur" (1) ya da "sil" (2), çekirdek satırına seri konsol
#   user-data  (yalnız kurulum) komutlar /hf-test/calistir ile sarılır: çıktı ve sorular ikinci seri kapıya (ttyS1)
#              gider, CI sürücüsü "SIL" onayını oradan yazar. late-commands'a test kancaları eklenir (geçici LUKS
#              parolasının günlük denetimi için kopyası, ilk açılışın ttyS1'e yönlenmesi, sonuç denetimi birimi);
#              error-commands kurulum günlüklerinin sonunu ttyS1'e yazar.
#   /hf-test/  bu dizindeki test betikleri
#
#   bash installer/test/vm/test-iso.sh --iso uretim.iso --kip kur|sil --cikti test.iso
set -euo pipefail

BURA=$(cd "$(dirname "$0")" && pwd)
hata () { echo "HATA: $*" >&2; exit 1; }
ISO="" KIP="" CIKTI=""
while [ $# -gt 0 ]; do
  case "$1" in --iso) ISO=$2 ;; --kip) KIP=$2 ;; --cikti) CIKTI=$2 ;; *) hata "bilinmeyen seçenek: $1" ;; esac
  shift 2
done
[ -f "$ISO" ] && [ -n "$CIKTI" ] || hata "--iso ve --cikti gerekli"
case "$KIP" in kur) VARSAYILAN=1 ;; sil) VARSAYILAN=2 ;; *) hata "--kip kur|sil" ;; esac

IS=$(mktemp -d)
trap 'rm -rf "$IS"' EXIT
xorriso -osirrox on -indev "$ISO" -extract /boot/grub/grub.cfg "$IS/grub.cfg" -extract /nocloud/user-data "$IS/user-data" 2>/dev/null
chmod u+w "$IS/grub.cfg" "$IS/user-data"

# Değişen her metin dosyada tam bir kez geçmeli: üretim dosyası değişirse test sessizce eskisini sınamasın
degistir () { # dosya eski yeni
  python3 -I -c '
import sys
yol, eski, yeni = sys.argv[1:4]
s = open(yol, encoding="utf-8").read()
if s.count(eski) != 1:
    sys.exit("HATA: %s: %d kez geçiyor: %s" % (yol, s.count(eski), eski))
open(yol, "w", encoding="utf-8").write(s.replace(eski, yeni))' "$1" "$2" "$3"
}

degistir "$IS/grub.cfg" 'set timeout=15' 'set timeout=3'
degistir "$IS/grub.cfg" 'set default=0' "set default=$VARSAYILAN"
degistir "$IS/grub.cfg" "'ds=nocloud;s=/cdrom/nocloud/' ---" "'ds=nocloud;s=/cdrom/nocloud/' console=ttyS0,115200 console=tty1 ---"
degistir "$IS/grub.cfg" 'ipv6.disable=1 ---' 'ipv6.disable=1 console=ttyS0,115200 console=tty1 ---'

if [ "$KIP" = kur ]; then
  U=$IS/user-data
  degistir "$U" '    - /cdrom/havenfold/bin/hf-on-kontrol' '    - /cdrom/hf-test/calistir /cdrom/havenfold/bin/hf-on-kontrol'
  degistir "$U" '    - /cdrom/havenfold/bin/hf-depolama-yaz' '    - /cdrom/hf-test/calistir /cdrom/havenfold/bin/hf-depolama-yaz'
  degistir "$U" '    - /cdrom/havenfold/bin/hf-hedefe-kur /target' '    - /cdrom/hf-test/calistir /cdrom/havenfold/bin/hf-hedefe-kur /target'
  degistir "$U" '    - /cdrom/havenfold/bin/hf-hedefe-kur --gunluk-temizle /target' '    - /cdrom/hf-test/calistir /cdrom/havenfold/bin/hf-hedefe-kur --gunluk-temizle /target'
  degistir "$U" '/hf-depolama-yaz
' '/hf-depolama-yaz
    - /cdrom/hf-test/calistir /cdrom/hf-test/autoinstall-goster
'
  # gecici-sakla günlük temizliğinden önce, hedefe-test-kur en sonda
  degistir "$U" '/hf-hedefe-kur /target
' '/hf-hedefe-kur /target
    - /cdrom/hf-test/calistir /cdrom/hf-test/gecici-sakla /target
'
  degistir "$U" '/hf-hedefe-kur --gunluk-temizle /target
' '/hf-hedefe-kur --gunluk-temizle /target
    - /cdrom/hf-test/calistir /cdrom/hf-test/hedefe-test-kur /target
'
  degistir "$U" '  shutdown: reboot' '  error-commands:
    - /cdrom/hf-test/calistir /cdrom/hf-test/hata-gunlugu
  shutdown: reboot'
fi

mkdir -p "$IS/hf-test"
for f in calistir autoinstall-goster gecici-sakla hedefe-test-kur hata-gunlugu hf-test-denetim; do install -m 0755 "$BURA/target/$f" "$IS/hf-test/$f"; done
install -m 0644 "$BURA/target/hf-test-denetim.service" "$IS/hf-test/"

echo "--- test grub.cfg"
cat "$IS/grub.cfg"
if [ "$KIP" = kur ]; then echo "--- test user-data"; cat "$IS/user-data"; fi

rm -f "$CIKTI"
MAP=(-map "$IS/grub.cfg" /boot/grub/grub.cfg -map "$IS/hf-test" /hf-test)
[ "$KIP" = kur ] && MAP+=(-map "$IS/user-data" /nocloud/user-data)
xorriso -indev "$ISO" -outdev "$CIKTI" "${MAP[@]}" -boot_image any replay 2>&1 | tail -n 5
cp "$IS/grub.cfg" "$(dirname "$CIKTI")/test-grub-$KIP.cfg"
[ "$KIP" = kur ] && cp "$IS/user-data" "$(dirname "$CIKTI")/test-user-data"
ls -l "$CIKTI"
