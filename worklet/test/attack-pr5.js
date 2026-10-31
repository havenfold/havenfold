// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// PR #5 (kol/cekirdek 39d7e00) bağımsız inceleme: kırmızı testler.
// Her test DOĞRU davranışı sınar; bugünkü kodda "not ok" düşmesi bulgunun doğrulanmasıdır.
// Kaynak: kollar/D-inceleme-13-testler/saldiri-pr5.js (Mac, inceleme 13); D36'da worklet/test/ altına alındı, yalnız
// require yolları ve geçici dizin değişti. worklet/scripts/check.sh Node ve Bare'de koşar.
'use strict'
/* global Bare */
const test = require('brittle')
const b4a = require('b4a')
const fs = typeof Bare !== 'undefined' ? require('bare-fs') : require('fs')
const W = __dirname + '/..'
const { Kalici, Depo, kodla, coz } = require(W + '/persistence.js')
const S = require('@havenfold/sdk')
const K = require('@havenfold/vault')
const A = require(W + '/../core/records/test/helpers/family.js')
const sodium = require('sodium-native')

const ANAHTAR = b4a.alloc(32, 0x42)
const ARSIV = (() => {
  const pk = b4a.alloc(32); const sk = b4a.alloc(32)
  sodium.crypto_box_seed_keypair(pk, sk, b4a.alloc(32, 7))
  return { pubHex: b4a.toString(pk, 'hex'), skHex: b4a.toString(sk, 'hex') }
})()
const hex = (b) => (typeof b === 'string' ? b : b4a.toString(b, 'hex'))
const id = (k) => hex(k.memberId)
const saat = () => { let t = 1_800_000_000_000; return () => t++ }
const NOW = () => A.TS0 + 3_600_000
const hataOf = (f) => { try { f(); return null } catch (err) { return err.message } }

let sira = 0
function dizin (t) {
  const d = __dirname + '/../.gecici/pr5-' + Date.now().toString(36) + '-' + (sira++)
  fs.mkdirSync(d, { recursive: true })
  t.teardown(() => { try { fs.rmSync(d, { recursive: true, force: true }) } catch {} })
  return d
}
const kopyala = (a, b) => fs.writeFileSync(b, fs.readFileSync(a))

function ac (t, o) {
  const k = new Kalici({ anahtar: ANAHTAR, archivePubHex: ARSIV.pubHex, ...o })
  t.teardown(() => k.kapat())
  return k
}
// Üç üyeli aile (ana zincir), Kerem'in telefonu
function keremTelefonu (t, d, o = {}) {
  const k = ac(t, { dizin: d, now: NOW, kimlik: A.K.kerem, ...o })
  const n = k.aileBagla(A.anaDefter())
  return { k, n }
}
function keremYenidenAc (t, d, o = {}) {
  const k = ac(t, { dizin: d, now: NOW, ...o })
  return { k, n: k.nesneler }
}

// ------------------------------------------------------------------------------------------------ B1 düz kip düşürme

test('B1a: şifreli dizine anahtarsız yazılmış açık kip kimlik+durum konursa reddedilmeli (sessiz kimlik değişimi)', (t) => {
  const d = dizin(t)
  const k = new Kalici({ dizin: d, anahtar: ANAHTAR, archivePubHex: ARSIV.pubHex, now: saat() })
  k.aileKur({ aileAdi: 'Rivera', benimAdim: 'Alex' })
  k.kaydet()
  const sayac = k.sayac
  const kurban = id(k.kimlik)
  k.kapat()
  // Saldırgan: platform anahtarı yok. Kendi dizininde açık kipte kimlik+durum üretir, sayacı büyütür, kurbanın üstüne kopyalar.
  const d2 = dizin(t)
  const s = new Kalici({ dizin: d2, testKipi: true, now: saat() })
  s.aileKur({ aileAdi: 'Saldirgan', benimAdim: 'X' })
  s.kaydet()
  const saldirgan = id(s.kimlik)
  s.kapat()
  const dep = new Depo({ dizin: d2, testKipi: true })
  const g = coz(JSON.parse(b4a.toString(dep.oku('durum'))))
  g.sayac = 1e9
  dep.yaz('durum', b4a.from(JSON.stringify(kodla(g))))
  for (const f of ['kimlik', 'durum']) kopyala(d2 + '/' + f, d + '/' + f)
  let e = null
  let k2 = null
  try { k2 = new Kalici({ dizin: d, anahtar: ANAHTAR, archivePubHex: ARSIV.pubHex, sayac, now: saat() }) } catch (err) { e = err.message }
  const kim = k2 ? (id(k2.kimlik) === saldirgan ? 'SALDIRGANIN kimliği' : id(k2.kimlik) === kurban ? 'kurbanın kimliği' : '?') : null
  if (k2) { t.comment('açıldı: ' + kim + ', aile: ' + k2.nesneler.ledger.familyName + ', sayaç ' + k2.sayac); k2.kapat() }
  t.ok(e === 'STATE_CORRUPT' || e === 'STATE_MODE_MISMATCH', 'açılış reddedilmeli (bulunan: ' + (e || kim) + ')')
})

