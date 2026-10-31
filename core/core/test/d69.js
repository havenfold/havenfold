// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D69 (RFC-0027 §8 b): uzunluk önekli deriveLP / hashLP. Vektör protocol/vectors/kdf-lp.json bağımsız elle
// birleştirmeyle üretildi; burada kitaplık hem birleşik girdiyi hem çıktıyı aynı vermelidir. Eski derive/hash değişmez.
'use strict'
const test = require('brittle')
const b4a = require('b4a')
const sodium = require('sodium-native')
const { kdf } = require('..')
const V = require('../../../protocol/vectors/kdf-lp.json')

const hex = (b) => b4a.toString(b, 'hex')
const parca = (p) => (p.u64 !== undefined ? p.u64 : b4a.from(p.hex, 'hex'))
const bir = (girdi, key = null) => { const o = b4a.alloc(32); if (key) sodium.crypto_generichash(o, girdi, key); else sodium.crypto_generichash(o, girdi); return o }

test('kdf-lp.json: deriveLP ve hashLP vektörleri; birleşik girdi elle kurulanla aynı', (t) => {
  t.is(V.onek, kdf.PREFIX)
  for (const d of V.durumlar) {
    const cikti = d.islem === 'deriveLP' ? kdf.deriveLP(b4a.from(d.anahtar, 'hex'), d.etiket, ...d.parcalar.map(parca)) : kdf.hashLP(d.etiket, ...d.parcalar.map(parca))
    t.is(hex(cikti), d.cikti, d.ad)
    t.is(hex(bir(b4a.from(d.girdi, 'hex'), d.anahtar ? b4a.from(d.anahtar, 'hex') : null)), d.cikti, d.ad + ': girdi baytları')
  }
  const c = Object.fromEntries(V.durumlar.map((d) => [d.ad, d.cikti]))
  t.not(c['iki değişken parça (ab, c)'], c['iki değişken parça (a, bc): öncekinden farklı'], 'parça sınırı özete girer')
  t.not(c.anahtarlı, c['anahtarlı, etiket sınırı kayık (hf/lp-ornek/a + bc)'], 'etiket sınırı da')
  t.is(V.eski.ab_c, V.eski.a_bc, 'eski hash bu iki girdide aynı (bu yüzden yeni etiketler LP)')
  t.is(hex(kdf.hash('hf/lp-ornek/', b4a.from('ab'), b4a.from('c'))), V.eski.ab_c, 'eski hash değişmedi')
})

test('deriveLP/hashLP: eski işlevlerden ayrık, parça sınırı, 16 MiB üstü parça CHUNK_TOO_LARGE', (t) => {
  const k = b4a.alloc(32, 3)
  t.not(hex(kdf.hashLP('hf/x/')), hex(kdf.hash('hf/x/')))
  t.not(hex(kdf.deriveLP(k, 'hf/x/')), hex(kdf.derive(k, 'hf/x/')))
  t.not(hex(kdf.hashLP('hf/x/', b4a.alloc(0), b4a.from('a'))), hex(kdf.hashLP('hf/x/', b4a.from('a'), b4a.alloc(0))))
  t.is(hex(kdf.hashLP('hf/x/', 7)), hex(kdf.hashLP('hf/x/', b4a.from('0000000000000007', 'hex'))), 'tamsayı u64be')
  let hata = null
  try { kdf.hashLP('hf/x/', b4a.alloc(0x1000000)) } catch (err) { hata = err.message }
  t.is(hata, 'CHUNK_TOO_LARGE')
})
