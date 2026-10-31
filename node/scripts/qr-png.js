#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// QR kodlayıcısının telefonla denenmesi için PNG çıktısı: node node/scripts/qr-png.js "<metin>" çıktı.png
const fs = require('fs')
const { pngKodla } = require('../qr-png')

const [metin, cikti] = process.argv.slice(2)
if (!metin || !cikti) { console.error('Kullanım: qr-png.js "<metin>" çıktı.png'); process.exit(1) }
const { png, q } = pngKodla(metin)
fs.writeFileSync(cikti, png)
console.log(`sürüm ${q.surum}, maske ${q.maske}, ${q.moduller.length}×${q.moduller.length} modül → ${cikti}`)
