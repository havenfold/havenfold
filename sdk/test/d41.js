// SPDX-License-Identifier: Apache-2.0
// D41: kap dışa aktarma akışla (yaz kancası): parçalar sınırlı, birleşince bayt kipindeki kapla aynı içerik
const test = require('brittle')
const b4a = require('b4a')
const S = require('..')
const A = require('../../core/records/test/helpers/family')

const HIZLI = { opslimit: 3, memlimit: 64 * 1024 * 1024 }
const PAROLA = 'yirmi-dort-karakterli-p'
const TA = b4a.toString(A.K_TUM_AILE, 'hex')

test('390 akışla: yaz verilince bytes yok, boy var; parçalar bir kap parçasından büyük değil; içerik bayt kipiyle aynı', async (t) => {
  const kayit = new S.RecordApi({ replika: A.replika(A.anaDefter(), A.K.husniye) })
  const dosya = kayit.attach({ bytes: b4a.alloc(150000, 5), mime: 'application/pdf', name: 'kilavuz.pdf' }).blobRef
  for (let i = 0; i < 200; i++) kayit.put(TA, null, 'yuva.defter.not', { baslik: 'Not ' + i, metin: 'y'.repeat(300), ...(i === 7 ? { belge: dosya } : {}) })
  const kap = new S.ExportApi({ kayit, kdf: HIZLI, gizliAlanlar: () => [], now: () => A.TS0 })
  const parcalar = []
  const r = await kap.export({ koleksiyonlar: [TA], parola: PAROLA, yaz: (b) => parcalar.push(b4a.from(b)) })
  t.absent('bytes' in r)
  t.alike([r.ogeSayisi, r.eksikDosya], [200, 0])
  t.is(r.boy, parcalar.reduce((a, b) => a + b.byteLength, 0))
  t.ok(parcalar.every((b) => b.byteLength <= 65536 + 17 + 4096 + 64), 'parçalar sınırlı')
  const akis = await kap.import({ bytes: b4a.concat(parcalar), parola: PAROLA })
  const bayt = await kap.import({ bytes: (await kap.export({ koleksiyonlar: [TA], parola: PAROLA })).bytes, parola: PAROLA })
  t.alike(akis.icerik, bayt.icerik, 'aynı içerik')
  t.is(akis.icerik.koleksiyonlar[0].kayitlar.length, 200)
  t.ok(b4a.equals(akis.dosyalar[0].bytes, b4a.alloc(150000, 5)))
})
