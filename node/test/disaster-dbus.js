// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D91: dbus-next uyarlayıcısı (İstek 164) gerçek bir D-Bus üstünde — testte özel dbus-daemon ve sahte org.bluez hizmeti
// (aynı veri yolunda ikinci bağlantı). Varyant çevirisi, sinyaller, sunulan GATT nesneleri ve BlueZ'in onlara çağrısı,
// hata adları, BluezKoprusu'nun kayıt çağrıları; kutunun afet ayarı ve AfetDugum'un kutu sürecine bağlanması.
// dbus-daemon yoksa veri yolu testleri atlanır.
const test = require('brittle')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn, execFileSync } = require('child_process')
const b4a = require('b4a')
const dbus = require('dbus-next')
const { dbusUyarlayici } = require('../disaster/dbus-adapter')
const { BluezKoprusu, AfetDugum, GucIzleyici } = require('../disaster')
const { Hava } = require('./helpers/fake-bluez')
const AF = require('../../core/disaster/test/helpers/disaster-vector')

const { Interface, ACCESS_READ } = dbus.interface
const { Variant, DBusError } = dbus
const ADAPTOR = '/org/bluez/hci0'
const CIHAZ = ADAPTOR + '/dev_AA_BB_CC_DD_EE_FF'
const NITELIK = CIHAZ + '/service0001/char0002'
const bekle = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let daemonVar = true
try { execFileSync('dbus-daemon', ['--version'], { stdio: 'ignore' }) } catch { daemonVar = false }

// Özel oturum veri yolu: adresi döner, kapat() ile durur
async function veriYolu () {
  const dizin = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-dbus-'))
  const p = spawn('dbus-daemon', ['--session', '--nofork', '--print-address=1', '--address=unix:path=' + path.join(dizin, 'bus')], { stdio: ['ignore', 'pipe', 'inherit'] })
  const adres = await new Promise((resolve, reject) => {
    let s = ''
    p.stdout.on('data', (d) => { s += d; if (s.includes('\n')) resolve(s.trim().split('\n')[0]) })
    p.on('error', reject)
  })
  return { adres, kapat: () => { p.kill(); fs.rmSync(dizin, { recursive: true, force: true }) } }
}

