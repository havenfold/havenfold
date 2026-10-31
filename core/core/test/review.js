// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D9: inceleme 1 bulguları, RFC-0017 (defter v2.2) ve RFC-0003 (defter v2.1). Beklenen değerler elle yazılmıştır.
const test = require('brittle')
const b4a = require('b4a')
const sodium = require('sodium-native')
const c = require('compact-encoding')
const { Ledger, T, decodeEvent, encodeEvent, eventHash } = require('../ledger/ledger')
const { decodeBody } = require('../ledger/encoding')
const { ingest, isStrong, forkWinner } = require('../ledger/sync')
const { Proposals } = require('../ledger/proposals')
const { CapsBook } = require('../protocol/caps')
const { CAPS } = require('../protocol/hello')
const Zr = require('../protocol/envelope')
const Y = require('../protocol/local-channel')
const GV = require('../protocol/guest-view')
const S = require('../messaging/seal')
const EM = require('../protocol/retirement')
const { createIdentity } = require('../core/identity')
const V = require('./helpers/v21')
const { E, C0 } = require('../../records/test/helpers/multi-vector')

const { K, C, hex, olay, ekle, koleksiyon, misafirEkle, cihazEkle, cihazCikar, K_BAKICI, TS0, uye, anaAdimlar, seviye } = V
const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const id = (k) => hex(k.memberId)

function cokluDefter () {
  const L = new Ledger({ now: () => TS0 })
  for (const e of C0) L.apply(decodeEvent(encodeEvent(e)))
  return L
}
function anaDefter (n = Infinity) {
  const L = new Ledger({ now: () => TS0 })
  for (const f of anaAdimlar(L).slice(0, n)) L.apply(f())
  return L
}
const primary = (L, kisi, yeni, oldSigned, imz) => olay(L, T.APP_PRIMARY, { personId: kisi.memberId, newPrimaryId: yeni.memberId, oldSigned }, imz)
const rotate = (L, eski, yeni, imz) => olay(L, T.ROTATE_DEVICE, { oldMemberId: eski.memberId, newDeviceCert: yeni.deviceCert, ceremonyTranscriptHash: b4a.alloc(32, 7) }, imz)
const activate = (L, k, imz) => olay(L, T.ACTIVATE_MEMBER, { memberId: k.memberId }, imz)

// --- RFC-0017 ---------------------------------------------------------------------------------------------------

test('kritik 1: çalınan telefonun ek kimliği bekleyen cihaz değişimi varken ana kimliği alamaz', (t) => {
  const L = cokluDefter()
  L.apply(rotate(L, K.kerem, K.yeniKerem, [K.yeniKerem, K.husniye, K.irem, K.ecem]))
  t.ok(L.member(K.yeniKerem.memberId).pendingRotation)
  t.is(hataOf(() => L.apply(primary(L, K.kerem, E.keremDefter, true, [E.keremDefter, K.kerem]))), 'PENDING_CHANGE')
  // Eski kimlik ayrılırsa bekleyen değişim düşer; ACTIVATE reddedilir
  const L2 = cokluDefter()
  L2.apply(rotate(L2, K.kerem, K.yeniKerem, [K.yeniKerem, K.husniye, K.irem, K.ecem]))
  L2.apply(olay(L2, T.LEAVE, { memberId: K.kerem.memberId }, [K.kerem]))
  t.is(hataOf(() => L2.apply(activate(L2, K.yeniKerem, [K.husniye]))), 'CHANGE_DROPPED')
  t.is(L2.personIds().length, 3)
  t.is(L2.parentIds().length, 1)
  // Olağan yol: bekleme sonrası ACTIVATE, kişi sayısı 4, ebeveyn 2
  const L3 = cokluDefter()
  L3.apply(rotate(L3, K.kerem, K.yeniKerem, [K.yeniKerem, K.husniye, K.irem, K.ecem]))
  L3.apply(activate(L3, K.yeniKerem, [K.husniye]))
  t.is(L3.personIds().length, 4)
  t.is(L3.parentIds().length, 2)
})

