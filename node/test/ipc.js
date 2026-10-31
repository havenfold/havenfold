// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// RFC-0007 §6: IPC çerçevesi (vektör 12), karşı uç kimliği, soket başına kapsam, denetçi işleyicileri
const test = require('brittle')
const b4a = require('b4a')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { ipc: { turler: { IPC }, cerceve: C }, denetci: { Denetci } } = require('..')

const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }

test('vektör 12: çerçeve uzunluk öneki, 1 MiB sınırı, bilinmeyen tür → HATA', async (t) => {
  const f = C.cerceveYaz(IPC.GOREV_BASLAT, 7, { taskId: b4a.alloc(16, 1) })
  // u32be uzunluk ‖ type (5) ‖ reqId (7) ‖ body (uzunluk 16 ‖ 16 bayt)
  t.is(b4a.toString(f, 'hex'), '00000013' + '05' + '07' + '10' + '01'.repeat(16))
  const r = new C.CerceveOkuyucu()
  t.alike(r.besle(f.subarray(0, 3)), [], 'yarım önek bekler')
  const [msg] = r.besle(f.subarray(3))
  t.alike(C.mesajCoz(msg), { type: IPC.GOREV_BASLAT, reqId: 7, mesaj: { taskId: b4a.alloc(16, 1) } })
  // 1 MiB + 1 uzunluk öneki bağlantıyı bozar
  const buyuk = b4a.alloc(4)
  new DataView(buyuk.buffer).setUint32(0, 1024 * 1024 + 1, false)
  const r2 = new C.CerceveOkuyucu()
  t.is(hataOf(() => r2.besle(buyuk)), 'FRAME_TOO_LARGE')
  t.is(hataOf(() => r2.besle(b4a.alloc(1))), 'FRAME_TOO_LARGE', 'bozulan okuyucu kullanılmaz')
  t.is(hataOf(() => C.cerceveYaz(IPC.YEDEK_YAZ, 1, { blobId: b4a.alloc(32), path: 'x'.repeat(1024 * 1024), size: 1 })), 'FRAME_TOO_LARGE')
  // Bilinmeyen tür: HATA { reqId, code: 'BILINMEYEN_TUR' }
  const bil = C.ipcMsg
  const ham = require('compact-encoding').encode(bil, { type: 99, reqId: 5, body: b4a.alloc(0) })
  const e = (() => { try { C.mesajCoz(ham) } catch (err) { return err } })()
  t.is(e.message, 'BILINMEYEN_TUR')
  t.is(e.reqId, 5)
  const h = C.mesajCoz(C.hataCercevesi(5, 'BILINMEYEN_TUR').subarray(4))
  t.alike(h, { type: IPC.HATA, reqId: 0, mesaj: { reqId: 5, code: 'BILINMEYEN_TUR', detail: '' } })
  // Kanonik: sonda fazla bayt ve en kısa olmayan uint reddedilir
  t.is(hataOf(() => C.mesajCoz(b4a.concat([f.subarray(4), b4a.from([0])]))), 'INVALID_FRAME')
  t.is(hataOf(() => C.mesajCoz(C.cerceveYaz(IPC.DURDUR, 0, { neden: 'tatil' }).subarray(4))), 'INVALID_BODY', 'değer denetimi')
})

function kur () {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-node-'))
  const d = new Denetci({ kok, hostId: b4a.alloc(16, 0xaa), surum: '1.0.0', calistir: async () => ({ status: 'tamam', exitCode: 0, log: 'ok' }) })
  return { kok, d }
}

const istek = async (b, type, mesaj, reqId = 1) => {
  const { cikis } = await b.al(C.cerceveYaz(type, reqId, mesaj))
  return cikis.map((f) => C.mesajCoz(f.subarray(4), type === IPC.MERHABA ? 'cevap' : 'istek'))
}

