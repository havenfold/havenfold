// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D67: kasa kurtarma ve döndürme uçtan uca (RFC-0004 §5–§6, RFC-0027 §1a 400–405; kurucu T4). D34 düzeni: her cihaz
// ayrı süreçte (Node ya da Bare; kutu da), ağın yerine boru yönlendiricisi. Kerem'in telefonu (A) kaybolur; Hüsniye (B)
// A'yı çıkarır ve Kerem'in yeni telefonunu (C) ebeveyn olarak katar.
// İnceleme 19 ve RFC-0027 §9 (Mac): A kasayı açıkken kurduğu için KRA zarfını kasa koleksiyonuna 'hf.kasa.zarf' kaydı
// olarak yazar (§9 b) ve opak kopyasını kutuya gönderir (§9 g). Tam felaket: A kayıp, B kilitli kalır (405
// VAULT_LOCKED); C kâğıt ve kutunun payıyla KRA'yı kurtarır, zarfı kutudan KRA'dan türetilen etiketle alır, dönem
// anahtarları replikasına girer ve kasanın eski kaydını okur. Çıkarılan A'nın kaydı, B kilidi açınca verilen ertelenmiş
// kesimle geçerli olur (§9 h). B ve C aynı anda döndürür: commit'i küçük dağıtım kazanır,
// kaybeden geri çeker (§9 e); kutudaki kopya yeni sürüme yenilenir. Eski kâğıt STALE_VERSION (§9 f). Kutu çıkarılınca
// kasada yeni dönem başlar; KRA'yı bilen ve kasası açık telefon zarfı yeniden yazar (§9 b).
'use strict'
const test = require('brittle')
const b4a = require('b4a')
const sodium = require('sodium-native')
const { KOMUT } = require('../example/product')
const { geciciDizin, arsivAnahtari } = require('./helpers/common')
const { BoruAgi, bekle } = require('./helpers/multi')

const rastgeleHex = (n) => { const b = b4a.alloc(n); sodium.randombytes_buf(b); return b4a.toString(b, 'hex') }

