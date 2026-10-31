// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Ucun kalıcı durumu (edge.js; RFC-0008 açıklama 1, inceleme L1 U1, U2, U4, U6, U10)
const test = require('brittle')
const b4a = require('b4a')
const V = require('../../core/test/helpers/v21')
const { ledger: { Ledger } } = require('@havenfold/core')
const { uc: { UcDurumu }, akis: A } = require('..')
const VK = require('./helpers/edge-vector')

const { hex } = V
const hata = (f) => { try { f(); return 'kabul' } catch (e) { return e.message } }
const isciHex = hex(V.C.isci1.memberId)

function kur (n = 16) {
  const L = new Ledger()
  for (const f of V.anaAdimlar(L).slice(0, n)) L.apply(f())
  return L
}
const bellek = () => { const m = new Map(); return { get: (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), set: (k, v) => m.set(k, JSON.stringify(v)) } }
const U = { oturum: 'dogrudan', yerel: { gun: 1, dk: 600 }, thermal: 'normal', pil: { percent: 80, onAC: true } }
const pil = { percent: 80, tempC: 30, onAC: true }
const istek = (L, signer, x = {}) => A.akisAcKodla(L.familyId, { streamId: b4a.alloc(16, 2), ucId: V.C.uc1.memberId, purpose: 'analiz', taskId: b4a.alloc(16, 3), want: { width: 640, height: 480, fps: 5 }, configSeq: 3, ledgerSeq: 15, ...x }, signer)

test('U1: seq\'ler kalıcı ve monoton; yapılandırma yeniden başlayınca geri yüklenir; eski seq kazanamaz', (t) => {
  const L = kur()
  const saklama = bellek()
  let now = V.TS0
  const u1 = new UcDurumu({ defter: () => L, me: V.C.uc1, saklama, now: () => now })
  t.is(u1.mod, 'kapali')
  t.is(u1.profilSeq(), 1)
  t.alike(u1.yapilandirmaAl(VK.yapilandirmaBayt(L, VK.TEMEL_YAPILANDIRMA)), { kabul: true, kapatilan: [] })
  t.is(u1.durum({ battery: pil }).seq, 1)
  t.is(u1.durum({ battery: pil }).seq, 2)
  // Yeniden başlama
  const u2 = new UcDurumu({ defter: () => L, me: V.C.uc1, saklama, now: () => now })
  t.is(u2.mod, 'kamera')
  t.is(u2.configSeq, 3)
  t.is(u2.profilSeq(), 2)
  const d = u2.durum({ battery: pil })
  t.alike([d.seq, d.configSeq, d.camera.active], [3, 3, false])
  // Eski seq (2) ve aynı yapılandırma kazanamaz; büyük seq kazanır
  t.is(u2.yapilandirmaAl(VK.yapilandirmaBayt(L, { ...VK.TEMEL_YAPILANDIRMA, seq: 2 })).kabul, false)
  t.is(u2.yapilandirmaAl(VK.yapilandirmaBayt(L, VK.TEMEL_YAPILANDIRMA)).kabul, false)
  t.is(u2.yapilandirmaAl(VK.yapilandirmaBayt(L, { ...VK.TEMEL_YAPILANDIRMA, seq: 4 })).kabul, true)
  t.is(hata(() => new UcDurumu({ defter: () => L, me: V.C.uc1, saklama: null })), 'STORAGE_REQUIRED')
  now += 1
})

test('U2: güncel UC_STATUS üretilmeden kare mühürlenmez; kapanış ve yapılandırma durumu eskitir; since sabit (U10)', (t) => {
  const L = kur()
  let now = V.TS0
  const u = new UcDurumu({ defter: () => L, me: V.C.uc1, saklama: bellek(), now: () => now })
  u.yapilandirmaAl(VK.yapilandirmaBayt(L, VK.TEMEL_YAPILANDIRMA))
  const r = u.akisIstegi(istek(L, V.C.isci1), U)
  t.ok(r.kabul)
  const id = hex(r.m.streamId)
  t.absent(u.muhurlenebilir(id), 'durum yayınlanmadan mühür yok')
  const d1 = u.durum({ battery: pil })
  t.alike([d1.camera.active, d1.camera.streams.map((s) => hex(s.toId)), d1.camera.since], [true, [isciHex], V.TS0])
  t.ok(u.muhurlenebilir(id))
  now += 60_000
  // Aynı streamId ikinci kez: IZIN_YOK (U6)
  t.is(u.akisIstegi(istek(L, V.C.isci1), U).code, 'IZIN_YOK')
  // İkinci akış: kamera açılış anı değişmez
  const r2 = u.akisIstegi(istek(L, V.C.isci1, { streamId: b4a.alloc(16, 4) }), U)
  t.ok(r2.kabul)
  t.absent(u.muhurlenebilir(id), 'yeni akış durumu eskitir')
  t.is(u.durum({ battery: pil }).camera.since, V.TS0)
  u.akisKapat(hex(r2.m.streamId), 'BITTI')
  t.absent(u.muhurlenebilir(id))
  t.is(u.durum({ battery: pil }).camera.since, V.TS0)
  u.akisKapat(id, 'BITTI')
  t.is(u.durum({ battery: pil }).camera.since, 0)
  t.is(hata(() => u.akisKapat(id, 'BITTI')), 'NO_STREAM')
  // yenidenBasladi: kamera kapalıyken görünür
  u.yenidenBasladiYaz(true)
  t.is(u.durum({ battery: pil }).yenidenBasladi, true)
  u.yenidenBasladiYaz(true)
  t.ok(u.akisIstegi(istek(L, V.C.isci1, { streamId: b4a.alloc(16, 5) }), U).kabul)
  t.is(u.durum({ battery: pil }).yenidenBasladi, false)
})

