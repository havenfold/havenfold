// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// ledger/team.js — ekip topluluğu: roller, hiyerarşik yeter sayı, yere atama, geçici süre, aydınlatma (RFC-0005)
//
// Aile yolu (quorum.js, v21.js) bayt bayt aynı kalır; KIND = 'ekip' olan defterde GENESIS dışındaki bütün olaylar
// buradan denetlenir. Yönetim = aktif, bekleyen olmayan sahipler ve yöneticiler (kişiler, ana kimlikler). Çalışanın
// imzası tabloda açıkça istenmedikçe sayılmaz; geçici ve kutu oy vermez (§6.1).
const b4a = require('b4a')
const { T } = require('./encoding')
const { validatePolicy, ROLES_BY_KIND, HARD_MAX_MEMBERS_EKIP, MAX_OWNERS, EKIP_KUTUSUZ_SINIR } = require('./policy')

const hex = (b) => b4a.toString(b, 'hex')
const isZero = (b) => b.every((x) => x === 0)
function fail (code) { throw new Error(code) }
const majority = (k) => Math.floor(k / 2) + 1
const DAY_MS = 86_400_000
const TERM_MAX_MS = 90 * DAY_MS

const EKIP_ROLLERI = ROLES_BY_KIND.ekip
const EKIP_YER_TURLERI = ['sube', 'depo', 'ciftlik', 'ofis', 'diger']
const DEVICE_CLASSES = ['isci', 'uc', 'aksesuar']
const SINIR = { yer: 8, yerCihaz: 16, cihaz: 64, misafir: 8, varlik: 256, telefonYer: 8 }
const EKIP_OLAYLARI = new Set([T.ASSIGN, T.TERM, T.NOTICE])
const PLAN_URUNLERI = /^(mekan|hizmet:[a-z0-9-]+)$/

// Rol kümeleri (kişiler; ek kimlik ve bekleyen sayılmaz)
function roller (L) {
  const kisiler = L.personIds()
  const rol = (id) => L.members.get(id).role
  const S = kisiler.filter((id) => rol(id) === 'sahip')
  const Y = kisiler.filter((id) => rol(id) === 'yonetici')
  return { kisiler, S, Y, yonetim: [...S, ...Y] }
}

const authorityIdsEkip = (L) => roller(L).yonetim

// Atama ve süre anahtarı: üyede kişi (personIdOf), cihazda kendi kimliği. Yazım ve okuma yalnız bu anahtardan
// (inceleme 7 bulgu 1): telefon değişiminden sonra yazılan ASSIGN ve TERM eski kaydın gölgesinde kalmaz.
const kisiAnahtari = (L, id) => (L.members.has(id) ? (L.personIdOf(id) || id) : id)

// Kişinin atandığı aktif yerler
function yerleri (L, id) {
  const a = L.assignments.get(kisiAnahtari(L, id))
  return a ? a.placeIds.filter((p) => L.places.get(p)?.active) : []
}

// Yönetim alanı (§6.2): hedefin yerlerinin hepsi yöneticinin yerleri arasında; hedefin ataması boşsa yalnız sahip
function alanda (L, yoneticiId, hedefYerler) {
  if (!hedefYerler.length) return false
  const alan = new Set(yerleri(L, yoneticiId))
  return hedefYerler.every((p) => alan.has(p))
}

// Olay ekipte geçerli mi (§4.1): GENESIS, KIND ve PROTOCOL_LEVEL dışındaki her olay düzey 2.1 ister
const DUZEYSIZ = new Set([T.GENESIS, T.KIND, T.PROTOCOL_LEVEL])

