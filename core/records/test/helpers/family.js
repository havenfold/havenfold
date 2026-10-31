// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Kayıt testleri için aile: defter v2.1 ana zinciri (core/core/test/helpers/v21.js) ve üye başına replika.
const b4a = require('b4a')
const { ledger: { Ledger, decodeEvent } } = require('@havenfold/core')
const { Replika } = require('../../replica')
const V = require('../../../core/test/helpers/v21')

const hex = (b) => b4a.toString(b, 'hex')

// Ana zincirin ilk n olayı (varsayılan: tamamı)
function anaDefter (n = Infinity) {
  const L = new Ledger()
  for (const f of V.anaAdimlar(L).slice(0, n)) L.apply(f())
  return L
}

// Aynı olaylardan bağımsız bir kopya (her cihazın kendi defteri)
function kopya (L) {
  const K = new Ledger()
  for (const e of L.events) K.apply(decodeEvent(require('@havenfold/core').ledger.encodeEvent(e)))
  return K
}

function replika (L, kim, opts = {}) {
  const r = new Replika({ ledger: L, me: kim, now: () => V.TS0 + 3_600_000, ...opts })
  r.sync()
  return r
}

// Bir replikanın çıkışındaki mesajları diğerine verir (bellek içi taşıyıcı)
function teslim (from, to, types = null) {
  const msgs = from.outbox.splice(0)
  const kalan = []
  for (const m of msgs) {
    if (types && !types.includes(m.type)) { kalan.push(m); continue }
    if (Array.isArray(m.to) && !m.to.includes(to.meHex)) continue // bu alıcıya gitmez
    if (m.type === 0x81) to.receiveOp(m.bytes, m.kind || 0)
    else if (m.type === 0x82) to.receiveKey(m.bytes)
    else if (m.type === 0x88) to.receiveCutoff(m.bytes)
  }
  from.outbox.push(...kalan)
  return msgs.length
}

module.exports = { ...V, hex, anaDefter, kopya, replika, teslim }
