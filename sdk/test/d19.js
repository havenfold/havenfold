// SPDX-License-Identifier: Apache-2.0
// D19: Yuva Defteri L13 dilim 2'den SDK eksikleri 2 (kollar/D-cekirdek.md D19, RFC-0025). Beklenenler elle yazıldı.
const test = require('brittle')
const b4a = require('b4a')
const S = require('..')
const yzc = require('@havenfold/ai')
const A = require('../../core/records/test/helpers/family')

const hex = (b) => b4a.toString(b, 'hex')
const hataOf = async (fn) => { try { await fn(); return null } catch (err) { return err.message } }
const TA = hex(A.K_TUM_AILE)
const KASA = hex(A.K_KASA)
const SEMA = { id: 'yuva.defter.ev-cihazi', v: 1, hedef: 'yuva.defter.ev_cihazi', alanlar: [{ ad: 'urun', tur: 'metin', zorunlu: true, dayanak: 'alinti' }, { ad: 'bitis', tur: 'tarih', zorunlu: false, dayanak: 'alinti' }] }

function kur (kim = A.K.husniye, ek = {}) {
  const L = A.anaDefter()
  const simdi = A.TS0 + 3_600_000
  const r = A.replika(L, kim, { now: () => simdi })
  const kayit = new S.RecordApi({ replika: r })
  const ekran = []
  const yz = new S.AiApi({
    kayit,
    me: kim,
    semalar: new Map([['yuva.defter.ev-cihazi@1', SEMA]]),
    now: () => simdi,
    yetenek: () => yzc.yetenek.yetenekKur({}),
    onayEkrani: async (g) => { ekran.push(g); return ek.cevap === undefined ? { son: { urun: 'Kombi', bitis: '2028-03-14' } } : ek.cevap },
    ...ek
  })
  return { L, kayit, yz, ekran }
}

test('(17) RFC-0025 §1: bu telefonda yeni eklenen bağsız dosya aile; kayda bağlıysa koleksiyonun sınıfı', async (t) => {
  const { yz, kayit } = kur()
  const { blobRef } = kayit.attach({ bytes: b4a.from('garanti belgesi tarama') })
  const ref = 'dosya:' + hex(blobRef.blobId)
  const c = await yz.remove('yuva.defter.ev-cihazi@1', { metin: 'Kombi garanti bitiş 14.03.2028' }, [ref])
  t.is(c.sinif, 'aile', 'yeni taranan belge Tüm Aile\'ye kaydedilebilir')
  t.ok(await yz.save(TA, c), 'kayıt yazıldı')
  const kasaKayit = new S.RecordApi({ replika: A.replika(kayit._L, A.K.kerem) })
  const k2 = kasaKayit.attach({ bytes: b4a.from('tapu') })
  kasaKayit.put(KASA, null, 'yuva.defter.belge', { dosya: k2.blobRef })
  const { yz: yz2 } = kur()
  yz2.kayit.r = kasaKayit.r
  const c2 = await yz2.remove('yuva.defter.ev-cihazi@1', { metin: 'Kombi' }, ['dosya:' + hex(k2.blobRef.blobId)])
  t.is(c2.sinif, 'kasa', 'kasa koleksiyonundaki kayda bağlı dosya kasa')
  const c3 = await yz.remove('yuva.defter.ev-cihazi@1', { metin: 'Kombi' }, ['dosya:' + 'cc'.repeat(32)])
  t.is(c3.sinif, 'kasa', 'başka yerden gelip bağsız kalan dosya kasa (c)')
})

test('(26) "jilet attım" kelime listesinde kriz', (t) => {
  for (const m of ['jilet attım', 'dün gece yine jilet attim', 'jiletledim kolumu']) t.ok(yzc.cocuk.krizMi(m), m)
  t.absent(yzc.cocuk.krizMi('jilet bitti market listesine yaz'))
  t.absent(yzc.cocuk.krizMi('jiletle kalem açtım'))
})

