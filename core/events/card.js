// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// card.js — kart ve elle not (RFC-0006 §13)
//
// Kart öznenin olaylarının bulunduğu koleksiyondadır. Bir koleksiyonda aynı _subj için birden çok hf.kart varsa asıl
// olan, türü belirleyen işlemi en küçük olandır; diğerleri "kopya kart, birleştir" olarak görünür.
const b4a = require('b4a')
const { ilkOnce } = require('./event')

const MAX_NOT = 1024

function kartOf (k) {
  const f = k.fields
  return {
    recordId: k.recordId,
    subj: k.tf._subj,
    ad: typeof f.ad === 'string' ? f.ad : null,
    foto: f.foto && b4a.isBuffer(f.foto.blobId) ? f.foto : null,
    modul: typeof f.modul === 'string' ? f.modul : null,
    sorumlu: Array.isArray(f.sorumlu) ? f.sorumlu.filter((x) => typeof x === 'string') : [],
    sessiz: Array.isArray(f.sessiz) && f.sessiz.length === 2 && f.sessiz.every(Number.isSafeInteger) ? f.sessiz : null,
    utc_dk: Number.isSafeInteger(f.utc_dk) ? f.utc_dk : 180,
    olaylar: Array.isArray(f.olaylar) ? f.olaylar.filter((x) => typeof x === 'string') : null,
    sabit: f.sabit === true
  }
}

// Kartı ve notu yalnız üye yazar (RFC-0019 §11.5 a); yazar alanı olmayan kayıt (vektör) üye sayılır.
const uyeMi = (k) => k.yazar === undefined || k.yazar === 'uye'

// Dönüş: Map subj → { kart, kopyalar: [recordId] }. normal(subj): özneyi kişiye çözer (motor.ozneNormal)
function kartlar (kayitlar, normal = (x) => x) {
  const out = new Map()
  for (const k of kayitlar.filter((x) => x.type === 'hf.kart' && uyeMi(x) && typeof x.tf._subj === 'string').sort(ilkOnce)) {
    const s = normal(k.tf._subj)
    if (!out.has(s)) out.set(s, { kart: kartOf(k), kopyalar: [] })
    else out.get(s).kopyalar.push(k.recordId)
  }
  return out
}

// Elle notlar: { _subj, _t, metin (≤ 1 KB), _keep }; merdiven başlatmaz
function notlar (kayitlar, subj) {
  return kayitlar
    .filter((k) => k.type === 'hf.kart.not' && uyeMi(k) && k.tf._subj === subj && typeof k.fields.metin === 'string' && b4a.byteLength(k.fields.metin) <= MAX_NOT && Number.isSafeInteger(k.tf._t))
    .sort((a, b) => a.tf._t - b.tf._t || ilkOnce(a, b))
    .map((k) => ({ recordId: k.recordId, t: k.tf._t, metin: k.fields.metin, yazar: k.authorHex }))
}

module.exports = { MAX_NOT, kartOf, kartlar, notlar }
