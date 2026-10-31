// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// protocol/vectors/disaster.json üreticisi (RFC-0012 §14). Belirlenimci. Her maddenin sonucu calistir() ile hesaplanır; test aynı
// işlevle dosyadaki girdilerden yeniden hesaplar. Defter durumları ledger-v21 yardımcısının belirlenimci kimlikleriyle
// (core/core/test/yardimci/v21.js) kurulur; zincir dosyada hex olarak durur.
const b4a = require('b4a')
const { ledger: { Ledger, encodeEvent, decodeEvent }, pairs: { PairBook } } = require('@havenfold/core')
const V = require('../../../core/test/helpers/v21')
const T = require('../../derivation')
const M = require('../../message')
const D = require('../../audit')
const S = require('../../status')
const { Depo } = require('../../store')
const { Gonderim } = require('../../limit')
const { Motor } = require('../../engine')
const { bagla } = require('../../simulation')
const Y = require('../../local')
const sodium = require('sodium-native')

const { C, K, hex } = V
const KIMLIK = { kerem: K.kerem, husniye: K.husniye, irem: K.irem, ecem: K.ecem, kutu: K.kutu, isci1: C.isci1, uc1: C.uc1, misafir1: C.misafir1 }
const h = (x) => b4a.from(x, 'hex')
const MIN = 60_000
const SAAT = 3_600_000

// Ana zincir, misafirin REVOKE'u olmadan: misafir1 aktif, uc1 çıkarılmış (aileden çıkarılmış gönderici)
const ZINCIR = (() => {
  const L = new Ledger()
  return V.anaAdimlar(L).slice(0, -1).map((f) => { const e = f(); L.apply(e); return hex(encodeEvent(e)) })
})()
function defter (zincir) {
  const L = new Ledger()
  for (const x of zincir) L.apply(decodeEvent(h(x)))
  return L
}
// Bu kimliğin defterden çiftleri; çıkarılmış kimliğin çifti yoktur
function ciftler (L, me) {
  return new PairBook({ me, ledger: L }).peers().map((p) => ({ id: p.id, pair: p.pair }))
}
// Göndericinin çifti: aileden çıkarılmış olsa da elinde kalan sır (çıkarılmadan önceki defterle)
function gondericiCifti (zincir, kimden, kime) {
  const L = defter(zincir)
  const p = new PairBook({ me: KIMLIK[kimden], ledger: L }).get(hex(KIMLIK[kime].memberId))
  if (!p) throw new Error('NO_PAIR ' + kimden + ' → ' + kime)
  return p.pair
}

// Benzetimde bir aile cihazı: defterdeki çiftleriyle, ortak saatle
function cihaz (L, ad, saat, depo = new Depo()) {
  return new Motor({ meId: KIMLIK[ad].memberId, defter: () => L, ciftler: () => ciftler(L, KIMLIK[ad]), depo, saat })
}
// Atma vektörü için yapay mesaj: mid = u32be(sıra), şifreli metin sabit 40 bayt (depo içeriği açmaz)
function yapay (no, prio, gun) {
  const mid = b4a.alloc(16)
  mid[12] = no >>> 24; mid[13] = (no >>> 16) & 255; mid[14] = (no >>> 8) & 255; mid[15] = no & 255
  return { mid, toTag: b4a.alloc(8), prio, hops: 4, expiresDay: gun + 3, doneHash: b4a.alloc(16), nonce: b4a.alloc(24), ct: b4a.alloc(40, prio) }
}

// Belirlenimci rastgele kaynağı (yalnız vektör): BLAKE2b(tohum ‖ sayaç)
function sabitRastgele (tohum) {
  let n = 0
  return (len) => {
    const out = b4a.alloc(32)
    sodium.crypto_generichash(out, b4a.concat([b4a.from(tohum), b4a.from(String(n++))]))
    return out.subarray(0, len)
  }
}

