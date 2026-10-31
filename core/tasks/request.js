// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// request.js — isteyen telefonun görev mesajları (RFC-0002 §6, §7)
//
// Telefon göndermeden önce işçinin yapacağı denetimlerin kendi tarafındakileri yapar: ilk kullanım onayı, tür izni,
// koleksiyonun görev erişimi, süre. Kasa verisi işçiye gitmez. collectionId ile girdiler arasında kriptografik bağ
// yoktur (§6.1 "Dürüst sınır"); bu denetim telefonun doğru davranmasına dayanır.
const b4a = require('b4a')
const { v21: { canTask } } = require('@havenfold/core')
const K = require('./encoding')
const { STANDING_MAX_MS, TASK_MAX_MS, URETIM_PAYI_MS, BACKUP } = require('./audit')

const hex = (b) => b4a.toString(b, 'hex')
const isZero = (b) => b.every((x) => x === 0)
function fail (code) { throw new Error(code) }
const ZERO16 = b4a.alloc(16)

// me: { memberId, signKeyPair }. g: { taskId, workerId, type, version, inputs, params, collectionId, deadline, limits, standing }
function gorevKur (L, me, g, { onay, now = Date.now() }) {
  const standing = !!g.standing
  if (!onay.var(me.memberId, g.workerId)) fail('NO_APPROVAL')
  if (!canTask(L, hex(me.memberId), g.type, { continuous: standing })) fail('TUR_IZNI_YOK')
  if (g.type === BACKUP) {
    if (!isZero(g.collectionId)) fail('KOLEKSIYON_KAPALI')
  } else {
    const col = L.collections.get(hex(g.collectionId))
    if (!col || !col.taskAccess || col.sensitivity === 'kasa') fail('KOLEKSIYON_KAPALI')
  }
  // Telefon üst sınırın 5 dakika altında üretir (RFC-0019 §11.2 c)
  const max = (standing ? STANDING_MAX_MS : TASK_MAX_MS) - URETIM_PAYI_MS
  if (!(g.deadline > now && g.deadline <= now + max)) fail('SURE_GECERSIZ')
  return K.encodeTask(L.familyId, {
    ...g,
    parentTaskId: ZERO16,
    requester: me.memberId,
    params: g.params || b4a.alloc(0),
    ledgerSeq: L.len - 1,
    standing,
    delegation: null
  }, me)
}

const iptalKur = (L, me, taskId) => K.encodeCancel(L.familyId, { taskId, by: me.memberId }, me)

module.exports = { gorevKur, iptalKur }
