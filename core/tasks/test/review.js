// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D9: inceleme 1 bulguları, RFC-0002 (görev). Beklenen değerler elle yazılmıştır.
const test = require('brittle')
const b4a = require('b4a')
const { zarf: { Z } } = require('@havenfold/core')
const K = require('../encoding')
const Yt = require('../capability')
const { OnayDefteri } = require('../approval')
const { Isci, TOLERANS_MS } = require('../audit')
const { iptalKur } = require('../request')
const Y = require('../placement')
const { delegasyonKur, Koordinator } = require('../coordinator')
const D = require('../delivery')
const G = require('./helpers/task')
const { delegasyon } = require('./helpers/task-vector')

const { C, U, hex, SIMDI, DAY, id16, defter, caps, gorev, K_OLAYLAR } = G
const HOUR = 3_600_000
const onayli = (uye, cihazlar) => new OnayDefteri(cihazlar.map((x) => ({ uye: hex(uye.memberId), cihaz: hex(x.memberId), izin: true, at: 0 })))
const kod = (r) => (r.ok ? 'kabul' : r.code)

function belgeli (L, ek = {}) {
  const d = K.decodeDelegation(delegasyonKur(L, U.kerem, delegasyon(L, ek), { onay: onayli(U.kerem, [C.isci1, C.isci2]), now: SIMDI })).m
  const ana = gorev(L, { taskId: id16(0x71) })
  return { d, ana, k: new Koordinator({ ledger: L, me: C.isci1, task: ana, delegasyon: d, now: () => SIMDI }) }
}
const alt = (k, ana, ek = {}) => ({ taskId: id16(0x81), workerId: C.isci2.memberId, inputs: ana.inputs, params: b4a.from('{}'), deadline: SIMDI + 6 * HOUR, limits: ana.limits, ...ek })

test('görev 1 (§11.2 a): alt görev belgenin süresini aşamaz ve sürekli olamaz', (t) => {
  const L = defter()
  const { d, ana } = belgeli(L)
  const from = hex(C.isci1.memberId)
  const imzali = (ek) => K.encodeTask(L.familyId, { ...gorev(L, { taskId: id16(0x90) }), parentTaskId: d.taskId, workerId: C.isci2.memberId, inputs: ana.inputs, delegation: d, deadline: d.expiresAt, ...ek }, C.isci1)
  const isci = () => new Isci({ ledger: L, me: C.isci2, caps: caps(C.isci2), now: () => SIMDI })
  t.is(kod(isci().denetle(imzali({}), { from })), 'kabul')
  t.is(kod(isci().denetle(imzali({ deadline: d.expiresAt + TOLERANS_MS }), { from })), 'kabul', '2 dakika tolerans')
  t.is(kod(isci().denetle(imzali({ deadline: d.expiresAt + TOLERANS_MS + 1 }), { from })), 'YETKISIZ')
  t.is(kod(isci().denetle(imzali({ deadline: SIMDI + 7 * DAY }), { from })), 'YETKISIZ')
  t.is(kod(isci().denetle(imzali({ standing: true }), { from })), 'YETKISIZ')
})

test('görev 2 ve 3 (§11.2 d): her deneme kendi deadline\'ı; imzalanamazsa başarısız; iptal edilen parça bir daha gitmez', (t) => {
  let saat = SIMDI
  const y = new Y.Yerlestirici({ parcalar: [{ no: 0, isci: 'a', from: 1, to: 1 }, { no: 1, isci: 'b', from: 2, to: 2 }], adaylar: () => ['a', 'b', 'c'], sure: HOUR, ustSinir: SIMDI + 90 * 60_000, now: () => saat })
  t.alike(y.baslat().map((x) => x.deadline), [SIMDI + HOUR, SIMDI + HOUR])
  y.gonderildi(0, 't0', SIMDI + HOUR)
  t.alike(y.gonderilemedi(1, 'SURE_GECERSIZ'), [{ eylem: 'basarisiz', parca: 1, code: 'SURE_GECERSIZ' }])
  y.kabul('t0', 'a')
  saat = SIMDI + HOUR
  const r = y.tick()
  t.alike(r[1], { eylem: 'gonder', parca: 0, isci: 'b', deneme: 2, deadline: SIMDI + 90 * 60_000 }, 'yeni deadline üst sınırla')
  y.gonderildi(0, 't0b', SIMDI + 90 * 60_000)
  // Kullanıcı iptal eder: işçiye iptal gider, sonra hiçbir yol parçayı taşımaz
  t.alike(y.iptal(0), [{ eylem: 'iptal', parca: 0, taskId: 't0b', isci: 'b' }])
  t.alike(y.red('t0b', 'b'), [])
  saat += DAY
  t.alike(y.tick(), [])
  t.alike(y.sonuc('t0b', 'b', { status: 'ok', inline: b4a.alloc(0), outputs: [] }), [])
  t.alike(y.iptal(0), [])
})

