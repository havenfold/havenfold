// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Çalışma alanı paketlerinin package.json alanları ağaçla uyuşur (Codex 12. tur): "files" her kalıbı bir dosyayı tutar ve
// girişten (main, bin) göreli require ile ulaşılan her dosyayı kapsar (ad değişikliğinde afet/, uc/, dagitim/, paket/
// eski adlarıyla kalmıştı); kökün overrides'ındaki file: yolu köke göre çözülür (npm ls ELSPROBLEMS vermesin);
// engines CI'ın ve README'nin söylediği Node 22.
const test = require('brittle')
const fs = require('fs')
const path = require('path')

const KOK = path.join(__dirname, '..', '..')
const kok = JSON.parse(fs.readFileSync(path.join(KOK, 'package.json'), 'utf8'))

function paketler () {
  const out = []
  for (const w of kok.workspaces) {
    if (!w.endsWith('/*')) { out.push(w); continue }
    const ust = w.slice(0, -2)
    for (const d of fs.readdirSync(path.join(KOK, ust)).sort()) {
      if (fs.existsSync(path.join(KOK, ust, d, 'package.json'))) out.push(ust + '/' + d)
    }
  }
  return out
}

function dosyalar (dizin, on = '') {
  const out = []
  for (const e of fs.readdirSync(path.join(dizin, on), { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const rel = on ? on + '/' + e.name : e.name
    if (e.isDirectory()) out.push(...dosyalar(dizin, rel))
    else out.push(rel)
  }
  return out
}

// npm "files" kalıbı: "x" (dosya ya da dizin), "d/" (dizin), "*" tek düzey, "**" her düzey
function kalip (k) {
  const g = k.replace(/\/$/, '')
  const re = g.split('/').map((p) => p === '**' ? '.*' : p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('/')
  return new RegExp('^' + re + '(/.*)?$')
}

function ulasilan (dizin, giris) {
  const gor = new Set()
  const yigin = [...giris]
  while (yigin.length) {
    const rel = yigin.pop()
    if (gor.has(rel)) continue
    gor.add(rel)
    if (!rel.endsWith('.js')) continue
    const src = fs.readFileSync(path.join(dizin, rel), 'utf8')
    for (const m of src.matchAll(/require\(\s*'(\.{1,2}\/[^']+)'\s*\)/g)) {
      const r = path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1]))
      if (r.startsWith('..')) continue
      const bulunan = [r, r + '.js', r + '.json', r + '/index.js'].find((c) => fs.existsSync(path.join(dizin, c)) && fs.statSync(path.join(dizin, c)).isFile())
      if (bulunan) yigin.push(bulunan)
    }
  }
  return [...gor]
}

test('çalışma alanı paketleri: files kalıpları ağaçta var ve girişten ulaşılan her dosyayı kapsıyor', (t) => {
  for (const p of paketler()) {
    const dizin = path.join(KOK, p)
    const pj = JSON.parse(fs.readFileSync(path.join(dizin, 'package.json'), 'utf8'))
    if (!pj.files) continue
    const hepsi = dosyalar(dizin)
    const kaliplar = pj.files.map(kalip)
    for (let i = 0; i < pj.files.length; i++) {
      t.ok(hepsi.some((f) => kaliplar[i].test(f)), `${p}: files "${pj.files[i]}" bir dosyayı tutuyor`)
    }
    const bin = typeof pj.bin === 'string' ? [pj.bin] : Object.values(pj.bin || {})
    const giris = [pj.main || 'index.js', ...bin].map((x) => path.posix.normalize(x))
    const disarida = ulasilan(dizin, giris).filter((f) => f !== 'package.json' && !kaliplar.some((re) => re.test(f))) // package.json npm'de hep pakette
    t.alike(disarida, [], `${p}: girişten ulaşılan her dosya files içinde`)
  }
})

test('kökün overrides file: yolları köke göre çözülüyor', (t) => {
  const yollar = Object.entries(kok.overrides || {}).filter(([, v]) => typeof v === 'string' && v.startsWith('file:'))
  t.ok(yollar.length > 0)
  for (const [ad, v] of yollar) {
    const hedef = path.resolve(KOK, v.slice(5))
    t.ok(hedef.startsWith(KOK + path.sep), `${ad}: ${v} depo içinde`)
    t.ok(fs.existsSync(path.join(hedef, 'package.json')), `${ad}: ${v} köke göre çözülüyor`)
  }
})

test('engines: kök ve çalışma alanı paketleri yalnız Node 22 (CI, .nvmrc, README)', (t) => {
  t.is(fs.readFileSync(path.join(KOK, '.nvmrc'), 'utf8').trim(), '22')
  t.is(kok.engines.node, '22.x', 'kök')
  for (const p of paketler()) {
    const pj = JSON.parse(fs.readFileSync(path.join(KOK, p, 'package.json'), 'utf8'))
    if (pj.engines) t.is(pj.engines.node, '22.x', p)
  }
})
