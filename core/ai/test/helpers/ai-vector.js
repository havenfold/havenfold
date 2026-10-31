// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// protocol/vectors/ai.json üreticisi (RFC-0013 §19). Numaralar RFC'deki gibidir; bu görevde 3–12, 14, 16 var
// (1, 2, 13, 15 adım 3 ve 9 ile gelir). Yalnız belirlenimci parçalar; model çıktısı yoktur.
const b4a = require('b4a')
const yz = require('../..')
const A = require('../../../records/test/helpers/family')
const { ledger: { encodeEvent } } = require('@havenfold/core')

const hex = (b) => b4a.toString(b, 'hex')
const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const { metin: { N }, cozucu: cz, engel: { engel }, yetenek: y, cikarma: c, dizin: d, asistan: a, cocuk: k } = yz

const MH = 'aa'.repeat(32)
const BILDIRIM = { platform: [{ id: 'apple-fm', surum: '26.1', tr: true, baglamToken: 4096 }] }
const ISCI = { deviceId: 'd1'.repeat(16), aday: true, modeller: [{ modelHash: MH, kullanilir: true }], maxTaskRamMB: 6000, onay: true }
const ISGIRDI = { model: { modelHash: MH, ramMB: 4000 }, izin: true, koleksiyon: { taskAccess: true, sensitivity: 'normal' } }
const KB = (n) => Math.ceil((n * 1024) / 3) // n KB ASCII metnin tahmini tokenı

function yonlendirme () {
  const yet = {
    tr: { isletim: { id: 'apple-fm', surum: '26.1', tr: true }, bildirim: BILDIRIM },
    yok: {},
    isci: { isciler: [ISCI] },
    onaysiz: { isciler: [{ ...ISCI, onay: false }] }
  }
  const durumlar = [
    { aciklama: 'kasa, cikar, platform.tr, 1 KB → telefon', is: 'cikar', sinif: 'kasa', girdi: { token: KB(1) }, yetenek: 'tr' },
    { aciklama: 'kasa, ozet, platform modeli yok → yapılamıyor', is: 'ozet', sinif: 'kasa', girdi: { token: KB(1) }, yetenek: 'yok' },
    { aciklama: 'aile, ozet, 20 KB, uygun işçi → işçi', is: 'ozet', sinif: 'aile', girdi: { token: KB(20), ...ISGIRDI }, yetenek: 'isci' },
    { aciklama: 'aile, ozet, 20 KB, ilk kullanım onayı yok → yapılamıyor', is: 'ozet', sinif: 'aile', girdi: { token: KB(20), ...ISGIRDI }, yetenek: 'onaysiz' },
    { aciklama: 'aile, cikar, platform modeli yok, işçi yok → kural', is: 'cikar', sinif: 'aile', girdi: { token: KB(1) }, yetenek: 'yok' }
  ].map((x) => ({ ...x, beklenen: y.yol(x.is, x.sinif, x.girdi, y.yetenekKur(yet[x.yetenek])) }))
  const cocuk = { aciklama: 'genel, rol cocuk → "Dışarı sor" yok', uye: { paket: true, rol: 'cocuk', bulutAyar: true }, sinif: 'genel', engel: [], rol: 'cocuk' }
  cocuk.disariSor = y.disariGoster(y.yetenekKur({ uye: cocuk.uye }), cocuk)
  return { yetenekler: yet, durumlar, cocuk }
}

const tetikler = () => [
  { metin: '@asistan wifi şifresi' }, { metin: '  @Asistan: kombi' }, { metin: '@ASİSTAN ne var' }, { metin: '@asistanlar' },
  { metin: '@YUVA', takma: 'yuva' }
].map((x) => ({ ...x, beklenen: a.tetik(x.metin, { takma: x.takma || null }) !== null }))

const normal = () => ['İSTANBUL  Kombi Servisi', 'IŞIK', 'Ali’nin'].map((s) => ({ metin: s, beklenen: N(s) }))

const tarihler = () => ['14 Mart 2028', '14.03.2028', '14/3/28', '3 eyl 2027'].map((s) => {
  const t = cz.tarihler(s)
  return { metin: s, beklenen: t.length ? t[0].deger : null }
})

