// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Yetki yardımcısının luks-kurtarma işlemi (RFC-0007 §6.4, §8.5): taklit kökte; sudo yok, disk yok.
const test = require('brittle')
const fs = require('fs')
const path = require('path')
const b4a = require('b4a')
const { ortam, DEN } = require('./helpers/privilege-env')

const hataOf = async (fn) => { try { await fn(); return null } catch (err) { return err.message } }

test('oku ve sil: 32 baytlık anahtar, silinince yok', async (t) => {
  const o = ortam()
  t.teardown(o.sil)
  const p = path.join(o.kok, 'var/lib/havenfold/yetki/luks-kurtarma')
  t.alike(await o.y.isle(DEN, 'luks-kurtarma', { istek: 'oku' }), { var: false }, 'henüz yok')
  const anahtar = b4a.alloc(32, 0xab)
  fs.writeFileSync(p, anahtar, { mode: 0o600 })
  t.alike(await o.y.isle(DEN, 'luks-kurtarma', { istek: 'oku' }), { var: true, anahtar: 'ab'.repeat(32) })
  t.alike(await o.y.isle('root', 'luks-kurtarma', { istek: 'oku' }), { var: true, anahtar: 'ab'.repeat(32) }, 'kök de okur')
  t.alike(await o.y.isle(DEN, 'luks-kurtarma', { istek: 'sil' }), { silindi: true })
  t.absent(fs.existsSync(p))
  t.alike(await o.y.isle(DEN, 'luks-kurtarma', { istek: 'sil' }), { silindi: false }, 'ikinci silme')
})

test('yetki ve girdi denetimi', async (t) => {
  const o = ortam()
  t.teardown(o.sil)
  const p = path.join(o.kok, 'var/lib/havenfold/yetki/luks-kurtarma')
  fs.writeFileSync(p, b4a.alloc(32, 1), { mode: 0o600 })
  t.is(await hataOf(() => o.y.isle('havenfold-isci', 'luks-kurtarma', { istek: 'oku' })), 'UNAUTHORIZED', 'çekirdek doğrudan okuyamaz; denetçi üzerinden')
  t.is(await hataOf(() => o.y.isle('havenfold-kutu', 'luks-kurtarma', { istek: 'sil' })), 'UNAUTHORIZED')
  t.is(await hataOf(() => o.y.isle(DEN, 'luks-kurtarma', { istek: 'yaz' })), 'INVALID_INPUT')
  t.is(await hataOf(() => o.y.isle(DEN, 'luks-kurtarma', {})), 'INVALID_INPUT')
  fs.writeFileSync(p, b4a.alloc(31), { mode: 0o600 })
  t.is(await hataOf(() => o.y.isle(DEN, 'luks-kurtarma', { istek: 'oku' })), 'RECOVERY_CORRUPT', 'boyut 32 değil')
  fs.rmSync(p)
  const baska = path.join(o.kok, 'baska')
  fs.writeFileSync(baska, b4a.alloc(32, 2))
  fs.symlinkSync(baska, p)
  t.is(await hataOf(() => o.y.isle(DEN, 'luks-kurtarma', { istek: 'oku' })), 'RECOVERY_CORRUPT', 'sembolik bağ izlenmez')
  t.is(await hataOf(() => o.y.isle(DEN, 'luks-kurtarma', { istek: 'sil' })), 'RECOVERY_CORRUPT')
  t.ok(fs.existsSync(baska), 'bağın hedefi silinmedi')
  fs.chmodSync(path.join(o.kok, 'var/lib/havenfold/yetki'), 0o755)
  t.is(await hataOf(() => o.y.isle(DEN, 'luks-kurtarma', { istek: 'oku' })), 'ROOT_STATE_NOT_WRITABLE', 'kökün dizini başkasına açıksa')
})

