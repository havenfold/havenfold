// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// RFC-0007 §6.4, §12.6, RFC-0026: yetki yardımcısının işlemleri ve sağlık denetimli geri dönüş. Kullanıcı alanında
// geçici bir kök dizinde koşar; systemctl ve sysfs kancadır, hiçbir sistem ayarı değişmez.
const test = require('brittle')
const b4a = require('b4a')
const fs = require('fs')
const path = require('path')
const S = require('../release')
const { Guncelleyici, SAGLIK_MS } = require('../update')
const D = require('./helpers/node-vector')
const { ortam, DEN } = require('./helpers/privilege-env')

const hataOf = async (fn) => { try { await fn(); return null } catch (err) { return err.message } }

test('yetki yardımcısı: işlem başına kullanıcı; liste dışı işlem yok', async (t) => {
  const { y } = ortam()
  t.is(await hataOf(() => y.isle('havenfold-kutu', 'surum-geri', {})), 'UNAUTHORIZED')
  t.is(await hataOf(() => y.isle('baskasi', 'durum-oku', {})), 'UNAUTHORIZED')
  t.is(await hataOf(() => y.isle(DEN, 'kabuk-calistir', {})), 'NOT_LISTED')
  t.is(await hataOf(() => y.isle(DEN, 'usb-yaz', {})), 'NOT_IN_THIS_VERSION')
  t.is(await hataOf(() => y.isle(DEN, 'deneme-denetle', {})), 'UNAUTHORIZED', 'deneme denetimi yalnız kökün zamanlayıcısı')
  t.is(await hataOf(() => y.isle('havenfold-isci', 'paket-ac', {})), 'UNAUTHORIZED', 'çekirdek yalnız sağlık bildirir')
  t.is(await hataOf(() => y.isle(DEN, 'pil-esigi', { start: 39, stop: 80 })), 'INVALID_INPUT')
  t.is(await hataOf(() => y.isle(DEN, 'pil-esigi', { start: 80, stop: 80 })), 'INVALID_INPUT')
  t.alike(await y.isle('root', 'pil-esigi', { start: 60, stop: 80 }), { limit: 'cekirdek', start: 60, stop: 80 })
})

