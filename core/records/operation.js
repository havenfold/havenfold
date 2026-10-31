// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// operation.js — REC_OP şifreleme, opId ve imza (RFC-0001 §4.3)
//
//   AD   = hash('hf/rec-ad/', familyId, collectionId, u64be(epochSeq), keyId)
//   ct   = XChaCha20-Poly1305(epochKey, nonce, encode(OpInner), AD)
//   opId = hash('hf/rec-op/', collectionId, u64be(epochSeq), keyId, nonce, ct)
//   sig  = Ed25519(yazar, hash('hf/rec-op-sig/', familyId, opId))
// Alıcı önce çözer, sonra iç authorId'nin anahtarıyla imzayı doğrular.
const c = require('compact-encoding')
const b4a = require('b4a')
const sodium = require('sodium-native')
const { kdf: { hash } } = require('@havenfold/core')
const { recOp, encodeInner, decodeInner, decodeRecOp, MAX_OP_BYTES } = require('./encoding')

const NPUB = sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES
const ABYTES = sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES
function fail (code) { throw new Error(code) }

const keyIdOf = (key) => hash('hf/rec-epoch/', key)
const adOf = (familyId, collectionId, epochSeq, keyId) => hash('hf/rec-ad/', familyId, collectionId, epochSeq, keyId)
const opIdOf = (w) => hash('hf/rec-op/', w.collectionId, w.epochSeq, w.keyId, w.nonce, w.ct)
const sigDigest = (familyId, opId) => hash('hf/rec-op-sig/', familyId, opId)

function sign (digest, secretKey) {
  const sig = b4a.alloc(64)
  sodium.crypto_sign_detached(sig, digest, secretKey)
  return sig
}

// signer: { signKeyPair }. Nonce her zaman rastgele (üretim yolu dışarıdan değer almaz).
function sealOp ({ familyId, collectionId, epochSeq, key, inner, signer }) {
  const nonce = b4a.alloc(NPUB)
  sodium.randombytes_buf(nonce)
  return seal({ familyId, collectionId, epochSeq, key, inner, signer, nonce })
}

// Yalnız test vektörleri: sabit nonce
function sealOpVektor ({ nonce = null, ...o }) {
  if (!nonce) { nonce = b4a.alloc(NPUB); sodium.randombytes_buf(nonce) }
  return seal({ ...o, nonce })
}

function seal ({ familyId, collectionId, epochSeq, key, inner, signer, nonce }) {
  const keyId = keyIdOf(key)
  const pt = encodeInner(inner)
  const ct = b4a.alloc(pt.byteLength + ABYTES)
  sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(ct, pt, adOf(familyId, collectionId, epochSeq, keyId), null, nonce, key)
  const w = { collectionId, epochSeq, keyId, nonce, ct, sig: null }
  const opId = opIdOf(w)
  w.sig = sign(sigDigest(familyId, opId), signer.signKeyPair.secretKey)
  const bytes = c.encode(recOp, w)
  if (bytes.byteLength > MAX_OP_BYTES) fail('OPERATION_TOO_LARGE')
  return bytes
}

// Anahtarsız: kutu ve eşitleme opId'yi ve başlığı görür
function peekOp (bytes) {
  const w = decodeRecOp(bytes)
  return { wire: w, opId: opIdOf(w) }
}

// Anahtarla çöz: { inner } ya da hata. İmza burada doğrulanmaz (yazarın anahtarı defterden gelir).
function openOp (w, familyId, key) {
  if (w.ct.byteLength < ABYTES) fail('DECRYPT_FAILED')
  const pt = b4a.alloc(w.ct.byteLength - ABYTES)
  try {
    sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(pt, null, w.ct, adOf(familyId, w.collectionId, w.epochSeq, w.keyId), w.nonce, key)
  } catch { fail('DECRYPT_FAILED') }
  return decodeInner(pt)
}

const verifyOpSig = (familyId, opId, sig, signPub) => sodium.crypto_sign_verify_detached(sig, sigDigest(familyId, opId), signPub)

module.exports = { keyIdOf, adOf, opIdOf, sigDigest, sign, sealOp, sealOpVektor, peekOp, openOp, verifyOpSig }
