// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Kurulum aracının saf mantığı (RFC-0007 §8.3–8.6, §9, §10): ön kontrol, depolama bölümü, LUKS planı ve kurtarma
// anahtarı, laptop ayarları, ilk açılış, paket açma. Diske ve sisteme dokunulmaz; paket kullanıcının geçici dizinine açılır.
const test = require('brittle')
const fs = require('fs')
const os = require('os')
const path = require('path')
const b4a = require('b4a')
const c = require('compact-encoding')
const OK = require('../lib/preflight')
const D = require('../lib/storage')
const L = require('../lib/luks')
const P = require('../lib/laptop')
const I = require('../lib/first-boot')
const PK = require('../lib/package')
const O = require('./helpers/examples')
const { zipYaz } = require('../../core/export/zip')
const S = require('../../node/release')
const { YetkiYardimcisi } = require('../../node/privilege-helper')

const GB = 1e9
const CPU = 'processor\t: 0\nflags\t\t: fpu vme de pse tsc msr pae mce cx8 apic sep mtrr pge mca cmov pat pse36 clflush mmx fxsr sse sse2 ht syscall nx lm constant_tsc pni ssse3 cx16 sse4_1 sse4_2 popcnt lahf_lm\n'
const CPU_ESKI = CPU.replace(' sse4_2', '').replace(' popcnt', '')
const mem = (gib) => `MemTotal:       ${Math.round(gib * 1024 * 1024)} kB\nMemFree:  1000 kB\n`
const disk = (ad, boyut, ek = {}) => ({ name: ad, path: '/dev/' + ad, type: 'disk', size: boyut, rota: false, rm: false, hotplug: false, tran: ad.startsWith('nvme') ? 'nvme' : 'sata', model: 'M-' + ad, serial: 'SERI-' + ad.toUpperCase(), mountpoints: [null], ...ek })
const usb = { name: 'sdz', path: '/dev/sdz', type: 'disk', size: 8 * GB, rota: false, rm: true, hotplug: true, tran: 'usb', model: 'USB', serial: 'U', fstype: 'iso9660', mountpoints: ['/cdrom'] }
const lsblk = (...d) => JSON.stringify({ blockdevices: [usb, ...d] })
function geciciDizin (t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-kurulum-test-'))
  t.teardown(() => fs.rmSync(d, { recursive: true, force: true }))
  return d
}

test('ön kontrol: işlemci, RAM, disk seçimi sırası', (t) => {
  const k = OK.karar({ cpuinfo: CPU, meminfo: mem(15.5), lsblk: lsblk(disk('sda', 1000 * GB, { rota: true }), disk('sdb', 256 * GB), disk('nvme0n1', 512 * GB)), pil: true, tpmSurum: '2\n' })
  t.is(k.durdur, null)
  t.is(k.hedef.yol, '/dev/nvme0n1', 'önce NVMe')
  t.is(k.hedef.etiket, 'M-nvme0n1 · 512 GB · seri …E0N1')
  t.is(k.tpm, true)
  t.is(k.pil, true)
  t.alike(k.digerleri.length, 2)
  t.ok(k.uyarilar.includes(OK.MESAJ.digerDiskler))
  t.is(OK.karar({ cpuinfo: CPU, meminfo: mem(16), lsblk: lsblk(disk('sda', 2000 * GB, { rota: true }), disk('sdb', 128 * GB)), pil: false }).hedef.yol, '/dev/sdb', 'sonra SSD')
  t.is(OK.karar({ cpuinfo: CPU, meminfo: mem(16), lsblk: lsblk(disk('sda', 500 * GB, { rota: true }), disk('sdc', 2000 * GB, { rota: true })), pil: false }).hedef.yol, '/dev/sdc', 'sonra en büyük')
  t.is(OK.karar({ cpuinfo: CPU_ESKI, meminfo: mem(16), lsblk: lsblk(disk('sda', 500 * GB)), pil: false }).durdur, OK.MESAJ.islemci)
  t.is(OK.karar({ cpuinfo: CPU, meminfo: mem(3.2), lsblk: lsblk(disk('sda', 500 * GB)), pil: false }).durdur, OK.MESAJ.ram)
  const hafif = OK.karar({ cpuinfo: CPU, meminfo: mem(3.7), lsblk: lsblk(disk('sda', 500 * GB)), pil: false })
  t.is(hafif.durdur, null, '4 GB\'lık makine (MemTotal ~3,7 GiB) geçer')
  t.ok(hafif.uyarilar.includes(OK.MESAJ.ramHafif))
  t.is(OK.karar({ cpuinfo: CPU, meminfo: mem(16), lsblk: lsblk(disk('sda', 32 * GB)), pil: false }).durdur, OK.MESAJ.disk, '64 GB altı')
  t.is(OK.karar({ cpuinfo: CPU, meminfo: mem(16), lsblk: lsblk(), pil: false }).durdur, OK.MESAJ.disk, 'yalnız USB var')
  t.is(OK.karar({ cpuinfo: CPU, meminfo: mem(16), lsblk: lsblk(disk('sda', 500 * GB)), pil: false, tpmSurum: '1' }).tpm, false, 'TPM 1.2 sayılmaz')
  t.is(OK.hostAdi('A1b2'), 'havenfold-a1b2')
  t.exception(() => OK.hostAdi('xyz1'), /INVALID_HOSTNAME/)
})

