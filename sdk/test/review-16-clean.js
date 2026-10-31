// SPDX-License-Identifier: Apache-2.0
// D45 düşmanca inceleme: TEMİZ bulunan yollar (bugün yeşil olmalı) ve K6'nın denetim testi.
const KOK = __dirname + '/../..' // D49: kollar/D-inceleme-16-testler/temiz.js'den
const test = require(KOK + '/node_modules/brittle')
const b4a = require(KOK + '/node_modules/b4a')
const sodium = require(KOK + '/node_modules/sodium-native')
const { ledger: { Ledger, T, encodeEvent, decodeEvent, createEvent, signEvent, eventHash }, ekipCikis: EC } = require(KOK + '/node_modules/@havenfold/core')
const { Replika, sealDrop, appendRecordId } = require(KOK + '/node_modules/@havenfold/records/replica')
const { OP } = require(KOK + '/node_modules/@havenfold/records/encoding')
const { fromMs } = require(KOK + '/node_modules/@havenfold/records/hlc')
const S = require(KOK + '/sdk')
const D0 = require(KOK + '/core/core/test/helpers/ledger')
const V = require(KOK + '/core/core/test/helpers/v21')

const { K, TS0 } = D0
const hex = (b) => b4a.toString(b, 'hex')
const id = (k) => hex(k.memberId)
const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const GUN = 86_400_000
const YER = 'a1'.repeat(16)
const DEPO = 'b2'.repeat(16)
function saat (t0 = TS0 + 60_000) { let t = t0; const f = () => ++t; f.ileri = (ms) => { t += ms }; f.su = () => t; return f }
function ekip () {
  const now = saat()
  const { ledger: L } = S.TeamApi.create({ Ledger, me: K.kerem, isletmeAdi: 'Rivera Kuyum', displayName: 'Kerem', yer: { ad: 'Merkez', tur: 'sube' }, ts: TS0, placeId: YER })
  const kisi = (k, Lk = L) => { const defter = new S.LedgerApi({ ledger: Lk, me: k, now }); return { k, L: Lk, defter, ekip: new S.TeamApi({ defter, now }) } }
  return { L, now, kisi, kerem: kisi(K.kerem) }
}
function uyeEkle (x, yeni, role) {
  const r = x.defter.addMember({ deviceCert: yeni.deviceCert, displayName: yeni.ad, role, ceremonyTranscriptHash: b4a.alloc(32, 7) })
  if (r.durum === 'uygulandi') return r
  const y = new S.LedgerApi({ ledger: x.L, me: yeni, now: x.defter.now })
  y.oneriler = x.defter.oneriler
  return y.sign(r.oneriId)
}
const kopyala = (L, K2 = new Ledger()) => { for (const e of L.events.slice(K2.len)) K2.apply(decodeEvent(encodeEvent(e))); return K2 }
const uygulanmaz = (r) => (r === null || r === undefined || typeof r === 'string' || r.durum !== 'uygulandi')

test('T1: çalışan TeamApi\'nin hiçbir yazımını tek başına uygulayamaz (yalnız hata ya da öneri)', (t) => {
  const { L, kerem, kisi, now } = ekip()
  uyeEkle(kerem, K.ecem, 'calisan')
  uyeEkle(kerem, K.irem, 'calisan')
  uyeEkle(kerem, K.u5, 'gecici')
  const e = kisi(K.ecem).ekip
  const once = L.len
  const dene = (f) => { try { return f() } catch (err) { return err.message } }
  t.ok(uygulanmaz(dene(() => e.assign(id(K.ecem), [YER]))), 'ata')
  t.ok(uygulanmaz(dene(() => e.setTerm(id(K.u5), now.su() + GUN))), 'sure')
  t.ok(uygulanmaz(dene(() => e.role(id(K.ecem), 'yonetici'))), 'rol')
  t.ok(uygulanmaz(dene(() => e.role(id(K.ecem), 'sahip'))), 'rol sahip')
  t.ok(uygulanmaz(dene(() => e.privacyNotice({ placeId: YER, remove: true }))), 'aydinlatma')
  t.ok(uygulanmaz(dene(() => e.places({ ekle: { ad: 'X' } }).sonuc)), 'yer ekle')
  t.ok(uygulanmaz(dene(() => e.places({ kaldir: YER }).sonuc)), 'yer kaldır')
  t.ok(uygulanmaz(dene(() => e.remove(id(K.irem)))), 'çıkar')
  t.is(L.len, once, 'defter ilerlemedi')
  // Geçici kendi süresini uzatmayı öneremez bile
  t.is(hataOf(() => kisi(K.u5).ekip.setTerm(id(K.u5), now.su() + GUN)), 'TEMPORARY_CANNOT_VOTE')
})

