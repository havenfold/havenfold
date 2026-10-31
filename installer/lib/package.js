// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// lib/package.js — doğrulanmış düğüm paketinin hedefe açılması ve yetki yardımcısının ilk durumu (RFC-0007 §5, RFC-0026)
//
// Paket çekirdeğin kanonik ZIP'idir (core/export/zip.js; yetki yardımcısının paket-ac'ıyla aynı okuyucu ve aynı izinler:
// bin/ altı ve kökteki çalışma zamanları 0755, diğerleri 0644). Özet denetimi bu dosyadan önce yapılır: Kurulum
// USB'sinde derleme anında bildirimle (build/notification-check.js) ve kurulumda b2sum ile; var olan Ubuntu'da
// havenfold-kur imzayı ve özeti denetler. Burada yalnız açma var.
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

function zipModulu () {
  for (const p of ['../vendor/zip', '../../core/export/zip']) {
    try { return require(p) } catch (err) { if (err.code !== 'MODULE_NOT_FOUND') throw err }
  }
  throw new Error('NO_ZIP_READER')
}

const CALISTIRILABILIR = new Set(['node', 'bare'])
const SURUM_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

function fail (code) { throw new Error(code) }

// kok: hedef kök ('/target' ya da '/'). surum, bildirim (bayt), ozetHex (bildirim özeti). Dönüş: açılan dizin.
// Aynı sürüm aynı bildirimle zaten açıksa o dizin döner (havenfold-kur yeniden çalıştırılabilir); başka bildirimle açılmış
// aynı sürüm VERSION_EXISTS
function paketAc ({ kok, surum, zipBaytlari, bildirim, bildirimOzeti }) {
  if (!SURUM_RE.test(surum)) fail('INVALID_VERSION')
  if (!/^[0-9a-f]{64}$/.test(bildirimOzeti)) fail('INVALID_SUMMARY')
  const { zipOku } = zipModulu()
  const hedef = path.join(kok, 'opt/havenfold/surumler', surum)
  const gecici = hedef + '.yeni'
  fs.rmSync(gecici, { recursive: true, force: true })
  if (fs.existsSync(hedef)) {
    let ozet = null
    try { ozet = fs.readFileSync(path.join(hedef, '.dogrulandi'), 'utf8').trim() } catch {}
    if (ozet === bildirimOzeti) return hedef
    fail('VERSION_EXISTS')
  }
  fs.mkdirSync(gecici, { recursive: true, mode: 0o755 })
  try {
    for (const g of zipOku(zipBaytlari, { inflate: (b) => zlib.inflateRawSync(b) })) {
      const p = path.join(gecici, g.ad)
      if (!p.startsWith(gecici + path.sep)) fail('INVALID_PACKAGE')
      fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o755 })
      fs.writeFileSync(p, g.bytes, { flag: 'wx', mode: g.ad.startsWith('bin/') || CALISTIRILABILIR.has(g.ad) ? 0o755 : 0o644 })
    }
    fs.writeFileSync(path.join(gecici, '.dogrulandi'), bildirimOzeti, { mode: 0o644 })
    fs.writeFileSync(path.join(gecici, '.bildirim'), bildirim, { mode: 0o644 })
    fs.renameSync(gecici, hedef)
  } catch (err) {
    fs.rmSync(gecici, { recursive: true, force: true })
    throw err
  }
  return hedef
}

// /var/lib/havenfold/yetki/yetki.durum (node/privilege-helper.js _durum biçimi): kurulan sürüm doğrulanmış sürümdür.
// onceki: var olan yetki.durum (metin; var olan Ubuntu'da yeniden kurulum). Varsa korunur (RFC-0026 c tekdüzelik):
// en yüksek sürümden düşük (VERSION_TOO_LOW) ya da geri çekilmiş/bozuk işaretli sürüm (VERSION_REVOKED) kurulmaz;
// revoked, bozuk, onaylar ve görülenler silinmez (açılış öncesi inceleme).
function yetkiDurumu ({ surum, versionCode, bildirimOzeti }, onceki = null) {
  if (!SURUM_RE.test(surum) || !Number.isSafeInteger(versionCode)) fail('INVALID_VERSION')
  const yeni = { enYuksek: versionCode, revoked: [], bozuk: [], paketler: { [surum]: { versionCode, ozet: bildirimOzeti } }, onayli: {}, gorulen: {}, deneme: null, sonGecis: null }
  if (onceki === null || onceki === undefined || onceki === '') return JSON.stringify(yeni)
  let d
  try { d = JSON.parse(onceki) } catch { fail('PRIVILEGE_STATE_CORRUPT') }
  // Şema kesin (Codex 5. tur): enYuksek negatif olmayan tamsayı; revoked ve bozuk varsa tamsayı dizisi
  const liste = (x) => x === undefined || (Array.isArray(x) && x.every(Number.isSafeInteger))
  if (!d || typeof d !== 'object' || Array.isArray(d) || !Number.isSafeInteger(d.enYuksek) || d.enYuksek < 0 || !liste(d.revoked) || !liste(d.bozuk)) fail('PRIVILEGE_STATE_CORRUPT')
  if (versionCode < d.enYuksek) fail('VERSION_TOO_LOW')
  if ((d.revoked || []).includes(versionCode) || (d.bozuk || []).includes(versionCode)) fail('VERSION_REVOKED')
  return JSON.stringify({ ...yeni, ...d, enYuksek: Math.max(d.enYuksek, versionCode), paketler: { ...(d.paketler || {}), [surum]: { versionCode, ozet: bildirimOzeti } } })
}

// kok.durum'un ilk alanı keyEpoch (compact-encoding uint; node/release.js kokDurumuEnc). Bozuksa null
function kokDonemi (b) {
  if (!b || b.byteLength < 1) return null
  const k = b[0]
  if (k < 0xfd) return k
  const n = k === 0xfd ? 2 : k === 0xfe ? 4 : 8
  if (b.byteLength < 1 + n) return null
  let v = 0
  for (let i = n; i >= 1; i--) v = v * 256 + b[i]
  return v
}

// Kök anahtar durumu: yeni (USB ya da havenfold-kur'un gömülüsü) ve var olan. Var olanın dönemi düşük değilse var olan
// kalır: yeniden kurulum döndürülmüş kökü eski döneme geri yazmaz (RFC-0026 c, açılış öncesi inceleme)
function kokDurumuSec (yeni, eski = null) {
  if (kokDonemi(yeni) === null) fail('ROOT_STATE_CORRUPT')
  if (!eski) return yeni
  const e = kokDonemi(eski)
  return e !== null && e >= kokDonemi(yeni) ? eski : yeni
}

module.exports = { paketAc, yetkiDurumu, kokDurumuSec, kokDonemi, zipModulu }
