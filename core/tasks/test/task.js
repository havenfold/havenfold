// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
const test = require('brittle')
const b4a = require('b4a')
const c = require('compact-encoding')
const { ledger: { T, decodeEvent }, pairs: { PairBook }, zarf: { Z } } = require('@havenfold/core')
const { dosya: { decryptBlob } } = require('@havenfold/records')
const K = require('../encoding')
const Yt = require('../capability')
const { OnayDefteri, soruMetni } = require('../approval')
const { Isci } = require('../audit')
const { gorevKur, iptalKur } = require('../request')
const Y = require('../placement')
const { delegasyonKur, Koordinator, birlestir } = require('../coordinator')
const S = require('../standing')
const D = require('../delivery')
const G = require('./helpers/task')
const { delegasyon } = require('./helpers/task-vector')

const { C, U, hex, SIMDI, DAY, id16, id32, defter, caps, capsBayt, gorev, K_TUM_AILE, K_OLAYLAR, K_KASA } = G
const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const onayli = (uye, cihazlar) => new OnayDefteri(cihazlar.map((x) => ({ uye: hex(uye.memberId), cihaz: hex(x.memberId), izin: true, at: 0 })))

// --- Kodlama -------------------------------------------------------------------------------------------------

test('kodlama: kanonik çözme — sondaki bayt, en kısa olmayan uint, tanımsız değerler reddedilir', (t) => {
  const L = defter()
  const bytes = K.encodeTask(L.familyId, gorev(L), U.kerem)
  t.is(hex(K.decodeTask(bytes).body), hex(bytes.subarray(0, bytes.byteLength - 64)))
  // Gövdenin sonuna bayt eklenir
  const uzun = b4a.concat([bytes.subarray(0, bytes.byteLength - 64), b4a.from([0]), bytes.subarray(bytes.byteLength - 64)])
  t.is(hataOf(() => K.decodeTask(uzun)), 'INVALID_MESSAGE')
  // etaSec = 5, en kısa olmayan biçimde (0xfd 05 00)
  const acc = K.encodeAccept({ taskId: id16(1), etaSec: 5 })
  t.is(hataOf(() => K.decodeAccept(b4a.concat([acc.subarray(0, 16), b4a.from([0xfd, 5, 0])]))), 'INVALID_MESSAGE')
  // Tanımsız durum, tür adı, sürüm
  t.is(hataOf(() => K.encodeNodeCaps(L.familyId, caps(C.isci1, { status: 'uyku' }), C.isci1)), 'INVALID_MESSAGE')
  t.is(hataOf(() => K.encodeTask(L.familyId, gorev(L, { type: 'ocr' }), U.kerem)), 'INVALID_MESSAGE')
  t.is(hataOf(() => K.encodeTask(L.familyId, gorev(L, { version: '1.1' }), U.kerem)), 'INVALID_MESSAGE')
  t.is(hataOf(() => K.encodeResult({ taskId: id16(1), status: 'bitti', outputs: [], inline: b4a.alloc(0), log: '' })), 'INVALID_MESSAGE')
  // Satır içi en çok 32 KB, günlük en çok 4 KB
  t.ok(K.encodeResult({ taskId: id16(1), status: 'ok', outputs: [], inline: b4a.alloc(K.MAX_INLINE), log: '' }))
  t.is(hataOf(() => K.encodeResult({ taskId: id16(1), status: 'ok', outputs: [], inline: b4a.alloc(K.MAX_INLINE + 1), log: '' })), 'INVALID_MESSAGE')
  t.is(hataOf(() => K.encodeResult({ taskId: id16(1), status: 'ok', outputs: [], inline: b4a.alloc(0), log: 'x'.repeat(K.MAX_LOG + 1) })), 'INVALID_MESSAGE')
  t.is(hataOf(() => K.encodeProgress({ taskId: id16(1), pct: 101, note: '' })), 'INVALID_MESSAGE')
  // Seçimli alan: pil yok → bayrak false
  const pilsiz = K.decodeNodeCaps(K.encodeNodeCaps(L.familyId, caps(C.isci1, { battery: null }), C.isci1)).m
  t.is(pilsiz.battery, null)
  // Etiketler hf/ ile başlar, / ile biter
  for (const e of Object.values(K.ETIKET)) t.ok(e.startsWith('hf/') && e.endsWith('/'), e)
})

