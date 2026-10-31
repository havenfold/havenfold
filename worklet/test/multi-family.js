// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D92: RFC-0034 adım 1 ve 2 — bir telefonda birden çok aile. Worklet'te aile örnekleri (kalıcı durum, çerçeve seçimi,
// 420–422, göç) ve tek düğümlü taşıyıcı. Vektörler (protocol/vectors/multi-family.json): 1 bağlantısızlık, 2 seçim, 3 sınır,
// 4 aynı aile, 5 dosya takası, 6 silinen örnek, 9 göç, 10 taşıyıcı; inceleme 25 (D95) düzeltmeleri. Beklenenler RFC'den
// ve incelemeden elle yazıldı.
'use strict'
const test = require('brittle')
const fs = require('#fs')
const b4a = require('b4a')
const sodium = require('sodium-native')
const { start } = require('..')
const { urunSunucusu, KOMUT } = require('../example/product')
const { Depo, kodla, coz } = require('../persistence')
const { geciciDizin, ipcCifti, istemci, hataOf, arsivAnahtari } = require('./helpers/common')
const V = require('../../protocol/vectors/multi-family.json')

const ARSIV = arsivAnahtari(92)
const ANAHTAR = b4a.alloc(32, 9)
const FAMILIES = 420
const FAMILY_ADD = 421
const JOIN_PREPARE = 422
const FAMILY_LEAVE = 423
const FAMILY_LOCAL_REMOVE = 424
const hex = (b) => b4a.toString(b, 'hex')
const rastgele = (n) => { const b = b4a.alloc(n); sodium.randombytes_buf(b); return b }
const bekle = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function kosul (f, ms = 10000) { const son = Date.now() + ms; while (!(await f())) { if (Date.now() > son) throw new Error('TIMEOUT'); await bekle(10) } }

async function ac (t, { dizin, sayac = null, sayaclar = null, ...ek } = {}) {
  const ipc = ipcCifti()
  const c = istemci(ipc)
  const w = await start({ urunSunucusu, dizin, anahtar: ANAHTAR, archivePubHex: ARSIV.pubHex, sayac, sayaclar, ipc, appId: 'ornek', ...ek })
  t.teardown(() => w.kapat())
  return { w, c }
}

// Son 'kalici' olaylarından sayaç haritası ({ kok, <yerelNo> }); tek örnekte olay aile taşımaz, çok örnekte kök kok: true.
// h verilirse onun üstüne (uygulamanın platform kasasındaki harita gibi)
function sayaclarOf (c, kokNo, h = {}) {
  h = { ...h }
  for (const x of c.olaylar) {
    if (x.olay !== 'persisted' || !('sayac' in x.veri)) continue
    const k = x.kok || !x.aile ? 'kok' : x.aile
    if (x.veri.sayac === null) delete h[k]
    else h[k] = x.veri.sayac
  }
  return h
}

// Dizindeki dosyalar (göreli yol → boy); kilit ve geçici dosyalar hariç
function dosyalar (d, alt = '') {
  const s = {}
  for (const f of fs.readdirSync(d + alt)) {
    const y = alt + '/' + f
    if (fs.statSync(d + y).isDirectory()) Object.assign(s, dosyalar(d, y))
    else if (f !== 'kilit' && !String(f).includes('.tmp-')) s[y] = true
  }
  return s
}

// 16 bayt ve üstü bütün bayt alanları (hex), iç içe nesne, dizi ve Map'lerde
function baytlar (x, kume = new Set(), gorulen = new Set()) {
  if (typeof x === 'string' && /^[0-9a-f]{32,}$/.test(x)) { kume.add(x); return kume } // defterde kimlikler hex
  if (x === null || typeof x !== 'object' || gorulen.has(x)) return kume
  gorulen.add(x)
  if (x instanceof Uint8Array) { if (x.byteLength >= 16) kume.add(hex(x)); return kume }
  const degerler = x instanceof Map ? [...x.keys(), ...x.values()] : Array.isArray(x) ? x : Object.values(x)
  for (const v of degerler) baytlar(v, kume, gorulen)
  return kume
}

test('vektör 2, 3: seçim kuralı (FAMILY_AMBIGUOUS, NO_FAMILY), 420 FAMILIES, 421 FAMILY_ADD, sınır 3 (FAMILY_LIMIT)', async (t) => {
  const { w, c } = await ac(t, { dizin: geciciDizin(t, 'ca') })
  const kokNo = w.kalici.yerelNo
  t.ok(/^[0-9a-f]{32}$/.test(kokNo), 'kök örneğe yerelNo verildi')
  t.alike((await c.iste(FAMILIES)).map((x) => [x.aile, x.durum, x.kok]), [[kokNo, 'ailesiz', true]])
  // Kök örnek ailesizken 421 aileyi orada kurar (bugünkü CREATE_FAMILY yolu)
  t.alike(await c.iste(FAMILY_ADD, { aileAdi: 'Eser ailesi', benimAdim: 'Hüsniye' }), { aile: kokNo })
  // Tek örnek: aile alanı olmadan bugünkü gibi
  const tumOf = async (aile) => (await c.iste(KOMUT.RECORD_COLLECTIONS, {}, aile)).find((x) => x.name === 'Tüm Aile').collectionId
  const tum1 = await tumOf()
  t.ok(tum1, V.secim[0].aciklama)
  const r1 = await c.iste(KOMUT.RECORD_PUT, { collectionId: tum1, type: 'yuva.defter.not', fields: { baslik: 'eser' } })
  t.absent(c.olaylar.some((x) => 'aile' in x), 'tek örnekte olay aile taşımaz')

  const { aile: y2 } = await c.iste(FAMILY_ADD, { aileAdi: "Saadet'in evi", benimAdim: 'Hüsniye' })
  t.ok(y2 && y2 !== kokNo, 'ek örnek')
  // İki örnek: aile alanı zorunlu
  t.is(await hataOf(c.iste(KOMUT.RECORD_COLLECTIONS)), V.secim[1].hata)
  t.is(await hataOf(c.iste(KOMUT.RECORD_PUT, { collectionId: tum1, type: 'yuva.defter.not', fields: {} })), 'FAMILY_AMBIGUOUS', 'yazma da')
  t.is(await hataOf(c.iste(KOMUT.RECORD_COLLECTIONS, {}, 'ab'.repeat(16))), V.secim[2].hata)
  t.is(await hataOf(c.iste(KOMUT.RECORD_COLLECTIONS, {}, 'x')), 'NO_FAMILY')
  const tum2 = await tumOf(y2)
  t.unlike(tum2, tum1, 'iki ailenin koleksiyonları ayrı')
  await c.iste(KOMUT.RECORD_PUT, { collectionId: tum2, type: 'yuva.defter.not', fields: { baslik: 'saadet' } }, y2)
  t.alike((await c.iste(KOMUT.RECORD_QUERY, { collectionId: tum1, type: 'yuva.defter.not' }, kokNo)).map((x) => x.recordId), [r1], 'kök ailede yalnız kendi kaydı') // tür süzgeci: her örnekte hf.uygulama da var (RFC-0036, D96)
  t.alike((await c.iste(KOMUT.RECORD_QUERY, { collectionId: tum2, type: 'yuva.defter.not' }, y2)).map((x) => x.fields.baslik), ['saadet'])
  t.alike(await c.iste(KOMUT.RECORD_QUERY, { collectionId: tum1 }, y2), [], 'bir ailenin koleksiyonu öbüründe yok')
  t.ok(c.olaylar.some((x) => x.olay === 'persisted' && x.aile === y2), 'birden çok örnekte olay aile taşır')
  t.is((await c.iste(KOMUT.FAMILY_INFO, {}, y2)).ad, "Saadet'in evi")
  t.is((await c.iste(KOMUT.FAMILY_INFO, {}, kokNo)).ad, 'Eser ailesi')

  const { aile: y3 } = await c.iste(FAMILY_ADD, { aileAdi: 'Üçüncü', benimAdim: 'Hüsniye' })
  const liste = await c.iste(FAMILIES)
  t.alike(liste.map((x) => [x.aile, x.ad, x.rol, x.benimAdim, x.durum, x.kok]), [
    [kokNo, 'Eser ailesi', 'ebeveyn', 'Hüsniye', 'hazir', true],
    [y2, "Saadet'in evi", 'ebeveyn', 'Hüsniye', 'hazir', false],
    [y3, 'Üçüncü', 'ebeveyn', 'Hüsniye', 'hazir', false]
  ])
  t.ok(liste.every((x) => typeof x.duzey === 'string'))
  // Sınır 3 (§4.2)
  t.is(await hataOf(c.iste(FAMILY_ADD, { aileAdi: 'Dördüncü', benimAdim: 'H' })), V.sinir.hata)
  t.is(await hataOf(c.iste(JOIN_PREPARE)), V.sinir.hata)
  t.is((await c.iste(FAMILIES)).length, 3, 'reddedilen örnek kalmadı')
  t.is(fs.readdirSync(w.kalici.depo.dizin + '/aileler').length, 2, 'klasör kalmadı')
  t.is(await hataOf(c.iste(FAMILY_ADD, { aileAdi: 'x' })), 'INVALID_BODY')
})

test('vektör 1: iki ailenin defterlerinde ve kimliklerinde 16 bayt ve üstü ortak değer yok', async (t) => {
  const { w, c } = await ac(t, { dizin: geciciDizin(t, 'cb') })
  await c.iste(FAMILY_ADD, { aileAdi: 'Eser ailesi', benimAdim: 'Hüsniye' })
  const { aile: y2 } = await c.iste(FAMILY_ADD, { aileAdi: "Saadet'in evi", benimAdim: 'Hüsniye' })
  const kume = (o) => {
    const n = o.kalici.nesneler
    const k = baytlar(o.kalici.kimlik)
    baytlar({ familyId: n.ledger.familyId, members: n.ledger.members, devices: n.ledger.devices }, k)
    return k
  }
  const a = kume(w.ornek(w.kalici.yerelNo))
  const b = kume(w.ornek(y2))
  t.ok(a.size >= 6 && b.size >= 6, 'karşılaştırılacak alan var (memberId, ÜKA ve ÜDA çiftleri, aile kimliği, defterdeki üye ve sertifika)')
  t.alike([...a].filter((x) => b.has(x)), [], V.baglantisizlik.aciklama)
  const ka = w.ornek(w.kalici.yerelNo).kalici.kimlik
  const kb = w.ornek(y2).kalici.kimlik
  t.unlike(hex(ka.memberId), hex(kb.memberId))
  t.is(ka.deviceCert.platform, kb.deviceCert.platform, 'düşük entropili alanlar ortak olabilir')
})