test('T2: alan dışındaki yönetici ata/sure/cikar yapamaz; rol veremez; sahip olamaz', (t) => {
  const { L, kerem, kisi, now } = ekip()
  kerem.ekip.places({ ekle: { ad: 'Depo', tur: 'depo', placeId: DEPO } })
  uyeEkle(kerem, K.husniye, 'yonetici')
  uyeEkle(kerem, K.ecem, 'calisan')
  uyeEkle(kerem, K.u5, 'gecici')
  kerem.ekip.assign(id(K.husniye), [YER])
  kerem.ekip.assign(id(K.ecem), [DEPO])
  kerem.ekip.assign(id(K.u5), [DEPO])
  const h = kisi(K.husniye).ekip
  t.is(hataOf(() => h.assign(id(K.ecem), [YER])), 'OUT_OF_SCOPE')
  t.is(hataOf(() => h.assign(id(K.ecem), [])), 'OUT_OF_SCOPE')
  t.is(hataOf(() => h.setTerm(id(K.u5), now.su() + GUN)), 'OUT_OF_SCOPE')
  t.is(hataOf(() => h.remove(id(K.ecem), { wipe: true })), 'OUT_OF_SCOPE')
  t.is(hataOf(() => h.role(id(K.ecem), 'gecici', { sureSonu: now.su() + GUN })), 'OUT_OF_SCOPE')
  t.is(h.role(id(K.husniye), 'sahip').durum, 'oneri', 'kendini sahip yapmak bütün S ister')
  t.is(h.assign(id(K.husniye), [YER, DEPO]).durum, 'oneri', 'alanını genişletemez (sahip imzası bekler)')
  t.alike(L.assignments.get(id(K.husniye)).placeIds, [YER])
})

test('T3: çıkarılan üye TeamApi ile yazamaz; makbuzu yalnız kendi anahtarıyla ve kendi oturumundan', (t) => {
  const { L, kerem, kisi, now } = ekip()
  uyeEkle(kerem, K.husniye, 'yonetici')
  uyeEkle(kerem, K.ecem, 'calisan')
  uyeEkle(kerem, K.irem, 'calisan')
  kerem.ekip.assign(id(K.husniye), [YER])
  kerem.ekip.assign(id(K.ecem), [YER])
  const c = kerem.ekip.remove(id(K.husniye))
  t.is(c.durum, 'uygulandi')
  const h = kisi(K.husniye).ekip
  t.ok(hataOf(() => h.assign(id(K.ecem), [])), 'çıkarılan yönetici atayamaz')
  t.ok(hataOf(() => h.remove(id(K.ecem))), 'çıkarılan yönetici çıkaramaz')
  // İrem, Hüsniye adına makbuz yazamaz (imza Hüsniye'nin anahtarıyla doğrulanır)
  const sahte = EC.makbuzYaz(L.familyId, { memberId: K.husniye.memberId, signKeyPair: K.irem.signKeyPair }, { eventHash: eventHash(c.event), scope: 1, collections: 1, convs: 0, blobs: 0, finishedAt: 1 })
  t.is(hataOf(() => kerem.ekip.receiveReceipt(id(K.husniye), sahte, 'posta')), 'INVALID_SIGNATURE')
  const gercek = EC.makbuzYaz(L.familyId, K.husniye, { eventHash: eventHash(c.event), scope: 1, collections: 1, convs: 0, blobs: 0, finishedAt: 1 })
  t.is(hataOf(() => kerem.ekip.receiveReceipt(id(K.irem), gercek, 'posta')), 'UNAUTHORIZED', 'başkasının oturumundan')
  const yanlisOlay = EC.makbuzYaz(L.familyId, K.husniye, { eventHash: b4a.alloc(32, 9), scope: 1, collections: 1, convs: 0, blobs: 0, finishedAt: 1 })
  t.is(hataOf(() => kerem.ekip.receiveReceipt(id(K.husniye), yanlisOlay, 'posta')), 'INVALID_RECEIPT')
  const sifir = EC.makbuzYaz(L.familyId, K.husniye, { scope: 1, collections: 1, convs: 0, blobs: 0, finishedAt: 1 })
  t.is(hataOf(() => kerem.ekip.receiveReceipt(id(K.husniye), sifir, 'posta')), 'INVALID_RECEIPT', 'çıkarılan üye LEAVE makbuzu veremez')
  // wipe: true çıkarmaya iş kapsamı makbuzu
  const w = kerem.ekip.remove(id(K.irem), { wipe: true })
  const dar = EC.makbuzYaz(L.familyId, K.irem, { eventHash: eventHash(w.event), scope: 1, collections: 1, convs: 0, blobs: 0, finishedAt: 1 })
  t.is(hataOf(() => kerem.ekip.receiveReceipt(id(K.irem), dar, 'posta')), 'INVALID_RECEIPT')
  // Başka topluluğun makbuzu
  const baska = EC.makbuzYaz(b4a.alloc(32, 3), K.husniye, { eventHash: eventHash(c.event), scope: 1, collections: 1, convs: 0, blobs: 0, finishedAt: 1 })
  t.is(hataOf(() => kerem.ekip.receiveReceipt(id(K.husniye), baska, 'posta')), 'INVALID_MESSAGE')
  // 30 gün sonra
  now.ileri(31 * GUN)
  t.is(hataOf(() => kerem.ekip.receiveReceipt(id(K.husniye), gercek, 'posta')), 'UNAUTHORIZED')
  // Çıkarılan üyeden makbuz dışında tür geçmez
  t.is(hataOf(() => kerem.defter.receiveProposal(id(K.husniye), encodeEvent(c.event), 'posta')), 'TYPE_NOT_ALLOWED')
})

