// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// merge.js — alan düzeyinde son yazan kazanır (RFC-0001 §5)
//
// Durum, geçerli işlemler kümesinin fonksiyonudur; uygulama sırası sonucu değiştirmez. Sıra: önce hlc, sonra
// authorId bayt sırası, sonra opId bayt sırası; büyük olan kazanır.
//
// Kayıt sahipliği (RFC-0019 §11.1 c): kaydın türünü yalnız recordId'yi üreten yazarın işlemi belirler:
//   put ile yeni kayıt:   recordId = hash('hf/rec-new/', authorId, recNonce)[0..16]
//   append-event:         recordId = hash('hf/rec-append/', authorId, u64be(hlc))[0..16]
// type, _t, _keep, _subj, _key ve _conf yalnız bu türü belirleyen işlemden alınır (§11.1 k); başka işlemlerdeki bu
// alanlar yok sayılır.
const b4a = require('b4a')
const { kdf: { hash } } = require('@havenfold/core')
const { OP, MAX_FIELDS } = require('./encoding')

const hex = (b) => b4a.toString(b, 'hex')
const SAHIP_ALANLARI = new Set(['_t', '_keep', '_subj', '_key', '_conf'])

const appendRecordId = (authorId, hlc) => hash('hf/rec-append/', authorId, hlc).subarray(0, 16)
const newRecordId = (authorId, nonce) => hash('hf/rec-new/', authorId, nonce).subarray(0, 16)

// İşlem kaydın sahibinin türü belirleyen işlemi mi
function sahipIslemi (inner) {
  if (inner.type === '') return false
  if (inner.op === OP.APPEND) return b4a.equals(appendRecordId(inner.authorId, inner.hlc), inner.recordId)
  if (inner.op === OP.PUT) return !!inner.recNonce && b4a.equals(newRecordId(inner.authorId, inner.recNonce), inner.recordId)
  return false
}

// a, b: { hlc, authorId, opId }
function cmp (a, b) {
  if (a.hlc !== b.hlc) return a.hlc < b.hlc ? -1 : 1
  const x = b4a.compare(a.authorId, b.authorId)
  if (x !== 0) return x
  return b4a.compare(a.opId, b.opId)
}

const stamp = (o) => ({ hlc: o.inner.hlc, authorId: o.inner.authorId, opId: o.opId })

// ops: aynı kayda ait geçerli işlemler [{ opId, inner }]. Dönüş: kayıt durumu.
function reduceRecord (ops) {
  let type = null
  let typeStamp = null
  for (const o of ops) {
    if (!sahipIslemi(o.inner)) continue
    const s = stamp(o)
    if (!typeStamp || cmp(s, typeStamp) < 0) { type = o.inner.type; typeStamp = s }
  }
  let deletedAt = null
  const fields = new Map() // ad → { value, hlc, authorId, opId, ilk }
  let lastPut = null
  for (const o of ops) {
    const s = stamp(o)
    if (o.inner.op === OP.DEL) {
      if (!deletedAt || cmp(s, deletedAt) > 0) deletedAt = s
      continue
    }
    if (!lastPut || cmp(s, lastPut) > 0) lastPut = s
    const turIslemi = typeStamp && b4a.equals(o.opId, typeStamp.opId)
    for (const f of o.inner.fields) {
      if (SAHIP_ALANLARI.has(f.name) && !turIslemi) continue
      const cur = fields.get(f.name)
      const ilk = cur && cmp(cur.ilk, s) < 0 ? cur.ilk : s
      if (!cur || cmp(s, cur) > 0) fields.set(f.name, { value: f.value, ...s, ilk })
      else cur.ilk = ilk
    }
  }
  return { type, typeStamp, deletedAt, fields, lastPut }
}

// Okuma görünümü: silinmiş kayıt, deletedAt'ten büyük bir put/append-event ile geri gelir; yalnız ondan sonraki
// alanlar görünür. Görünmüyorsa null. Kayıt başına en çok 256 alan: ilk yazılış sırasıyla ilk 256'sı (kodlama §4.1).
function view (recordId, st) {
  const live = !st.deletedAt || (st.lastPut && cmp(st.lastPut, st.deletedAt) > 0)
  if (!live || !st.lastPut) return null
  const adaylar = [...st.fields].filter(([, f]) => !st.deletedAt || cmp(f, st.deletedAt) > 0)
  if (adaylar.length > MAX_FIELDS) adaylar.sort(([, a], [, b]) => cmp(a.ilk, b.ilk)).splice(MAX_FIELDS)
  // Object.fromEntries: ad kendi alanı olur, prototipe atanmaz (__proto__ adı kodlamada da reddedilir)
  const fields = Object.fromEntries(adaylar.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([name, f]) => [name, f.value]))
  return { recordId: hex(recordId), type: st.type, fields }
}

// Bir koleksiyonun geçerli işlemlerinden bütün kayıtlar. uygun(o, type): türün yazar sınıfına uymayan işlem
// görünüme ve temizliğe katılmaz (RFC-0019 §11.1 l, class.js); tür işlemi de uymuyorsa kaydın türü yoktur.
// uygun(o, type, st): st, bütün işlemlerden çıkan durum (kendi sınıfı kaydın sahibini ondan bilir).
function reduceAll (ops, uygun = null) {
  const byRecord = new Map()
  for (const o of ops) {
    const k = hex(o.inner.recordId)
    if (!byRecord.has(k)) byRecord.set(k, [])
    byRecord.get(k).push(o)
  }
  const out = new Map()
  for (const [k, list] of byRecord) {
    const st = reduceRecord(list)
    out.set(k, uygun && st.type ? reduceRecord(list.filter((o) => uygun(o, st.type, st))) : st)
  }
  return out
}

module.exports = { SAHIP_ALANLARI, appendRecordId, newRecordId, sahipIslemi, cmp, stamp, reduceRecord, reduceAll, view }
