// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
const test = require('brittle')
const b4a = require('b4a')
const c = require('compact-encoding')
const { kdf, ledger: { T, decodeEvent }, zarf: { Z } } = require('@havenfold/core')
const Kd = require('../encoding')
const { Hlc, msOf, fromMs } = require('../hlc')
const I = require('../operation')
const A = require('../key')
const { checkWrite, confOf } = require('../fields')
const { vektorler, calistir, denetle } = require('./helpers/record-vector')
const { anaDefter, kopya, replika, teslim, K, C, K_TUM_AILE, K_KASA, K_BAKICI, TS0, hex, olay, koleksiyon, cihazCikar, uye } = require('./helpers/family')
const VK = require('../../../protocol/vectors/record-v2.json')

const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const h = (s) => b4a.from(s, 'hex')
const TA = hex(K_TUM_AILE)

// --- Vektörler ------------------------------------------------------------------------------------------------

test('vektörler: record.json üretici aynı dosyayı verir (belirlenimci)', (t) => {
  t.alike(JSON.parse(JSON.stringify(vektorler())), VK)
})

test('vektörler: 1 — REC_OP kodlama, opId, imza', (t) => {
  const v = VK.v1
  const { wire, opId } = I.peekOp(h(v.islem))
  t.is(hex(opId), v.opId)
  t.is(hex(wire.ct), v.ct)
  t.is(hex(wire.sig), v.imza)
  t.is(hex(I.keyIdOf(h(v.anahtar))), v.keyId)
  t.is(hex(I.adOf(h(v.familyId), h(v.collectionId), v.epochSeq, wire.keyId)), v.ad)
  t.is(hex(I.sigDigest(h(v.familyId), opId)), v.imzaOzeti)
  const inner = I.openOp(wire, h(v.familyId), h(v.anahtar))
  t.is(hex(Kd.encodeInner(inner)), v.ic)
  t.is(hex(inner.authorId), v.yazar)
  t.alike(inner.fields.map((f) => f.value), ['Wifi', 'abc123', -7, ['ev', ['a', 'b']]])
  t.ok(I.verifyOpSig(h(v.familyId), opId, wire.sig, K.irem.signKeyPair.publicKey))
})

test('vektörler: 12 — toBuf(BigInt) u64be', (t) => {
  const v = VK.v12
  t.is(hex(kdf.toBuf(BigInt(v.deger))), v.bayt)
  t.is(hex(kdf.hash('hf/test/', BigInt(v.deger))), v.ozet)
  t.is(hex(kdf.hash('hf/test/', h(v.bayt))), v.ozet)
  t.is(hex(kdf.toBuf(BigInt(v.sinir))), v.sinirBayt)
  t.is(hataOf(() => kdf.toBuf(2n ** 64n)), 'U64_OUT_OF_RANGE')
  t.is(hataOf(() => kdf.toBuf(-1n)), 'U64_OUT_OF_RANGE')
  t.alike(kdf.toBuf(7n), kdf.toBuf(7), 'sayı ve BigInt aynı')
})

test('vektörler: senaryolar (2–9, 11, 13–15) her sırada beklenen sonuç', (t) => {
  const nolar = VK.senaryolar.map((s) => s.no)
  for (const n of [2, 3, 4, 5, 6, 7, 8, 9, 11, 13, 14, 15]) t.ok(nolar.includes(n), 'senaryo ' + n)
  for (const s of VK.senaryolar) {
    for (const sira of [null, ...(s.siralar || [])]) {
      const { sonuclar } = calistir(s, sira)
      t.execution(() => denetle(s, sonuclar), 'senaryo ' + s.no + (sira ? ' sıra ' + sira.join(',') : ''))
      for (const { adim: a, sonuc } of sonuclar) if (a.t === 'denetim' && a.kayitlar) t.alike(JSON.parse(JSON.stringify(sonuc.kayitlar)), a.kayitlar)
    }
  }
})

// --- Kodlama -----------------------------------------------------------------------------------------------------