test('(25) kaydet onay ekranını kendisi açar, ek alanları aynı işlemde yazar; kapatınca null', async (t) => {
  const { yz, kayit, ekran } = kur()
  const c = await yz.remove('yuva.defter.ev-cihazi@1', { metin: 'Kombi bitiş 14.03.2028' }, ['aktarma:hfkap'])
  const dosya = kayit.attach({ bytes: b4a.from('fatura') }).blobRef
  const rid = await yz.save(TA, c, { ek: { dosya, kaynak_kisi: 'uye:' + hex(A.K.irem.memberId) } })
  t.is(ekran[0].hedef, 'yuva.defter.ev_cihazi', 'onay ekranı hedef türü görür')
  const k = kayit.get(TA, rid)
  t.is(k.type, 'yuva.defter.ev_cihazi')
  t.alike([k.fields.urun, k.fields.bitis, k.fields.kaynak_kisi, k.fields._ai], ['Kombi', '2028-03-14', 'uye:' + hex(A.K.irem.memberId), ['bitis']])
  t.ok(b4a.equals(k.fields.dosya.blobId, dosya.blobId), 'ek dosya alanı aynı kayıtta')
  t.is(kayit.history(TA, rid).length, 1, 'tek işlem (atomik)')
  t.is(await hataOf(() => yz.save(TA, c, { ek: { urun: 'x' } })), 'INVALID_EXTRA_FIELD', 'şema alanı ek olamaz')
  t.is(await hataOf(() => yz.save(TA, c, { ek: { _ai: ['urun'] } })), 'INVALID_EXTRA_FIELD')
  t.is(await hataOf(() => yz.save(TA, c, { ek: { kaynakKisi: 'x' } })), 'INVALID_EXTRA_FIELD', 'kayıt alan adı kuralı')
  const kapat = kur(A.K.husniye, { cevap: null })
  const c2 = await kapat.yz.remove('yuva.defter.ev-cihazi@1', { metin: 'Kombi' }, [])
  t.is(await kapat.yz.save(TA, c2), null, 'kullanıcı kapattı')
})

test('(22) öneri listesi: tür, hedef, wipe, imzalar, beklenenler; yerel ret', (t) => {
  const L = A.anaDefter()
  const d = new S.LedgerApi({ ledger: L, me: A.K.kerem, now: () => A.TS0 + 50_000 })
  const r = d.removeMember(hex(A.K.irem.memberId), { reason: 'x', wipe: true })
  t.is(r.durum, 'oneri', 'iki ebeveyn gerekir')
  const l = d.listProposals()
  t.is(l.length, 1)
  t.alike([l[0].type, l[0].hedef, l[0].wipe, l[0].imzalar], ['REMOVE_MEMBER', hex(A.K.irem.memberId), true, [hex(A.K.kerem.memberId)]])
  t.ok(l[0].waitingFor.length > 0)
  t.is(l[0].zaman, A.TS0 + 50_000)
  d.rejectProposal(l[0].proposalId)
  t.alike(d.listProposals(), [], 'yerelde düştü')
  t.is(hataOfSync(() => d.rejectProposal('yok')), 'NO_PROPOSAL')
})

function hataOfSync (fn) { try { fn(); return null } catch (err) { return err.message } }

// --- Kalanlar: (18)–(21), (23), (24), (27) ---
const { ledger: { Ledger }, identity: { createIdentity } } = require('@havenfold/core')
const Gr = require('@havenfold/tasks')
const ISCI = { deviceId: hex(A.C.isci1.memberId), aday: true, modeller: [{ modelHash: 'mm'.repeat(32).replace(/m/g, 'a'), kullanilir: true }], maxTaskRamMB: 4096, onay: true }
const PLATFORM = { id: 'apple-fm', surum: '1', tr: true, baglamToken: 4096 }

