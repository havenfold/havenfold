// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// İnceleme 12'nin saldırı senaryoları (kollar/D-inceleme-12-testler/saldiri.js S1–S12), tersine: her saldırının artık
// başarısız olduğunu sınar (RFC-0027 §5 a–f). Ayrıca kasa arşivi, düz kipten göç, durum sürümü göçü ve prototip anahtarı.
'use strict'
const test = require('brittle')
const fs = require('#fs')
const b4a = require('b4a')
const { start } = require('..')
const { Kalici, Depo, kodla, coz, DURUM_SURUMU } = require('../persistence')
const { cerceveYaz } = require('../ipc')
const { urunSunucusu, KOMUT } = require('../example/product')
const { geciciDizin, ipcCifti, istemci, hataOf, hataOfSenk, arsivAnahtari } = require('./helpers/common')

const saat = () => { let t = 1_800_000_000_000; return () => t++ }
const ANAHTAR = b4a.alloc(32, 0x42)
const ARSIV = arsivAnahtari()
const zamanAsimi = (p, ms = 300) => Promise.race([p.then(() => 'cevap', (e) => 'hata:' + e.message), new Promise((r) => setTimeout(() => r('HUNG'), ms))])
const bekle = (ms) => new Promise((r) => setTimeout(r, ms))
const icerir = (buyuk, kucuk) => b4a.indexOf(buyuk, kucuk) >= 0

// Kalici açar; test bitince kapatır (dizin kilidi)
function ac (t, o) {
  const k = new Kalici({ now: saat(), anahtar: ANAHTAR, archivePubHex: ARSIV.pubHex, ...o })
  t.teardown(() => k.kapat())
  return k
}

function aileVeKayit (t, dizin, o = {}) {
  const k = ac(t, { dizin, ...o })
  const n = k.aileKur({ aileAdi: 'Rivera', benimAdim: 'Alex' })
  const cid = n.kayit.collections().find((x) => x.name === 'Tüm Aile').collectionId
  const rid = n.kayit.put(cid, null, 'yuva.defter.not', { baslik: 'gizli not' })
  k.kaydet()
  return { k, n, cid, rid }
}

// Çalışan worklet'i test sonunda kapatır (tek örnek)
async function calistir (t, o) {
  const w = await start({ urunSunucusu, now: saat(), anahtar: ANAHTAR, archivePubHex: ARSIV.pubHex, ...o })
  t.teardown(() => w.kapat())
  return w
}

test('S1: platform anahtarı zorunlu; diskte gizli anahtarlar ve dönem anahtarları açık metin değil', async (t) => {
  const dizin = geciciDizin(t)
  t.is(hataOfSenk(() => new Kalici({ dizin })), 'NO_KEY')
  t.is(hataOfSenk(() => new Kalici({ dizin, anahtar: ANAHTAR })), 'NO_KEY', 'Arşiv açık anahtarı da zorunlu')
  t.is(await hataOf(start({ urunSunucusu, dizin, ipc: ipcCifti() })), 'NO_KEY')
  const { k, n } = aileVeKayit(t, dizin)
  const anahtar = [...n.replika.keys.epochs.values()][0].keys.values().next().value.entry.key
  for (const f of ['kimlik', 'durum']) {
    const ham = fs.readFileSync(dizin + '/' + f)
    t.is(ham[5], 1, f + ' şifreli kipte')
    t.absent(icerir(ham, k.kimlik.signKeyPair.secretKey), f + ': imza gizli anahtarı yok')
    t.absent(icerir(ham, anahtar), f + ': dönem anahtarı yok')
  }
})

