// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// protocol/vectors/event-v2.json üreticisi (RFC-0006 §17, 18 madde). Belirlenimci: sabit tohumlar, sabit zaman, Ed25519.
// Dosyayı yazmak için: node core/core/scripts/vector-gen.js
//
// Kayıtlar { inner (OpInner hex), opId } biçimindedir; motor bunları kayitIslemden ile görür. Üretici RFC'deki
// sayıları (gün 20745, bant 1–7, …) ayrıca elle denetler; tutmazsa hata atar.
const b4a = require('b4a')
const { kodlama: { encodeInner, OP, decodeRecDrop }, hlc: { fromMs }, appendRecordId, sealDrop } = require('@havenfold/records')
const { kayitIslemden, olaylar, olayAlanlari, olayHatasi, anahtar } = require('../../event')
const R = require('../../routine')
const Kr = require('../../rule')
const Vk = require('../../case')
const M = require('../../escalation')
const Zf = require('../../envelope')
const S = require('../../storage')
const { degerlendir } = require('../../engine')
const O = require('./event')

const { C, U, hex, id16, T0, MIN, HOUR, DAY, DROP, ZINCIR, defter, katalog, COKI, uye, cihaz, kayit, sifirla, K_OLAYLAR, K_EBEVEYN } = O

function jsonla (v) {
  if (b4a.isBuffer(v)) return hex(v)
  if (typeof v === 'bigint') return v.toString()
  if (Array.isArray(v)) return v.map(jsonla)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, jsonla(x)]))
  return v
}
function esit (a, b, ne) {
  if (JSON.stringify(jsonla(a)) !== JSON.stringify(jsonla(b))) throw new Error('RFC beklentisi tutmadı: ' + ne + ' ' + JSON.stringify(jsonla(a)) + ' ≠ ' + JSON.stringify(jsonla(b)))
}

// Vektör dosyasındaki kayıtlardan motor bağlamı
function baglam (L, kat, cid, kayitlar) {
  return { ledger: L, katalog: kat, collectionId: cid, col: L.collections.get(hex(cid)), kayitlar: kayitlar.map((k) => kayitIslemden(L, b4a.from(k.inner, 'hex'), b4a.from(k.opId, 'hex'))) }
}

// Rastgele mühürlü REC_DROP bir kez üretilip sabitlenir (kayıt vektörlerindeki düzen)
// Sabitler require ile okunur (Bare'de de); yalnız vektör üretiminde Node'un fs'iyle yazılır
let SABITLER = null // bellekteki kopya; require önbelleği aynı süreçte eski içeriği döndürürdü
function muhurlu (ad, girdi, uret) {
  if (!SABITLER) { try { SABITLER = { ...require('./v1-fixture.json') } } catch { SABITLER = {} } }
  let cache = SABITLER
  if (cache[ad] && cache[ad].girdi === girdi) return cache[ad].hex
  // Test sırasında depoya yazılmaz; sabitler yalnız vektör üretiminde (node core/core/scripts/vector-gen.js) yenilenir
  if (process.env.HF_VEKTOR_YAZ !== '1') throw new Error('SABIT_ESKI: ' + ad + ' — node core/core/scripts/vector-gen.js')
  const fs = require('fs')
  const path = require('path')
  cache[ad] = { girdi, hex: uret() }
  fs.writeFileSync(path.join(__dirname, 'v1-fixture.json'), JSON.stringify(cache, null, 1) + '\n')
  return cache[ad].hex
}

// Yerel gün ve dakikadan Unix ms (utc_dk = 180)
const yerelAn = (gun, dk) => gun * DAY + dk * MIN - 180 * MIN
const BUGUN = 20745

function v1 (L, kat) {
  const hlcMs = T0 - 10 * MIN
  const hlc = fromMs(hlcMs)
  const alanlar = olayAlanlari(kat, 'yuva.pet.litter.visit', { t: hlcMs - 30_000, subj: COKI, conf: 92, obs: 'kaynak:' + hex(id16(0x77)) }, { sure_sn: 45 })
  const inner = {
    recordId: appendRecordId(C.isci1.memberId, hlc),
    op: OP.APPEND,
    type: 'yuva.pet.litter.visit',
    fields: Object.entries(alanlar).map(([name, value]) => ({ name, value })),
    hlc,
    authorId: C.isci1.memberId,
    ledgerSeq: L.len - 1,
    ledgerHash: L.head
  }
  const innerHex = hex(encodeInner(inner))
  const drop = muhurlu('v1', innerHex + hex(DROP.publicKey), () => hex(sealDrop({ familyId: L.familyId, collectionId: K_OLAYLAR, dropKey: DROP.publicKey, inner, signer: C.isci1 })))
  const w = decodeRecDrop(b4a.from(drop, 'hex'))
  return {
    aciklama: 'Kamera işçisinin kum kabı olayı: çekirdek alanlar, OpInner (op = 2), recordId = hash(hf/rec-append/, authorId, u64be(hlc))[0..16], REC_DROP (crypto_box_seal, rastgele; bir kez üretilip sabitlendi).',
    alanlar: jsonla(alanlar),
    hlc: hlc.toString(),
    yazar: hex(C.isci1.memberId),
    recordId: hex(inner.recordId),
    inner: innerHex,
    rec_drop: drop,
    dropKeyHash: hex(w.dropKeyHash),
    dropPublicKey: hex(DROP.publicKey),
    dropSecretKey: hex(DROP.secretKey)
  }
}

