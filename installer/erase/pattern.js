// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// erase/pattern.js — dönen disk üzerine yazma deseni (RFC-0007 §13.4)
//
// Rastgele bir anahtarla crypto_stream_xchacha20 akışı (libsodium). Doğrulama aynı akışı aynı konumdan yeniden üretip
// okunanla karşılaştırır. Sıfır deseni kullanılmaz: yazmayı yok sayıp sıfır döndüren disk sıfır doğrulamasını geçer.
// Anahtar sodium_malloc alanındadır; iş bitince sodium_memzero ile silinir.
const b4a = require('b4a')
const sodium = require('sodium-native')

const BLOK = 64 // xchacha20 blok boyu: akış sayacı 64 baytlık bloklarla ilerler

function fail (code) { throw new Error(code) }

class Desen {
  // anahtar ve nonce verilmezse rastgele üretilir (testte belirlenimci verilir)
  constructor ({ anahtar = null, nonce = null } = {}) {
    this.anahtar = sodium.sodium_malloc(sodium.crypto_stream_xchacha20_KEYBYTES)
    if (anahtar) this.anahtar.set(anahtar)
    else sodium.randombytes_buf(this.anahtar)
    this.nonce = b4a.alloc(sodium.crypto_stream_xchacha20_NONCEBYTES)
    if (nonce) this.nonce.set(nonce)
    else sodium.randombytes_buf(this.nonce)
    this.silindi = false
  }

  // Diskteki [ofset, ofset + uzunluk) aralığının deseni. ofset 64'ün katı olmalı.
  parca (ofset, uzunluk) {
    if (this.silindi) fail('PATTERN_ERASED')
    if (!Number.isSafeInteger(ofset) || ofset < 0 || ofset % BLOK !== 0 || !Number.isSafeInteger(uzunluk) || uzunluk < 0) fail('INVALID_PATTERN_OFFSET')
    const sifir = b4a.alloc(uzunluk)
    const out = b4a.alloc(uzunluk)
    sodium.crypto_stream_xchacha20_xor_ic(out, sifir, this.nonce, ofset / BLOK, this.anahtar)
    return out
  }

  // Okunan baytlar aynı konumun desenine eşit mi
  dogrula (ofset, okunan) {
    return b4a.equals(this.parca(ofset, okunan.byteLength), okunan)
  }

  sil () {
    sodium.sodium_memzero(this.anahtar)
    this.silindi = true
  }
}

module.exports = { Desen, BLOK }
