// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// rule.js — kural: sabit koşullar, kayan pencere, vaka penceresi, çekirdek kuralları, bastırma (RFC-0006 §9)
//
// Kural her zaman rutinin önüne geçer. Değerlendirme anı T: olayla tetiklenende olayın _t + 1'i, zamanla tetiklenende
// (yok koşulu) motorun saati. Vaka penceresi pencereBasi = floor(T / P) × P, P en uzun koşulun penceresi; böylece
// aynı tetikleme her motorda aynı vakaya düşer.
const { hlc: { msOf } } = require('@havenfold/records')
const { kdf: { hash } } = require('@havenfold/core')
const { MIN, GEC_MS, kesintiVar, kaynaklarOf, guvenYeter, icinde } = require('./routine')
const { adGecerli } = require('./type')

const OLCU = ['sayi', 'toplam', 'yok']
const KARSI = { gt: (a, b) => a > b, ge: (a, b) => a >= b, lt: (a, b) => a < b, le: (a, b) => a <= b }
const isInt = (x) => Number.isSafeInteger(x)

// --- Tanım (§9.1) --------------------------------------------------------------------------------------------------

// Biçim 2 (RFC-0032 §4): sabit yerel pencere. Biçim 1'de bu alanlar olamaz (§14 INVALID_RULE)
const BICIM2_ALANLARI = ['gun_saati', 'gun', 'kapatan_olay', 'kesintide_ac']
const MAX_KAPATAN = 8

function kuralTanimi (k) {
  const f = k.fields
  const subj = k.tf._subj
  if (typeof subj !== 'string' || !Array.isArray(f.kosullar) || !f.kosullar.length) return null
  const bicim = f.bicim == null ? 1 : f.bicim
  if (bicim !== 1 && bicim !== 2) return null
  // null alan yok sayılır: biçim 2'den biçim 1'e dönen kayıt alanları null ile siler (inceleme 20 B9)
  if (bicim === 1 && BICIM2_ALANLARI.some((a) => f[a] != null)) return null
  const kosullar = []
  for (const x of f.kosullar) {
    if (!Array.isArray(x) || x.length !== 6) return null
    const [olay, olcu, alan, p, karsi, deger] = x
    if (typeof olay !== 'string' || !OLCU.includes(olcu) || typeof alan !== 'string') return null
    // Biçim 1: kayan pencere 1–1440 dk; biçim 2: her zaman 0 (eski motor 0'ı geçersiz sayar, §4)
    if (!isInt(p) || (bicim === 1 ? p < 1 || p > 1440 : p !== 0) || !isInt(deger)) return null
    if (olcu !== 'yok' && !KARSI[karsi]) return null
    if (olcu === 'toplam' && !alan) return null
    kosullar.push({ olay, olcu, alan, p, karsi, deger })
  }
  const onem = f.onem === undefined ? 2 : f.onem
  const eylem = f.eylem === undefined ? 'vaka' : f.eylem
  if (!['vaka', 'sustur'].includes(eylem) || !isInt(onem) || onem < 0 || onem > 3) return null
  // sureler tam 4 öğe: [2→3, 3→4, sıra arası, →5] (RFC-0019 7.9); kısası merdiveni durduruyordu (olay 11)
  // cihazlar: bu kuralı görev parametresiyle çalıştıran cihazlar (hex); cihazın açtığı vaka yalnız bunlardan geçerli
  // (RFC-0019 §11.5 b, D-inceleme-4 bulgu 2)
  if (f.cihazlar !== undefined && !(Array.isArray(f.cihazlar) && f.cihazlar.every((x) => typeof x === 'string' && /^[0-9a-f]{32}$/.test(x)))) return null
  if (f.sureler !== undefined && !(Array.isArray(f.sureler) && f.sureler.length === 4 && f.sureler.every((s) => isInt(s) && s >= 0))) return null
  let b2 = null
  if (bicim === 2) {
    const gs = f.gun_saati === undefined ? [0, 0] : f.gun_saati
    const gun = f.gun === undefined ? 1 : f.gun
    const utcDk = f.utc_dk === undefined ? 180 : f.utc_dk
    if (!Array.isArray(gs) || gs.length !== 2 || !gs.every((x) => isInt(x) && x >= 0 && x <= 1439)) return null
    if (!isInt(gun) || gun < 1 || gun > 7 || !isInt(utcDk) || utcDk < -720 || utcDk > 840) return null
    const kapatan = f.kapatan_olay === undefined ? [] : f.kapatan_olay
    if (f.kapatan_olay !== undefined && !(Array.isArray(kapatan) && kapatan.length >= 1 && kapatan.length <= MAX_KAPATAN && kapatan.every(adGecerli))) return null
    if (kapatan.length && eylem === 'sustur') return null
    if (f.kesintide_ac !== undefined && typeof f.kesintide_ac !== 'boolean') return null
    b2 = { gunSaati: [gs[0], gs[1]], gun, utcDk, kapatan: [...new Set(kapatan)], kesintideAc: f.kesintide_ac === true }
  }
  return {
    bicim,
    ...(b2 || {}),
    id: k.recordId,
    stamp: k.stamp,
    subj,
    kosullar,
    eylem,
    onem,
    hizmet: f.hizmet === true && onem >= 2, // 5. basamak yalnız önem ≥ 2
    sessiz_disi: f.sessiz_disi === true && onem === 3,
    sureler: f.sureler || null,
    cihazlar: f.cihazlar || [],
    aktif: f.aktif === undefined ? true : f.aktif === true,
    P: Math.max(...kosullar.map((x) => x.p))
  }
}

