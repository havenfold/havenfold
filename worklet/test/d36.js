// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D36: inceleme 13'ün worklet şüphelileri: bağlanınca son sayaç bir kez; pay alındısı ancak pay diske yazılınca.
// Beklenenler elle yazıldı.
'use strict'
const test = require('brittle')
const b4a = require('b4a')
const S = require('@havenfold/sdk')
const { zarf: { Z } } = require('@havenfold/core')
const { start } = require('..')
const { Esitleyici } = require('../synchronizer')
const { urunSunucusu } = require('../example/product')
const A = require('../../core/records/test/helpers/family')
const { geciciDizin, ipcCifti, istemci, kaliciAc, arsivAnahtari } = require('./helpers/common')

const ARSIV = arsivAnahtari(36)
const NOW = () => A.TS0 + 3_600_000
const id = (k) => A.hex(k.memberId)

test('bağlanınca son kalici sayacı bir kez gelir (ilk açılışın yazımı IPC kurulmadan oluyordu)', async (t) => {
  const ipc = ipcCifti()
  const c = istemci(ipc)
  const w = await start({ urunSunucusu, dizin: geciciDizin(t), anahtar: b4a.alloc(32, 3), archivePubHex: ARSIV.pubHex, ipc })
  t.teardown(() => w.kapat())
  t.alike(c.olaylar.filter((x) => x.olay === 'persisted').map((x) => x.veri), [{ sayac: 1 }])
})

test('KASA_SHARE_PUT: alındı gitmeden önce pay diske yazılır (kilitliyken arsive)', async (t) => {
  const k = kaliciAc({ dizin: geciciDizin(t), now: NOW, kimlik: A.K.kerem, archivePubHex: ARSIV.pubHex })
  t.teardown(() => k.kapat())
  const n = k.aileBagla(A.anaDefter())
  const gidenler = []
  const e = new Esitleyici({ kalici: k, ag: { gonder: (p, type) => { gidenler.push({ type, sayac: k.sayac, arsivde: k._arsivListe().length }) } } })
  const hus = new S.VaultApi({ ledger: n.ledger, me: A.K.husniye, now: NOW })
  await hus.setupBackupKey(b4a.alloc(32, 6))
  const pay = hus.outgoing().find((x) => x.to === id(A.K.kerem))
  const once = k.sayac
  e.baglandi(id(A.K.husniye))
  gidenler.length = 0
  t.alike(e.al(id(A.K.husniye), Z.KASA_SHARE_PUT, pay.bytes, 'dogrudan'), { hata: null })
  const ack = gidenler.find((x) => x.type === Z.KASA_SHARE_ACK)
  t.ok(ack, 'alındı gitti')
  t.ok(ack.sayac > once, 'alındıdan önce durum yazıldı')
  t.is(ack.arsivde, 1, 'pay arsivde (kilitli)')
})
