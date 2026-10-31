// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// release-common.js — sürüm derleme ve imzalama araçlarının ortak parçaları (release-build.js, release-sign.js)
//
// Kripto yok: özetler node/release.js'ten (BLAKE2b, hf/release-pkg/) ve Node'un sha256'sından (SHA256SUMS; protokol
// dışı, kullanıcı herhangi bir araçla denetlesin diye; RFC-0007 §3 özet tablosu).
const fs = require('fs')
const crypto = require('crypto')
const b4a = require('b4a')
const c = require('compact-encoding')
const S = require('../release')

function fail (code, ayrinti = '') { throw new Error(code + (ayrinti ? ': ' + ayrinti : '')) }
const hex = (b) => b4a.toString(b, 'hex')

// --ad değer çiftleri; tekrarlanabilir seçenekler dizi olur; bayraklar (değersiz) true
function argumanlar (dizi, { tekrar = [], bayrak = [] } = {}) {
  const a = {}
  for (const t of tekrar) a[t] = []
  for (let i = 0; i < dizi.length; i++) {
    const s = dizi[i]
    if (!s.startsWith('--')) fail('INVALID_ARGUMENT', s)
    const ad = s.slice(2)
    if (bayrak.includes(ad)) { a[ad] = true; continue }
    if (i + 1 >= dizi.length || dizi[i + 1].startsWith('--')) fail('MISSING_ARGUMENT', s)
    const v = dizi[++i]
    if (tekrar.includes(ad)) a[ad].push(v)
    else if (ad in a) fail('DUPLICATE_ARGUMENT', s)
    else a[ad] = v
  }
  return a
}

function gerekli (a, adlar) { for (const x of adlar) if (a[x] === undefined || a[x] === '') fail('MISSING_ARGUMENT', '--' + x) }

// Dosyanın akışla özetleri ve boyutu: { size, digest (hf/release-pkg/), sha256 (hex) }
function dosyaOzetleri (yol) {
  const oz = S.dosyaOzeti()
  const sha = crypto.createHash('sha256')
  const fd = fs.openSync(yol, fs.constants.O_RDONLY)
  let size = 0
  try {
    if (!fs.fstatSync(fd).isFile()) fail('INVALID_FILE', yol)
    const t = b4a.alloc(1 << 20)
    for (;;) {
      const n = fs.readSync(fd, t, 0, t.byteLength, null)
      if (n === 0) break
      const p = t.subarray(0, n)
      oz.guncelle(p)
      sha.update(p)
      size += n
    }
  } finally { fs.closeSync(fd) }
  return { size, digest: oz.bitir(), sha256: sha.digest('hex') }
}

// SHA256SUMS: "<64 onaltılık>  <ad>\n" satırları, ada göre sıralı; ad dizin ayırıcısı ve boşluk içermez
const SUMS_SATIR = /^([0-9a-f]{64}) {2}([^\s/]+)$/
function sumsCoz (metin) {
  const m = new Map()
  const satirlar = metin.split('\n')
  if (satirlar.pop() !== '') fail('INVALID_SHA256SUMS', 'son satır yeni satırla bitmeli')
  for (const s of satirlar) {
    const r = SUMS_SATIR.exec(s)
    if (!r) fail('INVALID_SHA256SUMS', s)
    if (m.has(r[2]) && m.get(r[2]) !== r[1]) fail('SHA256SUMS_CONFLICT', r[2])
    m.set(r[2], r[1])
  }
  if (!m.size) fail('INVALID_SHA256SUMS', 'boş')
  return m
}
function sumsYaz (m) {
  return [...m.keys()].sort().map((ad) => {
    if (!SUMS_SATIR.test(m.get(ad) + '  ' + ad)) fail('INVALID_SHA256SUMS', ad)
    return m.get(ad) + '  ' + ad + '\n'
  }).join('')
}

// Kök durumu dosyası (kokDurumuEnc: { keyEpoch, rootPub, nextRootHash }); kanonik olmalı
function kokDurumuOku (yol) {
  const b = fs.readFileSync(yol)
  let k
  try { k = c.decode(S.kokDurumuEnc, b) } catch { fail('INVALID_ROOT_STATE', yol) }
  if (!b4a.equals(c.encode(S.kokDurumuEnc, k), b)) fail('INVALID_ROOT_STATE', yol)
  return k
}

// İmzasız bildirim gövdesi: kanonik RELEASE_MANIFEST gövdesi (imza alanı yok)
function govdeCoz (body) {
  let m
  try { m = c.decode(S.manifestGovde, body) } catch { fail('FORMAT_ERROR', 'bildirim gövdesi çözülemedi') }
  if (!b4a.equals(c.encode(S.manifestGovde, m), body)) fail('FORMAT_ERROR', 'bildirim gövdesi kanonik değil')
  if (m.format !== 1 || !S.KANALLAR.includes(m.channel) || b4a.byteLength(m.notes) > 4096) fail('FORMAT_ERROR')
  if (S.versionCode(m.version) !== m.versionCode) fail('FORMAT_ERROR', 'versionCode')
  return m
}

// İnsan için okunur biçim: Buffer → onaltılık
function jsonla (x) {
  return JSON.stringify(x, (k, v) => (v && v.type === 'Buffer' && Array.isArray(v.data) ? hex(b4a.from(v.data)) : v), 1) + '\n'
}

module.exports = { fail, hex, argumanlar, gerekli, dosyaOzetleri, sumsCoz, sumsYaz, kokDurumuOku, govdeCoz, jsonla }
