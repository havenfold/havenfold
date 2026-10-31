// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// protocol/vectors/record-v2.json üreticisi (RFC-0001 §17). Belirlenimci: sabit anahtarlar, sabit nonce, Ed25519.
//
// Her senaryo ledger-v21.json ana zincirinin ilk `onek` olayıyla başlar. `adimlar` sırayla uygulanır:
//   { t: 'olay', i }            ekOlaylar[i] deftere eklenir, replika sync() yapar
//   { t: 'anahtar', hex }       REC_KEY
//   { t: 'islem', kind, hex }   REC_OP (0) ya da REC_DROP (1)
//   { t: 'kesim', hex }         REC_CUTOFF
//   { t: 'denetim', durumlar, kayitlar? }  o andaki beklenen durum
// `siralar` verilmişse her sıra (adım indeksleri) aynı sonuca varmalıdır.
const b4a = require('b4a')
const sodium = require('sodium-native')
const { ledger: { Ledger, T, encodeEvent, decodeEvent, prekeyBody }, kdf } = require('@havenfold/core')
const { Replika } = require('../../replica')
const I = require('../../operation')
const A = require('../../key')
const Kz = require('../../cutoff')
const { encodeInner, OP } = require('../../encoding')
const { fromMs } = require('../../hlc')
const { newRecordId } = require('../../merge')
const V = require('../../../core/test/helpers/v21')

const { K, C, TS0, olay, koleksiyon, anaAdimlar, K_TUM_AILE, uye } = V
const hex = (b) => b4a.toString(b, 'hex')
const id16 = (n) => b4a.alloc(16, n)
const SIMDI = TS0 + 30 * 86_400_000 // senaryoların yerel saati (ileri saat sınırına takılmasın)

function anaZincir () {
  const L = new Ledger()
  const olaylar = []
  for (const f of anaAdimlar(L)) { const e = f(); L.apply(e); olaylar.push(e) }
  return olaylar
}
const ANA = anaZincir()
const N = ANA.length

function defter (onek, ek = []) {
  const L = new Ledger()
  for (const e of ANA.slice(0, onek)) L.apply(decodeEvent(encodeEvent(e)))
  for (const e of ek) L.apply(decodeEvent(encodeEvent(e)))
  return L
}

// Senaryo kurucu: ekOlaylar sırayla üretilir (her biri bir önceki duruma göre)
function ekOlaylar (onek, kurucular) {
  const L = defter(onek)
  const out = []
  for (const f of kurucular) { const e = f(L); L.apply(e); out.push(e) }
  return out
}

const anahtar = (n) => b4a.alloc(32, n)
const nonce = (n) => b4a.alloc(24, n)

function keyMsg ({ L, cid, epochSeq, key, issuer }) {
  const entry = A.makeKeyEntry({ familyId: L.familyId, collectionId: cid, epochSeq, epochHash: L.hashAt(epochSeq), key, issuer })
  return A.encodeRecKey({ collectionId: cid, epochSeq, epochHash: L.hashAt(epochSeq), keys: [entry], dropSecrets: [] })
}

// Senaryolardaki mantıksal kayıt kimliği → sahip recordId (RFC-0019 §11.1 c). Türü belirleyen put işlemi
// recNonce = hash('kayit-vektor/rec-nonce', mantıksal kimlik)[0..16] taşır; recordId = hash('hf/rec-new/', yazar, recNonce).
const KIMLIKLER = new Map()
function kayitKimligi (mantiksal) { return KIMLIKLER.get(hex(mantiksal)) || mantiksal }

function op ({ L, cid, epochSeq, key, yazar, recordId, tur = '', alanlar = {}, hlcMs, ledgerSeq = L.len - 1, sayac = 0, n = 1, islem = OP.PUT, sahip = true }) {
  let recNonce = null
  let rid = kayitKimligi(recordId)
  if (tur && islem === OP.PUT && sahip) {
    recNonce = kdf.hash('kayit-vektor/rec-nonce', recordId).subarray(0, 16)
    rid = newRecordId(yazar.memberId, recNonce)
    KIMLIKLER.set(hex(recordId), rid)
  }
  const inner = {
    recordId: rid, op: islem, type: tur, fields: Object.entries(alanlar).map(([name, value]) => ({ name, value })),
    hlc: fromMs(hlcMs) + BigInt(sayac), authorId: yazar.memberId, ledgerSeq, ledgerHash: L.hashAt(ledgerSeq), recNonce
  }
  return I.sealOpVektor({ familyId: L.familyId, collectionId: cid, epochSeq, key, inner, signer: yazar, nonce: nonce(n) })
}

const opIdHex = (bytes) => hex(I.peekOp(bytes).opId)

// --- Senaryo çalıştırıcı (test ve üretici aynı kodu kullanır) ----------------------------------------------