test('kodlama: kanonik — en kısa olmayan uint ve sondaki bayt reddedilir', (t) => {
  const v = VK.v1
  const bytes = h(v.islem)
  t.is(hataOf(() => Kd.decodeRecOp(b4a.concat([bytes, b4a.from([0])]))), 'INVALID_OPERATION')
  // epochSeq (9) tek baytla kodlu; 0xfd ile üç bayt yazılmış hali reddedilir
  const uzun = b4a.concat([bytes.subarray(0, 16), b4a.from([0xfd, 9, 0]), bytes.subarray(17)])
  t.is(hataOf(() => Kd.decodeRecOp(uzun)), 'INVALID_OPERATION')
  t.is(hataOf(() => Kd.decodeRecOp(b4a.alloc(Kd.MAX_OP_BYTES + 1))), 'OPERATION_TOO_LARGE')
})

test('kodlama: değer sınırları ve bilinmeyen tag', (t) => {
  const enc = (v) => c.encode(Kd.value, v)
  const dec = (b) => Kd.decodeCanonical(Kd.value, b, 'INVALID_VALUE')
  for (const v of [null, false, true, 0, -1, Kd.INT_MAX, -Kd.INT_MAX, 'ş', b4a.from('ab'), [1, [2, 'x']], { blobId: b4a.alloc(32, 1), fileKey: b4a.alloc(32, 2), size: 10, mime: 'image/png', name: 'a.png' }]) {
    t.alike(dec(enc(v)), v)
  }
  t.alike(dec(enc(b4a.alloc(0))), b4a.alloc(0))
  t.is(hataOf(() => enc(1.5)), 'INVALID_VALUE')
  t.is(hataOf(() => enc(2 ** 53 - 1)), 'INVALID_VALUE', 'c.int sınırının dışı (İstekler)')
  t.is(hataOf(() => enc('x'.repeat(16 * 1024 + 1))), 'INVALID_VALUE')
  t.is(hataOf(() => enc(new Array(65).fill(1))), 'INVALID_VALUE')
  t.is(hataOf(() => enc([[[1]]])), 'INVALID_VALUE', 'üç düzey liste')
  t.is(hataOf(() => enc({ a: 1 })), 'INVALID_VALUE')
  t.is(hataOf(() => dec(b4a.from([8]))), 'INVALID_VALUE', 'bilinmeyen tag')
})

test('kodlama: iç işlem kuralları', (t) => {
  const base = { recordId: b4a.alloc(16), op: 0, type: 'yuva.x', fields: [], hlc: 1n, authorId: b4a.alloc(16), ledgerSeq: 0, ledgerHash: b4a.alloc(32) }
  t.ok(Kd.encodeInner(base))
  t.is(hataOf(() => Kd.encodeInner({ ...base, op: 3 })), 'INVALID_OPERATION')
  t.is(hataOf(() => Kd.encodeInner({ ...base, type: 'baska.x' })), 'INVALID_OPERATION')
  t.is(hataOf(() => Kd.encodeInner({ ...base, op: 2, type: '' })), 'INVALID_OPERATION')
  t.is(hataOf(() => Kd.encodeInner({ ...base, op: 1, type: '' , fields: [{ name: 'a', value: 1 }] })), 'INVALID_OPERATION')
  t.is(hataOf(() => Kd.encodeInner({ ...base, fields: [{ name: 'A', value: 1 }] })), 'INVALID_FIELD_NAME')
  t.is(hataOf(() => Kd.encodeInner({ ...base, fields: [{ name: 'a'.repeat(65), value: 1 }] })), 'INVALID_FIELD_NAME')
  t.is(hataOf(() => Kd.encodeInner({ ...base, fields: [{ name: 'a', value: 1 }, { name: 'a', value: 2 }] })), 'INVALID_OPERATION')
  const cok = Array.from({ length: 257 }, (_, i) => ({ name: 'f' + i, value: i }))
  t.is(hataOf(() => Kd.encodeInner({ ...base, fields: cok })), 'INVALID_OPERATION')
})

