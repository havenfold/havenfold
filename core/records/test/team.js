// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// RFC-0005 §18 vektör 9: yer: okuyuculu koleksiyonda çalışan başka yere atanınca yeni dönem; yeni dönemde okuyucu değil
const test = require('brittle')
const b4a = require('b4a')
const { ledger: { Ledger, T }, policy: { DEFAULT_POLICY } } = require('@havenfold/core')
const { Yetki } = require('../permission')
const V = require('../../core/test/helpers/v21')

const { K, hex, olay, ekle, genesis, TS0 } = V
const YER_A = b4a.alloc(16, 0xa1)
const YER_B = b4a.alloc(16, 0xb2)
const CID = b4a.alloc(16, 0x51)

test('ekip 9: yer:A/rol:calisan okuyucusu B\'ye atanınca yeni dönem başlar ve okuyucu değildir', (t) => {
  const L = new Ledger({ now: () => TS0 })
  L.apply(genesis())
  L.apply(olay(L, T.KIND, { kind: 'ekip' }, [K.kerem]))
  L.apply(olay(L, T.PROTOCOL_LEVEL, { level: '2.1' }, [K.kerem]))
  L.apply(olay(L, T.POLICY, { policy: { ...DEFAULT_POLICY, maxMembers: 32 } }, [K.kerem]))
  for (const p of [YER_A, YER_B]) L.apply(olay(L, T.PLACE, { placeId: p, name: 'Şube', kind: 'sube', remove: false }, [K.kerem]))
  L.apply(ekle(L, K.irem, 'calisan', [K.kerem]))
  L.apply(olay(L, T.ASSIGN, { subjectId: K.irem.memberId, placeIds: [YER_A] }, [K.kerem]))
  const yerA = 'yer:' + hex(YER_A) + '/rol:calisan'
  L.apply(olay(L, T.COLLECTION, { collectionId: CID, name: 'Yer:A', kind: 'genel', readers: ['rol:sahip', yerA], writers: ['rol:sahip', yerA], sensitivity: 'normal', taskAccess: true, history: true, dropKey: b4a.alloc(32) }, [K.kerem]))
  const y = new Yetki()
  y.update(L)
  const cid = hex(CID)
  t.ok(y.isReader(cid, hex(K.irem.memberId), L.len - 1))
  t.ok(y.isWriter(cid, hex(K.irem.memberId), L.len - 1))
  const once = y.epochs(cid).length
  L.apply(olay(L, T.ASSIGN, { subjectId: K.irem.memberId, placeIds: [YER_B] }, [K.kerem]))
  y.update(L)
  t.is(y.epochs(cid).length, once + 1, 'yeni dönem')
  const son = y.epochs(cid)[y.epochs(cid).length - 1]
  t.absent(son.readers.has(hex(K.irem.memberId)), 'yeni dönemde okuyucu değil')
  t.absent(y.isWriter(cid, hex(K.irem.memberId), L.len - 1), 'yazarlığı bitti (kesim)')
})

test('ekip 10 ve 11: geçicinin TERM\'i aşan işlemi hariç, yeni TERM geri getirir; TERM yoksa anahtar gitmez; TERM çalışana NOT_TARGET_TEMPORARY', (t) => {
  const { Replika } = require('../replica')
  const { replika, teslim, kopya } = require('./helpers/family')
  let simdi = TS0 + 3_600_000
  const now = () => simdi
  const L = new Ledger({ now: () => TS0 })
  L.apply(genesis())
  L.apply(olay(L, T.KIND, { kind: 'ekip' }, [K.kerem]))
  L.apply(olay(L, T.PROTOCOL_LEVEL, { level: '2.1' }, [K.kerem]))
  L.apply(olay(L, T.POLICY, { policy: { ...DEFAULT_POLICY, maxMembers: 32 } }, [K.kerem]))
  L.apply(olay(L, T.PLACE, { placeId: YER_A, name: 'Şube', kind: 'sube', remove: false }, [K.kerem]))
  L.apply(ekle(L, K.husniye, 'calisan', [K.kerem]))
  L.apply(ekle(L, K.irem, 'gecici', [K.kerem]))
  t.exception(() => L.check(olay(L, T.TERM, { memberId: K.husniye.memberId, expiresAt: TS0 }, [K.kerem])), /NOT_TARGET_TEMPORARY/)
  L.apply(olay(L, T.ASSIGN, { subjectId: K.irem.memberId, placeIds: [YER_A] }, [K.kerem]))
  const yerA = 'yer:' + hex(YER_A) + '/rol:gecici'
  L.apply(olay(L, T.COLLECTION, { collectionId: CID, name: 'Yer:A', kind: 'genel', readers: ['rol:sahip', yerA], writers: ['rol:sahip', yerA], sensitivity: 'normal', taskAccess: true, history: true, dropKey: b4a.alloc(32) }, [K.kerem]))
  const kerem = replika(L, K.kerem, { now })
  const giden = kerem.outbox.filter((m) => m.type === 0x82)
  t.ok(giden.length > 0)
  t.absent(giden.some((m) => (m.to || []).includes(hex(K.irem.memberId))), 'TERM yok: geçiciye anahtar gitmez')
  // Süre: TS0 + 2 saat
  L.apply(olay(L, T.TERM, { memberId: K.irem.memberId, expiresAt: TS0 + 2 * 3_600_000 }, [K.kerem]))
  kerem.sync()
  const irem = new Replika({ ledger: kopya(L), me: K.irem, now, otomatikAnahtar: false })
  for (const m of kerem.answerKeyReq(hex(K.irem.memberId), require('../key').encodeRecKeyReq({ collectionId: CID, epochs: kerem.yetki.epochs(hex(CID)).map((e) => e.seq) }))) if (m.type === 0x82) irem.receiveKey(m.bytes)
  irem.sync()
  const rid = irem.put(hex(CID), null, 'yuva.x', { a: 1 }) // hlc TS0 + 1 sa: süre içinde
  simdi = TS0 + 3 * 3_600_000
  irem.put(hex(CID), null, 'yuva.x', { a: 2 }) // süre dışında
  teslim(irem, kerem)
  t.ok(kerem.get(hex(CID), rid))
  t.is(kerem.records(hex(CID)).length, 1, 'TERM\'i aşan işlem hariç')
  // Uzatma: yeni TERM
  const uzat = olay(L, T.TERM, { memberId: K.irem.memberId, expiresAt: TS0 + 10 * 3_600_000 }, [K.kerem])
  L.apply(uzat)
  kerem.sync()
  t.is(kerem.records(hex(CID)).length, 2, 'yeni TERM geri getirir')
})

