// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// protocol/vectors/event-v3.json üreticisi (RFC-0032 §8): kuralda gün saati, çok günlük pencere ve kapatan olay.
// Belirlenimci. Zincir ve kayıt kurucu olay vektörleriyle aynı (yardimci/event.js); kayıtlar tek işlemli OpInner.
// Her maddenin sonucu calistir() ile hesaplanır; test aynı işlevle dosyadaki girdilerden yeniden hesaplar.
const b4a = require('b4a')
const Kr = require('../../rule')
const Mo = require('../../engine')
const Vk = require('../../case')
const { olayAlanlari, kayitIslemden, anahtar } = require('../../event')
const O = require('./event')

const { C, U, hex, MIN, HOUR, DAY, defter, COKI, uye, cihaz, kayit, sifirla, K_OLAYLAR } = O

const S0 = 20745 // 19 Ekim 2026 (RFC-0032 §8)
const yerelAn = (gun, dk) => gun * DAY + dk * MIN - 180 * MIN
const GOZLEM = { tur: 'yuva.pet.gozlem', v: 1, olay: true, yazar: 'ikisi', ozne: ['varlik', 'uye'], alanlar: [], kapsam: 'topluluk', keep: 90, ozel: false }
function katalog () {
  const k = O.katalog()
  k.turKaydet({ tur: 'yuva.pet.kum', v: 1, olay: true, yazar: 'ikisi', ozne: ['varlik'], alanlar: [], kapsam: 'topluluk', keep: 90, ozel: false })
  k.turKaydet(GOZLEM)
  return k
}

function jsonla (v) {
  if (b4a.isBuffer(v)) return hex(v)
  if (typeof v === 'bigint') return v.toString()
  if (Array.isArray(v)) return v.map(jsonla)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, jsonla(x)]))
  return v
}
function esit (a, b, ne) {
  if (JSON.stringify(jsonla(a)) !== JSON.stringify(jsonla(b))) throw new Error('RFC beklentisi tutmadı: ' + ne + ' ' + JSON.stringify(jsonla(a)) + ' ≠ ' + JSON.stringify(jsonla(b)))
}

// --- Kurallar (RFC-0032 §7) ---------------------------------------------------------------------------------------

const AKSAM = { bicim: 2, _subj: COKI, kosullar: [['yuva.pet.beslenme', 'yok', '', 0, 'gt', 0]], gun_saati: [960, 1200], utc_dk: 180, kapatan_olay: ['yuva.pet.beslenme'], eylem: 'vaka', onem: 1, aktif: true }
const KUM = { bicim: 2, _subj: COKI, kosullar: [['yuva.pet.kum', 'yok', '', 0, 'gt', 0]], gun_saati: [1200, 1200], gun: 2, kapatan_olay: ['yuva.pet.kum'], eylem: 'vaka', onem: 1, aktif: true }

// --- Hesap ----------------------------------------------------------------------------------------------------

// Motoru kayıtlarla çalıştırır. Dönüş: yeni vakaların ve var olan vakaların özeti
function motorla (kayitlar, simdi) {
  const L = defter()
  const ctx = { ledger: L, collectionId: K_OLAYLAR, katalog: katalog(), kayitlar: kayitlar.map((k) => kayitIslemden(L, b4a.from(k.inner, 'hex'), b4a.from(k.opId, 'hex'))) }
  const s = Mo.degerlendir(ctx, simdi)
  return {
    yeni: s.yeni.map((y) => ({ vaka: hex(y.alanlar.vaka), kaynak: y.alanlar.kaynak, _subj: y.alanlar._subj, pencere: y.alanlar.pencere })),
    vakalar: s.vakalar.map((d) => ({ vaka: d.vaka, pencere: d.pencere, cozuldu: !!d.cozuldu, neden: d.cozen ? d.cozen.neden : null, cozen: d.cozen ? d.cozen.recordId : null, cozenYazar: d.cozen ? d.cozen.yazar : null, kapali: d.kapali, yenidenBasla: d.yenidenBasla ?? null }))
  }
}

