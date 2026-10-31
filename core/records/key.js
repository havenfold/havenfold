// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// key.js — dönem anahtarları, REC_KEY ve REC_KEY_REQ (RFC-0001 §9)
//
//   keyId = hash('hf/rec-epoch/', key)
//   sig   = Ed25519(issuer, hash('hf/rec-key/', familyId, collectionId, u64be(epochSeq), epochHash, keyId,
//                                hash('hf/rec-key-commit/', key)))
// Üreten, dönem anında koleksiyonun okuyucusu olan bir üyedir; okuyucular arasında misafir varsa yalnız ebeveyn.
const c = require('compact-encoding')
const b4a = require('b4a')
const sodium = require('sodium-native')
const { kdf: { hash } } = require('@havenfold/core')
const { struct, decodeCanonical } = require('./encoding')
const { keyIdOf, sign } = require('./operation')

const hex = (b) => b4a.toString(b, 'hex')
function fail (code) { throw new Error(code) }

const keyEntry = struct([['keyId', c.fixed32], ['key', c.fixed32], ['issuerId', c.fixed16], ['sig', c.fixed64]])
const dropSecret = struct([['dropKeyHash', c.fixed32], ['secret', c.fixed32]])
const recKey = struct([
  ['collectionId', c.fixed16], ['epochSeq', c.uint], ['epochHash', c.fixed32],
  ['keys', c.array(keyEntry)], ['dropSecrets', c.array(dropSecret)]
])
const recKeyReq = struct([['collectionId', c.fixed16], ['epochs', c.array(c.uint)]])

const keyDigest = (familyId, cid, epochSeq, epochHash, keyId, key) =>
  hash('hf/rec-key/', familyId, cid, epochSeq, epochHash, keyId, hash('hf/rec-key-commit/', key))
const dropKeyHashOf = (pub) => hash('hf/rec-drop/', pub)

// Ekipte önce sahipler, sonra yöneticiler, sonra diğerleri (RFC-0005 §14)
const ROLE_RANK = { ebeveyn: 0, sahip: 0, yonetici: 1 }
const rankOf = (role) => (role in ROLE_RANK ? ROLE_RANK[role] : 2)
// Misafirli koleksiyonda anahtar üretebilen roller: ailede ebeveyn, ekipte sahip ya da yönetici
const YETKILI = new Set(['ebeveyn', 'sahip', 'yonetici'])

// "Sıralamada ilk": önce ebeveynler (ekipte sahip, yönetici), sonra diğerleri; her grupta memberId bayt sırasıyla (§9.2)
function orderReaders (readers) {
  return [...readers].filter(([, role]) => role !== 'misafir')
    .sort(([a, ra], [b, rb]) => rankOf(ra) - rankOf(rb) || b4a.compare(b4a.from(a, 'hex'), b4a.from(b, 'hex')))
    .map(([id]) => id)
}

// Dönem anahtarını üretebilecekler: okuyucular arasında misafir varsa yalnız ebeveynler
function ureteBilenler (readers) {
  const sira = orderReaders(readers)
  const misafirli = [...readers.values()].includes('misafir')
  return misafirli ? sira.filter((id) => YETKILI.has(readers.get(id))) : sira
}

// i. üreten (RFC-0019 §11.1 h): ilk okuyucunun anahtarı 10 dakika görünmezse sıradaki; liste biterse sonuncu.
// Uygun üreten yoksa null (sync düşmez).
function ureten (readers, i = 0) {
  const u = ureteBilenler(readers)
  return u.length ? u[Math.min(i, u.length - 1)] : null
}

function makeKeyEntry ({ familyId, collectionId, epochSeq, epochHash, key, issuer }) {
  const keyId = keyIdOf(key)
  const sig = sign(keyDigest(familyId, collectionId, epochSeq, epochHash, keyId, key), issuer.signKeyPair.secretKey)
  return { keyId, key, issuerId: b4a.from(issuer.memberId), sig }
}

// epoch: yetki.epoch(...) — { seq, hash, readers }. signPubOf: id hex → açık anahtar
function verifyKeyEntry ({ familyId, collectionId, epoch, entry, signPubOf }) {
  const issuer = hex(entry.issuerId)
  const role = epoch.readers.get(issuer)
  if (!role || role === 'misafir') fail('KEY_UNAUTHORIZED') // dönem anında okuyucu üye değil
  const hasGuest = [...epoch.readers.values()].includes('misafir')
  if (hasGuest && !YETKILI.has(role)) fail('KEY_UNAUTHORIZED')
  if (!b4a.equals(keyIdOf(entry.key), entry.keyId)) fail('INVALID_KEY')
  const pub = signPubOf(issuer)
  if (!pub || !sodium.crypto_sign_verify_detached(entry.sig, keyDigest(familyId, collectionId, epoch.seq, epoch.hash, entry.keyId, entry.key), pub)) fail('INVALID_SIGNATURE')
  return { issuerId: issuer, role }
}

