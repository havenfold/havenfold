// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
const test = require('brittle')
const b4a = require('b4a')
const { Ledger, T, decodeEvent, encodeEvent, eventHash, createEvent, signEvent } = require('../ledger/ledger')
const { DEFAULT_POLICY } = require('../ledger/policy')
const { forkWinner, makeReq, answerReq, ingest, encodeReq, decodeReq, encodeEvents, decodeEvents } = require('../ledger/sync')
const { createHello, verifyHello } = require('../protocol/hello')
const { K, TS0, olay, ekle, at, prekey, genesis, tamAile } = require('./helpers/ledger')
const { vektorler } = require('./helpers/ledger-vector')

const VALID = require('./vectors/yuva-hat/ledger-valid.json')
const INVALID = require('./vectors/yuva-hat/ledger-invalid.json')
const YUVA_HAT_KODLARI = require('./helpers/yuva-hat-codes')
const yuvaHatAdlariyla = (x) => JSON.parse(JSON.stringify(x).replace(/"hata":"([A-Z0-9_]+)"/g, (s, k) => '"hata":"' + (Object.keys(YUVA_HAT_KODLARI).find((t) => YUVA_HAT_KODLARI[t] === k) || k) + '"'))

const hex = (b) => b4a.toString(b, 'hex')
const DAY = 86_400_000
function hata (t, f, kod) {
  let got = null
  try { f() } catch (err) { got = err.message }
  t.is(got, kod, kod)
}

function kurucuVeEs () {
  const L = new Ledger()
  L.apply(genesis())
  L.apply(ekle(L, K.husniye, 'ebeveyn', [K.kerem]))
  return L
}

test('defter: GENESIS — kurucu ebeveyn, familyId, varsayılan politika', (t) => {
  const L = new Ledger()
  const h = L.apply(genesis())
  t.is(L.len, 1)
  t.alike(L.head, h)
  t.is(L.familyId.byteLength, 32)
  t.alike(L.policy, { ...DEFAULT_POLICY })
  const m = L.member(K.kerem.memberId)
  t.is(m.role, 'ebeveyn')
  t.is(m.name, 'Kerem')
  t.is(L.familyName, 'Eser')
})

test('defter: geçerli zincir — 4 üye + kutu, kutu n\'e girmez', (t) => {
  const L = tamAile()
  t.is(L.len, 6)
  t.is(L.phoneIds().length, 4)
  t.is(L.boxIds().length, 1)
  t.is(L.parentIds().length, 2)
})

test('defter: kodla-çöz gidiş dönüş aynı hash', (t) => {
  const L = tamAile()
  for (let i = 0; i < L.len; i++) {
    const e = decodeEvent(encodeEvent(L.events[i]))
    t.alike(eventHash(e), L.hashAt(i))
  }
  hata(t, () => decodeEvent(b4a.from('ff', 'hex')), 'CORRUPT_EVENT')
})

test('defter: kurucu olmadan GENESIS reddedilir', (t) => {
  const e = genesis()
  e.sigs = []
  signEvent(e, K.husniye)
  hata(t, () => new Ledger().apply(e), 'UNKNOWN_SIGNER')
  // kurucu + başkası da olmaz
  const e2 = genesis()
  e2.sigs.push({ memberId: K.husniye.memberId, sig: e2.sigs[0].sig })
  hata(t, () => new Ledger().apply(e2), 'UNKNOWN_SIGNER')
})

test('defter: yanlış prev / seq / sürüm', (t) => {
  const L = kurucuVeEs()
  const e = ekle(L, K.irem, 'yetiskin', [K.kerem, K.husniye])
  hata(t, () => L.apply({ ...e, prev: b4a.alloc(32) }), 'CHAIN_BROKEN')
  hata(t, () => L.apply({ ...e, seq: 7 }), 'ORDER_ERROR')
  hata(t, () => L.apply({ ...e, v: 1 }), 'VERSION_UNSUPPORTED')
  t.is(L.len, 2, 'reddedilen olay durumu değiştirmez')
  L.apply(e)
  t.is(L.len, 3)
})

test('defter: değiştirilmiş gövde imzayı bozar', (t) => {
  const L = kurucuVeEs()
  const e = ekle(L, K.irem, 'yetiskin', [K.kerem, K.husniye])
  const kotu = { ...e, body: b4a.from(e.body) }
  kotu.body[kotu.body.length - 1] ^= 1
  t.exception(() => L.apply(kotu))
  t.is(L.len, 2)
})

