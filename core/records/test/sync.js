// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
const test = require('brittle')
const b4a = require('b4a')
const { zarf: { Z } } = require('@havenfold/core')
const E = require('../sync')
const { Kutu, NO_READER_MS } = require('../box')
const { anaDefter, kopya, replika, teslim, K, C, K_TUM_AILE, K_KISISEL_IREM, K_KASA, hex, koleksiyon, uye } = require('./helpers/family')

const TA = hex(K_TUM_AILE)
const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }

// Bellek içi taşıyıcı: iki okuyucu arasında mesajları susana kadar taşır. Dönüş: taşınan mesaj sayısı (türe göre).
function pompala (a, b) {
  const sayac = {}
  const kuyruk = [[a, b, Z.REC_VV, E.vvFor(a, b.meHex)], [b, a, Z.REC_VV, E.vvFor(b, a.meHex)]]
  while (kuyruk.length) {
    const [from, to, type, bytes] = kuyruk.shift()
    sayac[type] = (sayac[type] || 0) + 1
    let out = []
    if (type === Z.REC_VV) out = E.onVv(to, from.meHex, bytes)
    if (type === Z.REC_IDS) out = E.onIds(to, from.meHex, bytes)
    if (type === Z.REC_OPS) E.onOps(to, bytes)
    if (type === Z.REC_KEY_REQ) out = to.answerKeyReq(from.meHex, bytes)
    if (type === Z.REC_KEY) to.receiveKey(bytes)
    if (type === Z.REC_CUTOFF) to.receiveCutoff(bytes)
    for (const m of out) kuyruk.push([to, from, m.type, m.bytes])
    // Yeni anahtar gelince karşı taraf o dönemin işlemlerini isteyebilsin diye özet yeniden gönderilir
    if (type === Z.REC_KEY) kuyruk.push([to, from, Z.REC_VV, E.vvFor(to, from.meHex)])
  }
  return sayac
}

function ikiOkuyucu () {
  const L = anaDefter()
  const hus = replika(L, K.husniye)
  const irem = replika(kopya(L), K.irem)
  hus.outbox.length = 0
  irem.outbox.length = 0
  return { L, hus, irem }
}

test('eşitleme: ayrı yazan iki okuyucu aynı duruma varır; anahtar REC_KEY_REQ ile gelir', (t) => {
  const { hus, irem } = ikiOkuyucu()
  // İrem'in Tüm Aile anahtarı yok: Hüsniye'den eşitlemede ister
  t.is(irem.keys.has(TA, hus.yetki.epochAt(TA, hus.ledger.len - 1).seq, hus.yetki.epochAt(TA, hus.ledger.len - 1).hash), false)
  const r1 = hus.put(TA, null, 'yuva.defter.not', { a: 1 })
  const r2 = hus.put(TA, null, 'yuva.defter.not', { b: 2 })
  hus.put(TA, r1, '', { a: 3 })
  hus.outbox.length = 0
  const sayac = pompala(hus, irem)
  t.ok(sayac[Z.REC_KEY_REQ] >= 1)
  t.alike(irem.records(TA), hus.records(TA))
  t.is(irem.get(TA, r1).fields.a, 3)
  t.ok(irem.get(TA, r2))
  // İrem yazar, tekrar eşitlenir: yalnız eksik gider
  const r3 = irem.put(TA, null, 'yuva.defter.not', { c: 'irem' })
  irem.outbox.length = 0
  const s2 = pompala(hus, irem)
  t.alike(hus.records(TA), irem.records(TA))
  t.ok(hus.get(TA, r3))
  t.ok(s2[Z.REC_OPS] >= 1, 'eksik işlem gitti (çapraz REC_IDS yinelenmiş gönderim yapabilir; alıcı TEKRAR der)')
  // Üçüncü kez: fark yok, REC_IDS yok
  const s3 = pompala(hus, irem)
  t.absent(s3[Z.REC_IDS])
  t.absent(s3[Z.REC_OPS])
})

test('eşitleme: yalnız ortak koleksiyonlar; okuyucu olmayana kişisel koleksiyon gitmez', (t) => {
  const { hus, irem } = ikiOkuyucu()
  const kis = hex(K_KISISEL_IREM)
  irem.put(kis, null, 'yuva.defter.not', { gizli: 1 })
  t.absent(E.commonCollections(irem, hus.meHex).includes(kis))
  pompala(hus, irem)
  t.is(hus.records(kis).length, 0)
  t.is([...hus.ops.values()].filter((o) => o.cid === kis).length, 0)
  // Karşının anahtarı olmayan dönemin işlemi gönderilmez
  const ids = [...irem.ops.values()].filter((o) => o.cid === kis).map((o) => o.opId)
  const sahte = require('compact-encoding').encode(E.recIds, { collectionId: K_KISISEL_IREM, authorId: K.irem.memberId, opIds: [] })
  t.alike(E.onIds(irem, hus.meHex, sahte), [], 'ortak koleksiyon değil')
  t.is(ids.length, 1)
})

