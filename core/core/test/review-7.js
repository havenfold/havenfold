// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// İnceleme 7 (D10 ekip) bulguları: her düzeltmenin kırmızı testi (kollar/D-inceleme-7.md, RFC-0022)
const test = require('brittle')
const b4a = require('b4a')
const { T, signEvent } = require('../ledger/ledger')
const { yerleri, gecerliSure } = require('../ledger/team')
const { canTask } = require('../ledger/v21')
const { keepMineOf } = require('../ledger/sync')
const { createIdentity } = require('../core/identity')
const EC = require('../protocol/team-exit')
const { K, C, hex, olay, ekle, cihazEkle, TS0, hataOf, id, DAY, YER_A, YER_B, yerOlay, ata, dondur, cikar, sure, ekip, kopya } = require('./helpers/team-install')

test('1a: telefon değişiminden sonraki ASSIGN geçerli olur (kişi anahtarı)', (t) => {
  const L = ekip()
  L.apply(ekle(L, K.irem, 'calisan', [K.kerem]))
  L.apply(ata(L, K.irem, [YER_A], [K.kerem]))
  L.apply(dondur(L, K.irem, K.u8, [K.u8, K.irem]))
  t.alike(yerleri(L, id(K.u8)), [hex(YER_A)], 'atama telefon değişiminde kişiyle gelir')
  L.apply(ata(L, K.u8, [YER_B], [K.kerem]))
  t.alike(yerleri(L, id(K.u8)), [hex(YER_B)])
  L.apply(ata(L, K.u8, [], [K.kerem]))
  t.alike(yerleri(L, id(K.u8)), [], 'boş atama da etkili')
})

test('1b: alanı daraltılan yönetici (telefon değişiminden sonra) eski yerini yönetemez', (t) => {
  const L = ekip()
  L.apply(ekle(L, K.husniye, 'yonetici', [K.kerem]))
  L.apply(ata(L, K.husniye, [YER_A], [K.kerem]))
  L.apply(ekle(L, K.irem, 'calisan', [K.kerem]))
  L.apply(ata(L, K.irem, [YER_A], [K.kerem]))
  L.apply(dondur(L, K.husniye, K.u7, [K.u7, K.husniye]))
  L.apply(ata(L, K.u7, [YER_B], [K.kerem]))
  t.is(hataOf(() => L.check(cikar(L, K.irem, [K.u7], true))), 'OUT_OF_SCOPE')
  L.apply(ekle(L, K.ecem, 'calisan', [K.kerem]))
  L.apply(ata(L, K.ecem, [YER_B], [K.kerem]))
  t.is(hataOf(() => L.check(cikar(L, K.ecem, [K.u7]))), null, 'yeni alanı B')
})

test('2: telefon değişiminden sonraki kısaltıcı TERM geçerli olur', (t) => {
  const L = ekip()
  L.apply(ekle(L, K.irem, 'gecici', [K.kerem]))
  L.apply(sure(L, K.irem, TS0 + 90 * DAY))
  L.apply(dondur(L, K.irem, K.u8, [K.u8, K.kerem]))
  t.is(gecerliSure(L, id(K.u8)), TS0 + 90 * DAY, 'süre kişiyle gelir')
  L.apply(sure(L, K.u8, TS0))
  t.is(gecerliSure(L, id(K.u8)), TS0)
})


// Ekipte düzey 2.2 ve sahibin başka cihazdaki ek kimliği X
function devirKurulumu () {
  const L = ekip()
  L.apply(ekle(L, K.husniye, 'sahip', [K.kerem]))
  L.apply(ekle(L, K.u5, 'yonetici', [K.kerem]))
  L.apply(olay(L, T.PROTOCOL_LEVEL, { level: '2.2' }, [K.kerem]))
  const X = Object.assign(createIdentity({ seed: 'inceleme7/ek-x', platform: 'test' }), { ad: 'X' })
  L.apply(olay(L, T.APP_ATTACH, { deviceCert: X.deviceCert, personId: K.kerem.memberId, appId: 'mekan-defteri', sameDevice: false, replaces: null, ceremonyTranscriptHash: b4a.alloc(32, 7) }, [X, K.kerem]))
  const devir = (imz, parentSigned) => olay(L, T.APP_PRIMARY, { personId: K.kerem.memberId, newPrimaryId: X.memberId, against: K.kerem.memberId, oldSigned: false, parentSigned }, [X, ...imz])
  return { L, X, devir }
}

