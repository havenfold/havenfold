// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D64: protokol modüllerinin ret dalları (hello, messages, caps, ekip-cikis, emeklilik, yerel-kanal).
// Her test bir reddi ya da sınır davranışını beklenen hata koduyla doğrular. Beklenen değerler elle yazılmıştır.
const test = require('brittle')
const b4a = require('b4a')
const c = require('compact-encoding')
const sodium = require('sodium-native')
const { Ledger, T, createEvent, signEvent, encodeEvent, decodeEvent, prekeyBody } = require('../ledger/ledger')
const { encodeEvents } = require('../ledger/sync')
const { pairSecret } = require('../crypto/pair')
const { sealEnvelope } = require('../messaging/seal')
const { createHello, verifyHello } = require('../protocol/hello')
const M = require('../protocol/messages')
const { CapsBook } = require('../protocol/caps')
const EC = require('../protocol/team-exit')
const E = require('../protocol/retirement')
const Y = require('../protocol/local-channel')
const D = require('./helpers/ledger')
const EK = require('./helpers/team-install')
const { C0, E: EKS } = require('../../records/test/helpers/multi-vector')

const { K, C, hex, olay, ekle, TS0, hataOf, id, DAY, YER_A, ata, ekip, kopya } = EK
const sock = { handshakeHash: b4a.alloc(64, 1) }

// --- hello.js ---------------------------------------------------------------------------------------------------

test('HELLO: her ret kodu (SURUM, FAMILY_MISMATCH, MIXED_IDENTITY, CERTIFICATE_MISMATCH, CERTIFICATE_INTERNAL_INCONSISTENT, IMZA)', (t) => {
  const L = D.tamAile()
  const irem = hex(K.irem.memberId)
  const h = () => createHello(K.irem, sock, L)
  t.ok(verifyHello(h(), sock, L, irem).ok, 'geçerli HELLO')
  t.is(verifyHello({ ...h(), v: 1 }, sock, L, irem).code, 'VERSION')
  t.is(verifyHello({ ...h(), familyId: b4a.alloc(32, 9) }, sock, L, irem).code, 'FAMILY_MISMATCH')
  t.is(verifyHello(h(), sock, L, hex(K.ecem.memberId)).code, 'MIXED_IDENTITY', 'buluşma anahtarı başka üyenin')
  t.is(verifyHello({ ...h(), deviceCert: K.ecem.deviceCert }, sock, L, irem).code, 'CERTIFICATE_MISMATCH', 'ÜKA defterdekinden farklı')
  t.is(verifyHello({ ...h(), deviceCert: { ...K.irem.deviceCert, udaPub: K.ecem.deviceCert.udaPub } }, sock, L, irem).code, 'CERTIFICATE_MISMATCH', 'ÜDA defterdekinden farklı')
  t.is(verifyHello({ ...h(), deviceCert: { ...K.irem.deviceCert, dbaSig: b4a.alloc(64, 1) } }, sock, L, irem).code, 'CERTIFICATE_INTERNAL_INCONSISTENT', 'dolu dbaSig spike\'ta kabul edilmez')
  t.is(verifyHello(h(), { handshakeHash: b4a.alloc(64, 2) }, L, irem).code, 'SIGNATURE_ERROR', 'başka Noise oturumunun HELLO\'su')
  t.is(verifyHello({ ...h(), ledgerLen: L.len + 1 }, sock, L, irem).code, 'SIGNATURE_ERROR', 'imzalı alan değişmiş')
})

test('HELLO: ÜDA\'sı kayıtlı olmayan varlıkta yalnız ÜKA ve imza denetlenir', (t) => {
  // Defter arayüzünü taklit eden en küçük nesne: kaydında udaPub alanı yok
  const L = D.tamAile()
  const kayit = { signPub: K.irem.deviceCert.ukaPub }
  const sahte = { familyId: L.familyId, head: L.head, len: L.len, sessionRole: () => 'uye', entity: () => kayit }
  const h = createHello(K.irem, sock, sahte)
  const r = verifyHello({ ...h, deviceCert: { ...K.irem.deviceCert, udaPub: b4a.alloc(32, 3) } }, sock, sahte, hex(K.irem.memberId))
  t.ok(r.ok)
  t.is(r.member, kayit)
})

