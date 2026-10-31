// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D33: kasa kurulumu kanalda ve uçtan uca (RFC-0027 §1, §1a, §5 b): kurulum → kasa koleksiyonu → 19 LOCK → okuma ve
// yazma VAULT_LOCKED → 224 UNLOCK → okuma; yeniden açılışta kasa anahtarları yalnız arsivde. Node ve Bare'de koşar.
'use strict'
const test = require('brittle')
const fs = require('#fs')
const b4a = require('b4a')
const { start } = require('..')
const { Depo, coz } = require('../persistence')
const { urunSunucusu, KOMUT } = require('../example/product')
const { geciciDizin, ipcCifti, istemci, hataOf, arsivAnahtari } = require('./helpers/common')

const ANAHTAR = b4a.alloc(32, 0x61)
const ARSIV = arsivAnahtari(11)
const saat = () => { let t = 1_800_000_000_000; return () => t++ }

async function telefon (dizin, now) {
  const ipc = ipcCifti()
  const c = istemci(ipc)
  const w = await start({ urunSunucusu, dizin, now, ipc, anahtar: ANAHTAR, archivePubHex: ARSIV.pubHex, appId: 'ornek' })
  return { w, c }
}

test('kasa uçtan uca: kurulum, kilit, açma; yeniden açılışta anahtarlar yalnız arsivde', async (t) => {
  const dizin = geciciDizin(t)
  const now = saat()
  const a = await telefon(dizin, now)
  await a.c.iste(KOMUT.CREATE_FAMILY, { aileAdi: 'Rivera', benimAdim: 'Alex' })
  t.is(await hataOf(a.c.iste(KOMUT.VAULT_SETUP_VRK, { collectionId: null, kagit: 0 })), 'NOT_RECOVERABLE_ON_LOST_PHONE', 'tek ebeveyn, kâğıtsız kurulamaz')
  const kur = await a.c.iste(KOMUT.VAULT_SETUP_VRK, { collectionId: null, kagit: 2 })
  t.is(kur.koleksiyon.durum, 'uygulandi', 'Kasa koleksiyonu kuruldu (tek ebeveyn)')
  t.alike([kur.version, kur.kagitlar.length], [1, 2])
  const cid = kur.collectionId
  const kol = (await a.c.iste(KOMUT.RECORD_COLLECTIONS)).find((x) => x.collectionId === cid)
  t.alike([kol.name, kol.sensitivity], ['Kasa', 'kasa'])
  // Kilitli başlar
  t.is(await hataOf(a.c.iste(KOMUT.RECORD_PUT, { collectionId: cid, type: 'yuva.defter.sifre', fields: { ad: 'Banka' } })), 'VAULT_LOCKED')
  t.is(await hataOf(a.c.iste(KOMUT.UNLOCK, { archiveKeyHex: 'ab'.repeat(32) })), 'WRONG_LOCK_KEY')
  await a.c.iste(KOMUT.UNLOCK, { archiveKeyHex: ARSIV.skHex })
  const rid = await a.c.iste(KOMUT.RECORD_PUT, { collectionId: cid, type: 'yuva.defter.sifre', fields: { ad: 'Banka', parola: 'p4r0l4' } })
  t.is((await a.c.iste(KOMUT.RECORD_GET, { collectionId: cid, recordId: rid })).fields.parola, 'p4r0l4')
  t.is((await a.c.iste(KOMUT.VAULT_STATUS)).kilitli, false)
  // 19 LOCK
  await a.c.iste(KOMUT.LOCK)
  t.is(await hataOf(a.c.iste(KOMUT.RECORD_GET, { collectionId: cid, recordId: rid })), 'VAULT_LOCKED')
  t.is(await hataOf(a.c.iste(KOMUT.RECORD_PUT, { collectionId: cid, type: 'yuva.defter.sifre', fields: { ad: 'x' } })), 'VAULT_LOCKED')
  t.is(a.w.kalici.nesneler.replika.records(cid).length, 0, 'kilitliyken bellekte çözülmüş kasa kaydı yok')
  await a.c.iste(KOMUT.UNLOCK, { archiveKeyHex: ARSIV.skHex })
  t.is((await a.c.iste(KOMUT.RECORD_GET, { collectionId: cid, recordId: rid })).fields.ad, 'Banka', '224 UNLOCK sonrası okunur')
  // Kasa açıkken arşiv kilidi kasayı da kilitler (Codex 12. tur: VaultApi'de olmayan kilitle() çağrılıyordu)
  a.w.kalici.arsivKilitle()
  t.is((await a.c.iste(KOMUT.VAULT_STATUS)).kilitli, true, 'arşiv kilidi kasayı kilitler')
  a.w.kapat()
  // Yeniden açılış: kasa anahtarı durumda yok, arsivde
  const durum = coz(JSON.parse(b4a.toString(new Depo({ dizin, anahtar: ANAHTAR }).oku('durum'))))
  t.absent(durum.replika.anahtarlar.some((s) => s.cid === cid), 'durumda kasa anahtarı yok')
  t.ok(fs.existsSync(dizin + '/arsiv'))
  const b = await telefon(dizin, now)
  t.is(await hataOf(b.c.iste(KOMUT.RECORD_GET, { collectionId: cid, recordId: rid })), 'VAULT_LOCKED', 'kilitli açılır')
  await b.c.iste(KOMUT.UNLOCK, { archiveKeyHex: ARSIV.skHex })
  t.is((await b.c.iste(KOMUT.RECORD_GET, { collectionId: cid, recordId: rid })).fields.parola, 'p4r0l4', 'arsivden açıldı')
  b.w.kapat()
})

test('387 VAULT_SETUP_BK: sır bayt olarak gelir ({ $b }); sirHex de kabul; sırsız INVALID_SECRET (D36, inceleme 13)', async (t) => {
  const dizin = geciciDizin(t)
  const a = await telefon(dizin, saat())
  t.teardown(() => a.w.kapat())
  await a.c.iste(KOMUT.CREATE_FAMILY, { aileAdi: 'Rivera', benimAdim: 'Alex' })
  const sir = { $b: b4a.toString(b4a.alloc(32, 7), 'base64') }
  const r1 = await a.c.iste(KOMUT.VAULT_SETUP_BK, { sir, yalnizKagit: true })
  t.alike([r1.version, r1.kagitlar.length], [1, 2])
  const r2 = await a.c.iste(KOMUT.VAULT_SETUP_BK, { sirHex: '08'.repeat(32), yalnizKagit: true })
  t.is(r2.version, 2)
  t.is(await hataOf(a.c.iste(KOMUT.VAULT_SETUP_BK, { yalnizKagit: true })), 'INVALID_SECRET')
})

test('kasasız ürün sunucusu: 19 LOCK, 224 UNLOCK, 365 VAULT_STATUS hata alanında KASA_YOK (tel değeri değişmez)', async (t) => {
  const sunucu = urunSunucusu({ nesneler: { aile: {}, kasa: null } })
  for (const [i, komut] of [KOMUT.LOCK, KOMUT.UNLOCK, KOMUT.VAULT_STATUS].entries()) {
    const c = JSON.parse(await sunucu.isle(JSON.stringify({ id: i + 1, komut, govde: {} })))
    t.alike(c, { id: i + 1, hata: 'KASA_YOK' }, 'uygulama KASA_YOK bekler; kod yeniden adlandırılmaz')
  }
})
