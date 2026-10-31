// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// setup.js — `havenfold ilk-ayar` (RFC-0007 §8.3 late-commands, §9 adım 7, §5)
//
//   havenfold setup --install                 kurulumda (hf-hedefe-kur): hostId üretilir; rol henüz seçilmedi
//   havenfold setup --role isci|kutu|birlesik  ilk açılışta (hf-ilk-acilis): rolün kimlikleri üretilir ve mühürlenir
//   (eski adlar: ilk-ayar, --kurulum, --rol; kurulum betikleri bunları kullanır)
//
// Kimlik yeniden yazılmaz: kutu çekirdeğinin (box.js) ve telefonun kullandığı kalıcı katman (worklet/persistence.js Kalici)
// ilk açılışta createIdentity ile üretir. Burada aynı katman aynı biçimde açılır: <rol dizini>/cekirdek, platform
// anahtarı TPM'ye mühürlü (platform.muhur), Arşiv anahtarı TPM'ye mühürlü (arsiv.muhur); yardımcılar box.js'ten.
// Birleşik cihazda iki kimlik ayrı kullanıcı, ayrı dizin, ayrı anahtar dosyasıyla (§4.2).
//
// <rol dizini>/kimlik: systemd birimlerinin ConditionPathExists işareti. Sır taşımaz: { v, rol, memberId, tpm }.
// tpm: 'muhur-ok' mühürle–aç–karşılaştır denemesi geçtiyse (§5; NODE_HEALTH.platform.tpm), test kipinde 'taklit'.
// İkinci çağrı var olan kimliği değiştirmez: Kalici var olan kimliği açar, işaret aynı memberId ile kalır.
// Kök olarak çalışınca dizinler rol kullanıcısına (havenfold-<rol>), host.id havenfold-denetci'ye verilir.
//
// Kök yazımları (açılış güvenlik incelemesi, madde 4): rol ve denetçi dizinleri başka kullanıcınındır; o kullanıcı
// dizine sembolik bağ, sabit bağ ya da FIFO bırakmış olabilir ve kök onu izlerse sistem dosyası yazılır ya da sahibi
// değişir. Bu yüzden kök (1) /var/lib/havenfold'a kadar her bileşenin sembolik bağ olmayan, kökün ve başkasına yazılmaz
// dizin olduğunu denetler; (2) dizini yukarıdan aşağı kendine alır (lchown 0:0, 0700) — bir girdinin yerine bağ konamaz,
// çünkü girdinin durduğu dizin artık kökündür; (3) ağaçta sembolik bağ (SEMBOLIK_BAG), birden çok bağlı dosya
// (SABIT_BAG) ya da düzenli dosya, dizin ve soket dışında girdi (DOSYA_TURU) varsa durur; (4) yazar: O_CREAT | O_EXCL |
// O_NOFOLLOW geçici dosya, sonra rename; (5) sahipliği aşağıdan yukarı (önce içerik, sonra dizin) geri verir ve yalnız
// kökün dizinlerine iner. Sahipliğin alınması kökken yapılır; denetimler (1, 3, 4) her zaman çalışır.
const fs = require('fs')
const path = require('path')
const b4a = require('b4a')
const sodium = require('sodium-native')

const ROLLER = { isci: ['isci'], kutu: ['kutu'], birlesik: ['kutu', 'isci'] } // birleşikte önce kutu (§4.2)
const KOD = { TAMAM: 0, KULLANIM: 1, YETKI: 2, DURUM: 3 }

function fail (code) { throw new Error(code) }
const hex = (b) => b4a.toString(b, 'hex')

const C = fs.constants

// Yeni dosya: O_EXCL | O_NOFOLLOW ile rastgele adlı geçici dosya (var olan bağı izlemez, üstüne yazmaz), sonra rename
// (rename hedefteki bağı izlemez, yerini alır)
function atomikYaz (yol, veri, mod = 0o600) {
  const ek = b4a.alloc(8)
  sodium.randombytes_buf(ek)
  const gecici = yol + '.yeni-' + hex(ek)
  const fd = fs.openSync(gecici, C.O_WRONLY | C.O_CREAT | C.O_EXCL | C.O_NOFOLLOW, mod)
  try {
    fs.writeSync(fd, veri)
    fs.fsyncSync(fd)
  } catch (err) {
    fs.closeSync(fd)
    try { fs.unlinkSync(gecici) } catch {}
    throw err
  }
  fs.closeSync(fd)
  fs.renameSync(gecici, yol)
}

