// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
const test = require('brittle')
const sodium = require('sodium-native')
const b4a = require('b4a')
const { derive, hash, PREFIX } = require('../crypto/kdf')

const KEY = b4a.alloc(32, 7)

test('kdf: önek yuva/v2/', (t) => {
  t.is(PREFIX, 'yuva/v2/')
})

test('kdf: derive = anahtarlı BLAKE2b-256(önek+etiket || parçalar)', (t) => {
  const got = derive(KEY, 'pair', b4a.from('ab'), 'cd')
  const want = b4a.alloc(32)
  sodium.crypto_generichash(want, b4a.concat([b4a.from('yuva/v2/pair'), b4a.from('abcd')]), KEY)
  t.alike(got, want)
  t.is(got.byteLength, 32)
})

test('kdf: hash anahtarsız, derive anahtarlı — farklı çıktı', (t) => {
  const want = b4a.alloc(32)
  sodium.crypto_generichash(want, b4a.from('yuva/v2/member-id' + 'x'))
  t.alike(hash('member-id', 'x'), want)
  t.unlike(hash('member-id', 'x'), derive(KEY, 'member-id', 'x'))
})

test('kdf: sayı 8 bayt big-endian kodlanır', (t) => {
  const be = b4a.from('0000000000077717', 'hex') // 489239
  t.alike(derive(KEY, 'rv/listen', 489239), derive(KEY, 'rv/listen', be))
  t.unlike(derive(KEY, 'rv/listen', 489239), derive(KEY, 'rv/listen', '489239'))
})

test('kdf: etiket ve anahtar ayrımı', (t) => {
  t.unlike(derive(KEY, 'rv/listen', 1), derive(KEY, 'rv/dial', 1))
  t.unlike(derive(KEY, 'rv/listen', 1), derive(b4a.alloc(32, 8), 'rv/listen', 1))
  // v1 öneki hiçbir yerde üretilmez
  const v1 = b4a.alloc(32)
  sodium.crypto_generichash(v1, b4a.from('yuva/v1/pair'), KEY)
  t.unlike(derive(KEY, 'pair'), v1)
})

test('kdf: sabit vektör (gerileme koruması)', (t) => {
  t.is(b4a.toString(derive(KEY, 'pair', 'a', 1), 'hex'), VECTOR)
})

const VECTOR = 'b2159c1fc3b955e29fa2360d73aabd0c3789e759dc2ae264d58fb4679951eb83'