// --- Yetenek bildirimi -----------------------------------------------------------------------------------------

test('yetenek: maxTaskRamMB ve durum kuralları (90 °C üstü sıcak, 80 °C altında döner, prizden çıkınca pil)', (t) => {
  t.is(Yt.maxTaskRam({ ramTotalMB: 8192 }), 7168)
  t.is(Yt.maxTaskRam({ ramTotalMB: 8192, runningRamMB: [2048, 1024], appRamMB: [1024] }), 3072)
  t.is(Yt.maxTaskRam({ ramTotalMB: 2048, runningRamMB: [2048] }), 0)
  t.is(Yt.durumHesapla({ sicakliklar: [55, 91] }), 'sicak')
  t.is(Yt.durumHesapla({ sicakliklar: [90] }), 'hazir')
  t.is(Yt.durumHesapla({ onceki: 'sicak', sicakliklar: [85] }), 'sicak')
  t.is(Yt.durumHesapla({ onceki: 'sicak', sicakliklar: [79] }), 'hazir')
  t.is(Yt.durumHesapla({ sicakliklar: [40], onAC: false }), 'pil')
  t.is(Yt.durumHesapla({ sicakliklar: [40], mesgul: true }), 'mesgul')
  t.is(Yt.durumHesapla({ sicakliklar: [40], bakim: true, mesgul: true }), 'bakim')
  t.ok(Yt.surumUyar('1.2.0', '1.1.9'))
  t.ok(Yt.surumUyar('1.1.0', '1.1.3')) // PATCH bakılmaz
  t.absent(Yt.surumUyar('1.0.9', '1.1.0'))
  t.absent(Yt.surumUyar('2.1.0', '1.1.0'))
})

test('yetenek: telefon bildirimi doğrular, saklar; 15 dakikada çevrimdışı', (t) => {
  const L = defter()
  let saat = SIMDI
  const d = new Yt.YetenekDefteri({ ledger: L, now: () => saat })
  t.is(d.al(capsBayt(L, C.isci1), { from: hex(C.isci1.memberId) }).seq, 1)
  t.is(hataOf(() => d.al(capsBayt(L, C.isci1))), 'STALE_MANIFEST')
  t.is(hataOf(() => d.al(capsBayt(L, C.isci2), { from: hex(C.isci1.memberId) })), 'YETKISIZ')
  t.is(hataOf(() => d.al(capsBayt(L, C.isci2, { class: 'uc' }))), 'YETKISIZ') // defterde işçi
  t.is(hataOf(() => d.al(capsBayt(L, C.uc1, { class: 'uc' }))), 'YETKISIZ') // çıkarılmış cihaz
  t.is(hataOf(() => d.al(capsBayt(L, C.misafir2))), 'YETKISIZ')
  t.is(hataOf(() => d.al(K.encodeNodeCaps(L.familyId, caps(C.isci2), C.isci3))), 'IMZA_GECERSIZ')
  t.ok(d.al(capsBayt(L, U.kutu, { class: 'kutu' })))
  t.is(hataOf(() => d.al(capsBayt(L, U.kerem, { class: 'kutu' }))), 'YETKISIZ') // üye telefonu bildirim göndermez
  d.al(capsBayt(L, C.isci2, { seq: 7 }))
  saat = SIMDI + 15 * 60_000
  t.is(d.cevrimici().length, 3)
  saat += 1
  t.is(d.cevrimici().length, 0)
})

test('yetenek: Ev Makinesi kartı — kutu karta girmez, en büyük tek iş her zaman var', (t) => {
  const L = defter()
  const d = new Yt.YetenekDefteri({ ledger: L, now: () => SIMDI })
  d.al(capsBayt(L, C.isci1, { cores: 4, ramTotalMB: 8192, diskFreeGB: 200, maxTaskRamMB: 6656, running: [{ taskId: id16(9), type: 'hf.task.ocr', pct: 62 }] }))
  d.al(capsBayt(L, C.isci2, { cores: 2, ramTotalMB: 8192, diskFreeGB: 210, maxTaskRamMB: 3000 }))
  d.al(capsBayt(L, U.kutu, { class: 'kutu', cores: 4, ramTotalMB: 4096 }))
  const kart = Yt.evMakinesi(d)
  t.alike(kart, { cekirdek: 6, bellekMB: 16384, bosDiskGB: 410, acikCihaz: 2, enBuyukTekIsMB: 6656, calisan: [{ nodeId: hex(C.isci1.memberId), taskId: hex(id16(9)), type: 'hf.task.ocr', pct: 62 }] })
  t.alike(Yt.evMakinesi(new Yt.YetenekDefteri({ ledger: L, now: () => SIMDI })).enBuyukTekIsMB, 0)
})

