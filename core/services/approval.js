// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// approval.js — SHARE_CONSENT yorumu, iptal ve gizli onay (RFC-0010 §6, §12.1)
//
// Bu dosya defter doğrulamasına hiçbir koşul eklemez; yalnız yorum ekler (§6.4 "Yeni ret kuralı yoktur"): 2.1
// istemcilerinin kabul ettiği her SHARE_CONSENT defterde kalır, burada geçerli, geçersiz, iptal ya da yok sayılır.
//
//   service = 'hizmet:' + hex(serviceId)                         (32 hex)
//           | 'gizli:'  + hex(hashLP('hf/share-svc/', serviceId, salt))   (64 hex; kişisel kaynak, §6.3)
//   scope   = 'tek:<kategori>' | 'kural:<kategori>' | 'gizli' | 'iptal'
const b4a = require('b4a')
const sodium = require('sodium-native')
const { kdf: { hashLP }, ledger: { T }, encoding: { decodeBody } } = require('@havenfold/core')
const K = require('./encoding')
const { payloadHash } = require('./package')

const { ETIKET, SINIR, GUN_MS, hex } = K
const ZERO16 = b4a.alloc(16)
const ZERO32 = b4a.alloc(32)

function fail (kod) { throw new Error(kod) }

/** Gizli onayın taahhüdü (§6.3). salt rastgele 32 bayt; yalnız sahibin kişisel koleksiyonunda durur */
const gizliService = (serviceId, salt) => 'gizli:' + hex(hashLP(ETIKET.svc, serviceId, salt))
const tuzUret = () => { const b = b4a.alloc(32); sodium.randombytes_buf(b); return b }

/** service alanı: { tur: 'hizmet' | 'gizli', deger } ya da null (biçim bozuk) */
function serviceOf (s) {
  let m = /^hizmet:([0-9a-f]{32})$/.exec(s)
  if (m) return { tur: 'hizmet', deger: m[1] }
  m = /^gizli:([0-9a-f]{64})$/.exec(s)
  return m ? { tur: 'gizli', deger: m[1] } : null
}

/** scope alanı: { tur: 'tek' | 'kural' | 'gizli' | 'iptal', kategori } ya da null (bilinmeyen) */
function scopeOf (s) {
  if (s === 'gizli' || s === 'iptal') return { tur: s, kategori: null }
  const m = /^(tek|kural):([a-z]+)$/.exec(s)
  if (!m || !K.KATEGORILER.includes(m[2])) return null
  if (m[1] === 'kural' && !K.KURAL_KATEGORILERI.includes(m[2])) return null // §9.1
  return { tur: m[1], kategori: m[2] }
}

// Onayın biçimi (§6.4 kural 3): bilinmeyen scope, yanlış uzunlukta hex ya da kapsamla uyuşmayan service geçersizdir.
// gizli kapsam yalnız gizli service ile, tek ve kural yalnız açık service ile; kural paylaşımı gizli yapılamaz.
function bicimHatasi (b) {
  const sv = serviceOf(b.service)
  const sc = scopeOf(b.scope)
  if (!sv || !sc || sc.tur === 'iptal') return 'FORMAT_CORRUPT'
  if ((sc.tur === 'gizli') !== (sv.tur === 'gizli')) return 'FORMAT_CORRUPT'
  return null
}

// Defterdeki imzacı kimliklerinin bugün aktif bir ucu var mı (rotatedTo zinciri izlenir, RFC-0003 §5.13)
const aktifImzaci = (L, ids) => ids.some((id) => L.resolveMember(id) !== null)

/**
 * Defterdeki SHARE_CONSENT olaylarının yorumu (§6.4, §12.1). Dönüş Map shareIdHex → onay:
 *   { shareId, seq, ts, service, scope, tur, kategori, ownerId, expiresAt, payloadHash, imzacilar,
 *     durum: 'gecerli' | 'gecersiz' | 'iptal', neden: null | 'FORMAT_CORRUPT' | 'iptal' | 'imzaci-yok',
 *     iptal: { seq, imzacilar } | null, yokSayilan: [seq] }
 * 1. Bir shareId için ilk SHARE_CONSENT onaydır (ilk olay iptal kapsamlıysa onay geçersizdir).
 * 2. Aynı shareId, ownerId ve service ile, expiresAt 0 ve payloadHash sıfır olan ilk 'iptal' iptaldir; başka tekrarlar
 *    yok sayılır.
 * 3. Biçimi bozuk onay geçersizdir: onunla gönderim yapılmaz.
 * 4. Kural onayında imzacıların hiçbiri aktif değilse onay iptal sayılır.
 */
