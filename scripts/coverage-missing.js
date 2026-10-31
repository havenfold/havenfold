// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// coverage-missing.js — c8 çıktısından (node_modules/.kapsam/coverage-final.json) bir dosyanın sınanmayan dallarını kaynak satırıyla döker
// (D64; yalnız geliştirme aracı). node scripts/coverage-missing.js <dosya yolu, depo köküne göre>
'use strict'
const fs = require('fs')
const path = require('path')
const kok = path.join(__dirname, '..')
const d = JSON.parse(fs.readFileSync(path.join(kok, 'node_modules/.kapsam/coverage-final.json'), 'utf8'))
const hedef = path.join(kok, process.argv[2])
const f = d[hedef]
if (!f) { console.error('yok: ' + hedef); process.exit(1) }
const satirlar = fs.readFileSync(hedef, 'utf8').split('\n')
for (const [k, b] of Object.entries(f.branchMap)) {
  const sayilar = f.b[k]
  sayilar.forEach((n, i) => {
    if (n > 0) return
    const loc = b.locations[i] || b.loc
    const s = loc.start.line
    console.log(`${s}: [${b.type} ${i}] ${(satirlar[s - 1] || '').trim().slice(0, 150)}`)
  })
}
