// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Silme oturumu uçtan uca, sahte sistemle (RFC-0007 §13.2): keşif, bilet, anahtar QR'ı, onay, sanitize, rapor QR'ları.
// Ürettiği raporlar telefonun doğrulayıcısıyla (core/core/protocol/retirement.js verifyWipe) doğrulanır. Hiçbir gerçek
// komut ya da aygıt kullanılmaz; kabuk yalnız silme ortamında açılır.
const test = require('brittle')
const b4a = require('b4a')
const E = require('../../core/core/protocol/retirement')
const B = require('../erase/ticket')
const R = require('../erase/report')
const O = require('./helpers/examples')
const { SilmeOturumu } = require('../erase/session')
const { sahteSistem } = require('./helpers/fake-system')
const { ortamDenetle } = require('../erase/shell')

const ISCI = b4a.alloc(16, 0x11)
const KUTU = b4a.alloc(16, 0x22)
const BILET = B.biletYaz({ hostId: b4a.alloc(16, 0x33), ids: [ISCI, KUTU], retireNonce: b4a.alloc(16, 0x44) })

test('uçtan uca: beş disk, bilet, raporlar verifyWipe ile doğrulanır', async (t) => {
  const s = sahteSistem({ esp: { '/dev/nvme0n1p1': BILET } })
  const o = new SilmeOturumu({ sistem: s.sistem, toolVersion: '1.2.3' })
  const r = await o.calis()
  t.is(r.secim, 'kapat')
  t.alike(r.sonuclar.map((x) => [x.disk.yol, x.method, x.result]), [
    ['/dev/nvme0n1', 'nvme-sanitize-block', 'ok'],
    ['/dev/sda', 'overwrite-verify', 'ok'],
    ['/dev/sdb', 'clear-unverified', 'dogrulanamadi'],
    ['/dev/mmcblk0', 'clear-unverified', 'dogrulanamadi'],
    ['/dev/sdd', 'clear-unverified', 'dogrulanamadi']
  ])
  // Telefon: anahtar QR'ı + rapor parçaları
  t.is(s.qrlar.length, 2)
  const anahtar = s.qrlar[0].metinler[0]
  const parcalar = s.qrlar[1].metinler
  t.ok(anahtar.startsWith('HFK1:'))
  t.ok(parcalar.every((p) => /^HFW1:[0-9]+\/[0-9]+:/.test(p)))
  t.ok(parcalar.every((p) => p.length <= 213), 'metin konsolu parçası bayt kipinde QR sürüm 10\'a sığar')
  const v = E.verifyWipe(anahtar, [...parcalar].reverse())
  t.is(v.reports.length, 5)
  t.alike(v.key.ids, [ISCI, KUTU])
  t.ok(v.reports.every((x) => b4a.equals(x.deviceId, ISCI)), 'deviceId biletteki ilk kimlik')
  t.is(v.reports[0].serial, 'PF2ABCDE')
  t.is(v.reports[0].model, 'LENOVO 20KH002JTX')
  t.is(v.reports[0].diskSerial, 'NVME0SERI1234')
  t.is(v.reports[0].tool, 'havenfold-sil')
  t.is(v.reports[0].toolVersion, '1.2.3')
  t.is(v.reports[0].driveStatus, 'sstat=0x0101 sprog=65535')
  t.ok(v.reports[1].driveStatus.includes('HPA kaldırıldı'))
  t.ok(v.reports[2].driveStatus.includes('disk donmuş'))
  t.ok(v.reports.every((x) => x.startedAt <= x.finishedAt))
  t.alike(v.wipeReportHash, E.wipeReportHash(r.raporlar))
  t.is(v.anyError, false)
  // Diskler gerçekten temizlendi (sahte tamponlar)
  t.ok(s.diskler.get('/dev/nvme0n1').every((x) => x === 0))
  t.ok(s.ekran.includes('Temizlendi, doğrulanamadı; fiziksel imha önerilir.'))
  // Sıra: LUKS önce, sanitize sonra; donmuş disk için rtcwake; TRIM hiç yok
  const k = s.kayit.map((a) => a.join(' '))
  t.ok(k.indexOf('cryptsetup erase -q /dev/nvme0n1p3') < k.indexOf('nvme sanitize /dev/nvme0 --sanact=2'))
  t.ok(k.includes('rtcwake -m mem -s 5'))
  t.absent(k.some((x) => /blkdiscard|fstrim/.test(x)))
  // Anahtar oturum bitince silindi
  t.is(o.anahtar.silindi, true)
  t.ok(o.anahtar.secretKey.every((x) => x === 0))
})

