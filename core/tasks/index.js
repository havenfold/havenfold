// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// @havenfold/tasks — görev katmanı (RFC-0002)
const { zarf: { Z }, giris } = require('@havenfold/core')
const K = require('./encoding')

// Gelen görev zarflarının kanonik çözücüleri (tek giriş noktası, inceleme 3 S7)
for (const [type, coz] of [
  [Z.TASK, K.decodeTask], [Z.TASK_ACCEPT, K.decodeAccept], [Z.TASK_REJECT, K.decodeReject], [Z.TASK_PROGRESS, K.decodeProgress],
  [Z.TASK_RESULT, K.decodeResult], [Z.TASK_CANCEL, K.decodeCancel], [Z.NODE_CAPS, K.decodeNodeCaps], [Z.TASK_DELEGATION, K.decodeDelegation]
]) giris.kaydet(type, coz)

module.exports = {
  kodlama: K,
  yetenek: require('./capability'),
  onay: require('./approval'),
  denetim: require('./audit'),
  istek: require('./request'),
  yerlestirme: require('./placement'),
  koordinator: require('./coordinator'),
  surekli: require('./standing'),
  teslim: require('./delivery')
}
