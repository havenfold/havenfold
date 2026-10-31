// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Yalnız Bare: Bare 'node:crypto'yu node_modules/crypto'dan çözer. shamir-secret-sharing'in csprng.node.js modülü
// yalnız randomBytes ister; kaynak sodium.randombytes_buf'tur (RFC-0004 §4.1). Kütüphanenin rastgelelik yaması
// (random.js) bunun üstüne yine uygulanır.
const sodium = require('sodium-native')

function randomBytes (n) {
  const b = new Uint8Array(n)
  sodium.randombytes_buf(b)
  return b
}

module.exports = { randomBytes }
