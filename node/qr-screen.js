// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// qr-screen.js — QR'ı Linux çerçeve arabelleğine (/dev/fb0) piksel olarak çizer. Metin konsolunun yazı tipi
// (console-setup Uni2) yarım blok karakterlerini (▀ ▄) taşımıyor: silme ortamının sanal makine denemesinde QR elmas
// işaretleriyle çizildi ve okunamadı. Kullananlar: silme ortamı (installer/erase/shell.js, rapor QR'ları) ve
// `havenfold katil` (tören QR'ı, tty1; bin/havenfold). SSH'ta ve terminal emülatöründe yarım blok çizimi kalır.
//
// Saf kısım (sysfs ayrıştırma, yerleşim, satır baytları, konsol kararı) test edilir; aygıt yalnız cerceveAc'ta açılır.
// Yalnız Node. Silme kökü bu dosyayı node/qr.js'in yanına kopyalar (installer/build/erase-root-build.sh).
'use strict'
const fs = require('fs')
const path = require('path')
const { qrKodla } = require('./qr')

const SYS = '/sys/class/graphics/fb0'
const AYGIT = '/dev/fb0'
const BOS = 4 // sessiz bölge (modül)
const ALT_SATIR = 8 // tören QR'ının altında metne bırakılan konsol satırı

// sysfs değerleri → { w, h, bpp, stride, taban } ya da null (biçim bilinmiyor). oku(ad): /sys/class/graphics/fb0/<ad>.
// Görünen alan virtual_size ile ilk kipin küçüğü; pan (x,y) varsa görünen alanın başı oraya kayar (taban, bayt).
function cerceveBicimi (oku) {
  const al = (ad) => { try { return String(oku(ad)).trim() } catch { return '' } }
  const bpp = Number(al('bits_per_pixel'))
  const stride = Number(al('stride'))
  let [w, h] = al('virtual_size').split(',').map(Number)
  const kip = /([0-9]+)x([0-9]+)/.exec(al('modes').split('\n')[0])
  if (kip) { w = Math.min(w, Number(kip[1])); h = Math.min(h, Number(kip[2])) }
  if (![16, 32].includes(bpp) || !(w > 0 && h > 0) || !(stride >= w * bpp / 8)) return null
  const [px, py] = (al('pan') || '0,0').split(',').map(Number)
  const taban = (py > 0 ? py * stride : 0) + (px > 0 ? px * bpp / 8 : 0)
  return { w, h, bpp, stride, taban: Number.isSafeInteger(taban) ? taban : 0 }
}

// n: QR kenarı (modül); ust/alt: üstte ve altta metne bırakılan piksel. Modül tam sayı piksel, en az 1.
function yerlesim (fb, n, ust = 0, alt = 0) {
  const tum = n + 2 * BOS
  const modul = Math.max(1, Math.floor(Math.min(fb.w, fb.h - ust - alt) / tum))
  return { modul, kenar: tum * modul }
}

// Modül satırı y'nin (-BOS ≤ y < n + BOS) bir piksel satırı: koyu modül 0x00 (siyah), açık modül ve kenar 0xff (beyaz);
// 16 ve 32 bpp'de aynı (RGB565 0xffff, XRGB 0xffffffff beyaz).
function modulSatiri (q, y, modul, px) {
  const n = q.moduller.length
  const satir = Buffer.alloc((n + 2 * BOS) * modul * px)
  for (let x = -BOS; x < n + BOS; x++) {
    const koyu = x >= 0 && y >= 0 && x < n && y < n && !!q.moduller[y][x]
    satir.fill(koyu ? 0x00 : 0xff, (x + BOS) * modul * px, (x + BOS + 1) * modul * px)
  }
  return satir
}

// fb: { w, h, bpp, stride, taban?, yaz(ofset, buf) }; q: qrKodla çıktısı. QR sol üste, üstten ust piksel aşağı çizilir.
function cerceveyeCiz (fb, q, ust = 0, alt = 0) {
  const n = q.moduller.length
  const { modul, kenar } = yerlesim(fb, n, ust, alt)
  const px = fb.bpp / 8
  for (let y = -BOS; y < n + BOS; y++) {
    const satir = modulSatiri(q, y, modul, px)
    for (let k = 0; k < modul; k++) fb.yaz((fb.taban || 0) + (ust + (y + BOS) * modul + k) * fb.stride, satir)
  }
  return { modul, kenar }
}

