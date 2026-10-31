// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Silme ortamı: komut çıktılarının ayrıştırılması ve disk keşfi (RFC-0007 §13.3). Yalnız sahte çıktılar.
const test = require('brittle')
const N = require('../erase/nvme')
const A = require('../erase/ata')
const K = require('../erase/discovery')
const O = require('./helpers/examples')

test('nvme id-ctrl: SANICAP, OACS ve FNA bitleri', (t) => {
  const b = N.idCtrlCoz(JSON.stringify(O.NVME_BLOK))
  t.is(b.model, 'SAHTE NVMe 512GB')
  t.is(b.seri, 'NVME0SERI1234')
  t.alike(b.sanitize, { kripto: true, blok: true, uzerineYaz: false })
  t.alike(b.format, { var: true, kriptoSilme: true })
  t.alike(N.idCtrlCoz(O.NVME_KRIPTO).sanitize, { kripto: true, blok: false, uzerineYaz: false })
  t.alike(N.idCtrlCoz(O.NVME_HICBIRI).format, { var: false, kriptoSilme: false })
  t.is(N.idCtrlCoz({ sanicap: '0x2', oacs: '0x2', fna: 0 }).sanitize.blok, true, 'onaltılık dizge de okunur')
  t.exception(() => N.idCtrlCoz('{bozuk'), /INVALID_NVME_OUTPUT/)
})

test('nvme sanitize-log: SSTAT durumları, aygıt adının altındaki biçim', (t) => {
  t.alike(N.sanitizeLogCoz(O.sanitizeLog(0x0101, 65535)), { sstat: 0x101, sprog: 65535, durum: 'basarili', kuresel: true, driveStatus: 'sstat=0x0101 sprog=65535' })
  t.is(N.sanitizeLogCoz(O.sanitizeLog(0x0002, 100)).durum, 'suruyor')
  t.is(N.sanitizeLogCoz(O.sanitizeLog(0x0003, 0)).durum, 'basarisiz')
  t.is(N.sanitizeLogCoz({ sstat: 4, sprog: 65535 }).durum, 'basarili', 'düz biçim ve kod 4')
  t.is(N.sanitizeLogCoz({ sstat: 0, sprog: 0 }).durum, 'hic')
  t.is(N.denetleyici('/dev/nvme1n2'), '/dev/nvme1')
  t.exception(() => N.denetleyici('/dev/sda'), /INVALID_NVME_PATH/)
})

test('hdparm -I: güvenlik bölümü, donmuş, gelişmiş silme, ATA Sanitize', (t) => {
  const d = A.hdparmCoz(O.SSD_DONMUS_I)
  t.is(d.model, 'SAHTE SSD 256GB')
  t.is(d.seri, 'SSDSERI9012')
  t.is(d.ssd, true)
  t.alike(d.guvenlik, { destek: true, etkin: false, kilitli: false, donmus: true, gelismis: true, sayacBitti: false })
  t.alike(d.sanitize, { destek: true, blok: true, kripto: true, uzerineYaz: false })
  const h = A.hdparmCoz(O.HDD_I)
  t.is(h.ssd, false)
  t.is(h.donusHizi, 7200)
  t.is(h.sanitize.destek, false)
  t.is(A.hdparmCoz(O.SSD_GUVENLIK_I).guvenlik.donmus, false)
  t.alike(A.hdparmCoz('').guvenlik.destek, false, 'boş çıktı')
})

test('hdparm -N ve --dco-identify: gizli alanlar', (t) => {
  t.alike(A.hpaCoz(O.hpaN(1536, 2048)), { gorunen: 1536, yerel: 2048, hpa: true })
  t.alike(A.hpaCoz(O.hpaN(2048, 2048)), { gorunen: 2048, yerel: 2048, hpa: false })
  t.is(A.hpaCoz('SG_IO: bad/missing sense data'), null)
  t.alike(A.dcoCoz(O.DCO_YOK, 2048), { var: true, kisitli: false, gercek: 2048 })
  t.alike(A.dcoCoz(O.DCO_GIZLI, 2048), { var: true, kisitli: true, gercek: 4096 })
  t.alike(A.dcoCoz('', 2048), { var: false, kisitli: false, gercek: 0 })
})

test('hdparm --sanitize-status', (t) => {
  t.is(A.sanitizeDurumCoz(O.SANITIZE_SURUYOR).durum, 'suruyor')
  t.is(A.sanitizeDurumCoz(O.SANITIZE_SURUYOR).ilerleme, 50)
  t.is(A.sanitizeDurumCoz(O.SANITIZE_TAMAM).durum, 'basarili')
  t.is(A.sanitizeDurumCoz('Sanitize operation failed').durum, 'basarisiz')
})

test('disk keşfi: dışlananlar, iç/harici, LUKS bölümleri, yetenekler', (t) => {
  const d = K.diskleriBul(O.LSBLK, {
    nvme: { '/dev/nvme0n1': JSON.stringify(O.NVME_BLOK) },
    hdparm: { '/dev/sda': O.HDD_I, '/dev/sdb': O.SSD_DONMUS_I },
    hpa: { '/dev/sda': O.hpaN(1536, 2048) },
    dco: { '/dev/sda': O.DCO_YOK },
    luks: { '/dev/nvme0n1p3': true }
  })
  t.alike(d.map((x) => x.yol), ['/dev/nvme0n1', '/dev/sda', '/dev/sdb', '/dev/mmcblk0', '/dev/sdd'], 'loop, Kurulum USB\'si (iso9660) ve mmcblk0boot0 yok')
  t.alike(d.map((x) => x.veriYolu), ['nvme', 'sata', 'sata', 'mmc', 'usb'])
  t.alike(d.map((x) => x.secili), [true, true, true, true, false], 'harici disk seçili gelmez')
  t.alike(d[0].luks, ['/dev/nvme0n1p3'])
  t.is(d[0].nvme.sanitize.blok, true)
  t.is(d[1].donen, true)
  t.is(d[1].hpa.hpa, true)
  t.is(d[2].ata.guvenlik.donmus, true)
  t.is(d[4].harici, true)
  // isLuks sonucu verilmezse lsblk'nin crypto_LUKS'u kullanılır
  t.alike(K.diskleriBul(O.LSBLK)[0].luks, ['/dev/nvme0n1p3'])
  t.ok(K.tabloSatiri(d[0]).includes('…1234'), 'tabloda seri yalnız son 4 hane')
})

test('disk keşfi: eski lsblk ("0"/"1" dizgeleri) ve bozuk girdi', (t) => {
  const eski = { blockdevices: [{ name: 'sda', path: '/dev/sda', type: 'disk', size: '500107862016', rota: '1', rm: '0', hotplug: '0', tran: 'sata', model: 'X', serial: 'Y', mountpoint: null }] }
  const d = K.diskleriBul(eski)
  t.is(d[0].donen, true)
  t.is(d[0].boyut, 500107862016)
  t.is(d[0].secili, true)
  t.exception(() => K.lsblkCoz('{}'), /INVALID_LSBLK/)
})

test('ESP bölümleri: açılış USB\'sinin ESP\'si sayılmaz', (t) => {
  t.alike(K.espBolumleri(O.LSBLK), ['/dev/nvme0n1p1'])
})
