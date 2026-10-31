// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// child.js — çocuk modu çıktı süzgeci (RFC-0013 §11) ve kriz yönlendirmesi (§12)
//
// Listeler uygulamanın içinde gelir ve sürümlüdür; indirilmez. Karşılaştırma N üzerinden yapılır.
const { N, kacis, katla } = require('./text')


// §11 kural 1: kişilik kalıpları; kural 2: etkileşimi uzatan devam önerileri. Eşleşen cümle çıkarılır. Katlanmış
// metinde kök ve aralıklı kalıplar (inceleme 10 bulgu 8): "Seni çok özledim", "Ben senin dostunum".
const KISILIK = [
  /\bseni\b.{0,15}\bozle/u, /\b(arkadas|dost|kanka)(in|un)(im|um)\b/u, /\b(en iyi|senin|tek) (arkadas|dost)/u,
  /\bseni\b.{0,12}\bsev(iyorum|erim|dim)/u, /\bben de seni\b/u, /\bseni (cok )?(merak ettim|dusundum|bekledim)/u,
  /\barkadasin olurum\b/u, /\bhep yanindayim\b/u
]
const DEVAM = [
  /\bbaska\b.{0,30}\b(sor|yardim|merak|ister)/u, /\bbaska (bir )?(sey|sorun|soru)\w* (var mi|varsa)/u,
  /\b(yardimci olabilecegim|yardim edebilecegim)\b/u, /\b(yine|tekrar) (yaz|gel|konus)/u, /\bbeni unutma\b/u,
  /\b(sohbete|konusmaya) devam/u, /\bdaha (da )?konusalim\b/u
]
// §11 kural 5: çocukta diyet, kilo, cinsellik, romantik içerik; cümle sabit yönlendirmeyle değişir. Kelime başı eşleşir.
const KONU = ['diyet', 'kilo ver', 'kilo al', 'kalori', 'zayıfla', 'cinsel', 'seks', 'sevgili', 'flört', 'romantik', 'öpüş']
const YONLENDIRME = 'Bunu güvendiğin bir yetişkinle konuşabilirsin.'
const ETIKET = 'Asistan' // çocukta asistanın adı gösterilmez
const GENEL_ETIKET = 'yanılabilir'

const kelimeBasi = (n, k) => new RegExp('(?<![\\p{L}\\p{N}])' + kacis(k), 'u').test(n)

// Cümlelere böl: nokta, ünlem, soru, üç nokta ya da satır sonundan sonra
const cumleler = (metin) => metin.split(/(?<=[.!?…])\s+|\n+/u).map((s) => s.trim()).filter(Boolean)

// Dönüş: { metin, cikarilan: sayı, yonlendirildi: bool }
function cocukSuzgeci (metin) {
  const out = []
  let cikarilan = 0
  let yonlendirildi = false
  // Kişilik yok: duygu yüzleri ve emoji çıkarılır (§11 kural 1)
  for (const s of cumleler(metin.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '').replace(/[ \t]+/g, ' '))) {
    const n = N(s)
    const f = katla(s)
    if (KISILIK.some((r) => r.test(f)) || DEVAM.some((r) => r.test(f))) { cikarilan++; continue }
    if (KONU.some((k) => kelimeBasi(n, k))) {
      cikarilan++
      if (!yonlendirildi) out.push(YONLENDIRME)
      yonlendirildi = true
      continue
    }
    out.push(s)
  }
  return { metin: out.join(' '), cikarilan, yonlendirildi }
}

// --- Kriz (§12) ----------------------------------------------------------------------------------------------------

// Kalıp listesi çekirdeğin tek kaynağıdır: crisis-list.json (sürümlü; ürünler kopyasını kullanır, inceleme 8)
const KRIZ = require('./crisis-list.json')
// haric: katlanmış metinde; 'N:' önekli olanlar katlanmamış N(metin) üzerinde (katlama ş/s farkını siler: aşmak/asmak)
const KUMELER = KRIZ.kumeler.map((k) => ({
  ad: k.ad,
  kaliplar: k.kaliplar.map((x) => new RegExp(x, 'u')),
  haric: (k.haric || []).filter((x) => !x.startsWith('N:')).map((x) => new RegExp(x, 'u')),
  haricN: (k.haric || []).filter((x) => x.startsWith('N:')).map((x) => new RegExp(x.slice(2), 'u'))
}))

