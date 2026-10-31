// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// RFC-0005 ekip topluluğu: kuruluş, roller, yeter sayı, çatallanma (§18 vektör 1–6, 17). Beklenen değerler elle.
const test = require('brittle')
const b4a = require('b4a')
const { Ledger, T } = require('../ledger/ledger')
const { keepMineOf } = require('../ledger/sync')
const { DEFAULT_POLICY } = require('../ledger/policy')
const V = require('./helpers/v21')

const { K, C, hex, olay, ekle, genesis, cihazEkle, TS0 } = V
const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const id = (k) => hex(k.memberId)
const YER_A = b4a.alloc(16, 0xa1)
const YER_B = b4a.alloc(16, 0xb2)
const yer = (L, p, imz = [K.kerem]) => olay(L, T.PLACE, { placeId: p, name: 'Şube', kind: 'sube', remove: false }, imz)
const ata = (L, kim, yerler, imz) => olay(L, T.ASSIGN, { subjectId: kim.memberId, placeIds: yerler }, imz)
const politika = (L, maxMembers, imz = [K.kerem]) => olay(L, T.POLICY, { policy: { ...DEFAULT_POLICY, maxMembers } }, imz)

// GENESIS → KIND ekip → PROTOCOL_LEVEL 2.1 → POLICY 32 → iki yer → kurucu A'ya atanır
function ekip () {
  const L = new Ledger({ now: () => TS0 })
  L.apply(genesis())
  L.apply(olay(L, T.KIND, { kind: 'ekip' }, [K.kerem]))
  L.apply(olay(L, T.PROTOCOL_LEVEL, { level: '2.1' }, [K.kerem]))
  L.apply(politika(L, 32))
  L.apply(yer(L, YER_A))
  L.apply(yer(L, YER_B))
  L.apply(ata(L, K.kerem, [YER_A], [K.kerem]))
  return L
}

test('ekip 1–3: kuruluş — kurucu sahip olur; KIND seq 1 dışında geçersiz; 2.1 öncesi olay LEVEL_TOO_LOW; ASSIGN ailede TEAM_ONLY', (t) => {
  const L = new Ledger({ now: () => TS0 })
  L.apply(genesis())
  L.apply(olay(L, T.KIND, { kind: 'ekip' }, [K.kerem]))
  t.is(L.kind, 'ekip')
  t.is(L.members.get(id(K.kerem)).role, 'sahip')
  t.is(hataOf(() => L.check(olay(L, T.KIND, { kind: 'ekip' }, [K.kerem]))), 'KIND_ERROR', 'seq 2')
  t.is(hataOf(() => L.check(ekle(L, K.husniye, 'calisan', [K.kerem]))), 'LEVEL_TOO_LOW')
  L.apply(olay(L, T.PROTOCOL_LEVEL, { level: '2.1' }, [K.kerem]))
  t.is(hataOf(() => L.check(olay(L, T.KIND, { kind: 'ekip' }, [K.kerem]))), 'KIND_ERROR')
  // Aile
  const A = new Ledger({ now: () => TS0 })
  A.apply(genesis())
  A.apply(olay(A, T.PROTOCOL_LEVEL, { level: '2.1' }, [K.kerem]))
  A.apply(olay(A, T.PLACE, { placeId: YER_A, name: 'Ev', kind: 'ev', remove: false }, [K.kerem]))
  t.is(hataOf(() => A.check(olay(A, T.PLACE, { placeId: YER_B, name: 'x', kind: 'sube', remove: false }, [K.kerem]))), 'INVALID_BODY', 'sube ailede yer türü değil')
  t.is(hataOf(() => A.check(ata(A, K.kerem, [YER_A], [K.kerem]))), 'TEAM_ONLY')
})

test('ekip 4: çalışanı yönetici ekler; çalışan ekleyemez; çoğunluk aranmaz', (t) => {
  const L = ekip()
  L.apply(ekle(L, K.husniye, 'yonetici', [K.kerem]))
  t.is(hataOf(() => L.apply(ekle(L, K.irem, 'calisan', [K.husniye]))), null, 'yönetici + yeni')
  t.is(hataOf(() => L.check(ekle(L, K.ecem, 'calisan', [K.irem]))), 'NO_INVITE_PERMISSION')
  t.is(hataOf(() => L.check(ekle(L, K.ecem, 'yonetici', [K.husniye]))), 'NO_OWNER_SIGNATURE')
})

