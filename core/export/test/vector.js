// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
const test = require('brittle')
const b4a = require('b4a')
const K = require('../export')
const { arsivOku } = require('../archive')
const { vektorler, bozukBayt } = require('./helpers/export-vector')
const F = require('../../../protocol/vectors/export.json')

const hex = (b) => b4a.toString(b, 'hex')
const buf = (h) => b4a.from(h, 'hex')
const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }

test('vektörler: export.json üretici aynı dosyayı verir', (t) => {
  t.alike(JSON.parse(JSON.stringify(vektorler())), F)
})

test('vektör 1: sabit parola, salt ve akış başıyla küçük kap', (t) => {
  t.is(hex(K.anahtarTuret(F.parola, buf(F.salt), F.kdf.opslimit, F.kdf.memlimit)), F.anahtar)
  const kap = buf(F.v1.kap)
  t.alike(kap.subarray(0, 6), b4a.concat([b4a.from('HFKAP'), b4a.from([1])]))
  t.alike(K.baslikOku(kap).baslik, F.v1.baslik)
  const { icerik } = K.ac(kap, F.parola)
  t.is(hex(icerik), F.v1.zip)
  const a = arsivOku(icerik)
  t.is(a.icerik.bicim, 'yuva-defter-arsiv')
  t.is(b4a.toString(a.dosyalar[0].bytes), 'Elektrik faturası, Ekim')
  const tam = K.ac(buf(F.tam.kap), F.parola).icerik
  t.is(tam.byteLength, 2 * K.CHUNK)
  t.ok(tam.every((x, i) => x === i % 251))
})

test('vektör 2–4: zayıf ya da aşırı parametre, kesik, fazladan bayt, değiştirilmiş başlık → açılmaz', (t) => {
  for (const no of [2, 3, 4]) t.ok(F.bozuk.some((d) => d.no === no), 'madde ' + no)
  for (const d of F.bozuk) {
    t.ok(d.hata, d.aciklama + ' açılmaz')
    t.is(hataOf(() => K.ac(bozukBayt(F, d), d.parola || F.parola)), d.hata, d.aciklama)
  }
})