test('kasa kurtarma: tam felakette zarf kutudan, kilitliyken onay yok, döndürme yarışı, eski kâğıt, dönem değişiminde zarf', { timeout: 300000 }, async (t) => {
  const ag = new BoruAgi()
  const ayar = {}
  for (const [ad, tohum] of [['A', 61], ['B', 62], ['K', 63], ['C', 64]]) ayar[ad] = { dizin: geciciDizin(t, 'kurtar-' + ad), anahtarHex: rastgeleHex(32), arsiv: arsivAnahtari(tohum), sayac: null }
  const kutuPay = { dizin: geciciDizin(t, 'kurtar-K-tpm'), tpmAnahtarHex: rastgeleHex(32) }
  const acik = []
  const ac = async (ad) => {
    const c = ag.cihaz(ad)
    await c.start({ dizin: ayar[ad].dizin, anahtarHex: ayar[ad].anahtarHex, archivePubHex: ayar[ad].arsiv.pubHex, sayac: ayar[ad].sayac, ...(ad === 'K' ? { kutuPay } : { kutuUygun: true }) })
    acik.push(c)
    return c
  }
  t.teardown(async () => { for (const c of acik) if (c.canli) await c.kapat().catch(() => {}) })
  // Tören adımları sayılarak beklenir (B ikinci törende davet eden olur; önceki törenin olayları sayılmaz)
  const say = (c, adim) => c.olaylar.filter((x) => x.olay === 'ceremony' && x.veri.adim === adim).length
  const toren = async (davetEden, gelen, rol) => {
    const once = Object.fromEntries(['qr', 'sas', 'tamam'].map((a) => [a, [say(davetEden, a), say(gelen, a)]]))
    const yeni = (a) => say(davetEden, a) > once[a][0] && say(gelen, a) > once[a][1]
    await davetEden.iste(KOMUT.INVITE_START, { tur: 'uye', rol })
    await bekle(() => say(davetEden, 'qr') > once.qr[0], { neden: 'qr' })
    t.alike(await gelen.iste(KOMUT.JOIN, { kod: davetEden.toren('qr').qr }), { tur: 'uye' })
    await bekle(() => yeni('sas'), { neden: 'sas' })
    t.alike(davetEden.toren('sas').resimler, gelen.toren('sas').resimler, 'aynı 5 resim')
    await gelen.iste(KOMUT.INVITE_CONFIRM, { ayni: true })
    await davetEden.iste(KOMUT.INVITE_CONFIRM, { ayni: true })
    await bekle(() => yeni('tamam'), { neden: 'tören tamam' })
  }
  const uz = async (c) => (await c.iste(KOMUT.FAMILY_INFO)).uzunluk
  const esit = async (...cs) => bekle(async () => { const u = await Promise.all(cs.map(uz)); return u.every((x) => x === u[0]) }, { neden: 'defter eşit' })
  const kol = async (c, ad) => (await c.iste(KOMUT.RECORD_COLLECTIONS)).find((x) => x.name === ad)
  const hataOf = (p) => p.then(() => null, (e) => e.message)
  const ac_ = (c, ad) => c.iste(KOMUT.UNLOCK, { archiveKeyHex: ayar[ad].arsiv.skHex })

  // --- Aile: A kurar, B ebeveyn, kutu katılır
  const A = await ac('A')
  const B = await ac('B')
  const K = await ac('K')
  await A.iste(KOMUT.CREATE_FAMILY, { aileAdi: 'Rivera', benimAdim: 'Alex' })
  await toren(A, B, 'ebeveyn')
  const kqr = await K.kutuQr()
  t.alike(await A.iste(KOMUT.JOIN, { kod: kqr }), { tur: 'kutu' })
  await bekle(() => A.olaylar.filter((x) => x.veri && x.veri.adim === 'sas').length === 2, { neden: 'kutu sas' })
  await A.iste(KOMUT.INVITE_CONFIRM, { ayni: true })
  await bekle(async () => (await K.iste(KOMUT.FAMILY_INFO)).aile, { neden: 'kutu ailede' })
  await esit(A, B, K)

  // --- Kasa: koleksiyon iki ebeveynin imzasıyla; ikisi de kasayı açık tutar (dönem anahtarı paylaşılır). KRA payları A
  // (kendi), B, kutu ve bir kâğıt (eşik 2); A KRA'yı bilir ve zarfı kasa koleksiyonuna yazar (§9 b)
  t.is((await A.iste(KOMUT.VAULT_SETUP_VRK, { collectionId: null })).koleksiyon.durum, 'oneri')
  const bo = await bekle(async () => (await B.iste(KOMUT.PROPOSALS)).find((x) => x.type === 'COLLECTION'), { neden: 'B öneri' })
  t.is((await B.iste(KOMUT.LEDGER_SIGN, { oneriId: bo.proposalId })).durum, 'uygulandi')
  const kasa = (await bekle(() => kol(A, 'Kasa'), { neden: 'A Kasa' })).collectionId
  await ac_(A, 'A')
  await ac_(B, 'B')
  const kasaDurum = async (c) => (await c.iste(KOMUT.VAULT_STATUS)).kasalar.find((x) => x.collectionId === kasa)
  // B'nin ve A'nın kasa kayıtları (ilk dönemde): kurtaran telefon bunları ancak zarftaki dönem anahtarıyla okur. A
  // çıkarılınca A'nın kaydı kesim ister: B'nin kasası kilitliyken kesim ertelenir, B kilidi açınca verilir (§9 h)
  const pasaport = await B.iste(KOMUT.RECORD_PUT, { collectionId: kasa, type: 'yuva.defter.belge', fields: { ad: 'Pasaport' } })
  await bekle(() => A.iste(KOMUT.RECORD_GET, { collectionId: kasa, recordId: pasaport }), { neden: 'A B\'nin kaydını okur (dönem anahtarı paylaşıldı)' })
  const ehliyet = await A.iste(KOMUT.RECORD_PUT, { collectionId: kasa, type: 'yuva.defter.belge', fields: { ad: 'Ehliyet' } })
  await bekle(() => B.iste(KOMUT.RECORD_GET, { collectionId: kasa, recordId: ehliyet }), { neden: 'B A\'nın kaydını aldı' })
  const kur = await A.iste(KOMUT.VAULT_SETUP_VRK, { collectionId: kasa, kagit: 1 })
  t.alike([kur.version, kur.dagitim.t, kur.dagitim.n], [1, 2, 4])
  const eskiKagit = kur.kagitlar[0].metin
  const z1 = await bekle(async () => { const z = (await kasaDurum(A)).zarf; return z && z.kutu ? z : null }, { neden: 'A zarfı yazdı, kutu kopyayı aldı' })
  t.alike([z1.version, z1.envSeq], [1, 1], 'zarf kaydı: KRA sürüm 1')
  t.alike((await K.kutuZarflari()).map((x) => [x.collectionId, x.version, x.envSeq]), [[kasa, 1, 1]], 'kutuda opak kopya (§9 g)')
  const sahipler = async (c) => (await kasaDurum(c)).kurulu.sahipler
  await bekle(async () => (await sahipler(A)).every((x) => x.tur === 'kagit' || x.teslim), { neden: 'B ve kutu payı teslim' })
  t.alike(await K.kutuPaylari(), [kasa + '|1'])
  t.absent((await kasaDurum(B)).zarf, 'B KRA\'yı bilmez: zarf yazmaz')
  await B.iste(KOMUT.LOCK)

  // --- A kayboldu: süreç kapanır, bir daha açılmaz. B, A'yı çıkarır ve Kerem'in yeni telefonunu (C) ebeveyn katar
  ag.cevrimdisiYap('A')
  await A.kapat()
  t.is((await B.iste(KOMUT.MEMBER_REMOVE, { memberId: A.me })).durum, 'uygulandi', 'kalan ebeveyn kayıp telefonu çıkarır')
  const C = await ac('C')
  await toren(B, C, 'ebeveyn')
  await esit(B, K, C)
  t.ok(await bekle(() => kol(C, 'Kasa')), 'C Kasa koleksiyonunu görür (okuyucu)')

  // --- Tam felaket (§9 g): A kayıp, B kilitli kalır. Kurtarma (400): kutu sormadan pay verir; B'nin telefonu sorar ama
  // kilitliyken onay yok (405, §9 a); C ikinci payı kâğıttan alır
  const bas = await C.iste(KOMUT.VAULT_RECOVERY_START, { tur: 'kra', collectionId: kasa })
  t.alike([bas.tur, bas.secretId], ['kra', kasa])
  const durum = () => C.iste(KOMUT.VAULT_RECOVERY_STATUS)
  await bekle(async () => (await durum()).kurtarma.paySayisi === 1, { neden: 'kutunun payı geldi' })
  t.is(await hataOf(C.iste(KOMUT.VAULT_RECOVERY_FINISH, {})), 'INSUFFICIENT_SHARE', 'tek payla açılmaz')
  const istek = await bekle(async () => (await B.iste(KOMUT.VAULT_RECOVERY_STATUS)).istekler[0], { neden: 'B\'de pay isteği' })
  t.alike([istek.kimden, istek.tur, istek.ad], [C.me, 'kra', 'C'])
  t.ok(istek.kilitli, 'B\'nin kasası kilitli: istek yine sorulur')
  t.is(await hataOf(B.iste(KOMUT.VAULT_SHARE_APPROVE, { jeton: istek.jeton, onay: true })), 'VAULT_LOCKED', 'kilitliyken 405 reddi')
  t.is((await C.iste(KOMUT.VAULT_RECOVERY_SHARE, { kagit: eskiKagit })).durum, 'eklendi', 'kâğıt pay')
  await bekle(async () => (await durum()).kurtarma.hazir, { neden: 'kutu ve kâğıt' })
  const d = (await durum()).kurtarma
  t.alike([d.version, d.esik, d.paySayisi], [1, 2, 2])
  // KRA'nın açtığı zarf ve dönem anahtarları kasanın içeriğidir: C kasayı açmadan bitmez
  t.is(await hataOf(C.iste(KOMUT.VAULT_RECOVERY_FINISH, {})), 'VAULT_LOCKED')
  await ac_(C, 'C')
  t.absent(await C.iste(KOMUT.RECORD_GET, { collectionId: kasa, recordId: pasaport }), 'C, B\'nin kaydını okuyamıyor (dönem anahtarı yok, B kilitli)')
  const acilan = await C.iste(KOMUT.VAULT_RECOVERY_FINISH, {})
  t.alike([acilan.tur, acilan.version, acilan.collectionId, acilan.zarf, acilan.kutu], ['kra', 1, kasa, 0, 'istendi'], 'KRA birleşti; yerelde okunur zarf yok, kutudan istendi')
  t.absent('sirHex' in acilan, 'KRA kanala çıkmaz')
  const kz = await bekle(async () => { const x = (await durum()).kurtarma.kutuZarfi; return x && x.zarf ? x : null }, { neden: 'zarf kutudan geldi' })
  t.ok(kz.anahtar >= 1 && kz.donem >= 1, 'zarf açıldı, dönem anahtarları replikaya girdi')
  const okunan = await bekle(() => C.iste(KOMUT.RECORD_GET, { collectionId: kasa, recordId: pasaport }), { neden: 'C kasa kaydını okur' })
  t.is(okunan.fields.ad, 'Pasaport', 'kasa açıldı: B kilitliyken yeni telefon kasanın eski kaydını okur')
  t.absent(await C.iste(KOMUT.RECORD_GET, { collectionId: kasa, recordId: ehliyet }), 'çıkarılan A\'nın kaydı: B kilitli, kesim ertelendi')

  // --- Döndürme yarışı (403, §9 e): C (kurtardı) ve B (kasası açık; eski KRA'yı bilmez, zarf dönem anahtarlarından)
  // aynı anda döndürür. İkisi de sürüm 2; commit'i küçük olan kazanır, kaybeden geri çeker
  await ac_(B, 'B')
  // B kilidi açınca ertelenen kesim verilir: çıkarılan A'nın kaydı herkeste geçerli (§9 h)
  const ehl = await bekle(() => C.iste(KOMUT.RECORD_GET, { collectionId: kasa, recordId: ehliyet }), { neden: 'C çıkarılan A\'nın kaydını okur' })
  t.is(ehl.fields.ad, 'Ehliyet', 'kayıp telefonun kaydı kesimle geri geldi')
  t.is((await B.iste(KOMUT.RECORD_GET, { collectionId: kasa, recordId: ehliyet })).fields.ad, 'Ehliyet')
  const [donC, donB] = await Promise.all([C.iste(KOMUT.VAULT_ROTATE, { tur: 'kra', collectionId: kasa, kagit: 1 }), B.iste(KOMUT.VAULT_ROTATE, { tur: 'kra', collectionId: kasa, kagit: 1 })])
  t.alike([donC.version, donB.version], [2, 2])
  t.is((await durum()).kurtarma, null, 'kurtarma kapandı')
  const kaybetti = async (c) => (await kasaDurum(c)).kurulu.kaybetti
  await bekle(async () => (await kaybetti(B)) !== (await kaybetti(C)), { neden: 'kaybeden geri çekti', sure: 60000 })
  const [kazanan, kaybeden, don] = (await kaybetti(B)) ? [C, B, donC] : [B, C, donB]
  t.comment('kazanan: ' + (kazanan === C ? 'C' : 'B'))
  await bekle(async () => (await sahipler(kazanan)).every((x) => x.tur === 'kagit' || x.teslim), { neden: 'kazananın payları teslim' })
  t.alike((await sahipler(kazanan)).filter((x) => x.tur !== 'kagit').map((x) => x.id).sort(), [B.me, C.me, K.me].sort(), 'kayıp telefon artık pay sahibi değil')
  t.alike(await K.kutuPaylari(), [kasa + '|2'], 'kutuda yalnız yeni sürüm')
  t.absent((await kasaDurum(kaybeden)).zarf, 'kaybeden kendi zarfını ve KRA\'sını sildi')
  const z2 = await bekle(async () => { const z = (await kasaDurum(kazanan)).zarf; return z && z.version === 2 && z.kutu ? z : null }, { neden: 'kazananın zarfı kutuda' })
  t.ok((await K.kutuZarflari()).every((x) => x.version === 2), 'kutudaki eski sürüm kopya silindi')

  // --- Eski kâğıt (§9 f): yeni kurtarmada sürüm 2 bulunur, eski kâğıt STALE_VERSION; kazananın kâğıdı ve kutunun payı
  // (kazananın dağıtımı) açar
  await C.iste(KOMUT.VAULT_RECOVERY_START, { tur: 'kra', collectionId: kasa })
  await bekle(async () => (await durum()).kurtarma.version === 2, { neden: 'sürüm 2' })
  t.is(await hataOf(C.iste(KOMUT.VAULT_RECOVERY_SHARE, { kagit: eskiKagit })), 'STALE_VERSION', 'eski kâğıt açmaz')
  t.is((await C.iste(KOMUT.VAULT_RECOVERY_SHARE, { kagit: don.kagitlar[0].metin })).durum, 'eklendi')
  await bekle(async () => (await durum()).kurtarma.hazir, { neden: 'kutu ve kazananın kâğıdı' })
  t.is((await C.iste(KOMUT.VAULT_RECOVERY_FINISH, {})).version, 2, 'kazananın payları açar: tutucular birleşti')
  await bekle(async () => { const x = (await durum()).kurtarma.kutuZarfi; return x && x.zarf }, { neden: 'kutu kazananın zarfını etiketle verir' })
  await C.iste(KOMUT.LOCK)
  t.is((await durum()).kurtarma, null, 'LOCK kurtarmayı ve sırrı siler (inceleme 19 B4)')

  // --- Dönem değişimi (§9 b): kutu çıkarılınca kasada yeni dönem; KRA'yı bilen kazanan kasası açıkken zarfı yeniden
  // yazar (envSeq artar, son dönem ilerler)
  await ac_(B, 'B')
  await ac_(C, 'C')
  const cik = await kazanan.iste(KOMUT.MEMBER_REMOVE, { memberId: K.me })
  if (cik.durum !== 'uygulandi') {
    const o = await bekle(async () => (await kaybeden.iste(KOMUT.PROPOSALS)).find((x) => x.proposalId === cik.oneriId), { neden: 'çıkarma önerisi' })
    t.is((await kaybeden.iste(KOMUT.LEDGER_SIGN, { oneriId: o.proposalId })).durum, 'uygulandi')
  }
  const z3 = await bekle(async () => { const z = (await kasaDurum(kazanan)).zarf; return z && z.sonDonem > z2.sonDonem ? z : null }, { neden: 'zarf yeni dönemle yeniden yazıldı', sure: 60000 })
  t.alike([z3.version, z3.envSeq > z2.envSeq, z3.donem > z2.donem], [2, true, true])
  t.alike([B, C].map((c) => c.hatalar), [[], []], 'çekirdek hatası yok')
})
