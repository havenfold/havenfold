// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// protocol/bridge.js — kişisel köprü: aynı telefondaki ekip ve aile uygulaması arasında kişinin kendi durumu
// (RFC-0005 §15)
//
//   KOPRU { v: 1, from: 'ekip' | 'aile', type, text (≤ 280 bayt), at (ms), nonce (16 bayt) }
//   taşıma metni = 'hfkopru1:' + base64url(encode(KOPRU))   (≤ 1 KB)
//
// Ağa çıkmaz; işletim sisteminin aynı geliştiricinin uygulamaları arasındaki kısıtlı yolundan geçer. Kriptografi yok:
// paket telefondan çıkmaz, alan uygulamada kişinin onayıyla kişinin kendi mesajı olur. familyId, kimlik, ad, işletme,
// yer ve koordinat taşımaz. Alan uygulama listede olmayan türü, 280 baytı aşan metni ve gördüğü nonce'u reddeder.
const c = require('compact-encoding')
const b4a = require('b4a')
const { canonical } = require('../ledger/encoding')

function fail (code) { throw new Error(code) }
const hex = (b) => b4a.toString(b, 'hex')

const ON_EK = 'hfkopru1:'
const METIN_MAX = 280 // bayt
const TASIMA_MAX = 1024 // bayt
const NONCE_MS = 7 * 86_400_000 // tazelik penceresi (geçmişe) ve nonce saklama süresi (RFC-0027 §7 c)
const ILERI_MS = 5 * 60_000 // tazelik penceresi (ileriye)
const NONCE_MAX = 1000 // nonce defterinin üst sınırı (inceleme 17 B3)

// §15.2: yön başına yalnız kişinin kendi durumu. Yön yalnız kendi alanlarından: '__proto__', 'constructor' yön
// sayılmaz (yonVar; inceleme 17 B4)
const TURLER = Object.freeze({
  ekip: Object.freeze(['mekan.durum.giris', 'mekan.durum.cikis', 'mekan.durum.gec', 'mekan.durum.serbest']),
  aile: Object.freeze(['yuva.durum.gec', 'yuva.durum.serbest'])
})
const yonVar = (x) => typeof x === 'string' && Object.prototype.hasOwnProperty.call(TURLER, x)

// Görünmez karakterler (denetim, biçim, varsayılan yok sayılan) boşluk sayılır; bidi denetimleri hiç olmaz (B5)
const GORUNMEZ = /[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/gu
const BIDI = /[\u202A-\u202E\u2066-\u2069]/

const kopru = {
  preencode (s, m) { c.uint.preencode(s, m.v); c.string.preencode(s, m.from); c.string.preencode(s, m.type); c.string.preencode(s, m.text); c.uint.preencode(s, m.at); c.fixed(16).preencode(s, m.nonce) },
  encode (s, m) { c.uint.encode(s, m.v); c.string.encode(s, m.from); c.string.encode(s, m.type); c.string.encode(s, m.text); c.uint.encode(s, m.at); c.fixed(16).encode(s, m.nonce) },
  decode (s) { return { v: c.uint.decode(s), from: c.string.decode(s), type: c.string.decode(s), text: c.string.decode(s), at: c.uint.decode(s), nonce: c.fixed(16).decode(s) } }
}

// base64url (dolgusuz); Bare ve Node'da aynı
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
function b64Yaz (b) {
  let s = ''
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] || 0) << 8) | (b[i + 2] || 0)
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < b.length ? B64[(n >> 6) & 63] : '') + (i + 2 < b.length ? B64[n & 63] : '')
  }
  return s
}
function b64Oku (s) {
  if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) fail('INVALID_BRIDGE')
  const out = b4a.alloc(Math.floor(s.length * 3 / 4))
  let j = 0
  for (let i = 0; i < s.length; i += 4) {
    const p = [0, 1, 2, 3].map((k) => (i + k < s.length ? B64.indexOf(s[i + k]) : 0))
    const n = (p[0] << 18) | (p[1] << 12) | (p[2] << 6) | p[3]
    out[j++] = (n >> 16) & 255
    if (i + 2 < s.length) out[j++] = (n >> 8) & 255
    if (i + 3 < s.length) out[j++] = n & 255
  }
  // Kanonik: dolgu bitleri sıfır olmalı (aynı paketin iki yazımı olmasın)
  if (b64Yaz(out) !== s) fail('INVALID_BRIDGE')
  return out
}

function denetle (m) {
  if (m.v !== 1) fail('BRIDGE_VERSION')
  if (!yonVar(m.from)) fail('INVALID_BRIDGE')
  if (!TURLER[m.from].includes(m.type)) fail('BRIDGE_TYPE')
  if (typeof m.text !== 'string' || b4a.byteLength(m.text) > METIN_MAX || BIDI.test(m.text) || !m.text.replace(GORUNMEZ, '').trim()) fail('BRIDGE_TEXT')
  if (!Number.isSafeInteger(m.at) || m.at <= 0) fail('INVALID_BRIDGE')
  if (!b4a.isBuffer(m.nonce) || m.nonce.byteLength !== 16) fail('INVALID_BRIDGE')
}

