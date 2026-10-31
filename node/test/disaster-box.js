// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D88: RFC-0012 §10, §17 adım 8 yazılım kısmı — Yuva Kutusu'nda işçinin deprem ve elektrik UYARI'sı (sensör benzetimi,
// eşik varsayılan kapalı, tek uyarı), yakındakiler yalnız işçinin kendi yerel oturumlarından (H4), kutunun çapa davranışı
// (işçinin UYARI'sını taşır, ETKİN'e geçer, telefona yerel bağla verir), uzaktaki üyelere normal yol (Acil 05 §3).
const test = require('brittle')
const b4a = require('b4a')
const { DisasterApi } = require('@havenfold/sdk')
const { bagla } = require('../../core/disaster/simulation')
const { YakinKaydi, SensorBenzetimi, DepremAlgilayici, UyariYoneticisi, GucIzleyici } = require('../disaster')
const AF = require('../../core/disaster/test/helpers/disaster-vector')

const hex = (b) => b4a.toString(b, 'hex')
const DK = 60_000
const AN = 20750 * 86_400_000 + 15 * 3_600_000
const L = AF.defter(AF.ZINCIR)
const kim = (ad) => hex(AF.KIMLIK[ad].memberId)

function ev () {
  const saat = { t: AN }
  const api = (ad) => new DisasterApi({ me: AF.KIMLIK[ad], defter: () => L, saat: () => saat.t })
  const isci = api('isci1')
  const kutu = api('kutu')
  const tel = { husniye: api('husniye'), ecem: api('ecem'), misafir1: api('misafir1') }
  const yakin = new YakinKaydi({ saat: () => saat.t })
  const kutuya = []
  const normal = []
  let internet = false
  const yon = new UyariYoneticisi({
    afet: isci,
    yakin,
    kutuyaBirak: (govde) => { kutuya.push(govde); return kutu.fromWorker(govde, AF.KIMLIK.isci1.memberId).tasindi },
    normalGonder: (to, govde) => { normal.push(to); return true },
    internetVar: () => internet
  })
  return { saat, isci, kutu, tel, yakin, kutuya, normal, yon, internetAc: (v) => { internet = v } }
}

test('D88 deprem: eşik yoksa uyarı yok; eşiği aşan ölçüm her aile telefonuna UYARI, kutu taşır ve ETKİN, telefon yerel bağla alır', (t) => {
  const e = ev()
  const sensor = new SensorBenzetimi({ saat: () => e.saat.t })
  const olaylar = []
  const kapali = new DepremAlgilayici({ sensor, olay: (o) => olaylar.push(o) })
  sensor.olc(9999)
  t.alike(olaylar, [], 'eşik varsayılan kapalı: eşiksiz deprem uyarısı üretilmez (Acil 05 §6)')
  t.alike(kapali.hal(), { calisiyor: true, sonOlcum: AN, esik: null })
  kapali.durdur()
  t.exception(() => new DepremAlgilayici({ sensor, esik: -1 }), /INVALID_THRESHOLD/)
  // İşçinin kendi yerel oturumları: Hüsniye yerel ağda, İrem yalnız internetten (DHT) görüldü
  e.yakin.gordu(kim('husniye'), 'yerel')
  e.yakin.gordu(kim('irem'), 'dogrudan')
  const alg = new DepremAlgilayici({ sensor, esik: 300, olcek: (d) => Math.floor(d / 100), olay: (o) => e.yon.olay(o) })
  sensor.olc(250)
  t.is(e.yon.gecmis.length, 0, 'eşik altı')
  sensor.olc(450)
  t.is(e.yon.gecmis.length, 0, 'tek örnek: gürültü süzgeci (D90)')
  sensor.olc(450)
  t.is(e.yon.gecmis.length, 1)
  const g = e.yon.gecmis[0]
  t.is(g.tur, 'deprem')
  t.is(g.mids.length, 4, 'Kerem, Hüsniye, İrem, Ecem (misafir ve kutu değil)')
  t.is(g.kutuya, 4, 'hepsi kutuya bırakıldı')
  t.is(g.normal, 0, 'internet yokken normal yol yok')
  t.is(e.kutu.state().durum, 'etkin', '§10 adım 3: kutu ETKİN')
  t.is(e.kutu.relayed().adet, 4)
  // Aynı sarsıntı: 10 dk içinde ikinci uyarı yok
  e.saat.t += 2 * DK
  sensor.olc(500)
  sensor.olc(500)
  t.is(e.yon.gecmis.length, 1, 'aynı deprem için tek uyarı')
  // Hüsniye'nin telefonu kutuya yaklaşır: yerel bağla alır
  const r = bagla(e.kutu.motor.oturum(AF.KIMLIK.husniye.memberId), e.tel.husniye.motor.oturum(AF.KIMLIK.kutu.memberId))
  t.ok(r.bitti)
  const gelen = e.tel.husniye.depo.gelen.filter((x) => x.ic.kind === 4)
  t.is(gelen.length, 1)
  t.is(gelen[0].ic.alarm.kind, 'deprem')
  t.is(gelen[0].ic.alarm.level, 4)
  t.alike(gelen[0].ic.alarm.nearby.map(hex), [kim('husniye')], 'yakındakiler yalnız işçinin yerel oturumları (H4)')
  t.alike(e.tel.husniye.alerts().map((x) => [x.tur, x.seviye, x.evdekiler]), [['deprem', 4, [kim('husniye')]]])
  // Misafir UYARI almaz (Acil 05 §3)
  const m = bagla(e.kutu.motor.oturum(AF.KIMLIK.misafir1.memberId), e.tel.misafir1.motor.oturum(AF.KIMLIK.kutu.memberId))
  t.ok(m.bitti)
  t.is(e.tel.misafir1.alerts().length, 0)
  alg.durdur()
})

