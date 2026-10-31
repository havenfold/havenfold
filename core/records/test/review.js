// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D9: inceleme 1 bulguları, RFC-0001 (kayıt katmanı). Beklenen değerler elle yazılmıştır.
const test = require('brittle')
const b4a = require('b4a')
const sodium = require('sodium-native')
const { ledger: { T }, kdf } = require('@havenfold/core')
const Kd = require('../encoding')
const { Hlc, fromMs, msOf } = require('../hlc')
const I = require('../operation')
const A = require('../key')
const D = require('../file')
const E = require('../sync')
const Kz = require('../cutoff')
const { Kutu } = require('../box')
const { saklamalar } = require('../cleanup')
const { anaDefter, kopya, replika, teslim, K, C, K_TUM_AILE, K_BAKICI, TS0, hex, olay, ekle, koleksiyon } = require('./helpers/family')
const { at } = require('../../core/test/helpers/ledger')

const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const TA = hex(K_TUM_AILE)
const MIN = 60_000
const DAY = 86_400_000
const U64_MAX = (1n << 64n) - 1n

// Hüsniye anahtar üretir, Kerem'e verir; ikisi de Tüm Aile'yi okur ve yazar
function ikili (opts = {}) {
  const L = anaDefter()
  const now = opts.now || (() => TS0 + 3_600_000)
  const hus = replika(L, K.husniye, { now })
  const kerem = replika(kopya(L), K.kerem, { now })
  teslim(hus, kerem)
  return { L, hus, kerem, now }
}

// Kerem'in anahtarıyla elle işlem (imzacı ve iç alanlar serbest)
function elIslem (r, signer, inner) {
  const L = r.ledger
  const ep = r.yetki.epochAt(TA, L.len - 1)
  const k = r.keys.preferred(TA, ep.seq, ep.hash)
  return I.sealOpVektor({ familyId: L.familyId, collectionId: K_TUM_AILE, epochSeq: ep.seq, key: k.key, signer, inner: { recordId: b4a.alloc(16, 9), op: 0, type: '', fields: [], recNonce: null, authorId: signer.memberId, ledgerSeq: L.len - 1, ledgerHash: L.head, ...inner } })
}

test('kritik 1: HLC yalnız geçerli ve ileri saat sınırındaki işlemden gözlenir; 2^64 ve üstü reddedilir', (t) => {
  const { hus, kerem, now } = ikili()
  const once = hus.hlc.last
  // İmzası yazarınki olmayan işlem: saat 2^64 − 1
  const kotu = elIslem(kerem, K.kerem, { authorId: K.irem.memberId, hlc: U64_MAX })
  t.is(hus.receiveOp(kotu).code, 'INVALID_SIGNATURE')
  t.is(hus.hlc.last, once, 'geçersiz işlem saati bozmaz')
  // Geçerli ama 1 saat ileri işlem: bekler, saat ilerlemez
  const ileri = elIslem(kerem, K.kerem, { recordId: b4a.alloc(16, 8), hlc: fromMs(now() + 3_600_000) })
  t.is(hus.receiveOp(ileri).code, 'FUTURE_CLOCK')
  t.is(hus.hlc.last, once)
  t.ok(msOf(hus.hlc.next(now())) <= now(), 'yazım şimdiki saatle')
  t.is(hataOf(() => new Hlc({ last: U64_MAX }).next(0)), 'INVALID_VALUE')
  t.is(hataOf(() => Kd.encodeInner({ recordId: b4a.alloc(16), op: 0, type: '', fields: [], hlc: 1n << 64n, authorId: b4a.alloc(16), ledgerSeq: 0, ledgerHash: b4a.alloc(32), recNonce: null })), 'INVALID_VALUE')
})

test('kritik 2: imzası bozuk kopya mezara girmez; gerçeği sonra kabul edilir, budama gönderilmez', (t) => {
  const { hus, kerem } = ikili()
  const rid = kerem.put(TA, null, 'yuva.defter.not', { a: 1 })
  const gercek = kerem.outbox.filter((m) => m.type === 0x81).pop().bytes
  const bozuk = b4a.from(gercek)
  bozuk[bozuk.length - 1] ^= 1 // imzanın son baytı
  t.is(hus.receiveOp(bozuk).code, 'INVALID_SIGNATURE')
  t.is(hus.tomb.size, 0)
  t.is(hus.receiveOp(gercek).status, 'gecerli')
  t.is(hus.get(TA, rid).fields.a, 1)
  t.is(hus.pruneMsgs().length, 0)
})

