// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// persistence.js testleri: dosya biçimi, atomik yazım, bozuk dosyada açık hata, kapat–aç sonrası aynı durum
'use strict'
const test = require('brittle')
const fs = require('#fs')
const b4a = require('b4a')
const { ledger: { T } } = require('@havenfold/core')
const { Kalici, Depo, DiskDeposu, kodla, coz } = require('../persistence')
const A = require('../../core/records/test/helpers/family')
const { geciciDizin, hataOfSenk, kaliciAc } = require('./helpers/common')

const ANAHTAR = b4a.alloc(32, 0x5a)
const TA = A.hex(A.K_TUM_AILE)
const saat = () => { let t = A.TS0 + 3_600_000; return () => t++ }
const json = (k) => JSON.stringify(kodla(k.goruntu()))

// Bir replikanın çıkışındaki türdeki mesajları birden çok alıcıya dağıtır (A.teslim tek alıcıya verip çıkışı boşaltır)
function dagit (from, alicilar, turler) {
  const msgs = from.outbox.filter((m) => turler.includes(m.type))
  from.outbox = from.outbox.filter((m) => !turler.includes(m.type))
  for (const to of alicilar) {
    from.outbox.push(...msgs)
    A.teslim(from, to, turler)
  }
}

test('değer kodlaması: baytlar, BigInt, Map, Set, özel sayılar, $ anahtarlı nesne', (t) => {
  const x = {
    b: b4a.from([1, 2, 3]), n: 123456789012345678901n, m: new Map([['a', 1], [b4a.from('k'), [2n]]]), s: new Set(['x', 'y']),
    f: [-0, NaN, Infinity, -Infinity, 1.5], $o: { $h: 'aa' }, bos: null, ic: [{ a: [b4a.alloc(0)] }], d: true
  }
  const y = coz(JSON.parse(JSON.stringify(kodla(x))))
  t.alike(y.b, x.b)
  t.is(y.n, x.n)
  t.ok(y.m instanceof Map)
  t.alike([...y.m.keys()][1], b4a.from('k'))
  t.alike(y.m.get('a'), 1)
  t.alike([...y.s], ['x', 'y'])
  t.ok(Object.is(y.f[0], -0))
  t.ok(Number.isNaN(y.f[1]))
  t.is(y.f[2], Infinity)
  t.is(y.f[3], -Infinity)
  t.alike(y.$o, { $h: 'aa' })
  t.is(y.bos, null)
  t.alike(y.ic[0].a[0], b4a.alloc(0))
  t.is(y.d, true)
})

for (const [ad, anahtar] of [['açık', null], ['şifreli', ANAHTAR]]) {
  test(`depo (${ad} kip): yaz, oku, üzerine yaz, sil; olmayan dosya null`, (t) => {
    const d = new Depo({ dizin: geciciDizin(t), anahtar, testKipi: true })
    t.is(d.oku('durum'), null)
    d.yaz('durum', b4a.from('ilk'))
    t.alike(d.oku('durum'), b4a.from('ilk'))
    d.yaz('durum', b4a.from('ikinci'))
    t.alike(d.oku('durum'), b4a.from('ikinci'))
    d.yaz('dosyalar/' + 'ab'.repeat(32), b4a.alloc(0))
    t.alike(d.oku('dosyalar/' + 'ab'.repeat(32)), b4a.alloc(0))
    d.sil('durum')
    t.is(d.oku('durum'), null)
    t.is(hataOfSenk(() => d.yaz('../disari', b4a.from('x'))), 'INVALID_NAME')
    t.is(hataOfSenk(() => d.yaz('a.tmp-1', b4a.from('x'))), 'INVALID_NAME')
  })

  test(`depo (${ad} kip): bozuk, kısaltılmış, yer değiştirmiş dosya STATE_CORRUPT; başka sürüm STATE_VERSION`, (t) => {
    const dizin = geciciDizin(t)
    const d = new Depo({ dizin, anahtar, testKipi: true })
    d.yaz('durum', b4a.from('aile verisi'))
    const asil = fs.readFileSync(dizin + '/durum')
    const hata = () => { try { d.oku('durum'); return null } catch (err) { return err.message + ':' + err.dosya } }
    // Son bayt değişti
    const bozuk = b4a.from(asil); bozuk[bozuk.length - 1] ^= 1
    fs.writeFileSync(dizin + '/durum', bozuk)
    t.is(hata(), 'STATE_CORRUPT:durum')
    // Kısaltıldı
    fs.writeFileSync(dizin + '/durum', asil.subarray(0, asil.length - 3))
    t.is(hata(), 'STATE_CORRUPT:durum')
    fs.writeFileSync(dizin + '/durum', asil.subarray(0, 3))
    t.is(hata(), 'STATE_CORRUPT:durum')
    // Başka adın içeriği bu adın yerine kondu (ad AD'de)
    d.yaz('hlc', b4a.alloc(8))
    fs.writeFileSync(dizin + '/durum', fs.readFileSync(dizin + '/hlc'))
    t.is(hata(), 'STATE_CORRUPT:durum')
    // Sürüm baytı
    const surum = b4a.from(asil); surum[4] = 2
    fs.writeFileSync(dizin + '/durum', surum)
    t.is(hata(), 'STATE_VERSION:durum')
    fs.writeFileSync(dizin + '/durum', asil)
    t.alike(d.oku('durum'), b4a.from('aile verisi'))
  })
}

