// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D64: persistence.js'in ölçülmemiş dalları — anahtar ve test kipi retleri, bozuk ve kısa dosyalar, kip uyuşmazlığı,
// dizin kilidi, yazım hataları, geçici dosya artıkları, bozuk durum alanları, arsiv öğelerinin denetimi
/* global Bare */
'use strict'
const test = require('brittle')
const fs = require('#fs')
const b4a = require('b4a')
const sodium = require('sodium-native')
const { Kalici, Depo, DiskDeposu, kodla, coz, atomikYaz, defterGoruntusu, defterKur, replikaGoruntusu, replikaKur, kutuKur, GOCLER } = require('../persistence')
const A = require('../../core/records/test/helpers/family')
const { geciciDizin, hataOfSenk, kaliciAc, arsivAnahtari } = require('./helpers/common')

const ANAHTAR = b4a.alloc(32, 0x5a)
const saat = () => { let t = A.TS0 + 3_600_000; return () => t++ }
const kopyala = (x) => coz(JSON.parse(JSON.stringify(kodla(x))))
const durumYaz = (k, g) => k.depo.yaz('durum', b4a.from(JSON.stringify(kodla(g))))
const hataVe = (f) => { try { f(); return null } catch (err) { return err.message + ':' + (err.dosya || '') } }

// Dosya biçimi: "HFW1" ‖ sürüm ‖ kip ‖ gövde (elle kurulan bozuk dosyalar için)
const zarf = (kip, govde) => b4a.concat([b4a.from('HFW1'), b4a.from([1, kip]), govde])

// persistence.js parcalariYaz'ın aynısı: sayı ‖ uzunluklar ‖ parçalar
function parcalar (liste) {
  const boy = b4a.alloc(4 + 4 * liste.length)
  const v = new DataView(boy.buffer, boy.byteOffset, boy.byteLength)
  v.setUint32(0, liste.length)
  liste.forEach((p, i) => v.setUint32(4 + 4 * i, p.byteLength))
  return b4a.concat([boy, ...liste])
}

// Arsiv başlığı: "HFA2" ‖ sayaç ‖ açık anahtar ya da "HFA1" ‖ sayaç
function arsivBasligi (sayac, pubHex = null) {
  const bas = b4a.alloc(pubHex ? 44 : 12)
  bas.set(b4a.from(pubHex ? 'HFA2' : 'HFA1'), 0)
  new DataView(bas.buffer, bas.byteOffset, 12).setBigUint64(4, BigInt(sayac))
  if (pubHex) bas.set(b4a.from(pubHex, 'hex'), 12)
  return bas
}

function muhurle (x, pubHex) {
  const b = b4a.from(JSON.stringify(kodla(x)))
  const out = b4a.alloc(b.byteLength + sodium.crypto_box_SEALBYTES)
  sodium.crypto_box_seal(out, b, b4a.from(pubHex, 'hex'))
  return out
}

// fs işlevini test süresince değiştirir; test bitince (hata olsa da) eski hâline döner
function degistir (t, ad, yeni) {
  const eski = fs[ad]
  fs[ad] = yeni(eski)
  let geri = false
  const birak = () => { if (!geri) { fs[ad] = eski; geri = true } }
  t.teardown(birak)
  return birak
}

// Aileli bir dizin ve diskteki durumun düzenlenebilir kopyası
function aileliDizin (t, o = {}) {
  const dizin = geciciDizin(t)
  const now = saat()
  const k = kaliciAc({ dizin, now, ...o })
  k.aileKur({ aileAdi: 'Rivera', benimAdim: 'Alex' })
  return { dizin, now, k, g: () => kopyala(k.goruntu()) }
}

// ---------------------------------------------------------------- değer kodlaması

test('d64 kodlama: işlev null olur, undefined ve işlev alanları atlanır', (t) => {
  t.is(kodla(() => 1), null)
  t.alike(kodla({ a: undefined, f () {}, b: 2 }), { b: 2 })
  t.alike(kodla([() => 1, 3]), [null, 3])
})

// ---------------------------------------------------------------- Depo kurulumu ve okuma

test('d64 depo: dizin yok, anahtar yok; sondaki eğik çizgi atılır', (t) => {
  t.is(hataOfSenk(() => new Depo({ dizin: '' })), 'NO_DIR')
  t.is(hataOfSenk(() => new Depo({ dizin: 5, testKipi: true })), 'NO_DIR')
  const dizin = geciciDizin(t)
  t.is(hataOfSenk(() => new Depo({ dizin })), 'NO_KEY', 'anahtarsız ve test kipi olmadan açılmaz')
  t.is(hataOfSenk(() => new Depo({ dizin, testKipi: 'evet' })), 'NO_KEY', 'test kipi yalnız true ile')
  const d = new Depo({ dizin: dizin + '/', testKipi: true })
  t.is(d.dizin, dizin)
  d.yaz('durum', b4a.from('x'))
  t.ok(fs.existsSync(dizin + '/durum'))
})

