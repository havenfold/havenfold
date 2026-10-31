// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// worklet/ledger/quorum.js — yeter sayı kuralları (docs/04 §4.2 ve rol tablosu)
//
// İki kural birlikte uygulanır:
//  1. Salt çoğunluk tablosu: oy veren üyeler arasında ADD için floor(n/2)+1 (yeni üye ayrıca imzalar),
//     REMOVE için hedef hariç floor((n-1)/2)+1.
//  2. Rol tablosu: ebeveyn/çocuk eklemede bütün ebeveynler, yetişkinde ebeveyn çoğunluğu, vb.
// Oy veren = aktif telefon üyesi ve rolü 'cocuk' değil. 'cocuk' imzalayabilir ama sayılmaz (LEDGER_PROPOSE).
// 'kutu' hiçbir hesaba girmez; herhangi bir ebeveynin tek imzasıyla eklenir ve atılır.
// Tüm üyeler ebeveyn/yetişkin olduğunda 1. kural belgedeki örnek tabloyu birebir verir.
const b4a = require('b4a')
const { T } = require('./encoding')
const { validatePolicy, ROLES, MAX_PARENTS } = require('./policy')
const { hash } = require('../crypto/kdf')
const { checkV21, levelAtLeast, checkCollection, levelDenetle, taskPermitDenetle, yonetimOkuyucuVar } = require('./v21')
const { checkV22 } = require('./v22')
const { checkV23 } = require('./v23')
const { checkQuorumEkip, EKIP_OLAYLARI } = require('./team')

const hex = (b) => b4a.toString(b, 'hex')
const majority = (k) => Math.floor(k / 2) + 1
const DAY_MS = 86_400_000
const REMOTE_WAIT_MS = DAY_MS
const ROTATE_WAIT_MS = 3 * DAY_MS // K16
const PRODUCTS = ['baglanti', 'aile']
// Yalnız imza eksikliği: taslak öneri olarak bekleyebilir (diğer hatalar kalıcıdır)
const NEEDS_MORE = new Set(['NO_QUORUM', 'NO_PARENT_APPROVAL', 'NO_ADULT_APPROVAL', 'NO_PARENT_SIGNATURE', 'NO_READER_APPROVAL'])
// Ekipte (RFC-0005 §6.2) sahip ya da yönetim imzası eksikliği de öneri yolunda bekler (D45). Yalnız KIND ekip'te:
// ailede NO_OWNER_SIGNATURE (SHARE_CONSENT) kalıcı hatadır (inceleme 16)
const NEEDS_MORE_EKIP = new Set([...NEEDS_MORE, 'NO_OWNER_APPROVAL', 'NO_OWNER_SIGNATURE', 'NO_MANAGEMENT_SIGNATURE'])
const needsMore = (L, code) => (L.kind === 'ekip' ? NEEDS_MORE_EKIP : NEEDS_MORE).has(code)

// ROTATE_DEVICE kipi (RFC-0020 a). Bayrak yoksa: v2.1+ ailede MODE_MISMATCH, v1 zincirinde (Yuva Hat) imzalardan.
function rotateOldSigned (L, body, signers) {
  const has = signers.has(hex(body.oldMemberId))
  if (body.oldSigned === null || body.oldSigned === undefined) {
    if (levelAtLeast(L.level, '2.1')) fail('MODE_MISMATCH')
    return has
  }
  if (body.oldSigned !== has) fail('MODE_MISMATCH')
  return body.oldSigned
}

function fail (code) { throw new Error(code) }
const isZero = (b) => b.every((x) => x === 0)

// L: Ledger (olay uygulanmadan önceki durum), signers: Set<hex>, newId: ADD/ROTATE'te yeni üyenin hex'i
// PREKEY: sahibi tek imzacı (aile ve ekipte aynı)
function prekeyDenetle (L, body, signers) {
  if (signers.size !== 1) fail('PREKEY_SIGNER')
  const owner = [...signers][0]
  const m = L.members.get(owner)
  if (!m || !m.active || m.role === 'kutu') fail('PREKEY_OWNER')
  if (!b4a.equals(prekeyIdOf(body.pub), body.prekeyId)) fail('PREKEY_IDENTITY')
  const last = m.prekeys[0]
  if (last && body.createdAt <= last.createdAt) fail('PREKEY_STALE')
  if (!L.verifyPrekey(m, body)) fail('PREKEY_SIGNATURE')
}