test('kritik 3: history: true koleksiyonda çıkarılmış okuyucuya yeni dönem anahtarı gitmez', (t) => {
  const L = anaDefter()
  L.apply(ekle(L, K.u5, 'yetiskin', [K.kerem, K.husniye]))
  const hus = replika(L, K.husniye)
  const kerem = replika(kopya(L), K.kerem)
  hus.outbox.length = 0
  kerem.outbox.length = 0
  L.apply(at(L, K.u5, [K.kerem, K.husniye, K.irem]))
  hus.sync()
  kerem.sync()
  const u5 = hex(K.u5.memberId)
  const giden = [...hus.outbox, ...kerem.outbox].filter((m) => m.type === 0x82 && (m.to || []).includes(u5))
  t.is(giden.length, 0)
})

test('yüksek 4: dönem anahtarı (koleksiyon, dönem, dönem özeti) ile tutulur', (t) => {
  const ks = new A.KeyStore()
  const ep = { seq: 5, hash: b4a.alloc(32, 1), readers: new Map([['aa'.repeat(16), 'ebeveyn']]) }
  const entry = { keyId: I.keyIdOf(b4a.alloc(32, 7)), key: b4a.alloc(32, 7), issuerId: b4a.alloc(16, 0xaa), sig: b4a.alloc(64) }
  ks.add('c1', ep, entry, 'ebeveyn')
  t.ok(ks.get('c1', 5, b4a.alloc(32, 1), entry.keyId))
  t.is(ks.get('c1', 5, b4a.alloc(32, 2), entry.keyId), null, 'başka dalın aynı seq\'li dönemi')
  t.absent(ks.has('c1', 5, b4a.alloc(32, 2)))
  ks.dalaUydur((cid, seq) => (seq === 5 ? b4a.alloc(32, 2) : null))
  t.absent(ks.has('c1', 5, b4a.alloc(32, 1)), 'çatallanmada eşleşmeyen atılır')
})

test('yüksek 5: silinen kaydın temizliğinden sonra türü belirleyen işlem silinmez', (t) => {
  let simdi = TS0
  const L = anaDefter()
  const hus = replika(L, K.husniye, { now: () => simdi })
  const rid = hus.put(TA, null, 'yuva.defter.not', { a: 1 })
  const turOp = [...hus.ops.values()].find((o) => hex(o.inner.recordId) === rid).opId
  simdi += MIN
  hus.put(TA, rid, '', { a: 2 })
  simdi += MIN
  hus.del(TA, rid)
  simdi += 366 * DAY
  hus.put(TA, null, 'yuva.defter.not', { m: 'M ilerler' })
  hus.temizle()
  hus.sync()
  hus.sync()
  t.ok(hus.ops.has(hex(turOp)), 'tür işlemi kalır')
  t.is(hus.get(TA, rid), null)
})

test('yüksek 6: kaydın türü ve süre alanları yalnız recordId\'yi üreten yazarın işleminden', (t) => {
  let simdi = TS0 + 3_600_000
  const { hus, kerem } = ikili({ now: () => simdi })
  const irem = replika(kopya(hus.ledger), K.irem, { now: () => simdi - 10 * DAY })
  teslim(hus, irem)
  const rid = kerem.put(TA, null, 'yuva.defter.not', { baslik: 'Wifi', _t: simdi, _keep: 0 })
  t.is(rid, hex(kdf.hash('hf/rec-new/', K.kerem.memberId, kerem.ops.get([...kerem.ops.keys()].pop()).inner.recNonce).subarray(0, 16)))
  teslim(kerem, hus)
  // İrem geriye tarihli bir işlemle aynı kayda tür ve 1 günlük saklama yazmaya çalışır
  irem._write(TA, { recordId: b4a.from(rid, 'hex'), op: 0, type: 'yuva.x', fields: [{ name: '_t', value: TS0 - 10 * DAY }, { name: '_keep', value: 1 }], recNonce: null })
  teslim(irem, hus)
  const k = hus.get(TA, rid)
  t.is(k.type, 'yuva.defter.not')
  simdi += 2 * DAY
  hus.put(TA, null, 'yuva.defter.not', { m: 'M ilerler' })
  hus.temizle()
  t.ok(hus.get(TA, rid), 'başkasının _keep\'i kaydı sildiremez')
  // Var olan kayda tür yazılamaz
  t.is(hataOf(() => kerem.put(TA, rid, 'yuva.y', { a: 1 })), 'TYPE_CANNOT_CHANGE')
})