test('depo: kip platform anahtarına uymuyor (STATE_MODE_MISMATCH); yanlış anahtar STATE_CORRUPT', (t) => {
  const dizin = geciciDizin(t)
  new Depo({ dizin, anahtar: ANAHTAR, testKipi: true }).yaz('durum', b4a.from('x'))
  t.is(hataOfSenk(() => new Depo({ dizin, testKipi: true }).oku('durum')), 'STATE_MODE_MISMATCH')
  t.is(hataOfSenk(() => new Depo({ dizin, anahtar: b4a.alloc(32, 1) }).oku('durum')), 'STATE_CORRUPT')
  t.is(hataOfSenk(() => new Depo({ dizin, anahtar: b4a.alloc(31), testKipi: true })), 'INVALID_KEY')
  // Şifreli dosyada içerik açık metin olarak görünmez
  new Depo({ dizin, anahtar: ANAHTAR, testKipi: true }).yaz('durum', b4a.from('wifi-parolasi-gizli'))
  t.absent(b4a.toString(fs.readFileSync(dizin + '/durum')).includes('wifi-parolasi-gizli'))
})

test('depo: yarıda kalmış yazımın geçici dosyası açılışta silinir, asıl dosya bozulmaz', (t) => {
  const dizin = geciciDizin(t)
  const d = new Depo({ dizin, testKipi: true })
  d.yaz('durum', b4a.from('eski'))
  fs.writeFileSync(dizin + '/durum.tmp-0011aabbccdd', b4a.from('yarım'))
  fs.writeFileSync(dizin + '/dosyalar/' + 'cd'.repeat(32) + '.tmp-0011aabbccdd', b4a.from('yarım'))
  const d2 = new Depo({ dizin, testKipi: true })
  t.alike(d2.oku('durum'), b4a.from('eski'))
  t.alike(fs.readdirSync(dizin).map(String).sort(), ['dosyalar', 'durum'])
  t.alike(fs.readdirSync(dizin + '/dosyalar').map(String), [])
})

test('dosya deposu: parçalar diske yazılır ve okunur; geçersiz ad', (t) => {
  const dd = new DiskDeposu(new Depo({ dizin: geciciDizin(t), anahtar: ANAHTAR, testKipi: true }))
  const k = 'ef'.repeat(32)
  t.is(dd.get(k), null)
  dd.set(k, [b4a.from('bir'), b4a.alloc(0), b4a.alloc(70000, 3)])
  t.alike(dd.get(k), [b4a.from('bir'), b4a.alloc(0), b4a.alloc(70000, 3)])
  t.ok(dd.has(k))
  dd.delete(k)
  t.is(dd.get(k), null)
  t.is(hataOfSenk(() => dd.get('../durum')), 'INVALID_NAME')
})

test('kimlik: ilk açılışta üretilir ve aynı kalır; ailesiz durum; verilen kimlik uyuşmazsa IDENTITY_MISMATCH', (t) => {
  const dizin = geciciDizin(t)
  const k1 = kaliciAc({ dizin, now: saat(), appId: 'deneme' })
  t.is(k1.nesneler.aile, false)
  t.ok(k1.nesneler.defter)
  t.is(k1.nesneler.kayit, null)
  k1.kaydet()
  const k2 = kaliciAc({ dizin, now: saat(), appId: 'deneme' })
  t.alike(k2.kimlik.memberId, k1.kimlik.memberId)
  t.alike(k2.kimlik.signKeyPair.secretKey, k1.kimlik.signKeyPair.secretKey)
  t.is(k2.nesneler.aile, false)
  t.is(hataOfSenk(() => kaliciAc({ dizin, kimlik: A.K.kerem })), 'IDENTITY_MISMATCH')
})

