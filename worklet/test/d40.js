// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D40: Arşiv anahtarı değişimi (389 VAULT_ARCHIVE_MOVE; RFC-0027 §1a). arsiv eski gizli anahtarla açılıp yeni açık
// anahtara mühürlenir; tek atomik yazım (yarıda kalınca eski dosya geçerli). Beklenenler elle yazıldı.
'use strict'
const test = require('brittle')
const fs = require('#fs')
const b4a = require('b4a')
const { Kalici } = require('../persistence')
const { start } = require('..')
const { urunSunucusu, KOMUT } = require('../example/product')
const { geciciDizin, ipcCifti, istemci, hataOf, hataOfSenk, arsivAnahtari } = require('./helpers/common')

const ANAHTAR = b4a.alloc(32, 0x40)
const ESKI = arsivAnahtari(40)
const YENI = arsivAnahtari(41)
const saat = () => { let t = 1_800_000_000_000; return () => t++ }

function kasali (t, dizin, now) {
  const k = new Kalici({ dizin, anahtar: ANAHTAR, archivePubHex: ESKI.pubHex, now })
  const n = k.aileKur({ aileAdi: 'Rivera', benimAdim: 'Alex' })
  n.defter.myPersonalVault()
  n.kayit.sync()
  const cid = n.kayit.collections().find((x) => x.name === 'Benim kasam').collectionId
  n.kasa.unlock(ESKI.skHex)
  const rid = n.kayit.put(cid, null, 'yuva.defter.sifre', { ad: 'Banka', parola: 'p4r0l4' })
  n.kasa.lock()
  k.kaydet()
  return { k, n, cid, rid }
}

test('389: arsiv yeni anahtara taşınır; yeni gizli anahtarla açılır, eskisiyle açılmaz; yeniden açılışta eski açık anahtar ARCHIVE_KEY_MISMATCH', (t) => {
  const dizin = geciciDizin(t)
  const now = saat()
  const { k, n, cid, rid } = kasali(t, dizin, now)
  const r = n.kasa.moveArchive(ESKI.skHex, YENI.pubHex)
  t.ok(r.oge > 0, 'öğeler yeniden mühürlendi')
  t.is(hataOfSenk(() => n.kasa.unlock(ESKI.skHex)), 'WRONG_LOCK_KEY')
  n.kasa.unlock(YENI.skHex)
  t.is(n.kayit.get(cid, rid).fields.parola, 'p4r0l4')
  n.kasa.lock()
  const sayac = k.sayac
  k.kapat()
  t.is(hataOfSenk(() => new Kalici({ dizin, anahtar: ANAHTAR, archivePubHex: ESKI.pubHex, sayac, now })), 'ARCHIVE_KEY_MISMATCH', 'uygulama yeni anahtarı saklamadan çökerse hangi anahtarın geçerli olduğu anlaşılır')
  const k2 = new Kalici({ dizin, anahtar: ANAHTAR, archivePubHex: YENI.pubHex, sayac, now })
  t.teardown(() => k2.kapat())
  k2.nesneler.kasa.unlock(YENI.skHex)
  t.is(k2.nesneler.kayit.get(cid, rid).fields.parola, 'p4r0l4', 'yeniden açılışta yeni anahtarla')
})

