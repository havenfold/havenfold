// SPDX-License-Identifier: Apache-2.0
// open.js — Havenfold kabını (HFKAP, RFC-0014 §3) açar ve içindeki ZIP'i okur.
//
// Havenfold'u kurmadan kendi verisini açabilmek için bağımsız yazıldı (ilke 9): yalnız libsodium (sodium-native) ve
// Node'un zlib'i. Ürün şemasını bilmez; ZIP'i olduğu gibi çıkarır. Sertleştirilmiş okuyucu (RFC-0019 §11.6 e): yol
// geçişi, tekrar eden ad (NFC ve büyük/küçük harf duyarsız), boyut sınırı ve zip bombası.
// Kap akışla okunur: bellekte en çok bir parça tutulur; düz metin dosyaya yazılır (export-open.js).
const fs = require('fs')
const sodium = require('sodium-native')
const zlib = require('zlib')

const SIHIR = Buffer.from('HFKAP')
const CHUNK = 65536
const ABYTES = sodium.crypto_secretstream_xchacha20poly1305_ABYTES
const HEADERBYTES = sodium.crypto_secretstream_xchacha20poly1305_HEADERBYTES
const TAG_MESSAGE = sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE
const TAG_FINAL = sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL
const MIB = 1024 * 1024
const MAX_BOY = 0xffffffff
const MAX_TOPLAM = 2 * 1024 * MIB // v1 kap sınırı (RFC-0019 §11.6 b)

function fail (code) { throw new Error(code) }

// Başlık denetimi; yalnız başlık baytları (on) üstünde
function baslikCoz (on) {
  if (on.length < 10 || !on.subarray(0, 5).equals(SIHIR)) fail('INVALID_EXPORT')
  if (on[5] !== 1) fail('EXPORT_VERSION')
  const uz = on.readUInt32BE(6)
  if (uz > 4096 || on.length < 10 + uz) fail('INVALID_EXPORT')
  let h
  try { h = JSON.parse(on.subarray(10, 10 + uz).toString('utf8')) } catch { fail('INVALID_EXPORT') }
  if (!h || typeof h !== 'object' || Array.isArray(h)) fail('INVALID_EXPORT')
  if (h.kdf !== 'argon2id13' || h.cipher !== 'xchacha20poly1305-secretstream' || h.chunk !== CHUNK) fail('EXPORT_PARAMETER')
  if (!Number.isSafeInteger(h.opslimit) || h.opslimit < 3 || h.opslimit > 16) fail('EXPORT_PARAMETER')
  if (!Number.isSafeInteger(h.memlimit) || h.memlimit < 64 * MIB || h.memlimit > 1024 * MIB) fail('EXPORT_PARAMETER')
  if (typeof h.salt !== 'string') fail('INVALID_EXPORT')
  const salt = Buffer.from(h.salt, 'base64')
  if (salt.length !== 16 || salt.toString('base64') !== h.salt) fail('INVALID_EXPORT') // dolgulu, en kısa biçim
  if (typeof h.urun !== 'string' || typeof h.bicim !== 'string' || !Number.isSafeInteger(h.bicimSurum)) fail('INVALID_EXPORT')
  return { baslik: h, salt, on: on.subarray(0, 10 + uz), uz: 10 + uz }
}

// Bellekteki kap için (testler ve küçük dosyalar)
function baslik (kap) {
  if (!Buffer.isBuffer(kap)) fail('INVALID_EXPORT')
  const r = baslikCoz(kap.subarray(0, Math.min(kap.length, 10 + 4096)))
  if (kap.length < r.uz + HEADERBYTES) fail('INVALID_EXPORT')
  return { ...r, govde: kap.subarray(r.uz) }
}

// Parola NFC'ye çevrilip UTF-8 verilir (RFC-0019 §11.6 a)
function anahtar (parola, salt, h) {
  const key = Buffer.alloc(32)
  const p = Buffer.from(String(parola).normalize('NFC'), 'utf8')
  try { sodium.crypto_pwhash(key, p, salt, h.opslimit, h.memlimit, sodium.crypto_pwhash_ALG_ARGON2ID13) } catch { fail('EXPORT_MEMORY') } finally { sodium.sodium_memzero(p) }
  return key
}

