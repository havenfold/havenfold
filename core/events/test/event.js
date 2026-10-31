// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
const test = require('brittle')
const b4a = require('b4a')
const { seal: { sealEnvelope, openEnvelope }, pairs: { PairBook } } = require('@havenfold/core')
const Tr = require('../type')
const { kayitIslemden, olayHatasi, olayAlanlari, olaylar, kayitlarReplikadan, gunNumarasi, kesintiKopyasi } = require('../event')
const R = require('../routine')
const Kr = require('../rule')
const Vk = require('../case')
const M = require('../escalation')
const Zf = require('../envelope')
const { kartlar, notlar } = require('../card')
const { degerlendir } = require('../engine')
const { IsciMotoru } = require('../worker')
const O = require('./helpers/event')
const A = require('../../records/test/helpers/family')

const { C, U, hex, T0, MIN, HOUR, DAY, defter, katalog, COKI, uye, cihaz, kayit, K_OLAYLAR, K_EBEVEYN, K_TUM_AILE, K_KASA } = O
const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const buf = (h) => b4a.from(h, 'hex')
const kayitOf = (L, k) => kayitIslemden(L, buf(k.inner), buf(k.opId))
const ctxOf = (L, cid, ks) => ({ ledger: L, katalog: katalog(), collectionId: cid, col: L.collections.get(hex(cid)), kayitlar: ks.map((k) => kayitOf(L, k)) })
const yerelAn = (gun, dk) => gun * DAY + dk * MIN - 180 * MIN

// --- Tür ---------------------------------------------------------------------------------------------------------

test('tür: ad biçimi, hf. modülleri, tanım denetimi, katalog', (t) => {
  for (const ad of ['hf.device.offline', 'yuva.pet.litter.visit', 'mekan.stok.raf.azaldi', 'hf.vaka.basamak']) t.ok(Tr.adGecerli(ad), ad)
  for (const ad of ['hf', 'hf.yok.x', 'acme.pet.eat', 'Yuva.pet', 'yuva.pet.-x', 'yuva.a.b.c.d.e.f', 'yuva.' + 'a'.repeat(60)]) t.absent(Tr.adGecerli(ad), ad)
  const k = new Tr.Katalog()
  t.is(k.olaylar().length, 23) // 23: hf.aile-izni (RFC-0034 §4.4, D94)
  t.is(k.get('hf.sos').onem, 3)
  t.is(k.get('hf.device.offline').onem_kutu, 1)
  t.is(hataOf(() => k.turKaydet({ tur: 'yuva.pet.beslenme', v: 1, olay: true, yazar: 'robot', ozne: ['varlik'], alanlar: [] })), 'INVALID_TYPE')
  t.is(hataOf(() => k.turKaydet({ tur: 'yuva.pet.beslenme', v: 1, olay: true, yazar: 'cihaz', ozne: ['varlik'], alanlar: [{ ad: '_x', deger: 'int' }] })), 'INVALID_TYPE')
  t.is(k.turKaydet({ tur: 'yuva.pet.beslenme', v: 1, olay: true, yazar: 'cihaz', ozne: ['varlik'], alanlar: [] }).kapsam, 'topluluk')
})

// --- Olay kaydı ---------------------------------------------------------------------------------------------------

test('olay: yazma alanları — varsayılanlar, düşük güvende en çok 7 gün, yasak alanlar', (t) => {
  const kat = katalog()
  const f = olayAlanlari(kat, 'yuva.pet.beslenme', { t: T0, subj: COKI }, { miktar: 30 })
  t.alike(f, { _v: 1, _t: T0, _subj: COKI, _scope: 'topluluk', _keep: 90, miktar: 30 })
  t.is(olayAlanlari(kat, 'yuva.pet.beslenme', { t: T0, subj: COKI, conf: 40 })._keep, 7)
  t.is(olayAlanlari(kat, 'hf.wipe.done', { t: T0, subj: cihaz(C.isci1), conf: 30 })._keep, 7)
  t.absent('_keep' in olayAlanlari(kat, 'hf.wipe.done', { t: T0, subj: cihaz(C.isci1) }))
  t.is(hataOf(() => olayAlanlari(kat, 'yuva.pet.beslenme', { t: T0, subj: COKI }, { _gizli: 1 })), 'RESERVED_FIELD')
  t.is(hataOf(() => olayAlanlari(kat, 'yuva.pet.beslenme', { t: T0, subj: COKI }, { ic: { a: 1 } })), 'INVALID_FIELD_VALUE')
  t.is(hataOf(() => olayAlanlari(kat, 'yuva.pet.beslenme', { t: T0, subj: 'kedi' })), 'INVALID_FIELD_VALUE')
  t.is(hataOf(() => olayAlanlari(kat, 'yuva.pet.beslenme', { t: T0, subj: COKI, conf: 101 })), 'INVALID_FIELD_VALUE')
  t.is(hataOf(() => olayAlanlari(kat, 'hf.kart', { t: T0, subj: COKI })), 'NO_TYPE')
  t.is(gunNumarasi(1_792_359_000_000, 180), 20745)
})

