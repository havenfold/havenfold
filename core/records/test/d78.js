// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D78: misafirin bıraktığı REC_DROP (RFC-0030 §4; RFC-0001 §7 koşul 6). Yazar misafir, ledgerSeq anında GRANT_WRITE,
// izinli tür ve özne, op = 2, eksiz, ≤ 4 KB; REVOKE ve types boş izinden sonra atılır, öncesi kesimle kalır.
const test = require('brittle')
const b4a = require('b4a')
const c = require('compact-encoding')
const sodium = require('sodium-native')
const { Replika, appendRecordId, dropOpIdOf, dropSigDigest, MAX_MISAFIR_BIRAKMA } = require('../replica')
const { OP, encodeInner, recDrop } = require('../encoding')
const A = require('../key')
const I = require('../operation')
const { fromMs } = require('../hlc')
const V = require('../../core/test/helpers/v21')
const { Ledger } = require('@havenfold/core').ledger

const { C, K, T, TS0, hex, olay, anaAdimlar, koleksiyon, misafirEkle, misafirKaldir, K_TUM_AILE, VARLIK_KEDI } = V
const COKI = 'varlik:' + hex(VARLIK_KEDI)
const MISAFIR = C.misafir2

function kurulum () {
  const L = new Ledger()
  for (const f of anaAdimlar(L)) L.apply(f())
  L.apply(olay(L, T.PROTOCOL_LEVEL, { level: '2.2' }, [K.kerem]))
  L.apply(olay(L, T.PROTOCOL_LEVEL, { level: '2.3' }, [K.kerem]))
  L.apply(misafirEkle(L, MISAFIR, [K.kerem]))
  const dk = { publicKey: b4a.alloc(32), secretKey: b4a.alloc(32) }
  sodium.crypto_box_keypair(dk.publicKey, dk.secretKey)
  L.apply(koleksiyon(L, [K.kerem], { dropKey: dk.publicKey }))
  const izin = (x = {}) => L.apply(olay(L, T.GRANT_WRITE, { grantId: MISAFIR.memberId, collectionId: K_TUM_AILE, types: ['yuva.pet.beslenme'], subjects: [COKI], ...x }, [K.husniye]))
  izin()
  const r = new Replika({ ledger: L, me: K.kerem, now: () => TS0 + 3_600_000 })
  r.sync()
  r.addDropSecret(hex(K_TUM_AILE), dk.secretKey)
  let n = 0
  // op'u zorlamayan mühürleme (sealDrop op'u 2 yapar; op = 1 denemesi için)
  const muhurle = (inner, signer = MISAFIR) => {
    const pt = encodeInner(inner)
    const sealed = b4a.alloc(pt.byteLength + sodium.crypto_box_SEALBYTES)
    sodium.crypto_box_seal(sealed, pt, dk.publicKey)
    const w = { collectionId: K_TUM_AILE, dropKeyHash: A.dropKeyHashOf(dk.publicKey), sealed, sig: null }
    w.sig = I.sign(dropSigDigest(L.familyId, dropOpIdOf(w)), signer.signKeyPair.secretKey)
    return c.encode(recDrop, w)
  }
  const birak = ({ type = 'yuva.pet.beslenme', subj = COKI, fields = [], op = OP.APPEND, seq = L.len - 1, signer = MISAFIR } = {}) => {
    const hlc = fromMs(TS0 + 1000) + BigInt(n++)
    const inner = {
      recordId: appendRecordId(signer.memberId, hlc), op, type, hlc, authorId: signer.memberId, ledgerSeq: seq, ledgerHash: L.hashAt(seq),
      fields: [{ name: '_subj', value: subj }, { name: '_t', value: TS0 }, { name: '_v', value: 1 }, ...fields]
    }
    const res = r.receiveOp(muhurle(inner, signer), 1)
    return res.status === 'gecerli' ? 'gecerli' : res.code
  }
  return { L, r, izin, birak }
}

test('D78: izinli tür ve öznede misafirin bırakması geçerli; koşul 3–6', (t) => {
  const { r, birak } = kurulum()
  t.is(birak(), 'gecerli')
  t.is(birak({ type: 'yuva.pet.su' }), 'TYPE_NOT_ALLOWED')
  t.is(birak({ subj: 'uye:' + hex(K.ecem.memberId) }), 'SUBJECT_NOT_ALLOWED')
  t.is(birak({ op: OP.PUT }), 'INVALID_OPERATION_TYPE', 'op = 1')
  t.is(birak({ fields: [{ name: 'foto', value: { blobId: b4a.alloc(32, 1), fileKey: b4a.alloc(32, 2), size: 10, mime: 'image/jpeg', name: 'a.jpg' } }] }), 'EXTRA_FORBIDDEN')
  t.is(birak({ fields: [{ name: 'liste', value: [[{ blobId: b4a.alloc(32, 1), fileKey: b4a.alloc(32, 2), size: 10, mime: 'x', name: 'y' }]] }] }), 'EXTRA_FORBIDDEN', 'liste içinde de')
  t.is(birak({ fields: [{ name: 'not', value: 'x'.repeat(MAX_MISAFIR_BIRAKMA) }] }), 'DROP_TOO_LARGE')
  t.is(birak({ signer: C.misafir1 }), 'NO_PERMISSION', 'izni olmayan (kaldırılmış) misafir')
  t.is(MAX_MISAFIR_BIRAKMA, 4096)
  t.is(r.validOps(hex(K_TUM_AILE)).length, 1)
})