function guven () {
  const satirlar = [
    { aciklama: 'alıntı bulundu, model', g: { dayanak: 'alinti', yol: 'telefon', bulundu: true } },
    { aciklama: 'alıntı bulunamadı', g: { dayanak: 'alinti', yol: 'telefon', bulundu: false } },
    { aciklama: 'IBAN, kural, denetim hanesi tutuyor', g: { dayanak: 'alinti', yol: 'kural', bulundu: true, denetimHanesi: true } },
    { aciklama: 'cikarim, model', g: { dayanak: 'cikarim', yol: 'telefon' } }
  ].map((x) => ({ ...x, beklenen: c.guven(x.g) }))
  const ayni = { model: 85, kural: 90, beklenen: c.ikisiAyni(85, 90) }
  // Onay ekranı: bulunamayan alan (40) boş gelir; kayıt _conf ve _ai'si yalnız değiştirilmeyen alanlardan
  const sema = { id: 'test.odeme', v: 1, hedef: 'test.odeme', alanlar: [
    { ad: 'alici', tur: 'metin', zorunlu: true, dayanak: 'alinti' },
    { ad: 'iban', tur: 'iban', zorunlu: false, dayanak: 'alinti' },
    { ad: 'son', tur: 'tarih', zorunlu: false, dayanak: 'alinti' },
    { ad: 'tutar', tur: 'tutar', zorunlu: false, dayanak: 'alinti' }
  ] }
  const cikarim = { sema: 'test.odeme@1', alanlar: [
    { ad: 'alici', deger: 'Kombi servisi', conf: 85 },
    { ad: 'iban', deger: 'TR330006100519786457841326', conf: 95 },
    { ad: 'son', deger: '2028-03-15', conf: 40 },
    { ad: 'tutar', deger: 125050, conf: 60 }
  ], kaynak: ['msg:' + 'ab'.repeat(32) + '/' + 'cd'.repeat(16)], model: 'telefon/apple-fm@26.1' }
  const ekran = new c.OnayEkrani({ simdi: () => 0 })
  const g = ekran.goster(sema, cikarim)
  const son = { alici: 'Kombi servisi', iban: 'TR330006100519786457841326', son: '2028-03-14', tutar: 120000 }
  const kayit = ekran.tuket(ekran.kaydetDokunusu(g.id, son), cikarim, son)
  return { satirlar, ayni, onay: { sema, cikarim, ekran: g.alanlar, son, kayit } }
}

const engeller = () => [
  { metin: '10000000146 nedir' }, { metin: 'TR33 0006 1005 1978 6457 8413 26' }, { metin: 'Kombi E1 hatası ne demek' },
  { metin: 'Coki neden kusar', adlar: ['Coki'] }, { metin: '0532 123 45 67' }
].map((x) => ({ ...x, beklenen: engel(x.metin, { adlar: x.adlar || [] }) }))

function yzGovdeler () {
  const kaynakli = { yol: 'telefon', metin: 'Kombi servisi 0212 555 66 77.', kaynakAdlari: ['Defter › Ev › Kombi'] }
  const kaynaksiz = { yol: 'isci', metin: 'Kombiler yılda bir bakım ister.' }
  return [kaynakli, kaynaksiz].map((x) => ({ girdi: x, govde: a.yzGovde(x), cozum: a.yzCoz(a.yzGovde(x)) }))
}

function kaynaksiz () {
  const adlar = ['Coki', 'İrem Eser']
  const x = { metin: 'Coki dün aşı oldu.', yol: 'telefon', model: 'telefon/apple-fm@26.1', sinif: 'aile', adlar }
  return { girdi: x, beklenen: a.cevapKur(x).metin }
}

function dizin () {
  const K = b4a.alloc(32, 0x5a)
  const keyId = b4a.alloc(16, 0x01)
  const col = b4a.alloc(16, 0x31)
  const blok = { K: hex(K), keyId: hex(keyId), collectionId: hex(col), blokNo: 3, modelHash: MH }
  const parcalar = [{ ref: 'kayit:' + '31'.repeat(16) + '/' + '01'.repeat(16), vec: [127, -127, 0, 5] }]
  const nonce = b4a.alloc(24, 0x77)
  const ct = d.blokSifreleVektor({ K, keyId, collectionId: col, blokNo: 3, modelHash: b4a.from(MH, 'hex'), parcalar: parcalar.map((p) => ({ ref: p.ref, vec: Int8Array.from(p.vec) })) }, nonce)

  // Ana aile zinciri; çocuk (Ecem) ve yetişkin (İrem) için dizinlenecekler; sonra Tüm Aile'yi daraltan COLLECTION
  const L = A.anaDefter()
  const zincir = L.events.map((e) => hex(encodeEvent(e)))
  const kim = { ecem: hex(A.K.ecem.memberId), irem: hex(A.K.irem.memberId), kerem: hex(A.K.kerem.memberId) }
  const once = Object.fromEntries(Object.entries(kim).map(([ad, id]) => [ad, d.dizinlenecekler(L, id)]))
  const silinen = []
  const bekci = new d.DizinBekcisi({ me: kim.ecem, sil: (cid, seq) => silinen.push({ cid, seq }) })
  bekci.uygula(L)
  const e = A.koleksiyon(L, [A.K.kerem], { readers: ['rol:ebeveyn', 'rol:yetiskin'], writers: ['rol:ebeveyn', 'rol:yetiskin'] })
  L.apply(e)
  bekci.uygula(L)
  return {
    indexKey: hex(d.indexKey(K, col)),
    ad: hex(d.blokAD(col, keyId, 3, b4a.from(MH, 'hex'))),
    blok: { ...blok, nonce: hex(nonce), parcalar, bytes: hex(ct) },
    zincir,
    kimlikler: kim,
    dizinlenecekler: once,
    daraltan: { olay: hex(encodeEvent(e)), me: kim.ecem, silinen }
  }
}