test('389: yanlış eski anahtar WRONG_LOCK_KEY; yazım düşerse eski dosya ve eski anahtar geçerli; bozuk öğede hiçbir şey değişmez', (t) => {
  const dizin = geciciDizin(t)
  const { k, n, cid, rid } = kasali(t, dizin, saat())
  t.teardown(() => k.kapat())
  const once = fs.readFileSync(dizin + '/arsiv')
  t.is(hataOfSenk(() => n.kasa.moveArchive(YENI.skHex, YENI.pubHex)), 'WRONG_LOCK_KEY')
  t.is(hataOfSenk(() => n.kasa.moveArchive(ESKI.skHex, 'zz')), 'INVALID_KEY')
  // Yazım yarıda: atomik yazım düşer, dosya ve anahtar eski
  const yaz = k.depo.yaz.bind(k.depo)
  k.depo.yaz = (ad, b) => { if (ad === 'arsiv') throw new Error('WRITE_STOPPED'); return yaz(ad, b) }
  t.is(hataOfSenk(() => n.kasa.moveArchive(ESKI.skHex, YENI.pubHex)), 'WRITE_STOPPED')
  k.depo.yaz = yaz
  t.ok(b4a.equals(fs.readFileSync(dizin + '/arsiv'), once), 'arsiv değişmedi')
  n.kasa.unlock(ESKI.skHex)
  t.is(n.kayit.get(cid, rid).fields.parola, 'p4r0l4', 'eski anahtar geçerli')
  n.kasa.lock()
  // Bozuk öğe: hiçbir öğe yeniden mühürlenmez
  const a = k._arsivOku()
  const bozuk = b4a.from(a.ogeler[0])
  bozuk[bozuk.byteLength - 1] ^= 1
  k._arsivDosya([bozuk, ...a.ogeler.slice(1)])
  k.kaydet()
  const sonra = fs.readFileSync(dizin + '/arsiv')
  t.is(hataOfSenk(() => n.kasa.moveArchive(ESKI.skHex, YENI.pubHex)), 'STATE_CORRUPT')
  t.ok(b4a.equals(fs.readFileSync(dizin + '/arsiv'), sonra))
})

test('arsiv açılışı yarıda kalınca (bozuk öğe) hiçbir öğe uygulanmaz; yeniden denemede yazımlar çiftlenmez', (t) => {
  const dizin = geciciDizin(t)
  const now = saat()
  const k = new Kalici({ dizin, anahtar: ANAHTAR, archivePubHex: ESKI.pubHex, now })
  t.teardown(() => k.kapat())
  const n = k.aileKur({ aileAdi: 'Rivera', benimAdim: 'Alex' })
  n.defter.myPersonalVault()
  n.kasa.unlock(ESKI.skHex)
  n.kayit.sync() // kasa dönem anahtarı kilit açıkken üretilir
  n.kasa.lock() // arsive mühürlenir, bellekten çıkar
  k.kaydet()
  const a = k._arsivOku()
  const iyi = a.ogeler
  const bozuk = b4a.alloc(80, 1)
  k._arsivDosya([...iyi, bozuk])
  const kuyruk = n.replika.writeQueue.length
  t.is(hataOfSenk(() => n.kasa.unlock(ESKI.skHex)), 'STATE_CORRUPT')
  t.is(n.replika.writeQueue.length, kuyruk)
  const cid = n.kayit.collections().find((x) => x.name === 'Benim kasam').collectionId
  t.absent([...n.replika.keys.epochs.values()].some((x) => x.cid === cid), 'bozuk arsivden hiçbir anahtar yüklenmedi')
  k._arsivDosya(iyi)
  n.kasa.unlock(ESKI.skHex)
  t.ok(k.arsivAcik)
  t.is([...n.replika.keys.epochs.values()].filter((x) => x.cid === cid).length, 1, 'yeniden denemede anahtar bir kez')
})

test('389 kanaldan: { eskiArchiveKeyHex, yeniArchivePubHex }', async (t) => {
  const ipc = ipcCifti()
  const c = istemci(ipc)
  const w = await start({ urunSunucusu, dizin: geciciDizin(t), anahtar: ANAHTAR, archivePubHex: ESKI.pubHex, ipc })
  t.teardown(() => w.kapat())
  await c.iste(KOMUT.CREATE_FAMILY, { aileAdi: 'Rivera', benimAdim: 'Alex' })
  t.is(await hataOf(c.iste(KOMUT.VAULT_ARCHIVE_MOVE, { eskiArchiveKeyHex: YENI.skHex, yeniArchivePubHex: YENI.pubHex })), 'WRONG_LOCK_KEY')
  t.ok((await c.iste(KOMUT.VAULT_ARCHIVE_MOVE, { eskiArchiveKeyHex: ESKI.skHex, yeniArchivePubHex: YENI.pubHex })).oge >= 0)
  await c.iste(KOMUT.UNLOCK, { archiveKeyHex: YENI.skHex })
  t.is((await c.iste(KOMUT.VAULT_STATUS)).kilitli, false)
})