test('görev 4: süresi geçen kabul edilmiş görev işçide biter, anahtarı sıfırlanır', (t) => {
  const L = defter()
  let saat = SIMDI
  const isci = new Isci({ ledger: L, me: C.isci1, caps: caps(C.isci1), now: () => saat })
  const r = isci.al(K.encodeTask(L.familyId, gorev(L, { deadline: SIMDI + HOUR }), U.kerem), { from: hex(U.kerem.memberId) })
  t.is(r.type, Z.TASK_ACCEPT)
  const key = isci.tasks.get(hex(id16(0x51))).task.inputs[0].fileKey
  saat = SIMDI + HOUR
  isci.denetle(K.encodeTask(L.familyId, gorev(L, { taskId: id16(0x52) }), U.kerem), { from: hex(U.kerem.memberId) })
  t.absent(isci.tasks.has(hex(id16(0x51))))
  t.ok(key.every((x) => x === 0))
})

test('görev 5 (§11.2 b): maxParts yalnız kabul edilen alt görevleri sayar', (t) => {
  const L = defter()
  const { k, ana } = belgeli(L)
  const from = hex(C.isci1.memberId)
  const isci = new Isci({ ledger: L, me: C.isci2, caps: caps(C.isci2, { status: 'mesgul' }), now: () => SIMDI })
  t.is(kod(isci.denetle(k.altGorev(alt(k, ana)), { from })), 'MESGUL', 'reddedilen sayılmaz')
  isci.setCaps(caps(C.isci2))
  const k2 = new Koordinator({ ledger: L, me: C.isci1, task: ana, delegasyon: k.d, now: () => SIMDI })
  t.is(isci.al(k2.altGorev(alt(k2, ana, { taskId: id16(0x82) })), { from }).type, Z.TASK_ACCEPT)
  t.is(isci.al(k2.altGorev(alt(k2, ana, { taskId: id16(0x83) })), { from }).type, Z.TASK_ACCEPT)
  const k3 = new Koordinator({ ledger: L, me: C.isci1, task: ana, delegasyon: k.d, now: () => SIMDI })
  t.is(kod(isci.denetle(k3.altGorev(alt(k3, ana, { taskId: id16(0x84) })), { from })), 'YETKISIZ', 'üçüncü kabul edilemez')
})

test('görev 6 ve 7: görülen kümesine madde 2\'den sonra ve en çok 30 gün; from zorunlu', (t) => {
  const L = defter()
  const isci = new Isci({ ledger: L, me: C.isci1, caps: caps(C.isci1), now: () => SIMDI })
  t.is(kod(isci.denetle(K.encodeTask(L.familyId, gorev(L), U.kerem))), 'YETKISIZ', 'from yok')
  // Misafirin imzası geçerli ama madde 2'de düşer: görülmüş sayılmaz
  t.is(kod(isci.denetle(K.encodeTask(L.familyId, gorev(L, { taskId: id16(0x5a), requester: C.misafir2.memberId }), C.misafir2), { from: hex(C.misafir2.memberId) })), 'YETKISIZ')
  t.absent(isci.seen.has(hex(id16(0x5a))))
  isci.denetle(K.encodeTask(L.familyId, gorev(L, { taskId: id16(0x5b), deadline: SIMDI + 7 * DAY }), U.kerem), { from: hex(U.kerem.memberId) })
  t.is(isci.seen.get(hex(id16(0x5b))), SIMDI + 7 * DAY)
})

test('görev 8 (§11.2 c): telefon 5 dakika payla üretir, işçi 2 dakika tolerans tanır', (t) => {
  const L = defter()
  const from = hex(U.kerem.memberId)
  const isci = () => new Isci({ ledger: L, me: C.isci1, caps: caps(C.isci1), now: () => SIMDI })
  t.is(kod(isci().denetle(K.encodeTask(L.familyId, gorev(L, { deadline: SIMDI + 7 * DAY + TOLERANS_MS }), U.kerem), { from })), 'kabul')
  t.is(kod(isci().denetle(K.encodeTask(L.familyId, gorev(L, { deadline: SIMDI + 7 * DAY + TOLERANS_MS + 1 }), U.kerem), { from })), 'SURE_GECERSIZ')
  const { gorevKur } = require('../request')
  const g = { ...gorev(L), deadline: SIMDI + 7 * DAY - 4 * 60_000 }
  t.exception(() => gorevKur(L, U.kerem, g, { onay: onayli(U.kerem, [C.isci1]), now: SIMDI }), /SURE_GECERSIZ/)
  t.ok(gorevKur(L, U.kerem, { ...g, deadline: SIMDI + 7 * DAY - 5 * 60_000 }, { onay: onayli(U.kerem, [C.isci1]), now: SIMDI }))
})

test('görev 10 ve 12: çıktı anahtarı dışarıdan verilemez; emanet zarf kimliği sıraya bağlı', (t) => {
  const veri = b4a.alloc(40_000, 1)
  const a = D.ciktiHazirla(veri, { fileKey: b4a.alloc(32, 7) })
  t.absent(b4a.equals(a.outputs[0].fileKey, b4a.alloc(32, 7)))
  t.unlike(D.ciktiHazirla(veri).outputs[0].fileKey, D.ciktiHazirla(veri).outputs[0].fileKey)
  t.alike(D.ciktiHazirlaVektor(veri, { fileKey: b4a.alloc(32, 7) }).outputs[0].fileKey, b4a.alloc(32, 7))
  t.unlike(D.zarfKimligi(id16(1), 0), D.zarfKimligi(id16(1), 1))
  t.is(D.zarfKimligi(id16(1), 0).byteLength, 16)
})

