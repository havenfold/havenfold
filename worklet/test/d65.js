// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D65: tören taşıyıcısında denetim bulguları (İstek 142 b, c; RFC-0028 §5 d). Ağ yok: bellek içi sahte DHT.
// (b) karşı tarafın geçici X25519 anahtarı düşük dereceli noktaysa tören WEAK_KEY ile kapanır, resim çıkmaz.
// (c) QR ekranda 60 sn'de yenilenir (eski QR 10 sn daha yaşar), tek QR'ın ömrü en çok 180 sn, oturum toplam 180 sn.
'use strict'
const test = require('brittle')
const b4a = require('b4a')
const c = require('compact-encoding')
const sodium = require('sodium-native')
const DHT = require('hyperdht')
const { kdf, joinHello: J } = require('@havenfold/core')
const { dhtTorenTasiyici, qrCoz } = require('@havenfold/transport/ceremony')
const A = require('../../core/records/test/helpers/family')

const hex = (b) => b4a.toString(b, 'hex')
const bekle = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms))
async function kosul (f, ms = 2000) { const son = Date.now() + ms; while (!f()) { if (Date.now() > son) throw new Error('TIMEOUT'); await bekle(2) } }

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
    const s = { o, onconn, kp: null, kapali: false,
      listen: async (kp) => { s.kp = kp; dht.dinleyen.set(hex(kp.publicKey), s) },
      close: async () => { s.kapali = true; if (s.kp && dht.dinleyen.get(hex(s.kp.publicKey)) === s) dht.dinleyen.delete(hex(s.kp.publicKey)) } }
    return s
  }

  connect (pk, { keyPair }) {
    const hash = b4a.alloc(32); sodium.randombytes_buf(hash)
    const ara = new SahteSoket(hash)
    const s = this.dinleyen.get(hex(pk))
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

const aileCihaz = () => { const L = A.anaDefter(); return () => ({ kimlik: A.K.kerem, ledger: L, defter: null, now: Date.now, ad: 'Kerem', cihazAdi: 'telefon' }) }
const yeniCihaz = () => () => ({ kimlik: A.K.u9, ledger: null, defter: null, now: Date.now, ad: 'Ayşe', cihazAdi: 'telefon' })

function olaylar (oturum) {
  const k = { qr: [], sas: [], kapandi: [] }
  for (const ad of Object.keys(k)) oturum.on(ad, (x) => k[ad].push(x))
  return k
}

test('QR 60 sn\'de yenilenir: her yenilemede yeni davet sırrı ve buluşma anahtarı, eski QR kısa süre sonra kapanır, tek QR en çok 180 sn', async (t) => {
  const dht = new SahteDht()
  const tt = dhtTorenTasiyici({ dht, cihaz: aileCihaz(), deneysel: true, yenileMs: 40, araMs: 15 })
  const oturum = await tt.davet({ kind: J.TOREN.UYE, rol: 'yetiskin' })
  t.teardown(() => oturum.cancel())
  const k = olaylar(oturum)
  t.is(oturum.ttlSec, 180, 'oturumun toplam ömrü 180 sn')
  await kosul(() => k.qr.length >= 3)
  const q = k.qr.map((x) => qrCoz(x.qr))
  t.is(new Set(q.map((x) => hex(x.sec))).size, q.length, 'her QR yeni davet sırrı')
  t.is(new Set(q.map((x) => hex(x.rv))).size, q.length, 'her QR yeni buluşma anahtarı')
  const simdi = Math.floor(Date.now() / 1000)
  t.ok(q.every((x) => x.exp <= simdi + 180), 'tek QR ömrü en çok 180 sn')
  t.ok(k.qr.every((x) => x.kalanSn === 60), 'ekranda yenilemeye kalan süre 60 sn')
  t.ok(dht.dinleyen.size <= 2, 'yalnız geçerli QR ve ara süredeki önceki QR dinliyor')
  t.absent(dht.dinleyen.has(hex(q[0].rv)), 'ilk QR ara süreden sonra kapandı')

  // Eski QR'la gelen bağlanamaz; tören sürer
  const eski = dht.connect(q[0].rv, { keyPair: DHT.keyPair(kdf.derive(q[0].sec, 'hf/toren/arama')) })
  let kapandi = false
  eski.once('close', () => { kapandi = true })
  await kosul(() => kapandi)
  t.alike(k.kapandi, [], 'oturum açık')
})

test('Son QR\'la bağlanılır, iki tarafta aynı 5 resim; bağlantıdan sonra yenileme durur ve öbür QR\'lar kapanır', async (t) => {
  const dht = new SahteDht()
  const gosteren = dhtTorenTasiyici({ dht, cihaz: aileCihaz(), deneysel: true, yenileMs: 40, araMs: 15 })
  const tarayan = dhtTorenTasiyici({ dht, cihaz: yeniCihaz(), deneysel: true })
  const og = await gosteren.davet({ kind: J.TOREN.UYE, rol: 'yetiskin' })
  t.teardown(() => og.cancel())
  const kg = olaylar(og)
  await kosul(() => kg.qr.length >= 2)
  const ot = await tarayan.katil(kg.qr[kg.qr.length - 1].qr)
  t.teardown(() => ot.cancel())
  const kt = olaylar(ot)
  await kosul(() => kg.sas.length === 1 && kt.sas.length === 1)
  t.alike(kg.sas[0].resimler, kt.sas[0].resimler, 'aynı 5 resim')
  const n = kg.qr.length
  await bekle(120)
  t.is(kg.qr.length, n, 'bağlantıdan sonra yeni QR yok')
  t.is(dht.dinleyen.size, 1, 'yalnız bağlanılan QR\'ın sunucusu açık')
})

test('Oturum toplam süreyi aşınca yeni QR çıkmaz ve oturum süre nedeniyle kapanır', async (t) => {
  const dht = new SahteDht()
  const tt = dhtTorenTasiyici({ dht, cihaz: aileCihaz(), deneysel: true, yenileMs: 30, araMs: 10, sureMs: 100 })
  const oturum = await tt.davet({ kind: J.TOREN.UYE, rol: 'yetiskin' })
  const k = olaylar(oturum)
  await kosul(() => k.kapandi.length === 1)
  t.alike(k.kapandi[0], { neden: 'sure' })
  const n = k.qr.length
  await bekle(80)
  t.is(k.qr.length, n, 'kapandıktan sonra QR yok')
  t.is(dht.dinleyen.size, 0, 'bütün QR sunucuları kapalı')
})

test('Düşük dereceli geçici anahtar: tören WEAK_KEY ile kapanır, resim çıkmaz', async (t) => {
  const dht = new SahteDht()
  const tt = dhtTorenTasiyici({ dht, cihaz: aileCihaz(), deneysel: true })
  const oturum = await tt.davet({ kind: J.TOREN.UYE, rol: 'yetiskin' })
  t.teardown(() => oturum.cancel())
  const k = olaylar(oturum)
  await kosul(() => k.qr.length === 1)
  const q = qrCoz(k.qr[0].qr)
  // Saldırgan QR'ı görmüş: arama anahtarını ve MAC'i doğru kurar, geçici anahtar olarak sıfır noktasını yollar
  const s = dht.connect(q.rv, { keyPair: DHT.keyPair(kdf.derive(q.sec, 'hf/toren/arama')) })
  const gelen = []
  s.on('data', (b) => gelen.push(b))
  s.once('open', () => {
    const govde = c.encode(J.joinHello, { cert: A.K.u9.deviceCert, name: 'Saldırgan', device: 'x', eph: b4a.alloc(32), mac: kdf.derive(q.sec, 'hf/toren/mac', s.handshakeHash, b4a.from('c')), caps: 0 })
    s.write(b4a.concat([b4a.from([0x08]), govde]))
  })
  await kosul(() => k.kapandi.length === 1)
  t.alike(k.kapandi[0], { neden: 'WEAK_KEY' })
  t.alike(k.sas, [], 'resim çıkmadı')
})

test('Açılan geçici dosyanın en uzun ömrü 10 dakika (RFC-0014; RFC-0027 §5 e)', (t) => {
  t.is(require('../start').ACILAN_OMUR_MS, 10 * 60_000)
})