test('B1b: şifreli dizinde arsiv anahtarsız açık kip boş listeyle değiştirilirse fark edilmeli (kasa verisi kaybı)', (t) => {
  const d = dizin(t)
  const now = saat()
  const k = new Kalici({ dizin: d, anahtar: ANAHTAR, archivePubHex: ARSIV.pubHex, now })
  const n = k.aileKur({ aileAdi: 'Rivera', benimAdim: 'Alex' })
  n.defter.myPersonalVault()
  n.kayit.sync()
  const cid = n.kayit.collections().find((x) => x.name === 'Benim kasam').collectionId
  n.kasa.unlock(ARSIV.skHex)
  const rid = n.kayit.put(cid, null, 'yuva.defter.sifre', { ad: 'Banka', parola: 'p4r0l4' })
  k.kaydet()
  const sayac = k.sayac
  k.kapat()
  new Depo({ dizin: d, testKipi: true }).yaz('arsiv', b4a.alloc(4)) // 0 öğe, anahtarsız
  let e = null
  let k2 = null
  try { k2 = new Kalici({ dizin: d, anahtar: ANAHTAR, archivePubHex: ARSIV.pubHex, sayac, now }) } catch (err) { e = err.message }
  if (k2) {
    k2.nesneler.kasa.unlock(ARSIV.skHex)
    const kayit = hataOf(() => k2.nesneler.kayit.get(cid, rid)) || (k2.nesneler.kayit.get(cid, rid) ? 'okundu' : 'RECORD_UNREADABLE')
    t.comment('açıldı; kilit açıldıktan sonra kasa kaydı: ' + kayit)
    k2.kapat()
  }
  t.ok(e === 'STATE_CORRUPT' || e === 'STATE_MODE_MISMATCH', 'açılış reddedilmeli (bulunan: ' + (e || 'açıldı') + ')')
})

test('B1c: şifreli dizinde hlc anahtarsız açık kip 2^64-1 ile değiştirilirse reddedilmeli', (t) => {
  const d = dizin(t)
  const k = new Kalici({ dizin: d, anahtar: ANAHTAR, archivePubHex: ARSIV.pubHex, now: saat() })
  k.aileKur({ aileAdi: 'Rivera', benimAdim: 'Alex' })
  k.kaydet()
  const sayac = k.sayac
  k.kapat()
  new Depo({ dizin: d, testKipi: true }).yaz('hlc', b4a.alloc(8, 0xff))
  let e = null
  let k2 = null
  try { k2 = new Kalici({ dizin: d, anahtar: ANAHTAR, archivePubHex: ARSIV.pubHex, sayac, now: saat() }) } catch (err) { e = err.message }
  if (k2) { t.comment('açıldı; replika.hlc.last = ' + k2.nesneler.replika.hlc.last); k2.kapat() }
  t.ok(e === 'STATE_CORRUPT' || e === 'STATE_MODE_MISMATCH', 'açılış reddedilmeli (bulunan: ' + (e || 'açıldı') + ')')
})

// ------------------------------------------------------------------------------------------------ B2 kasa anahtarı durumda

