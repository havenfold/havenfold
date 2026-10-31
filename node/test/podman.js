// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Podman çalıştırıcısı (RFC-0002 §11.1, RFC-0007 §12.1): sahte podman (PATH'te betik) ile argümanlar, çıkış kodu,
// zaman aşımı, iptal, imaj yükleme; denetçiyle birlikte GOREV_HAZIRLA → GOREV_BASLAT → GOREV_BITTI. Gerçek Podman
// testi yalnız HF_PODMAN_URL ve HF_PODMAN_IMAJ verilince koşar.
const test = require('brittle')
const fs = require('fs')
const os = require('os')
const path = require('path')
const b4a = require('b4a')
const { spawnSync } = require('child_process')
const { PodmanCalistirici, imajBul, kayitliTurler, sonuKes } = require('../podman')
const { Denetci } = require('../supervisor')
const { IPC } = require('../ipc/types')
const C = require('../ipc/frame')
const S = require('../release')
const { sahtePodman } = require('./helpers/fake-podman')

const URL = 'unix:///run/havenfold/podman/podman.sock'
const OCR = 'localhost/hf-task-ocr@sha256:' + 'a'.repeat(64)
const ID = 'ab'.repeat(16)
const hataOf = async (fn) => { try { await fn(); return null } catch (err) { return err.message } }
const bekle = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function gorev (sp, ek = {}) {
  const dir = path.join(sp.kok, 'run/havenfold/gorev', ek.taskId || ID)
  for (const d of ['in', 'out']) fs.mkdirSync(path.join(dir, d), { recursive: true })
  return { taskId: ID, dir, type: 'hf.task.ocr', version: '1.0.0', limits: { ramMB: 512, minutes: 1, diskMB: 64 }, standing: false, ...ek }
}
function calistirici (sp, ek = {}) {
  return new PodmanCalistirici({ url: URL, kok: sp.kok, cekirdek: 4, ramMB: 8192, imajBul: () => OCR, ortam: sp.ortam, ...ek })
}
const runArgs = (sp) => sp.cagrilar().find((a) => a.includes('run'))

test('argümanlar: ağ yok, salt okunur kök, yetkisiz, sınırlı; imaj özetiyle; çıktı /out\'ta', async (t) => {
  const sp = sahtePodman('ok')
  const p = calistirici(sp)
  const g = gorev(sp)
  const r = await p.calistir(g)
  t.alike(r, { status: 'ok', exitCode: 0, log: 'hf: tamam\n' })
  t.is(fs.readFileSync(path.join(g.dir, 'out/metin.txt'), 'utf8'), 'tamam')
  const a = runArgs(sp)
  t.alike(a.slice(0, 3), ['--remote', '--url=' + URL, 'run'], 'havenfold-task\'ın API soketi üstünden')
  t.is(a.at(-1), OCR, 'imaj @sha256: ile, en sonda')
  for (const x of ['--rm', '--name=hf-gorev-' + ID, '--pull=never', '--network=none', '--read-only', '--read-only-tmpfs=false',
    '--cap-drop=all', '--security-opt=no-new-privileges', '--userns=keep-id', '--annotation=run.oci.keep_original_groups=1', '--memory=512m',
    '--memory-swap=512m', '--cpus=3', '--pids-limit=256', '--timeout=90', '--umask=0027', '--log-driver=none',
    '--tmpfs=/work:rw,nosuid,nodev,noexec,size=64m,mode=1777',
    '--volume=' + path.join(g.dir, 'in') + ':/in:ro,nosuid,nodev,noexec',
    '--volume=' + path.join(g.dir, 'out') + ':/out:rw,nosuid,nodev,noexec',
    '--env=HF_GOREV_TUR=hf.task.ocr', '--env=HF_GOREV_SURUM=1.0.0']) t.ok(a.includes(x), x)
  for (const yasak of ['--privileged', '--network=host', '--cap-add', '--security-opt=seccomp=unconfined', '--device']) t.absent(a.some((x) => x.startsWith(yasak)), 'yok: ' + yasak)
  t.is(a.filter((x) => x.startsWith('--network')).length, 1)
  t.absent(sp.cagrilar().some((x) => x.includes('kill') || x.includes('rm')), 'normal bitişte kill ve rm yok (--rm)')
  sp.sil()
})

