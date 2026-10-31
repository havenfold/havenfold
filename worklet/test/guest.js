// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D99: misafir (bakıcı) töreni ve misafir kipi uçtan uca (protocol/vectors/guest-ceremony.json). İki gerçek çekirdek,
// ayrı süreçler, yerel HyperDHT testnet'i (dış ağ yok): ebeveyn misafir kodu gösterir → bakıcı okutur → 5 resim → GRANT →
// GUEST_VIEW → bakıcı izinli türde bırakır, okuyamaz → aynı bakıcıyla yeniden tören kapanır (uzatma protokolde yok) →
// REVOKE sonrası bırakamaz. Beklenenler RFC-0019
// §11.3, RFC-0030 ve RFC-0003 §5.5'ten elle yazıldı.
'use strict'
const test = require('brittle')
const b4a = require('b4a')
const sodium = require('sodium-native')
const createTestnet = require('hyperdht/testnet')
const { KOMUT } = require('../example/product')
const { geciciDizin, arsivAnahtari, hataOf } = require('./helpers/common')
const { BoruAgi, bekle, yukCarpani } = require('./helpers/multi')
const V = require('../../protocol/vectors/guest-ceremony.json')

const hex = (b) => b4a.toString(b, 'hex')
const rastgele = (n) => { const b = b4a.alloc(n); sodium.randombytes_buf(b); return b }
const GUN = 86_400_000

