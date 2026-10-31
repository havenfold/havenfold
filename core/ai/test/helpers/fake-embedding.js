// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Belirlenimci sahte gömme: katlanmış metnin harf üçlüleri 256 boyuta karılır (FNV-1a). Anlam bilmez; yalnız anlam
// katmanının mantığını sınar. Bare ve Node'da aynı sonucu verir.
const { metin: { katla } } = require('../..')

function sahteGom (metin) {
  const v = new Float32Array(256)
  const f = ' ' + katla(metin) + ' '
  for (let i = 0; i + 3 <= f.length; i++) {
    let h = 0x811c9dc5
    for (const ch of f.slice(i, i + 3)) h = Math.imul(h ^ ch.codePointAt(0), 0x01000193) >>> 0
    v[h % 256] += 1
  }
  return v
}

module.exports = { sahteGom }