test('3: ekipte APP_PRIMARY telefon değişimi tablosuna bağlı (RFC-0022 b)', (t) => {
  const { L, devir } = devirKurulumu()
  t.is(hataOf(() => L.check(devir([K.u5], true))), 'MODE_MISMATCH', 'tek yönetici sahibin devrini hızlandıramaz')
  t.is(hataOf(() => L.check(devir([K.u5], false))), null, 'bekleyen devir olarak geçer')
  t.is(hataOf(() => L.check(devir([K.husniye], true))), null, 'diğer bütün sahipler: hemen')
  const { L: L2, X, devir: d2 } = devirKurulumu()
  L2.apply(d2([K.u5], false))
  t.ok(L2.members.get(hex(X.memberId)).pendingPrimary, '72 saat bekler')
  t.ok(L2.members.get(id(K.kerem)).active, 'sahibin telefonu düşmez')
})

test('4: yönetici yalnız kendi alanındaki kişinin telefonunu değiştirir (RFC-0022 c)', (t) => {
  const L = ekip()
  L.apply(ekle(L, K.husniye, 'yonetici', [K.kerem]))
  L.apply(ata(L, K.husniye, [YER_A], [K.kerem]))
  L.apply(ekle(L, K.irem, 'calisan', [K.kerem]))
  L.apply(ata(L, K.irem, [YER_B], [K.kerem]))
  L.apply(ekle(L, K.ecem, 'calisan', [K.kerem]))
  L.apply(ata(L, K.ecem, [YER_A], [K.kerem]))
  t.is(hataOf(() => L.check(dondur(L, K.irem, K.u8, [K.u8, K.husniye]))), 'OUT_OF_SCOPE')
  t.is(hataOf(() => L.check(dondur(L, K.ecem, K.u8, [K.u8, K.husniye]))), null, 'alanındaki çalışan')
  t.is(hataOf(() => L.check(dondur(L, K.irem, K.u8, [K.u8, K.kerem]))), null, 'sahip her yerde')
})

test('5: güncel kopyada reddedilen çıkarma uygulanmaz; sahip hiçbir yoldan tam silinmez (RFC-0022 d)', (t) => {
  const L = ekip()
  L.apply(ekle(L, K.husniye, 'sahip', [K.kerem]))
  L.apply(ekle(L, K.u5, 'yonetici', [K.kerem]))
  L.apply(ata(L, K.u5, [YER_A], [K.kerem]))
  const kop = kopya(L)
  const sahte = olay(L, T.REMOVE_MEMBER, { memberId: K.husniye.memberId, reason: 'x', wipe: true }, [K.u5])
  const bytes = EC.encodeCikis(L, sahte)
  t.is(hataOf(() => EC.cikisDenetle(kop, bytes, id(K.husniye), { simdi: TS0, sonBaglanti: TS0 })), 'NO_OWNER_APPROVAL', 'güncel kopyada kesin ret')
  t.is(hataOf(() => EC.cikisDenetle(kop, bytes, id(K.husniye), { simdi: TS0 + 8 * DAY, sonBaglanti: TS0 })), 'NO_OWNER_APPROVAL', '7 gün sonra da')
  // Geçerli çıkarma (diğer sahip) bile sahibe tam silme yaptırmaz
  const gercek = olay(L, T.REMOVE_MEMBER, { memberId: K.husniye.memberId, reason: 'x', wipe: true }, [K.kerem])
  t.alike(EC.cikisDenetle(kop, EC.encodeCikis(L, gercek), id(K.husniye), { simdi: TS0 }).sil, false)

  // Eski kopya yolu: yalnız iş kapsamı; imzacı kendi kopyasında hedefi yönetebilmeli
  L.apply(ekle(L, K.irem, 'calisan', [K.kerem]))
  L.apply(ata(L, K.irem, [YER_B], [K.kerem]))
  L.apply(ekle(L, K.ecem, 'calisan', [K.kerem]))
  L.apply(ata(L, K.ecem, [YER_A], [K.kerem]))
  const kop2 = kopya(L)
  const ileri = (hedef) => {
    const e = { ...olay(L, T.REMOVE_MEMBER, { memberId: hedef.memberId, reason: 'x', wipe: true }, []), seq: L.len + 5, prev: b4a.alloc(32, 9) }
    signEvent(e, K.u5)
    return EC.encodeCikis(L, e)
  }
  t.is(hataOf(() => EC.cikisDenetle(kop2, ileri(K.irem), id(K.irem), { simdi: TS0 + 8 * DAY, sonBaglanti: TS0 })), 'OUT_OF_SCOPE', 'alanı dışındaki çalışan')
  const r = EC.cikisDenetle(kop2, ileri(K.ecem), id(K.ecem), { simdi: TS0 + 8 * DAY, sonBaglanti: TS0 })
  t.alike([r.sil, r.kapsam], [true, EC.KAPSAM.IS], 'eski kopya yolunda wipe: true olsa da yalnız iş kapsamı')
})

