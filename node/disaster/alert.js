// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// disaster/alert.js — Yuva Kutusu'nda işçinin deprem ve elektrik uyarısı (RFC-0012 §10, §17 adım 8 yazılım kısmı; Acil 05).
//
// - Sensör soyut bir arayüzdür ({ dinle(fn(olcum)) → bırak(), calisiyor?() }); gerçek ivmeölçer okuma bu adımda yok,
//   testte SensorBenzetimi. Ölçüm { an, deger } (sensörün kendi birimi, tamsayı).
// - **Eşik ve seviye ölçeği açık noktadır** (Acil 05 §6): eşik yapılandırılabilir, varsayılan kapalıdır (null); eşiksiz
//   deprem uyarısı üretilmez. Seviye, ölçek tanımlanana kadar ölçülen değerdir (tamsayı); ölçek işlevi verilebilir.
// - Aynı sarsıntı için tek uyarı: eşiği aşan ölçümden sonra 10 dakika yeni deprem uyarısı yok.
// - Elektrik: güç izleyicinin 'kesinti' olayı (2 dk kesintisiz pilde; power.js) uyarı olur, seviye 0, pil iç alanda.
// - Yakındakiler (nearby): işçi kimliğinin **kendisinin** son 10 dakikada yerel ağ ya da kendi Bluetooth'uyla doğrudan
//   oturum kurduğu aile üyeleri (YakinKaydi). Kutunun bağ geçmişi kullanılmaz (kurucu belge H4).
// - Dağıtım: UYARI her aile telefonuna ayrı mühürlenir (DisasterApi.sendAlert); gövdeler kutuya olağan yerel oturumla
//   bırakılır (kutu taşır ve ETKİN'e geçer). İnternet varsa evden uzaktaki üyelere normal yoldan da gider; varsayılan
//   ebeveyn ve yetişkin (Acil 05 §3: uzaktaki çocuğa internetle uyarı gitmez, açık nokta).
const YAKIN_MS = 10 * 60_000
const TEKIL_MS = 10 * 60_000
const YAKIN_EN_COK = 16 // açıklama 3: ct ≤ 420 B (her kimlik 16 bayt; 21'in üstü DISASTER_LENGTH)
const SEVIYE_EN_COK = 100
const YENIDEN_MS = 5_000 // sınırın kalkma anı bilinmeyen geçici hatada
const YEREL_YOLLAR = new Set(['yerel', 'bluetooth'])

/**
 * İşçinin kendi doğrudan yerel oturumları (son 10 dk). gordu(kimlik, yol): yol 'yerel' | 'bluetooth' sayılır, başkası değil.
 * Liste aktif aile üyeleriyle (telefon) süzülür ve en çok 16 kişi, en yeniler (açıklama 3; inceleme 24 madde 4).
 * o: { saat?, uyeMi?: (kimlik) → bool (defterde aktif telefon üyesi) }
 */
class YakinKaydi {
  constructor ({ saat = Date.now, uyeMi = () => true } = {}) { this.saat = saat; this.uyeMi = uyeMi; this.m = new Map() }
  gordu (kimlik, yol) {
    if (!YEREL_YOLLAR.has(yol)) return
    this.m.delete(kimlik)
    this.m.set(kimlik, this.saat())
    while (this.m.size > YAKIN_EN_COK * 4) this.m.delete(this.m.keys().next().value) // bellek sınırı
  }

  /** Son 10 dakikada görülen aktif üyeler (en çok 16, en yeniler); eskiler budanır */
  liste () {
    const t = this.saat()
    for (const [k, v] of this.m) if (t - v > YAKIN_MS) this.m.delete(k)
    return [...this.m.entries()].filter(([k]) => this.uyeMi(k)).sort((a, b) => b[1] - a[1]).slice(0, YAKIN_EN_COK).map(([k]) => k).sort()
  }
}

/** Sensör benzetimi (test ve geliştirme): olc(deger) bir ölçüm yayar */
class SensorBenzetimi {
  constructor ({ saat = Date.now } = {}) { this.saat = saat; this.dinleyiciler = new Set(); this.son = null }
  dinle (fn) { this.dinleyiciler.add(fn); return () => this.dinleyiciler.delete(fn) }
  calisiyor () { return true }
  olc (deger) { this.son = { an: this.saat(), deger }; for (const f of this.dinleyiciler) f(this.son) }
}

/**
 * Eşik denetimi: olay(o) { tur: 'deprem', an, seviye }. esik null → hiç uyarı yok. Gürültü süzgeci: eşiği aşan en az
 * `ardisik` (varsayılan 2) art arda ölçüm, aralarında en çok 1 sn (tek örnek uyarı üretmez; inceleme 24 madde 5).
 * Seviye 0–100'e sıkıştırılır.
 */
