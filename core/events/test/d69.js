// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D69 (RFC-0027 §8 c, RFC-0006 §4.5): olay anahtarının parçaları sabit boyutlu — kimlik 16 bayt, tamsayı u64be.
// Değişken boylu parça (eskiden 'ab' + 'c' ile 'a' + 'bc' aynı anahtarı verebilirdi) KEY_CHUNK. Vektörler aynı.
'use strict'
const test = require('brittle')
const b4a = require('b4a')
const { anahtar } = require('../event')

const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }

test('olay anahtarı: kimlik parçası tam 16 bayt, tamsayı güvenli aralıkta; başka boy KEY_CHUNK', (t) => {
  const id = b4a.alloc(16, 7)
  t.is(anahtar('hf.device.offline', id, 41).byteLength, 16)
  t.is(hataOf(() => anahtar('hf.device.offline', id, 41n)), null, 'bigint u64')
  for (const p of [b4a.alloc(0), b4a.alloc(3), b4a.alloc(15), b4a.alloc(17), b4a.alloc(32)]) t.is(hataOf(() => anahtar('hf.x', p)), 'KEY_CHUNK', p.byteLength + ' bayt')
  t.is(hataOf(() => anahtar('hf.x', b4a.from('ab'), b4a.from('c'))), 'KEY_CHUNK', 'değişken boylu iki parça')
  t.is(hataOf(() => anahtar('hf.x', 'ab')), 'KEY_CHUNK')
  t.is(hataOf(() => anahtar('hf.x', -1)), 'KEY_CHUNK', 'negatif')
  t.is(hataOf(() => anahtar('hf.x', 1.5)), 'KEY_CHUNK')
  t.is(hataOf(() => anahtar('hf.x', 2n ** 64n)), 'KEY_CHUNK', 'u64 dışı')
})