test('defter: ADD yeter sayısı floor(n/2)+1 (n=1,2,3,4)', (t) => {
  // n=1: kurucu tek başına yeter
  const L = new Ledger()
  L.apply(genesis())
  L.apply(ekle(L, K.husniye, 'ebeveyn', [K.kerem]))
  // n=2: iki imza gerekir
  hata(t, () => L.apply(ekle(L, K.irem, 'yetiskin', [K.husniye])), 'NO_QUORUM')
  L.apply(ekle(L, K.irem, 'yetiskin', [K.kerem, K.husniye]))
  // n=3 (2 ebeveyn + yetişkin): 2 imza; yetişkin eklemede ebeveyn çoğunluğu (2/2)
  hata(t, () => L.apply(ekle(L, K.u5, 'yetiskin', [K.kerem, K.irem])), 'NO_PARENT_APPROVAL')
  L.apply(ekle(L, K.u5, 'yetiskin', [K.kerem, K.husniye]))
  // n=4: 3 imza
  hata(t, () => L.apply(ekle(L, K.u6, 'yetiskin', [K.kerem, K.husniye])), 'NO_QUORUM')
  L.apply(ekle(L, K.u6, 'yetiskin', [K.kerem, K.husniye, K.irem]))
  t.is(L.phoneIds().length, 5)
})

test('defter: çocuk imzası yeter sayıya sayılmaz', (t) => {
  const L = kurucuVeEs()
  L.apply(ekle(L, K.ecem, 'cocuk', [K.kerem, K.husniye]))
  L.apply(ekle(L, K.irem, 'cocuk', [K.kerem, K.husniye]))
  // oy verenler: 2 ebeveyn → çoğunluk 2; Kerem + iki çocuk yetmez
  hata(t, () => L.apply(ekle(L, K.u5, 'yetiskin', [K.kerem, K.ecem, K.irem])), 'NO_QUORUM')
  L.apply(ekle(L, K.u5, 'yetiskin', [K.kerem, K.husniye, K.ecem]))
})

test('defter: REMOVE yeter sayısı floor((n-1)/2)+1, hedef oy veremez', (t) => {
  const L = kurucuVeEs()
  L.apply(ekle(L, K.irem, 'yetiskin', [K.kerem, K.husniye]))
  L.apply(ekle(L, K.ecem, 'yetiskin', [K.kerem, K.husniye, K.irem]))
  // n=4, hedef İrem: kalan 3 → 2 imza; ayrıca ebeveyn çoğunluğu (2)
  hata(t, () => L.apply(at(L, K.irem, [K.kerem, K.irem])), 'TARGET_CANNOT_SELF_VOTE')
  hata(t, () => L.apply(at(L, K.irem, [K.kerem])), 'NO_QUORUM')
  L.apply(at(L, K.irem, [K.kerem, K.husniye]))
  t.is(L.member(K.irem.memberId).active, false)
  t.is(L.phoneIds().length, 3)
  // atılan üye artık imzalayamaz
  hata(t, () => L.apply(ekle(L, K.u5, 'yetiskin', [K.kerem, K.husniye, K.irem])), 'UNKNOWN_SIGNER')
})

test('defter: n=2 iki ebeveynde biri diğerini atabilir (1 imza)', (t) => {
  const L = kurucuVeEs()
  L.apply(at(L, K.husniye, [K.kerem]))
  t.is(L.phoneIds().length, 1)
})

test('defter: ebeveyn atma — diğer ebeveyn + yetişkin çoğunluğu', (t) => {
  const L = kurucuVeEs()
  L.apply(ekle(L, K.irem, 'yetiskin', [K.kerem, K.husniye]))
  L.apply(ekle(L, K.ecem, 'yetiskin', [K.kerem, K.husniye, K.irem]))
  hata(t, () => L.apply(at(L, K.husniye, [K.kerem])), 'NO_QUORUM')
  hata(t, () => L.apply(at(L, K.husniye, [K.kerem, K.irem])), 'NO_ADULT_APPROVAL')
  L.apply(at(L, K.husniye, [K.kerem, K.irem, K.ecem]))
})

