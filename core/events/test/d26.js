// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// DP26 (inceleme 20, D81 bulguları): çözülme açılışla aynı olay kümesine bakar ve kapatan olay pencere bittikten sonra
// sayılır (B5); düzeltmeyle merdivenin durması düzeltmenin anına göre (B6); vakanın öznesi normalleştirilir (B7); aynı
// yerel gün için ikinci vaka yok (B8); biçim 1'e dönüşte null alanlar (B9); SOS alanları ilk işlemden (B3) ve afet
// bağıyla tek bildirim Bildirimci'de (B1).
const test = require('brittle')
const b4a = require('b4a')
const Kr = require('../rule')
const Mo = require('../engine')
const M = require('../escalation')
const { SosTekil, sosHatasi } = require('../sos')
const { olayAlanlari, kayitIslemden } = require('../event')
const O = require('./helpers/event')

const { U, MIN, HOUR, DAY, defter, COKI, uye, kayit, sifirla, K_OLAYLAR } = O
const GOZLEM = { tur: 'yuva.pet.gozlem', v: 1, olay: true, yazar: 'ikisi', ozne: ['varlik', 'uye'], alanlar: [], kapsam: 'topluluk', keep: 90, ozel: false }
const katalog = () => { const k = O.katalog(); k.turKaydet(GOZLEM); return k }
const S0 = 20745
const yerelAn = (gun, dk, utc = 180) => gun * DAY + dk * MIN - utc * MIN
const [S, E] = [yerelAn(S0, 960), yerelAn(S0, 1200)]
const AKSAM = { bicim: 2, _subj: COKI, kosullar: [['yuva.pet.beslenme', 'yok', '', 0, 'gt', 0]], gun_saati: [960, 1200], utc_dk: 180, kapatan_olay: ['yuva.pet.beslenme'], eylem: 'vaka', onem: 1, aktif: true }

function ortam (L = defter()) {
  sifirla()
  const kat = katalog()
  let n = 0
  const temiz = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined))
  const kural = (alanlar) => kayit(L, U.kerem, 'hf.kural', temiz(alanlar), yerelAn(S0 - 1, 0), { n: n++ })
  const olay = (t, { tur = 'yuva.pet.beslenme', subj = COKI, hlcMs = t, conf, kim = U.irem } = {}) => kayit(L, kim, tur, olayAlanlari(kat, tur, { t, subj, conf }), hlcMs, { n: n++ })
  const gorunum = (k) => kayitIslemden(L, b4a.from(k.inner, 'hex'), b4a.from(k.opId, 'hex'))
  const motor = (kayitlar, simdi, ledger = L) => Mo.degerlendir({ ledger, collectionId: K_OLAYLAR, katalog: kat, kayitlar: kayitlar.map(gorunum) }, simdi)
  // Vakayı açılış anında (an) üyenin telefonu yazmış olsun
  const vakaYaz = (kk, an, alanlar = null) => {
    const a = alanlar || motor([kk], an).yeni[0].alanlar
    return kayit(L, U.kerem, 'hf.vaka', { ...a, _t: an }, an, { n: n++ })
  }
  const duzelt = (hedef, an) => kayit(L, U.kerem, 'hf.olay.duzelt', { hedef: gorunum(hedef).recordId, gecersiz: true, _t: an }, an, { n: n++ })
  return { L, kural, olay, motor, vakaYaz, duzelt, gorunum }
}

