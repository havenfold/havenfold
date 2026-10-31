// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D64: embedding.js'in kalan dalları — kurucunun bekçileri, anahtar kancasının bozuk dönüşleri, saklamanın fırlatması,
// dosyanın her ret yolu (dönem, kısa şifreli metin, sürüm, model, boyut, vektör uzunluğu), sınırın sıralaması, gömme
// kancasının bozuk dönüşleri ve aramanın eşitlik sıralaması
const test = require('brittle')
const b4a = require('b4a')
const c = require('compact-encoding')
const sodium = require('sodium-native')
const { kdf: { derive, hash } } = require('@havenfold/core')
const { gomme: { GommeDizini, dosyaAdi } } = require('..')

const MODEL = 'ab'.repeat(32)
const CID = '11'.repeat(16)
const CID2 = '22'.repeat(16)
const RID = 'aa'.repeat(16)
const DONEM = { key: b4a.alloc(32, 0x07), kimlik: 'donem-1' }
const PLATFORM = b4a.alloc(32, 0x52)

const hataOf = (f) => { try { f(); return null } catch (err) { return err.message } }
const hataOfA = async (p) => { try { await p; return null } catch (err) { return err.message } }

function bellek () {
  const m = new Map()
  return { m, oku: (ad) => m.get(ad) || null, yaz: (ad, b) => m.set(ad, b4a.from(b)), sil: (ad) => m.delete(ad), liste: () => [...m.keys()] }
}

// Boyutlu, metne bağlı belirlenimci gömme: her metin kendi baytlarından vektör
function gomBoyut (boyut = 8) {
  const cagri = []
  const gom = async (metinler, { tur }) => {
    cagri.push([tur, metinler.length])
    return metinler.map((m) => {
      const v = new Float32Array(boyut)
      for (let i = 0; i < m.length; i++) v[i % boyut] += m.charCodeAt(i) % 13 + 1
      return v
    })
  }
  gom.cagri = cagri
  return gom
}

const dizin = (o = {}) => new GommeDizini({ gom: gomBoyut(), modelHash: MODEL, saklama: bellek(), anahtarOf: () => DONEM, anahtar: PLATFORM, ...o })

// Dosyayı embedding.js'in biçimiyle elle kurar (ret yollarını sınamak için): kimlik ‖ nonce ‖ AEAD(içerik)
const parcaEnc = {
  preencode (s, m) { c.string.preencode(s, m.id); c.string.preencode(s, m.rid); c.uint.preencode(s, m.hlc); c.fixed(16).preencode(s, m.ozet); c.buffer.preencode(s, m.vec) },
  encode (s, m) { c.string.encode(s, m.id); c.string.encode(s, m.rid); c.uint.encode(s, m.hlc); c.fixed(16).encode(s, m.ozet); c.buffer.encode(s, m.vec) },
  decode () {}
}
const icerikEnc = {
  preencode (s, m) { c.uint.preencode(s, m.v); c.fixed32.preencode(s, m.modelHash); c.uint.preencode(s, m.boyut); c.array(parcaEnc).preencode(s, m.parcalar) },
  encode (s, m) { c.uint.encode(s, m.v); c.fixed32.encode(s, m.modelHash); c.uint.encode(s, m.boyut); c.array(parcaEnc).encode(s, m.parcalar) },
  decode () {}
}
const dosyaEnc = {
  preencode (s, m) { c.string.preencode(s, m.kimlik); c.fixed(24).preencode(s, m.nonce); c.buffer.preencode(s, m.ct) },
  encode (s, m) { c.string.encode(s, m.kimlik); c.fixed(24).encode(s, m.nonce); c.buffer.encode(s, m.ct) },
  decode () {}
}
function dosyaKur ({ cid = CID, v = 2, modelHash = MODEL, boyut = 8, parcalar, ct = null, kimlik = DONEM.kimlik }) {
  const k = derive(DONEM.key, 'hf/yz/dizin', PLATFORM)
  const nonce = b4a.alloc(24, 3)
  if (!ct) {
    const pt = c.encode(icerikEnc, { v, modelHash: b4a.from(modelHash, 'hex'), boyut, parcalar })
    const ad = hash('hf/yz/dizin-ad/', b4a.from(cid, 'hex'), b4a.from(MODEL, 'hex'), b4a.from(kimlik))
    ct = b4a.alloc(pt.byteLength + 16)
    sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(ct, pt, ad, null, nonce, k)
  }
  return c.encode(dosyaEnc, { kimlik, nonce, ct })
}
const parca = (id, boyut = 8, hlc = 1) => ({ id, rid: RID, hlc, ozet: b4a.alloc(16, 1), vec: b4a.alloc(boyut, 5) })

