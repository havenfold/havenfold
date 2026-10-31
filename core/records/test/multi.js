// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
const test = require('brittle')
const b4a = require('b4a')
const { ledger: { Ledger, T, decodeEvent, encodeEvent }, yerelKanal: Y, pair: { pairSecret } } = require('@havenfold/core')
const { vektorler, E, C0, N } = require('./helpers/multi-vector')
const { replika, teslim, K, K_TUM_AILE, K_KISISEL_IREM, hex, olay, koleksiyon, uye, TS0 } = require('./helpers/family')
const VC = require('../../../protocol/vectors/multi-app-v2.json')

const coz = (h) => decodeEvent(b4a.from(h, 'hex'))
const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const ANA = require('../../../protocol/vectors/ledger-v21-v2.json').zincirler.ana

function zincir (...parcalar) {
  const L = new Ledger()
  for (const o of ANA) L.apply(coz(o.olay))
  for (const p of parcalar) for (const h of p) L.apply(coz(h))
  return L
}
const baslangic = (ad) => ({ coklu: [], sekiz: VC.zincirler.coklu.slice(N), dort: VC.zincirler.coklu.slice(N) }[ad])

test('vektörler: multi-app.json üretici aynı dosyayı verir', (t) => {
  t.alike(JSON.parse(JSON.stringify(vektorler())), VC)
})

test('vektörler: zincirler ve durumlar (1–3, 5, 8–10)', (t) => {
  const nolar = new Set(VC.durumlar.map((d) => d.no))
  for (const n of [1, 2, 3, 5, 8, 9, 10]) t.ok(nolar.has(n), 'durum ' + n)
  t.is(VC.zincirler.coklu.length, ANA.length + 8)
  for (const d of VC.durumlar) {
    const tam = d.zincir === 'coklu' ? VC.zincirler.coklu.slice(ANA.length) : [...baslangic(d.zincir), ...VC.zincirler[d.zincir]]
    const L = zincir()
    for (const h of tam.slice(0, d.onek - ANA.length)) L.apply(coz(h))
    if (d.gecerli) t.execution(() => L.apply(coz(d.olay)), d.aciklama)
    else t.is(hataOf(() => L.apply(coz(d.olay))), d.hata, d.aciklama)
  }
})

test('vektörler: denetimler (kişi sayısı, roller, çıkarma, cihaz değişimi, ana kimlik)', (t) => {
  const c = VC.zincirler.coklu.slice(ANA.length)
  const id = (k) => hex(k.memberId)
  const L = zincir(c)
  t.is(L.personIds().length, VC.denetimler.ilk.kisiSayisi)
  t.is(L.phoneIds().length, VC.denetimler.ilk.kimlikSayisi)
  t.is(L.member(E.ecemDefter.memberId).role, 'yetiskin')
  const sekiz = zincir(c, VC.zincirler.sekiz)
  t.is(sekiz.personIds().length, 8)
  t.is(sekiz.phoneIds().length, 16)
  const at = zincir(c, VC.zincirler.at)
  t.absent(at.member(E.iremDefter.memberId).active)
  t.ok(at.member(E.iremDefter.memberId).wipe)
  const don = zincir(c, VC.zincirler.don)
  t.absent(don.member(E.keremDefter.memberId).active, 'aynı gruptaki ek kimlik')
  t.ok(don.member(E.keremDefter.memberId).wipe)
  t.ok(don.member(E.keremTablet.memberId).active, 'başka cihazdaki ek kimlik kalır')
  t.is(don.persons.get(id(K.kerem)).primary, id(K.yeniKerem))
  t.is(don.personIdOf(id(K.yeniKerem)), id(K.kerem), 'kişi kimliği ilk ana kimliğin rootId\'si')
  const hemen = zincir(c, VC.zincirler.hemen)
  t.is(hemen.resolveMember(id(K.irem)), id(E.iremDefter), 'uye:<eski ana kimlik> yeni ana kimliğe çözülür')
  const bekleyen = zincir(c, VC.zincirler.bekleyen)
  t.is(bekleyen.persons.get(id(K.kerem)).primary, id(K.kerem))
  const veto = zincir(c, VC.zincirler.bekleyen, VC.zincirler.veto)
  t.absent(veto.member(E.keremTablet.memberId).active)
  const etkin = zincir(c, VC.zincirler.bekleyen, VC.zincirler.etkin)
  t.is(etkin.persons.get(id(K.kerem)).primary, id(E.keremTablet))
  t.absent(etkin.member(K.kerem.memberId).active)
  t.ok(etkin.parentIds().includes(id(E.keremTablet)))
  t.is(zincir(c, VC.zincirler.hizli).persons.get(id(K.kerem)).primary, id(E.keremTablet))
})

