// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// extraction.js — yapılandırılmış çıkarma sözleşmesi (RFC-0013 §8): şema, değer çözme, dayanak denetimi, güven,
// kural tabanlı motor, onay ekranı ve onay jetonuyla kayıt alanları
//
// Kullanıcı onayı olmadan hiçbir şey kaydedilmez (kurucu §16.3 kural 4). Kayıt alanları yalnız onay ekranının
// ürettiği tek kullanımlık jetonla hesaplanır; jeton, ekranda gösterilen ve kaydedilen alanlara bağlıdır.
const b4a = require('b4a')
const sodium = require('sodium-native')
const { alanlar: { checkStrict, parseSrc, SRC_MAX } } = require('@havenfold/records')
const { N, tamKelime, kacis } = require('./text')
const cz = require('./resolver')

function fail (code) { throw new Error(code) }

const TURLER = ['metin', 'tarih', 'saat', 'tutar', 'sayi', 'telefon', 'eposta', 'iban', 'secim', 'kisi', 'zaman', 'liste']
const OGE_TURLERI = TURLER.filter((t) => t !== 'liste') // liste alanının öğe türü (D19 19)
const LISTE_MAX = 32
const OFSET_DK = 180 // zaman alanı: metindeki tarih ve saat Türkiye saatiyle (UTC+3) okunur
const DAYANAK = ['alinti', 'cikarim']
const AD_RE = /^[a-z0-9][a-z0-9_]*$/
const KURAL_SURUM = '1'
const METIN_MAX = 2000 // bayt; metin alanı

// --- Şema (§8.1) ---------------------------------------------------------------------------------------------------

function semaDogrula (s) {
  if (!s || typeof s.id !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/.test(s.id)) fail('INVALID_SCHEMA') // alt çizgi: D19 18
  if (!Number.isSafeInteger(s.v) || s.v < 1 || typeof s.hedef !== 'string' || !Array.isArray(s.alanlar) || !s.alanlar.length) fail('INVALID_SCHEMA')
  const adlar = new Set()
  for (const a of s.alanlar) {
    if (!a || !AD_RE.test(a.ad) || adlar.has(a.ad) || !TURLER.includes(a.tur) || !DAYANAK.includes(a.dayanak) || typeof a.zorunlu !== 'boolean') fail('INVALID_SCHEMA')
    if (a.tur === 'liste' && !OGE_TURLERI.includes(a.oge)) fail('INVALID_SCHEMA')
    if ((a.tur === 'secim' || a.oge === 'secim') && (!Array.isArray(a.secenekler) || !a.secenekler.length || !a.secenekler.every((x) => typeof x === 'string'))) fail('INVALID_SCHEMA')
    adlar.add(a.ad)
  }
  if (s.anahtarlar !== undefined && (!Array.isArray(s.anahtarlar) || !s.anahtarlar.every((x) => typeof x === 'string' && x.trim()))) fail('INVALID_SCHEMA')
  return s
}

// Belge türü (D19 21): şemanın isteğe bağlı 'anahtarlar'ından metinde tam kelime geçenlerin sayısı en büyük olan.
// Eşitlikte verilen sıradaki ilk; hiçbiri geçmiyorsa null (ürün kendi genel türüne düşer).
function belgeTuru (metin, semalar) {
  const n = N(metin)
  let en = null
  let enSayi = 0
  for (const s of semalar) {
    semaDogrula(s)
    const k = (s.anahtarlar || []).filter((x) => tamKelime(n, N(x))).length
    if (k > enSayi) { en = s; enSayi = k }
  }
  return en ? semaAdi(en) : null
}

const semaAdi = (s) => s.id + '@' + s.v

// --- Değer çözme (§8.1 tablo): türüne göre çözülemeyen değer null -------------------------------------------------

const RE_E164 = /^\+[1-9]\d{6,14}$/
const RE_EPOSTA = /^[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}$/u

// liste alanının öğesi, öğe türünde bir alan gibi çözülür
const ogeAlani = (alan) => ({ ad: alan.ad, tur: alan.oge, secenekler: alan.secenekler })

