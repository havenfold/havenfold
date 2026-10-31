// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// test-env.js — yalnız teste ait ortam değişkenleri üretimde reddedilir (açılış güvenlik incelemesi, düşük önem 7)
//
// HF_TEST_KIPI (taklit TPM, anahtar dizinde), HF_KOK (yol öneki) ve HF_ONYUKLEME (yerel testnet önyüklemesi) yalnız
// testlerin kendi başlattığı süreçler içindir. Süreç systemd altında çalışıyorsa (INVOCATION_ID tanımlı) ya da kök veya
// bir Havenfold sistem kullanıcısıyla (havenfold-*) çalışıyorsa bu değişkenlerden biri verilmişse açılmaz:
// TEST_ENV_IN_PRODUCTION. Testler süreçlerini systemd dışında, kendi kullanıcılarıyla başlatır (çocuk sürecin ortamından
// INVOCATION_ID'yi çıkarırlar; CI çalıştırıcısı systemd altında olabilir).
'use strict'
const fs = require('fs')

const TEST_DEGISKENLERI = ['HF_TEST_KIPI', 'HF_KOK', 'HF_ONYUKLEME']

function fail (code) { throw new Error(code) }

// /etc/passwd'de uid'in adı (yoksa null)
function kullaniciAdi (uid, passwd = '/etc/passwd') {
  let metin = ''
  try { metin = fs.readFileSync(passwd, 'utf8') } catch { return null }
  for (const satir of metin.split('\n')) {
    const p = satir.split(':')
    if (p.length >= 4 && Number(p[2]) === uid && p[2] !== '') return p[0]
  }
  return null
}

// Üretim belirtisi: 'systemd' | 'kok' | 'sistem-kullanicisi' | null
function uretimde (env = process.env, { getuid = process.getuid, passwd } = {}) {
  if (env.INVOCATION_ID) return 'systemd'
  if (typeof getuid !== 'function') return null
  const uid = getuid()
  if (uid === 0) return 'kok'
  const ad = kullaniciAdi(uid, passwd)
  return ad && ad.startsWith('havenfold-') ? 'sistem-kullanicisi' : null
}

// adlar: bu girişin okuduğu test değişkenleri (varsayılan üçü). Verilmiş biri varsa ve üretimdeyse hata.
function testOrtamiDenetle (env = process.env, { adlar = TEST_DEGISKENLERI, ...secenek } = {}) {
  const verilen = adlar.filter((a) => env[a] !== undefined && env[a] !== '')
  if (!verilen.length) return
  const neden = uretimde(env, secenek)
  if (neden) fail('TEST_ENV_IN_PRODUCTION')
}

module.exports = { testOrtamiDenetle, uretimde, kullaniciAdi, TEST_DEGISKENLERI }
