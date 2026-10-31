// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// coordinator.js — süreli koordinatör yetkisi TASK_DELEGATION (RFC-0002 §9)
//
// Telefon uzun bir işi bir işçiye koordinatör olarak verir: belgeyi (TASK_DELEGATION) ve normal bir ana TASK'ı
// (isteyen imzalı, parentTaskId sıfır) gönderir. Koordinatör belgedeki işçilerden güncel NODE_CAPS ister, §8 kurallarıyla
// böler, alt görevleri hf/task-sub/ ile imzalar. Alt sonuçları birleştirip tek TASK_RESULT ile isteyene yollar.
// Belgede adı geçmeyen işçiye iş verilemez; belge yalnız bu iş ve expiresAt için geçerlidir.
const b4a = require('b4a')
const K = require('./encoding')
const { delegasyonHatasi, DELEGATION_MAX_MS, URETIM_PAYI_MS } = require('./audit')
const { ciktiHazirla, ciktiHazirlaVektor, logKirp } = require('./delivery')

const hex = (b) => b4a.toString(b, 'hex')
function fail (code) { throw new Error(code) }
const has = (list, x) => list.some((y) => b4a.equals(y, x))

// --- Telefon ----------------------------------------------------------------------------------------------------

// me: isteyen ({ memberId, signKeyPair }). onay: OnayDefteri; belgedeki her işçi için onay aranır (§7).
// d: { taskId, coordinatorId, workers, types, collectionId, inputBlobIds, maxParts, expiresAt, ledgerSeq }
function delegasyonKur (L, me, d, { onay, now = Date.now() }) {
  if (!has(d.workers, d.coordinatorId)) fail('INVALID_BODY') // koordinatör dahil
  if (new Set(d.workers.map(hex)).size !== d.workers.length) fail('INVALID_BODY')
  if (!Number.isSafeInteger(d.maxParts) || d.maxParts < 1 || !d.types.length) fail('INVALID_BODY')
  if (!(d.expiresAt > now && d.expiresAt <= now + DELEGATION_MAX_MS - URETIM_PAYI_MS)) fail('SURE_GECERSIZ')
  for (const w of d.workers) if (!L.devices.get(hex(w))?.active) fail('NO_TARGET')
  if (onay.eksikler(me.memberId, d.workers).length) fail('NO_APPROVAL')
  return K.encodeDelegation(L.familyId, { ...d, requester: me.memberId }, me)
}

// --- Koordinatör ---------------------------------------------------------------------------------------------------

// Ana görev Isci.denetle'den geçtikten sonra belge ana görevle tutarlı olmalı: aynı iş, aynı isteyen, aynı koleksiyon,
// aynı girdiler, tür listede, koordinatör biz. Dönüş: null ya da hata kodu (IMZA_GECERSIZ, YETKISIZ, DEFTER_GERIDE).
function belgeHatasi (L, meId, task, d, now) {
  const h = delegasyonHatasi(L, d, now)
  if (h) return h
  if (!b4a.equals(d.coordinatorId, meId) || !b4a.equals(d.taskId, task.taskId)) return 'YETKISIZ'
  if (!b4a.equals(d.requester, task.requester) || !b4a.equals(d.collectionId, task.collectionId)) return 'YETKISIZ'
  if (!d.types.includes(task.type)) return 'YETKISIZ'
  const girdi = new Set(task.inputs.map((i) => hex(i.blobId)))
  if (girdi.size !== d.inputBlobIds.length || !d.inputBlobIds.every((b) => girdi.has(hex(b)))) return 'YETKISIZ'
  return null
}

class Koordinator {
  // me: koordinatör işçinin kimliği. task: ana görev (çözülmüş). d: belge (çözülmüş, sig dolu).
  constructor ({ ledger, me, task, delegasyon, now = Date.now }) {
    this.ledger = ledger
    this.me = me
    this.task = task
    this.d = delegasyon
    this.now = now
    this.verilen = 0 // gönderilen alt görev sayısı (yeniden denemeler dahil); işçi yalnız kabul ettiklerini sayar
  }

  // Belgedeki işçiler (koordinatör dahil): NODE_CAPS istenecek olanlar
  isciler () { return this.d.workers.map(hex) }

  // Belgede olmayan bir işçinin bildirimi bölmeye girmez
  belgedeki (cevrimici) { return cevrimici.filter((n) => this.isciler().includes(n.id)) }

  // p: { taskId, workerId, inputs, params, deadline, limits, version? } → imzalı alt TASK
  altGorev (p) {
    const d = this.d
    const now = this.now()
    if (now >= d.expiresAt) fail('SURE_GECERSIZ')
    if (!has(d.workers, p.workerId)) fail('YETKISIZ')
    if (!p.inputs.every((i) => has(d.inputBlobIds, i.blobId))) fail('YETKISIZ')
    if (p.deadline > d.expiresAt) fail('SURE_GECERSIZ')
    if (this.verilen >= d.maxParts) fail('CHUNK_LIMIT')
    this.verilen++
    const t = this.task
    return K.encodeTask(this.ledger.familyId, {
      taskId: p.taskId,
      parentTaskId: d.taskId,
      workerId: p.workerId,
      type: t.type,
      version: p.version || t.version,
      requester: d.requester,
      inputs: p.inputs,
      params: p.params,
      collectionId: d.collectionId,
      ledgerSeq: this.ledger.len - 1,
      deadline: p.deadline,
      limits: p.limits,
      standing: false,
      delegation: d
    }, this.me)
  }

  // TASK_CANCEL koordinatörün imzasıyla (alt görevlere)
  iptal (taskId) { return K.encodeCancel(this.ledger.familyId, { taskId, by: this.me.memberId }, this.me) }
}

// Alt sonuçlar parça sırasıyla birleşir; biri bile 'ok' değilse ana sonuç 'hata'. Satır içi çıktılar ardışık eklenir;
// toplam 32 KB'ı aşarsa yeni rastgele fileKey ile dosya olur (§6.3 "Çıktı"). Dönüş: { result, blob }.
function birlestir (taskId, parcaSonuclari, { mime = 'text/plain' } = {}) { return birlestirIle(taskId, parcaSonuclari, mime, ciktiHazirla) }

// Yalnız test vektörleri: sabit fileKey
function birlestirVektor (taskId, parcaSonuclari, { mime = 'text/plain', fileKey }) {
  return birlestirIle(taskId, parcaSonuclari, mime, (data, o) => ciktiHazirlaVektor(data, { ...o, fileKey }))
}

function birlestirIle (taskId, parcaSonuclari, mime, hazirla) {
  const sirali = [...parcaSonuclari].sort((a, b) => a.parca - b.parca)
  if (!sirali.every((x) => x.sonuc && x.sonuc.status === 'ok')) {
    return { result: { taskId, status: 'hata', outputs: [], inline: b4a.alloc(0), log: 'parca basarisiz' }, blob: null }
  }
  const c = hazirla(b4a.concat(sirali.map((x) => x.sonuc.inline)), { mime })
  const outputs = [...sirali.flatMap((x) => x.sonuc.outputs), ...c.outputs]
  const log = logKirp(sirali.map((x) => x.sonuc.log).filter(Boolean).join('\n'))
  return { result: { taskId, status: 'ok', outputs, inline: c.inline, log }, blob: c.blob }
}

module.exports = { delegasyonKur, belgeHatasi, Koordinator, birlestir, birlestirVektor }
