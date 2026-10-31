// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Görev kanal komutları IPC üstünden (RFC-0002 Ek: RFC-0033 §9 s; RFC-0024 §2–§4): örnek ürün sunucusu taskChannel'yi
// katar; aile yokken NO_IDENTITY, ailede Ev Makinesi kartı ve cihaz listesi, gövde hataları, 'gorev' olayı çerçevesi.
// Çerçeve akışının bayt bayt doğrulaması sdk/test/channel-task.js'te (protocol/vectors/channel-task.json).
'use strict'
const test = require('brittle')
const b4a = require('b4a')
const { start, TASK_COMMAND: G } = require('..')
const { urunSunucusu, KOMUT } = require('../example/product')
const { geciciDizin, ipcCifti, istemci, hataOf } = require('./helpers/common')

const saat = () => { let t = 1_800_000_000_000; return () => t++ }
let onceki = null
async function telefon (t, o = {}) {
  if (onceki) { onceki.kapat(); onceki = null }
  const ipc = ipcCifti()
  const c = istemci(ipc)
  const w = await start({ urunSunucusu, dizin: geciciDizin(t), now: saat(), appId: 'ornek', ipc, testKipi: true, ...o })
  onceki = w
  t.teardown(() => { w.kapat(); if (onceki === w) onceki = null })
  return { w, c }
}

test('gorev-kanal: TASK_COMMAND 250–255; aile yokken NO_IDENTITY', async (t) => {
  t.alike(G, { TASK_REQUEST: 250, TASK_CANCEL: 251, MACHINE: 252, DEVICES: 253, TASK_CONSENT: 254, STANDING_START: 255 })
  const { c } = await telefon(t)
  for (const no of Object.values(G)) t.is(await hataOf(c.iste(no, {})), 'NO_IDENTITY', String(no))
})

test('gorev-kanal: ailede kart, cihazlar, onay ve gövde hataları; olay gorev çerçevesiyle', async (t) => {
  const { w, c } = await telefon(t)
  await c.iste(KOMUT.CREATE_FAMILY, { aileAdi: 'Rivera', benimAdim: 'Alex' })
  t.alike(await c.iste(G.MACHINE), { cekirdek: 0, bellekMB: 0, bosDiskGB: 0, acikCihaz: 0, enBuyukTekIsMB: 0, calisan: [] })
  t.alike(await c.iste(G.DEVICES), [])
  const cid = (await c.iste(KOMUT.RECORD_COLLECTIONS)).find((x) => x.name === 'Tüm Aile').collectionId
  const opts = { collectionId: cid, ramMB: 512, minutes: 1, deadline: 1_800_000_000_000 + 3_600_000 }
  t.alike(await c.iste(G.TASK_REQUEST, { type: 'hf.task.ocr', version: '1.0.0', inputs: [], params: { langs: ['tur'] }, opts }), { yer: null, hata: 'NO_ELIGIBLE_DEVICE' })
  t.alike(await c.iste(G.TASK_REQUEST, { type: 'hf.task.ocr', version: '1.0.0', inputs: [], params: { langs: ['tur'] }, opts: { ...opts, telefondaYapilabilir: true } }), { yer: 'telefon', hata: null })
  t.is(await hataOf(c.iste(G.TASK_REQUEST, { type: 'hf.task.ocr', version: '1.0.0', inputs: [], opts: { ...opts, ramMB: -1 } })), 'INVALID_BODY')
  t.is(await hataOf(c.iste(G.TASK_REQUEST, { type: 'hf.task.ocr', version: '1.0.0', params: 'metin', opts })), 'INVALID_BODY', 'params bayt ya da nesne')
  t.is(await hataOf(c.iste(G.TASK_CONSENT, { deviceId: '11'.repeat(16), allow: true })), 'NOT_WORKER')
  t.is(await c.iste(G.TASK_CONSENT, { deviceId: '11'.repeat(16), allow: false }), null, 'geri alma her zaman')
  t.is(await hataOf(c.iste(G.TASK_CANCEL, { id: '22'.repeat(16) })), 'NO_TASK')
  t.is(await hataOf(c.iste(G.TASK_CANCEL, { id: 'x' })), 'INVALID_BODY')
  t.is(await hataOf(c.iste(G.STANDING_START, { type: 'hf.task.vision', version: '1.0.0', deviceId: '11'.repeat(16), opts })), 'NO_APPROVAL')

  // TaskApi'nin olayları uygulamaya 'gorev' çerçevesiyle; hata olayında yalnız kod
  const gorev = w.kalici.nesneler.gorev
  gorev.emit('progress', 'ab'.repeat(16), { pct: 40, note: 'sayfa 4' })
  gorev.emit('result', 'ab'.repeat(16), { status: 'ok', outputs: [], inline: b4a.from('metin'), log: '' })
  gorev.emit('error', 'ab'.repeat(16), 'ic ayrinti: yol /x')
  gorev.emit('error', 'ab'.repeat(16), 'NO_APPROVAL')
  const olaylar = c.olaylar.filter((o) => o.olay === 'task').map((o) => o.veri)
  t.alike(olaylar, [
    { id: 'ab'.repeat(16), tur: 'progress', pct: 40, note: 'sayfa 4' },
    { id: 'ab'.repeat(16), tur: 'result', status: 'ok', outputs: [], inline: { $b: b4a.toString(b4a.from('metin'), 'base64') }, log: '' },
    { id: 'ab'.repeat(16), tur: 'hata', hata: 'INTERNAL_ERROR' },
    { id: 'ab'.repeat(16), tur: 'hata', hata: 'NO_APPROVAL' }
  ])
})

test('gorev-kanal: TaskApi.tick çekirdekte zamanlanır (zaman aşımı, yeniden deneme), kapanışta durur', async (t) => {
  const { w, c } = await telefon(t, { gorevTickMs: 20 })
  await c.iste(KOMUT.CREATE_FAMILY, { aileAdi: 'Rivera', benimAdim: 'Alex' })
  let n = 0
  w.kalici.nesneler.gorev.tick = () => { n++ }
  await new Promise((resolve) => setTimeout(resolve, 150))
  t.ok(n >= 2, 'tick yürüdü: ' + n)
  w.kapat()
  const kapaninca = n
  await new Promise((resolve) => setTimeout(resolve, 100))
  t.is(n, kapaninca, 'kapandıktan sonra tick yok')
})
