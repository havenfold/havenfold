// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Giriş dosyaları ve paket düzeni (RFC-0007 §4, §5; sınırlar madde 11): birimlerin ExecStart yolları paket düzeninde
// var (çekirdekler Node ile); girişler paketteki lib'den yüklenir; denetçi girişi ve yönetim soketinin tek yolu; işçi yürütücüsü denetçi ve
// sahte podman üstünden görevi uçtan uca çalıştırır; yardımcının soketsiz işlemleri (deneme, pil).
const test = require('brittle')
const fs = require('fs')
const os = require('os')
const path = require('path')
const b4a = require('b4a')
const { spawn, spawnSync } = require('child_process')
const { denetciyiBaslat } = require('../supervisor-main')
const { isciyiBaslat, gorevYurut, ayarlar: isciAyarlari } = require('../worker')
const { PodmanCalistirici } = require('../podman')
const Y = require('../privilege-main')
const komut = require('../command')
const { YONETIM_SOKETI } = komut
const { sahtePodman } = require('./helpers/fake-podman')

const DEPO = path.join(__dirname, '../..')
const OCR = 'localhost/hf-task-ocr@sha256:' + 'a'.repeat(64)
const URL = 'unix:///run/havenfold/podman/podman.sock'
const hataOf = async (fn) => { try { await fn(); return null } catch (err) { return err.message } }
const bekle = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function paketle () {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-paket-'))
  const hedef = path.join(d, 'surum')
  const r = spawnSync('bash', [path.join(DEPO, 'node/scripts/pack.sh'), hedef, '--bagla'], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error('paketle: ' + r.stderr)
  return { hedef, sil: () => fs.rmSync(d, { recursive: true, force: true }) }
}

// Kurulu düğümün taklidi: rol, dizinler, kimlik dosyası
function kokKur (rol = 'isci') {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'h')) // kısa: Unix soket yolu macOS'ta en çok 104 bayt
  for (const d of ['etc/havenfold', 'var/lib/havenfold/denetci', 'var/lib/havenfold/isci', 'run/havenfold/denetci', 'run/havenfold/denetci-yonetim', 'run/havenfold/gorev']) fs.mkdirSync(path.join(kok, d), { recursive: true })
  fs.writeFileSync(path.join(kok, 'etc/havenfold/dugum.toml'), `rol = "${rol}"\nkanal = "kararli"\n\n[pil]\nbaslangic = 55\nbitis = 75\n`)
  fs.writeFileSync(path.join(kok, 'var/lib/havenfold/isci/kimlik'), 'x')
  return kok
}

// Süreç çıktısında satır bekler
function satirBekle (cocuk, re, ms = 15000) {
  return new Promise((resolve, reject) => {
    let birikim = ''
    const z = setTimeout(() => reject(new Error('TIMEOUT: ' + birikim)), ms)
    const al = (p) => { birikim += p; if (re.test(birikim)) { clearTimeout(z); resolve(birikim) } }
    cocuk.stdout.on('data', al)
    cocuk.stderr.on('data', al)
    cocuk.once('exit', (kod) => { clearTimeout(z); reject(new Error('CIKTI (' + kod + '): ' + birikim)) })
  })
}
const cikisBekle = (cocuk) => new Promise((resolve) => cocuk.once('exit', (kod) => resolve(kod)))

