// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// resolver.js — belirlenimci Türkçe çözücüler: tarih, saat, rakam dizisi, telefon, e-posta, IBAN, T.C. kimlik, kart,
// tutar, plaka, adres işareti (RFC-0013 §6.5, §8.3)
//
// Hepsi N'den geçmiş metin üzerinde çalışır. Konumlar (bas, bit) N(metin) içindeki kod birimi konumlarıdır.
const { N } = require('./text')

// Rakam aramadan önce (RFC-0023 §2 b): biçim karakterleri (\p{Cf}) silinir, bütün ondalık rakamlar (\p{Nd}) ASCII'ye
// çevrilir. Sıfır rakamının kod noktaları: Arap-Hint, Farsça, N'Ko, Devanagari … (NFKC tam genişliği zaten çevirir).
const SIFIRLAR = [0x660, 0x6f0, 0x7c0, 0x966, 0x9e6, 0xa66, 0xae6, 0xb66, 0xbe6, 0xc66, 0xce6, 0xd66, 0xde6, 0xe50, 0xed0, 0xf20,
  0x1040, 0x1090, 0x17e0, 0x1810, 0x1946, 0x19d0, 0x1a80, 0x1a90, 0x1b50, 0x1bb0, 0x1c40, 0x1c50, 0xa620, 0xa8d0, 0xa900, 0xa9d0,
  0xa9f0, 0xaa50, 0xabf0, 0xff10]
function rakamHazirla (n) {
  return n.replace(/\p{Cf}/gu, '').replace(/\p{Nd}/gu, (ch) => {
    const cp = ch.codePointAt(0)
    if (cp < 0x80) return ch
    const z = SIFIRLAR.find((x) => cp >= x && cp <= x + 9)
    return z === undefined ? ch : String(cp - z)
  })
}
const H = (metin) => rakamHazirla(N(metin))

const SINIR_ONCE = '(?<![\\p{L}\\p{N}])'
const SINIR_SONRA = '(?![\\p{L}\\p{N}])'

// --- Tarih (§8.3) --------------------------------------------------------------------------------------------------

const AYLAR = ['ocak', 'şubat', 'mart', 'nisan', 'mayıs', 'haziran', 'temmuz', 'ağustos', 'eylül', 'ekim', 'kasım', 'aralık']
const KISA = ['oca', 'şub', 'mar', 'nis', 'may', 'haz', 'tem', 'ağu', 'eyl', 'eki', 'kas', 'ara']
const AY_NO = new Map([...AYLAR.map((a, i) => [a, i + 1]), ...KISA.map((a, i) => [a, i + 1])])
// Uzun adlar önce: 'mart' 'mar'dan, 'ekim' 'eki'den önce denenir
const AY_RE = [...AY_NO.keys()].sort((a, b) => b.length - a.length).join('|')

const RE_GAY = new RegExp('(?<!\\d)(\\d{1,2})([./-])(\\d{1,2})\\2(\\d{4})(?!\\d)', 'gu') // gg.aa.yyyy, gg/aa/yyyy, gg-aa-yyyy
const RE_YAG = /(?<![\d./-])(\d{4})-(\d{1,2})-(\d{1,2})(?![\d./-])/gu // yyyy-aa-gg
const RE_ADLI = new RegExp('(?<!\\d)(\\d{1,2}) (' + AY_RE + ')\\.? (\\d{4})(?!\\d)', 'gu') // g Ay yyyy

const artik = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
const GUNLER = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
const iki = (x) => String(x).padStart(2, '0')

function tarihYaz (y, a, g) {
  if (y < 1000 || a < 1 || a > 12 || g < 1) return null
  if (g > (a === 2 && artik(y) ? 29 : GUNLER[a - 1])) return null
  return y + '-' + iki(a) + '-' + iki(g)
}

// Dönüş: [{ deger: 'YYYY-MM-DD', bas, bit }] metindeki sırayla. İki haneli yıl tanınmaz. Göreli ifade çözülmez.
function tarihler (metin) {
  const n = H(metin)
  const out = []
  const ekle = (m, d) => { if (d) out.push({ deger: d, bas: m.index, bit: m.index + m[0].length }) }
  for (const m of n.matchAll(RE_GAY)) ekle(m, tarihYaz(+m[4], +m[3], +m[1]))
  for (const m of n.matchAll(RE_YAG)) ekle(m, tarihYaz(+m[1], +m[2], +m[3]))
  for (const m of n.matchAll(RE_ADLI)) ekle(m, tarihYaz(+m[3], AY_NO.get(m[2]), +m[1]))
  return out.sort((a, b) => a.bas - b.bas)
}