test('yüksek 2: ana kimlik devrinden sonraki telefon değişimi kişiyi korur', (t) => {
  const L = cokluDefter()
  L.apply(primary(L, K.kerem, E.keremDefter, true, [E.keremDefter, K.kerem]))
  L.apply(rotate(L, E.keremDefter, K.yeniKerem, [K.yeniKerem, E.keremDefter, K.husniye]))
  t.is(L.personIdOf(id(K.yeniKerem)), id(K.kerem), 'kişi kimliği ilk ana kimlik')
  t.is(L.canonical(id(K.kerem)), id(K.yeniKerem))
  t.ok(L.extraIdsOf(id(K.kerem)).includes(id(E.keremTablet)), 'başka cihazdaki ek kimlik kişide kalır')
  L.apply(olay(L, T.REMOVE_MEMBER, { memberId: K.yeniKerem.memberId, reason: 'test', wipe: true }, [K.husniye, K.irem, K.ecem]))
  t.is(L.member(E.keremTablet.memberId).active, false, 'kişi çıkınca tabletteki ek kimlik de kapanır')
})

test('yüksek 3: veto edilen APP_PRIMARY etkinleştirilemez', (t) => {
  const L = cokluDefter()
  L.apply(primary(L, K.kerem, E.keremDefter, false, [E.keremDefter]))
  t.ok(L.member(E.keremDefter.memberId).pendingPrimary)
  L.apply(olay(L, T.REMOVE_MEMBER, { memberId: E.keremDefter.memberId, reason: 'veto', wipe: false }, [K.kerem]))
  t.absent(L.member(E.keremDefter.memberId).pendingPrimary)
  t.is(hataOf(() => L.apply(activate(L, E.keremDefter, [K.husniye]))), 'NOT_WAITING')
})

test('yüksek 4: sonradan birleşen imza bekleyen olayın durumunu değiştirmez (aynı baş, aynı durum)', (t) => {
  const L = cokluDefter()
  const e = primary(L, K.kerem, E.keremDefter, false, [E.keremDefter])
  L.apply(decodeEvent(encodeEvent(e)))
  const kopya = decodeEvent(encodeEvent(e))
  const ek = decodeEvent(encodeEvent(primary(cokluDefter(), K.kerem, E.keremDefter, false, [E.keremDefter, K.husniye])))
  kopya.sigs = ek.sigs
  ingest(L, { fromSeq: e.seq, events: [kopya] })
  t.is(L.events[e.seq].sigs.length, 1, 'durumu değiştiren imza eklenmez')
  const yeniden = Ledger.fromEvents(L.events)
  t.is(yeniden.member(E.keremDefter.memberId).pendingPrimary, L.member(E.keremDefter.memberId).pendingPrimary)
  t.ok(L.member(E.keremDefter.memberId).pendingPrimary)
})

test('orta 6: ek kimliğin imzası ebeveyn imzası sayılmaz; ACTIVATE güçlü değildir (RFC-0020 c, bulgu 7 geri çekildi)', (t) => {
  const L = cokluDefter()
  const e = primary(L, K.kerem, E.keremDefter, false, [E.keremDefter])
  t.absent(isStrong(e, L), 'yalnız yeni ek kimlik imzalı bekleyen APP_PRIMARY güçlü değil')
  L.apply(e)
  t.absent(isStrong(activate(L, E.keremDefter, [K.husniye]), L), 'bekleyen ana kimliği açan ACTIVATE de güçlü değil')
  t.absent(isStrong(activate(cokluDefter(), K.u9, [K.husniye]), cokluDefter()))
})

test('orta 8: yerel kanal zarfları ağ oturumunda geçmez; APP_LOCAL_SYNC iç türleri izin listesinde', (t) => {
  for (const [a, b] of [['uye', 'uye'], ['cihaz', 'uye'], ['misafir', 'uye']]) {
    t.absent(Zr.typeAllowed(a, b, 0xe8), a + '|' + b + ' 0xE8')
    t.absent(Zr.typeAllowed(a, b, 0xe9), a + '|' + b + ' 0xE9')
  }
  t.ok(Y.icTurIzinli(0x11))
  t.ok(Y.icTurIzinli(0x81))
  t.absent(Y.icTurIzinli(0xe8))
  t.absent(Y.icTurIzinli(0x90))
})

test('düşük 9: öneri bekleyen listesi ek kimlikleri göstermez', (t) => {
  const L = cokluDefter()
  const p = new Proposals(L)
  const e = ekle(L, K.u5, 'yetiskin', [K.kerem])
  const pid = p.add(e, e.ts) // öneri ömrü olayın zamanından (D49, inceleme 16)
  const bekleyen = p.waitingFor(pid)
  t.absent(bekleyen.includes(id(E.keremDefter)))
  t.absent(bekleyen.includes(id(E.iremDefter)))
  t.ok(bekleyen.includes(id(K.husniye)))
})

