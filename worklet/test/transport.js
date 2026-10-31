// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D43: telefondaki taşıyıcının deneme sürümü (worklet/tasiyici, deneysel). Aynı makinede iki ayrı süreç (test Node'da
// koşuyorsa Node, Bare'de Bare) yerel bir HyperDHT testnet'i üstünden tören (3/4/5) ve kayıt eşitlemesi yapar. Dış ağa ya
// da genel önyükleme düğümlerine bağlanılmaz: önyükleme yalnız bu sürecin açtığı yerel düğümlerdir.
'use strict'
const test = require('brittle')
const b4a = require('b4a')
const sodium = require('sodium-native')
const createTestnet = require('hyperdht/testnet')
const { KOMUT } = require('../example/product')
const { DhtTasiyici } = require('@havenfold/transport')
const { dhtTorenTasiyici } = require('@havenfold/transport/ceremony')
const { geciciDizin, arsivAnahtari } = require('./helpers/common')
const { BoruAgi, bekle, yukCarpani } = require('./helpers/multi')

const rastgeleHex = (n) => { const b = b4a.alloc(n); sodium.randombytes_buf(b); return b4a.toString(b, 'hex') }

test('taşıyıcı bayrak arkasında: deneysel: true olmadan kurulmaz', (t) => {
  t.exception(() => new DhtTasiyici({ dht: {}, cihaz: () => null }), /EXPERIMENTAL_DISABLED/)
  t.exception(() => dhtTorenTasiyici({ dht: {}, cihaz: () => null }), /EXPERIMENTAL_DISABLED/)
})

test('iki süreç yerel testnet üstünde: tören (QR, aynı 5 resim, ADD_MEMBER), HELLO ile oturum, iki yönde kayıt eşitlemesi', { timeout: 120000 * yukCarpani() }, async (t) => {
  const tn = await createTestnet(3, t.teardown)
  const bootstrap = tn.bootstrap
  t.ok(bootstrap.every((x) => x.host === '127.0.0.1'), 'önyükleme yalnız yerel')
  const ag = new BoruAgi() // yalnız süreç yönetimi; zarflar DHT'den gider
  ag.cevrimdisiYap('A')
  ag.cevrimdisiYap('B')
  const ayar = {}
  const acik = []
  // Aynı cihaz yeniden açılınca aynı dizin, platform anahtarı ve sayaç
  const ac = async (ad, tohum) => {
    if (!ayar[ad]) ayar[ad] = { dizin: geciciDizin(t, 'tas-' + ad), anahtarHex: rastgeleHex(32), arsiv: arsivAnahtari(tohum).pubHex, sayac: null }
    const c = ag.cihaz(ad)
    ag.cevrimdisiYap(ad)
    await c.start({ dizin: ayar[ad].dizin, anahtarHex: ayar[ad].anahtarHex, archivePubHex: ayar[ad].arsiv, sayac: ayar[ad].sayac, dht: bootstrap, yoklamaMs: 500 })
    acik.push([ad, c])
    return c
  }
  const kapat = async (ad, c) => { ayar[ad].sayac = (await c.kapat()).sayac }
  const A = await ac('A', 51)
  const B = await ac('B', 52)
  t.teardown(async () => { for (const [, c] of acik) if (c.canli) await c.kapat().catch(() => {}) })

  await A.iste(KOMUT.CREATE_FAMILY, { aileAdi: 'Rivera', benimAdim: 'Alex' })
  await A.iste(KOMUT.INVITE_START, { tur: 'uye', rol: 'ebeveyn' })
  const qr = (await bekle(() => A.toren('qr'), { neden: 'qr', sure: 30000 })).qr
  t.ok(qr.startsWith('yuva://j/2/'))
  t.alike(await B.iste(KOMUT.JOIN, { kod: qr }), { tur: 'uye' })
  const sa = await bekle(() => A.toren('sas'), { neden: 'A sas', sure: 45000 })
  const sb = await bekle(() => B.toren('sas'), { neden: 'B sas', sure: 45000 })
  t.alike(sa.resimler, sb.resimler, 'iki tarafta aynı 5 resim')
  t.ok(sa.resimler.every((x) => x >= 0 && x < 64))
  await B.iste(KOMUT.INVITE_CONFIRM, { ayni: true })
  await A.iste(KOMUT.INVITE_CONFIRM, { ayni: true })
  await bekle(() => A.toren('tamam') && B.toren('tamam'), { neden: 'tören tamam', sure: 30000 })
  t.ok((await B.iste(KOMUT.FAMILY_INFO)).aile, 'B ailede')
  // Tören anahtarı çift sırrına girer (RFC-0028 §7 c): iki tarafta karşının kimliğiyle aynı anahtar, durumda
  const [ta, tb] = [await A.torenAnahtarlari(), await B.torenAnahtarlari()]
  t.ok(ta[B.me] && ta[B.me] === tb[A.me], 'iki tarafta aynı tören anahtarı')

  const tum = (await A.iste(KOMUT.RECORD_COLLECTIONS)).find((x) => x.name === 'Tüm Aile').collectionId
  const r1 = await A.iste(KOMUT.RECORD_PUT, { collectionId: tum, type: 'yuva.defter.not', fields: { baslik: 'DHT üstünden' } })
  const g1 = await bekle(() => B.iste(KOMUT.RECORD_GET, { collectionId: tum, recordId: r1 }), { neden: 'B kaydı aldı', sure: 30000 })
  t.is(g1.fields.baslik, 'DHT üstünden')
  const r2 = await B.iste(KOMUT.RECORD_PUT, { collectionId: tum, type: 'yuva.defter.not', fields: { baslik: 'geri' } })
  t.is((await bekle(() => A.iste(KOMUT.RECORD_GET, { collectionId: tum, recordId: r2 }), { neden: 'A kaydı aldı', sure: 30000 })).fields.baslik, 'geri')
  // Yeniden açılış: tören anahtarı durumdan gelir, oturum yine kurulur (anahtarlı çift sırrıyla)
  await kapat('A', A)
  await kapat('B', B)
  const A2 = await ac('A', 51)
  const B2 = await ac('B', 52)
  t.alike((await A2.torenAnahtarlari())[B2.me], ta[B.me], 'anahtar durumdan')
  const r3 = await A2.iste(KOMUT.RECORD_PUT, { collectionId: tum, type: 'yuva.defter.not', fields: { baslik: 'yeniden' } })
  t.is((await bekle(() => B2.iste(KOMUT.RECORD_GET, { collectionId: tum, recordId: r3 }), { neden: 'B2 kaydı aldı', sure: 45000 })).fields.baslik, 'yeniden')
  t.alike([A.hatalar, B.hatalar, A2.hatalar, B2.hatalar], [[], [], [], []], 'çekirdek hatası yok')
})

