// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D106: İstek 181 kararı — uzaktan katılımın taşıması (K1: 10 dk kod, iptal kilidi), çok onay (K2: 10 dk açık tören),
// etkinleştirme (K3), yeni gelenin ekranı (K4). Sahte DHT üstünde iki tören taşıyıcısı; süreler testte kısaltılır.
// Vektör protocol/vectors/remote-decision.json (karardan elle yazıldı).
'use strict'
const test = require('brittle')
const b4a = require('b4a')
const { identity: { createIdentity }, ledger: { Ledger, T, signEvent, encodeEvent, decodeEvent, createEvent }, joinHello: J, quorum: { REMOTE_WAIT_MS }, proposals: { UZAKTAN_ONAY_MS }, sync: S, caps: { CapsBook }, hello: { CAPS } } = require('@havenfold/core')
const T2 = require('..')
const SDK = require('../../../sdk')
const { SahteDht, SahteSoket, izle } = require('./helpers/fake-dht')
const V = require('../../../protocol/vectors/remote-decision.json')

const hx = (b) => b4a.toString(b, 'hex')
const bekle = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms))
async function kosul (f, ms = 10000) { const son = Date.now() + ms; while (!f()) { if (Date.now() > son) throw new Error('TIMEOUT'); await bekle(2) } }
const hataOf = async (p) => { try { await p; return null } catch (err) { return err.message } }
const hataOfS = (f) => { try { f(); return null } catch (err) { return err.message } }
const durum = (no) => V.durumlar.find((d) => d.no === no)
// D106 öncesi istemci: UZAKTAN_IPTAL'siz JOIN_HELLO bitleri
const ESKI_CAPS = CAPS.LEDGER_V21 | CAPS.KAYIT | CAPS.GOREV | CAPS.COKLU_UYGULAMA | CAPS.MISAFIR_YAZAR | CAPS.AILE_ADI

const kim = (ad) => createIdentity({ seed: 'uzaktan-karar/' + ad, platform: 'test' })
const KEREM = kim('kerem')
const HUSNIYE = kim('husniye')
const SAADET = kim('saadet')
const kopya = (L) => { const K = new Ledger({ now: L.now }); for (const e of L.events) K.apply(decodeEvent(encodeEvent(e))); return K }

// İki ebeveynli (Kerem, Hüsniye) ya da tek ebeveynli aile; uzaktan törenin iki ucu
function kur ({ iki = true, onayMs = 300, kodMs = undefined, yeniCaps = undefined } = {}) {
  const saat = { t: 1_800_000_000_000 }
  const now = () => saat.t
  const { ledger: L } = SDK.LedgerApi.createFamily({ Ledger, me: KEREM, familyName: 'Eser', displayName: 'Kerem', ts: saat.t - 1000 })
  L.now = now
  const kerem = new SDK.LedgerApi({ ledger: L, me: KEREM, now })
  if (iki) {
    const r = kerem.addMember({ deviceCert: HUSNIYE.deviceCert, displayName: 'Hüsniye', role: 'ebeveyn', ceremonyTranscriptHash: b4a.alloc(32, 7) })
    signEvent(r.event, HUSNIYE)
    L.apply(r.event)
  }
  const dht = new SahteDht()
  const gelen = { L: null }
  const ops = { beklemeMs: 20, uzaktanOnayMs: onayMs, uzaktanPayMs: 0, ...(kodMs ? { uzaktanKodMs: kodMs } : {}) }
  const aile = T2.dhtTorenTasiyici({ dht, deneysel: true, ...ops, cihaz: () => ({ kimlik: KEREM, ledger: L, defter: kerem, aileBagla: () => {}, now, ad: 'Kerem', cihazAdi: 'Pixel' }) })
  const yeni = T2.dhtTorenTasiyici({ dht, deneysel: true, ...ops, ...(yeniCaps !== undefined ? { caps: yeniCaps } : {}), cihaz: () => ({ kimlik: SAADET, ledger: null, defter: null, now, ad: 'Saadet', cihazAdi: 'iPhone', aileBagla: (x) => { gelen.L = x } }) })
  return { L, kerem, aile, yeni, gelen, saat, now }
}