test('olay: motor için geçerlilik koşulları (§4.5)', (t) => {
  const L = defter()
  const kat = katalog()
  const f = (ek = {}, urun = {}) => ({ ...olayAlanlari(kat, 'yuva.pet.beslenme', { t: T0, subj: COKI }, urun), ...ek })
  const h = (yazar, tur, alanlar, hlc = T0, cid = K_OLAYLAR, ek = []) => {
    const k = kayit(L, yazar, tur, alanlar, hlc)
    const ctx = ctxOf(L, cid, [k, ...ek])
    return olayHatasi(ctx, ctx.kayitlar[0])
  }
  t.is(h(U.kerem, 'yuva.pet.beslenme', f()), null)
  t.is(h(U.kerem, 'yuva.pet.beslenme', f({ _v: 2 })), 'VERSION_UNKNOWN')
  t.is(h(U.kerem, 'yuva.pet.beslenme', f({ _t: T0 + 6 * MIN })), 'GELECEK')
  t.is(h(U.kerem, 'yuva.pet.beslenme', f({ _t: T0 + 5 * MIN })), null)
  t.is(h(U.kerem, 'yuva.pet.beslenme', f({ _subj: uye(U.kerem) })), 'INVALID_SUBJECT') // tür varlık ister
  t.is(h(U.kerem, 'yuva.pet.beslenme', f({ _subj: 'varlik:' + 'ab'.repeat(16) })), 'INVALID_SUBJECT') // defterde yok
  t.is(h(U.kerem, 'yuva.pet.litter.visit', f()), 'INVALID_AUTHOR_CLASS') // yalnız cihaz yazar
  t.is(h(U.kerem, 'yuva.pet.beslenme', f({ _scope: 'kisisel' })), 'KAPSAM')
  t.is(h(U.kerem, 'yuva.pet.beslenme', f({ _conf: 150 })), 'INVALID_CONFIDENCE')
  t.is(h(U.kerem, 'yuva.pet.bilinmez', f()), 'NO_TYPE') // katalogda yok (§5.4)
  const ilac = { ...olayAlanlari(kat, 'yuva.defter.ilac', { t: T0, subj: uye(U.husniye) }) }
  t.is(h(U.kerem, 'yuva.defter.ilac', ilac), 'OZEL')
  t.is(h(U.kerem, 'yuva.defter.ilac', ilac, T0, K_EBEVEYN), null)
  t.is(h(U.kerem, 'yuva.pet.beslenme', f(), T0, K_KASA), 'KASA')
  t.is(h(U.kerem, 'yuva.pet.beslenme', f({ _subj: 'kayit:' + 'cd'.repeat(16) })), 'INVALID_SUBJECT')
})

test('olay: türü belirleyen işlemin _t ve _subj alanları sonradan değişmez (Replika)', (t) => {
  const L = A.anaDefter()
  let simdi = A.TS0
  const hus = A.replika(L, A.K.husniye, { now: () => simdi })
  const TA = hex(K_TUM_AILE)
  const rid = hus.put(TA, null, 'yuva.pet.beslenme', olayAlanlari(katalog(), 'yuva.pet.beslenme', { t: A.TS0 - MIN, subj: COKI }, { miktar: 1 }))
  simdi += MIN
  hus.put(TA, rid, '', { _t: A.TS0 - 30 * DAY, miktar: 2 })
  const ks = kayitlarReplikadan(hus, TA)
  t.is(ks[0].fields._t, A.TS0 - MIN, 'sonraki put _t\'yi değiştiremez (RFC-0019 §11.1 c)')
  t.is(ks[0].tf._t, A.TS0 - MIN)
  const ol = olaylar({ ledger: L, katalog: katalog(), col: L.collections.get(TA), kayitlar: ks })
  t.is(ol.sayilir[0].t, A.TS0 - MIN)
  t.is(ol.sayilir[0].fields.miktar, 2)
})

