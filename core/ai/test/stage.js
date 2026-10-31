// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// RFC-0024 §5 (D16): kriz tespitinde kademeli cevap — tam, sınır, yok
const test = require('brittle')
const { krizAnlam: { KrizAnlam, ORNEKLER }, cocuk: k, asistan: { Asistan } } = require('..')
const { sahteGom } = require('./helpers/fake-embedding')

const ORNEK = 'artık var olmak istemiyorum' // örnek kümesindeki cümle: benzerlik 1
const UZAK = 'bugün hava çok güzel parka gidelim'

test('krizDuzeyi: liste tam; yüksek eşik tam; düşük ile yüksek arası sınır; altı yok', async (t) => {
  t.is(k.krizDuzeyi('ölmek istiyorum'), 'tam', 'liste')
  t.is(k.krizDuzeyi('kombi bozuk'), null)
  const yuksek = new KrizAnlam({ gom: sahteGom, esik: { esik: 0.5, fark: 0, k: 1 }, dusuk: { esik: 0.2, fark: 0, k: 1 } })
  t.is(k.krizDuzeyi(ORNEK, { anlam: await yuksek.skor(ORNEK) }), 'tam')
  const arada = new KrizAnlam({ gom: sahteGom, esik: { esik: 1.01, fark: 0, k: 1 }, dusuk: { esik: 0.5, fark: 0, k: 1 } })
  const r = await arada.skor(ORNEK)
  t.alike([r.kriz, r.sinir], [false, true])
  t.is(k.krizDuzeyi(ORNEK, { anlam: r }), 'sinir')
  t.is(k.krizMi(ORNEK, { anlam: r }), false, 'krizMi geriye uyumlu: yalnız tam')
  const dusuksuz = new KrizAnlam({ gom: sahteGom, esik: { esik: 1.01, fark: 0, k: 1 } })
  t.is((await dusuksuz.skor(ORNEK)).sinir, false, 'düşük eşik yoksa sınır yok')
  t.is(k.krizDuzeyi(UZAK, { anlam: await arada.skor(UZAK) }), null)
})

test('eşik tablosu: model girdisi { yuksek, dusuk }; eski tek eşikli biçim yüksek sayılır', (t) => {
  const MH = 'f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193'
  const a = new KrizAnlam({ gom: sahteGom, modelHash: MH })
  t.is(a.esik, ORNEKLER.esikler[MH].yuksek)
  t.is(a.dusuk, ORNEKLER.esikler[MH].dusuk)
  t.ok(a.dusuk.esik <= a.esik.esik, 'düşük eşik yükseğin altında')
  const v = new KrizAnlam({ gom: sahteGom })
  t.alike([v.esik, v.dusuk], [ORNEKLER.esikler.varsayilan, null], 'varsayılanda yalnız yüksek')
})

test('asistan: sınırda normal cevap ve yardım önerisi; geçmişe yazılmaz; tamda kriz akışı', async (t) => {
  let model = 0
  const gecmis = []
  const s = (esik, dusuk) => new Asistan({
    yetenek: { platform: { id: 'apple-fm', surum: '1', tr: true, baglamToken: 4096 }, isciler: [], bulut: { acik: false } },
    krizAnlam: new KrizAnlam({ gom: sahteGom, esik, dusuk }),
    model: async () => { model++; return { metin: 'Cevap.', model: 'telefon/apple-fm@1' } },
    gecmis: { ayar: 30, yaz: async (x) => gecmis.push(x) }
  })
  const c = await s({ esik: 1.01, fark: 0, k: 1 }, { esik: 0.5, fark: 0, k: 1 }).sor({ metin: ORNEK })
  t.absent(c.kriz)
  t.alike([c.metin, c.yardimOner, c.yardimSatiri], ['Cevap.', true, 'Zor bir şey mi yaşıyorsun?'])
  t.is(model, 1, 'normal yoldan cevaplandı')
  t.is(gecmis.length, 1)
  t.absent(JSON.stringify(gecmis[0]).includes('yardim'), 'sınır bilgisi geçmişe girmez')
  const n = await s({ esik: 1.01, fark: 0, k: 1 }, { esik: 1.01, fark: 0, k: 1 }).sor({ metin: UZAK })
  t.is(n.yardimOner, undefined)
  const tam = await s({ esik: 0.5, fark: 0, k: 1 }, { esik: 0.2, fark: 0, k: 1 }).sor({ metin: ORNEK })
  t.is(tam.kriz, true)
  t.is(model, 2, 'tam kriz akışında model çağrılmaz')
})

test('D18 (ölçüm 5): e5-small q8 eşikleri dosyada; ortakta ve her kümede düşük < yüksek', (t) => {
  const MH = 'f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193'
  const e = ORNEKLER.esikler[MH]
  t.alike([e.yuksek.esik, e.yuksek.fark, e.yuksek.k, e.dusuk.esik, e.dusuk.fark, e.dusuk.k], [0.895, 0.02, 3, 0.875, 0.005, 3])
  t.alike(e.yuksek.kumeler['ilac-zehir'], { esik: 0.93, fark: 0.005 })
  t.alike(e.dusuk.kumeler.zorbalik, { esik: 0.85, fark: 0.015 })
  t.is(ORNEKLER.surum, 6, 'örnek sürümü değişmedi')
  t.ok(e.dusuk.esik < e.yuksek.esik)
  const kumeler = Object.keys(ORNEKLER.kriz)
  for (const k of kumeler) {
    const y = (e.yuksek.kumeler[k] || {}).esik ?? e.yuksek.esik
    const d = (e.dusuk.kumeler[k] || {}).esik ?? e.dusuk.esik
    t.ok(d < y, k + ': ' + d + ' < ' + y)
  }
  t.alike(Object.keys(e.yuksek.kumeler).sort(), [...kumeler].sort(), 'her kümenin değeri var')
  t.ok(ORNEKLER.esikler.varsayilan.esik > 0 && !ORNEKLER.esikler.varsayilan.yuksek, 'varsayılan değişmedi')
})
