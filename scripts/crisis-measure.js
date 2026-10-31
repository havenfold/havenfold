#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Kriz tespitinin ölçümü (inceleme 8, RFC-0023 §2): kural yolu, anlam katmanı ve birleşim için yakalama ve yanlış
// alarm oranları. Yalnız oranlar yazılır; cümleler yazılmaz (gizli set için). Ağa çıkmaz.
//
//   node scripts/crisis-measure.js <model modülü> [set.json …] [--ayarla]
//
// <model modülü>: gömme modelini saran bir JS dosyası; dışa aktarır: gom(metin) → Float32Array | number[] (ya da
// Promise), isteğe bağlı onEk (ör. 'query: ') ve modelHash. set.json: { kriz: [...], zararsiz: [...] }; verilmezse
// protocol/vectors/crisis-set.json. --ayarla: ayarlama seti (varsayılan çalışma seti + core/ai/test/helpers/crisis-extra.json
// birleşimi; --ayar=a.json,b.json ile değişir) üzerinde birleşimin yanlış alarmı ≤ %2 iken anlam katmanının kendi
// yakalamasını en yükseğe çıkaran yüksek eşik { esik, fark, k, kumeler } aranır; sonra sınır satırının zararsız cümlede
// görünmesi ≤ %15 iken tam ya da sınır yakalamasını en yükseğe çıkaran ve yüksekten küçük düşük eşik (RFC-0024 §5).
// İkisi de kuraldan bağımsızdır: hedef anlamın kendi oranlarıdır (inceleme 9 ölçüm 4). Eşikler 0,85'in altına inmez
// (inceleme 9 ölçüm 3: küçük sette eşik 0,5'e iniyordu). Bulunan değer crisis-examples.json'daki
// esikler[<modelHash>]'e elle girilir.
const path = require('path')
const yz = require('../core/ai')

const YANLIS_ALARM_SINIRI = 2 // yüzde; yeni cümlelerde pay kalsın
const ESIK_TABANI = 0.85
const SINIR_GORUNME_SINIRI = 15 // yüzde: sınır satırının zararsız cümlede görünmesi (RFC-0024 §5 d)
const VARSAYILAN_AYAR = ['../protocol/vectors/crisis-set.json', '../core/ai/test/helpers/crisis-extra.json'].map((x) => path.join(__dirname, x))

// fark: kriz komşusunun benzerliği zararsız komşununkini en az bu kadar geçmeli (inceleme 9 ölçüm 2: 0–0,05)
const FARKLAR = Array.from({ length: 11 }, (_, i) => Math.round(i * 5) / 1000)