// --- Rutin ---------------------------------------------------------------------------------------------------------

test('rutin: tanım varsayılanları, geçersiz tanım, boşluk ölçüsü', (t) => {
  const L = defter()
  const r = R.rutinTanimi(kayitOf(L, kayit(L, U.kerem, 'hf.rutin', { _subj: COKI, olay: 'yuva.pet.beslenme', olcu: 'bosluk', pencereler: [[480, 1200]] }, T0)))
  t.alike([r.utc_dk, r.gecmis_gun, r.en_az_gun, r.k, r.en_dar, r.onem], [180, 28, 7, 3, 1, 2])
  t.is(R.rutinTanimi(kayitOf(L, kayit(L, U.kerem, 'hf.rutin', { _subj: COKI, olay: 'x', olcu: 'ortalama' }, T0))), null)
  t.is(R.rutinTanimi(kayitOf(L, kayit(L, U.kerem, 'hf.rutin', { _subj: COKI, olay: 'x', olcu: 'sayi', gecmis_gun: 90 }, T0))), null)
  t.is(R.rutinTanimi(kayitOf(L, kayit(L, U.kerem, 'hf.rutin', { _subj: COKI, olay: 'x', olcu: 'toplam' }, T0))), null)
  const ar = R.pencereAraligi(20745, [480, 1200], r)
  const ev = (dk) => ({ t: ar[0] + dk * MIN, fields: {} })
  t.is(R.olc(r, [ev(60), ev(100), ev(500)], ar), 400) // en uzun: 100 → 500
  t.is(R.olc(r, [], ar), 720)
  t.is(R.olc({ ...r, olcu: 'toplam', alan: 'g' }, [{ t: ar[0], fields: { g: 5 } }, { t: ar[0] + 1, fields: {} }], ar), 5)
})

// 14 gün günde 4 yemek; bugün 11 ya da 1
function yemekKayitlari (L, kat, bugunSayi, { conf = 95 } = {}) {
  const ks = []
  const gun = 20745
  for (let g = gun - 14; g < gun; g++) for (const dk of [480, 720, 1080, 1320]) ks.push(kayit(L, C.isci1, 'yuva.pet.beslenme', olayAlanlari(kat, 'yuva.pet.beslenme', { t: yerelAn(g, dk), subj: COKI, conf }), yerelAn(g, dk)))
  for (let i = 0; i < bugunSayi; i++) ks.push(kayit(L, C.isci1, 'yuva.pet.beslenme', olayAlanlari(kat, 'yuva.pet.beslenme', { t: yerelAn(gun, 60 + i * 10), subj: COKI, conf }), yerelAn(gun, 60 + i * 10)))
  ks.push(kayit(L, U.kerem, 'hf.rutin', { _subj: COKI, olay: 'yuva.pet.beslenme', olcu: 'sayi' }, yerelAn(gun - 20, 0)))
  return ks
}

