// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// `havenfold ilk-ayar` (RFC-0007 §8.3, §9 adım 7): geçici dizinde, taklit TPM ile. Kimlik kalıcı katmanda (worklet
// Kalici) üretilir; ikinci çağrı var olan kimliği bozmaz; birleşik cihazda iki ayrı kimlik; kutu çekirdeği aynı kimliği açar.
const test = require('brittle')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { ilkAyar, hostIdYaz, kullanici, ana } = require('../setup')
const { ana: komut } = require('../command')
const { tpmAc, platformAnahtari, arsivAcik } = require('../box')
const { Kalici } = require('../../worklet/persistence')

function dizin (t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-ilk-ayar-'))
  t.teardown(() => fs.rmSync(d, { recursive: true, force: true }))
  return d
}
const isaret = (kok, rol) => JSON.parse(fs.readFileSync(path.join(kok, 'var/lib/havenfold', rol, 'kimlik'), 'utf8'))

test('kimlik yazılır; ikinci çağrı var olanı bozmaz', (t) => {
  const kok = dizin(t)
  const r1 = ilkAyar({ rol: 'isci', kok, test: true, kokMu: false })
  t.is(r1.kimlikler.length, 1)
  t.is(r1.kimlikler[0].yeni, true)
  t.ok(/^[0-9a-f]{32}$/.test(r1.kimlikler[0].memberId))
  const i = isaret(kok, 'isci')
  t.alike(i, { v: 1, rol: 'isci', memberId: r1.kimlikler[0].memberId, tpm: 'taklit' })
  t.is(fs.statSync(path.join(kok, 'var/lib/havenfold/isci/kimlik')).mode & 0o777, 0o600)
  t.is(fs.statSync(path.join(kok, 'var/lib/havenfold/isci')).mode & 0o777, 0o700)
  t.absent(JSON.stringify(i).includes('secret'), 'işarette sır yok')
  const once = fs.readFileSync(path.join(kok, 'var/lib/havenfold/isci/cekirdek/kimlik'))
  const r2 = ilkAyar({ rol: 'isci', kok, test: true, kokMu: false })
  t.is(r2.kimlikler[0].memberId, r1.kimlikler[0].memberId)
  t.is(r2.kimlikler[0].yeni, false)
  t.is(r2.hostId, r1.hostId, 'hostId değişmez')
  t.alike(fs.readFileSync(path.join(kok, 'var/lib/havenfold/isci/cekirdek/kimlik')), once, 'kimlik dosyası aynen')
})

test('birleşik: önce kutu, sonra işçi; iki ayrı kimlik ve dizin', (t) => {
  const kok = dizin(t)
  const r = ilkAyar({ rol: 'birlesik', kok, test: true, kokMu: false })
  t.alike(r.kimlikler.map((k) => k.rol), ['kutu', 'isci'])
  t.not(r.kimlikler[0].memberId, r.kimlikler[1].memberId)
  t.ok(fs.existsSync(path.join(kok, 'var/lib/havenfold/kutu/platform.muhur')) && fs.existsSync(path.join(kok, 'var/lib/havenfold/isci/platform.muhur')))
})

test('kutu çekirdeğinin kalıcı katmanı aynı kimliği açar', (t) => {
  const kok = dizin(t)
  const r = ilkAyar({ rol: 'kutu', kok, test: true, kokMu: false })
  const a = { dizin: path.join(kok, 'var/lib/havenfold/kutu'), test: true }
  const { tpm } = tpmAc(a)
  const k = new Kalici({ dizin: path.join(a.dizin, 'cekirdek'), anahtar: platformAnahtari(a, tpm), archivePubHex: arsivAcik(a, tpm), platform: 'kutu', appId: 'havenfold-kutu' })
  t.is(Buffer.from(k.kimlik.memberId).toString('hex'), r.kimlikler[0].memberId)
  k.kapat()
})

