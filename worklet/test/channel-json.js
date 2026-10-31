// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Açılış güvenlik incelemesi (düşük önem 6): kanal JSON'unda __proto__ anahtarı nesnenin prototipini değiştirmez.
const test = require('brittle')
const { kodla, coz } = require('../channel-json')

test('kanal-json: __proto__ anahtarı kendi alanı kalır, prototip değişmez', (t) => {
  const gelen = coz(JSON.parse('{"__proto__": {"yonetici": true}, "a": {"__proto__": {"b": 1}}, "c": [{"__proto__": {"d": 1}}]}'))
  t.is(Object.getPrototypeOf(gelen), Object.prototype)
  t.absent(gelen.yonetici, 'prototipten gelen alan yok')
  t.absent(gelen.a.b)
  t.absent(gelen.c[0].d)
  t.ok(Object.prototype.hasOwnProperty.call(gelen, '__proto__'))
  const giden = kodla(gelen)
  t.is(Object.getPrototypeOf(giden), Object.prototype)
  t.absent(giden.yonetici)
  t.is(JSON.stringify(giden), '{"__proto__":{"yonetici":true},"a":{"__proto__":{"b":1}},"c":[{"__proto__":{"d":1}}]}', 'gidip gelen aynı')
})