// Yazan uygulamaya dönen denetim (RULE_WRITE, RFC-0032 §14): alanlar { _subj, kosullar, … }. Dönüş: null ya da kod
const kuralHatasi = (alanlar) => (kuralTanimi({ fields: alanlar || {}, tf: { _subj: alanlar && alanlar._subj }, recordId: '', stamp: null }) ? null : 'INVALID_RULE')

const turleri = (kural) => [...new Set(kural.kosullar.map((x) => x.olay))]
const pencereBasiOf = (T, P) => Math.floor(T / (P * MIN)) * P * MIN

// --- Değerlendirme (§9.2) -------------------------------------------------------------------------------------

// olaylar: bu öznenin sayılır olayları. Dönüş: { tetik, pencereBasi, katki, deger }
function degerlendir (kural, olaylar, T, { araliklar = new Map(), kaynakAktif = null } = {}) {
  const katki = []
  let deger = null
  for (const x of kural.kosullar) {
    const ar = [T - x.p * MIN, T]
    const ic = icinde(olaylar.filter((e) => e.type === x.olay), ar)
    if (x.olcu === 'yok') {
      if (ic.length) return { tetik: false }
      // Gözlem kaynağı pencerenin %25'inden fazlasında çevrimdışıysa yok tetiklenmez
      const kaynaklar = kaynaklarOf(olaylar.filter((e) => e.type === x.olay), ar, kaynakAktif)
      if (kesintiVar(kaynaklar, araliklar, ar)) return { tetik: false }
      continue
    }
    const v = x.olcu === 'sayi' ? ic.length : ic.reduce((a, e) => a + (isInt(e.fields[x.alan]) ? e.fields[x.alan] : 0), 0)
    if (!KARSI[x.karsi](v, x.deger)) return { tetik: false }
    if (deger === null) deger = v // ölçülen değer: yok olmayan ilk koşulunki
    katki.push(...ic)
  }
  // Güven: yalnız yok koşullarından oluşan kural katkı vermez, denetimden muaftır (§7.2)
  const yokOnly = kural.kosullar.every((x) => x.olcu === 'yok')
  if (!yokOnly && !guvenYeter(katki)) return { tetik: false }
  const tekil = [...new Map(katki.map((e) => [e.recordId, e])).values()]
  return { tetik: true, pencereBasi: pencereBasiOf(T, kural.P), katki: tekil, deger: deger === null ? 0 : deger }
}

