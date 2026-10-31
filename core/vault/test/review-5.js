// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D9: inceleme 5 bulguları (kasa, RFC-0021). Beklenen değerler elle yazılmıştır.
const test = require('brittle')
const b4a = require('b4a')
const c = require('compact-encoding')
const { ledger: { Ledger, T, decodeEvent, encodeEvent } } = require('@havenfold/core')
const E = require('../threshold')
const P = require('../share')
const Zf = require('../envelope')
const I = require('../request')
const kasa = require('..')
const R = require('../test-flow')
const V = require('../../core/test/helpers/v21')
const { C0, E: CE } = require('../../records/test/helpers/multi-vector')
const { kasaDonemleri, girdi, bek } = require('./helpers/input')

const { K, hex, olay, anaAdimlar, K_KASA, TS0 } = V
const H = 3_600_000
const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const dag = (t, sahipler) => ({ kurulur: true, neden: null, t, n: sahipler.length, sahipler })
function ana () { const L = new Ledger({ now: () => TS0 }); for (const f of anaAdimlar(L)) L.apply(f()); return L }
function coklu () { const L = new Ledger({ now: () => TS0 }); for (const e of C0) L.apply(decodeEvent(encodeEvent(e))); return L }
const attach = (L, ek, kisi, ek2 = {}, imz = [kisi]) => olay(L, T.APP_ATTACH, { deviceCert: ek.deviceCert, personId: kisi.memberId, appId: 'yuva-defteri', sameDevice: true, replaces: null, ceremonyTranscriptHash: b4a.alloc(32, 7), ...ek2 }, [ek, ...imz])
const primary = (L, kisi, yeni, imz) => olay(L, T.APP_PRIMARY, { personId: kisi.memberId, newPrimaryId: yeni.memberId }, imz)
const rotate = (L, eski, yeni, imz) => olay(L, T.ROTATE_DEVICE, { oldMemberId: eski.memberId, newDeviceCert: yeni.deviceCert, ceremonyTranscriptHash: b4a.alloc(32, 7) }, imz)

async function yaKur (L, saat, sahip, ek = {}) {
  const secretId = P.yaSecretId(L.familyId, hex(sahip.memberId))
  const [pay] = await P.paylariUret(b4a.alloc(32, 8), { secretId, kind: P.TUR.YA, version: 1, dagitim: dag(2, [{ id: hex(K.kutu.memberId) }, { id: E.kagitId(1) }]) })
  const uyarilar = []
  const tut = new I.PayTutucu({ ledger: L, me: K.kutu, now: () => saat.v, ilkGorulme: new Map(), sayac: new Map(), uyar: (b, a) => uyarilar.push({ b, a }), ...ek })
  tut.ekle({ share: pay }, { rootId: hex(sahip.memberId) })
  const istek = (kim) => I.payIste(L.familyId, { secretId, kind: P.TUR.YA, version: 1, holderId: K.kutu.memberId, at: saat.v }, kim)
  const iste = (kim) => tut.iste(istek(kim), { from: kim.memberId })
  return { tut, iste, istek, uyarilar, secretId, pay }
}

test('S1: replaces ile gelmiş ek kimliğin imzasız APP_PRIMARY\'si de 72 saat bekletir', async (t) => {
  const saat = { v: TS0 }
  const L = coklu()
  const { tut, iste } = await yaKur(L, saat, K.kerem)
  L.apply(attach(L, CE.keremU3, K.kerem, { appId: 'yuva-hat', sameDevice: false, replaces: CE.keremTablet.memberId }))
  tut.gozle()
  saat.v += 100 * H
  L.apply(primary(L, K.kerem, CE.keremU3, [CE.keremU3, K.husniye]))
  tut.gozle()
  saat.v += H
  t.alike(I.bekleyenDegisimler(L, hex(CE.keremU3.memberId)).map((x) => L.events[x.seq].type).sort(), [T.APP_ATTACH, T.APP_PRIMARY].sort())
  t.is(iste(CE.keremU3).bekle, TS0 + 100 * H + 72 * H)
})