// Saadet'in uzaktan ADD_MEMBER önerisi (kurulumdaki Hüsniye önerisi de listede kalır)
const { encoding: { decodeBody } } = require('@havenfold/core')
function saadetOnerisi (defter) {
  return [...defter.oneriler.items.values()].find((it) => it.event.type === T.ADD_MEMBER && b4a.equals(decodeBody(T.ADD_MEMBER, it.event.body).deviceCert.ukaPub, SAADET.deviceCert.ukaPub)) || null
}

async function uzaktanToren (x) {
  const oa = await x.aile.davet({ kind: J.TOREN.UYE, rol: 'yetiskin', uzaktan: true })
  const ka = izle(oa)
  const qr = await new Promise((resolve) => oa.on('qr', (q) => resolve(q.qr)))
  const kb = izle(await x.yeni.katil(qr))
  return { oa, ka, kb, qr }
}

test('vektör a: uzaktan kod 10 dakika yaşar, yenilenmez; sınırdan sonra QR_EXPIRY_EXPIRED; yüz yüze QR 180 sn içinde', async (t) => {
  const d = durum('a')
  const x = kur({ iki: false })
  const oa = await x.aile.davet({ kind: J.TOREN.UYE, rol: 'yetiskin', uzaktan: true })
  let qrSayisi = 0
  const qr = await new Promise((resolve) => oa.on('qr', (q) => { qrSayisi++; resolve(q.qr) }))
  const q = T2.qrCoz(qr)
  t.ok(q.exp * 1000 - x.now() >= V.sureler.uzaktanKodMs - 1000 && q.exp * 1000 - x.now() <= V.sureler.uzaktanKodMs + 1000, 'kodun ömrü 10 dakika')
  t.is(oa.ttlSec, V.sureler.uzaktanKodMs / 1000)
  x.saat.t += V.sureler.uzaktanKodMs + 1001
  t.is(await hataOf(x.yeni.katil(qr)), d.hata, d.aciklama)
  oa.cancel()
  const y = kur({ iki: false })
  const oy = await y.aile.davet({ kind: J.TOREN.UYE, rol: 'yetiskin' })
  const qy = T2.qrCoz(await new Promise((resolve) => oy.on('qr', (z) => resolve(z.qr))))
  t.ok(qy.exp * 1000 - y.now() <= V.sureler.yuzYuzeQrSn * 1000, 'yüz yüze QR en çok 180 sn')
  oy.cancel()
  t.is(qrSayisi, 1, 'uzaktan kod tek')
  await bekle(60)
})

test('vektör b: iki ebeveyn — öbür ebeveynin imzası 10 dakika içinde gelince üye bekleyen; gelmezse QUORUM_TIMEOUT, iz yok', async (t) => {
  const d = durum('b')
  // Gelir: Hüsniye öneriyi imzalar (LEDGER_SIGN yerine öneriye doğrudan)
  const x = kur({ onayMs: 5000 })
  const r = await uzaktanToren(x)
  await kosul(() => r.ka.onayBekleniyor || r.ka.kapandi)
  t.ok(r.ka.onayBekleniyor, 'tören açık, öbür imza bekleniyor')
  const yeniId = hx(SAADET.memberId)
  t.absent(x.L.members.has(yeniId))
  const oneri = saadetOnerisi(x.kerem)
  t.ok(oneri, 'uzaktan ekleme önerisi')
  const e = decodeEvent(encodeEvent(oneri.event))
  signEvent(e, HUSNIYE)
  const oneriId = x.kerem.oneriler.add(e, x.now())
  t.is(x.kerem.oneriler.tryApply(oneriId), 'applied')
  await kosul(() => (r.ka.tamam || r.ka.kapandi) && (r.kb.tamam || r.kb.kapandi))
  t.ok(r.ka.tamam && r.kb.tamam, 'tören tamamlandı')
  t.ok(x.L.isPending(yeniId), 'üye bekleyen (24 saat)')
  t.ok(x.gelen.L && x.gelen.L.members.has(yeniId), 'yeni gelen defteri aldı')
  await bekle(80)
  // Gelmez: süre dolar
  const y = kur({ onayMs: 200 })
  const s = await uzaktanToren(y)
  await kosul(() => s.ka.kapandi && (s.kb.kapandi || s.kb.tamam))
  t.is(s.ka.kapandi.neden, d.hata, d.aciklama)
  t.absent(y.L.members.has(yeniId), 'defterde iz yok')
  t.absent(saadetOnerisi(y.kerem), 'öneri yerelde düştü')
  t.absent(y.gelen.L)
  await bekle(80)
})