test('vektör 4: katılım örneği (422), JOIN_IN_PROGRESS; famHint ve JOIN_LEDGER familyId telefondaki aileyse FAMILY_EXISTS; süre dolunca silinir', async (t) => {
  const createTestnet = require('hyperdht/testnet')
  const { qrKodla } = require('@havenfold/transport/ceremony')
  const tn = await createTestnet(3, t.teardown)
  const dizin = geciciDizin(t, 'cc')
  const { w, c } = await ac(t, { dizin, katilimMs: 400, tasiyici: { deneysel: true, onyukleme: tn.bootstrap, yoklamaMs: 500 } })
  const kokNo = w.kalici.yerelNo
  t.alike(await c.iste(JOIN_PREPARE), { aile: kokNo }, 'kök örnek ailesizken katılım kökte (bugünkü akış)')
  await c.iste(FAMILY_ADD, { aileAdi: 'Eser ailesi', benimAdim: 'Kerem' })
  const X = w.kalici.nesneler.ledger
  const { aile: y } = await c.iste(JOIN_PREPARE)
  t.is((await c.iste(FAMILIES)).find((x) => x.aile === y).durum, 'katiliyor')
  t.is(await hataOf(c.iste(JOIN_PREPARE)), 'JOIN_IN_PROGRESS')
  t.is(await hataOf(c.iste(FAMILY_ADD, { aileAdi: 'B', benimAdim: 'K' })), 'JOIN_IN_PROGRESS')
  // QR'daki famHint telefondaki ailenin: tören başlamaz, katılım örneği silinir
  const qr = (famHint) => qrKodla({ kind: 0, famHint, inv: rastgele(16), rv: rastgele(32), sec: rastgele(16), exp: Math.ceil(Date.now() / 1000) + 600 })
  t.is(await hataOf(c.iste(KOMUT.JOIN, { kod: qr(b4a.from(X.familyId.subarray(0, 8))) }, y)), V.ayniAile[0].hata)
  t.absent((await c.iste(FAMILIES)).some((x) => x.aile === y), 'katılım örneği silindi')
  t.absent(fs.existsSync(dizin + '/aileler/' + y), 'klasörü de')
  t.ok(c.olaylar.some((x) => x.olay === 'persisted' && x.aile === y && x.veri.sayac === null), 'sayaç haritasından çıkar')
  // JOIN_LEDGER'daki familyId telefondaki aileyse: katılım örneği silinir
  const { aile: y2 } = await c.iste(JOIN_PREPARE)
  t.exception(() => w.ornek(y2).c.aileBagla(X), new RegExp(V.ayniAile[2].hata))
  t.absent(w.ornek(y2), 'katılım örneği silindi')
  // Süre dolunca (testte 400 ms) silinir; sonra yeni katılım hazırlanabilir
  const { aile: y3 } = await c.iste(JOIN_PREPARE)
  await kosul(async () => !(await c.iste(FAMILIES)).some((x) => x.aile === y3))
  t.pass('süre dolunca katılım örneği silindi')
  t.ok((await c.iste(JOIN_PREPARE)).aile)
})

test('vektör 13 (kısmi): kutu, uç ya da işçi platformundaki telefon ikinci aileye giremez (DEVICE_SINGLE_COMMUNITY)', async (t) => {
  const { c } = await ac(t, { dizin: geciciDizin(t, 'cd'), platform: 'kutu' })
  t.ok(await c.iste(FAMILY_ADD, { aileAdi: 'Eser', benimAdim: 'Kutu' }), 'ilk aile kökte')
  t.is(await hataOf(c.iste(FAMILY_ADD, { aileAdi: 'B', benimAdim: 'K' })), 'DEVICE_SINGLE_COMMUNITY')
  t.is(await hataOf(c.iste(JOIN_PREPARE)), 'DEVICE_SINGLE_COMMUNITY')
})

test('vektör 5, 6: örnek düzeyinde hata — takas edilen dosya STATE_CORRUPT, silinen örnek STATE_ROLLED_BACK; diğerleri açılır', async (t) => {
  const dizin = geciciDizin(t, 'ce')
  let { w, c } = await ac(t, { dizin })
  const kokNo = w.kalici.yerelNo
  await c.iste(FAMILY_ADD, { aileAdi: 'Eser', benimAdim: 'H' })
  const { aile: A } = await c.iste(FAMILY_ADD, { aileAdi: 'A', benimAdim: 'H' })
  const { aile: B } = await c.iste(FAMILY_ADD, { aileAdi: 'B', benimAdim: 'H' })
  const memberA = hex(w.ornek(A).kalici.kimlik.memberId)
  let sayaclar = sayaclarOf(c, kokNo)
  t.ok(sayaclar.kok && sayaclar[A] && sayaclar[B], 'örnek başına sayaç')
  w.kapat()
  // Vektör 5: A'nın durum dosyası B'nin klasörüne
  const yedek = fs.readFileSync(dizin + '/aileler/' + B + '/durum')
  fs.writeFileSync(dizin + '/aileler/' + B + '/durum', fs.readFileSync(dizin + '/aileler/' + A + '/durum'))
  ;({ w, c } = await ac(t, { dizin, sayaclar }))
  let liste = await c.iste(FAMILIES)
  t.alike(liste.map((x) => [x.aile, x.durum]).sort(), [[A, 'hazir'], [B, 'bozuk'], [kokNo, 'hazir']].sort())
  t.is(liste.find((x) => x.aile === B).hata, V.dosyaTakasi.hata)
  t.ok(c.olaylar.some((x) => x.olay === 'family-error' && x.veri.aile === B && x.veri.hata === 'STATE_CORRUPT'))
  t.is(hex(w.ornek(A).kalici.kimlik.memberId), memberA, 'A açıldı')
  t.is(await hataOf(c.iste(KOMUT.FAMILY_INFO, {}, B)), 'NO_FAMILY', 'bozuk örneğe komut gitmez')
  w.kapat()
  fs.writeFileSync(dizin + '/aileler/' + B + '/durum', yedek)
  ;({ w, c } = await ac(t, { dizin, sayaclar }))
  t.ok((await c.iste(FAMILIES)).every((x) => x.durum === 'hazir'), 'dosya geri konunca B açılır')
  sayaclar = sayaclarOf(c, kokNo)
  w.kapat()
  // Vektör 6: haritada olan A'nın klasörü silinir
  fs.rmSync(dizin + '/aileler/' + A, { recursive: true, force: true })
  ;({ w, c } = await ac(t, { dizin, sayaclar }))
  liste = await c.iste(FAMILIES)
  t.is(liste.find((x) => x.aile === A).durum, 'bozuk')
  t.is(liste.find((x) => x.aile === A).hata, V.silinenOrnek.hata)
  t.ok(c.olaylar.some((x) => x.olay === 'family-error' && x.veri.aile === A && x.veri.hata === 'STATE_ROLLED_BACK'))
  t.ok(liste.find((x) => x.aile === B).durum === 'hazir' && liste.find((x) => x.aile === kokNo).durum === 'hazir', 'B ve kök açılır')
  // Bozuk örnek de sınıra sayılır (üyelik sürüyor)
  t.is(await hataOf(c.iste(FAMILY_ADD, { aileAdi: 'D', benimAdim: 'H' })), 'FAMILY_LIMIT')
})

test('vektör 5 (anahtar): ek örneğin dosyası kökün yerine ya da başka bir ailenin anahtarıyla açılmaz', async (t) => {
  const dizin = geciciDizin(t, 'cf')
  const { w, c } = await ac(t, { dizin })
  await c.iste(FAMILY_ADD, { aileAdi: 'Eser', benimAdim: 'H' })
  const { aile: A } = await c.iste(FAMILY_ADD, { aileAdi: 'A', benimAdim: 'H' })
  w.kapat()
  // Aynı içerik: kökün anahtarıyla ve yoluyla okunamaz (anahtar örnek başına türetilir, AD yolu içerir)
  const kokDepo = new Depo({ dizin: dizin + '/kopya', anahtar: ANAHTAR })
  fs.writeFileSync(dizin + '/kopya/durum', fs.readFileSync(dizin + '/aileler/' + A + '/durum'))
  t.exception(() => kokDepo.oku('durum'), /STATE_CORRUPT/)
  const dogru = new Depo({ dizin: dizin + '/aileler/' + A, anahtar: ANAHTAR, yerelNo: A })
  t.ok(dogru.oku('durum'), 'kendi anahtarı ve yoluyla açılır')
  const baska = new Depo({ dizin: dizin + '/aileler/' + A, anahtar: ANAHTAR, yerelNo: 'cd'.repeat(16) })
  t.exception(() => baska.oku('durum'), /STATE_CORRUPT/)
  t.exception(() => new Depo({ dizin: dizin + '/x', anahtar: ANAHTAR, yerelNo: '../x' }), /INVALID_NAME/)
  kokDepo.kapat(); dogru.kapat(); baska.kapat()
})

test('vektör 9: göç — bugünkü biçimde dizin kök örnek olur; aynı memberId ve sayaç, hiçbir dosya yer değiştirmez', async (t) => {
  const dizin = geciciDizin(t, 'cg')
  let { w, c } = await ac(t, { dizin })
  await c.iste(KOMUT.CREATE_FAMILY, { aileAdi: 'Eser', benimAdim: 'Kerem' })
  const me = hex(w.kalici.kimlik.memberId)
  w.kapat()
  // Durumu bugünkü (D-sürümü, v: 2, yerelNo yok) biçime çevir; sayacı koru
  const depo = new Depo({ dizin, anahtar: ANAHTAR })
  const g = coz(JSON.parse(b4a.toString(depo.oku('durum'))))
  t.is(g.v, 3)
  delete g.yerelNo
  g.v = V.goc.eskiSurum
  depo.yaz('durum', b4a.from(JSON.stringify(kodla(g))))
  depo.kapat()
  const sayac = g.sayac
  const once = dosyalar(dizin)
  ;({ w, c } = await ac(t, { dizin, sayac }))
  t.is(hex(w.kalici.kimlik.memberId), me, 'aynı kimlik')
  t.ok(w.kalici.sayac >= sayac, 'sayaç geri gitmedi')
  t.ok(/^[0-9a-f]{32}$/.test(w.kalici.yerelNo), 'kök örneğe yerelNo verildi')
  t.alike(dosyalar(dizin), once, 'dosya yer değiştirmedi, yeni klasör yok')
  t.ok((await c.iste(KOMUT.FAMILY_INFO)).aile, 'aile çerçevesiz açılır')
  w.kapat()
  const d2 = new Depo({ dizin, anahtar: ANAHTAR })
  const g2 = coz(JSON.parse(b4a.toString(d2.oku('durum'))))
  d2.kapat()
  t.is(g2.v, 3, 'yeni sürümle yazıldı')
  t.is(g2.yerelNo, w.kalici.yerelNo)
})

