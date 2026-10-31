// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D78: misafirin bıraktığı olay (RFC-0030 §7, RFC-0006 §6.2 notu). Yazar sınıfı 'misafir': üye sınıfındaki ürün
// türlerinde geçerli olaydır, rutine ve kurala girer; tanım kaydı, vaka sahiplenme ve kapatma, düzeltme yazamaz.
const test = require('brittle')
const b4a = require('b4a')
const { kayitIslemden, olayHatasi, olaylar } = require('../event')
const Vk = require('../case')
const O = require('./helpers/event')

const { C, U, hex, T0, defter, katalog, COKI, kayit, K_OLAYLAR } = O
const buf = (h) => b4a.from(h, 'hex')
const kayitOf = (L, k) => kayitIslemden(L, buf(k.inner), buf(k.opId))

function kat () {
  const k = katalog()
  k.turKaydet({ tur: 'yuva.pet.su', v: 1, olay: true, yazar: 'uye', ozne: ['varlik'], alanlar: [] })
  return k
}

test('D78: misafirin olayı yazar sınıfı misafir; üye ve ikisi türlerinde geçerli, cihaz türünde değil', (t) => {
  const L = defter()
  const misafir = C.misafir1 // defterde var olmuş misafirlik
  const k = kayitOf(L, kayit(L, misafir, 'yuva.pet.su', { _v: 1, _t: T0, _subj: COKI }, T0))
  t.is(k.yazar, 'misafir')
  t.alike(k.uyeAlanlari, {}, 'misafirin alanları üye kararı sayılmaz')
  const ctx = { ledger: L, katalog: kat(), col: L.collections.get(hex(K_OLAYLAR)), kayitlar: [k] }
  t.is(olayHatasi(ctx, k), null, 'üye sınıfı ürün türü')
  const ikisi = kayitOf(L, kayit(L, misafir, 'yuva.pet.beslenme', { _v: 1, _t: T0, _subj: COKI }, T0))
  t.is(olayHatasi({ ...ctx, kayitlar: [ikisi] }, ikisi), null)
  const cihazTuru = kayitOf(L, kayit(L, misafir, 'yuva.pet.litter.visit', { _v: 1, _t: T0, _subj: COKI }, T0))
  t.is(olayHatasi({ ...ctx, kayitlar: [cihazTuru] }, cihazTuru), 'INVALID_AUTHOR_CLASS')
  t.is(olaylar(ctx).sayilir.length, 1, 'rutin ve kural bu listeden okur')
})

test('D78: misafir vaka sahiplenemez, kapatamaz; olayı düzeltemez', (t) => {
  const L = defter()
  const va = Vk.vakaAlanlari({ collectionId: K_OLAYLAR, kaynak: 'kural:' + 'c'.repeat(32), subj: COKI, pencereBasi: T0, pencereSonu: T0 + 3_600_000, yon: 0, onem: 2, ilk: 1, son: 2, t: T0 })
  let n = 0
  const k = (type, fields, kim, yazar) => ({ recordId: (++n).toString(16).padStart(32, '0'), type, tf: fields, fields, stamp: { hlc: BigInt(n), authorId: kim.memberId, opId: b4a.alloc(32, n) }, yazar, authorHex: hex(kim.memberId) })
  const acilis = k('hf.vaka', va, U.kerem, 'uye')
  const durum = (yazar, kim) => [...Vk.vakaDurumlari([acilis, k('hf.vaka.sahip', Vk.sahipAlanlari(va.vaka, T0), kim, yazar), k('hf.vaka.kapat', Vk.kapatAlanlari(va.vaka, 'gercek', T0), kim, yazar)], K_OLAYLAR).values()]
  const uye = durum('uye', U.husniye)
  t.is(uye.length, 1)
  t.alike([uye[0].sahip, uye[0].kapali], [hex(U.husniye.memberId), true], 'üye sahiplenir ve kapatır')
  const mis = durum('misafir', C.misafir1)
  t.alike([mis[0].sahip, mis[0].kapali], [null, false], 'misafirinki yok sayılır')
  // Misafirin hf.olay.duzelt kaydı hedefi geçersiz kılmaz
  const hedef = kayitOf(L, kayit(L, U.kerem, 'yuva.pet.beslenme', { _v: 1, _t: T0, _subj: COKI }, T0))
  const duzelt = kayitOf(L, kayit(L, C.misafir1, 'hf.olay.duzelt', { _t: T0, hedef: hedef.recordId, gecersiz: true }, T0 + 1))
  t.is(duzelt.yazar, 'misafir')
  const ctx = { ledger: L, katalog: kat(), col: L.collections.get(hex(K_OLAYLAR)), kayitlar: [hedef, duzelt] }
  t.is(olayHatasi(ctx, hedef), null)
})
