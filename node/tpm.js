// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// tpm.js — kutunun TPM 2.0 mührü arayüzü (RFC-0004 §3.1, §4.4; D39): muhurle(bytes) → mühür, ac(mühür) → bytes
//
// Cihaz payı yalnız TPM'ye mühürlenebilen düğümde tutulur; mühürleme yapılamıyorsa pay tutulmaz, düz yazılmaz.
// Gerçek TPM (D76): tpm2-tools ile 32 baytlık bir mühür anahtarı TPM'nin depolama hiyerarşisinde (sahip, birincil ECC
// anahtarın altında) mühürlenir; mühürlü nesne (pub, priv) dizinde durur, anahtar yalnız TPM'de açılır. muhurle/ac bu
// anahtarla XChaCha20-Poly1305'tir (libsodium). Disk başka makineye taşınırsa anahtar açılmaz. Kendi kriptomuz yok:
// mühür TPM'nin, şifreleme libsodium'un. Taklit mühür yalnız testtedir ve açıkça istenir (taklitTpm({ test: true }));
// KutuPaylari taklidi test kipi olmadan kabul etmez.
'use strict'
const sodium = require('sodium-native')
const b4a = require('b4a')

const NONCE = sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES
const ABYTES = sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES
const AD = b4a.from('hf/node/tpm-taklit')
function fail (code) { throw new Error(code) }

// Hangi nesnelerin gerçek TPM ve taklit olduğu yalnız bu modülde bilinir (özellikle işaretlenmez; inceleme 15)
const GERCEK = new WeakSet()
const TAKLIT = new WeakSet()
const tpmGercekMi = (t) => !!t && typeof t === 'object' && GERCEK.has(t)
const taklitMi = (t) => !!t && typeof t === 'object' && TAKLIT.has(t)

const AD_GERCEK = b4a.from('hf/node/tpm')

function aeadNesnesi (k, ad) {
  return {
    muhurle (bytes) {
      const nonce = b4a.alloc(NONCE)
      sodium.randombytes_buf(nonce)
      const out = b4a.alloc(bytes.byteLength + ABYTES)
      sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(out, bytes, ad, null, nonce, k)
      return b4a.concat([nonce, out])
    },
    ac (muhur) {
      if (!b4a.isBuffer(muhur) || muhur.byteLength < NONCE + ABYTES) fail('SEAL_CORRUPT')
      const out = b4a.alloc(muhur.byteLength - NONCE - ABYTES)
      try { sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(out, null, muhur.subarray(NONCE), ad, muhur.subarray(0, NONCE), k) } catch { fail('SEAL_CORRUPT') }
      return out
    }
  }
}

// tpm2-tools'u çalıştıran varsayılan kanca (Node): { status, stdout } döner
function varsayilanCalistir (komut, args, { girdi = null, env = {} } = {}) {
  const { spawnSync } = require('child_' + 'process')
  const r = spawnSync(komut, args, { input: girdi || undefined, env: { ...process.env, ...env }, maxBuffer: 1 << 20 })
  return { status: r.error ? -1 : r.status, stdout: r.stdout || b4a.alloc(0), stderr: r.stderr ? r.stderr.toString() : String(r.error) }
}

