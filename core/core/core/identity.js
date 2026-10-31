// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// worklet/core/identity.js — üye kimliği: ÜKA (Ed25519) + ÜDA (X25519) + Cihaz Sertifikası (docs/04 §2–§3)
//
// seed verilirse belirlenimci (test ve vektörler); verilmezse randombytes.
const sodium = require('sodium-native')
const b4a = require('b4a')
const { derive, hash } = require('../crypto/kdf')
const { createDeviceCert } = require('../crypto/device-cert')
const { memberIdOf } = require('../ledger/ledger')

function createIdentity ({ seed = null, platform = 'bare', createdAt = 0 } = {}) {
  let ukaSeed = b4a.alloc(32)
  let udaSeed = b4a.alloc(32)
  if (seed) {
    const root = hash('identity/seed', seed)
    ukaSeed = derive(root, 'identity/uka')
    udaSeed = derive(root, 'identity/uda')
  } else {
    sodium.randombytes_buf(ukaSeed)
    sodium.randombytes_buf(udaSeed)
  }
  const signKeyPair = { publicKey: b4a.alloc(32), secretKey: b4a.alloc(64) }
  sodium.crypto_sign_seed_keypair(signKeyPair.publicKey, signKeyPair.secretKey, ukaSeed)
  const uda = { publicKey: b4a.alloc(32), secretKey: b4a.alloc(32) }
  sodium.crypto_box_seed_keypair(uda.publicKey, uda.secretKey, udaSeed)
  sodium.sodium_memzero(ukaSeed)
  sodium.sodium_memzero(udaSeed)
  return {
    memberId: memberIdOf(signKeyPair.publicKey),
    signKeyPair,
    uda,
    deviceCert: createDeviceCert({ ukaPub: signKeyPair.publicKey, udaPub: uda.publicKey, platform, createdAt })
  }
}

module.exports = { createIdentity }
