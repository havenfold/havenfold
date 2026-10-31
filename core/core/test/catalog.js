// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// RFC-0020 madde 69: olay kataloğu protocol/event-types.json'dadır; paketlerin dışına uzanmamak için @havenfold/core'a
// kopyalanır (Air A2 İstek 2). İki kopya bayt bayt aynı olmalı.
const test = require('brittle')
const b4a = require('b4a')

test('katalog: @havenfold/core içindeki kopya protocol/event-types.json ile aynı', (t) => {
  if (typeof Bare !== 'undefined') { t.pass('dosya karşılaştırması yalnız Node\'da'); return }
  const fs = require('f' + 's')
  const a = fs.readFileSync(__dirname + '/../protocol/event-types.json')
  const b = fs.readFileSync(__dirname + '/../../../protocol/event-types.json')
  t.ok(b4a.equals(a, b), 'core/core/protocol/event-types.json = protocol/event-types.json')
  t.alike(require('../protocol/event-types.json'), JSON.parse(b4a.toString(b)))
})
