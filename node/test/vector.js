// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// protocol/vectors/node.json (RFC-0007 §16 1–7, 12): üretici aynı dosyayı verir; dosyadaki girdilerden yeniden hesap
const test = require('brittle')
const b4a = require('b4a')
const F = require('../../protocol/vectors/node.json')
const { vektorler } = require('./helpers/node-vector')
const { ledger: { Ledger, decodeEvent } } = require('@havenfold/core')
const S = require('../release')
const H = require('../health')
const C = require('../ipc/frame')

const buf = (h) => b4a.from(h, 'hex')
const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const kok = (k) => ({ keyEpoch: k.keyEpoch, rootPub: buf(k.rootPub), nextRootHash: buf(k.nextRootHash) })
const defter = (z) => { const L = new Ledger({ now: () => 0 }); for (const h of z) L.apply(decodeEvent(buf(h))); return L }

test('node.json üretici aynı dosyayı verir', (t) => {
  t.alike(JSON.parse(JSON.stringify(vektorler())), F)
})

test('node.json girdilerinden yeniden hesap', (t) => {
  const K = kok(F[2].kokDurumu)
  for (const d of F[1].durumlar) {
    const r = d.paket
      ? hataOf(() => S.dosyaDenetle(S.bildirimCoz(buf(d.bildirim), K).m.packages[0], { ozet: S.paketOzeti(buf(d.paket)), boyut: buf(d.paket).byteLength }))
      : hataOf(() => S.bildirimCoz(buf(d.bildirim), K))
    t.is(r, d.beklenen, '1: ' + d.aciklama)
  }
  let yeni = null
  for (const d of F[2].durumlar) {
    if (d.rotasyon) {
      t.is(hataOf(() => S.rotasyonUygula(K, buf(d.rotasyon))), d.beklenen, '2: ' + d.aciklama)
      if (d.beklenen === null) yeni = S.rotasyonUygula(K, buf(d.rotasyon))
    } else t.is(hataOf(() => S.bildirimCoz(buf(d.bildirim), yeni)), d.beklenen, '2: ' + d.aciklama)
  }
  t.alike(yeni, kok(F[2].sonra))
  for (const d of F[3]) t.is(S.surumKarari(d.girdi), d.beklenen, '3: ' + d.aciklama)
  for (const d of F[4]) t.is(hataOf(() => S.versionCode(d.surum)) || S.versionCode(d.surum), d.beklenen, '4: ' + d.aciklama)
  const L5 = defter(F[5].zincir)
  const gorulen = new Map()
  for (const d of F[5].durumlar) t.is(hataOf(() => S.onayDenetle(L5, buf(d.onay), { me: F[5].nodeId, simdi: F[5].simdi, gorulen, kok: K, hedef: buf(F[5].hedefBildirim) })), d.beklenen, '5: ' + d.aciklama)
  const L6 = defter(F[6].zincir)
  t.is(H.saglikCoz(L6, buf(F[6].pilli.bytes)).power.battery.healthPct, 91)
  t.is(H.saglikCoz(L6, buf(F[6].pilsiz.bytes)).power.battery, null)
  t.is(hataOf(() => H.saglikCoz(L6, buf(F[6].bozukImza.bytes))), 'INVALID_SIGNATURE')
  for (const d of F[7].slice(0, -1)) {
    const r = H.esikler({ cpuC: 50, onAC: true, battery: null, disks: [], lastManifestAt: 1_790_000_000_000 + 40 * 86_400_000, update: 'guncel', rebootRequired: false, disk: 'luks-tpm', recoveryDelivered: true, lid: true, targetsMasked: true, wired: true, simdi: 1_790_000_000_000 + 40 * 86_400_000, ...d.girdi })
    t.alike({ status: r.status, warnings: r.warnings }, d.beklenen, '7: ' + d.aciklama)
  }
  t.alike(C.mesajCoz(buf(F[12].cerceve).subarray(4)).reqId, 7)
})

test('elle yazılmış beklenenler', (t) => {
  t.alike(F[1].durumlar.map((d) => d.beklenen), [null, 'DIGEST_MISMATCH', 'COMMITMENT_ERROR', 'ROOT_EPOCH_ERROR', 'SIGNATURE_ERROR', 'FORMAT_ERROR', 'FORMAT_ERROR'])
  t.alike(F[2].durumlar.map((d) => d.beklenen), [null, 'COMMITMENT_ERROR', 'ROOT_EPOCH_ERROR', 'SIGNATURE_ERROR', null])
  t.alike(F[3].map((d) => d.beklenen), ['kur', 'yok-say', 'onay-gerekli', 'kur', 'onay-gerekli', 'ara-surum', 'yok-say'])
  t.alike(F[4].map((d) => d.beklenen), [1002003, 'INVALID_VERSION', 'INVALID_VERSION', 0])
  t.alike(F[5].durumlar.map((d) => d.beklenen), [null, 'REPLAY', 'UNAUTHORIZED', 'INVALID_DURATION', 'WRONG_NODE', 'MANIFEST_ERROR'])
  t.is(F[7][0].beklenen.status, 'bakim')
  t.alike(F[7][0].beklenen.warnings, ['PIL_KRITIK'])
})