// Var olan düzenli dosyayı bağ izlemeden okur
function guvenliOku (yol) {
  const s = fs.lstatSync(yol)
  if (s.isSymbolicLink()) fail('SEMBOLIK_BAG:' + yol)
  if (!s.isFile()) fail('DOSYA_TURU:' + yol)
  if (s.nlink > 1) fail('SABIT_BAG:' + yol)
  const fd = fs.openSync(yol, C.O_RDONLY | C.O_NOFOLLOW)
  try { return fs.readFileSync(fd) } finally { fs.closeSync(fd) }
}

// Sahiplik işlemleri (test bunları kaydedici kancayla değiştirir; kökUid kökün kimliği)
const SAHIPLIK = { lchown: (p, u, g) => fs.lchownSync(p, u, g), chmod: (p, m) => fs.chmodSync(p, m), kokUid: 0 }

// (1) kok'tan hedefin üstüne kadar her bileşen: yoksa kurulur (0755); sembolik bağ ya da dizin değilse ya da (kökken)
// kökün olmayan ya da grup/başkasına yazılabilen dizinse hata
function ataDenetle (kok, hedef, { kokMu, izin = SAHIPLIK }) {
  const goreli = path.relative(kok, path.dirname(hedef))
  if (goreli.startsWith('..') || path.isAbsolute(goreli)) fail('INVALID_PATH')
  let p = kok
  for (const parca of goreli ? goreli.split(path.sep) : []) {
    p = path.join(p, parca)
    let s
    try { s = fs.lstatSync(p) } catch (err) {
      if (err.code !== 'ENOENT') throw err
      fs.mkdirSync(p, { mode: 0o755 })
      s = fs.lstatSync(p)
    }
    if (s.isSymbolicLink()) fail('SEMBOLIK_BAG:' + p)
    if (!s.isDirectory()) fail('DOSYA_TURU:' + p)
    if (kokMu && (s.uid !== izin.kokUid || (s.mode & 0o022))) fail('DIZIN_IZNI:' + p)
  }
}

// (2) Dizini (yoksa kurup) köke alır; önceki sahibi ve izni döner ({ uid, gid, mode } ya da yeni kurulduysa null)
function dizinAl (yol, { kokMu, izin = SAHIPLIK }) {
  let yeni = false
  try { fs.mkdirSync(yol, { mode: 0o700 }); yeni = true } catch (err) { if (err.code !== 'EEXIST') throw err }
  const s = fs.lstatSync(yol)
  if (s.isSymbolicLink()) fail('SEMBOLIK_BAG:' + yol)
  if (!s.isDirectory()) fail('DOSYA_TURU:' + yol)
  if (kokMu) {
    izin.lchown(yol, izin.kokUid, 0)
    izin.chmod(yol, 0o700) // girdi artık değiştirilemez (üstü kökün): chmod'un bağ izlemesi sorun değil
  }
  return yeni ? null : { uid: s.uid, gid: s.gid, mode: s.mode & 0o7777 }
}

// (2, 3) Ağacı yukarıdan aşağı köke alır ve denetler
function agacAl (yol, a) {
  for (const ad of fs.readdirSync(yol)) {
    const p = path.join(yol, ad)
    const s = fs.lstatSync(p)
    if (s.isSymbolicLink()) fail('SEMBOLIK_BAG:' + p)
    if (s.isDirectory()) { dizinAl(p, a); agacAl(p, a) } else if (s.isFile()) { if (s.nlink > 1) fail('SABIT_BAG:' + p) } else if (!s.isSocket()) fail('DOSYA_TURU:' + p)
  }
}

// /etc/passwd'den kullanıcı ve birincil grup (getent yerine; sistem kullanıcıları yereldir: systemd-sysusers)
function kullanici (ad, passwd = '/etc/passwd') {
  let metin = ''
  try { metin = fs.readFileSync(passwd, 'utf8') } catch { return null }
  for (const satir of metin.split('\n')) {
    const p = satir.split(':')
    if (p[0] === ad && p.length >= 4) return { uid: Number(p[2]), gid: Number(p[3]) }
  }
  return null
}

// (5) Sahipliği aşağıdan yukarı verir: önce içerik, sonra dizin. Yalnız kökün dizinine iner (onun girdisini başkası
// değiştiremez); lchown bağı izlemez. siki: bağ ya da sabit bağ görünce hata (başarı yolu); değilse atlar (hata yolu).
function sahiplikVer (yol, ad, { kokMu, passwd, siki = true, izin = SAHIPLIK }) {
  if (!kokMu) return
  const k = kullanici(ad, passwd)
  if (!k) fail('KULLANICI_YOK:' + ad)
  const gez = (p) => {
    const s = fs.lstatSync(p)
    if (s.isSymbolicLink()) { if (siki) fail('SEMBOLIK_BAG:' + p); return }
    if (s.isFile() && s.nlink > 1) { if (siki) fail('SABIT_BAG:' + p); return }
    if (s.isDirectory()) {
      if (s.uid !== izin.kokUid) { if (siki) fail('DIZIN_IZNI:' + p); return }
      for (const x of fs.readdirSync(p)) gez(path.join(p, x))
    }
    izin.lchown(p, k.uid, k.gid)
  }
  gez(yol)
}