function kimlik (ad) { return K[ad] || C[ad] }

function calistir (s, sira = null) {
  const L = defter(s.onek)
  const r = new Replika({ ledger: L, me: kimlik(s.gozlemci), now: () => s.simdi || SIMDI, otomatikAnahtar: false })
  r.sync()
  const adimlar = sira ? sira.map((i) => s.adimlar[i]) : s.adimlar
  // Her adımın sonucu: anahtarda durum, kesimde kod, denetimde { durumlar, kayitlar }
  const sonuclar = []
  for (const a of adimlar) {
    let x = null
    if (a.t === 'olay') { L.apply(decodeEvent(b4a.from(s.ekOlaylar[a.i], 'hex'))); r.sync() }
    if (a.t === 'anahtar') x = r.receiveKey(b4a.from(a.hex, 'hex')).status
    if (a.t === 'islem') r.receiveOp(b4a.from(a.hex, 'hex'), a.kind)
    if (a.t === 'kesim') x = r.receiveCutoff(b4a.from(a.hex, 'hex')).code
    if (a.t === 'temizle') x = r.temizle()
    if (a.t === 'denetim') x = durumu(r, a)
    sonuclar.push({ adim: a, sonuc: x })
  }
  return { r, sonuclar }
}

function durumu (r, a) {
  const d = {}
  for (const id of Object.keys(a.durumlar || {})) d[id] = r.status(id)?.status || 'yok'
  const out = { durumlar: d }
  if (a.cid) out.kayitlar = r.records(a.cid)
  return out
}

// Beklentiler elle yazılır; üretici yalnız uygulamanın onlara uyduğunu denetler ve kayıtların içeriğini ekler
function denetle (s, sonuclar) {
  for (const { adim: a, sonuc } of sonuclar) {
    if ((a.t === 'anahtar' || a.t === 'kesim') && 'beklenen' in a && sonuc !== a.beklenen) throw new Error(`senaryo ${s.no}: ${a.t} ${sonuc} ≠ ${a.beklenen}`)
    if (a.t === 'denetim') for (const [id, v] of Object.entries(a.durumlar)) if (sonuc.durumlar[id] !== v) throw new Error(`senaryo ${s.no}: ${id.slice(0, 8)} ${sonuc.durumlar[id]} ≠ ${v}`)
  }
}

// --- Senaryolar ------------------------------------------------------------------------------------------------

const TA = K_TUM_AILE
const tumAileEpoch = 9 // ana zincirde Tüm Aile koleksiyonunun oluşturulduğu olay

function v1 () {
  const L = defter(N)
  const key = anahtar(0x11)
  const recNonce = b4a.alloc(16, 0xa1)
  const inner = { recordId: newRecordId(K.irem.memberId, recNonce), recNonce, op: OP.PUT, type: 'yuva.defter.not', fields: [{ name: 'baslik', value: 'Wifi' }, { name: 'sifre', value: 'abc123' }, { name: 'adet', value: -7 }, { name: 'etiket', value: ['ev', ['a', 'b']] }], hlc: fromMs(TS0 + 50_000), authorId: K.irem.memberId, ledgerSeq: N - 1, ledgerHash: L.head }
  const bytes = I.sealOpVektor({ familyId: L.familyId, collectionId: TA, epochSeq: tumAileEpoch, key, inner, signer: K.irem, nonce: nonce(0x22) })
  const { wire, opId } = I.peekOp(bytes)
  return {
    no: 1,
    aciklama: 'Sabit anahtar ve nonce ile REC_OP: iç kodlama, AD, opId, imza, tel biçimi',
    familyId: hex(L.familyId),
    collectionId: hex(TA),
    epochSeq: tumAileEpoch,
    anahtar: hex(key),
    keyId: hex(I.keyIdOf(key)),
    nonce: hex(nonce(0x22)),
    ic: hex(encodeInner(inner)),
    ad: hex(I.adOf(L.familyId, TA, tumAileEpoch, wire.keyId)),
    ct: hex(wire.ct),
    opId: hex(opId),
    imzaOzeti: hex(I.sigDigest(L.familyId, opId)),
    imza: hex(wire.sig),
    yazar: hex(K.irem.memberId),
    islem: hex(bytes)
  }
}