test('aile kur: kapat–aç sonrası aynı defter, koleksiyonlar, kayıt ve dosya', (t) => {
  const dizin = geciciDizin(t)
  const now = saat()
  const k = kaliciAc({ dizin, now, appId: 'deneme' })
  const n = k.aileKur({ aileAdi: 'Rivera', benimAdim: 'Alex' })
  t.is(hataOfSenk(() => k.aileKur({ aileAdi: 'x', benimAdim: 'y' })), 'FAMILY_EXISTS')
  const cid = n.kayit.collections().find((c) => c.name === 'Tüm Aile').collectionId
  const rid = n.kayit.put(cid, null, 'yuva.defter.not', { baslik: 'Wifi', parola: 'abc123', sayi: -7 })
  const { blobRef } = n.kayit.attach({ bytes: b4a.from('garanti belgesi'), mime: 'application/pdf', name: 'garanti.pdf' })
  n.kayit.put(cid, rid, '', { belge: blobRef })
  t.ok(k.kaydet())
  t.absent(k.kaydet(), 'değişmeyen durum yeniden yazılmaz')
  const once = json(k)

  const k2 = kaliciAc({ dizin, now, appId: 'deneme' })
  const m = k2.nesneler
  t.is(m.aile, true)
  t.is(m.ledger.len, n.ledger.len)
  t.alike(m.ledger.head, n.ledger.head)
  t.is(m.ledger.familyName, 'Rivera')
  t.alike(m.kayit.collections(), n.kayit.collections())
  t.alike(m.kayit.get(cid, rid), n.kayit.get(cid, rid))
  t.alike(m.kayit.history(cid, rid), n.kayit.history(cid, rid))
  t.alike(m.kayit.open(m.kayit.get(cid, rid).fields.belge).bytes, b4a.from('garanti belgesi'))
  t.ok(m.kayit.eklenen.has(A.hex(blobRef.blobId)), 'bu telefonda eklenen dosya (RFC-0025 §1) korunur')
  t.is(json(k2), once, 'anlık görüntü aynı')
  t.absent(k2.kaydet(), 'açılıştan sonra durum değişmedi')
  // Yeni yazım hlc'yi geri götürmez
  const h0 = m.replika.hlc.last
  m.kayit.put(cid, rid, '', { sayi: 8 })
  t.ok(m.replika.hlc.last > h0)
  t.ok(k2.kaydet())
  const k3 = kaliciAc({ dizin, now, appId: 'deneme' })
  t.is(k3.nesneler.kayit.get(cid, rid).fields.sayi, 8)
  t.is(k3.nesneler.replika.hlc.last, m.replika.hlc.last)
})

