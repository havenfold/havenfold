// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Açılış güvenlik incelemesi (düşük önem 7): HF_TEST_KIPI, HF_KOK ve HF_ONYUKLEME üretimde açılmaz. Üretim: systemd
// altında (INVOCATION_ID), kök ya da havenfold-* sistem kullanıcısı. Testin kendi süreçleri (systemd dışında, kendi
// kullanıcısıyla) etkilenmez.
const test = require('brittle')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { uretimde, testOrtamiDenetle } = require('../test-env')
const kutu = require('../box')
const isci = require('../worker')
const denetci = require('../supervisor-main')
const ilkAyar = require('../setup')

function dizin (t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-test-ortami-'))
  t.teardown(() => fs.rmSync(d, { recursive: true, force: true }))
  return d
}
const hataOf = (f) => { try { f(); return null } catch (err) { return err.message } }

test('üretim belirtisi: systemd, kök, havenfold-* kullanıcısı; geliştirici değil', (t) => {
  const passwd = path.join(dizin(t), 'passwd')
  fs.writeFileSync(passwd, 'root:x:0:0::/root:/bin/sh\nhavenfold-isci:x:990:990::/var/lib/havenfold/isci:/usr/sbin/nologin\ngelistirici:x:1000:1000::/home/g:/bin/sh\n')
  t.is(uretimde({ INVOCATION_ID: 'ab' }, { getuid: () => 1000, passwd }), 'systemd')
  t.is(uretimde({}, { getuid: () => 0, passwd }), 'kok')
  t.is(uretimde({}, { getuid: () => 990, passwd }), 'sistem-kullanicisi')
  t.is(uretimde({}, { getuid: () => 1000, passwd }), null)
  t.is(hataOf(() => testOrtamiDenetle({ INVOCATION_ID: 'ab' }, { getuid: () => 1000, passwd })), null, 'test değişkeni yoksa üretim de açılır')
})

test('kutu, işçi, denetçi: test değişkenleri üretimde reddedilir, testte geçer', (t) => {
  const passwd = path.join(dizin(t), 'passwd')
  fs.writeFileSync(passwd, 'havenfold-kutu:x:991:991::/:/usr/sbin/nologin\n')
  const gel = { getuid: () => 1000, passwd }
  const sd = { INVOCATION_ID: 'ab' }
  for (const [ad, ayarlar, degiskenler] of [['kutu', kutu.ayarlar, ['HF_TEST_KIPI', 'HF_ONYUKLEME', 'HF_DBUS_ADRES']], ['işçi', isci.ayarlar, ['HF_KOK', 'HF_TEST_KIPI', 'HF_ONYUKLEME']], ['denetçi', denetci.ayarlar, ['HF_KOK']]]) {
    for (const d of degiskenler) {
      const env = { [d]: d === 'HF_ONYUKLEME' ? '[]' : d === 'HF_KOK' ? '/tmp/x' : '1' }
      t.is(hataOf(() => ayarlar({ ...env, ...sd }, gel)), 'TEST_ENV_IN_PRODUCTION', ad + ' ' + d + ' systemd altında')
      t.is(hataOf(() => ayarlar(env, { getuid: () => 0, passwd })), 'TEST_ENV_IN_PRODUCTION', ad + ' ' + d + ' kökken')
      t.is(hataOf(() => ayarlar(env, { getuid: () => 991, passwd })), 'TEST_ENV_IN_PRODUCTION', ad + ' ' + d + ' havenfold-kutu kullanıcısıyla')
      t.is(hataOf(() => ayarlar(env, gel)), null, ad + ' ' + d + ' testte')
    }
    t.is(hataOf(() => ayarlar(sd, gel)), null, ad + ': test değişkeni olmadan systemd altında açılır')
  }
  t.is(kutu.ayarlar({ HF_TEST_KIPI: '1' }, gel).test, true)
  t.is(kutu.ayarlar({ ...sd, HF_KUTU_DIZIN: '/var/lib/havenfold/kutu' }, gel).test, false, 'birimdeki HF_KUTU_DIZIN test değişkeni değil')
})

test('ilk-ayar: kökken ya da systemd altında HF_TEST_KIPI/HF_KOK reddedilir, dosya yazılmaz', async (t) => {
  const kok = dizin(t)
  const satirlar = []
  const yaz = (s) => satirlar.push(s)
  t.is(await ilkAyar.ana(['--rol', 'isci'], { yaz, env: { HF_KOK: kok, HF_TEST_KIPI: '1' }, getuid: () => 0 }), 2, 'kökken taklit TPM yok')
  t.is(await ilkAyar.ana(['--rol', 'isci'], { yaz, env: { HF_KOK: kok, HF_TEST_KIPI: '1', INVOCATION_ID: 'ab' }, getuid: () => 1000 }), 2, 'systemd altında')
  t.is(await ilkAyar.ana(['--kurulum'], { yaz, env: { HF_KOK: kok }, getuid: () => 0 }), 2, 'kökken HF_KOK yok')
  t.alike(fs.readdirSync(kok), [], 'hiçbir şey yazılmadı')
  t.ok(satirlar.every((s) => s.includes('yalnız testte')))
})
