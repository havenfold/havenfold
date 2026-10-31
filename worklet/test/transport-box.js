// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D58: kutu da taşıyıcıda (deneysel; RFC-0028 §7 d önerisi). Yerel HyperDHT testnet'inde üç süreç: iki telefon (test
// Node'da koşuyorsa Node, Bare'de Bare) ve kutu (aynı çalışma ortamında: Bare koşusunda kutu çekirdeği de Bare'de, D62;
// düğüm yazılımının taşıyıcısı node/box-transport.js, kutu rolüyle).
// Tören, kutunun katılması, kayıt eşitlemesi, kutunun KRA payı (D39, taklit TPM), çevrimdışı telefonun kaydı kutu
// kovasından alması. Dış ağa ya da genel önyükleme düğümlerine bağlanılmaz. Beklenenler elle.
'use strict'
const test = require('brittle')
const b4a = require('b4a')
const sodium = require('sodium-native')
const createTestnet = require('hyperdht/testnet')
const { KOMUT } = require('../example/product')
const { geciciDizin, arsivAnahtari } = require('./helpers/common')
const { BoruAgi, bekle, yukCarpani } = require('./helpers/multi')

const rastgeleHex = (n) => { const b = b4a.alloc(n); sodium.randombytes_buf(b); return b4a.toString(b, 'hex') }

test('kutu taşıyıcıda: tören, kutu katılır, kayıt eşitlenir, kutu KRA payını alır, çevrimdışı telefon kaydı kutu kovasından alır', { timeout: 240000 * yukCarpani() }, async (t) => {
  const tn = await createTestnet(3, t.teardown)
  const bootstrap = tn.bootstrap
  t.ok(bootstrap.every((x) => x.host === '127.0.0.1'), 'önyükleme yalnız yerel')
  const ag = new BoruAgi() // yalnız süreç yönetimi; zarflar DHT'den gider
  for (const ad of ['A', 'B', 'K']) ag.cevrimdisiYap(ad)
  const ayar = {}
  for (const [ad, tohum] of [['A', 81], ['B', 82], ['K', 83]]) ayar[ad] = { dizin: geciciDizin(t, 'tk-' + ad), anahtarHex: rastgeleHex(32), arsiv: arsivAnahtari(tohum), sayac: null }
  const kutuPay = { dizin: geciciDizin(t, 'tk-K-tpm'), tpmAnahtarHex: rastgeleHex(32) }
  const acik = new Map()
  const ac = async (ad) => {
    const c = ag.cihaz(ad)
    ag.cevrimdisiYap(ad)
    await c.start({ dizin: ayar[ad].dizin, anahtarHex: ayar[ad].anahtarHex, archivePubHex: ayar[ad].arsiv.pubHex, sayac: ayar[ad].sayac, dht: bootstrap, yoklamaMs: 500, ...(ad === 'K' ? { kutuPay, kutuTasiyici: true } : { kutuUygun: true }) })
    acik.set(ad, c)
    return c
  }
  const kapat = async (ad) => { const c = acik.get(ad); ayar[ad].sayac = (await c.kapat()).sayac; acik.delete(ad) }
  t.teardown(async () => { for (const c of acik.values()) if (c.canli) await c.kapat().catch(() => {}) })
  const A = await ac('A')
  let B = await ac('B')
  const K = await ac('K')

  // --- Tören (DHT): A aile kurar, B'yi ebeveyn olarak katar
  await A.iste(KOMUT.CREATE_FAMILY, { aileAdi: 'Rivera', benimAdim: 'Alex' })
  await A.iste(KOMUT.INVITE_START, { tur: 'uye', rol: 'ebeveyn' })
  const qr = (await bekle(() => A.toren('qr'), { neden: 'qr', sure: 30000 })).qr
  t.alike(await B.iste(KOMUT.JOIN, { kod: qr }), { tur: 'uye' })
  const [sa, sb] = [await bekle(() => A.toren('sas'), { neden: 'A sas', sure: 45000 }), await bekle(() => B.toren('sas'), { neden: 'B sas', sure: 45000 })]
  t.alike(sa.resimler, sb.resimler, 'aynı 5 resim')
  await B.iste(KOMUT.INVITE_CONFIRM, { ayni: true })
  await A.iste(KOMUT.INVITE_CONFIRM, { ayni: true })
  await bekle(() => A.toren('tamam') && B.toren('tamam'), { neden: 'tören tamam', sure: 30000 })

  // --- Kutu: QR'ı kutu gösterir (düğüm yazılımının tören kancası), A tarar
  const kqr = await K.kutuQr()
  t.alike(await A.iste(KOMUT.JOIN, { kod: kqr }), { tur: 'kutu' })
  await bekle(() => A.olaylar.filter((x) => x.olay === 'ceremony' && x.veri.adim === 'sas').length >= 2, { neden: 'kutu sas', sure: 45000 })
  await A.iste(KOMUT.INVITE_CONFIRM, { ayni: true })
  await bekle(async () => (await K.iste(KOMUT.FAMILY_INFO)).aile, { neden: 'kutu ailede', sure: 45000 })
  const uz = async (c) => (await c.iste(KOMUT.FAMILY_INFO)).uzunluk
  await bekle(async () => (await uz(B)) === (await uz(A)) && (await uz(K)) === (await uz(A)), { neden: 'defter üç cihazda eşit', sure: 60000 })

  // --- Kayıt: A yazar, B ve kutu alır
  const kol = async (c, ad) => (await c.iste(KOMUT.RECORD_COLLECTIONS)).find((x) => x.name === ad)
  const tum = (await kol(A, 'Tüm Aile')).collectionId
  const getir = (c, cid, rid) => c.iste(KOMUT.RECORD_GET, { collectionId: cid, recordId: rid })
  const r1 = await A.iste(KOMUT.RECORD_PUT, { collectionId: tum, type: 'yuva.defter.not', fields: { baslik: 'DHT üstünden' } })
  t.is((await bekle(() => getir(B, tum, r1), { neden: 'B r1', sure: 45000 })).fields.baslik, 'DHT üstünden')
  await bekle(async () => (await K.kutuSayi()) >= 1, { neden: 'kutu emaneti', sure: 45000 })

  // --- Kasa: iki ebeveynde Kasa koleksiyonu öneri olur, B imzalar; KRA payı kutuya DHT'den (0xF1/0xF2)
  // Kurulumdan önce A'nın B ve kutuyla oturumu açık olmalı (İstek 150): A'nın Arşivi bu testte kilitli (UNLOCK yok);
  // kurulumda oturumu olmayan tutucunun payı kayıtta arsive mühürlenir ve kilit açılana kadar gitmez (D31). Kutu
  // emaneti B üstünden de dolabildiği için A–kutu oturumu yukarıdaki adımlarla beklenmiş olmuyordu.
  for (const [ad, id] of [['B', B.me], ['kutu', K.me]]) await bekle(async () => (await A.iste(KOMUT.PRESENCE_GET, { memberId: id })).online, { neden: 'A–' + ad + ' oturumu', sure: 45000 })
  const oneri = await A.iste(KOMUT.VAULT_SETUP_VRK, { collectionId: null, kagit: 1 })
  t.is(oneri.koleksiyon.durum, 'oneri')
  const bo = await bekle(async () => (await B.iste(KOMUT.PROPOSALS)).find((x) => x.type === 'COLLECTION'), { neden: 'B öneriyi aldı', sure: 45000 })
  t.is((await B.iste(KOMUT.LEDGER_SIGN, { oneriId: bo.proposalId })).durum, 'uygulandi')
  const kasa = (await bekle(() => kol(A, 'Kasa'), { neden: 'A Kasa koleksiyonu', sure: 45000 })).collectionId
  await A.iste(KOMUT.VAULT_SETUP_VRK, { collectionId: kasa, kagit: 1 })
  const sahipler = async () => (await A.iste(KOMUT.VAULT_STATUS)).kasalar.find((x) => x.collectionId === kasa).kurulu.sahipler
  await bekle(async () => (await sahipler()).every((x) => x.tur === 'kagit' || x.teslim), { neden: 'B ve kutu payı teslim', sure: 60000 })
  t.ok((await sahipler()).some((x) => x.tur === 'cihaz' && x.id === K.me && x.teslim), 'kutu payı ACK verdi')
  t.is((await K.kutuPaylari()).length, 1, 'kutu KRA payını TPM mühürlü tutuyor')

  // --- Çevrimdışı: B kapalıyken A yazar; kutu tutar; A kapanır, B açılır ve kaydı kutu kovasından alır
  await kapat('B')
  const once = await K.kutuSayi()
  const r2 = await A.iste(KOMUT.RECORD_PUT, { collectionId: tum, type: 'yuva.defter.not', fields: { baslik: 'B yokken' } })
  await bekle(async () => (await K.kutuSayi()) > once, { neden: 'kutu r2 emaneti', sure: 45000 })
  await kapat('A')
  B = await ac('B')
  t.is((await bekle(() => getir(B, tum, r2), { neden: 'B r2 kutudan', sure: 60000 })).fields.baslik, 'B yokken', 'A kapalıyken B kaydı kutudan aldı')
  t.alike([B.hatalar, K.hatalar], [[], []], 'çekirdek hatası yok')
})

