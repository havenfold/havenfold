// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D83 adım 2 (RFC-0012 §17): sakla-ilet deposu ve atma sırası, kalıcılık, gönderim ve taşıyıcı sınırları, benzetimli bağla
// eşitleme: kim taşır, misafir kuralları, pil kuralı, komşu kotası, oturumun bitişi ve kapanması.
const test = require('brittle')
const b4a = require('b4a')
const M = require('../message')
const T = require('../derivation')
const { Depo, SINIR } = require('../store')
const { Gonderim, Komsular, YENIDEN_ESITLE } = require('../limit')
const { cerceve } = require('../engine')
const { bagla } = require('../simulation')
const { ZINCIR, KIMLIK, defter, ciftler, cihaz, yapay } = require('./helpers/disaster-vector')

const hex = (b) => b4a.toString(b, 'hex')
const SN = 1000
const DK = 60 * SN
const GUN = 20750
const AN = GUN * 86_400_000 + 15 * 3_600_000
const L = defter(ZINCIR)
const id = (ad) => KIMLIK[ad].memberId

function aile (adlar, o = {}) {
  const s = { t: AN }
  const saat = () => s.t
  const c = {}
  for (const ad of adlar) c[ad] = cihaz(L, ad, saat)
  if (o.pil) for (const [ad, p] of Object.entries(o.pil)) c[ad].pil = () => p
  const bag = (a, b) => bagla(c[a].oturum(id(b)), c[b].oturum(id(a)))
  return { c, s, bag }
}

test('depo: bayt sınırı, süresi geçen ve teslim edilen önce atılır', (t) => {
  const d = new Depo({ sinir: { ...SINIR, adet: 3, bayt: 10_000 } })
  const eski = { ...yapay(1, 3, GUN), expiresDay: GUN - 1 }
  d.tasi(eski, GUN)
  d.tasi(yapay(2, 0, GUN), GUN)
  d.tasi(yapay(3, 0, GUN), GUN)
  t.alike(d.tasi(yapay(4, 0, GUN), GUN), [hex(eski.mid)], 'süresi geçen ilk atılır')
  // teslim bilgisi bilinen mesaj (aynı mid başka yoldan teslim edildi) önce atılır
  d.teslim.set(hex(yapay(3, 0, GUN).mid), { doneSecret: b4a.alloc(32), gun: GUN, kaynak: null })
  t.alike(d.tasi(yapay(5, 1, GUN), GUN), [hex(yapay(3, 0, GUN).mid)])
  t.alike(d.tasi(yapay(5, 1, GUN), GUN), [], 'bilinen mid yeniden eklenmez')
  const b = new Depo({ sinir: { ...SINIR, bayt: 200 } })
  b.tasi(yapay(1, 3, GUN), GUN)
  t.alike(b.tasi(yapay(2, 3, GUN), GUN), [hex(yapay(1, 3, GUN).mid)], '512 KB yerine küçük bayt sınırında en eski METİN')
})

