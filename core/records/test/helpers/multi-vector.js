// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// protocol/vectors/multi-app-v2.json üreticisi (RFC-0017 §14). Belirlenimci: sabit tohumlar, sabit ts, Ed25519.
//
// Zincirler ledger-v21.json ana zincirinin üstüne kurulur. Durum: zincirin ilk `onek` olayı uygulanır, sonra `olay`
// ya `hata` ile reddedilir ya da geçerlidir. `denetim` alanları o andaki defterden beklenen değerlerdir; üretici
// bunları elle yazılmış beklentilerle karşılaştırır.
const b4a = require('b4a')
const {
  ledger: { Ledger, T, encodeEvent, decodeEvent, prekeyBody, eventHash },
  identity: { createIdentity }, yerelKanal: Y, pair: { pairSecret }, zarf: Zr
} = require('@havenfold/core')
const Kz = require('../../cutoff')
const { Replika } = require('../../replica')
const V = require('../../../core/test/helpers/v21')

const { K, TS0, olay, ekle, koleksiyon, anaAdimlar, uye, K_KISISEL_IREM, K_TUM_AILE } = V
const hex = (b) => b4a.toString(b, 'hex')

// Ek kimlikler: kişi + uygulama
const E = {}
for (const ad of ['keremDefter', 'keremTablet', 'keremU3', 'keremU4', 'keremU5', 'keremDefter2', 'iremDefter', 'ecemDefter', 'u5a', 'u5b', 'u5c', 'u5d']) {
  E[ad] = Object.assign(createIdentity({ seed: 'coklu-uygulama/' + ad, platform: 'test' }), { ad })
}

const seviye22 = (L) => olay(L, T.PROTOCOL_LEVEL, { level: '2.2' }, [K.kerem])
const attach = (L, ek, kisi, ek2 = {}, imz = [kisi]) => olay(L, T.APP_ATTACH, {
  deviceCert: ek.deviceCert, personId: kisi.memberId, appId: 'yuva-defteri', sameDevice: true, replaces: null,
  ceremonyTranscriptHash: b4a.alloc(32, 7), ...ek2
}, [ek, ...imz])
const primary = (L, kisi, yeni, oldSigned, imz) => olay(L, T.APP_PRIMARY, { personId: kisi.memberId, newPrimaryId: yeni.memberId, oldSigned }, imz)

function anaOlaylar () {
  const L = new Ledger()
  return anaAdimlar(L).map((f) => { const e = f(); L.apply(e); return e })
}
const ANA = anaOlaylar()
const N = ANA.length

function zincir (kurucular, taban = ANA) {
  const L = new Ledger()
  for (const e of taban) L.apply(decodeEvent(encodeEvent(e)))
  const yeni = []
  for (const f of kurucular) { const e = f(L); L.apply(e); yeni.push(e) }
  return { L, olaylar: [...taban, ...yeni] }
}

function kur (olaylar, onek) {
  const L = new Ledger()
  for (const e of olaylar.slice(0, onek)) L.apply(decodeEvent(encodeEvent(e)))
  return L
}
const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
function bekle (no, gercek, beklenen) {
  if (JSON.stringify(gercek) !== JSON.stringify(beklenen)) throw new Error(`coklu ${no}: ${JSON.stringify(gercek)} ≠ ${JSON.stringify(beklenen)}`)
  return beklenen
}