test('görev 9 (§11.2 f) ve 4.4: NODE_CAPS yalnız imzalı belgeye; isteyen koleksiyonun okuyucusu olmalı', (t) => {
  const L = defter()
  const me = hex(C.isci2.memberId)
  const sahte = { ...delegasyon(L), sig: b4a.alloc(64) }
  t.absent(Yt.capsAlicisiMi(L, me, hex(C.isci1.memberId), [sahte], SIMDI))
  // Ecem (çocuk) OCR izni var ama Olaylar'ın okuyucusu değil
  const isci = new Isci({ ledger: L, me: C.isci1, caps: caps(C.isci1), now: () => SIMDI })
  t.is(kod(isci.denetle(K.encodeTask(L.familyId, gorev(L, { requester: U.ecem.memberId, collectionId: K_OLAYLAR }), U.ecem), { from: hex(U.ecem.memberId) })), 'YETKISIZ')
})

test('4.14: ilk kullanım onayı kişi başına', (t) => {
  const kisi = 'aa'.repeat(16)
  const o = new OnayDefteri([], { personOf: (id) => (id === 'bb'.repeat(16) || id === kisi ? kisi : null) })
  o.ver(kisi, 'cc'.repeat(16), true)
  t.ok(o.var('bb'.repeat(16), 'cc'.repeat(16)), 'aynı kişinin ek kimliği')
  t.absent(o.var('dd'.repeat(16), 'cc'.repeat(16)))
  t.absent(iptalKur === null)
})

test('ekip 15: NOTICE olmayan yerde kamera görevi AYDINLATMA_YOK; ekip: false imaj EKIPTE_YASAK_TUR', (t) => {
  const { Ledger, T } = require('@havenfold/core').ledger
  const { DEFAULT_POLICY } = require('@havenfold/core').policy
  const V = require('../../core/test/helpers/v21')
  const { ekipteIzinli } = require('../audit')
  const L = new Ledger({ now: () => SIMDI })
  const yer = b4a.alloc(16, 0xa1)
  L.apply(V.genesis())
  L.apply(V.olay(L, T.KIND, { kind: 'ekip' }, [V.K.kerem]))
  L.apply(V.olay(L, T.PROTOCOL_LEVEL, { level: '2.1' }, [V.K.kerem]))
  L.apply(V.olay(L, T.POLICY, { policy: { ...DEFAULT_POLICY, maxMembers: 32 } }, [V.K.kerem]))
  L.apply(V.olay(L, T.PLACE, { placeId: yer, name: 'Şube', kind: 'sube', remove: false }, [V.K.kerem]))
  L.apply(V.olay(L, T.ASSIGN, { subjectId: V.K.kerem.memberId, placeIds: [yer] }, [V.K.kerem]))
  L.apply(V.cihazEkle(L, C.isci1, [V.K.kerem], { placeId: yer }))
  const cid = b4a.alloc(16, 0x51)
  L.apply(V.olay(L, T.COLLECTION, { collectionId: cid, name: 'Yer:A', kind: 'genel', readers: ['rol:sahip'], writers: ['rol:sahip'], sensitivity: 'normal', taskAccess: true, history: true, dropKey: b4a.alloc(32) }, [V.K.kerem]))
  const izin = { ekip: true, kisiOlcer: false, yuz: false, plaka: false }
  const isci = (imaj) => new Isci({ ledger: L, me: C.isci1, caps: caps(C.isci1, { tasks: [{ type: 'hf.task.vision', version: '1.0.0', standing: true }, { type: 'hf.task.ocr', version: '1.2.0', standing: false }] }), now: () => SIMDI, imajlar: () => imaj })
  const g = (ek) => K.encodeTask(L.familyId, { ...gorev(L, { requester: V.K.kerem.memberId, collectionId: cid, ...ek }) }, V.K.kerem)
  const from = hex(V.K.kerem.memberId)
  t.is(kod(isci(izin).denetle(g({ type: 'hf.task.vision', version: '1.0.0' }), { from })), 'AYDINLATMA_YOK')
  t.is(kod(isci({ ...izin, yuz: true }).denetle(g({}), { from })), 'EKIPTE_YASAK_TUR')
  t.is(kod(isci(null).denetle(g({}), { from })), 'EKIPTE_YASAK_TUR')
  L.apply(V.olay(L, T.NOTICE, { placeId: yer, textBlobId: b4a.alloc(32, 1), signBlobId: b4a.alloc(32, 2), textVersion: 'mekan-aydinlatma-2026.1', cameraCount: 2, outbound: [], remove: false }, [V.K.kerem]))
  t.is(kod(isci(izin).denetle(g({ type: 'hf.task.vision', version: '1.0.0', taskId: id16(0x60) }), { from })), 'kabul')
  t.absent(ekipteIzinli({ ekip: true, kisiOlcer: true, yuz: false, plaka: false }))
})
