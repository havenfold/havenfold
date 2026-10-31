// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// envelope.js — kasa zarfı KASA_ENVELOPE (RFC-0004 §4.6)
//
//   ct  = XChaCha20-Poly1305(KRA, nonce, encode({ epochs: [{ epochSeq, epochHash, keys: [keyEntry] }], dropSecrets }), AD)
//   keyEntry ve dropSecret RFC-0001'deki biçimdedir (issuerId ve sig dahil; RFC-0019 §11.4 d).
//   AD  = hash('hf/kasa-env-ad/', collectionId, u64be(version), u64be(envSeq), u64be(lastEpochSeq))
//   sig = Ed25519(writer, hash('hf/kasa-env/', familyId, gönderilen baytlar sig hariç))
// Kurtaran ulaştığı bütün geçerli zarfları açar ve dönemleri birleştirir; aynı envSeq'li farklı zarflar kaybolmaz.
const c = require('compact-encoding')
const b4a = require('b4a')
const sodium = require('sodium-native')
const { kdf: { hash } } = require('@havenfold/core')
const { kodlama: { struct, decodeCanonical } } = require('@havenfold/records')

const hex = (b) => b4a.toString(b, 'hex')
function fail (code) { throw new Error(code) }

const ABYTES = sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES

const { keyEntry, dropSecret, verifyKeyEntry } = require('@havenfold/records').anahtar
const { Yetki } = require('@havenfold/records').yetki
const donem = struct([['epochSeq', c.uint], ['epochHash', c.fixed32], ['keys', c.array(keyEntry)]])
const zarfIci = struct([['epochs', c.array(donem)], ['dropSecrets', c.array(dropSecret)]])
const zarfBody = struct([
  ['collectionId', c.fixed16], ['version', c.uint], ['envSeq', c.uint], ['lastEpochSeq', c.uint], ['nonce', c.fixed24],
  ['ct', c.buffer], ['writerId', c.fixed16]
])

const adOf = (m) => hash('hf/kasa-env-ad/', m.collectionId, m.version, m.envSeq, m.lastEpochSeq)
const digestOf = (familyId, body) => hash('hf/kasa-env/', familyId, body)

// writer: { memberId, signKeyPair }. ic: { epochs: [{ epochSeq, epochHash, keys: [keyEntry] }], dropSecrets }.
// nonce yalnız test için.
function zarfYaz (familyId, kra, { collectionId, version, envSeq, ic }, writer, nonce = null) {
  if (!ic.epochs.length) fail('ENVELOPE_EMPTY')
  if (!nonce) { nonce = b4a.alloc(24); sodium.randombytes_buf(nonce) }
  const lastEpochSeq = Math.max(...ic.epochs.map((e) => e.epochSeq))
  const m = { collectionId, version, envSeq, lastEpochSeq, nonce, writerId: writer.memberId }
  const pt = c.encode(zarfIci, { dropSecrets: [], ...ic })
  m.ct = b4a.alloc(pt.byteLength + ABYTES)
  sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(m.ct, pt, adOf(m), null, nonce, kra)
  sodium.sodium_memzero(pt) // dönem anahtarları (inceleme 5 S10)
  const body = c.encode(zarfBody, m)
  const sig = b4a.alloc(64)
  sodium.crypto_sign_detached(sig, digestOf(familyId, body), writer.signKeyPair.secretKey)
  return b4a.concat([body, sig])
}

// L: defter (yazanın anahtarı). okuyucuMu(id, lastEpochSeq) → bool: yazan, zarfın son döneminde kasanın okuyucusu
// olmalı; zorunludur (inceleme kasa 16).
function zarfAc (L, kra, bytes, { okuyucuMu } = {}) {
  if (typeof okuyucuMu !== 'function') fail('NO_READER_CHECK')
  if (bytes.byteLength < 64) fail('INVALID_ENVELOPE')
  const body = bytes.subarray(0, bytes.byteLength - 64)
  const sig = bytes.subarray(bytes.byteLength - 64)
  const m = decodeCanonical(zarfBody, body, 'INVALID_ENVELOPE')
  const w = L.members.get(hex(m.writerId))
  if (!w || !sodium.crypto_sign_verify_detached(sig, digestOf(L.familyId, body), w.signPub)) fail('INVALID_SIGNATURE')
  if (!okuyucuMu(hex(m.writerId), m.lastEpochSeq)) fail('UNAUTHORIZED')
  const ct = m.ct || b4a.alloc(0)
  if (ct.byteLength < ABYTES) fail('INVALID_ENVELOPE')
  const pt = b4a.alloc(ct.byteLength - ABYTES)
  try { sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(pt, null, ct, adOf(m), m.nonce, kra) } catch { fail('ENVELOPE_OPEN_FAILED') }
  const ic = decodeCanonical(zarfIci, pt, 'INVALID_ENVELOPE') // alanlar pt'nin görünümleridir; çağıran kullanınca sıfırlar
  if (Math.max(...ic.epochs.map((e) => e.epochSeq)) !== m.lastEpochSeq) fail('INVALID_ENVELOPE')
  // Dönemler bu defterin dalında olmalı; anahtar girdisinin imzası ve düzenleyeni doğrulanır, geçmeyen kurtarmaya
  // girmez (inceleme 5 S11)
  const yetki = new Yetki()
  yetki.update(L)
  const cid = hex(m.collectionId)
  const signPubOf = (id) => L.entity(id)?.signPub
  for (const e of ic.epochs) {
    if (e.epochSeq >= L.len || !b4a.equals(e.epochHash, L.hashAt(e.epochSeq))) fail('INVALID_ENVELOPE')
    const ep = yetki.epoch(cid, e.epochSeq)
    if (!ep || !b4a.equals(ep.hash, e.epochHash)) fail('INVALID_ENVELOPE')
    e.keys = e.keys.filter((entry) => { try { verifyKeyEntry({ familyId: L.familyId, collectionId: m.collectionId, epoch: ep, entry, signPubOf }); return true } catch { return false } })
  }
  return { ...m, ic }
}

// Açılan zarfların dönemleri birleşir: (epochSeq, epochHash) başına keyEntry kümesi ve dropSecrets birleşimi.
// Sonuç zarf sırasına bağlı değildir: girdiler bayt sırasıyla, aynı baytlar bir kez (RFC-0019 §11.4 d).
function donemleriBirlestir (zarflar) {
  const by = new Map()
  const drops = new Map()
  for (const z of zarflar) {
    for (const e of z.ic.epochs) {
      const k = e.epochSeq + '|' + hex(e.epochHash)
      if (!by.has(k)) by.set(k, { epochSeq: e.epochSeq, epochHash: e.epochHash, keys: new Map() })
      for (const ke of e.keys) by.get(k).keys.set(hex(c.encode(keyEntry, ke)), ke)
    }
    for (const d of z.ic.dropSecrets) drops.set(hex(c.encode(dropSecret, d)), d)
  }
  const sirala = (m) => [...m].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, v]) => v)
  return {
    epochs: [...by.values()].sort((a, b) => a.epochSeq - b.epochSeq || b4a.compare(a.epochHash, b.epochHash)).map((e) => ({ epochSeq: e.epochSeq, epochHash: e.epochHash, keys: sirala(e.keys) })),
    dropSecrets: sirala(drops)
  }
}

module.exports = { zarfIci, zarfBody, adOf, digestOf, zarfYaz, zarfAc, donemleriBirlestir }
