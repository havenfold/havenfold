// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// random.js — Shamir kütüphanesinin rastgelelik kaynağı (RFC-0004 §4.1, RFC-0019 §11.4 e)
//
// shamir-secret-sharing rastgele baytı "shamir-secret-sharing/csprng" modülünün getRandomBytes işlevinden, çağrı anında
// alır. Tek yama burada: kaynak her ortamda sodium.randombytes_buf olur (Bare'de globalThis.crypto yoktur).
// Belirlenimci test akışı ana dışa aktarımda yoktur; yalnız test-flow.js'tedir (paket dışından yüklenemez).
const sodium = require('sodium-native')
const csprng = require('shamir-secret-sharing/csprng')

function sodiumKaynak (n) {
  const b = new Uint8Array(n)
  sodium.randombytes_buf(b)
  return b
}

const durum = { etkin: sodiumKaynak }
// Kütüphanenin istediği her blok sınanır: 16 bayt ve üstü blok hep aynı bayt olamaz (sıfır dizisi gibi bir kaynak
// payların sırrı açık taşımasına yol açardı; inceleme 5 S6). Test akışından fazladan bayt tüketilmez.
csprng.getRandomBytes = (n) => {
  const b = durum.etkin(n)
  if (!b || b.length !== n || (n >= 16 && b.every((x) => x === b[0]))) throw new Error('RANDOM_SOURCE_CORRUPT')
  return b
}

// Öz denetim (inceleme kasa 19): kütüphane yamalı kaynağı gerçekten kullanıyor mu. split bir kez sayan kaynakla
// çalıştırılır; hiç bayt istenmediyse yama işlememiştir (ör. ESM yolu başka modül kopyası yüklemiş).
let denetlendi = false
async function ozDenetim () {
  if (denetlendi) return
  const { split } = require('shamir-secret-sharing')
  let sayac = 0
  const once = durum.etkin
  durum.etkin = (n) => { sayac += n; return sodiumKaynak(n) }
  try { await split(new Uint8Array(1), 2, 2) } finally { durum.etkin = once }
  if (sayac === 0 || csprng.getRandomBytes === undefined) throw new Error('RANDOM_PATCH_NOT_APPLIED')
  denetlendi = true
}

module.exports = { sodiumKaynak, ozDenetim, _durum: durum }
