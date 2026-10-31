// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
const test = require('brittle')
const b4a = require('b4a')
const c = require('compact-encoding')
const { Ledger } = require('../ledger/ledger')
const { createHello, verifyHello, CAPS } = require('../protocol/hello')
const { CapsBook } = require('../protocol/caps')
const { joinHello, checkJoinCaps, TOREN, firstPayloadOf } = require('../protocol/join-hello')
const { Z, sessionAllowed, typeAllowed } = require('../protocol/envelope')
const { PairBook } = require('../core/pairs')
const { pairSecret, pairSubkeys } = require('../crypto/pair')
const { sealEnvelope, sealEnvelopeVektor, openEnvelope, sealCtrl, CTRL_TYPES, DIRECT_ONLY } = require('../messaging/seal')
const G = require('../protocol/guest-view')
const E = require('../protocol/retirement')
const { C, K, hex, misafirKaldir, anaAdimlar, seviye } = require('./helpers/v21')
const V21 = require('../../../protocol/vectors/ledger-v21-v2.json')
const PAIR = require('./vectors/yuva-hat/pair.json')

function anaDefter (n = Infinity) {
  const L = new Ledger()
  for (const f of anaAdimlar(L).slice(0, n)) L.apply(f())
  return L
}
const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const sock = { handshakeHash: b4a.alloc(32, 1) }
const DAY = 86_400_000

// --- Yetenek bitleri ve sürüm kapısı (§2.2, §10) ---------------------------------------------------------------

test('HELLO yetenek bitleri (RFC-0003 §10, RFC-0016 eki, RFC-0017 §4.4, RFC-0030 §8)', (t) => {
  t.alike(CAPS, { AUDIO: 1, VIDEO: 2, PTT_LIVE: 4, RELAY: 8, BOX: 16, LEDGER_V21: 32, KAYIT: 64, GOREV: 128, BAGLANTI: 256, AFET: 512, YZ: 1024, UYGULAMA: 2048, HIDE_PRESENCE: 4096, COKLU_UYGULAMA: 8192, MISAFIR_YAZAR: 16384, AILE_ADI: 32768, UZAKTAN_IPTAL: 65536 }) // AILE_ADI: RFC-0036 §4.2 (D97); UZAKTAN_IPTAL: D106
})

test('JOIN_HELLO: caps alanı; eski istemcinin gövdesinde yokluğu 0 sayılır; düzeyden sonra UPDATE_REQUIRED', (t) => {
  const m = { cert: C.isci1.deviceCert, name: 'İşçi', device: 'laptop', eph: b4a.alloc(32, 2), mac: b4a.alloc(32, 3), caps: CAPS.LEDGER_V21 | CAPS.GOREV }
  t.alike(c.decode(joinHello, c.encode(joinHello, m)), { ...m, familyName: null }) // familyName: RFC-0036 (D97)
  const eski = c.encode(joinHello, m).subarray(0, -1) // caps tek bayt; eski istemci hiç yazmaz
  t.is(c.decode(joinHello, eski).caps, 0)
  const L = anaDefter()
  t.is(hataOf(() => checkJoinCaps(L, 0)), 'UPDATE_REQUIRED')
  t.is(hataOf(() => checkJoinCaps(L, CAPS.LEDGER_V21)), null)
  t.is(hataOf(() => checkJoinCaps(anaDefter(6), 0)), null, 'düzey yokken eski istemci katılabilir')
  t.is(firstPayloadOf(TOREN.MISAFIR), 'GUEST_VIEW')
  t.is(firstPayloadOf(TOREN.CIHAZ), 'JOIN_LEDGER')
})

test('CapsBook: PROTOCOL_LEVEL yazma koşulu — 30 gün, bütün aktif üyeler ve kutu, bekleyen yok', (t) => {
  const L = anaDefter(6) // düzey yok
  const book = new CapsBook()
  const now = 100 * DAY
  const me = hex(K.kerem.memberId)
  for (const k of [K.husniye, K.irem, K.ecem]) book.record(hex(k.memberId), CAPS.LEDGER_V21, now - DAY)
  let r = book.levelReady(L, '2.1', { now, me })
  t.absent(r.ok)
  t.alike(r.missing, [hex(K.kutu.memberId)])
  book.record(hex(K.kutu.memberId), CAPS.LEDGER_V21 | CAPS.BOX, now - 31 * DAY)
  t.absent(book.levelReady(L, '2.1', { now, me }).ok, '30 günden eski görülme sayılmaz')
  book.record(hex(K.kutu.memberId), CAPS.BOX, now - 40 * DAY) // eski kayıt yenisini ezmez
  book.record(hex(K.kutu.memberId), CAPS.LEDGER_V21 | CAPS.BOX, now - 2 * DAY)
  r = book.levelReady(L, '2.1', { now, me })
  t.ok(r.ok)
  const kopya = new CapsBook()
  kopya.load(JSON.parse(JSON.stringify(book)))
  t.ok(kopya.levelReady(L, '2.1', { now, me }).ok)
  L.apply(seviye(L))
  t.is(L.level, '2.1')
})