test('çıkış kodu: sıfır olmayan hata; günlük çıktının son 4 KB\'ı, karakter bölünmez', async (t) => {
  const sp = sahtePodman('hata')
  const r = await calistirici(sp).calistir(gorev(sp))
  t.alike(r, { status: 'hata', exitCode: 2, log: 'hf: INVALID_INPUT\n' })
  const sp2 = sahtePodman('log')
  const r2 = await calistirici(sp2).calistir(gorev(sp2))
  t.is(r2.status, 'ok')
  t.ok(b4a.byteLength(r2.log) <= 4096 && r2.log.endsWith('SON\n'), 'son kısım kalır')
  t.ok(/^ç+SON\n$/.test(r2.log), 'çok baytlı karakter bölünmedi')
  t.is(sonuKes('abcç', 2), 'ç')
  sp.sil()
  sp2.sil()
})

test('zaman aşımı: sure; konteyner öldürülür ve kalıntısı kaldırılır', async (t) => {
  const sp = sahtePodman('bekle')
  const p = calistirici(sp, { dakikaMs: 150 })
  const r = await p.calistir(gorev(sp))
  t.is(r.status, 'sure')
  t.is(r.exitCode, 137)
  const c = sp.cagrilar()
  t.ok(c.some((a) => a.includes('kill') && a.includes('--signal=KILL') && a.at(-1) === 'hf-gorev-' + ID), 'kill')
  t.ok(c.some((a) => a.includes('rm') && a.includes('--force') && a.includes('--ignore') && a.at(-1) === 'hf-gorev-' + ID), 'rm')
  t.is(p.calisan.size, 0)
  sp.sil()
})

test('iptal: TASK_CANCEL konteyneri öldürür, sonuç iptal; bilinmeyen ve geçersiz kimlik etkisiz', async (t) => {
  const sp = sahtePodman('bekle')
  const p = calistirici(sp)
  const s = p.calistir(gorev(sp))
  await bekle(150)
  p.iptal('cd'.repeat(16))
  p.iptal('../x')
  p.iptal(null)
  t.is(p.calisan.size, 1)
  p.iptal(ID)
  const r = await s
  t.is(r.status, 'iptal')
  t.is(sp.cagrilar().filter((a) => a.includes('kill')).length, 1)
  sp.sil()
})

test('reddedilenler: yerleşik yedek, ağ isteyen tür, kayıtsız imaj, kaynak, tekrar, podman yok', async (t) => {
  const sp = sahtePodman('bekle')
  const p = calistirici(sp)
  t.is(await hataOf(() => p.calistir(gorev(sp, { type: 'hf.task.backup' }))), 'BUILTIN_TASK', 'RFC-0002 §11.2')
  t.is(await hataOf(() => p.calistir(gorev(sp, { type: 'hf.task.vision' }))), 'INVALID_SOURCE', 'görüntü görevi kaynağı (uç) ister')
  t.is(await hataOf(() => p.calistir(gorev(sp, { type: 'hf.task.vision', sourceId: '../x' }))), 'INVALID_SOURCE')
  t.is(await hataOf(() => calistirici(sp, { imajBul: () => null }).calistir(gorev(sp))), 'NO_IMAGE')
  t.is(await hataOf(() => calistirici(sp, { imajBul: () => 'localhost/hf-task-ocr:1.0.0' }).calistir(gorev(sp))), 'NO_IMAGE', 'etiketle değil özetle')
  t.is(await hataOf(() => p.calistir(gorev(sp, { limits: { ramMB: 8000, minutes: 1, diskMB: 1 } }))), 'NO_SOURCE', 'RAM')
  t.is(await hataOf(() => p.calistir(gorev(sp, { limits: { ramMB: 100, minutes: 1, diskMB: 4097 } }))), 'NO_SOURCE', '/work RAM\'in yarısını aşamaz')
  t.is(await hataOf(() => p.calistir(gorev(sp, { taskId: '../../etc' }))), 'INVALID_TASK')
  const s = p.calistir(gorev(sp))
  await bekle(50)
  t.is(await hataOf(() => p.calistir(gorev(sp))), 'REPLAY')
  p.iptal(ID)
  await s
  t.is(await hataOf(() => calistirici(sp, { podman: path.join(sp.kok, 'yok', 'podman') }).calistir(gorev(sp))), 'PODMAN_YOK')
  t.is(await hataOf(() => new PodmanCalistirici({ url: 'tcp://1.2.3.4:80' })), 'INVALID_PODMAN_URL')
  t.is(sp.cagrilar().filter((a) => a.includes('run')).length, 1, 'reddedilen görev podman\'a gitmez')
  sp.sil()
})

