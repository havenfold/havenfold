// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D85: RFC-0012 adım 4 Linux tarafı ve §10 güç — sysfs okuma, güç izleyici (2 dk kesinti), görev oranı, GATT parçalama,
// BlueZ D-Bus köprüsü ve AfetBluez (benzetimli D-Bus ve BlueZ ile iki ve üç düğüm), denetçinin SAGLIK_ANLIK yayını.
const test = require('brittle')
const b4a = require('b4a')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { DisasterApi } = require('@havenfold/sdk')
const { gucOku, gorevOrani, GucIzleyici, KESINTI_MS, GattAkisi, BluezKoprusu, AfetBluez, AfetDugum, UUID } = require('../disaster')
const { Hava } = require('./helpers/fake-bluez')
const AF = require('../../core/disaster/test/helpers/disaster-vector')

const hex = (b) => b4a.toString(b, 'hex')
const DK = 60_000
const AN = 20750 * 86_400_000 + 15 * 3_600_000
const L = AF.defter(AF.ZINCIR)
const kim = (ad) => hex(AF.KIMLIK[ad].memberId)
const bekle = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function kadar (kosul, ms = 20000) { // CPU kotası ve kapsam koşusunda yavaş
  const son = Date.now() + ms
  while (!kosul()) { if (Date.now() > son) throw new Error('TIMEOUT'); await bekle(5) }
}

function sysfs (dosyalar) {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-guc-'))
  fs.mkdirSync(path.join(kok, 'etc/havenfold'), { recursive: true })
  fs.writeFileSync(path.join(kok, 'etc/havenfold/dugum.toml'), 'rol = "kutu"\nkanal = "kararli"\n')
  for (const [p, v] of Object.entries(dosyalar)) {
    const t = path.join(kok, 'sys/class/power_supply', p)
    fs.mkdirSync(path.dirname(t), { recursive: true })
    fs.writeFileSync(t, v + '\n')
  }
  return kok
}

test('D85 güç: sysfs okuma — priz, pil, şarj durumu; yoksa bilinmiyor', (t) => {
  t.alike(gucOku(sysfs({ 'AC/type': 'Mains', 'AC/online': '1', 'BAT0/type': 'Battery', 'BAT0/capacity': '80', 'BAT0/status': 'Discharging' })), { prizde: true, pil: 80, sarj: 'bosaliyor' })
  t.alike(gucOku(sysfs({ 'ACAD/type': 'Mains', 'ACAD/online': '0', 'BAT1/type': 'Battery', 'BAT1/capacity': '101', 'BAT1/status': 'Tuhaf' })), { prizde: false, pil: null, sarj: null })
  t.alike(gucOku(sysfs({ 'BAT0/type': 'Battery', 'BAT0/present': '0', 'BAT0/capacity': '50' })), { prizde: null, pil: null, sarj: null }, 'takılı olmayan pil sayılmaz')
  t.alike(gucOku(path.join(os.tmpdir(), 'hf-yok-' + Date.now())), { prizde: null, pil: null, sarj: null })
  t.alike(gucOku(sysfs({ 'AC/type': 'Mains', 'AC/online': '1', 'U/type': 'USB', 'U/online': '0', 'B/type': 'Battery', 'B/capacity': '100', 'B/status': 'Full' })).sarj, 'dolu')
})

