// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
const test = require('brittle')
const b4a = require('b4a')
const { ledger: { Ledger, T } } = require('@havenfold/core')
const E = require('../threshold')
const P = require('../share')
const Y = require('../backup')
const Zf = require('../envelope')
const I = require('../request')
const D = require('../rotation')
const V = require('../../core/test/helpers/v21')

const { K, C, hex, olay, anaAdimlar, K_KASA } = V
const { kasaDonemleri, girdi, bek } = require('./helpers/input')
const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const uygun = (L) => (id) => id === hex(K.kutu.memberId) || id === hex(C.isci1.memberId)
function ana () { const L = new Ledger(); for (const f of anaAdimlar(L)) L.apply(f()); return L }
// Kurulabilir dağıtım (kurallar threshold.js'te; burada yalnız bölme sınanır)
const dag = (t, sahipler) => ({ kurulur: true, neden: null, t, n: sahipler.length, sahipler })
const oku = { okuyucuMu: () => true }

test('pay: varsayılan kaynak sodium; aynı sır iki bölmede farklı paylar; kâğıt sağlaması', async (t) => {
  const sir = b4a.alloc(32, 9)
  const o = { secretId: b4a.alloc(16, 1), kind: 0, version: 1, dagitim: dag(2, [{ id: '01'.repeat(16) }, { id: '02'.repeat(16) }]) }
  const a = await P.paylariUret(sir, o)
  const b = await P.paylariUret(sir, o)
  t.not(hex(a[0].share), hex(b[0].share))
  t.alike(await P.birlestir(a, bek(a[0])), sir)
  await t.exception(() => P.paylariUret(b4a.alloc(31), o), /INVALID_SECRET/)
  await t.exception(() => P.paylariUret(sir, { ...o, dagitim: { ...o.dagitim, t: 3 } }), /INVALID_THRESHOLD/)
  await t.exception(() => P.paylariUret(sir, { ...o, dagitim: { ...o.dagitim, kurulur: false, neden: 'PERSON_SHARE_INSUFFICIENT' } }), /PERSON_SHARE_INSUFFICIENT/)
  const k = P.kagitKodla(a[0])
  const bozuk = k.slice(0, 10) + (k[10] === 'A' ? 'B' : 'A') + k.slice(11)
  t.is(hataOf(() => P.kagitCoz(bozuk)), 'PAPER_CHECKSUM')
  t.is(hataOf(() => P.kagitCoz('hfk2:' + k.slice(5))), 'INVALID_PAPER')
  t.is(hataOf(() => P.kagitCoz(k + '1')), 'INVALID_PAPER')
  t.is(P.base32(b4a.from('foobar')), 'MZXW6YTBOI') // RFC 4648 örneği, dolgusuz
  t.alike(P.base32Coz('MZXW6YTBOI'), b4a.from('foobar'))
})

test('eşik: uygun kişiler (çocuk, kutu, cihaz değil), cihaz sırası, kâğıt sınırı, döndürme gerekliliği', (t) => {
  const L = ana()
  const kisiler = E.kisiAdaylari(L)
  t.ok(kisiler.includes(hex(K.irem.memberId)))
  t.absent(kisiler.includes(hex(K.ecem.memberId)))
  t.absent(kisiler.includes(hex(K.kutu.memberId)))
  t.alike(E.cihazAdaylari(L, uygun(L)), [hex(K.kutu.memberId), hex(C.isci1.memberId)])
  t.alike(E.cihazAdaylari(L, () => false), []) // TPM mührü doğrulanmamış: pay yok
  t.is(hataOf(() => E.yaDagitim(L, { sahip: hex(K.kerem.memberId), kisiler: [], kagit: 3, uygunCihaz: uygun(L) })), 'PAPER_LIMIT')
  const d = E.yaDagitim(L, { sahip: hex(K.kerem.memberId), kisiler: [hex(K.husniye.memberId), hex(K.irem.memberId)], kagit: 2, uygunCihaz: uygun(L) })
  t.alike([d.t, d.D, d.n], [3, 1, 5])
  t.is(d.sahipler[4].id, hex(K.kutu.memberId))
  t.absent(E.dondurmeGerekli(L, d.sahipler, { uygunCihaz: uygun(L) }))
  // İrem ayrılınca pay sahibi uygun değil: döndürme gerekir
  L.apply(olay(L, T.LEAVE, { memberId: K.irem.memberId }, [K.irem]))
  t.ok(E.dondurmeGerekli(L, d.sahipler, { uygunCihaz: uygun(L) }))
  // KRA: okuyucu olmayan yetişkin pay tutmaz
  const kra = E.kraDagitim(ana(), { collectionId: K_KASA, uygunCihaz: uygun(L) })
  t.alike(kra.sahipler.filter((s) => s.tur === 'kisi').length, 2)
})

