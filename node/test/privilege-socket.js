// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Yetki yardımcısının soket kipi (RFC-0033 §9 l; RFC-0007 §6.1, §6.4): dizin 0750 ve soket 0660 grubuyla açılır,
// soketten gelen istek denetçi sayılır ve yardımcının kendi kuralıyla denetlenir; boşta kapanır. Taklit kökte, sudo yok.
const test = require('brittle')
const fs = require('fs')
const net = require('net')
const { spawn } = require('child_process')
const path = require('path')
const b4a = require('b4a')
const { ortam } = require('./helpers/privilege-env')
const Y = require('../privilege-socket')
const { IPC } = require('../ipc/types')
const C = require('../ipc/frame')

const hataOf = async (fn) => { try { await fn(); return null } catch (err) { return err.message } }
const gid = process.getgid()

test('soket kipi: dizin ve soket izinleri; luks-kurtarma oku ve sil soketten; kök işi ve liste dışı reddedilir', async (t) => {
  const o = ortam()
  t.teardown(o.sil)
  fs.writeFileSync(path.join(o.kok, 'var/lib/havenfold/yetki/luks-kurtarma'), b4a.alloc(32, 0x3c), { mode: 0o600 })
  const yol = path.join(o.kok, Y.YETKI_SOKETI)
  t.is(Y.YETKI_SOKETI, '/run/havenfold/yetki/yetki.sock')
  fs.mkdirSync(path.join(o.kok, 'run/havenfold'), { recursive: true })
  const s = await Y.yetkiSunucusu({ y: o.y, yol, gid, bostaMs: 0 })
  t.teardown(() => s.close())
  const dz = fs.statSync(path.dirname(yol))
  const sk = fs.statSync(yol)
  t.alike([dz.mode & 0o777, dz.gid], [0o750, gid], 'dizin 0750, grup denetçinin')
  t.alike([sk.isSocket(), sk.mode & 0o777, sk.gid], [true, 0o660, gid], 'soket 0660')

  const iste = Y.yetkiIstemcisi(yol)
  t.alike(await iste('luks-kurtarma', { istek: 'oku' }), { var: true, anahtar: '3c'.repeat(32) })
  t.is(await hataOf(() => iste('deneme-denetle', { acilis: false })), 'UNAUTHORIZED', 'kökün işi soketten yapılamaz (çağıran denetçi sayılır)')
  t.is(await hataOf(() => iste('usb-yaz', {})), 'NOT_IN_THIS_VERSION')
  t.is(await hataOf(() => iste('kabuk', {})), 'NOT_LISTED')
  t.is(await hataOf(() => iste('luks-kurtarma', { istek: 'yaz' })), 'INVALID_INPUT')
  t.alike(await iste('luks-kurtarma', { istek: 'sil' }), { silindi: true })
  t.alike(await iste('luks-kurtarma', { istek: 'oku' }), { var: false })

  // Ham çerçeveler: bozuk JSON ve yanlış tür; aynı bağlantıda sırayla iki cevap
  const ham = await new Promise((resolve) => {
    const c = net.createConnection(yol)
    const ok = new C.CerceveOkuyucu()
    const gelen = []
    c.on('connect', () => c.write(b4a.concat([C.cerceveYaz(IPC.YETKI_ISTEK, 1, { islem: 'durum-oku', girdi: '{bozuk' }), C.cerceveYaz(IPC.DURUM_ISTE, 2, {})])))
    c.on('data', (p) => { for (const b of ok.besle(p)) gelen.push(C.mesajCoz(b)); if (gelen.length === 2) { c.destroy(); resolve(gelen) } })
  })
  t.alike(ham[0], { type: IPC.YETKI_CEVAP, reqId: 1, mesaj: { ok: false, code: 'INVALID_INPUT', cikti: '' } })
  t.alike([ham[1].type, ham[1].mesaj.code], [IPC.HATA, 'UNSUPPORTED'])
})

