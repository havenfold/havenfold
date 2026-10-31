// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D38: inceleme 14'ün şüphesi ve 1 numaralı satırın notu. Beklenenler elle yazıldı.
'use strict'
const test = require('brittle')
const fs = require('#fs')
const b4a = require('b4a')
const { Kalici, Depo, coz } = require('../persistence')
const { geciciDizin, hataOfSenk, arsivAnahtari } = require('./helpers/common')

const ANAHTAR = b4a.alloc(32, 0x38)
const ARSIV = arsivAnahtari(38)
const saat = () => { let t = 1_800_000_000_000; return () => t++ }

test('arsiv açılışı: anahtar girdisi uygulanmadan önce doğrulanır; geçersiz girdide (dönem özeti uymuyor) hiçbir öğe uygulanmaz', (t) => {
  const k = new Kalici({ dizin: geciciDizin(t), anahtar: ANAHTAR, archivePubHex: ARSIV.pubHex, now: saat() })
  t.teardown(() => k.kapat())
  const n = k.aileKur({ aileAdi: 'Rivera', benimAdim: 'Alex' })
  n.defter.myPersonalVault()
  const cid = n.kayit.collections().find((x) => x.name === 'Benim kasam').collectionId
  n.kasa.unlock(ARSIV.skHex)
  n.kayit.sync()
  n.kayit.put(cid, null, 'yuva.defter.sifre', { ad: 'Banka' })
  const s = [...n.replika.keys.epochs.values()].find((x) => x.cid === cid)
  const entry = [...s.keys.values()][0].entry
  n.kasa.lock()
  // Arsiv: önce geçerli bir bekleyen yazım, sonra dönem özeti değişmiş (çatallanma benzeri) anahtar girdisi
  const yazim = { t: 'y', item: { cid, partial: { recordId: b4a.alloc(16, 1), hlc: 1n, authorId: b4a.from(k.kimlik.memberId) } } }
  const bozukAnahtar = { t: 'a', cid, epochSeq: s.epochSeq, epochHash: b4a.alloc(32, 9), entry }
  k._arsivDosya([...k._arsivListe(), k._muhurle(yazim), k._muhurle(bozukAnahtar)])
  const kuyruk = n.replika.writeQueue.length
  t.is(hataOfSenk(() => n.kasa.unlock(ARSIV.skHex)), 'STATE_CORRUPT')
  t.is(n.replika.writeQueue.length, kuyruk, 'bekleyen yazım eklenmedi')
  t.absent(k.arsivAcik)
  t.absent([...n.replika.keys.epochs.values()].some((x) => x.cid === cid), 'geçerli anahtar da yüklenmedi')
})

test('göç: açık kipe çevrilmiş "sifreli: true" durumu taşınmaz (STATE_MODE_MISMATCH)', (t) => {
  const d = geciciDizin(t)
  const k = new Kalici({ dizin: d, anahtar: ANAHTAR, archivePubHex: ARSIV.pubHex, now: saat() })
  k.aileKur({ aileAdi: 'Rivera', benimAdim: 'Alex' })
  k.kapat()
  // Bütün dosyaları açık kipe çeviren biri (platform anahtarını bilen): durum sifreli: true taşır
  const sif = new Depo({ dizin: d, anahtar: ANAHTAR })
  const acik = new Depo({ dizin: d, testKipi: true })
  const g = coz(JSON.parse(b4a.toString(sif.oku('durum'))))
  t.is(g.sifreli, true, 'şifreli durum bayrağı taşır')
  for (const ad of ['kimlik', 'hlc', 'arsiv', 'durum']) { const b = sif.oku(ad); if (b) acik.yaz(ad, b) }
  for (const f of fs.readdirSync(d + '/dosyalar')) { const b = sif.oku('dosyalar/' + f); if (b) acik.yaz('dosyalar/' + f, b) }
  t.is(hataOfSenk(() => new Kalici({ dizin: d, anahtar: ANAHTAR, archivePubHex: ARSIV.pubHex, now: saat() })), 'STATE_MODE_MISMATCH')
})
