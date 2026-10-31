// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// worklet/ledger/policy.js — GENESIS.policy (docs/04 §4.2)
//
// maxMembers 8 teknik sınırdır (ücret değil). Kutu bu sayıya girmez.

const HARD_MAX_MEMBERS = 8

const DEFAULT_POLICY = Object.freeze({
  maxMembers: 8,
  inviteTtlSec: 180,
  defaultDisappearSec: 604800,
  requireInPersonCeremony: true,
  removeQuorum: 'majority-excluding-target',
  addQuorum: 'majority-including-new',
  prekeyRotateDays: 7,
  prekeyGraceDays: 14
})

const ROLES = ['ebeveyn', 'yetiskin', 'cocuk', 'kutu']
const MAX_PARENTS = 2
// Ekip (RFC-0005 §4.3, §5)
const ROLES_BY_KIND = Object.freeze({ aile: ROLES, ekip: ['sahip', 'yonetici', 'calisan', 'gecici', 'kutu'] })
const HARD_MAX_MEMBERS_EKIP = 32
const MAX_OWNERS = 3
const EKIP_KUTUSUZ_SINIR = 8

function isUint (x) { return Number.isSafeInteger(x) && x >= 0 }

// Geçersizse hata kodu atar; geçerliyse kopyasını döner. kind: 'aile' (en çok 8) ya da 'ekip' (en çok 32)
function validatePolicy (p, kind = 'aile') {
  const ust = kind === 'ekip' ? HARD_MAX_MEMBERS_EKIP : HARD_MAX_MEMBERS
  if (!p || typeof p !== 'object') throw new Error('INVALID_POLICY')
  for (const k of Object.keys(DEFAULT_POLICY)) if (!(k in p)) throw new Error('INVALID_POLICY')
  if (!isUint(p.maxMembers) || p.maxMembers < 2 || p.maxMembers > ust) throw new Error('INVALID_POLICY')
  if (!isUint(p.inviteTtlSec) || !isUint(p.defaultDisappearSec)) throw new Error('INVALID_POLICY')
  if (!isUint(p.prekeyRotateDays) || p.prekeyRotateDays < 1) throw new Error('INVALID_POLICY')
  if (!isUint(p.prekeyGraceDays)) throw new Error('INVALID_POLICY')
  if (typeof p.requireInPersonCeremony !== 'boolean') throw new Error('INVALID_POLICY')
  // Yalnız belgedeki iki kural desteklenir; başka bir değer başka istemcide farklı sonuç verirdi
  if (p.removeQuorum !== DEFAULT_POLICY.removeQuorum) throw new Error('INVALID_POLICY')
  if (p.addQuorum !== DEFAULT_POLICY.addQuorum) throw new Error('INVALID_POLICY')
  return { ...p }
}

module.exports = { DEFAULT_POLICY, HARD_MAX_MEMBERS, ROLES, MAX_PARENTS, ROLES_BY_KIND, HARD_MAX_MEMBERS_EKIP, MAX_OWNERS, EKIP_KUTUSUZ_SINIR, validatePolicy }
