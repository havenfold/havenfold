// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D9: inceleme 2 bulguları (f212c1d sonrası, RFC-0019 §11.1 k–r). Beklenen değerler elle yazılmıştır.
const test = require('brittle')
const b4a = require('b4a')
const { ledger: { T, encodeEvent, decodeEvent } } = require('@havenfold/core')
const { sinifaUyar, sinifOf } = require('../class')
const { anaDefter, kopya, replika, teslim, K, K_TUM_AILE, TS0, hex, olay, ekle } = require('./helpers/family')
const A = require('../key')
const I = require('../operation')
const D = require('../file')
const E = require('../sync')
const { Kutu } = require('../box')
const { TOMB_CODES } = require('../replica')
const { fromMs } = require('../hlc')

const TA = hex(K_TUM_AILE)
const DAY = 86_400_000
const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }

// Hüsniye anahtarı üretir; Kerem alır. Kerem'in bir işlemi: gerçek ve imzası bozuk kopya.
function islemli () {
  const L = anaDefter()
  const hus = replika(L, K.husniye)
  const keys = [...hus.outbox]
  const kerem = replika(kopya(L), K.kerem)
  teslim(hus, kerem)
  const rid = kerem.put(TA, null, 'yuva.x', { a: 1 })
  const gercek = kerem.outbox.filter((m) => m.type === 0x81).pop().bytes
  const bozuk = b4a.from(gercek)
  bozuk[bozuk.length - 1] ^= 1
  const anahtarlar = keys.filter((m) => m.type === 0x82).map((m) => m.bytes)
  return { L, hus, kerem, rid, gercek, bozuk, anahtarlar, opId: hex(I.peekOp(gercek).opId) }
}

// Elle işlem: Hüsniye'nin anahtarıyla, iç alanlar serbest
function elIslem (r, signer, inner) {
  const L = r.ledger
  const ep = r.yetki.epochAt(TA, L.len - 1)
  const k = r.keys.preferred(TA, ep.seq, ep.hash)
  return I.sealOpVektor({ familyId: L.familyId, collectionId: K_TUM_AILE, epochSeq: ep.seq, key: k.key, signer, inner: { recordId: b4a.alloc(16, 9), op: 0, type: '', fields: [], recNonce: null, hlc: fromMs(TS0 + 1000), authorId: signer.memberId, ledgerSeq: L.len - 1, ledgerHash: L.head, ...inner } })
}

// Kutudan bir kovanın bütün içeriği (karşı tarafta hiç opId yok)
function kovadan (kutu, opIdHex) {
  const istek = require('compact-encoding').encode(E.recBucketIds, { collectionId: K_TUM_AILE, bucket: parseInt(opIdHex.slice(0, 2), 16), keys: [] })
  return E.onBucketIds(TA, kutu.set(TA), istek).flatMap((m) => E.decodeOps(m.bytes).items)
}

// Hüsniye, Kerem ve İrem (yetişkin); saat elle ilerler. dagit: herkesin çıkışı herkese.
function aile () {
  let simdi = TS0 + 3_600_000
  const now = () => simdi
  const L = anaDefter()
  const hus = replika(L, K.husniye, { now })
  const kerem = replika(kopya(L), K.kerem, { now })
  const irem = replika(kopya(L), K.irem, { now })
  const hepsi = [hus, kerem, irem]
  const dagit = () => {
    for (let i = 0; i < 4; i++) {
      for (const a of hepsi) {
        a.sync()
        const msgs = a.outbox.splice(0)
        for (const b of hepsi) if (b !== a) { a.outbox.push(...msgs); teslim(a, b) }
      }
    }
  }
  // Bir defter olayını herkesin defterine uygular
  const defter = (type, body, imz) => {
    const e = olay(hus.ledger, type, body, imz)
    for (const r of hepsi) r.ledger.apply(decodeEvent(encodeEvent(e)))
    dagit()
  }
  dagit()
  return { hus, kerem, irem, dagit, defter, ileri: (d) => { simdi += d } }
}

test('inceleme 2 / 1 (§11.1 k): başkasının kaydına yazılan _conf süreyi kısaltmaz', (t) => {
  const { hus, kerem, irem, dagit, ileri } = aile()
  const not = kerem.put(TA, null, 'yuva.defter.not', { m: 'önemli', _t: TS0, _keep: 365 })
  dagit()
  irem.put(TA, not, '', { _conf: 0 })
  dagit()
  t.absent('_conf' in hus.get(TA, not).fields, 'başkasının _conf\'u görünümde yok')
  ileri(10 * DAY)
  hus.put(TA, null, 'yuva.defter.not', { m: 'M ilerler' })
  hus.temizle()
  t.ok(hus.get(TA, not), '10. günde kayıt duruyor')
})

