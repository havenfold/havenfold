// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// temperature.js — düğümün sıcaklık ölçümü (RFC-0007 §11.1; RFC-0002 §4 durum tablosu): /sys/class/thermal.
//
// thermal_zone*/temp (mili °C) değerlerinin en yükseği alınır. Bölgeler yalnız işlemci değildir (acpitz, Wi-Fi kartı,
// pil); en yükseğini almak güvenli taraftır: makinenin herhangi bir yeri 90 °C'yi aşınca işçi görev almaz.
// Sensörsüz bölgeler 0 ya da anlamsız değer verir; 0 ve 150 °C üstü yok sayılır. Hiç okunamazsa null (bilinmiyor):
// durum sıcaklıksız hesaplanır, NODE_HEALTH ve NODE_CAPS'te 0 gider (sinirlar-ve-kapsam-disi.md madde 23).
const fs = require('fs')
const path = require('path')

const UST_MILI = 150_000

// kok: sysfs öneki (test). Dönüş: { cpuC: tam sayı °C | null }
function sicaklikOku (kok = '/') {
  const tz = path.join(kok, 'sys/class/thermal')
  let adlar = []
  try { adlar = fs.readdirSync(tz).filter((a) => a.startsWith('thermal_zone')) } catch {}
  let enSicak = null
  for (const a of adlar) {
    let v
    try { v = Number(fs.readFileSync(path.join(tz, a, 'temp'), 'utf8').trim()) } catch { continue }
    if (!Number.isFinite(v) || v <= 0 || v > UST_MILI) continue
    const c = Math.round(v / 1000)
    if (enSicak === null || c > enSicak) enSicak = c
  }
  return { cpuC: enSicak }
}

module.exports = { sicaklikOku }
