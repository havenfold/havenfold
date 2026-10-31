// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// erase/ticket.js — ESP'deki emeklilik bileti (RFC-0007 §13.1 madde 4, §13.2 adım 2)
//
//   HFRT1 bileti = 'HFRT1' (5 B) ‖ EMEKLI_BILET
//   EMEKLI_BILET { v: uint (1), hostId: fixed16, ids: array<fixed16>, retireNonce: fixed16 }
//
// Bilet sır değildir: silme ortamının bu donanımın kimliğini bilmesini sağlar. Yazan düğümün yetki yardımcısıdır
// (efi-bilet-yaz, en çok 512 B); burada okuma ve testler için yazma var. Kodlama kuralları RFC-0001 §3 (en kısa).
const c = require('compact-encoding')
const b4a = require('b4a')
const { canonical } = require('../../core/core/ledger/encoding')

const ONEK = b4a.from('HFRT1')
const YOL = 'EFI/havenfold/emekli.bilet'
const EN_COK = 512

function fail (code) { throw new Error(code) }

const biletEnc = {
  preencode (s, m) { c.uint.preencode(s, m.v); c.fixed16.preencode(s, m.hostId); c.array(c.fixed16).preencode(s, m.ids); c.fixed16.preencode(s, m.retireNonce) },
  encode (s, m) { c.uint.encode(s, m.v); c.fixed16.encode(s, m.hostId); c.array(c.fixed16).encode(s, m.ids); c.fixed16.encode(s, m.retireNonce) },
  decode (s) { return { v: c.uint.decode(s), hostId: c.fixed16.decode(s), ids: c.array(c.fixed16).decode(s), retireNonce: c.fixed16.decode(s) } }
}

function biletYaz ({ hostId, ids, retireNonce }) {
  if (!ids.length) fail('INVALID_TICKET')
  const b = b4a.concat([ONEK, c.encode(biletEnc, { v: 1, hostId, ids, retireNonce })])
  if (b.byteLength > EN_COK) fail('INVALID_TICKET')
  return b
}

function biletCoz (bytes) {
  if (!b4a.isBuffer(bytes) || bytes.byteLength > EN_COK || bytes.byteLength < ONEK.byteLength) fail('INVALID_TICKET')
  if (!b4a.equals(bytes.subarray(0, ONEK.byteLength), ONEK)) fail('INVALID_TICKET')
  const m = canonical(biletEnc, bytes.subarray(ONEK.byteLength), 'INVALID_TICKET')
  if (m.v !== 1 || !m.ids.length) fail('INVALID_TICKET')
  return m
}

// Bilet yoksa: hostId ve retireNonce 16 sıfır, ids boş (§13.5); raporun deviceId'si 16 sıfır
const BILETSIZ = Object.freeze({ v: 1, hostId: b4a.alloc(16), ids: [], retireNonce: b4a.alloc(16), yok: true })

// Birden çok ESP'de bilet bulunursa: hepsi aynıysa o; farklıysa hangisinin doğru olduğu bilinemez → TICKET_CONFLICT
function biletSec (adaylar) {
  const gecerli = []
  for (const b of adaylar) {
    if (!b) continue
    try { gecerli.push({ ham: b, m: biletCoz(b) }) } catch {}
  }
  if (!gecerli.length) return BILETSIZ
  if (gecerli.some((x) => !b4a.equals(x.ham, gecerli[0].ham))) fail('TICKET_CONFLICT')
  return gecerli[0].m
}

module.exports = { ONEK, YOL, EN_COK, biletEnc, biletYaz, biletCoz, biletSec, BILETSIZ }
