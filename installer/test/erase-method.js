// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Silme ortamı: yöntem seçimi, komut planı, sonuç, desen ve örnek denetimi (RFC-0007 §13.4). Saf işlevler.
const test = require('brittle')
const b4a = require('b4a')
const Y = require('../erase/method')
const O = require('../erase/example')
const { Desen } = require('../erase/pattern')
const K = require('../erase/discovery')
const E = require('../../core/core/protocol/retirement')
const S = require('./helpers/examples')
const { belirlenimciRastgele } = require('./helpers/fake-system')

const disk = (ek) => ({ yol: '/dev/x', boyut: 1e9, veriYolu: 'sata', donen: false, luks: [], nvme: null, ata: null, hpa: null, dco: null, ...ek })
const nvme = (j) => disk({ yol: '/dev/nvme0n1', veriYolu: 'nvme', nvme: require('../erase/nvme').idCtrlCoz(j) })
const ata = (metin, ek) => disk({ yol: '/dev/sdb', ata: require('../erase/ata').hdparmCoz(metin), ...ek })

test('yöntem tablosu: her satır', (t) => {
  const s = (d, o) => { const p = Y.yontemSec(d, o); return p.gerek || p.method + '/' + p.beklenen }
  t.is(s(nvme(S.NVME_BLOK)), 'nvme-sanitize-block/ok', 'blok silme şifreleme silmeden önce')
  t.is(s(nvme(S.NVME_KRIPTO)), 'nvme-sanitize-crypto/ok')
  t.is(s(nvme(S.NVME_FORMAT)), 'clear-unverified/dogrulanamadi')
  t.is(Y.yontemSec(nvme(S.NVME_FORMAT)).ses, 1, 'FNA şifreleme silme yok: SES 1')
  t.is(Y.yontemSec(nvme({ ...S.NVME_FORMAT, fna: 4 })).ses, 2)
  t.is(Y.yontemSec(nvme(S.NVME_HICBIRI)).tur, 'uzerine-yaz')
  t.is(s(ata(S.SSD_SANITIZE_I)), 'ata-sanitize/ok')
  t.is(Y.yontemSec(ata(S.SSD_SANITIZE_I)).islem, 'blok')
  t.is(s(ata(S.SSD_GUVENLIK_I)), 'ata-secure-erase/ok')
  t.is(Y.yontemSec(ata(S.SSD_GUVENLIK_I)).gelismis, true, 'geliştirilmiş tercih')
  t.is(s(ata(S.SSD_DONMUS_I)), 'uyku', 'donmuş: önce uyku–uyanma')
  t.is(s(ata(S.SSD_DONMUS_I), { uykuDenendi: true }), 'clear-unverified/dogrulanamadi')
  const hdd = disk({ yol: '/dev/sda', donen: true, hpa: { gorunen: 1, yerel: 2, hpa: true }, dco: { kisitli: false } })
  t.is(s(hdd), 'overwrite-verify/ok')
  t.is(Y.yontemSec(hdd).hpaKaldir, true)
  t.is(s({ ...hdd, dco: { kisitli: true } }), 'overwrite-verify/dogrulanamadi', 'DCO gizli alanı')
  t.is(s(disk({ veriYolu: 'mmc' })), 'clear-unverified/dogrulanamadi')
  t.is(Y.yontemSec(disk({ veriYolu: 'mmc' })).tur, 'mmc')
  t.is(s(disk({ veriYolu: 'usb' })), 'clear-unverified/dogrulanamadi')
  t.is(s(disk({ veriYolu: 'usb', donen: true })), 'overwrite-verify/ok', 'dönen USB disk HDD satırı')
  t.is(s(disk({ veriYolu: 'diger' })), 'clear-unverified/dogrulanamadi')
  // Bütün yöntemler WIPE_REPORT listesinde
  for (const d of [nvme(S.NVME_BLOK), nvme(S.NVME_KRIPTO), ata(S.SSD_SANITIZE_I), ata(S.SSD_GUVENLIK_I), hdd, disk({ veriYolu: 'mmc' })]) {
    t.ok(E.METHODS.includes(Y.yontemSec(d).method))
  }
})

