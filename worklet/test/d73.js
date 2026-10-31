// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D73 (inceleme 19 B14): kutu pay tuttuktan sonra yeniden başlar. Mühürlü dosyada baytlar açıkça { $h } biçiminde
// (Bare'de JSON.stringify(Buffer) düz dizi verir, { type: 'Buffer' } değil); eski Bare biçimi (düz dizi) de okunur.
// Node ve Bare'de koşar.
'use strict'
const test = require('brittle')
const b4a = require('b4a')
const sodium = require('sodium-native')
const fs = require('#fs')
const S = require('@havenfold/sdk')
const { KutuPaylari, DOSYA } = require('../../node/box-share')
const { taklitTpm } = require('../../node/tpm')
const A = require('../../core/records/test/helpers/family')
const { geciciDizin } = require('./helpers/common')

const hex = (b) => b4a.toString(b, 'hex')
const rastgele = (n) => { const b = b4a.alloc(n); sodium.randombytes_buf(b); return b }

async function kur (t) {
  const L = A.anaDefter()
  const now = () => A.TS0 + 3_600_000
  const cid = [...L.collections.values()].find((c) => c.sensitivity === 'kasa').id
  const kerem = new S.VaultApi({ ledger: L, me: A.K.kerem, now, uygunCihaz: (id) => id === hex(A.K.kutu.memberId) })
  const r = await kerem.setupRecoveryKey(cid, rastgele(32))
  const put = r.paylar.find((p) => p.sahip.id === hex(A.K.kutu.memberId)).teslim.bytes
  const dizin = geciciDizin(t, 'd73-kutu')
  const tpm = taklitTpm({ test: true, anahtar: rastgele(32) })
  const ac = () => new KutuPaylari({ ledger: L, me: A.K.kutu, dizin, tpm, now, testKipi: true })
  return { L, cid, put, dizin, tpm, ac }
}

test('kutu yeniden başlar: pay al, kapat, aç; pay ve baytları yerinde', async (t) => {
  const { cid, put, ac } = await kur(t)
  const k1 = ac()
  t.is(k1.payAl(hex(A.K.kerem.memberId), put, 'dogrudan').durum, 'yeni')
  const once = [...k1.tutucu.paylar.values()][0].share
  const k2 = ac() // yeniden başlatma: mühürden
  t.alike(k2.liste(), [cid + '|1'])
  const sonra = [...k2.tutucu.paylar.values()][0].share
  for (const a of ['secretId', 'share', 'holderId', 'commit']) t.ok(b4a.isBuffer(sonra[a]) && b4a.equals(sonra[a], once[a]), a)
  t.is(k2.payAl(hex(A.K.kerem.memberId), put, 'dogrudan').durum, 'tekrar', 'aynı pay yeniden gelince tekrar')
  t.ok(ac().liste().length === 1, 'üçüncü açılış')
})

test('eski Bare biçimi (baytlar düz sayı dizisi ya da sayı anahtarlı nesne) okunur', async (t) => {
  const { cid, put, dizin, tpm, ac } = await kur(t)
  const k1 = ac()
  k1.payAl(hex(A.K.kerem.memberId), put, 'dogrudan')
  const p = [...k1.tutucu.paylar.values()][0]
  const dizi = (b) => [...b]
  const nesne = (b) => Object.fromEntries([...b].map((x, i) => [String(i), x]))
  for (const [ad, bicim] of [['düz dizi', dizi], ['sayı anahtarlı nesne', nesne]]) {
    const eski = { paylar: [{ ...p, share: { ...p.share, secretId: bicim(p.share.secretId), share: bicim(p.share.share), holderId: bicim(p.share.holderId), commit: bicim(p.share.commit) } }], ilk: [], verilen: [] }
    fs.writeFileSync(dizin + '/' + DOSYA, tpm.muhurle(b4a.from(JSON.stringify(eski))))
    const k = ac()
    t.alike(k.liste(), [cid + '|1'], ad)
    t.ok(b4a.equals([...k.tutucu.paylar.values()][0].share.share, p.share.share), ad + ': pay baytları')
  }
})
