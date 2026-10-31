#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// build/notification-check.js — Kurulum USB'si derlemesinde imzalı sürüm bildiriminin ve dosyaların denetimi (RFC-0007
// §8.1, §12.1). Derleme makinesinde depo kopyasından çalışır (node/release.js: bildirimCoz, paketOzeti). İmza üretmez,
// anahtar üretmez ya da gömmez: kök anahtarın açık yarısı dışarıdan verilen kök durumundadır.
//
//   node notification-check.js --bildirim F --kok-durum F [--kok-zinciri F] --paket F --deb-dizini D --surum X.Y.Z
//                            --cikti D [--arch amd64]
//
// Denetimler: §12.1 madde 1–4 (biçim, kök dönemi, imza, taahhüt); ürün havenfold-node ve sürüm beklenen; paket satırı
// (linux, arch) adı, boyutu ve özeti; deb dizinindeki her dosya installerDebs listesinde (ad ve özet) ve listedeki her
// girdinin dosyası var. Kök döndürme zinciri verilirse önce uygulanır (§12.2).
// Çıktı dizinine: paket.json (sürüm, versionCode, paket adı ve özeti, bildirim özeti), ozetler (b2sum biçiminde,
// kurulumda yeniden denetlenir), kok.durum (zincir uygulanmış kök durumu), node (paketteki çalışma zamanı, 0755).
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const b4a = require('b4a')
const c = require('compact-encoding')
const S = require('../../node/release')
const { zipOku } = require('../../core/export/zip')

function fail (code, ayrinti = '') { throw new Error(code + (ayrinti ? ': ' + ayrinti : '')) }
const hex = (b) => b4a.toString(b, 'hex')

function argumanlar (dizi) {
  const a = {}
  for (let i = 0; i < dizi.length; i += 2) {
    if (!dizi[i].startsWith('--') || i + 1 >= dizi.length) fail('INVALID_ARGUMENT', dizi[i])
    a[dizi[i].slice(2)] = dizi[i + 1]
  }
  for (const x of ['bildirim', 'kok-durum', 'paket', 'deb-dizini', 'surum', 'cikti']) if (!a[x]) fail('MISSING_ARGUMENT', x)
  return a
}

// u32be uzunluk önekli ROOT_ROTATION kayıtları (kok-zinciri.bin; privilege-helper.js kokDondur ile aynı biçim)
function zincirKayitlari (bytes) {
  const out = []
  for (let i = 0; i < bytes.byteLength;) {
    if (i + 4 > bytes.byteLength) fail('FORMAT_ERROR', 'kök zinciri')
    const n = bytes.readUInt32BE(i)
    if (n < 65 || i + 4 + n > bytes.byteLength) fail('FORMAT_ERROR', 'kök zinciri')
    out.push(bytes.subarray(i + 4, i + 4 + n))
    i += 4 + n
  }
  return out
}

function denetle (a) {
  const arch = a.arch || 'amd64'
  let kok = c.decode(S.kokDurumuEnc, fs.readFileSync(a['kok-durum']))
  if (a['kok-zinciri']) kok = S.zinciriUygula(kok, zincirKayitlari(fs.readFileSync(a['kok-zinciri'])))
  const bildirim = fs.readFileSync(a.bildirim)
  const { m, ozet } = S.bildirimCoz(bildirim, kok)
  if (m.product !== 'havenfold-node') fail('MANIFEST_ERROR', 'ürün ' + m.product)
  if (m.version !== a.surum) fail('MANIFEST_ERROR', `sürüm ${m.version}, beklenen ${a.surum}`)
  const satir = m.packages.find((p) => p.os === 'linux' && p.arch === arch)
  if (!satir) fail('MANIFEST_ERROR', `linux/${arch} paketi yok`)
  if (path.basename(a.paket) !== satir.name) fail('MANIFEST_ERROR', `paket adı ${path.basename(a.paket)}, bildirimde ${satir.name}`)
  const paket = fs.readFileSync(a.paket)
  S.dosyaDenetle(satir, { ozet: S.paketOzeti(paket), boyut: paket.byteLength })
  const ozetler = [`${hex(satir.digest)}  ${satir.name}`]
  const debler = fs.readdirSync(a['deb-dizini']).filter((x) => x.endsWith('.deb')).sort()
  const liste = new Map(m.installerDebs.map((d) => [d.name, d]))
  for (const d of debler) {
    const g = liste.get(d)
    if (!g) fail('DIGEST_MISMATCH', 'bildirimde olmayan paket: ' + d)
    if (!b4a.equals(S.paketOzeti(fs.readFileSync(path.join(a['deb-dizini'], d))), g.digest)) fail('DIGEST_MISMATCH', d)
    ozetler.push(`${hex(g.digest)}  deb/${d}`)
  }
  for (const ad of liste.keys()) if (!debler.includes(ad)) fail('DIGEST_MISMATCH', 'dosyası olmayan paket: ' + ad)
  // Paketteki Node çalışma zamanı: kurulum ortamında ön kontrol ve hedefe yerleştirme bununla çalışır
  const girdiler = zipOku(paket, { inflate: (b) => zlib.inflateRawSync(b) })
  const node = girdiler.find((g) => g.ad === 'node')
  if (!node) fail('PACKAGE_ERROR', 'Node çalışma zamanı yok')
  fs.mkdirSync(a.cikti, { recursive: true })
  fs.writeFileSync(path.join(a.cikti, 'node'), node.bytes, { mode: 0o755 })
  fs.writeFileSync(path.join(a.cikti, 'kok.durum'), c.encode(S.kokDurumuEnc, kok), { mode: 0o644 })
  fs.writeFileSync(path.join(a.cikti, 'ozetler'), ozetler.join('\n') + '\n', { mode: 0o644 })
  const bilgi = { surum: m.version, versionCode: m.versionCode, kanal: m.channel, paketAdi: satir.name, paketOzeti: hex(satir.digest), bildirimOzeti: hex(ozet), keyEpoch: kok.keyEpoch, kokParmakIzi: hex(S.rootHash(kok.rootPub)) }
  fs.writeFileSync(path.join(a.cikti, 'paket.json'), JSON.stringify(bilgi, null, 1) + '\n', { mode: 0o644 })
  return bilgi
}

module.exports = { denetle, zincirKayitlari }

if (require.main === module) {
  try {
    const b = denetle(argumanlar(process.argv.slice(2)))
    console.log(`Bildirim doğrulandı: havenfold-node ${b.surum} (${b.kanal}), kök dönemi ${b.keyEpoch}, kök parmak izi ${b.kokParmakIzi.slice(0, 16)}…`)
  } catch (err) {
    console.error('bildirim-denetle: ' + err.message)
    process.exitCode = 5
  }
}