// --- messages.js ------------------------------------------------------------------------------------------------

const helloGovde = (cert = K.irem.deviceCert) => ({
  v: 2, familyId: b4a.alloc(32, 1), memberId: K.irem.memberId, deviceCert: cert, ledgerLen: 3, ledgerHead: b4a.alloc(32, 2), caps: 5, sig: b4a.alloc(64, 4)
})

test('çerçeve: dolu dbaPub ve dbaSig taşınır; boşları boş bayt dizisi olarak döner', (t) => {
  const cert = { ...K.irem.deviceCert, dbaPub: b4a.alloc(65, 7), dbaSig: b4a.alloc(70, 8) }
  const m = M.decodeFrame(M.encodeFrame(M.TYPE.HELLO, helloGovde(cert)))
  t.is(m.type, M.TYPE.HELLO)
  t.alike(m.body.deviceCert.dbaPub, b4a.alloc(65, 7))
  t.alike(m.body.deviceCert.dbaSig, b4a.alloc(70, 8))
  const bos = M.decodeFrame(M.encodeFrame(M.TYPE.HELLO, helloGovde()))
  t.is(bos.body.deviceCert.dbaPub.byteLength, 0)
  t.is(bos.body.deviceCert.dbaSig.byteLength, 0)
  t.is(bos.body.caps, 5)
})

test('çerçeve: HELLO flags ≠ 0 reddedilir (BellReg spike\'ta yok)', (t) => {
  const buf = b4a.from(M.encodeFrame(M.TYPE.HELLO, helloGovde()))
  t.ok(M.decodeFrame(buf))
  buf[buf.byteLength - 65] = 1 // flags baytı, 64 baytlık imzadan hemen önce
  t.is(hataOf(() => M.decodeFrame(buf)), 'INVALID_MESSAGE')
})

test('çerçeve: bilinmeyen tür gövdesine bakılmadan yok sayılır; kısa çerçeve reddedilir', (t) => {
  const m = M.decodeFrame(b4a.from([99, 0xff, 0xff, 0xff]))
  t.is(m.type, 99)
  t.is(m.body, null)
  const ack = M.encodeFrame(M.TYPE.ACK, { id: b4a.alloc(16, 1) })
  t.is(hataOf(() => M.decodeFrame(ack.subarray(0, 10))), 'INVALID_MESSAGE', 'kesik ACK')
  t.is(hataOf(() => M.decodeFrame(b4a.alloc(0))), 'INVALID_MESSAGE', 'boş çerçeve')
})

// --- caps.js ----------------------------------------------------------------------------------------------------

test('CapsBook: bilinmeyen düzey INVALID_BODY; bozuk kayıt yüklenmez', (t) => {
  const book = new CapsBook()
  const L = D.tamAile()
  t.is(hataOf(() => book.levelReady(L, '9.9', { now: TS0 })), 'INVALID_BODY')
  book.load(null)
  book.load('metin')
  book.load({ ['ab'.repeat(16)]: { caps: 32, at: 1 }, kisa: { caps: 1, at: 1 }, ['cd'.repeat(16)]: { caps: 1.5, at: 1 } })
  t.alike(Object.keys(book.toJSON()), ['ab'.repeat(16)], 'yalnız geçerli kayıt')
})

// --- team-exit.js ----------------------------------------------------------------------------------------------

function ekipIrem () {
  const L = ekip()
  L.apply(ekle(L, K.irem, 'calisan', [K.kerem]))
  return L
}