test('vektör c: beklemede ikinci ebeveyn tek imzayla iptal eder; yetenek kapısı; yeni gelende wipe', async (t) => {
  const x = kur({ iki: false })
  const r = await uzaktanToren(x)
  await kosul(() => (r.ka.tamam || r.ka.kapandi) && (r.kb.tamam || r.kb.kapandi))
  const yeniId = hx(SAADET.memberId)
  t.ok(x.L.isPending(yeniId))
  // İkinci ebeveyn sonradan (yüz yüze) eklenmiş olsun: bekleyen varken üye eklenebilir mi? Defter ekler; iptali o yazar
  const ek = x.kerem.addMember({ deviceCert: HUSNIYE.deviceCert, displayName: 'Hüsniye', role: 'ebeveyn', ceremonyTranscriptHash: b4a.alloc(32, 8) })
  signEvent(ek.event, HUSNIYE)
  x.L.apply(ek.event)
  const caps = new CapsBook()
  const hus = new SDK.LedgerApi({ ledger: x.L, me: HUSNIYE, now: x.now, capsBook: caps })
  const g = hataOfS(() => hus.revokeMember(yeniId))
  t.is(g, 'UPDATE_PENDING', 'Kerem UZAKTAN_IPTAL bildirmeden iptal yazılmaz (eski sürüm reddederdi)')
  caps.record(hx(KEREM.memberId), CAPS.UZAKTAN_IPTAL | CAPS.LEDGER_V21, x.now())
  const sonuc = hus.revokeMember(yeniId)
  t.is(sonuc.durum, 'uygulandi', 'tek ebeveyn imzası yeter')
  t.absent(x.L.members.get(yeniId).active)
  t.ok(x.L.members.get(yeniId).wipe, 'yeni gelende yerel aile silinir (K4)')
  t.absent(x.L.persons.has(yeniId), 'kişi sayılmaz')
  t.is(hataOfS(() => hus.revokeMember(yeniId)), 'NO_TARGET', 'ikinci kez yok')
  t.is(hataOfS(() => hus.revokeMember(hx(KEREM.memberId))), 'NO_TARGET', 'etkin üye iptal edilmez')
  // Yeni gelenin defteri REVOKE'u alır
  x.gelen.L.now = x.now
  S.ingest(x.gelen.L, { fromSeq: 0, events: x.L.events.map(encodeEvent) })
  t.ok(x.gelen.L.members.get(yeniId).revoked)
  await bekle(80)
})