test('D85 güç: izleyici — değişiklik hemen, kesinti 2 dk sonra, priz dönünce geldi; sinyal ve görev oranı', (t) => {
  let g = { prizde: true, pil: 90, sarj: 'dolu' }
  let simdi = AN
  const olaylar = []
  const iz = new GucIzleyici({ oku: () => g, saat: () => simdi, olay: (o) => olaylar.push(o.tur) })
  iz.yokla()
  iz.yokla()
  t.alike(olaylar, ['degisti'], 'aynı ölçüm yeniden bildirilmez')
  g = { prizde: false, pil: 90, sarj: 'bosaliyor' }
  iz.yokla()
  t.alike(iz.sinyal(), { dugum: { pilde: false, prizde: false }, pil: 90 }, 'kısa kesinti ETKİN yapmaz')
  simdi += KESINTI_MS - 1
  iz.yokla()
  t.alike(olaylar, ['degisti', 'degisti'])
  simdi += 1
  iz.yokla()
  t.alike(olaylar, ['degisti', 'degisti', 'kesinti'])
  t.ok(iz.sinyal().dugum.pilde)
  iz.yokla()
  t.is(olaylar.length, 3, 'kesinti bir kez')
  g = { prizde: true, pil: 88, sarj: 'sarj' }
  iz.yokla()
  t.alike(olaylar.slice(3), ['degisti', 'geldi'])
  // 30 sn'lik kesinti: geldi yok
  g = { prizde: false, pil: 88, sarj: 'bosaliyor' }
  iz.yokla()
  simdi += 30_000
  g = { prizde: true, pil: 88, sarj: 'sarj' }
  iz.yokla()
  t.alike(olaylar.slice(5), ['degisti', 'degisti'])
  t.is(gorevOrani({ prizde: true, pil: 10 }).tarama.acikMs, Infinity, 'prizde sürekli')
  t.is(gorevOrani({ prizde: false, pil: 45 }).tarama.acikMs, Infinity, 'pil ≥ %30 sürekli')
  t.alike(gorevOrani({ prizde: false, pil: 20 }).tarama, { acikMs: 5000, aralikMs: 180_000 }, 'pil < %30: telefonun ETKİN %15–30 satırı')
  t.is(gorevOrani({ prizde: false, pil: 20 }).duyuruMs, 60_000)
  t.is(gorevOrani({ prizde: null, pil: null }).duyuruMs, 30_000)
  const z = new GucIzleyici({ oku: () => g, yoklamaMs: 10 }).baslat()
  t.ok(z.zaman)
  z.durdur()
  t.is(z.zaman, null)
})

test('D85 GATT akışı: MTU − 3 parçalar, sıralı, kayıpsız; koptu', async (t) => {
  const giden = []
  const a = new GattAkisi({ yaz: async (p) => { await bekle(1); giden.push(p) }, mtu: 23 })
  const veri = b4a.from(Array.from({ length: 50 }, (_, i) => i))
  a.write(veri)
  await kadar(() => a.gidenBayt === 50)
  t.alike(giden.map((p) => p.byteLength), [20, 20, 10])
  t.alike(b4a.concat(giden), veri)
  t.is(a.gidenBayt, 50)
  t.is(new GattAkisi({ yaz: async () => {}, mtu: 10 }).parcaBoyu, 20, 'MTU en az 23')
  t.is(new GattAkisi({ yaz: async () => {}, mtu: 185 }).parcaBoyu, 182)
  const gelen = []
  a.on('data', (b) => gelen.push(b))
  a.al(b4a.from([1, 2]))
  await bekle(1)
  t.alike(gelen, [b4a.from([1, 2])])
  const kapandi = new Promise((resolve) => a.once('close', resolve))
  a.koptu()
  await kapandi
  a.al(b4a.from([3]))
  a.koptu()
  t.is(a.gelenBayt, 2, 'kopunca gelen yok sayılır')
  const h = new GattAkisi({ yaz: async () => { throw new Error('WRITE_FAILED') } })
  const hata = new Promise((resolve) => h.once('error', resolve))
  h.write(b4a.from([1]))
  t.is((await hata).message, 'WRITE_FAILED')
})

function aileDugumleri (adlar) {
  const hava = new Hava()
  const saat = { t: AN }
  const d = {}
  for (const ad of adlar) {
    const dbus = hava.dugum(ad)
    const afet = new DisasterApi({ me: AF.KIMLIK[ad], defter: () => L, saat: () => saat.t })
    const kopru = new BluezKoprusu({ dbus, baglanmaMs: 1000 })
    const bluez = new AfetBluez({ kopru, afet, saat: () => saat.t })
    bluez.acik = true // testler rolleri tek tek açar (cevre(), _taramaPlanla, _bulundu)
    d[ad] = { dbus, afet, kopru, bluez }
  }
  return { hava, saat, d }
}

