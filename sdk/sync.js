// SPDX-License-Identifier: Apache-2.0
// sync.js — eşitleme durumu (D100; envanter madde 4): ürünlerin bağlantı şeridi için tek kaynak
//
// Yalnız yerel: ağa hiçbir şey eklemez, var olan mesajlardan çıkarılır. Durum:
//   tasiyici      taşıyıcı açık mı (başlamış, askıda değil)
//   cevrimici     oturumu açık üyeler (memberId hex, sıralı; misafir, cihaz ve kutu dahil değil)
//   bekleyenYazim anahtar bekleyen yazımlar (replikanın kuyruğu) + hiçbir üyeye ulaştığı teyit edilmemiş kendi işlemlerim
//   sonEsitleme   bir üyenin kayıt özeti (REC_VV) bekleyen her işlemimi kapsadığı son an (ms) ya da null
// Teyit: karşı telefonun REC_VV'sinde benim yazar grubum (sayı ve küme özeti) benimkiyle aynıysa o gruptaki bütün
// işlemlerim ona ulaşmıştır (kayit.esitleme.teyitler). Okuyucusu yalnız ben olan koleksiyondaki işlem beklemez.
// Değişince 'sync-status' olayı { tasiyici, cevrimici, bekleyenYazim, sonEsitleme }.
const { Emitter } = require('./api')

class SyncStatus extends Emitter {
  // replika: kuyruk uzunluğu için (yoksa 0); durum: kalıcı { bekleyen: [opIdHex], son } (toJSON'ın çıktısı)
  constructor ({ replika = null, now = Date.now, durum = null } = {}) {
    super()
    this.r = replika
    this.now = now
    this.bekleyen = new Set(durum && Array.isArray(durum.bekleyen) ? durum.bekleyen.filter((x) => typeof x === 'string') : [])
    this.son = durum && Number.isSafeInteger(durum.son) ? durum.son : null
    this.tasiyici = false
    this.cevrimici = new Set()
    this._onceki = null
  }

  status () {
    const kuyruk = this.r ? this.r.writeQueue.length : 0
    return { tasiyici: this.tasiyici, cevrimici: [...this.cevrimici].sort(), bekleyenYazim: kuyruk + this.bekleyen.size, sonEsitleme: this.son }
  }

  // Durum değiştiyse olay (aynı durum ikinci kez yayılmaz)
  changed () {
    const d = this.status()
    const k = JSON.stringify(d)
    if (k === this._onceki) return false
    this._onceki = k
    this.emit('sync-status', d)
    return true
  }

  transportStatus (acik) { this.tasiyici = !!acik; this.changed() }
  connected (memberHex) { this.cevrimici.add(memberHex); this.changed() }
  disconnected (memberHex) { this.cevrimici.delete(memberHex); this.changed() }

  // Kendi işlemim yazıldı (opId hex); başka okuyucusu yoksa beklemez
  written (opIdHex) { this.bekleyen.add(opIdHex); this.changed() }

  // Bir üye bu işlemlerimi aldı (REC_VV teyidi). Teyit bekleyen işlem ve anahtar bekleyen yazım kalmadıysa sonEsitleme bu
  // an; kuyrukta yazım varken (henüz işlem bile olmadı) eşitlenmiş sayılmaz (Codex 6. tur)
  confirmed (opIdHexler) {
    for (const id of opIdHexler) this.bekleyen.delete(id)
    if (this.bekleyen.size === 0 && (!this.r || this.r.writeQueue.length === 0)) this.son = this.now()
    this.changed()
  }

  // Artık geçerli kümede olmayan bekleyenler (mezar, temizlik) sayılmaz
  clear (varMi) {
    for (const id of [...this.bekleyen]) if (!varMi(id)) this.bekleyen.delete(id)
  }

  toJSON () { return { bekleyen: [...this.bekleyen].sort(), son: this.son } }
}

module.exports = { SyncStatus }