test('S2 (RFC-0021 a): uyarı olay görülünce, beklemeden; alıcılar kişinin kimlikleri, eski kimlik ve ebeveynler', async (t) => {
  const saat = { v: TS0 }
  const L = coklu()
  const { tut, uyarilar } = await yaKur(L, saat, K.kerem)
  tut.gozle()
  t.is(uyarilar.length, 0)
  L.apply(primary(L, K.kerem, CE.keremDefter, [CE.keremDefter, K.husniye]))
  tut.gozle()
  t.is(uyarilar.length, 1)
  t.is(uyarilar[0].b.type, 'rotate_pending_share')
  t.is(uyarilar[0].b.bitis, TS0 + 72 * H)
  t.ok(uyarilar[0].a.includes(hex(K.kerem.memberId)), 'eski ana kimlik')
  t.ok(uyarilar[0].a.includes(hex(K.husniye.memberId)), 'diğer ebeveyn')
  t.ok(uyarilar[0].a.includes(hex(CE.keremTablet.memberId)), 'kişinin diğer kimliği')
  tut.gozle()
  t.is(uyarilar.length, 1, 'bir kez')
})

test('S3 (RFC-0021 b): onay jetonla ve en çok 10 dakika; pay verilirken denetimler yinelenir', async (t) => {
  const saat = { v: TS0 }
  const L = ana()
  const { tut, istek } = await yaKur(L, saat, K.irem)
  const r = tut.denetle(istek(K.irem), { from: K.irem.memberId })
  t.ok(r.onayGerekli)
  t.is(tut.ver({ req: hex(K.irem.memberId) }).red, 'NO_APPROVAL', 'uydurma nesne')
  saat.v += 11 * 60_000
  t.is(tut.ver(r.jeton).red, 'APPROVAL_EXPIRED')
  const r2 = tut.denetle(istek(K.irem), { from: K.irem.memberId })
  L.apply(olay(L, T.REMOVE_MEMBER, { memberId: K.irem.memberId, reason: 'x', wipe: false }, [K.kerem, K.husniye]))
  t.is(tut.ver(r2.jeton).red, 'UNAUTHORIZED', 'onay beklerken çıkarıldı')
})

test('S4 ve S5 (RFC-0021 c): ağdan gelen pay denetlenir; sürüm beklenenden; tutucu başına bir pay; eşik 2–3', async (t) => {
  const sir = b4a.alloc(32, 5)
  const sid = b4a.alloc(16, 1)
  const s = [{ id: '01'.repeat(16) }, { id: '02'.repeat(16) }, { id: '03'.repeat(16) }]
  const p = await P.paylariUret(sir, { secretId: sid, kind: 0, version: 1, dagitim: dag(2, s) })
  const x0 = { ...p[0], share: b4a.concat([p[0].share.subarray(0, 32), b4a.from([0])]) }
  t.is(hataOf(() => I.payCevabiCoz(c.encode(I.shareRes, { share: x0 }))), 'INVALID_SHARE')
  // Kötü tutucu: aynı secretId, sürüm 2, kendi sırrı ve commit'i, iki pay (biri başka tutucunun kimliğiyle)
  const sahte = await P.paylariUret(b4a.alloc(32, 9), { secretId: sid, kind: 0, version: 2, dagitim: dag(2, [s[0], s[1]]) })
  t.alike(await P.birlestir([...sahte, p[0], p[1]], { secretId: sid, kind: 0, version: 1 }), sir, 'beklenen sürüm 1')
  await t.exception(() => P.birlestir(sahte, { secretId: sid, kind: 0, version: 1 }), /VERSION_MISMATCH/)
  const ayniTutucu = { ...p[1], holderId: p[0].holderId }
  await t.exception(() => P.birlestir([p[0], ayniTutucu], bek(p[0])), /DUPLICATE_HOLDER/)
  // Bozuk biçimli pay birleştirmeyi çökertmez
  t.alike(await P.birlestir([{ ...p[2], share: b4a.alloc(5) }, p[0], p[1]], bek(p[0])), sir)
})

test('S6: rastgelelik iç durumu dışa verilmez; sıfır kaynağı reddedilir', async (t) => {
  t.absent('_durum' in kasa.rastgele)
  const geri = R.kaynakAyarla((n) => new Uint8Array(n))
  try {
    await t.exception(() => P.paylariUret(b4a.alloc(32, 1), { secretId: b4a.alloc(16), kind: 0, version: 1, dagitim: dag(2, [{ id: '01'.repeat(16) }, { id: '02'.repeat(16) }]) }), /RANDOM_SOURCE_CORRUPT/)
  } finally { geri() }
})

