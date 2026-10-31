// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// task-channel.js — görev kanal komutlarının sunucu tarafı (RFC-0002 §14 ve Ek: RFC-0033 §9 s; RFC-0024 §2–§4)
//
// Ürün sunucusu bunları kendi isleyicilerine katar (example/product.js gibi):
//   const g = taskChannel(c)                       // c: start'ın ürün sunucusuna verdiği bağlam
//   isleyiciler = { ...isleyiciler, ...g.isleyiciler }
//   olaylariBagla(gonder) içinde: const birak = g.olaylariBagla(gonder)
// Komutlar (gövde → sonuç; gövde SDK yönteminin adlandırılmış bağımsız değişkenleridir, RFC-0024 §3):
//   250 TASK_REQUEST     { type, version, inputs: BlobRef[], params, opts } → { id, yer: 'isci', taskIds } | { yer, hata? }
//   251 TASK_CANCEL    { id } → null
//   252 MACHINE         {} → MachineSummary
//   253 DEVICES       {} → DeviceInfo[]
//   254 TASK_CONSENT     { deviceId, allow } → null
//   255 STANDING_START { type, version, deviceId, params, opts } → { id, taskId }
// params bayt ({ $b }) ya da JSON nesnesidir; nesne UTF-8 JSON olarak gider (RFC-0033 §9 q). opts'tan yalnız
// collectionId, ramMB, minutes, deadline, diskMB ve telefondaYapilabilir alınır: kanal üstünden bölme yok (paramsFor
// işlevi JSON'a girmez; bölünmüş iş ürün sunucusunda TaskApi.run ile).
// İlerleme ve sonuç RFC-0024 olay çerçevesiyle (gövde channel-json.js kodlamasında):
//   { olay: 'task', veri: { id, tur: 'progress', pct, note } }
//   { olay: 'task', veri: { id, tur: 'result', status, ... } }   status: 'ok' | 'hata' | 'iptal' | 'sure'
//   { olay: 'task', veri: { id, tur: 'hata', hata } }
// id, 250 ve 255'in döndürdüğü iş tutamacıdır. Aile yokken NO_IDENTITY; gövde biçimi tutmazsa INVALID_BODY; diğer
// hatalar TaskApi'nin kodlarıdır (NO_TASK, NO_APPROVAL, NOT_WORKER, INVALID_DURATION …).
'use strict'
const b4a = require('b4a')
const { kodla, baytMi } = require('./channel-json')

const TASK_COMMAND = { TASK_REQUEST: 250, TASK_CANCEL: 251, MACHINE: 252, DEVICES: 253, TASK_CONSENT: 254, STANDING_START: 255 }
const HEX16 = /^[0-9a-f]{32}$/
const OLAYLAR = ['progress', 'result', 'error'] // TaskApi olayları; çerçevede 'error' tur: 'hata' olarak gider (kanal yükü değişmedi)
const KOD = /^[A-Z][A-Z0-9_]{1,63}$/

function fail (code) { throw new Error(code) }
const govde = (kosul) => { if (!kosul) fail('INVALID_BODY') }
const dizgi = (x) => typeof x === 'string' && x.length > 0 && x.length <= 128
const sayi = (x) => Number.isSafeInteger(x) && x >= 0
const nesne = (x) => x !== null && typeof x === 'object' && !Array.isArray(x) && !baytMi(x)

function paramsOf (p) {
  if (p === undefined || p === null) return b4a.alloc(0)
  if (baytMi(p)) return p
  govde(nesne(p) || Array.isArray(p))
  return b4a.from(JSON.stringify(p))
}

function girdilerOf (inputs = []) {
  govde(Array.isArray(inputs) && inputs.length <= 64)
  return inputs.map((x) => {
    govde(nesne(x) && baytMi(x.blobId) && x.blobId.byteLength === 32 && baytMi(x.fileKey) && x.fileKey.byteLength === 32 && sayi(x.size) && typeof x.mime === 'string')
    return { blobId: x.blobId, fileKey: x.fileKey, size: x.size, mime: x.mime }
  })
}