test('d64 depo: kısa açık ve şifreli gövde, bilinmeyen kip, geçersiz JSON', (t) => {
  const dizin = geciciDizin(t)
  const acik = new Depo({ dizin, testKipi: true })
  fs.writeFileSync(dizin + '/durum', zarf(0, b4a.alloc(10)))
  t.is(hataVe(() => acik.oku('durum')), 'STATE_CORRUPT:durum', 'özetten kısa açık gövde')
  fs.writeFileSync(dizin + '/durum', zarf(7, b4a.alloc(64)))
  t.is(hataVe(() => acik.oku('durum')), 'STATE_CORRUPT:durum', 'bilinmeyen kip baytı')
  const sifreli = new Depo({ dizin, anahtar: ANAHTAR, testKipi: true })
  fs.writeFileSync(dizin + '/durum', zarf(1, b4a.alloc(20)))
  t.is(hataVe(() => sifreli.oku('durum')), 'STATE_CORRUPT:durum', 'nonce ve etiketten kısa şifreli gövde')
  // Geçerli zarf, geçersiz JSON: kimlik okunurken
  const k = aileliDizin(t)
  k.k.depo.yaz('kimlik', b4a.from('{bozuk json'))
  t.is(hataVe(() => kaliciAc({ dizin: k.dizin, now: k.now })), 'STATE_CORRUPT:kimlik')
})

test('d64 depo: dosya yerine dizin — okuma ve silme işletim sistemi hatasını yutmaz', (t) => {
  const dizin = geciciDizin(t)
  const d = new Depo({ dizin, testKipi: true })
  fs.mkdirSync(dizin + '/durum')
  const okuma = hataOfSenk(() => d.oku('durum'))
  t.ok(okuma && okuma !== 'STATE_CORRUPT', 'ENOENT dışındaki okuma hatası olduğu gibi: ' + okuma)
  const silme = hataOfSenk(() => d.sil('durum'))
  t.ok(silme && silme !== 'STATE_CORRUPT', 'ENOENT dışındaki silme hatası olduğu gibi: ' + silme)
  t.ok(fs.statSync(dizin + '/durum').isDirectory())
  t.is(hataOfSenk(() => d.sil('hlc')), null, 'olmayan dosyanın silinmesi sessiz')
})

test('d64 depo: gomme altındaki yarım yazım açılışta silinir', (t) => {
  const dizin = geciciDizin(t)
  new Depo({ dizin, testKipi: true })
  fs.mkdirSync(dizin + '/gomme')
  fs.writeFileSync(dizin + '/gomme/' + 'ab'.repeat(16) + '.tmp-001122334455', b4a.from('yarım'))
  fs.writeFileSync(dizin + '/gomme/' + 'ab'.repeat(16), b4a.from('asıl'))
  new Depo({ dizin, testKipi: true })
  t.alike(fs.readdirSync(dizin + '/gomme').map(String), ['ab'.repeat(16)])
})

// ---------------------------------------------------------------- atomik yazım

test('d64 atomik yazım: 0 dönen yazım WRITE_STOPPED, geçici dosya kalmaz, asıl dosya bozulmaz', (t) => {
  const dizin = geciciDizin(t)
  fs.writeFileSync(dizin + '/durum', b4a.from('eski'))
  const birak = degistir(t, 'writeSync', () => () => 0)
  t.is(hataOfSenk(() => atomikYaz(dizin + '/durum', b4a.from('yeni'))), 'WRITE_STOPPED')
  birak()
  t.alike(fs.readdirSync(dizin).map(String), ['durum'])
  t.alike(fs.readFileSync(dizin + '/durum'), b4a.from('eski'))
})

test('d64 atomik yazım: fsync hatası yukarı çıkar, geçici dosya silinir', (t) => {
  const dizin = geciciDizin(t)
  const birak = degistir(t, 'fsyncSync', () => () => { const e = new Error('EIO'); e.code = 'EIO'; throw e })
  t.is(hataOfSenk(() => atomikYaz(dizin + '/durum', b4a.from('yeni'))), 'EIO')
  birak()
  t.alike(fs.readdirSync(dizin).map(String), [])
})

