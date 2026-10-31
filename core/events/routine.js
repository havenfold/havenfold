// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// routine.js — rutin: gün, pencere, ölçü, öğrenme, normal bant, sapma (RFC-0006 §8)
//
// Bütün hesaplar tamsayıdır. Paylaşılan sonucu yalnız olay kayıtları belirler; saat yalnız hangi günün ve hangi
// pencerenin değerlendirildiğine karar verir (§3 "Saat").
const { hlc: { msOf } } = require('@havenfold/records')

const DAY = 86_400_000
const MIN = 60_000
const GEC_MS = 24 * 3_600_000 // geç gelen olay (§12)
const OLCULER = ['sayi', 'toplam', 'bosluk']

const isInt = (x) => Number.isSafeInteger(x)
const floorDiv = (a, b) => Math.floor(a / b)
const mod = (a, b) => ((a % b) + b) % b

// --- Tanım (§8.1) ---------------------------------------------------------------------------------------------

// k: hf.rutin kaydı. Geçersizse null.
function rutinTanimi (k) {
  const f = k.fields
  const subj = k.tf._subj
  const r = {
    id: k.recordId,
    stamp: k.stamp,
    subj,
    olay: f.olay,
    olcu: f.olcu,
    alan: f.alan === undefined ? '' : f.alan,
    pencereler: f.pencereler === undefined ? [[0, 1440]] : f.pencereler,
    utc_dk: f.utc_dk === undefined ? 180 : f.utc_dk,
    gun_basi_dk: f.gun_basi_dk === undefined ? 0 : f.gun_basi_dk,
    gecmis_gun: f.gecmis_gun === undefined ? 28 : f.gecmis_gun,
    en_az_gun: f.en_az_gun === undefined ? 7 : f.en_az_gun,
    k: f.k === undefined ? 3 : f.k,
    en_dar: f.en_dar === undefined ? 1 : f.en_dar,
    onem: f.onem === undefined ? 2 : f.onem,
    aktif: f.aktif === undefined ? true : f.aktif
  }
  if (typeof subj !== 'string' || typeof r.olay !== 'string' || !OLCULER.includes(r.olcu)) return null
  if (r.olcu === 'toplam' && (typeof r.alan !== 'string' || !r.alan)) return null
  if (!Array.isArray(r.pencereler) || !r.pencereler.length) return null
  for (const p of r.pencereler) if (!(Array.isArray(p) && p.length === 2 && isInt(p[0]) && isInt(p[1]) && p[0] >= 0 && p[0] < p[1] && p[1] <= 1440)) return null
  for (const x of ['utc_dk', 'gun_basi_dk', 'gecmis_gun', 'en_az_gun', 'k', 'en_dar', 'onem']) if (!isInt(r[x])) return null
  if (r.gecmis_gun < 7 || r.gecmis_gun > 56 || r.en_az_gun < 1 || r.k < 0 || r.en_dar < 0 || r.onem < 0 || r.onem > 3) return null
  if (r.gun_basi_dk < 0 || r.gun_basi_dk >= 1440 || typeof r.aktif !== 'boolean') return null
  return r
}

// --- Gün ve pencere (§8.2) --------------------------------------------------------------------------------------

const yerelMs = (t, r) => t + r.utc_dk * MIN - r.gun_basi_dk * MIN
const gunOf = (t, r) => floorDiv(yerelMs(t, r), DAY)
const dakikaOf = (t, r) => floorDiv(mod(yerelMs(t, r), DAY), MIN)

// Günün penceresinin Unix ms aralığı [bas, son)
function pencereAraligi (gun, [a, b], r) {
  const bas = gun * DAY + a * MIN - r.utc_dk * MIN + r.gun_basi_dk * MIN
  return [bas, bas + (b - a) * MIN]
}

// --- Ölçü (§8.3) --------------------------------------------------------------------------------------------------

const icinde = (olaylar, [bas, son]) => olaylar.filter((e) => e.t >= bas && e.t < son)

// olaylar: bu rutinin (tür, özne) sayılır olayları. son: ölçümün bittiği an (süren pencerede şimdi)
function olc (r, olaylar, [bas, son]) {
  const ic = icinde(olaylar, [bas, son])
  if (r.olcu === 'sayi') return ic.length
  if (r.olcu === 'toplam') return ic.reduce((a, e) => a + (isInt(e.fields[r.alan]) ? e.fields[r.alan] : 0), 0)
  // bosluk: pencere başından ilk olaya, olaylar arası, son olaydan pencere sonuna; en uzunu, dakika
  const ts = ic.map((e) => e.t).sort((a, b) => a - b)
  let onceki = bas
  let enUzun = 0
  for (const t of ts) { enUzun = Math.max(enUzun, t - onceki); onceki = t }
  enUzun = Math.max(enUzun, son - onceki)
  return floorDiv(enUzun, MIN)
}

