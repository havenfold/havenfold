// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Tören testleri için bellek içi HyperDHT benzeri: createServer/listen/close, connect (güvenlik duvarı), el sıkışma özeti
'use strict'
const b4a = require('b4a')
const sodium = require('sodium-native')

const hx = (b) => b4a.toString(b, 'hex')

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

// Tören oturumu olaylarını toplar; sas gelince onaylar
function izle (o) {
  const k = {}
  o.on('sas', (x) => { k.sas = x; o.confirm(true) })
  o.on('onay-bekleniyor', (x) => { k.onayBekleniyor = x })
  o.on('tamam', (x) => { k.tamam = x })
  o.on('kapandi', (x) => { k.kapandi = x })
  return k
}

module.exports = { SahteDht, SahteSoket, izle }
