// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// protocol/caps.js — üyelerin son görülen yetenek bitleri ve PROTOCOL_LEVEL yazma koşulu (RFC-0003 §2.2)
//
// Telefon her üyenin son gördüğü HELLO.caps değerini ve tarihini saklar. Bu koşullar defter doğrulamasının parçası
// değildir; yalnız olayı yazan telefonda bakılır.
const { CAPS } = require('./hello')

const DAY_MS = 86_400_000
const SEEN_WINDOW_MS = 30 * DAY_MS

// Düzey → onu bilen istemcinin bildirdiği bit
// Düzey, alt düzeylerin bitlerini de ister (RFC-0019 §11.8 f)
const LEVEL_BIT = {
  '2.1': CAPS.LEDGER_V21,
  '2.2': CAPS.COKLU_UYGULAMA | CAPS.LEDGER_V21,
  '2.3': CAPS.MISAFIR_YAZAR | CAPS.COKLU_UYGULAMA | CAPS.LEDGER_V21 // RFC-0030 §8
}

class CapsBook {
  constructor () {
    this.seen = new Map() // hex → { caps, at }
  }

  record (memberHex, caps, at) {
    const cur = this.seen.get(memberHex)
    if (cur && cur.at > at) return
    this.seen.set(memberHex, { caps, at })
  }

  get (memberHex) { return this.seen.get(memberHex) || null }

  has (memberHex, bit, now) {
    const s = this.seen.get(memberHex)
    return !!s && (s.caps & bit) === bit && now - s.at <= SEEN_WINDOW_MS
  }

  // §2.2 madde 4: bütün aktif ve bekleyen olmayan üyeler (telefonlar ve kutu) son 30 günde biti bildirmiş,
  // defterde bekleyen üye yok. Kendi cihazımız (me) her zaman biti bilir. 2.2'den sonra ek kimlikler de kapsanır
  // (RFC-0017 §4.4); activeIds onları zaten içerir.
  // Dönüş: { ok, missing: [hex], pending: [hex] }
  levelReady (ledger, level, { now, me = null } = {}) {
    const bit = LEVEL_BIT[level]
    if (!bit) throw new Error('INVALID_BODY')
    const pending = ledger.pendingIds()
    const missing = ledger.activeIds().filter((id) => id !== me && !this.has(id, bit, now))
    return { ok: pending.length === 0 && missing.length === 0, missing, pending }
  }

  toJSON () { return Object.fromEntries(this.seen) }

  load (saved) {
    if (!saved || typeof saved !== 'object') return
    for (const [k, v] of Object.entries(saved)) {
      if (/^[0-9a-f]{32}$/.test(k) && v && Number.isSafeInteger(v.caps) && Number.isSafeInteger(v.at)) this.seen.set(k, { caps: v.caps, at: v.at })
    }
  }
}

module.exports = { CapsBook, LEVEL_BIT, SEEN_WINDOW_MS }
