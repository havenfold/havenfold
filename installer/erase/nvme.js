// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// erase/nvme.js — NVMe yeteneklerinin ve sanitize günlüğünün ayrıştırılması (RFC-0007 §13.3, §13.4)
//
// Saf: `nvme id-ctrl -o json` ve `nvme sanitize-log -o json` çıktısını (nvme-cli 2.x) alır, komut çalıştırmaz.
// Alanlar NVMe temel belirtimindeki adlarla: SANICAP (sanitize yetenekleri), OACS (Format NVM desteği), FNA (Format
// NVM öznitelikleri), SSTAT ve SPROG (sanitize durumu ve ilerlemesi).

function fail (code) { throw new Error(code) }

function jsonAl (girdi) {
  if (typeof girdi === 'string') {
    try { return JSON.parse(girdi) } catch { fail('INVALID_NVME_OUTPUT') }
  }
  if (!girdi || typeof girdi !== 'object') fail('INVALID_NVME_OUTPUT')
  return girdi
}

const sayi = (x) => {
  if (typeof x === 'number' && Number.isSafeInteger(x) && x >= 0) return x
  if (typeof x === 'string' && /^(0x[0-9a-f]+|[0-9]+)$/i.test(x.trim())) return Number(x.trim())
  return 0
}

// SANICAP bitleri: 0 CES (şifreleme silme), 1 BES (blok silme), 2 OWS (üzerine yazma)
// OACS biti 1: Format NVM komutu var. FNA biti 2: Format NVM'de şifreleme silme (SES = 2) var.
function idCtrlCoz (girdi) {
  const j = jsonAl(girdi)
  const sanicap = sayi(j.sanicap)
  const oacs = sayi(j.oacs)
  const fna = sayi(j.fna)
  return {
    model: String(j.mn || '').trim(),
    seri: String(j.sn || '').trim(),
    sanicap,
    oacs,
    fna,
    sanitize: { kripto: (sanicap & 1) !== 0, blok: (sanicap & 2) !== 0, uzerineYaz: (sanicap & 4) !== 0 },
    format: { var: (oacs & 2) !== 0, kriptoSilme: (fna & 4) !== 0 }
  }
}

// nvme-cli 2.x sanitize günlüğünü aygıt adının altına koyar ({ "nvme0": { sstat, sprog, ... } }); eski sürümler düz verir
function sanitizeLogCoz (girdi) {
  let j = jsonAl(girdi)
  if (j.sstat === undefined) {
    const ic = Object.values(j).find((v) => v && typeof v === 'object' && v.sstat !== undefined)
    if (!ic) fail('INVALID_NVME_OUTPUT')
    j = ic
  }
  const sstat = sayi(j.sstat)
  const sprog = sayi(j.sprog)
  // SSTAT bit 2:0 — 0 hiç yapılmadı, 1 başarılı, 2 sürüyor, 3 başarısız, 4 başarılı (ayırma kaldırılmadan istenmişti)
  const kod = sstat & 7
  const durum = kod === 1 || kod === 4 ? 'basarili' : kod === 2 ? 'suruyor' : kod === 3 ? 'basarisiz' : 'hic'
  const hex4 = (n) => '0x' + n.toString(16).padStart(4, '0')
  return { sstat, sprog, durum, kuresel: (sstat & 0x100) !== 0, driveStatus: `sstat=${hex4(sstat)} sprog=${sprog}` }
}

// Ad alanı aygıtından denetleyici aygıtı: /dev/nvme0n1 → /dev/nvme0 (sanitize ve sanitize-log denetleyiciye gider)
function denetleyici (yol) {
  const m = /^(\/dev\/nvme[0-9]+)n[0-9]+$/.exec(yol)
  if (!m) fail('INVALID_NVME_PATH')
  return m[1]
}

module.exports = { idCtrlCoz, sanitizeLogCoz, denetleyici }
