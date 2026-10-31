// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D9: inceleme 1 bulguları, RFC-0004 (kasa). Beklenen değerler elle yazılmıştır.
const test = require('brittle')
const b4a = require('b4a')
const { ledger: { Ledger, T, decodeEvent, encodeEvent } } = require('@havenfold/core')
const E = require('../threshold')
const P = require('../share')
const Y = require('../backup')
const Zf = require('../envelope')
const I = require('../request')
const D = require('../rotation')
const kasa = require('..')
const V = require('../../core/test/helpers/v21')
const { C0, E: CE } = require('../../records/test/helpers/multi-vector')

const { K, C, hex, olay, anaAdimlar, K_KASA, TS0 } = V
const H = 3_600_000
const { kasaDonemleri, girdi, bek } = require('./helpers/input')
const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const dag = (t, sahipler) => ({ kurulur: true, neden: null, t, n: sahipler.length, sahipler })
function ana () { const L = new Ledger({ now: () => TS0 }); for (const f of anaAdimlar(L)) L.apply(f()); return L }
const rotate = (L, eski, yeni, imz) => olay(L, T.ROTATE_DEVICE, { oldMemberId: eski.memberId, newDeviceCert: yeni.deviceCert, ceremonyTranscriptHash: b4a.alloc(32, 7) }, imz)

// İrem'in YA payı kutuda. Tutucu: kutu.
async function yaKur (L, saat) {
  const secretId = P.yaSecretId(L.familyId, hex(K.irem.memberId))
  const [pay] = await P.paylariUret(b4a.alloc(32, 8), { secretId, kind: P.TUR.YA, version: 1, dagitim: dag(2, [{ id: hex(K.kutu.memberId) }, { id: E.kagitId(1) }]) })
  const tut = new I.PayTutucu({ ledger: L, me: K.kutu, now: () => saat.v, ilkGorulme: new Map(), sayac: new Map() })
  tut.ekle({ share: pay }, { rootId: hex(K.irem.memberId) })
  const iste = (kim, ek = {}) => tut.iste(I.payIste(L.familyId, { secretId, kind: P.TUR.YA, version: 1, holderId: K.kutu.memberId, at: saat.v, ...ek }, kim), { from: kim.memberId })
  return { tut, iste, secretId, pay }
}

test('kasa 1 (§11.4 b): 72 saat zincirleme cihaz değişimiyle atlanamaz', async (t) => {
  const saat = { v: TS0 }
  const L = ana()
  const { tut, iste } = await yaKur(L, saat)
  tut.gozle()
  L.apply(rotate(L, K.irem, K.u5, [K.u5, K.kerem, K.husniye])) // imzasız: eski telefon yok
  saat.v += H
  tut.gozle()
  L.apply(rotate(L, K.u5, K.u6, [K.u6, K.u5, K.kerem])) // u5 imzalı ikinci değişim
  saat.v += H
  const r = iste(K.u6)
  t.is(r.bekle, TS0 + H + 72 * H, 'ilk imzasız değişimin 72 saati')
  t.is(r.bildir, hex(K.irem.memberId))
  saat.v = TS0 + 74 * H
  t.ok(iste(K.u6).ver)
})

test('kasa 2 (§11.4 b): ilk görülme olay özetiyle; çatallanmada seq kaysa da bekleme sürer', async (t) => {
  const saat = { v: TS0 }
  const L = ana()
  const { tut } = await yaKur(L, saat)
  L.apply(rotate(L, K.irem, K.u5, [K.u5, K.kerem, K.husniye]))
  tut.gozle()
  const h = hex(L.hashAt(L.len - 1))
  t.is(tut.ilkGorulme.get(h), TS0)
  saat.v += 10 * H
  tut.gozle()
  t.is(tut.ilkGorulme.get(h), TS0, 'aynı olay aynı an')
  t.absent(tut.ilkGorulme.has(L.len - 1), 'seq ile anahtarlanmaz')
})

