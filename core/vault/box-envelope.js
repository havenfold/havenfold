// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// box-envelope.js — kasa zarfının kutudaki opak kopyası (RFC-0027 §9 g)
//
//   KASA_ENV_PUT (0xF3) { etiket: fixed32, zarf: buffer }        zarfı yazan okuyucu telefon → kutu
//   KASA_ENV_ACK (0xF4) { collectionId, version, envSeq }         kutu → telefon (kopya tutuluyor)
//   KASA_ENV_REQ (0xF5) { collectionId, etiket: fixed32 }         KRA'yı kurtaran telefon → kutu
//   KASA_ENV_RES (0xF6) { zarf: buffer }                          kutu → telefon
//   etiket = deriveLP(KRA, 'hf/kasa-zarf-etiket/', familyId, collectionId)   (RFC-0027 §8 b)
//
// Kutu zarfı açamaz (KRA'yı bilmez): yalnız açık başlığı (koleksiyon, sürüm, envSeq, son dönem, yazan) ve yazanın
// imzasını doğrular. Etiket KRA'dan tek yönlü türetilir; KRA olmadan üretilemez, KRA'yı da açığa çıkarmaz. Kutu zarfı
// yalnız doğru etiketle, kasanın bugünkü okuyucusuna ve hız sınırı içinde verir; yanlış etiket sessiz ret (null).
// Koleksiyon başına en büyük sürümün kopyaları tutulur; aynı etiketle daha küçük envSeq geri alınamaz (eski kopya
// geri konamaz: STALE_ENVELOPE), daha küçük sürüm STALE_VERSION. Mesajlar çift kanalında; Posta Kutusu'ndan gelmez.
const c = require('compact-encoding')
const b4a = require('b4a')
const sodium = require('sodium-native')
const { kdf: { deriveLP } } = require('@havenfold/core')
const { kodlama: { struct, decodeCanonical }, yetki: { readerSet } } = require('@havenfold/records')
const { zarfBody, digestOf } = require('./envelope')

const hex = (b) => (typeof b === 'string' ? b : b4a.toString(b, 'hex'))
function fail (code) { throw new Error(code) }

const Z = { KASA_ENV_PUT: 0xf3, KASA_ENV_ACK: 0xf4, KASA_ENV_REQ: 0xf5, KASA_ENV_RES: 0xf6 }
const MAX_ZARF = 256 * 1024
const COPY_LIMIT = 4 // koleksiyon başına (eşzamanlı döndürmede aynı sürümün iki KRA'sı olabilir)
const ISTEK_SINIRI = 10 // istekçi başına 24 saatte
const GUN_MS = 86_400_000

const envPut = struct([['etiket', c.fixed32], ['zarf', c.buffer]])
const envAck = struct([['collectionId', c.fixed16], ['version', c.uint], ['envSeq', c.uint]])
const envReq = struct([['collectionId', c.fixed16], ['etiket', c.fixed32]])
const envRes = struct([['zarf', c.buffer]])

function zarfEtiketi (kra, familyId, collectionId) {
  return deriveLP(kra, 'hf/kasa-zarf-etiket/', familyId, b4a.from(hex(collectionId), 'hex'))
}

// Zarfın açık başlığı ve imzası (açmadan). Dönüş: { m, body }
function baslik (bytes) {
  if (!b4a.isBuffer(bytes) || bytes.byteLength < 64 || bytes.byteLength > MAX_ZARF) fail('INVALID_ENVELOPE')
  const body = bytes.subarray(0, bytes.byteLength - 64)
  return { m: decodeCanonical(zarfBody, body, 'INVALID_ENVELOPE'), body, sig: bytes.subarray(bytes.byteLength - 64) }
}

const putCoz = (b) => { const m = decodeCanonical(envPut, b, 'INVALID_MESSAGE'); baslik(m.zarf); return m }
const ackCoz = (b) => decodeCanonical(envAck, b, 'INVALID_MESSAGE')
const reqCoz = (b) => decodeCanonical(envReq, b, 'INVALID_MESSAGE')
const resCoz = (b) => { const m = decodeCanonical(envRes, b, 'INVALID_MESSAGE'); baslik(m.zarf); return m }

const zarfGonder = (etiket, zarf) => c.encode(envPut, { etiket, zarf })
const zarfIste = (collectionId, etiket) => c.encode(envReq, { collectionId: b4a.from(hex(collectionId), 'hex'), etiket })

// Kasanın bugünkü okuyucusu mu (ek kimlik değil)
function okuyucu (L, cid, id) {
  const col = L.collections.get(cid)
  const m = L.members.get(id)
  return !!col && col.sensitivity === 'kasa' && !!m && !m.extra && L.sessionRole(id) === 'uye' && readerSet(L, col).has(id)
}

