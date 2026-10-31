// SPDX-License-Identifier: Apache-2.0
// D46 (0e01853) düşmanca inceleme — kırmızı testler. Her test, düzeltme yapılınca yeşile dönmesi gereken davranışı
// bekler; bugünkü kodda KIRMIZI olması bulgunun kanıtıdır.
// Koşma (Node):  KOK=<havenfold ağacı> node_modules/.bin/brittle-node kirmizi.js
//        (Bare):  aynı dizinden brittle-bare kirmizi.js  (KOK varsayılanı: bu dizinin yanındaki ../d46)
'use strict'
/* global Bare */
const KOK = __dirname + '/../..' // D49: kollar/D-inceleme-17-testler/kirmizi.js'den
const test = require(KOK + '/node_modules/brittle')
const b4a = require(KOK + '/node_modules/b4a')
const c = require(KOK + '/node_modules/compact-encoding')
const K = require(KOK + '/core/core/protocol/bridge.js')
const { BridgeApi } = require(KOK + '/sdk/bridge.js')

const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const bellek = () => { const m = new Map(); return { m, get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v) } }
const DAKIKA = 60_000
const GUN = 86_400_000
const T0 = 1_790_000_000_000
const ham = (m) => K.ON_EK + K.b64Yaz(c.encode(K.kopru, m))
let sayac = 0
const nonce = () => { const b = b4a.alloc(16); const n = ++sayac; b[0] = (n >>> 24) & 255; b[1] = (n >>> 16) & 255; b[2] = (n >>> 8) & 255; b[3] = n & 255; return b }
const paket = (o = {}) => K.kopruYaz({ from: 'ekip', type: 'mekan.durum.cikis', text: 'Çıktım', at: T0, nonce: nonce(), ...o })

// B1 — 7 gün sonra aynı paket yeniden kabul ediliyor (vektör 18 "yediGunSonra: gecerli" bunu kural yapıyor)
test('B1 [doğrulanmış] yakalanan paket 7 gün + 1 ms sonra yeniden sokulursa reddedilmeli', (t) => {
  let saat = T0
  const yuva = new BridgeApi({ kendi: 'aile', saklama: bellek(), now: () => saat })
  const metin = paket({ at: T0 })
  t.ok(yuva.receive(metin), 'ilk teslim')
  t.is(hataOf(() => yuva.receive(metin)), 'BRIDGE_REPLAY', '7 gün içinde tekrar reddedilir')
  saat += K.NONCE_MS + 1
  t.not(hataOf(() => yuva.receive(metin)), null, '7 gün sonra aynı nonce: bugün KABUL ediliyor (tekrar oynatma)')
})

// B2 — `at` için tazelik penceresi yok: 1970'li ya da bir yıl sonraki paket kabul
test('B2 [doğrulanmış] `at` saklama penceresinin dışındaysa (çok eski ya da çok ileri) reddedilmeli', (t) => {
  const yuva = new BridgeApi({ kendi: 'aile', saklama: bellek(), now: () => T0 })
  t.not(hataOf(() => yuva.receive(paket({ at: 1 }))), null, 'at = 1 ms (1970): bugün kabul')
  t.not(hataOf(() => yuva.receive(paket({ at: T0 - 30 * GUN }))), null, '30 gün önce hazırlanmış paket: bugün kabul')
  t.not(hataOf(() => yuva.receive(paket({ at: T0 + 365 * GUN }))), null, 'bir yıl ileri tarihli paket: bugün kabul')
})

// B3 — nonce defteri sınırsız; her al tüm defteri dolaşır ve bütün nesneyi yeniden yazar (O(n) her çağrı, O(n²) toplam)
test('B3 [doğrulanmış] nonce defteri bir üst sınırla tutulmalı (taşma: bellek/disk ve O(n²) süre)', (t) => {
  const s = bellek()
  let yazilanBayt = 0
  const sayanSaklama = { get: s.get, set: (k, v) => { yazilanBayt += JSON.stringify(v).length; s.set(k, v) } }
  const yuva = new BridgeApi({ kendi: 'aile', saklama: sayanSaklama, now: () => T0 })
  const N = 5000
  const bas = Date.now()
  for (let i = 0; i < N; i++) yuva.receive(paket())
  const sure = Date.now() - bas
  // D49 uyarlaması: her nonce kendi anahtarında (Ş2), silinen null olur (saklamada delete yok)
  const kayit = [...s.m].filter(([k, v]) => k.startsWith('kopru/nonce/') && v !== null).length
  t.comment(`${N} geçerli paket: defterde ${kayit} kayıt, ${sure} ms, saklamaya toplam ${(yazilanBayt / 1e6).toFixed(1)} MB yazıldı`)
  t.ok(kayit <= 1000, `defter sınırlı olmalı (bugün ${kayit})`)
})

