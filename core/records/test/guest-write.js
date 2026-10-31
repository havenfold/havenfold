// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// protocol/vectors/guest-write.json (RFC-0030 §15): olay 36'nın defter kuralları ve misafirin REC_DROP'unun kayıt
// katmanındaki sonucu, dosyadaki girdilerden yeniden hesaplanır. Beklenen değerler dosyada elle seçilmiş durumlardır.
const test = require('brittle')
const b4a = require('b4a')
const { ledger: { Ledger, decodeEvent, encodeEvent }, encoding: { eventHash } } = require('@havenfold/core')
const { Replika } = require('../replica')
const { decodeInner } = require('../encoding')
const F = require('../../../protocol/vectors/guest-write.json')
const V = require('../../core/test/helpers/v21')

const hex = (b) => b4a.toString(b, 'hex')
const coz = (h) => decodeEvent(b4a.from(h, 'hex'))
const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
function zincir (n = F.zincirler.ana.length, ek = null) {
  const L = new Ledger()
  for (const o of F.zincirler.ana.slice(0, n)) L.apply(coz(o.olay))
  if (ek) L.apply(coz(F.ekler[ek].olay))
  return L
}

test('vektörler: guest-write.json üretici aynı dosyayı verir (belirlenimci)', (t) => {
  const { vektorler } = require('./helpers/guest-write-vector')
  t.alike(JSON.parse(JSON.stringify(vektorler())), F)
})

test('vektörler: misafir-yazma zinciri ve ekler uygulanır; olay 36 var', (t) => {
  const L = new Ledger()
  for (const o of F.zincirler.ana) {
    const e = coz(o.olay)
    t.is(hex(encodeEvent(e)), o.olay)
    L.apply(e)
    t.is(hex(eventHash(e)), o.bas)
  }
  t.ok(F.zincirler.ana.some((o) => o.tur === 36))
  t.is(L.level, '2.3')
  for (const ad of Object.keys(F.ekler)) t.is(hex(zincir(undefined, ad).head), F.ekler[ad].bas, ad)
})

test('vektörler: misafir-yazma defter durumları (RFC-0030 §3, §16)', (t) => {
  t.ok(F.defter.length >= 3)
  for (const d of F.defter) {
    const L = zincir(d.onek)
    const e = coz(d.olay)
    if (d.gecerli) {
      L.apply(e)
      t.is(hex(L.head), d.bas, d.aciklama)
    } else {
      t.is(hataOf(() => L.apply(e)), d.hata, d.aciklama)
    }
  }
})

test('vektörler: misafir-yazma bırakmaları (RFC-0030 §4)', (t) => {
  t.is(F.birakmalar.length, 6)
  for (const b of F.birakmalar) {
    const L = zincir(undefined, b.zincir === 'ana' ? null : b.zincir)
    const r = new Replika({ ledger: L, me: V.K.kerem, now: () => V.TS0 + 3_600_000 })
    r.sync()
    r.addDropSecret(F.collectionId, b4a.from(F.dropSecret, 'hex'))
    t.is(hex(r.keys.dropsOf(F.collectionId)[0].pub), F.dropKey)
    t.is(decodeInner(b4a.from(b.ic, 'hex')).ledgerSeq, b.ledgerSeq)
    const s = r.receiveOp(b4a.from(b.drop, 'hex'), 1)
    t.is(s.status === 'gecerli' ? 'gecerli' : s.code, b.beklenen, b.aciklama)
  }
})