test('kaynakVar: maxTaskRamMB çalışan görevler düşülerek (RFC-0002 §4)', async (t) => {
  const sp = sahtePodman('bekle')
  const p = calistirici(sp, { ramMB: 4096 })
  const l = (ramMB) => ({ ramMB, minutes: 1, diskMB: 10 })
  t.ok(p.kaynakVar(l(3072)))
  t.absent(p.kaynakVar(l(3073)))
  t.absent(p.kaynakVar({ ramMB: 0, minutes: 1, diskMB: 0 }))
  const s = p.calistir(gorev(sp, { limits: l(2048) }))
  await bekle(50)
  t.ok(p.kaynakVar(l(1024)))
  t.absent(p.kaynakVar(l(1025)), '4096 − 1024 − 2048')
  p.iptal(ID)
  await s
  sp.sil()
})

test('denetçiyle: GOREV_HAZIRLA → GOREV_BASLAT → GOREV_BITTI; TASK_CANCEL kancası', async (t) => {
  const sp = sahtePodman('ok')
  fs.mkdirSync(path.join(sp.kok, 'run/havenfold/gorev'), { recursive: true })
  const p = calistirici(sp)
  const den = new Denetci({ kok: sp.kok, hostId: b4a.alloc(16, 7), surum: '1.2.3', ...p.kancalar() })
  const b = den.uc('isci').baglan('havenfold-isci')
  const istek = async (type, mesaj) => (await b.al(C.cerceveYaz(type, 1, mesaj))).cikis.map((f) => C.mesajCoz(f.subarray(4)))
  const taskId = b4a.from(ID, 'hex')
  const [h] = await istek(IPC.GOREV_HAZIRLA, { taskId, type: 'hf.task.ocr', version: '1.0.0', limits: { ramMB: 512, minutes: 1, diskMB: 64 }, standing: false, sourceId: null })
  t.is(h.mesaj.ok, true)
  const [h2] = await istek(IPC.GOREV_HAZIRLA, { taskId: b4a.alloc(16, 9), type: 'hf.task.ocr', version: '1.0.0', limits: { ramMB: 9000, minutes: 1, diskMB: 64 }, standing: false, sourceId: null })
  t.alike([h2.mesaj.ok, h2.mesaj.code], [false, 'NO_SOURCE'], 'kaynakVar kancası')
  const [r] = await istek(IPC.GOREV_BASLAT, { taskId })
  t.alike([r.type, r.mesaj.status, r.mesaj.exitCode], [IPC.GOREV_BITTI, 'ok', 0])
  t.is(fs.readFileSync(path.join(sp.kok, h.mesaj.dir, 'out/metin.txt'), 'utf8'), 'tamam')
  await istek(IPC.GOREV_TEMIZLE, { taskId })
  t.absent(fs.existsSync(path.join(sp.kok, h.mesaj.dir)))
  // Yedek görevi denetçiden konteynere gitmez
  const yid = b4a.alloc(16, 5)
  await istek(IPC.GOREV_HAZIRLA, { taskId: yid, type: 'hf.task.backup', version: '1.0.0', limits: { ramMB: 64, minutes: 1, diskMB: 1 }, standing: false, sourceId: null })
  const [y] = await istek(IPC.GOREV_BASLAT, { taskId: yid })
  t.alike([y.type, y.mesaj.code], [IPC.HATA, 'BUILTIN_TASK'])
  sp.sil()
})