test('d64 atomik yazım: yeniden adlandırma düşerse geçici dosya silinir', (t) => {
  const dizin = geciciDizin(t)
  // Hedef boş olmayan bir dizin: yeniden adlandırma işletim sisteminde düşer
  fs.mkdirSync(dizin + '/durum')
  fs.writeFileSync(dizin + '/durum/ic', b4a.from('x'))
  const h = hataOfSenk(() => atomikYaz(dizin + '/durum', b4a.from('yeni')))
  t.ok(h, 'yeniden adlandırma hatası: ' + h)
  t.alike(fs.readdirSync(dizin).map(String), ['durum'])
})

test('d64 atomik yazım: dizin eşlemesi düşerse yazım yine tamam (desteklemeyen sistem)', (t) => {
  const dizin = geciciDizin(t)
  // Dosyanın fsync'i geçer, dizinin fsync'i düşer
  let n = 0
  degistir(t, 'fsyncSync', (eski) => (fd) => { if (++n === 2) throw new Error('EINVAL'); return eski(fd) })
  atomikYaz(dizin + '/durum', b4a.from('bir'))
  t.is(n, 2)
  t.alike(fs.readFileSync(dizin + '/durum'), b4a.from('bir'))
  // Dizin açılamazsa (fd yok) kapatma denenmez
  const kapatilan = []
  degistir(t, 'closeSync', (eski) => (fd) => { kapatilan.push(fd); return eski(fd) })
  degistir(t, 'openSync', (eski) => (yol, b) => { if (yol === dizin) throw new Error('EACCES'); return eski(yol, b) })
  atomikYaz(dizin + '/durum', b4a.from('iki'))
  t.is(kapatilan.length, 1, 'yalnız geçici dosyanın tanıtıcısı kapatıldı')
  t.alike(fs.readFileSync(dizin + '/durum'), b4a.from('iki'))
})

test('d64 atomik yazım: kökteki yolda dizin eşlemesi "/" ile', (t) => {
  // Diske dokunmadan: açma, yazma, eşleme, kapatma ve adlandırma sahte
  const acilan = []
  degistir(t, 'openSync', () => (yol) => { acilan.push(yol); return 99 })
  degistir(t, 'writeSync', () => (fd, veri, o, l) => l)
  degistir(t, 'fsyncSync', () => () => {})
  degistir(t, 'closeSync', () => () => {})
  degistir(t, 'renameSync', () => () => {})
  atomikYaz('/havenfold-d64', b4a.from('x'))
  t.is(acilan.length, 2)
  t.ok(acilan[0].startsWith('/havenfold-d64.tmp-'))
  t.is(acilan[1], '/')
})

// ---------------------------------------------------------------- kip göçü

test('d64 göç: durum şifreliyken açık dosya; kimlik açıkken şifreli dosya — STATE_MODE_MISMATCH', (t) => {
  const dizin = geciciDizin(t)
  const acik = new Depo({ dizin, testKipi: true })
  const sifreli = new Depo({ dizin, anahtar: ANAHTAR, testKipi: true })
  // Durum şifreli, hlc açık (göçten sonra konmuş)
  sifreli.yaz('durum', b4a.from('{}'))
  acik.yaz('hlc', b4a.alloc(8))
  t.is(hataVe(() => sifreli.goc()), 'STATE_MODE_MISMATCH:hlc')
  // Durum açık, kimlik açık, hlc şifreli: göç başlamaz
  acik.yaz('durum', b4a.from('{}'))
  acik.yaz('kimlik', b4a.from('{}'))
  sifreli.yaz('hlc', b4a.alloc(8))
  t.is(hataVe(() => sifreli.goc()), 'STATE_MODE_MISMATCH:kimlik')
  // Açık kip deposunda göç yok
  t.is(acik.goc(), 0)
})

test('d64 göç: dosyalar altındaki açık parçalar da taşınır; dosyalar dizini yoksa yalnız kök dosyalar', (t) => {
  const dizin = geciciDizin(t)
  const acik = new Depo({ dizin, testKipi: true })
  const blob = 'cd'.repeat(32)
  acik.yaz('kimlik', b4a.from('k'))
  acik.yaz('dosyalar/' + blob, b4a.from('parça'))
  fs.writeFileSync(dizin + '/dosyalar/benioku', b4a.from('ad kuralına uymayan dosya taşınmaz'))
  acik.yaz('durum', b4a.from('d'))
  const sifreli = new Depo({ dizin, anahtar: ANAHTAR, testKipi: true })
  t.is(sifreli.goc(), 3)
  t.ok(sifreli.gocEdilen.has('dosyalar/' + blob))
  t.alike(sifreli.oku('dosyalar/' + blob), b4a.from('parça'))
  t.is(fs.readFileSync(dizin + '/dosyalar/' + blob)[5], 1, 'parça şifreli kipte')
  // dosyalar dizini kaldırılınca göç yalnız kök dosyalarla
  const dizin2 = geciciDizin(t)
  const acik2 = new Depo({ dizin: dizin2, testKipi: true })
  acik2.yaz('kimlik', b4a.from('k'))
  acik2.yaz('durum', b4a.from('d'))
  const sifreli2 = new Depo({ dizin: dizin2, anahtar: ANAHTAR, testKipi: true })
  fs.rmSync(dizin2 + '/dosyalar', { recursive: true })
  t.is(sifreli2.goc(), 2)
  t.alike(sifreli2.oku('durum'), b4a.from('d'))
})