test('yetenek: NODE_CAPS kime gider — üyeler, kutu; cihaza yalnız kendisini listeleyen belgenin koordinatörü', (t) => {
  const L = defter()
  const me = hex(C.isci2.memberId)
  t.ok(Yt.capsAlicisiMi(L, me, hex(U.irem.memberId)))
  t.ok(Yt.capsAlicisiMi(L, me, hex(U.kutu.memberId)))
  t.absent(Yt.capsAlicisiMi(L, me, hex(C.misafir2.memberId)))
  t.absent(Yt.capsAlicisiMi(L, me, hex(U.u5.memberId)))
  // İmzasız belge yetmez (RFC-0019 §11.2 f); imzalı belgeyle
  t.absent(Yt.capsAlicisiMi(L, me, hex(C.isci1.memberId), [delegasyon(L)], SIMDI))
  const d = K.decodeDelegation(delegasyonKur(L, U.kerem, delegasyon(L), { onay: onayli(U.kerem, [C.isci1, C.isci2]), now: SIMDI })).m
  t.absent(Yt.capsAlicisiMi(L, me, hex(C.isci1.memberId)))
  t.ok(Yt.capsAlicisiMi(L, me, hex(C.isci1.memberId), [d], SIMDI))
  t.absent(Yt.capsAlicisiMi(L, me, hex(C.isci1.memberId), [d], d.expiresAt))
  t.absent(Yt.capsAlicisiMi(L, hex(C.isci3.memberId), hex(C.isci1.memberId), [d], SIMDI))
})

// --- İlk kullanım onayı ------------------------------------------------------------------------------------------

test('onay: soru bir kez, geri alınır, yeni deviceId yeniden sorar, yedeğe yazılır', (t) => {
  const o = new OnayDefteri()
  t.ok(o.soruGerekli(U.husniye.memberId, C.isci1.memberId))
  o.ver(U.husniye.memberId, C.isci1.memberId, true, 5)
  t.absent(o.soruGerekli(U.husniye.memberId, C.isci1.memberId))
  t.ok(o.var(U.husniye.memberId, C.isci1.memberId))
  t.absent(o.var(U.irem.memberId, C.isci1.memberId)) // aile ile paylaşılmaz: üye başına
  t.ok(o.soruGerekli(U.husniye.memberId, C.isci9.memberId)) // yeniden eklenen işçi yeni kimlik
  o.ver(U.husniye.memberId, C.isci2.memberId, false)
  t.alike(o.eksikler(U.husniye.memberId, [C.isci1.memberId, C.isci2.memberId, C.isci3.memberId]), [hex(C.isci2.memberId), hex(C.isci3.memberId)])
  o.ver(U.husniye.memberId, C.isci1.memberId, false) // "Verilerimi bu cihaza gönder" kapatıldı
  t.absent(o.var(U.husniye.memberId, C.isci1.memberId))
  const geri = OnayDefteri.fromJSON(JSON.parse(JSON.stringify(o)))
  t.alike(geri.toJSON(), o.toJSON())
  o.ver(U.husniye.memberId, C.uc1.memberId, true)
  o.temizle(defter())
  t.ok(o.soruGerekli(U.husniye.memberId, C.uc1.memberId)) // çıkarılmış cihazın kaydı silinir
  t.is(soruMetni('Lenovo'), 'Bu iş evdeki Lenovo cihazında yapılacak. Lenovo belgeyi işi bitirene kadar görür, sonra siler. İzin veriyor musun?')
})

// --- İsteyen ve işçi ------------------------------------------------------------------------------------------

