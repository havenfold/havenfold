// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
const test = require('brittle')
const b4a = require('b4a')
const { Ledger, decodeEvent, encodeEvent, eventHash, createEvent, signEvent } = require('../ledger/ledger')
const { decodeBody } = require('../ledger/encoding')
const { ingest, forkWinner, isStrong } = require('../ledger/sync')
const { Proposals } = require('../ledger/proposals')
const { canTask } = require('../ledger/v21')
const {
  C, K, T, hex, uye, olay, ekle, ZERO16, ZERO32, YER_EV, K_TUM_AILE, K_KISISEL_IREM, K_BAKICI, K_OLAYLAR, K_KASA,
  seviye, tur, cihazEkle, cihazCikar, koleksiyon, misafirEkle, misafirKaldir, anaAdimlar
} = require('./helpers/v21')
const { vektorler } = require('./helpers/v21-vector')
const V21 = require('../../../protocol/vectors/ledger-v21-v2.json')

const coz = (h) => decodeEvent(b4a.from(h, 'hex'))
const zincirden = (olaylar, n = olaylar.length) => {
  const L = new Ledger()
  for (const o of olaylar.slice(0, n)) L.apply(coz(o.olay))
  return L
}
function anaDefter (n = Infinity) {
  const L = new Ledger()
  const adimlar = anaAdimlar(L)
  for (const f of adimlar.slice(0, n)) L.apply(f())
  return L
}
const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }

// --- Vektörler ------------------------------------------------------------------------------------------

test('vektörler: ledger-v21.json üretici aynı dosyayı verir (belirlenimci)', (t) => {
  t.alike(JSON.parse(JSON.stringify(vektorler())), V21)
})

test('vektörler: ana zincir 13–23 numaralı olayların her birini içerir ve uygulanır', (t) => {
  const turler = new Set(V21.zincirler.ana.map((o) => o.tur))
  for (let n = 13; n <= 23; n++) t.ok(turler.has(n), 'olay ' + n)
  for (const ad of ['ana', 'cihaz']) {
    const L = new Ledger()
    for (const o of V21.zincirler[ad]) {
      const e = coz(o.olay)
      t.is(hex(encodeEvent(e)), o.olay)
      L.apply(e)
      t.is(hex(L.head), o.bas)
      t.is(hex(eventHash(e)), o.bas)
    }
  }
})

test('vektörler: her durum beklenen sonucu verir', (t) => {
  const nolar = new Set(V21.durumlar.map((d) => d.no))
  for (const n of [2, 3, 4, 5, 6, 9, 10]) t.ok(nolar.has(n), 'durum ' + n)
  for (const d of V21.durumlar) {
    const L = zincirden(V21.zincirler[d.zincir], d.onek)
    const e = coz(d.olay)
    if (d.gecerli) {
      L.apply(e)
      t.is(hex(L.head), d.bas, d.aciklama)
    } else {
      t.is(hataOf(() => L.apply(e)), d.hata, d.aciklama)
    }
  }
})

test('vektörler: çatallanma — iki yönden de aynı dal kazanır (§11 madde 8)', (t) => {
  t.is(V21.catallanma.length, 2)
  for (const c of V21.catallanma) {
    const A = c.dalA.map(coz)
    const B = c.dalB.map(coz)
    const kazanan = c.kazanan === 'A' ? A : B
    for (const [mine, theirs] of [[A, B], [B, A]]) {
      const L = zincirden(V21.zincirler.ana, c.onek)
      for (const e of mine) L.apply(e)
      ingest(L, { fromSeq: c.onek, events: theirs.map(encodeEvent) })
      t.alike(L.head, eventHash(kazanan[kazanan.length - 1]), c.aciklama)
    }
  }
})

// --- Sürüm kapısı ve KIND -------------------------------------------------------------------------------