test('S2: diskteki duruma mezar eklenirse açılış STATE_CORRUPT (sessiz kayıp yok); şifreli kipte dosya üretilemez', (t) => {
  const dizin = geciciDizin(t)
  const { k } = aileVeKayit(t, dizin, { anahtar: null, archivePubHex: null, testKipi: true })
  k.kapat()
  const saldirgan = new Depo({ dizin, testKipi: true })
  const g = coz(JSON.parse(b4a.toString(saldirgan.oku('durum'))))
  const { peekOp } = require('@havenfold/records/operation')
  for (const o of g.replika.ops) g.replika.tomb.set(b4a.toString(peekOp(o.bytes).opId, 'hex'), 'x')
  saldirgan.yaz('durum', b4a.from(JSON.stringify(kodla(g))))
  t.is(hataOfSenk(() => new Kalici({ dizin, testKipi: true, now: saat() })), 'STATE_CORRUPT')
  // Şifreli kipte aynı saldırı: anahtarsız yazılan dosya açılmaz
  const d2 = geciciDizin(t)
  const b = aileVeKayit(t, d2)
  b.k.kapat()
  new Depo({ dizin: d2, testKipi: true }).yaz('durum', b4a.from(JSON.stringify(kodla(g))))
  t.is(hataOfSenk(() => new Kalici({ dizin: d2, anahtar: ANAHTAR, archivePubHex: ARSIV.pubHex, now: saat() })), 'STATE_CORRUPT')
})

test('S3, S5: kimlik ya da durum silinirse STATE_CORRUPT (sessiz yeni kimlik ya da ailesiz açılış yok)', (t) => {
  const d1 = geciciDizin(t)
  aileVeKayit(t, d1).k.kapat()
  fs.unlinkSync(d1 + '/kimlik')
  let e = null
  try { new Kalici({ dizin: d1, anahtar: ANAHTAR, archivePubHex: ARSIV.pubHex }) } catch (x) { e = x } // eslint-disable-line no-new
  t.alike([e && e.message, e && e.dosya], ['STATE_CORRUPT', 'kimlik'])
  const d2 = geciciDizin(t)
  aileVeKayit(t, d2).k.kapat()
  fs.unlinkSync(d2 + '/durum')
  e = null
  try { new Kalici({ dizin: d2, anahtar: ANAHTAR, archivePubHex: ARSIV.pubHex }) } catch (x) { e = x } // eslint-disable-line no-new
  t.alike([e && e.message, e && e.dosya], ['STATE_CORRUPT', 'durum'])
  // Başka dizinin kimliği konursa özet uymaz
  const d3 = geciciDizin(t)
  aileVeKayit(t, d3).k.kapat()
  fs.writeFileSync(d3 + '/kimlik', fs.readFileSync(d1 + '/../' + d2.split('/').pop() + '/kimlik'))
  t.is(hataOfSenk(() => new Kalici({ dizin: d3, anahtar: ANAHTAR, archivePubHex: ARSIV.pubHex })), 'STATE_CORRUPT')
})

test('S4: eski durum geri konursa uygulamanın sayacıyla STATE_ROLLED_BACK; sayaç her yazımda artar', (t) => {
  const dizin = geciciDizin(t)
  const sayaclar = []
  const { k, n, cid } = aileVeKayit(t, dizin, { kaydedildi: (s) => sayaclar.push(s) })
  const eski = fs.readFileSync(dizin + '/durum')
  n.kayit.put(cid, null, 'yuva.defter.not', { baslik: 'sonraki' })
  k.kaydet()
  const son = sayaclar.at(-1)
  t.ok(sayaclar.every((s, i) => i === 0 || s === sayaclar[i - 1] + 1), 'tekdüze artar')
  k.kapat()
  fs.writeFileSync(dizin + '/durum', eski)
  t.is(hataOfSenk(() => new Kalici({ dizin, anahtar: ANAHTAR, archivePubHex: ARSIV.pubHex, sayac: son })), 'STATE_ROLLED_BACK')
  const k2 = new Kalici({ dizin, anahtar: ANAHTAR, archivePubHex: ARSIV.pubHex, sayac: son - 1 })
  t.is(k2.sayac, son - 1, 'sayaç uygulamanınkine eşitse açılır')
  k2.kapat()
  // Hiç dosya yokken uygulama bir sayaç biliyorsa (dizin silindi)
  t.is(hataOfSenk(() => new Kalici({ dizin: geciciDizin(t), anahtar: ANAHTAR, archivePubHex: ARSIV.pubHex, sayac: 5 })), 'STATE_ROLLED_BACK')
})

