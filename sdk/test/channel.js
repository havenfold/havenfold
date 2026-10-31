// SPDX-License-Identifier: Apache-2.0
// RFC-0025 §2 vektörü (protocol/vectors/channel.json): komut numaraları, öneri listesi ve yerel ret.
const test = require('brittle')
const b4a = require('b4a')
const { ledger: { decodeEvent } } = require('@havenfold/core')
const S = require('..')
const A = require('../../core/records/test/helpers/family')
const F = require('../../protocol/vectors/channel.json')

const hex = (b) => b4a.toString(b, 'hex')

test('kanal vektörü: komut numaraları SDK sabitleriyle aynı; her komutun SDK yöntemi var', (t) => {
  for (const k of F.komutlar) t.is(S.CHANNEL_COMMAND[k.ad], k.no, k.ad) // sonraki numaralar channel-v2.json'da
  for (const k of F.komutlar) {
    const [sinif, yontem] = k.sdk.split('.')
    t.is(typeof S[sinif].prototype[yontem], 'function', k.sdk)
  }
  t.is(S.AI_COMMAND.AI_EXTRACT, 272)
  t.is(S.AI_COMMAND.AI_SAVE, 273)
})

test('kanal vektörü: öneri olayı, PROPOSALS sonucu ve yerel ret', (t) => {
  const L = A.anaDefter()
  const d = new S.LedgerApi({ ledger: L, me: A.K.kerem, now: () => A.TS0 + 50_000 })
  const r = d.removeMember(hex(A.K.irem.memberId), { reason: 'test', wipe: true })
  t.is(hex(require('@havenfold/core').ledger.encodeEvent(r.event)), F.oneri.olay)
  t.alike(d.listProposals(), F.oneri.PROPOSALS)
  t.alike(Object.keys(F.oneri.PROPOSALS[0]).filter((k) => k !== 'wipe'), F.komutlar.find((k) => k.no === 225).sonuc)
  // Aynı olay başka telefona LEDGER_PROPOSE ile gelse de aynı öneri kimliği
  const d2 = new S.LedgerApi({ ledger: A.anaDefter(), me: A.K.husniye, now: () => A.TS0 + 50_000 })
  t.is(d2.oneriler.add(decodeEvent(b4a.from(F.oneri.olay, 'hex')), A.TS0 + 50_000), F.oneri.PROPOSALS[0].proposalId)
  d.rejectProposal(F.oneri.PROPOSALS[0].proposalId)
  t.alike(d.listProposals(), F.oneri.PROPOSAL_REJECT.sonra)
  try { d.rejectProposal(F.oneri.PROPOSALS[0].proposalId); t.fail() } catch (err) { t.is(err.message, F.oneri.PROPOSAL_REJECT.yeniden) }
})