// hostId (§3): kurulumda üretilen rastgele 16 bayt; donanım seri numarasından türetilmez. Varsa dokunulmaz.
// Denetçinin dizini yalnız iş süresince köke alınır, sonra önceki sahibine ve iznine döner (ağaç gezilmez).
function hostIdYaz ({ kok = '/', kokMu = false, passwd, izin = SAHIPLIK } = {}) {
  const d = path.join(kok, 'var/lib/havenfold/denetci')
  const yol = path.join(d, 'host.id')
  ataDenetle(kok, d, { kokMu, izin })
  const once = dizinAl(d, { kokMu, izin })
  try {
    let s = null
    try { s = fs.lstatSync(yol) } catch (err) { if (err.code !== 'ENOENT') throw err }
    if (s) {
      const b = guvenliOku(yol)
      if (b.byteLength !== 16) fail('HOST_ID_CORRUPT')
      return { hostId: hex(b), yeni: false }
    }
    const b = b4a.alloc(16)
    sodium.randombytes_buf(b)
    atomikYaz(yol, b)
    sahiplikVer(yol, 'havenfold-denetci', { kokMu, passwd, izin })
    return { hostId: hex(b), yeni: true }
  } finally {
    if (kokMu && once) { izin.lchown(d, once.uid, once.gid); izin.chmod(d, once.mode) }
  }
}

// Tek rolün kimliği. Dönüş: { rol, memberId, tpm, yeni }
function kimlikOlustur (rol, { kok = '/', test = false, kokMu = false, passwd, now = Date.now, izin = SAHIPLIK, tpmAc } = {}) {
  if (!['kutu', 'isci'].includes(rol)) fail('INVALID_ROLE')
  const dizin = path.join(kok, 'var/lib/havenfold', rol)
  ataDenetle(kok, dizin, { kokMu, izin })
  dizinAl(dizin, { kokMu, izin })
  let tamam = false
  try {
    agacAl(dizin, { kokMu, izin })
    for (const d of [path.join(dizin, 'cekirdek'), path.join(dizin, 'pay')]) dizinAl(d, { kokMu, izin })
    const r = kimlikAgacta(rol, dizin, { test, now, kok, tpmAc })
    sahiplikVer(dizin, 'havenfold-' + rol, { kokMu, passwd, izin })
    tamam = true
    return r
  } finally {
    // Hata yolunda da dizin rol kullanıcısına döner (yalnız kökün dizinlerine inilir, bağlar atlanır)
    if (!tamam && kokMu) try { sahiplikVer(dizin, 'havenfold-' + rol, { kokMu, passwd, siki: false, izin }) } catch {}
  }
}