test('motor: rutin sapması vaka açar (cok pencere sürerken, az pencere bitince); güven ve geç pencere', (t) => {
  const L = defter()
  const kat = katalog()
  const cok = degerlendir(ctxOf(L, K_OLAYLAR, yemekKayitlari(L, kat, 11)), yerelAn(20745, 200))
  const rv = cok.yeni.filter((y) => y.alanlar.kaynak.startsWith('rutin:'))
  t.is(rv.length, 1)
  t.alike([rv[0].alanlar.yon, rv[0].alanlar.deger, rv[0].alanlar.alt, rv[0].alanlar.ust], [1, 11, 3, 5])
  t.alike(rv[0].basamaklar, [[2, 0]])
  // Orta güvenli olaylar da sayılır, iki farklı _t yeter
  t.is(degerlendir(ctxOf(L, K_OLAYLAR, yemekKayitlari(L, kat, 11, { conf: 60 })), yerelAn(20745, 200)).yeni.length, 1)
  // az: yalnız pencere bitince
  const az = (an) => degerlendir(ctxOf(L, K_OLAYLAR, yemekKayitlari(L, kat, 1)), an).yeni.map((y) => y.alanlar.yon)
  t.alike(az(yerelAn(20745, 1439)), [])
  t.alike(az(yerelAn(20746, 10)), [2])
  // Pencerenin bitişinden 24 saat sonra o pencere için yeni vaka açılmaz (dünün, 20746'nın, az sapması açılır)
  const gec = degerlendir(ctxOf(L, K_OLAYLAR, yemekKayitlari(L, kat, 1)), yerelAn(20747, 1)).yeni.map((y) => y.alanlar.pencere[0])
  t.alike(gec, [yerelAn(20746, 0)])
  // Var olan vaka yeniden önerilmez
  const ks = yemekKayitlari(L, kat, 11)
  const y = degerlendir(ctxOf(L, K_OLAYLAR, ks), yerelAn(20745, 200)).yeni[0]
  ks.push(kayit(L, U.kerem, 'hf.vaka', y.alanlar, yerelAn(20745, 201)))
  const s = degerlendir(ctxOf(L, K_OLAYLAR, ks), yerelAn(20745, 205))
  t.is(s.yeni.length, 0)
  t.is(s.vakalar.length, 1)
  // Rutin durumu kartta: bugün 11, normal 3–5
  const r = R.rutinTanimi(ctxOf(L, K_OLAYLAR, ks).kayitlar.find((k) => k.type === 'hf.rutin'))
  const ol = olaylar(ctxOf(L, K_OLAYLAR, ks)).sayilir
  t.alike(R.rutinDurumu(r, ol, yerelAn(20745, 200))[0], { pencere: 0, olgun: true, gun: 14, m: 4, alt: 3, ust: 5, bugun: 11 })
})

test('motor: gerçek sorun günü öğrenmeye girmez', (t) => {
  const L = defter()
  const kat = katalog()
  const ks = yemekKayitlari(L, kat, 0)
  const ctx = ctxOf(L, K_OLAYLAR, ks)
  const r = R.rutinTanimi(ctx.kayitlar.find((k) => k.type === 'hf.rutin'))
  const ol = olaylar(ctx).sayilir
  t.is(R.ogren(r, ol, 20745, 0).gun, 14)
  t.is(R.ogren(r, ol, 20745, 0, { gercek: (g) => g === 20740 }).gun, 13)
})

// --- Kural ve çekirdek ------------------------------------------------------------------------------------------

test('kural: yok koşulu zamanla tetiklenir; gözlem kesintisinde tetiklenmez; yalnız yok güvenden muaf', (t) => {
  const L = defter()
  const kat = katalog()
  const kural = kayit(L, U.kerem, 'hf.kural', { _subj: COKI, kosullar: [['yuva.pet.beslenme', 'yok', '', 720, 'gt', 0]], eylem: 'vaka', onem: 2 }, T0 - 2 * DAY)
  const ev = kayit(L, C.isci1, 'yuva.pet.beslenme', olayAlanlari(kat, 'yuva.pet.beslenme', { t: T0 - 13 * HOUR, subj: COKI, conf: 95 }), T0 - 13 * HOUR)
  const s = degerlendir(ctxOf(L, K_OLAYLAR, [kural, ev]), T0)
  t.is(s.yeni.length, 1)
  t.is(s.yeni[0].alanlar.kaynak.slice(0, 6), 'kural:')
  t.is(degerlendir(ctxOf(L, K_OLAYLAR, [kural, ev]), T0 - 2 * HOUR).yeni.length, 0) // 11 saat
  // İşçi pencerenin %25'inden fazlasında çevrimdışı: kesintinin içeriksiz kopyası olaylar koleksiyonunda (§11.5 e)
  const off = kayit(L, U.kerem, 'hf.device.offline', kesintiKopyasi(kat, 'hf.device.offline', { t: T0 - 6 * HOUR, subj: cihaz(C.isci1) }), T0 - 6 * HOUR)
  t.is(degerlendir(ctxOf(L, K_OLAYLAR, [kural, ev, off]), T0).yeni.length, 0)
  // Ebeveynler'deki kesinti tek başına sayılmaz
  const offE = kayit(L, U.kerem, 'hf.device.offline', olayAlanlari(kat, 'hf.device.offline', { t: T0 - 6 * HOUR, subj: cihaz(C.isci1) }), T0 - 6 * HOUR)
  t.is(degerlendir({ ...ctxOf(L, K_OLAYLAR, [kural, ev]), kesintiOlaylari: olaylar(ctxOf(L, K_EBEVEYN, [offE])).sayilir }, T0).yeni.length, 1)
  t.is(hataOf(() => Kr.kuralTanimi(kayitOf(L, kayit(L, U.kerem, 'hf.kural', { _subj: COKI, kosullar: [['a', 'sayi', '', 2000, 'gt', 0]] }, T0)))), null)
  t.is(Kr.kuralTanimi(kayitOf(L, kayit(L, U.kerem, 'hf.kural', { _subj: COKI, kosullar: [['a', 'sayi', '', 2000, 'gt', 0]] }, T0))), null)
  t.absent(Kr.kuralTanimi(kayitOf(L, kayit(L, U.kerem, 'hf.kural', { _subj: COKI, kosullar: [['a', 'sayi', '', 60, 'gt', 0]], onem: 1, hizmet: true }, T0))).hizmet)
})

