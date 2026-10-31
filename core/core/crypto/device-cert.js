// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// worklet/crypto/device-cert.js — docs/04 §3 (SPIKE sürümü)
//
// Gerçek Cihaz Sertifikası dbaPub (P-256, 65 B) ve dbaSig (ECDSA-P256-SHA256) taşır ve
// @noble/curves/p256 ile doğrulanır. Spike kuralı "kripto için yalnızca sodium-native ve
// hyperdht" olduğu için P-256 burada YOK: dbaPub ve dbaSig boş gelir, doğrulama yalnızca
// alan uzunluklarına ve ÜKA/ÜDA'nın defterle aynı olmasına bakar (bunu hello.js yapar).
// Sertifika zaten donanımı karşı tarafa kanıtlamaz (docs/04 §2.1); spike güvenliği
// Noise (buluşma anahtarı) + ÜKA imzalı HELLO'dan gelir.
const b4a = require('b4a')
const { hash } = require('./kdf')

function createDeviceCert ({ ukaPub, udaPub, platform = 'bare', createdAt = 0 }) {
  return { dbaPub: b4a.alloc(0), ukaPub, udaPub, platform, createdAt, dbaSig: b4a.alloc(0) }
}

function deviceCertDigest (cert) {
  return hash('device-cert', cert.ukaPub, cert.udaPub, cert.platform, cert.createdAt)
}

function verifyDeviceCert (cert) {
  if (!cert || cert.ukaPub.byteLength !== 32 || cert.udaPub.byteLength !== 32) return false
  if (cert.dbaPub.byteLength === 0 && cert.dbaSig.byteLength === 0) return true // spike: P-256 yok
  return false // P-256 doğrulayıcı gelene kadar dolu dbaSig kabul edilmez (sessizce geçirmek yerine)
}

module.exports = { createDeviceCert, deviceCertDigest, verifyDeviceCert }