// Öznenin olayıyla değerlendirme anları ve (yok koşulu varsa) şimdi. Dönüş: vaka adayları, pencereBasi'ye göre tekil.
// simdi verilmişse (RFC-0019 §11.5 c, 7.6) yalnız süren ve son 24 saatte biten pencereler değerlendirilir; kuralın
// türü belirleyen işleminden önce biten pencereler değerlendirilmez. Pencerenin bitişinden 24 saatten sonra yazılmış
// (hlc) olay hiçbir katkıya girmez. simdi null: kayıtlar kümesinin işlevi (susturma, işçi).
function tetikler (kural, olaylar, simdi, opts = {}) {
  if (kural.bicim === 2) return tetikler2(kural, olaylar, simdi, opts)
  if (!kural.aktif) return []
  const tur = new Set(turleri(kural))
  const ilgili = olaylar.filter((e) => tur.has(e.type))
  const ozneler = kural.subj === '*' ? [...new Set(ilgili.map((e) => e.subj))].sort() : [kural.subj]
  const kuralAni = kural.stamp && kural.stamp.hlc !== undefined ? msOf(kural.stamp.hlc) : -Infinity
  const out = new Map()
  for (const subj of ozneler) {
    const kendi = ilgili.filter((e) => e.subj === subj)
    const anlar = kendi.map((e) => ({ T: e.t + 1, e }))
    if (simdi !== null && kural.kosullar.some((x) => x.olcu === 'yok')) anlar.push({ T: simdi, e: null })
    for (const { T } of anlar.sort((a, b) => a.T - b.T)) {
      if (T > (simdi === null ? Infinity : simdi + 1)) continue
      const pb = pencereBasiOf(T, kural.P)
      const son = pb + kural.P * MIN
      if (simdi !== null && (son + GEC_MS <= simdi || son <= kuralAni)) continue
      const zamaninda = kendi.filter((e) => msOf(e.stamp.hlc) <= son + GEC_MS)
      const r = degerlendir(kural, zamaninda, T, opts)
      if (!r.tetik) continue
      const k = subj + '|' + r.pencereBasi
      if (!out.has(k)) out.set(k, { subj, T, pencereBasi: r.pencereBasi, pencereSonu: son, katki: r.katki, deger: r.deger })
    }
  }
  return [...out.values()]
}

// --- Biçim 2: sabit pencere (RFC-0032 §5) ---------------------------------------------------------------------

const DAY = 86_400_000

// §5.1: yerel gün s'de başlayan pencere [S, E)
function sabitPencere (kural, s) {
  const [bas, bit] = kural.gunSaati
  const k = bit <= bas ? 1 : 0
  return [s * DAY + (bas - kural.utcDk) * MIN, (s + kural.gun - 1 + k) * DAY + (bit - kural.utcDk) * MIN]
}

const yerelGun = (kural, t) => Math.floor((t + kural.utcDk * MIN) / DAY)

// t'yi içeren pencerelerin başladığı günler (gun ≥ 2'de pencereler üst üste biner)
function gunlerIcin (kural, t) {
  const d = yerelGun(kural, t)
  const out = []
  for (let s = d - kural.gun - 1; s <= d + 1; s++) {
    const [S, E] = sabitPencere(kural, s)
    if (t >= S && t < E) out.push(s)
  }
  return out
}

// §5.2, §5.4: koşullar _t ∈ [S, E) olan olaylarla. Kesinti yok koşullarına ve lt/le karşılaştırmalı sayı/toplama
// uygulanır (eksik veri sayıyı düşürür); kesintide_ac ise uygulanmaz. Dönüş: { tetik, katki, deger }
function degerlendir2 (kural, olaylar, ar, { araliklar = new Map(), kaynakAktif = null } = {}) {
  const katki = []
  let deger = null
  const kesinti = (x) => !kural.kesintideAc && kesintiVar(kaynaklarOf(olaylar.filter((e) => e.type === x.olay), ar, kaynakAktif), araliklar, ar)
  for (const x of kural.kosullar) {
    const ic = icinde(olaylar.filter((e) => e.type === x.olay), ar)
    if (x.olcu === 'yok') {
      if (ic.length || kesinti(x)) return { tetik: false }
      continue
    }
    const v = x.olcu === 'sayi' ? ic.length : ic.reduce((a, e) => a + (isInt(e.fields[x.alan]) ? e.fields[x.alan] : 0), 0)
    if (!KARSI[x.karsi](v, x.deger)) return { tetik: false }
    if ((x.karsi === 'lt' || x.karsi === 'le') && kesinti(x)) return { tetik: false }
    if (deger === null) deger = v
    katki.push(...ic)
  }
  const yokOnly = kural.kosullar.every((x) => x.olcu === 'yok')
  if (!yokOnly && !guvenYeter(katki)) return { tetik: false }
  return { tetik: true, katki: [...new Map(katki.map((e) => [e.recordId, e])).values()], deger: deger === null ? 0 : deger }
}

