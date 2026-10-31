// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// disaster/gatt-stream.js — Bluetooth GATT üstünde sıralı bayt akışı (RFC-0012 §6.4): IN (yanıtsız yazma) ve OUT (bildirim)
// nitelikleriyle. Yazılan veri MTU − 3 baytlık parçalara bölünür; her parça bir öncekinin "yazmaya hazır" onayından sonra
// gider (yaz() Promise'i), böylece akış kayıpsız ve sıralıdır. Gelen parçalar olduğu gibi akışa eklenir: üstteki Noise
// akışı kendi çerçevesini (uzunluk önekli) taşıdığı için ayrı bir parça başlığı gerekmez.
// Kapanış (açıklama 2 madde 5): bağ, yazma kuyruğu boşalmadan kopartılmaz; bosalinca() son parça yazılınca (üst akış
// end() dedikten sonra) ya da süre dolunca çözülür.
const { Duplex } = require('streamx')

const ATT_BASLIK = 3
const EN_AZ_MTU = 23 // BLE varsayılanı; §6.4 en az 185 ister, karşı vermezse 23 ile de çalışır

class GattAkisi extends Duplex {
  /** o: { yaz: async (parça) => void, mtu?: number } */
  constructor ({ yaz, mtu = EN_AZ_MTU }) {
    super()
    this.yazici = yaz
    this.parcaBoyu = Math.max(EN_AZ_MTU, mtu || 0) - ATT_BASLIK
    this.gelenBayt = 0
    this.gidenBayt = 0
    this.sonlandi = false
    this._bosalma = []
    this.once('close', () => this._bosaldi())
  }

  _write (veri, cb) {
    const parcalar = []
    for (let i = 0; i < veri.byteLength; i += this.parcaBoyu) parcalar.push(veri.subarray(i, i + this.parcaBoyu))
    ;(async () => {
      for (const p of parcalar) { await this.yazici(p); this.gidenBayt += p.byteLength }
    })().then(() => cb(null), (err) => cb(err))
  }

  // Bütün yazılar bitti (streamx _final'ı bekleyen _write'lardan sonra çağırır)
  _final (cb) { this.sonlandi = true; this._bosaldi(); cb(null) }

  _bosaldi () { const b = this._bosalma; this._bosalma = []; for (const f of b) f() }

  /** Yazma kuyruğu boşalınca (üst akış bitirdiyse) ya da en geç ms sonra çözülür */
  bosalinca (ms = 3000) {
    if (this.sonlandi || this.destroyed) return Promise.resolve()
    return new Promise((resolve) => {
      const z = setTimeout(resolve, ms)
      this._bosalma.push(() => { clearTimeout(z); resolve() })
    })
  }

  /** Karşıdan gelen parça (IN'e yazıldı ya da OUT bildirimi geldi) */
  al (parca) {
    if (this.destroying) return
    this.gelenBayt += parca.byteLength
    this.push(parca)
  }

  /** Bluetooth bağı koptu */
  koptu () { if (!this.destroying) this.destroy() }
}

module.exports = { GattAkisi, ATT_BASLIK, EN_AZ_MTU }