test('depo: kalıcılık, temizleme, boşaltma', async (t) => {
  const kayit = new Map()
  const saklama = { get: (k) => kayit.get(k), set: (k, v) => kayit.set(k, JSON.parse(JSON.stringify(v))) }
  const { c, bag } = aile(['kerem', 'irem', 'husniye'])
  c.kerem.depo = new Depo({ saklama })
  const r = c.kerem.gonder({ to: id('husniye'), kind: M.KIND.SOS, text: 'Yardım', konum: { latE5: 4101234, lonE5: 2898765, accM: 5, at: AN } })
  c.husniye.depo = new Depo({ saklama: { get: () => null, set () {} } })
  bag('kerem', 'irem')
  bag('irem', 'husniye')
  t.is(c.husniye.depo.gelen[0].ic.konum.latE5, 4101234)
  bag('husniye', 'irem')
  bag('irem', 'kerem')
  t.absent(saklama.get('afet/depo')?.giden?.[0]?.teslim, 'yazım turun sonuna toplanır (B11)')
  c.kerem.depo.kaydet()
  const yeni = new Depo({ saklama })
  t.ok(yeni.giden.get(r.mid).teslim, 'teslim bilgisi yeniden başlamada durur')
  // Codex 6. tur: teslim edilen giden teslimden sonra 7 gün durur (gönderen alındıyı görür), sonra temizlenir
  const tg = yeni.giden.get(r.mid).teslimGun
  t.ok(Number.isInteger(tg), 'teslim günü')
  const t1 = new Depo({ saklama })
  t1.temizle(tg + 3)
  t.ok(t1.giden.get(r.mid)?.teslim, 'temizlikten sonra da teslim bilgisi')
  t1.temizle(tg + 8)
  t.absent(t1.giden.has(r.mid), '7 günden sonra temizlenir')
  // Codex 7. tur: eski biçimde (teslim günü yok) teslim kaydı ilk temizlikte gün alır, 7 gün sonra gider
  const t3 = new Depo({ saklama })
  delete t3.giden.get(r.mid).teslimGun
  t3.temizle(tg + 100)
  t.is(t3.giden.get(r.mid)?.teslimGun, tg + 100, 'göç günü yazıldı')
  t3.temizle(tg + 101)
  t.ok(t3.giden.has(r.mid))
  t3.temizle(tg + 108)
  t.absent(t3.giden.has(r.mid), 'eski kayıt da sonlu sürede gider')
  t.is(yeni.gelen[0].ic.kind, M.KIND.ALINDI)
  t.alike(yeni.gelen[0].ic.ref, b4a.from(r.mid, 'hex'))
  t.is(yeni.sira, c.kerem.depo.sira)
  // taşınan ve görülen de kalıcı
  const t2 = new Depo({ saklama })
  t2.tasi(yapay(9, 3, GUN), GUN, 'aa')
  await Promise.resolve()
  t.is(new Depo({ saklama }).tasinan.get(hex(yapay(9, 3, GUN).mid)).kaynak, 'aa')
  t2.temizle(GUN + 8)
  t.is(t2.giden.size, 0, 'teslim edilen giden temizlenir')
  t.is(t2.tasinan.size, 0, 'süresi geçen taşınan temizlenir')
  t.is(t2.teslim.size, 0)
  t.is(t2.gorulen.size, 0)
  t2.tasi(yapay(10, 3, GUN + 8), GUN + 8)
  t2.bosalt()
  t.is(t2.tasinan.size, 0)
  t.is(new Depo({ saklama: { get: () => ({ v: 9 }), set () {} } }).tasinan.size, 0, 'bilinmeyen sürüm yüklenmez')
  t.is(t2.al('yok'), null)
})

test('sınırlar: METİN saatte 30, UYARI dakikada 1, komşu kotası, yeniden eşitleme', (t) => {
  const g = new Gonderim()
  const to = 'ab'
  for (let i = 0; i < 30; i++) { t.is(g.izin(M.KIND.METIN, to, AN + i * 15 * SN), null); g.kaydet(M.KIND.METIN, to, AN + i * 15 * SN) }
  const e = g.izin(M.KIND.METIN, to, AN + 30 * 15 * SN)
  t.is(e.neden, 'DISASTER_SEND_LIMIT')
  t.is(e.bekleMs, 60 * DK - 30 * 15 * SN, 'pencerenin ilk gönderimi düşünce açılır')
  t.is(g.izin(M.KIND.METIN, to, AN + 60 * DK), null)
  g.kaydet(M.KIND.UYARI, to, AN)
  t.ok(g.izin(M.KIND.UYARI, 'cd', AN + 59 * SN), 'UYARI cihaz başına, alıcıdan bağımsız')
  g.kaydet(M.KIND.ALINDI, to, AN)
  t.is(g.gecmis.has(String(M.KIND.ALINDI)), false)
  const k = new Komsular()
  for (let i = 0; i < 100; i++) t.ok(k.kabulEt('x', AN + i))
  t.absent(k.kabulEt('x', AN + 200))
  t.is(k.kalan('x', AN + 10 * DK + 100), 100, '10 dk sonra kota yenilenir')
  t.ok(k.esitlemeGerekli('x', 1, AN))
  k.esitlendi('x', 1, AN)
  t.absent(k.esitlemeGerekli('x', 1, AN + DK))
  t.ok(k.esitlemeGerekli('x', 2, AN + DK), 'yeni mesaj varsa hemen')
  t.ok(k.esitlemeGerekli('x', 1, AN + YENIDEN_ESITLE))
})