test('S9 ve şüpheli: kalıcı depolar zorunlu; YA payında rootId zorunlu ve tutarlı', async (t) => {
  const L = ana()
  t.is(hataOf(() => new I.PayTutucu({ ledger: L, me: K.kutu })), 'STATE_STORE_REQUIRED')
  const tut = new I.PayTutucu({ ledger: L, me: K.kutu, ilkGorulme: new Map(), sayac: new Map() })
  const secretId = P.yaSecretId(L.familyId, hex(K.irem.memberId))
  const [pay] = await P.paylariUret(b4a.alloc(32, 8), { secretId, kind: 0, version: 1, dagitim: dag(2, [{ id: hex(K.kutu.memberId) }, { id: E.kagitId(1) }]) })
  t.is(hataOf(() => tut.ekle({ share: pay })), 'INVALID_ROOT')
  t.is(hataOf(() => tut.ekle({ share: pay }, { rootId: hex(K.kerem.memberId) })), 'INVALID_ROOT')
  t.is(hataOf(() => tut.ekle({ share: pay }, { rootId: hex(K.irem.memberId) })), null)
})

test('S11: zarftaki imzasız ya da yabancı anahtar girdisi kurtarmaya girmez; başka daldaki dönem reddedilir', (t) => {
  const L = ana()
  const kra = b4a.alloc(32, 3)
  const ep = kasaDonemleri(L)[0]
  const sahte = { keyId: b4a.alloc(32, 1), key: b4a.alloc(32, 2), issuerId: b4a.alloc(16, 3), sig: b4a.alloc(64) }
  const z = Zf.zarfYaz(L.familyId, kra, { collectionId: K_KASA, version: 1, envSeq: 1, ic: { epochs: [{ epochSeq: ep.seq, epochHash: ep.hash, keys: [sahte, girdi(L, ep, 7, K.kerem)] }], dropSecrets: [] } }, K.kerem)
  const a = Zf.zarfAc(L, kra, z, { okuyucuMu: () => true })
  t.is(a.ic.epochs[0].keys.length, 1)
  t.alike(a.ic.epochs[0].keys[0].issuerId, b4a.from(K.kerem.memberId))
  const z2 = Zf.zarfYaz(L.familyId, kra, { collectionId: K_KASA, version: 1, envSeq: 2, ic: { epochs: [{ epochSeq: ep.seq, epochHash: b4a.alloc(32, 1), keys: [] }], dropSecrets: [] } }, K.kerem)
  t.is(hataOf(() => Zf.zarfAc(L, kra, z2, { okuyucuMu: () => true })), 'INVALID_ENVELOPE')
})

test('inceleme 1 kasa 23: çatallanmada başka dalın olayı ilk görülme anını devralmaz', async (t) => {
  const saat = { v: TS0 }
  const L = ana()
  const { tut } = await yaKur(L, saat, K.irem)
  const prefix = L.events.slice()
  const A = Ledger.fromEvents(prefix, { now: () => TS0 })
  A.apply(rotate(A, K.irem, K.u5, [K.u5, K.kerem, K.husniye]))
  L.replaceWith(A.events)
  tut.gozle()
  const hA = hex(L.hashAt(L.len - 1))
  t.is(tut.ilkGorulme.get(hA), TS0)
  // B dalı: aynı seq'te başka olay, sonra aynı değişim 10 saat sonra
  saat.v += 10 * H
  const B = Ledger.fromEvents(prefix, { now: () => TS0 })
  B.apply(olay(B, T.PLACE, { placeId: b4a.alloc(16, 0x70), name: 'X', kind: 'ev', remove: false }, [K.kerem]))
  B.apply(rotate(B, K.irem, K.u5, [K.u5, K.kerem, K.husniye]))
  L.replaceWith(B.events)
  tut.gozle()
  t.is(tut.ilkGorulme.get(hex(L.hashAt(L.len - 1))), TS0 + 10 * H, 'yeni olay yeni an')
})
