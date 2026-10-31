// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// worklet/crypto/pair.js — docs/04 §5
const sodium = require('sodium-native')
const b4a = require('b4a')
const { derive } = require('./kdf')

function pairSecret ({ myUdaSecret, theirUdaPub, myId, theirId, familyId, anchorHash, ceremonyKey }) {
  const shared = b4a.alloc(32)
  sodium.crypto_scalarmult(shared, myUdaSecret, theirUdaPub) // geçersiz noktada hata atar
  if (sodium.sodium_is_zero(shared)) throw new Error('WEAK_KEY') // düşük dereceli nokta koruması
  const [lo, hi] = b4a.compare(myId, theirId) < 0 ? [myId, theirId] : [theirId, myId]
  // anchorHash: iki üyeden sonra eklenenin ADD_MEMBER olay hash'i → defter bağlamı
  // ceremonyKey: bu ikili yüz yüze tören yaptıysa törenden gelen ek sır (yoksa 32 sıfır)
  const out = derive(shared, 'pair', familyId, lo, hi, anchorHash, ceremonyKey || b4a.alloc(32))
  sodium.sodium_memzero(shared)
  return out
}

function pairSubkeys (pair, myId, theirId) {
  return {
    ratchetRoot: derive(pair, 'ratchet-root'),
    bellKey: derive(pair, 'bell'), // alıcı tarafı zil doğrulaması (b etiketi)
    relayKey: derive(pair, 'relay'),
    taskKey: derive(pair, 'hf/task/'), // RFC-0003 §6.2: görev zarflarının emanet mührü (0x90–0x97)
    listenSeed: (epoch) => derive(pair, 'rv/listen', myId, epoch), // benim dinlediğim
    dialSeed: (epoch) => derive(pair, 'rv/dial', myId, epoch), // benim aradığım
    peerListenSeed: (epoch) => derive(pair, 'rv/listen', theirId, epoch),
    peerDialSeed: (epoch) => derive(pair, 'rv/dial', theirId, epoch),
    mailboxId: (day) => derive(pair, 'mailbox', theirId, day), // ONA bıraktığım zarfların kutusu
    myMailboxId: (day) => derive(pair, 'mailbox', myId, day) // BANA bırakılanları çektiğim kutu
  }
}

const DAY_MS = 86_400_000
const epochDay = (t = Date.now()) => Math.floor(t / DAY_MS)

module.exports = { pairSecret, pairSubkeys, epochDay }
