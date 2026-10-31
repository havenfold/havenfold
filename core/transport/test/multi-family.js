// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D92: RFC-0034 §6 ve §11 madde 10 — bir telefonda iki aile, tek HyperDHT düğümü. Bellek içi sahte DHT (d48 düzeni):
// Hüsniye'nin telefonu "Eser" ailesinde (kök örnek) ve "Saadet'in evi"nde (ek örnek) ayrı kimliklerle; iki örneğin
// taşıyıcısı aynı düğümü paylaşır. Bir ailenin çiftinin arama anahtarı öbür ailenin sunucularının güvenlik duvarında
// reddedilir; oturumlar aile içinde kalır. Beklenenler RFC'den elle yazıldı.
'use strict'
const test = require('brittle')
const b4a = require('b4a')
const sodium = require('sodium-native')
const { ledger: { Ledger, genesisEvent }, identity: { createIdentity }, hello: H } = require('@havenfold/core')
const T = require('..')
const A = require('../../records/test/helpers/family')
const { ekle } = require('../../core/test/helpers/ledger')
const { tur, seviye } = require('../../core/test/helpers/v21')

const hex = (b) => b4a.toString(b, 'hex')
const bekle = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms))
async function kosul (f, ms = 10000) { const son = Date.now() + ms; while (!f()) { if (Date.now() > son) throw new Error('TIMEOUT'); await bekle(2) } }

class Yay {
  constructor () { this.d = new Map() }
  on (a, f) { if (!this.d.has(a)) this.d.set(a, []); this.d.get(a).push(f); return this }
  once (a, f) { const g = (...x) => { this.off(a, g); f(...x) }; return this.on(a, g) }
  off (a, f) { this.d.set(a, (this.d.get(a) || []).filter((x) => x !== f)); return this }
  emit (a, ...x) { for (const f of [...(this.d.get(a) || [])]) f(...x) }
}

class SahteSoket extends Yay {
  constructor (hash, remotePublicKey) { super(); this.handshakeHash = hash; this.remotePublicKey = remotePublicKey; this.karsi = null; this.kapali = false }
  write (b) { const k = this.karsi; if (!this.kapali && k && !k.kapali) setTimeout(() => k.emit('data', b4a.from(b)), 0) }
  destroy () {
    if (this.kapali) return
    this.kapali = true
    setTimeout(() => this.emit('close'), 0)
    if (this.karsi) this.karsi.destroy()
  }
}

// Tek düğüm; her örneğin görünümü kurduğu sunucuları ve aradığı anahtarları kaydeder
class SahteDht extends Yay {
  constructor () { super(); this.dinleyen = new Map(); this.reddedilen = 0 }
  gorunum () {
    const dht = this
    const g = { sunucular: [], aranan: [] }
    g.dht = {
      on: (...a) => dht.on(...a),
      off: (...a) => dht.off(...a),
      createServer: (o, onconn) => { const s = dht.createServer(o, onconn); g.sunucular.push(s); return s },
      connect: (pk, o) => { g.aranan.push(o.keyPair.publicKey); return dht.connect(pk, o) },
      suspend: async () => {},
      resume: async () => {}
    }
    return g
  }

  createServer (o, onconn) {
    const dht = this
    const s = { o, onconn, kp: null, kapali: false,
      listen: async (kp) => { s.kp = kp; dht.dinleyen.set(hex(kp.publicKey), s) },
      close: async () => { s.kapali = true; if (s.kp && dht.dinleyen.get(hex(s.kp.publicKey)) === s) dht.dinleyen.delete(hex(s.kp.publicKey)) } }
    return s
  }

  connect (pk, { keyPair }) {
    const hash = b4a.alloc(32); sodium.randombytes_buf(hash)
    const ara = new SahteSoket(hash, pk)
    const s = this.dinleyen.get(hex(pk))
    setTimeout(() => {
      if (!s || s.kapali || s.o.firewall(keyPair.publicKey)) { this.reddedilen++; ara.destroy(); return }
      const dinle = new SahteSoket(hash, keyPair.publicKey)
      ara.karsi = dinle; dinle.karsi = ara
      ara.emit('open')
      s.onconn(dinle)
    }, 0)
    return ara
  }
}

function islem () {
  const k = { baglandi: [], al: [] }
  return { k, isl: { baglandi: (p) => k.baglandi.push(p), koptu: () => {}, al: (p, t) => k.al.push([p, t]) } }
}

// "Saadet'in evi": Saadet kurucu ebeveyn, Hüsniye'nin bu ailedeki ayrı kimliği yetişkin (RFC-0034 §4.3 örnek akış)
function saadetinEvi () {
  const kim = (ad) => Object.assign(createIdentity({ seed: 'coklu-aile/' + ad, platform: 'test' }), { ad })
  const saadet = kim('Saadet')
  const husniye = kim('Hüsniye')
  const L = new Ledger()
  L.apply(genesisEvent(saadet, { familyName: "Saadet'in evi", displayName: 'Saadet', ts: A.TS0 }))
  L.apply(tur(L, 'aile', [saadet]))
  L.apply(ekle(L, husniye, 'yetiskin', [saadet]))
  L.apply(seviye(L, [saadet]))
  return { L, saadet, husniye }
}