function v2 () {
  const key = anahtar('hf.device.offline', C.isci1.memberId, 41)
  const kaynak = id16(0x91)
  const pb = yerelAn(BUGUN, 0)
  const a = Vk.vakaAnahtari(K_OLAYLAR, kaynak, COKI, pb, 1)
  const b = Vk.vakaAnahtari(K_OLAYLAR, kaynak, uye(U.kerem), pb, 1)
  if (hex(a) === hex(b)) throw new Error('ozne')
  return {
    anahtar: { tur: 'hf.device.offline', parcalar: [hex(C.isci1.memberId), 41], _key: hex(key) },
    vaka: [
      { collectionId: hex(K_OLAYLAR), kaynakId: hex(kaynak), _subj: COKI, ozneOzeti: hex(Vk.ozneOzeti(COKI)), pencereBasi: pb, yon: 1, vaka: hex(a) },
      { collectionId: hex(K_OLAYLAR), kaynakId: hex(kaynak), _subj: uye(U.kerem), ozneOzeti: hex(Vk.ozneOzeti(uye(U.kerem))), pencereBasi: pb, yon: 1, vaka: hex(b) }
    ],
    cekirdek: { tur: 'hf.sos', kaynakId: hex(Kr.cekirdekKaynakId('hf.sos')) }
  }
}

function v3 () {
  const r = { utc_dk: 180, gun_basi_dk: 0 }
  const out = [1_792_359_000_000, 1_792_357_140_000].map((t) => ({ _t: t, utc_dk: 180, gun_basi_dk: 0, gun: R.gunOf(t, r), dakika: R.dakikaOf(t, r) }))
  esit(out.map((x) => x.gun), [20745, 20744], 'gün')
  esit(out[0].dakika, 30, 'yerel 00:30')
  return out
}

function v4 () {
  const degerler = [4, 5, 4, 6, 3, 5, 4, 4, 5, 6, 4, 3, 5, 4]
  const b = R.bant(degerler, 3, 1)
  esit([b.m, b.mad, b.w, b.alt, b.ust], [4, 1, 3, 1, 7], 'bant')
  return { degerler, k: 3, en_dar: 1, ...b, bugun: [{ x: 11, yon: R.sapmaYonu(11, b.alt, b.ust, true) }, { x: 7, yon: R.sapmaYonu(7, b.alt, b.ust, true) }] }
}

function v5 () {
  const degerler = [0, 1, 0, 0, 2, 0, 1]
  const b = R.bant(degerler, 3, 1)
  esit([b.m, b.mad, b.w, b.alt, b.ust], [0, 0, 1, -1, 1], 'dar bant')
  const out = { degerler, k: 3, en_dar: 1, ...b, bugun: [{ x: 2, yon: R.sapmaYonu(2, b.alt, b.ust, true) }, { x: 0, yon: R.sapmaYonu(0, b.alt, b.ust, true) }] }
  esit(out.bugun.map((x) => x.yon), [1, 0], 'az üretilmez')
  return out
}

// 9 gün yemek olayı (işçi yazar), 3 günde işçi 8 saat çevrimdışı → 6 geçerli gün, olgun değil
function v6 (L, kat) {
  sifirla()
  const olaylarK = []
  for (let g = BUGUN - 9; g < BUGUN; g++) {
    for (const dk of [480, 720, 1080, 1320]) {
      const t = yerelAn(g, dk)
      olaylarK.push(kayit(L, C.isci1, 'yuva.pet.eat', olayAlanlari(kat, 'yuva.pet.eat', { t, subj: COKI, conf: 95 }, { miktar: 20 }), t))
    }
  }
  const rutin = kayit(L, U.kerem, 'hf.rutin', { _subj: COKI, olay: 'yuva.pet.eat', olcu: 'sayi' }, yerelAn(BUGUN - 10, 0))
  const kesinti = []
  let seq = 40
  for (const g of [BUGUN - 3, BUGUN - 5, BUGUN - 7]) {
    for (const [tur, dk] of [['hf.device.offline', 360], ['hf.device.online', 840]]) {
      const t = yerelAn(g, dk)
      kesinti.push(kayit(L, U.kerem, tur, olayAlanlari(kat, tur, { t, subj: cihaz(C.isci1), key: anahtar(tur, C.isci1.memberId, ++seq) }), t))
    }
  }
  const sonuc = calistir6({ zincir: ZINCIR }, { olaylar: [...olaylarK, rutin], kesinti })
  esit([sonuc.gun, sonuc.kesintili, sonuc.olgun], [6, 3, false], 'olgunluk')
  return { simdi: T0, kayitlar: [...olaylarK, rutin], kesinti, beklenen: sonuc }
}