test('T4: EKIP_CIKIS: çalışanın imzaladığı sahte çıkarma kopyası güncel cihazda kesin ret; başka hedef reddi', (t) => {
  const { L, kerem, kisi, now } = ekip()
  uyeEkle(kerem, K.ecem, 'calisan')
  uyeEkle(kerem, K.irem, 'calisan')
  kerem.ekip.assign(id(K.ecem), [YER])
  const Le = kopyala(L)
  const ecem = new S.TeamApi({ defter: new S.LedgerApi({ ledger: Le, me: K.ecem, now }), now })
  const sahte = createEvent(L, T.REMOVE_MEMBER, { memberId: K.ecem.memberId, reason: '', wipe: true }, now())
  signEvent(sahte, K.irem)
  const bytes = EC.encodeCikis(L, sahte)
  let silindi = 0
  t.ok(hataOf(() => ecem.receiveExit(id(K.irem), bytes, 'dogrudan', { sil: () => { silindi++; return {} } })), 'reddedilir')
  t.is(silindi, 0)
  // Eski kopya + 7 gün: çalışan imzası yine yetmez
  const Le2 = new Ledger(); for (const e of L.events.slice(0, L.len - 2)) Le2.apply(decodeEvent(encodeEvent(e)))
  const ecem2 = new S.TeamApi({ defter: new S.LedgerApi({ ledger: Le2, me: K.ecem, now }), now })
  t.ok(hataOf(() => ecem2.receiveExit(id(K.kerem), bytes, 'dogrudan', { sil: () => { silindi++; return {} }, sonBaglanti: now.su() - 8 * GUN })))
  t.is(silindi, 0)
})

test('T5: kaldırılıp yeniden eklenen yer (yerler ekle aynı placeId) eski atamaları geri getirmez', (t) => {
  const { L, kerem } = ekip()
  kerem.ekip.places({ ekle: { ad: 'Depo', tur: 'depo', placeId: DEPO } })
  uyeEkle(kerem, K.ecem, 'calisan')
  kerem.ekip.assign(id(K.ecem), [DEPO])
  kerem.ekip.places({ kaldir: DEPO })
  const r = kerem.ekip.places({ ekle: { ad: 'Depo', tur: 'depo', placeId: DEPO } })
  t.is(r.sonuc.durum, 'uygulandi')
  t.alike(r.yerler.find((y) => y.placeId === DEPO).kisiler, [])
  t.alike(L.assignments.get(id(K.ecem)).placeIds, [])
})