test('alanlar: ayrılmış alanlar (RFC-0015 §2)', (t) => {
  t.execution(() => checkWrite({ baslik: 'x', _src: ['msg:ab'], _conf: 0, _ai: ['baslik'], _aiyol: 'kural/1', _subj: 'uye:x', _keep: 5 }))
  t.is(hataOf(() => checkWrite({ _by: 'kerem' })), 'RESERVED_FIELD', 'yazar alanı yoktur')
  t.is(hataOf(() => checkWrite({ _conf: 101 })), 'INVALID_FIELD_VALUE')
  t.is(hataOf(() => checkWrite({ _src: Array(17).fill('msg:a') })), 'INVALID_FIELD_VALUE')
  t.is(hataOf(() => checkWrite({ _src: ['x'.repeat(201)] })), 'INVALID_FIELD_VALUE')
  t.is(confOf({}), 100)
  t.is(confOf({ _conf: 150 }), 0)
  t.is(confOf({ _conf: 42 }), 42)
})

test('hlc: yazarken max(şimdi << 16, son + 1), alırken max; kalıcı yazım', (t) => {
  const yazilan = []
  const hc = new Hlc({ persist: (x) => yazilan.push(x) })
  const a = hc.next(1000)
  t.is(a, fromMs(1000))
  const b = hc.next(1000)
  t.is(b, a + 1n)
  hc.observe(fromMs(5000))
  t.is(hc.next(2000), fromMs(5000) + 1n, 'geride saat sayacı ilerletir')
  t.is(msOf(fromMs(5000) + 3n), 5000)
  t.is(yazilan.length, 4)
})

// --- Replika: yazma, okuma, geçerlilik -------------------------------------------------------------------------

test('replika: yazma, iki cihaz arasında birleştirme, silme ve geri getirme', (t) => {
  const L1 = anaDefter()
  const hus = replika(L1, K.husniye)
  const irem = replika(kopya(L1), K.irem)
  teslim(hus, irem)
  const rid = irem.put(TA, null, 'yuva.defter.not', { baslik: 'Wifi', sifre: 'abc' })
  t.is(irem.get(TA, rid).fields.sifre, 'abc')
  teslim(irem, hus)
  t.alike(hus.get(TA, rid), irem.get(TA, rid))
  hus.del(TA, rid)
  teslim(hus, irem)
  t.is(irem.get(TA, rid), null)
  irem.put(TA, rid, '', { not: 'geri' })
  teslim(irem, hus)
  t.alike(hus.get(TA, rid).fields, { not: 'geri' }, 'silmeden önceki alanlar görünmez')
  t.is(hus.get(TA, rid).type, 'yuva.defter.not', 'tür ilk işlemden')
})

test('replika: çocuk ebeveyn koleksiyonuna, kimse kasaya izinsiz yazamaz', (t) => {
  const L = anaDefter()
  const ecem = replika(L, K.ecem)
  t.is(hataOf(() => ecem.put(hex(K_KASA), null, 'yuva.x', { a: 1 })), 'NO_PERMISSION')
  const irem = replika(kopya(L), K.irem)
  t.is(hataOf(() => irem.put(hex(K_BAKICI), null, 'yuva.x', { a: 1 })), 'NO_PERMISSION')
})

test('replika: yetkisiz yazarın işlemi mezar listesine girer, yeniden kabul edilmez', (t) => {
  const L = anaDefter()
  const hus = replika(L, K.husniye)
  const ep = hus.yetki.epochAt(hex(K_KASA), L.len - 1)
  const key = hus.keys.preferred(hex(K_KASA), ep.seq, ep.hash)
  const bytes = I.sealOp({ familyId: L.familyId, collectionId: K_KASA, epochSeq: ep.seq, key: key.key, signer: K.irem, inner: { recordId: b4a.alloc(16, 1), op: 0, type: 'yuva.x', fields: [], hlc: fromMs(TS0), authorId: K.irem.memberId, ledgerSeq: L.len - 1, ledgerHash: L.head } })
  const r = hus.receiveOp(bytes)
  t.is(r.status, 'reddedildi')
  t.is(r.code, 'NO_PERMISSION')
  t.is(hus.receiveOp(bytes).code, 'TOMBSTONED')
})

