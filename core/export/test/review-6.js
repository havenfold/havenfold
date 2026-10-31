// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D9: inceleme 6 bulguları (kap, RFC-0021 e–h) ve inceleme 1'in açık kalan kap maddeleri. Beklenenler elle.
const test = require('brittle')
const b4a = require('b4a')
const K = require('../export')
const { zipYaz, zipOku, adGecerli } = require('../zip')
const { kayitDisa, iceAlAsync, disaAktarAsync, arsivYaz } = require('../archive')
const F = require('../../../protocol/vectors/export-v2.json')
const F1 = require('../../../protocol/vectors/export.json')

const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const buf = (h) => b4a.from(h, 'hex')
const MIB = 1024 * 1024
const HIZLI = { urun: 'u', bicim: 'b', opslimit: 3, memlimit: 64 * MIB }
const PAROLA = 'uzun-bir-parola-123'

test('Y1, Y3 ve RFC-0021 f: vektörler — kanonik ZIP, harf katlaması, güvenli adlar; NFC parola', (t) => {
  for (const d of F.zip) t.is(hataOf(() => zipOku(buf(d.zip))), d.hata, d.aciklama)
  for (const a of F.adlar) t.is(adGecerli(a.ad), a.gecerli, a.ad)
  t.is(b4a.toString(K.ac(buf(F.nfc.kap), b4a.toString(buf(F.nfc.parolaNfdHex))).icerik), 'nfc')
})

test('Y1: bir veri bloğunu 512 girdi gösteren ZIP açılmaz', (t) => {
  const z = b4a.from(zipYaz(Array.from({ length: 4 }, (_, i) => ({ ad: 'g' + i, bytes: b4a.alloc(100, i) }))))
  const dv = new DataView(z.buffer, z.byteOffset)
  let cd = z.indexOf(b4a.from([0x50, 0x4b, 0x01, 0x02]))
  cd = z.indexOf(b4a.from([0x50, 0x4b, 0x01, 0x02]), cd + 1)
  dv.setUint32(cd + 42, 0, true) // ikinci girdi ilkini gösterir
  t.is(hataOf(() => zipOku(z)), 'INVALID_ZIP')
})

test('Y5 (RFC-0021 g): _subj ve metindeki kimlikler; çevrilemeyen [bilinmeyen]', (t) => {
  const r = kayitDisa({
    _subj: 'kayit:' + 'ab'.repeat(16),
    not: 'uye:' + 'cd'.repeat(16) + ' ile konuşuldu, bkz. kayit:' + 'ef'.repeat(16),
    kim: 'uye:' + '12'.repeat(16)
  }, { kisiAdi: (tur, id) => (id === 'cd'.repeat(16) ? 'Alex' : null) })
  t.is(r.alanlar._subj, '[kaynak]')
  t.is(r.alanlar.not, 'Alex ile konuşuldu, bkz. [kaynak]')
  t.is(r.alanlar.kim, '[bilinmeyen]')
  t.absent(JSON.stringify(r).match(/[0-9a-f]{32}/))
})

test('Y6, Y7 (RFC-0021 h): telefonda opslimit ≤ 8 ve memlimit ≤ 512 MiB; telefon yolu varsayılan', async (t) => {
  const agir = K.kapla(b4a.from('x'), PAROLA, { ...HIZLI, opslimit: 9 })
  await t.exception(() => K.acAsync(agir, PAROLA), /EXPORT_MEMORY/)
  t.is(b4a.toString((await K.acAsync(agir, PAROLA, { telefon: false })).icerik), 'x')
  t.is(hataOf(() => K.telefonSiniri({ opslimit: 8, memlimit: 600 * MIB })), 'EXPORT_MEMORY')
  const kap = await disaAktarAsync({ parola: PAROLA, urun: 'u', bicim: 'b', icerik: { kayitlar: [] }, kdf: { opslimit: 3, memlimit: 64 * MIB } })
  const r = await iceAlAsync(kap, PAROLA)
  t.alike(r.icerik.kayitlar, [])
  const agirArsiv = K.kapla(arsivYaz({ bicim: 'b', icerik: {} }), PAROLA, { ...HIZLI, opslimit: 9 })
  await t.exception(() => iceAlAsync(agirArsiv, PAROLA), /EXPORT_MEMORY/)
})

