// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Belgelerde uygulamaya giden çerçeve olarak yazılan her { olay: '<ad>' } adını worklet gerçekten yollar (Codex 12. tur:
// ad değişikliğinden sonra BENIOKU ve rehber 'kalici', 'esitleme-durumu', 'misafir' gibi eski adları anlatıyordu; eski
// ada bakan ürün sayaç ya da durum olayını sessizce kaçırır)
'use strict'
const test = require('brittle')
// Kaynak taraması yalnız Node'da; modül adları birleştirilerek (Bare yükleyicisi düz require('fs')'i çözmeye çalışır)
const NODE = typeof Bare === 'undefined' // eslint-disable-line no-undef
const fs = NODE ? require('f' + 's') : null
const path = NODE ? require('pa' + 'th') : null

test('belgelerdeki { olay: … } adları worklet kodunda yollanır', { skip: !NODE }, (t) => {
  const W = path.join(__dirname, '..')
  const KOK = path.join(W, '..')
  const yollanan = new Set()
  for (const f of fs.readdirSync(W).filter((x) => x.endsWith('.js'))) {
    const s = fs.readFileSync(path.join(W, f), 'utf8')
    for (const m of s.matchAll(/(?:olayGonder\(o, |ortakOlay\(|this\.olay\(|\bolay: )'([a-z-]+)'/g)) yollanan.add(m[1])
  }
  t.ok(yollanan.size >= 10, 'kodda ' + yollanan.size + ' olay adı')
  for (const b of ['worklet/BENIOKU.md', 'docs/sdk-rehberi.md', 'docs/mimari.md']) {
    const y = path.join(KOK, b)
    if (!fs.existsSync(y)) continue
    for (const m of fs.readFileSync(y, 'utf8').matchAll(/\{ ?olay: '([a-z-]+)'/g)) t.ok(yollanan.has(m[1]), b + ': ' + m[1])
  }
})