function degerCoz (alan, v, { kisiler = new Map() } = {}) {
  switch (alan.tur) {
    case 'liste': {
      // Liste: 1–32 öğe, her öğe öğe türünde çözülür; çözülemeyen öğe varsa liste null; aynı öğe bir kez
      if (!Array.isArray(v) || !v.length || v.length > LISTE_MAX) return null
      const out = []
      for (const x of v) {
        const d = degerCoz(ogeAlani(alan), x, { kisiler })
        if (d === null) return null
        if (!out.includes(d)) out.push(d)
      }
      return out
    }
    case 'zaman': return Number.isSafeInteger(v) && v >= 0 ? v : null // ms (UTC)
    case 'metin': {
      if (typeof v !== 'string') return null
      const t = v.replace(/\s+/g, ' ').trim()
      return t && b4a.byteLength(t) <= METIN_MAX ? t : null
    }
    case 'tarih': {
      if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
      const d = cz.tarihler(v)
      return d.length === 1 && d[0].deger === v ? v : null
    }
    case 'saat': return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null
    case 'tutar': return Number.isSafeInteger(v) && v >= 0 ? v : null
    case 'sayi': return Number.isSafeInteger(v) ? v : null
    case 'telefon': return typeof v === 'string' && RE_E164.test(v) ? v : null
    case 'eposta': return typeof v === 'string' && RE_EPOSTA.test(v) ? v : null
    case 'iban': {
      if (typeof v !== 'string' || !/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(v)) return null
      return v.startsWith('TR') && !cz.ibanGecerli(v) ? null : v
    }
    case 'secim': return typeof v === 'string' && alan.secenekler.includes(v) ? v : null
    case 'kisi': return typeof v === 'string' && /^uye:[0-9a-f]{32}$/.test(v) && kisiler.has(v) ? v : null
  }
  return null
}

// --- Dayanak (§8.3) ------------------------------------------------------------------------------------------------

// kisiler: Map<'uye:<hex>', ad> (defterdeki adlar)
function dayanakVar (alan, deger, kaynak, { kisiler = new Map() } = {}) {
  switch (alan.tur) {
    case 'liste': return Array.isArray(deger) && deger.every((x) => dayanakVar(ogeAlani(alan), x, kaynak, { kisiler }))
    case 'zaman': return zamanlar(kaynak).some((z) => z.deger === deger)
    case 'metin':
    case 'secim': return N(kaynak).includes(N(deger))
    case 'tarih': return cz.tarihler(kaynak).some((d) => d.deger === deger)
    case 'saat': return cz.saatler(kaynak).some((d) => d.deger === deger)
    case 'eposta': return N(kaynak).includes(N(deger))
    case 'kisi': { const ad = kisiler.get(deger); return !!ad && tamKelime(N(kaynak), N(ad)) }
  }
  // tutar, sayi, telefon, iban: değerin rakam dizisi kaynaktaki rakam dizilerinden birine eşit
  if (cz.rakamDizileri(kaynak).has(cz.rakamlar(deger))) return true
  if (alan.tur === 'telefon') return cz.telefonlar(kaynak).some((t) => t.deger === deger)
  if (alan.tur === 'tutar') return cz.tutarlar(kaynak).some((t) => t.deger === deger)
  return false
}

// --- Güven (§8.4) --------------------------------------------------------------------------------------------------

const MODEL_YOLLARI = ['telefon', 'isci', 'disari']

// yol: 'telefon' | 'isci' | 'disari' (model) ya da 'kural'
function guven ({ dayanak, yol, bulundu = false, denetimHanesi = false }) {
  const kural = yol === 'kural'
  if (!kural && !MODEL_YOLLARI.includes(yol)) fail('INVALID_PATH')
  if (dayanak === 'cikarim') return kural ? 70 : 60
  if (dayanak !== 'alinti') fail('INVALID_GROUNDING')
  if (!bulundu) return 40
  if (!kural) return 85
  return denetimHanesi ? 95 : 90
}

// Model ve kural aynı değeri bulduysa ikisinin büyüğü + 10, en çok 100
const ikisiAyni = (a, b) => Math.min(100, Math.max(a, b) + 10)

const denetimHanesiVar = (alan, deger) => alan.tur === 'iban' && cz.ibanGecerli(deger)

// --- Çıktı denetimi (§8.2): model çıktısı ---------------------------------------------------------------------------