test('inceleme 1 kap 4: akışla okuyucu parça parça açar', (t) => {
  const veri = b4a.alloc(150_000, 9)
  const kap = K.kapla(veri, PAROLA, HIZLI)
  const bas = kap.subarray(0, 10 + 4096 + K.HEADERBYTES)
  const { okuyucu, kalan } = K.kapOkuyucu(bas, PAROLA)
  const out = [...okuyucu.besle(kalan)]
  for (let i = bas.byteLength; i < kap.byteLength; i += 7000) out.push(...okuyucu.besle(kap.subarray(i, i + 7000)))
  out.push(...okuyucu.bitir())
  t.alike(b4a.concat(out), veri)
  // Parça sınırında kesilmiş akış: TAG_FINAL gelmedi
  const yarim = K.kapOkuyucu(bas, PAROLA)
  yarim.okuyucu.besle(b4a.concat([yarim.kalan, kap.subarray(bas.byteLength, bas.byteLength - yarim.kalan.byteLength + K.CHUNK + K.ABYTES)]))
  t.is(hataOf(() => yarim.okuyucu.bitir()), 'EXPORT_TRUNCATED')
})

// Başlığı yeniden yazar (uzunluk dahil); gövde aynı
function baslikDegistir (kap, f) {
  const { baslik, govde } = K.baslikOku(kap)
  const hb = b4a.from(JSON.stringify(f({ ...baslik })))
  const uz = b4a.alloc(4)
  new DataView(uz.buffer, uz.byteOffset).setUint32(0, hb.byteLength)
  return b4a.concat([K.SIHIR, b4a.from([K.SURUM]), uz, hb, govde])
}

test('inceleme 1 kap 12: olumsuz vakalar', (t) => {
  const tam = buf(F1.tam.kap)
  const P = K.CHUNK + K.ABYTES
  const kucuk = buf(F1.v1.kap)
  t.is(hataOf(() => K.ac(baslikDegistir(kucuk, (h) => ({ ...h, memlimit: 32 * MIB })), F1.parola)), 'EXPORT_PARAMETER', 'memlimit 32 MiB')
  t.is(hataOf(() => K.ac(baslikDegistir(kucuk, (h) => ({ ...h, cipher: 'aes-gcm' })), F1.parola)), 'EXPORT_PARAMETER', 'başka cipher')
  const s2 = b4a.from(kucuk); s2[5] = 2
  t.is(hataOf(() => K.ac(s2, F1.parola)), 'EXPORT_VERSION', 'sürüm 2')
  t.is(hataOf(() => K.ac(baslikDegistir(kucuk, (h) => ({ ...h, dolgu: 'x'.repeat(4100) })), F1.parola)), 'INVALID_EXPORT', 'başlık > 4096')
  t.is(hataOf(() => K.ac(baslikDegistir(kucuk, (h) => ({ ...h, opslimit: 4 })), F1.parola)), 'EXPORT_UNVERIFIED', 'sınır içi opslimit değişikliği')
  const on = K.baslikOku(tam).on.byteLength + K.HEADERBYTES
  const ara = b4a.from(tam); ara[on + P + 10] ^= 1
  t.is(hataOf(() => K.ac(ara, F1.parola)), 'EXPORT_CORRUPT', 'ara parça bozuk')
  t.is(hataOf(() => K.ac(b4a.concat([tam.subarray(0, on), tam.subarray(on + P)]), F1.parola)), 'EXPORT_UNVERIFIED', 'ilk parça silinmiş')
  t.is(hataOf(() => K.ac(b4a.concat([tam.subarray(0, on), tam.subarray(on + P, on + 2 * P), tam.subarray(on, on + P)]), F1.parola)), 'EXPORT_UNVERIFIED', 'sıra değişmiş')
})