test('istek: telefon kendi tarafındaki denetimleri yapar', (t) => {
  const L = defter()
  const onay = onayli(U.kerem, [C.isci1])
  const g = (ek) => ({ ...gorev(L), ...ek })
  t.ok(gorevKur(L, U.kerem, g(), { onay, now: SIMDI }))
  t.is(hataOf(() => gorevKur(L, U.kerem, g({ workerId: C.isci2.memberId }), { onay, now: SIMDI })), 'NO_APPROVAL')
  t.is(hataOf(() => gorevKur(L, U.kerem, g({ collectionId: K_KASA }), { onay, now: SIMDI })), 'KOLEKSIYON_KAPALI')
  t.is(hataOf(() => gorevKur(L, U.kerem, g({ deadline: SIMDI + 8 * DAY }), { onay, now: SIMDI })), 'SURE_GECERSIZ')
  t.is(hataOf(() => gorevKur(L, U.ecem, g({ type: 'hf.task.llm', version: '1.0.0' }), { onay: onayli(U.ecem, [C.isci1]), now: SIMDI })), 'TUR_IZNI_YOK')
  const m = K.decodeTask(gorevKur(L, U.kerem, g(), { onay, now: SIMDI })).m
  t.is(m.ledgerSeq, L.len - 1)
  t.ok(m.parentTaskId.every((x) => x === 0))
})

test('işçi: kabul, iptal (yalnız isteyen), bitince dosya anahtarları sıfırlanır', (t) => {
  const L = defter()
  const isci = new Isci({ ledger: L, me: C.isci1, caps: caps(C.isci1), now: () => SIMDI })
  const bytes = K.encodeTask(L.familyId, gorev(L), U.kerem)
  const r = isci.al(bytes, { from: hex(U.kerem.memberId), etaSec: 120 })
  t.is(r.type, Z.TASK_ACCEPT)
  t.alike(K.decodeAccept(r.bytes), { taskId: id16(0x51), etaSec: 120 })
  const r2 = isci.al(bytes, { from: hex(U.kerem.memberId) })
  t.is(r2.type, Z.TASK_REJECT)
  t.is(K.decodeReject(r2.bytes).code, 'TEKRAR')
  t.is(hataOf(() => isci.iptal(iptalKur(L, U.husniye, id16(0x51)))), 'YETKISIZ')
  t.is(hataOf(() => isci.iptal(K.encodeCancel(L.familyId, { taskId: id16(0x51), by: U.kerem.memberId }, U.husniye))), 'IMZA_GECERSIZ')
  t.is(hataOf(() => isci.iptal(iptalKur(L, U.kerem, id16(0x52)))), 'GOREV_YOK')
  // Başarılı iptal görevi bitirir; dosya anahtarları sıfırlanır
  const task = isci.iptal(iptalKur(L, U.kerem, id16(0x51)))
  t.ok(task.inputs[0].fileKey.every((x) => x === 0))
  t.absent(isci.bitir(hex(id16(0x51))))
})

test('işçi: görülen taskId deadline geçince unutulur; alt görev sayacı belge süresince', (t) => {
  const L = defter()
  let saat = SIMDI
  const isci = new Isci({ ledger: L, me: C.isci1, caps: caps(C.isci1), now: () => saat })
  const from = hex(U.kerem.memberId)
  isci.denetle(K.encodeTask(L.familyId, gorev(L, { deadline: SIMDI + 1000 }), U.kerem), { from })
  t.is(isci.seen.size, 1)
  saat = SIMDI + 1000
  isci.denetle(K.encodeTask(L.familyId, gorev(L, { taskId: id16(0x52) }), U.kerem), { from })
  t.alike([...isci.seen.keys()], [hex(id16(0x52))])
  // İmzası tutmayan görev saklanmaz
  isci.denetle(K.encodeTask(L.familyId, gorev(L, { taskId: id16(0x53) }), U.husniye), { from })
  t.absent(isci.seen.has(hex(id16(0x53))))
})

// --- Yerleştirme -------------------------------------------------------------------------------------------------

function telefon (L, isciler, ek = {}) {
  const d = new Yt.YetenekDefteri({ ledger: L, now: () => SIMDI })
  for (const [ad, x] of Object.entries(isciler)) d.al(capsBayt(L, C[ad], x))
  return { defter: d, onay: onayli(U.kerem, Object.keys(isciler).map((a) => C[a])), ...ek }
}