// Ortak zincir: düzey 2.2, ek kimlikler, kendi PREKEY'i, SET_ROLE'ü izleyen ek kimlik, ek kimliğin kişisel koleksiyon değişikliği
const COKLU = zincir([
  seviye22, // N
  (L) => attach(L, E.keremDefter, K.kerem), // N+1 — §14 madde 1: başka ebeveyn onayı yok
  (L) => attach(L, E.keremTablet, K.kerem, { appId: 'yuva-hat', sameDevice: false }), // N+2
  (L) => olay(L, T.PREKEY, prekeyBody(E.keremDefter, b4a.alloc(32, 3), TS0 + 7), [E.keremDefter]), // N+3 — madde 2
  (L) => attach(L, E.iremDefter, K.irem), // N+4
  (L) => attach(L, E.ecemDefter, K.ecem), // N+5
  (L) => olay(L, T.SET_ROLE, { memberId: K.ecem.memberId, role: 'yetiskin' }, [K.kerem, K.husniye, K.ecem]), // N+6 — madde 9
  (L) => koleksiyon(L, [E.iremDefter], { collectionId: K_KISISEL_IREM, name: 'Kişisel 2', kind: 'kisisel', readers: [uye(K.irem)], writers: [uye(K.irem)], taskAccess: false }) // N+7 — madde 10
])
const C0 = COKLU.olaylar