test('T6: uygulanan öneri yeniden oynatılınca uygulanmaz; reddedilen öneri geri dönmez', (t) => {
  const { L, kerem, kisi } = ekip()
  uyeEkle(kerem, K.husniye, 'sahip')
  uyeEkle(kerem, K.ecem, 'calisan')
  uyeEkle(kerem, K.irem, 'calisan')
  const r = kisi(K.ecem).ekip.remove(id(K.irem))
  t.is(r.durum, 'oneri')
  const a0 = kerem.defter.receiveProposal(id(K.ecem), encodeEvent(r.event), 'dogrudan')
  t.is(a0.durum, 'waiting')
  t.is(kerem.defter.sign(a0.oneriId).durum, 'uygulandi')
  const once = L.len
  const x = kerem.defter.receiveProposal(id(K.husniye), imzali(r.event, K.husniye), 'dogrudan')
  t.not(x.durum, 'applied')
  t.is(L.len, once)
  // Ret
  const r2 = kisi(K.ecem).ekip.remove(id(K.husniye))
  const a = kerem.defter.receiveProposal(id(K.ecem), encodeEvent(r2.event), 'dogrudan')
  kerem.defter.rejectProposal(a.oneriId)
  t.is(hataOf(() => kerem.defter.receiveProposal(id(K.ecem), encodeEvent(r2.event), 'dogrudan')), 'PROPOSAL_NOT_ALLOWED')
})
const imzali = (e, k) => { const x = decodeEvent(encodeEvent(e)); signEvent(x, k); return encodeEvent(x) }

test('T7 (K6 denetimi): gizlisi bilinen bırakma anahtarıyla aynı kurulum geçerli → K6 yalnız anahtar yüzünden kırmızı', (t) => {
  const { L, kerem, now } = ekip()
  const dev = V.C.isci1
  const e = createEvent(L, T.DEVICE_ATTACH, { deviceCert: dev.deviceCert, class: 'isci', name: 'kamera', placeId: b4a.from(YER, 'hex'), caps: b4a.from('caps'), ceremonyTranscriptHash: b4a.alloc(32, 7) }, now())
  signEvent(e, dev); signEvent(e, K.kerem); L.apply(e)
  const col = [...L.collections.values()].find((c) => c.name === 'Olaylar:Merkez')
  const pk = b4a.alloc(32); const sk = b4a.alloc(32); sodium.crypto_box_keypair(pk, sk)
  t.is(kerem.defter._yaz(T.COLLECTION, { collectionId: b4a.from(col.id, 'hex'), name: col.name, kind: col.kind, readers: col.readers, writers: [...col.writers, 'device:' + id(dev)], sensitivity: col.sensitivity, taskAccess: col.taskAccess, history: col.history, dropKey: pk }).durum, 'uygulandi')
  const rk = new Replika({ ledger: L, me: K.kerem, now })
  rk.sync()
  rk.addDropSecret(col.id, sk)
  const hlc = fromMs(now.su())
  const bytes = sealDrop({ familyId: L.familyId, collectionId: b4a.from(col.id, 'hex'), dropKey: pk, signer: dev, inner: { recordId: appendRecordId(dev.memberId, hlc), op: OP.APPEND, type: 'mekan.kasa.bos', fields: [{ name: '_subj', value: 'yer:' + YER }, { name: '_t', value: now.su() }], hlc, authorId: dev.memberId, ledgerSeq: L.len - 1, ledgerHash: L.head } })
  t.is(rk.receiveOp(bytes, 1).status, 'gecerli')
})

// D49 uyarlaması: inceleme D45 ağacında yapıldı; 288–289 D46'da RFC-0005 §17'deki adlarıyla köprüye verildi
test('T8: kanal numaraları RFC-0005 §17 ile aynı; 288–289 köprü (D46)', (t) => {
  const beklenen = { TEAM_CREATE: 280, TEAM_ROLE: 281, TEAM_ASSIGN: 282, TEAM_TERM: 283, TEAM_NOTICE: 284, TEAM_REMOVE: 285, TEAM_EXIT_STATUS: 286, TEAM_PLACES: 287, BRIDGE_PREPARE: 288, BRIDGE_RECEIVE: 289 }
  for (const [ad, no] of Object.entries(beklenen)) t.is(S.CHANNEL_COMMAND[ad], no)
  const nolar = Object.values(S.CHANNEL_COMMAND)
  t.is(new Set(nolar).size, nolar.length, 'tekrar yok')
})
