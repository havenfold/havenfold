// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// preview.js — SHARE_PREVIEW (0xD0): başlatan, imzacı başkasıysa paketi ona gösterir (RFC-0010 §8.1)
//
//   sig = Ed25519(fromId, hashLP('hf/share-preview/', familyId, gönderilen baytlar sig hariç))
// Zarf topluluk içidir; emanet ve Posta Kutusu yolunda K12 mührüyle kapatılır (CTRL_TYPES 0x80–0xFE kapsar).
// Çözme kanoniktir ve tek giriş noktasından geçer (index.js giris.kaydet).
const b4a = require('b4a')
const { kdf: { hashLP } } = require('@havenfold/core')
const K = require('./encoding')
const { imzala, dogrula, kartCoz } = require('./card')
const { govdeCoz } = require('./package')

const Z_SHARE_PREVIEW = 0xd0

function fail (kod) { throw new Error(kod) }

/** Önizleme zarfının gövdesi (tür baytı ayrı). signSecret: başlatanın (fromId) imza anahtarı */
function onizlemeKur ({ familyId, shareId, card, body, sources, fromId, signSecret }) {
  const govde = K.kodla(K.ONIZLEME.govde, { familyId, shareId, card, body, sources, fromId }, 'PREVIEW_CORRUPT')
  return b4a.concat([govde, imzala(hashLP(K.ETIKET.onizleme, familyId, govde), signSecret)])
}

/** Yalnız biçim (giriş noktasının kanonik çözücüsü) */
const onizlemeBicim = (bytes) => K.kanonik(K.ONIZLEME.tam, bytes, 'PREVIEW_CORRUPT')

/**
 * İmzacının telefonunda denetim: aile kimliği, gönderen aktif üye ve imzası, kart geçerli, gövde çözülür ve aynı
 * shareId ile aynı hizmete. fromHex verilirse zarfın oturumdaki göndereniyle aynı olmalı.
 * Dönüş { familyId, shareId, kart, govde, body, sources, fromId }
 */
function onizlemeCoz (bytes, { ledger, fromHex = null }) {
  const m = onizlemeBicim(bytes)
  if (!ledger.familyId || !b4a.equals(m.familyId, ledger.familyId)) fail('FAMILY_MISMATCH')
  const from = K.hex(m.fromId)
  if (fromHex && fromHex !== from) fail('SENDER_MISMATCH')
  const uye = ledger.members.get(from)
  if (!uye || !uye.active) fail('UNAUTHORIZED')
  if (!dogrula(m.sig, hashLP(K.ETIKET.onizleme, m.familyId, bytes.subarray(0, bytes.byteLength - 64)), uye.signPub)) fail('INVALID_SIGNATURE')
  const kart = kartCoz(m.card)
  const govde = govdeCoz(m.body)
  if (!b4a.equals(govde.shareId, m.shareId) || !b4a.equals(govde.serviceId, kart.serviceId) || govde.kind !== 'tek') fail('PREVIEW_CORRUPT')
  return { familyId: m.familyId, shareId: m.shareId, kart, govde, body: m.body, sources: m.sources, fromId: m.fromId }
}

module.exports = { Z_SHARE_PREVIEW, onizlemeKur, onizlemeBicim, onizlemeCoz }