// --- Oturum rolleri (§6.1) ------------------------------------------------------------------------------------------

test('HELLO: üye, cihaz ve misafir rolü; çıkarılan cihaz ve misafir oturuma giremez', (t) => {
  const L = anaDefter(19) // isci1, uc1, misafir1 aktif
  const v = (k) => verifyHello(createHello(k, sock, L), sock, L, hex(k.memberId))
  t.is(v(K.irem).role, 'uye')
  t.is(v(C.isci1).role, 'cihaz')
  t.is(v(C.misafir1).role, 'misafir')
  L.apply(anaAdimlar(L)[19]()) // uc1 kendi çıkışı
  L.apply(misafirKaldir(L, C.misafir1, [K.husniye]))
  t.is(v(C.uc1).code, 'NOT_MEMBER')
  t.is(v(C.misafir1).code, 'NOT_MEMBER')
})

test('oturum tablosu: misafire LEDGER_* yok, misafir ↔ cihaz oturumu yok', (t) => {
  t.ok(sessionAllowed('uye', 'uye'))
  t.ok(sessionAllowed('uye', 'cihaz'))
  t.ok(sessionAllowed('cihaz', 'cihaz'))
  t.ok(sessionAllowed('misafir', 'uye'))
  t.absent(sessionAllowed('misafir', 'cihaz'))
  t.absent(sessionAllowed('misafir', 'misafir'))
  t.absent(sessionAllowed(null, 'uye'))
  for (const tur of [Z.LEDGER_REQ, Z.LEDGER_EVENTS, Z.LEDGER_PROPOSE]) {
    t.absent(typeAllowed('uye', 'misafir', tur))
    t.absent(typeAllowed('misafir', 'uye', tur))
    t.ok(typeAllowed('uye', 'cihaz', tur))
  }
  t.ok(typeAllowed('uye', 'misafir', Z.GUEST_VIEW))
  t.ok(typeAllowed('uye', 'misafir', Z.REC_OPS))
  t.absent(typeAllowed('uye', 'misafir', Z.TASK))
  t.ok(typeAllowed('cihaz', 'uye', Z.TASK))
  t.ok(typeAllowed('cihaz', 'uye', Z.RETIRE_LIST))
  t.ok(typeAllowed('cihaz', 'cihaz', Z.TASK_DELEGATION))
  t.ok(typeAllowed('cihaz', 'cihaz', Z.BLOB_DATA))
  t.absent(typeAllowed('cihaz', 'cihaz', Z.LEDGER_EVENTS))
  t.absent(typeAllowed('cihaz', 'cihaz', Z.REC_OPS))
  t.ok(typeAllowed('uye', 'uye', 0x20))
  t.absent(typeAllowed('uye', 'cihaz', 0x20), 'cihaz mesajlaşmaz')
})

// --- Çift sırrı (§6.2) ---------------------------------------------------------------------------------------------

test('PairBook: üye ↔ cihaz iki taraftan aynı sır; cihaz ↔ cihaz; misafir ↔ cihaz yok', (t) => {
  const L = anaDefter(19)
  const kerem = new PairBook({ me: K.kerem, ledger: L })
  const isci = new PairBook({ me: C.isci1, ledger: L })
  const uc = new PairBook({ me: C.uc1, ledger: L })
  const misafir = new PairBook({ me: C.misafir1, ledger: L })
  const a = kerem.get(hex(C.isci1.memberId))
  const b = isci.get(hex(K.kerem.memberId))
  t.alike(a.pair, b.pair)
  t.is(a.session, 'cihaz')
  t.alike(a.sub.taskKey, b.sub.taskKey)
  t.alike(isci.get(hex(C.uc1.memberId)).pair, uc.get(hex(C.isci1.memberId)).pair)
  t.is(misafir.get(hex(C.isci1.memberId)), null)
  t.is(isci.get(hex(C.misafir1.memberId)), null)
  t.ok(misafir.get(hex(K.husniye.memberId)))
  t.is(kerem.peers().length, 7, '4 üye + 2 cihaz + 1 misafir')
})