test('S6: ikinci start ALREADY_STARTED; kapat sonrası yeniden başlar', async (t) => {
  const dizin = geciciDizin(t)
  const ipc = ipcCifti()
  const w = await start({ urunSunucusu, dizin, now: saat(), ipc, anahtar: ANAHTAR, archivePubHex: ARSIV.pubHex })
  t.is(await hataOf(start({ urunSunucusu, dizin, now: saat(), ipc, anahtar: ANAHTAR, archivePubHex: ARSIV.pubHex })), 'ALREADY_STARTED')
  t.is(ipc.dinleyiciSayisi(), 1)
  w.kapat()
  const w2 = await start({ urunSunucusu, dizin, now: saat(), ipc, anahtar: ANAHTAR, archivePubHex: ARSIV.pubHex })
  t.is(ipc.dinleyiciSayisi(), 1)
  w2.kapat()
})

test('S7: aynı dizin ikinci kez açılamaz (DIR_LOCKED); kapatınca açılır; ölü sürecin kilidi bırakılmış sayılır', (t) => {
  const dizin = geciciDizin(t)
  const { k } = aileVeKayit(t, dizin)
  t.is(hataOfSenk(() => new Kalici({ dizin, anahtar: ANAHTAR, archivePubHex: ARSIV.pubHex })), 'DIR_LOCKED')
  k.kapat()
  const b = new Kalici({ dizin, anahtar: ANAHTAR, archivePubHex: ARSIV.pubHex })
  b.kapat()
  fs.writeFileSync(dizin + '/kilit', '999999999') // düşmüş süreç
  const c = new Kalici({ dizin, anahtar: ANAHTAR, archivePubHex: ARSIV.pubHex })
  c.kapat()
})

test('S8: öneksiz yazım kanalı yutmaz: kanal olayı gelir, akış kapanır (uygulama worklet\'i yeniden başlatır)', async (t) => {
  const ipc = ipcCifti()
  const c = istemci(ipc)
  const w = await calistir(t, { dizin: geciciDizin(t), ipc })
  ipc.ver(b4a.from(JSON.stringify({ id: 99, komut: 200, govde: {} })))
  t.is(w.durum.gecersiz, 1)
  t.alike(c.olaylar.find((o) => o.olay === 'channel'), { id: null, olay: 'channel', govde: { hata: 'INVALID_FRAME' } })
  t.is(ipc.dinleyiciSayisi(), 0, 'akış kapandı, bekleyen bayt yutulmuyor')
})

test('S9: sunucu fırlatırsa komut kendi kimliğiyle hata alır (asılı kalmaz)', async (t) => {
  const ipc = ipcCifti()
  const c = istemci(ipc)
  await calistir(t, { dizin: geciciDizin(t), ipc, urunSunucusu: () => ({ isle: async () => { throw new Error('X') }, olaylariBagla: () => {} }) })
  t.is(await zamanAsimi(c.iste(1)), 'hata:INTERNAL_ERROR')
})

test('S10: 1 MiB üstü geri çağrı komutu INVALID_FRAME ile reddeder', async (t) => {
  const ipc = ipcCifti()
  const c = istemci(ipc, { cagri: () => 'tamam' })
  let gonder = null
  const sunucu = () => ({
    olaylariBagla: (g) => { gonder = g },
    isle: async (m) => {
      const j = JSON.parse(m)
      if ('cagriId' in j) return null
      await new Promise(() => { gonder(JSON.stringify({ cagri: 'onayEkrani', id: 1, veri: 'x'.repeat(1024 * 1024 + 10) })) })
    }
  })
  const w = await calistir(t, { urunSunucusu: sunucu, dizin: geciciDizin(t), ipc })
  t.is(await zamanAsimi(c.iste(1)), 'hata:INVALID_FRAME')
  t.is(w.durum.atilan, 1)
  // Örnek ürün sunucusu (reddet kancasıyla): komutun kendi kimliğiyle
  const ipc2 = ipcCifti()
  const c2 = istemci(ipc2, { cagri: () => 'tamam' })
  w.kapat()
  await calistir(t, { dizin: geciciDizin(t), ipc: ipc2 })
  // İstek tam sınırda (1 MiB); geri çağrı çerçevesi (cagri, id, komutId eklenir) sınırı aşar
  const boy = 1024 * 1024 - b4a.byteLength(JSON.stringify({ id: 1, komut: KOMUT.EXAMPLE_CALLBACK, govde: { buyuk: '' } }))
  t.is(await zamanAsimi(c2.iste(KOMUT.EXAMPLE_CALLBACK, { buyuk: 'x'.repeat(boy) })), 'hata:INVALID_FRAME')
})