test('D88 elektrik: 2 dk kesinti → elektrik UYARI (seviye 0, pil); internet varken uzaktaki ebeveyn ve yetişkine normal yol, çocuğa değil', (t) => {
  const e = ev()
  let g = { prizde: true, pil: 90, sarj: 'dolu' }
  const guc = new GucIzleyici({ oku: () => g, saat: () => e.saat.t, olay: (o) => { e.isci.signal(guc.sinyal()); e.yon.olay(o) } })
  guc.yokla()
  g = { prizde: false, pil: 82, sarj: 'bosaliyor' }
  guc.yokla()
  t.is(e.yon.gecmis.length, 0, 'kısa kesinti uyarı değil')
  e.internetAc(true)
  e.saat.t += 2 * DK
  guc.yokla()
  t.is(e.yon.gecmis.length, 1)
  const s = e.yon.gecmis[0]
  t.is(s.tur, 'elektrik')
  t.is(s.normal, 3, 'Kerem ve Hüsniye (ebeveyn), İrem (yetişkin); Ecem (çocuk) değil — Acil 05 §3')
  t.absent(e.normal.includes(kim('ecem')))
  const r = bagla(e.kutu.motor.oturum(AF.KIMLIK.ecem.memberId), e.tel.ecem.motor.oturum(AF.KIMLIK.kutu.memberId))
  t.ok(r.bitti)
  const u = e.tel.ecem.alerts()
  t.alike(u.map((x) => [x.tur, x.seviye, x.pil]), [['elektrik', 0, 82]], 'çocuk yerel bağla alır; pil iç alanda')
  t.is(e.yon.olay({ tur: 'degisti' }), null, 'değişiklik olayı uyarı değil')
})

