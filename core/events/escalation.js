// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// escalation.js — bildirim merdiveni: sorumlu listesi, kitle, süreler, sessiz saatler, yazma sırası, tekil bildirim
// (RFC-0006 §11)
//
// Kişiler kişinin ana kimliğiyle gösterilir (L.canonical; RFC-0017). Okuyuculuk cihazın uyguladığı son defter
// durumuna göre hesaplanır. Her telefon yalnız kendi kullanıcısına ve her (vaka, basamak, sıra) için en çok bir kez
// haber verir (§11.3).
const b4a = require('b4a')
const { yetki: { readerSet, writerSet } } = require('@havenfold/records')

const MIN = 60_000
const DAY = 86_400_000
const mod = (a, b) => ((a % b) + b) % b
const hexCmp = (a, b) => b4a.compare(b4a.from(a, 'hex'), b4a.from(b, 'hex'))

// Önem 2: 2 → 3 30 dk; 3 → 4 60 dk; sıra arası 60 dk; → 5 60 dk. Önem 3: 2 ve 3 birlikte; sonra 5'er dakika.
// Kuralın sureler alanı aynı sırayla verilir: [2→3, 3→4, sıra arası, →5]
const VARSAYILAN_SURELER = { 2: [30, 60, 60, 60], 3: [0, 5, 5, 5] }

// --- Kişiler ------------------------------------------------------------------------------------------------------

// Koleksiyonun okuyucusu olan üyeler (kişi = ana kimlik), memberId bayt sırasıyla. Misafir ve kutu üye kitlesine girmez.
function okuyucuKisiler (L, col) {
  const s = new Set()
  for (const [id, rol] of readerSet(L, col)) {
    if (rol === 'misafir') continue
    const p = L.canonical(id)
    if (p && L.members.get(p)?.role !== 'kutu') s.add(p)
  }
  return [...s].sort(hexCmp)
}

function yazarKisiler (L, col) {
  const s = new Set()
  for (const [id, tur] of writerSet(L, col)) {
    if (tur !== 'uye') continue
    const p = L.canonical(id)
    if (p) s.add(p)
  }
  return [...s].sort(hexCmp)
}

const ebeveynOkuyucular = (L, okuyucular) => okuyucular.filter((id) => L.members.get(id)?.role === 'ebeveyn')

// §11.1: karttaki sorumlular sırasıyla (yoksa okuyucu ebeveynler); okuyucu olmayanlar çıkar; listede olmayan okuyucu
// ebeveynler sona eklenir. kartSorumlu: ['uye:<hex16>', …] ya da null.
function sorumluListesi (L, col, kartSorumlu = null) {
  const okuyucular = okuyucuKisiler(L, col)
  const ok = new Set(okuyucular)
  const ebeveynler = ebeveynOkuyucular(L, okuyucular)
  const out = []
  const ekle = (id) => { if (id && ok.has(id) && !out.includes(id)) out.push(id) }
  const kart = Array.isArray(kartSorumlu) ? kartSorumlu.filter((x) => typeof x === 'string' && /^uye:[0-9a-f]{32}$/.test(x)) : []
  if (kart.length) for (const x of kart) ekle(L.canonical(x.slice(4)))
  else for (const id of ebeveynler) ekle(id)
  for (const id of ebeveynler) ekle(id)
  return out
}

// Bir basamağın kitlesi (§11.1). sos: hf.sos vakası (3. basamakta bütün okuyucular)
function kitle (basamak, sira, { sorumlu, okuyucular, sos = false }) {
  if (basamak === 2) return okuyucular
  if (basamak === 3) return sos ? okuyucular : sorumlu.slice(0, 1)
  if (basamak === 4) return sorumlu[sira + 1] ? [sorumlu[sira + 1]] : []
  if (basamak === 5) return sorumlu.slice(0, 1)
  return []
}

// --- Sessiz saat (§11.6) -------------------------------------------------------------------------------------------

// sessiz: [başlangıç_dk, bitiş_dk] yerel; bitiş başlangıçtan küçükse gece yarısını aşar
function sessizde (t, sessiz, utcDk = 180) {
  if (!Array.isArray(sessiz) || sessiz.length !== 2) return false
  const [a, b] = sessiz
  const m = Math.floor(mod(t + utcDk * MIN, DAY) / MIN)
  return a <= b ? m >= a && m < b : m >= a || m < b
}