test('kural: * öznesi her özne için ayrı; ardışık tetikler aynı pencerede tek vaka', (t) => {
  const L = defter()
  const kat = katalog()
  const kural = kayit(L, U.kerem, 'hf.kural', { _subj: '*', kosullar: [['yuva.pet.litter.visit', 'sayi', '', 60, 'ge', 2]], eylem: 'vaka', onem: 2 }, T0 - DAY)
  const yer = 'varlik:' + hex(O.VARLIK_KEDI)
  const evs = [10, 20, 30].map((d) => kayit(L, C.isci1, 'yuva.pet.litter.visit', olayAlanlari(kat, 'yuva.pet.litter.visit', { t: Math.floor(T0 / HOUR) * HOUR + d * MIN, subj: yer, conf: 95 }), Math.floor(T0 / HOUR) * HOUR + d * MIN))
  const s = degerlendir(ctxOf(L, K_OLAYLAR, [kural, ...evs]), T0 + HOUR)
  t.is(s.yeni.length, 1)
  t.is(s.yeni[0].alanlar._subj, yer)
})

test('çekirdek kuralları: hf.sos acil (2 ve 3 birlikte, 5. basamak); kutu çevrimdışı duyuru; cihaz çevrimdışı bilgi', (t) => {
  const L = defter()
  const kat = katalog()
  const sos = kayit(L, U.irem, 'hf.sos', olayAlanlari(kat, 'hf.sos', { t: T0, subj: uye(U.irem) }), T0)
  const s = degerlendir(ctxOf(L, K_TUM_AILE, [sos]), T0 + MIN)
  t.is(s.yeni.length, 1)
  t.alike([s.yeni[0].alanlar.kaynak, s.yeni[0].alanlar.onem, s.yeni[0].alanlar.ilk, s.yeni[0].alanlar.son], ['cekirdek:hf.sos', 3, 2, 5])
  t.alike(s.yeni[0].basamaklar, [[2, 0], [3, 0]])
  const kutu = kayit(L, U.kerem, 'hf.device.offline', olayAlanlari(kat, 'hf.device.offline', { t: T0, subj: uye(U.kutu) }), T0)
  const isci = kayit(L, U.kerem, 'hf.device.offline', olayAlanlari(kat, 'hf.device.offline', { t: T0, subj: cihaz(C.isci1) }), T0)
  const e = degerlendir(ctxOf(L, K_EBEVEYN, [kutu, isci]), T0 + MIN)
  t.is(e.yeni.length, 1)
  t.is(e.yeni[0].alanlar._subj, uye(U.kutu))
  t.alike([e.yeni[0].alanlar.ilk, e.yeni[0].alanlar.son], [2, 2])
})

// --- Vaka ve merdiven ---------------------------------------------------------------------------------------------

