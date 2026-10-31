// SPDX-License-Identifier: Apache-2.0
// D52 düşmanca inceleme: SDK düzeyi kırmızı testler (AiApi + GommeDizini). Çalıştır: node saldiri-sdk.js
// "KIRMIZI" etiketli testler bugünkü kodda düşmesi beklenen (bulgu) testlerdir; "YESIL" etiketliler temiz bulunanlar.
const W = __dirname + '/../..' // D54: kollar/D-inceleme-18-testler/saldiri-sdk.js'den
const test = require(W + '/node_modules/brittle')
const b4a = require(W + '/node_modules/b4a')
const S = require(W + '/sdk')
const A = require(W + '/core/records/test/helpers/family')
const { metin: { N, kelimeler }, gomme: { metinOzeti } } = require(W + '/core/ai')

const hex = (b) => b4a.toString(b, 'hex')
const TA = hex(A.K_TUM_AILE)
const KASA = hex(A.K_KASA)
const MODEL = 'ab'.repeat(32)
const KAVRAM = { kedi: 0, kedinin: 0, hayvan: 0, pati: 0, aşı: 1, aşısı: 1, sağlık: 1, karnesi: 2, karne: 2, belgesi: 2, belge: 2, kombi: 3, ısıtıcı: 3, kalorifer: 3 }