test('S11: açılan dosyalar kapatışta, başlatmada ve süresi dolunca silinir', async (t) => {
  const dizin = geciciDizin(t)
  const acilanDizin = geciciDizin(t, 'acilan')
  fs.writeFileSync(acilanDizin + '/eski-oturum.txt', 'kalan')
  const ipc = ipcCifti()
  const c = istemci(ipc)
  const w = await calistir(t, { dizin, ipc, acilanDizin, acilanOmurMs: 50 })
  t.absent(fs.existsSync(acilanDizin + '/eski-oturum.txt'), 'başlatmada önceki oturumun dosyası silindi')
  await c.iste(KOMUT.CREATE_FAMILY, { aileAdi: 'E', benimAdim: 'K' })
  const ref = await c.iste(KOMUT.RECORD_ATTACH, { bytes: { $b: b4a.toString(b4a.from('GIZLI BELGE'), 'base64') }, mime: 'text/plain', name: 'a.txt' })
  const bir = (await c.iste(KOMUT.RECORD_OPEN, { blobRef: ref })).path
  t.ok(fs.existsSync(bir))
  await bekle(120)
  t.absent(fs.existsSync(bir), 'süre dolunca silindi')
  const iki = (await c.iste(KOMUT.RECORD_OPEN, { blobRef: ref })).path
  w.kapat()
  t.absent(fs.existsSync(iki), 'kapatışta silindi')
})

test('S12: anahtar bekleyen yazım diskte açık metin değil (durum şifreli)', (t) => {
  const dizin = geciciDizin(t)
  const { k, n, cid } = aileVeKayit(t, dizin)
  const r = n.replika
  const yedek = new Map(r.keys.epochs)
  r.keys.epochs.clear()
  try { n.kayit.put(cid, null, 'yuva.defter.not', { baslik: 'KUYRUKTAKI SIR' }) } catch {}
  for (const [a, b] of yedek) r.keys.epochs.set(a, b)
  k.kaydet()
  t.absent(icerir(fs.readFileSync(dizin + '/durum'), b4a.from('KUYRUKTAKI SIR')))
})

