// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// QR kodlayıcı: bilinen Reed–Solomon, biçim ve sürüm bilgisi değerleri (ISO/IEC 18004 örnekleri), yapı denetimleri
const test = require('brittle')
const Q = require('../qr')

test('Reed–Solomon: 1-M "HELLO WORLD" örneğinin düzeltme kod sözcükleri', (t) => {
  t.alike(Q.rs([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17], 10), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23])
})

test('biçim ve sürüm bilgisi', (t) => {
  t.is(Q.bicimBitleri(0, 0).toString(2).padStart(15, '0'), '101010000010010', 'M, maske 0')
  t.is(Q.bicimBitleri(4, 1).toString(2).padStart(15, '0'), '110011000101111', 'L, maske 4')
  t.is(Q.surumBitleri(7).toString(2).padStart(18, '0'), '000111110010010100', 'sürüm 7')
})

test('yapı: boyut, bulucu desenler, zamanlama, karanlık modül; sürüm seçimi', (t) => {
  const q = Q.qrKodla('HFJ1:' + 'A'.repeat(100))
  const n = q.moduller.length
  t.is(n, 17 + 4 * q.surum)
  const m = q.moduller
  for (const [x0, y0] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
    t.ok(m[y0][x0] && m[y0 + 6][x0 + 6] && !m[y0 + 1][x0 + 1] && m[y0 + 3][x0 + 3], 'bulucu desen')
  }
  for (let i = 8; i < n - 8; i++) t.is(m[6][i], i % 2 === 0)
  t.ok(m[n - 8][8], 'karanlık modül')
  t.is(Q.surumSec(16 - 2), 1)
  t.is(Q.surumSec(213), 10)
  t.exception(() => Q.surumSec(214), /QR_TOO_LARGE/)
  const cizim = Q.terminaleCiz(q).split('\n')
  t.is(cizim.length, Math.ceil((n + 8) / 2))
  t.ok(cizim.every((s) => [...s].length === n + 8))
})
