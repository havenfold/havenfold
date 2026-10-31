// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Soğuk açılış: worklet yüklenir, start, ilk cevap (200 FAMILY_INFO). Yalnız telefondaki girişin yükleyeceği modüller
// düz yazılır; zamanlar süreç içi (modül yükleme süresi ana süreçten duvar saatiyle ölçülür)
/* global Bare */
const T0 = Date.now()
const b4a = require('b4a')
const os = require('bare-os')
const { start } = require('../../worklet')
const { urunSunucusu, KOMUT } = require('../../worklet/example/product')
const { ipcCifti, istemci } = require('../../worklet/test/helpers/common')
const [dizin, anahtarHex, archivePubHex] = Bare.argv.slice(2)
;(async () => {
  const t2 = Date.now()
  const ipc = ipcCifti()
  const c = istemci(ipc)
  await start({ urunSunucusu, dizin, anahtar: b4a.from(anahtarHex, 'hex'), archivePubHex, ipc, appId: 'yuva-defteri' })
  const t3 = Date.now()
  const bilgi = await c.iste(KOMUT.FAMILY_INFO, {})
  const t4 = Date.now()
  console.log('SONUC ' + JSON.stringify({ calisma: t2 - T0, start: t3 - t2, ilkCevap: t4 - t3, aile: !!(bilgi && bilgi.aile), rssMiB: Math.round(os.memoryUsage().rss / 1048576) }))
  Bare.exit(0)
})().catch((err) => { console.error('HATA', err.stack); Bare.exit(1) })