// Akışla çözme. oku(n) → en çok n bayt (Buffer) ya da boş Buffer (dosya sonu); yaz(Buffer) düz metni alır.
function acAkis (oku, yaz, parola) {
  const bas = oku(10 + 4096 + HEADERBYTES)
  const { baslik: h, salt, on, uz } = baslikCoz(bas)
  if (bas.length < uz + HEADERBYTES) fail('INVALID_EXPORT')
  const key = anahtar(parola, salt, h)
  const st = Buffer.alloc(sodium.crypto_secretstream_xchacha20poly1305_STATEBYTES)
  try { sodium.crypto_secretstream_xchacha20poly1305_init_pull(st, bas.subarray(uz, uz + HEADERBYTES), key) } catch { fail('INVALID_EXPORT') } finally { sodium.sodium_memzero(key) }
  let artik = bas.subarray(uz + HEADERBYTES)
  const tag = Buffer.alloc(1)
  let i = 0
  let son = false
  let toplam = 0
  for (;;) {
    while (artik.length < CHUNK + ABYTES) {
      const b = oku(CHUNK + ABYTES - artik.length)
      if (!b.length) break
      artik = Buffer.concat([artik, b])
    }
    if (!artik.length) break
    if (son) fail('EXPORT_EXCESS')
    const c = artik.subarray(0, CHUNK + ABYTES)
    artik = artik.subarray(c.length)
    if (c.length < ABYTES) fail('EXPORT_TRUNCATED')
    const m = Buffer.alloc(c.length - ABYTES)
    try { sodium.crypto_secretstream_xchacha20poly1305_pull(st, m, tag, c, i === 0 ? on : null) } catch { fail(i === 0 ? 'EXPORT_UNVERIFIED' : 'EXPORT_CORRUPT') }
    if (tag[0] === TAG_FINAL) son = true
    else if (tag[0] !== TAG_MESSAGE || m.length !== CHUNK) fail('INVALID_EXPORT')
    toplam += m.length
    if (toplam > MAX_TOPLAM) fail('ZIP_TOO_LARGE')
    yaz(m)
    i++
  }
  sodium.sodium_memzero(st)
  if (!son) fail('EXPORT_TRUNCATED')
  return { baslik: h }
}

// Bellekteki kap → { baslik, icerik }
function ac (kap, parola) {
  if (!Buffer.isBuffer(kap)) fail('INVALID_EXPORT')
  let off = 0
  const out = []
  const r = acAkis((n) => { const b = kap.subarray(off, off + n); off += b.length; return b }, (m) => out.push(m), parola)
  return { baslik: r.baslik, icerik: Buffer.concat(out) }
}