test('e: makbuz tek kullanımlık, olaya ve kapsama bağlı; düşmüş kimlikten kabul edilmez', (t) => {
  const L = ekip()
  L.apply(ekle(L, K.irem, 'calisan', [K.kerem]))
  L.apply(ekle(L, K.ecem, 'calisan', [K.kerem]))
  const cikarma = olay(L, T.REMOVE_MEMBER, { memberId: K.irem.memberId, reason: 'x', wipe: true }, [K.kerem])
  L.apply(cikarma)
  const eh = L.hashAt(cikarma.seq)
  const me = { memberId: K.irem.memberId, signKeyPair: K.irem.signKeyPair || K.irem.sign }
  const yaz = (scope, ozet = eh, kim = me) => EC.makbuzYaz(L.familyId, kim, { eventHash: ozet, scope, collections: 1, convs: 0, blobs: 0, finishedAt: TS0 })
  const gorulen = new Set()
  t.is(hataOf(() => EC.makbuzDenetle(L, yaz(EC.KAPSAM.IS), { simdi: TS0, gorulen })), 'INVALID_RECEIPT', 'wipe: true için kapsam tam olmalı')
  t.is(hataOf(() => EC.makbuzDenetle(L, yaz(EC.KAPSAM.TAM, b4a.alloc(32)), { simdi: TS0, gorulen })), 'INVALID_RECEIPT', 'çıkarılmış üyede sıfır özet yok')
  t.is(hataOf(() => EC.makbuzDenetle(L, yaz(EC.KAPSAM.TAM), { simdi: TS0, gorulen })), null)
  t.is(hataOf(() => EC.makbuzDenetle(L, yaz(EC.KAPSAM.TAM), { simdi: TS0, gorulen })), 'DUPLICATE_RECEIPT')
  // Telefon değişimiyle düşmüş kimlik
  L.apply(dondur(L, K.ecem, K.u8, [K.u8, K.ecem]))
  const eski = { memberId: K.ecem.memberId, signKeyPair: K.ecem.signKeyPair || K.ecem.sign }
  t.is(hataOf(() => EC.makbuzDenetle(L, yaz(EC.KAPSAM.IS, b4a.alloc(32), eski), { simdi: TS0, gorulen })), 'INVALID_RECEIPT')
})

test('e: Posta Kutusu — ekipte çıkarılmış üyeden yalnız EKIP_CIKIS_OK geçer', (t) => {
  const { gelenZarf } = require('../protocol/ingress')
  const { Z } = require('../protocol/envelope')
  const L = ekip()
  L.apply(ekle(L, K.irem, 'calisan', [K.kerem]))
  const g = (type) => hataOf(() => gelenZarf({ myRole: 'uye', peerRole: 'uye', type, bytes: b4a.alloc(0), L, gonderen: id(K.irem), yol: 'dogrudan' }))
  t.is(g(0x81), null, 'aktif üyeden kayıt işlemi')
  L.apply(cikar(L, K.irem, [K.kerem]))
  t.is(g(0x81), 'TYPE_NOT_ALLOWED', 'çıkarılmış üyeden kayıt işlemi yok')
  t.is(g(Z.EKIP_CIKIS_OK), null, 'makbuz geçer')
})