test('gönderme: tür, alıcı ve hız denetimi', (t) => {
  const { c, s } = aile(['kerem', 'isci1', 'misafir1', 'kutu'])
  t.exception(() => c.isci1.gonder({ to: id('husniye'), kind: M.KIND.METIN, text: 'x' }), /DISASTER_CANNOT_SEND/, 'işçi yalnız UYARI')
  t.exception(() => c.kutu.gonder({ to: id('husniye'), kind: M.KIND.METIN, text: 'x' }), /DISASTER_CANNOT_SEND/, 'kutu göndermez')
  t.exception(() => c.kerem.gonder({ to: id('kutu'), kind: M.KIND.METIN, text: 'x' }), /DISASTER_CANNOT_SEND/, 'kutu almaz')
  t.exception(() => c.misafir1.gonder({ to: id('misafir1'), kind: M.KIND.METIN, text: 'x' }), /DISASTER_CANNOT_SEND/, 'misafir yalnız üyelere')
  t.exception(() => c.isci1.gonder({ to: id('misafir1'), kind: M.KIND.UYARI, text: 'x', alarm: { kind: 'deprem', level: 1, nearby: [] } }), /DISASTER_CANNOT_SEND/, 'misafir yalnız üyelerden alır')
  const ciftler = c.kerem.ciftler
  c.kerem.ciftler = () => []
  t.exception(() => c.kerem.gonder({ to: id('husniye'), kind: M.KIND.METIN, text: 'x' }), /NO_DISASTER_PAIR/, 'çifti olmayan üyeye')
  c.kerem.ciftler = ciftler
  t.exception(() => c.kerem.gonder({ to: id('uc1'), kind: M.KIND.METIN, text: 'x' }), /DISASTER_CANNOT_SEND/, 'çıkarılmış cihaza')
  c.kerem.gonder({ to: id('husniye'), kind: M.KIND.METIN, text: 'Bir' })
  try { c.kerem.gonder({ to: id('husniye'), kind: M.KIND.METIN, text: 'İki' }); t.fail() } catch (e) {
    t.is(e.message, 'DISASTER_SEND_LIMIT')
    t.is(e.bekleMs, 15 * SN)
  }
  s.t += 15 * SN
  t.ok(c.kerem.gonder({ to: id('husniye'), kind: M.KIND.METIN, text: 'İki' }).mid)
  t.ok(c.isci1.gonder({ to: id('husniye'), kind: M.KIND.UYARI, text: 'deprem', alarm: { kind: 'deprem', level: 4, nearby: [] } }).mid)
  t.is(c.misafir1.tur, 'misafir')
  t.ok(c.misafir1.gonder({ to: id('kerem'), kind: M.KIND.IYIYIM, text: 'İyiyiz' }).mid)
})

test('eşitleme: kutu ve işçi taşır ama almaz; işçinin UYARI\'sı kutu üzerinden ulaşır, teslim bilgisi işçiye döner', (t) => {
  const { c, bag } = aile(['isci1', 'kutu', 'husniye'])
  const r = c.isci1.gonder({ to: id('husniye'), kind: M.KIND.UYARI, text: 'deprem', alarm: { kind: 'deprem', level: 5, nearby: [id('irem')] } })
  t.ok(bag('isci1', 'kutu').bitti)
  t.is(c.kutu.depo.tasinan.size, 1)
  t.is(c.kutu.etiketlerim().size, 0, 'kutu alıcı değil')
  bag('kutu', 'husniye')
  t.is(c.husniye.depo.gelen[0].ic.alarm.kind, 'deprem')
  t.is(c.kutu.depo.tasinan.has(r.mid), false, 'teslim bilgisi aynı oturumda kutudan siler')
  t.is(c.kutu.depo.tasinan.size, 0, 'işçiye ALINDI gönderilmez (yalnız teslim bilgisi)')
  bag('kutu', 'isci1')
  t.ok(c.isci1.depo.giden.get(r.mid).teslim, 'işçi yalnız kendi UYARI\'sının teslim bilgisini alır')
  t.is(c.isci1.depo.gelen.length, 0)
})

