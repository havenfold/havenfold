// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// qr.js — tören QR'ı için QR kodlayıcı (ISO/IEC 18004): bayt kipi, M düzeltme düzeyi, sürüm 1–10 (en çok 213 bayt).
// Kriptografi değildir; yeni bağımlılık eklememek için burada (RFC-0007 §7 `havenfold katil`). Terminalde yarım blok
// karakterleriyle, Linux konsolunda çerçeve arabelleğine piksel olarak (qr-screen.js) çizilir.
function fail (code) { throw new Error(code) }

// --- GF(256), ilkel çok terimli x^8 + x^4 + x^3 + x^2 + 1 (0x11D) ---------------------------------------------------
const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
;(() => { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255] })()
const carp = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]])

// Reed–Solomon düzeltme kod sözcükleri
function rs (veri, n) {
  let gen = [1]
  for (let i = 0; i < n; i++) {
    const yeni = new Array(gen.length + 1).fill(0)
    for (let j = 0; j < gen.length; j++) { yeni[j] ^= gen[j]; yeni[j + 1] ^= carp(gen[j], EXP[i]) }
    gen = yeni
  }
  const r = [...veri, ...new Array(n).fill(0)]
  for (let i = 0; i < veri.length; i++) {
    const k = r[i]
    if (k !== 0) for (let j = 0; j < gen.length; j++) r[i + j] ^= carp(gen[j], k)
  }
  return r.slice(veri.length)
}

// M düzeyi blok yapısı: [düzeltme kod sözcüğü / blok, [[blok sayısı, veri kod sözcüğü], …]]
const BLOK_M = [null,
  [10, [[1, 16]]], [16, [[1, 28]]], [26, [[1, 44]]], [18, [[2, 32]]], [24, [[2, 43]]],
  [16, [[4, 27]]], [18, [[4, 31]]], [22, [[2, 38], [2, 39]]], [22, [[3, 36], [2, 37]]], [26, [[4, 43], [1, 44]]]]
const HIZALAMA = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]]
const veriKapasitesi = (v) => BLOK_M[v][1].reduce((a, [n, k]) => a + n * k, 0)
const sayacBiti = (v) => (v < 10 ? 8 : 16)

function surumSec (n) {
  for (let v = 1; v <= 10; v++) if (4 + sayacBiti(v) + 8 * n <= veriKapasitesi(v) * 8) return v
  fail('QR_TOO_LARGE')
}

function kodSozcukleri (bytes, v) {
  const bitler = []
  const ekle = (x, n) => { for (let i = n - 1; i >= 0; i--) bitler.push((x >>> i) & 1) }
  ekle(0b0100, 4)
  ekle(bytes.length, sayacBiti(v))
  for (const b of bytes) ekle(b, 8)
  const kap = veriKapasitesi(v) * 8
  ekle(0, Math.min(4, kap - bitler.length))
  while (bitler.length % 8) bitler.push(0)
  const veri = []
  for (let i = 0; i < bitler.length; i += 8) veri.push(bitler.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0))
  for (let p = 0; veri.length < kap / 8; p++) veri.push(p % 2 ? 0x11 : 0xec)
  // Bloklara böl, düzeltme ekle, iç içe diz
  const [ec, gruplar] = BLOK_M[v]
  const bloklar = []
  let o = 0
  for (const [n, k] of gruplar) for (let i = 0; i < n; i++) { const d = veri.slice(o, o + k); o += k; bloklar.push({ d, e: rs(d, ec) }) }
  const out = []
  const enUzun = Math.max(...bloklar.map((b) => b.d.length))
  for (let i = 0; i < enUzun; i++) for (const b of bloklar) if (i < b.d.length) out.push(b.d[i])
  for (let i = 0; i < ec; i++) for (const b of bloklar) out.push(b.e[i])
  return out
}

// Biçim bilgisi: M = 00, BCH(15,5) üreteci 0x537, maske 0x5412. ecBit: L 1, M 0, Q 3, H 2
function bicimBitleri (maske, ecBit = 0) {
  const d = (ecBit << 3) | maske
  let r = d
  for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537)
  return ((d << 10) | r) ^ 0x5412
}

// Sürüm bilgisi (v ≥ 7): BCH(18,6) üreteci 0x1F25
function surumBitleri (v) {
  let r = v
  for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25)
  return (v << 12) | r
}

const MASKELER = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x, y) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
]

function matris (v) {
  const n = 17 + 4 * v
  const m = Array.from({ length: n }, () => new Array(n).fill(false))
  const f = Array.from({ length: n }, () => new Array(n).fill(false))
  const koy = (x, y, k) => { m[y][x] = k; f[y][x] = true }
  for (let i = 0; i < n; i++) { koy(6, i, i % 2 === 0); koy(i, 6, i % 2 === 0) }
  for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx
        const y = cy + dy
        if (x < 0 || y < 0 || x >= n || y >= n) continue
        const d = Math.max(Math.abs(dx), Math.abs(dy))
        koy(x, y, d !== 2 && d !== 4)
      }
    }
  }
  const h = HIZALAMA[v]
  for (let i = 0; i < h.length; i++) {
    for (let j = 0; j < h.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === h.length - 1) || (i === h.length - 1 && j === 0)) continue
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) koy(h[i] + dx, h[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
    }
  }
  return { n, m, f, koy }
}

