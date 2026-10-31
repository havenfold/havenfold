// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D52: anlamsal arama dizininin worklet saklaması (Kalici.gommeSaklama; durum dışında, platform anahtarıyla şifreli)
'use strict'
const test = require('brittle')
const b4a = require('b4a')
const fs = require('#fs')
const { Kalici } = require('../persistence')
const { geciciDizin, arsivAnahtari } = require('./helpers/common')

test('gommeSaklama: koleksiyon başına gomme/<cid> dosyası, diskte şifreli, durumdan ayrı; geçersiz ad reddedilir', (t) => {
  const dizin = geciciDizin(t)
  const k = new Kalici({ dizin, anahtar: b4a.alloc(32, 0x52), archivePubHex: arsivAnahtari(52).pubHex, now: () => 1_800_000_000_000 })
  t.teardown(() => k.kapat())
  const s = k.gommeSaklama()
  const ad = 'gomme-' + 'ab'.repeat(16)
  t.is(s.oku(ad), null)
  s.yaz(ad, b4a.from('gizli gömme vektörleri'))
  t.is(b4a.toString(s.oku(ad)), 'gizli gömme vektörleri')
  const ham = fs.readFileSync(dizin + '/gomme/' + 'ab'.repeat(16))
  t.absent(b4a.toString(ham).includes('gizli'), 'diskte düz metin yok')
  t.exception(() => s.yaz('durum', b4a.from('x')), /INVALID_NAME/, 'durum dosyasının üstüne yazılamaz')
  t.exception(() => s.oku('gomme-../durum'), /INVALID_NAME/)
  s.sil(ad)
  t.is(s.oku(ad), null)
})
