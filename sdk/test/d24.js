// SPDX-License-Identifier: Apache-2.0
// D24: Yuva Defteri'nin son dilimi için SDK yüzeyleri (kollar/D-cekirdek.md D24). Beklenenler elle yazıldı.
const test = require('brittle')
const b4a = require('b4a')
const { ledger: { Ledger } } = require('@havenfold/core')
const S = require('..')
const A = require('../../core/records/test/helpers/family')

const hex = (b) => b4a.toString(b, 'hex')
const id = (k) => hex(k.memberId)
const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const hataOfA = async (fn) => { try { await fn(); return null } catch (err) { return err.message } }
const TA = hex(A.K_TUM_AILE)
const MIN = 60_000

// --- Tören ---

function sahteTasiyici () {
  const oturumlar = []
  const yeni = (girdi) => {
    const o = new S.Emitter()
    o.girdi = girdi
    o.onaylar = []
    o.iptal = 0
    o.confirm = (x) => o.onaylar.push(x)
    o.cancel = () => { o.iptal++ }
    o.ttlSec = 180
    oturumlar.push(o)
    return o
  }
  return { oturumlar, davet: async (g) => yeni({ davet: g }), katil: async (kod) => yeni({ katil: kod }) }
}
const qr = (kind) => 'yuva://j/2/' + b4a.toString(b4a.from([2, kind, 1, 2, 3]), 'base64url')
const RESIMLER = ['elma', 'kedi', 'ev', 'gemi', 'yıldız']

test('tören: davet yalnız ana kimlikten ve yetkiyle; QR ve 5 resim olayları; onay, farklı ve iptal', async (t) => {
  const L = A.anaDefter()
  const tas = sahteTasiyici()
  const tr = new S.CeremonyApi({ ledger: L, me: A.K.kerem, tasiyici: tas })
  const olaylar = []
  tr.on('ceremony', (x) => olaylar.push(x))
  t.alike(S.CEREMONY_COMMAND, { INVITE_START: 3, INVITE_CONFIRM: 4, JOIN: 5, INVITE_CANCEL: 205 })
  t.is(await hataOfA(() => tr.startInvite('kutu')), 'INVALID_TYPE', 'kutuyu telefon tarar, davet etmez')
  t.is(await hataOfA(() => tr.startInvite('uye', 'sahip')), 'INVALID_ROLE')
  t.alike(await tr.startInvite('uye', 'cocuk'), { ttlSec: 180 })
  t.alike(tas.oturumlar[0].girdi.davet, { tur: 'uye', kind: 0, rol: 'cocuk' })
  t.is(await hataOfA(() => tr.startInvite('uye', 'cocuk')), 'CEREMONY_IN_PROGRESS')
  t.is(hataOf(() => tr.confirm(true)), 'NO_CEREMONY', '5 resim gelmeden onay yok')
  const o = tas.oturumlar[0]
  o.emit('qr', { qr: 'yuva://j/2/abc', kalanSn: 60 })
  o.emit('sas', { resimler: RESIMLER })
  tr.confirm(true)
  t.alike(o.onaylar, [true])
  o.emit('tamam', { memberId: 'x' })
  t.alike(olaylar.map((x) => x.adim), ['qr', 'sas', 'tamam'])
  t.is(tr.inProgress, false)
  await tr.startInvite('misafir')
  tas.oturumlar[1].emit('sas', { resimler: RESIMLER })
  tr.confirm(false)
  t.is(tas.oturumlar[1].iptal, 1, 'farklı: tören kapanır')
  t.alike(olaylar.at(-1), { adim: 'kapandi', neden: 'farkli' })
  await tr.startInvite('uye', 'yetiskin')
  tas.oturumlar[2].emit('sas', { resimler: RESIMLER.slice(0, 4) })
  t.alike(olaylar.at(-1), { adim: 'kapandi', neden: 'INVALID_CEREMONY' }, '5 resim beklenir')
  await tr.startInvite('uye', 'yetiskin')
  tr.cancel()
  t.alike(olaylar.at(-1), { adim: 'kapandi', neden: 'kullanici' })
  tas.oturumlar[3].emit('qr', { qr: 'eski', kalanSn: 1 })
  t.is(olaylar.at(-1).adim, 'kapandi', 'kapanmış oturumun olayı yayılmaz')
})

