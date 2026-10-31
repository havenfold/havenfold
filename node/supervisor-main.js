// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// supervisor-main.js — denetçi sürecinin açılışı (RFC-0007 §4.1, §5, §6.1; havenfold-denetci.service → denetci/ana.js)
//
// Bağladıkları: Denetci (çekirdeklere bakan IPC işleyicileri), PodmanCalistirici (görev konteyneri), ipc/soket.dinle.
// Her kimlik için ayrı soket: /run/havenfold/denetci/<rol>.sock (RFC-0026 f). Hangi kimliklerin bulunduğu
// /etc/havenfold/dugum.toml'daki roldür (denetçi çekirdeklerin 0700 dizinlerine bakamaz).
//
// Karşı ucun kimliği (SO_PEERCRED) Node'da yok (İstek 107, sınırlar madde 9). Burada verilen karar (raporda da):
//   - kimlikBul dışarıdan verilirse o kullanılır;
//   - verilmezse ve düğümde tek kimlik varsa erişimi dosya izni sınırlar (box.js'in yönetim soketindeki gibi): soket
//     dizini 0750 havenfold-denetci:havenfold-cekirdek; o soketi kullanabilecek tek çalışan çekirdek bu roldür;
//   - birleşik düğümde (iki kimlik) dosya izni kutu ile işçiyi ayıramaz: denetçi NO_PEERCRED ile açılmaz.
// Soketler 0666 açılır: denetçi havenfold-cekirdek grubunda değildir, soketin grubunu değiştiremez; erişimi dizinin
// izni sınırlar.
//
// Yönetim soketi (`havenfold durum`): command.js YONETIM_SOKETI.denetci = /run/havenfold/denetci-yonetim/yonetim.sock.
// RFC-0007 §5 ve §6.1 tabloları /run/havenfold/denetci/yonetim.sock yazar; RFC-0026 f bu iki bölümü netleştirip
// /run/havenfold/denetci/'yi çekirdeklerin bağlandığı dizin yaptı (grup havenfold-cekirdek). Yönetim grubu o dizine
// giremediği için yönetim soketi ayrı dizindedir (tmpfiles: 2750 havenfold-denetci:havenfold-yonetim, setgid). Soket
// 0660; grubu setgid dizinden kendiliğinden gelir: denetçi havenfold-yonetim üyesi değildir (o grup çekirdeklerin yönetim
// soketlerine erişir; açılış güvenlik incelemesi).
//
// SAGLIK_ANLIK (RFC-0007 §6.3 satır 2): MERHABA cevabının hemen ardından işçiye bir kez gider. Gövdedeki `caps`
// tamponu bu uygulamada UTF-8 JSON'dur (NODE_CAPS'in ölçüm alanları ve kayıtlı imajlardan `tasks`); işçi kimliği, sırayı,
// durumu ve çalışan görevleri ekleyip imzalar (node/worker.js). 60 saniyelik yenileme yok: değişen alanları (boş bellek,
// yük, çalışma süresi) işçi aynı makinede kendisi ölçer; imaj listesi değişirse işçi yeniden bağlanınca alır.
//
// Bu sürümde bağlanmayanlar: güncelleme akışı (Guncelleyici) ve bildirimden imaj yükleme çağrısı
// (PodmanCalistirici.imajYukle hazır).
//
// Ortam: HF_KOK (yalnız test), HF_PODMAN_URL (varsayılan unix:///run/havenfold/podman/podman.sock; node/deploy/
// podman-havenfold.conf), HF_PODMAN (ikili, varsayılan PATH'teki podman).
'use strict'
const fs = require('fs')
const os = require('os')
const net = require('net')
const path = require('path')
const b4a = require('b4a')
const sodium = require('sodium-native')
const { Denetci, KULLANICI } = require('./supervisor')
const { PodmanCalistirici, kayitliTurler } = require('./podman')
const { dinle } = require('./ipc/socket')
const { IPC } = require('./ipc/types')
const { platformOku } = require('./platform')
const { cerceveYaz, mesajCoz, CerceveOkuyucu } = require('./ipc/frame')
const { YONETIM_SOKETI } = require('./command')
const { YETKI_SOKETI, yetkiIstemcisi } = require('./privilege-socket')
const S = require('./release')

