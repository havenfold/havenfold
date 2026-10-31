// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// İnceleme 7 bulgu 2 (RFC-0022 a): süresi dolmuş ya da TERM'siz geçiciye anahtar yanıtı, eşitleme ve dosya gitmez;
// süre dolunca yönetim telefonu yeni dönem önerir.
const test = require('brittle')
const b4a = require('b4a')
const c = require('compact-encoding')
const { Replika } = require('../replica')
const A = require('../key')
const ES = require('../sync')
const D = require('../file')
const E = require('../../core/test/helpers/team-install')

const { K, T, TS0, hex, olay, ekle, ekip, ata, sure, id, hataOf, YER_A } = E
const CID_A = b4a.alloc(16, 0x51)
const yerKol = (L, cid, yer) => {
  const ozne = (r) => 'yer:' + hex(yer) + '/rol:' + r
  const l = ['rol:sahip', ozne('yonetici'), ozne('calisan'), ozne('gecici')]
  return olay(L, T.COLLECTION, { collectionId: cid, name: 'Yer', kind: 'genel', readers: l, writers: l, sensitivity: 'normal', taskAccess: true, history: true, dropKey: b4a.alloc(32) }, [K.kerem])
}

function kurulum () {
  const saat = { simdi: TS0 + 3_600_000 }
  const now = () => saat.simdi
  const L = ekip()
  L.apply(ekle(L, K.irem, 'gecici', [K.kerem]))
  L.apply(ata(L, K.irem, [YER_A], [K.kerem]))
  L.apply(yerKol(L, CID_A, YER_A))
  const kerem = new Replika({ ledger: L, me: K.kerem, now })
  kerem.sync()
  const istek = () => A.encodeRecKeyReq({ collectionId: CID_A, epochs: kerem.yetki.epochs(hex(CID_A)).map((e) => e.seq) })
  return { saat, L, kerem, istek }
}

test('2: TERM\'siz geçiciye anahtar yanıtı ve eşitleme yok', (t) => {
  const { kerem, istek } = kurulum()
  t.is(hataOf(() => kerem.answerKeyReq(id(K.irem), istek())), 'UNAUTHORIZED')
  t.alike(ES.commonCollections(kerem, id(K.irem)), [])
})

test('2: süre içinde verilir, süre dolunca kesilir; yönetim telefonu yeni dönem önerir', (t) => {
  const { saat, L, kerem, istek } = kurulum()
  L.apply(sure(L, K.irem, TS0 + 2 * 3_600_000))
  kerem.sync()
  t.ok(kerem.answerKeyReq(id(K.irem), istek()).length > 0, 'süre içinde')
  t.ok(ES.commonCollections(kerem, id(K.irem)).includes(hex(CID_A)))
  t.alike(kerem.yeniDonemOnerileri(), [])
  saat.simdi = TS0 + 5 * 3_600_000
  t.is(hataOf(() => kerem.answerKeyReq(id(K.irem), istek())), 'UNAUTHORIZED')
  t.alike(ES.commonCollections(kerem, id(K.irem)), [])
  const ids = c.encode(ES.recIds, { collectionId: CID_A, authorId: K.kerem.memberId, opIds: [] })
  kerem.put(hex(CID_A), null, 'yuva.x', { gizli: 1 })
  t.alike(ES.onIds(kerem, id(K.irem), ids).filter((m) => m.type === 0x81), [], 'REC_OPS gitmez')
  t.alike(kerem.yeniDonemOnerileri(), [{ collectionId: hex(CID_A), geciciler: [id(K.irem)], olay: 'REMOVE_MEMBER', wipe: false }])
})

test('2: BLOB_REQ süresi dolmuş geçiciye yanıtlanmaz', (t) => {
  const { saat, L } = kurulum()
  const S = new D.BlobStore({ ledger: L, now: () => saat.simdi })
  const veri = b4a.alloc(100, 1)
  const blobId = b4a.alloc(32, 3)
  S.blobs.set(hex(blobId), { chunks: [veri], total: 1, uploader: id(K.kerem), complete: true, deleteAt: null })
  const req = c.encode(D.blobReq, { blobId, from: 0, count: 1 })
  t.is(S.answer(req, { from: id(K.kerem) }).length, 1)
  t.is(S.answer(req, { from: id(K.irem) }).length, 0, 'TERM yok')
  t.is(S.answer(req).length, 0, 'ekipte isteyen bilinmeden yanıt yok')
  L.apply(sure(L, K.irem, TS0 + 2 * 3_600_000))
  t.is(S.answer(req, { from: id(K.irem) }).length, 1)
  saat.simdi = TS0 + 5 * 3_600_000
  t.is(S.answer(req, { from: id(K.irem) }).length, 0, 'süre doldu')
})

test('7: cihaz kaydının öznesi defterde var olmalı (PERSON_EVENT)', (t) => {
  const sodium = require('sodium-native')
  const { sealDrop, appendRecordId } = require('../replica')
  const { OP } = require('../encoding')
  const { fromMs } = require('../hlc')
  const { C, cihazEkle } = E
  const L = ekip()
  L.apply(ekle(L, K.irem, 'calisan', [K.kerem]))
  L.apply(cihazEkle(L, C.isci1, [K.kerem], { placeId: YER_A }))
  const dk = { publicKey: b4a.alloc(32), secretKey: b4a.alloc(32) }
  sodium.crypto_box_keypair(dk.publicKey, dk.secretKey)
  const OL = b4a.alloc(16, 0x61)
  L.apply(olay(L, T.COLLECTION, { collectionId: OL, name: 'Olaylar:A', kind: 'olaylar', readers: ['rol:sahip'], writers: ['rol:sahip', 'device:' + hex(C.isci1.memberId)], sensitivity: 'normal', taskAccess: true, history: true, dropKey: dk.publicKey }, [K.kerem]))
  const r = new Replika({ ledger: L, me: K.kerem, now: () => TS0 + 3_600_000 })
  r.sync()
  r.addDropSecret(hex(OL), dk.secretKey)
  let n = 0
  const birak = (subj) => {
    const hlc = fromMs(TS0 + 1000) + BigInt(n++)
    const fields = [{ name: '_subj', value: subj }, { name: '_t', value: TS0 }, { name: 'sure', value: 3600 }]
    const res = r.receiveOp(sealDrop({ familyId: L.familyId, collectionId: OL, dropKey: dk.publicKey, signer: C.isci1, inner: { recordId: appendRecordId(C.isci1.memberId, hlc), op: OP.APPEND, type: 'mekan.personel.sure', fields, hlc, authorId: C.isci1.memberId, ledgerSeq: L.len - 1, ledgerHash: L.head } }), 1)
    return res.code || res.status
  }
  t.is(birak('device:' + id(K.irem)), 'PERSON_EVENT', 'üye kimliği cihaz diye yazılamaz')
  t.is(birak('yer:' + id(K.irem)), 'PERSON_EVENT')
  t.is(birak('varlik:' + 'ab'.repeat(16)), 'PERSON_EVENT', 'olmayan varlık')
  t.is(birak('yer:' + hex(YER_A)), 'gecerli')
  t.is(birak('device:' + hex(C.isci1.memberId)), 'gecerli')
  t.is(birak('topluluk'), 'gecerli')
})
