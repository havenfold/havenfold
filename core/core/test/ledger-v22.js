// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
const test = require('brittle')
const b4a = require('b4a')
const { Ledger, T, signEvent, encodeEvent, decodeEvent } = require('../ledger/ledger')
const { ingest, isStrong, forkWinner } = require('../ledger/sync')
const { canTask } = require('../ledger/v21')
const { CAPS } = require('../protocol/hello')
const { CapsBook } = require('../protocol/caps')
const { checkJoinCaps } = require('../protocol/join-hello')
const { createIdentity } = require('../core/identity')
const { K, TS0, olay, ekle, genesis, anaAdimlar, hex, uye, koleksiyon } = require('./helpers/v21')

const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const ek = (ad) => Object.assign(createIdentity({ seed: 'ledger-v22/' + ad, platform: 'test' }), { ad })
const A = ek('a')
const B = ek('b')
const Cx = ek('c')
const attach = (L, e, kisi, x = {}, imz = [kisi]) => olay(L, T.APP_ATTACH, { deviceCert: e.deviceCert, personId: kisi.memberId, appId: 'yuva-defteri', sameDevice: true, replaces: null, ceremonyTranscriptHash: b4a.alloc(32, 7), ...x }, [e, ...imz])

function aile () {
  const L = new Ledger()
  for (const f of anaAdimlar(L)) L.apply(f())
  L.apply(olay(L, T.PROTOCOL_LEVEL, { level: '2.2' }, [K.kerem]))
  return L
}

test('v2.2: düzey yalnız yükselir; 2.0\'dan 2.2\'ye geçilebilir; yetenek biti ve katılım', (t) => {
  const L = aile()
  t.is(L.level, '2.2')
  t.is(hataOf(() => L.check(olay(L, T.PROTOCOL_LEVEL, { level: '2.1' }, [K.kerem]))), 'LEVEL_CANNOT_DOWNGRADE')
  t.is(hataOf(() => checkJoinCaps(L, CAPS.LEDGER_V21)), 'UPDATE_REQUIRED')
  t.is(hataOf(() => checkJoinCaps(L, CAPS.LEDGER_V21 | CAPS.COKLU_UYGULAMA)), null)
  L.apply(attach(L, A, K.irem))
  const book = new CapsBook()
  for (const id of L.activeIds()) book.record(id, CAPS.COKLU_UYGULAMA | CAPS.LEDGER_V21, 0) // 2.2 alt düzeyin bitini de ister
  t.ok(book.levelReady(L, '2.2', { now: 1 }).ok)
  book.record(hex(A.memberId), CAPS.LEDGER_V21, 1)
  t.alike(book.levelReady(L, '2.2', { now: 2 }).missing, [hex(A.memberId)], 'ek kimlikler de kapsanır')
})

test('v2.2: ek kimlik yalnız izinli olayları imzalar', (t) => {
  const L = aile()
  L.apply(attach(L, A, K.irem))
  const pol = olay(L, T.PLACE, { placeId: b4a.alloc(16, 0x44), name: 'x', kind: 'diger', remove: false }, [K.kerem, A])
  t.is(hataOf(() => L.check(pol)), 'SECONDARY_IDENTITY_CANNOT_VOTE')
  t.is(hataOf(() => L.check(olay(L, T.LEAVE, { memberId: K.irem.memberId }, [A]))), 'SECONDARY_IDENTITY_CANNOT_VOTE', 'kişinin ana kimliği adına ayrılamaz')
  t.ok(L.check(olay(L, T.LEAVE, { memberId: A.memberId }, [A])), 'kendi LEAVE\'i')
  t.is(hataOf(() => L.check(olay(L, T.ROTATE_DEVICE, { oldMemberId: A.memberId, newDeviceCert: B.deviceCert, ceremonyTranscriptHash: b4a.alloc(32, 7) }, [B, K.kerem, K.husniye]))), 'INVALID_ROLE')
  // Tek ek kimliği herhangi bir ebeveyn tek imzayla çıkarır
  t.ok(L.check(olay(L, T.REMOVE_MEMBER, { memberId: A.memberId, reason: 'x', wipe: false }, [K.husniye])))
  t.is(hataOf(() => L.check(olay(L, T.REMOVE_MEMBER, { memberId: A.memberId, reason: 'x', wipe: false }, [K.ecem]))), 'NO_PARENT_SIGNATURE')
})

test('v2.2: ek kimlik oyu imza birleştirmede eklenmez; kişi gibi görev verir', (t) => {
  const L = aile()
  L.apply(attach(L, A, K.irem))
  const seq = L.len
  L.apply(olay(L, T.PLACE, { placeId: b4a.alloc(16, 0x45), name: 'x', kind: 'diger', remove: false }, [K.kerem]))
  const kopya = decodeEvent(encodeEvent(L.events[seq]))
  signEvent(kopya, A)
  t.is(L.mergeSigs(seq, kopya.sigs), 0)
  t.ok(canTask(L, hex(A.memberId), 'hf.task.ocr'), 'yetişkin kişinin ek kimliği')
  t.absent(canTask(L, hex(A.memberId), 'hf.task.vision', { continuous: true }))
})

