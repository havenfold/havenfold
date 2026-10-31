// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// worklet/core/pairs.js — defterden çift sırları (docs/04 §5)
//
// Çift sırrı = X25519(ÜDA'lar) + familyId + anchorHash + (yüz yüze tören yaptıysa) ceremonyKey.
// Defter değişince (üye atılınca) önbellek temizlenir; atılan üyeyle çift sırrı artık üretilmez.
// v2.1 (RFC-0003 §6.2): cihaz ve misafirle de çift sırrı vardır. Çapa Ledger.anchorFor'dadır. Misafir ↔ cihaz ve
// misafir ↔ misafir arasında oturum kurulmadığı için çift sırrı da yoktur.
const b4a = require('b4a')
const sodium = require('sodium-native')
const { pairSecret, pairSubkeys } = require('../crypto/pair')
const { sessionAllowed } = require('../protocol/envelope')

const hex = (b) => b4a.toString(b, 'hex')

class PairBook {
  // now: verilirse misafirliğin süresi uygulanır (taşıyıcı ve afet yolu saatlerini verir; defter saate bakmaz, K15)
  constructor ({ me, ledger, ceremonyKeys = new Map(), now = null }) {
    this.now = typeof now === 'function' ? now : null
    this.me = me
    this.ledger = ledger
    this.ceremonyKeys = ceremonyKeys // peerHex → ceremonyKey
    this.cache = new Map()
    this.head = null
  }

  setCeremonyKey (peerHex, key) {
    this.ceremonyKeys.set(peerHex, key)
    this.cache.delete(peerHex)
  }

  // Misafirliğin süresi doldu mu (GRANT expiresAt). Defter saate bakmaz (K15); süre oturum katmanında uygulanır
  _sureDoldu (idHex) {
    const g = this.ledger.grants && this.ledger.grants.get(idHex)
    return !!g && Number.isSafeInteger(g.expiresAt) && this.now !== null && this.now() >= g.expiresAt
  }

  // Oturum kurulabilen aktif üye, cihaz ya da misafir değilse null. Süresi dolan misafirle ve süresi dolmuş misafirken
  // çift sırrı yok: oturum, afet yolu ve görünüm biter (Codex 9. tur)
  // davetli: sınırlı iptal oturumunun çifti de (yalnız taşıyıcı istiyor; D106, Codex 10. tur). O çift önbelleğe girmez:
  // öbür çağıranlar (afet yolu, mühür) davetliyi hiç görmez
  get (peerHex, { davetli = false } = {}) {
    if (!this.head || !b4a.equals(this.head, this.ledger.head)) this.clear()
    const myHex = hex(this.me.memberId)
    if (this._sureDoldu(peerHex) || this._sureDoldu(myHex)) return null
    if (this.cache.has(peerHex) && !this.ledger.isPending(peerHex)) return this.cache.get(peerHex)
    if (peerHex === myHex) return null
    // K11: bekleyen (uzaktan, 24 saati dolmamış) üyeyle ve bekleyen bizken çift sırrı yok (sessionRole null döner).
    // Bekleyen biz isek ve bekleme süremiz dolduysa (readyAt) üye gibi çift sırrı kurarız: etkinleştirme olayı
    // (ACTIVATE_MEMBER) bize ancak bir oturumla gelir; karşı taraf bizi etkinleştirmedikçe kendi defterinde bekleyen
    // gördüğü için oturumu kabul etmez (Codex 6. tur: kilitlenme). İstisna, sınırlı iptal oturumu (D106; Codex 10. tur):
    // bekleyen uzaktan üye beklerken 'davetli'dir; aile tarafı onu yalnız iptal ettiyse 'davetli' görür
    const myRole = this.benimRolum()
    const role = this.ledger.sessionRole(peerHex) || (this._davetli(peerHex) ? 'davetli' : null)
    const sinirli = myRole === 'davetli' || role === 'davetli'
    if (sinirli && !davetli) return null
    if (!sessionAllowed(myRole, role)) return null
    const m = this.ledger.entity(peerHex)
    const pair = pairSecret({
      myUdaSecret: this.me.uda.secretKey,
      theirUdaPub: m.udaPub,
      myId: this.me.memberId,
      theirId: m.id,
      familyId: this.ledger.familyId,
      anchorHash: this.ledger.anchorFor(this.me.memberId, m.id),
      ceremonyKey: this.ceremonyKeys.get(peerHex) || null
    })
    const v = { id: m.id, hex: peerHex, name: m.name, role: m.role || role, session: role, pair, sub: pairSubkeys(pair, this.me.memberId, m.id) }
    if (!sinirli) this.cache.set(peerHex, v)
    return v
  }

  // Bu kimliğin oturum rolü: defterdeki rol; bekleyen biz isek ve bekleme süremiz dolduysa 'uye' (yukarıdaki K11 notu);
  // dolmadıysa ve uzaktan eklendiysek 'davetli' (D106; Codex 10. tur): yalnız yetkililerle, yalnız iptali almak için
  // sınırlı oturum. Karşı taraf bizi iptal etmediyse bekleyen gördüğü için oturumu kabul etmez (K11 aynen)
  benimRolum () {
    const myHex = hex(this.me.memberId)
    const r = this.ledger.sessionRole(myHex)
    if (r !== null || !this.ledger.isPending(myHex)) return r
    if (typeof this.ledger.now === 'function' && this.ledger.now() >= this.ledger.readyAt(myHex)) return 'uye'
    return this.ledger.members?.get(myHex)?.pendingRemote ? 'davetli' : null
  }

  _davetli (id) { return typeof this.ledger.davetliMi === 'function' && this.ledger.davetliMi(id) }

  peers ({ davetli = false } = {}) {
    const myHex = hex(this.me.memberId)
    const ids = [...this.ledger.activeIds(), ...this.ledger.activeDeviceIds(), ...this.ledger.activeGrantIds(), ...(davetli && typeof this.ledger.davetliIds === 'function' ? this.ledger.davetliIds() : [])]
    return ids.filter((id) => id !== myHex).map((id) => this.get(id, { davetli })).filter(Boolean)
  }

  // Atılan üyenin çift sırrı sıfırlanır; diğerleri başka nesnelerde (buluşma, oturum) kullanılıyor olabilir
  clear () {
    for (const [id, v] of this.cache) if (!this.ledger.sessionRole(id)) sodium.sodium_memzero(v.pair)
    this.cache.clear()
    this.head = b4a.from(this.ledger.head)
  }
}

module.exports = { PairBook }