function calistir6 (dosya, v) {
  const L = defter(dosya.zincir)
  const kat = katalog({ vektor: true })
  const ctx = baglam(L, kat, K_OLAYLAR, v.olaylar)
  const ol = olaylar(ctx).sayilir
  const kes = olaylar(baglam(L, kat, K_EBEVEYN, v.kesinti)).sayilir
  const r = R.rutinTanimi(ctx.kayitlar.find((k) => k.type === 'hf.rutin'))
  const o = R.ogren(r, ol.filter((e) => e.type === r.olay && e.subj === r.subj), R.gunOf(T0, r), 0, { araliklar: R.kesintiAraliklari(kes) })
  return { gun: o.gun, kesintili: o.kesintili, olgun: o.olgun }
}

// Güven: pencerede tek 70 → yok; iki farklı _t'li 70 → var; tek 45 → sayılmaz; tek 85 → var
function v7 (L, kat) {
  sifirla()
  const kural = kayit(L, U.kerem, 'hf.kural', { _subj: COKI, kosullar: [['yuva.pet.litter.visit', 'sayi', '', 180, 'ge', 1]], eylem: 'vaka', onem: 2 }, T0 - DAY)
  const ev = (conf, dkOnce) => { const t = T0 - dkOnce * MIN; return kayit(L, C.isci1, 'yuva.pet.litter.visit', olayAlanlari(kat, 'yuva.pet.litter.visit', { t, subj: COKI, conf }), t) }
  const durumlar = [
    { aciklama: 'tek 70', olaylar: [ev(70, 30)] },
    { aciklama: 'iki farklı _t\'li 70', olaylar: [ev(70, 30), ev(70, 20)] },
    { aciklama: 'tek 45 (sayılmaz)', olaylar: [ev(45, 30)] },
    { aciklama: 'tek 85', olaylar: [ev(85, 30)] }
  ].map((d) => ({ ...d, kural, T: T0 }))
  for (const d of durumlar) d.vaka = calistir7({ zincir: ZINCIR }, d)
  esit(durumlar.map((d) => d.vaka), [false, true, false, true], 'güven')
  return durumlar
}

function calistir7 (dosya, d) {
  const L = defter(dosya.zincir)
  const ctx = baglam(L, katalog({ vektor: true }), K_OLAYLAR, [d.kural, ...d.olaylar])
  const k = Kr.kuralTanimi(ctx.kayitlar.find((x) => x.type === 'hf.kural'))
  return Kr.degerlendir(k, olaylar(ctx).sayilir, d.T).tetik
}

// Ortak vaka: kural vakası, Coki, 180 dakikalık pencere
const KURAL_ID = id16(0x92)
function vakaAlan (onem = 2, ek = {}) {
  const pb = Kr.pencereBasiOf(T0, 180)
  const { ilk, son } = Vk.basamaklar(onem)
  return Vk.vakaAlanlari({ collectionId: K_OLAYLAR, kaynak: 'kural:' + hex(KURAL_ID), subj: COKI, yon: 0, onem, ilk, son, pencereBasi: pb, pencereSonu: pb + 180 * MIN, t: T0, deger: 3, olaylar: [], ...ek })
}

const ozetle = (d) => d && { onem: d.onem, ilk: d.ilk, son: d.son, gecerli: d.gecerli, ulasilan: d.ulasilan, sahipli: d.sahipli, sahip: d.sahip, kapali: d.kapali, sonuc: d.sonuc }

function durumOf (dosya, kayitlar) {
  const L = defter(dosya.zincir)
  const ctx = baglam(L, katalog({ vektor: true }), K_OLAYLAR, kayitlar)
  const col = L.collections.get(hex(K_OLAYLAR))
  const ds = Vk.vakaDurumlari(ctx.kayitlar, K_OLAYLAR, { sorumluOf: () => M.sorumluListesi(L, col, null) })
  return ozetle([...ds.values()][0] || null)
}

