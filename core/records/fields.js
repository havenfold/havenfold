// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// fields.js — çekirdeğe ayrılmış kayıt alanları (RFC-0015 §2)
//
// Kayıt katmanı alanların anlamını alırken denetlemez (RFC-0001 §4.2); aralık ve biçim denetimi yazarken yapılır.
const b4a = require('b4a')

// §2.1 genel alanlar ve §2.2 olay alanları (RFC-0006 §4.2). Ürün yeni `_` alanı tanımlayamaz.
const RESERVED = new Set(['_src', '_conf', '_ai', '_aiyol', '_v', '_t', '_subj', '_place', '_scope', '_key', '_obs', '_keep'])
const SRC_MAX = 16
const SRC_ITEM_MAX = 200

function fail (code) { throw new Error(code) }
const isStrList = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string')

// fields: { ad: değer } — yazmadan önce
function checkWrite (fields) {
  for (const [name, v] of Object.entries(fields)) {
    if (!name.startsWith('_')) continue
    if (!RESERVED.has(name)) fail('RESERVED_FIELD')
    if (v === null) continue // alanı boşaltmak serbest
    if (name === '_conf' && !(Number.isInteger(v) && v >= 0 && v <= 100)) fail('INVALID_FIELD_VALUE')
    if (name === '_src' && !(isStrList(v) && v.length <= SRC_MAX && v.every((x) => b4a.byteLength(x) <= SRC_ITEM_MAX))) fail('INVALID_FIELD_VALUE')
    if (name === '_ai' && !isStrList(v)) fail('INVALID_FIELD_VALUE')
    if (name === '_aiyol' && typeof v !== 'string') fail('INVALID_FIELD_VALUE')
  }
}

// --- Sıkı doğrulama (RFC-0015 §2.3: SDK yazarken aralık ve biçim denetler) --------------------------------------
//
// checkWrite kayıt katmanının alt sınırıdır; checkStrict ürünün yazdığı her kayıtta SDK'nın uyguladığı biçim
// denetimidir: _src biçimleri (RFC-0013 §8.5), _aiyol yolları, olay alanlarının türleri (RFC-0006 §4.2).
const H = (n) => '[0-9a-f]{' + n * 2 + '}'
const SRC_RE = [
  ['msg', new RegExp('^msg:(' + H(32) + ')/(' + H(16) + ')$')],
  ['kayit', new RegExp('^kayit:(' + H(16) + ')/(' + H(16) + ')$')],
  ['dosya', new RegExp('^dosya:(' + H(32) + ')(?:#(s|t)=(0|[1-9][0-9]*))?$')],
  ['aktarma', /^aktarma:([a-z0-9][a-z0-9-]*)$/]
]
const AIYOL_RE = /^(telefon\/(apple-fm|gemini-nano)@[0-9A-Za-z.+-]+|isci\/[0-9A-Za-z._@+-]+|kural\/[0-9A-Za-z._+-]+|disari\/[0-9A-Za-z._@+-]+)$/
const SUBJ_RE = /^(topluluk|(uye|varlik|yer|device|grant|kayit):[0-9a-f]{32})$/
const SCOPES = ['topluluk', 'kisisel', 'bag', 'hizmet']

// _src öğesi → { tur, ... } ya da null
function parseSrc (s) {
  if (typeof s !== 'string' || b4a.byteLength(s) > SRC_ITEM_MAX) return null
  for (const [tur, re] of SRC_RE) {
    const m = re.exec(s)
    if (!m) continue
    if (tur === 'msg') return { tur, convId: m[1], msgId: m[2] }
    if (tur === 'kayit') return { tur, collectionId: m[1], recordId: m[2] }
    if (tur === 'dosya') return { tur, blobId: m[1], ...(m[2] === 's' ? { sayfa: Number(m[3]) } : m[2] === 't' ? { ms: Number(m[3]) } : {}) }
    return { tur, bicim: m[1] }
  }
  return null
}

const isInt = (v) => Number.isSafeInteger(v)
const STRICT = {
  _src: (v) => isStrList(v) && v.length <= SRC_MAX && v.every((x) => parseSrc(x) !== null),
  _conf: (v) => isInt(v) && v >= 0 && v <= 100,
  _ai: (v) => isStrList(v) && v.every((x) => /^[a-z0-9][a-z0-9_.]*$/.test(x) && b4a.byteLength(x) <= 64),
  _aiyol: (v) => typeof v === 'string' && AIYOL_RE.test(v),
  _v: (v) => isInt(v) && v >= 1,
  _t: (v) => isInt(v) && v >= 0,
  _subj: (v) => typeof v === 'string' && SUBJ_RE.test(v),
  _place: (v) => typeof v === 'string' && /^yer:[0-9a-f]{32}$/.test(v),
  _scope: (v) => SCOPES.includes(v),
  _key: (v) => b4a.isBuffer(v) && v.byteLength === 16,
  _obs: (v) => typeof v === 'string' && /^(kaynak|device):[0-9a-f]{32}$/.test(v),
  _keep: (v) => isInt(v) && v >= 0
}

// col: yazılan koleksiyon (defterdeki); verilirse _scope: 'kisisel' yalnız kişisel koleksiyonda (inceleme SDK 21).
// _conf < 50 ise _keep en çok 7 gün (RFC-0006 §14.1); _obs device: izinlidir (RFC-0019 8.6).
function checkStrict (fields, { col = null } = {}) {
  checkWrite(fields)
  for (const [name, v] of Object.entries(fields)) {
    if (!name.startsWith('_') || v === null) continue
    if (!STRICT[name](v)) fail('INVALID_FIELD_VALUE')
  }
  if (col && fields._scope === 'kisisel' && col.kind !== 'kisisel') fail('INVALID_FIELD_VALUE')
  if (isInt(fields._conf) && fields._conf < 50 && fields._keep !== undefined && fields._keep !== null && !(fields._keep >= 1 && fields._keep <= 7)) fail('INVALID_FIELD_VALUE')
}

// Okurken: _conf yoksa 100 (insanın yazdığı kayıt), aralık dışıysa 0
function confOf (fields) {
  const v = fields._conf
  if (v === undefined || v === null) return 100
  return Number.isInteger(v) && v >= 0 && v <= 100 ? v : 0
}

module.exports = { RESERVED, SRC_MAX, SRC_ITEM_MAX, checkWrite, checkStrict, parseSrc, confOf }
