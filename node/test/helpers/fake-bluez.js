// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Benzetimli BlueZ ve D-Bus (D85 testleri): birden çok düğümün "havası". Her düğüm dbus-bluez.js'in istediği D-Bus yüzünü
// (cagir, nesneler, sinyal, sun, kaldir) alır. Reklam yapan düğüm tarayana Device1 nesnesi olarak görünür; bağlanınca
// karşının sunduğu GATT nesneleri cihaz yolunun altında GattCharacteristic1 olarak belirir. Yanıtsız yazma ve bildirimler
// bir sonraki turda teslim edilir (gerçek radyodaki gibi eşzamansız).
const b4a = require('b4a')

const ADAPTOR = '/org/bluez/hci0'
const sonra = () => new Promise((resolve) => setImmediate(resolve))

class Hava {
  constructor ({ mtu = 185 } = {}) { this.dugumler = new Map(); this.mtu = mtu }

  dugum (ad) {
    const d = new SahteDbus(this, ad)
    this.dugumler.set(ad, d)
    return d
  }
}

class SahteDbus {
  constructor (hava, ad) {
    this.hava = hava
    this.ad = ad
    this.nesne = new Map() // dışa sunulan: yol → { arayüz: { ozellikler, yontemler } }
    this.dinleyici = { InterfacesAdded: [], PropertiesChanged: [] }
    this.gatt = null // RegisterApplication ile kaydedilen nesneler
    this.reklam = null
    this.taramada = false
    this.cihazlar = new Map() // yol → { karsi (ad), Connected, ServicesResolved, UUIDs }
    this.abonelik = new Map() // karşının nitelik yolu (kendi sunduğu) → [{ dugum, yol }] (OUT bildirimine abone merkezler)
    this.cagrilar = []
    this.hata = null // testte bir yöntemi düşürmek için: (yontem) → Error | null
  }

  cihazYolu (ad) { return ADAPTOR + '/dev_' + ad }
  _yay (ad, ...a) { for (const fn of this.dinleyici[ad]) fn(...a) }
  sinyal (ad, fn) { this.dinleyici[ad].push(fn) }

  sun (yol, arayuzler) {
    this.nesne.set(yol, arayuzler)
    return {
      ozellikDegisti: (arayuz, degisen) => {
        // Bildirim: bu niteliğe abone merkezlere
        for (const a of this.abonelik.get(yol) || []) setImmediate(() => a.dugum._yay('PropertiesChanged', a.yol, arayuz, degisen))
      }
    }
  }

  kaldir (yol) { this.nesne.delete(yol) }

  // Karşının (ad) kendi sunduğu nitelik yolu ↔ bendeki görünüşü
  _karsiNitelikleri (ad) {
    const k = this.hava.dugumler.get(ad)
    if (!k.gatt) return []
    return Object.entries(k.gatt).filter(([, a]) => a['org.bluez.GattCharacteristic1']).map(([yol, a], i) => ({
      uzak: yol, yerel: this.cihazYolu(ad) + '/service0001/char' + String(i + 1).padStart(4, '0'), ozellik: a['org.bluez.GattCharacteristic1']
    }))
  }

  async nesneler () {
    const out = {}
    for (const [yol, c] of this.cihazlar) {
      out[yol] = { 'org.bluez.Device1': { Address: c.karsi, UUIDs: c.UUIDs, Connected: c.Connected, ServicesResolved: c.ServicesResolved } }
      if (c.Connected) for (const n of this._karsiNitelikleri(c.karsi)) out[n.yerel] = { 'org.bluez.GattCharacteristic1': { UUID: n.ozellik.UUID, Flags: n.ozellik.Flags, MTU: this.hava.mtu } }
    }
    return out
  }