// Sahte BlueZ: org.bluez adını alır; ObjectManager, Adapter1, GattManager1, LEAdvertisingManager1, Device1 ve bir nitelik
async function sahteBluez (adres) {
  const bus = dbus.sessionBus({ busAddress: adres })
  const kayit = { filtre: null, kesif: 0, uygulama: null, reklam: null, yazilan: [], baglan: 0 }
  const deger = { nitelik: Buffer.from('merhaba') }

  class Om extends Interface {
    GetManagedObjects () {
      return {
        [ADAPTOR]: { 'org.bluez.Adapter1': { Powered: new Variant('b', true), Address: new Variant('s', '00:11:22:33:44:55') } },
        [CIHAZ]: { 'org.bluez.Device1': { UUIDs: new Variant('as', ['0000feed-0000-1000-8000-00805f9b34fb']), RSSI: new Variant('n', -60), ServicesResolved: new Variant('b', false) } },
        [NITELIK]: { 'org.bluez.GattCharacteristic1': { UUID: new Variant('s', 'abcd'), MTU: new Variant('q', 185), Flags: new Variant('as', ['read', 'notify']) } }
      }
    }

    InterfacesAdded (yol, arayuzler) { return [yol, arayuzler] }
  }
  Om.configureMembers({ methods: { GetManagedObjects: { outSignature: 'a{oa{sa{sv}}}' } }, signals: { InterfacesAdded: { signature: 'oa{sa{sv}}' } } })

  class Adaptor extends Interface {
    get Powered () { return true }
    SetDiscoveryFilter (f) { kayit.filtre = f }
    StartDiscovery () { kayit.kesif++ }
    StopDiscovery () { kayit.kesif-- }
  }
  Adaptor.configureMembers({ properties: { Powered: { signature: 'b', access: ACCESS_READ } }, methods: { SetDiscoveryFilter: { inSignature: 'a{sv}' }, StartDiscovery: {}, StopDiscovery: {} } })

  class Gatt extends Interface {
    RegisterApplication (yol, sec) { kayit.uygulama = yol }
    UnregisterApplication (yol) { if (kayit.uygulama === yol) kayit.uygulama = null }
  }
  Gatt.configureMembers({ methods: { RegisterApplication: { inSignature: 'oa{sv}' }, UnregisterApplication: { inSignature: 'o' } } })

  class Reklam extends Interface {
    RegisterAdvertisement (yol, sec) { kayit.reklam = yol }
    UnregisterAdvertisement (yol) { if (kayit.reklam === yol) kayit.reklam = null }
  }
  Reklam.configureMembers({ methods: { RegisterAdvertisement: { inSignature: 'oa{sv}' }, UnregisterAdvertisement: { inSignature: 'o' } } })

  class Cihaz extends Interface {
    Connect () { kayit.baglan++ }
    Disconnect () {}
  }
  Cihaz.configureMembers({ methods: { Connect: {}, Disconnect: {} } })

  class Nitelik extends Interface {
    get Value () { return deger.nitelik }
    ReadValue (sec) { return deger.nitelik.subarray(sec.offset ? sec.offset.value : 0) }
    WriteValue (v, sec) {
      if (v.length === 0) throw new DBusError('org.bluez.Error.InvalidValueLength', 'boş')
      kayit.yazilan.push([Buffer.from(v), sec.type && sec.type.value])
    }

    StartNotify () {}
  }
  Nitelik.configureMembers({ properties: { Value: { signature: 'ay', access: ACCESS_READ } }, methods: { ReadValue: { inSignature: 'a{sv}', outSignature: 'ay' }, WriteValue: { inSignature: 'aya{sv}' }, StartNotify: {} } })

  const om = new Om('org.freedesktop.DBus.ObjectManager')
  const nitelik = new Nitelik('org.bluez.GattCharacteristic1')
  await bus.requestName('org.bluez', 0)
  bus.export('/', om)
  bus.export(ADAPTOR, new Adaptor('org.bluez.Adapter1'))
  bus.export(ADAPTOR, new Gatt('org.bluez.GattManager1'))
  bus.export(ADAPTOR, new Reklam('org.bluez.LEAdvertisingManager1'))
  bus.export(CIHAZ, new Cihaz('org.bluez.Device1'))
  bus.export(NITELIK, nitelik)
  return {
    bus,
    kayit,
    bildir (v) { deger.nitelik = v; Interface.emitPropertiesChanged(nitelik, { Value: v }, []) },
    ekle (yol, a) { om.InterfacesAdded(yol, a) },
    kapat () { bus.disconnect() }
  }
}