// --- Gözlem kesintisi (§8.4 madde 2) ------------------------------------------------------------------------------

// hf.device.offline / online olaylarından kaynak başına çevrimdışı aralıklar: kaynak hex → [[bas, son)]
function kesintiAraliklari (olaylar) {
  const bySrc = new Map()
  for (const e of olaylar) {
    if (e.type !== 'hf.device.offline' && e.type !== 'hf.device.online') continue
    const id = typeof e.subj === 'string' ? e.subj.slice(e.subj.indexOf(':') + 1) : null
    if (!id) continue
    if (!bySrc.has(id)) bySrc.set(id, [])
    bySrc.get(id).push(e)
  }
  const out = new Map()
  for (const [id, list] of bySrc) {
    list.sort((a, b) => a.t - b.t || (a.type === 'hf.device.online' ? -1 : 1))
    const ar = []
    let acik = null
    for (const e of list) {
      if (e.type === 'hf.device.offline' && acik === null) acik = e.t
      if (e.type === 'hf.device.online' && acik !== null) { ar.push([acik, e.t]); acik = null }
    }
    if (acik !== null) ar.push([acik, Infinity])
    out.set(id, ar)
  }
  return out
}

// Kaynaklardan biri pencerenin %25'inden fazlasında çevrimdışıysa kesinti var
function kesintiVar (kaynaklar, araliklar, [bas, son]) {
  const uzun = son - bas
  for (const src of kaynaklar) {
    let kapli = 0
    let ileri = bas
    for (const [a, b] of (araliklar.get(src) || []).slice().sort((x, y) => x[0] - y[0])) {
      const x = Math.max(a, ileri)
      const y = Math.min(b, son)
      if (y > x) { kapli += y - x; ileri = y }
    }
    if (kapli * 4 > uzun) return true
  }
  return false
}

// Olayların gözlem kaynakları: cihaz yazarları ve device: biçimli _obs. ar verilirse yalnız değerlendirilen pencereye
// yakın (pencereden en çok 7 gün önce başlayan) olaylardan; aktif(id) false dönen (kaldırılmış) cihaz kaynak sayılmaz
// (inceleme olay 7: kalıcı çevrimdışı eski kaynak kuralı ve rutini kapatıyordu).
const YAKIN_MS = 7 * DAY
function kaynaklarOf (olaylar, ar = null, aktif = null) {
  const s = new Set()
  for (const e of olaylar) {
    if (ar && (e.t < ar[0] - YAKIN_MS || e.t >= ar[1])) continue
    if (e.yazar === 'cihaz') s.add(e.authorHex)
    if (typeof e.obs === 'string' && e.obs.startsWith('device:')) s.add(e.obs.slice(7))
  }
  return [...s].filter((id) => !aktif || aktif(id)).sort()
}

// --- Bant (§8.4 madde 4) -------------------------------------------------------------------------------------------

const altOrtanca = (xs) => [...xs].sort((a, b) => a - b)[floorDiv(xs.length - 1, 2)]

function bant (xs, k, enDar) {
  const m = altOrtanca(xs)
  const mad = altOrtanca(xs.map((x) => Math.abs(x - m)))
  const w = Math.max(k * mad, floorDiv(m + 3, 4), enDar)
  return { m, mad, w, alt: m - w, ust: m + w }
}

// --- Değerlendirme ------------------------------------------------------------------------------------------------

// Bir pencerenin öğrenme durumu: değerlendirilen günden önceki gecmis_gun tam gün. Gözlem başlamadan (bu rutinin ilk
// sayılır olayından önceki) günler geçerli gün değildir. gercek(gun, pi) true ise o gün o pencere dışarıda kalır.
function ogren (r, olaylar, gun, pi, { araliklar = new Map(), gercek = () => false, kaynakAktif = null } = {}) {
  let ilk = Infinity
  for (const e of olaylar) ilk = Math.min(ilk, gunOf(e.t, r)) // yayma yok: çok büyük dizide RangeError (olay 20)
  const degerler = []
  let kesintili = 0
  for (let g = gun - r.gecmis_gun; g < gun; g++) {
    if (g < ilk) continue
    const ar = pencereAraligi(g, r.pencereler[pi], r)
    if (kesintiVar(kaynaklarOf(olaylar, ar, kaynakAktif), araliklar, ar)) { kesintili++; continue }
    if (gercek(g, pi)) continue
    degerler.push(olc(r, olaylar, ar))
  }
  const olgun = degerler.length >= r.en_az_gun
  return { olgun, gun: degerler.length, kesintili, degerler, ...(degerler.length ? bant(degerler, r.k, r.en_dar) : {}) }
}

