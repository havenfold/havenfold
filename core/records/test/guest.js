// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
const test = require('brittle')
const b4a = require('b4a')
const { guestView: G } = require('@havenfold/core')
const { MisafirReplika, guestEpochs, opsForGuest, keysForGuest } = require('../guest')
const A = require('../key')
const I = require('../operation')
const { fromMs } = require('../hlc')
const { anaDefter, kopya, replika, teslim, K, C, K_BAKICI, K_TUM_AILE, TS0, hex } = require('./helpers/family')

const BK = hex(K_BAKICI)
const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }

function kur () {
  const L = anaDefter(17) // misafir1 aktif; GRANT'ı Kerem imzaladı
  const hus = replika(L, K.husniye) // sıralamada ilk: bakıcı anahtarını üretir
  const kerem = replika(kopya(L), K.kerem)
  teslim(hus, kerem)
  const mid = hex(C.misafir1.memberId)
  const rid = hus.put(BK, null, 'yuva.bakici.not', { ilac: '20:00', not: 'uyku 21:00' })
  teslim(hus, kerem)
  const bytes = G.buildGuestView(kerem.ledger, mid, K.kerem, { epochs: guestEpochs(kerem, mid) })
  const gv = G.acceptGuestView(null, bytes, C.misafir1.memberId)
  return { L, hus, kerem, mid, rid, gv }
}

test('misafir: görünümdeki ebeveynin anahtarı ve writerOf yazarının işlemi kabul edilir', (t) => {
  const { hus, kerem, mid, rid, gv } = kur()
  t.ok(gv.epochs.length >= 1)
  const m = new MisafirReplika(gv)
  for (const k of keysForGuest(kerem, mid)) t.is(m.receiveKey(k).status, 'tamam')
  for (const o of opsForGuest(kerem, mid)) t.is(m.receiveOp(o.bytes).status, 'gecerli')
  t.alike(m.records(BK), hus.records(BK))
  t.is(m.records(BK)[0].recordId, rid)
  t.is(hataOf(() => m.put()), 'GUEST_CANNOT_WRITE')
})

test('misafir: yazar olmayanın işlemi ve ebeveyn olmayanın anahtarı kabul edilmez', (t) => {
  const { L, hus, mid, gv } = kur()
  const m = new MisafirReplika(gv)
  const e = gv.epochs[gv.epochs.length - 1]
  // İrem bakıcı koleksiyonunun okuyucusu değil, görünümde de yok: ürettiği anahtar reddedilir
  const sahte = A.makeKeyEntry({ familyId: L.familyId, collectionId: K_BAKICI, epochSeq: e.epochSeq, epochHash: e.epochHash, key: b4a.alloc(32, 5), issuer: K.irem })
  t.is(m.receiveKey(A.encodeRecKey({ collectionId: K_BAKICI, epochSeq: e.epochSeq, epochHash: e.epochHash, keys: [sahte], dropSecrets: [] })).status, 'reddedildi')
  // Görünümde olmayan dönem
  t.is(m.receiveKey(A.encodeRecKey({ collectionId: K_BAKICI, epochSeq: 3, epochHash: L.hashAt(3), keys: [], dropSecrets: [] })).code, 'EPOCH_MISMATCH')
  for (const k of keysForGuest(hus, mid)) m.receiveKey(k)
  const key = m.keys.preferred(BK, e.epochSeq, e.epochHash).key
  // Ebeveyn anahtarıyla şifrelenmiş ama yazarı writerOf'ta olmayan (İrem) işlem
  const op = I.sealOp({ familyId: L.familyId, collectionId: K_BAKICI, epochSeq: e.epochSeq, key, signer: K.irem, inner: { recordId: b4a.alloc(16, 3), op: 0, type: 'yuva.x', fields: [], hlc: fromMs(TS0), authorId: K.irem.memberId, ledgerSeq: L.len - 1, ledgerHash: L.head } })
  t.is(m.receiveOp(op).code, 'AUTHOR_NOT_IN_VIEW')
  // Misafirin koleksiyonu olmayan işlem
  const ta = [...hus.ops.values()].find((o) => o.cid === hex(K_TUM_AILE))
  if (ta) t.is(m.receiveOp(ta.bytes).code, 'NO_COLLECTION')
  t.is(m.receiveOp(op, 1).code, 'INVALID_OPERATION_TYPE')
})

test('misafir: üye yalnız geçerli işlemleri gönderir; misafirlik bitince hiçbir şey', (t) => {
  const { hus, kerem, mid } = kur()
  t.is(opsForGuest(kerem, mid).length, 1)
  // Hüsniye'nin henüz kesimi/anahtarı ulaşmamış bekleyen işlemi gönderilmez
  const o = [...kerem.ops.values()][0]
  const eski = o.status
  o.status = 'haric'
  t.is(opsForGuest(kerem, mid).length, 0)
  o.status = eski
  const L = hus.ledger
  const { misafirKaldir } = require('./helpers/family')
  L.apply(misafirKaldir(L, C.misafir1, [K.kerem]))
  hus.sync()
  t.is(opsForGuest(hus, mid).length, 0)
})