test('replika: başka yazarın imzası, ileri saat, defter geride', (t) => {
  const L = anaDefter()
  const hus = replika(L, K.husniye)
  const ep = hus.yetki.epochAt(TA, L.len - 1)
  const key = hus.keys.preferred(TA, ep.seq, ep.hash).key
  const mk = (ek = {}, signer = K.irem) => I.sealOp({ familyId: L.familyId, collectionId: K_TUM_AILE, epochSeq: ep.seq, key, signer, inner: { recordId: b4a.alloc(16, 2), op: 0, type: 'yuva.x', fields: [], hlc: fromMs(TS0), authorId: K.irem.memberId, ledgerSeq: L.len - 1, ledgerHash: L.head, ...ek } })
  t.is(hus.receiveOp(mk({}, K.kerem)).code, 'INVALID_SIGNATURE', 'imzalayan iç authorId ile eşleşmeli')
  t.is(hus.receiveOp(mk({ hlc: fromMs(TS0 + 3_600_000 + 6 * 60_000) })).code, 'FUTURE_CLOCK')
  t.is(hus.receiveOp(mk({ ledgerSeq: L.len, hlc: fromMs(TS0 + 1) })).code, 'LEDGER_BEHIND')
  t.is(hus.receiveOp(mk({ ledgerHash: b4a.alloc(32, 9), hlc: fromMs(TS0 + 2) })).code, 'LEDGER_FORK')
  t.is(hus.receiveOp(mk({ op: 2, hlc: fromMs(TS0 + 3) })).code, 'INVALID_OPERATION_TYPE', 'üye append-event yazamaz')
})

test('replika: §7.1 — okuyucu çıkınca yeni dönem anahtarı gelene kadar yazım kuyrukta', (t) => {
  const L = anaDefter()
  const hus = replika(L, K.husniye)
  const L2 = kopya(L)
  const kerem = replika(L2, K.kerem, { otomatikAnahtar: false })
  teslim(hus, kerem)
  // Yetişkin okuyuculardan çıkar: yeni dönem
  const e = koleksiyon(L, [K.kerem], { readers: ['rol:ebeveyn', 'rol:cocuk'], writers: ['rol:ebeveyn', 'rol:cocuk'] })
  L.apply(e)
  L2.apply(decodeEvent(require('@havenfold/core').ledger.encodeEvent(e)))
  kerem.sync()
  const rid = kerem.put(TA, null, 'yuva.defter.not', { gizli: 'yeni' })
  t.is(kerem.writeQueue.length, 1, 'eski dönemle yazmadı')
  t.is(kerem.get(TA, rid), null)
  hus.sync() // Hüsniye sıralamada ilk: yeni dönem anahtarını üretir
  teslim(hus, kerem, [Z.REC_KEY])
  t.is(kerem.writeQueue.length, 0)
  t.is(kerem.get(TA, rid).fields.gizli, 'yeni')
  const op = [...kerem.ops.values()].find((o) => hex(o.inner.recordId) === rid)
  t.is(op.wire.epochSeq, L.len - 1)
})

test('replika: §9.5 anahtar isteme — history: false önceki dönemi vermez', (t) => {
  const v = VK.senaryolar.find((s) => s.no === 8)
  const { r } = calistir(v)
  // Kerem önceki dönemin anahtarına sahip olsun; İrem ister
  const ker = calistir({ ...v, gozlemci: 'kerem', adimlar: [{ t: 'olay', i: 0 }, { t: 'anahtar', hex: v.oncekiAnahtar }, { t: 'olay', i: 1 }] }).r
  const X = b4a.alloc(16, 0x3a)
  const ep1 = ker.yetki.epochs(hex(X))[0].seq
  t.is(hataOf(() => ker.answerKeyReq(hex(K.irem.memberId), A.encodeRecKeyReq({ collectionId: X, epochs: [ep1] }))), 'UNAUTHORIZED')
  t.is(hataOf(() => ker.answerKeyReq(hex(K.ecem.memberId), A.encodeRecKeyReq({ collectionId: X, epochs: [] }))), 'UNAUTHORIZED', 'okuyucu değil')
  const cevap = ker.answerKeyReq(hex(K.husniye.memberId), A.encodeRecKeyReq({ collectionId: X, epochs: [ep1] }))
  t.is(cevap.length, 1)
  t.is(r.receiveKey(cevap[0].bytes).status, 'reddedildi', 'İrem o dönemde okuyucu değildi: anahtarı eline geçse de saklamaz')
})

