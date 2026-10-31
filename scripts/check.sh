#!/usr/bin/env bash
# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
# was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
# Havenfold denetimi: bütün paketlerin testleri + vektör denetimi. Kayıttan önce yeşil olmalı.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ] && ! node -v 2>/dev/null | grep -q '^v22\.'; then
  . "${NVM_DIR:-$HOME/.nvm}/nvm.sh" >/dev/null && nvm use 22 >/dev/null
fi
# Yalnız CI'ın sınadığı Node 22 (24'te geri dönüş testi ve Bare paketleme düşüyor; Codex 9. tur)
if ! node -e "process.exit(parseInt(process.versions.node) === 22 ? 0 : 1)" 2>/dev/null; then
  echo "HATA: Node 22 gerekir (bulunan: $(node -v 2>/dev/null || echo yok)). nvm install 22 && nvm use 22" >&2; exit 1
fi
[ -d node_modules ] || npm ci

hata=0
adim () { printf '\n== %s\n' "$1"; }

# D75: önceki koşulardan kalan sahipsiz test süreçleri (ana süreci ölmüş device.js) DHT ve CPU yükü yaratır, taşıyıcı
# testleri zaman aşımına düşer. Kapatmaz, uyarır: ps ile görülür, `kill <pid>` ile kapatılır.
sahipsiz=$(ps -eo pid=,ppid=,args= 2>/dev/null | awk '$2 == 1 && /worklet\/test\/helpers\/device\.js/ {print $1}' | tr '\n' ' ')
if [ -n "${sahipsiz// /}" ]; then
  printf 'UYARI: %s sahipsiz test süreci var (ppid 1, worklet/test/helpers/device.js): %s\n       Taşıyıcı testleri yükten düşebilir; kapatmak için: kill %s\n' "$(echo $sahipsiz | wc -w)" "$sahipsiz" "$sahipsiz"
fi

adim "Çekirdek paketlerinde Node'a özel modül yok (Bare uyumu)"
# test/ dışındaki .js dosyaları fs, path, crypto, net … çekemez
if grep -rnE "require\\(['\"](node:)?(fs|path|crypto|net|tls|http|https|os|child_process|dgram|dns|worker_threads|stream|util|events)['\"]\\)" \
    --include='*.js' core/*/ sdk/ --exclude-dir=test --exclude-dir=scripts --exclude-dir=node_modules; then
  echo "HATA: çekirdek paketinde Node'a özel modül"; hata=1
else echo "tamam"; fi

adim "Vektör dosyaları geçerli JSON"
for f in $(find protocol/vectors core/*/test/vectors -name '*.json' 2>/dev/null); do
  node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))" "$f" || { echo "HATA: $f"; hata=1; }
done
echo "tamam"

adim "Yuva Hat'tan kopyalanan vektörler değişmemiş"
(cd core/core/test/vectors/yuva-hat && if command -v sha256sum >/dev/null; then sha256sum --quiet -c SHA256SUMS; else shasum -a 256 --quiet -c SHA256SUMS; fi) && echo "tamam" || { echo "HATA: yuva-hat vektörleri değişmiş"; hata=1; }

adim "Kaynak dosyalarda SPDX lisans başlığı, dizinin lisansıyla; MPL-2.0 dosyalarında Exhibit A (kurucu §17.1, §20.2; RFC-0033, RFC-0038)"
# || sonrasındaki grup set -e'den muaf değil: hata dalındaki boru hattı düşerse betik orada biterdi (Codex 12. tur)
node scripts/spdx.js | tail -1 | grep -q "SPDX TAMAM" || { node scripts/spdx.js | tail -20 || true; hata=1; }

adim "Üretim bağımlılıkları: izinli lisans, kilitte ve package.json'da sabit sürüm (D37)"
node scripts/license-check.js || hata=1

