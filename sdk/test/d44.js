// SPDX-License-Identifier: Apache-2.0
// D44 (inceleme 15 şüphelisi): kap dışa aktarmada yaz Promise dönerse beklenir (geri basınç). Beklenenler elle.
const test = require('brittle')
const b4a = require('b4a')
const S = require('..')
const A = require('../../core/records/test/helpers/family')

const HIZLI = { opslimit: 3, memlimit: 64 * 1024 * 1024 }
const PAROLA = 'yirmi-dort-karakterli-p'
const TA = b4a.toString(A.K_TUM_AILE, 'hex')

test('390 akış: yaz Promise dönerse bir sonraki parça o çözülmeden verilmez; kap tam ve açılır', async (t) => {
  const kayit = new S.RecordApi({ replika: A.replika(A.anaDefter(), A.K.husniye) })
  for (let i = 0; i < 300; i++) kayit.put(TA, null, 'yuva.defter.not', { baslik: 'Not ' + i, metin: 'z'.repeat(400) })
  const kap = new S.ExportApi({ kayit, kdf: HIZLI, gizliAlanlar: () => [] })
  let aktif = false
  let ust = 0
  const parcalar = []
  const r = await kap.export({
    koleksiyonlar: [TA],
    parola: PAROLA,
    yaz: (b) => {
      if (aktif) ust++
      aktif = true
      parcalar.push(b4a.from(b))
      return new Promise((resolve) => setTimeout(() => { aktif = false; resolve() }, 1))
    }
  })
  t.is(ust, 0, 'hiçbir yazım öncekinin üstüne binmedi')
  t.ok(parcalar.length > 2)
  t.is(r.boy, parcalar.reduce((a, b) => a + b.byteLength, 0))
  t.is((await kap.import({ bytes: b4a.concat(parcalar), parola: PAROLA })).icerik.koleksiyonlar[0].kayitlar.length, 300)
})