test('kasa 3 (§11.4 a): from zorunlu ve istekçiyle aynı; istek bu tutucuya ve taze olmalı', async (t) => {
  const saat = { v: TS0 }
  const L = ana()
  const { tut, iste, secretId } = await yaKur(L, saat)
  const istek = (ek = {}) => I.payIste(L.familyId, { secretId, kind: P.TUR.YA, version: 1, holderId: K.kutu.memberId, at: saat.v, ...ek }, K.irem)
  t.is(tut.iste(istek()).red, 'UNAUTHORIZED', 'from yok')
  t.is(tut.iste(istek(), { from: K.kerem.memberId }).red, 'UNAUTHORIZED', 'başkasının isteğini aktaran')
  t.is(tut.iste(istek({ holderId: C.isci1.memberId }), { from: K.irem.memberId }).red, 'UNAUTHORIZED', 'başka tutucuya')
  t.is(tut.iste(istek({ at: saat.v - 5 * 60_000 - 1 }), { from: K.irem.memberId }).red, 'REQUEST_STALE')
  t.ok(iste(K.irem).ver)
})

test('kasa 4 ve 11 (§11.4 c): YA istekçisi rootId zincirinin ucu; ek kimlik KRA payı istemez', async (t) => {
  const L = new Ledger({ now: () => TS0 })
  for (const e of C0) L.apply(decodeEvent(encodeEvent(e)))
  const saat = { v: TS0 }
  // Kerem'in tabletindeki ek kimliğin kendi YA'sı: istekçi ek kimliğin kendisi
  const secretId = P.yaSecretId(L.familyId, hex(CE.keremTablet.memberId))
  const [pay] = await P.paylariUret(b4a.alloc(32, 9), { secretId, kind: P.TUR.YA, version: 1, dagitim: dag(2, [{ id: hex(K.kutu.memberId) }, { id: E.kagitId(1) }]) })
  const tut = new I.PayTutucu({ ledger: L, me: K.kutu, now: () => saat.v, ilkGorulme: new Map(), sayac: new Map() })
  tut.ekle({ share: pay }, { rootId: hex(CE.keremTablet.memberId) })
  const ya = (kim) => tut.iste(I.payIste(L.familyId, { secretId, kind: P.TUR.YA, version: 1, holderId: K.kutu.memberId, at: saat.v }, kim), { from: kim.memberId })
  t.ok(ya(CE.keremTablet).ver, 'ek kimlik kendi YA\'sını alır')
  t.is(ya(K.kerem).red, 'UNAUTHORIZED', 'kişinin ana kimliği ek kimliğin YA\'sını alamaz')
  const [kp] = await P.paylariUret(b4a.alloc(32, 10), { secretId: K_KASA, kind: P.TUR.KRA, version: 1, dagitim: dag(2, [{ id: hex(K.kutu.memberId) }, { id: hex(K.husniye.memberId) }]) })
  if (L.collections.get(hex(K_KASA))) {
    tut.ekle({ share: kp })
    t.is(tut.iste(I.payIste(L.familyId, { secretId: K_KASA, kind: P.TUR.KRA, version: 1, holderId: K.kutu.memberId, at: saat.v }, CE.keremTablet), { from: CE.keremTablet.memberId }).red, 'UNAUTHORIZED')
  }
})

test('kasa 7 ve 19: test akışı ana dışa aktarımda yok; öz denetim', async (t) => {
  t.absent('kaynakAyarla' in kasa.rastgele)
  t.absent('sabitAkis' in kasa.rastgele)
  await kasa.rastgele.ozDenetim()
  t.pass('yama işliyor')
})