test('ekip 12: iş kapsamı silme — anahtarlar ve işlemler gider', (t) => {
  const { anaDefter, replika, K_TUM_AILE } = require('./helpers/family')
  const r = replika(anaDefter(), K.husniye)
  r.put(hex(K_TUM_AILE), null, 'yuva.x', { a: 1 })
  t.ok(r.ops.size > 0)
  t.ok(r.isKapsaminiSil() > 0)
  t.is(r.ops.size, 0)
  t.is(r.keys.epochList(hex(K_TUM_AILE)).length, 0)
})

test('ekip 14: cihaz kaydı uye: öznesi ya da öznesiz PERSON_EVENT (mezar); yer: ve topluluk geçerli', (t) => {
  const { Replika, sealDrop, appendRecordId } = require('../replica')
  const sodium = require('sodium-native')
  const { encodeInner, OP } = require('../encoding')
  const { fromMs } = require('../hlc')
  const L = new Ledger({ now: () => TS0 })
  L.apply(genesis())
  L.apply(olay(L, T.KIND, { kind: 'ekip' }, [K.kerem]))
  L.apply(olay(L, T.PROTOCOL_LEVEL, { level: '2.1' }, [K.kerem]))
  L.apply(olay(L, T.PLACE, { placeId: YER_A, name: 'Şube', kind: 'sube', remove: false }, [K.kerem]))
  L.apply(V.cihazEkle(L, V.C.isci1, [K.kerem], { placeId: YER_A }))
  const dk = { publicKey: b4a.alloc(32), secretKey: b4a.alloc(32) }
  sodium.crypto_box_keypair(dk.publicKey, dk.secretKey)
  const OL = b4a.alloc(16, 0x61)
  L.apply(olay(L, T.COLLECTION, { collectionId: OL, name: 'Olaylar:A', kind: 'olaylar', readers: ['rol:sahip'], writers: ['rol:sahip', 'device:' + hex(V.C.isci1.memberId)], sensitivity: 'normal', taskAccess: true, history: true, dropKey: dk.publicKey }, [K.kerem]))
  const r = new Replika({ ledger: L, me: K.kerem, now: () => TS0 + 3_600_000 })
  r.sync()
  r.addDropSecret(hex(OL), dk.secretKey)
  let n = 0
  const birak = (fields) => {
    const hlc = fromMs(TS0 + 1000) + BigInt(n++)
    return r.receiveOp(sealDrop({ familyId: L.familyId, collectionId: OL, dropKey: dk.publicKey, signer: V.C.isci1, inner: { recordId: appendRecordId(V.C.isci1.memberId, hlc), op: OP.APPEND, type: 'mekan.kasa.bos', fields: Object.entries(fields).map(([name, value]) => ({ name, value })), hlc, authorId: V.C.isci1.memberId, ledgerSeq: L.len - 1, ledgerHash: L.head } }), 1)
  }
  t.is(birak({ _subj: 'uye:' + hex(K.irem.memberId), _t: TS0 }).code, 'PERSON_EVENT')
  t.is(birak({ _t: TS0 }).code, 'PERSON_EVENT')
  t.is(r.tomb.size, 2, 'mezar listesinde')
  t.is(birak({ _subj: 'yer:' + hex(YER_A), _t: TS0 }).status, 'gecerli')
  t.is(birak({ _subj: 'topluluk', _t: TS0 }).status, 'gecerli')
  void encodeInner
})
