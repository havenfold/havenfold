// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// worklet/protocol/messages.js — tel biçimi (compact-encoding)
//
// HELLO docs/04 §7.2'deki alanları taşır. TEXT / ACK SPIKE çerçeveleridir (nat-probe, dev/peer):
// metin Noise tüneli içinde gider ama §8 zarfı + Double Ratchet ile ayrıca şifrelenmez.
// Gerçek çekirdek ENVELOPE çerçevesiyle §8 zarfını (messaging/envelope.js) ham bayt olarak taşır.
const c = require('compact-encoding')

const TYPE = { HELLO: 1, TEXT: 2, ACK: 3, ENVELOPE: 4 }

const deviceCert = {
  preencode (state, m) {
    c.buffer.preencode(state, m.dbaPub)
    c.fixed32.preencode(state, m.ukaPub)
    c.fixed32.preencode(state, m.udaPub)
    c.string.preencode(state, m.platform)
    c.uint.preencode(state, m.createdAt)
    c.buffer.preencode(state, m.dbaSig)
  },
  encode (state, m) {
    c.buffer.encode(state, m.dbaPub)
    c.fixed32.encode(state, m.ukaPub)
    c.fixed32.encode(state, m.udaPub)
    c.string.encode(state, m.platform)
    c.uint.encode(state, m.createdAt)
    c.buffer.encode(state, m.dbaSig)
  },
  decode (state) {
    return {
      dbaPub: c.buffer.decode(state) || EMPTY,
      ukaPub: c.fixed32.decode(state),
      udaPub: c.fixed32.decode(state),
      platform: c.string.decode(state),
      createdAt: c.uint.decode(state),
      dbaSig: c.buffer.decode(state) || EMPTY
    }
  }
}

// HELLO gövdesi; `bell?` alanı spike'ta yok (flags biti 1 ileride BellReg için ayrıldı).
const hello = {
  preencode (state, m) {
    c.uint.preencode(state, m.v)
    c.fixed32.preencode(state, m.familyId)
    c.fixed(16).preencode(state, m.memberId)
    deviceCert.preencode(state, m.deviceCert)
    c.uint.preencode(state, m.ledgerLen)
    c.fixed32.preencode(state, m.ledgerHead)
    c.uint.preencode(state, m.caps)
    c.uint.preencode(state, 0) // flags
    c.fixed64.preencode(state, m.sig)
  },
  encode (state, m) {
    c.uint.encode(state, m.v)
    c.fixed32.encode(state, m.familyId)
    c.fixed(16).encode(state, m.memberId)
    deviceCert.encode(state, m.deviceCert)
    c.uint.encode(state, m.ledgerLen)
    c.fixed32.encode(state, m.ledgerHead)
    c.uint.encode(state, m.caps)
    c.uint.encode(state, 0)
    c.fixed64.encode(state, m.sig)
  },
  decode (state) {
    const m = {
      v: c.uint.decode(state),
      familyId: c.fixed32.decode(state),
      memberId: c.fixed(16).decode(state),
      deviceCert: deviceCert.decode(state),
      ledgerLen: c.uint.decode(state),
      ledgerHead: c.fixed32.decode(state),
      caps: c.uint.decode(state)
    }
    const flags = c.uint.decode(state)
    if (flags !== 0) throw new Error('UNKNOWN_FIELD') // spike BellReg taşımaz
    m.sig = c.fixed64.decode(state)
    return m
  }
}

const text = {
  preencode (state, m) { c.fixed(16).preencode(state, m.id); c.uint.preencode(state, m.at); c.string.preencode(state, m.body) },
  encode (state, m) { c.fixed(16).encode(state, m.id); c.uint.encode(state, m.at); c.string.encode(state, m.body) },
  decode (state) { return { id: c.fixed(16).decode(state), at: c.uint.decode(state), body: c.string.decode(state) } }
}

const ack = {
  preencode (state, m) { c.fixed(16).preencode(state, m.id) },
  encode (state, m) { c.fixed(16).encode(state, m.id) },
  decode (state) { return { id: c.fixed(16).decode(state) } }
}

const raw = {
  preencode (state, m) { c.buffer.preencode(state, m) },
  encode (state, m) { c.buffer.encode(state, m) },
  decode (state) { return c.buffer.decode(state) || EMPTY }
}

const BODY = { [TYPE.HELLO]: hello, [TYPE.TEXT]: text, [TYPE.ACK]: ack, [TYPE.ENVELOPE]: raw }

const frame = {
  preencode (state, m) { c.uint.preencode(state, m.type); BODY[m.type].preencode(state, m.body) },
  encode (state, m) { c.uint.encode(state, m.type); BODY[m.type].encode(state, m.body) },
  decode (state) {
    const type = c.uint.decode(state)
    const enc = BODY[type]
    if (!enc) return { type, body: null } // bilinmeyen tür: yok sayılır (docs/04 §10)
    return { type, body: enc.decode(state) }
  }
}

const EMPTY = require('b4a').alloc(0)

const encodeFrame = (type, body) => c.encode(frame, { type, body })
// Kanonik çözme (inceleme 3 S7): bilinen türde sondaki fazla bayt ve en kısa olmayan kodlama reddedilir. Bilinmeyen
// tür yok sayılacağı için gövdesine bakılmaz.
function decodeFrame (buf) {
  let m
  try { m = c.decode(frame, buf) } catch { throw new Error('INVALID_MESSAGE') }
  if (m.body === null) return m
  let again
  try { again = c.encode(frame, m) } catch { throw new Error('INVALID_MESSAGE') }
  if (!require('b4a').equals(again, buf)) throw new Error('INVALID_MESSAGE')
  return m
}

module.exports = { TYPE, hello, deviceCert, encodeFrame, decodeFrame }
