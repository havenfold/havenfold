// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D96: RFC-0036 §3.3 madde 4 — worklet kimliğin hf.uygulama kaydını kendisi yazar: aile kurma, katılma (aileBagla),
// açılış; kayıt güncelse yazmaz, appId değişince günceller, anahtar yoksa kuyrukta bekler. 362'nin appId'si kayıttan.
'use strict'
const test = require('brittle')
const { uygulama: U } = require('@havenfold/records')
const A = require('../../core/records/test/helpers/family')
const { geciciDizin, kaliciAc } = require('./helpers/common')

const saat = () => { let t = A.TS0 + 3_600_000; return () => t++ }
const benim = (k) => U.kayitlar(k.nesneler.replika).get(A.hex(k.kimlik.memberId)) || null

test('aile kurma ve açılış: kayıt bir kez yazılır; appId değişince aynı kayıt güncellenir; appId yoksa yazılmaz', (t) => {
  const dizin = geciciDizin(t)
  const now = saat()
  const k = kaliciAc({ dizin, now, appId: 'yuva-acil' })
  k.aileKur({ aileAdi: 'Rivera', benimAdim: 'Alex' })
  t.is(benim(k).appId, 'yuva-acil', 'aile kurulunca yazıldı')
  const rid = benim(k).recordId
  t.absent(k.kaydet(), 'aileKur durumu yazdı; ikinci kez yazılmaz')
  t.is(U.kayitlar(k.nesneler.replika).size, 1)
  const k2 = kaliciAc({ dizin, now, appId: 'yuva-acil' })
  t.absent(k2.kaydet(), 'açılışta kayıt güncel: durum değişmez')
  const k3 = kaliciAc({ dizin, now, appId: 'yuva-pati' })
  t.is(benim(k3).appId, 'yuva-pati', 'açılışta farklı appId: güncellendi')
  t.is(benim(k3).recordId, rid, 'aynı kayıt')
  t.is(k3.nesneler.defter.identities()[0].appId, 'yuva-pati')
  const d2 = geciciDizin(t)
  const k4 = kaliciAc({ dizin: d2, now })
  k4.aileKur({ aileAdi: 'Rivera', benimAdim: 'Alex' })
  t.is(benim(k4), null, 'appId verilmeyen çekirdek yazmaz')
})

test('katılma (aileBagla): anahtar gelene kadar kuyrukta; gelince yazılır ve öbür telefonda 362 kayıttan döner', (t) => {
  const dizin = geciciDizin(t)
  const now = saat()
  const L = A.anaDefter()
  const rH = A.replika(A.kopya(L), A.K.husniye, { otomatikAnahtar: false })
  const k = kaliciAc({ dizin, now, appId: 'yuva-pati', kimlik: A.K.kerem })
  const n = k.aileBagla(A.kopya(L))
  // Kerem bu Tüm Aile döneminin anahtar üreticisi değil: yazım kuyrukta bekler
  const kuyrukta = () => n.replika.writeQueue.filter((i) => i.partial.type === U.TUR).length
  t.is(kuyrukta(), 1, 'kuyrukta')
  t.is(benim(k), null)
  n.replika.sync()
  k.kaydet()
  t.is(kuyrukta(), 1, 'kuyruğa ikinci kez girmez')
  // Anahtar Kerem'de yoksa Hüsniye üretir; anahtarlar ve işlemler iki yönde
  const ep = n.replika.yetki.epochAt(A.hex(A.K_TUM_AILE), L.len - 1)
  if (!n.replika.keys.has(A.hex(A.K_TUM_AILE), ep.seq, ep.hash)) rH.generateKey(A.K_TUM_AILE)
  for (let i = 0; i < 3; i++) { rH.sync(); n.replika.sync(); A.teslim(rH, n.replika); A.teslim(n.replika, rH) }
  t.is(benim(k).appId, 'yuva-pati', 'anahtar gelince yazıldı')
  t.is(U.kayitlar(rH).get(A.hex(A.K.kerem.memberId)).appId, 'yuva-pati', 'Hüsniye\'nin telefonunda')
  t.is(n.defter.identities(A.K.husniye.memberId)[0].appId, null, 'Hüsniye\'nin kaydı yok: bilinmiyor')
  U.kendiKaydiniYaz(rH, 'yuva-acil')
  A.teslim(rH, n.replika)
  t.is(n.defter.identities(A.K.husniye.memberId)[0].appId, 'yuva-acil', '362 kayıttan')
  t.is(n.defter.personAppStatus(A.hex(A.K.husniye.memberId), 'yuva-acil'), 'var')
})