// ---------------------------------------------------------------- dizin kilidi

// /proc varsa (Linux, Android) yaşayan süreç sorulabilir; yoksa (macOS, iOS) persistence.js başka sürecin kilidini bilerek
// bırakılmış sayar (surecYasiyor)
const PROC_VAR = (() => { try { fs.statSync('/proc/self'); return true } catch { return false } })()

test('d64 kilit: bozuk, sıfır ve ölü süreç kilidi bırakılmış sayılır; yaşayan süreç /proc varsa DIR_LOCKED, yoksa bırakılmış', (t) => {
  const dizin = geciciDizin(t)
  const ac = () => { const k = new Kalici({ dizin, testKipi: true, now: saat() }); k.kapat(); return k }
  ac() // kimlik ve durum yazılsın
  for (const icerik of ['abc', '0', '-5', '999999999']) {
    fs.writeFileSync(dizin + '/kilit', b4a.from(icerik))
    t.ok(ac(), 'kilit "' + icerik + '" bırakılmış sayılır')
  }
  // 1 numaralı süreç (init) her zaman yaşar
  fs.writeFileSync(dizin + '/kilit', b4a.from('1'))
  if (PROC_VAR) {
    t.is(hataOfSenk(ac), 'DIR_LOCKED')
    t.alike(fs.readFileSync(dizin + '/kilit'), b4a.from('1'), 'başkasının kilidi yerinde')
  } else {
    const k = new Kalici({ dizin, testKipi: true, now: saat() })
    t.is(b4a.toString(fs.readFileSync(dizin + '/kilit')), String(typeof Bare !== 'undefined' ? Bare.pid : process.pid), '/proc yok: kilit bırakılmış sayıldı, bu sürecin')
    k.kapat()
    t.absent(fs.existsSync(dizin + '/kilit'), 'kapanınca kilit silindi')
  }
})

test('d64 kilit: /proc yoksa (iOS) başka sürecin kilidi bırakılmış sayılır', (t) => {
  const dizin = geciciDizin(t)
  fs.writeFileSync(dizin + '/kilit', b4a.from('1'))
  degistir(t, 'statSync', (eski) => (yol, ...r) => { if (String(yol).startsWith('/proc/')) throw new Error('ENOENT'); return eski(yol, ...r) })
  const k = new Kalici({ dizin, testKipi: true, now: saat() })
  t.not(b4a.toString(fs.readFileSync(dizin + '/kilit')), '1', 'kilit bu sürecin')
  k.kapat()
  t.absent(fs.existsSync(dizin + '/kilit'))
})

// ---------------------------------------------------------------- dosya deposu biçimi

test('d64 dosya deposu: parça çerçevesi bozuksa STATE_CORRUPT', (t) => {
  const depo = new Depo({ dizin: geciciDizin(t), testKipi: true })
  const dd = new DiskDeposu(depo)
  const k = 'ab'.repeat(32)
  const ad = 'dosyalar/' + k
  const u32 = (...x) => { const b = b4a.alloc(4 * x.length); const v = new DataView(b.buffer, b.byteOffset); x.forEach((n, i) => v.setUint32(4 * i, n)); return b }
  for (const [neden, icerik] of [
    ['4 bayttan kısa', b4a.alloc(2)],
    ['uzunluk tablosu taşıyor', u32(3, 1)],
    ['parça taşıyor', b4a.concat([u32(1, 10), b4a.alloc(3)])],
    ['artık bayt', b4a.concat([u32(1, 2), b4a.alloc(5)])]
  ]) {
    depo.yaz(ad, icerik)
    t.is(hataVe(() => dd.get(k)), 'STATE_CORRUPT:' + ad, neden)
  }
  depo.yaz(ad, parcalar([b4a.from('ab')]))
  t.alike(dd.get(k), [b4a.from('ab')])
})

// ---------------------------------------------------------------- anlık görüntü yardımcıları

