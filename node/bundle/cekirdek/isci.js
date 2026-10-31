// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// cekirdek/isci.js — işçi çekirdeğinin paketteki giriş dosyası (RFC-0007 §4.1, §5; havenfold-isci.service ExecStart)
// Paket düzeni: <sürüm>/cekirdek/isci.js, kod <sürüm>/lib/ altında (node/scripts/pack.sh). Mantık node/worker.js'te.
'use strict'
/* global Bare */
if (typeof Bare !== 'undefined') {
  // RFC-0007 §4.1 çekirdeği Bare'de ister; isci.js bugün Node modülleri kullanır. Bare desteği İstek 151'e kadar Node:
  // havenfold-isci.service bu dosyayı paketteki node ile çalıştırır
  console.error('havenfold-isci: BARE_DESTEKLENMIYOR: işçi çekirdeği bu sürümde Node ile çalışır (İstek 151)')
  Bare.exit(1)
} else {
  require('../lib/node/worker').ana()
}