test('eşitleme: misafir taşımaz; misafire yalnız taşıyıcının ona yazdığı mesajlar ve kendi bıraktıklarının teslimi gider', (t) => {
  const { c, s, bag } = aile(['kerem', 'irem', 'husniye', 'misafir1'])
  c.irem.gonder({ to: id('husniye'), kind: M.KIND.METIN, text: 'İrem → Hüsniye' })
  const k = c.kerem.gonder({ to: id('misafir1'), kind: M.KIND.METIN, text: 'Kerem → misafir' })
  bag('irem', 'kerem') // Kerem İrem'in mesajını taşır
  t.is(c.kerem.depo.tasinan.size, 1)
  bag('kerem', 'misafir1')
  t.is(c.misafir1.depo.tasinan.size, 0, 'misafir taşımaz')
  t.alike(c.misafir1.depo.gelen.map((x) => x.ic.text), ['Kerem → misafir'])
  t.is(c.kerem.depo.giden.get(k.mid).teslim, true)
  // misafirin mesajı Kerem'e bırakılır, Hüsniye'ye ulaşır; teslim bilgisi misafire döner
  s.t += DK
  const m = c.misafir1.gonder({ to: id('kerem'), kind: M.KIND.SOS, text: 'Çocuklar yanımda' })
  bag('misafir1', 'irem')
  t.is(c.irem.depo.tasinan.get(m.mid).kaynak, hex(id('misafir1')))
  bag('irem', 'kerem')
  t.ok(c.kerem.depo.gelen.some((x) => x.ic.text === 'Çocuklar yanımda'))
  t.ok(c.irem.depo.teslim.has(m.mid))
  // İrem'in misafire verdiği DONE: yalnız misafirin bıraktığı mesaj; İrem'in kendi trafiği gitmez
  const o = c.irem.oturum(id('misafir1'))
  const done = o.basla().filter((x) => x[0] === M.Z.AFET_DONE).flatMap((x) => M.coz(x[0], x.subarray(1)).items.map((i) => hex(i.mid)))
  t.ok(done.includes(m.mid))
  t.ok(done.every((x) => c.misafir1.depo.giden.has(x)), 'hepsi misafirin kendi mesajı (SOS ve ALINDI)')
  t.ok(c.irem.depo.teslim.size > done.length, 'İrem başka teslimler de biliyor')
  bag('irem', 'misafir1')
  t.ok(c.misafir1.depo.giden.get(m.mid).teslim)
})

test('eşitleme: pil %15 altında taşıyıcı yalnız SOS, UYARI ve İYİYİM kabul eder', (t) => {
  const { c, s, bag } = aile(['kerem', 'irem'], { pil: { irem: 10 } })
  c.kerem.gonder({ to: id('husniye'), kind: M.KIND.METIN, text: 'Metin' })
  c.kerem.gonder({ to: id('husniye'), kind: M.KIND.IYIYIM, text: 'İyiyim' })
  s.t += 1
  c.kerem.gonder({ to: id('husniye'), kind: M.KIND.SOS, text: 'SOS' })
  bag('kerem', 'irem')
  t.alike([...c.irem.depo.tasinan.values()].map((x) => x.m.prio).sort(), [0, 2])
})

test('eşitleme: komşudan 10 dakikada en çok 100 yeni mesaj; HAVE 64 öğede bölünür', (t) => {
  const { c, bag } = aile(['kerem', 'irem'])
  for (let i = 0; i < 130; i++) c.kerem.depo.tasi(yapay(i + 1, 3, GUN), GUN)
  const o = c.kerem.oturum(id('irem'))
  const have = o.basla().filter((x) => x[0] === M.Z.AFET_HAVE).map((x) => M.coz(x[0], x.subarray(1)).items.length)
  t.alike(have, [64, 64, 2])
  const r = bag('kerem', 'irem')
  t.ok(r.bitti)
  t.is(c.irem.depo.tasinan.size, 100)
  t.absent(c.irem.esitlemeGerekli(id('kerem')), 'az önce eşitlendi')
  // 128 öğe: sona boş HAVE eklenir
  const d = new Depo()
  for (let i = 0; i < 128; i++) d.tasi(yapay(i + 1, 3, GUN), GUN)
  c.kerem.depo = d
  t.alike(c.kerem.oturum(id('irem')).basla().map((x) => M.coz(x[0], x.subarray(1)).items.length), [64, 64, 0])
})

