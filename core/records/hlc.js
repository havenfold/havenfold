// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// hlc.js — karma mantıksal saat (RFC-0001 §6). Yalnız birleştirme sırası içindir; yetki kararında kullanılmaz.
//
// hlc = üst 48 bit milisaniye ‖ alt 16 bit sayaç. Cihaz tek bir lastHlc tutar ve onu işlemi göndermeden önce
// kalıcı olarak yazar (persist).

const FUTURE_MS = 5 * 60 * 1000 // ileri saat sınırı
const MAX_FUTURE_QUEUE = 1000

const U64_MAX = (1n << 64n) - 1n
const msOf = (h) => Number(h >> 16n)
const fromMs = (ms) => BigInt(ms) << 16n

class Hlc {
  constructor ({ last = 0n, persist = null } = {}) {
    this.last = BigInt(last)
    this.persist = persist
  }

  // Yazarken: max(şimdi << 16, lastHlc + 1)
  next (nowMs) {
    const a = fromMs(nowMs)
    const b = this.last + 1n
    const n = a > b ? a : b
    if (n > U64_MAX) throw new Error('INVALID_VALUE') // 48 bit ms ‖ 16 bit sayaç taşamaz
    this.last = n
    if (this.persist) this.persist(this.last)
    return this.last
  }

  // Alırken: lastHlc = max(lastHlc, gelen). Yalnız geçerli kümeye giren ve ileri saat sınırındaki işlemin saati
  // gözlenir (RFC-0019 §11.1 a); çağıran bunu sağlar.
  observe (h) {
    if (typeof h === 'bigint' && h > this.last && h <= U64_MAX) {
      this.last = h
      if (this.persist) this.persist(this.last)
    }
  }
}

// Gelen işlem yerel saatten 5 dakikadan ileriyse bekletilir (sonucu değil, görünme anını değiştirir)
const tooFarAhead = (h, nowMs) => msOf(h) > nowMs + FUTURE_MS

module.exports = { Hlc, msOf, fromMs, tooFarAhead, FUTURE_MS, MAX_FUTURE_QUEUE }
