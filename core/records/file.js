// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// file.js — dosyalar (RFC-0001 §11)
//
//   parça boyutu 65536 B (son parça daha kısa olabilir); fileKey her yüklemede rastgele 32 B
//   nonce_i = u64be(i) ‖ 16 sıfır bayt
//   AD_i    = hash('hf/blob-ad/', u64be(i), u64be(toplamParça))
//   ct_i    = XChaCha20-Poly1305(fileKey, nonce_i, parça_i, AD_i)
//   h_i     = hash('hf/blob-chunk/', ct_i);  blobId = hash('hf/blob-id/', h_0 ‖ … ‖ h_n)
// Dosyayı tutan (kutu, işçi, telefon) fileKey'i bilmez; yalnız şifreli parçaları ve ilk yükleyeni saklar.
const c = require('compact-encoding')
const b4a = require('b4a')
const sodium = require('sodium-native')
const { kdf: { hash } } = require('@havenfold/core')
const { struct, decodeCanonical } = require('./encoding')
const { sign } = require('./operation')
const { erisimVar } = require('./permission')

const hex = (b) => b4a.toString(b, 'hex')
// BLOB_DEL ve silme iptali: ailede ebeveyn, ekipte sahip (RFC-0005 §14)
const silebilenler = (L) => (L.kind === 'ekip' ? L.personIds().filter((id) => L.members.get(id).role === 'sahip') : L.parentIds())
function fail (code) { throw new Error(code) }

const CHUNK = 65536
const MAX_SIZE = 2 * 1024 * 1024 * 1024
const ABYTES = sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES
const DELETE_WAIT_MS = 90 * 86_400_000
const CACHE_MS = 30 * 86_400_000

const nonceOf = (i) => b4a.concat([u64(i), b4a.alloc(16)])
function u64 (i) { const b = b4a.alloc(8); new DataView(b.buffer, b.byteOffset).setBigUint64(0, BigInt(i)); return b }
const adOf = (i, total) => hash('hf/blob-ad/', i, total)
const chunkHash = (ct) => hash('hf/blob-chunk/', ct)
const blobIdOf = (cts) => hash('hf/blob-id/', b4a.concat(cts.map(chunkHash)))
// Boş dosya tek, boş bir parçadır (İstekler)
const totalOf = (size) => Math.max(1, Math.ceil(size / CHUNK))

function randomKey () { const k = b4a.alloc(32); sodium.randombytes_buf(k); return k }

// Dönüş: { blobId, fileKey, size, chunks }. Her yüklemede yeni rastgele fileKey (üretim yolu dışarıdan anahtar almaz).
const encryptBlob = (bytes) => encrypt(bytes, randomKey())

// Yalnız test vektörleri: sabit fileKey
const encryptBlobVektor = (bytes, fileKey) => encrypt(bytes, fileKey)

function encrypt (bytes, fileKey) {
  if (bytes.byteLength > MAX_SIZE) fail('FILE_TOO_LARGE')
  const total = totalOf(bytes.byteLength)
  const chunks = []
  for (let i = 0; i < total; i++) {
    const pt = bytes.subarray(i * CHUNK, (i + 1) * CHUNK)
    const ct = b4a.alloc(pt.byteLength + ABYTES)
    sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(ct, pt, adOf(i, total), null, nonceOf(i), fileKey)
    chunks.push(ct)
  }
  return { blobId: blobIdOf(chunks), fileKey, size: bytes.byteLength, chunks }
}

// Alıcı kullanmadan önce blobId'yi ve boyutu doğrular
function decryptBlob ({ blobId, fileKey, size }, chunks) {
  if (size > MAX_SIZE || chunks.length !== totalOf(size)) fail('INVALID_FILE')
  if (!b4a.equals(blobIdOf(chunks), blobId)) fail('INVALID_FILE')
  const parts = []
  for (let i = 0; i < chunks.length; i++) {
    const ct = chunks[i]
    if (ct.byteLength < ABYTES) fail('INVALID_FILE')
    const pt = b4a.alloc(ct.byteLength - ABYTES)
    try {
      sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(pt, null, ct, adOf(i, chunks.length), nonceOf(i), fileKey)
    } catch { fail('INVALID_FILE') }
    parts.push(pt)
  }
  const out = b4a.concat(parts)
  if (out.byteLength !== size) fail('INVALID_FILE')
  return out
}

// --- Mesajlar -----------------------------------------------------------------------------------------------------

const blobReq = struct([['blobId', c.fixed32], ['from', c.uint], ['count', c.uint]])
const blobData = struct([['blobId', c.fixed32], ['index', c.uint], ['total', c.uint], ['chunk', c.buffer]])
// at: silmenin anı (ms, RFC-0019 §11.1 q). Ed25519 belirlenimci olduğu için at olmadan aynı kişinin ikinci silmesi
// aynı imzayı üretirdi.
const blobDel = struct([['blobIds', c.array(c.fixed32)], ['at', c.uint], ['by', c.fixed16], ['sig', c.fixed64]])
const delDigest = (familyId, at, blobIds) => hash('hf/blob-del/', familyId, at, b4a.concat(blobIds))