test('defter: kutu — tek ebeveynle eklenir ve atılır, oy veremez, en fazla 1', (t) => {
  const L = kurucuVeEs()
  hata(t, () => L.apply(ekle(L, K.kutu, 'kutu', [])), 'NO_PARENT_SIGNATURE')
  L.apply(ekle(L, K.kutu, 'kutu', [K.husniye]))
  t.is(L.phoneIds().length, 2, 'kutu n\'e girmez')
  hata(t, () => L.apply(ekle(L, K.kutu2, 'kutu', [K.kerem])), 'BOX_LIMIT')
  hata(t, () => L.apply(ekle(L, K.irem, 'yetiskin', [K.kerem, K.husniye, K.kutu])), 'BOX_CANNOT_VOTE')
  hata(t, () => L.apply(prekey(L, K.kutu, TS0 + 5000)), 'BOX_CANNOT_VOTE')
  L.apply(at(L, K.kutu, [K.kerem]))
  t.is(L.boxIds().length, 0)
  L.apply(ekle(L, K.kutu2, 'kutu', [K.kerem]))
})

test('defter: kutu kendi LEAVE olayını imzalayabilir', (t) => {
  const L = kurucuVeEs()
  L.apply(ekle(L, K.kutu, 'kutu', [K.kerem]))
  L.apply(olay(L, T.LEAVE, { memberId: K.kutu.memberId }, [K.kutu]))
  t.is(L.boxIds().length, 0)
})

test('defter: 8 üye sınırı (kutu hariç)', (t) => {
  const L = new Ledger()
  L.apply(genesis())
  const sira = [K.husniye, K.irem, K.ecem, K.u5, K.u6, K.u7, K.u8]
  const imzacilar = [K.kerem]
  for (const k of sira) {
    const rol = k === K.husniye ? 'ebeveyn' : 'yetiskin'
    L.apply(ekle(L, k, rol, imzacilar.slice()))
    imzacilar.push(k)
  }
  t.is(L.phoneIds().length, 8)
  hata(t, () => L.apply(ekle(L, K.u9, 'yetiskin', imzacilar)), 'MEMBER_LIMIT')
  L.apply(ekle(L, K.kutu, 'kutu', [K.kerem]))
  t.is(L.activeIds().length, 9, 'kutu sınıra girmez')
})

test('defter: rol kuralları — 3. ebeveyn yok, çocuk eklemede bütün ebeveynler', (t) => {
  const L = kurucuVeEs()
  hata(t, () => L.apply(ekle(L, K.irem, 'ebeveyn', [K.kerem, K.husniye])), 'PARENT_LIMIT')
  L.apply(ekle(L, K.irem, 'yetiskin', [K.kerem, K.husniye]))
  hata(t, () => L.apply(ekle(L, K.ecem, 'cocuk', [K.kerem, K.irem])), 'NO_PARENT_APPROVAL')
  hata(t, () => L.apply(ekle(L, K.ecem, 'robot', [K.kerem, K.husniye])), 'INVALID_ROLE')
  L.apply(ekle(L, K.ecem, 'cocuk', [K.kerem, K.husniye]))
})

test('defter: SET_ROLE — bütün ebeveynler + rolü değişen', (t) => {
  const L = kurucuVeEs()
  L.apply(ekle(L, K.ecem, 'cocuk', [K.kerem, K.husniye]))
  hata(t, () => L.apply(olay(L, T.SET_ROLE, { memberId: K.ecem.memberId, role: 'yetiskin' }, [K.kerem, K.husniye])), 'NO_PARENT_APPROVAL')
  hata(t, () => L.apply(olay(L, T.SET_ROLE, { memberId: K.ecem.memberId, role: 'ebeveyn' }, [K.kerem, K.husniye, K.ecem])), 'PARENT_LIMIT')
  L.apply(olay(L, T.SET_ROLE, { memberId: K.ecem.memberId, role: 'yetiskin' }, [K.kerem, K.husniye, K.ecem]))
  t.is(L.member(K.ecem.memberId).role, 'yetiskin')
})

test('defter: LEAVE — yalnız kendisi; son ebeveyn ayrılamaz', (t) => {
  const L = new Ledger()
  L.apply(genesis())
  L.apply(ekle(L, K.irem, 'yetiskin', [K.kerem]))
  hata(t, () => L.apply(olay(L, T.LEAVE, { memberId: K.irem.memberId }, [K.kerem])), 'LEAVE_ERROR')
  hata(t, () => L.apply(olay(L, T.LEAVE, { memberId: K.kerem.memberId }, [K.kerem])), 'LAST_PARENT')
  L.apply(olay(L, T.LEAVE, { memberId: K.irem.memberId }, [K.irem]))
})

