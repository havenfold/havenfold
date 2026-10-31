// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// protocol/vectors/team.json üreticisi (RFC-0005 §18). Zincir: GENESIS → KIND ekip → 2.1 → POLICY 32 → iki yer →
// atamalar ve üyeler. Her durum: zincirin ilk `onek` olayı ve `hazirlik` olayları uygulanır, `olay` denetlenir; `beklenen` elle yazılmıştır
// (null = geçerli). Kimlikler createIdentity({ seed: "defter-vektor/<ad>" }).
const b4a = require('b4a')
const { Ledger, T, encodeEvent, decodeEvent } = require('../../ledger/ledger')
const { DEFAULT_POLICY } = require('../../ledger/policy')
const V = require('./v21')
const { createIdentity } = require('../../core/identity')
const { forkWinner } = require('../../ledger/sync')
const { eventHash } = require('../../ledger/encoding')

const { K, C, hex, olay, ekle, genesis, cihazEkle, TS0 } = V
const YER_A = b4a.alloc(16, 0xa1)
const YER_B = b4a.alloc(16, 0xb2)
const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }

function zincir () {
  const L = new Ledger({ now: () => TS0 })
  const adimlar = [
    () => genesis(),
    () => olay(L, T.KIND, { kind: 'ekip' }, [K.kerem]),
    () => olay(L, T.PROTOCOL_LEVEL, { level: '2.1' }, [K.kerem]),
    () => olay(L, T.POLICY, { policy: { ...DEFAULT_POLICY, maxMembers: 32 } }, [K.kerem]),
    () => olay(L, T.PLACE, { placeId: YER_A, name: 'Merkez', kind: 'sube', remove: false }, [K.kerem]),
    () => olay(L, T.PLACE, { placeId: YER_B, name: 'Depo', kind: 'depo', remove: false }, [K.kerem]),
    () => olay(L, T.ASSIGN, { subjectId: K.kerem.memberId, placeIds: [YER_A] }, [K.kerem]),
    () => ekle(L, K.husniye, 'yonetici', [K.kerem]),
    () => olay(L, T.ASSIGN, { subjectId: K.husniye.memberId, placeIds: [YER_A] }, [K.kerem]),
    () => ekle(L, K.irem, 'calisan', [K.husniye]),
    () => olay(L, T.ASSIGN, { subjectId: K.irem.memberId, placeIds: [YER_A] }, [K.husniye]),
    () => ekle(L, K.ecem, 'gecici', [K.husniye]),
    () => olay(L, T.ASSIGN, { subjectId: K.ecem.memberId, placeIds: [YER_A] }, [K.husniye]),
    () => olay(L, T.TERM, { memberId: K.ecem.memberId, expiresAt: TS0 + 30 * 86_400_000 }, [K.husniye]),
    () => ekle(L, K.kutu, 'kutu', [K.kerem]),
    () => olay(L, T.ASSIGN, { subjectId: K.kutu.memberId, placeIds: [YER_A] }, [K.kerem]),
    () => cihazEkle(L, C.isci1, [K.husniye], { placeId: YER_A })
  ]
  return adimlar.map((f) => { const e = f(); L.apply(e); return e })
}

const ZINCIR = zincir()
const N = ZINCIR.length
function defter (n) {
  const L = new Ledger({ now: () => TS0 })
  for (const e of ZINCIR.slice(0, n)) L.apply(decodeEvent(encodeEvent(e)))
  return L
}