// L: olaydan önceki defter. Dönüş: aile quorum'un döndürdüğü gibi ({ pendingRotation } vb.)
function checkQuorumEkip (L, e, body, signers, newId, ortak) {
  const { kisiler, S, Y, yonetim } = roller(L)
  const roleOf = (id) => L.members.get(id)?.role
  const any = (ids) => ids.some((id) => signers.has(id))
  const all = (ids) => ids.length > 0 && ids.every((id) => signers.has(id))
  const count = (ids) => ids.reduce((k, id) => k + (signers.has(id) ? 1 : 0), 0)
  const sahipImzasi = () => { if (!any(S)) fail('NO_OWNER_SIGNATURE') }
  const yonetimImzasi = () => { if (!any(yonetim)) fail('NO_MANAGEMENT_SIGNATURE') }
  // Sahip sınırına bekleyen uzaktan sahipler de sayılır (inceleme 7 bulgu 8)
  const bekleyenSahip = [...L.members].filter(([x, m]) => m.active && !m.extra && m.role === 'sahip' && L.isPending(x) && m.pendingRemote).length
  const sahipSayisi = S.length + bekleyenSahip
  // Sahip ya da (hedefin yerleri alanındaysa) bir yönetici
  const sahipYaDaAlanda = (hedefYerler) => {
    if (any(S)) return
    if (Y.some((y) => signers.has(y) && alanda(L, y, hedefYerler))) return
    if (any(Y)) fail('OUT_OF_SCOPE')
    fail('NO_MANAGEMENT_SIGNATURE')
  }

  switch (e.type) {
    case T.ADD_MEMBER: {
      if (!signers.has(newId)) fail('NO_NEW_MEMBER_APPROVAL')
      const davet = hex(body.inviterId)
      if (!signers.has(davet)) fail('NO_INVITE_ER_SIGNATURE')
      if (!yonetim.includes(davet)) fail('NO_INVITE_PERMISSION')
      if (isZero(body.ceremonyTranscriptHash)) fail('INVALID_TRANSCRIPT')
      if (!EKIP_ROLLERI.includes(body.role)) fail('INVALID_ROLE')
      if (body.role === 'kutu') {
        if (body.remote) fail('INVALID_ROLE')
        const yerSayisi = [...L.places.values()].filter((p) => p.active).length
        if (L.boxIds().length >= yerSayisi) fail('BOX_LIMIT') // toplam kutu ≤ aktif yer (§8.1)
        return sahipImzasi()
      }
      const n = L.personCountWithPending()
      if (n >= Math.min(L.policy.maxMembers, HARD_MAX_MEMBERS_EKIP)) fail('MEMBER_LIMIT')
      if (n >= EKIP_KUTUSUZ_SINIR && L.boxIds().length === 0) fail('BOX_REQUIRED') // 9. kişi kutu ister (§11.2)
      if (body.role === 'sahip') {
        if (sahipSayisi >= MAX_OWNERS) fail('OWNER_LIMIT')
        if (!all(S)) fail('NO_OWNER_APPROVAL')
      } else if (body.role === 'yonetici') sahipImzasi()
      else yonetimImzasi()
      if (body.remote) {
        if (body.role === 'gecici') fail('INVALID_ROLE')
        if (!all(S)) fail('NO_OWNER_APPROVAL')
        if (body.activatesAt < e.ts + DAY_MS) fail('REMOTE_WAITING')
      } else if (body.activatesAt !== 0) fail('REMOTE_WAITING')
      return
    }

    case T.REMOVE_MEMBER: {
      const target = hex(body.memberId)
      const tm = L.members.get(target)
      if (!tm || !tm.active) fail('NO_TARGET')
      if (signers.has(target)) fail('TARGET_CANNOT_SELF_VOTE')
      if (tm.role === 'kutu') return sahipImzasi()
      if (tm.extra) {
        if (tm.pendingPrimary && signers.has(L.persons.get(tm.personOf)?.primary)) return
        return sahipImzasi()
      }
      if (tm.pendingRotation && signers.has(tm.rotatedFrom)) return // K16 vetosu
      if (tm.role === 'sahip') {
        if (S.length === 1 && S[0] === target) fail('LAST_OWNER')
        const digerleri = S.filter((id) => id !== target)
        if (count(digerleri) < majority(digerleri.length)) fail('NO_OWNER_APPROVAL')
        return
      }
      if (tm.role === 'yonetici') return sahipImzasi()
      return sahipYaDaAlanda(yerleri(L, target))
    }

    case T.LEAVE: {
      const id = hex(body.memberId)
      if (!(signers.size === 1 && signers.has(id))) fail('LEAVE_ERROR')
      const m = L.members.get(id)
      if (!m || !m.active) fail('NO_TARGET')
      const digerleri = [...L.members].filter(([oid, om]) => oid !== id && om.active && om.role !== 'kutu' && !(om.extra && om.personOf === L.personIdOf(id))).length
      if (m.role === 'sahip' && S.length === 1 && S[0] === id && digerleri > 0) fail('LAST_OWNER')
      return
    }

    case T.ROTATE_DEVICE: {
      const old = hex(body.oldMemberId)
      const om = L.members.get(old)
      if (!om || !om.active) fail('NO_TARGET')
      if (L.isPending(old)) fail('PENDING_MEMBER')
      if (om.role === 'kutu' || om.extra) fail('INVALID_ROLE')
      if (!signers.has(newId)) fail('NO_NEW_MEMBER_APPROVAL')
      if (isZero(body.ceremonyTranscriptHash)) fail('INVALID_TRANSCRIPT')
      const oldSigned = ortak.rotateOldSigned(L, body, signers)
      if (oldSigned) return {}
      // RFC-0022 c: yönetici yalnız kendi alanındaki kişinin telefonunu değiştirir
      if (om.role === 'calisan' || om.role === 'gecici') { sahipYaDaAlanda(yerleri(L, old)); return {} }
      if (om.role === 'yonetici') { sahipImzasi(); return {} }
      // Sahip, eski cihaz imzası yok: diğer bütün sahipler; yoksa bir yönetici; o da yoksa kutu tanık. 72 sa + veto.
      if ([...L.members.values()].some((m) => m.active && m.pendingRotation && m.rotatedFrom === old)) fail('PENDING_CHANGE')
      const digerleri = S.filter((id) => id !== old)
      if (digerleri.length) { if (!all(digerleri)) fail('NO_OWNER_APPROVAL') } else if (Y.length) { if (!any(Y)) fail('NO_MANAGEMENT_SIGNATURE') } else if (!any(L.boxIds())) fail('NO_WITNESS')
      return { pendingRotation: true }
    }

    case T.POLICY: {
      const p = validatePolicy(body.policy, 'ekip')
      if (p.maxMembers < kisiler.length) fail('INVALID_POLICY')
      if (!all(S)) fail('NO_OWNER_APPROVAL')
      return
    }

    case T.PLAN:
      if (signers.size !== 1 || !S.includes([...signers][0])) fail('PLAN_SIGNER')
      if (!PLAN_URUNLERI.test(body.product)) fail('PLAN_PRODUCT')
      return

    case T.PREKEY:
      return ortak.prekey(L, body, signers)

    case T.SET_ROLE: {
      const id = hex(body.memberId)
      const m = L.members.get(id)
      if (!m || !m.active || m.role === 'kutu') fail('NO_TARGET')
      if (m.extra) fail('INVALID_ROLE')
      if (!EKIP_ROLLERI.includes(body.role) || body.role === 'kutu' || body.role === m.role) fail('INVALID_ROLE')
      if (body.role === 'sahip') {
        if (sahipSayisi >= MAX_OWNERS) fail('OWNER_LIMIT')
        if (!all(S) || !signers.has(id)) fail('NO_OWNER_APPROVAL')
        return
      }
      if (m.role === 'sahip') {
        if (S.length === 1) fail('LAST_OWNER')
        const digerleri = S.filter((x) => x !== id)
        if (!all(digerleri) || !signers.has(id)) fail('NO_OWNER_APPROVAL')
        return
      }
      // yönetici, çalışan, geçici arasında: herhangi bir sahip; çalışan ↔ geçici ayrıca alanındaki yönetici
      const altGecis = ['calisan', 'gecici'].includes(m.role) && ['calisan', 'gecici'].includes(body.role)
      if (altGecis) return sahipYaDaAlanda(yerleri(L, id))
      return sahipImzasi()
    }

    case T.LINK: {
      const bridge = hex(body.bridgeLocalId)
      if (L.links.has(hex(body.linkId))) fail('LINK_ALREADY_EXISTS')
      if (!yonetim.includes(bridge)) fail('INVALID_BRIDGE')
      if (!all(S) || !signers.has(bridge)) fail('NO_OWNER_APPROVAL')
      return
    }
    case T.UNLINK: {
      const link = L.links.get(hex(body.linkId))
      if (!link || !link.active) fail('NO_LINK')
      return sahipImzasi()
    }
    case T.INTRO: {
      const link = L.links.get(hex(body.linkId))
      if (!link || !link.active) fail('NO_LINK')
      if (!(signers.size === 1 && signers.has(link.bridge))) fail('INVALID_BRIDGE')
      return
    }

    case T.ACTIVATE_MEMBER: {
      const id = hex(body.memberId)
      const m = L.members.get(id)
      if (!m || !m.active || !(L.isPending(id) || m.pendingPrimary)) fail('NOT_WAITING')
      if (m.pendingPrimary && (!L.persons.has(m.personOf) || L.persons.get(m.personOf).primary !== m.pendingAgainst)) fail('CHANGE_DROPPED')
      if (m.pendingRotation) {
        const old = L.members.get(m.rotatedFrom)
        const kisi = old && L.persons.get(L.personIdOf(m.rotatedFrom))
        if (!old || !old.active || !kisi || kisi.primary !== m.rotatedFrom) fail('CHANGE_DROPPED')
      }
      if (m.pendingRemote && kisiler.length >= Math.min(L.policy.maxMembers, HARD_MAX_MEMBERS_EKIP)) fail('MEMBER_LIMIT')
      if (m.pendingRemote && m.role === 'sahip' && S.length >= MAX_OWNERS) fail('OWNER_LIMIT')
      if (any(S)) return
      if ((m.pendingPrimary || m.pendingRotation) && signers.has(id)) return
      fail('NO_OWNER_SIGNATURE')
    }

    case T.DEVICE_ATTACH: {
      if (!DEVICE_CLASSES.includes(body.class)) fail('INVALID_BODY')
      if (!signers.has(newId)) fail('NO_NEW_DEVICE_APPROVAL')
      if (isZero(body.ceremonyTranscriptHash)) fail('INVALID_TRANSCRIPT')
      if (isZero(body.placeId)) fail('PLACE_REQUIRED')
      const yer = hex(body.placeId)
      if (!L.places.get(yer)?.active) fail('NO_PLACE')
      sahipYaDaAlanda([yer])
      cihazSiniri(L, yer)
      return
    }

    case T.DEVICE_DETACH: {
      const id = hex(body.deviceId)
      if (!L.devices.get(id)?.active) fail('NO_TARGET')
      if (!isZero(body.wipeReportHash) && !body.wipe) fail('INVALID_BODY')
      if (!signers.has(id)) yonetimImzasi()
      return
    }

    case T.PLACE: {
      sahipImzasi()
      if (!EKIP_YER_TURLERI.includes(body.kind) || isZero(body.placeId)) fail('INVALID_BODY')
      const p = L.places.get(hex(body.placeId))
      if (body.remove) { if (!p?.active) fail('NO_TARGET'); return }
      if (!p?.active && [...L.places.values()].filter((x) => x.active).length >= SINIR.yer) fail('PLACE_LIMIT')
      return
    }

    case T.BEING: {
      if (isZero(body.beingId)) fail('INVALID_BODY')
      const b = L.beings.get(hex(body.beingId))
      const yer = isZero(body.placeId) ? null : hex(body.placeId)
      if (yer && !L.places.get(yer)?.active) fail('NO_PLACE')
      if (yer) sahipYaDaAlanda([yer])
      else sahipImzasi()
      if (body.remove) { if (!b?.active) fail('NO_TARGET'); return }
      if (!b?.active && [...L.beings.values()].filter((x) => x.active).length >= SINIR.varlik) fail('BEING_LIMIT')
      return
    }

    case T.GRANT: {
      if (!signers.has(newId)) fail('NO_NEW_DEVICE_APPROVAL')
      yonetimImzasi()
      const by = hex(body.grantedBy)
      if (!signers.has(by) || !yonetim.includes(by)) fail('INVALID_BODY')
      if (isZero(body.ceremonyTranscriptHash)) fail('INVALID_TRANSCRIPT')
      if (body.taskTypes.length !== 0) fail('INVALID_BODY')
      if (L.activeGrantIds().length >= SINIR.misafir) fail('GUEST_LIMIT')
      for (const cid of body.collections) {
        const col = L.collections.get(hex(cid))
        if (!col || col.kind !== 'bakici' || col.sensitivity !== 'normal') fail('NOT_COLLECTION_ELIGIBLE')
        if (!ortak.yonetimOkuyucuVar(L, col.readers)) fail('NO_PARENT_READER')
      }
      return
    }

    case T.REVOKE: {
      yonetimImzasi()
      const g = L.grants.get(hex(body.grantId))
      if (!g || !(g.active || (g.orphaned && !g.revoked))) fail('NO_TARGET')
      return
    }

    case T.SHARE_CONSENT: {
      // RFC-0010 açıklama 3 madde 1: iptal biçimini Paylaşımlar'ın okuyucusu (aktif sahip ya da yönetici) da yazabilir
      const { iptalBicimi, okuyucuImzasi } = require('./v21') // döngüsel bağımlılık olmasın: çağrıda
      if (iptalBicimi(body) && okuyucuImzasi(L, signers, ['sahip', 'yonetici'])) return
      sahipImzasi()
      if (isZero(body.ownerId)) return
      const owner = L.canonical(hex(body.ownerId))
      if (!owner || !kisiler.includes(owner)) fail('NO_TARGET')
      if (!signers.has(owner)) fail('NO_OWNER_APPROVAL')
      return
    }

    case T.KIND:
      fail('KIND_ERROR') // yalnız seq 1'de, aile kurallarıyla (§4.1)

    case T.COLLECTION:
      return ortak.checkCollection(L, body, signers)

    case T.PROTOCOL_LEVEL:
      sahipImzasi()
      return ortak.level(L, body)

    case T.TASK_PERMIT:
      sahipImzasi()
      return ortak.taskPermit(L, body)

    case T.ASSIGN:
      return checkAssign(L, body, signers, { S, Y, sahipYaDaAlanda })

    case T.TERM: {
      const id = hex(body.memberId)
      const m = L.members.get(id)
      if (!m || !m.active || m.role !== 'gecici') fail('NOT_TARGET_TEMPORARY')
      const q = sahipYaDaAlanda(yerleri(L, id))
      // 90 gün (RFC-0005 §7.2; inceleme 16 K3): olayın kendi zamanına göre, saate bakmadan; imza yeter sayısından sonra
      // denetlenir ki imzalayan telefon öneriyi görüp reddedebilsin
      if (body.expiresAt > e.ts + TERM_MAX_MS) fail('TERM_LIMIT')
      return q
    }

    case T.NOTICE: {
      sahipImzasi()
      const yer = hex(body.placeId)
      if (!L.places.get(yer)?.active) fail('NO_PLACE')
      if (!body.remove && (isZero(body.textBlobId) || isZero(body.signBlobId))) fail('NOTICE_MISSING')
      if (!body.outbound.every((x) => /^hizmet:[0-9a-f]{32}$/.test(x))) fail('INVALID_BODY')
      return
    }

    case T.APP_ATTACH:
    case T.APP_PRIMARY: {
      // RFC-0022 b: ekipte hızlandırma (parentSigned) ROTATE_DEVICE tablosuna bağlıdır. Sahip için diğer bütün sahipler,
      // yönetici için bir sahip, çalışan ve geçici için sahip ya da alanındaki yönetici. Yoksa devir bekler (72 sa).
      const primary = L.persons.get(hex(body.personId))?.primary
      const rol = primary && L.members.get(primary)?.role
      let onay = false
      if (rol === 'sahip') { const d = S.filter((x) => x !== primary); onay = d.length > 0 && all(d) }
      if (rol === 'yonetici') onay = any(S)
      if (rol === 'calisan' || rol === 'gecici') onay = any(S) || Y.some((y) => y !== primary && signers.has(y) && alanda(L, y, yerleri(L, primary)))
      // v22'nin otherParent'ı = yönetimden (ana kimlik dışında) bir imzacı; onay yoksa boş liste verilir
      const hizlandiran = onay ? [...signers].filter((x) => x !== primary) : []
      return ortak.v22(Object.assign(Object.create(L), { authorityIds: () => hizlandiran }), e, body, signers, newId)
    }

    // RFC-0030 §3: ekipte "ebeveyn" yerine yönetim (misafirliği de yönetim verir)
    case T.GRANT_WRITE:
      return ortak.v23(L, e, body, signers)

    default:
      fail('UNKNOWN_EVENT')
  }
}

