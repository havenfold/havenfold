// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// export.js — Havenfold dışa aktarma kabı (RFC-0014 §3)
//
//   sihir "HFKAP" ‖ sürüm 0x01 ‖ başlık_uz (u32be, ≤ 4096) ‖ başlık (UTF-8 JSON) ‖ akış başı (24 B) ‖ parçalar
//   anahtar = crypto_pwhash(32, parola, salt, opslimit, memlimit, ALG_ARGON2ID13)
//   parça   = crypto_secretstream_xchacha20poly1305_push(düz ≤ 65536 B); 1. parçanın AD'si sihir ‖ sürüm ‖ başlık_uz ‖ başlık
// Yazıcı son parça dışındaki bütün parçaları tam 65536 B düz metinle yazar; okuyucu akışı bu boyuta göre böler.
// Kendi kriptomuzu yazmayız (H7): yalnız libsodium işlevleri.
const b4a = require('b4a')
const sodium = require('sodium-native')

function fail (code) { throw new Error(code) }

const SIHIR = b4a.from('HFKAP')
const SURUM = 0x01
const MAX_BASLIK = 4096
const CHUNK = 65536
const ABYTES = sodium.crypto_secretstream_xchacha20poly1305_ABYTES
const HEADERBYTES = sodium.crypto_secretstream_xchacha20poly1305_HEADERBYTES
const TAG_MESSAGE = sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE
const TAG_FINAL = sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL
const MIB = 1024 * 1024
const SINIR = { opsMin: 3, opsMax: 16, memMin: 64 * MIB, memMax: 1024 * MIB }
const VARSAYILAN = { opslimit: 4, memlimit: 128 * MIB }
const KDF = 'argon2id13'
const CIPHER = 'xchacha20poly1305-secretstream'
const EN_AZ_PAROLA = 12

// v1'de kap en çok 2 GiB (ZIP64 yok, RFC-0019 §11.6 b); telefonda açılacak kapta memlimit en çok 512 MiB (§11.6 d)
const MAX_KAP = 2 * 1024 * MIB
const TELEFON_MEM = 512 * MIB
const TELEFON_OPS = 8 // RFC-0021 h: telefonda opslimit ≤ 8, memlimit ≤ 512 MiB

// Parola NFC'ye çevrilip UTF-8 verilir (RFC-0019 §11.6 a): aynı parola iki klavyede farklı baytlarla yazılabilir
const parolaBaytlari = (parola) => b4a.from(parola.normalize('NFC'))

function anahtarTuret (parola, salt, opslimit, memlimit) {
  const key = b4a.alloc(32)
  const p = parolaBaytlari(parola)
  try { sodium.crypto_pwhash(key, p, salt, opslimit, memlimit, sodium.crypto_pwhash_ALG_ARGON2ID13) } catch { fail('EXPORT_MEMORY') } finally { sodium.sodium_memzero(p) }
  return key
}

// Telefonda eşzamansız (arayüz donmaz). Bellek ayrılamazsa EXPORT_MEMORY.
function anahtarTuretAsync (parola, salt, opslimit, memlimit) {
  return new Promise((resolve, reject) => {
    const key = b4a.alloc(32)
    const p = parolaBaytlari(parola)
    try {
      sodium.crypto_pwhash_async(key, p, salt, opslimit, memlimit, sodium.crypto_pwhash_ALG_ARGON2ID13, (err) => {
        sodium.sodium_memzero(p)
        if (err) reject(new Error('EXPORT_MEMORY'))
        else resolve(key)
      })
    } catch { sodium.sodium_memzero(p); reject(new Error('EXPORT_MEMORY')) }
  })
}

const u32 = (n) => { const b = b4a.alloc(4); new DataView(b.buffer, b.byteOffset).setUint32(0, n); return b }

