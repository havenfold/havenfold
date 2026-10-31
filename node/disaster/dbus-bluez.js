// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// disaster/dbus-bluez.js — BlueZ D-Bus köprüsü (RFC-0012 §6.4; Linux düğüm, RFC-0007 §4.3 Bluetooth birim izni):
// org.bluez.GattManager1 ile GATT uygulaması, LEAdvertisingManager1 ile reklam, Adapter1 ile tarama, Device1 ve
// GattCharacteristic1 ile merkez rolü. bluez.js'in istediği köprü yüzünü verir.
//
// D-Bus bağlantısı dışarıdan verilir (`dbus`): bu dosya D-Bus kitaplığına bağlı değildir. Üretimde ince bir uyarlayıcı
// (izinli lisanslı bir D-Bus istemcisi; kollar/D-durum.md İstek 164) aşağıdaki yüzü sağlar; testte benzetim:
//   dbus.cagir({ yol, arayuz, yontem, args }) → Promise<sonuç>        (hedef org.bluez)
//   dbus.nesneler() → Promise<{ [yol]: { [arayüz]: özellikler } }>    (org.freedesktop.DBus.ObjectManager.GetManagedObjects)
//   dbus.sinyal('InterfacesAdded', (yol, arayuzler) => …) · dbus.sinyal('PropertiesChanged', (yol, arayuz, degisen) => …)
//   dbus.sun(yol, { [arayüz]: { ozellikler, yontemler } }) → { ozellikDegisti(arayuz, degisen) } · dbus.kaldir(yol)
// Bayt dizileri Uint8Array, sözlükler düz nesnedir (uyarlayıcı D-Bus varyantlarını çevirir).
const b4a = require('b4a')

const A = {
  ADAPTER: 'org.bluez.Adapter1',
  DEVICE: 'org.bluez.Device1',
  GATT_MANAGER: 'org.bluez.GattManager1',
  ADV_MANAGER: 'org.bluez.LEAdvertisingManager1',
  SERVICE: 'org.bluez.GattService1',
  CHAR: 'org.bluez.GattCharacteristic1',
  ADV: 'org.bluez.LEAdvertisement1',
  OM: 'org.freedesktop.DBus.ObjectManager'
}
const BAGLANMA_MS = 10_000

function fail (code) { throw new Error(code) }

class BluezKoprusu {
  /** o: { dbus, adaptor?: '/org/bluez/hci0', uygulama?: D-Bus nesne yolu öneki, baglanmaMs? } */
  constructor ({ dbus, adaptor = '/org/bluez/hci0', uygulama = '/app/havenfold/afet', baglanmaMs = BAGLANMA_MS }) {
    this.dbus = dbus
    this.adaptor = adaptor
    this.uygulama = uygulama
    this.baglanmaMs = baglanmaMs
    this.nitelikler = new Map() // uuid → { yol, sunulan }
    this.mtular = new Map() // cihaz → mtu (WriteValue seçeneklerinden)
    this.kopmaDinleyicileri = []
    this.degisim = new Map() // yol → [fn(arayuz, degisen)]
    this.eklenen = []
    dbus.sinyal('PropertiesChanged', (yol, arayuz, degisen) => {
      for (const fn of this.degisim.get(yol) || []) fn(arayuz, degisen)
      if (arayuz === A.DEVICE && degisen.Connected === false) {
        this.mtular.delete(yol) // budama (inceleme 22 madde 15)
        for (const fn of this.kopmaDinleyicileri) fn(yol)
      }
    })
    this.adaptorDinleyicileri = []
    dbus.sinyal('InterfacesAdded', (yol, arayuzler) => {
      // bluetoothd yeniden başladı: adaptör yeniden belirdi, kayıtlar gitti (madde 13)
      if (yol === this.adaptor && arayuzler[A.GATT_MANAGER]) for (const fn of this.adaptorDinleyicileri) fn()
      for (const fn of this.eklenen) fn(yol, arayuzler)
    })
  }

  _degisince (yol, fn) {
    if (!this.degisim.has(yol)) this.degisim.set(yol, [])
    this.degisim.get(yol).push(fn)
    return () => this.degisim.set(yol, (this.degisim.get(yol) || []).filter((f) => f !== fn))
  }

  koptu (fn) { this.kopmaDinleyicileri.push(fn) }
  adaptorGeldi (fn) { this.adaptorDinleyicileri.push(fn) }

  /** Bağlı bir cihazı (çevre rolünde bize bağlanan merkez dahil) kopar (açıklama 2 madde 4) */
  async cihaziKopar (cihaz) { await this.dbus.cagir({ yol: cihaz, arayuz: A.DEVICE, yontem: 'Disconnect', args: [] }) }
  mtu (cihaz) { return this.mtular.get(cihaz) }

