// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// block-filter.js — engel süzgeci (RFC-0013 §6.5) ve veri sınıfı (§6.1)
//
// Belirlenimcidir ve N(metin) üzerinde çalışır. Biri eşleşirse metin 'aile' sınıfına geçer ve dışarı gidemez.
// Süzgeci geçersiz kılma yolu yoktur; kullanıcı metni düzeltebilir.
const b4a = require('b4a')
const { harfSayisi, katla, kacis } = require('./text')
const cz = require('./resolver')

const UZUN = 1024 // madde 9: 1 KB'tan uzun metin

// Ad parçaları: her ad katlanır (RFC-0023 §2 c), boşlukla bölünür, 3 harften kısa parçalar atlanır (madde 1)
function adParcalari (adlar) {
  const out = new Set()
  for (const a of adlar) {
    if (typeof a !== 'string') continue
    for (const p of katla(a).split(' ')) if (harfSayisi(p) >= 3) out.add(p)
  }
  return [...out]
}

// Kelime başında eşleşme, katlanmış metinde: ek ve kesme işareti fark etmez ("Cokiye", "Cokinin", "Cigdem").
// Biçim karakterleri (sıfır genişlikli boşluk) katlamada silinir. Aynı kural kaynaksız cevapta da (§7.4).
function adGeciyor (metin, adlar) {
  const parcalar = adParcalari(adlar)
  if (!parcalar.length) return []
  const f = katla(String(metin).replace(/['’"“”]/g, ' '))
  return parcalar.filter((p) => new RegExp('(?<![\\p{L}\\p{N}])' + kacis(p), 'u').test(f))
}

// Dönüş: eşleşen maddelerin adları (sırası tablodaki gibi); boşsa metin süzgeçten geçer.
// adlar: defterdeki üye ve misafir adları; varlık, yer, koleksiyon adları; okunabilen kartların adları.
function engel (metin, { adlar = [] } = {}) {
  if (typeof metin !== 'string') throw new Error('INVALID_TEXT')
  // Uzunluk önce (bulgu 13): 1 KB üstü metin başka denetime girmeden engellenir
  if (b4a.byteLength(metin) > UZUN) return ['uzun']
  const out = []
  if (adGeciyor(metin, adlar).length) out.push('ad')
  if (cz.telefonlar(metin).length) out.push('telefon')
  if (cz.epostalar(metin).length) out.push('eposta')
  if (cz.tcknler(metin).length) out.push('tckn')
  if (cz.ibanlar(metin).length) out.push('iban')
  if (cz.kartlar(metin).length) out.push('kart')
  if (cz.adresVar(metin)) out.push('adres')
  if (cz.plakaVar(metin)) out.push('plaka')
  return out
}

// §6.1: en sıkı sınıf geçerlidir, kasa > aile > genel
const SIRA = ['genel', 'aile', 'kasa']
function enSiki (...siniflar) {
  let i = 0
  for (const s of siniflar) {
    const k = SIRA.indexOf(s)
    if (k < 0) throw new Error('INVALID_CLASS')
    if (k > i) i = k
  }
  return SIRA[i]
}

// Bir işin sınıfı. kaynaklar: işe giren kaynakların sınıfları ('kasa' | 'aile'); bagli: mesaja, kayda ya da dosyaya
// bağlı mı (yanıt bağlamı, arama sonucu dahil). Yalnız kullanıcının yazdığı, hiçbir şeye bağlı olmayan ve süzgeçten
// geçen metin 'genel'dir.
function sinifBelirle (metin, { kaynaklar = [], bagli = false, adlar = [] } = {}) {
  const taban = bagli || engel(metin, { adlar }).length ? 'aile' : 'genel'
  return enSiki(taban, ...kaynaklar)
}

module.exports = { UZUN, engel, adGeciyor, adParcalari, enSiki, sinifBelirle }