// ZIP okuyucu: sıkıştırmasız ve deflate girdiler; CRC-32 denetimi; güvensiz ve tekrar eden adlar reddedilir.
// okuAt(ofset, uzunluk) → Buffer (dosyadan ya da bellekten); boy: ZIP'in boyu. Girdiler sırayla cb({ ad, bytes })'e verilir.
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
function crc32 (b) { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
// Her işletim sisteminde güvenli ad (RFC-0021 f): ':' ve denetim karakteri yok, parça nokta ya da boşlukla bitmez,
// Windows'un ayrılmış adları yok; çakışma NFC ve Unicode harf katlamasıyla
const AYRILMIS_AD = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i
const adGuvenli = (ad) => !!ad && ad.length <= 255 && !ad.startsWith('/') && !ad.includes('\\') && !ad.includes(':') &&
  !/[\u0000-\u001f\u007f]/.test(ad) && ad.split('/').every((p) => p && p !== '.' && p !== '..' && !/[. ]$/.test(p) && !AYRILMIS_AD.test(p))
const adAnahtari = (ad) => ad.normalize('NFC').toUpperCase().toLowerCase()

function zipGez (okuAt, boy, cb) {
  const al = (o, n) => {
    if (o < 0 || o + n > boy) fail('INVALID_ZIP')
    const b = okuAt(o, n)
    if (b.length !== n) fail('INVALID_ZIP')
    return b
  }
  const u16 = (o) => al(o, 2).readUInt16LE(0)
  const u32 = (o) => al(o, 4).readUInt32LE(0)
  // Kanonik ZIP (RFC-0021 e): yorum yok, tek disk, girdiler sıralı ve örtüşmesiz, yerel başlık merkezle aynı
  if (boy < 22) fail('INVALID_ZIP')
  const e = boy - 22
  if (u32(e) !== 0x06054b50) fail('INVALID_ZIP')
  if (u16(e + 4) !== 0 || u16(e + 6) !== 0 || u16(e + 8) !== u16(e + 10) || u16(e + 20) !== 0) fail('INVALID_ZIP')
  const n = u16(e + 10)
  const mBoy = u32(e + 12)
  const mBas = u32(e + 16)
  if (mBas === MAX_BOY || mBoy === MAX_BOY) fail('ZIP_TOO_LARGE')
  if (mBas + mBoy !== e) fail('INVALID_ZIP')
  let o = mBas
  let beklenen = 0
  const adlar = new Set()
  let toplam = 0
  const girdiler = []
  for (let i = 0; i < n; i++) {
    if (u32(o) !== 0x02014b50) fail('INVALID_ZIP')
    const bayrak = u16(o + 8)
    const yontem = u16(o + 10)
    const crc = u32(o + 16)
    const csize = u32(o + 20)
    const size = u32(o + 24)
    const adUz = u16(o + 28)
    if (u16(o + 34) !== 0) fail('INVALID_ZIP')
    const lo = u32(o + 42)
    const adBayt = al(o + 46, adUz)
    const ad = adBayt.toString('utf8')
    o += 46 + adUz + u16(o + 30) + u16(o + 32)
    if (bayrak & 1) fail('ZIP_ENCRYPTED')
    if (!adGuvenli(ad) || adlar.has(adAnahtari(ad))) fail('INVALID_ZIP_NAME')
    adlar.add(adAnahtari(ad))
    if (size === MAX_BOY || csize === MAX_BOY || lo === MAX_BOY) fail('ZIP_TOO_LARGE')
    toplam += size
    if (toplam > MAX_TOPLAM) fail('ZIP_TOO_LARGE') // açmadan önce: bildirilen toplam boyut
    if (lo !== beklenen) fail('INVALID_ZIP') // üst üste binen ya da boşluklu girdi
    if (u32(lo) !== 0x04034b50 || u16(lo + 6) !== bayrak || u16(lo + 8) !== yontem || u32(lo + 14) !== crc || u32(lo + 18) !== csize || u32(lo + 22) !== size) fail('INVALID_ZIP')
    if (u16(lo + 26) !== adUz || !al(lo + 30, adUz).equals(adBayt)) fail('INVALID_ZIP')
    const veri = lo + 30 + adUz + u16(lo + 28)
    if (veri + csize > mBas) fail('INVALID_ZIP')
    beklenen = veri + csize
    if (yontem !== 0 && yontem !== 8) fail('ZIP_COMPRESSION')
    girdiler.push({ ad, yontem, crc, csize, size, veri })
  }
  if (o !== e || beklenen !== mBas) fail('INVALID_ZIP')
  // Bütün dizin denetlendikten sonra açılır (yarım çıktı olmasın diye önce yapı, inceleme 6 Y2)
  for (const g of girdiler) {
    const ham = al(g.veri, g.csize)
    let bytes
    if (g.yontem === 0) bytes = ham
    else {
      try { bytes = zlib.inflateRawSync(ham, { maxOutputLength: Math.max(1, g.size) }) } catch { fail('ZIP_CHECKSUM') } // bildirilen boyuttan fazlası açılmaz
    }
    if (bytes.length !== g.size || crc32(bytes) !== g.crc) fail('ZIP_CHECKSUM')
    cb({ ad: g.ad, bytes })
  }
}

// Bellekteki ZIP → [{ ad, bytes }]
function zipOku (z) {
  if (!Buffer.isBuffer(z)) fail('INVALID_ZIP')
  const out = []
  zipGez((o, n) => z.subarray(o, o + n), z.length, (g) => out.push({ ad: g.ad, bytes: Buffer.from(g.bytes) }))
  return out
}

// Dosyadaki ZIP (fd) → girdiler sırayla cb'ye
function zipOkuDosya (fd, cb) {
  const boy = fs.fstatSync(fd).size
  zipGez((o, n) => { const b = Buffer.alloc(n); const r = fs.readSync(fd, b, 0, n, o); return b.subarray(0, r) }, boy, cb)
}

module.exports = { baslik, baslikCoz, ac, acAkis, zipOku, zipOkuDosya, adGuvenli, adAnahtari, MAX_TOPLAM }
