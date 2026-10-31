#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// box.js — Aile Kutusu çekirdeği (RFC-0007 §4.3, §9; RFC-0028 §7 d, j; D76)
//
// Kutunun kimliği ve durumu telefondaki çekirdekle aynı kalıcı katmandadır (@havenfold/worklet; rol `kutu`). Platform
// anahtarı (durum dosyasının şifresi) TPM'ye mühürlüdür: TPM'siz ya da başka makinede açılmaz. Taşıyıcı
// (@havenfold/transport) kutuda açıktır: kutu her zaman dinler, telefonlar kutuyu arar; önyükleme ortak HyperDHT
// düğümleri. Paylar ve kasa zarfı kopyaları TPM mühürlü dosyada (node/box-share.js).
// Yönetim soketi (`havenfold durum`, `havenfold katil`): <soket>, dizini 0750 havenfold-yonetim; Node'da SO_PEERCRED
// olmadığı için (İstek 107) erişimi dosya izni sınırlar.
//
// Ortam: HF_KUTU_DIZIN (/var/lib/havenfold/kutu), HF_KUTU_SOKET (/run/havenfold/kutu/yonetim.sock), HF_DISK
// (sifreli | sifresiz; RFC-0007 §8.6), HF_KUTU_ADI (törende görünen ad), HF_ONYUKLEME (JSON; yalnız test: yerel testnet),
// HF_TEST_KIPI=1 (yalnız test: taklit TPM, anahtarı dizinde), HF_AFET (acik | kapali; yoksa dugum.toml `afet`),
// HF_DBUS_ADRES (yalnız test: sistem veri yolu yerine özel dbus-daemon). Yalnız test olanlar üretimde (systemd, kök,
// havenfold-* kullanıcısı) TEST_ENV_IN_PRODUCTION ile reddedilir (test-env.js). Bu sürüm Node'da çalışır (Bare'e geçiş İstek 151).
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const net = require('net')
const b4a = require('b4a')
const sodium = require('sodium-native')
const { IPC } = require('./ipc/types')
const { cerceveYaz, mesajCoz, CerceveOkuyucu } = require('./ipc/frame')
const { KutuPaylari } = require('./box-share')
const { sistemTpm, taklitTpm } = require('./tpm')
const { kutuTasiyici } = require('./box-transport')
const SAS = require('./sas-names.json').adlar

const hex = (b) => (typeof b === 'string' ? b : b4a.toString(b, 'hex'))
function fail (code) { throw new Error(code) }
const TOREN_MS = 10 * 60_000

// Yalnız test değişkenleri systemd altında, kökken ya da havenfold-* kullanıcısıyla reddedilir (test-env.js)
// kok: platform dosyalarının öneki (disk şifrelemesi denetçiyle aynı kaynaktan: platform.js; HF_DISK verilirse o)
function ayarlar (env = process.env, { kok = '/', ...secenek } = {}) {
  require('./test-env').testOrtamiDenetle(env, { adlar: ['HF_TEST_KIPI', 'HF_ONYUKLEME', 'HF_DBUS_ADRES'], ...secenek })
  return {
    dizin: env.HF_KUTU_DIZIN || '/var/lib/havenfold/kutu',
    soket: env.HF_KUTU_SOKET || '/run/havenfold/kutu/yonetim.sock',
    disk: env.HF_DISK ? (env.HF_DISK === 'sifreli' ? 'sifreli' : 'sifresiz') : require('./platform').platformOku(kok).disk,
    ad: env.HF_KUTU_ADI || 'Aile Kutusu',
    onyukleme: env.HF_ONYUKLEME ? JSON.parse(env.HF_ONYUKLEME) : null,
    test: env.HF_TEST_KIPI === '1',
    torenMs: Number(env.HF_TOREN_MS) || TOREN_MS,
    afet: (env.HF_AFET || afetAyari('/')) === 'acik',
    dbusAdres: env.HF_DBUS_ADRES || null
  }
}

