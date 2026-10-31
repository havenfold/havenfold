// SPDX-License-Identifier: Apache-2.0
// SDK yapay zeka arayüzü (RFC-0013 §17): komut numaraları, çıkarma ve jetonlu kayıt, dizin ve arama, @asistan,
// kriz, "Dışarı sor" engeli, dizinin okuyuculukla silinmesi
const test = require('brittle')
const b4a = require('b4a')
const S = require('..')
const A = require('../../core/records/test/helpers/family')

const hex = (b) => b4a.toString(b, 'hex')
const hataOf = async (fn) => { try { await fn(); return null } catch (err) { return err.message } }
const TA = hex(A.K_TUM_AILE)
const SEMA = {
  id: 'yuva.defter.garanti',
  v: 1,
  hedef: 'yuva.defter.garanti',
  alanlar: [
    { ad: 'urun', tur: 'metin', zorunlu: true, dayanak: 'alinti' },
    { ad: 'bitis', tur: 'tarih', zorunlu: true, dayanak: 'alinti' }
  ]
}

function kur (kim = A.K.husniye, ek = {}) {
  const L = A.anaDefter()
  const simdi = A.TS0 + 3_600_000
  const r = A.replika(L, kim, { now: () => simdi })
  const kayit = new S.RecordApi({ replika: r })
  const cagri = { model: 0 }
  const yz = new S.AiApi({
    kayit,
    me: kim,
    semalar: new Map([['yuva.defter.garanti@1', SEMA]]),
    now: () => simdi,
    onayEkrani: async () => ({ son: { urun: 'Kombi', bitis: '2028-03-14' } }),
    model: async () => { cagri.model++; return { metin: 'Kombi servisi kayıtta.', model: 'telefon/apple-fm@26.1' } },
    yetenek: () => require('@havenfold/ai').yetenek.yetenekKur({ isletim: { id: 'apple-fm', surum: '26.1', tr: true }, bildirim: { platform: [{ id: 'apple-fm', surum: '26.1', tr: true, baglamToken: 4096 }] } }),
    ...ek
  })
  return { L, r, kayit, yz, cagri }
}

test('yz: komut numaraları 270–279', (t) => {
  t.alike(Object.values(S.AI_COMMAND), [270, 271, 272, 273, 274, 275, 276, 277, 278, 279])
  t.is(S.AI_COMMAND.AI_SAVE, 273)
})

test('yz: kural çıkarımı, onay ekranı ve jetonlu kayıt', async (t) => {
  const { yz, kayit } = kur(A.K.husniye, { model: null })
  const c = await yz.remove('yuva.defter.garanti@1', { metin: 'Kombi garantisi bitiş: 14.03.2028' }, ['aktarma:hfkap'])
  t.alike(c.alanlar.map((x) => [x.ad, x.deger, x.conf]), [['bitis', '2028-03-14', 90]])
  t.is(await hataOf(() => yz.save(TA, c, 'uydurma')), 'INVALID_APPROVAL_TOKEN', 'ekransız kaydedilemez')
  const jeton = await yz.requestApproval(TA, 'yuva.defter.garanti@1', c)
  const rid = await yz.save(TA, c, jeton)
  const k = kayit.get(TA, rid)
  t.is(k.type, 'yuva.defter.garanti')
  t.alike(k.fields, { urun: 'Kombi', bitis: '2028-03-14', _src: ['aktarma:hfkap'], _conf: 90, _ai: ['bitis'], _aiyol: 'kural/1' })
  t.is(await hataOf(() => yz.save(TA, c, jeton)), 'INVALID_APPROVAL_TOKEN', 'jeton tek kullanımlık')
})

test('yz: dizin kur, ara, @asistan kaynaklı cevap', async (t) => {
  const { yz, kayit, cagri } = kur(A.K.husniye)
  kayit.put(TA, null, 'yuva.defter.not', { baslik: 'Kombi servisi', tel: '0212 555 66 77' })
  const d = yz.directory('kur')
  t.ok(d.koleksiyonlar.includes(TA))
  t.is(d.parca, 1)
  const s = await yz.search('kombi servisi')
  t.is(s.length, 1)
  t.ok(s[0].ref.startsWith('kayit:' + TA + '/'))
  const c = await yz.ask({ metin: 'kombi servisi kim' })
  t.is(c.yol, 'telefon')
  t.alike(c.kaynaklar, [s[0].ref])
  t.is(c.sinif, 'aile')
  t.is(cagri.model, 1)
})