test('d64 anlık görüntü: bekletilen, öneri ve yetenek defteri yoksa null; bekletilen olaylar geri kurulur', (t) => {
  const L = A.anaDefter()
  const g = defterGoruntusu({ events: L.events, acceptedAt: L.acceptedAt, deferred: null }, null, null)
  t.is(g.bekletilen, null)
  t.is(g.oneriler, null)
  t.is(g.caps, null)
  const L2 = defterKur({ ...g, bekletilen: [] }, () => A.TS0)
  t.is(L2.len, L.len)
  t.alike(L2.deferred, [])
  // joinSent yoksa boş küme
  const r = A.replika(A.kopya(L), A.K.husniye)
  r.joinSent = null
  t.ok(replikaGoruntusu(r).gonderilenPaket instanceof Set)
})

test('d64 replika kurulumu: alan denetimi sırasında atan değer STATE_CORRUPT', (t) => {
  const L = A.anaDefter()
  const r = A.replika(A.kopya(L), A.K.husniye)
  const g = replikaGoruntusu(r)
  g.cikis = [{ get bytes () { throw new Error('getter') }, type: 1 }]
  t.is(hataVe(() => replikaKur(g, { ledger: A.kopya(L), me: A.K.husniye, now: () => A.TS0, hlcYaz: () => {} })), 'STATE_CORRUPT:durum')
})

test('d64 kutu emaneti: bayt olmayan kopya, çözülemeyen işlem ve bırakma, boş kopya listesi STATE_CORRUPT; mezar yüklenir', (t) => {
  const ledger = A.anaDefter()
  const now = () => A.TS0
  const kol = (ops, tomb = []) => ({ kullanilan: 0, koleksiyonlar: [{ cid: 'aa'.repeat(16), ops, tomb, usage: [], noReaderSince: null, budamalar: [] }] })
  const sig = b4a.alloc(64)
  t.is(hataVe(() => kutuKur(kol([{ kind: 0, kopyalar: [{ bytes: 'x', sig }] }]), { ledger, now })), 'STATE_CORRUPT:durum', 'bayt olmayan kopya')
  t.is(hataVe(() => kutuKur(kol([{ kind: 0, kopyalar: [{ bytes: b4a.alloc(5), sig: 'y' }] }]), { ledger, now })), 'STATE_CORRUPT:durum', 'bayt olmayan imza')
  t.is(hataVe(() => kutuKur(kol([{ kind: 0, kopyalar: [{ bytes: b4a.alloc(5, 1), sig }] }]), { ledger, now })), 'STATE_CORRUPT:durum', 'çözülemeyen işlem')
  t.is(hataVe(() => kutuKur(kol([{ kind: 1, kopyalar: [{ bytes: b4a.alloc(5, 1), sig }] }]), { ledger, now })), 'STATE_CORRUPT:durum', 'çözülemeyen bırakma')
  t.is(hataVe(() => kutuKur(kol([{ kind: 0, kopyalar: [] }]), { ledger, now })), 'STATE_CORRUPT:durum', 'kopyasız işlem')
  const k = kutuKur(kol([], ['11'.repeat(32)]), { ledger, now })
  t.ok(k._col('aa'.repeat(16)).tomb.has('11'.repeat(32)))
  t.is(k.used, 0)
})

// ---------------------------------------------------------------- Kalici kurulumu

test('d64 kalıcı: geçersiz Arşiv açık anahtarı ve sayaç INVALID_KEY', (t) => {
  const dizin = geciciDizin(t)
  for (const archivePubHex of [5, 'ab', 'zz'.repeat(32)]) t.is(hataOfSenk(() => new Kalici({ dizin, testKipi: true, archivePubHex })), 'INVALID_KEY')
  for (const sayac of [-1, 1.5, '3']) t.is(hataOfSenk(() => new Kalici({ dizin, testKipi: true, sayac })), 'INVALID_KEY')
  t.absent(fs.existsSync(dizin + '/kimlik'), 'hiçbir şey yazılmadı')
})

test('d64 kalıcı: kimlik dosyasının yapısı bozuksa STATE_CORRUPT', (t) => {
  const { dizin, now, k } = aileliDizin(t)
  const kim = kopyala(k.kimlik)
  for (const [neden, x] of [
    ['null', null],
    ['memberId yok', { ...kim, memberId: 'abc' }],
    ['imza çifti yok', { ...kim, signKeyPair: null }],
    ['gizli anahtar bayt değil', { ...kim, signKeyPair: { ...kim.signKeyPair, secretKey: 7 } }]
  ]) {
    k.depo.yaz('kimlik', b4a.from(JSON.stringify(kodla(x))))
    t.is(hataVe(() => kaliciAc({ dizin, now })), 'STATE_CORRUPT:kimlik', neden)
  }
})

