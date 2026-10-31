// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
const test = require('brittle')
const b4a = require('b4a')
const sodium = require('sodium-native')
const { kodlama: { decodeRecDrop, decodeInner }, hlc: { fromMs }, appendRecordId, dropOpIdOf, dropSigDigest } = require('@havenfold/records')
const { kayitIslemden, olayHatasi, anahtar } = require('../event')
const R = require('../routine')
const Kr = require('../rule')
const Vk = require('../case')
const S = require('../storage')
const Zf = require('../envelope')
const V = require('./helpers/event-vector')
const O = require('./helpers/event')
const F = require('../../../protocol/vectors/event-v2.json')

const hex = (b) => b4a.toString(b, 'hex')
const buf = (h) => b4a.from(h, 'hex')

test('vektörler: event.json üretici aynı dosyayı verir (belirlenimci)', (t) => {
  t.alike(JSON.parse(JSON.stringify(V.jsonla(V.vektorler()))), F)
  t.is(hex(O.defter(F.zincir).familyId), F.familyId)
})

test('vektör 1: çekirdek alanlı olay — OpInner, recordId türetimi, REC_DROP', (t) => {
  const L = O.defter(F.zincir)
  const v = F.v1
  const inner = decodeInner(buf(v.inner))
  t.is(inner.op, 2)
  t.is(inner.hlc.toString(), v.hlc)
  t.is(hex(appendRecordId(inner.authorId, inner.hlc)), v.recordId)
  t.is(hex(inner.recordId), v.recordId)
  t.is(inner.fields.find((f) => f.name === '_conf').value, 92)
  // Mühür: bırakma anahtarıyla açılır, içi OpInner'dır; imza cihazın
  const w = decodeRecDrop(buf(v.rec_drop))
  t.is(hex(w.dropKeyHash), v.dropKeyHash)
  const pt = b4a.alloc(w.sealed.byteLength - sodium.crypto_box_SEALBYTES)
  t.ok(sodium.crypto_box_seal_open(pt, w.sealed, buf(v.dropPublicKey), buf(v.dropSecretKey)))
  t.is(hex(pt), v.inner)
  t.ok(sodium.crypto_sign_verify_detached(w.sig, dropSigDigest(L.familyId, dropOpIdOf(w)), L.devices.get(v.yazar).signPub))
  // Motor için geçerli
  const k = kayitIslemden(L, buf(v.inner), b4a.alloc(32))
  const kat = O.katalog()
  t.is(olayHatasi({ ledger: L, katalog: kat, col: L.collections.get(hex(O.K_OLAYLAR)), kayitlar: [k] }, k), null)
})

test('vektör 2: _key ve vaka türetimi; iki özne iki farklı özet', (t) => {
  const a = F.v2.anahtar
  t.is(hex(anahtar(a.tur, buf(a.parcalar[0]), a.parcalar[1])), a._key)
  for (const v of F.v2.vaka) {
    t.is(hex(Vk.ozneOzeti(v._subj)), v.ozneOzeti)
    t.is(hex(Vk.vakaAnahtari(buf(v.collectionId), buf(v.kaynakId), v._subj, v.pencereBasi, v.yon)), v.vaka)
  }
  t.not(F.v2.vaka[0].vaka, F.v2.vaka[1].vaka)
  t.is(hex(Kr.cekirdekKaynakId(F.v2.cekirdek.tur)), F.v2.cekirdek.kaynakId)
})

test('vektör 3: gün', (t) => {
  for (const d of F.v3) t.is(R.gunOf(d._t, d), d.gun)
  t.alike(F.v3.map((d) => d.gun), [20745, 20744])
})

test('vektör 4–5: bant ve dar bant', (t) => {
  for (const v of [F.v4, F.v5]) {
    const b = R.bant(v.degerler, v.k, v.en_dar)
    t.alike([b.m, b.mad, b.w, b.alt, b.ust], [v.m, v.mad, v.w, v.alt, v.ust])
    for (const x of v.bugun) t.is(R.sapmaYonu(x.x, b.alt, b.ust, true), x.yon)
  }
  t.alike([F.v4.alt, F.v4.ust], [1, 7])
  t.alike([F.v5.alt, F.v5.ust], [-1, 1])
})