function vektorler () {
  const zincirler = { coklu: C0.map((e) => hex(encodeEvent(e))) }
  const durumlar = []
  const gecersiz = (no, aciklama, ad, olaylar, onek, yap, hata) => {
    const L = kur(olaylar, onek)
    const e = yap(L)
    bekle(no, hataOf(() => L.apply(e)), hata)
    durumlar.push({ no, aciklama, zincir: ad, onek, olay: hex(encodeEvent(e)), hata })
  }
  const Lc = COKLU.L
  const id = (k) => hex(k.memberId)

  // 1, 2, 9, 10: ortak zincirin kendisi geçerli; kişiler ve roller
  const ilk = {
    kisiSayisi: bekle(1, Lc.personIds().length, 4),
    kimlikSayisi: bekle(1, Lc.phoneIds().length, 8),
    keremEkler: bekle(1, Lc.extraIdsOf(id(K.kerem)).sort(), [id(E.keremDefter), id(E.keremTablet)].sort()),
    ecemDefterRol: bekle(9, Lc.member(E.ecemDefter.memberId).role, 'yetiskin'),
    keremDefterPrekey: bekle(2, Lc.member(E.keremDefter.memberId).prekeys.length, 1)
  }
  durumlar.push({ no: 1, aciklama: 'APP_ATTACH: yeni ek kimlik + kişinin ana kimliği; başka ebeveyn onayı gerekmez', zincir: 'coklu', onek: N + 1, olay: zincirler.coklu[N + 1], gecerli: true })
  durumlar.push({ no: 2, aciklama: 'Ek kimlik kendi PREKEY\'ini imzalar', zincir: 'coklu', onek: N + 3, olay: zincirler.coklu[N + 3], gecerli: true })
  gecersiz(2, 'Ek kimlik bir ADD_MEMBER\'ı imzalar', 'coklu', C0, C0.length, (L) => ekle(L, K.u9, 'yetiskin', [K.kerem, K.husniye, E.keremDefter]), 'SECONDARY_IDENTITY_CANNOT_VOTE')
  gecersiz(1, 'Düzey 2.2 yokken APP_ATTACH', 'coklu', C0, N, (L) => attach(L, E.keremDefter, K.kerem), 'LEVEL_TOO_LOW')
  gecersiz(1, 'Kişinin ana kimliği imzalamadan APP_ATTACH', 'coklu', C0, N + 1, (L) => attach(L, E.keremDefter, K.kerem, {}, [K.husniye]), 'NO_PERSON_APPROVAL')
  gecersiz(1, 'Kutu kişi değildir', 'coklu', C0, N + 1, (L) => attach(L, E.keremDefter, K.kutu, {}, [K.kerem]), 'NO_PERSON')
  durumlar.push({ no: 9, aciklama: 'SET_ROLE ana kimliğe; ek kimliğin rolü de değişir', zincir: 'coklu', onek: N + 6, olay: zincirler.coklu[N + 6], gecerli: true })
  gecersiz(9, 'SET_ROLE ek kimliğe uygulanamaz', 'coklu', C0, C0.length, (L) => olay(L, T.SET_ROLE, { memberId: E.ecemDefter.memberId, role: 'cocuk' }, [K.kerem, K.husniye, K.ecem]), 'INVALID_ROLE')
  durumlar.push({ no: 10, aciklama: 'Ek kimlik kişinin kişisel koleksiyonunu değiştirir', zincir: 'coklu', onek: N + 7, olay: zincirler.coklu[N + 7], gecerli: true })
  gecersiz(10, 'Başka kişinin ek kimliği kişisel koleksiyonu değiştiremez', 'coklu', C0, C0.length, (L) => koleksiyon(L, [E.keremDefter], { collectionId: K_KISISEL_IREM, name: 'x', kind: 'kisisel', readers: [uye(K.irem)], writers: [uye(K.irem)], taskAccess: false }), 'PERSONAL_COLLECTION')

  // 3: 8 kişilik ailede bir kişinin 4 ek kimliği; kişi sayısı 8 kalır, 9. kişi yine MEMBER_LIMIT
  const sekiz = zincir([
    (L) => ekle(L, K.u5, 'yetiskin', [K.kerem, K.husniye, K.irem]),
    (L) => ekle(L, K.u6, 'yetiskin', [K.kerem, K.husniye, K.irem]),
    (L) => ekle(L, K.u7, 'yetiskin', [K.kerem, K.husniye, K.irem, K.u5]),
    (L) => ekle(L, K.u8, 'yetiskin', [K.kerem, K.husniye, K.irem, K.u5]),
    (L) => attach(L, E.u5a, K.u5), (L) => attach(L, E.u5b, K.u5), (L) => attach(L, E.u5c, K.u5), (L) => attach(L, E.u5d, K.u5)
  ], C0)
  zincirler.sekiz = sekiz.olaylar.slice(C0.length).map((e) => hex(encodeEvent(e)))
  const sekizDurum = { kisiSayisi: bekle(3, sekiz.L.personIds().length, 8), kimlikSayisi: bekle(3, sekiz.L.phoneIds().length, 16) }
  gecersiz(3, '9. kişi', 'sekiz', sekiz.olaylar, sekiz.olaylar.length, (L) => ekle(L, K.u9, 'yetiskin', [K.kerem, K.husniye, K.irem, K.u5, K.u6]), 'MEMBER_LIMIT')

  // 5: 5. ek kimlik → sınır; aynı uygulamanın yeniden kurulumu (replaces) → geçerli
  const dort = zincir([(L) => attach(L, E.keremU3, K.kerem, { appId: 'yuva-anilar' }), (L) => attach(L, E.keremU4, K.kerem, { appId: 'yuva-kamera' })], C0)
  zincirler.dort = dort.olaylar.slice(C0.length).map((e) => hex(encodeEvent(e)))
  gecersiz(5, '5. ek kimlik', 'dort', dort.olaylar, dort.olaylar.length, (L) => attach(L, E.keremU5, K.kerem, { appId: 'yuva-pati' }), 'SECONDARY_IDENTITY_LIMIT')
  gecersiz(5, 'replaces başka uygulamanın kimliği', 'dort', dort.olaylar, dort.olaylar.length, (L) => attach(L, E.keremDefter2, K.kerem, { appId: 'yuva-pati', replaces: E.keremDefter.memberId }), 'CANNOT_REPLACE')
  const yerine = zincir([(L) => attach(L, E.keremDefter2, K.kerem, { replaces: E.keremDefter.memberId })], dort.olaylar)
  durumlar.push({ no: 5, aciklama: 'Aynı uygulama yeniden kurulur: replaces ile, sınır dolu olsa da geçerli', zincir: 'dort', onek: dort.olaylar.length, olay: hex(encodeEvent(yerine.olaylar.at(-1))), gecerli: true })
  const yerineDurum = {
    eskiAktif: bekle(5, yerine.L.member(E.keremDefter.memberId).active, false),
    rotatedTo: bekle(5, yerine.L.member(E.keremDefter.memberId).rotatedTo, id(E.keremDefter2)),
    ekSayisi: bekle(5, yerine.L.extraIdsOf(id(K.kerem)).length, 4)
  }

  // 6: ana kimliğe REMOVE_MEMBER → ek kimlikler de pasif
  const at = zincir([(L) => olay(L, T.REMOVE_MEMBER, { memberId: K.irem.memberId, reason: 'test', wipe: true }, [K.kerem, K.husniye])], C0)
  zincirler.at = at.olaylar.slice(C0.length).map((e) => hex(encodeEvent(e)))
  const atDurum = {
    iremDefterAktif: bekle(6, at.L.member(E.iremDefter.memberId).active, false),
    iremDefterWipe: bekle(6, at.L.member(E.iremDefter.memberId).wipe, true),
    kisiSayisi: bekle(6, at.L.personIds().length, 3)
  }

  // 7: ana kimliğin imzasız ROTATE_DEVICE'ı (ebeveyn: 72 saat bekleme, sonra ACTIVATE) → aynı gruptaki ek kimlik
  // pasif ve silme emri; başka cihazdaki (sameDevice = false) kalır
  const don = zincir([
    (L) => olay(L, T.ROTATE_DEVICE, { oldMemberId: K.kerem.memberId, newDeviceCert: K.yeniKerem.deviceCert, ceremonyTranscriptHash: b4a.alloc(32, 7) }, [K.yeniKerem, K.husniye, K.irem, K.ecem]),
    (L) => olay(L, T.ACTIVATE_MEMBER, { memberId: K.yeniKerem.memberId }, [K.husniye])
  ], C0)
  zincirler.don = don.olaylar.slice(C0.length).map((e) => hex(encodeEvent(e)))
  const donDurum = {
    keremDefterAktif: bekle(7, don.L.member(E.keremDefter.memberId).active, false),
    keremDefterWipe: bekle(7, don.L.member(E.keremDefter.memberId).wipe, true),
    keremTabletAktif: bekle(7, don.L.member(E.keremTablet.memberId).active, true),
    anaKimlik: bekle(7, don.L.persons.get(id(K.kerem)).primary, id(K.yeniKerem))
  }

  // 8: APP_PRIMARY — eski imzalı hemen; imzasız 72 saat bekler ve veto edilebilir; ebeveyn hızlandırır
  const hemen = zincir([(L) => primary(L, K.irem, E.iremDefter, true, [E.iremDefter, K.irem])], C0)
  const bekleyen = zincir([(L) => primary(L, K.kerem, E.keremTablet, false, [E.keremTablet])], C0)
  const veto = zincir([(L) => olay(L, T.REMOVE_MEMBER, { memberId: E.keremTablet.memberId, reason: 'veto', wipe: false }, [K.kerem])], bekleyen.olaylar)
  const etkin = zincir([(L) => olay(L, T.ACTIVATE_MEMBER, { memberId: E.keremTablet.memberId }, [E.keremTablet])], bekleyen.olaylar)
  const hizli = zincir([(L) => primary(L, K.kerem, E.keremTablet, false, [E.keremTablet, K.husniye])], C0)
  zincirler.hemen = hemen.olaylar.slice(C0.length).map((e) => hex(encodeEvent(e)))
  zincirler.bekleyen = bekleyen.olaylar.slice(C0.length).map((e) => hex(encodeEvent(e)))
  zincirler.veto = veto.olaylar.slice(bekleyen.olaylar.length).map((e) => hex(encodeEvent(e)))
  zincirler.etkin = etkin.olaylar.slice(bekleyen.olaylar.length).map((e) => hex(encodeEvent(e)))
  zincirler.hizli = hizli.olaylar.slice(C0.length).map((e) => hex(encodeEvent(e)))
  const birincilDurum = {
    hemenAna: bekle(8, hemen.L.persons.get(id(K.irem)).primary, id(E.iremDefter)),
    hemenEskiAktif: bekle(8, hemen.L.member(K.irem.memberId).active, false),
    uyeEskiCozumu: bekle(8, hemen.L.resolveMember(id(K.irem)), id(E.iremDefter)),
    hemenKisiSayisi: bekle(8, hemen.L.personIds().length, 4),
    bekleyenAna: bekle(8, bekleyen.L.persons.get(id(K.kerem)).primary, id(K.kerem)),
    bekleyenBayrak: bekle(8, !!bekleyen.L.member(E.keremTablet.memberId).pendingPrimary, true),
    vetoSonrasiTabletAktif: bekle(8, veto.L.member(E.keremTablet.memberId).active, false),
    etkinAna: bekle(8, etkin.L.persons.get(id(K.kerem)).primary, id(E.keremTablet)),
    etkinRol: bekle(8, etkin.L.member(E.keremTablet.memberId).role, 'ebeveyn'),
    hizliAna: bekle(8, hizli.L.persons.get(id(K.kerem)).primary, id(E.keremTablet))
  }
  gecersiz(8, 'oldSigned imzalarla tutarsız (kip, RFC-0020 a)', 'coklu', C0, C0.length, (L) => primary(L, K.kerem, E.keremTablet, true, [E.keremTablet]), 'MODE_MISMATCH')
  gecersiz(8, 'Başka kişinin ek kimliği ana kimlik olamaz', 'coklu', C0, C0.length, (L) => primary(L, K.kerem, E.iremDefter, false, [E.iremDefter]), 'NO_TARGET')

  // 11: ek kimliğin, aynı kişinin başka bir kimliği için yayımladığı kesim → atılır (kayıt katmanı)
  const kesimZ = zincir([(L) => olay(L, T.LEAVE, { memberId: E.iremDefter.memberId }, [E.iremDefter])], C0)
  zincirler.kesim = kesimZ.olaylar.slice(C0.length).map((e) => hex(encodeEvent(e)))
  const evSeq = C0.length
  const [kesimMsg] = Kz.makeCutoff({ familyId: kesimZ.L.familyId, collectionId: K_TUM_AILE, authorId: E.iremDefter.memberId, eventSeq: evSeq, eventHash: kesimZ.L.hashAt(evSeq), opIds: [], issuer: K.irem })
  const [kesimKerem] = Kz.makeCutoff({ familyId: kesimZ.L.familyId, collectionId: K_TUM_AILE, authorId: E.iremDefter.memberId, eventSeq: evSeq, eventHash: kesimZ.L.hashAt(evSeq), opIds: [], issuer: K.kerem })
  const R = new Replika({ ledger: kesimZ.L, me: K.husniye, now: () => TS0, otomatikAnahtar: false })
  R.sync()
  const kesim = {
    aciklama: 'İrem\'in ek kimliği Tüm Aile\'den LEAVE ile çıkar; İrem\'in ana kimliğinin yayımladığı kesim atılır, Kerem\'inki kabul edilir',
    zincir: 'kesim',
    ayniKisi: hex(kesimMsg),
    baskaKisi: hex(kesimKerem),
    ayniKisiSonuc: bekle(11, R.receiveCutoff(kesimMsg).code, 'CUTOFF_UNAUTHORIZED'),
    baskaKisiSonuc: bekle(11, R.receiveCutoff(kesimKerem).status, 'tamam')
  }

  // 12: yerel kanal eşleşmesi ve APP_LOCAL_SYNC
  const Lp = kur(C0, C0.length)
  const yeni = new Y.PairNew({ me: E.keremU3, appId: 'yuva-anilar', now: () => TS0, nonce: b4a.alloc(32, 0x12) })
  const istek = yeni.request()
  const eski = new Y.PairOld({ me: K.kerem, ledger: Lp, now: () => TS0 })
  const tamam = eski.answer(istek, { approved: true, ts: TS0 + 999 })
  const { event } = yeni.accept(tamam)
  const L2 = kur(C0, C0.length)
  L2.apply(event)
  const pair = pairSecret({ myUdaSecret: K.kerem.uda.secretKey, theirUdaPub: E.keremU3.uda.publicKey, myId: K.kerem.memberId, theirId: E.keremU3.memberId, familyId: L2.familyId, anchorHash: L2.anchorFor(K.kerem.memberId, E.keremU3.memberId) })
  const sync = Y.sealLocalSyncVektor({ ledger: L2, pair, me: K.kerem, peerId: E.keremU3.memberId, type: 0x11, body: b4a.from('defter'), id: b4a.alloc(16, 0x21), nonce: b4a.alloc(24, 0x31) })
  const yerel = {
    aciklama: 'Yerel kanal: APP_PAIR_REQ → biyometri onayı → APP_PAIR_OK → yeni uygulama imzalar. APP_PAIR_OK ağdan gelirse atılır. APP_LOCAL_SYNC iki kimliğin çift sırrıyla (ctrl) mühürlü.',
    nonce: hex(b4a.alloc(32, 0x12)),
    istek: hex(istek),
    cevap: hex(tamam),
    olay: hex(encodeEvent(event)),
    olayOzeti: hex(eventHash(event)),
    transkript: hex(Y.transcriptOf(b4a.alloc(32, 0x12), E.keremU3.deviceCert, 'yuva-anilar')),
    agdanOk: bekle(12, Y.acceptOn(Y.Z.APP_PAIR_OK, 'ag'), false),
    agdanIstek: bekle(12, Y.acceptOn(Y.Z.APP_PAIR_REQ, 'ag'), false),
    yereldenOk: bekle(12, Y.acceptOn(Y.Z.APP_PAIR_OK, 'yerel'), true),
    yerelEsitleme: { tur: 0x11, govde: hex(b4a.from('defter')), zarfId: hex(b4a.alloc(16, 0x21)), nonce: hex(b4a.alloc(24, 0x31)), muhurlu: hex(sync) },
    // Oturum süzgeci (RFC-0003 §6.1, tek giriş noktası giris.gelenZarf): ben, karşı, tür, gelen zarf kabul edilir mi
    oturumSuzgeci: [
      ['uye', 'uye', 0xe8, false], ['uye', 'uye', 0xe9, false], ['uye', 'uye', 0xea, true], ['uye', 'cihaz', 0x81, true],
      ['uye', 'misafir', 0x81, false], ['uye', 'misafir', 0x9a, false], ['misafir', 'uye', 0x9a, true], ['uye', 'cihaz', 0x98, false],
      ['cihaz', 'uye', 0x98, true], ['cihaz', 'cihaz', 0x81, false], ['misafir', 'cihaz', 0x01, false]
    ].map(([ben, karsi, tur, izin]) => ({ ben, karsi, tur, izin: bekle(12, Zr.typeAllowed(ben, karsi, tur, 'gelen'), izin) }))
  }

  return {
    aciklama: 'RFC-0017 §14: aynı ailede birden çok uygulama (defter v2.2). Zincirler ledger-v21.json ana zincirinin (21 olay) üstüne kurulur: `coklu` onun devamıdır; diğerleri `coklu`nun (5\'in yerine geçmesi ve 8\'in veto/etkinleşmesi kendi tabanlarının) devamıdır. Kimlikler createIdentity({seed: "defter-vektor/<ad>"}) (üyeler) ve "coklu-uygulama/<ad>" (ek kimlikler). Madde 3\'ün ekip kısmı ve madde 4 (kutusuz ekip) RFC-0005\'e bağlıdır; ertelendi.',
    zincirler,
    durumlar,
    denetimler: { ilk, sekiz: sekizDurum, yerine: yerineDurum, at: atDurum, don: donDurum, birincil: birincilDurum },
    kesim,
    yerel,
    ertelenen: [{ no: 3, aciklama: '32 kişilik ekipte 4 ek kimlik (RFC-0005)' }, { no: 4, aciklama: 'Kutusuz ekipte 8 kişi ve ek kimlikleri; 9. kişi BOX_REQUIRED (RFC-0005)' }]
  }
}

module.exports = { vektorler, E, ANA, N, C0 }
