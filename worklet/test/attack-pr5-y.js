// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// İnceleme 13 düzeltmelerinin (D36, 35bfa08) bağımsız doğrulaması: yeni saldırı testleri.
// Her test DOĞRU davranışı sınar; "not ok" bulgunun doğrulanmasıdır.
// Kaynak: kollar/D-inceleme-14-testler/yeni-saldiri.js (Mac, inceleme 14); D38'de worklet/test/ altına alındı, yalnız
// require yolları, fs (#fs) ve geçici dizin değişti (Bare'de de koşsun diye path yok).
'use strict'
const test = require('brittle')
const b4a = require('b4a')
const fs = require('#fs')
const W = __dirname + '/..'
const { Kalici, Depo } = require(W + '/persistence.js')
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
  const d = __dirname + '/../.gecici/y-' + Date.now().toString(36) + '-' + (sira++)
  fs.mkdirSync(d, { recursive: true })
  t.teardown(() => { try { fs.rmSync(d, { recursive: true, force: true }) } catch {} })
  return d
}
function ac (t, o) {
  const k = new Kalici({ anahtar: ANAHTAR, archivePubHex: ARSIV.pubHex, ...o })
  t.teardown(() => k.kapat())
  return k
}
function keremTelefonu (t, d, o = {}) {
  const k = ac(t, { dizin: d, now: NOW, kimlik: A.K.kerem, ...o })
  const n = k.aileBagla(A.anaDefter())
  return { k, n }
}
// parcalariYaz'ın kopyası (dışa aktarılmıyor): u32 sayı, u32 boylar, parçalar
function parcalar (ps) {
  const boy = b4a.alloc(4 + 4 * ps.length)
  const v = new DataView(boy.buffer, boy.byteOffset, boy.byteLength)
  v.setUint32(0, ps.length)
  ps.forEach((p, i) => v.setUint32(4 + 4 * i, p.byteLength))
  return b4a.concat([boy, ...ps])
}

