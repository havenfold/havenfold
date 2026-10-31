// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Sıcaklık ölçümü (temperature.js) ve işçinin 'sicak' durumu (RFC-0002 §4, RFC-0007 §11.2): sahte sysfs ile
const test = require('brittle')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { sicaklikOku } = require('../temperature')

// dosyalar: { 'thermal_zone0/temp': '45000', … } → sys/class/thermal altında; ek: kökten göreli başka dosyalar
function kokYap (dosyalar, ek = {}) {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-sicaklik-'))
  const yaz = (yol, icerik) => { fs.mkdirSync(path.dirname(yol), { recursive: true }); fs.writeFileSync(yol, icerik) }
  for (const [ad, v] of Object.entries(dosyalar)) yaz(path.join(kok, 'sys/class/thermal', ad), v)
  for (const [ad, v] of Object.entries(ek)) yaz(path.join(kok, ad), v)
  return kok
}

test('sicaklikOku: bölgelerin en yükseği; 0, 150 °C üstü ve bozuk değer yok sayılır; hiç yoksa null', (t) => {
  t.is(sicaklikOku(kokYap({ 'thermal_zone0/temp': '45000', 'thermal_zone1/temp': '71500\n', 'cooling_device0/cur_state': '1' })).cpuC, 72)
  t.is(sicaklikOku(kokYap({ 'thermal_zone0/temp': '0', 'thermal_zone1/temp': '255000', 'thermal_zone2/temp': 'x', 'thermal_zone3/temp': '38000' })).cpuC, 38)
  t.is(sicaklikOku(kokYap({ 'thermal_zone0/temp': '0' })).cpuC, null, 'sensörsüz bölge: bilinmiyor')
  t.is(sicaklikOku(path.join(os.tmpdir(), 'hf-sicaklik-olmayan')).cpuC, null, 'sysfs yok')
})

test('işçi: 90 °C üstünde sicak, 80 °C altına inene kadar sicak kalır; NODE_CAPS tempC ölçülen değer', (t) => {
  const { IsciAgi } = require('../worker')
  const V = require('../../core/core/test/helpers/v21')
  const kok = kokYap({ 'thermal_zone0/temp': '60000' })
  const sicaklik = (c) => fs.writeFileSync(path.join(kok, 'sys/class/thermal/thermal_zone0/temp'), String(c * 1000))
  const a = new IsciAgi({ defter: () => null, me: V.C.isci1, ag: { gonder () {} }, istemci: {}, kok, olcum: { onAC: true, tempC: 0 } })
  t.alike([a.caps().status, a.caps().tempC], ['hazir', 60])
  sicaklik(91)
  t.is(a.caps().status, 'sicak', 'RFC-0002 §4: 90 °C üstünde görev yok')
  sicaklik(85)
  t.is(a.caps().status, 'sicak', 'histerezis: 80 °C altına inmeden hazir olmaz')
  sicaklik(79)
  t.is(a.caps().status, 'hazir')
  fs.rmSync(path.join(kok, 'sys'), { recursive: true })
  t.alike([a.caps().status, a.caps().tempC], ['hazir', 0], 'okunamazsa sıcaklıksız; denetçinin değeri')
})

test('denetçi: SAGLIK_ANLIK sıcaklığı ve pil sıcaklığını sysfs\'ten okur', (t) => {
  const { saglikAnlik } = require('../supervisor-main')
  const kok = kokYap({ 'thermal_zone0/temp': '83000' }, {
    'etc/havenfold/dugum.toml': 'rol = "isci"\nkanal = "kararli"\n',
    'sys/class/power_supply/AC/type': 'Mains',
    'sys/class/power_supply/AC/online': '1',
    'sys/class/power_supply/BAT0/type': 'Battery',
    'sys/class/power_supply/BAT0/capacity': '80',
    'sys/class/power_supply/BAT0/temp': '312'
  })
  const s = saglikAnlik({ kok })
  t.is(s.olcum.thermal.cpuMaxC, 83)
  t.is(s.olcum.power.battery.tempC, 31)
  t.is(JSON.parse(s.caps.toString()).tempC, 83)
  t.alike([s.olcum.platform.tpm, s.olcum.platform.secureBoot, s.olcum.platform.disk], ['yok', false, 'sifresiz'], 'TPM, EFI ve crypttab yok')
})

test('denetçi: platform alanları (TPM aygıtı, Güvenli Önyükleme, LUKS) sabit değil, makineden', (t) => {
  const { saglikAnlik } = require('../supervisor-main')
  const efi = 'sys/firmware/efi/efivars/SecureBoot-8be4df61-93ca-11d2-aa0d-e0f9884f9a5d'
  const kok = kokYap({}, {
    'etc/havenfold/dugum.toml': 'rol = "isci"\n',
    'dev/tpmrm0': '',
    [efi]: Buffer.from([6, 0, 0, 0, 1]),
    'etc/crypttab': '# yorum\ndm_crypt-0 UUID=1234 none luks,discard\n',
    'etc/havenfold/disk-sifreleme': 'luks-tpm\n'
  })
  const p = saglikAnlik({ kok }).olcum.platform
  t.alike([p.tpm, p.secureBoot, p.disk], ['var', true, 'luks-tpm'])
  t.ok(JSON.parse(saglikAnlik({ kok }).caps.toString()).tpm)
  fs.writeFileSync(path.join(kok, 'etc/havenfold/disk-sifreleme'), 'luks\n')
  t.is(saglikAnlik({ kok }).olcum.platform.disk, 'sifresiz', 'parolalı, TPM bağsız LUKS luks-tpm bildirilmez')
  fs.writeFileSync(path.join(kok, efi), Buffer.from([6, 0, 0, 0, 0]))
  fs.rmSync(path.join(kok, 'dev/tpmrm0'))
  const q = saglikAnlik({ kok }).olcum.platform
  t.alike([q.tpm, q.secureBoot, q.disk], ['yok', false, 'sifresiz'], "Güvenli Önyükleme kapalı; TPM'siz LUKS Havenfold kurulumu değil")
})