test('d64 kalıcı: hlc dosyasının boyu yanlış, durum sayacı geçersiz — STATE_CORRUPT', (t) => {
  const { dizin, now, k, g } = aileliDizin(t)
  const asil = g()
  k.depo.yaz('hlc', b4a.alloc(7))
  t.is(hataVe(() => kaliciAc({ dizin, now })), 'STATE_CORRUPT:hlc')
  k.depo.yaz('hlc', b4a.alloc(8))
  for (const sayac of [-1, 'x', 2 ** 60]) {
    durumYaz(k, { ...asil, sayac })
    t.is(hataVe(() => kaliciAc({ dizin, now })), 'STATE_CORRUPT:durum', 'sayaç ' + sayac)
  }
})

test('d64 kalıcı: göç işlevi kodsuz ya da TypeError ile düşerse STATE_CORRUPT', (t) => {
  const { dizin, now, k, g } = aileliDizin(t)
  t.teardown(() => { delete GOCLER[90]; delete GOCLER[91]; delete GOCLER[92] })
  GOCLER[90] = () => { throw new TypeError('KALICI_YAZIM') }
  GOCLER[91] = () => { throw new Error('beklenmedik') }
  GOCLER[92] = () => { throw new RangeError('OUT_OF_RANGE') }
  for (const v of [90, 91, 92]) {
    durumYaz(k, { ...g(), v })
    let err = null
    try { kaliciAc({ dizin, now }) } catch (e) { err = e }
    t.is(err && err.message + ':' + err.dosya, 'STATE_CORRUPT:durum', 'göç ' + v)
    t.ok(err && err.neden, 'asıl hata nedende')
  }
})

test('d64 kalıcı: replika alanlarının türü bozuksa STATE_CORRUPT', (t) => {
  const { dizin, now, k, g } = aileliDizin(t)
  for (const alan of ['cikis', 'yazimKuyrugu', 'bekleyenAnahtar', 'bekleyenKesim', 'kesimler', 'ops', 'anahtarlar', 'birakma']) {
    const x = g()
    x.replika[alan] = 'bozuk'
    durumYaz(k, x)
    t.is(hataVe(() => kaliciAc({ dizin, now })), 'STATE_CORRUPT:durum', alan + ' dizi değil')
  }
  for (const alan of ['tomb', 'pruned', 'cleaned', 'verilenKesimler', 'donemGorulme']) {
    const x = g()
    x.replika[alan] = []
    durumYaz(k, x)
    t.is(hataVe(() => kaliciAc({ dizin, now })), 'STATE_CORRUPT:durum', alan + ' türü yanlış')
  }
})

test('d64 kalıcı: imzası bozuk anahtar girdisi ve bozuk bırakma anahtarı STATE_CORRUPT', (t) => {
  const { dizin, now, k, g } = aileliDizin(t)
  const x = g()
  t.ok(x.replika.anahtarlar.length > 0)
  x.replika.anahtarlar[0].keys[0].entry.sig[0] ^= 1
  durumYaz(k, x)
  t.is(hataVe(() => kaliciAc({ dizin, now })), 'STATE_CORRUPT:durum', 'imza doğrulanmadı')
  for (const d of [{ cid: 'aa', pub: b4a.alloc(32), secret: 'x' }, { cid: 'aa', pub: b4a.alloc(32), secret: b4a.alloc(32, 9) }]) {
    const y = g()
    y.replika.birakma = [d]
    durumYaz(k, y)
    t.is(hataVe(() => kaliciAc({ dizin, now })), 'STATE_CORRUPT:durum', 'bırakma anahtarı')
  }
})

test('d64 kalıcı: eksik dosya alanları, görülme ve onay boş sayılır', (t) => {
  const { dizin, now, k, g } = aileliDizin(t)
  const x = g()
  x.dosya = {}
  const kim = A.hex(A.K.husniye.memberId)
  x.gorulme = [[kim, {}]]
  delete x.onay
  durumYaz(k, x)
  const k2 = kaliciAc({ dizin, now })
  t.alike(k2.nesneler.gorulme.son.get(kim), { dogrudan: null, emanet: null })
  t.is(k2.nesneler.kayit.eklenen.size, 0)
  // görülme de yoksa
  const y = g()
  delete y.gorulme
  delete y.dosya
  durumYaz(k2, y)
  const k3 = kaliciAc({ dizin, now })
  t.is(k3.nesneler.gorulme.son.size, 0)
})

test('d64 kalıcı: aile varken aileBagla FAMILY_EXISTS; ailesiz çekirdekte kutu yok', (t) => {
  const dizin = geciciDizin(t)
  const k = kaliciAc({ dizin, now: saat() })
  t.is(k.kutu(), null)
  t.is(k.arsivSayac, null, 'arsiv yok')
  k.aileKur({ aileAdi: 'Rivera', benimAdim: 'Alex' })
  t.is(hataOfSenk(() => k.aileBagla(A.anaDefter())), 'FAMILY_EXISTS')
  t.is(k.kutu(), null, 'kutu rolü değil')
})