test('D85 BlueZ: reklam yalnız hizmet kimliği; GATT uygulaması dört nitelik; kutu taşır, telefon alır (benzetimli D-Bus)', async (t) => {
  const { saat, d } = aileDugumleri(['kerem', 'kutu', 'husniye'])
  await d.kerem.bluez._kaydol()
  t.alike(d.kerem.dbus.reklam, { Type: 'peripheral', ServiceUUIDs: [UUID.HIZMET], IncludeTxPower: false }, 'ad ve cihaz kimliği yok')
  t.alike(Object.values(d.kerem.dbus.gatt).map((a) => Object.values(a)[0].UUID), [UUID.HIZMET, UUID.TAGS, UUID.IN, UUID.OUT, UUID.PSM])
  const [mid] = d.kerem.afet.send('metin', [kim('husniye')], 'Toplanma alanındayız')
  // Kutu tarar, Kerem'i bulur, eşitler (kutu taşır)
  await d.kutu.bluez._taramaPlanla()
  await kadar(() => d.kutu.bluez.olaylar.some((o) => o.tur === 'merkez-bitti'))
  t.is(d.kutu.afet.relayed().adet, 1)
  t.ok(d.kutu.dbus.cagrilar.includes('Device1.Disconnect'), 'iş bitince bağlantı kapanır (§6.4)')
  await kadar(() => !d.kerem.bluez.cevre)
  // Hüsniye'nin telefonu reklam yapar; kutu bulur ve verir
  await d.husniye.bluez._kaydol()
  saat.t += 1000
  await d.kutu.kopru.taramaDurdur()
  await d.kutu.bluez._taramaPlanla()
  await kadar(() => d.husniye.afet.messages().length === 1)
  t.is(d.husniye.afet.messages()[0].metin, 'Toplanma alanındayız')
  t.is(d.husniye.afet.messages()[0].durum, 'tasindi')
  await kadar(() => !d.kutu.afet.depo.tasinan.has(mid), 2000)
  t.pass('teslim bilgisi aynı bağda kutudan sildi')
  await d.kutu.bluez.durdur()
  await d.kerem.bluez.durdur()
  await d.husniye.bluez.durdur()
})

test('D85 BlueZ: eşleşmeyen cihaz 15 dk yok sayılır; yakın zamanda eşitlenene bağlanılmaz; çevrede ikinci merkez BUSY', async (t) => {
  const { hava, saat, d } = aileDugumleri(['kerem', 'kutu', 'irem'])
  // Aile dışı bir düğüm: reklam yapar ama etiketi tutmaz
  const yabanci = hava.dugum('yabanci')
  yabanci.sun('/x/s0/c0', { 'org.bluez.GattCharacteristic1': { ozellikler: { UUID: UUID.TAGS, Flags: ['read'] }, yontemler: { ReadValue: () => require('../../core/disaster/message').kodla(0xb4, { v: 1, slot: 1, tags: Array.from({ length: 25 }, () => b4a.alloc(4, 7)) }) } } })
  yabanci.gatt = { '/x/s0/c0': { 'org.bluez.GattCharacteristic1': { UUID: UUID.TAGS, Flags: ['read'] } } }
  yabanci.reklam = { ServiceUUIDs: [UUID.HIZMET] }
  const cihaz = d.kutu.dbus.cihazYolu('yabanci')
  d.kutu.dbus.cihazlar.set(cihaz, { karsi: 'yabanci', UUIDs: [UUID.HIZMET], Connected: false, ServicesResolved: false })
  t.is(await d.kutu.bluez._bulundu(cihaz), 'eslesmedi')
  t.is(await d.kutu.bluez._bulundu(cihaz), 'yok-sayildi')
  saat.t += 15 * DK
  t.is(await d.kutu.bluez._bulundu(cihaz), 'eslesmedi', '15 dk sonra yeniden denenir')
  // Kerem ile eşitle, hemen ikinci kez: gerek yok
  await d.kerem.bluez._kaydol()
  const kerem = d.kutu.dbus.cihazYolu('kerem')
  d.kutu.dbus.cihazlar.set(kerem, { karsi: 'kerem', UUIDs: [UUID.HIZMET], Connected: false, ServicesResolved: false })
  t.is(await d.kutu.bluez._bulundu(kerem), 'bitti')
  await kadar(() => !d.kerem.bluez.cevre)
  t.is(await d.kutu.bluez._bulundu(kerem), 'gerek-yok', '§9.2: yeni mesaj yoksa 5 dk')
  // Çevre rolünde ikinci merkezin bağlantısı kapatılır (yanıtsız yazma meşgul bildiremez; açıklama 2 madde 4)
  const koparilan = []
  d.kerem.kopru.cihaziKopar = async (c) => { koparilan.push(c) }
  d.kerem.bluez.cevre = { cihaz: 'baska', akis: { al () {}, koptu () {} } }
  t.absent(d.kerem.bluez._inYazildi('ucuncu', b4a.alloc(1)))
  d.kerem.bluez.cevre = null
  d.kerem.bluez.merkezBaglar = new Map([['a', {}], ['b', {}], ['c', {}]])
  t.absent(d.kerem.bluez._inYazildi('dorduncu', b4a.alloc(1)), 'en çok 3 bağ')
  d.kerem.bluez.merkezBaglar = new Map()
  t.alike(koparilan, ['ucuncu', 'dorduncu'])
  // Merkezde de en çok 3 bağ
  d.kutu.bluez.onbellek.clear() // tanınan adres önbelleği bağlanmadan 'gerek-yok' derdi
  d.kutu.bluez.merkezBaglar = new Map([['a', {}], ['b', {}], ['c', {}]])
  t.is(await d.kutu.bluez._bulundu(kerem), 'dolu')
  d.kutu.bluez.merkezBaglar = new Map()
  // Bağlanma hatası
  d.kutu.dbus.hata = (yontem) => (yontem === 'Connect' ? new Error('org.bluez.Error.Failed') : null)
  saat.t += 6 * DK
  t.is(await d.kutu.bluez._bulundu(kerem), 'hata')
  t.ok(d.kutu.bluez.olaylar.some((o) => o.tur === 'merkez-hata' && o.neden === 'org.bluez.Error.Failed'))
  d.kutu.dbus.hata = null
  t.absent(JSON.stringify(d.kutu.bluez.olaylar).includes('dev_'), 'olay kaydında adres yok')
})

