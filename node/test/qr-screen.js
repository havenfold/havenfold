// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Çerçeve arabelleği QR çizimi (node/qr-screen.js): sysfs ayrıştırma, yerleşim, sahte fb0 dosyasına yazılan baytlar,
// Linux konsolu algılamasının iki dalı, tören çizicisi
const test = require('brittle')
const fs = require('fs')
const os = require('os')
const path = require('path')
const E = require('../qr-screen')
const { qrKodla } = require('../qr')

// Geçici sysfs dizini ve fb0 dosyası; değerler sysfs'teki gibi satır sonlu
function sahteFb (t, { w = 640, h = 480, bpp = 32, stride = w * bpp / 8, sanalH = h, pan = '0,0', kip = `U:${w}x${h}p-0` } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-fb-'))
  t.teardown(() => fs.rmSync(d, { recursive: true, force: true }))
  const sys = path.join(d, 'sys')
  fs.mkdirSync(sys)
  const yaz = (ad, v) => fs.writeFileSync(path.join(sys, ad), v + '\n')
  yaz('bits_per_pixel', bpp)
  yaz('stride', stride)
  yaz('virtual_size', `${w},${sanalH}`)
  yaz('pan', pan)
  if (kip) yaz('modes', kip)
  const aygit = path.join(d, 'fb0')
  fs.writeFileSync(aygit, Buffer.alloc(stride * sanalH, 0x55))
  return { sys, aygit, oku: () => fs.readFileSync(aygit) }
}

// Her modülün ortasındaki piksel QR'daki renkle aynı mı (sessiz bölge dahil)
function modulleriDenetle (bellek, q, { modul, ust = 0, stride, bpp, taban = 0 }) {
  const n = q.moduller.length
  const px = bpp / 8
  const piksel = (x, y) => bellek.readUIntLE(taban + y * stride + x * px, px)
  const beyaz = bpp === 32 ? 0xffffffff : 0xffff
  let tutar = 0
  for (let y = -E.BOS; y < n + E.BOS; y++) {
    for (let x = -E.BOS; x < n + E.BOS; x++) {
      const koyu = x >= 0 && y >= 0 && x < n && y < n && q.moduller[y][x]
      if (piksel((x + E.BOS) * modul + (modul >> 1), ust + (y + E.BOS) * modul + (modul >> 1)) === (koyu ? 0 : beyaz)) tutar++
    }
  }
  return tutar === (n + 2 * E.BOS) ** 2
}

test('sysfs ayrıştırma: bpp, stride, görünen alan (ilk kip), pan; bilinmeyen biçim null', (t) => {
  const oku = (v) => (ad) => { if (!(ad in v)) throw new Error('ENOENT'); return v[ad] + '\n' }
  t.alike(E.cerceveBicimi(oku({ bits_per_pixel: 32, stride: 4096, virtual_size: '1024,1536', modes: 'U:1024x768p-0' })), { w: 1024, h: 768, bpp: 32, stride: 4096, taban: 0 }, 'sanal alan kiple kırpılır')
  t.alike(E.cerceveBicimi(oku({ bits_per_pixel: 16, stride: 1600, virtual_size: '800,600' })), { w: 800, h: 600, bpp: 16, stride: 1600, taban: 0 }, 'kip dosyası yoksa sanal alan')
  t.is(E.cerceveBicimi(oku({ bits_per_pixel: 32, stride: 4096, virtual_size: '1024,1536', modes: 'U:1024x768p-0', pan: '0,768' })).taban, 768 * 4096, 'pan: görünen alanın başı')
  t.is(E.cerceveBicimi(oku({ bits_per_pixel: 24, stride: 3072, virtual_size: '1024,768' })), null, '24 bpp desteklenmez')
  t.is(E.cerceveBicimi(oku({ bits_per_pixel: 32, stride: 1000, virtual_size: '1024,768' })), null, 'satır uzunluğu genişlikten kısa')
  t.is(E.cerceveBicimi(oku({ bits_per_pixel: 32, stride: 4096 })), null, 'boyut yok')
  t.is(E.cerceveBicimi(() => { throw new Error('ENOENT') }), null, 'fb0 yok')
})

