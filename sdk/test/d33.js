// SPDX-License-Identifier: Apache-2.0
// D33: kasa kurulumu kanalda (387 VAULT_SETUP_BK, 388 VAULT_SETUP_VRK). Beklenenler elle yazıldı.
const test = require('brittle')
const b4a = require('b4a')
const { ledger: { Ledger } } = require('@havenfold/core')
const S = require('..')
const A = require('../../core/records/test/helpers/family')

test('388: collectionId yoksa Kasa koleksiyonu kurulur; iki ebeveynde öneri bekler, pay üretilmez; sır verilmezse üretilir', async (t) => {
  t.alike([S.CHANNEL_COMMAND.VAULT_SETUP_BK, S.CHANNEL_COMMAND.VAULT_SETUP_VRK, S.VAULT_COMMAND.VAULT_SETUP_VRK], [387, 388, 388])
  const L = A.anaDefter()
  const now = () => A.TS0 + 60_000
  const kasa = new S.VaultApi({ ledger: L, me: A.K.kerem, now, defter: new S.LedgerApi({ ledger: L, me: A.K.kerem, now }) })
  const r = await kasa.setupRecoveryKey(null, null, { kagit: 1 })
  t.is(r.koleksiyon.durum, 'oneri', 'iki ebeveyn: diğerinin imzası gerekir')
  t.absent('paylar' in r)
  // Tek ebeveynli aile: hemen kurulur
  const { ledger: L2 } = S.LedgerApi.createFamily({ Ledger, me: A.K.kerem, displayName: 'Kerem', ts: A.TS0 })
  const k2 = new S.VaultApi({ ledger: L2, me: A.K.kerem, now, defter: new S.LedgerApi({ ledger: L2, me: A.K.kerem, now }) })
  const r2 = await k2.setupRecoveryKey(null, null, { kagit: 2 })
  t.is(r2.koleksiyon.durum, 'uygulandi')
  t.is(L2.collections.get(r2.collectionId).sensitivity, 'kasa')
  t.alike([r2.version, r2.kagitlar.length, k2.tutucu.paylar.size], [1, 2, 1], 'kurucunun payı tutucusunda, iki kâğıt')
  t.is(await (async () => { try { await new S.VaultApi({ ledger: L2, me: A.K.kerem, now }).setupRecoveryKey(null, null, { kagit: 2 }); return null } catch (e) { return e.message } })(), 'NO_LEDGER')
  t.ok(b4a.isBuffer(r2.kagitlar[0].qr) === false)
})
