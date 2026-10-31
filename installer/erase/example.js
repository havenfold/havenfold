// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// erase/example.js — sanitize öncesi ve sonrası örnek blok denetimi (RFC-0007 §13.4 "Önce örnek")
//
// SSD ve NVMe'de sanitize öncesi 256 rastgele 4 KiB blok okunur, özetleri bellekte tutulur. Sonra aynı bloklar
// yeniden okunur. Herhangi biri sıfırdan farklı ve öncekiyle aynıysa sonuç 'hata'dır. Bu bir doğrulama değildir;
// bariz başarısızlığı yakalar. Özet libsodium'un BLAKE2b'sidir (kendi kriptomuz yok).
const b4a = require('b4a')
const sodium = require('sodium-native')

const BLOK = 4096
const ADET = 256

function fail (code) { throw new Error(code) }

// rastgeleBayt(n) → n rastgele bayt (üretimde sodium.randombytes_buf; testte belirlenimci). Diskin blok sayısı 2^53
// altındadır; 8 baytlık sayının kalanı alınır (örnekleme için sapma önemsiz).
function konumlar (boyut, rastgeleBayt, adet = ADET) {
  const n = Math.floor(boyut / BLOK)
  if (n < 1) fail('DISK_TOO_SMALL')
  const hedef = Math.min(adet, n)
  const secilen = new Set()
  let deneme = 0
  while (secilen.size < hedef) {
    if (++deneme > hedef * 64) fail('INSUFFICIENT_RANDOMNESS')
    const b = rastgeleBayt(8)
    let x = 0n
    for (const v of b) x = (x << 8n) | BigInt(v)
    secilen.add(Number(x % BigInt(n)))
  }
  return [...secilen].sort((a, b) => a - b).map((i) => i * BLOK)
}

function ozet (blok) {
  const out = b4a.alloc(32)
  sodium.crypto_generichash(out, blok)
  return out
}

const sifirMi = (b) => { for (let i = 0; i < b.byteLength; i++) if (b[i] !== 0) return false; return true }

// once: konum → özet (Map); sonra: konum → blok (Map). Dönüş: { hata, ayni, sifir, okunan }
function karsilastir (once, sonra) {
  let ayni = 0
  let sifir = 0
  for (const [konum, oz] of once) {
    const blok = sonra.get(konum)
    if (!blok) fail('SAMPLE_MISSING')
    if (sifirMi(blok)) { sifir++; continue }
    if (b4a.equals(ozet(blok), oz)) ayni++
  }
  return { hata: ayni > 0, ayni, sifir, okunan: once.size }
}

module.exports = { BLOK, ADET, konumlar, ozet, karsilastir, sifirMi }