test('yerleşim ve satır baytları: tam sayı modül, alt ve üst pay, en az 1 piksel; koyu 0x00, açık 0xff', (t) => {
  const fb = { w: 1024, h: 768 }
  t.alike(E.yerlesim(fb, 33), { modul: 18, kenar: 41 * 18 }, '768 / 41')
  t.alike(E.yerlesim(fb, 33, 0, 128), { modul: 15, kenar: 41 * 15 }, 'altta metin payı')
  t.alike(E.yerlesim({ w: 20, h: 20 }, 33), { modul: 1, kenar: 41 }, 'küçük ekranda 1 piksel')
  const q = qrKodla('HFJ1:x')
  const s = E.modulSatiri(q, 0, 3, 4)
  t.is(s.byteLength, (q.moduller.length + 8) * 3 * 4)
  t.is(s[0], 0xff, 'sessiz bölge beyaz')
  t.is(s[E.BOS * 12], 0x00, 'bulucu desenin ilk modülü koyu')
  t.ok(E.modulSatiri(q, -1, 3, 4).every((b) => b === 0xff), 'üst sessiz bölge satırı tümüyle beyaz')
})

test('sahte fb0 dosyası: yazılan baytlar QR modüllerine karşılık gelir (32 ve 16 bpp, satır dolgusu, pan)', (t) => {
  const q = qrKodla('yuva://j/2/' + 'a'.repeat(90))
  for (const o of [{ bpp: 32 }, { bpp: 16 }, { bpp: 32, stride: 640 * 4 + 64 }, { bpp: 32, sanalH: 960, pan: '0,480' }]) {
    const f = sahteFb(t, o)
    const fb = E.cerceveAc(f.sys, f.aygit)
    t.ok(fb, 'açıldı ' + JSON.stringify(o))
    const { modul, kenar } = E.cerceveyeCiz(fb, q, 64, 32)
    fb.kapat()
    t.ok(modul >= 5 && 64 + kenar + 32 <= 480, 'ekrana sığar, modül ' + modul)
    const bellek = f.oku()
    t.ok(modulleriDenetle(bellek, q, { modul, ust: 64, stride: fb.stride, bpp: fb.bpp, taban: fb.taban }), 'her modülün ortası doğru renkte')
    t.is(bellek[fb.taban + 10 * fb.stride], 0x55, 'üstteki metin alanına dokunulmaz')
    t.is(bellek[fb.taban + 64 * fb.stride + kenar * fb.bpp / 8], 0x55, 'QR\'ın sağına dokunulmaz')
    if (fb.taban) t.ok(bellek.subarray(0, fb.taban).every((b) => b === 0x55), 'pan: görünmeyen alana yazılmaz')
  }
  t.is(E.cerceveAc(path.join(os.tmpdir(), 'hf-yok-sys'), '/yok/fb0'), null, 'sysfs yoksa null')
  const f = sahteFb(t, { bpp: 24, stride: 640 * 3 })
  t.is(E.cerceveAc(f.sys, f.aygit), null, 'biçim bilinmiyorsa null')
})

