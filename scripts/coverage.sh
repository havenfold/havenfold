#!/usr/bin/env bash
# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
# was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
# coverage.sh — çekirdeğin test kapsamı (D64): bütün paketlerin Node testleri c8 altında (çocuk süreçler dahil; Bare
# süreçleri kapsama girmez). Çıktı node_modules/.kapsam/ (git dışı); tablo ve eşik scripts/coverage-table.js.
set -uo pipefail
cd "$(dirname "$0")/.."
rm -rf node_modules/.kapsam node_modules/.kapsam-ham
hata=0
npx c8 --temp-directory "$PWD/node_modules/.kapsam-ham" --reports-dir node_modules/.kapsam --reporter json-summary --reporter json --all \
  --include 'core/**/*.js' --include 'sdk/*.js' --include 'worklet/*.js' --include 'node/**/*.js' --include 'services/**/*.js' \
  --exclude '**/test/**' --exclude '**/node_modules/**' --exclude 'core/core/scripts/**' --exclude 'worklet/scripts/**' --exclude 'worklet/example/**' \
  bash -c '
    h=0
    for p in core/*/ sdk/ node/ worklet/; do
      [ -f "$p/package.json" ] || continue
      (cd "$p" && npx brittle-node test/*.js > /dev/null 2>&1) || { echo "HATA: $p testleri"; h=1; }
    done
    for p in services/*/; do
      [ -f "$p/package.json" ] || continue
      (cd "$p" && ../../node_modules/.bin/brittle-node test/*.js > /dev/null 2>&1) || { echo "HATA: $p testleri"; h=1; }
    done
    exit $h' || hata=1
rm -rf node_modules/.kapsam-ham
[ "$hata" -eq 0 ] && node scripts/coverage-table.js "$@" || hata=1
exit $hata