// Yerdeki ve ekipteki aktif cihaz sınırı (§8.2)
function cihazSiniri (L, yer, haric = null) {
  const aktif = L.activeDeviceIds().filter((id) => id !== haric)
  if (aktif.length >= SINIR.cihaz) fail('DEVICE_LIMIT')
  if (aktif.filter((id) => L.devices.get(id).placeId === yer).length >= SINIR.yerCihaz) fail('PLACE_DEVICE_LIMIT')
}

// §7.1 ASSIGN
function checkAssign (L, body, signers, { S, sahipYaDaAlanda }) {
  const id = hex(body.subjectId)
  const yerler = body.placeIds.map(hex)
  if (new Set(yerler).size !== yerler.length) fail('INVALID_BODY')
  for (const p of yerler) if (!L.places.get(p)?.active) fail('NO_PLACE')
  const m = L.members.get(id)
  const d = L.devices.get(id)
  if (m && m.active) {
    if (m.extra) fail('NO_TARGET') // atama kişiye (ana kimliğe)
    if (m.role === 'kutu') {
      if (yerler.length !== 1) fail('INVALID_BODY')
      const baska = L.boxIds().find((k) => k !== id && yerleri(L, k).includes(yerler[0]))
      if (baska) fail('PLACE_BOX_LIMIT')
      if (!S.some((x) => signers.has(x))) fail('NO_OWNER_SIGNATURE')
      return
    }
    if (yerler.length > SINIR.telefonYer) fail('INVALID_BODY')
    if (['sahip', 'yonetici'].includes(m.role)) { if (!S.some((x) => signers.has(x))) fail('NO_OWNER_SIGNATURE'); return }
    // Çalışan ve geçici: sahip ya da eski ve yeni yerlerin hepsi alanında olan yönetici
    const eskiYeni = [...new Set([...yerleri(L, id), ...yerler])]
    return sahipYaDaAlanda(eskiYeni)
  }
  if (d && d.active) {
    if (yerler.length !== 1) fail('INVALID_BODY')
    if (yerler[0] !== d.placeId) cihazSiniri(L, yerler[0], id)
    return sahipYaDaAlanda([...new Set([d.placeId, yerler[0]].filter((x) => x && !/^0+$/.test(x)))])
  }
  fail('NO_TARGET')
}