function secenekOf (o, { standing = false } = {}) {
  govde(nesne(o) && typeof o.collectionId === 'string' && HEX16.test(o.collectionId) && sayi(o.ramMB) && sayi(o.deadline))
  govde((o.minutes === undefined || sayi(o.minutes)) && (o.diskMB === undefined || sayi(o.diskMB)))
  const s = { collectionId: o.collectionId, ramMB: o.ramMB, minutes: o.minutes || 0, deadline: o.deadline }
  if (o.diskMB !== undefined) s.diskMB = o.diskMB
  if (!standing && o.telefondaYapilabilir !== undefined) s.telefondaYapilabilir = o.telefondaYapilabilir === true
  return s
}

/**
 * @param {object} c  start bağlamı (c.nesneler.gorev: TaskApi; aile yokken null)
 * Dönüş: { isleyiciler: { [no]: (govde) → sonuç }, olaylariBagla(gonder) → bırak }
 */
function taskChannel (c) {
  let gonder = null
  let bagli = null // olaylarına abone olunan TaskApi (aile kurulunca ya da bağlanınca nesneler yenilenir)
  const dinleyici = Object.fromEntries(OLAYLAR.map((tur) => [tur, (id, veri) => {
    if (!gonder) return
    // 'hata' olayında yalnız kod gider; çekirdeğin başka bir iletisi INTERNAL_ERROR olur (RFC-0024 §2)
    const v = tur === 'progress' ? { pct: veri.pct, note: veri.note } : tur === 'result' ? veri : { hata: KOD.test(veri) ? veri : 'INTERNAL_ERROR' }
    gonder(JSON.stringify({ olay: 'task', veri: kodla({ id, tur: tur === 'error' ? 'hata' : tur, ...v }) }))
  }]))

  function abone () {
    const g = c.nesneler.gorev
    if (g === bagli) return
    if (bagli) for (const tur of OLAYLAR) bagli.off(tur, dinleyici[tur])
    bagli = g
    if (g) for (const tur of OLAYLAR) g.on(tur, dinleyici[tur])
  }

  function gorev () {
    abone()
    if (!c.nesneler.aile || !bagli) fail('NO_IDENTITY')
    return bagli
  }

  const isleyiciler = {
    [TASK_COMMAND.TASK_REQUEST]: ({ type, version, inputs, params, opts } = {}) => {
      const g = gorev()
      govde(dizgi(type) && dizgi(version))
      const r = g.run(type, version, girdilerOf(inputs), paramsOf(params), secenekOf(opts))
      return r.yer === 'isci' ? { id: r.id, yer: r.yer, taskIds: r.taskIds } : { yer: r.yer, hata: r.hata || null }
    },
    [TASK_COMMAND.TASK_CANCEL]: ({ id } = {}) => {
      const g = gorev()
      govde(typeof id === 'string' && HEX16.test(id))
      g.cancel(id)
      return null
    },
    [TASK_COMMAND.MACHINE]: () => gorev().machine(),
    [TASK_COMMAND.DEVICES]: () => gorev().devices(),
    [TASK_COMMAND.TASK_CONSENT]: ({ deviceId, allow } = {}) => {
      const g = gorev()
      govde(typeof deviceId === 'string' && HEX16.test(deviceId) && typeof allow === 'boolean')
      g.consent(deviceId, allow)
      return null
    },
    [TASK_COMMAND.STANDING_START]: ({ type, version, deviceId, params, opts } = {}) => {
      const g = gorev()
      govde(dizgi(type) && dizgi(version) && typeof deviceId === 'string' && HEX16.test(deviceId))
      return g.startStanding(type, version, deviceId, paramsOf(params), secenekOf(opts, { standing: true }))
    }
  }

  function olaylariBagla (g) {
    gonder = g
    abone()
    return () => { gonder = null }
  }

  return { isleyiciler, olaylariBagla }
}

module.exports = { taskChannel, TASK_COMMAND }
