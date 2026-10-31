// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// disaster/dbus-adapter.js — dbus-next (MIT, saf JavaScript; İstek 164 onayı, D91) üstünde dbus-bluez.js'in istediği yüz:
//   cagir({ yol, arayuz, yontem, args }) · nesneler() · sinyal('InterfacesAdded' | 'PropertiesChanged', fn) ·
//   sun(yol, { [arayüz]: { ozellikler, yontemler } }) → { ozellikDegisti(arayuz, degisen) } · kaldir(yol) · kapat()
// Hedef her zaman org.bluez (sistem veri yolu). Varyantlar burada çevrilir: gelen değerler düz JavaScript (bayt dizisi
// Buffer), giden sözlükler (a{sv}) ve sunulan özellikler imza tablosuyla varyanta sarılır. Dosya tanıtıcısı
// (AcquireWrite/AcquireNotify) ve soyut soket kullanılmaz; dbus-next'in isteğe bağlı yerli parçası (usocket) yerine kökte
// boş paket var (node/disaster/usocket-stub), bağlantı Node'un net modülüyle kurulur.
'use strict'

const HEDEF = 'org.bluez'
const OM = 'org.freedesktop.DBus.ObjectManager'
const PROPS = 'org.freedesktop.DBus.Properties'
const KURULUM_MS = 10_000 // veri yolu ve org.bluez yanıt vermezse kurulum bu sürede düşer
const YENIDEN_MS = 30_000 // bluetoothd yoksa (sonra kalkabilir) sinyal kurulumu bu aralıkla yeniden denenir
// Giden sözlük anahtarlarının imzaları (SetDiscoveryFilter, ReadValue/WriteValue seçenekleri); bilinmeyen değerden tahmin
const SOZLUK_IMZA = {
  UUIDs: 'as', Transport: 's', DuplicateData: 'b', Discoverable: 'b', RSSI: 'n', Pathloss: 'q', Pattern: 's',
  type: 's', offset: 'q', mtu: 'q', device: 'o', link: 's', 'prepare-authorize': 'b'
}
// Sunulan nesnelerin özellik imzaları (GattService1, GattCharacteristic1, LEAdvertisement1)
const OZELLIK_IMZA = {
  UUID: 's', Primary: 'b', Service: 'o', Flags: 'as', Value: 'ay', Type: 's', ServiceUUIDs: 'as', IncludeTxPower: 'b', LocalName: 's'
}
// Sunulan yöntemlerin giriş ve çıkış imzaları
const YONTEM_IMZA = {
  ReadValue: ['a{sv}', 'ay'], WriteValue: ['aya{sv}', ''], StartNotify: ['', ''], StopNotify: ['', ''], Release: ['', ''],
  GetManagedObjects: ['', 'a{oa{sa{sv}}}']
}

function fail (code) { throw new Error(code) }

function tahmin (v) {
  if (typeof v === 'boolean') return 'b'
  if (typeof v === 'string') return v.startsWith('/') ? 'o' : 's'
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 ? 'u' : 'i'
  if (v instanceof Uint8Array) return 'ay'
  if (Array.isArray(v)) return 'as'
  fail('UNKNOWN_DBUS_TYPE')
}

const bayt = (v) => (v instanceof Uint8Array && !Buffer.isBuffer(v) ? Buffer.from(v.buffer, v.byteOffset, v.byteLength) : v)

/**
 * o: { dbus?: dbus-next modülü, bus?: açık veri yolu, adres?: veri yolu adresi (yalnız test: özel dbus-daemon) }.
 * Hiçbiri verilmezse sistem veri yolu açılır.
 */
