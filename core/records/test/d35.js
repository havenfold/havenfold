// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D35: aynı olayla birden çok okuyucu katılınca anahtar paketini, katılanlardan değil, anahtarı tutan okuyuculardan
// ilki gönderir (RFC-0001 §9.4). Eskiden sıralamada ilk okuyucu aynı olayla katılan ebeveyn çıkıyordu; onun anahtarı
// olmadığı için paket hiç gitmiyordu (Kalkan'ın iki koruyucusu, Sağlık koleksiyonunun iki okuyucusu). Beklenenler elle.
const test = require('brittle')
const { zarf: { Z } } = require('@havenfold/core')
const V = require('../../core/test/helpers/v21')
const { replika, K, K_KISISEL_IREM, hex } = require('./helpers/family')

const uye = (k) => 'uye:' + hex(k.memberId)

function esitle (rler) {
  for (let i = 0; i < 50; i++) {
    let n = 0
    for (const r of rler) {
      const msgs = r.outbox.splice(0)
      n += msgs.length
      for (const m of msgs) for (const o of rler) {
        if (o === r || (Array.isArray(m.to) && !m.to.includes(o.meHex))) continue
        if (m.type === Z.REC_OPS) o.receiveOp(m.bytes, m.kind || 0)
        else if (m.type === Z.REC_KEY) o.receiveKey(m.bytes)
        else if (m.type === Z.REC_CUTOFF) o.receiveCutoff(m.bytes)
      }
    }
    for (const r of rler) r.sync()
    if (!n) return
  }
}

test('kişisel koleksiyona iki ebeveyn aynı olayla okuyucu olur: anahtar paketini sahibi gönderir, ikisi de okur', (t) => {
  const L = require('./helpers/family').anaDefter()
  const irem = replika(L, K.irem)
  const kerem = replika(L, K.kerem)
  const husniye = replika(L, K.husniye)
  const rler = [irem, kerem, husniye]
  const cid = hex(K_KISISEL_IREM)
  const rid = irem.put(cid, null, 'yuva.defter.not', { baslik: 'yalnız İrem' })
  esitle(rler)
  t.is(kerem.get(cid, rid), null, 'okuyucu değilken okumaz')
  L.apply(V.koleksiyon(L, [K.irem], { collectionId: K_KISISEL_IREM, name: 'Kişisel', kind: 'kisisel', readers: [uye(K.irem), uye(K.kerem), uye(K.husniye)], writers: [uye(K.irem)], taskAccess: false }))
  for (const r of rler) r.sync()
  const paket = irem.outbox.filter((m) => m.type === Z.REC_KEY && m.cid === cid).flatMap((m) => m.to)
  t.alike(paket.sort(), [hex(K.kerem.memberId), hex(K.husniye.memberId)].sort(), 'İrem ikisine de paket gönderir')
  t.is(kerem.outbox.filter((m) => m.type === Z.REC_KEY && m.cid === cid).length, 0, 'anahtarı olmayan katılan göndermez')
  esitle(rler)
  t.is(kerem.get(cid, rid).fields.baslik, 'yalnız İrem')
  t.is(husniye.get(cid, rid).fields.baslik, 'yalnız İrem')
})