test('vektörler: 11 — aynı kişinin kimliği kesim yayımlayamaz', (t) => {
  const c = VC.zincirler.coklu.slice(ANA.length)
  const L = zincir(c, VC.zincirler.kesim)
  const r = replika(L, K.husniye, { otomatikAnahtar: false })
  t.is(r.receiveCutoff(b4a.from(VC.kesim.ayniKisi, 'hex')).code, 'CUTOFF_UNAUTHORIZED')
  t.is(r.receiveCutoff(b4a.from(VC.kesim.baskaKisi, 'hex')).status, 'tamam')
})

test('vektörler: 12 — yerel kanal; APP_PAIR_OK ağdan gelirse atılır', (t) => {
  const v = VC.yerel
  t.absent(Y.acceptOn(Y.Z.APP_PAIR_OK, 'ag'))
  t.absent(Y.acceptOn(Y.Z.APP_PAIR_REQ, 'ag'))
  t.ok(Y.acceptOn(Y.Z.APP_PAIR_OK, 'yerel'))
  t.ok(Y.acceptOn(Y.Z.APP_LOCAL_SYNC, 'ag'), 'APP_LOCAL_SYNC mühürlü; kural yalnız eşleşme türleri için')
  const c = VC.zincirler.coklu.slice(ANA.length)
  const L = zincir(c)
  const e = coz(v.olay)
  L.apply(e)
  t.is(hex(require('@havenfold/core').ledger.eventHash(e)), v.olayOzeti)
  t.is(L.member(E.keremU3.memberId).group, L.member(K.kerem.memberId).group, 'aynı cihaz grubu')
  const pair = pairSecret({ myUdaSecret: E.keremU3.uda.secretKey, theirUdaPub: K.kerem.uda.publicKey, myId: E.keremU3.memberId, theirId: K.kerem.memberId, familyId: L.familyId, anchorHash: L.anchorFor(E.keremU3.memberId, K.kerem.memberId) })
  // Oturum süzgeci: gelen zarf tek giriş noktasından
  const { giris } = require('@havenfold/core')
  for (const x of v.oturumSuzgeci) t.is(hataOf(() => giris.gelenZarf({ myRole: x.ben, peerRole: x.karsi, type: x.tur, bytes: b4a.alloc(0), yol: 'dogrudan' })) !== 'TYPE_NOT_ALLOWED', x.izin, x.ben + '|' + x.karsi + ' ' + x.tur)
  const s = v.yerelEsitleme
  const m = Y.openLocalSync({ ledger: L, pair, me: E.keremU3, peerId: K.kerem.memberId, box: b4a.from(s.muhurlu, 'hex'), id: b4a.from(s.zarfId, 'hex') })
  t.is(m.type, s.tur)
  t.is(hex(m.body), s.govde)
})

test('eşleşme: onaysız, yanlış nonce, süre dolmuş, ek kimlikten eşleşme', (t) => {
  const L = zincir(VC.zincirler.coklu.slice(ANA.length))
  let simdi = TS0
  const yeni = new Y.PairNew({ me: E.keremU3, appId: 'yuva-anilar', now: () => simdi })
  const istek = yeni.request()
  t.is(hataOf(() => new Y.PairOld({ me: K.kerem, ledger: L }).answer(istek, { approved: false })), 'NO_APPROVAL')
  t.is(hataOf(() => new Y.PairOld({ me: E.keremDefter, ledger: L }).answer(istek, { approved: true })), 'NOT_PRIMARY_IDENTITY')
  const baska = new Y.PairNew({ me: E.keremU3, appId: 'yuva-anilar', now: () => simdi })
  const cevap = new Y.PairOld({ me: K.kerem, ledger: L }).answer(baska.request(), { approved: true })
  t.is(hataOf(() => yeni.accept(cevap)), 'PAIRING_NONCE')
  const ok = new Y.PairOld({ me: K.kerem, ledger: L }).answer(istek, { approved: true })
  simdi += Y.PAIR_TTL_MS + 1
  t.is(hataOf(() => yeni.accept(ok)), 'PAIRING_EXPIRED')
})

