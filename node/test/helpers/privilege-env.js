// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Yetki yardımcısı testleri için kullanıcı alanında taklit kök: kökün dizini (0700, kurulumun yazdığı kök durumu),
// denetçinin önbelleği, çekirdek kimlikleri. sudo yok; systemctl ve sysfs kancadır.
const b4a = require('b4a')
const c = require('compact-encoding')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { zip: { zipYaz } } = require('@havenfold/export')
const S = require('../../release')
const { YetkiYardimcisi } = require('../../privilege-helper')
const D = require('./node-vector')

const DEN = 'havenfold-denetci'

function ortam ({ kokDurumu = D.KOK_DURUMU, roller = ['kutu', 'isci'], ...ek } = {}) {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-yetki-'))
  const onb = path.join(kok, 'var/lib/havenfold/denetci/onbellek')
  fs.mkdirSync(onb, { recursive: true })
  const yetki = path.join(kok, 'var/lib/havenfold/yetki')
  fs.mkdirSync(yetki, { recursive: true, mode: 0o700 })
  fs.chmodSync(yetki, 0o700)
  fs.writeFileSync(path.join(yetki, 'kok.durum'), c.encode(S.kokDurumuEnc, kokDurumu), { mode: 0o600 })
  for (const r of roller) {
    fs.mkdirSync(path.join(kok, 'var/lib/havenfold', r), { recursive: true })
    fs.writeFileSync(path.join(kok, 'var/lib/havenfold', r, 'kimlik'), 'x')
  }
  const systemctl = []
  const y = new YetkiYardimcisi({ kok, systemctl: (a) => systemctl.push(a), pilYaz: (e) => ({ limit: 'cekirdek', ...e }), ...ek })
  const yayinla = (surum, versionCode, { sk = D.KOK.sk, dosyalar = null, ek = {} } = {}) => {
    const paket = zipYaz(dosyalar || [{ ad: 'bin/havenfold', bytes: b4a.from('#!/bin/sh\necho ' + surum + '\n') }, { ad: 'lib/supervisor.js', bytes: b4a.from('// ' + surum) }])
    const m = D.bildirim({ version: surum, versionCode, packages: [{ os: 'linux', arch: 'amd64', name: 'p.zip', size: paket.byteLength, digest: S.paketOzeti(paket), urls: [] }], ...ek })
    const bildirim = S.bildirimYaz(m, sk)
    fs.writeFileSync(path.join(onb, surum + '.zip'), paket)
    fs.writeFileSync(path.join(onb, surum + '.bildirim'), bildirim)
    return { paket, bildirim, girdi: { surum, dosya: 'var/lib/havenfold/denetci/onbellek/' + surum + '.zip', ozet: b4a.toString(S.paketOzeti(paket), 'hex'), bildirim: 'var/lib/havenfold/denetci/onbellek/' + surum + '.bildirim' } }
  }
  const bag = (ad) => fs.readlinkSync(path.join(kok, 'opt/havenfold', ad))
  // Denetçi ve her çekirdek yeni sürümde sağlık bildirir
  const saglikli = async (surum) => {
    let r = null
    for (const k of [DEN, ...roller.map((x) => 'havenfold-' + x)]) r = await y.isle(k, 'saglik-bildir', { surum })
    return r
  }
  const kur = async (surum, vc) => {
    const a = yayinla(surum, vc)
    await y.isle(DEN, 'paket-ac', a.girdi)
    await y.isle(DEN, 'surum-gec', { surum })
    await saglikli(surum)
    return a
  }
  const sil = () => fs.rmSync(kok, { recursive: true, force: true })
  return { kok, y, systemctl, yayinla, bag, saglikli, kur, sil, onb }
}

module.exports = { ortam, DEN }
