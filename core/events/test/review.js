// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D9: inceleme 1 bulguları, RFC-0006 (olay). Beklenen değerler elle yazılmıştır.
const test = require('brittle')
const b4a = require('b4a')
const { kayitIslemden, olayAlanlari, olayHatasi, kesintiKopyasi } = require('../event')
const R = require('../routine')
const Kr = require('../rule')
const Tr = require('../type')
const { degerlendir } = require('../engine')
const { kartlar } = require('../card')
const O = require('./helpers/event')

const { C, U, hex, T0, MIN, HOUR, DAY, defter, katalog, COKI, cihaz, kayit, K_OLAYLAR } = O
const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const buf = (h) => b4a.from(h, 'hex')
const kayitOf = (L, k) => kayitIslemden(L, buf(k.inner), buf(k.opId))
const ctxOf = (L, cid, ks) => ({ ledger: L, katalog: katalog(), collectionId: cid, kayitlar: ks.map((k) => kayitOf(L, k)) })
const yerelAn = (gun, dk) => gun * DAY + dk * MIN - 180 * MIN
const GUN = 20745

function yemek (L, kat, bugunSayi) {
  const ks = []
  for (let g = GUN - 14; g < GUN; g++) for (const dk of [480, 720, 1080, 1320]) ks.push(kayit(L, C.isci1, 'yuva.pet.beslenme', olayAlanlari(kat, 'yuva.pet.beslenme', { t: yerelAn(g, dk), subj: COKI, conf: 95 }), yerelAn(g, dk)))
  for (let i = 0; i < bugunSayi; i++) ks.push(kayit(L, C.isci1, 'yuva.pet.beslenme', olayAlanlari(kat, 'yuva.pet.beslenme', { t: yerelAn(GUN, 60 + i * 10), subj: COKI, conf: 95 }), yerelAn(GUN, 60 + i * 10)))
  return ks
}
const rutin = (L, yazar = U.kerem) => kayit(L, yazar, 'hf.rutin', { _subj: COKI, olay: 'yuva.pet.beslenme', olcu: 'sayi' }, yerelAn(GUN - 20, 0))

test('olay 2 (§11.5 a): cihazın yazdığı rutin, kural, kart ve not yok sayılır', (t) => {
  const L = defter()
  const kat = katalog()
  t.is(degerlendir(ctxOf(L, K_OLAYLAR, [...yemek(L, kat, 11), rutin(L, C.isci1)]), yerelAn(GUN, 200)).rutinler.length, 0)
  t.is(degerlendir(ctxOf(L, K_OLAYLAR, [...yemek(L, kat, 11), rutin(L)]), yerelAn(GUN, 200)).rutinler.length, 1)
  const kural = kayit(L, C.isci1, 'hf.kural', { _subj: COKI, kosullar: [['yuva.pet.beslenme', 'sayi', '', 60, 'ge', 1]], eylem: 'sustur' }, T0)
  t.is(degerlendir(ctxOf(L, K_OLAYLAR, [kural]), T0).kurallar.length, 0)
  const kart = kayitOf(L, kayit(L, C.isci1, 'hf.kart', { _subj: COKI, sessiz: [0, 1440] }, T0))
  t.is(kartlar([kart]).size, 0)
})

test('olay 3 (§11.5 b): vakanın önemi kayıttan değil kaynaktan; cihaz rutin vakası açamaz', (t) => {
  const L = defter()
  const kat = katalog()
  const ks = [...yemek(L, kat, 11), rutin(L)]
  const y = degerlendir(ctxOf(L, K_OLAYLAR, ks), yerelAn(GUN, 200)).yeni[0]
  t.is(y.alanlar.onem, 2)
  // Cihaz aynı vakayı önemi 0 (bilgi) olarak önceden bırakır: yok sayılır, vaka yine önerilir
  const sahte = kayit(L, C.isci1, 'hf.vaka', { ...y.alanlar, onem: 0, ilk: 1, son: 1 }, yerelAn(GUN, 190))
  const s = degerlendir(ctxOf(L, K_OLAYLAR, [...ks, sahte]), yerelAn(GUN, 200))
  t.is(s.vakalar.length, 0)
  t.is(s.yeni.length, 1)
  // Üyenin açılışında kayıttaki önem 0 olsa da durum kaynağın önemiyle (2): ilk 2, son 4
  const uye = kayit(L, U.kerem, 'hf.vaka', { ...y.alanlar, onem: 0, ilk: 1, son: 1 }, yerelAn(GUN, 190))
  const d = degerlendir(ctxOf(L, K_OLAYLAR, [...ks, uye]), yerelAn(GUN, 200)).vakalar[0]
  t.alike([d.onem, d.ilk, d.son], [2, 2, 4])
})