test('başka kimliği gösteren işaret: dokunulmaz, hata', (t) => {
  const kok = dizin(t)
  ilkAyar({ rol: 'kutu', kok, test: true, kokMu: false })
  const yol = path.join(kok, 'var/lib/havenfold/kutu/kimlik')
  fs.writeFileSync(yol, JSON.stringify({ v: 1, rol: 'kutu', memberId: '00'.repeat(16), tpm: 'taklit' }))
  t.exception(() => ilkAyar({ rol: 'kutu', kok, test: true, kokMu: false }), /IDENTITY_MISMATCH/)
  t.is(JSON.parse(fs.readFileSync(yol, 'utf8')).memberId, '00'.repeat(16))
})

test('--kurulum: yalnız hostId; host.id 16 bayt', (t) => {
  const kok = dizin(t)
  const r = ilkAyar({ kurulum: true, kok, test: true, kokMu: false })
  t.alike(r.kimlikler, [])
  t.is(fs.readFileSync(path.join(kok, 'var/lib/havenfold/denetci/host.id')).byteLength, 16)
  t.absent(fs.existsSync(path.join(kok, 'var/lib/havenfold/isci')))
  t.is(hostIdYaz({ kok }).hostId, r.hostId)
  fs.writeFileSync(path.join(kok, 'var/lib/havenfold/denetci/host.id'), 'kisa')
  t.exception(() => hostIdYaz({ kok }), /HOST_ID_CORRUPT/)
})

test('komut kancası: kullanım, yetki, test kipi; passwd ayrıştırma', async (t) => {
  const kok = dizin(t)
  const satirlar = []
  const yaz = (s) => satirlar.push(s)
  t.is(await ana(['--rol', 'kok'], { yaz, env: {} }), 1)
  t.is(await ana(['--rol', 'isci'], { yaz, env: {}, getuid: () => 1000 }), 2, 'kök değil, test kipi değil')
  t.is(await ana(['--rol', 'isci'], { yaz, env: { HF_KOK: kok, HF_TEST_KIPI: '1' }, getuid: () => 1000 }), 0)
  t.ok(satirlar.some((s) => s.startsWith('İşçi kimliği ')))
  const eski = { k: process.env.HF_KOK, t: process.env.HF_TEST_KIPI, i: process.env.INVOCATION_ID }
  process.env.HF_KOK = kok
  process.env.HF_TEST_KIPI = '1'
  delete process.env.INVOCATION_ID // test süreci systemd altındaki bir CI çalıştırıcısından gelmiş olabilir
  t.teardown(() => {
    for (const [ad, v] of [['HF_KOK', eski.k], ['HF_TEST_KIPI', eski.t], ['INVOCATION_ID', eski.i]]) { if (v === undefined) delete process.env[ad]; else process.env[ad] = v }
  })
  t.is(await komut(['ilk-ayar', '--rol', 'isci'], { yaz }), 0, 'havenfold ilk-ayar command.js üstünden')
  // İngilizce ana bayraklar (--role, --install); eskileri takma ad (Codex 12. tur)
  t.is(await komut(['setup', '--role', 'kutu'], { yaz }), 0, 'havenfold setup --role')
  t.ok(fs.existsSync(path.join(kok, 'var/lib/havenfold/kutu/kimlik')), '--role ile kutu kimliği')
  t.is(await ana(['--install'], { yaz, env: { HF_KOK: kok, HF_TEST_KIPI: '1' }, getuid: () => 1000 }), 0, '--install')
  const p = path.join(kok, 'passwd')
  fs.writeFileSync(p, 'root:x:0:0:root:/root:/bin/bash\nhavenfold-kutu:x:998:997::/var/lib/havenfold/kutu:/usr/sbin/nologin\n')
  t.alike(kullanici('havenfold-kutu', p), { uid: 998, gid: 997 })
  t.is(kullanici('yok', p), null)
})

