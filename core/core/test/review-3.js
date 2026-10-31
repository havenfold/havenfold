// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D9: inceleme 3 bulguları (f71cddb sonrası, RFC-0020). Beklenen değerler elle yazılmıştır.
const test = require('brittle')
const b4a = require('b4a')
const { Ledger, T, decodeEvent, encodeEvent, signEvent } = require('../ledger/ledger')
const { decodeBody, encodeBody } = require('../ledger/encoding')
const { ingest, keepMineOf } = require('../ledger/sync')
const V = require('./helpers/v21')
const { C0, E } = require('../../records/test/helpers/multi-vector')
const GV = require('../protocol/guest-view')
const { readerSet } = require('../../records/permission')

const { K, C, hex, olay, ekle, koleksiyon, misafirEkle, anaAdimlar, seviye, tur, K_BAKICI, TS0 } = V
const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const id = (k) => hex(k.memberId)
const H = 3_600_000
const kopyaOlay = (e) => decodeEvent(encodeEvent(e))

function cokluDefter (now = () => TS0) {
  const L = new Ledger({ now })
  for (const e of C0) L.apply(kopyaOlay(e))
  return L
}
const primary = (L, kisi, yeni, imz, ek = {}) => olay(L, T.APP_PRIMARY, { personId: kisi.memberId, newPrimaryId: yeni.memberId, ...ek }, imz)
const rotate = (L, eski, yeni, imz, ek = {}) => olay(L, T.ROTATE_DEVICE, { oldMemberId: eski.memberId, newDeviceCert: yeni.deviceCert, ceremonyTranscriptHash: b4a.alloc(32, 7), ...ek }, imz)
const activate = (L, k, imz) => olay(L, T.ACTIVATE_MEMBER, { memberId: k.memberId }, imz)

test('S8 (RFC-0020 a): kip gövdede; imza eklemek kipi değiştiremez', (t) => {
  // APP_PRIMARY: bekleyen devre ebeveyn imzası eklenmiş kopya reddedilir
  const L1 = cokluDefter()
  const e = primary(L1, K.kerem, E.keremTablet, [E.keremTablet])
  t.alike([decodeBody(T.APP_PRIMARY, e.body).oldSigned, decodeBody(T.APP_PRIMARY, e.body).parentSigned], [false, false])
  const hizli = kopyaOlay(e)
  signEvent(hizli, K.husniye)
  t.is(hataOf(() => cokluDefter().apply(hizli)), 'MODE_MISMATCH')
  L1.apply(kopyaOlay(e))
  ingest(L1, { fromSeq: e.seq, events: [encodeEvent(hizli)] })
  t.is(L1.events[e.seq].sigs.length, 1, 'birleştirme imzayı eklemedi')
  t.ok(L1.member(E.keremTablet.memberId).pendingPrimary)
  // ROTATE_DEVICE: eski imzasız değişime eski kimliğin imzası eklenemez
  const R = cokluDefter()
  const r = rotate(R, K.kerem, K.yeniKerem, [K.yeniKerem, K.husniye, K.irem, K.ecem])
  t.is(decodeBody(T.ROTATE_DEVICE, r.body).oldSigned, false)
  const hirsiz = kopyaOlay(r)
  signEvent(hirsiz, K.kerem)
  t.is(hataOf(() => cokluDefter().apply(hirsiz)), 'MODE_MISMATCH')
  // Bayrak doğru ama imza yok
  t.is(hataOf(() => cokluDefter().apply(rotate(R, K.kerem, K.yeniKerem, [K.yeniKerem, K.husniye, K.irem, K.ecem], { oldSigned: true }))), 'MODE_MISMATCH')
  // v2.1+ ailede bayraksız ROTATE_DEVICE
  const govde = encodeBody(T.ROTATE_DEVICE, { oldMemberId: K.kerem.memberId, newDeviceCert: K.yeniKerem.deviceCert, ceremonyTranscriptHash: b4a.alloc(32, 7), oldSigned: null })
  const R2 = cokluDefter()
  const ham = olay(R2, T.ROTATE_DEVICE, { oldMemberId: K.kerem.memberId, newDeviceCert: K.yeniKerem.deviceCert, ceremonyTranscriptHash: b4a.alloc(32, 7), oldSigned: false }, [])
  ham.body = govde
  for (const k of [K.yeniKerem, K.kerem, K.husniye]) signEvent(ham, k)
  t.is(hataOf(() => R2.apply(ham)), 'MODE_MISMATCH')
  // Gövde sonu: bayrak 1 bayt; yoksa hiç bayt
  t.is(encodeBody(T.ROTATE_DEVICE, { ...decodeBody(T.ROTATE_DEVICE, r.body), oldSigned: null }).byteLength + 1, r.body.byteLength)
})