test('olay 4 (§11.5 c): kural geriye dönük vaka açmaz', (t) => {
  const L = defter()
  const kat = katalog()
  const evs = [1, 2, 3, 4, 5].map((g) => kayit(L, C.isci1, 'yuva.pet.beslenme', olayAlanlari(kat, 'yuva.pet.beslenme', { t: T0 - g * DAY, subj: COKI, conf: 95 }), T0 - g * DAY))
  // Kural bugün yazılır: geçmiş beş günün pencereleri değerlendirilmez
  const kural = kayit(L, U.kerem, 'hf.kural', { _subj: COKI, kosullar: [['yuva.pet.beslenme', 'sayi', '', 60, 'ge', 1]], eylem: 'vaka', onem: 2 }, T0)
  t.is(degerlendir(ctxOf(L, K_OLAYLAR, [kural, ...evs]), T0 + MIN).yeni.length, 0)
  // Eski kural: yalnız son 24 saatte biten pencere (dün) açılır, daha eskiler açılmaz
  const eski = kayit(L, U.kerem, 'hf.kural', { _subj: COKI, kosullar: [['yuva.pet.beslenme', 'sayi', '', 60, 'ge', 1]], eylem: 'vaka', onem: 2 }, T0 - 30 * DAY)
  t.is(degerlendir(ctxOf(L, K_OLAYLAR, [eski, ...evs]), T0 - DAY + 2 * HOUR).yeni.length, 1)
  // Pencerenin bitişinden 24 saat sonra yazılmış olay katkı vermez
  const gec = kayit(L, C.isci1, 'yuva.pet.beslenme', olayAlanlari(kat, 'yuva.pet.beslenme', { t: T0 - 2 * HOUR, subj: COKI, conf: 95 }), T0 + 23 * HOUR)
  t.is(degerlendir(ctxOf(L, K_OLAYLAR, [eski, gec]), T0 + 23 * HOUR).yeni.length, 0)
})

test('olay 5 ve 6 (§11.5 d): bastırılacak rutin vakası açılmaz; var olanın bastırması kayda yazılır', (t) => {
  const L = defter()
  const kat = katalog()
  const r0 = rutin(L)
  const ks = [...yemek(L, kat, 11), r0]
  const sustur = kayit(L, U.kerem, 'hf.kural', { _subj: COKI, kosullar: [['yuva.pet.beslenme', 'sayi', '', 1440, 'ge', 5]], eylem: 'sustur' }, yerelAn(GUN - 30, 0))
  const s = degerlendir(ctxOf(L, K_OLAYLAR, [...ks, sustur]), yerelAn(GUN, 200))
  t.is(s.yeni.length, 0, 'aday açılmaz')
  // Susturmadan önce açılmış vaka: bastırma kararı kayda yazılmak üzere döner
  const y = degerlendir(ctxOf(L, K_OLAYLAR, ks), yerelAn(GUN, 200)).yeni[0]
  const acilis = kayit(L, U.kerem, 'hf.vaka', y.alanlar, yerelAn(GUN, 200))
  const s2 = degerlendir(ctxOf(L, K_OLAYLAR, [...ks, sustur, acilis]), yerelAn(GUN, 205))
  t.is(s2.bastirmalar.length, 1)
  t.alike(s2.bastirmalar[0].alanlar, { bastirildi: true })
  t.ok(s2.vakalar[0].bastirilmis)
  // Kayda yazılmış bastırma, susturmanın dayandığı olaylar temizlense de kalır
  const yazili = kayit(L, U.kerem, 'hf.vaka', { ...y.alanlar, bastirildi: true }, yerelAn(GUN, 200))
  const s3 = degerlendir(ctxOf(L, K_OLAYLAR, [r0, yazili]), yerelAn(GUN, 300))
  t.ok(s3.vakalar[0].bastirilmis)
  t.is(s3.bastirmalar.length, 0)
  t.is(s3.yazimlar.length, 0)
})

test('olay 7: kaldırılmış ya da uzak geçmişteki kaynak kesinti saydırmaz', (t) => {
  const kaynaklar = R.kaynaklarOf([
    { t: 0, yazar: 'cihaz', authorHex: 'aa' },
    { t: 100 * DAY, yazar: 'cihaz', authorHex: 'bb' },
    { t: 100 * DAY, yazar: 'cihaz', authorHex: 'cc' }
  ], [100 * DAY, 101 * DAY], (id) => id !== 'cc')
  t.alike(kaynaklar, ['bb'])
})

