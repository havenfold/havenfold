// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// worklet/protocol/hello.js — docs/04 §7.2–§7.3
const sodium = require('sodium-native')
const b4a = require('b4a')
const { hash } = require('../crypto/kdf')
const { verifyDeviceCert } = require('../crypto/device-cert')

// RFC-0003 §2.2 ve §10 (RFC-0016 ekiyle 256–4096)
const CAPS = {
  AUDIO: 1,
  VIDEO: 2,
  PTT_LIVE: 4,
  RELAY: 8,
  BOX: 16,
  LEDGER_V21: 32,
  KAYIT: 64,
  GOREV: 128,
  BAGLANTI: 256,
  AFET: 512,
  YZ: 1024,
  UYGULAMA: 2048,
  HIDE_PRESENCE: 4096,
  COKLU_UYGULAMA: 8192, // RFC-0017 §4.4
  MISAFIR_YAZAR: 16384, // RFC-0030 §8
  AILE_ADI: 32768, // RFC-0036 §4.2: törende aile adı (bilgi biti, düzey koşulu yok)
  UZAKTAN_IPTAL: 65536 // D106: bekleyen uzaktan üyeye REVOKE'u bilir; ailede herkes bildirmeden iptal yazılmaz
}

function helloDigest (handshakeHash, familyId, memberId, ledgerHead, ledgerLen) {
  return hash('hello', handshakeHash, familyId, memberId, ledgerHead, ledgerLen)
}

// me: { memberId, signKeyPair: { publicKey, secretKey }, deviceCert }
function createHello (me, socket, ledger, caps = 0) {
  const msg = helloDigest(socket.handshakeHash, ledger.familyId, me.memberId, ledger.head, ledger.len)
  const sig = b4a.alloc(sodium.crypto_sign_BYTES)
  sodium.crypto_sign_detached(sig, msg, me.signKeyPair.secretKey)
  return {
    v: 2,
    familyId: ledger.familyId,
    memberId: me.memberId,
    deviceCert: me.deviceCert,
    ledgerLen: ledger.len,
    ledgerHead: ledger.head,
    caps,
    sig
  }
}

// v2.1 (RFC-0003 §6.1): aktif üye 'uye', aktif cihaz 'cihaz', aktif misafir 'misafir' rolüyle oturuma girer.
// Dönüş: { ok, member, role }. `member` üye, cihaz ya da misafir kaydıdır.
// davetli: true ise iptal edilen uzaktan davetli de 'davetli' rolüyle doğrulanır (yalnız taşıyıcının sınırlı iptal
// oturumu; D106, Codex 10. tur). Afet yolu ve öbür çağıranlar onu tanımaz
function verifyHello (hello, socket, ledger, expectedPeerHex, { davetli = false } = {}) {
  if (hello.v !== 2) return fail('VERSION')
  if (!b4a.equals(hello.familyId, ledger.familyId)) return fail('FAMILY_MISMATCH')

  const peerHex = b4a.toString(hello.memberId, 'hex')
  let role = ledger.sessionRole(peerHex)
  if (!role && davetli && typeof ledger.davetliMi === 'function' && ledger.davetliMi(peerHex)) role = 'davetli'
  if (!role) return fail('NOT_MEMBER') // K11: bekleyen üye de değil
  const member = ledger.entity(peerHex)
  // Buluşma anahtarı hangi çift içinse, HELLO o çiftin üyesinden gelmeli
  if (b4a.toString(hello.memberId, 'hex') !== expectedPeerHex) return fail('MIXED_IDENTITY')
  if (!b4a.equals(hello.deviceCert.ukaPub, member.signPub)) return fail('CERTIFICATE_MISMATCH')
  if (member.udaPub && !b4a.equals(hello.deviceCert.udaPub, member.udaPub)) return fail('CERTIFICATE_MISMATCH')
  if (!verifyDeviceCert(hello.deviceCert)) return fail('CERTIFICATE_INTERNAL_INCONSISTENT') // donanım kanıtı değil, bkz. §2.1

  const msg = helloDigest(socket.handshakeHash, hello.familyId, hello.memberId, hello.ledgerHead, hello.ledgerLen)
  if (!sodium.crypto_sign_verify_detached(hello.sig, msg, member.signPub)) return fail('SIGNATURE_ERROR')
  return { ok: true, member, role }
}

function fail (code) { return { ok: false, code } }
module.exports = { createHello, verifyHello, helloDigest, CAPS }
