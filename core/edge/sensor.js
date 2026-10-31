// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// sensor.js — sensör modu (RFC-0008 §11.7; §17 adım 9)
//
// Uç `UC_CONFIG.sensors` listesindeki sensörleri okur (okuma ve eşik yerli modülündür) ve eşik aşımında olayı RFC-0001
// §10'daki REC_DROP ile yapılandırmada seçilmiş (`targets: ['koleksiyon:<id>']`, açıklama 2 madde 1) `kind = 'olaylar'`
// koleksiyonuna bırakır. Koleksiyonun writers listesinde `device:<ucId>` bulunmalıdır
// (ebeveyn COLLECTION olayıyla ekler, RFC-0003 §5.9; işçinin sürekli görevdeki kuralıyla aynı). Uç olayları okuyamaz.
//
//   tür:   ivme → hf.uc.hareket, isik → hf.uc.isik, yakinlik → hf.uc.yakinlik, basinc → hf.uc.basinc
//   gövde: _v: 1, _t, _subj: 'device:<uç hex16>' (RFC-0006 §4.2) + sensor, value
//
// `value` tam sayıdır (ölçeği yerli modül seçer: lüks, hPa × 100, mm/s² …). Her tür en çok dakikada bir bırakılır; bu sınır,
// mod, sensör listesi, pencere ve görünürlük kapısı (güncel UC_STATUS) edge.js'teki UcDurumu'ndadır.
const b4a = require('b4a')
const { sealDrop, appendRecordId, dropOpIdOf, kodlama: { OP, decodeRecDrop } } = require('@havenfold/records')
const K = require('./encoding')

const { hex, fail } = K
const SENSOR_TURU = { ivme: 'hf.uc.hareket', isik: 'hf.uc.isik', yakinlik: 'hf.uc.yakinlik', basinc: 'hf.uc.basinc' }
const ARALIK_MS = 60_000
const isZero = (b) => b.every((x) => x === 0)

/** Uç bu koleksiyona bırakabilir mi: olaylar koleksiyonu, bırakma anahtarı açık, writers'ta device:<uç>, uç aktif */
function birakabilir (L, collectionId, ucId) {
  const col = L.collections.get(hex(collectionId))
  return !!col && col.kind === 'olaylar' && !isZero(col.dropKey) && col.writers.includes('device:' + hex(ucId)) && !!L.devices.get(hex(ucId))?.active
}

/**
 * Sensör olayının REC_DROP'u. me: ucun kimliği { memberId, signKeyPair }; hlc: kayıt saati (Hlc.next). Dönüş { bytes, opId,
 * recordId, type }. Hata INVALID_SENSOR, INVALID_VALUE, NO_DROP_PERMISSION
 */
function sensorBirakmasi (L, { me, collectionId, sensor, value, t, hlc }) {
  const type = SENSOR_TURU[sensor]
  if (!type) fail('INVALID_SENSOR')
  if (!Number.isSafeInteger(value) || !Number.isSafeInteger(t) || t < 0) fail('INVALID_VALUE')
  if (!birakabilir(L, collectionId, me.memberId)) fail('NO_DROP_PERMISSION')
  const col = L.collections.get(hex(collectionId))
  const fields = [
    { name: '_v', value: 1 }, { name: '_t', value: t }, { name: '_subj', value: 'device:' + hex(me.memberId) },
    { name: 'sensor', value: sensor }, { name: 'value', value }
  ]
  const inner = {
    recordId: appendRecordId(me.memberId, hlc), op: OP.APPEND, type, fields, hlc, authorId: me.memberId,
    ledgerSeq: L.len - 1, ledgerHash: L.head
  }
  const bytes = sealDrop({ familyId: L.familyId, collectionId: b4a.from(col.id, 'hex'), dropKey: col.dropKey, inner, signer: me })
  return { bytes, opId: hex(dropOpIdOf(decodeRecDrop(bytes))), recordId: hex(inner.recordId), type }
}

module.exports = { SENSOR_TURU, ARALIK_MS, birakabilir, sensorBirakmasi }
