// SPDX-License-Identifier: Apache-2.0
// D52: anlamsal arama uçtan uca (RFC-0013 §9.2–§9.5, §15.5). Taklit gömücü belirlenimci: kelime → kavram ekseni
// (eş anlamlılar aynı eksende), bilinmeyen kelime kendi ekseninde. Beklenen değerler elle.
const test = require('brittle')
const b4a = require('b4a')
const S = require('..')
const A = require('../../core/records/test/helpers/family')
const { metin: { N, kelimeler } } = require('@havenfold/ai')

const hex = (b) => b4a.toString(b, 'hex')
const TA = hex(A.K_TUM_AILE)
const KASA = hex(A.K_KASA)
const MODEL = 'ab'.repeat(32)
const KAVRAM = { kedi: 0, kedinin: 0, hayvan: 0, pati: 0, aşı: 1, aşısı: 1, sağlık: 1, karnesi: 2, karne: 2, belgesi: 2, belge: 2, kombi: 3, ısıtıcı: 3, kalorifer: 3 }

// gom(metinler, { tur }) → vektörler; çağrılar sayılır
function taklitGom () {
  const cagri = { parca: 0, sorgu: 0, metinler: [] }
  const gom = async (metinler, { tur }) => {
    cagri[tur] += metinler.length
    cagri.metinler.push(...metinler)
    return metinler.map((m) => {
      const v = new Float32Array(32)
      const govde = m.replace(/^(query|passage): /, '')
      for (const k of kelimeler(N(govde))) {
        const i = KAVRAM[k] ?? 4 + ([...k].reduce((a, ch) => (a * 31 + ch.codePointAt(0)) >>> 0, 7) % 27)
        v[i] += 1
      }
      v[31] += 0.05
      return v
    })
  }
  return { gom, cagri }
}

function bellek () {
  const m = new Map()
  return { m, oku: (ad) => m.get(ad) || null, yaz: (ad, b) => m.set(ad, b4a.from(b)), sil: (ad) => m.delete(ad) }
}

function kur (kim = A.K.husniye, { gom = taklitGom(), saklama = bellek(), anahtar = b4a.alloc(32, 0x52), modelHash = MODEL, kasaAcik = () => false, L = A.anaDefter(), sinir, kayit = null } = {}) {
  const simdi = A.TS0 + 3_600_000
  const r = kayit ? kayit.r : A.replika(L, kim, { now: () => simdi })
  kayit = kayit || new S.RecordApi({ replika: r })
  const yz = new S.AiApi({ kayit, me: kim, now: () => simdi, kasaAcik, gom: { gom: gom.gom, onEkler: ['query: ', 'passage: '], modelHash, esik: 500 }, gommeSaklama: saklama, gommeAnahtar: anahtar, gommeSiniri: sinir })
  return { L, r, kayit, yz, gom, saklama }
}

test('anlamsal: anahtar kelimenin bulamadığı kayıt kavramla bulunur; carpim dayanak eşiğini taşır; önekler', async (t) => {
  const x = kur()
  const rid = x.kayit.put(TA, null, 'yuva.defter.not', { baslik: 'Kedinin aşı karnesi', metin: 'Mavi çekmecede' })
  x.kayit.put(TA, null, 'yuva.defter.not', { baslik: 'Kombi servisi', metin: 'Yıllık bakım ekimde' })
  x.yz.directory('kur')
  const r = await x.yz.search('hayvan sağlık belgesi')
  t.ok(r.length >= 1)
  t.is(r[0].recordId, rid, 'ilk sonuç kedinin karnesi')
  t.alike(r[0].eslesen, [], 'anahtar kelime eşleşmesi yok: yalnız anlamsal')
  t.ok(r[0].carpim > 0.5 * 127 * 127, 'iç çarpım eşiği aşıyor (dayanaklı)')
  t.ok(x.gom.cagri.metinler.some((m) => m.startsWith('passage: ')) && x.gom.cagri.metinler.some((m) => m.startsWith('query: ')), 'parça ve sorgu önekleri')
  t.is(x.yz.directory('durum').gomulu, 2)
  // Kancasız: yalnız anahtar kelime (bugünkü davranış)
  const L2 = A.anaDefter()
  const r2 = A.replika(L2, A.K.husniye, { now: () => A.TS0 + 3_600_000 })
  const k2 = new S.RecordApi({ replika: r2 })
  k2.put(TA, null, 'yuva.defter.not', { baslik: 'Kedinin aşı karnesi' })
  const yalin = new S.AiApi({ kayit: k2, me: A.K.husniye, now: () => A.TS0 + 3_600_000 })
  yalin.directory('kur')
  t.alike(await yalin.search('hayvan sağlık belgesi'), [])
  t.is((await yalin.search('karnesi')).length, 1)
})

