// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// RFC-0023 §2 anlam katmanı: belirlenimci sahte gömmeyle mantık, örnek kümelerinin ölçüm setlerinden ayrılığı,
// birleşim kuralı ve asistan akışı. Gerçek modelle ölçüm scripts/crisis-measure.js'tedir.
const test = require('brittle')
const { krizAnlam: { KrizAnlam, ORNEKLER }, cocuk: k, asistan: { Asistan }, metin: { N } } = require('..')
const SET = require('../../../protocol/vectors/crisis-set.json')
const EK = require('./helpers/crisis-extra.json')

// Sahte gömme: katlanmış metnin harf üçlüleri 256 boyuta karılır (FNV-1a). Anlam bilmez; yalnız mantığı sınar.
function sahteGom (metin) {
  const v = new Float32Array(256)
  const f = ' ' + k.katla(metin) + ' '
  for (let i = 0; i + 3 <= f.length; i++) {
    let h = 0x811c9dc5
    for (const ch of f.slice(i, i + 3)) h = Math.imul(h ^ ch.codePointAt(0), 0x01000193) >>> 0
    v[h % 256] += 1
  }
  return v
}

test('örnek kümeleri ölçüm setlerindeki cümleleri içermez; sürümlü', (t) => {
  const olcum = new Set([...SET.kriz, ...SET.zararsiz, ...EK.kriz, ...EK.zararsiz].map(N))
  const ornek = [...Object.values(ORNEKLER.kriz).flat(), ...ORNEKLER.zararsiz]
  t.alike(ornek.filter((x) => olcum.has(N(x))), [])
  t.ok(Number.isSafeInteger(ORNEKLER.surum))
  t.ok(ORNEKLER.esikler.varsayilan.esik > 0)
})

test('anlam katmanı: en yakın komşu, eşik ve fark', async (t) => {
  const a = new KrizAnlam({ gom: sahteGom, esik: { esik: 0.5, fark: 0.05, k: 1 } })
  const r1 = await a.skor('artık var olmak istemiyorum')
  t.is(r1.kriz, true, 'örneğin kendisi')
  t.is(r1.kume, 'olme-istegi')
  t.ok(Math.abs(r1.benzerlik - 1) < 1e-9)
  t.is((await a.skor('bu oyunda hep ölüyorum çok zor')).kriz, false, 'zararsız örnek')
  t.is((await a.skor('bugün hava çok güzel parka gidelim')).kriz, false, 'ilgisiz cümle eşiğin altında')
  const siki = new KrizAnlam({ gom: sahteGom, esik: { esik: 1.01, fark: 0, k: 1 } })
  t.is((await siki.skor('artık var olmak istemiyorum')).kriz, false, 'eşik geçilmezse kriz yok')
  let n = 0
  const sayan = new KrizAnlam({ gom: (m) => { n++; return sahteGom(m) } })
  await sayan.skor('a')
  await sayan.skor('b')
  t.is(n, Object.values(ORNEKLER.kriz).flat().length + ORNEKLER.zararsiz.length + 2, 'örnekler bir kez gömülür')
})

test('birleşim: anlam katmanı yalnız ekler', (t) => {
  t.is(k.krizMi('ölmek istiyorum', { anlam: { kriz: false } }), true, 'listenin tespiti kalmaz değil')
  t.is(k.krizMi('bugün hava güzel', { anlam: { kriz: true } }), true, 'anlam ekler')
  t.is(k.krizMi('bugün hava güzel', { anlam: { kriz: false } }), false)
  t.is(k.krizMi('bugün hava güzel', { anlam: true }), true)
})

test('asistan: anlam katmanının tespitinde model çağrılmaz, geçmişe yazılmaz', async (t) => {
  let model = 0
  const gecmis = []
  const s = new Asistan({
    yetenek: { platform: null, konusma: false, ocr: false, gomme: null, isciler: [], bulut: { acik: false, kalan: 0 } },
    krizAnlam: new KrizAnlam({ gom: sahteGom, esik: { esik: 0.5, fark: 0.05, k: 1 } }),
    model: async () => { model++; return { metin: 'x', model: 'm' } },
    gecmis: { ayar: 30, yaz: async (x) => gecmis.push(x) }
  })
  const c = await s.sor({ metin: 'artık var olmak istemiyorum' })
  t.is(c.kriz, true)
  t.is(model, 0)
  t.is(gecmis.length, 0)
})

test('inceleme 9: küme başına eşik ve gerçek model anahtarı; kümeler yeterince büyük', async (t) => {
  const MH = 'f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193'
  t.ok(ORNEKLER.esikler[MH], 'multilingual-e5-small q8 sha256 anahtarı')
  const e = new KrizAnlam({ gom: sahteGom, modelHash: MH }).esik
  t.is(e, ORNEKLER.esikler[MH].yuksek, 'yüksek eşik (değerler ölçüm 5, test/stage.js D18)')
  t.ok(Object.values(ORNEKLER.kriz).every((x) => x.length >= 40), 'küme başına ≥ 40 kriz')
  t.ok(ORNEKLER.zararsiz.length >= 300, '≥ 300 zararsız')
  const ornek = 'artık var olmak istemiyorum'
  const kapali = new KrizAnlam({ gom: sahteGom, esik: { esik: 0.5, fark: 0.05, k: 1, kumeler: { 'olme-istegi': { esik: 1.01 } } } })
  const r = await kapali.skor(ornek)
  t.is(r.kume === 'olme-istegi' ? r.kriz : false, false, 'o kümenin eşiği geçilmezse o küme tetiklemez')
  const acik = new KrizAnlam({ gom: sahteGom, esik: { esik: 1.01, fark: 0.05, k: 1, kumeler: { 'olme-istegi': { esik: 0.5 } } } })
  const r2 = await acik.skor(ornek)
  t.alike([r2.kriz, r2.kume], [true, 'olme-istegi'], 'yalnız o kümenin eşiği gevşek')
})