test('vektör 10: tek düğüm, iki aile — B iki ailede; iki ailede eşitleme aynı anda, kayıtlar aileler arasında geçmez', { timeout: 300000 }, async (t) => {
  const createTestnet = require('hyperdht/testnet')
  const { BoruAgi, bekle: bekleK, yukCarpani } = require('./helpers/multi')
  const tn = await createTestnet(3, t.teardown)
  const ag = new BoruAgi()
  const cihazlar = []
  t.teardown(async () => { for (const x of cihazlar) if (x.canli) await x.kapat().catch(() => {}) })
  const ac3 = async (ad, tohum) => {
    const x = ag.cihaz(ad)
    ag.cevrimdisiYap(ad)
    await x.start({ dizin: geciciDizin(t, 'v10-' + ad), anahtarHex: hex(rastgele(32)), archivePubHex: arsivAnahtari(tohum).pubHex, dht: tn.bootstrap, tekAyar: true, yoklamaMs: 500 })
    cihazlar.push(x)
    return x
  }
  const sure = 60000 * yukCarpani()
  const A = await ac3('A', 61)
  const B = await ac3('B', 62)
  const C = await ac3('C', 63)
  // Tören: davet eden aile kurulu, katılan JOIN; aile: katılanın örneği
  async function toren (davetci, katilan, aileK) {
    await davetci.iste(KOMUT.INVITE_START, { tur: 'uye', rol: 'yetiskin' })
    const qr = (await bekleK(() => davetci.toren('qr'), { neden: 'qr', sure })).qr
    await katilan.iste(KOMUT.JOIN, { kod: qr }, aileK)
    await bekleK(() => davetci.toren('sas') && katilan.toren('sas', aileK), { neden: 'sas', sure })
    await katilan.iste(KOMUT.INVITE_CONFIRM, { ayni: true }, aileK)
    await davetci.iste(KOMUT.INVITE_CONFIRM, { ayni: true })
    await bekleK(() => davetci.toren('tamam') && katilan.toren('tamam', aileK), { neden: 'tören tamam', sure })
  }
  await A.iste(KOMUT.CREATE_FAMILY, { aileAdi: 'Eser', benimAdim: 'Kerem' })
  await C.iste(KOMUT.CREATE_FAMILY, { aileAdi: "Saadet'in evi", benimAdim: 'Saadet' })
  await toren(A, B) // B'nin kök örneği Eser ailesinde
  const { aile: yB } = await B.iste(JOIN_PREPARE)
  const kokB = (await B.iste(FAMILIES)).find((x) => x.kok).aile
  await toren(C, B, yB) // B'nin ek örneği Saadet'in evinde
  const liste = await B.iste(FAMILIES)
  t.alike(liste.map((x) => [x.ad, x.durum]).sort(), [['Eser', 'hazir'], ["Saadet'in evi", 'hazir']])

  const tumOf = async (x, aile) => (await x.iste(KOMUT.RECORD_COLLECTIONS, {}, aile)).find((c) => c.name === 'Tüm Aile').collectionId
  const [tA, tC, tBk, tBy] = [await tumOf(A), await tumOf(C), await tumOf(B, kokB), await tumOf(B, yB)]
  t.is(tBk, tA)
  t.is(tBy, tC)
  // Aynı anda iki ailede yazım ve eşitleme
  const [rA, rC, rB1, rB2] = await Promise.all([
    A.iste(KOMUT.RECORD_PUT, { collectionId: tA, type: 'yuva.defter.not', fields: { baslik: 'A' } }),
    C.iste(KOMUT.RECORD_PUT, { collectionId: tC, type: 'yuva.defter.not', fields: { baslik: 'C' } }),
    B.iste(KOMUT.RECORD_PUT, { collectionId: tBk, type: 'yuva.defter.not', fields: { baslik: 'B-eser' } }, kokB),
    B.iste(KOMUT.RECORD_PUT, { collectionId: tBy, type: 'yuva.defter.not', fields: { baslik: 'B-saadet' } }, yB)
  ])
  const var_ = (x, cid, rid, aile) => x.iste(KOMUT.RECORD_GET, { collectionId: cid, recordId: rid }, aile).catch(() => null)
  await bekleK(async () => (await var_(B, tBk, rA, kokB)) && (await var_(B, tBy, rC, yB)) && (await var_(A, tA, rB1)) && (await var_(C, tC, rB2)), { neden: 'iki ailede eşitleme', sure })
  t.pass('iki ailede eşitleme aynı anda yürüdü')
  // Kayıtlar aileler arasında geçmez
  const basliklar = async (x, cid, aile) => (await x.iste(KOMUT.RECORD_QUERY, { collectionId: cid, type: 'yuva.defter.not' }, aile)).map((r) => r.fields.baslik).sort()
  t.alike(await basliklar(A, tA), ['A', 'B-eser'])
  t.alike(await basliklar(C, tC), ['B-saadet', 'C'])
  t.alike(await basliklar(B, tBk, kokB), ['A', 'B-eser'])
  t.alike(await basliklar(B, tBy, yB), ['B-saadet', 'C'])
  // A'nın defterinde B'nin Saadet'in evindeki kimliği yok (ve tersi)
  const uyeler = async (x, aile) => (await x.iste(KOMUT.MEMBERS, {}, aile)).map((m) => m.memberId || m.id)
  const aUyeler = await uyeler(A)
  const cUyeler = await uyeler(C)
  t.alike(aUyeler.filter((m) => cUyeler.includes(m)), [], 'iki ailenin üye kimlikleri ayrı')

  // §4.5 ayrılma (423): B Eser ailesinden ayrılır; LEAVE A'ya ulaşınca kök sıfırlanır (yeni ailesiz kimlik)
  const eskiB = (await B.iste(KOMUT.FAMILY_INFO, {}, kokB)).me
  t.alike(await B.iste(FAMILY_LEAVE, { aile: kokB }), { durum: 'silinecek' })
  await bekleK(async () => { const k = (await B.iste(FAMILIES)).find((x) => x.kok); return k.aile !== kokB && k.durum === 'ailesiz' }, { neden: 'kök sıfırlandı', sure })
  t.ok(B.olaylar.some((x) => x.olay === 'family-removed' && x.veri.aile === kokB))
  t.is((await B.iste(FAMILIES)).find((x) => x.aile === yB).durum, 'hazir', 'öbür aile sürüyor')
  await bekleK(async () => !(await A.iste(KOMUT.MEMBERS)).some((m) => m.memberId === eskiB), { neden: 'A LEAVE aldı', sure })
  t.pass('LEAVE ulaştı, kök sıfırlandı')
  t.alike([A.hatalar, B.hatalar, C.hatalar], [[], [], []], 'çekirdek hatası yok')
})

test('inceleme 25 madde 1, 5: ek örneğin ilk kalici olayı aile taşır; kökün sayacı haritada doğru; kök yerelNo anahtarı kök sayılır', async (t) => {
  const dizin = geciciDizin(t, 'ch')
  let { w, c } = await ac(t, { dizin })
  const kokNo = w.kalici.yerelNo
  await c.iste(FAMILY_ADD, { aileAdi: 'Eser', benimAdim: 'H' })
  const { aile: y2 } = await c.iste(FAMILY_ADD, { aileAdi: 'Saadet', benimAdim: 'H' })
  const { aile: y3 } = await c.iste(JOIN_PREPARE)
  const ilk = c.olaylar.find((x) => x.olay === 'persisted' && x.aile === y2)
  t.alike(ilk.veri, { sayac: 1 }, 'ek örneğin ilk yazımı kendi ailesiyle')
  t.ok(c.olaylar.some((x) => x.olay === 'persisted' && x.aile === y3), 'katılım örneğinin sayacı da')
  // Kökte bir yazım: çok örnekte kök olayı aile ve kok: true taşır
  const tumK = (await c.iste(KOMUT.RECORD_COLLECTIONS, {}, kokNo)).find((x) => x.name === 'Tüm Aile').collectionId
  await c.iste(KOMUT.RECORD_PUT, { collectionId: tumK, type: 'yuva.defter.not', fields: { baslik: 'k' } }, kokNo)
  const h = sayaclarOf(c, kokNo)
  t.is(h.kok, w.kalici.sayac, 'kökün haritadaki sayacı geriye yazılmadı')
  t.is(h[y2], w.ornek(y2).kalici.sayac)
  t.ok(c.olaylar.some((x) => x.olay === 'persisted' && x.kok === true && x.aile === kokNo), 'çok örnekte kök olayı kok: true')
  w.kapat()
  // Uygulama kökü yerelNo anahtarıyla yazdıysa: kök iki kez listelenmez, bozuk görünmez
  const h2 = { [kokNo]: h.kok, [y2]: h[y2] }
  ;({ w, c } = await ac(t, { dizin, sayaclar: h2 }))
  const liste = await c.iste(FAMILIES)
  t.is(liste.filter((x) => x.aile === kokNo).length, 1)
  t.absent(liste.some((x) => x.durum === 'bozuk'))
  const sk = w.kalici.sayac
  w.kapat()
  // ve geri alma denetimi o anahtarla da yapılır: ek örnek varken kök aile-hata ile durur, ek açılır (madde 6, D93)
  ;({ w, c } = await ac(t, { dizin, sayaclar: { [kokNo]: sk + 5, [y2]: h[y2] } }))
  const l2 = await c.iste(FAMILIES)
  t.alike(l2.find((x) => x.kok), { aile: 'kok', ad: '', rol: null, benimAdim: '', durum: 'bozuk', kok: true, duzey: null, hata: 'STATE_ROLLED_BACK' })
  t.is(l2.find((x) => x.aile === y2).durum, 'hazir')
  t.ok(c.olaylar.some((x) => x.olay === 'family-error' && x.veri.aile === 'kok'))
  t.is(w.kalici, null)
})

test('inceleme 25 madde 2: eşzamanlı 421 ve 422 sırayla işlenir; sınır ve tek katılım aşılmaz, sahipsiz örnek kalmaz', async (t) => {
  const { w, c } = await ac(t, { dizin: geciciDizin(t, 'ci') })
  await c.iste(FAMILY_ADD, { aileAdi: 'Eser', benimAdim: 'H' })
  await c.iste(FAMILY_ADD, { aileAdi: 'Saadet', benimAdim: 'H' })
  const sonuc = await Promise.all([
    c.iste(FAMILY_ADD, { aileAdi: 'A', benimAdim: 'H' }).then(() => 'tamam', (e) => e.message),
    c.iste(FAMILY_ADD, { aileAdi: 'B', benimAdim: 'H' }).then(() => 'tamam', (e) => e.message),
    c.iste(JOIN_PREPARE).then(() => 'tamam', (e) => e.message),
    c.iste(JOIN_PREPARE).then(() => 'tamam', (e) => e.message)
  ])
  t.alike(sonuc, ['tamam', 'FAMILY_LIMIT', 'FAMILY_LIMIT', 'FAMILY_LIMIT'], 'ilk gelen geçer, gerisi sınıra takılır')
  t.is(w.ornekler.size, 3, 'sahipsiz örnek yok')
  t.is((await c.iste(FAMILIES)).length, 3)
  w.kapat()
  // İki aileyle: eşzamanlı iki 422'den biri JOIN_IN_PROGRESS
  const { w: w2, c: c2 } = await ac(t, { dizin: geciciDizin(t, 'cj') })
  await c2.iste(FAMILY_ADD, { aileAdi: 'Eser', benimAdim: 'H' })
  const s2 = await Promise.all([c2.iste(JOIN_PREPARE).then(() => 'tamam', (e) => e.message), c2.iste(JOIN_PREPARE).then(() => 'tamam', (e) => e.message), c2.iste(FAMILY_ADD, { aileAdi: 'C', benimAdim: 'H' }).then(() => 'tamam', (e) => e.message)])
  t.alike(s2, ['tamam', 'JOIN_IN_PROGRESS', 'JOIN_IN_PROGRESS'])
  t.is(w2.ornekler.size, 2)
})

test('inceleme 25 madde 4: katılım sırasında yeniden açılış — silinen örneğin sayac: null olayı bağlanınca gider; sonraki açılışlarda bozuk yok', async (t) => {
  const dizin = geciciDizin(t, 'ck')
  let { w, c } = await ac(t, { dizin })
  const kokNo = w.kalici.yerelNo
  await c.iste(FAMILY_ADD, { aileAdi: 'Eser', benimAdim: 'H' })
  const { aile: y } = await c.iste(JOIN_PREPARE)
  let h = sayaclarOf(c, kokNo)
  t.ok(Number.isSafeInteger(h[y]), 'katılım örneğinin sayacı haritada')
  w.kapat()
  ;({ w, c } = await ac(t, { dizin, sayaclar: h }))
  t.ok(c.olaylar.some((x) => x.olay === 'persisted' && x.aile === y && x.veri.sayac === null), 'açılışta silinen örnek haritadan çıkar')
  t.absent((await c.iste(FAMILIES)).some((x) => x.aile === y))
  h = sayaclarOf(c, kokNo, h)
  t.absent(y in h, 'uygulamanın haritasından çıktı')
  w.kapat()
  for (let i = 0; i < 2; i++) {
    ;({ w, c } = await ac(t, { dizin, sayaclar: h }))
    const liste = await c.iste(FAMILIES)
    t.absent(liste.some((x) => x.durum === 'bozuk'), 'açılış ' + (i + 2) + ': bozuk yok')
    t.absent(c.olaylar.some((x) => x.olay === 'family-error'))
    w.kapat()
  }
})