// Vektör 2 ve 3: birleştirme
function v2 () {
  const L = defter(N)
  const key = anahtar(0x12)
  const k = keyMsg({ L, cid: TA, epochSeq: tumAileEpoch, key, issuer: K.husniye })
  const base = { L, cid: TA, epochSeq: tumAileEpoch, key }
  const r1 = id16(0xb1)
  const r2 = id16(0xb2)
  const ops = [
    op({ ...base, yazar: K.irem, recordId: r1, tur: 'yuva.defter.not', alanlar: { a: 1, b: 'ilk' }, hlcMs: TS0 + 60_000, n: 1 }),
    op({ ...base, yazar: K.kerem, recordId: r1, alanlar: { b: 'kerem' }, hlcMs: TS0 + 61_000, n: 2 }),
    op({ ...base, yazar: K.husniye, recordId: r1, alanlar: { c: true }, hlcMs: TS0 + 59_000, n: 3 }),
    op({ ...base, yazar: K.irem, recordId: r2, tur: 'yuva.defter.gorev', alanlar: { x: 'silinecek' }, hlcMs: TS0 + 60_000, n: 4 }),
    op({ ...base, yazar: K.kerem, recordId: r2, islem: OP.DEL, hlcMs: TS0 + 62_000, n: 5 }),
    op({ ...base, yazar: K.husniye, recordId: r2, alanlar: { y: 'geri' }, hlcMs: TS0 + 63_000, n: 6 })
  ]
  const adimlar = [{ t: 'anahtar', hex: hex(k) }, ...ops.map((b) => ({ t: 'islem', kind: 0, hex: hex(b) })),
    { t: 'denetim', cid: hex(TA), durumlar: Object.fromEntries(ops.map((b) => [opIdHex(b), 'gecerli'])) }]
  return {
    no: 2,
    aciklama: 'Aynı işlem kümesi üç farklı sırada uygulanır: aynı durum. r2 silinir ve sonraki put ile geri gelir; yalnız sonraki alan görünür.',
    onek: N,
    gozlemci: 'ecem',
    ekOlaylar: [],
    adimlar,
    siralar: [[0, 1, 2, 3, 4, 5, 6, 7], [0, 6, 5, 4, 3, 2, 1, 7], [0, 3, 1, 6, 4, 2, 5, 7]]
  }
}

function v3 () {
  const L = defter(N)
  const key = anahtar(0x13)
  const k = keyMsg({ L, cid: TA, epochSeq: tumAileEpoch, key, issuer: K.husniye })
  const base = { L, cid: TA, epochSeq: tumAileEpoch, key, yazar: K.irem, recordId: id16(0xc1), tur: 'yuva.defter.not', hlcMs: TS0 + 70_000 }
  const a = op({ ...base, alanlar: { renk: 'mavi' }, n: 7 })
  const b = op({ ...base, alanlar: { renk: 'kirmizi' }, n: 8 })
  const kazanan = b4a.compare(I.peekOp(a).opId, I.peekOp(b).opId) > 0 ? 'mavi' : 'kirmizi'
  return {
    no: 3,
    aciklama: 'Eşit hlc ve aynı yazar: opId bayt sırasıyla büyük olan kazanır. Beklenen renk: ' + kazanan,
    onek: N,
    gozlemci: 'kerem',
    ekOlaylar: [],
    adimlar: [{ t: 'anahtar', hex: hex(k) }, { t: 'islem', kind: 0, hex: hex(a) }, { t: 'islem', kind: 0, hex: hex(b) },
      { t: 'denetim', cid: hex(TA), durumlar: { [opIdHex(a)]: 'gecerli', [opIdHex(b)]: 'gecerli' } }],
    siralar: [[0, 1, 2, 3], [0, 2, 1, 3]],
    beklenenRenk: kazanan
  }
}

// Tüm Aile'nin yazar listesinden yetişkin düşer (okuyucu kalır): İrem'in yazar aralığı biter (§8.1)
const daralt = (L) => koleksiyon(L, [K.kerem], { writers: ['rol:ebeveyn', 'rol:cocuk'] })
const genislet = (L) => koleksiyon(L, [K.kerem], { writers: ['rol:ebeveyn', 'rol:yetiskin', 'rol:cocuk'] })

