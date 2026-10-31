// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D101: uzaktan üye ekleme (kurucu ilke 2, K15; RFC-0003 ADD_MEMBER remote, ACTIVATE_MEMBER). Bellek içi sahte DHT
// üstünde iki tören taşıyıcısı: tek ebeveynli ailede uzaktan tören tamamlanır, yeni üye 24 saat bekleyendir (oturum
// yok), süre dolunca ebeveyn etkinleştirir; yeter sayı tören içinde tutmuyorsa tören QR'dan önce düşer.
'use strict'
const test = require('brittle')
const b4a = require('b4a')
const sodium = require('sodium-native')
const { identity: { createIdentity }, ledger: { Ledger, T, signEvent, encodeEvent, decodeEvent }, joinHello: J, quorum: { REMOTE_WAIT_MS } } = require('@havenfold/core')
const T2 = require('..')
const S = require('../../../sdk')

const hx = (b) => b4a.toString(b, 'hex')
const bekle = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms))
async function kosul (f, ms = 10000) { const son = Date.now() + ms; while (!f()) { if (Date.now() > son) throw new Error('TIMEOUT'); await bekle(2) } }
const hataOf = async (p) => { try { await p; return null } catch (err) { return err.message } }

class Yay {
  constructor () { this.d = new Map() }
  on (a, f) { if (!this.d.has(a)) this.d.set(a, []); this.d.get(a).push(f); return this }
  once (a, f) { const g = (...x) => { this.off(a, g); f(...x) }; return this.on(a, g) }
  off (a, f) { this.d.set(a, (this.d.get(a) || []).filter((x) => x !== f)); return this }
  emit (a, ...x) { for (const f of [...(this.d.get(a) || [])]) f(...x) }
}
class SahteSoket extends Yay {
  constructor (hash) { super(); this.handshakeHash = hash; this.karsi = null; this.kapali = false }
  write (b) { const k = this.karsi; if (!this.kapali && k && !k.kapali) setTimeout(() => k.emit('data', b4a.from(b)), 0) }
  end () { this.destroy() }
  destroy () { if (this.kapali) return; this.kapali = true; setTimeout(() => this.emit('close'), 0); if (this.karsi) this.karsi.destroy() }
}
class SahteDht {
  constructor () { this.dinleyen = new Map() }
  createServer (o, onconn) {
    const dht = this
    const s = { o, onconn, kp: null, kapali: false, listen: async (kp) => { s.kp = kp; dht.dinleyen.set(hx(kp.publicKey), s) }, close: async () => { s.kapali = true; if (s.kp) dht.dinleyen.delete(hx(s.kp.publicKey)) } }
    return s
  }

  connect (pk, { keyPair }) {
    const hash = b4a.alloc(32); sodium.randombytes_buf(hash)
    const ara = new SahteSoket(hash)
    const s = this.dinleyen.get(hx(pk))
    setTimeout(() => {
      if (!s || s.kapali || s.o.firewall(keyPair.publicKey)) { ara.destroy(); return }
      const dinle = new SahteSoket(hash)
      ara.karsi = dinle; dinle.karsi = ara
      ara.emit('open')
      s.onconn(dinle)
    }, 0)
    return ara
  }
}

const kim = (ad) => createIdentity({ seed: 'uzaktan-uye/' + ad, platform: 'test' })
const KEREM = kim('kerem')
const HUSNIYE = kim('husniye')
const IREM = kim('irem')
const SAADET = kim('saadet')

// Kerem'in ailesi; ek: 'ebeveyn' ya da 'yetiskin' (yüz yüze eklenmiş ikinci kişi) ya da null
function kur (ek = null) {
  const saat = { t: 1_800_000_000_000 }
  const now = () => saat.t
  const { ledger: L } = S.LedgerApi.createFamily({ Ledger, me: KEREM, familyName: 'Eser', displayName: 'Kerem', ts: saat.t - 1000 })
  L.now = now
  const defter = new S.LedgerApi({ ledger: L, me: KEREM, now })
  if (ek) {
    const k = ek === 'ebeveyn' ? HUSNIYE : IREM
    const r = defter.addMember({ deviceCert: k.deviceCert, displayName: ek, role: ek, ceremonyTranscriptHash: b4a.alloc(32, 7) })
    signEvent(r.event, k)
    L.apply(r.event)
  }
  const dht = new SahteDht()
  const gelen = { L: null }
  const aile = T2.dhtTorenTasiyici({ dht, deneysel: true, cihaz: () => ({ kimlik: KEREM, ledger: L, defter, aileBagla: () => {}, now, ad: 'Kerem', cihazAdi: 'Pixel' }) })
  const yeni = T2.dhtTorenTasiyici({ dht, deneysel: true, cihaz: () => ({ kimlik: SAADET, ledger: null, defter: null, now, ad: 'Saadet', cihazAdi: 'iPhone', aileBagla: (x) => { gelen.L = x } }) })
  return { L, defter, aile, yeni, gelen, saat, now }
}

function izle (o) {
  const k = {}
  o.on('sas', (x) => { k.sas = x; o.confirm(true) })
  o.on('tamam', (x) => { k.tamam = x })
  o.on('kapandi', (x) => { k.kapandi = x })
  return k
}