test('kilitliyken kasa dönem anahtarı yeniden üretilmez (anahtar arsivde; her eşitlemede yeni anahtar arsivi büyütüyordu)', (t) => {
  const dizin = geciciDizin(t)
  const k = new Kalici({ dizin, anahtar: ANAHTAR, archivePubHex: ESKI.pubHex, now: saat() })
  t.teardown(() => k.kapat())
  const n = k.aileKur({ aileAdi: 'Rivera', benimAdim: 'Alex' })
  n.defter.myPersonalVault()
  n.kayit.sync()
  k.kaydet()
  const cid = n.kayit.collections().find((x) => x.name === 'Benim kasam').collectionId
  const ogeSay = () => (k._arsivOku() || { ogeler: [] }).ogeler.length
  const oge = ogeSay()
  for (let i = 0; i < 3; i++) { n.kayit.sync(); k.kaydet() }
  t.absent([...n.replika.keys.epochs.values()].some((x) => x.cid === cid), 'kilitliyken bellekte kasa anahtarı yok')
  t.is(ogeSay(), oge, 'arsiv büyümedi')
  n.kasa.unlock(ESKI.skHex)
  t.is([...n.replika.keys.epochs.values()].filter((x) => x.cid === cid).reduce((a, x) => a + x.keys.size, 0), 1, 'açılınca tek anahtar')
})

test('yükseltilmiş dizin (durumda arsivDonemleri yok): kilitliyken kasa anahtarı yeniden üretilmez (D44, inceleme 15)', (t) => {
  const dizin = geciciDizin(t)
  const now = saat()
  const k = new Kalici({ dizin, anahtar: ANAHTAR, archivePubHex: ESKI.pubHex, now })
  const n = k.aileKur({ aileAdi: 'Rivera', benimAdim: 'Alex' })
  n.defter.myPersonalVault()
  n.kasa.unlock(ESKI.skHex)
  n.kayit.sync()
  n.kasa.lock()
  const cid = n.kayit.collections().find((x) => x.name === 'Benim kasam').collectionId
  const sayac = k.sayac
  const oge = k._arsivListe().length
  k.kapat()
  // D40 öncesi durum: arsivDonemleri alanı yok
  const { Depo, kodla, coz } = require('../persistence')
  const depo = new Depo({ dizin, anahtar: ANAHTAR })
  const g = coz(JSON.parse(b4a.toString(depo.oku('durum'))))
  delete g.arsivDonemleri
  depo.yaz('durum', b4a.from(JSON.stringify(kodla(g))))
  const k2 = new Kalici({ dizin, anahtar: ANAHTAR, archivePubHex: ESKI.pubHex, sayac, now })
  t.teardown(() => k2.kapat())
  for (let i = 0; i < 3; i++) { k2.nesneler.kayit.sync(); k2.kaydet() }
  t.absent([...k2.nesneler.replika.keys.epochs.values()].some((x) => x.cid === cid), 'kilitliyken yeni kasa anahtarı yok')
  t.is(k2._arsivListe().length, oge, 'arsiv büyümedi')
  k2.nesneler.kasa.unlock(ESKI.skHex)
  t.is([...k2.nesneler.replika.keys.epochs.values()].filter((x) => x.cid === cid).reduce((a, x) => a + x.keys.size, 0), 1, 'açılınca tek (arsivdeki) anahtar')
})
