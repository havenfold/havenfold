// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Açılış öncesi güvenlik düzeltmeleri (docs/audit/sinirlar-ve-kapsam-disi.md).
//   - Sınırlar 14: depo alt anahtarı kapanışta bellekte sıfırlanır; şifreli kipte kapalı depo yazmaz ve okumaz
//     (STATE_CLOSED)
'use strict'
const test = require('brittle')
const b4a = require('b4a')
const sodium = require('sodium-native')
const { Kalici, Depo } = require('../persistence')
const { geciciDizin } = require('./helpers/common')
const A = require('../../core/records/test/helpers/family')

const saat = () => { let t = A.TS0 + 3_600_000; return () => t++ }
const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }

test('Sınırlar 14: Kalici.kapat depo alt anahtarını sıfırlar; sonra yazım ve okuma STATE_CLOSED', (t) => {
  const dizin = geciciDizin(t)
  const k = new Kalici({ dizin, anahtar: b4a.alloc(32, 0x5a), testKipi: true, now: saat() })
  k.aileKur({ aileAdi: 'Rivera', benimAdim: 'Alex' })
  k.kaydet()
  const alt = k.depo.anahtar
  t.is(alt.byteLength, 32)
  t.absent(sodium.sodium_is_zero(alt), 'açıkken anahtar dolu')
  k.kapat()
  t.ok(sodium.sodium_is_zero(alt), 'alt anahtar sıfırlandı')
  t.is(k.depo.anahtar, null)
  t.is(hataOf(() => k.depo.yaz('durum', b4a.from('x'))), 'STATE_CLOSED', 'sıfır anahtarla yazılmaz')
  t.is(hataOf(() => k.depo.oku('durum')), 'STATE_CLOSED')
  k.kapat() // ikinci kapatma zararsız
  // Aynı dizin aynı platform anahtarıyla yeniden açılır (sıfırlanan yalnız bellekteki kopya)
  const k2 = new Kalici({ dizin, anahtar: b4a.alloc(32, 0x5a), testKipi: true, now: saat() })
  t.ok(k2.nesneler.aile, 'durum okunur')
  k2.kapat()
})

test('Sınırlar 14: açılış hatayla düşerse de alt anahtar sıfırlanır', (t) => {
  const dizin = geciciDizin(t)
  const k = new Kalici({ dizin, anahtar: b4a.alloc(32, 0x5a), testKipi: true, now: saat() })
  k.aileKur({ aileAdi: 'Rivera', benimAdim: 'Alex' })
  k.kaydet()
  k.kapat()
  // Yanlış platform anahtarı: durum açılamaz (STATE_CORRUPT); türetilen alt anahtar bellekte kalmamalı. Depo'nun alt
  // anahtarı kurucuda (temizle'den önce) türetilir: orada yakalanır
  const temizle = Depo.prototype.temizle
  const yakalanan = []
  Depo.prototype.temizle = function () { yakalanan.push(this.anahtar); return temizle.call(this) }
  t.teardown(() => { Depo.prototype.temizle = temizle })
  t.is(hataOf(() => new Kalici({ dizin, anahtar: b4a.alloc(32, 0x5b), testKipi: true, now: saat() })), 'STATE_CORRUPT')
  Depo.prototype.temizle = temizle
  t.is(yakalanan.length, 1)
  t.ok(sodium.sodium_is_zero(yakalanan[0]), 'alt anahtar sıfırlandı')
})