// Anahtarlar (koleksiyon, dönem seq, dönem özeti) ile tutulur (RFC-0019 §11.1 f): çatallanmada başka dalın aynı
// seq'li dönemi aynı anahtarı kullanamaz.
class KeyStore {
  constructor () {
    this.epochs = new Map() // "cid|epochSeq|epochHashHex" → { cid, epochSeq, epochHash, keys: Map<keyIdHex, { key, issuerId, role, entry }> }
    this.drops = new Map() // dropKeyHash hex → { cid, pub, secret }
  }

  static k (cid, epochSeq, epochHash) { return cid + '|' + epochSeq + '|' + hex(epochHash) }

  _slot (cid, epochSeq, epochHash) {
    const k = KeyStore.k(cid, epochSeq, epochHash)
    let s = this.epochs.get(k)
    if (!s) {
      s = { cid, epochSeq, epochHash: b4a.from(epochHash), keys: new Map() }
      this.epochs.set(k, s)
    }
    return s
  }

  // Doğrulanmış girdi eklenir. Dönüş: yeni mi
  add (cid, epoch, entry, role) {
    const s = this._slot(cid, epoch.seq, epoch.hash)
    const k = hex(entry.keyId)
    if (s.keys.has(k)) return false
    s.keys.set(k, { key: b4a.from(entry.key), issuerId: hex(entry.issuerId), role, entry })
    return true
  }

  get (cid, epochSeq, epochHash, keyId) {
    return this.epochs.get(KeyStore.k(cid, epochSeq, epochHash))?.keys.get(hex(keyId))?.key || null
  }

  has (cid, epochSeq, epochHash) { return (this.epochs.get(KeyStore.k(cid, epochSeq, epochHash))?.keys.size || 0) > 0 }

  entries (cid, epochSeq, epochHash) { return [...(this.epochs.get(KeyStore.k(cid, epochSeq, epochHash))?.keys.values() || [])].map((x) => x.entry) }

  // Bilinen dönemler: [{ epochSeq, epochHash }]
  epochList (cid) { return [...this.epochs.values()].filter((s) => s.cid === cid && s.keys.size > 0).map((s) => ({ epochSeq: s.epochSeq, epochHash: s.epochHash })).sort((a, b) => a.epochSeq - b.epochSeq) }

  // Çatallanmadan sonra: defterdeki döneme uymayan yuvalar atılır. hashOf(cid, seq) → bugünkü dönem özeti ya da null
  dalaUydur (hashOf) {
    for (const [k, s] of this.epochs) {
      const h = hashOf(s.cid, s.epochSeq)
      if (!h || !b4a.equals(h, s.epochHash)) {
        for (const v of s.keys.values()) sodium.sodium_memzero(v.key)
        this.epochs.delete(k)
      }
    }
  }

  // Yeni yazımda: üreteni sıralamada en önde olan; aynı üretende keyId küçük olan (§9.2)
  preferred (cid, epochSeq, epochHash) {
    const s = this.epochs.get(KeyStore.k(cid, epochSeq, epochHash))
    if (!s || s.keys.size === 0) return null
    const all = [...s.keys.entries()].sort(([ka, a], [kb, b]) =>
      rankOf(a.role) - rankOf(b.role) ||
      b4a.compare(b4a.from(a.issuerId, 'hex'), b4a.from(b.issuerId, 'hex')) ||
      b4a.compare(b4a.from(ka, 'hex'), b4a.from(kb, 'hex')))
    const [keyId, v] = all[0]
    return { keyId: b4a.from(keyId, 'hex'), key: v.key }
  }

  addDrop (cid, pub, secret) {
    this.drops.set(hex(dropKeyHashOf(pub)), { cid, pub: b4a.from(pub), secret: b4a.from(secret) })
  }

  drop (dropKeyHash) { return this.drops.get(hex(dropKeyHash)) || null }
  dropsOf (cid) { return [...this.drops.values()].filter((d) => d.cid === cid) }
}

// dropSecret'in açık anahtarı: X25519 taban noktası çarpımı
function dropPubOf (secret) {
  const pub = b4a.alloc(32)
  sodium.crypto_scalarmult_base(pub, secret)
  return pub
}

const encodeRecKey = (m) => c.encode(recKey, m)
const decodeRecKey = (b) => decodeCanonical(recKey, b, 'INVALID_MESSAGE')
const encodeRecKeyReq = (m) => c.encode(recKeyReq, m)
const decodeRecKeyReq = (b) => decodeCanonical(recKeyReq, b, 'INVALID_MESSAGE')

module.exports = {
  keyEntry, dropSecret, recKey, recKeyReq, keyDigest, dropKeyHashOf, dropPubOf, orderReaders, ureteBilenler, ureten, rankOf,
  makeKeyEntry, verifyKeyEntry, KeyStore, encodeRecKey, decodeRecKey, encodeRecKeyReq, decodeRecKeyReq
}
