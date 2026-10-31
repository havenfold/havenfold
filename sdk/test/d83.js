// SPDX-License-Identifier: Apache-2.0
// D83: RFC-0012 SDK DisasterApi — durum (310), elle aç ve kapat (311), mesaj gönderme (312), gelen ve giden (313), yakındakiler
// (314), ayar (315), sinyal (316), bağ (317, bellek içi akışla), etiket listesi (318), taşıyıcı deposunu boşaltma (319).
const test = require('brittle')
const b4a = require('b4a')
const { Duplex } = require('streamx')
const S = require('..')
const AF = require('../../core/disaster/test/helpers/disaster-vector')

const hex = (b) => b4a.toString(b, 'hex')
const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const SN = 1000
const DK = 60 * SN
const SAAT = 60 * DK
const AN = 20750 * 86_400_000 + 15 * SAAT
const L = AF.defter(AF.ZINCIR)
const kim = (ad) => hex(AF.KIMLIK[ad].memberId)

function akisCifti () {
  let a = null
  let b = null
  const yap = (karsi) => new Duplex({
    write (d, cb) { karsi().push(d); cb() },
    final (cb) { karsi().push(null); cb() },
    predestroy () { karsi().destroy() }
  })
  a = yap(() => b)
  b = yap(() => a)
  return [a, b]
}

function aile (adlar, o = {}) {
  const saat = { t: AN }
  const api = {}
  const olaylar = {}
  for (const ad of adlar) {
    api[ad] = new S.DisasterApi({ me: AF.KIMLIK[ad], defter: () => L, saat: () => saat.t, saklama: o.saklama?.[ad] ?? null, izin: o.izin?.[ad] })
    olaylar[ad] = []
    api[ad].on('disaster', (x) => olaylar[ad].push(x))
  }
  const bagla = async (a, b, bag = 'bluetooth') => {
    const [x, y] = akisCifti()
    return Promise.all([
      api[a].connect({ ham: x, baslatan: true, eslesme: api[a].match({ bayt: api[b].tags().bayt }), bag }),
      api[b].connect({ ham: y, baslatan: false, bag })
    ])
  }
  return { saat, api, olaylar, bagla }
}

function bellek () {
  const m = new Map()
  return { get: (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), set: (k, v) => m.set(k, JSON.stringify(v)) }
}

test('D83: elle aç ve kapat; izin yoksa açılmaz; durum olayı', (t) => {
  const { api, olaylar } = aile(['kerem', 'irem'], { izin: { irem: () => false } })
  const k = api.kerem
  t.is(k.state().durum, 'kapali')
  t.alike(api.irem.enable(), { acildi: false, neden: 'izin' })
  t.alike(k.enable(), { acildi: true })
  t.is(k.state().durum, 'etkin')
  t.ok(k.state().elle)
  t.is(olaylar.kerem.at(-1).type, 'durum')
  t.is(olaylar.kerem.at(-1).hal.durum, 'etkin')
  t.is(k.close('hazir').durum, 'hazir')
  t.is(k.close().durum, 'kapali')
  t.is(hataOf(() => k.close('acik')), 'DISASTER_TARGET')
  t.is(S.DISASTER_COMMAND.DISASTER_STATE, 310)
  t.is(S.DISASTER_COMMAND.DISASTER_CLEAR, 319)
})

test('D83: sinyal ve durum makinesi — internet 31 dk yok → hazır; yazınca etkin; internet 10 dk dönünce kapalı', (t) => {
  const { saat, api, olaylar } = aile(['kerem'])
  const k = api.kerem
  t.is(k.configure({ hazirDk: 30 }).hazirDk, 30)
  t.is(hataOf(() => k.configure({ hazirDk: 5 })), 'INVALID_DISASTER_SETTINGS')
  t.is(hataOf(() => k.configure({ hazirDk: 12.5 })), 'INVALID_DISASTER_SETTINGS')
  t.alike(k.configure(), { hazirDk: 30 })
  k.signal({ internet: false, pil: 70 })
  saat.t += 29 * DK
  t.is(k.tick().durum, 'kapali')
  saat.t += 2 * DK
  t.is(k.tick().durum, 'hazir')
  t.is(k.state().internetYok, AN)
  t.is(k.state().pil, 70)
  // HAZIR'da yazınca ETKİN
  k.send('iyiyim', [kim('husniye')], 'İyiyim')
  t.is(k.state().durum, 'etkin')
  t.is(k.state().bekleyen, 1)
  // internet döndü ama bekleyen var: durum korunur
  saat.t += DK
  k.signal({ internet: true })
  t.ok(olaylar.kerem.some((x) => x.type === 'internet-dondu'))
  saat.t += 11 * DK
  t.is(k.tick().durum, 'etkin')
  k.depo.giden.forEach((x) => { x.teslim = true })
  t.is(k.tick().durum, 'kapali')
  k.signal({ dugum: { pilde: true } })
  t.is(k.state().durum, 'etkin', 'düğüm pilde → etkin')
})