test('karşı uç kimliği ve soket başına kapsam', async (t) => {
  const { kok, d } = kur()
  t.is(d.uc('kutu').baglan('havenfold-isci'), null, 'kutu soketine işçi kullanıcısı bağlanamaz')
  t.is(d.uc('isci').baglan(undefined), null)
  const kutu = d.uc('kutu').baglan('havenfold-kutu')
  const isci = d.uc('isci').baglan('havenfold-isci')
  const [m] = await istek(kutu, IPC.MERHABA, { rol: 'kutu', surum: '1.0.0' })
  t.alike(m.mesaj, { hostId: b4a.alloc(16, 0xaa), denetciSurum: '1.0.0' })
  const [y] = await istek(isci, IPC.MERHABA, { rol: 'kutu', surum: '1.0.0' })
  t.is(y.mesaj.code, 'UNAUTHORIZED', 'işçi soketinden kutu olarak tanıtılamaz')
  // Yedek: kutu kendi dizinine yazar, işçi kutunun yedeğini göremez
  fs.mkdirSync(path.join(kok, 'run/havenfold/kutu'), { recursive: true })
  fs.writeFileSync(path.join(kok, 'run/havenfold/kutu/blok'), b4a.alloc(10, 7))
  const blobId = b4a.alloc(32, 3)
  const [w] = await istek(kutu, IPC.YEDEK_YAZ, { blobId, path: 'run/havenfold/kutu/blok', size: 10 })
  t.is(w.mesaj.ok, true)
  t.ok(fs.existsSync(path.join(kok, 'var/lib/havenfold/yedek/kutu', '03'.repeat(32))))
  const [o1] = await istek(kutu, IPC.YEDEK_OKU, { blobId })
  const [o2] = await istek(isci, IPC.YEDEK_OKU, { blobId })
  t.is(o1.mesaj.ok, true)
  t.is(o2.mesaj.ok, false, 'işçi soketinden kutu yedeği okunmaz')
  fs.writeFileSync(path.join(kok, 'run/havenfold/kutu/b2'), b4a.alloc(1))
  const [k2] = await istek(isci, IPC.YEDEK_YAZ, { blobId, path: 'run/havenfold/kutu/b2', size: 1 })
  t.is(k2.mesaj.code, 'INVALID_PATH', 'işçi kutunun dizininden blok taşıyamaz')
  const [k3] = await istek(kutu, IPC.YEDEK_YAZ, { blobId, path: 'run/havenfold/kutu/../../../etc/passwd', size: 1 })
  t.is(k3.mesaj.code, 'INVALID_PATH')
  // Görev yalnız işçiden
  const g = { taskId: b4a.alloc(16, 9), type: 'hf.task.ocr', version: '1.0.0', limits: { ramMB: 100, minutes: 1, diskMB: 1 }, standing: false, sourceId: null }
  const [r1] = await istek(kutu, IPC.GOREV_HAZIRLA, g)
  t.is(r1.mesaj.code, 'UNAUTHORIZED')
  const [r2] = await istek(isci, IPC.GOREV_HAZIRLA, g)
  t.alike([r2.type, r2.mesaj.ok, r2.mesaj.dir], [IPC.GOREV_HAZIR, true, 'run/havenfold/gorev/' + '09'.repeat(16)])
  t.is((fs.statSync(path.join(kok, r2.mesaj.dir, 'in')).mode & 0o7777), 0o2770)
  const [r3] = await istek(isci, IPC.GOREV_HAZIRLA, g)
  t.is(r3.mesaj.code, 'REPLAY')
  const [b] = await istek(isci, IPC.GOREV_BASLAT, { taskId: g.taskId })
  t.alike([b.type, b.mesaj.status, b.mesaj.exitCode], [IPC.GOREV_BITTI, 'tamam', 0])
  await istek(isci, IPC.GOREV_TEMIZLE, { taskId: g.taskId })
  t.absent(fs.existsSync(path.join(kok, r2.mesaj.dir)))
  // Bozuk çerçeve HATA ile, büyük çerçeve bağlantıyı kapatır
  const { cikis } = await isci.al(b4a.from([0, 0, 0, 3, 99, 0, 0]))
  t.is(C.mesajCoz(cikis[0].subarray(4)).mesaj.code, 'BILINMEYEN_TUR')
  const kapat = await isci.al(b4a.from([0x7f, 0, 0, 0]))
  t.is(kapat.kapat, true)
  fs.rmSync(kok, { recursive: true, force: true })
})
