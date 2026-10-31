// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Adım 4: dizin kapsamı, silme kuralları, şifreli bloklar, parçalama, arama birleştirme (RFC-0013 §19 11, 12).
// Türetmelerin beklenen değeri, baytlar elle dizilerek sodium ile ayrıca hesaplanır.
const test = require('brittle')
const b4a = require('b4a')
const sodium = require('sodium-native')
const { dizin: d } = require('..')
const A = require('../../records/test/helpers/family')

const hex = (b) => b4a.toString(b, 'hex')
const K = b4a.alloc(32, 0x5a)
const KEY_ID = b4a.alloc(16, 0x01)
const COL = b4a.alloc(16, 0x31)
const MH = b4a.alloc(32, 0xaa)

test('vektör 11: indexKey ve AD türetimi', (t) => {
  const beklenenKey = b4a.alloc(32)
  sodium.crypto_generichash_batch(beklenenKey, [b4a.from('yuva/v2/hf/ai-index/'), COL], K)
  t.alike(d.indexKey(K, COL), beklenenKey)
  const u64 = b4a.from([0, 0, 0, 0, 0, 0, 0, 7])
  const beklenenAD = b4a.alloc(32)
  sodium.crypto_generichash_batch(beklenenAD, [b4a.from('yuva/v2/hf/ai-index-ad/'), COL, KEY_ID, u64, MH])
  t.alike(d.blokAD(COL, KEY_ID, 7, MH), beklenenAD)
  t.alike(d.indexKey(K, hex(COL)), beklenenKey, 'hex kimlik de olur')
})

test('vektör 11: şifreli blok', (t) => {
  const parcalar = [{ ref: 'kayit:' + '31'.repeat(16) + '/' + '01'.repeat(16), vec: Int8Array.from([127, -127, 0, 5]) }, { ref: 'dosya:' + 'bb'.repeat(32) + '#s=2', vec: Int8Array.from([1, 2, 3, 4]) }]
  const g = { K, keyId: KEY_ID, collectionId: COL, blokNo: 3, modelHash: MH }
  const bytes = d.blokSifrele({ ...g, parcalar })
  t.alike(d.blokCoz({ ...g, bytes }), parcalar)
  t.exception(() => d.blokCoz({ ...g, blokNo: 4, bytes }), /INDEX_CORRUPT/, 'blok numarası AD içinde')
  t.exception(() => d.blokCoz({ ...g, modelHash: b4a.alloc(32, 0xab), bytes }), /INDEX_CORRUPT/, 'model AD içinde')
  t.exception(() => d.blokCoz({ ...g, K: b4a.alloc(32, 1), bytes }), /INDEX_CORRUPT/, 'başka dönem anahtarı')
  t.exception(() => d.blokCoz({ ...g, collectionId: b4a.alloc(16, 0x32), bytes }), /INDEX_CORRUPT/)
  t.exception(() => d.blokSifrele({ ...g, parcalar: [parcalar[0], { ref: 'x', vec: Int8Array.from([1]) }] }), /INVALID_BLOCK/, 'boyut aynı olmalı')
  t.exception(() => d.blokSifrele({ ...g, parcalar: Array.from({ length: 257 }, () => parcalar[0]) }), /INVALID_BLOCK/)
})

test('vektör 11: dizinlenecek koleksiyonlar (çocuk, yetişkin, ebeveyn)', (t) => {
  const L = A.anaDefter()
  const H = (b) => hex(b)
  t.alike(d.dizinlenecekler(L, A.K.ecem.memberId), [H(A.K_TUM_AILE)], 'çocuk: yalnız okuduğu Tüm Aile')
  t.alike(d.dizinlenecekler(L, A.K.irem.memberId), [H(A.K_TUM_AILE), H(A.K_KISISEL_IREM), H(A.K_OLAYLAR)].sort())
  t.alike(d.dizinlenecekler(L, A.K.kerem.memberId), [H(A.K_TUM_AILE), H(A.K_BAKICI), H(A.K_OLAYLAR)].sort(), 'kasa kilitliyken yok')
  t.alike(d.dizinlenecekler(L, A.K.kerem.memberId, { kasaAcik: true }), [H(A.K_TUM_AILE), H(A.K_BAKICI), H(A.K_OLAYLAR), H(A.K_KASA)].sort())
  t.ok(d.dizinlenir('yuva.defter.garanti'))
  t.absent(d.dizinlenir('hf.ai.konusma'), 'asistan kendi cevaplarından beslenmez')
  t.absent(d.dizinlenir('hf.ai.kupon'))
})

