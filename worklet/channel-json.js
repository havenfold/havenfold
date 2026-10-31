// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// channel-json.js — RFC-0024 §2 çerçevesinde değerlerin JSON biçimi: baytlar (Uint8Array) { "$b": "<base64>" } olur
//
// kodla: giden değer (cevap, olay, geri çağrı); işlev ve undefined alanlar düşer. coz: gelen gövde; geçersiz base64
// INVALID_BODY (Bare'de b4a fırlatır; D50).
'use strict'
const b4a = require('b4a')

const baytMi = (x) => x !== null && typeof x === 'object' && ArrayBuffer.isView(x)

function kodla (x) {
  if (baytMi(x)) return { $b: b4a.toString(x, 'base64') }
  if (Array.isArray(x)) return x.map(kodla)
  if (x !== null && typeof x === 'object') {
    // Object.fromEntries: __proto__ anahtarı kendi alanı kalır, prototip değişmez
    return Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined && typeof v !== 'function').map(([k, v]) => [k, kodla(v)]))
  }
  return x === undefined ? null : x
}

function coz (x) {
  if (Array.isArray(x)) return x.map(coz)
  if (x !== null && typeof x === 'object') {
    if (Object.keys(x).length === 1 && typeof x.$b === 'string') {
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(x.$b) || x.$b.length % 4 !== 0) throw new Error('INVALID_BODY')
      return b4a.from(x.$b, 'base64')
    }
    return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, coz(v)]))
  }
  return x
}

module.exports = { kodla, coz, baytMi }
