// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Görev testleri ve vektörleri için aile: ledger-v21.json ana zincirinin devamı (RFC-0002 §15).
//
// Ana zincir (21 olay) + U5 (yetişkin) + isci2…isci8 + misafir2 + U5'in atılması. Kimlikler createIdentity({ seed:
// "defter-vektor/<ad>" }) (üyeler) ve "ledger-v21/<ad>" (cihazlar, misafirler); hepsi belirlenimci.
const b4a = require('b4a')
const { ledger: { Ledger, encodeEvent, decodeEvent } } = require('@havenfold/core')
const V = require('../../../core/test/helpers/v21')
const { at } = require('../../../core/test/helpers/ledger')
const K = require('../../encoding')

const { C, K: U, ekle, cihazEkle, misafirEkle, anaAdimlar, TS0, DAY, hex } = V

const SIMDI = TS0 + 3_600_000
const id16 = (n) => b4a.alloc(16, n)
const id32 = (n) => b4a.alloc(32, n)
const ZERO16 = b4a.alloc(16)
const ISCILER = ['isci1', 'isci2', 'isci3', 'isci4', 'isci5', 'isci6', 'isci7', 'isci8']

function gorevAdimlari (L) {
  return [
    ...anaAdimlar(L),
    () => ekle(L, U.u5, 'yetiskin', [U.kerem, U.husniye]),
    ...ISCILER.slice(1).map((ad) => () => cihazEkle(L, C[ad], [U.kerem])),
    () => misafirEkle(L, C.misafir2, [U.kerem]),
    () => at(L, U.u5, [U.kerem, U.husniye, U.irem])
  ]
}

function zincir () {
  const L = new Ledger()
  const olaylar = []
  for (const f of gorevAdimlari(L)) {
    const e = f()
    L.apply(e)
    olaylar.push(hex(encodeEvent(e)))
  }
  return { L, olaylar }
}

const ZINCIR = zincir().olaylar
// U5'in eklendiği olay: o anda aktif (atılmış üye vektöründe ledgerSeq)
const U5_SEQ = anaAdimlar(new Ledger()).length

function defter (n = ZINCIR.length, olaylar = ZINCIR) {
  const L = new Ledger({ now: () => SIMDI })
  for (const h of olaylar.slice(0, n)) L.apply(decodeEvent(b4a.from(h, 'hex')))
  return L
}

// Hazır, OCR ve yedek yapabilen işçi bildirimi
function caps (c, ek = {}) {
  return {
    nodeId: c.memberId,
    class: 'isci',
    seq: 1,
    os: 'ubuntu-24.04',
    arch: 'x86_64',
    cpuModel: 'Intel Core i5-3320M',
    cores: 4,
    ramTotalMB: 8192,
    ramFreeMB: 6000,
    diskTotalGB: 256,
    diskFreeGB: 200,
    accel: ['vaapi'],
    battery: { percent: 80, healthPct: 71, cycles: 412, tempC: 31, onAC: true },
    tempC: 48,
    uptimeSec: 86400,
    load1x100: 50,
    tpm: true,
    tasks: [
      { type: 'hf.task.ocr', version: '1.2.0', maxRamMB: 2048, standing: false, splittable: true },
      { type: 'hf.task.backup', version: '1.0.0', maxRamMB: 256, standing: false, splittable: false },
      { type: 'hf.task.transcribe', version: '1.0.0', maxRamMB: 3072, standing: false, splittable: true },
      { type: 'hf.task.vision', version: '1.0.0', maxRamMB: 2048, standing: true, splittable: false }
    ],
    maxTaskRamMB: 7168,
    storage: { holdGB: 10, blobGB: 100 },
    status: 'hazir',
    running: [],
    ...ek
  }
}

const capsBayt = (L, c, ek = {}) => K.encodeNodeCaps(L.familyId, caps(c, ek), c)

// Doğrudan görev alanları (imza isteyenin)
function gorev (L, ek = {}) {
  return {
    taskId: id16(0x51),
    parentTaskId: ZERO16,
    workerId: C.isci1.memberId,
    type: 'hf.task.ocr',
    version: '1.1.0',
    requester: U.kerem.memberId,
    inputs: [{ blobId: id32(0x61), fileKey: id32(0x62), size: 1_048_576, mime: 'application/pdf' }],
    params: b4a.from('{"langs":["tur"],"output":"text"}'),
    collectionId: V.K_TUM_AILE,
    ledgerSeq: L.len - 1,
    deadline: SIMDI + DAY,
    limits: { ramMB: 2048, minutes: 30, diskMB: 1024 },
    standing: false,
    delegation: null,
    ...ek
  }
}

module.exports = { ...V, U, at, SIMDI, id16, id32, ZERO16, ISCILER, gorevAdimlari, zincir, ZINCIR, U5_SEQ, defter, caps, capsBayt, gorev }