test('paket-ac: bildirimi ve özeti kendisi doğrular; aynı bildirimle yeniden istenirse dizin döner; surum-gec atomik bağlarla', async (t) => {
  const o = ortam()
  const { kok, y, systemctl } = o
  const a = o.yayinla('1.2.3', 1002003)
  t.is(await hataOf(() => y.isle(DEN, 'paket-ac', { ...a.girdi, ozet: '00'.repeat(32) })), 'MANIFEST_ERROR', 'listede olmayan özet')
  t.is(await hataOf(() => y.isle(DEN, 'paket-ac', { ...a.girdi, dosya: '../../etc/passwd' })), 'INVALID_PATH')
  t.is(await hataOf(() => y.isle(DEN, 'paket-ac', { ...a.girdi, surum: '1.2.4' })), 'MANIFEST_ERROR', 'bildirimdeki sürümle aynı olmalı')
  fs.appendFileSync(path.join(kok, a.girdi.dosya), 'x')
  t.is(await hataOf(() => y.isle(DEN, 'paket-ac', a.girdi)), 'DIGEST_MISMATCH', 'bozulmuş paket')
  fs.writeFileSync(path.join(kok, a.girdi.dosya), a.paket)
  t.alike(await y.isle(DEN, 'paket-ac', a.girdi), { dizin: 'opt/havenfold/surumler/1.2.3' })
  const d = path.join(kok, 'opt/havenfold/surumler/1.2.3')
  t.is(fs.statSync(path.join(d, 'bin/havenfold')).mode & 0o777, 0o755)
  t.is(fs.statSync(path.join(d, 'lib/supervisor.js')).mode & 0o777, 0o644)
  t.alike(await y.isle(DEN, 'paket-ac', a.girdi), { dizin: 'opt/havenfold/surumler/1.2.3', zaten: true }, 'yeniden başlamış denetçi aynı sürümü yeniden ister')
  t.is(await hataOf(() => y.isle(DEN, 'surum-gec', { surum: '9.9.9' })), 'UNVERIFIED')
  await y.isle(DEN, 'surum-gec', { surum: '1.2.3' })
  t.is(o.bag('guncel'), 'surumler/1.2.3')
  t.ok(systemctl.some((x) => x[0] === 'restart'))
  t.is(await hataOf(() => y.isle(DEN, 'surum-gec', { surum: '1.2.3' })), 'TRIAL_RUNNING', 'sağlık penceresi açıkken ikinci geçiş yok')
  await o.saglikli('1.2.3')
  const b = o.yayinla('1.2.4', 1002004)
  await y.isle(DEN, 'paket-ac', b.girdi)
  await y.isle(DEN, 'surum-gec', { surum: '1.2.4' })
  t.alike([o.bag('guncel'), o.bag('onceki')], ['surumler/1.2.4', 'surumler/1.2.3'])
  await o.saglikli('1.2.4')
  const e = o.yayinla('1.2.5', 1002005)
  await y.isle(DEN, 'paket-ac', e.girdi)
  const r = await y.isle(DEN, 'surum-gec', { surum: '1.2.5' })
  t.alike(r.silinen, ['1.2.3'], 'en çok iki sürüm dizini')
  await y.isle(DEN, 'surum-geri', {})
  t.is(o.bag('guncel'), 'surumler/1.2.4', 'pencere içinde bir önceki sürüme')
  t.is(await hataOf(() => y.isle(DEN, 'surum-geri', {})), 'NO_TRIAL', 'pencere dışında geri dönüş yok')
  t.alike((await y.isle(DEN, 'durum-oku', {})).bozuk, [1002005])
  t.is(await hataOf(() => y.isle(DEN, 'paket-ac', e.girdi)), 'VERSION_CORRUPT')
})

function guncelleyici (ek = {}) {
  const o = ortam()
  let simdi = 1_800_000_000_000
  o.y.simdi = () => simdi
  const kayitlar = []
  const bekleyenler = []
  const durdur = []
  const durum = { urunler: [{ product: 'havenfold-node', kurulu: 1002002, enYuksek: 1002002, onceki: 0, bozuk: [], channel: 'kararli' }] }
  const g = new Guncelleyici({
    durum,
    kok: () => D.KOK_DURUMU,
    yetki: (islem, girdi) => o.y.isle(DEN, islem, girdi),
    durdur: (n) => durdur.push(n),
    kaydet: (d) => kayitlar.push(JSON.parse(JSON.stringify(d))),
    bekleyenKaydet: (b) => bekleyenler.push(b && { ...b }),
    simdi: () => simdi,
    ...ek
  })
  return { ...o, g, durum, durdur, kayitlar, bekleyenler, ileri: (ms) => { simdi += ms } }
}

async function hazirla (o, surum = '1.2.3', vc = 1002003, ek = {}) {
  const a = o.yayinla(surum, vc, ek)
  return o.g.hazirla({ bildirimBytes: a.bildirim, bildirimYolu: a.girdi.bildirim, paketYolu: a.girdi.dosya, paketOzeti: S.paketOzeti(a.paket), paketBoyu: a.paket.byteLength })
}