test('d64 gomme: kurucu — gömme kancası, önekler ve model özeti denetlenir; model özeti bayt da olabilir', (t) => {
  t.is(hataOf(() => new GommeDizini({ modelHash: MODEL })), 'NO_EMBEDDING')
  t.is(hataOf(() => new GommeDizini({ gom: gomBoyut(), modelHash: MODEL, onEkler: 'query: ' })), 'INVALID_PREFIX')
  t.is(hataOf(() => new GommeDizini({ gom: gomBoyut(), modelHash: MODEL, onEkler: ['a'] })), 'INVALID_PREFIX')
  t.is(hataOf(() => new GommeDizini({ gom: gomBoyut(), modelHash: MODEL, onEkler: ['a', 1] })), 'INVALID_PREFIX')
  t.is(hataOf(() => new GommeDizini({ gom: gomBoyut(), modelHash: 'ab' })), 'INVALID_MODEL')
  t.is(hataOf(() => new GommeDizini({ gom: gomBoyut(), modelHash: 5 })), 'INVALID_MODEL')
  const d = new GommeDizini({ gom: gomBoyut(), modelHash: b4a.alloc(32, 0xab) })
  t.ok(b4a.equals(d.modelHash, b4a.from(MODEL, 'hex')))
  t.is(d.anahtarOf('x'), null, 'anahtarOf verilmezse anahtar yok')
})

test('d64 gomme: saklamasız dizin bellekte çalışır; koleksiyon ve kayıt kimliği bayt olarak verilebilir', async (t) => {
  const d = new GommeDizini({ gom: gomBoyut(), modelHash: MODEL, anahtarOf: () => DONEM })
  d.ekle({ id: 'p1', collectionId: b4a.from(CID, 'hex'), recordId: b4a.from(RID, 'hex'), metin: 'kombi servisi' })
  t.is(await d.isle(), 1)
  t.is(d.parcalar.get('p1').cid, CID)
  t.is(d.parcalar.get('p1').rid, RID)
  t.alike(d.supur(), [], 'saklama yoksa süpürülecek dosya yok')
  d.koleksiyonSil(CID) // saklama yokken dosya silme sessiz
  t.is(d.boyutu, 0)
})

test('d64 gomme: anahtar kancası fırlatırsa ya da bozuk dönerse parça yalnız bellekte; dosya yazılmaz', async (t) => {
  for (const anahtarOf of [
    () => { throw new Error('VAULT_LOCKED') },
    () => ({ key: 'gizli', kimlik: 'd' }),
    () => ({ key: DONEM.key, kimlik: 5 })
  ]) {
    const s = bellek()
    const d = dizin({ saklama: s, anahtarOf })
    d.ekle({ id: 'p1', collectionId: CID, recordId: RID, metin: 'tapu çekmecede' })
    t.is(await d.isle(), 1)
    t.is(d.parcalar.get('p1').kalici, false)
    t.is(s.m.size, 0)
  }
})

test('d64 gomme: saklamanın sil ve yaz kancaları fırlatsa da dizin çalışır', async (t) => {
  const s = bellek()
  s.yaz = () => { throw new Error('DISK_DOLU') }
  s.sil = () => { throw new Error('DISK_YOK') }
  const d = dizin({ saklama: s })
  d.ekle({ id: 'p1', collectionId: CID, recordId: RID, metin: 'kombi' })
  t.is(await d.isle(), 1)
  t.is(s.m.size, 0, 'yazılamadı, hata dışarı çıkmadı')
  d.koleksiyonSil(CID)
  t.is(d.parcalar.size, 0)
})

test('d64 gomme: anahtar yokken dosyaya dokunulmaz; anahtar gelince açılır', async (t) => {
  const s = bellek()
  const a = dizin({ saklama: s })
  a.ekle({ id: 'p1', collectionId: CID, recordId: RID, metin: 'kedinin aşı karnesi' })
  await a.isle()
  const dosya = s.m.get(dosyaAdi(CID))
  t.ok(dosya)
  let anahtar = null
  const b = dizin({ saklama: s, anahtarOf: () => anahtar })
  b.yukle(CID)
  t.is(b.parcalar.size, 0)
  t.ok(b4a.equals(s.m.get(dosyaAdi(CID)), dosya), 'kasa kilitliyken dosya silinmez')
  anahtar = DONEM
  const c2 = dizin({ saklama: s, anahtarOf: () => anahtar })
  c2.yukle(b4a.from(CID, 'hex'))
  t.is(c2.parcalar.get('p1').yuklendi, true)
  c2.yukle(CID)
  t.is(c2.parcalar.size, 1, 'ikinci yükleme etkisiz')
})

