// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// case.js — vaka anahtarı, vaka kayıtları ve durum işlevi (RFC-0006 §10, §11.2)
//
//   ozneOzeti = hash('hf/ozne/', _subj)
//   vaka      = hash('hf/vaka/', collectionId, kaynakId, ozneOzeti, u64be(pencereBasi), u64be(yon))[0..16]
// Durum, koleksiyonun geçerli kayıtlarından hesaplanır; geliş sırası, yerel saat ve hangi motorun önce yazdığı sonucu
// değiştirmez. hf.vaka kaydı ayrıca vakanın penceresini (pencere: [bas, son]) taşır; anahtar bu pencereyle yeniden
// hesaplanıp doğrulanır (bastırma kayıtlardan hesaplanabilsin diye; İstekler).
const b4a = require('b4a')
const { kdf: { hash } } = require('@havenfold/core')
const { cekirdekKaynakId } = require('./rule')
const { ilkOnce } = require('./event')

const hex = (b) => b4a.toString(b, 'hex')
function fail (code) { throw new Error(code) }
const isInt = (x) => Number.isSafeInteger(x)
const ID_RE = /^[0-9a-f]{32}$/

const VAKA_KEEP = 365
const SONUCLAR = ['gercek', 'yanlis', 'bilgi']

// §11.2: önem → ilk ve son basamak; hizmet ise (önem ≥ 2) son 5
function basamaklar (onem, hizmet = false) {
  if (onem === 0) return { ilk: 1, son: 1 }
  if (onem === 1) return { ilk: 2, son: 2 }
  return { ilk: 2, son: hizmet ? 5 : 4 }
}

const ozneOzeti = (subj) => hash('hf/ozne/', subj)
const vakaAnahtari = (collectionId, kaynakId, subj, pencereBasi, yon) =>
  hash('hf/vaka/', collectionId, kaynakId, ozneOzeti(subj), pencereBasi, yon).subarray(0, 16)

// kaynak metni → kaynakId: rutin:<hex16>, kural:<hex16>, cekirdek:<tür>
function kaynakIdOf (kaynak) {
  if (typeof kaynak !== 'string') return null
  const i = kaynak.indexOf(':')
  const tur = kaynak.slice(0, i)
  const v = kaynak.slice(i + 1)
  if ((tur === 'rutin' || tur === 'kural') && ID_RE.test(v)) return b4a.from(v, 'hex')
  if (tur === 'cekirdek' && v.startsWith('hf.')) return cekirdekKaynakId(v)
  return null
}

// --- Yazma --------------------------------------------------------------------------------------------------------

// v: { collectionId, kaynak, subj, pencereBasi, pencereSonu, yon, onem, ilk, son, t, deger, alt, ust, olaylar, ozet }
function vakaAlanlari (v) {
  const kaynakId = kaynakIdOf(v.kaynak)
  if (!kaynakId) fail('INVALID_SOURCE')
  const vaka = vakaAnahtari(v.collectionId, kaynakId, v.subj, v.pencereBasi, v.yon)
  const f = {
    vaka,
    _subj: v.subj,
    _t: v.t,
    kaynak: v.kaynak,
    onem: v.onem,
    ilk: v.ilk,
    son: v.son,
    yon: v.yon,
    pencere: [v.pencereBasi, v.pencereSonu],
    deger: v.deger || 0,
    olaylar: (v.olaylar || []).slice(0, 16),
    ozet: v.ozet || '',
    _keep: VAKA_KEEP
  }
  if (isInt(v.alt)) f.alt = v.alt
  if (isInt(v.ust)) f.ust = v.ust
  return f
}

const basamakAlanlari = (vaka, basamak, sira, t) => ({ vaka, basamak, sira, _t: t, _keep: VAKA_KEEP })
const sahipAlanlari = (vaka, t) => ({ vaka, _t: t, _keep: VAKA_KEEP })
function kapatAlanlari (vaka, sonuc, t) {
  if (!SONUCLAR.includes(sonuc)) fail('INVALID_FIELD_VALUE')
  return { vaka, sonuc, _t: t, _keep: VAKA_KEEP }
}

// --- Durum (§10.3) ------------------------------------------------------------------------------------------------

const vakaHex = (k) => (b4a.isBuffer(k.fields.vaka) && k.fields.vaka.byteLength === 16 ? hex(k.fields.vaka) : null)

// hf.vaka kaydı yapısal olarak doğru ve anahtarı alanlarıyla tutarlı mı
function acilisGecerli (k, collectionId) {
  const f = k.fields
  const v = vakaHex(k)
  if (!v || typeof k.tf._subj !== 'string') return false
  if (![0, 1, 2, 3].includes(f.onem) || !isInt(f.ilk) || !isInt(f.son) || f.ilk < 1 || f.son > 5 || f.ilk > f.son) return false
  if (![0, 1, 2].includes(f.yon) || !Array.isArray(f.pencere) || f.pencere.length !== 2 || !f.pencere.every(isInt)) return false
  const kaynakId = kaynakIdOf(f.kaynak)
  if (!kaynakId) return false
  return hex(vakaAnahtari(collectionId, kaynakId, k.tf._subj, f.pencere[0], f.yon)) === v
}

