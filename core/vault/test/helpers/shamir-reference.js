// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Yalnız testte: Shamir paylaşımının bağımsız, kısa başvuru gerçeklemesi (D60). Üretimde kullanılmaz; kasa paylarını
// yalnız denetlenmiş shamir-secret-sharing üretir (H7, core/vault/share.js). Amaç paketin çıktısını başka bir yoldan
// sınamak: aynı alan (GF(2^8), indirgeme polinomu x^8 + x^4 + x^3 + x + 1 = 0x11b), aynı pay düzeni (sırrın her baytı
// için f(x), son bayt x koordinatı). Çarpım tablosuz (taşımasız çarpma), ters a^254 ile; okunurluk için, hız için değil.
'use strict'

function carp (a, b) {
  let r = 0
  for (let i = 0; i < 8; i++) {
    if (b & 1) r ^= a
    const ust = a & 0x80
    a = (a << 1) & 0xff
    if (ust) a ^= 0x1b
    b >>= 1
  }
  return r
}

function us (a, n) { let r = 1; while (n) { if (n & 1) r = carp(r, a); a = carp(a, a); n >>= 1 } return r }
const ters = (a) => { if (a === 0) throw new Error('ZERO_HAS_NO_INVERSE'); return us(a, 254) }

// katsayilar[i]: sırrın i. baytı için [a1 … a(t-1)] (a0 sır baytı); xler: farklı, sıfırdan farklı x koordinatları
function bol (sir, xler, katsayilar) {
  return xler.map((x) => {
    const pay = new Uint8Array(sir.length + 1)
    for (let i = 0; i < sir.length; i++) {
      let y = 0
      const k = [sir[i], ...katsayilar[i]]
      for (let j = k.length - 1; j >= 0; j--) y = carp(y, x) ^ k[j] // Horner
      pay[i] = y
    }
    pay[sir.length] = x
    return pay
  })
}

// Lagrange ile f(0): payların x'leri farklı olmalı
function birlestir (paylar) {
  const xler = paylar.map((p) => p[p.length - 1])
  if (new Set(xler).size !== xler.length || xler.includes(0)) throw new Error('INVALID_SHARE')
  const n = paylar[0].length - 1
  const sir = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    let t = 0
    for (let j = 0; j < paylar.length; j++) {
      let l = 1
      for (let m = 0; m < paylar.length; m++) if (m !== j) l = carp(l, carp(xler[m], ters(xler[m] ^ xler[j]))) // x_m / (x_m - x_j)
      t ^= carp(paylar[j][i], l)
    }
    sir[i] = t
  }
  return sir
}

module.exports = { carp, ters, bol, birlestir }