test('yz: geçmiş soranın Kişisel koleksiyonuna; asistan kendi cevaplarından beslenmez', async (t) => {
  const { yz, kayit } = kur(A.K.irem)
  await yz.ask({ metin: 'su kaç derecede kaynar' })
  const kisisel = hex(A.K_KISISEL_IREM)
  const g = kayit.query(kisisel, { type: 'hf.ai.konusma' })
  t.is(g.length, 1)
  t.is(g[0].fields._keep, 30)
  yz.directory('kur')
  t.is((await yz.search('su kaynar')).length, 0, 'hf.ai.konusma dizinlenmez')
  await yz.settings({ gecmis: 'kapali' })
  await yz.ask({ metin: 'ikinci soru' })
  t.is(kayit.query(kisisel, { type: 'hf.ai.konusma' }).length, 1, 'geçmiş kapalı')
})

test('yz: kriz akışında model çağrılmaz; "Dışarı sor" engel süzgecinden geçer', async (t) => {
  const { yz, cagri } = kur(A.K.irem)
  const c = await yz.ask({ metin: 'ölmek istiyorum' })
  t.is(c.kriz, true)
  t.is(cagri.model, 0)
  t.alike(await yz.prepareExternal('0532 123 45 67 kimin'), { engel: ['telefon'] })
  t.alike(await yz.prepareExternal('Coki neden kusar'), { engel: ['ad'] }, 'defterdeki varlık adı')
  t.alike(await yz.prepareExternal('kombi E1 hatası'), { engel: ['bulut-kapali'] }, 'bulut kapalıyken gidecek metin yok')
  t.is(await hataOf(() => yz.askExternal('kombi E1 hatası')), 'NO_EXTERNAL_APPROVAL', 'jetonsuz dışarı sorulamaz')
})

test('yz: okuyuculuk bitince dizin olay anında silinir', async (t) => {
  const { yz, L } = kur(A.K.ecem)
  yz.directory('kur')
  t.alike(yz.directory('durum').koleksiyonlar, [TA])
  L.apply(A.koleksiyon(L, [A.K.kerem], { readers: ['rol:ebeveyn', 'rol:yetiskin'], writers: ['rol:ebeveyn', 'rol:yetiskin'] }))
  yz.ledgerAdvanced()
  t.alike(yz.directory('durum'), { koleksiyonlar: [], parca: 0 })
  t.alike(await yz.search('kombi'), [])
})

test('yz: kriz anlam katmanı ve her zaman görünen Yardım (RFC-0023 §2)', async (t) => {
  const anlamsiz = kur(A.K.irem)
  t.is((await anlamsiz.yz.status()).krizAnlam, false, 'gömme modeli yoksa yalnız kural yolu')
  t.is(await anlamsiz.yz.isCrisis('ölmek istiyorum'), true)
  // Sahte gömme: her cümleyi aynı yöne atar; eşik 0.5 → her şey kriz (yalnız bağlantıyı sınar)
  const { yz, cagri } = kur(A.K.irem, { gom: { gom: () => [1, 0, 0] } })
  t.is((await yz.status()).krizAnlam, true)
  yz.krizAnlam.esik = { esik: 0.5, fark: -1, k: 1 }
  t.is(await yz.isCrisis('bugün hava güzel'), true, 'anlam katmanı ekler')
  const c = await yz.ask({ metin: 'bugün hava güzel' })
  t.is(c.kriz, true)
  t.is(cagri.model, 0)
  const y = yz.help([{ uye: 'u1', ad: 'Ayşe' }])
  t.is(y.metin, 'Bu konuda yalnız değilsin. Şimdi güvendiğin bir yetişkinle konuş. Acil bir tehlike varsa 112\'yi ara.')
  t.ok(y.dugmeler.some((d) => d.etiket === 'Ayşe\'ye yaz'))
})

// Codex 12. tur: kota kancası verilince 279 AI_QUOTA kancanın değerini döner (çağrı ad değişikliğinde yöntemin yeni adına
// çevrilmişti: this.kanca.quota is not a function)
test('yz: kota kancası (279 AI_QUOTA)', async (t) => {
  const deger = { ay: '2026-10', kalan: 12, gunlukKalan: 3, paket: true }
  const { yz } = kur(A.K.husniye, { kota: async () => deger })
  t.alike(await yz.quota(), deger)
  t.alike(await kur().yz.quota(), { ay: null, kalan: 0, gunlukKalan: 0, paket: false }, 'kancasız')
})
