// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
const test = require('brittle')
const b4a = require('b4a')
// zlib yalnız Node'da var; Bare'de sıkıştırmalı girdi bölümü atlanır
const zlib = (() => { try { return require('zlib') } catch { return null } })()
const K = require('..')
const { crc32, zipYaz, zipOku, adGecerli } = require('../zip')
const { kayitDisa, arsivYaz, arsivOku, disaAktar, iceAl, UZANTILAR } = require('../archive')

const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const HIZLI = { opslimit: 3, memlimit: 64 * 1024 * 1024 }

test('kap: parola en az 12 karakter; önerilen parola 24 karakter; varsayılan parametreler', (t) => {
  t.is(hataOf(() => K.kapla(b4a.from('x'), 'kisa-parola', { urun: 'u', bicim: 'b' })), 'PASSWORD_TOO_SHORT')
  const p = K.parolaOner()
  t.is(p.length, 24)
  t.ok(/^[a-km-zA-HJ-NP-Z2-9]+$/.test(p))
  t.not(K.parolaOner(), p)
  t.alike(K.VARSAYILAN, { opslimit: 4, memlimit: 128 * 1024 * 1024 })
  const kap = K.kapla(b4a.alloc(0), 'on-iki-karakter', { urun: 'u', bicim: 'b', ...HIZLI })
  t.is(K.ac(kap, 'on-iki-karakter').icerik.byteLength, 0)
  t.is(hataOf(() => K.kapla(b4a.alloc(1), 'on-iki-karakter', { urun: 'u', bicim: 'b', opslimit: 2, memlimit: 64 * 1024 * 1024 })), 'EXPORT_PARAMETER')
})

test('zip: CRC-32, sıkıştırmasız yazıp okuma, ad güvenliği, sıkıştırmalı girdi', (t) => {
  t.is(crc32(b4a.from('123456789')), 0xcbf43926)
  const z = zipYaz([{ ad: 'icerik.json', bytes: b4a.from('{}') }, { ad: 'dosyalar/ş.txt', bytes: b4a.from('ğ') }])
  t.alike(zipOku(z).map((g) => g.ad), ['icerik.json', 'dosyalar/ş.txt'])
  t.alike(zipYaz([{ ad: 'a', bytes: b4a.from('1') }]), zipYaz([{ ad: 'a', bytes: b4a.from('1') }])) // belirlenimci
  for (const ad of ['../x', '/x', 'a//b', 'a\\b', '', 'a/./b']) t.absent(adGecerli(ad), ad)
  t.is(hataOf(() => zipYaz([{ ad: 'a', bytes: b4a.alloc(0) }, { ad: 'a', bytes: b4a.alloc(0) }])), 'INVALID_ZIP_NAME')
  // Bozuk sağlama
  const bozuk = b4a.from(z)
  bozuk[30 + 'icerik.json'.length] ^= 1
  t.is(hataOf(() => zipOku(bozuk)), 'ZIP_CHECKSUM')
  if (!zlib) return
  // Sıkıştırmalı girdi: çekirdek inflate verilmeden açmaz; verilirse açar
  const veri = b4a.from('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
  const d = zlib.deflateRawSync(veri)
  const z2 = b4a.from(zipYaz([{ ad: 'x', bytes: d }]))
  z2.writeUInt16LE(8, 8) // yerel başlıkta yöntem
  const cd = z2.indexOf(b4a.from([0x50, 0x4b, 0x01, 0x02]))
  z2.writeUInt16LE(8, cd + 10)
  z2.writeUInt32LE(crc32(veri), cd + 16)
  z2.writeUInt32LE(veri.byteLength, cd + 24)
  z2.writeUInt32LE(crc32(veri), 14) // yerel başlık merkezi dizinle aynı olmalı (RFC-0021 e)
  z2.writeUInt32LE(veri.byteLength, 22)
  t.is(hataOf(() => zipOku(z2)), 'ZIP_COMPRESSION')
  t.alike(zipOku(z2, { inflate: (ham, n) => zlib.inflateRawSync(ham, { maxOutputLength: n }) })[0].bytes, veri)
})

test('arşiv: kişiler görünen adla, iç başvurular ve anahtarlar dışarı çıkmaz, yapay zeka alanları işaretli', (t) => {
  const uye = 'uye:' + 'ab'.repeat(16)
  const f = kayitDisa({
    baslik: 'Kombi', sorumlu: uye, kimler: [uye, 'device:' + 'cd'.repeat(16)], adet: 2, ham: b4a.from([1, 2]),
    belge: { blobId: b4a.alloc(32, 1), fileKey: b4a.alloc(32, 2), size: 10, mime: 'application/pdf', name: 'garanti.pdf' },
    _src: ['msg:' + '11'.repeat(32) + '/' + '22'.repeat(16), 'dosya:' + '33'.repeat(32), 'kayit:' + '44'.repeat(16) + '/' + '55'.repeat(16)],
    _ai: ['baslik'], _conf: 80, _key: b4a.alloc(16), _obs: 'kaynak:' + '66'.repeat(16)
  }, { kisiAdi: (tur, id) => (tur === 'uye' ? 'Alex' : 'Lenovo') })
  t.alike(f, {
    alanlar: {
      baslik: 'Kombi', sorumlu: 'Alex', kimler: ['Alex', 'Lenovo'], adet: 2, ham: { base64: 'AQI=' },
      belge: { dosya: 'dosyalar/' + '01'.repeat(32) + '.pdf', mime: 'application/pdf', boyut: 10 },
      _src: ['dosya:' + '33'.repeat(32)], _conf: 80
    },
    yapay_zeka_alanlari: ['baslik']
  })
  t.absent(JSON.stringify(f).includes('ab'.repeat(16)))
  const kap = disaAktar({ parola: 'uzun-bir-parola-123', urun: 'havenfold', bicim: 'hf-koleksiyon-arsiv', icerik: { kayitlar: [f] }, dosyalar: [{ ad: 'garanti.pdf', bytes: b4a.from('%PDF') }], kdf: HIZLI })
  const r = iceAl(kap, 'uzun-bir-parola-123')
  t.is(r.baslik.urun, 'havenfold')
  t.alike(r.icerik.kayitlar[0], f)
  t.is(b4a.toString(r.dosyalar[0].bytes), '%PDF')
  t.ok(b4a.toString(r.benioku).includes('Havenfold'))
  t.is(UZANTILAR['hf-koleksiyon-arsiv'], '.hfkap')
  t.is(hataOf(() => arsivYaz({ bicim: 'b', icerik: {}, dosyalar: [{ ad: '../x', bytes: b4a.alloc(0) }] })), 'INVALID_ZIP_NAME')
  t.is(hataOf(() => arsivOku(zipYaz([{ ad: 'a', bytes: b4a.alloc(0) }]))), 'INVALID_ARCHIVE')
})