// Vektör 4, 13, 15: kesim birleşimi, kendi kesimi, zaman sınırı
function kesimSenaryosu () {
  const ek = ekOlaylar(N, [daralt])
  const Lk = defter(N, ek) // olaydan sonra
  const L0 = defter(N) // olaydan önce
  const key = anahtar(0x14)
  const k = keyMsg({ L: L0, cid: TA, epochSeq: tumAileEpoch, key, issuer: K.husniye })
  const base = { L: L0, cid: TA, epochSeq: tumAileEpoch, key, yazar: K.irem, tur: 'yuva.defter.not' }
  const A1 = op({ ...base, recordId: id16(0xd1), alanlar: { v: 'A' }, hlcMs: TS0 + 80_000, n: 11 })
  const B1 = op({ ...base, recordId: id16(0xd2), alanlar: { v: 'B' }, hlcMs: TS0 + 81_000, n: 12 }) // geriye dönük
  const C1 = op({ ...base, recordId: id16(0xd3), alanlar: { v: 'C' }, hlcMs: TS0 + 82_000, n: 13 }) // kimse görmedi
  const ileri = ek[0].ts + 2 * 86_400_000
  const D1 = op({ ...base, recordId: id16(0xd4), alanlar: { v: 'D' }, hlcMs: ileri, n: 14 }) // §8.3 kural 8
  const eventSeq = N
  const kes = (issuer, list) => Kz.makeCutoff({ familyId: Lk.familyId, collectionId: TA, authorId: K.irem.memberId, eventSeq, eventHash: Lk.hashAt(eventSeq), opIds: list.map((b) => I.peekOp(b).opId), issuer })
  const [kH] = kes(K.husniye, [A1, D1])
  const [kK] = kes(K.kerem, [A1, B1])
  const [kI] = kes(K.irem, [A1, B1, C1]) // vektör 13: yazar listesinden düşüp okuyucu kalan kendi kesimi
  const ids = { A: opIdHex(A1), B: opIdHex(B1), C: opIdHex(C1), D: opIdHex(D1) }
  const d = (A, B, Cx) => ({ [ids.A]: A, [ids.B]: B, [ids.C]: Cx })
  return {
    ek,
    v4: {
      no: 4,
      aciklama: 'Kesim: İrem yazar listesinden düşer. B listede yokken hariç, Kerem\'in kesimiyle birleşimden geri gelir; C hiçbir kesimde yok. İki sırada aynı sonuç.',
      onek: N,
      gozlemci: 'ecem',
      ekOlaylar: ek.map((e) => hex(encodeEvent(e))),
      adimlar: [
        { t: 'anahtar', hex: hex(k) }, // 0
        { t: 'islem', kind: 0, hex: hex(A1) }, // 1
        { t: 'olay', i: 0 }, // 2
        { t: 'islem', kind: 0, hex: hex(B1) }, // 3
        { t: 'islem', kind: 0, hex: hex(C1) }, // 4
        { t: 'kesim', hex: hex(kH) }, // 5
        { t: 'denetim', durumlar: d('gecerli', 'haric', 'haric') }, // 6 (yalnız ilk sırada)
        { t: 'kesim', hex: hex(kK) }, // 7
        { t: 'denetim', durumlar: d('gecerli', 'gecerli', 'haric') } // 8
      ],
      siralar: [[0, 1, 2, 3, 4, 5, 6, 7, 8], [0, 2, 4, 3, 7, 1, 5, 8]]
    },
    v13: {
      no: 13,
      aciklama: 'Yazar listesinden düşürülüp okuyucu kalan İrem kendi kesimini yayımlar: atılır (CUTOFF_UNAUTHORIZED)',
      onek: N,
      gozlemci: 'kerem',
      ekOlaylar: ek.map((e) => hex(encodeEvent(e))),
      adimlar: [{ t: 'anahtar', hex: hex(k) }, { t: 'olay', i: 0 }, { t: 'islem', kind: 0, hex: hex(C1) }, { t: 'kesim', hex: hex(kI), beklenen: 'CUTOFF_UNAUTHORIZED' },
        { t: 'denetim', durumlar: { [ids.C]: 'haric' } }]
    },
    v15: {
      no: 15,
      aciklama: 'Bitiş olayının ts değerinden 2 gün ileri hlc taşıyan D, Hüsniye\'nin kesiminde listelense de hariç',
      onek: N,
      gozlemci: 'kerem',
      ekOlaylar: ek.map((e) => hex(encodeEvent(e))),
      adimlar: [{ t: 'anahtar', hex: hex(k) }, { t: 'olay', i: 0 }, { t: 'islem', kind: 0, hex: hex(D1) }, { t: 'islem', kind: 0, hex: hex(A1) }, { t: 'kesim', hex: hex(kH), beklenen: null },
        { t: 'denetim', durumlar: { [ids.A]: 'gecerli', [ids.D]: 'haric' } }]
    }
  }
}

// Vektör 5: kesim kapsamı — yeniden yetki alan yazarın sonraki işlemleri etkilenmez
function v5 () {
  const ek = ekOlaylar(N, [daralt, genislet])
  const L0 = defter(N)
  const L2 = defter(N, ek)
  const key = anahtar(0x15)
  const k = keyMsg({ L: L0, cid: TA, epochSeq: tumAileEpoch, key, issuer: K.husniye })
  const eski = op({ L: L0, cid: TA, epochSeq: tumAileEpoch, key, yazar: K.irem, recordId: id16(0xe1), tur: 'yuva.defter.not', alanlar: { v: 'eski' }, hlcMs: TS0 + 90_000, n: 21 })
  const yeni = op({ L: L2, cid: TA, epochSeq: tumAileEpoch, key, yazar: K.irem, recordId: id16(0xe2), tur: 'yuva.defter.not', alanlar: { v: 'yeni' }, hlcMs: TS0 + 91_000, n: 22 })
  return {
    no: 5,
    aciklama: 'İrem düşer ve yeniden yazar olur. Yeni aralıktaki işlemi kesimsiz geçerli; eski aralıktaki kesimsiz işlemi hariç.',
    onek: N,
    gozlemci: 'kerem',
    ekOlaylar: ek.map((e) => hex(encodeEvent(e))),
    adimlar: [{ t: 'anahtar', hex: hex(k) }, { t: 'olay', i: 0 }, { t: 'olay', i: 1 }, { t: 'islem', kind: 0, hex: hex(eski) }, { t: 'islem', kind: 0, hex: hex(yeni) },
      { t: 'denetim', durumlar: { [opIdHex(eski)]: 'haric', [opIdHex(yeni)]: 'gecerli' } }]
  }
}

