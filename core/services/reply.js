// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// reply.js — hizmetin cevabı (RFC-0010 §8.3) ve alıcı başlıkları (§13.1)
//
//   dh  = hashLP('hf/share-reply-dh/', X25519(hizmetEph, replyPub), ephPub, replyPub)
//   k   = deriveLP(dh, 'hf/share-reply-key/')
//   AD  = hashLP('hf/share-reply-ad/', packageId, u64be(n), ephPub)
//   ct  = XChaCha20-Poly1305(k, nonce, CEVAP_IC, AD)
//   CEVAP_IC.sig = Ed25519(hizmet signPub, hashLP('hf/share-reply/', packageId, u64be(n), CEVAP_IC baytları sig hariç))
//
//   x-hf-owner        = hex(hashLP('hf/share-owner/', ownerSecret))            (paket.sahipOzeti)
//   x-hf-owner-secret = hex(ownerSecret)
//   x-hf-auth         = hex(u64be(t) ‖ nonce(16) ‖ sig(64))
//                       sig = Ed25519(signPub, hashLP('hf/share-inbox/', serviceId, u64be(t), nonce, yöntem, yol))
// Alıcı x-hf-auth'u ±5 dakika kabul eder ve aynı nonce'u 10 dakika içinde ikinci kez kabul etmez (YetkiDefteri).
const sodium = require('sodium-native')
const b4a = require('b4a')
const { kdf: { hashLP, deriveLP, toBuf } } = require('@havenfold/core')
const K = require('./encoding')
const { imzala, dogrula } = require('./card')
const { x25519 } = require('./package')

const { ETIKET, SINIR, MB } = K
const ABYTES = sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES

function fail (kod) { throw new Error(kod) }
const rastgele = (n) => { const b = b4a.alloc(n); sodium.randombytes_buf(b); return b }

function anahtar (secret, pub, ephPub, replyPub) {
  const ortak = x25519(secret, pub)
  if (K.sifirMi(ortak)) fail('INVALID_KEY')
  const dh = hashLP(ETIKET.cevapDh, ortak, ephPub, replyPub)
  const k = deriveLP(dh, ETIKET.cevapKey)
  sodium.sodium_memzero(ortak)
  sodium.sodium_memzero(dh)
  return k
}

const adOf = (packageId, n, ephPub) => hashLP(ETIKET.cevapAd, packageId, n, ephPub)
const icOzeti = (packageId, n, govde) => hashLP(ETIKET.cevap, packageId, n, govde)

// §8.3 ve §16 sınırları
function icAlanlari (m) {
  if (!K.CEVAP_TURLERI.includes(m.kind) || K.bayt(m.text) > SINIR.cevapMetin || m.files.length > SINIR.cevapDosya) fail('REPLY_CORRUPT')
  if (m.files.reduce((a, f) => a + f.size, 0) > SINIR.cevapMB * MB) fail('SIZE_OVERRUN')
}

/**
 * Hizmet tarafı: cevabı kurar, imzalar ve paketin replyPub'ına şifreler.
 * { packageId, n, replyPub, signSecret, kind, text?, files?, at, ephSecret?, nonce? } → CEVAP baytları
 * ephSecret ve nonce yalnız vektör yolunda; kopya kullanılır ve sıfırlanır.
 */
function cevapKur ({ packageId, n, replyPub, signSecret, kind, text = '', files = [], at, ephSecret = null, nonce = null }) {
  if (!Number.isSafeInteger(n) || n < 0 || n >= SINIR.cevap) fail('REPLY_LIMIT')
  const m = { kind, text, files, at }
  icAlanlari(m)
  const govde = K.kodla(K.CEVAP_IC.govde, m, 'REPLY_CORRUPT')
  const ic = b4a.concat([govde, imzala(icOzeti(packageId, n, govde), signSecret)])
  const eph = ephSecret ? b4a.from(ephSecret) : rastgele(32)
  const ephPub = b4a.alloc(32)
  sodium.crypto_scalarmult_base(ephPub, eph)
  let k
  try { k = anahtar(eph, replyPub, ephPub, replyPub) } finally { sodium.sodium_memzero(eph) }
  const nn = nonce || rastgele(24)
  const ct = b4a.alloc(ic.byteLength + ABYTES)
  sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(ct, ic, adOf(packageId, n, ephPub), null, nn, k)
  sodium.sodium_memzero(k)
  return K.kodla(K.CEVAP, { packageId, n, ephPub, nonce: nn, ct }, 'REPLY_CORRUPT')
}

