// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// demo.js — Havenfold'u tek makinede beş dakikada görmek için (npm run demo).
//
// Yeni mantık yazmaz: worklet'in uçtan uca testlerinin yardımcılarını (worklet/test/helpers/multi.js, device.js) ve
// worklet/test/transport.js, transport-box.js'in adımlarını kullanır. Her cihaz ayrı bir Node sürecidir ve gerçek
// @havenfold/worklet çekirdeğini çalıştırır; zarflar bu sürecin açtığı yerel HyperDHT testnet'i üstünden gider (dış ağa
// ya da genel önyükleme düğümlerine bağlanılmaz). Dizinler geçicidir, sonunda bütün süreçler kapanır ve dizinler silinir.
//
//   npm run demo                iki telefon: tören ve kayıt eşitlemesi
//   npm run demo -- --box       ayrıca Aile Kutusu: katılır, kör kopya tutar, çevrimdışı telefona kaydı ulaştırır
//
// Gerekenler: kökte ve worklet/'te npm ci. Çıktı İngilizce ve kısadır (README "Try it in five minutes").
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createRequire } = require('module')

const KOK = path.join(__dirname, '..')
const WORKLET = path.join(KOK, 'worklet')
const wRequire = createRequire(path.join(WORKLET, 'package.json'))

let createTestnet, BoruAgi, bekle, KOMUT, b4a, sodium
try {
  createTestnet = wRequire('hyperdht/testnet')
  b4a = wRequire('b4a')
  sodium = wRequire('sodium-native')
  ;({ BoruAgi, bekle } = require(path.join(WORKLET, 'test/helpers/multi')))
  ;({ KOMUT } = require(path.join(WORKLET, 'example/product')))
} catch (err) {
  console.error('Dependencies are missing. Run `npm ci` in the repository root and in worklet/ first.')
  console.error('(' + err.message.split('\n')[0] + ')')
  process.exit(1)
}

const KUTU = process.argv.includes('--box')
const SURE_MS = 90000 // güvenlik: bir şey takılırsa her şeyi kapatıp çık
// node/sas-names.json'daki 64 resmin aynı sırada İngilizce adları (yalnız ekrana yazmak için)
const RESIMLER = ['Cat', 'Dog', 'Horse', 'Bird', 'Fish', 'Butterfly', 'Cow', 'Rabbit', 'Moon', 'Sun', 'Star', 'Rainbow',
  'Snow', 'Fire', 'Wave', 'Lightning', 'Orange', 'Carrot', 'Pepper', 'Avocado', 'Cherry', 'Bread', 'Cheese', 'Pizza',
  'Bicycle', 'Car', 'Plane', 'Rocket', 'Sailboat', 'Train', 'Motorbike', 'Bus', 'Balloon', 'Gift', 'Guitar', 'Ball',
  'Basketball', 'Target', 'Note', 'Headphones', 'Key', 'Bell', 'Light bulb', 'Book', 'Pencil', 'Clock', 'Umbrella',
  'Compass', 'Tree', 'Cactus', 'Flower', 'Sapling', 'Leaf', 'Clover', 'Palm tree', 'Mountain', 'House', 'Tent', 'Castle',
  'Lighthouse', 'Anchor', 'Crown', 'Diamond', 'Coffee']

const rastgeleHex = (n) => { const b = b4a.alloc(n); sodium.randombytes_buf(b); return b4a.toString(b, 'hex') }
const arsivPub = () => {
  // Arşiv katmanının açık anahtarı (gerçekte biyometriyle açılan platform anahtarlığında; burada rastgele)
  const pk = b4a.alloc(32)
  const sk = b4a.alloc(32)
  sodium.crypto_box_keypair(pk, sk)
  return b4a.toString(pk, 'hex')
}
const sn = (ms) => ms < 1000 ? Math.round(ms) + ' ms' : (ms / 1000).toFixed(1) + ' s'
const yaz = (s) => console.log(s)
const tamam = (s) => yaz('  ✓ ' + s)

