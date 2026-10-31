// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D96: RFC-0036 §3 ve §9 vektör 7–12 — hf.uygulama kaydı ve kendi yazar sınıfı. Ana zincir (ledger-v21) üstünde
// bellek içi replikalar; beklenenler protocol/vectors/app-record.json'dan (RFC'den elle yazıldı).
const test = require('brittle')
const b4a = require('b4a')
const { ledger: { T, decodeEvent, encodeEvent } } = require('@havenfold/core')
const { anaDefter, kopya, replika, teslim, K, C, K_TUM_AILE, hex, olay, ekle, uye } = require('./helpers/family')
const { E } = require('./helpers/multi-vector')
const { sinifOf, sinifaUyar } = require('../class')
const { reduceAll } = require('../merge')
const U = require('../app')
const V = require('../../../protocol/vectors/app-record.json')

const TA = hex(K_TUM_AILE)
const durum = (no, i = 0) => V.durumlar.filter((d) => d.no === no)[i]

// Aile: verilen kimliklerin replikaları; dagit bütün çıkışları herkese verir, defter bir olayı herkese uygular
function aile (kimler, L = anaDefter()) {
  const r = {}
  let ilk = true
  for (const [ad, kim] of Object.entries(kimler)) { r[ad] = replika(ilk ? L : kopya(L), kim); ilk = false }
  const hepsi = Object.values(r)
  const dagit = () => {
    for (let i = 0; i < 4; i++) {
      for (const a of hepsi) {
        a.sync()
        const msgs = a.outbox.splice(0)
        for (const b of hepsi) if (b !== a) { a.outbox.push(...msgs); teslim(a, b) }
      }
    }
  }
  const defter = (type, body, imz) => {
    const e = olay(hepsi[0].ledger, type, body, imz)
    for (const x of hepsi) x.ledger.apply(decodeEvent(encodeEvent(e)))
    dagit()
  }
  const uyg = (x, id) => U.kimlikUygulamasi(x.ledger, U.kayitlar(x), hex(id.memberId))
  dagit()
  return { r, dagit, defter, uyg }
}

// Kişinin kimlikleri (LedgerApi.identities'in kayıt katmanındaki karşılığı) ve durum
function kisiDurumu (x, kisi, appId) {
  const L = x.ledger
  const h = U.kayitlar(x)
  const ids = L.identitiesOf(L.personIdOf(hex(kisi.memberId))).filter((id) => L.members.get(id).role !== 'kutu')
  return U.uygulamaDurumu(ids.map((id) => ({ appId: U.kimlikUygulamasi(L, h, id) })), appId)
}

test('katalog: hf.uygulama, yazar sınıfı kendi, Tüm Aile', (t) => {
  t.is(sinifOf('hf.uygulama'), V.tur.yazar)
  const k = require('@havenfold/core/protocol/event-types.json').turler.find((x) => x.tur === V.tur.tur)
  t.is(k.olay, V.tur.olay)
  t.is(k.koleksiyon, V.tur.koleksiyon)
  t.alike(k.alanlar.map((a) => a.ad), ['app_id', 'yetenek']) // yetenek: RFC-0037 §6.2 (D102)
  t.ok(U.appIdGecerli('yuva-acil'))
  for (const x of ['', 'Yuva', 'a'.repeat(33), 'yuva_acil', 7, null]) t.absent(U.appIdGecerli(x), String(x))
})

test('vektör 7: kendi kaydı; başkasının put\'u ve başkası adına kayıt görünüme girmez', (t) => {
  const { r, dagit, uyg } = aile({ hus: K.husniye, kerem: K.kerem, irem: K.irem })
  const [d1, d2, d3] = V.durumlar.filter((d) => d.no === 7)
  t.is(U.kendiKaydiniYaz(r.hus, d1.appId), 'yazildi')
  dagit()
  for (const x of Object.values(r)) t.is(uyg(x, K.husniye), d1.beklenen.husniye, d1.aciklama)
  const rid = U.kayitlar(r.kerem).get(hex(K.husniye.memberId)).recordId
  r.kerem.put(TA, rid, '', { app_id: d2.appId })
  dagit()
  for (const x of Object.values(r)) t.is(uyg(x, K.husniye), d2.beklenen.husniye, d2.aciklama)
  t.ok(r.hus.validOps(TA).some((o) => b4a.equals(o.inner.authorId, K.kerem.memberId)), 'Kerem\'in işlemi geçerli kümede')
  r.irem.put(TA, null, 'hf.uygulama', { _subj: uye(K.husniye), app_id: d3.appId })
  dagit()
  for (const x of Object.values(r)) {
    t.is(uyg(x, K.husniye), d3.beklenen.husniye, d3.aciklama)
    t.is(uyg(x, K.irem), d3.beklenen.irem)
  }
  t.is(U.kayitlar(r.kerem).size, 1, 'yalnız Hüsniye\'nin kaydı')
})