test('inceleme 25 madde 3, 7, 8: 389 çok örnekte DESTEKLENMIYOR; ek örneğe CREATE_FAMILY FAMILY_EXISTS; başka yoldan aile bağlanan katılım örneği silinmez', async (t) => {
  const createTestnet = require('hyperdht/testnet')
  const tn = await createTestnet(3, t.teardown)
  const { w, c } = await ac(t, { dizin: geciciDizin(t, 'cl'), katilimMs: 300, tasiyici: { deneysel: true, onyukleme: tn.bootstrap, yoklamaMs: 500 } })
  t.not(await hataOf(c.iste(KOMUT.VAULT_ARCHIVE_MOVE, { eskiArchiveKeyHex: ARSIV.skHex, yeniArchivePubHex: arsivAnahtari(1).pubHex })), 'UNSUPPORTED', 'tek örnekte ürüne gider')
  await c.iste(FAMILY_ADD, { aileAdi: 'Eser', benimAdim: 'H' })
  const { aile: y2 } = await c.iste(FAMILY_ADD, { aileAdi: 'Saadet', benimAdim: 'H' })
  t.is(await hataOf(c.iste(KOMUT.VAULT_ARCHIVE_MOVE, { eskiArchiveKeyHex: ARSIV.skHex, yeniArchivePubHex: arsivAnahtari(1).pubHex }, y2)), 'UNSUPPORTED')
  t.is(await hataOf(c.iste(KOMUT.CREATE_FAMILY, { aileAdi: 'X', benimAdim: 'H' }, y2)), 'FAMILY_EXISTS')
  const { aile: y3 } = await c.iste(JOIN_PREPARE)
  // Ürün aileyi c.kalici üstünden doğrudan bağlarsa (c.aileBagla dışından): zamanlayıcı aileyi silmez
  const S = require('@havenfold/sdk')
  const { identity: { createIdentity }, ledger: { Ledger } } = require('@havenfold/core')
  const o3 = w.ornek(y3)
  const L = S.LedgerApi.createFamily({ Ledger, me: o3.kalici.kimlik, displayName: 'H', familyName: 'Yeni' }).ledger
  void createIdentity
  o3.kalici.aileBagla(L)
  await bekle(600)
  t.ok(w.ornek(y3), 'aile bağlanmış örnek silinmedi')
  t.is((await c.iste(FAMILIES)).find((x) => x.aile === y3).durum, 'hazir')
})

test('vektör 8 (D93): yarım kalan silme açılışta tamamlanır (ek örnek ve kök)', async (t) => {
  const dizin = geciciDizin(t, 'cm')
  let { w, c } = await ac(t, { dizin })
  const kokNo = w.kalici.yerelNo
  await c.iste(FAMILY_ADD, { aileAdi: 'Eser', benimAdim: 'H' })
  const { aile: A } = await c.iste(FAMILY_ADD, { aileAdi: 'A', benimAdim: 'H' })
  const me0 = hex(w.kalici.kimlik.memberId)
  const h = sayaclarOf(c, kokNo)
  w.kapat()
  // A: işaret yazılmış, dosyalar yarım
  fs.writeFileSync(dizin + '/aileler/' + A + '/silinecek', JSON.stringify({ asama: 'siliniyor' }))
  fs.unlinkSync(dizin + '/aileler/' + A + '/kimlik')
  ;({ w, c } = await ac(t, { dizin, sayaclar: h }))
  t.absent((await c.iste(FAMILIES)).some((x) => x.aile === A), V.yarimSilme.aciklama)
  t.absent(fs.existsSync(dizin + '/aileler/' + A), 'klasör gitti')
  t.ok(c.olaylar.some((x) => x.olay === 'persisted' && x.aile === A && x.veri.sayac === null))
  t.is(hex(w.kalici.kimlik.memberId), me0, 'kök aynı')
  w.kapat()
  // Kök: işaret yazılmış → kök sıfırlanır, yeni ailesiz kimlik
  fs.writeFileSync(dizin + '/silinecek', JSON.stringify({ asama: 'siliniyor' }))
  ;({ w, c } = await ac(t, { dizin }))
  t.unlike(hex(w.kalici.kimlik.memberId), me0)
  t.absent(w.kalici.nesneler.aile)
  t.absent(fs.existsSync(dizin + '/silinecek'))
})

test('vektör 15 (D93): kasa kilidi örnek başına — A\'da UNLOCK B\'nin kasasını açmaz', async (t) => {
  const { c } = await ac(t, { dizin: geciciDizin(t, 'cn') })
  await c.iste(FAMILY_ADD, { aileAdi: 'A', benimAdim: 'H' })
  const kokNo = (await c.iste(FAMILIES))[0].aile
  const { aile: B } = await c.iste(FAMILY_ADD, { aileAdi: 'B', benimAdim: 'H' })
  t.ok((await c.iste(KOMUT.VAULT_STATUS, {}, kokNo)).kilitli && (await c.iste(KOMUT.VAULT_STATUS, {}, B)).kilitli, 'ikisi de kilitli başlar')
  await c.iste(KOMUT.UNLOCK, { archiveKeyHex: ARSIV.skHex }, kokNo)
  t.absent((await c.iste(KOMUT.VAULT_STATUS, {}, kokNo)).kilitli, 'A açıldı')
  t.ok((await c.iste(KOMUT.VAULT_STATUS, {}, B)).kilitli, V.kasa.aciklama)
  await c.iste(KOMUT.LOCK, {}, kokNo)
  t.ok((await c.iste(KOMUT.VAULT_STATUS, {}, kokNo)).kilitli)
})

test('423, 424 (D93): ayrılma işareti ve 72 saat; yerel silme kuralları (MEMBERSHIP_IN_PROGRESS, bozuk, katılım, kök sıfırlama)', async (t) => {
  const dizin = geciciDizin(t, 'co')
  const saat = { t: Date.now() }
  let { w, c } = await ac(t, { dizin, now: () => saat.t })
  const kokNo = w.kalici.yerelNo
  await c.iste(FAMILY_ADD, { aileAdi: 'Eser', benimAdim: 'H' })
  const { aile: A } = await c.iste(FAMILY_ADD, { aileAdi: 'A', benimAdim: 'H' })
  t.is(await hataOf(c.iste(FAMILY_LOCAL_REMOVE, { aile: A })), 'MEMBERSHIP_IN_PROGRESS')
  t.is(await hataOf(c.iste(FAMILY_LEAVE, { aile: 'ab'.repeat(16) })), 'NO_FAMILY')
  // Ağ yok: LEAVE kimseye ulaşmaz; örnek 'silinecek' kalır
  t.alike(await c.iste(FAMILY_LEAVE, { aile: A }), { durum: 'silinecek' })
  t.alike(await c.iste(FAMILY_LEAVE, { aile: A }), { durum: 'silinecek' }, 'ikinci kez de aynı')
  t.is((await c.iste(FAMILIES)).find((x) => x.aile === A).durum, 'silinecek')
  const isaret = JSON.parse(fs.readFileSync(dizin + '/aileler/' + A + '/silinecek'))
  t.is(isaret.asama, 'bekliyor')
  let h = sayaclarOf(c, kokNo)
  w.kapat()
  // Yeniden açılışta da silinecek; 72 saat geçince silinir
  ;({ w, c } = await ac(t, { dizin, sayaclar: h, now: () => saat.t }))
  t.is((await c.iste(FAMILIES)).find((x) => x.aile === A).durum, 'silinecek', 'işaret açılışta okunur')
  h = sayaclarOf(c, kokNo, h)
  w.kapat()
  saat.t += 72 * 3_600_000 + 1
  ;({ w, c } = await ac(t, { dizin, sayaclar: h, now: () => saat.t }))
  t.absent((await c.iste(FAMILIES)).some((x) => x.aile === A), '72 saat sonra silindi')
  t.ok(c.olaylar.some((x) => x.olay === 'family-removed' && x.veri.aile === A))
  h = sayaclarOf(c, kokNo, h)
  t.absent(A in h)
  // Katılım örneği 424 ile silinir
  const { aile: K } = await c.iste(JOIN_PREPARE)
  t.is(await c.iste(FAMILY_LOCAL_REMOVE, { aile: K }), null)
  t.absent(w.ornek(K))
  // Bozuk örnek 424 ile silinir
  const { aile: B } = await c.iste(FAMILY_ADD, { aileAdi: 'B', benimAdim: 'H' })
  h = sayaclarOf(c, kokNo, h)
  w.kapat()
  fs.writeFileSync(dizin + '/aileler/' + B + '/durum', b4a.alloc(40, 1))
  ;({ w, c } = await ac(t, { dizin, sayaclar: h, now: () => saat.t }))
  t.is((await c.iste(FAMILIES)).find((x) => x.aile === B).durum, 'bozuk')
  t.is(await c.iste(FAMILY_LOCAL_REMOVE, { aile: B }), null)
  t.absent((await c.iste(FAMILIES)).some((x) => x.aile === B))
  t.absent(fs.existsSync(dizin + '/aileler/' + B))
  // Kök örnekte ayrılma: kimseye ulaşmadan 424 ile kişi beklemeden siler → kök sıfırlanır
  const me0 = hex(w.kalici.kimlik.memberId)
  await c.iste(FAMILY_LEAVE, { aile: w.kalici.yerelNo })
  await c.iste(FAMILY_LOCAL_REMOVE, { aile: w.kalici.yerelNo })
  t.unlike(hex(w.kalici.kimlik.memberId), me0, 'kök yeni kimlikle')
  t.absent(w.kalici.nesneler.aile)
  t.is(await hataOf(c.iste(FAMILY_LOCAL_REMOVE, { aile: w.kalici.yerelNo })), 'MEMBERSHIP_IN_PROGRESS', 'ailesiz kökte silinecek yok')
  t.ok(await c.iste(FAMILY_ADD, { aileAdi: 'Yeni', benimAdim: 'H' }), 'sıfırlanan kökte yeni aile kurulur')
})

test('vektör 7 (D93): bir ailede silmeli çıkarılma yalnız o örneği siler; öbür örneğin dosyaları ve sayacı değişmez', async (t) => {
  const { ledger: { Ledger, genesisEvent }, identity: { createIdentity } } = require('@havenfold/core')
  const { ekle, at } = require('../../core/core/test/helpers/ledger')
  const { tur, seviye } = require('../../core/core/test/helpers/v21')
  const dizin = geciciDizin(t, 'cp')
  const { w, c } = await ac(t, { dizin })
  await c.iste(FAMILY_ADD, { aileAdi: 'Eser', benimAdim: 'H' })
  const kokNo = w.kalici.yerelNo
  // Saadet'in evi: kurucu Saadet, bu telefonun katılım örneği yetişkin olarak eklenir (törenle gelen defter gibi)
  const { aile: y } = await c.iste(JOIN_PREPARE)
  const ben = Object.assign({}, w.ornek(y).kalici.kimlik, { ad: 'Hüsniye' })
  const saadet = Object.assign(createIdentity({ seed: 'coklu-aile/saadet-7', platform: 'test' }), { ad: 'Saadet' })
  const L = new Ledger()
  L.apply(genesisEvent(saadet, { familyName: "Saadet'in evi", displayName: 'Saadet', ts: Date.now() - 60_000 }))
  L.apply(tur(L, 'aile', [saadet]))
  L.apply(ekle(L, ben, 'yetiskin', [saadet]))
  L.apply(seviye(L, [saadet]))
  w.ornek(y).c.aileBagla(L)
  t.is((await c.iste(FAMILIES)).find((x) => x.aile === y).durum, 'hazir')
  const sayacOnce = w.kalici.sayac
  const kokDurum = fs.readFileSync(dizin + '/durum')
  // Saadet bu kimliği silmeli çıkarır; olay eşitlemeyle gelir
  const e = at(L, ben, [saadet])
  const n = w.ornek(y).kalici.nesneler
  const { encodeEvent, decodeEvent } = require('@havenfold/core').ledger
  n.ledger.apply(decodeEvent(encodeEvent(e)))
  n.defter.changed()
  await kosul(() => !w.ornek(y))
  t.pass(V.cikarilma.aciklama)
  t.absent(fs.existsSync(dizin + '/aileler/' + y), 'klasör silindi')
  t.ok(c.olaylar.some((x) => x.olay === 'family-removed' && x.veri.aile === y))
  t.ok(c.olaylar.some((x) => x.olay === 'persisted' && x.aile === y && x.veri.sayac === null))
  t.is(w.kalici.sayac, sayacOnce, 'kökün sayacı değişmedi')
  t.alike(fs.readFileSync(dizin + '/durum'), kokDurum, 'kökün durumu bayt bayt aynı')
  t.is((await c.iste(FAMILIES)).map((x) => x.aile).join(), kokNo)
})