test('D85 D-Bus köprüsü: nitelik yöntemleri, yanıtsız yazma, uzun okuma, bağ kopması, hizmetler hazır olmazsa süre aşımı, reklam durdurma', async (t) => {
  const { hava, d } = aileDugumleri(['kerem', 'kutu'])
  const k = d.kerem.kopru
  let yazilan = null
  await k.gattSunucu({ hizmet: UUID.HIZMET, nitelikler: { [UUID.TAGS]: { bayraklar: ['read'], oku: () => b4a.from([9]) }, [UUID.IN]: { bayraklar: ['write-without-response'], yaz: (c, b) => { if (b[0] === 0xff) throw new Error('BUSY'); if (b[0] === 0xfe) throw new Error('X'); yazilan = [c, b] } }, [UUID.OUT]: { bayraklar: ['notify'] } } })
  const n = (uuid) => d.kerem.dbus.nesne.get(k.nitelikler.get(uuid).yol)['org.bluez.GattCharacteristic1'].yontemler
  t.alike(n(UUID.TAGS).ReadValue({}), b4a.from([9]))
  t.exception(() => n(UUID.IN).ReadValue({}), /NotPermitted/)
  t.exception(() => n(UUID.TAGS).WriteValue([1], {}), /NotPermitted/)
  n(UUID.IN).WriteValue([1, 2], { device: '/d/x', mtu: 247 })
  t.alike(yazilan, ['/d/x', b4a.from([1, 2])])
  t.is(k.mtu('/d/x'), 247)
  // Yanıtsız yazmada karşıya hata dönmez (madde 8)
  n(UUID.IN).WriteValue([0xff], { device: '/d/y' })
  n(UUID.IN).WriteValue([0xfe], { device: '/d/y' })
  // Uzun okuma: offset (madde 11)
  t.alike(n(UUID.TAGS).ReadValue({ offset: 1 }), b4a.alloc(0))
  t.exception(() => n(UUID.TAGS).ReadValue({ offset: 2 }), /InvalidOffset/)
  n(UUID.OUT).StartNotify()
  n(UUID.OUT).StopNotify()
  await t.exception(k.bildir('/d/x', 'yok', b4a.alloc(1)), /NO_ATTRIBUTE/)
  await k.reklamDurdur()
  await k.reklamBaslat({ hizmet: UUID.HIZMET })
  await k.reklamDurdur()
  t.is(d.kerem.dbus.reklam, null)
  // Merkez: bağlan, kopma bildirimi
  await k.reklamBaslat({ hizmet: UUID.HIZMET })
  const bulunan = []
  await d.kutu.kopru.taramaBaslat({ hizmet: UUID.HIZMET }, (c) => bulunan.push(c))
  await kadar(() => bulunan.length)
  const bag = await d.kutu.kopru.baglan(bulunan[0])
  t.is(bag.mtu, 185)
  t.alike(await bag.oku(UUID.TAGS), b4a.from([9]))
  await t.exception(bag.oku('yok'), /NO_ATTRIBUTE/)
  const koptu = new Promise((resolve) => bag.koptu(resolve))
  const genel = new Promise((resolve) => d.kerem.kopru.koptu(resolve))
  d.kutu.dbus._kop('kerem')
  await koptu
  t.is(await genel, d.kerem.dbus.cihazYolu('kutu'), 'çevre de kopmayı görür')
  // Hizmetler hazır olmazsa
  const yavas = hava.dugum('yavas')
  yavas.reklam = { ServiceUUIDs: [UUID.HIZMET] }
  d.kutu.dbus.cihazlar.set(d.kutu.dbus.cihazYolu('yavas'), { karsi: 'yavas', UUIDs: [UUID.HIZMET], Connected: false, ServicesResolved: false })
  const asil = d.kutu.dbus.cagir.bind(d.kutu.dbus)
  d.kutu.dbus.cagir = async (o) => (o.yontem === 'Connect' ? undefined : asil(o))
  const kk = new BluezKoprusu({ dbus: d.kutu.dbus, baglanmaMs: 30 })
  const tut = setTimeout(() => {}, 500)
  await t.exception(kk.baglan(d.kutu.dbus.cihazYolu('yavas')), /CONNECT_TIMEOUT/)
  clearTimeout(tut)
  await d.kutu.kopru.taramaDurdur()
  await d.kutu.kopru.taramaDurdur()
})