test('inceleme 2 / 1: sahibin kendi _conf\'u süreyi 7 güne indirir', (t) => {
  const { hus, kerem, dagit, ileri } = aile()
  const not = kerem.put(TA, null, 'yuva.defter.not', { m: 'tahmin', _t: TS0, _keep: 365, _conf: 40 })
  dagit()
  ileri(6 * DAY)
  hus.put(TA, null, 'yuva.defter.not', { m: 'M' })
  hus.temizle()
  t.ok(hus.get(TA, not), '6. gün')
  ileri(2 * DAY)
  hus.put(TA, null, 'yuva.defter.not', { m: 'M' })
  hus.temizle()
  t.is(hus.get(TA, not), null, '8. gün: temizlendi')
})

test('inceleme 2 / 2 (§11.1 l): ebeveynin hf.saklama kaydına ebeveyn olmayanın yazdığı gun sayılmaz', (t) => {
  const { hus, kerem, irem, dagit, ileri } = aile()
  const kural = kerem.put(TA, null, 'hf.saklama', { tur: '*', gun: 400 })
  const not = kerem.put(TA, null, 'yuva.defter.not', { m: 'önemli', _t: TS0, _keep: 365 })
  dagit()
  irem.put(TA, kural, '', { gun: 1 })
  dagit()
  t.alike(hus.get(TA, kural).fields, { gun: 400, tur: '*' })
  t.alike(irem.get(TA, kural).fields, { gun: 400, tur: '*' }, 'yazan da görmez')
  ileri(10 * DAY)
  hus.put(TA, null, 'yuva.defter.not', { m: 'M ilerler' })
  hus.temizle()
  t.ok(hus.get(TA, not))
})

test('inceleme 2 / 2: yetişkinin yazdığı hf.saklama kaydı yok sayılır; işlemi geçerli kümede kalır', (t) => {
  const { hus, irem, dagit } = aile()
  const kural = irem.put(TA, null, 'hf.saklama', { tur: '*', gun: 1 })
  dagit()
  t.is(hus.get(TA, kural), null)
  t.is(hus.validOps(TA).filter((o) => hex(o.inner.recordId) === kural).length, 1, 'işlem mezara girmedi')
})

test('inceleme 2 / 2: sınıf işlemin ledgerSeq anındaki role göre', (t) => {
  const { hus, kerem, dagit, defter } = aile()
  const kural = kerem.put(TA, null, 'hf.saklama', { tur: '*', gun: 400 })
  dagit()
  // Kerem yetişkine indirilir: ebeveynken yazdığı kural geçerli kalır, sonra yazdığı gun sayılmaz
  defter(T.SET_ROLE, { memberId: K.kerem.memberId, role: 'yetiskin' }, [K.kerem, K.husniye])
  t.alike(hus.get(TA, kural).fields, { gun: 400, tur: '*' })
  kerem.put(TA, kural, '', { gun: 2 })
  dagit()
  t.alike(hus.get(TA, kural).fields, { gun: 400, tur: '*' })
  hus.put(TA, kural, '', { gun: 30 })
  dagit()
  t.alike(kerem.get(TA, kural).fields, { gun: 30, tur: '*' }, 'ebeveynin yazdığı sayılır')
})

test('inceleme 2 / 2: katalogdaki yazar sınıfı', (t) => {
  t.is(sinifOf('hf.saklama'), 'uye')
  t.is(sinifOf('hf.vaka'), 'ikisi')
  t.is(sinifOf('hf.yok.boyle'), null)
  t.is(sinifOf('yuva.defter.not'), null)
  t.ok(sinifaUyar('hf.saklama', 'ebeveyn'))
  t.absent(sinifaUyar('hf.saklama', 'yetiskin'))
  t.absent(sinifaUyar('hf.saklama', 'cihaz'))
  t.ok(sinifaUyar('hf.vaka.kapat', 'cocuk'))
  t.absent(sinifaUyar('hf.vaka.kapat', 'cihaz'))
  t.ok(sinifaUyar('hf.vaka.basamak', 'cihaz'))
  t.absent(sinifaUyar('hf.kart', null), 'üye olmayan')
  t.ok(sinifaUyar('yuva.defter.not', null), 'hf. dışı türe bakılmaz')
})