test('vaka: anahtarı alanlarıyla tutmayan açılış ve tek sorumluda 4. basamak', (t) => {
  const L = defter()
  const pb = Kr.pencereBasiOf(T0, 180)
  const a = Vk.vakaAlanlari({ collectionId: K_OLAYLAR, kaynak: 'kural:' + '92'.repeat(16), subj: COKI, yon: 0, onem: 2, ilk: 2, son: 5, pencereBasi: pb, pencereSonu: pb + 180 * MIN, t: T0 })
  const bozuk = kayit(L, U.kerem, 'hf.vaka', { ...a, pencere: [pb + 1, pb + 180 * MIN] }, T0)
  t.absent(Vk.acilisGecerli(kayitOf(L, bozuk), K_OLAYLAR))
  t.ok(Vk.acilisGecerli(kayitOf(L, kayit(L, U.kerem, 'hf.vaka', a, T0)), K_OLAYLAR))
  t.alike(Vk.gecerliBasamaklar(2, 5, [[2, 0], [3, 0], [5, 0]], 1), [[2, 0], [3, 0], [5, 0]])
  t.alike(Vk.gecerliBasamaklar(2, 5, [[2, 0], [3, 0], [5, 0]], 2), [[2, 0], [3, 0]])
  t.alike(Vk.gecerliBasamaklar(2, 5, [[2, 0], [3, 0], [4, 0], [4, 1], [5, 0]], 2), [[2, 0], [3, 0], [4, 0], [5, 0]]) // (4,1) için 3. sorumlu yok
  t.alike(Vk.gecerliBasamaklar(2, 4, [[2, 0], [3, 0], [4, 1]], 3), [[2, 0], [3, 0]]) // sıra atlanmaz
  t.is(hataOf(() => Vk.kapatAlanlari(a.vaka, 'belki', T0)), 'INVALID_FIELD_VALUE')
})

test('merdiven: sessiz saat, sonraki basamak ve süreler, yazma sırası', (t) => {
  // 23:00–07:00 yerel (utc+3)
  const sessiz = [1380, 420]
  const an = (dk) => yerelAn(20745, dk)
  t.ok(M.sessizde(an(1430), sessiz))
  t.ok(M.sessizde(an(30), sessiz))
  t.absent(M.sessizde(an(420), sessiz))
  t.is(M.sessizBitisi(an(1430), sessiz), yerelAn(20746, 420))
  t.is(M.sessizBitisi(an(600), sessiz), an(600))
  const d = { onem: 2, ilk: 2, son: 5, t: an(600), sorumlu: ['a', 'b', 'c'], ulasilan: [2, 0], basamakAni: { '2,0': an(600) } }
  t.alike(M.sonrakiYazim(d), { basamak: 3, sira: 0, zaman: an(630) })
  t.alike(M.sonrakiYazim({ ...d, ulasilan: [3, 0], basamakAni: { '3,0': an(630) } }, { r: 2 }), { basamak: 4, sira: 0, zaman: an(694) })
  t.alike(M.sonrakiYazim({ ...d, ulasilan: [4, 0], basamakAni: { '4,0': an(690) } }), { basamak: 4, sira: 1, zaman: an(750) })
  t.alike(M.sonrakiYazim({ ...d, ulasilan: [4, 1], basamakAni: { '4,1': an(750) } }), { basamak: 5, sira: 0, zaman: an(810) })
  t.is(M.sonrakiYazim({ ...d, son: 4, ulasilan: [4, 1], basamakAni: { '4,1': an(750) } }), null)
  t.alike(M.sonrakiYazim({ ...d, sorumlu: ['a'], ulasilan: [3, 0], basamakAni: { '3,0': an(630) } }), { basamak: 5, sira: 0, zaman: an(690) })
  t.is(M.sonrakiYazim({ ...d, sahipli: true }), null)
  // Dikkatte 3. basamak sessiz saat bitene kadar yazılmaz; acilde ve sessiz_disi'de beklenmez
  const gece = { ...d, ulasilan: [2, 0], basamakAni: { '2,0': an(1400) } }
  t.is(M.sonrakiYazim(gece, { sessiz }).zaman, yerelAn(20746, 420))
  t.is(M.sonrakiYazim({ ...gece, onem: 3 }, { sessiz }).zaman, an(1400))
  t.is(M.sonrakiYazim(gece, { sessiz, sessizDisi: true }).zaman, an(1430))
  t.alike(M.sonrakiYazim(d, { sureler: [10, 20, 30, 40] }).zaman, an(610))

  const L = defter()
  const col = L.collections.get(hex(K_OLAYLAR))
  const sorumlu = M.sorumluListesi(L, col, [uye(U.irem)])
  const durum = { sorumlu, acanCihaz: false }
  t.is(M.yazmaSirasi(L, col, durum, hex(U.irem.memberId)), 0)
  t.is(M.yazmaSirasi(L, col, { ...durum, acanCihaz: true }, hex(U.irem.memberId)), 1)
  t.is(M.yazmaSirasi(L, col, durum, hex(U.ecem.memberId)), null) // okuyucu değil
  const okuyucular = M.okuyucuKisiler(L, col)
  t.alike(M.kitle(2, 0, { sorumlu, okuyucular }), okuyucular)
  t.alike(M.kitle(4, 0, { sorumlu, okuyucular }), [sorumlu[1]])
  const p = M.planlanacak({ onem: 2, ilk: 2, son: 4, t: an(600), sorumlu, ulasilan: [2, 0], basamakAni: { '2,0': an(600) } }, sorumlu[1], { okuyucular })
  t.alike(p, { basamak: 4, sira: 0, zaman: an(690) })
})