test('yerleştirme: sıralama yük/çekirdek, eşitlikte prizdeki, sonra kimlik', (t) => {
  const n = (id, cores, load, onAC = true) => ({ id, caps: { cores, load1x100: load, battery: { onAC } } })
  const s = Y.sirala([n('cc', 2, 100), n('bb', 4, 100), n('aa', 1, 50, false), n('dd', 1, 50)])
  t.alike(s.map((x) => x.id), ['bb', 'cc', 'dd', 'aa'])
  t.alike(Y.adaySonucu([], true), { yer: 'telefon' })
  t.alike(Y.adaySonucu([], false), { yer: null, hata: 'NO_ELIGIBLE_DEVICE' })
  t.is(hataOf(() => Y.bol(0, [1])), 'INVALID_DIVISION')
})

test('yerleştirme: reddeden işçinin parçası sıradakine gider; 30 sn kabul yoksa iptal ve yeniden', (t) => {
  let saat = SIMDI
  const liste = ['a', 'b', 'c']
  const y = new Y.Yerlestirici({ parcalar: [{ no: 0, isci: 'a', from: 1, to: 27 }, { no: 1, isci: 'b', from: 28, to: 40 }], adaylar: () => liste, now: () => saat })
  t.alike(y.baslat(), [{ eylem: 'gonder', parca: 0, isci: 'a', deneme: 1, deadline: null }, { eylem: 'gonder', parca: 1, isci: 'b', deneme: 1, deadline: null }])
  y.gonderildi(0, 't0', SIMDI + DAY)
  y.gonderildi(1, 't1', SIMDI + DAY)
  t.alike(y.red('t0', 'b'), []) // başka işçiden gelen cevap atılır
  t.alike(y.red('t0', 'a'), [{ eylem: 'gonder', parca: 0, isci: 'b', deneme: 2, deadline: null }])
  y.gonderildi(0, 't0b', SIMDI + DAY)
  t.alike(y.red('t0', 'a'), []) // eski taskId
  y.kabul('t1', 'b')
  saat += Y.KABUL_SURESI_MS
  t.alike(y.tick(), [{ eylem: 'iptal', parca: 0, taskId: 't0b', isci: 'b' }, { eylem: 'gonder', parca: 0, isci: 'c', deneme: 3, deadline: null }])
  y.gonderildi(0, 't0c', SIMDI + DAY)
  t.alike(y.red('t0c', 'c'), [{ eylem: 'basarisiz', parca: 0, code: 'TRIAL_ENDED' }])
  t.alike(y.sonuc('t1', 'b', { status: 'ok', inline: b4a.from('x'), outputs: [] }), [])
})

test('yerleştirme: deadline geçince parça taşınır; bütün parçalar bitince bitti', (t) => {
  let saat = SIMDI
  const y = new Y.Yerlestirici({ parcalar: [{ no: 0, isci: 'a', from: 1, to: 1 }], adaylar: () => ['a', 'b'], now: () => saat })
  y.baslat()
  y.gonderildi(0, 't0', SIMDI + 60_000)
  y.kabul('t0', 'a')
  saat = SIMDI + 59_999
  t.alike(y.tick(), [])
  saat = SIMDI + 60_000
  t.alike(y.tick(), [{ eylem: 'iptal', parca: 0, taskId: 't0', isci: 'a' }, { eylem: 'gonder', parca: 0, isci: 'b', deneme: 2, deadline: null }])
  y.gonderildi(0, 't1', SIMDI + DAY)
  t.alike(y.sonuc('t1', 'b', { status: 'sure', inline: b4a.alloc(0), outputs: [] }), [{ eylem: 'basarisiz', parca: 0, code: 'NO_ELIGIBLE_DEVICE' }])
  const z = new Y.Yerlestirici({ parcalar: [{ no: 0, isci: 'a', from: 1, to: 1 }], adaylar: () => ['a'], now: () => saat })
  z.baslat()
  z.gonderildi(0, 'u0', SIMDI + DAY)
  const r = z.sonuc('u0', 'a', { status: 'ok', inline: b4a.from('metin'), outputs: [] })
  t.is(r[0].eylem, 'bitti')
  t.is(b4a.toString(r[0].sonuclar[0].sonuc.inline), 'metin')
})