test('ekip 5: 4. sahip OWNER_LIMIT; sahip çıkarma diğerlerinin çoğunluğu; son sahip LAST_OWNER', (t) => {
  const L = ekip()
  t.is(hataOf(() => L.check(olay(L, T.SET_ROLE, { memberId: K.kerem.memberId, role: 'yonetici' }, [K.kerem]))), 'LAST_OWNER')
  L.apply(ekle(L, K.husniye, 'sahip', [K.kerem]))
  L.apply(ekle(L, K.irem, 'sahip', [K.kerem, K.husniye]))
  t.is(hataOf(() => L.check(ekle(L, K.ecem, 'sahip', [K.kerem, K.husniye, K.irem]))), 'OWNER_LIMIT')
  t.is(hataOf(() => L.check(olay(L, T.REMOVE_MEMBER, { memberId: K.irem.memberId, reason: 'x', wipe: false }, [K.kerem]))), 'NO_OWNER_APPROVAL', 'iki diğer sahibin çoğunluğu 2')
  t.is(hataOf(() => L.apply(olay(L, T.REMOVE_MEMBER, { memberId: K.irem.memberId, reason: 'x', wipe: false }, [K.kerem, K.husniye]))), null)
  t.is(hataOf(() => L.apply(olay(L, T.REMOVE_MEMBER, { memberId: K.husniye.memberId, reason: 'x', wipe: false }, [K.kerem]))), null, 'iki sahipten biri ötekini çıkarır')
})

test('ekip 6: kutusuz ekipte 9. kişi BOX_REQUIRED; kutu eklenip atanınca geçerli; geçici oy veremez', (t) => {
  const L = ekip()
  const kisiler = ['husniye', 'irem', 'ecem', 'u5', 'u6', 'u7', 'u8']
  for (const k of kisiler) L.apply(ekle(L, K[k], 'calisan', [K.kerem]))
  t.is(L.personIds().length, 8)
  t.is(hataOf(() => L.check(ekle(L, K.u9, 'calisan', [K.kerem]))), 'BOX_REQUIRED')
  L.apply(ekle(L, K.kutu, 'kutu', [K.kerem]))
  L.apply(ata(L, K.kutu, [YER_A], [K.kerem]))
  t.is(hataOf(() => L.apply(ekle(L, K.u9, 'gecici', [K.kerem]))), null)
  t.is(hataOf(() => L.check(yer(L, b4a.alloc(16, 0xc3), [K.u9]))), 'TEMPORARY_CANNOT_VOTE')
  t.is(hataOf(() => L.check(ata(L, K.kutu2, [YER_B], [K.kerem]))), 'NO_TARGET')
})

test('ekip 17: çatallanmada çalışan imzaları sayılmaz; yöneticinin DEVICE_DETACH dalı güçlü', (t) => {
  const L = ekip()
  L.apply(ekle(L, K.husniye, 'yonetici', [K.kerem]))
  L.apply(ata(L, K.husniye, [YER_A], [K.kerem]))
  L.apply(ekle(L, K.irem, 'calisan', [K.kerem]))
  L.apply(ekle(L, K.ecem, 'calisan', [K.kerem]))
  L.apply(cihazEkle(L, C.isci1, [K.husniye], { placeId: YER_A }))
  const prefix = L.events.slice()
  // Dal 1: üç imzalı yer (biri sahip, ikisi çalışan) — çalışan imzaları sayılmaz; dal 2: yöneticinin cihaz çıkarması
  const A = Ledger.fromEvents(prefix, { now: () => TS0 })
  const yerOlayi = olay(A, T.BEING, { beingId: b4a.alloc(16, 5), kind: 'raf', name: 'R', placeId: b4a.alloc(16), remove: false }, [K.kerem, K.irem, K.ecem])
  const B = Ledger.fromEvents(prefix, { now: () => TS0 })
  const cikar = olay(B, T.DEVICE_DETACH, { deviceId: C.isci1.memberId, reason: 'x', wipe: false, wipeReportHash: b4a.alloc(32) }, [K.husniye])
  t.absent(keepMineOf([yerOlayi], [cikar], prefix), 'güçlü dal kazanır')
  const { signerCount } = require('../ledger/sync')
  t.is(signerCount(yerOlayi, L), 1, 'yalnız sahip sayılır')
})

const koleksiyonEkip = (L, imz, ek) => olay(L, T.COLLECTION, {
  collectionId: b4a.alloc(16, 0x51), name: 'Yer:A', kind: 'genel', readers: ['rol:sahip'], writers: ['rol:sahip'],
  sensitivity: 'normal', taskAccess: true, history: true, dropKey: b4a.alloc(32), ...ek
}, imz)

