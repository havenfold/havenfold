// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// protocol/recovery.js — NODE_RECOVERY (0xDE): düğümün LUKS kurtarma anahtarının töreni yapan ebeveynin telefonuna
// teslimi ve telefonun alındısı (RFC-0007 §8.5 adım 4–6, §13.6, §14)
//
//   NODE_RECOVERY { nodeId: fixed16, kind: 'luks-kurtarma' | 'alindi', secret: buffer, sig: fixed64 }
//   body = sig dışındaki alanların kodlaması; sig = Ed25519(gönderen, hash('hf/node-recovery/', familyId, body))
// luks-kurtarma'da secret 32 bayttır, alindi'de boştur. nodeId iki yönde de düğümün kimliğidir. Yalnız doğrudan Noise
// oturumunda (emanet ve Posta Kutusu'ndan gelirse giris.gelenZarf atar). Telefon anahtarı Kasa koleksiyonuna, yoksa
// Ebeveynler koleksiyonuna KAYIT_TURU kaydı olarak yazar ve alindi döner; düğüm imzacının töreni yapan ebeveyn
// olduğunu denetleyip dosyayı siler.
const c = require('compact-encoding')
const b4a = require('b4a')
const sodium = require('sodium-native')
const { hash } = require('../crypto/kdf')
const { canonical } = require('../ledger/encoding')

function fail (code) { throw new Error(code) }
const hex = (b) => (typeof b === 'string' ? b : b4a.toString(b, 'hex'))

const ETIKET = 'hf/node-recovery/'
const KAYIT_TURU = 'hf.node.luks-kurtarma'
const KIND = ['luks-kurtarma', 'alindi']
const ANAHTAR_BOY = 32

// c.buffer boşu null çözer; burada boş bayt dizisi
const bytes = {
  preencode (state, v) { c.buffer.preencode(state, v) },
  encode (state, v) { c.buffer.encode(state, v) },
  decode (state) { return c.buffer.decode(state) || b4a.alloc(0) }
}

const govde = {
  preencode (state, m) { c.fixed16.preencode(state, m.nodeId); c.string.preencode(state, m.kind); bytes.preencode(state, m.secret) },
  encode (state, m) { c.fixed16.encode(state, m.nodeId); c.string.encode(state, m.kind); bytes.encode(state, m.secret) },
  decode (state) { return { nodeId: c.fixed16.decode(state), kind: c.string.decode(state), secret: bytes.decode(state) } }
}

function denetle (m) {
  if (!KIND.includes(m.kind)) fail('INVALID_MESSAGE')
  if (m.secret.byteLength !== (m.kind === 'luks-kurtarma' ? ANAHTAR_BOY : 0)) fail('INVALID_MESSAGE')
  return m
}

const ozet = (familyId, body) => hash(ETIKET, familyId, body)

// signer: { signKeyPair: { secretKey } }. m: { nodeId, kind, secret? }
function encodeNodeRecovery (familyId, m, signer) {
  const body = c.encode(govde, denetle({ nodeId: m.nodeId, kind: m.kind, secret: m.secret || b4a.alloc(0) }))
  const sig = b4a.alloc(64)
  sodium.crypto_sign_detached(sig, ozet(familyId, body), signer.signKeyPair.secretKey)
  return b4a.concat([body, sig])
}

// Kanonik çözme (giris.gelenZarf'ın çözücüsü). Dönüş: { m, body, sig }
function decodeNodeRecovery (buf) {
  if (!b4a.isBuffer(buf) || buf.byteLength < 65) fail('INVALID_MESSAGE')
  const body = buf.subarray(0, buf.byteLength - 64)
  const m = denetle(canonical(govde, body, 'INVALID_MESSAGE'))
  return { m, body, sig: buf.subarray(buf.byteLength - 64) }
}

const verifyNodeRecovery = (familyId, d, pub) => !!pub && sodium.crypto_sign_verify_detached(d.sig, ozet(familyId, d.body), pub)

// Töreni yapan ebeveyn(ler): cihazın DEVICE_ATTACH olayını imzalayan, bugün etkin ebeveynler (RFC-0007 §8.5 adım 4;
// RFC-0033 §9 n: imzacılar yeni cihaz ve ebeveyn). Cihaz yoksa ya da çıkarılmışsa boş.
function torenEbeveyni (L, nodeHex) {
  const d = L.devices.get(hex(nodeHex))
  if (!d || !d.active || !Number.isSafeInteger(d.addedSeq)) return []
  const e = L.events[d.addedSeq]
  if (!e) return []
  return e.sigs.map((s) => hex(s.memberId)).filter((id) => {
    const u = L.members.get(id)
    return id !== hex(nodeHex) && !!u && u.active && u.role === 'ebeveyn'
  })
}

module.exports = { ETIKET, KAYIT_TURU, KIND, ANAHTAR_BOY, govde, encodeNodeRecovery, decodeNodeRecovery, verifyNodeRecovery, torenEbeveyni }
