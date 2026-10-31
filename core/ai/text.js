// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// text.js — Türkçe normalleştirme N(s), token tahmini ve kelime yardımcıları (RFC-0013 §3)
//
// Bu RFC'nin her metin karşılaştırması N üzerinden yapılır; böylece her cihaz aynı kararı verir.
const b4a = require('b4a')

const TIRNAK = /['’"“”]/g

// N(s): 1. NFKC · 2. Türkçe küçük harf (I → ı, İ → i, sonra diğerleri) · 3. U+0307 silinir · 4. tırnak ve kesme
// işaretleri silinir · 5. boşluk dizileri tek boşluk, baş ve son boşluk silinir
function N (s) {
  if (typeof s !== 'string') throw new Error('INVALID_TEXT')
  return s.normalize('NFKC')
    .replace(/I/g, 'ı').replace(/İ/g, 'i').toLowerCase()
    .replace(/̇/g, '')
    .replace(TIRNAK, '')
    .replace(/\s+/g, ' ').trim()
}

// tahmini_token = ceil(UTF-8 bayt / 3); bütün sınırlar bununla hesaplanır
const tokenTahmini = (s) => Math.ceil(b4a.byteLength(s) / 3)

const kacis = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// n: N'den geçmiş metin, k: N'den geçmiş kelime ya da kelime dizisi. Tam kelime: önünde ve ardında harf ya da rakam yok.
function tamKelime (n, k) {
  if (!k) return false
  return new RegExp('(?<![\\p{L}\\p{N}])' + kacis(k) + '(?![\\p{L}\\p{N}])', 'u').test(n)
}

// Kelimeler: harf ve rakam dizileri (N'den geçmiş metinde)
const kelimeler = (n) => n.match(/[\p{L}\p{N}]+/gu) || []

const harfSayisi = (s) => (s.match(/\p{L}/gu) || []).length

// Katlama (RFC-0023 §2 c): biçim karakterleri (\p{Cf}, ör. sıfır genişlikli boşluk) silinir, N uygulanır, Türkçe
// harfler Latin'e iner (ö→o, ı→i …), üç ve daha çok yinelenen harf bire iner. Kriz listesi, ad eşleşmesi ve talimat
// kalıpları bunu kullanır.
const KATLA = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' }
const katla = (metin) => N(String(metin).replace(/\p{Cf}/gu, '')).replace(/[çğıöşüâîû]/g, (h) => KATLA[h]).replace(/(\p{L})\1{2,}/gu, '$1')

module.exports = { N, tokenTahmini, tamKelime, kelimeler, harfSayisi, kacis, katla }