test('paket düzeni: her birimin ExecStart yolları pakette var (RFC-0007 §5)', (t) => {
  const p = paketle()
  const birimler = fs.readdirSync(path.join(DEPO, 'node/systemd')).filter((f) => f.endsWith('.service'))
  let n = 0
  for (const b of birimler) {
    const s = fs.readFileSync(path.join(DEPO, 'node/systemd', b), 'utf8')
    const satir = /^ExecStart=(.+)$/m.exec(s)
    t.ok(satir, b + ': ExecStart')
    for (const parca of satir[1].split(/\s+/).filter((x) => x.startsWith('/'))) {
      let yerel = null
      if (parca.startsWith('/opt/havenfold/guncel/')) yerel = path.join(p.hedef, parca.slice('/opt/havenfold/guncel/'.length))
      if (parca.startsWith('/usr/lib/havenfold/yetki/')) yerel = path.join(p.hedef, 'yetki', parca.slice('/usr/lib/havenfold/yetki/'.length))
      t.ok(yerel, b + ': yol paketin içinde: ' + parca)
      t.ok(yerel && fs.existsSync(yerel), b + ': ' + parca)
      n++
    }
  }
  t.ok(birimler.length >= 8 && n >= 15, 'bütün birimler tarandı')
  // Bare desteği İstek 151'e kadar Node: çekirdek birimleri paketteki node ile
  for (const rol of ['kutu', 'isci']) {
    const s = fs.readFileSync(path.join(DEPO, 'node/systemd/havenfold-' + rol + '.service'), 'utf8')
    t.ok(s.includes('\nExecStart=/opt/havenfold/guncel/node /opt/havenfold/guncel/cekirdek/' + rol + '.js\n'), rol + ': Node ile')
    t.ok(/Bare desteği İstek 151'e kadar Node/.test(s), rol + ': birimde not')
  }
  // deploy/havenfold-kutu-ubuntu.service havenfold-install-sudo.sh'in düzenine göredir (bin/node, node/box.js); bu düzen değil
  for (const f of ['node/bundle/cekirdek/kutu.js', 'node/bundle/cekirdek/isci.js', 'node/bundle/denetci/ana.js', 'node/bundle/yetki/ana.js', 'node/bundle/bin/havenfold']) {
    t.ok(/SPDX-License-Identifier: MPL-2.0/.test(fs.readFileSync(path.join(DEPO, f), 'utf8').split('\n').slice(0, 2).join('\n')), 'SPDX: ' + f)
  }
  p.sil()
})

test('girişler paketteki lib\'den yüklenir: yardımcı, komut, çekirdek girişlerinin hedefleri', async (t) => {
  const p = paketle()
  const node = path.join(p.hedef, 'node')
  const y1 = spawnSync(path.join(p.hedef, 'yetki/node'), [path.join(p.hedef, 'yetki/ana.js'), 'deneme-denetle'], { encoding: 'utf8' })
  if (process.getuid() !== 0) t.alike([y1.status, /UNAUTHORIZED/.test(y1.stderr)], [2, true], 'kök olmayan: YETKISIZ')
  const y2 = spawnSync(node, [path.join(p.hedef, 'yetki/ana.js')], { encoding: 'utf8' })
  // Soket kipi (RFC-0033 §9 l): yalnız kök ve systemd'nin verdiği soketle
  if (process.getuid() !== 0) t.alike([y2.status, /UNAUTHORIZED/.test(y2.stderr)], [2, true], 'soket kipi: kök olmayan YETKISIZ')
  else t.alike([y2.status, /NO_SOCKET/.test(y2.stderr)], [3, true], 'soket kipi: systemd soketi yoksa NO_SOCKET')
  const y3 = spawnSync(node, [path.join(p.hedef, 'yetki/ana.js'), 'paket-ac'], { encoding: 'utf8' })
  t.is(y3.status, 1, 'liste dışı işlem komut satırından yok')
  const k = spawnSync('sh', [path.join(p.hedef, 'bin/havenfold'), 'bilinmeyen'], { encoding: 'utf8' })
  t.is(k.status, 1, 'bin/havenfold paketteki node ve lib/node/bin/havenfold ile çalışır (kullanım hatası)')
  for (const [giris, hedef] of [['cekirdek/kutu.js', 'lib/node/box.js'], ['cekirdek/isci.js', 'lib/node/worker.js'], ['denetci/ana.js', 'lib/node/supervisor-main.js']]) {
    const s = fs.readFileSync(path.join(p.hedef, giris), 'utf8')
    const m = /require\('(\.\.\/lib\/node\/[a-z-]+)'\)/.exec(s)
    t.ok(m, giris)
    t.is(require.resolve(path.join(p.hedef, path.dirname(giris), m[1])), fs.realpathSync(path.join(p.hedef, hedef)), giris + ' → ' + hedef)
  }
  const ana = require(path.join(p.hedef, 'lib/node/box.js')).ana
  t.is(typeof ana, 'function', 'box.js ana() dışa verir')
  p.sil()
})

test('denetçi ve işçi girişleri: işçi soketi, yönetim soketi ve havenfold durum; işçi denetçiye bağlanır; SIGTERM ile kapanır', async (t) => {
  const p = paketle()
  const kok = kokKur('isci')
  const sp = sahtePodman('ok')
  const ortam = { ...sp.ortam, HF_KOK: kok, HF_PODMAN_URL: URL }
  const den = spawn(path.join(p.hedef, 'node'), [path.join(p.hedef, 'denetci/ana.js')], { env: ortam })
  const d = await satirBekle(den, /başladı/)
  t.ok(/SO_PEERCRED yok/.test(d), 'dosya izni uyarısı')
  t.ok(/roller isci/.test(d))
  t.is(fs.statSync(path.join(kok, 'var/lib/havenfold/denetci/host.id')).size, 16, 'host.id üretildi')
  t.is(fs.statSync(path.join(kok, 'run/havenfold/denetci/isci.sock')).mode & 0o777, 0o666, 'erişimi dizin izni sınırlar')
  t.absent(fs.existsSync(path.join(kok, 'run/havenfold/denetci/kutu.sock')), 'kutu kimliği yok: kutu soketi yok')
  t.is(fs.statSync(path.join(kok, YONETIM_SOKETI.denetci)).mode & 0o777, 0o660, 'yönetim soketi 0660')
  // `havenfold durum`: command.js'in bağlantısı, soket yolları YONETIM_SOKETI'nden (kök önekiyle)
  const { baglan } = require('../ipc/socket')
  const { cerceveYaz, mesajCoz, CerceveOkuyucu } = require('../ipc/frame')
  const istek = async (kapsam, type, mesaj) => {
    const s = await baglan(path.join(kok, YONETIM_SOKETI[kapsam]))
    const ok = new CerceveOkuyucu()
    s.write(cerceveYaz(type, 1, mesaj))
    return new Promise((resolve, reject) => {
      s.on('data', (x) => { for (const b of ok.besle(x)) { s.destroy(); resolve(mesajCoz(b)) } })
      s.on('error', reject)
    })
  }
  const yazilan = []
  t.is(await komut.ana(['durum'], { baglanti: { istek }, yaz: (x) => yazilan.push(x) }), 0)
  t.ok(/Sürüm 0\.0\.0 · kanal kararli/.test(yazilan.join('\n')) && /Uyarılar: SO_PEERCRED yok/.test(yazilan.join('\n')), 'denetçinin durumu yönetim soketinden')
  // İşçi denetçiye bağlanır (MERHABA, SAGLIK_ANLIK); ilk ayarın kimlik işareti bozuk: ağ açılmadan çıkar
  const isci = spawn(path.join(p.hedef, 'node'), [path.join(p.hedef, 'cekirdek/isci.js')], { env: ortam })
  let ic = ''
  isci.stderr.on('data', (x) => { ic += x })
  t.is(await cikisBekle(isci), 1)
  t.ok(/başlatılamadı: IDENTITY_MARKER_CORRUPT/.test(ic), 'bozuk ilk ayar işaretiyle ağ açılmaz')
  den.kill('SIGTERM')
  t.is(await cikisBekle(den), 0, 'denetçi düzgün kapandı')
  fs.rmSync(kok, { recursive: true, force: true })
  sp.sil()
  p.sil()
})

test('yönetim soketi tek yol: komut, bin/havenfold, denetçi, kutu, tmpfiles ve birim aynı (RFC-0007 §6.1, RFC-0026 f)', (t) => {
  t.alike(YONETIM_SOKETI, { kutu: '/run/havenfold/kutu/yonetim.sock', isci: '/run/havenfold/isci/yonetim.sock', denetci: '/run/havenfold/denetci-yonetim/yonetim.sock' })
  const bin = fs.readFileSync(path.join(DEPO, 'node/bin/havenfold'), 'utf8')
  t.ok(/YONETIM_SOKETI\[kapsam\]/.test(bin) && !bin.includes('/run/havenfold'), 'bin/havenfold yolu yazmaz, command.js\'ten alır')
  t.is(require('../box').ayarlar({}).soket, YONETIM_SOKETI.kutu, 'kutu çekirdeğinin varsayılanı')
  t.ok(fs.readFileSync(path.join(DEPO, 'node/supervisor-main.js'), 'utf8').includes('YONETIM_SOKETI.denetci'), 'denetçi aynı tanımı kullanır')
  const tmp = fs.readFileSync(path.join(DEPO, 'node/deploy/tmpfiles.conf'), 'utf8').split('\n').map((x) => x.split(/\s+/))
  const dizin = (y) => (tmp.find((x) => x[1] === y) || []).slice(2, 5)
  for (const [kapsam, grup] of [['kutu', 'havenfold-yonetim'], ['isci', 'havenfold-yonetim'], ['denetci', 'havenfold-yonetim']]) {
    t.is(dizin(path.dirname(YONETIM_SOKETI[kapsam]))[2], grup, kapsam + ': dizinin grubu yönetim')
  }
  t.is(dizin('/run/havenfold/denetci')[2], 'havenfold-cekirdek', 'çekirdeklere bakan dizin ayrı')
  t.is(dizin(path.dirname(YONETIM_SOKETI.denetci))[0], '2750', 'denetçi yönetim grubunda değil: soketin grubu setgid dizinden')
  t.absent(fs.readFileSync(path.join(DEPO, 'node/supervisor-main.js'), 'utf8').includes('chownSync'), 'denetçi soketin grubunu değiştirmeye çalışmaz')
  t.ok(fs.readFileSync(path.join(DEPO, 'node/systemd/havenfold-denetci.service'), 'utf8').includes(' ' + path.dirname(YONETIM_SOKETI.denetci) + ' '), 'denetçi birimi yazabilir')
})

test('işçi yürütücüsü uçtan uca: hazırla, girdiler (0640), başlat, çıktılar, temizle; düz girdi sıfırlanır', async (t) => {
  const kok = kokKur('isci')
  const sp = sahtePodman('ok')
  const calistirici = new PodmanCalistirici({ url: URL, kok, cekirdek: 2, ramMB: 4096, imajBul: () => OCR, ortam: sp.ortam })
  const k = await denetciyiBaslat({ kok }, { calistirici, kimlikBul: () => 'havenfold-isci' })
  const w = await isciyiBaslat(isciAyarlari({ HF_KOK: kok }), { ag: false })
  const girdi = b4a.from('%PDF-1.7 düz içerik')
  const params = b4a.from(JSON.stringify({ langs: ['tur'], output: 'text' }))
  const r = await gorevYurut(w.istemci, { taskId: 'cd'.repeat(16), type: 'hf.task.ocr', version: '1.0.0', limits: { ramMB: 512, minutes: 1, diskMB: 64 }, params, girdiler: [{ mime: 'application/pdf', bytes: girdi }] }, { kok })
  t.alike([r.ok, r.status, r.exitCode], [true, 'ok', 0])
  const cikti = Object.fromEntries(r.ciktilar.map((x) => [x.ad, b4a.toString(x.bytes)]))
  t.is(cikti['metin.txt'], 'tamam')
  t.alike(JSON.parse(cikti['girdiler.json']), [{ ad: '0', mime: 'application/pdf', size: girdi.byteLength }], 'girdi listesi')
  t.alike(JSON.parse(cikti['izinler.json']), { params: '640', sifir: '640', paramsIcerik: b4a.toString(params) }, 'konteyner grubu okuyabilir; params olduğu gibi')
  t.ok(girdi.every((x) => x === 0), 'düz girdi bellekte sıfırlandı')
  await bekle(100)
  t.alike(fs.readdirSync(path.join(kok, 'run/havenfold/gorev')), [], 'GOREV_TEMIZLE dizini sildi')
  const red = await gorevYurut(w.istemci, { taskId: 'ef'.repeat(16), type: 'hf.task.ocr', version: '1.0.0', limits: { ramMB: 9000, minutes: 1, diskMB: 64 }, girdiler: [] }, { kok })
  t.alike(red, { ok: false, code: 'NO_SOURCE' })
  t.is(await hataOf(() => gorevYurut(w.istemci, { taskId: '01'.repeat(16), type: 'hf.task.backup', version: '1.0.0', limits: { ramMB: 64, minutes: 1, diskMB: 1 }, girdiler: [] }, { kok })), 'BUILTIN_TASK')
  w.kapat()
  await k.kapat()
  fs.rmSync(kok, { recursive: true, force: true })
  sp.sil()
})

test('denetçi açılışı: birleşik düğümde SO_PEERCRED olmadan açılmaz; rol denetimi; denetçisiz işçi açılmaz', async (t) => {
  const kok = kokKur('birlesik')
  const sp = sahtePodman('ok')
  const calistirici = new PodmanCalistirici({ url: URL, kok, imajBul: () => OCR, ortam: sp.ortam })
  t.is(await hataOf(() => denetciyiBaslat({ kok }, { calistirici, uyar: () => {} })), 'NO_PEERCRED')
  const k = await denetciyiBaslat({ kok }, { calistirici, kimlikBul: () => 'havenfold-kutu' })
  t.alike(k.roller, ['kutu', 'isci'])
  t.ok(fs.existsSync(path.join(kok, 'run/havenfold/denetci/kutu.sock')) && fs.existsSync(path.join(kok, 'run/havenfold/denetci/isci.sock')))
  await k.kapat()
  fs.writeFileSync(path.join(kok, 'etc/havenfold/dugum.toml'), 'rol = "her-sey"\n')
  t.is(await hataOf(() => denetciyiBaslat({ kok }, { calistirici })), 'INVALID_NODE_ROLE')
  t.ok(await hataOf(() => isciyiBaslat(isciAyarlari({ HF_KOK: kok }), { ag: false, bekleMs: 200 })), 'denetçi yoksa işçi açılmaz')
  fs.rmSync(kok, { recursive: true, force: true })
  sp.sil()
})

test('yardımcı: pil eşiği dugum.toml\'dan sysfs\'e; deneme denetimi; kullanım ve yetki', async (t) => {
  const kok = kokKur('isci')
  const ps = path.join(kok, 'sys/class/power_supply')
  fs.mkdirSync(path.join(ps, 'BAT0'), { recursive: true })
  fs.mkdirSync(path.join(ps, 'BAT1'), { recursive: true })
  fs.mkdirSync(path.join(ps, 'AC'), { recursive: true })
  for (const f of ['BAT0/charge_control_start_threshold', 'BAT0/charge_control_end_threshold', 'BAT1/charge_control_end_threshold']) fs.writeFileSync(path.join(ps, f), '100')
  t.alike(Y.pilAyari(kok), { start: 55, stop: 75 })
  const cikti = []
  t.is(await Y.ana(['pil-uygula'], { kok, kokMu: () => true, yaz: (s) => cikti.push(s), hataYaz: () => {} }), 0)
  t.alike(JSON.parse(cikti[0]), { limit: 'cekirdek', start: 55, stop: 75 })
  t.alike(['BAT0/charge_control_start_threshold', 'BAT0/charge_control_end_threshold', 'BAT1/charge_control_end_threshold'].map((f) => fs.readFileSync(path.join(ps, f), 'utf8')), ['55', '75', '75'], 'yalnız bitiş varsa yalnız bitiş')
  t.alike(Y.pilYazici(path.join(kok, 'yok'))({ start: 60, stop: 80 }), { limit: 'yok' })
  t.alike(Y.pilAyari(path.join(kok, 'yok')), { start: 60, stop: 80 }, 'ayar yoksa kurucu §9.3')
  t.is(await Y.ana(['deneme-denetle', '--acilis'], { kok, kokMu: () => true, yaz: (s) => cikti.push(s), hataYaz: () => {} }), 0)
  t.alike(JSON.parse(cikti[1]), { durum: 'yok' }, 'deneme kaydı yoksa hemen biter')
  const hatalar = []
  t.is(await Y.ana(['deneme-denetle'], { kok, kokMu: () => false, hataYaz: (s) => hatalar.push(s) }), 2)
  t.is(await Y.ana(['deneme-denetle', '--simdi'], { kok, kokMu: () => true, hataYaz: (s) => hatalar.push(s) }), 1)
  t.is(await Y.ana(['surum-gec'], { kok, kokMu: () => true, hataYaz: (s) => hatalar.push(s) }), 1)
  t.is(await Y.ana([], { kok, kokMu: () => false, hataYaz: (s) => hatalar.push(s) }), 2, 'soket kipi yalnız kök')
  t.is(await Y.ana([], { kok, kokMu: () => true, ortam: {}, hataYaz: (s) => hatalar.push(s) }), 3, 'systemd soketi yoksa')
  t.ok(/UNAUTHORIZED/.test(hatalar[0]) && /UNAUTHORIZED/.test(hatalar.at(-2)) && /NO_SOCKET/.test(hatalar.at(-1)))
  fs.rmSync(kok, { recursive: true, force: true })
})

test('Codex 12. tur: kutu disk şifrelemesini denetçiyle aynı kaynaktan bildirir (LUKS + TPM bağı)', (t) => {
  const { ayarlar } = require('../box')
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-kutu-disk-'))
  t.teardown(() => fs.rmSync(kok, { recursive: true, force: true }))
  t.is(ayarlar({}, { kok }).disk, 'sifresiz', 'crypttab yok')
  fs.mkdirSync(path.join(kok, 'etc/havenfold'), { recursive: true })
  fs.mkdirSync(path.join(kok, 'dev'))
  fs.writeFileSync(path.join(kok, 'etc/crypttab'), '# yorum\ndm_crypt-0 UUID=x none luks\n')
  fs.writeFileSync(path.join(kok, 'etc/havenfold/disk-sifreleme'), 'luks-tpm\n')
  fs.writeFileSync(path.join(kok, 'dev/tpmrm0'), '')
  t.is(ayarlar({}, { kok }).disk, 'luks-tpm', 'USB ile şifreli kurulan kutu "disk şifresiz" demez')
  fs.writeFileSync(path.join(kok, 'etc/havenfold/disk-sifreleme'), 'luks\n')
  t.is(ayarlar({}, { kok }).disk, 'sifresiz', 'TPM bağsız LUKS denetçideki gibi şifresiz sayılır')
})