function v8 (L) {
  sifirla()
  const a = vakaAlan(2)
  const v = a.vaka
  const kayitlar = [
    kayit(L, U.kerem, 'hf.vaka', a, T0 + MIN),
    kayit(L, U.husniye, 'hf.vaka', vakaAlan(3, { t: T0 + 2 * MIN }), T0 + 2 * MIN),
    kayit(L, U.kerem, 'hf.vaka.basamak', Vk.basamakAlanlari(v, 2, 0, T0 + MIN), T0 + MIN, { n: 1 }),
    kayit(L, U.husniye, 'hf.vaka.basamak', Vk.basamakAlanlari(v, 3, 0, T0 + 40 * MIN), T0 + 40 * MIN),
    kayit(L, U.irem, 'hf.vaka.sahip', Vk.sahipAlanlari(v, T0 + 45 * MIN), T0 + 45 * MIN),
    kayit(L, U.husniye, 'hf.vaka.sahip', Vk.sahipAlanlari(v, T0 + 46 * MIN), T0 + 46 * MIN)
  ]
  const siralar = [[0, 1, 2, 3, 4, 5], [5, 4, 3, 2, 1, 0], [3, 5, 0, 4, 2, 1]]
  const out = siralar.map((s) => durumOf({ zincir: ZINCIR }, s.map((i) => kayitlar[i])))
  esit(out[1], out[0], 'sıra 2')
  esit(out[2], out[0], 'sıra 3')
  esit([out[0].onem, out[0].sahip, out[0].ulasilan], [2, hex(U.irem.memberId), [3, 0]], 'asıl açılış ve sahip')
  return { kayitlar, siralar, beklenen: out[0] }
}

function v9 (L) {
  sifirla()
  const a = vakaAlan(2)
  const ac = kayit(L, U.kerem, 'hf.vaka', a, T0 + MIN)
  const b3 = kayit(L, U.husniye, 'hf.vaka.basamak', Vk.basamakAlanlari(a.vaka, 3, 0, T0 + 40 * MIN), T0 + 40 * MIN)
  const b2 = kayit(L, U.kerem, 'hf.vaka.basamak', Vk.basamakAlanlari(a.vaka, 2, 0, T0 + MIN), T0 + MIN, { n: 1 })
  const once = durumOf({ zincir: ZINCIR }, [ac, b3])
  const sonra = durumOf({ zincir: ZINCIR }, [ac, b3, b2])
  esit(once.gecerli, [], '(2,0) yokken (3,0) geçersiz')
  esit(sonra.gecerli, [[2, 0], [3, 0]], '(2,0) gelince geçerli')
  return { durumlar: [{ kayitlar: [ac, b3], gecerli: once.gecerli }, { kayitlar: [ac, b3, b2], gecerli: sonra.gecerli }] }
}

// Bildirim: sahiplenmeden sonra gelen (3,0) bildirim üretmez; aynı (vaka, 3, 0) için iki kayıt ve iki zarf → tek bildirim
function v10 (L) {
  sifirla()
  const a = vakaAlan(2)
  const ac = kayit(L, U.kerem, 'hf.vaka', a, T0 + MIN)
  const b2 = kayit(L, U.kerem, 'hf.vaka.basamak', Vk.basamakAlanlari(a.vaka, 2, 0, T0 + MIN), T0 + MIN, { n: 1 })
  const b3a = kayit(L, U.kerem, 'hf.vaka.basamak', Vk.basamakAlanlari(a.vaka, 3, 0, T0 + 31 * MIN), T0 + 31 * MIN)
  const b3b = kayit(L, U.husniye, 'hf.vaka.basamak', Vk.basamakAlanlari(a.vaka, 3, 0, T0 + 33 * MIN), T0 + 33 * MIN)
  const sahip = kayit(L, U.irem, 'hf.vaka.sahip', Vk.sahipAlanlari(a.vaka, T0 + 20 * MIN), T0 + 20 * MIN)
  const z = (kim) => hex(Zf.encodeUyandir(L.familyId, { collectionId: K_OLAYLAR, vaka: a.vaka, basamak: 3, sira: 0, onem: 2, baslik: 'Coki' }, kim))
  const durum = { sahipli: [ac, b2, sahip, b3a], tekil: [ac, b2, b3a, b3b], zarflar: [z(U.kerem), z(U.husniye)] }
  const sonuc = calistir10({ zincir: ZINCIR }, durum)
  esit(sonuc, { sahipli: 0, tekil: 1, ikinci: 0, zarf: [true, false], ipucu: false }, 'tek bildirim')
  return { ...durum, beklenen: sonuc }
}