test('kritik (RFC-0006): hf.saklama\'yı yalnız ebeveyn yazar; cihazın ya da yetişkinin saklaması yok sayılır', (t) => {
  // Ebeveyn olmayanın işlemleri durumlara katılmaz (class.js, review-2.js); burada yalnız görünüm biçimi
  const v = (fields) => ({ type: 'hf.saklama', fields })
  t.alike(saklamalar([v({ tur: '*', gun: 30 }), v({ tur: '*', gun: 0 }), v({ gun: 3 }), null]), [{ tur: '*', gun: 30 }])
})

test('yüksek 7: misafirli koleksiyonda anahtarı yalnız ebeveyn üretir; uygun üreten yoksa sync düşmez', (t) => {
  const g = 'ee'.repeat(16)
  const p = 'bb'.repeat(16)
  const y = 'aa'.repeat(16)
  t.is(A.ureten(new Map([[y, 'yetiskin'], [p, 'ebeveyn'], [g, 'misafir']]), 0), p)
  t.is(A.ureten(new Map([[y, 'yetiskin'], [g, 'misafir']]), 0), null)
  t.is(A.ureten(new Map([[y, 'yetiskin'], [p, 'ebeveyn']]), 0), p)
  t.is(A.ureten(new Map([[y, 'yetiskin'], [p, 'ebeveyn']]), 1), y, '10 dakika sonra sıradaki')
  t.is(A.ureten(new Map([[y, 'yetiskin'], [p, 'ebeveyn']]), 5), y, 'liste biterse sonuncu')
})

test('düşük 15: ilk okuyucunun anahtarı 10 dakika görünmezse sıradaki üretir', (t) => {
  let simdi = TS0
  const L = anaDefter()
  const ids = [K.kerem, K.husniye].map((k) => hex(k.memberId)).sort()
  const ikinci = ids[1] === hex(K.kerem.memberId) ? K.kerem : K.husniye
  const r = replika(L, ikinci, { now: () => simdi })
  const ep = r.yetki.epochAt(TA, L.len - 1)
  t.absent(r.keys.has(TA, ep.seq, ep.hash))
  simdi += 9 * MIN
  r.sync()
  t.absent(r.keys.has(TA, ep.seq, ep.hash))
  simdi += MIN
  r.sync()
  t.ok(r.keys.has(TA, ep.seq, ep.hash))
})

test('orta 8: eşitleme misafiri ortak okuyucu saymaz', (t) => {
  const L = anaDefter(17) // misafir1 aktif (REVOKE'tan önce)
  const hus = replika(L, K.husniye)
  t.alike(E.commonCollections(hus, hex(C.misafir1.memberId)), [])
})

test('orta 9 ve düşük 18: BLOB_DEL yeniden oynatılamaz; silme yalnız tam ve doğrulanmış yüklemeyle iptal olur; yükleyen tam kümeyi gönderen', (t) => {
  let simdi = TS0
  const L = anaDefter()
  const st = new D.BlobStore({ ledger: L, now: () => simdi })
  const blob = D.encryptBlobVektor(b4a.alloc(70_000, 3), b4a.alloc(32, 1))
  const msgs = D.uploadMsgs(blob)
  st.receive(hex(K.ecem.memberId), msgs[0]) // Ecem (ebeveyn değil) yalnız ilk parçayı gönderir
  for (const m of msgs) st.receive(hex(K.irem.memberId), m)
  t.ok(st.has(blob.blobId))
  t.is(st.blobs.get(hex(blob.blobId)).uploader, hex(K.irem.memberId))
  t.is(hataOf(() => st.del(D.makeBlobDel(L.familyId, [blob.blobId], K.ecem))), 'UNAUTHORIZED', 'ilk parçayı gönderen yükleyen sayılmaz')
  const del = D.makeBlobDel(L.familyId, [blob.blobId], K.irem)
  st.del(del)
  st.receive('cc'.repeat(16), msgs[1]) // başka birinden tek parça silmeyi iptal etmez
  t.ok(st.blobs.get(hex(blob.blobId)).deleteAt !== null)
  for (const m of msgs) st.receive(hex(K.husniye.memberId), m) // tam yeniden yükleme iptal eder
  t.is(st.blobs.get(hex(blob.blobId)).deleteAt, null)
  st.del(del) // aynı silme imzası yeniden oynatılır
  t.is(st.blobs.get(hex(blob.blobId)).deleteAt, null)
  // Bozuk bir parça yalnız onu gönderenin kümesini düşürür
  const st2 = new D.BlobStore({ ledger: L, now: () => simdi })
  const kotu = b4a.from(msgs[1])
  kotu[kotu.length - 1] ^= 1
  st2.receive(hex(K.kerem.memberId), msgs[0])
  t.is(hataOf(() => st2.receive(hex(K.kerem.memberId), kotu)), 'INVALID_FILE')
  st2.receive(hex(K.irem.memberId), msgs[0])
  t.is(st2.receive(hex(K.irem.memberId), msgs[1]), 'tamam')
})