// Sessiz saatin bittiği ilk an (t sessizde değilse t)
function sessizBitisi (t, sessiz, utcDk = 180) {
  if (!sessizde(t, sessiz, utcDk)) return t
  const yerel = t + utcDk * MIN
  const gunBasi = yerel - mod(yerel, DAY)
  let son = gunBasi + sessiz[1] * MIN
  if (son <= yerel) son += DAY
  return son - utcDk * MIN
}

// --- Sonraki basamak -----------------------------------------------------------------------------------------------

// Ulaşılan basamaktan sonraki (b, s) ve bekleme süresi (dakika). Yoksa null.
function sonraki (d, sureler) {
  const [b, s] = d.ulasilan || [d.ilk - 1, 0]
  const n = d.sorumlu.length
  const [s23, s34, sira, s5] = sureler
  if (!d.ulasilan) return { basamak: d.ilk, sira: 0, dk: 0 }
  if (b >= d.son) return null
  if (b === 1) return null // bilgi: yalnız kart
  if (b === 2) return { basamak: 3, sira: 0, dk: s23 }
  if (b === 3) {
    if (d.son >= 4 && n >= 2) return { basamak: 4, sira: 0, dk: s34 }
    return d.son === 5 ? { basamak: 5, sira: 0, dk: s5 } : null
  }
  if (b === 4) {
    if (s + 2 < n) return { basamak: 4, sira: s + 1, dk: sira }
    return d.son === 5 ? { basamak: 5, sira: 0, dk: s5 } : null
  }
  return null
}

// Motorun bir sonraki basamağı ne zaman yazacağı (§11.4). r: yazma sırasındaki yeri (0'dan); her yer 2 dakika ekler.
// opts: { sureler, sessiz, utcDk, sessizDisi }. Sahipli, kapalı ya da bastırılmış vakada hiçbir motor yazmaz.
function sonrakiYazim (d, { r = 0, sureler = null, sessiz = null, utcDk = 180, sessizDisi = false } = {}) {
  // Çözülmüş vakada (RFC-0032 §6.3) ve düzeltmeden sonra E + 24 saati geçmiş vakada yeni basamak yok
  if (d.sahipli || d.kapali || d.bastirilmis || d.cozuldu || d.merdivenDurdu) return null
  const su = sureler || VARSAYILAN_SURELER[d.onem] || [0, 0, 0, 0]
  const x = sonraki(d, su)
  if (!x) return null
  // Kapatan olay düzeltmeyle geri alındıysa bekleme düzeltme anından yeniden sayılır (§6.2)
  const taban = Math.max(d.ulasilan ? d.basamakAni[d.ulasilan.join(',')] : d.t, d.yenidenBasla ?? -Infinity)
  let zaman = taban + x.dk * MIN
  // Dikkat öneminde 3. ve 4. basamak sessiz saat bitene kadar yazılmaz; acilde ve sessiz_disi kuralda uyulmaz
  if (d.onem === 2 && !sessizDisi && (x.basamak === 3 || x.basamak === 4)) zaman = sessizBitisi(zaman, sessiz, utcDk)
  return { basamak: x.basamak, sira: x.sira, zaman: zaman + r * 2 * MIN }
}

// Yazma sırası (§11.4 madde 2): sorumlu listesi, sonra diğer okuyucu yazarlar memberId sırasıyla. Vakayı bir cihaz
// açtıysa önce o yazar (telefonlar bir sıra geriden gelir). me: kişinin ana kimliği. Yazar değilse null.
function yazmaSirasi (L, col, d, me) {
  const okuyucular = new Set(okuyucuKisiler(L, col))
  const yazarlar = yazarKisiler(L, col).filter((id) => okuyucular.has(id))
  const sira = [...d.sorumlu.filter((id) => yazarlar.includes(id)), ...yazarlar.filter((id) => !d.sorumlu.includes(id))]
  const i = sira.indexOf(me)
  if (i < 0) return null
  return i + (d.acanCihaz ? 1 : 0)
}

// Planlanmış yerel bildirim (§11.5): kullanıcının kitlesinde olacağı sonraki basamak ve zamanı (sıra gecikmesi yok)
function planlanacak (d, me, { okuyucular, sureler = null, sessiz = null, utcDk = 180, sessizDisi = false, sos = false }) {
  let cur = d
  for (let i = 0; i < 8; i++) {
    const x = sonrakiYazim(cur, { sureler, sessiz, utcDk, sessizDisi })
    if (!x) return null
    if (kitle(x.basamak, x.sira, { sorumlu: d.sorumlu, okuyucular, sos }).includes(me)) return x
    // Kitlede değilse bir basamak ileri varsayıp sonrakine bak
    cur = { ...cur, ulasilan: [x.basamak, x.sira], basamakAni: { ...cur.basamakAni, [x.basamak + ',' + x.sira]: x.zaman } }
  }
  return null
}