// Açılış güvenlik incelemesi madde 4: kök, rol ve denetçi dizinlerinde bırakılmış bağları izlemez
const { sahiplikVer, atomikYaz } = require('../setup')
const disari = (t) => { const d = dizin(t); fs.writeFileSync(path.join(d, 'hedef'), 'dokunulmamali'); return d }
const bos = (d) => fs.readdirSync(d).filter((x) => x !== 'hedef').length === 0 && fs.readFileSync(path.join(d, 'hedef'), 'utf8') === 'dokunulmamali'

test('sembolik bağ tuzakları: rol dizini, alt dizin, işaret, derin dosya, üst dizin, host.id reddedilir', (t) => {
  const tuzaklar = {
    'rol dizini bağ': (kok, dis) => { fs.mkdirSync(path.join(kok, 'var/lib/havenfold'), { recursive: true }); fs.symlinkSync(dis, path.join(kok, 'var/lib/havenfold/isci')) },
    'pay bağ': (kok, dis) => { fs.mkdirSync(path.join(kok, 'var/lib/havenfold/isci'), { recursive: true }); fs.symlinkSync(dis, path.join(kok, 'var/lib/havenfold/isci/pay')) },
    'kimlik işareti bağ': (kok, dis) => { fs.mkdirSync(path.join(kok, 'var/lib/havenfold/isci'), { recursive: true }); fs.symlinkSync(path.join(dis, 'hedef'), path.join(kok, 'var/lib/havenfold/isci/kimlik')) },
    'platform.muhur bağ': (kok, dis) => { fs.mkdirSync(path.join(kok, 'var/lib/havenfold/isci'), { recursive: true }); fs.symlinkSync(path.join(dis, 'hedef'), path.join(kok, 'var/lib/havenfold/isci/platform.muhur')) },
    'cekirdek içinde bağ': (kok, dis) => { fs.mkdirSync(path.join(kok, 'var/lib/havenfold/isci/cekirdek'), { recursive: true }); fs.symlinkSync(path.join(dis, 'hedef'), path.join(kok, 'var/lib/havenfold/isci/cekirdek/kimlik')) },
    'havenfold üst dizini bağ': (kok, dis) => { fs.mkdirSync(path.join(kok, 'var/lib'), { recursive: true }); fs.symlinkSync(dis, path.join(kok, 'var/lib/havenfold')) }
  }
  for (const [ad, kur] of Object.entries(tuzaklar)) {
    const kok = dizin(t)
    const dis = disari(t)
    kur(kok, dis)
    t.exception(() => ilkAyar({ rol: 'isci', kok, test: true, kokMu: false }), /SEMBOLIK_BAG/, ad)
    t.ok(bos(dis), ad + ': bağın hedefi değişmedi')
  }
  // host.id bağ: okunmaz, yazılmaz
  const kok = dizin(t)
  const dis = disari(t)
  fs.writeFileSync(path.join(dis, 'hedef'), 'dokunulmamali') // 13 bayt; 16 olsaydı da okunmamalı
  fs.mkdirSync(path.join(kok, 'var/lib/havenfold/denetci'), { recursive: true })
  fs.symlinkSync(path.join(dis, 'hedef'), path.join(kok, 'var/lib/havenfold/denetci/host.id'))
  t.exception(() => hostIdYaz({ kok }), /SEMBOLIK_BAG/, 'host.id bağ')
  t.ok(bos(dis))
})