test('B2: kasa dönem anahtarı çıkış kutusundaki REC_KEY ile durum dosyasına giriyor ve kilitliyken bellekte kalıyor', async (t) => {
  const d = dizin(t)
  const k = new Kalici({ dizin: d, anahtar: ANAHTAR, archivePubHex: ARSIV.pubHex, now: saat() })
  t.teardown(() => k.kapat())
  const n = k.aileKur({ aileAdi: 'Rivera', benimAdim: 'Alex' })
  n.kasa.unlock(ARSIV.skHex)
  const r = await n.kasa.setupRecoveryKey(null, null, { kagit: 2 }) // 388: Kasa koleksiyonu kurulur (tek ebeveyn)
  n.kayit.sync()
  const cid = r.collectionId
  const ep = [...n.replika.keys.epochs.values()].find((s) => s.cid === cid)
  t.ok(ep, 'Kasa koleksiyonunun dönem anahtarı üretildi')
  const anahtarHex = hex([...ep.keys.values()][0].key)
  n.kasa.lock() // 19 LOCK
  k.kaydet()
  t.absent([...n.replika.keys.epochs.values()].some((s) => s.cid === cid), '(çalışan kısım) anahtar deposundan çıktı')
  const durum = b4a.toString(new Depo({ dizin: d, anahtar: ANAHTAR }).oku('durum')) // platform anahtarıyla açılan durum
  t.absent(durum.includes(anahtarHex), 'kasa anahtarı durum dosyasında olmamalı (cikis/REC_KEY)')
  t.absent(n.replika.outbox.some((o) => hex(o.bytes).includes(anahtarHex)), 'kilitliyken kasa anahtarı bellekte (outbox) olmamalı')
})

// ------------------------------------------------------------------------------------------------ B3 kilitliyken ACK

test('B3: kilitliyken gelen ACK, öbür sahiplerin bekleyen pay baytlarını siliyor (pay bir daha gönderilemez)', async (t) => {
  const d = dizin(t)
  const { k, n } = keremTelefonu(t, d)
  await n.kasa.setupBackupKey(b4a.alloc(32, 5)) // kilitli; sahipler Hüsniye, İrem (+ kâğıt)
  const g = n.kasa.outgoing()
  t.alike(g.map((x) => x.to).sort(), [id(A.K.husniye), id(A.K.irem)].sort())
  k.kaydet() // gönderilecekler arsive mühürlenir, bellekten çıkar
  const hus = new S.VaultApi({ ledger: n.ledger, me: A.K.husniye, now: NOW })
  const ack = hus.receiveShare(id(A.K.kerem), g.find((x) => x.to === id(A.K.husniye)).bytes, 'dogrudan')
  t.is(n.kasa.receiveAck(id(A.K.husniye), ack.bytes, 'dogrudan'), 'teslim', 'Hüsniye\'nin alındısı (kilitliyken)')
  k.kaydet()
  k.kapat()
  const b = keremYenidenAc(t, d)
  b.n.kasa.unlock(ARSIV.skHex)
  const irem = b.n.kasa.status().ya.sahipler.find((s) => s.id === id(A.K.irem))
  t.is(irem.teslim, false, 'İrem hâlâ bekliyor')
  t.alike(b.n.kasa.outgoing().map((x) => x.to), [id(A.K.irem)], 'İrem\'in payı yeniden gönderilebilmeli')
})

// ------------------------------------------------------------------------------------------------ B4 arsiv kimliği çakışması

test('B4: kilit açıkken aynı sahiplerle yeniden kurulum arsive yazılmıyor; kilitle-aç sonrası eski sürümün payları gidiyor', async (t) => {
  const d = dizin(t)
  const { k, n } = keremTelefonu(t, d)
  n.kasa.unlock(ARSIV.skHex)
  await n.kasa.setupBackupKey(b4a.alloc(32, 1))
  k.kaydet()
  const r2 = await n.kasa.setupBackupKey(b4a.alloc(32, 2)) // kâğıt yenileme ya da döndürme: sürüm 2
  t.is(r2.version, 2)
  k.kaydet()
  n.kasa.lock()
  n.kasa.unlock(ARSIV.skHex)
  const surumler = n.kasa.outgoing().map((x) => K.teslim.payTeslimiCoz(x.bytes).share.version)
  t.alike(surumler, [2, 2], 'gidecek paylar sürüm 2 olmalı (bulunan: ' + surumler.join(',') + ')')
  // Sonuç: sahip sürüm 1'i alır, alındısı 'bilinmiyor' olur, sürüm 2 hiç teslim edilmez
  const hus = new S.VaultApi({ ledger: n.ledger, me: A.K.husniye, now: NOW })
  const x = n.kasa.outgoing().find((y) => y.to === id(A.K.husniye))
  const ack = hus.receiveShare(id(A.K.kerem), x.bytes, 'dogrudan')
  t.is(n.kasa.receiveAck(id(A.K.husniye), ack.bytes, 'dogrudan'), 'teslim', 'gönderilen payın alındısı teslim sayılmalı')
})

