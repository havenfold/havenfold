// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// cekirdek/kutu.js — kutu çekirdeğinin paketteki giriş dosyası (RFC-0007 §4.1, §5; havenfold-kutu.service ExecStart)
// Paket düzeni: <sürüm>/cekirdek/kutu.js, kod <sürüm>/lib/ altında (node/scripts/pack.sh). Mantık node/box.js'te.
'use strict'
/* global Bare */
if (typeof Bare !== 'undefined') {
  // RFC-0007 §4.1 çekirdeği Bare'de ister; kutu.js bugün Node modülleri kullanır. Bare desteği İstek 151'e kadar Node:
  // havenfold-kutu.service bu dosyayı paketteki node ile çalıştırır
  console.error('havenfold-kutu: BARE_DESTEKLENMIYOR: kutu çekirdeği bu sürümde Node ile çalışır (İstek 151)')
  Bare.exit(1)
} else {
  require('../lib/node/box').ana()
}