test('D99 misafir töreni ve kipi: tören, izin, bırakma, okuyamaz, uzatma, kaldırma', { timeout: 300000 * yukCarpani() }, async (t) => {
  const tn = await createTestnet(3, t.teardown)
  const ag = new BoruAgi()
  const cihazlar = []
  t.teardown(async () => { for (const x of cihazlar) if (x.canli) await x.kapat().catch(() => {}) })
  const ac = async (ad, tohum) => {
    const x = ag.cihaz(ad)
    ag.cevrimdisiYap(ad)
    await x.start({ dizin: geciciDizin(t, 'mis-' + ad), anahtarHex: hex(rastgele(32)), archivePubHex: arsivAnahtari(tohum).pubHex, dht: tn.bootstrap, tekAyar: true, yoklamaMs: 500 })
    cihazlar.push(x)
    return x
  }
  const sure = 60000
  const A = await ac('A', 71) // ebeveyn
  const B = await ac('B', 72) // bakıcının telefonu
  await A.iste(KOMUT.CREATE_FAMILY, { aileAdi: 'Eser', benimAdim: 'Kerem' })
  await A.iste(KOMUT.EXAMPLE_LEVEL, { duzey: '2.3' }) // bakıcının bırakması düzey 2.3 ister (RFC-0030)
  const tum = (await A.iste(KOMUT.RECORD_COLLECTIONS)).find((x) => x.name === 'Tüm Aile').collectionId

  // Tören: n'inci tören olaylarını ayırmak için olay sayıları
  async function toren (bitis, beklenenHata = null) {
    const [na, nb] = [A.olaylar.length, B.olaylar.length]
    const son = (x, n, adim) => x.olaylar.slice(n).filter((o) => o.olay === 'ceremony' && o.veri.adim === adim).at(-1)?.veri || null
    t.is(await hataOf(A.iste(KOMUT.INVITE_START, { tur: 'misafir', bitis: Date.now() + 91 * GUN })), V.davet.hata, '90 günden uzun olmaz')
    await A.iste(KOMUT.INVITE_START, { tur: 'misafir', bitis })
    const qr = (await bekle(() => son(A, na, 'qr'), { neden: 'qr', sure })).qr
    await B.iste(KOMUT.JOIN, { kod: qr })
    const sa = await bekle(() => son(A, na, 'sas'), { neden: 'A sas', sure })
    const sb = await bekle(() => son(B, nb, 'sas'), { neden: 'B sas', sure })
    t.alike(sa.resimler, sb.resimler, 'iki tarafta aynı 5 resim')
    t.is(sb.aileAdi, 'Eser', 'misafirin ekranında aile adı (RFC-0036 K1, D97)')
    t.is(sa.aileAdi, null)
    await B.iste(KOMUT.INVITE_CONFIRM, { ayni: true })
    await A.iste(KOMUT.INVITE_CONFIRM, { ayni: true })
    if (beklenenHata) return bekle(() => son(A, na, 'kapandi'), { neden: 'tören kapandı', sure })
    await bekle(() => son(A, na, 'tamam') && son(B, nb, 'tamam'), { neden: 'tören tamam', sure })
  }

  const bitis1 = Date.now() + 2 * GUN
  await toren(bitis1)
  const bb = await B.iste(KOMUT.FAMILY_INFO)
  t.absent(bb.aile, 'bakıcı aile üyesi değil')
  t.is(bb.misafir.bitis, bitis1, V.adimlar[0].beklenen)
  t.is(bb.misafir.aileAdi, 'Eser', 'ad misafir örneğinin yerel durumunda (RFC-0036 §4.3 madde 5a)')
  let liste = await A.iste(KOMUT.CAREGIVER_LIST)
  t.is(liste.length, 1)
  t.alike([liste[0].grantId, liste[0].aktif, liste[0].bitis], [B.me, true, bitis1])

  // İzin: Tüm Aile'de Coki için örnek ürünün notu (özne defterde olmalı: D98 varlık); misafire yeni görünümle gider
  const { varlikId: coki } = await A.iste(KOMUT.BEING_ADD, { tur: 'kedi', ad: 'Coki' })
  await A.iste(KOMUT.CAREGIVER_WRITE_GRANT, { grantId: B.me, collectionId: tum, types: ['yuva.ornek.not'], subjects: ['varlik:' + coki] })
  await bekle(async () => (await B.iste(KOMUT.GUEST_PERMISSIONS)).some((x) => x.collectionId === tum && x.types.includes('yuva.ornek.not')), { neden: 'izin misafire', sure })
  t.pass(V.adimlar[1].beklenen)

  // Bırakma: ebeveynde görünür
  const r = await B.iste(KOMUT.GUEST_DROP, { collectionId: tum, type: 'yuva.ornek.not', alanlar: { subj: 'varlik:' + coki, metin: 'mama verdim' } })
  t.ok(r.recordId)
  const k = await bekle(async () => (await A.iste(KOMUT.RECORD_QUERY, { collectionId: tum, type: 'yuva.ornek.not' })).find((x) => x.recordId === r.recordId), { neden: 'bırakma ebeveynde', sure })
  t.is(k.fields.metin, 'mama verdim', V.adimlar[2].beklenen)
  t.alike((await B.iste(KOMUT.GUEST_MY_WRITES)).map((x) => x.recordId), [r.recordId])
  t.is(await hataOf(B.iste(KOMUT.GUEST_DROP, { collectionId: tum, type: 'yuva.ornek.not', alanlar: { subj: 'varlik:' + 'ab'.repeat(16), metin: 'x' } })), 'SUBJECT_NOT_ALLOWED', 'izinsiz özne')
  // Okuyamaz
  t.is(await hataOf(B.iste(KOMUT.RECORD_QUERY, { collectionId: tum })), V.adimlar[3].hata, 'misafir aile kaydını okuyamaz')
  t.is(await hataOf(A.iste(KOMUT.GUEST_PERMISSIONS)), 'NOT_GUEST')

  // Uzatma protokolde yok: aynı bakıcıyla yeniden tören hiçbir şey yazmadan kapanır (İstek 177)
  const kapandi = await toren(Date.now() + 5 * GUN, V.adimlar[4].hata)
  t.is(kapandi.neden, V.adimlar[4].hata)
  liste = await A.iste(KOMUT.CAREGIVER_LIST)
  t.alike(liste.map((x) => [x.grantId, x.aktif, x.bitis]), [[B.me, true, bitis1]], V.adimlar[4].beklenen)
  t.is((await B.iste(KOMUT.FAMILY_INFO)).misafir.bitis, bitis1)
  t.is((await A.iste(KOMUT.RECORD_COLLECTIONS)).filter((x) => x.name.startsWith('Bakıcı:')).length, 1, 'ikinci bakıcı koleksiyonu açılmadı')

  // Kaldırma: GUEST_REVOKED, bırakma biter
  t.is((await A.iste(KOMUT.CAREGIVER_REMOVE, { grantId: B.me, neden: 'süre doldu' })).durum, 'uygulandi')
  await bekle(async () => (await B.iste(KOMUT.FAMILY_INFO)).misafir.bitti, { neden: 'GUEST_REVOKED misafirde', sure })
  t.ok(B.olaylar.some((x) => x.olay === 'guest' && x.veri.durum === 'bitti'))
  t.is(await hataOf(B.iste(KOMUT.GUEST_DROP, { collectionId: tum, type: 'yuva.ornek.not', alanlar: { subj: 'varlik:' + coki, metin: 'x' } })), V.adimlar[5].hata)
  t.alike((await A.iste(KOMUT.CAREGIVER_LIST)).map((x) => x.aktif), [false])
  t.is(await hataOf(A.iste(KOMUT.CAREGIVER_REMOVE, { grantId: B.me })), 'NO_TARGET')
  t.alike([A.hatalar, B.hatalar], [[], []], 'çekirdek hatası yok')
})