test('(21) cikar seçenekleri: yalnız telefon, seçili işçi, hedef koleksiyon; belge türü', async (t) => {
  const cagri = []
  const model = async (x) => { cagri.push([x.yol, x.isci, x.collectionId]); return { alanlar: { urun: 'Kombi' }, model: x.yol + '/m' } }
  const iz = (platform) => kur(A.K.kerem, { model, yetenek: () => yzc.yetenek.yetenekKur({ isciler: [ISCI] }), isciModeli: { modelHash: ISCI.modeller[0].modelHash, ramMB: 100 } })
  const { yz } = iz()
  await yz.remove('yuva.defter.ev-cihazi@1', { metin: 'Kombi garanti' }, [], { hedef: TA })
  t.alike(cagri.pop(), ['isci', ISCI.deviceId, TA], 'kaynak yok: görev koleksiyonu hedef')
  const c1 = await yz.remove('yuva.defter.ev-cihazi@1', { metin: 'Kombi garanti' }, [], { hedef: TA, yalnizTelefon: true })
  t.is(cagri.length, 0, 'yalnız telefon: işçiye gitmez, telefonda model yok → kural')
  t.is(c1.model, 'kural/1')
  t.is(await hataOf(() => yz.remove('yuva.defter.ev-cihazi@1', { metin: 'Kombi' }, [], { isci: 'ee'.repeat(16), hedef: TA })), 'NO_ELIGIBLE_DEVICE')
  t.is(await hataOf(() => yz.remove('yuva.defter.ev-cihazi@1', { metin: 'Kombi' }, [], { isci: ISCI.deviceId, yalnizTelefon: true })), 'INVALID_OPTION')
  const k = await yz.remove('yuva.defter.ev-cihazi@1', { metin: 'Kombi' }, [], { hedef: KASA })
  t.is(k.sinif, 'kasa', 'hedef kasa → sınıf kasa')
  t.is(await hataOf(() => yz.remove('yuva.defter.ev-cihazi@1', { metin: 'Kombi' }, [], { hedef: 'ff'.repeat(16) })), 'NO_COLLECTION')
  // Seçili işçi telefon modelinden önce gelir
  const p = kur(A.K.kerem, { model, yetenek: () => ({ ...yzc.yetenek.yetenekKur({ isciler: [ISCI] }), platform: PLATFORM }), isciModeli: { modelHash: ISCI.modeller[0].modelHash, ramMB: 100 } })
  await p.yz.remove('yuva.defter.ev-cihazi@1', { metin: 'Kombi' }, [], { hedef: TA })
  t.is(cagri.pop()[0], 'telefon', 'seçilmezse telefon modeli')
  await p.yz.remove('yuva.defter.ev-cihazi@1', { metin: 'Kombi' }, [], { hedef: TA, isci: ISCI.deviceId })
  t.alike(cagri.pop(), ['isci', ISCI.deviceId, TA])
  // Belge türü: anahtar kelime
  const semalar = new Map([
    ['yuva.defter.garanti@1', { id: 'yuva.defter.garanti', v: 1, hedef: 'yuva.defter.garanti', anahtarlar: ['garanti', 'garanti belgesi'], alanlar: [{ ad: 'urun', tur: 'metin', zorunlu: true, dayanak: 'alinti' }] }],
    ['yuva.defter.fatura@1', { id: 'yuva.defter.fatura', v: 1, hedef: 'yuva.defter.fatura', anahtarlar: ['fatura', 'son ödeme'], alanlar: [{ ad: 'tutar', tur: 'tutar', zorunlu: false, dayanak: 'alinti' }] }]
  ])
  const b = kur(A.K.kerem, { semalar })
  t.is(b.yz.documentType('ELEKTRİK FATURASI son ödeme 12.11.2026'), 'yuva.defter.fatura@1')
  t.is(b.yz.documentType('Garanti belgesi: Kombi'), 'yuva.defter.garanti@1')
  t.is(b.yz.documentType('Market listesi'), null)
  t.is((await b.yz.remove(null, { metin: 'Fatura toplam 1.250,00 TL son ödeme 12.11.2026' })).sema, 'yuva.defter.fatura@1')
  t.is(await hataOf(() => b.yz.remove(null, { metin: 'Market listesi' })), 'NO_SCHEMA')
})

const PLAN_SEMALAR = new Map([
  ['yuva.defter.etkinlik@1', { id: 'yuva.defter.etkinlik', v: 1, hedef: 'yuva.defter.etkinlik', alanlar: [{ ad: 'baslik', tur: 'metin', zorunlu: true, dayanak: 'cikarim' }, { ad: 'tarih', tur: 'tarih', zorunlu: false, dayanak: 'alinti' }, { ad: 'saat', tur: 'saat', zorunlu: false, dayanak: 'alinti' }, { ad: 'baslangic', tur: 'zaman', zorunlu: false, dayanak: 'alinti' }, { ad: 'kimler', tur: 'liste', oge: 'kisi', zorunlu: false, dayanak: 'alinti' }] }],
  ['yuva.defter.yapilacak@1', { id: 'yuva.defter.yapilacak', v: 1, hedef: 'yuva.defter.yapilacak', alanlar: [{ ad: 'baslik', tur: 'metin', zorunlu: true, dayanak: 'cikarim' }, { ad: 'tarih', tur: 'tarih', zorunlu: false, dayanak: 'alinti' }, { ad: 'sorumlu', tur: 'kisi', zorunlu: false, dayanak: 'cikarim' }] }]
])
const PS = { etkinlik: 'yuva.defter.etkinlik@1', yapilacak: 'yuva.defter.yapilacak@1' }
const MSG = 'msg:' + 'aa'.repeat(32) + '/' + 'bb'.repeat(16)

