// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// status.js — afet modunun durum makinesi (RFC-0012 §5): KAPALI, HAZIR, ETKİN. Saf işlev: aynı girdi, aynı geçiş.
// Durum paylaşılan bir aile durumu değildir; her cihaz kendi kuralıyla karar verir.
const DK = 60_000
const SAAT = 3_600_000

const VARSAYILAN = { esikDk: 30 } // KAPALI → HAZIR: internet 30 dk yok (ayarda 10–120)

/**
 * d: { durum: 'KAPALI' | 'HAZIR' | 'ETKIN', etkinBas: ms | null, elle: boolean, soru?, soruBas?: ms | null, kapatildi?: ms | null }
 * g: {
 *   simdi, internetYok: ms | null (internetin gittiği an; varsa null), internetVar: ms | null (döndüğü an; yoksa null),
 *   isaret: ms | null (son doğrulanmış deprem UYARI'sı ya da SOS: alınan ya da gönderilen), kullanici: 'ac' | 'kapat' | null,
 *   yazdi: boolean (HAZIR'dayken kullanıcı afet mesajı yazdı), yerelMesaj: boolean (yerel bağla afet mesajı geldi),
 *   dugum: { pilde?: boolean, sensor?: boolean } | null, bekleyen: number (gönderilmeyi bekleyen kendi mesajı),
 *   surdur: boolean | null ("Afet modu sürsün mü?" cevabı), esikDk?, uyari?: boolean (kutu: işçinin UYARI'sı taşımaya
 *   geldi; §10 adım 3 "kutu ETKİN'e geçer")
 * }
 * Dönüş: { durum, etkinBas, elle, soru, soruBas, kapatildi } (soru: 72 saat doldu, elle açılmıştı; ürün sorar; kapatildi: son elle
 * kapatma anı, ondan önceki işaret ve internet kesintisi yeniden açmaz)
 */
function gecis (d, g) {
  const esik = Math.min(120, Math.max(10, g.esikDk ?? VARSAYILAN.esikDk)) * DK
  // Elle kapatıldıysa kapatmadan önceki işaret ve internet kesintisi yeniden açmaz (inceleme 21 B6)
  const kapatildi = d.kapatildi ?? null
  const internetYok = g.internetYok != null && kapatildi != null ? Math.max(g.internetYok, kapatildi) : g.internetYok
  const isaret = g.isaret != null && (kapatildi == null || g.isaret > kapatildi) ? g.isaret : null
  const yok = (sure) => internetYok != null && g.simdi - internetYok >= sure
  const etkin = (elle) => ({ durum: 'ETKIN', etkinBas: d.durum === 'ETKIN' ? d.etkinBas : g.simdi, elle: elle || (d.durum === 'ETKIN' && d.elle), soru: false, soruBas: null, kapatildi })
  const hazir = { durum: 'HAZIR', etkinBas: null, elle: false, soru: false, soruBas: null, kapatildi }
  const kapali = { durum: 'KAPALI', etkinBas: null, elle: false, soru: false, soruBas: null, kapatildi }

  if (g.kullanici === 'kapat') return { ...kapali, kapatildi: g.simdi }
  if (g.kullanici === 'ac') return { ...etkin(true), kapatildi: null }
  // herhangi → ETKİN (§5.2): işaret son 6 saatte ve internet 2 dk yok; HAZIR'da yazdı; düğümde pil ya da sensör
  if (isaret != null && g.simdi - isaret <= 6 * SAAT && yok(2 * DK)) return etkin(false)
  if (d.durum === 'HAZIR' && g.yazdi) return etkin(false)
  if (g.dugum && (g.dugum.pilde || g.dugum.sensor)) return etkin(false)
  if (g.uyari) return etkin(false) // §10: işçi deprem ya da elektrik UYARI'sını kutuya bıraktı

  // HAZIR ya da ETKİN → KAPALI: internet 10 dk kesintisiz döndü ve bekleyen yok
  if (d.durum !== 'KAPALI' && g.internetYok == null && g.internetVar != null && g.simdi - g.internetVar >= 10 * DK && g.bekleyen === 0) return kapali

  if (d.durum === 'ETKIN') {
    if (g.simdi - d.etkinBas >= 72 * SAAT) {
      if (d.elle && g.surdur === true) return { ...etkin(true), etkinBas: g.simdi }
      if (d.elle && g.surdur === false) return hazir
      // Elle açıldıysa önce sorulur; soru gösterildikten 10 dk sonra cevap yoksa HAZIR (tık geç gelse de soru atlanmaz)
      if (d.elle && !d.soru) return { ...d, soru: true, soruBas: g.simdi }
      if (d.elle && g.simdi - d.soruBas < 10 * DK) return d
      return hazir
    }
    return { ...d, soru: false, soruBas: null }
  }
  if (d.durum === 'KAPALI' && (yok(esik) || g.yerelMesaj)) return hazir
  return { ...d, soru: false, soruBas: null }
}

module.exports = { gecis, VARSAYILAN }