test('vektör d: iki telefon aynı anda ACTIVATE_MEMBER yazar — çatal çözümünden sonra tek etkin üye; davet eden 1 saat önceliklidir', async (t) => {
  const x = kur({ iki: false })
  const r = await uzaktanToren(x)
  await kosul(() => (r.ka.tamam || r.ka.kapandi) && (r.kb.tamam || r.kb.kapandi))
  const yeniId = hx(SAADET.memberId)
  const ek = x.kerem.addMember({ deviceCert: HUSNIYE.deviceCert, displayName: 'Hüsniye', role: 'ebeveyn', ceremonyTranscriptHash: b4a.alloc(32, 9) })
  signEvent(ek.event, HUSNIYE)
  x.L.apply(ek.event)
  const LH = kopya(x.L)
  const hus = new SDK.LedgerApi({ ledger: LH, me: HUSNIYE, now: x.now })
  const hazir = x.L.readyAt(yeniId)
  x.saat.t = hazir + 1
  t.alike(x.kerem.remoteToActivate(), [yeniId], 'davet eden telefon kendiliğinden yazacak')
  t.alike(hus.remoteToActivate(), [], 'öbür ebeveyn kendiliğinden yazmaz')
  t.is(hataOfS(() => hus.activateMember(yeniId)), 'INVITE_ER_PENDING', 'öbür ebeveyn 1 saat bekler')
  x.saat.t = hazir + V.sureler.davetEdenOncelikMs + 1
  // İkisi aynı anda (aynı seq'te farklı olay)
  const a = x.kerem.activateMember(yeniId)
  x.saat.t += 1 // farklı an: imzasız özetler farklı, gerçek çatal (aynı anda yazılsa özet aynı olur, çatal hiç oluşmaz)
  const b = hus.activateMember(yeniId)
  t.is(a.durum, 'uygulandi')
  t.is(b.durum, 'uygulandi')
  t.not(hx(require('@havenfold/core').ledger.eventHash(a.event)), hx(require('@havenfold/core').ledger.eventHash(b.event)), 'çatal')
  // Karşılıklı eşitleme
  for (let i = 0; i < 3; i++) {
    S.ingest(x.L, { fromSeq: 0, events: LH.events.map(encodeEvent) })
    S.ingest(LH, { fromSeq: 0, events: x.L.events.map(encodeEvent) })
  }
  t.is(x.L.len, LH.len, 'aynı uzunluk')
  t.alike(x.L.head, LH.head, 'aynı baş')
  t.is(x.L.events.filter((e) => e.type === T.ACTIVATE_MEMBER).length, 1, 'tek ACTIVATE')
  t.ok(x.L.members.get(yeniId).active && !x.L.isPending(yeniId), 'tek etkin üye')
  t.ok(createEvent && REMOTE_WAIT_MS > 0)
  await bekle(80)
})

// Codex 10. tur: kapı cihaz değişimiyle bekleyen telefonu da sayar (defteri o da doğrular; eski sürümse REVOKE'u
// NO_TARGET ile reddeder ve eşitlemesi takılırdı). Öbür uzaktan bekleyen sorulmaz: biti uzaktan törende istenir ve
// oturumu olmadığı için başka yoldan görülmez; sorulsaydı iki uzaktan davet birbirinin iptalini kilitlerdi
test('yetenek kapısı: cihaz değişimiyle bekleyen telefon UZAKTAN_IPTAL bildirmeden iptal yazılmaz; öbür uzaktan bekleyen kilitlemez', async (t) => {
  const saat = { t: 1_800_000_000_000 }
  const now = () => saat.t
  const { ledger: L } = SDK.LedgerApi.createFamily({ Ledger, me: KEREM, familyName: 'Eser', displayName: 'Kerem', ts: saat.t - 1000 })
  L.now = now
  const caps = new CapsBook()
  const kerem = new SDK.LedgerApi({ ledger: L, me: KEREM, now, capsBook: caps })
  const IREM = kim('irem')
  const YENI_HUSNIYE = kim('yeni-husniye')
  const NUR = kim('nur')
  const ekle = (k, ad, role, remote = false) => {
    const r = kerem.addMember({ deviceCert: k.deviceCert, displayName: ad, role, ceremonyTranscriptHash: b4a.alloc(32, ad.length), remote })
    if (r.durum === 'uygulandi') return
    signEvent(r.event, k)
    if (L.members.get(hx(HUSNIYE.memberId))?.active && k !== HUSNIYE) signEvent(r.event, HUSNIYE)
    L.apply(r.event)
  }
  ekle(HUSNIYE, 'Hüsniye', 'ebeveyn')
  ekle(IREM, 'İrem', 'yetiskin')
  ekle(SAADET, 'Saadet', 'yetiskin', true)
  ekle(NUR, 'Nur', 'yetiskin', true)
  // Hüsniye cihaz değiştiriyor, eski telefonu imzalamadı: yeni kimlik 72 saat bekleyen ebeveyn (K16)
  const rot = createEvent(L, T.ROTATE_DEVICE, { oldMemberId: HUSNIYE.memberId, newDeviceCert: YENI_HUSNIYE.deviceCert, ceremonyTranscriptHash: b4a.alloc(32, 7), oldSigned: false }, now())
  for (const k of [YENI_HUSNIYE, KEREM, IREM]) signEvent(rot, k)
  L.apply(rot)
  const saadet = hx(SAADET.memberId)
  const nur = hx(NUR.memberId)
  const yeniHus = hx(YENI_HUSNIYE.memberId)
  t.ok(L.isPending(saadet) && L.isPending(nur) && L.isPending(yeniHus), 'iki uzaktan ve bir cihaz değişimi bekleyen')
  for (const k of [HUSNIYE, IREM]) caps.record(hx(k.memberId), CAPS.UZAKTAN_IPTAL | CAPS.LEDGER_V21, now())
  let err = null
  try { kerem.revokeMember(saadet) } catch (e) { err = e }
  t.is(err && err.message, 'UPDATE_PENDING', 'cihaz değişimiyle bekleyen bildirmedi')
  t.alike(err && err.eksik, [yeniHus], 'eksik: yalnız cihaz değişimiyle bekleyen (öbür uzaktan bekleyen ve hedef değil)')
  caps.record(yeniHus, CAPS.UZAKTAN_IPTAL | CAPS.LEDGER_V21, now())
  t.is(kerem.revokeMember(saadet).durum, 'uygulandi')
  t.is(kerem.revokeMember(nur).durum, 'uygulandi', 'öbür uzaktan davet de iptal edilebilir (kilit yok)')
})

