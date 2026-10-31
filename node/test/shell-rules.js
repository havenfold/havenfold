// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Kabuk betiklerinin iki kuralı (Codex 12. tur):
// - images/source-archive.sh: kaynağı yayımlanacak paket seçimi "GPL" kısaltması geçmeyen GPL/LGPL copyright
//   dosyalarını da tutar (eski biçimli copyright yalnız "GNU Lesser General Public License" yazar; GPLv3 §6).
// - node/deploy/havenfold-install-sudo.sh: PATH'teki node yalnız 22 ise kopyalanır (24 desteklenmiyor; README, .nvmrc).
const test = require('brittle')
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const KOK = path.join(__dirname, '..', '..')

test('source-archive.sh: GPL seçimi tam adla yazılmış lisansı da tutar', (t) => {
  const betik = fs.readFileSync(path.join(KOK, 'images/source-archive.sh'), 'utf8')
  const m = /elif grep (-[A-Za-z]+) '([^']+)' "\$doc"; then neden=gpl/.exec(betik)
  t.ok(m, 'seçim satırı')
  const args = [m[1], m[2]]
  const secer = (metin) => spawnSync('grep', args, { input: metin }).status === 0
  t.ok(secer('License: GPL-2+\n'))
  t.ok(secer('This package is free software; you can redistribute it under the terms of the GNU Lesser General Public License\n'), 'LGPL tam ad')
  t.ok(secer('under the terms of the GNU General Public License as published by\n'), 'GPL tam ad')
  t.absent(secer('License: MIT\n'))
})

test('havenfold-install-sudo.sh: PATH\'teki node yalnız sürüm 22 ise', (t) => {
  const betik = fs.readFileSync(path.join(KOK, 'node/deploy/havenfold-install-sudo.sh'), 'utf8')
  const satir = betik.split('\n').find((l) => l.startsWith('if ') && l.includes('process.versions.node.split'))
  t.ok(satir, satir)
  t.ok(/" -eq 22 \]/.test(satir), 'yalnız 22 (24 desteklenmiyor)')
})
