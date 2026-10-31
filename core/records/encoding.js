// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// encoding.js — kayıt katmanının tel biçimleri (RFC-0001 §3, §4)
//
// Bütün gövdeler kanonik çözülür: çözülen değer yeniden kodlanınca aynı baytları vermelidir. Böylece en kısa
// olmayan c.uint ve sondaki fazla baytlar reddedilir (§3 kodlama kuralları).
const c = require('compact-encoding')
const b4a = require('b4a')

const MAX_TEXT = 16 * 1024
const MAX_LIST = 64
const MAX_DEPTH = 2
const MAX_FIELDS = 256
const MAX_NAME = 64
const MAX_OP_BYTES = 48 * 1024
// c.int yalnız ±(2^52 − 1) aralığını kodlar (RFC −2^53+1 .. 2^53−1 diyor; İstekler)
const INT_MAX = 2 ** 52 - 1

function fail (code) { throw new Error(code) }

function struct (fields) {
  return {
    preencode (state, m) { for (const [k, enc] of fields) enc.preencode(state, m[k]) },
    encode (state, m) { for (const [k, enc] of fields) enc.encode(state, m[k]) },
    decode (state) {
      const m = {}
      for (const [k, enc] of fields) m[k] = enc.decode(state)
      return m
    }
  }
}

// Değer kodlamasındaki hata (bilinmeyen etiket, sınır) INVALID_VALUE olarak korunur (RFC-0001 §4.2)
function decodeCanonical (enc, buf, code) {
  let m
  try { m = c.decode(enc, buf) } catch (err) { fail(err.message === 'INVALID_VALUE' ? err.message : code) }
  let again
  try { again = c.encode(enc, m) } catch { fail(code) }
  const ayni = b4a.equals(again, buf)
  again.fill(0) // gövde anahtar taşıyabilir (fileKey); karşılaştırma kopyası bırakılmaz (inceleme görev 11)
  if (!ayni) fail(code)
  return m
}

// --- Değer (§4.2) ---------------------------------------------------------------------------------------------
// JS biçimi: null, false, true, tamsayı, string, Uint8Array (bytes), { blobId, fileKey, size, mime, name }, dizi.

const TAG = { NULL: 0, FALSE: 1, TRUE: 2, INT: 3, STRING: 4, BYTES: 5, BLOB: 6, LIST: 7 }

const blobRef = struct([['blobId', c.fixed32], ['fileKey', c.fixed32], ['size', c.uint], ['mime', c.string], ['name', c.string]])

function tagOf (v) {
  if (v === null) return TAG.NULL
  if (v === false) return TAG.FALSE
  if (v === true) return TAG.TRUE
  if (typeof v === 'number') {
    if (!Number.isInteger(v) || Math.abs(v) > INT_MAX) fail('INVALID_VALUE')
    return TAG.INT
  }
  if (typeof v === 'string') {
    if (b4a.byteLength(v) > MAX_TEXT) fail('INVALID_VALUE')
    return TAG.STRING
  }
  if (b4a.isBuffer(v)) {
    if (v.byteLength > MAX_TEXT) fail('INVALID_VALUE')
    return TAG.BYTES
  }
  if (Array.isArray(v)) {
    if (v.length > MAX_LIST) fail('INVALID_VALUE')
    return TAG.LIST
  }
  if (v && typeof v === 'object' && b4a.isBuffer(v.blobId)) return TAG.BLOB
  fail('INVALID_VALUE')
}

// depth: kaç liste içindeyiz. Liste en çok 2 düzey iç içe olur: [[x]] olur, [[[x]]] olmaz.
function valueAt (depth) {
  const enc = {
    preencode (state, v) {
      const t = tagOf(v)
      c.uint.preencode(state, t)
      body(t, depth).preencode(state, v)
    },
    encode (state, v) {
      const t = tagOf(v)
      c.uint.encode(state, t)
      body(t, depth).encode(state, v)
    },
    decode (state) {
      const t = c.uint.decode(state)
      const v = body(t, depth).decode(state)
      tagOf(v) // sınırlar çözerken de denetlenir
      return v
    }
  }
  return enc
}

const constant = (x) => ({ preencode () {}, encode () {}, decode () { return x } })
const bytesEnc = {
  preencode (state, v) { c.buffer.preencode(state, v) },
  encode (state, v) { c.buffer.encode(state, v) },
  decode (state) { return c.buffer.decode(state) || b4a.alloc(0) }
}

function body (t, depth) {
  switch (t) {
    case TAG.NULL: return constant(null)
    case TAG.FALSE: return constant(false)
    case TAG.TRUE: return constant(true)
    case TAG.INT: return c.int
    case TAG.STRING: return c.string
    case TAG.BYTES: return bytesEnc
    case TAG.BLOB: return blobRef
    case TAG.LIST:
      if (depth >= MAX_DEPTH) fail('INVALID_VALUE')
      return c.array(valueAt(depth + 1))
    default: fail('INVALID_VALUE')
  }
}

const value = valueAt(0)

// --- İşlem (§4.3) ---------------------------------------------------------------------------------------------

const OP = { PUT: 0, DEL: 1, APPEND: 2 }

