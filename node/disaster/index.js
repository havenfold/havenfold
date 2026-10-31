// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// afet — Linux düğümde afet modu (RFC-0012 §6.4, §10; RFC §17 adım 4): BlueZ ile Bluetooth LE bağı, güç kaynağı izleme,
// durum makinesi. Kutu sürecinde çalışır (birleşik cihazda Bluetooth'u kutu kullanır, §6.4). Bluetooth donanımı ya da
// D-Bus uyarlayıcısı yoksa yalnız yerel ağ yolu çalışır (§6.7 "Linux düğüm").
//
// Bu dizin Node'a özeldir (D-Bus, sysfs); Bare uyumu kuralı core/ ve sdk/ içindir. Dosya erişimi #fs ile.
const { DisasterApi } = require('@havenfold/sdk')
const { GucIzleyici, gucOku, gorevOrani, KESINTI_MS } = require('./power')
const { AfetBluez, UUID } = require('./bluez')
const { BluezKoprusu } = require('./dbus-bluez')
const { GattAkisi } = require('./gatt-stream')
const U = require('./alert')

const TIK_MS = 30_000

/**
 * Düğümün afet modu. o: { me (kutu kimliği), defter: () => Ledger, saklama (şifreli kalıcı depo), kok?: sysfs öneki,
 * dbus?: D-Bus uyarlayıcısı (dbus-bluez.js yüzü; yoksa Bluetooth yok), saat?, guc?: GucIzleyici }
 */
class AfetDugum {
  constructor ({ me, defter, saklama = null, kok = '/', dbus = null, saat = Date.now, guc = null, tikMs = TIK_MS }) {
    this.afet = new DisasterApi({ me, defter, saklama, saat })
    this.guc = guc ?? new GucIzleyici({ kok, saat })
    const onceki = this.guc.olay
    // Güç değişince: durum makinesine sinyal ve tarama planı yenilenir (açıklama 2 madde 3)
    this.guc.olay = (o) => {
      onceki(o)
      this.afet.signal(this.guc.sinyal())
      if (this.bluez && o.tur === 'degisti') this.bluez.planiYenile().catch(() => {})
    }
    this.bluez = dbus ? new AfetBluez({ kopru: new BluezKoprusu({ dbus }), afet: this.afet, saat, guc: this.guc }) : null
    // KAPALI'da Bluetooth yayını, tarama ve GATT yok (açıklama 2 madde 2)
    this.afet.on('disaster', (o) => { if (this.bluez && o.type === 'durum') this.bluez.durumUygula(o.hal.durum).catch(() => {}) })
    this.tikMs = tikMs
    this.zaman = null
  }

  async baslat () {
    this.guc.baslat()
    this.afet.signal(this.guc.sinyal())
    this.zaman = setInterval(() => { try { this.afet.tick() } catch {} }, this.tikMs)
    if (this.zaman.unref) this.zaman.unref()
    if (this.bluez) await this.bluez.baslat()
    return this
  }

  async durdur () {
    clearInterval(this.zaman)
    this.guc.durdur()
    if (this.bluez) await this.bluez.durdur()
  }

  hal () { return { ...this.afet.state(), guc: this.guc.son, bluetooth: !!this.bluez } }
}

module.exports = { ...U, AfetDugum, AfetBluez, BluezKoprusu, GattAkisi, GucIzleyici, gucOku, gorevOrani, UUID, KESINTI_MS }
