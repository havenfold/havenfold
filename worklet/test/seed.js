// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D35: tanıtım ailesi gerçek çekirdekte (scripts/seed.js). Tohumlanmış dizin start ile açılır, beklenen sayılar
// ürün komutlarıyla okunur. Beklenenler seed-family.js'den elle sayıldı.
'use strict'
const test = require('brittle')
const b4a = require('b4a')
const sodium = require('sodium-native')
const { start } = require('..')
const { urunSunucusu, KOMUT } = require('../example/product')
const { tohumla } = require('../scripts/seed')
const { geciciDizin, ipcCifti, istemci, hataOf, arsivAnahtari } = require('./helpers/common')

const ANAHTAR = b4a.alloc(32)
sodium.randombytes_buf(ANAHTAR)
const ARSIV = arsivAnahtari(21)

async function ac (dizin) {
  const ipc = ipcCifti()
  const c = istemci(ipc)
  const w = await start({ urunSunucusu, dizin, anahtar: ANAHTAR, archivePubHex: ARSIV.pubHex, ipc, appId: 'yuva-defteri' })
  return { w, c }
}

test('tohum ana: Alex\'in telefonu; aile, koleksiyonlar, kayıtlar, dosyalar, dozlar, Kalkan ve kilitli kasa', { timeout: 120000 }, async (t) => {
  const dizin = geciciDizin(t, 'tohum')
  const bas = Date.now()
  const ozet = await tohumla({ dizin, senaryo: 'ana', anahtar: ANAHTAR, archivePubHex: ARSIV.pubHex })
  t.comment('tohum ana: ' + (Date.now() - bas) + ' ms')
  t.alike([ozet.kisi, ozet.dosya, ozet.doz], [4, 10, 11])
  t.is(await hataOf(tohumla({ dizin, senaryo: 'ana', anahtar: ANAHTAR, archivePubHex: ARSIV.pubHex })), 'DIR_NOT_EMPTY', 'dolu dizinin üstüne yazmaz')

  const { w, c } = await ac(dizin)
  t.teardown(() => w.kapat())
  const bilgi = await c.iste(KOMUT.FAMILY_INFO)
  t.alike([bilgi.aile, bilgi.ad, bilgi.me], [true, 'Rivera', ozet.me])
  const kisiler = await c.iste(KOMUT.MEMBERS)
  t.alike(kisiler.map((x) => x.name || x.ad).sort(), ['Rosa', 'Alex', 'Lina', 'Maya'].sort())
  const kol = await c.iste(KOMUT.RECORD_COLLECTIONS)
  const okunan = kol.filter((x) => x.okur).map((x) => x.name)
  t.alike(okunan.sort(), ['Ebeveynler', 'Kalkan', 'Kalkan:Rosa', 'Kasa', 'Kişisel', 'Sağlık:Rosa', 'Tüm Aile'].sort())
  const cid = (ad) => kol.find((x) => x.name === ad && x.okur).collectionId
  const sorgu = (ad, type) => c.iste(KOMUT.RECORD_QUERY, { collectionId: cid(ad), type })
  t.is((await sorgu('Tüm Aile')).length, 31) // 30 tohum kaydı + açılışta yazılan hf.uygulama (RFC-0036, D96)
  t.is((await sorgu('Ebeveynler')).length, 8)
  t.is((await sorgu('Tüm Aile', 'yuva.defter.etkinlik')).length, 3)
  t.is((await sorgu('Sağlık:Rosa', 'yuva.defter.doz')).length, 11)
  t.is((await sorgu('Kalkan:Rosa')).length, 4)
  // Başvurular gerçek kimliklerle: kayıt bağı ve kişi
  const kombi = (await sorgu('Tüm Aile', 'yuva.defter.ev_sistemi'))[0]
  const ev = (await sorgu('Tüm Aile', 'yuva.defter.ev'))[0]
  t.is(kombi.fields.ev, 'kayit:' + cid('Tüm Aile') + '/' + ev.recordId)
  t.is(kombi.fields.son_bakim, '2026-09-15', 'Maya\'nın sonraki yazımı')
  const disci = (await sorgu('Tüm Aile', 'yuva.defter.etkinlik')).find((x) => x.fields.baslik === 'Lina dişçi')
  t.ok(kisiler.some((x) => 'uye:' + (x.personId || x.memberId) === disci.fields.kimler[0]), 'kimler bir kişinin kimliği')
  // Dosya bu telefonda açılır
  const bulasik = (await sorgu('Tüm Aile', 'yuva.defter.ev_cihazi')).find((x) => x.fields.baslik === 'Bulaşık makinesi')
  const acilan = await c.iste(KOMUT.RECORD_OPEN, { blobRef: bulasik.fields.kilavuz })
  t.is(b4a.toString(b4a.from(acilan.bytes.$b, 'base64')).slice(0, 8), '%PDF-1.4')
  // Kasa kilitli; Arşiv anahtarıyla açılır
  t.is(await hataOf(sorgu('Kasa')), 'VAULT_LOCKED')
  t.is(await hataOf(sorgu('Kalkan')), 'VAULT_LOCKED', 'güvenlik kelimesi de kasa duyarlılığında')
  await c.iste(KOMUT.UNLOCK, { archiveKeyHex: ARSIV.skHex })
  t.is((await sorgu('Kasa', 'yuva.defter.sifre')).length, 14)
  // 21 tohum kaydı ve kasa açılınca KRA'yı bilen telefonun yazdığı zarf kaydı (RFC-0027 §9 b)
  t.is((await sorgu('Kasa')).length, 22)
  t.is((await sorgu('Kasa', 'hf.kasa.zarf')).length, 1)
  t.is((await sorgu('Kalkan'))[0].fields.kelime, 'mor çaydanlık')
  const d = (await c.iste(KOMUT.VAULT_STATUS)).kasalar.find((x) => x.ad === 'Kasa')
  t.is(d.kurulu.version, 1)
  t.alike([d.zarf.version, d.zarf.envSeq], [1, 1])
  t.alike(d.kurulu.sahipler.map((x) => x.tur).sort(), ['kagit', 'kisi', 'kisi'])
})