// Kutunun tuttuğu kopyalar. kopyalar: [{ cid, etiket, version, envSeq, sonDonem, zarf }] (hex; kalıcı, mühürlü
// dosyada). istekler bellektedir (hız sınırı; yeniden başlatmada sıfırlanır).
class ZarfKopyalari {
  constructor ({ ledger, now = Date.now, kopyalar = [] }) {
    this.L = ledger
    this.now = now
    this.kopyalar = kopyalar.filter((k) => k && typeof k.cid === 'string' && typeof k.etiket === 'string' && typeof k.zarf === 'string')
    this.istekler = new Map() // istekçi → [an]
  }

  // KASA_ENV_PUT: yazan, gönderen ve kasanın okuyucusu olmalı; imza doğrulanır. Dönüş: { durum: 'yeni' | 'tekrar',
  // alindi } ya da hata (YETKISIZ, INVALID_SIGNATURE, STALE_VERSION, STALE_ENVELOPE)
  al (fromHex, m) {
    const L = this.L
    const from = hex(fromHex)
    const { m: z, body, sig } = baslik(m.zarf)
    const cid = hex(z.collectionId)
    if (hex(z.writerId) !== from || !okuyucu(L, cid, from)) fail('UNAUTHORIZED')
    const w = L.members.get(from)
    if (!sodium.crypto_sign_verify_detached(sig, digestOf(L.familyId, body), w.signPub)) fail('INVALID_SIGNATURE')
    const alindi = c.encode(envAck, { collectionId: z.collectionId, version: z.version, envSeq: z.envSeq })
    const bu = this.kopyalar.filter((k) => k.cid === cid)
    if (bu.some((k) => k.version > z.version)) fail('STALE_VERSION')
    const etiket = hex(m.etiket)
    const ayni = bu.find((k) => k.etiket === etiket && k.version === z.version)
    if (ayni) {
      if (ayni.zarf === hex(m.zarf)) return { durum: 'tekrar', alindi }
      if (z.envSeq <= ayni.envSeq || z.lastEpochSeq < ayni.sonDonem) fail('STALE_ENVELOPE')
    }
    let kalan = this.kopyalar.filter((k) => k.cid !== cid || (k.version === z.version && k.etiket !== etiket))
    kalan.push({ cid, etiket, version: z.version, envSeq: z.envSeq, sonDonem: z.lastEpochSeq, zarf: hex(m.zarf) })
    const buKalan = kalan.filter((k) => k.cid === cid)
    if (buKalan.length > COPY_LIMIT) {
      const at = buKalan.sort((a, b) => a.envSeq - b.envSeq)[0]
      kalan = kalan.filter((k) => k !== at)
    }
    this.kopyalar = kalan
    return { durum: 'yeni', alindi }
  }

  // KASA_ENV_REQ: istekçi kasanın okuyucusu, hız sınırı içinde ve etiket doğru olmalı; yoksa sessiz ret (null).
  // Dönüş: KASA_ENV_RES baytları ya da null
  iste (fromHex, m) {
    const from = hex(fromHex)
    const now = this.now()
    const once = (this.istekler.get(from) || []).filter((a) => now - a < GUN_MS)
    if (once.length >= ISTEK_SINIRI) { this.istekler.set(from, once); return null }
    once.push(now)
    this.istekler.set(from, once)
    const cid = hex(m.collectionId)
    if (!okuyucu(this.L, cid, from)) return null
    const uygun = this.kopyalar.filter((k) => k.cid === cid && sodium.sodium_memcmp(b4a.from(k.etiket, 'hex'), m.etiket))
    const k = uygun.sort((a, b) => b.version - a.version || b.envSeq - a.envSeq)[0]
    return k ? c.encode(envRes, { zarf: b4a.from(k.zarf, 'hex') }) : null
  }

  // Tutulan kopyaların özeti (zarf baytı dönmez)
  liste () {
    const sira = (a, b) => (a.collectionId < b.collectionId ? -1 : a.collectionId > b.collectionId ? 1 : a.version - b.version || a.envSeq - b.envSeq)
    return this.kopyalar.map(({ cid, version, envSeq, sonDonem }) => ({ collectionId: cid, version, envSeq, sonDonem })).sort(sira)
  }
}

module.exports = { Z, MAX_ZARF, ISTEK_SINIRI, envPut, envAck, envReq, envRes, zarfEtiketi, baslik, putCoz, ackCoz, reqCoz, resCoz, zarfGonder, zarfIste, ZarfKopyalari }
