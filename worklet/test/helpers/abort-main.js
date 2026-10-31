// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D75 testinin ana süreci: bir cihaz süreci başlatır, pid'ini yazar, sonra brittle zaman aşımındaki gibi abort eder
// (çıkış kancaları çalışmaz). Çocuk stdin kapanınca kendini kapatmalı.
'use strict'
const { BoruAgi } = require('./multi')
const { geciciDizin, arsivAnahtari } = require('./common')
const b4a = require('b4a')
const sodium = require('sodium-native')
async function main () {
  const ag = new BoruAgi()
  const c = ag.cihaz('A')
  const h = b4a.alloc(32); sodium.randombytes_buf(h)
  await c.start({ dizin: geciciDizin(null, 'd75'), anahtarHex: b4a.toString(h, 'hex'), archivePubHex: arsivAnahtari(75).pubHex, dht: [{ host: '127.0.0.1', port: 9 }] }) // DHT düğümü süreci ayakta tutar (taşıyıcı testleri gibi)
  process.stdout.write('COCUK ' + c.p.pid + '\n', () => process.abort())
}
main()