test('bilet yok: deviceId sıfır, QR ids boş; telefonun verifyWipe\'ı kimliksiz raporu reddeder', async (t) => {
  const s = sahteSistem({ cevaplar: ['H', 'SIL', '1'] })
  const r = await new SilmeOturumu({ sistem: s.sistem, toolVersion: '1.2.3' }).calis()
  t.ok(s.ekran.includes('Bilet yok: cihaz kimliği doğrulanamayacak.'))
  t.is(r.sonuclar.length, 4, 'harici diske H denildi')
  const k = E.decodeKeyQr(s.qrlar[0].metinler[0])
  t.alike(k.ids, [])
  t.alike(k.hostId, b4a.alloc(16))
  t.is(k.disks, 4)
  const raporlar = E.joinReportChunks(s.qrlar[1].metinler).map((x) => E.verifyWipeReport(x, k.reportPub))
  t.ok(raporlar.every((x) => b4a.equals(x.deviceId, b4a.alloc(16))))
  t.exception(() => E.verifyWipe(s.qrlar[0].metinler[0], s.qrlar[1].metinler), /INVALID_REPORT/, 'seçenek yoksa bugünkü davranış')
  // RFC-0007 §13.2 adım 4: bilet yoksa telefon "Kimlik doğrulanamadı; bu cihazı siz mi seçtiniz?" diye sorar
  const v = E.verifyWipe(s.qrlar[0].metinler[0], s.qrlar[1].metinler, { biletsiz: true })
  t.is(v.biletsiz, true)
  t.is(v.reports.length, 4)
  t.alike(v.wipeReportHash, E.wipeReportHash(v.raw))
})

test('verifyWipe biletsiz seçeneği: biletli oturum aynen, kimliksiz rapor yalnız sıfır alanlarla', async (t) => {
  const s = sahteSistem({ esp: { '/dev/nvme0n1p1': BILET } })
  await new SilmeOturumu({ sistem: s.sistem, toolVersion: '1.2.3' }).calis()
  const biletli = E.verifyWipe(s.qrlar[0].metinler[0], s.qrlar[1].metinler, { biletsiz: true })
  t.is(biletli.biletsiz, false, 'bilet varsa seçenek bir şey değiştirmez')
  t.is(E.verifyWipe(s.qrlar[0].metinler[0], s.qrlar[1].metinler).biletsiz, false)
  // ids boş ama hostId sıfır değil: bilet yok sayılamaz
  const anahtar = R.raporAnahtari()
  const sonuc = { disk: { model: 'm', seri: 's' }, method: 'clear-unverified', result: 'dogrulanamadi', driveStatus: 'overwrite', startedAt: 1, finishedAt: 2 }
  const rapor = R.raporYaz({ bilet: B.BILETSIZ, cihaz: R.cihazBilgisi({}), sonuc, toolVersion: '1.0.0', anahtar })
  const parcalar = R.raporParcalari([rapor])
  const qr = (m) => E.encodeKeyQr({ hostId: b4a.alloc(16), ids: [], retireNonce: b4a.alloc(16), reportPub: anahtar.publicKey, disks: 1, toolVersion: '1.0.0', ...m })
  t.is(E.verifyWipe(qr({}), parcalar, { biletsiz: true }).biletsiz, true)
  t.exception(() => E.verifyWipe(qr({ hostId: b4a.alloc(16, 1) }), parcalar, { biletsiz: true }), /INVALID_REPORT/)
  t.exception(() => E.verifyWipe(qr({ retireNonce: b4a.alloc(16, 1) }), parcalar, { biletsiz: true }), /INVALID_REPORT/)
  // deviceId sıfır olmayan rapor biletsiz oturumda geçmez
  const kimlikli = R.raporYaz({ bilet: { ids: [ISCI] }, cihaz: R.cihazBilgisi({}), sonuc, toolVersion: '1.0.0', anahtar })
  t.exception(() => E.verifyWipe(qr({}), R.raporParcalari([kimlikli]), { biletsiz: true }), /INVALID_REPORT/)
  // İmza denetimi biletsizde de geçerli
  const baska = R.raporAnahtari()
  t.exception(() => E.verifyWipe(qr({ reportPub: baska.publicKey }), parcalar, { biletsiz: true }), /REPORT_KEY_MISMATCH/)
})