test('U4: akış ömrü — pencere bitti, ısı ve pil, 24 saat, işçi ayrıldı, imzalayan ebeveyn çıktı', (t) => {
  let L = kur()
  let now = V.TS0
  const u = new UcDurumu({ defter: () => L, me: V.C.uc1, saklama: bellek(), now: () => now })
  u.yapilandirmaAl(VK.yapilandirmaBayt(L, VK.TEMEL_YAPILANDIRMA))
  const ac = (n) => u.akisIstegi(istek(L, V.C.isci1, { streamId: b4a.alloc(16, n) }), U)
  t.ok(ac(1).kabul)
  t.alike(u.denetle(U), [])
  t.alike(u.denetle({ ...U, yerel: { gun: 1, dk: 1100 } }), [{ streamId: hex(b4a.alloc(16, 1)), code: 'PENCERE_DISI' }])
  t.ok(ac(2).kabul)
  t.alike(u.denetle({ ...U, thermal: 'durdu' }).map((x) => x.code), ['SICAK'])
  t.ok(ac(3).kabul)
  t.alike(u.denetle({ ...U, pil: { percent: 10, onAC: false } }).map((x) => x.code), ['PIL'])
  t.ok(ac(4).kabul)
  now += A.AKIS_SURESI_MS
  t.alike(u.denetle(U).map((x) => x.code), ['SURE_DOLDU'])
  // İşçi defterden ayrıldı
  t.ok(ac(5).kabul)
  L.apply(V.cihazCikar(L, V.C.isci1, [V.K.kerem]))
  t.alike(u.denetle(U).map((x) => x.code), ['IZIN_YOK'])
  // Yapılandırmayı imzalayan ebeveyn (Hüsniye) aileden ayrılınca yapılandırma düşer: uç kapalı
  L = kur()
  const sk = bellek()
  const u2 = new UcDurumu({ defter: () => L, me: V.C.uc1, saklama: sk, now: () => now })
  u2.yapilandirmaAl(VK.yapilandirmaBayt(L, { ...VK.TEMEL_YAPILANDIRMA, targets: ['rol:ebeveyn'], imzaci: 'husniye' }))
  const k = u2.akisIstegi(istek(L, V.K.kerem, { purpose: 'canli', taskId: b4a.alloc(16) }), U)
  t.ok(k.kabul)
  L.apply(V.olay(L, V.T.LEAVE, { memberId: V.K.husniye.memberId }, [V.K.husniye]))
  t.alike(u2.denetle(U).map((x) => x.code), ['YAPILANDIRMA_DEGISTI'])
  t.is(u2.mod, 'kapali')
  t.is(u2.durum({ battery: pil }).configSeq, 0)
  // Yeniden başlayınca da geri yüklenmez (imzacı ebeveyn değil)
  t.is(new UcDurumu({ defter: () => L, me: V.C.uc1, saklama: sk, now: () => now }).mod, 'kapali')
  // Yeni yapılandırma kamera dışı moda geçerse açık akış kapanır
  const L3 = kur()
  const u3 = new UcDurumu({ defter: () => L3, me: V.C.uc1, saklama: bellek(), now: () => now })
  u3.yapilandirmaAl(VK.yapilandirmaBayt(L3, VK.TEMEL_YAPILANDIRMA))
  t.ok(u3.akisIstegi(istek(L3, V.C.isci1), U).kabul)
  t.is(u3.yapilandirmaAl(VK.yapilandirmaBayt(L3, { ...VK.TEMEL_YAPILANDIRMA, seq: 4, mode: 'kapali', targets: [], windows: [] })).kapatilan[0].code, 'YAPILANDIRMA_DEGISTI')
  t.alike(u3.acikAkislar(), [])
})