function dbusUyarlayici ({ dbus = require('dbus-next'), bus = null, adres = null, kurulumMs = KURULUM_MS, yenidenMs = YENIDEN_MS } = {}) {
  const { Variant } = dbus
  const B = bus || (adres ? dbus.sessionBus({ busAddress: adres }) : dbus.systemBus())
  // Bağlantı hatası (soket yok, izin yok, bluetoothd düştü) olay olarak gelir; dinlenmezse süreç çöker
  let kopuk = null
  B.on('error', (e) => { kopuk = e })
  const dinleyici = { InterfacesAdded: [], PropertiesChanged: [] }
  const sunulan = new Map() // yol → { arayüz adı → Interface örneği }
  const vekiller = new Map() // yol → ProxyObject (her çağrıda yeniden içgözlem yapılmasın)
  let kuruldu = null
  let yeniden = null
  let kapandi = false

  // Gelen değer: Variant → değer, iç içe
  const ac = (v) => {
    if (v instanceof Variant) return ac(v.value)
    if (Buffer.isBuffer(v)) return v
    if (Array.isArray(v)) return v.map(ac)
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, ac(x)]))
    return v
  }
  const varyant = (tablo, k, v) => new Variant(tablo[k] || tahmin(v), bayt(v))
  const sozluk = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, varyant(SOZLUK_IMZA, k, v)]))
  const arguman = (a) => (a instanceof Uint8Array ? bayt(a) : a && typeof a === 'object' && !Array.isArray(a) ? sozluk(a) : a)

  async function vekil (p) {
    if (!vekiller.has(p)) vekiller.set(p, B.getProxyObject(HEDEF, p))
    try { return await vekiller.get(p) } catch (e) { vekiller.delete(p); throw e }
  }

  // PropertiesChanged org.bluez altındaki her nesneden (eşleşme kuralı kurulumda, gönderici org.bluez)
  B.on('message', (m) => {
    if (m.interface !== PROPS || m.member !== 'PropertiesChanged' || !m.path || !m.path.startsWith('/org/bluez')) return
    const [arayuz, degisen] = m.body
    for (const f of dinleyici.PropertiesChanged) { try { f(m.path, arayuz, ac(degisen)) } catch {} }
  })

  // Kurulum bir kez (düşerse sonraki çağrı yeniden dener; dinleyiciler çiftlenmez): ObjectManager sinyalleri ve eşleşme
  let omBagli = false
  let eslesme = false
  function kur () {
    if (kopuk) return Promise.reject(new Error('DBUS_DISCONNECTED'))
    if (kuruldu) return kuruldu
    let zaman
    const sinir = new Promise((resolve, reject) => { zaman = setTimeout(() => reject(new Error('DBUS_TIMEOUT')), kurulumMs) })
    kuruldu = Promise.race([sinir, (async () => {
      const om = (await vekil('/')).getInterface(OM)
      if (!omBagli) {
        omBagli = true
        om.on('InterfacesAdded', (p, a) => { for (const f of dinleyici.InterfacesAdded) { try { f(p, ac(a)) } catch {} } })
        om.on('InterfacesRemoved', (p) => { for (const y of vekiller.keys()) if (y === p || y.startsWith(p + '/')) vekiller.delete(y) })
      }
      if (!eslesme) {
        const d = (await B.getProxyObject('org.freedesktop.DBus', '/org/freedesktop/DBus')).getInterface('org.freedesktop.DBus')
        await d.AddMatch("type='signal',sender='" + HEDEF + "',interface='" + PROPS + "',member='PropertiesChanged',path_namespace='/org/bluez'")
        eslesme = true
      }
    })()]).finally(() => clearTimeout(zaman))
    kuruldu.catch(() => { kuruldu = null })
    return kuruldu
  }

  // Sunulan nesnenin bir arayüzü: dbus-next Interface sınıfı; özellikler okunur, yöntemler bağlanır
  function arayuzKur (ad, ozellikler, yontemler) {
    const deger = {}
    for (const [k, v] of Object.entries(ozellikler)) deger[k] = bayt(v)
    // Bildirim Value özelliğinin değişimiyle gider; GetManagedObjects'te yer almasa da arayüzde tanımlı olmalı
    if (ad === 'org.bluez.GattCharacteristic1' && !('Value' in deger)) deger.Value = Buffer.alloc(0)
    class Arayuz extends dbus.interface.Interface {}
    const properties = {}
    for (const k of Object.keys(deger)) {
      properties[k] = { signature: OZELLIK_IMZA[k] || tahmin(deger[k]), access: dbus.interface.ACCESS_READ }
      Object.defineProperty(Arayuz.prototype, k, { get () { return deger[k] }, configurable: true })
    }
    const methods = {}
    for (const [y, f] of Object.entries(yontemler)) {
      const [inSignature, outSignature] = YONTEM_IMZA[y] || ['', '']
      methods[y] = { inSignature, outSignature }
      Arayuz.prototype[y] = function (...a) {
        let r
        try { r = f(...a.map(ac)) } catch (e) {
          throw new dbus.DBusError(/^org\.bluez\.Error\.\w+$/.test(e.message) ? e.message : 'org.bluez.Error.Failed', e.message)
        }
        if (y !== 'GetManagedObjects') return bayt(r)
        const sar = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, varyant(OZELLIK_IMZA, k, v)]))
        return Object.fromEntries(Object.entries(r).map(([o, ifs]) => [o, Object.fromEntries(Object.entries(ifs).map(([n, pr]) => [n, sar(pr)]))]))
      }
    }
    Arayuz.configureMembers({ properties, methods })
    const ornek = new Arayuz(ad)
    return { ornek, deger }
  }

  return {
    async cagir ({ yol: p, arayuz, yontem, args = [] }) {
      await kur()
      const i = (await vekil(p)).getInterface(arayuz)
      if (!i || typeof i[yontem] !== 'function') fail('NO_DBUS_METHOD')
      return ac(await i[yontem](...args.map(arguman)))
    },
    async nesneler () {
      await kur()
      return ac(await (await vekil('/')).getInterface(OM).GetManagedObjects())
    },
    sinyal (ad, fn) {
      if (!dinleyici[ad]) fail('NO_DBUS_SIGNAL')
      dinleyici[ad].push(fn)
      const dene = () => {
        yeniden = null
        if (kapandi || kopuk) return
        kur().catch(() => {
          if (kapandi || kopuk || yeniden) return
          yeniden = setTimeout(dene, yenidenMs)
          if (yeniden.unref) yeniden.unref()
        })
      }
      if (!yeniden) dene()
    },
    sun (p, arayuzler) {
      const kurulan = {}
      for (const [ad, { ozellikler = {}, yontemler = {} }] of Object.entries(arayuzler)) {
        kurulan[ad] = arayuzKur(ad, ozellikler, yontemler)
        B.export(p, kurulan[ad].ornek)
      }
      sunulan.set(p, kurulan)
      return {
        ozellikDegisti (arayuz, degisen) {
          const o = kurulan[arayuz]
          if (!o) return
          for (const [k, v] of Object.entries(degisen)) o.deger[k] = bayt(v)
          dbus.interface.Interface.emitPropertiesChanged(o.ornek, Object.fromEntries(Object.keys(degisen).map((k) => [k, o.deger[k]])), [])
        }
      }
    },
    kaldir (p) {
      const o = sunulan.get(p)
      if (!o) return
      for (const { ornek } of Object.values(o)) B.unexport(p, ornek)
      sunulan.delete(p)
    },
    kapat () {
      kapandi = true
      clearTimeout(yeniden)
      try { B.disconnect() } catch {}
    }
  }
}

module.exports = { dbusUyarlayici, SOZLUK_IMZA, OZELLIK_IMZA, YONTEM_IMZA }