const dec = (enc) => (b) => decodeCanonical(enc, b, 'INVALID_MESSAGE')
const decodeBlobReq = dec(blobReq)
const decodeBlobData = dec(blobData)
const decodeBlobDel = dec(blobDel)

function makeBlobDel (familyId, blobIds, by, at = Date.now()) {
  return c.encode(blobDel, { blobIds, at, by: b4a.from(by.memberId), sig: sign(delDigest(familyId, at, blobIds), by.signKeyPair.secretKey) })
}

// --- Tutucu ------------------------------------------------------------------------------------------------------

// Tutucu (kutu ya da depolama yapan işçi). Parçalar gönderen başına toplanır: bir göndericinin bütün parçaları
// gelip blobId doğrulanınca dosya tamamlanır; yükleyen o göndericidir. Bozuk bir parça yalnız onu gönderenin kümesini
// düşürür. Tutucu (by, blobId) başına son işlediği BLOB_DEL.at'ı saklar ve yalnız daha büyüğünü işler (yeniden
// oynatılamaz, RFC-0019 §11.1 j, q). Silme yalnız tam ve doğrulanmış yeniden yüklemeyle ve yalnız ilk yükleyenden ya da
// bir ebeveynden gelirse iptal olur. Tamamlanan dosya için yükleyene BLOB_HAVE gider (RFC-0019 §9).
class BlobStore {
  constructor ({ ledger, me = null, now = Date.now }) {
    this.ledger = ledger
    this.me = me
    this.now = now
    this.blobs = new Map() // blobIdHex → { chunks, total, uploader, complete, deleteAt }
    this.gelen = new Map() // blobIdHex|gönderen → { total, chunks }
    this.silmeler = new Map() // "by|blobId" → son işlenen BLOB_DEL.at
    this.have = [] // gönderilecek BLOB_HAVE: { to, blobId }
  }

  // BLOB_DATA (yükleme). from: oturumdaki kimlik.
  receive (fromHex, bytes) {
    const m = decodeBlobData(bytes)
    const k = hex(m.blobId)
    if (m.total < 1 || m.index >= m.total || m.total > Math.ceil(MAX_SIZE / CHUNK) + 1) fail('INVALID_MESSAGE')
    const chunk = m.chunk || b4a.alloc(0)
    if (chunk.byteLength > CHUNK + ABYTES) fail('INVALID_MESSAGE')
    const gk = k + '|' + fromHex
    let g = this.gelen.get(gk)
    if (!g || g.total !== m.total) { g = { total: m.total, chunks: new Array(m.total) }; this.gelen.set(gk, g) }
    g.chunks[m.index] = b4a.from(chunk)
    if (g.chunks.filter(Boolean).length < g.total) return 'eksik'
    this.gelen.delete(gk)
    if (!b4a.equals(blobIdOf(g.chunks), m.blobId)) fail('INVALID_FILE')
    const b = this.blobs.get(k)
    if (b && b.complete) {
      // Tam ve doğrulanmış yeniden yükleme silmeyi iptal eder; yalnız ilk yükleyenden ya da ebeveynden
      if (b.deleteAt !== null && (fromHex === b.uploader || silebilenler(this.ledger).includes(fromHex))) b.deleteAt = null
      return 'tamam'
    }
    this.blobs.set(k, { chunks: g.chunks, total: g.total, uploader: fromHex, complete: true, deleteAt: null })
    if (this.me) this.have.push({ to: fromHex, blobId: b4a.from(m.blobId) })
    return 'tamam'
  }

  // Bekleyen BLOB_HAVE mesajları (yükleyen başına toplanır)
  haveMsgs () {
    const by = new Map()
    for (const h of this.have.splice(0)) {
      if (!by.has(h.to)) by.set(h.to, [])
      by.get(h.to).push(h.blobId)
    }
    return [...by].map(([to, ids]) => ({ type: 0xf0, to, bytes: makeBlobHave(this.ledger.familyId, ids, this.me) }))
  }

  // BLOB_REQ → BLOB_DATA mesajları. from: isteyenin kimliği; ekipte zorunlu ve süresi dolmuş geçiciye yanıt yok
  // (RFC-0022 a)
  answer (bytes, { from = null } = {}) {
    const m = decodeBlobReq(bytes)
    if (this.ledger.kind === 'ekip' && (from === null || !erisimVar(this.ledger, from, this.now()))) return []
    const b = this.blobs.get(hex(m.blobId))
    if (!b || !b.complete) return []
    const out = []
    for (let i = m.from; i < Math.min(b.total, m.from + m.count); i++) out.push(c.encode(blobData, { blobId: m.blobId, index: i, total: b.total, chunk: b.chunks[i] }))
    return out
  }