test('S1 (RFC-0020 b): bekleyen devir yazıldığı ana kimliğe bağlı; ana kimliğin cihaz değişimi devri düşürür', (t) => {
  // S1a: eski imzalı değişimden sonra tabletin ACTIVATE'i reddedilir
  const L = cokluDefter()
  L.apply(primary(L, K.kerem, E.keremTablet, [E.keremTablet]))
  L.apply(rotate(L, K.kerem, K.yeniKerem, [K.yeniKerem, K.kerem, K.husniye]))
  t.absent(L.member(E.keremTablet.memberId).pendingPrimary, 'devir düştü')
  t.is(hataOf(() => L.apply(activate(L, E.keremTablet, [E.keremTablet]))), 'SECONDARY_IDENTITY_CANNOT_VOTE', 'devir düştüğü için tablet imzalayamaz')
  t.is(L.persons.get(id(K.kerem)).primary, id(K.yeniKerem))
  // S1b: bekleyen devir varken açılan imzasız değişim de devri düşürür; gerçek sahip kurtarır
  const saat = { v: TS0 }
  const M = cokluDefter(() => saat.v)
  M.apply(primary(M, K.kerem, E.keremTablet, [E.keremTablet]))
  saat.v += H
  t.is(hataOf(() => M.apply(rotate(M, K.kerem, K.yeniKerem, [K.yeniKerem, K.husniye, K.irem, K.ecem]))), null)
  t.absent(M.member(E.keremTablet.memberId).pendingPrimary)
  saat.v = TS0 + 74 * H
  t.is(hataOf(() => M.apply(activate(M, E.keremTablet, [E.keremTablet]))), 'SECONDARY_IDENTITY_CANNOT_VOTE')
  t.is(hataOf(() => M.apply(activate(M, K.yeniKerem, [K.yeniKerem]))), null)
  t.is(M.persons.get(id(K.kerem)).primary, id(K.yeniKerem))
  // against yazıldığı andaki ana kimlik değilse ret
  const N = cokluDefter()
  t.is(hataOf(() => N.apply(primary(N, K.kerem, E.keremTablet, [E.keremTablet], { against: K.husniye.memberId }))), 'CHANGE_DROPPED')
})

test('S2 (RFC-0020 c): ACTIVATE güçlü değil; iki ebeveynli dal tek imzalı ACTIVATE dalını yener', (t) => {
  const saat = { v: TS0 }
  const L = cokluDefter(() => saat.v)
  L.apply(primary(L, K.kerem, E.keremTablet, [E.keremTablet]))
  const prefix = L.events.slice()
  saat.v = TS0 + 73 * H
  const kol = koleksiyon(L, [K.kerem, K.husniye], { collectionId: b4a.alloc(16, 0x5a), name: 'Yeni' })
  const theirsL = Ledger.fromEvents(prefix, { now: () => saat.v, acceptedAt: new Map(L.acceptedAt) })
  const act = activate(theirsL, E.keremTablet, [E.keremTablet])
  t.ok(keepMineOf([kol], [act], prefix))
  L.apply(kol)
  const r = ingest(L, { fromSeq: act.seq, events: [encodeEvent(act)] })
  t.absent(r.replaced)
  t.is(L.persons.get(id(K.kerem)).primary, id(K.kerem))
})

function anaDefter (n = Infinity) {
  const L = new Ledger({ now: () => TS0 })
  for (const f of anaAdimlar(L).slice(0, n)) L.apply(f())
  return L
}
const gorunum = (prev, L, imzaci, misafir = C.misafir1) => GV.acceptGuestView(prev, GV.buildGuestView(L, id(misafir), imzaci), misafir.memberId)