// ham: { <alan adı>: değer } (modelin şemaya bağlı çıktısı). Şemada olmayan alan atılır; çözülemeyen değer atılır.
// yol: modelin yolu; model: _aiyol biçimi; kaynak: _src listesi.
function denetle (sema, ham, metin, { yol, model, kaynak = [], kisiler = new Map() }) {
  semaDogrula(sema)
  if (!MODEL_YOLLARI.includes(yol)) fail('INVALID_PATH')
  const alanlar = []
  for (const a of sema.alanlar) {
    if (!ham || !Object.prototype.hasOwnProperty.call(ham, a.ad)) continue
    const deger = degerCoz(a, ham[a.ad], { kisiler })
    if (deger === null) continue
    const bulundu = a.dayanak === 'alinti' && dayanakVar(a, deger, metin, { kisiler })
    alanlar.push({ ad: a.ad, deger, conf: guven({ dayanak: a.dayanak, yol, bulundu }) })
  }
  return { sema: semaAdi(sema), alanlar, kaynak: [...kaynak], model }
}

// --- Kural tabanlı motor (§8.2 son madde) --------------------------------------------------------------------------

// Zaman adayları: metindeki her tarih, ardından gelen ilk saatle (aralarında başka tarih yoksa); Türkiye saati
function zamanlar (metin) {
  const t = cz.tarihler(metin)
  const s = cz.saatler(metin)
  const out = []
  t.forEach((d, i) => {
    const sonraki = t[i + 1] ? t[i + 1].bas : Infinity
    const h = s.find((x) => x.bas >= d.bit && x.bas < sonraki)
    if (!h) return
    const [y, a, g] = d.deger.split('-').map(Number)
    const [sa, dk] = h.deger.split(':').map(Number)
    out.push({ deger: Date.UTC(y, a - 1, g, sa, dk) - OFSET_DK * 60_000, bas: d.bas, bit: h.bit })
  })
  return out
}

// Her türün adayları (metindeki sırayla). metin ve sayi türleri kuralla çıkarılmaz; şemaya özgü hesap 'hesap'
// seçeneğiyle verilir: { <ad>: (bulunanlar, metin) => değer | null } (cikarim, güven 70).
function adaylar (alan, metin, { kisiler }) {
  const n = N(metin)
  switch (alan.tur) {
    case 'tarih': return cz.tarihler(metin)
    case 'zaman': return zamanlar(metin)
    case 'saat': return cz.saatler(metin)
    case 'telefon': { // tarihle çakışan rakam dizisi telefon sayılmaz ("05.01.2026 10:00")
      const t = cz.tarihler(metin)
      return cz.telefonlar(metin).filter((x) => !t.some((d) => x.bas < d.bit && d.bas < x.bit))
    }
    case 'eposta': return cz.epostalar(metin)
    case 'iban': return cz.ibanlar(metin)
    case 'tutar': return cz.tutarlar(metin).filter((t) => t.birim)
    case 'secim': return konumlar(n, alan.secenekler.map((s) => [s, N(s)]))
    case 'kisi': return konumlar(n, [...kisiler].map(([id, ad]) => [id, N(ad)]))
  }
  return []
}

// Tam kelime geçen seçenekler, ilk geçtiği konumla
function konumlar (n, ciftler) {
  const out = []
  for (const [deger, k] of ciftler) {
    if (!k) continue
    const m = new RegExp('(?<![\\p{L}\\p{N}])' + kacis(k) + '(?![\\p{L}\\p{N}])', 'u').exec(n)
    if (m) out.push({ deger, bas: m.index, bit: m.index + k.length })
  }
  return out.sort((a, b) => a.bas - b.bas)
}