function calistir (m) {
  if (m.tur === 'turetme') {
    const pair = h(m.pair)
    const key = T.afetKey(pair)
    const ds = T.doneSecret(key, h(m.mid))
    return {
      afetKey: hex(key), etiket: hex(T.etiket(key, h(m.reklamYapan), m.dilim)), toTag: hex(T.toTag(key, h(m.alici), m.gun)),
      afetSeed: hex(T.afetSeed(pair, h(m.kimlik), m.gun)), noisePub: hex(T.anahtarCifti(pair, h(m.kimlik), m.gun).publicKey),
      doneSecret: hex(ds), doneHash: hex(T.doneHash(ds))
    }
  }
  if (m.tur === 'muhur') {
    const pair = h(m.pair)
    const r = M.muhurle({ ...m.girdi, pair, from: h(m.girdi.from), to: h(m.girdi.to), mid: h(m.girdi.mid), nonce: h(m.girdi.nonce) })
    const prio = { ...r.msg, prio: r.msg.prio + 1 }
    const hops = { ...r.msg, hops: r.msg.hops - 1 }
    const ic = M.ac(M.coz(M.Z.AFET_MSG, r.bytes), pair)
    return {
      bytes: hex(r.bytes), ad: hex(M.ad(r.msg)), ct: hex(r.msg.ct), doneSecret: hex(r.doneSecret),
      acilir: !!ic, metin: ic && ic.text, prioDegisince: !!M.ac(prio, pair), hopsDegisince: !!M.ac(hops, pair)
    }
  }
  if (m.tur === 'denetim') {
    const L = defter(m.zincir)
    const me = KIMLIK[m.alici]
    const gorulen = new Map(m.gorulen.map((x) => [x, m.bugun]))
    const r = D.alici({ msg: M.coz(M.Z.AFET_MSG, h(m.bytes)), ciftler: ciftler(L, me), meId: me.memberId, L, bugun: m.bugun, gorulen })
    return r.gecerli ? { gecerli: true, kind: r.ic.kind, from: hex(r.ic.from), text: r.ic.text } : { gecerli: false, neden: r.neden }
  }
  if (m.tur === 'durum') {
    let d = { durum: 'KAPALI', etkinBas: null, elle: false }
    return m.adimlar.map((g) => { d = S.gecis(d, g); return d.durum + (d.soru ? '?' : '') })
  }
  if (m.tur === 'done') {
    const depo = new Depo()
    const msg = M.coz(M.Z.AFET_MSG, h(m.bytes))
    depo.tasi(msg, m.bugun)
    const yanlis = depo.teslimEt(msg.mid, h(m.yanlis), m.bugun)
    const sonraYanlis = depo.tasinan.has(hex(msg.mid))
    const dogru = depo.teslimEt(msg.mid, h(m.dogru), m.bugun)
    return { yanlisTuttu: yanlis, yanlistanSonraDuruyor: sonraYanlis, dogruTuttu: dogru, dogrudanSonraDuruyor: depo.tasinan.has(hex(msg.mid)) }
  }
  if (m.tur === 'esitleme') {
    const L = defter(m.zincir)
    const saat = () => m.an
    const msg = M.coz(M.Z.AFET_MSG, h(m.bytes))
    const t = cihaz(L, m.tasiyici, saat)
    t.depo.tasi(msg, T.gunOf(m.an))
    const komsu = cihaz(L, m.komsu, saat)
    const alici = cihaz(L, m.alici, saat)
    const b1 = bagla(t.oturum(KIMLIK[m.komsu].memberId), komsu.oturum(KIMLIK[m.tasiyici].memberId))
    const b2 = bagla(t.oturum(KIMLIK[m.alici].memberId), alici.oturum(KIMLIK[m.tasiyici].memberId))
    return {
      komsuAldi: komsu.depo.tasinan.has(hex(msg.mid)), komsuBitti: b1.bitti,
      aliciAldi: alici.depo.gelen.map((x) => x.ic.text), aliciBitti: b2.bitti,
      tasiyicidaKaldi: t.depo.tasinan.has(hex(msg.mid)), aliciAlindiGonderdi: alici.depo.giden.size
    }
  }
  if (m.tur === 'atma') {
    const depo = new Depo()
    let no = 0
    for (const [prio, n] of m.doldur) for (let i = 0; i < n; i++) depo.tasi(yapay(++no, prio, m.bugun), m.bugun)
    const atilan = depo.tasi(yapay(++no, m.gelen, m.bugun), m.bugun)
    const kalan = {}
    for (const x of depo.tasinan.values()) kalan[x.m.prio] = (kalan[x.m.prio] ?? 0) + 1
    return { atilan, adet: depo.tasinan.size, kalan }
  }
  if (m.tur === 'gonderim') {
    const g = new Gonderim()
    return m.adimlar.map((a) => {
      const e = g.izinOlay(a.kind, a.alicilar, a.t)
      if (!e) g.kaydetOlay(a.kind, a.alicilar, a.t)
      return e ? e.neden + ' ' + e.bekleMs : 'GECER'
    })
  }
  if (m.tur === 'etiket') {
    const L = defter(m.zincir)
    const reklam = KIMLIK[m.reklamYapan]
    const secili = ciftler(L, reklam).filter((x) => m.ciftler.includes(hex(x.id)))
    const liste = Y.etiketListesi({ ciftler: secili, meId: reklam.memberId, simdi: m.an, rastgele: sabitRastgele(m.tohum) })
    const duyuru = Y.duyuruKodla(liste, m.port)
    const coz = Y.duyuruCoz(duyuru)
    const tara = (x) => {
      const r = Y.eslestir({ liste: coz.liste, ciftler: ciftler(L, KIMLIK[x.tarayan]), simdi: x.an })
      return r ? { eslesti: hex(r.cift.id), dilim: r.dilim } : null
    }
    return { adet: liste.tags.length, slot: liste.slot, duyuru: hex(duyuru), port: coz.port, taramalar: m.taramalar.map(tara) }
  }
  if (m.tur === 'kapi') return m.durumlar.map((x) => Y.kapi(x.bag, x.zarf))
  if (m.tur === 'konum') return m.girdiler.map((x) => M.konumYuvarla(x.kind, x.konum, x.tam))
  throw new Error('TUR ' + m.tur)
}

