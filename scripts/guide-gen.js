// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// guide-gen.js — docs/sdk-rehberi.md'nin üretilen bölümleri ve örneklerin testi (D42)
//
//   node scripts/guide-gen.js            komut ve hata kodu tablolarını yazar, örnekleri sdk/test/guide-examples.js'e çıkarır
//   node scripts/guide-gen.js --denetle  ikisi de güncel mi (scripts/check.sh); değilse çıkış kodu 1
//
// Komut tablosu protocol/vectors/channel-v4.json'dan (geçerli tablo), channel-task.json'dan (250–255) ve
// protocol/command-ranges.json'dan; hata kodları kaynaktaki fail('…'), hata('…') ve new Error('…') çağrılarından
// (core, sdk, worklet; testler hariç). Örnekler "```js örnek: <ad>" bloklarıdır; sdk/test/guide.js onları Node'da ve
// Bare'de koşar.
'use strict'
const fs = require('fs')
const path = require('path')

const KOK = path.join(__dirname, '..')
const REHBER = path.join(KOK, 'docs/sdk-rehberi.md')
const ORNEKLER = path.join(KOK, 'sdk/test/guide-examples.js')

function komutTablosu () {
  const v4 = require(path.join(KOK, 'protocol/vectors/channel-v4.json'))
  const gorev = require(path.join(KOK, 'protocol/vectors/channel-task.json')).komutlar.filter((k) => !v4.komutlar.some((x) => x.no === k.no))
  const ar = require(path.join(KOK, 'protocol/command-ranges.json'))
  const aileler = require(path.join(KOK, 'protocol/vectors/multi-family.json')).komutlar // RFC-0034 (D92)
  const varlik = require(path.join(KOK, 'protocol/vectors/asset.json')).komutlar // RFC-0003 §5.4 (D98)
  const misafir = require(path.join(KOK, 'protocol/vectors/guest-ceremony.json')).komutlar // RFC-0003 §5.5 (D99)
  const satir = []
  for (const [grup, liste] of [['kanal', v4.komutlar], ['kanal', gorev], ['kasa kilidi', v4.kasa], ['yapay zeka', v4.yz], ['SDK ortak', v4.ortak], ['aile örnekleri', aileler], ['varlık', varlik], ['bakıcı', misafir]]) {
    for (const k of liste) satir.push({ ...k, grup })
  }
  satir.sort((a, b) => a.no - b.no)
  const aralik = (no) => (ar.araliklar.find((x) => no >= x.bas && no <= x.son) || {}).sahip || ''
  return ['| No | Ad | SDK yöntemi | Grup | Aralık |', '|----|----|-------------|------|--------|',
    ...satir.map((k) => `| ${k.no} | \`${k.ad}\` | ${k.sdk ? '`' + k.sdk + '`' : '—'} | ${k.grup} | ${aralik(k.no)} |`)].join('\n')
}

function hataTablosu () {
  const dosyalar = []
  const gez = (d) => {
    for (const f of fs.readdirSync(d)) {
      const y = path.join(d, f)
      if (['node_modules', 'test', '.gecici', 'scripts', 'example', 'bare-crypto'].includes(f)) continue
      if (fs.statSync(y).isDirectory()) gez(y)
      else if (f.endsWith('.js')) dosyalar.push(y)
    }
  }
  for (const d of ['core', 'sdk', 'worklet']) gez(path.join(KOK, d))
  const kodlar = new Map()
  for (const y of dosyalar.sort()) {
    const metin = fs.readFileSync(y, 'utf8')
    for (const m of metin.matchAll(/\b(?:fail|hata|new Error)\(\s*'([A-Z][A-Z0-9_]{2,63})'/g)) {
      if (!kodlar.has(m[1])) kodlar.set(m[1], new Set())
      kodlar.get(m[1]).add(path.relative(KOK, y))
    }
  }
  const sirali = [...kodlar].sort(([a], [b]) => (a < b ? -1 : 1))
  return ['| Kod | Kaynak |', '|-----|--------|', ...sirali.map(([k, s]) => `| \`${k}\` | ${[...s].sort().join(', ')} |`)].join('\n')
}

function bolumYaz (metin, ad, icerik) {
  const bas = metin.indexOf('<!-- ' + ad + ':BAS')
  const son = metin.indexOf('<!-- ' + ad + ':SON -->')
  if (bas < 0 || son < 0) throw new Error('İŞARET_YOK ' + ad)
  const basSonu = metin.indexOf('-->', bas) + 3
  return metin.slice(0, basSonu) + '\n' + icerik + '\n' + metin.slice(son)
}

function ornekler (metin) {
  const out = []
  for (const m of metin.matchAll(/```js örnek: ([a-z0-9-]+)\n([\s\S]*?)```/g)) out.push({ ad: m[1], kod: m[2] })
  if (new Set(out.map((x) => x.ad)).size !== out.length) throw new Error('ÖRNEK_ADI_TEKRAR')
  return ['// SPDX-License-Identifier: Apache-2.0', '// Üretildi: scripts/guide-gen.js (docs/sdk-rehberi.md\'deki "js örnek:" bloklarından); elle değiştirmeyin.',
    "'use strict'", 'module.exports = {',
    ...out.map((o, i) => `  '${o.ad}': async ({ require, assert, ornekKanal, ornekAile, geciciDizin }) => {\n${o.kod.split('\n').filter((l, j, a) => j < a.length - 1 || l).map((l) => (l ? '    ' + l : '')).join('\n')}\n  }${i < out.length - 1 ? ',' : ''}`),
    '}', ''].join('\n')
}

function uret () {
  let metin = fs.readFileSync(REHBER, 'utf8')
  metin = bolumYaz(metin, 'KOMUTLAR', komutTablosu())
  metin = bolumYaz(metin, 'HATALAR', hataTablosu())
  return { metin, ornek: ornekler(metin) }
}

const { metin, ornek } = uret()
if (process.argv.includes('--denetle')) {
  const eski = [fs.readFileSync(REHBER, 'utf8'), fs.existsSync(ORNEKLER) ? fs.readFileSync(ORNEKLER, 'utf8') : '']
  if (eski[0] !== metin || eski[1] !== ornek) { console.log('REHBER_ESKI: node scripts/guide-gen.js'); process.exit(1) }
  console.log('REHBER_GUNCEL')
} else {
  fs.writeFileSync(REHBER, metin)
  fs.writeFileSync(ORNEKLER, ornek)
  console.log('yazıldı: docs/sdk-rehberi.md, sdk/test/guide-examples.js')
}
