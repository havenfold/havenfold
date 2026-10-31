// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// status.js — görünür izleme UC_STATUS (RFC-0008 §11.6)
//
// Uç kamera açılınca, kapanınca, alıcı değişince ve 15 dakikada bir bütün aktif ebeveyn ve yetişkin üyelere gönderir.
// Bu, ilke 7'yi ("yetişkin gizlice izlenemez") uç kamerada sağlayan üç işaretten biridir; telefon son durumu saklar ve
// arayüz "Kamera açık: <uç> → <alıcılar>" satırını kapatılamaz biçimde gösterir.
const K = require('./encoding')

const { hex, fail } = K
const DURUM_ARALIK_MS = 15 * 60_000
// Son bildirimden bu yana bu kadar geçtiyse çevrimdışı sayılır (15 dakikalık aralık + 5 dakika gecikme payı)
const CEVRIMDISI_MS = 20 * 60_000

// signer: ucun kimliği { memberId, signKeyPair }
// Sensör alanları (açıklama 2 madde 1) yalnız sensör modunda dolu; verilmezse boş
const durumKodla = (familyId, m, signer) => K.imzaliKodla(K.durumGovde, K.durumDenetle, K.ETIKET.UC_STATUS, familyId, { sensors: [], sensorTargets: [], ...m }, signer.signKeyPair.secretKey)
const durumCoz = (buf) => K.imzaliCoz(K.durumGovde, buf, K.durumDenetle)

// Durumu kimler alır: aktif ebeveyn ve yetişkin üyeler (ek kimlikler dahil, kutu ve çocuk hariç)
function durumAlicilari (L) {
  return L.phoneIds().filter((id) => ['ebeveyn', 'yetiskin'].includes(L.members.get(id).role)).sort()
}

// Uç ne zaman gönderir: değişince (mod, kamera açık/kapalı, alıcılar, ısı) ya da 15 dakika geçince
function gondermeli (onceki, simdiki, sonGonderim, now) {
  if (!onceki || sonGonderim === null || now - sonGonderim >= DURUM_ARALIK_MS) return true
  const alicilar = (x) => x.camera.streams.map((s) => hex(s.toId) + '/' + s.purpose).sort().join(',')
  return onceki.mode !== simdiki.mode || onceki.camera.active !== simdiki.camera.active || alicilar(onceki) !== alicilar(simdiki) ||
    onceki.thermal !== simdiki.thermal || onceki.configSeq !== simdiki.configSeq || onceki.yenidenBasladi !== simdiki.yenidenBasladi
}

class DurumDefteri {
  constructor ({ ledger, now = Date.now }) {
    this.ledger = ledger
    this.now = now
    this.son = new Map() // ucHex → durum
    this.alinan = new Map() // ucHex → alınma anı
  }

  // Gönderen defterde aktif uç olmalı; seq yalnız büyür
  al (bytes, { from = null } = {}) {
    const { m, body, sig } = durumCoz(bytes)
    const id = hex(m.ucId)
    if (from !== null && from !== id) fail('UNAUTHORIZED')
    const d = this.ledger.devices.get(id)
    if (!d || !d.active || d.class !== 'uc') fail('UNAUTHORIZED')
    if (!K.imzaGecerli(K.ETIKET.UC_STATUS, this.ledger.familyId, body, sig, d.signPub)) fail('INVALID_SIGNATURE')
    const prev = this.son.get(id)
    if (prev && m.seq <= prev.seq) fail('STALE_MANIFEST')
    this.son.set(id, m)
    this.alinan.set(id, this.now())
    return m
  }

  // Son durumun alınma anı (çevrimdışılık: now − alinma > CEVRIMDISI_MS)
  alinma (ucHex) { return this.alinan.get(ucHex) ?? null }

  get (ucHex) {
    const d = this.ledger.devices.get(ucHex)
    return d && d.active ? this.son.get(ucHex) || null : null
  }

  // Kamerası açık uçlar ve alıcıları (Yuva Hat'taki sürekli satır)
  acikKameralar () {
    return [...this.son.keys()].map((id) => ({ ucId: id, durum: this.get(id) }))
      .filter((x) => x.durum && x.durum.camera.active)
      .map((x) => ({ ucId: x.ucId, alicilar: x.durum.camera.streams.map((s) => ({ toId: hex(s.toId), purpose: s.purpose })), since: x.durum.camera.since }))
      .sort((a, b) => (a.ucId < b.ucId ? -1 : 1))
  }
}

module.exports = { DURUM_ARALIK_MS, CEVRIMDISI_MS, durumKodla, durumCoz, durumAlicilari, gondermeli, DurumDefteri }