// Geçerli basamaklar (§10.3 madde 2). kayitlar: (b, s) çiftleri. n: sorumlu listesinin uzunluğu.
function gecerliBasamaklar (ilk, son, ciftler, n) {
  const var_ = new Set(ciftler.map(([b, s]) => b + ',' + s))
  const gecerli = new Set()
  const bVar = (b) => [...gecerli].some((x) => x.startsWith(b + ','))
  const sorumluYok4 = n <= 1 // tek sorumluda 4. basamak yoktur
  let degisti = true
  while (degisti) {
    degisti = false
    for (const [b, s] of ciftler) {
      const key = b + ',' + s
      if (gecerli.has(key) || b < ilk || b > son) continue
      if (b === 4 ? !(s + 1 < n) : s !== 0) continue
      const once = b - 1 === 4 && sorumluYok4 ? 3 : b - 1
      const ok = (b === ilk && s === 0) || (s > 0 && gecerli.has(b + ',' + (s - 1))) || (s === 0 && b > ilk && bVar(once))
      if (ok && var_.has(key)) { gecerli.add(key); degisti = true }
    }
  }
  return [...gecerli].map((x) => x.split(',').map(Number)).sort((a, b) => a[0] - b[0] || a[1] - b[1])
}

// kayitlar: koleksiyonun kayıtları. sorumluOf(subj) → sorumlu listesi (merdiven.sorumluListesi).
// kaynakOf(kaynak, subj, acanCihaz, acanId) → { onem, hizmet } ya da null: vakanın önemi, ilk ve son basamağı kayıttan değil
// kaynaktan (kural, rutin, katalog) türetilir (RFC-0019 §11.5 b); null dönen açılış yok sayılır. Verilmezse kayıttaki
// değerler kullanılır (yalnız vektörler ve testler).
// Bastırma kararı vaka kaydındadır (bastirildi: true, §11.5 d); olaylar temizlense de geri dönmez. Yalnız rutin
// vakasında ve yalnız üyenin işleminden (kayit.uyeAlanlari) okunur.
// Dönüş: Map vakaHex → durum
function vakaDurumlari (kayitlar, collectionId, { sorumluOf = () => [], kaynakOf = null } = {}) {
  const by = new Map()
  const grup = (v) => { if (!by.has(v)) by.set(v, { acilislar: [], basamak: [], sahip: [], kapat: [] }); return by.get(v) }
  for (const k of kayitlar) {
    const v = vakaHex(k)
    if (!v) continue
    if (k.type === 'hf.vaka' && acilisGecerli(k, collectionId)) grup(v).acilislar.push(k)
    else if (k.type === 'hf.vaka.basamak' && isInt(k.fields.basamak) && isInt(k.fields.sira) && k.fields.sira >= 0) grup(v).basamak.push(k)
    // Yazar denetimi (madde 7): sahiplenme ve kapanış yalnız üyenin yazdığı işlemden
    else if (k.type === 'hf.vaka.sahip' && k.yazar === 'uye') grup(v).sahip.push(k)
    else if (k.type === 'hf.vaka.kapat' && k.yazar === 'uye' && SONUCLAR.includes(k.fields.sonuc)) grup(v).kapat.push(k)
  }
  const out = new Map()
  for (const [v, g] of by) {
    const kaynaktan = (k) => (kaynakOf ? kaynakOf(k.fields.kaynak, k.tf._subj, k.yazar === 'cihaz', k.authorHex) : { onem: k.fields.onem, ilk: k.fields.ilk, son: k.fields.son })
    const acilislar = g.acilislar.map((k) => ({ k, kd: kaynaktan(k) })).filter((x) => x.kd)
    if (!acilislar.length) continue
    const { k: asil, kd } = acilislar.sort((a, b) => ilkOnce(a.k, b.k))[0]
    const f = asil.fields
    const onem = kd.onem
    const { ilk, son } = kd.ilk !== undefined ? kd : basamaklar(onem, kd.hizmet)
    // Bastırma yalnız rutin vakasında ve yalnız üyenin yazdığı bastirildi alanından (D-inceleme-4 bulgu 1)
    const ua = asil.uyeAlanlari || (asil.yazar === 'uye' ? f : {})
    const bastirildi = typeof f.kaynak === 'string' && f.kaynak.startsWith('rutin:') && ua.bastirildi === true
    const sorumlu = sorumluOf(asil.tf._subj)
    const gecerli = gecerliBasamaklar(ilk, son, g.basamak.map((k) => [k.fields.basamak, k.fields.sira]), sorumlu.length)
    // Her geçerli basamağın ilk kaydı (bekleme süresi onun _t'sinden sayılır)
    const kayitOf = (b, s) => g.basamak.filter((k) => k.fields.basamak === b && k.fields.sira === s).sort(ilkOnce)[0]
    const sahip = [...g.sahip].sort(ilkOnce)[0] || null
    const kapat = [...g.kapat].sort(ilkOnce)[0] || null
    out.set(v, {
      vaka: v,
      subj: asil.tf._subj,
      acilis: asil,
      acanCihaz: asil.yazar === 'cihaz',
      kaynak: f.kaynak,
      onem,
      ilk,
      son,
      yon: f.yon,
      pencere: f.pencere,
      t: asil.tf._t,
      sorumlu,
      gecerli,
      basamakAni: Object.fromEntries(gecerli.map(([b, s]) => [b + ',' + s, kayitOf(b, s).tf._t])),
      ulasilan: gecerli.length ? gecerli[gecerli.length - 1] : null,
      sahipli: !!sahip,
      sahip: sahip ? sahip.authorHex : null,
      kapali: !!kapat,
      sonuc: kapat ? kapat.fields.sonuc : null,
      bastirilmis: bastirildi,
      bastirmaKayitli: bastirildi
    })
  }
  return out
}

module.exports = {
  VAKA_KEEP, SONUCLAR, basamaklar, ozneOzeti, vakaAnahtari, kaynakIdOf, vakaAlanlari, basamakAlanlari, sahipAlanlari,
  kapatAlanlari, acilisGecerli, gecerliBasamaklar, vakaDurumlari
}
