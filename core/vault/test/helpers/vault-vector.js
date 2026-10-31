// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// protocol/vectors/vault-v2.json üreticisi (RFC-0004 §8). Belirlenimci: Shamir kaynağı sabit akışa yamalanır
// (rastgele.sabitAkis(tohum) = BLAKE2b sayaç akışı, etiket 'hf/kasa-test-akis/'), nonce'lar sabit.
// Dosyayı yazmak için: node core/core/scripts/vector-gen.js
const b4a = require('b4a')
const { combine } = require('shamir-secret-sharing')
const { ledger: { Ledger, T, encodeEvent, decodeEvent } } = require('@havenfold/core')
const V = require('../../../core/test/helpers/v21')
const R = require('../../test-flow')
const { kasaDonemleri, girdi, bek } = require('./input')
const E = require('../../threshold')
const P = require('../../share')
const Y = require('../../backup')
const Zf = require('../../envelope')
const I = require('../../request')

const { K, C, hex, olay, anaAdimlar, TS0, K_KASA } = V
const HOUR = 3_600_000
const hataOf = async (fn) => { try { await fn(); return null } catch (err) { return err.message } }

// Ana zincir + İrem'in telefonu u5'e geçer, eski telefon imzalamaz (iki ebeveynle)
function adimlar (L) {
  return [...anaAdimlar(L), () => olay(L, T.ROTATE_DEVICE, { oldMemberId: K.irem.memberId, newDeviceCert: K.u5.deviceCert, ceremonyTranscriptHash: b4a.alloc(32, 7) }, [K.u5, K.kerem, K.husniye])]
}
const ZINCIR = (() => { const L = new Ledger(); return adimlar(L).map((f) => { const e = f(); L.apply(e); return hex(encodeEvent(e)) }) })()
function defter (n = ZINCIR.length, z = ZINCIR) { const L = new Ledger(); for (const h of z.slice(0, n)) L.apply(decodeEvent(b4a.from(h, 'hex'))); return L }
const ROT_SEQ = ZINCIR.length - 1

// Cihaz payı için TPM mührü doğrulanmış Linux konteyner düğümleri (kurulumdan gelir): kutu ve isci1
const UYGUN = new Set([hex(K.kutu.memberId), hex(C.isci1.memberId)])
const uygunCihaz = (id) => UYGUN.has(id)

const jsonPay = (p) => ({ ...p, secretId: hex(p.secretId), share: hex(p.share), holderId: hex(p.holderId), commit: hex(p.commit) })
const payJson = (j) => ({ ...j, secretId: b4a.from(j.secretId, 'hex'), share: b4a.from(j.share, 'hex'), holderId: b4a.from(j.holderId, 'hex'), commit: b4a.from(j.commit, 'hex') })
// Kurulabilir dağıtım (kurallar threshold.js'te; vektörler yalnız bölmeyi sabitler)
const dagT = (t, sahipler) => ({ kurulur: true, neden: null, t, n: sahipler.length, sahipler })
const sahipler = (n) => Array.from({ length: n }, (_, i) => ({ id: b4a.alloc(16, 0xa0 + i).toString('hex') }))

async function sabitle (tohum, fn) {
  const geri = R.kaynakAyarla(R.sabitAkis(b4a.from(tohum)))
  try { return await fn() } finally { geri() }
}

async function v1 () {
  const sir = b4a.alloc(32, 0x42)
  const secretId = b4a.alloc(16, 0x01)
  const paylar = await sabitle('kasa-v1', () => P.paylariUret(sir, { secretId, kind: P.TUR.YA, version: 1, dagitim: dagT(2, sahipler(3)) }))
  return {
    aciklama: 'Sabit akış tohumu "kasa-v1"; sır 32 × 0x42; t = 2, n = 3. share[32] x koordinatıdır.',
    tohum: 'kasa-v1', sir: hex(sir), secretId: hex(secretId), commit: hex(P.commitOf(secretId, 1, sir)),
    paylar: paylar.map(jsonPay), x: paylar.map((p) => p.share[32]),
    kodlama: paylar.map((p) => hex(P.encodeShare(p))),
    kagit: P.kagitKodla(paylar[0])
  }
}