test('yetki: dönem kuralları — imzalı cihaz değişimi dönem açmaz, imzasızı açar; kasada cihaz çıkışı', (t) => {
  const L = anaDefter()
  const hus = replika(L, K.husniye)
  const sayi = (cid) => hus.yetki.epochs(cid).length
  const ta0 = sayi(TA)
  L.apply(olay(L, T.ROTATE_DEVICE, { oldMemberId: K.irem.memberId, newDeviceCert: K.u5.deviceCert, ceremonyTranscriptHash: b4a.alloc(32, 7) }, [K.u5, K.irem, K.kerem]))
  hus.sync()
  t.is(sayi(TA), ta0, 'eski cihaz imzaladı: dönem yok')
  t.ok(hus.yetki.isReader(TA, hex(K.u5.memberId), L.len - 1))
  L.apply(olay(L, T.ROTATE_DEVICE, { oldMemberId: K.u5.memberId, newDeviceCert: K.u6.deviceCert, ceremonyTranscriptHash: b4a.alloc(32, 7) }, [K.u6, K.kerem, K.husniye]))
  hus.sync()
  t.is(sayi(TA), ta0 + 1, 'eski cihaz imzalamadı: yeni dönem')
  const kasa0 = sayi(hex(K_KASA))
  L.apply(cihazCikar(L, C.isci1, [K.kerem]))
  hus.sync()
  t.is(sayi(hex(K_KASA)), kasa0 + 1, 'kasada her cihaz çıkışı yeni dönem')
  t.is(sayi(TA), ta0 + 1, 'normal koleksiyonda değil')
})

test('yetki: yazar aralıkları defterden; çatallanmada baştan kurulur', (t) => {
  const L = anaDefter()
  const hus = replika(L, K.husniye)
  const irem = hex(K.irem.memberId)
  t.ok(hus.yetki.isWriter(TA, irem, L.len - 1))
  t.absent(hus.yetki.isWriter(TA, irem, 8), 'koleksiyon oluşmadan önce')
  t.absent(hus.yetki.isWriter(TA, hex(C.isci1.memberId), L.len - 1), 'cihaz Tüm Aile yazarı değil')
  t.ok(hus.yetki.isWriter(hex(require('./helpers/family').K_OLAYLAR), hex(C.isci1.memberId), L.len - 1), 'olaylar koleksiyonunda device: yazar')
  const L2 = anaDefter(L.len - 1)
  L.replaceWith(L2.events)
  hus.sync()
  t.is(hus.yetki.shadow.len, L2.len)
})

test('kesim: yayımlayan kurallar ve parçalar', (t) => {
  const Kz = require('../cutoff')
  const L = anaDefter()
  const ids = Array.from({ length: 3001 }, (_, i) => kdf.hash('x', i))
  const msgs = Kz.makeCutoff({ familyId: L.familyId, collectionId: K_TUM_AILE, authorId: K.irem.memberId, eventSeq: 3, eventHash: L.hashAt(3), opIds: ids, issuer: K.kerem })
  t.is(msgs.length, 3)
  const st = new Kz.CutoffStore()
  t.is(st.addPart(Kz.decodeCutoff(msgs[2]), msgs[2]), 'eksik')
  t.is(st.addPart(Kz.decodeCutoff(msgs[0]), msgs[0]), 'eksik')
  t.is(st.addPart(Kz.decodeCutoff(msgs[0]), msgs[0]), 'tekrar')
  t.is(st.addPart(Kz.decodeCutoff(msgs[1]), msgs[1]), 'tamam')
  t.is(st.union(TA, hex(K.irem.memberId), 3, L.hashAt(3)).size, 3001)
  // Zincir: cihaz değiştiren yazarın eski ve yeni kimliği birbirinin kesimini yayımlayamaz
  L.apply(olay(L, T.ROTATE_DEVICE, { oldMemberId: K.irem.memberId, newDeviceCert: K.u5.deviceCert, ceremonyTranscriptHash: b4a.alloc(32, 7) }, [K.u5, K.irem, K.kerem]))
  t.ok(Kz.rotationChain(L, hex(K.irem.memberId)).has(hex(K.u5.memberId)))
  t.ok(Kz.rotationChain(L, hex(K.u5.memberId)).has(hex(K.irem.memberId)))
})

