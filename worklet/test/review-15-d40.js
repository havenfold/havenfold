// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D40 (edfa4d6, 9f3cccc) bağımsız saldırı testleri. Her test DOĞRU davranışı sınar; "not ok" bulgunun doğrulanmasıdır.
// Koşturma: node d40-saldiri.js  |  bare d40-saldiri.js   (W: inceleme çalışma ağacı)
'use strict'
const W = __dirname + '/../..' // D44: depo kökü (kaynak: kollar/D-inceleme-15-testler/d40-saldiri.js)
const NM = '' // paket adları bulunduğu paketten çözülür
const test = require(NM + 'brittle')
const b4a = require(NM + 'b4a')
const { Kalici } = require(W + '/worklet/persistence.js')
const { Esitleyici } = require(W + '/worklet/synchronizer.js')
const { geciciDizin, arsivAnahtari } = require(W + '/worklet/test/helpers/common.js')
const A = require(W + '/core/records/test/helpers/family.js')
const { zarf: { Z } } = require(NM + '@havenfold/core')

const ANAHTAR = b4a.alloc(32, 0x40)
const ESKI = arsivAnahtari(40)
const YENI = arsivAnahtari(41)
const saat = () => { let t = 1_800_000_000_000; return () => t++ }
const hataOf = (f) => { try { f(); return null } catch (err) { return err.message } }
const hex = (b) => (typeof b === 'string' ? b : b4a.toString(b, 'hex'))

