#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// release-sign.js — sürüm bildiriminin ve SHA256SUMS'un çevrimdışı imzası (RFC-0007 §12.1, §12.2; RFC-0033 §3, §9 h)
//
// Kerem çalıştırır, kök anahtarın durduğu çevrimdışı makinede. Araç anahtar üretmez, gömmez, yazdırmaz, günlüğe
// yazmaz; anahtar baytları kullanılınca sıfırlanır. CI ve ajan makinelerinde kök anahtar yoktur.
//
//   hazirla   --bildirim <imzasız> --kok-durum <kok.durum> [--sums SHA256SUMS] --cikti <dizin>
//       Gövdeyi denetler; keyEpoch ve nextRootHash boşsa (0, 32 sıfır) kök durumuyla doldurur. Çıktı:
//         havenfold-node.bildirim.imzasiz  imzalanacak gövde (doldurulmuş)
//         bildirim.imzalanacak             hash('hf/release/', gövde): 32 bayt; Ed25519 bunun üstüne atılır
//         SHA256SUMS                       (verilirse, biçimi denetlenmiş kopya) Ed25519 doğrudan dosyanın baytlarına
//       Dışarıda imza, ör. OpenSSL ile (PureEdDSA, 64 bayt ham imza):
//         openssl pkeyutl -sign -inkey kok.pem -rawin -in bildirim.imzalanacak -out bildirim.imza
//         openssl pkeyutl -sign -inkey kok.pem -rawin -in SHA256SUMS -out SHA256SUMS.sig
//   birlestir --bildirim <imzasız> --imza <dosya> --kok-durum F [--sums F --sums-imza F] --cikti <dizin>
//       İmza dosyası 64 ham bayt ya da 128 onaltılık hane. İmzalı bildirimi node/release.js bildirimCoz ile (biçim, kök
//       dönemi, imza, taahhüt), SHA256SUMS.sig'i kökün açık anahtarıyla doğrular; geçmezse hiçbir şey yazmaz.
//   imzala    --bildirim <imzasız> --anahtar <dosya> --kok-durum F [--sums F] --cikti <dizin>
//       hazirla + yerelde imza + birlestir. Anahtar dosyası: 32 baytlık tohum, 64 baytlık libsodium gizli anahtarı ya
//       da OpenSSL'in Ed25519 PKCS#8 PEM'i (openssl genpkey -algorithm ed25519). Anahtarın açık yarısı kök durumundaki
//       rootPub olmalı (ROOT_MISMATCH).
//
// Çıktı (birlestir, imzala): havenfold-node.bildirim (gövde ‖ imza), SHA256SUMS ve SHA256SUMS.sig (verilirse),
// kok-acik.pem (kökün açık anahtarı; kullanıcı SHA256SUMS.sig'i OpenSSL ile denetler:
//   openssl pkeyutl -verify -pubin -inkey kok-acik.pem -rawin -in SHA256SUMS -sigfile SHA256SUMS.sig).
//
// SHA256SUMS imzası etiketsizdir (ham dosya baytları): yeni türetme etiketi uydurulmadı ve dosya herhangi bir araçla
// denetlenebilsin. Bildirim imzası 32 baytlık bir özetin üstündedir; SHA256SUMS en az bir satırdır (> 66 bayt), iki
// imza birbirinin yerine geçemez.
const fs = require('fs')
const path = require('path')
const b4a = require('b4a')
const c = require('compact-encoding')
const sodium = require('sodium-native')
const S = require('../release')
const O = require('./release-common')

const { fail, hex } = O
const IMZASIZ = 'havenfold-node.bildirim.imzasiz'
const PKCS8_ED25519 = b4a.from('302e020100300506032b657004220420', 'hex') // RFC 8410 OneAsymmetricKey öneki + 32 bayt tohum
const SPKI_ED25519 = b4a.from('302a300506032b6570032100', 'hex') // RFC 8410 SubjectPublicKeyInfo öneki + 32 bayt açık anahtar

// Gövdeyi okur, kök alanlarını doldurur ya da denetler. Dönüş: { body, m }
function govdeHazirla (yol, kok) {
  const m = O.govdeCoz(fs.readFileSync(yol))
  const bos = m.keyEpoch === 0 && m.nextRootHash.every((x) => x === 0)
  if (bos) { m.keyEpoch = kok.keyEpoch; m.nextRootHash = b4a.from(kok.nextRootHash) } else if (m.keyEpoch !== kok.keyEpoch || !b4a.equals(m.nextRootHash, kok.nextRootHash)) {
    fail('ROOT_MISMATCH', 'bildirimdeki keyEpoch/nextRootHash kök durumundan farklı')
  }
  return { body: c.encode(S.manifestGovde, m), m, dolduruldu: bos }
}