// B4 — `from`/`kendi` düz nesnede aranıyor: '__proto__', 'constructor', 'toString' sözleşme dışı TypeError verir
test('B4 [doğrulanmış] `from` = __proto__ / constructor / toString → INVALID_BRIDGE olmalı (bugün TypeError → INTERNAL_ERROR)', (t) => {
  for (const from of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    const m = ham({ v: 1, from, type: 'mekan.durum.cikis', text: 'x', at: T0, nonce: nonce() })
    t.is(hataOf(() => K.kopruCoz(m, { kendi: 'aile' })), 'INVALID_BRIDGE', `from=${from}`)
  }
  t.is(hataOf(() => new BridgeApi({ kendi: '__proto__' })), 'INVALID_BRIDGE', "kendi='__proto__' kurucuda geçiyor")
  t.is(hataOf(() => new BridgeApi({ kendi: 'constructor' })), 'INVALID_BRIDGE', "kendi='constructor' kurucuda geçiyor")
})

// B5 — "boş metin" kuralı görünmez karakterlerle atlatılıyor (vektör 18 ' ' → BRIDGE_TEXT)
test('B5 [doğrulanmış] yalnız görünmez karakterden oluşan metin BRIDGE_TEXT olmalı', (t) => {
  for (const [ad, text] of [['U+200B sıfır genişlik', '​'], ['U+2060 kelime birleştirici', '⁠'], ['U+00AD yumuşak tire', '­'], ['U+200E LRM', '‎'], ['U+0000 NUL', '\u0000'], ['U+034F CGJ', '͏']]) {
    t.is(hataOf(() => K.kopruCoz(paket({ text }), { kendi: 'aile' })), 'BRIDGE_TEXT', ad)
  }
})

// B6 — sürüm işareti ileri uyumsuz: düzeni değişen v2 paketi BRIDGE_VERSION değil INVALID_BRIDGE alır
test('B6 [doğrulanmış] v=2 ve ek alanlı paket BRIDGE_VERSION vermeli ("uygulamayı güncelle" denebilsin)', (t) => {
  const v1 = c.encode(K.kopru, { v: 2, from: 'ekip', type: 'mekan.durum.cikis', text: 'x', at: T0, nonce: nonce() })
  const v2 = K.ON_EK + K.b64Yaz(b4a.concat([v1, b4a.from([3, 0x61, 0x62, 0x63])])) // v2'de eklenmiş varsayımsal alan
  t.is(hataOf(() => K.kopruCoz(v2, { kendi: 'aile' })), 'BRIDGE_VERSION')
})

// Ş1 — kaynak doğrulaması yok: kanala yazabilen herhangi bir uygulama "Mekan Hat'tan" paket üretir
test('Ş1 [şüpheli / RFC sınırı] Mekan Hat olmayan bir yazar from=ekip paketi üretip "iş" etiketi aldırabilmemeli', (t) => {
  const yuva = new BridgeApi({ kendi: 'aile', saklama: bellek(), now: () => T0 })
  // Örn. aynı App Group'taki Yuva Defteri ya da başka bir Eser uygulaması; anahtar, imza, sır gerekmiyor
  const sahte = K.kopruYaz({ from: 'ekip', type: 'mekan.durum.serbest', text: 'Patron: bu akşam 23:00\'e kadar kalıyorum', at: T0, nonce: nonce() })
  // D49 uyarlaması (RFC-0027 §7 a): yazan uygulama platformdan (yön klasörü); paketteki from'a güvenilmez
  t.is(hataOf(() => yuva.receive(sahte, { kaynak: 'aile', uygulama: 'Yuva Defteri' })), 'BRIDGE_SOURCE', 'aile tarafı bir uygulamanın yazdığı from=ekip paketi')
  t.is(yuva.receive(K.kopruYaz({ from: 'ekip', type: 'mekan.durum.giris', text: 'Vardım', at: T0, nonce: nonce() }), { kaynak: 'ekip', uygulama: 'Mekan Hat' }).uygulama, 'Mekan Hat', 'önizleme adı platformdan')
})