// Üretim: gerçek TPM. dizin: mühürlü nesnenin durduğu dizin (kutu dizininin altında, 0700). tcti: TPM aygıtı.
// calistir(komut, args, { girdi, env }): testte taklit edilir. İlk çağrıda anahtar üretilip mühürlenir; sonra açılır.
// TPM yoksa ya da araçlar yoksa NO_TPM.
function sistemTpm ({ dizin, tcti = 'device:/dev/tpmrm0', araclar = '/usr/bin', calistir = varsayilanCalistir } = {}) {
  if (typeof dizin !== 'string' || !dizin) fail('NO_DIR')
  const fs = require('#fs')
  const env = { TPM2TOOLS_TCTI: tcti }
  const yol = (ad) => dizin + '/' + ad
  const calis = (ad, args, girdi = null) => {
    const r = calistir(araclar + '/' + ad, args, { girdi, env })
    if (r.status !== 0) fail('NO_TPM')
    return r.stdout
  }
  fs.mkdirSync(dizin, { recursive: true, mode: 0o700 })
  // Geçici dizin her çağrıda yeni ve tahmin edilemez adla kurulur (mkdtemp: var olan dizini ya da bağı kullanmaz);
  // tpm2-tools buraya yazar. Kökken (havenfold ilk-ayar) önceden bırakılmış bir bağın izlenmesini önler.
  const s = fs.lstatSync(dizin)
  if (s.isSymbolicLink() || !s.isDirectory()) fail('NO_DIR')
  const gecici = fs.mkdtempSync(yol('.gecici-'))
  let k = null
  try {
    // Birincil anahtar her açılışta aynı şablondan yeniden türetilir (sahip hiyerarşisi, ECC P-256, SHA-256)
    calis('tpm2_createprimary', ['-Q', '-C', 'o', '-g', 'sha256', '-G', 'ecc', '-c', gecici + '/birincil.ctx'])
    if (!fs.existsSync(yol('muhur.pub')) || !fs.existsSync(yol('muhur.priv'))) {
      const yeni = b4a.alloc(32)
      sodium.randombytes_buf(yeni)
      try {
        calis('tpm2_create', ['-Q', '-C', gecici + '/birincil.ctx', '-u', gecici + '/muhur.pub', '-r', gecici + '/muhur.priv', '-i', '-'], yeni)
      } finally { sodium.sodium_memzero(yeni) }
      fs.renameSync(gecici + '/muhur.pub', yol('muhur.pub'))
      fs.renameSync(gecici + '/muhur.priv', yol('muhur.priv'))
    }
    calis('tpm2_load', ['-Q', '-C', gecici + '/birincil.ctx', '-u', yol('muhur.pub'), '-r', yol('muhur.priv'), '-c', gecici + '/muhur.ctx'])
    const acik = calis('tpm2_unseal', ['-c', gecici + '/muhur.ctx'])
    if (acik.byteLength !== 32) { sodium.sodium_memzero(acik); fail('SEAL_CORRUPT') }
    k = b4a.from(acik)
    sodium.sodium_memzero(acik)
  } finally {
    try { fs.rmSync(gecici, { recursive: true, force: true }) } catch {}
  }
  const t = { gercek: true, ...aeadNesnesi(k, AD_GERCEK) }
  GERCEK.add(t)
  return t
}

// Test: bellekteki anahtarla AEAD (libsodium XChaCha20-Poly1305). anahtar verilirse yeniden başlatmada aynı mühür açılır
// muhurleOncesi(): yalnız test, mühürlemeden önce çağrılır (fırlatırsa mühürleme düşer)
function taklitTpm ({ test = false, anahtar = null, muhurleOncesi = null } = {}) {
  if (test !== true) fail('NO_TPM')
  const k = anahtar ? b4a.from(anahtar) : b4a.alloc(32)
  if (!anahtar) sodium.randombytes_buf(k)
  if (k.byteLength !== 32) fail('INVALID_KEY')
  const t = {
    taklit: true,
    muhurle (bytes) {
      if (muhurleOncesi) muhurleOncesi()
      const nonce = b4a.alloc(NONCE)
      sodium.randombytes_buf(nonce)
      const out = b4a.alloc(bytes.byteLength + ABYTES)
      sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(out, bytes, AD, null, nonce, k)
      return b4a.concat([nonce, out])
    },
    ac (muhur) {
      if (!b4a.isBuffer(muhur) || muhur.byteLength < NONCE + ABYTES) fail('SEAL_CORRUPT')
      const out = b4a.alloc(muhur.byteLength - NONCE - ABYTES)
      try { sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(out, null, muhur.subarray(NONCE), AD, muhur.subarray(0, NONCE), k) } catch { fail('SEAL_CORRUPT') }
      return out
    }
  }
  TAKLIT.add(t)
  return t
}

module.exports = { sistemTpm, taklitTpm, taklitMi, tpmGercekMi }
