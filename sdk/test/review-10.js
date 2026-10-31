// SPDX-License-Identifier: Apache-2.0
// İnceleme 10 (D11) bulguları: her düzeltmenin kırmızı testi (kollar/D-inceleme-10.md, RFC-0023 §1 104, §2)
const test = require('brittle')
const b4a = require('b4a')
const S = require('..')
const yzc = require('@havenfold/ai')
const A = require('../../core/records/test/helpers/family')

const hex = (b) => b4a.toString(b, 'hex')
const hataOf = async (fn) => { try { await fn(); return null } catch (err) { return err.message } }
const TA = hex(A.K_TUM_AILE)
const BAKICI = hex(A.K_BAKICI)
const KASA = hex(A.K_KASA)
const SEMA = { id: 'yuva.defter.garanti', v: 1, hedef: 'yuva.defter.garanti', alanlar: [{ ad: 'urun', tur: 'metin', zorunlu: true, dayanak: 'alinti' }, { ad: 'bitis', tur: 'tarih', zorunlu: true, dayanak: 'alinti' }] }
const TR = () => yzc.yetenek.yetenekKur({ isletim: { id: 'apple-fm', surum: '26.1', tr: true }, bildirim: { platform: [{ id: 'apple-fm', surum: '26.1', tr: true, baglamToken: 4096 }] } })

function kur (kim = A.K.husniye, ek = {}) {
  const L = A.anaDefter()
  const simdi = A.TS0 + 3_600_000
  const r = A.replika(L, kim, { now: () => simdi })
  const kayit = new S.RecordApi({ replika: r })
  const ekran = []
  const yz = new S.AiApi({
    kayit,
    me: kim,
    semalar: new Map([['yuva.defter.garanti@1', SEMA]]),
    now: () => simdi,
    yetenek: TR,
    model: async () => ({ metin: 'Cevap.', model: 'telefon/apple-fm@26.1' }),
    onayEkrani: async (g) => { ekran.push(g); return ek.onayCevabi === undefined ? { son: { urun: 'Kombi', bitis: '2028-03-14' } } : ek.onayCevabi },
    ...ek
  })
  return { L, r, kayit, yz, ekran }
}

test('1: ürün kodu jeton üretemez; jeton gösterilen koleksiyona bağlı; eski RecordApi yolu yok', async (t) => {
  const { yz, kayit, ekran } = kur()
  t.is(yz.onay, undefined, 'onay ekranı nesnesi ürün koduna açık değil')
  t.is(yz.onayGoster, undefined)
  t.is(kayit.yzOnayIste, undefined, 'D6 yolu kalktı (RFC-0023 104)')
  t.is(kayit.kaydet, undefined)
  const c = await yz.remove('yuva.defter.garanti@1', { metin: 'Kombi garantisi bitiş: 14.03.2028' }, ['aktarma:hfkap'])
  const jeton = await yz.requestApproval(TA, 'yuva.defter.garanti@1', c)
  t.is(ekran[0].collectionId, TA, 'ekran hedef koleksiyonu gösterir')
  t.is(await hataOf(() => yz.save(BAKICI, c, jeton)), 'INVALID_APPROVAL_TOKEN', 'gösterilmeyen koleksiyona kayıt yok')
  const jeton2 = await yz.requestApproval(TA, 'yuva.defter.garanti@1', c)
  const rid = await yz.save(TA, c, jeton2)
  t.alike(kayit.get(TA, rid).fields._ai, ['bitis'])
  t.is(await hataOf(() => yz.save(TA, c, jeton2)), 'INVALID_APPROVAL_TOKEN', 'tek kullanımlık')
  const iptal = kur(A.K.husniye, { onayCevabi: null })
  t.is(await iptal.yz.requestApproval(TA, 'yuva.defter.garanti@1', c), null, 'kullanıcı kapattı')
  const ekransiz = kur(A.K.husniye, { onayEkrani: null })
  t.is(await hataOf(() => ekransiz.yz.requestApproval(TA, 'yuva.defter.garanti@1', c)), 'NO_APPROVAL_SCREEN')
})

test('5: çıkarımın sınıfı kaynaktan; kasa kaynaklı bilgi yalnız kasaya; sınıf jetona bağlı', async (t) => {
  const { yz } = kur(A.K.husniye, { model: null })
  const c = await yz.remove('yuva.defter.garanti@1', { metin: 'Kombi bitiş 14.03.2028', sinif: 'aile' }, ['kayit:' + KASA + '/' + '01'.repeat(16)])
  t.is(c.sinif, 'kasa', 'çağıranın sınıfı yok sayılır')
  t.is(await hataOf(() => yz.requestApproval(TA, 'yuva.defter.garanti@1', c)), 'VAULT_SOURCE')
  const j = await yz.requestApproval(KASA, 'yuva.defter.garanti@1', c)
  t.is(await hataOf(() => yz.save(KASA, { ...c, sinif: 'aile' }, j)), 'INVALID_APPROVAL_TOKEN', 'sınıf değişirse')
  const m = await yz.remove('yuva.defter.garanti@1', { metin: 'Kombi bitiş 14.03.2028' }, ['dosya:' + 'aa'.repeat(32)])
  t.is(m.sinif, 'kasa', 'bilinmeyen dosya kaynağı en sıkı sınıf')
})

