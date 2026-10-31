// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// havenfold-node — düğüm yazılımı (RFC-0007). Lisans: MPL-2.0 (kurucu §17.1).
module.exports = {
  ipc: {
    turler: require('./ipc/types'),
    cerceve: require('./ipc/frame'),
    sunucu: require('./ipc/server')
  },
  denetci: require('./supervisor'),
  podman: require('./podman'),
  saglik: require('./health'),
  surum: require('./release'),
  yetki: require('./privilege-helper'),
  guncelleme: require('./update'),
  dugumZarf: require('./node-envelope'),
  komut: require('./command'),
  qr: require('./qr')
}