const AI = fs.readFileSync(path.join(__dirname, '../build/nocloud/user-data'), 'utf8')
const PAROLA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRST'

test('otomatik kurulum dosyası: ağ adı ve depolama bölümü', (t) => {
  const y = D.hostAdiYaz(AI, 'havenfold-1f2e')
  t.ok(y.includes('hostname: havenfold-1f2e') && !y.includes('XXXX'))
  t.exception(() => D.hostAdiYaz(y, 'havenfold-0000'), /NO_PLACEHOLDER/)
  const z = D.depolamaEkle(y, { seri: 'S4EV NX0N[1]', yol: '/dev/nvme0n1', parola: PAROLA })
  t.ok(z.endsWith(`  storage:\n    layout:\n      name: lvm\n      match: { serial: "*S4EV?NX0N?1?*" }\n      password: "${PAROLA}"\n    swap: { size: 4294967296 }\n`), 'autoinstall: altında, iki boşluk girintili; glob karakterleri kaçışlı')
  t.exception(() => D.depolamaEkle(z, { seri: 'X', parola: null }), /STORAGE_EXISTS/)
  const duz = D.depolamaEkle('version: 1\nuser-data: {}\n', { seri: '', yol: '/dev/mmcblk0', parola: null })
  t.ok(duz.endsWith('storage:\n  layout:\n    name: lvm\n    match: { path: "/dev/mmcblk0" }\n  swap: { size: 4294967296 }\n'), 'üst anahtarsız dosya, seri yok: yol; TPM yok: parola yok')
  t.exception(() => D.depolamaEkle(AI, { seri: 'X', parola: 'kisa' }), /INVALID_PASSWORD/)
  t.exception(() => D.depolamaEkle(AI, { seri: '', yol: '/dev/sda; rm', parola: null }), /INVALID_DISK/)
})

test('otomatik kurulum dosyası: subiquity\'nin yazabileceği biçimler (JSON, akış eşlemesi, belge sonu)', (t) => {
  const g = { seri: 'HFTEST0001', yol: '/dev/nvme0n1', parola: PAROLA }
  const beklenen = { layout: { name: 'lvm', match: { serial: '*HFTEST0001*' }, password: PAROLA }, swap: { size: 4294967296 } }
  const j = JSON.parse(D.depolamaEkle('{"version": 1, "user-data": {"hostname": "havenfold-1f2e"}}\n', g))
  t.alike(j.storage, beklenen, 'JSON: storage üst düzeyde')
  t.is(j.version, 1)
  const s = JSON.parse(D.depolamaEkle('{"autoinstall": {"version": 1}}', g))
  t.alike(s.autoinstall.storage, beklenen, 'JSON, autoinstall sarmalı: içine')
  t.exception(() => D.depolamaEkle(JSON.stringify({ storage: {} }), g), /STORAGE_EXISTS/)
  const akis = D.depolamaEkle('{version: 1, user-data: {hostname: havenfold-1f2e}}\n', g)
  t.ok(akis.startsWith('{version: 1, user-data: {hostname: havenfold-1f2e}, "storage": {"layout":'), 'akış eşlemesi: son } öncesine JSON nesnesi')
  t.ok(akis.endsWith('"swap":{"size":4294967296}}}\n'))
  t.exception(() => D.depolamaEkle('{autoinstall: {version: 1}}', g), /FORMAT_UNSUPPORTED/)
  const son = D.depolamaEkle('version: 1\nuser-data:\n  hostname: havenfold-1f2e\n...\n', g)
  t.ok(son.startsWith('version: 1\nuser-data:\n  hostname: havenfold-1f2e\nstorage:\n  layout:\n'), 'belge sonu işareti atılır, bölüm belgenin içinde')
  t.absent(son.includes('...'))
  const bas = D.depolamaEkle('---\nversion: 1\n', { ...g, parola: null })
  t.ok(bas.startsWith('---\nversion: 1\nstorage:\n'), 'baştaki --- korunur')
})