function onaylar (L) {
  const out = new Map()
  for (const e of L.events) {
    if (e.type !== T.SHARE_CONSENT) continue
    const b = decodeBody(T.SHARE_CONSENT, e.body)
    const id = hex(b.shareId)
    const imzacilar = e.sigs.map((s) => hex(s.memberId))
    const o = out.get(id)
    if (!o) {
      const sc = scopeOf(b.scope)
      const neden = bicimHatasi(b)
      out.set(id, {
        shareId: b.shareId, seq: e.seq, ts: e.ts, service: b.service, scope: b.scope, tur: sc && sc.tur, kategori: sc && sc.kategori,
        ownerId: b.ownerId, expiresAt: b.expiresAt, payloadHash: b.payloadHash, imzacilar,
        durum: neden ? 'gecersiz' : 'gecerli', neden, iptal: null, yokSayilan: []
      })
      continue
    }
    const iptalMi = b.scope === 'iptal' && b.expiresAt === 0 && b4a.equals(b.payloadHash, ZERO32) &&
      b4a.equals(b.ownerId, o.ownerId) && b.service === o.service
    if (iptalMi && !o.iptal) {
      o.iptal = { seq: e.seq, imzacilar }
      if (o.durum === 'gecerli') { o.durum = 'iptal'; o.neden = 'iptal' }
    } else o.yokSayilan.push(e.seq)
  }
  for (const o of out.values()) {
    if (o.durum === 'gecerli' && o.tur === 'kural' && !aktifImzaci(L, o.imzacilar)) { o.durum = 'iptal'; o.neden = 'imzaci-yok' }
  }
  return out
}

/**
 * Gönderim koşulu (§8.1 adım 4): onay geçerli ve iptal edilmemiş; payloadHash gövdenin özetine eşit; gönderenin
 * saatine göre expiresAt geçmemiş; onaydaki service bu hizmet (gizli onayda salt ile taahhüt tutmalı).
 * { onay, govdeBytes, serviceId, simdi, salt? } → onay; tutmazsa NO_APPROVAL, SUMMARY_MISMATCH, TERM_EXPIRED, SERVICE_MISMATCH
 */
function gonderimDenetle ({ onay, govdeBytes, serviceId, simdi, salt = null }) {
  if (!onay || onay.durum !== 'gecerli' || onay.tur === 'kural') fail('NO_APPROVAL')
  const beklenen = onay.tur === 'gizli' ? (salt ? gizliService(serviceId, salt) : null) : 'hizmet:' + hex(serviceId)
  if (onay.service !== beklenen) fail('SERVICE_MISMATCH')
  if (!b4a.equals(onay.payloadHash, payloadHash(govdeBytes))) fail('SUMMARY_MISMATCH')
  if (simdi > onay.expiresAt) fail('TERM_EXPIRED')
  return onay
}

/**
 * Yeni onayın SHARE_CONSENT gövdesi (§6.1). Yazan tarafın sınırları: tek ve gizli en çok 7, kural en çok 30 gün.
 * { shareId?, serviceId, tur: 'tek' | 'kural' | 'gizli', kategori, ownerId?, expiresAt, payloadHash, simdi, salt? }
 * Gizli onayda salt verilmezse üretilir; dönüş { govde, salt }. Gizli onay yalnız bir üyenin kendi verisinde.
 */