function v2 () {
  const ya = [[2, 1, '2 ebeveyn + kutu; Anne\'nin YA\'sı'], [2, 3, '2 ebeveyn + kutu + 2 TPM\'li işçi'], [4, 1, '2 ebeveyn + 2 yetişkin + kutu'], [1, 1, 'Tek ebeveyn + kutu + 1 kâğıt'], [2, 1, 'Tek ebeveyn + kutu + 2 kâğıt'], [2, 1, 'Ergen, yalnız kâğıt']]
    .map(([p, dc, aciklama]) => ({ aciklama, P: p, Dc: dc, ...E.yaEsik(p, dc) }))
  const kra = [[1, 1, 'Tek okuyucu + kutu, kâğıt yok'], [2, 1, 'İki okuyucu + kutu'], [2, 0, 'İki okuyucu, cihaz yok'], [4, 2, 'Dört pay + iki cihaz']]
    .map(([p, dc, aciklama]) => ({ aciklama, P: p, Dc: dc, ...E.kraEsik(p, dc) }))
  // Defterden: Hüsniye'nin YA'sı (Kerem + İrem + 1 kâğıt), Ecem'in varsayılanı (ebeveynler + 1 kâğıt), kasa KRA'sı
  const L = defter(anaAdimlar(new Ledger()).length)
  const dag = (d) => ({ t: d.t, D: d.D, n: d.n, kurulur: d.kurulur, sahipler: d.sahipler })
  const defterden = {
    husniyeYA: dag(E.yaDagitim(L, { sahip: hex(K.husniye.memberId), kisiler: [hex(K.kerem.memberId), hex(K.irem.memberId)], kagit: 1, uygunCihaz })),
    ecemYA: dag(E.yaDagitim(L, { sahip: hex(K.ecem.memberId), kisiler: [hex(K.kerem.memberId), hex(K.husniye.memberId)], kagit: 1, uygunCihaz })),
    kasaKRA: dag(E.kraDagitim(L, { collectionId: K_KASA, kagit: 0, uygunCihaz })),
    cocukPayTutamaz: (() => { try { E.yaDagitim(L, { sahip: hex(K.kerem.memberId), kisiler: [hex(K.ecem.memberId)], kagit: 1, uygunCihaz }); return null } catch (e) { return e.message } })()
  }
  return { ya, kra, defterden }
}

// t = 3: 4 kişi + 1 cihaz. Tek kişi payı + cihaz payı → birleşmez; iki kişi + cihaz → birleşir.
async function v3 () {
  const sir = b4a.alloc(32, 0x33)
  const secretId = b4a.alloc(16, 0x03)
  const e = E.yaEsik(4, 1)
  const paylar = await sabitle('kasa-v3', () => P.paylariUret(sir, { secretId, kind: P.TUR.YA, version: 1, dagitim: dagT(e.t, sahipler(e.n)) }))
  const kisi0 = paylar[0]
  const cihaz = paylar[4]
  const ham = hex(await combine([new Uint8Array(kisi0.share), new Uint8Array(cihaz.share)]))
  return {
    esik: e, sir: hex(sir), paylar: paylar.map(jsonPay), cihazPayi: 4,
    durumlar: [
      { aciklama: 'tek kişi payı + bütün cihaz payları', paylar: [0, 4], hata: await hataOf(() => P.birlestir([kisi0, cihaz], bek(kisi0))), hamBirlesim: ham, commitTutar: P.commitOf(secretId, 1, b4a.from(ham, 'hex')).equals(kisi0.commit) },
      { aciklama: 'iki kişi payı + cihaz payı', paylar: [0, 1, 4], hata: await hataOf(() => P.birlestir([paylar[0], paylar[1], cihaz], bek(cihaz))) }
    ]
  }
}

// Eski cihazın imzalamadığı ROTATE_DEVICE: 72 saat dolmadan pay verilmez
async function v4 () {
  const L = defter()
  const ya = b4a.alloc(32, 0x44)
  const rootId = P.rootIdOf(L, K.u5.memberId)
  const secretId = P.yaSecretId(L.familyId, rootId)
  const [pay] = await sabitle('kasa-v4', () => P.paylariUret(ya, { secretId, kind: P.TUR.YA, version: 1, dagitim: dagT(2, [{ id: hex(K.kerem.memberId) }, { id: E.kagitId(1) }]) }))
  const istekler = [
    { aciklama: 'yeni telefon, 71 saat sonra', kim: 'u5', saat: 71 },
    { aciklama: 'yeni telefon, 73 saat sonra', kim: 'u5', saat: 73 },
    { aciklama: 'aynı gün ikinci istek', kim: 'u5', saat: 74 },
    { aciklama: 'eski telefon (değişimle pasif)', kim: 'irem', saat: 75 },
    { aciklama: 'başka bir üye', kim: 'husniye', saat: 76 }
  ].map((x) => ({ ...x, istek: hex(I.payIste(L.familyId, { secretId, kind: P.TUR.YA, version: 1, holderId: K.kerem.memberId, at: TS0 + (100 + x.saat) * HOUR }, K[x.kim])) }))
  const d = { ilk: TS0 + 100 * HOUR, tutucu: hex(K.kerem.memberId), rootId, secretId: hex(secretId), pay: jsonPay(pay), istekler }
  d.sonuclar = calistir4({ zincir: ZINCIR }, d)
  return d
}