// Bir öznenin s penceresi (zamanında yazılmış olaylarla; pencere bitiminden 24 saat sonra yazılan girmez, §5.2 madde 5)
function pencereSonucu (kural, kendi, s, opts) {
  const [S, E] = sabitPencere(kural, s)
  const zamaninda = kendi.filter((e) => msOf(e.stamp.hlc) <= E + GEC_MS)
  return { S, E, ...degerlendir2(kural, zamaninda, [S, E], opts) }
}

// Biçim 2 tetikleri. simdi verilmişse yalnız E ≤ simdi < E + 24 saat olan (bitmiş, geç kalınmamış) pencereler;
// simdi null: olayların düştüğü pencereler (susturma). Kuralın türü belirleyen işleminden önce biten pencere
// değerlendirilmez ve tekrar yok kuralında "önceki pencere sağlanmıyor" sayılır (§5.3).
function tetikler2 (kural, olaylar, simdi, opts = {}) {
  if (!kural.aktif) return []
  const tur = new Set(turleri(kural))
  const ilgili = olaylar.filter((e) => tur.has(e.type))
  const ozneler = kural.subj === '*' ? [...new Set(ilgili.map((e) => e.subj))].sort() : [kural.subj]
  const kuralAni = kural.stamp && kural.stamp.hlc !== undefined ? msOf(kural.stamp.hlc) : -Infinity
  const gunler = new Set()
  if (simdi !== null) {
    const d = yerelGun(kural, simdi)
    for (let s = d - kural.gun - 2; s <= d; s++) {
      const [, E] = sabitPencere(kural, s)
      if (E <= simdi && simdi < E + GEC_MS) gunler.add(s)
    }
  } else {
    for (const e of ilgili) for (const s of gunlerIcin(kural, e.t)) gunler.add(s)
  }
  const out = []
  for (const subj of ozneler) {
    const kendi = ilgili.filter((e) => e.subj === subj)
    for (const s of [...gunler].sort((a, b) => a - b)) {
      const r = pencereSonucu(kural, kendi, s, opts)
      if (!r.tetik || r.E <= kuralAni) continue
      if (kural.gun >= 2) {
        const once = pencereSonucu(kural, kendi, s - 1, opts)
        if (once.tetik && once.E > kuralAni) continue
      }
      out.push({ subj, T: r.E, pencereBasi: r.S, pencereSonu: r.E, katki: r.katki, deger: r.deger })
    }
  }
  return out
}

// Vakanın çözülmesi (§6.1, açıklama 1): kapatan olay (türü kapatan_olay'da, aynı özne, pencere bittikten sonra: _t ≥ E)
// ya da koşulun artık sağlanmaması. olaylar: vakayı açan hesapla aynı küme, sayılır olaylar (_conf ≥ 50; özne
// normalleştirilmiş). Pencerenin içine geç yazılan olay koşul yolundan çözer. Dönüş: null ya da { neden: 'kapatan' | 'kosul', olay? }
function cozulme (kural, d, olaylar, opts = {}) {
  if (!kural || kural.bicim !== 2 || !Array.isArray(d.pencere)) return null
  const [S, E] = d.pencere
  const kapatan = new Set(kural.kapatan)
  const ilk = olaylar.filter((e) => kapatan.has(e.type) && e.subj === d.subj && e.t >= E).sort((a, b) => a.t - b.t || cmpStamp(a, b))[0]
  if (ilk) return { neden: 'kapatan', olay: ilk }
  const tur = new Set(turleri(kural))
  const kendi = olaylar.filter((e) => tur.has(e.type) && e.subj === d.subj)
  const zamaninda = kendi.filter((e) => msOf(e.stamp.hlc) <= E + GEC_MS)
  return degerlendir2(kural, zamaninda, [S, E], opts).tetik ? null : { neden: 'kosul' }
}