test('güncelleme: yardımcı geçişte denetçiyi yeniden başlatıp bağlantı koparsa geçiş olmuş sayılır (Codex 12. tur)', async (t) => {
  const o = guncelleyici({ pencereAcik: () => true })
  t.is(await hazirla(o), 'kur')
  const asil = o.g.k.yetki
  o.g.k.yetki = async (islem, girdi) => { if (islem !== 'surum-gec') return asil(islem, girdi); await asil(islem, girdi); throw new Error('PRIVILEGE_DISCONNECTED') }
  await o.g.gec()
  t.is(o.kayitlar.at(-1).urunler[0].kurulu, 1002003, 'kurulu yeni sürüm (eskiye geri yazılmadı)')
  t.is(o.bekleyenler.at(-1), null, 'bekleyen geri yazılmadı')
  t.not(o.g.hal, 'hata')
  // Bağlanılamadıysa (istek gitmedi) yardımcı hatasıdır: geri alınır
  const p = guncelleyici({ pencereAcik: () => true })
  await hazirla(p)
  p.g.k.yetki = async (islem) => { if (islem === 'surum-gec') throw new Error('NO_PERMISSION') }
  t.is(await hataOf(() => p.g.gec()), 'NO_PERMISSION')
  t.is(p.kayitlar.at(-1).urunler[0].kurulu, 1002002)
  t.is(p.g.hal, 'hata')
})

test('güncelleme: denetçi ve her çekirdek yeni sürümde sağlık bildirirse geçiş tamam, enYuksek olur', async (t) => {
  const o = guncelleyici({ pencereAcik: () => false })
  t.is(await hazirla(o), 'kur')
  t.is(o.g.hal, 'pencere-bekliyor')
  t.is(o.bekleyenler.at(-1).versionCode, 1002003, 'bekleyen kalıcı')
  t.is(o.g.zamaniGeldi(), false, 'kararlı kanalda bakım penceresi beklenir')
  o.g.k.pencereAcik = () => true
  t.is(o.g.zamaniGeldi(), true)
  await o.g.gec()
  t.alike(o.durdur, ['guncelleme'])
  t.is(o.bag('guncel'), 'surumler/1.2.3')
  t.is(o.kayitlar.at(-1).urunler[0].kurulu, 1002003, 'durum geçişten önce yazıldı')
  t.is(o.bekleyenler.at(-1), null)
  t.alike(await o.g.denetciSinandi('1.2.3'), { durum: 'bekle' }, 'denetçinin beyanı yetmez')
  t.is(await o.g.saglikDenetle(), 'bekle')
  t.alike(await o.y.isle('havenfold-kutu', 'saglik-bildir', { surum: '1.2.3' }), { durum: 'bekle' })
  t.is(await hataOf(() => o.y.isle('havenfold-isci', 'saglik-bildir', { surum: '1.2.2' })), 'VERSION_MISMATCH', 'eski sürümün çekirdeği sayılmaz')
  t.alike(await o.y.isle('havenfold-isci', 'saglik-bildir', { surum: '1.2.3' }), { durum: 'gecti' })
  t.is(await o.g.saglikDenetle(), 'gecti')
  t.alike([o.durum.urunler[0].kurulu, o.durum.urunler[0].enYuksek], [1002003, 1002003])
  t.is((await o.y.isle(DEN, 'durum-oku', {})).enYuksek, 1002003)
  t.is(o.g.hal, 'guncel')
})

test('güncelleme: pencerede sağlık gelmezse kökün zamanlayıcısı geri döner; sürüm bozuk ve yeniden denenmez', async (t) => {
  const o = guncelleyici()
  await o.kur('1.2.2', 1002002)
  t.is(await hazirla(o), 'kur')
  await o.g.gec()
  await o.g.denetciSinandi('1.2.3')
  await o.y.isle('havenfold-kutu', 'saglik-bildir', { surum: '1.2.3' }) // işçi bildirmedi
  t.alike(await o.y.isle('root', 'deneme-denetle', {}), { durum: 'bekle', bitis: 1_800_000_000_000 + SAGLIK_MS, acilis: 0 })
  o.ileri(SAGLIK_MS + 1)
  t.is((await o.y.isle('root', 'deneme-denetle', {})).durum, 'geri-alindi')
  t.is(o.bag('guncel'), 'surumler/1.2.2')
  t.is(await o.g.saglikDenetle(), 'geri-alindi')
  t.alike([o.durum.urunler[0].kurulu, o.durum.urunler[0].enYuksek, o.durum.urunler[0].bozuk], [1002002, 1002002, [1002003]])
  t.is(o.g.hal, 'geri-alindi')
  t.is(await hazirla(o), 'yok-say', 'bozuk işaretli sürüm yeniden denenmez')
})

