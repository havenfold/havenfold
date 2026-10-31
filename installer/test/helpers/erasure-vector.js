// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// protocol/vectors/erasure.json üreticisi (RFC-0007 §16 madde 9–11). Belirlenimci: rapor anahtarları test tohumundan
// (hash('test/silme-vektor/…')), zamanlar sabit. Beklenen değerler elle yazılır; üretici hesapladığını beklenenle
// karşılaştırır, uymazsa durur. Gerçek bir rapor anahtarı yoktur: silme ortamı her oturumda yenisini üretir.
const b4a = require('b4a')
const { hash } = require('../../../core/core/crypto/kdf')
const E = require('../../../core/core/protocol/retirement')
const B = require('../../erase/ticket')
const R = require('../../erase/report')
const Y = require('../../erase/method')

const hex = (b) => b4a.toString(b, 'hex')
const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const TS0 = 1761300000000

function beklenen (ad, gercek, istenen) {
  if (JSON.stringify(gercek) !== JSON.stringify(istenen)) throw new Error(`silme-vektor ${ad}: ${JSON.stringify(gercek)} ≠ ${JSON.stringify(istenen)}`)
  return gercek
}

const BILET = { hostId: b4a.alloc(16, 0xa1), ids: [b4a.alloc(16, 0xb2), b4a.alloc(16, 0xc3)], retireNonce: b4a.alloc(16, 0xd4) }
const CIHAZ = R.cihazBilgisi({ productSerial: 'PF2ABCDE', sysVendor: 'LENOVO', productName: '20KH002JTX' })
const DISKLER = [
  { disk: { model: 'SAHTE NVMe 512GB', seri: 'NVME0SERI1234' }, method: 'nvme-sanitize-block', result: 'ok', driveStatus: 'sstat=0x0101 sprog=65535' },
  { disk: { model: 'SAHTE HDD 1TB', seri: 'HDDSERI5678' }, method: 'overwrite-verify', result: 'ok', driveStatus: 'overwrite: tam okuma eşleşti; HPA kaldırıldı' },
  { disk: { model: 'SAHTE SSD 256GB', seri: 'SSDSERI9012' }, method: 'clear-unverified', result: 'dogrulanamadi', driveStatus: 'overwrite; disk donmuş' }
]

function oturum (tohum, kaydir = 0) {
  const anahtar = R.raporAnahtari({ tohum: hash('test/silme-vektor/' + tohum) })
  const raporlar = DISKLER.map((d, i) => R.raporYaz({ bilet: BILET, cihaz: CIHAZ, sonuc: { ...d, startedAt: TS0 + i * 600_000 + kaydir, finishedAt: TS0 + (i + 1) * 600_000 + kaydir }, toolVersion: '1.2.3', anahtar }))
  const qr = R.anahtarQr({ bilet: BILET, anahtar, diskSayisi: raporlar.length, toolVersion: '1.2.3' })
  return { anahtar, raporlar, qr }
}

function madde9 () {
  const bilet = B.biletYaz(BILET)
  const a = oturum('a')
  const b = oturum('b', 1) // başka bir silme oturumu: başka anahtar, bir ms kaymış zamanlar
  const p384 = R.raporParcalari(a.raporlar, { konsol: false })
  const p128 = R.raporParcalari(a.raporlar, { konsol: true })
  const b128 = R.raporParcalari(b.raporlar, { konsol: true })
  beklenen('9 parça sayısı', [p384.length, p128.length], [3, 7])
  // Başka oturumdan gelen bir parça: yalnız gövde baytları değişen ilk parça imzayı bozar
  let karisik = null
  for (let i = 0; i < p128.length && !karisik; i++) {
    const x = [...p128]
    x[i] = b128[i]
    if (x[i] !== p128[i] && hataOf(() => E.verifyWipe(a.qr, x)) === 'INVALID_SIGNATURE') karisik = { degisenParca: i + 1, parcalar: x }
  }
  if (!karisik) throw new Error('silme-vektor 9: karışık parça bulunamadı')
  beklenen('9 doğrulama', hataOf(() => E.verifyWipe(a.qr, p384)), null)
  beklenen('9 128 doğrulama', hataOf(() => E.verifyWipe(a.qr, [...p128].reverse())), null)
  beklenen('9 başka anahtar', hataOf(() => E.verifyWipe(b.qr, p128)), 'REPORT_KEY_MISMATCH')
  beklenen('9 eksik parça', hataOf(() => E.verifyWipe(a.qr, p128.slice(1))), 'CHUNK_MISSING')
  return {
    aciklama: 'HFRT1 bileti, HFK1 anahtar QR\'ı, 3 diskli WIPE_SET\'in 384 ve 128 baytlık parçaları; parçalar herhangi bir sırayla birleşir; başka oturumdan gelen parça imzayı bozar.',
    bilet: hex(bilet),
    biletAlanlari: { v: 1, hostId: hex(BILET.hostId), ids: BILET.ids.map(hex), retireNonce: hex(BILET.retireNonce) },
    anahtarQr: a.qr,
    raporPub: hex(a.anahtar.publicKey),
    raporlar: a.raporlar.map(hex),
    parcalar384: p384,
    parcalar128: p128,
    baskaOturum: { anahtarQr: b.qr, degisenParca: karisik.degisenParca, parcalar: karisik.parcalar, beklenen: 'INVALID_SIGNATURE' }
  }
}