function sumsOku (yol) {
  const b = fs.readFileSync(yol)
  O.sumsCoz(b4a.toString(b)) // biçim: yalnız "<sha256>  <ad>" satırları
  if (b.byteLength <= 32) fail('INVALID_SHA256SUMS', 'kısa')
  return b
}

function imzaOku (yol) {
  const b = fs.readFileSync(yol)
  if (b.byteLength === 64) return b
  const s = b4a.toString(b).trim()
  if (/^[0-9a-fA-F]{128}$/.test(s)) return b4a.from(s, 'hex')
  fail('INVALID_SIGNATURE_FILE', '64 ham bayt ya da 128 onaltılık hane olmalı: ' + path.basename(yol))
}

function ozetYaz (m, body, kok) {
  const satir = (p) => `  ${p.os}/${p.arch} ${p.name} ${p.size} bayt ${hex(p.digest)}`
  return [
    `ürün ${m.product} ${m.version} (${m.versionCode}), kanal ${m.channel}, yayın ${new Date(m.publishedAt).toISOString()}${m.urgent ? ', ACİL' : ''}`,
    'paketler:', ...m.packages.map(satir),
    'imajlar:', ...m.images.map((i) => `  ${i.type} ${i.version} ${i.arch} ${i.ociDigest} arşiv ${i.archive.name} ${hex(i.archive.digest)}${i.sourceArchive ? ' kaynak ' + i.sourceArchive.name : ''}`),
    `installerDebs: ${m.installerDebs.length}, revoked: [${m.revoked.join(', ')}], minFrom ${m.minFrom}`,
    `kök dönemi ${kok.keyEpoch}, kök parmak izi ${hex(S.rootHash(kok.rootPub))}`,
    `imzalanacak özet hash('hf/release/', gövde) = ${hex(S.bildirimOzeti(body))}`
  ].join('\n')
}

function hazirla (a) {
  O.gerekli(a, ['bildirim', 'kok-durum', 'cikti'])
  const kok = O.kokDurumuOku(a['kok-durum'])
  const { body, m, dolduruldu } = govdeHazirla(a.bildirim, kok)
  fs.mkdirSync(a.cikti, { recursive: true })
  fs.writeFileSync(path.join(a.cikti, IMZASIZ), body, { mode: 0o644 })
  fs.writeFileSync(path.join(a.cikti, 'bildirim.imzalanacak'), S.bildirimOzeti(body), { mode: 0o644 })
  if (a.sums) fs.writeFileSync(path.join(a.cikti, 'SHA256SUMS'), sumsOku(a.sums), { mode: 0o644 })
  return { ozet: ozetYaz(m, body, kok), dolduruldu }
}

function kokPem (pub) {
  const b64 = b4a.toString(b4a.concat([SPKI_ED25519, pub]), 'base64')
  return '-----BEGIN PUBLIC KEY-----\n' + b64 + '\n-----END PUBLIC KEY-----\n'
}

// İmzaları doğrular, sonra yazar. sig: 64 bayt; sumsSig: 64 bayt ya da null
function birlestirYaz ({ body, sig, sums, sumsSig, kok, cikti }) {
  const bytes = b4a.concat([body, sig])
  const { m } = S.bildirimCoz(bytes, kok) // §12.1 madde 1–4: düğümün yapacağı denetimin aynısı
  if (sums && !sodium.crypto_sign_verify_detached(sumsSig, sums, kok.rootPub)) fail('SIGNATURE_ERROR', 'SHA256SUMS.sig')
  fs.mkdirSync(cikti, { recursive: true })
  fs.writeFileSync(path.join(cikti, 'havenfold-node.bildirim'), bytes, { mode: 0o644 })
  if (sums) {
    fs.writeFileSync(path.join(cikti, 'SHA256SUMS'), sums, { mode: 0o644 })
    fs.writeFileSync(path.join(cikti, 'SHA256SUMS.sig'), sumsSig, { mode: 0o644 })
  }
  fs.writeFileSync(path.join(cikti, 'kok-acik.pem'), kokPem(kok.rootPub), { mode: 0o644 })
  return { surum: m.version, kanal: m.channel, bildirimOzeti: hex(S.bildirimOzeti(body)), sums: !!sums }
}

function birlestir (a) {
  O.gerekli(a, ['bildirim', 'imza', 'kok-durum', 'cikti'])
  if (!!a.sums !== !!a['sums-imza']) fail('MISSING_ARGUMENT', '--sums ve --sums-imza birlikte')
  const kok = O.kokDurumuOku(a['kok-durum'])
  const { body } = govdeHazirla(a.bildirim, kok)
  return birlestirYaz({ body, sig: imzaOku(a.imza), sums: a.sums ? sumsOku(a.sums) : null, sumsSig: a.sums ? imzaOku(a['sums-imza']) : null, kok, cikti: a.cikti })
}

