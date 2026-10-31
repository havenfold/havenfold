// SPDX-License-Identifier: Apache-2.0
// D81: RFC-0032 SDK uçtan uca — RULE_WRITE (265) uymayan kuralda INVALID_RULE; biçim 2 akşam maması kuralı pencere
// bitince vaka önerir, mama gelince CASE_LIST (266) durumu 'cozuldu'.
const test = require('brittle')
const b4a = require('b4a')
const S = require('..')
const A = require('../../core/records/test/helpers/family')
const V = require('../../core/core/test/helpers/v21')

const hex = (b) => b4a.toString(b, 'hex')
const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const TA = hex(A.K_TUM_AILE)
const COKI = 'varlik:' + hex(V.VARLIK_KEDI)
const MIN = 60_000
const [PS, PE] = [1792414800000, 1792429200000] // 19 Ekim 2026 16:00–20:00 (utc_dk 180)
const BESLENME = { tur: 'yuva.pet.beslenme', v: 1, olay: true, yazar: 'ikisi', ozne: ['varlik'], alanlar: [], kapsam: 'topluluk', keep: 90, ozel: false }
const AKSAM = { bicim: 2, _subj: COKI, kosullar: [['yuva.pet.beslenme', 'yok', '', 0, 'gt', 0]], gun_saati: [960, 1200], utc_dk: 180, kapatan_olay: ['yuva.pet.beslenme'], eylem: 'vaka', onem: 1, aktif: true }

function kur () {
  const L = A.anaDefter()
  const saat = { t: PS - 3_600_000 }
  const now = () => saat.t
  const kayit = new S.RecordApi({ replika: A.replika(L, V.K.husniye, { now }) })
  const olay = new S.EventApi({ kayit, now })
  olay.registerType(BESLENME)
  return { saat, kayit, olay }
}

test('D81: kuralYaz uymayan kuralda INVALID_RULE; güncellemede birleşmiş hâl denetlenir', (t) => {
  const { olay } = kur()
  t.is(hataOf(() => olay.writeRule(TA, null, { ...AKSAM, gun: 9 })), 'INVALID_RULE')
  t.is(hataOf(() => olay.writeRule(TA, null, { ...AKSAM, kosullar: [['yuva.pet.beslenme', 'yok', '', 60, 'gt', 0]] })), 'INVALID_RULE')
  const id = olay.writeRule(TA, null, AKSAM)
  t.is(hataOf(() => olay.writeRule(TA, id, { eylem: 'sustur' })), 'INVALID_RULE', 'sustur + kapatan_olay')
  t.ok(olay.writeRule(TA, id, { onem: 2 }))
})

test('D81: biçim 2 vakası pencere bitince açılır, mama gelince cozuldu', (t) => {
  const { saat, kayit, olay } = kur()
  olay.writeRule(TA, null, AKSAM)
  saat.t = PE - 10 * MIN
  t.is(olay.evaluate(TA).yeni.length, 0, 'pencere bitmeden erken tetik yok')
  saat.t = PE + MIN
  const d = olay.evaluate(TA)
  t.is(d.yeni.length, 1)
  t.alike(d.yeni[0].alanlar.pencere, [PS, PE])
  kayit.put(TA, null, 'hf.vaka', d.yeni[0].alanlar)
  t.alike(olay.cases(TA).map((v) => v.durum), ['acik'])
  saat.t = PE + 12 * MIN
  olay.write(TA, 'yuva.pet.beslenme', { subj: COKI })
  const v = olay.cases(TA)
  t.alike(v.map((x) => [x.durum, x.cozen.neden, x.cozen.type]), [['cozuldu', 'kapatan', 'yuva.pet.beslenme']])
  t.is(olay.cases(TA, { durum: 'cozuldu' }).length, 1)
  t.is(olay.evaluate(TA).yazimlar.length, 0, 'çözülmüş vakada basamak yazılmaz')
})