test('DP26 B5: kapatan olay yalnız pencere bittikten sonra; pencere içindeki olay vakayı anında çözmez; belirsiz olay çözmez', (t) => {
  const o = ortam()
  // "Günde 2'den az mama" (sayi lt 2), kapatan mama: penceredeki tek mama vakayı açar ama çözmez
  const az = o.kural({ ...AKSAM, kosullar: [['yuva.pet.beslenme', 'sayi', '', 0, 'lt', 2]] })
  const tek = o.olay(S + HOUR)
  const r = o.motor([az, tek], E + MIN)
  t.is(r.yeni.length, 1, 'vaka açılır')
  const v = o.vakaYaz(az, E + MIN, r.yeni[0].alanlar)
  t.is(o.motor([az, tek, v], E + 2 * MIN).vakalar[0].cozuldu, false, 'penceredeki olay kapatan sayılmaz')
  const sonra = o.olay(E + 30 * MIN)
  t.alike(o.motor([az, tek, v, sonra], E + 40 * MIN).vakalar.map((x) => [x.cozuldu, x.cozen && x.cozen.neden]), [[true, 'kapatan']], 'pencereden sonra kapatır')
  // Kapatansız kural: güveni düşük (_conf 40) geç olay koşul yolundan da çözmez
  const o2 = ortam()
  const kapatansiz = o2.kural({ ...AKSAM, kapatan_olay: undefined })
  const v2 = o2.vakaYaz(kapatansiz, E + MIN)
  t.is(o2.motor([kapatansiz, v2, o2.olay(S + HOUR, { conf: 40, hlcMs: E + HOUR })], E + 2 * HOUR).vakalar[0].cozuldu, false, 'belirsiz olay çözmez')
  t.is(o2.motor([kapatansiz, v2, o2.olay(S + HOUR, { hlcMs: E + HOUR })], E + 2 * HOUR).vakalar[0].cozuldu, true, 'güvenli geç olay koşul yolundan çözer')
})

test('DP26 B6: vaka açılmadan önce düzeltilen kapatan olay merdiveni etkilemez; durma düzeltmenin anına göre', (t) => {
  const o = ortam()
  const k = o.kural(AKSAM)
  const kapatan = o.olay(E + 10 * MIN)
  // Kapatan olay vaka açılmadan düzeltildi (E + 20 dk), vaka E + 30 dk'da açıldı
  const v = o.vakaYaz(k, E + 30 * MIN, o.motor([k], E + 30 * MIN).yeni[0].alanlar)
  const d1 = o.motor([k, kapatan, o.duzelt(kapatan, E + 20 * MIN), v], E + HOUR).vakalar[0]
  t.alike([d1.cozuldu, d1.yenidenBasla ?? null, !!d1.merdivenDurdu], [false, null, false])
  // Vaka açıldıktan sonra E + 1 saatte düzeltildi; 30 saat sonra değerlendirilse de merdiven durmaz (düzeltme 24 saat içinde)
  const v2 = o.vakaYaz(k, E + MIN, o.motor([k], E + MIN).yeni[0].alanlar)
  const d2 = o.motor([k, kapatan, o.duzelt(kapatan, E + HOUR), v2], E + 30 * HOUR).vakalar[0]
  t.alike([d2.cozuldu, d2.yenidenBasla, !!d2.merdivenDurdu], [false, E + HOUR, false])
  // E + 25 saatte düzeltildi: merdiven yeniden başlamaz
  const d3 = o.motor([k, kapatan, o.duzelt(kapatan, E + 25 * HOUR), v2], E + 26 * HOUR).vakalar[0]
  t.is(!!d3.merdivenDurdu, true)
})

test('DP26 B7: telefon değişince eski kimlikle açılmış vaka yeni kimliğin kapatan olayıyla çözülür', (t) => {
  const o = ortam()
  const eski = O.hex(U.irem.memberId)
  const yeni = O.hex(U.kerem.memberId)
  // Eski telefon (İrem'in kimliği) yeni telefona (Kerem'in kimliğiyle temsil) geçmiş gibi: resolveMember eskiyi yeniye çözer
  const L2 = Object.create(o.L)
  L2.resolveMember = (id) => (id === eski ? yeni : o.L.resolveMember(id))
  const iyiyim = o.kural({ ...AKSAM, _subj: uye(U.irem), kosullar: [['yuva.pet.gozlem', 'yok', '', 0, 'gt', 0]], kapatan_olay: ['yuva.pet.gozlem'] })
  const v = o.vakaYaz(iyiyim, E + MIN)
  const ok = o.olay(E + 10 * MIN, { tur: 'yuva.pet.gozlem', subj: uye(U.kerem), kim: U.kerem })
  const d = o.motor([iyiyim, v, ok], E + 20 * MIN, L2).vakalar[0]
  t.alike([d.subj, d.cozuldu, d.cozen && d.cozen.neden], ['uye:' + eski, true, 'kapatan'])
})