// ------------------------------------------------------------------------------------------------ B5 kilitliyken tutucu kuralları

test('B5: kilitliyken tutucu kuralları (DUPLICATE_HOLDER, eski sürümün silinmesi) atlanıyor', async (t) => {
  const d = dizin(t)
  const { k, n } = keremTelefonu(t, d)
  const hus = new S.VaultApi({ ledger: n.ledger, me: A.K.husniye, now: NOW })
  await hus.setupBackupKey(b4a.alloc(32, 6))
  const bana1 = hus.outgoing().find((x) => x.to === id(A.K.kerem)).bytes
  t.is(n.kasa.receiveShare(id(A.K.husniye), b4a.from(bana1), 'dogrudan').durum, 'yeni') // kopya: tutucu girdinin baytlarına başvurur
  k.kaydet() // kilitli: pay arsive, bellekten çıkar
  const m = K.teslim.payTeslimiCoz(bana1)
  const baska = { ...m.share, share: b4a.from(m.share.share) }
  baska.share[0] ^= 1
  const e = hataOf(() => n.kasa.receiveShare(id(A.K.husniye), K.teslim.payTeslimi(baska, m.rootId), 'dogrudan'))
  t.is(e, 'DUPLICATE_HOLDER', 'aynı sürümde farklı pay reddedilmeli (bulunan: ' + (e || 'kabul') + ')')
  k.kaydet()
  await hus.setupBackupKey(b4a.alloc(32, 7)) // sürüm 2 (döndürme)
  const bana2 = hus.outgoing().find((x) => x.to === id(A.K.kerem)).bytes
  n.kasa.receiveShare(id(A.K.husniye), bana2, 'dogrudan')
  k.kaydet()
  n.kasa.unlock(ARSIV.skHex)
  const tut = [...n.kasa.tutucu.paylar.values()]
  t.alike(tut.map((v) => v.share.version), [2], 'yalnız son sürüm tutulmalı (bulunan: ' + tut.map((v) => v.share.version).join(',') + ')')
  const v1 = tut.find((v) => v.share.version === 1)
  if (v1) t.comment('sürüm 1 payı ' + (b4a.equals(v1.share.share, baska.share) ? 'SAHTE olanla değişmiş' : 'özgün'))
})

// ------------------------------------------------------------------------------------------------ B6 cihaz tutucu

test('B6: cihaz tutucuda (kutu, işçi) başka cihaz alındı veriyor ve başkasının payını kabul ediyor', async (t) => {
  const L = A.anaDefter()
  const kerem = new S.VaultApi({ ledger: L, me: A.K.kerem, now: NOW, uygunCihaz: () => true })
  await kerem.setupRecoveryKey(hex(A.K_KASA), b4a.alloc(32, 3), { kagit: 0 })
  const kutu = id(A.K.kutu)
  const isci = id(A.C.isci1)
  t.ok(kerem.status().kasalar.find((x) => x.collectionId === hex(A.K_KASA)).kurulu.sahipler.some((s) => s.tur === 'cihaz' && s.id === kutu), 'kutu KRA payı tutucusu')
  const put = kerem.outgoing().find((x) => x.to === kutu)
  const m = K.teslim.payTeslimiCoz(put.bytes)
  // İşçi, kutunun payını hiç almadan kutu adına alındı yollar
  const sahte = K.teslim.alindi(m.share) // holderId = kutu
  const e1 = hataOf(() => kerem.receiveAck(isci, sahte, 'dogrudan'))
  t.is(e1, 'UNAUTHORIZED', 'kutunun alındısını yalnız kutu verebilmeli (bulunan: ' + (e1 || 'kabul, kutu teslim sayıldı') + ')')
  t.is(kerem.status().kasalar.find((x) => x.collectionId === hex(A.K_KASA)).kurulu.sahipler.find((s) => s.id === kutu).teslim, false, 'kutu hâlâ bekliyor görünmeli')
  // İşçinin tutucusu kutuya ait payı kendisininmiş gibi kabul ediyor
  const isciKasa = new S.VaultApi({ ledger: L, me: A.C.isci1, now: NOW })
  const e2 = hataOf(() => K.teslim.teslimAl(isciKasa.tutucu, id(A.K.kerem), put.bytes))
  t.is(e2, 'WRONG_HOLDER', 'işçi kutunun payını reddetmeli (bulunan: ' + (e2 || 'kabul') + ')')
})