function calistir10 (dosya, d) {
  const L = defter(dosya.zincir)
  const col = L.collections.get(hex(K_OLAYLAR))
  const okuyucular = M.okuyucuKisiler(L, col)
  const sorumlu = M.sorumluListesi(L, col, null)
  const me = sorumlu[0]
  const durumlar = (kayitlar) => [...Vk.vakaDurumlari(baglam(L, katalog({ vektor: true }), K_OLAYLAR, kayitlar).kayitlar, K_OLAYLAR, { sorumluOf: () => sorumlu }).values()].map((x) => ({ ...x, okuyucular }))
  const b1 = new M.Bildirimci({ me })
  const sahipli = b1.guncelle(durumlar(d.sahipli)).filter((x) => x.eylem === 'goster').length
  const b2 = new M.Bildirimci({ me })
  const ds = durumlar(d.tekil)
  const tekil = b2.guncelle(ds).filter((x) => x.eylem === 'goster').length
  const ikinci = b2.guncelle(ds).filter((x) => x.eylem === 'goster').length
  const kapi = new Zf.UyandirmaKapisi({ ledger: L, me, now: () => T0 })
  const zarf = d.zarflar.map((h) => kapi.uyandir(b4a.from(h, 'hex')).ok)
  const z = Zf.decodeUyandir(b4a.from(d.zarflar[0], 'hex')).m
  const ipucu = b2.ipucu(hex(z.vaka), z.basamak, z.sira, true) !== null
  return { sahipli, tekil, ikinci, zarf, ipucu }
}

// Kural önceliği (§9.3): örtüşen rutin ve kural vakası → rutin bastırılmış; susturma rutin vakasını bastırır, kural
// vakasını bastıramaz. Kontrol: kural penceresiyle örtüşmeyen ertesi günün rutin vakası bastırılmaz.
function v11 (L, kat) {
  sifirla()
  const tanim = T0 - 30 * DAY
  const r1 = kayit(L, U.kerem, 'hf.rutin', { _subj: COKI, olay: 'yuva.pet.eat', olcu: 'sayi' }, tanim)
  const r3 = kayit(L, U.kerem, 'hf.rutin', { _subj: COKI, olay: 'yuva.pet.litter.urine', olcu: 'toplam', alan: 'ml' }, tanim, { n: 1 })
  const k1 = kayit(L, U.kerem, 'hf.kural', { _subj: COKI, kosullar: [['yuva.pet.eat', 'sayi', '', 1440, 'ge', 10]], eylem: 'vaka', onem: 2 }, tanim, { n: 2 })
  const k2 = kayit(L, U.kerem, 'hf.kural', { _subj: COKI, kosullar: [['yuva.pet.litter.visit', 'sayi', '', 60, 'ge', 5]], eylem: 'vaka', onem: 2 }, tanim, { n: 3 })
  const s1 = kayit(L, U.kerem, 'hf.kural', { _subj: COKI, kosullar: [['yuva.pet.litter.urine', 'sayi', '', 1440, 'ge', 1]], eylem: 'sustur', onem: 0 }, tanim, { n: 4 })
  const s2 = kayit(L, U.kerem, 'hf.kural', { _subj: COKI, kosullar: [['yuva.pet.litter.visit', 'sayi', '', 1440, 'ge', 1]], eylem: 'sustur', onem: 0 }, tanim, { n: 5 })
  const rid = (k) => kayitIslemden(L, b4a.from(k.inner, 'hex'), b4a.from(k.opId, 'hex')).recordId
  const gun = (g) => [yerelAn(g, 0), yerelAn(g + 1, 0)]
  const vk = (kaynak, yon, pencere) => {
    const { ilk, son } = Vk.basamaklar(2)
    return Vk.vakaAlanlari({ collectionId: K_OLAYLAR, kaynak, subj: COKI, yon, onem: 2, ilk, son, pencereBasi: pencere[0], pencereSonu: pencere[1], t: T0, deger: 0, olaylar: [] })
  }
  const kuralPencere = (p) => { const pb = Kr.pencereBasiOf(T0, p); return [pb, pb + p * MIN] }
  const vakalar = {
    rutinYemek: vk('rutin:' + rid(r1), 1, gun(BUGUN)),
    kuralYemek: vk('kural:' + rid(k1), 0, kuralPencere(1440)),
    rutinYemekErtesi: vk('rutin:' + rid(r1), 1, gun(BUGUN + 1)),
    rutinIdrar: vk('rutin:' + rid(r3), 1, gun(BUGUN)),
    kuralKum: vk('kural:' + rid(k2), 0, kuralPencere(60))
  }
  const ev = (tur, f) => kayit(L, C.isci1, tur, olayAlanlari(kat, tur, { t: T0 - 20 * MIN, subj: COKI, conf: 95 }, f), T0 - 20 * MIN)
  const olaylarK = [ev('yuva.pet.litter.visit', {}), ev('yuva.pet.litter.urine', { ml: 15 })]
  const kayitlar = [r1, r3, k1, k2, s1, s2, ...olaylarK, ...Object.values(vakalar).map((a, i) => kayit(L, U.husniye, 'hf.vaka', a, T0 + i))]
  const ids = Object.fromEntries(Object.entries(vakalar).map(([k, a]) => [k, hex(a.vaka)]))
  const beklenen = calistir11({ zincir: ZINCIR }, { kayitlar, simdi: T0 + HOUR, vakalar: ids })
  esit(beklenen, { rutinYemek: true, kuralYemek: false, rutinYemekErtesi: false, rutinIdrar: true, kuralKum: false }, 'bastırma')
  return { kayitlar, simdi: T0 + HOUR, vakalar: ids, bastirilmis: beklenen }
}