test('oturum: aile dışı, bozuk ve büyük çerçeve, istenmeyen mesaj', (t) => {
  const { c } = aile(['kerem', 'irem'])
  t.exception(() => c.kerem.oturum(b4a.alloc(16, 0xee)), /DISASTER_NOT_IN_FAMILY/)
  t.exception(() => c.kerem.oturum(id('uc1')), /DISASTER_NOT_IN_FAMILY/, 'çıkarılmış cihazla oturum yok')
  const o = c.irem.oturum(id('kerem'))
  o.basla()
  t.exception(() => o.al(b4a.alloc(0)), /DISASTER_CORRUPT/)
  const buyuk = b4a.concat([b4a.from([M.Z.AFET_MSG]), b4a.alloc(601)])
  t.exception(() => o.al(buyuk), /DISASTER_LENGTH/, '600 B üstü zarf oturumu kapatır')
  t.alike(o.al(cerceve(M.Z.AFET_MSG, yapay(1, 3, GUN))), [], 'istenmeyen mesaj atılır')
  t.is(c.irem.depo.tasinan.size, 0)
  t.alike(o.al(cerceve(M.Z.AFET_TAGS, { v: 1, slot: 1, tags: Array.from({ length: 25 }, () => b4a.alloc(4)) })), [])
  t.alike(o.al(cerceve(M.Z.AFET_WANT, { mids: [b4a.alloc(16, 9)] })), [], 'sunulmayan mid gönderilmez')
  // bağ benzetimi: hata fırlarsa kapanır
  const sahte = { basla: () => [buyuk], al: () => [], bitti: false }
  t.is(bagla(sahte, c.kerem.oturum(id('irem'))).kapandi, 'DISASTER_LENGTH')
  const dongu = { basla: () => [b4a.from([0])], al: () => [b4a.from([0])], bitti: false }
  t.is(bagla(dongu, { ...dongu }, { enCok: 10 }).kapandi, 'SIMULATION_LIMIT')
})

test('eşitleme: alıcının açamadığı ve tekrar gelen mesaj; teslim edilmiş giden sunulmaz', (t) => {
  const { c, bag } = aile(['kerem', 'irem', 'husniye'])
  const r = c.kerem.gonder({ to: id('husniye'), kind: M.KIND.IYIYIM, text: 'İyiyim' })
  const msg = c.kerem.depo.giden.get(r.mid).m
  // aynı mid'i Hüsniye zaten gördü: yeniden istenmez
  c.husniye.depo.gorulen.set(r.mid, GUN)
  bag('kerem', 'husniye')
  t.is(c.husniye.depo.gelen.length, 0)
  // toTag Hüsniye'nin ama içerik bozuk: açılmaz, atılır
  const bozuk = { ...msg, mid: b4a.alloc(16, 0x77), ct: b4a.alloc(msg.ct.byteLength, 1) }
  c.irem.depo.tasi(bozuk, GUN)
  bag('irem', 'husniye')
  t.is(c.husniye.depo.gelen.length, 0)
  t.is(c.husniye.depo.tasinan.size, 0, 'kendi etiketli ama açılmayan mesaj taşınmaz')
  c.kerem.depo.giden.get(r.mid).teslim = true
  t.is(c.kerem.depo.sunulacak(GUN).length, 0)
  t.is(T.gunOf(AN), GUN)
})

test('gönderme: birden çok alıcı tek gönderim sayılır; biri engelliyse hiçbiri gitmez', (t) => {
  const { c, s } = aile(['kerem'])
  const r = c.kerem.gonderHepsi([id('husniye'), id('irem')], { kind: M.KIND.SOS, text: 'Yardım' })
  t.is(r.length, 2)
  t.unlike(r[0].msg.toTag, r[1].msg.toTag, 'her alıcıya ayrı mühür')
  s.t += 30 * SN
  t.exception(() => c.kerem.gonderHepsi([id('ecem')], { kind: M.KIND.SOS, text: 'Yardım' }), /DISASTER_SEND_LIMIT/)
  c.kerem.gonderHepsi([id('husniye')], { kind: M.KIND.IYIYIM, text: 'İyiyim' })
  t.exception(() => c.kerem.gonderHepsi([id('irem'), id('husniye')], { kind: M.KIND.IYIYIM, text: 'İyiyim' }), /DISASTER_SEND_LIMIT/)
  t.is(c.kerem.depo.giden.size, 3, 'engellenen çoklu gönderimden hiçbiri gitmedi')
  t.is(c.kerem.gonderim.gecmis.get(String(M.KIND.SOS)).length, 1)
})