test('d64 gomme: açılamayan dosya silinir — dönem, kısa şifreli metin, sürüm, model, boyut ve vektör uzunluğu', async (t) => {
  const durumlar = [
    ['dönem değişti', dosyaKur({ kimlik: 'donem-0', parcalar: [parca('p1')] })],
    ['şifreli metin etiketten kısa', dosyaKur({ ct: b4a.alloc(10) })],
    ['sürüm', dosyaKur({ v: 1, parcalar: [parca('p1')] })],
    ['model', dosyaKur({ modelHash: 'cd'.repeat(32), parcalar: [parca('p1')] })],
    ['vektör uzunluğu', dosyaKur({ parcalar: [parca('p1', 8), parca('p2', 7)] })]
  ]
  for (const [ad, b] of durumlar) {
    const s = bellek()
    s.m.set(dosyaAdi(CID), b)
    const d = dizin({ saklama: s }) // şimdiki dönem donem-1
    d.yukle(CID)
    t.is(d.parcalar.size, 0, ad)
    t.absent(s.m.has(dosyaAdi(CID)), ad + ': dosya silindi')
  }
  // Doğru kurulmuş dosya açılır (elle kurulumun kendisi doğru): sınır dışı parça da gelir
  const s = bellek()
  s.m.set(dosyaAdi(CID), dosyaKur({ parcalar: [parca('p1'), { ...parca('p2'), vec: b4a.alloc(0) }] }))
  const d = dizin({ saklama: s })
  d.yukle(CID)
  t.is(d.boyut, 8)
  t.is(d.parcalar.get('p1').vec.length, 8)
  t.is(d.parcalar.get('p2').disarida, true)
})

test('d64 gomme: başka boyutlu ikinci dosya silinir; yalnız sınır dışı parçalı dosya boyutu belirlemez; aynı kimlik yeniden alınmaz', async (t) => {
  const s = bellek()
  s.m.set(dosyaAdi(CID), dosyaKur({ parcalar: [parca('p1', 8)] }))
  s.m.set(dosyaAdi(CID2), dosyaKur({ cid: CID2, boyut: 16, parcalar: [parca('q1', 16)] }))
  const d = dizin({ saklama: s })
  d.yukle(CID)
  d.yukle(CID2)
  t.is(d.boyut, 8)
  t.absent(d.parcalar.has('q1'))
  t.absent(s.m.has(dosyaAdi(CID2)), 'boyutu uyuşmayan dosya silindi')
  t.ok(s.m.has(dosyaAdi(CID)))

  const s2 = bellek()
  s2.m.set(dosyaAdi(CID), dosyaKur({ boyut: 0, parcalar: [{ ...parca('p1'), vec: b4a.alloc(0) }] }))
  s2.m.set(dosyaAdi(CID2), dosyaKur({ cid: CID2, parcalar: [parca('p1'), parca('q2')] }))
  const e = dizin({ saklama: s2 })
  e.yukle(CID)
  t.is(e.boyut, null, 'yalnız sınır dışı parça: boyut yok')
  e.yukle(CID2)
  t.is(e.boyut, 8)
  t.is(e.parcalar.get('p1').cid, CID, 'bellekteki parça korunur, dosyadaki aynı kimlik atlanır')
  t.is(e.parcalar.get('q2').cid, CID2)
})

test('d64 gomme: parça kalmayınca ya da anahtar gidince isle dosyayı siler', async (t) => {
  const s = bellek()
  let anahtar = DONEM
  const d = dizin({ saklama: s, anahtarOf: () => anahtar })
  d.ekle({ id: 'p1', collectionId: CID, recordId: RID, metin: 'kombi' })
  d.ekle({ id: 'p2', collectionId: CID2, recordId: RID, metin: 'kalorifer' })
  await d.isle()
  t.ok(s.m.has(dosyaAdi(CID)) && s.m.has(dosyaAdi(CID2)))
  d.kayitSil(CID, RID)
  await d.isle()
  t.absent(s.m.has(dosyaAdi(CID)), 'parçası kalmayan koleksiyonun dosyası silindi')
  anahtar = null
  d.kirli.add(CID2)
  await d.isle()
  t.absent(s.m.has(dosyaAdi(CID2)), 'anahtar yokken yazılmaz, eski dosya silinir')
})

