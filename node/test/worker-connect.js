// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// İşçinin denetçi istemcisi: denetçinin soketi açılıştan sonra gelirse bekler (ISO sanal kurulumunda ikinci açılışta
// işçi soket hazır olmadan başlayıp düşüyordu); süre dolunca ya da başka hatada düşer.
'use strict'
const test = require('brittle')
const fs = require('fs')
const os = require('os')
const path = require('path')
const net = require('net')
const { DenetciIstemcisi } = require('../worker')

const geciciYol = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hfb-')), 'd.sock')

test('denetçi soketi sonradan açılırsa istemci bağlanır', async (t) => {
  const yol = geciciYol()
  const ist = new DenetciIstemcisi({ soket: yol, bekleMs: 5000 })
  let sunucu
  setTimeout(() => { sunucu = net.createServer(() => {}).listen(yol) }, 400)
  await ist.baglan()
  t.ok(ist.s, 'bağlandı')
  ist.s.destroy()
  sunucu.close()
})

test('süre dolarsa ENOENT ile düşer', async (t) => {
  const ist = new DenetciIstemcisi({ soket: geciciYol(), bekleMs: 300 })
  const bas = Date.now()
  await t.exception(() => ist.baglan(), /ENOENT/)
  t.ok(Date.now() - bas < 3000, 'süre sınırında')
})