// Ş2 — çok süreç: her süreç saklamayı açılışta bir kez okuyup tümünü yazıyorsa (test yardımcısındaki gibi) nonce kaybolur
test('Ş2 [şüpheli] iki süreç aynı saklamayı paylaşınca (uygulama + uzantı) nonce yazımı kaybolmamalı', (t) => {
  const disk = {}
  const surecSaklama = () => { const onbellek = JSON.parse(JSON.stringify(disk)); return { get: (k) => (k in onbellek ? onbellek[k] : null), set: (k, v) => { onbellek[k] = v; Object.assign(disk, JSON.parse(JSON.stringify(onbellek))) } } }
  const p1 = paket()
  const p2 = paket()
  const a = new BridgeApi({ kendi: 'aile', saklama: surecSaklama(), now: () => T0 })
  const b = new BridgeApi({ kendi: 'aile', saklama: surecSaklama(), now: () => T0 })
  a.receive(p1)
  b.receive(p2) // b'nin önbelleği p1'i bilmiyor; diske yalnız p2 yazılır
  const yeni = new BridgeApi({ kendi: 'aile', saklama: surecSaklama(), now: () => T0 + DAKIKA })
  t.is(hataOf(() => yeni.receive(p1)), 'BRIDGE_REPLAY', 'p1 yeniden sokuldu: bugün kabul')
})

// Ş3 — köprü kapatılınca/kişi ayrılınca: kanaldaki eski paket günler sonra da önizlenir; ayrılan kişinin Mekan Hat'ı
// paket üretmeye devam eder (BridgeApi'nin ekip üyeliğinden haberi yok, ayril/cikisAl düğmeleri sıfırlamaz)
test('Ş3 [şüpheli] düğmeler kapatıldıktan 3 gün sonra kanaldaki eski paket önizlenmemeli', (t) => {
  // D49 uyarlaması (RFC-0027 §7 d): düğme kapanınca ya da ayrılınca gönderilmemiş paketler kanaldan silinir
  let saat = T0
  const kanalda = []
  const kanal = { birak: (m) => kanalda.push(m), temizle: () => kanalda.splice(0) }
  const mekan = new BridgeApi({ kendi: 'ekip', saklama: bellek(), now: () => saat, kanal })
  const yuva = new BridgeApi({ kendi: 'aile', saklama: bellek(), now: () => saat })
  mekan.buttons(['mekan.durum.giris'])
  mekan.prepare({ type: 'mekan.durum.giris', text: 'İşe vardım' })
  t.is(kanalda.length, 1)
  mekan.buttons([]) // kişi köprüyü kapattı
  saat += 3 * GUN
  t.is(kanalda.length, 0, 'kanalda önizlenecek eski paket yok')
  // İşten ayrılınca TeamApi köprüyü kapatır
  mekan.buttons(['mekan.durum.giris'])
  mekan.prepare({ type: 'mekan.durum.giris', text: 'İşe vardım' })
  const { ledger: { Ledger } } = require(KOK + '/node_modules/@havenfold/core')
  const S = require(KOK + '/sdk')
  const D0 = require(KOK + '/core/core/test/helpers/ledger')
  const { ledger: L } = S.TeamApi.create({ Ledger, me: D0.K.kerem, isletmeAdi: 'E', displayName: 'Kerem', ts: D0.TS0 })
  const d = new S.LedgerApi({ ledger: L, me: D0.K.kerem, now: () => saat })
  const r = d.addMember({ deviceCert: D0.K.ecem.deviceCert, displayName: 'Ecem', role: 'calisan', ceremonyTranscriptHash: b4a.alloc(32, 7) })
  const y = new S.LedgerApi({ ledger: L, me: D0.K.ecem, now: () => saat }); y.oneriler = d.oneriler; y.sign(r.oneriId)
  new S.TeamApi({ defter: y, now: () => saat, kopru: mekan }).leave({ sil: () => ({}) })
  t.alike([kanalda.length, mekan.buttons()], [0, []], 'ayrılışta düğmeler kapandı, paket silindi')
})
