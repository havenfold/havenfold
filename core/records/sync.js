// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// sync.js — kayıt eşitlemesi (RFC-0001 §12). Taşıyıcıdan bağımsızdır: mesaj baytları alır, mesaj baytları döner.
//
// Okuyucular arası: REC_VV özeti → farklı yazarlar için REC_IDS → eksikler REC_OPS. Anahtar REC_KEY_REQ ile,
// kesimler REC_CUTOFF ile tamamlanır. Kutu ile: 256 kovalı özet (REC_BUCKETS, REC_BUCKET_IDS) ve REC_PRUNE.
const c = require('compact-encoding')
const b4a = require('b4a')
const sodium = require('sodium-native')
const { kdf: { hash }, zarf: { Z } } = require('@havenfold/core')
const { struct, decodeCanonical } = require('./encoding')
const { encodeRecKeyReq } = require('./key')
const { sign } = require('./operation')

const hex = (b) => b4a.toString(b, 'hex')
const unhex = (s) => b4a.from(s, 'hex')
function fail (code) { throw new Error(code) }

const DIRECT_MAX = 1024 * 1024 // doğrudan oturumda bir REC_OPS
const RELAY_MAX = 63 * 1024 // emanet ve Posta Kutusu yolunda tek zarf
// REC_DROP'un dönemi yoktur: özetlerde epochSeq = 0 ve keyId = dropKeyHash ile yer alır (İstekler)
const DROP_EPOCH = 0

const epochVv = struct([['epochSeq', c.uint], ['keyIds', c.array(c.fixed32)]])
const authorVv = struct([['epochSeq', c.uint], ['keyId', c.fixed32], ['authorId', c.fixed16], ['count', c.uint], ['setHash', c.fixed32]])
const cutoffVv = struct([['authorId', c.fixed16], ['eventSeq', c.uint], ['issuerId', c.fixed16], ['listHash', c.fixed32]])
const vvItem = struct([['collectionId', c.fixed16], ['epochs', c.array(epochVv)], ['authors', c.array(authorVv)], ['cutoffs', c.array(cutoffVv)]])
const recVv = struct([['items', c.array(vvItem)]])
const recIds = struct([['collectionId', c.fixed16], ['authorId', c.fixed16], ['opIds', c.array(c.fixed32)]])
const opItem = struct([['kind', c.uint], ['bytes', c.buffer]])
const recOps = struct([['items', c.array(opItem)]])
const recBuckets = struct([['collectionId', c.fixed16], ['hashes', c.array(c.fixed32)]])
// keys: kovadaki kopya anahtarları hash('hf/rec-copy/', opId, sig) (RFC-0020 f); kova = opId[0]
const recBucketIds = struct([['collectionId', c.fixed16], ['bucket', c.uint], ['keys', c.array(c.fixed32)]])
const recPrune = struct([['collectionId', c.fixed16], ['opIds', c.array(c.fixed32)], ['by', c.fixed16], ['sig', c.fixed64]])

const sorted = (ids) => [...ids].sort(b4a.compare)
const setHashOf = (ids) => hash('hf/rec-set/', b4a.concat(sorted(ids)))
const bucketHashOf = (ids) => hash('hf/rec-bucket/', b4a.concat(sorted(ids)))
// Kutu ↔ telefon özetleri imzayı da kapsar (RFC-0020 f): kutuda yalnız bozuk kopya varken kovalar eşit görünmesin
const kopyaAnahtari = (opId, sig) => hash('hf/rec-copy/', opId, sig)
const pruneDigest = (familyId, cid, opIds) => hash('hf/rec-prune/', familyId, cid, b4a.concat(opIds))

const dec = (enc) => (b) => decodeCanonical(enc, b, 'INVALID_MESSAGE')
const decodeVv = dec(recVv)
const decodeIds = dec(recIds)
const decodeOps = dec(recOps)
const decodeBuckets = dec(recBuckets)
const decodeBucketIds = dec(recBucketIds)
const decodePrune = dec(recPrune)

// İşlemleri sınır içinde REC_OPS mesajlarına böler
function packOps (items, max = DIRECT_MAX) {
  const out = []
  let cur = []
  let size = 0
  for (const it of items) {
    const n = it.bytes.byteLength + 8
    if (cur.length && size + n > max - 16) { out.push(c.encode(recOps, { items: cur })); cur = []; size = 0 }
    cur.push(it)
    size += n
  }
  if (cur.length) out.push(c.encode(recOps, { items: cur }))
  return out
}

