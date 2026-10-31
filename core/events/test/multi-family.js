// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D94: RFC-0034 §9 ve §11 madde 11 — birden çok aileli telefonda "en çok bir kez" kümesi (aile, vaka, basamak, sıra) ve
// aynı SOS basışının birden çok aileye yazılan kayıtları için ortakMid ile tek bildirim (K2). Beklenenler RFC'den elle.
'use strict'
const test = require('brittle')
const b4a = require('b4a')
const M = require('../escalation')
const { SosTekil, sosHatasi, sosAlanlari } = require('../sos')
const V = require('../../../protocol/vectors/multi-family.json')

const A = 'a1'.repeat(32)
const B = 'b2'.repeat(32)
const me = 'aa'.repeat(16)
// SOS vakası: 2. basamak okuyuculara (me okuyucu)
const sos = (vaka, ortakMid = null) => ({ vaka, gecerli: [[2, 0]], sorumlu: [me], okuyucular: [me], sos: true, subj: 'uye:' + 'cc'.repeat(16), onem: 3, afetMid: null, ortakMid })

test('vektör 11: aynı ortakMid iki aileden tek bildirim; farklı ortakMid iki bildirim; aynı (vaka, basamak, sıra) bir kez', (t) => {
  const tekil = new SosTekil({ now: () => 1000 })
  const a = new M.Bildirimci({ me, now: () => 1000, sosTekil: tekil, aile: A })
  const b = new M.Bildirimci({ me, now: () => 1000, sosTekil: tekil, aile: B })
  const ortak = 'dd'.repeat(16)
  t.alike(a.guncelle([sos('11'.repeat(16), ortak)]).map((x) => x.eylem), ['goster'], 'ilk aile bildirir')
  t.alike(b.guncelle([sos('22'.repeat(16), ortak)]).map((x) => x.eylem), ['guncelle'], V.bildirim[0].aciklama)
  t.alike(b.guncelle([sos('33'.repeat(16), 'ee'.repeat(16))]).map((x) => x.eylem), ['goster'], V.bildirim[1].aciklama)
  t.alike(a.guncelle([sos('11'.repeat(16), ortak)]), [], 'aynı (vaka, basamak, sıra) ikinci kez yok')
  // Küme aileyi içerir: iki ailede aynı vaka kimliği (rastlantı) ayrı bildirim
  const c = new M.Bildirimci({ me, now: () => 1000, aile: A })
  const d = new M.Bildirimci({ me, now: () => 1000, aile: B })
  const v = { ...sos('44'.repeat(16)), sos: false }
  t.is(c.guncelle([v]).length, 1)
  t.is(d.guncelle([v]).length, 1)
  t.ok(c.toJSON()[0][0].startsWith(A + ','), 'anahtar (aile, vaka, basamak, sıra)')
  // Ailesiz bildirimci bugünkü anahtar; aileli bildirimci eski anahtarı gösterilmiş sayar (geçiş)
  const e = new M.Bildirimci({ me, now: () => 1000 })
  e.guncelle([v])
  t.is(e.toJSON()[0][0], '44'.repeat(16) + ',2,0')
  const f = new M.Bildirimci({ me, now: () => 1000, aile: A, gosterilen: e.toJSON() })
  t.alike(f.guncelle([v]), [], 'eski anahtarla gösterilmiş')
})

test('hf.sos ortak_mid: 16 bayt, isteğe bağlı (SOS_SHARED_MID); gösterimde ortakMid', (t) => {
  const k = (f) => ({ tf: { _subj: 'uye:' + 'cc'.repeat(16), ...f }, yazar: 'uye', authorHex: 'cc'.repeat(16) })
  t.is(sosHatasi(k({})), null)
  t.is(sosHatasi(k({ ortak_mid: b4a.alloc(16, 1) })), null)
  t.is(sosHatasi(k({ ortak_mid: b4a.alloc(8, 1) })), 'SOS_SHARED_MID')
  t.is(sosHatasi(k({ ortak_mid: 'x' })), 'SOS_SHARED_MID')
  t.is(sosAlanlari({ ortak_mid: b4a.alloc(16, 1) }).ortakMid, '01'.repeat(16))
  t.is(sosAlanlari({}).ortakMid, null)
})