test('vektör 3 ve 4 (D93, yerel kanal): FAMILIES familyId ve kimlik; başka uygulamaların aileleri 3 sınırına ve famHint denetimine girer', async (t) => {
  const createTestnet = require('hyperdht/testnet')
  const { qrKodla } = require('@havenfold/transport/ceremony')
  const tn = await createTestnet(3, t.teardown)
  const diger = ['d1'.repeat(32)]
  const { w, c } = await ac(t, { dizin: geciciDizin(t, 'cq'), yerelAileler: () => diger, tasiyici: { deneysel: true, onyukleme: tn.bootstrap, yoklamaMs: 500 } })
  await c.iste(FAMILY_ADD, { aileAdi: 'Eser', benimAdim: 'H' })
  const k = (await c.iste(FAMILIES))[0]
  t.is(k.familyId, hex(w.kalici.nesneler.ledger.familyId), 'aile listesi için familyId (uygulama içi)')
  t.is(k.kimlik, 'ana', 'bu ailede ilk uygulama: ana kimlik')
  // Bu uygulamanın 1 + öbür uygulamanın 1 ailesi: bir aile daha kurulabilir, sonra sınır
  diger.push(k.familyId) // öbür uygulama da Eser'de: iki kez sayılmaz
  await c.iste(FAMILY_ADD, { aileAdi: 'Saadet', benimAdim: 'H' })
  t.is(await hataOf(c.iste(FAMILY_ADD, { aileAdi: 'X', benimAdim: 'H' })), V.sinir.hata, 'yerel kanaldaki aile de sayılır')
  t.is(await hataOf(c.iste(JOIN_PREPARE)), 'FAMILY_LIMIT')
  // Öbür uygulama ailesinden çıkınca yer açılır
  diger.length = 0
  const { aile: y } = await c.iste(JOIN_PREPARE)
  // QR'daki aile başka bir Eser uygulamasında varsa (aynı kişi o aileye RFC-0017 eşleşmesiyle girer): FAMILY_EXISTS
  diger.push('e5'.repeat(32))
  const qr = qrKodla({ kind: 0, famHint: b4a.from('e5'.repeat(8), 'hex'), inv: rastgele(16), rv: rastgele(32), sec: rastgele(16), exp: Math.ceil(Date.now() / 1000) + 600 })
  t.is(await hataOf(c.iste(KOMUT.JOIN, { kod: qr }, y)), 'FAMILY_EXISTS')
  t.absent(w.ornek(y), 'katılım örneği silindi')
})

test('vektör 12, 13 (D94, K1): çocuk telefon ancak ebeveyn izniyle yeni aileye girer; izin tek kullanımlık, süreli; 425; kutu rolü', async (t) => {
  const S = require('@havenfold/sdk')
  const { ledger: { Ledger, encodeEvent, decodeEvent }, identity: { createIdentity } } = require('@havenfold/core')
  const { Replika } = require('@havenfold/records')
  const { ekle, TS0 } = require('../../core/core/test/helpers/ledger')
  const { teslim } = require('../../core/records/test/helpers/family')
  const kim = (ad) => Object.assign(createIdentity({ seed: 'coklu-aile/k1-' + ad, platform: 'test' }), { ad })
  const kopya = (L) => { const K = new Ledger(); for (const e of L.events) K.apply(decodeEvent(encodeEvent(e))); return K }
  const saat = { t: TS0 + 86_400_000 }
  const IZINLI = 425
  // Telefon Eser ailesinde çocuk (kökte); Kerem ebeveyn, İrem yetişkin
  let { w, c } = await ac(t, { dizin: geciciDizin(t, 'cr'), now: () => saat.t })
  const ben = Object.assign({}, w.kalici.kimlik, { ad: 'Ecem' })
  const meHex = hex(ben.memberId)
  const P = kim('Kerem')
  const Y = kim('İrem')
  const { ledger: L } = S.LedgerApi.createFamily({ Ledger, me: P, familyName: 'Eser', displayName: 'Kerem', ts: TS0 })
  L.apply(ekle(L, ben, 'cocuk', [P]))
  L.apply(ekle(L, Y, 'yetiskin', [P]))
  w.aileBagla(kopya(L))
  const n = w.kalici.nesneler
  const cid = require('@havenfold/core').v23.tumAileOf(n.ledger)
  // Ebeveynin ya da yetişkinin yazdığı izin, onların replikasından eşitlemeyle gelir
  const yaz = (kimlik, alanlar) => {
    const r = new Replika({ ledger: kopya(L), me: kimlik, now: () => saat.t })
    r.sync()
    const id = new S.EventApi({ kayit: new S.RecordApi({ replika: r }), now: () => saat.t }).write(cid, 'hf.aile-izni', { t: saat.t, ...alanlar })
    teslim(r, n.replika)
    n.replika.sync()
    return id
  }
  t.is(await hataOf(c.iste(JOIN_PREPARE)), V.cocuk[0].hata, 'izinsiz')
  t.is(await hataOf(c.iste(FAMILY_ADD, { aileAdi: 'Benim', benimAdim: 'Ecem' })), 'FAMILY_PERMISSION_REQUIRED', 'aile kurma da')
  t.is(await hataOf(c.iste(IZINLI, { cocukId: meHex, saat: 24 })), 'PARENT_REQUIRED', 'çocuk izin yazamaz')
  yaz(Y, { subj: 'uye:' + meHex, gecerli: saat.t + 3_600_000 })
  t.is(await hataOf(c.iste(JOIN_PREPARE)), 'FAMILY_PERMISSION_REQUIRED', V.cocuk[3].aciklama)
  yaz(P, { subj: 'uye:' + meHex, gecerli: saat.t + 8 * 86_400_000 })
  t.is(await hataOf(c.iste(JOIN_PREPARE)), 'FAMILY_PERMISSION_REQUIRED', '7 günden uzun izin geçersiz')
  yaz(P, { subj: 'uye:' + meHex, gecerli: saat.t + 3_600_000 })
  const { aile: y } = await c.iste(JOIN_PREPARE)
  t.ok(y, V.cocuk[1].aciklama)
  await c.iste(FAMILY_LOCAL_REMOVE, { aile: y })
  t.is(await hataOf(c.iste(JOIN_PREPARE)), 'FAMILY_PERMISSION_REQUIRED', V.cocuk[1].tekKullanim)
  yaz(P, { subj: 'uye:' + meHex, gecerli: saat.t + 3_600_000 })
  saat.t += 2 * 3_600_000
  t.is(await hataOf(c.iste(JOIN_PREPARE)), 'FAMILY_PERMISSION_REQUIRED', V.cocuk[2].aciklama)
  w.kapat()

  // 425: ebeveyn izin yazar (en çok 7 gün); çocuk olmayan üyeye ya da sınır dışı süreye yok
  ;({ w, c } = await ac(t, { dizin: geciciDizin(t, 'cs'), now: () => saat.t }))
  const ebeveyn = Object.assign({}, w.kalici.kimlik, { ad: 'Kerem' })
  const cocuk = kim('Ecem2')
  const { ledger: L2 } = S.LedgerApi.createFamily({ Ledger, me: ebeveyn, familyName: 'Eser', displayName: 'Kerem', ts: TS0 })
  L2.apply(ekle(L2, cocuk, 'cocuk', [ebeveyn]))
  L2.apply(ekle(L2, Y, 'yetiskin', [ebeveyn]))
  w.aileBagla(L2)
  const { recordId } = await c.iste(IZINLI, { cocukId: hex(cocuk.memberId), saat: 24 })
  const cid2 = require('@havenfold/core').v23.tumAileOf(w.kalici.nesneler.ledger)
  const kayit = await c.iste(KOMUT.RECORD_GET, { collectionId: cid2, recordId })
  t.is(kayit.type, 'hf.aile-izni')
  t.is(kayit.fields._subj, 'uye:' + hex(cocuk.memberId))
  t.is(kayit.fields.gecerli, saat.t + 24 * 3_600_000)
  t.is(await hataOf(c.iste(IZINLI, { cocukId: hex(cocuk.memberId), saat: 24 * 7 + 1 })), 'INVALID_BODY')
  t.is(await hataOf(c.iste(IZINLI, { cocukId: hex(Y.memberId), saat: 24 })), 'NOT_CHILD')
  w.kapat()

  // Vektör 13: defterde rolü kutu olan telefon ikinci aileye giremez
  ;({ w, c } = await ac(t, { dizin: geciciDizin(t, 'ct'), now: () => saat.t }))
  const kutu = Object.assign({}, w.kalici.kimlik, { ad: 'Kutu' })
  const { ledger: L3 } = S.LedgerApi.createFamily({ Ledger, me: P, familyName: 'Eser', displayName: 'Kerem', ts: TS0 })
  L3.apply(ekle(L3, kutu, 'kutu', [P]))
  w.aileBagla(L3)
  t.is(await hataOf(c.iste(FAMILY_ADD, { aileAdi: 'B', benimAdim: 'K' })), V.cihazRolu.hata)
  t.is(await hataOf(c.iste(JOIN_PREPARE)), 'DEVICE_SINGLE_COMMUNITY')
})

