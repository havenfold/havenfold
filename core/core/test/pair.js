// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
const test = require('brittle')
const sodium = require('sodium-native')
const b4a = require('b4a')
const { pairSecret, pairSubkeys, epochDay } = require('../crypto/pair')
const { spikeFamily, viewOf } = require('./helpers/spike-family')

function keys (seedByte) {
  const pk = b4a.alloc(32)
  const sk = b4a.alloc(32)
  sodium.crypto_box_seed_keypair(pk, sk, b4a.alloc(32, seedByte))
  return { pk, sk }
}

const A = keys(1)
const B = keys(2)
const idA = b4a.alloc(16, 0xaa)
const idB = b4a.alloc(16, 0xbb)
const ctx = { familyId: b4a.alloc(32, 3), anchorHash: b4a.alloc(32, 4) }

test('pair: iki taraf aynı çift sırrını hesaplar', (t) => {
  const ab = pairSecret({ myUdaSecret: A.sk, theirUdaPub: B.pk, myId: idA, theirId: idB, ...ctx })
  const ba = pairSecret({ myUdaSecret: B.sk, theirUdaPub: A.pk, myId: idB, theirId: idA, ...ctx })
  t.alike(ab, ba)
  t.is(ab.byteLength, 32)
})

test('pair: defter bağlamı ve tören sırrı sonucu değiştirir', (t) => {
  const base = { myUdaSecret: A.sk, theirUdaPub: B.pk, myId: idA, theirId: idB, ...ctx }
  const s0 = pairSecret(base)
  t.alike(s0, pairSecret({ ...base, ceremonyKey: b4a.alloc(32) }), 'ceremonyKey yoksa 32 sıfır')
  t.unlike(s0, pairSecret({ ...base, ceremonyKey: b4a.alloc(32, 9) }))
  t.unlike(s0, pairSecret({ ...base, anchorHash: b4a.alloc(32, 5) }))
  t.unlike(s0, pairSecret({ ...base, familyId: b4a.alloc(32, 6) }))
})

test('pair: düşük dereceli / sıfır nokta reddedilir', (t) => {
  t.exception(() => pairSecret({ myUdaSecret: A.sk, theirUdaPub: b4a.alloc(32), myId: idA, theirId: idB, ...ctx }))
})

test('pair: alt anahtarlar karşılıklı eşleşir', (t) => {
  const pair = pairSecret({ myUdaSecret: A.sk, theirUdaPub: B.pk, myId: idA, theirId: idB, ...ctx })
  const a = pairSubkeys(pair, idA, idB)
  const b = pairSubkeys(pair, idB, idA)
  const e = 489239
  t.alike(a.listenSeed(e), b.peerListenSeed(e), 'A dinleme = B gözünde A dinleme')
  t.alike(a.dialSeed(e), b.peerDialSeed(e))
  t.unlike(a.listenSeed(e), a.dialSeed(e), 'dinleme ≠ arama')
  t.unlike(a.listenSeed(e), b.listenSeed(e), 'yönler ayrı')
  t.unlike(a.listenSeed(e), a.listenSeed(e + 1), 'dilim başına yeni')
  t.alike(a.mailboxId(20379), b.myMailboxId(20379), 'A’nın bıraktığı kutu = B’nin çektiği')
  t.alike(a.ratchetRoot, b.ratchetRoot)
  t.alike(a.bellKey, b.bellKey)
  t.unlike(a.ratchetRoot, a.bellKey)
  t.is(epochDay(86_400_000 * 3 + 5), 3)
})

test('pair: spike ailesi — A ve B aynı buluşma anahtarlarını görür, başka sır göremez', (t) => {
  const fam = spikeFamily('test-sirri')
  const a = viewOf(fam, 'A')
  const b = viewOf(fam, 'B')
  const aHex = b4a.toString(a.me.memberId, 'hex')
  const bHex = b4a.toString(b.me.memberId, 'hex')
  t.alike(a.peers.get(bHex).sub.listenSeed(7), b.peers.get(aHex).sub.peerListenSeed(7))
  const other = viewOf(spikeFamily('baska-sir'), 'A')
  const [otherPeer] = other.peers.values()
  t.unlike(otherPeer.sub.peerListenSeed(7), b.peers.get(aHex).sub.listenSeed(7))
})