test('D84 B9–B12: taşıyıcı sınırları, öncelik denetimi, gelen kutusu budama, misafirin teslim bilgisi', (t) => {
  const { c, s, bag } = aile(['kerem', 'irem', 'husniye', 'misafir1'])
  // B9: hops > 4 ya da expiresDay çok ileri olan mesaj taşınmaz (hops AD'de değil)
  const o = c.irem.oturum(id('kerem'))
  o.basla()
  const fazla = { ...yapay(1, 3, GUN), hops: 9 }
  const ileri = { ...yapay(2, 3, GUN), expiresDay: GUN + 5 }
  const gecmis = { ...yapay(3, 3, GUN), expiresDay: GUN - 1 }
  const iyi = yapay(4, 3, GUN)
  const have = (x) => cerceve(M.Z.AFET_HAVE, { items: x.map((m) => ({ mid: m.mid, toTag: m.toTag, prio: m.prio, hops: m.hops })) })
  const want = o.al(have([fazla, ileri, gecmis, iyi]))
  t.is(M.coz(M.Z.AFET_WANT, want[0].subarray(1)).mids.length, 3, 'hops 9 istenmez')
  for (const m of [ileri, gecmis, iyi]) o.al(cerceve(M.Z.AFET_MSG, m))
  t.alike([...c.irem.depo.tasinan.keys()], [hex(iyi.mid)], 'yalnız sınırlar içindeki taşınır')
  // B10: açık öncelik iç türle aynı değilse atılır (gönderen değiştirmiş; AD'de olduğu için taşıyıcı değiştiremez)
  const r = c.kerem.gonder({ to: id('husniye'), kind: M.KIND.METIN, text: 'öncelik' })
  const g = c.kerem.depo.giden.get(r.mid)
  const L2 = defter(ZINCIR)
  const pair = ciftler(L2, KIMLIK.kerem).find((x) => b4a.equals(x.id, id('husniye'))).pair
  const sahte = M.muhurle({ pair, from: id('kerem'), to: id('husniye'), kind: M.KIND.METIN, text: 'acil gibi', at: AN, gun: GUN, mid: b4a.alloc(16, 0x99), nonce: b4a.alloc(24, 1) })
  // prio'yu SOS yapıp yeniden mühürle: AD tutarlı, ama iç tür METİN
  const sodium = require('sodium-native')
  const m2 = { ...sahte.msg, prio: 0 }
  const duz = M.icKodla({ kind: M.KIND.METIN, from: id('kerem'), to: id('husniye'), at: AN, text: 'acil gibi', konum: null, ref: null, alarm: null, battery: null })
  const ct = b4a.alloc(duz.byteLength + 16)
  sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(ct, duz, M.ad(m2), null, m2.nonce, T.afetKey(pair))
  m2.ct = ct
  const D = require('../audit')
  t.is(D.alici({ msg: m2, ciftler: ciftler(L2, KIMLIK.husniye), meId: id('husniye'), L: L2, bugun: GUN, gorulen: new Map() }).neden, 'INVALID_PRIORITY')
  t.ok(g)
  // B11: gelen kutusu 7 günden eskiyi ve 1000'i aşanı budar
  const d = new Depo({ sinir: { ...SINIR, gelen: 2 } })
  for (let i = 1; i <= 3; i++) d.aldim(b4a.alloc(16, i), b4a.alloc(32), { kind: 1 }, GUN + i)
  t.alike(d.gelen.map((x) => x.gun), [GUN + 2, GUN + 3])
  d.temizle(GUN + 10)
  t.alike(d.gelen.map((x) => x.gun), [GUN + 3])
  // B12: misafirin mesajını alıcı doğrudan almasa da teslim bilgisi misafire döner
  s.t += DK
  const mm = c.misafir1.gonder({ to: id('kerem'), kind: M.KIND.METIN, text: 'Çocuklar uyudu' })
  bag('misafir1', 'irem')
  bag('irem', 'husniye') // Hüsniye taşır
  c.irem.depo.bosalt()
  bag('husniye', 'kerem')
  t.ok(c.kerem.depo.gelen.some((x) => x.mid === mm.mid))
  t.is(c.kerem.depo.teslim.get(mm.mid).kaynak, hex(id('misafir1')), 'kaynak gönderen misafir')
  bag('kerem', 'misafir1')
  t.ok(c.misafir1.depo.giden.get(mm.mid).teslim, 'misafir teslim bilgisini alıcıdan aldı')
})