test('vektör 11: okuyuculuktan çıkaran COLLECTION uygulanınca dizin silinir', (t) => {
  const L = A.anaDefter()
  const silinen = []
  const bekci = new d.DizinBekcisi({ me: A.K.ecem.memberId, sil: (cid, seq) => silinen.push([cid, seq]) })
  t.alike(bekci.uygula(L), [], 'ilk kurulumda silinecek yok')
  const seq = L.len
  L.apply(A.koleksiyon(L, [A.K.kerem], { readers: ['rol:ebeveyn', 'rol:yetiskin'], writers: ['rol:ebeveyn', 'rol:yetiskin'] }))
  bekci.uygula(L)
  t.alike(silinen, [[hex(A.K_TUM_AILE), seq]])
  // Başka üyenin bekçisi silmez
  const irem = []
  const b2 = new d.DizinBekcisi({ me: A.K.irem.memberId, sil: (cid) => irem.push(cid) })
  b2.uygula(L)
  t.alike(irem, [])
  // Çıkarılan üye: bütün dizinleri silinir
  L.apply(A.olay(L, A.T.REMOVE_MEMBER, { memberId: A.K.irem.memberId, reason: 'test', wipe: false }, [A.K.kerem, A.K.husniye]))
  b2.uygula(L)
  t.alike(irem.sort(), [hex(A.K_TUM_AILE), hex(A.K_KISISEL_IREM), hex(A.K_OLAYLAR)].sort())
})

test('parçalama ve nicemleme (§9.2)', (t) => {
  // 300 farklı kelime, her biri 9 karakter + boşluk: kelime i [10i, 10i + 9) aralığında
  const metin = Array.from({ length: 300 }, (_, i) => 'k' + String(i).padStart(8, '0')).join(' ') // 2999 karakter
  const p = d.parcala(metin)
  t.is(p.length, 3)
  t.is(p[0].length, 1199, 'sınırdaki boşlukta kesildi')
  t.ok(p[1].startsWith('k00000100'), 'kelime başından')
  t.is(metin.indexOf(p[1]), 1000, 'kesimden 200 karakter önce')
  t.is(metin.indexOf(p[2]), 2000)
  t.ok(p[2].endsWith('k00000299'))
  t.alike(d.parcala('kısa metin'), ['kısa metin'])
  t.alike(d.parcala(''), [])
  t.is(d.parcala('x'.repeat(2500)).length, 3, 'boşluk yoksa tam sınırdan')
  t.alike(Array.from(d.nicemle([3, 4])), [76, 102]) // 0.6 × 127 = 76.2, 0.8 × 127 = 101.6
  t.alike(Array.from(d.nicemle([-1, 0, 0])), [-127, 0, 0])
  t.alike(Array.from(d.nicemle([1, 1, 1, 1])), [64, 64, 64, 64], '63.5 sıfırdan uzağa')
  t.alike(Array.from(d.nicemle([-1, -1, -1, -1])), [-64, -64, -64, -64])
  t.is(d.icCarpim(Int8Array.from([1, -2]), Int8Array.from([3, 4])), -5)
  t.ok(d.esikAsar(127 * 127, 999))
  t.ok(d.esikAsar(8065, 500), '8 065 000 > 500 × 16 129 = 8 064 500')
  t.absent(d.esikAsar(8064, 500), '8 064 000 aşmaz')
  t.is(d.kayitMetni({ ad: 'Kombi', marka: 'X', _conf: 90, notlar: ['a', 'b'] }, [{ ad: 'ad', etiket: 'Ad' }, { ad: 'marka', etiket: 'Marka' }, { ad: 'notlar', etiket: 'Notlar' }]), 'Ad: Kombi\nMarka: X\nNotlar: a, b')
})