test('d64 gomme: sınır — eşit hlc kimlikle sıralanır; gömülmemiş parça dışarıda kalır; hiç gömülmemişse dosya boyutu 0', async (t) => {
  const s = bellek()
  const gom = gomBoyut()
  const d = dizin({ saklama: s, sinir: 2, gom })
  for (const id of ['c', 'a', 'b', 'd']) d.ekle({ id, collectionId: CID, recordId: RID, hlc: 5, metin: 'metin ' + id })
  t.is(await d.isle(), 2)
  t.ok(d.parcalar.get('a').vec && d.parcalar.get('b').vec, 'eşit hlc: küçük kimlikler içeride')
  t.ok(d.parcalar.get('c').disarida && d.parcalar.get('d').disarida)
  t.is(d.parcalar.get('c').vec, null)

  // Sınır 0: hiçbir parça gömülmez, dosya yalnız kimlik ve özetle (boyut 0) yazılır, yeniden açılır
  const s2 = bellek()
  const e = dizin({ saklama: s2, sinir: 0 })
  e.ekle({ id: 'x', collectionId: CID, recordId: RID, metin: 'x' })
  t.is(await e.isle(), 0)
  const f = dizin({ saklama: s2, sinir: 0 })
  f.yukle(CID)
  t.is(f.parcalar.get('x').disarida, true)
  t.is(f.boyut, null)
})

test('d64 gomme: gömme kancası dizi dönmezse ya da sayı tutmazsa INVALID_EMBEDDING; boyut değişirse SIZE_MISMATCH', async (t) => {
  const d1 = dizin({ gom: async () => null })
  d1.ekle({ id: 'p1', collectionId: CID, recordId: RID, metin: 'a' })
  t.is(await hataOfA(d1.isle()), 'INVALID_EMBEDDING')
  const d2 = dizin({ gom: async () => [] })
  d2.ekle({ id: 'p1', collectionId: CID, recordId: RID, metin: 'a' })
  t.is(await hataOfA(d2.isle()), 'INVALID_EMBEDDING')
  let boyut = 8
  const d3 = dizin({ gom: async (m) => m.map(() => new Float32Array(boyut).fill(1)) })
  d3.ekle({ id: 'p1', collectionId: CID, recordId: RID, metin: 'a' })
  await d3.isle()
  boyut = 4
  d3.ekle({ id: 'p2', collectionId: CID, recordId: RID, metin: 'b' })
  t.is(await hataOfA(d3.isle()), 'SIZE_MISMATCH')
  t.is(await hataOfA(d3.ara('a')), 'SIZE_MISMATCH', 'sorgu vektörünün boyutu da denetlenir')
})

test('d64 gomme: gömme beklenirken silinen parça yazılmaz, sayılmaz', async (t) => {
  let d = null
  const gom = async (metinler) => {
    d.kayitSil(CID, RID)
    return metinler.map(() => new Float32Array(8).fill(1))
  }
  const s = bellek()
  d = dizin({ saklama: s, gom })
  d.ekle({ id: 'p1', collectionId: CID, recordId: RID, metin: 'a' })
  t.is(await d.isle(), 0)
  t.is(d.parcalar.size, 0)
  t.absent(s.m.has(dosyaAdi(CID)))
})

test('d64 gomme: eşit çarpımda sonuçlar koleksiyon+kayıt, sonra parça kimliğiyle sıralanır', async (t) => {
  const d = dizin({ gom: async (m) => m.map(() => new Float32Array(8).fill(1)) })
  const R1 = '01'.repeat(16)
  const R2 = '02'.repeat(16)
  d.ekle({ id: 'z', collectionId: CID, recordId: R2, metin: 'a' })
  d.ekle({ id: 'y', collectionId: CID, recordId: R1, metin: 'b' })
  d.ekle({ id: 'x', collectionId: CID, recordId: R1, metin: 'c' })
  d.ekle({ id: 'w', collectionId: CID2, recordId: R1, metin: 'd' })
  d.ekle({ id: 'v', collectionId: CID, recordId: R2, metin: 'e' })
  await d.isle()
  const r = await d.ara('sorgu')
  t.alike(r.map((x) => x.id), ['x', 'y', 'v', 'z', 'w'])
  t.ok(r.every((x) => x.carpim === r[0].carpim), 'hepsi eşit çarpım')
  t.alike((await d.ara('sorgu', { koleksiyonlar: [CID2] })).map((x) => x.id), ['w'])
  t.alike(await d.ara('   '), [], 'boş sorgu')
})

