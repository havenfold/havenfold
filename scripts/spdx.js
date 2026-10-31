// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// spdx.js — kaynak dosyalarda SPDX lisans başlığı ve MPL-2.0 Exhibit A bildirimi (kurucu §17.1, §20.2; RFC-0033, RFC-0038)
//
//   node scripts/spdx.js            denetler; başlığı eksik, dizinin lisansıyla uyuşmayan ya da (MPL-2.0'da) Exhibit A
//                                   bildirimi eksik dosya varsa çıkış kodu 1
//   node scripts/spdx.js --ekle     eksik başlıkları ekler (shebang varsa ondan sonra) ve MPL-2.0 dosyalarına SPDX
//                                   satırının hemen altına Exhibit A bildirimini ekler; yanlış başlığa dokunmaz
//
// Lisans dizinden gelir (LISANSLAR, ilk eşleşen önek). JSON, Markdown, hex ve lisans metinleri başlık taşımaz; onları
// dizindeki LICENSE dosyası ve README'deki lisans kuralı kapsar. Yorum biçimi bilinmeyen ama elle SPDX satırı taşıyan
// dosyalar (grub.cfg, cloud-init, nft …) da denetlenir; Exhibit A o satırın yorum önekiyle yazılır.
// kollar/ açılıştan önce silinir, taranmaz.
'use strict'
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const KOK = path.join(__dirname, '..')
const LISANSLAR = [
  ['sdk/', 'Apache-2.0'],
  ['protocol/', 'Apache-2.0'],
  ['tools/export-open/', 'Apache-2.0'],
  ['images/', 'Apache-2.0'],
  ['services/', 'AGPL-3.0-only'], // referans alıcı (RFC-0010 §13.2; kurucu §17.1)
  ['', 'MPL-2.0'] // core, worklet, node, installer, scripts, kök
]
const SLASH = new Set(['.js', '.mjs', '.cjs', '.ts'])
const DIYEZ = new Set(['.sh', '.service', '.socket', '.timer', '.conf', '.yml', '.yaml', '.toml', '.ornek'])
const DIYEZ_ADLAR = new Set(['Containerfile', 'Dockerfile'])
const ATLA = /^(kollar\/|.*node_modules\/)/
// MPL-2.0 Exhibit A (https://mozilla.org/MPL/2.0/), SPDX satırının hemen altında, iki yorum satırı
const EXHIBIT_A = [
  'This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL',
  'was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.'
]

function exhibitA (y) {
  return EXHIBIT_A.map((s) => y === '<!--' ? `<!-- ${s} -->` : `${y} ${s}`) // XML yorumu kendi satırında kapanır
}

function yorum (dosya) {
  const ad = path.basename(dosya)
  if (DIYEZ_ADLAR.has(ad)) return '#'
  const uz = path.extname(ad)
  if (SLASH.has(uz)) return '//'
  if (DIYEZ.has(uz)) return '#'
  // uzantısız çalıştırılabilir betik: shebang'den
  if (!uz) {
    const ilk = fs.readFileSync(path.join(KOK, dosya), 'utf8').split('\n', 1)[0]
    if (/^#!.*\b(bash|sh|node|bare)\b/.test(ilk)) return /node|bare/.test(ilk) ? '//' : '#'
  }
  return null
}

function lisans (dosya) {
  return LISANSLAR.find(([onek]) => dosya.startsWith(onek))[1]
}

function dosyalar () {
  return execFileSync('git', ['ls-files'], { cwd: KOK, encoding: 'utf8' }).split('\n')
    .filter(f => f && !ATLA.test(f) && fs.existsSync(path.join(KOK, f)) && fs.statSync(path.join(KOK, f)).isFile())
}

// Exhibit A denetimi: k SPDX satırının indeksi, y onun yorum öneki. Dönüş: 'var', 'yok' ya da 'farkli'.
function exhibitDurumu (satirlar, k, y) {
  const beklenen = exhibitA(y)
  if (beklenen.every((s, i) => satirlar[k + 1 + i] === s)) return 'var'
  return /Mozilla Public License|mozilla\.org\/MPL/.test(satirlar.slice(k + 1, k + 4).join('\n')) ? 'farkli' : 'yok'
}

function denetle (ekle) {
  const sorunlar = []
  let eklenen = 0
  let exhibitEklenen = 0
  for (const f of dosyalar()) {
    const metin = fs.readFileSync(path.join(KOK, f), 'utf8')
    const satirlar = metin.split('\n')
    const bas = satirlar[0].startsWith('#!') ? 1 : 0
    const ust = satirlar.slice(0, bas + 3)
    const k = ust.findIndex((s) => /SPDX-License-Identifier:/.test(s))
    const tanimli = yorum(f)
    if (!tanimli && k < 0) continue
    const beklenen = lisans(f)
    if (k >= 0) {
      const bulunan = satirlar[k].match(/^(\S+)\s+SPDX-License-Identifier:\s*(\S+?)(?:\s+-->)?\s*$/)
      if (!bulunan) { sorunlar.push(`${f}: SPDX satırı biçimsiz`); continue }
      if (bulunan[2] !== beklenen) { sorunlar.push(`${f}: ${bulunan[2]} (beklenen ${beklenen})`); continue }
      if (beklenen !== 'MPL-2.0') continue
      const durum = exhibitDurumu(satirlar, k, bulunan[1])
      if (durum === 'var') continue
      if (durum === 'farkli') { sorunlar.push(`${f}: Exhibit A metni farklı`); continue }
      if (!ekle) { sorunlar.push(`${f}: Exhibit A yok (MPL-2.0)`); continue }
      satirlar.splice(k + 1, 0, ...exhibitA(bulunan[1]))
      fs.writeFileSync(path.join(KOK, f), satirlar.join('\n'))
      exhibitEklenen++
      continue
    }
    if (!ekle) { sorunlar.push(`${f}: başlık yok (${beklenen})`); continue }
    const yeni = [`${tanimli} SPDX-License-Identifier: ${beklenen}`]
    if (beklenen === 'MPL-2.0') { yeni.push(...exhibitA(tanimli)); exhibitEklenen++ }
    satirlar.splice(bas, 0, ...yeni)
    fs.writeFileSync(path.join(KOK, f), satirlar.join('\n'))
    eklenen++
  }
  return { sorunlar, eklenen, exhibitEklenen }
}

if (require.main === module) {
  const ekle = process.argv.includes('--ekle')
  const { sorunlar, eklenen, exhibitEklenen } = denetle(ekle)
  if (ekle) console.log(`${eklenen} dosyaya başlık, ${exhibitEklenen} dosyaya Exhibit A eklendi`)
  if (sorunlar.length) {
    for (const s of sorunlar.slice(0, 50)) console.log(s)
    if (sorunlar.length > 50) console.log(`… ve ${sorunlar.length - 50} dosya daha`)
    console.log(`HATA: ${sorunlar.length} dosyada SPDX sorunu`)
    process.exit(1)
  }
  console.log('SPDX TAMAM')
}

module.exports = { denetle, lisans, yorum, exhibitA, EXHIBIT_A }
