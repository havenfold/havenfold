// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D68: yerel testnet'te yarım kalan delik açma (istemcide oturum açılır, sunucuya bağlantı gelmez). Arayan taraf HELLO
// süre aşımını HELLO sınırına saymaz (sınır dinleyeni saldırgana karşı korur, D48): kendi arama dilimini kapatmaz ve
// yeniden arar. Ağ yok: bellek içi sahte DHT, yarım bağlantı sayısı elle.
'use strict'
const test = require('brittle')
const b4a = require('b4a')
const sodium = require('sodium-native')
const T = require('..')
const A = require('../../records/test/helpers/family')

const hex = (b) => b4a.toString(b, 'hex')
const bekle = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms))

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
  destroy () { if (this.kapali) return; this.kapali = true; setTimeout(() => this.emit('close'), 0); if (this.karsi) this.karsi.destroy() }
}

// yarim: sıradaki bu kadar bağlantı istemcide açılır ama sunucuya hiç ulaşmaz (delik açma yarıda)
class SahteDht extends Yay {
  constructor () { super(); this.dinleyen = new Map(); this.baglanti = 0; this.yarim = 0 }
  createServer (o, onconn) {
    const dht = this
    const s = { o, onconn, kp: null, kapali: false,
      listen: async (kp) => { s.kp = kp; dht.dinleyen.set(hex(kp.publicKey), s) },
      close: async () => { s.kapali = true; if (s.kp && dht.dinleyen.get(hex(s.kp.publicKey)) === s) dht.dinleyen.delete(hex(s.kp.publicKey)) } }
    return s
  }

  connect (pk, { keyPair }) {
    this.baglanti++
    const hash = b4a.alloc(32); sodium.randombytes_buf(hash)
    const ara = new SahteSoket(hash, pk)
    const s = this.dinleyen.get(hex(pk))
    const yarim = this.yarim > 0 && this.yarim-- > 0
    setTimeout(() => {
      if (!s || s.kapali || s.o.firewall(keyPair.publicKey)) { ara.destroy(); return }
      if (yarim) { ara.emit('open'); return }
      const dinle = new SahteSoket(hash, keyPair.publicKey)
      ara.karsi = dinle; dinle.karsi = ara
      ara.emit('open')
      s.onconn(dinle)
    }, 0)
    return ara
  }
}

test('yarım delik açma: arayan HELLO süre aşımında kendi dilimini kapatmaz, yeniden arar ve oturum kurulur', async (t) => {
  const L = A.anaDefter()
  const saat = 1_800_000_000_000
  const now = () => saat
  const dht = new SahteDht()
  dht.yarim = 9 // dilim e, e+1, e-1'in her birinde üç (HELLO sınırı)
  const kerem = new T.DhtTasiyici({ dht, cihaz: () => ({ kimlik: A.K.kerem, ledger: L }), now, deneysel: true, yoklamaMs: 1e9, hizliMs: 1e9, helloMs: 15 })
  const hus = new T.DhtTasiyici({ dht, cihaz: () => ({ kimlik: A.K.husniye, ledger: L }), now, deneysel: true, yoklamaMs: 1e9, hizliMs: 1e9, helloMs: 15 })
  const baglanan = []
  kerem.ag.dinle({ baglandi: () => {}, koptu: () => {}, al: () => {} })
  hus.ag.dinle({ baglandi: (p) => baglanan.push(p), koptu: () => {}, al: () => {} })
  t.teardown(async () => { await kerem.kapat(); await hus.kapat() })
  // Hüsniye'nin kimliği küçük: o arar. Her yarım bağlantı 15 ms sonra süre aşımıyla düşer
  for (let i = 0; i < 40 && !baglanan.length; i++) { await bekle(25); hus.yokla() }
  t.is(dht.yarim, 0, 'dokuz yarım bağlantı tükendi')
  t.alike(baglanan, [hex(A.K.kerem.memberId)], 'yarım bağlantılardan sonra oturum kuruldu')
  t.is(hus.kapali.size, 0, 'arayan kendi dilimini kapatmadı')
  t.is(kerem.kapali.size, 0, 'dinleyene hiç ulaşmadı, onun sayacı da boş')
})
