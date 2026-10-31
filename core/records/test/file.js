// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
const test = require('brittle')
const b4a = require('b4a')
const D = require('../file')
const { anaDefter, K, C, hex } = require('./helpers/family')
const VK = require('../../../protocol/vectors/record-v2.json')

const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const icerik = (n) => b4a.from(Array.from({ length: n }, (_, i) => i % 251))

test('vektörler: 10 — dosya blobId ve AD', (t) => {
  const v = VK.v10
  const key = b4a.from(v.fileKey, 'hex')
  const buyuk = D.encryptBlobVektor(icerik(v.buyuk.boyut), key)
  t.is(hex(buyuk.blobId), v.buyuk.blobId)
  t.is(buyuk.chunks.length, 2)
  buyuk.chunks.forEach((ct, i) => {
    const p = v.buyuk.parcalar[i]
    t.is(hex(D.nonceOf(i)), p.nonce)
    t.is(hex(D.adOf(i, 2)), p.ad)
    t.is(ct.byteLength, p.uzunluk)
    t.is(hex(D.chunkHash(ct)), p.ozet)
  })
  const kucuk = D.encryptBlobVektor(icerik(100), key)
  t.is(hex(kucuk.chunks[0]), v.kucuk.ct)
  t.is(hex(kucuk.blobId), v.kucuk.blobId)
  t.alike(D.decryptBlob({ blobId: b4a.from(v.kucuk.blobId, 'hex'), fileKey: key, size: 100 }, [b4a.from(v.kucuk.ct, 'hex')]), icerik(100))
  // BLOB_DEL (RFC-0019 §11.1 q): blobIds (1 + 2×32), at (0xff + 8 bayt), by (16), sig (64)
  const s = v.silme
  const msg = b4a.from(s.mesaj, 'hex')
  t.is(msg.byteLength, 1 + 64 + 9 + 16 + 64)
  t.is(msg[0], 2)
  t.is(msg[65], 0xff)
  t.is(Number(new DataView(msg.buffer, msg.byteOffset + 66, 8).getBigUint64(0, true)), s.at)
  const m = D.decodeBlobDel(msg)
  t.is(hex(m.by), s.by)
  t.alike(m.blobIds.map(hex), [v.buyuk.blobId, v.kucuk.blobId])
  t.is(hex(D.delDigest(b4a.from(s.familyId, 'hex'), s.at, m.blobIds)), s.ozet)
  t.ok(require('sodium-native').crypto_sign_verify_detached(m.sig, b4a.from(s.ozet, 'hex'), K.irem.signKeyPair.publicKey))
})

test('dosya: şifrele, çöz; blobId, boyut ve parça sırası denetlenir', (t) => {
  const veri = icerik(3 * D.CHUNK + 7)
  const b = D.encryptBlob(veri)
  t.is(b.chunks.length, 4)
  t.alike(D.decryptBlob(b, b.chunks), veri)
  t.is(hataOf(() => D.decryptBlob({ ...b, size: b.size + 1 }, b.chunks)), 'INVALID_FILE')
  t.is(hataOf(() => D.decryptBlob(b, [b.chunks[1], b.chunks[0], b.chunks[2], b.chunks[3]])), 'INVALID_FILE')
  const bozuk = b.chunks.map((x) => b4a.from(x))
  bozuk[2][5] ^= 1
  t.is(hataOf(() => D.decryptBlob(b, bozuk)), 'INVALID_FILE')
  t.is(hataOf(() => D.decryptBlob({ ...b, fileKey: b4a.alloc(32) }, b.chunks)), 'INVALID_FILE')
  t.unlike(D.encryptBlob(veri).blobId, b.blobId, 'her yüklemede yeni anahtar')
  const bos = D.encryptBlob(b4a.alloc(0))
  t.is(bos.chunks.length, 1)
  t.alike(D.decryptBlob(bos, bos.chunks), b4a.alloc(0))
})

test('tutucu: yükleme, istek, ilk yükleyen; silme yalnız yükleyen ya da ebeveyn, 90 gün', (t) => {
  const L = anaDefter()
  let simdi = 1000
  const S = new D.BlobStore({ ledger: L, now: () => simdi })
  const b = D.encryptBlob(icerik(D.CHUNK + 1))
  const msgs = D.uploadMsgs(b)
  t.is(S.receive(hex(K.irem.memberId), msgs[1]), 'eksik')
  t.is(S.receive(hex(K.irem.memberId), msgs[0]), 'tamam')
  t.ok(S.has(b.blobId))
  const cevap = S.answer(require('compact-encoding').encode(D.blobReq, { blobId: b.blobId, from: 0, count: 10 }))
  t.is(cevap.length, 2)
  const parcalar = cevap.map((x) => D.decodeBlobData(x).chunk)
  t.alike(D.decryptBlob(b, parcalar), icerik(D.CHUNK + 1))

  t.is(hataOf(() => S.del(D.makeBlobDel(L.familyId, [b.blobId], K.ecem))), 'UNAUTHORIZED', 'yükleyen ya da ebeveyn değil')
  t.is(hataOf(() => S.del(D.makeBlobDel(L.familyId, [b.blobId], C.isci1))), 'UNAUTHORIZED')
  const sahte = b4a.from(D.makeBlobDel(L.familyId, [b.blobId], K.irem))
  sahte[sahte.byteLength - 1] ^= 1
  t.is(hataOf(() => S.del(sahte)), 'INVALID_SIGNATURE')
  t.is(S.del(D.makeBlobDel(L.familyId, [b.blobId], K.irem)), 1)
  simdi += D.DELETE_WAIT_MS - 1
  S.gc()
  t.ok(S.has(b.blobId), '90 gün dolmadı')
  // Bu sürede tam ve doğrulanmış yeniden yükleme silmeyi iptal eder (tek parça etmez; RFC-0019 §11.1 j)
  for (const m of msgs) S.receive(hex(K.kerem.memberId), m)
  simdi += 10
  S.gc()
  t.ok(S.has(b.blobId))
  t.is(S.del(D.makeBlobDel(L.familyId, [b.blobId], K.kerem)), 1, 'ebeveyn silebilir')
  simdi += D.DELETE_WAIT_MS
  S.gc()
  t.absent(S.has(b.blobId))
  // Yanlış blobId'li yükleme atılır
  const c2 = D.encryptBlob(icerik(10))
  const kotu = D.uploadMsgs({ ...c2, blobId: b4a.alloc(32, 1) })
  t.is(hataOf(() => S.receive(hex(K.irem.memberId), kotu[0])), 'INVALID_FILE')
})

test('tutucu: konteyner uygulaması yedeği hemen silinir (RFC-0011)', (t) => {
  const L = anaDefter()
  const S = new D.BlobStore({ ledger: L, now: () => 5 })
  const b = D.encryptBlob(icerik(10))
  S.receive(hex(C.isci1.memberId), D.uploadMsgs(b)[0])
  S.del(D.makeBlobDel(L.familyId, [b.blobId], C.isci1), { immediate: true })
  t.absent(S.has(b.blobId))
})

test('önbellek: canlı kayıtların atıf yaptığı dosyalar', (t) => {
  const ref = { blobId: b4a.alloc(32, 1), fileKey: b4a.alloc(32), size: 1, mime: 'a/b', name: 'x' }
  const ref2 = { ...ref, blobId: b4a.alloc(32, 2) }
  const s = D.referencedBlobs([{ fields: { foto: ref, ekler: ['a', [ref2]] } }, { fields: { a: 1 } }])
  t.alike([...s].sort(), [hex(ref.blobId), hex(ref2.blobId)])
})