test('kasa arşivi: kasa anahtarları durumda yok, arsivde mühürlü; 224 açar, 19 ve işlemsizlik kapatır', (t) => {
  const dizin = geciciDizin(t)
  let now = 1_800_000_000_000
  const saati = () => now
  const k = new Kalici({ dizin, now: saati, anahtar: ANAHTAR, archivePubHex: ARSIV.pubHex })
  const n = k.aileKur({ aileAdi: 'Rivera', benimAdim: 'Alex' })
  t.is(n.defter.myPersonalVault().durum, 'uygulandi')
  n.kayit.sync()
  const kasaCid = n.kayit.collections().find((x) => x.name === 'Benim kasam').collectionId
  t.is(hataOfSenk(() => n.kayit.put(kasaCid, null, 'yuva.defter.sifre', { ad: 'Banka' })), 'VAULT_LOCKED')
  t.is(hataOfSenk(() => n.kasa.unlock('ab'.repeat(32))), 'WRONG_LOCK_KEY')
  n.kasa.unlock(ARSIV.skHex)
  const rid = n.kayit.put(kasaCid, null, 'yuva.defter.sifre', { ad: 'Banka', parola: 'p4r0l4' })
  t.is(n.kayit.get(kasaCid, rid).fields.parola, 'p4r0l4')
  k.kaydet()
  const durum = coz(JSON.parse(b4a.toString(new Depo({ dizin, anahtar: ANAHTAR }).oku('durum'))))
  t.absent(durum.replika.anahtarlar.some((s) => s.cid === kasaCid), 'kasa anahtarı durumda yok')
  t.ok(durum.replika.anahtarlar.length > 0, 'öbür koleksiyonların anahtarları durumda')
  t.ok(fs.existsSync(dizin + '/arsiv'), 'arsiv var')
  // 19 LOCK: bellekten çıkar
  n.kasa.lock()
  t.is(n.replika.records(kasaCid).length, 0, 'kilitliyken replika kasa kaydını çözemez')
  t.absent([...n.replika.keys.epochs.values()].some((s) => s.cid === kasaCid))
  t.is(hataOfSenk(() => n.kayit.get(kasaCid, rid)), 'VAULT_LOCKED')
  n.kasa.unlock(ARSIV.skHex)
  t.is(n.kayit.get(kasaCid, rid).fields.parola, 'p4r0l4', '224 açınca yeniden okunur')
  // 5 dakika işlemsizlik
  now += 5 * 60_000
  t.ok(n.kasa.locked())
  t.is(n.replika.records(kasaCid).length, 0, 'işlemsizlikte de bellekten çıktı')
  k.kapat()
  // Yeniden açılış kilitli başlar; arsivle açılır
  const k2 = new Kalici({ dizin, now: saati, anahtar: ANAHTAR, archivePubHex: ARSIV.pubHex })
  const m = k2.nesneler
  t.is(m.replika.records(kasaCid).length, 0, 'açılışta kilitli')
  m.kasa.unlock(ARSIV.skHex)
  t.is(m.kayit.get(kasaCid, rid).fields.parola, 'p4r0l4')
  k2.kapat()
})

test('göç: açık kipte yazılmış dizin şifreli kiple açılınca bir kez taşınır; tersi STATE_MODE_MISMATCH', (t) => {
  const dizin = geciciDizin(t)
  const k = new Kalici({ dizin, testKipi: true, now: saat() })
  const n = k.aileKur({ aileAdi: 'Rivera', benimAdim: 'Alex' })
  const cid = n.kayit.collections()[0].collectionId
  const rid = n.kayit.put(cid, null, 'yuva.defter.not', { baslik: 'göç' })
  k.kaydet()
  k.kapat()
  t.is(fs.readFileSync(dizin + '/durum')[5], 0, 'açık kip')
  const k2 = new Kalici({ dizin, anahtar: ANAHTAR, archivePubHex: ARSIV.pubHex, now: saat() })
  t.is(k2.nesneler.kayit.get(cid, rid).fields.baslik, 'göç')
  for (const f of ['kimlik', 'hlc', 'durum']) t.is(fs.readFileSync(dizin + '/' + f)[5], 1, f + ' şifreli kipe taşındı')
  k2.kapat()
  t.is(hataOfSenk(() => new Kalici({ dizin, testKipi: true })), 'STATE_MODE_MISMATCH')
})

test('durum sürümü göçü: sürüm 1 (özetsiz, sayaçsız) sürüm 2\'ye taşınır ve yeniden yazılır', (t) => {
  const dizin = geciciDizin(t)
  const { k } = aileVeKayit(t, dizin)
  const g = coz(JSON.parse(b4a.toString(k.depo.oku('durum'))))
  delete g.kimlikOzet
  delete g.sayac
  g.v = 1
  k.depo.yaz('durum', b4a.from(JSON.stringify(kodla(g))))
  k.kapat()
  const k2 = new Kalici({ dizin, anahtar: ANAHTAR, archivePubHex: ARSIV.pubHex })
  const yeni = coz(JSON.parse(b4a.toString(k2.depo.oku('durum'))))
  t.is(yeni.v, DURUM_SURUMU)
  t.ok(yeni.kimlikOzet && yeni.sayac === 1)
  k2.depo.yaz('durum', b4a.from(JSON.stringify(kodla({ ...yeni, v: 99 }))))
  k2.kapat()
  t.is(hataOfSenk(() => new Kalici({ dizin, anahtar: ANAHTAR, archivePubHex: ARSIV.pubHex })), 'STATE_VERSION', 'bilinmeyen sürüm göç edilmez')
})