test('d64 kalıcı: gömme saklaması — dizin silinmişse liste boş, silme geçici kopyayı da siler', (t) => {
  const { dizin, k } = aileliDizin(t)
  const s = k.gommeSaklama()
  const ad = 'gomme-' + 'ab'.repeat(16)
  s.yaz(ad, b4a.from('vektör'))
  fs.writeFileSync(dizin + '/gomme/' + 'ab'.repeat(16) + '.tmp-001122334455', b4a.from('yarım'))
  fs.writeFileSync(dizin + '/gomme/' + 'cd'.repeat(16) + '.tmp-001122334455', b4a.from('başkasının'))
  t.alike(s.liste(), [ad])
  s.sil(ad)
  t.alike(fs.readdirSync(dizin + '/gomme').map(String), ['cd'.repeat(16) + '.tmp-001122334455'])
  fs.rmSync(dizin + '/gomme', { recursive: true })
  t.alike(s.liste(), [])
  t.is(hataOfSenk(() => s.sil(ad)), null, 'dizin yokken silme sessiz')
})

// ---------------------------------------------------------------- arsiv bağı (eski dizinler)

test('d64 arsiv bağı: HFA1 başlıklı eski arsiv arsivSayac ile; uymayan sayaç STATE_CORRUPT', (t) => {
  const { dizin, now, k, g } = aileliDizin(t)
  const x = g()
  delete x.arsivOzetleri
  // HFA1, durumdaki arsivSayac ile aynı: geçerli
  k.depo.yaz('arsiv', parcalar([arsivBasligi(5)]))
  durumYaz(k, { ...x, arsivSayac: 5 })
  const k2 = kaliciAc({ dizin, now })
  t.is(k2.arsivSayac, 5)
  // Arsiv başlıksız (sayaç yok) ama durum sayaç bekliyor
  k2.depo.yaz('arsiv', parcalar([b4a.from('baslik-degil')]))
  durumYaz(k2, { ...x, arsivSayac: 5 })
  t.is(hataVe(() => kaliciAc({ dizin, now })), 'STATE_CORRUPT:arsiv')
  // D36 öncesi: durumda ne özet ne sayaç; arsiv başlığının sayacı durumun sayacından bir fazla olmalı
  k2.depo.yaz('arsiv', parcalar([arsivBasligi(x.sayac + 1)]))
  durumYaz(k2, { ...x })
  t.ok(kaliciAc({ dizin, now }))
  const k3 = kaliciAc({ dizin, now })
  k3.depo.yaz('arsiv', parcalar([arsivBasligi(x.sayac + 7)]))
  durumYaz(k3, { ...x })
  t.is(hataVe(() => kaliciAc({ dizin, now })), 'STATE_CORRUPT:arsiv')
  // Başlıksız arsiv (sayaç null) kabul edilir
  k3.depo.yaz('arsiv', parcalar([b4a.from('eski-oge')]))
  durumYaz(k3, { ...x })
  t.ok(kaliciAc({ dizin, now }))
})

// ---------------------------------------------------------------- arsiv: anahtar retleri ve öğe denetimi

test('d64 arsiv: Arşiv anahtarı yokken NO_KEY, biçimsiz anahtar INVALID_KEY', (t) => {
  const k = kaliciAc({ dizin: geciciDizin(t), now: saat() })
  const h = 'ab'.repeat(32)
  t.is(hataOfSenk(() => k.arsivAc(h)), 'NO_KEY')
  t.is(hataOfSenk(() => k.arsivTasi(h, h)), 'NO_KEY')
  const a = arsivAnahtari()
  const k2 = kaliciAc({ dizin: geciciDizin(t), now: saat(), archivePubHex: a.pubHex })
  for (const kotu of [null, 'ab', 'ZZ'.repeat(32)]) {
    t.is(hataOfSenk(() => k2.arsivAc(kotu)), 'INVALID_KEY')
    t.is(hataOfSenk(() => k2.arsivTasi(kotu, a.pubHex)), 'INVALID_KEY')
    t.is(hataOfSenk(() => k2.arsivTasi(a.skHex, kotu)), 'INVALID_KEY')
  }
  // Ailesiz çekirdekte açma yalnız bayrak; kilitlenmemişken kilitleme yazmaz
  const s0 = k2.sayac
  k2.arsivKilitle()
  t.is(k2.sayac, s0, 'açık değilken kilitleme diske dokunmaz')
  k2.arsivAc(a.skHex)
  t.is(k2.arsivAcik, true)
  k2.arsivAc(a.skHex)
  t.is(k2.arsivAcik, true)
})

