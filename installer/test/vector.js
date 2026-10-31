// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// protocol/vectors/erasure.json (RFC-0007 §16 madde 9–11): üretici aynı dosyayı verir; dosyadaki girdilerden yeniden hesap.
// Raporlar telefonun doğrulayıcısıyla (retirement.js) doğrulanır.
const test = require('brittle')
const b4a = require('b4a')
const F = require('../../protocol/vectors/erasure.json')
const { vektorler } = require('./helpers/erasure-vector')
const E = require('../../core/core/protocol/retirement')
const B = require('../erase/ticket')
const Y = require('../erase/method')

const buf = (h) => b4a.from(h, 'hex')
const hex = (b) => b4a.toString(b, 'hex')
const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }

test('erasure.json üretici aynı dosyayı verir', (t) => {
  t.alike(JSON.parse(JSON.stringify(vektorler())), F)
})

test('9: bilet, anahtar QR\'ı, parçalar', (t) => {
  const v = F[9]
  const m = B.biletCoz(buf(v.bilet))
  t.alike({ v: m.v, hostId: hex(m.hostId), ids: m.ids.map(hex), retireNonce: hex(m.retireNonce) }, v.biletAlanlari)
  const k = E.decodeKeyQr(v.anahtarQr)
  t.is(hex(k.reportPub), v.raporPub)
  t.alike(k.ids.map(hex), v.biletAlanlari.ids)
  t.is(k.disks, 3)
  for (const p of [v.parcalar384, v.parcalar128]) {
    const r = E.verifyWipe(v.anahtarQr, p)
    t.alike(r.raw.map(hex), v.raporlar)
    t.is(hex(r.wipeReportHash), F[10].ucDisk.ozet)
  }
  t.alike(E.encodeReportChunks(v.raporlar.map(buf), E.CHUNK_QR), v.parcalar384)
  t.alike(E.encodeReportChunks(v.raporlar.map(buf), E.CHUNK_KONSOL), v.parcalar128)
  t.is(hataOf(() => E.verifyWipe(v.anahtarQr, v.baskaOturum.parcalar)), v.baskaOturum.beklenen)
})

test('10: wipeReportHash', (t) => {
  const v = F[10]
  t.is(hex(E.wipeReportHash([buf(v.tekDisk.rapor)])), v.tekDisk.ozet)
  t.is(hex(E.wipeReportHash(v.ucDisk.raporlar.map(buf))), v.ucDisk.ozet)
  t.is(v.ucDisk.ozet, v.ucDisk.tersSiraOzeti, 'sıradan bağımsız')
  t.alike(v.ucDisk.raporlar.map((r) => hex(E.wipeReportId(buf(r)))).sort(), v.ucDisk.siraliKimlikler)
})

test('11: yöntem seçimi tablosu', (t) => {
  for (const d of F[11].durumlar) {
    const disk = { yol: '/dev/x', boyut: 1e9, luks: [], nvme: null, ata: null, hpa: null, dco: null, ...d.disk }
    const p = Y.yontemSec(disk, { uykuDenendi: !!d.uykuDenendi })
    if (d.gerek) { t.is(p.gerek, d.gerek, d.aciklama); continue }
    const s = Y.sonucDegerlendir(p, d.olcum)
    t.alike([p.method, s.result, p.beklenen], [d.method, d.result, d.beklenenIlk], d.aciklama)
  }
})