// --- Saat ----------------------------------------------------------------------------------------------------------

const RE_SAAT = /(?<![\d:.])([01]?\d|2[0-3]):([0-5]\d)(?![\d:])/gu

// Dönüş: [{ deger: 'HH:MM', bas, bit }]
function saatler (metin) {
  return [...H(metin).matchAll(RE_SAAT)].map((m) => ({ deger: iki(+m[1]) + ':' + m[2], bas: m.index, bit: m.index + m[0].length }))
}

// --- Rakam dizileri (§8.3) -----------------------------------------------------------------------------------------

// Bir rakam öbeği: rakamlar, aralarında nokta ya da tire olabilir. Öbekler tek boşlukla ayrılırsa aynı dizidir.
const RE_DIZI = /\d(?:[.-]?\d)*(?: \d(?:[.-]?\d)*)*/gu

// Kaynaktaki rakam dizileri (boşluk, nokta, tire yok sayılır). Boşlukla ayrılmış öbeklerin her ardışık birleşimi de
// bir dizidir: "Model 2024 1250 TL" hem "20241250"yi hem "1250"yi verir.
function rakamDizileri (metin) {
  const out = new Set()
  for (const m of H(metin).matchAll(RE_DIZI)) {
    const obekler = m[0].split(' ').map((x) => x.replace(/[.-]/g, ''))
    for (let i = 0; i < obekler.length; i++) {
      let s = ''
      for (let j = i; j < obekler.length; j++) { s += obekler[j]; out.add(s) }
    }
  }
  return out
}

const rakamlar = (s) => String(s).replace(/\D/g, '')

// --- Telefon (§6.5 madde 2) ----------------------------------------------------------------------------------------