test('D85 AfetDugum: güç sinyali durum makinesine; düğüm 2 dk pilde → ETKİN; Bluetooth yoksa yalnız durum', async (t) => {
  let g = { prizde: true, pil: 100, sarj: 'dolu' }
  let simdi = AN
  const guc = new GucIzleyici({ oku: () => g, saat: () => simdi })
  const dg = new AfetDugum({ me: AF.KIMLIK.kutu, defter: () => L, saat: () => simdi, guc, tikMs: 10 })
  await dg.baslat()
  t.is(dg.hal().durum, 'kapali')
  t.absent(dg.hal().bluetooth)
  g = { prizde: false, pil: 70, sarj: 'bosaliyor' }
  guc.yokla()
  t.is(dg.hal().durum, 'kapali', 'kısa kesinti')
  simdi += KESINTI_MS
  guc.yokla()
  t.is(dg.hal().durum, 'etkin', '§5.2 (4): düğüm pille çalışıyor')
  t.is(dg.hal().pil, 70)
  await dg.durdur()
  // Bluetooth ile
  const hava = new Hava()
  const d2 = new AfetDugum({ me: AF.KIMLIK.kutu, defter: () => L, saat: () => simdi, dbus: hava.dugum('kutu'), guc: new GucIzleyici({ oku: () => ({ prizde: false, pil: 20 }), saat: () => simdi }) })
  await d2.baslat()
  t.ok(d2.hal().bluetooth)
  const kd = hava.dugumler.get('kutu')
  t.absent(kd.reklam, 'KAPALI\'da reklam yok (açıklama 2 madde 2)')
  t.absent(kd.taramada, 'KAPALI\'da tarama yok')
  t.absent(kd.gatt, 'KAPALI\'da GATT yok')
  d2.afet.enable()
  await kadar(() => kd.taramada)
  t.ok(kd.reklam, 'açınca reklam')
  t.ok(kd.gatt, 'GATT kaydı')
  t.ok(kd.taramada, 'tarama penceresi açık (pil < %30)')
  d2.afet.close()
  await kadar(() => kd.cagrilar.includes('GattManager1.UnregisterApplication'))
  t.absent(kd.taramada)
  t.absent(kd.reklam)
  t.ok(kd.cagrilar.includes('GattManager1.UnregisterApplication'), 'GATT kaydı silindi (madde 13)')
  await d2.durdur()
})