test('D78: izin değişince eski ledgerSeq eski izinle; types boş izinden sonra atılır', (t) => {
  const { L, izin, birak } = kurulum()
  const eski = L.len - 1
  izin({ types: ['yuva.pet.su'] })
  t.is(birak({ type: 'yuva.pet.beslenme' }), 'TYPE_NOT_ALLOWED', 'yeni izinde yok')
  t.is(birak({ type: 'yuva.pet.su' }), 'gecerli')
  t.is(birak({ type: 'yuva.pet.beslenme', seq: eski }), 'gecerli', 'işlem anındaki izin')
  izin({ types: [] })
  t.is(birak({ type: 'yuva.pet.su' }), 'NO_PERMISSION')
})

test('D78: REVOKE sonrası bırakma atılır; öncekiler kesimle kalır (RFC-0001 §8)', (t) => {
  const { L, r, birak } = kurulum()
  const once = L.len - 1
  t.is(birak(), 'gecerli')
  L.apply(misafirKaldir(L, MISAFIR, [K.kerem]))
  r.sync()
  t.is(birak(), 'NO_PERMISSION', 'REVOKE\'tan sonraki ledgerSeq')
  t.is(r.validOps(hex(K_TUM_AILE)).length, 1, 'REVOKE\'tan önce gelen kesimde, geçerli kalır')
  t.is(birak({ seq: once }), 'NOT_IN_CUTOFF', 'kesimden sonra gelen eski işlem')
})

test('D78: misafir telefonu GUEST_VIEW iziniyle bırakır; aile telefonu kabul eder (RFC-0030 §6)', (t) => {
  const { guestView: GV } = require('@havenfold/core')
  const { birakmaHazirla } = require('../guest')
  const { L, r } = kurulum()
  const gv = GV.acceptGuestView(null, GV.buildGuestView(L, hex(MISAFIR.memberId), K.kerem), MISAFIR.memberId)
  const alan = (subj) => [{ name: '_subj', value: subj }, { name: '_t', value: TS0 }, { name: '_v', value: 1 }]
  const hazirla = (x = {}) => birakmaHazirla({ gv, signer: MISAFIR, collectionId: hex(K_TUM_AILE), type: 'yuva.pet.beslenme', fields: alan(COKI), hlc: fromMs(TS0 + 2000), ...x })
  const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
  t.is(hataOf(() => hazirla({ collectionId: hex(V.K_OLAYLAR) })), 'NOT_PERMITTED')
  t.is(hataOf(() => hazirla({ type: 'yuva.pet.su' })), 'TYPE_NOT_ALLOWED')
  t.is(hataOf(() => hazirla({ fields: alan('uye:' + hex(K.ecem.memberId)) })), 'SUBJECT_NOT_ALLOWED')
  t.is(hataOf(() => hazirla({ fields: [...alan(COKI), { name: 'f', value: { blobId: b4a.alloc(32), fileKey: b4a.alloc(32), size: 1, mime: 'x', name: 'y' } }] })), 'EXTRA_FORBIDDEN')
  t.is(hataOf(() => hazirla({ fields: [...alan(COKI), { name: 'not', value: 'x'.repeat(4096) }] })), 'DROP_TOO_LARGE')
  const b = hazirla()
  const res = r.receiveOp(b.bytes, 1)
  t.alike([res.status, res.opId], ['gecerli', hex(b.opId)])
  t.is(r.rolAt(hex(MISAFIR.memberId), L.len - 1), null, 'misafirin rolü yok: hf. türü kaydına katılmaz')
})

test('D78: ağ girişi — misafirden REC_OPS yalnız bırakma öğeleriyle (RFC-0030 §4)', (t) => {
  require('..') // REC_OPS çözücüsü kayıt paketiyle kaydolur
  const { giris, zarf: { Z } } = require('@havenfold/core')
  const { recOps } = require('../sync')
  const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
  const gelen = (items) => hataOf(() => giris.gelenZarf({ myRole: 'uye', peerRole: 'misafir', type: Z.REC_OPS, bytes: c.encode(recOps, { items }), yol: 'dogrudan' }))
  t.is(gelen([{ kind: 1, bytes: b4a.alloc(4) }, { kind: 1, bytes: b4a.alloc(4) }]), null)
  t.is(gelen([{ kind: 1, bytes: b4a.alloc(4) }, { kind: 0, bytes: b4a.alloc(4) }]), 'TYPE_NOT_ALLOWED', 'misafir işlem yazamaz')
  t.is(hataOf(() => giris.gelenZarf({ myRole: 'uye', peerRole: 'cihaz', type: Z.REC_OPS, bytes: c.encode(recOps, { items: [{ kind: 0, bytes: b4a.alloc(4) }] }), yol: 'dogrudan' })), null, 'cihazda değişiklik yok')
  for (const tur of [Z.REC_CUTOFF, Z.REC_PRUNE, Z.GUEST_VIEW]) t.is(hataOf(() => giris.gelenZarf({ myRole: 'uye', peerRole: 'misafir', type: tur, bytes: b4a.alloc(0), yol: 'dogrudan' })), 'TYPE_NOT_ALLOWED')
})