// Güven (§7.2): en az bir yüksek (≥ 80) ya da _t'leri farklı en az iki orta (50–79) olay
function guvenYeter (katki) {
  if (katki.some((e) => e.conf >= 80)) return true
  return new Set(katki.filter((e) => e.conf >= 50 && e.conf < 80).map((e) => e.t)).size >= 2
}

// §8.5: 1 cok (x > üst; pencere sürerken de), 2 az (yalnız pencere bitince x < alt; alt ≤ 0 ise az yok), 0 normal
function sapmaYonu (x, alt, ust, bitti) {
  if (x > ust) return 1
  if (bitti && x < alt && alt > 0) return 2
  return 0
}

// Sapmalar: süren pencereler ve son 24 saatte biten pencereler (geç pencere yeni vaka açmaz).
// olaylar: bu rutinin (tür, özne) sayılır olayları. Dönüş: [{ gun, pencere, pencereBasi, pencereSonu, yon, deger, alt, ust, olaylar }]
function sapmalar (r, olaylar, simdi, opts = {}) {
  if (!r.aktif) return []
  const out = []
  const bugun = gunOf(simdi, r)
  for (const gun of [bugun - 1, bugun]) {
    r.pencereler.forEach((p, pi) => {
      const [bas, son] = pencereAraligi(gun, p, r)
      if (simdi < bas || simdi >= son + GEC_MS) return
      const bitti = simdi >= son
      const ar = [bas, bitti ? son : simdi]
      if (kesintiVar(kaynaklarOf(olaylar, ar, opts.kaynakAktif), opts.araliklar || new Map(), ar)) return
      const o = ogren(r, olaylar, gun, pi, opts)
      if (!o.olgun) return
      // Açılış kararına pencerenin bitişinden 24 saatten sonra yazılmış olay girmez
      const zamaninda = olaylar.filter((e) => msOf(e.stamp.hlc) <= son + GEC_MS)
      const x = olc(r, zamaninda, ar)
      const katki = icinde(zamaninda, ar)
      const kayit = { gun, pencere: pi, pencereBasi: bas, pencereSonu: son, deger: x, alt: o.alt, ust: o.ust, olaylar: katki.slice(0, 16).map((e) => e.recordId) }
      const yon = sapmaYonu(x, o.alt, o.ust, bitti)
      // bosluk bir yokluk ölçüsüdür: güven denetimi yerine kesinti denetimi uygulanır (§7.2)
      if (yon === 1 && r.olcu !== 'bosluk' && !guvenYeter(katki)) return
      if (yon) out.push({ ...kayit, yon })
    })
  }
  return out
}

// Kartta: "Bugün 3 kez · normal 4–6" (§13.2, SDK rutinDurumu)
function rutinDurumu (r, olaylar, simdi, opts = {}) {
  const gun = gunOf(simdi, r)
  return r.pencereler.map((p, pi) => {
    const [bas, son] = pencereAraligi(gun, p, r)
    const o = ogren(r, olaylar, gun, pi, opts)
    return { pencere: pi, olgun: o.olgun, gun: o.gun, m: o.m, alt: o.alt, ust: o.ust, bugun: simdi < bas ? 0 : olc(r, olaylar, [bas, Math.min(son, simdi)]) }
  })
}

// Aynı (_subj, olay, olcu, alan) için birden çok rutin kaydı: asıl olan türü belirleyen işlemi en küçük olan
function asilRutinler (tanimlar, ilkOnce) {
  const by = new Map()
  for (const r of [...tanimlar].sort(ilkOnce)) {
    const k = [r.subj, r.olay, r.olcu, r.alan].join('|')
    if (!by.has(k)) by.set(k, { asil: r, kopyalar: [] })
    else by.get(k).kopyalar.push(r)
  }
  return [...by.values()]
}

module.exports = {
  DAY, MIN, GEC_MS, OLCULER, rutinTanimi, yerelMs, gunOf, dakikaOf, pencereAraligi, icinde, olc, kesintiAraliklari,
  kesintiVar, kaynaklarOf, altOrtanca, bant, ogren, guvenYeter, sapmaYonu, sapmalar, rutinDurumu, asilRutinler
}