test('uçtan uca: 40 sayfalık OCR iki işçiye 27 + 13 bölünür, sonuçlar gelir', (t) => {
  const L = defter()
  const tel = telefon(L, { isci1: { cores: 4, load1x100: 40 }, isci2: { cores: 2, load1x100: 30 } })
  const sirali = Y.adaylar(tel.defter, { type: 'hf.task.ocr', version: '1.1.0', ramMB: 2048, uye: U.kerem.memberId, onay: tel.onay, now: SIMDI })
  const parcalar = Y.planla(sirali, { birim: 40, bolunur: true })
  t.alike(parcalar.map((p) => p.to - p.from + 1), [27, 13])
  const isciler = Object.fromEntries(['isci1', 'isci2'].map((a) => [hex(C[a].memberId), new Isci({ ledger: L, me: C[a], caps: caps(C[a]), now: () => SIMDI })]))
  const y = new Y.Yerlestirici({ parcalar, adaylar: () => sirali.map((a) => a.id), now: () => SIMDI })
  let son = []
  for (const e of y.baslat()) {
    const taskId = id16(0x90 + e.parca)
    const bytes = gorevKur(L, U.kerem, { ...gorev(L), taskId, workerId: b4a.from(e.isci, 'hex'), params: c.encode(c.json, { pages: [parcalar[e.parca].from, parcalar[e.parca].to] }) }, { onay: tel.onay, now: SIMDI })
    y.gonderildi(e.parca, taskId, SIMDI + DAY)
    const isci = isciler[e.isci]
    const cevap = isci.al(bytes, { from: hex(U.kerem.memberId) })
    t.is(cevap.type, Z.TASK_ACCEPT)
    y.kabul(taskId, e.isci)
    const sonuc = K.decodeResult(K.encodeResult({ taskId, status: 'ok', outputs: [], inline: b4a.from('parca' + e.parca + ';'), log: '' }))
    isci.bitir(hex(taskId))
    son = y.sonuc(taskId, e.isci, sonuc)
  }
  t.is(son[0].eylem, 'bitti')
  t.is(b4a.toString(birlestir(id16(0x51), son[0].sonuclar).result.inline), 'parca0;parca1;')
})

// --- Koordinatör ----------------------------------------------------------------------------------------------

test('koordinatör: belge kurma kuralları (koordinatör dahil, 24 saat, her işçide onay)', (t) => {
  const L = defter()
  const d = delegasyon(L)
  t.ok(delegasyonKur(L, U.kerem, d, { onay: onayli(U.kerem, [C.isci1, C.isci2]), now: SIMDI }))
  t.is(hataOf(() => delegasyonKur(L, U.kerem, d, { onay: onayli(U.kerem, [C.isci1]), now: SIMDI })), 'NO_APPROVAL')
  t.is(hataOf(() => delegasyonKur(L, U.kerem, { ...d, workers: [C.isci2.memberId] }, { onay: onayli(U.kerem, [C.isci2]), now: SIMDI })), 'INVALID_BODY')
  t.is(hataOf(() => delegasyonKur(L, U.kerem, { ...d, expiresAt: SIMDI + 25 * 3_600_000 }, { onay: onayli(U.kerem, [C.isci1, C.isci2]), now: SIMDI })), 'SURE_GECERSIZ')
  t.is(hataOf(() => delegasyonKur(L, U.kerem, { ...d, workers: [C.isci1.memberId, C.uc1.memberId] }, { onay: onayli(U.kerem, [C.isci1, C.uc1]), now: SIMDI })), 'NO_TARGET')
})