test('2: silinen ve değişen kayıt dizinden çıkar; asistanın bağlamına girmez', async (t) => {
  const { yz, kayit } = kur()
  const rid = kayit.put(TA, null, 'yuva.defter.not', { baslik: 'Kombi şifresi 4455' })
  yz.directory('kur')
  t.is((await yz.search('kombi şifresi')).length, 1)
  kayit.put(TA, rid, '', { baslik: 'Kombi bakımı yapıldı' })
  t.alike((await yz.search('şifresi')).length, 0, 'değişen kaydın eski metni yok')
  t.is((await yz.search('bakımı')).length, 1, 'yeni metin dizinde')
  kayit.del(TA, rid)
  t.alike(await yz.search('kombi'), [], 'silinen kayıt yok')
})

test('3: kriz cevabında güvenilen kişiler defterden; kriz olayı yayılmaz; uzun kriz mesajı şablon alır', async (t) => {
  const { yz } = kur(A.K.ecem)
  const olaylar = []
  yz.on('ai', (o) => olaylar.push(o))
  const c = await yz.ask({ metin: 'ölmek istiyorum ' + 'a'.repeat(3000) })
  t.is(c.kriz, true)
  t.alike(c.dugmeler.filter((d) => d.tur === 'yaz').map((d) => d.uye).sort(), [hex(A.K.kerem.memberId), hex(A.K.husniye.memberId), hex(A.K.irem.memberId)].sort(), 'ebeveynler ve yetişkin')
  t.alike(olaylar, [], 'kriz bilgisi olayla çıkmaz')
})

test('4: cikar sınıfı ve görev koleksiyonu kaynaktan; kasa metni işçiye gitmez; sor işçiyi kullanabilir', async (t) => {
  const MH = 'aa'.repeat(32)
  const isciVar = () => yzc.yetenek.yetenekKur({ isciler: [{ deviceId: 'd1'.repeat(16), aday: true, modeller: [{ modelHash: MH, kullanilir: true }], maxTaskRamMB: 8000, onay: true }] })
  const giden = []
  const { yz, L } = kur(A.K.kerem, { yetenek: isciVar, isciModeli: { modelHash: MH, ramMB: 4000 }, model: async (x) => { giden.push(x); return { metin: 'x', alanlar: {}, model: 'isci/qwen3-4b' } } })
  L.apply(A.olay(L, A.T.TASK_PERMIT, { subject: 'rol:ebeveyn', taskTypes: ['hf.task.llm'], allow: true }, [A.K.kerem]))
  const metin = 'Kombi bitiş 14.03.2028 ' + 'uzun metin '.repeat(1200)
  await yz.remove('yuva.defter.garanti@1', { metin, isci: { koleksiyon: { taskAccess: true, sensitivity: 'normal' } } }, ['kayit:' + KASA + '/' + '01'.repeat(16)])
  t.is(giden.length, 0, 'kasa kaynaklı metin işçiye gitmez')
  await yz.remove('yuva.defter.garanti@1', { metin }, ['kayit:' + TA + '/' + '01'.repeat(16)])
  t.is(giden.length, 1)
  t.alike([giden[0].yol, giden[0].collectionId], ['isci', TA], 'görevin koleksiyonu kaynağınki')
})

test('7, şüpheliler: genel koleksiyon adları ad sayılmaz; cihaz adları sayılır', async (t) => {
  const { yz } = kur()
  t.absent(yz._adlar().includes('Tüm Aile'))
  t.absent(yz._adlar().includes('Kasa'))
  t.ok(yz._adlar().includes('isci1'), 'cihaz adı')
  t.alike(yzc.engel.engel('kasa nedir', { adlar: yz._adlar() }), [])
  t.alike(yzc.engel.engel('tüm zamanların en iyi filmi', { adlar: yz._adlar() }), [])
})