test('EKIP_CIKIS: bozuk mesaj, başka aile, bozuk olay, yanlış tür ve sıra INVALID_MESSAGE', (t) => {
  const L = ekipIrem()
  const kop = kopya(L)
  const cikar = olay(L, T.REMOVE_MEMBER, { memberId: K.irem.memberId, reason: 'x', wipe: false }, [K.kerem])
  const ben = id(K.irem)
  t.is(hataOf(() => EC.cikisDenetle(kop, b4a.from([1, 2, 3]), ben)), 'INVALID_MESSAGE', 'çözülemeyen gövde')
  t.is(hataOf(() => EC.cikisDenetle(kop, c.encode(EC.cikis, { familyId: b4a.alloc(32, 9), seq: cikar.seq, event: encodeEvent(cikar) }), ben)), 'INVALID_MESSAGE', 'başka aile')
  t.is(hataOf(() => EC.cikisDenetle(kop, c.encode(EC.cikis, { familyId: L.familyId, seq: 0, event: b4a.from([1, 2, 3]) }), ben)), 'INVALID_MESSAGE', 'çözülemeyen olay')
  t.is(hataOf(() => EC.cikisDenetle(kop, EC.encodeCikis(L, ata(L, K.irem, [YER_A], [K.kerem])), ben)), 'INVALID_MESSAGE', 'REMOVE_MEMBER değil')
  t.is(hataOf(() => EC.cikisDenetle(kop, c.encode(EC.cikis, { familyId: L.familyId, seq: cikar.seq + 1, event: encodeEvent(cikar) }), ben)), 'INVALID_MESSAGE', 'zarftaki sıra olayınkinden farklı')
  t.is(EC.cikisDenetle(kop, EC.encodeCikis(L, cikar), ben).sil, true, 'geçerli')
})

test('EKIP_CIKIS: kopyada zaten uygulanmış olay — aynı özet silme der, farklı olay LEDGER_FORK', (t) => {
  const L = ekipIrem()
  const isKapsami = olay(L, T.REMOVE_MEMBER, { memberId: K.irem.memberId, reason: 'x', wipe: false }, [K.kerem])
  const tamKapsam = olay(L, T.REMOVE_MEMBER, { memberId: K.irem.memberId, reason: 'x', wipe: true }, [K.kerem])
  L.apply(tamKapsam)
  const kop = kopya(L)
  const r = EC.cikisDenetle(kop, EC.encodeCikis(L, tamKapsam), id(K.irem))
  t.alike([r.sil, r.kapsam], [true, EC.KAPSAM.TAM])
  t.is(hataOf(() => EC.cikisDenetle(kop, EC.encodeCikis(L, isKapsami), id(K.irem))), 'LEDGER_FORK', 'aynı sırada başka olay')
})

test('EKIP_CIKIS: eski kopya — 7 gün dolmadan bekle, sonra sahip imzasıyla yalnız iş kapsamı', (t) => {
  const L = ekipIrem()
  const kop = kopya(L)
  const e = { ...olay(L, T.REMOVE_MEMBER, { memberId: K.irem.memberId, reason: 'x', wipe: true }, []), seq: L.len + 3, prev: b4a.alloc(32, 9) }
  signEvent(e, K.kerem)
  const bytes = EC.encodeCikis(L, e)
  t.alike(EC.cikisDenetle(kop, bytes, id(K.irem), { simdi: TS0 + 6 * DAY, sonBaglanti: TS0 }), { bekle: true })
  const r = EC.cikisDenetle(kop, bytes, id(K.irem), { simdi: TS0 + 7 * DAY, sonBaglanti: TS0 })
  t.alike([r.sil, r.kapsam], [true, EC.KAPSAM.IS], 'wipe: true olsa da eski kopyada tam silme yok')
  // Kopyada tanınmayan imzacı
  const yabanci = { ...e, sigs: [] }
  signEvent(yabanci, K.u9)
  t.is(hataOf(() => EC.cikisDenetle(kop, EC.encodeCikis(L, yabanci), id(K.irem), { simdi: TS0 + 8 * DAY, sonBaglanti: TS0 })), 'INVALID_SIGNATURE')
})