// --- Tekil bildirim (§11.3) ----------------------------------------------------------------------------------------

// Telefon yerelidir: gösterilen (vaka, basamak, sıra) kümesi vakanın saklama süresi kadar tutulur (toJSON). Birden çok
// aileli telefonda küme (aile, vaka, basamak, sıra) olur (RFC-0034 §9): aile verilince anahtar 'aile,vaka,b,s'.
const GOSTERILEN_MS = 365 * DAY // vakanın saklama süresi (vaka.VAKA_KEEP gün)

class Bildirimci {
  // gosterilen: toJSON çıktısı ([[anahtar, an], …]; eski biçimde yalnız anahtarlar)
  // sosTekil: sos.SosTekil (verilirse afet bağıyla tek bildirim burada uygulanır, RFC-0031 §6)
  // aile: bu bildirimcinin ailesi (familyId hex; RFC-0034 §9); verilmezse tek aileli anahtar (bugünkü kalıcı biçim)
  constructor ({ me, gosterilen = [], now = Date.now, sosTekil = null, aile = null }) {
    this.me = me // kişinin ana kimliği (hex)
    this.aile = aile
    this.now = now
    this.sosTekil = sosTekil
    this.gosterilen = new Map(gosterilen.map((x) => (Array.isArray(x) ? x : [x, now()])))
    this.ekranda = new Map() // vaka → { b, s, subj, onem }
  }

  _k (vaka, b, s) { return (this.aile ? this.aile + ',' : '') + vaka + ',' + b + ',' + s }
  // Aile verilmeden önce yazılmış anahtar da gösterilmiş sayılır (tek aileden çok aileye geçiş)
  _gosterildi (vaka, b, s) { return this.gosterilen.has(this._k(vaka, b, s)) || (!!this.aile && this.gosterilen.has(vaka + ',' + b + ',' + s)) }
  _goster (k) { this.gosterilen.set(k, this.now()) }

  // Saklama süresi geçen kayıtlar atılır (inceleme olay 19)
  _buda () {
    const sinir = this.now() - GOSTERILEN_MS
    for (const [k, an] of this.gosterilen) if (an < sinir) this.gosterilen.delete(k)
  }

