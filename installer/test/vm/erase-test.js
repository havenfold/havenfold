#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// erase-test.js — YALNIZ CI: silme modunun sanal makine denemesi için yardımcılar (RFC-0007 §13.2–13.5).
//
//   bilet <bilet.bin> <bilet.json>          rastgele hostId, bir kimlik, retireNonce ile HFRT1 bileti (test değeri)
//   ornek-kaydet <ornek.json> <img> …       her diskten rastgele konumlarda 4 KiB blokların SHA-256'sı (silmeden önce)
//   ornek-denetle <ornek.json>              aynı konumlar silmeden sonra: hiçbir blok eskisiyle aynı olmamalı
//   dogrula <qr-sil.json> <bilet.json>      ekrandan okunan HFK1 + HFW1 → core verifyWipe; deviceId biletteki kimlik
//
// Çıkış 0 tamam, 1 denetim tutmadı.
const fs = require('fs')
const crypto = require('crypto')
const B = require('../../erase/ticket')
const E = require('../../../core/core/protocol/retirement')

const BLOK = 4096
const ORNEK = 256
const hex = (b) => Buffer.from(b).toString('hex')

function bilet (binYol, jsonYol) {
  const m = { hostId: crypto.randomBytes(16), ids: [crypto.randomBytes(16)], retireNonce: crypto.randomBytes(16) }
  fs.writeFileSync(binYol, B.biletYaz(m))
  fs.writeFileSync(jsonYol, JSON.stringify({ hostId: hex(m.hostId), ids: m.ids.map(hex), retireNonce: hex(m.retireNonce) }) + '\n')
  console.log('bilet yazıldı: kimlik ' + hex(m.ids[0]))
  return 0
}

function blokOzeti (fd, ofset) {
  const b = Buffer.alloc(BLOK)
  fs.readSync(fd, b, 0, BLOK, ofset)
  return { ozet: crypto.createHash('sha256').update(b).digest('hex'), sifir: b.every((x) => x === 0) }
}

function ornekKaydet (jsonYol, imajlar) {
  const out = {}
  for (const img of imajlar) {
    const boyut = fs.statSync(img).size
    const fd = fs.openSync(img, 'r')
    const konumlar = new Set([0, BLOK, boyut - BLOK])
    while (konumlar.size < ORNEK) konumlar.add(crypto.randomInt(0, boyut / BLOK) * BLOK)
    out[img] = [...konumlar].sort((a, b) => a - b).map((o) => ({ o, ...blokOzeti(fd, o) }))
    fs.closeSync(fd)
    console.log(`${img}: ${ORNEK} örnek blok, sıfır blok ${out[img].filter((x) => x.sifir).length}`)
  }
  fs.writeFileSync(jsonYol, JSON.stringify(out))
  return 0
}

function ornekDenetle (jsonYol) {
  const kayit = JSON.parse(fs.readFileSync(jsonYol, 'utf8'))
  let kod = 0
  for (const [img, liste] of Object.entries(kayit)) {
    const fd = fs.openSync(img, 'r')
    let ayni = 0
    let sifir = 0
    for (const x of liste) {
      const y = blokOzeti(fd, x.o)
      if (y.ozet === x.ozet) ayni++
      if (y.sifir) sifir++
    }
    fs.closeSync(fd)
    const tamam = ayni === 0
    if (!tamam) kod = 1
    console.log(`HF-SIL ornek ${img}: ${tamam ? 'TAMAM' : 'HATA'} | ${liste.length} bloktan ${ayni} tanesi silmeden önceki gibi, ${sifir} tanesi sıfır`)
  }
  return kod
}

function dogrula (qrYol, biletYol) {
  const qr = JSON.parse(fs.readFileSync(qrYol, 'utf8'))
  const b = JSON.parse(fs.readFileSync(biletYol, 'utf8'))
  if (!qr.hfk1) { console.log('HF-SIL dogrula: HATA | anahtar QR\'ı (HFK1) ekrandan okunamadı'); return 1 }
  if (!qr.hfw1.length) { console.log('HF-SIL dogrula: HATA | rapor QR\'ı (HFW1) okunamadı'); return 1 }
  let r
  try { r = E.verifyWipe(qr.hfk1, qr.hfw1) } catch (err) { console.log('HF-SIL dogrula: HATA | verifyWipe: ' + err.message); return 1 }
  let kod = 0
  const kimlik = hex(r.key.ids[0] || Buffer.alloc(16))
  console.log(`HF-SIL anahtar-qr: kimlik ${kimlik}, disk ${r.key.disks}, araç sürümü ${r.key.toolVersion}`)
  if (kimlik !== b.ids[0] || hex(r.key.hostId) !== b.hostId || hex(r.key.retireNonce) !== b.retireNonce) { console.log('HF-SIL bilet: HATA | QR\'daki kimlik ESP\'deki biletle aynı değil'); kod = 1 } else console.log('HF-SIL bilet: TAMAM | ESP\'deki bilet okundu, kimlik raporda')
  for (const x of r.reports) {
    console.log(`HF-SIL rapor ${x.diskModel} ${x.diskSerial}: method=${x.method} result=${x.result} | ${x.driveStatus} (${Math.round((x.finishedAt - x.startedAt) / 1000)} sn, cihaz ${x.model} ${x.serial})`)
    if (x.result === 'hata') kod = 1
  }
  console.log(`HF-SIL dogrula: ${kod === 0 ? 'TAMAM' : 'HATA'} | verifyWipe geçti, ${r.reports.length} rapor, wipeReportHash ${hex(r.wipeReportHash).slice(0, 16)}…`)
  return kod
}

const [komut, ...a] = process.argv.slice(2)
const islem = { bilet: () => bilet(a[0], a[1]), 'ornek-kaydet': () => ornekKaydet(a[0], a.slice(1)), 'ornek-denetle': () => ornekDenetle(a[0]), dogrula: () => dogrula(a[0], a[1]) }[komut]
if (!islem) { console.error('kullanım: bilet | ornek-kaydet | ornek-denetle | dogrula'); process.exitCode = 1 } else process.exitCode = islem()