// Çok üyeli aile: başka telefonlardan gelen işlemler ve anahtarlar, kesim, hariç tutulan işlem, mezar, kuyruk, çıkış
// kutusu, görülme, onay ve öneri; hepsi kapat–aç sonrası aynı.
test('çok üyeli aile: kapat–aç sonrası replika, kesimler, anahtarlar ve yerel durum aynı', (t) => {
  const dizin = geciciDizin(t)
  const now = saat()
  const L = A.anaDefter()
  const k = kaliciAc({ dizin, now, appId: 'deneme', kimlik: A.K.kerem, anahtar: ANAHTAR })
  const n = k.aileBagla(L)
  const rH = A.replika(A.kopya(L), A.K.husniye)
  const LI = A.kopya(L)
  const rI = A.replika(LI, A.K.irem)
  // Anahtar alışverişi: her yönde
  for (let i = 0; i < 2; i++) {
    dagit(rH, [n.replika, rI], [0x82, 0x88])
    dagit(n.replika, [rH, rI], [0x82, 0x88])
    n.replika.sync(); rH.sync(); rI.sync()
  }
  const benim = n.kayit.put(TA, null, 'yuva.defter.not', { baslik: 'Kerem yazdı' })
  const hus = rH.put(TA, null, 'yuva.defter.not', { baslik: 'Hüsniye yazdı' })
  const irem = rI.put(TA, null, 'yuva.defter.not', { baslik: 'İrem yazdı' })
  A.teslim(rH, n.replika, [0x81])
  // İrem'in bir işlemi kesimden önce gelir, biri sonra (kesimde olmadığı için hariç kalır)
  const irOps = rI.outbox.filter((m) => m.type === 0x81)
  n.replika.receiveOp(irOps[0].bytes, 0)
  const gec = rI.put(TA, irem, '', { not: 'geç geldi' })
  t.ok(gec)
  // İrem aileden çıkar: Kerem okuyucu olarak kesim yayımlar
  const e = A.olay(L, T.REMOVE_MEMBER, { memberId: A.K.irem.memberId, reason: 'test', wipe: true }, [A.K.kerem, A.K.husniye])
  L.apply(e)
  n.replika.sync()
  for (const m of rI.outbox.splice(0)) if (m.type === 0x81) n.replika.receiveOp(m.bytes, 0)
  const durumlar = [...n.replika.ops.values()].map((o) => o.status + ':' + (o.code || ''))
  t.ok(durumlar.includes('haric:NOT_IN_CUTOFF'), 'kesimde olmayan işlem hariç')
  t.ok(n.replika.cutoffs.messages.size > 0, 'kesim yayımlandı')
  // Yerel durum: mezar, görülme, onay, öneri, yetenek bitleri, bekleyen çıkış
  n.replika.tomb.set('11'.repeat(32), TA)
  n.gorulme.direct(A.K.husniye.memberId, A.TS0 + 1000)
  n.gorev.onay.ver(A.K.kerem.memberId, A.C.isci1.memberId, true, A.TS0 + 2000)
  n.caps.record(A.hex(A.K.husniye.memberId), 8192, A.TS0 + 3000)
  const oneri = n.defter.removeMember(A.hex(A.K.ecem.memberId), { reason: 'test', wipe: false })
  t.ok(oneri.oneriId, 'tek imzalı çıkarma öneri olarak bekler')
  t.ok(n.replika.outbox.length > 0, 'gönderilmemiş mesajlar var')
  k.kaydet()
  const once = json(k)
  const kayitlar = n.kayit.query(TA)
  const gecmis = n.kayit.history(TA, irem)

  const k2 = kaliciAc({ dizin, now, appId: 'deneme', anahtar: ANAHTAR })
  const m = k2.nesneler
  t.alike(m.kayit.query(TA), kayitlar)
  t.alike(m.kayit.history(TA, irem), gecmis)
  t.ok(m.kayit.get(TA, hus) && m.kayit.get(TA, benim))
  t.alike([...m.replika.ops.values()].map((o) => o.status + ':' + (o.code || '')).sort(), durumlar.sort())
  t.is(m.replika.tomb.get('11'.repeat(32)), TA)
  t.alike([...m.replika.cutoffs.unions], [...n.replika.cutoffs.unions])
  t.alike([...m.replika.cutoffs.issued], [...n.replika.cutoffs.issued])
  t.is(m.replika.outbox.length, n.replika.outbox.length)
  t.alike(m.gorulme.son.get(A.hex(A.K.husniye.memberId)), { dogrudan: A.TS0 + 1000, emanet: null })
  t.ok(m.gorev.onay.var(A.K.kerem.memberId, A.C.isci1.memberId))
  t.is(m.caps.get(A.hex(A.K.husniye.memberId)).caps, 8192)
  t.is(m.defter.listProposals().length, 1)
  t.is(json(k2), once, 'anlık görüntü aynı')
  t.absent(k2.kaydet())
})

test('bozuk durum dosyası: açılış STATE_CORRUPT ile düşer, dosya yerinde kalır', (t) => {
  const dizin = geciciDizin(t)
  const k = kaliciAc({ dizin, now: saat() })
  k.aileKur({ aileAdi: 'Rivera', benimAdim: 'Alex' })
  const asil = fs.readFileSync(dizin + '/durum')
  const b = b4a.from(asil); b[40] ^= 0xff
  fs.writeFileSync(dizin + '/durum', b)
  let err = null
  try { kaliciAc({ dizin, now: saat() }) } catch (e) { err = e }
  t.is(err && err.message, 'STATE_CORRUPT')
  t.is(err && err.dosya, 'durum')
  t.alike(fs.readFileSync(dizin + '/durum'), b, 'bozuk dosya sessizce silinmez')
  // Kimlik dosyası bozuksa da aynı
  fs.writeFileSync(dizin + '/durum', asil)
  const kb = fs.readFileSync(dizin + '/kimlik'); kb[kb.length - 1] ^= 1
  fs.writeFileSync(dizin + '/kimlik', kb)
  t.is(hataOfSenk(() => kaliciAc({ dizin, now: saat() })), 'STATE_CORRUPT')
})