// ------------------------------------------------------------------------------------------------ B7 çocuk yedeği

test('B7: ebeveynin kurduğu çocuk YA yedeği (387 sahip=çocuk) ya reddedilmeli ya da teslim edilebilmeli', async (t) => {
  const L = A.anaDefter()
  // Worklet'teki gibi anahtarları sayılabilen saklama (MemoryStorage'da sahip≠ben anahtarı gidecekler()'de hiç görünmez)
  const m = new Map()
  const saklama = { get: (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), set: (k, v) => m.set(k, JSON.stringify(v)), delete: (k) => m.delete(k), anahtarlar: () => [...m.keys()] }
  const kerem = new S.VaultApi({ ledger: L, me: A.K.kerem, now: NOW, saklama })
  const husniye = new S.VaultApi({ ledger: L, me: A.K.husniye, now: NOW })
  let kur = null
  try { await kerem.setupBackupKey(b4a.alloc(32, 8), { sahip: id(A.K.ecem) }) } catch (err) { kur = err.message }
  let teslim = 'kurulmadı'
  if (!kur) {
    const x = kerem.outgoing().find((y) => y.to === id(A.K.husniye))
    teslim = hataOf(() => husniye.payAl(id(A.K.kerem), x.bytes, 'dogrudan'))
  }
  t.ok(kur !== null || teslim === null, 'kurulum: ' + (kur || 'kabul') + ', Hüsniye\'ye teslim: ' + (teslim || 'tamam'))
})

// ------------------------------------------------------------------------------------------------ B8 arsiv sayaç dışında

test('B8: arsiv silinirse (ya da eski kopyası konursa) açılış fark etmeli; tutulan pay sessizce kayboluyor', async (t) => {
  const d = dizin(t)
  const { k, n } = keremTelefonu(t, d)
  const hus = new S.VaultApi({ ledger: n.ledger, me: A.K.husniye, now: NOW })
  await hus.setupBackupKey(b4a.alloc(32, 6))
  const ack = n.kasa.receiveShare(id(A.K.husniye), hus.outgoing().find((x) => x.to === id(A.K.kerem)).bytes, 'dogrudan')
  t.is(hus.receiveAck(id(A.K.kerem), ack.bytes, 'dogrudan'), 'teslim', 'Hüsniye payı teslim edilmiş sayıyor')
  k.kaydet()
  const sayac = k.sayac
  k.kapat()
  fs.unlinkSync(d + '/arsiv')
  let e = null
  let k2 = null
  try { k2 = new Kalici({ dizin: d, anahtar: ANAHTAR, archivePubHex: ARSIV.pubHex, sayac, now: NOW }) } catch (err) { e = err.message }
  if (k2) {
    k2.nesneler.kasa.unlock(ARSIV.skHex)
    t.comment('açıldı; kilit açıkken tutulan pay sayısı: ' + k2.nesneler.kasa.tutucu.paylar.size)
    k2.kapat()
  }
  t.ok(e === 'STATE_CORRUPT' || e === 'STATE_ROLLED_BACK', 'açılış reddedilmeli (bulunan: ' + (e || 'açıldı') + ')')
})

// ------------------------------------------------------------------------------------------------ B9 kilitliyken kasa dosyası