// Codex 10. tur: uzaktan gelen beklerken bitini bildiremez; uzaktan katılım UZAKTAN_IPTAL'i törende ister
test('uzaktan tören: UZAKTAN_IPTAL bildirmeyen yeni gelen UPDATE_REQUIRED; yüz yüze törende aranmaz', async (t) => {
  const x = kur({ iki: false, yeniCaps: ESKI_CAPS })
  const r = await uzaktanToren(x)
  await kosul(() => r.ka.kapandi || r.ka.tamam)
  t.is(r.ka.kapandi && r.ka.kapandi.neden, 'UPDATE_REQUIRED', 'aile tarafı reddetti')
  t.absent(x.L.members.has(hx(SAADET.memberId)), 'defterde iz yok')
  await bekle(80)
  const y = kur({ iki: false, yeniCaps: ESKI_CAPS })
  const oa = await y.aile.davet({ kind: J.TOREN.UYE, rol: 'yetiskin' })
  const ka = izle(oa)
  const qr = await new Promise((resolve) => oa.on('qr', (q) => resolve(q.qr)))
  izle(await y.yeni.katil(qr))
  await kosul(() => ka.kapandi || ka.tamam)
  t.ok(ka.tamam, 'yüz yüze tören bit istemez')
  await bekle(80)
})

// Codex 10. tur: geçerli JOIN_SIG çerçevesinin tekrarı onay süresini yeniden başlatıyor, ilk yoklama zamanlayıcısı
// tören bitince de kalıyordu. Yeni gelenin soketi JOIN_SIG'i 300 ms sonra bir kez daha yazar
test('tekrarlanan JOIN_SIG: bekleme bir kez başlar, süre uzamaz, zamanlayıcı kalmaz', async (t) => {
  const yaz0 = SahteSoket.prototype.write
  const si = global.setInterval
  const ci = global.clearInterval
  const acik = new Set()
  SahteSoket.prototype.write = function (b) { yaz0.call(this, b); if (b[0] === 0x0b) setTimeout(() => yaz0.call(this, b), 300) }
  global.setInterval = (...a) => { const h = si(...a); acik.add(h); return h }
  global.clearInterval = (h) => { acik.delete(h); return ci(h) }
  try {
    const x = kur({ onayMs: 500 })
    const oa = await x.aile.davet({ kind: J.TOREN.UYE, rol: 'yetiskin', uzaktan: true })
    const ka = izle(oa)
    let sayi = 0
    let ilk = 0
    oa.on('onay-bekleniyor', () => { sayi++; if (!ilk) ilk = Date.now() })
    const qr = await new Promise((resolve) => oa.on('qr', (q) => resolve(q.qr)))
    izle(await x.yeni.katil(qr))
    await kosul(() => ka.kapandi)
    const sure = Date.now() - ilk
    t.is(ka.kapandi.neden, 'QUORUM_TIMEOUT')
    t.is(sayi, 1, 'bekleme bir kez başladı')
    t.ok(sure < 650, 'süre tekrarla uzamadı (' + sure + ' ms)')
    await bekle(120)
    t.is(acik.size, 0, 'yoklama zamanlayıcısı kalmadı')
  } finally {
    SahteSoket.prototype.write = yaz0
    global.setInterval = si
    global.clearInterval = ci
  }
  await bekle(80)
})

