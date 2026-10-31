// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// zip.js — kabın düz metni olan ZIP arşivi (RFC-0014 §4)
//
// Yazıcı sıkıştırmasız (stored) ve belirlenimci yazar: sabit tarih (1980-01-01), UTF-8 ad bayrağı, ZIP içi şifreleme
// yok, ZIP64 yok. Okuyucu sıkıştırmasız girdileri kendisi açar; sıkıştırmalı (deflate) girdi için çağıran bir inflate
// işlevi verir (Bare'de zlib yok; export-open Node'un zlib'ini verir). Bu dosya kripto değildir, yalnız biçimdir.
const b4a = require('b4a')

function fail (code) { throw new Error(code) }

const LOCAL = 0x04034b50
const CENTRAL = 0x02014b50
const EOCD = 0x06054b50
const UTF8 = 0x0800
const DOS_DATE = 0x0021 // 1980-01-01
const MAX_GIRDI = 65535
const MAX_BOY = 0xffffffff // ZIP64 yok: boyut ve ofset 32 bit (RFC-0019 §11.6 b)
const MAX_TOPLAM = 2 * 1024 * 1024 * 1024 // v1 kap sınırı; açılan toplam boyut da bunu aşamaz (zip bombası)

// Ad çakışması: NFC ve Unicode büyük/küçük harf katlamasıyla (ſ/s, ς/σ, ß/ss; RFC-0021 f)
const adAnahtari = (ad) => ad.normalize('NFC').toUpperCase().toLowerCase()

// CRC-32 (IEEE 802.3), ZIP'in gerektirdiği sağlama
const CRC_TABLO = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32 (buf) { return crcAkis().ekle(buf).sonuc() }