test('vektörler: taskKey = derive(pair, "hf/task/")', (t) => {
  const g = PAIR.girdi
  const h = (s) => b4a.from(s, 'hex')
  const pair = pairSecret({ myUdaSecret: h(g.aSecret), theirUdaPub: h(g.bPub), myId: h(g.idA), theirId: h(g.idB), familyId: h(g.familyId), anchorHash: h(g.anchorHash), ceremonyKey: h(g.ceremonyKey) })
  t.is(hex(pairSubkeys(pair, h(g.idA), h(g.idB)).taskKey), V21.kripto.taskKey)
  t.is(hex(pairSubkeys(pair, h(g.idB), h(g.idA)).taskKey), V21.kripto.taskKey, 'yönsüz')
})

// --- Emanet mührü (§6.4) ---------------------------------------------------------------------------------------------

test('mühür: 0x80–0xFE ve K12 türleri; görev türlerinde hf/task/ anahtarı', (t) => {
  t.ok(CTRL_TYPES.has(0x80) && CTRL_TYPES.has(0xfe) && CTRL_TYPES.has(0x21))
  t.absent(CTRL_TYPES.has(0xff))
  t.absent(CTRL_TYPES.has(0x20), 'MSG ratchet ile korunur')
  const pair = b4a.alloc(32, 8)
  const a = b4a.alloc(16, 1)
  const b = b4a.alloc(16, 2)
  const id = b4a.alloc(16, 3)
  const body = b4a.from('gizli')
  for (const tur of [0x82, 0x94, 0x9c, 0xea]) t.alike(openEnvelope(pair, a, b, tur, sealEnvelope(pair, a, b, tur, body, id), id), body)
  const box = sealEnvelope(pair, a, b, 0x94, body, id)
  t.is(hataOf(() => openEnvelope(pair, a, b, 0x93, box, id)), 'UNSEALED_AUDIT', 'tür AD\'de')
  t.is(hataOf(() => openEnvelope(pair, b, a, 0x94, box, id)), 'UNSEALED_AUDIT', 'yön AD\'de')
  // Görev türü ctrl anahtarıyla açılmaz; diğerleri K12 ile aynı
  const nonce = b4a.alloc(24, 9)
  t.alike(sealEnvelopeVektor(pair, a, b, 0x82, body, id, nonce).subarray(0, 24), nonce)
  t.unlike(sealEnvelopeVektor(pair, a, b, 0x94, body, id, nonce), sealEnvelope(pair, a, b, 0x94, body, id), 'nonce verilmezse rastgele')
  t.alike(openEnvelope(pair, a, b, 0x21, sealCtrl(pair, a, b, 0x21, body, id), id), body, 'K12 biçimiyle aynı')
  for (const tur of DIRECT_ONLY) t.is(hataOf(() => sealEnvelope(pair, a, b, tur, body, id)), 'DIRECT_ONLY')
  t.is(hataOf(() => sealEnvelope(pair, a, b, 0x20, body, id)), 'NO_SEAL_TYPE')
})

test('vektörler: mühür', (t) => {
  const g = PAIR.girdi
  const h = (s) => b4a.from(s, 'hex')
  const pair = pairSecret({ myUdaSecret: h(g.aSecret), theirUdaPub: h(g.bPub), myId: h(g.idA), theirId: h(g.idB), familyId: h(g.familyId), anchorHash: h(g.anchorHash), ceremonyKey: h(g.ceremonyKey) })
  const m = V21.kripto.muhur
  for (const d of m.durumlar) {
    t.is(hex(sealEnvelopeVektor(pair, h(g.idA), h(g.idB), d.tur, h(m.govde), h(m.zarfId), h(m.nonce))), d.muhurlu)
    t.is(hex(openEnvelope(pair, h(g.idA), h(g.idB), d.tur, h(d.muhurlu), h(m.zarfId))), m.govde)
  }
})

// --- Misafir görünümü (§7) -------------------------------------------------------------------------------------------