test('karışık sıralama: hem kelimede hem anlamda eşleşen öne çıkar (karşılıklı sıra birleşimi)', async (t) => {
  const x = kur()
  const a = x.kayit.put(TA, null, 'yuva.defter.not', { baslik: 'Kombi', metin: 'kalorifer bakım' })
  x.kayit.put(TA, null, 'yuva.defter.not', { baslik: 'Isıtıcı', metin: 'ısıtıcı garaj' })
  x.kayit.put(TA, null, 'yuva.defter.not', { baslik: 'Market', metin: 'süt ekmek kombi' })
  x.yz.directory('kur')
  const r = await x.yz.search('kombi kalorifer')
  t.is(r[0].recordId, a, 'iki listede de üstte')
  t.ok(r[0].eslesen.length > 0 && r[0].carpim > 0)
})

test('kalıcılık: dizin şifreli dosyada; yeniden açılışta değişmeyen parça yeniden gömülmez; model değişince yeniden kurulur', async (t) => {
  const saklama = bellek()
  const L = A.anaDefter()
  const x = kur(A.K.husniye, { saklama, L })
  x.kayit.put(TA, null, 'yuva.defter.not', { baslik: 'Kedinin aşı karnesi', metin: 'Gizli çekmece notu' })
  x.yz.directory('kur')
  await x.yz.processEmbedding()
  const ad = 'gomme-' + TA
  t.ok(saklama.m.has(ad), 'koleksiyon başına dosya')
  t.absent(b4a.toString(saklama.m.get(ad)).includes('çekmece'), 'dosyada düz metin yok')
  t.is(x.gom.cagri.parca, 1)
  // Yeniden açılış: aynı saklama, yeni AiApi
  const y = kur(A.K.husniye, { saklama, L, kayit: x.kayit })
  y.yz.directory('kur')
  t.is((await y.yz.search('hayvan belgesi'))[0].collectionId, TA)
  t.is(y.gom.cagri.parca, 0, 'parça yeniden gömülmedi')
  t.is(y.gom.cagri.sorgu, 1)
  // Yanlış anahtar ya da bozuk dosya: silinir, yeniden gömülür
  const z = kur(A.K.husniye, { saklama, L, kayit: x.kayit, anahtar: b4a.alloc(32, 9) })
  z.yz.directory('kur')
  await z.yz.processEmbedding()
  t.is(z.gom.cagri.parca, 1, 'açılamayan dosya yeniden kuruldu')
  // Model değişti
  const m = kur(A.K.husniye, { saklama, L, kayit: x.kayit, anahtar: b4a.alloc(32, 9), modelHash: 'cd'.repeat(32) })
  m.yz.directory('kur')
  await m.yz.processEmbedding()
  t.is(m.gom.cagri.parca, 1, 'yeni modelle yeniden gömüldü')
})