test('inceleme 25 madde 3 (yeniden inceleme): 389 sonrası açılan örnek yeni arşiv anahtarını alır; 389 ile 421 sırayla işlenir', async (t) => {
  const YENI = arsivAnahtari(93)
  const dizin = geciciDizin(t, 'cu')
  let { w, c } = await ac(t, { dizin })
  await c.iste(FAMILY_ADD, { aileAdi: 'Eser', benimAdim: 'H' })
  // Tek örnekte taşıma, sonra 421: yeni örnek yeni açık anahtarla
  await c.iste(KOMUT.VAULT_ARCHIVE_MOVE, { eskiArchiveKeyHex: ARSIV.skHex, yeniArchivePubHex: YENI.pubHex })
  t.is(hex(w.kalici.arsivPub), YENI.pubHex, 'kök taşındı')
  const { aile: y } = await c.iste(FAMILY_ADD, { aileAdi: 'Saadet', benimAdim: 'H' })
  t.is(hex(w.ornek(y).kalici.arsivPub), YENI.pubHex, '389 sonrası açılan örnek yeni anahtarla')
  const h = sayaclarOf(c, w.kalici.yerelNo)
  w.kapat()
  // Uygulama yeni anahtarla yeniden başlar: bütün örnekler açılır
  const ipc = ipcCifti()
  c = istemci(ipc)
  w = await start({ urunSunucusu, dizin, anahtar: ANAHTAR, archivePubHex: YENI.pubHex, sayaclar: h, ipc, appId: 'ornek' })
  t.teardown(() => w.kapat())
  t.ok((await c.iste(FAMILIES)).every((x) => x.durum === 'hazir'), 'yeni anahtarla yeniden açılışta bozuk örnek yok')
  w.kapat()

  // Eşzamanlı 389 ve 421: kuyrukta sırayla; 389 önce gelirse ikisi de geçer ve yeni örnek yeni anahtarı alır
  const dizin2 = geciciDizin(t, 'cv')
  ;({ w, c } = await ac(t, { dizin: dizin2 }))
  await c.iste(FAMILY_ADD, { aileAdi: 'Eser', benimAdim: 'H' })
  const [r1, r2] = await Promise.all([
    c.iste(KOMUT.VAULT_ARCHIVE_MOVE, { eskiArchiveKeyHex: ARSIV.skHex, yeniArchivePubHex: YENI.pubHex }).then(() => 'tamam', (e) => e.message),
    c.iste(FAMILY_ADD, { aileAdi: 'Saadet', benimAdim: 'H' }).then((x) => x.aile, (e) => e.message)
  ])
  t.is(r1, 'tamam')
  t.is(hex(w.ornek(r2).kalici.arsivPub), YENI.pubHex, 'taşımadan sonra açıldı')
  // Ters sıra: 421 önce gelirse 389 iki örnek görür ve DESTEKLENMIYOR
  const [r3, r4] = await Promise.all([
    c.iste(FAMILY_ADD, { aileAdi: 'Üç', benimAdim: 'H' }).then(() => 'tamam', (e) => e.message),
    c.iste(KOMUT.VAULT_ARCHIVE_MOVE, { eskiArchiveKeyHex: YENI.skHex, yeniArchivePubHex: ARSIV.pubHex }).then(() => 'tamam', (e) => e.message)
  ])
  t.alike([r3, r4], ['tamam', 'UNSUPPORTED'])
  t.ok([...w.ornekler.values()].every((o) => hex(o.kalici.arsivPub) === YENI.pubHex), 'hiçbir örnek ayrışmadı')
})

// Açılış öncesi bağımsız inceleme (25 Ekim 2026): izin, aile sınırı ve cihaz denetimi kökün boş olduğu yollarda da;
// izin kaydını çocuk değiştiremez
function cocukAilesi (S, ben, saat) {
  const { ledger: { Ledger, encodeEvent, decodeEvent }, identity: { createIdentity } } = require('@havenfold/core')
  const { ekle, TS0 } = require('../../core/core/test/helpers/ledger')
  const kim = (ad) => Object.assign(createIdentity({ seed: 'coklu-aile/acilis-' + ad, platform: 'test' }), { ad })
  const kopya = (L) => { const K = new Ledger(); for (const e of L.events) K.apply(decodeEvent(encodeEvent(e))); return K }
  const P = kim('Ebeveyn')
  const { ledger: L } = S.LedgerApi.createFamily({ Ledger, me: P, familyName: 'F', displayName: 'Ebeveyn', ts: TS0 })
  L.apply(ekle(L, ben, 'cocuk', [P]))
  return { L, P, kopya, saat }
}
function izinYaz (S, { L, P, kopya, saat }, n, alanlar) {
  const { Replika } = require('@havenfold/records')
  const { teslim } = require('../../core/records/test/helpers/family')
  const cid = require('@havenfold/core').v23.tumAileOf(n.ledger)
  const r = new Replika({ ledger: kopya(L), me: P, now: () => saat.t })
  r.sync()
  const id = new S.EventApi({ kayit: new S.RecordApi({ replika: r }), now: () => saat.t }).write(cid, 'hf.aile-izni', { t: saat.t, ...alanlar })
  teslim(r, n.replika)
  n.replika.sync()
  return { id, cid }
}

test('açılış incelemesi 1: kök sıfırlanınca çocuk telefon izinsiz aile kuramaz, katılamaz; CREATE_FAMILY ve doğrudan bağlama da', async (t) => {
  const S = require('@havenfold/sdk')
  const { TS0 } = require('../../core/core/test/helpers/ledger')
  const saat = { t: TS0 + 86_400_000 }
  const { w, c } = await ac(t, { dizin: geciciDizin(t, 'cx'), now: () => saat.t })
  // Kökte yetişkin olarak bir aile; ek örnekte çocuk olarak F ailesi
  await c.iste(FAMILY_ADD, { aileAdi: 'Eser', benimAdim: 'H' })
  const { aile: y } = await c.iste(JOIN_PREPARE)
  const o = w.ornek(y)
  const F = cocukAilesi(S, Object.assign({}, o.kalici.kimlik, { ad: 'Ecem' }), saat)
  o.c.aileBagla(F.kopya(F.L))
  // Kök aileden ayrılır ve sıfırlanır: kök boş, telefon F'de hâlâ çocuk
  await c.iste(FAMILY_LEAVE, { aile: w.kalici.yerelNo })
  await c.iste(FAMILY_LOCAL_REMOVE, { aile: w.kalici.yerelNo })
  t.absent(w.kalici.nesneler.aile, 'kök boş')
  const kokNo = (await c.iste(FAMILIES)).find((x) => !x.familyId)?.aile ?? null
  t.is(await hataOf(c.iste(FAMILY_ADD, { aileAdi: 'Benim', benimAdim: 'Ecem' })), 'FAMILY_PERMISSION_REQUIRED', '421 kök yolu')
  t.is(await hataOf(c.iste(KOMUT.CREATE_FAMILY, { aileAdi: 'Benim', benimAdim: 'Ecem' }, kokNo)), 'FAMILY_PERMISSION_REQUIRED', 'CREATE_FAMILY doğrudan')
  t.is(await hataOf(c.iste(JOIN_PREPARE)), 'FAMILY_PERMISSION_REQUIRED', '422 kök yolu')
  const { ledger: { Ledger } } = require('@havenfold/core')
  const baska = S.LedgerApi.createFamily({ Ledger, me: w.kalici.kimlik, familyName: 'B', displayName: 'Ecem', ts: TS0 }).ledger
  t.exception(() => w.aileBagla(baska), /FAMILY_PERMISSION_REQUIRED/, 'törenle bağlanma')
  t.exception(() => w.kalici.aileBagla(baska), /FAMILY_PERMISSION_REQUIRED/, 'ürünün c.kalici üstünden bağlaması')
  t.absent(w.kalici.nesneler.aile, 'hiçbir yol aile bağlamadı')
  // Ebeveyn izin verince kurulur; izin tek kullanımlık
  izinYaz(S, F, o.kalici.nesneler, { subj: 'uye:' + hex(o.kalici.kimlik.memberId), gecerli: saat.t + 3_600_000 })
  t.ok(await c.iste(FAMILY_ADD, { aileAdi: 'Benim', benimAdim: 'Ecem' }), 'izinle kökte aile kurulur')
  t.ok(w.kalici.nesneler.aile)
  t.is(await hataOf(c.iste(JOIN_PREPARE)), 'FAMILY_PERMISSION_REQUIRED', 'izin kullanıldı')
})

test('açılış incelemesi 1: başka uygulamada 3 aile varken boş kökte aile kurulamaz (FAMILY_LIMIT); cihaz platformu ilk topluluğuna girer', async (t) => {
  const diger = ['d1'.repeat(32), 'd2'.repeat(32), 'd3'.repeat(32)]
  const { w, c } = await ac(t, { dizin: geciciDizin(t, 'cy'), yerelAileler: () => diger })
  t.is(await hataOf(c.iste(FAMILY_ADD, { aileAdi: 'X', benimAdim: 'H' })), 'FAMILY_LIMIT')
  t.is(await hataOf(c.iste(KOMUT.CREATE_FAMILY, { aileAdi: 'X', benimAdim: 'H' })), 'FAMILY_LIMIT')
  t.is(await hataOf(c.iste(JOIN_PREPARE)), 'FAMILY_LIMIT')
  t.absent(w.kalici.nesneler.aile)
  diger.pop()
  t.ok(await c.iste(FAMILY_ADD, { aileAdi: 'X', benimAdim: 'H' }), 'yer açılınca kurulur')
  w.kapat()
  // Kutu platformundaki telefon: ilk topluluğuna katılır (aile yokken cihaz kuralı engellemez)
  const k = await ac(t, { dizin: geciciDizin(t, 'cz'), platform: 'kutu' })
  t.alike(await k.c.iste(JOIN_PREPARE), { aile: k.w.kalici.yerelNo })
})

test('açılış incelemesi 2: çocuk ebeveynin süresi dolmuş iznini uzatamaz (izin kaydının bütün işlemleri ebeveynin)', async (t) => {
  const S = require('@havenfold/sdk')
  const { TS0 } = require('../../core/core/test/helpers/ledger')
  const saat = { t: TS0 + 86_400_000 }
  const { w, c } = await ac(t, { dizin: geciciDizin(t, 'cw'), now: () => saat.t })
  const ben = Object.assign({}, w.kalici.kimlik, { ad: 'Ecem' })
  const F = cocukAilesi(S, ben, saat)
  w.aileBagla(F.kopya(F.L))
  const n = w.kalici.nesneler
  const { id, cid } = izinYaz(S, F, n, { subj: 'uye:' + hex(ben.memberId), gecerli: saat.t + 3_600_000 })
  saat.t += 2 * 3_600_000
  t.is(await hataOf(c.iste(JOIN_PREPARE)), 'FAMILY_PERMISSION_REQUIRED', 'süresi doldu')
  // Çocuk kaydın gecerli alanını değiştirir (Tüm Aile'ye yazabilir)
  await c.iste(KOMUT.RECORD_PUT, { collectionId: cid, recordId: id, fields: { gecerli: saat.t + 3_600_000 } })
  t.is((await c.iste(KOMUT.RECORD_GET, { collectionId: cid, recordId: id })).fields.gecerli, saat.t + 3_600_000, 'birleşmiş alan uzadı')
  t.is(await hataOf(c.iste(JOIN_PREPARE)), 'FAMILY_PERMISSION_REQUIRED', 'çocuğun değiştirdiği izin sayılmaz')
})

test('açılış incelemesi ORTA 2: ayrılma bekliyorken taşıyıcı LEAVE öncesi defteri görür (çevrimdışı ayrılan telefon LEAVE\'i taşıyacak oturumu kurabilir)', async (t) => {
  const S = require('@havenfold/sdk')
  const { ledger: { Ledger }, identity: { createIdentity } } = require('@havenfold/core')
  const { PairBook } = require('../../core/core/core/pairs')
  const { ekle, TS0 } = require('../../core/core/test/helpers/ledger')
  const { w, c } = await ac(t, { dizin: geciciDizin(t, 'cv'), now: () => TS0 + 1000 })
  const ben = Object.assign({}, w.kalici.kimlik, { ad: 'Ben' })
  const P = Object.assign(createIdentity({ seed: 'coklu-aile/acilis-leave-P', platform: 'test' }), { ad: 'P' })
  const { ledger: L } = S.LedgerApi.createFamily({ Ledger, me: P, familyName: 'F', displayName: 'P', ts: TS0 })
  L.apply(ekle(L, ben, 'yetiskin', [P]))
  w.aileBagla(L)
  const meHex = hex(ben.memberId)
  const once = new PairBook({ me: w.tasiyiciCihazi().kimlik, ledger: w.tasiyiciCihazi().ledger }).peers().length
  t.is(once, 1, 'ayrılmadan önce bir eş')
  t.alike(await c.iste(FAMILY_LEAVE, { aile: w.kalici.yerelNo }), { durum: 'silinecek' })
  const gercek = w.kalici.nesneler.ledger
  t.is(gercek.sessionRole(meHex), null, 'gerçek defterde LEAVE uygulandı')
  const d = w.tasiyiciCihazi()
  t.is(d.ledger.sessionRole(meHex), 'uye', 'taşıyıcının görünümünde hâlâ üye')
  t.is(d.ledger.len, gercek.len - 1, 'görünüm yalnız LEAVE öncesi')
  t.is(new PairBook({ me: d.kimlik, ledger: d.ledger }).peers().length, 1, 'eş listesi boşalmadı')
  t.is(w.tasiyiciCihazi().ledger, d.ledger, 'görünüm defter uzamadıkça aynı nesne')
})

