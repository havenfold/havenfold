#!/usr/bin/env bash
# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
# was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
# Paketin Bare'de yüklendiğini dener: scripts/package-try.js bu makinenin Bare'i için (--preset yok, file: eklentiler)
# paketlenir ve çalıştırılır. Telefon paketi (scripts/pack.sh, --preset mobile) aynı modül grafiğini kullanır.
set -euo pipefail
cd "$(dirname "$0")/.."
GECICI=$(mktemp -d "${TMPDIR:-/tmp}/hf-paket.XXXXXX")
trap 'rm -rf "$GECICI"' EXIT
nice npx bare-pack --offload-addons --base .. --out "$GECICI/deneme.bundle" scripts/package-try.js
# --offload-addons eklentileri <çıktı>/node_modules'a yazar, paket ise <taban göreli>/worklet/node_modules'ta arar
ln -s . "$GECICI/worklet"
BARE=$(node -e "process.stdout.write(require('bare-runtime')())")
chmod +x "$BARE"
"$BARE" "$GECICI/deneme.bundle" "$GECICI/dizin"

# Telefon paketinde açık kip derleme anında kapalı (RFC-0027 §5 g, inceleme 13 bulgu 1): ios ve android koşulunda
# #mode mode-phone.js'e çözülür, mode-dev.js pakete girmez
nice npx bare-pack --preset mobile --base .. --out "$GECICI/telefon.bundle" example/ingress.js
if grep -aq '"#mode":"/worklet/mode-phone.js"' "$GECICI/telefon.bundle" && ! grep -aq '"/worklet/mode-dev.js"' "$GECICI/telefon.bundle"; then
  echo "TELEFON PAKETI: açık kip kapalı"
else
  echo "HATA: telefon paketinde açık kip açık" >&2; exit 1
fi

# Ürünün girişi başka klasördeyken scripts/pack.sh: @havenfold/* adlarının hepsi bu paketin kopyalarına çözülür
# (ürün depolarındaki kullanım; Codex 11. tur: eşleme eski paket adlarında kalmıştı). Ürün deposu gerçekte bu deponun
# yanında durur (ortak üst klasör taban olur, pakete ev klasörü yolu girmez); deneme de deponun yanında geçici bir klasörde.
URUN=$(mktemp -d "$(cd ../.. && pwd)/.hf-urun.XXXXXX")
trap 'rm -rf "$GECICI" "$URUN"' EXIT
mkdir -p "$GECICI/urun"
node -e "
  const adlar = Object.keys(require('./package.json').dependencies).filter((k) => k.startsWith('@havenfold/'))
  require('fs').writeFileSync(process.argv[1], adlar.map((a) => 'require(' + JSON.stringify(a) + ')').join('\n') + '\n')
" "$URUN/entry.js"
bash scripts/pack.sh "$URUN/entry.js" "$GECICI/urun/app.bundle.mjs" > "$GECICI/urun/paket.log" 2>&1 ||
  { cat "$GECICI/urun/paket.log" >&2; echo "HATA: ürün girişi paketlenemedi (scripts/pack.sh)" >&2; exit 1; }
echo "ÜRÜN PAKETİ: $(grep -c '^require' "$URUN/entry.js") @havenfold paketi çözüldü"