test('anahtar: misafirli koleksiyonda anahtarı yalnız ebeveyn üretir', (t) => {
  const L = anaDefter(17) // misafir1 aktif, bakıcı koleksiyonunun okuyucusu
  const hus = replika(L, K.husniye, { otomatikAnahtar: false })
  const ep = hus.yetki.epochAt(hex(K_BAKICI), L.len - 1)
  t.is(ep.readers.get(hex(C.misafir1.memberId)), 'misafir')
  const entry = A.makeKeyEntry({ familyId: L.familyId, collectionId: K_BAKICI, epochSeq: ep.seq, epochHash: ep.hash, key: b4a.alloc(32, 1), issuer: K.kerem })
  t.ok(A.verifyKeyEntry({ familyId: L.familyId, collectionId: K_BAKICI, epoch: ep, entry, signPubOf: (id) => L.entity(id).signPub }))
  const sahte = { ...ep, readers: new Map([...ep.readers, [hex(K.irem.memberId), 'yetiskin']]) }
  const e2 = A.makeKeyEntry({ familyId: L.familyId, collectionId: K_BAKICI, epochSeq: ep.seq, epochHash: ep.hash, key: b4a.alloc(32, 2), issuer: K.irem })
  t.is(hataOf(() => A.verifyKeyEntry({ familyId: L.familyId, collectionId: K_BAKICI, epoch: sahte, entry: e2, signPubOf: (id) => L.entity(id).signPub })), 'KEY_UNAUTHORIZED')
  t.is(hataOf(() => A.verifyKeyEntry({ familyId: L.familyId, collectionId: K_BAKICI, epoch: ep, entry: { ...entry, key: b4a.alloc(32, 3) }, signPubOf: (id) => L.entity(id).signPub })), 'INVALID_KEY')
})

test('anahtar: yeni yazımda tercih — ebeveyn, sonra küçük kimlik, sonra küçük keyId', (t) => {
  const st = new A.KeyStore()
  const ep = { seq: 1, hash: b4a.alloc(32) }
  const e = (n, issuer) => ({ keyId: I.keyIdOf(b4a.alloc(32, n)), key: b4a.alloc(32, n), issuerId: h(issuer), sig: b4a.alloc(64) })
  st.add('c', ep, e(1, 'ff'.repeat(16)), 'yetiskin')
  st.add('c', ep, e(2, 'ee'.repeat(16)), 'ebeveyn')
  st.add('c', ep, e(3, '01'.repeat(16)), 'yetiskin')
  t.alike(st.preferred('c', 1, ep.hash).key, b4a.alloc(32, 2))
  st.add('c', ep, e(4, '00'.repeat(16)), 'ebeveyn')
  t.alike(st.preferred('c', 1, ep.hash).key, b4a.alloc(32, 4))
  t.is(st.add('c', ep, e(4, '00'.repeat(16)), 'ebeveyn'), false, 'aynı anahtar ikinci kez eklenmez')
})

test('uye: kişisel koleksiyon yalnız sahibinin', (t) => {
  const L = anaDefter()
  const irem = replika(L, K.irem)
  const kis = hex(require('./helpers/family').K_KISISEL_IREM)
  const rid = irem.put(kis, null, 'yuva.defter.not', { gunluk: 'özel' })
  t.is(irem.get(kis, rid).fields.gunluk, 'özel')
  const kerem = replika(kopya(L), K.kerem)
  teslim(irem, kerem)
  t.is(kerem.get(kis, rid), null, 'ebeveyn okuyucu değil: anahtar almaz')
  t.is(hataOf(() => kerem.put(kis, null, 'yuva.x', { a: 1 })), 'NO_PERMISSION')
  t.ok(uye)
})

