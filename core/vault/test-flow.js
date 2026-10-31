// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// test-flow.js — yalnız test vektörleri: Shamir kaynağını belirlenimci akışa çevirir (RFC-0019 §11.4 e)
//
//   akış = hash('hf/kasa-test-akis/', tohum, u64be(sayaç)) blokları art arda
// Kütüphanenin bayt tüketim sırası: önce x koordinatları için 255 bayt, sonra sırrın her baytı için t − 1 bayt.
// Bu dosya paketin dışa aktarımında yoktur (package.json "exports"); üretim kodu yükleyemez.
const b4a = require('b4a')
const { kdf: { hash } } = require('@havenfold/core')
const { _durum: durum, sodiumKaynak } = require('./random')

function sabitAkis (tohum) {
  let sayac = 0
  let tampon = new Uint8Array(0)
  return (n) => {
    while (tampon.length < n) tampon = b4a.concat([tampon, hash('hf/kasa-test-akis/', tohum, sayac++)])
    const out = new Uint8Array(tampon.subarray(0, n))
    tampon = tampon.subarray(n)
    return out
  }
}

// fn: (n) → Uint8Array. Dönüş: geri alma işlevi.
function kaynakAyarla (fn) {
  const once = durum.etkin
  durum.etkin = fn
  return () => { durum.etkin = once }
}

const varsayilan = () => { durum.etkin = sodiumKaynak }

module.exports = { sabitAkis, kaynakAyarla, varsayilan }
