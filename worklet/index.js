// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// @havenfold/worklet — telefondaki çekirdek paketi: kalıcı durum, Bare Kit IPC çerçeveleri, başlatıcı, görev kanal
// komutlarının sunucu tarafı
'use strict'
module.exports = {
  ...require('./start'),
  persistence: require('./persistence'),
  ipc: require('./ipc'),
  ...require('./task-channel') // taskChannel, TASK_COMMAND: görev kanal komutları 250–255 (ürün sunucusu katar)
}
