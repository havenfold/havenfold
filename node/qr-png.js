// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// qr-png.js — QR'ı gri tonlu PNG'ye çizer (her modül 8 piksel, 4 modül sessiz bölge; zlib ile, yeni bağımlılık yok).
// Yalnız Node (düğümün yönetim komutu ve deneme betiği).
'use strict'
const zlib = require('zlib')
const { qrKodla } = require('./qr')

function crc32 (buf) {
  let c = ~0
  for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)) }
  return ~c >>> 0
}
function parca (tur, veri) {
  const b = Buffer.alloc(12 + veri.length)
  b.writeUInt32BE(veri.length, 0)
  b.write(tur, 4, 'ascii')
  veri.copy(b, 8)
  b.writeUInt32BE(crc32(b.subarray(4, 8 + veri.length)), 8 + veri.length)
  return b
}

function pngKodla (metin, { olcek = 8, kenar = 4 } = {}) {
  const q = qrKodla(metin)
  const n = q.moduller.length
  const w = (n + 2 * kenar) * olcek
  const satirlar = []
  for (let y = 0; y < w; y++) {
    const s = Buffer.alloc(1 + w, 255)
    s[0] = 0
    for (let x = 0; x < w; x++) {
      const mx = Math.floor(x / olcek) - kenar
      const my = Math.floor(y / olcek) - kenar
      if (mx >= 0 && my >= 0 && mx < n && my < n && q.moduller[my][mx]) s[1 + x] = 0
    }
    satirlar.push(s)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(w, 4)
  ihdr[8] = 8 // bit derinliği
  ihdr[9] = 0 // gri ton
  return { png: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), parca('IHDR', ihdr), parca('IDAT', zlib.deflateSync(Buffer.concat(satirlar))), parca('IEND', Buffer.alloc(0))]), q }
}

module.exports = { pngKodla }
