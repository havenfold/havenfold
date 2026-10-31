// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// ledger/v22.js — defter v2.2: kişi, ana kimlik ve ek kimlikler (RFC-0017 §4, §7)
//
// Bir kişinin bir ana kimliği ve en çok 4 ek kimliği olur. Ek kimlik members haritasındadır (aynı HELLO, çift sırrı ve
// zarf kodu ona da çalışır) ve personOf, appId, sameDevice, extra alanlarını taşır. Sınırlar, yeter sayılar ve kasa
// eşikleri yalnız ana kimlikleri sayar (Ledger.personIds).
const b4a = require('b4a')
const { T } = require('./encoding')
const { levelAtLeast } = require('./v21')

const hex = (b) => b4a.toString(b, 'hex')
const isZero = (b) => b.every((x) => x === 0)
function fail (code) { throw new Error(code) }

const MAX_EXTRAS = 4
const GATED_V22 = new Set([T.APP_ATTACH, T.APP_PRIMARY])

// Ek kimliğin imzalayabildiği olaylar (§4.3 "Oy" satırı). Yeni kimlik olarak kendi APP_ATTACH'i _newMemberId yolundan.
function extraMaySign (L, id, type, body) {
  const m = L.members.get(id)
  switch (type) {
    case T.PREKEY: return true // sahibi olayın tek imzacısı olmalı (quorum PREKEY)
    case T.LEAVE: return hex(body.memberId) === id
    case T.APP_PRIMARY: return hex(body.newPrimaryId) === id
    case T.ACTIVATE_MEMBER: return hex(body.memberId) === id && !!m.pendingPrimary
    case T.COLLECTION: return body.kind === 'kisisel' // sahibin kişisi COLLECTION kuralında denetlenir
    default: return false
  }
}

function checkV22 (L, e, body, signers, newId) {
  switch (e.type) {
    case T.APP_ATTACH: {
      const pid = hex(body.personId)
      const primary = L.persons.get(pid)?.primary
      const pm = primary && L.members.get(primary)
      if (!pm || !pm.active || L.isPending(primary) || pm.role === 'kutu') fail('NO_PERSON')
      if (!signers.has(newId)) fail('NO_NEW_MEMBER_APPROVAL')
      if (!signers.has(primary)) fail('NO_PERSON_APPROVAL')
      if (isZero(body.ceremonyTranscriptHash)) fail('INVALID_TRANSCRIPT')
      let replaced = null
      if (body.replaces) {
        const rid = hex(body.replaces)
        const r = L.members.get(rid)
        const sameApp = r && r.personOf === pid && r.extra && r.appId === body.appId
        const oldPrimary = r && r.personOf === pid && r.demotedSeq !== undefined && !r.active
        if (!r || r.rotatedTo || !(sameApp || oldPrimary)) fail('CANNOT_REPLACE')
        if (r.active) replaced = rid
      }
      const extras = L.extraIdsOf(pid).filter((id) => id !== replaced)
      if (extras.length >= MAX_EXTRAS) fail('SECONDARY_IDENTITY_LIMIT')
      return
    }

    case T.APP_PRIMARY: {
      const pid = hex(body.personId)
      const primary = L.persons.get(pid)?.primary
      if (!primary || !L.members.get(primary)?.active) fail('NO_PERSON')
      const nid = hex(body.newPrimaryId)
      const nm = L.members.get(nid)
      if (!nm || !nm.active || !nm.extra || nm.personOf !== pid) fail('NO_TARGET')
      if (!signers.has(nid)) fail('NO_NEW_MEMBER_APPROVAL')
      // Devir yazıldığı ana kimliğe bağlı (RFC-0020 b); kip bayrakları imzalarla tutarlı olmalı (RFC-0020 a)
      if (hex(body.against) !== primary) fail('CHANGE_DROPPED')
      if (body.oldSigned !== signers.has(primary)) fail('MODE_MISMATCH')
      if (L.extraIdsOf(pid).some((id) => L.members.get(id).pendingPrimary)) fail('PENDING_CHANGE')
      // Ana kimlik için bekleyen imzasız cihaz değişimi varken devir yapılamaz (çalınan telefon, RFC-0019 §11.8 a)
      if ([...L.members.values()].some((m) => m.active && m.pendingRotation && m.rotatedFrom === primary)) fail('PENDING_CHANGE')
      // Ebeveyn hızlandırması: kişi dışındaki bir ebeveyn de imzalarsa bekleme olmaz
      const otherParent = L.parentIds().some((id) => id !== primary && signers.has(id))
      if (body.parentSigned !== otherParent) fail('MODE_MISMATCH')
      return { pendingPrimary: !body.oldSigned && !body.parentSigned }
    }

    default:
      fail('UNKNOWN_EVENT')
  }
}

function mutateV22 (L, e, body, h, newId, q = {}) {
  switch (e.type) {
    case T.APP_ATTACH: {
      const pid = hex(body.personId)
      const primary = L.members.get(L.persons.get(pid).primary)
      const cert = body.deviceCert
      L.members.set(newId, {
        id: b4a.from(newId, 'hex'),
        name: primary.name,
        role: primary.role,
        signPub: cert.ukaPub,
        udaPub: cert.udaPub,
        cert,
        active: true,
        addedSeq: e.seq,
        anchor: h,
        prekeys: [],
        personOf: pid,
        appId: body.appId,
        sameDevice: body.sameDevice,
        extra: true,
        // Cihaz grubu: aynı cihazdaki kimlikler (§3). sameDevice ise ekleyen ana kimliğin grubu.
        group: body.sameDevice ? primary.group : newId
      })
      if (body.replaces) {
        // Etkisi eski cihazın imzalamadığı ROTATE_DEVICE'ınki gibi: eski kimlik pasif, rotatedTo bağı (§4.2)
        const old = L.members.get(hex(body.replaces))
        if (old.active) { old.active = false; old.removedSeq = e.seq }
        old.pendingPrimary = false
        old.rotatedTo = newId
        L.members.get(newId).rotatedFrom = hex(body.replaces)
      }
      break
    }
    case T.APP_PRIMARY: {
      const nid = hex(body.newPrimaryId)
      if (q.pendingPrimary) {
        // 72 saat bekleme (K16 düzeni); ACTIVATE_MEMBER ile etkinleşir, eski kimlik ya da bir ebeveyn veto edebilir
        L.members.get(nid).pendingPrimary = true
        L.members.get(nid).pendingAgainst = hex(body.against)
        if (!L.acceptedAt.has(nid)) L.acceptedAt.set(nid, L.now())
        break
      }
      promote(L, hex(body.personId), nid, e.seq)
      break
    }
  }
}

// Ana kimlik değişir: persons[personId].primary yeni kimlik; eski kimlik pasifleşir ve personOf alır (§7)
function promote (L, pid, nid, seq) {
  const p = L.persons.get(pid)
  const old = L.members.get(p.primary)
  const nm = L.members.get(nid)
  nm.extra = false
  nm.pendingPrimary = false
  nm.role = old.role
  if (old.active) { old.active = false; old.removedSeq = seq }
  old.personOf = pid
  old.demotedSeq = seq
  p.primary = nid
}

module.exports = { MAX_EXTRAS, GATED_V22, extraMaySign, checkV22, mutateV22, promote, levelAtLeast }
