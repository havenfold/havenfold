// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// standing.js — sürekli görev (RFC-0002 §10, kurucu §8.6)
//
// TASK.standing = true, deadline en çok 30 gün. Yalnız ebeveyn verir (denetim madde 3). İşçi olayları REC_DROP ile
// kind = 'olaylar' koleksiyonuna bırakır; bunun için koleksiyonun writers listesinde device:<deviceId> bulunur. Telefon
// izni görevden önce COLLECTION olayıyla ekler, görev bitince ya da iptal edilince kaldırır (kaldırma cihaz için kesim
// üretir, RFC-0001 §8). Burada yalnız olay gövdeleri ve yenileme zamanı var; olayı imzalayıp yazmak telefonun işi.
const b4a = require('b4a')
const { STANDING_MAX_MS } = require('./audit')

const hex = (b) => (typeof b === 'string' ? b : b4a.toString(b, 'hex'))
const isZero = (b) => b.every((x) => x === 0)
function fail (code) { throw new Error(code) }

// Süre dolmadan yeni taskId ile yenilenir; telefon son günde yeniler (RFC "süre dolmadan" diyor, pay seçimi İstekler)
const YENILEME_PAYI_MS = 86_400_000

// COLLECTION gövdesi: var olan koleksiyonun bütün alanları, writers'a device:<id> eklenmiş ya da çıkarılmış
function izinGovdesi (L, collectionId, deviceId, ekle) {
  const col = L.collections.get(hex(collectionId))
  if (!col || col.kind !== 'olaylar' || isZero(col.dropKey)) fail('NOT_COLLECTION_ELIGIBLE')
  const entry = 'device:' + hex(deviceId)
  if (ekle && !L.devices.get(hex(deviceId))?.active) fail('NO_TARGET')
  const var_ = col.writers.includes(entry)
  if (ekle === var_) return null // değişiklik yok
  const writers = ekle ? [...col.writers, entry] : col.writers.filter((w) => w !== entry)
  return {
    collectionId: b4a.from(col.id, 'hex'),
    name: col.name,
    kind: col.kind,
    readers: [...col.readers],
    writers,
    sensitivity: col.sensitivity,
    taskAccess: col.taskAccess,
    history: col.history,
    dropKey: col.dropKey
  }
}

const izinEkle = (L, collectionId, deviceId) => izinGovdesi(L, collectionId, deviceId, true)
const izinKaldir = (L, collectionId, deviceId) => izinGovdesi(L, collectionId, deviceId, false)

// İşçi bu koleksiyona olay bırakabilir mi (defterin bugünkü durumunda)
function birakabilir (L, collectionId, deviceId) {
  const col = L.collections.get(hex(collectionId))
  return !!col && col.kind === 'olaylar' && !isZero(col.dropKey) && col.writers.includes('device:' + hex(deviceId)) && !!L.devices.get(hex(deviceId))?.active
}

const enGecDeadline = (now) => now + STANDING_MAX_MS
const yenilenmeli = (deadline, now) => now >= deadline - YENILEME_PAYI_MS

module.exports = { YENILEME_PAYI_MS, izinGovdesi, izinEkle, izinKaldir, birakabilir, enGecDeadline, yenilenmeli }