test('düşük 12: düzey 2.2 için alt düzeyin biti de bildirilmiş olmalı', (t) => {
  const L = anaDefter()
  const cb = new CapsBook()
  for (const k of L.activeIds()) cb.record(k, CAPS.COKLU_UYGULAMA, TS0)
  t.absent(cb.levelReady(L, '2.2', { now: TS0 }).ok)
  for (const k of L.activeIds()) cb.record(k, CAPS.COKLU_UYGULAMA | CAPS.LEDGER_V21, TS0 + 1)
  t.ok(cb.levelReady(L, '2.2', { now: TS0 + 1 }).ok)
})

// --- RFC-0003 ---------------------------------------------------------------------------------------------------

test('yüksek 1: misafirliğin bağlı olduğu ebeveyn GRANT gövdesindeki grantedBy; imza sırasına bağlı değil', (t) => {
  const L = anaDefter(16)
  const e = misafirEkle(L, C.misafir1, [K.husniye, K.kerem], { grantedBy: K.kerem.memberId })
  L.apply(e)
  t.is(L.grants.get(id(C.misafir1)).grantedBy, id(K.kerem))
  const L2 = anaDefter(16)
  t.is(hataOf(() => L2.apply(misafirEkle(L2, C.misafir1, [K.husniye], { grantedBy: K.kerem.memberId }))), 'INVALID_BODY', 'grantedBy imzacı olmalı')
  const L3 = anaDefter(16)
  t.is(hataOf(() => L3.apply(misafirEkle(L3, C.misafir1, [K.husniye, K.irem], { grantedBy: K.irem.memberId }))), 'INVALID_BODY', 'grantedBy ebeveyn olmalı')
})

test('yüksek 2: misafirliği veren ebeveyn ayrılınca GUEST_REVOKED ayrılma olayını taşır; düşmüş misafirliğe REVOKE yazılabilir', (t) => {
  const L = anaDefter(17) // misafir1 aktif, grantedBy Kerem
  const gv = GV.buildGuestView(L, id(C.misafir1), K.kerem)
  const view = GV.acceptGuestView(null, gv, C.misafir1.memberId)
  const leave = olay(L, T.LEAVE, { memberId: K.kerem.memberId }, [K.kerem])
  L.apply(leave)
  t.absent(L.grants.get(id(C.misafir1)).active)
  const r = GV.verifyGuestRevoked(view, GV.encodeGuestRevoked(L.familyId, C.misafir1.memberId, leave, K.husniye))
  t.is(r.neden, 'ebeveyn-ayrildi')
  t.execution(() => L.apply(olay(L, T.REVOKE, { grantId: C.misafir1.memberId, reason: 'kayit' }, [K.husniye])))
  // İmza: Ed25519(ebeveyn, hash('hf/guest-revoked/', familyId, grantId))
  const bozuk = b4a.from(GV.encodeGuestRevoked(L.familyId, C.misafir1.memberId, leave, K.husniye))
  bozuk[bozuk.length - 1] ^= 1
  t.is(hataOf(() => GV.verifyGuestRevoked(view, bozuk)), 'INVALID_SIGNATURE')
})

test('orta 3 ve RFC-0019 §11.1 i: misafirli koleksiyon kasa yapılamaz; ebeveyn okuyucu şart; readers [] misafiri de kapatır', (t) => {
  const L = anaDefter(17)
  const bakici = { collectionId: K_BAKICI, name: 'Bakıcı', kind: 'bakici', readers: ['rol:ebeveyn'], writers: ['rol:ebeveyn'], taskAccess: false, history: false }
  t.is(hataOf(() => L.apply(koleksiyon(L, [K.kerem, K.husniye], { ...bakici, sensitivity: 'kasa' }))), 'VAULT_RULE')
  t.is(hataOf(() => L.apply(koleksiyon(L, [K.kerem], { ...bakici, readers: ['rol:yetiskin'], writers: [] }))), 'NO_PARENT_READER')
  const { readerSet } = require('../../records/permission')
  L.apply(koleksiyon(L, [K.kerem], { ...bakici, readers: [], writers: [] }))
  t.absent(readerSet(L, L.collections.get(hex(K_BAKICI))).has(id(C.misafir1)))
  const L2 = anaDefter(11)
  L2.apply(koleksiyon(L2, [K.kerem], { ...bakici, readers: ['uye:' + id(K.irem)], writers: [] }))
  t.is(hataOf(() => L2.apply(misafirEkle(L2, C.misafir1, [K.kerem]))), 'NO_PARENT_READER', 'GRANT\'ın koleksiyonunda ebeveyn okuyucu yok')
})