test('d64 gomme: aynı metinle yeniden eklenen parça yeniden gömülmez; kalıcı olmayan (kasa) parça dosyaya girmez', async (t) => {
  const s = bellek()
  const gom = gomBoyut()
  const d = dizin({ saklama: s, gom })
  d.ekle({ id: 'p1', collectionId: CID, recordId: RID, hlc: 1, metin: 'kombi' })
  await d.isle()
  t.is(d.boyutu, 1)
  d.ekle({ id: 'p1', collectionId: CID, recordId: RID, hlc: 2, metin: 'kombi' })
  t.is(await d.isle(), 0, 'özet aynı: vektör korunur')
  t.is(d.parcalar.get('p1').hlc, 2)
  t.is(gom.cagri.length, 1)
  d.ekle({ id: 'k1', collectionId: CID2, recordId: RID, metin: 'kasa notu', kalici: false })
  t.is(await d.isle(), 1)
  t.is(d.parcalar.get('k1').kalici, false)
  t.absent(s.m.has(dosyaAdi(CID2)), 'kasa parçası yalnız bellekte')
  t.is(d.boyutu, 2)
})

test('d64 gomme: sınır — gömülmüş eski parça dışarı çıkar (vektörü sıfırlanır), yer açılınca geri alınır', async (t) => {
  const s = bellek()
  const d = dizin({ saklama: s, sinir: 1 })
  d.ekle({ id: 'eski', collectionId: CID, recordId: RID, hlc: 1, metin: 'eski not' })
  await d.isle()
  const v = d.parcalar.get('eski').vec
  d.ekle({ id: 'yeni', collectionId: CID, recordId: RID, hlc: 9, metin: 'yeni not' })
  t.is(await d.isle(), 1)
  t.is(d.parcalar.get('eski').disarida, true)
  t.ok(v.every((x) => x === 0), 'dışarı çıkan vektör sıfırlandı')
  d.ekle({ id: 'eski', collectionId: CID, recordId: RID, hlc: 1, metin: 'eski not' })
  t.is(await d.isle(), 0, 'aynı metinle gelen dışarıdaki parça dışarıda kalır, gömülmez')
  t.is(d.parcalar.get('eski').disarida, true)
  d.ayikla(CID, new Set(['eski']))
  t.is(await d.isle(), 1, 'yer açıldı: eski yeniden gömüldü')
  t.is(d.parcalar.get('eski').disarida, false)
  t.ok(d.parcalar.get('eski').vec)
})

test('d64 gomme: liste() vermeyen saklamada süpürme yapılmaz; liste fırlatırsa boş', (t) => {
  const s = bellek()
  delete s.liste
  s.m.set(dosyaAdi(CID), b4a.alloc(1))
  t.alike(dizin({ saklama: s }).supur(), [])
  t.ok(s.m.has(dosyaAdi(CID)))
  const s2 = bellek()
  s2.liste = () => { throw new Error('PERMISSION_ERROR') }
  t.alike(dizin({ saklama: s2 }).supur(), [])
})

test('d64 gomme: eşit çarpım ve aynı kayıtta parça kimliği her iki yönde karşılaştırılır', async (t) => {
  const d = dizin({ gom: async (m) => m.map(() => new Float32Array(8).fill(1)) })
  const ids = ['k', 'c', 'q', 'a', 'z', 'm', 'b', 'y']
  for (const id of ids) d.ekle({ id, collectionId: CID, recordId: RID, metin: id })
  await d.isle()
  t.alike((await d.ara('s')).map((x) => x.id), [...ids].sort())
  t.alike((await d.ara('s', { limit: 3 })).map((x) => x.id), ['a', 'b', 'c'])
})

test('d64 gomme: süpürme tutulacakların dışındaki gömme dosyalarını siler, başka dosyalara dokunmaz', (t) => {
  const s = bellek()
  for (const ad of [dosyaAdi(CID), dosyaAdi(CID2), 'durum', 'gomme-kisa']) s.m.set(ad, b4a.alloc(1))
  t.alike(dizin({ saklama: s }).supur(new Set([CID])), [CID2])
  t.alike([...s.m.keys()].sort(), [dosyaAdi(CID), 'durum', 'gomme-kisa'].sort())
})
