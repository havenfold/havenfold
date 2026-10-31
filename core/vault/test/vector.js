// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
const test = require('brittle')
const b4a = require('b4a')
const sodium = require('sodium-native')
const { combine } = require('shamir-secret-sharing')
const R = require('../test-flow')
const { bek } = require('./helpers/input')
const E = require('../threshold')
const P = require('../share')
const Y = require('../backup')
const Zf = require('../envelope')
const I = require('../request')
const { vektorler, defter, calistir4, calistir5, calistir6, payJson } = require('./helpers/vault-vector')
const F = require('../../../protocol/vectors/vault-v2.json')

const hex = (b) => b4a.toString(b, 'hex')
const buf = (h) => b4a.from(h, 'hex')

test('vektörler: vault.json üretici aynı dosyayı verir (belirlenimci)', async (t) => {
  t.alike(JSON.parse(JSON.stringify(await vektorler())), F)
})

test('vektör 1: sabit rastgelelikle pay üretimi; share[32] x koordinatı; kâğıt pay', async (t) => {
  const v = F.v1
  const geri = R.kaynakAyarla(R.sabitAkis(b4a.from(v.tohum)))
  const sahipler = v.paylar.map((x) => ({ id: x.holderId }))
  const p = await P.paylariUret(buf(v.sir), { secretId: buf(v.secretId), kind: 0, version: 1, dagitim: { kurulur: true, t: 2, n: sahipler.length, sahipler } })
  geri()
  t.alike(p.map((x) => hex(x.share)), v.paylar.map((x) => x.share))
  t.alike(p.map((x) => x.share[32]), v.x)
  t.alike(p.map((x) => hex(P.encodeShare(x))), v.kodlama)
  t.is(hex(P.commitOf(buf(v.secretId), 1, buf(v.sir))), v.commit)
  for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) t.is(hex(await P.birlestir([payJson(v.paylar[a]), payJson(v.paylar[b])], bek(payJson(v.paylar[a])))), v.sir)
  t.is(P.kagitKodla(payJson(v.paylar[0])), v.kagit)
  t.alike(jsonOf(P.kagitCoz(v.kagit)), v.paylar[0])
  t.alike(jsonOf(P.kagitCoz(v.kagit.toLowerCase().replace('hfk1:', 'hfk1:'))), v.paylar[0])
})
const jsonOf = (p) => ({ ...p, secretId: hex(p.secretId), share: hex(p.share), holderId: hex(p.holderId), commit: hex(p.commit) })

test('vektör 2: §3.2 ve §3.3 tablolarının satırları', (t) => {
  for (const r of F.v2.ya) t.alike(E.yaEsik(r.P, r.Dc), { t: r.t, D: r.D, n: r.n, kurulur: r.kurulur, neden: r.neden }, r.aciklama)
  for (const r of F.v2.kra) t.alike(E.kraEsik(r.P, r.Dc), { t: r.t, D: r.D, n: r.n, kurulur: r.kurulur, neden: r.neden }, r.aciklama)
  t.alike(F.v2.ya.map((r) => [r.t, r.D, r.n, r.kurulur]), [[2, 0, 2, true], [2, 0, 2, true], [3, 1, 5, true], [2, 0, 1, false], [2, 0, 2, true], [2, 0, 2, true]])
  t.is(F.v2.kra[0].kurulur, false)
  t.is(F.v2.defterden.cocukPayTutamaz, 'NOT_SHARE_OWNER_ELIGIBLE')
})

test('vektör 3: YA — tek kişi payı + bütün cihaz payları birleşmez', async (t) => {
  const p = F.v3.paylar.map(payJson)
  t.alike([F.v3.esik.t, F.v3.esik.D], [3, 1])
  const [a, b] = F.v3.durumlar
  await t.exception(() => P.birlestir(a.paylar.map((i) => p[i]), bek(p[0])), /INSUFFICIENT_SHARE/)
  const ham = b4a.from(await combine(a.paylar.map((i) => new Uint8Array(p[i].share))))
  t.is(hex(ham), a.hamBirlesim)
  t.not(hex(ham), F.v3.sir)
  t.absent(P.commitOf(p[0].secretId, 1, ham).equals(p[0].commit))
  t.is(hex(await P.birlestir(b.paylar.map((i) => p[i]), bek(p[0]))), F.v3.sir)
})

test('vektör 4: imzasız ROTATE_DEVICE; 72 saat dolmadan pay verilmez', (t) => {
  t.alike(calistir4(F, F.v4), F.v4.sonuclar)
  const s = F.v4.sonuclar
  t.ok(s[0].bekle)
  t.is(s[1].ver, F.v4.pay.share)
  t.alike(s.slice(2).map((x) => x.red), ['DAILY_LIMIT', 'UNAUTHORIZED', 'UNAUTHORIZED'])
  t.ok(I.imzasizDegisim(defter(), hex(require('../../core/test/helpers/ledger').K.u5.memberId)))
})

test('vektör 5: döndürmeden sonra eski paylar eski sırrı açar, yeni dizini açmaz', async (t) => {
  t.alike(await calistir5(F.v5), F.v5.sonuc)
  t.is(F.v5.sonuc.eskiSirYeniDizin, 'INDEX_OPEN_FAILED')
})

test('vektör 6: bozuk pay → commit uyuşmazlığı', async (t) => {
  t.alike(await calistir6(F.v6), F.v6.sonuc)
  t.is(F.v6.sonuc.ikiPay, 'SHARE_CORRUPT')
})

test('vektör 7: yedek dizini AD\'si ve secretId türetimi', (t) => {
  const v = F.v7
  t.is(P.rootIdOf(defter(), F.v4.rootId), v.rootId)
  t.is(hex(P.yaSecretId(buf(v.familyId), v.rootId)), v.secretId)
  t.is(hex(Y.adOf(buf(v.secretId), 2, 9)), v.ad)
  const d = Y.dizinAc(buf(v.ya), buf(v.muhurlu))
  t.is(d.seq, 9)
  t.is(d.blocks.length, 2)
  t.is(hex(d.memberRootId), v.rootId)
})

test('imzalar: pay isteği ve kasa zarfı', (t) => {
  const L = defter()
  const r = buf(F.imzalar.payIstegi.bayt)
  t.is(hex(I.reqDigest(L.familyId, r.subarray(0, r.byteLength - 64))), F.imzalar.payIstegi.ozet)
  t.ok(sodium.crypto_sign_verify_detached(r.subarray(r.byteLength - 64), buf(F.imzalar.payIstegi.ozet), L.members.get(F.imzalar.payIstegi.imzaci).signPub))
  const z = Zf.zarfAc(L, buf(F.imzalar.zarf.kra), buf(F.imzalar.zarf.bayt), { okuyucuMu: () => true })
  t.is(z.lastEpochSeq, F.imzalar.zarf.donem)
  t.is(hex(Zf.adOf(z)), F.imzalar.zarf.ad)
  t.is(z.ic.epochs[0].keys.length, 2)
})