// Vektör 6 ve 7: anahtar üreticisi ve iki geçerli anahtar
function v6v7 () {
  // Okuyuculardan yetişkin çıkar: yeni dönem. Çıkan İrem o dönem için anahtar üretemez.
  const ek = ekOlaylar(N, [(L) => koleksiyon(L, [K.kerem], { readers: ['rol:ebeveyn', 'rol:cocuk'], writers: ['rol:ebeveyn', 'rol:cocuk'] })])
  const L = defter(N, ek)
  const ep = N
  const sahte = keyMsg({ L, cid: TA, epochSeq: ep, key: anahtar(0x16), issuer: K.irem })
  const kH = keyMsg({ L, cid: TA, epochSeq: ep, key: anahtar(0x17), issuer: K.husniye })
  const kK = keyMsg({ L, cid: TA, epochSeq: ep, key: anahtar(0x18), issuer: K.kerem })
  const o1 = op({ L, cid: TA, epochSeq: ep, key: anahtar(0x17), yazar: K.kerem, recordId: id16(0xf1), tur: 'yuva.defter.not', alanlar: { v: 1 }, hlcMs: TS0 + 100_000, n: 31 })
  const o2 = op({ L, cid: TA, epochSeq: ep, key: anahtar(0x18), yazar: K.husniye, recordId: id16(0xf2), tur: 'yuva.defter.not', alanlar: { v: 2 }, hlcMs: TS0 + 100_001, n: 32 })
  const o3 = op({ L, cid: TA, epochSeq: ep, key: anahtar(0x16), yazar: K.kerem, recordId: id16(0xf3), tur: 'yuva.defter.not', alanlar: { v: 3 }, hlcMs: TS0 + 100_002, n: 33 })
  const ekler = ek.map((e) => hex(encodeEvent(e)))
  return [{
    no: 6,
    aciklama: 'Okuyucu listesinden çıkarılan İrem yeni dönem için anahtar üretir: geçersiz (dönem anında okuyucu değil); o anahtarla yazılan işlem açılamaz',
    onek: N,
    gozlemci: 'ecem',
    ekOlaylar: ekler,
    adimlar: [{ t: 'olay', i: 0 }, { t: 'anahtar', hex: hex(sahte), beklenen: 'reddedildi' }, { t: 'islem', kind: 0, hex: hex(o3) },
      { t: 'denetim', durumlar: { [opIdHex(o3)]: 'bekliyor' } }]
  }, {
    no: 7,
    aciklama: 'Aynı dönemde iki geçerli anahtar (Hüsniye ve Kerem): ikisiyle yazılmış işlemler de açılır',
    onek: N,
    gozlemci: 'ecem',
    ekOlaylar: ekler,
    adimlar: [{ t: 'olay', i: 0 }, { t: 'anahtar', hex: hex(kH), beklenen: 'tamam' }, { t: 'anahtar', hex: hex(kK), beklenen: 'tamam' },
      { t: 'islem', kind: 0, hex: hex(o1) }, { t: 'islem', kind: 0, hex: hex(o2) },
      { t: 'denetim', durumlar: { [opIdHex(o1)]: 'gecerli', [opIdHex(o2)]: 'gecerli' } }]
  }]
}

