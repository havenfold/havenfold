// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Yuva Hat vektörleri (packages/protocol/vectors/kdf.json, pair.json) kopyalanan kodla aynen tutmalı.
const test = require('brittle')
const b4a = require('b4a')
const { derive, hash } = require('../crypto/kdf')
const { pairSecret, pairSubkeys } = require('../crypto/pair')

const KDF = require('./vectors/yuva-hat/kdf.json')
const PAIR = require('./vectors/yuva-hat/pair.json')

const h = (s) => b4a.from(s, 'hex')
const hex = (b) => b4a.toString(b, 'hex')
const parca = (p) => ('metin' in p ? p.metin : 'sayi' in p ? p.sayi : h(p.hex))

test('vektörler: kdf.json derive ve hash', (t) => {
  t.ok(KDF.derive.length > 0 && KDF.hash.length > 0)
  for (const d of KDF.derive) t.is(hex(derive(h(KDF.key), d.etiket, ...d.parcalar.map(parca))), d.sonuc, 'derive ' + d.etiket)
  for (const d of KDF.hash) t.is(hex(hash(d.etiket, ...d.parcalar.map(parca))), d.sonuc, 'hash ' + d.etiket)
})

test('vektörler: pair.json çift sırrı ve alt anahtarlar', (t) => {
  const g = PAIR.girdi
  const ctx = { familyId: h(g.familyId), anchorHash: h(g.anchorHash), ceremonyKey: h(g.ceremonyKey) }
  const ab = pairSecret({ myUdaSecret: h(g.aSecret), theirUdaPub: h(g.bPub), myId: h(g.idA), theirId: h(g.idB), ...ctx })
  const ba = pairSecret({ myUdaSecret: h(g.bSecret), theirUdaPub: h(g.aPub), myId: h(g.idB), theirId: h(g.idA), ...ctx })
  t.is(hex(ab), PAIR.pair)
  t.is(hex(ba), PAIR.pair)
  const sub = pairSubkeys(ab, h(g.idA), h(g.idB))
  const a = PAIR.altAnahtarlar
  t.is(hex(sub.ratchetRoot), a.ratchetRoot)
  t.is(hex(sub.bellKey), a.bellKey)
  t.is(hex(sub.relayKey), a.relayKey)
  t.is(hex(sub.listenSeed(1)), a.listenSeedA_epoch1)
  t.is(hex(sub.mailboxId(20379)), a.mailboxIdB_day20379)
})
