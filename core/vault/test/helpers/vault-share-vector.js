// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// protocol/vectors/vault-share.json üreticisi (RFC-0027 §1b, D31): KASA_SHARE_PUT (0xF1) ve KASA_SHARE_ACK (0xF2).
// Aile: defter v2.1 ana zinciri (core/core/test/yardimci/v21.js). Pay elle kurulur (rastgelelik yok); beklenen sonuçlar
// elle yazılır, üretici hesapladığını beklenenle karşılaştırır.
const b4a = require('b4a')
const P = require('../../share')
const T = require('../../delivery')
const I = require('../../request')
const A = require('../../../records/test/helpers/family')

const hex = (b) => b4a.toString(b, 'hex')
const id = (k) => hex(k.memberId)

function bek (aciklama, gercek, beklenen) {
  if (gercek !== beklenen) throw new Error(`kasa-pay ${aciklama}: ${gercek} ≠ ${beklenen}`)
  return beklenen
}

const bellek = () => { const m = new Map(); return { get: (k) => m.get(k), has: (k) => m.has(k), set: (k, v) => m.set(k, v) } }
const tutucu = (L, k) => new I.PayTutucu({ ledger: L, me: k, now: () => A.TS0, ilkGorulme: bellek(), sayac: bellek() })
const sonuc = (fn) => { try { return fn().durum } catch (err) { return err.message } }

function paylar (L) {
  const rootId = P.rootIdOf(L, id(A.K.kerem))
  const ya = { secretId: P.yaSecretId(L.familyId, rootId), kind: P.TUR.YA, version: 1, threshold: 2, total: 3, share: b4a.concat([b4a.alloc(32, 0x11), b4a.from([1])]), holderId: A.K.husniye.memberId, commit: b4a.alloc(32, 0x22) }
  const kra = { secretId: A.K_KASA, kind: P.TUR.KRA, version: 1, threshold: 2, total: 3, share: b4a.concat([b4a.alloc(32, 0x33), b4a.from([2])]), holderId: A.K.husniye.memberId, commit: b4a.alloc(32, 0x44) }
  return { rootId, ya, kra }
}

// Durumlar sırayla, aynı tutucuda (grup aynıysa) uygulanır
function vektorler () {
  const L = A.anaDefter()
  const { rootId, ya, kra } = paylar(L)
  const put = T.payTeslimi(ya, rootId)
  const baska = T.payTeslimi({ ...ya, share: b4a.concat([b4a.alloc(32, 0x55), b4a.from([1])]) }, rootId)
  const iremeYa = T.payTeslimi({ ...ya, holderId: A.K.irem.memberId }, rootId)
  const sifirX = b4a.from(put); sifirX[16 + 4 + 32] = 0 // share[32] = x koordinatı (secretId 16, kind, version, threshold, total birer bayt)
  const kraPut = T.payTeslimi(kra)
  const kraKokluPut = b4a.from(kraPut); kraKokluPut[kraKokluPut.length - 1] = 1
  const tanim = [
    ['h', 'YA kerem → hüsniye', id(A.K.kerem), put, 'yeni'],
    ['h', 'aynı pay ikinci kez', id(A.K.kerem), put, 'tekrar'],
    ['h', 'aynı sürümde farklı pay', id(A.K.kerem), baska, 'DUPLICATE_HOLDER'],
    ['i', 'başka tutucunun payı', id(A.K.kerem), put, 'WRONG_HOLDER'],
    ['h2', 'YA payını sırrın sahibi olmayan dağıtır', id(A.K.irem), put, 'UNAUTHORIZED'],
    ['h2', 'sonda fazla bayt', id(A.K.kerem), b4a.concat([put, b4a.from([0])]), 'INVALID_MESSAGE'],
    ['h2', 'x koordinatı 0', id(A.K.kerem), sifirX, 'INVALID_SHARE'],
    ['h2', 'KRA payında rootId sıfır değil', id(A.K.kerem), kraKokluPut, 'INVALID_MESSAGE'],
    ['h2', 'KRA: kasa okuyucusu olmayan dağıtır', id(A.K.irem), kraPut, 'UNAUTHORIZED'],
    ['h2', 'KRA kerem → hüsniye', id(A.K.kerem), kraPut, 'yeni'],
    ['i', 'irem kendi YA payını alır', id(A.K.kerem), iremeYa, 'yeni']
  ]
  const tutucular = { h: tutucu(L, A.K.husniye), h2: tutucu(L, A.K.husniye), i: tutucu(L, A.K.irem) }
  const durumlar = tanim.map(([grup, aciklama, gonderen, bytes, beklenen]) => ({
    grup, aciklama, gonderen, bytes: hex(bytes),
    beklenen: bek(aciklama, sonuc(() => T.teslimAl(tutucular[grup], gonderen, bytes)), beklenen)
  }))
  return {
    aciklama: 'RFC-0027 §1b: KASA_SHARE_PUT (0xF1) { share: KASA_SHARE, rootId } ve KASA_SHARE_ACK (0xF2) { secretId, version, holderId }. Aile ledger-v21.json ana zinciri; pay elle kurulmuş (share[32] = x). grup: aynı tutucu (h, h2: Hüsniye; i: İrem); durumlar sırayla uygulanır. Mühür çift sırrından (RFC-0003 §6.4), Posta Kutusu yasak (MAILBOX_FORBIDDEN).',
    zarf: { KASA_SHARE_PUT: 0xf1, KASA_SHARE_ACK: 0xf2 },
    rootId,
    put: hex(put),
    ack: hex(T.alindi(ya)),
    ackAlanlari: { secretId: hex(ya.secretId), version: 1, holderId: id(A.K.husniye) },
    durumlar
  }
}

module.exports = { vektorler, paylar }