// Vektör 8: history: false koleksiyona katılan okuyucu önceki dönemi açamaz
function v8 () {
  const X = id16(0x3a)
  const ek = ekOlaylar(N, [
    (L) => koleksiyon(L, [K.kerem], { collectionId: X, name: 'Sürpriz', readers: ['rol:ebeveyn'], writers: ['rol:ebeveyn'], history: false }),
    (L) => koleksiyon(L, [K.kerem], { collectionId: X, name: 'Sürpriz', readers: ['rol:ebeveyn', uye(K.irem)], writers: ['rol:ebeveyn'], history: false })
  ])
  const L1 = defter(N, ek.slice(0, 1))
  const L2 = defter(N, ek)
  const k1 = keyMsg({ L: L1, cid: X, epochSeq: N, key: anahtar(0x19), issuer: K.husniye })
  const k2 = keyMsg({ L: L2, cid: X, epochSeq: N + 1, key: anahtar(0x1a), issuer: K.husniye })
  const p1 = op({ L: L1, cid: X, epochSeq: N, key: anahtar(0x19), yazar: K.kerem, recordId: id16(0x91), tur: 'yuva.defter.not', alanlar: { v: 'once' }, hlcMs: TS0 + 110_000, n: 41 })
  const p2 = op({ L: L2, cid: X, epochSeq: N + 1, key: anahtar(0x1a), yazar: K.kerem, recordId: id16(0x92), tur: 'yuva.defter.not', alanlar: { v: 'sonra' }, hlcMs: TS0 + 111_000, n: 42 })
  return {
    no: 8,
    aciklama: 'history: false koleksiyona İrem eklenir: yeni dönem. İrem yalnız yeni dönemin anahtarını alır (önceki dönemi istemek YETKISIZ); önceki işlem açılmaz.',
    onek: N,
    gozlemci: 'irem',
    ekOlaylar: ek.map((e) => hex(encodeEvent(e))),
    adimlar: [{ t: 'olay', i: 0 }, { t: 'olay', i: 1 }, { t: 'anahtar', hex: hex(k2), beklenen: 'tamam' }, { t: 'islem', kind: 0, hex: hex(p1) }, { t: 'islem', kind: 0, hex: hex(p2) },
      { t: 'denetim', durumlar: { [opIdHex(p1)]: 'bekliyor', [opIdHex(p2)]: 'gecerli' } }],
    oncekiAnahtar: hex(k1)
  }
}

// Vektör 14: yetkisi bitmeyen yazar için sahte kesim (PREKEY olayına)
function v14 () {
  const ek = ekOlaylar(N, [(L) => olay(L, T.PREKEY, prekeyBody(K.kerem, b4a.alloc(32, 1), TS0 + 5), [K.kerem])])
  const L = defter(N, ek)
  const [kes] = Kz.makeCutoff({ familyId: L.familyId, collectionId: TA, authorId: K.irem.memberId, eventSeq: N, eventHash: L.hashAt(N), opIds: [], issuer: K.husniye })
  return {
    no: 14,
    aciklama: 'İrem\'in yetkisi bitmedi; PREKEY olayına bağlı sahte kesim atılır (RANGE_NOT_ENDED)',
    onek: N,
    gozlemci: 'kerem',
    ekOlaylar: ek.map((e) => hex(encodeEvent(e))),
    adimlar: [{ t: 'olay', i: 0 }, { t: 'kesim', hex: hex(kes), beklenen: 'RANGE_NOT_ENDED' }]
  }
}

function v12 () {
  const sayi = 0x0102030405060708n
  return {
    no: 12,
    aciklama: 'toBuf(BigInt) → 8 bayt büyük sonlu; hash(\'hf/test/\', x) = hash(\'hf/test/\', u64be(x))',
    deger: sayi.toString(),
    bayt: hex(kdf.toBuf(sayi)),
    ozet: hex(kdf.hash('hf/test/', sayi)),
    sinir: (2n ** 64n - 1n).toString(),
    sinirBayt: hex(kdf.toBuf(2n ** 64n - 1n))
  }
}

// Vektör 9: silme, geri getirme ve bir yıl sonraki temizlik
function v9 () {
  const L = defter(N)
  const key = anahtar(0x1c)
  const k = keyMsg({ L, cid: TA, epochSeq: tumAileEpoch, key, issuer: K.husniye })
  const base = { L, cid: TA, epochSeq: tumAileEpoch, key }
  const R = id16(0x71)
  const t0 = TS0 + 120_000
  const p1 = op({ ...base, yazar: K.irem, recordId: R, tur: 'yuva.defter.not', alanlar: { a: 1 }, hlcMs: t0, n: 51 })
  const p2 = op({ ...base, yazar: K.irem, recordId: R, alanlar: { b: 2 }, hlcMs: t0 + 1000, n: 52 })
  const d = op({ ...base, yazar: K.kerem, recordId: R, islem: OP.DEL, hlcMs: t0 + 2000, n: 53 })
  const p3 = op({ ...base, yazar: K.irem, recordId: R, alanlar: { c: 3 }, hlcMs: t0 + 3000, n: 54 })
  const gec = op({ ...base, yazar: K.husniye, recordId: R, alanlar: { b: 'gec' }, hlcMs: t0 + 1500, n: 55 })
  const ileri = op({ ...base, yazar: K.kerem, recordId: id16(0x72), tur: 'yuva.defter.not', alanlar: { x: 1 }, hlcMs: t0 + 2000 + 366 * 86_400_000, n: 56 })
  const id = (b) => opIdHex(b)
  const hepsi = (v) => ({ [id(p1)]: v, [id(p2)]: v, [id(d)]: v, [id(p3)]: v })
  return {
    no: 9,
    aciklama: 'R: put (tür), put, del, geri getiren put. Silmeden bir yıl sonra (M ileri gidince) del\'den eski işlemler temizlenir; tür işlemi ve del kalır, görünüm değişmez. Eşikten önce temizlik yok. Temizlikten sonra gelen eski işlem kaydedilmez.',
    onek: N,
    gozlemci: 'kerem',
    simdi: TS0 + 400 * 86_400_000,
    ekOlaylar: [],
    adimlar: [
      { t: 'anahtar', hex: hex(k) },
      ...[p1, p2, d, p3].map((b) => ({ t: 'islem', kind: 0, hex: hex(b) })),
      { t: 'temizle' },
      { t: 'denetim', cid: hex(TA), durumlar: hepsi('gecerli') },
      { t: 'islem', kind: 0, hex: hex(ileri) },
      { t: 'temizle' },
      { t: 'denetim', cid: hex(TA), durumlar: { [id(p1)]: 'gecerli', [id(p2)]: 'reddedildi', [id(d)]: 'gecerli', [id(p3)]: 'gecerli', [id(ileri)]: 'gecerli' } },
      { t: 'islem', kind: 0, hex: hex(gec) },
      { t: 'denetim', durumlar: { [id(gec)]: 'reddedildi' } }
    ]
  }
}