// dugum.toml'un ilk bölümünden `afet = "acik" | "kapali"` (D91; yoksa kapalı: Bluetooth'a dokunulmaz)
function afetAyari (kok) {
  let s
  try { s = fs.readFileSync(path.join(kok, 'etc/havenfold/dugum.toml'), 'utf8') } catch { return 'kapali' }
  for (const satir of s.split('\n')) {
    if (/^\s*\[/.test(satir)) break
    const m = /^\s*afet\s*=\s*"(acik|kapali)"\s*(#.*)?$/.exec(satir)
    if (m) return m[1]
  }
  return 'kapali'
}

function atomikYaz (yol, veri) {
  const gecici = yol + '.yeni'
  fs.writeFileSync(gecici, veri, { mode: 0o600 })
  fs.renameSync(gecici, yol)
}

// TPM: üretimde gerçek (tpm2-tools); test kipinde taklit, anahtarı dizinde (yeniden başlatma sınanabilsin)
function tpmAc (a) {
  if (!a.test) return { tpm: sistemTpm({ dizin: path.join(a.dizin, 'tpm') }), tur: 'var' }
  const yol = path.join(a.dizin, 'test-tpm.anahtar')
  if (!fs.existsSync(yol)) { const k = b4a.alloc(32); sodium.randombytes_buf(k); atomikYaz(yol, k) }
  return { tpm: taklitTpm({ test: true, anahtar: fs.readFileSync(yol) }), tur: 'taklit (test)' }
}

// Durum dosyasının şifresi: ilk açılışta üretilir, TPM'ye mühürlü saklanır
function platformAnahtari (a, tpm) {
  const yol = path.join(a.dizin, 'platform.muhur')
  if (fs.existsSync(yol)) return tpm.ac(fs.readFileSync(yol))
  const k = b4a.alloc(32)
  sodium.randombytes_buf(k)
  atomikYaz(yol, tpm.muhurle(k))
  return k
}

// Arşiv anahtar çifti (kalıcı katman ister; kutu kasa yazmaz): gizli yarı TPM'ye mühürlü, açık yarı çekirdeğe
function arsivAcik (a, tpm) {
  const yol = path.join(a.dizin, 'arsiv.muhur')
  let sk
  if (fs.existsSync(yol)) sk = tpm.ac(fs.readFileSync(yol))
  else {
    const pk = b4a.alloc(32)
    sk = b4a.alloc(32)
    sodium.crypto_box_keypair(pk, sk)
    atomikYaz(yol, tpm.muhurle(sk))
  }
  const pub = b4a.alloc(32)
  sodium.crypto_scalarmult_base(pub, sk)
  sodium.sodium_memzero(sk)
  return hex(pub)
}

// Uygulama kanalı yok: çekirdeğin istediği IPC bellek içinde, komut kabul etmez
function bosKanal () {
  const dinleyiciler = []
  return { on (e, f) { if (e === 'data') dinleyiciler.push(f) }, off () {}, write () {} }
}
function kutuSunucusu () {
  return { isle: async (metin) => { let id = null; try { id = JSON.parse(metin).id } catch {} return JSON.stringify({ id, hata: 'NO_COMMAND' }) }, olaylariBagla: () => () => {}, reddet: () => {} }
}

async function kutuyuBaslat (a = ayarlar()) {
  // Unix soket yolu sınırı: Linux'ta sun_path 108, macOS'ta 104 bayt (sonda NUL). Hiçbir şey açılmadan denetlenir
  if (b4a.byteLength(a.soket) > 103) fail('SOCKET_PATH_TOO_LONG')
  const { start: baslat } = require('../worklet')
  const { dhtAc } = require('@havenfold/transport')
  for (const d of [a.dizin, path.join(a.dizin, 'cekirdek'), path.join(a.dizin, 'pay')]) fs.mkdirSync(d, { recursive: true, mode: 0o700 })
  const { tpm, tur: tpmTur } = tpmAc(a)
  const anahtar = platformAnahtari(a, tpm)
  const archivePubHex = arsivAcik(a, tpm)
  const dht = dhtAc(a.onyukleme ? { bootstrap: a.onyukleme, firewalled: false } : {})
  let w = null
  const cihaz = () => (w ? w.tasiyiciCihazi({ ad: a.ad, cihazAdi: os.hostname() }) : null)
  const kt = kutuTasiyici({ dht, cihaz, deneysel: true, ...(a.test ? { yoklamaMs: 500, hizliMs: 500 } : {}) })
  let kp = null
  const paylar = () => {
    if (kp) return kp
    const n = w.kalici.nesneler
    if (!n.aile) fail('NO_FAMILY')
    kp = new KutuPaylari({ ledger: n.ledger, me: w.kalici.kimlik, dizin: path.join(a.dizin, 'pay'), tpm, testKipi: a.test })
    return kp
  }
  const kutuPay = {}
  for (const f of ['payAl', 'surumIstegiAl', 'payIstegiAl', 'zarfAl', 'zarfIstegiAl']) kutuPay[f] = (p, b, yol) => paylar()[f](p, b, yol)
  // Afet modu (RFC-0012 §10 adım 3; D90): aynı evdeki işçi UYARI'larını olağan yerel oturumla (AFET_MSG) bırakır; kutu
  // taşır ve ETKİN'e geçer. Kaynak doğrulanmış oturumun karşı tarafıdır (HELLO). dugum.toml `afet = "acik"` ise kutu
  // AfetDugum'u çalıştırır (D91): güç izleme ve BlueZ üstünden Bluetooth LE (sistem veri yolu, dbus-next). Yerel ağ afet
  // yolu bu sürümde bağlı değil; kutu telefonlarla olağan oturumda normal yoldan da verebilir.
  const { dbusUyarlayici } = require('./disaster/dbus-adapter')
  const afetKutu = kutuAfeti(() => w, { acik: a.afet, dbusOf: () => dbusUyarlayici(a.dbusAdres ? { adres: a.dbusAdres } : {}) })
  const ag = afetAgi(kt.ag, afetKutu, () => (w && w.kalici.nesneler.aile ? w.kalici.nesneler.ledger : null))
  w = await baslat({ urunSunucusu: kutuSunucusu, dizin: path.join(a.dizin, 'cekirdek'), anahtar, archivePubHex, ipc: bosKanal(), appId: 'havenfold-kutu', platform: 'kutu', torenTasiyici: kt.toren, ag, kutuPay })
  sodium.sodium_memzero(anahtar)
  kt.tasiyici.baslat()
  afetKutu()
  const k = { a, w, kt, dht, tpmTur, afet: afetKutu, paylar: () => (w.kalici.nesneler.aile ? paylar() : null), toren: null, davet: () => kt.toren.kutuDavet({ oturumla: true }) }
  k.durum = () => durumBilgisi(k)
  k.sunucu = await yonetimSoketi(k)
  k.kapat = async () => {
    try { k.sunucu.close() } catch {}
    try { if (k.toren) k.toren.oturum.cancel() } catch {}
    await kt.tasiyici.kapat()
    await afetKutu.durdur()
    w.kapat()
    await dht.destroy()
  }
  return k
}

// Düğümün afet saklaması (RFC-0012 §8.3 "cihaz yeniden başlasa da kaybolmaz"; Codex 12. tur): telefondaki gibi Kalici'nin
// şifreli durumunda (afetSaklama). Değişiklik en geç gecikmeMs sonra durum dosyasına yazılır (w.kaydet); worklet'in
// kendi tetikleri (komut, eşitleme) afet yolunda gelmeyebilir. Yalnız değer gerçekten değişince zamanlanır: w.kaydet()
// kayıttan önce afet deposunu yeniden yazar (kaydetmedenOnce → Depo.kaydet → set); aynı değer yeni zamanlayıcı kurmaz,
// yoksa kaydetme kendini sonsuza dek yeniden zamanlardı (Codex 13. tur). Kendi kaydetmemiz sırasında yazılan değer o
// kayda zaten girer (kaydetmedenOnce durum yazılmadan önce çalışır); onun için de yeniden zamanlanmaz
function afetSaklamasi (w, { gecikmeMs = 1000 } = {}) {
  const s = w.kalici.afetSaklama()
  let z = null
  let kaydediyor = false
  const metin = (v) => (v === undefined || v === null ? null : JSON.stringify(v))
  return {
    ...s,
    set (k, v) {
      const degisti = metin(s.get(k)) !== metin(v)
      s.set(k, v)
      if (!degisti || kaydediyor || z) return
      z = setTimeout(() => {
        z = null
        kaydediyor = true
        try { w.kaydet() } finally { kaydediyor = false }
      }, gecikmeMs)
      if (z.unref) z.unref()
    }
  }
}

// Kutunun afet modu (D90): aile varken bir kez kurulur; yoksa null. o.acik (D91): AfetDugum (güç izleyici ve, D-Bus
// açılırsa, Bluetooth); D-Bus açılamazsa ya da BlueZ yoksa afet yine çalışır, yalnız Bluetooth'suz. o.kok: sysfs öneki
function kutuAfeti (wOf, { acik = false, dbusOf = null, kok = '/', guc = null } = {}) {
  let api = null
  let dugum = null
  let dbus = null
  const f = () => {
    const w = wOf()
    if (!w || !w.kalici.nesneler.aile) return null
    if (!api) {
      const me = w.kalici.kimlik
      const defter = () => w.kalici.nesneler.ledger
      if (acik) {
        const { AfetDugum } = require('./disaster')
        try { dbus = dbusOf ? dbusOf() : null } catch (e) { console.error('afet: D-Bus açılamadı, Bluetooth yok:', e.message) }
        dugum = new AfetDugum({ me, defter, saklama: afetSaklamasi(w), dbus, kok, guc })
        dugum.baslat().catch((e) => console.error('afet: Bluetooth başlatılamadı (BlueZ?):', e.message))
        api = dugum.afet
      } else {
        const { DisasterApi } = require('@havenfold/sdk')
        api = new DisasterApi({ me, defter, saklama: afetSaklamasi(w) })
      }
    }
    return api
  }
  f.dugum = () => dugum
  f.durdur = async () => {
    try { if (dugum) await dugum.durdur() } catch {}
    if (dbus && dbus.kapat) dbus.kapat()
  }
  return f
}

// Taşıyıcının ağ kancasını sarar: bağlı cihazdan (işçi) gelen AFET_MSG kutunun afet moduna, gerisi worklet'e
function afetAgi (ag, afetKutu, ledgerOf) {
  const { zarf: { Z } } = require('@havenfold/core')
  return {
    gonder: (p, type, bytes) => ag.gonder(p, type, bytes),
    dinle: (isl) => ag.dinle({
      // Aile törenden sonra kurulduysa afet modu ilk oturumda başlar
      baglandi: (p, x) => { afetKutu(); return isl.baglandi(p, x) },
      koptu: (p) => isl.koptu(p),
      al: (p, type, bytes, yol) => {
        const L = ledgerOf()
        const api = afetKutu()
        if (type === Z.AFET_MSG && api && L && L.sessionRole(p) === 'cihaz') { api.fromWorker(bytes, p); return }
        return isl.al(p, type, bytes, yol)
      }
    })
  }
}

// Diskteki dosya parçaları (kutunun tuttuğu şifreli dosyalar)
function dosyaSayisi (a) {
  try { return fs.readdirSync(path.join(a.dizin, 'cekirdek', 'dosyalar')).filter((f) => /^[0-9a-f]{64}$/.test(f)).length } catch { return 0 }
}

// --- Durum (`havenfold durum`) -----------------------------------------------------------------------------------

function durumBilgisi (k) {
  const n = k.w.kalici.nesneler
  const L = n.aile ? n.ledger : null
  const me = hex(k.w.kalici.kimlik.memberId)
  const m = L ? L.members.get(me) : null
  const t = k.kt.tasiyici
  const oturum = [...t.oturumlar.values()].filter((o) => o.dogrulandi).length
  const kutu = n.aile ? k.w.kalici.kutu() : null
  const p = k.paylar()
  return {
    id: me,
    bagli: !!(m && m.active && m.role === 'kutu'),
    duzey: L ? String(L.level || '—') : null,
    oturum,
    aile: L ? { ad: L.familyName || '', uye: [...L.members.values()].filter((x) => x.active && x.role !== 'kutu').length } : null,
    tasiyici: { acik: !t.kapandi, dinleme: t.sunucular.size, oturum },
    depolama: { emanet: kutu ? [...kutu.cols.values()].reduce((s, x) => s + x.ops.size, 0) : 0, dosya: dosyaSayisi(k.a), pay: p ? p.liste().length : 0, zarf: p && p.zarfListesi ? p.zarfListesi().length : 0 },
    tpm: k.tpmTur,
    disk: k.a.disk,
    surum: require('./package.json').version,
    kanal: 'deneme',
    uyarilar: k.a.disk === 'sifresiz' ? ['disk şifresiz (RFC-0007 §8.6)'] : []
  }
}

// --- Tören (`havenfold katil`): QR, resimlerin adları, sonuç; QR süresi dolarsa 10 dakikaya kadar yenilenir --------

// birakildi(): isteyen bağlantı kapandı mı (komut kesilince tören bırakılır, yeni tören hemen başlayabilir).
// k.davet() → { qr, oturum }: kutuda kutuDavet, işçide isciDavet (node/worker.js aynı akışı kullanır)
async function katilAkisi (k, yaz, birakildi = () => false) {
  const n = k.w.kalici.nesneler
  if (n.aile) { yaz(IPC.KATIL_SONUC, { ok: false, code: 'ALREADY_IN_FAMILY' }); return }
  if (k.toren) { yaz(IPC.KATIL_SONUC, { ok: false, code: 'CEREMONY_IN_PROGRESS' }); return }
  const bitis = Date.now() + k.a.torenMs
  try {
    while (Date.now() < bitis && !birakildi()) {
      const d = await k.davet()
      k.toren = d
      if (birakildi()) { d.oturum.cancel(); return }
      const sonuc = await new Promise((resolve) => {
        const z = setTimeout(() => { d.oturum.cancel(); resolve({ ok: false, code: 'SURE' }) }, Math.max(0, bitis - Date.now()))
        d.oturum.on('sas', (x) => yaz(IPC.KATIL_QR, { qr: '', resimler: x.resimler.map((i) => SAS[i] || String(i)), kalanSn: Math.max(0, Math.round((bitis - Date.now()) / 1000)) }))
        d.oturum.on('tamam', () => { clearTimeout(z); resolve({ ok: true, code: '' }) })
        d.oturum.on('kapandi', (x) => { clearTimeout(z); resolve({ ok: false, code: x && x.neden ? String(x.neden) : 'kapandi' }) })
        yaz(IPC.KATIL_QR, { qr: d.qr, resimler: [], kalanSn: Math.min(d.oturum.ttlSec || 180, Math.round((bitis - Date.now()) / 1000)) })
      })
      k.toren = null
      if (sonuc.ok || sonuc.code !== 'sure') { yaz(IPC.KATIL_SONUC, sonuc.ok ? sonuc : { ok: false, code: sonuc.code === 'farkli' ? 'VERIFICATION_FAILED' : sonuc.code }); return }
    }
    yaz(IPC.KATIL_SONUC, { ok: false, code: 'SURE' })
  } finally { k.toren = null }
}

function yonetimSoketi (k) {
  const yol = k.a.soket
  fs.mkdirSync(path.dirname(yol), { recursive: true })
  try { fs.unlinkSync(yol) } catch {}
  const sunucu = net.createServer((s) => {
    const okuyucu = new CerceveOkuyucu()
    let kapali = false
    let torenim = false
    s.on('close', () => {
      kapali = true
      // Bu bağlantının başlattığı tören sürüyorsa bırakılır
      if (torenim && k.toren) { try { k.toren.oturum.cancel() } catch {} }
    })
    const yaz = (type, mesaj, reqId = 1) => { if (!s.destroyed) s.write(cerceveYaz(type, reqId, mesaj)) }
    s.on('error', () => {})
    s.on('data', (parca) => {
      let mesajlar
      try { mesajlar = okuyucu.besle(parca) } catch { s.destroy(); return }
      for (const b of mesajlar) {
        let m
        try { m = mesajCoz(b) } catch { yaz(IPC.HATA, { reqId: 0, code: 'INVALID_MESSAGE', detail: '' }); continue }
        if (m.type === IPC.DURUM_ISTE) yaz(IPC.DURUM_CEVAP, { json: JSON.stringify(k.durum()) }, m.reqId)
        else if (m.type === IPC.KATIL_BASLAT) { torenim = !k.toren; katilAkisi(k, (t, x) => yaz(t, x, m.reqId), () => kapali).finally(() => { torenim = false }).catch((err) => yaz(IPC.KATIL_SONUC, { ok: false, code: /^[A-Z_]+$/.test(err.message) ? err.message : 'INTERNAL_ERROR' }, m.reqId)) }
        else yaz(IPC.HATA, { reqId: m.reqId, code: 'UNSUPPORTED', detail: '' }, m.reqId)
      }
    })
  })
  return new Promise((resolve, reject) => {
    sunucu.once('error', reject)
    sunucu.listen(yol, () => {
      fs.chmodSync(yol, 0o660)
      // Soketin grubu dizininki (havenfold-yonetim): yönetici kullanıcı bu gruptaysa bağlanır
      try { fs.chownSync(yol, -1, fs.statSync(path.dirname(yol)).gid) } catch {}
      resolve(sunucu)
    })
  })
}

// Giriş: doğrudan (node box.js, var olan Ubuntu kipi) ya da paketteki cekirdek/kutu.js
function ana () {
  kutuyuBaslat().then((k) => {
    console.log('havenfold-kutu: başladı · kimlik ' + hex(k.w.kalici.kimlik.memberId).slice(0, 8) + ' · TPM ' + k.tpmTur + ' · soket ' + k.a.soket)
    const dur = () => { k.kapat().finally(() => process.exit(0)) }
    process.once('SIGTERM', dur)
    process.once('SIGINT', dur)
    // Testte ana süreç ölünce (stdin kapanır) kutu da kapanır: sahipsiz süreç kalmaz (D75)
    if (k.a.test) { process.stdin.on('end', dur); process.stdin.on('close', dur); process.stdin.resume() }
  }, (err) => {
    console.error('havenfold-kutu: başlatılamadı: ' + (err && err.message))
    process.exit(1)
  })
}

// İşçi çekirdeği (node/worker.js) TPM, platform anahtarı, boş uygulama kanalı, yönetim soketi ve tören akışını paylaşır;
// tpmAc, platformAnahtari ve arsivAcik havenfold ilk-ayar'da da kullanılır (setup.js)
module.exports = { afetAgi, afetAyari, afetSaklamasi, kutuAfeti, kutuyuBaslat, ayarlar, durumBilgisi, tpmAc, platformAnahtari, arsivAcik, ana, atomikYaz, bosKanal, kutuSunucusu, yonetimSoketi, katilAkisi }

if (require.main === module) ana()
