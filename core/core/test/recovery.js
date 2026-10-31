// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// NODE_RECOVERY (0xDE; RFC-0007 §8.5, §13.6, §14): kodlama ve imza, tür kuralları, oturum ve yol süzgeci, töreni
// yapan ebeveyn
const test = require('brittle')
const b4a = require('b4a')
const { Ledger } = require('../ledger/ledger')
const { Z, typeAllowed } = require('../protocol/envelope')
const giris = require('../protocol/ingress')
const R = require('../protocol/recovery')
const V = require('./helpers/v21')

const { C, K, hex } = V
const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }

function defter () {
  const L = new Ledger({ now: () => V.TS0 })
  for (const f of V.anaAdimlar(L)) L.apply(f())
  return L
}

test('NODE_RECOVERY: kodlama, imza, tür kuralları', (t) => {
  const L = defter()
  const anahtar = b4a.alloc(32, 0xab)
  const b = R.encodeNodeRecovery(L.familyId, { nodeId: C.isci1.memberId, kind: 'luks-kurtarma', secret: anahtar }, C.isci1)
  const d = R.decodeNodeRecovery(b)
  t.alike([hex(d.m.nodeId), d.m.kind, d.m.secret], [hex(C.isci1.memberId), 'luks-kurtarma', anahtar])
  t.ok(R.verifyNodeRecovery(L.familyId, d, L.devices.get(hex(C.isci1.memberId)).signPub), 'düğümün imzası')
  t.absent(R.verifyNodeRecovery(L.familyId, d, L.members.get(hex(K.kerem.memberId)).signPub), 'başkasının anahtarıyla tutmaz')
  t.absent(R.verifyNodeRecovery(b4a.alloc(16, 9), d, L.devices.get(hex(C.isci1.memberId)).signPub), 'başka aile')
  const alindi = R.decodeNodeRecovery(R.encodeNodeRecovery(L.familyId, { nodeId: C.isci1.memberId, kind: 'alindi' }, K.kerem))
  t.alike([alindi.m.kind, alindi.m.secret.byteLength], ['alindi', 0])
  t.ok(R.verifyNodeRecovery(L.familyId, alindi, L.members.get(hex(K.kerem.memberId)).signPub))
  t.is(hataOf(() => R.encodeNodeRecovery(L.familyId, { nodeId: C.isci1.memberId, kind: 'luks-kurtarma', secret: b4a.alloc(31) }, C.isci1)), 'INVALID_MESSAGE', '32 bayt')
  t.is(hataOf(() => R.encodeNodeRecovery(L.familyId, { nodeId: C.isci1.memberId, kind: 'alindi', secret: b4a.alloc(1) }, K.kerem)), 'INVALID_MESSAGE', 'alındı boş')
  t.is(hataOf(() => R.encodeNodeRecovery(L.familyId, { nodeId: C.isci1.memberId, kind: 'baska' }, K.kerem)), 'INVALID_MESSAGE')
  t.is(hataOf(() => R.decodeNodeRecovery(b4a.concat([b.subarray(0, -64), b4a.from([0]), b.subarray(-64)]))), 'INVALID_MESSAGE', 'kanonik')
  t.is(R.ETIKET, 'hf/node-recovery/')
  t.is(R.KAYIT_TURU, 'hf.node.luks-kurtarma')
})

test('NODE_RECOVERY: üye ↔ cihaz oturumunda iki yön; yalnız doğrudan; misafire yok', (t) => {
  const L = defter()
  t.ok(typeAllowed('uye', 'cihaz', Z.NODE_RECOVERY, 'gelen'), 'düğümden telefona anahtar')
  t.ok(typeAllowed('cihaz', 'uye', Z.NODE_RECOVERY, 'gelen'), 'telefondan düğüme alındı')
  t.absent(typeAllowed('uye', 'misafir', Z.NODE_RECOVERY, 'gelen'))
  t.absent(typeAllowed('cihaz', 'cihaz', Z.NODE_RECOVERY, 'gelen'), 'cihazlar arası yok')
  const b = R.encodeNodeRecovery(L.familyId, { nodeId: C.isci1.memberId, kind: 'luks-kurtarma', secret: b4a.alloc(32, 1) }, C.isci1)
  const isci = hex(C.isci1.memberId)
  const g = giris.gelenZarf({ myRole: 'uye', peerRole: 'cihaz', type: Z.NODE_RECOVERY, bytes: b, L, gonderen: isci, yol: 'dogrudan' })
  t.is(g.mesaj.m.kind, 'luks-kurtarma', 'kanonik çözücü kayıtlı')
  t.is(hataOf(() => giris.gelenZarf({ myRole: 'uye', peerRole: 'cihaz', type: Z.NODE_RECOVERY, bytes: b, L, gonderen: isci, yol: 'emanet' })), 'DIRECT_ONLY')
  t.is(hataOf(() => giris.gelenZarf({ myRole: 'uye', peerRole: 'cihaz', type: Z.NODE_RECOVERY, bytes: b, L, gonderen: isci, yol: 'posta' })), 'DIRECT_ONLY')
  t.is(hataOf(() => giris.gelenZarf({ myRole: 'uye', peerRole: 'cihaz', type: Z.NODE_RECOVERY, bytes: b.subarray(1), L, gonderen: isci, yol: 'dogrudan' })), 'INVALID_MESSAGE')
})

test('NODE_RECOVERY: töreni yapan ebeveyn DEVICE_ATTACH imzacılarından', (t) => {
  const L = defter()
  t.alike(R.torenEbeveyni(L, hex(C.isci1.memberId)), [hex(K.kerem.memberId)], 'isci1\'i Kerem ekledi')
  t.alike(R.torenEbeveyni(L, hex(C.uc1.memberId)), [], 'çıkarılmış cihaz')
  t.alike(R.torenEbeveyni(L, hex(K.kerem.memberId)), [], 'cihaz değil')
})