function vektorler () {
  const durumlar = []
  const d = (no, aciklama, onek, kur, beklenen) => {
    const L = defter(onek)
    const e = kur(L)
    const gercek = hataOf(() => L.check(e))
    if (gercek !== beklenen) throw new Error(`ekip ${no} ${aciklama}: ${gercek} ≠ ${beklenen}`)
    durumlar.push({ no, aciklama, onek, hazirlik: (L.hazirlik || []).map((x) => hex(encodeEvent(x))), olay: hex(encodeEvent(e)), beklenen })
  }
  d(2, 'KIND ekip seq 2\'de', 2, (L) => olay(L, T.KIND, { kind: 'ekip' }, [K.kerem]), 'KIND_ERROR')
  d(2, 'KIND sonrası 2.1 öncesi ADD_MEMBER', 2, (L) => ekle(L, K.irem, 'calisan', [K.kerem]), 'LEVEL_TOO_LOW')
  d(4, 'çalışanı yönetici ekler', N, (L) => ekle(L, K.u5, 'calisan', [K.husniye]), null)
  d(4, 'çalışan üye ekleyemez', N, (L) => ekle(L, K.u5, 'calisan', [K.irem]), 'NO_INVITE_PERMISSION')
  d(4, 'yöneticiyi yönetici ekleyemez', N, (L) => ekle(L, K.u5, 'yonetici', [K.husniye]), 'NO_OWNER_SIGNATURE')
  d(5, 'tek sahip kendini düşüremez', N, (L) => olay(L, T.SET_ROLE, { memberId: K.kerem.memberId, role: 'yonetici' }, [K.kerem]), 'LAST_OWNER')
  d(6, 'geçici oy veremez', N, (L) => olay(L, T.PLACE, { placeId: b4a.alloc(16, 0xc3), name: 'x', kind: 'ofis', remove: false }, [K.ecem]), 'TEMPORARY_CANNOT_VOTE')
  d(7, 'aynı yere ikinci kutu', N, (L) => { const h = ekle(L, K.kutu2, 'kutu', [K.kerem]); L.apply(h); L.hazirlik = [h]; return olay(L, T.ASSIGN, { subjectId: K.kutu2.memberId, placeIds: [YER_A] }, [K.kerem]) }, 'PLACE_BOX_LIMIT')
  d(7, 'yersiz cihaz', N, (L) => cihazEkle(L, C.isci2, [K.kerem], { placeId: b4a.alloc(16) }), 'PLACE_REQUIRED')
  d(8, 'yönetici alanı dışına atar', N, (L) => olay(L, T.ASSIGN, { subjectId: K.irem.memberId, placeIds: [YER_B] }, [K.husniye]), 'OUT_OF_SCOPE')
  d(8, 'sahip aynı atamayı yapar', N, (L) => olay(L, T.ASSIGN, { subjectId: K.irem.memberId, placeIds: [YER_B] }, [K.kerem]), null)
  d(11, 'TERM çalışana', N, (L) => olay(L, T.TERM, { memberId: K.irem.memberId, expiresAt: TS0 }, [K.kerem]), 'NOT_TARGET_TEMPORARY')
  d(16, 'ekipte kisisel koleksiyon', N, (L) => olay(L, T.COLLECTION, { collectionId: b4a.alloc(16, 0x51), name: 'K', kind: 'kisisel', readers: ['uye:' + hex(K.irem.memberId)], writers: ['uye:' + hex(K.irem.memberId)], sensitivity: 'normal', taskAccess: false, history: true, dropKey: b4a.alloc(32) }, [K.kerem]), 'NO_IN_TEAM_PERSONAL')
  d(16, 'kasa okuyucusu rol:calisan', N, (L) => olay(L, T.COLLECTION, { collectionId: b4a.alloc(16, 0x52), name: 'Kasa', kind: 'genel', readers: ['rol:sahip', 'rol:calisan'], writers: ['rol:sahip'], sensitivity: 'kasa', taskAccess: false, history: true, dropKey: b4a.alloc(32) }, [K.kerem]), 'VAULT_RULE')
  // Aile: ASSIGN TEAM_ONLY (vektör 3)
  const A = new Ledger({ now: () => TS0 })
  A.apply(genesis())
  A.apply(olay(A, T.PROTOCOL_LEVEL, { level: '2.1' }, [K.kerem]))
  const aileAta = olay(A, T.ASSIGN, { subjectId: K.kerem.memberId, placeIds: [] }, [K.kerem])
  if (hataOf(() => A.check(aileAta)) !== 'TEAM_ONLY') throw new Error('ekip 3')
  const aileZinciri = A.events.map((e) => hex(encodeEvent(e)))
  return {
    aciklama: 'RFC-0005 §18: ekip topluluğu. `zincir` olayları sırayla uygulanır; her durumda zincirin ilk `onek` olayı uygulanmış deftere `olay` denetlenir. `beklenen` hata kodudur (null: geçerli). Vektör 1 (aile vektörleri değişmeden geçer) diğer dosyalardadır; 9, 10, 12–15 kayıt, görev ve ayrılış davranışları paket testlerindedir.',
    zincir: ZINCIR.map((e) => ({ tur: e.type, olay: hex(encodeEvent(e)) })),
    durumlar,
    aile: { zincir: aileZinciri, olay: hex(encodeEvent(aileAta)), beklenen: 'TEAM_ONLY' }
  }
}


