// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// erase/report.js — rapor anahtarı, WIPE_REPORT, HFK1 anahtar QR'ı ve HFW1 rapor parçaları (RFC-0007 §13.2, §13.5)
//
// Kodlama, imza ve QR biçimleri core/core/protocol/retirement.js'tedir; burada yalnız doldurma kuralları var. Telefon
// aynı modülün verifyWipe'ıyla doğrular. Rapor anahtarı silme ortamında üretilir: gizli yarısı sodium_malloc alanında
// (libsodium bu alanı kilitler; ayrıca sodium_mlock), diske, USB'ye ya da ağa hiç yazılmaz, oturum bitince silinir.
const b4a = require('b4a')
const sodium = require('sodium-native')
const E = require('../../core/core/protocol/retirement')

const ARAC = 'havenfold-sil'

function fail (code) { throw new Error(code) }

function raporAnahtari ({ tohum = null } = {}) {
  const publicKey = b4a.alloc(sodium.crypto_sign_PUBLICKEYBYTES)
  const secretKey = sodium.sodium_malloc(sodium.crypto_sign_SECRETKEYBYTES)
  try { sodium.sodium_mlock(secretKey) } catch {}
  if (tohum) sodium.crypto_sign_seed_keypair(publicKey, secretKey, tohum) // yalnız test ve vektör
  else sodium.crypto_sign_keypair(publicKey, secretKey)
  return { publicKey, secretKey, silindi: false }
}

function anahtariSil (k) {
  if (!k || k.silindi) return
  sodium.sodium_memzero(k.secretKey)
  try { sodium.sodium_munlock(k.secretKey) } catch {}
  k.silindi = true
}

// DMI: product_serial; model = sys_vendor + product_name (§13.5)
function cihazBilgisi ({ productSerial = '', sysVendor = '', productName = '' } = {}) {
  const t = (s) => String(s || '').trim()
  return { serial: t(productSerial), model: [t(sysVendor), t(productName)].filter(Boolean).join(' ') }
}

// deviceId: biletteki ids'in ilki; bilet yoksa 16 sıfır
const cihazKimligi = (bilet) => (bilet && bilet.ids && bilet.ids.length ? bilet.ids[0] : b4a.alloc(16))

// Her disk için ayrı WIPE_REPORT. sonuc: { disk: { model, seri }, method, result, driveStatus, startedAt, finishedAt }
function raporYaz ({ bilet, cihaz, sonuc, toolVersion, anahtar }) {
  if (anahtar.silindi) fail('KEY_ERASED')
  return E.signWipeReport({
    deviceId: cihazKimligi(bilet),
    serial: cihaz.serial,
    model: cihaz.model,
    diskModel: sonuc.disk.model || '',
    diskSerial: sonuc.disk.seri || '',
    method: sonuc.method,
    tool: ARAC,
    toolVersion,
    driveStatus: sonuc.driveStatus,
    startedAt: sonuc.startedAt,
    finishedAt: sonuc.finishedAt,
    result: sonuc.result
  }, anahtar)
}

// HFK1: { hostId, ids, retireNonce, reportPub, disks, toolVersion }. Bilet yoksa hostId ve retireNonce 16 sıfır, ids boş.
function anahtarQr ({ bilet, anahtar, diskSayisi, toolVersion }) {
  const b = bilet || { hostId: b4a.alloc(16), ids: [], retireNonce: b4a.alloc(16) }
  return E.encodeKeyQr({ hostId: b.hostId, ids: b.ids, retireNonce: b.retireNonce, reportPub: anahtar.publicKey, disks: diskSayisi, toolVersion })
}

// HFW1 parçaları: çerçeve arabelleğinde 384, metin konsolunda 128 bayt
const raporParcalari = (raporlar, { konsol = true } = {}) => E.encodeReportChunks(raporlar, konsol ? E.CHUNK_KONSOL : E.CHUNK_QR)

module.exports = { ARAC, raporAnahtari, anahtariSil, cihazBilgisi, cihazKimligi, raporYaz, anahtarQr, raporParcalari }
