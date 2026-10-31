// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// plan.js — Sohbetten Plana (RFC-0013 §7.7, D19 20): sohbet mesajındaki tarih ve saat ifadelerinden öneri kartı
//
// Kural tabanlı ön süzgeç (tarih, saat, gün adı, "bugün", "yarın", "öbür gün", "haftaya") takılmayan mesaj karta
// dönüşmez. Göreli günler kaynak mesajın gününe (Türkiye saati) göre çözülür ve 'cikarim' sayılır (§8.3, güven 70);
// metinde yazan tarih ve saat 'alinti'dir. Plan türü: saat varsa ya da yapılacak sözü yoksa 'etkinlik', yoksa
// 'yapilacak'. Kart, uygulamanın iki şemasından birine göre bir Cikarim'dır; onay ekranından olağan yolla kaydedilir.
const { N, kacis } = require('./text')
const cz = require('./resolver')
const c = require('./extraction')

const DAY = 86_400_000
const OFSET_MS = c.OFSET_DK * 60_000
// Pazartesi = 0; uzun ad önce (cumartesi ⊃ cuma, pazartesi ⊃ pazar)
const GUNLER = ['pazartesi', 'salı', 'çarşamba', 'perşembe', 'cuma', 'cumartesi', 'pazar']
const GUN_RE = new RegExp('(?<![\\p{L}\\p{N}])(haftaya )?(' + [...GUNLER].sort((a, b) => b.length - a.length).map(kacis).join('|') + ')', 'u')
const GORELI = [['bugün', 0], ['bu akşam', 0], ['yarın', 1], ['öbür gün', 2], ['ertesi gün', 2], ['haftaya', 7]]
const GORELI_RE = new RegExp('(?<![\\p{L}\\p{N}])(' + GORELI.map(([k]) => kacis(k)).join('|') + ')', 'u')
const YAPILACAK_RE = /(?<![\p{L}\p{N}])(alınacak|alınsın|yapılacak|yapılsın|unutma|unutmayın|hatırlat|lazım|gerek|ödenecek|ödensin)/u
const EMIR_RE = /^\p{L}*(?:\s+\p{L}+){0,2}\s+\p{L}+(sın|sin|sun|sün)(?![\p{L}\p{N}])/u // adın ardından en çok iki sözcük ve emir: "Maya ekmek alsın"
const BEN_RE = /(?<![\p{L}\p{N}])ben\s+\p{L}*(ırım|irim|urum|ürüm|arım|erim)(?![\p{L}\p{N}])/u
const BASLIK_MAX = 80

// Mesajın günü (Türkiye saati): 'YYYY-MM-DD' ve haftanın günü (pazartesi = 0)
function yerelGun (ms) {
  const g = Math.floor((ms + OFSET_MS) / DAY)
  return { gun: g, hafta: (g + 3) % 7 } // 1970-01-01 perşembe (3)
}
const gunMetni = (g) => new Date(g * DAY).toISOString().slice(0, 10)

// Ön süzgeç: karta dönüşebilecek bir ifade var mı
function onSuzgec (metin) {
  const n = N(metin)
  return cz.tarihler(metin).length > 0 || cz.saatler(metin).length > 0 || GUN_RE.test(n) || GORELI_RE.test(n)
}

// Gün: metindeki tarih (alinti) ya da göreli ifade (cikarim). Dönüş: { deger: 'YYYY-MM-DD', dayanak, bas, bit } | null
function gunBul (metin, at) {
  const t = cz.tarihler(metin)[0]
  if (t) return { deger: t.deger, dayanak: 'alinti', bas: t.bas, bit: t.bit }
  const n = N(metin)
  const { gun, hafta } = yerelGun(at)
  const m = GUN_RE.exec(n)
  if (m) {
    const hedef = GUNLER.indexOf(m[2])
    // Gün adı: bu haftadaki o gün geçmediyse o gün, geçtiyse ya da bugünse gelecek hafta; "haftaya X" gelecek haftanın X'i
    let fark = (hedef - hafta + 7) % 7
    if (fark === 0) fark = 7
    if (m[1]) fark = 7 - hafta + hedef
    return { deger: gunMetni(gun + fark), dayanak: 'cikarim', bas: m.index, bit: m.index + m[0].length }
  }
  const g = GORELI_RE.exec(n)
  if (g) return { deger: gunMetni(gun + GORELI.find(([k]) => k === g[1])[1]), dayanak: 'cikarim', bas: g.index, bit: g.index + g[0].length }
  return null
}

