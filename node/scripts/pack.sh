#!/usr/bin/env bash
# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
# was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
# pack.sh — düğüm paketinin dizin düzeni (RFC-0007 §5). systemd birimlerinin ExecStart yolları bu düzene göredir:
#
#   <hedef>/node, <hedef>/bare        çalışma zamanları (/opt/havenfold/guncel/node, …/bare)
#   <hedef>/bin/havenfold             komut (havenfold-ekran.service; /usr/local/bin/havenfold bağı)
#   <hedef>/cekirdek/kutu.js, isci.js  çekirdeklerin girişleri (havenfold-kutu, havenfold-isci)
#   <hedef>/denetci/ana.js            denetçinin girişi (havenfold-denetci)
#   <hedef>/lib/                      kod: core, sdk, node, worklet, node_modules, package.json
#   <hedef>/yetki/                    kök yardımcı: ana.js, node, lib/ (kendi kopyası). Kurulum bu dizini olduğu gibi
#                                     /usr/lib/havenfold/yetki/'ye kopyalar; güncel sürüm onu değiştirmez (RFC-0026 b).
#   <hedef>/LICENSE, NOTICE, LICENSES/ Havenfold'un lisansları; LICENSES/node/, LICENSES/bare/ çalışma zamanlarının
#                                     lisans ve bildirim metinleri (ikililer dağıtılır: Node MIT, Bare Apache-2.0 §4)
#
# Kullanım: node/scripts/pack.sh <hedef> [--bagla]
#   --bagla  kod dizinleri ve çalışma zamanları için kopya yerine sembolik bağ (yalnız test ve geliştirme)
#   HF_NODE_BIN  paketlenecek Node ikilisi (varsayılan: PATH'teki node)
#   HF_BARE_BIN  paketlenecek Bare ikilisi (varsayılan: bare-runtime paketindeki; yoksa bare konmaz, uyarı)
#   Çalışma zamanının lisansı ikilinin yanında <ikili>.LICENSE (ve .NOTICE; runtime.sh böyle yazar) ya da resmî arşiv
#   ve npm paketi düzeninde bir üst dizinde LICENSE (ve NOTICE) aranır; bulunmazsa uyarı (sürüm derlemesi durur).
#
# Bu betik yalnız dizini kurar. Paketin kanonik ZIP'i, özeti ve imzalı bildirime girişi derleme hattının işidir
# (RFC-0007 §12.1; ZIP biçimi privilege-helper.js paket-ac). "Tek dosya" yardımcı derlemesi yok: yardımcı lib/
# kopyasıyla gelir.
set -euo pipefail

HEDEF=${1:?kullanım: pack.sh <hedef> [--bagla]}
BAGLA=0
[ "${2:-}" = "--bagla" ] && BAGLA=1
DEPO=$(cd "$(dirname "$0")/../.." && pwd)
PAKET="$DEPO/node/bundle"
KOD=(core sdk node worklet node_modules)

NODE_BIN=${HF_NODE_BIN:-$(command -v node)}
BARE_BIN=${HF_BARE_BIN:-$(cd "$DEPO" && node -e "try { process.stdout.write(require('bare-runtime')()) } catch {}" 2>/dev/null || true)}

[ -x "$NODE_BIN" ] || { echo "HATA: Node ikilisi yok (HF_NODE_BIN)" >&2; exit 1; }
[ -e "$HEDEF" ] && { echo "HATA: hedef zaten var: $HEDEF" >&2; exit 1; }

# Giriş dosyaları her zaman kopyalanır: göreli yolları (../lib) paketteki yerlerine göredir
yerlestir () { # kaynak hedef [kip]
  mkdir -p "$(dirname "$2")"
  install -m "${3:-0644}" "$1" "$2"
}

ikili () { # kaynak hedef: çalışma zamanı (--bagla'da bağ)
  mkdir -p "$(dirname "$2")"
  if [ "$BAGLA" = 1 ]; then ln -s "$1" "$2"; else install -m 0755 "$1" "$2"; fi
}

calisma_lisansi () { # ikili ad: lisans ve bildirim metinleri LICENSES/<ad>/'ye
  local d bulundu=0
  d=$(dirname "$1")
  for t in LICENSE NOTICE; do
    for f in "$1.$t" "$d/../$t"; do
      if [ -f "$f" ]; then yerlestir "$f" "$HEDEF/LICENSES/$2/$t"; [ "$t" = LICENSE ] && bulundu=1; break; fi
    done
  done
  [ "$bulundu" = 1 ] || echo "UYARI: $2 lisans metni yok ($1.LICENSE ya da ../LICENSE)" >&2
}

kod_kur () { # hedef dizin
  mkdir -p "$1"
  for d in "${KOD[@]}"; do
    [ -e "$DEPO/$d" ] || continue
    if [ "$BAGLA" = 1 ]; then ln -s "$DEPO/$d" "$1/$d"
    else rsync -a --exclude '.git' --exclude '.gecici' --exclude '.kapsam*' "$DEPO/$d/" "$1/$d/"; fi
  done
  yerlestir "$DEPO/package.json" "$1/package.json"
}

mkdir -p "$HEDEF"
ikili "$NODE_BIN" "$HEDEF/node"
if [ -n "$BARE_BIN" ] && [ -f "$BARE_BIN" ]; then ikili "$BARE_BIN" "$HEDEF/bare"
else echo "UYARI: Bare ikilisi yok; $HEDEF/bare konmadı (HF_BARE_BIN)" >&2; fi
yerlestir "$DEPO/LICENSE" "$HEDEF/LICENSE"
yerlestir "$DEPO/NOTICE" "$HEDEF/NOTICE"
for f in "$DEPO"/LICENSES/*; do yerlestir "$f" "$HEDEF/LICENSES/$(basename "$f")"; done
calisma_lisansi "$NODE_BIN" node
[ -n "$BARE_BIN" ] && [ -f "$BARE_BIN" ] && calisma_lisansi "$BARE_BIN" bare
yerlestir "$PAKET/bin/havenfold" "$HEDEF/bin/havenfold" 0755
yerlestir "$PAKET/cekirdek/kutu.js" "$HEDEF/cekirdek/kutu.js"
yerlestir "$PAKET/cekirdek/isci.js" "$HEDEF/cekirdek/isci.js"
yerlestir "$PAKET/denetci/ana.js" "$HEDEF/denetci/ana.js"
kod_kur "$HEDEF/lib"

yerlestir "$PAKET/yetki/ana.js" "$HEDEF/yetki/ana.js"
ikili "$NODE_BIN" "$HEDEF/yetki/node"
kod_kur "$HEDEF/yetki/lib"

[ "$BAGLA" = 1 ] || { chmod -R go-w "$HEDEF"; }
echo "paket düzeni: $HEDEF"