// Parça parça CRC-32 (akışla yazım, D41)
function crcAkis () {
  let c = 0xffffffff
  return {
    ekle (buf) { for (let i = 0; i < buf.byteLength; i++) c = CRC_TABLO[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return this },
    sonuc () { return (c ^ 0xffffffff) >>> 0 }
  }
}

// Arşiv içi ad: göreli, "/" ayraçlı, ".." ve boş parça yok; her işletim sisteminde güvenli (RFC-0021 f): ':' ve
// 0x20 altı karakter yok, parça nokta ya da boşlukla bitmez, Windows'un ayrılmış adları (uzantılı halleri dahil) yok
const AYRILMIS_AD = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i
function adGecerli (ad) {
  if (typeof ad !== 'string' || !ad || ad.length > 255 || ad.startsWith('/') || ad.includes('\\') || ad.includes(':')) return false
  if (/[\u0000-\u001f\u007f]/.test(ad)) return false
  return ad.split('/').every((p) => p && p !== '.' && p !== '..' && !/[. ]$/.test(p) && !AYRILMIS_AD.test(p))
}

function yazici (n) {
  const b = b4a.alloc(n)
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  let o = 0
  return {
    b,
    u16 (x) { dv.setUint16(o, x, true); o += 2 },
    u32 (x) { dv.setUint32(o, x, true); o += 4 },
    bytes (x) { b.set(x, o); o += x.byteLength }
  }
}

// girdiler: [{ ad, bytes }] (sıra korunur). Arşiv tek bir tampona yazılır (kopya yok).
function zipYaz (girdiler) {
  if (girdiler.length > MAX_GIRDI) fail('INVALID_ZIP')
  const adlar = new Set()
  const hazir = girdiler.map((g) => {
    if (!b4a.isBuffer(g.bytes)) fail('INVALID_ZIP')
    if (!adGecerli(g.ad) || adlar.has(adAnahtari(g.ad))) fail('INVALID_ZIP_NAME')
    adlar.add(adAnahtari(g.ad))
    if (g.bytes.byteLength >= MAX_BOY) fail('ZIP_TOO_LARGE')
    return { ad: b4a.from(g.ad), bytes: g.bytes, crc: crc32(g.bytes) }
  })
  const yerelBoy = hazir.reduce((a, g) => a + 30 + g.ad.byteLength + g.bytes.byteLength, 0)
  const mBoy = hazir.reduce((a, g) => a + 46 + g.ad.byteLength, 0)
  if (yerelBoy + mBoy + 22 > MAX_TOPLAM || yerelBoy >= MAX_BOY) fail('ZIP_TOO_LARGE')
  const W = yazici(yerelBoy + mBoy + 22)
  const ofsetler = []
  let off = 0
  for (const g of hazir) {
    ofsetler.push(off)
    W.u32(LOCAL); W.u16(20); W.u16(UTF8); W.u16(0); W.u16(0); W.u16(DOS_DATE)
    W.u32(g.crc); W.u32(g.bytes.byteLength); W.u32(g.bytes.byteLength); W.u16(g.ad.byteLength); W.u16(0)
    W.bytes(g.ad); W.bytes(g.bytes)
    off += 30 + g.ad.byteLength + g.bytes.byteLength
  }
  hazir.forEach((g, i) => {
    W.u32(CENTRAL); W.u16(20); W.u16(20); W.u16(UTF8); W.u16(0); W.u16(0); W.u16(DOS_DATE)
    W.u32(g.crc); W.u32(g.bytes.byteLength); W.u32(g.bytes.byteLength); W.u16(g.ad.byteLength); W.u16(0); W.u16(0)
    W.u16(0); W.u16(0); W.u32(0); W.u32(ofsetler[i])
    W.bytes(g.ad)
  })
  W.u32(EOCD); W.u16(0); W.u16(0); W.u16(hazir.length); W.u16(hazir.length); W.u32(mBoy); W.u32(off); W.u16(0)
  return W.b
}

// Akışla yazıcı (D41): zipYaz ile bayt bayt aynı arşivi parça parça yaz(baytlar)'a verir. Her girdinin CRC'si ve boyu
// önceden bilinir (çağıran bir ölçüm geçişi yapar); veri parçalar hâlinde gelir. Bellekte yalnız merkezi dizin. Yazım
// geçişinde boy ve CRC yeniden hesaplanır: ölçümle farklı veri gelirse INVALID_ZIP (inceleme 15 B6; o ana kadar
// yazılanları çağıran atar). girdiAsync ve bitirAsync, yaz Promise dönerse onu bekler (geri basınç).
function zipAkis (yaz) {
  const girdiler = []
  const adlar = new Set()
  let off = 0
  const cik = (b) => { off += b.byteLength; return yaz(b) }
  const bas = (ad, boy, crc) => {
    if (girdiler.length >= MAX_GIRDI) fail('INVALID_ZIP')
    if (!adGecerli(ad) || adlar.has(adAnahtari(ad))) fail('INVALID_ZIP_NAME')
    if (!Number.isSafeInteger(boy) || boy < 0 || boy >= MAX_BOY) fail('ZIP_TOO_LARGE')
    adlar.add(adAnahtari(ad))
    const adB = b4a.from(ad)
    if (off + 30 + adB.byteLength + boy >= MAX_BOY) fail('ZIP_TOO_LARGE')
    girdiler.push({ ad: adB, crc, boy, ofset: off })
    const W = yazici(30 + adB.byteLength)
    W.u32(LOCAL); W.u16(20); W.u16(UTF8); W.u16(0); W.u16(0); W.u16(DOS_DATE)
    W.u32(crc); W.u32(boy); W.u32(boy); W.u16(adB.byteLength); W.u16(0)
    W.bytes(adB)
    return W.b
  }
  const denetle = (n, c, boy, crc) => { if (n !== boy || c.sonuc() !== crc) fail('INVALID_ZIP') } // ölçümle aynı veri gelmeli
  const son = () => {
    const mBoy = girdiler.reduce((a, g) => a + 46 + g.ad.byteLength, 0)
    if (off + mBoy + 22 > MAX_TOPLAM) fail('ZIP_TOO_LARGE')
    const W = yazici(mBoy + 22)
    for (const g of girdiler) {
      W.u32(CENTRAL); W.u16(20); W.u16(20); W.u16(UTF8); W.u16(0); W.u16(0); W.u16(DOS_DATE)
      W.u32(g.crc); W.u32(g.boy); W.u32(g.boy); W.u16(g.ad.byteLength); W.u16(0); W.u16(0)
      W.u16(0); W.u16(0); W.u32(0); W.u32(g.ofset)
      W.bytes(g.ad)
    }
    W.u32(EOCD); W.u16(0); W.u16(0); W.u16(girdiler.length); W.u16(girdiler.length); W.u32(mBoy); W.u32(off); W.u16(0)
    return W.b
  }
  return {
    girdi (ad, { boy, crc, parcalar }) {
      cik(bas(ad, boy, crc))
      const c = crcAkis()
      let n = 0
      for (const p of parcalar) { if (!b4a.isBuffer(p)) fail('INVALID_ZIP'); n += p.byteLength; c.ekle(p); cik(p) }
      denetle(n, c, boy, crc)
    },
    async girdiAsync (ad, { boy, crc, parcalar }) {
      await cik(bas(ad, boy, crc))
      const c = crcAkis()
      let n = 0
      for (const p of parcalar) { if (!b4a.isBuffer(p)) fail('INVALID_ZIP'); n += p.byteLength; c.ekle(p); await cik(p) }
      denetle(n, c, boy, crc)
    },
    async bitirAsync () { await cik(son()) },
    bitir () { cik(son()) }
  }
}

// Dönüş: [{ ad, bytes }]. inflate(sıkıştırılmış, enCok) → düz; enCok bildirilen boyuttur, açan bunu aşmamalı
// (zlib: maxOutputLength). Verilmezse sıkıştırmalı girdi ZIP_COMPRESSION. Bildirilen boyutların toplamı açmadan önce
// sınırlanır (zip bombası, RFC-0019 §11.6 c).
// Kanonik ZIP (RFC-0021 e): girdiler sıralı ve örtüşmesiz (her yerel başlık bir öncekinin verisinin bittiği yerde),
// yerel başlıktaki ad, yöntem, bayraklar, CRC ve boyutlar merkezi dizinle aynı, merkezi dizin son verinin hemen
// ardından, çok diskli alanlar sıfır, yorum yok. Uymayan INVALID_ZIP.
function zipOku (zip, { inflate = null, enCokToplam = MAX_TOPLAM } = {}) {
  if (!b4a.isBuffer(zip)) fail('INVALID_ZIP')
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  const u16 = (o) => { if (o < 0 || o + 2 > zip.byteLength) fail('INVALID_ZIP'); return dv.getUint16(o, true) }
  const u32 = (o) => { if (o < 0 || o + 4 > zip.byteLength) fail('INVALID_ZIP'); return dv.getUint32(o, true) }
  const e = zip.byteLength - 22 // yorum olmadığı için EOCD dosyanın sonundadır
  if (e < 0 || u32(e) !== EOCD) fail('INVALID_ZIP')
  if (u16(e + 4) !== 0 || u16(e + 6) !== 0 || u16(e + 8) !== u16(e + 10) || u16(e + 20) !== 0) fail('INVALID_ZIP')
  const n = u16(e + 10)
  const mBoy = u32(e + 12)
  const mBas = u32(e + 16)
  if (mBas === MAX_BOY || mBoy === MAX_BOY) fail('ZIP_TOO_LARGE')
  if (mBas + mBoy !== e) fail('INVALID_ZIP')
  let o = mBas
  let beklenen = 0 // sıradaki yerel başlığın ofseti
  const out = []
  const adlar = new Set()
  let toplam = 0
  for (let i = 0; i < n; i++) {
    if (u32(o) !== CENTRAL) fail('INVALID_ZIP')
    const bayrak = u16(o + 8)
    const yontem = u16(o + 10)
    const crc = u32(o + 16)
    const csize = u32(o + 20)
    const size = u32(o + 24)
    const adUz = u16(o + 28)
    const ekUz = u16(o + 30)
    const yorumUz = u16(o + 32)
    if (u16(o + 34) !== 0) fail('INVALID_ZIP') // disk numarası
    const lo = u32(o + 42)
    if (o + 46 + adUz > e) fail('INVALID_ZIP')
    const adBayt = zip.subarray(o + 46, o + 46 + adUz)
    const ad = b4a.toString(adBayt)
    o += 46 + adUz + ekUz + yorumUz
    if (bayrak & 1) fail('ZIP_ENCRYPTED') // ZIP içi şifreleme kullanılmaz
    if (!adGecerli(ad) || adlar.has(adAnahtari(ad))) fail('INVALID_ZIP_NAME')
    adlar.add(adAnahtari(ad))
    if (size === MAX_BOY || csize === MAX_BOY || lo === MAX_BOY) fail('ZIP_TOO_LARGE') // ZIP64 işareti
    toplam += size
    if (toplam > enCokToplam) fail('ZIP_TOO_LARGE')
    if (lo !== beklenen) fail('INVALID_ZIP') // örtüşme ya da boşluk
    if (u32(lo) !== LOCAL || u16(lo + 6) !== bayrak || u16(lo + 8) !== yontem || u32(lo + 14) !== crc || u32(lo + 18) !== csize || u32(lo + 22) !== size) fail('INVALID_ZIP')
    const yAdUz = u16(lo + 26)
    if (yAdUz !== adUz || !b4a.equals(zip.subarray(lo + 30, lo + 30 + yAdUz), adBayt)) fail('INVALID_ZIP')
    const veri = lo + 30 + yAdUz + u16(lo + 28)
    if (veri + csize > mBas) fail('INVALID_ZIP')
    beklenen = veri + csize
    const ham = zip.subarray(veri, veri + csize)
    let bytes
    if (yontem === 0) bytes = b4a.from(ham)
    else if (yontem === 8 && inflate) {
      try { bytes = b4a.from(inflate(ham, size)) } catch { fail('ZIP_CHECKSUM') }
    } else fail('ZIP_COMPRESSION')
    if (bytes.byteLength !== size || crc32(bytes) !== crc) fail('ZIP_CHECKSUM')
    out.push({ ad, bytes })
  }
  if (o !== e || beklenen !== mBas) fail('INVALID_ZIP') // merkezi dizin son verinin hemen ardından
  return out
}

module.exports = { MAX_BOY, MAX_TOPLAM, crc32, crcAkis, adGecerli, adAnahtari, zipYaz, zipAkis, zipOku }