test('yedek: her blokta yeni fileKey; en büyük seq kazanır, açılamayan dizin yok sayılır', (t) => {
  const a = Y.blokSifrele(0, b4a.from('aynı içerik'))
  const b = Y.blokSifrele(0, b4a.from('aynı içerik'))
  t.not(hex(a.blok.fileKey), hex(b.blok.fileKey))
  t.not(hex(a.blok.blobId), hex(b.blok.blobId))
  const ya = b4a.alloc(32, 1)
  const sid = b4a.alloc(16, 2)
  const dz = (seq, anahtar = ya) => Y.dizinMuhurle(anahtar, sid, { memberRootId: b4a.alloc(16), version: 1, seq, blocks: [a.blok] })
  t.is(Y.enYeniDizin(ya, [dz(3), dz(7), dz(9, b4a.alloc(32, 5)), b4a.from('çöp'), dz(5)]).seq, 7)
  t.is(hataOf(() => Y.enYeniDizin(ya, [dz(1, b4a.alloc(32, 5))])), 'NO_DIR')
  // Açık seq ile mühürdeki seq farklı olamaz (AD'ye girer)
  const m = b4a.from(dz(4))
  m[17] = 5 // açık seq 4 → 5 (secretId 16 B, version 1 B, sonra seq)
  t.is(hataOf(() => Y.dizinAc(ya, m)), 'INDEX_OPEN_FAILED')
})

test('zarf: okuyucu yazmalı; aynı envSeq\'li iki zarfın dönemleri birleşir', (t) => {
  const L = ana()
  const kra = b4a.alloc(32, 3)
  const ep = kasaDonemleri(L)[0]
  const ic = (keys) => ({ epochs: [{ epochSeq: ep.seq, epochHash: ep.hash, keys }], dropSecrets: [] })
  const z1 = Zf.zarfYaz(L.familyId, kra, { collectionId: K_KASA, version: 1, envSeq: 4, ic: ic([girdi(L, ep, 1, K.kerem)]) }, K.kerem)
  const z2 = Zf.zarfYaz(L.familyId, kra, { collectionId: K_KASA, version: 1, envSeq: 4, ic: ic([girdi(L, ep, 2, K.husniye)]) }, K.husniye)
  const b = Zf.donemleriBirlestir([Zf.zarfAc(L, kra, z1, oku), Zf.zarfAc(L, kra, z2, oku)])
  t.is(b.epochs[0].keys.length, 2)
  t.is(hataOf(() => Zf.zarfAc(L, b4a.alloc(32, 4), z1, oku)), 'ENVELOPE_OPEN_FAILED')
  t.is(hataOf(() => Zf.zarfAc(L, kra, z1, { okuyucuMu: () => false })), 'UNAUTHORIZED')
  const bozuk = b4a.from(z1)
  bozuk[bozuk.length - 1] ^= 1
  t.is(hataOf(() => Zf.zarfAc(L, kra, bozuk, oku)), 'INVALID_SIGNATURE')
  t.is(hataOf(() => Zf.zarfYaz(L.familyId, kra, { collectionId: K_KASA, version: 1, envSeq: 1, ic: { epochs: [] } }, K.kerem)), 'ENVELOPE_EMPTY')
})

