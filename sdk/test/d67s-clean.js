// SPDX-License-Identifier: Apache-2.0
// D67 temiz bulunanlar (Mac, bağımsız inceleme): bugün YEŞİL, yeşil kalmalı. `sdk/test/` altına d67s-common.js ile.
'use strict'
const test = require('brittle')
const b4a = require('b4a')
const { S, K, A, T, H, DK, hataOf, rastgele, id, ANAHTAR, kutuKur, ag, aile, sahteIstek } = require('./d67s-common')

test('T1: sahte ve başkası adına pay isteği: imza, aile, oturum, tutucu, tazelik, yetki (kutu ve telefon)', async (t) => {
  const x = aile(t)
  await x.kerem.setupRecoveryKey(x.kasaCid, rastgele(32), { kagit: 1 })
  ag(x.cihazlar)()
  const tut = x.kutu.tutucu
  const g = (o = {}) => ({ secretId: x.kasaCid, kind: K.pay.TUR.KRA, version: 1, requesterId: id('kerem'), holderId: id('kutu'), at: x.saat.v, ...o })
  // Ecem, Kerem adına imzalar
  t.alike(tut.denetle(sahteIstek(x.L.familyId, g(), A.K.ecem), { from: id('ecem') }), { red: 'INVALID_SIGNATURE' })
  // Başka ailenin kimliğiyle imza
  t.alike(tut.denetle(sahteIstek(b4a.alloc(32, 1), g(), A.K.kerem), { from: id('kerem') }), { red: 'INVALID_SIGNATURE' })
  // Kerem'in gerçek isteğini Ecem'in oturumu taşır
  const gercek = K.istek.payIste(x.L.familyId, { ...g(), secretId: b4a.from(x.kasaCid, 'hex'), holderId: A.K.kutu.memberId }, A.K.kerem)
  t.alike(tut.denetle(gercek, { from: id('ecem') }), { red: 'UNAUTHORIZED' })
  t.alike(tut.denetle(gercek, {}), { red: 'UNAUTHORIZED' }, 'oturum bilgisi yoksa')
  // Başka tutucuya yazılmış istek
  t.alike(tut.denetle(sahteIstek(x.L.familyId, g({ holderId: id('husniye') }), A.K.kerem), { from: id('kerem') }), { red: 'UNAUTHORIZED' })
  // Tazelik: 6 dakika eski, 3 dakika ileri
  t.alike(tut.denetle(sahteIstek(x.L.familyId, g({ at: x.saat.v - 6 * DK }), A.K.kerem), { from: id('kerem') }), { red: 'REQUEST_STALE' })
  t.alike(tut.denetle(sahteIstek(x.L.familyId, g({ at: x.saat.v + 3 * DK }), A.K.kerem), { from: id('kerem') }), { red: 'REQUEST_STALE' })
  // Okuyucu olmayan yetişkin (İrem) ve çocuk (Ecem) kendi adına
  t.alike(tut.denetle(sahteIstek(x.L.familyId, g({ requesterId: id('irem') }), A.K.irem), { from: id('irem') }), { red: 'UNAUTHORIZED' })
  t.alike(tut.denetle(sahteIstek(x.L.familyId, g({ requesterId: id('ecem') }), A.K.ecem), { from: id('ecem') }), { red: 'UNAUTHORIZED' })
  // Kutu kendi kendine
  t.alike(tut.denetle(sahteIstek(x.L.familyId, g({ requesterId: id('kutu') }), A.K.kutu), { from: id('kutu') }), { red: 'UNAUTHORIZED' })
  // Yanlış tür (YA olarak KRA payı)
  t.alike(tut.denetle(sahteIstek(x.L.familyId, g({ kind: K.pay.TUR.YA }), A.K.kerem), { from: id('kerem') }), { red: 'PAY_YOK' })
  // Bozuk neden
  t.alike(tut.denetle(b4a.concat([b4a.alloc(10), b4a.alloc(64)]), { from: id('kerem') }), { red: 'INVALID_MESSAGE' })
  // Telefon tarafında da 405'siz pay çıkışı yok: istek yalnız sorulur
  const kerem2 = new S.VaultApi({ ledger: x.L, me: A.K.kerem, now: x.now })
  kerem2.startRecovery({ tur: 'kra', collectionId: x.kasaCid })
  x.husniye.unlock(ANAHTAR)
  const r = x.husniye.receiveShareRequest(id('kerem'), K.istek.payIste(x.L.familyId, { secretId: b4a.from(x.kasaCid, 'hex'), kind: 1, version: 1, holderId: A.K.husniye.memberId, at: x.saat.v }, A.K.kerem), 'dogrudan')
  t.is(r.durum, 'onay')
  t.alike(x.husniye.recoveryOutgoing(), [], 'onaysız pay gitmez')
  t.alike(x.husniye.approveShare({ jeton: r.jeton, onay: false }), { durum: 'reddedildi' })
  t.alike(x.husniye.approveShare({ jeton: r.jeton, onay: true }), { durum: 'red', red: 'NO_APPROVAL' }, 'reddedilen jeton sonra onaylanamaz')
  t.alike(x.husniye.recoveryOutgoing(), [])
})