test('tohum: çocuk ek kimlik (kasa ve Ebeveynler görünmez), yetişkin, ailesiz; bilinmeyen senaryo', { timeout: 120000 }, async (t) => {
  const d1 = geciciDizin(t, 'tohum-cocuk')
  const o1 = await tohumla({ dizin: d1, senaryo: 'cocuk', anahtar: ANAHTAR, archivePubHex: ARSIV.pubHex })
  t.alike(Object.keys(o1.koleksiyonlar).sort(), ['Kalkan', 'Kişisel · Lina', 'Tüm Aile'].sort())
  const a = await ac(d1)
  const kol = await a.c.iste(KOMUT.RECORD_COLLECTIONS)
  t.is((await a.c.iste(KOMUT.RECORD_QUERY, { collectionId: kol.find((x) => x.name === 'Tüm Aile').collectionId })).length, 31) // + hf.uygulama (D96)
  t.absent(kol.find((x) => x.name === 'Ebeveynler').okur)
  a.w.kapat()
  const o2 = await tohumla({ dizin: geciciDizin(t, 'tohum-yetiskin'), senaryo: 'yetiskin', anahtar: ANAHTAR, archivePubHex: ARSIV.pubHex })
  t.alike([o2.koleksiyonlar['Sağlık:Rosa'], o2.koleksiyonlar['Kişisel · Rosa'], o2.koleksiyonlar.Kasa], [15, 1, undefined])
  const d3 = geciciDizin(t, 'tohum-yok')
  t.is((await tohumla({ dizin: d3, senaryo: 'yok', anahtar: ANAHTAR, archivePubHex: ARSIV.pubHex })).kisi, 0)
  const b = await ac(d3)
  t.is((await b.c.iste(KOMUT.FAMILY_INFO)).aile, false)
  b.w.kapat()
  t.is(await hataOf(tohumla({ dizin: geciciDizin(t), senaryo: 'misafir', anahtar: ANAHTAR, archivePubHex: ARSIV.pubHex })), 'NO_SCENARIO')
})