const dump = (yuvalar, jetonlar) => JSON.stringify({ keyslots: Object.fromEntries(yuvalar.map((y) => [String(y), { type: 'luks2' }])), tokens: Object.fromEntries(jetonlar.map((j, i) => [String(i), { type: j[0], keyslots: j[1].map(String) }])), segments: {}, digests: {}, config: {} })
const clevis = (satirlar) => satirlar.map(([y, a]) => `${y}: tpm2 '${JSON.stringify({ hash: 'sha256', key: 'ecc', ...a })}'`).join('\n') + '\n'

test('LUKS planı: kurulum sonrası, ilk açılış, yarım kalan, PCR 7 değişmiş', (t) => {
  // Kurulum: yuva 0 geçici parola, yuva 1 PCR'sız Clevis
  const p1 = L.plan({ dump: dump([0, 1], [['clevis', [1]]]), clevis: clevis([[1, {}]]) })
  t.is(p1.durum, 'ilk')
  t.alike(p1.adimlar, ['kurtarma-ekle', 'pcr7-bagla', 'clevis-coz:1', 'yuva-sil:0'])
  t.is(p1.kaynakYuva, 1)
  // Kurtarma eklendi (yuva 2), PCR 7 bağı kurulmadan kesildi
  const p2 = L.plan({ dump: dump([0, 1, 2], [['clevis', [1]], [L.KURTARMA_TOKEN, [2]]]), clevis: clevis([[1, {}]]) })
  t.alike(p2.adimlar, ['pcr7-bagla', 'clevis-coz:1', 'yuva-sil:0'])
  // PCR 7 bağı kuruldu (yuva 3), eski bağ ve geçici yuva duruyor
  const p3 = L.plan({ dump: dump([0, 1, 2, 3], [['clevis', [1]], [L.KURTARMA_TOKEN, [2]], ['clevis', [3]]]), clevis: clevis([[1, {}], [3, L.PCR7]]), pcr7Acilir: true })
  t.is(p3.durum, 'temizle')
  t.alike(p3.adimlar, ['clevis-coz:1', 'yuva-sil:0'])
  // Tamam
  const son = dump([2, 3], [[L.KURTARMA_TOKEN, [2]], ['clevis', [3]]])
  t.is(L.plan({ dump: son, clevis: clevis([[3, L.PCR7]]), pcr7Acilir: true }).durum, 'tamam')
  // Güvenli Önyükleme değişti: PCR 7 bağı açılamıyor
  const p5 = L.plan({ dump: son, clevis: clevis([[3, L.PCR7]]), pcr7Acilir: false })
  t.is(p5.durum, 'yeniden-bagla')
  t.alike(p5.adimlar, ['kurtarma-sor', 'pcr7-bagla', 'clevis-coz:3'])
  t.is(L.plan({ dump: dump([0], []), clevis: '' }).durum, 'tpm-yok')
  t.is(L.plan({ dump: null, clevis: '' }).durum, 'luks-yok')
  t.exception(() => L.luksDumpCoz('{}'), /INVALID_LUKS_DUMP/)
  t.alike(L.clevisListeCoz("1: tpm2 '{\"pcr_ids\":\"0,7\"}'\nbozuk satır\n2: sss '{}'"), [{ yuva: 1, pin: 'tpm2', ayar: { pcr_ids: '0,7' } }, { yuva: 2, pin: 'sss', ayar: {} }])
})