test('tek ebeveyn: uzaktan tören tamamlanır; yeni üye 24 saat bekleyendir; süre dolunca ebeveyn etkinleştirir', async (t) => {
  const x = kur()
  const oa = await x.aile.davet({ kind: J.TOREN.UYE, rol: 'yetiskin', uzaktan: true })
  const ka = izle(oa)
  const qr = await new Promise((resolve) => oa.on('qr', (q) => resolve(q.qr)))
  const kb = izle(await x.yeni.katil(qr)) // bağlantı olarak gönderilen QR
  await kosul(() => (ka.tamam || ka.kapandi) && (kb.tamam || kb.kapandi))
  await bekle(80)
  t.ok(ka.tamam && kb.tamam, 'tören tamamlandı')
  const id = hx(SAADET.memberId)
  const m = x.L.members.get(id)
  t.ok(m.pendingRemote, 'ADD_MEMBER remote')
  t.ok(x.L.isPending(id), 'bekleyen')
  t.is(x.L.sessionRole(id), null, 'bekleyenle oturum yok')
  {
    const { PairBook } = require('../../core/core/pairs')
    t.is(new PairBook({ me: SAADET, ledger: x.gelen.L }).peers().length, 0, 'yeni gelen bekleme süresinde çift sırrı kurmaz')
  }
  t.ok(m.activatesAt >= x.now() + REMOTE_WAIT_MS, 'activatesAt en az 24 saat sonra')
  t.ok(x.gelen.L && x.gelen.L.isPending(id), 'yeni gelen defteri bağladı, kendini bekleyen görür')
  const b = x.defter.waiting(id)
  t.is(b.tur, 'uzaktan')
  t.is(b.bitis, x.L.readyAt(id))
  t.is(await hataOf(Promise.resolve().then(() => x.defter.activateMember(id))), 'WAITING_IN_PROGRESS')
  x.saat.t = Math.max(b.bitis, m.activatesAt) + 1
  const r = x.defter.activateMember(id)
  t.is(r.durum, 'uygulandi')
  t.absent(x.L.isPending(id))
  t.is(x.L.sessionRole(id), 'uye', 'etkinleşince oturum açılır')
  // Codex 6. tur: etkinleştirme yeni gelene bir oturumla gider. Bekleme süresi dolan yeni gelen, kendini hâlâ bekleyen
  // görse de ebeveynle çift sırrı kurar (taşıyıcı arar, güvenlik duvarı kabul eder); iki taraftaki sır aynıdır
  x.gelen.L.now = x.now
  const { PairBook } = require('../../core/core/pairs')
  const pY = new PairBook({ me: SAADET, ledger: x.gelen.L }).get(hx(KEREM.memberId))
  const pK = new PairBook({ me: KEREM, ledger: x.L }).get(id)
  t.ok(pY && pK, 'iki tarafta çift sırrı')
  t.alike(pY.pair, pK.pair, 'aynı sır: oturum kurulur')
  t.is(new PairBook({ me: SAADET, ledger: x.gelen.L }).peers().length, 1, 'yeni gelenin eşi var')
  // Yeni gelenin defteri ACTIVATE_MEMBER'ı alır (kendi saatinde süre doldu)
  x.gelen.L.apply(decodeEvent(encodeEvent(r.event)))
  t.absent(x.gelen.L.isPending(id))
  t.is(await hataOf(Promise.resolve().then(() => x.defter.activateMember(id))), 'NOT_WAITING')
})

test('eksik imza (öbür ebeveyn, yetişkin) QR\'dan önce düşmez (D106 K2: tören içinde beklenir); misafir uzaktan olmaz', async (t) => {
  const iki = kur('ebeveyn')
  // İki kişilik ailede oyların çoğunluğu (2'de 2) tutmaz; defterin kodu aynen döner, tören yine açılır
  t.is(iki.defter.remoteMissing('yetiskin'), 'NO_QUORUM', 'iki ebeveyn: ikisi de imzalamalı')
  const o = await iki.aile.davet({ kind: J.TOREN.UYE, rol: 'yetiskin', uzaktan: true })
  t.ok(o, 'tören açıldı')
  o.cancel()
  const yet = kur('yetiskin')
  const o2 = await yet.aile.davet({ kind: J.TOREN.UYE, rol: 'cocuk', uzaktan: true })
  t.ok(o2, 'tek ebeveyn + yetişkin: tören açıldı')
  o2.cancel()
  const tek = kur()
  t.is(tek.defter.remoteMissing('yetiskin'), null)
  t.is(await hataOf(tek.aile.davet({ kind: J.TOREN.MISAFIR, rol: null, uzaktan: true })), 'INVALID_TYPE')
  t.is(tek.L.len, tek.L.events.length, 'deneme defteri değiştirmedi')
  t.absent([...tek.L.members.values()].some((m) => m.name === 'deneme'))
  await bekle(80)
})

test('SDK: CeremonyApi uzaktan yalnız üye töreninde; uyeEkle remote varsayılan bekleme', async (t) => {
  const x = kur()
  const tr = new S.CeremonyApi({ ledger: x.L, me: KEREM, tasiyici: { davet: async (o) => { tr.son = o; const y = new S.Emitter(); y.confirm = () => {}; y.cancel = () => {}; return y } } })
  await tr.startInvite('uye', 'yetiskin', { uzaktan: true })
  t.is(tr.son.uzaktan, true)
  tr.cancel()
  t.is(await hataOf(tr.startInvite('misafir', null, { uzaktan: true })), 'INVALID_TYPE')
  const r = x.defter.addMember({ deviceCert: IREM.deviceCert, displayName: 'İrem', role: 'yetiskin', ceremonyTranscriptHash: b4a.alloc(32, 7), remote: true })
  t.ok(r.event.type === T.ADD_MEMBER)
  t.is(r.durum, 'oneri', 'yeni gelenin imzası bekleniyor')
})