// Denetçi tarafı (RFC-0007 §6.3 tür 22, §8.5 adım 4 ve 6): çekirdek RECOVERY_KEY { istek } yollar, denetçi yetki
// yardımcısının luks-kurtarma işlemini çağırır, cevap aynı türün 'cevap' gövdesiyle ({ var, anahtar }). Yalnız işçi
// ya da tek kimlikli düğümde kutu; yetki kancası yoksa NO_PERMISSION.
test('denetçi: RECOVERY_KEY oku ve sil yetki yardımcısından; kapsam ve kanca denetimi', async (t) => {
  const { Denetci } = require('../supervisor')
  const { IPC } = require('../ipc/types')
  const C = require('../ipc/frame')
  const o = ortam()
  t.teardown(o.sil)
  const p = path.join(o.kok, 'var/lib/havenfold/yetki/luks-kurtarma')
  fs.writeFileSync(p, b4a.alloc(32, 0xcd), { mode: 0o600 })
  const yetki = (islem, girdi) => o.y.isle(DEN, islem, girdi)
  const istek = async (b, mesaj) => {
    const { cikis } = await b.al(C.cerceveYaz(IPC.RECOVERY_KEY, 3, mesaj))
    const [f] = cikis
    const ust = require('compact-encoding').decode(C.ipcMsg, f.subarray(4))
    return C.mesajCoz(f.subarray(4), ust.type === IPC.RECOVERY_KEY ? 'cevap' : 'istek')
  }
  const d = new Denetci({ kok: o.kok, hostId: b4a.alloc(16, 1), surum: '1.0.0', yetki, kurtarmaKapsami: 'isci' })
  const isci = d.uc('isci').baglan('havenfold-isci')
  const kutu = d.uc('kutu').baglan('havenfold-kutu')
  t.alike((await istek(isci, { istek: 'oku' })).mesaj, { var: true, anahtar: b4a.alloc(32, 0xcd) })
  t.is((await istek(kutu, { istek: 'oku' })).mesaj.code, 'UNAUTHORIZED', 'birleşik düğümde kutu okuyamaz')
  t.alike((await istek(isci, { istek: 'sil' })).mesaj, { var: true, anahtar: b4a.alloc(0) }, 'silindi')
  t.absent(fs.existsSync(p))
  t.alike((await istek(isci, { istek: 'oku' })).mesaj, { var: false, anahtar: b4a.alloc(0) }, 'teslimden sonra yok')
  t.alike((await istek(isci, { istek: 'sil' })).mesaj, { var: false, anahtar: b4a.alloc(0) })
  // Tek kimlikli kutu düğümü
  fs.writeFileSync(p, b4a.alloc(32, 0xce), { mode: 0o600 })
  const dk = new Denetci({ kok: o.kok, hostId: b4a.alloc(16, 1), surum: '1.0.0', yetki, kurtarmaKapsami: 'kutu' })
  t.alike((await istek(dk.uc('kutu').baglan('havenfold-kutu'), { istek: 'oku' })).mesaj.anahtar, b4a.alloc(32, 0xce))
  t.is((await istek(dk.uc('isci').baglan('havenfold-isci'), { istek: 'oku' })).mesaj.code, 'UNAUTHORIZED')
  // Yetki kancası verilmemiş Denetci (denetciyiBaslat üretimde yardımcının soketine bağlar)
  const dy = new Denetci({ kok: o.kok, hostId: b4a.alloc(16, 1), surum: '1.0.0', kurtarmaKapsami: 'isci' })
  t.is((await istek(dy.uc('isci').baglan('havenfold-isci'), { istek: 'oku' })).mesaj.code, 'NO_PERMISSION')
  t.is(C.mesajCoz(C.cerceveYaz(IPC.RECOVERY_KEY, 1, { var: true, anahtar: b4a.alloc(32) }, 'cevap').subarray(4), 'cevap').mesaj.var, true)
  t.is(await hataOf(() => C.mesajCoz(C.cerceveYaz(IPC.RECOVERY_KEY, 1, { var: true, anahtar: b4a.alloc(5) }, 'cevap').subarray(4), 'cevap')), 'INVALID_BODY', 'anahtar 0 ya da 32 bayt')
})