/** Alıcının gördüğü dış kabuk */
const cevapCoz = (bytes) => K.kanonik(K.CEVAP, bytes, 'REPLY_CORRUPT')

/**
 * Telefon tarafı (§8.3): replySecret ile açar, imzayı karttaki signPub ile doğrular. packageId paketinki olmalı.
 * Dönüş { n, kind, text, files, at }. Geçersiz cevap hata kodu verir ve atılır.
 */
function cevapAc (bytes, { packageId, replySecret, signPub }) {
  const c = cevapCoz(bytes)
  if (!b4a.equals(c.packageId, packageId)) fail('PACKAGE_MISMATCH')
  if (c.n >= SINIR.cevap) fail('REPLY_LIMIT')
  const replyPub = b4a.alloc(32)
  sodium.crypto_scalarmult_base(replyPub, replySecret)
  const k = anahtar(replySecret, c.ephPub, c.ephPub, replyPub)
  if (c.ct.byteLength < ABYTES) { sodium.sodium_memzero(k); fail('REPLY_OPEN_FAILED') }
  const ic = b4a.alloc(c.ct.byteLength - ABYTES)
  try { sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(ic, null, c.ct, adOf(c.packageId, c.n, c.ephPub), c.nonce, k) } catch { fail('REPLY_OPEN_FAILED') } finally { sodium.sodium_memzero(k) }
  const m = K.kanonik(K.CEVAP_IC.tam, ic, 'REPLY_CORRUPT')
  if (!dogrula(m.sig, icOzeti(c.packageId, c.n, ic.subarray(0, ic.byteLength - 64)), signPub)) fail('INVALID_SIGNATURE')
  icAlanlari(m)
  return { n: c.n, kind: m.kind, text: m.text, files: m.files, at: m.at }
}

const inboxOzeti = (serviceId, t, nonce, yontem, yol) => hashLP(ETIKET.inbox, serviceId, t, nonce, yontem, yol)

/** Hizmetin x-hf-auth başlığı (§13.1). nonce yalnız vektör yolunda */
function yetkiBasligi ({ serviceId, signSecret, t, yontem, yol, nonce = null }) {
  const nn = nonce || rastgele(16)
  const tb = toBuf(t)
  return K.hex(b4a.concat([tb, nn, imzala(inboxOzeti(serviceId, t, nn, yontem, yol), signSecret)]))
}

/** x-hf-auth çözümü: { t, nonce, sig } ya da NO_PERMISSION */
function yetkiCoz (s) {
  if (typeof s !== 'string' || !/^[0-9a-f]{176}$/.test(s)) fail('NO_PERMISSION')
  const b = b4a.from(s, 'hex')
  const t = Number(new DataView(b.buffer, b.byteOffset).getBigUint64(0))
  if (!Number.isSafeInteger(t)) fail('NO_PERMISSION')
  return { t, nonce: b.subarray(8, 24), sig: b.subarray(24) }
}

/**
 * Alıcının yetki denetimi: imza hizmetin signPub'ıyla, saat ±5 dakika, nonce tekrarı 10 dakika içinde reddedilir.
 * Nonce defteri bellek içidir; sınır dışı kayıtlar her denetimde düşer.
 */
class YetkiDefteri {
  constructor () { this.gorulen = new Map() } // serviceIdHex|nonceHex → t

  denetle ({ baslik, serviceId, signPub, yontem, yol, simdi }) {
    const { t, nonce, sig } = yetkiCoz(baslik)
    for (const [a, v] of this.gorulen) if (simdi - v > SINIR.nonceSure) this.gorulen.delete(a)
    if (Math.abs(simdi - t) > SINIR.saatPayi) fail('NO_PERMISSION')
    if (!dogrula(sig, inboxOzeti(serviceId, t, nonce, yontem, yol), signPub)) fail('NO_PERMISSION')
    const a = K.hex(serviceId) + '|' + K.hex(nonce)
    if (this.gorulen.has(a)) fail('NONCE_REPLAY')
    this.gorulen.set(a, simdi)
    return t
  }
}

/** x-hf-owner-secret başlığının çözümü */
function sahipSirri (s) {
  if (typeof s !== 'string' || !/^[0-9a-f]{64}$/.test(s)) fail('NO_OWNER')
  return b4a.from(s, 'hex')
}

module.exports = { cevapKur, cevapCoz, cevapAc, yetkiBasligi, yetkiCoz, YetkiDefteri, sahipSirri, adOf }