test('imajYukle: arşiv özeti, podman load, yüklenen özet; kayıt ve uyumlu sürüm seçimi', async (t) => {
  const oci = 'sha256:' + 'b'.repeat(64)
  const sp = sahtePodman('ok', { SAHTE_OZET: oci })
  fs.mkdirSync(path.join(sp.kok, 'var/lib/havenfold/denetci'), { recursive: true })
  const p = calistirici(sp, { imajBul: null })
  const arsiv = path.join(sp.kok, 'ocr.tar')
  const bytes = b4a.from('oci-archive baytları')
  fs.writeFileSync(arsiv, bytes)
  const girdi = { type: 'hf.task.ocr', version: '1.2.0', arch: 'amd64', ociDigest: oci, ramMB: 1024, archive: { name: 'ocr.tar', size: bytes.byteLength, digest: S.paketOzeti(bytes), urls: [] } }
  t.is(await p.imajYukle(girdi, arsiv), 'localhost/hf-task-ocr@' + oci)
  t.ok(sp.cagrilar().some((a) => a.includes('load') && a.includes('--input=' + arsiv)))
  const bul = imajBul(sp.kok)
  t.is(bul('hf.task.ocr', '1.0.0'), 'localhost/hf-task-ocr@' + oci, 'MINOR büyük olan uyar')
  t.is(bul('hf.task.ocr', '1.3.0'), null)
  t.is(bul('hf.task.ocr', '2.0.0'), null, 'MAJOR farklı')
  t.is(bul('hf.task.transcribe', '1.0.0'), null)
  t.alike(kayitliTurler(sp.kok), [{ type: 'hf.task.ocr', version: '1.2.0', maxRamMB: 1024, standing: false, splittable: true }], 'NODE_CAPS.tasks')
  t.is(p.imajBul('hf.task.ocr', '1.1.0'), 'localhost/hf-task-ocr@' + oci, 'çalıştırıcı kayıttan bulur')
  const yuklemeler = () => sp.cagrilar().filter((a) => a.includes('load')).length
  t.is(await hataOf(() => p.imajYukle({ ...girdi, archive: { ...girdi.archive, digest: b4a.alloc(32) } }, arsiv)), 'DIGEST_MISMATCH', 'arşiv özeti tutmazsa yüklenmez')
  t.is(yuklemeler(), 1)
  t.is(await hataOf(() => p.imajYukle({ ...girdi, ociDigest: 'sha256:' + 'c'.repeat(64) }, arsiv)), 'DIGEST_MISMATCH', 'yüklenen imajın özeti tutmazsa')
  t.ok(sp.cagrilar().some((a) => a.includes('rmi')), 'tutmayan imaj silinir')
  t.is(await hataOf(() => p.imajYukle({ ...girdi, ociDigest: 'latest' }, arsiv)), 'MANIFEST_ERROR')
  sp.sil()
})

const podmanVar = spawnSync('podman', ['--version']).status === 0
test('gerçek Podman: görev tamamlanır, konteyner kalmaz', { skip: !(process.platform === 'linux' && podmanVar && process.env.HF_PODMAN_URL && process.env.HF_PODMAN_IMAJ) }, async (t) => {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-podman-gercek-'))
  const dir = path.join(kok, 'gorev')
  for (const d of ['in', 'out']) { fs.mkdirSync(path.join(dir, d), { recursive: true }); fs.chmodSync(path.join(dir, d), 0o777) }
  fs.writeFileSync(path.join(dir, 'in/params'), '{}')
  fs.writeFileSync(path.join(dir, 'in/girdiler.json'), '[]')
  const p = new PodmanCalistirici({ url: process.env.HF_PODMAN_URL, kok, imajBul: () => process.env.HF_PODMAN_IMAJ })
  const r = await p.calistir({ taskId: ID, dir, type: 'hf.task.ocr', version: '1.0.0', limits: { ramMB: 512, minutes: 2, diskMB: 64 }, standing: false })
  t.ok(['ok', 'hata'].includes(r.status), 'durum ' + r.status + ' · ' + r.log.slice(-200))
  const ps = spawnSync('podman', ['--remote', '--url=' + process.env.HF_PODMAN_URL, 'ps', '-a', '--format={{.Names}}'])
  t.absent(String(ps.stdout).includes('hf-gorev-' + ID))
  fs.rmSync(kok, { recursive: true, force: true })
})