// Kişiler: kisiler Map<'uye:<hex>', ad>; adın ardından ek gelebilir ("Maya'yla", "Ali'ye"). Sorumlu: emir kipindeki
// fiilden önce gelen ad ("Maya alsın") ya da "ben …ırım" (mesajın yazarı).
function kisileriBul (n, kisiler, yazar) {
  const kimler = []
  let sorumlu = null
  for (const [id, ad] of kisiler) {
    const k = N(ad)
    if (!k) continue
    const re = new RegExp('(?<![\\p{L}\\p{N}])' + kacis(k) + '(?![\\p{N}])', 'gu')
    let m
    while ((m = re.exec(n))) {
      if (!kimler.includes(id)) kimler.push(id)
      if (!sorumlu && EMIR_RE.test(n.slice(m.index + k.length))) sorumlu = id
    }
  }
  if (!sorumlu && yazar && BEN_RE.test(n)) sorumlu = yazar
  return { kimler, sorumlu }
}

// Başlık: tarih, saat ve gün ifadeleri çıkarılmış ilk cümle
function baslikBul (metin, araliklar) {
  let n = N(metin)
  for (const [b, e] of [...araliklar].sort((x, y) => y[0] - x[0])) {
    let son = e
    while (son < n.length && /[\p{L}'’]/u.test(n[son])) son++ // ifadeye bitişik ek ("15:00'te")
    n = n.slice(0, b) + ' ' + n.slice(son)
  }
  n = n.replace(new RegExp(GUN_RE.source + '\\p{L}*', 'u'), ' ').replace(new RegExp(GORELI_RE.source + '\\p{L}*', 'u'), ' ').replace(/(?<![\p{L}\p{N}])saat(?![\p{L}\p{N}])/gu, ' ')
  const t = n.split(/[.!?\n]/)[0].replace(/\s+/g, ' ').replace(/^[\s,;:-]+|[\s,;:-]+$/g, '')
  if (!t) return null
  const k = t.length > BASLIK_MAX ? t.slice(0, BASLIK_MAX).trim() : t
  return k[0].toLocaleUpperCase('tr') + k.slice(1)
}

// metin: mesaj; at: mesajın zamanı (hlc'nin ms'i); kaynak: ['msg:…']; yazar: 'uye:<hex>'; semalar: { etkinlik, yapilacak }
// (şema nesneleri). Şemadaki bilinen alanlar doldurulur: baslik (metin), tarih (tarih), saat (saat), baslangic (zaman),
// sorumlu (kisi), kimler (liste, öğe kisi). Dönüş: { tur, sema, cikarim } | null (süzgece takılmadı).
function planCikar (metin, { at, kaynak = [], kisiler = new Map(), yazar = null, semalar }) {
  if (typeof metin !== 'string' || !Number.isSafeInteger(at)) throw new Error('INVALID_INPUT')
  if (!semalar || !semalar.etkinlik || !semalar.yapilacak) throw new Error('NO_SCHEMA')
  if (!onSuzgec(metin)) return null
  const n = N(metin)
  const gun = gunBul(metin, at)
  const saat = cz.saatler(metin)[0] || null
  const { kimler, sorumlu } = kisileriBul(n, kisiler, yazar)
  const tur = !saat && (YAPILACAK_RE.test(n) || sorumlu) ? 'yapilacak' : 'etkinlik'
  const sema = c.semaDogrula(semalar[tur])
  const araliklar = [gun, saat].filter((x) => x && x.dayanak !== 'cikarim').map((x) => [x.bas, x.bit])
  const baslik = baslikBul(metin, araliklar)
  const alanlar = []
  const koy = (ad, tur, deger, dayanak) => {
    const a = sema.alanlar.find((x) => x.ad === ad && x.tur === tur && (tur !== 'liste' || x.oge === 'kisi'))
    if (!a || deger === null || deger === undefined || (Array.isArray(deger) && !deger.length)) return
    const d = c.degerCoz(a, deger, { kisiler })
    if (d === null) return
    alanlar.push({ ad, deger: d, conf: c.guven({ dayanak, yol: 'kural', bulundu: dayanak === 'alinti' }) })
  }
  koy('baslik', 'metin', baslik, 'cikarim')
  if (gun) koy('tarih', 'tarih', gun.deger, gun.dayanak)
  if (saat) koy('saat', 'saat', saat.deger, 'alinti')
  if (gun && saat) {
    const [y, a, g] = gun.deger.split('-').map(Number)
    const [sa, dk] = saat.deger.split(':').map(Number)
    koy('baslangic', 'zaman', Date.UTC(y, a - 1, g, sa, dk) - OFSET_MS, gun.dayanak === 'alinti' ? 'alinti' : 'cikarim')
  }
  koy('sorumlu', 'kisi', sorumlu, 'cikarim')
  koy('kimler', 'liste', kimler, 'alinti')
  const sira = new Map(sema.alanlar.map((x, i) => [x.ad, i]))
  alanlar.sort((x, y) => sira.get(x.ad) - sira.get(y.ad))
  return { tur, sema: c.semaAdi(sema), cikarim: { sema: c.semaAdi(sema), alanlar, kaynak: [...kaynak], model: 'kural/' + c.KURAL_SURUM } }
}

module.exports = { GUNLER, onSuzgec, gunBul, planCikar, yerelGun }