test('kurtarma anahtarı: 32 bayt → 52 karakter Crockford base32 küçük harf, I L O U yok', (t) => {
  t.is(L.kurtarmaKodla(b4a.alloc(32)), '0'.repeat(52))
  const k = L.kurtarmaKodla(b4a.alloc(32, 0xff))
  t.is(k, 'z'.repeat(51) + 'g', 'son karakter 1 bit dolgu')
  const r = L.kurtarmaKodla(b4a.from('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex'))
  t.is(r.length, 52)
  t.ok(/^[0-9a-hjkmnp-tv-z]+$/.test(r))
  t.is(r, '000g40r40m30e209185gr38e1w8124gk2gahc5rr34d1p70x3rfg')
  t.is(L.kurtarmaGoster('abcdefgh12'), 'abcd efgh 12')
  // Codex 12. tur: konsolda yazılan anahtar Crockford kurallarıyla düzeltilir (ekrandaki öbek boşlukları, büyük harf,
  // O/0 ve I/L/1 karışıklığı); üç deneme hakkı yazım biçimine harcanmaz
  t.is(L.kurtarmaDuzelt(' ABCD efgh-1O2I 3L4 \n'), 'abcdefgh1021314')
  t.is(L.kurtarmaDuzelt(L.kurtarmaGoster(r).toUpperCase()), r)
  t.exception(() => L.kurtarmaKodla(b4a.alloc(31)), /INVALID_RECOVERY/)
  t.alike(JSON.parse(L.kurtarmaJetonu(2)), { type: 'havenfold-kurtarma', keyslots: ['2'] })
})

test('pil şarj sınırı: çekirdek arayüzü, üretici modu, yok', (t) => {
  const b = '/sys/class/power_supply/BAT0/charge_control_'
  t.alike(P.pilPlani([b + 'start_threshold', b + 'end_threshold']), { limit: 'cekirdek', limitStart: 60, limitStop: 80, yaz: [[b + 'start_threshold', '60'], [b + 'end_threshold', '80']] })
  t.alike(P.pilPlani([b + 'end_threshold']), { limit: 'cekirdek', limitStart: 0, limitStop: 80, yaz: [[b + 'end_threshold', '80']] }, 'yalnız bitiş')
  const iki = P.pilPlani([b + 'start_threshold', b + 'end_threshold', '/sys/class/power_supply/BAT1/charge_control_end_threshold'])
  t.is(iki.yaz.length, 3, 'iki pil')
  const u = P.pilPlani(['/sys/bus/platform/drivers/ideapad_acpi/VPC2004:00/conservation_mode'])
  t.is(u.limit, 'uretici')
  t.is(u.limitStop, 60)
  const yok = P.pilPlani([''])
  t.is(yok.limit, 'yok')
  t.ok(yok.uyari.includes('BIOS'))
})

test('laptop ve sistem dosyaları', (t) => {
  for (const s of ['HandleLidSwitch=ignore', 'HandleLidSwitchExternalPower=ignore', 'HandleLidSwitchDocked=ignore', 'HandleSuspendKey=ignore', 'HandleHibernateKey=ignore', 'IdleAction=ignore']) t.ok(P.LOGIND.split('\n').includes(s), s)
  t.alike(P.UYKU_HEDEFLERI, ['sleep.target', 'suspend.target', 'hibernate.target', 'hybrid-sleep.target', 'suspend-then-hibernate.target'])
  t.ok(P.GRUB.includes('consoleblank=60'))
  t.ok(P.UNATTENDED.includes('#clear Unattended-Upgrade::Allowed-Origins;') && P.UNATTENDED.includes('-security"') && P.UNATTENDED.includes('Automatic-Reboot "false"'))
  t.ok(P.SYSCTL.includes('vm.swappiness=10'))
  const usbK = P.nftKurallari({ kip: 'usb' })
  t.ok(usbK.includes('policy drop;') && usbK.includes('table inet havenfold {') && usbK.includes('ct state established,related accept') && usbK.includes('@hyperdht_udp'))
  const varK = P.nftKurallari({ kip: 'var-olan' })
  t.ok(varK.includes('policy accept;') && !varK.includes('policy drop'), 'var olan Ubuntu\'da SSH ve servisler engellenmez')
  t.exception(() => P.nftKurallari({ kip: 'x' }), /INVALID_MODE/)
  const toml = P.dugumToml({ rol: 'kutu', kanal: 'kararli', pil: { limit: 'cekirdek' } })
  t.ok(toml.includes('rol = "kutu"') && toml.includes('sinir = "cekirdek"') && toml.includes('baslangic = 60'))
  t.exception(() => P.dugumToml({ rol: 'kok' }), /INVALID_SETTINGS/)
})