test('EKIP_CIKIS_OK: bozuk baytlar, tanınmayan üye, aktif üyede sıfır olmayan özet', (t) => {
  const L = ekipIrem()
  const yaz = (kim, ek = {}) => EC.makbuzYaz(L.familyId, kim, { scope: EC.KAPSAM.IS, collections: 1, convs: 0, blobs: 0, finishedAt: TS0, ...ek })
  t.is(hataOf(() => EC.makbuzDenetle(L, 'metin')), 'INVALID_MESSAGE', 'bayt dizisi değil')
  t.is(hataOf(() => EC.makbuzDenetle(L, b4a.alloc(63))), 'INVALID_MESSAGE', 'imzadan kısa')
  t.is(hataOf(() => EC.makbuzDenetle(L, b4a.alloc(70))), 'INVALID_MESSAGE', 'çözülemeyen gövde')
  t.is(hataOf(() => EC.makbuzDenetle(L, yaz(K.irem, { scope: 3 }))), 'INVALID_MESSAGE', 'bilinmeyen kapsam')
  t.is(hataOf(() => EC.makbuzDenetle(L, EC.makbuzYaz(b4a.alloc(32, 9), K.irem, { scope: 1, collections: 0, convs: 0, blobs: 0, finishedAt: 0 }))), 'INVALID_MESSAGE', 'başka aile')
  t.is(hataOf(() => EC.makbuzDenetle(L, yaz(K.u9))), 'UNAUTHORIZED', 'defterde olmayan üye')
  t.is(hataOf(() => EC.makbuzDenetle(L, yaz(K.irem, { eventHash: b4a.alloc(32, 5) }))), 'INVALID_RECEIPT', 'ayrılmadan önce özet sıfır olmalı')
  const gorulen = new Set()
  t.is(EC.makbuzDenetle(L, yaz(K.irem), { simdi: TS0, gorulen }).scope, EC.KAPSAM.IS, 'LEAVE öncesi makbuz')
  t.is(gorulen.size, 1)
})

test('EKIP_CIKIS_OK: kendi isteğiyle ayrılan (LEAVE) üyeden yalnız sıfır özetli makbuz', (t) => {
  const L = ekipIrem()
  L.apply(olay(L, T.LEAVE, { memberId: K.irem.memberId }, [K.irem]))
  const yaz = (eventHash) => EC.makbuzYaz(L.familyId, K.irem, { eventHash, scope: EC.KAPSAM.IS, collections: 0, convs: 0, blobs: 0, finishedAt: TS0 })
  t.is(hataOf(() => EC.makbuzDenetle(L, yaz(L.hashAt(L.len - 1)), { simdi: TS0 })), 'INVALID_RECEIPT', 'LEAVE özetiyle ikinci makbuz yok')
  t.is(EC.makbuzDenetle(L, yaz(b4a.alloc(32)), { simdi: TS0 }).scope, EC.KAPSAM.IS)
})

// --- retirement.js -----------------------------------------------------------------------------------------------

function raporAnahtari () {
  const kp = { publicKey: b4a.alloc(32), secretKey: b4a.alloc(64) }
  sodium.crypto_sign_keypair(kp.publicKey, kp.secretKey)
  return kp
}
const RAPOR = { deviceId: C.isci1.memberId, serial: 's', model: 'm', diskModel: 'd', diskSerial: 'x', method: 'overwrite-verify', tool: 't', toolVersion: '1', driveStatus: '', startedAt: 1, finishedAt: 2, result: 'ok' }

test('base45: iki karakterlik son grup 255\'i aşarsa reddedilir', (t) => {
  t.is(hataOf(() => E.base45Decode('::')), 'INVALID_BASE45', '44 + 44·45 = 2024')
  t.alike(E.base45Decode(E.base45Encode(b4a.from([255]))), b4a.from([255]))
})

test('WIPE_REPORT: bilinmeyen yöntem ya da sonuç INVALID_REPORT, bozuk imza INVALID_SIGNATURE', (t) => {
  const kp = raporAnahtari()
  const ham = (ek) => c.encode(E.wipeReport, { ...RAPOR, reportPub: kp.publicKey, sig: b4a.alloc(64), ...ek })
  t.is(hataOf(() => E.verifyWipeReport(ham({ method: 'blkdiscard' }), kp.publicKey)), 'INVALID_REPORT')
  t.is(hataOf(() => E.verifyWipeReport(ham({ result: 'belki' }), kp.publicKey)), 'INVALID_REPORT')
  t.is(hataOf(() => E.verifyWipeReport(ham({ startedAt: 3 }), kp.publicKey)), 'INVALID_REPORT', 'bitiş başlangıçtan önce')
  const imzali = b4a.from(E.signWipeReport(RAPOR, kp))
  t.ok(E.verifyWipeReport(imzali, kp.publicKey))
  imzali[imzali.byteLength - 1] ^= 1
  t.is(hataOf(() => E.verifyWipeReport(imzali, kp.publicKey)), 'INVALID_SIGNATURE')
  t.is(hataOf(() => E.wipeReportHash([])), 'NO_REPORT')
})