test('ekip 7: aynı yere ikinci kutu PLACE_BOX_LIMIT; yer başına 17. cihaz PLACE_DEVICE_LIMIT', (t) => {
  const L = ekip()
  L.apply(ekle(L, K.kutu, 'kutu', [K.kerem]))
  L.apply(ata(L, K.kutu, [YER_A], [K.kerem]))
  L.apply(ekle(L, K.kutu2, 'kutu', [K.kerem]))
  t.is(hataOf(() => L.check(ata(L, K.kutu2, [YER_A], [K.kerem]))), 'PLACE_BOX_LIMIT')
  t.is(hataOf(() => L.apply(ata(L, K.kutu2, [YER_B], [K.kerem]))), null)
  t.is(hataOf(() => L.check(ekle(L, K.u9, 'kutu', [K.kerem]))), 'BOX_LIMIT', 'kutu sayısı yer sayısını aşamaz')
  for (let i = 2; i <= 17; i++) L.apply(cihazEkle(L, C['isci' + i], [K.kerem], { placeId: YER_A }))
  t.is(hataOf(() => L.check(cihazEkle(L, C.isci18, [K.kerem], { placeId: YER_A }))), 'PLACE_DEVICE_LIMIT')
  t.is(hataOf(() => L.check(cihazEkle(L, C.isci18, [K.kerem], { placeId: b4a.alloc(16) }))), 'PLACE_REQUIRED')
  t.is(hataOf(() => L.check(cihazEkle(L, C.isci18, [K.kerem], { placeId: YER_B }))), null)
})

test('ekip 8: yönetici kendi yerinde olmayan çalışanı başka yere atayamaz; sahip atar', (t) => {
  const L = ekip()
  L.apply(ekle(L, K.husniye, 'yonetici', [K.kerem]))
  L.apply(ata(L, K.husniye, [YER_A], [K.kerem]))
  L.apply(ekle(L, K.irem, 'calisan', [K.kerem]))
  L.apply(ata(L, K.irem, [YER_A], [K.husniye]))
  t.is(hataOf(() => L.check(ata(L, K.irem, [YER_B], [K.husniye]))), 'OUT_OF_SCOPE', 'B yöneticinin alanında değil')
  t.is(hataOf(() => L.apply(ata(L, K.irem, [YER_B], [K.kerem]))), null)
  t.is(hataOf(() => L.check(ata(L, K.husniye, [YER_B], [K.husniye]))), 'NO_OWNER_SIGNATURE', 'yöneticiyi yalnız sahip atar')
})

test('ekip 16: ekipte kisisel yok; kasa okuyucusu çalışan olamaz; yer: öznesi', (t) => {
  const L = ekip()
  t.is(hataOf(() => L.check(koleksiyonEkip(L, [K.kerem], { kind: 'kisisel', readers: ['uye:' + id(K.kerem)], writers: ['uye:' + id(K.kerem)], taskAccess: false }))), 'NO_IN_TEAM_PERSONAL')
  t.is(hataOf(() => L.check(koleksiyonEkip(L, [K.kerem], { readers: ['rol:sahip', 'rol:calisan'], writers: ['rol:sahip'], sensitivity: 'kasa', taskAccess: false }))), 'VAULT_RULE')
  t.is(hataOf(() => L.check(koleksiyonEkip(L, [K.kerem], { readers: ['rol:ebeveyn'], writers: [] }))), 'INVALID_BODY', 'aile rolü ekipte yok')
  const yerA = 'yer:' + hex(YER_A) + '/rol:calisan'
  t.is(hataOf(() => L.apply(koleksiyonEkip(L, [K.kerem], { readers: ['rol:sahip', yerA], writers: ['rol:sahip', yerA] }))), null)
  t.is(hataOf(() => L.check(koleksiyonEkip(L, [K.kerem], { collectionId: b4a.alloc(16, 0x52), readers: ['yer:' + 'ff'.repeat(16) + '/rol:calisan'], writers: [] }))), 'NO_PLACE')
})

