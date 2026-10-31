// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// app.js — kimliğin ve kişinin uygulaması (RFC-0036 §3)
//
// Her kimlik kendi uygulamasını Tüm Aile'ye kendi imzalı hf.uygulama kaydıyla bildirir (yazar sınıfı kendi, class.js).
// Kimliğin uygulaması: APP_ATTACH.appId (defter) varsa o; yoksa kendi kaydı (birden çok varsa son işlemi en büyük
// hlc'li olan); yoksa null (bilinmiyor). Pasif kimlik sayılmaz. Kişi için üç durum: var, yok, bilinmiyor.
const b4a = require('b4a')
const { v23: { tumAileOf } } = require('@havenfold/core')
const { view } = require('./merge')

const TUR = 'hf.uygulama'
const APP_RE = /^[a-z0-9-]{1,32}$/
const hex = (b) => b4a.toString(b, 'hex')

const appIdGecerli = (x) => typeof x === 'string' && APP_RE.test(x)
// yetenek (RFC-0037 §6.2): isteğe bağlı dize listesi; bozuk öğe yok sayılır, sıralı ve tekil
const yetenekOf = (x) => (Array.isArray(x) ? [...new Set(x.filter((y) => typeof y === 'string' && y.length && y.length <= 32))].sort() : [])

// Alan adı app_id: kayıt alan adları [a-z0-9_.] (RFC-0001 §4.1; RFC-0036 §3.2'deki appId bu kurala uymaz, İstek 178).
// Tüm Aile'deki kayıtlardan yazar (hex) → { appId, recordId, hlc }. Kendi sınıfı replika.durumlar'da uygulanır:
// başkasının işlemi ve _subj'i yazarından farklı kayıt buraya gelmez.
function kayitlar (replika) {
  const out = new Map()
  const cid = replika && tumAileOf(replika.ledger)
  if (!cid) return out
  for (const [rid, st] of replika.durumlar(cid)) {
    if (st.type !== TUR) continue
    const v = view(b4a.from(rid, 'hex'), st)
    if (!v || !appIdGecerli(v.fields.app_id)) continue
    const yazar = hex(st.typeStamp.authorId)
    const cur = out.get(yazar)
    if (!cur || st.lastPut.hlc > cur.hlc) out.set(yazar, { appId: v.fields.app_id, yetenek: yetenekOf(v.fields.yetenek), recordId: rid, hlc: st.lastPut.hlc })
  }
  return out
}

// Kimliğin uygulaması ya da null. harita: kayitlar()'ın sonucu
function kimlikUygulamasi (L, harita, id) {
  const m = L.members.get(id)
  if (!m || !m.active || m.role === 'kutu') return null
  if (m.appId) return m.appId // ek kimlikte defter geçerli; kayıt farklı diyorsa yok sayılır (§3.3 madde 5)
  return harita.get(id)?.appId || null
}

// Kimlik listesinden ([{ appId }]) bir ürün için durum (§3.3 madde 6)
function uygulamaDurumu (kimlikler, appId) {
  if (kimlikler.some((k) => k.appId === appId)) return 'var'
  return kimlikler.length && kimlikler.every((k) => k.appId !== null) ? 'yok' : 'bilinmiyor'
}

// Kimliğin kendi kaydı (§3.3 madde 1, 4): aktif üye (kutu değil, bekleyen değil) ve Tüm Aile'nin yazarıyken, kendi
// kaydı yoksa ya da appId farklıysa bir kez yazar. Tüm Aile anahtarı yoksa yazım replikanın kuyruğunda bekler; kuyrukta
// bekleyen yazım varken yeniden yazılmaz. Düzey 2.0 ailede (Tüm Aile yok) yazılmaz.
// Dönüş: 'yazildi' | 'var' (kayıt güncel) | 'kuyrukta' | null (yazamaz)
// yetenek (RFC-0037 §6.2): kimliğin bildirdiği yetenekler (ör. 'sos-alindi'); appId ya da yetenek farklıysa yeniden yazılır
function kendiKaydiniYaz (replika, appId, yetenek = []) {
  if (!appIdGecerli(appId)) return null
  yetenek = yetenekOf(yetenek)
  const L = replika.ledger
  const me = replika.meHex
  const m = L.members.get(me)
  if (!m || !m.active || m.role === 'kutu' || L.isPending(me)) return null
  const cid = tumAileOf(L)
  if (!cid || !replika.yetki.isWriter(cid, me, L.len - 1)) return null
  const cur = kayitlar(replika).get(me)
  const ayni = (x) => x.appId === appId && x.yetenek.join(',') === yetenek.join(',')
  if (cur && ayni(cur)) return 'var'
  if (replika.writeQueue.some((i) => i.cid === cid && (i.partial.type === TUR || (cur && hex(i.partial.recordId) === cur.recordId)))) return 'kuyrukta'
  // Yetenek alanı yalnız doluysa yazılır (D96 biçimiyle aynı kayıt); boşalırsa boş listeyle
  const alan = yetenek.length || (cur && cur.yetenek.length) ? { yetenek } : {}
  if (cur) replika.put(cid, cur.recordId, null, { app_id: appId, ...alan })
  else replika.put(cid, null, TUR, { _subj: 'uye:' + me, app_id: appId, ...alan })
  return 'yazildi'
}

// Kimliğin yetenekleri (ek kimlikte de kendi kaydından; RFC-0037 §6.2); kayıt yoksa null (bilinmiyor)
function kimlikYetenekleri (L, harita, id) {
  const m = L.members.get(id)
  if (!m || !m.active) return null
  const k = harita.get(id)
  return k ? k.yetenek : null
}

module.exports = { TUR, appIdGecerli, yetenekOf, kayitlar, kimlikUygulamasi, kimlikYetenekleri, uygulamaDurumu, kendiKaydiniYaz }