function bicimKoy (q, maske) {
  const { n, koy } = q
  const b = bicimBitleri(maske)
  const bit = (i) => ((b >>> i) & 1) === 1
  for (let i = 0; i <= 5; i++) koy(8, i, bit(i))
  koy(8, 7, bit(6))
  koy(8, 8, bit(7))
  koy(7, 8, bit(8))
  for (let i = 9; i < 15; i++) koy(14 - i, 8, bit(i))
  for (let i = 0; i < 8; i++) koy(n - 1 - i, 8, bit(i))
  for (let i = 8; i < 15; i++) koy(8, n - 15 + i, bit(i))
  koy(8, n - 8, true) // karanlık modül
}

function surumKoy (q, v) {
  if (v < 7) return
  const b = surumBitleri(v)
  for (let i = 0; i < 18; i++) {
    const k = ((b >>> i) & 1) === 1
    const a = q.n - 11 + (i % 3)
    const c = Math.floor(i / 3)
    q.koy(a, c, k)
    q.koy(c, a, k)
  }
}

function veriKoy (q, kod) {
  const { n, m, f } = q
  let i = 0
  for (let sag = n - 1; sag >= 1; sag -= 2) {
    if (sag === 6) sag = 5
    for (let dik = 0; dik < n; dik++) {
      for (let j = 0; j < 2; j++) {
        const x = sag - j
        const yukari = ((sag + 1) & 2) === 0
        const y = yukari ? n - 1 - dik : dik
        if (f[y][x]) continue
        if (i < kod.length * 8) m[y][x] = ((kod[i >>> 3] >>> (7 - (i & 7))) & 1) === 1
        i++
      }
    }
  }
}

// Ceza puanı (kural 1–4); seçilen maske okuyucuyu etkilemez, yalnız okunabilirliği iyileştirir
function ceza (m) {
  const n = m.length
  let p = 0
  for (const satir of [m, m[0].map((_, x) => m.map((r) => r[x]))]) {
    for (const r of satir) {
      let s = 1
      for (let i = 1; i < n; i++) {
        if (r[i] === r[i - 1]) s++
        else { if (s >= 5) p += 3 + (s - 5); s = 1 }
      }
      if (s >= 5) p += 3 + (s - 5)
      const t = r.map((k) => (k ? 1 : 0)).join('')
      for (const d of ['10111010000', '00001011101']) for (let i = t.indexOf(d); i >= 0; i = t.indexOf(d, i + 1)) p += 40
    }
  }
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) if (m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3
  const kara = m.reduce((a, r) => a + r.filter(Boolean).length, 0)
  p += Math.floor(Math.abs((kara * 20) / (n * n) - 10)) * 10
  return p
}

// metin (UTF-8) → { surum, modüller: boolean[][] (true = koyu) }
function qrKodla (metin, { maske = null } = {}) {
  const bytes = [...new TextEncoderLite().encode(metin)]
  const v = surumSec(bytes.length)
  const kod = kodSozcukleri(bytes, v)
  let en = null
  for (let k = 0; k < 8; k++) {
    if (maske !== null && k !== maske) continue
    const q = matris(v)
    bicimKoy(q, 0) // yer ayırma
    surumKoy(q, v)
    veriKoy(q, kod)
    for (let y = 0; y < q.n; y++) for (let x = 0; x < q.n; x++) if (!q.f[y][x] && MASKELER[k](x, y)) q.m[y][x] = !q.m[y][x]
    bicimKoy(q, k)
    const p = ceza(q.m)
    if (!en || p < en.p) en = { p, k, m: q.m }
  }
  return { surum: v, maske: en.k, moduller: en.m }
}

// UTF-8 kodlayıcı (Bare'de TextEncoder yok)
class TextEncoderLite {
  encode (s) {
    const out = []
    for (const ch of s) {
      const cp = ch.codePointAt(0)
      if (cp < 0x80) out.push(cp)
      else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63))
      else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63))
      else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63))
    }
    return out
  }
}

// Terminal çizimi: iki modül satırı bir karakter satırı. Koyu terminalde açık modüller dolu çizilir (tersi: false),
// 4 modül sessiz bölge.
function terminaleCiz (q, { tersi = true } = {}) {
  const n = q.moduller.length
  const bos = 4
  const acik = (x, y) => (x < 0 || y < 0 || x >= n || y >= n) ? true : !q.moduller[y][x]
  const dolu = (x, y) => (tersi ? acik(x, y) : !acik(x, y))
  const satirlar = []
  for (let y = -bos; y < n + bos; y += 2) {
    let s = ''
    for (let x = -bos; x < n + bos; x++) {
      const u = dolu(x, y)
      const a = dolu(x, y + 1)
      s += u && a ? '█' : u ? '▀' : a ? '▄' : ' '
    }
    satirlar.push(s)
  }
  return satirlar.join('\n')
}

module.exports = { qrKodla, terminaleCiz, rs, bicimBitleri, surumBitleri, surumSec }