test('temizlik: süreli kayıt (_keep) — M\'ye göre; hf.saklama süreyi kısaltır; temizlenen kayda yazılamaz', (t) => {
  const L = anaDefter()
  let simdi = TS0
  const hus = replika(L, K.husniye, { now: () => simdi })
  const DAY = 86_400_000
  const olay = hus.put(TA, null, 'yuva.pet.eat', { _t: TS0, _keep: 30, miktar: 1 })
  const kalici = hus.put(TA, null, 'yuva.defter.not', { a: 1 })
  simdi = TS0 + 29 * DAY
  hus.put(TA, null, 'yuva.defter.not', { m: 'M ilerler' })
  hus.temizle()
  t.ok(hus.get(TA, olay), '29 gün: kalır')
  simdi = TS0 + 31 * DAY
  hus.put(TA, null, 'yuva.defter.not', { m: 'M ilerler' })
  hus.temizle()
  t.is(hus.get(TA, olay), null, '31 gün: temizlendi')
  t.ok(hus.get(TA, kalici), 'süresiz kayıt kalır')
  hus.put(TA, olay, '', { miktar: 2 })
  t.is(hus.get(TA, olay), null, 'temizlenen recordId ile gelen yeni put reddedilir')
  t.ok([...hus.tomb.keys()].length >= 2)

  // hf.saklama { tur: 'yuva.pet.', gun: 20 } → etkin 20 gün
  const olay2 = hus.put(TA, null, 'yuva.pet.eat', { _t: simdi, _keep: 30 })
  hus.put(TA, null, 'hf.saklama', { tur: 'yuva.pet.', gun: 20 })
  simdi += 21 * DAY
  hus.put(TA, null, 'yuva.defter.not', { m: 'M' })
  hus.temizle()
  t.is(hus.get(TA, olay2), null)
  const { effectiveKeep } = require('../cleanup')
  t.is(effectiveKeep(30, 'yuva.pet.eat', 40, []), 7, 'düşük güvende en çok 7')
  t.is(effectiveKeep(0, 'yuva.pet.eat', 100, [{ tur: '*', gun: 5 }]), 5)
  t.is(effectiveKeep(0, 'yuva.pet.eat', 100, []), Infinity)
})

test('append-event: cihaz yazar; kendi yazdığını okuyamaz; dropKey ledgerSeq anında yürürlükte olmalı', (t) => {
  const v = VK.senaryolar.find((s) => s.no === 11)
  const { r } = calistir(v)
  const rec = r.records(hex(b4a.alloc(16, 0x3b)))[0]
  t.is(rec.type, 'yuva.pet.eat')
  const { appendRecordId } = require('../replica')
  t.is(rec.recordId, hex(appendRecordId(C.isci1.memberId, fromMs(TS0 + 130_000))))
  // Cihazın replikası anahtar almaz: kendi bıraktığını açamaz
  const isci = calistir({ ...v, gozlemci: 'isci1', adimlar: v.adimlar.filter((a) => a.t === 'olay' || a.t === 'islem') }).r
  t.is(isci.records(hex(b4a.alloc(16, 0x3b))).length, 0)
})

test('açılış öncesi inceleme: defterin gerisindeki REC_KEY ve REC_CUTOFF bekletmesi sınırlı (en çok 256)', (t) => {
  const A = require('./helpers/family')
  const { encodeRecKey } = require('../key')
  const L = A.anaDefter()
  const r = A.replika(L, A.K.husniye)
  const ileri = (i) => encodeRecKey({ collectionId: b4a.alloc(16, 1), epochSeq: L.len + i, epochHash: b4a.alloc(32), keys: [], dropSecrets: [] })
  let bekliyor = 0
  for (let i = 0; i < 300; i++) if (r.receiveKey(ileri(i)).status === 'bekliyor') bekliyor++
  t.is(bekliyor, 300, 'hepsi defter geride diye bekletildi')
  t.ok(r.pendingKeys.length <= 256, 'bekleyen anahtar en çok 256: ' + r.pendingKeys.length)
})
