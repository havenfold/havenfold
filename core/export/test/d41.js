// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D41: kap dışa aktarmada bellek. ZIP ve kap akışla yazılır; çıktı eski yazıcıyla aynı biçimde. Beklenenler elle.
const test = require('brittle')
const b4a = require('b4a')
const { zip: Z, arsiv: AR } = require('..')

const HIZLI = { opslimit: 3, memlimit: 64 * 1024 * 1024 }
const PAROLA = 'yirmi-dort-karakterli-p'
const hataOfA = async (fn) => { try { await fn(); return null } catch (err) { return err.message } }

test('zipAkis: zipYaz ile bayt bayt aynı (parça parça veri); ölçülenden farklı veri INVALID_ZIP', (t) => {
  const g = [{ ad: 'icerik.json', bytes: b4a.from('{"a":1}') }, { ad: 'dosyalar/x.pdf', bytes: b4a.alloc(200000, 7) }, { ad: 'BENIOKU.txt', bytes: b4a.from('oku') }]
  const parcala = (b) => [b.subarray(0, 3), b.subarray(3, 70000), b.subarray(70000)]
  const out = []
  const z = Z.zipAkis((b) => out.push(b4a.from(b)))
  for (const x of g) z.girdi(x.ad, { boy: x.bytes.byteLength, crc: Z.crc32(x.bytes), parcalar: parcala(x.bytes) })
  z.bitir()
  t.ok(b4a.equals(b4a.concat(out), Z.zipYaz(g)), 'aynı arşiv')
  const z2 = Z.zipAkis(() => {})
  t.exception(() => z2.girdi('a.txt', { boy: 5, crc: 0, parcalar: [b4a.from('abc')] }), /INVALID_ZIP/)
  t.exception(() => z2.girdi('../a', { boy: 0, crc: 0, parcalar: [] }), /INVALID_ZIP_NAME/)
})

test('disaAktarAkis: parçalar sınırlı boyda gelir; birleşince mevcut açıcıyla açılır; içerik ve dosyalar aynı', async (t) => {
  const icerik = { olusturma: 1, koleksiyonlar: [{ ad: 'Tüm Aile', kayitlar: Array.from({ length: 300 }, (_, i) => ({ tur: 'yuva.defter.not', alanlar: { baslik: 'Not ' + i, metin: 'x'.repeat(500) } })) }] }
  const metin = b4a.from(JSON.stringify({ bicim: 'yuva-defter-arsiv', bicimSurum: 1, ...icerik }))
  const dosya = b4a.alloc(300000, 3)
  let dosyaCagri = 0
  const parcalar = []
  const r = await AR.disaAktarAkis({
    parola: PAROLA, urun: 'yuva-defteri', bicim: 'yuva-defter-arsiv', bicimSurum: 1, kdf: HIZLI,
    icerikParcalari: function * () { for (let i = 0; i < metin.byteLength; i += 1000) yield metin.subarray(i, i + 1000) },
    dosyalar: [{ ad: 'garanti.pdf', bytes: () => { dosyaCagri++; return dosya } }],
    yaz: (b) => parcalar.push(b4a.from(b))
  })
  t.is(r.boy, parcalar.reduce((a, b) => a + b.byteLength, 0))
  t.ok(parcalar.every((b) => b.byteLength <= 65536 + 17 + 4096 + 24 + 10), 'hiçbir parça bir kap parçasından büyük değil')
  t.is(dosyaCagri, 1, 'dosya bir kez okunur; ölçüm ve yazım aynı baytlardan (inceleme 15)')
  const a = await AR.iceAlAsync(b4a.concat(parcalar), PAROLA)
  t.alike(a.icerik, { bicim: 'yuva-defter-arsiv', bicimSurum: 1, ...icerik })
  t.ok(b4a.equals(a.dosyalar[0].bytes, dosya))
  t.is(await hataOfA(() => AR.disaAktarAkis({ parola: PAROLA, urun: 'u', bicim: 'yuva-defter-arsiv', kdf: HIZLI, icerikParcalari: function * () {}, dosyalar: [{ ad: '../x', bytes: () => dosya }], yaz: () => {} })), 'INVALID_ZIP_NAME')
})
