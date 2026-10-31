// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// erase/shell.js — silme oturumunun gerçek sistem kancası (RFC-0007 §13.2): komut çalıştırma, aygıt okuma ve yazma,
// ekran ve klavye. Bütün karar mantığı session.js ve saf modüllerdedir; bu dosya yalnız ince kabuktur.
//
// GÜVENLİK: Yalnız silme ortamında çalışır. Üç koşulun üçü de tutmalı: Linux, çekirdek satırında `havenfold.silme=1`
// ve silme kök dosya sisteminin işareti /etc/havenfold-silme. Başka bir makinede (geliştirme bilgisayarı, düğümün
// kendisi) `ortamDenetle` hata verir ve hiçbir komut çalışmaz.
//
// Çalışma zamanı: bu sürümde paketle gelen Node (child_process, fs). RFC-0007 §13.2 Bare + sodium-native diyor; Bare
// uyarlaması bare-subprocess ve bare-fs ile yapılacak (installer/BENIOKU.md "Açık işler").
const fs = require('fs')
const path = require('path')
const b4a = require('b4a')
const sodium = require('sodium-native')
const { qrKodla, terminaleCiz } = require('../../node/qr')
const { cerceveAc, cerceveyeCiz } = require('../../node/qr-screen')

const ISARET = '/etc/havenfold-silme'
const ESP_BAGLAMA = '/run/havenfold-sil/esp'
const BILET_YOLU = 'EFI/havenfold/emekli.bilet'
const DONUS_MS = 1500

function fail (code) { throw new Error(code) }

function ortamDenetle ({ platform = process.platform, oku = (p) => fs.readFileSync(p, 'utf8'), var_ = (p) => fs.existsSync(p) } = {}) {
  if (platform !== 'linux') fail('NOT_ERASE_ENVIRONMENT')
  let satir = ''
  try { satir = oku('/proc/cmdline') } catch {}
  if (!satir.split(/\s+/).includes('havenfold.silme=1')) fail('NOT_ERASE_ENVIRONMENT')
  if (!var_(ISARET)) fail('NOT_ERASE_ENVIRONMENT')
}

function calistir (argv) {
  const { spawn } = require('child_' + 'process')
  return new Promise((resolve) => {
    const p = spawn(argv[0], argv.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] })
    const out = []
    const err = []
    p.stdout.on('data', (d) => out.push(d))
    p.stderr.on('data', (d) => err.push(d))
    p.on('error', (e) => resolve({ status: -1, stdout: b4a.alloc(0), stderr: b4a.from(String(e.message)) }))
    p.on('close', (status) => resolve({ status, stdout: b4a.concat(out), stderr: b4a.concat(err) }))
  })
}

function dosyaOku (yol) {
  try { return Promise.resolve(fs.readFileSync(yol)) } catch { return Promise.resolve(null) }
}

async function espOku (bolum) {
  fs.mkdirSync(ESP_BAGLAMA, { recursive: true, mode: 0o700 })
  const m = await calistir(['mount', '-t', 'vfat', '-o', 'ro,nosuid,nodev,noexec', bolum, ESP_BAGLAMA])
  if (m.status !== 0) return null
  try {
    const p = path.join(ESP_BAGLAMA, BILET_YOLU)
    const st = fs.statSync(p)
    return st.isFile() && st.size <= 512 ? fs.readFileSync(p) : null
  } catch { return null } finally { await calistir(['umount', ESP_BAGLAMA]) }
}

async function boyut (yol) {
  const r = await calistir(['blockdev', '--getsize64', yol])
  const n = Number(b4a.toString(r.stdout).trim())
  if (r.status !== 0 || !Number.isSafeInteger(n)) fail('SIZE_UNREADABLE')
  return n
}

const tutamaklar = new Map()
function tutamak (yol) {
  if (!tutamaklar.has(yol)) tutamaklar.set(yol, fs.openSync(yol, 'r+'))
  return tutamaklar.get(yol)
}