test('v2.1: düzey yalnız yükselir; KIND yalnız seq 1, ekip geçerli', (t) => {
  const L = anaDefter()
  t.is(L.level, '2.1')
  t.is(L.kind, 'aile')
  t.is(hataOf(() => L.check(seviye(L))), 'LEVEL_CANNOT_DOWNGRADE')
  t.is(hataOf(() => L.check(olay(L, T.PROTOCOL_LEVEL, { level: '3.0' }, [K.kerem]))), 'INVALID_BODY')
  t.is(hataOf(() => L.check(seviye(L, [K.irem]))), 'NO_PARENT_SIGNATURE')
  t.is(hataOf(() => L.check(tur(L))), 'KIND_ERROR', 'seq 1 değil')

  const G = anaDefter(1)
  t.is(hataOf(() => G.check(tur(G, 'ekip'))), null, 'ekip RFC-0005 ile geçerli')
  t.is(hataOf(() => G.check(tur(G, 'kulup'))), 'INVALID_BODY')
  const H = anaDefter(1)
  H.apply(ekle(H, K.husniye, 'ebeveyn', [K.kerem]))
  // KIND yoksa topluluk aile; v2.0 olayları düzeysiz yazılır
  t.is(H.kind, 'aile')
  t.is(H.level, '2.0')
})

test('v2.1: düzey yokken bütün yeni olaylar LEVEL_TOO_LOW', (t) => {
  const L = anaDefter(6)
  const olaylar = [
    cihazEkle(L, C.isci2, [K.kerem]),
    olay(L, T.PLACE, { placeId: YER_EV, name: 'Ev', kind: 'ev', remove: false }, [K.kerem]),
    koleksiyon(L, [K.kerem]),
    olay(L, T.TASK_PERMIT, { subject: 'rol:cocuk', taskTypes: ['hf.task.ocr'], allow: true }, [K.kerem])
  ]
  for (const e of olaylar) t.is(hataOf(() => L.check(e)), 'LEVEL_TOO_LOW')
})

// --- Cihaz -------------------------------------------------------------------------------------------------

test('v2.1: DEVICE_ATTACH kuralları', (t) => {
  const L = anaDefter()
  t.is(hataOf(() => L.check(olay(L, T.DEVICE_ATTACH, { deviceCert: C.isci2.deviceCert, class: 'isci', name: 'x', placeId: ZERO16, caps: b4a.alloc(0), ceremonyTranscriptHash: b4a.alloc(32, 1) }, [K.kerem]))), 'NO_NEW_DEVICE_APPROVAL')
  t.is(hataOf(() => L.check(cihazEkle(L, C.isci2, [K.irem]))), 'NO_PARENT_SIGNATURE')
  t.is(hataOf(() => L.check(cihazEkle(L, C.isci2, [K.kerem], { ceremonyTranscriptHash: ZERO32 }))), 'INVALID_TRANSCRIPT')
  t.is(hataOf(() => L.check(cihazEkle(L, C.isci2, [K.kerem], { placeId: b4a.alloc(16, 0x99) }))), 'NO_PLACE')
  t.is(hataOf(() => L.check(cihazEkle(L, C.isci2, [K.kerem], { class: 'kamera' }))), 'INVALID_BODY')
  t.is(hataOf(() => L.check(cihazEkle(L, C.uc1, [K.kerem]))), 'IDENTITY_ALREADY_EXISTS', 'çıkarılmış cihaz kendini yeniden ekleyemez')
  t.is(hataOf(() => L.check(cihazEkle(L, C.misafir1, [K.kerem]))), 'IDENTITY_ALREADY_EXISTS', 'misafir kimliği cihaz olamaz')
  t.is(hataOf(() => L.check(ekle(L, C.isci1, 'yetiskin', [K.kerem, K.husniye]))), 'IDENTITY_ALREADY_EXISTS', 'cihaz kimliği üye olamaz')
  t.is(hataOf(() => L.check(cihazEkle(L, C.isci2, [K.kutu]))), 'BOX_CANNOT_VOTE')

  const d = L.devices.get(hex(C.isci1.memberId))
  t.is(d.class, 'isci')
  t.is(d.placeId, hex(YER_EV))
  t.alike(d.caps, b4a.from('caps:isci1'))
  t.is(L.phoneIds().length, 4, 'cihazlar üye sayısına girmez')
})

