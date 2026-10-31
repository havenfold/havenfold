// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// worklet/messaging/seal.js — denetim zarfı ve Posta Kutusu mührü (KARARLAR K12)
//
//   denetim (ACK, READ, HOLD_DROP, CONV_CTRL; emanet ya da Posta Kutusu yolunda):
//     gövde = nonce(24) ‖ XChaCha20-Poly1305(derive(pair,'ctrl'), gövde, AD = gönderen(16) ‖ alıcı(16) ‖ tür(1) ‖ zarf id(16))
//   Posta Kutusu'na bırakılan her bayt dizisi:
//     nonce(24) ‖ XChaCha20-Poly1305(derive(pair,'mailbox-seal'), zarf, AD = gönderen(16) ‖ alıcı(16))
// Doğrudan oturumda (Noise, HELLO ile doğrulanmış) ek mühür gerekmez.
//
// v2.1 (RFC-0003 §6.4, RFC-0016 eki): topluluk içi bütün zarf türleri (0x80–0xFE) de emanet ve Posta Kutusu yolunda
// aynı biçimle mühürlenir. Anahtar görev türlerinde (0x90–0x97) derive(pair, 'hf/task/'), diğerlerinde
// derive(pair, 'ctrl'). Yalnız doğrudan oturumda (ya da yerel kanalda) geçerli tür emanetten gelirse atılır.
const sodium = require('sodium-native')
const b4a = require('b4a')
const { derive } = require('../crypto/kdf')

const NPUB = sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES
const ABYTES = sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES

// nonce yalnız vektör yolunda (sealEnvelopeVektor) verilir; üretim yolu her zaman rastgele
function aeadSeal (key, data, ad, nonce = null) {
  if (!nonce) {
    nonce = b4a.alloc(NPUB)
    sodium.randombytes_buf(nonce)
  }
  const out = b4a.alloc(data.byteLength + ABYTES)
  sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(out, data, ad, null, nonce, key)
  sodium.sodium_memzero(key)
  return b4a.concat([nonce, out])
}

function aeadOpen (key, box, ad, code) {
  try {
    if (box.byteLength < NPUB + ABYTES) throw new Error(code)
    const out = b4a.alloc(box.byteLength - NPUB - ABYTES)
    sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(out, null, box.subarray(NPUB), ad, box.subarray(0, NPUB), key)
    return out
  } catch {
    throw new Error(code)
  } finally {
    sodium.sodium_memzero(key)
  }
}

// İnceleme 2 D1: zarf id'si de AD'de (gövdesiz bir denetim türü eklenirse bile kopyalanamasın)
const ctrlAd = (senderId, receiverId, type, id) => b4a.concat([senderId, receiverId, b4a.from([type]), id])

function sealCtrl (pair, senderId, receiverId, type, body, id) {
  return aeadSeal(derive(pair, 'ctrl'), body, ctrlAd(senderId, receiverId, type, id))
}

function openCtrl (pair, senderId, receiverId, type, box, id) {
  return aeadOpen(derive(pair, 'ctrl'), box, ctrlAd(senderId, receiverId, type, id), 'UNSEALED_AUDIT')
}

function sealMailbox (pair, senderId, receiverId, bytes) {
  return aeadSeal(derive(pair, 'mailbox-seal'), bytes, b4a.concat([senderId, receiverId]))
}

function openMailbox (pair, senderId, receiverId, box) {
  return aeadOpen(derive(pair, 'mailbox-seal'), box, b4a.concat([senderId, receiverId]), 'POSTA_MUHRU')
}

// K12 türleri + topluluk içi bütün zarf türleri 0x80–0xFE
const CTRL_TYPES = new Set([0x21, 0x22, 0x25, 0x24]) // ACK, READ, HOLD_DROP, CONV_CTRL
for (let t = 0x80; t <= 0xfe; t++) CTRL_TYPES.add(t)

// Yalnız yerel kanalda geçerli: APP_PAIR_REQ, APP_PAIR_OK (RFC-0017 §6.2), APP_PAIR_REQ2 (RFC-0034 §4.6). Ağdan ya da
// emanetten gelirse atılır.
const DIRECT_ONLY = new Set([0xe8, 0xe9, 0xeb])

const isTaskType = (type) => type >= 0x90 && type <= 0x97
const envelopeKey = (pair, type) => derive(pair, isTaskType(type) ? 'hf/task/' : 'ctrl')

// Emanet ya da Posta Kutusu yolundan geçecek zarf gövdesi (nonce her zaman rastgele; fazladan argüman yok sayılır)
function sealEnvelope (pair, senderId, receiverId, type, body, id) {
  return sealEnvelopeVektor(pair, senderId, receiverId, type, body, id, null)
}

// Yalnız test vektörleri: sabit nonce
function sealEnvelopeVektor (pair, senderId, receiverId, type, body, id, nonce) {
  if (!CTRL_TYPES.has(type)) throw new Error('NO_SEAL_TYPE')
  if (DIRECT_ONLY.has(type)) throw new Error('DIRECT_ONLY')
  return aeadSeal(envelopeKey(pair, type), body, ctrlAd(senderId, receiverId, type, id), nonce)
}

function openEnvelope (pair, senderId, receiverId, type, box, id) {
  if (!CTRL_TYPES.has(type)) throw new Error('NO_SEAL_TYPE')
  if (DIRECT_ONLY.has(type)) throw new Error('DIRECT_ONLY')
  return aeadOpen(envelopeKey(pair, type), box, ctrlAd(senderId, receiverId, type, id), 'UNSEALED_AUDIT')
}

module.exports = { CTRL_TYPES, DIRECT_ONLY, sealCtrl, openCtrl, sealMailbox, openMailbox, sealEnvelope, sealEnvelopeVektor, openEnvelope }