test('D91 uyarlayıcı: gerçek D-Bus üstünde çağrı, varyant çevirisi, sinyaller ve hata adları', { skip: !daemonVar }, async (t) => {
  const vy = await veriYolu()
  const bz = await sahteBluez(vy.adres)
  const d = dbusUyarlayici({ adres: vy.adres })
  t.teardown(() => { d.kapat(); bz.kapat(); vy.kapat() })

  // Giden a{sv}: imza tablosuyla varyant (UUIDs as, Transport s, DuplicateData b)
  await d.cagir({ yol: ADAPTOR, arayuz: 'org.bluez.Adapter1', yontem: 'SetDiscoveryFilter', args: [{ UUIDs: ['feed'], Transport: 'le', DuplicateData: false }] })
  const f = bz.kayit.filtre
  t.alike([f.UUIDs.signature, f.Transport.signature, f.DuplicateData.signature], ['as', 's', 'b'])
  t.alike([f.UUIDs.value, f.Transport.value, f.DuplicateData.value], [['feed'], 'le', false])
  await d.cagir({ yol: ADAPTOR, arayuz: 'org.bluez.Adapter1', yontem: 'StartDiscovery', args: [] })
  t.is(bz.kayit.kesif, 1)

  // Gelen: varyantlar açılır, bayt dizisi Buffer
  const n = await d.nesneler()
  t.is(n[ADAPTOR]['org.bluez.Adapter1'].Powered, true)
  t.alike(n[CIHAZ]['org.bluez.Device1'].UUIDs, ['0000feed-0000-1000-8000-00805f9b34fb'])
  t.is(n[NITELIK]['org.bluez.GattCharacteristic1'].MTU, 185)
  const okunan = await d.cagir({ yol: NITELIK, arayuz: 'org.bluez.GattCharacteristic1', yontem: 'ReadValue', args: [{ offset: 3 }] })
  t.ok(Buffer.isBuffer(okunan))
  t.is(okunan.toString(), 'haba', 'offset q varyantıyla gitti')
  await d.cagir({ yol: NITELIK, arayuz: 'org.bluez.GattCharacteristic1', yontem: 'WriteValue', args: [new Uint8Array([1, 2, 3]), { type: 'command' }] })
  t.alike(bz.kayit.yazilan, [[Buffer.from([1, 2, 3]), 'command']], 'Uint8Array ay olarak, seçenek s')

  // Hata adı çağırana olduğu gibi döner
  await t.exception(d.cagir({ yol: NITELIK, arayuz: 'org.bluez.GattCharacteristic1', yontem: 'WriteValue', args: [new Uint8Array(0), {}] }), /boş/)
  await t.exception(d.cagir({ yol: NITELIK, arayuz: 'org.bluez.GattCharacteristic1', yontem: 'Yok', args: [] }), /NO_DBUS_METHOD/)
  t.exception(() => d.sinyal('Baska', () => {}), /NO_DBUS_SIGNAL/)

  // Sinyaller: PropertiesChanged (nitelik bildirimi) ve InterfacesAdded (yeni cihaz)
  const degisen = []
  const eklenen = []
  d.sinyal('PropertiesChanged', (yol, arayuz, o) => degisen.push([yol, arayuz, o]))
  d.sinyal('InterfacesAdded', (yol, a) => eklenen.push([yol, a]))
  await bekle(100)
  bz.bildir(Buffer.from([9, 8, 7]))
  bz.ekle(ADAPTOR + '/dev_11', { 'org.bluez.Device1': { RSSI: new Variant('n', -40) } })
  for (let i = 0; i < 50 && (!degisen.length || !eklenen.length); i++) await bekle(20)
  t.alike(degisen, [[NITELIK, 'org.bluez.GattCharacteristic1', { Value: Buffer.from([9, 8, 7]) }]])
  t.alike(eklenen, [[ADAPTOR + '/dev_11', { 'org.bluez.Device1': { RSSI: -40 } }]])
})

