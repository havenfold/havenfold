// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// backup.js — yedek blokları ve yedek dizini (RFC-0004 §4.5)
//
//   Bloklar RFC-0001 §11 dosya biçimiyle; her yüklemede yeni rastgele fileKey (aynı anahtar iki içerik için yok).
//   BACKUP_INDEX { memberRootId, version, seq, blocks: [{ blokNo, blobId, fileKey, size }] }
//   sealed = nonce(24) ‖ XChaCha20-Poly1305(YA, BACKUP_INDEX, AD = hash('hf/kasa-index-ad/', secretId, u64be(version), u64be(seq)))
// Kurtaran, ulaşabildiği bütün tutuculardan dizini ister; geçerli olanlar arasında en büyük seq kazanır.
const c = require('compact-encoding')
const b4a = require('b4a')
const sodium = require('sodium-native')
const { kdf: { hash } } = require('@havenfold/core')
const { kodlama: { struct, decodeCanonical }, dosya: { encryptBlob } } = require('@havenfold/records')

function fail (code) { throw new Error(code) }

const NPUB = sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES
const ABYTES = sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES

const blok = struct([['blokNo', c.uint], ['blobId', c.fixed32], ['fileKey', c.fixed32], ['size', c.uint]])
const backupIndex = struct([['memberRootId', c.fixed16], ['version', c.uint], ['seq', c.uint], ['blocks', c.array(blok)]])
// Tutucuya giden: kimin, hangi sürüm ve seq (açık), mühürlü dizin
const muhurluDizin = struct([['secretId', c.fixed16], ['version', c.uint], ['seq', c.uint], ['sealed', c.buffer]])

const adOf = (secretId, version, seq) => hash('hf/kasa-index-ad/', secretId, version, seq)

// nonce yalnız test vektörü için verilir
function dizinMuhurle (ya, secretId, dizin, nonce = null) {
  if (!nonce) { nonce = b4a.alloc(NPUB); sodium.randombytes_buf(nonce) }
  const pt = c.encode(backupIndex, dizin)
  const ct = b4a.alloc(pt.byteLength + ABYTES)
  sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(ct, pt, adOf(secretId, dizin.version, dizin.seq), null, nonce, ya)
  sodium.sodium_memzero(pt) // dizin dosya anahtarlarını taşır (inceleme 5 S10)
  return c.encode(muhurluDizin, { secretId, version: dizin.version, seq: dizin.seq, sealed: b4a.concat([nonce, ct]) })
}

function dizinAc (ya, bytes) {
  let m
  try { m = decodeCanonical(muhurluDizin, bytes, 'INVALID_INDEX') } catch { fail('INVALID_INDEX') }
  const s = m.sealed || b4a.alloc(0)
  if (s.byteLength < NPUB + ABYTES) fail('INVALID_INDEX')
  const pt = b4a.alloc(s.byteLength - NPUB - ABYTES)
  try {
    sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(pt, null, s.subarray(NPUB), adOf(m.secretId, m.version, m.seq), s.subarray(0, NPUB), ya)
  } catch { fail('INDEX_OPEN_FAILED') }
  const d = decodeCanonical(backupIndex, pt, 'INVALID_INDEX')
  if (d.version !== m.version || d.seq !== m.seq) fail('INVALID_INDEX')
  return d
}

// Tutuculardan gelen dizinler: açılabilenler arasında en büyük seq (eski dizin veren tutucu kazanamaz)
function enYeniDizin (ya, liste) {
  let en = null
  for (const b of liste) {
    let d
    try { d = dizinAc(ya, b) } catch { continue }
    if (!en || d.seq > en.seq) en = d
  }
  if (!en) fail('NO_DIR')
  return en
}

// Yedek bloğu: her yüklemede yeni fileKey. Dönüş: { blok (dizin girdisi), chunks }
function blokSifrele (blokNo, bytes) {
  const b = encryptBlob(bytes)
  return { blok: { blokNo, blobId: b.blobId, fileKey: b.fileKey, size: b.size }, chunks: b.chunks }
}

module.exports = { backupIndex, muhurluDizin, adOf, dizinMuhurle, dizinAc, enYeniDizin, blokSifrele }