test('D88 kutu: yalnız bağlı cihazdan ve yalnız UYARI önceliğinde taşır; işçi olmayan göndermez; yakındakiler budanır', (t) => {
  const e = ev()
  const r = e.isci.sendAlert({ tur: 'deprem', seviye: 2 })
  const govde = r.govdeler[0].govde
  t.alike(e.kutu.fromWorker(govde, AF.KIMLIK.kerem.memberId), { tasindi: false, neden: 'INVALID_SOURCE' }, 'üyeden değil')
  t.alike(e.kutu.fromWorker(b4a.alloc(3), AF.KIMLIK.isci1.memberId).tasindi, false)
  t.alike(e.kutu.fromWorker(govde, AF.KIMLIK.isci1.memberId), { tasindi: true })
  t.alike(e.kutu.fromWorker(govde, AF.KIMLIK.isci1.memberId), { tasindi: false, neden: 'REPLAY' })
  // Kutu olmayan alıcı (misafir) taşımaz
  t.is(e.tel.misafir1.fromWorker(govde, AF.KIMLIK.isci1.memberId).neden, 'NOT_BOX')
  t.is(e.tel.husniye.fromWorker(govde, AF.KIMLIK.isci1.memberId).neden, 'NOT_BOX', 'inceleme 24 madde 3: yalnız kutuda')
  // UYARI olmayan öncelik
  e.saat.t += 15_000
  const metin = e.tel.husniye.send('metin', [kim('kerem')], 'x')
  const mg = require('../../core/disaster/message').kodla(0xb0, e.tel.husniye.depo.giden.get(metin[0]).m)
  t.is(e.kutu.fromWorker(mg, AF.KIMLIK.isci1.memberId).neden, 'INVALID_PRIORITY')
  t.exception(() => e.tel.husniye.sendAlert({ tur: 'deprem' }), /DISASTER_CANNOT_SEND/, 'telefon UYARI gönderemez')
  t.exception(() => e.isci.sendAlert({ tur: 'yangin' }), /DISASTER_ALERT_TYPE/)
  t.exception(() => e.isci.sendAlert({ tur: 'deprem', seviye: -1 }), /DISASTER_FIELD_ALARM/)
  t.is(r.govdeler.find((x) => x.to === kim('ecem')).rol, 'cocuk')
  // Yakındakiler 10 dk sonra düşer; DHT oturumu sayılmaz
  e.yakin.gordu(kim('irem'), 'bluetooth')
  e.yakin.gordu(kim('kerem'), 'dht')
  t.alike(e.yakin.liste(), [kim('irem')])
  e.saat.t += 11 * DK
  t.alike(e.yakin.liste(), [])
})

test('D90 madde 1: deprem elektrik sınırını beklemez; sınıra takılan uyarı bir kez yeniden denenir; hata süreci düşürmez', (t) => {
  const e = ev()
  const zamanlar = []
  e.yon.z = { setTimeout: (fn, ms) => { zamanlar.push({ fn, ms }); return null } }
  t.is(e.yon.olay({ tur: 'kesinti', an: AN }).tur, 'elektrik')
  e.saat.t += 30_000
  const d = e.yon.olay({ tur: 'deprem', an: e.saat.t, seviye: 5 })
  t.is(d.mids.length, 4, 'açıklama 3: deprem ve elektrik ayrı sayılır')
  e.saat.t += 10_000
  const ikinci = e.yon.olay({ tur: 'deprem', an: e.saat.t, seviye: 6 })
  t.is(ikinci.hata, 'DISASTER_SEND_LIMIT')
  t.is(zamanlar.length, 1)
  t.is(zamanlar[0].ms, 50_000, 'sınır kalkınca')
  e.saat.t += 50_000
  zamanlar[0].fn()
  t.is(e.yon.gecmis.at(-1).mids.length, 4, 'yeniden denendi ve gitti')
  // Kalıcı hata: bir kez denenir, sonra bırakılır
  const kotu = new UyariYoneticisi({ afet: { sendAlert: () => { throw new Error('NO_FAMILY') } }, yakin: e.yakin, zamanlayici: { setTimeout: (fn) => { fn(); return null } } })
  const r = kotu.olay({ tur: 'deprem', seviye: 1 })
  t.is(r.hata, 'NO_FAMILY')
  t.is(kotu.gecmis.length, 2, 'ilk deneme ve tek yeniden deneme')
})