async function ana (argv) {
  const ayarla = argv.includes('--ayarla')
  const ayarArg = argv.find((x) => x.startsWith('--ayar='))
  const ayarDosyalari = ayarArg ? ayarArg.slice(7).split(',') : VARSAYILAN_AYAR
  const [modelYolu, ...setler] = argv.filter((x) => x !== '--ayarla' && !x.startsWith('--ayar='))
  if (!modelYolu) { console.error('Kullanım: crisis-measure.js <model modülü> [set.json …] [--ayarla]'); return 1 }
  const model = require(path.resolve(modelYolu))
  const dosyalar = setler.length ? setler : [path.join(__dirname, '../protocol/vectors/crisis-set.json')]

  // Benzerlikler bir kez hesaplanır; eşik araması yalnız aritmetiktir (karar)
  const katman = new yz.krizAnlam.KrizAnlam({ gom: model.gom, onEk: model.onEk || '', modelHash: model.modelHash || null })
  const hazir = async (set) => ({
    kriz: await Promise.all(set.kriz.map(async (m) => ({ kural: yz.cocuk.krizMi(m), b: await katman.benzerlikler(m) }))),
    zararsiz: await Promise.all(set.zararsiz.map(async (m) => ({ kural: yz.cocuk.krizMi(m), b: await katman.benzerlikler(m) })))
  })
  // esik: yüksek eşik (tam), dusuk: düşük eşik (sınır; RFC-0024 §5). Sayılar: kural, anlam (tam), ikisi (kural ya
  // da tam), sinir (tam değil ama sınır), kademeli (tam ya da sınır)
  function olc (h, esik, dusuk = undefined) {
    const e = esik || katman.esik
    const d = dusuk === undefined ? katman.dusuk : dusuk
    const say = (liste) => {
      let kural = 0; let anlam = 0; let ikisi = 0; let sinir = 0; let kademeli = 0; let anlamSinir = 0; let anlamKademeli = 0
      for (const x of liste) {
        const an = yz.krizAnlam.karar(x.b, e).kriz
        const dk = !!d && yz.krizAnlam.karar(x.b, d).kriz
        const tam = x.kural || an
        const sn = !tam && dk
        if (x.kural) kural++
        if (an) anlam++
        if (tam) ikisi++
        if (sn) sinir++
        if (tam || sn) kademeli++
        // Kuraldan bağımsız (inceleme 9 ölçüm 4): anlamın kendi sınırı ve kendi tam-ya-da-sınır sonucu
        if (!an && dk) anlamSinir++
        if (an || dk) anlamKademeli++
      }
      return { kural, anlam, ikisi, sinir, kademeli, anlamSinir, anlamKademeli, n: liste.length }
    }
    return { kriz: say(h.kriz), zararsiz: say(h.zararsiz) }
  }
  const yuzde = (x, n) => (n ? Math.round((1000 * x) / n) / 10 : 0) + '%'
  const AD = { kural: 'kural', anlam: 'anlam (tam)', anlamSinir: 'anlam sınırı (kuralsız)', anlamKademeli: 'anlam tam ya da sınır (kuralsız)', ikisi: 'tam (kural ya da anlam)', sinir: 'sınır satırı', kademeli: 'tam ya da sınır' }
  const yaz = (ad, r) => {
    for (const yol of ['kural', 'anlam', 'anlamSinir', 'anlamKademeli', 'ikisi', 'sinir', 'kademeli']) {
      const etiket = yol === 'sinir' || yol === 'anlamSinir' ? 'zararsızda görünme' : 'yanlış alarm'
      console.log(`${ad} · ${AD[yol]}: yakalama ${r.kriz[yol]}/${r.kriz.n} (${yuzde(r.kriz[yol], r.kriz.n)}), ${etiket} ${r.zararsiz[yol]}/${r.zararsiz.n} (${yuzde(r.zararsiz[yol], r.zararsiz.n)})`)
    }
  }

  const veri = []
  for (const f of dosyalar) veri.push({ ad: path.basename(f), h: await hazir(require(path.resolve(f))) })
  let esik = null
  if (ayarla) {
    // Ayarlama seti: verilen dosyaların birleşimi (cümleler bir kez gömülür)
    const ayar = { kriz: [], zararsiz: [] }
    for (const f of ayarDosyalari) {
      const h = await hazir(require(path.resolve(f)))
      ayar.kriz.push(...h.kriz)
      ayar.zararsiz.push(...h.zararsiz)
    }
    // Eşikler kuraldan bağımsız (inceleme 9 ölçüm 4): ayarlama setini kural zaten yakalıyor; hedef anlamın kendi
    // yakalaması ve kendi yanlış alarmıdır
    const sinirIcinde = (r) => r.zararsiz.anlam * 100 <= YANLIS_ALARM_SINIRI * r.zararsiz.n
    const adimlar = []
    for (let e = ESIK_TABANI; e <= 0.995 + 1e-9; e += 0.005) adimlar.push(Math.round(e * 1000) / 1000)
    let en = null
    for (const e of adimlar) {
      for (const fark of FARKLAR) {
        for (const k of [1, 3, 5]) {
          const r = olc(ayar, { esik: e, fark, k }, null)
          if (!sinirIcinde(r)) continue
          if (!en || r.kriz.anlam > en.r.kriz.anlam || (r.kriz.anlam === en.r.kriz.anlam && r.zararsiz.anlam < en.r.zararsiz.anlam)) en = { esik: { esik: e, fark, k }, r }
        }
      }
    }
    if (!en) { console.log(`Uygun eşik bulunamadı (yanlış alarm her eşikte %${YANLIS_ALARM_SINIRI}'den büyük).`); return 3 }
    esik = en.esik
    // Küme başına iyileştirme: ortak eşikten başlayıp her kümenin eşiğini ayrı dener; yanlış alarm sınır içinde kalırken
    // anlam yakalaması artarsa (eşitse yanlış alarm azalırsa) kabul edilir
    esik.kumeler = {}
    let simdiki = en.r
    for (const kume of Object.keys(yz.krizAnlam.ORNEKLER.kriz)) {
      for (const e of adimlar) {
        for (const fark of FARKLAR) {
          const aday = { ...esik, kumeler: { ...esik.kumeler, [kume]: { esik: e, fark } } }
          const r = olc(ayar, aday, null)
          if (!sinirIcinde(r)) continue
          if (r.kriz.anlam > simdiki.kriz.anlam || (r.kriz.anlam === simdiki.kriz.anlam && r.zararsiz.anlam < simdiki.zararsiz.anlam)) { esik = aday; simdiki = r }
        }
      }
    }
    // Düşük eşik (RFC-0024 §5 d): yüksek eşiğin altında, sınır satırının zararsız cümlede görünmesi ≤ %15 iken tam ya
    // da sınır yakalamasını en yükseğe çıkaran; önce ortak, sonra küme başına
    // Kuraldan bağımsız: anlamın sınırı (yüksek eşiği geçmeyip düşüğü geçen) zararsızda ≤ %15; düşük < yüksek
    const sinirUygun = (r) => r.zararsiz.anlamSinir * 100 <= SINIR_GORUNME_SINIRI * r.zararsiz.n
    const kademeliIyi = (r, en) => !en || r.kriz.anlamKademeli > en.kriz.anlamKademeli || (r.kriz.anlamKademeli === en.kriz.anlamKademeli && r.zararsiz.anlamSinir < en.zararsiz.anlamSinir)
    const kumeYuksek = (kume) => (esik.kumeler[kume] && esik.kumeler[kume].esik) || esik.esik
    let dusuk = null
    let enD = olc(ayar, esik, null)
    for (const e of adimlar.filter((x) => x < esik.esik)) {
      for (const fark of FARKLAR) {
        const aday = { esik: e, fark, k: esik.k, kumeler: {} }
        const r = olc(ayar, esik, aday)
        if (sinirUygun(r) && kademeliIyi(r, enD)) { dusuk = aday; enD = r }
      }
    }
    if (dusuk) {
      for (const kume of Object.keys(yz.krizAnlam.ORNEKLER.kriz)) {
        for (const e of adimlar.filter((x) => x < kumeYuksek(kume))) {
          for (const fark of FARKLAR) {
            const aday = { ...dusuk, kumeler: { ...dusuk.kumeler, [kume]: { esik: e, fark } } }
            const r = olc(ayar, esik, aday)
            if (sinirUygun(r) && kademeliIyi(r, enD)) { dusuk = aday; enD = r }
          }
        }
      }
    }
    katman.dusuk = dusuk
    if (!dusuk) console.log('UYARI: düşük eşik bulunamadı; sınır satırı çalışmaz (her aday sınırı aşıyor ya da yakalamaya katkısı yok).')
    else {
      if (dusuk.esik >= esik.esik) console.log('UYARI: düşük eşik yüksek eşikten küçük değil.')
      // Küme başına etkin değerler: kümenin kendi değeri yoksa ortak değer
      const kumeDusuk = (kume) => (dusuk.kumeler[kume] && dusuk.kumeler[kume].esik) || dusuk.esik
      const esit = Object.keys(yz.krizAnlam.ORNEKLER.kriz).filter((kume) => kumeDusuk(kume) >= kumeYuksek(kume))
      if (esit.length) console.log('UYARI: şu kümelerde düşük eşik yüksekten küçük değil, sınır oluşmaz: ' + esit.join(', '))
    }
    console.log('Önerilen eşik:', JSON.stringify({ yuksek: esik, dusuk }))
    yaz('ayarlama seti (' + ayarDosyalari.map((f) => path.basename(f)).join(' + ') + ')', olc(ayar, esik, dusuk))
  }
  for (const v of veri) yaz(v.ad, olc(v.h, esik, ayarla ? katman.dusuk : undefined))
  console.log(`Liste sürümü ${yz.cocuk.KRIZ_SURUM}, örnek sürümü ${yz.krizAnlam.ORNEKLER.surum}`)
  return 0
}

if (require.main === module) ana(process.argv.slice(2)).then((k) => { process.exitCode = k }, (err) => { console.error(err.message); process.exitCode = 1 })

module.exports = { ana }