test('güncelleme: önceki sürüm yokken geri dönülemezse başarı sayılmaz; sürüm bozuk, durum hata (Codex 4. tur)', async (t) => {
  const o = guncelleyici()
  t.is(await hazirla(o), 'kur')
  await o.g.gec() // yardımcıda önceki sürüm yok (ilk kurulumun ilk geçişi)
  o.ileri(SAGLIK_MS + 1)
  t.is((await o.y.isle('root', 'deneme-denetle', {})).durum, 'geri-alinamadi')
  t.is(await o.g.saglikDenetle(), 'geri-alinamadi')
  t.alike([o.durum.urunler[0].kurulu, o.durum.urunler[0].enYuksek, o.durum.urunler[0].bozuk], [1002003, 1002002, [1002003]])
  t.is(o.g.hal, 'hata')
  t.is(o.g.hata, 'ROLLBACK_FAILED')
  t.is(await o.g.saglikDenetle(), 'geri-alinamadi', 'tekrar sorulunca da')
})

test('güncelleme: üç açılışta sağlık yoksa geri; acil bildirim pencereyi beklemez; görev en çok 6 saat beklenir', async (t) => {
  const o = guncelleyici()
  await o.kur('1.2.2', 1002002)
  t.is(await hazirla(o), 'kur')
  await o.g.gec()
  t.is((await o.y.isle('root', 'deneme-denetle', { acilis: true })).durum, 'bekle')
  t.is((await o.y.isle('root', 'deneme-denetle', { acilis: true })).durum, 'bekle')
  t.is((await o.y.isle('root', 'deneme-denetle', { acilis: true })).durum, 'geri-alindi', 'üçüncü açılış')
  t.is(o.bag('guncel'), 'surumler/1.2.2')
  // Codex 12. tur: açılış birimi (oneshot, Before=havenfold-denetci) restart'ı beklerse denetçinin başlama işi onu
  // bekler: karşılıklı bekleme. Açılışta yeniden başlatma kuyruğa bırakılır (--no-block)
  t.alike(o.systemctl.at(-1).slice(0, 2), ['--no-block', 'restart'])
  t.absent(o.systemctl.slice(0, -1).some((x) => x.includes('--no-block')), 'zamanlayıcı ve geçiş yolu bekler')
  const p = guncelleyici({ pencereAcik: () => false, gorevler: () => ({ surekli: 0, diger: 1 }) })
  t.is(await hazirla(p, '1.2.3', 1002003, { ek: { urgent: true } }), 'kur')
  t.is(p.g.zamaniGeldi(), false, 'görev çalışıyor')
  p.ileri(6 * 3_600_000)
  t.is(p.g.zamaniGeldi(), true, '6 saat sonra')
})

test('güncelleme: kurulu sürümden düşük bildirim sessizce yok sayılır; yeniden başlayan denetçi bekleyeni kalıcı kayıttan alır', async (t) => {
  const d = guncelleyici()
  d.durum.urunler[0].kurulu = 1002004
  d.durum.urunler[0].enYuksek = 1002004
  t.is(await hazirla(d), 'yok-say')
  t.is(d.g.hal, 'guncel', 'onay-bekliyor değil (RFC-0026 e)')
  const o = guncelleyici({ pencereAcik: () => false })
  t.is(await hazirla(o), 'kur')
  const g2 = new Guncelleyici({ durum: o.durum, bekleyen: o.bekleyenler.at(-1), kok: () => D.KOK_DURUMU, yetki: (i, g) => o.y.isle(DEN, i, g), pencereAcik: () => true })
  t.is(g2.hal, 'pencere-bekliyor')
  t.is(g2.zamaniGeldi(), true)
  await g2.gec()
  t.is(o.bag('guncel'), 'surumler/1.2.3')
})