test('ilk açılış: Wi-Fi netplan dosyası, parola kuralı, durum özeti, rol', (t) => {
  const n = I.netplanWifi({ arayuz: 'wlp2s0', ssid: 'Ev "ağı" \\ 5G', parola: 'gizli"parola\\1' })
  t.ok(n.includes('        "Ev \\"ağı\\" \\\\ 5G": { password: "gizli\\"parola\\\\1" }'), 'tırnak ve ters bölü kaçışlı')
  t.ok(I.netplanWifi({ arayuz: 'wlan0', ssid: 'Acik', parola: '' }).includes('"Acik": {}'))
  t.exception(() => I.netplanWifi({ arayuz: 'wl;rm', ssid: 'a', parola: '' }), /INVALID_INTERFACE/)
  t.exception(() => I.netplanWifi({ arayuz: 'wlan0', ssid: 'a', parola: 'kisa' }), /INVALID_PASSWORD/)
  t.exception(() => I.netplanWifi({ arayuz: 'wlan0', ssid: 'ş'.repeat(17), parola: '' }), /INVALID_SSID/, '32 bayttan uzun SSID')
  t.is(I.parolaDenetle('çok-güvenli!'), null, '12 karakter (Türkçe harf bir karakter)')
  t.ok(I.parolaDenetle('kısa'))
  t.ok(I.parolaDenetle('uzun:parola:olsa'))
  const o = I.durumOzeti({ ramBayt: 8 * 1024 ** 3, cekirdek: '6.8.0-45-generic', disk: { model: 'X', boyut: 512e9 }, tpm: 'yok', sifreleme: 'sifresiz', pil: { yuzde: 77, limit: 'yok' }, ag: 'wifi' })
  // Codex 12. tur: TPM bağı kurulamamış LUKS (hf-luks-yenile 'luks' yazar) "yok" görünmez
  t.ok(I.durumOzeti({ ramBayt: 0, cekirdek: '6.8', disk: null, tpm: 'var', sifreleme: 'luks', pil: null, ag: 'yok' }).satirlar[2].includes('Disk şifreleme: açık (TPM bağı yok'))
  t.ok(o.satirlar[0].includes('8 GB'))
  t.is(o.uyarilar.length, 4, 'TPM yok, Wi-Fi, pil sınırı yok, BIOS önerisi')
  t.alike(['', '1', 'İşçi', '2', 'birleşik', 'x'].map(I.rolSec), ['isci', 'isci', null, 'kutu', 'birlesik', null])
})

