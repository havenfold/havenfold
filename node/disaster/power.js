// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// disaster/power.js — düğümün güç kaynağı (RFC-0012 §10, §9.3): /sys/class/power_supply okuma, prizden kesinti ve pil izleme.
//
// Prizden güç kesilince düğüm afet modunda ETKİN'e geçer (durum makinesine `dugum: { pilde: true }`); pille çalışan düğüm
// görev kabul etmez (NODE_CAPS.status = 'pil'; health.js). Kısa kesintilerde gürültü olmasın diye "elektrik kesildi"
// olayı 2 dakika kesintisiz pilde kalınca verilir (§10; işçinin UYARI'sı bu olaya bağlanır, Yuva Kutusu ile). Durum
// değişikliği (prizde/pilde, pil yüzdesi) hemen bildirilir. Harici UPS (NUT) desteklenmez (GPL; §10).
const fs = require('#fs')
const path = require('#path')

const KESINTI_MS = 2 * 60_000
const YOKLAMA_MS = 10_000

/**
 * Güç kaynağını oku. kok: sysfs öneki (test). Dönüş: { prizde: bool | null (Mains yoksa bilinmiyor), pil: yüzde | null,
 * sarj: 'dolu' | 'sarj' | 'bosaliyor' | 'sarj-degil' | null }
 */
// Dış güç kaynakları: priz (Mains) ve USB-C/USB güç girişi (USB, USB_C, USB_PD …). Denetçi de bunu kullanır
// (supervisor-main.js; inceleme 22 madde 14: güç iki yerde farklı okunmasın)
const DIS_KAYNAK = (tur) => tur === 'Mains' || (typeof tur === 'string' && tur.startsWith('USB'))

/** /sys/class/power_supply girdileri: { adlar, oku(ad, dosya) } */
function sysfs (kok) {
  const ps = path.join(kok, 'sys/class/power_supply')
  let adlar = []
  try { adlar = fs.readdirSync(ps) } catch {}
  const oku = (...p) => { try { return fs.readFileSync(path.join(ps, ...p), 'utf8').trim() } catch { return null } }
  return { adlar, oku }
}

/** Dış güç: true (biri bağlı), false (hepsi kopuk), null (dış kaynak girdisi yok; masaüstü) */
function prizdeMi ({ adlar, oku }) {
  const priz = adlar.filter((a) => DIS_KAYNAK(oku(a, 'type'))).map((a) => oku(a, 'online')).filter((x) => x !== null)
  return priz.length ? priz.includes('1') : null
}

function gucOku (kok = '/') {
  const s = sysfs(kok)
  const { adlar, oku } = s
  const bat = adlar.filter((a) => oku(a, 'type') === 'Battery' && oku(a, 'present') !== '0')
  let pil = null
  let sarj = null
  if (bat.length) {
    const y = Number(oku(bat[0], 'capacity'))
    pil = Number.isInteger(y) && y >= 0 && y <= 100 ? y : null
    sarj = { Full: 'dolu', Charging: 'sarj', Discharging: 'bosaliyor', 'Not charging': 'sarj-degil' }[oku(bat[0], 'status')] ?? null
  }
  return { prizde: prizdeMi(s), pil, sarj }
}

/** §9.3: düğümün görev oranı satırı. Prizde ya da pil ≥ %30: sürekli; değilse telefonun ETKİN %15–30 satırı */
function gorevOrani ({ prizde, pil }) {
  if (prizde !== false || pil == null || pil >= 30) return { reklam: 'surekli', tarama: { acikMs: Infinity, aralikMs: 0 }, duyuruMs: 30_000 }
  return { reklam: 'surekli', tarama: { acikMs: 5_000, aralikMs: 180_000 }, duyuruMs: 60_000 }
}

/**
 * Güç izleyici. olay(o): { tur: 'degisti', guc } hemen; { tur: 'kesinti', an, guc } 2 dk kesintisiz pilde;
 * { tur: 'geldi', an, guc } kesinti bildirildikten sonra priz dönünce. oku ve saat testte verilir.
 */
class GucIzleyici {
  constructor ({ kok = '/', oku = () => gucOku(kok), saat = Date.now, olay = () => {}, yoklamaMs = YOKLAMA_MS } = {}) {
    this.oku = oku
    this.saat = saat
    this.olay = olay
    this.yoklamaMs = yoklamaMs
    this.son = null
    this.pildeBas = null
    this.kesintiBildirildi = false
    this.zaman = null
  }

  /** Bir yoklama: değişiklik ve kesinti olaylarını üretir; son ölçümü döndürür */
  yokla () {
    const g = this.oku()
    const simdi = this.saat()
    const s = this.son
    const degisti = !s || s.prizde !== g.prizde || s.pil !== g.pil
    this.son = g // olay dinleyicisi sinyal() ile son ölçümü okur
    if (g.prizde !== false && this.kesintiBildirildi) {
      this.pildeBas = null
      this.kesintiBildirildi = false
      if (degisti) this.olay({ tur: 'degisti', guc: g })
      this.olay({ tur: 'geldi', an: simdi, guc: g })
      return g
    }
    if (degisti) this.olay({ tur: 'degisti', guc: g })
    if (g.prizde === false) {
      if (this.pildeBas == null) this.pildeBas = simdi
      if (!this.kesintiBildirildi && simdi - this.pildeBas >= KESINTI_MS) {
        this.kesintiBildirildi = true
        this.olay({ tur: 'kesinti', an: this.pildeBas, guc: g })
      }
    } else this.pildeBas = null
    return g
  }

  /**
   * DisasterApi.signal() girdisi: { dugum: { pilde, prizde }, pil }. `pilde` yalnız kesinti 2 dk sürünce (kısa kesinti açmaz).
   * Pil yüzdesi yalnız pille çalışırken verilir; prizdeki cihaz taşıyıcı sınırı için pil bildirmez (açıklama 2 madde 3)
   */
  sinyal () {
    const g = this.son ?? this.yokla()
    return { dugum: { pilde: this.kesintiBildirildi, prizde: g.prizde !== false }, pil: g.prizde === false ? g.pil : null }
  }

  baslat () {
    this.yokla()
    this.zaman = setInterval(() => { try { this.yokla() } catch {} }, this.yoklamaMs)
    if (this.zaman.unref) this.zaman.unref()
    return this
  }

  durdur () { clearInterval(this.zaman); this.zaman = null }
}

module.exports = { gucOku, gorevOrani, GucIzleyici, KESINTI_MS, sysfs, prizdeMi, DIS_KAYNAK }