// Paket → taşıma metni (gönderen uygulama). nonce çağırandan (rastgele 16 bayt)
function kopruYaz ({ from, type, text, at, nonce }) {
  const m = { v: 1, from, type, text, at, nonce }
  denetle(m)
  const s = ON_EK + b64Yaz(c.encode(kopru, m))
  if (b4a.byteLength(s) > TASIMA_MAX) fail('INVALID_BRIDGE')
  return s
}

// Taşıma metni → paket (alan uygulama). kendi: alan uygulamanın topluluk türü; paket öbür taraftan gelmeli.
// simdi verilirse tazelik: at geçmişe 7 gün (BRIDGE_STALE), ileriye 5 dakika (BRIDGE_AHEAD) içinde (inceleme 17 B1, B2).
// kaynak: platformun bildirdiği yazan uygulamanın türü (yön klasörü, RFC-0027 §7 a); verilirse from ile aynı olmalı
function kopruCoz (metin, { kendi = null, simdi = null, kaynak = null } = {}) {
  if (typeof metin !== 'string' || !metin.startsWith(ON_EK) || b4a.byteLength(metin) > TASIMA_MAX) fail('INVALID_BRIDGE')
  const bytes = b64Oku(metin.slice(ON_EK.length))
  // Sürüm önce (B6): başka sürümün düzeni farklı olabilir; "uygulamayı güncelle" denebilsin
  let v
  try { v = c.uint.decode({ start: 0, end: bytes.byteLength, buffer: bytes }) } catch { fail('INVALID_BRIDGE') }
  if (v !== 1) fail('BRIDGE_VERSION')
  let m
  try { m = canonical(kopru, bytes, 'INVALID_BRIDGE') } catch { fail('INVALID_BRIDGE') }
  denetle(m)
  if (kendi && m.from === kendi) fail('BRIDGE_DIRECTION')
  if (kaynak !== null && kaynak !== m.from) fail('BRIDGE_SOURCE')
  if (simdi !== null) {
    if (m.at < simdi - NONCE_MS) fail('BRIDGE_STALE')
    if (m.at > simdi + ILERI_MS) fail('BRIDGE_AHEAD')
  }
  return m
}

// Alan uygulamanın tekrar engeli (§15.4, RFC-0027 §7 c): gördüğü nonce'lar. saklama: { get(k), set(k, v), delete?(k) }
// (kalıcı). Her nonce kendi anahtarında (kopru/nonce/<hex> = at) bir kez yazılır: iki süreç (uygulama ve uzantısı)
// aynı saklamayı eski önbellekle yazsa da kayıt kaybolmaz (inceleme 17 Ş2). En çok 1000 kayıt: halka (kopru/nonce-yuva/i)
// en eskisini siler; tazelik penceresi (7 gün) daha eski paketi zaten reddeder (B3).
class NonceDefteri {
  constructor ({ saklama = null, now = Date.now, sinir = NONCE_MAX } = {}) {
    const m = new Map()
    this.saklama = saklama || { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v), delete: (k) => m.delete(k) }
    this.now = now
    this.sinir = sinir
  }

  _sil (k) { if (typeof this.saklama.delete === 'function') this.saklama.delete(k); else this.saklama.set(k, null) }

  // İlk görüşte true; aynı nonce yeniden gelirse BRIDGE_REPLAY
  gor (nonce, at = this.now()) {
    const k = 'kopru/nonce/' + hex(nonce)
    const v = this.saklama.get(k)
    if (v !== null && v !== undefined) fail('BRIDGE_REPLAY')
    const sira = this.saklama.get('kopru/nonce-sayac') || 0
    const yuva = 'kopru/nonce-yuva/' + (sira % this.sinir)
    const eski = this.saklama.get(yuva)
    if (eski) this._sil('kopru/nonce/' + eski)
    this.saklama.set(k, at)
    this.saklama.set(yuva, hex(nonce))
    this.saklama.set('kopru/nonce-sayac', sira + 1)
    return true
  }

  // Saklanan nonce sayısı (sınama ve tanı)
  boyut () {
    const n = this.saklama.get('kopru/nonce-sayac') || 0
    return Math.min(n, this.sinir)
  }
}

module.exports = { ON_EK, METIN_MAX, TASIMA_MAX, NONCE_MS, ILERI_MS, NONCE_MAX, TURLER, yonVar, kopru, kopruYaz, kopruCoz, NonceDefteri, b64Yaz, b64Oku }
