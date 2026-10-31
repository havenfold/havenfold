// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// card.js — hizmet kartı, hizmet dizini ve QR kartı (RFC-0010 §4, §5)
//
//   serviceId = hashLP('hf/service-id/', signPub)[0..16]
//   kart.sig  = Ed25519(signPub, hashLP('hf/service-card/', kart baytları sig hariç))
//   dizin.sig = Ed25519(dizin anahtarı, hashLP('hf/service-dir/', dizin baytları sig hariç))
//   QR        = 'HFH1:' + base32(kart ‖ hashLP('hf/service-card-qr/', kart)[0..4])   (alfanümerik QR kipi; açıklama 1 m. 8)
// Dizin anahtarları uygulamada sabittir (geçerli ve sıradaki, §5.1); bu paket onları parametre olarak alır.
const sodium = require('sodium-native')
const b4a = require('b4a')
const { kdf: { hashLP } } = require('@havenfold/core')
const K = require('./encoding')

const { ETIKET, SINIR, GUN_MS } = K
const QR_PREFIX = 'HFH1:'

function fail (kod) { throw new Error(kod) }

const serviceIdOf = (signPub) => hashLP(ETIKET.serviceId, signPub).subarray(0, 16)

function imzala (ozet, secretKey) {
  const sig = b4a.alloc(64)
  sodium.crypto_sign_detached(sig, ozet, secretKey)
  return sig
}
function dogrula (sig, ozet, pub) {
  try { return sodium.crypto_sign_verify_detached(sig, ozet, pub) } catch { return false }
}

// Kartın alan denetimi (imzadan bağımsız): bilinmeyen kategori, https olmayan uç ya da 25 MB'ı aşan maxMB bozuk sayılır
function kartAlanlari (m) {
  if (!K.KATEGORILER.includes(m.category)) fail('CARD_CORRUPT')
  if (!/^https:\/\/[^\s/]+/.test(m.endpoint)) fail('CARD_CORRUPT')
  if (!m.name || !m.region || m.maxMB < 1 || m.maxMB > SINIR.paketMB) fail('CARD_CORRUPT')
}

/** Hizmetin kendi kartını imzalaması: serviceId signPub'tan türetilir. Dönüş kart baytları */
function kartImzala (m, signSecret) {
  const signPub = b4a.from(signSecret.subarray(32))
  const k = { ...m, signPub, serviceId: serviceIdOf(signPub) }
  kartAlanlari(k)
  const govde = K.kodla(K.KART.govde, k, 'CARD_CORRUPT')
  return b4a.concat([govde, imzala(hashLP(ETIKET.kart, govde), signSecret)])
}

/** Kartı çözer ve doğrular: kanonik biçim, serviceId türetimi, alanlar, imza. Dönüş { ...kart, bytes } */
function kartCoz (bytes) {
  const m = K.kanonik(K.KART.tam, bytes, 'CARD_CORRUPT')
  if (!b4a.equals(m.serviceId, serviceIdOf(m.signPub))) fail('CARD_CORRUPT')
  kartAlanlari(m)
  if (!dogrula(m.sig, hashLP(ETIKET.kart, bytes.subarray(0, bytes.byteLength - 64)), m.signPub)) fail('INVALID_SIGNATURE')
  return { ...m, bytes }
}

// a kartı b'den yeni mi (açıklama 1 madde 2): büyük keyVersion, aynı sürümde büyük issuedAt
const yeniMi = (a, b) => a.keyVersion > b.keyVersion || (a.keyVersion === b.keyVersion && a.issuedAt > b.issuedAt)

/**
 * Aynı hizmetin iki kartından geçerli olanı (§4.1, §5.2; açıklama 1 madde 2): imza anahtarı aynı olmalı; büyük
 * keyVersion, aynı sürümde büyük issuedAt kazanır. Eskisi CARD_STALE ile reddedilir; aynı baytlar eskiyi bırakır.
 */
function kartSec (eski, yeni) {
  if (!eski) return yeni
  if (!b4a.equals(eski.signPub, yeni.signPub)) fail('SERVICE_MISMATCH')
  if (yeniMi(yeni, eski)) return yeni
  if (b4a.equals(yeni.bytes, eski.bytes)) return eski
  fail('CARD_STALE')
}

/** Hata vermeden en yeni kart (birleştirme: dizin ve topluluğun eklediği kartlar); imza anahtarı farklıysa a */
function enYeni (a, b) {
  if (!a) return b
  if (!b || !b4a.equals(a.signPub, b.signPub)) return a
  return yeniMi(b, a) ? b : a
}

/** Eser'in dizini imzalaması (dizin anahtarı çevrimdışı; araç ve vektör için) */
function dizinImzala (m, dizinSecret) {
  if (m.validUntil < m.issuedAt || m.validUntil > m.issuedAt + SINIR.dizinGun * GUN_MS) fail('INDEX_CORRUPT')
  const govde = K.kodla(K.DIZIN.govde, m, 'INDEX_CORRUPT')
  return b4a.concat([govde, imzala(hashLP(ETIKET.dizin, govde), dizinSecret)])
}