test('8: bekleyen uzaktan sahipler sahip sınırına sayılır', (t) => {
  const L = ekip()
  L.apply(ekle(L, K.husniye, 'sahip', [K.kerem]))
  const uzak = (k) => ekle(L, k, 'sahip', [K.kerem, K.husniye], { remote: true, activatesAt: TS0 + L.len * 1000 + DAY })
  L.apply(uzak(K.u5))
  t.is(hataOf(() => L.check(uzak(K.u6))), 'OWNER_LIMIT')
  t.is(hataOf(() => L.check(olay(L, T.SET_ROLE, { memberId: K.kerem.memberId, role: 'yonetici' }, [K.kerem, K.husniye]))), null, 'kontrol: sahip yöneticiliğe inebilir')
})

test('9: çatallanmada çalışanın ortak imzası cihaz ayrılışını atma yapmaz', (t) => {
  const { Ledger } = require('../ledger/ledger')
  const L = ekip()
  L.apply(ekle(L, K.irem, 'calisan', [K.kerem]))
  L.apply(ata(L, K.irem, [YER_A], [K.kerem]))
  L.apply(cihazEkle(L, C.isci1, [K.kerem], { placeId: YER_A }))
  const prefix = L.events.slice()
  const B = Ledger.fromEvents(prefix, { now: () => TS0 })
  const sahipOlayi = ata(B, K.irem, [YER_B], [K.kerem])
  const det = (imz) => olay(B, T.DEVICE_DETACH, { deviceId: C.isci1.memberId, reason: 'x', wipe: false, wipeReportHash: b4a.alloc(32) }, imz)
  t.ok(keepMineOf([sahipOlayi], [det([C.isci1, K.irem])], prefix), 'yönetimin olayı kazanır')
  t.absent(keepMineOf([sahipOlayi], [det([C.isci1, K.kerem])], prefix), 'yönetim imzalı ayrılış atmadır, kazanır')
})

test('f: rol değişince eski TERM ve kaldırılan yerin atamaları geri gelmez', (t) => {
  const L = ekip()
  L.apply(ekle(L, K.irem, 'gecici', [K.kerem]))
  L.apply(sure(L, K.irem, TS0 + 90 * DAY))
  L.apply(olay(L, T.SET_ROLE, { memberId: K.irem.memberId, role: 'calisan' }, [K.kerem]))
  L.apply(olay(L, T.SET_ROLE, { memberId: K.irem.memberId, role: 'gecici' }, [K.kerem]))
  t.is(gecerliSure(L, id(K.irem)), 0, 'yeniden geçici: yeni TERM gerekir')
  L.apply(ata(L, K.irem, [YER_A], [K.kerem]))
  L.apply(yerOlay(L, YER_A, [K.kerem], true))
  L.apply(yerOlay(L, YER_A))
  t.alike(yerleri(L, id(K.irem)), [], 'yeniden eklenen yer eski atamayı getirmez')
  t.alike(yerleri(L, id(K.kerem)), [hex(YER_B)])
})

test('c: yönetici Olaylar koleksiyonuna alanı dışındaki cihazı yazar ekleyemez', (t) => {
  const L = ekip()
  L.apply(ekle(L, K.husniye, 'yonetici', [K.kerem]))
  L.apply(ata(L, K.husniye, [YER_A], [K.kerem]))
  L.apply(cihazEkle(L, C.isci1, [K.kerem], { placeId: YER_A }))
  L.apply(cihazEkle(L, C.isci2, [K.kerem], { placeId: YER_B }))
  const OL = b4a.alloc(16, 0x61)
  const okur = ['rol:sahip', 'yer:' + hex(YER_A) + '/rol:yonetici']
  const kol = (yazarlar, imz) => olay(L, T.COLLECTION, { collectionId: OL, name: 'Olaylar:A', kind: 'olaylar', readers: okur, writers: ['rol:sahip', ...yazarlar], sensitivity: 'normal', taskAccess: true, history: true, dropKey: b4a.alloc(32, 9) }, imz)
  L.apply(kol([], [K.kerem]))
  t.is(hataOf(() => L.check(kol(['device:' + hex(C.isci2.memberId)], [K.husniye]))), 'OUT_OF_SCOPE')
  t.is(hataOf(() => L.check(kol(['device:' + hex(C.isci1.memberId)], [K.husniye]))), null)
})
