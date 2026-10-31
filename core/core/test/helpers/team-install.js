// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// İnceleme 7 (D10 ekip) testleri için kurulum: iki şubeli ekip ve olay kurucular
const b4a = require('b4a')
const { Ledger, T, decodeEvent, encodeEvent } = require('../../ledger/ledger')
const { DEFAULT_POLICY } = require('../../ledger/policy')
const V = require('./v21')

const { K, C, hex, olay, ekle, genesis, cihazEkle, TS0 } = V
const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const id = (k) => hex(k.memberId)
const DAY = 86_400_000
const YER_A = b4a.alloc(16, 0xa1)
const YER_B = b4a.alloc(16, 0xb2)
const yerOlay = (L, p, imz = [K.kerem], remove = false) => olay(L, T.PLACE, { placeId: p, name: 'Şube', kind: 'sube', remove }, imz)
const ata = (L, kim, yerler, imz) => olay(L, T.ASSIGN, { subjectId: kim.memberId, placeIds: yerler }, imz)
const dondur = (L, eski, yeni, imz) => olay(L, T.ROTATE_DEVICE, { oldMemberId: eski.memberId, newDeviceCert: yeni.deviceCert, ceremonyTranscriptHash: b4a.alloc(32, 7) }, imz)
const cikar = (L, kim, imz, wipe = false) => olay(L, T.REMOVE_MEMBER, { memberId: kim.memberId, reason: 'x', wipe }, imz)
const sure = (L, kim, expiresAt, imz = [K.kerem]) => olay(L, T.TERM, { memberId: kim.memberId, expiresAt }, imz)

function ekip (now = () => TS0) {
  const L = new Ledger({ now })
  L.apply(genesis())
  L.apply(olay(L, T.KIND, { kind: 'ekip' }, [K.kerem]))
  L.apply(olay(L, T.PROTOCOL_LEVEL, { level: '2.1' }, [K.kerem]))
  L.apply(olay(L, T.POLICY, { policy: { ...DEFAULT_POLICY, maxMembers: 32 } }, [K.kerem]))
  L.apply(yerOlay(L, YER_A))
  L.apply(yerOlay(L, YER_B))
  L.apply(ata(L, K.kerem, [YER_A, YER_B], [K.kerem]))
  return L
}
const kopya = (L) => Ledger.fromEvents(L.events.map((e) => decodeEvent(encodeEvent(e))), { now: () => TS0 })

module.exports = { ...V, hataOf, id, DAY, YER_A, YER_B, yerOlay, ata, dondur, cikar, sure, ekip, kopya }