function baslikDenetle (h) {
  if (!h || typeof h !== 'object') fail('INVALID_EXPORT')
  if (h.kdf !== KDF || h.cipher !== CIPHER || h.chunk !== CHUNK) fail('EXPORT_PARAMETER')
  if (!Number.isSafeInteger(h.opslimit) || h.opslimit < SINIR.opsMin || h.opslimit > SINIR.opsMax) fail('EXPORT_PARAMETER')
  if (!Number.isSafeInteger(h.memlimit) || h.memlimit < SINIR.memMin || h.memlimit > SINIR.memMax) fail('EXPORT_PARAMETER')
  // Bare'de geçersiz base64 fırlatır (D50 bulanık test): önce biçim
  if (typeof h.salt !== 'string' || !/^[A-Za-z0-9+/]{22}==$/.test(h.salt)) fail('INVALID_EXPORT')
  const salt = b4a.from(h.salt, 'base64')
  if (salt.byteLength !== 16 || b4a.toString(salt, 'base64') !== h.salt) fail('INVALID_EXPORT')
  if (typeof h.urun !== 'string' || typeof h.bicim !== 'string' || !Number.isSafeInteger(h.bicimSurum)) fail('INVALID_EXPORT')
  return salt
}

// Başlık ve 1. parçanın AD'si
function onKur (parola, { urun, bicim, bicimSurum = 1, opslimit = VARSAYILAN.opslimit, memlimit = VARSAYILAN.memlimit, salt = null } = {}) {
  if (typeof parola !== 'string' || [...parola.normalize('NFC')].length < EN_AZ_PAROLA) fail('PASSWORD_TOO_SHORT')
  if (!salt) { salt = b4a.alloc(16); sodium.randombytes_buf(salt) }
  const baslik = { kdf: KDF, opslimit, memlimit, salt: b4a.toString(salt, 'base64'), cipher: CIPHER, chunk: CHUNK, urun, bicim, bicimSurum }
  baslikDenetle(baslik)
  const hb = b4a.from(JSON.stringify(baslik))
  if (hb.byteLength > MAX_BASLIK) fail('INVALID_EXPORT')
  return { baslik, salt, on: b4a.concat([SIHIR, b4a.from([SURUM]), u32(hb.byteLength), hb]) }
}

// Akışla yazıcı (RFC-0019 §11.6 b): yaz(parça) şifreli baytları döner, bitir() son parçayı. Bellekte en çok bir parça.
class KapYazici {
  constructor (key, on) {
    this.on = on
    this.state = b4a.alloc(sodium.crypto_secretstream_xchacha20poly1305_STATEBYTES)
    this.akisBasi = b4a.alloc(HEADERBYTES)
    sodium.crypto_secretstream_xchacha20poly1305_init_push(this.state, this.akisBasi, key)
    sodium.sodium_memzero(key)
    // Bekleyen düz metin parçaları: tam parça dolunca bir kez birleştirilir (her küçük yazımda baştan birleştirmek
    // parça başına 64 KiB'a kadar kopya ve sayfa sayısıyla büyüyen çöp demekti; D41)
    this.bekleyen = []
    this.bekleyenBoy = 0
    this.ilk = true
    this.boy = on.byteLength + HEADERBYTES
  }

  baslangic () { return b4a.concat([this.on, this.akisBasi]) }

  _it (m, tag) {
    const c = b4a.alloc(m.byteLength + ABYTES)
    sodium.crypto_secretstream_xchacha20poly1305_push(this.state, c, m, this.ilk ? this.on : null, tag)
    this.ilk = false
    this.boy += c.byteLength
    if (this.boy > MAX_KAP) fail('ZIP_TOO_LARGE')
    return c
  }

