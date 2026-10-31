// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Tek modülün ilk yüklenmesi (yükleme ve çalıştırma): belirtici dinamik, böylece Bare onu dosya yüklenirken önceden
// yüklemez (Bare düz yazılmış require'ları dosyayla birlikte yükler; D57 bulgusu)
/* global Bare */
const os = require('bare-os')
const ad = Bare.argv[2]
const y0 = os.memoryUsage().heapUsed
const t = Date.now()
require(ad)
console.log('SONUC ' + JSON.stringify({ ms: Date.now() - t, yiginKiB: Math.round((os.memoryUsage().heapUsed - y0) / 1024) }))
