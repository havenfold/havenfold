// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Açılış güvenlik incelemesi (düşük önem 6): __proto__, constructor ve prototype alan adı olamaz; görünüm nesnesi
// alan adlarından prototip değiştirmez. _ ile başlayan sistem alanları geçerli kalır.
const test = require('brittle')
const b4a = require('b4a')
const c = require('compact-encoding')
const Kd = require('../encoding')
const { view } = require('../merge')

const hataOf = (f) => { try { f(); return null } catch (err) { return err.message } }
const base = { recordId: b4a.alloc(16), op: 0, type: 'yuva.x', fields: [], hlc: 1n, authorId: b4a.alloc(16), ledgerSeq: 0, ledgerHash: b4a.alloc(32) }

test('alan adı: __proto__, constructor, prototype reddedilir; sistem alanları geçerli', (t) => {
  for (const ad of ['__proto__', 'constructor', 'prototype']) {
    t.is(hataOf(() => Kd.validateName(ad)), 'INVALID_FIELD_NAME', ad)
    t.is(hataOf(() => Kd.encodeInner({ ...base, fields: [{ name: ad, value: 1 }] })), 'INVALID_FIELD_NAME', ad + ' yazılmaz')
    // Kurallar atlanarak kodlanmış iç gövde de çözülmez
    const ham = c.encode(Kd.opInner, { ...base, v: Kd.INNER_V, recNonce: null, fields: [{ name: ad, value: 1 }] })
    t.is(hataOf(() => Kd.decodeInner(ham)), 'INVALID_FIELD_NAME', ad + ' okunmaz')
  }
  for (const ad of ['_keep', '_t', '_subj', 'proto', 'constructor_', 'a.prototype']) t.is(hataOf(() => Kd.validateName(ad)), null, ad + ' geçerli')
})

test('görünüm: alan adı prototipi değiştirmez', (t) => {
  const s = (n) => ({ hlc: BigInt(n), authorId: b4a.alloc(16), opId: b4a.alloc(32, n) })
  const st = { type: 'yuva.x', deletedAt: null, lastPut: s(1), fields: new Map([['__proto__', { value: { kirli: true }, ...s(1), ilk: s(1) }], ['a', { value: 1, ...s(1), ilk: s(1) }]]) }
  const v = view(b4a.alloc(16), st)
  t.is(Object.getPrototypeOf(v.fields), Object.prototype)
  t.absent(v.fields.kirli, 'prototipten gelen alan yok')
  t.ok(Object.prototype.hasOwnProperty.call(v.fields, '__proto__'), 'ad kendi alanı olarak kalır')
  t.is(v.fields.a, 1)
})