function calistir4 (dosya, d) {
  const L = defter(dosya.zincir.length, dosya.zincir)
  let saat = d.ilk
  const tut = new I.PayTutucu({ ledger: L, me: b4a.from(d.tutucu, 'hex'), now: () => saat, ilkGorulme: new Map(), sayac: new Map() })
  tut.gozle()
  tut.ekle({ share: payJson(d.pay) }, { rootId: d.rootId })
  return d.istekler.map((x) => {
    saat = d.ilk + x.saat * HOUR
    const r = tut.iste(b4a.from(x.istek, 'hex'), { from: hex(K[x.kim].memberId) })
    return r.ver ? { ver: hex(I.payCevabiCoz(r.ver).share) } : r.bekle ? { bekle: r.bekle, bildir: r.bildir } : { red: r.red }
  })
}

// Döndürme: eski paylar eski sırrı açar; ama sürüm uyuşmaz ve yeni dizin açılmaz
async function v5 () {
  const secretId = b4a.alloc(16, 0x05)
  const ya1 = b4a.alloc(32, 0x51)
  const ya2 = b4a.alloc(32, 0x52)
  const s = sahipler(2)
  const eski = await sabitle('kasa-v5a', () => P.paylariUret(ya1, { secretId, kind: P.TUR.YA, version: 1, dagitim: dagT(2, s) }))
  const yeni = await sabitle('kasa-v5b', () => P.paylariUret(ya2, { secretId, kind: P.TUR.YA, version: 2, dagitim: dagT(2, s) }))
  const dizin = (version, seq, ya, nonce) => Y.dizinMuhurle(ya, secretId, { memberRootId: b4a.alloc(16, 0x0e), version, seq, blocks: [{ blokNo: 0, blobId: b4a.alloc(32, seq), fileKey: b4a.alloc(32, 0x60 + seq), size: 4096 }] }, b4a.alloc(24, nonce))
  const d = { eski: eski.map(jsonPay), yeni: yeni.map(jsonPay), dizinEski: hex(dizin(1, 5, ya1, 1)), dizinYeni: hex(dizin(2, 6, ya2, 2)) }
  d.sonuc = await calistir5(d)
  return d
}

async function calistir5 (d) {
  const eski = d.eski.map(payJson)
  const yeni = d.yeni.map(payJson)
  const ya1 = await P.birlestir(eski, bek(eski[0]))
  const ya2 = await P.birlestir(yeni, bek(yeni[0]))
  const ac = (ya, h) => { try { return Y.dizinAc(ya, b4a.from(h, 'hex')).seq } catch (e) { return e.message } }
  return {
    eskiPaylarEskiSir: hex(ya1),
    yeniPaylarYeniSir: hex(ya2),
    eskiSirYeniDizin: ac(ya1, d.dizinYeni),
    eskiSirEskiDizin: ac(ya1, d.dizinEski),
    yeniSirYeniDizin: ac(ya2, d.dizinYeni),
    karisik: await hataOf(() => P.birlestir([eski[0], yeni[1]], bek(yeni[1])))
  }
}

// Bozuk pay: commit uyuşmaz; üçüncü pay varsa başka kombinasyon denenir
async function v6 () {
  const sir = b4a.alloc(32, 0x66)
  const secretId = b4a.alloc(16, 0x06)
  const paylar = await sabitle('kasa-v6', () => P.paylariUret(sir, { secretId, kind: P.TUR.KRA, version: 3, dagitim: dagT(2, sahipler(3)) }))
  const bozuk = { ...paylar[0], share: b4a.from(paylar[0].share) }
  bozuk.share[7] ^= 0x01
  const d = { paylar: paylar.map(jsonPay), bozuk: jsonPay(bozuk) }
  d.sonuc = await calistir6(d)
  return d
}

