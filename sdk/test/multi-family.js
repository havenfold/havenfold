// SPDX-License-Identifier: Apache-2.0
// D93: RFC-0034 §4.6 ve §9 — aile başına bildiren uygulama (RFC-0017 §9 tablosu) ve 360'ta familyId (APP_PAIR_REQ2).
// Beklenenler RFC'lerden elle yazıldı.
'use strict'
const test = require('brittle')
const b4a = require('b4a')
const S = require('..')
const { zarf: { Z }, ledger: { Ledger, encodeEvent, decodeEvent } } = require('@havenfold/core')
const { C0, E: EKS } = require('../../core/records/test/helpers/multi-vector')
const D = require('../../core/core/test/helpers/ledger')

const F1 = 'a1'.repeat(32) // Eser ailesi
const F2 = 'b2'.repeat(32) // Saadet'in evi
const hataOf = (f) => { try { f(); return null } catch (err) { return err.message } }

test('reportingApp: aile başına seçilir; o ailede kimliği olmayan uygulama aday değil; geri düşme ana kimlik, sonra appId sırası', (t) => {
  // Hüsniye'nin telefonu (RFC-0034 §4.6 örneği): Yuva Hat yalnız Eser'de (ana), Yuva Bakım Eser'de ek, Saadet'in evinde ana
  const uygulamalar = [
    { appId: 'yuva-hat', aileler: [{ familyId: F1, kimlik: 'ana' }] },
    { appId: 'yuva-bakim', aileler: [{ familyId: F1, kimlik: 'ek' }, { familyId: F2, kimlik: 'ana' }] }
  ]
  const b = (familyId, olay, kayitTuru) => S.reportingApp({ uygulamalar, familyId, olay, kayitTuru })
  t.is(b(F1, 'mesaj'), 'yuva-hat')
  t.is(b(F2, 'mesaj'), 'yuva-bakim', 'Saadet\'in evinde Yuva Hat yok: o ailedeki ana kimlik')
  t.is(b(F1, 'vaka', 'yuva.bakim.ugradi'), 'yuva-bakim')
  t.is(b(F2, 'vaka', 'yuva.bakim.ugradi'), 'yuva-bakim')
  t.is(b(F1, 'vaka', 'yuva.pet.beslenme'), 'yuva-hat', 'Pati yok: Eser\'deki ana kimlik (Yuva Hat)')
  t.is(b(F1, 'cekirdek'), 'yuva-hat', 'çekirdek bildirimi o ailedeki ana kimlik')
  t.is(b(F2, 'cekirdek'), 'yuva-bakim')
  t.is(b(F1, 'sos'), 'yuva-hat', 'Acil yok: ana kimlik')
  t.is(b('c3'.repeat(32), 'mesaj'), null, 'bu ailede uygulama yok')
  // Ana kimlik bilgisi yoksa appId sırasıyla ilk
  t.is(S.reportingApp({ uygulamalar: [{ appId: 'yuva-pati', aileler: [{ familyId: F1, kimlik: 'ek' }] }, { appId: 'yuva-defteri', aileler: [{ familyId: F1, kimlik: 'ek' }] }], familyId: F1, olay: 'cekirdek' }), 'yuva-defteri')
  t.is(S.reportingApp({ uygulamalar: [{ appId: 'yuva-acil', aileler: [{ familyId: F1, kimlik: 'ek' }] }, ...uygulamalar], familyId: F1, olay: 'sos' }), 'yuva-acil')
  t.is(hataOf(() => b('x', 'mesaj')), 'NO_FAMILY')
  t.is(hataOf(() => b(F1, 'baska')), 'INVALID_EVENT')
})

test('360 pairRequest({ familyId }): APP_PAIR_REQ2; başka ailenin ana kimliği NO_FAMILY; doğru ailede eşleşir', (t) => {
  const L = new Ledger({ now: () => D.TS0 })
  for (const e of C0) L.apply(decodeEvent(encodeEvent(e)))
  let saat = D.TS0
  const ailesiz = S.LedgerApi.withoutFamily({ Ledger, me: EKS.keremU3, appId: 'yuva-bakim', now: () => ++saat })
  const ana = new S.LedgerApi({ ledger: L, me: D.K.kerem, now: () => ++saat })
  const istek = ailesiz.pairRequest('yuva-bakim', { familyId: b4a.toString(L.familyId, 'hex') })
  t.is(ailesiz.pairKind, Z.APP_PAIR_REQ2)
  const { event } = ailesiz.pairAccept(ana.pairApprove(istek, { approved: true }))
  t.ok(event, 'eşleşti')
  const baska = ailesiz.pairRequest('yuva-bakim', { familyId: 'cd'.repeat(32) })
  t.is(hataOf(() => ana.pairApprove(baska, { approved: true })), 'NO_FAMILY')
  t.is(hataOf(() => ailesiz.pairRequest('yuva-bakim', { familyId: 'x' })), 'NO_FAMILY')
  ailesiz.pairRequest('yuva-bakim')
  t.is(ailesiz.pairKind, Z.APP_PAIR_REQ, 'familyId yoksa 0xE8')
})
