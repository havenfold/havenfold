// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// protocol/vectors/service.json'un adım 4–5 maddeleri (RFC-0010 §17 vektörleri 11, 12 ve 14; açıklama 2 madde 5). Belirlenimci.
// Çekirdeğin sonuçları calistir() ile hesaplanır. `alici` alanları referans alıcının (services/hizmet-alicisi) vermesi
// gereken HTTP durumlarıdır; onları alıcının testi aynı girdilerle sınar.
const b4a = require('b4a')
const sodium = require('sodium-native')
const { ledger: { Ledger, encodeEvent, decodeEvent }, kdf: { hashLP, deriveLP } } = require('@havenfold/core')
const V = require('../../../core/test/helpers/v21')
const K = require('../../encoding')
const P = require('../../package')
const C = require('../../reply')
const O = require('../../approval')
const Y = require('./service-vector')

const { hex } = V
const h = (x) => b4a.from(x, 'hex')
const tohum = (n) => hex(b4a.alloc(32, n))
const TS = V.TS0
const GUN = K.GUN_MS
const hata = (f) => { try { f(); return 'kabul' } catch (e) { return e.message } }

const K_KISISEL_ECEM = b4a.alloc(16, 0x3b)
const PAYLASIMLAR = b4a.alloc(16, 0x3a)
const ZINCIR_KAYNAK = (() => {
  const L = new Ledger()
  return [
    ...V.anaAdimlar(L),
    () => V.koleksiyon(L, [V.K.ecem], { collectionId: K_KISISEL_ECEM, name: 'Kişisel', kind: 'kisisel', readers: ['uye:' + hex(V.K.ecem.memberId)], writers: ['uye:' + hex(V.K.ecem.memberId)], taskAccess: false }),
    () => V.koleksiyon(L, [V.K.kerem], { collectionId: PAYLASIMLAR, name: 'Paylaşımlar', kind: 'olaylar', readers: ['rol:ebeveyn', 'rol:yetiskin'], writers: ['rol:ebeveyn', 'rol:yetiskin'], taskAccess: false })
  ].map((f) => { const e = f(); L.apply(e); return hex(encodeEvent(e)) })
})()
const defter = (zincir) => { const L = new Ledger(); for (const x of zincir) L.apply(decodeEvent(h(x))); return L }

function calistir (m) {
  const g = m.girdi
  if (m.tur === 'cevap') {
    const imza = Y.signCifti(g.signSeed)
    const reply = P.sifreCifti(h(g.replySeed))
    const kur = (ek = {}) => C.cevapKur({ packageId: h(g.packageId), n: g.n, replyPub: reply.publicKey, signSecret: imza.secretKey, kind: g.kind, text: g.text, files: [], at: g.at, ephSecret: h(g.ephSecret), nonce: h(g.nonce), ...ek })
    const bytes = kur()
    const c = C.cevapCoz(bytes)
    // k bağımsız hesap (RFC-0010 §8.3 formülü)
    const ortak = b4a.alloc(32)
    sodium.crypto_scalarmult(ortak, h(g.ephSecret), reply.publicKey)
    const k = deriveLP(hashLP(K.ETIKET.cevapDh, ortak, c.ephPub, reply.publicKey), K.ETIKET.cevapKey)
    const ac = (b, ek = {}) => C.cevapAc(b, { packageId: h(g.packageId), replySecret: reply.secretKey, signPub: imza.publicKey, ...ek })
    const acilan = ac(bytes)
    const bozuk = b4a.from(bytes)
    bozuk[bozuk.byteLength - 1] ^= 1
    return {
      cevap: hex(bytes), ephPub: hex(c.ephPub), k: hex(k), ad: hex(C.adOf(h(g.packageId), g.n, c.ephPub)), ct: hex(c.ct),
      acilan: { n: acilan.n, kind: acilan.kind, text: acilan.text, at: acilan.at },
      baskaHizmet: hata(() => ac(bytes, { signPub: Y.signCifti(tohum(0x99)).publicKey })),
      baskaPaket: hata(() => ac(bytes, { packageId: b4a.alloc(16, 1) })),
      ctBozuk: hata(() => ac(bozuk)),
      n16: hata(() => kur({ n: 16 })),
      bilinmeyenTur: hata(() => kur({ kind: 'reklam' }))
    }
  }
  if (m.tur === 'baslik') {
    const imza = Y.signCifti(g.signSeed)
    const sid = h(g.serviceId)
    const baslik = C.yetkiBasligi({ serviceId: sid, signSecret: imza.secretKey, t: g.t, yontem: g.yontem, yol: g.yol, nonce: h(g.nonce) })
    const d = new C.YetkiDefteri()
    const den = (ek = {}) => hata(() => d.denetle({ baslik, serviceId: sid, signPub: imza.publicKey, yontem: g.yontem, yol: g.yol, simdi: g.t, ...ek }))
    const ilk = den()
    return {
      owner: P.sahipOzeti(h(g.ownerSecret)), auth: baslik, ilk, ayniNonce: den(),
      saatDisi: hata(() => new C.YetkiDefteri().denetle({ baslik, serviceId: sid, signPub: imza.publicKey, yontem: g.yontem, yol: g.yol, simdi: g.t + 6 * 60_000 })),
      baskaYol: hata(() => new C.YetkiDefteri().denetle({ baslik, serviceId: sid, signPub: imza.publicKey, yontem: g.yontem, yol: g.yol + 'x', simdi: g.t })),
      onDakikaSonra: hata(() => { const y = new C.YetkiDefteri(); y.denetle({ baslik, serviceId: sid, signPub: imza.publicKey, yontem: g.yontem, yol: g.yol, simdi: g.t }); y.denetle({ baslik: C.yetkiBasligi({ serviceId: sid, signSecret: imza.secretKey, t: g.t + 11 * 60_000, yontem: g.yontem, yol: g.yol, nonce: h(g.nonce) }), serviceId: sid, signPub: imza.publicKey, yontem: g.yontem, yol: g.yol, simdi: g.t + 11 * 60_000 }) })
    }
  }
  if (m.tur === 'kaynak') {
    const L = defter(g.zincir)
    const sonuc = (o) => { try { const r = O.kaynakDenetle(L, o.ben, o.kaynaklar, o.ownerId); return { tur: r.tur, ownerId: hex(r.ownerId), kisisel: r.kisisel } } catch (e) { return e.message } }
    return Object.fromEntries(g.durumlar.map((o) => [o.ad, sonuc(o)]))
  }
  throw new Error('BILINMEYEN_MADDE ' + m.tur)
}