test('D90 madde 3, 4, 5: komşu kotası; yakındakiler aktif üyelerle süzülür ve en çok 16; gürültü süzgeci ve seviye sınırı', (t) => {
  const e = ev()
  const { YAKIN_EN_COK } = require('../disaster')
  // Kota: aynı kaynaktan 10 dk'da 100'den fazla yeni mesaj taşınmaz
  for (let i = 0; i < 100; i++) e.kutu.motor.komsular.kabulEt(kim('isci1'), e.saat.t)
  const r = e.isci.sendAlert({ tur: 'deprem', seviye: 1 })
  t.is(e.kutu.fromWorker(r.govdeler[0].govde, AF.KIMLIK.isci1.memberId).neden, 'KOTA')
  // Yakındakiler: yalnız aktif telefon üyeleri, en çok 16 (ct ≤ 420)
  const D = require('../../core/disaster/audit')
  const y = new YakinKaydi({ saat: () => e.saat.t, uyeMi: (k) => D.kimlikTuru(L, k) === 'telefon' })
  y.gordu(kim('husniye'), 'yerel')
  y.gordu(kim('kutu'), 'yerel')
  y.gordu(kim('misafir1'), 'yerel')
  y.gordu(kim('uc1'), 'yerel')
  t.alike(y.liste(), [kim('husniye')], 'kutu, misafir ve çıkarılmış cihaz süzüldü')
  const z = new YakinKaydi({ saat: () => e.saat.t })
  for (let i = 0; i < 40; i++) { e.saat.t += 1; z.gordu(b4a.toString(b4a.alloc(16, i), 'hex'), 'yerel') }
  t.is(z.liste().length, YAKIN_EN_COK)
  t.ok(z.liste().includes(b4a.toString(b4a.alloc(16, 39), 'hex')), 'en yeniler')
  t.ok(e.isci.sendAlert({ tur: 'elektrik', yakindakiler: z.liste() }).mids.length, '16 kişiyle sınır içinde (DISASTER_LENGTH yok)')
  // Gürültü: tek örnek uyarı üretmez; art arda iki örnek (1 sn içinde) üretir; seviye ≤ 100
  const sensor = new SensorBenzetimi({ saat: () => e.saat.t })
  const olaylar = []
  const alg = new DepremAlgilayici({ sensor, esik: 300, olay: (o) => olaylar.push(o) })
  sensor.olc(900)
  e.saat.t += 2000
  sensor.olc(900)
  t.is(olaylar.length, 0, 'iki örnek arası 1 sn\'den uzun: tek örnek sayılır')
  e.saat.t += 200
  sensor.olc(950)
  t.is(olaylar.length, 1)
  t.is(olaylar[0].seviye, 100, 'seviye üst sınırı')
  sensor.olc(100)
  t.alike(alg.seri, [])
  alg.durdur()
})

test('Codex 12. tur: kutunun ve işçinin afet deposu kalıcı (RFC-0012 §8.3); yeniden başlayınca taşınan UYARI durur', async (t) => {
  const { kutuAfeti } = require('../box')
  const { isciAfetleri } = require('../worker')
  // Kalici.afetSaklama yerine: durum dosyasına w.kaydet()'te yazılan anahtar/değer
  const sahteW = (kimlik, disk) => {
    const kv = new Map(disk.kv)
    const once = new Set()
    const w = {
      kaydetme: 0,
      kalici: {
        kimlik,
        nesneler: { aile: true, ledger: L },
        afetSaklama: () => ({ kaydetmedenOnce: (fn) => once.add(fn), get: (k) => (kv.has(k) ? JSON.parse(kv.get(k)) : null), set: (k, v) => { if (v === undefined) kv.delete(k); else kv.set(k, JSON.stringify(v)) } })
      },
      kaydet: () => { w.kaydetme++; for (const fn of once) fn(); disk.kv = [...kv] }
    }
    return w
  }
  const disk = { kv: [] }
  const w1 = sahteW(AF.KIMLIK.kutu, disk)
  const k1 = kutuAfeti(() => w1)
  const isci = new DisasterApi({ me: AF.KIMLIK.isci1, defter: () => L })
  const r = isci.sendAlert({ tur: 'deprem', seviye: 2 })
  k1().fromWorker(r.govdeler[0].govde, kim('isci1'))
  t.is(k1().relayed().adet, 1)
  await new Promise((resolve) => setTimeout(resolve, 1100))
  t.ok(w1.kaydetme > 0, 'afet değişikliği durumu kendiliğinden yazdırır')
  // Elektrik gelince kutu yeniden başlar: aynı durumdan
  const k2 = kutuAfeti(() => sahteW(AF.KIMLIK.kutu, disk))
  t.is(k2().relayed().adet, 1, 'taşınan UYARI yeniden başlayınca durur')
  // İşçi: giden kutusundaki UYARI da kalır
  const idisk = { kv: [] }
  const wi = sahteW(AF.KIMLIK.isci1, idisk)
  const af = isciAfetleri({ a: { kok: '/yok' }, wOf: () => wi, gonder: () => false })
  t.is(af.afet().sendAlert({ tur: 'elektrik', seviye: 0 }).mids.length > 0, true)
  wi.kaydet()
  af.kapat()
  const af2 = isciAfetleri({ a: { kok: '/yok' }, wOf: () => sahteW(AF.KIMLIK.isci1, idisk), gonder: () => false })
  t.ok(af2.afet().messages().some((m) => m.yon === 'giden' && m.tur === 'uyari'), 'işçinin giden UYARI\'sı yeniden başlayınca durur')
  af2.kapat()
})