test('defter: POLICY — bütün ebeveynler, 8 sınırı', (t) => {
  const L = kurucuVeEs()
  const p = { ...DEFAULT_POLICY, defaultDisappearSec: 3600 }
  hata(t, () => L.apply(olay(L, T.POLICY, { policy: p }, [K.kerem])), 'NO_PARENT_APPROVAL')
  hata(t, () => L.apply(olay(L, T.POLICY, { policy: { ...p, maxMembers: 9 } }, [K.kerem, K.husniye])), 'INVALID_POLICY')
  hata(t, () => L.apply(olay(L, T.POLICY, { policy: { ...p, addQuorum: 'herkes' } }, [K.kerem, K.husniye])), 'INVALID_POLICY')
  L.apply(olay(L, T.POLICY, { policy: p }, [K.kerem, K.husniye]))
  t.is(L.policy.defaultDisappearSec, 3600)
})

test('defter: ROTATE_DEVICE — yeni cihaz + çoğunluk, rol ve ad korunur', (t) => {
  const L = kurucuVeEs()
  L.apply(ekle(L, K.irem, 'yetiskin', [K.kerem, K.husniye]))
  const body = { oldMemberId: K.irem.memberId, newDeviceCert: K.u5.deviceCert, ceremonyTranscriptHash: b4a.alloc(32, 7) }
  hata(t, () => L.apply(olay(L, T.ROTATE_DEVICE, body, [K.u5])), 'NO_QUORUM')
  hata(t, () => L.apply(olay(L, T.ROTATE_DEVICE, body, [K.kerem, K.husniye])), 'NO_NEW_MEMBER_APPROVAL')
  L.apply(olay(L, T.ROTATE_DEVICE, body, [K.u5, K.kerem, K.husniye]))
  t.is(L.member(K.irem.memberId).active, false)
  const yeni = L.member(K.u5.memberId)
  t.is(yeni.name, 'İrem')
  t.is(yeni.role, 'yetiskin')
})

test('defter: uzaktan katılım — 24 saat bekleme + bütün ebeveynler', (t) => {
  const L = kurucuVeEs()
  const ts = TS0 + 100_000
  const uzak = (imz, activatesAt) => {
    const e = createEvent(L, T.ADD_MEMBER, {
      deviceCert: K.irem.deviceCert, displayName: 'İrem', role: 'yetiskin', inviterId: K.kerem.memberId,
      ceremonyTranscriptHash: b4a.alloc(32, 7), remote: true, activatesAt
    }, ts)
    for (const k of [...imz, K.irem]) signEvent(e, k)
    return e
  }
  hata(t, () => L.apply(uzak([K.kerem, K.husniye], ts + DAY - 1)), 'REMOTE_WAITING')
  L.apply(uzak([K.kerem, K.husniye], ts + DAY))
  const m = L.member(K.irem.memberId)
  t.is(m.pendingRemote, true)
  t.is(m.activatesAt, ts + DAY)
})

test('defter: PREKEY (K5) — sahibi imzalar, son iki kabul, 21 gün ömür', (t) => {
  const L = kurucuVeEs()
  const t1 = TS0 + 1000
  const t2 = t1 + 7 * DAY
  const t3 = t2 + 7 * DAY
  L.apply(prekey(L, K.kerem, t1, 1))
  L.apply(prekey(L, K.kerem, t2, 2))
  L.apply(prekey(L, K.kerem, t3, 3))
  const ids = (now) => L.prekeysFor(K.kerem.memberId, now).map((p) => p.pub[0])
  t.alike(ids(t3), [3, 2], 'güncel + önceki')
  t.alike(ids(t2 + 21 * DAY), [3], 'öncekinin 21 günü doldu')
  t.alike(ids(t3 + 21 * DAY), [], '21 gün yeni ön anahtar yok → yeni sohbet yok')
  hata(t, () => L.apply(prekey(L, K.kerem, t2, 4)), 'PREKEY_STALE')
  // gövde imzası bozuk
  const e = prekey(L, K.husniye, t1, 5)
  const body = require('../ledger/encoding').decodeBody(T.PREKEY, e.body)
  body.prekeyId = b4a.alloc(8)
  const kotu = olay(L, T.PREKEY, body, [K.husniye])
  hata(t, () => L.apply(kotu), 'PREKEY_IDENTITY')
})