test('olay 11: sureler tam 4 öğe; 13: _v türün sürümü; 21: hf. ve başka ad alanı kaydedilemez', (t) => {
  const L = defter()
  const k = (sureler) => Kr.kuralTanimi(kayitOf(L, kayit(L, U.kerem, 'hf.kural', { _subj: COKI, kosullar: [['a', 'sayi', '', 60, 'gt', 0]], sureler }, T0)))
  t.is(k([10, 20]), null)
  t.alike(k([10, 20, 30, 40]).sureler, [10, 20, 30, 40])
  const kat = katalog()
  kat.turKaydet({ tur: 'yuva.pet.agirlik', v: 2, olay: true, yazar: 'ikisi', ozne: ['varlik'], alanlar: [] })
  t.is(olayAlanlari(kat, 'yuva.pet.agirlik', { t: T0, subj: COKI })._v, 2)
  const ctx = { ledger: L, katalog: kat, col: L.collections.get(hex(K_OLAYLAR)), kayitlar: [] }
  const v1 = kayitOf(L, kayit(L, U.kerem, 'yuva.pet.agirlik', { ...olayAlanlari(kat, 'yuva.pet.agirlik', { t: T0, subj: COKI }), _v: 1 }, T0))
  t.is(olayHatasi(ctx, v1), 'VERSION_UNKNOWN')
  t.is(hataOf(() => kat.turKaydet({ tur: 'hf.sos', v: 1, olay: true, yazar: 'cihaz', ozne: ['uye'], alanlar: [] })), 'TYPE_NAME_FIELD')
  const yuva = new Tr.Katalog({ adAlani: 'yuva' })
  t.is(hataOf(() => yuva.turKaydet({ tur: 'mekan.stok.azaldi', v: 1, olay: true, yazar: 'uye', ozne: ['yer'], alanlar: [] })), 'TYPE_NAME_FIELD')
})

test('olay 10 (§11.5 e): kesinti kopyası içeriksiz ve vaka açmaz', (t) => {
  const L = defter()
  const kat = katalog()
  const f = kesintiKopyasi(kat, 'hf.device.offline', { t: T0, subj: 'uye:' + hex(U.kutu.memberId) })
  t.alike(Object.keys(f).sort(), ['_keep', '_scope', '_subj', '_t', '_v', 'kopya'])
  const k = kayit(L, U.kerem, 'hf.device.offline', f, T0)
  t.is(degerlendir(ctxOf(L, K_OLAYLAR, [k]), T0 + MIN).yeni.length, 0, 'kutu çevrimdışı kopyası olaylarda vaka açmaz')
  t.is(hataOf(() => kesintiKopyasi(kat, 'hf.sos', { t: T0, subj: cihaz(C.isci1) })), 'NO_TYPE')
})

test('olay 22: yalnız yok koşullu susturma kuralı tetiklenir', (t) => {
  const L = defter()
  const kural = Kr.kuralTanimi(kayitOf(L, kayit(L, U.kerem, 'hf.kural', { _subj: COKI, kosullar: [['yuva.pet.beslenme', 'yok', '', 60, 'gt', 0]], eylem: 'sustur' }, T0 - DAY)))
  t.is(Kr.susturmaPencereleri([kural], [], T0).length, 1)
  t.is(Kr.susturmaPencereleri([kural], []).length, 0)
})

// --- D-inceleme-4 -------------------------------------------------------------------------------------------------
const A = require('../../records/test/helpers/family')
const { kayitlarReplikadan } = require('../event')

test('inceleme 4 / 1: bastirildi yalnız rutin vakasında ve yalnız üyenin işleminden (Replika + degerlendir)', (t) => {
  const L = A.anaDefter()
  let simdi = A.TS0 + HOUR
  const now = () => simdi
  const hus = A.replika(L, A.K.husniye, { now })
  const ecem = A.replika(A.kopya(L), A.K.ecem, { now })
  A.teslim(hus, ecem)
  const TA = hex(A.K_TUM_AILE)
  const kat = katalog()
  const ctx = (r) => ({ ledger: r.ledger, katalog: kat, collectionId: A.K_TUM_AILE, kayitlar: kayitlarReplikadan(r, TA) })
  hus.put(TA, null, 'hf.sos', olayAlanlari(kat, 'hf.sos', { t: simdi, subj: 'uye:' + hex(A.K.husniye.memberId) }))
  simdi += MIN
  const y = degerlendir(ctx(hus), simdi).yeni[0]
  t.is(y.alanlar.kaynak, 'cekirdek:hf.sos')
  const vaka = hus.put(TA, null, 'hf.vaka', y.alanlar)
  A.teslim(hus, ecem)
  // Çocuk (koleksiyonun yazarı) acil vakanın açılış kaydına bastirildi yazar
  ecem.put(TA, vaka, '', { bastirildi: true })
  A.teslim(ecem, hus)
  t.is(hus.get(TA, vaka).fields.bastirildi, true, 'alan kayıtta')
  const s = degerlendir(ctx(hus), simdi + MIN)
  t.is(s.vakalar.length, 1)
  t.absent(s.vakalar[0].bastirilmis, 'çekirdek vakası bastırılamaz')
})