test('kasa 8, 18, 20: başta uyumsuz pay; aynı x\'te farklı paylar ayrı aday; x = 0 reddi', async (t) => {
  const sir = b4a.alloc(32, 3)
  const o = { secretId: b4a.alloc(16, 1), kind: 0, version: 1, dagitim: dag(2, [{ id: '01'.repeat(16) }, { id: '02'.repeat(16) }, { id: '03'.repeat(16) }]) }
  const p = await P.paylariUret(sir, o)
  const yabanci = (await P.paylariUret(b4a.alloc(32, 4), { ...o, secretId: b4a.alloc(16, 2) }))[0]
  t.alike(await P.birlestir([yabanci, p[0], p[1]], bek(p[0])), sir, 'ilk pay başka sırrın')
  const sahte = { ...p[0], share: b4a.concat([b4a.alloc(32, 0x55), p[0].share.subarray(32)]) }
  t.alike(await P.birlestir([{ ...sahte, holderId: b4a.alloc(16, 0x44) }, p[0], p[1]], bek(p[0])), sir, 'aynı x\'te bozuk ve doğru pay')
  t.alike(await P.birlestir([p[1], { ...sahte, holderId: b4a.alloc(16, 0x44) }, p[0]], bek(p[0])), sir)
  const x0 = P.encodeShare({ ...p[0], share: b4a.concat([p[0].share.subarray(0, 32), b4a.from([0])]) })
  t.is(hataOf(() => P.decodeShare(x0)), 'INVALID_SHARE')
})

test('kasa 9 ve 10: kurulamayan dağıtımda pay yok; KRA sahipleri defterden', async (t) => {
  const L = ana()
  const d = E.yaDagitim(L, { sahip: hex(K.kerem.memberId), kisiler: [], kagit: 0, uygunCihaz: () => false })
  t.absent(d.kurulur)
  await t.exception(() => P.paylariUret(b4a.alloc(32, 1), { secretId: b4a.alloc(16), kind: 0, version: 1, dagitim: d }), /PERSON_SHARE_INSUFFICIENT/)
  const k = E.kraDagitim(L, { collectionId: K_KASA, uygunCihaz: () => false })
  t.alike(k.sahipler.filter((s) => s.tur === 'kisi').map((s) => s.id).sort(), [hex(K.kerem.memberId), hex(K.husniye.memberId)].sort())
  t.is(hataOf(() => E.kraDagitim(L, { collectionId: b4a.alloc(16, 0x99) })), 'NO_COLLECTION')
})

test('kasa 12: iki aşama — onaydan önce sınır tüketilmez; sayaç dışarıdan saklanır', async (t) => {
  const saat = { v: TS0 }
  const L = ana()
  const { tut, secretId } = await yaKur(L, saat)
  const istek = () => I.payIste(L.familyId, { secretId, kind: P.TUR.YA, version: 1, holderId: K.kutu.memberId, at: saat.v }, K.irem)
  const r = tut.denetle(istek(), { from: K.irem.memberId })
  t.ok(r.onayGerekli)
  const r2 = tut.denetle(istek(), { from: K.irem.memberId })
  t.ok(r2.onayGerekli, 'onaysız deneme sınırı tüketmez')
  t.ok(tut.ver(r.jeton).ver)
  t.is(tut.ver(r.jeton).red, 'NO_APPROVAL', 'jeton tek kullanımlık')
  t.is(tut.ver(r2.jeton).red, 'DAILY_LIMIT')
  const sayac = new Map(tut.verilen)
  const tut2 = new I.PayTutucu({ ledger: L, me: K.kutu, now: () => saat.v, sayac, ilkGorulme: new Map() })
  tut2.ekle({ share: [...tut.paylar.values()][0].share }, { rootId: hex(K.irem.memberId) })
  t.is(tut2.iste(istek(), { from: K.irem.memberId }).red, 'DAILY_LIMIT', 'sayaç kalıcı')
})

