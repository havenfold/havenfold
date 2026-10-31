// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// coverage-table.js — c8 özetinden (node_modules/.kapsam/coverage-summary.json) kritik modüllerin kapsam tablosu ve eşik (D64).
// node scripts/coverage-table.js [--esik 90] [--tumu] [--ozet <coverage-summary.json>]   node scripts/coverage-table.js --desenler
// Kritik modüller: core/vault, core/export, core/core/protocol, worklet/persistence.js, worklet/ipc.js, sdk/vault.js, sdk/team.js,
// core/ai/embedding.js, core/services, sdk/service.js, services/receiver/receiver.js, core/edge, sdk/edge.js. Kritik modülde dal
// kapsamı eşiğin altındaysa ya da bir kritik kalıp özetteki hiçbir dosyayla eşleşmiyorsa (yeniden adlandırma, yüklenmeyen
// modül; Codex 12. tur) çıkış kodu 1.
'use strict'
const fs = require('fs')
const path = require('path')
const kok = path.join(__dirname, '..')
const argv = process.argv.slice(2)
const ESIK = argv.includes('--esik') ? Number(argv[argv.indexOf('--esik') + 1]) : 90
const TUMU = argv.includes('--tumu')
// Bare'e özel ince katman: Node'da hiç yüklenmez (Node koşusu node:crypto kullanır), Bare koşusunda c8 yok.
const DISARIDA = new Set(['core/vault/bare-crypto/index.js'])
// Geçerli girdiyle erişilemeyen dallar (D64 incelemesi; kaynak değişmez). Eşik, bunlar düşülerek hesaplanır; tabloda
// ham yüzde de görünür. Kaynak değişip dal erişilir olursa sayı kendiliğinden fazla düşmesin diye kapsananı aşmaz.
const ERISILEMEZ = {
  'core/core/protocol/messages.js': [3, 'dbaPub/dbaSig `|| EMPTY` (compact-encoding buffer.decode hiç null dönmez), decodeFrame yeniden kodlama catch']
}
const KRITIK = [/^core\/vault\/[^/]+\.js$/, /^core\/export\/[^/]+\.js$/, /^core\/core\/protocol\/[^/]+\.js$/,
  /^worklet\/persistence\.js$/, /^worklet\/ipc\.js$/, /^sdk\/vault\.js$/, /^sdk\/team\.js$/, /^core\/ai\/embedding\.js$/,
  /^core\/services\/[^/]+\.js$/, /^sdk\/service\.js$/, /^services\/receiver\/receiver\.js$/,
  /^core\/edge\/[^/]+\.js$/, /^sdk\/edge\.js$/]
// Her desen ağaçta en az bir dosyaya uymalı: uymayan desen o modülü eşiğin dışında bırakır ve fark edilmez (Codex 12. tur:
// ad değişikliğinden sonra desenlerin çoğu eski Türkçe yollarda kalmıştı). --desenler yalnız bunu denetler (kapsam koşmadan)
function desenDenetle (dosyalar) {
  const bos = KRITIK.filter((r) => !dosyalar.some((g) => r.test(g) && !DISARIDA.has(g)))
  if (bos.length) { console.error('KAPSAM: hiçbir dosyaya uymayan kritik desen: ' + bos.map(String).join(' ')); process.exit(1) }
}
if (argv.includes('--desenler')) {
  const dosyalar = []
  const gez = (d) => {
    for (const x of fs.readdirSync(path.join(kok, d), { withFileTypes: true })) {
      if (x.name === 'node_modules' || x.name.startsWith('.')) continue
      const g = d ? d + '/' + x.name : x.name
      if (x.isDirectory()) gez(g)
      else if (g.endsWith('.js')) dosyalar.push(g)
    }
  }
  gez('')
  desenDenetle(dosyalar)
  console.log('kritik desenler: ' + KRITIK.length + ' desen, hepsi ağaçta')
  process.exit(0)
}
const OZET = argv.includes('--ozet') ? argv[argv.indexOf('--ozet') + 1] : path.join(kok, 'node_modules/.kapsam/coverage-summary.json')
const ozet = JSON.parse(fs.readFileSync(OZET, 'utf8'))
const yuzde = (x) => (x.total ? (100 * x.covered / x.total) : 100)
const bicim = (x) => yuzde(x).toFixed(1)
const satirlar = []
let dusuk = 0
desenDenetle(Object.keys(ozet).filter((ad) => ad !== 'total').map((ad) => path.relative(kok, ad)))
for (const [ad, v] of Object.entries(ozet)) {
  if (ad === 'total') continue
  const g = path.relative(kok, ad)
  const kritik = KRITIK.some((r) => r.test(g)) && !DISARIDA.has(g)
  if (!kritik && !TUMU) continue
  const e = ERISILEMEZ[g] ? Math.min(ERISILEMEZ[g][0], v.branches.total - v.branches.covered) : 0
  const net = { covered: v.branches.covered, total: v.branches.total - e }
  const alt = kritik && yuzde(net) < ESIK
  if (alt) dusuk++
  satirlar.push(`| \`${g}\`${kritik ? '' : ' (kritik değil)'} | ${bicim(v.lines)} | ${bicim(v.branches)} (${v.branches.covered}/${v.branches.total}) | ${e ? bicim(net) + ` (${e} erişilemez)` : '—'} | ${bicim(v.functions)} |${alt ? ' **eşik altı**' : ''}`)
}
satirlar.sort()
const t = ozet.total
console.log(`| Modül | Satır % | Dal % | Dal %, erişilemez düşülmüş | İşlev % |`)
console.log('|-------|---------|-------|----------------------------|---------|')
for (const s of satirlar) console.log(s)
console.log(`| **Toplam (tüm kapsanan dosyalar)** | ${bicim(t.lines)} | ${bicim(t.branches)} | — | ${bicim(t.functions)} |`)
console.log('')
for (const [g, [n, neden]] of Object.entries(ERISILEMEZ)) console.log(`Erişilemez: \`${g}\` ${n} dal — ${neden}`)
console.log(`Dışarıda: ${[...DISARIDA].join(', ')} (Bare'e özel ince katman; Node koşusunda yüklenmez)`)
if (dusuk) { console.error(`KAPSAM: ${dusuk} kritik modülde dal kapsamı %${ESIK} altında`); process.exit(1) }
console.log(`KAPSAM TAMAM (kritik modüllerde dal ≥ %${ESIK})`)
