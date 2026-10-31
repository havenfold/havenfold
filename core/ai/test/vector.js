// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// protocol/vectors/ai.json: üretici aynı dosyayı verir; dosyadaki beklenenler elle yazılmış değerlerle karşılaştırılır
// ve dosyadan okunan girdilerle yeniden hesaplanır (RFC-0013 §19).
const test = require('brittle')
const b4a = require('b4a')
const F = require('../../../protocol/vectors/ai.json')
const { vektorler } = require('./helpers/ai-vector')
const { ledger: { Ledger, decodeEvent } } = require('@havenfold/core')
const { metin: { N }, cozucu: cz, engel: { engel }, yetenek: y, cikarma: c, dizin: d, asistan: a, cocuk: k } = require('..')

const buf = (h) => b4a.from(h, 'hex')

test('ai.json üretici aynı dosyayı verir', async (t) => {
  t.alike(JSON.parse(JSON.stringify(await vektorler())), F)
})

test('ai.json elle yazılmış beklenenler', (t) => {
  t.alike(F[3].durumlar.map((x) => x.beklenen.yol), ['telefon', null, 'isci', null, 'kural'])
  t.is(F[3].cocuk.disariSor, false)
  t.alike(F[4].map((x) => x.beklenen), [true, true, true, false, true])
  t.alike(F[5].map((x) => x.beklenen), ['istanbul kombi servisi', 'ışık', 'alinin'])
  t.alike(F[6].map((x) => x.beklenen), ['2028-03-14', '2028-03-14', null, '2027-09-03'])
  t.alike(F[7].satirlar.map((x) => x.beklenen), [85, 40, 95, 60])
  t.is(F[7].ayni.beklenen, 100)
  t.is(F[7].onay.ekran[2].deger, null, 'bulunamayan alan boş')
  t.is(F[7].onay.kayit.fields._conf, 85)
  t.alike(F[7].onay.kayit.fields._ai, ['alici', 'iban'])
  t.alike(F[8].map((x) => x.beklenen.length > 0), [true, true, false, true, true])
  t.is(F[9][0].govde, '[YZ] cihazda\nKombi servisi 0212 555 66 77.\nKaynak: Defter › Ev › Kombi')
  t.is(F[9][1].govde, '[YZ] evde\nKombiler yılda bir bakım ister.')
  t.is(F[10].beklenen, 'Defterde bununla ilgili bir kayıt bulamadım.')
  t.alike(F[12].beklenen, ['z', 'x', 'w', 'y'])
  t.alike(F[14].metinler.map((x) => x.kriz), [true, false])
  t.alike([F[14].modelCagrilir, F[14].gecmiseYazilir], [false, false])
  t.is(F[16][0].beklenen, 'Kombi kapalı olabilir. Vanayı aç.')
  t.is(F.hatalar.dizinBozuk, 'INDEX_CORRUPT')
})

test('ai.json girdilerinden yeniden hesap', (t) => {
  for (const x of F[3].durumlar) t.alike(y.yol(x.is, x.sinif, x.girdi, y.yetenekKur(F[3].yetenekler[x.yetenek])), x.beklenen, x.aciklama)
  for (const x of F[4]) t.is(a.tetik(x.metin, { takma: x.takma || null }) !== null, x.beklenen)
  for (const x of F[5]) t.is(N(x.metin), x.beklenen)
  for (const x of F[6]) t.is(cz.tarihler(x.metin)[0]?.deger ?? null, x.beklenen)
  for (const x of F[7].satirlar) t.is(c.guven(x.g), x.beklenen)
  for (const x of F[8]) t.alike(engel(x.metin, { adlar: x.adlar || [] }), x.beklenen)
  for (const x of F[9]) t.alike(a.yzCoz(x.govde), x.cozum)
  t.is(a.cevapKur(F[10].girdi).metin, F[10].beklenen)
  t.alike(d.rrf(F[12].listeler).map((x) => x.id), F[12].beklenen)
  for (const x of F[16]) t.is(k.cocukSuzgeci(x.metin).metin, x.beklenen)
  for (const x of F[14].metinler) t.is(k.krizMi(x.metin), x.kriz)

  const D = F[11]
  t.is(b4a.toString(d.indexKey(buf(D.blok.K), buf(D.blok.collectionId)), 'hex'), D.indexKey)
  const cozulen = d.blokCoz({ K: buf(D.blok.K), keyId: buf(D.blok.keyId), collectionId: buf(D.blok.collectionId), blokNo: D.blok.blokNo, modelHash: buf(D.blok.modelHash), bytes: buf(D.blok.bytes) })
  t.alike(cozulen.map((p) => ({ ref: p.ref, vec: Array.from(p.vec) })), D.blok.parcalar)
  const L = new Ledger()
  for (const h of D.zincir) L.apply(decodeEvent(buf(h)))
  for (const [ad, id] of Object.entries(D.kimlikler)) t.alike(d.dizinlenecekler(L, id), D.dizinlenecekler[ad], ad)
  t.is(D.dizinlenecekler.ecem.length, 1, 'çocuk yalnız Tüm Aile')
  const silinen = []
  const b = new d.DizinBekcisi({ me: D.daraltan.me, sil: (cid, seq) => silinen.push({ cid, seq }) })
  b.uygula(L)
  L.apply(decodeEvent(buf(D.daraltan.olay)))
  b.uygula(L)
  t.alike(silinen, D.daraltan.silinen)
  t.is(silinen.length, 1)
})