test('tören: yetki; ek kimlik tören yapamaz; QR türüne göre katılma', async (t) => {
  const L = A.anaDefter()
  const tas = sahteTasiyici()
  const irem = new S.CeremonyApi({ ledger: L, me: A.K.irem, tasiyici: tas })
  t.ok(await irem.startInvite('uye', 'cocuk'), 'yetişkin üye davet edebilir')
  irem.cancel()
  t.is(await hataOfA(() => irem.startInvite('misafir')), 'UNAUTHORIZED', 'misafiri ebeveyn davet eder')
  t.is(await hataOfA(() => irem.join(qr(1))), 'UNAUTHORIZED', 'kutuyu ebeveyn ekler')
  t.alike(await irem.join(qr(4)), { tur: 'ek_kimlik' }, 'kendi başka cihazı')
  irem.cancel()
  t.is(await hataOfA(() => irem.join(qr(0))), 'ALREADY_IN_FAMILY', 'ailesi olan üye QR\'ıyla katılmaz')
  t.is(await hataOfA(() => irem.join('baska://x')), 'INVALID_QR')
  t.is(await hataOfA(() => irem.join(qr(9))), 'QR_TYPE')
  const yeni = require('@havenfold/core').identity.createIdentity({ seed: 'd24/yeni', platform: 'test' })
  const ailesiz = new S.CeremonyApi({ ledger: new Ledger(), me: yeni, tasiyici: tas })
  t.alike(await ailesiz.join(qr(0)), { tur: 'uye' }, 'ailesiz uygulama davet QR\'ıyla katılır')
  // Ek kimlik: ana kimlik değil
  const { ledger: L2 } = S.LedgerApi.createFamily({ Ledger, me: A.K.kerem, displayName: 'Kerem', ts: A.TS0 })
  const ek = require('@havenfold/core').identity.createIdentity({ seed: 'd24/ek', platform: 'test' })
  const ailesizEk = S.LedgerApi.withoutFamily({ Ledger, me: ek, appId: 'yuva-defteri', now: () => A.TS0 })
  const ana = new S.LedgerApi({ ledger: L2, me: A.K.kerem, now: () => A.TS0 + 1000 })
  const { ledger: L3, event } = ailesizEk.pairAccept(ana.pairApprove(ailesizEk.pairRequest('yuva-defteri'), { approved: true }))
  L3.apply(event)
  const ekToren = new S.CeremonyApi({ ledger: L3, me: ek, tasiyici: tas })
  t.is(await hataOfA(() => ekToren.startInvite('uye', 'cocuk')), 'SECONDARY_IDENTITY_CANNOT_JOIN')
})

// --- Yerel kanal ve kişisel mod ---

test('yerel kanal: taslak ve mesaj yalnız yerel kanaldan; Yuva Hat yoksa yok; hedef ve metin denetlenir', (t) => {
  const birakilan = []
  let var_ = true
  const y = new S.LocalApi({ kanal: { var: () => var_, birak: (z) => birakilan.push(z) }, now: () => 5 })
  const conv = 'ab'.repeat(32)
  t.alike(y.dropDraft({ tur: 'sohbet', convId: conv }, '[YZ] Kombi servisi yarın 10:00'), { yol: 'yerel' })
  t.alike(birakilan[0], { v: 1, tur: 'taslak', hedef: { tur: 'sohbet', convId: conv }, metin: '[YZ] Kombi servisi yarın 10:00', at: 5 })
  t.alike(y.dropMessage([id(A.K.kerem), id(A.K.kerem)], 'Kalkan: ...'), { yol: 'yerel' })
  t.alike(birakilan[1].alicilar, [id(A.K.kerem)])
  t.is(hataOf(() => y.dropDraft({ tur: 'sohbet', convId: 'x' }, 'a')), 'INVALID_TARGET')
  t.is(hataOf(() => y.dropDraft({ tur: 'kisi', personId: id(A.K.kerem) }, ' ')), 'INVALID_TEXT')
  t.is(hataOf(() => y.dropDraft({ tur: 'kisi', personId: id(A.K.kerem) }, 'x'.repeat(4097))), 'INVALID_TEXT')
  var_ = false
  t.alike(y.dropDraft({ tur: 'yanit', recordId: 'cd'.repeat(16), personId: id(A.K.kerem) }, 'tamam'), { yol: 'yok' })
  t.alike(new S.LocalApi().dropMessage([id(A.K.kerem)], 'x'), { yol: 'yok' })
  t.is(birakilan.length, 2)
})

