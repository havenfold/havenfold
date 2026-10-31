// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Codex 12. tur: taşıyıcı HELLO'yu kanonik çözer (inceleme 3 S7). Sonuna fazla bayt eklenmiş HELLO imzası geçerli olsa da
// oturum açmaz; bulanık testin hello hedefi de aynı çözücüyü sınar.
'use strict'
const test = require('brittle')
const b4a = require('b4a')
const c = require('compact-encoding')
const { messages: M, hello: H } = require('@havenfold/core')
const T = require('..')
const A = require('../../records/test/helpers/family')

const hex = (b) => b4a.toString(b, 'hex')
const T_HELLO = 0x01

class SahteSoket {
  constructor () { this.handshakeHash = b4a.alloc(32, 7); this.d = new Map(); this.yazilan = []; this.kapali = false }
  on (a, f) { if (!this.d.has(a)) this.d.set(a, []); this.d.get(a).push(f); return this }
  once (a, f) { return this.on(a, f) }
  emit (a, ...x) { for (const f of this.d.get(a) || []) f(...x) }
  write (b) { this.yazilan.push(b) }
  destroy () { if (this.kapali) return; this.kapali = true; this.emit('close') }
}

function oturum (t, ek) {
  const L = A.anaDefter()
  const tas = new T.DhtTasiyici({ dht: {}, cihaz: () => ({ kimlik: A.K.kerem, ledger: L }), deneysel: true })
  const baglanan = []
  tas.isl = { baglandi: (p) => baglanan.push(p), koptu: () => {}, al: () => {} }
  const s = new SahteSoket()
  tas._oturum(hex(A.K.husniye.memberId), s, 0, true)
  t.teardown(() => { for (const o of tas.oturumlar.values()) o.socket.destroy(); tas.kapandi = true })
  const hello = c.encode(M.hello, H.createHello(A.K.husniye, s, L, tas.caps))
  s.emit('data', b4a.concat([b4a.from([T_HELLO]), hello, ek]))
  return { baglanan, s }
}

test('HELLO: kanonik HELLO oturumu açar', (t) => {
  const { baglanan, s } = oturum(t, b4a.alloc(0))
  t.alike(baglanan, [hex(A.K.husniye.memberId)])
  t.absent(s.kapali)
})

test('HELLO: sonuna fazla bayt eklenmiş HELLO reddedilir, oturum açılmaz', (t) => {
  const { baglanan, s } = oturum(t, b4a.from([0]))
  t.alike(baglanan, [])
  t.ok(s.kapali, 'soket kapandı')
})