test('sabit bağ ve FIFO reddedilir; atomikYaz bağı izlemez, yerini alır', (t) => {
  const kok = dizin(t)
  const dis = disari(t)
  fs.mkdirSync(path.join(kok, 'var/lib/havenfold/isci'), { recursive: true })
  fs.linkSync(path.join(dis, 'hedef'), path.join(kok, 'var/lib/havenfold/isci/kimlik'))
  t.exception(() => ilkAyar({ rol: 'isci', kok, test: true, kokMu: false }), /SABIT_BAG/)
  t.ok(bos(dis))
  const kok2 = dizin(t)
  fs.mkdirSync(path.join(kok2, 'var/lib/havenfold/kutu'), { recursive: true })
  const r = require('child_process').spawnSync('mkfifo', [path.join(kok2, 'var/lib/havenfold/kutu/fifo')])
  if (r.status === 0) t.exception(() => ilkAyar({ rol: 'kutu', kok: kok2, test: true, kokMu: false }), /DOSYA_TURU/, 'FIFO okunmaya çalışılmaz')
  else t.comment('mkfifo yok; FIFO denemesi atlandı')
  const bag = path.join(kok, 'bag')
  fs.symlinkSync(path.join(dis, 'hedef'), bag)
  atomikYaz(bag, 'yeni')
  t.ok(bos(dis), 'hedef dosyaya yazılmadı')
  t.ok(fs.lstatSync(bag).isFile() && fs.readFileSync(bag, 'utf8') === 'yeni', 'bağın yerine yeni dosya')
})

test('kökken sahiplik: yukarıdan aşağı alınır, aşağıdan yukarı verilir; ağaç dışına çıkılmaz', (t) => {
  const kok = dizin(t)
  const passwd = path.join(kok, 'passwd')
  fs.writeFileSync(passwd, 'havenfold-isci:x:4242:4243::/var/lib/havenfold/isci:/usr/sbin/nologin\nhavenfold-denetci:x:4244:4245::/:/usr/sbin/nologin\n')
  const kayit = []
  const izin = { lchown: (p, u, g) => kayit.push(['chown', p, u, g]), chmod: (p, m) => kayit.push(['chmod', p, m]), kokUid: process.getuid() }
  ilkAyar({ rol: 'isci', kok, test: true, kokMu: true, passwd, izin })
  const rolDizini = path.join(kok, 'var/lib/havenfold/isci')
  t.ok(kayit.every(([, p]) => p.startsWith(kok + path.sep)), 'yalnız kök önekinin altı')
  const ver = kayit.filter(([op, , u]) => op === 'chown' && u === 4242).map(([, p]) => p)
  const al = kayit.filter(([op, p, u]) => op === 'chown' && u === izin.kokUid && p.startsWith(rolDizini)).map(([, p]) => p)
  t.is(al[0], rolDizini, 'önce rol dizini köke alınır')
  t.ok(kayit.findIndex(([op, p]) => op === 'chmod' && p === rolDizini) > kayit.findIndex(([op, p]) => op === 'chown' && p === rolDizini), 'sonra 0700')
  t.is(ver[ver.length - 1], rolDizini, 'rol dizini en son verilir')
  for (const [i, p] of ver.entries()) t.ok(ver.slice(i + 1).every((q) => !q.startsWith(p + path.sep)), 'aşağıdan yukarı: ' + path.relative(kok, p))
  t.ok(ver.includes(path.join(rolDizini, 'cekirdek/kimlik')) && ver.includes(path.join(rolDizini, 'kimlik')), 'içerik de verilir')
  // host.id denetçiye; denetçi dizini (bu çağrıda kuruldu) kökte kalır, ikinci çağrıda önceki sahibine döner
  t.ok(kayit.some(([op, p, u]) => op === 'chown' && p.endsWith('denetci/host.id') && u === 4244))
  kayit.length = 0
  hostIdYaz({ kok, kokMu: true, passwd, izin })
  const d = path.join(kok, 'var/lib/havenfold/denetci')
  t.alike(kayit.filter(([, p]) => p === d).map(([op, , a]) => op + ':' + a), ['chown:' + izin.kokUid, 'chmod:' + 0o700, 'chown:' + fs.lstatSync(d).uid, 'chmod:' + (fs.lstatSync(d).mode & 0o7777)], 'denetçi dizini alınır, sonra önceki sahibine ve iznine döner')
})