test('tören: farklı resim denince kapanır; QR sırrını bilmeyen buluşma anahtarına giremez', { timeout: 60000 * yukCarpani() }, async (t) => {
  const tn = await createTestnet(3, t.teardown)
  const ag = new BoruAgi()
  ag.cevrimdisiYap('A')
  ag.cevrimdisiYap('B')
  const A = ag.cihaz('A')
  await A.start({ dizin: geciciDizin(t, 'tas2-A'), anahtarHex: rastgeleHex(32), archivePubHex: arsivAnahtari(53).pubHex, dht: tn.bootstrap })
  const B = ag.cihaz('B')
  await B.start({ dizin: geciciDizin(t, 'tas2-B'), anahtarHex: rastgeleHex(32), archivePubHex: arsivAnahtari(54).pubHex, dht: tn.bootstrap })
  t.teardown(async () => { for (const c of [A, B]) if (c.canli) await c.kapat().catch(() => {}) })
  await A.iste(KOMUT.CREATE_FAMILY, { aileAdi: 'Rivera', benimAdim: 'Alex' })
  await A.iste(KOMUT.INVITE_START, { tur: 'uye', rol: 'cocuk' })
  // Yanlış sır: gösteren güvenlik duvarında reddeder (3 deneme de)
  const qr = (await bekle(() => A.toren('qr'), { sure: 30000 })).qr
  // Sırrı değiştirilmiş QR: arama anahtarı tutmaz, gösteren bağlantıyı almaz
  const ham = b4a.from(qr.slice('yuva://j/2/'.length), 'base64url')
  ham[ham.byteLength - 6] ^= 1
  await B.iste(KOMUT.JOIN, { kod: 'yuva://j/2/' + b4a.toString(ham, 'base64url') })
  t.is((await bekle(() => B.toren('kapandi'), { sure: 40000 })).neden, 'baglanti', 'yanlış sırla bağlantı kurulamaz')
  t.absent(A.toren('sas'), 'gösteren hiçbir JOIN_HELLO almadı')
  await B.iste(KOMUT.JOIN, { kod: qr })
  await bekle(() => A.toren('sas') && B.olaylar.filter((x) => x.veri && x.veri.adim === 'sas').length, { sure: 45000 })
  await A.iste(KOMUT.INVITE_CONFIRM, { ayni: false })
  t.is((await bekle(() => A.toren('kapandi'))).neden, 'farkli')
  t.absent((await B.iste(KOMUT.FAMILY_INFO)).aile, 'B ailede değil')
})