// Codex 10. tur: tören QUORUM_TIMEOUT ile kapandıktan sonra öbür ebeveyn sakladığı öneriyi imzalayınca üye
// ekleniyordu. Son tarih önerinin kendi zamanından; her telefon kabulde, imzada ve uygulamada ona bakar
test('çok onay son tarihi bütün telefonlarda: süresi dolan uzaktan ekleme imzalanmaz, kabul ve uygulanmaz', async (t) => {
  const x = kur({ onayMs: 200 })
  const LH = kopya(x.L)
  LH.now = x.now
  const hus = new SDK.LedgerApi({ ledger: LH, me: HUSNIYE, now: x.now })
  const r = await uzaktanToren(x)
  await kosul(() => r.ka.onayBekleniyor || r.ka.kapandi)
  const oneri = saadetOnerisi(x.kerem)
  t.ok(oneri, 'uzaktan ekleme önerisi')
  const yeniId = hx(SAADET.memberId)
  // Öneri olağan eşitlemeyle Hüsniye'ye gider ve orada saklanır; ikinci kopyada Hüsniye'nin imzası da var ama uygulanmadı
  const id = hus.oneriler.add(decodeEvent(encodeEvent(oneri.event)), x.now())
  t.ok(id, 'Hüsniye öneriyi sakladı')
  const LK = kopya(x.L)
  LK.now = x.now
  const kopyaHavuz = new (require('@havenfold/core').proposals.Proposals)(LK)
  const imzali = decodeEvent(encodeEvent(oneri.event))
  signEvent(imzali, HUSNIYE)
  t.is(kopyaHavuz.add(imzali, x.now()), id, 'imzalı kopya saklandı (uygulanmadan)')
  await kosul(() => r.ka.kapandi)
  t.is(r.ka.kapandi.neden, 'QUORUM_TIMEOUT', 'tören kapandı')
  x.saat.t = imzali.ts + UZAKTAN_ONAY_MS + 1
  t.is(hataOfS(() => hus.sign(id)), 'PROPOSAL_EXPIRED', 'öbür ebeveyn süresi dolan öneriyi imzalayamaz')
  t.absent(LH.members.has(yeniId), 'üye eklenmedi')
  t.absent(hus.oneriler.items.has(id), 'öneri düştü')
  t.is(hus.oneriler.add(imzali, x.now()), null, 'süresi dolan öneri (imzaları tam olsa da) kabul edilmez')
  t.is(kopyaHavuz.tryApply(id), 'stale', 'saklanan tam imzalı öneri uygulanmaz')
  t.absent(LK.members.has(yeniId))
  // Son tarihten önce aynı imza geçerliydi (karşılaştırma)
  const LS = kopya(x.L)
  LS.now = () => imzali.ts + UZAKTAN_ONAY_MS
  const sinir = new (require('@havenfold/core').proposals.Proposals)(LS)
  const sid = sinir.add(imzali, LS.now())
  t.is(sinir.tryApply(sid), 'applied', 'son tarihte uygulanır')
  // expire de süresi dolan uzaktan öneriyi temizler
  const LE = kopya(x.L)
  LE.now = x.now
  const temiz = new (require('@havenfold/core').proposals.Proposals)(LE)
  temiz.items.set(id, { event: decodeEvent(encodeEvent(oneri.event)), createdAt: imzali.ts })
  t.is(temiz.expire(x.now()), 1, 'expire süresi dolanı siler')
  await bekle(80)
})