test('D85 denetçi: güç değişince SAGLIK_ANLIK işçinin açık bağlantısına yeniden gider', async (t) => {
  const { Denetci } = require('../supervisor')
  const { saglikAnlik } = require('../supervisor-main')
  const { IPC } = require('../ipc/types')
  const { mesajCoz } = require('../ipc/frame')
  let kok = sysfs({ 'AC/type': 'Mains', 'AC/online': '1' })
  const dn = new Denetci({ kok: os.tmpdir(), hostId: b4a.alloc(16, 1), surum: '0.0.0', saglik: (k) => (k === 'isci' ? saglikAnlik({ kok }) : null) })
  t.absent(dn.saglikYenile('isci'), 'uç yokken gönderilmez')
  const uc = dn.uc('isci')
  const b = uc.baglan('havenfold-isci')
  const yazilan = []
  b.yaziciBagla((f) => yazilan.push(f))
  t.absent(dn.saglikYenile('isci'), 'MERHABA demeden gönderilmez')
  dn.merhaba.set('isci', { surum: '0.0.0', at: 0 })
  kok = sysfs({ 'AC/type': 'Mains', 'AC/online': '0', 'BAT0/type': 'Battery', 'BAT0/capacity': '64' })
  t.ok(dn.saglikYenile('isci'))
  const m = mesajCoz(yazilan[0].subarray(4))
  t.is(m.type, IPC.SAGLIK_ANLIK)
  t.is(m.mesaj.olcum.power.onAC, false, 'işçi prizden kesintiyi görür (health.js → status pil)')
  t.is(m.mesaj.olcum.power.battery.percent, 64)
  t.absent(dn.saglikYenile('kutu'), 'kutu kapsamının ucu yok')
  b.birak()
  t.absent(dn.saglikYenile('isci'), 'kapanan bağlantıya gitmez')
  t.absent(b.gonder(IPC.SAGLIK_ANLIK, {}))
  t.is(yazilan.length, 1)
})

test('D85 BlueZ: pil < %30 iken pencereli tarama (5 sn açık, 3 dk arayla); durdurunca plan biter', async (t) => {
  const { d } = aileDugumleri(['kutu'])
  const zamanlar = []
  const z = { setTimeout: (fn, ms) => { zamanlar.push({ fn, ms }); return zamanlar.length }, clearTimeout: () => {} }
  const b = new AfetBluez({ kopru: d.kutu.kopru, afet: d.kutu.afet, guc: { son: { prizde: false, pil: 20 } }, zamanlayici: z })
  await b.ac()
  t.ok(d.kutu.dbus.taramada)
  t.is(zamanlar[0].ms, 5000)
  await zamanlar[0].fn()
  t.absent(d.kutu.dbus.taramada, 'pencere kapandı')
  t.is(zamanlar[1].ms, 175_000)
  await zamanlar[1].fn()
  t.ok(d.kutu.dbus.taramada, 'sonraki pencere')
  await b.durdur()
  await b._taramaPlanla()
  t.absent(d.kutu.dbus.taramada, 'durunca yeniden açılmaz')
})

test('D87 madde 2: işçi yeni SAGLIK_ANLIK ile durumunu günceller, NODE_CAPS hemen yayılır (pilde görev yok)', (t) => {
  const { IsciAgi } = require('../worker')
  const V = require('../../core/core/test/helpers/v21')
  const a = new IsciAgi({ defter: () => null, me: V.C.isci1, ag: { gonder () {} }, istemci: {}, olcum: { onAC: true } })
  let yayin = 0
  a.capsYay = () => { yayin++ }
  t.is(a.caps().status, 'hazir')
  t.ok(a.olcumGuncelle({ onAC: false, battery: { percent: 60 } }))
  t.is(yayin, 1)
  t.is(a.caps().status, 'pil', 'RFC-0002 §4: pille çalışan işçi görev almaz')
  t.absent(a.olcumGuncelle({ onAC: false, battery: { percent: 59 } }), 'durum aynı: yayın yok')
  t.is(yayin, 1)
  t.ok(a.olcumGuncelle({ onAC: true }))
  t.is(a.caps().status, 'hazir')
  t.absent(a.olcumGuncelle(null) && false)
})