  // Tam parçaları şifreler; son parça bitir()'e kalır (TAG_FINAL)
  yaz (bytes) {
    if (!b4a.isBuffer(bytes)) fail('INVALID_EXPORT')
    this.bekleyen.push(bytes)
    this.bekleyenBoy += bytes.byteLength
    if (this.bekleyenBoy <= CHUNK) return []
    const buf = this.bekleyen.length === 1 ? this.bekleyen[0] : b4a.concat(this.bekleyen)
    const out = []
    let o = 0
    while (buf.byteLength - o > CHUNK) {
      out.push(this._it(buf.subarray(o, o + CHUNK), TAG_MESSAGE))
      o += CHUNK
    }
    const kalan = b4a.from(buf.subarray(o)) // kopya: büyük tampon bırakılsın
    this.bekleyen = [kalan]
    this.bekleyenBoy = kalan.byteLength
    return out
  }

  // Hata yolunda akış durumu ve bekleyen düz metin sıfırlanır (inceleme 15)
  iptal () {
    sodium.sodium_memzero(this.state)
    for (const b of this.bekleyen) sodium.sodium_memzero(b)
    this.bekleyen = []
    this.bekleyenBoy = 0
  }

  bitir () {
    const son = this.bekleyen.length === 1 ? this.bekleyen[0] : b4a.concat(this.bekleyen)
    const c = this._it(son, TAG_FINAL)
    sodium.sodium_memzero(this.state)
    this.bekleyen = []
    this.bekleyenBoy = 0
    return c
  }
}

function kapYazici (parola, opts = {}) {
  const { baslik, salt, on } = onKur(parola, opts)
  return new KapYazici(anahtarTuret(parola, salt, baslik.opslimit, baslik.memlimit), on)
}

async function kapYaziciAsync (parola, opts = {}) {
  const { baslik, salt, on } = onKur(parola, opts)
  return new KapYazici(await anahtarTuretAsync(parola, salt, baslik.opslimit, baslik.memlimit), on)
}

// icerik: düz metin (ZIP baytları). Dönüş: kabın baytları. salt yalnız test vektörü için verilir.
function kapla (icerik, parola, opts = {}) {
  if (!b4a.isBuffer(icerik)) fail('INVALID_EXPORT') // bayt dizisi olmayan içerik açılamaz kap üretirdi (inceleme kap 5)
  return yazdir(kapYazici(parola, opts), icerik)
}

async function kaplaAsync (icerik, parola, opts = {}) {
  if (!b4a.isBuffer(icerik)) fail('INVALID_EXPORT')
  return yazdir(await kapYaziciAsync(parola, opts), icerik)
}

function yazdir (y, icerik) {
  if (icerik.byteLength > MAX_KAP) fail('ZIP_TOO_LARGE')
  return b4a.concat([y.baslangic(), ...y.yaz(icerik), y.bitir()])
}

// Yalnız başlık (parola gerekmez; export-open ve arayüz ürünü göstermek için)
function baslikOku (kap) {
  if (!b4a.isBuffer(kap) || kap.byteLength < 10 || !b4a.equals(kap.subarray(0, 5), SIHIR)) fail('INVALID_EXPORT')
  if (kap[5] !== SURUM) fail('EXPORT_VERSION')
  const uz = new DataView(kap.buffer, kap.byteOffset + 6, 4).getUint32(0)
  if (uz > MAX_BASLIK || kap.byteLength < 10 + uz + HEADERBYTES) fail('INVALID_EXPORT')
  const hb = kap.subarray(10, 10 + uz)
  let baslik
  try { baslik = JSON.parse(b4a.toString(hb)) } catch { fail('INVALID_EXPORT') }
  const salt = baslikDenetle(baslik)
  return { baslik, salt, on: kap.subarray(0, 10 + uz), govde: kap.subarray(10 + uz) }
}