function vektorler () {
  const maddeler = []
  const madde = (no, aciklama, m) => { m.beklenen = calistir(m); maddeler.push({ no, aciklama, ...m }); return m.beklenen }
  const PAIR = hex(b4a.from(Array.from({ length: 32 }, (_, i) => i + 1)))
  const GUN = 20750 // 24 Ekim 2026
  const AN = GUN * 86_400_000 + 15 * SAAT

  // 1: türetmeler
  madde(1, 'Sabit pair ile afetKey; sabit kimlik, gün ve dilimle etiket, toTag, afetSeed (ve Noise açık anahtarı), doneSecret, doneHash', {
    tur: 'turetme', pair: PAIR, reklamYapan: hex(K.kerem.memberId), alici: hex(K.husniye.memberId), kimlik: hex(K.kerem.memberId),
    mid: '11'.repeat(16), gun: GUN, dilim: T.dilimOf(AN)
  })

  // 2: AFET_MSG
  const girdi = { kind: M.KIND.METIN, text: 'Evdeyiz, iyiyiz. Su var.', at: AN, gun: GUN, from: hex(K.kerem.memberId), to: hex(K.husniye.memberId), mid: '22'.repeat(16), nonce: '33'.repeat(24), battery: 64 }
  const r2 = madde(2, 'Sabit nonce ile AFET_MSG kodlama, AD ve ct; prio değiştirilmiş kopya açılmaz, hops değiştirilmiş kopya açılır', { tur: 'muhur', pair: PAIR, girdi })
  if (!r2.acilir || r2.prioDegisince || !r2.hopsDegisince) throw new Error('madde 2')

  // 3: AFET_TAGS
  const DILIM = 900_000
  const r3 = madde(3, 'AFET_TAGS: 3 çiftli cihaz (Kerem: Hüsniye, İrem, Ecem) → 25 öğe; tarayan (Hüsniye) doğru eşi bulur; bir önceki dilimin etiketi de eşleşir; iki dilim önceki eşleşmez; çifti listede olmayan (misafir) eşleşmez. Yerel ağ duyurusu: AFET_TAGS çerçevesi ‖ u16be port', {
    tur: 'etiket', zincir: ZINCIR, reklamYapan: 'kerem', ciftler: [hex(K.husniye.memberId), hex(K.irem.memberId), hex(K.ecem.memberId)],
    an: AN, tohum: 'afet-vektor-3', port: 47871,
    taramalar: [
      { tarayan: 'husniye', an: AN },
      { tarayan: 'husniye', an: AN + DILIM },
      { tarayan: 'husniye', an: AN + 2 * DILIM },
      { tarayan: 'misafir1', an: AN }
    ]
  })
  if (r3.adet !== 25 || !r3.taramalar[0] || !r3.taramalar[1] || r3.taramalar[2] || r3.taramalar[3]) throw new Error('madde 3 ' + JSON.stringify(r3))

  // 4: alıcı denetimi (gönderici kendi çiftiyle mühürler; alıcı defterine göre denetler)
  const mesaj = (kimden, kime, kind, text, ek = {}) => {
    const pair = gondericiCifti(ek.zincir ?? ZINCIR, kimden, kime)
    return hex(M.muhurle({ pair, from: KIMLIK[kimden].memberId, to: KIMLIK[kime].memberId, kind, text, at: AN, gun: GUN, mid: ek.mid ? h(ek.mid) : b4a.alloc(16, ek.n ?? 1), nonce: b4a.alloc(24, ek.n ?? 1), alarm: ek.alarm, expiresDay: ek.expiresDay }).bytes)
  }
  const den = (aciklama, o) => madde(4, aciklama, { tur: 'denetim', zincir: ZINCIR, bugun: GUN, gorulen: [], ...o })
  // Telefonun UYARI'sı: mühürde UYARI alarmla geçerli biçim; gönderen telefon olduğu için alıcıda atılır
  const r4a = den('Telefondan (İrem) gelen UYARI → atılır', { alici: 'husniye', bytes: mesaj('irem', 'husniye', M.KIND.UYARI, 'deprem', { n: 2, alarm: { kind: 'deprem', level: 5, nearby: [] } }) })
  const r4b = den('Bağlı cihazdan (işçi) gelen UYARI → geçerli', { alici: 'husniye', bytes: mesaj('isci1', 'husniye', M.KIND.UYARI, 'deprem', { n: 3, alarm: { kind: 'deprem', level: 5, nearby: [K.irem.memberId] } }) })
  const r4c = den('Misafirden SOS → geçerli', { alici: 'kerem', bytes: mesaj('misafir1', 'kerem', M.KIND.SOS, 'Çocuklar yanımda, iyiyiz', { n: 4 }) })
  // Aileden çıkarılmış gönderici: uç1 çıkarılmadan önceki defterle çift kurmuştu; alıcının defterinde artık çifti yok
  const oncekiZincir = (() => { const L = new Ledger(); return V.anaAdimlar(L).slice(0, -2).map((f) => { const e = f(); L.apply(e); return hex(encodeEvent(e)) }) })()
  const r4d = den('Aileden çıkarılmış göndericinin (uç1) eski mesajı → atılır', { alici: 'husniye', bytes: mesaj('uc1', 'husniye', M.KIND.UYARI, 'elektrik', { n: 5, zincir: oncekiZincir, alarm: { kind: 'elektrik', level: 0, nearby: [] } }) })
  const tekrar = mesaj('kerem', 'irem', M.KIND.IYIYIM, 'İyiyim', { mid: '44'.repeat(16), n: 6 })
  const r4e = den('Kerem\'den İrem\'e İYİYİM → geçerli', { alici: 'irem', bytes: tekrar })
  const r4f = den('Aynı mid son 7 günde görüldü → atılır (tekrar)', { alici: 'irem', bytes: tekrar, gorulen: ['44'.repeat(16)] })
  const r4g = den('Süresi geçmiş (expiresDay = bugün − 2) → atılır', { alici: 'irem', bytes: mesaj('kerem', 'irem', M.KIND.METIN, 'Eski', { n: 7, expiresDay: GUN - 2 }) })
  const ok = [[r4a, false], [r4b, true], [r4c, true], [r4d, false], [r4e, true], [r4f, false], [r4g, false]]
  for (const [r, e] of ok) if (r.gecerli !== e) throw new Error('madde 4 ' + JSON.stringify(r))

  // 5: teslim bilgisi
  const r5mesaj = M.muhurle({ pair: h(PAIR), from: K.kerem.memberId, to: K.husniye.memberId, kind: M.KIND.METIN, text: 'Neredesiniz?', at: AN, gun: GUN, mid: b4a.alloc(16, 0x55), nonce: b4a.alloc(24, 0x55) })
  const r5 = madde(5, 'Sahte AFET_DONE (yanlış doneSecret) → mesaj silinmez; doğru doneSecret → silinir', {
    tur: 'done', bugun: GUN, bytes: hex(r5mesaj.bytes), yanlis: '66'.repeat(32), dogru: hex(r5mesaj.doneSecret)
  })
  if (r5.yanlisTuttu || !r5.yanlistanSonraDuruyor || !r5.dogruTuttu || r5.dogrudanSonraDuruyor) throw new Error('madde 5')

  // 6: eşitleme, hops = 0
  const r6 = madde(6, 'Eşitleme: hops = 0 mesaj taşıyıcıya (Ecem) yayılmaz ama alıcı (Hüsniye) çeker, açar ve ALINDI mühürler; teslim bilgisi taşıyıcıdan siler', {
    tur: 'esitleme', zincir: ZINCIR, an: AN, tasiyici: 'irem', komsu: 'ecem', alici: 'husniye',
    bytes: hex(M.muhurle({ pair: gondericiCifti(ZINCIR, 'kerem', 'husniye'), from: K.kerem.memberId, to: K.husniye.memberId, kind: M.KIND.METIN, text: 'Okuldayım, geliyorum', at: AN, gun: GUN, hops: 0, mid: b4a.alloc(16, 0x66), nonce: b4a.alloc(24, 0x66) }).bytes)
  })
  if (r6.komsuAldi || r6.aliciAldi[0] !== 'Okuldayım, geliyorum' || r6.tasiyicidaKaldi) throw new Error('madde 6 ' + JSON.stringify(r6))

  // 7: atma sırası
  const r7a = madde(7, 'Atma sırası: dolu depoya (1000 mesaj) SOS gelir → en eski METİN atılır', {
    tur: 'atma', bugun: GUN, doldur: [[M.PRIO[M.KIND.SOS], 100], [M.PRIO[M.KIND.METIN], 400], [M.PRIO[M.KIND.IYIYIM], 300], [M.PRIO[M.KIND.UYARI], 200]], gelen: M.PRIO[M.KIND.SOS]
  })
  if (r7a.atilan.length !== 1 || r7a.atilan[0] !== hex(yapay(101, 3, GUN).mid)) throw new Error('madde 7 ' + JSON.stringify(r7a))
  const r7b = madde(7, 'Atma sırası: depo yalnız SOS\'la doluysa yeni SOS gelince en eski SOS atılır', {
    tur: 'atma', bugun: GUN, doldur: [[M.PRIO[M.KIND.SOS], 1000]], gelen: M.PRIO[M.KIND.SOS]
  })
  if (r7b.atilan[0] !== hex(yapay(1, 0, GUN).mid)) throw new Error('madde 7b')

  // 8: durum makinesi
  const T0 = AN
  const r8 = madde(8, 'Durum makinesi: internet 31 dk yok → HAZIR; deprem UYARI + 2 dk internet yok → ETKİN; 72 saat → HAZIR; internet 10 dk döndü, bekleyen yok → KAPALI; internet döndü ama bekleyen var → durum korunur', {
    tur: 'durum',
    adimlar: [
      { simdi: T0, internetYok: T0, internetVar: null, isaret: null, kullanici: null, yazdi: false, yerelMesaj: false, dugum: null, bekleyen: 0, surdur: null },
      { simdi: T0 + 29 * MIN, internetYok: T0, internetVar: null, isaret: null, kullanici: null, yazdi: false, yerelMesaj: false, dugum: null, bekleyen: 0, surdur: null },
      { simdi: T0 + 31 * MIN, internetYok: T0, internetVar: null, isaret: null, kullanici: null, yazdi: false, yerelMesaj: false, dugum: null, bekleyen: 0, surdur: null },
      { simdi: T0 + 40 * MIN, internetYok: T0, internetVar: null, isaret: T0 + 39 * MIN, kullanici: null, yazdi: false, yerelMesaj: false, dugum: null, bekleyen: 1, surdur: null },
      { simdi: T0 + 40 * MIN + 72 * SAAT, internetYok: T0, internetVar: null, isaret: null, kullanici: null, yazdi: false, yerelMesaj: false, dugum: null, bekleyen: 1, surdur: null },
      { simdi: T0 + 80 * SAAT, internetYok: null, internetVar: T0 + 79 * SAAT, isaret: null, kullanici: null, yazdi: false, yerelMesaj: false, dugum: null, bekleyen: 1, surdur: null },
      { simdi: T0 + 81 * SAAT, internetYok: null, internetVar: T0 + 79 * SAAT, isaret: null, kullanici: null, yazdi: false, yerelMesaj: false, dugum: null, bekleyen: 0, surdur: null }
    ]
  })
  if (r8.join() !== 'KAPALI,KAPALI,HAZIR,ETKIN,HAZIR,HAZIR,KAPALI') throw new Error('madde 8 ' + r8)

  // 9: bağ türü kapısı
  const r9 = madde(9, 'Bağ türü kapısı: Bluetooth oturumunda LEDGER_REQ → DISASTER_TYPE_FORBIDDEN (oturum kapanır); yerel ağ oturumunda aynı zarf → geçerli; Bluetooth\'ta HELLO, PING ve 0xB0–0xB5 geçer', {
    tur: 'kapi',
    durumlar: [
      { bag: 'bluetooth', zarf: 0x10 }, { bag: 'yerel', zarf: 0x10 }, { bag: 'bluetooth', zarf: 0x01 }, { bag: 'bluetooth', zarf: 0x7e },
      { bag: 'bluetooth', zarf: 0xb0 }, { bag: 'bluetooth', zarf: 0xb5 }, { bag: 'wifi-direct', zarf: 0x81 }, { bag: 'multipeer', zarf: 0xb6 }
    ]
  })
  if (r9.join() !== 'DISASTER_TYPE_FORBIDDEN,,,,,,DISASTER_TYPE_FORBIDDEN,DISASTER_TYPE_FORBIDDEN') throw new Error('madde 9 ' + r9)

  // 10: konum yuvarlama
  const r10 = madde(10, 'Konum (açıklama 1 madde 3): İYİYİM için latE5 = 4101234 → 4101000, lonE5 = 2898765 → 2899000; SOS için değişmez; "tam konum" seçilirse yuvarlanmaz', {
    tur: 'konum',
    girdiler: [
      { kind: M.KIND.IYIYIM, konum: { latE5: 4101234, lonE5: 2898765, accM: 12, at: AN } },
      { kind: M.KIND.SOS, konum: { latE5: 4101234, lonE5: 2898765, accM: 12, at: AN } },
      { kind: M.KIND.METIN, konum: { latE5: 4101234, lonE5: 2898765, accM: 12, at: AN }, tam: true }
    ]
  })
  if (r10[0].latE5 !== 4101000 || r10[0].lonE5 !== 2899000 || r10[1].latE5 !== 4101234) throw new Error('madde 10')

  // 11: gönderim sınırları
  const kime = hex(K.husniye.memberId)
  const baska = hex(K.irem.memberId)
  const ucuncu = hex(K.ecem.memberId)
  const r11 = madde(11, 'Gönderim sınırları olay başına (açıklama 1 madde 1): 15 sn içinde ikinci METİN reddedilir; üç alıcılı SOS tek olaydır, hepsine gider; 30 sn sonra yeni SOS reddedilir; İYİYİM alıcı başına 5 dk; ALINDI sınırsız', {
    tur: 'gonderim',
    adimlar: [
      { kind: M.KIND.METIN, alicilar: [kime, baska], t: AN },
      { kind: M.KIND.METIN, alicilar: [kime], t: AN + 10_000 },
      { kind: M.KIND.METIN, alicilar: [baska], t: AN + 15_000 },
      { kind: M.KIND.SOS, alicilar: [kime, baska, ucuncu], t: AN },
      { kind: M.KIND.SOS, alicilar: [ucuncu], t: AN + 30_000 },
      { kind: M.KIND.SOS, alicilar: [kime, baska, ucuncu], t: AN + MIN },
      { kind: M.KIND.IYIYIM, alicilar: [kime, baska], t: AN },
      { kind: M.KIND.IYIYIM, alicilar: [ucuncu], t: AN + 1000 },
      { kind: M.KIND.IYIYIM, alicilar: [kime, ucuncu], t: AN + 4 * MIN },
      { kind: M.KIND.UYARI, alicilar: [kime, baska], t: AN },
      { kind: M.KIND.UYARI, alicilar: [kime], t: AN + 59_000 },
      { kind: M.KIND.ALINDI, alicilar: [kime], t: AN },
      { kind: M.KIND.ALINDI, alicilar: [kime], t: AN }
    ]
  })
  if (r11[1] !== 'DISASTER_SEND_LIMIT 5000' || r11[2] !== 'GECER' || r11[3] !== 'GECER' || r11[4] !== 'DISASTER_SEND_LIMIT 30000' || r11[5] !== 'GECER') throw new Error('madde 11 ' + r11)

  return {
    aciklama: 'RFC-0012 §14: afet modu. Türetmeler uzunluk önekli (deriveLP, hashLP; RFC-0027 §8 b). Defter: ledger-v21 ana zinciri, son REVOKE olmadan (misafir1 aktif, uc1 çıkarılmış); kimlikler core/core/test/yardimci/v21.js belirlenimci tohumlarıyla. Adım 1 maddeleri: 1, 2, 4, 8, 10; adım 2: 5, 6, 7, 11 (eşitleme benzetimli bağla); adım 3: 3, 9. Madde 3’te dolgu ve karıştırma için belirlenimci kaynak: BLAKE2b-256(tohum ‖ ondalık sayaç), ilk n bayt; gerçek cihaz rastgele bayt kullanır.',
    zincir: ZINCIR,
    maddeler
  }
}

module.exports = { vektorler, calistir, ZINCIR, KIMLIK, defter, ciftler, gondericiCifti, cihaz, yapay, sabitRastgele }
