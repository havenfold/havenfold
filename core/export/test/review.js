// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D9: inceleme 1 bulguları, RFC-0014 (kap). Beklenen değerler elle yazılmıştır.
const test = require('brittle')
const b4a = require('b4a')
const K = require('../export')
const { zipYaz, zipOku } = require('../zip')
const { kayitDisa, arsivYaz, arsivOku } = require('../archive')

const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const HIZLI = { opslimit: 3, memlimit: 64 * 1024 * 1024 }
const PAROLA = 'uzun-bir-parola-123'
let zlib = null
try { zlib = require('zlib') } catch {}

test('kap 1, 2, 4: tekrar eden ad (NFC, büyük/küçük harf), zip bombası, ZIP64 işareti', (t) => {
  t.is(hataOf(() => zipYaz([{ ad: 'Fatura.pdf', bytes: b4a.alloc(1) }, { ad: 'fatura.PDF', bytes: b4a.alloc(1) }])), 'INVALID_ZIP_NAME')
  t.is(hataOf(() => zipYaz([{ ad: 'şeker', bytes: b4a.alloc(1) }, { ad: 'şeker', bytes: b4a.alloc(1) }])), 'INVALID_ZIP_NAME', 'NFD ile aynı ad')
  const z = b4a.from(zipYaz([{ ad: 'a', bytes: b4a.alloc(10) }]))
  const cd = z.indexOf(b4a.from([0x50, 0x4b, 0x01, 0x02]))
  const b = b4a.from(z)
  new DataView(b.buffer, b.byteOffset).setUint32(cd + 24, 0xffffffff, true)
  t.is(hataOf(() => zipOku(b)), 'ZIP_TOO_LARGE')
  t.is(hataOf(() => zipOku(z, { enCokToplam: 5 })), 'ZIP_TOO_LARGE', 'bildirilen toplam açmadan önce sınırlı')
  if (!zlib) return
  // 1 MiB sıfır deflate edilip 10 bayt diye bildirilir: bildirilenden fazlası açılmaz
  const veri = b4a.alloc(1024 * 1024)
  const d = zlib.deflateRawSync(veri)
  const z2 = b4a.from(zipYaz([{ ad: 'x', bytes: d }]))
  const cd2 = z2.indexOf(b4a.from([0x50, 0x4b, 0x01, 0x02]))
  const dv = new DataView(z2.buffer, z2.byteOffset)
  dv.setUint16(8, 8, true); dv.setUint16(cd2 + 10, 8, true); dv.setUint32(cd2 + 24, 10, true); dv.setUint32(22, 10, true)
  t.is(hataOf(() => zipOku(z2, { inflate: (h, n) => zlib.inflateRawSync(h, { maxOutputLength: n }) })), 'ZIP_CHECKSUM')
})

test('kap 5, 7: bayt olmayan içerik reddedilir; parola NFC', (t) => {
  t.is(hataOf(() => K.kapla('metin', PAROLA, { urun: 'u', bicim: 'b', ...HIZLI })), 'INVALID_EXPORT')
  const nfc = 'çok-gizli-şifre-ö'
  const nfd = nfc.normalize('NFD')
  t.not(nfc, nfd)
  const kap = K.kapla(b4a.from('x'), nfc, { urun: 'u', bicim: 'b', ...HIZLI })
  t.is(b4a.toString(K.ac(kap, nfd).icerik), 'x')
})

test('kap 4: akışla yazıcı aynı kabı parça parça üretir', (t) => {
  const y = K.kapYazici(PAROLA, { urun: 'u', bicim: 'b', ...HIZLI })
  const veri = b4a.alloc(200_000, 7)
  const parcalar = [y.baslangic(), ...y.yaz(veri.subarray(0, 70_000)), ...y.yaz(veri.subarray(70_000)), y.bitir()]
  t.alike(K.ac(b4a.concat(parcalar), PAROLA).icerik, veri)
})

test('kap 8: eşzamansız açma; telefonda memlimit en çok 512 MiB', async (t) => {
  const kap = await K.kaplaAsync(b4a.from('y'), PAROLA, { urun: 'u', bicim: 'b', ...HIZLI })
  t.is(b4a.toString((await K.acAsync(kap, PAROLA, { telefon: true })).icerik), 'y')
  const { baslik } = K.baslikOku(kap)
  t.is(baslik.memlimit, 64 * 1024 * 1024)
  // 1 GiB'lık kabın başlığı: telefonda açılmaz
  const buyuk = K.kapla(b4a.from('z'), PAROLA, { urun: 'u', bicim: 'b', opslimit: 3, memlimit: 600 * 1024 * 1024, salt: b4a.alloc(16, 1) })
  await t.exception(() => K.acAsync(buyuk, PAROLA, { telefon: true }), /EXPORT_MEMORY/)
})

test('kap 9, 14: iç başvurular bütün metinlerden süzülür, varlık görünen adla, dosya adı blobId, yapay zeka ayrı; biçim ezilemez', (t) => {
  const msg = 'msg:' + '11'.repeat(32) + '/' + '22'.repeat(16)
  const f = kayitDisa({ not: 'bkz. ' + msg, kedi: 'varlik:' + 'aa'.repeat(16), d: { blobId: b4a.alloc(32, 3), fileKey: b4a.alloc(32), size: 1, mime: 'image/jpeg', name: '' }, _ai: ['not'] }, { kisiAdi: (tur) => (tur === 'varlik' ? 'Coki' : 'x') })
  t.is(f.alanlar.not, 'bkz. [kaynak]')
  t.is(f.alanlar.kedi, 'Coki')
  t.is(f.alanlar.d.dosya, 'dosyalar/' + '03'.repeat(32) + '.jpg')
  t.alike(f.yapay_zeka_alanlari, ['not'])
  const a = arsivOku(arsivYaz({ bicim: 'gercek', bicimSurum: 2, icerik: { bicim: 'sahte', bicimSurum: 9, kayitlar: [] } }))
  t.alike([a.icerik.bicim, a.icerik.bicimSurum], ['gercek', 2])
})
