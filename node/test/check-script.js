// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// scripts/check.sh'ın iki ön denetimi (Codex 12. tur): nvm'li makinede Node 22 olmayan her sürümde nvm use 22 denenir
// (v24 varsayılanında hiç denenmiyordu); sahipsiz süreç uyarısı ağaçtaki yardımcının yolunu arar (ad değişikliğinde
// worklet/test/yardimci/cihaz.js'te kalmıştı, uyarı hiç çıkmıyordu).
const test = require('brittle')
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const KOK = path.join(__dirname, '..', '..')
const betik = fs.readFileSync(path.join(KOK, 'scripts/check.sh'), 'utf8')

test('check.sh: nvm geçişi yalnız Node 22 değilse', (t) => {
  const satir = betik.split('\n').find((l) => l.includes('nvm.sh') && l.includes('grep -q'))
  const kalip = /grep -q '([^']+)'/.exec(satir)[1]
  const eslesir = (v) => spawnSync('grep', ['-q', kalip], { input: v + '\n' }).status === 0
  t.ok(eslesir('v22.11.0'), 'v22: nvm gerekmez')
  for (const v of ['v20.18.0', 'v23.1.0', 'v24.11.0', 'v220.0.0']) t.absent(eslesir(v), v + ': nvm use 22 denenir')
})

test('check.sh: sahipsiz süreç uyarısının aradığı yardımcı ağaçta var', (t) => {
  const satir = betik.split('\n').find((l) => l.startsWith('sahipsiz='))
  const kalip = /\/(worklet\\\/[^ ]+?\\\.js)\//.exec(satir)[1].replace(/\\/g, '')
  t.ok(fs.existsSync(path.join(KOK, kalip)), kalip)
})