function maddeler () {
  const VET_ID = hex(require('../../card').serviceIdOf(Y.signCifti(Y.VETERINER.signSeed).publicKey))
  const liste = [
    {
      no: 11,
      tur: 'cevap',
      aciklama: 'CEVAP: sabit anahtarlarla şifre ve imza; n tekrarı → red; useUntil sonrası cevap → alıcı 410',
      girdi: { signSeed: Y.VETERINER.signSeed, replySeed: tohum(0xa7), packageId: hex(b4a.alloc(16, 0x81)), n: 0, kind: 'makbuz', text: 'Paket alındı.', at: TS + GUN, ephSecret: tohum(0xa8), nonce: hex(b4a.alloc(24, 0xa9)) },
      alici: { ilkCevap: 201, ayniN: 409, n16: 409, teslimsizCevap: 404, useUntilSonrasi: 410, yetkisiz: 401 }
    },
    {
      no: 12,
      tur: 'baslik',
      aciklama: 'x-hf-owner ve x-hf-auth özetleri; aynı nonce ikinci kez → red',
      girdi: { signSeed: Y.VETERINER.signSeed, serviceId: VET_ID, ownerSecret: tohum(0xb7), t: TS + GUN, nonce: hex(b4a.alloc(16, 0xb8)), yontem: 'GET', yol: '/v1/inbox/' + VET_ID + '?after=0' },
      alici: { ilk: 200, ayniNonce: 401, yanlisSahip: 403, dogruSahipSilme: 204, teslimdenSonraSilme: 409 }
    },
    {
      no: 14,
      tur: 'kaynak',
      aciklama: 'Çocuğun kişisel koleksiyonundan paylaşım denemesi → SDK reddeder; çocuk başlatamaz; kişisel kaynak gizli onay',
      girdi: {
        zincir: ZINCIR_KAYNAK,
        durumlar: [
          { ad: 'ebeveynCocugunKisiseli', ben: hex(V.K.husniye.memberId), kaynaklar: [hex(K_KISISEL_ECEM)] },
          { ad: 'cocukKendiKisiseli', ben: hex(V.K.ecem.memberId), kaynaklar: [hex(K_KISISEL_ECEM)] },
          { ad: 'cocukOrtakVeri', ben: hex(V.K.ecem.memberId), kaynaklar: [hex(V.K_TUM_AILE)] },
          { ad: 'yetiskinKendiKisiseli', ben: hex(V.K.irem.memberId), kaynaklar: [hex(V.K_KISISEL_IREM)] },
          { ad: 'ebeveynBaskasininKisiseli', ben: hex(V.K.husniye.memberId), kaynaklar: [hex(V.K_KISISEL_IREM)] },
          { ad: 'kisiselVeOrtak', ben: hex(V.K.irem.memberId), kaynaklar: [hex(V.K_KISISEL_IREM), hex(V.K_TUM_AILE)] },
          { ad: 'ortakVeri', ben: hex(V.K.husniye.memberId), kaynaklar: [hex(V.K_TUM_AILE)] },
          { ad: 'cocugunOrtakVerisi', ben: hex(V.K.husniye.memberId), kaynaklar: [hex(V.K_TUM_AILE)], ownerId: hex(V.K.ecem.memberId) }
        ]
      }
    }
  ]
  for (const m of liste) m.beklenen = calistir(m)
  return liste
}

module.exports = { maddeler, calistir, ZINCIR_KAYNAK, K_KISISEL_ECEM, PAYLASIMLAR }
