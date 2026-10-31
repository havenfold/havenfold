// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D34: iki telefon ve kutu, üç ayrı süreçte (Node ya da Bare) uçtan uca. Her süreç kendi dizini ve platform anahtarıyla
// @havenfold/worklet'i başlatır; ağın yerine boru yönlendiricisi (test/helpers/multi.js), tören için taşıyıcı kancası
// (test/helpers/ceremony-transport.js). Beklenenler elle yazıldı.
'use strict'
const test = require('brittle')
const b4a = require('b4a')
const sodium = require('sodium-native')
const { KOMUT } = require('../example/product')
const { geciciDizin, arsivAnahtari } = require('./helpers/common')
const { BoruAgi, bekle, uyu, yukCarpani } = require('./helpers/multi')

const rastgeleHex = (n) => { const b = b4a.alloc(n); sodium.randombytes_buf(b); return b4a.toString(b, 'hex') }

test('iki telefon ve kutu: tören, kayıt ve dosya eşitleme, kasa ve pay teslimi, çevrimdışı, çıkarma, yeniden açılış', { timeout: 180000 * yukCarpani() }, async (t) => {
  const ag = new BoruAgi()
  const sure = []
  let t0 = Date.now()
  const adim = (ad) => { const s = Date.now(); sure.push([ad, s - t0]); t0 = s }
  const ayar = {}
  for (const [ad, tohum] of [['A', 31], ['B', 32], ['K', 33]]) ayar[ad] = { dizin: geciciDizin(t, 'cok-' + ad), anahtarHex: rastgeleHex(32), arsiv: arsivAnahtari(tohum), sayac: null }
  // Kutu Node'da (düğüm yazılımı) ve payları taklit TPM mühürlü dosyada tutar (D39); telefonlar kutuyu KRA'da cihaz
  // payı sahibi sayar (uygunCihaz)
  const kutuPay = { dizin: geciciDizin(t, 'cok-K-tpm'), tpmAnahtarHex: rastgeleHex(32) }
  const ac = async (ad) => {
    const c = ag.cihaz(ad)
    await c.start({ dizin: ayar[ad].dizin, anahtarHex: ayar[ad].anahtarHex, archivePubHex: ayar[ad].arsiv.pubHex, sayac: ayar[ad].sayac, ...(ad === 'K' ? { node: true, kutuPay } : { kutuUygun: true }) })
    return c
  }
  const A = await ac('A')
  const B = await ac('B')
  const K = await ac('K')
  t.teardown(async () => { for (const c of [A, B, K]) if (c.canli) await c.kapat().catch(() => {}) })
  adim('üç süreç başladı')

  // --- Tören: A aile kurar, B'yi ebeveyn olarak katar (3/4/5)
  await A.iste(KOMUT.CREATE_FAMILY, { aileAdi: 'Rivera', benimAdim: 'Alex' })
  t.alike(await A.iste(KOMUT.INVITE_START, { tur: 'uye', rol: 'ebeveyn' }), { ttlSec: 180 })
  const qr = (await bekle(() => A.toren('qr'), { neden: 'A qr' })).qr
  t.alike(await B.iste(KOMUT.JOIN, { kod: qr }), { tur: 'uye' })
  const [sa, sb] = [await bekle(() => A.toren('sas'), { neden: 'A sas' }), await bekle(() => B.toren('sas'), { neden: 'B sas' })]
  t.alike(sa.resimler, sb.resimler, 'iki telefonda aynı 5 resim')
  t.is(sa.resimler.length, 5)
  t.is(sa.karsiAd, 'B')
  await B.iste(KOMUT.INVITE_CONFIRM, { ayni: true })
  await A.iste(KOMUT.INVITE_CONFIRM, { ayni: true })
  await bekle(() => A.toren('tamam') && B.toren('tamam'), { neden: 'tören tamam' })
  t.ok((await B.iste(KOMUT.FAMILY_INFO)).aile, 'B ailede')
  adim('B törenle katıldı')

  // --- Kutu: QR'ı kutu gösterir, A tarar (kutu cihaz olarak katılır)
  const kqr = await K.kutuQr()
  t.alike(await A.iste(KOMUT.JOIN, { kod: kqr }), { tur: 'kutu' })
  await bekle(() => A.toren('sas') && A.olaylar.filter((x) => x.veri && x.veri.adim === 'sas').length === 2, { neden: 'kutu sas' })
  await A.iste(KOMUT.INVITE_CONFIRM, { ayni: true })
  await bekle(async () => (await K.iste(KOMUT.FAMILY_INFO)).aile, { neden: 'kutu ailede' })
  const uz = async (c) => (await c.iste(KOMUT.FAMILY_INFO)).uzunluk
  await bekle(async () => (await uz(B)) === (await uz(A)) && (await uz(K)) === (await uz(A)), { neden: 'defter eşit' })
  adim('kutu katıldı, defter üç cihazda eşit')

  // --- Kayıt eşitleme: A yazar, B okur; B yazar, A okur
  const kol = async (c, ad) => (await c.iste(KOMUT.RECORD_COLLECTIONS)).find((x) => x.name === ad)
  const tum = (await kol(A, 'Tüm Aile')).collectionId
  const getir = (c, cid, rid) => c.iste(KOMUT.RECORD_GET, { collectionId: cid, recordId: rid })
  const r1 = await A.iste(KOMUT.RECORD_PUT, { collectionId: tum, type: 'yuva.defter.not', fields: { baslik: 'Süt al' } })
  t.is((await bekle(() => getir(B, tum, r1), { neden: 'B r1' })).fields.baslik, 'Süt al', 'A\'nın yazdığı kayıt B\'de')
  const r2 = await B.iste(KOMUT.RECORD_PUT, { collectionId: tum, type: 'yuva.defter.not', fields: { baslik: 'Ekmek' } })
  t.is((await bekle(() => getir(A, tum, r2), { neden: 'A r2' })).fields.baslik, 'Ekmek', 'B\'nin yazdığı kayıt A\'da')
  await B.iste(KOMUT.RECORD_PUT, { collectionId: tum, recordId: r1, fields: { not: 'iki litre' } })
  t.alike((await bekle(async () => { const x = await getir(A, tum, r1); return x && x.fields.not ? x : null }, { neden: 'A r1 güncel' })).fields, { baslik: 'Süt al', not: 'iki litre' })
  adim('kayıt iki yönde eşitlendi')

  // --- Dosya: A ekler (yükleme kutuya), B kayıttan açar (önce kutudan ister)
  const icerik = b4a.from('Kombi garanti belgesi '.repeat(4000)) // 88 KB: iki parça
  const ref = await A.iste(KOMUT.RECORD_ATTACH, { bytes: { $b: b4a.toString(icerik, 'base64') }, mime: 'text/plain', name: 'garanti.txt' })
  const r3 = await A.iste(KOMUT.RECORD_PUT, { collectionId: tum, type: 'yuva.defter.belge', fields: { ad: 'Garanti', dosya: ref } })
  const acilan = await bekle(async () => { await bekle(() => getir(B, tum, r3), { neden: 'B r3' }); return B.iste(KOMUT.RECORD_OPEN, { blobRef: (await getir(B, tum, r3)).fields.dosya }) }, { neden: 'B dosyayı açar' })
  t.ok(b4a.equals(b4a.from(acilan.bytes.$b, 'base64'), icerik), 'B dosyayı kayıttan açtı')
  adim('dosya A → kutu → B')

  // --- Kasa: iki ebeveynde kurulum öneri olur, B imzalar; KRA payları teslim edilir (0xF1/0xF2)
  const oneri = await A.iste(KOMUT.VAULT_SETUP_VRK, { collectionId: null, kagit: 1 })
  t.is(oneri.koleksiyon.durum, 'oneri', 'Kasa koleksiyonu iki ebeveynin imzasını ister')
  const bo = await bekle(async () => (await B.iste(KOMUT.PROPOSALS)).find((x) => x.type === 'COLLECTION'), { neden: 'B öneriyi aldı' })
  t.is((await B.iste(KOMUT.LEDGER_SIGN, { oneriId: bo.proposalId })).durum, 'uygulandi')
  const kasa = (await bekle(() => kol(A, 'Kasa'), { neden: 'A Kasa koleksiyonu' })).collectionId
  const kur = await A.iste(KOMUT.VAULT_SETUP_VRK, { collectionId: kasa, kagit: 1 })
  t.is(kur.kagitlar.length, 1)
  const sahipler = async () => (await A.iste(KOMUT.VAULT_STATUS)).kasalar.find((x) => x.collectionId === kasa).kurulu.sahipler
  await bekle(async () => (await sahipler()).every((x) => x.tur === 'kagit' || x.teslim), { neden: 'B ve kutu payı teslim' })
  t.alike((await sahipler()).map((x) => [x.tur, x.tur === 'kagit' ? null : x.id, x.teslim]).sort(), [['cihaz', K.me, true], ['kagit', null, null], ['kisi', A.me, true], ['kisi', B.me, true]].sort(), 'A kendi payını tutar, B ve kutu ACK verdi, kâğıt basılmadı')
  const kutununPaylari = await K.kutuPaylari()
  t.is(kutununPaylari.length, 1, 'kutu KRA payını TPM mühürlü tutuyor')
  adim('kasa kuruldu, B payını aldı')

  // --- B'nin kasası kilitli: A'nın kasa kaydı B'de 224 ile açılır
  await A.iste(KOMUT.UNLOCK, { archiveKeyHex: ayar.A.arsiv.skHex })
  const rk = await A.iste(KOMUT.RECORD_PUT, { collectionId: kasa, type: 'yuva.defter.sifre', fields: { ad: 'Banka', parola: 'p4r0l4' } })
  t.is((await bekle(() => getir(A, kasa, rk), { neden: 'A kasa kaydı' })).fields.parola, 'p4r0l4')
  await uyu(300)
  t.is(await B.iste(KOMUT.RECORD_GET, { collectionId: kasa, recordId: rk }).then(() => null, (e) => e.message), 'VAULT_LOCKED', 'B kilitli')
  await B.iste(KOMUT.UNLOCK, { archiveKeyHex: ayar.B.arsiv.skHex })
  t.is((await bekle(() => getir(B, kasa, rk), { neden: 'B kasa kaydı' })).fields.parola, 'p4r0l4', 'B 224 ile açtı')
  await B.iste(KOMUT.LOCK)
  adim('B kasası kilitli, 224 ile açıldı')

  // --- Çevrimdışı: B kapalıyken A yazar ve dosya ekler, kutu tutar; A da çevrimdışıyken B kutudan eşitlenir
  ag.cevrimdisiYap('B')
  const r4 = await A.iste(KOMUT.RECORD_PUT, { collectionId: tum, type: 'yuva.defter.not', fields: { baslik: 'B yokken' } })
  const icerik2 = b4a.from('ikinci dosya')
  const ref2 = await A.iste(KOMUT.RECORD_ATTACH, { bytes: { $b: b4a.toString(icerik2, 'base64') }, mime: 'text/plain', name: 'iki.txt' })
  await A.iste(KOMUT.RECORD_PUT, { collectionId: tum, recordId: r4, fields: { dosya: ref2 } })
  const kutudaki = await bekle(async () => { const n = await K.kutuSayi(); return n >= 6 ? n : null }, { neden: 'kutu emaneti' })
  await uyu(200)
  t.is(await getir(B, tum, r4), null, 'B çevrimdışıyken almadı')
  ag.cevrimdisiYap('A')
  ag.cevrimiciYap('B')
  const b4 = await bekle(async () => { const x = await getir(B, tum, r4); return x && x.fields.dosya ? x : null }, { neden: 'B kutudan r4' })
  t.is(b4.fields.baslik, 'B yokken', 'A çevrimdışıyken B kaydı kutudan aldı')
  const acilan2 = await bekle(() => B.iste(KOMUT.RECORD_OPEN, { blobRef: b4.fields.dosya }), { neden: 'B dosyayı kutudan açar' })
  t.ok(b4a.equals(b4a.from(acilan2.bytes.$b, 'base64'), icerik2), 'dosya kutudan')
  ag.cevrimiciYap('A')
  adim('çevrimdışı B kutudan eşitlendi (' + kutudaki + ' işlem emanette)')

  // --- Üye çıkarma (13): çıkarılan B sonraki kayıtları okuyamaz, gönderdiği kabul edilmez
  const cik = await A.iste(KOMUT.MEMBER_REMOVE, { memberId: B.me })
  t.is(cik.durum, 'uygulandi', 'tek kalan ebeveyn B\'yi çıkarır')
  await bekle(async () => (await uz(K)) === (await uz(A)), { neden: 'kutu çıkarmayı aldı' })
  const r5 = await A.iste(KOMUT.RECORD_PUT, { collectionId: tum, type: 'yuva.defter.not', fields: { baslik: 'B çıktıktan sonra' } })
  await bekle(() => getir(A, tum, r5), { neden: 'A r5 yazıldı' })
  // Çıkarılan B açık oturumdan kendi çıkarılmasını alır (Codex 12. tur; kurucu §6.8) ve artık yazmaz
  await bekle(async () => (await B.iste(KOMUT.MEMBERS)).every((x) => x.memberId !== B.me || x.aktif === false) || null, { neden: 'B çıkarılmasını gördü' })
  const yazim = await B.iste(KOMUT.RECORD_PUT, { collectionId: tum, type: 'yuva.defter.not', fields: { baslik: 'çıkarılanın yazımı' } }).then((rB) => ({ rB }), (e) => ({ hata: e.message }))
  t.is(yazim.hata, 'NO_PERMISSION', 'çıkarılan B yazamaz')
  await uyu(1000)
  t.is(await getir(B, tum, r5), null, 'çıkarılan B yeni kaydı okuyamaz')
  t.ok((await A.iste(KOMUT.MEMBERS)).every((x) => x.memberId !== B.me || x.aktif === false), 'B üyeler listesinde aktif değil')
  adim('B çıkarıldı')

  // --- Her süreç kapatılıp yeniden açılır: durum, kutunun emaneti ve kasa arşivi diskten
  for (const [ad, c] of [['A', A], ['B', B], ['K', K]]) ayar[ad].sayac = (await c.kapat()).sayac
  const A2 = await ac('A')
  const B2 = await ac('B')
  const K2 = await ac('K')
  t.teardown(async () => { for (const c of [A2, B2, K2]) if (c.canli) await c.kapat().catch(() => {}) })
  t.is((await getir(A2, tum, r1)).fields.not, 'iki litre')
  t.is((await getir(B2, tum, r4)).fields.baslik, 'B yokken', 'B kendi kopyasını diskten açtı')
  t.is(await K2.kutuSayi(), await bekle(() => K2.kutuSayi()), 'kutunun emaneti diskten')
  t.alike(await K2.kutuPaylari(), kutununPaylari, 'yeniden başlayan kutu payını mühürden açtı')
  t.ok((await K2.kutuSayi()) >= kutudaki)
  t.is(await A2.iste(KOMUT.RECORD_GET, { collectionId: kasa, recordId: rk }).then(() => null, (e) => e.message), 'VAULT_LOCKED', 'A yeniden açılışta kilitli')
  await A2.iste(KOMUT.UNLOCK, { archiveKeyHex: ayar.A.arsiv.skHex })
  t.is((await getir(A2, kasa, rk)).fields.parola, 'p4r0l4', 'A arsivden açtı')
  const r6 = await A2.iste(KOMUT.RECORD_PUT, { collectionId: tum, type: 'yuva.defter.not', fields: { baslik: 'yeniden açılıştan sonra' } })
  await bekle(async () => (await K2.kutuSayi()) > kutudaki, { neden: 'yeni işlem kutuda' })
  await uyu(500)
  t.is(await getir(B2, tum, r6), null, 'B yeniden açılışta da almaz')
  adim('üç süreç yeniden açıldı')
  t.alike([A, B, K, A2, B2, K2].map((c) => c.hatalar), [[], [], [], [], [], []], 'hiçbir süreçte çekirdek hatası yok (çıkarılanın zarfları süzgeçte atıldı)')
  t.comment('zarf: ' + ag.sayac.zarf + ', atılan: ' + ag.sayac.atilan)

  for (const [ad, ms] of sure) t.comment(ad + ': ' + ms + ' ms')
})