test('D91 uyarlayıcı: sunulan GATT uygulaması — BlueZ GetManagedObjects, ReadValue, WriteValue ve bildirim', { skip: !daemonVar }, async (t) => {
  const vy = await veriYolu()
  const bz = await sahteBluez(vy.adres)
  const bus = dbus.sessionBus({ busAddress: vy.adres })
  const d = dbusUyarlayici({ bus })
  t.teardown(() => { d.kapat(); bz.kapat(); vy.kapat() })

  // BluezKoprusu'nun gerçek kayıt yolu: GATT hizmeti (TAGS oku, IN yaz, OUT bildir) ve reklam
  const k = new BluezKoprusu({ dbus: d })
  const gelen = []
  await k.gattSunucu({
    hizmet: 'feed',
    nitelikler: {
      a1: { bayraklar: ['read'], oku: () => b4a.from('etiketler') },
      a2: { bayraklar: ['write-without-response'], yaz: (cihaz, v) => gelen.push([cihaz, b4a.toString(v)]) },
      a3: { bayraklar: ['notify'] }
    }
  })
  t.is(bz.kayit.uygulama, '/app/havenfold/afet')
  await k.reklamBaslat({ hizmet: 'feed' })
  t.ok(bz.kayit.reklam, 'reklam kaydı')

  // BlueZ tarafı: uygulamayı bizim benzersiz adımızdan okur
  await bekle(50)
  const app = await bz.bus.getProxyObject(bus.name, '/app/havenfold/afet')
  const nesneler = await app.getInterface('org.freedesktop.DBus.ObjectManager').GetManagedObjects()
  const yollar = Object.keys(nesneler).sort()
  t.alike(yollar, ['/app/havenfold/afet/s0', '/app/havenfold/afet/s0/c0', '/app/havenfold/afet/s0/c1', '/app/havenfold/afet/s0/c2'])
  const c0 = nesneler['/app/havenfold/afet/s0/c0']['org.bluez.GattCharacteristic1']
  t.is(c0.UUID.signature, 's')
  t.alike(c0.Flags.value, ['read'])
  t.is(c0.Service.signature, 'o')
  t.is(nesneler['/app/havenfold/afet/s0']['org.bluez.GattService1'].Primary.value, true)

  const n0 = (await bz.bus.getProxyObject(bus.name, '/app/havenfold/afet/s0/c0')).getInterface('org.bluez.GattCharacteristic1')
  t.is(Buffer.from(await n0.ReadValue({})).toString(), 'etiketler')
  t.is(Buffer.from(await n0.ReadValue({ offset: new Variant('q', 4) })).toString(), 'etler', 'uzun okuma offset')
  await t.exception(n0.ReadValue({ offset: new Variant('q', 99) }), /InvalidOffset/, 'BlueZ hata adı korunur')
  const n1 = (await bz.bus.getProxyObject(bus.name, '/app/havenfold/afet/s0/c1')).getInterface('org.bluez.GattCharacteristic1')
  await n1.WriteValue(Buffer.from('selam'), { device: new Variant('o', CIHAZ), mtu: new Variant('q', 100) })
  t.alike(gelen, [[CIHAZ, 'selam']])
  t.is(k.mtular.get(CIHAZ), 100)
  await t.exception(n0.WriteValue(Buffer.from('x'), {}), /NotPermitted/)

  // Bildirim: OUT niteliğinin Value'su PropertiesChanged ile BlueZ'e
  const bildirim = []
  bz.bus.on('message', (m) => { if (m.member === 'PropertiesChanged' && m.path === '/app/havenfold/afet/s0/c2') bildirim.push(Buffer.from(m.body[1].Value.value)) })
  const kural = (await bz.bus.getProxyObject('org.freedesktop.DBus', '/org/freedesktop/DBus')).getInterface('org.freedesktop.DBus')
  await kural.AddMatch("type='signal',path='/app/havenfold/afet/s0/c2'")
  const c2 = (await bz.bus.getProxyObject(bus.name, '/app/havenfold/afet/s0/c2')).getInterface('org.freedesktop.DBus.Properties')
  t.is(Buffer.from((await c2.Get('org.bluez.GattCharacteristic1', 'Value')).value).length, 0, 'Value başta boş')
  await k.bildir(CIHAZ, 'a3', b4a.from([5, 6]))
  for (let i = 0; i < 50 && !bildirim.length; i++) await bekle(20)
  t.alike(bildirim, [Buffer.from([5, 6])])

  // Kapatınca kayıtlar silinir, nesneler kalkar
  await k.reklamDurdur()
  await k.gattKaldir()
  t.is(bz.kayit.uygulama, null)
  t.is(bz.kayit.reklam, null)
  await t.exception(app.getInterface('org.freedesktop.DBus.ObjectManager').GetManagedObjects())
})

test('D91 uyarlayıcı: org.bluez yoksa kurulum düşer, sinyal kurulumu yeniden denenir; veri yolu yoksa DBUS_DISCONNECTED', { skip: !daemonVar }, async (t) => {
  const vy = await veriYolu()
  const d = dbusUyarlayici({ adres: vy.adres, kurulumMs: 2000, yenidenMs: 100 })
  t.teardown(() => { d.kapat(); vy.kapat() })
  const eklenen = []
  d.sinyal('InterfacesAdded', (yol) => eklenen.push(yol))
  await t.exception(d.nesneler(), 'bluetoothd yok')
  // bluetoothd sonradan kalkar: sinyal kurulumu yeniden denenir
  const bz = await sahteBluez(vy.adres)
  t.teardown(() => bz.kapat())
  await bekle(400)
  bz.ekle(ADAPTOR + '/dev_22', { 'org.bluez.Device1': {} })
  for (let i = 0; i < 50 && !eklenen.length; i++) await bekle(20)
  t.alike(eklenen, [ADAPTOR + '/dev_22'])
  t.ok((await d.nesneler())[ADAPTOR])

  const yok = dbusUyarlayici({ adres: 'unix:path=' + path.join(os.tmpdir(), 'hf-dbus-yok-' + process.pid) })
  t.teardown(() => yok.kapat())
  await bekle(100)
  await t.exception(yok.nesneler(), /DBUS_DISCONNECTED/)
})