function kuralCikar (sema, metin, { kaynak = [], kisiler = new Map(), hesap = {}, surum = KURAL_SURUM } = {}) {
  semaDogrula(sema)
  const alanlar = []
  const bulunan = {}
  const sirada = new Map() // aynı türdeki i. alan i. adayı alır (belgede baslangic ve bitis ayrı tarihler, D19 21)
  const tarihAtama = tarihleriAta(sema, metin)
  for (const a of sema.alanlar) {
    if (a.dayanak !== 'alinti') continue
    if (a.tur === 'liste') {
      const hepsi = adaylar(ogeAlani(a), metin, { kisiler })
      const deger = hepsi.length ? degerCoz(a, hepsi.slice(0, LISTE_MAX).map((x) => x.deger), { kisiler }) : null
      if (deger === null) continue
      bulunan[a.ad] = deger
      alanlar.push({ ad: a.ad, deger, conf: guven({ dayanak: 'alinti', yol: 'kural', bulundu: true }), aralik: [hepsi[0].bas, hepsi[Math.min(hepsi.length, LISTE_MAX) - 1].bit] })
      continue
    }
    const tk = a.tur + (a.secenekler ? JSON.stringify(a.secenekler) : '')
    const i = sirada.get(tk) || 0
    sirada.set(tk, i + 1)
    const x = tarihAtama ? tarihAtama.get(a.ad) : adaylar(a, metin, { kisiler })[i]
    if (!x) continue
    const deger = degerCoz(a, x.deger, { kisiler })
    if (deger === null) continue
    bulunan[a.ad] = deger
    alanlar.push({ ad: a.ad, deger, conf: guven({ dayanak: 'alinti', yol: 'kural', bulundu: true, denetimHanesi: denetimHanesiVar(a, deger) }), aralik: [x.bas, x.bit] })
  }
  for (const a of sema.alanlar) {
    if (a.dayanak !== 'cikarim' || typeof hesap[a.ad] !== 'function') continue
    const deger = degerCoz(a, hesap[a.ad](bulunan, metin), { kisiler })
    if (deger !== null) alanlar.push({ ad: a.ad, deger, conf: guven({ dayanak: 'cikarim', yol: 'kural' }) })
  }
  const sira = new Map(sema.alanlar.map((a, i) => [a.ad, i]))
  alanlar.sort((x, y) => sira.get(x.ad) - sira.get(y.ad))
  return { sema: semaAdi(sema), alanlar, kaynak: [...kaynak], model: 'kural/' + surum }
}

// Tarih alanından az tarih adayı varsa (D32, Yuva Defteri L13 uyum): tarihin önündeki sözcük hangi alana gideceğini
// söyler. "geçerlilik", "son", "bitiş", "vade" bitiş alanına; "başlangıç", "düzenleme", "veriliş" başlangıç alanına; geri
// kalan aday sırayla. Alanın rolü adından (bitis/son/gecerlilik/vade; baslangic/duzenleme/verilis). Yeterli aday varsa null
// (sırayla atama). Dönüş: Map alan adı → aday
const BITIS_SOZ = /(?<![\p{L}\p{N}])(bitiş|bitis|son kullanma|son geçerlilik|geçerlilik|gecerlilik|son|vade|geçerli|gecerli)(?:\s+\p{L}+){0,2}[^\p{L}\p{N}]*$/u
const BASLA_SOZ = /(?<![\p{L}\p{N}])(başlangıç|baslangic|düzenleme|duzenleme|veriliş|verilis|başlama)(?:\s+\p{L}+){0,2}[^\p{L}\p{N}]*$/u
const BITIS_AD = /(bitis|son|gecerlilik|vade)/
const BASLA_AD = /(baslangic|duzenleme|verilis|alis)/
function tarihleriAta (sema, metin) {
  const alanlar = sema.alanlar.filter((a) => a.dayanak === 'alinti' && a.tur === 'tarih')
  if (alanlar.length < 2) return null
  const c = cz.tarihler(metin)
  if (c.length >= alanlar.length) return null
  const n = N(metin)
  const out = new Map()
  const bos = new Set(alanlar.map((a) => a.ad))
  const kalan = []
  for (const x of c) {
    const once = n.slice(Math.max(0, x.bas - 30), x.bas).trim()
    const rol = BITIS_SOZ.test(once) ? BITIS_AD : BASLA_SOZ.test(once) ? BASLA_AD : null
    const a = rol && alanlar.find((y) => bos.has(y.ad) && rol.test(y.ad))
    if (a) { out.set(a.ad, x); bos.delete(a.ad) } else kalan.push(x)
  }
  for (const x of kalan) {
    const a = alanlar.find((y) => bos.has(y.ad))
    if (!a) break
    out.set(a.ad, x)
    bos.delete(a.ad)
  }
  return out
}