test('bildirim: aynı özneye tek bildirim (önemi yüksek olan), sessiz saatte 2. basamak sessiz, sahiplenince kaldırılır', (t) => {
  const me = 'aa'
  const d = (vaka, onem, ek = {}) => ({ vaka, subj: COKI, onem, sorumlu: [me], okuyucular: [me, 'bb'], gecerli: [[2, 0]], sahipli: false, kapali: false, bastirilmis: false, ...ek })
  const b = new M.Bildirimci({ me })
  const r = b.guncelle([d('02', 2), d('01', 3)])
  t.alike(r, [{ eylem: 'goster', vaka: '01', basamak: 2, sira: 0, ses: true }])
  // 01 ekrandayken aynı öznenin 02'si bekler (inceleme olay 8); 01 sahiplenince 02 gösterilir
  t.alike(b.guncelle([d('02', 2), d('01', 3)]), [])
  t.alike(b.guncelle([d('01', 3, { sahipli: true }), d('02', 2)]), [{ eylem: 'kaldir', vaka: '01' }, { eylem: 'goster', vaka: '02', basamak: 2, sira: 0, ses: true }])
  const s = new M.Bildirimci({ me })
  t.is(s.guncelle([d('03', 2, { sessiz: true })])[0].ses, false)
  t.is(s.guncelle([d('03', 2, { gecerli: [[2, 0], [3, 0]], sessiz: true })])[0].ses, true)
  t.alike(new M.Bildirimci({ me: 'cc' }).guncelle([d('04', 2)]), []) // kitlede değil
  t.alike(M.Bildirimci.prototype.toJSON.call(s).map(([k]) => k), ['03,2,0', '03,3,0'])
})

test('zarf: gönderen başına saatte en çok 30; mühür ctrl anahtarıyla', (t) => {
  const L = defter()
  let saat = T0
  const kapi = new Zf.UyandirmaKapisi({ ledger: L, me: hex(U.husniye.memberId), now: () => saat })
  const z = (i) => Zf.encodeUyandir(L.familyId, { collectionId: K_OLAYLAR, vaka: b4a.alloc(16, i), basamak: 2, sira: 0, onem: 2, baslik: '' }, U.kerem)
  for (let i = 0; i < 30; i++) t.ok(kapi.uyandir(z(i)).ok)
  t.is(kapi.uyandir(z(30)).neden, 'LIMIT_REACHED')
  saat += HOUR + 1
  t.ok(kapi.uyandir(z(30)).ok)
  t.is(kapi.uyandir(Zf.encodeUyandir(L.familyId, { collectionId: K_OLAYLAR, vaka: b4a.alloc(16, 99), basamak: 6, sira: 0, onem: 2, baslik: '' }, U.kerem)).neden, 'INVALID_MESSAGE')
  t.is(hataOf(() => Zf.encodeUyandir(L.familyId, { collectionId: K_OLAYLAR, vaka: b4a.alloc(16), basamak: 2, sira: 0, onem: 2, baslik: 'x'.repeat(121) }, U.kerem)), 'INVALID_MESSAGE')
  const kerem = new PairBook({ me: U.kerem, ledger: L }).get(hex(U.husniye.memberId))
  const hus = new PairBook({ me: U.husniye, ledger: L }).get(hex(U.kerem.memberId))
  const bytes = z(1)
  const id = b4a.alloc(16, 5)
  const box = sealEnvelope(kerem.pair, U.kerem.memberId, U.husniye.memberId, Zf.Z.VAKA_UYANDIR, bytes, id)
  t.alike(openEnvelope(hus.pair, U.kerem.memberId, U.husniye.memberId, Zf.Z.VAKA_UYANDIR, box, id), bytes)
})

// --- İşçi motoru ve kart --------------------------------------------------------------------------------------