test('okuyuculuk bitince gömme dizini ve dosyası olay anında silinir', async (t) => {
  const saklama = bellek()
  const L = A.anaDefter()
  const hr = A.replika(L, A.K.husniye) // dönem anahtarını üreten
  const x = kur(A.K.irem, { saklama, L })
  A.teslim(hr, x.r)
  x.kayit.r.sync()
  x.kayit.put(TA, null, 'yuva.defter.not', { baslik: 'Kombi servisi' })
  x.yz.directory('kur')
  await x.yz.processEmbedding()
  t.is(x.yz.directory('durum').gomulu, 1)
  t.ok(saklama.m.has('gomme-' + TA), 'dosya vardı')
  // İrem (yetişkin) Tüm Aile'nin okuyucusu olmaktan çıkar
  x.L.apply(A.koleksiyon(x.L, [A.K.kerem], { readers: ['rol:ebeveyn', 'rol:cocuk'], writers: ['rol:ebeveyn', 'rol:cocuk'] }))
  x.yz.ledgerAdvanced()
  t.absent(x.yz.directory('durum').koleksiyonlar.includes(TA))
  t.is(x.yz.directory('durum').gomulu, 0)
  t.absent([...saklama.m.keys()].some((k) => k === 'gomme-' + TA), 'dosya silindi')
  t.alike(await x.yz.search('kombi'), [])
})

test('kasa: açıkken bellekte gömülür, dosyaya yazılmaz; kilitlenince dizinden çıkar', async (t) => {
  let acik = true
  const saklama = bellek()
  const x = kur(A.K.husniye, { saklama, kasaAcik: () => acik })
  x.kayit.r.sync()
  // Kasa koleksiyonuna kayıt (kasa kilidi RecordApi'de yok: doğrudan)
  x.kayit.put(KASA, null, 'yuva.defter.not', { baslik: 'Kedinin aşı karnesi kasada' })
  x.yz.directory('kur')
  await x.yz.processEmbedding()
  t.ok(x.yz.directory('durum').koleksiyonlar.includes(KASA))
  t.is((await x.yz.search('hayvan belgesi', { koleksiyonlar: [KASA] }))[0].collectionId, KASA)
  t.absent(saklama.m.has('gomme-' + KASA), 'kasa dizini dosyaya yazılmaz')
  acik = false
  x.yz.ledgerAdvanced()
  t.absent(x.yz.directory('durum').koleksiyonlar.includes(KASA))
  t.alike(await x.yz.search('hayvan belgesi', { koleksiyonlar: [KASA] }), [])
})

test('sınır: gömme dizini en çok N parça; en eski kayıtlar gömmeden çıkar, anahtar kelimede kalır', async (t) => {
  let saat = A.TS0 + 3_600_000
  const L = A.anaDefter()
  const r = A.replika(L, A.K.husniye, { now: () => ++saat })
  const kayit = new S.RecordApi({ replika: r })
  const g = taklitGom()
  const yz = new S.AiApi({ kayit, me: A.K.husniye, now: () => saat, gom: { gom: g.gom, onEkler: ['query: ', 'passage: '], modelHash: MODEL }, gommeSiniri: 3 })
  const ilk = kayit.put(TA, null, 'yuva.defter.not', { baslik: 'Kedinin karnesi eski' })
  for (let i = 0; i < 4; i++) kayit.put(TA, null, 'yuva.defter.not', { baslik: 'Kombi notu ' + i })
  yz.directory('kur')
  await yz.processEmbedding()
  t.is(yz.directory('durum').gomulu, 3)
  t.is(yz.directory('durum').parca, 5)
  t.absent((await yz.search('hayvan')).some((x) => x.recordId === ilk), 'en eski kayıt anlamsalda yok')
  t.ok((await yz.search('karnesi')).some((x) => x.recordId === ilk), 'anahtar kelimede var')
})

test('kriz anlam katmanı aynı gömme kancasını (sorgu önekiyle) kullanır', async (t) => {
  const x = kur()
  t.is((await x.yz.status()).krizAnlam, true)
  await x.yz.isCrisis('bugün hava güzel')
  t.ok(x.gom.cagri.metinler.some((m) => m.startsWith('query: ')))
})
