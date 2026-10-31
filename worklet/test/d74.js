// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D74 (RFC-0028 §7 c): tören anahtarları kalıcı durumda (gizli alan; şifreli kipte durum dosyası şifreli). Aile
// bağlanmadan önce gelen anahtar korunur, yeniden açılışta durumdan gelir; biçimsiz girdi STATE_CORRUPT.
'use strict'
const test = require('brittle')
const b4a = require('b4a')
const { Kalici } = require('../persistence')
const { geciciDizin } = require('./helpers/common')
const A = require('../../core/records/test/helpers/family')

const saat = () => { let t = A.TS0 + 3_600_000; return () => t++ }
const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }

test('tören anahtarı: aileden önce kaydedilir, aile kurulunca durumda, yeniden açılışta yerinde; anahtarın kopyası sıfırlanır', (t) => {
  const dizin = geciciDizin(t)
  const k = new Kalici({ dizin, testKipi: true, now: saat() })
  const peer = 'ab'.repeat(16)
  const anahtar = b4a.alloc(32, 7)
  k.torenAnahtariKaydet(peer, anahtar)
  t.ok(anahtar.every((x) => x === 0), 'verilen tampon sıfırlandı (kopyası durumda)')
  k.aileKur({ aileAdi: 'Rivera', benimAdim: 'Alex' })
  k.kaydet()
  k.kapat()
  const k2 = new Kalici({ dizin, testKipi: true, now: saat() })
  t.alike([...k2.torenAnahtarlari], [[peer, '07'.repeat(32)]])
  k2.kapat()
})

test('tören anahtarı: geçersiz kimlik ya da boy INVALID_KEY', (t) => {
  const k = new Kalici({ dizin: geciciDizin(t), testKipi: true, now: saat() })
  t.teardown(() => k.kapat())
  for (const [p, a] of [['ab', b4a.alloc(32)], ['zz'.repeat(16), b4a.alloc(32)], ['ab'.repeat(16), b4a.alloc(31)], ['ab'.repeat(16), 'x']]) t.is(hataOf(() => k.torenAnahtariKaydet(p, a)), 'INVALID_KEY')
})