  // durumlar: [{ ...vakaDurumu, okuyucular, sos, sessiz (bool: şu an sessiz saat ve 2. basamak sessiz gösterilir) }]
  // Dönüş: eylemler [{ eylem: 'goster', vaka, basamak, sira, ses }, { eylem: 'kaldir', vaka }]
  guncelle (durumlar) {
    this._buda()
    const out = []
    const adaylar = []
    for (const d of durumlar) {
      // Çözülmüş vakanın basamakları bildirim üretmez; ekrandaki kaldırılır (RFC-0032 §6.3)
      if (d.sahipli || d.kapali || d.bastirilmis || d.cozuldu) {
        if (this.ekranda.has(d.vaka)) { this.ekranda.delete(d.vaka); out.push({ eylem: 'kaldir', vaka: d.vaka }) }
        continue
      }
      const yeni = d.gecerli.filter(([b, s]) => kitle(b, s, { sorumlu: d.sorumlu, okuyucular: d.okuyucular, sos: d.sos }).includes(this.me) && !this._gosterildi(d.vaka, b, s))
      if (yeni.length) adaylar.push({ d, yeni })
    }
    // Aynı özne için aynı anda tek bildirim: önemi en yüksek, eşitlikte vaka bayt sırasıyla küçük (§9.3 madde 4).
    // Ekrandaki vaka da seçime katılır; kaybeden adayın basamağı gösterildi sayılmaz, bekler (inceleme olay 8).
    const secilen = new Map()
    const iyi = (a, cur) => !cur || a.onem > cur.onem || (a.onem === cur.onem && a.vaka < cur.vaka)
    for (const [vaka, e] of this.ekranda) {
      if (!durumlar.some((d) => d.vaka === vaka)) continue
      const cur = secilen.get(e.subj)
      if (iyi({ onem: e.onem, vaka }, cur && { onem: cur.d.onem, vaka: cur.d.vaka })) secilen.set(e.subj, { d: { vaka, subj: e.subj, onem: e.onem }, yeni: [], ekranda: true })
    }
    for (const a of adaylar) {
      const cur = secilen.get(a.d.subj)
      if (cur && cur.d.vaka === a.d.vaka) { secilen.set(a.d.subj, a); continue }
      if (iyi(a.d, cur && cur.d)) secilen.set(a.d.subj, a)
    }
    for (const { d, yeni, ekranda } of [...secilen.values()].sort((a, b) => (a.d.vaka < b.d.vaka ? -1 : 1))) {
      if (ekranda) continue
      // Aynı afetin bildirimi (afet mesajı ya da başka SOS) zaten gösterildiyse bu SOS sessiz kalır, basamakları
      // gösterilmiş sayılır (RFC-0031 §6). Gösterilecekse afet bağı bu vakayla işaretlenir.
      // Aynı basış başka ailede de yazıldıysa (ortakMid, RFC-0034 §9 K2) aynı kural: 7 gün içinde ikinci bildirim yok,
      // ekrandaki SOS güncellenir. Kimlik ailesiyle (iki ailenin vaka kimliği çakışmaz, yine de)
      const vakaK = 'vaka:' + (this.aile ? this.aile + ',' : '') + d.vaka
      // D103: kaydın bütün alıcı mid'leri (afet_midler); bu telefonun afetle aldığı mid aralarındaysa ikinci bildirim yok
      const tekil = d.sos && this.sosTekil ? [...new Set([...(d.afetMidler || []), d.afetMid, d.ortakMid].filter(Boolean))] : []
      if (tekil.length) {
        if (tekil.some((m) => !this.sosTekil.gosterilsinMi(m, vakaK))) {
          for (const [b, s] of yeni) this._goster(this._k(d.vaka, b, s))
          // Aynı basışın öbür aileden gelen kaydı: bildirim yok, uygulama ekrandaki SOS'u günceller (afet bağında sessiz)
          if (d.ortakMid && !this.sosTekil.gosterilsinMi(d.ortakMid, vakaK)) out.push({ eylem: 'guncelle', vaka: d.vaka, ortakMid: d.ortakMid })
          continue
        }
        for (const m of tekil) this.sosTekil.isaretle(m, vakaK)
      }
      // Aynı öznenin ekrandaki başka vakası kaldırılır
      for (const [v, e] of this.ekranda) if (v !== d.vaka && e.subj === d.subj) { this.ekranda.delete(v); out.push({ eylem: 'kaldir', vaka: v }) }
      for (const [b, s] of yeni) this._goster(this._k(d.vaka, b, s))
      const [b, s] = yeni[yeni.length - 1]
      this.ekranda.set(d.vaka, { b, s, subj: d.subj, onem: d.onem })
      // 2. basamak sessiz saatte sessiz gösterilir (acil hariç)
      out.push({ eylem: 'goster', vaka: d.vaka, basamak: b, sira: s, ses: !(b === 2 && d.sessiz && d.onem < 3) })
    }
    return out
  }

  // Zarf geldi ama kayıtlar gelmedi: kitledeyse başlıkla tek bildirim (§11.5). sessiz: şu an sessiz saat; onem: zarfın
  // önemi. 2. basamak sessiz saatte sessiz gösterilir, acil hariç (inceleme olay 18).
  ipucu (vaka, basamak, sira, kitlede, baslik = '', { sessiz = false, onem = 2, subj = null } = {}) {
    this._buda()
    const k = this._k(vaka, basamak, sira)
    if (!kitlede || this._gosterildi(vaka, basamak, sira)) return null
    this._goster(k)
    this.ekranda.set(vaka, { b: basamak, s: sira, subj, onem })
    return { eylem: 'goster', vaka, basamak, sira, ses: !(basamak === 2 && sessiz && onem < 3), baslik: baslik || 'Olaylar\'da yeni bir durum var' }
  }

  toJSON () { return [...this.gosterilen] }
}

// Kişilerin (ana kimlik) bütün aktif kimlikleri: uyandırma zarfı kişinin her uygulamasına gider (RFC-0017 §9,
// inceleme olay 16). Hangi uygulamanın bildireceğini çağıran seçer (SDK yardımcısı).
function kimlikler (L, kisiler) {
  const out = new Set()
  for (const p of kisiler) for (const id of L.identitiesOf(L.personIdOf(p) || p)) out.add(id)
  return [...out].sort(hexCmp)
}

module.exports = {
  MIN, VARSAYILAN_SURELER, okuyucuKisiler, yazarKisiler, sorumluListesi, kitle, sessizde, sessizBitisi, sonraki, sonrakiYazim,
  yazmaSirasi, planlanacak, Bildirimci, GOSTERILEN_MS, kimlikler
}