// ---------------------------------------------------------------------------------------- Y1 (bulgu 1, B1b'nin eksiği)
// B1b, bulgu 1'in düzeltmesi geri alınınca da yeşil kalıyor: başlıksız arsivi bulgu 7'nin denetimi yakalıyor. Saldırgan
// açık kipte BAŞLIKLI arsiv yazarsa (sayaç küçük, tahmin edilebilir) bulgu 1'in düzeltmesinden başka koruma yok.
test('Y1: şifreli dizine açık kipte başlıklı boş arsiv (doğru sayaçla) konursa reddedilmeli', (t) => {
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
  const arsivSayac = k.arsivSayac
  k.kapat()
  const bas = b4a.alloc(12)
  bas.set(b4a.from('HFA1'), 0)
  new DataView(bas.buffer, bas.byteOffset, 12).setBigUint64(4, BigInt(arsivSayac))
  new Depo({ dizin: d, testKipi: true }).yaz('arsiv', parcalar([bas])) // anahtarsız, 0 öğe
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

// ---------------------------------------------------------------------------------------- Y2 (bulgu 3'ün yan etkisi)
// silinecek: kaydı sürüm taşımıyor ve yeni kurulumda temizlenmiyor: kilitliyken sürüm 1'in alındısı, kilitliyken yapılan
// sürüm 2 kurulumunun payını kilit açılınca siler.
test('Y2: kilitliyken sürüm 1 alındısı + kilitliyken sürüm 2 kurulumu: sürüm 2 payı Hüsniye\'ye gidebilmeli', async (t) => {
  const d = dizin(t)
  const { k, n } = keremTelefonu(t, d)
  await n.kasa.setupBackupKey(b4a.alloc(32, 5)) // kilitli; sürüm 1, sahipler Hüsniye, İrem
  const g1 = n.kasa.outgoing()
  k.kaydet() // pay baytları arsive
  const hus = new S.VaultApi({ ledger: n.ledger, me: A.K.husniye, now: NOW })
  const ack = hus.receiveShare(id(A.K.kerem), g1.find((x) => x.to === id(A.K.husniye)).bytes, 'dogrudan')
  t.is(n.kasa.receiveAck(id(A.K.husniye), ack.bytes, 'dogrudan'), 'teslim', 'sürüm 1 alındısı kilitliyken')
  k.kaydet()
  const r2 = await n.kasa.setupBackupKey(b4a.alloc(32, 9)) // kilitliyken döndürme: sürüm 2
  t.is(r2.version, 2)
  k.kaydet()
  n.kasa.unlock(ARSIV.skHex)
  const v2 = n.kasa.outgoing().filter((x) => K.teslim.payTeslimiCoz(x.bytes).share.version === 2).map((x) => x.to).sort()
  const ozet = n.kasa.status().ya
  t.comment('durum: sürüm ' + ozet.version + ', sahipler ' + JSON.stringify(ozet.sahipler.map((s) => [s.id.slice(0, 6), s.teslim])))
  t.alike(v2, [id(A.K.husniye), id(A.K.irem)].sort(), 'sürüm 2 payı iki sahibe de gidecek (bulunan: ' + v2.map((x) => x.slice(0, 6)).join(',') + ')')
})

// ---------------------------------------------------------------------------------------- Y3 (bulgu 7: hlc)
test('Y3: işlemden sonra hlc dosyası silinirse açılış STATE_CORRUPT olmalı', (t) => {
  const d = dizin(t)
  const now = saat()
  const k = new Kalici({ dizin: d, anahtar: ANAHTAR, archivePubHex: ARSIV.pubHex, now })
  const n = k.aileKur({ aileAdi: 'Rivera', benimAdim: 'Alex' })
  const cid = n.kayit.collections().find((x) => x.sensitivity === 'normal' && x.writable).collectionId
  n.kayit.put(cid, null, 'yuva.defter.not', { baslik: 'x' })
  k.kaydet()
  const sayac = k.sayac
  t.comment('durumdaki saat türü: ' + typeof k.goruntu().replika.hlc)
  k.kapat()
  fs.unlinkSync(d + '/hlc')
  let e = null
  try { new Kalici({ dizin: d, anahtar: ANAHTAR, archivePubHex: ARSIV.pubHex, sayac, now }).kapat() } catch (err) { e = err.message }
  t.is(e, 'STATE_CORRUPT', 'hlc silinmesi fark edilmeli (bulunan: ' + (e || 'açıldı') + ')')
})

// ---------------------------------------------------------------------------------------- Y4 (bulgu 7: arsiv sayaç, özet değil)
// arsiv başlığı yalnız sayaç; LOCK (arsivKilitle) arsivi yazar, durumu yazmaz. Ardından kilitliyken gelen pay aynı
// sayaçla ikinci bir arsiv yazdırır. Birinci kopya geri konunca sayaç tutar, pay sessizce gider.
test('Y4: aynı başlık sayaçlı eski arsiv geri konursa (LOCK ile kaydet arasında pay gelmiş) fark edilmeli', async (t) => {
  const d = dizin(t)
  const { k, n } = keremTelefonu(t, d)
  n.kasa.unlock(ARSIV.skHex)
  k.kaydet()
  await n.kasa.setupBackupKey(b4a.alloc(32, 1)) // kasa öğesi değişti (gönderilecek paylar), durum henüz yazılmadı (1 s gecikme)
  n.kasa.lock() // 19 LOCK: arsivKilitle arsivi yazar (başlık sayac+1), durum yazılmaz
  const eski = fs.readFileSync(d + '/arsiv')
  const hus = new S.VaultApi({ ledger: n.ledger, me: A.K.husniye, now: NOW })
  await hus.setupBackupKey(b4a.alloc(32, 6))
  const pay = hus.outgoing().find((x) => x.to === id(A.K.kerem)).bytes
  t.is(n.kasa.receiveShare(id(A.K.husniye), pay, 'dogrudan').durum, 'yeni', 'Hüsniye\'nin payı kilitliyken alındı')
  k.kaydet() // eşitleyici alındıdan önce kaydeder: arsiv (aynı başlık sayacı) + durum
  const sayac = k.sayac
  k.kapat()
  fs.writeFileSync(d + '/arsiv', eski)
  let e = null
  let k2 = null
  try { k2 = ac(t, { dizin: d, now: NOW, sayac }) } catch (err) { e = err.message }
  if (k2) {
    k2.nesneler.kasa.unlock(ARSIV.skHex)
    t.comment('açıldı; tutulan pay sayısı: ' + k2.nesneler.kasa.tutucu.paylar.size + ' (Hüsniye alındıyı aldı, pay teslim sayılıyor)')
  }
  t.ok(e === 'STATE_CORRUPT' || e === 'STATE_ROLLED_BACK', 'eski arsiv reddedilmeli (bulunan: ' + (e || 'açıldı') + ')')
})

// ---------------------------------------------------------------------------------------- Y5 (bulgu 8: kasa dosyaları dizini)
// Kasa kaydı kilitliyken gelir, kilit açılınca çözülür: dizine hiçbir yol eklemez (degisti yalnız gelişte, kayıt
// kimliksiz). Kullanıcı kaydı görür (blobRef arayüzde), dosyayı açmadan kilitler; kilitliyken dosya açılır.
test('Y5: kilitliyken gelen kasa kaydının dosyası, kilit açılıp yeniden kilitlenince açılmamalı', (t) => {
  const d = dizin(t)
  const { k, n } = keremTelefonu(t, d)
  const cid = hex(A.K_KASA)
  n.kasa.unlock(ARSIV.skHex)
  const L2 = A.kopya(n.ledger)
  const hr = A.replika(L2, A.K.husniye)
  for (let i = 0; i < 3; i++) { A.teslim(n.replika, hr); A.teslim(hr, n.replika); n.replika.sync(); hr.sync() }
  t.ok(n.replika.keys.has && [...n.replika.keys.epochs.values()].some((s) => s.cid === cid), 'Kerem\'de Kasa anahtarı var')
  n.kasa.lock()
  k.kaydet()
  // Hüsniye Kasa'ya pasaport taraması ekler; parçalar Kerem'in deposuna (dosya eşitlemesi yerine)
  const hk = new S.RecordApi({ replika: hr, depo: k.dosyalar })
  const { blobRef } = hk.attach({ bytes: b4a.from('PASAPORT TARAMASI'), mime: 'image/jpeg', name: 'p.jpg' })
  const rid = hk.put(cid, null, 'yuva.defter.belge', { ad: 'Pasaport', dosya: blobRef })
  const sonuc = []
  for (const m of hr.outbox.splice(0)) if (m.type === 0x81) sonuc.push(n.replika.receiveOp(m.bytes, m.kind || 0))
  n.kayit.changed(cid, []) // eşitleyicinin _islemler'i: kilitliyken iç kayıt yok, kimlik listesi boş
  t.ok(sonuc.length > 0, 'işlem Kerem\'e geldi (kilitli)')
  n.kasa.unlock(ARSIV.skHex)
  const kayit = n.kayit.get(cid, rid)
  t.ok(kayit && kayit.fields.dosya, 'kilit açıkken kayıt ve blobRef görünüyor')
  t.comment('dizinde mi: ' + n.kayit.kasaDosyalari.has(hex(blobRef.blobId)))
  n.kasa.lock()
  let e = null
  let acilan = null
  try { acilan = n.kayit.open(kayit.fields.dosya, { bytes: true }) } catch (err) { e = err.message }
  if (acilan) t.comment('kilitliyken açıldı: ' + b4a.toString(acilan.bytes))
  t.is(e, 'VAULT_LOCKED', 'kilitliyken kasa dosyası açılmamalı (bulunan: ' + (e || 'açıldı') + ')')
})

// ---------------------------------------------------------------------------------------- Y6 (bulgu 11: işaretleme yolu)
// B11 (D36 uyarlaması) yalnız ön doğrulamayı sınıyor; doğrulamadan sonra yazım yarıda kalırsa işaretleme yolu sınanmıyor.
test('Y6: taşımada ikinci yazım düşerse yeniden denemede ilk kayıt çiftlenmemeli', (t) => {
  const { ledger: { Ledger } } = require('@havenfold/core')
  const km = new S.PersonalMode({ now: () => A.TS0 })
  km.start()
  km.put(null, 'yuva.defter.not', { baslik: 'Wifi' })
  km.put(null, 'yuva.defter.not', { baslik: 'Kapı' })
  const { ledger: L } = S.LedgerApi.createFamily({ Ledger, me: A.K.kerem, displayName: 'Kerem', ts: A.TS0 })
  const kayit = new S.RecordApi({ replika: A.replika(L, A.K.kerem, { now: () => A.TS0 + 1000 }) })
  const kisisel = km.movable(L, A.K.kerem)
  const asil = kayit._yaz.bind(kayit)
  let n = 0
  kayit._yaz = (...a) => { if (++n === 2) throw new Error('COKUS'); return asil(...a) }
  t.is(hataOf(() => km.move(kayit, L, A.K.kerem)), 'COKUS', 'ilk taşıma ikinci kayıtta düştü')
  kayit._yaz = asil
  const sonuc = km.move(kayit, L, A.K.kerem)
  const basliklar = kayit.query(kisisel).map((k) => k.fields.baslik).sort()
  t.alike(basliklar, ['Kapı', 'Wifi'], 'her kayıt bir kez (bulunan: ' + basliklar.join(',') + ')')
  t.alike(sonuc, [{ tur: 'yuva.defter.not', sayi: 2 }])
})
