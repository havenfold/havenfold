// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// cutoff.js — yetkisi biten yazarın kesimi (RFC-0001 §8)
//
//   listHash = hash('hf/rec-cutoff-list/', bütün parçaların opId'leri sıralı)
//   sig      = Ed25519(issuer, hash('hf/rec-cutoff/', familyId, collectionId, authorId, u64be(eventSeq), eventHash,
//                                    listHash, u64be(part), u64be(parts), opIds))
// Uygulanan liste, aynı (authorId, eventSeq, eventHash) için gelen bütün geçerli kesimlerin birleşimidir; yalnız büyür.
const c = require('compact-encoding')
const b4a = require('b4a')
const sodium = require('sodium-native')
const { kdf: { hash } } = require('@havenfold/core')
const { struct, decodeCanonical } = require('./encoding')
const { sign } = require('./operation')

const hex = (b) => b4a.toString(b, 'hex')
function fail (code) { throw new Error(code) }

// Parça başına en çok opId: tek zarf emanet yolunda 63 KB'ye sığsın (§12.1 madde 4)
const PART_MAX = 1500
const DAY_MS = 86_400_000

const recCutoff = struct([
  ['collectionId', c.fixed16], ['authorId', c.fixed16], ['eventSeq', c.uint], ['eventHash', c.fixed32],
  ['listHash', c.fixed32], ['part', c.uint], ['parts', c.uint], ['opIds', c.array(c.fixed32)],
  ['issuerId', c.fixed16], ['sig', c.fixed64]
])

const sortIds = (ids) => [...ids].sort(b4a.compare)
const listHashOf = (opIds) => hash('hf/rec-cutoff-list/', b4a.concat(sortIds(opIds)))
const cutoffDigest = (familyId, m) => hash('hf/rec-cutoff/', familyId, m.collectionId, m.authorId, m.eventSeq, m.eventHash,
  m.listHash, m.part, m.parts, b4a.concat(m.opIds))

// Parçalara bölünmüş, imzalı kesim mesajları. Parçalar 0'dan başlar (İstekler).
function makeCutoff ({ familyId, collectionId, authorId, eventSeq, eventHash, opIds, issuer }) {
  const sorted = sortIds(opIds)
  const listHash = listHashOf(sorted)
  const parts = Math.max(1, Math.ceil(sorted.length / PART_MAX))
  const out = []
  for (let part = 0; part < parts; part++) {
    const m = {
      collectionId, authorId, eventSeq, eventHash, listHash, part, parts,
      opIds: sorted.slice(part * PART_MAX, (part + 1) * PART_MAX), issuerId: b4a.from(issuer.memberId), sig: null
    }
    m.sig = sign(cutoffDigest(familyId, m), issuer.signKeyPair.secretKey)
    out.push(c.encode(recCutoff, m))
  }
  return out
}

const decodeCutoff = (b) => decodeCanonical(recCutoff, b, 'INVALID_MESSAGE')

// Bir kimliğin rotatedFrom / rotatedTo zincirindeki bütün kimlikler (kendisi dahil)
function rotationChain (L, id) {
  const out = new Set([id])
  let k = id
  while (L.members.get(k)?.rotatedFrom && !out.has(L.members.get(k).rotatedFrom)) { k = L.members.get(k).rotatedFrom; out.add(k) }
  k = id
  while (L.members.get(k)?.rotatedTo && !out.has(L.members.get(k).rotatedTo)) { k = L.members.get(k).rotatedTo; out.add(k) }
  return out
}

// §8.3 kural 1: eventSeq'ten sonra okuyucu olan üye; yazarın kendisi, zinciri, cihaz ve misafir olamaz
function canIssue (L, yetki, cid, authorHex, issuerHex, eventSeq) {
  if (!L.members.has(issuerHex)) return false
  if (L.members.get(issuerHex).role === 'kutu') return false
  if (rotationChain(L, authorHex).has(issuerHex)) return false
  // RFC-0017 §5: kişinin hiçbir kimliği aynı kişinin başka bir kimliği için kesim yayımlayamaz
  const pa = L.personIdOf(authorHex)
  if (pa && pa === L.personIdOf(issuerHex)) return false
  return yetki.isReader(cid, issuerHex, eventSeq)
}

class CutoffStore {
  constructor () {
    this.partial = new Map() // "cid|author|seq|hash|issuer|listHash" → { parts: Map<part, msg>, total }
    this.unions = new Map() // "cid|author|seq|hash" → Set<opIdHex>
    this.messages = new Map() // aynı anahtar → [baytlar] (yeniden dağıtım için, §8.3 kural 10)
    this.issued = new Set() // kendi yayımladıklarımız: "cid|author|seq|hash"
  }

  static key (cid, author, eventSeq, eventHash) { return [cid, author, eventSeq, hex(eventHash)].join('|') }

  // Doğrulanmış parça. Dönüş: 'eksik' | 'tamam' | 'tekrar'
  addPart (m, bytes) {
    const base = CutoffStore.key(hex(m.collectionId), hex(m.authorId), m.eventSeq, m.eventHash)
    const k = [base, hex(m.issuerId), hex(m.listHash)].join('|')
    if (!Number.isSafeInteger(m.part) || m.part < 0 || m.part >= m.parts) fail('INVALID_MESSAGE')
    let p = this.partial.get(k)
    if (!p) { p = { parts: new Map(), total: m.parts, done: false }; this.partial.set(k, p) }
    if (p.total !== m.parts) fail('INVALID_MESSAGE')
    if (p.parts.has(m.part)) return 'tekrar'
    p.parts.set(m.part, { m, bytes })
    if (p.parts.size < p.total || p.done) return 'eksik'
    const all = [...p.parts.values()].flatMap((x) => x.m.opIds)
    if (!b4a.equals(listHashOf(all), m.listHash)) { this.partial.delete(k); fail('INVALID_LIST') }
    p.done = true
    const u = this.unions.get(base) || new Set()
    for (const id of all) u.add(hex(id))
    this.unions.set(base, u)
    const msgs = this.messages.get(base) || []
    for (const x of p.parts.values()) msgs.push(x.bytes)
    this.messages.set(base, msgs)
    return 'tamam'
  }

  covers (cid, author, eventSeq, eventHash, opIdHex) {
    return !!this.unions.get(CutoffStore.key(cid, author, eventSeq, eventHash))?.has(opIdHex)
  }

  union (cid, author, eventSeq, eventHash) { return this.unions.get(CutoffStore.key(cid, author, eventSeq, eventHash)) || new Set() }
  messagesOf (cid) { return [...this.messages].filter(([k]) => k.startsWith(cid + '|')).flatMap(([, v]) => v) }
}

module.exports = { recCutoff, PART_MAX, DAY_MS, listHashOf, cutoffDigest, makeCutoff, decodeCutoff, rotationChain, canIssue, CutoffStore }