adim "Testler"
for p in core/*/ sdk/ tools/export-open/ node/; do
  [ -f "$p/package.json" ] || continue
  echo "-- $p"
  (cd "$p" && npx brittle-node test/*.js) || hata=1
done
# Kurulum aracı çalışma alanında değil (USB'de paketteki Node ile, bağımlılıksız çalışır); test aracı kökten
echo "-- installer/"
(cd installer && ../node_modules/.bin/brittle-node test/*.js) || hata=1
# Referans alıcı (RFC-0010 §13; AGPL) çalışma alanında değil, kökün node_modules'ünü kullanır
for p in services/*/; do
  [ -f "$p/package.json" ] || continue
  echo "-- $p"
  (cd "$p" && ../../node_modules/.bin/brittle-node test/*.js) || hata=1
done

adim "Testler Bare'de (telefonun ve düğümün çekirdek çalışma ortamı)"
# Bare ikilisi bare-runtime paketinden; npm aynı adlı iki bin bağlantısından birini düşürebildiği için PATH'e kendimiz koyarız
BARE_BIN=$(node -e "process.stdout.write(require('bare-runtime')())" 2>/dev/null || true)
if [ -n "$BARE_BIN" ] && [ -f "$BARE_BIN" ]; then
  chmod +x "$BARE_BIN"
  mkdir -p node_modules/.hf-bin && ln -sf "$BARE_BIN" node_modules/.hf-bin/bare
  export PATH="$PWD/node_modules/.hf-bin:$PATH"
  echo "bare $(bare --version)"
  # D59: testler telefondaki Bare sürümüyle (Yuva Defteri react-native-bare-kit 0.16.0, Air A32) koşar
  BEKLENEN_BARE="v1.33.4"
  if [ "$(bare --version)" != "$BEKLENEN_BARE" ]; then echo "HATA: Bare sürümü $(bare --version), beklenen $BEKLENEN_BARE (telefondaki sürüm; package.json overrides)"; hata=1; fi
  for p in core/*/ sdk/; do
    [ -f "$p/package.json" ] || continue
    echo "-- $p (bare)"
    (cd "$p" && npx brittle-bare test/*.js) || hata=1
  done
else
  echo "HATA: Bare ikilisi yok (npm ci)"; hata=1
fi

adim "Türetme etiketleri: hiçbiri başka bir etiketin öneki değil (RFC-0027 §8 d, D69)"
node scripts/label-check.js || hata=1

adim "SDK rehberinin üretilen tabloları ve örnekleri güncel (D42)"
node scripts/guide-gen.js --denetle || hata=1

adim "Vektörlerin bağımsız yeniden üretimi (D27; inceleme 13)"
vektor=$(node scripts/vector-check.js 2>&1) || true
if [[ "$vektor" == *"VEKTOR_DENETIMI TAMAM"* ]]; then echo "tamam"; else echo "$vektor" | tail -20; echo "HATA: vektör denetimi"; hata=1; fi

# Kapsam adımı worklet testlerini de koşar; temiz ağaçta worklet bağımlılıkları önce kurulur
[ -d worklet ] && [ ! -d worklet/node_modules ] && (cd worklet && npm ci --silent)
adim "Test kapsamı: kritik modüllerde dal ≥ %90 (D64; c8, Node koşusu; tablo kollar/D-olcum.md)"
node scripts/coverage-table.js --desenler || hata=1
kapsam=$(bash scripts/coverage.sh 2>&1) && echo "$kapsam" | tail -1 || { echo "$kapsam" | grep -E "eşik altı|HATA|KAPSAM" || true; hata=1; }

adim "Telefondaki çekirdek paketi (worklet: Node'a özel modül yok, Node ve Bare testleri, paket denemesi)"
# Worklet kök çalışma alanında değil, kendi package-lock.json'ı var (Air A2 İstek 1)
if [ -d worklet ]; then
  [ -d worklet/node_modules ] || (cd worklet && npm ci)
  bash worklet/scripts/check.sh || hata=1
fi

adim "Çözücülerin bulanık testi, kısa sürüm ve kalıcı örnekler (D50; tam koşu: node scripts/fuzz.js)"
node scripts/fuzz.js --ornekler || hata=1
node scripts/fuzz.js --kisa | tail -3 | grep -q "BULANIK TAMAM" || { echo "HATA: bulanık test"; hata=1; }
if command -v bare >/dev/null 2>&1; then
  bare scripts/fuzz.js --ornekler || hata=1
  bare scripts/fuzz.js --kisa | tail -3 | grep -q "BULANIK TAMAM" || { echo "HATA: bulanık test (Bare)"; hata=1; }
fi

if [ "$hata" -ne 0 ]; then printf '\nKONTROL: KIRMIZI\n'; exit 1; fi
printf '\nKONTROL: YEŞİL\n'