// Vektör 11: append-event. crypto_box_seal rastgeledir; mühürlü baytlar girdileriyle birlikte sabit dosyada durur.
// Sabitler require ile okunur (Bare'de de); yalnız vektör üretiminde Node'un fs'iyle yazılır
let SABITLER = null // bellekteki kopya; require önbelleği aynı süreçte eski içeriği döndürürdü
function muhurlu (ad, girdi, uret) {
  if (!SABITLER) { try { SABITLER = { ...require('./v11-fixture.json') } } catch { SABITLER = {} } }
  let cache = SABITLER
  if (cache[ad] && cache[ad].girdi === girdi) return cache[ad].hex
  // Test sırasında depoya yazılmaz; sabitler yalnız vektör üretiminde (node core/core/scripts/vector-gen.js) yenilenir
  if (process.env.HF_VEKTOR_YAZ !== '1') throw new Error('SABIT_ESKI: ' + ad + ' — node core/core/scripts/vector-gen.js')
  const fs = require('fs')
  const path = require('path')
  cache[ad] = { girdi, hex: uret() }
  fs.writeFileSync(path.join(__dirname, 'v11-fixture.json'), JSON.stringify(cache, null, 1) + '\n')
  return cache[ad].hex
}

function v11 () {
  const { sealDrop, appendRecordId } = require('../../replica')
  const OL = id16(0x3b)
  const dk = { publicKey: b4a.alloc(32), secretKey: b4a.alloc(32) }
  sodium.crypto_box_seed_keypair(dk.publicKey, dk.secretKey, b4a.alloc(32, 0x77))
  const ek = ekOlaylar(N, [(L) => koleksiyon(L, [K.husniye], {
    collectionId: OL, name: 'Olaylar:Pati', kind: 'olaylar', readers: ['rol:ebeveyn', 'rol:yetiskin'],
    writers: ['rol:ebeveyn', 'rol:yetiskin', 'device:' + hex(C.isci1.memberId)], dropKey: dk.publicKey
  })])
  const L = defter(N, ek)
  const key = anahtar(0x1b)
  const entry = A.makeKeyEntry({ familyId: L.familyId, collectionId: OL, epochSeq: N, epochHash: L.hashAt(N), key, issuer: K.husniye })
  const k = A.encodeRecKey({ collectionId: OL, epochSeq: N, epochHash: L.hashAt(N), keys: [entry], dropSecrets: [{ dropKeyHash: A.dropKeyHashOf(dk.publicKey), secret: dk.secretKey }] })
  const hlc = fromMs(TS0 + 130_000)
  const ic = (ek2 = {}) => ({ recordId: appendRecordId(C.isci1.memberId, hlc), op: OP.APPEND, type: 'yuva.pet.eat', fields: [{ name: '_t', value: TS0 + 129_000 }, { name: 'miktar', value: 40 }], hlc, authorId: C.isci1.memberId, ledgerSeq: N, ledgerHash: L.hashAt(N), ...ek2 })
  const drop = (ad, inner) => b4a.from(muhurlu(ad, hex(encodeInner(inner)) + hex(dk.publicKey), () => hex(sealDrop({ familyId: L.familyId, collectionId: OL, dropKey: dk.publicKey, inner, signer: C.isci1 }))), 'hex')
  const d1 = drop('gecerli', ic())
  const d2 = drop('yanlisKimlik', ic({ recordId: id16(0x55) }))
  const d3 = op({ L, cid: OL, epochSeq: N, key, yazar: C.isci1, recordId: id16(0x56), tur: 'yuva.pet.eat', alanlar: { miktar: 1 }, hlcMs: TS0 + 131_000, n: 61 })
  const { dropOpIdOf } = require('../../replica')
  const dId = (b) => hex(dropOpIdOf(require('../../encoding').decodeRecDrop(b)))
  return {
    no: 11,
    aciklama: 'append-event: işçi bırakma anahtarıyla olay ekler (geçerli); recordId kuralı tutmaz (red); cihazın put denemesi (red). Bırakma anahtarı tohumu 32 × 0x77.',
    onek: N,
    gozlemci: 'kerem',
    ekOlaylar: ek.map((e) => hex(encodeEvent(e))),
    dropKey: hex(dk.publicKey),
    adimlar: [
      { t: 'olay', i: 0 },
      { t: 'anahtar', hex: hex(k), beklenen: 'tamam' },
      { t: 'islem', kind: 1, hex: hex(d1) },
      { t: 'islem', kind: 1, hex: hex(d2) },
      { t: 'islem', kind: 0, hex: hex(d3) },
      { t: 'denetim', cid: hex(OL), durumlar: { [dId(d1)]: 'gecerli', [dId(d2)]: 'reddedildi', [opIdHex(d3)]: 'reddedildi' } }
    ]
  }
}