test('komut planı: denetleyici, LUKS önce, TRIM yok, parola yer tutucu', (t) => {
  const d = { ...nvme(S.NVME_BLOK), luks: ['/dev/nvme0n1p3'] }
  const k = Y.komutlar(Y.yontemSec(d), d)
  t.alike(k.baslat, ['nvme', 'sanitize', '/dev/nvme0', '--sanact=2'])
  t.alike(k.durum, ['nvme', 'sanitize-log', '/dev/nvme0', '-o', 'json'])
  t.alike(k.luks, [['cryptsetup', 'erase', '-q', '/dev/nvme0n1p3']])
  t.alike(Y.komutlar(Y.yontemSec(nvme(S.NVME_KRIPTO)), nvme(S.NVME_KRIPTO)).baslat[3], '--sanact=4')
  t.alike(Y.komutlar(Y.yontemSec(nvme(S.NVME_FORMAT)), nvme(S.NVME_FORMAT)).baslat, ['nvme', 'format', '/dev/nvme0n1', '--ses=1', '--force'])
  const g = ata(S.SSD_GUVENLIK_I)
  const kg = Y.komutlar(Y.yontemSec(g), g)
  t.ok(kg.parolaKur.includes(Y.PAROLA) && kg.baslat.includes('--security-erase-enhanced') && kg.kaldir.includes('--security-disable'))
  const h = disk({ yol: '/dev/sda', donen: true, hpa: { gorunen: 1536, yerel: 2048, hpa: true } })
  t.alike(Y.komutlar(Y.yontemSec(h), h).hpa, ['hdparm', '--yes-i-know-what-i-am-doing', '-N', 'p2048', '/dev/sda'])
  // blkdiscard hiçbir planda yok (kurucu belge §9.5)
  const hepsi = [d, nvme(S.NVME_KRIPTO), nvme(S.NVME_FORMAT), nvme(S.NVME_HICBIRI), ata(S.SSD_SANITIZE_I), g, h, disk({ veriYolu: 'mmc' }), disk({ veriYolu: 'usb' })]
  for (const x of hepsi) {
    const p = Y.yontemSec(x, { uykuDenendi: true })
    const metin = JSON.stringify(Y.komutlar(p, x))
    t.absent(/blkdiscard|discard|fstrim/.test(metin), p.method + ': TRIM yok')
  }
})

test('sonuç değerlendirmesi', (t) => {
  const N = require('../erase/nvme')
  const p = Y.yontemSec(nvme(S.NVME_BLOK))
  t.alike(Y.sonucDegerlendir(p, { sanitizeLog: N.sanitizeLogCoz(S.sanitizeLog(0x101, 65535)), ornek: { hata: false } }), { result: 'ok', driveStatus: 'sstat=0x0101 sprog=65535', uyari: null })
  t.is(Y.sonucDegerlendir(p, { sanitizeLog: N.sanitizeLogCoz(S.sanitizeLog(0x103, 0)) }).result, 'hata', 'SSTAT başarısız')
  t.is(Y.sonucDegerlendir(p, { sanitizeLog: N.sanitizeLogCoz(S.sanitizeLog(0x101, 65535)), ornek: { hata: true } }).result, 'hata', 'örnek bloklar değişmedi')
  t.is(Y.sonucDegerlendir(p, { hata: true }).result, 'hata', 'komut hatası')
  const f = Y.yontemSec(nvme(S.NVME_FORMAT))
  const rf = Y.sonucDegerlendir(f, {})
  t.is(rf.result, 'dogrulanamadi')
  t.is(rf.driveStatus, 'format-ses=1')
  t.is(rf.uyari, 'Temizlendi, doğrulanamadı; fiziksel imha önerilir.')
  const g = Y.yontemSec(ata(S.SSD_GUVENLIK_I))
  const A = require('../erase/ata')
  t.is(Y.sonucDegerlendir(g, { guvenlikSonra: A.guvenlikCoz(S.SSD_GUVENLIK_SONRA_I) }).result, 'ok')
  const kilitli = Y.sonucDegerlendir(g, { guvenlikSonra: { ...A.guvenlikCoz(S.SSD_GUVENLIK_I), etkin: true, kilitli: true } })
  t.is(kilitli.result, 'hata')
  t.ok(kilitli.driveStatus.includes('locked') && kilitli.driveStatus.includes('disk kilitli kaldı'))
  const h = Y.yontemSec(disk({ donen: true, hpa: { gorunen: 1, yerel: 2, hpa: true } }))
  t.is(Y.sonucDegerlendir(h, { dogrulama: { tamam: true }, hpaKaldirildi: true }).result, 'ok')
  t.is(Y.sonucDegerlendir(h, { dogrulama: { tamam: true }, hpaKaldirildi: false }).result, 'dogrulanamadi', 'HPA kaldırılamadı')
  t.is(Y.sonucDegerlendir(h, { dogrulama: { tamam: true }, hpaKaldirildi: true, reallocated: 3 }).result, 'dogrulanamadi', 'yeniden atanmış sektör')
  t.is(Y.sonucDegerlendir(h, { dogrulama: { tamam: false }, hpaKaldirildi: true }).result, 'hata', 'okunan desen tutmadı')
  t.is(b4a.byteLength(Y.kisalt('ş'.repeat(400))), 511, 'driveStatus 512 bayt, karakter bölünmez')
})