// Vektör maddesinin sonucu (dosyadaki girdilerden)
function calistir (m) {
  if (m.tur === 'pencere') return m.girdiler.map((g) => { const [S, E] = Kr.sabitPencere(Kr.kuralTanimi({ fields: { ...AKSAM, gun_saati: g.gun_saati, gun: g.gun }, tf: { _subj: COKI } }), g.s); return { S, E } })
  if (m.tur === 'gun') {
    const k = Kr.kuralTanimi({ fields: { ...AKSAM, gun_saati: undefined, kapatan_olay: undefined }, tf: { _subj: COKI } })
    return m.girdiler.map((t) => Kr.gunlerIcin(k, t).map((s) => { const [S, E] = Kr.sabitPencere(k, s); return { s, S, E } }))
  }
  if (m.tur === 'eski') {
    const L = defter()
    const k = kayitIslemden(L, b4a.from(m.kural.inner, 'hex'), b4a.from(m.kural.opId, 'hex'))
    return { tanim: Kr.kuralTanimi(k) !== null, ...motorla(m.kayitlar, m.simdi) }
  }
  if (m.tur === 'sira') {
    const sonuclar = m.siralar.map((sira) => motorla(sira.map((i) => m.kayitlar[i]), m.simdi))
    for (const x of sonuclar) esit(x, sonuclar[0], 'sıra bağımsızlığı')
    return sonuclar[0]
  }
  if (m.tur === 'dizi') return m.adimlar.map((a) => motorla(m.kayitlar, a).yeni.length)
  return motorla(m.kayitlar, m.simdi)
}

// --- Vektörler ------------------------------------------------------------------------------------------------