test('D87 madde 3, 6, 14: güç değişince tarama planı yenilenir; prizde pil bildirilmez; USB güç girişi priz sayılır', async (t) => {
  t.alike(gucOku(sysfs({ 'U/type': 'USB', 'U/online': '1', 'B/type': 'Battery', 'B/capacity': '40' })).prizde, true, 'USB-C güç girişi')
  t.alike(gucOku(sysfs({ 'U/type': 'USB_PD', 'U/online': '0', 'B/type': 'Battery', 'B/capacity': '40' })).prizde, false)
  const { saglikAnlik } = require('../supervisor-main')
  const kok = sysfs({ 'U/type': 'USB', 'U/online': '1', 'B/type': 'Battery', 'B/capacity': '40' })
  t.is(saglikAnlik({ kok }).olcum.power.onAC, true, 'denetçi aynı kuralla okur')
  let g = { prizde: true, pil: 10, sarj: 'sarj' }
  const iz = new GucIzleyici({ oku: () => g, saat: () => AN })
  iz.yokla()
  t.is(iz.sinyal().pil, null, 'prizde pil yok: taşıyıcı pil kuralı uygulanmaz')
  // AfetDugum: güç değişince planiYenile
  const hava = new Hava()
  const dg = new AfetDugum({ me: AF.KIMLIK.kutu, defter: () => L, saat: () => AN, dbus: hava.dugum('kutu'), guc: iz })
  await dg.baslat()
  t.is(dg.afet.state().pil, null)
  let yenilendi = 0
  dg.bluez.planiYenile = async () => { yenilendi++ }
  g = { prizde: false, pil: 25, sarj: 'bosaliyor' }
  iz.yokla()
  t.is(yenilendi, 1, 'tarama planı yenilendi (§9.3)')
  t.is(dg.afet.state().pil, 25, 'pille çalışırken pil bildirilir')
  await dg.durdur()
  // planiYenile: pencereli tarama sürekliye döner
  const { d } = aileDugumleri(['kutu'])
  const zamanlar = []
  const z = { setTimeout: (fn, ms) => { zamanlar.push({ fn, ms }); return zamanlar.length }, clearTimeout: () => {} }
  const guc = { son: { prizde: false, pil: 20 } }
  const b = new AfetBluez({ kopru: d.kutu.kopru, afet: d.kutu.afet, guc, zamanlayici: z })
  await b.ac()
  t.is(zamanlar.length, 1)
  guc.son = { prizde: true, pil: 20 }
  await b.planiYenile()
  t.is(zamanlar.length, 1, 'prizde sürekli tarama: yeni pencere zamanlayıcısı yok')
  t.ok(d.kutu.dbus.taramada)
  await b.kapat()
  await b.planiYenile()
  t.absent(d.kutu.dbus.taramada, 'kapalıyken yenilenmez')
})

test('D87 madde 4, 13: köprü hataları süreci düşürmez; bluetoothd dönünce yeniden kayıt; dinleyiciler birikmez', async (t) => {
  const { d } = aileDugumleri(['kutu'])
  const b = d.kutu.bluez
  b.acik = false
  d.kutu.dbus.hata = (yontem) => (yontem === 'RegisterAdvertisement' || yontem === 'StartDiscovery' ? new Error('org.bluez.Error.NotReady') : null)
  await b.ac()
  t.ok(b.olaylar.some((o) => o.tur === 'kayit-hata' && o.neden === 'org.bluez.Error.NotReady'))
  t.ok(b.olaylar.some((o) => o.tur === 'tarama-hata'))
  d.kutu.dbus.hata = null
  // bluetoothd yeniden başladı: adaptör InterfacesAdded
  const once = d.kutu.dbus.cagrilar.filter((x) => x === 'GattManager1.RegisterApplication').length
  d.kutu.dbus._yay('InterfacesAdded', '/org/bluez/hci0', { 'org.bluez.GattManager1': {} })
  await kadar(() => d.kutu.dbus.cagrilar.filter((x) => x === 'GattManager1.RegisterApplication').length === once + 1)
  await kadar(() => d.kutu.dbus.reklam)
  t.pass('GATT ve reklam yeniden kaydoldu')
  t.is(d.kutu.kopru.kopmaDinleyicileri.length, 1, 'kopma dinleyicisi bir kez')
  await b.kapat()
  await b.ac()
  t.is(d.kutu.kopru.kopmaDinleyicileri.length, 1, 'açıp kapatmak dinleyici eklemez')
  await b.kapat()
})