test('inceleme 2 / 3 (§11.1 m): eski cihaz imzasız ROTATE_DEVICE sonrası yeni dönemin anahtarı eski kimliğe gitmez', (t) => {
  const L = anaDefter()
  L.apply(ekle(L, K.u5, 'yetiskin', [K.kerem, K.husniye]))
  const hus = replika(L, K.husniye)
  const kerem = replika(kopya(L), K.kerem)
  teslim(hus, kerem)
  hus.outbox.length = 0
  kerem.outbox.length = 0
  L.apply(olay(L, T.ROTATE_DEVICE, { oldMemberId: K.u5.memberId, newDeviceCert: K.u6.deviceCert, ceremonyTranscriptHash: b4a.alloc(32, 7) }, [K.u6, K.kerem, K.husniye]))
  kerem.ledger.apply(decodeEvent(encodeEvent(L.events[L.len - 1])))
  hus.sync()
  kerem.sync()
  const yeni = L.len - 1
  t.is(hus.yetki.epochAt(TA, yeni).seq, yeni, 'rotasyon yeni dönem açtı')
  const donemler = (id) => [...hus.outbox, ...kerem.outbox].filter((m) => m.type === 0x82 && (m.to || []).includes(hex(id))).map((m) => A.decodeRecKey(m.bytes).epochSeq)
  t.absent(donemler(K.u5.memberId).includes(yeni), 'u5 yeni dönemi almaz')
  t.ok(donemler(K.u6.memberId).includes(yeni), 'u6 yeni dönemi alır')
  // Anahtar isteğinde de: u5 artık okuyucu değil
  const istek = A.encodeRecKeyReq({ collectionId: K_TUM_AILE, epochs: [yeni] })
  t.exception(() => hus.answerKeyReq(hex(K.u5.memberId), istek), /UNAUTHORIZED/)
})

test('inceleme 2 / 4 (§11.1 n): kutu imzası bozuk ilk kopyayla gerçek kopyayı birlikte tutar ve sunar', (t) => {
  const { L, gercek, bozuk, anahtarlar, opId } = islemli()
  const kutu = new Kutu({ ledger: L })
  const ecem = hex(K.ecem.memberId)
  t.alike(kutu.accept(ecem, 0, bozuk), { ok: true, code: null }, 'Ecem bozuk kopyayı önce yükler')
  t.alike(kutu.accept(hex(K.kerem.memberId), 0, gercek), { ok: true, code: null }, 'gerçek kopya TEKRAR değil')
  t.alike(kutu.accept(hex(K.irem.memberId), 0, gercek), { ok: true, code: 'REPLAY' }, 'aynı imza tekrar')
  const bozuk2 = b4a.from(gercek)
  bozuk2[bozuk2.length - 2] ^= 1
  t.alike(kutu.accept(ecem, 0, bozuk2), { ok: true, code: null })
  t.is(kutu.set(TA).get(opId).kopyalar.length, 2, 'Ecem\'in ikinci kopyası birincinin yerine geçer')
  const sunulan = kovadan(kutu, opId)
  t.is(sunulan.length, 2, 'iki kopya da sunulur')
  // Kutudan okuyan İrem gerçek kopyayı kabul eder
  const irem = replika(kopya(L), K.irem, { otomatikAnahtar: false })
  for (const b of anahtarlar) irem.receiveKey(b)
  for (const it of sunulan) irem.receiveOp(it.bytes, it.kind)
  t.is(irem.validOps(TA).length, 1)
  t.ok(b4a.equals(irem.validOps(TA)[0].bytes, gercek))
})

test('inceleme 2 / 4: bir opId için en çok 4 kopya; her gönderen tek kopya', (t) => {
  const { L, gercek, opId } = islemli()
  L.apply(ekle(L, K.u5, 'yetiskin', [K.kerem, K.husniye]))
  const kutu = new Kutu({ ledger: L })
  const bozukN = (n) => { const b = b4a.from(gercek); b[b.length - 1 - n] ^= 1; return b }
  ;[K.husniye, K.irem, K.ecem, K.u5].forEach((k, i) => t.is(kutu.accept(hex(k.memberId), 0, bozukN(i)).ok, true))
  t.alike(kutu.accept(hex(K.kerem.memberId), 0, gercek), { ok: false, code: 'COPY_LIMIT' })
  t.is(kutu.set(TA).get(opId).kopyalar.length, 4)
})