test('D83: SOS işareti + internet 2 dk yok → etkin; elle kapatınca eski işaret yeniden açmaz; 72 saat sorusu', (t) => {
  const { saat, api, olaylar } = aile(['kerem'])
  const k = api.kerem
  k.signal({ internet: false })
  k.send('sos', [kim('husniye'), kim('irem')], 'Enkaz altındayım')
  t.is(k.state().bekleyen, 2, 'her alıcıya ayrı mühür')
  saat.t += 2 * DK
  t.is(k.tick().durum, 'etkin')
  k.close()
  saat.t += DK
  t.is(k.tick().durum, 'kapali')
  // elle açılır, 72 saat dolunca sorulur
  k.enable()
  saat.t += 72 * SAAT
  const h = k.tick()
  t.ok(h.soru)
  t.ok(olaylar.kerem.some((x) => x.type === 'sursun-mu'))
  t.is(k.keepOn(true).durum, 'etkin')
  t.absent(k.state().soru)
  saat.t += 72 * SAAT
  k.tick()
  t.is(k.keepOn(false).durum, 'hazir')
})

test('D83: gönderme hataları', (t) => {
  const { saat, api } = aile(['kerem', 'isci1'])
  const k = api.kerem
  t.is(hataOf(() => k.send('alindi', [kim('irem')])), 'INVALID_DISASTER_KIND')
  t.is(hataOf(() => k.send('selam', [kim('irem')])), 'INVALID_DISASTER_KIND')
  t.is(hataOf(() => k.send('metin', [])), 'NO_DISASTER_RECEIVER')
  t.is(hataOf(() => k.send('metin', [kim('irem')], '')), 'INVALID_DISASTER_TEXT')
  t.is(hataOf(() => k.send('uyari', [kim('irem')], 'x', null, { alarm: { kind: 'deprem', level: 1, nearby: [] } })), 'DISASTER_CANNOT_SEND')
  t.ok(api.isci1.send('uyari', [kim('irem')], 'deprem', null, { alarm: { kind: 'deprem', level: 3, nearby: [] } })[0])
  k.send('metin', [kim('irem')], 'Bir')
  t.is(hataOf(() => k.send('metin', [kim('irem')], 'İki')), 'DISASTER_SEND_LIMIT')
  saat.t += 15 * SN
  const [mid] = k.send('iyiyim', [kim('irem')], 'İyiyim', { latE5: 4101234, lonE5: 2898765, accM: 9, at: AN }, { tamKonum: true })
  t.is(k.depo.giden.get(mid).kind, 2)
})

test('D83: Bluetooth bağıyla Kerem → İrem (taşıyıcı) → Hüsniye; gelen taşındı, giden alındı; okundu, yakındakiler', async (t) => {
  const { saat, api, olaylar, bagla } = aile(['kerem', 'irem', 'husniye'])
  api.kerem.signal({ pil: 55 })
  const [mid] = api.kerem.send('metin', [kim('husniye')], 'Okul bahçesindeyiz', { latE5: 4101234, lonE5: 2898765, accM: 20, at: AN })
  t.alike(api.kerem.messages().map((x) => [x.yon, x.durum]), [['giden', 'yolda']])
  const [r1] = await bagla('kerem', 'irem')
  t.ok(r1.bitti)
  t.alike(api.irem.relayed().adet, 1)
  t.alike(api.irem.messages(), [], 'taşıyıcı içeriği görmez')
  saat.t += SN
  await bagla('irem', 'husniye')
  const m = api.husniye.messages()[0]
  t.is(m.metin, 'Okul bahçesindeyiz')
  t.is(m.durum, 'tasindi')
  t.is(m.konum.latE5, 4101000, 'METİN konumu 1000\'in katına yuvarlanır')
  t.is(m.konum.lonE5, 2899000)
  t.is(m.pil, 55)
  t.is(m.kimlik, kim('kerem'))
  t.is(api.husniye.state().yeni, 1)
  t.ok(olaylar.husniye.some((x) => x.type === 'mesaj' && x.mesaj.mid === mid))
  t.is(api.husniye.state().durum, 'hazir', 'yerel bağla mesaj gelince KAPALI → HAZIR')
  api.husniye.markRead(mid)
  api.husniye.markRead(mid)
  t.is(api.husniye.state().yeni, 0)
  t.ok(api.husniye.messages()[0].okundu)
  await bagla('husniye', 'irem')
  await bagla('irem', 'kerem')
  t.is(api.kerem.messages()[0].durum, 'alindi')
  t.is(api.kerem.state().bekleyen, 0)
  // doğrudan
  saat.t += 15 * SN
  api.husniye.send('metin', [kim('kerem')], 'Geliyorum')
  await bagla('husniye', 'kerem')
  t.is(api.kerem.messages().find((x) => x.yon === 'gelen').durum, 'dogrudan')
  t.alike(api.kerem.nearby().map((x) => [x.kimlik, x.tur, x.bag]).sort(), [[kim('husniye'), 'telefon', 'bluetooth'], [kim('irem'), 'telefon', 'bluetooth']].sort())
  t.ok(api.irem.syncNeeded(kim('ecem')), 'hiç eşitlenmemiş komşu')
  saat.t += 16 * DK
  t.alike(api.kerem.nearby(), [], '15 dakikadan eski bağlar düşer')
  t.alike(api.irem.clear(), { adet: 0, bayt: 0 })
})