test('eşitleme: hariç tutulan işlemler de sayılır; kesimler karşıya geçer', (t) => {
  const { L, hus, irem } = ikiOkuyucu()
  pompala(hus, irem)
  irem.put(TA, null, 'yuva.defter.not', { v: 'A' })
  pompala(hus, irem)
  // İrem yazar listesinden düşer; Hüsniye kesimini yayımlar, Kerem kesimi eşitlemeyle alır
  const e = koleksiyon(L, [K.kerem], { writers: ['rol:ebeveyn', 'rol:cocuk'] })
  L.apply(e)
  hus.sync()
  t.ok(hus.outbox.some((m) => m.type === Z.REC_CUTOFF))
  hus.outbox.length = 0
  const kerem = replika(kopya(L), K.kerem)
  kerem.outbox.length = 0
  pompala(hus, kerem)
  t.alike(kerem.records(TA), hus.records(TA))
  t.is(kerem.records(TA).length, 1, 'kesimdeki işlem geçerli')
  t.is(kerem.cutoffs.unions.size, 1)
})

test('eşitleme: REC_OPS boyut sınırı', (t) => {
  const items = Array.from({ length: 5 }, () => ({ kind: 0, bytes: b4a.alloc(30 * 1024) }))
  t.is(E.packOps(items, E.RELAY_MAX).length, 3)
  for (const b of E.packOps(items, E.RELAY_MAX)) t.ok(b.byteLength <= E.RELAY_MAX)
  t.is(E.packOps(items).length, 1)
  t.is(E.packOps([]).length, 0)
})

// --- Kutu ---------------------------------------------------------------------------------------------------------

function kutuluAile () {
  const L = anaDefter()
  const kutu = new Kutu({ ledger: kopya(L), now: () => 0 })
  const hus = replika(L, K.husniye)
  hus.outbox.length = 0
  return { L, kutu, hus }
}

test('kutu: yalnız okuyucu üyeden kabul; kovalarla iki yönlü eşitleme', (t) => {
  const { L, kutu, hus } = kutuluAile()
  const r1 = hus.put(TA, null, 'yuva.defter.not', { a: 1 })
  const o = [...hus.ops.values()][0]
  t.alike(kutu.accept(hus.meHex, 0, o.bytes), { ok: true, code: null })
  t.is(kutu.accept(hus.meHex, 0, o.bytes).code, 'REPLAY')
  t.is(kutu.accept(hex(K.kutu.memberId), 0, o.bytes).code, 'UNAUTHORIZED', 'kutu kendisi okuyucu değil')
  t.is(kutu.accept(hex(C.isci1.memberId), 0, o.bytes).code, 'UNAUTHORIZED', 'cihaz yalnız REC_DROP bırakır')
  t.is(kutu.accept(hex(K.ecem.memberId), 0, o.bytes).ok, true, 'çocuk Tüm Aile okuyucusu')
  t.is(kutu.accept(hex(K.ecem.memberId), 0, [...hus.ops.values()][0].bytes).code, 'REPLAY')

  // Çevrimdışı İrem kutudan alır: kova özetleri → farklı kova kimlikleri → eksik işlemler
  const irem = replika(kopya(L), K.irem)
  irem.outbox.length = 0
  const set = E.phoneSet(irem, TA)
  const istek = kutu.onBuckets(TA, E.bucketsMsg(TA, set))
  t.ok(istek.length >= 1)
  for (const m of istek) for (const ops of E.onBucketIds(TA, set, m.bytes)) for (const it of E.decodeOps(ops.bytes).items) kutu.accept(irem.meHex, it.kind, it.bytes)
  for (const m of E.onBuckets(TA, set, kutu.bucketsMsg(TA))) for (const ops of kutu.onBucketIds(TA, m.bytes)) E.onOps(irem, ops.bytes)
  t.ok(irem.ops.size >= 1, 'işlem kutudan geldi')
  pompala(hus, irem) // anahtar
  t.is(irem.get(TA, r1).fields.a, 1)
  // İki taraf eşit: farklı kova yok
  t.is(kutu.onBuckets(TA, E.bucketsMsg(TA, E.phoneSet(irem, TA))).length, 0)
})