// Ekip yeter sayısının aile koduyla paylaştığı yapı denetimleri (RFC-0005 §4.3)
const ORTAK = {
  rotateOldSigned,
  prekey: prekeyDenetle,
  checkCollection,
  level: levelDenetle,
  taskPermit: taskPermitDenetle,
  yonetimOkuyucuVar,
  // v2.2 olayları ekipte: "ebeveyn" yerine yönetim (sahip ya da yönetici)
  v22: (L, e, body, signers, newId) => checkV22(Object.assign(Object.create(L), { parentIds: () => L.authorityIds() }), e, body, signers, newId),
  v23: (L, e, body, signers) => checkV23(Object.assign(Object.create(L), { parentIds: () => L.authorityIds() }), e, body, signers)
}

function checkQuorum (L, e, body, signers, newId) {
  // Ekip ayrı bir yeter sayı işlevidir; aile yolu değişmez (RFC-0005 §4.3)
  if (L.kind === 'ekip' && e.type !== T.GENESIS) return checkQuorumEkip(L, e, body, signers, newId, ORTAK)
  if (EKIP_OLAYLARI.has(e.type)) fail('TEAM_ONLY')
  // RFC-0017 §4.3: sınırlar ve yeter sayılar kişileri (yalnız ana kimlikleri) sayar
  const phones = L.personIds()
  const roleOf = (id) => L.members.get(id).role
  const voters = phones.filter((id) => roleOf(id) !== 'cocuk')
  const parents = phones.filter((id) => roleOf(id) === 'ebeveyn')
  const adults = phones.filter((id) => roleOf(id) === 'yetiskin')
  const count = (ids) => ids.reduce((k, id) => k + (signers.has(id) ? 1 : 0), 0)
  const allOf = (ids) => ids.length > 0 && count(ids) === ids.length
  const need = (ids, k, code = 'NO_QUORUM') => { if (count(ids) < k) fail(code) }

  switch (e.type) {
    case T.GENESIS:
      if (L.events.length !== 0) fail('GENESIS_ERROR')
      if (!(signers.size === 1 && signers.has(newId))) fail('GENESIS_ERROR') // yalnız kurucu
      validatePolicy(body.policy)
      return

    case T.ADD_MEMBER: {
      if (!signers.has(newId)) fail('NO_NEW_MEMBER_APPROVAL')
      if (!signers.has(hex(body.inviterId))) fail('NO_INVITE_ER_SIGNATURE')
      if (isZero(body.ceremonyTranscriptHash)) fail('INVALID_TRANSCRIPT')
      if (!ROLES.includes(body.role)) fail('INVALID_ROLE')
      if (body.role === 'kutu') {
        if (body.remote) fail('INVALID_ROLE')
        if (L.boxIds().length >= 1) fail('BOX_LIMIT') // ailede en fazla 1 kutu
        return need(parents, 1, 'NO_PARENT_SIGNATURE')
      }
      // Bekleyen (uzaktan) üyeler de sayılır (RFC-0019 §11.3 e)
      if (L.personCountWithPending() >= L.policy.maxMembers) fail('MEMBER_LIMIT')
      if (body.role === 'ebeveyn' && parents.length >= MAX_PARENTS) fail('PARENT_LIMIT')
      need(voters, majority(voters.length))
      if (body.role === 'ebeveyn' || body.role === 'cocuk') {
        if (!allOf(parents)) fail('NO_PARENT_APPROVAL')
      } else {
        need(parents, majority(parents.length), 'NO_PARENT_APPROVAL')
      }
      if (body.remote) {
        if (!allOf(parents)) fail('NO_PARENT_APPROVAL')
        if (parents.length === 1 && adults.length > 0) need(adults, 1, 'NO_ADULT_APPROVAL')
        if (body.activatesAt < e.ts + REMOTE_WAIT_MS) fail('REMOTE_WAITING')
      } else if (body.activatesAt !== 0) {
        fail('REMOTE_WAITING')
      }
      return
    }

    case T.REMOVE_MEMBER: {
      const target = hex(body.memberId)
      const tm = L.members.get(target)
      if (!tm || !tm.active) fail('NO_TARGET')
      if (signers.has(target)) fail('TARGET_CANNOT_SELF_VOTE') // kendi çıkışı için LEAVE
      if (tm.role === 'kutu') return need(parents, 1, 'NO_PARENT_SIGNATURE')
      if (tm.extra) {
        // RFC-0017 §4.3: tek ek kimliği herhangi bir ebeveyn tek imzayla çıkarır; §7: bekleyen APP_PRIMARY'yi eski
        // ana kimlik de veto eder
        if (tm.pendingPrimary && signers.has(L.persons.get(tm.personOf)?.primary)) return
        return need(parents, 1, 'NO_PARENT_SIGNATURE')
      }
      // K16: eski cihaz, bekleyen ebeveyn cihaz değişimini tek imzasıyla iptal eder (veto)
      if (tm.pendingRotation && signers.has(tm.rotatedFrom)) return
      if (tm.role === 'ebeveyn' && parents.length === 1 && parents[0] === target) fail('LAST_PARENT') // K14
      const votersEx = voters.filter((id) => id !== target)
      need(votersEx, majority(votersEx.length))
      if (tm.role === 'ebeveyn') {
        const others = parents.filter((id) => id !== target)
        if (others.length > 0 && !allOf(others)) fail('NO_PARENT_APPROVAL')
        if (adults.length > 0) need(adults, majority(adults.length), 'NO_ADULT_APPROVAL')
      } else {
        need(parents, majority(parents.length), 'NO_PARENT_APPROVAL')
      }
      return
    }

    case T.LEAVE: {
      const id = hex(body.memberId)
      if (!(signers.size === 1 && signers.has(id))) fail('LEAVE_ERROR')
      const m = L.members.get(id)
      if (!m || !m.active) fail('NO_TARGET')
      // Son ebeveyn giderse kimse üye ekleyip atamaz; bekleyen üyeler de sayılır (K15, O1). Kendi ek kimlikleri sayılmaz.
      const others = [...L.members].filter(([oid, om]) => oid !== id && om.active && om.role !== 'kutu' && !(om.extra && om.personOf === L.personIdOf(id))).length
      if (m.role === 'ebeveyn' && parents.length === 1 && parents[0] === id && others > 0) fail('LAST_PARENT')
      return
    }

    case T.ACTIVATE_MEMBER: {
      // K15: herhangi bir ebeveyn; K16 cihaz değişiminde bekleyen ebeveynin kendisi de. Saate bakılmaz.
      const id = hex(body.memberId)
      const m = L.members.get(id)
      if (!m || !m.active || !(L.isPending(id) || m.pendingPrimary)) fail('NOT_WAITING')
      // Bekleyen ana kimlik devri: kişi hâlâ defterde olmalı (veto ve ayrılmadan sonra açılmaz, RFC-0019 §11.8 c)
      if (m.pendingPrimary && !L.persons.has(m.personOf)) fail('NOT_WAITING')
      // Devir yazıldığı ana kimliğe bağlıdır (RFC-0020 b)
      if (m.pendingPrimary && L.persons.get(m.personOf).primary !== m.pendingAgainst) fail('CHANGE_DROPPED')
      // Bekleyen cihaz değişimi: eski kimlik aktif ve kişinin ana kimliği olmalı (RFC-0019 §11.8 a)
      if (m.pendingRotation) {
        const old = L.members.get(m.rotatedFrom)
        const kisi = old && L.persons.get(L.personIdOf(m.rotatedFrom))
        if (!old || !old.active || !kisi || kisi.primary !== m.rotatedFrom) fail('CHANGE_DROPPED')
      }
      // Uzaktan katılımın etkinleşmesi kişi sınırını yeniden denetler
      if (m.pendingRemote && phones.length >= L.policy.maxMembers) fail('MEMBER_LIMIT')
      if (count(parents) >= 1) return
      if (m.pendingPrimary && signers.has(id)) return // RFC-0017 §7: bekleyen yeni ana kimlik kendisi
      if (m.pendingRotation && signers.has(id)) return
      fail('NO_PARENT_SIGNATURE')
    }

    case T.ROTATE_DEVICE: {
      const old = hex(body.oldMemberId)
      const om = L.members.get(old)
      if (!om || !om.active) fail('NO_TARGET')
      if (L.isPending(old)) fail('PENDING_MEMBER')
      if (om.role === 'kutu') fail('INVALID_ROLE') // kutu yeniden eklenir
      if (om.extra) fail('INVALID_ROLE') // ek kimlik ROTATE_DEVICE yazamaz; yeni cihazda replaces ile eklenir (RFC-0017 §4.3)
      if (!signers.has(newId)) fail('NO_NEW_MEMBER_APPROVAL')
      if (isZero(body.ceremonyTranscriptHash)) fail('INVALID_TRANSCRIPT')
      // Kip gövdede (RFC-0020 a): oldSigned imzalarla tutarlı olmalı; v2.1+ ailede zorunlu, v1 zincirinde imzadan
      const oldSigned = rotateOldSigned(L, body, signers)
      // Eski cihaz imzalıyorsa hemen geçerli; kayıpsa onun imzası aranmaz
      if (oldSigned || om.role !== 'ebeveyn') {
        need(voters, majority(voters.length - 1))
        return {}
      }
      // K14 + K16: ebeveyn, eski cihaz imzası olmadan → diğer bütün ebeveynler + yetişkin çoğunluğu;
      // hiçbiri yoksa Aile Kutusu ya da (yalnız çocuk varsa) bir çocuk tanık. Her durumda 72 sa bekleme + veto.
      if ([...L.members.values()].some((m) => m.active && m.pendingRotation && m.rotatedFrom === old)) fail('PENDING_CHANGE')
      const others = parents.filter((id) => id !== old)
      if (others.length + adults.length > 0) {
        if (others.length > 0 && !allOf(others)) fail('NO_PARENT_APPROVAL')
        if (adults.length > 0) need(adults, majority(adults.length), 'NO_ADULT_APPROVAL')
      } else {
        const witnesses = [...L.boxIds(), ...phones.filter((id) => roleOf(id) === 'cocuk')]
        need(witnesses, 1, 'NO_WITNESS')
      }
      return { pendingRotation: true }
    }

    case T.POLICY: {
      const p = validatePolicy(body.policy)
      if (p.maxMembers < phones.length) fail('INVALID_POLICY')
      if (!allOf(parents)) fail('NO_PARENT_APPROVAL')
      return
    }

    case T.PLAN:
      if (signers.size !== 1 || !phones.includes([...signers][0])) fail('PLAN_SIGNER')
      if (!PRODUCTS.includes(body.product) && !/^hizmet:[a-z0-9-]+$/.test(body.product)) fail('PLAN_PRODUCT')
      return

    case T.PREKEY:
      return prekeyDenetle(L, body, signers)

    case T.SET_ROLE: {
      const id = hex(body.memberId)
      const m = L.members.get(id)
      if (!m || !m.active || m.role === 'kutu') fail('NO_TARGET')
      if (m.extra) fail('INVALID_ROLE') // SET_ROLE ana kimliğe uygulanır; ek kimlikler izler
      if (!ROLES.includes(body.role) || body.role === 'kutu' || body.role === m.role) fail('INVALID_ROLE')
      if (body.role === 'ebeveyn' && parents.length >= MAX_PARENTS) fail('PARENT_LIMIT')
      if (m.role === 'ebeveyn' && parents.length === 1) fail('LAST_PARENT')
      if (!allOf(parents) || !signers.has(id)) fail('NO_PARENT_APPROVAL')
      return
    }

    // Sürüm 3 (Aile Ağı). crossSig'in biçimi docs/18'de; o belge gelene kadar yalnız saklanır.
    case T.LINK: {
      const bridge = hex(body.bridgeLocalId)
      if (L.links.has(hex(body.linkId))) fail('LINK_ALREADY_EXISTS')
      if (!phones.includes(bridge) || roleOf(bridge) === 'cocuk') fail('INVALID_BRIDGE')
      if (!allOf(parents) || !signers.has(bridge)) fail('NO_PARENT_APPROVAL')
      return
    }
    case T.UNLINK: {
      const link = L.links.get(hex(body.linkId))
      if (!link || !link.active) fail('NO_LINK')
      return need(parents, 1, 'NO_PARENT_SIGNATURE')
    }
    case T.INTRO: {
      const link = L.links.get(hex(body.linkId))
      if (!link || !link.active) fail('NO_LINK')
      if (!(signers.size === 1 && signers.has(link.bridge))) fail('INVALID_BRIDGE')
      return
    }

    // Protokol v2.1 (RFC-0003 §5)
    case T.DEVICE_ATTACH:
    case T.DEVICE_DETACH:
    case T.PLACE:
    case T.BEING:
    case T.GRANT:
    case T.REVOKE:
    case T.SHARE_CONSENT:
    case T.KIND:
    case T.COLLECTION:
    case T.PROTOCOL_LEVEL:
    case T.TASK_PERMIT:
      return checkV21(L, e, body, signers, newId)

    // Protokol v2.2 (RFC-0017 §4)
    case T.APP_ATTACH:
    case T.APP_PRIMARY:
      return checkV22(L, e, body, signers, newId)

    // Protokol v2.3 (RFC-0030 §3)
    case T.GRANT_WRITE:
      return checkV23(L, e, body, signers)

    default:
      fail('UNKNOWN_EVENT')
  }
}

function prekeyIdOf (pub) { return hash('prekey-id', pub).subarray(0, 8) }

module.exports = { rotateOldSigned, ROTATE_WAIT_MS, checkQuorum, NEEDS_MORE, NEEDS_MORE_EKIP, needsMore, majority, prekeyIdOf, REMOTE_WAIT_MS, DAY_MS }