function calistir11 (dosya, d) {
  const L = defter(dosya.zincir)
  const ctx = baglam(L, katalog({ vektor: true }), K_OLAYLAR, d.kayitlar)
  const s = degerlendir(ctx, d.simdi)
  const by = new Map(s.vakalar.map((v) => [v.vaka, v.bastirilmis]))
  return Object.fromEntries(Object.entries(d.vakalar).map(([k, v]) => [k, by.get(v)]))
}

function v12 (L) {
  sifirla()
  const kart = kayit(L, U.kerem, 'hf.kart', { _subj: COKI, ad: 'Coki', modul: 'yuva.pet', sorumlu: [uye(U.ecem), uye(U.irem)] }, T0)
  const sorumlu = calistir12({ zincir: ZINCIR }, { kart })
  const ebeveynler = [U.kerem, U.husniye].map((k) => hex(k.memberId)).sort()
  esit(sorumlu, [hex(U.irem.memberId), ...ebeveynler], 'sorumlu listesi')
  return { kart, sorumlu }
}

function calistir12 (dosya, d) {
  const L = defter(dosya.zincir)
  const ctx = baglam(L, katalog({ vektor: true }), K_OLAYLAR, [d.kart])
  return M.sorumluListesi(L, ctx.col, ctx.kayitlar[0].fields.sorumlu)
}

function v13 (L, kat) {
  sifirla()
  const t = T0 - 20 * MIN
  const key = anahtar('hf.device.offline', C.isci1.memberId, 41)
  const a = kayit(L, U.husniye, 'hf.device.offline', olayAlanlari(kat, 'hf.device.offline', { t, subj: cihaz(C.isci1), key }), T0 - 5 * MIN)
  const b = kayit(L, U.kerem, 'hf.device.offline', olayAlanlari(kat, 'hf.device.offline', { t, subj: cihaz(C.isci1), key }), T0 - 4 * MIN)
  const r = calistir13({ zincir: ZINCIR }, { kayitlar: [b, a] })
  esit(r.sayi, 1, 'tekil anahtar')
  return { kayitlar: [b, a], ...r }
}

function calistir13 (dosya, d) {
  const L = defter(dosya.zincir)
  const s = olaylar(baglam(L, katalog({ vektor: true }), K_EBEVEYN, d.kayitlar)).sayilir
  return { sayi: s.length, asil: s[0].recordId }
}

function v14 (L, kat) {
  sifirla()
  const t = T0 - 30 * MIN
  const ev = kayit(L, U.irem, 'yuva.pet.eat', olayAlanlari(kat, 'yuva.pet.eat', { t, subj: COKI }, { miktar: 40 }), t)
  const evId = kayitIslemden(L, b4a.from(ev.inner, 'hex'), b4a.from(ev.opId, 'hex')).recordId
  const duz = kayit(L, U.kerem, 'hf.olay.duzelt', { hedef: evId, gecersiz: true }, T0)
  const r = calistir14({ zincir: ZINCIR }, { olay: ev, duzelt: duz })
  esit(r, { duzeltmeli: 'DUZELTILDI', duzeltmesiz: null }, 'düzeltme')
  return { olay: ev, duzelt: duz, ...r }
}

function calistir14 (dosya, d) {
  const L = defter(dosya.zincir)
  const hata = (ks) => { const ctx = baglam(L, katalog({ vektor: true }), K_OLAYLAR, ks); return olayHatasi(ctx, ctx.kayitlar[0]) }
  return { duzeltmeli: hata([d.olay, d.duzelt]), duzeltmesiz: hata([d.olay]) }
}

