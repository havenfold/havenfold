// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// yetki/ana.js — kök yardımcının giriş dosyası (RFC-0007 §6.4; RFC-0026 b). Kurulumda /usr/lib/havenfold/yetki/'ye
// kopyalanır (ana.js, node, lib/); kod yalnız bu dizinin kendi lib/'inden yüklenir, güncel sürümden hiçbir zaman.
// Birimler: havenfold-yetki.service, havenfold-deneme.service, havenfold-acilis.service, havenfold-pil.service.
'use strict'
require('./lib/node/privilege-main').ana().then((kod) => { process.exitCode = kod }, (err) => {
  console.error('havenfold-yetki: ' + (err && err.message))
  process.exitCode = 3
})