function taklitGom ({ hata = null, kanca = null } = {}) {
  const cagri = { parca: 0, sorgu: 0, metinler: [] }
  const gom = async (metinler, { tur }) => {
    if (kanca) await kanca(tur, metinler)
    if (hata && hata(tur)) throw new Error('MODEL_LOAD_FAILED')
    cagri[tur] += metinler.length
    cagri.metinler.push(...metinler)
    return metinler.map((m) => {
      const v = new Float32Array(32)
      for (const k of kelimeler(N(m.replace(/^(query|passage): /, '')))) v[KAVRAM[k] ?? 4 + ([...k].reduce((a, ch) => (a * 31 + ch.codePointAt(0)) >>> 0, 7) % 27)] += 1
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

function kur (kim = A.K.husniye, { gom = taklitGom(), saklama = bellek(), anahtar = b4a.alloc(32, 0x52), kasaAcik = () => false, L = A.anaDefter(), sinir, kayit = null, saat = null, kasa = null } = {}) {
  const simdi = () => (saat ? saat() : A.TS0 + 3_600_000)
  const r = kayit ? kayit.r : A.replika(L, kim, { now: simdi })
  kayit = kayit || new S.RecordApi({ replika: r })
  const yz = new S.AiApi({ kayit, me: kim, now: simdi, kasaAcik, gom: { gom: gom.gom, onEkler: ['query: ', 'passage: '], modelHash: MODEL, esik: 500 }, gommeSaklama: saklama, gommeAnahtar: anahtar, gommeSiniri: sinir, kasa })
  return { L, r, kayit, yz, gom, saklama }
}

// --- B1: okuyuculuktan çıkarma, AiApi yokken (yeniden açılış) uygulandıysa gömme dosyası diskte kalır ---------------
test('KIRMIZI B1: okuyuculuk AiApi kapalıyken bittiyse yeniden açılışta gomme-<cid> dosyası silinmiyor (kurucuda bekçi gomme\'den önce)', async (t) => {
  const saklama = bellek()
  const L = A.anaDefter()
  const hr = A.replika(L, A.K.husniye)
  const x = kur(A.K.irem, { saklama, L })
  A.teslim(hr, x.r)
  x.kayit.r.sync()
  x.kayit.put(TA, null, 'yuva.defter.not', { baslik: 'Kombi servisi gizli not' })
  x.yz.directory('kur')
  await x.yz.processEmbedding()
  t.ok(saklama.m.has('gomme-' + TA), 'önkoşul: dosya yazıldı')
  // Uygulama kapalı (AiApi yok) iken İrem Tüm Aile'den çıkarılır; olay deftere işlenir
  x.L.apply(A.koleksiyon(x.L, [A.K.kerem], { readers: ['rol:ebeveyn', 'rol:cocuk'], writers: ['rol:ebeveyn', 'rol:cocuk'] }))
  // Yeniden açılış: aynı saklama, aynı defter, yeni AiApi
  const y = kur(A.K.irem, { saklama, L, kayit: x.kayit })
  y.yz.ledgerAdvanced()
  y.yz.directory('kur')
  await y.yz.search('kombi')
  await y.yz.processEmbedding()
  t.absent(saklama.m.has('gomme-' + TA), 'okuyucu olmayan koleksiyonun gömme dosyası diskte kalmamalı (RFC-0013 §9.5, §20)')
})

// --- B2: normal → kasa duyarlılık değişimi: kasa koleksiyonunun vektörleri platform anahtarlı dosyada kalır ----------
test('KIRMIZI B2: koleksiyon kasaya çevrilince eski gömme dosyası diskte kalıyor; kilitli yeniden açılışta da silinmiyor', async (t) => {
  let acik = true
  const saklama = bellek()
  const L = A.anaDefter()
  const x = kur(A.K.husniye, { saklama, L, kasaAcik: () => acik })
  x.kayit.put(TA, null, 'yuva.defter.not', { baslik: 'Kedinin aşı karnesi', metin: 'tapu çekmecede' })
  x.yz.directory('kur')
  await x.yz.processEmbedding()
  t.ok(saklama.m.has('gomme-' + TA), 'önkoşul: normal koleksiyon dosyası')
  // Sahipler Tüm Aile'yi kasa yapar (tür değişmez, duyarlılık değişebilir)
  let uygulandi = true
  try { x.L.apply(A.koleksiyon(x.L, [A.K.kerem, A.K.husniye], { sensitivity: 'kasa', readers: ['rol:ebeveyn'], writers: ['rol:ebeveyn'], taskAccess: false })) } catch (e) { uygulandi = e.message }
  t.is(uygulandi, true, 'önkoşul: duyarlılık değişimi deftere işlendi')
  t.is(x.L.collections.get(TA).sensitivity, 'kasa')
  x.yz.ledgerAdvanced()
  await x.yz.search('hayvan belgesi')
  await x.yz.processEmbedding()
  t.absent(saklama.m.has('gomme-' + TA), 'kasa koleksiyonunun gömmesi diske yazılmamalı / kalmamalı (D52 "kasa yalnız bellekte")')
  // Uygulama kasa açıkken öldü; kilitli yeniden açılış
  acik = false
  const y = kur(A.K.husniye, { saklama, L, kayit: x.kayit, kasaAcik: () => false })
  y.yz.ledgerAdvanced()
  y.yz.directory('kur')
  await y.yz.processEmbedding()
  t.absent(saklama.m.has('gomme-' + TA), 'kasa kilitliyken bu koleksiyonun vektörleri platform anahtarıyla açılabilir dosyada durmamalı')
})

// --- B3: LOCK anında bellekten silme yok; AiApi'nin bir sonraki çağrısına kadar kasa metni ve vektörü bellekte ---------
test('KIRMIZI B3: kasa kilitlenince kasa parçaları (metin + int8 vektör) bir sonraki AiApi çağrısına kadar bellekte', async (t) => {
  // D54 uyarlaması (karar B3: AiApi VaultApi'nin kilit olayına abone olur): kilit olayı yayan kasa
  let acik = true
  const kasa = new S.Emitter()
  const x = kur(A.K.husniye, { kasaAcik: () => acik, kasa })
  x.kayit.put(KASA, null, 'yuva.defter.not', { baslik: 'Kasa şifresi 4711 kedinin karnesi' })
  x.yz.directory('kur')
  await x.yz.processEmbedding()
  acik = false // 19 LOCK / VaultApi.lock()
  kasa.emit('vault', { type: 'kilitlendi' })
  const kalan = [...x.yz.gomme.parcalar.values()].filter((p) => p.cid === KASA)
  t.is(kalan.length, 0, 'kilitten sonra kasa parçası bellekte olmamalı (RFC-0013 §9.5, RFC-0027 §5 b)')
  t.absent([...x.yz._parcaMetni.values()].some((m) => m.includes('4711')), 'kasa metni bellekte olmamalı')
})

test('KIRMIZI B3b: arama sürerken kasa kilitlenirse (gömme beklenirken) kilitten sonra kasa sonucu dönüyor', async (t) => {
  let acik = true
  const g = taklitGom({ kanca: async (tur) => { if (tur === 'sorgu') acik = false } })
  const x = kur(A.K.husniye, { kasaAcik: () => acik, gom: g })
  x.kayit.put(KASA, null, 'yuva.defter.not', { baslik: 'Kedinin aşı karnesi kasada' })
  x.yz.directory('kur')
  await x.yz.processEmbedding()
  const r = await x.yz.search('hayvan belgesi')
  t.is(acik, false, 'önkoşul: sorgu gömülürken kilitlendi')
  t.absent(r.some((y) => y.collectionId === KASA), 'kilitlendikten sonra dönen sonuçta kasa parçası olmamalı')
})

// --- B4: gömme kancası hata verirse anahtar kelime araması da düşüyor (RFC-0013 §9.4 "Arama her zaman çalışır") ------
test('KIRMIZI B4: gömme kancası hata verince ara() tümden reddediliyor; anahtar kelime sonucu da kayboluyor', async (t) => {
  const g = taklitGom({ hata: (tur) => tur === 'parca' })
  const x = kur(A.K.husniye, { gom: g })
  x.kayit.put(TA, null, 'yuva.defter.not', { baslik: 'Kombi servisi' })
  x.yz.directory('kur')
  let sonuc = null
  try { sonuc = await x.yz.search('kombi') } catch (e) { sonuc = e.message }
  t.ok(Array.isArray(sonuc) && sonuc.length === 1, 'anahtar kelime sonucu dönmeli; dönen: ' + JSON.stringify(sonuc))
})

// --- B5: sınır: dışarıda kalan parçalar her açılışta yeniden gömülür; yer açılınca geri gelmez; kasa normali iter -----
test('KIRMIZI B5a: sınırı aşan parçalar her yeniden açılışta tekrar gömülüp atılıyor', async (t) => {
  let saat = A.TS0 + 3_600_000
  const saklama = bellek()
  const L = A.anaDefter()
  const x = kur(A.K.husniye, { saklama, L, sinir: 3, saat: () => ++saat })
  for (let i = 0; i < 5; i++) x.kayit.put(TA, null, 'yuva.defter.not', { baslik: 'Kombi notu ' + i })
  x.yz.directory('kur')
  await x.yz.processEmbedding()
  t.is(x.gom.cagri.parca, 3, 'D54 uyarlaması (karar B5a: sınır gömmeden önce): yalnız en yeni 3 parça gömülür')
  const y = kur(A.K.husniye, { saklama, L, kayit: x.kayit, sinir: 3, saat: () => saat })
  y.yz.directory('kur')
  await y.yz.processEmbedding()
  t.is(y.yz.directory('durum').gomulu, 3)
  t.is(y.gom.cagri.parca, 0, 'yeniden açılışta hiçbir parça yeniden gömülmemeli (100 000 sınırında her açılışta binlerce gömme)')
})

test('KIRMIZI B5b: yer açılınca (yeni kayıtlar silinince) sınır dışı eski parça anlamsal dizine geri dönmüyor', async (t) => {
  let saat = A.TS0 + 3_600_000
  const x = kur(A.K.husniye, { sinir: 2, saat: () => ++saat })
  const eski = x.kayit.put(TA, null, 'yuva.defter.not', { baslik: 'Kedinin karnesi eski' })
  const y1 = x.kayit.put(TA, null, 'yuva.defter.not', { baslik: 'Kombi bir' })
  const y2 = x.kayit.put(TA, null, 'yuva.defter.not', { baslik: 'Kombi iki' })
  x.yz.directory('kur')
  await x.yz.processEmbedding()
  t.is(x.yz.directory('durum').gomulu, 2)
  x.kayit.del(TA, y1)
  x.kayit.del(TA, y2)
  x.yz.ledgerAdvanced()
  await x.yz.processEmbedding()
  t.ok((await x.yz.search('hayvan')).some((r) => r.recordId === eski), 'sınırın altına inilince eski kayıt anlamsal aramada bulunmalı (gomulu=' + x.yz.directory('durum').gomulu + ')')
})

test('KIRMIZI B5c: kasa açıkken bellek içi kasa parçaları normal parçaları sınırdan iter; kilitten sonra geri gelmezler ve dosyadan da silinmişlerdir', async (t) => {
  let saat = A.TS0 + 3_600_000
  let acik = false
  const saklama = bellek()
  const x = kur(A.K.husniye, { saklama, sinir: 2, saat: () => ++saat, kasaAcik: () => acik })
  x.kayit.put(TA, null, 'yuva.defter.not', { baslik: 'Kedinin karnesi' })
  x.kayit.put(TA, null, 'yuva.defter.not', { baslik: 'Kombi servisi' })
  x.yz.directory('kur')
  await x.yz.processEmbedding()
  t.is(x.yz.directory('durum').gomulu, 2)
  acik = true
  x.kayit.put(KASA, null, 'yuva.defter.not', { baslik: 'Kasa bir' })
  x.kayit.put(KASA, null, 'yuva.defter.not', { baslik: 'Kasa iki' })
  x.yz.directory('kur')
  await x.yz.processEmbedding()
  acik = false
  x.yz.ledgerAdvanced()
  await x.yz.processEmbedding()
  t.is(x.yz.directory('durum').gomulu, 2, 'kasa kilitlenince Tüm Aile parçaları anlamsal dizinde olmalı')
  t.ok(saklama.m.has('gomme-' + TA), 'Tüm Aile dosyası kasa yüzünden boşaltılmamalı')
})

// --- B6: gommeAnahtar verilmeyip şifrelemeyen saklama verilirse dosya düz: rid + parça özeti (tuzsuz) + vektör -------
test('KIRMIZI B6 (API): gommeAnahtar yok + şifrelemeyen saklama → dosyada düz rid ve tuzsuz metin özeti (sözlük saldırısı)', async (t) => {
  const saklama = bellek()
  const x = kur(A.K.husniye, { saklama, anahtar: null })
  const rid = x.kayit.put(TA, null, 'yuva.defter.not', { pin: '4711' })
  x.yz.directory('kur')
  await x.yz.processEmbedding()
  const ham = saklama.m.get('gomme-' + TA)
  // Saldırgan dosyadan: tahmin edilen metnin özetini arar
  let bulunan = null
  for (let i = 0; i < 10000; i++) {
    const aday = String(i).padStart(4, '0')
    if (b4a.indexOf(ham, metinOzeti('passage: ' + N('pin: ' + aday))) >= 0) { bulunan = aday; break }
  }
  t.is(bulunan, null, 'PIN dosyadan sözlükle geri çıkarılamamalı (bulunan: ' + bulunan + ', rid düz: ' + (b4a.indexOf(ham, b4a.from(rid + '#0')) >= 0) + ')')
})

// --- YEŞİL: yetki süzgeci sıralamadan önce; kriz cümlesi dizine/diske girmiyor; geri alınmış dosya silinmiş kaydı döndürmüyor
test('YESIL Y1: koleksiyon süzgeci sıralama ve ilk-50 kesiminden önce uygulanıyor', async (t) => {
  const x = kur(A.K.husniye, { kasaAcik: () => true })
  for (let i = 0; i < 60; i++) x.kayit.put(KASA, null, 'yuva.defter.not', { baslik: 'Kedinin aşı karnesi ' + i })
  const ta = x.kayit.put(TA, null, 'yuva.defter.not', { baslik: 'pati' })
  x.yz.directory('kur')
  const r = await x.yz.search('hayvan sağlık belgesi', { koleksiyonlar: [TA] })
  t.ok(r.length === 1 && r[0].recordId === ta && r.every((y) => y.collectionId === TA))
  // okunmayan koleksiyonu istemek
  const irem = kur(A.K.irem, { L: x.L })
  irem.yz.directory('kur')
  t.alike(await irem.yz.search('hayvan', { koleksiyonlar: [KASA] }), [])
})

test('YESIL Y2: kriz anlam katmanı cümleyi gömme dizinine, dosyaya ya da parçalara yazmıyor', async (t) => {
  const saklama = bellek()
  const x = kur(A.K.husniye, { saklama })
  x.kayit.put(TA, null, 'yuva.defter.not', { baslik: 'Kombi' })
  x.yz.directory('kur')
  await x.yz.processEmbedding()
  const once = new Map([...saklama.m].map(([k, v]) => [k, b4a.toString(v, 'hex')]))
  const n = x.yz.gomme.parcalar.size
  await x.yz.isCrisis('ipi hazırladım artık kimse beni görmeyecek')
  await x.yz.processEmbedding()
  t.is(x.yz.gomme.parcalar.size, n)
  t.alike(new Map([...saklama.m].map(([k, v]) => [k, b4a.toString(v, 'hex')])), once, 'saklama değişmedi')
  t.absent(x.gom.cagri.metinler.some((m) => m.startsWith('passage:') && m.includes('ipi')), 'parça olarak gömülmedi')
})

test('YESIL Y3: geri alınmış (eski) gömme dosyası silinmiş kaydı aramaya döndürmüyor; silinen dosya yeniden kuruluyor', async (t) => {
  const saklama = bellek()
  const L = A.anaDefter()
  const x = kur(A.K.husniye, { saklama, L })
  const gizli = x.kayit.put(TA, null, 'yuva.defter.not', { baslik: 'Kedinin aşı karnesi silinecek' })
  x.kayit.put(TA, null, 'yuva.defter.not', { baslik: 'Kombi' })
  x.yz.directory('kur')
  await x.yz.processEmbedding()
  const eski = saklama.m.get('gomme-' + TA)
  x.kayit.del(TA, gizli)
  x.yz.ledgerAdvanced()
  await x.yz.processEmbedding()
  saklama.m.set('gomme-' + TA, eski) // geri alma
  const y = kur(A.K.husniye, { saklama, L, kayit: x.kayit })
  y.yz.directory('kur')
  t.absent((await y.yz.search('hayvan belgesi')).some((r) => r.recordId === gizli))
  saklama.m.delete('gomme-' + TA) // silme
  const z = kur(A.K.husniye, { saklama, L, kayit: x.kayit })
  z.yz.directory('kur')
  t.ok((await z.yz.search('kombi')).length >= 1)
})

// --- B7: model silinince / dizin('sil') ile yüklenmemiş koleksiyonların gömme dosyaları kalıyor ------------------------
test('KIRMIZI B7: gömme modeli silinip AiApi kancasız açılınca dizin(sil) gömme dosyalarını silmiyor (RFC-0013 §9.5 son satır)', async (t) => {
  const saklama = bellek()
  const L = A.anaDefter()
  const x = kur(A.K.husniye, { saklama, L })
  x.kayit.put(TA, null, 'yuva.defter.not', { baslik: 'Kombi servisi' })
  x.yz.directory('kur')
  await x.yz.processEmbedding()
  t.ok(saklama.m.has('gomme-' + TA), 'önkoşul')
  // Kullanıcı Ayarlar'dan gömme modelini sildi: uygulama AiApi'yi kancasız kurar (saklama yine verilir)
  const y = new S.AiApi({ kayit: x.kayit, me: A.K.husniye, now: () => A.TS0 + 3_600_000, gommeSaklama: saklama })
  y.directory('kur')
  y.directory('sil')
  t.absent(saklama.m.has('gomme-' + TA), 'model yokken eski vektör dosyaları silinmeli')
})