test('v2.1: DEVICE_DETACH kuralları ve etkisi', (t) => {
  const L = anaDefter()
  const isci = hex(C.isci1.memberId)
  t.is(hataOf(() => L.check(cihazCikar(L, C.uc1, [K.kerem]))), 'NO_TARGET')
  t.is(hataOf(() => L.check(cihazCikar(L, C.isci1, [K.irem]))), 'NO_PARENT_SIGNATURE')
  t.is(hataOf(() => L.check(cihazCikar(L, C.isci1, [K.kerem], { wipeReportHash: b4a.alloc(32, 3) }))), 'INVALID_BODY')
  t.is(hataOf(() => L.check(cihazCikar(L, C.isci1, [C.uc1]))), 'UNKNOWN_SIGNER', 'çıkarılmış cihaz imzalayamaz')
  L.apply(cihazCikar(L, C.isci1, [K.kerem], { wipe: true, wipeReportHash: b4a.alloc(32, 3) }))
  const d = L.devices.get(isci)
  t.is(d.active, false)
  t.is(d.wipe, true)
  t.is(d.removedSeq, L.len - 1)
  t.is(L.sessionRole(isci), null)
})

test('v2.1: cihaz ve misafir hiçbir olayı oylayamaz', (t) => {
  const L = anaDefter(19) // uc1 ve misafir1 aktif
  const e = olay(L, T.PLACE, { placeId: b4a.alloc(16, 0x13), name: 'Depo', kind: 'diger', remove: false }, [K.kerem, C.isci1])
  t.is(hataOf(() => L.check(e)), 'DEVICE_CANNOT_VOTE')
  const g = olay(L, T.PLACE, { placeId: b4a.alloc(16, 0x13), name: 'Depo', kind: 'diger', remove: false }, [K.kerem, C.misafir1])
  t.is(hataOf(() => L.check(g)), 'DEVICE_CANNOT_VOTE')
  t.is(hataOf(() => L.check(cihazCikar(L, C.uc1, [C.misafir1]))), 'DEVICE_CANNOT_VOTE')
  t.is(hataOf(() => L.check(ekle(L, K.u5, 'yetiskin', [K.kerem, K.husniye, C.isci1]))), 'DEVICE_CANNOT_VOTE')
})

// --- Yer ve varlık ------------------------------------------------------------------------------------------

test('v2.1: PLACE ve BEING — sınırlar, kaldırma, kaldırılan yerin cihazı', (t) => {
  const L = anaDefter()
  for (let i = 1; i < 8; i++) L.apply(olay(L, T.PLACE, { placeId: b4a.alloc(16, 0x60 + i), name: 'Yer' + i, kind: 'diger', remove: false }, [K.kerem]))
  t.is(hataOf(() => L.check(olay(L, T.PLACE, { placeId: b4a.alloc(16, 0x70), name: 'Fazla', kind: 'diger', remove: false }, [K.kerem]))), 'PLACE_LIMIT')
  t.is(hataOf(() => L.check(olay(L, T.PLACE, { placeId: b4a.alloc(16, 0x61), name: 'x', kind: 'ofis', remove: false }, [K.kerem]))), 'INVALID_BODY')
  t.is(hataOf(() => L.check(olay(L, T.PLACE, { placeId: b4a.alloc(16, 0x70), name: 'x', kind: 'ev', remove: true }, [K.kerem]))), 'NO_TARGET')
  t.ok(L.check(olay(L, T.PLACE, { placeId: YER_EV, name: 'Ev 2', kind: 'ev', remove: false }, [K.kerem])), 'var olan yer değişir, sayılmaz')
  L.apply(olay(L, T.PLACE, { placeId: YER_EV, name: 'Ev', kind: 'ev', remove: true }, [K.kerem]))
  L.apply(olay(L, T.PLACE, { placeId: b4a.alloc(16, 0x70), name: 'Yeni', kind: 'diger', remove: false }, [K.kerem]))
  t.is(hataOf(() => L.check(olay(L, T.BEING, { beingId: b4a.alloc(16, 0x22), kind: 'kopek', name: 'Fino', placeId: YER_EV, remove: false }, [K.kerem]))), 'NO_PLACE')
  t.is(hataOf(() => L.check(olay(L, T.BEING, { beingId: b4a.alloc(16, 0x22), kind: 'kopek', name: 'Fino', placeId: ZERO16, remove: false }, [K.irem]))), 'NO_PARENT_SIGNATURE')
  for (let i = 1; i < 32; i++) L.apply(olay(L, T.BEING, { beingId: b4a.alloc(16, 0x80 + i), kind: 'bitki', name: 'B' + i, placeId: ZERO16, remove: false }, [K.kerem]))
  t.is(hataOf(() => L.check(olay(L, T.BEING, { beingId: b4a.alloc(16, 0xf0), kind: 'bitki', name: 'Fazla', placeId: ZERO16, remove: false }, [K.kerem]))), 'BEING_LIMIT')
})

