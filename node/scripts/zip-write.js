#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// zip-write.js — paket dizininden düğüm paketinin kanonik ZIP'i (RFC-0007 §12.1, RFC-0033 §9 g)
//
// Yazıcı çekirdeğin akışlı ZIP yazıcısıdır (core/export/zip.js zipAkis); okuyucusu (zipOku) yetki yardımcısının
// paket-ac'ında ve kurulumda (installer/lib/package.js) aynıdır. Biçim oradan gelir: sıkıştırmasız (stored), sabit
// tarih (1980-01-01), UTF-8 ad bayrağı, dış öznitelik ve izin bitleri yok, ZIP64 yok, yorum yok, girdiler örtüşmesiz.
// Bu dosyanın eklediği kurallar:
//   - Girdiler adın UTF-8 baytlarına göre sıralı (aynı dizinden her zaman aynı arşiv, bayt bayt).
//   - Yalnız düzenli dosyalar. Sembolik bağ, FIFO, aygıt ZIP_SYMLINK / ZIP_NOT_REGULAR ile reddedilir; boş dizin taşınmaz.
//   - İzinler arşive girmez: açan taraf bin/ altını ve kökteki çalışma zamanlarını (node, bare) 0755, kalanı 0644
//     açar. Dizinde çalıştırılabilir olup açılınca 0644 olacak dosyalar sonuçta 'izinKaybi' olarak döner.
//   - Paketin özeti yazarken akışla hesaplanır: hash('hf/release-pkg/', arşiv baytları) (node/release.js dosyaOzeti).
//
//   node zip-write.js <dizin> <cikti.zip>
const fs = require('fs')
const path = require('path')
const b4a = require('b4a')
const { zip: { zipAkis, crcAkis, adGecerli, adAnahtari } } = require('@havenfold/export')
const S = require('../release')

function fail (code, ayrinti = '') { throw new Error(code + (ayrinti ? ': ' + ayrinti : '')) }
const hex = (b) => b4a.toString(b, 'hex')
const PARCA = 1 << 20
const CALISTIRILABILIR = new Set(['node', 'bare']) // privilege-helper.js ve installer/lib/package.js ile aynı kural
const acilinca755 = (ad) => ad.startsWith('bin/') || CALISTIRILABILIR.has(ad)

// Dizindeki düzenli dosyalar: [{ ad, yol, boy, kip }], ada göre (UTF-8 bayt sırası) sıralı
function dosyaListesi (kok) {
  const out = []
  const gez = (goreli) => {
    const tam = path.join(kok, goreli)
    for (const ad of fs.readdirSync(tam)) {
      const g = goreli ? goreli + '/' + ad : ad
      const st = fs.lstatSync(path.join(kok, g))
      if (st.isSymbolicLink()) fail('ZIP_SYMLINK', g)
      if (st.isDirectory()) { gez(g); continue }
      if (!st.isFile()) fail('ZIP_NOT_REGULAR', g)
      if (!adGecerli(g)) fail('INVALID_ZIP_NAME', g)
      out.push({ ad: g, yol: path.join(kok, g), boy: st.size, kip: st.mode & 0o777 })
    }
  }
  gez('')
  out.sort((a, b) => b4a.compare(b4a.from(a.ad), b4a.from(b.ad)))
  const goruldu = new Set()
  for (const f of out) { // büyük/küçük harf ve NFC katlamasıyla çakışma (okuyucu reddeder)
    const k = adAnahtari(f.ad)
    if (goruldu.has(k)) fail('INVALID_ZIP_NAME', f.ad)
    goruldu.add(k)
  }
  return out
}

function * parcalar (yol, boy) {
  const fd = fs.openSync(yol, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  try {
    const tampon = b4a.alloc(PARCA)
    let n = 0
    while (n < boy) {
      const r = fs.readSync(fd, tampon, 0, Math.min(PARCA, boy - n), n)
      if (r === 0) fail('ZIP_CHANGED', yol) // ölçümden sonra kısaldı
      n += r
      yield b4a.from(tampon.subarray(0, r))
    }
  } finally { fs.closeSync(fd) }
}

// Dizin → kanonik ZIP. Dönüş: { girdi, boyut, ozet (Buffer, hf/release-pkg/), izinKaybi: [ad] }
function zipYazDizin (kok, cikti) {
  const liste = dosyaListesi(kok)
  // Ölçüm geçişi: her girdinin CRC'si (yazıcı yerel başlığı veriden önce yazar)
  for (const f of liste) {
    const c = crcAkis()
    for (const p of parcalar(f.yol, f.boy)) c.ekle(p)
    f.crc = c.sonuc()
  }
  const oz = S.dosyaOzeti()
  let boyut = 0
  const gecici = cikti + '.yeni'
  const fd = fs.openSync(gecici, 'w', 0o644)
  try {
    const z = zipAkis((b) => {
      oz.guncelle(b)
      let n = 0
      while (n < b.byteLength) n += fs.writeSync(fd, b, n, b.byteLength - n)
      boyut += b.byteLength
    })
    // Yazım geçişinde boy ve CRC yeniden hesaplanır; ölçümle farklı veri gelirse INVALID_ZIP (dosya değişti)
    for (const f of liste) z.girdi(f.ad, { boy: f.boy, crc: f.crc, parcalar: parcalar(f.yol, f.boy) })
    z.bitir()
    fs.fsyncSync(fd)
  } catch (err) {
    fs.closeSync(fd)
    fs.rmSync(gecici, { force: true })
    throw err
  }
  fs.closeSync(fd)
  fs.renameSync(gecici, cikti)
  const izinKaybi = liste.filter((f) => (f.kip & 0o111) && !acilinca755(f.ad)).map((f) => f.ad)
  return { girdi: liste.length, boyut, ozet: oz.bitir(), izinKaybi }
}

module.exports = { dosyaListesi, zipYazDizin, acilinca755 }

if (require.main === module) {
  const [dizin, cikti] = process.argv.slice(2)
  if (!dizin || !cikti) {
    console.error('kullanım: zip-write.js <dizin> <cikti.zip>')
    process.exit(1)
  }
  try {
    const r = zipYazDizin(dizin, cikti)
    console.log(`${cikti}: ${r.girdi} dosya, ${r.boyut} bayt, özet ${hex(r.ozet)}`)
  } catch (err) {
    console.error('zip-yaz: ' + err.message)
    process.exit(1)
  }
}