test('kutu taşıyıcısı bayrak arkasında ve kutu rolü dışında buluşmaya girmez', (t) => {
  const { kutuTasiyici } = require('../../node/box-transport')
  t.exception(() => kutuTasiyici({ dht: {}, cihaz: () => null }), /EXPERIMENTAL_DISABLED/)
  t.exception(() => kutuTasiyici({ dht: null, cihaz: () => null, deneysel: true }), /NO_DHT/)
  const A = require('../../core/records/test/helpers/family')
  const L = A.anaDefter()
  const dht = { createServer: () => ({ listen: async () => {}, close: async () => {} }), connect: () => ({ on () {}, once () {} }) }
  // Kerem ebeveyn: kutu taşıyıcısı onun kimliğiyle buluşmaya girmez (dinleme sunucusu açmaz)
  const ebeveyn = kutuTasiyici({ dht, cihaz: () => ({ kimlik: A.K.kerem, ledger: L }), deneysel: true })
  ebeveyn.tasiyici.yokla()
  t.is(ebeveyn.tasiyici.sunucular.size, 0, 'ebeveyn kimliği kutu taşıyıcısında boş')
  const kutu = kutuTasiyici({ dht, cihaz: () => ({ kimlik: A.K.kutu, ledger: L }), deneysel: true })
  kutu.tasiyici.yokla()
  t.ok(kutu.tasiyici.sunucular.size > 0 || kutu.tasiyici.aranan.size > 0, 'kutu kimliği buluşmaya girer')
})