test('arsiv kilitleme: açık kasa VaultApi.lock() ile kilitlenir (eski ad kilitle() yoktu; Codex 12. tur)', (t) => {
  const a = arsivAnahtari()
  const k = kaliciAc({ dizin: geciciDizin(t), now: saat(), archivePubHex: a.pubHex })
  k.arsivAc(a.skHex)
  let kilitli = false
  k.nesneler.kasa = { locked: () => kilitli, lock: () => { kilitli = true } }
  k.arsivKilitle()
  t.is(k.arsivAcik, false)
  t.is(kilitli, true, 'kasa kilitlendi')
})

test('d64 arsiv: mühürden kısa öğe açmada ve taşımada STATE_CORRUPT', (t) => {
  const a = arsivAnahtari()
  const yeni = arsivAnahtari(8)
  const { k } = aileliDizin(t, { archivePubHex: a.pubHex })
  k.depo.yaz('arsiv', parcalar([arsivBasligi(k.sayac + 1, a.pubHex), b4a.alloc(10)]))
  t.is(hataVe(() => k.arsivAc(a.skHex)), 'STATE_CORRUPT:arsiv')
  t.is(k.arsivAcik, false)
  t.is(hataVe(() => k.arsivTasi(a.skHex, yeni.pubHex)), 'STATE_CORRUPT:arsiv')
  t.is(b4a.toString(k.arsivPub, 'hex'), a.pubHex, 'anahtar değişmedi')
})

test('d64 arsiv: biçimi bozuk öğe STATE_CORRUPT ve hiçbiri uygulanmaz', (t) => {
  const a = arsivAnahtari()
  const { k } = aileliDizin(t, { archivePubHex: a.pubHex })
  const S = require('@havenfold/sdk')
  const iyi = muhurle({ t: 's', k: S.TO_SEND + 'iyi', v: '1' }, a.pubHex)
  for (const [neden, x] of [
    ['null öğe', null],
    ['bilinmeyen tür', { t: 'z' }],
    ['s: anahtar dizge değil', { t: 's', k: 5 }],
    ['s: önek yanlış', { t: 's', k: 'baska/anahtar' }],
    ['k: bayt değil', { t: 'k', b: 'x' }],
    ['o: mesaj yok', { t: 'o' }],
    ['o: bayt değil', { t: 'o', m: { bytes: 'x', type: 0x82 } }],
    ['o: tür yanlış', { t: 'o', m: { bytes: b4a.alloc(3), type: 0x81 } }]
  ]) {
    k.depo.yaz('arsiv', parcalar([arsivBasligi(k.sayac + 1, a.pubHex), iyi, muhurle(x, a.pubHex)]))
    t.is(hataVe(() => k.arsivAc(a.skHex)), 'STATE_CORRUPT:arsiv', neden)
    t.absent(k._kasaKV.has(S.TO_SEND + 'iyi'), 'geçerli öğe de uygulanmadı: ' + neden)
  }
})

test('d64 arsiv: aynı öğe bir kez; pay, çıkış ve bekleyen anahtar öğeleri açılışta yerine', (t) => {
  const a = arsivAnahtari()
  const { k } = aileliDizin(t, { archivePubHex: a.pubHex })
  const S = require('@havenfold/sdk')
  const s = { t: 's', k: S.TO_SEND + 'pay1', v: '"x"' }
  const o = { t: 'o', m: { cid: 'aa'.repeat(16), type: 0x88, bytes: b4a.from('kesim') } }
  const kb = { t: 'k', b: b4a.from('anahtar-mesaji') }
  k.depo.yaz('arsiv', parcalar([arsivBasligi(k.sayac + 1, a.pubHex), muhurle(s, a.pubHex), muhurle(s, a.pubHex), muhurle(o, a.pubHex), muhurle(kb, a.pubHex)]))
  const r = k.nesneler.replika
  const cikis0 = r.outbox.length
  k.arsivAc(a.skHex)
  t.is(k.arsivAcik, true)
  t.is(k._kasaKV.get(S.TO_SEND + 'pay1'), '"x"')
  t.is(r.outbox.filter((m) => b4a.equals(m.bytes, b4a.from('kesim'))).length, 1, 'çıkış öğesi bir kez')
  t.ok(r.outbox.length >= cikis0 + 1)
  t.ok(r.pendingKeys.some((b) => b4a.equals(b, b4a.from('anahtar-mesaji'))), 'bekleyen anahtar mesajı yerinde')
})