test('durum içeriği geçerli JSON ama çekirdeğin doğrulamasından geçmiyor: STATE_CORRUPT', (t) => {
  const dizin = geciciDizin(t)
  const k = kaliciAc({ dizin, now: saat() })
  k.aileKur({ aileAdi: 'Rivera', benimAdim: 'Alex' })
  const g = coz(JSON.parse(JSON.stringify(kodla(k.goruntu()))))
  g.defter.olaylar[1] = g.defter.olaylar[0] // zincir kopuk
  k.depo.yaz('durum', b4a.from(JSON.stringify(kodla(g))))
  t.is(hataOfSenk(() => kaliciAc({ dizin, now: saat() })), 'STATE_CORRUPT')
  k.depo.yaz('durum', b4a.from(JSON.stringify({ v: 99 })))
  t.is(hataOfSenk(() => kaliciAc({ dizin, now: saat() })), 'STATE_VERSION')
  k.depo.yaz('durum', b4a.from('[1,2]'))
  t.is(hataOfSenk(() => kaliciAc({ dizin, now: saat() })), 'STATE_CORRUPT')
})

test('ürün saklaması: önekle ayrılır, durumla yazılır, kapat–aç sonrası aynı; bozuk durum düşer', (t) => {
  const dizin = geciciDizin(t)
  const now = saat()
  const k = kaliciAc({ dizin, now, appId: 'deneme' })
  t.is(hataOfSenk(() => k.urunSaklama('Büyük/')), 'INVALID_NAME')
  const s0 = k.urunSaklama('hizmet/')
  s0.set('ailesizken', 1) // aile kurulmadan önce yazılan korunur
  k.aileKur({ aileAdi: 'Rivera', benimAdim: 'Alex' })
  const s = k.urunSaklama('hizmet/')
  const d = k.urunSaklama('diger/')
  t.is(s.get('yok'), null)
  s.set('takma/ab', 'cd'.repeat(64))
  s.set('taslaklar', [{ shareId: 'aa', olusturma: 5 }])
  d.set('takma/ab', 'baska')
  t.ok(k.kaydet())
  const k2 = kaliciAc({ dizin, now, appId: 'deneme' })
  const s2 = k2.urunSaklama('hizmet/')
  t.is(s2.get('takma/ab'), 'cd'.repeat(64))
  t.alike(s2.get('taslaklar'), [{ shareId: 'aa', olusturma: 5 }])
  t.is(s2.get('ailesizken'), 1)
  t.is(k2.urunSaklama('diger/').get('takma/ab'), 'baska')
  s2.delete('takma/ab')
  t.is(s2.get('takma/ab'), null)
})

test('ürün saklaması: undefined siler, geçersiz ve büyük değer reddedilir; aile öncesi yazılan yeniden açılışta kalır', (t) => {
  const dizin = geciciDizin(t)
  const now = saat()
  const k = kaliciAc({ dizin, now, appId: 'deneme' })
  const s = k.urunSaklama('hizmet/')
  s.set('a', 1)
  s.set('a', undefined)
  t.is(s.get('a'), null, 'undefined siler, durum bozulmaz')
  t.is(hataOfSenk(() => s.set('f', () => 1)), 'INVALID_VALUE')
  t.is(hataOfSenk(() => s.set('b', 'x'.repeat(300 * 1024))), 'VALUE_TOO_LARGE')
  s.set('dizinler', { 'TR-35': 'ab' })
  t.ok(k.kaydet(), 'aile yokken de durum yazılır')
  const k2 = kaliciAc({ dizin, now, appId: 'deneme' })
  t.alike(k2.urunSaklama('hizmet/').get('dizinler'), { 'TR-35': 'ab' })
})

test('ürün saklaması: takma ad (gizli önek) arşivde; kilitliyken okunmaz, durum dosyasında yok, açılınca arşivden gelir', (t) => {
  const { arsivAnahtari } = require('./helpers/common')
  const ARS = arsivAnahtari(12)
  const dizin = geciciDizin(t)
  const now = saat()
  const k = kaliciAc({ dizin, now, appId: 'deneme', archivePubHex: ARS.pubHex })
  k.aileKur({ aileAdi: 'Rivera', benimAdim: 'Alex' })
  const s = k.urunSaklama('hizmet/')
  t.is(hataOfSenk(() => s.set('takma/ab', 'gizli')), 'ARCHIVE_LOCKED')
  k.arsivAc(ARS.skHex)
  s.set('takma/ab', 'gizli')
  s.set('taslaklar', [])
  t.ok(k.kaydet())
  t.absent(JSON.stringify(json(k)).includes('gizli'), 'durumda yok')
  const k2 = kaliciAc({ dizin, now, appId: 'deneme', archivePubHex: ARS.pubHex })
  const s2 = k2.urunSaklama('hizmet/')
  t.alike(s2.get('taslaklar'), [])
  t.is(hataOfSenk(() => s2.get('takma/ab')), 'ARCHIVE_LOCKED')
  k2.arsivAc(ARS.skHex)
  t.is(s2.get('takma/ab'), 'gizli', 'arşivden (yedeğe giren katman)')
})
