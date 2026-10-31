// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// RFC-0010 açıklama 3 madde 1 ve 3 uçtan uca (iki telefon, iki kalıcı çekirdek, iki eşitleyici, bellek içi ağ): İrem (yetişkin)
// hazırlar, önizleme kalıcı kuyruktan Hüsniye'ye (ebeveyn) kayıtlardan sonra gider ve teslimde "gitti" yazılır; Hüsniye kendi
// telefonunda onaylar; İrem gönderir. İrem iptal edince defterde iptal olayı: Hüsniye'nin telefonu da o onayla gönderemez.
'use strict'
const test = require('brittle')
const b4a = require('b4a')
const S = require('@havenfold/sdk')
const H = require('@havenfold/services')
const { zarf: { Z } } = require('@havenfold/core')
const { Esitleyici } = require('../synchronizer')
const A = require('../../core/records/test/helpers/family')
const Y = require('../../core/services/test/helpers/service-vector')
const { geciciDizin, kaliciAc } = require('./helpers/common')

const id = (k) => A.hex(k.memberId)
const GUN = 86_400_000

test('önizleme uçtan uca: kalıcı kuyruk, teslim, onay, gönderim; okuyucunun iptali defterde', { timeout: 60000 }, async (t) => {
  const saat = { t: A.TS0 + GUN }
  const now = () => saat.t
  const kuyruk = []
  const cihazlar = new Map()
  const telefon = (kim, ad) => {
    const k = kaliciAc({ dizin: geciciDizin(t, ad), now, kimlik: kim })
    k.aileBagla(A.kopya(A.anaDefter()))
    t.teardown(() => k.kapat())
    const e = new Esitleyici({ kalici: k, ag: { gonder: (p, type, bytes) => { if (!cihazlar.has(p)) return false; kuyruk.push([id(kim), p, type, b4a.from(bytes)]); return true } } })
    const c = { k, e, kim, hizmet: null }
    cihazlar.set(id(kim), c)
    return c
  }
  const pompa = () => { for (let i = 0; i < 5000 && kuyruk.length; i++) { const [from, to, type, bytes] = kuyruk.shift(); cihazlar.get(to).e.al(from, type, bytes, 'dogrudan') } }
  const ir = telefon(A.K.irem, 'ir')
  const hu = telefon(A.K.husniye, 'hu')
  ir.e.baglandi(id(A.K.husniye))
  hu.e.baglandi(id(A.K.irem))
  pompa()
  // Paylaşımlar'ı ebeveyn açar; defter ve anahtarlar eşitlenir
  const r = hu.k.nesneler.defter.openCollection({ name: 'Paylaşımlar', kind: 'olaylar', readers: ['rol:ebeveyn', 'rol:yetiskin'], writers: ['rol:ebeveyn', 'rol:yetiskin'] })
  t.is(r.durum, 'uygulandi')
  for (let i = 0; i < 4; i++) { hu.e.akit(); ir.e.akit(); pompa() }
  const pid = hu.k.nesneler.kayit.collections().find((c) => c.name === 'Paylaşımlar').collectionId
  for (const c of [ir, hu]) {
    const n = c.k.nesneler
    c.hizmet = new S.ServiceApi({ kayit: n.kayit, defter: n.defter, paylasimlar: pid, saklama: c.k.urunSaklama('hizmet/'), now })
    c.e.urunZarfi(Z.SHARE_PREVIEW, (p, bytes, yol, rol) => c.hizmet.receivePreview(p, bytes, yol, rol), (p, shareId) => c.hizmet.deliverPreview({ shareId }))
  }
  const vet = Y.kartKur(Y.VETERINER)
  ir.hizmet.addCard({ qr: H.kart.qrKodla(vet) })
  const kum = ir.k.nesneler.kayit.put(A.hex(A.K_TUM_AILE), null, 'yuva.pet.kum', { _subj: 'varlik:' + A.hex(A.VARLIK_KEDI), adet: 2 })
  const o = ir.hizmet.prepare({ serviceId: A.hex(H.kart.kartCoz(vet).serviceId), kaynaklar: [{ collectionId: A.K_TUM_AILE, recordIds: [kum] }], title: 'Coki' })
  const z = ir.hizmet.sendPreview({ shareId: o.shareId })
  t.alike(z.kime.sort(), [id(A.K.kerem), id(A.K.husniye)].sort())
  // Kerem'in telefonu bu ağda yok: onun zarfı kalıcı kuyrukta bekler; Hüsniye'ninki kayıt çıkışından sonra gider
  for (const kime of z.kime) ir.e.zarfGonder(kime, z.type, z.bytes, o.shareId)
  ir.e.akit()
  pompa()
  for (let i = 0; i < 3; i++) { hu.e.akit(); ir.e.akit(); pompa() }
  hu.hizmet.pendingPreviews()
  const hp = hu.hizmet.shares().find((x) => x.shareId === o.shareId)
  t.is(hp && hp.durum, 'onay-bekliyor', 'önizleme Hüsniye\'de')
  t.is(ir.hizmet._taslak(o.shareId).onizlemeGitti, true, 'teslimde gitti yazıldı')
  t.alike(ir.k.urunSaklama('esitleyici/').get('kuyruk').map((x) => x.p), [id(A.K.kerem)], 'Kerem\'in zarfı kalıcı kuyrukta')
  // Hüsniye gösterilen özetle onaylar; defter İrem'e gider; İrem gönderir
  const on = hu.hizmet._onizleme(hu.hizmet._taslak(o.shareId), H.kart.kartCoz(vet))
  t.is(hu.hizmet.confirm({ shareId: o.shareId, payloadHash: on.payloadHash }).durum, 'uygulandi')
  for (let i = 0; i < 3; i++) { hu.e.akit(); ir.e.akit(); pompa() }
  const istek = ir.hizmet.send({ shareId: o.shareId })
  t.ok(istek.bytes.byteLength > 0)
  // İrem (okuyucu, imzacı değil) iptal eder: defter olayı; Hüsniye'nin telefonunda da onay iptal
  t.is(ir.hizmet.cancel({ shareId: o.shareId }).durum, 'iptal')
  for (let i = 0; i < 3; i++) { hu.e.akit(); ir.e.akit(); pompa() }
  t.is(H.onay.onaylar(hu.k.nesneler.ledger).get(o.shareId).durum, 'iptal')
  t.alike(hu.hizmet.shares().find((x) => x.shareId === o.shareId).durum, 'iptal')
})