test('kasa 13: döndürme — yeni sürüm eski payı siler; dizin yeni YA ile yeniden mühürlenir', async (t) => {
  const saat = { v: TS0 }
  const L = ana()
  const { tut, secretId } = await yaKur(L, saat)
  const r = await D.dondur({ secretId, kind: P.TUR.YA, eskiVersion: 1, dagitim: dag(2, [{ id: hex(K.kutu.memberId) }, { id: E.kagitId(1) }]) })
  t.is(r.version, 2)
  tut.ekle({ share: r.paylar[0] }, { rootId: hex(K.irem.memberId) })
  t.alike([...tut.paylar.keys()], [hex(secretId) + '|2'])
  t.is(hataOf(() => tut.ekle({ share: { ...r.paylar[0], version: 1 } }, { rootId: hex(K.irem.memberId) })), 'STALE_VERSION')
  const eskiYa = b4a.alloc(32, 8)
  const m = Y.dizinMuhurle(eskiYa, secretId, { memberRootId: b4a.alloc(16), version: 1, seq: 4, blocks: [{ blokNo: 0, blobId: b4a.alloc(32, 1), fileKey: b4a.alloc(32, 2), size: 10 }] })
  const yeni = D.dizinDondur({ eskiYa, yeniYa: r.sir, secretId, muhurlu: m, yeniVersion: 2, calindi: true })
  t.alike(yeni.yenidenYuklenecek, [0])
  const d = Y.dizinAc(r.sir, yeni.muhurlu)
  t.alike([d.version, d.seq], [2, 5])
  t.is(hataOf(() => Y.dizinAc(eskiYa, yeni.muhurlu)), 'INDEX_OPEN_FAILED')
})

test('kasa 14 ve 16: zarf keyEntry listesi; birleştirme sıradan bağımsız; okuyucu denetimi zorunlu', (t) => {
  const L = ana()
  const kra = b4a.alloc(32, 3)
  const ep = kasaDonemleri(L)[0]
  const ke = (n) => girdi(L, ep, n, K.kerem)
  const z = (keys, drops) => Zf.zarfYaz(L.familyId, kra, { collectionId: K_KASA, version: 1, envSeq: 4, ic: { epochs: [{ epochSeq: ep.seq, epochHash: ep.hash, keys }], dropSecrets: drops } }, K.kerem)
  const oku = { okuyucuMu: (id, seq) => id === hex(K.kerem.memberId) && seq === ep.seq }
  const a = Zf.zarfAc(L, kra, z([ke(1)], [{ dropKeyHash: b4a.alloc(32, 9), secret: b4a.alloc(32, 8) }]), oku)
  const b = Zf.zarfAc(L, kra, z([ke(5), ke(1)], [{ dropKeyHash: b4a.alloc(32, 7), secret: b4a.alloc(32, 6) }]), oku)
  const x = Zf.donemleriBirlestir([a, b])
  t.alike(x, Zf.donemleriBirlestir([b, a]))
  t.is(x.epochs[0].keys.length, 2)
  t.alike(x.epochs[0].keys[0].issuerId, b4a.from(K.kerem.memberId))
  t.is(x.dropSecrets.length, 2)
  t.is(hataOf(() => Zf.zarfAc(L, kra, z([ke(1)], []))), 'NO_READER_CHECK')
  t.is(hataOf(() => Zf.zarfAc(L, kra, z([ke(1)], []), { okuyucuMu: () => false })), 'UNAUTHORIZED')
})

test('kasa 17: KRA okuyucusu çıkınca döndürme gerekir', (t) => {
  const L = ana()
  const d = E.kraDagitim(L, { collectionId: K_KASA, uygunCihaz: () => false, kagit: 1 })
  t.absent(E.dondurmeGerekli(L, d.sahipler, { collectionId: K_KASA }))
  L.apply(V.koleksiyon(L, [K.kerem, K.husniye], { collectionId: K_KASA, name: 'Kasa', kind: 'genel', readers: [V.uye(K.kerem)], writers: [V.uye(K.kerem)], sensitivity: 'kasa', taskAccess: false }))
  t.ok(E.dondurmeGerekli(L, d.sahipler, { collectionId: K_KASA }))
})