function vektorler () {
  const L = defter()
  const kat = katalog()
  sifirla()
  const tanimAni = yerelAn(S0 - 1, 0)
  const [S, E] = [1792414800000, 1792429200000]
  const temiz = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined))
  const kural = (alanlar, an = tanimAni, n = 0) => kayit(L, U.kerem, 'hf.kural', temiz(alanlar), an, { n })
  const ridOf = (k) => kayitIslemden(L, b4a.from(k.inner, 'hex'), b4a.from(k.opId, 'hex')).recordId
  // Kuralın E + 1 dk'daki önerisini üyenin telefonu hf.vaka olarak yazmış olsun
  let vn = 0
  const vakaYaz = (kk) => {
    const L2 = defter()
    const ctx = { ledger: L2, collectionId: K_OLAYLAR, katalog: katalog(), kayitlar: [kayitIslemden(L2, b4a.from(kk.inner, 'hex'), b4a.from(kk.opId, 'hex'))] }
    const alan = Mo.degerlendir(ctx, E + MIN).yeni[0].alanlar
    return { alan, kayit: kayit(L, U.kerem, 'hf.vaka', { ...alan, _t: E + MIN }, E + MIN, { n: vn++ }) }
  }
  const besle = (t, { kim = U.irem, subj = COKI, hlcMs = t, tur = 'yuva.pet.beslenme', conf } = {}) => kayit(L, kim, tur, olayAlanlari(kat, tur, { t, subj, conf }), hlcMs)
  const aksam = kural(AKSAM)
  const maddeler = []
  const madde = (no, aciklama, m) => { m.beklenen = calistir(m); maddeler.push({ no, aciklama, ...m }); return m.beklenen }

  // 1, 2: pencere hesabı
  esit(madde(1, 'Pencere: [960, 1200], [360, 675] ve gece [1320, 360]; s = 20745, utc_dk = 180', { tur: 'pencere', girdiler: [{ gun_saati: [960, 1200], gun: 1, s: S0 }, { gun_saati: [360, 675], gun: 1, s: S0 }, { gun_saati: [1320, 360], gun: 1, s: S0 }] }),
    [{ S: 1792414800000, E: 1792429200000 }, { S: 1792378800000, E: 1792397700000 }, { S: 1792436400000, E: 1792465200000 }], 'madde 1')
  esit(madde(2, 'Çok gün: [1200, 1200], gun = 2, s = 20744 (48 saat)', { tur: 'pencere', girdiler: [{ gun_saati: [1200, 1200], gun: 2, s: S0 - 1 }] }), [{ S: 1792342800000, E: 1792515600000 }], 'madde 2')

  // 3: akşam maması
  const r3 = madde(3, 'Akşam maması: pencerede mama yok → vaka (pencereBasi = S); 19:38\'de mama → vaka yok', { tur: 'motor', kayitlar: [aksam], simdi: E + MIN })
  esit([r3.yeni.length, r3.yeni[0].pencere], [1, [S, E]], 'madde 3a')
  const r3b = madde(3, 'Akşam maması: 19:38\'de mama verildi → vaka yok', { tur: 'motor', kayitlar: [aksam, besle(1792427880000)], simdi: E + MIN })
  esit(r3b.yeni.length, 0, 'madde 3b')

  // Açılmış vaka (3'teki öneri üyenin telefonunca yazıldı)
  const { alan: vakaAlan, kayit: vaka } = vakaYaz(aksam)

  // 4: kapatan olay
  const r4 = madde(4, 'Kapatan olay: 20:12\'de mama → cozuldu', { tur: 'motor', kayitlar: [aksam, vaka, besle(1792429920000)], simdi: E + 20 * MIN })
  esit([r4.vakalar.length, r4.vakalar[0].cozuldu, r4.vakalar[0].neden], [1, true, 'kapatan'], 'madde 4a')
  const baskaOzne = kural({ ...AKSAM, kapatan_olay: ['yuva.pet.gozlem'] }, tanimAni, 1)
  const r4b = madde(4, 'Kapatan olay başka özne için (uye:kerem) → çözülmez; kapatan_olay yuva.pet.gozlem', { tur: 'motor', kayitlar: [baskaOzne, vakaYaz(baskaOzne).kayit, besle(1792429920000, { tur: 'yuva.pet.gozlem', subj: uye(U.kerem) })], simdi: E + 20 * MIN })
  esit([r4b.vakalar.length, r4b.vakalar[0].cozuldu], [1, false], 'madde 4b')
  const r4c = madde(4, '_t < S olan mama (15:30) → çözülmez', { tur: 'motor', kayitlar: [aksam, vaka, besle(1792411200000, { hlcMs: E + 10 * MIN })], simdi: E + 20 * MIN })
  esit([r4c.vakalar[0].cozuldu], [false], 'madde 4c')
  // Çözülme, açılışla aynı olay kümesine bakar: güveni düşük (_conf 40) olay vakayı çözmez (§6.1 açıklama 1)
  const r4d = madde(4, '20:12\'de güveni düşük (_conf 40) mama → çözülmez', { tur: 'motor', kayitlar: [aksam, vaka, besle(1792429920000, { conf: 40 })], simdi: E + 20 * MIN })
  esit([r4d.vakalar[0].cozuldu], [false], 'madde 4d')

  // 5: bakıcı
  const r5 = madde(5, 'Bakıcı: 20:12\'deki mama misafirden (C.misafir1) → cozuldu; misafirin hf.vaka.kapat\'ı yok sayılır', {
    tur: 'motor',
    kayitlar: [aksam, vaka, besle(1792429920000, { kim: C.misafir1 }), kayit(L, C.misafir1, 'hf.vaka.kapat', { vaka: vakaAlan.vaka, sonuc: 'gercek', _t: E + 30 * MIN }, E + 30 * MIN)],
    simdi: E + 40 * MIN
  })
  esit([r5.vakalar[0].cozuldu, r5.vakalar[0].cozenYazar, r5.vakalar[0].kapali], [true, 'misafir', false], 'madde 5')

  // 6: geç olay
  const gec = besle(1792427880000, { hlcMs: E + 2 * HOUR })
  const r6 = madde(6, 'Geç olay: vaka açıldıktan sonra _t = 19:38 olan mama gelir → cozuldu (neden kosul: pencere içindeki olay kapatan sayılmaz, §6.1 açıklama 1)', { tur: 'motor', kayitlar: [aksam, vaka, gec], simdi: E + 3 * HOUR })
  esit([r6.vakalar[0].cozuldu, r6.vakalar[0].neden], [true, 'kosul'], 'madde 6a')
  const kapatansiz = kural({ ...AKSAM, kapatan_olay: undefined }, tanimAni, 2)
  const vaka6 = vakaYaz(kapatansiz).kayit
  const r6b = madde(6, 'Geç olay, kapatan_olay\'sız kural: koşul artık sağlanmıyor → cozuldu (neden kosul)', { tur: 'motor', kayitlar: [kapatansiz, vaka6, gec], simdi: E + 3 * HOUR })
  esit([r6b.vakalar[0].cozuldu, r6b.vakalar[0].neden], [true, 'kosul'], 'madde 6b')

  // 7: sıra bağımsızlığı
  const basamak = kayit(L, U.kerem, 'hf.vaka.basamak', { vaka: vakaAlan.vaka, basamak: 2, sira: 0, _t: E + 2 * MIN }, E + 2 * MIN)
  const kapatan = besle(1792429920000)
  const r7 = madde(7, 'Sıra bağımsızlığı: kural, olay, hf.vaka, basamak ve kapatan olay üç sırayla → aynı vaka, aynı durum', { tur: 'sira', kayitlar: [aksam, vaka, basamak, kapatan], siralar: [[0, 1, 2, 3], [3, 2, 1, 0], [2, 0, 3, 1]], simdi: E + 30 * MIN })
  esit(r7.vakalar[0].cozuldu, true, 'madde 7')

  // 8: tekrar yok — kural ilk penceresi biterken yazıldı: s0 = S0 (E = 21 Ekim 20:00), önceki pencere (E = 20 Ekim 20:00) kuraldan önce
  const kum = kural(KUM, yerelAn(S0 + 1, 1200) + MIN, 3)
  const E8 = (s) => yerelAn(s + 2, 1200)
  const r8 = madde(8, 'Tekrar yok: gun = 2, üç gün kum yok → yalnız ilk pencere vaka açar', { tur: 'dizi', kayitlar: [kum], adimlar: [E8(S0) + MIN, E8(S0 + 1) + MIN, E8(S0 + 2) + MIN] })
  esit(r8, [1, 0, 0], 'madde 8')

  // 9: kesinti — isci1 mama olaylarının kaynağı; pencerenin %33'ünde (80 dk / 240 dk) çevrimdışı
  const kaynak = besle(S - 6 * HOUR, { kim: C.isci1 })
  const kes = (tur, t, n) => kayit(L, U.kerem, tur, olayAlanlari(kat, tur, { t, subj: cihaz(C.isci1), key: anahtar(tur, C.isci1.memberId, n) }), t)
  const kesinti = [kes('hf.device.offline', S, 91), kes('hf.device.online', S + 80 * MIN, 92)]
  const r9 = madde(9, 'Kesinti: kaynak pencerenin %33\'ünde kapalı → vaka yok', { tur: 'motor', kayitlar: [aksam, kaynak, ...kesinti], simdi: E + MIN })
  esit(r9.yeni.length, 0, 'madde 9a')
  const acik = kural({ ...AKSAM, kesintide_ac: true }, tanimAni, 4)
  const r9b = madde(9, 'Aynı kural kesintide_ac: true → vaka', { tur: 'motor', kayitlar: [acik, kaynak, ...kesinti], simdi: E + MIN })
  esit(r9b.yeni.length, 1, 'madde 9b')

  // 10: utc_dk sınırı
  esit(madde(10, 'gun_saati yok ([0, 0]): yerel 18 Ekim 23:59 s = 20744 penceresine, 19 Ekim 00:30 s = 20745 penceresine', { tur: 'gun', girdiler: [1792357140000, 1792359000000] }),
    [[{ s: S0 - 1, S: yerelAn(S0 - 1, 0), E: yerelAn(S0, 0) }], [{ s: S0, S: yerelAn(S0, 0), E: yerelAn(S0 + 1, 0) }]], 'madde 10')

  // 11: eski motor — pencere_dk = 0, bicim yok
  const eski = kural({ ...AKSAM, bicim: undefined, gun_saati: undefined, utc_dk: undefined, kapatan_olay: undefined }, tanimAni, 5)
  const eskiAlan = Vk.vakaAlanlari({ collectionId: K_OLAYLAR, kaynak: 'kural:' + ridOf(eski), subj: COKI, yon: 0, onem: 1, ilk: 2, son: 2, pencereBasi: S, pencereSonu: E, t: E + MIN })
  const eskiVaka = kayit(L, U.kerem, 'hf.vaka', eskiAlan, E + MIN, { n: 90 })
  const r11 = madde(11, 'Eski motor: pencere_dk = 0 olan biçim 1 kuralı geçersiz; vaka yok, hf.vaka gösterilmez', { tur: 'eski', kural: eski, kayitlar: [eski, eskiVaka], simdi: E + MIN })
  esit([r11.tanim, r11.yeni.length, r11.vakalar.length], [false, 0, 0], 'madde 11')

  // 12: düzeltme
  const kapatan12 = besle(1792429920000)
  const rid12 = ridOf(kapatan12)
  const duzelt = kayit(L, U.kerem, 'hf.olay.duzelt', { hedef: rid12, gecersiz: true, _t: E + HOUR }, E + HOUR)
  const r12 = madde(12, 'Düzeltme: kapatan olay hf.olay.duzelt ile geri alınır → vaka yeniden açık, merdiven düzeltme anından', { tur: 'motor', kayitlar: [aksam, vaka, kapatan12, duzelt], simdi: E + 2 * HOUR })
  esit([r12.vakalar[0].cozuldu, r12.vakalar[0].yenidenBasla], [false, E + HOUR], 'madde 12a')
  const r12b = madde(12, 'Düzeltme silinince (kayıt yok) yine cozuldu', { tur: 'motor', kayitlar: [aksam, vaka, kapatan12], simdi: E + 2 * HOUR })
  esit(r12b.vakalar[0].cozuldu, true, 'madde 12b')

  // 13: geç değerlendirme
  // E + 25 saatte s penceresi açılmaz; ertesi günün penceresi (E + 24 saatte bitti) olağan olarak önerilir
  const r13 = madde(13, 'Geç değerlendirme: motor E + 25 saatte bakar → s penceresinin vakası yok (yalnız ertesi günün penceresi)', { tur: 'motor', kayitlar: [aksam], simdi: E + 25 * HOUR })
  esit(r13.yeni.map((y) => y.pencere), [[S + DAY, E + DAY]], 'madde 13')

  return {
    aciklama: 'RFC-0032 §8: biçim 2 kural (sabit yerel pencere, çok günlük pencere, kapatan olay, kesintide_ac). Zincir olay.json ile aynı (yardimci/olay.js); koleksiyon Olaylar:Ev. Kayıtlar tek işlemli: inner (OpInner) ve sentetik opId (hash(\'hf/olay-vektor-op/\', inner)). Katalog: çekirdek + yuva.pet.beslenme (ikisi), yuva.pet.kum, yuva.pet.gozlem (yalnız madde 4\'ün başka özne durumu için). tur: pencere (sabitPencere), gun (gun_saati yokken olayın düştüğü pencere), motor (simdi anında motor: yeni öneriler ve var olan vakaların durumu; cozuldu, neden kapatan|kosul, cozen recordId), sira (aynı kayıtlar verilen sıralarla, sonuç aynı), dizi (her adımda yeni öneri sayısı), eski (kural tanımı geçersiz mi ve motor). Misafirin kayıtları C.misafir1\'in yazdığı işlemdir (kayıt katmanındaki REC_DROP denetimi misafir-yazma.json\'da). s = 20745, utc_dk = 180.',
    zincir: O.ZINCIR,
    collectionId: hex(K_OLAYLAR),
    maddeler: jsonla(maddeler)
  }
}

module.exports = { vektorler, calistir, katalog }