// fb0'ı açar; yoksa ya da biçimi bilinmiyorsa null (çağıran metin çizimine düşer)
function cerceveAc (sys = SYS, aygit = AYGIT) {
  try {
    const b = cerceveBicimi((ad) => fs.readFileSync(path.join(sys, ad), 'utf8'))
    if (!b) return null
    const fd = fs.openSync(aygit, 'r+')
    return { ...b, yaz: (ofset, buf) => fs.writeSync(fd, buf, 0, buf.byteLength, ofset), kapat: () => fs.closeSync(fd) }
  } catch { return null }
}

// Linux konsolu mu (saf): çıktı TTY, SSH oturumu değil, fb0 yazılabilir; çıktı /dev/ttyN ise o VT etkin olmalı
// (başka konsolun üstüne çizilmez), değilse TERM=linux ve sözde terminal (/dev/pts) değil.
function konsolMu ({ env = {}, tty = false, cikis = '', aktif = '', fbYazilabilir = false } = {}) {
  if (!tty || !fbYazilabilir) return false
  if (env.SSH_CONNECTION || env.SSH_TTY) return false
  const vt = /^\/dev\/(tty[0-9]+)$/.exec(cikis)
  if (vt) return vt[1] === 'tty0' || !aktif || aktif === vt[1]
  return env.TERM === 'linux' && !cikis.startsWith('/dev/pts/')
}

// Gerçek değerlerle konsolMu: çıktının yolu /proc/self/fd/<fd>'den, etkin VT /sys/class/tty/tty0/active'den
function konsoldaMi ({ cikis = process.stdout, env = process.env, platform = process.platform, aygit = AYGIT, bagOku = fs.readlinkSync, oku = (p) => fs.readFileSync(p, 'utf8'), yazilabilir = (p) => { fs.accessSync(p, fs.constants.W_OK) } } = {}) {
  if (platform !== 'linux') return false
  const dene = (f) => { try { return f() } catch { return null } }
  return konsolMu({
    env,
    tty: !!cikis.isTTY,
    cikis: dene(() => bagOku('/proc/self/fd/' + (cikis.fd ?? 1))) || '',
    aktif: (dene(() => oku('/sys/class/tty/tty0/active')) || '').trim(),
    fbYazilabilir: dene(() => { yazilabilir(aygit); return true }) === true
  })
}

// Tören QR'ı çizicisi: konsolda değilse null. Konsoldaysa (metin) → her çağrıda fb0'ı açar, ekranı siler, QR'ı sol üste
// çizer (altta ALT_SATIR satır metne kalır) ve imleci QR'ın son satırına koyan denetim dizisini döner; çağıran bunu
// satır sonuyla yazınca metin QR'ın altından sürer. Çizilemezse null (çağıran yarım bloğa düşer).
function konsolCizici ({ konsol = konsoldaMi, ac = cerceveAc, satirlar = () => process.stdout.rows, sil = (s) => process.stdout.write(s) } = {}) {
  if (!konsol()) return null
  return (metin) => {
    const q = qrKodla(metin)
    const fb = ac()
    if (!fb) return null
    try {
      const satirPx = satirlar() > 0 ? fb.h / satirlar() : 16
      sil('\x1b[2J\x1b[H')
      const { kenar } = cerceveyeCiz(fb, q, 0, Math.ceil(ALT_SATIR * satirPx))
      return '\x1b[' + Math.max(1, Math.ceil(kenar / satirPx)) + ';1H'
    } catch { return null } finally { try { fb.kapat() } catch {} }
  }
}

module.exports = { SYS, AYGIT, BOS, ALT_SATIR, cerceveBicimi, yerlesim, modulSatiri, cerceveyeCiz, cerceveAc, konsolMu, konsoldaMi, konsolCizici }