test('soket kipi: var olan dizinin izni düzeltilir, bağ olan dizin reddedilir; boşta kapanır; sunucu yoksa NO_PERMISSION', async (t) => {
  const o = ortam()
  t.teardown(o.sil)
  const yol = path.join(o.kok, Y.YETKI_SOKETI)
  fs.mkdirSync(path.dirname(yol), { recursive: true, mode: 0o777 })
  fs.chmodSync(path.dirname(yol), 0o777)
  let kapandi = false
  await Y.yetkiSunucusu({ y: o.y, yol, gid, bostaMs: 50, bitti: () => { kapandi = true } })
  t.is(fs.statSync(path.dirname(yol)).mode & 0o777, 0o750, 'izin 0750 yapıldı')
  const iste = Y.yetkiIstemcisi(yol)
  t.ok(await iste('durum-oku', {}), 'istek')
  await new Promise((resolve) => setTimeout(resolve, 200))
  t.ok(kapandi, 'son bağlantıdan sonra boşta kapandı')
  t.is(await hataOf(() => iste('durum-oku', {})), 'NO_PERMISSION', 'dinleyen yok')
  // Codex 12. tur: istek gittikten sonra cevapsız kopan bağlantı (yardımcı denetçiyi yeniden başlattı) yetki hatası değil
  const kopan = path.join(o.kok, 'kopan.sock')
  const ks = net.createServer((c) => c.once('data', () => c.destroy()))
  await new Promise((resolve) => ks.listen(kopan, resolve))
  t.is(await hataOf(() => Y.yetkiIstemcisi(kopan)('surum-gec', { surum: '1.2.3' })), 'PRIVILEGE_DISCONNECTED')
  await new Promise((resolve) => ks.close(resolve))

  const baska = path.join(o.kok, 'baska')
  fs.mkdirSync(baska)
  const bag = path.join(o.kok, 'run/havenfold/bag')
  fs.symlinkSync(baska, bag)
  t.is(await hataOf(() => Y.yetkiSunucusu({ y: o.y, yol: path.join(bag, 'yetki.sock'), gid })), 'INVALID_SOCKET_DIR')
})

test('ana(): soket kipi yalnız kök ve systemd soketiyle; verilen dinleyen sokette çalışır, boşta çıkış 0', async (t) => {
  const { ana } = require('../privilege-main')
  const o = ortam()
  t.teardown(o.sil)
  const hatalar = []
  t.is(await ana([], { kok: o.kok, kokMu: () => false, hataYaz: (s) => hatalar.push(s) }), 2)
  t.is(await ana([], { kok: o.kok, kokMu: () => true, ortam: {}, hataYaz: (s) => hatalar.push(s) }), 3)
  t.ok(/UNAUTHORIZED/.test(hatalar[0]) && /NO_SOCKET/.test(hatalar[1]))
  t.is(Y.systemdSoketi({ LISTEN_FDS: '1', LISTEN_PID: String(process.pid) }), 3)
  t.is(Y.systemdSoketi({ LISTEN_FDS: '1', LISTEN_PID: '1' }), null, 'başka sürecin soketi')

  // systemd'nin yerine: dinleyen soketi önceden açıp ayrı sürece fd 3 olarak ver (Accept=no). Ana süreç soketi
  // bırakır: önce adını değiştirir (kapatma eski adı siler), sonra kapatır; bağlantıları yalnız çocuk kabul eder.
  const yol = path.join(o.kok, 'run/yetki.sock')
  fs.mkdirSync(path.dirname(yol), { recursive: true })
  const dinleyen = net.createServer()
  await new Promise((resolve) => dinleyen.listen(yol, resolve))
  fs.writeFileSync(path.join(o.kok, 'var/lib/havenfold/yetki/luks-kurtarma'), b4a.alloc(32, 0x11), { mode: 0o600 })
  const betik = "require(process.argv[1]).ana([], { kok: process.argv[2], kokMu: () => true, fd: 3, bostaMs: 200 }).then((k) => process.exit(k))"
  const cocuk = spawn(process.execPath, ['-e', betik, require.resolve('../privilege-main'), o.kok], { stdio: ['ignore', 'pipe', 'pipe', dinleyen._handle.fd] })
  t.teardown(() => { try { cocuk.kill('SIGKILL') } catch {} })
  const cikis = new Promise((resolve) => cocuk.once('exit', resolve))
  const yeni = yol + '.c'
  fs.renameSync(yol, yeni)
  await new Promise((resolve) => dinleyen.close(resolve))
  t.alike(await Y.yetkiIstemcisi(yeni)('luks-kurtarma', { istek: 'oku' }), { var: true, anahtar: '11'.repeat(32) }, 'çocuk süreç systemd soketinden cevaplar')
  t.is(await cikis, 0, 'boşta kapandı, çıkış 0')
})