function fail (code) { throw new Error(code) }
const PODMAN_URL = 'unix:///run/havenfold/podman/podman.sock'
const ROLLER = { isci: ['isci'], kutu: ['kutu'], birlesik: ['kutu', 'isci'] }

// dugum.toml'un ilk bölümünden `ad = "…"` (RFC-0007 §5; dosya kökündür, sır içermez)
function dugumAyari (kok, ad) {
  let s
  try { s = fs.readFileSync(path.join(kok, 'etc/havenfold/dugum.toml'), 'utf8') } catch { fail('NO_NODE_CONFIG') }
  for (const satir of s.split('\n')) {
    if (/^\s*\[/.test(satir)) break // ilk bölümden sonrası değil
    const m = new RegExp('^\\s*' + ad + '\\s*=\\s*"([a-z]+)"').exec(satir)
    if (m) return m[1]
  }
  return null
}

function dugumRolu (kok) {
  const r = dugumAyari(kok, 'rol')
  if (!ROLLER[r]) fail('INVALID_NODE_ROLE')
  return r
}

// Prizde mi ve pil (sysfs; yoksa prizde sayılır, pil bilinmiyor)
function guc (kok) {
  const ps = path.join(kok, 'sys/class/power_supply')
  let adlar = []
  try { adlar = fs.readdirSync(ps) } catch {}
  const oku = (...p) => { try { return fs.readFileSync(path.join(ps, ...p), 'utf8').trim() } catch { return null } }
  const priz = require('./disaster/power').prizdeMi({ adlar, oku }) // priz ve USB güç girişi, afet ile aynı kural (inceleme 22 madde 14)
  const bat = adlar.find((a) => oku(a, 'type') === 'Battery')
  const yuzde = bat ? Number(oku(bat, 'capacity')) : NaN
  const pilC = bat ? Math.round(Number(oku(bat, 'temp')) / 10) : NaN // onda bir °C; çoğu laptopta yok
  return {
    onAC: priz !== false,
    battery: Number.isInteger(yuzde) && yuzde >= 0 && yuzde <= 100 ? { percent: yuzde, healthPct: 0, cycles: Number(oku(bat, 'cycle_count')) || 0, tempC: Number.isInteger(pilC) && pilC > 0 && pilC < 150 ? pilC : 0 } : null
  }
}

// SAGLIK_ANLIK gövdesi: NODE_HEALTH ölçümleri (health.js olcumEnc) ve NODE_CAPS ölçümleri (JSON). Bilinmeyen alanlar
// sıfır ya da 'yok'. Sıcaklık sysfs'ten (temperature.js; okunamazsa 0), platform alanları platformOku'dan; disk sağlığı,
// SMART ve kurtarma anahtarının teslimi (recoveryDelivered) bu sürümde ölçülmez.
function saglikAnlik (a) {
  const surum = require('./package.json').version
  const g = guc(a.kok)
  const cpuC = require('./temperature').sicaklikOku(a.kok).cpuC ?? 0
  const pf = platformOku(a.kok)
  let disk = { toplam: 0, bos: 0 }
  try { const st = fs.statfsSync(path.join(a.kok, 'var/lib/havenfold')); disk = { toplam: Math.floor(st.blocks * st.bsize / 1e9), bos: Math.floor(st.bavail * st.bsize / 1e9) } } catch {}
  const olcum = {
    software: { product: 'havenfold-node', version: surum, versionCode: S.versionCode(surum), channel: dugumAyari(a.kok, 'kanal') === 'deneme' ? 'deneme' : 'kararli', keyEpoch: 0, rootFp: b4a.alloc(32), lastManifestAt: 0, update: 'guncel', pendingVersion: '', osSecurityPending: 0, rebootRequired: false },
    platform: { osRelease: os.release(), kernel: os.release(), secureBoot: pf.secureBoot, tpm: pf.tpm, disk: pf.disk, recoveryDelivered: false },
    power: { onAC: g.onAC, acLoss24h: 0, battery: g.battery ? { ...g.battery, limit: 'yok', limitStart: 0, limitStop: 0 } : null },
    thermal: { cpuMaxC: cpuC, hotMinutes24h: 0 },
    disks: [],
    net: { wired: true, wifiDbm: 0 },
    sleepGuard: { lid: false, targetsMasked: false },
    retire: 'yok'
  }
  const cpus = os.cpus()
  const caps = {
    os: 'linux', arch: os.arch(), cpuModel: (cpus[0] && cpus[0].model) || '', cores: cpus.length,
    ramTotalMB: Math.floor(os.totalmem() / 1048576), diskTotalGB: disk.toplam, diskFreeGB: disk.bos, accel: [],
    battery: g.battery ? { ...g.battery, onAC: g.onAC } : null, onAC: g.onAC, tempC: cpuC, tpm: pf.tpm !== 'yok',
    tasks: kayitliTurler(a.kok), storage: { holdGB: 0, blobGB: 0 }
  }
  return { olcum, caps: b4a.from(JSON.stringify(caps)) }
}

// Yönetim soketi: DURUM_ISTE → DURUM_CEVAP (command.js durumMetni'nin alanları). Kimliği dosya izni sınırlar.
function yonetimSoketi (a, d, uyarilar) {
  const yol = path.join(a.kok, YONETIM_SOKETI.denetci)
  if (b4a.byteLength(yol) > 103) fail('SOCKET_PATH_TOO_LONG')
  try { fs.unlinkSync(yol) } catch {}
  const sunucu = net.createServer((s) => {
    const okuyucu = new CerceveOkuyucu()
    s.on('error', () => {})
    s.on('data', (parca) => {
      let mesajlar
      try { mesajlar = okuyucu.besle(parca) } catch { s.destroy(); return }
      for (const b of mesajlar) {
        let m
        try { m = mesajCoz(b) } catch { s.write(cerceveYaz(IPC.HATA, 0, { reqId: 0, code: 'INVALID_MESSAGE', detail: '' })); continue }
        if (m.type !== IPC.DURUM_ISTE) { s.write(cerceveYaz(IPC.HATA, m.reqId, { reqId: m.reqId, code: 'UNSUPPORTED', detail: '' })); continue }
        const durum = {
          surum: require('./package.json').version,
          kanal: dugumAyari(a.kok, 'kanal') || 'kararli',
          gorevler: [...d.gorevler.values()].map((g) => g.type),
          uyarilar
        }
        s.write(cerceveYaz(IPC.DURUM_CEVAP, m.reqId, { json: JSON.stringify(durum) }))
      }
    })
  })
  return new Promise((resolve, reject) => {
    sunucu.once('error', reject)
    sunucu.listen(yol, () => {
      fs.chmodSync(yol, 0o660) // grup setgid dizinden (chown gerekmez; denetçi o grubun üyesi değil)
      resolve(sunucu)
    })
  })
}

// host.id (RFC-0007 §3): kurulumda üretilir; yoksa ilk açılışta 16 rastgele bayt
function hostId (kok) {
  const p = path.join(kok, 'var/lib/havenfold/denetci/host.id')
  try {
    const b = fs.readFileSync(p)
    if (b.byteLength !== 16) fail('HOST_ID_CORRUPT')
    return b
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
    const b = b4a.alloc(16)
    sodium.randombytes_buf(b)
    fs.writeFileSync(p, b, { flag: 'wx', mode: 0o600 })
    return b
  }
}

function ayarlar (env = process.env, secenek = {}) {
  require('./test-env').testOrtamiDenetle(env, { adlar: ['HF_KOK'], ...secenek }) // yalnız test: üretimde reddedilir
  return { kok: env.HF_KOK || '/', podmanUrl: env.HF_PODMAN_URL || PODMAN_URL, podman: env.HF_PODMAN || 'podman' }
}

// yetki(islem, girdi) → Promise: yetki yardımcısının işlemi. Verilmezse yardımcının soketine bağlanan istemci
// (/run/havenfold/yetki/yetki.sock, kök öneki a.kok; privilege-socket.js): dizine yalnız denetçi girer, yardımcı isteği
// denetçi sayar (RFC-0033 §9 l). Yardımcı açılamazsa istek NO_PERMISSION ile düşer.
async function denetciyiBaslat (a = ayarlar(), { kimlikBul = null, calistirici = null, uyar = (s) => console.error(s), yetki = null } = {}) {
  const roller = ROLLER[dugumRolu(a.kok)]
  const uyarilar = []
  let bul = kimlikBul
  if (!bul) {
    if (roller.length > 1) fail('NO_PEERCRED')
    uyar('havenfold-denetci: uyarı: SO_PEERCRED yok (İstek 107); ' + roller[0] + ' soketine erişimi dosya izni sınırlar')
    uyarilar.push('SO_PEERCRED yok')
    bul = () => KULLANICI[roller[0]]
  }
  const p = calistirici || new PodmanCalistirici({ podman: a.podman, url: a.podmanUrl, kok: a.kok })
  const saglik = (kapsam) => (kapsam === 'isci' ? saglikAnlik(a) : null)
  // Kurtarma anahtarını işçi okur; tek kimlikli kutu düğümünde kutu (RFC-0007 §6.3 tür 22)
  const kurtarmaKapsami = roller.includes('isci') ? 'isci' : 'kutu'
  const d = new Denetci({ kok: a.kok, hostId: hostId(a.kok), surum: require('./package.json').version, ...p.kancalar(), saglik, yetki: yetki || yetkiIstemcisi(path.join(a.kok, YETKI_SOKETI)), kurtarmaKapsami })
  // RFC-0012 §10: güç değişince (prizden kesinti, priz dönüşü, pil) işçiye SAGLIK_ANLIK yeniden gider; pille çalışan
  // düğüm görev kabul etmez (health.js 'pil'). Elektrik kesintisi UYARI'sı işçinindir (2 dk; Yuva Kutusu ile).
  // İnceleme 23 madde 8: önceki çalışmadan kalan akış pod'ları (görevi olmayan) süpürülür
  if (typeof p.akisPodlariSupur === 'function') p.akisPodlariSupur(new Set(d.gorevler.keys())).catch(() => {})
  const { GucIzleyici } = require('./disaster/power')
  const guc = new GucIzleyici({ kok: a.kok, olay: () => { try { d.saglikYenile('isci') } catch {} } }).baslat()
  const sunucular = [await yonetimSoketi(a, d, uyarilar)]
  for (const rol of roller) {
    const yol = path.join(a.kok, 'run/havenfold/denetci', rol + '.sock')
    if (b4a.byteLength(yol) > 103) fail('SOCKET_PATH_TOO_LONG')
    sunucular.push(await dinle({ yol, uc: d.uc(rol), kimlikBul: bul, izin: 0o666 }))
  }
  return {
    a,
    denetci: d,
    calistirici: p,
    roller,
    guc,
    kapat: async () => {
      guc.durdur()
      for (const s of sunucular) try { s.close() } catch {}
      await p.kapat()
    }
  }
}

// Giriş (denetci/ana.js)
function ana () {
  denetciyiBaslat().then((k) => {
    console.log('havenfold-denetci: başladı · roller ' + k.roller.join(', ') + ' · host ' + b4a.toString(k.denetci.hostId, 'hex').slice(0, 8))
    const dur = () => { k.kapat().finally(() => process.exit(0)) }
    process.once('SIGTERM', dur)
    process.once('SIGINT', dur)
  }, (err) => {
    console.error('havenfold-denetci: başlatılamadı: ' + (err && err.message))
    process.exit(1)
  })
}

module.exports = { denetciyiBaslat, ayarlar, dugumRolu, dugumAyari, hostId, saglikAnlik, PODMAN_URL, ana }