test('D86, D89: hf.task.vision görevin pod’una katılır (yalnız geri döngü); diğer türler ağsız', (t) => {
  const sp = sahtePodman('ok')
  const p = calistirici(sp)
  const a = p.argumanlar(gorev(sp, { type: 'hf.task.vision', sourceId: 'cd'.repeat(16) }), OCR)
  t.ok(a.includes('--pod=hf-' + ID), 'inceleme 23 madde 3: ad alanı görev kullanıcısının pod’u')
  t.absent(a.some((x) => x.startsWith('--network')), 'pod’un ağı (none) kullanılır')
  t.absent(a.some((x) => /^--(publish|network=host|network=bridge)/.test(x)), 'port yayını ve ev ağı yok')
  t.ok(p.argumanlar(gorev(sp), OCR).includes('--network=none'))
  sp.sil()
})

test('D89: akış pod’u — pod --network=none, sertleştirilmiş sunucu konteyneri; kurulamazsa silinir; süpürme', async (t) => {
  const RTSP = 'localhost/havenfold-rtsp@sha256:' + 'b'.repeat(64)
  const bul = (tur) => (tur === 'havenfold-rtsp' ? RTSP : OCR)
  const sp = sahtePodman('ok')
  const p = calistirici(sp, { imajBul: bul })
  const g = gorev(sp, { type: 'hf.task.vision', sourceId: 'cd'.repeat(16) })
  const r = await p.akisPodKur({ taskId: ID, sourceId: 'cd'.repeat(16), dir: g.dir })
  t.is(r.pod, 'hf-' + ID)
  t.is(r.soket, path.join(g.dir, 'akis', 'akis.sock'))
  t.is((fs.statSync(path.join(g.dir, 'akis')).mode & 0o7777).toString(8), '2770')
  const c = sp.cagrilar()
  const pod = c.find((x) => x.includes('pod') && x.includes('create'))
  t.ok(pod.includes('--network=none'), 'yalnız lo')
  const run = c.find((x) => x.includes('--detach'))
  for (const b of ['--read-only', '--cap-drop=all', '--security-opt=no-new-privileges', '--pod=hf-' + ID, '--pull=never', '--log-driver=none']) t.ok(run.includes(b), b)
  t.absent(run.some((x) => x.startsWith('--network') || x.startsWith('--publish') || x.startsWith('--privileged')), 'inceleme 23 madde 2: ayrıcalıksız, ağsız')
  t.ok(run.includes(RTSP))
  t.is(await hataOf(() => calistirici(sp, { imajBul: () => null }).akisPodKur({ taskId: ID, sourceId: 'cd'.repeat(16), dir: g.dir })), 'NO_RTSP_IMAGE')
  t.is(await hataOf(() => p.akisPodKur({ taskId: '../x', sourceId: 'cd'.repeat(16), dir: g.dir })), 'INVALID_TASK')
  sp.sil()
  // Sunucu başlamazsa pod silinir (madde 8)
  const sp2 = sahtePodman('ok', { SAHTE_SUNUCU: 'hata' })
  const p2 = calistirici(sp2, { imajBul: bul })
  t.is(await hataOf(() => p2.akisPodKur({ taskId: ID, sourceId: 'cd'.repeat(16), dir: gorev(sp2).dir })), 'POD_SETUP_FAILED')
  t.ok(sp2.cagrilar().some((x) => x.includes('pod') && x.includes('rm') && x.includes('hf-' + ID)), 'yarım pod silindi')
  sp2.sil()
  // Süpürme: görevi olmayan akış pod’ları
  const sp3 = sahtePodman('ok', { SAHTE_PODLAR: 'hf-' + ID + ',hf-' + 'ef'.repeat(16) + ',baska' })
  const p3 = calistirici(sp3, { imajBul: bul })
  t.alike(await p3.akisPodlariSupur(new Set([ID])), ['hf-' + 'ef'.repeat(16)])
  t.ok(p3.kancalar().akisPodKur && p3.kancalar().akisPodSil)
  await p3.akisPodSil('x')
  sp3.sil()
})