test('S4 (RFC-0020 d): başka ebeveynin tek başına verdiği halef kanıtına misafir inanmaz', (t) => {
  const L = anaDefter(17)
  const v1 = gorunum(null, L, K.kerem)
  // Hüsniye'nin özel kopyası: Kerem'in yerine u9 (Kerem'in imzası yok, kutu tanık değil)
  const H2 = anaDefter(17)
  H2.apply(rotate(H2, K.kerem, K.u9, [K.u9, K.husniye, K.irem]))
  H2.apply(activate(H2, K.u9, [K.husniye]))
  t.is(hataOf(() => gorunum(v1, H2, K.u9)), 'INVITE_EXPIRED')
  // Kerem'in gerçek görünümü kabul edilmeye devam eder
  L.apply(olay(L, T.PLACE, { placeId: b4a.alloc(16, 0x77), name: 'X', kind: 'ev', remove: false }, [K.kerem]))
  t.is(gorunum(v1, L, K.kerem).signerHex, id(K.kerem))
})

test('S5 (RFC-0020 d): meşru halef tanınır — eski imzalı değişim, APP_PRIMARY, kutu tanığı, iki adım', (t) => {
  // Eski imzalı ROTATE_DEVICE ve ardından ikinci bir eski imzalı değişim: misafir ara görünümü kaçırır
  const L = anaDefter(17)
  const v1 = gorunum(null, L, K.kerem)
  L.apply(rotate(L, K.kerem, K.yeniKerem, [K.yeniKerem, K.kerem, K.husniye]))
  L.apply(rotate(L, K.yeniKerem, K.u8, [K.u8, K.yeniKerem, K.husniye]))
  const v2 = gorunum(v1, L, K.u8)
  t.is(v2.signerHex, id(K.u8))
  t.is(GV.buildGuestView(L, id(C.misafir1), K.u8).length > 0, true)
  // APP_PRIMARY (eski imzalı) sonrası yeni ana kimlik
  const M = new Ledger({ now: () => TS0 })
  for (const e of C0) M.apply(kopyaOlay(e))
  M.apply(misafirEkle(M, C.misafir2, [K.kerem]))
  const w1 = gorunum(null, M, K.kerem, C.misafir2)
  M.apply(primary(M, K.kerem, E.keremDefter, [E.keremDefter, K.kerem]))
  t.is(gorunum(w1, M, E.keremDefter, C.misafir2).signerHex, id(E.keremDefter))
  // Tek ebeveynli ailede kutu tanıklı değişim
  const N = new Ledger({ now: () => TS0 })
  N.apply(V.genesis())
  N.apply(tur(N, 'aile'))
  N.apply(ekle(N, K.kutu, 'kutu', [K.kerem]))
  N.apply(seviye(N))
  N.apply(koleksiyon(N, [K.kerem], { collectionId: K_BAKICI, name: 'Bakıcı', kind: 'bakici', readers: ['rol:ebeveyn'], writers: ['rol:ebeveyn'], taskAccess: false, history: false }))
  N.apply(misafirEkle(N, C.misafir1, [K.kerem]))
  const u1 = gorunum(null, N, K.kerem)
  t.ok(u1.peers.get(id(K.kutu)), 'kutu görünümde')
  N.apply(rotate(N, K.kerem, K.yeniKerem, [K.yeniKerem, K.kutu]))
  N.apply(activate(N, K.yeniKerem, [K.yeniKerem]))
  t.is(gorunum(u1, N, K.yeniKerem).signerHex, id(K.yeniKerem))
  // Kanıt yok (eski telefon kayıp, kutu tanık değil): davet yenilenmeli
  const P = anaDefter(17)
  const p1 = gorunum(null, P, K.kerem)
  P.apply(rotate(P, K.kerem, K.yeniKerem, [K.yeniKerem, K.husniye, K.irem]))
  P.apply(activate(P, K.yeniKerem, [K.husniye]))
  t.is(hataOf(() => gorunum(p1, P, K.yeniKerem)), 'INVITE_EXPIRED')
})

test('S6 (RFC-0020 e): ebeveynlikten indirilenin misafirliği düşer; GUEST_REVOKED SET_ROLE taşır', (t) => {
  const L = anaDefter(17)
  const v1 = gorunum(null, L, K.kerem)
  const e = olay(L, T.SET_ROLE, { memberId: K.kerem.memberId, role: 'yetiskin' }, [K.kerem, K.husniye])
  L.apply(e)
  t.absent(L.grants.get(id(C.misafir1)).active)
  t.absent(readerSet(L, L.collections.get(hex(K_BAKICI))).has(id(C.misafir1)))
  const r = GV.verifyGuestRevoked(v1, GV.encodeGuestRevoked(L.familyId, C.misafir1.memberId, e, K.husniye))
  t.is(r.neden, 'ebeveynlik-dustu')
})