test('istek: KRA payı yalnız kasa okuyucusuna; sürüm sorgusu; eski cihaz imzaladıysa bekleme yok', async (t) => {
  const L = ana()
  const kra = b4a.alloc(32, 7)
  const [pay] = await P.paylariUret(kra, { secretId: K_KASA, kind: P.TUR.KRA, version: 2, dagitim: dag(2, [{ id: hex(K.kutu.memberId) }, { id: hex(K.kerem.memberId) }]) })
  let saat = V.TS0
  const tut = new I.PayTutucu({ ledger: L, me: K.kutu, now: () => saat, ilkGorulme: new Map(), sayac: new Map() })
  tut.ekle({ share: pay })
  const istek = (kim, ek = {}) => I.payIste(L.familyId, { secretId: K_KASA, kind: P.TUR.KRA, version: 2, holderId: K.kutu.memberId, at: saat, ...ek }, kim)
  const ist = (kim) => tut.iste(istek(kim), { from: kim.memberId })
  t.is(ist(K.irem).red, 'UNAUTHORIZED') // kasa okuyucusu değil
  t.ok(ist(K.husniye).ver)
  t.is(ist(K.ecem).red, 'UNAUTHORIZED')
  t.is(tut.iste(istek(K.husniye, { version: 3 }), { from: K.husniye.memberId }).red, 'PAY_YOK')
  t.is(tut.iste(b4a.alloc(10)).red, 'INVALID_MESSAGE')
  t.is(tut.iste(istek(K.husniye), { from: K.kerem.memberId }).red, 'UNAUTHORIZED')
  t.alike(I.surumCevabiCoz(tut.surum(I.surumIste(K_KASA), { from: K.husniye.memberId })), { secretId: b4a.from(K_KASA), version: 2, threshold: 2, total: 2 })
  t.is(tut.surum(I.surumIste(b4a.alloc(16, 9)), { from: K.husniye.memberId }), null)
  // Sürüm sorusu yalnız yetkili istekçiye (inceleme 19 B13): okuyucu olmayan ve soran belirsiz
  t.is(tut.surum(I.surumIste(K_KASA), { from: K.irem.memberId }), null)
  t.is(tut.surum(I.surumIste(K_KASA)), null)
  // Eski cihazın imzaladığı değişim: YA payı hemen verilir
  const ya = b4a.alloc(32, 8)
  const secretId = P.yaSecretId(L.familyId, hex(K.irem.memberId))
  const [yp] = await P.paylariUret(ya, { secretId, kind: P.TUR.YA, version: 1, dagitim: dag(2, [{ id: hex(K.kutu.memberId) }, { id: E.kagitId(1) }]) })
  tut.ekle({ share: yp }, { rootId: hex(K.irem.memberId) })
  L.apply(olay(L, T.ROTATE_DEVICE, { oldMemberId: K.irem.memberId, newDeviceCert: K.u6.deviceCert, ceremonyTranscriptHash: b4a.alloc(32, 7) }, [K.u6, K.irem, K.kerem]))
  saat += 1000
  t.absent(I.imzasizDegisim(L, hex(K.u6.memberId)))
  const r = tut.iste(I.payIste(L.familyId, { secretId, kind: P.TUR.YA, version: 1, holderId: K.kutu.memberId, at: saat }, K.u6), { from: K.u6.memberId })
  t.alike(I.payCevabiCoz(r.ver).share, yp.share)
})

test('döndürme: yeni sır her seferinde başka; birden çok yeni KRA\'da en büyük sürüm, eşitlikte küçük özet', (t) => {
  t.not(hex(D.yeniSir()), hex(D.yeniSir()))
  const a = { version: 3, kra: b4a.alloc(32, 1) }
  const b = { version: 3, kra: b4a.alloc(32, 2) }
  const c = { version: 2, kra: b4a.alloc(32, 3) }
  t.is(D.kraKazanan([c, a, b]), D.kraKazanan([b, c, a]))
  t.is(D.kraKazanan([c]).version, 2)
  t.is(D.kraKazanan([]), null)
})