test('(20) Sohbetten Plana: kart, defterdeki kişiler, kaydet ve "zaten eklendi"; saatte 20 model çağrısı', async (t) => {
  let n = 0
  const model = async () => { n++; return { alanlar: { baslik: 'Dişçi randevusu' }, model: 'telefon/apple-fm@1' } }
  const { yz, kayit } = kur(A.K.husniye, { semalar: PLAN_SEMALAR, model, yetenek: () => ({ ...yzc.yetenek.yetenekKur({}), platform: PLATFORM }), cevap: undefined, onayEkrani: async (g) => ({ son: Object.fromEntries(g.alanlar.filter((x) => x.deger !== null).map((x) => [x.ad, x.deger])) }) })
  const at = A.TS0 + 3_600_000
  t.is(await yz.extractPlan({ ref: MSG, metin: 'Merhaba', at }, { semalar: PS }), null)
  const irem = 'uye:' + hex(A.K.irem.memberId)
  const k = await yz.extractPlan({ ref: MSG, metin: "Yarın 15:00'te İrem'le dişçi", at }, { semalar: PS })
  t.is(k.tur, 'etkinlik')
  t.is(k.cikarim.sinif, 'aile')
  const al = Object.fromEntries(k.cikarim.alanlar.map((x) => [x.ad, x.deger]))
  t.alike(al.kimler, [irem], 'defterdeki kişi')
  t.is(al.baslik, 'İremle dişçi', 'başlık çıkarım: kural (70) modelden (60) önce')
  t.is(k.cikarim.model, 'telefon/apple-fm@1', 'model çağrıldı')
  t.is(k.zatenEklendi, null)
  t.is(n, 1)
  const rid = await yz.save(TA, k.cikarim)
  t.alike(kayit.get(TA, rid).fields._src, [MSG])
  const k2 = await yz.extractPlan({ ref: MSG, metin: "Yarın 15:00'te İrem'le dişçi", at }, { semalar: PS })
  t.alike(k2.zatenEklendi, { collectionId: TA, recordId: rid })
  t.is(await hataOf(() => yz.extractPlan({ ref: 'kayit:' + TA + '/' + rid, metin: 'yarın', at }, { semalar: PS })), 'REFERENCE_REQUIRED')
  t.is(await hataOf(() => yz.extractPlan({ ref: MSG, metin: 'yarın', at }, { semalar: { etkinlik: PS.etkinlik } })), 'NO_SCHEMA')
  for (let i = 0; i < 30; i++) await yz.extractPlan({ ref: MSG, metin: 'yarın kurs', at }, { semalar: PS })
  t.is(n, 20, 'saatte en çok 20 model çağrısı; sonrası yalnız kural')
})

test('(23) bakıcı önerisi: Bakıcı:<ad> koleksiyonu, misafirin imzası, ebeveynin imzasıyla GRANT', (t) => {
  const L = A.anaDefter()
  const d = new S.LedgerApi({ ledger: L, me: A.K.kerem, now: () => A.TS0 + 60_000 })
  const misafir = A.C.misafir2
  const h = d.prepareCaregiver({ deviceCert: misafir.deviceCert, ad: ' Ayten ', expiresAt: A.TS0 + 7 * A.DAY, ceremonyTranscriptHash: b4a.alloc(32, 7) })
  t.is(h.koleksiyon.durum, 'uygulandi')
  const col = [...L.collections.values()].find((x) => x.name === 'Bakıcı:Ayten')
  t.alike([col.kind, col.sensitivity, col.taskAccess, col.history, col.readers, col.writers], ['bakici', 'normal', false, false, ['rol:ebeveyn'], ['rol:ebeveyn']])
  t.is(hataOfSync(() => d.proposeCaregiver(h.event, null)), 'INVALID_BODY', 'misafirin imzası olmadan olmaz')
  const imza = S.LedgerApi.signGuest(h.event, misafir)
  const r = d.proposeCaregiver(h.event, imza)
  t.is(r.durum, 'uygulandi')
  const g = L.grants.get(hex(misafir.memberId))
  t.alike([g.name, g.collections, g.active], ['Ayten', [col.id], true])
  t.is(d.familyInfo().misafirler.find((x) => x.name === 'Ayten').active, true)
})

