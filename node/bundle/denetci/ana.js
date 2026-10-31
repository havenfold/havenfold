// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// denetci/ana.js — denetçinin paketteki giriş dosyası (RFC-0007 §4.1, §5; havenfold-denetci.service ExecStart)
// Paket düzeni: <sürüm>/denetci/ana.js, kod <sürüm>/lib/ altında (node/scripts/pack.sh). Mantık node/supervisor-main.js'te.
'use strict'
require('../lib/node/supervisor-main').ana()