async function main () {
  const t0 = Date.now()
  const geciciKok = fs.mkdtempSync(path.join(os.tmpdir(), 'havenfold-demo-'))
  const kapanis = []
  let bitti = false
  const temizle = async () => {
    if (bitti) return
    bitti = true
    for (const f of kapanis.reverse()) { try { await f() } catch {} }
    fs.rmSync(geciciKok, { recursive: true, force: true })
  }
  const zamanlayici = setTimeout(async () => {
    console.error('Demo did not finish in ' + sn(SURE_MS) + '; stopping.')
    await temizle()
    process.exit(1)
  }, SURE_MS)

  try {
    yaz('Havenfold demo: every device below is a separate process running the real core, on one machine.')
    yaz('Network: a local HyperDHT testnet on 127.0.0.1; nothing leaves this machine. Data: temporary directories.')
    yaz('')

    const tn = await createTestnet(3)
    kapanis.push(() => tn.destroy())
    const ag = new BoruAgi() // yalnız süreç yönetimi; zarflar DHT'den gider
    const ayar = {}
    const acik = new Map()
    const ac = async (ad, ek) => {
      if (!ayar[ad]) ayar[ad] = { dizin: fs.mkdtempSync(path.join(geciciKok, ad + '-')), anahtarHex: rastgeleHex(32), arsiv: arsivPub(), sayac: null }
      const c = ag.cihaz(ad)
      ag.cevrimdisiYap(ad)
      await c.start({ dizin: ayar[ad].dizin, anahtarHex: ayar[ad].anahtarHex, archivePubHex: ayar[ad].arsiv, sayac: ayar[ad].sayac, dht: tn.bootstrap, yoklamaMs: 500, ...ek })
      acik.set(ad, c)
      return c
    }
    const kapat = async (ad) => { const c = acik.get(ad); acik.delete(ad); ayar[ad].sayac = (await c.kapat()).sayac }
    kapanis.push(async () => { for (const c of acik.values()) if (c.canli) await c.kapat().catch(() => {}) })

    const A = await ac('A', { ad: 'Alex', cihazAdi: "Alex's phone" })
    let B = await ac('B', { ad: 'Maya', cihazAdi: "Maya's phone" })
    const K = KUTU ? await ac('K', { ad: 'Family Box', cihazAdi: 'Family Box', node: true, kutuTasiyici: true }) : null
    tamam('Started ' + (KUTU ? 3 : 2) + ' devices: ' + (KUTU ? "Alex's phone, Maya's phone, a Family Box" : "Alex's phone, Maya's phone") + ' (no accounts: each device makes its own keys)')

    // --- Aile ve tören (worklet/test/transport.js ile aynı adımlar)
    await A.iste(KOMUT.CREATE_FAMILY, { aileAdi: 'Rivera', benimAdim: 'Alex' })
    tamam('Alex created family "Rivera" (a new signed ledger on Alex\'s phone)')
    const t1 = Date.now()
    await A.iste(KOMUT.INVITE_START, { tur: 'uye', rol: 'ebeveyn' })
    const qr = (await bekle(() => A.toren('qr'), { neden: 'QR', sure: 30000 })).qr
    await B.iste(KOMUT.JOIN, { kod: qr })
    const sa = await bekle(() => A.toren('sas'), { neden: 'A pictures', sure: 45000 })
    const sb = await bekle(() => B.toren('sas'), { neden: 'B pictures', sure: 45000 })
    const resim = (r) => r.map((i) => RESIMLER[i]).join(', ')
    if (resim(sa.resimler) !== resim(sb.resimler)) throw new Error('pictures differ')
    await B.iste(KOMUT.INVITE_CONFIRM, { ayni: true })
    await A.iste(KOMUT.INVITE_CONFIRM, { ayni: true })
    await bekle(() => A.toren('tamam') && B.toren('tamam'), { neden: 'ceremony', sure: 30000 })
    tamam('Maya opened Alex\'s QR code; both phones showed the same 5 pictures: ' + resim(sa.resimler))
    tamam('Both confirmed; Maya joined as a parent (' + sn(Date.now() - t1) + ')')

    // --- Kayıt: A yazar, B görür
    const tum = (await A.iste(KOMUT.RECORD_COLLECTIONS)).find((x) => x.name === 'Tüm Aile').collectionId
    const getir = (c, rid) => c.iste(KOMUT.RECORD_GET, { collectionId: tum, recordId: rid })
    const t2 = Date.now()
    const r1 = await A.iste(KOMUT.RECORD_PUT, { collectionId: tum, type: 'yuva.defter.not', fields: { baslik: 'Wi-Fi password is on the fridge' } })
    const g1 = await bekle(() => getir(B, r1), { neden: 'record on B', sure: 30000 })
    tamam('Alex wrote a note; it appeared on Maya\'s phone in ' + sn(Date.now() - t2) + ': "' + g1.fields.baslik + '"')
    yaz('    (the record is encrypted with the collection key and signed by Alex; only family members can read it)')

    if (K) {
      // --- Kutu (worklet/test/transport-box.js ile aynı adımlar): kutu QR gösterir, Alex tarar ve onaylar
      const t3 = Date.now()
      const kqr = await K.kutuQr()
      await A.iste(KOMUT.JOIN, { kod: kqr })
      await bekle(() => A.olaylar.filter((x) => x.olay === 'ceremony' && x.veri.adim === 'sas').length >= 2, { neden: 'box pictures', sure: 45000 })
      const ks = A.toren('sas')
      await A.iste(KOMUT.INVITE_CONFIRM, { ayni: true })
      await bekle(async () => (await K.iste(KOMUT.FAMILY_INFO)).aile, { neden: 'box in family', sure: 45000 })
      tamam('Alex added the Family Box with the same ceremony (pictures: ' + resim(ks.resimler) + '); it has no vote (' + sn(Date.now() - t3) + ')')
      await bekle(async () => (await K.kutuSayi()) >= 1, { neden: 'box holds copy', sure: 45000 })
      // Kutu okuyucu değildir, dönem anahtarı almaz (core/records/box.js): aynı kaydı kutuda okumayı dene
      const okuma = await K.iste(KOMUT.RECORD_GET, { collectionId: tum, recordId: r1 }).then((x) => x, (e) => e)
      const sonuc = okuma === null ? 'reading it on the box returns nothing' : okuma instanceof Error ? 'reading it on the box fails: ' + okuma.message : null
      if (!sonuc) throw new Error('the box could read the record')
      tamam('The box keeps a sealed copy of the note but has no key for it (' + sonuc + ')')

      // --- Çevrimdışı: Maya kapalıyken Alex yazar ve kapanır; Maya açılınca kaydı kutudan alır
      await kapat('B')
      const once = await K.kutuSayi()
      const r2 = await A.iste(KOMUT.RECORD_PUT, { collectionId: tum, type: 'yuva.defter.not', fields: { baslik: 'Dentist on Tuesday at 10' } })
      await bekle(async () => (await K.kutuSayi()) > once, { neden: 'box holds second copy', sure: 45000 })
      await kapat('A')
      tamam('Maya\'s phone was off; Alex wrote another note, then Alex\'s phone was switched off too')
      const t4 = Date.now()
      B = await ac('B', { ad: 'Maya', cihazAdi: "Maya's phone" })
      const g2 = await bekle(() => getir(B, r2), { neden: 'record from box', sure: 60000 })
      tamam('Maya\'s phone came back and got the note from the box in ' + sn(Date.now() - t4) + ': "' + g2.fields.baslik + '"')
    }

    const hatalar = [...acik.values()].flatMap((c) => c.hatalar)
    if (hatalar.length) throw new Error('core errors: ' + JSON.stringify(hatalar))
    await temizle()
    clearTimeout(zamanlayici)
    tamam('Stopped all processes and deleted the temporary directories (' + sn(Date.now() - t0) + ' in total)')
    if (!KUTU) yaz('\nNext: `npm run demo -- --box` adds a Family Box that keeps sealed copies for offline phones.')
  } catch (err) {
    clearTimeout(zamanlayici)
    console.error('\nDemo failed: ' + err.message)
    await temizle()
    process.exitCode = 1
  }
}

main()
