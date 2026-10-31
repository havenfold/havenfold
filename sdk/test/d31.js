// SPDX-License-Identifier: Apache-2.0
// D31: pay teslimi (RFC-0027 §1b, İstek 121): KASA_SHARE_PUT (0xF1), KASA_SHARE_ACK (0xF2). Beklenenler elle yazıldı.
const test = require('brittle')
const b4a = require('b4a')
const S = require('..')
const K = require('@havenfold/vault')
const A = require('../../core/records/test/helpers/family')

const hex = (b) => b4a.toString(b, 'hex')
const id = (k) => hex(k.memberId)
const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }

function aile () {
  const L = A.anaDefter()
  const now = () => A.TS0 + 3_600_000
  const kasa = (k) => new S.VaultApi({ ledger: L, me: k, now })
  return { L, kerem: kasa(A.K.kerem), husniye: kasa(A.K.husniye), irem: kasa(A.K.irem) }
}

test('üç üyeli aile: kurulum → paylar gider → alındı → durum teslim; çevrimdışı üye bekler, gelince teslim', async (t) => {
  const { kerem, husniye, irem } = aile()
  const r = await kerem.setupBackupKey(b4a.alloc(32, 7))
  const g = kerem.outgoing()
  t.alike(g.map((x) => x.to).sort(), [id(A.K.husniye), id(A.K.irem)].sort(), 'kâğıt dışındaki sahiplere')
  t.ok(g.every((x) => x.type === 0xf1))
  t.alike(r.paylar.map((p) => p.teslim.type), [0xf1, 0xf1])
  // Hüsniye çevrimiçi
  const h = g.find((x) => x.to === id(A.K.husniye))
  const ack = husniye.receiveShare(id(A.K.kerem), h.bytes, 'dogrudan')
  t.alike([ack.to, ack.type, ack.durum], [id(A.K.kerem), 0xf2, 'yeni'])
  t.is(husniye.tutucu.paylar.size, 1, 'Hüsniye payı tutuyor')
  t.is(kerem.receiveAck(id(A.K.husniye), ack.bytes, 'emanet'), 'teslim')
  const d = kerem.status().ya
  const teslim = Object.fromEntries(d.sahipler.map((s) => [s.tur === 'kagit' ? 'kagit' : s.id, s.teslim]))
  t.alike(teslim, { [id(A.K.husniye)]: true, [id(A.K.irem)]: false, kagit: null }, 'İrem çevrimdışı: bekliyor')
  t.alike(kerem.outgoing().map((x) => x.to), [id(A.K.irem)], 'yalnız bekleyen yeniden gider')
  // İrem sonra gelir
  const i = irem.receiveShare(id(A.K.kerem), kerem.outgoing()[0].bytes, 'dogrudan')
  t.is(kerem.receiveAck(id(A.K.irem), i.bytes, 'dogrudan'), 'teslim')
  t.alike(kerem.outgoing(), [])
  t.ok(kerem.status().ya.sahipler.filter((s) => s.tur === 'kisi').every((s) => s.teslim))
  // Tutulan paylar birleşince sır (kâğıt + Hüsniye)
  const ph = [...husniye.tutucu.paylar.values()][0].share
  const sir = await K.pay.birlestir([ph, K.pay.kagitCoz(r.kagitlar[0].metin)], { secretId: ph.secretId, kind: K.pay.TUR.YA, version: 1 })
  t.alike(sir, b4a.alloc(32, 7))
})

test('tekrar, DUPLICATE_HOLDER, yanlış tutucu, yetkisiz gönderen, Posta Kutusu yasak', async (t) => {
  const { kerem, husniye, irem } = aile()
  await kerem.setupBackupKey(b4a.alloc(32, 9))
  const g = kerem.outgoing()
  const h = g.find((x) => x.to === id(A.K.husniye))
  const ir = g.find((x) => x.to === id(A.K.irem))
  t.is(husniye.receiveShare(id(A.K.kerem), h.bytes, 'dogrudan').durum, 'yeni')
  t.is(husniye.receiveShare(id(A.K.kerem), h.bytes, 'dogrudan').durum, 'tekrar', 'aynı pay: alındı yeniden')
  const m = K.teslim.payTeslimiCoz(h.bytes)
  const baska = { ...m.share, share: b4a.from(m.share.share) }
  baska.share[0] ^= 1
  t.is(hataOf(() => husniye.receiveShare(id(A.K.kerem), K.teslim.payTeslimi(baska, m.rootId), 'dogrudan')), 'DUPLICATE_HOLDER')
  t.is(hataOf(() => husniye.receiveShare(id(A.K.kerem), ir.bytes, 'dogrudan')), 'WRONG_HOLDER', 'İrem\'in payı Hüsniye\'ye')
  t.is(hataOf(() => irem.receiveShare(id(A.K.husniye), ir.bytes, 'dogrudan')), 'UNAUTHORIZED', 'YA payını yalnız sırrın sahibi dağıtır')
  t.is(hataOf(() => irem.receiveShare(id(A.K.kerem), ir.bytes, 'posta')), 'MAILBOX_FORBIDDEN')
  t.is(hataOf(() => irem.receiveShare(id(A.K.kerem), b4a.concat([ir.bytes, b4a.from([0])]), 'dogrudan')), 'INVALID_MESSAGE', 'kanonik')
  const ack = irem.receiveShare(id(A.K.kerem), ir.bytes, 'dogrudan')
  t.is(hataOf(() => kerem.receiveAck(id(A.K.husniye), ack.bytes, 'dogrudan')), 'UNAUTHORIZED', 'alındıyı payın sahibi verir')
  t.is(hataOf(() => kerem.receiveAck(id(A.K.irem), ack.bytes, 'posta')), 'MAILBOX_FORBIDDEN')
})

test('KRA: kasa okuyucusu dağıtır; kurucunun kendi payı yerelde; okuyucu olmayan dağıtamaz', async (t) => {
  const { kerem, husniye, irem } = aile()
  const KASA = hex(A.K_KASA)
  const r = await kerem.setupRecoveryKey(KASA, b4a.alloc(32, 3), { kagit: 1 })
  t.is(kerem.tutucu.paylar.size, 1, 'Kerem\'in kendi payı tutucusunda')
  const g = kerem.outgoing()
  t.alike(g.map((x) => x.to), [id(A.K.husniye)])
  const ack = husniye.receiveShare(id(A.K.kerem), g[0].bytes, 'emanet')
  t.is(kerem.receiveAck(id(A.K.husniye), ack.bytes, 'dogrudan'), 'teslim')
  t.ok(kerem.status().kasalar.find((x) => x.collectionId === KASA).kurulu.sahipler.filter((s) => s.tur === 'kisi').every((s) => s.teslim))
  t.is(hataOf(() => husniye.receiveShare(id(A.K.irem), g[0].bytes, 'dogrudan')), 'UNAUTHORIZED', 'İrem kasanın okuyucusu değil')
  t.ok(r.version === 1 && irem)
})