test('D83: etiketler ve eşleşme; yerel ağ bağı olağan oturum döner; çifti olmayan kimlik', async (t) => {
  const { api, bagla } = aile(['kerem', 'husniye'])
  const e = api.kerem.tags({ port: 47871 })
  t.is(e.liste.tags.length, 25)
  t.is(e.duyuru.byteLength, e.bayt.byteLength + 3)
  const D = Math.floor(api.kerem.saat() / 900_000)
  t.alike(api.husniye.match({ bayt: e.bayt }), { kimlik: kim('kerem'), dilim: D, port: null })
  t.alike(api.husniye.match({ duyuru: e.duyuru }), { kimlik: kim('kerem'), dilim: D, port: 47871 })
  t.is(api.husniye.match({ bayt: b4a.alloc(3) }), null)
  t.is(api.husniye.match({ bayt: api.husniye.tags().bayt }), null, 'kendi listesi eşleşmez')
  t.is(api.kerem.tags().duyuru, null)
  const [a, b] = await bagla('kerem', 'husniye', 'yerel')
  t.is(a.bag, 'yerel')
  t.is(b.karsi, kim('kerem'))
  a.kapat()
  const [x] = akisCifti()
  await t.exception(api.kerem.connect({ ham: x, baslatan: true, eslesme: { kimlik: kim('uc1'), dilim: D }, bag: 'bluetooth' }), /NO_DISASTER_PAIR/)
  await t.exception(api.kerem.connect({ ham: akisCifti()[0], baslatan: true, bag: 'bluetooth' }), /NO_DISASTER_PAIR/, 'bağlanan eşleşme vermeli')
})

test('D83: kalıcılık — ayar, durum ve mesajlar yeniden başlatmada durur', async (t) => {
  const saklama = { kerem: bellek(), husniye: bellek() }
  const ilk = aile(['kerem', 'husniye'], { saklama })
  ilk.api.kerem.configure({ hazirDk: 45 })
  ilk.api.kerem.enable()
  ilk.api.kerem.send('iyiyim', [kim('husniye')], 'İyiyim')
  await ilk.bagla('kerem', 'husniye')
  const ikinci = aile(['kerem', 'husniye'], { saklama })
  t.is(ikinci.api.kerem.settings().hazirDk, 45)
  t.is(ikinci.api.kerem.state().durum, 'etkin')
  t.is(ikinci.api.husniye.messages()[0].metin, 'İyiyim')
  t.is(ikinci.api.husniye.messages()[0].durum, 'dogrudan')
})

