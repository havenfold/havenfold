// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// ipc/frame.js — yerel IPC çerçevesi (RFC-0007 §6.2)
//
//   çerçeve = uzunluk (u32be) ‖ IPC_MSG,  IPC_MSG { type: uint, reqId: uint, body: buffer }
// En büyük çerçeve 1 MiB (uzunluk öneki hariç). Daha büyük veri soketten geçmez; dosyaya yazılır, yalnız yolu gider.
// Çözme kanoniktir: yeniden kodlanınca aynı baytlar (en kısa uint, sonda fazla bayt yok). Bare ve Node'da aynı çalışır.
const c = require('compact-encoding')
const b4a = require('b4a')
const { IPC, GOVDE, DENETIM, struct } = require('./types')

const EN_BUYUK = 1024 * 1024
const ipcMsg = struct([['type', c.uint], ['reqId', c.uint], ['body', c.buffer]])

function fail (code) { throw new Error(code) }

function kanonik (enc, buf) {
  let m
  try { m = c.decode(enc, buf) } catch { fail('INVALID_FRAME') }
  if (!b4a.equals(c.encode(enc, m), buf)) fail('INVALID_FRAME')
  return m
}

// Mesaj → çerçeve baytları. yon: 'istek' | 'cevap' (yalnız iki gövdeli türlerde fark eder)
function cerceveYaz (type, reqId, mesaj, yon = 'istek') {
  const g = GOVDE[type]
  if (!g) fail('BILINMEYEN_TUR')
  const body = c.encode(g[yon] || g.istek, mesaj)
  const msg = c.encode(ipcMsg, { type, reqId, body })
  if (msg.byteLength > EN_BUYUK) fail('FRAME_TOO_LARGE')
  const out = b4a.alloc(4 + msg.byteLength)
  new DataView(out.buffer, out.byteOffset).setUint32(0, msg.byteLength, false)
  out.set(msg, 4)
  return out
}

// IPC_MSG baytları → { type, reqId, mesaj }. Bilinmeyen tür ya da bozuk gövde hata verir; çağıran HATA ile cevaplar.
function mesajCoz (msgBytes, yon = 'istek') {
  const { type, reqId, body } = kanonik(ipcMsg, msgBytes)
  const g = GOVDE[type]
  if (!g) { const e = new Error('BILINMEYEN_TUR'); e.reqId = reqId; e.type = type; throw e }
  let mesaj
  try { mesaj = kanonik(g[yon] || g.istek, body) } catch { const e = new Error('INVALID_BODY'); e.reqId = reqId; e.type = type; throw e }
  if (DENETIM[type] && !DENETIM[type](mesaj, yon)) { const e = new Error('INVALID_BODY'); e.reqId = reqId; e.type = type; throw e }
  return { type, reqId, mesaj }
}

// Akış okuyucusu: parçalar beslenir, tam çerçevelerin IPC_MSG baytları döner. 1 MiB'ı aşan uzunluk öneki
// bağlantıyı bozar (FRAME_TOO_LARGE): bundan sonra okuyucu kullanılmaz, bağlantı kapatılır.
// Parçalar listede birikir; yalnız önek okunurken ve çerçeve tamamlanınca birleştirilir (her parçada bütün tamponu
// kopyalamak bayt bayt beslenen 1 MiB'ta ~n²/2 bayt kopya demekti; Codex 12. tur).
class CerceveOkuyucu {
  constructor () { this.parcalar = []; this.boy = 0; this.gerek = 0; this.bozuk = false }

  besle (parca) {
    if (this.bozuk) fail('FRAME_TOO_LARGE')
    if (parca.byteLength) { this.parcalar.push(b4a.from(parca)); this.boy += parca.byteLength }
    const out = []
    while (this.boy >= 4 && this.boy >= this.gerek) {
      if (this.parcalar.length > 1) this.parcalar = [b4a.concat(this.parcalar)]
      const t = this.parcalar[0]
      const n = new DataView(t.buffer, t.byteOffset).getUint32(0, false)
      if (n > EN_BUYUK || n === 0) { this.bozuk = true; fail('FRAME_TOO_LARGE') }
      if (this.boy < 4 + n) { this.gerek = 4 + n; break }
      out.push(t.subarray(4, 4 + n))
      const kalan = t.subarray(4 + n)
      this.parcalar = kalan.byteLength ? [kalan] : []
      this.boy = kalan.byteLength
      this.gerek = 0
    }
    return out
  }
}

// Çözülemeyen mesaja cevap: HATA { reqId, code, detail }
const hataCercevesi = (reqId, code, detail = '') => cerceveYaz(IPC.HATA, 0, { reqId, code, detail })

module.exports = { EN_BUYUK, ipcMsg, cerceveYaz, mesajCoz, CerceveOkuyucu, hataCercevesi }