class DepremAlgilayici {
  constructor ({ sensor, esik = null, olcek = (d) => d, olay = () => {}, ardisik = 2 }) {
    if (esik != null && !(Number.isFinite(esik) && esik > 0)) throw new Error('INVALID_THRESHOLD')
    this.sensor = sensor
    this.esik = esik
    this.olcek = olcek
    this.olay = olay
    this.sonUyari = null
    this.sonOlcum = null
    this.ardisik = ardisik
    this.seri = [] // eşiği aşan son ölçümler
    this.birak = sensor.dinle((o) => this._olcum(o))
  }

  _olcum (o) {
    this.sonOlcum = o
    if (this.esik == null || !Number.isFinite(o.deger) || o.deger < this.esik) { this.seri = []; return }
    this.seri = [...this.seri.filter((x) => o.an - x.an <= 1000), o].slice(-this.ardisik)
    if (this.seri.length < this.ardisik) return // gürültü süzgeci
    if (this.sonUyari != null && o.an - this.sonUyari < TEKIL_MS) return // aynı sarsıntı
    this.sonUyari = o.an
    const enBuyuk = Math.max(...this.seri.map((x) => x.deger))
    this.olay({ tur: 'deprem', an: o.an, seviye: Math.min(SEVIYE_EN_COK, Math.max(0, Math.round(this.olcek(enBuyuk)))) })
  }

  /** Acil A48: sensör çalışıyor mu, son ölçüm */
  hal () { return { calisiyor: !!this.sensor.calisiyor?.(), sonOlcum: this.sonOlcum ? this.sonOlcum.an : null, esik: this.esik } }

  durdur () { this.birak?.() }
}

/**
 * İşçinin uyarı yöneticisi. o: { afet (işçinin DisasterApi'si), yakin: YakinKaydi, kutuyaBirak: (govde) → bool (olağan yerel
 * oturumla kutuya AFET_MSG), normalGonder?: (to, govde) → bool (internet varken olağan oturum ya da emanet),
 * internetVar?: () → bool, uzaktakiler?: roller (varsayılan ['ebeveyn', 'yetiskin']) }
 */
class UyariYoneticisi {
  constructor ({ afet, yakin, kutuyaBirak = () => false, normalGonder = () => false, internetVar = () => false, uzaktakiler = ['ebeveyn', 'yetiskin'], zamanlayici = { setTimeout } }) {
    this.z = zamanlayici
    this.afet = afet
    this.yakin = yakin
    this.kutuyaBirak = kutuyaBirak
    this.normalGonder = normalGonder
    this.internetVar = internetVar
    this.uzaktakiler = new Set(uzaktakiler)
    this.gecmis = [] // { tur, an, mids, kutuya, normal } (adres ya da içerik yok)
  }

  /**
   * Deprem algılayıcının ya da güç izleyicinin olayı. Dönüş: gönderim özeti ya da null (uyarı değil). Sınıra ya da geçici
   * hataya takılan uyarı, sınır kalkınca bir kez yeniden denenir (açıklama 3); hata süreci düşürmez.
   */
  olay (o, { yeniden = false } = {}) {
    let tur
    let seviye = 0
    if (o.tur === 'deprem') { tur = 'deprem'; seviye = o.seviye } else if (o.tur === 'kesinti') tur = 'elektrik'
    else return null
    let r
    try {
      r = this.afet.sendAlert({ tur, seviye, yakindakiler: this.yakin.liste() })
    } catch (e) {
      const ozet = { tur, an: o.an ?? null, hata: e.message, yeniden: !yeniden }
      this.gecmis.push(ozet)
      if (!yeniden) {
        const z = this.z.setTimeout(() => { try { this.olay(o, { yeniden: true }) } catch {} }, e.bekleMs || YENIDEN_MS)
        if (z && z.unref) z.unref()
      }
      return ozet
    }
    let kutuya = 0
    let normal = 0
    for (const g of r.govdeler) {
      if (this.kutuyaBirak(g.govde)) kutuya++
      if (this.internetVar() && this.uzaktakiler.has(g.rol) && this.normalGonder(g.to, g.govde)) normal++
    }
    const ozet = { tur, an: o.an ?? null, mids: r.mids, kutuya, normal }
    this.gecmis.push(ozet)
    if (this.gecmis.length > 50) this.gecmis.shift()
    return ozet
  }
}

module.exports = { YakinKaydi, SensorBenzetimi, DepremAlgilayici, UyariYoneticisi, YAKIN_MS, TEKIL_MS, YAKIN_EN_COK, SEVIYE_EN_COK }
