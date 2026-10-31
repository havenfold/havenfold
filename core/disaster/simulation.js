// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// simulation.js — benzetimli bağ (RFC-0012 §17 adım 2): iki oturumu sıralı, kayıpsız bir bayt akışıyla bağlar. Gerçek bağın
// (Bluetooth, yerel ağ) yerine testlerde ve vektörlerde kullanılır. Bir taraf hata fırlatırsa bağ kapanır.
function bagla (a, b, { enCok = 10_000 } = {}) {
  const kuyruk = [...a.basla().map((c) => [b, c]), ...b.basla().map((c) => [a, c])]
  let n = 0
  let kapandi = null
  while (kuyruk.length) {
    if (++n > enCok) { kapandi = 'SIMULATION_LIMIT'; break }
    const [hedef, c] = kuyruk.shift()
    const karsi = hedef === a ? b : a
    try {
      for (const x of hedef.al(c)) kuyruk.push([karsi, x])
    } catch (e) { kapandi = e.message; break }
  }
  return { cerceve: n, kapandi, bitti: a.bitti && b.bitti }
}

module.exports = { bagla }