test('RFC-0019 §9: BLOB_HAVE — tutucu tam aldığını imzayla bildirir', (t) => {
  const L = anaDefter()
  const st = new D.BlobStore({ ledger: L, me: K.kutu })
  const blob = D.encryptBlobVektor(b4a.from('fatura'), b4a.alloc(32, 2))
  const out = D.uploadMsgs(blob).map((m) => st.receive(hex(K.kerem.memberId), m))
  t.alike(out, ['tamam'])
  const have = st.haveMsgs()
  t.is(have.length, 1)
  t.is(have[0].to, hex(K.kerem.memberId))
  const m = D.verifyBlobHave(L, have[0].bytes)
  t.alike(m.blobIds.map(hex), [hex(blob.blobId)])
  t.is(hex(m.holder), hex(K.kutu.memberId))
  const bozuk = b4a.from(have[0].bytes)
  bozuk[bozuk.length - 1] ^= 1
  t.is(hataOf(() => D.verifyBlobHave(L, bozuk)), 'INVALID_SIGNATURE')
  const sayac = new D.BlobHaveStore()
  sayac.al(L, have[0].bytes)
  sayac.al(L, have[0].bytes)
  t.is(sayac.kopya(blob.blobId), 1)
  t.is(hataOf(() => sayac.al(L, D.makeBlobHave(L.familyId, [blob.blobId], K.irem))), 'UNAUTHORIZED', 'tutucu kutu ya da işçi olmalı')
})

test('orta 10: REC_PRUNE\'u yalnız koleksiyonun yazarı gönderir', (t) => {
  const L = anaDefter()
  const X = b4a.alloc(16, 0x3c)
  L.apply(koleksiyon(L, [K.kerem], { collectionId: X, name: 'Ebeveyn yazar', readers: ['rol:ebeveyn', 'rol:yetiskin'], writers: ['rol:ebeveyn'] }))
  const kutu = new Kutu({ ledger: L })
  t.is(kutu.prune(E.makePrune(L.familyId, hex(X), [b4a.alloc(32, 1)], K.irem)).code, 'UNAUTHORIZED')
  t.ok(kutu.prune(E.makePrune(L.familyId, hex(X), [b4a.alloc(32, 1)], K.kerem)).ok)
  const irem = replika(L, K.irem)
  irem.tomb.set('11'.repeat(32), hex(X))
  t.is(irem.pruneMsgs().length, 0, 'yazar olmayan budama göndermez')
})

test('düşük 11–12: bilinmeyen değer etiketi INVALID_VALUE; kayıt başına en çok 256 alan', (t) => {
  const inner = Kd.encodeInner({ recordId: b4a.alloc(16), op: 0, type: 'yuva.x', fields: [{ name: 'a', value: 1 }], hlc: 1n, authorId: b4a.alloc(16), ledgerSeq: 0, ledgerHash: b4a.alloc(32), recNonce: b4a.alloc(16, 1) })
  const bozuk = b4a.from(inner)
  const i = bozuk.indexOf(b4a.from([1, 0x61, 3]))
  bozuk[i + 2] = 9 // etiket 9 tanımsız
  t.is(hataOf(() => Kd.decodeInner(bozuk)), 'INVALID_VALUE')
  const { hus } = ikili()
  const alanlar = (bas) => Object.fromEntries(Array.from({ length: 200 }, (_, j) => ['f' + (bas + j), j]))
  const rid = hus.put(TA, null, 'yuva.x', alanlar(0))
  t.is(hataOf(() => hus.put(TA, rid, '', alanlar(200))), 'FIELD_LIMIT')
})