  async cagir ({ yol, arayuz, yontem, args }) {
    this.cagrilar.push(arayuz.split('.').pop() + '.' + yontem)
    const e = this.hata && this.hata(yontem, yol)
    if (e) throw e
    if (arayuz === 'org.bluez.GattManager1') {
      this.gatt = this.nesne.get(args[0])['org.freedesktop.DBus.ObjectManager'].yontemler.GetManagedObjects()
      return
    }
    if (arayuz === 'org.bluez.LEAdvertisingManager1') {
      if (yontem === 'RegisterAdvertisement') this.reklam = this.nesne.get(args[0])['org.bluez.LEAdvertisement1'].ozellikler
      else this.reklam = null
      return
    }
    if (arayuz === 'org.bluez.Adapter1') {
      if (yontem === 'StartDiscovery') {
        this.taramada = true
        for (const [ad, d] of this.hava.dugumler) {
          if (ad === this.ad || !d.reklam) continue
          const y = this.cihazYolu(ad)
          if (this.cihazlar.has(y)) continue
          const c = { karsi: ad, UUIDs: d.reklam.ServiceUUIDs, Connected: false, ServicesResolved: false }
          this.cihazlar.set(y, c)
          setImmediate(() => this._yay('InterfacesAdded', y, { 'org.bluez.Device1': { Address: ad, UUIDs: c.UUIDs } }))
        }
      }
      if (yontem === 'StopDiscovery') this.taramada = false
      return
    }
    if (arayuz === 'org.bluez.Device1') {
      const c = this.cihazlar.get(yol)
      const karsi = this.hava.dugumler.get(c.karsi)
      if (yontem === 'Connect') {
        c.Connected = true
        c.ServicesResolved = true
        karsi.cihazlar.set(karsi.cihazYolu(this.ad), { karsi: this.ad, UUIDs: [], Connected: true, ServicesResolved: true })
        setImmediate(() => this._yay('PropertiesChanged', yol, 'org.bluez.Device1', { Connected: true, ServicesResolved: true }))
      }
      if (yontem === 'Disconnect') this._kop(c.karsi)
      return
    }
    if (arayuz === 'org.bluez.GattCharacteristic1') {
      const ad = yol.split('/')[4].slice(4)
      const karsi = this.hava.dugumler.get(ad)
      const n = this._karsiNitelikleri(ad).find((x) => x.yerel === yol)
      const y = karsi.nesne.get(n.uzak)['org.bluez.GattCharacteristic1'].yontemler
      const benim = karsi.cihazYolu(this.ad)
      if (yontem === 'ReadValue') return y.ReadValue({ ...args[0], device: benim })
      if (yontem === 'WriteValue') {
        await sonra()
        // ATT yanıtsız yazma (command): karşının hatası yazana dönmez (gerçek radyodaki gibi; inceleme 22 madde 8)
        if (args[1] && args[1].type === 'command') { try { y.WriteValue(b4a.from(args[0]), { ...args[1], device: benim, mtu: this.hava.mtu }) } catch {} return }
        return y.WriteValue(b4a.from(args[0]), { ...args[1], device: benim, mtu: this.hava.mtu })
      }
      if (yontem === 'StartNotify') {
        if (!karsi.abonelik.has(n.uzak)) karsi.abonelik.set(n.uzak, [])
        karsi.abonelik.get(n.uzak).push({ dugum: this, yol })
      }
    }
  }

  // Bağ koptu: iki tarafta Connected false, abonelikler düşer
  _kop (ad) {
    const karsi = this.hava.dugumler.get(ad)
    for (const [d, yol] of [[this, this.cihazYolu(ad)], [karsi, karsi.cihazYolu(this.ad)]]) {
      const c = d.cihazlar.get(yol)
      if (!c || !c.Connected) continue
      c.Connected = false
      c.ServicesResolved = false
      setImmediate(() => d._yay('PropertiesChanged', yol, 'org.bluez.Device1', { Connected: false }))
    }
    for (const [k, liste] of karsi.abonelik) karsi.abonelik.set(k, liste.filter((a) => a.dugum !== this))
    for (const [k, liste] of this.abonelik) this.abonelik.set(k, liste.filter((a) => a.dugum !== karsi))
  }
}

module.exports = { Hava, ADAPTOR }