// --- Misafir ---------------------------------------------------------------------------------------------------

test('v2.1: GRANT kuralları ve misafir sınırı', (t) => {
  const L = anaDefter(19)
  const ek = (m, imz, k = {}) => misafirEkle(L, m, imz, k)
  t.is(hataOf(() => L.check(ek(C.misafir2, [K.kerem], { collections: [K_TUM_AILE] }))), 'NOT_COLLECTION_ELIGIBLE')
  t.is(hataOf(() => L.check(ek(C.misafir2, [K.kerem], { collections: [b4a.alloc(16, 0x77)] }))), 'NOT_COLLECTION_ELIGIBLE')
  t.is(hataOf(() => L.check(ek(C.misafir2, [K.kerem], { taskTypes: ['hf.task.ocr'] }))), 'INVALID_BODY')
  t.is(hataOf(() => L.check(ek(C.misafir2, [K.irem]))), 'NO_PARENT_SIGNATURE')
  t.is(hataOf(() => L.check(ek(K.irem, [K.kerem]))), 'IDENTITY_ALREADY_EXISTS')
  L.apply(ek(C.misafir2, [K.husniye]))
  for (const ad of ['isci5', 'isci6']) L.apply(misafirEkle(L, C[ad], [K.kerem]))
  t.is(L.activeGrantIds().length, 4)
  t.is(hataOf(() => L.check(misafirEkle(L, C.isci7, [K.kerem]))), 'GUEST_LIMIT')
  const g = L.grants.get(hex(C.misafir2.memberId))
  t.is(g.grantedBy, hex(K.husniye.memberId))
  t.alike(g.collections, [hex(K_BAKICI)])
  t.is(L.sessionRole(hex(C.misafir2.memberId)), 'misafir')
})

test('v2.1: misafirliği veren ebeveyn aileden çıkınca misafirlik düşer (§5.12)', (t) => {
  const L = anaDefter(19)
  L.apply(misafirEkle(L, C.misafir2, [K.husniye]))
  const m1 = hex(C.misafir1.memberId)
  const m2 = hex(C.misafir2.memberId)
  // Hüsniye telefon değiştirir (eski cihaz imzalı): misafirlik yeni cihaza geçer
  L.apply(olay(L, T.ROTATE_DEVICE, { oldMemberId: K.husniye.memberId, newDeviceCert: K.u7.deviceCert, ceremonyTranscriptHash: b4a.alloc(32, 7) }, [K.u7, K.husniye, K.kerem]))
  t.ok(L.grants.get(m2).active)
  t.is(L.resolveMember(L.grants.get(m2).grantedBy), hex(K.u7.memberId))
  // Sonra aileden ayrılır: Hüsniye'nin verdiği misafirlik aynı olayla düşer, Kerem'inki kalır
  L.apply(olay(L, T.LEAVE, { memberId: K.u7.memberId }, [K.u7]))
  t.is(L.grants.get(m2).active, false)
  t.is(L.grants.get(m2).removedSeq, L.len - 1)
  t.ok(L.grants.get(m1).active)
})

// --- Paylaşım onayı ---------------------------------------------------------------------------------------