// Vakanın yerel günü (inceleme 20 B8): pencerenin başlangıcı, kuralın gun_saati'nin başlangıcına göre en yakın güne
// yuvarlanır; utc_dk değişse de (yaz saati) aynı yerel günün penceresi aynı güne düşer. Aynı kural, özne ve yerel gün
// için ikinci vaka açılmaz.
const pencereGunu = (kural, S) => Math.round((S + (kural.utcDk - kural.gunSaati[0]) * MIN) / DAY)

const cmpStamp = (a, b) => (a.recordId < b.recordId ? -1 : a.recordId > b.recordId ? 1 : 0)

// --- Çekirdek kuralları (§9.4) --------------------------------------------------------------------------------

const cekirdekKaynakId = (tur) => hash('hf/vaka-cekirdek/', tur).subarray(0, 16)

// Önem: katalogdaki değer; özne kutuysa onem_kutu (hf.device.offline). hf.sos: 1 dakika, acil.
function cekirdekOnemi (def, L, subj) {
  if (def.onem_kutu !== undefined && typeof subj === 'string' && subj.startsWith('uye:') && L.members.get(subj.slice(4))?.role === 'kutu') return def.onem_kutu
  return def.onem || 0
}

// Önemi ≥ 1 olan çekirdek katalog olayları vaka açar. Dönüş: [{ tur, subj, onem, pencereBasi, pencereSonu, katki }]
function cekirdekTetikler (katalog, L, olaylar) {
  const out = new Map()
  for (const e of olaylar) {
    if (!e.type.startsWith('hf.') || e.fields.kopya === true) continue // kesinti kopyası vaka açmaz
    const def = katalog.get(e.type)
    if (!def || !def.olay) continue
    const onem = cekirdekOnemi(def, L, e.subj)
    if (onem < 1) continue
    const P = e.type === 'hf.sos' ? 1 : 1440
    const pb = pencereBasiOf(e.t + 1, P)
    const son = pb + P * MIN
    if (msOf(e.stamp.hlc) > son + GEC_MS) continue
    const k = e.type + '|' + e.subj + '|' + pb
    if (!out.has(k)) out.set(k, { tur: e.type, subj: e.subj, onem, pencereBasi: pb, pencereSonu: son, katki: [] })
    out.get(k).katki.push(e)
  }
  return [...out.values()].filter((x) => guvenYeter(x.katki))
}

// --- Bastırma (§9.3) ----------------------------------------------------------------------------------------------

const ortusur = (a, b) => a[0] < b[1] && b[0] < a[1]

// rutinVaka: { subj, olay, pencere: [bas, son] }. kuralVakalari: [{ subj, turler, pencere }]. susturmalar: aynı biçim.
// Aynı özne ve aynı olay türü için örtüşen bir kural vakası ya da susturma varsa rutin vakası bastırılmıştır.
function rutinBastirildi (rutinVaka, kuralVakalari, susturmalar) {
  const uyar = (x) => x.subj === rutinVaka.subj && x.turler.includes(rutinVaka.olay) && ortusur(x.pencere, rutinVaka.pencere)
  return kuralVakalari.some(uyar) || susturmalar.some(uyar)
}

// Susturma kurallarının sağlandığı pencereler: olayla tetiklenen anlar ve (yok koşulu için) simdi. Bastırma kararı vaka
// kaydına yazıldığı için (bastirildi) saate bağlı kısım bir kez verilir (inceleme olay 22).
function susturmaPencereleri (kurallar, olaylar, simdi = null, opts = {}) {
  const out = []
  for (const k of kurallar) {
    if (k.eylem !== 'sustur') continue
    const anlar = tetikler(k, olaylar, null, opts)
    if (simdi !== null && k.kosullar.some((x) => x.olcu === 'yok')) anlar.push(...tetikler(k, olaylar, simdi, opts))
    for (const t of anlar) out.push({ subj: t.subj, turler: turleri(k), pencere: [t.pencereBasi, t.pencereSonu] })
  }
  return out
}

module.exports = { OLCU, kuralTanimi, kuralHatasi, sabitPencere, gunlerIcin, degerlendir2, tetikler2, cozulme, pencereGunu, turleri, pencereBasiOf, degerlendir, tetikler, cekirdekKaynakId, cekirdekOnemi, cekirdekTetikler, ortusur, rutinBastirildi, susturmaPencereleri }
