// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// protocol/vectors/ceremony.json: tören MAC'i (caps kapsamı RFC-0021 §2 madde 81, RFC-0003 §2.2). Beklenen değerler
// kitaplıkla ve ayrıca doğrudan anahtarlı BLAKE2b ile (kdf'siz) yeniden hesaplanır.
'use strict'
const test = require('brittle')
const b4a = require('b4a')
const sodium = require('sodium-native')
const { torenMac } = require('../ceremony')
const V = require('../../../protocol/vectors/ceremony.json')

const h = (x) => b4a.from(x, 'hex')
const u64 = (n) => { const b = b4a.alloc(8); new DataView(b.buffer, b.byteOffset, 8).setBigUint64(0, BigInt(n)); return b }

test('ceremony.json: tören MAC\'i', (t) => {
  t.ok(V.durumlar.length >= 4)
  for (const d of V.durumlar) {
    t.alike(b4a.toString(torenMac(h(V.sec), h(V.handshakeHash), d.taraf, d.caps), 'hex'), d.mac, d.taraf + ' caps ' + d.caps)
    const out = b4a.alloc(32)
    const girdi = [b4a.from('yuva/v2/hf/toren/mac'), h(V.handshakeHash), b4a.from(d.taraf), ...(d.caps ? [u64(d.caps)] : [])]
    sodium.crypto_generichash_batch(out, girdi, h(V.sec))
    t.alike(b4a.toString(out, 'hex'), d.mac, 'doğrudan BLAKE2b')
  }
  const sifir = V.durumlar.filter((d) => d.caps === 0)
  const dolu = V.durumlar.filter((d) => d.caps !== 0 && d.taraf === 'c')
  t.ok(sifir.length && dolu.length)
  t.not(sifir.find((d) => d.taraf === 'c').mac, dolu[0].mac, 'caps MAC\'i değiştirir')
})