async function calistir6 (d) {
  const p = d.paylar.map(payJson)
  const b = payJson(d.bozuk)
  return { ikiPay: await hataOf(() => P.birlestir([b, p[1]], bek(p[1]))), ucPay: hex(await P.birlestir([b, p[1], p[2]], bek(p[1]))) }
}

// Yedek dizini AD'si ve secretId türetimi
function v7 () {
  const L = defter()
  const rootId = P.rootIdOf(L, K.u5.memberId)
  const secretId = P.yaSecretId(L.familyId, rootId)
  const ya = b4a.alloc(32, 0x77)
  const dizin = { memberRootId: b4a.from(rootId, 'hex'), version: 2, seq: 9, blocks: [{ blokNo: 0, blobId: b4a.alloc(32, 0x70), fileKey: b4a.alloc(32, 0x71), size: 65536 }, { blokNo: 1, blobId: b4a.alloc(32, 0x72), fileKey: b4a.alloc(32, 0x73), size: 100 }] }
  return {
    familyId: hex(L.familyId),
    rootId,
    rootIdAciklama: 'u5\'in rotatedFrom zincirinin ilk kimliği (İrem)',
    secretId: hex(secretId),
    ad: hex(Y.adOf(secretId, 2, 9)),
    ya: hex(ya),
    nonce: hex(b4a.alloc(24, 0x07)),
    muhurlu: hex(Y.dizinMuhurle(ya, secretId, dizin, b4a.alloc(24, 0x07)))
  }
}

// İmzalı mesajlar ve kasa zarfı (kripto kodu vektörsüz kaydedilmez)
function imzalar () {
  const L = defter()
  const req = I.payIste(L.familyId, { secretId: b4a.alloc(16, 0x09), kind: P.TUR.KRA, version: 4, holderId: K.kutu.memberId, at: TS0 + 5000, reason: 'rotate' }, K.kerem)
  const kra = b4a.alloc(32, 0x88)
  // Zarf içeriği keyEntry listesi (issuerId, sig dahil) ve dropSecrets (RFC-0019 §11.4 d)
  // Gerçek kasa dönemi ve Hüsniye'nin imzaladığı anahtar girdileri (zarfAc doğrular, inceleme 5 S11)
  const ep = kasaDonemleri(L)[0]
  const ic = { epochs: [{ epochSeq: ep.seq, epochHash: ep.hash, keys: [girdi(L, ep, 0x1a, K.husniye), girdi(L, ep, 0x1b, K.husniye)] }], dropSecrets: [{ dropKeyHash: b4a.alloc(32, 0x1c), secret: b4a.alloc(32, 0x1d) }] }
  const zarf = Zf.zarfYaz(L.familyId, kra, { collectionId: K_KASA, version: 4, envSeq: 2, ic }, K.husniye, b4a.alloc(24, 0x0a))
  const zb = zarf.subarray(0, zarf.byteLength - 64)
  return {
    payIstegi: { bayt: hex(req), imzaci: hex(K.kerem.memberId), etiket: 'hf/kasa-req/', ozet: hex(I.reqDigest(L.familyId, req.subarray(0, req.byteLength - 64))) },
    zarf: { bayt: hex(zarf), kra: hex(kra), yazan: hex(K.husniye.memberId), etiket: 'hf/kasa-env/', ozet: hex(Zf.digestOf(L.familyId, zb)), ad: hex(Zf.adOf({ collectionId: K_KASA, version: 4, envSeq: 2, lastEpochSeq: ep.seq })), donem: ep.seq }
  }
}

async function vektorler () {
  return {
    aciklama: 'RFC-0004 §8: kasa. Zincir ledger-v21.json ana zincirinin (21 olay) devamıdır: İrem\'in telefonu u5\'e geçer, eski telefon imzalamaz. Shamir: shamir-secret-sharing 0.0.4; rastgelelik vektörlerde sabit akışa yamalanır. Cihaz payına uygun düğümler (TPM mührü doğrulanmış): kutu ve isci1.',
    zincir: ZINCIR,
    rotSeq: ROT_SEQ,
    v1: await v1(),
    v2: v2(),
    v3: await v3(),
    v4: await v4(),
    v5: await v5(),
    v6: await v6(),
    v7: v7(),
    imzalar: imzalar()
  }
}

module.exports = { vektorler, defter, calistir4, calistir5, calistir6, payJson, uygunCihaz, ZINCIR }