test('(23) var olan bakıcı koleksiyonuyla; ebeveyn olmayan hazırlayamaz', async (t) => {
  const L = A.anaDefter()
  const d = new S.LedgerApi({ ledger: L, me: A.K.husniye, now: () => A.TS0 + 60_000 })
  const h = d.prepareCaregiver({ deviceCert: A.C.misafir2.deviceCert, ad: 'Ayten', koleksiyonlar: [hex(A.K_BAKICI)], expiresAt: A.TS0 + A.DAY, ceremonyTranscriptHash: b4a.alloc(32, 7) })
  t.is(h.koleksiyon, null)
  t.is(d.proposeCaregiver(h.event, S.LedgerApi.signGuest(h.event, A.C.misafir2)).durum, 'uygulandi')
  const irem = new S.LedgerApi({ ledger: A.anaDefter(), me: A.K.irem, now: () => A.TS0 + 60_000 })
  t.is(hataOfSync(() => irem.prepareCaregiver({ deviceCert: A.C.misafir2.deviceCert, ad: 'Ayten', koleksiyonlar: [hex(A.K_BAKICI)], expiresAt: A.TS0 + A.DAY, ceremonyTranscriptHash: b4a.alloc(32, 7) })), 'PARENT_REQUIRED', 'yetişkin misafir veremez')
})

// n: ana zincirin ilk n olayı (17: çocuğa OCR izni veren TASK_PERMIT'ten önce)
function gorevKur (kim, n = Infinity) {
  const L = A.anaDefter(n)
  const y = new Gr.yetenek.YetenekDefteri({ ledger: L, now: () => A.TS0 + 3_600_000 })
  return new S.TaskApi({ ledger: L, me: kim, yetenekler: y, now: () => A.TS0 + 3_600_000 })
}

test('(24) görev onayı: yalnız etkin işçiye ve görev verebilen üyeden; geri alma her zaman', (t) => {
  const isci = hex(A.C.isci1.memberId)
  const h = gorevKur(A.K.husniye)
  h.consent(isci, true)
  t.ok(h.onay.var(A.K.husniye.memberId, isci))
  t.is(hataOfSync(() => h.consent(hex(A.C.uc1.memberId), true)), 'NOT_WORKER', 'uç cihaz (çıkarılmış) işçi değil')
  t.is(hataOfSync(() => h.consent('ee'.repeat(16), true)), 'NOT_WORKER')
  t.is(hataOfSync(() => h.consent(hex(A.K.irem.memberId), true)), 'NOT_WORKER', 'üye kimliği cihaz değil')
  const ecem = gorevKur(A.K.ecem, 17)
  t.is(hataOfSync(() => ecem.consent(isci, true)), 'CANNOT_ASSIGN_TASK', 'çocuk görev veremez (06 Ç7)')
  t.is(hataOfSync(() => gorevKur(A.K.ecem).consent(isci, true)), null, 'TASK_PERMIT çocuğa OCR verdiyse onay verebilir')
  t.is(hataOfSync(() => ecem.consent(isci, false)), null, 'geri alma denetlenmez')
  t.ok(gorevKur(A.K.irem).consent(isci, true) === undefined, 'yetişkin verebilir')
})

test('(27) ailesiz uygulama: boş defterle kurulur, eşleşir, dönen defterle devam eder', (t) => {
  const yeni = createIdentity({ seed: 'd19/kerem-yeni', platform: 'test' })
  const ailesiz = S.LedgerApi.withoutFamily({ Ledger, me: yeni, appId: 'yuva-defteri', now: () => A.TS0 })
  t.is(ailesiz.hasFamily, false)
  t.is(ailesiz.L.len, 0)
  const istek = ailesiz.pairRequest('yuva-defteri')
  t.ok(b4a.isBuffer(istek))
  const { ledger: L } = S.LedgerApi.createFamily({ Ledger, me: A.K.kerem, displayName: 'Kerem', ts: A.TS0 })
  const ana = new S.LedgerApi({ ledger: L, me: A.K.kerem, now: () => A.TS0 + 1000 })
  t.ok(ana.hasFamily)
  const cevap = ana.pairApprove(istek, { approved: true })
  const { ledger: yeniDefter, event } = ailesiz.pairAccept(cevap)
  yeniDefter.apply(event)
  const d = new S.LedgerApi({ ledger: yeniDefter, me: yeni, appId: 'yuva-defteri', now: () => A.TS0 + 2000 })
  t.ok(d.hasFamily)
  t.is(d.familyInfo().ben.personId, hex(A.K.kerem.memberId), 'yeni kimlik Kerem\'in kişisine bağlı')
})
