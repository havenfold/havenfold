// SPDX-License-Identifier: Apache-2.0
// D25: RFC-0027'nin çekirdek tarafı — kap komutları (390, 391; ilk seçim 280, 281), kasa durumu (365; ilk seçim 229), taşıma (249), RFC-0027 §1a numaraları. Beklenenler elle yazıldı.
const test = require('brittle')
const b4a = require('b4a')
const S = require('..')
const A = require('../../core/records/test/helpers/family')

const hex = (b) => b4a.toString(b, 'hex')
const hataOfA = async (fn) => { try { await fn(); return null } catch (err) { return err.message } }
const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const TA = hex(A.K_TUM_AILE)
const KASA = hex(A.K_KASA)
const HIZLI = { opslimit: 3, memlimit: 64 * 1024 * 1024 }
const PAROLA = 'yirmi-dort-karakterli-p'

function kur () {
  const L = A.anaDefter()
  const saat = { t: A.TS0 + 3_600_000 }
  const kasa = new S.VaultApi({ ledger: L, me: A.K.husniye, now: () => saat.t, anahtarDogrula: (h) => h === 'ab'.repeat(32) })
  const kayit = new S.RecordApi({ replika: A.replika(L, A.K.husniye, { now: () => saat.t }), kasa })
  const kap = new S.ExportApi({ kayit, kdf: HIZLI, gizliAlanlar: (tur) => (tur === 'yuva.defter.sifre' ? ['parola'] : []), now: () => saat.t })
  return { L, kasa, kayit, kap, saat }
}

test('kap dışa aktarma (390): görünen adlar, yapay zeka alanları, dosyalar; gizli alan yalnız istenirse; içe alma (391)', async (t) => {
  const { kayit, kap, kasa } = kur()
  const dosya = kayit.attach({ bytes: b4a.from('garanti belgesi'), mime: 'application/pdf', name: 'garanti.pdf' }).blobRef
  kayit._yaz(TA, null, 'yuva.defter.garanti', { urun: 'Kombi', sahip: 'uye:' + hex(A.K.irem.memberId), belge: dosya, _src: ['msg:' + 'aa'.repeat(32) + '/' + 'bb'.repeat(16)], _ai: ['urun'], _conf: 90, _aiyol: 'kural/1' })
  t.is(await hataOfA(() => kap.export({ koleksiyonlar: [TA], parola: 'kisa' })), 'PASSWORD_TOO_SHORT')
  t.is(await hataOfA(() => kap.export({ koleksiyonlar: [KASA], parola: PAROLA })), 'VAULT_LOCKED', 'kasa kilitliyken dışa aktarılmaz')
  kasa.unlock('ab'.repeat(32))
  kayit.put(KASA, null, 'yuva.defter.sifre', { ad: 'Banka', parola: 'gizli123' })
  const r = await kap.export({ koleksiyonlar: [TA, KASA], parola: PAROLA })
  t.is(r.ogeSayisi, 2)
  t.is(r.eksikDosya, 0)
  t.is(r.dosyaAdi, 'yuva-defteri-' + new Date(A.TS0 + 3_600_000 + 180 * 60_000).toISOString().slice(0, 10) + '.yuvadefter')
  t.alike(r.bytes.subarray(0, 5), b4a.from('HFKAP'))
  const a = await kap.import({ bytes: r.bytes, parola: PAROLA })
  t.alike([a.baslik.urun, a.baslik.bicim, a.icerik.bicim, a.icerik.bicimSurum], ['yuva-defteri', 'yuva-defter-arsiv', 'yuva-defter-arsiv', 1])
  const [ta, ks] = a.icerik.koleksiyonlar
  t.alike([ta.ad, ks.ad, ks.kasa], ['Tüm Aile', 'Kasa', true])
  const g = ta.kayitlar[0]
  t.is(g.tur, 'yuva.defter.garanti')
  t.is(g.alanlar.sahip, A.anaDefter().members.get(hex(A.K.irem.memberId)).name, 'kişi görünen adıyla')
  t.absent('_src' in g.alanlar, 'msg: başvurusu dışarı çıkmaz')
  t.alike(g.yapay_zeka_alanlari, ['urun'])
  t.alike(g.alanlar.belge.mime, 'application/pdf')
  t.alike(a.dosyalar.map((d) => [d.ad, b4a.toString(d.bytes)]), [[g.alanlar.belge.dosya.slice(9), 'garanti belgesi']])
  t.absent('parola' in ks.kayitlar[0].alanlar, 'gizli alan istenmedi')
  const r2 = await kap.export({ koleksiyonlar: [KASA], parola: PAROLA, gizliDahil: true })
  t.is((await kap.import({ bytes: r2.bytes, parola: PAROLA })).icerik.koleksiyonlar[0].kayitlar[0].alanlar.parola, 'gizli123')
  t.ok(await hataOfA(() => kap.import({ bytes: r.bytes, parola: 'yanlis-parola-yanlis' })), 'yanlış parola açmaz')
})