test('vektör 6: olgunluk ve gözlem kesintisi', (t) => {
  t.alike(V.calistir6(F, { olaylar: F.v6.kayitlar, kesinti: F.v6.kesinti }), F.v6.beklenen)
  t.alike(F.v6.beklenen, { gun: 6, kesintili: 3, olgun: false })
})

test('vektör 7: güven', (t) => {
  for (const d of F.v7) t.is(V.calistir7(F, d), d.vaka, d.aciklama)
  t.alike(F.v7.map((d) => d.vaka), [false, true, false, true])
})

test('vektör 8–9: sıra bağımsızlığı ve basamak geçerliliği', (t) => {
  for (const s of F.v8.siralar) t.alike(V.durumOf(F, s.map((i) => F.v8.kayitlar[i])), F.v8.beklenen)
  for (const d of F.v9.durumlar) t.alike(V.durumOf(F, d.kayitlar).gecerli, d.gecerli)
})

test('vektör 10: sahiplenmeden sonra bildirim yok; iki kayıt iki zarf → tek bildirim', (t) => {
  t.alike(V.calistir10(F, F.v10), F.v10.beklenen)
})

test('vektör 11: kural önceliği, bastırma ve susturma', (t) => {
  t.alike(V.calistir11(F, F.v11), F.v11.bastirilmis)
})

test('vektör 12–14: sorumlu listesi, tekil anahtar, düzeltme', (t) => {
  t.alike(V.calistir12(F, F.v12), F.v12.sorumlu)
  const r = V.calistir13(F, F.v13)
  t.is(r.sayi, F.v13.sayi)
  t.is(r.asil, F.v13.asil)
  t.alike(V.calistir14(F, F.v14), { duzeltmeli: F.v14.duzeltmeli, duzeltmesiz: F.v14.duzeltmesiz })
})

test('vektör 15: saklama', (t) => {
  for (const d of F.v15.durumlar) {
    const k = S.etkinSure(d._keep, d.tur, d.conf, d.saklama)
    t.is(k === Infinity ? null : k, d.etkin, d.aciklama)
    t.is(S.suresiDoldu(d._t, k, d.M), d.temizlenir, d.aciklama)
  }
})

test('vektör 16: VAKA_UYANDIR ve VAKA_DUR kodlama, imza, alıcı denetimi', (t) => {
  const L = O.defter(F.zincir)
  for (const z of Object.values(F.v16.zarflar)) {
    const bytes = buf(z.bayt)
    const body = bytes.subarray(0, bytes.byteLength - 64)
    t.is(hex(Zf.digestOf(z.etiket, L.familyId, body)), z.ozet)
    t.ok(sodium.crypto_sign_verify_detached(bytes.subarray(bytes.byteLength - 64), buf(z.ozet), L.entity(z.imzaci).signPub))
  }
  for (const d of F.v16.denetimler) t.is(V.calistir16({ ...F, v16: F.v16 }, d), d.beklenen, d.zarf + ' → ' + d.alici.slice(0, 8))
})

test('vektör 17–18: kural penceresi ve yazar denetimi', (t) => {
  const r = V.calistir17(F, F.v17)
  t.alike(r, { vakalar: F.v17.vakalar, tetikler: F.v17.tetikler })
  t.is(r.vakalar[0], r.vakalar[1])
  t.not(r.vakalar[1], r.vakalar[2])
  for (const d of F.v18.durumlar) t.is(V.durumOf(F, d.kayitlar).sahipli, d.sahipli)
})

test('vektörler: hlc yardımcısı kayıt katmanıyla aynı', (t) => {
  t.is(fromMs(1).toString(), (1n << 16n).toString())
})