test('koordinatör: alt görevler belgeye bağlı, parça sınırı, işçi kabul eder; sonuçlar birleşir', (t) => {
  const L = defter()
  const d = K.decodeDelegation(delegasyonKur(L, U.kerem, delegasyon(L), { onay: onayli(U.kerem, [C.isci1, C.isci2]), now: SIMDI })).m
  const ana = gorev(L, { taskId: id16(0x71) })
  const k = new Koordinator({ ledger: L, me: C.isci1, task: ana, delegasyon: d, now: () => SIMDI })
  t.alike(k.isciler(), [hex(C.isci1.memberId), hex(C.isci2.memberId)])
  const p = (ek) => ({ taskId: id16(0x81), workerId: C.isci2.memberId, inputs: ana.inputs, params: b4a.from('{}'), deadline: SIMDI + 6 * 3_600_000, limits: ana.limits, ...ek })
  t.is(hataOf(() => k.altGorev(p({ workerId: C.isci3.memberId }))), 'YETKISIZ')
  t.is(hataOf(() => k.altGorev(p({ deadline: d.expiresAt + 1 }))), 'SURE_GECERSIZ')
  const isci2 = new Isci({ ledger: L, me: C.isci2, caps: caps(C.isci2), now: () => SIMDI })
  t.ok(isci2.denetle(k.altGorev(p()), { from: hex(C.isci1.memberId) }).ok)
  t.ok(isci2.denetle(k.altGorev(p({ taskId: id16(0x82) })), { from: hex(C.isci1.memberId) }).ok)
  t.is(hataOf(() => k.altGorev(p({ taskId: id16(0x83) }))), 'CHUNK_LIMIT')
  // Koordinatör alt görevi kendi imzasıyla iptal eder; isteyen alt görevi iptal edemez
  const k2 = new Koordinator({ ledger: L, me: C.isci1, task: ana, delegasyon: d, now: () => SIMDI })
  const isci2b = new Isci({ ledger: L, me: C.isci2, caps: caps(C.isci2), now: () => SIMDI })
  t.is(isci2b.al(k2.altGorev(p({ taskId: id16(0x84) })), { from: hex(C.isci1.memberId) }).type, Z.TASK_ACCEPT)
  t.is(hataOf(() => isci2b.iptal(iptalKur(L, U.kerem, id16(0x84)))), 'YETKISIZ')
  t.ok(isci2b.iptal(k2.iptal(id16(0x84))))
  // Birleştirme: biri başarısızsa hata; 32 KB'ı aşan metin dosya olur
  const ok = (no, s) => ({ parca: no, sonuc: { status: 'ok', outputs: [], inline: b4a.from(s), log: 'p' + no } })
  t.is(birlestir(id16(0x71), [ok(0, 'a'), { parca: 1, sonuc: { status: 'hata', outputs: [], inline: b4a.alloc(0), log: '' } }]).result.status, 'hata')
  const buyuk = birlestir(id16(0x71), [ok(1, 'b'.repeat(20000)), ok(0, 'a'.repeat(20000))])
  t.is(buyuk.result.inline.byteLength, 0)
  t.is(buyuk.result.outputs.length, 1)
  t.ok(b4a.toString(decryptBlob(buyuk.result.outputs[0], buyuk.blob.chunks)).startsWith('aaaa'))
  t.is(buyuk.result.log, 'p0\np1')
  t.ok(K.encodeResult(buyuk.result))
})

// --- Sürekli görev ----------------------------------------------------------------------------------------------

test('sürekli: izin COLLECTION gövdesiyle eklenir ve kaldırılır; işçi yalnız izinliyken bırakır', (t) => {
  const L = defter()
  t.is(hataOf(() => S.izinEkle(L, K_TUM_AILE, C.isci2.memberId)), 'NOT_COLLECTION_ELIGIBLE')
  t.is(hataOf(() => S.izinEkle(L, K_OLAYLAR, C.uc1.memberId)), 'NO_TARGET')
  t.is(S.izinEkle(L, K_OLAYLAR, C.isci1.memberId), null) // zaten yazar
  t.absent(S.birakabilir(L, K_OLAYLAR, C.isci2.memberId))
  L.apply(G.olay(L, T.COLLECTION, S.izinEkle(L, K_OLAYLAR, C.isci2.memberId), [U.kerem]))
  t.ok(S.birakabilir(L, K_OLAYLAR, C.isci2.memberId))
  t.ok(L.collections.get(hex(K_OLAYLAR)).writers.includes('device:' + hex(C.isci2.memberId)))
  L.apply(G.olay(L, T.COLLECTION, S.izinKaldir(L, K_OLAYLAR, C.isci2.memberId), [U.kerem]))
  t.absent(S.birakabilir(L, K_OLAYLAR, C.isci2.memberId))
  t.is(S.enGecDeadline(SIMDI), SIMDI + 30 * DAY)
  t.absent(S.yenilenmeli(SIMDI + 30 * DAY, SIMDI))
  t.ok(S.yenilenmeli(SIMDI + DAY, SIMDI))
})

// --- Teslim ----------------------------------------------------------------------------------------------------

