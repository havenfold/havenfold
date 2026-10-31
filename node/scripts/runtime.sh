#!/usr/bin/env bash
# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
# was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
# runtime.sh — düğüm paketinin çalışma zamanları (RFC-0007 §5; RFC-0033 §9 c): resmî Node 22 linux ikilisi ve
# Bare. Mimari derleme makinesinden bağımsızdır: amd64 makinede arm64 paketi de hazırlanır (node_modules mimariden
# bağımsız; yerel eklentiler bütün platformların hazır ikilileriyle gelir).
#
# Kullanım: node/scripts/runtime.sh <amd64|arm64> <çıktı-dizini>
#   HF_NODE_SURUM  Node sürümü (varsayılan aşağıda; Node 22 LTS'in son güvenlik sürümü)
#
# Node: nodejs.org/dist/v<sürüm>/node-v<sürüm>-linux-<x64|arm64>.tar.xz, aynı yerdeki SHASUMS256.txt ile denetlenir.
# Bare: bare-runtime-linux-<x64|arm64>, sürümü ve sha512 bütünlüğü depo kökündeki package-lock.json'dan (npm'in
# kurduğu bare-runtime ile aynı sürüm). Çıktı: <çıktı-dizini>/node, <çıktı-dizini>/bare (0755) ve yanlarında arşivlerdeki
# lisans metinleri node.LICENSE, bare.LICENSE, bare.NOTICE (pack.sh pakete LICENSES/ altına koyar). Yalnız Linux'ta.
set -euo pipefail

ARCH=${1:?kullanım: runtime.sh <amd64|arm64> <çıktı-dizini>}
CIKTI=${2:?kullanım: runtime.sh <amd64|arm64> <çıktı-dizini>}
NODE_SURUM=${HF_NODE_SURUM:-22.23.4}
DEPO=$(cd "$(dirname "$0")/../.." && pwd)
case "$ARCH" in
  amd64) N=x64 ;;
  arm64) N=arm64 ;;
  *) echo "HATA: mimari amd64 ya da arm64" >&2; exit 1 ;;
esac
[[ "$NODE_SURUM" =~ ^22\.[0-9]+\.[0-9]+$ ]] || { echo "HATA: Node 22 sürümü bekleniyor: $NODE_SURUM" >&2; exit 1; }
for a in curl sha256sum openssl tar node; do command -v "$a" >/dev/null || { echo "HATA: $a yok" >&2; exit 1; }; done

T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
mkdir -p "$CIKTI"

echo "== Node $NODE_SURUM linux-$N"
AD="node-v$NODE_SURUM-linux-$N.tar.xz"
curl -fsSL --retry 3 -o "$T/SHASUMS256.txt" "https://nodejs.org/dist/v$NODE_SURUM/SHASUMS256.txt"
curl -fsSL --retry 3 -o "$T/$AD" "https://nodejs.org/dist/v$NODE_SURUM/$AD"
grep -E "^[0-9a-f]{64}  $AD\$" "$T/SHASUMS256.txt" > "$T/beklenen" || { echo "HATA: SHASUMS256.txt'de $AD yok" >&2; exit 1; }
(cd "$T" && sha256sum -c beklenen)
tar -xJf "$T/$AD" -C "$T" "node-v$NODE_SURUM-linux-$N/bin/node" "node-v$NODE_SURUM-linux-$N/LICENSE"
install -m 0755 "$T/node-v$NODE_SURUM-linux-$N/bin/node" "$CIKTI/node"
install -m 0644 "$T/node-v$NODE_SURUM-linux-$N/LICENSE" "$CIKTI/node.LICENSE"

echo "== Bare (bare-runtime-linux-$N, package-lock.json)"
read -r BSURUM BUTUNLUK ADRES < <(node -e '
  const l = require(process.argv[1]).packages["node_modules/bare-runtime-linux-" + process.argv[2]]
  if (!l || !/^sha512-/.test(l.integrity)) process.exit(1)
  console.log(l.version, l.integrity, l.resolved)' "$DEPO/package-lock.json" "$N") || { echo "HATA: kilitte bare-runtime-linux-$N yok" >&2; exit 1; }
curl -fsSL --retry 3 -o "$T/bare.tgz" "$ADRES"
GERCEK="sha512-$(openssl dgst -sha512 -binary "$T/bare.tgz" | openssl base64 -A)"
[ "$GERCEK" = "$BUTUNLUK" ] || { echo "HATA: bare-runtime-linux-$N bütünlüğü kilitle uyuşmuyor" >&2; exit 1; }
tar -xzf "$T/bare.tgz" -C "$T" package/bin/bare package/LICENSE package/NOTICE
install -m 0755 "$T/package/bin/bare" "$CIKTI/bare"
install -m 0644 "$T/package/LICENSE" "$CIKTI/bare.LICENSE"
install -m 0644 "$T/package/NOTICE" "$CIKTI/bare.NOTICE"
echo "tamam: $CIKTI/node (Node $NODE_SURUM), $CIKTI/bare (Bare $BSURUM), linux-$N"