test('paket açma: kanonik ZIP, izinler, yetki yardımcısıyla uyumlu ilk durum', (t) => {
  const kok = geciciDizin(t)
  const zip = zipYaz([
    { ad: 'node', bytes: b4a.from('#!/bin/sh\n') },
    { ad: 'bin/havenfold', bytes: b4a.from('#!/bin/sh\n') },
    { ad: 'bare', bytes: b4a.from('bare') },
    { ad: 'deploy/sysusers.conf', bytes: b4a.from('u x - "x" -\n') }
  ])
  const ozet = 'ab'.repeat(32)
  const d = PK.paketAc({ kok, surum: '1.2.3', zipBaytlari: zip, bildirim: b4a.from('bildirim'), bildirimOzeti: ozet })
  t.is(d, path.join(kok, 'opt/havenfold/surumler/1.2.3'))
  t.is(fs.statSync(path.join(d, 'node')).mode & 0o777, 0o755)
  t.is(fs.statSync(path.join(d, 'bin/havenfold')).mode & 0o777, 0o755)
  t.is(fs.statSync(path.join(d, 'bare')).mode & 0o777, 0o755)
  t.is(fs.statSync(path.join(d, 'deploy/sysusers.conf')).mode & 0o777, 0o644)
  t.is(fs.readFileSync(path.join(d, '.dogrulandi'), 'utf8'), ozet)
  t.is(PK.paketAc({ kok, surum: '1.2.3', zipBaytlari: zip, bildirim: b4a.from('b'), bildirimOzeti: ozet }), d, 'aynı bildirimle yeniden: var olan dizin (havenfold-kur yeniden çalıştırılabilir)')
  t.exception(() => PK.paketAc({ kok, surum: '1.2.3', zipBaytlari: zip, bildirim: b4a.from('b'), bildirimOzeti: 'cd'.repeat(32) }), /VERSION_EXISTS/, 'başka bildirimle aynı sürüm')
  t.exception(() => PK.paketAc({ kok, surum: '1.2', zipBaytlari: zip, bildirim: b4a.from('b'), bildirimOzeti: ozet }), /INVALID_VERSION/)
  // Yetki yardımcısı kurulumun yazdığı durumu okuyabilmeli (node/privilege-helper.js durumOku)
  const y = path.join(kok, 'var/lib/havenfold/yetki')
  fs.mkdirSync(y, { recursive: true, mode: 0o700 })
  fs.chmodSync(y, 0o700)
  const kd = { keyEpoch: 1, rootPub: b4a.alloc(32, 1), nextRootHash: b4a.alloc(32, 2) }
  fs.writeFileSync(path.join(y, 'kok.durum'), c.encode(S.kokDurumuEnc, kd))
  fs.writeFileSync(path.join(y, 'yetki.durum'), PK.yetkiDurumu({ surum: '1.2.3', versionCode: 1002003, bildirimOzeti: ozet }))
  const durum = new YetkiYardimcisi({ kok }).durumOku()
  t.is(durum.enYuksek, 1002003)
  t.is(durum.kok.keyEpoch, 1)
  t.alike(durum.revoked, [])
  t.is(durum.deneme, null)
  // Yeniden kurulum (açılış öncesi inceleme): var olan durum korunur; düşük ya da geri çekilmiş sürüm kurulmaz
  const onceki = JSON.stringify({ ...JSON.parse(PK.yetkiDurumu({ surum: '1.2.3', versionCode: 1002003, bildirimOzeti: ozet })), revoked: [1002004], onayli: { x: 1 } })
  t.exception(() => PK.yetkiDurumu({ surum: '1.2.2', versionCode: 1002002, bildirimOzeti: ozet }, onceki), /VERSION_TOO_LOW/)
  t.exception(() => PK.yetkiDurumu({ surum: '1.2.4', versionCode: 1002004, bildirimOzeti: ozet }, onceki), /VERSION_REVOKED/)
  const birlesik = JSON.parse(PK.yetkiDurumu({ surum: '1.3.0', versionCode: 1003000, bildirimOzeti: ozet }, onceki))
  t.is(birlesik.enYuksek, 1003000)
  t.alike(birlesik.revoked, [1002004], 'geri çekilenler silinmez')
  t.alike(birlesik.onayli, { x: 1 })
  t.alike(Object.keys(birlesik.paketler).sort(), ['1.2.3', '1.3.0'])
  t.is(JSON.parse(PK.yetkiDurumu({ surum: '1.2.3', versionCode: 1002003, bildirimOzeti: ozet }, onceki)).enYuksek, 1002003, 'aynı sürüm yeniden kurulur')
  t.exception(() => PK.yetkiDurumu({ surum: '1.3.0', versionCode: 1003000, bildirimOzeti: ozet }, '{bozuk'), /PRIVILEGE_STATE_CORRUPT/)
  // Codex 5. tur: şema kesin (revoked: {} TypeError değil, bozuk durum)
  for (const d of [{ enYuksek: 1, revoked: {} }, { enYuksek: 1, bozuk: [1, 'x'] }, { enYuksek: -1 }, [], { enYuksek: 1, revoked: null }]) {
    t.exception(() => PK.yetkiDurumu({ surum: '1.3.0', versionCode: 1003000, bildirimOzeti: ozet }, JSON.stringify(d)), /PRIVILEGE_STATE_CORRUPT/, JSON.stringify(d))
  }
  // Kök durumu: var olanın dönemi düşük değilse var olan kalır
  const kok2 = c.encode(S.kokDurumuEnc, { ...kd, keyEpoch: 2 })
  const kok300 = c.encode(S.kokDurumuEnc, { ...kd, keyEpoch: 300 })
  t.is(PK.kokDonemi(kok300), 300)
  t.alike(PK.kokDurumuSec(c.encode(S.kokDurumuEnc, kd), kok2), kok2, 'döndürülmüş kök eski döneme geri yazılmaz')
  t.alike(PK.kokDurumuSec(kok300, kok2), kok300, 'yeni dönem alınır')
  t.alike(PK.kokDurumuSec(kok2, null), kok2, 'ilk kurulum')
  t.exception(() => PK.kokDurumuSec(b4a.alloc(0), kok2), /ROOT_STATE_CORRUPT/)
})

test('on-kontrol ile silme keşfi aynı lsblk ayrıştırıcısını kullanır', (t) => {
  const k = OK.karar({ cpuinfo: CPU, meminfo: mem(16), lsblk: JSON.stringify({ blockdevices: O.LSBLK.blockdevices.map((d) => d.type === 'disk' && d.tran !== 'usb' ? { ...d, size: d.size * 100000 } : d) }), pil: true })
  t.is(k.hedef.yol, '/dev/nvme0n1', 'Kurulum USB\'si, USB yedek disk ve eMMC boot bölümü aday değil')
})
