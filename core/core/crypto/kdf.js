// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// worklet/crypto/kdf.js — docs/04 §1.1
const sodium = require('sodium-native')
const b4a = require('b4a')

const PREFIX = 'yuva/v2/' // v1 etiketleri ('yuva/v1/') artık üretilmez ve kabul edilmez

function derive (key, label, ...parts) {
  const out = b4a.alloc(32)
  const input = [b4a.from(PREFIX + label), ...parts.map(toBuf)]
  sodium.crypto_generichash_batch(out, input, key) // anahtarlı BLAKE2b-256
  return out
}

function hash (label, ...parts) {
  const out = b4a.alloc(32)
  sodium.crypto_generichash_batch(out, [b4a.from(PREFIX + label), ...parts.map(toBuf)])
  return out
}

// Uzunluk önekli türetme ve özet (RFC-0027 §8 b; D69): bundan sonra eklenen etiketler bunu kullanır, var olanlar
// derive/hash'te kalır. Etiket (önekle) ve her parça u32be(uzunluk) ‖ bayt olarak birleşir; parça sınırı belirsiz olmaz.
// Uzunluğun ilk baytı 0'dır (parça < 16 MiB), bu yüzden derive/hash'in girdisiyle (önek 'y' ile başlar) çakışmaz.
const LP_ENCOK = 0xffffff
function lp (parts) {
  const out = []
  for (const p of parts) {
    if (p.byteLength > LP_ENCOK) throw new Error('CHUNK_TOO_LARGE')
    const n = b4a.alloc(4)
    new DataView(n.buffer, n.byteOffset).setUint32(0, p.byteLength)
    out.push(n, p)
  }
  return out
}

function deriveLP (key, label, ...parts) {
  const out = b4a.alloc(32)
  sodium.crypto_generichash_batch(out, lp([b4a.from(PREFIX + label), ...parts.map(toBuf)]), key)
  return out
}

function hashLP (label, ...parts) {
  const out = b4a.alloc(32)
  sodium.crypto_generichash_batch(out, lp([b4a.from(PREFIX + label), ...parts.map(toBuf)]))
  return out
}

function toBuf (x) {
  if (b4a.isBuffer(x)) return x
  if (typeof x === 'number') {
    // u64be; negatif, kesirli ya da 2^53 ve üstü sayı tutarsız yazılırdı (inceleme kayıt 17)
    if (!Number.isSafeInteger(x) || x < 0) throw new Error('U64_OUT_OF_RANGE')
    const b = b4a.alloc(8)
    new DataView(b.buffer, b.byteOffset).setBigUint64(0, BigInt(x))
    return b
  }
  // RFC-0001 §3: BigInt 8 bayt büyük sonlu (u64be); eskiden ondalık metne çevriliyordu
  if (typeof x === 'bigint') {
    if (x < 0n || x >= 1n << 64n) throw new Error('U64_OUT_OF_RANGE')
    const b = b4a.alloc(8)
    new DataView(b.buffer, b.byteOffset).setBigUint64(0, x)
    return b
  }
  return b4a.from(String(x))
}

module.exports = { derive, hash, deriveLP, hashLP, toBuf, PREFIX }