// --- Okuyucu tarafı (Replika üstünde) -------------------------------------------------------------------------

// Eşitlemede sayılan işlemler: çözülmüş ve reddedilmemiş (geçerli, hariç, bekleyen). Reddedilen ve temizlenen girmez.
function countedOps (r, cid) {
  return [...r.ops.values()].filter((o) => o.cid === cid && o.inner)
}

const groupKey = (epochSeq, keyId, author) => epochSeq + '|' + hex(keyId) + '|' + author
const opGroup = (o) => (o.kind === 0 ? { epochSeq: o.wire.epochSeq, keyId: o.wire.keyId } : { epochSeq: DROP_EPOCH, keyId: o.wire.dropKeyHash })

// Ortak koleksiyonlar: ikimizin de şu an okuyucu olduğu. Misafir genel eşitlemeye girmez; ona yalnız
// misafir.opsForGuest gider (inceleme kayıt 8).
function commonCollections (r, peerHex) {
  if (r.ledger.grants.has(peerHex) || r.ledger.grants.has(r.meHex)) return []
  if (!r._erisimVar(peerHex)) return [] // süresi dolmuş geçici (RFC-0022 a)
  const seq = r.ledger.len - 1
  return [...r.yetki.cols.keys()].filter((cid) => r.yetki.isReader(cid, r.meHex, seq) && r.yetki.isReader(cid, peerHex, seq))
}

function vvFor (r, peerHex) {
  r._catchUp()
  const items = []
  for (const cid of commonCollections(r, peerHex)) {
    // Yalnız bu daldaki dönemlerin anahtarları özetlenir
    const epochs = r.keys.epochList(cid).filter((e) => b4a.equals(r.yetki.epoch(cid, e.epochSeq)?.hash || b4a.alloc(32), e.epochHash))
      .map((e) => ({ epochSeq: e.epochSeq, keyIds: r.keys.entries(cid, e.epochSeq, e.epochHash).map((x) => x.keyId) }))
    const drops = r.keys.dropsOf(cid)
    if (drops.length) epochs.push({ epochSeq: DROP_EPOCH, keyIds: drops.map((d) => hash('hf/rec-drop/', d.pub)) })
    const groups = new Map()
    for (const o of countedOps(r, cid)) {
      const g = opGroup(o)
      const k = groupKey(g.epochSeq, g.keyId, o.author)
      if (!groups.has(k)) groups.set(k, { ...g, authorId: unhex(o.author), ids: [] })
      groups.get(k).ids.push(o.opId)
    }
    const authors = [...groups.values()].map((g) => ({ epochSeq: g.epochSeq, keyId: g.keyId, authorId: g.authorId, count: g.ids.length, setHash: setHashOf(g.ids) }))
    const cutoffs = []
    for (const [k, p] of r.cutoffs.partial) {
      if (!p.done || !k.startsWith(cid + '|')) continue
      const m = [...p.parts.values()][0].m
      cutoffs.push({ authorId: m.authorId, eventSeq: m.eventSeq, issuerId: m.issuerId, listHash: m.listHash })
    }
    items.push({ collectionId: unhex(cid), epochs, authors, cutoffs })
  }
  return c.encode(recVv, { items })
}

// Eşitleme durumu (D100): karşı tarafın özetinde benim yazar grubum (dönem, anahtar, sayı, küme özeti) benimkiyle
// aynıysa o gruptaki işlemlerim ona ulaşmıştır. Dönüş: teyit edilen kendi işlemlerimin opId hex listesi
function teyitler (r, peerHex, bytes) {
  r._catchUp()
  const vv = decodeVv(bytes)
  const common = new Set(commonCollections(r, peerHex))
  const out = []
  for (const it of vv.items) {
    const cid = hex(it.collectionId)
    if (!common.has(cid)) continue
    const mine = new Map()
    for (const o of countedOps(r, cid)) {
      if (o.author !== r.meHex) continue
      const g = opGroup(o)
      const k = groupKey(g.epochSeq, g.keyId, o.author)
      if (!mine.has(k)) mine.set(k, [])
      mine.get(k).push(o.opId)
    }
    for (const a of it.authors) {
      const ids = mine.get(groupKey(a.epochSeq, a.keyId, hex(a.authorId)))
      if (ids && a.count === ids.length && b4a.equals(a.setHash, setHashOf(ids))) for (const id of ids) out.push(hex(id))
    }
  }
  return out
}