test('yazmayı yok sayan disk ve başarısız sanitize: hata', async (t) => {
  const s = sahteSistem({ bozuk: ['/dev/sda'], sanitizeBasarisiz: true, esp: { '/dev/nvme0n1p1': BILET } })
  const r = await new SilmeOturumu({ sistem: s.sistem, toolVersion: '1.2.3' }).calis()
  t.is(r.sonuclar[0].result, 'hata')
  t.ok(r.sonuclar[0].driveStatus.startsWith('sstat=0x0003'))
  t.is(r.sonuclar[1].result, 'hata')
  const v = E.verifyWipe(s.qrlar[0].metinler[0], s.qrlar[1].metinler)
  t.is(v.anyError, true, 'telefon DEVICE_DETACH öncesi uyarır')
})

test('ATA Security Erase: parola ekrana ve kayda yazılmaz, sonuç güvenlik durumundan', async (t) => {
  const s = sahteSistem({ ssd: O.SSD_GUVENLIK_I, esp: { '/dev/nvme0n1p1': BILET } })
  const o = new SilmeOturumu({ sistem: s.sistem, toolVersion: '1.2.3' })
  const r = await o.calis()
  const sdb = r.sonuclar.find((x) => x.disk.yol === '/dev/sdb')
  t.is(sdb.method, 'ata-secure-erase')
  t.is(sdb.result, 'ok')
  t.is(sdb.driveStatus, 'security: not enabled, not locked')
  const parolali = s.kayit.filter((a) => a.includes('--security-set-pass'))
  t.is(parolali.length, 1)
  const parola = parolali[0][4]
  t.ok(/^[0-9a-f]{24}$/.test(parola), 'rastgele parola')
  t.absent(s.ekran.some((x) => x.includes(parola)), 'parola ekranda yok')
})

test('onay verilmezse hiçbir disk silinmez, anahtar yine silinir', async (t) => {
  const s = sahteSistem({ cevaplar: ['H', 'sil'] })
  const o = new SilmeOturumu({ sistem: s.sistem, toolVersion: '1.2.3' })
  const r = await o.calis()
  t.is(r.secim, 'iptal')
  t.absent(s.kayit.some((a) => ['sanitize', 'format', 'erase'].includes(a[1]) || a.includes('--security-set-pass')))
  t.ok(s.diskler.get('/dev/nvme0n1').some((x) => x !== 0), 'veri yerinde')
  t.is(o.anahtar.silindi, true)
})

test('kabuk yalnız silme ortamında açılır (bu makinede çalışmaz)', (t) => {
  t.exception(() => ortamDenetle(), /NOT_ERASE_ENVIRONMENT/, 'geliştirme makinesi')
  t.exception(() => ortamDenetle({ platform: 'linux', oku: () => 'BOOT_IMAGE=/vmlinuz quiet', var_: () => true }), /NOT_ERASE_ENVIRONMENT/, 'çekirdek satırında işaret yok')
  t.exception(() => ortamDenetle({ platform: 'linux', oku: () => 'boot=casper havenfold.silme=1', var_: () => false }), /NOT_ERASE_ENVIRONMENT/, 'kök dosya sistemi işareti yok')
  t.execution(() => ortamDenetle({ platform: 'linux', oku: () => 'boot=casper toram havenfold.silme=1 quiet', var_: () => true }))
})