test('v2.2: ana kimlik ayrılınca ek kimlikler de; son ebeveynin kendi ek kimlikleri onu tutmaz', (t) => {
  const L = aile()
  L.apply(attach(L, A, K.irem))
  L.apply(attach(L, B, K.irem, { appId: 'yuva-hat', sameDevice: false }))
  L.apply(olay(L, T.LEAVE, { memberId: K.irem.memberId }, [K.irem]))
  t.absent(L.member(A.memberId).active)
  t.absent(L.member(B.memberId).active)
  t.absent(L.persons.has(hex(K.irem.memberId)))

  const G = new Ledger()
  G.apply(genesis())
  G.apply(olay(G, T.PROTOCOL_LEVEL, { level: '2.2' }, [K.kerem]))
  G.apply(attach(G, Cx, K.kerem))
  t.ok(G.check(olay(G, T.LEAVE, { memberId: K.kerem.memberId }, [K.kerem])), 'tek kişilik ailede ek kimlik başka üye sayılmaz')
})

test('v2.2: eski cihaz imzalı ROTATE_DEVICE — aynı gruptaki ek kimlik kapanır ama silme emri almaz', (t) => {
  const L = aile()
  L.apply(attach(L, A, K.irem))
  L.apply(olay(L, T.ROTATE_DEVICE, { oldMemberId: K.irem.memberId, newDeviceCert: K.u5.deviceCert, ceremonyTranscriptHash: b4a.alloc(32, 7) }, [K.u5, K.irem, K.kerem, K.husniye]))
  t.absent(L.member(A.memberId).active)
  t.absent(L.member(A.memberId).wipe)
  t.is(L.persons.get(hex(K.irem.memberId)).primary, hex(K.u5.memberId))
  t.is(L.canonical(hex(K.irem.memberId)), hex(K.u5.memberId))
})

test('v2.2: kişisel koleksiyon — kişi sahiptir; uye:<ek kimlik> kişiye çözülür', (t) => {
  const L = aile()
  L.apply(attach(L, A, K.irem))
  const cid = b4a.alloc(16, 0x46)
  L.apply(koleksiyon(L, [A], { collectionId: cid, name: 'K', kind: 'kisisel', readers: [uye(A)], writers: [uye(K.irem)], taskAccess: false }))
  t.is(L.collections.get(hex(cid)).owner, hex(K.irem.memberId), 'sahip kişinin ana kimliği')
  t.ok(L.check(koleksiyon(L, [K.irem, A], { collectionId: cid, name: 'K2', kind: 'kisisel', readers: [uye(K.irem)], writers: [uye(K.irem)], taskAccess: false })), 'ana ve ek birlikte')
})

test('v2.2: çatallanma — eski imzalı APP_PRIMARY güçlüdür', (t) => {
  const L = aile()
  L.apply(attach(L, A, K.irem))
  const imzali = olay(L, T.APP_PRIMARY, { personId: K.irem.memberId, newPrimaryId: A.memberId, oldSigned: true }, [A, K.irem])
  const imzasiz = olay(L, T.APP_PRIMARY, { personId: K.irem.memberId, newPrimaryId: A.memberId, oldSigned: false }, [A])
  const ebeveynli = olay(L, T.APP_PRIMARY, { personId: K.irem.memberId, newPrimaryId: A.memberId, oldSigned: false }, [A, K.kerem])
  t.ok(isStrong(imzali, L))
  t.absent(isStrong(imzasiz, L))
  t.ok(isStrong(ebeveynli, L))
  // İki dal: biri eski imzalı APP_PRIMARY, öbürü üç imzalı PLACE. Tek olayda PLACE kazanırdı; güçlü dal kazanır.
  const n = L.len
  const place = olay(L, T.PLACE, { placeId: b4a.alloc(16, 0x47), name: 'x', kind: 'diger', remove: false }, [K.kerem, K.husniye, K.irem])
  t.is(forkWinner(imzali, place), place, 'tek olayda imzacı sayısı')
  const M = Ledger.fromEvents(L.events)
  M.apply(imzali)
  M.apply(olay(M, T.PLACE, { placeId: b4a.alloc(16, 0x48), name: 'y', kind: 'diger', remove: false }, [K.kerem]))
  const Lp = Ledger.fromEvents(L.events)
  Lp.apply(place)
  ingest(Lp, { fromSeq: n, events: M.events.slice(n).map(encodeEvent) })
  t.alike(Lp.head, M.head, 'APP_PRIMARY içeren dal kazandı')
  t.ok(TS0 && ekle)
})
