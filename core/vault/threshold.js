// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// threshold.js — pay sahipleri ve eşik (RFC-0004 §3; RFC-0017 §4.3: ek kimlik pay tutmaz)
//
// Kişi tarafı: ailede ebeveyn ve yetişkin, ekipte sahip, yönetici ve çalışan (RFC-0005 §5.1, §14; geçici değil) rolündeki
// aktif, bekleyen olmayan ana kimlikler (çocuk, misafir, ek kimlik değil)
// ve ev dışı kâğıt paylar (en çok 2). Cihaz tarafı: kutu ve TPM'li işçiler; yalnız TPM mührü doğrulanmış Linux
// konteyner düğümü (bu bilgi kurulumdan gelir, defterde yoktur; uygunCihaz ile verilir).
const b4a = require('b4a')
const { yetki: { readerSet } } = require('@havenfold/records')

const hexCmp = (a, b) => b4a.compare(b4a.from(a, 'hex'), b4a.from(b, 'hex'))
const MAX_KAGIT = 2

const PAY_ROLLERI = { aile: ['ebeveyn', 'yetiskin'], ekip: ['sahip', 'yonetici', 'calisan'] }

// Kişi payı tutabilecek kimlikler (ana kimlik, memberId sırasıyla). haric: sırrın sahibi. Roller defterin türüne göre
// (Codex 9. tur: ekipte kişi adayı hiç çıkmıyordu)
function kisiAdaylari (L, { haric = null } = {}) {
  const h = haric ? L.canonical(haric) : null
  const roller = PAY_ROLLERI[L.kind === 'ekip' ? 'ekip' : 'aile']
  return L.personIds().filter((id) => roller.includes(L.members.get(id).role) && id !== h).sort(hexCmp)
}

// Cihaz adayları, öncelik sırasıyla: kutu, sonra TPM'li işçiler (deviceId sırası). uygunCihaz(id) → bool
function cihazAdaylari (L, uygunCihaz = () => false) {
  const kutular = L.boxIds().filter(uygunCihaz).sort(hexCmp)
  const isciler = L.activeDeviceIds().filter((id) => L.devices.get(id).class === 'isci' && uygunCihaz(id)).sort(hexCmp)
  return [...kutular, ...isciler]
}

const esikOf = (p) => (p <= 3 ? 2 : 3)

// §3.2: t yalnız kişi sayısından; D = min(|Dc|, t − 2); koşul |P| ≥ t
function yaEsik (P, Dc) {
  const t = esikOf(P)
  const D = Math.min(Dc, t - 2)
  const kurulur = P >= t
  return { t, D, n: P + D, kurulur, neden: kurulur ? null : 'PERSON_SHARE_INSUFFICIENT' }
}

// §3.3: D = min(|Dc|, t − 1); koşul |P| ≥ 1 ve |P| − 1 + D ≥ t
function kraEsik (P, Dc) {
  const t = esikOf(P)
  const D = Math.min(Dc, t - 1)
  const kurulur = P >= 1 && P - 1 + D >= t
  return { t, D, n: P + D, kurulur, neden: kurulur ? null : 'NOT_RECOVERABLE_ON_LOST_PHONE' }
}

// YA dağıtımı. kisiler: sahibin seçtiği kişi kimlikleri; kagit: ev dışı kâğıt sayısı.
// Dönüş: { t, D, n, kurulur, sahipler: [{ tur: 'kisi'|'kagit'|'cihaz', id }] }
function yaDagitim (L, { sahip, kisiler, kagit = 1, uygunCihaz }) {
  if (kagit > MAX_KAGIT || kagit < 0) throw new Error('PAPER_LIMIT')
  const uygun = new Set(kisiAdaylari(L, { haric: sahip }))
  for (const k of kisiler) if (!uygun.has(L.canonical(k) || k)) throw new Error('NOT_SHARE_OWNER_ELIGIBLE')
  const kisi = [...new Set(kisiler.map((k) => L.canonical(k)))].sort(hexCmp)
  const dc = cihazAdaylari(L, uygunCihaz)
  const e = yaEsik(kisi.length + kagit, dc.length)
  return { ...e, sahipler: sahiplerOf(kisi, kagit, dc.slice(0, e.D)) }
}

// Kasa koleksiyonunun okuyucusu olan kişiler (ana kimlik), defterden (inceleme kasa 10)
function kasaOkuyuculari (L, collectionId) {
  const col = L.collections.get(typeof collectionId === 'string' ? collectionId : b4a.toString(collectionId, 'hex'))
  if (!col || col.sensitivity !== 'kasa') throw new Error('NO_COLLECTION')
  return [...new Set([...readerSet(L, col).keys()].map((id) => L.canonical(id)).filter(Boolean))]
}

// KRA dağıtımı: kasa koleksiyonunun okuyucusu olan kişi kimlikleri (okuyucu olmayan yetişkin pay tutmaz)
function kraDagitim (L, { collectionId, kagit = 0, uygunCihaz }) {
  if (kagit > MAX_KAGIT || kagit < 0) throw new Error('PAPER_LIMIT')
  const uygun = new Set(kisiAdaylari(L))
  const kisi = kasaOkuyuculari(L, collectionId).filter((k) => uygun.has(k)).sort(hexCmp)
  const dc = cihazAdaylari(L, uygunCihaz)
  const e = kraEsik(kisi.length + kagit, dc.length)
  return { ...e, sahipler: sahiplerOf(kisi, kagit, dc.slice(0, e.D)) }
}

function sahiplerOf (kisi, kagit, cihaz) {
  return [
    ...kisi.map((id) => ({ tur: 'kisi', id })),
    ...Array.from({ length: kagit }, (_, i) => ({ tur: 'kagit', id: kagitId(i + 1) })),
    ...cihaz.map((id) => ({ tur: 'cihaz', id }))
  ]
}

// Kâğıt pay sahibi kimliği: 0xFF × 15 ‖ kâğıt sırası
const kagitId = (sira) => b4a.toString(b4a.concat([b4a.alloc(15, 0xff), b4a.from([sira])]), 'hex')

// Döndürme gerekli mi (§6): bugünkü pay sahiplerinden biri artık uygun değilse. collectionId verilirse (KRA)
// okuyucular defterden hesaplanır; okuyucusu çıkan kişi de döndürme gerektirir (inceleme kasa 17).
function dondurmeGerekli (L, sahipler, { uygunCihaz = () => false, collectionId = null } = {}) {
  const kisi = new Set(kisiAdaylari(L))
  const oku = collectionId ? new Set(kasaOkuyuculari(L, collectionId)) : null
  for (const s of sahipler) {
    if (s.tur === 'kagit') continue
    if (s.tur === 'kisi' && (!kisi.has(s.id) || (oku && !oku.has(s.id)))) return true
    if (s.tur === 'cihaz' && !cihazAdaylari(L, uygunCihaz).includes(s.id)) return true
  }
  return false
}

module.exports = { MAX_KAGIT, kasaOkuyuculari, kisiAdaylari, cihazAdaylari, esikOf, yaEsik, kraEsik, yaDagitim, kraDagitim, kagitId, dondurmeGerekli }