// Model ve kural çıktısının birleşimi: aynı değer → ikisinin büyüğü + 10; farklıysa güveni yüksek olan, eşitse kural
function birlestir (sema, modelC, kuralC) {
  const m = new Map(modelC.alanlar.map((x) => [x.ad, x]))
  const k = new Map(kuralC.alanlar.map((x) => [x.ad, x]))
  const alanlar = []
  for (const a of sema.alanlar) {
    const x = m.get(a.ad)
    const y = k.get(a.ad)
    if (x && y && esit(x.deger, y.deger)) alanlar.push({ ...y, conf: ikisiAyni(x.conf, y.conf) })
    else if (x && y) alanlar.push(x.conf > y.conf ? x : y)
    else if (x || y) alanlar.push(x || y)
  }
  return { sema: modelC.sema, alanlar, kaynak: [...modelC.kaynak], model: modelC.model }
}

const esit = (a, b) => a === b || (Array.isArray(a) && Array.isArray(b) && JSON.stringify(a) === JSON.stringify(b))

// --- Onay ekranı ve kayıt (§8.4 son paragraf, §8.5) ----------------------------------------------------------------

const BOS_ESIK = 50
const SARI_ESIK = 80
const JETON_MS = 10 * 60_000

// Ekranda gösterilecek alanlar: conf < bos → boş; bos ≤ conf < sari → sarı. Ürün eşikleri yalnız sıkılaştırabilir.
function ekranAlanlari (sema, cikarim, { bos = BOS_ESIK, sari = SARI_ESIK } = {}) {
  if (bos < BOS_ESIK || sari < SARI_ESIK) fail('THRESHOLD_TOO_LOW')
  const c = new Map(cikarim.alanlar.map((x) => [x.ad, x]))
  return sema.alanlar.map((a) => {
    const x = c.get(a.ad)
    if (!x || x.conf < bos) return { ad: a.ad, tur: a.tur, zorunlu: a.zorunlu, deger: null, conf: x ? x.conf : null, isaret: 'bos' }
    return { ad: a.ad, tur: a.tur, zorunlu: a.zorunlu, deger: x.deger, conf: x.conf, isaret: x.conf < sari ? 'sari' : null }
  })
}

// Kanonik dizgi: jetonun bağlandığı içerik (sema, kaynak, model ve her alanın gösterilen ve kaydedilen değeri)
const kanonik = (cikarim, gosterilen, son) => JSON.stringify([
  cikarim.sema, cikarim.kaynak, cikarim.model,
  gosterilen.map((g) => [g.ad, g.deger, g.conf]),
  Object.keys(son).sort().map((k) => [k, son[k]])
])

// Onay ekranının durumu. Uygulama tek bir örneği arayüz katmanında tutar; ürün kodu jeton üretemez.
class OnayEkrani {
  constructor ({ simdi = () => Date.now(), bos = BOS_ESIK, sari = SARI_ESIK } = {}) {
    this.simdi = simdi
    this.esik = { bos, sari }
    this.gosterimler = new Map() // gösterim kimliği → { sema, cikarim, gosterilen }
    this.jetonlar = new Map() // jeton hex → { kanonik, at, gosterim }
  }

  // Öneriyi ekrana koyar. Birden çok öneri ayrı ayrı gösterilir; her biri ayrı onay ister.
  goster (sema, cikarim) {
    semaDogrula(sema)
    if (cikarim.sema !== semaAdi(sema)) fail('SCHEMA_MISMATCH')
    const id = rastgeleHex(16)
    const gosterilen = ekranAlanlari(sema, cikarim, this.esik)
    this.gosterimler.set(id, { sema, cikarim, gosterilen })
    return { id, alanlar: gosterilen.map((g) => ({ ...g })) }
  }

  // "Kaydet" dokunuşu: son: { <ad>: değer } (kullanıcının düzelttiği hali; boş alan yazılmaz)
  kaydetDokunusu (id, son) {
    const g = this.gosterimler.get(id)
    if (!g) fail('NO_DISPLAY')
    const temiz = sonDogrula(g.sema, son)
    const jeton = rastgeleHex(32)
    this.jetonlar.set(jeton, { kanonik: kanonik(g.cikarim, g.gosterilen, temiz), son: temiz, at: this.simdi(), gosterim: id })
    return jeton
  }