test('inceleme 2 / 5 (§11.1 n): replikada bekleyen bozuk kopya gerçek kopyayı düşürmez', (t) => {
  const { L, gercek, bozuk, anahtarlar } = islemli()
  const irem = replika(kopya(L), K.irem, { otomatikAnahtar: false })
  t.is(irem.receiveOp(bozuk).code, 'NO_KEY')
  t.is(irem.receiveOp(gercek).code, 'DUPLICATE', 'gerçek kopya alternatif olarak saklanır')
  t.is(irem.receiveOp(gercek).code, 'REPLAY')
  for (const b of anahtarlar) irem.receiveKey(b)
  t.is(irem.validOps(TA).length, 1, 'anahtar gelince bozuk düşer, gerçek kabul edilir')
  t.ok(b4a.equals(irem.validOps(TA)[0].bytes, gercek))
  t.is(irem.tomb.size, 0)
  t.is(irem.receiveOp(bozuk).code, 'REPLAY', 'doğrulanmış girdiye kopya eklenmez')
})

test('inceleme 2 / 6 (§11.1 o): çatallanmada başka dalın yazarının işlemi mezara girmez ve kutudan budanmaz', (t) => {
  const L = anaDefter()
  const hus = replika(L, K.husniye)
  const LA = kopya(L)
  const husA = replika(LA, K.husniye, { otomatikAnahtar: false })
  husA.outbox.length = 0
  for (const m of hus.outbox) if (m.type === 0x82) husA.receiveKey(m.bytes)
  LA.apply(ekle(LA, K.u5, 'yetiskin', [K.kerem, K.husniye]))
  husA.sync()
  const u5 = replika(kopya(LA), K.u5)
  teslim(husA, u5)
  u5.put(TA, null, 'yuva.x', { a: 1 })
  const op = u5.outbox.find((m) => m.type === 0x81).bytes
  t.is(husA.receiveOp(op).status, 'gecerli', 'A dalında geçerli')
  L.apply(olay(L, T.PLACE, { placeId: b4a.alloc(16, 0x77), name: 'Yazlık 2', kind: 'ev', remove: false }, [K.kerem]))
  hus.sync()
  t.alike(hus.receiveOp(op), { opId: hex(I.peekOp(op).opId), status: 'reddedildi', code: 'LEDGER_FORK' })
  t.is(hus.tomb.size, 0)
  t.is(hus.pruneMsgs().length, 0)
})

test('inceleme 2 / 6: bilinmeyen yazar ve çözme hatası mezarsız; mezar kodları', (t) => {
  const { hus } = islemli()
  // Defterde olmayan bir yazar (u9), bu daldaki ledgerHash ile
  const yabanci = elIslem(hus, K.u9, {})
  t.is(hus.receiveOp(yabanci).code, 'UNKNOWN_AUTHOR')
  // Doğru anahtar, bozuk şifreli metin: opId değişir ama çözülemez
  const w = I.peekOp(elIslem(hus, K.kerem, {})).wire
  w.ct[0] ^= 1
  const bozukCt = require('compact-encoding').encode(require('../encoding').recOp, w)
  t.is(hus.receiveOp(bozukCt).code, 'DECRYPT_FAILED')
  t.is(hus.tomb.size, 0)
  t.alike([...TOMB_CODES].sort(), ['INVALID_DROP_KEY', 'DROP_TOO_LARGE', 'EPOCH_MISMATCH', 'EXTRA_FORBIDDEN', 'INVALID_OPERATION_TYPE', 'INVALID_RECORD_ID', 'PERSON_EVENT', 'SUBJECT_NOT_ALLOWED', 'PURGED', 'TYPE_NOT_ALLOWED', 'NO_PERMISSION'].sort()) // misafir kodları RFC-0030 §4
})

test('inceleme 2 / 7 (§11.1 q): BLOB_DEL.at; yeniden yükleme silmeyi yalnız ilk yükleyen ya da ebeveyn iptal eder', (t) => {
  const L = anaDefter()
  const st = new D.BlobStore({ ledger: L, now: () => TS0 })
  const blob = D.encryptBlobVektor(b4a.alloc(1000, 3), b4a.alloc(32, 1))
  const id = hex(blob.blobId)
  for (const m of D.uploadMsgs(blob)) st.receive(hex(K.irem.memberId), m)
  t.is(st.del(D.makeBlobDel(L.familyId, [blob.blobId], K.irem, 1)), 1)
  for (const m of D.uploadMsgs(blob)) st.receive(hex(K.ecem.memberId), m)
  t.not(st.blobs.get(id).deleteAt, null, 'Ecem (ilk yükleyen değil, ebeveyn değil) silmeyi iptal edemez')
  for (const m of D.uploadMsgs(blob)) st.receive(hex(K.husniye.memberId), m)
  t.is(st.blobs.get(id).deleteAt, null, 'ebeveyn iptal eder')
  t.is(st.del(D.makeBlobDel(L.familyId, [blob.blobId], K.irem, 1)), 0, 'aynı at yeniden oynatılamaz')
  t.is(st.blobs.get(id).deleteAt, null)
  t.is(st.del(D.makeBlobDel(L.familyId, [blob.blobId], K.irem, 2)), 1, 'yükleyenin yeni silmesi işlenir')
  t.not(st.blobs.get(id).deleteAt, null)
  for (const m of D.uploadMsgs(blob)) st.receive(hex(K.irem.memberId), m)
  t.is(st.blobs.get(id).deleteAt, null, 'ilk yükleyen iptal eder')
  // at özete girer: başka at ile imza geçmez
  const msg = b4a.from(D.makeBlobDel(L.familyId, [blob.blobId], K.irem, 5))
  msg[1 + 32] = 6
  t.is(hataOf(() => st.del(msg)), 'INVALID_SIGNATURE')
})