function v15 () {
  const t = T0 - 40 * DAY
  const saklama = [{ tur: 'yuva.pet.', gun: 20 }]
  const durumlar = [
    { aciklama: '_keep 30, M = _t + 31 gün', _t: t, _keep: 30, tur: 'yuva.pet.eat', conf: 100, saklama: [], M: t + 31 * DAY },
    { aciklama: '_keep 30, M = _t + 29 gün', _t: t, _keep: 30, tur: 'yuva.pet.eat', conf: 100, saklama: [], M: t + 29 * DAY },
    { aciklama: 'hf.saklama { tur: yuva.pet., gun: 20 }, M = _t + 21 gün', _t: t, _keep: 30, tur: 'yuva.pet.eat', conf: 100, saklama, M: t + 21 * DAY },
    { aciklama: 'düşük güven (40): en çok 7 gün', _t: t, _keep: 90, tur: 'yuva.pet.eat', conf: 40, saklama: [], M: t + 8 * DAY },
    { aciklama: '_keep 0: süresiz', _t: t, _keep: 0, tur: 'hf.kart', conf: 100, saklama: [], M: t + 400 * DAY }
  ]
  for (const d of durumlar) {
    const k = S.etkinSure(d._keep, d.tur, d.conf, d.saklama)
    d.etkin = k === Infinity ? null : k
    d.temizlenir = S.suresiDoldu(d._t, k, d.M)
  }
  esit(durumlar.map((d) => [d.etkin, d.temizlenir]), [[30, true], [30, false], [20, true], [7, true], [null, false]], 'saklama')
  return { aciklama: 'Etkin süre ve eşik (§14). Temizlenen recordId ile gelen yeni put kayıt katmanında reddedilir (MEZAR); test bunu bir Replika ile ayrıca dener.', durumlar }
}

function v16 (L) {
  const v = vakaAlan(2).vaka
  const uy = (kim) => Zf.encodeUyandir(L.familyId, { collectionId: K_OLAYLAR, vaka: v, basamak: 2, sira: 0, onem: 2, baslik: 'Coki 3 saattir kum kabına gitmedi' }, kim)
  const dur = (kim) => Zf.encodeDur(L.familyId, { collectionId: K_OLAYLAR, vaka: v, tur: 0 }, kim)
  const digest = (b, tag) => hex(Zf.digestOf(tag, L.familyId, b.subarray(0, b.byteLength - 64)))
  const zarflar = {
    uyandir_isci1: { bayt: uy(C.isci1), imzaci: hex(C.isci1.memberId), etiket: Zf.ETIKET.UYANDIR },
    uyandir_kerem: { bayt: uy(U.kerem), imzaci: hex(U.kerem.memberId), etiket: Zf.ETIKET.UYANDIR },
    uyandir_isci2: { bayt: uy(C.isci2), imzaci: hex(C.isci2.memberId), etiket: Zf.ETIKET.UYANDIR },
    dur_irem: { bayt: dur(U.irem), imzaci: hex(U.irem.memberId), etiket: Zf.ETIKET.DUR },
    dur_isci1: { bayt: dur(C.isci1), imzaci: hex(C.isci1.memberId), etiket: Zf.ETIKET.DUR }
  }
  for (const z of Object.values(zarflar)) { z.ozet = digest(z.bayt, z.etiket); z.bayt = hex(z.bayt) }
  const denetimler = [
    { zarf: 'uyandir_isci1', alici: hex(U.husniye.memberId), beklenen: 'kabul' },
    { zarf: 'uyandir_kerem', alici: hex(U.husniye.memberId), beklenen: 'kabul' },
    { zarf: 'uyandir_isci2', alici: hex(U.husniye.memberId), beklenen: 'UNAUTHORIZED' },
    { zarf: 'uyandir_kerem', alici: hex(U.ecem.memberId), beklenen: 'NOT_READER' },
    { zarf: 'dur_irem', alici: hex(C.isci1.memberId), beklenen: 'kabul' },
    { zarf: 'dur_isci1', alici: hex(U.kerem.memberId), beklenen: 'UNAUTHORIZED' }
  ]
  const dosya = { zincir: ZINCIR, v16: { zarflar } }
  for (const d of denetimler) esit(calistir16(dosya, d), d.beklenen, d.zarf)
  return { zarflar, denetimler }
}

function calistir16 (dosya, d) {
  const L = defter(dosya.zincir)
  const z = dosya.v16.zarflar[d.zarf]
  const kapi = new Zf.UyandirmaKapisi({ ledger: L, me: d.alici, now: () => T0 })
  const r = d.zarf.startsWith('dur') ? kapi.dur(b4a.from(z.bayt, 'hex')) : kapi.uyandir(b4a.from(z.bayt, 'hex'))
  return r.ok ? 'kabul' : r.neden
}

