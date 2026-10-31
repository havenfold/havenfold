// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Codex 12. tur: çerçeve okuyucuları (IPC, uç akış soketi) parçaları biriktirir, her parçada tamponu yeniden kopyalamaz.
// Bayt bayt beslenen 1 MiB'lık çerçeve eskiden ~n²/2 bayt kopyalıyordu (denetçiyi ve kök yardımcıyı dakikalarca meşgul eder).
const test = require('brittle')
const b4a = require('b4a')
const C = require('../ipc/frame')
const { IPC } = require('../ipc/types')
const AS = require('../edge/stream-socket')

function kopyaSay (t) {
  const asil = b4a.concat
  let n = 0
  b4a.concat = (liste, ...x) => { const r = asil(liste, ...x); n += r.byteLength; return r }
  t.teardown(() => { b4a.concat = asil })
  return () => n
}

test('IPC okuyucusu: bayt bayt beslenen büyük çerçeve doğrusal kopyayla çözülür', (t) => {
  const f = C.cerceveYaz(IPC.HATA, 0, { reqId: 3, code: 'X', detail: 'a'.repeat(64 * 1024) })
  const say = kopyaSay(t)
  const r = new C.CerceveOkuyucu()
  const gelen = []
  for (let i = 0; i < f.byteLength; i++) gelen.push(...r.besle(f.subarray(i, i + 1)))
  t.is(gelen.length, 1)
  t.is(C.mesajCoz(gelen[0]).mesaj.detail.length, 64 * 1024)
  t.ok(say() < 4 * f.byteLength, 'kopyalanan bayt ' + say())
})

test('IPC okuyucusu: bir parçada birden çok çerçeve ve parçalara bölünmüş önek', (t) => {
  const a = C.cerceveYaz(IPC.HATA, 0, { reqId: 1, code: 'A', detail: '' })
  const b = C.cerceveYaz(IPC.HATA, 0, { reqId: 2, code: 'B', detail: 'xy' })
  const hepsi = b4a.concat([a, b, a])
  const r = new C.CerceveOkuyucu()
  const k = a.byteLength + 2 // ikinci çerçevenin önekinin ortası
  const gelen = [...r.besle(hepsi.subarray(0, k)), ...r.besle(hepsi.subarray(k, k + 1)), ...r.besle(hepsi.subarray(k + 1))]
  t.alike(gelen.map((x) => C.mesajCoz(x).mesaj.reqId), [1, 2, 1])
  t.alike(r.besle(b4a.alloc(0)), [])
})

test('uç akış soketi okuyucusu: bayt bayt beslenen büyük kare doğrusal kopyayla çözülür', (t) => {
  const f = AS.kare({ key: true, ts: 9, data: b4a.alloc(64 * 1024, 7) })
  const say = kopyaSay(t)
  const o = new AS.Okuyucu()
  const gelen = []
  for (let i = 0; i < f.byteLength; i++) gelen.push(...o.besle(f.subarray(i, i + 1)))
  t.is(gelen.length, 1)
  t.is(AS.kareCoz(gelen[0].govde).data.byteLength, 64 * 1024)
  t.ok(say() < 4 * f.byteLength, 'kopyalanan bayt ' + say())
  const iki = o.besle(b4a.concat([AS.anahtarIste(), AS.kapat('BITTI')]))
  t.alike(iki.map((x) => x.tur), [AS.TUR.ANAHTAR, AS.TUR.KAPAT])
})