// Dönüş: { baslik, icerik }. Hatalar: INVALID_EXPORT, EXPORT_VERSION, EXPORT_PARAMETER, EXPORT_UNVERIFIED (yanlış parola ya da
// değiştirilmiş başlık / 1. parça), EXPORT_CORRUPT (sonraki bir parça doğrulanmadı: ortadan kesilmiş, değiştirilmiş ya da
// kısa son parçanın sonuna bayt eklenmiş), EXPORT_TRUNCATED (parça sınırında kesilmiş, TAG_FINAL yok), EXPORT_EXCESS (tam boy
// son parçadan sonra bayt). Hepsinde dosya açılmaz.
function ac (kap, parola) {
  const { baslik, salt, on, govde } = baslikOku(kap)
  boyDenetle(govde)
  return acIle(anahtarTuret(parola, salt, baslik.opslimit, baslik.memlimit), baslik, on, govde)
}

// Bütün kabı bellekte açan yollar (ac, acAsync) için düz metin sınırı Argon2'den önce, şifreli gövdenin boyundan
// (Codex 12. tur: akışlı okuyucu ve kapla MAX_KAP uyguluyordu, bunlar uygulamıyordu; telefonda 1,5 GiB'lık kap bütünüyle
// çözülüp ancak zipOku'da reddediliyordu). Telefonda arşivin toplam sınırı (archive.js TELEFON_TOPLAM, 512 MiB) ve ZIP
// başlıkları için pay
const TELEFON_KAP = 576 * MIB
const govdeSiniri = (sinir) => HEADERBYTES + sinir + (Math.floor(sinir / CHUNK) + 1) * ABYTES
function boyDenetle (govde, sinir = MAX_KAP) {
  if (govde.byteLength > govdeSiniri(sinir)) fail('ZIP_TOO_LARGE')
}

// Telefonda açılabilir mi (RFC-0021 h): maliyeti dosya belirlediği için parola doğrulanmadan önce sınırlanır
function telefonSiniri (baslik) {
  if (baslik.opslimit > TELEFON_OPS || baslik.memlimit > TELEFON_MEM) fail('EXPORT_MEMORY')
}

// Eşzamansız Argon2id. telefon varsayılanı güvenli tarafta (true): opslimit ≤ 8, memlimit ≤ 512 MiB (EXPORT_MEMORY)
async function acAsync (kap, parola, { telefon = true } = {}) {
  const { baslik, salt, on, govde } = baslikOku(kap)
  if (telefon) telefonSiniri(baslik)
  boyDenetle(govde, telefon ? TELEFON_KAP : MAX_KAP)
  return acIle(await anahtarTuretAsync(parola, salt, baslik.opslimit, baslik.memlimit), baslik, on, govde)
}

// Akışla okuyucu (RFC-0019 §11.6 b): baslat(baslangic baytları) sonra besle(parça) düz metin parçaları döner,
// bitir() son parçanın geldiğini denetler. Bellekte en çok bir şifreli parça tutulur.
class KapOkuyucu {
  constructor (key, baslik, on, akisBasi) {
    this.baslik = baslik
    this.on = on
    this.state = b4a.alloc(sodium.crypto_secretstream_xchacha20poly1305_STATEBYTES)
    try { sodium.crypto_secretstream_xchacha20poly1305_init_pull(this.state, akisBasi, key) } catch { fail('INVALID_EXPORT') } finally { sodium.sodium_memzero(key) }
    this.tampon = b4a.alloc(0)
    this.i = 0
    this.son = false
    this.boy = 0
    this.tag = b4a.alloc(1)
  }

  _cek (c) {
    if (this.son) fail('EXPORT_EXCESS')
    if (c.byteLength < ABYTES) fail('EXPORT_TRUNCATED')
    const m = b4a.alloc(c.byteLength - ABYTES)
    try {
      sodium.crypto_secretstream_xchacha20poly1305_pull(this.state, m, this.tag, c, this.i === 0 ? this.on : null)
    } catch { fail(this.i === 0 ? 'EXPORT_UNVERIFIED' : 'EXPORT_CORRUPT') }
    if (this.tag[0] === TAG_FINAL) this.son = true
    else if (this.tag[0] !== TAG_MESSAGE || m.byteLength !== CHUNK) fail('INVALID_EXPORT')
    this.boy += m.byteLength
    if (this.boy > MAX_KAP) fail('ZIP_TOO_LARGE')
    this.i++
    return m
  }