test('defter: çift imza ve bilinmeyen tür reddi', (t) => {
  const L = kurucuVeEs()
  const e = ekle(L, K.irem, 'yetiskin', [K.kerem, K.husniye])
  e.sigs.push(e.sigs[0])
  hata(t, () => L.apply(e), 'DUPLICATE_SIGNATURE')
  const e2 = ekle(L, K.irem, 'yetiskin', [K.kerem, K.husniye])
  e2.type = 99
  hata(t, () => L.apply(e2), 'UNKNOWN_EVENT')
})

test('defter: anchorFor — sonra katılanın ekleme olayı', (t) => {
  const L = tamAile()
  t.alike(L.anchorFor(K.kerem.memberId, K.husniye.memberId), L.hashAt(1))
  t.alike(L.anchorFor(K.ecem.memberId, K.husniye.memberId), L.hashAt(3))
  t.alike(L.anchorFor(K.husniye.memberId, K.ecem.memberId), L.hashAt(3))
})

test('defter: HELLO gerçek defterle çalışır', (t) => {
  const L = tamAile()
  const sock = { handshakeHash: b4a.alloc(64, 1) }
  const h = createHello(K.irem, sock, L)
  t.ok(verifyHello(h, sock, L, hex(K.irem.memberId)).ok)
  t.is(h.ledgerLen, L.len)
  L.apply(at(L, K.irem, [K.kerem, K.husniye]))
  t.is(verifyHello(createHello(K.irem, sock, L), sock, L, hex(K.irem.memberId)).code, 'NOT_MEMBER')
})

test('çatallanma: atma, eklemeye karşı kazanır', (t) => {
  const L = kurucuVeEs()
  L.apply(ekle(L, K.irem, 'yetiskin', [K.kerem, K.husniye]))
  const ekleme = ekle(L, K.ecem, 'yetiskin', [K.kerem, K.husniye, K.irem]) // 3 imzacı (+ yeni)
  const atma = at(L, K.irem, [K.kerem, K.husniye]) // 2 imzacı
  t.is(forkWinner(ekleme, atma), atma)
  t.is(forkWinner(atma, ekleme), atma)
})

test('çatallanma: PREKEY her zaman kaybeder', (t) => {
  const L = kurucuVeEs()
  const pk = prekey(L, K.kerem, TS0 + 5000)
  const pol = olay(L, T.POLICY, { policy: { ...DEFAULT_POLICY, defaultDisappearSec: 60 } }, [K.kerem, K.husniye])
  t.is(forkWinner(pk, pol), pol)
  t.is(forkWinner(pol, pk), pol)
  // atma ile PREKEY: atma
  const atma = at(L, K.husniye, [K.kerem])
  t.is(forkWinner(pk, atma), atma)
})

test('çatallanma: daha çok imzacı, sonra küçük hash', (t) => {
  const L = kurucuVeEs()
  const a = olay(L, T.POLICY, { policy: { ...DEFAULT_POLICY, defaultDisappearSec: 1 } }, [K.kerem, K.husniye])
  const b = olay(L, T.PLAN, { storeReceiptJws: 'x', product: 'aile', expiresAt: 1 }, [K.kerem])
  t.is(forkWinner(a, b), a)
  const c = olay(L, T.PLAN, { storeReceiptJws: 'y', product: 'aile', expiresAt: 1 }, [K.husniye])
  const kucuk = b4a.compare(eventHash(b), eventHash(c)) < 0 ? b : c
  t.is(forkWinner(b, c), kucuk)
  t.is(forkWinner(c, b), kucuk)
})

test('eşitleme: kısa taraf LEDGER_REQ ile yetişir', (t) => {
  const A = tamAile()
  const B = Ledger.fromEvents(A.events.slice(0, 2))
  t.is(makeReq(A, B.len, B.head), null, 'önde olan istemez')
  const req = decodeReq(encodeReq(makeReq(B, A.len, A.head)))
  t.is(req.fromSeq, 2)
  const cevap = decodeEvents(encodeEvents(answerReq(A, req)))
  const r = ingest(B, cevap)
  t.is(r.added, 4)
  t.alike(B.head, A.head)
  t.is(makeReq(B, A.len, A.head), null)
})