  // --- çevre rolü ---

  async gattSunucu ({ hizmet, nitelikler }) {
    const sYol = this.uygulama + '/s0'
    const nesneler = { [sYol]: { [A.SERVICE]: { UUID: hizmet, Primary: true } } }
    let i = 0
    for (const [uuid, n] of Object.entries(nitelikler)) {
      const yol = sYol + '/c' + i++
      const ozellikler = { UUID: uuid, Service: sYol, Flags: n.bayraklar }
      nesneler[yol] = { [A.CHAR]: ozellikler }
      const sunulan = this.dbus.sun(yol, {
        [A.CHAR]: {
          ozellikler,
          yontemler: {
            // Uzun okuma (MTU 23'te TAGS birkaç parçada): BlueZ offset verir (madde 11)
            ReadValue: (secenek = {}) => {
              if (!n.oku) fail('org.bluez.Error.NotPermitted')
              const v = n.oku()
              const o = secenek.offset || 0
              if (o > v.byteLength) fail('org.bluez.Error.InvalidOffset')
              return v.subarray(o)
            },
            // Yanıtsız yazma: karşıya hata dönmez (ATT); reddi bluez.js bağlantıyı kopararak yapar (madde 8)
            WriteValue: (deger, secenek = {}) => {
              if (!n.yaz) fail('org.bluez.Error.NotPermitted')
              if (secenek.mtu) this.mtular.set(secenek.device, secenek.mtu)
              try { n.yaz(secenek.device, b4a.from(deger)) } catch {}
            },
            StartNotify: () => {},
            StopNotify: () => {}
          }
        }
      })
      this.nitelikler.set(uuid, { yol, sunulan })
    }
    this.dbus.sun(sYol, { [A.SERVICE]: { ozellikler: nesneler[sYol][A.SERVICE], yontemler: {} } })
    this.dbus.sun(this.uygulama, { [A.OM]: { ozellikler: {}, yontemler: { GetManagedObjects: () => nesneler } } })
    this.gattYollari = [this.uygulama, ...Object.keys(nesneler)]
    await this.dbus.cagir({ yol: this.adaptor, arayuz: A.GATT_MANAGER, yontem: 'RegisterApplication', args: [this.uygulama, {}] })
  }

  /** GATT uygulamasının kaydını sil (KAPALI'ya geçiş, durdur; madde 13) */
  async gattKaldir () {
    if (!this.gattYollari) return
    const yollar = this.gattYollari
    this.gattYollari = null
    this.nitelikler.clear()
    try { await this.dbus.cagir({ yol: this.adaptor, arayuz: A.GATT_MANAGER, yontem: 'UnregisterApplication', args: [this.uygulama] }) } finally {
      for (const y of yollar) this.dbus.kaldir(y)
    }
  }

  /** OUT bildirimi. BlueZ bildirimi niteliğe abone bütün merkezlere yollar (bluez.js çevre rolünde tek oturum yürütür) */
  async bildir (cihaz, uuid, bayt) {
    const n = this.nitelikler.get(uuid) ?? fail('NO_ATTRIBUTE')
    n.sunulan.ozellikDegisti(A.CHAR, { Value: bayt })
  }

  async reklamBaslat ({ hizmet }) {
    const yol = this.uygulama + '/adv0'
    // §6.2: yalnız hizmet kimliği; ad, hizmet verisi ve cihaz kimliği yok
    this.dbus.sun(yol, { [A.ADV]: { ozellikler: { Type: 'peripheral', ServiceUUIDs: [hizmet], IncludeTxPower: false }, yontemler: { Release: () => {} } } })
    await this.dbus.cagir({ yol: this.adaptor, arayuz: A.ADV_MANAGER, yontem: 'RegisterAdvertisement', args: [yol, {}] })
    this.reklamYolu = yol
  }

  async reklamDurdur () {
    if (!this.reklamYolu) return
    await this.dbus.cagir({ yol: this.adaptor, arayuz: A.ADV_MANAGER, yontem: 'UnregisterAdvertisement', args: [this.reklamYolu] })
    this.dbus.kaldir(this.reklamYolu)
    this.reklamYolu = null
  }

  // --- merkez rolü ---

