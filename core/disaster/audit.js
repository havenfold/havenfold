// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// audit.js — alıcının denetimi (RFC-0012 §7.4) ve gönderenin türü (§7.1, §8.1)
//
// Alıcı kendi her çifti için toTag'i [bugün − 3, bugün + 1] günleri için hesaplar (açıklama 1 madde 4; expiresDay = gün + 3
// ile uyumlu); eşleşen çiftle:
//   1 açılıyor · 2 from çiftin karşı tarafı, to kendisi · 3 from defterde bugün aktif · 4 kind gönderenin türüne uygun
//   (UYARI yalnız bağlı cihazdan, alarm yalnız UYARI'da) · 5 mid son 7 günde görülmemiş · 6 expiresDay ≥ bugün − 1 ·
//   7 alanlar sınırlarda. Sağlanmazsa atılır.
const b4a = require('b4a')
const T = require('./derivation')
const M = require('./message')

const hex = (b) => b4a.toString(b, 'hex')
const TEKRAR_GUN = 7

/** Defterdeki kimliğin afet türü: 'telefon' | 'kutu' | 'cihaz' (işçi, uç) | 'misafir' | null (aktif değil) */
function kimlikTuru (L, idHex) {
  const rol = L.sessionRole(idHex)
  if (!rol) return null
  if (rol === 'misafir') return 'misafir'
  if (rol === 'cihaz') {
    const d = L.devices.get(idHex)
    return d && d.active && (d.class === 'isci' || d.class === 'uc') ? 'cihaz' : null
  }
  return L.members.get(idHex)?.role === 'kutu' ? 'kutu' : 'telefon'
}

// §7.1, §8.1: kim hangi türü gönderir
const GONDERIR = {
  telefon: [M.KIND.METIN, M.KIND.IYIYIM, M.KIND.SOS, M.KIND.ALINDI],
  misafir: [M.KIND.METIN, M.KIND.IYIYIM, M.KIND.SOS, M.KIND.ALINDI],
  cihaz: [M.KIND.UYARI],
  kutu: []
}
const gonderebilir = (tur, kind) => (GONDERIR[tur] ?? []).includes(kind)

const PENCERE = [-3, -2, -1, 0, 1] // açıklama 1 madde 4

/** Bu kimliğe gelen mesaj için aday çiftler ve toTag'leri ([bugün − 3, bugün + 1]) */
function etiketler (ciftler, meId, bugun) {
  const out = []
  for (const cift of ciftler) {
    const key = T.afetKey(cift.pair)
    for (const d of PENCERE) out.push({ cift, gun: bugun + d, toTag: T.toTag(key, meId, bugun + d) })
  }
  return out
}

/**
 * o: { msg (çözülmüş AFET_MSG), ciftler: [{ id, pair }], meId, L, bugun, gorulen: Map<midHex, gün> }
 * Dönüş: { gecerli: true, ic, cift } ya da { gecerli: false, neden }
 */
function alici ({ msg, ciftler, meId, L, bugun, gorulen }) {
  const benTuru = kimlikTuru(L, hex(meId))
  if (benTuru !== 'telefon' && benTuru !== 'misafir') return { gecerli: false, neden: 'NOT_RECIPIENT' }
  const adaylar = etiketler(ciftler, meId, bugun).filter((x) => b4a.equals(x.toTag, msg.toTag))
  let ic = null
  let cift = null
  for (const a of adaylar) {
    ic = M.ac(msg, a.cift.pair)
    if (ic) { cift = a.cift; break }
  }
  if (!ic) return { gecerli: false, neden: 'NOT_OPENED' } // 1 (ve aileden çıkarılmış göndericinin çifti yok)
  if (!b4a.equals(ic.from, cift.id) || !b4a.equals(ic.to, meId)) return { gecerli: false, neden: 'IDENTITY_ERROR' } // 2
  const tur = kimlikTuru(L, hex(ic.from))
  if (!tur) return { gecerli: false, neden: 'NOT_ACTIVE' } // 3
  if (!gonderebilir(tur, ic.kind) || (ic.alarm != null) !== (ic.kind === M.KIND.UYARI)) return { gecerli: false, neden: 'TUR' } // 4
  if (msg.prio !== M.PRIO[ic.kind]) return { gecerli: false, neden: 'INVALID_PRIORITY' } // açık öncelik iç türle aynı olmalı (inceleme 21 B10)
  if (benTuru === 'misafir' && tur !== 'telefon') return { gecerli: false, neden: 'TUR' } // misafir yalnız üyelerden alır (§8.1)
  const g = gorulen.get(hex(msg.mid))
  if (g != null && g >= bugun - TEKRAR_GUN) return { gecerli: false, neden: 'REPLAY' } // 5
  if (msg.expiresDay < bugun - 1) return { gecerli: false, neden: 'SURE' } // 6
  if (M.icGecerli(ic)) return { gecerli: false, neden: 'ALAN' } // 7
  return { gecerli: true, ic, cift }
}

module.exports = { kimlikTuru, gonderebilir, etiketler, alici, TEKRAR_GUN, PENCERE }
