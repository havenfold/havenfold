// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// derivation.js — afet modunun türetmeleri (RFC-0012 §4, §6.2, §6.3, §7.2)
//
//   afetKey    = deriveLP(pair, 'hf/afet/')
//   etiket     = deriveLP(afetKey, 'hf/afet-near/', reklamYapanId, u64be(dilim))[0..4]
//   toTag      = deriveLP(afetKey, 'hf/afet-to/', aliciId, u64be(gün))[0..8]
//   afetSeed   = deriveLP(pair, 'hf/afet-noise/', id, u64be(gün))      → crypto_sign_seed_keypair
//   doneSecret = deriveLP(afetKey, 'hf/afet-done/', mid)
//   doneHash   = hashLP('hf/afet-done-hash/', doneSecret)[0..16]
// RFC-0012 formülleri `derive`/`hash` yazar; etiketler RFC-0027 §8 b'den sonra koda girdiği için uzunluk önekli biçimle
// (deriveLP/hashLP) üretilir (D83; kollar/D-durum.md İstek 161 a). Parçaların hepsi sabit boyludur (kimlik 16 bayt, sayı u64be).
const sodium = require('sodium-native')
const b4a = require('b4a')
const { kdf: { deriveLP, hashLP } } = require('@havenfold/core')

const GUN_MS = 86_400_000
const DILIM_MS = 900_000

const gunOf = (ms) => Math.floor(ms / GUN_MS)
const dilimOf = (ms) => Math.floor(ms / DILIM_MS)

function id16 (x, ad) {
  if (!b4a.isBuffer(x) || x.byteLength !== 16) throw new Error('KIMLIK_GECERSIZ:' + ad)
  return x
}

const afetKey = (pair) => deriveLP(pair, 'hf/afet/')
const etiket = (key, reklamYapanId, dilim) => deriveLP(key, 'hf/afet-near/', id16(reklamYapanId, 'reklam'), dilim).subarray(0, 4)
const toTag = (key, aliciId, gun) => deriveLP(key, 'hf/afet-to/', id16(aliciId, 'alici'), gun).subarray(0, 8)
const afetSeed = (pair, id, gun) => deriveLP(pair, 'hf/afet-noise/', id16(id, 'kimlik'), gun)
const doneSecret = (key, mid) => deriveLP(key, 'hf/afet-done/', id16(mid, 'mid'))
const doneHash = (secret) => hashLP('hf/afet-done-hash/', secret).subarray(0, 16)

/** Noise IK anahtar çifti (§6.3): başlatan önce bugünü, olmazsa dünü dener */
function anahtarCifti (pair, id, gun) {
  const publicKey = b4a.alloc(sodium.crypto_sign_PUBLICKEYBYTES)
  const secretKey = b4a.alloc(sodium.crypto_sign_SECRETKEYBYTES)
  sodium.crypto_sign_seed_keypair(publicKey, secretKey, afetSeed(pair, id, gun))
  return { publicKey, secretKey }
}

module.exports = { GUN_MS, DILIM_MS, gunOf, dilimOf, afetKey, etiket, toTag, afetSeed, doneSecret, doneHash, anahtarCifti }