  async taramaBaslat ({ hizmet }, bulundu) {
    const uygun = (ozellik) => ozellik && (ozellik.UUIDs || []).map((x) => x.toLowerCase()).includes(hizmet)
    this._uygun = uygun
    this._bulundu = bulundu
    this.eklenen = [(yol, arayuzler) => { if (yol.startsWith(this.adaptor + '/') && uygun(arayuzler[A.DEVICE])) bulundu(yol) }]
    if (!this.taramaDinliyor) {
      this.taramaDinliyor = true
      // Daha önce görülmüş cihazın UUIDs'i sonradan gelebilir
      // Yalnız UUIDs sonradan gelince; RSSI değişimi yeniden bağlanma sebebi değil (madde 10)
      this.dbus.sinyal('PropertiesChanged', (yol, arayuz, degisen) => {
        if (this.taramada && arayuz === A.DEVICE && degisen.UUIDs && yol.startsWith(this.adaptor + '/')) this._yeniden(yol, this._uygun, this._bulundu).catch(() => {})
      })
    }
    this.taramada = true
    await this.dbus.cagir({ yol: this.adaptor, arayuz: A.ADAPTER, yontem: 'SetDiscoveryFilter', args: [{ UUIDs: [hizmet], Transport: 'le', DuplicateData: false }] })
    await this.dbus.cagir({ yol: this.adaptor, arayuz: A.ADAPTER, yontem: 'StartDiscovery', args: [] })
    const nesneler = await this.dbus.nesneler()
    for (const [yol, a] of Object.entries(nesneler)) if (yol.startsWith(this.adaptor + '/') && uygun(a[A.DEVICE])) bulundu(yol)
  }

  async _yeniden (yol, uygun, bulundu) {
    const n = await this.dbus.nesneler()
    if (n[yol] && uygun(n[yol][A.DEVICE])) bulundu(yol)
  }

  async taramaDurdur () {
    if (!this.taramada) return
    this.taramada = false
    await this.dbus.cagir({ yol: this.adaptor, arayuz: A.ADAPTER, yontem: 'StopDiscovery', args: [] })
  }

  async baglan (cihaz) {
    await this.dbus.cagir({ yol: cihaz, arayuz: A.DEVICE, yontem: 'Connect', args: [] })
    await this._hizmetlerHazir(cihaz)
    const nesneler = await this.dbus.nesneler()
    const nitelik = (uuid) => {
      const y = Object.keys(nesneler).find((p) => p.startsWith(cihaz + '/') && nesneler[p][A.CHAR]?.UUID?.toLowerCase() === uuid)
      return y ?? fail('NO_ATTRIBUTE')
    }
    const mtular = Object.keys(nesneler).filter((p) => p.startsWith(cihaz + '/') && nesneler[p][A.CHAR]?.MTU).map((p) => nesneler[p][A.CHAR].MTU)
    const birak = []
    const k = this
    return {
      mtu: mtular.length ? Math.min(...mtular) : 23,
      oku: async (uuid) => b4a.from(await k.dbus.cagir({ yol: nitelik(uuid), arayuz: A.CHAR, yontem: 'ReadValue', args: [{}] })),
      // Yanıtsız yazma; cevap BlueZ yazıyı kuyruğa alınca döner ("yazmaya hazır")
      yaz: (uuid, bayt) => k.dbus.cagir({ yol: nitelik(uuid), arayuz: A.CHAR, yontem: 'WriteValue', args: [bayt, { type: 'command' }] }),
      bildirimAc: async (uuid, fn) => {
        const yol = nitelik(uuid)
        birak.push(k._degisince(yol, (arayuz, d) => { if (arayuz === A.CHAR && d.Value) fn(b4a.from(d.Value)) }))
        await k.dbus.cagir({ yol, arayuz: A.CHAR, yontem: 'StartNotify', args: [] })
      },
      koptu: (fn) => { birak.push(k._degisince(cihaz, (arayuz, d) => { if (arayuz === A.DEVICE && d.Connected === false) fn() })) },
      kopar: async () => {
        for (const f of birak) f()
        await k.dbus.cagir({ yol: cihaz, arayuz: A.DEVICE, yontem: 'Disconnect', args: [] })
      }
    }
  }

  _hizmetlerHazir (cihaz) {
    return new Promise((resolve, reject) => {
      let bitti = false
      const son = (e) => { if (bitti) return; bitti = true; clearTimeout(z); birak(); e ? reject(e) : resolve() }
      const z = setTimeout(() => son(new Error('CONNECT_TIMEOUT')), this.baglanmaMs)
      if (z.unref) z.unref()
      const birak = this._degisince(cihaz, (arayuz, d) => { if (arayuz === A.DEVICE && d.ServicesResolved === true) son() })
      this.dbus.nesneler().then((n) => { if (n[cihaz]?.[A.DEVICE]?.ServicesResolved) son() }, son)
    })
  }
}

module.exports = { BluezKoprusu, A }
