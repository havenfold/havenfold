// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D77: çevrimiçi bilgisi oturumlara bağlı (Kerem Huawei'de: kutu eklendi ama "Çevrimdışı"). Taşıyıcının ve boru
// ağının oturum olayları (baglandi/koptu) SDK'nın görülme yüzeyine gider: açık oturumlu üye PRESENCE_GET'te online.
// HELLO'daki caps CapsBook'a yazılır; HIDE_PRESENCE açık üye gizli kalır (RFC-0019 §11.7 a). Değişiklikte LedgerApi
// 'presence' olayı { memberId, online } (uygulamanın Aile ekranı yenilensin).
'use strict'
const test = require('brittle')
const { hello: { CAPS } } = require('@havenfold/core')
const { Esitleyici } = require('../synchronizer')
const A = require('../../core/records/test/helpers/family')
const { geciciDizin, kaliciAc } = require('./helpers/common')

const saat = () => { let t = A.TS0 + 3_600_000; return () => t++ }
const id = (k) => A.hex(k.memberId)

function kur (t, kim) {
  const k = kaliciAc({ dizin: geciciDizin(t), now: saat(), kimlik: kim })
  k.aileBagla(A.kopya(A.anaDefter()))
  t.teardown(() => k.kapat())
  const e = new Esitleyici({ kalici: k, ag: { gonder: () => true } })
  return { k, e, n: k.nesneler }
}

test('oturum açılınca çevrimiçi, kapanınca çevrimdışı; son görülme kalır; presence olayı', (t) => {
  const { e, n } = kur(t, A.K.kerem)
  const olaylar = []
  n.defter.on('presence', (x) => olaylar.push(x))
  const hus = id(A.K.husniye)
  t.alike(n.defter.presence(hus).online, false, 'oturum yokken çevrimdışı')
  e.baglandi(hus, { caps: CAPS.LEDGER_V21 })
  const p = n.defter.presence(hus)
  t.alike([p.online, p.via], [true, 'dogrudan'], 'oturum açıkken çevrimiçi')
  t.ok(p.lastSeenMs > 0)
  e.koptu(hus)
  const p2 = n.defter.presence(hus)
  t.alike([p2.online, p2.via], [false, 'dogrudan'], 'kopunca çevrimdışı, son görülme kalır')
  t.alike(olaylar, [{ memberId: hus, online: true }, { memberId: hus, online: false }])
  // Kutu da (rolü kutu, oturumu üye)
  const kutu = id(A.K.kutu)
  e.baglandi(kutu, { caps: 0 })
  t.is(n.defter.presence(kutu).online, true, 'kutu çevrimiçi')
})

test('HIDE_PRESENCE: HELLO caps\'i kaydedilir, gizli üye oturumu açıkken de görünmez', (t) => {
  const { e, n } = kur(t, A.K.kerem)
  const irem = id(A.K.irem)
  e.baglandi(irem, { caps: CAPS.LEDGER_V21 | CAPS.HIDE_PRESENCE })
  t.ok(n.caps.get(irem), 'caps kaydedildi')
  t.alike(n.defter.presence(irem), { lastSeenMs: null, via: 'yok', online: false }, 'gizli')
  // caps bilgisi gelmeyen bağlantı (eski çağıran) yine çevrimiçi sayılır
  const ecem = id(A.K.ecem)
  e.baglandi(ecem)
  t.is(n.defter.presence(ecem).online, true)
})
