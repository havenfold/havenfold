// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// edge/stream-socket.js — denetçi ile görevin yerel akış sunucusu arasındaki Unix soket çerçevesi (RFC-0008 §11.5 madde 4:
// /run/havenfold/gorev/<taskId>/akis.sock). RFC biçimi yazmaz; bu uygulamanın sözleşmesidir (havenfold-rtsp uyarlayıcısı
// ve benzetim aynı biçimi okur):
//
//   çerçeve = uzunluk (u32be) ‖ tür (u8) ‖ gövde
//   0x01 KARE    denetçi → sunucu: key (u8: 0/1) ‖ ts (u32be, 90 kHz değil, uçun ms zaman damgası mod 2^32) ‖ H.264 erişim birimi
//   0x02 KAPAT   denetçi → sunucu: kod (UTF-8)
//   0x10 ANAHTAR sunucu → denetçi: yeni okuyucu bağlandı, anahtar kare iste (gövde yok)
const b4a = require('b4a')

const TUR = { KARE: 0x01, KAPAT: 0x02, ANAHTAR: 0x10 }
const EN_BUYUK = 4 * 1024 * 1024

function cerceve (tur, govde = b4a.alloc(0)) {
  const out = b4a.alloc(5 + govde.byteLength)
  const dv = new DataView(out.buffer, out.byteOffset, out.byteLength)
  dv.setUint32(0, 1 + govde.byteLength)
  out[4] = tur
  out.set(govde, 5)
  return out
}

function kare ({ key, ts, data }) {
  const g = b4a.alloc(5 + data.byteLength)
  g[0] = key ? 1 : 0
  new DataView(g.buffer, g.byteOffset, g.byteLength).setUint32(1, ts >>> 0)
  g.set(data, 5)
  return cerceve(TUR.KARE, g)
}

const kapat = (kod) => cerceve(TUR.KAPAT, b4a.from(kod))
const anahtarIste = () => cerceve(TUR.ANAHTAR)

/** Akış okuyucusu: parçalar beslenir, { tur, govde } çerçeveleri döner; sınırı aşan uzunluk STREAM_FRAME_TOO_LARGE */
// Parçalar listede birikir, yalnız önek okunurken ve kare tamamlanınca birleştirilir (görevin sunucusu 4 MiB'lık kareyi
// bayt bayt yazarsa denetçi her parçada bütün tamponu kopyalamasın; Codex 12. tur)
class Okuyucu {
  constructor () { this.parcalar = []; this.boy = 0; this.gerek = 0 }
  besle (p) {
    if (p.byteLength) { this.parcalar.push(b4a.from(p)); this.boy += p.byteLength }
    const out = []
    while (this.boy >= 4 && this.boy >= this.gerek) {
      if (this.parcalar.length > 1) this.parcalar = [b4a.concat(this.parcalar)]
      const t = this.parcalar[0]
      const n = new DataView(t.buffer, t.byteOffset, 4).getUint32(0)
      if (n === 0 || n > EN_BUYUK) throw new Error('STREAM_FRAME_TOO_LARGE')
      if (this.boy < 4 + n) { this.gerek = 4 + n; break }
      out.push({ tur: t[4], govde: t.subarray(5, 4 + n) })
      const kalan = t.subarray(4 + n)
      this.parcalar = kalan.byteLength ? [kalan] : []
      this.boy = kalan.byteLength
      this.gerek = 0
    }
    return out
  }
}

function kareCoz (govde) {
  return { key: govde[0] === 1, ts: new DataView(govde.buffer, govde.byteOffset + 1, 4).getUint32(0), data: govde.subarray(5) }
}

module.exports = { TUR, EN_BUYUK, cerceve, kare, kapat, anahtarIste, Okuyucu, kareCoz }
