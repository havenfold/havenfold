#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# source-archive.sh — görev imajındaki GPL, LGPL ve AGPL paketlerin tam kaynağını tek arşive toplar
# (GPLv3 §6, AGPL-3.0 §6; kurucu §17.1; RFC-0002 §12; RFC-0007 §12.1 sourceArchive).
#
# Kullanım: images/source-archive.sh <imaj> <çıktı-dizini> [--hepsi]
#   <imaj>      derlenmiş imaj (ör. localhost/hf-task-ocr:1.0.0); etiketlerinden tür, sürüm ve Ubuntu anlık görüntüsü
#               okunur (org.havenfold.task.type, org.havenfold.task.version, org.havenfold.ubuntu-snapshot)
#   --hepsi     lisansına bakmadan kurulu her paketin kaynağı
#   HF_KONTEYNER  podman (varsayılan) ya da docker
#
# Ne yapar:
#   1. İmajın içinde kurulu paket listesini alır (dpkg-query): ikili paket, sürüm, kaynak paket, kaynak sürüm.
#   2. Her paketin /usr/share/doc/<paket>/copyright dosyasında GPL (GPL, LGPL, AGPL) ya da MPL geçiyorsa ya da dosya yoksa
#      kaynağını seçer. Şüphede dahil eder: eksik kaynak yükümlülüğü bozar, fazlası bozmaz.
#   3. Seçilen her kaynak paketi, imajın derlendiği AYNI anlık görüntüden ve AYNI sürümle indirir
#      (apt-get source --download-only: .dsc, orig ve debian tar'ları; Ubuntu'nun kendi değiştirmeleri dahil).
#   4. Bu dizindeki imaj tarifini (Containerfile, giriş betiği) de ekler ve hepsini
#      <tür>-<sürüm>-kaynak.tar olarak yazar; yanına SHA256SUMS.
#
# Arşiv imajla aynı yerde, aynı sürüm etiketiyle yayımlanır (GPLv3 §6 d: aynı yerden eşdeğer erişim). Bu betik
# yalnız ağ erişimi olan derleme makinesinde çalışır; düğümde çalışmaz.
set -euo pipefail

IMAJ=${1:?kullanım: source-archive.sh <imaj> <çıktı-dizini> [--hepsi]}
CIKTI=${2:?kullanım: source-archive.sh <imaj> <çıktı-dizini> [--hepsi]}
HEPSI=0
[ "${3:-}" = "--hepsi" ] && HEPSI=1
KONT=${HF_KONTEYNER:-podman}
BURASI=$(cd "$(dirname "$0")" && pwd)

command -v "$KONT" >/dev/null || { echo "HATA: $KONT yok" >&2; exit 1; }

etiket () { "$KONT" image inspect --format "{{ index .Config.Labels \"$1\" }}" "$IMAJ"; }
TUR=$(etiket org.havenfold.task.type)
SURUM=$(etiket org.havenfold.task.version)
SNAP=$(etiket org.havenfold.ubuntu-snapshot)
[[ "$TUR" =~ ^[a-z][a-z0-9.-]*$ ]] || { echo "HATA: imajda org.havenfold.task.type etiketi yok" >&2; exit 1; }
[[ "$SURUM" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "HATA: imajda org.havenfold.task.version etiketi yok" >&2; exit 1; }
[[ "$SNAP" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || { echo "HATA: imajda org.havenfold.ubuntu-snapshot etiketi yok" >&2; exit 1; }

# Tür adından imaj dizini: hf.task.ocr → task-ocr
DIZIN="$BURASI/task-${TUR#hf.task.}"
[ -f "$DIZIN/Containerfile" ] || { echo "HATA: imaj tarifi yok: $DIZIN" >&2; exit 1; }

mkdir -p "$CIKTI"
CIKTI=$(cd "$CIKTI" && pwd) # bağlama yolu mutlak olmalı
AD="${TUR}-${SURUM}-kaynak"
IS="$CIKTI/$AD"
mkdir -p "$IS/kaynak"
[ -z "$(ls -A "$IS/kaynak")" ] || { echo "HATA: $IS/kaynak boş değil" >&2; exit 1; }

# İmajın kendi içinde (kök, ağ açık, yazılabilir kopya): deb-src aynı anlık görüntüden
read -r -d '' IC <<'IC_BETIK' || true
set -euo pipefail
cd /kaynak
dpkg-query -W -f='${binary:Package}\t${Version}\t${source:Package}\t${source:Version}\n' | sort > /kaynak-liste/paketler.tsv
: > /kaynak-liste/KAYNAKLAR.txt
while IFS=$'\t' read -r ikili surum kaynak ksurum; do
  doc="/usr/share/doc/${ikili%%:*}/copyright"
  if [ "$HEPSI" = 1 ]; then neden=hepsi
  elif [ ! -f "$doc" ]; then neden=copyright-yok
  elif grep -qiE 'GPL|General Public License' "$doc"; then neden=gpl # tam adla yazılmış LGPL/GPL de (Codex 12. tur)
  elif grep -q 'MPL' "$doc"; then neden=mpl # MPL-2.0 §3.2 a: çalıştırılabilir biçimle kaynak da verilir
  else continue; fi
  printf '%s\t%s\t%s\n' "$kaynak" "$ksurum" "$neden"
done < /kaynak-liste/paketler.tsv | sort -u -k1,2 > /kaynak-liste/secilen.tsv
# deb-src satırları (deb822 biçimi, Ubuntu 24.04)
sed -i 's/^Types: deb$/Types: deb deb-src/' /etc/apt/sources.list.d/ubuntu.sources
apt-get -o APT::Snapshot="$SNAP" update >/dev/null
hata=0
while IFS=$'\t' read -r kaynak ksurum neden; do
  if apt-get -o APT::Snapshot="$SNAP" source --download-only "${kaynak}=${ksurum}" >/dev/null 2>&1; then
    printf '%s\t%s\t%s\n' "$kaynak" "$ksurum" "$neden" >> /kaynak-liste/KAYNAKLAR.txt
  else
    printf 'EKSIK\t%s\t%s\n' "$kaynak" "$ksurum" >> /kaynak-liste/KAYNAKLAR.txt
    hata=1
  fi
done < /kaynak-liste/secilen.tsv
exit "$hata"
IC_BETIK

echo "== $IMAJ · $TUR $SURUM · anlık görüntü $SNAP"
kod=0
"$KONT" run --rm --user 0 --entrypoint /bin/bash \
  -e SNAP="$SNAP" -e HEPSI="$HEPSI" \
  -v "$IS/kaynak:/kaynak:rw" -v "$IS:/kaynak-liste:rw" \
  "$IMAJ" -c "$IC" || kod=$?

if [ "$kod" -ne 0 ]; then
  echo "HATA: bazı kaynak paketler indirilemedi:" >&2
  grep '^EKSIK' "$IS/KAYNAKLAR.txt" >&2 || true
  exit 1
fi

mkdir -p "$IS/imaj"
cp -R "$DIZIN/." "$IS/imaj/"
cp "$BURASI/source-archive.sh" "$IS/imaj/"
rm -f "$IS/secilen.tsv"

tar -C "$CIKTI" -cf "$CIKTI/$AD.tar" "$AD"
(cd "$CIKTI" && { command -v sha256sum >/dev/null && sha256sum "$AD.tar" || shasum -a 256 "$AD.tar"; } > "$AD.tar.SHA256SUMS")
echo "== $(wc -l < "$IS/KAYNAKLAR.txt") kaynak paket · $CIKTI/$AD.tar"
