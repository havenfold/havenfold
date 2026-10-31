#!/usr/bin/env bash
# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
# was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
# Ürünün worklet giriş dosyasından telefon paketi: bare-pack 2.2.5, --preset mobile, tek app.bundle.mjs.
#   scripts/pack.sh <giriş> <çıktı> [taban]
# taban verilmezse girişin ve bu deponun ortak üst klasörü kullanılır: pakette makinenin mutlak yolu (kullanıcı adı)
# geçmez. Eklentiler (sodium-native, bare-fs …) "linked:" olarak kalır; uygulama bunları bare-link ile kendisi bağlar
# (Yuva Hat'taki worklet düzeni). Çıktıda aynı eklentinin iki sürümü varsa paketleme düşer.
set -euo pipefail
[ $# -ge 2 ] || { echo "kullanım: $0 <giriş> <çıktı> [taban]" >&2; exit 2; }
cd "$(dirname "$0")/.."
PAKET="$PWD"
GIRIS=$(node -e "process.stdout.write(require('fs').realpathSync(process.argv[1]))" "$OLDPWD/$1" 2>/dev/null || node -e "process.stdout.write(require('fs').realpathSync(process.argv[1]))" "$1")
case "$2" in /*) CIKTI="$2" ;; *) CIKTI="$OLDPWD/$2" ;; esac
if [ $# -ge 3 ]; then
  TABAN="$3"
else
  TABAN=$(node -e "
    const p = require('path')
    const a = process.argv[1].split(p.sep), b = p.resolve(process.argv[2], '..').split(p.sep)
    let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++
    process.stdout.write(a.slice(0, i).join(p.sep) || p.sep)" "$GIRIS" "$PAKET")
fi
[ -d node_modules/bare-pack ] || npm ci
mkdir -p "$(dirname "$CIKTI")"

# İçe aktarma haritası (olay kataloğu artık @havenfold/core'un içinde, D29; paket dışına uzanan yol yok):
# - Ürünün girişi başka depodaysa @havenfold/* adları bu paketin kopyalarına çözülür; böylece b4a, sodium-native ve
#   bare-fs pakette tek kopyadır. Adlar worklet/package.json'ın bağımlılıklarından okunur (elle liste ad değişikliğinde
#   eskide kalmıştı; Codex 11. tur).
HARITA=$(mktemp "${TMPDIR:-/tmp}/hf-harita.XXXXXX")
trap 'rm -f "$HARITA"' EXIT
node -e "
  const p = require('path'), url = require('url')
  const [paket] = process.argv.slice(1)
  const u = (f) => url.pathToFileURL(f).href
  const m = { '@havenfold/worklet': u(p.join(paket, 'index.js')) }
  const adlar = Object.keys(require(p.join(paket, 'package.json')).dependencies).filter((k) => k.startsWith('@havenfold/'))
  for (const ad of adlar) m[ad] = u(p.join(paket, 'node_modules', ad, 'index.js'))
  require('fs').writeFileSync(process.argv[2], JSON.stringify(m, null, 2))
" "$PAKET" "$HARITA"
mv "$HARITA" "$HARITA.json"; HARITA="$HARITA.json"; trap 'rm -f "$HARITA"' EXIT
nice npx bare-pack --preset mobile --base "$TABAN" --imports "$HARITA" --out "$CIKTI" "$GIRIS"

# Denetim: aynı eklentinin birden çok sürümü ya da kopyası olmasın; pakette makinenin ev klasörü geçmesin
node -e "
  const fs = require('fs')
  const metin = fs.readFileSync(process.argv[1], 'latin1')
  const eklentiler = [...new Set(metin.match(/linked:[A-Za-z0-9@._\/-]+/g) || [])].sort()
  const ad = (s) => s.replace(/^linked:/, '').replace(/\.(\d+\.){2}\d+.*$/, '').replace(/[.-]\d+\.\d+\.\d+.*/, '')
  const say = {}
  for (const e of eklentiler) (say[ad(e)] = say[ad(e)] || []).push(e)
  const cift = Object.entries(say).filter(([, v]) => v.length > 1)
  console.log('eklentiler:', eklentiler.join(' ') || '(yok)')
  if (cift.length) { console.error('HATA: aynı eklentinin birden çok sürümü:', JSON.stringify(cift)); process.exit(1) }
  const ev = require('os').homedir()
  if (metin.includes(ev)) { console.error('HATA: pakette ev klasörü yolu geçiyor:', ev); process.exit(1) }
  console.log('paket:', process.argv[1], fs.statSync(process.argv[1]).size, 'bayt')
" "$CIKTI"