test('HFK1: önek, bozuk gövde ve sürüm INVALID_QR', (t) => {
  const kp = raporAnahtari()
  const m = { hostId: b4a.alloc(16), ids: [C.isci1.memberId], retireNonce: b4a.alloc(16), reportPub: kp.publicKey, disks: 1, toolVersion: '1' }
  t.is(E.decodeKeyQr(E.encodeKeyQr(m)).disks, 1)
  t.is(hataOf(() => E.decodeKeyQr('HFK2:' + E.encodeKeyQr(m).slice(5))), 'INVALID_QR', 'önek')
  t.is(hataOf(() => E.decodeKeyQr('HFK1:00')), 'INVALID_QR', 'kesik gövde')
  t.is(hataOf(() => E.decodeKeyQr('HFK1:a')), 'INVALID_QR', 'base45 dışı karakter')
  t.is(hataOf(() => E.decodeKeyQr('HFK1:' + E.base45Encode(c.encode(E.wipeKeyQr, { ...m, v: 2 })))), 'INVALID_QR', 'sürüm 2')
})

test('HFW1: bozuk, çelişen, sınır dışı ve eksik parçalar', (t) => {
  const kp = raporAnahtari()
  const parcalar = E.encodeReportChunks([E.signWipeReport(RAPOR, kp)], 64)
  t.ok(parcalar.length > 1)
  t.is(E.joinReportChunks([...parcalar, parcalar[0]]).length, 1, 'aynı parça iki kez okunabilir')
  t.is(hataOf(() => E.joinReportChunks(['HFW1-1/1:00'])), 'INVALID_QR', 'biçim')
  t.is(hataOf(() => E.joinReportChunks([parcalar[0], 'HFW1:2/9:00'])), 'INVALID_QR', 'toplam çelişiyor')
  t.is(hataOf(() => E.joinReportChunks(['HFW1:0/1:00'])), 'INVALID_QR', 'sıra 0')
  t.is(hataOf(() => E.joinReportChunks(['HFW1:2/1:00'])), 'INVALID_QR', 'sıra toplamdan büyük')
  const n = parcalar.length
  t.is(hataOf(() => E.joinReportChunks([...parcalar, `HFW1:1/${n}:` + E.base45Encode(b4a.from([1, 2]))])), 'INVALID_QR', 'aynı sırada farklı veri')
  t.is(hataOf(() => E.joinReportChunks([])), 'CHUNK_MISSING')
  t.is(hataOf(() => E.joinReportChunks(['HFW1:1/1:' + E.base45Encode(b4a.from([5]))])), 'INVALID_QR', 'beş rapor der, hiç yok')
})

// --- local-channel.js ---------------------------------------------------------------------------------------------

const cokluDefter = () => {
  const L = new Ledger({ now: () => TS0 })
  for (const e of C0) L.apply(decodeEvent(encodeEvent(e)))
  return L
}
const yeniUygulama = (me = EKS.keremU3, appId = 'yuva-anilar') => new Y.PairNew({ me, appId, now: () => TS0, nonce: b4a.alloc(32, 0x12) })

// APP_PAIR_OK'u elle kurar; ek.govde APP_ATTACH gövdesini, ek.olay olay alanlarını değiştirir
function cevap (L, yeni, ek = {}) {
  const govde = {
    deviceCert: yeni.me.deviceCert, personId: K.kerem.memberId, appId: yeni.appId, sameDevice: true, replaces: null,
    ceremonyTranscriptHash: Y.transcriptOf(yeni.nonce, yeni.me.deviceCert, yeni.appId), ...ek.govde
  }
  const e = Object.assign(createEvent(L, ek.tur || T.APP_ATTACH, ek.tur ? ek.govde : govde, TS0 + 999), ek.olay)
  for (const k of ek.imzacilar || [K.kerem]) signEvent(e, k)
  return c.encode(Y.pairOk, { event: encodeEvent(e), ledger: encodeEvents({ fromSeq: 0, events: L.events.map(encodeEvent) }), nonce: yeni.nonce })
}