test('GUEST_VIEW: misafir kabul eder; yalnız GRANT\'ı imzalayan ebeveyn; ledgerLen yalnız artar', (t) => {
  const L = anaDefter(17)
  const mid = hex(C.misafir1.memberId)
  const v1 = G.buildGuestView(L, mid, K.kerem)
  const kabul = G.acceptGuestView(null, v1, C.misafir1.memberId)
  t.is(kabul.ledgerLen, 17)
  t.ok(kabul.collections.has(hex(require('./helpers/v21').K_BAKICI)))
  t.ok(kabul.peers.has(hex(K.husniye.memberId)), 'bakıcı koleksiyonunun okuyucusu')
  t.absent(kabul.peers.has(hex(K.irem.memberId)), 'misafirin koleksiyonunda olmayan üye yok')
  t.is(hataOf(() => G.buildGuestView(L, mid, K.husniye)), 'NOT_SIGNER')
  t.is(hataOf(() => G.acceptGuestView(null, v1, C.misafir2.memberId)), 'INVALID_VIEW', 'başkasının GRANT\'ı')
  const bozuk = b4a.from(v1)
  bozuk[bozuk.byteLength - 1] ^= 1
  t.is(hataOf(() => G.acceptGuestView(null, bozuk, C.misafir1.memberId)), 'INVALID_SIGNATURE')

  L.apply(anaAdimlar(L)[17]())
  const v2 = G.buildGuestView(L, mid, K.kerem)
  const kabul2 = G.acceptGuestView(kabul, v2, C.misafir1.memberId)
  t.is(kabul2.ledgerLen, 18)
  t.is(hataOf(() => G.acceptGuestView(kabul2, v1, C.misafir1.memberId)), 'VIEW_STALE')

  // Misafirin çift sırrı, ebeveynin tam defterle türettiğiyle aynı
  const misafirPairs = new PairBook({ me: C.misafir1, ledger: G.guestLedger(kabul2) })
  const keremPairs = new PairBook({ me: K.kerem, ledger: L })
  t.alike(misafirPairs.get(hex(K.kerem.memberId)).pair, keremPairs.get(mid).pair)
})

test('GUEST_REVOKED: içindeki REVOKE görünümdeki ebeveynin imzasıyla doğrulanır', (t) => {
  const L = anaDefter(17)
  const mid = hex(C.misafir1.memberId)
  const view = G.acceptGuestView(null, G.buildGuestView(L, mid, K.kerem), C.misafir1.memberId)
  const rev = misafirKaldir(L, C.misafir1, [K.husniye])
  t.alike(G.verifyGuestRevoked(view, G.encodeGuestRevoked(L.familyId, C.misafir1.memberId, rev, K.husniye)).grantId, C.misafir1.memberId)
  const sahte = misafirKaldir(L, C.misafir1, [K.irem]) // İrem misafirin görünümünde ebeveyn değil
  t.is(hataOf(() => G.verifyGuestRevoked(view, G.encodeGuestRevoked(L.familyId, C.misafir1.memberId, sahte, K.husniye))), 'INVALID_SIGNATURE')
  t.is(hataOf(() => G.verifyGuestRevoked(view, G.encodeGuestRevoked(L.familyId, C.misafir1.memberId, rev, K.irem))), 'NOT_SIGNER')
})

test('vektörler: GUEST_VIEW', (t) => {
  const v = V21.kripto.misafirGorunumu
  const L = new Ledger()
  for (const o of V21.zincirler.ana.slice(0, v.onek)) L.apply(require('../ledger/ledger').decodeEvent(b4a.from(o.olay, 'hex')))
  t.is(hex(G.buildGuestView(L, v.misafir, K.kerem)), v.gorunum)
  t.ok(G.acceptGuestView(null, b4a.from(v.gorunum, 'hex'), b4a.from(v.misafir, 'hex')))
})

// --- Emeklilik ve silme raporu (§8) ---------------------------------------------------------------------------------

test('base45: RFC 9285 örnekleri', (t) => {
  for (const [ham, kod] of [['AB', 'BB8'], ['Hello!!', '%69 VD92EX0'], ['base-45', 'UJCLQE7W581'], ['ietf!', 'QED8WEX0']]) {
    t.is(E.base45Encode(b4a.from(ham)), kod)
    t.is(b4a.toString(E.base45Decode(kod)), ham)
  }
  t.is(hataOf(() => E.base45Decode('GGW')), 'INVALID_BASE45', '65535 üstü')
  t.is(hataOf(() => E.base45Decode('A')), 'INVALID_BASE45')
  t.is(hataOf(() => E.base45Decode('ab')), 'INVALID_BASE45')
})

