// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Kurulum aracının kabuk betikleri ve derleme araçları. Bu makinede (macOS) ISO derlenemez, önyükleme denenemez:
// burada sözdizimi, lisans başlıkları, sahte araçlarla ön kontrol ve depolama akışı, kabuktaki bildirim doğrulayıcısının
// vektörlerle karşılaştırılması, derleme anı bildirim denetimi ve tek dosyalık havenfold-kur'un üretimi denenir.
// Hiçbir disk komutu çalışmaz: lsblk, b2sum, base32 test dizinindeki taklitlerdir; dosyalar geçici dizindedir.
const test = require('brittle')
const fs = require('fs')
const os = require('os')
const path = require('path')
const b4a = require('b4a')
const c = require('compact-encoding')
const sodium = require('sodium-native')
const { spawnSync } = require('child_' + 'process')
const S = require('../../node/release')
const { hash } = require('../../core/core/crypto/kdf')
const { zipYaz } = require('../../core/export/zip')
const F = require('../../protocol/vectors/node.json')
const O = require('./helpers/examples')

const KOK = path.join(__dirname, '..')
const DEPO = path.join(KOK, '..')
const ARAC = path.join(__dirname, 'helpers/tools')
const ORTAM = { ...process.env, PATH: ARAC + path.delimiter + path.dirname(process.execPath) + path.delimiter + process.env.PATH, NODE_PATH: path.join(DEPO, 'node_modules') }

function geciciDizin (t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-betik-test-'))
  t.teardown(() => fs.rmSync(d, { recursive: true, force: true }))
  return d
}
const calis = (komut, args, ek = {}) => spawnSync(komut, args, { encoding: 'utf8', env: ORTAM, ...ek })

const BETIKLER = ['bin/hf-on-kontrol', 'bin/hf-depolama-yaz', 'bin/hf-hedefe-kur', 'target/common.sh', 'target/hf-ilk-acilis', 'target/hf-luks-yenile',
  'install/notification.sh', 'install/havenfold-kur.sablon', 'build/havenfold-usb-build.sh', 'build/erase-root-build.sh', 'build/havenfold-install-build.sh']

test('kabuk betikleri: bash -n, varsa shellcheck (uyarı düzeyi)', (t) => {
  for (const b of BETIKLER) {
    const r = calis('bash', ['-n', path.join(KOK, b)])
    t.is(r.status, 0, b + (r.stderr ? ': ' + r.stderr : ''))
  }
  const sc = calis('shellcheck', ['--version'])
  if (sc.status !== 0) { t.comment('shellcheck yok; atlandı'); return }
  for (const b of BETIKLER) {
    const r = calis('shellcheck', ['-x', '-s', 'bash', '-S', 'warning', '-f', 'gcc', path.join(KOK, b)], { cwd: path.dirname(path.join(KOK, b)) })
    t.is(r.status, 0, 'shellcheck ' + b + (r.status ? '\n' + r.stdout : ''))
  }
})

test('her kaynak dosyada MPL-2.0 SPDX başlığı; boş meta-data hariç', (t) => {
  const gez = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? gez(path.join(d, e.name)) : [path.join(d, e.name)])
  for (const f of gez(KOK)) {
    const ad = path.relative(KOK, f)
    if (ad === 'build/nocloud/meta-data' || ad.endsWith('.md') || ad === 'package.json') continue // package.json: lisans alanında
    const ilk = fs.readFileSync(f, 'utf8').split('\n').slice(0, 3).join('\n')
    t.ok(/SPDX-License-Identifier: MPL-2\.0/.test(ilk), ad)
  }
  t.is(fs.readFileSync(path.join(KOK, 'build/nocloud/meta-data'), 'utf8'), '', 'meta-data boş (§8.3)')
})

test('önyükleme menüsü ve otomatik kurulum dosyası (§8.2, §8.3)', (t) => {
  const g = fs.readFileSync(path.join(KOK, 'build/grub.cfg'), 'utf8')
  const girdiler = [...g.matchAll(/^menuentry "([^"]+)"/gm)].map((m) => m[1])
  t.alike(girdiler, ['Diskten başlat', 'Havenfold kur — bu bilgisayarın diski SİLİNİR', 'Havenfold silme modu — emeklilik'])
  t.ok(g.includes('set default=0') && g.includes('set timeout=15'), 'varsayılan silmeyen seçenek, 15 sn')
  t.ok(g.includes("autoinstall 'ds=nocloud;s=/cdrom/nocloud/'"))
  t.ok(g.includes('havenfold.silme=1') && g.includes('toram'))
  const u = fs.readFileSync(path.join(KOK, 'build/nocloud/user-data'), 'utf8')
  t.ok(u.startsWith('#cloud-config\n'))
  for (const s of ['interactive-sections: []', 'ssh: { install-server: false }', 'drivers: { install: false }', 'updates: security', 'hostname: havenfold-XXXX', 'lock_passwd: true',
    '- /cdrom/havenfold/bin/hf-on-kontrol', '- /cdrom/havenfold/bin/hf-depolama-yaz', '- /cdrom/havenfold/bin/hf-hedefe-kur /target', 'shutdown: reboot']) t.ok(u.includes(s), s)
  t.absent(/password|passwd:|ssh_authorized|psk/i.test(u.replace('lock_passwd', '')), 'USB\'de sır yok')
})