test('D87 madde 7, 9, 15: etiketi tutmayan merkez o dilim yok sayılır; bağ yazma kuyruğu boşalmadan kopmaz; budama', async (t) => {
  const { saat, d } = aileDugumleri(['kerem', 'kutu'])
  const koparilan = []
  d.kerem.kopru.cihaziKopar = async (c) => { koparilan.push(c) }
  await d.kerem.bluez._kaydol()
  // Yabancı merkez IN'e çöp yazar: etiket tutmaz, el sıkışma düşer, adres dilim sonuna kadar yok sayılır
  t.ok(d.kerem.bluez._inYazildi('/yabanci', b4a.alloc(8, 0xee)))
  await kadar(() => koparilan.includes('/yabanci'))
  await kadar(() => !d.kerem.bluez.cevre)
  t.ok(d.kerem.bluez.olaylar.some((o) => o.tur === 'cevre-hata' && o.neden === 'DISASTER_LABEL'))
  t.absent(d.kerem.bluez._inYazildi('/yabanci', b4a.alloc(4)), 'aynı dilimde reddedilir')
  t.is(d.kerem.bluez.yokSay.get('/yabanci'), (Math.floor(saat.t / (15 * DK)) + 1) * 15 * DK, 'dilim sonuna kadar')
  saat.t = d.kerem.bluez.yokSay.get('/yabanci')
  d.kerem.bluez._buda()
  t.absent(d.kerem.bluez.yokSay.has('/yabanci'), 'süresi dolan kayıt budandı')
  // Kapanış: yazma kuyruğu boşalmadan bağ kopmaz (bosalinca)
  const yazilan = []
  let bitir
  const akis = new GattAkisi({ yaz: (p) => new Promise((resolve) => { yazilan.push(p); bitir = resolve }) })
  akis.write(b4a.alloc(10))
  akis.end()
  let bosaldi = false
  akis.bosalinca(5000).then(() => { bosaldi = true })
  await bekle(20)
  t.absent(bosaldi, 'son parça yazılmadan çözülmez')
  bitir()
  await kadar(() => bosaldi)
  t.ok(akis.sonlandi)
  t.is(yazilan.length, 1)
  const tut = setTimeout(() => {}, 200)
  const a2 = new GattAkisi({ yaz: () => new Promise(() => {}) })
  a2.write(b4a.alloc(1))
  await a2.bosalinca(30) // süre dolunca da çözülür
  clearTimeout(tut)
  a2.koptu()
  await a2.bosalinca()
  t.pass()
})

test('D87 madde 10: tanınan adres aynı dilimde bağlanmadan geçilir; hata veren adrese geri çekilme; RSSI yeniden tetiklemez', async (t) => {
  const { saat, d } = aileDugumleri(['kerem', 'kutu'])
  await d.kerem.bluez._kaydol()
  const kerem = d.kutu.dbus.cihazYolu('kerem')
  d.kutu.dbus.cihazlar.set(kerem, { karsi: 'kerem', UUIDs: [UUID.HIZMET], Connected: false, ServicesResolved: false })
  t.is(await d.kutu.bluez._bulundu(kerem), 'bitti')
  await kadar(() => !d.kerem.bluez.cevre)
  const baglanma = () => d.kutu.dbus.cagrilar.filter((x) => x === 'Device1.Connect').length
  const n = baglanma()
  t.is(await d.kutu.bluez._bulundu(kerem), 'gerek-yok')
  t.is(baglanma(), n, 'bağlanmadan')
  // Hata: 30 sn geri çekilme, sonra katlanarak
  saat.t += 6 * DK
  d.kutu.dbus.hata = (y) => (y === 'Connect' ? new Error('org.bluez.Error.Failed') : null)
  t.is(await d.kutu.bluez._bulundu(kerem), 'hata')
  t.is(await d.kutu.bluez._bulundu(kerem), 'geri-cekildi')
  saat.t += 30_000
  t.is(await d.kutu.bluez._bulundu(kerem), 'hata')
  t.is(d.kutu.bluez.geri.get(kerem).bekleMs, 60_000, 'katlanır')
  d.kutu.dbus.hata = null
  saat.t += 60_000
  t.is(await d.kutu.bluez._bulundu(kerem), 'bitti')
  t.absent(d.kutu.bluez.geri.has(kerem), 'başarı geri çekilmeyi siler')
  // RSSI değişimi yeniden bağlanma sebebi değil
  const bulunan = []
  await d.kutu.kopru.taramaBaslat({ hizmet: UUID.HIZMET }, (c) => bulunan.push(c))
  const sayi = bulunan.length
  d.kutu.dbus._yay('PropertiesChanged', kerem, 'org.bluez.Device1', { RSSI: -40 })
  await bekle(10)
  t.is(bulunan.length, sayi)
  d.kutu.dbus._yay('PropertiesChanged', kerem, 'org.bluez.Device1', { UUIDs: [UUID.HIZMET] })
  await kadar(() => bulunan.length === sayi + 1)
  await d.kutu.kopru.taramaDurdur()
  // KAPALI'da merkez rolü yok
  d.kutu.bluez.acik = false
  t.is(await d.kutu.bluez._bulundu(kerem), 'kapali')
  t.absent(d.kutu.bluez._inYazildi('/x', b4a.alloc(1)) && false)
})