  besle (bytes) {
    this.tampon = this.tampon.byteLength ? b4a.concat([this.tampon, bytes]) : bytes
    const out = []
    while (this.tampon.byteLength >= CHUNK + ABYTES) {
      out.push(this._cek(this.tampon.subarray(0, CHUNK + ABYTES)))
      this.tampon = this.tampon.subarray(CHUNK + ABYTES)
    }
    return out
  }

  bitir () {
    const out = this.tampon.byteLength ? [this._cek(this.tampon)] : []
    this.tampon = b4a.alloc(0)
    sodium.sodium_memzero(this.state)
    if (!this.son) fail('EXPORT_TRUNCATED')
    return out
  }
}

// bas: kabın en az başlık + akış başı kadar ilk baytları. Dönüş: { okuyucu, kalan } (kalan: bas'ın akış kısmı)
function kapOkuyucu (bas, parola, { telefon = false } = {}) {
  const { baslik, salt, on, govde } = baslikOku(bas)
  if (telefon) telefonSiniri(baslik)
  const ok = new KapOkuyucu(anahtarTuret(parola, salt, baslik.opslimit, baslik.memlimit), baslik, on, govde.subarray(0, HEADERBYTES))
  return { okuyucu: ok, kalan: govde.subarray(HEADERBYTES) }
}

function acIle (key, baslik, on, govde) {
  const state = b4a.alloc(sodium.crypto_secretstream_xchacha20poly1305_STATEBYTES)
  try {
    sodium.crypto_secretstream_xchacha20poly1305_init_pull(state, govde.subarray(0, HEADERBYTES), key)
  } catch { fail('INVALID_EXPORT') } finally { sodium.sodium_memzero(key) }
  const akis = govde.subarray(HEADERBYTES)
  const out = []
  const tag = b4a.alloc(1)
  let i = 0
  let off = 0
  let son = false
  while (off < akis.byteLength) {
    if (son) fail('EXPORT_EXCESS')
    const c = akis.subarray(off, off + CHUNK + ABYTES)
    if (c.byteLength < ABYTES) fail('EXPORT_TRUNCATED')
    const m = b4a.alloc(c.byteLength - ABYTES)
    try {
      sodium.crypto_secretstream_xchacha20poly1305_pull(state, m, tag, c, i === 0 ? on : null)
    } catch { fail(i === 0 ? 'EXPORT_UNVERIFIED' : 'EXPORT_CORRUPT') }
    if (tag[0] === TAG_FINAL) son = true
    else if (tag[0] !== TAG_MESSAGE || m.byteLength !== CHUNK) fail('INVALID_EXPORT')
    out.push(m)
    off += c.byteLength
    i++
  }
  sodium.sodium_memzero(state)
  if (!son) fail('EXPORT_TRUNCATED')
  return { baslik, icerik: b4a.concat(out) }
}

// 24 karakterlik önerilen parola (karışan harfler yok: 0/O, 1/l/I)
const ALFABE = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function parolaOner (uz = 24) {
  let s = ''
  const b = b4a.alloc(1)
  while (s.length < uz) {
    sodium.randombytes_buf(b)
    if (b[0] < 256 - (256 % ALFABE.length)) s += ALFABE[b[0] % ALFABE.length]
  }
  return s
}

module.exports = {
  SIHIR, SURUM, MAX_BASLIK, CHUNK, ABYTES, HEADERBYTES, SINIR, VARSAYILAN, EN_AZ_PAROLA, MAX_KAP, TELEFON_MEM, TELEFON_OPS, TELEFON_KAP, boyDenetle,
  KapOkuyucu, kapOkuyucu, telefonSiniri,
  kapla, kaplaAsync, kapYazici, kapYaziciAsync, baslikOku, ac, acAsync, parolaOner, anahtarTuret, anahtarTuretAsync, parolaBaytlari
}