test('desen: konumdan bağımsız üretim, sıfır değil, silinince kullanılamaz', (t) => {
  const r = belirlenimciRastgele('desen')
  const d = new Desen({ anahtar: r(32), nonce: r(24) })
  const tum = d.parca(0, 4096)
  t.alike(d.parca(1024, 512), tum.subarray(1024, 1536), 'ofsetten başlayan parça aynı akış')
  t.ok(d.dogrula(2048, tum.subarray(2048, 4096)))
  t.absent(d.dogrula(0, b4a.alloc(64)), 'sıfır okuyan disk geçmez')
  t.absent(O.sifirMi(tum))
  t.exception(() => d.parca(3, 10), /INVALID_PATTERN_OFFSET/)
  d.sil()
  t.exception(() => d.parca(0, 64), /PATTERN_ERASED/)
})

test('örnek: 256 konum, değişmeyen sıfır dışı blok hata', (t) => {
  const r = belirlenimciRastgele('ornek')
  const k = O.konumlar(8 * 1024 * 1024, r)
  t.is(k.length, 256)
  t.ok(k.every((x) => x % 4096 === 0 && x < 8 * 1024 * 1024))
  t.is(O.konumlar(3 * 4096, r).length, 3, 'küçük diskte blok sayısı kadar')
  const blok = (v) => b4a.alloc(4096, v)
  const once = new Map([[0, O.ozet(blok(1))], [4096, O.ozet(blok(2))]])
  t.alike(O.karsilastir(once, new Map([[0, blok(0)], [4096, blok(9)]])), { hata: false, ayni: 0, sifir: 1, okunan: 2 })
  t.is(O.karsilastir(once, new Map([[0, blok(0)], [4096, blok(2)]])).hata, true)
  t.exception(() => O.karsilastir(once, new Map()), /SAMPLE_MISSING/)
})

test('keşif + seçim birlikte: lsblk örneğindeki her disk', (t) => {
  const d = K.diskleriBul(S.LSBLK, {
    nvme: { '/dev/nvme0n1': S.NVME_BLOK },
    hdparm: { '/dev/sda': S.HDD_I, '/dev/sdb': S.SSD_DONMUS_I },
    hpa: { '/dev/sda': S.hpaN(1536, 2048) }
  })
  t.alike(d.map((x) => Y.yontemSec(x, { uykuDenendi: true }).method), ['nvme-sanitize-block', 'overwrite-verify', 'clear-unverified', 'clear-unverified', 'clear-unverified'])
})