// Eşleşen kümelerin adları (boşsa kriz yok)
function krizKumeleri (metin) {
  const f = katla(metin)
  const n = N(metin)
  return KUMELER.filter((k) => k.kaliplar.some((r) => r.test(f)) && !k.haric.some((r) => r.test(f)) && !k.haricN.some((r) => r.test(n))).map((k) => k.ad)
}

// Anlam katmanı (RFC-0023 §2, anlam: KrizAnlam.skor sonucu ya da bool) ve platform modeli yalnız tespit ekleyebilir;
// listenin tespitini kaldıramaz
const krizMi = (metin, { modelTespiti = false, anlam = null } = {}) =>
  krizKumeleri(metin).length > 0 || modelTespiti === true || anlam === true || anlam?.kriz === true

// Kademeli sonuç (RFC-0024 §5 a): 'tam' (liste, model ya da yüksek eşik) | 'sinir' (düşük ile yüksek eşik arası) | null
function krizDuzeyi (metin, { modelTespiti = false, anlam = null } = {}) {
  if (krizMi(metin, { modelTespiti, anlam })) return 'tam'
  return anlam && anlam.sinir === true ? 'sinir' : null
}

// Sınır sonucunda cevabın altındaki sakin satır (RFC-0024 §5 c); düğme tam kriz ekranını açar
const SINIR_SATIRI = 'Zor bir şey mi yaşıyorsun?'

const TASLAK = 'Konuşmam lazım, müsait misin?' // ürünler ayrı metin yazmaz (inceleme 8 madde 3)
const SABLON = 'Bu konuda yalnız değilsin. Şimdi güvendiğin bir yetişkinle konuş. Acil bir tehlike varsa 112\'yi ara.'

// Telefonun bölgesine göre acil numarası; liste uygulamanın içindedir
const ACIL = { TR: '112', DE: '112', NL: '112', FR: '112', AT: '112', BE: '112', CH: '112', SE: '112', DK: '112', NO: '112', IT: '112', ES: '112', GB: '999', IE: '112', US: '911', CA: '911', AU: '000' }

// Numaranın okunuşuna göre belirtme eki
const BELIRTME = { 112: '112\'yi', 911: '911\'i', 999: '999\'u', '000': '000\'ı' }

// Türkçe yönelme eki: ünlüyle biten ada 'y' kaynaştırma; son ünlü kalınsa 'a', inceyse 'e'
function yonelme (ad) {
  const unlu = ad.match(/[aıoueiöüâîû]/giu)
  const son = unlu ? N(unlu[unlu.length - 1]) : 'e'
  const ek = 'aıouâû'.includes(son) ? 'a' : 'e'
  return ad + '\'' + (/[aıoueiöüâîû]$/iu.test(ad) ? 'y' : '') + ek
}

// Kriz cevabı: model üretmez, geçmişe ve paylaşılan koleksiyonlara yazılmaz, kimseye kendiliğinden haber gitmez.
// guvenilenler: kullanıcının seçtiği kişiler (varsayılan: ailedeki ebeveyn ve yetişkinler) [{ uye, ad }].
function krizCevabi ({ bolge = 'TR', guvenilenler = [] } = {}) {
  const numara = ACIL[bolge] || '112'
  const metin = SABLON.replace('112\'yi', BELIRTME[numara])
  const dugmeler = [{ tur: 'ara', numara, etiket: BELIRTME[numara] + ' ara' }]
  if (bolge === 'TR') dugmeler.push({ tur: 'ara', numara: '183', etiket: 'ALO 183 Sosyal Destek Hattı\'nı ara' })
  for (const g of guvenilenler) dugmeler.push({ tur: 'yaz', uye: g.uye, etiket: yonelme(g.ad) + ' yaz', taslak: TASLAK, kendiligindenGonder: false })
  return { kriz: true, metin, dugmeler, gecmiseYaz: false, modelCagrildi: false }
}

module.exports = { LISTE_SURUM: KRIZ.surum, KRIZ_SURUM: KRIZ.surum, TASLAK, krizKumeleri, katla, YONLENDIRME, ETIKET, GENEL_ETIKET, SABLON, ACIL, cocukSuzgeci, krizMi, krizDuzeyi, SINIR_SATIRI, krizCevabi, yonelme, cumleler }