test('silme ve kurulum araçlarında TRIM ve anahtar üretimi yok', (t) => {
  const gez = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? gez(path.join(d, e.name)) : [path.join(d, e.name)])
  for (const f of gez(KOK).filter((x) => !x.includes(`${path.sep}test${path.sep}`) && !x.endsWith('.md'))) {
    const s = fs.readFileSync(f, 'utf8')
    const kod = s.split('\n').filter((x) => !/^\s*(\/\/|#)/.test(x)).join('\n') // yorumlar "TRIM yok" diye anabilir
    t.absent(/\bblkdiscard\b|\bfstrim\b/.test(kod), path.relative(KOK, f) + ': TRIM yok')
    t.absent(/openssl genpkey|ssh-keygen|crypto_sign_keypair/.test(s) && !f.endsWith('report.js'), path.relative(KOK, f) + ': anahtar üretmez (rapor anahtarı yalnız silme ortamında)')
  }
})

function sahteUsb (t) {
  const d = geciciDizin(t)
  const k = path.join(d, 'usb/havenfold/kurulum')
  fs.mkdirSync(k, { recursive: true })
  fs.symlinkSync(process.execPath, path.join(k, 'node'))
  fs.symlinkSync(path.join(KOK, 'lib'), path.join(k, 'lib'))
  fs.symlinkSync(path.join(KOK, 'erase'), path.join(k, 'erase'))
  // sahte sysfs ve procfs: pil var, TPM yok
  fs.mkdirSync(path.join(d, 'sys/class/power_supply/BAT0'), { recursive: true })
  fs.writeFileSync(path.join(d, 'sys/class/power_supply/BAT0/type'), 'Battery\n')
  fs.mkdirSync(path.join(d, 'proc'))
  fs.writeFileSync(path.join(d, 'proc/cpuinfo'), 'flags\t\t: fpu lm pni ssse3 cx16 sse4_1 sse4_2 popcnt lahf_lm\n')
  fs.writeFileSync(path.join(d, 'proc/meminfo'), 'MemTotal:       16000000 kB\n')
  // sahte lsblk: örnek dizüstü, diskler kurulum için büyütülmüş
  const ls = { blockdevices: O.LSBLK.blockdevices.map((x) => x.type === 'disk' && x.tran !== 'usb' ? { ...x, size: x.size * 100000 } : x) }
  fs.mkdirSync(path.join(d, 'bin'))
  fs.writeFileSync(path.join(d, 'lsblk.json'), JSON.stringify(ls))
  fs.writeFileSync(path.join(d, 'bin/lsblk'), `#!/bin/sh\ncat '${path.join(d, 'lsblk.json')}'\n`, { mode: 0o755 })
  fs.copyFileSync(path.join(KOK, 'build/nocloud/user-data'), path.join(d, 'autoinstall.yaml'))
  const env = { ...ORTAM, PATH: path.join(d, 'bin') + path.delimiter + ORTAM.PATH, HF_USB: path.join(d, 'usb'), HF_RAM: path.join(d, 'ram'), HF_AUTOINSTALL: path.join(d, 'autoinstall.yaml'), HF_SYS: path.join(d, 'sys'), HF_PROC: path.join(d, 'proc'), HF_TTY_YOK: '1', HF_KAPATMA: '1' }
  return { d, env }
}

test('hf-on-kontrol ve hf-depolama-yaz: sahte donanımla akış (TPM yok)', (t) => {
  const { d, env } = sahteUsb(t)
  const r = calis('bash', [path.join(KOK, 'bin/hf-on-kontrol')], { env, input: 'X\nH\nSIL\nTAMAM\n' })
  t.is(r.status, 0, r.stdout + r.stderr)
  t.ok(r.stdout.includes('Kurulacak disk: SAHTE NVMe 512GB'), 'hedef NVMe')
  t.ok(r.stdout.includes('Disk şifrelenmeyecek.'))
  const karar = JSON.parse(fs.readFileSync(path.join(d, 'ram/karar.json')))
  t.is(karar.tpm, false)
  t.is(karar.hedef.seri, 'NVME0SERI1234')
  const ai = fs.readFileSync(path.join(d, 'autoinstall.yaml'), 'utf8')
  t.ok(/hostname: havenfold-[0-9a-f]{4}\n/.test(ai))
  t.is((fs.statSync(path.join(d, 'ram')).mode & 0o777), 0o700, 'RAM dizini yalnız kök')
  const s = calis('bash', [path.join(KOK, 'bin/hf-depolama-yaz')], { env })
  t.is(s.status, 0, s.stderr)
  const ai2 = fs.readFileSync(path.join(d, 'autoinstall.yaml'), 'utf8')
  t.ok(ai2.includes('      match: { serial: "*NVME0SERI1234*" }') && !ai2.includes('password'), 'TPM yok: şifresiz')
})

test('hf-on-kontrol: yanlış onay ve şişmiş pil kurulumu durdurur', (t) => {
  const a = sahteUsb(t)
  const r = calis('bash', [path.join(KOK, 'bin/hf-on-kontrol')], { env: a.env, input: 'H\nsil\n' })
  t.is(r.status, 1)
  t.ok(r.stdout.includes('Onay verilmedi.') && r.stdout.includes('60 saniye sonra kapanacak'))
  t.ok(fs.readFileSync(path.join(a.d, 'autoinstall.yaml'), 'utf8').includes('havenfold-XXXX'), 'dosyaya dokunulmadı')
  const b = sahteUsb(t)
  const p = calis('bash', [path.join(KOK, 'bin/hf-on-kontrol')], { env: b.env, input: 'e\n' })
  t.is(p.status, 1)
  t.ok(p.stdout.includes('Şişmiş pilli cihaz eklenmez.'))
  // Codex 12. tur: girdi biterse (EOF) pil sorusu sonsuz döngüye girmez, kurulum durur
  const c = sahteUsb(t)
  const e = calis('bash', [path.join(KOK, 'bin/hf-on-kontrol')], { env: c.env, input: '', timeout: 20_000 })
  t.is(e.status, 1, 'EOF: durdu (zaman aşımı değil)')
  t.ok(e.stdout.includes('Onay verilmedi.'))
})

test('Codex 12. tur: ilk açılış şifreleme durumunu hf-luks-yenile\'nin yazdığı dosyadan okur; fwupd kaldırma hatası yutulmaz', (t) => {
  const ilk = fs.readFileSync(path.join(KOK, 'target/hf-ilk-acilis'), 'utf8')
  t.ok(ilk.includes('/etc/havenfold/disk-sifreleme'), 'disk-sifreleme okunur')
  t.absent(ilk.includes("grep -qv '^#' /etc/crypttab"), 'yalnız yorumlu crypttab luks-tpm sayılmaz')
  const hedef = fs.readFileSync(path.join(KOK, 'bin/hf-hedefe-kur'), 'utf8')
  t.absent(/apt-get purge -y fwupd \|\| true/.test(hedef), 'purge hatası || true ile yutulmaz')
})

test('hf-depolama-yaz: TPM varsa geçici parola yalnız RAM dizininde ve dosyada', (t) => {
  const { d, env } = sahteUsb(t)
  fs.mkdirSync(path.join(d, 'ram'), { mode: 0o700 })
  fs.writeFileSync(path.join(d, 'ram/karar.json'), JSON.stringify({ tpm: true, hedef: { yol: '/dev/nvme0n1', seri: 'NVME0SERI1234' } }))
  const s = calis('bash', [path.join(KOK, 'bin/hf-depolama-yaz')], { env })
  t.is(s.status, 0, s.stderr)
  const parola = fs.readFileSync(path.join(d, 'ram/luks-gecici'), 'utf8')
  t.ok(/^[A-Z2-7]{52}$/.test(parola), '32 bayt base32, dolgusuz')
  t.is(fs.statSync(path.join(d, 'ram/luks-gecici')).mode & 0o777, 0o600)
  t.ok(fs.readFileSync(path.join(d, 'autoinstall.yaml'), 'utf8').includes(`password: "${parola}"`))
  t.absent(s.stdout.includes(parola), 'parola ekrana yazılmaz')
})

// Kabuktaki bildirim doğrulayıcısı (havenfold-kur) ile node/release.js aynı kararı verir
function opensslEd25519 () {
  const r = calis('openssl', ['version'])
  return r.status === 0 && /OpenSSL [3-9]/.test(r.stdout)
}

test('install/notification.sh: node.json vektörleri (OpenSSL Ed25519 + b2sum)', { skip: !opensslEd25519() }, (t) => {
  const d = geciciDizin(t)
  const kok = { keyEpoch: 1, rootPub: b4a.from(F.kokPub, 'hex'), nextRootHash: S.rootHash(b4a.from(F.yedekPub, 'hex')) }
  const kokHex = b4a.toString(c.encode(S.kokDurumuEnc, kok), 'hex')
  for (const [i, v] of F[1].durumlar.entries()) {
    fs.writeFileSync(path.join(d, `b${i}`), b4a.from(v.bildirim, 'hex'))
    const paket = v.paket || F[1].paket
    fs.writeFileSync(path.join(d, `p${i}`), b4a.from(paket, 'hex'))
    const r = calis('bash', ['-c', `. '${path.join(KOK, 'install/notification.sh')}'; hf_kok_durumu_coz ${kokHex} || exit 9; if hf_bildirim_dogrula '${path.join(d, `b${i}`)}' kararli linux amd64 && hf_paket_denetle '${path.join(d, `p${i}`)}'; then echo "TAMAM $HF_SURUM $HF_KOD $HF_PAKET_ADI $HF_BILDIRIM_OZETI"; else echo "HATA $HF_HATA"; fi`])
    const js = (() => { try { S.dosyaDenetle(S.bildirimCoz(b4a.from(v.bildirim, 'hex'), kok).m.packages[0], { ozet: S.paketOzeti(b4a.from(paket, 'hex')), boyut: paket.length / 2 }); return null } catch (e) { return e.message } })()
    t.is(js, v.beklenen, 'JS: ' + v.aciklama)
    t.is(r.stdout.trim().split(' ')[0] === 'TAMAM' ? null : r.stdout.trim().split(' ')[1], v.beklenen, 'kabuk: ' + v.aciklama + (r.stderr ? ' ' + r.stderr : ''))
    if (v.beklenen === null) t.ok(r.stdout.includes(`TAMAM 1.2.3 1002003 havenfold-node-1.2.3-amd64.zip ${F[1].bildirimOzeti}`))
  }
  // İmzası bozulmuş bildirim ve başka kanal
  const b = b4a.from(F[1].durumlar[0].bildirim, 'hex')
  b[b.byteLength - 1] ^= 1
  fs.writeFileSync(path.join(d, 'imza'), b)
  const r = calis('bash', ['-c', `. '${path.join(KOK, 'install/notification.sh')}'; hf_kok_durumu_coz ${kokHex}; hf_bildirim_dogrula '${path.join(d, 'imza')}' kararli linux amd64; echo "$HF_HATA"; hf_bildirim_dogrula '${path.join(d, 'b0')}' deneme linux amd64; echo "$HF_HATA"; hf_bildirim_dogrula '${path.join(d, 'b0')}' kararli linux arm64; echo "$HF_HATA"`])
  t.alike(r.stdout.trim().split('\n'), ['SIGNATURE_ERROR', 'CHANNEL_MISMATCH', 'NO_PACKAGE'])
})

function testAnahtari (tohum) {
  const pk = b4a.alloc(32)
  const sk = b4a.alloc(64)
  sodium.crypto_sign_seed_keypair(pk, sk, hash('test/' + tohum))
  return { pk, sk }
}

function bildirimHazirla (d, { surum = '1.2.3', debler = ['podman_4.9.3_amd64.deb', 'clevis_20_amd64.deb'], ek = {} } = {}) {
  const K = testAnahtari('kurulum-test/kok')
  const Y = testAnahtari('kurulum-test/yedek')
  const kok = { keyEpoch: 1, rootPub: K.pk, nextRootHash: S.rootHash(Y.pk) }
  const zip = zipYaz([{ ad: 'node', bytes: b4a.from('#!/bin/sh\necho sahte node\n') }, { ad: 'bin/havenfold', bytes: b4a.from('#!/bin/sh\n') }])
  const paketAdi = `havenfold-node-${surum}-amd64.zip`
  fs.writeFileSync(path.join(d, paketAdi), zip)
  fs.mkdirSync(path.join(d, 'deb'), { recursive: true })
  const debOzet = []
  for (const x of debler) {
    const b = b4a.from('sahte deb ' + x)
    fs.writeFileSync(path.join(d, 'deb', x), b)
    debOzet.push({ name: x, version: '1', digest: S.paketOzeti(b) })
  }
  const m = {
    format: 1, product: 'havenfold-node', version: surum, versionCode: S.versionCode(surum), channel: 'kararli', publishedAt: 1761300000000, minFrom: 1000000, urgent: false,
    packages: [{ os: 'linux', arch: 'amd64', name: paketAdi, size: zip.byteLength, digest: S.paketOzeti(zip), urls: ['https://ornek.invalid/' + paketAdi] }],
    images: [], assets: [], installer: [], installerDebs: debOzet, revoked: [], catalogKeys: [], keyEpoch: 1, nextRootHash: kok.nextRootHash, notes: '', ...ek
  }
  fs.writeFileSync(path.join(d, 'bildirim.bin'), S.bildirimYaz(m, K.sk))
  fs.writeFileSync(path.join(d, 'kok.durum'), c.encode(S.kokDurumuEnc, kok))
  return { paket: path.join(d, paketAdi), kok, m }
}

test('build/notification-check.js: derleme anı denetimi ve USB dosyaları', (t) => {
  const { denetle } = require('../build/notification-check')
  const d = geciciDizin(t)
  const { paket } = bildirimHazirla(d)
  const arg = { bildirim: path.join(d, 'bildirim.bin'), 'kok-durum': path.join(d, 'kok.durum'), paket, 'deb-dizini': path.join(d, 'deb'), surum: '1.2.3', cikti: path.join(d, 'cikti') }
  const b = denetle(arg)
  t.is(b.surum, '1.2.3')
  t.is(b.versionCode, 1002003)
  t.is(fs.readFileSync(path.join(d, 'cikti/node'), 'utf8'), '#!/bin/sh\necho sahte node\n')
  t.is(fs.statSync(path.join(d, 'cikti/node')).mode & 0o777, 0o755)
  const oz = fs.readFileSync(path.join(d, 'cikti/ozetler'), 'utf8').trim().split('\n')
  t.is(oz.length, 3)
  t.ok(oz[0].endsWith('  havenfold-node-1.2.3-amd64.zip') && oz[1].endsWith('  deb/clevis_20_amd64.deb'))
  t.alike(JSON.parse(fs.readFileSync(path.join(d, 'cikti/paket.json'))).bildirimOzeti, b.bildirimOzeti)
  // Ozetler dosyası kurulumdaki b2sum denetimiyle (target/common.sh hf_ozetleri_denetle) aynı sonucu verir
  for (const f of ['havenfold-node-1.2.3-amd64.zip', 'deb/clevis_20_amd64.deb', 'deb/podman_4.9.3_amd64.deb']) fs.mkdirSync(path.dirname(path.join(d, 'usb', f)), { recursive: true })
  fs.copyFileSync(paket, path.join(d, 'usb/havenfold-node-1.2.3-amd64.zip'))
  for (const x of fs.readdirSync(path.join(d, 'deb'))) fs.copyFileSync(path.join(d, 'deb', x), path.join(d, 'usb/deb', x))
  const kontrol = (ek = '') => calis('bash', ['-c', `KURULUM=/yok; . '${path.join(KOK, 'target/common.sh')}'; ${ek} hf_ozetleri_denetle '${path.join(d, 'usb')}' '${path.join(d, 'cikti/ozetler')}'`])
  t.is(kontrol().status, 0, 'b2sum ile özetler tutar')
  fs.appendFileSync(path.join(d, 'usb/deb/podman_4.9.3_amd64.deb'), 'x')
  const bozuk = kontrol()
  t.is(bozuk.status, 1)
  t.ok(bozuk.stderr.includes('özet tutmuyor: deb/podman_4.9.3_amd64.deb'))
  // Hatalar
  t.exception(() => denetle({ ...arg, surum: '1.2.4' }), /MANIFEST_ERROR: sürüm/)
  fs.writeFileSync(path.join(d, 'deb/fazla_1_amd64.deb'), 'x')
  t.exception(() => denetle(arg), /DIGEST_MISMATCH: bildirimde olmayan paket/)
  fs.rmSync(path.join(d, 'deb/fazla_1_amd64.deb'))
  fs.rmSync(path.join(d, 'deb/clevis_20_amd64.deb'))
  t.exception(() => denetle(arg), /DIGEST_MISMATCH: dosyası olmayan paket/)
  const d2 = geciciDizin(t)
  const p2 = bildirimHazirla(d2)
  fs.appendFileSync(p2.paket, 'x')
  t.exception(() => denetle({ ...arg, bildirim: path.join(d2, 'bildirim.bin'), 'kok-durum': path.join(d2, 'kok.durum'), paket: p2.paket, 'deb-dizini': path.join(d2, 'deb') }), /DIGEST_MISMATCH/)
})

test('build/havenfold-install-build.sh: tek dosya, gömülü kök durumu ve kurulum aracı', (t) => {
  const d = geciciDizin(t)
  bildirimHazirla(d)
  const cikti = path.join(d, 'havenfold-kur')
  const r = calis('bash', [path.join(KOK, 'build/havenfold-install-build.sh'), '--kok-durum', path.join(d, 'kok.durum'), '--surum', '1.2.3', '--cikti', cikti])
  t.is(r.status, 0, r.stderr)
  const s = fs.readFileSync(cikti, 'utf8')
  const kokHex = b4a.toString(fs.readFileSync(path.join(d, 'kok.durum')), 'hex')
  t.ok(s.includes(`HF_KOK_DURUMU='${kokHex}'`) && s.includes("HF_ARAC_SURUMU='1.2.3'") && !s.includes('@KOK_DURUMU@'))
  t.is(calis('bash', ['-n', cikti]).status, 0, 'bash -n')
  // Codex 12. tur: hata iletisine çıkış kodu yapışmaz; umask sabit (sudo kullanıcının 027'sini taşır, sürüm dizini
  // havenfold-* kullanıcılarına kapanırdı); stdin kapalıysa dizüstü sorusu "hayır" sayılır, kurulum ortada sessizce
  // bitmez; yeniden çalıştırmada (--etiket) çalışan birimler yeni sürüme yeniden başlar, denetçi hatası yutulmaz
  const yanlis = calis('bash', [cikti, '--rol', 'yanlis'])
  t.is(yanlis.status, 1)
  t.is(yanlis.stderr, 'HATA: --rol isci, kutu ya da birlesik\n')
  t.ok(/\nset -euo pipefail\numask 022\n/.test(s), 'umask 022')
  t.ok(s.includes('read -r c || c=""'))
  t.absent(s.includes('havenfold-denetci.service || true'), 'denetçi hatası yutulmaz')
  t.ok(s.includes('systemctl restart havenfold-nft.service havenfold-denetci.service'))
  t.ok(s.includes('systemctl restart "${CEKIRDEK[@]}"'))
  // Yük açılır ve beklenen dosyalar çıkar
  const ac = path.join(d, 'ac')
  fs.mkdirSync(ac)
  const y = calis('bash', ['-c', `sed '1,/^__HAVENFOLD_YUK__$/d' '${cikti}' | base64 -d | tar -xz -C '${ac}'`])
  t.is(y.status, 0, y.stderr)
  for (const f of ['lib/cli.js', 'lib/package.js', 'erase/discovery.js', 'install/notification.sh', 'target/common.sh', 'target/hf-luks-yenile', 'target/systemd/havenfold-nft.service', 'vendor/zip.js', 'node_modules/b4a/package.json']) t.ok(fs.existsSync(path.join(ac, f)), f)
  t.absent(fs.existsSync(path.join(ac, 'node')), 'Node gömülü değil (doğrulanan paketten gelir)')
  // Kurucunun ve kaynakladığı common.sh'ın yükten okuduğu her dosya yükte var (Codex 11. tur: ad değişikliğinde
  // install/notification.sh kalmıştı). node yükte değil, doğrulanan paketten gelir.
  const okunan = new Set()
  for (const k of [s, fs.readFileSync(path.join(KOK, 'target/common.sh'), 'utf8')]) {
    for (const m of k.matchAll(/"\$(?:IS\/kurulum|KURULUM)\/([A-Za-z0-9_./-]+)"/g)) if (m[1] !== 'node' && m[1] !== '.' && !m[1].endsWith('/')) okunan.add(m[1])
  }
  t.ok(okunan.has('install/notification.sh') && okunan.has('target/common.sh'), [...okunan].join(' '))
  for (const f of okunan) t.ok(fs.existsSync(path.join(ac, f)), 'kurucunun okuduğu yükte: ' + f)
  // Gömülü doğrulayıcı, gömülü kök durumuyla test bildirimini doğrular (OpenSSL 3+ varsa)
  if (opensslEd25519()) {
    const v = calis('bash', ['-c', `. '${path.join(ac, 'install/notification.sh')}'; hf_kok_durumu_coz ${kokHex} && hf_bildirim_dogrula '${path.join(d, 'bildirim.bin')}' kararli linux amd64 && hf_paket_denetle '${path.join(d, 'havenfold-node-1.2.3-amd64.zip')}' && echo "TAMAM $HF_PAKET_ADI $HF_PAKET_URLS"`])
    t.ok(v.stdout.startsWith('TAMAM havenfold-node-1.2.3-amd64.zip https://ornek.invalid/'), v.stdout + v.stderr)
  }
})

// Kökü döndürülmüş makinede eski havenfold-kur: güven kökü makinenin kök durumu; sürüm denetimi paketteki Node
// çalışmadan, sistemin python3'üyle (açılış öncesi inceleme, Codex 4. tur)
test('install/notification.sh: kurulu kök ve sürüm durumu aday paketten önce', { skip: !opensslEd25519() }, (t) => {
  const d = geciciDizin(t)
  const K1 = testAnahtari('kurulum-test/kok')
  const K2 = testAnahtari('kurulum-test/yedek')
  const K3 = testAnahtari('kurulum-test/sonraki')
  const kok1 = { keyEpoch: 1, rootPub: K1.pk, nextRootHash: S.rootHash(K2.pk) }
  const kok2 = { keyEpoch: 2, rootPub: K2.pk, nextRootHash: S.rootHash(K3.pk) }
  const hex = (k) => b4a.toString(c.encode(S.kokDurumuEnc, k), 'hex')
  const bildirim = (ad, kok, sk, surum, ek = {}) => {
    const m = {
      format: 1, product: 'havenfold-node', version: surum, versionCode: S.versionCode(surum), channel: 'kararli', publishedAt: 1761300000000, minFrom: 1000000, urgent: false,
      packages: [{ os: 'linux', arch: 'amd64', name: `havenfold-node-${surum}-amd64.zip`, size: 1, digest: S.paketOzeti(b4a.from('x')), urls: ['https://ornek.invalid/p'] }],
      images: [], assets: [], installer: [], installerDebs: [], revoked: [], catalogKeys: [], keyEpoch: kok.keyEpoch, nextRootHash: kok.nextRootHash, notes: '', ...ek
    }
    fs.writeFileSync(path.join(d, ad), S.bildirimYaz(m, sk))
    return path.join(d, ad)
  }
  const eski = bildirim('eski', kok1, K1.sk, '9.0.0') // ele geçmiş eski kökle yüksek sürüm
  const yeni = bildirim('yeni', kok2, K2.sk, '1.3.0')
  const kurulu = path.join(d, 'kok.durum')
  const kur = (kokDosyasi, b) => calis('bash', ['-c', `. '${path.join(KOK, 'install/notification.sh')}'; HF_KOK_DURUMU=${hex(kok1)}; hf_kok_durumu_coz $HF_KOK_DURUMU || exit 9; ` +
    `if hf_kurulu_kok_sec '${kokDosyasi}' && hf_bildirim_dogrula '${b}' kararli linux amd64; then echo "TAMAM $HF_KOK_DONEM $HF_KOK_DURUMU"; else echo "HATA $HF_HATA"; fi`]).stdout.trim()
  fs.writeFileSync(kurulu, c.encode(S.kokDurumuEnc, kok2))
  t.is(kur(kurulu, eski), 'HATA ROOT_EPOCH_ERROR', 'eski kökün bildirimi kurulu yeni kökle reddedilir')
  t.is(kur(kurulu, yeni), `TAMAM 2 ${hex(kok2)}`, 'yeni kökün bildirimi kurulu kökle doğrulanır; kok.durum o yazılır')
  t.is(kur(path.join(d, 'yok'), eski), `TAMAM 1 ${hex(kok1)}`, 'ilk kurulum: gömülü kök')
  fs.writeFileSync(kurulu, c.encode(S.kokDurumuEnc, { ...kok1, rootPub: K3.pk }))
  t.is(kur(kurulu, eski), 'HATA ROOT_CONFLICT', 'aynı dönemde başka kök')
  fs.writeFileSync(kurulu, 'bozuk')
  t.is(kur(kurulu, eski), 'HATA ROOT_STATE_CORRUPT')
  fs.writeFileSync(kurulu, c.encode(S.kokDurumuEnc, { ...kok1, keyEpoch: 0 }))
  t.is(kur(kurulu, eski), `TAMAM 1 ${hex(kok1)}`, 'kurulu kök eskiyse gömülü kalır')

  // Sürüm: yetki.durum (node/privilege-helper.js biçimi) ve bildirimin kendi geri çekme listesi
  const y = path.join(d, 'yetki.durum')
  const surum = (b, durum) => {
    if (durum === undefined) fs.rmSync(y, { force: true })
    else fs.writeFileSync(y, typeof durum === 'string' ? durum : JSON.stringify(durum))
    return calis('bash', ['-c', `. '${path.join(KOK, 'install/notification.sh')}'; hf_kok_durumu_coz ${hex(kok1)} || exit 9; ` +
      `hf_bildirim_dogrula '${b}' kararli linux amd64 || { echo "HATA $HF_HATA"; exit; }; if hf_surum_denetle '${y}'; then echo TAMAM; else echo "HATA $HF_HATA"; fi`]).stdout.trim()
  }
  const b123 = bildirim('b123', kok1, K1.sk, '1.2.3')
  t.is(surum(b123), 'TAMAM', 'ilk kurulum')
  t.is(surum(b123, { enYuksek: 1002003, revoked: [], bozuk: [] }), 'TAMAM', 'aynı sürüm yeniden')
  t.is(surum(b123, { enYuksek: 1003000 }), 'HATA VERSION_TOO_LOW')
  t.is(surum(b123, { enYuksek: 1000000, revoked: [1002003] }), 'HATA VERSION_REVOKED')
  t.is(surum(b123, { enYuksek: 1000000, bozuk: [1002003] }), 'HATA VERSION_REVOKED')
  t.is(surum(b123, '{bozuk'), 'HATA PRIVILEGE_STATE_CORRUPT')
  t.is(surum(b123, { enYuksek: '1' }), 'HATA PRIVILEGE_STATE_CORRUPT')
  // Codex 5. tur: şema kesin
  t.is(surum(b123, { enYuksek: 1, revoked: {} }), 'HATA PRIVILEGE_STATE_CORRUPT', 'revoked nesne')
  t.is(surum(b123, { enYuksek: 1, bozuk: ['x'] }), 'HATA PRIVILEGE_STATE_CORRUPT')
  t.is(surum(b123, { enYuksek: 1, revoked: null }), 'HATA PRIVILEGE_STATE_CORRUPT')
  t.is(surum(b123, { enYuksek: -5 }), 'HATA PRIVILEGE_STATE_CORRUPT')
  t.is(surum(b123, { enYuksek: true }), 'HATA PRIVILEGE_STATE_CORRUPT')

  // Codex 5. tur: kurulu düğümün kök ya da sürüm durumu kaybolmuşsa ilk kurulum sayılmaz
  const kokOnek = path.join(d, 'kok')
  const durum = () => calis('bash', ['-c', `. '${path.join(KOK, 'install/notification.sh')}'; if hf_kurulum_durumu '${kokOnek}'; then echo TAMAM; else echo "HATA $HF_HATA"; fi`]).stdout.trim()
  const yaz = (g) => { fs.mkdirSync(path.dirname(path.join(kokOnek, g)), { recursive: true }); fs.writeFileSync(path.join(kokOnek, g), 'x') }
  t.is(durum(), 'TAMAM', 'hiçbir şey yok: ilk kurulum')
  yaz('var/lib/havenfold/isci/kimlik')
  t.is(durum(), 'HATA STATE_INCOMPLETE', 'kimlik var, durum yok')
  yaz('var/lib/havenfold/yetki/kok.durum')
  t.is(durum(), 'HATA STATE_INCOMPLETE', 'yalnız kök durumu')
  yaz('var/lib/havenfold/yetki/yetki.durum')
  t.is(durum(), 'TAMAM')
  fs.rmSync(path.join(kokOnek, 'var/lib/havenfold/isci'), { recursive: true })
  fs.rmSync(path.join(kokOnek, 'var/lib/havenfold/yetki/kok.durum'))
  t.is(durum(), 'HATA STATE_INCOMPLETE', 'yalnız yetki durumu')
  t.is(surum(bildirim('kendi', kok1, K1.sk, '1.2.3', { revoked: [1000000, 1002003] })), 'HATA VERSION_REVOKED', 'bildirimin kendi listesi')

  // havenfold-kur sırası: kurulu kök doğrulamadan, sürüm denetimi paketteki Node'u çıkarmadan ve kalıcı araç kopyasından önce
  const s = fs.readFileSync(path.join(KOK, 'install/havenfold-kur.sablon'), 'utf8')
  const yer = (x) => { const i = s.indexOf(x); t.ok(i > 0, x); return i }
  t.ok(yer('hf_kurulum_durumu ""') < yer('hf_kurulu_kok_sec /var/lib/havenfold/yetki/kok.durum'))
  t.ok(yer('hf_kurulu_kok_sec /var/lib/havenfold/yetki/kok.durum') < yer('if ! hf_bildirim_dogrula'))
  t.ok(yer('hf_surum_denetle /var/lib/havenfold/yetki/yetki.durum') < yer('adim "Düğüm paketi"'))
  t.ok(yer('adim "Düğüm paketi"') < yer('$IS/kurulum/node') && yer('$IS/kurulum/node') < yer('hf_kurulum_kopyala'))
})

test('lib/cli.js: kabuktan çağrılan komutlar', (t) => {
  const d = geciciDizin(t)
  const cli = (args, input) => calis(process.execPath, [path.join(KOK, 'lib/cli.js'), ...args], { input })
  const dump = path.join(d, 'dump.json')
  const cl = path.join(d, 'clevis.txt')
  fs.writeFileSync(dump, JSON.stringify({ keyslots: { 0: {}, 1: {} }, tokens: { 0: { type: 'clevis', keyslots: ['1'] } } }))
  fs.writeFileSync(cl, "1: tpm2 '{\"hash\":\"sha256\",\"key\":\"ecc\"}'\n")
  t.alike(JSON.parse(cli(['luks-plan', '--dump', dump, '--clevis', cl]).stdout).adimlar, ['kurtarma-ekle', 'pcr7-bagla', 'clevis-coz:1', 'yuva-sil:0'])
  t.is(cli(['luks-yuvalar', '--dump', dump]).stdout, '0 1\n')
  t.is(cli(['kurtarma-kodla'], b4a.alloc(32)).stdout, '0'.repeat(52))
  t.is(cli(['parola-denetle'], 'kısa').status, 1)
  t.is(cli(['parola-denetle'], 'yeterince-uzun-parola').status, 0)
  t.is(cli(['rol-sec'], '2\n').stdout, 'kutu\n')
  t.is(cli(['rol-sec'], 'kök\n').status, 1)
  t.ok(cli(['dosya', '--ad', 'nft', '--kip', 'usb']).stdout.includes('policy drop;'))
  t.ok(cli(['netplan-wifi', '--arayuz', 'wlan0', '--ssid', 'Ev'], 'parola123\n').stdout.includes('"Ev": { password: "parola123" }'), 'parola stdin\'den')
  t.is(cli(['bilinmeyen']).status, 2)
  t.ok(cli(['durum-ozeti', '--ram-bayt', String(8 * 1024 ** 3), '--cekirdek', '6.8', '--disk-model', 'X', '--disk-boyut', '512000000000', '--tpm', 'var', '--sifreleme', 'luks-tpm', '--ag', 'kablolu']).stdout.includes('Disk şifreleme: açık (TPM ile)'))
  const plan = JSON.parse(cli(['pil-plani'], '/sys/class/power_supply/BAT0/charge_control_end_threshold\n').stdout)
  t.is(plan.limit, 'cekirdek')
})

test('common.sh hf_kullanicilar: var olan Ubuntu\'da /run/havenfold dizinleri hemen açılır (Codex 12. tur)', (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-tmpfiles-'))
  t.teardown(() => fs.rmSync(d, { recursive: true, force: true }))
  fs.mkdirSync(path.join(d, 'surum/deploy'), { recursive: true })
  for (const f of ['sysusers.conf', 'tmpfiles.conf']) fs.writeFileSync(path.join(d, 'surum/deploy', f), '')
  const kayit = path.join(d, 'kayit')
  // hedefte ve install sahte: yalnız tmpfiles çağrısının argümanları kaydedilir
  const kos = (kok) => calis('bash', ['-c', `set -euo pipefail; KURULUM=/yok; . '${path.join(KOK, 'target/common.sh')}'; KOK='${kok}'; HF_SURUM_DIZ='${path.join(d, 'surum')}'; install () { :; }; hedefte () { echo "$*" >> '${kayit}'; }; hf_kullanicilar`])
  const tmpfiles = () => fs.readFileSync(kayit, 'utf8').split('\n').find((l) => l.startsWith('systemd-tmpfiles'))
  t.is(kos('').status, 0)
  // Birimlerin ReadWritePaths'indeki /run/havenfold/* yoksa systemd birimi 226/NAMESPACE ile başlatmaz
  t.ok(tmpfiles().includes('--prefix=/run/havenfold'), tmpfiles())
  fs.rmSync(kayit)
  t.is(kos(path.join(d, 'hedef')).status, 0)
  t.absent(tmpfiles().includes('/run/havenfold'), 'USB kurulumunda hedefin /run\'ı açılışta kurulur')
})