test('D91 kutu: afet ayarı dugum.toml\'dan; AfetDugum kutu sürecine (Bluetooth, D-Bus açılamazsa Bluetooth\'suz)', async (t) => {
  const { afetAyari, kutuAfeti, afetAgi, ayarlar } = require('../box')
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-kutu-afet-'))
  t.teardown(() => fs.rmSync(kok, { recursive: true, force: true }))
  fs.mkdirSync(path.join(kok, 'etc/havenfold'), { recursive: true })
  const toml = path.join(kok, 'etc/havenfold/dugum.toml')
  t.is(afetAyari(kok), 'kapali', 'dosya yok')
  fs.writeFileSync(toml, 'rol = "kutu"\nafet = "acik"   # Bluetooth\n')
  t.is(afetAyari(kok), 'acik')
  fs.writeFileSync(toml, 'rol = "kutu"\n[ag]\nafet = "acik"\n')
  t.is(afetAyari(kok), 'kapali', 'yalnız ilk bölüm')
  fs.writeFileSync(toml, 'afet = "evet"\n')
  t.is(afetAyari(kok), 'kapali', 'bilinmeyen değer')
  t.is(ayarlar({ HF_AFET: 'acik' }).afet, true)
  t.is(ayarlar({ HF_AFET: 'kapali' }).afet, false)
  t.is(ayarlar({ HF_DBUS_ADRES: 'unix:path=/x' }).dbusAdres, 'unix:path=/x')

  const L = AF.defter(AF.ZINCIR)
  const w = { kalici: { kimlik: AF.KIMLIK.kutu, nesneler: { aile: false, ledger: L }, afetSaklama: () => ({ get: () => null, set: () => {} }) }, kaydet: () => {} }
  const guc = () => new GucIzleyici({ oku: () => ({ prizde: true, pil: null }), saat: Date.now })
  // Kapalı: yalnız DisasterApi (D90 davranışı), Bluetooth'a dokunulmaz
  let acildi = 0
  const kapali = kutuAfeti(() => w, { acik: false, dbusOf: () => { acildi++ } })
  t.is(kapali(), null, 'aile yokken kurulmaz')
  w.kalici.nesneler.aile = true
  t.ok(kapali().state())
  t.is(kapali.dugum(), null)
  t.is(acildi, 0)
  // Açık: AfetDugum, D-Bus uyarlayıcısıyla Bluetooth
  const hava = new Hava()
  const acik = kutuAfeti(() => w, { acik: true, dbusOf: () => hava.dugum('kutu'), guc: guc() })
  const api = acik()
  t.is(acik(), api, 'bir kez kurulur')
  t.ok(acik.dugum(), 'AfetDugum')
  t.is(acik.dugum().afet, api, 'işçiden gelen AFET_MSG düğümün DisasterApi\'sine')
  await bekle(20)
  t.ok(acik.dugum().hal().bluetooth)
  // Ağ sarmalı: ilk oturumda afet kurulur (aile törenden sonra)
  let cagrildi = 0
  const sarmal = afetAgi({ gonder: () => true, dinle: (x) => { x.baglandi('p', {}) } }, () => { cagrildi++; return api }, () => L)
  sarmal.dinle({ baglandi: () => {}, koptu: () => {}, al: () => {} })
  t.is(cagrildi, 1)
  await acik.durdur()
  // D-Bus açılamazsa afet yine çalışır, Bluetooth'suz
  const hata = console.error
  const yazilan = []
  console.error = (...m) => yazilan.push(m.join(' '))
  const bozuk = kutuAfeti(() => w, { acik: true, dbusOf: () => { throw new Error('izin yok') }, guc: guc() })
  t.ok(bozuk())
  console.error = hata
  t.absent(bozuk.dugum().hal().bluetooth)
  t.ok(yazilan.some((m) => /D-Bus açılamadı/.test(m)))
  await bozuk.durdur()
})