test('kutu: imzalı REC_PRUNE ile siler; budananı yalnız yazarı yeniden yükleyebilir (RFC-0019 §11.1 r)', (t) => {
  const { kutu, hus } = kutuluAile()
  hus.put(TA, null, 'yuva.defter.not', { a: 1 })
  const o = [...hus.ops.values()][0]
  kutu.accept(hus.meHex, 0, o.bytes)
  const E2 = require('../sync')
  const sahte = E2.makePrune(hus.familyId, TA, [o.opId], C.isci1)
  t.is(kutu.prune(sahte).code, 'UNAUTHORIZED')
  const kiz = E2.makePrune(hus.familyId, TA, [o.opId], K.husniye)
  const bozuk = b4a.from(kiz)
  bozuk[bozuk.byteLength - 1] ^= 1
  t.is(kutu.prune(bozuk).code, 'INVALID_SIGNATURE')
  t.alike(kutu.prune(kiz), { ok: true, code: null })
  t.is(kutu.set(TA).size, 0)
  t.is(kutu.used, 0)
  t.is(kutu.accept(hex(K.kerem.memberId), 0, o.bytes).code, 'TOMBSTONED', 'yazar olmayan okuyucu')
  t.alike(kutu.accept(hus.meHex, 0, o.bytes), { ok: true, code: null }, 'yazarın kendisi')
})

test('kutu: gönderici kotası ve dolu bildirimi', (t) => {
  const L = anaDefter()
  const kutu = new Kutu({ ledger: kopya(L), quota: 1000 })
  const hus = replika(L, K.husniye)
  hus.put(TA, null, 'yuva.defter.not', { a: 'x'.repeat(600) })
  hus.put(TA, null, 'yuva.defter.not', { a: 'y'.repeat(600) })
  const [a, b] = [...hus.ops.values()]
  t.ok(kutu.accept(hus.meHex, 0, a.bytes).ok)
  t.is(kutu.accept(hus.meHex, 0, b.bytes).code, 'BOX_FULL')
  t.is(kutu.events[0].type, 'hf.kayit.kutu-dolu')
  t.ok(kutu.accept(hex(K.kerem.memberId), 0, b.bytes).ok, 'kota gönderici başına')
})

test('kutu: okuyucusu kalmayan koleksiyon 30 gün sonra silinir', (t) => {
  const L = anaDefter()
  let simdi = 0
  const KL = kopya(L)
  const kutu = new Kutu({ ledger: KL, now: () => simdi })
  const hus = replika(L, K.husniye)
  hus.put(TA, null, 'yuva.defter.not', { a: 1 })
  kutu.accept(hus.meHex, 0, [...hus.ops.values()][0].bytes)
  const e = koleksiyon(KL, [K.kerem], { readers: [], writers: [] })
  KL.apply(e)
  kutu.gc()
  t.is(kutu.set(TA).size, 1)
  simdi = NO_READER_MS - 1
  kutu.gc()
  t.is(kutu.set(TA).size, 1)
  simdi = NO_READER_MS
  kutu.gc()
  t.is(kutu.set(TA).size, 0)
})

test('telefon: mezardaki işlemler için kutuya REC_PRUNE', (t) => {
  const { L, kutu, hus } = kutuluAile()
  const kasa = hex(K_KASA)
  // İrem kasaya yazamaz: işlemi kutuda olsa da Hüsniye reddeder ve budatır
  const I = require('../operation')
  const { fromMs } = require('../hlc')
  const ep = hus.yetki.epochAt(kasa, L.len - 1)
  const key = hus.keys.preferred(kasa, ep.seq, ep.hash).key
  const bytes = I.sealOp({ familyId: L.familyId, collectionId: K_KASA, epochSeq: ep.seq, key, signer: K.irem, inner: { recordId: b4a.alloc(16, 9), op: 0, type: 'yuva.x', fields: [], hlc: fromMs(1), authorId: K.irem.memberId, ledgerSeq: L.len - 1, ledgerHash: L.head } })
  kutu.accept(hus.meHex, 0, bytes)
  t.is(hus.receiveOp(bytes).code, 'NO_PERMISSION')
  const msgs = hus.pruneMsgs()
  t.is(msgs.length, 1)
  t.ok(kutu.prune(msgs[0].bytes).ok)
  t.is(kutu.set(kasa).size, 0)
  t.is(hus.pruneMsgs().length, 0, 'bir kez')
})