test('kayıt: ek kimlik kişinin koleksiyonlarını okur ve yazar; okuyucu eklemek dönem açmaz', (t) => {
  const L = zincir(VC.zincirler.coklu.slice(ANA.length))
  const irem = replika(L, K.irem)
  const kis = hex(K_KISISEL_IREM)
  const epochOnce = irem.yetki.epochs(kis).length
  const L2 = zincir(VC.zincirler.coklu.slice(ANA.length))
  const defter = replika(L2, E.iremDefter, { otomatikAnahtar: false })
  t.ok(defter.yetki.isReader(kis, hex(E.iremDefter.memberId), L2.len - 1))
  t.ok(defter.yetki.isWriter(hex(K_TUM_AILE), hex(E.iremDefter.memberId), L2.len - 1), 'rol: izni ek kimliğe de geçer')
  teslim(irem, defter)
  const rid = defter.put(kis, null, 'yuva.defter.not', { gunluk: 'defterden' })
  teslim(defter, irem)
  t.is(irem.get(kis, rid).fields.gunluk, 'defterden')
  t.is(irem.yetki.epochs(kis).length, epochOnce, 'replaces taşımayan APP_ATTACH dönem açmaz')
  const kerem = replika(zincir(VC.zincirler.coklu.slice(ANA.length)), E.keremDefter, { otomatikAnahtar: false })
  t.is(hataOf(() => kerem.put(kis, null, 'yuva.x', { a: 1 })), 'NO_PERMISSION', 'başka kişinin ek kimliği yazamaz')
})

test('kayıt: replaces taşıyan APP_ATTACH ve eski imzasız APP_PRIMARY dönem açar; eski imzalı açmaz', (t) => {
  const c = VC.zincirler.coklu.slice(ANA.length)
  const sayi = (L) => { const r = replika(L, K.husniye, { otomatikAnahtar: false }); return r.yetki.epochs(hex(K_TUM_AILE)).length }
  const taban = sayi(zincir(c))
  t.is(sayi(zincir(c, VC.zincirler.hemen)), taban, 'eski imzalı APP_PRIMARY')
  t.is(sayi(zincir(c, VC.zincirler.hizli)), taban + 1, 'eski imzasız (ebeveyn hızlandırmalı) APP_PRIMARY')
  t.is(sayi(zincir(c, VC.zincirler.bekleyen)), taban, 'bekleme sırasında henüz değil')
  t.is(sayi(zincir(c, VC.zincirler.bekleyen, VC.zincirler.etkin)), taban + 1, 'etkinleşince')
  const yerine = VC.durumlar.find((d) => d.no === 5 && d.gecerli)
  t.is(sayi(zincir(c, VC.zincirler.dort, [yerine.olay])), taban + 1, 'replaces')
})

// İnceleme RFC-0017 bulgu 5: history: false koleksiyonda ek kimlik, kişisi okuyucu olduğu için güncel dönemin anahtarını
// alır (katılma paketi, anahtar isteği ve alıcı süzgeci kişiye göre)
test('kayıt: history: false bakıcı koleksiyonunda ek kimlik güncel dönemin anahtarını alır', (t) => {
  const { K_BAKICI } = require('./helpers/family')
  const A = require('../key')
  const L = zincir(VC.zincirler.coklu.slice(ANA.length))
  const BK = hex(K_BAKICI)
  const ilk = [K.kerem, K.husniye].sort((a, b) => b4a.compare(a.memberId, b.memberId))[0]
  const ureten = replika(L, ilk)
  const ep = ureten.yetki.epochAt(BK, L.len - 1)
  t.ok(ureten.keys.has(BK, ep.seq, ep.hash))
  const defter = replika(zincir(VC.zincirler.coklu.slice(ANA.length)), E.keremDefter)
  t.absent(ep.readers.has(hex(E.keremDefter.memberId)), 'dönem ek kimlikten önce açıldı')
  const cevap = ureten.answerKeyReq(hex(E.keremDefter.memberId), A.encodeRecKeyReq({ collectionId: K_BAKICI, epochs: [ep.seq] }))
  t.is(cevap.filter((m) => m.type === 0x82).length, 1)
  t.is(defter.receiveKey(cevap[0].bytes).status, 'tamam')
  t.ok(defter.keys.has(BK, ep.seq, ep.hash))
  const irem = replika(zincir(VC.zincirler.coklu.slice(ANA.length)), K.irem, { otomatikAnahtar: false })
  t.is(hataOf(() => ureten.answerKeyReq(hex(K.irem.memberId), A.encodeRecKeyReq({ collectionId: K_BAKICI, epochs: [ep.seq] }))), 'UNAUTHORIZED', 'okuyucu olmayan kişi alamaz')
  t.is(irem.receiveKey(cevap[0].bytes).code, 'NOT_READER')
})