async function blokOku (yol, ofset, uzunluk) {
  const b = b4a.alloc(uzunluk)
  let n = 0
  while (n < uzunluk) {
    const r = fs.readSync(tutamak(yol), b, n, uzunluk - n, ofset + n)
    if (r === 0) fail('SHORT_READ')
    n += r
  }
  return b
}

async function blokYaz (yol, ofset, buf) {
  let n = 0
  while (n < buf.byteLength) n += fs.writeSync(tutamak(yol), buf, n, buf.byteLength - n, ofset + n)
}

// Sanitize ve üzerine yazmadan sonra okumalar sayfa önbelleğinden gelmesin
async function onbellekBosalt (yol) {
  if (tutamaklar.has(yol)) { fs.fsyncSync(tutamaklar.get(yol)); fs.closeSync(tutamaklar.get(yol)); tutamaklar.delete(yol) }
  await calistir(['blockdev', '--flushbufs', yol])
  try { fs.writeFileSync('/proc/sys/vm/drop_caches', '3') } catch {}
}

function rastgeleBayt (n) { const b = b4a.alloc(n); sodium.randombytes_buf(b); return b }

function yaz (s) { process.stdout.write(s + '\n') }

function satirOku () {
  return new Promise((resolve) => {
    const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout })
    rl.question('> ', (c) => { rl.close(); resolve(c) })
  })
}

async function sor (soru) { yaz(soru); return satirOku() }

// Çerçeve arabelleği (/dev/fb0) çizimi node/qr-screen.js'te (tören QR'ıyla ortak): metin konsolunun yazı tipi yarım blok
// karakterlerini (▀ ▄) taşımıyor. fb0 yoksa ya da biçimi bilinmiyorsa metin çizimine düşülür.
const BASLIK_PX = 64 // QR'ın üstünde başlık satırına bırakılan piksel

// QR'lar dönen sırayla, 1,5 sn'de bir; ok tuşlarıyla elle; Enter ile çıkılır. Çerçeve arabelleğinde piksel, yoksa metin
// konsolunda yarım blok karakter. Konsol yazısı üstüne düşerse diye tek QR da her turda yeniden çizilir.
function qrGoster (metinler, baslik) {
  return new Promise((resolve) => {
    let i = 0
    const fb = cerceveAc()
    const ciz = () => {
      if (fb) {
        process.stdout.write('\x1b[?25l\x1b[2J\x1b[H')
        yaz(`${baslik}  (${i + 1}/${metinler.length})`)
        try { cerceveyeCiz(fb, qrKodla(metinler[i]), BASLIK_PX); return } catch {}
      }
      process.stdout.write('\x1b[2J\x1b[H' + terminaleCiz(qrKodla(metinler[i])) + '\n')
      yaz(`${baslik}  (${i + 1}/${metinler.length})`)
    }
    ciz()
    const zaman = setInterval(() => { i = (i + 1) % metinler.length; ciz() }, DONUS_MS)
    const girdi = process.stdin
    if (girdi.isTTY) girdi.setRawMode(true)
    girdi.resume()
    const dinle = (d) => {
      const k = b4a.toString(d)
      if (k === '\r' || k === '\n') {
        clearInterval(zaman)
        if (fb) { process.stdout.write('\x1b[2J\x1b[H\x1b[?25h'); fb.kapat() }
        girdi.off('data', dinle)
        if (girdi.isTTY) girdi.setRawMode(false)
        girdi.pause()
        resolve()
      } else if (k === '\x1b[C' || k === '\x1b[B') { i = (i + 1) % metinler.length; ciz() } else if (k === '\x1b[D' || k === '\x1b[A') { i = (i - 1 + metinler.length) % metinler.length; ciz() }
    }
    girdi.on('data', dinle)
  })
}

function sistem () {
  ortamDenetle()
  return {
    calistir,
    dosyaOku,
    espOku,
    boyut,
    blokOku,
    blokYaz,
    onbellekBosalt,
    bekle: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    simdi: () => Date.now(),
    rastgeleBayt,
    yaz,
    sor,
    qrGoster
  }
}

module.exports = { ortamDenetle, sistem, ISARET, cerceveAc, cerceveyeCiz }