// Anahtar dosyasından libsodium gizli anahtarı (sodium_malloc alanında). Dosya içeriği sıfırlanır.
function anahtarOku (yol) {
  const st = fs.statSync(yol)
  const uyari = (st.mode & 0o077) ? 'anahtar dosyası başkalarına açık (chmod 600 önerilir)' : null
  const ham = fs.readFileSync(yol)
  const tohum = sodium.sodium_malloc(32)
  const sk = sodium.sodium_malloc(64)
  const pk = b4a.alloc(32)
  let pem = null
  try {
    let beklenenPk = null
    if (ham.byteLength === 32) ham.copy(tohum)
    else if (ham.byteLength === 64) { ham.copy(tohum, 0, 0, 32); beklenenPk = b4a.from(ham.subarray(32)) } else {
      const s = b4a.toString(ham)
      const r = /^-----BEGIN PRIVATE KEY-----\r?\n([A-Za-z0-9+/=\r\n]+)-----END PRIVATE KEY-----\s*$/.exec(s)
      if (!r) fail('INVALID_KEY_FORMAT', '32/64 ham bayt ya da Ed25519 PKCS#8 PEM')
      pem = b4a.from(r[1].replace(/\s+/g, ''), 'base64')
      if (pem.byteLength !== 48 || !b4a.equals(pem.subarray(0, 16), PKCS8_ED25519)) fail('INVALID_KEY_FORMAT', 'Ed25519 PKCS#8 değil')
      pem.copy(tohum, 0, 16, 48)
    }
    sodium.crypto_sign_seed_keypair(pk, sk, tohum)
    if (beklenenPk && !b4a.equals(beklenenPk, pk)) { sodium.sodium_memzero(sk); fail('INVALID_KEY_FORMAT', '64 baytlık anahtarın açık yarısı tutmuyor') }
    return { sk, pk, uyari }
  } finally {
    sodium.sodium_memzero(tohum)
    sodium.sodium_memzero(ham)
    if (pem) sodium.sodium_memzero(pem)
  }
}

function imzala (a) {
  O.gerekli(a, ['bildirim', 'anahtar', 'kok-durum', 'cikti'])
  const kok = O.kokDurumuOku(a['kok-durum'])
  const { body, m, dolduruldu } = govdeHazirla(a.bildirim, kok)
  const sums = a.sums ? sumsOku(a.sums) : null
  const { sk, pk, uyari } = anahtarOku(a.anahtar)
  let sig, sumsSig
  try {
    if (!b4a.equals(pk, kok.rootPub)) fail('ROOT_MISMATCH', 'anahtar kök durumundaki rootPub değil')
    sig = b4a.alloc(64)
    sodium.crypto_sign_detached(sig, S.bildirimOzeti(body), sk)
    if (sums) { sumsSig = b4a.alloc(64); sodium.crypto_sign_detached(sumsSig, sums, sk) }
  } finally { sodium.sodium_memzero(sk) }
  const r = birlestirYaz({ body, sig, sums, sumsSig, kok, cikti: a.cikti })
  return { ...r, ozet: ozetYaz(m, body, kok), dolduruldu, uyari }
}

module.exports = { hazirla, birlestir, imzala, kokPem, IMZASIZ }

if (require.main === module) {
  const [alt, ...arg] = process.argv.slice(2)
  try {
    const a = O.argumanlar(arg)
    let r
    if (alt === 'hazirla') r = hazirla(a)
    else if (alt === 'birlestir') r = birlestir(a)
    else if (alt === 'imzala') r = imzala(a)
    else {
      console.error('kullanım: release-sign.js hazirla | birlestir | imzala … (ayrıntı dosyanın başında)')
      process.exit(1)
    }
    if (r.ozet) console.log(r.ozet)
    if (r.dolduruldu) console.log('keyEpoch ve nextRootHash kök durumundan dolduruldu.')
    if (r.uyari) console.error('UYARI: ' + r.uyari)
    if (alt === 'hazirla') console.log(`Hazır: ${path.join(a.cikti, 'bildirim.imzalanacak')}${a.sums ? ' ve SHA256SUMS' : ''} imzalanacak.`)
    else console.log(`İmzalı ve doğrulandı: havenfold-node ${r.surum} (${r.kanal}), bildirim özeti ${r.bildirimOzeti}${r.sums ? ', SHA256SUMS.sig' : ''}`)
  } catch (err) {
    console.error('surum-imzala: ' + err.message)
    process.exit(1)
  }
}
