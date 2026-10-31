// SPDX-License-Identifier: Apache-2.0
// D96: RFC-0036 §3.4 — PERSON_IDENTITIES (362) appId'si kimliğin hf.uygulama kaydından; kisiUygulamaDurumu. Beklenenler
// RFC'den elle yazıldı (vektörler core/records/test/app.js'te).
const test = require('brittle')
const b4a = require('b4a')
const { uygulama: U } = require('@havenfold/records')
const S = require('..')
const A = require('../../core/records/test/helpers/family')

const hex = (b) => b4a.toString(b, 'hex')

function telefon (L, kim, appId) {
  const r = A.replika(L, kim)
  const d = new S.LedgerApi({ ledger: L, me: kim, appId, uygulamaOf: (id) => U.kimlikUygulamasi(L, U.kayitlar(r), id) })
  return { r, d }
}

test('362: başkasının ana kimliğinin appId\'si kaydından; kayıt yoksa null; kisiUygulamaDurumu', (t) => {
  const L = A.anaDefter()
  const hus = telefon(L, A.K.husniye, 'yuva-acil')
  const kerem = telefon(A.kopya(L), A.K.kerem, 'yuva-pati')
  t.is(kerem.d.identities(A.K.husniye.memberId)[0].appId, null, 'kayıt gelmeden bilinmiyor')
  t.is(kerem.d.personAppStatus(hex(A.K.husniye.memberId), 'yuva-acil'), 'bilinmiyor')
  t.is(hus.d.identities()[0].appId, 'yuva-acil', 'kendi kimliğimiz: kayıt yokken kurulumdaki appId')
  t.is(U.kendiKaydiniYaz(hus.r, 'yuva-acil'), 'yazildi')
  for (let i = 0; i < 3; i++) { A.teslim(hus.r, kerem.r); A.teslim(kerem.r, hus.r); hus.r.sync(); kerem.r.sync() }
  t.is(kerem.d.identities(A.K.husniye.memberId)[0].appId, 'yuva-acil', 'kayıttan')
  t.is(kerem.d.personAppStatus(hex(A.K.husniye.memberId), 'yuva-acil'), 'var')
  t.is(kerem.d.personAppStatus(hex(A.K.husniye.memberId), 'yuva-pati'), 'yok', 'tek kimliği biliniyor ve Pati değil')
  t.is(kerem.d.personAppStatus(hex(A.K.irem.memberId), 'yuva-pati'), 'bilinmiyor')
  t.is(kerem.d.personAppStatus('ab'.repeat(16), 'yuva-pati'), 'bilinmiyor', 'tanınmayan kişi')
  t.is(new S.LedgerApi({ ledger: L, me: A.K.kerem }).identities(A.K.husniye.memberId)[0].appId, null, 'uygulamaOf verilmeden eski davranış')
})