test('v2.1: SHARE_CONSENT imzacısı', (t) => {
  const L = anaDefter()
  const pay = (ownerId, imz) => olay(L, T.SHARE_CONSENT, { shareId: b4a.alloc(16, 0x42), service: 's', scope: 'k', ownerId, expiresAt: 0, payloadHash: b4a.alloc(32, 1) }, imz)
  t.ok(L.check(pay(K.irem.memberId, [K.irem])))
  t.is(hataOf(() => L.check(pay(K.irem.memberId, [K.kerem]))), 'NO_OWNER_APPROVAL')
  t.ok(L.check(pay(K.ecem.memberId, [K.husniye])), 'çocuğun verisinde ebeveyn')
  t.is(hataOf(() => L.check(pay(K.ecem.memberId, [K.ecem]))), 'NO_PARENT_SIGNATURE')
  t.ok(L.check(pay(ZERO16, [K.kerem])), 'ortak veri')
  t.is(hataOf(() => L.check(pay(ZERO16, [K.irem]))), 'NO_PARENT_SIGNATURE')
  t.is(hataOf(() => L.check(pay(K.kutu.memberId, [K.kerem]))), 'NO_TARGET')
})

test('v2.1: SHARE_CONSENT iptal biçimini okuyucu da yazar (RFC-0010 açıklama 3 madde 1)', (t) => {
  const L = anaDefter()
  const iptal = (ownerId, imz, ek = {}) => olay(L, T.SHARE_CONSENT, { shareId: b4a.alloc(16, 0x43), service: 's', scope: 'iptal', ownerId, expiresAt: 0, payloadHash: b4a.alloc(32), ...ek }, imz)
  t.ok(L.check(iptal(ZERO16, [K.irem])), 'yetişkin ortak verinin iptalini yazar')
  t.ok(L.check(iptal(K.husniye.memberId, [K.irem])), 'yetişkin başkasının verisinin iptalini yazar')
  t.ok(L.check(iptal(K.irem.memberId, [K.kerem])), 'ebeveyn yetişkinin verisinin iptalini yazar')
  t.is(hataOf(() => L.check(iptal(ZERO16, [K.ecem]))), 'NO_PARENT_SIGNATURE', 'çocuk okuyucu değil')
  t.is(hataOf(() => L.check(iptal(ZERO16, [K.irem], { expiresAt: 5 }))), 'NO_PARENT_SIGNATURE', 'iptal biçimi değil')
  t.is(hataOf(() => L.check(iptal(ZERO16, [K.irem], { payloadHash: b4a.alloc(32, 1) }))), 'NO_PARENT_SIGNATURE', 'özet sıfır değil')
  t.is(hataOf(() => L.check(iptal(ZERO16, [K.irem], { scope: 'tek:veteriner' }))), 'NO_PARENT_SIGNATURE', 'onay biçimi')
})

// --- Koleksiyon --------------------------------------------------------------------------------------------

