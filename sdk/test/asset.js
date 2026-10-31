// SPDX-License-Identifier: Apache-2.0
// D98: RFC-0003 §5.4 BEING için SDK yöntemi ve kanal komutu (protocol/vectors/asset.json). Ebeveyn ekler ve kaldırır,
// yetişkinin eklemesi öneri olur ve ebeveyn imzasıyla tamamlanır, çocuk, kutu ve misafir reddedilir, iki telefonda
// eşitleme. Beklenenler RFC-0003'ten elle yazıldı.
'use strict'
const test = require('brittle')
const b4a = require('b4a')
const S = require('..')
const { ledger: { Ledger, encodeEvent, decodeEvent }, sync, identity: { createIdentity } } = require('@havenfold/core')
const { ekle, TS0 } = require('../../core/core/test/helpers/ledger')
const V = require('../../protocol/vectors/asset.json')

const kim = (ad) => Object.assign(createIdentity({ seed: 'varlik/' + ad, platform: 'test' }), { ad })
const kopya = (L) => { const K = new Ledger({ now: () => TS0 }); for (const e of L.events) K.apply(decodeEvent(encodeEvent(e))); return K }
const hataOf = (f) => { try { f(); return null } catch (err) { return err.message } }
// İki telefonun defterleri: a'nın eksik olaylarını b'ye (LEDGER_REQ / LEDGER_EVENTS gibi)
const esitle = (a, b) => sync.ingest(b, sync.decodeEvents(sync.encodeEvents(sync.answerReq(a, { fromSeq: b.len }))))
const sonucOf = (rol) => V.yazarlar.find((x) => x.rol === rol)

function aile () {
  const P = kim('Kerem')
  const Y = kim('İrem')
  const C = kim('Ecem')
  const K = kim('Kutu')
  const { ledger: L } = S.LedgerApi.createFamily({ Ledger, me: P, familyName: 'Eser', displayName: 'Kerem', ts: TS0 })
  L.apply(ekle(L, Y, 'yetiskin', [P]))
  L.apply(ekle(L, C, 'cocuk', [P, Y]))
  L.apply(ekle(L, K, 'kutu', [P, Y]))
  let saat = TS0 + 100_000
  const d = (me, L2 = kopya(L)) => new S.LedgerApi({ ledger: L2, me, now: () => ++saat })
  return { L, P, Y, C, K, d }
}

test('asset.json: ebeveyn ekler ve kaldırır; iki telefonda eşitlenir', (t) => {
  for (const k of V.komutlar) t.is(S.LEDGER_COMMAND[k.ad], k.no, k.ad)
  const { P, Y, d } = aile()
  const kerem = d(P)
  const irem = d(Y) // ikinci telefon
  const r = kerem.addBeing({ tur: 'kedi', ad: 'Coki' })
  t.is(r.durum, sonucOf('ebeveyn').sonuc)
  t.ok(/^[0-9a-f]{32}$/.test(r.varlikId))
  t.alike(kerem.beings(), [{ varlikId: r.varlikId, tur: 'kedi', ad: 'Coki', yerId: null }])
  t.alike(irem.beings(), [], 'eşitlenmeden önce öbür telefonda yok')
  t.ok(esitle(kerem.L, irem.L).added, 'olay öbür telefona geçti')
  irem.changed()
  t.alike(irem.beings(), kerem.beings(), 'iki telefonda aynı')
  // Kaldırma
  const k = kerem.removeBeing(r.varlikId)
  t.is(k.durum, 'uygulandi')
  t.alike(kerem.beings(), [])
  esitle(kerem.L, irem.L)
  t.alike(irem.beings(), [], 'kaldırma da eşitlendi')
  t.is(hataOf(() => kerem.removeBeing(r.varlikId)), 'NO_TARGET')
  t.is(hataOf(() => kerem.removeBeing('ab'.repeat(16))), 'NO_TARGET')
})