function madde10 () {
  const a = oturum('a')
  const kimlikler = a.raporlar.map(E.wipeReportId).sort(b4a.compare)
  return {
    aciklama: 'wipeReportHash: tek disk hash(\'hf/wipe-report-id/\', rapor); birden çok disk hash(\'hf/wipe-report-set/\', küçükten büyüğe dizilmiş kimlikler).',
    tekDisk: { rapor: hex(a.raporlar[0]), ozet: hex(E.wipeReportHash([a.raporlar[0]])) },
    ucDisk: { raporlar: a.raporlar.map(hex), siraliKimlikler: kimlikler.map(hex), ozet: hex(E.wipeReportHash(a.raporlar)), tersSiraOzeti: hex(E.wipeReportHash([...a.raporlar].reverse())) }
  }
}

// Disk yetenekleri (kesif.diskleriBul çıktısının yönteme giren alanları) → method, beklenen ve ölçümle sonuç
const nv = (blok, kripto, format, kriptoFormat = false) => ({ sanitize: { blok, kripto, uzerineYaz: false }, format: { var: format, kriptoSilme: kriptoFormat } })
const at = (g, s = {}) => ({ guvenlik: { destek: true, etkin: false, kilitli: false, donmus: false, gelismis: true, sayacBitti: false, ...g }, sanitize: { destek: !!(s.blok || s.kripto), blok: !!s.blok, kripto: !!s.kripto, uzerineYaz: false } })
const DURUMLAR = [
  { aciklama: 'NVMe, blok ve şifreleme silme: blok silme önce', disk: { veriYolu: 'nvme', donen: false, nvme: nv(true, true, true) }, olcum: { sanitizeLog: { durum: 'basarili', driveStatus: 'sstat=0x0101 sprog=65535' }, ornek: { hata: false } }, method: 'nvme-sanitize-block', result: 'ok' },
  { aciklama: 'NVMe yalnız şifreleme silme', disk: { veriYolu: 'nvme', donen: false, nvme: nv(false, true, true) }, olcum: { sanitizeLog: { durum: 'basarili', driveStatus: 'sstat=0x0101 sprog=65535' }, ornek: { hata: false } }, method: 'nvme-sanitize-crypto', result: 'ok' },
  { aciklama: 'NVMe sanitize başarılı ama örnek bloklar değişmemiş', disk: { veriYolu: 'nvme', donen: false, nvme: nv(true, false, true) }, olcum: { sanitizeLog: { durum: 'basarili', driveStatus: 'sstat=0x0101 sprog=65535' }, ornek: { hata: true } }, method: 'nvme-sanitize-block', result: 'hata' },
  { aciklama: 'NVMe sanitize yok, Format NVM SES=2', disk: { veriYolu: 'nvme', donen: false, nvme: nv(false, false, true, true) }, olcum: { ornek: { hata: false } }, method: 'clear-unverified', result: 'dogrulanamadi', driveStatus: 'format-ses=2' },
  { aciklama: 'NVMe hiçbiri: tam üzerine yazma', disk: { veriYolu: 'nvme', donen: false, nvme: nv(false, false, false) }, olcum: { dogrulama: { tamam: true }, ornek: { hata: false } }, method: 'clear-unverified', result: 'dogrulanamadi' },
  { aciklama: 'SATA SSD, ATA Sanitize blok silme', disk: { veriYolu: 'sata', donen: false, ata: at({}, { blok: true, kripto: true }) }, olcum: { ataSanitize: { durum: 'basarili', driveStatus: 'State: SD0 Sanitize Idle Last Sanitize Operation Completed Without Error' }, ornek: { hata: false } }, method: 'ata-sanitize', result: 'ok' },
  { aciklama: 'SATA SSD, yalnız Security Erase', disk: { veriYolu: 'sata', donen: false, ata: at({}) }, olcum: { guvenlikSonra: { destek: true, etkin: false, kilitli: false, donmus: false, gelismis: true }, ornek: { hata: false } }, method: 'ata-secure-erase', result: 'ok' },
  { aciklama: 'donmuş SATA SSD, uyku–uyanmadan önce', disk: { veriYolu: 'sata', donen: false, ata: at({ donmus: true }, { blok: true }) }, gerek: 'uyku' },
  { aciklama: 'donmuş SATA SSD, uyku–uyanmadan sonra da donmuş', disk: { veriYolu: 'sata', donen: false, ata: at({ donmus: true }, { blok: true }) }, uykuDenendi: true, olcum: { dogrulama: { tamam: true }, ornek: { hata: false } }, method: 'clear-unverified', result: 'dogrulanamadi' },
  { aciklama: 'HPA\'lı HDD, HPA kaldırıldı', disk: { veriYolu: 'sata', donen: true, hpa: { gorunen: 1536, yerel: 2048, hpa: true }, dco: { var: true, kisitli: false, gercek: 2048 } }, olcum: { hpaKaldirildi: true, dogrulama: { tamam: true }, reallocated: 0 }, method: 'overwrite-verify', result: 'ok' },
  { aciklama: 'HPA\'lı HDD, HPA kaldırılamadı', disk: { veriYolu: 'sata', donen: true, hpa: { gorunen: 1536, yerel: 2048, hpa: true } }, olcum: { hpaKaldirildi: false, dogrulama: { tamam: true }, reallocated: 0 }, method: 'overwrite-verify', result: 'dogrulanamadi' },
  { aciklama: 'HDD, DCO gizli alanı', disk: { veriYolu: 'sata', donen: true, dco: { var: true, kisitli: true, gercek: 4096 } }, olcum: { dogrulama: { tamam: true }, reallocated: 0 }, method: 'overwrite-verify', result: 'dogrulanamadi' },
  { aciklama: 'HDD, yeniden atanmış sektör var', disk: { veriYolu: 'sata', donen: true }, olcum: { dogrulama: { tamam: true }, reallocated: 8 }, method: 'overwrite-verify', result: 'dogrulanamadi' },
  { aciklama: 'eMMC: tam üzerine yazma + mmc sanitize', disk: { veriYolu: 'mmc', donen: false }, olcum: { dogrulama: { tamam: true } }, method: 'clear-unverified', result: 'dogrulanamadi' },
  { aciklama: 'USB bellek', disk: { veriYolu: 'usb', donen: false }, olcum: { dogrulama: { tamam: true } }, method: 'clear-unverified', result: 'dogrulanamadi' },
  { aciklama: 'komut hata verdi', disk: { veriYolu: 'nvme', donen: false, nvme: nv(true, false, false) }, olcum: { hata: true }, method: 'nvme-sanitize-block', result: 'hata' }
]