test('v2.1: COLLECTION ek kuralları', (t) => {
  const L = anaDefter()
  const yeni = (imz, ek) => koleksiyon(L, imz, { collectionId: b4a.alloc(16, 0x50), name: 'Yeni', ...ek })
  t.is(hataOf(() => L.check(yeni([K.kerem], { kind: 'gizli' }))), 'INVALID_BODY')
  t.is(hataOf(() => L.check(yeni([K.kerem], { readers: ['rol:kutu'] }))), 'INVALID_BODY')
  t.is(hataOf(() => L.check(yeni([K.kerem], { readers: ['rol:ebeveyn', 'rol:ebeveyn'], writers: [] }))), 'INVALID_BODY')
  t.is(hataOf(() => L.check(yeni([K.kerem], { writers: ['rol:ebeveyn', 'device:' + hex(C.isci1.memberId)] }))), 'DEVICE_WRITER_FORBIDDEN')
  t.is(hataOf(() => L.check(yeni([K.kerem], { readers: ['rol:ebeveyn', 'grant:' + hex(C.misafir1.memberId)], writers: ['rol:ebeveyn'] }))), 'GUEST_FORBIDDEN')
  t.is(hataOf(() => L.check(yeni([K.kerem], { kind: 'bakici', readers: ['rol:ebeveyn', 'grant:' + hex(C.misafir1.memberId)], writers: ['grant:' + hex(C.misafir1.memberId)] }))), 'GUEST_CANNOT_WRITE')
  t.is(hataOf(() => L.check(yeni([K.kerem], { dropKey: b4a.alloc(32, 1) }))), 'INVALID_BODY')
  t.is(hataOf(() => L.check(yeni([K.kerem], { readers: ['rol:ebeveyn'], writers: ['rol:ebeveyn', 'rol:yetiskin'] }))), 'NOT_WRITER_READER')
  t.is(hataOf(() => L.check(yeni([K.kerem], { readers: ['rol:ebeveyn', uye(K.kutu)], writers: [] }))), 'INVALID_MEMBER')
  t.is(hataOf(() => L.check(yeni([K.kerem], { readers: ['rol:ebeveyn', uye(K.u9)], writers: [] }))), 'INVALID_MEMBER')
  t.is(hataOf(() => L.check(yeni([K.irem], {}))), 'NO_PARENT_SIGNATURE')
  t.is(hataOf(() => L.check(koleksiyon(L, [K.kerem], { kind: 'olaylar' }))), 'TYPE_IMMUTABLE')
  t.is(hataOf(() => L.check(yeni([K.kerem], { sensitivity: 'kasa', readers: ['rol:ebeveyn'], writers: ['rol:ebeveyn'], taskAccess: false }))), 'NO_PARENT_APPROVAL')
  t.is(hataOf(() => L.check(koleksiyon(L, [K.kerem], { collectionId: K_KASA, name: 'Kasa', readers: ['rol:ebeveyn'], writers: ['rol:ebeveyn'], sensitivity: 'normal', taskAccess: false }))), 'NO_PARENT_APPROVAL', 'kasadan çıkmak da bütün ebeveynleri ister')
  t.ok(L.check(yeni([K.kerem], { writers: ['rol:ebeveyn', uye(K.irem)], readers: ['rol:ebeveyn', 'rol:yetiskin', uye(K.irem)] })))
  const ol = L.collections.get(hex(K_OLAYLAR))
  t.alike(ol.dropKey, b4a.alloc(32, 9))
  t.is(L.collections.get(hex(K_KISISEL_IREM)).owner, hex(K.irem.memberId))
})

test('v2.1: tek okuyuculu koleksiyon o üyenin de imzasını ister', (t) => {
  const L = anaDefter()
  const cid = b4a.alloc(16, 0x51)
  L.apply(koleksiyon(L, [K.kerem, K.ecem], { collectionId: cid, name: 'Ecem', readers: [uye(K.ecem)], writers: [uye(K.ecem)] }))
  const degis = (imz) => koleksiyon(L, imz, { collectionId: cid, name: 'Ecem', readers: [uye(K.ecem), 'rol:ebeveyn'], writers: [uye(K.ecem)] })
  t.is(hataOf(() => L.check(degis([K.kerem]))), 'NO_READER_APPROVAL')
  t.ok(L.check(degis([K.kerem, K.ecem])))
})

test('v2.1: kişisel koleksiyon — yalnız sahibi; telefon değişince sahip yeni telefona çözülür (§5.13)', (t) => {
  const L = anaDefter()
  const kis = (imz, ek = {}) => koleksiyon(L, imz, { collectionId: K_KISISEL_IREM, name: 'Kişisel', kind: 'kisisel', readers: [uye(K.irem)], writers: [uye(K.irem)], taskAccess: false, ...ek })
  t.is(hataOf(() => L.check(kis([K.irem, K.kerem]))), 'PERSONAL_COLLECTION', 'ebeveyn birlikte imzalasa bile')
  t.is(hataOf(() => L.check(kis([K.irem], { readers: [uye(K.kerem)], writers: [] }))), 'PERSONAL_COLLECTION', 'sahip okuyuculardan çıkamaz')
  t.is(hataOf(() => L.check(koleksiyon(L, [K.irem], { collectionId: b4a.alloc(16, 0x52), kind: 'kisisel', readers: [uye(K.irem), uye(K.ecem)], writers: [], taskAccess: false }))), 'PERSONAL_COLLECTION', 'oluşturan olayda tek uye: okuyucu')
  // İrem telefon değiştirir; eski kimliğiyle yazılmış uye: öğesi yeni kimliğe çözülür
  L.apply(olay(L, T.ROTATE_DEVICE, { oldMemberId: K.irem.memberId, newDeviceCert: K.u8.deviceCert, ceremonyTranscriptHash: b4a.alloc(32, 7) }, [K.u8, K.irem, K.kerem]))
  t.is(L.resolveMember(hex(K.irem.memberId)), hex(K.u8.memberId))
  t.ok(L.check(kis([K.u8], { name: 'Kişisel 2' })), 'yeni telefon eski uye: öğesiyle yönetir')
  t.is(hataOf(() => L.check(kis([K.kerem], { name: 'Kişisel 2' }))), 'PERSONAL_COLLECTION')
})

