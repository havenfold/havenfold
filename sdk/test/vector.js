// SPDX-License-Identifier: Apache-2.0
const test = require('brittle')
const { vektorler, defter, calistir4, yaz } = require('./helpers/sdk-vector')
const { resolveMember, parseSrc, confOf } = require('../common')
const F = require('../../protocol/vectors/sdk-v2.json')

test('vektörler: sdk.json üretici aynı dosyayı verir (belirlenimci)', (t) => {
  t.alike(JSON.parse(JSON.stringify(vektorler())), F)
})

test('vektör 1: _src biçimleri; 17 öğe ya da 201 baytlık öğe yazılmaz', (t) => {
  for (const o of F.v1.ogeler) t.alike(parseSrc(o.oge), o.ayrisim, o.oge.slice(0, 20))
  for (const l of F.v1.listeler) t.is(yaz({ _src: l._src }), l.sonuc, l.aciklama)
  t.alike(F.v1.listeler.map((l) => l.sonuc), ['yazilir', 'INVALID_FIELD_VALUE', 'INVALID_FIELD_VALUE', 'INVALID_FIELD_VALUE'])
})

test('vektör 2: _conf = 101 yazılmaz; yoksa 100, aralık dışı 0 okunur', (t) => {
  for (const d of F.v2.yazma) t.is(yaz(d.alanlar), d.sonuc)
  for (const d of F.v2.okuma) t.is(confOf(d.alanlar), d.conf)
  t.is(F.v2.yazma[0].sonuc, 'INVALID_FIELD_VALUE')
  t.is(F.v2.okuma[0].conf, 100)
})

test('vektör 3: resolveMember — iki kez telefon değiştirmiş üye, atLedgerSeq ile ara uç', (t) => {
  const L = defter(F.zincir)
  for (const d of F.v3.durumlar) t.alike(resolveMember(L, d.memberId, d.atLedgerSeq), d.sonuc)
  const [son, once, ara] = F.v3.durumlar
  t.not(son.sonuc.activeId, ara.sonuc.activeId)
  t.is(once.sonuc.activeId, once.memberId)
})

test('vektör 4: HIDE_PRESENCE açık üye → yok; presenceWithin yalnız evet/hayır', (t) => {
  for (const s of F.v4.sorular) t.alike(calistir4(F.v4, s, F.zincir), s.sonuc, s.islem)
  t.is(F.v4.sorular[0].sonuc.via, 'yok')
  t.is(F.v4.sorular[1].sonuc, true)
})

test('vektör 5: ürünün tanımsız _ alanı reddedilir', (t) => {
  for (const d of F.v5) t.is(yaz(d.alanlar), d.sonuc)
  t.is(F.v5[0].sonuc, 'RESERVED_FIELD')
})