test('taşıma (249): yapay zeka alanları korunur, _src\'ye kayit: eklenir; değişen alan yapay zeka sayılmaz', (t) => {
  const { kayit } = kur()
  const OL = hex(A.K_BAKICI)
  const rid = kayit._yaz(TA, null, 'yuva.defter.belge', { baslik: 'Kira', bitis: '2027-01-01', _src: ['dosya:' + 'cc'.repeat(32)], _ai: ['baslik', 'bitis'], _conf: 80, _aiyol: 'kural/1' })
  const yeni = kayit.move(TA, rid, OL, { bitis: '2027-06-01' })
  const f = kayit.get(OL, yeni).fields
  t.alike([f.baslik, f.bitis, f._ai, f._conf, f._src], ['Kira', '2027-06-01', ['baslik'], 80, ['dosya:' + 'cc'.repeat(32), 'kayit:' + TA + '/' + rid]])
  const iki = kayit.move(OL, yeni, TA, { baslik: 'Kira sözleşmesi' })
  const f2 = kayit.get(TA, iki).fields
  t.absent('_ai' in f2, 'hepsi değişti: _ai yok')
  t.absent('_conf' in f2)
  t.is(f2._aiyol, 'kural/1')
  t.is(hataOf(() => kayit.move(TA, iki, OL, { _ai: ['x'] })), 'RESERVED_FIELD')
})

test('kasa durumu (365) ve kasa olayları: kilit, kuruldu, kâğıt gerekli; kâğıt pay (366)', async (t) => {
  const { kasa } = kur()
  const olay = []
  kasa.on('vault', (x) => olay.push(x.type))
  t.is(kasa.status().kilitli, true)
  kasa.unlock('ab'.repeat(32))
  kasa.lock()
  await kasa.setupRecoveryKey(KASA, b4a.alloc(32, 1), { kagit: 1 })
  t.alike(olay, ['acildi', 'kilitlendi', 'kuruldu', 'kagit_gerekli'])
  const k = await kasa.paperShare({ tur: 'kra', collectionId: KASA, sir: b4a.alloc(32, 2), kagit: 1 })
  t.alike([k.version, k.kagitlar.length], [2, 1], 'kâğıt yenileme yeni sürüm')
  t.is((await kasa.paperShare({ sir: b4a.alloc(32, 3) })).kagitlar.length, 1, 'YA: diğer ebeveyn + kâğıt')
  t.is(await hataOfA(() => kasa.paperShare({ tur: 'x', sir: b4a.alloc(32) })), 'INVALID_TYPE')
})

test('D25 kanal numaraları (channel-v4.json; v3\'teki 229 yerine 365)', (t) => {
  const F = require('../../protocol/vectors/channel-v4.json')
  const V3 = require('../../protocol/vectors/channel-v3.json')
  for (const k of V3.komutlar) t.is(S.CHANNEL_COMMAND[k.ad], F.yerine[k.ad] ? F.yerine[k.ad].yeni : k.no, 'v3: ' + k.ad)
  t.ok(F.komutlar.filter((k) => k.no >= 365).every((k) => k.no <= 413)) // 400–409 kasa kurtarma (RFC-0027 §1a, D67); 410–413 RFC-0030 §8.1 (D79)
  for (const n of F.bos) t.absent(Object.values(S.CHANNEL_COMMAND).includes(n))
  for (const k of F.komutlar) {
    t.is(S.CHANNEL_COMMAND[k.ad], k.no, k.ad)
    const [sinif, yontem] = k.sdk.split('.')
    t.is(typeof (S[sinif].prototype[yontem] || S[sinif][yontem]), 'function', k.sdk) // TeamApi.create statik (D45)
  }
  t.alike(S.EXPORT_COMMAND, { EXPORT: 390, IMPORT: 391 })
  const nolar = Object.values(S.CHANNEL_COMMAND)
  t.is(new Set(nolar).size, nolar.length)
})