// --- Görev izni -------------------------------------------------------------------------------------------

test('v2.1: TASK_PERMIT varsayılanları ve karar sırası', (t) => {
  const L = anaDefter()
  const id = (k) => hex(k.memberId)
  t.ok(canTask(L, id(K.kerem), 'hf.task.ocr'))
  t.ok(canTask(L, id(K.irem), 'hf.task.llm'))
  t.ok(canTask(L, id(K.ecem), 'hf.task.ocr'), 'ana zincirdeki rol:cocuk izni')
  t.absent(canTask(L, id(K.ecem), 'hf.task.llm'))
  t.ok(canTask(L, id(K.kutu), 'hf.task.backup'))
  t.absent(canTask(L, id(K.kutu), 'hf.task.ocr'))
  t.absent(canTask(L, id(C.isci1), 'hf.task.ocr'), 'cihaz görev vermez')
  t.absent(canTask(L, id(K.irem), 'hf.task.vision', { continuous: true }), 'sürekli görev yalnız ebeveyn')
  t.ok(canTask(L, id(K.kerem), 'hf.task.vision', { continuous: true }))
  L.apply(olay(L, T.TASK_PERMIT, { subject: uye(K.ecem), taskTypes: ['hf.task.ocr'], allow: false }, [K.kerem]))
  t.absent(canTask(L, id(K.ecem), 'hf.task.ocr'), 'uye: kaydı rol: kaydından önce')
  L.apply(olay(L, T.TASK_PERMIT, { subject: 'rol:yetiskin', taskTypes: ['hf.task.llm'], allow: false }, [K.husniye]))
  t.absent(canTask(L, id(K.irem), 'hf.task.llm'))
  t.is(hataOf(() => L.check(olay(L, T.TASK_PERMIT, { subject: 'grant:' + id(C.misafir1), taskTypes: ['hf.task.ocr'], allow: true }, [K.kerem]))), 'INVALID_BODY')
  t.is(hataOf(() => L.check(olay(L, T.TASK_PERMIT, { subject: 'rol:cocuk', taskTypes: [], allow: true }, [K.kerem]))), 'INVALID_BODY')
  t.is(hataOf(() => L.check(olay(L, T.TASK_PERMIT, { subject: 'rol:cocuk', taskTypes: ['x'], allow: true }, [K.irem]))), 'NO_PARENT_SIGNATURE')
})

// --- Öneri, çapa, imza birleştirme, çatallanma ----------------------------------------------------------------

test('v2.1: öneri yolu — kasa koleksiyonu iki ebeveynin imzasını bekler', (t) => {
  const L = anaDefter()
  const P = new Proposals(L)
  const e = koleksiyon(L, [K.kerem], { collectionId: b4a.alloc(16, 0x53), name: 'Kasa 2', readers: ['rol:ebeveyn'], writers: ['rol:ebeveyn'], sensitivity: 'kasa', taskAccess: false })
  const id = P.add(e, e.ts) // öneri ömrü olayın zamanından (D49, inceleme 16)
  t.is(P.tryApply(id), 'waiting')
  P.sign(id, K.husniye)
  t.is(P.tryApply(id), 'applied')
  t.is(L.collections.get(hex(b4a.alloc(16, 0x53))).sensitivity, 'kasa')
})