test('APP_PAIR_OK: istek yokken PAIRING_STATUS, bozuk gövde INVALID_MESSAGE', (t) => {
  const L = cokluDefter()
  const yeni = yeniUygulama()
  t.is(hataOf(() => yeni.accept(cevap(L, yeni))), 'PAIRING_STATUS', 'request() çağrılmadı')
  yeni.request()
  t.is(hataOf(() => yeni.accept(b4a.from([1, 2, 3]))), 'INVALID_MESSAGE')
  t.is(yeni.state, 'istek', 'bozuk cevap durumu bozmaz')
  t.is(yeni.accept(cevap(L, yeni)).event.type, T.APP_ATTACH, 'elle kurulan geçerli cevap')
  t.is(yeni.state, 'tamam')
})

test('APP_PAIR_OK: süre dolunca PAIRING_EXPIRED, başka nonce PAIRING_NONCE', (t) => {
  const L = cokluDefter()
  const saat = { v: TS0 }
  const yeni = new Y.PairNew({ me: EKS.keremU3, appId: 'yuva-anilar', now: () => saat.v, nonce: b4a.alloc(32, 0x12) })
  yeni.request()
  const baska = new Y.PairNew({ me: EKS.keremU3, appId: 'yuva-anilar', now: () => TS0, nonce: b4a.alloc(32, 0x13) })
  t.is(hataOf(() => yeni.accept(cevap(L, baska))), 'PAIRING_NONCE')
  saat.v = TS0 + Y.PAIR_TTL_MS + 1
  t.is(hataOf(() => yeni.accept(cevap(L, yeni))), 'PAIRING_EXPIRED')
  t.is(yeni.state, 'sona_erdi')
  t.is(hataOf(() => yeni.accept(cevap(L, yeni))), 'PAIRING_STATUS', 'süresi dolan eşleşme yeniden kullanılamaz')
})

test('APP_PAIR_OK: olay türü, sırası, öncesi, gövdesi ve imzası denetlenir (PAIRING_EVENT)', (t) => {
  const L = cokluDefter()
  const dene = (ek, yeni = yeniUygulama()) => { yeni.request(); return hataOf(() => yeni.accept(cevap(L, yeni, ek))) }
  t.is(dene({ tur: T.PREKEY, govde: prekeyBody(K.kerem, b4a.alloc(32, 3), TS0 + 7) }), 'PAIRING_EVENT', 'APP_ATTACH değil')
  t.is(dene({ olay: { seq: L.len + 1 } }), 'PAIRING_EVENT', 'sıra defter uzunluğu değil')
  t.is(dene({ olay: { prev: b4a.alloc(32, 9) } }), 'PAIRING_EVENT', 'önceki özet baş değil')
  t.is(dene({ govde: { deviceCert: EKS.keremU4.deviceCert } }), 'PAIRING_EVENT', 'başka uygulamanın sertifikası')
  t.is(dene({ govde: { appId: 'baska' } }), 'PAIRING_EVENT', 'başka uygulama adı')
  t.is(dene({ govde: { sameDevice: false } }), 'PAIRING_EVENT', 'aynı cihaz değil')
  t.is(dene({ govde: { ceremonyTranscriptHash: b4a.alloc(32, 7) } }), 'PAIRING_EVENT', 'transkript tutmuyor')
  t.is(dene({ imzacilar: [K.kerem, EKS.keremU3] }), 'PAIRING_EVENT', 'olayda yeni uygulamanın imzası zaten var')
})

