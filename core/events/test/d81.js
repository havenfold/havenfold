// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D81: RFC-0032 birim testleri — INVALID_RULE (§14), işçi biçim 2'yi değerlendirmez (§5.5), çözülmüş vakada merdiven
// durur ve bildirim kalkar (§6.3), çözülmeyi düzeltme geri alınca bekleme düzeltme anından sayılır (§6.2).
const test = require('brittle')
const Kr = require('../rule')
const M = require('../escalation')
const { IsciMotoru } = require('../worker')
const O = require('./helpers/event')

const { COKI, defter, K_OLAYLAR, MIN } = O
const AKSAM = { bicim: 2, _subj: COKI, kosullar: [['yuva.pet.beslenme', 'yok', '', 0, 'gt', 0]], gun_saati: [960, 1200], utc_dk: 180, kapatan_olay: ['yuva.pet.beslenme'], eylem: 'vaka', onem: 1, aktif: true }

test('D81: INVALID_RULE durumları (RFC-0032 §14); geçerli biçim 1 ve 2', (t) => {
  t.is(Kr.kuralHatasi(AKSAM), null)
  t.is(Kr.kuralHatasi({ _subj: COKI, kosullar: [['yuva.pet.beslenme', 'sayi', '', 60, 'ge', 1]] }), null, 'biçim 1')
  t.is(Kr.kuralHatasi({ ...AKSAM, gun_saati: undefined, utc_dk: undefined, kapatan_olay: undefined }), null, 'varsayılanlar')
  const yanlis = {
    'biçim 2\'de pencere_dk ≠ 0': { ...AKSAM, kosullar: [['yuva.pet.beslenme', 'yok', '', 60, 'gt', 0]] },
    'biçim 1\'de gun_saati': { _subj: COKI, kosullar: [['yuva.pet.beslenme', 'sayi', '', 60, 'ge', 1]], gun_saati: [0, 60] },
    'biçim 1\'de kapatan_olay': { _subj: COKI, kosullar: [['yuva.pet.beslenme', 'sayi', '', 60, 'ge', 1]], kapatan_olay: ['yuva.pet.beslenme'] },
    'biçim 1\'de kesintide_ac': { _subj: COKI, kosullar: [['yuva.pet.beslenme', 'sayi', '', 60, 'ge', 1]], kesintide_ac: true },
    'biçim 1\'de gun': { _subj: COKI, kosullar: [['yuva.pet.beslenme', 'sayi', '', 60, 'ge', 1]], gun: 2 },
    'gun_saati 1440': { ...AKSAM, gun_saati: [960, 1440] },
    'gun 8': { ...AKSAM, gun: 8 },
    'gun 0': { ...AKSAM, gun: 0 },
    'utc_dk 841': { ...AKSAM, utc_dk: 841 },
    'utc_dk -721': { ...AKSAM, utc_dk: -721 },
    'kapatan_olay boş': { ...AKSAM, kapatan_olay: [] },
    'kapatan_olay 9 tür': { ...AKSAM, kapatan_olay: Array.from({ length: 9 }, (_, i) => 'yuva.pet.t' + i) },
    'kapatan_olay adı geçersiz': { ...AKSAM, kapatan_olay: ['Yuva.Pet'] },
    'sustur ile kapatan_olay': { ...AKSAM, eylem: 'sustur' },
    'bicim 3': { ...AKSAM, bicim: 3 },
    'pencere_dk 0 biçim 1': { _subj: COKI, kosullar: [['yuva.pet.beslenme', 'yok', '', 0, 'gt', 0]] }
  }
  for (const [ad, k] of Object.entries(yanlis)) t.is(Kr.kuralHatasi(k), 'INVALID_RULE', ad)
})

test('D81: işçi biçim 2 kuralını değerlendirmez (RFC-0032 §5.5)', (t) => {
  const L = defter()
  const kural = (fields, id) => ({ recordId: id, fields, tf: fields, stamp: { hlc: 0n } })
  const isci = new IsciMotoru({ ledger: L, collectionId: K_OLAYLAR, kurallar: [kural(AKSAM, 'a'.repeat(32)), kural({ _subj: COKI, kosullar: [['yuva.pet.beslenme', 'sayi', '', 60, 'ge', 1]] }, 'b'.repeat(32))] })
  t.alike(isci.kurallar.map((k) => k.id), ['b'.repeat(32)])
})

test('D81: çözülmüş vakada yeni basamak yok, ekrandaki bildirim kalkar; düzeltmeden sonra bekleme düzeltme anından', (t) => {
  const d = { vaka: 'v'.repeat(32), subj: COKI, onem: 1, ilk: 2, son: 2, t: 1000, gecerli: [], ulasilan: null, basamakAni: {}, sorumlu: ['a'], okuyucular: ['a'], sahipli: false, kapali: false, bastirilmis: false }
  t.ok(M.sonrakiYazim(d), 'açık vaka basamak yazar')
  t.is(M.sonrakiYazim({ ...d, cozuldu: true }), null)
  t.is(M.sonrakiYazim({ ...d, merdivenDurdu: true }), null)
  const d2 = { ...d, onem: 2, son: 4, gecerli: [[2, 0]], ulasilan: [2, 0], basamakAni: { '2,0': 1000 } }
  const once = M.sonrakiYazim(d2)
  const sonra = M.sonrakiYazim({ ...d2, yenidenBasla: 1000 + 60 * MIN })
  t.is(sonra.zaman - once.zaman, 60 * MIN, 'taban düzeltme anı')
  const b = new M.Bildirimci({ me: 'a', now: () => 2000 })
  const goster = b.guncelle([{ ...d, gecerli: [[2, 0]], ulasilan: [2, 0], sessiz: false, sos: false }])
  t.ok(goster.some((x) => x.eylem === 'goster'))
  t.alike(b.guncelle([{ ...d, gecerli: [[2, 0]], ulasilan: [2, 0], cozuldu: true }]), [{ eylem: 'kaldir', vaka: d.vaka }])
})