test('inceleme 2 / 8 (§11.1 p): bilinmeyen iç gövde sürümü bekler, mezara girmez', (t) => {
  const { hus } = islemli()
  const v2 = elIslem(hus, K.kerem, { v: 2 })
  t.alike(hus.receiveOp(v2), { opId: hex(I.peekOp(v2).opId), status: 'bekliyor', code: 'VERSION_UNSUPPORTED' })
  hus.sync()
  t.is(hus.status(hex(I.peekOp(v2).opId)).code, 'VERSION_UNSUPPORTED', 'sync sonrası da bekler')
  // İç gövdenin ilk baytı sürüm: 1
  t.is(require('../encoding').encodeInner({ recordId: b4a.alloc(16), op: 0, type: '', fields: [], hlc: 1n, authorId: b4a.alloc(16), ledgerSeq: 0, ledgerHash: b4a.alloc(32) })[0], 1)
  t.is(hus.tomb.size, 0)
})

test('inceleme 2 / 9 (§11.1 r): kutu budamaları kaydeder, ebeveyne gösterir; yazar budanmış işlemi yeniden yükleyebilir', (t) => {
  let simdi = TS0 + 5000
  const { L, gercek, opId } = islemli()
  const kutu = new Kutu({ ledger: L, now: () => simdi })
  kutu.accept(hex(K.kerem.memberId), 0, gercek)
  // Ecem (yazar) Kerem'in işlemini budatır
  t.alike(kutu.prune(E.makePrune(L.familyId, TA, [b4a.from(opId, 'hex'), b4a.alloc(32, 1)], K.ecem)), { ok: true, code: null })
  t.is(kutu.set(TA).size, 0)
  t.alike(kutu.budamalar(TA, hex(K.husniye.memberId)), [{ by: hex(K.ecem.memberId), at: TS0 + 5000, istenen: 2, silinen: 1 }])
  t.is(hataOf(() => kutu.budamalar(TA, hex(K.irem.memberId))), 'UNAUTHORIZED', 'yalnız ebeveyn görür')
  simdi += 1000
  t.alike(kutu.accept(hex(K.ecem.memberId), 0, gercek), { ok: false, code: 'TOMBSTONED' }, 'yazar olmayan yeniden yükleyemez')
  t.alike(kutu.accept(hex(K.kerem.memberId), 0, gercek), { ok: true, code: null }, 'yazarı yeniden yükler')
  t.is(kutu.set(TA).size, 1)
})

test('RFC-0020 f: kova özeti imzayı kapsar; kutuda yalnız bozuk kopya varken telefon gerçeğini gönderir', (t) => {
  const { L, kerem, gercek, bozuk, opId } = islemli()
  const kutu = new Kutu({ ledger: L })
  kutu.accept(hex(K.ecem.memberId), 0, bozuk)
  const set = E.phoneSet(kerem, TA)
  t.ok(set.has(opId), 'telefonda gerçek kopya')
  const istekler = kutu.onBuckets(TA, E.bucketsMsg(TA, set))
  t.is(istekler.length, 1, 'kova farklı görünür')
  for (const m of istekler) for (const ops of E.onBucketIds(TA, set, m.bytes)) for (const it of E.decodeOps(ops.bytes).items) kutu.accept(hex(K.kerem.memberId), it.kind, it.bytes)
  t.is(kutu.set(TA).get(opId).kopyalar.length, 2)
  t.ok(kutu.set(TA).get(opId).kopyalar.some((x) => b4a.equals(x.bytes, gercek)))
  t.is(kutu.onBuckets(TA, E.bucketsMsg(TA, set)).length, 1, 'kutuda fazladan bozuk kopya: kova yine farklı, ama gönderilecek yok')
  t.alike(E.onBucketIds(TA, set, kutu.onBuckets(TA, E.bucketsMsg(TA, set))[0].bytes), [])
})