test('APP_PAIR_REQ: iç tutarsız sertifika INVALID_CERTIFICATE', (t) => {
  const L = cokluDefter()
  const eski = new Y.PairOld({ me: K.kerem, ledger: L, now: () => TS0 })
  const req = c.encode(Y.pairReq, { deviceCert: { ...EKS.keremU3.deviceCert, dbaSig: b4a.alloc(64, 1) }, appId: 'yuva-anilar', nonce: b4a.alloc(32, 1) })
  t.is(hataOf(() => eski.answer(req, { approved: true })), 'INVALID_CERTIFICATE')
  const istek = yeniUygulama().request()
  t.is(hataOf(() => eski.answer(istek, { approved: false })), 'NO_APPROVAL', 'biyometri onayı yok')
  // Ek kimlik ve defterde olmayan kimlik eşleştiremez
  t.is(hataOf(() => new Y.PairOld({ me: EKS.keremDefter, ledger: L, now: () => TS0 }).answer(istek, { approved: true })), 'NOT_PRIMARY_IDENTITY', 'ek kimlik')
  t.is(hataOf(() => new Y.PairOld({ me: K.u9, ledger: L, now: () => TS0 }).answer(istek, { approved: true })), 'NOT_PRIMARY_IDENTITY', 'defterde yok')
})

test('APP_LOCAL_SYNC: grup dışı kimlik, bozuk iç gövde ve izinsiz iç tür reddedilir', (t) => {
  const L = cokluDefter()
  const yeni = yeniUygulama()
  const eski = new Y.PairOld({ me: K.kerem, ledger: L, now: () => TS0 })
  const { event } = yeni.accept(eski.answer(yeni.request(), { approved: true, ts: TS0 + 999 }))
  L.apply(event)
  const U3 = EKS.keremU3
  // Aynı grup: kimlik hem bayt dizisi hem onaltılı metin olarak verilebilir
  t.ok(Y.sameGroup(L, K.kerem.memberId, U3.memberId))
  t.ok(Y.sameGroup(L, hex(K.kerem.memberId), hex(U3.memberId)))
  t.absent(Y.sameGroup(L, hex(K.kerem.memberId), hex(K.husniye.memberId)), 'başka kişi')
  t.absent(Y.sameGroup(L, K.kerem.memberId, b4a.alloc(16, 0xee)), 'defterde yok')
  const pK = pairSecret({ myUdaSecret: K.kerem.uda.secretKey, theirUdaPub: U3.uda.publicKey, myId: K.kerem.memberId, theirId: U3.memberId, familyId: L.familyId, anchorHash: L.anchorFor(K.kerem.memberId, U3.memberId) })
  const pU = pairSecret({ myUdaSecret: U3.uda.secretKey, theirUdaPub: K.kerem.uda.publicKey, myId: U3.memberId, theirId: K.kerem.memberId, familyId: L.familyId, anchorHash: L.anchorFor(U3.memberId, K.kerem.memberId) })
  const zid = b4a.alloc(16, 0x21)
  const nonce = b4a.alloc(24, 0x31)
  t.is(hataOf(() => Y.sealLocalSyncVektor({ ledger: L, pair: pK, me: K.kerem, peerId: K.husniye.memberId, type: 0x11, body: b4a.alloc(1), id: zid, nonce })), 'OUT_OF_GROUP')
  const ac = (box) => hataOf(() => Y.openLocalSync({ ledger: L, pair: pU, me: U3, peerId: K.kerem.memberId, box, id: zid }))
  const iyi = Y.sealLocalSyncVektor({ ledger: L, pair: pK, me: K.kerem, peerId: U3.memberId, type: 0x11, body: b4a.from('defter'), id: zid, nonce })
  t.is(ac(iyi), null, 'geçerli zarf açılır')
  t.is(hataOf(() => Y.openLocalSync({ ledger: L, pair: pU, me: U3, peerId: K.husniye.memberId, box: iyi, id: zid })), 'OUT_OF_GROUP')
  t.is(ac(sealEnvelope(pK, K.kerem.memberId, U3.memberId, Y.Z.APP_LOCAL_SYNC, b4a.from([0x11]), zid)), 'INVALID_MESSAGE', 'kesik iç gövde')
  // Vektör mühürleyicisi iç türe bakmaz; açan taraf eşleşme türünü içte de reddeder
  t.is(ac(Y.sealLocalSyncVektor({ ledger: L, pair: pK, me: K.kerem, peerId: U3.memberId, type: Y.Z.APP_PAIR_OK, body: b4a.alloc(1), id: zid, nonce })), 'INVALID_MESSAGE', 'iç tür APP_PAIR_OK')
})
