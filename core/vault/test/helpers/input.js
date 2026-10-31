// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Testler için kasa koleksiyonunun gerçek dönemleri ve imzalı anahtar girdileri (zarfAc bunları doğrular)
const b4a = require('b4a')
const { yetki: { Yetki }, anahtar: A } = require('@havenfold/records')
const { K_KASA } = require('../../../core/test/helpers/v21')

const hex = (b) => b4a.toString(b, 'hex')

function kasaDonemleri (L, cid = K_KASA) {
  const y = new Yetki()
  y.update(L)
  return y.epochs(hex(cid))
}

const girdi = (L, ep, n, issuer, cid = K_KASA) => A.makeKeyEntry({ familyId: L.familyId, collectionId: cid, epochSeq: ep.seq, epochHash: ep.hash, key: b4a.alloc(32, n), issuer })

// Beklenen sürüm (KASA_VERSION_RES'ten gelir): ilk payınkiyle
const bek = (p) => ({ secretId: p.secretId, kind: p.kind, version: p.version })

module.exports = { kasaDonemleri, girdi, bek }