test('düşük 13: kesim listesi bekletilen (ileri saatli) işlemleri içermez', (t) => {
  let simdi = TS0 + 3_600_000
  const L = anaDefter()
  const hus = replika(L, K.husniye, { now: () => simdi })
  const irem = replika(kopya(L), K.irem, { now: () => simdi + 3_600_000 })
  const iremBugun = replika(kopya(L), K.irem, { now: () => simdi })
  const anahtarlar = [...hus.outbox]
  teslim(hus, irem)
  hus.outbox.push(...anahtarlar)
  teslim(hus, iremBugun)
  irem.put(TA, null, 'yuva.x', { a: 1 })
  const opId = [...irem.ops.keys()][0]
  teslim(irem, hus)
  iremBugun.put(TA, null, 'yuva.x', { b: 1 }) // kesim yayımlansın diye geçerli bir işlem de var
  const gecerli = [...iremBugun.ops.keys()][0]
  teslim(iremBugun, hus)
  t.is(hus.status(opId).code, 'FUTURE_CLOCK')
  hus.outbox.length = 0
  L.apply(koleksiyon(L, [K.kerem], { writers: ['rol:ebeveyn', 'rol:cocuk'] }))
  hus.sync()
  const kesimler = hus.outbox.filter((m) => m.type === 0x88).map((m) => Kz.decodeCutoff(m.bytes))
  t.ok(kesimler.some((k) => k.opIds.some((x) => hex(x) === gecerli)))
  t.absent(kesimler.some((k) => k.opIds.some((x) => hex(x) === opId)))
})

test('düşük 16, 19, 20: kind yalnız 0/1; misafirde görünümde olmayan koleksiyon bekler; kesim parça numarası', (t) => {
  const { hus } = ikili()
  t.is(hus.receiveOp(b4a.alloc(10), 2).code, 'INVALID_MESSAGE')
  const kutu = new Kutu({ ledger: hus.ledger })
  t.is(kutu.accept(hex(K.kerem.memberId), 2, b4a.alloc(10)).code, 'INVALID_MESSAGE')
  const cs = new Kz.CutoffStore()
  t.is(hataOf(() => cs.addPart({ collectionId: b4a.alloc(16), authorId: b4a.alloc(16), eventSeq: 1, eventHash: b4a.alloc(32), issuerId: b4a.alloc(16), listHash: b4a.alloc(32), part: 3, parts: 2, opIds: [] }, b4a.alloc(1))), 'INVALID_MESSAGE')
  const { MisafirReplika } = require('../guest')
  t.ok(MisafirReplika.prototype._koleksiyonYoksa === 'bekliyor')
})

test('düşük 17: kdf.toBuf negatif ve güvenli aralık dışı sayıyı reddeder', (t) => {
  t.is(hataOf(() => kdf.toBuf(-1)), 'U64_OUT_OF_RANGE')
  t.is(hataOf(() => kdf.toBuf(2 ** 53)), 'U64_OUT_OF_RANGE')
  t.is(hataOf(() => kdf.toBuf(1.5)), 'U64_OUT_OF_RANGE')
  t.alike(kdf.toBuf(258), b4a.from([0, 0, 0, 0, 0, 0, 1, 2]))
})

test('düşük 23: üretim yolunda dışarıdan nonce ve fileKey alınmaz', (t) => {
  const a = D.encryptBlob(b4a.from('x'), b4a.alloc(32, 1))
  t.not(hex(a.fileKey), hex(b4a.alloc(32, 1)), 'ikinci argüman yok sayılır')
  t.is(I.sealOp.length, 1)
})

test('RFC-0017 bulgu 5: history: false koleksiyonda ek kimlik güncel dönemin anahtarını alır (kişi okuyucuysa)', (t) => {
  // Kişinin herhangi bir kimliği dönemde okuyucuysa yeter
  const L = anaDefter()
  const hus = replika(L, K.husniye)
  t.ok(typeof hus._kisiOkuyucu === 'function')
  t.ok(hus._kisiOkuyucu(hex(K_BAKICI), hex(K.kerem.memberId), L.len - 1))
  t.absent(hus._kisiOkuyucu(hex(K_BAKICI), hex(K.irem.memberId), L.len - 1))
  t.ok(sodium && T && olay && msOf)
})
