// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// start.js testleri: örnek ürün sunucusuyla IPC üstünden aile kurma, kayıt, dosya; kapat–aç sonrası aynı durum;
// bozuk durumda açık hata; geri çağrı
'use strict'
const test = require('brittle')
const fs = require('#fs')
const b4a = require('b4a')
const { start } = require('..')
const { urunSunucusu, KOMUT } = require('../example/product')
const { geciciDizin, ipcCifti, istemci, hataOf, arsivAnahtari } = require('./helpers/common')

const saat = () => { let t = 1_800_000_000_000; return () => t++ }
const ANAHTAR = b4a.alloc(32, 0x42)
const ARSIV = arsivAnahtari()

// Tek örnek (RFC-0027 §5 f): önceki telefon kapatılır; anahtar verilmezse test kipi
let onceki = null
async function telefon (dizin, o = {}) {
  if (onceki && !o.ayniKalsin) { onceki.kapat(); onceki = null }
  const ipc = ipcCifti()
  const c = istemci(ipc, o)
  const w = await start({ urunSunucusu, dizin, now: o.now || saat(), appId: 'ornek', ipc, anahtar: o.anahtar || null, testKipi: !o.anahtar, archivePubHex: o.archivePubHex || (o.anahtar ? ARSIV.pubHex : null), acilanDizin: o.acilanDizin || null })
  onceki = w
  return { w, c, ipc }
}

test('start: aile kur, kayıt yaz, dosya ekle; kapat–aç sonrası aynı kimlik, defter ve kayıtlar', async (t) => {
  const dizin = geciciDizin(t)
  const acilanDizin = geciciDizin(t, 'acilan')
  const now = saat()
  const a = await telefon(dizin, { now, anahtar: ANAHTAR, acilanDizin })
  const bilgi0 = await a.c.iste(KOMUT.FAMILY_INFO)
  t.is(bilgi0.aile, false)
  t.is(await hataOf(a.c.iste(KOMUT.RECORD_COLLECTIONS)), 'NO_IDENTITY')
  t.is(await a.c.iste(KOMUT.CREATE_FAMILY, { aileAdi: 'Rivera', benimAdim: 'Alex' }), null)
  const cols = await a.c.iste(KOMUT.RECORD_COLLECTIONS)
  const cid = cols.find((x) => x.name === 'Tüm Aile').collectionId
  const rid = await a.c.iste(KOMUT.RECORD_PUT, { collectionId: cid, type: 'yuva.defter.not', fields: { baslik: 'Kombi', not: 'yıllık bakım Kasım' } })
  const ref = await a.c.iste(KOMUT.RECORD_ATTACH, { bytes: { $b: b4a.toString(b4a.from('fatura'), 'base64') }, mime: 'image/jpeg', name: 'fatura 1.jpg' })
  await a.c.iste(KOMUT.RECORD_PUT, { collectionId: cid, recordId: rid, fields: { fatura: ref } })
  const kayit = await a.c.iste(KOMUT.RECORD_GET, { collectionId: cid, recordId: rid })
  const acik = await a.c.iste(KOMUT.RECORD_OPEN, { blobRef: kayit.fields.fatura })
  t.ok(acik.path.startsWith(acilanDizin + '/'), 'açılan dosya geçici klasörde')
  t.ok(acik.path.endsWith('-fatura_1.jpg'))
  t.alike(fs.readFileSync(acik.path), b4a.from('fatura'))
  const bilgi = await a.c.iste(KOMUT.FAMILY_INFO)
  a.w.kapat()

  const b = await telefon(dizin, { now, anahtar: ANAHTAR, acilanDizin })
  t.alike(await b.c.iste(KOMUT.FAMILY_INFO), bilgi)
  t.alike(await b.c.iste(KOMUT.RECORD_COLLECTIONS), cols)
  t.alike(await b.c.iste(KOMUT.RECORD_GET, { collectionId: cid, recordId: rid }), kayit)
  const acik2 = await b.c.iste(KOMUT.RECORD_OPEN, { blobRef: kayit.fields.fatura })
  t.alike(fs.readFileSync(acik2.path), b4a.from('fatura'))
  b.w.kapat()
  // Diskte açık metin yok (platform anahtarıyla şifreli)
  for (const f of ['durum', 'kimlik']) t.absent(b4a.toString(fs.readFileSync(dizin + '/' + f)).includes('Kombi'))
})