test('vektör 12: karşılıklı sıra birleşimi ve eşitlik çözümü', (t) => {
  const P = (id, col, rec) => ({ id, collectionId: col, recordId: rec })
  const c1 = '01'.repeat(16)
  const c2 = '02'.repeat(16)
  const r1 = '0a'.repeat(16)
  const r2 = '0b'.repeat(16)
  const anahtar = [P('x', c2, r1), P('y', c1, r2), P('z', c1, r1)]
  const anlam = [P('z', c1, r1), P('w', c1, r1), P('x', c2, r1)]
  const s = d.rrf([anahtar, anlam])
  // x: 1/61 + 1/63; z: 1/63 + 1/61 (eşit); y: 1/62; w: 1/62 (eşit)
  t.alike(s.map((a) => a.id), ['z', 'x', 'w', 'y'], 'z (c1) x\'ten (c2) önce; w ve y aynı koleksiyonda, w r1 < y r2')
  t.is(s[0].puan, 1 / 61 + 1 / 63)
  t.is(s[2].puan, 1 / 62)
  t.alike(d.rrf([[P('b', c1, r1), P('a', c1, r1)]]).map((a) => a.id), ['b', 'a'], 'tek listede sıra korunur')
})

test('anahtar kelime dizini, dayanak ve bağlam bütçesi (§9.4)', (t) => {
  const z = new d.AnahtarDizin()
  const c1 = '01'.repeat(16)
  z.ekle({ id: 'a#0', collectionId: c1, recordId: '0a'.repeat(16), ref: 'r1', metin: 'Kombi servisi telefonu' })
  z.ekle({ id: 'b#0', collectionId: c1, recordId: '0b'.repeat(16), ref: 'r2', metin: 'Coki aşı karnesi ve kombi' })
  z.ekle({ id: 'c#0', collectionId: '02'.repeat(16), recordId: '0c'.repeat(16), ref: 'r3', metin: 'Wifi şifresi' })
  const s = z.ara('KOMBİ servisi ne')
  t.alike(s.map((x) => x.id), ['a#0', 'b#0'])
  t.alike(s[0].eslesen, ['kombi', 'servisi'])
  t.ok(d.dayanakli(s[1]))
  t.absent(d.dayanakli({ eslesen: [] }))
  t.ok(d.dayanakli({ eslesen: [], carpim: 127 * 127 }, { esik: 800 }))
  const bag = z.ara('ve ne')
  t.alike(bag.map((x) => [x.id, x.eslesen]), [['b#0', []]], 'yalnız bağlaç eşleşti')
  t.absent(d.dayanakli(bag[0]), 'anlamlı kelime yok: dayanaksız')
  t.alike(z.ara('kombi', { koleksiyonlar: ['02'.repeat(16)] }), [])
  z.koleksiyonSil(c1)
  t.is(z.boyut, 1)
  z.kayitSil('02'.repeat(16), '0c'.repeat(16))
  t.is(z.boyut, 0)
  t.alike(d.anlamliKelimeler('Kombi ve su ne'), ['kombi'])
  const parca = (n) => ({ metin: 'a'.repeat(n * 3) })
  t.is(d.baglam([parca(1000), parca(1000), parca(600)]).length, 2, 'telefonda 2500 tahmini token')
  t.is(d.baglam([parca(1000), parca(1000), parca(600)], { yer: 'isci' }).length, 3)
  t.is(d.baglam(Array.from({ length: 10 }, () => parca(1))).length, 8)
})
