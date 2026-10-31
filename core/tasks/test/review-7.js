// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// İnceleme 7 bulgu 6 ve RFC-0022 f: yöneticinin sürekli görevi yalnız alanındaki işçiye; TASK_PERMIT geçiciye görev açmaz
const test = require('brittle')
const b4a = require('b4a')
const { Isci } = require('../audit')
const GK = require('../encoding')
const G = require('./helpers/task')
const { v21: { canTask } } = require('@havenfold/core')
const E = require('../../core/test/helpers/team-install')

const { K, C, T, hex, olay, ekle, cihazEkle, ekip, ata, id, DAY, YER_A, YER_B } = E

function kurulum (yer) {
  const SIMDI = G.SIMDI
  const L = ekip(() => SIMDI)
  L.apply(ekle(L, K.husniye, 'yonetici', [K.kerem]))
  L.apply(ata(L, K.husniye, [YER_A], [K.kerem]))
  L.apply(cihazEkle(L, C.isci1, [K.kerem], { placeId: yer }))
  L.apply(olay(L, T.NOTICE, { placeId: yer, textBlobId: b4a.alloc(32, 1), signBlobId: b4a.alloc(32, 2), textVersion: 'v1', cameraCount: 1, outbound: [], remove: false }, [K.kerem]))
  const cid = b4a.alloc(16, 0x61)
  L.apply(olay(L, T.COLLECTION, { collectionId: cid, name: 'Yönetim', kind: 'genel', readers: ['rol:sahip', 'rol:yonetici'], writers: ['rol:sahip', 'rol:yonetici'], sensitivity: 'normal', taskAccess: true, history: true, dropKey: b4a.alloc(32) }, [K.kerem]))
  const izin = { ekip: true, kisiOlcer: false, yuz: false, plaka: false }
  const isci = new Isci({ ledger: L, me: C.isci1, caps: G.caps(C.isci1), now: () => SIMDI, imajlar: () => izin })
  const al = (kim) => {
    const g = G.gorev(L, { requester: kim.memberId, collectionId: cid, type: 'hf.task.vision', version: '1.0.0', standing: true, deadline: SIMDI + DAY, taskId: b4a.alloc(16, 0x77) })
    const r = isci.denetle(GK.encodeTask(L.familyId, g, kim), { from: id(kim) })
    return r.ok ? 'kabul' : r.code
  }
  return { L, al }
}

test('6: yönetici sürekli görevi yalnız alanındaki işçiye verir', (t) => {
  t.is(kurulum(YER_B).al(K.husniye), 'YETKI_ALANI_DISI')
  t.is(kurulum(YER_A).al(K.husniye), 'kabul')
  t.is(kurulum(YER_B).al(K.kerem), 'kabul', 'sahip her yerde')
})

test('f: TASK_PERMIT geçiciye görev açmaz', (t) => {
  const L = ekip()
  L.apply(ekle(L, K.irem, 'gecici', [K.kerem]))
  L.apply(olay(L, T.TASK_PERMIT, { subject: 'rol:gecici', taskTypes: ['hf.task.ocr'], allow: true }, [K.kerem]))
  L.apply(olay(L, T.TASK_PERMIT, { subject: 'uye:' + id(K.irem), taskTypes: ['hf.task.ocr'], allow: true }, [K.kerem]))
  t.is(canTask(L, id(K.irem), 'hf.task.ocr'), false)
})