test('start: her komuttan sonra durum yazılır (kapat çağrılmadan süreç düşse de kayıt kalır)', async (t) => {
  const dizin = geciciDizin(t)
  const now = saat()
  const a = await telefon(dizin, { now })
  await a.c.iste(KOMUT.CREATE_FAMILY, { aileAdi: 'Rivera', benimAdim: 'Alex' })
  const cid = (await a.c.iste(KOMUT.RECORD_COLLECTIONS))[0].collectionId
  const rid = await a.c.iste(KOMUT.RECORD_PUT, { collectionId: cid, type: 'yuva.defter.not', fields: { baslik: 'Wifi' } })
  // a kapatılmadı: süreç düştü (durum yazılmadan), aynı dizinden ikinci açılış
  a.w.kapat({ yazmadan: true })
  const b = await telefon(dizin, { now })
  t.is((await b.c.iste(KOMUT.RECORD_GET, { collectionId: cid, recordId: rid })).fields.baslik, 'Wifi')
})

test('start: geri çağrı IPC üstünden uygulamaya gider ve cevabı döner', async (t) => {
  const a = await telefon(geciciDizin(t), { cagri: (j) => ({ gordu: j.veri.soru, tamam: true }) })
  t.alike(await a.c.iste(KOMUT.EXAMPLE_CALLBACK, { soru: 'Kaydedilsin mi?' }), { gordu: 'Kaydedilsin mi?', tamam: true })
})

test('start: bozuk durumda açılış STATE_CORRUPT ile düşer; eksik bağımsız değişkenler', async (t) => {
  const dizin = geciciDizin(t)
  const a = await telefon(dizin)
  await a.c.iste(KOMUT.CREATE_FAMILY, { aileAdi: 'Rivera', benimAdim: 'Alex' })
  a.w.kapat()
  const d = fs.readFileSync(dizin + '/durum'); d[d.length - 1] ^= 1
  fs.writeFileSync(dizin + '/durum', d)
  t.is(await hataOf(telefon(dizin)), 'STATE_CORRUPT')
  t.is(await hataOf(start({ dizin, ipc: ipcCifti() })), 'NO_PRODUCT_SERVER')
  t.is(await hataOf(start({ urunSunucusu, dizin: geciciDizin(t), ipc: ipcCifti() })), 'NO_KEY', 'platform anahtarı zorunlu')
  t.is(await hataOf(start({ urunSunucusu, dizin })), 'NO_IPC')
  t.is(await hataOf(start({ urunSunucusu: () => ({}), dizin: geciciDizin(t), ipc: ipcCifti(), testKipi: true })), 'NO_PRODUCT_SERVER')
})

test('start: disk yazılamazsa yazım düşer ve uygulamaya kalici olayı gider', async (t) => {
  const a = await telefon(geciciDizin(t))
  await a.c.iste(KOMUT.CREATE_FAMILY, { aileAdi: 'Rivera', benimAdim: 'Alex' })
  a.w.kalici.depo.yaz = () => { throw new Error('ENOSPC') }
  const cid = (await a.c.iste(KOMUT.RECORD_COLLECTIONS))[0].collectionId
  // hlc yazılamadığı için yazım da düşer (RFC-0001 §6: işlem gönderilmeden önce kalıcı)
  t.is(await hataOf(a.c.iste(KOMUT.RECORD_PUT, { collectionId: cid, type: 'yuva.defter.not', fields: { baslik: 'x' } })), 'ENOSPC')
  t.alike(a.c.olaylar.find((o) => o.olay === 'persisted' && o.veri.hata), { olay: 'persisted', veri: { hata: 'ENOSPC' } })
  t.ok(a.c.olaylar.some((o) => o.olay === 'persisted' && o.veri.sayac >= 1), 'başarılı yazımda sayaç olayı (RFC-0027 §5 c)')
})

test('start: son telefon kapatılır (tek örnek, sonraki test dosyaları için)', (t) => {
  if (onceki) onceki.kapat()
  onceki = null
  t.pass()
})

test('start: c.zamanla düzenli işi çalıştırır, sonra durumu yazar; hata cekirdek-hata olayı; kancalar ürüne geçer', async (t) => {
  const ipc = ipcCifti()
  const c = istemci(ipc)
  let say = 0
  let cc = null
  const tas = { davet: async () => null }
  const kanal = { var: () => false, birak: () => {} }
  const w = await start({
    dizin: geciciDizin(t), ipc, testKipi: true, now: saat(), torenTasiyici: tas, yerelKanal: kanal,
    urunSunucusu: (x) => { cc = x; return urunSunucusu(x) }
  })
  t.is(cc.torenTasiyici, tas)
  t.is(cc.yerelKanal, kanal)
  const dur = cc.zamanla(() => { say++ }, 10)
  const hata = cc.zamanla(() => { throw new Error('HANDLER_CRASHED') }, 15)
  await new Promise((r) => setTimeout(r, 60))
  dur()
  hata()
  t.ok(say >= 2, 'düzenli çalıştı')
  t.alike(c.olaylar.find((o) => o.olay === 'core-error'), { olay: 'core-error', veri: { hata: 'HANDLER_CRASHED' } })
  w.kapat()
})