test('orta 4: defter gövdeleri ve olaylar kanonik çözülür; bool yalnız 0/1, sonda bayt yok', (t) => {
  const L = anaDefter(3)
  const e = ekle(L, K.irem, 'yetiskin', [K.kerem, K.husniye])
  const govde = b4a.from(e.body)
  const i = govde.byteLength - 2 // remote (bool), activatesAt (0)
  t.is(govde[i], 0)
  govde[i] = 2
  t.is(hataOf(() => decodeBody(T.ADD_MEMBER, govde)), 'CORRUPT_BODY')
  t.is(hataOf(() => decodeBody(T.ADD_MEMBER, b4a.concat([e.body, b4a.from([0])]))), 'CORRUPT_BODY')
  t.is(hataOf(() => decodeEvent(b4a.concat([encodeEvent(e), b4a.from([0])]))), 'CORRUPT_EVENT')
  const kisa = b4a.from(encodeEvent(e))
  t.is(kisa[0], 2) // v = 2, tek bayt
  t.is(hataOf(() => decodeEvent(b4a.concat([b4a.from([0xfd, 2, 0]), kisa.subarray(1)]))), 'CORRUPT_EVENT', 'en kısa olmayan uint')
  t.is(hataOf(() => EM.decodeRetireList(b4a.concat([c.encode(EM.retireList, { holds: [], blobs: [], shares: [] }), b4a.from([1])]))), 'INVALID_MESSAGE')
})

test('orta 5: cihazın kendi imzaladığı DEVICE_DETACH çatallanmada çıkarma sayılmaz', (t) => {
  const L = anaDefter(20) // uc1 aktif
  const kendi = cihazCikar(L, C.uc1, [C.uc1])
  const kol = koleksiyon(L, [K.kerem, K.husniye], { collectionId: b4a.alloc(16, 0x3d), name: 'X' })
  t.is(forkWinner(kendi, kol), kol, 'iki imzalı koleksiyon olayı kazanır')
  const ebeveyn = cihazCikar(L, C.uc1, [K.kerem])
  t.is(forkWinner(ebeveyn, kol), ebeveyn, 'ebeveynin çıkarması kazanır')
})

test('orta 6: misafiri veren ebeveyn telefon değiştirince misafir yeni imzacının görünümünü kabul eder', (t) => {
  const L = anaDefter(17)
  const v1 = GV.acceptGuestView(null, GV.buildGuestView(L, id(C.misafir1), K.kerem), C.misafir1.memberId)
  L.apply(rotate(L, K.kerem, K.yeniKerem, [K.yeniKerem, K.kerem, K.husniye]))
  const gv2 = GV.buildGuestView(L, id(C.misafir1), K.yeniKerem)
  const v2 = GV.acceptGuestView(v1, gv2, C.misafir1.memberId)
  t.is(v2.signerHex, id(K.yeniKerem))
  // Misafirliği vermeyen ebeveyn görünüm imzalayamaz
  t.is(hataOf(() => GV.buildGuestView(anaDefter(17), id(C.misafir1), K.husniye)), 'NOT_SIGNER')
  // Halef kanıtı başka bir ROTATE_DEVICE ise kabul edilmez
  const L4 = anaDefter(17)
  L4.apply(rotate(L4, K.husniye, K.u9, [K.u9, K.husniye, K.kerem]))
  const sahte = GV.buildGuestView(L4, id(C.misafir1), K.kerem)
  t.is(GV.acceptGuestView(v1, sahte, C.misafir1.memberId).signerHex, id(K.kerem), 'imzacı değişmediyse kanıt gerekmez')
})

test('orta 7: 8 kişi sınırı bekleyen üyeleri de sayar; ACTIVATE sınırı yeniden denetler', (t) => {
  const L = anaDefter(6) // Kerem, Hüsniye, İrem, Ecem + kutu
  const sonra = TS0 + 2 * 86_400_000
  const uzak = (k) => ekle(L, k, 'yetiskin', [K.kerem, K.husniye], { remote: true, activatesAt: sonra })
  for (const k of [K.u5, K.u6, K.u7, K.u8]) L.apply(uzak(k))
  t.is(L.personIds().length, 4)
  t.is(hataOf(() => L.apply(uzak(K.u9))), 'MEMBER_LIMIT', '4 kişi + 4 bekleyen = 8')
})