function madde11 () {
  const durumlar = DURUMLAR.map((d) => {
    const disk = { yol: '/dev/x', boyut: 1e9, luks: [], nvme: null, ata: null, hpa: null, dco: null, ...d.disk }
    const plan = Y.yontemSec(disk, { uykuDenendi: !!d.uykuDenendi })
    if (d.gerek) { beklenen('11 ' + d.aciklama, plan.gerek, d.gerek); return d }
    const s = Y.sonucDegerlendir(plan, d.olcum)
    beklenen('11 ' + d.aciklama, [plan.method, s.result], [d.method, d.result])
    if (d.driveStatus) beklenen('11 ' + d.aciklama + ' driveStatus', s.driveStatus, d.driveStatus)
    return { ...d, beklenenIlk: plan.beklenen }
  })
  return { aciklama: 'Yöntem seçimi (RFC-0007 §13.4): disk yetenekleri ve ölçüm → method ve result. gerek: \'uyku\' önce rtcwake -m mem -s 5 ister. beklenenIlk: komutlar başarılı olursa beklenen sonuç.', durumlar }
}

function vektorler () {
  return {
    rfc: 'RFC-0007 §16 madde 9–11 (silme ortamı). Madde 1–8 ve 12 dugum.json\'dadır.',
    not: 'Rapor anahtarları test tohumundandır (hash("yuva/v2/test/silme-vektor/…")). Doğrulayıcı core/core/protocol/emeklilik.js verifyWipe. Üretici: installer/test/yardimci/silme-vektor.js.',
    9: madde9(),
    10: madde10(),
    11: madde11()
  }
}

module.exports = { vektorler }

if (require.main === module) process.stdout.write(JSON.stringify(vektorler(), null, 1) + '\n')