test('inceleme 4 / 1: rutin vakasında bastirildi cihazdan gelirse yok sayılır, üyeden gelirse geçerli', (t) => {
  const L = defter()
  const kat = katalog()
  const r0 = rutin(L)
  const ks = [...yemek(L, kat, 11), r0]
  const y = degerlendir(ctxOf(L, K_OLAYLAR, ks), yerelAn(GUN, 200)).yeni[0]
  const cihazdan = { ...kayitOf(L, kayit(L, U.kerem, 'hf.vaka', y.alanlar, yerelAn(GUN, 200))) }
  cihazdan.fields = { ...cihazdan.fields, bastirildi: true }
  cihazdan.uyeAlanlari = { ...cihazdan.tf } // bastirildi'yi bir cihaz yazdı: üye alanlarında yok
  const ctx = ctxOf(L, K_OLAYLAR, ks)
  t.absent(degerlendir({ ...ctx, kayitlar: [...ctx.kayitlar, cihazdan] }, yerelAn(GUN, 205)).vakalar[0].bastirilmis)
  const uyeden = { ...cihazdan, uyeAlanlari: { ...cihazdan.tf, bastirildi: true } }
  t.ok(degerlendir({ ...ctx, kayitlar: [...ctx.kayitlar, uyeden] }, yerelAn(GUN, 205)).vakalar[0].bastirilmis)
})

test('inceleme 4 / 2: cihazın açtığı kural vakası yalnız kuralın cihazlar listesindeki cihazdan', (t) => {
  const L = defter()
  const kat = katalog()
  const kosul = [['yuva.pet.litter.visit', 'sayi', '', 60, 'ge', 1]]
  const kural = kayit(L, U.kerem, 'hf.kural', { _subj: COKI, kosullar: kosul, eylem: 'vaka', onem: 2 }, T0 - DAY)
  const kuralC = kayit(L, U.kerem, 'hf.kural', { _subj: COKI, kosullar: kosul, eylem: 'vaka', onem: 2, cihazlar: [hex(C.isci1.memberId)] }, T0 - DAY + 1)
  const ac = (k) => {
    const kid = kayitOf(L, k).recordId
    const pb = Kr.pencereBasiOf(T0 + 1, 60)
    const a = require('../case').vakaAlanlari({ collectionId: K_OLAYLAR, kaynak: 'kural:' + kid, subj: COKI, yon: 0, onem: 2, ilk: 2, son: 4, pencereBasi: pb, pencereSonu: pb + 60 * MIN, t: T0 })
    return kayit(L, C.isci1, 'hf.vaka', a, T0)
  }
  t.is(degerlendir(ctxOf(L, K_OLAYLAR, [kural, ac(kural)]), T0 + MIN).vakalar.length, 0, 'listede olmayan cihaz')
  t.is(degerlendir(ctxOf(L, K_OLAYLAR, [kuralC, ac(kuralC)]), T0 + MIN).vakalar.length, 1, 'listedeki cihaz')
})

// --- Olay 2. kısım --------------------------------------------------------------------------------------------------
const M = require('../escalation')
const Zf = require('../envelope')
const { IsciMotoru } = require('../worker')

test('olay 1: yazar sınıfına uymayan hf.saklama motorun kayıtlarına girmez (Replika)', (t) => {
  const L = A.anaDefter()
  const hus = A.replika(L, A.K.husniye)
  const irem = A.replika(A.kopya(L), A.K.irem)
  A.teslim(hus, irem)
  const TA = hex(A.K_TUM_AILE)
  irem.put(TA, null, 'hf.saklama', { tur: '*', gun: 1 })
  A.teslim(irem, hus)
  t.is(kayitlarReplikadan(hus, TA).filter((k) => k.type === 'hf.saklama').length, 0)
  hus.put(TA, null, 'hf.saklama', { tur: '*', gun: 30 })
  t.is(kayitlarReplikadan(hus, TA).filter((k) => k.type === 'hf.saklama').length, 1)
})