test('11: dışarı sorma gösterilen metne ve genel cevaba bağlı jeton ister; günde 30', async (t) => {
  const acik = () => yzc.yetenek.yetenekKur({ uye: { paket: true, rol: 'ebeveyn', bulutAyar: true, kalan: 100 }, isletim: { id: 'apple-fm', surum: '26.1', tr: true }, bildirim: { platform: [{ id: 'apple-fm', surum: '26.1', tr: true, baglamToken: 4096 }] } })
  let gecit = 0
  const { yz } = kur(A.K.husniye, { yetenek: acik, gecit: async () => { gecit++; return { metin: 'cevap', model: 'gm' } } })
  t.alike(await yz.prepareExternal('kombi E1 hatası nedir'), { engel: ['genel-cevap-yok'] }, 'önce genel bir cevap olmalı')
  const c = await yz.ask({ metin: 'kombi E1 hatası nedir' })
  t.is(c.sinif, 'genel')
  const h = await yz.prepareExternal('kombi E1 hatası nedir')
  t.is(await hataOf(() => yz.askExternal('kombi E1 hatası nedir ve evim nerede', h.jeton)), 'NO_EXTERNAL_APPROVAL', 'değişmiş metin')
  const h2 = await yz.prepareExternal('kombi E1 hatası nedir')
  t.is((await yz.askExternal('kombi E1 hatası nedir', h2.jeton)).yol, 'disari')
  t.is(await hataOf(() => yz.askExternal('kombi E1 hatası nedir', h2.jeton)), 'NO_EXTERNAL_APPROVAL', 'tek kullanımlık')
  t.alike(await yz.prepareExternal('a'.repeat(1025)), { engel: ['uzun'] })
  for (let i = 1; i < 30; i++) { const x = await yz.prepareExternal('kombi E1 hatası nedir'); await yz.askExternal('kombi E1 hatası nedir', x.jeton) }
  const x = await yz.prepareExternal('kombi E1 hatası nedir')
  t.is(await hataOf(() => yz.askExternal('kombi E1 hatası nedir', x.jeton)), 'DAILY_LIMIT')
  t.is(gecit, 30)
})

test('12: bekçi defteri ilerleten yola bağlı (kayit.sync), platform ayrıca çağırmasa da', async (t) => {
  const { yz, kayit, L } = kur(A.K.ecem)
  yz.directory('kur')
  L.apply(A.koleksiyon(L, [A.K.kerem], { readers: ['rol:ebeveyn', 'rol:yetiskin'], writers: ['rol:ebeveyn', 'rol:yetiskin'] }))
  kayit.sync()
  t.alike(yz.directory('durum').koleksiyonlar, [])
})

test('h ve md. 50: bağlam mesajı başvuru ister; ilk kart anlaşılmadan asistan cevap vermez', async (t) => {
  const depo = new Map()
  const ilkKart = new yzc.asistan.IlkEtkilesim({ get: async (k) => depo.get(k), set: async (k, v) => depo.set(k, v) })
  const { yz } = kur(A.K.husniye, { ilkKart })
  t.is((await yz.status()).ilkKart, true)
  const c = await yz.ask({ metin: 'merhaba' })
  t.alike([c.ilkKart, c.metin.startsWith('Bu bir yapay zeka asistanıdır')], [true, true])
  await yz.firstCardAcknowledged()
  t.is((await yz.status()).ilkKart, false)
  t.is(await hataOf(() => yz.ask({ metin: 'bu ne', baglam: { metin: 'mesaj' } })), 'REFERENCE_REQUIRED')
  const m = await yz.ask({ metin: 'bu ne', baglam: { ref: 'msg:' + 'ab'.repeat(32) + '/' + 'cd'.repeat(16), metin: 'Kombi arızalı' } })
  t.alike(m.kaynaklar, ['msg:' + 'ab'.repeat(32) + '/' + 'cd'.repeat(16)])
})

test('doğrulama 12: SDK sor, yetenekteki onaylı ve aday işçiyi kullanır; görev erişimi kapalı parça gitmez', async (t) => {
  const MH = 'bb'.repeat(32)
  const isci = { deviceId: 'd2'.repeat(16), aday: true, modeller: [{ modelHash: MH, kullanilir: true }], maxTaskRamMB: 8000, onay: true }
  const giden = []
  const { yz, kayit, L } = kur(A.K.husniye, {
    yetenek: () => yzc.yetenek.yetenekKur({ isciler: [isci] }),
    model: async (x) => { giden.push(x); return { metin: 'Özet.', model: 'isci/qwen3-4b' } }
  })
  L.apply(A.olay(L, A.T.TASK_PERMIT, { subject: 'rol:ebeveyn', taskTypes: ['hf.task.llm'], allow: true }, [A.K.kerem]))
  kayit.put(TA, null, 'yuva.defter.not', { baslik: 'Kombi kullanım kılavuzu', metin: 'kombi ' + 'bakım adımları '.repeat(60) })
  yz.directory('kur')
  const c = await yz.ask({ metin: 'kombi kılavuzunu özetle' })
  t.is(c.yol, 'isci', 'platform modeli yok, işçi var')
  t.is(giden[0].isci, isci.deviceId)
  t.is(giden[0].collectionId, TA, 'görevin koleksiyonu kaynağınki')
  const k = kur(A.K.husniye, { yetenek: () => yzc.yetenek.yetenekKur({ isciler: [{ ...isci, onay: false }] }) })
  t.is((await k.yz.ask({ metin: 'kombi kılavuzunu özetle' })).hata, 'NO_ELIGIBLE_DEVICE', 'ilk kullanım onayı yoksa gitmez')
})