// Kural penceresi 720 dakika: aynı 12 saatlik dilimde iki tetikleme aynı vaka; sonraki dilimde başka
function v17 (L, kat) {
  sifirla()
  const kural = kayit(L, U.kerem, 'hf.kural', { _subj: COKI, kosullar: [['yuva.pet.litter.visit', 'sayi', '', 720, 'ge', 1]], eylem: 'vaka', onem: 2 }, T0 - DAY)
  const gun = Math.floor(T0 / DAY) * DAY
  const ev = (t) => kayit(L, C.isci1, 'yuva.pet.litter.visit', olayAlanlari(kat, 'yuva.pet.litter.visit', { t, subj: COKI, conf: 95 }), t)
  const olaylarK = [ev(gun + 13 * HOUR), ev(gun + 20 * HOUR), ev(gun + 25 * HOUR)]
  const r = calistir17({ zincir: ZINCIR }, { kural, olaylar: olaylarK, simdi: gun + 26 * HOUR })
  esit(r.vakalar.length, 3, 'üç tetik')
  esit(r.vakalar[0] === r.vakalar[1] && r.vakalar[1] !== r.vakalar[2], true, 'aynı dilim aynı vaka')
  return { kural, olaylar: olaylarK, simdi: gun + 26 * HOUR, ...r }
}

function calistir17 (dosya, d) {
  const L = defter(dosya.zincir)
  const ctx = baglam(L, katalog({ vektor: true }), K_OLAYLAR, [d.kural, ...d.olaylar])
  const k = Kr.kuralTanimi(ctx.kayitlar.find((x) => x.type === 'hf.kural'))
  const s = olaylar(ctx).sayilir.sort((a, b) => a.t - b.t)
  const vakalar = s.map((e) => {
    const r = Kr.degerlendir(k, s, e.t + 1)
    return hex(Vk.vakaAnahtari(K_OLAYLAR, b4a.from(k.id, 'hex'), k.subj, r.pencereBasi, 0))
  })
  return { vakalar, tetikler: Kr.tetikler(k, s, d.simdi).map((t) => t.pencereBasi) }
}

// Cihazın yazdığı hf.vaka.sahip yok sayılır
function v18 (L) {
  sifirla()
  const a = vakaAlan(2)
  const ac = kayit(L, U.kerem, 'hf.vaka', a, T0 + MIN)
  const b2 = kayit(L, U.kerem, 'hf.vaka.basamak', Vk.basamakAlanlari(a.vaka, 2, 0, T0 + MIN), T0 + MIN, { n: 1 })
  const cihazSahip = kayit(L, C.isci1, 'hf.vaka.sahip', Vk.sahipAlanlari(a.vaka, T0 + 5 * MIN), T0 + 5 * MIN)
  const uyeSahip = kayit(L, U.kerem, 'hf.vaka.sahip', Vk.sahipAlanlari(a.vaka, T0 + 6 * MIN), T0 + 6 * MIN)
  const cihazla = durumOf({ zincir: ZINCIR }, [ac, b2, cihazSahip])
  const uyeyle = durumOf({ zincir: ZINCIR }, [ac, b2, cihazSahip, uyeSahip])
  esit([cihazla.sahipli, uyeyle.sahipli, uyeyle.sahip], [false, true, hex(U.kerem.memberId)], 'yazar denetimi')
  return { durumlar: [{ kayitlar: [ac, b2, cihazSahip], sahipli: false }, { kayitlar: [ac, b2, cihazSahip, uyeSahip], sahipli: true, sahip: uyeyle.sahip }] }
}

function vektorler () {
  const L = defter()
  const kat = katalog({ vektor: true })
  return {
    aciklama: 'RFC-0006 §17: olay, rutin, kural, vaka, merdiven. Zincir ledger-v21.json ana zincirinin (21 olay) devamıdır: Ebeveynler koleksiyonu, Olaylar:Ev bırakma anahtarıyla güncellenir, isci2 eklenir. Kayıtlar { inner: OpInner hex, opId } biçimindedir; opId = hash("hf/olay-vektor-op/", inner) sentetiktir (motor yalnız sıralama için kullanır). Ürün türleri `urun_turleri`ndedir. utc_dk = 180.',
    zincir: ZINCIR,
    familyId: hex(L.familyId),
    urun_turleri: O.VEKTOR_URUN_TURLERI,
    v1: v1(L, kat),
    v2: v2(),
    v3: v3(),
    v4: v4(),
    v5: v5(),
    v6: v6(L, kat),
    v7: v7(L, kat),
    v8: v8(L),
    v9: v9(L),
    v10: v10(L),
    v11: v11(L, kat),
    v12: v12(L),
    v13: v13(L, kat),
    v14: v14(L, kat),
    v15: v15(),
    v16: v16(L),
    v17: v17(L, kat),
    v18: v18(L)
  }
}

module.exports = { vektorler, baglam, durumOf, calistir6, calistir7, calistir10, calistir11, calistir12, calistir13, calistir14, calistir16, calistir17, jsonla }