test('teslim: yollar — Posta Kutusu yok, NODE_CAPS emanete gitmez; sonuç emanetle mühürlü', (t) => {
  for (const tur of [Z.TASK, Z.TASK_RESULT, Z.TASK_DELEGATION, Z.TASK_CANCEL]) {
    t.ok(D.yolUygun(tur, D.YOL.DOGRUDAN))
    t.ok(D.yolUygun(tur, D.YOL.EMANET))
    t.absent(D.yolUygun(tur, D.YOL.POSTA))
  }
  t.ok(D.yolUygun(Z.NODE_CAPS, D.YOL.DOGRUDAN))
  t.absent(D.yolUygun(Z.NODE_CAPS, D.YOL.EMANET))
  t.absent(D.yolUygun(Z.REC_OPS, D.YOL.DOGRUDAN))

  const L = defter()
  const isciCift = new PairBook({ me: C.isci1, ledger: L }).get(hex(U.kerem.memberId))
  const keremCift = new PairBook({ me: U.kerem, ledger: L }).get(hex(C.isci1.memberId))
  const sonuc = K.encodeResult({ taskId: id16(0x51), status: 'ok', outputs: [], inline: b4a.from('metin'), log: '' })
  const hold = D.emanetMuhurle(isciCift.pair, C.isci1.memberId, U.kerem.memberId, Z.TASK_RESULT, sonuc, id16(0x51), 0)
  t.alike(hold.forMemberId, U.kerem.memberId)
  t.absent(b4a.includes(hold.sealed, b4a.from('metin')))
  t.alike(D.emanetAc(keremCift.pair, hold), sonuc)
  // Zarf kimliği taskId ‖ sıra: başka sıranın kimliğiyle açılmaz (RFC-0019 4.10)
  t.is(hataOf(() => D.emanetAc(keremCift.pair, { ...hold, zarfId: D.zarfKimligi(id16(0x51), 1) })), 'UNSEALED_AUDIT')
  t.is(hataOf(() => D.emanetMuhurle(isciCift.pair, C.isci1.memberId, U.kerem.memberId, Z.NODE_CAPS, sonuc, id16(0x51), 0)), 'PATH_FORBIDDEN')
  t.is(D.sonucYolu(L, { dogrudan: true }), 'dogrudan')
  t.is(D.sonucYolu(L, { dogrudan: false }), 'emanet')
})

test('teslim: kutu yoksa sonuç işçide 7 gün bekler; ilerleme 10 saniyede bir; çıktı 32 KB sınırı', (t) => {
  let saat = SIMDI
  const k = new D.SonucKutusu({ now: () => saat })
  k.ekle(id16(1), U.kerem.memberId, b4a.from('a'))
  k.ekle(id16(2), U.irem.memberId, b4a.from('b'))
  t.is(k.bekleyenler(U.kerem.memberId).length, 1)
  t.ok(k.teslimEdildi(id16(1)))
  saat += D.BEKLEME_MS
  t.alike(k.temizle(), [hex(id16(2))])

  const s = new D.IlerlemeSiniri({ now: () => saat })
  t.ok(s.gonderilsinMi(id16(1)))
  saat += 9_999
  t.absent(s.gonderilsinMi(id16(1)))
  t.ok(s.gonderilsinMi(id16(2)))
  saat += 1
  t.ok(s.gonderilsinMi(id16(1)))

  t.is(D.ciktiHazirla(b4a.alloc(K.MAX_INLINE)).outputs.length, 0)
  const b = D.ciktiHazirla(b4a.alloc(K.MAX_INLINE + 1, 7), { mime: 'application/pdf', fileKey: id32(3) })
  t.is(b.inline.byteLength, 0)
  t.is(b.outputs[0].mime, 'application/pdf')
  t.alike(decryptBlob(b.outputs[0], b.blob.chunks), b4a.alloc(K.MAX_INLINE + 1, 7))
  const uzun = 'ç'.repeat(K.MAX_LOG)
  t.ok(b4a.byteLength(D.logKirp(uzun)) <= K.MAX_LOG)
  t.is(D.logKirp('kısa'), 'kısa')
})

test('defter: zincirdeki son olay U5\'in atılması', (t) => {
  const L = defter()
  const son = decodeEvent(b4a.from(G.ZINCIR[G.ZINCIR.length - 1], 'hex'))
  t.is(son.type, T.REMOVE_MEMBER)
  t.is(L.sessionRole(hex(U.u5.memberId)), null)
})