test('konsol algılama: tty1 (fb0 yazılabilir) → piksel; SSH, sözde terminal, başka VT, fb0 yok → yarım blok', (t) => {
  const tty1 = { env: { TERM: 'linux' }, tty: true, cikis: '/dev/tty1', aktif: 'tty1', fbYazilabilir: true }
  t.ok(E.konsolMu(tty1), 'tty1, etkin VT')
  t.ok(E.konsolMu({ ...tty1, env: {} }), 'TERM olmasa da /dev/tty1')
  t.ok(E.konsolMu({ ...tty1, cikis: '/dev/console' }), 'TERM=linux, /dev/console')
  t.ok(E.konsolMu({ ...tty1, cikis: '/dev/tty0', aktif: 'tty3' }), 'tty0 her zaman etkin VT')
  t.absent(E.konsolMu({ ...tty1, aktif: 'tty2' }), 'başka VT etkin: üstüne çizilmez')
  t.absent(E.konsolMu({ ...tty1, fbYazilabilir: false }), 'fb0 yazılamıyor')
  t.absent(E.konsolMu({ ...tty1, tty: false }), 'çıktı TTY değil (boru, dosya)')
  t.absent(E.konsolMu({ ...tty1, env: { TERM: 'linux', SSH_CONNECTION: '1 2 3 4' }, cikis: '/dev/pts/0' }), 'SSH')
  t.absent(E.konsolMu({ ...tty1, env: { TERM: 'linux', SSH_TTY: '/dev/pts/0' }, cikis: '/dev/tty1' }), 'SSH değişkeni varsa VT\'ye de çizilmez')
  t.absent(E.konsolMu({ ...tty1, env: { TERM: 'linux' }, cikis: '/dev/pts/3' }), 'sözde terminal')
  t.absent(E.konsolMu({ ...tty1, env: { TERM: 'xterm-256color' }, cikis: '' }), 'terminal emülatörü')
  t.absent(E.konsolMu({ ...tty1, env: { TERM: 'vt220' }, cikis: '/dev/ttyS1' }), 'seri konsol')
  t.absent(E.konsolMu(), 'boş')

  const gercek = (o) => E.konsoldaMi({ cikis: { isTTY: true, fd: 1 }, env: { TERM: 'linux' }, platform: 'linux', bagOku: () => '/dev/tty1', oku: () => 'tty1\n', yazilabilir: () => {}, ...o })
  t.ok(gercek(), 'Linux, /proc/self/fd/1 → /dev/tty1')
  t.absent(gercek({ platform: 'darwin' }), 'Linux değil')
  t.absent(gercek({ yazilabilir: () => { throw new Error('EACCES') } }), 'fb0 izni yok (video grubu değil)')
  t.absent(gercek({ bagOku: () => '/dev/pts/1', env: { TERM: 'xterm' } }), 'terminal emülatörü')
  t.ok(gercek({ bagOku: () => { throw new Error('ENOENT') }, oku: () => { throw new Error('ENOENT') } }), 'yol okunamazsa TERM=linux yeter')
})

test('tören çizicisi: konsolda ekranı siler, QR\'ı fb0\'a çizer, imleci QR\'ın altına taşır; konsolda değilse null', (t) => {
  t.is(E.konsolCizici({ konsol: () => false }), null, 'konsol değil: yarım blok')
  const f = sahteFb(t, { w: 1024, h: 768 })
  const silinen = []
  const ciz = E.konsolCizici({ konsol: () => true, ac: () => E.cerceveAc(f.sys, f.aygit), satirlar: () => 48, sil: (s) => silinen.push(s) })
  const q = qrKodla('yuva://j/2/abc')
  const dizi = ciz('yuva://j/2/abc')
  t.alike(silinen, ['\x1b[2J\x1b[H'], 'önce ekran silinir')
  const { modul, kenar } = E.yerlesim({ w: 1024, h: 768 }, q.moduller.length, 0, E.ALT_SATIR * 16)
  t.is(dizi, '\x1b[' + Math.ceil(kenar / 16) + ';1H', 'imleç QR\'ın son satırına (16 piksellik satır)')
  t.ok(Math.ceil(kenar / 16) + E.ALT_SATIR <= 48, 'altta metne 8 satır kalır')
  t.ok(modulleriDenetle(f.oku(), q, { modul, stride: 4096, bpp: 32 }), 'yeniden çizimde de doğru (60 sn yenileme)')
  const ikinci = qrKodla('yuva://j/2/def')
  ciz('yuva://j/2/def')
  t.ok(modulleriDenetle(f.oku(), ikinci, { modul, stride: 4096, bpp: 32 }), 'yeni QR eskisinin üstüne çizilir')
  t.is(E.konsolCizici({ konsol: () => true, ac: () => null, sil: () => {} })('x'), null, 'fb0 açılamazsa null')
})