/**
 * Dizini çözer: imza uygulamanın bildiği dizin anahtarlarından biriyle; validUntil en çok 14 gün. Geçersiz kart (bilinmeyen
 * kategori, büyük maxMB, bozuk imza) yalnız kendisi atlanır, dizin düşmez (açıklama 1 madde 3); atlananlar `atlanan`da.
 * Aynı hizmetin iki kartından yenisi kalır. Tazelik burada denetlenmez (eski dizin okunur ve gösterilir).
 */
function dizinCoz (bytes, anahtarlar) {
  const m = K.kanonik(K.DIZIN.tam, bytes, 'INDEX_CORRUPT')
  const ozet = hashLP(ETIKET.dizin, bytes.subarray(0, bytes.byteLength - 64))
  if (!anahtarlar.some((pub) => dogrula(m.sig, ozet, pub))) fail('INVALID_SIGNATURE')
  if (m.validUntil < m.issuedAt || m.validUntil > m.issuedAt + SINIR.dizinGun * GUN_MS) fail('INDEX_CORRUPT')
  const kartlar = new Map()
  const atlanan = []
  m.cards.forEach((b, i) => {
    let k
    try { k = kartCoz(b) } catch (e) { atlanan.push({ sira: i, kod: e.message }); return }
    const id = K.hex(k.serviceId)
    kartlar.set(id, enYeni(kartlar.get(id), k))
  })
  return { version: m.version, region: m.region, issuedAt: m.issuedAt, validUntil: m.validUntil, kartlar, revoked: new Set(m.revoked.map(K.hex)), atlanan, bytes }
}

/** Yeni paylaşımdan önce (§5.1 Tazelik): validUntil geçmişse INDEX_STALE */
function dizinTaze (dizin, simdi) {
  if (!dizin || simdi > dizin.validUntil) fail('INDEX_STALE')
  return dizin
}

/**
 * Yeni paylaşım için hizmetin kartı (§5.1, §5.2; açıklama 1 madde 1 ve 2). dizinler: bilinen il dizinleri (eski de olabilir);
 * kart: topluluğun yüz yüze eklediği kart (yoksa null).
 * - Herhangi bir bilinen dizinin revoked listesindeki hizmet NOT_SERVICE_ELIGIBLE.
 * - Yüz yüze eklenmiş kart dizin istemez: dizin yokken ya da eskiyken de paylaşılır (ilke 9).
 * - Yalnız dizinden seçilen hizmet güncel dizin ister (INDEX_STALE).
 * - Şifreleme geçerli kartların en yenisine; rozet ('dizin') yalnız güncel bir dizinde varsa.
 * Dönüş { kart, trust: 'dizin' | 'yuz-yuze' }
 */
function hizmetKarti ({ dizinler = null, dizin = null, kart = null, serviceId = null, simdi }) {
  const hepsi = dizinler || (dizin ? [dizin] : [])
  const id = serviceId ? K.hex(serviceId) : kart ? K.hex(kart.serviceId) : fail('NO_SERVICE')
  if (hepsi.some((d) => d.revoked.has(id))) fail('NOT_SERVICE_ELIGIBLE')
  const taze = hepsi.filter((d) => simdi <= d.validUntil && d.kartlar.has(id)).map((d) => d.kartlar.get(id))
  const dk = taze.reduce(enYeni, null)
  if (!dk && !kart) fail(hepsi.some((d) => d.kartlar.has(id)) ? 'INDEX_STALE' : 'NO_SERVICE')
  return { kart: enYeni(dk, kart), trust: dk ? 'dizin' : 'yuz-yuze' }
}

/** QR kartı (§5.2) */
function qrKodla (kartBytes) {
  return QR_PREFIX + K.b32(b4a.concat([kartBytes, hashLP(ETIKET.qr, kartBytes).subarray(0, 4)]))
}

/** QR'ı çözer: önek, base32, sağlama, sonra kartCoz. Tek bayt değişince INVALID_QR ya da kartın kodu */
function qrCoz (s) {
  if (typeof s !== 'string' || !s.startsWith(QR_PREFIX)) fail('INVALID_QR')
  const b = K.b32Coz(s.slice(QR_PREFIX.length), 'INVALID_QR')
  if (b.byteLength <= 4) fail('INVALID_QR')
  const kart = b.subarray(0, b.byteLength - 4)
  if (!b4a.equals(b.subarray(b.byteLength - 4), hashLP(ETIKET.qr, kart).subarray(0, 4))) fail('INVALID_QR')
  return kartCoz(b4a.from(kart))
}

/**
 * Kart yurt dışını mı gösteriyor (§14): region il kodu 'TR-' ile başlamıyorsa. Uç adresinin nerede barındığı adından
 * anlaşılamaz; çekirdek yalnız kartın beyanına bakar, arayüz yurt dışı aktarım rızasını ayrıca sorar.
 */
const yurtDisi = (kart) => !kart.region.startsWith('TR-')

module.exports = { QR_PREFIX, serviceIdOf, imzala, dogrula, kartImzala, kartCoz, kartSec, enYeni, dizinImzala, dizinCoz, dizinTaze, hizmetKarti, qrKodla, qrCoz, yurtDisi }