test('sahiplikVer: bağda durur (sıkı) ya da atlar; kökün olmayan dizine inmez', (t) => {
  const kok = dizin(t)
  const dis = disari(t)
  const passwd = path.join(kok, 'passwd')
  fs.writeFileSync(passwd, 'havenfold-kutu:x:4242:4243::/:/usr/sbin/nologin\n')
  const r = path.join(kok, 'rol')
  fs.mkdirSync(path.join(r, 'alt'), { recursive: true })
  fs.writeFileSync(path.join(r, 'alt/dosya'), 'x')
  fs.symlinkSync(dis, path.join(r, 'alt/bag'))
  const kayit = []
  const izin = { lchown: (p) => kayit.push(p), chmod: () => {}, kokUid: process.getuid() }
  t.exception(() => sahiplikVer(r, 'havenfold-kutu', { kokMu: true, passwd, izin }), /SEMBOLIK_BAG/)
  kayit.length = 0
  sahiplikVer(r, 'havenfold-kutu', { kokMu: true, passwd, izin, siki: false })
  t.ok(!kayit.includes(path.join(r, 'alt/bag')) && kayit.every((p) => p.startsWith(r)), 'bağa ve hedefine dokunulmaz')
  t.ok(bos(dis))
  kayit.length = 0
  sahiplikVer(r, 'havenfold-kutu', { kokMu: true, passwd, izin: { ...izin, kokUid: process.getuid() + 1 }, siki: false })
  t.alike(kayit, [], 'kökün olmayan dizinin girdileri değişebilir: inilmez')
})

test('TPM\'siz işçi (açılış öncesi inceleme): kimlik işçinin TPM\'siz anahtar yoluyla; işçi aynı kimliği açar; kutu TPM ister', (t) => {
  const kok = dizin(t)
  const tpmYok = () => { throw new Error('NO_TPM') }
  const r = ilkAyar({ rol: 'isci', kok, kokMu: false, tpmAc: tpmYok })
  t.is(r.kimlikler[0].tpm, 'yok')
  t.alike(isaret(kok, 'isci'), { v: 1, rol: 'isci', memberId: r.kimlikler[0].memberId, tpm: 'yok' })
  // İşçi açılınca aynı dosyalardan aynı kimlik (worker.js anahtarlariAc → tpmsizAnahtarlar)
  const { tpmsizAnahtarlar } = require('../worker')
  const { Kalici } = require('../../worklet/persistence')
  const d = path.join(kok, 'var/lib/havenfold/isci')
  const pa = tpmsizAnahtarlar({ dizin: d })
  const k = new Kalici({ dizin: path.join(d, 'cekirdek'), anahtar: pa.anahtar, archivePubHex: pa.archivePubHex, platform: 'isci', appId: 'havenfold-isci' })
  t.is(Buffer.from(k.kimlik.memberId).toString('hex'), r.kimlikler[0].memberId)
  k.kapat()
  t.exception(() => ilkAyar({ rol: 'kutu', kok, kokMu: false, tpmAc: tpmYok }), /NO_TPM/, 'kutu TPM\'siz kurulmaz')
  // TPM aygıtı varken TPM komutu hata verirse şifresiz dosyaya düşülmez (geçici hata, kilit, bozuk mühür)
  const kok2 = dizin(t)
  fs.mkdirSync(path.join(kok2, 'dev'), { recursive: true })
  fs.writeFileSync(path.join(kok2, 'dev/tpmrm0'), '')
  t.exception(() => ilkAyar({ rol: 'isci', kok: kok2, kokMu: false, tpmAc: tpmYok }), /NO_TPM/, 'aygıt var: hata yukarı çıkar')
  t.absent(fs.existsSync(path.join(kok2, 'var/lib/havenfold/isci/platform.anahtar')), 'şifresiz anahtar yazılmadı')
  // Var olan kurulumun yolu değişmez: TPM'siz kurulmuş işçi aygıt sonradan görünse de dosyasını kullanır
  fs.mkdirSync(path.join(kok, 'dev'), { recursive: true })
  fs.writeFileSync(path.join(kok, 'dev/tpmrm0'), '')
  t.is(ilkAyar({ rol: 'isci', kok, kokMu: false, tpmAc: tpmYok }).kimlikler[0].memberId, r.kimlikler[0].memberId)
})