// Ağaç kökün ve denetlenmişken: kimlik, TPM mühürleri ve işaret. TPM'siz işçi (RFC-0007 §8.4 madde 7): yalnız TPM
// aygıtı yokken, işçinin kendi yoluyla (worker.js tpmsizMi, tpmsizAnahtarlar): anahtarlar diskte, şifresiz dosyada; işaret
// tpm: 'yok'. Aygıt varken TPM hatası yukarı çıkar (şifresiz dosyaya düşülmez). Kutu TPM ister (NO_TPM).
// tpmAc yalnız testte verilir (box.js tpmAc'in yerine)
function kimlikAgacta (rol, dizin, { test, now, kok = '/', tpmAc = require('./box').tpmAc }) {
  const { platformAnahtari, arsivAcik } = require('./box')
  const { Kalici } = require('../worklet/persistence')
  const isaret = path.join(dizin, 'kimlik')
  let onceki = null
  if (fs.existsSync(isaret)) {
    try { onceki = JSON.parse(guvenliOku(isaret).toString('utf8')) } catch (err) { if (/^(SEMBOLIK_BAG|SABIT_BAG|DOSYA_TURU)/.test(err.message)) throw err; fail('IDENTITY_MARKER_CORRUPT') }
  }
  const a = { dizin, test }
  const I = require('./worker')
  let tpm = null
  let tur = 'yok'
  if (rol !== 'isci' || !I.tpmsizMi(a, kok)) ({ tpm, tur } = tpmAc(a))
  let muhurOk = false
  let anahtar
  let archivePubHex
  if (tpm) {
    // Mühürle–aç–karşılaştır (RFC-0004 §3.1 "mühürlemenin başarılı olduğu doğrulanmalı")
    const deneme = b4a.alloc(32)
    sodium.randombytes_buf(deneme)
    muhurOk = b4a.equals(tpm.ac(tpm.muhurle(deneme)), deneme)
    anahtar = platformAnahtari(a, tpm)
    archivePubHex = arsivAcik(a, tpm)
  } else {
    ({ anahtar, archivePubHex } = I.tpmsizAnahtarlar(a, { yaz: atomikYaz, oku: guvenliOku }))
  }
  let kalici
  try {
    kalici = new Kalici({ dizin: path.join(dizin, 'cekirdek'), anahtar, archivePubHex, platform: rol, appId: 'havenfold-' + rol, now })
  } finally { sodium.sodium_memzero(anahtar) }
  const memberId = hex(kalici.kimlik.memberId)
  kalici.kapat()
  if (onceki && onceki.memberId !== memberId) fail('IDENTITY_MISMATCH') // işaret başka bir kimliği gösteriyor: dokunulmaz
  const bilgi = { v: 1, rol, memberId, tpm: !tpm ? 'yok' : test ? 'taklit' : muhurOk ? 'muhur-ok' : 'var' }
  if (tpm && !test && !muhurOk) fail('TPM_SEAL_FAILED')
  if (!onceki) atomikYaz(isaret, JSON.stringify(bilgi) + '\n')
  return { rol, memberId, tpm: bilgi.tpm, tpmTur: tur, yeni: !onceki }
}

function ilkAyar ({ rol = null, kurulum = false, kok = '/', test = false, kokMu = typeof process.getuid === 'function' && process.getuid() === 0, passwd, now, izin, tpmAc } = {}) {
  const host = hostIdYaz({ kok, kokMu, passwd, izin })
  if (kurulum) return { hostId: host.hostId, kimlikler: [] }
  if (!ROLLER[rol]) fail('INVALID_ROLE')
  return { hostId: host.hostId, kimlikler: ROLLER[rol].map((r) => kimlikOlustur(r, { kok, test, kokMu, passwd, now, izin, tpmAc })) }
}

// command.js kancası. Ortam (yalnız test): HF_KOK (kök öneki), HF_TEST_KIPI=1 (taklit TPM). İkisi de systemd altında,
// kökken ya da havenfold-* kullanıcısıyla reddedilir (test-env.js): kök ilk ayarı her zaman gerçek TPM ve / ile yapar.
async function ana (arg, { yaz = (s) => console.log(s), env = process.env, getuid = process.getuid, passwd } = {}) {
  // --install ve --role; --kurulum ve --rol eski adlar (kurulum betikleri)
  const kurulum = arg.includes('--install') || arg.includes('--kurulum')
  const i = arg.findIndex((x) => x === '--role' || x === '--rol')
  const rol = i >= 0 ? arg[i + 1] : null
  if (!kurulum && !ROLLER[rol]) { yaz('Kullanım: havenfold setup --role isci|kutu|birlesik | --install'); return KOD.KULLANIM }
  try { require('./test-env').testOrtamiDenetle(env, { adlar: ['HF_KOK', 'HF_TEST_KIPI'], getuid, passwd }) } catch (err) {
    yaz('havenfold ilk-ayar: HF_TEST_KIPI ve HF_KOK yalnız testte (' + err.message + ').')
    return KOD.YETKI
  }
  const test = env.HF_TEST_KIPI === '1'
  const kokMu = typeof getuid === 'function' && getuid() === 0
  if (!kokMu && !test) { yaz('havenfold ilk-ayar kök yetkisi ister (sudo).'); return KOD.YETKI }
  try {
    const r = ilkAyar({ rol, kurulum, kok: env.HF_KOK || '/', test, kokMu })
    yaz(`hostId ${r.hostId.slice(0, 8)}`)
    for (const k of r.kimlikler) yaz(`${k.rol === 'kutu' ? 'Kutu' : 'İşçi'} kimliği ${k.memberId.slice(0, 8)} · TPM ${k.tpm}${k.yeni ? '' : ' (var olan)'}`)
    return KOD.TAMAM
  } catch (err) {
    yaz('İlk ayar yapılamadı: ' + err.message)
    return KOD.DURUM
  }
}

module.exports = { ilkAyar, kimlikOlustur, hostIdYaz, kullanici, ana, ROLLER, sahiplikVer, atomikYaz, SAHIPLIK }