test('Codex 13. tur: afet saklaması değişiklik yokken kendini yeniden zamanlamaz; gerçek değişiklik bir kez yazdırır', async (t) => {
  const { afetSaklamasi } = require('../box')
  const bekle = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const kv = new Map()
  const once = new Set()
  const w = {
    kaydetme: 0,
    kalici: { afetSaklama: () => ({ kaydetmedenOnce: (fn) => once.add(fn), get: (k) => (kv.has(k) ? JSON.parse(kv.get(k)) : null), set: (k, v) => { if (v === undefined) kv.delete(k); else kv.set(k, JSON.stringify(v)) } }) },
    // Kalici.kaydet gibi: kayıttan önce afet deposunun bekleyen yazımı (Depo.kaydet her seferinde aynı değeri yazar)
    kaydet: () => { w.kaydetme++; for (const fn of once) fn() }
  }
  const sakla = afetSaklamasi(w, { gecikmeMs: 10 })
  let depo = { v: 1, sira: 1 }
  sakla.kaydetmedenOnce(() => sakla.set('depo', depo))
  // Gerçek değişiklik: tek zamanlanmış kayıt
  sakla.set('depo', depo)
  await bekle(60)
  t.is(w.kaydetme, 1, 'değişiklik bir kez yazdırır; kendi kaydı yeni zamanlayıcı kurmaz')
  // Dışarıdan 10 kaydetme, depo değişmedi: zamanlayıcı kalmaz
  for (let i = 0; i < 10; i++) w.kaydet()
  await bekle(60)
  t.is(w.kaydetme, 11, 'değişmeyen değer kaydetme zincirini yeniden başlatmaz')
  // Aynı değeri yeniden yazmak da zamanlamaz
  sakla.set('depo', { v: 1, sira: 1 })
  await bekle(40)
  t.is(w.kaydetme, 11)
  // Yeni değişiklik yine yazılır
  depo = { v: 1, sira: 2 }
  sakla.set('depo', depo)
  await bekle(60)
  t.is(w.kaydetme, 12, 'yeni değişiklik yine yazdırır')
  t.alike(JSON.parse(kv.get('depo')), { v: 1, sira: 2 })
  // Silme de değişikliktir
  sakla.set('depo', undefined)
  await bekle(60)
  t.is(w.kaydetme, 13)
})