test('S3: kapatma yalnız readers ve writers değiştirir; kasa niteliği kalır', (t) => {
  const L = anaDefter(14)
  const X = b4a.alloc(16, 0x6b)
  L.apply(koleksiyon(L, [K.kerem, K.husniye], { collectionId: X, name: 'İrem kasa', readers: [V.uye(K.irem)], writers: [V.uye(K.irem)], sensitivity: 'kasa', taskAccess: false }))
  L.apply(olay(L, T.LEAVE, { memberId: K.irem.memberId }, [K.irem]))
  t.is(hataOf(() => L.apply(koleksiyon(L, [K.husniye], { collectionId: X, name: 'İrem kasa', readers: [], writers: [], sensitivity: 'normal', taskAccess: false }))), 'INVALID_CLOSE')
  t.is(hataOf(() => L.apply(koleksiyon(L, [K.husniye], { collectionId: X, name: 'Hüsniye', readers: [], writers: [], sensitivity: 'kasa', taskAccess: false }))), 'INVALID_CLOSE')
  t.is(hataOf(() => L.apply(koleksiyon(L, [K.husniye], { collectionId: X, name: 'İrem kasa', readers: [], writers: [], sensitivity: 'kasa', taskAccess: false }))), null)
  // Yeniden açmak kasa kuralına bağlı: bütün ebeveynler
  t.is(hataOf(() => L.apply(koleksiyon(L, [K.husniye], { collectionId: X, name: 'İrem kasa', readers: [V.uye(K.husniye)], writers: [V.uye(K.husniye)], sensitivity: 'kasa', taskAccess: false }))), 'NO_PARENT_APPROVAL')
})

test('S7: çerçeve, eşleşme isteği, silme kümesi ve JOIN_HELLO kanonik; gelen zarf oturum süzgecinden', (t) => {
  const M = require('../protocol/messages')
  const Y = require('../protocol/local-channel')
  const J = require('../protocol/join-hello')
  const { giris, zarf: { Z } } = require('..')
  const fr = M.encodeFrame(M.TYPE.ACK, { id: b4a.alloc(16, 1) })
  t.is(hataOf(() => M.decodeFrame(b4a.concat([fr, b4a.from([0xff])]))), 'INVALID_MESSAGE')
  t.ok(M.decodeFrame(fr))
  const L = cokluDefter()
  const req = new Y.PairNew({ me: E.keremU3, appId: 'yuva-x', now: () => TS0 }).request()
  const eski = new Y.PairOld({ me: K.kerem, ledger: L, now: () => TS0 })
  t.is(hataOf(() => eski.answer(b4a.concat([req, b4a.from([0])]), { approved: true })), 'INVALID_MESSAGE')
  // JOIN_HELLO: caps = 0 tek biçim (alan yok); açık 0 baytı reddedilir
  const jh = { cert: K.u5.deviceCert, name: 'a', device: 'b', eph: b4a.alloc(32, 1), mac: b4a.alloc(32, 2), caps: 0 }
  const b = require('compact-encoding').encode(J.joinHello, jh)
  t.is(J.decodeJoinHello(b).caps, 0)
  t.is(hataOf(() => J.decodeJoinHello(b4a.concat([b, b4a.from([0])]))), 'INVALID_MESSAGE')
  t.is(J.decodeJoinHello(require('compact-encoding').encode(J.joinHello, { ...jh, caps: 3 })).caps, 3)
  // Tek giriş noktası: izinsiz tür ve bozuk gövde
  t.is(hataOf(() => giris.gelenZarf({ myRole: 'uye', peerRole: 'misafir', type: Z.REC_OPS, bytes: b4a.alloc(0), yol: 'dogrudan' })), 'TYPE_NOT_ALLOWED')
  t.is(hataOf(() => giris.gelenZarf({ myRole: 'uye', peerRole: 'cihaz', type: Z.RETIRE_LIST, bytes: b4a.from([1, 2, 3]), yol: 'dogrudan' })), 'INVALID_MESSAGE')
})
