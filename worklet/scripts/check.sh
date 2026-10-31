#!/usr/bin/env bash
# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
# was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
# @havenfold/worklet denetimi: Node'a özel modül yok, testler Node'da ve Bare'de, paket Bare'de çalışıyor.
set -euo pipefail
cd "$(dirname "$0")/.."
# bare-pack Node 20'de çöküyor (inceleme 12 bulgu 10): önce sürüm
if ! node -e "process.exit(parseInt(process.versions.node) === 22 ? 0 : 1)" 2>/dev/null; then
  echo "HATA: Node 22 gerekir (bulunan: $(node -v 2>/dev/null || echo yok)). nvm use 22" >&2; exit 1
fi
[ -d ../node_modules ] || (cd .. && npm ci)
[ -d node_modules ] || npm ci
hata=0
adim () { printf '\n== %s\n' "$1"; }

adim "Paket dosyalarında Node'a özel modül yok (Bare uyumu; fs yalnız #fs ile, Node karşılığı fs-node.js)"
if grep -nE "require\\(['\"](node:)?(fs|path|crypto|net|tls|http|https|os|child_process|dgram|dns|worker_threads|stream|util|events)['\"]\\)" \
    $(ls *.js example/*.js | grep -v "^fs-node.js$"); then echo "HATA: Node'a özel modül"; hata=1; else echo "tamam"; fi

adim "Testler (Node)"
nice npx brittle-node test/*.js || hata=1

adim "Testler (Bare)"
BARE=$(node -e "process.stdout.write(require('bare-runtime')())")
chmod +x "$BARE"
mkdir -p node_modules/.hf-bin && ln -sf "$BARE" node_modules/.hf-bin/bare
# D59: telefondaki Bare sürümü (react-native-bare-kit 0.16.0)
if [ "$("$BARE" --version)" != "v1.33.4" ]; then echo "HATA: Bare sürümü $("$BARE" --version), beklenen v1.33.4 (worklet/package.json overrides)"; hata=1; fi
PATH="$PWD/node_modules/.hf-bin:$PATH" nice npx brittle-bare test/*.js || hata=1

adim "Paket Bare'de yükleniyor"
bash scripts/package-try.sh || hata=1

if [ "$hata" -ne 0 ]; then printf '\nKONTROL: KIRMIZI\n'; exit 1; fi
printf '\nKONTROL: YEŞİL\n'