test('açılış incelemesi ORTA 2: LEAVE sokete yazılınca değil, karşı tarafın yankısıyla ulaşmış sayılır', async (t) => {
  const S = require('@havenfold/sdk')
  const { ledger: { Ledger, encodeEvent }, identity: { createIdentity }, sync, zarf: { Z } } = require('@havenfold/core')
  const { ekle, TS0 } = require('../../core/core/test/helpers/ledger')
  const giden = []
  let isl = null
  const ag = { gonder: (p, type, bytes) => { giden.push({ p, type, bytes }); return true }, dinle: (x) => { isl = x } }
  const { w, c } = await ac(t, { dizin: geciciDizin(t, 'cu'), ag })
  const ben = Object.assign({}, w.kalici.kimlik, { ad: 'Ben' })
  const P = Object.assign(createIdentity({ seed: 'coklu-aile/acilis-yanki-P', platform: 'test' }), { ad: 'P' })
  const { ledger: L } = S.LedgerApi.createFamily({ Ledger, me: P, familyName: 'F', displayName: 'P', ts: TS0 })
  L.apply(ekle(L, ben, 'yetiskin', [P]))
  w.aileBagla(L)
  const pHex = hex(P.memberId)
  isl.baglandi(pHex)
  const kokNo = w.kalici.yerelNo
  await c.iste(FAMILY_LEAVE, { aile: kokNo })
  t.ok(giden.some((x) => x.p === pHex && x.type === Z.LEDGER_EVENTS), 'LEAVE eşe yazıldı')
  await bekle(3500)
  t.is((await c.iste(FAMILIES)).find((x) => x.kok).durum, 'silinecek', 'yalnız yazmak yetmez: örnek silinmedi')
  // Karşı taraf LEAVE'i defterine alıp geri gönderir (yankı)
  const R = w.kalici.nesneler.ledger
  const seq = R.members.get(hex(ben.memberId)).removedSeq
  isl.al(pHex, Z.LEDGER_EVENTS, sync.encodeEvents({ fromSeq: seq, events: [encodeEvent(R.events[seq])] }))
  // Kök sıfırlanırken FAMILIES bir an kökü göstermeyebilir
  await kosul(async () => (await c.iste(FAMILIES)).find((x) => x.kok)?.durum === 'ailesiz')
  t.pass('yankı gelince örnek silindi, kök sıfırlandı')
})

test('Codex 4. tur: işçinin LEAVE yankısı ulaşma sayılmaz; yalnız üye ya da kutu', async (t) => {
  const S = require('@havenfold/sdk')
  const { ledger: { Ledger, T, encodeEvent }, identity: { createIdentity }, sync, zarf: { Z } } = require('@havenfold/core')
  const { ekle, olay, TS0 } = require('../../core/core/test/helpers/ledger')
  let isl = null
  const ag = { gonder: () => true, dinle: (x) => { isl = x } }
  const { w, c } = await ac(t, { dizin: geciciDizin(t, 'cy'), ag })
  const ben = Object.assign({}, w.kalici.kimlik, { ad: 'Ben' })
  const P = Object.assign(createIdentity({ seed: 'coklu-aile/acilis-isci-P', platform: 'test' }), { ad: 'P' })
  const I = createIdentity({ seed: 'coklu-aile/acilis-isci-I', platform: 'test' })
  const { ledger: L } = S.LedgerApi.createFamily({ Ledger, me: P, familyName: 'F', displayName: 'P', ts: TS0 })
  L.apply(ekle(L, ben, 'yetiskin', [P]))
  L.apply(olay(L, T.DEVICE_ATTACH, { deviceCert: I.deviceCert, class: 'isci', name: 'isci', placeId: b4a.alloc(16), caps: b4a.alloc(0), ceremonyTranscriptHash: b4a.alloc(32, 5) }, [P, I]))
  w.aileBagla(L)
  const iHex = hex(I.memberId)
  const pHex = hex(P.memberId)
  t.is(w.kalici.nesneler.ledger.sessionRole(iHex), 'cihaz')
  isl.baglandi(iHex)
  isl.baglandi(pHex)
  await c.iste(FAMILY_LEAVE, { aile: w.kalici.yerelNo })
  const R = w.kalici.nesneler.ledger
  const seq = R.members.get(hex(ben.memberId)).removedSeq
  const yanki = sync.encodeEvents({ fromSeq: seq, events: [encodeEvent(R.events[seq])] })
  t.alike(isl.al(iHex, Z.LEDGER_EVENTS, yanki), { hata: null }, 'işçinin olayları işlendi')
  await bekle(3500) // AYRILMA_GECIKME_MS'den uzun
  t.is((await c.iste(FAMILIES)).find((x) => x.kok).durum, 'silinecek', 'işçinin yankısı: örnek silinmedi')
  isl.al(pHex, Z.LEDGER_EVENTS, yanki)
  // Kök sıfırlanırken FAMILIES bir an kökü göstermeyebilir
  await kosul(async () => (await c.iste(FAMILIES)).find((x) => x.kok)?.durum === 'ailesiz')
  t.pass('üyenin yankısı: örnek silindi')
})

test('Codex 5. tur: klasorSil erişilemeyen klasörü silinmiş saymaz; yalnız gerçekten olmayan klasör silinmiştir', { skip: typeof Bare !== 'undefined' }, (t) => { // eslint-disable-line no-undef
  const { klasorSil } = require('../start')
  const ust = geciciDizin(t, 'ks')
  const d = ust + '/ornek'
  fs.mkdirSync(d, { recursive: true })
  fs.writeFileSync(d + '/kimlik', 'x')
  fs.chmodSync(ust, 0o000)
  let r
  try { r = klasorSil(d) } finally { fs.chmodSync(ust, 0o700) }
  t.is(r, false, 'erişim hatası: silinmedi')
  t.ok(fs.existsSync(d + '/kimlik'), 'kimlik yerinde')
  t.is(klasorSil(ust + '/yok'), true, 'olmayan klasör')
  t.is(klasorSil(d), true)
  t.absent(fs.existsSync(d))
})

test('açılış incelemesi ORTA 3: silme hatası yutulmaz — işaret kalır, örnek bozuk görünür, kök eski kimlikle açılmaz; izin düzelince silinir', { skip: typeof Bare !== 'undefined' }, async (t) => { // eslint-disable-line no-undef
  const dizin = geciciDizin(t, 'cs2')
  const { w, c } = await ac(t, { dizin })
  const kilitle = (d) => { fs.mkdirSync(d + '/kilitli', { recursive: true }); fs.writeFileSync(d + '/kilitli/x', 'x'); fs.chmodSync(d + '/kilitli', 0o500) }
  const ac_ = (d) => fs.chmodSync(d + '/kilitli', 0o700)
  t.teardown(() => { for (const d of acilacak) try { ac_(d) } catch {} })
  const acilacak = []
  // Ek örnek (katılım) silinemez
  await c.iste(FAMILY_ADD, { aileAdi: 'Eser', benimAdim: 'H' })
  const { aile: y } = await c.iste(JOIN_PREPARE)
  const dy = dizin + '/aileler/' + y
  kilitle(dy); acilacak.push(dy)
  t.is(await c.iste(FAMILY_LOCAL_REMOVE, { aile: y }), null)
  const s = (await c.iste(FAMILIES)).find((x) => x.aile === y)
  t.alike([s.durum, s.hata], ['bozuk', 'ERASURE_INCOMPLETE'])
  t.is(JSON.parse(fs.readFileSync(dy + '/silinecek')).asama, 'siliniyor', 'işaret kaldı: açılışta yeniden denenir')
  t.is(await hataOf(c.iste(FAMILY_LOCAL_REMOVE, { aile: y })), 'ERASURE_INCOMPLETE', 'yeniden silme de hatayı söyler')
  ac_(dy)
  t.is(await c.iste(FAMILY_LOCAL_REMOVE, { aile: y }), null)
  t.absent(fs.existsSync(dy), 'izin düzelince silindi')
  // Kök: dosyaları silinemezse eski kimlikle açılmaz, hata durumunda kalır
  const me0 = hex(w.kalici.kimlik.memberId)
  const dk = dizin + '/dosyalar'
  kilitle(dk); acilacak.push(dk)
  await c.iste(FAMILY_LEAVE, { aile: w.kalici.yerelNo })
  t.is(await hataOf(c.iste(FAMILY_LOCAL_REMOVE, { aile: w.kalici.yerelNo })), 'ERASURE_INCOMPLETE')
  const k = (await c.iste(FAMILIES)).find((x) => x.kok)
  t.alike([k.durum, k.hata], ['bozuk', 'ERASURE_INCOMPLETE'])
  t.is(await hataOf(c.iste(FAMILY_ADD, { aileAdi: 'X', benimAdim: 'H' })), 'ROOT_CORRUPT', 'bozuk kökte yeni aile yok')
  ac_(dk)
  t.is(await c.iste(FAMILY_LOCAL_REMOVE, { aile: 'kok' }), null)
  const k2 = (await c.iste(FAMILIES)).find((x) => x.kok)
  t.is(k2.durum, 'ailesiz')
  t.unlike(hex(w.ornek(k2.aile).kalici.kimlik.memberId), me0, 'yeni kimlik')
})

test('açılış incelemesi: ek kimlik (RFC-0017) ayrılınca da taşıyıcı LEAVE öncesi defteri görür (kimlik ana kimliğe çözülmez)', async (t) => {
  const S = require('@havenfold/sdk')
  const { ledger: { Ledger, T }, identity: { createIdentity } } = require('@havenfold/core')
  const { olay, TS0 } = require('../../core/core/test/helpers/ledger')
  const { w, c } = await ac(t, { dizin: geciciDizin(t, 'cek'), now: () => TS0 + 1000 })
  const ben = Object.assign({}, w.kalici.kimlik, { ad: 'Ben' })
  const P = Object.assign(createIdentity({ seed: 'coklu-aile/acilis-ek-P', platform: 'test' }), { ad: 'P' })
  const { ledger: L } = S.LedgerApi.createFamily({ Ledger, me: P, familyName: 'F', displayName: 'P', ts: TS0 })
  L.apply(olay(L, T.APP_ATTACH, { deviceCert: ben.deviceCert, personId: P.memberId, appId: 'ornek', sameDevice: false, replaces: null, ceremonyTranscriptHash: b4a.alloc(32, 7) }, [ben, P]))
  w.aileBagla(L)
  const meHex = hex(ben.memberId)
  t.ok(w.kalici.nesneler.ledger.members.get(meHex).extra, 'telefonun kimliği ek kimlik')
  await c.iste(FAMILY_LEAVE, { aile: w.kalici.yerelNo })
  const R = w.kalici.nesneler.ledger
  t.is(R.members.get(meHex).active, false, 'ek kimlik ayrıldı')
  const d = w.tasiyiciCihazi()
  t.is(d.ledger.len, R.len - 1, 'görünüm LEAVE öncesi')
  t.is(d.ledger.members.get(meHex).active, true)
})