// Durum değişikliği (L: olayın uygulandığı defter)
function mutateEkip (L, e, body) {
  switch (e.type) {
    case T.ASSIGN: {
      const id = hex(body.subjectId)
      const placeIds = body.placeIds.map(hex)
      if (L.devices.has(id)) L.devices.get(id).placeId = placeIds[0]
      L.assignments.set(kisiAnahtari(L, id), { placeIds, seq: e.seq })
      break
    }
    case T.TERM:
      L.terms.set(kisiAnahtari(L, hex(body.memberId)), { expiresAt: body.expiresAt, seq: e.seq })
      break
    case T.NOTICE:
      L.notices.set(hex(body.placeId), { ...body, placeId: hex(body.placeId), seq: e.seq })
      break
  }
}

// Geçicinin geçerli süresi (§9.1): en büyük seq'li TERM; yoksa 0. Geçici değilse null (süre kuralı yok).
function gecerliSure (L, id) {
  const m = L.members.get(id)
  if (!m || m.role !== 'gecici') return null
  const t = L.terms.get(kisiAnahtari(L, id))
  return t ? t.expiresAt : 0
}

// Yerde etkin aydınlatma var mı (§7.3)
const aydinlatmaVar = (L, yer) => { const n = L.notices.get(yer); return !!n && !n.remove }

module.exports = {
  EKIP_ROLLERI, EKIP_YER_TURLERI, EKIP_OLAYLARI, DUZEYSIZ, SINIR, TERM_MAX_MS,
  roller, authorityIdsEkip, kisiAnahtari, yerleri, alanda, checkQuorumEkip, mutateEkip, gecerliSure, aydinlatmaVar
}
