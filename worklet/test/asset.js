// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D98: varlık kanal komutları (430 BEING_ADD, 431 BEING_REMOVE) örnek ürün sunucusu üstünden; durum yeniden
// açılışta korunur. Beklenenler RFC-0003 §5.4'ten elle yazıldı.
'use strict'
const test = require('brittle')
const b4a = require('b4a')
const { start } = require('..')
const { urunSunucusu, KOMUT } = require('../example/product')
const { geciciDizin, ipcCifti, istemci, hataOf, arsivAnahtari } = require('./helpers/common')

const ARSIV = arsivAnahtari(98)

async function ac (t, dizin) {
  const ipc = ipcCifti()
  const c = istemci(ipc)
  const w = await start({ urunSunucusu, dizin, anahtar: b4a.alloc(32, 8), archivePubHex: ARSIV.pubHex, ipc, appId: 'ornek' })
  t.teardown(() => w.kapat())
  return { w, c }
}

test('430/431: ebeveyn hayvan ekler ve kaldırır; kanal sonucu olay nesnesi taşımaz; yeniden açılışta korunur', async (t) => {
  const dizin = geciciDizin(t, 'varlik')
  let { w, c } = await ac(t, dizin)
  t.is(await hataOf(c.iste(KOMUT.BEING_ADD, { tur: 'kedi', ad: 'Coki' })), 'NO_IDENTITY', 'aile yokken')
  await c.iste(KOMUT.CREATE_FAMILY, { aileAdi: 'Eser', benimAdim: 'Kerem' })
  const r = await c.iste(KOMUT.BEING_ADD, { tur: 'kedi', ad: 'Coki' })
  t.is(r.durum, 'uygulandi')
  t.absent('event' in r)
  t.alike((await c.iste(KOMUT.FAMILY_INFO)).varliklar, [{ varlikId: r.varlikId, tur: 'kedi', ad: 'Coki', yerId: null }])
  await c.iste(KOMUT.BEING_ADD, { tur: 'kopek', ad: 'Paşa' })
  w.kapat()
  ;({ w, c } = await ac(t, dizin))
  t.alike((await c.iste(KOMUT.FAMILY_INFO)).varliklar.map((v) => v.ad).sort(), ['Coki', 'Paşa'], 'defterde kalıcı')
  t.is((await c.iste(KOMUT.BEING_REMOVE, { varlikId: r.varlikId })).durum, 'uygulandi')
  t.alike((await c.iste(KOMUT.FAMILY_INFO)).varliklar.map((v) => v.ad), ['Paşa'])
  t.is(await hataOf(c.iste(KOMUT.BEING_REMOVE, { varlikId: r.varlikId })), 'NO_TARGET')
  t.is(await hataOf(c.iste(KOMUT.BEING_ADD, { tur: 'kedi' })), 'INVALID_BODY')
})