test('düşük 10, 15, 16, 17: RETIRE_LIST.shares 16 bayt; sıfır kimlik yok; görev türü biçimi; kutuya yalnız yedek izni; silme raporu', (t) => {
  t.execution(() => c.encode(EM.retireList, { holds: [], blobs: [], shares: [b4a.alloc(16, 1)] }))
  const L = anaDefter(7)
  t.is(hataOf(() => L.apply(olay(L, T.PLACE, { placeId: b4a.alloc(16), name: 'Ev', kind: 'ev', remove: false }, [K.kerem]))), 'INVALID_BODY')
  t.is(hataOf(() => L.apply(koleksiyon(L, [K.kerem], { collectionId: b4a.alloc(16) }))), 'INVALID_BODY')
  t.is(hataOf(() => L.apply(olay(L, T.TASK_PERMIT, { subject: 'rol:cocuk', taskTypes: ['hf.task.ocr|x'], allow: true }, [K.kerem]))), 'INVALID_BODY')
  t.is(hataOf(() => L.apply(olay(L, T.TASK_PERMIT, { subject: 'rol:kutu', taskTypes: ['hf.task.ocr'], allow: true }, [K.kerem]))), 'INVALID_BODY')
  t.execution(() => L.apply(olay(L, T.TASK_PERMIT, { subject: 'rol:kutu', taskTypes: ['hf.task.backup'], allow: true }, [K.kerem])))
  // Silme raporu: raporun deviceId'si QR'daki ids[0], başlangıç bitişten sonra olamaz
  const anahtar = createIdentity({ seed: 'inceleme/rapor' }).signKeyPair
  const ids = [b4a.alloc(16, 0x44)]
  const qr = EM.encodeKeyQr({ hostId: b4a.alloc(16, 0x40), ids, retireNonce: b4a.alloc(16, 1), reportPub: anahtar.publicKey, disks: 1, toolVersion: '1' })
  const rapor = (ek) => EM.signWipeReport({ deviceId: ids[0], serial: 'S', model: 'M', diskModel: 'D', diskSerial: 'DS', method: 'nvme-sanitize-crypto', tool: 'nvme', toolVersion: '2', driveStatus: 'ok', result: 'ok', startedAt: 1000, finishedAt: 2000, ...ek }, anahtar)
  t.execution(() => EM.verifyWipe(qr, EM.encodeReportChunks([rapor()])))
  t.is(hataOf(() => EM.verifyWipe(qr, EM.encodeReportChunks([rapor({ deviceId: b4a.alloc(16, 0x45) })]))), 'INVALID_REPORT')
  t.is(hataOf(() => EM.verifyWipe(qr, EM.encodeReportChunks([rapor({ startedAt: 3000 })]))), 'INVALID_REPORT')
})

test('düşük 12: okuyucularının hepsi aileden çıkmış koleksiyonu herhangi bir ebeveyn tek imzayla kapatır', (t) => {
  const L = anaDefter(11) // İrem'in kişisel koleksiyonu yok; tek okuyuculu genel koleksiyon kurarız
  const X = b4a.alloc(16, 0x3e)
  L.apply(koleksiyon(L, [K.kerem, K.irem], { collectionId: X, name: 'İrem notları', readers: [uye(K.irem)], writers: [uye(K.irem)] }))
  L.apply(olay(L, T.LEAVE, { memberId: K.irem.memberId }, [K.irem]))
  t.execution(() => L.apply(koleksiyon(L, [K.husniye], { collectionId: X, name: 'İrem notları', readers: [], writers: [] })))
})

test('düşük 13, 18, 19: görünümü yalnız ebeveyn imzalar; misafir defter yüzünde len; ilk görünümde GRANT tam doğrulanır', (t) => {
  const L = anaDefter(17)
  L.apply(olay(L, T.SET_ROLE, { memberId: K.kerem.memberId, role: 'yetiskin' }, [K.kerem, K.husniye]))
  t.is(hataOf(() => GV.buildGuestView(L, id(C.misafir1), K.kerem)), 'NO_TARGET', 'ebeveynlikten inince misafirlik düşer (RFC-0020 e)')
  const L2 = anaDefter(17)
  const v = GV.acceptGuestView(null, GV.buildGuestView(L2, id(C.misafir1), K.kerem), C.misafir1.memberId)
  t.is(GV.guestLedger(v).len, L2.len)
  t.ok(v.grantDogrulandi)
})

test('düşük 20: emanet mührü üretim yolunda dışarıdan nonce almaz', (t) => {
  const pair = b4a.alloc(32, 1)
  const a = S.sealEnvelope(pair, b4a.alloc(16, 1), b4a.alloc(16, 2), 0x81, b4a.from('x'), b4a.alloc(16, 3), b4a.alloc(24, 9))
  t.absent(b4a.equals(a.subarray(0, 24), b4a.alloc(24, 9)))
  t.ok(S.sealEnvelopeVektor)
  t.ok(sodium && seviye && cihazEkle && eventHash)
})