  // BLOB_DEL: yalnız yükleyen ya da topluluğun herhangi bir aktif ebeveyni. immediate: konteyner uygulamasının
  // yedek dosyası (RFC-0011) — 90 gün beklenmez. (by, blobId) için at, son işlenenden büyük olmalı.
  del (bytes, { immediate = false } = {}) {
    const m = decodeBlobDel(bytes)
    const by = hex(m.by)
    const L = this.ledger
    const ent = L.entity(by)
    if (!ent || !sodium.crypto_sign_verify_detached(m.sig, delDigest(L.familyId, m.at, m.blobIds), ent.signPub)) fail('INVALID_SIGNATURE')
    const parent = silebilenler(L).includes(by)
    for (const id of m.blobIds) {
      const b = this.blobs.get(hex(id))
      if (b && b.uploader !== by && !parent) fail('UNAUTHORIZED')
    }
    let n = 0
    for (const id of m.blobIds) {
      const sk = by + '|' + hex(id)
      if (this.silmeler.has(sk) && this.silmeler.get(sk) >= m.at) continue
      this.silmeler.set(sk, m.at)
      const b = this.blobs.get(hex(id))
      if (!b) continue
      b.deleteAt = immediate ? this.now() : this.now() + DELETE_WAIT_MS
      n++
    }
    this.gc()
    return n
  }

  gc () {
    for (const [k, b] of this.blobs) if (b.deleteAt !== null && this.now() >= b.deleteAt) this.blobs.delete(k)
  }

  has (blobId) { return !!this.blobs.get(typeof blobId === 'string' ? blobId : hex(blobId))?.complete }
}

// --- BLOB_HAVE (0xF0, RFC-0019 §9) -------------------------------------------------------------------------------

const blobHave = struct([['blobIds', c.array(c.fixed32)], ['holder', c.fixed16], ['sig', c.fixed64]])
const haveDigest = (familyId, blobIds) => hash('hf/blob-have/', familyId, b4a.concat(blobIds))

function makeBlobHave (familyId, blobIds, holder) {
  return c.encode(blobHave, { blobIds, holder: b4a.from(holder.memberId), sig: sign(haveDigest(familyId, blobIds), holder.signKeyPair.secretKey) })
}

// Tutucu kutu ya da aktif işçi olmalı; imza tutucunun
function verifyBlobHave (L, bytes) {
  const m = decodeCanonical(blobHave, bytes, 'INVALID_MESSAGE')
  const h = hex(m.holder)
  const ent = L.entity(h)
  if (!ent || !sodium.crypto_sign_verify_detached(m.sig, haveDigest(L.familyId, m.blobIds), ent.signPub)) fail('INVALID_SIGNATURE')
  const kutu = L.members.get(h)?.role === 'kutu' && L.sessionRole(h) === 'uye'
  const isci = L.devices.get(h)?.active && L.devices.get(h).class === 'isci'
  if (!kutu && !isci) fail('UNAUTHORIZED')
  return m
}

// Telefonda yerel sayım: dosya başına tutucular. Kayıtla eşitlenmez; arayüz "en az" diye gösterir.
class BlobHaveStore {
  constructor () { this.m = new Map() } // blobIdHex → Set<holderHex>
  al (L, bytes) {
    const m = verifyBlobHave(L, bytes)
    for (const id of m.blobIds) {
      const k = hex(id)
      if (!this.m.has(k)) this.m.set(k, new Set())
      this.m.get(k).add(hex(m.holder))
    }
    return m
  }

  kopya (blobId) { return this.m.get(typeof blobId === 'string' ? blobId : hex(blobId))?.size || 0 }
  tutucular (blobId) { return [...(this.m.get(typeof blobId === 'string' ? blobId : hex(blobId)) || [])].sort() }
}

// Yükleme: BLOB_DATA mesajları
function uploadMsgs (blob) {
  return blob.chunks.map((chunk, index) => c.encode(blobData, { blobId: blob.blobId, index, total: blob.chunks.length, chunk }))
}

// Telefonun önbelleği: canlı kayıtların atıf yaptığı dosyalar (blobRef değerleri, liste içindekiler dahil)
function referencedBlobs (records) {
  const out = new Set()
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object' && b4a.isBuffer(v.blobId)) out.add(hex(v.blobId))
  }
  for (const r of records) for (const v of Object.values(r.fields)) walk(v)
  return out
}

module.exports = {
  CHUNK, MAX_SIZE, DELETE_WAIT_MS, CACHE_MS, totalOf,
  nonceOf, adOf, chunkHash, blobIdOf, encryptBlob, encryptBlobVektor, decryptBlob,
  blobReq, blobData, blobDel, delDigest, decodeBlobReq, decodeBlobData, decodeBlobDel, makeBlobDel,
  blobHave, haveDigest, makeBlobHave, verifyBlobHave, BlobHaveStore,
  BlobStore, uploadMsgs, referencedBlobs
}