test('RETIRE_BEGIN ve RETIRE_LIST gidiş dönüş', (t) => {
  const b = { deviceId: C.isci1.memberId }
  t.alike(c.decode(E.retireBegin, c.encode(E.retireBegin, b)), b)
  const l = { holds: [K.irem.memberId], blobs: [b4a.alloc(32, 1)], shares: [] }
  t.alike(c.decode(E.retireList, c.encode(E.retireList, l)), l)
})

test('silme raporu: imza, anahtar QR\'ı, parçalar, özet', (t) => {
  const sodium = require('sodium-native')
  const kp = { publicKey: b4a.alloc(32), secretKey: b4a.alloc(64) }
  sodium.crypto_sign_keypair(kp.publicKey, kp.secretKey)
  const r = (n) => E.signWipeReport({ deviceId: C.isci1.memberId, serial: 's', model: 'm', diskModel: 'd' + n, diskSerial: 'x' + n, method: 'overwrite-verify', tool: 'havenfold-sil', toolVersion: '1', driveStatus: '', startedAt: 1, finishedAt: 2, result: n === 3 ? 'hata' : 'ok' }, kp)
  const raporlar = [r(1), r(2), r(3)]
  const qr = E.encodeKeyQr({ hostId: b4a.alloc(16), ids: [C.isci1.memberId], retireNonce: b4a.alloc(16), reportPub: kp.publicKey, disks: 3, toolVersion: '1' })
  t.ok(/^HFK1:[0-9A-Z $%*+\-./:]+$/.test(qr), 'QR alfanümerik kipine sığar')
  for (const boy of [E.CHUNK_QR, E.CHUNK_KONSOL]) {
    const parcalar = E.encodeReportChunks(raporlar, boy)
    t.ok(parcalar.every((p) => /^HFW1:[0-9]+\/[0-9]+:[0-9A-Z $%*+\-./:]*$/.test(p)))
    const sonuc = E.verifyWipe(qr, [...parcalar].reverse())
    t.is(sonuc.reports.length, 3)
    t.ok(sonuc.anyError)
    t.alike(sonuc.wipeReportHash, E.wipeReportHash(raporlar))
    t.is(hataOf(() => E.verifyWipe(qr, parcalar.slice(1))), 'CHUNK_MISSING')
  }
  t.is(hataOf(() => E.signWipeReport({ deviceId: b4a.alloc(16), serial: '', model: '', diskModel: '', diskSerial: '', method: 'blkdiscard', tool: '', toolVersion: '', driveStatus: '', startedAt: 0, finishedAt: 0, result: 'ok' }, kp)), 'INVALID_BODY', 'blkdiscard sanitize sayılmaz')
  // Başka bir silme oturumunun raporu imzayı bozar
  const kp2 = { publicKey: b4a.alloc(32), secretKey: b4a.alloc(64) }
  sodium.crypto_sign_keypair(kp2.publicKey, kp2.secretKey)
  const yabanci = E.signWipeReport({ deviceId: C.isci1.memberId, serial: 's', model: 'm', diskModel: 'd', diskSerial: 'x', method: 'ata-sanitize', tool: 't', toolVersion: '1', driveStatus: '', startedAt: 1, finishedAt: 2, result: 'ok' }, kp2)
  t.is(hataOf(() => E.verifyWipe(qr, E.encodeReportChunks([r(1), r(2), yabanci]))), 'REPORT_KEY_MISMATCH')
  t.is(hataOf(() => E.verifyWipe(qr, E.encodeReportChunks([r(1), r(2)]))), 'REPORT_COUNT_MISMATCH')
  // Tek disk: özet rapor kimliğidir
  t.alike(E.wipeReportHash([raporlar[0]]), E.wipeReportId(raporlar[0]))
})

test('vektörler: silme raporu', (t) => {
  const s = V21.kripto.silme
  const raporlar = s.raporlar.map((x) => b4a.from(x, 'hex'))
  for (const r of raporlar) t.ok(E.verifyWipeReport(r, b4a.from(s.raporPub, 'hex')))
  t.alike(raporlar.map((r) => hex(E.wipeReportId(r))), s.raporKimlikleri)
  t.is(hex(E.wipeReportHash([raporlar[0]])), s.tekDiskOzeti)
  t.is(hex(E.wipeReportHash(raporlar)), s.kumeOzeti)
  const sonuc = E.verifyWipe(s.anahtarQr, s.parcalar128)
  t.is(hex(sonuc.wipeReportHash), s.kumeOzeti)
  t.is(hex(sonuc.key.ids[0]), hex(C.isci1.memberId))
  t.alike(E.encodeReportChunks(raporlar, E.CHUNK_KONSOL), s.parcalar128)
})