test('açılış incelemesi: misafir kipi örnek düzeniyle — misafir örneği silinmez; misafir kökte aile ek örnekte; kalıcı katman reddeder', async (t) => {
  const { w, c } = await ac(t, { dizin: geciciDizin(t, 'cm'), katilimMs: 200 })
  await c.iste(FAMILY_ADD, { aileAdi: 'Eser', benimAdim: 'H' })
  // Katılım örneği misafir kipine geçer (törenin sonu): süre dolunca silinmez
  const { aile: y } = await c.iste(JOIN_PREPARE)
  w.ornek(y).kalici.nesneler.misafir = { gorunum: {} } // misafirBagla'nın sonucu yerine (doluMu yalnız varlığa bakar)
  await bekle(400)
  t.ok(w.ornek(y), 'misafir örneği katılım süresinde silinmedi')
  w.ornek(y).kalici.nesneler.misafir = null
  await c.iste(FAMILY_LOCAL_REMOVE, { aile: y })
  // Kalıcı katman: misafir kipinde aile bağlanmaz
  const { ledger: { Ledger } } = require('@havenfold/core')
  const S = require('@havenfold/sdk')
  const { aile: y2 } = await c.iste(JOIN_PREPARE)
  const o2 = w.ornek(y2)
  o2.kalici.nesneler.misafir = { gorunum: {} }
  const L = S.LedgerApi.createFamily({ Ledger, me: o2.kalici.kimlik, displayName: 'H', familyName: 'Y' }).ledger
  t.exception(() => o2.kalici.aileBagla(L), /IN_GUEST_MODE/)
})

test('açılış incelemesi: misafir kipindeki kökte 421 ek örnek açar (kök misafir kalır)', async (t) => {
  const { w, c } = await ac(t, { dizin: geciciDizin(t, 'cn') })
  w.kalici.nesneler.misafir = { gorunum: {} }
  const { aile } = await c.iste(FAMILY_ADD, { aileAdi: 'Yeni', benimAdim: 'H' })
  t.not(aile, w.kalici.yerelNo, 'aile ek örnekte kuruldu')
  t.absent(w.kalici.nesneler.aile, 'kökte aile yok')
  t.ok(w.ornek(aile).kalici.nesneler.aile)
})

test('açılış incelemesi: boş kökte üye katılımı izinsizse törenden önce reddedilir; misafir töreni denetime girmez (K3)', async (t) => {
  const createTestnet = require('hyperdht/testnet')
  const { qrKodla } = require('@havenfold/transport/ceremony')
  const S = require('@havenfold/sdk')
  const { TS0 } = require('../../core/core/test/helpers/ledger')
  const tn = await createTestnet(3, t.teardown)
  const saat = { t: TS0 + 86_400_000 }
  const { w, c } = await ac(t, { dizin: geciciDizin(t, 'co2'), now: () => saat.t, tasiyici: { deneysel: true, onyukleme: tn.bootstrap, yoklamaMs: 500 } })
  // Ek örnekte çocuk; kök aileden ayrılıp sıfırlanmış (boş)
  await c.iste(FAMILY_ADD, { aileAdi: 'Eser', benimAdim: 'H' })
  const { aile: y } = await c.iste(JOIN_PREPARE)
  const o = w.ornek(y)
  const F = cocukAilesi(S, Object.assign({}, o.kalici.kimlik, { ad: 'Ecem' }), saat)
  o.c.aileBagla(F.kopya(F.L))
  await c.iste(FAMILY_LEAVE, { aile: w.kalici.yerelNo })
  await c.iste(FAMILY_LOCAL_REMOVE, { aile: w.kalici.yerelNo })
  t.absent(w.kalici.nesneler.aile, 'kök boş')
  const qr = (kind) => qrKodla({ kind, famHint: rastgele(8), inv: rastgele(16), rv: rastgele(32), sec: rastgele(16), exp: Math.ceil(saat.t / 1000) + 600 })
  t.is(await hataOf(c.iste(KOMUT.JOIN, { kod: qr(0) }, w.kalici.yerelNo)), 'FAMILY_PERMISSION_REQUIRED', 'üye töreni başlamadan')
  t.not(await hataOf(c.iste(KOMUT.JOIN, { kod: qr(3) }, w.kalici.yerelNo)), 'FAMILY_PERMISSION_REQUIRED', 'misafir töreni izin istemez')
})

test('açılış incelemesi: silme işareti yazılamazsa hiçbir dosya silinmez', { skip: typeof Bare !== 'undefined' }, async (t) => { // eslint-disable-line no-undef
  const dizin = geciciDizin(t, 'cs3')
  const { c } = await ac(t, { dizin })
  await c.iste(FAMILY_ADD, { aileAdi: 'Eser', benimAdim: 'H' })
  const { aile: y } = await c.iste(FAMILY_ADD, { aileAdi: 'B', benimAdim: 'H' })
  const dy = dizin + '/aileler/' + y
  const once = fs.readdirSync(dy).sort()
  await c.iste(FAMILY_LEAVE, { aile: y })
  fs.chmodSync(dy, 0o500) // işaret (atomik yazım) yazılamaz
  t.teardown(() => { try { fs.chmodSync(dy, 0o700) } catch {} })
  t.is(await c.iste(FAMILY_LOCAL_REMOVE, { aile: y }), null)
  fs.chmodSync(dy, 0o700)
  t.alike(fs.readdirSync(dy).filter((f) => !String(f).includes('.tmp-')).sort(), [...new Set([...once, 'silinecek'])].sort(), 'dosyalar yerinde')
  t.is((await c.iste(FAMILIES)).find((x) => x.aile === y).hata, 'ERASURE_INCOMPLETE')
})

test('açılış incelemesi: ayrılma bekliyorken üyelik sürüyorsa (LEAVE çatalda kayboldu) LEAVE yeniden yazılır', async (t) => {
  const S = require('@havenfold/sdk')
  const { ledger: { Ledger, encodeEvent }, identity: { createIdentity }, sync, zarf: { Z } } = require('@havenfold/core')
  const { ekle, prekey, TS0 } = require('../../core/core/test/helpers/ledger')
  let isl = null
  const ag = { gonder: () => true, dinle: (x) => { isl = x } }
  const { w } = await ac(t, { dizin: geciciDizin(t, 'cf'), ag })
  const ben = Object.assign({}, w.kalici.kimlik, { ad: 'Ben' })
  const P = Object.assign(createIdentity({ seed: 'coklu-aile/acilis-catal-P', platform: 'test' }), { ad: 'P' })
  const { ledger: L } = S.LedgerApi.createFamily({ Ledger, me: P, familyName: 'F', displayName: 'P', ts: TS0 })
  L.apply(ekle(L, ben, 'yetiskin', [P]))
  w.aileBagla(L)
  const o = w.ornek(w.kalici.yerelNo)
  const meHex = hex(ben.memberId)
  // Çatal çözümünden sonraki durum: ayrılma işareti var, defterde LEAVE yok
  o.ayrilma = { zaman: TS0 }
  t.ok(w.kalici.nesneler.ledger.members.get(meHex).active)
  // Defter değişir (eşten yeni olay): üyelik denetimi LEAVE'i yeniden yazar
  const R = w.kalici.nesneler.ledger
  const e = prekey(R, P, TS0 + 5000)
  isl.baglandi(hex(P.memberId))
  isl.al(hex(P.memberId), Z.LEDGER_EVENTS, sync.encodeEvents({ fromSeq: R.len, events: [encodeEvent(e)] }))
  t.is(w.kalici.nesneler.ledger.members.get(meHex).active, false, 'LEAVE yeniden yazıldı')
})

test('sınır 28 (Codex 10. tur): başka uygulamada çocuk olan telefon izinsiz yeni aile kuramaz, katılamaz; o aileye eşleşme yeni aile değildir', async (t) => {
  const S = require('@havenfold/sdk')
  const { ledger: { Ledger } } = require('@havenfold/core')
  // Yerel kanal aile listesi (RFC-0034 §4.6): { familyId, ad, rol, kimlik }
  const diger = [{ familyId: 'c1'.repeat(32), ad: 'Eser', rol: 'cocuk', kimlik: 'ana' }]
  const { w, c } = await ac(t, { dizin: geciciDizin(t, 'cs'), yerelAileler: () => diger })
  t.is(await hataOf(c.iste(FAMILY_ADD, { aileAdi: 'X', benimAdim: 'H' })), 'CHILD_IN_OTHER_APP', '421')
  t.is(await hataOf(c.iste(KOMUT.CREATE_FAMILY, { aileAdi: 'X', benimAdim: 'H' })), 'CHILD_IN_OTHER_APP', 'kökte CREATE_FAMILY')
  t.is(await hataOf(c.iste(JOIN_PREPARE)), 'CHILD_IN_OTHER_APP', '422')
  const baska = S.LedgerApi.createFamily({ Ledger, me: w.kalici.kimlik, familyName: 'B', displayName: 'H', ts: Date.now() }).ledger
  t.exception(() => w.aileBagla(baska), /CHILD_IN_OTHER_APP/, 'törenle bağlanma')
  t.exception(() => w.kalici.aileBagla(baska), /CHILD_IN_OTHER_APP/, 'ürünün c.kalici üstünden bağlaması')
  t.absent(w.kalici.nesneler.aile, 'hiçbir yol aile bağlamadı')
  // Öbür uygulamadaki aileye törenle ikinci kimlik girmez (bugünkü kural); kalıcı katmanın geçidi ise aileyi yeni saymaz
  diger.push({ familyId: hex(baska.familyId), ad: 'B', rol: 'cocuk', kimlik: 'ana' })
  t.exception(() => w.aileBagla(baska), /FAMILY_EXISTS/, 'tören yolu')
  // RFC-0017 eşleşmesi (365) çocuğun olduğu aileye: yeni aile değil; sarmalayıcı FAMILY_EXISTS demez
  const { kaliciAc } = require('./helpers/common')
  const hat = kaliciAc({ dizin: geciciDizin(t, 'cs-hat'), appId: 'yuva-hat' })
  hat.aileKur({ aileAdi: 'Rivera', benimAdim: 'Alex' })
  diger.push({ familyId: hex(hat.nesneler.ledger.familyId), ad: 'Rivera', rol: 'cocuk', kimlik: 'ana' })
  const istek = w.kalici.nesneler.defter.pairRequest('ornek')
  const ok = hat.nesneler.defter.pairApprove(istek, { approved: true })
  const r = w.ornek(w.kalici.yerelNo).c.eslesKabul(ok)
  t.is(r.familyId, hex(hat.nesneler.ledger.familyId), 'eşleşme bağlandı')
  t.ok(w.kalici.nesneler.ledger.members.get(hex(w.kalici.kimlik.memberId)).extra, 'ek kimlik')
  w.kapat()
  // Yetişkin rolü ya da rolsüz eski liste (yalnız familyId) engellemez
  const k = await ac(t, { dizin: geciciDizin(t, 'ct'), yerelAileler: () => ['c2'.repeat(32), { familyId: 'c3'.repeat(32), rol: 'yetiskin' }, { familyId: 'zz', rol: 'cocuk' }, null, 7] })
  t.ok(await k.c.iste(FAMILY_ADD, { aileAdi: 'Y', benimAdim: 'H' }), 'yetişkin, rolsüz ve geçersiz öğe engellemez')
  t.ok(k.w.kalici.nesneler.aile)
})