// Karşı tarafın özeti → gönderilecek mesajlar. Karşı tarafın anahtarları sonraki REC_IDS cevabında kullanılır.
function onVv (r, peerHex, bytes) {
  r._catchUp()
  const vv = decodeVv(bytes)
  const out = []
  const common = new Set(commonCollections(r, peerHex))
  r.peerKeys = r.peerKeys || new Map()
  for (const it of vv.items) {
    const cid = hex(it.collectionId)
    if (!common.has(cid)) continue
    const theirKeys = new Set(it.epochs.flatMap((e) => e.keyIds.map((k) => e.epochSeq + '|' + hex(k))))
    r.peerKeys.set(peerHex + '|' + cid, theirKeys)
    // Eksik anahtarlar: karşıda olup bende olmayan dönemler
    const hashOf = (seq) => r.yetki.epoch(cid, seq)?.hash
    const need = it.epochs.filter((e) => e.epochSeq !== DROP_EPOCH && hashOf(e.epochSeq) && e.keyIds.some((k) => !r.keys.get(cid, e.epochSeq, hashOf(e.epochSeq), k))).map((e) => e.epochSeq)
    if (need.length) out.push({ type: Z.REC_KEY_REQ, bytes: encodeRecKeyReq({ collectionId: it.collectionId, epochs: need }) })
    // Yazar grupları: farklıysa o yazarın opId listesi gönderilir
    const mine = new Map()
    for (const o of countedOps(r, cid)) {
      const g = opGroup(o)
      const k = groupKey(g.epochSeq, g.keyId, o.author)
      if (!mine.has(k)) mine.set(k, [])
      mine.get(k).push(o.opId)
    }
    const theirs = new Map(it.authors.map((a) => [groupKey(a.epochSeq, a.keyId, hex(a.authorId)), a]))
    const authors = new Set()
    for (const [k, ids] of mine) {
      const t = theirs.get(k)
      if (!t || t.count !== ids.length || !b4a.equals(t.setHash, setHashOf(ids))) authors.add(k.split('|')[2])
    }
    for (const [k, t] of theirs) if (!mine.has(k) && t.count > 0) authors.add(hex(t.authorId))
    for (const author of authors) {
      const ids = countedOps(r, cid).filter((o) => o.author === author).map((o) => o.opId)
      out.push({ type: Z.REC_IDS, bytes: c.encode(recIds, { collectionId: it.collectionId, authorId: unhex(author), opIds: sorted(ids) }) })
    }
    // Karşıda olmayan kesimler
    const theirCuts = new Set(it.cutoffs.map((x) => [hex(x.authorId), x.eventSeq, hex(x.issuerId), hex(x.listHash)].join('|')))
    for (const [k, p] of r.cutoffs.partial) {
      if (!p.done || !k.startsWith(cid + '|')) continue
      const m = [...p.parts.values()][0].m
      if (theirCuts.has([hex(m.authorId), m.eventSeq, hex(m.issuerId), hex(m.listHash)].join('|'))) continue
      for (const x of p.parts.values()) out.push({ type: Z.REC_CUTOFF, bytes: x.bytes })
    }
  }
  return out
}

// Karşı tarafın bir yazar için opId listesi → onda olmayan ve açabileceği işlemlerimiz. Mezardakiler istenmez.
function onIds (r, peerHex, bytes) {
  r._catchUp()
  const m = decodeIds(bytes)
  const cid = hex(m.collectionId)
  if (!commonCollections(r, peerHex).includes(cid)) return []
  const theirs = new Set(m.opIds.map(hex))
  const keys = r.peerKeys?.get(peerHex + '|' + cid) || new Set()
  const author = hex(m.authorId)
  const items = []
  for (const o of countedOps(r, cid)) {
    if (o.author !== author || theirs.has(hex(o.opId))) continue
    const g = opGroup(o)
    if (!keys.has(g.epochSeq + '|' + hex(g.keyId))) continue // karşının anahtarı olmayan dönem gönderilmez
    items.push({ kind: o.kind, bytes: o.bytes })
  }
  const out = packOps(items).map((b) => ({ type: Z.REC_OPS, bytes: b }))
  // Karşıda olup bende olmayan (ve mezarda olmayan) işlem varsa kendi listemi gönderirim ki o da göndersin
  const mine = new Set(countedOps(r, cid).filter((o) => o.author === author).map((o) => hex(o.opId)))
  const lack = [...theirs].some((id) => !mine.has(id) && !r.tomb.has(id) && !r.ops.has(id))
  if (lack) out.push({ type: Z.REC_IDS, bytes: c.encode(recIds, { collectionId: m.collectionId, authorId: m.authorId, opIds: sorted([...mine].map(unhex)) }) })
  return out
}