test('kişisel mod: ailesiz başlar; düzey 2.2 ve Kişisel gelince bir kez taşınır', (t) => {
  const km = new S.PersonalMode({ now: () => A.TS0 })
  t.is(hataOf(() => km.put(null, 'yuva.defter.not', { m: 1 })), 'PERSONAL_MODE_DISABLED')
  km.start()
  t.ok(km.active)
  const a = km.put(null, 'yuva.defter.not', { baslik: 'Wifi' })
  km.put(a, null, { sifre: '1234' })
  km.put(null, 'yuva.defter.not', { baslik: 'Kombi' })
  km.put(null, 'yuva.defter.ev_cihazi', { urun: 'Kombi' })
  t.alike(km.get(a).fields, { baslik: 'Wifi', sifre: '1234' })
  t.is(km.query({ type: 'yuva.defter.not' }).length, 2)
  const L21 = A.anaDefter()
  t.is(km.movable(L21, A.K.irem), null, 'düzey 2.1')
  t.is(hataOf(() => km.move(null, L21, A.K.irem)), 'NO_LEVEL')
  const { ledger: L } = S.LedgerApi.createFamily({ Ledger, me: A.K.kerem, displayName: 'Kerem', ts: A.TS0 })
  const kayit = new S.RecordApi({ replika: A.replika(L, A.K.kerem, { now: () => A.TS0 + 1000 }) })
  const kisisel = km.movable(L, A.K.kerem)
  t.ok(kisisel)
  t.alike(km.move(kayit, L, A.K.kerem), [{ tur: 'yuva.defter.ev_cihazi', sayi: 1 }, { tur: 'yuva.defter.not', sayi: 2 }])
  t.alike(kayit.query(kisisel, { type: 'yuva.defter.not' }).map((k) => k.fields.baslik).sort(), ['Kombi', 'Wifi'])
  t.is(hataOf(() => km.move(kayit, L, A.K.kerem)), 'ALREADY_MOVED', 'bir kez')
  t.is(km.active, false)
  t.is(hataOf(() => km.start()), 'ALREADY_MOVED')
})

// --- Bakım ---

function bakimKur () {
  const L = A.anaDefter()
  const saat = { t: S.scheduledOf('2026-10-24', '07:00') }
  const kayit = new S.RecordApi({ replika: A.replika(L, A.K.husniye, { now: () => saat.t }) })
  const olay = new S.EventApi({ kayit, now: () => saat.t })
  const defter = new S.LedgerApi({ ledger: L, me: A.K.husniye, now: () => saat.t })
  const bakim = new S.CareDeskApi({ kayit, olay, defter, now: () => saat.t })
  return { L, saat, kayit, olay, bakim }
}

test('bakım: doz kartları, "Aldım", kaçırılan doz vakası ve merdiven; "Ben bakıyorum" merdiveni durdurur', (t) => {
  const { saat, kayit, bakim } = bakimKur()
  const ilac = kayit.put(TA, null, 'yuva.defter.ilac', { kisi: 'uye:' + id(A.K.ecem), baslik: 'D vitamini', doz_metni: '1 damla', saatler: ['08:00', '20:00'], aktif: true })
  const sekiz = S.scheduledOf('2026-10-24', '08:00')
  t.is(sekiz, Date.UTC(2026, 9, 24, 5, 0), '08:00 TR = 05:00 UTC')
  const kart = bakim.doses('2026-10-24')
  t.alike(kart.map((x) => [x.saat, x.baslik, x.durum, x.kisi]), [['08:00', 'D vitamini', null, id(A.K.ecem)], ['20:00', 'D vitamini', null, id(A.K.ecem)]])
  t.is(bakim.process(), 1, 'ilaç kuralı')
  saat.t = sekiz + 29 * MIN
  bakim.process()
  t.alike(bakim.missed(), [], '30 dakika dolmadı')
  const olaylar = []
  bakim.on('care', (x) => olaylar.push(x.type))
  saat.t = sekiz + 31 * MIN
  for (let i = 0; i < 4 && !bakim.missed().length; i++) { bakim.process(); saat.t += 2 * MIN }
  const k = bakim.missed()
  t.is(k.length, 1)
  t.alike([k[0].recordId, k[0].planlanan, k[0].baslik, k[0].onem, k[0].kisi, k[0].sahip], [ilac, sekiz, 'D vitamini', 'dikkat', id(A.K.ecem), null])
  t.alike(k[0].basamaklar.map((b) => [b.basamak, b.durum]), [[2, 'oldu'], [3, 'sonra'], [4, 'sonra']])
  t.ok(olaylar.includes('kacirilan'))
  t.is(bakim.status().kacirilanSayisi, 1)
  bakim.process()
  t.is(bakim.missed().length, 1, 'aynı doz için ikinci vaka yok')
  saat.t += 31 * MIN
  bakim.process()
  t.is(bakim.missed()[0].basamaklar[1].durum, 'oldu', '30 dakika sonra 3. basamak')
  bakim.imHandling(k[0].vakaId)
  const s = bakim.missed()[0]
  t.is(s.sahip, id(A.K.husniye))
  saat.t += 3 * 60 * MIN
  bakim.process()
  t.is(bakim.missed()[0].basamaklar[2].durum, 'durdu', 'sahipli vakada 4. basamak yazılmaz')
  // Aldım: doz kaydı, kart durumu
  const d = bakim.markDose(TA, ilac, S.scheduledOf('2026-10-24', '20:00'), 'alindi')
  t.is(bakim.doses('2026-10-24')[1].durum, 'alindi')
  t.is(kayit.get(TA, d).fields._keep, 365)
  t.is(hataOf(() => bakim.markDose(TA, ilac, sekiz, 'unuttum')), 'INVALID_STATUS')
  t.is(hataOf(() => bakim.imHandling('00'.repeat(16))), 'NO_CASE')
})