// Seçimli alan: önce c.bool varlık bayrağı, sonra değer; null "bayrak false" demektir (§3)
function optional (enc) {
  const has = (v) => v !== null && v !== undefined
  return {
    preencode (state, v) { c.bool.preencode(state, has(v)); if (has(v)) enc.preencode(state, v) },
    encode (state, v) { c.bool.encode(state, has(v)); if (has(v)) enc.encode(state, v) },
    decode (state) { return c.bool.decode(state) ? enc.decode(state) : null }
  }
}

const U64_MAX = (1n << 64n) - 1n
// hlc: 64 bit; c.biguint64 2^64 ve üstünü sararak yazardı (RFC-0019 §11.1 a)
const hlcEnc = {
  preencode (state, v) { c.biguint64.preencode(state, v) },
  encode (state, v) {
    if (typeof v !== 'bigint' || v < 0n || v > U64_MAX) fail('INVALID_VALUE')
    c.biguint64.encode(state, v)
  },
  decode (state) { return c.biguint64.decode(state) }
}

// recNonce: yeni kaydın türünü belirleyen put işleminde 16 rastgele bayt; recordId = hash('hf/rec-new/', authorId,
// recNonce)[0..16] (RFC-0019 §11.1 c). Diğer işlemlerde yoktur.
// v: iç gövdenin sürümü (RFC-0019 §11.1 p); bu sürüm 1. Bilinmeyen sürüm VERSION_UNSUPPORTED ile bekler.
const INNER_V = 1
const field = struct([['name', c.string], ['value', value]])
const opInner = struct([
  ['v', c.uint], ['recordId', c.fixed16], ['op', c.uint], ['type', c.string], ['fields', c.array(field)],
  ['hlc', hlcEnc], ['authorId', c.fixed16], ['ledgerSeq', c.uint], ['ledgerHash', c.fixed32],
  ['recNonce', optional(c.fixed16)]
])
const recOp = struct([['collectionId', c.fixed16], ['epochSeq', c.uint], ['keyId', c.fixed32], ['nonce', c.fixed24], ['ct', c.buffer], ['sig', c.fixed64]])
const recDrop = struct([['collectionId', c.fixed16], ['dropKeyHash', c.fixed32], ['sealed', c.buffer], ['sig', c.fixed64]])

const NAME_RE = /^[a-z0-9_.]+$/
// JS nesnelerinin prototip adları alan adı olamaz (açılış güvenlik incelemesi): okuma görünümü ve SDK alanları nesneye
// çevirir. _ ile başlayan sistem alanları (RFC-0015 §2) etkilenmez.
const YASAK_ADLAR = new Set(['__proto__', 'constructor', 'prototype'])
const TYPE_RE = /^(hf|yuva|mekan)\.[a-z0-9_.-]+$/

function validateName (name) {
  if (!NAME_RE.test(name) || b4a.byteLength(name) > MAX_NAME || YASAK_ADLAR.has(name)) fail('INVALID_FIELD_NAME')
}

// Yapı denetimi; anlam denetimi (ayrılmış alanların değerleri) yazarken yapılır (fields.js)
function validateInner (m) {
  if (m.op !== OP.PUT && m.op !== OP.DEL && m.op !== OP.APPEND) fail('INVALID_OPERATION')
  if (m.type !== '' && !TYPE_RE.test(m.type)) fail('INVALID_OPERATION')
  if (m.op === OP.APPEND && m.type === '') fail('INVALID_OPERATION')
  if (m.op === OP.DEL && (m.fields.length !== 0 || m.type !== '')) fail('INVALID_OPERATION')
  if (m.fields.length > MAX_FIELDS) fail('INVALID_OPERATION')
  const nonce = m.recNonce !== null && m.recNonce !== undefined
  if (nonce && !(m.op === OP.PUT && m.type !== '')) fail('INVALID_OPERATION') // nonce yalnız türü belirleyen put'ta
  const names = new Set()
  for (const f of m.fields) {
    validateName(f.name)
    if (names.has(f.name)) fail('INVALID_OPERATION')
    names.add(f.name)
  }
  return m
}

const encodeInner = (m) => c.encode(opInner, validateInner({ recNonce: null, ...m, v: m.v ?? INNER_V }))
function decodeInner (buf) {
  let v
  try { v = c.uint.decode(c.state(0, buf.byteLength, buf)) } catch { fail('INVALID_OPERATION') }
  if (v !== INNER_V) fail('VERSION_UNSUPPORTED')
  return validateInner(decodeCanonical(opInner, buf, 'INVALID_OPERATION'))
}

function decodeRecOp (buf) {
  if (buf.byteLength > MAX_OP_BYTES) fail('OPERATION_TOO_LARGE')
  return decodeCanonical(recOp, buf, 'INVALID_OPERATION')
}
function decodeRecDrop (buf) {
  if (buf.byteLength > MAX_OP_BYTES) fail('OPERATION_TOO_LARGE')
  return decodeCanonical(recDrop, buf, 'INVALID_OPERATION')
}

// Özetlere giren tamsayılar u64be (§3); kdf.toBuf sayıyı ve BigInt'i böyle yazar
module.exports = {
  MAX_TEXT, MAX_LIST, MAX_FIELDS, MAX_NAME, MAX_OP_BYTES, INT_MAX, INNER_V,
  TAG, OP, U64_MAX, struct, optional, decodeCanonical, value, blobRef, field, opInner, recOp, recDrop,
  validateName, validateInner, encodeInner, decodeInner, decodeRecOp, decodeRecDrop
}