function kasali (dizin, now) {
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

// S1: arsiv yeni anahtarla yazıldıktan SONRA durum yazımı düşerse 389 hata döner, ama taşıma işlenmiştir: eski anahtar
// ne bu oturumda ne yeniden açılışta geçer. Belge (D-durum D40, persistence.js yorumu): "yazım düşerse eski dosya ve eski
// anahtar geçerli kalır". Uygulama hatayı görüp yeni anahtar çiftini atarsa kasa kalıcı olarak açılamaz.
test('S1 (D40): arsiv yazıldıktan sonra durum yazımı düşerse 389 ARCHIVE_MOVED_STATE_WRITE_FAILED döner, geçerli anahtar yenisidir', (t) => {
  const dizin = geciciDizin(t)
  const now = saat()
  const { k, n } = kasali(dizin, now)
  const yaz = k.depo.yaz.bind(k.depo)
  let arsivYazildi = false
  k.depo.yaz = (ad, b) => {
    if (ad === 'arsiv') { arsivYazildi = true; return yaz(ad, b) }
    if (ad === 'durum' && arsivYazildi) throw new Error('WRITE_STOPPED') // ör. disk doldu
    return yaz(ad, b)
  }
  const e = hataOf(() => n.kasa.moveArchive(ESKI.skHex, YENI.pubHex))
  k.depo.yaz = yaz
  // D44 uyarlaması (inceleme 15 B1 kararı): arsiv yazıldıysa taşıma işlenmiştir; durum yazımı düşünce ayrı kod döner,
  // geçerli anahtar yenisidir (uygulama ikisini de yeni anahtarla açılış başarılı olana kadar saklar)
  t.is(e, 'ARCHIVE_MOVED_STATE_WRITE_FAILED', '389 taşımanın işlendiğini söyleyen kodla döndü')
  t.is(hataOf(() => n.kasa.unlock(ESKI.skHex)), 'WRONG_LOCK_KEY', 'eski gizli anahtar artık açmaz')
  t.is(hataOf(() => n.kasa.unlock(YENI.skHex)), null, 'yeni gizli anahtar açar')
  try { n.kasa.lock() } catch {}
  const sayac = k.sayac
  k.kapat()
  t.is(hataOf(() => new Kalici({ dizin, anahtar: ANAHTAR, archivePubHex: ESKI.pubHex, sayac, now })), 'ARCHIVE_KEY_MISMATCH', 'yeniden açılışta eski açık anahtar uyuşmazlık der')
  let k3 = null
  t.is(hataOf(() => { k3 = new Kalici({ dizin, anahtar: ANAHTAR, archivePubHex: YENI.pubHex, now }) }), null, 'yeni anahtarla açılıyor')
  if (k3) k3.kapat()
})

// S2: yeni açık anahtar yalnız biçimce denetlenir (64 hex). Sıfır/küçük mertebeli nokta arsivde öğe yokken kabul edilir;
// sonra her mühürleme (crypto_box_seal) düşer, kaydet kalıcı olarak hata verir.
test('S2 (D40): geçersiz yeni açık anahtar (sıfır nokta) reddedilmeli; kabul edilirse sonraki her kaydet düşüyor', (t) => {
  const dizin = geciciDizin(t)
  const now = saat()
  const k = new Kalici({ dizin, anahtar: ANAHTAR, archivePubHex: ESKI.pubHex, now })
  t.teardown(() => k.kapat())
  const n = k.aileKur({ aileAdi: 'Rivera', benimAdim: 'Alex' })
  k.kaydet()
  const e = hataOf(() => n.kasa.moveArchive(ESKI.skHex, '00'.repeat(32)))
  t.is(e, 'INVALID_KEY', 'sıfır açık anahtar reddedilmeli')
  if (e) return
  // Kabul edildiyse: kasa kurulunca (kilitliyken anahtar üretilip hemen mühürlenir) her yazım düşer
  n.defter.myPersonalVault()
  n.kayit.sync()
  const yazim = hataOf(() => k.kaydet())
  t.is(yazim, null, '(sonuç) kaydet düşmemeli; düşüyorsa cihaz artık hiçbir şey yazamaz: ' + yazim)
})

// S3: Kilit açıkken üretilen kasa anahtarının REC_KEY'i (anahtar düz metin, imzalı) çevrimdışı okuyucu için eşitleyicinin
// belleğindeki 'bekleyen'e girer; LOCK'tan sonra orada kalır (RFC-0027 §5 g: "LOCK'ta bellekten silinir"), arsive de
// girmez (yeniden başlatmada kaybolur).
test('S3 (D40 eki): LOCK sonrası kasa REC_KEY (düz anahtar) eşitleyicinin bekleyen kuyruğunda kalmamalı', (t) => {
  const dizin = geciciDizin(t)
  const now = () => A.TS0 + 3_600_000
  const k = new Kalici({ dizin, anahtar: ANAHTAR, archivePubHex: ESKI.pubHex, now, kimlik: A.K.kerem })
  t.teardown(() => k.kapat())
  const n = k.aileBagla(A.kopya(A.anaDefter()))
  const giden = []
  const e = new Esitleyici({ kalici: k, ag: { gonder: (p, type, bytes) => { giden.push({ p, type }) } } })
  k.kaydetmedenOnce = () => e.cikisiBosalt() // start.js'teki bağlama
  const KASA = hex(A.K_KASA)
  n.kasa.unlock(ESKI.skHex)
  const r = n.replika
  let entry = null
  try { entry = r.generateKey(KASA) } catch (err) { t.comment('generateKey: ' + err.message) }
  if (!entry) { t.fail('kasa anahtarı üretilemedi (fikstür)'); return }
  const anahtar = b4a.from(entry.key)
  e.akit()
  const bekleyenKasa = () => [...e.bekleyen.values()].flat().filter((m) => m.type === Z.REC_KEY && b4a.indexOf(m.bytes, anahtar) >= 0)
  t.comment('kilit açıkken bekleyen kasa REC_KEY: ' + bekleyenKasa().length + ' (alıcılar: ' + [...e.bekleyen.keys()].map((x) => x.slice(0, 8)).join(',') + ')')
  n.kasa.lock()
  t.is(k.arsivAcik, false, 'kilitlendi')
  t.is(bekleyenKasa().length, 0, 'kilitliyken düz kasa anahtarı bellekte (esitleyici.bekleyen) kalmamalı')
  // Yeniden başlatmada bu REC_KEY arsivde mi (çevrimdışı okuyucuya hâlâ gidecek mi)
  const sayac = k.sayac
  k.kapat()
  const k2 = new Kalici({ dizin, anahtar: ANAHTAR, archivePubHex: ESKI.pubHex, now, kimlik: A.K.kerem, sayac })
  k2.nesneler.kasa.unlock(ESKI.skHex)
  const cikista = k2.nesneler.replika.outbox.filter((m) => m.type === Z.REC_KEY && b4a.indexOf(m.bytes, anahtar) >= 0).length
  k2.kapat()
  k.kapat = () => {}
  t.is(cikista, 1, 'yeniden başlatmada çevrimdışı okuyucunun kasa REC_KEY\'i arsivden çıkışa dönmeli')
})

// Temiz olması beklenenler (yeşil)
test('T1 (D40): arsiv yazılmadan düşen taşımada yeniden açılışta eski anahtar geçerli (iki anahtarla da açılamama yok)', (t) => {
  const dizin = geciciDizin(t)
  const now = saat()
  const { k, n, cid, rid } = kasali(dizin, now)
  const yaz = k.depo.yaz.bind(k.depo)
  k.depo.yaz = (ad, b) => { if (ad === 'arsiv') throw new Error('WRITE_STOPPED'); return yaz(ad, b) }
  t.is(hataOf(() => n.kasa.moveArchive(ESKI.skHex, YENI.pubHex)), 'WRITE_STOPPED')
  k.depo.yaz = yaz
  const sayac = k.sayac
  k.kapat()
  t.is(hataOf(() => new Kalici({ dizin, anahtar: ANAHTAR, archivePubHex: YENI.pubHex, sayac, now }).kapat()), 'ARCHIVE_KEY_MISMATCH')
  const k2 = new Kalici({ dizin, anahtar: ANAHTAR, archivePubHex: ESKI.pubHex, sayac, now })
  t.teardown(() => k2.kapat())
  k2.nesneler.kasa.unlock(ESKI.skHex)
  t.is(k2.nesneler.kayit.get(cid, rid).fields.parola, 'p4r0l4')
})

test('T2 (D40): taşıma bittikten sonra eski arsiv kopyası geri konursa hiçbir anahtarla açılmaz (STATE_CORRUPT)', (t) => {
  const dizin = geciciDizin(t)
  const now = saat()
  const { k, n } = kasali(dizin, now)
  const eski = k.depo.oku('arsiv')
  n.kasa.moveArchive(ESKI.skHex, YENI.pubHex)
  const sayac = k.sayac
  k.depo.yaz('arsiv', eski) // saldırgan (platform anahtarıyla) eski kopyayı geri koyar
  k.kapat()
  t.is(hataOf(() => new Kalici({ dizin, anahtar: ANAHTAR, archivePubHex: ESKI.pubHex, sayac, now }).kapat()), 'STATE_CORRUPT')
  t.is(hataOf(() => new Kalici({ dizin, anahtar: ANAHTAR, archivePubHex: YENI.pubHex, sayac, now }).kapat()), 'STATE_CORRUPT')
})

test('T3 (D40): kilit açıkken taşıma; bellekteki öğeler yeni anahtara, eski gizli anahtar ne kilit açar ne ikinci taşımayı yapar', (t) => {
  const dizin = geciciDizin(t)
  const now = saat()
  const { k, n, cid, rid } = kasali(dizin, now)
  t.teardown(() => k.kapat())
  n.kasa.unlock(ESKI.skHex)
  n.kayit.put(cid, null, 'yuva.defter.sifre', { ad: 'Kart', parola: 'x' })
  n.kasa.moveArchive(ESKI.skHex, YENI.pubHex)
  n.kasa.lock()
  t.is(hataOf(() => n.kasa.unlock(ESKI.skHex)), 'WRONG_LOCK_KEY')
  t.is(hataOf(() => n.kasa.moveArchive(ESKI.skHex, ESKI.pubHex)), 'WRONG_LOCK_KEY')
  n.kasa.unlock(YENI.skHex)
  t.is(n.kayit.get(cid, rid).fields.parola, 'p4r0l4')
  t.is(n.kayit.query(cid).length, 2)
})
