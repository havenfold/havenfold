// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// delivery.js — kurulumda payın sahibine teslimi ve alındısı (RFC-0027 §1b, dell İstek 121; D31)
//
//   KASA_SHARE_PUT (0xF1) { share: KASA_SHARE, rootId: fixed16 }   rootId: YA'da sırrın sahibinin kök kimliği, KRA'da 16 sıfır
//   KASA_SHARE_ACK (0xF2) { secretId, version, holderId }
// Mesajlar çift kanalında gider; mühür çift sırrından (RFC-0003 §6.4), yalnız doğrudan oturum ya da emanet (Posta
// Kutusu'ndan gelirse MAILBOX_FORBIDDEN, giris.gelenZarf). Tutucu payı ancak kendisi için, ancak yetkili göndericiden
// alır: YA'da gönderen sırrın sahibidir (kök kimliği rootId), KRA'da kasa koleksiyonunun okuyucusu. Aynı (secretId,
// version, holderId) için aynı pay ikinci kez gelirse alındı yeniden verilir; aynı dağıtımdan (commit) farklı pay
// DUPLICATE_HOLDER. Aynı sürümde başka bir dağıtımın payı (eşzamanlı döndürme, RFC-0027 §9 e): commit'i küçük olan kazanır,
// büyük olan ROTATION_LOST. Göndericinin zincirinde 72 saat beklemesi süren bir değişim varsa pay alınmaz
// (BEKLEMEDE; inceleme 19 B1: beklemedeki yeni cihaz döndürmeyle sahibin paylarını sildiremez).
const c = require('compact-encoding')
const b4a = require('b4a')
const { kodlama: { struct, decodeCanonical } } = require('@havenfold/records')
const { kasaShare, decodeShare, encodeShare, rootIdOf, yaSecretId, TUR } = require('./share')
const { kasaOkuyuculari } = require('./threshold')
const { payOzeti } = require('./request')

const hex = (b) => (typeof b === 'string' ? b : b4a.toString(b, 'hex'))
function fail (code) { throw new Error(code) }

const Z = { KASA_SHARE_PUT: 0xf1, KASA_SHARE_ACK: 0xf2 }
const SIFIR16 = b4a.alloc(16)

const sharePut = struct([['share', kasaShare], ['rootId', c.fixed16]])
const shareAck = struct([['secretId', c.fixed16], ['version', c.uint], ['holderId', c.fixed16]])

// pay: KASA_SHARE nesnesi; rootId: YA'da sahibin kök kimliği (hex ya da bayt)
function payTeslimi (pay, rootId = null) {
  return c.encode(sharePut, { share: pay, rootId: pay.kind === TUR.YA ? b4a.from(hex(rootId), 'hex') : SIFIR16 })
}

function payTeslimiCoz (bytes) {
  const m = decodeCanonical(sharePut, bytes, 'INVALID_MESSAGE')
  decodeShare(encodeShare(m.share)) // payın kendi kuralları (eşik, x ≠ 0)
  if (m.share.kind === TUR.KRA && !b4a.equals(m.rootId, SIFIR16)) fail('INVALID_MESSAGE')
  return m
}

const alindi = (pay) => c.encode(shareAck, { secretId: pay.secretId, version: pay.version, holderId: pay.holderId })
const alindiCoz = (bytes) => decodeCanonical(shareAck, bytes, 'INVALID_MESSAGE')

// İki kimlik aynı kişi mi: ikisi de defterde bir kişiye çözülürse kişiler, yoksa (cihaz, kutu dışı kimlik) tam eşitlik.
// canonical() cihazda null döner; null === null iki ayrı cihazı aynı saymasın (inceleme 13 bulgu 5)
function ayniKimlik (L, a, b) {
  if (a === b) return true
  const ca = L.canonical(a)
  const cb = L.canonical(b)
  return !!ca && !!cb && ca === cb
}

// Gönderen bu sırrın payını dağıtmaya yetkili mi
function gonderenYetkili (L, fromHex, m) {
  const kisi = L.canonical(hex(fromHex))
  if (!kisi) return false
  if (m.share.kind === TUR.YA) {
    if (!b4a.equals(yaSecretId(L.familyId, m.rootId), m.share.secretId)) return false
    return rootIdOf(L, kisi) === hex(m.rootId) || rootIdOf(L, hex(fromHex)) === hex(m.rootId)
  }
  try { return kasaOkuyuculari(L, m.share.secretId).includes(kisi) } catch { return false }
}

// Tutucu tarafı: PayTutucu (request.js) ile. Dönüş: { durum: 'yeni' | 'tekrar' | 'degisti', alindi (bytes), share }
function teslimAl (tutucu, fromHex, bytes) {
  const L = tutucu.L
  const m = payTeslimiCoz(bytes)
  const holder = hex(m.share.holderId)
  if (!ayniKimlik(L, holder, tutucu.meHex)) fail('WRONG_HOLDER')
  if (!gonderenYetkili(L, fromHex, m)) fail('UNAUTHORIZED')
  if (typeof tutucu.bekleme === 'function' && tutucu.now() < tutucu.bekleme(hex(fromHex)).bitis) fail('ON_HOLD')
  const k = hex(m.share.secretId) + '|' + m.share.version
  const var_ = tutucu.paylar.get(k)
  // Bellekte yoksa (telefonda kasa kilitliyken paylar arşivdedir) pay dizini: aynı sürümde farklı pay yine reddedilir
  const ozet = tutucu.dizin ? tutucu.dizin.get(k) : undefined
  // Gelen tamponun kopyası: çağıranın baytları sonradan değişse de tutulan pay değişmez
  const kopya = () => ({ ...m.share, secretId: b4a.from(m.share.secretId), holderId: b4a.from(m.share.holderId), share: b4a.from(m.share.share), commit: b4a.from(m.share.commit) })
  const meta = m.share.kind === TUR.YA ? { rootId: hex(m.rootId) } : {}
  if (var_ || ozet !== undefined) {
    const ayni = var_ ? b4a.equals(var_.share.share, m.share.share) && b4a.equals(var_.share.commit, m.share.commit) : ozet === payOzeti(m.share)
    if (ayni) return { durum: 'tekrar', alindi: alindi(m.share), share: m.share }
    // Kilitliyken (yalnız dizin) commit karşılaştırılamaz; kilit açılınca yeniden gönderilir
    if (!var_ || b4a.equals(var_.share.commit, m.share.commit)) fail('DUPLICATE_HOLDER')
    if (b4a.compare(m.share.commit, var_.share.commit) > 0) fail('ROTATION_LOST')
    const share = kopya()
    tutucu.degistir({ share }, meta)
    return { durum: 'degisti', alindi: alindi(m.share), share }
  }
  const share = kopya()
  tutucu.ekle({ share }, meta)
  return { durum: 'yeni', alindi: alindi(m.share), share }
}

module.exports = { Z, sharePut, shareAck, payTeslimi, payTeslimiCoz, alindi, alindiCoz, gonderenYetkili, teslimAl, ayniKimlik }