// --- team-v2.json (inceleme 7 vektör eksikleri ve RFC-0022) ----------------------------------------------------
// team.json değişmez. Bu dosya onun bütün durumlarını ve şunları taşır: 4 (31 oy veren), 5, 6, 7, 17 ve RFC-0022 b, c, f.
const kisi = (i) => Object.assign(createIdentity({ seed: 'ekip-v2/kisi' + i, platform: 'test' }), { ad: 'Kişi ' + i })
const KISI = Array.from({ length: 32 }, (_, i) => kisi(i))

function vektorlerV2 () {
  const v1 = vektorler()
  const durumlar = [...v1.durumlar]
  const d = (no, aciklama, onek, hazirla, kur, beklenen) => {
    const L = defter(onek)
    const hazirlik = []
    const uygula = (e) => { L.apply(e); hazirlik.push(e) }
    hazirla(L, uygula)
    const e = kur(L)
    const gercek = hataOf(() => L.check(e))
    if (gercek !== beklenen) throw new Error(`ekip-v2 ${no} ${aciklama}: ${gercek} ≠ ${beklenen}`)
    durumlar.push({ no, aciklama, onek, hazirlik: hazirlik.map((x) => hex(encodeEvent(x))), olay: hex(encodeEvent(e)), beklenen })
  }
  const calisanlar = (n, from = 0) => (L, u) => { for (let i = from; i < from + n; i++) u(ekle(L, KISI[i], 'calisan', [K.husniye])) }
  const ecemsiz = (L, u) => u(olay(L, T.REMOVE_MEMBER, { memberId: K.ecem.memberId, reason: 'x', wipe: false }, [K.husniye]))
  const kutuOncesi = 14 // zincirde kutunun eklenmesinden önceki önek: Kerem, Hüsniye, İrem, Ecem (4 kişi)

  // 4: 31 kişi (30 oy veren + kutu) varken 31. oy vereni tek yönetici ekler; çoğunluk aranmaz
  d(4, '30 oy veren varken çalışanı tek yönetici ekler', N, (L, u) => { ecemsiz(L, u); calisanlar(27)(L, u) }, (L) => ekle(L, KISI[27], 'calisan', [K.husniye]), null)
  // 5
  d(5, '4. sahip', N, (L, u) => { u(ekle(L, K.u5, 'sahip', [K.kerem])); u(ekle(L, K.u6, 'sahip', [K.kerem, K.u5])) }, (L) => ekle(L, K.u7, 'sahip', [K.kerem, K.u5, K.u6]), 'OWNER_LIMIT')
  d(5, 'iki sahipten biri ötekini çıkarır', N, (L, u) => u(ekle(L, K.u5, 'sahip', [K.kerem])), (L) => olay(L, T.REMOVE_MEMBER, { memberId: K.u5.memberId, reason: 'x', wipe: false }, [K.kerem]), null)
  d(5, 'bekleyen uzaktan sahip sınıra sayılır (inceleme 7 bulgu 8)', N, (L, u) => {
    u(ekle(L, K.u5, 'sahip', [K.kerem]))
    u(ekle(L, K.u6, 'sahip', [K.kerem, K.u5], { remote: true, activatesAt: TS0 + L.len * 1000 + 86_400_000 }))
  }, (L) => ekle(L, K.u7, 'sahip', [K.kerem, K.u5], { remote: true, activatesAt: TS0 + L.len * 1000 + 86_400_000 }), 'OWNER_LIMIT')
  // 6
  d(6, 'kutusuz ekipte 9. kişi', kutuOncesi, calisanlar(4), (L) => ekle(L, KISI[4], 'calisan', [K.husniye]), 'BOX_REQUIRED')
  d(6, 'kutu bir yere atanmışken 9. kişi', N, calisanlar(3), (L) => ekle(L, KISI[3], 'calisan', [K.husniye]), null)
  d(6, '33. kişi', N, (L, u) => { ecemsiz(L, u); calisanlar(28)(L, u); u(ekle(L, KISI[28], 'gecici', [K.husniye])) }, (L) => ekle(L, KISI[29], 'calisan', [K.husniye]), 'MEMBER_LIMIT')
  // 7
  d(7, 'yer başına 17. cihaz', N, (L, u) => { for (let i = 2; i <= 16; i++) u(cihazEkle(L, C['isci' + i], [K.husniye], { placeId: YER_A })) }, (L) => cihazEkle(L, C.isci17, [K.husniye], { placeId: YER_A }), 'PLACE_DEVICE_LIMIT')
  // RFC-0022 c: yönetici alanı dışındaki çalışanın telefonunu değiştiremez
  d('0022c', 'yönetici B\'deki çalışanın telefonunu değiştiremez', N, (L, u) => u(olay(L, T.ASSIGN, { subjectId: K.irem.memberId, placeIds: [YER_B] }, [K.kerem])),
    (L) => olay(L, T.ROTATE_DEVICE, { oldMemberId: K.irem.memberId, newDeviceCert: K.u8.deviceCert, ceremonyTranscriptHash: b4a.alloc(32, 7) }, [K.u8, K.husniye]), 'OUT_OF_SCOPE')
  // RFC-0022 b: ekipte APP_PRIMARY hızlandırması telefon değişimi tablosuyla
  const X = Object.assign(createIdentity({ seed: 'ekip-v2/ek-x', platform: 'test' }), { ad: 'X' })
  const devirHazirla = (L, u) => {
    u(ekle(L, K.u5, 'sahip', [K.kerem]))
    u(olay(L, T.PROTOCOL_LEVEL, { level: '2.2' }, [K.kerem]))
    u(olay(L, T.APP_ATTACH, { deviceCert: X.deviceCert, personId: K.kerem.memberId, appId: 'mekan-defteri', sameDevice: false, replaces: null, ceremonyTranscriptHash: b4a.alloc(32, 7) }, [X, K.kerem]))
  }
  const devir = (imz, parentSigned) => (L) => olay(L, T.APP_PRIMARY, { personId: K.kerem.memberId, newPrimaryId: X.memberId, against: K.kerem.memberId, oldSigned: false, parentSigned }, [X, ...imz])
  d('0022b', 'tek yönetici sahibin devrini hızlandıramaz', N, devirHazirla, devir([K.husniye], true), 'MODE_MISMATCH')
  d('0022b', 'yönetici imzalı devir bekler', N, devirHazirla, devir([K.husniye], false), null)
  d('0022b', 'diğer bütün sahipler: hemen', N, devirHazirla, devir([K.u5], true), null)

  // 17: çatallanma — ortak önek N; kazanan forkWinner(a, b, önek defteri)
  const catallanma = []
  const c = (aciklama, kurA, kurB, kazanan) => {
    const L = defter(N)
    const a = kurA(L)
    const b = kurB(L)
    const w = forkWinner(a, b, L) === a ? 'a' : 'b'
    if (w !== kazanan) throw new Error('ekip-v2 17 ' + aciklama)
    catallanma.push({ no: 17, aciklama, onek: N, a: hex(encodeEvent(a)), b: hex(encodeEvent(b)), kazanan })
  }
  const det = (imz) => (L) => olay(L, T.DEVICE_DETACH, { deviceId: C.isci1.memberId, reason: 'x', wipe: false, wipeReportHash: b4a.alloc(32) }, imz)
  const ata = (L) => olay(L, T.ASSIGN, { subjectId: K.irem.memberId, placeIds: [YER_B] }, [K.kerem])
  c('yöneticinin yazdığı DEVICE_DETACH atmadır, kazanır', det([K.husniye]), ata, 'a')
  c('çalışanın ortak imzası ayrılışı atma yapmaz', det([C.isci1, K.irem]), ata, 'b')
  return { ...v1, aciklama: v1.aciklama + ' ekip-v2: ekip.json\'un bütün durumları + inceleme 7 eksikleri (4, 5, 6, 7) ve RFC-0022 b, c; `catallanma` (17): ortak önekten iki olay, `kazanan` forkWinner sonucu.', durumlar, catallanma }
}

module.exports = { vektorler, vektorlerV2, ZINCIR }