function arama () {
  const P = (id, col, rec) => ({ id, collectionId: col, recordId: rec })
  const c1 = '01'.repeat(16)
  const c2 = '02'.repeat(16)
  const r1 = '0a'.repeat(16)
  const r2 = '0b'.repeat(16)
  const listeler = [[P('x', c2, r1), P('y', c1, r2), P('z', c1, r1)], [P('z', c1, r1), P('w', c1, r1), P('x', c2, r1)]]
  return { k: 60, listeler, beklenen: d.rrf(listeler).map((x) => x.id) }
}

// Vektör 14: bayraklar akış gerçekten çalıştırılarak hesaplanır (inceleme 10 §19)
async function kriz () {
  let model = 0
  const gecmis = []
  const s = new a.Asistan({ yetenek: y.yetenekKur({}), model: async () => { model++; return { metin: 'x', model: 'm' } }, gecmis: { ayar: 30, yaz: async (x) => gecmis.push(x) } })
  const c = await s.sor({ metin: 'Artık ölmek istiyorum' })
  return {
    metinler: ['Artık ölmek istiyorum', 'Kombi bozuk'].map((m) => ({ metin: m, kriz: k.krizMi(m) })),
    sablon: c.metin,
    modelCagrilir: model > 0,
    gecmiseYazilir: gecmis.length > 0
  }
}

const cocuk = () => [{ metin: 'Kombi kapalı olabilir. Seni özledim! Vanayı aç.' }].map((x) => ({ ...x, beklenen: k.cocukSuzgeci(x.metin).metin }))

async function vektorler () {
  return {
    rfc: 'RFC-0013',
    not: 'Numaralar §19 ile aynı. 1, 2, 13, 15 sonraki adımlarda eklenir (yeni dosyada).',
    3: yonlendirme(),
    4: tetikler(),
    5: normal(),
    6: tarihler(),
    7: guven(),
    8: engeller(),
    9: yzGovdeler(),
    10: kaynaksiz(),
    11: dizin(),
    12: arama(),
    14: await kriz(),
    16: cocuk(),
    hatalar: {
      dizinBozuk: hataOf(() => d.blokCoz({ K: b4a.alloc(32), keyId: b4a.alloc(16), collectionId: b4a.alloc(16), blokNo: 0, modelHash: b4a.alloc(32), bytes: b4a.alloc(64) }))
    }
  }
}

// ai-v2.json (RFC-0024 §5, D16): ai.json'un bütün içeriği ve vektör 14'e kademeli sonuç. Anlam katmanı belirlenimci
// sahte gömmeyle (test/yardimci/fake-embedding.js: katlanmış metnin harf üçlüleri, FNV-1a, 256 boyut) ve sabit eşiklerle
// hesaplanır; gerçek modelin değerleri değildir, yalnız tam/sınır/yok kuralını sabitler.
async function vektorlerV2 () {
  const { sahteGom } = require('./fake-embedding')
  const v1 = await vektorler()
  const esik = { esik: 1.01, fark: 0, k: 1 }
  const dusuk = { esik: 0.5, fark: 0, k: 1 }
  const katman = new yz.krizAnlam.KrizAnlam({ gom: sahteGom, esik, dusuk })
  const durumlar = []
  for (const metin of ['ölmek istiyorum', 'artık var olmak istemiyorum', 'bugün hava çok güzel parka gidelim']) {
    durumlar.push({ metin, duzey: k.krizDuzeyi(metin, { anlam: await katman.skor(metin) }) })
  }
  let model = 0
  const gecmis = []
  const s = new a.Asistan({ yetenek: y.yetenekKur({ isletim: { id: 'apple-fm', surum: '26.1', tr: true }, bildirim: { platform: [{ id: 'apple-fm', surum: '26.1', tr: true, baglamToken: 4096 }] } }), krizAnlam: katman, model: async () => { model++; return { metin: 'Cevap.', model: 'telefon/apple-fm@26.1' } }, gecmis: { ayar: 30, yaz: async (x) => gecmis.push(x) } })
  const c = await s.sor({ metin: 'artık var olmak istemiyorum' })
  return {
    ...v1,
    not: v1.not + ' yz-v2: 14.kademe RFC-0024 §5 (D16); yz.json değişmedi.',
    14: {
      ...v1[14],
      kademe: {
        gomme: 'sahte: katla(metin) harf üçlüleri, FNV-1a, 256 boyut (test/yardimci/sahte-gomme.js)',
        yuksek: esik,
        dusuk,
        durumlar,
        sinirCevabi: { modelCagrilir: model > 0, yardimOner: c.yardimOner === true, yardimSatiri: c.yardimSatiri, gecmiseSinirYazilir: JSON.stringify(gecmis).includes('yardim') }
      }
    }
  }
}

module.exports = { vektorler, vektorlerV2 }