test('ekip 12 ve 13: EKIP_CIKIS — geçerli olay silme der, sahte imza reddedilir; makbuz imzası; çıkarılan sahip silmez', (t) => {
  const EC = require('../protocol/team-exit')
  const { decodeEvent, encodeEvent } = require('../ledger/ledger')
  const L = ekip()
  L.apply(ekle(L, K.irem, 'calisan', [K.kerem]))
  L.apply(ekle(L, K.husniye, 'sahip', [K.kerem]))
  const kopyaDefter = Ledger.fromEvents(L.events.map((e) => decodeEvent(encodeEvent(e))), { now: () => TS0 })
  const cikar = olay(L, T.REMOVE_MEMBER, { memberId: K.irem.memberId, reason: 'işten ayrılış', wipe: false }, [K.kerem])
  const r = EC.cikisDenetle(kopyaDefter, EC.encodeCikis(L, cikar), id(K.irem))
  t.alike([r.sil, r.kapsam], [true, EC.KAPSAM.IS])
  const sahte = decodeEvent(encodeEvent(cikar))
  sahte.sigs[0].sig[0] ^= 1
  t.is(hataOf(() => EC.cikisDenetle(kopyaDefter, EC.encodeCikis(L, sahte), id(K.irem))), 'INVALID_SIGNATURE')
  t.is(hataOf(() => EC.cikisDenetle(kopyaDefter, EC.encodeCikis(L, cikar), id(K.husniye))), 'TARGET_NOT_ME')
  L.apply(cikar)
  const makbuz = EC.makbuzYaz(L.familyId, K.irem, { eventHash: require('../ledger/encoding').eventHash(cikar), scope: 1, collections: 3, convs: 1, blobs: 7, finishedAt: TS0 + 1000 })
  t.is(EC.makbuzDenetle(L, makbuz, { simdi: TS0 + 5000 }).collections, 3)
  const bozuk = b4a.from(makbuz); bozuk[bozuk.length - 1] ^= 1
  t.is(hataOf(() => EC.makbuzDenetle(L, bozuk, { simdi: TS0 + 5000 })), 'INVALID_SIGNATURE')
  t.is(hataOf(() => EC.makbuzDenetle(L, makbuz, { simdi: TS0 + 31 * 86_400_000 })), 'UNAUTHORIZED', '30 günden sonra')
  // Sahip, wipe: false → iş kapsamı silinmez
  const kopya2 = Ledger.fromEvents(L.events.map((e) => decodeEvent(encodeEvent(e))), { now: () => TS0 })
  const sahipCikar = olay(L, T.REMOVE_MEMBER, { memberId: K.husniye.memberId, reason: 'x', wipe: false }, [K.kerem])
  t.is(EC.cikisDenetle(kopya2, EC.encodeCikis(L, sahipCikar), id(K.husniye)).sil, false)
})

test('ekip 13.1: görev izni varsayılanları', (t) => {
  const { canTask } = require('../ledger/v21')
  const L = ekip()
  L.apply(ekle(L, K.husniye, 'yonetici', [K.kerem]))
  L.apply(ekle(L, K.irem, 'calisan', [K.kerem]))
  L.apply(ekle(L, K.ecem, 'gecici', [K.kerem]))
  t.ok(canTask(L, id(K.kerem), 'hf.task.vision', { continuous: true }))
  t.ok(canTask(L, id(K.husniye), 'hf.task.vision', { continuous: true }))
  t.ok(canTask(L, id(K.irem), 'hf.task.ocr'))
  t.absent(canTask(L, id(K.irem), 'hf.task.vision'))
  t.absent(canTask(L, id(K.irem), 'hf.task.ocr', { continuous: true }))
  t.absent(canTask(L, id(K.ecem), 'hf.task.ocr'))
})

test('ekip: SHARE_CONSENT iptal biçimini okuyucu (sahip ya da yönetici) yazar; çalışan yazamaz (RFC-0010 açıklama 3 madde 1)', (t) => {
  const E = require('./helpers/team-install')
  const L = E.ekip()
  L.apply(E.ekle(L, E.K.husniye, 'yonetici', [E.K.kerem]))
  L.apply(E.ekle(L, E.K.irem, 'calisan', [E.K.kerem]))
  const pay = (imz, ek = {}) => E.olay(L, E.T.SHARE_CONSENT, { shareId: b4a.alloc(16, 0x44), service: 's', scope: 'iptal', ownerId: b4a.alloc(16), expiresAt: 0, payloadHash: b4a.alloc(32), ...ek }, imz)
  t.ok(L.check(pay([E.K.husniye])), 'yönetici iptal biçimini yazar')
  t.ok(L.check(pay([E.K.kerem])), 'sahip')
  t.is(E.hataOf(() => L.check(pay([E.K.irem]))), 'NO_OWNER_SIGNATURE', 'çalışan okuyucu değil')
  t.is(E.hataOf(() => L.check(pay([E.K.husniye], { scope: 'tek:guvenlik', expiresAt: 5, payloadHash: b4a.alloc(32, 1) }))), 'NO_OWNER_SIGNATURE', 'onay biçimi yine sahip ister')
})