test('D90 madde 2: üretim bağlantıları — kutunun ağ sarmalı, işçinin afet kurulumu, eşik ayarı, yerel adres', async (t) => {
  const fs = require('fs')
  const os = require('os')
  const path = require('path')
  const { afetAgi } = require('../box')
  const { isciAfetleri, depremEsigi } = require('../worker')
  const { yerelAdresMi } = require('@havenfold/transport')
  const { zarf: { Z } } = require('@havenfold/core')
  // Kutu: bağlı cihazdan gelen AFET_MSG kutunun afetine, üyeden gelen ve diğer türler worklet'e
  const e = ev()
  const giden = []
  let isl = null
  const sarmal = afetAgi({ gonder: () => true, dinle: (x) => { isl = x } }, () => e.kutu, () => L)
  const worklet = []
  sarmal.dinle({ baglandi: () => worklet.push('b'), koptu: () => worklet.push('k'), al: (p, type) => worklet.push(type) })
  const r = e.isci.sendAlert({ tur: 'deprem', seviye: 2 })
  isl.al(kim('isci1'), Z.AFET_MSG, r.govdeler[0].govde, 'dogrudan')
  t.is(e.kutu.relayed().adet, 1, 'işçinin UYARI\'sı kutuda')
  t.is(e.kutu.state().durum, 'etkin')
  isl.al(kim('kerem'), Z.AFET_MSG, r.govdeler[1].govde, 'dogrudan')
  isl.al(kim('isci1'), Z.REC_OPS, b4a.alloc(1), 'dogrudan')
  isl.baglandi(kim('kerem'), {})
  isl.koptu(kim('kerem'))
  t.alike(worklet, [Z.AFET_MSG, Z.REC_OPS, 'b', 'k'], 'üyeden AFET_MSG ve diğerleri worklet\'e')
  t.ok(sarmal.gonder('x', 1, b4a.alloc(1)))
  // İşçi: güç kesintisi UYARI'sı kutuya ve doğrudan oturumu olan uzaktaki üyeye
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-isci-afet-'))
  fs.mkdirSync(path.join(kok, 'etc/havenfold'), { recursive: true })
  fs.writeFileSync(path.join(kok, 'etc/havenfold/dugum.toml'), 'rol = "isci"\ndeprem_esik = 350\n[ag]\ndeprem_esik = 1\n')
  t.is(depremEsigi(kok), 350)
  t.is(depremEsigi(path.join(kok, 'yok')), null)
  const w = { kalici: { kimlik: AF.KIMLIK.isci1, nesneler: { aile: true, ledger: L }, afetSaklama: () => ({ get: () => null, set: () => {} }) }, kaydet: () => {} }
  const hata = console.error
  const yazilan = []
  console.error = (m) => yazilan.push(m)
  const af = isciAfetleri({ a: { kok }, wOf: () => w, gonder: (p, type, govde) => { giden.push([p, type]); return p === kim('kutu') || p === kim('husniye') } })
  console.error = hata
  t.ok(yazilan.some((m) => /sensörü yok/.test(m)), 'eşik var, sensör yok: uyarı verildi')
  t.is(af.deprem, null, 'sensörsüz algılayıcı kurulmaz')
  af.yakin.gordu(kim('husniye'), 'yerel')
  const ozet = af.yonetici.olay({ tur: 'kesinti', an: AN })
  t.is(ozet.kutuya, 4, 'dört UYARI kutuya')
  t.is(ozet.normal, 1, 'doğrudan oturumu olan uzaktaki ebeveyn (Hüsniye)')
  t.ok(giden.every(([, type]) => type === Z.AFET_MSG))
  t.alike(af.afet().alerts(), [])
  af.kapat()
  // Aile yokken
  const af2 = isciAfetleri({ a: { kok: path.join(kok, 'yok') }, wOf: () => ({ kalici: { kimlik: AF.KIMLIK.isci1, nesneler: { aile: false } } }), gonder: () => false })
  t.is(af2.afet(), null)
  t.is(af2.yonetici.olay({ tur: 'kesinti' }).hata, 'NO_FAMILY')
  af2.kapat()
  // Yerel adres: yakındakiler yalnız yerel ağ oturumlarından
  for (const h of ['192.168.1.20', '10.0.0.5', '172.20.1.1', '169.254.3.3', '::ffff:192.168.0.2', 'fe80::1', 'fd00::5']) t.ok(yerelAdresMi(h), h)
  for (const h of ['8.8.8.8', '172.32.0.1', '2001:db8::1', null, undefined]) t.absent(yerelAdresMi(h), String(h))
})

test('saldırı yüzeyi belgesi afet çerçeve sınırını bağ türüne göre ayırır (Codex 13. tur)', (t) => {
  const fs = require('fs')
  const path = require('path')
  const M = require('../../core/disaster/message')
  const Y = require('../../core/disaster/local')
  const belge = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'audit', 'saldiri-yuzeyi.md'), 'utf8')
  const bolum = belge.slice(belge.indexOf('## 12. Afet modu'), belge.indexOf('## 13.'))
  const satir = bolum.split('\n').find((s) => s.startsWith('| Sınır |'))
  t.ok(satir, 'Sınır satırı var')
  const kib = (n) => n % (1024 * 1024) === 0 ? n / (1024 * 1024) + ' MiB' : n / 1024 + ' KiB'
  t.is(kib(M.SINIR.cerceve), '256 KiB')
  t.ok(satir.includes('1 + ' + kib(M.SINIR.cerceve)) && satir.includes('SINIR.cerceve'), 'Bluetooth/Wi-Fi Direct/Multipeer sınırı')
  t.ok(satir.includes('1 + ' + kib(Y.YEREL_CERCEVE)) && satir.includes('YEREL_CERCEVE'), 'yerel ağ sınırı ayrı yazılı')
  t.ok(/yerel ağ bağında en çok 1 \+ 1 MiB/.test(satir), 'yerel ağ bağı 1 MiB')
})