// Vektör 10: dosya — iki parça (65536 + 100 bayt), tek parçalı küçük dosya ve ikisini silen BLOB_DEL
function v10 () {
  const D = require('../../file')
  const fileKey = b4a.alloc(32, 0x42)
  const icerik = (n) => b4a.from(Array.from({ length: n }, (_, i) => i % 251))
  const buyuk = D.encryptBlobVektor(icerik(D.CHUNK + 100), fileKey)
  const kucuk = D.encryptBlobVektor(icerik(100), fileKey)
  return {
    no: 10,
    aciklama: 'Dosya: fileKey 32 × 0x42, içerik bayt i = i mod 251. Büyük dosyanın şifreli parçaları özetleriyle verilir.',
    fileKey: hex(fileKey),
    buyuk: {
      boyut: buyuk.size,
      parcalar: buyuk.chunks.map((ct, i) => ({ nonce: hex(D.nonceOf(i)), ad: hex(D.adOf(i, buyuk.chunks.length)), uzunluk: ct.byteLength, ozet: hex(D.chunkHash(ct)) })),
      blobId: hex(buyuk.blobId)
    },
    kucuk: { boyut: kucuk.size, ct: hex(kucuk.chunks[0]), ad: hex(D.adOf(0, 1)), blobId: hex(kucuk.blobId) },
    // BLOB_DEL (RFC-0019 §11.1 q): ozet = hash('hf/blob-del/', familyId, u64be(at), blobIds); imza İrem'in
    silme: (() => {
      const familyId = defter(N).familyId
      const at = TS0 + 1000
      const ids = [buyuk.blobId, kucuk.blobId]
      return { familyId: hex(familyId), at, by: hex(K.irem.memberId), blobIds: ids.map(hex), ozet: hex(D.delDigest(familyId, at, ids)), mesaj: hex(D.makeBlobDel(familyId, ids, K.irem, at)) }
    })()
  }
}

// Her sırayı çalıştırıp beklentileri denetler; kayıt içeriğini (birleştirme sonucu) denetime ekler
function doldur (s) {
  const sonuclar = calistir(s).sonuclar
  denetle(s, sonuclar)
  for (const sira of s.siralar || []) denetle(s, calistir(s, sira).sonuclar)
  for (const { adim: a, sonuc } of sonuclar) {
    if (a.t === 'denetim' && a.cid) a.kayitlar = JSON.parse(JSON.stringify(sonuc.kayitlar))
  }
  return s
}

function vektorler () {
  const kes = kesimSenaryosu()
  const [s6, s7] = v6v7()
  return {
    aciklama: 'RFC-0001 §17: kayıt katmanı. Senaryolar ledger-v21.json ana zincirinin ilk `onek` olayıyla başlar; gözlemci kimliği core/core/test/yardimci adlarıyla. Yerel saat ' + SIMDI + ' ms. Denetimdeki `sonuc` beklenen durumdur; `siralar` verilmişse her sıra aynı sonuca varır.',
    v1: v1(),
    v10: v10(),
    v12: v12(),
    senaryolar: [v2(), v3(), kes.v4, v5(), s6, s7, v8(), v9(), v11(), kes.v13, v14(), kes.v15].map(doldur)
  }
}

module.exports = { vektorler, calistir, denetle, SIMDI, ANA, N }