test('eşitleme: doğrulanamayan olay kabul edilmez, defter değişmez', (t) => {
  const A = tamAile()
  const B = Ledger.fromEvents(A.events.slice(0, 3))
  const cevap = answerReq(A, { fromSeq: 3 })
  const kotu = decodeEvent(cevap.events[1])
  kotu.sigs = kotu.sigs.slice(0, 1) // ecem eklemesinde imza eksik
  cevap.events[1] = encodeEvent(kotu)
  t.exception(() => ingest(B, cevap))
  t.is(B.len, 4, 'ilk geçerli olay işlendi, bozuk olan ve sonrası yok')
})

test('eşitleme: çatallanmada iki taraf aynı zincire varır, kaybeden olay döner', (t) => {
  const kok = kurucuVeEs()
  kok.apply(ekle(kok, K.irem, 'yetiskin', [K.kerem, K.husniye]))
  const A = Ledger.fromEvents(kok.events)
  const B = Ledger.fromEvents(kok.events)
  // A: Kerem PREKEY yayınlar; B: aynı anda İrem'i atar
  A.apply(prekey(A, K.kerem, TS0 + 9000))
  B.apply(at(B, K.irem, [K.kerem, K.husniye]))
  B.apply(prekey(B, K.husniye, TS0 + 9500))

  const rB = ingest(B, answerReq(A, makeReq(B, A.len, A.head)))
  t.is(rB.replaced, false, 'B kendi kolunu korur')
  t.is(rB.lost.length, 1)
  let rA = ingest(A, answerReq(B, makeReq(A, B.len, B.head)))
  t.is(rA.needFrom, 0, 'önek tutmadı, baştan istenir')
  rA = ingest(A, answerReq(B, { fromSeq: rA.needFrom }))
  t.is(rA.replaced, true)
  t.is(rA.dropped.length, 1)
  t.is(rA.dropped[0].type, T.PREKEY, 'sahibi yeniden yayınlar')
  t.is(makeReq(B, A.len, A.head), null)
  t.alike(A.head, B.head)
  t.is(A.member(K.irem.memberId).active, false)
})

test('eşitleme: önek uymazsa baştan istenir', (t) => {
  const kok = kurucuVeEs()
  const A = Ledger.fromEvents(kok.events)
  const B = Ledger.fromEvents(kok.events)
  A.apply(olay(A, T.PLAN, { storeReceiptJws: 'a', product: 'aile', expiresAt: 1 }, [K.kerem]))
  B.apply(olay(B, T.PLAN, { storeReceiptJws: 'b', product: 'aile', expiresAt: 1 }, [K.husniye]))
  B.apply(prekey(B, K.husniye, TS0 + 9500))
  // A kısa: B'den kendi uzunluğundan ister, önek tutmaz → needFrom 0
  const r = ingest(A, answerReq(B, makeReq(A, B.len, B.head)))
  t.is(r.needFrom, 0)
  const r2 = ingest(A, answerReq(B, { fromSeq: r.needFrom }))
  ingest(B, answerReq(A, { fromSeq: 0 }))
  t.alike(A.head, B.head)
  t.ok(r2.replaced || A.len === 3)
})

test('vektörler: ledger-valid.json zinciri uygulanır', (t) => {
  const L = new Ledger()
  for (const o of VALID.olaylar) {
    L.apply(decodeEvent(b4a.from(o.olay, 'hex')))
    t.is(hex(L.head), o.bas)
  }
  t.is(hex(L.familyId), VALID.familyId)
  t.is(hex(L.head), VALID.bas)
  for (const u of VALID.uyeler) {
    const m = L.member(u.memberId)
    t.is(m.role, u.rol)
    t.is(m.active, u.aktif)
  }
})

test('vektörler: ledger-invalid.json her durum beklenen hatayla reddedilir', (t) => {
  t.ok(INVALID.durumlar.length >= 20)
  for (const d of INVALID.durumlar) {
    const L = new Ledger()
    for (const o of VALID.olaylar.slice(0, d.onek)) L.apply(decodeEvent(b4a.from(o.olay, 'hex')))
    const head = hex(L.head)
    hata(t, () => L.apply(decodeEvent(b4a.from(d.olay, 'hex'))), YUVA_HAT_KODLARI[d.hata] || d.hata)
    t.is(hex(L.head), head, d.ad + ': durum değişmedi')
  }
})

test('vektörler: üretici aynı dosyaları verir (belirlenimci)', (t) => {
  const v = vektorler()
  t.alike(JSON.parse(JSON.stringify(v.gecerli)), VALID)
  t.alike(yuvaHatAdlariyla(v.gecersiz), INVALID)
})