test("vektör 10: tek düğüm, iki aile — bir ailenin arama anahtarı öbür ailenin sunucusunda reddedilir; oturumlar aile içinde", async (t) => {
  const dht = new SahteDht()
  const X = A.anaDefter() // Eser: Kerem ve Hüsniye
  const Y = saadetinEvi()
  t.unlike(hex(Y.husniye.memberId), hex(A.K.husniye.memberId), 'Hüsniye iki ailede ayrı kimlik')
  let saat = 1_800_000_000_000
  const now = () => saat
  const kur = (g, kim, L) => new T.DhtTasiyici({ dht: g.dht, cihaz: () => ({ kimlik: kim, ledger: L }), now, deneysel: true, yoklamaMs: 1e9, hizliMs: 1e9 })
  const gKerem = dht.gorunum()
  const gHx = dht.gorunum() // Hüsniye'nin telefonu, kök örnek
  const gHy = dht.gorunum() // aynı telefon, ek örnek (aynı düğüm)
  const gSaadet = dht.gorunum()
  const kerem = kur(gKerem, A.K.kerem, X)
  const hx = kur(gHx, A.K.husniye, X)
  const hy = kur(gHy, Y.husniye, Y.L)
  const saadet = kur(gSaadet, Y.saadet, Y.L)
  const ik = islem(); const ihx = islem(); const ihy = islem(); const is = islem()
  kerem.ag.dinle(ik.isl); hx.ag.dinle(ihx.isl); hy.ag.dinle(ihy.isl); saadet.ag.dinle(is.isl)
  t.teardown(async () => { for (const x of [kerem, hx, hy, saadet]) await x.kapat() })
  // Dinleme sunucusu açılmadan gelen arama düşer: koşul beklenirken yoklama yinelenir (yoklama aralığı testte kapalı)
  await kosul(() => {
    for (const x of [kerem, hx, hy, saadet]) x.yokla()
    return kerem.oturumlar.get(hex(A.K.husniye.memberId))?.dogrulandi && saadet.oturumlar.get(hex(Y.husniye.memberId))?.dogrulandi
  })
  t.pass('iki ailede oturumlar aynı düğüm üstünde kuruldu')
  // Oturumlar aile içinde kalır
  t.alike([...hy.oturumlar.keys()], [hex(Y.saadet.memberId)], 'ek örnek yalnız Saadet\'in evindekilerle')
  t.absent(kerem.oturumlar.has(hex(Y.husniye.memberId)), 'Kerem Hüsniye\'nin öbür kimliğini görmez')
  t.absent(saadet.oturumlar.has(hex(A.K.husniye.memberId)), 'Saadet Hüsniye\'nin Eser kimliğini görmez')
  // Kerem'in kullandığı bütün arama anahtarları ek örneğin ve Saadet'in sunucularında reddedilir (el sıkışmadan önce)
  const yAnahtarlari = [...gHy.sunucular, ...gSaadet.sunucular]
  t.ok(gKerem.aranan.length > 0 && yAnahtarlari.length > 0)
  t.ok(gKerem.aranan.every((pk) => yAnahtarlari.every((s) => s.o.firewall(pk) === true)), 'Eser çiftlerinin anahtarı Saadet\'in evinin güvenlik duvarında red')
  t.ok(gSaadet.aranan.every((pk) => [...gHx.sunucular, ...gKerem.sunucular].every((s) => s.o.firewall(pk) === true)), 'tersi de')
  // Aynı anahtarla doğrudan bağlanma denemesi: sunucu bağlantıyı almaz
  const hedef = yAnahtarlari.find((s) => s.kp) // Saadet'in evinin dinleyen sunucusu (bu çiftte ek örnek arar)
  const soket = dht.connect(hedef.kp.publicKey, { keyPair: { publicKey: gKerem.aranan[0] } })
  let acildi = false
  soket.once('open', () => { acildi = true })
  await kosul(() => soket.kapali)
  t.absent(acildi, 'güvenlik duvarı bağlantıyı el sıkışmadan önce kesti')
  t.absent([...ihy.k.baglandi, ...is.k.baglandi].includes(hex(A.K.kerem.memberId)))
  // Güvenlik duvarı geçilse bile: Eser üyesinin HELLO'su Saadet'in evinin defterinde reddedilir (familyId, üyelik)
  const sk = { handshakeHash: b4a.alloc(32, 3) }
  const h = H.createHello(A.K.kerem, sk, X, 0)
  t.is(H.verifyHello(h, sk, Y.L, hex(A.K.kerem.memberId)).code, 'FAMILY_MISMATCH')
  const h2 = H.createHello(A.K.husniye, sk, X, 0)
  t.is(H.verifyHello(h2, sk, Y.L, hex(A.K.husniye.memberId)).code, 'FAMILY_MISMATCH', 'Hüsniye\'nin Eser kimliği de')
  t.ok(H.verifyHello(H.createHello(Y.husniye, sk, Y.L, 0), sk, Y.L, hex(Y.husniye.memberId)).ok, 'kendi ailesinde geçer')
  saat += 1
})