// Düzey 2.2 ve Kerem'in ek kimliği (APP_ATTACH, RFC-0017)
function ekKimlikliAile (appId) {
  const a = aile({ hus: K.husniye, kerem: K.kerem, defter: E.keremDefter })
  a.defter(T.PROTOCOL_LEVEL, { level: '2.2' }, [K.kerem])
  a.defter(T.APP_ATTACH, {
    deviceCert: E.keremDefter.deviceCert, personId: K.kerem.memberId, appId, sameDevice: true, replaces: null, ceremonyTranscriptHash: b4a.alloc(32, 7)
  }, [E.keremDefter, K.kerem])
  return a
}

test('vektör 8: ek kimlikte APP_ATTACH.appId geçerli; kayıt farklıysa yok sayılır', (t) => {
  const d = durum(8)
  const { r, dagit, uyg } = ekKimlikliAile(d.attach)
  t.is(U.kendiKaydiniYaz(r.defter, d.appId), 'yazildi', 'ek kimlik de yazar (§3.3 madde 1)')
  dagit()
  t.is(U.kayitlar(r.hus).get(hex(E.keremDefter.memberId)).appId, d.appId, 'kayıt var')
  t.is(uyg(r.hus, E.keremDefter), d.beklenen.keremDefter, d.aciklama)
})

test('vektör 9: kişide üç durum — var, yok, bilinmiyor', (t) => {
  const [d1, d2, d3] = V.durumlar.filter((d) => d.no === 9)
  const { r, dagit } = ekKimlikliAile('yuva-hat')
  t.is(kisiDurumu(r.hus, K.kerem, d1.urun), d1.beklenen, d1.aciklama)
  t.is(kisiDurumu(r.hus, K.kerem, 'yuva-hat'), 'var', 'ek kimliğin uygulaması')
  U.kendiKaydiniYaz(r.kerem, d2.appId)
  dagit()
  t.is(kisiDurumu(r.hus, K.kerem, d2.urun), d2.beklenen, d2.aciklama)
  t.is(kisiDurumu(r.hus, K.kerem, d3.urun), d3.beklenen, d3.aciklama)
  t.is(kisiDurumu(r.hus, K.husniye, d3.urun), 'bilinmiyor', 'kaydı olmayan kişi')
})

test('vektör 10: ROTATE_DEVICE — eski kimliğin kaydı yeni kimliğe geçmez', (t) => {
  const d = durum(10)
  const L = anaDefter()
  L.apply(ekle(L, K.u5, 'yetiskin', [K.kerem, K.husniye]))
  const { r, dagit, defter, uyg } = aile({ hus: K.husniye, kerem: K.kerem, u5: K.u5 }, L)
  t.is(U.kendiKaydiniYaz(r.u5, d.appId), 'yazildi')
  dagit()
  t.is(kisiDurumu(r.hus, K.u5, d.urun), 'var', 'değişimden önce')
  defter(T.ROTATE_DEVICE, { oldMemberId: K.u5.memberId, newDeviceCert: K.u6.deviceCert, ceremonyTranscriptHash: b4a.alloc(32, 7) }, [K.u6, K.kerem, K.husniye])
  t.is(uyg(r.hus, K.u5), null, 'pasif kimliğin kaydı sayılmaz')
  t.is(uyg(r.hus, K.u6), null, 'yeni kimliğe geçmez')
  t.is(kisiDurumu(r.hus, K.u5, d.urun), d.beklenen, d.aciklama)
  t.ok(U.kayitlar(r.hus).has(hex(K.u5.memberId)), 'eski kayıt geçerli kümede kalır (_subj çözülmez)')
})

