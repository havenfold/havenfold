// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// RFC-0007 §14: düğüm zarf numaraları ve oturum kuralları
const test = require('brittle')
const { Z, typeAllowed, YALNIZ_DOGRUDAN_DUGUM } = require('../protocol/envelope')

test('düğüm zarfları: numaralar ve oturum tablosu', (t) => {
  t.alike([Z.NODE_HEALTH, Z.UPDATE_HAVE, Z.UPDATE_REQ, Z.UPDATE_DATA, Z.UPDATE_APPROVE, Z.RETIRE_STATE, Z.NODE_RECOVERY], [0xd8, 0xd9, 0xda, 0xdb, 0xdc, 0xdd, 0xde])
  t.ok(typeAllowed('uye', 'cihaz', Z.NODE_HEALTH, 'gelen'), 'cihazdan üyeye sağlık')
  t.ok(typeAllowed('cihaz', 'cihaz', Z.UPDATE_REQ, 'gelen'), 'cihaz ↔ cihaz paylaşım')
  t.ok(typeAllowed('cihaz', 'uye', Z.UPDATE_APPROVE, 'gelen'), 'üyeden onay')
  t.absent(typeAllowed('uye', 'cihaz', Z.UPDATE_APPROVE, 'gelen'), 'cihaz onay göndermez')
  t.absent(typeAllowed('cihaz', 'cihaz', Z.UPDATE_APPROVE, 'gelen'))
  t.absent(typeAllowed('uye', 'misafir', Z.NODE_HEALTH, 'gelen'), 'misafire yok')
  t.ok(YALNIZ_DOGRUDAN_DUGUM.has(Z.NODE_HEALTH) && !YALNIZ_DOGRUDAN_DUGUM.has(Z.UPDATE_APPROVE))
})