test('olay 8: ekrandaki vaka seçime katılır; daha önemli yeni vaka eskisini kaldırır', (t) => {
  const me = 'aa'
  const d = (vaka, onem, ek = {}) => ({ vaka, subj: COKI, onem, sorumlu: [me], okuyucular: [me], gecerli: [[2, 0]], sahipli: false, kapali: false, bastirilmis: false, ...ek })
  const b = new M.Bildirimci({ me })
  t.alike(b.guncelle([d('05', 2)]), [{ eylem: 'goster', vaka: '05', basamak: 2, sira: 0, ses: true }])
  t.alike(b.guncelle([d('05', 2), d('06', 1)]), [], 'daha az önemli bekler')
  t.alike(b.guncelle([d('05', 2), d('06', 1), d('07', 3)]), [{ eylem: 'kaldir', vaka: '05' }, { eylem: 'goster', vaka: '07', basamak: 2, sira: 0, ses: true }])
})

test('olay 18 ve 19: ipucu sessiz saatte sessiz; gösterilen kayıtlar 365 günde düşer', (t) => {
  let simdi = T0
  const b = new M.Bildirimci({ me: 'aa', now: () => simdi })
  t.is(b.ipucu('01', 2, 0, true, '', { sessiz: true, onem: 2 }).ses, false)
  t.is(b.ipucu('02', 2, 0, true, '', { sessiz: true, onem: 3 }).ses, true)
  t.is(b.ipucu('03', 3, 0, true, '', { sessiz: true, onem: 2 }).ses, true)
  t.is(b.toJSON().length, 3)
  simdi += 366 * DAY
  t.alike(b.guncelle([]), [])
  t.is(b.toJSON().length, 0)
  t.is(new M.Bildirimci({ me: 'aa', gosterilen: ['01,2,0'] }).toJSON().length, 1, 'eski biçim okunur')
})

test('olay 9, 14, 16: işçi sessiz saate uyar, uye: öznesini çözer, kişinin bütün kimliklerine uyandırır', (t) => {
  const L = defter()
  const kat = katalog()
  let saat = T0
  const kural = kayitOf(L, kayit(L, U.kerem, 'hf.kural', { _subj: COKI, kosullar: [['yuva.pet.litter.visit', 'sayi', '', 60, 'ge', 1]], eylem: 'vaka', onem: 2 }, T0 - DAY))
  // Bütün gün sessiz: 3. basamak sessiz saat bitene kadar yazılmaz
  const m = new IsciMotoru({ ledger: L, collectionId: K_OLAYLAR, kurallar: [kural], sessiz: [0, 1439], utcDk: 180, now: () => saat })
  const ev = kayitOf(L, kayit(L, C.isci1, 'yuva.pet.litter.visit', olayAlanlari(kat, 'yuva.pet.litter.visit', { t: T0, subj: COKI, conf: 90 }), T0))
  const r = m.olay({ ...ev, t: T0, subj: COKI, type: ev.type, conf: 90, stamp: ev.stamp, fields: ev.fields })
  const u = r.find((x) => x.eylem === 'uyandir')
  t.ok(u.kimlikler.length >= u.kitle.length)
  saat = T0 + 2 * HOUR
  t.alike(m.tick(), [], 'sessiz saatte 3. basamak yok')
})

test('olay 15: VAKA_UYANDIR yalnız koleksiyonun yazarından', (t) => {
  const L = defter()
  const kapi = new Zf.UyandirmaKapisi({ ledger: L, me: hex(U.husniye.memberId), now: () => T0 })
  const z = (k) => Zf.encodeUyandir(L.familyId, { collectionId: O.K_EBEVEYN, vaka: b4a.alloc(16, 1), basamak: 2, sira: 0, onem: 2, baslik: '' }, k)
  t.ok(kapi.uyandir(z(U.kerem)).ok, 'ebeveyn yazar')
  // Tüm Aile: çocuk okuyucu ve yazar; Ebeveynler'de okuyucu değil. Olaylar'da İrem yazar; Ecem okuyucu değil.
  const kapi2 = new Zf.UyandirmaKapisi({ ledger: L, me: hex(U.husniye.memberId), now: () => T0 })
  const zo = (k) => Zf.encodeUyandir(L.familyId, { collectionId: K_OLAYLAR, vaka: b4a.alloc(16, 2), basamak: 2, sira: 0, onem: 2, baslik: '' }, k)
  t.ok(kapi2.uyandir(zo(U.irem)).ok)
  t.is(kapi2.uyandir(Zf.encodeUyandir(L.familyId, { collectionId: K_OLAYLAR, vaka: b4a.alloc(16, 3), basamak: 2, sira: 0, onem: 2, baslik: '' }, C.isci2)).neden, 'UNAUTHORIZED', 'yazar olmayan cihaz')
})