test('asset.json: yetişkinin eklemesi öneri, ebeveyn imzalayınca uygulanır; çocuk, kutu ve misafir reddedilir', (t) => {
  const { P, Y, C, K, d } = aile()
  const kerem = d(P)
  const irem = d(Y)
  const r = irem.addBeing({ tur: 'kopek', ad: 'Paşa' })
  t.is(r.durum, sonucOf('yetiskin').sonuc)
  t.alike(r.waitingFor.length > 0, true)
  t.alike(irem.beings(), [], 'öneri uygulanmadı')
  // Öneri ebeveynin telefonuna gider (LEDGER_PROPOSE), ebeveyn imzalar
  const { oneriId } = kerem.receiveProposal(b4a.toString(Y.memberId, 'hex'), encodeEvent(irem.oneriler.get(r.oneriId)), 'dogrudan')
  t.is(kerem.sign(oneriId).durum, 'uygulandi')
  t.alike(kerem.beings().map((v) => v.ad), ['Paşa'])
  t.is(hataOf(() => d(C).addBeing({ tur: 'kedi', ad: 'X' })), sonucOf('cocuk').hata)
  t.is(hataOf(() => d(K).addBeing({ tur: 'kedi', ad: 'X' })), sonucOf('kutu').hata)
  t.is(hataOf(() => d(kim('Misafir')).addBeing({ tur: 'kedi', ad: 'X' })), sonucOf('misafir').hata)
  t.is(hataOf(() => d(C).removeBeing(kerem.beings()[0].varlikId)), 'PARENT_REQUIRED', 'kaldırma da')
})

test('asset.json: gövde sınırları, yer, 32 varlık sınırı, düzey', (t) => {
  const { L, P, d } = aile()
  const kerem = d(P)
  t.is(hataOf(() => kerem.addBeing({ tur: '', ad: 'Coki' })), 'INVALID_BODY')
  t.is(hataOf(() => kerem.addBeing({ tur: 'k'.repeat(V.sinirlar.turBayt + 1), ad: 'Coki' })), 'INVALID_BODY')
  t.is(hataOf(() => kerem.addBeing({ tur: 'kedi', ad: ' ' })), 'INVALID_BODY')
  t.is(hataOf(() => kerem.addBeing({ tur: 'kedi', ad: 'a'.repeat(V.sinirlar.adBayt + 1) })), 'INVALID_BODY')
  t.is(hataOf(() => kerem.addBeing({ tur: 'kedi', ad: 'Coki', yerId: 'ab'.repeat(16) })), 'NO_PLACE', 'yer defterde olmalı')
  t.is(hataOf(() => kerem.addBeing({ tur: 'kedi', ad: 'Coki', varlikId: 'x' })), 'INVALID_BODY')
  // Aynı varlıkId ile yeniden yazmak günceller (ad değişir)
  const id = 'cd'.repeat(16)
  kerem.addBeing({ tur: 'kedi', ad: 'Coki', varlikId: id })
  kerem.addBeing({ tur: 'kedi', ad: 'Coki Hanım', varlikId: id })
  t.alike(kerem.beings().map((v) => v.ad), ['Coki Hanım'])
  for (let i = 1; i < V.sinirlar.aktifVarlik; i++) kerem.addBeing({ tur: 'bitki', ad: 'B' + i })
  t.is(kerem.beings().length, V.sinirlar.aktifVarlik)
  t.is(hataOf(() => kerem.addBeing({ tur: 'bitki', ad: 'fazla' })), 'BEING_LIMIT')
  void L
  // Düzey 2.0 aile: BEING yok
  const P2 = kim('Eski')
  const eski = S.LedgerApi.createFamily({ Ledger, me: P2, familyName: 'Eski', displayName: 'Eski', ts: TS0, hazirla: false }).ledger
  t.is(hataOf(() => new S.LedgerApi({ ledger: eski, me: P2, now: () => TS0 + 5000 }).addBeing({ tur: 'kedi', ad: 'X' })), 'LEVEL_TOO_LOW')
  void b4a
})
