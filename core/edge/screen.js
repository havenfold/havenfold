// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// screen.js — ekran modu UC_SCREEN_PUSH (0xE5, RFC-0008 §11.8; §17 adım 9)
//
// Uç koleksiyon anahtarı almaz (kurucu belge §7.4): ekranda gösterilecek her şeyi bir üye kendisi seçerek gönderir.
//
//   body = ucId ‖ fromId ‖ seq ‖ cards (sig dışındaki alanlar)
//   sig  = Ed25519(gönderen üye, hashLP('hf/uc-screen/', familyId, body))
//
// Uç denetler: zarf en çok 32 KB, en çok 12 kart; gönderen aktif üye, çocuk değil ve `UC_CONFIG.screenFrom` ile eşleşir
// (`uye:<id>` ya da `rol:ebeveyn` / `rol:yetiskin`); uç `ekran` modunda. Uymayan atılır. Aynı gönderenden yalnız daha büyük
// `seq` kabul edilir (açıklama 1 madde 2: seq tabanı kalıcıdır, kartlar yalnız bellekte; edge.js).
const b4a = require('b4a')
const c = require('compact-encoding')
const K = require('./encoding')
const { struct } = require('@havenfold/records').kodlama

const { hex, fail } = K
const ETIKET = K.ETIKET.UC_SCREEN
const EN_COK_BAYT = 32 * 1024
const EN_COK_KART = 12
// Telefon gönderirken gösterir (§11.8)
const UYARI = 'Bu kart evdeki ekranda, odadaki herkesin göreceği şekilde gösterilecek.'

const kart = struct([['id', c.string], ['title', c.string], ['lines', c.array(c.string)], ['until', c.uint]])
const ekranGovde = struct([['ucId', c.fixed16], ['fromId', c.fixed16], ['seq', c.uint], ['cards', c.array(kart)]])

function ekranDenetle (m) {
  if (m.cards.length > EN_COK_KART) fail('CARD_COUNT')
  if (new Set(m.cards.map((x) => x.id)).size !== m.cards.length) fail('INVALID_MESSAGE')
  if (m.cards.some((x) => !x.id || !x.until)) fail('INVALID_MESSAGE')
  return m
}

/** Üye kartları kodlar ve imzalar. signer: üyenin kimliği { memberId, signKeyPair }. Zarf 32 KB'ı geçerse TOO_LARGE */
function ekranKodla (familyId, m, signer) {
  const bytes = K.imzaliKodla(ekranGovde, ekranDenetle, ETIKET, familyId, { ...m, fromId: signer.memberId }, signer.signKeyPair.secretKey)
  if (bytes.byteLength > EN_COK_BAYT) fail('TOO_LARGE')
  return bytes
}

function ekranCoz (buf) {
  if (b4a.isBuffer(buf) && buf.byteLength > EN_COK_BAYT) fail('TOO_LARGE') // çözmeden atılır
  return K.imzaliCoz(ekranGovde, buf, ekranDenetle)
}

/** Gönderen screenFrom'a uyar mı: `uye:<id>` (kişinin herhangi bir kimliği, RFC-0017 §5) ya da rolü; çocuk hiçbir zaman */
function kaynakUyar (L, screenFrom, fromHex) {
  const m = L.members.get(fromHex)
  if (!m || !m.active || L.sessionRole(fromHex) !== 'uye' || !['ebeveyn', 'yetiskin'].includes(m.role)) return false
  const kisi = L.canonical(fromHex)
  return screenFrom.some((s) => s === 'rol:' + m.role || (s.startsWith('uye:') && L.canonical(s.slice(4)) === kisi))
}

/**
 * Uçta denetim (§11.8). ucHex: ucun kimliği; cfg: geçerli yapılandırmanın gövdesi (yoksa null); from: doğrudan oturumda
 * gönderen (emanette null). Dönüş { m } ya da atılma kodu atılır: TOO_LARGE, CARD_COUNT, INVALID_MESSAGE, WRONG_EDGE,
 * UNAUTHORIZED, INVALID_SIGNATURE, NOT_MODE_SCREEN, SOURCE_NOT_ALLOWED
 */
function ekranAlDenetle (L, bytes, { ucHex, cfg, from = null }) {
  const { m, body, sig } = ekranCoz(bytes)
  if (hex(m.ucId) !== ucHex) fail('WRONG_EDGE')
  const fromHex = hex(m.fromId)
  if (from !== null && from !== fromHex) fail('UNAUTHORIZED')
  const uye = L.members.get(fromHex)
  if (!uye) fail('UNAUTHORIZED')
  if (!K.imzaGecerli(ETIKET, L.familyId, body, sig, uye.signPub)) fail('INVALID_SIGNATURE')
  if (!cfg || cfg.mode !== 'ekran') fail('NOT_MODE_SCREEN')
  if (!kaynakUyar(L, cfg.screenFrom, fromHex)) fail('SOURCE_NOT_ALLOWED')
  return { m }
}

module.exports = { ETIKET, EN_COK_BAYT, EN_COK_KART, UYARI, ekranGovde, ekranKodla, ekranCoz, ekranAlDenetle, kaynakUyar }