test('D84 B3: internet dönünce normal yol (§8.4) — bekleyen düşer, cihaz KAPALI\'ya iner; alıcı normal yoldan alır, ALINDI geri döner', (t) => {
  const { saat, api } = aile(['kerem', 'husniye', 'irem'])
  const k = api.kerem
  k.signal({ internet: false })
  saat.t += 2 * DK
  const [mid] = k.send('sos', [kim('husniye')], 'Enkazdayım')
  t.is(k.tick().durum, 'etkin')
  saat.t += DK
  k.signal({ internet: true })
  const giden = k.handToNormalPath()
  t.is(giden.length, 1)
  t.is(giden[0].to, kim('husniye'))
  t.is(giden[0].tur, 0xb0)
  t.is(k.state().bekleyen, 0, 'normal yola verilen bekleyen sayılmaz')
  t.is(k.messages()[0].normalYoldan, 'gitti')
  saat.t += 10 * DK
  t.is(k.tick().durum, 'kapali', 'internet 10 dk döndü, bekleyen yok')
  // alıcı tarafı
  const r = api.husniye.takeFromNormalPath(giden[0].govde)
  t.alike(r, { gecerli: true, mid })
  t.is(api.husniye.messages()[0].durum, 'dogrudan')
  t.is(api.husniye.takeFromNormalPath(giden[0].govde).neden, 'REPLAY', 'aynı mid ikinci kez alınmaz')
  t.is(api.irem.takeFromNormalPath(giden[0].govde).neden, 'NOT_RECIPIENT', 'başkasının mesajı normal yoldan taşınmaz')
  t.is(api.irem.takeFromNormalPath(b4a.alloc(3)).neden, 'DISASTER_CORRUPT')
  // ALINDI normal yoldan geri: gönderende 'alindi'
  const alindi = api.husniye.handToNormalPath()
  t.is(alindi.length, 1)
  t.ok(k.takeFromNormalPath(alindi[0].govde).gecerli)
  t.is(k.messages()[0].durum, 'alindi')
  t.ok(k.depo.giden.get(mid).teslim, 'ALINDI kendi gidenimi teslim sayar')
  t.alike(k.handToNormalPath(), [], 'teslim edilen yeniden verilmez')
})

// Codex 6. tur: başka üyenin aynı ref'li ALINDI'sı gidenin "alındı" durumunu ve alindiOf'u değiştirmez (yalnız asıl alıcı)
test('Codex 6. tur: başkasının ALINDI\'sı sahte teslim saymaz; asıl alıcınınki sayar', (t) => {
  const { saat, api } = aile(['kerem', 'husniye', 'irem'])
  const k = api.kerem
  k.signal({ internet: false })
  saat.t += 2 * DK
  const [mid] = k.send('sos', [kim('husniye')], 'Enkazdayım')
  // İrem, Kerem'in Hüsniye'ye giden SOS'unun mid'iyle ALINDI yollar (SOS ona hiç ulaşmadı)
  api.irem.motor.gonder({ to: AF.KIMLIK.kerem.memberId, kind: 5, ref: b4a.from(mid, 'hex') }, { sinirsiz: true })
  const sahte = api.irem.handToNormalPath().find((x) => x.to === kim('kerem'))
  t.ok(sahte, 'İrem\'in ALINDI\'sı')
  t.ok(k.takeFromNormalPath(sahte.govde).gecerli, 'ALINDI geçerli bir mesaj olarak alınır')
  t.is(k.messages().find((x) => x.mid === mid).durum, 'yolda', 'giden alındı sayılmaz')
  t.alike(k.receiptOf(mid), { kimlik: kim('husniye'), alindi: false, at: null })
  t.absent(k.depo.giden.get(mid).teslim)
  // Asıl alıcı alınca
  const giden = k.handToNormalPath().find((x) => x.to === kim('husniye'))
  t.ok(api.husniye.takeFromNormalPath(giden.govde).gecerli)
  t.ok(k.takeFromNormalPath(api.husniye.handToNormalPath()[0].govde).gecerli)
  t.is(k.messages().find((x) => x.mid === mid).durum, 'alindi')
  t.is(k.receiptOf(mid).alindi, true)
  // Günlük temizlik (tik): teslimden sonra 7 gün alındı görünür, sonra giden temizlenir
  saat.t += 3 * 24 * SAAT
  k.tick()
  t.is(k.receiptOf(mid).alindi, true, '3 gün sonra hâlâ alındı')
  saat.t += 5 * 24 * SAAT
  k.tick()
  t.is(k.receiptOf(mid), null, '8 gün sonra temizlendi')
})

test('D87 madde 1: DisasterApi.tags aynı dilimde aynı liste; Bluetooth TAGS ve yerel ağ duyurusu ortak', (t) => {
  const { saat, api } = aile(['kerem'])
  const a = api.kerem.tags({ port: 47871 })
  const b = api.kerem.tags()
  t.alike(a.bayt, b.bayt)
  t.alike(a.duyuru.subarray(0, a.bayt.byteLength + 1).subarray(1), a.bayt, 'duyurudaki liste TAGS ile aynı')
  saat.t += 15 * 60_000
  t.unlike(api.kerem.tags().bayt, a.bayt, 'sonraki dilimde yeni liste')
})