test('bakım: Sağlık:<ad> kişisel koleksiyonu, okuyucularla; kasa gibi; Kişisel\'deki özet taşınır', (t) => {
  const { L } = bakimKur()
  const { ledger: L2 } = S.LedgerApi.createFamily({ Ledger, me: A.K.kerem, displayName: 'Kerem', ts: A.TS0 })
  const kayit = new S.RecordApi({ replika: A.replika(L2, A.K.kerem, { now: () => A.TS0 + 1000 }) })
  const olay = new S.EventApi({ kayit, now: () => A.TS0 + 1000 })
  const defter = new S.LedgerApi({ ledger: L2, me: A.K.kerem, now: () => A.TS0 + 2000 })
  const bakim = new S.CareDeskApi({ kayit, olay, defter, now: () => A.TS0 + 2000 })
  const kisisel = [...L2.collections.values()].find((c) => c.name === 'Kişisel').id
  kayit.put(kisisel, null, 'yuva.defter.saglik_ozeti', { kan_grubu: '0+' })
  const cid = bakim.setupHealthCollection([], true, true)
  const col = L2.collections.get(cid)
  t.alike([col.name, col.kind, col.sensitivity, col.taskAccess], ['Sağlık:Kerem', 'kisisel', 'kasa', false])
  t.is(kayit.query(cid, { type: 'yuva.defter.saglik_ozeti' }).length, 1, 'özet taşındı')
  t.is(kayit.query(kisisel, { type: 'yuva.defter.saglik_ozeti' }).length, 0)
  t.is(bakim.status().benimSaglikKoleksiyonum, cid)
  t.is(hataOf(() => bakim.setupHealthCollection([], false, false)), 'ALREADY_EXISTS')
  t.ok(L, 'kullanılmayan')
})

// --- Kalkan ---

function kalkanKur () {
  const L = A.anaDefter()
  const now = () => A.TS0 + 3_600_000
  const r = (k) => A.replika(L, k, { now })
  const irem = { r: r(A.K.irem) }
  const kerem = { r: r(A.K.kerem) }
  for (const x of [irem, kerem]) {
    x.kayit = new S.RecordApi({ replika: x.r })
    x.defter = new S.LedgerApi({ ledger: L, me: x === irem ? A.K.irem : A.K.kerem, now })
  }
  const mesajlar = []
  irem.yerel = new S.LocalApi({ kanal: { var: () => true, birak: (z) => mesajlar.push(z) }, now })
  irem.kalkan = new S.ShieldApi({ kayit: irem.kayit, defter: irem.defter, yerel: irem.yerel, now })
  kerem.kalkan = new S.ShieldApi({ kayit: kerem.kayit, defter: kerem.defter, now })
  const hus = r(A.K.husniye) // Tüm Aile'nin dönem anahtarını üreten okuyucu
  const hepsi = [irem.r, kerem.r, hus]
  const esitle = () => {
    for (let i = 0; i < 3; i++) for (const a of hepsi) for (const b of hepsi) if (a !== b) A.teslim(a, b)
    irem.kayit.sync(); kerem.kayit.sync(); irem.kalkan.scan(); kerem.kalkan.scan()
  }
  return { L, irem, kerem, mesajlar, esitle }
}