test('şüpheliler: prototip anahtarı reddedilir; çekirdeğin dizinindeki dosya kayda eklenemez', async (t) => {
  t.is(hataOfSenk(() => coz(JSON.parse('{"__proto__":{"x":1}}'))), 'STATE_CORRUPT')
  t.is(hataOfSenk(() => coz(JSON.parse('{"$o":{"constructor":1}}'))), 'STATE_CORRUPT')
  const dizin = geciciDizin(t)
  const ipc = ipcCifti()
  const w = await calistir(t, { dizin, ipc })
  w.kalici.aileKur({ aileAdi: 'E', benimAdim: 'K' })
  t.is(hataOfSenk(() => w.kalici.nesneler.kayit.attach({ path: dizin + '/kimlik' })), 'NO_FILE')
  t.is(hataOfSenk(() => w.kalici.nesneler.kayit.attach({ path: dizin + '/../' + dizin.split('/').pop() + '/durum' })), 'NO_FILE')
  t.ok(cerceveYaz('{}'))
})

test('D31: gönderilecek ve tutulan paylar durumda yok, arsivde; kilitliyken bellekte değil, açınca geri gelir', async (t) => {
  const S = require('@havenfold/sdk')
  const A = require('../../core/records/test/helpers/family')
  const dizin = geciciDizin(t)
  const k = new Kalici({ dizin, now: () => A.TS0 + 3_600_000, anahtar: ANAHTAR, archivePubHex: ARSIV.pubHex, kimlik: A.K.kerem })
  const n = k.aileBagla(A.anaDefter())
  await n.kasa.setupBackupKey(b4a.alloc(32, 5))
  t.is(n.kasa.outgoing().length, 2)
  // Hüsniye'nin YA payı Kerem'e gelir (Kerem tutucu)
  const hus = new S.VaultApi({ ledger: n.ledger, me: A.K.husniye, now: () => A.TS0 + 3_600_000 })
  await hus.setupBackupKey(b4a.alloc(32, 6))
  const bana = hus.outgoing().find((x) => x.to === b4a.toString(A.K.kerem.memberId, 'hex'))
  n.kasa.receiveShare(b4a.toString(A.K.husniye.memberId, 'hex'), bana.bytes, 'dogrudan')
  t.is(n.kasa.tutucu.paylar.size, 1)
  const payBayti = b4a.toString(K_payOf(n.kasa), 'hex')
  k.kaydet()
  t.is(n.kasa.tutucu.paylar.size, 0, 'kasa kilitliyken gelen pay kaydedilince bellekten çıkar (arsive mühürlendi)')
  const durum = b4a.toString(new Depo({ dizin, anahtar: ANAHTAR }).oku('durum'))
  t.absent(durum.includes('gonderilecek:'), 'pay baytı durumda yok')
  t.absent(durum.includes(payBayti), 'tutulan pay durumda yok')
  k.kapat()
  const k2 = new Kalici({ dizin, now: () => A.TS0 + 3_600_000, anahtar: ANAHTAR, archivePubHex: ARSIV.pubHex })
  const m = k2.nesneler
  t.alike(m.kasa.outgoing(), [], 'kilitli: gönderilecekler arsivde')
  t.is(m.kasa.tutucu.paylar.size, 0)
  t.is(m.kasa.status().ya.sahipler.filter((s) => s.tur === 'kisi').length, 2, 'özet durumda')
  m.kasa.unlock(ARSIV.skHex)
  t.is(m.kasa.outgoing().length, 2, 'açınca gönderilecekler geri')
  t.is(m.kasa.tutucu.paylar.size, 1, 'tutulan pay geri')
  m.kasa.lock()
  t.is(m.kasa.tutucu.paylar.size, 0, 'kilitlenince bellekten çıktı')
  k2.kapat()
})

function K_payOf (kasa) { return [...kasa.tutucu.paylar.values()][0].share.share }