test('T2: kutu sormadan verir, günlük sınır; reddedilen her istek ağa aynı (null) döner', async (t) => {
  const saat = { v: A.TS0 + H }
  const L = A.anaDefter()
  const kasaCid = [...L.collections.values()].find((c) => c.sensitivity === 'kasa').id
  const kutuId = id('kutu')
  const kerem = new S.VaultApi({ ledger: L, me: A.K.kerem, now: () => saat.v, uygunCihaz: (x) => x === kutuId })
  const k1 = kutuKur(t, L, saat)
  await kerem.setupRecoveryKey(kasaCid, rastgele(32), { kagit: 1 })
  ag({ [id('kerem')]: { api: kerem }, [kutuId]: { tur: 'kutu', api: k1.kutu } })()
  const istek = () => K.istek.payIste(L.familyId, { secretId: b4a.from(kasaCid, 'hex'), kind: 1, version: 1, holderId: A.K.kutu.memberId, at: saat.v }, A.K.kerem)
  t.ok(k1.kutu.payIstegiAl(id('kerem'), istek(), 'dogrudan'), 'ilk istek: pay')
  t.is(k1.kutu.payIstegiAl(id('kerem'), istek(), 'dogrudan'), null, 'aynı gün ikinci: yok')
  // Yeniden başlatmadaki günlük sınır S14'te (Bare'de kırmızı)
  const k2 = k1.kutu
  saat.v += 25 * H
  t.ok(k2.payIstegiAl(id('kerem'), istek(), 'dogrudan'), 'ertesi gün')
  for (const [kim, imz] of [['ecem', A.K.ecem], ['irem', A.K.irem]]) {
    const b = K.istek.payIste(L.familyId, { secretId: b4a.from(kasaCid, 'hex'), kind: 1, version: 1, holderId: A.K.kutu.memberId, at: saat.v }, imz)
    t.is(k2.payIstegiAl(id(kim), b, 'dogrudan'), null, kim + ' yetkisiz: hata kodu ağa çıkmaz')
  }
})

test('T3: kutu, eski cihazın imzalamadığı ROTATE_DEVICE ile gelen YA sahibine 72 saat sormadan da pay vermez; eski kimlik isteyemez', async (t) => {
  const saat = { v: A.TS0 + H }
  const L = A.anaDefter()
  const kutuId = id('kutu')
  const irem = new S.VaultApi({ ledger: L, me: A.K.irem, now: () => saat.v, uygunCihaz: (x) => x === kutuId })
  const { kutu } = kutuKur(t, L, saat)
  // Dört kişi payı (Kerem, Hüsniye, 2 kâğıt): eşik 3, kutu bir cihaz payı tutar (D = 1)
  const kur = await irem.setupBackupKey(rastgele(32), { kisiler: [id('kerem'), id('husniye')], kagit: 2 })
  t.alike([kur.dagitim.t, kur.dagitim.n], [3, 5])
  const hatalar = []
  ag({ [id('irem')]: { api: irem }, [kutuId]: { tur: 'kutu', api: kutu } }, hatalar)()
  t.is(kutu.liste().length, 1, 'kutuda İrem\'in YA payı')
  const sid = kur.secretId
  L.apply(A.olay(L, T.ROTATE_DEVICE, { oldMemberId: A.K.irem.memberId, newDeviceCert: A.K.u5.deviceCert, ceremonyTranscriptHash: b4a.alloc(32, 7) }, [A.K.u5, A.K.kerem, A.K.husniye]))
  const istek = (kim = A.K.u5) => K.istek.payIste(L.familyId, { secretId: b4a.from(sid, 'hex'), kind: K.pay.TUR.YA, version: 1, holderId: A.K.kutu.memberId, at: saat.v }, kim)
  t.is(kutu.payIstegiAl(id('u5'), istek(), 'dogrudan'), null, 'bekleme')
  saat.v += 71 * H
  t.is(kutu.payIstegiAl(id('u5'), istek(), 'dogrudan'), null, '71. saatte hâlâ')
  saat.v += 2 * H
  t.ok(kutu.payIstegiAl(id('u5'), istek(), 'dogrudan'), '73. saatte verir')
  t.alike(kutu.tutucu.denetle(istek(A.K.kerem), { from: id('kerem') }).red, 'UNAUTHORIZED', 'başkasının YA payı')
})

test('T4: çıkarılan üye ve yanlış sürüm; döndürmeden sonra eski sürüm payı hiçbir tutucudan çıkmaz', async (t) => {
  const x = aile(t)
  const akit = ag(x.cihazlar)
  await x.kerem.setupRecoveryKey(x.kasaCid, rastgele(32), { kagit: 1 })
  akit()
  await x.kerem.rotateVault({ tur: 'kra', collectionId: x.kasaCid, kagit: 1 })
  akit()
  const eski = K.istek.payIste(x.L.familyId, { secretId: b4a.from(x.kasaCid, 'hex'), kind: 1, version: 1, holderId: A.K.kutu.memberId, at: x.saat.v }, A.K.kerem)
  t.is(x.kutu.payIstegiAl(id('kerem'), eski, 'dogrudan'), null, 'sürüm 1 payı kutuda yok')
  x.husniye.unlock(ANAHTAR)
  const eskiH = K.istek.payIste(x.L.familyId, { secretId: b4a.from(x.kasaCid, 'hex'), kind: 1, version: 1, holderId: A.K.husniye.memberId, at: x.saat.v }, A.K.kerem)
  t.alike(x.husniye.receiveShareRequest(id('kerem'), eskiH, 'dogrudan'), { durum: 'red', red: 'PAY_YOK' })
  // Hüsniye, Kerem'i çıkarır: Kerem'in isteği (sürüm 2) artık geçmez
  x.L.apply(A.olay(x.L, T.REMOVE_MEMBER, { memberId: A.K.kerem.memberId, reason: 'test', wipe: false }, [A.K.husniye, A.K.irem]))
  const yeni = K.istek.payIste(x.L.familyId, { secretId: b4a.from(x.kasaCid, 'hex'), kind: 1, version: 2, holderId: A.K.kutu.memberId, at: x.saat.v }, A.K.kerem)
  t.alike(x.kutu.tutucu.denetle(yeni, { from: id('kerem') }).red, 'UNAUTHORIZED', 'çıkarılan üye')
})