test('rapor anahtarı: sodium_malloc, imza, silinince kullanılamaz', (t) => {
  const k = R.raporAnahtari()
  t.is(k.publicKey.byteLength, 32)
  const sonuc = { disk: { model: 'm', seri: 's' }, method: 'ata-sanitize', result: 'ok', driveStatus: 'x', startedAt: 1, finishedAt: 2 }
  const rapor = R.raporYaz({ bilet: B.BILETSIZ, cihaz: R.cihazBilgisi({}), sonuc, toolVersion: '1.0.0', anahtar: k })
  t.ok(E.verifyWipeReport(rapor, k.publicKey))
  R.anahtariSil(k)
  t.exception(() => R.raporYaz({ bilet: B.BILETSIZ, cihaz: R.cihazBilgisi({}), sonuc, toolVersion: '1.0.0', anahtar: k }), /KEY_ERASED/)
})

test('bilet: HFRT1 biçimi, en çok 512 bayt, çelişen biletler', (t) => {
  const m = B.biletCoz(BILET)
  t.alike(m.ids, [ISCI, KUTU])
  t.is(m.v, 1)
  t.exception(() => B.biletCoz(b4a.concat([b4a.from('HFRT2'), BILET.subarray(5)])), /INVALID_TICKET/)
  t.exception(() => B.biletCoz(b4a.concat([BILET, b4a.from([0])])), /INVALID_TICKET/, 'fazla bayt')
  t.exception(() => B.biletYaz({ hostId: b4a.alloc(16), ids: [], retireNonce: b4a.alloc(16) }), /INVALID_TICKET/)
  t.exception(() => B.biletYaz({ hostId: b4a.alloc(16), ids: new Array(31).fill(ISCI), retireNonce: b4a.alloc(16) }), /INVALID_TICKET/, '512 baytı aşan')
  t.is(B.biletSec([null, b4a.from('bozuk')]).yok, true)
  t.alike(B.biletSec([BILET, BILET]).ids, [ISCI, KUTU])
  const baska = B.biletYaz({ hostId: b4a.alloc(16, 9), ids: [ISCI], retireNonce: b4a.alloc(16, 9) })
  t.exception(() => B.biletSec([BILET, baska]), /TICKET_CONFLICT/)
})

test('rapor QR\'ı çerçeve arabelleğine piksel olarak çizilir (yazı tipinden bağımsız)', (t) => {
  const { cerceveyeCiz } = require('../erase/shell')
  const { qrKodla } = require('../../node/qr')
  const w = 640
  const h = 480
  const stride = w * 4
  const bellek = Buffer.alloc(stride * h, 0x55)
  const fb = { w, h, bpp: 32, stride, yaz: (o, b) => b.copy(bellek, o) }
  const q = qrKodla('HFW1:1/4:' + 'A'.repeat(180))
  const { modul, kenar } = cerceveyeCiz(fb, q, 64)
  t.ok(modul >= 5, 'modül en az 5 piksel')
  t.ok(64 + kenar <= h && kenar <= w, 'ekrana sığar')
  const piksel = (x, y) => bellek.readUInt32LE(y * stride + x * 4)
  const n = q.moduller.length
  let tutar = 0
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const p = piksel((x + 4) * modul + (modul >> 1), 64 + (y + 4) * modul + (modul >> 1))
      if (p === (q.moduller[y][x] ? 0 : 0xffffffff)) tutar++
    }
  }
  t.is(tutar, n * n, 'her modülün ortası doğru renkte')
  t.is(piksel(1, 64 + 1), 0xffffffff, 'kenar boşluğu beyaz')
  t.is(piksel(1, 10), 0x55555555, 'üstteki metin alanına dokunulmaz')
})