test('vektör 11: cihaz ve kutu kendi sınıfına uymaz', (t) => {
  const d = durum(11)
  const { r, dagit } = aile({ hus: K.husniye, kerem: K.kerem })
  U.kendiKaydiniYaz(r.hus, 'yuva-acil')
  dagit()
  const ops = r.kerem.validOps(TA)
  const st = reduceAll(ops).values().next().value
  t.ok(sinifaUyar('hf.uygulama', 'ebeveyn', ops[0], st), 'sahibin işlemi')
  for (const rol of d.roller) t.is(sinifaUyar('hf.uygulama', rol, ops[0], st), d.beklenen, rol)
  t.absent(sinifaUyar('hf.uygulama', null, ops[0], st), 'misafir (rolsüz)')
  t.absent(sinifaUyar('hf.uygulama', 'ebeveyn'), 'kayıt durumu olmadan uymaz')
  // Kutu yazmaz (§3.3 madde 1); misafir ve cihaz üye değildir
  const b = aile({ hus: K.husniye, kutu: K.kutu })
  t.is(U.kendiKaydiniYaz(b.r.kutu, 'yuva-acil'), null, 'kutu')
  t.is(U.kendiKaydiniYaz(replika(anaDefter(), C.isci1), 'yuva-acil'), null, 'cihaz')
})

test('vektör 12: yazar sınıfını bilmeyen sürüm kaydı hata vermeden eşitler', (t) => {
  const d = durum(12)
  const { r, dagit } = aile({ hus: K.husniye, kerem: K.kerem, irem: K.irem })
  U.kendiKaydiniYaz(r.hus, 'yuva-acil')
  r.irem.put(TA, null, 'hf.uygulama', { _subj: uye(K.husniye), app_id: 'yuva-pati' })
  dagit()
  const ops = r.kerem.validOps(TA)
  t.is(ops.length, 2)
  for (const o of ops) t.is(r.kerem.status(hex(o.opId)).status, d.beklenen)
  t.is([...reduceAll(ops).values()].filter((st) => st.type === 'hf.uygulama').length, 2, 'sınıfsız birleştirme iki kaydı da görür')
})

test('yazma (§3.3 madde 1, 4): bir kez; anahtar yoksa kuyrukta; appId değişince güncellenir; düzey 2.0 ve misafir yazmaz', (t) => {
  const { r, dagit, uyg } = aile({ hus: K.husniye, kerem: K.kerem, ecem: K.ecem })
  t.is(U.kendiKaydiniYaz(r.ecem, 'yuva-acil'), 'yazildi', 'çocuk da yazar')
  t.is(U.kendiKaydiniYaz(r.ecem, 'yuva-acil'), 'var')
  dagit()
  t.is(uyg(r.hus, K.ecem), 'yuva-acil')
  t.is(U.kendiKaydiniYaz(r.ecem, 'yuva-pati'), 'yazildi', 'appId farklı: aynı kayıt güncellenir')
  dagit()
  t.is(uyg(r.hus, K.ecem), 'yuva-pati')
  t.is(U.kayitlar(r.hus).size, 1)
  t.is(U.kendiKaydiniYaz(r.ecem, 'Gecersiz'), null)
  // Anahtar gelmeden: yazım kuyrukta bekler, ikinci kez yazılmaz
  const L = anaDefter()
  const tek = replika(L, K.irem, { otomatikAnahtar: false })
  t.is(U.kendiKaydiniYaz(tek, 'yuva-acil'), 'yazildi')
  t.is(U.kendiKaydiniYaz(tek, 'yuva-acil'), 'kuyrukta')
  t.is(tek.writeQueue.length, 1)
  // Düzey 2.0 ailede Tüm Aile yok
  t.is(U.kendiKaydiniYaz(replika(anaDefter(9), K.kerem), 'yuva-acil'), null, 'Tüm Aile yok')
  t.is(U.kendiKaydiniYaz(replika(anaDefter(), C.misafir1), 'yuva-acil'), null, 'misafir')
})