test('işçi motoru: yalnız kendi olaylarıyla kural; vaka telefondakiyle aynı anahtar; VAKA_DUR ile durur', (t) => {
  const L = defter()
  const kat = katalog()
  let saat = T0
  const kural = kayitOf(L, kayit(L, U.kerem, 'hf.kural', { _subj: COKI, kosullar: [['yuva.pet.litter.visit', 'sayi', '', 60, 'ge', 3]], eylem: 'vaka', onem: 2 }, T0 - DAY))
  const m = new IsciMotoru({ ledger: L, collectionId: K_OLAYLAR, kurallar: [kural], sorumlu: { [COKI]: [uye(U.irem)] }, now: () => saat })
  const evler = [1, 2, 3].map((i) => kayit(L, C.isci1, 'yuva.pet.litter.visit', olayAlanlari(kat, 'yuva.pet.litter.visit', { t: T0 + i * MIN, subj: COKI, conf: 90 }), T0 + i * MIN))
  const ol = olaylar(ctxOf(L, K_OLAYLAR, evler)).sayilir.sort((a, b) => a.t - b.t)
  t.alike(m.olay(ol[0]), [])
  t.alike(m.olay(ol[1]), [])
  saat = T0 + 3 * MIN
  const r = m.olay(ol[2])
  t.alike(r.map((x) => x.eylem + ':' + (x.tur || x.basamak)), ['yaz:hf.vaka', 'yaz:hf.vaka.basamak', 'uyandir:2'])
  t.alike(r[2].kitle, M.okuyucuKisiler(L, L.collections.get(hex(K_OLAYLAR))))
  // Telefon motoru aynı olaylardan aynı vakayı bulur
  const tel = degerlendir(ctxOf(L, K_OLAYLAR, [kayit(L, U.kerem, 'hf.kural', kural.fields, T0 - DAY, { recordId: buf(kural.recordId) }), ...evler]), T0 + 4 * MIN)
  t.is(hex(tel.yeni[0].alanlar.vaka), hex(r[0].alanlar.vaka))
  saat = T0 + 33 * MIN
  const s = m.tick()
  t.alike(s.map((x) => x.eylem + ':' + (x.tur || x.basamak)), ['yaz:hf.vaka.basamak', 'uyandir:3'])
  t.alike(s[1].kitle, [hex(U.irem.memberId)])
  m.dur(r[0].alanlar.vaka)
  saat = T0 + 3 * HOUR
  t.alike(m.tick(), [])
  m.bitir()
  t.is(m.olaylar.length + m.vakalar.size, 0)
})

test('kart: asıl kart en küçük işlemli; kopyalar; elle notlar sıralı', (t) => {
  const L = defter()
  const a = kayit(L, U.kerem, 'hf.kart', { _subj: COKI, ad: 'Coki', sorumlu: [uye(U.irem)], sessiz: [1380, 420] }, T0)
  const b = kayit(L, U.husniye, 'hf.kart', { _subj: COKI, ad: 'Kedi' }, T0 + MIN)
  const n1 = kayit(L, U.irem, 'hf.kart.not', { _subj: COKI, _t: T0 + 2 * HOUR, metin: 'İlacını verdim', _keep: 365 }, T0 + 2 * HOUR)
  const n2 = kayit(L, U.irem, 'hf.kart.not', { _subj: COKI, _t: T0 + HOUR, metin: 'Mama bitti', _keep: 365 }, T0 + 2 * HOUR, { n: 1 })
  const ks = [b, a, n1, n2].map((k) => kayitOf(L, k))
  const kk = kartlar(ks).get(COKI)
  t.is(kk.kart.ad, 'Coki')
  t.alike(kk.kart.sessiz, [1380, 420])
  t.is(kk.kopyalar.length, 1)
  t.alike(notlar(ks, COKI).map((n) => n.metin), ['Mama bitti', 'İlacını verdim'])
})

test('saklama: düşük güvenli olay 8 gün sonra temizlenir; recordId mezara girer (Replika)', (t) => {
  const L = A.anaDefter()
  let simdi = A.TS0
  const hus = A.replika(L, A.K.husniye, { now: () => simdi })
  const TA = hex(K_TUM_AILE)
  const rid = hus.put(TA, null, 'yuva.pet.beslenme', olayAlanlari(katalog(), 'yuva.pet.beslenme', { t: A.TS0, subj: COKI, conf: 40 }))
  simdi += 8 * DAY
  hus.put(TA, null, 'yuva.defter.not', { m: 'M ilerler' })
  hus.temizle()
  t.is(hus.get(TA, rid), null)
  hus.put(TA, rid, '', { miktar: 1 })
  t.is(hus.get(TA, rid), null)
})