test('B9: kilitliyken kasa kaydındaki dosya açılıyor (VAULT_LOCKED yerine düz bayt; açılan dosya LOCK silmesine girmiyor)', (t) => {
  const d = dizin(t)
  const k = new Kalici({ dizin: d, anahtar: ANAHTAR, archivePubHex: ARSIV.pubHex, now: saat() })
  t.teardown(() => k.kapat())
  const n = k.aileKur({ aileAdi: 'Rivera', benimAdim: 'Alex' })
  n.defter.myPersonalVault()
  n.kayit.sync()
  const cid = n.kayit.collections().find((x) => x.name === 'Benim kasam').collectionId
  n.kasa.unlock(ARSIV.skHex)
  const { blobRef } = n.kayit.attach({ bytes: b4a.from('PASAPORT TARAMASI'), mime: 'image/jpeg', name: 'pasaport.jpg' })
  n.kayit.put(cid, null, 'yuva.defter.belge', { ad: 'Pasaport', dosya: blobRef })
  t.ok(n.kayit._kasaDosyasi(hex(blobRef.blobId)), 'kilit açıkken dosya kasa dosyası sayılıyor')
  k.kaydet()
  n.kasa.lock() // 19 LOCK
  // D36 uyarlaması: bulgunun nedenini belgeleyen satır tersine döndü (kasa dosyaları dizini kalıcı)
  t.ok(n.kayit._kasaDosyasi(hex(blobRef.blobId)), 'kilitliyken de kasa dosyası sayılıyor (dizinden)')
  let e = null
  let acilan = null
  try { acilan = n.kayit.open(blobRef, { bytes: true }) } catch (err) { e = err.message }
  if (acilan) t.comment('kilitliyken açıldı: ' + b4a.toString(acilan.bytes))
  t.is(e, 'VAULT_LOCKED', 'kilitliyken kasa dosyası açılmamalı')
})

// ------------------------------------------------------------------------------------------------ B10 kişisel mod

test('B10: kişisel mod (353/354) yapay zeka alanlarını onaysız taşıyor (RecordApi.put AI_APPROVAL_REQUIRED derdi)', (t) => {
  const { ledger: { Ledger } } = require('@havenfold/core')
  const km = new S.PersonalMode({ now: () => A.TS0 })
  km.start()
  // D36 uyarlaması: karar 10'dan sonra bu put reddedilir; testin geri kalanı reddi de kabul eder
  hataOf(() => km.put(null, 'yuva.defter.not', { baslik: 'Wifi', _ai: ['baslik'] }))
  const { ledger: L } = S.LedgerApi.createFamily({ Ledger, me: A.K.kerem, displayName: 'Kerem', ts: A.TS0 })
  const kayit = new S.RecordApi({ replika: A.replika(L, A.K.kerem, { now: () => A.TS0 + 1000 }) })
  const kisisel = km.movable(L, A.K.kerem)
  t.is(hataOf(() => kayit.put(kisisel, null, 'yuva.defter.not', { baslik: 'x', _ai: ['baslik'] })), 'AI_APPROVAL_REQUIRED', '(karşılaştırma) genel yazım reddediyor')
  const e = hataOf(() => km.put(null, 'yuva.defter.not', { baslik: 'y', _ai: ['baslik'] })) // ilk put da aynı yoldan geçti
  let tasinan = null
  try { km.move(kayit, L, A.K.kerem); tasinan = kayit.query(kisisel)[0] } catch {}
  t.ok(e === 'AI_APPROVAL_REQUIRED' || !(tasinan && '_ai' in tasinan.fields), 'kişisel mod _ai kabul etmemeli ya da taşımada düşürmeli (taşınan: ' + JSON.stringify(tasinan && tasinan.fields) + ')')
})

test('B11: kişisel mod taşıması (354) yarıda kalırsa yeniden denemede kayıtlar çiftleniyor', (t) => {
  const { ledger: { Ledger } } = require('@havenfold/core')
  const km = new S.PersonalMode({ now: () => A.TS0 })
  km.start()
  km.put(null, 'yuva.defter.not', { baslik: 'Wifi' })
  // D36 uyarlaması: _ai karar 10 ile put'ta reddedildiği için bozuk kayıt yalnız geçersiz _conf taşır (çekirdeğin reddettiği alan)
  const kotu = km.put(null, 'yuva.defter.not', { baslik: 'x', _conf: 'gecersiz' })
  const { ledger: L } = S.LedgerApi.createFamily({ Ledger, me: A.K.kerem, displayName: 'Kerem', ts: A.TS0 })
  const kayit = new S.RecordApi({ replika: A.replika(L, A.K.kerem, { now: () => A.TS0 + 1000 }) })
  const kisisel = km.movable(L, A.K.kerem)
  t.ok(hataOf(() => km.move(kayit, L, A.K.kerem)), 'ilk taşıma düştü')
  km.del(kotu)
  km.move(kayit, L, A.K.kerem)
  const wifi = kayit.query(kisisel).filter((k) => k.fields.baslik === 'Wifi').length
  t.is(wifi, 1, 'Wifi bir kez taşınmalı (bulunan: ' + wifi + ')')
})