// Ayırıcılar boşluk, nokta, tire ve parantez: (0532) 123 45 67, +90 (532) …, 0532.123.45.67
const RE_TEL = /(?<![\d+])\+?\(?\d(?:[ .\-()]{0,2}\d)*(?!\d)/gu

// Türkiye numarası: isteğe bağlı +90 ya da 0, ardından 10 rakam. Dönüş: [{ deger: '+90…' (E.164), bas, bit }]
function telefonlar (metin) {
  const out = []
  for (const m of H(metin).matchAll(RE_TEL)) {
    const s = m[0].replace(/[ .\-()]/g, '')
    const t = /^(?:\+90|0)?(\d{10})$/.exec(s)
    if (t) out.push({ deger: '+90' + t[1], bas: m.index, bit: m.index + m[0].length })
  }
  return out
}

// --- E-posta (§6.5 madde 3) ----------------------------------------------------------------------------------------

const RE_EPOSTA = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu

const epostalar = (metin) => [...H(metin).matchAll(RE_EPOSTA)].map((m) => ({ deger: m[0], bas: m.index, bit: m.index + m[0].length }))

// --- T.C. kimlik (§6.5 madde 4) ------------------------------------------------------------------------------------

// 11 rakam, ilki 0 değil; 10. hane = ((1+3+5+7+9) × 7 − (2+4+6+8)) mod 10; 11. hane = ilk 10 hanenin toplamı mod 10
function tcknGecerli (s) {
  if (!/^[1-9]\d{10}$/.test(s)) return false
  const d = [...s].map(Number)
  const tek = d[0] + d[2] + d[4] + d[6] + d[8]
  const cift = d[1] + d[3] + d[5] + d[7]
  if ((((tek * 7 - cift) % 10) + 10) % 10 !== d[9]) return false
  return d.slice(0, 10).reduce((a, b) => a + b, 0) % 10 === d[10]
}

// Boşluklu ya da noktalı yazım da (100 000 001 46)
const tcknler = (metin) => [...H(metin).matchAll(/(?<!\d)\d(?:[ .\-]?\d){10}(?![\d])/gu)]
  .map((m) => ({ deger: m[0].replace(/[ .\-]/g, ''), bas: m.index, bit: m.index + m[0].length })).filter((x) => tcknGecerli(x.deger))

// --- IBAN (§6.5 madde 5) -------------------------------------------------------------------------------------------

// ISO 13616: ülke kodu ve denetim haneleri sona alınır, harfler 10–35 olur, sayı mod 97 = 1
function ibanGecerli (s) {
  if (!/^TR\d{24}$/.test(s)) return false
  const d = s.slice(4) + '2927' + s.slice(2, 4) // T = 29, R = 27
  let r = 0
  for (const ch of d) r = (r * 10 + Number(ch)) % 97
  return r === 1
}

// TR ile rakamlar arasında boşluk olabilir; ayırıcılar boşluk, nokta, tire
const RE_IBAN = new RegExp(SINIR_ONCE + 'tr[ .\\-]?(\\d{2}(?:[ .\\-]?\\d){22})(?!\\d)', 'gu')

// Dönüş: [{ deger: 'TR' + 24 rakam (boşluksuz), bas, bit }], yalnız mod 97 tutanlar
function ibanlar (metin) {
  const out = []
  for (const m of H(metin).matchAll(RE_IBAN)) {
    const v = 'TR' + m[1].replace(/[ .\-]/g, '')
    if (ibanGecerli(v)) out.push({ deger: v, bas: m.index, bit: m.index + m[0].length })
  }
  return out
}

// --- Kart (§6.5 madde 6) -------------------------------------------------------------------------------------------

function luhn (s) {
  let t = 0
  for (let i = 0; i < s.length; i++) {
    let x = Number(s[s.length - 1 - i])
    if (i % 2 === 1) { x *= 2; if (x > 9) x -= 9 }
    t += x
  }
  return t % 10 === 0
}

const kartlar = (metin) => [...H(metin).matchAll(/(?<!\d)\d(?:[ .\-]?\d)*(?!\d)/gu)]
  .map((m) => ({ deger: m[0].replace(/[ .\-]/g, ''), bas: m.index, bit: m.index + m[0].length }))
  .filter((x) => x.deger.length >= 13 && x.deger.length <= 19 && luhn(x.deger))

// --- Tutar ---------------------------------------------------------------------------------------------------------

// "1.250,50 TL" → 125050 kuruş. Binlik ayırıcı nokta, ondalık virgül. Para birimi yoksa birim null.
const RE_TUTAR = /(?<![\d.,])(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?(?![\d.,]\d)(?: ?(tl|₺|try|lira)(?!\p{L}))?/gu

function tutarlar (metin) {
  const out = []
  for (const m of H(metin).matchAll(RE_TUTAR)) {
    const lira = Number(m[1].replace(/\./g, ''))
    const kurus = m[2] ? Number(m[2].padEnd(2, '0')) : 0
    const deger = lira * 100 + kurus
    if (Number.isSafeInteger(deger)) out.push({ deger, birim: m[3] ? 'TRY' : null, bas: m.index, bit: m.index + m[0].length })
  }
  return out
}

// --- Plaka ve adres (§6.5 madde 7, 8) ------------------------------------------------------------------------------

const RE_PLAKA = new RegExp(SINIR_ONCE + '\\d{2} ?[a-z]{1,3} ?\\d{2,4}' + SINIR_SONRA, 'u')
const ADRES = ['mahallesi', 'mah', 'sokak', 'sok', 'caddesi', 'cad', 'bulvarı', 'apt', 'daire']
// İşaret tam kelime; ardından (nokta ya da iki nokta ve bir boşluk olabilir) rakam. "no:" doğrudan rakama bağlanır.
const RE_ADRES = new RegExp(SINIR_ONCE + '(?:(?:' + ADRES.join('|') + ')\\.?:? ?|no[:.]? ?)\\d', 'u') // "No 5" de

const plakaVar = (metin) => RE_PLAKA.test(H(metin))
const adresVar = (metin) => RE_ADRES.test(H(metin))

module.exports = {
  AYLAR,
  KISA,
  tarihler,
  saatler,
  rakamDizileri,
  rakamlar,
  rakamHazirla,
  telefonlar,
  epostalar,
  tcknGecerli,
  tcknler,
  ibanGecerli,
  ibanlar,
  luhn,
  kartlar,
  tutarlar,
  plakaVar,
  adresVar
}
