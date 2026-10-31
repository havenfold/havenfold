// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D75: çok süreçli testlerde sahipsiz cihaz süreci kalmaz. Ana süreç abort edince (brittle zaman aşımı; çıkış kancası
// çalışmaz) çocuk stdin kapandığı için kendini kapatır. Linux'ta Node koşusunda sınanır (/proc ile).
'use strict'
const test = require('brittle')
const NODE = typeof Bare === 'undefined' // eslint-disable-line no-undef
const fs = NODE ? require('f' + 's') : null

test('ana süreç abort edince cihaz süreci de kapanır (sahipsiz kalmaz)', { skip: !NODE || !fs.existsSync('/proc/self') }, async (t) => {
  const { spawn } = require('child_' + 'process')
  const p = spawn(process.execPath, [__dirname + '/helpers/abort-main.js'], { stdio: ['ignore', 'pipe', 'ignore'] })
  let cikti = ''
  p.stdout.on('data', (d) => { cikti += d })
  await new Promise((resolve) => p.on('exit', resolve))
  const m = /COCUK (\d+)/.exec(cikti)
  t.ok(m, 'çocuk başladı')
  const pid = Number(m[1])
  const yasiyor = () => fs.existsSync('/proc/' + pid) && !/^State:\s+Z/m.test(fs.readFileSync('/proc/' + pid + '/status', 'utf8'))
  const son = Date.now() + 10000
  while (yasiyor() && Date.now() < son) await new Promise((resolve) => setTimeout(resolve, 100))
  t.absent(yasiyor(), 'çocuk kendini kapattı')
  if (yasiyor()) process.kill(pid, 'SIGKILL')
})