test('DP26 B8: utc_dk değişince (yaz saati) aynı yerel günün penceresi ikinci vaka açmaz', (t) => {
  const o = ortam()
  const k = o.kural({ ...AKSAM, utc_dk: 120 })
  const kural = Kr.kuralTanimi(o.gorunum(k))
  // Vaka utc_dk 180 iken açılmıştı: pencere bir saat önce
  const [S180, E180] = [yerelAn(S0, 960, 180), yerelAn(S0, 1200, 180)]
  const a = { ...o.motor([k], yerelAn(S0, 1200, 120) + MIN).yeni[0].alanlar }
  const eskiAlan = require('../case').vakaAlanlari({ collectionId: K_OLAYLAR, kaynak: a.kaynak, subj: COKI, yon: 0, onem: 1, ilk: 2, son: 2, pencereBasi: S180, pencereSonu: E180, t: E180 + MIN })
  const v = o.vakaYaz(k, E180 + MIN, eskiAlan)
  t.is(Kr.pencereGunu(kural, S180), Kr.pencereGunu(kural, yerelAn(S0, 960, 120)), 'aynı yerel gün')
  t.is(o.motor([k, v], yerelAn(S0, 1200, 120) + MIN).yeni.length, 0, 'ikinci vaka yok')
  t.is(o.motor([k], yerelAn(S0, 1200, 120) + MIN).yeni.length, 1, 'vaka yokken açılır')
  t.is(Kr.pencereGunu(kural, yerelAn(S0 + 1, 960, 120)), Kr.pencereGunu(kural, yerelAn(S0, 960, 120)) + 1, 'ertesi gün ayrı')
})

test('DP26 B9: biçim 1\'e dönen kural null alanlarla geçerli', (t) => {
  const b1 = { _subj: COKI, kosullar: [['yuva.pet.beslenme', 'sayi', '', 60, 'ge', 1]] }
  t.is(Kr.kuralHatasi({ ...b1, bicim: null, gun_saati: null, gun: null, kapatan_olay: null, kesintide_ac: null }), null)
  t.is(Kr.kuralHatasi({ ...b1, gun_saati: [0, 60] }), 'INVALID_RULE', 'dolu alan yine geçersiz')
})

test('DP26 B3, B1: SOS alanları ilk işlemden; afet bağı kimlikle, işaret yalnız gösterilince; Bildirimci uygular', (t) => {
  const ilk = { _subj: 'uye:' + 'a'.repeat(32), yol: 'dugme' }
  t.is(sosHatasi({ fields: { ...ilk, metin: 'x'.repeat(65) }, tf: ilk, yazar: 'uye', authorHex: 'a'.repeat(32) }), null, 'sonraki put sayılmaz')
  t.is(sosHatasi({ fields: ilk, tf: { ...ilk, metin: 'x'.repeat(65) }, yazar: 'uye', authorHex: 'a'.repeat(32) }), 'SOS_METIN')
  const mid = 'ab'.repeat(16)
  const st = new SosTekil({ now: () => 1000 })
  t.ok(st.gosterilsinMi(mid, 'k1'))
  t.ok(st.gosterilsinMi(mid, 'k2'), 'sorgu işaretlemez')
  t.alike([st.bildir(mid, 'k1'), st.bildir(mid, 'k1'), st.bildir(mid, 'k2'), st.bildir(null)], [true, true, false, true])
  // Bildirimci: aynı afetin bildirimi gösterildiyse SOS vakası sessiz kalır, basamağı gösterilmiş sayılır
  const d = { vaka: 'v'.repeat(32), subj: 'grant:' + 'b'.repeat(32), onem: 3, ilk: 2, son: 4, t: 1000, gecerli: [[2, 0]], ulasilan: [2, 0], basamakAni: { '2,0': 1000 }, sorumlu: [], okuyucular: ['a'], sahipli: false, kapali: false, bastirilmis: false, sos: true, afetMid: mid, sessiz: false }
  const b = new M.Bildirimci({ me: 'a', now: () => 2000, sosTekil: st })
  t.alike(b.guncelle([d]), [])
  t.ok(b.gosterilen.has(d.vaka + ',2,0'))
  const st2 = new SosTekil({ now: () => 1000 })
  const b2 = new M.Bildirimci({ me: 'a', now: () => 2000, sosTekil: st2 })
  t.is(b2.guncelle([d]).filter((x) => x.eylem === 'goster').length, 1)
  t.absent(st2.bildir(mid, 'afet:m1'), 'vaka gösterildikten sonra afet mesajı sessiz')
})