test('v2.1: öneri yolu — cihazın imzası olayın ilk halinde bulunur, başka öneride atılır', (t) => {
  const L = anaDefter()
  const P = new Proposals(L)
  const e = cihazEkle(L, C.isci2, [])
  const id = P.add(e, e.ts) // öneri ömrü olayın zamanından (D49)
  t.is(P.get(id).sigs.length, 1, 'yeni cihazın kendi imzası alındı')
  t.is(P.tryApply(id), 'waiting')
  P.sign(id, K.husniye)
  t.is(P.tryApply(id), 'applied')
  const pe = olay(L, T.PLACE, { placeId: b4a.alloc(16, 0x14), name: 'x', kind: 'diger', remove: false }, [C.isci2])
  const pid = P.add(pe, pe.ts)
  t.is(P.get(pid).sigs.length, 0, 'cihazın oyu öneriye girmez')
})

test('v2.1: çapa — üye ↔ cihaz/misafir her zaman eklenme olayı, cihaz ↔ cihaz büyük addedSeq', (t) => {
  const L = anaDefter(19)
  L.apply(cihazEkle(L, C.isci2, [K.kerem]))
  const isci1 = L.devices.get(hex(C.isci1.memberId))
  const isci2 = L.devices.get(hex(C.isci2.memberId))
  const misafir = L.grants.get(hex(C.misafir1.memberId))
  t.alike(L.anchorFor(K.kerem.memberId, C.isci1.memberId), isci1.anchor)
  t.alike(L.anchorFor(C.isci1.memberId, K.kerem.memberId), isci1.anchor)
  t.alike(L.anchorFor(K.irem.memberId, C.misafir1.memberId), misafir.anchor)
  t.alike(L.anchorFor(C.isci1.memberId, C.isci2.memberId), isci2.anchor)
  // Cihazdan sonra eklenen üye için de çapa cihazın olayıdır
  L.apply(ekle(L, K.u5, 'yetiskin', [K.kerem, K.husniye]))
  t.alike(L.anchorFor(K.u5.memberId, C.isci1.memberId), isci1.anchor)
  t.alike(L.anchorFor(K.u5.memberId, K.kerem.memberId), L.member(K.u5.memberId).anchor)
})

test('v2.1: mergeSigs cihaz imzasını eklemez; çatallanmada yalnız üye imzaları sayılır', (t) => {
  const L = anaDefter()
  const seq = L.len
  L.apply(cihazEkle(L, C.isci2, [K.kerem]))
  const kopya = coz(hex(encodeEvent(L.events[seq])))
  signEvent(kopya, K.husniye)
  t.is(L.mergeSigs(seq, kopya.sigs), 1, 'Hüsniye eklenir')
  const e = L.events[seq]
  t.is(e.sigs.length, 3)

  // Aynı önekten iki olay: cihaz ekleme (cihaz + 1 ebeveyn) ile yer (2 ebeveyn). Cihaz imzası sayılmaz.
  const P = anaDefter()
  const a = cihazEkle(P, C.isci3, [K.kerem])
  const b = olay(P, T.PLACE, { placeId: b4a.alloc(16, 0x15), name: 'y', kind: 'diger', remove: false }, [K.kerem, K.husniye])
  t.is(forkWinner(a, b), b)
  t.is(forkWinner(b, a), b)
})

test('v2.1: güçlü olaylar (§9)', (t) => {
  const L = anaDefter()
  t.ok(isStrong(misafirKaldir(L, C.misafir2, [K.kerem]), L))
  t.ok(isStrong(cihazCikar(L, C.isci1, [K.kerem]), L))
  t.absent(isStrong(cihazCikar(L, C.isci1, [C.isci1]), L))
  const a = cihazCikar(L, C.isci1, [C.isci1])
  const b = koleksiyon(L, [K.kerem, K.husniye], { name: 'Tüm Aile 3' })
  t.is(forkWinner(a, b), b, 'cihazın kendi çıkışı çıkarma sayılmaz (RFC-0019 5.5); çok imzacılı dal kazanır')
})

test('v2.1: eski türler ve gövdeleri değişmedi; yeni gövdeler gidiş dönüş', (t) => {
  const L = anaDefter()
  for (const e of L.events) {
    const body = decodeBody(e.type, e.body)
    const yeniden = createEvent({ len: e.seq, head: e.prev }, e.type, body, e.ts)
    t.alike(yeniden.body, e.body, 'tür ' + e.type)
  }
})
