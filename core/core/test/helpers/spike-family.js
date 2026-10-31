// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// worklet/core/spike-family.js — SPIKE: törensiz, sabit test sırrından aile
//
// Gerçek çekirdekte ÜKA/ÜDA cihazda rastgele üretilir, familyId GENESIS olayından,
// anchorHash ADD_MEMBER olayından, ceremonyKey QR töreninden gelir (docs/04 §3–§5, docs/05).
// Spike'ta hepsi YUVA_TEST_SECRET'tan türetilir; böylece iki süreç / iki telefon aynı sırla
// birbirini bulur. Çift sırrı yine gerçek pairSecret() ile X25519 üzerinden hesaplanır.
const sodium = require('sodium-native')
const b4a = require('b4a')
const { derive, hash } = require('../../crypto/kdf')
const { pairSecret, pairSubkeys } = require('../../crypto/pair')
const { createDeviceCert } = require('../../crypto/device-cert')

const DEFAULT_SECRET = 'yuva-spike-test-sirri-2026-10' // YALNIZCA GELİŞTİRME
const DEFAULT_NAMES = ['A', 'B']

function makeMember (root, name) {
  const signKeyPair = { publicKey: b4a.alloc(32), secretKey: b4a.alloc(64) }
  sodium.crypto_sign_seed_keypair(signKeyPair.publicKey, signKeyPair.secretKey, derive(root, 'spike/uka', name))
  const uda = { publicKey: b4a.alloc(32), secretKey: b4a.alloc(32) }
  sodium.crypto_box_seed_keypair(uda.publicKey, uda.secretKey, derive(root, 'spike/uda', name))
  const memberId = hash('member-id', signKeyPair.publicKey).subarray(0, 16)
  return {
    name,
    memberId,
    signKeyPair,
    uda,
    deviceCert: createDeviceCert({ ukaPub: signKeyPair.publicKey, udaPub: uda.publicKey, platform: 'spike' })
  }
}

function spikeFamily (secret = DEFAULT_SECRET, names = DEFAULT_NAMES) {
  const root = hash('spike/root', secret)
  const familyId = hash('family-id', 'spike-genesis', root) // genesisEventBytes yerine
  const identities = names.map((n) => makeMember(root, n))
  const members = new Map()
  for (const m of identities) {
    members.set(b4a.toString(m.memberId, 'hex'), {
      id: m.memberId, name: m.name, signPub: m.signKeyPair.publicKey, udaPub: m.uda.publicKey, active: true
    })
  }
  const ledger = {
    familyId,
    members,
    len: identities.length + 1, // GENESIS + ADD_MEMBER'lar
    head: hash('spike/ledger-head', familyId, ...identities.map((m) => m.memberId))
  }
  // ADD_MEMBER olay hash'i yerine: ikiliden sonra eklenenin kimliğine bağlı sabit
  const anchorFor = (a, b) => {
    const later = names.indexOf(a.name) > names.indexOf(b.name) ? a : b
    return hash('spike/add-member', familyId, later.memberId)
  }
  return { secret, familyId, ledger, identities, anchorFor, root }
}

// Bir üyenin gözünden: kendi kimliği + diğer aktif üyelerle çift alt anahtarları
function viewOf (family, name) {
  const me = family.identities.find((m) => m.name === name)
  if (!me) throw new Error('UNKNOWN_MEMBER: ' + name)
  const peers = new Map()
  for (const other of family.identities) {
    if (other === me) continue
    const pair = pairSecret({
      myUdaSecret: me.uda.secretKey,
      theirUdaPub: other.uda.publicKey,
      myId: me.memberId,
      theirId: other.memberId,
      familyId: family.familyId,
      anchorHash: family.anchorFor(me, other),
      ceremonyKey: null
    })
    peers.set(b4a.toString(other.memberId, 'hex'), {
      id: other.memberId, name: other.name, sub: pairSubkeys(pair, me.memberId, other.memberId)
    })
  }
  return { me, peers, ledger: family.ledger }
}

module.exports = { spikeFamily, viewOf, makeMember, DEFAULT_SECRET, DEFAULT_NAMES }