function onayGovdesi ({ shareId = null, serviceId, tur, kategori = null, ownerId = ZERO16, expiresAt, payloadHash: ph, simdi, salt = null }) {
  if (!SINIR.onayGun[tur]) fail('INVALID_COVERAGE')
  if (!(expiresAt > simdi) || expiresAt > simdi + SINIR.onayGun[tur] * GUN_MS) fail('INVALID_DURATION')
  if (!b4a.isBuffer(ph) || ph.byteLength !== 32) fail('INVALID_SUMMARY')
  let service = 'hizmet:' + hex(serviceId)
  let scope = tur + ':' + kategori
  if (tur === 'gizli') {
    if (b4a.equals(ownerId, ZERO16)) fail('INVALID_COVERAGE') // ortak veri gizli paylaşılmaz
    salt = salt || tuzUret()
    service = gizliService(serviceId, salt)
    scope = 'gizli'
  } else salt = null
  if (!shareId) { shareId = b4a.alloc(16); sodium.randombytes_buf(shareId) }
  const govde = { shareId, service, scope, ownerId, expiresAt, payloadHash: ph }
  if (bicimHatasi(govde)) fail('INVALID_COVERAGE')
  return { govde, salt }
}

/** İptal (§12.1): aynı shareId, ownerId ve service; scope 'iptal', expiresAt 0, payloadHash sıfır */
function iptalGovdesi (onay) {
  return { shareId: onay.shareId, service: onay.service, scope: 'iptal', ownerId: onay.ownerId, expiresAt: 0, payloadHash: ZERO32 }
}

/**
 * Denetim kayıtlarının yeri (§10.1, §10.3): gizli onayın kayıtları (salt dahil) sahibin kişisel koleksiyonuna,
 * diğerleri Paylaşımlar koleksiyonuna. { onay, paylasimlar, kisisel } → koleksiyon kimliği
 */
function kayitYeri ({ onay, paylasimlar, kisisel }) {
  if (onay.tur === 'gizli') return kisisel || fail('NO_PERSONAL')
  return paylasimlar || fail('NO_SHARES')
}

const BASLATAN_ROLLER = ['ebeveyn', 'yetiskin', 'sahip', 'yonetici'] // çocuk, geçici ve misafir başlatamaz (§6.2)

/**
 * Başlatan ve kaynak koleksiyonlar (§6.2, §6.3; vektör 14). benId: başlatanın kimliği (hex). Kaynak koleksiyonun okuyucusu
 * olmak ayrıca denetlenir (SDK, replikanın yetkisiyle). Dönüş { tur: 'tek' | 'gizli', ownerId, kisisel }
 * - Çocuk, geçici ve misafir başlatamaz (NO_PERMISSION).
 * - Çocuğun kişisel koleksiyonundan paylaşım yok (CHILD_PERSONAL): ebeveyn onayı ergenin kişisel alanını delerdi.
 * - Kişisel kaynak yalnız sahibinindir; veri onundur ve onay gizlidir. Ortak veriyle karışmaz (MIXED_SOURCE).
 */
function kaynakDenetle (L, benId, collectionIds, ownerId = null) {
  const ben = benId && L.canonical(benId)
  if (!ben || !BASLATAN_ROLLER.includes(L.members.get(ben).role)) fail('NO_PERMISSION')
  if (!Array.isArray(collectionIds) || !collectionIds.length) fail('SOURCE_REQUIRED')
  let kisisel = null
  for (const id of collectionIds) {
    const col = L.collections.get(typeof id === 'string' ? id : hex(id))
    if (!col) fail('NO_COLLECTION')
    if (col.kind !== 'kisisel') continue
    const sahipler = col.readers.filter((r) => r.startsWith('uye:')).map((r) => L.canonical(r.slice(4))).filter(Boolean)
    if (sahipler.some((x) => L.members.get(x).role === 'cocuk')) fail('CHILD_PERSONAL')
    if (!sahipler.includes(ben)) fail('NO_PERMISSION')
    kisisel = col.id
  }
  if (kisisel && collectionIds.length > 1) fail('MIXED_SOURCE')
  if (kisisel) return { tur: 'gizli', ownerId: b4a.from(ben, 'hex'), kisisel }
  return { tur: 'tek', ownerId: ownerId ? (typeof ownerId === 'string' ? b4a.from(ownerId, 'hex') : ownerId) : ZERO16, kisisel: null }
}

module.exports = { BASLATAN_ROLLER, kaynakDenetle, gizliService, serviceOf, scopeOf, onaylar, gonderimDenetle, onayGovdesi, iptalGovdesi, kayitYeri }
