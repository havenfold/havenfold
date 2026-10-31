// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// limit.js — taşkın kuralları (RFC-0012 §9.1, §9.2): gönderenin hız sınırları, komşudan kabul edilen yeni mesaj kotası,
// aynı komşuyla yeniden eşitleme aralığı. Saat dışarıdan verilir (ms); durum bellektedir.
const M = require('./message')

const SN = 1000
const DK = 60 * SN
const SAAT = 60 * DK

// §9.1: { aralik: iki gönderim arası en az, pencere ve adet: kayan pencerede en çok, aliciBasina }
const GONDERIM = {
  [M.KIND.METIN]: { aralik: 15 * SN, pencere: SAAT, adet: 30 },
  [M.KIND.IYIYIM]: { aralik: 5 * DK, aliciBasina: true },
  [M.KIND.SOS]: { aralik: DK },
  [M.KIND.UYARI]: { aralik: DK, turBasina: true } // açıklama 3: deprem ve elektrik ayrı sayılır
}
const KOMSU = { pencere: 10 * DK, adet: 100 } // §9.2: bir komşudan kabul edilen yeni mesaj
const YENIDEN_ESITLE = 5 * DK // §9.2: yeni mesaj yoksa aynı komşuyla
const PIL_ESIK = 15 // §9.3: altında taşıyıcı yalnız SOS, UYARI, İYİYİM kabul eder

/**
 * Gönderen cihazın hız sınırları (§9.1, açıklama 1 madde 1): sınır olay başınadır. Çok alıcılı bir mesaj (her alıcıya ayrı
 * mühür) tek olaydır; SOS, UYARI ve METİN bir kez sayılır, İYİYİM alıcı başına. izinOlay() denetler, kaydetOlay() işler.
 */
class Gonderim {
  constructor () { this.gecmis = new Map() } // anahtar → [ms]

  _anahtar (kind, toHex, alt = null) {
    const g = GONDERIM[kind]
    if (g?.aliciBasina) return kind + ':' + toHex
    if (g?.turBasina && alt) return kind + '/' + alt
    return String(kind)
  }

  /** Dönüş: null (gönderilebilir) ya da { neden: 'DISASTER_SEND_LIMIT', bekleMs } */
  izin (kind, toHex, simdi, alt = null) {
    const k = GONDERIM[kind]
    if (!k) return null // ALINDI sınırsız
    const g = this.gecmis.get(this._anahtar(kind, toHex, alt)) ?? []
    let bekle = 0
    const son = g[g.length - 1]
    if (son != null && simdi - son < k.aralik) bekle = k.aralik - (simdi - son)
    if (k.adet) {
      const pencerede = g.filter((t) => simdi - t < k.pencere)
      if (pencerede.length >= k.adet) bekle = Math.max(bekle, pencerede[0] + k.pencere - simdi)
    }
    return bekle > 0 ? { neden: 'DISASTER_SEND_LIMIT', bekleMs: bekle } : null
  }

  /** Bir olayın bütün alıcıları için: biri engelliyse olay gönderilmez. Dönüş: null ya da { neden, bekleMs } */
  izinOlay (kind, alicilar, simdi, alt = null) {
    let engel = null
    for (const a of this._anahtarlar(kind, alicilar, alt).values()) {
      const e = this.izin(kind, a, simdi, alt)
      if (e && (!engel || e.bekleMs > engel.bekleMs)) engel = e
    }
    return engel
  }

  kaydetOlay (kind, alicilar, simdi, alt = null) {
    for (const a of this._anahtarlar(kind, alicilar, alt).values()) this.kaydet(kind, a, simdi, alt)
  }

  // Aynı sayaca düşen alıcılar bir kez (SOS, UYARI, METİN: tek anahtar; İYİYİM: alıcı başına; UYARI ayrıca türüne göre)
  _anahtarlar (kind, alicilar, alt) { return new Map(alicilar.map((a) => [this._anahtar(kind, a, alt), a])) }

  kaydet (kind, toHex, simdi, alt = null) {
    if (!GONDERIM[kind]) return
    const a = this._anahtar(kind, toHex, alt)
    const g = (this.gecmis.get(a) ?? []).filter((t) => simdi - t < SAAT)
    g.push(simdi)
    this.gecmis.set(a, g)
  }
}

/** Komşu başına yeni mesaj kotası ve son eşitleme */
class Komsular {
  constructor () { this.kabul = new Map(); this.son = new Map() }

  /** Bu komşudan şu an kabul edilebilecek yeni mesaj sayısı */
  kalan (komsuHex, simdi) {
    const g = (this.kabul.get(komsuHex) ?? []).filter((t) => simdi - t < KOMSU.pencere)
    this.kabul.set(komsuHex, g)
    return Math.max(0, KOMSU.adet - g.length)
  }

  kabulEt (komsuHex, simdi) {
    if (this.kalan(komsuHex, simdi) === 0) return false
    this.kabul.get(komsuHex).push(simdi)
    return true
  }

  /** Aynı komşuyla eşitleme gerekli mi: hiç yapılmadıysa, depo değiştiyse ya da 5 dk geçtiyse */
  esitlemeGerekli (komsuHex, surum, simdi) {
    const s = this.son.get(komsuHex)
    return !s || s.surum !== surum || simdi - s.t >= YENIDEN_ESITLE
  }

  esitlendi (komsuHex, surum, simdi) { this.son.set(komsuHex, { t: simdi, surum }) }
}

module.exports = { Gonderim, Komsular, GONDERIM, KOMSU, YENIDEN_ESITLE, PIL_ESIK }