  // AI_SAVE (komut 273): jeton tek kullanımlıktır; içerik ekrandakiyle aynı olmalı. Dönüş: { type, fields }.
  // son verilmezse dokunuşta kaydedilen değerler kullanılır (SDK: kaydet(collectionId, cikarim, onayJetonu)).
  // koleksiyon: hedef (defterdeki); kasaKaynakli: kaynaklarından biri kasa ise yalnız kasa koleksiyonuna (§8.6).
  tuket (jeton, cikarim, son = null, { koleksiyon = null, kasaKaynakli = false } = {}) {
    const j = typeof jeton === 'string' ? this.jetonlar.get(jeton) : null
    if (!j) fail('NO_APPROVAL')
    this.jetonlar.delete(jeton)
    const g = this.gosterimler.get(j.gosterim)
    if (!g) fail('NO_APPROVAL')
    if (this.simdi() - j.at > JETON_MS) fail('APPROVAL_EXPIRED')
    const temiz = son === null ? j.son : sonDogrula(g.sema, son)
    if (kanonik(cikarim, g.gosterilen, temiz) !== j.kanonik) fail('APPROVAL_MISMATCH')
    if (kasaKaynakli && (!koleksiyon || koleksiyon.sensitivity !== 'kasa')) fail('VAULT_SOURCE')
    this.gosterimler.delete(j.gosterim)
    return { type: g.sema.hedef, fields: kayitAlanlari(g.sema, cikarim, g.gosterilen, temiz, { col: koleksiyon }) }
  }
}

function rastgeleHex (n) {
  const b = b4a.alloc(n)
  sodium.randombytes_buf(b)
  return b4a.toString(b, 'hex')
}

// Kaydedilecek değerler: şemadaki alanlar, türüne göre çözülmüş; null ya da yok → yazılmaz. Zorunlu alan eksikse red.
function sonDogrula (sema, son) {
  if (!son || typeof son !== 'object') fail('INVALID_FIELD')
  const out = {}
  for (const k of Object.keys(son)) if (!sema.alanlar.some((a) => a.ad === k)) fail('INVALID_FIELD')
  for (const a of sema.alanlar) {
    const v = son[a.ad]
    if (v === null || v === undefined) {
      if (a.zorunlu) fail('NO_REQUIRED_FIELD')
      continue
    }
    // kisi değeri ekranda defterden seçilir; burada yalnız biçim denetlenir
    const d = a.tur === 'kisi' || (a.tur === 'liste' && a.oge === 'kisi') ? kisiBicimi(a, v) : degerCoz(a, v)
    if (d === null) fail('INVALID_FIELD')
    out[a.ad] = d
  }
  return out
}

function kisiBicimi (a, v) {
  const tek = (x) => typeof x === 'string' && /^uye:[0-9a-f]{32}$/.test(x)
  if (a.tur === 'kisi') return tek(v) ? v : null
  return Array.isArray(v) && v.length && v.length <= LISTE_MAX && v.every(tek) ? [...new Set(v)] : null
}

// §8.5 tablo: _src, _conf (değiştirilmeyen yapay zeka alanlarının en küçük güveni), _ai (onların adları), _aiyol.
// Değiştirilmemiş = ekranda dolu gösterildi ve kaydedilen değer aynı. Hepsi değiştiyse _conf ve _ai yazılmaz.
function kayitAlanlari (sema, cikarim, gosterilen, son, { col = null } = {}) {
  if (!Array.isArray(cikarim.kaynak) || cikarim.kaynak.length > SRC_MAX || !cikarim.kaynak.every((s) => parseSrc(s))) fail('INVALID_SOURCE')
  const fields = { ...son }
  const degismeyen = gosterilen.filter((g) => g.deger !== null && Object.prototype.hasOwnProperty.call(son, g.ad) && esit(son[g.ad], g.deger))
  if (cikarim.kaynak.length) fields._src = [...cikarim.kaynak]
  if (degismeyen.length) {
    fields._conf = Math.min(...degismeyen.map((g) => g.conf))
    fields._ai = degismeyen.map((g) => g.ad)
  }
  fields._aiyol = cikarim.model
  checkStrict(fields, { col })
  return fields
}

module.exports = {
  TURLER,
  OGE_TURLERI,
  LISTE_MAX,
  OFSET_DK,
  KURAL_SURUM,
  BOS_ESIK,
  SARI_ESIK,
  JETON_MS,
  semaDogrula,
  semaAdi,
  belgeTuru,
  degerCoz,
  dayanakVar,
  guven,
  ikisiAyni,
  denetle,
  kuralCikar,
  zamanlar,
  birlestir,
  ekranAlanlari,
  kayitAlanlari,
  sonDogrula,
  OnayEkrani
}
