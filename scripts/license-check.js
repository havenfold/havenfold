// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// license-check.js — üretim bağımlılıklarının lisans ve sürüm denetimi (D37)
//
//   node scripts/license-check.js            denetler; sorun varsa çıkış kodu 1
//   node scripts/license-check.js --tablo    tabloyu basar
//   node scripts/license-check.js --yaz      docs/lisanslar.md'nin "## Tablo" bölümünü kilitlerden yeniden yazar (D65)
// Denetim, belgedeki tablonun kilitlerden üretilenle aynı olduğunu da denetler (elle güncellenmez; taşıyıcı zinciri
// dahil worklet kilidindeki her üretim paketi).
//
// Kök (core/*, sdk, node, tools/export-open çalışma alanları) ve worklet kilit dosyalarında geliştirme dışı her paket:
// lisansı izinli listede mi (GPL, AGPL, LGPL, SSPL ve lisanssız yok), sürümü kilitte sabit mi (dış paket: sürüm,
// resolved ve integrity; çalışma alanı: bağ), package.json'larda aralık (^, ~, *, x, >) yok mu.
'use strict'
const fs = require('fs')
const path = require('path')

const KOK = path.join(__dirname, '..')
const IZINLI = new Set(['MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'MPL-2.0'])
const KILITLER = [['kök', 'package-lock.json'], ['worklet', 'worklet/package-lock.json']]
// Kriptografik bağımlılıklar kilitte bu özetle (D60): özet değişirse (yeni sürüm ya da yeniden yayımlanmış paket) denetim
// düşer; güncelleme bilinçli yapılır, bu satır ve core/vault/test/d60.js birlikte güncellenir
const SABIT_OZET = {
  'shamir-secret-sharing': { surum: '0.0.4', integrity: 'sha512-ui8u/cIg2j16b9on/LH3V/glL6wHdwiTo/Iajzqx0STniBvuOzl6VYUxhrow3waF0dggovJfYiBZSWfTAN4XLQ==' }
}

// Kilitte lisans alanı eksik ya da SPDX dışı yazılmış paketler: lisans paketin LICENSE dosyasından elle doğrulandı (D91,
// dbus-next zinciri). Yalnız bu sürüm ve bu özetle geçerli; paket değişirse denetim yine düşer
const LISANS_DUZELTME = {
  '@nornagon/put': { surum: '0.0.8', integrity: 'sha512-ugvXJjwF5ldtUpa7D95kruNJ41yFQDEKyF5CW4TgKJnh+W/zmlBzXXeKTyqIgwMFrkePN2JqOBqcF0M0oOunow==', lisans: 'MIT' }, // "MIT/X11"
  jsbi: { surum: '2.0.5', integrity: 'sha512-TzO/62Hxeb26QMb4IGlI/5X+QLr9Uqp1FPkwp2+KOICW+Q+vSuFj61c8pkT6wAns4WcK56X7CmSHhJeDGWOqxQ==', lisans: 'Apache-2.0' }, // alan yok, LICENSE Apache 2.0
  'map-stream': { surum: '0.1.0', integrity: 'sha512-CkYQrPYZfWnu/DAmVCpTSX/xHpKZ80eKh2lAkyA6AJTef6bW+6JpbQZN5rofum7da+SyN1bi5ctTm+lTfcCW3g==', lisans: 'MIT' }, // alan yok, LICENCE MIT
  'pause-stream': { surum: '0.0.11', integrity: 'sha512-e3FBlXLmN/D1S+zHzanP4E/4Z60oFAa3O051qt1pxa7DEJWKAyil6upYVXCWadEnuoqa4Pkc9oUx9zsxYeRv8A==', lisans: 'MIT' } // "MIT,Apache2" (ikili; MIT seçilir)
}

function denetle () {
  const sorunlar = []
  const satirlar = []
  for (const [ad, dosya] of KILITLER) {
    const kilit = JSON.parse(fs.readFileSync(path.join(KOK, dosya), 'utf8'))
    if (kilit.lockfileVersion !== 3) sorunlar.push(`${dosya}: lockfileVersion ${kilit.lockfileVersion} (3 bekleniyor)`)
    const kokYol = path.dirname(path.join(KOK, dosya))
    for (const [yol, p] of Object.entries(kilit.packages)) {
      if (!yol || p.dev || p.devOptional) continue
      if (p.link) continue // çalışma alanına bağ: hedefi ayrı satırda
      const dis = yol.includes('node_modules/')
      const isim = dis ? yol.slice(yol.lastIndexOf('node_modules/') + 13) : (p.name || JSON.parse(fs.readFileSync(path.join(kokYol, yol, 'package.json'), 'utf8')).name)
      const dz = LISANS_DUZELTME[isim]
      const lisans = dz && dz.surum === p.version && dz.integrity === p.integrity ? dz.lisans : p.license || null
      if (!lisans || !IZINLI.has(lisans)) sorunlar.push(`${ad}: ${isim} lisansı ${lisans || 'yok'}`)
      if (dis && !(p.version && p.resolved && p.integrity)) sorunlar.push(`${ad}: ${isim} kilitte sabit değil`)
      const oz = SABIT_OZET[isim]
      if (oz && (p.version !== oz.surum || p.integrity !== oz.integrity)) sorunlar.push(`${ad}: ${isim} ${p.version} kilit özeti beklenenden farklı (D60: ${oz.surum}, sabit integrity)`)
      satirlar.push({ kilit: ad, isim, surum: p.version || '', lisans: lisans || '', tur: dis ? 'dış' : 'çalışma alanı' })
    }
  }
  // package.json'larda üretim bağımlılığı tam sürümle (ya da file:)
  const paketler = ['package.json', 'worklet/package.json', 'sdk/package.json', 'node/package.json', 'tools/export-open/package.json',
    ...fs.readdirSync(path.join(KOK, 'core')).map((d) => 'core/' + d + '/package.json').filter((f) => fs.existsSync(path.join(KOK, f)))]
  for (const f of paketler) {
    const p = JSON.parse(fs.readFileSync(path.join(KOK, f), 'utf8'))
    for (const [isim, aralik] of Object.entries({ ...p.dependencies, ...p.optionalDependencies, ...p.devDependencies })) {
      if (!/^(file:|\d+\.\d+\.\d+$)/.test(aralik)) sorunlar.push(`${f}: ${isim} "${aralik}" tam sürüm değil`)
    }
  }
  return { sorunlar, satirlar }
}

const BELGE = path.join(KOK, 'docs/lisanslar.md')
const BASLIK = '## Tablo\n\n'
const belgeTablosu = (metin) => { const i = metin.indexOf(BASLIK); return i < 0 ? null : metin.slice(i + BASLIK.length).trimEnd() }

function tablo (satirlar) {
  const bir = new Map()
  for (const s of satirlar) {
    const k = s.isim + '@' + s.surum
    if (!bir.has(k)) bir.set(k, { ...s, kilitler: new Set() })
    bir.get(k).kilitler.add(s.kilit)
  }
  const liste = [...bir.values()].sort((a, b) => (a.tur === b.tur ? (a.isim < b.isim ? -1 : 1) : a.tur === 'çalışma alanı' ? -1 : 1))
  return ['| Paket | Sürüm | Lisans | Tür | Kilit |', '|-------|-------|--------|-----|-------|',
    ...liste.map((s) => `| ${s.isim} | ${s.surum} | ${s.lisans} | ${s.tur} | ${[...s.kilitler].join(', ')} |`)].join('\n')
}

if (require.main === module) {
  const { sorunlar, satirlar } = denetle()
  if (process.argv.includes('--tablo')) console.log(tablo(satirlar))
  else if (process.argv.includes('--yaz')) {
    const metin = fs.readFileSync(BELGE, 'utf8')
    if (belgeTablosu(metin) === null) { console.log('SORUN: docs/lisanslar.md "## Tablo" bölümü yok'); process.exit(1) }
    fs.writeFileSync(BELGE, metin.slice(0, metin.indexOf(BASLIK) + BASLIK.length) + tablo(satirlar) + '\n')
    console.log('docs/lisanslar.md yazıldı (' + satirlar.length + ' girdi)')
  } else {
    if (belgeTablosu(fs.readFileSync(BELGE, 'utf8')) !== tablo(satirlar)) sorunlar.push('docs/lisanslar.md tablosu kilitlerle uyuşmuyor (node scripts/license-check.js --yaz)')
    for (const s of sorunlar) console.log('SORUN: ' + s)
    console.log(sorunlar.length ? 'LISANS_DENETIMI SORUNLU ' + sorunlar.length : 'LISANS_DENETIMI TAMAM ' + satirlar.length)
    process.exit(sorunlar.length ? 1 : 0)
  }
}

module.exports = { denetle, tablo, IZINLI }
