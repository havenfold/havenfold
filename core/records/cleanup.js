// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// cleanup.js — silinen kaydın temizliği ve süreli kayıtlar (RFC-0001 §13, RFC-0006 §14)
//
// Eşik yerel saate değil koleksiyonun verisine bağlıdır: M = koleksiyondaki en büyük geçerli hlc'nin milisaniyesi.
//   Silinen kayıt: deletedAt, M'den 1 yıl eskiyse kaydın hlc < deletedAt.hlc olan işlemleri silinir; del işleminin
//   kendisi ve türü belirleyen işlem kalır. Sonradan gelen hlc < deletedAt.hlc işlemleri mezara girer.
//   Süreli kayıt: türü belirleyen işlem _t ve _keep > 0 taşıyorsa ve _t + k gün < M ise bütün işlemleri silinir;
//   recordId mezara girer, o kayıt için sonradan gelen hiçbir işlem kabul edilmez.
const b4a = require('b4a')
const { msOf } = require('./hlc')
const { view } = require('./merge')
const { confOf } = require('./fields')

const hex = (b) => b4a.toString(b, 'hex')
const DAY_MS = 86_400_000
const YEAR_MS = 365 * DAY_MS

// RFC-0006 §14.2: etkin süre k = min(_keep, hf.saklama gün'leri, düşük güvende 7)
function effectiveKeep (keep, type, conf, saklama) {
  let k = keep > 0 ? keep : Infinity
  for (const s of saklama) if (s.tur === '*' || (typeof s.tur === 'string' && type && type.startsWith(s.tur))) k = Math.min(k, s.gun)
  if (conf < 50) k = Math.min(k, 7)
  return k
}

// Koleksiyonun geçerli hf.saklama kuralları (RFC-0019 §11.1 d, l). Ebeveyn olmayanın işlemleri durumlara zaten
// katılmaz (Replika.durumlar); burada yalnız görünümler okunur. items: [view]
function saklamalar (items) {
  const out = []
  for (const view of items) {
    if (!view || view.type !== 'hf.saklama') continue
    if (typeof view.fields.tur === 'string' && Number.isInteger(view.fields.gun) && view.fields.gun >= 1) out.push({ tur: view.fields.tur, gun: view.fields.gun })
  }
  return out
}

// r: Replika. Dönüş: temizlenen işlem sayısı.
function temizle (r) {
  let n = 0
  for (const cid of new Set([...r.ops.values()].map((o) => o.cid))) {
    const valid = r.validOps(cid)
    if (!valid.length) continue
    let M = 0
    for (const o of valid) M = Math.max(M, msOf(o.inner.hlc))
    const states = r.durumlar(cid)
    const saklama = saklamalar([...states].map(([rid, st]) => view(b4a.from(rid, 'hex'), st)))
    // İşlemler kayda göre bir kez gruplanır (D26: kayıt başına bütün işlemleri süzmek karesel büyüyordu)
    const byRecord = new Map()
    for (const o of r.ops.values()) {
      if (o.cid !== cid || !o.inner) continue
      const k = hex(o.inner.recordId)
      if (!byRecord.has(k)) byRecord.set(k, [])
      byRecord.get(k).push(o)
    }
    for (const [rid, st] of states) {
      const ops = byRecord.get(rid) || []
      const typeOp = st.typeStamp && ops.find((o) => b4a.equals(o.opId, st.typeStamp.opId))
      const tf = typeOp ? Object.fromEntries(typeOp.inner.fields.map((f) => [f.name, f.value])) : {}
      // Süreli kayıt (RFC-0006 §14.3)
      if (Number.isInteger(tf._t) && Number.isInteger(tf._keep) && tf._keep > 0) {
        const k = effectiveKeep(tf._keep, st.type, confOf(tf), saklama)
        if (tf._t + k * DAY_MS < M) {
          for (const o of ops) n += r._purge(o)
          r.cleaned.set(cid + '|' + rid, 'hepsi')
          continue
        }
      }
      // Silinen kayıt (RFC-0001 §13)
      if (st.deletedAt && msOf(st.deletedAt.hlc) + YEAR_MS < M) {
        for (const o of ops) {
          if (o.inner.hlc >= st.deletedAt.hlc) continue
          if (b4a.equals(o.opId, st.deletedAt.opId) || (typeOp && o === typeOp)) continue
          n += r._purge(o)
        }
        // Tür işlemi temizlikten muaftır; sonraki sync onu silmesin (inceleme kayıt 5)
        r.cleaned.set(cid + '|' + rid, { hlc: st.deletedAt.hlc, opId: st.deletedAt.opId, typeOpId: typeOp ? typeOp.opId : null })
      }
    }
  }
  return n
}

module.exports = { temizle, saklamalar, effectiveKeep, YEAR_MS, DAY_MS }