test('Kalkan: kurulum yalnız korunanın imzasıyla, koruyucuya davet, kabul, haber ve sonuç; kapatma', (t) => {
  const { L, irem, kerem, mesajlar, esitle } = kalkanKur()
  t.is(hataOf(() => irem.kalkan.enable([id(A.K.ecem)])), 'INVALID_GUARDIAN', 'çocuk koruyucu olamaz')
  t.is(hataOf(() => irem.kalkan.enable([id(A.K.kerem), id(A.K.husniye), id(A.K.irem)])), 'GUARDIAN_COUNT')
  const davet = []
  kerem.kalkan.on('shield', (x) => davet.push(x))
  const cid = irem.kalkan.enable([id(A.K.kerem)])
  const col = L.collections.get(cid)
  t.alike([col.name, col.kind, col.taskAccess, col.readers.sort()], ['Kalkan:' + L.members.get(id(A.K.irem)).name, 'kisisel', false, ['uye:' + id(A.K.irem), 'uye:' + id(A.K.kerem)].sort()])
  t.is(hataOf(() => irem.kalkan.enable([id(A.K.kerem)])), 'SHIELD_ENABLED')
  esitle()
  t.alike(davet, [{ type: 'davet', korunan: id(A.K.irem) }])
  kerem.kalkan.answerInvite(id(A.K.irem), true)
  esitle()
  t.alike(irem.kalkan.status().kabuller, { [id(A.K.kerem)]: true })
  t.alike(irem.kalkan.status().koruyucular, [id(A.K.kerem)])
  t.alike(kerem.kalkan.status().korudugum, [id(A.K.irem)])
  const h = irem.kalkan.report({ tur: 'arama', anlatim: 'Bankadan aradılar, kod istediler', isaretler: ['kod'] })
  t.is(h.yol, 'mesaj')
  t.alike(mesajlar[0].alicilar, [id(A.K.kerem)])
  t.ok(mesajlar[0].metin.startsWith('Kalkan: ') && mesajlar[0].metin.includes('şüpheli bir arama bildirdi') && mesajlar[0].metin.endsWith('Ayrıntı Defter → Kalkan\'da.'))
  esitle()
  t.alike(davet.at(-1), { type: 'bildirim', collectionId: cid, recordId: h.recordId })
  const b = kerem.kalkan.notifications()
  t.alike([b.length, b[0].korunan, b[0].sonuc, b[0].anlatim, b[0]._keep], [1, id(A.K.irem), 'acik', 'Bankadan aradılar, kod istediler', 365])
  kerem.kalkan.writeResult(cid, h.recordId, 'sorun_yok')
  esitle()
  t.is(irem.kalkan.notifications()[0].sonuc, 'sorun_yok')
  t.is(hataOf(() => kerem.kalkan.writeResult(cid, h.recordId, 'bilmem')), 'INVALID_INPUT')
  irem.kalkan.close()
  t.alike(L.collections.get(cid).readers, ['uye:' + id(A.K.irem)], 'koruyucu çıktı')
  t.is(irem.kalkan.status().acik, false)
})

test('Kalkan: Yuva Hat yoksa haber yalnız kayıt; görünürlük tercihi yalnız kendi kaydım', (t) => {
  const { irem, esitle } = kalkanKur()
  const yalniz = new S.ShieldApi({ kayit: irem.kayit, defter: irem.defter, yerel: new S.LocalApi(), now: () => A.TS0 })
  irem.kalkan.enable([id(A.K.kerem)], 'her_zaman')
  t.is(yalniz.report({ tur: 'mesaj', anlatim: 'x' }).yol, 'kayit')
  const r1 = irem.kalkan.setVisibility(true, TA)
  esitle() // Tüm Aile'nin dönem anahtarı Hüsniye'den
  const r2 = irem.kalkan.setVisibility(false, TA)
  t.is(r1, r2, 'aynı kayıt güncellenir')
  t.is(irem.kayit.get(TA, r1).fields.kalkan_gorunur, false)
})

// --- Kanal ---

test('D24 kanal numaraları: tören Yuva Hat çizelgesinden, diğerleri 352–359', (t) => {
  const F = require('../../protocol/vectors/channel-v2.json')
  for (const k of F.komutlar) t.is(S.CHANNEL_COMMAND[k.ad], k.no, k.ad)
  const nolar = Object.values(S.CHANNEL_COMMAND)
  t.is(new Set(nolar).size, nolar.length, 'numaralar tekil')
  t.ok(F.komutlar.filter((k) => k.no >= 352).every((k) => k.no <= 359))
})