function onOps (r, bytes) {
  const m = decodeOps(bytes)
  return m.items.map((it) => r.receiveOp(it.bytes, it.kind))
}

// --- Telefon ↔ kutu ----------------------------------------------------------------------------------------------

// Kümenin bir girdisinin kopyaları: kutuda Girdi.kopyalar, telefonda girdi ve imzası doğrulanmamış alternatifleri
const kopyalarOf = (x) => x.kopyalar || [{ bytes: x.bytes, sig: x.sig }, ...(x.alternatifler || [])]

// 256 kova: kova = opId[0]; içerik kopya anahtarları
function bucketsOf (set) {
  const b = Array.from({ length: 256 }, () => [])
  for (const x of set.values()) for (const k of kopyalarOf(x)) b[x.opId[0]].push(kopyaAnahtari(x.opId, k.sig))
  return b
}

// Telefon tarafı: kutuya gidecek küme, koleksiyonda sakladığı bütün işlem baytları (çözemedikleri dahil)
function phoneSet (r, cid) {
  return new Map([...r.ops.values()].filter((o) => o.cid === cid).map((o) => [hex(o.opId), {
    kind: o.kind, bytes: o.bytes, opId: o.opId, sig: o.wire.sig,
    alternatifler: (o.alternatifler || []).map((a) => ({ bytes: a.bytes, sig: a.wire.sig }))
  }]))
}

function bucketsMsg (cid, set) {
  return c.encode(recBuckets, { collectionId: unhex(cid), hashes: bucketsOf(set).map(bucketHashOf) })
}

// Karşının kova özetleri → farklı kovalar için kendi kopya anahtarlarımız
function onBuckets (cid, set, bytes) {
  const m = decodeBuckets(bytes)
  if (m.hashes.length !== 256) fail('INVALID_MESSAGE')
  const mine = bucketsOf(set)
  const out = []
  for (let i = 0; i < 256; i++) {
    if (b4a.equals(bucketHashOf(mine[i]), m.hashes[i])) continue
    out.push({ type: Z.REC_BUCKET_IDS, bytes: c.encode(recBucketIds, { collectionId: unhex(cid), bucket: i, keys: sorted(mine[i]) }) })
  }
  return out
}

// Karşının bir kovadaki kopya anahtarları → onda olmayan kopyalarımız (REC_OPS); bir opId'nin her kopyası ayrı
// sunulur (RFC-0019 §11.1 n), alıcı imzası geçeni kabul eder
function onBucketIds (cid, set, bytes, max = DIRECT_MAX) {
  const m = decodeBucketIds(bytes)
  const theirs = new Set(m.keys.map(hex))
  const items = []
  for (const x of set.values()) {
    if (x.opId[0] !== m.bucket) continue
    for (const k of kopyalarOf(x)) if (!theirs.has(hex(kopyaAnahtari(x.opId, k.sig)))) items.push({ kind: x.kind, bytes: k.bytes })
  }
  return packOps(items, max).map((b) => ({ type: Z.REC_OPS, bytes: b }))
}

function makePrune (familyId, cid, opIds, by) {
  const ids = sorted(opIds)
  const sig = sign(pruneDigest(familyId, unhex(cid), ids), by.signKeyPair.secretKey)
  return c.encode(recPrune, { collectionId: unhex(cid), opIds: ids, by: b4a.from(by.memberId), sig })
}

function verifyPrune (familyId, m, signPub) {
  return sodium.crypto_sign_verify_detached(m.sig, pruneDigest(familyId, m.collectionId, m.opIds), signPub)
}

module.exports = {
  teyitler,
  DIRECT_MAX, RELAY_MAX, DROP_EPOCH,
  recVv, recIds, recOps, recBuckets, recBucketIds, recPrune,
  setHashOf, bucketHashOf, kopyaAnahtari, pruneDigest, packOps, bucketsOf,
  decodeVv, decodeIds, decodeOps, decodeBuckets, decodeBucketIds, decodePrune,
  vvFor, onVv, onIds, onOps, phoneSet, bucketsMsg, onBuckets, onBucketIds, makePrune, verifyPrune, commonCollections
}
