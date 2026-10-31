// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// worklet/ledger/ledger.js — Aile Defteri (docs/04 §4)
//
// Defter yalnız imzalardan geçerlilik alır. apply() olayı tamamen doğrular, sonra durumu değiştirir;
// doğrulama başarısızsa durum hiç değişmez. HELLO (protocol/hello.js) bu sınıfı doğrudan kullanır:
// familyId, head, len ve members (hex → { signPub, udaPub, active, ... }).
const sodium = require('sodium-native')
const b4a = require('b4a')
const { hash } = require('../crypto/kdf')
const { verifyDeviceCert } = require('../crypto/device-cert')
const { T, decodeBody, encodeBody, encodeUnsigned, eventHash, encodeEvent, decodeEvent } = require('./encoding')
const { checkQuorum, prekeyIdOf, DAY_MS, REMOTE_WAIT_MS, ROTATE_WAIT_MS, rotateOldSigned } = require('./quorum')
const { DEFAULT_POLICY } = require('./policy')
const { GATED_V21, levelAtLeast, mutateV21, dropOrphanGrants } = require('./v21')
const { DUZEYSIZ, mutateEkip, authorityIdsEkip, kisiAnahtari } = require('./team')
const { GATED_V22, extraMaySign, mutateV22, promote } = require('./v22')
const { GATED_V23, mutateV23, dropGrantWrites } = require('./v23')

const V = 2
const ZERO32 = b4a.alloc(32)
// İptal edilen uzaktan davetliyle sınırlı oturumun süresi, REVOKE'un zamanından (D106; Codex 10. tur)
const DAVETLI_MS = 30 * DAY_MS
const hex = (b) => b4a.toString(b, 'hex')

function memberIdOf (ukaPub) { return hash('member-id', ukaPub).subarray(0, 16) }

// Ön anahtar imzası (K5): Ed25519(ÜKA, hash('prekey', memberId, prekeyId, pub, createdAt))
function prekeyDigest (memberId, body) {
  return hash('prekey', memberId, body.prekeyId, body.pub, body.createdAt)
}

class Ledger {
  // now: alıcının saati (K11 bekleme); acceptedAt: uzaktan eklenenlerin kabul anları (kalıcı, Core saklar)
  constructor ({ now = Date.now, acceptedAt = null } = {}) {
    this.now = now
    this._reset()
    if (acceptedAt) for (const [k, v] of (acceptedAt instanceof Map ? acceptedAt : Object.entries(acceptedAt))) this.acceptedAt.set(k, v)
  }

  _reset () {
    this.events = []
    this.hashes = []
    this.head = b4a.alloc(32)
    this.members = new Map() // hex → { id, name, role, signPub, udaPub, cert, active, addedSeq, anchor, prekeys, ... }
    this.links = new Map()
    this.acceptedAt = new Map() // hex → yerel ilk kabul anı (yalnız ACTIVATE bekletmesi için, K15)
    this.deferred = null // süresinden önce gelen ACTIVATE ve ardındakiler (sync.retryDeferred)
    this.plans = []
    this.policy = null
    this.familyId = null
    this.familyName = ''
    this.founderId = null
    // v2.1 (RFC-0003 §4). Sayı sınırları yalnız active = true öğeleri sayar.
    this.devices = new Map() // hex → { id, class, name, placeId, signPub, udaPub, cert, caps, active, addedSeq, anchor, removedSeq?, wipe? }
    this.grants = new Map() // hex → { id, name, signPub, udaPub, cert, collections, taskTypes, expiresAt, active, addedSeq, anchor, grantedBy }
    this.places = new Map() // hex → { id, name, kind, active }
    this.beings = new Map() // hex → { id, kind, name, placeId, active }
    this.collections = new Map() // hex → { id, name, kind, owner, readers, writers, sensitivity, taskAccess, history, dropKey, seq, createdSeq, hash }
    this.permits = new Map() // "subject|type" → { allow, seq }
    this.level = '2.0'
    this.kind = 'aile'
    // Ekip (RFC-0005 §4.3)
    this.assignments = new Map() // hex → { placeIds, seq }
    this.terms = new Map() // hex → { expiresAt, seq }
    this.notices = new Map() // placeIdHex → NOTICE gövdesi ve seq
    // v2.2 (RFC-0017 §4.3): personId (kişinin ilk ana kimliğinin rootId'si) → { primary }
    this.persons = new Map()
    // v2.3 (RFC-0030 §3): "grantId|collectionId" → { types, subjects, seq }
    this.grantWrites = new Map()
  }

  static fromEvents (events, opts) {
    const l = new Ledger(opts)
    for (const e of events) l.apply(e)
    return l
  }

  get len () { return this.events.length }

  hashAt (seq) { return seq < 0 ? ZERO32 : this.hashes[seq] || null }

  member (id) { return this.members.get(typeof id === 'string' ? id : hex(id)) || null }

  // K15: bekleme defterde belirlenimcidir (saate bakılmaz): uzaktan eklenen ya da eski cihazın
  // imzası olmadan dönen ebeveyn (K16), ACTIVATE_MEMBER olayına kadar bekleyendir.
  isPending (id) {
    const m = this.members.get(typeof id === 'string' ? id : hex(id))
    return !!m && m.active && !!(m.pendingRemote || m.pendingRotation)
  }

  // Yalnız ilk kabulde (canlı eşitleme, yerel üretim) bakılan an: kabul anı + 24 sa (uzaktan) / 72 sa (K16, APP_PRIMARY)
  readyAt (id) {
    const k = typeof id === 'string' ? id : hex(id)
    const m = this.members.get(k)
    if (!m || !(this.isPending(k) || m.pendingPrimary)) return 0
    const acc = this.acceptedAt.has(k) ? this.acceptedAt.get(k) : this.now()
    if (m.pendingRotation || m.pendingPrimary) return acc + ROTATE_WAIT_MS
    return Math.max(acc + REMOTE_WAIT_MS, m.activatesAt || 0)
  }

  // K15: süresinden önce gelen ACTIVATE reddedilmez, bekletilir (sync.ingest kuyruğa alır)
  tooEarly (e) {
    if (e.type !== T.ACTIVATE_MEMBER) return false
    let body
    try { body = decodeBody(T.ACTIVATE_MEMBER, e.body) } catch { return false }
    const id = hex(body.memberId)
    return (this.isPending(id) || !!this.members.get(id)?.pendingPrimary) && this.now() < this.readyAt(id)
  }

  // §5.13: uye:<id> rotatedTo zincirinin aktif ucuna çözülür; aktif uç yoksa null.
  // RFC-0017 §5: zincirin ucu ana kimliği devredilmiş (APP_PRIMARY) bir kimlikse kişinin bugünkü ana kimliğine çözülür.
  resolveMember (id) {
    let k = typeof id === 'string' ? id : hex(id)
    for (let i = 0; i <= this.members.size; i++) {
      const m = this.members.get(k)
      if (!m) return null
      if (m.active) return k
      if (!m.rotatedTo) {
        const p = m.personOf && this.persons.get(m.personOf)
        return p && p.primary !== k && this.members.get(p.primary)?.active ? p.primary : null
      }
      k = m.rotatedTo
    }
    return null
  }

  // --- Kişi (RFC-0017) ------------------------------------------------------------------------------------------

  // Kimliğin kişisi: ek kimlikte personOf, ana kimlikte rotatedFrom zincirinin ilk kimliği (rootId, RFC-0004 §4.2).
  // Zincirin her adımında personOf'a bakılır: ana kimlik devrinden sonra telefon değişse de kişi korunur (RFC-0019 §11.8 b).
  personIdOf (id) {
    let k = typeof id === 'string' ? id : hex(id)
    if (!this.members.get(k)) return null
    for (let i = 0; i <= this.members.size; i++) {
      const m = this.members.get(k)
      if (m.personOf) return m.personOf
      if (!m.rotatedFrom || !this.members.get(m.rotatedFrom)) return k
      k = m.rotatedFrom
    }
    return k
  }

  // Kimliği kişinin bugünkü ana kimliğine çözer (izinlerde kişi esas alınır); yoksa null
  canonical (id) {
    const r = this.resolveMember(id)
    if (!r) return null
    const p = this.persons.get(this.personIdOf(r))
    return p && this.members.get(p.primary)?.active ? p.primary : null
  }

  // Kişinin aktif ek kimlikleri
  extraIdsOf (personId) {
    return [...this.members].filter(([, m]) => m.active && m.extra && m.personOf === personId).map(([id]) => id)
  }

  // Kişinin bütün aktif ve bekleyen olmayan kimlikleri (ana + ek)
  identitiesOf (personId) {
    const p = this.persons.get(personId)
    const out = p && this.members.get(p.primary)?.active && !this.isPending(p.primary) ? [p.primary] : []
    return [...out, ...this.extraIdsOf(personId)]
  }

  isExtra (id) { return !!this.members.get(typeof id === 'string' ? id : hex(id))?.extra }

  activeDeviceIds () { return [...this.devices].filter(([, d]) => d.active).map(([id]) => id) }
  activeGrantIds () { return [...this.grants].filter(([, g]) => g.active).map(([id]) => id) }
  // Misafirin koleksiyondaki bırakma izni (RFC-0030 §3): { types, subjects, seq } ya da null
  grantWriteOf (grantHex, cidHex) {
    if (!this.grants.get(grantHex)?.active) return null
    return this.grantWrites.get(grantHex + '|' + cidHex) || null
  }

  // Defterdeki herhangi bir imzacı: üye, cihaz ya da misafir (tek kimlik uzayı, §3)
  entity (id) {
    const k = typeof id === 'string' ? id : hex(id)
    return this.members.get(k) || this.devices.get(k) || this.grants.get(k) || null
  }

  // Oturum rolü (§6.1): 'uye' | 'cihaz' | 'misafir' | null
  sessionRole (id) {
    const k = typeof id === 'string' ? id : hex(id)
    const m = this.members.get(k)
    if (m) return m.active && !this.isPending(k) ? 'uye' : null
    if (this.devices.get(k)?.active) return 'cihaz'
    if (this.grants.get(k)?.active) return 'misafir'
    return null
  }

  pendingIds () { return [...this.members.keys()].filter((id) => this.isPending(id)) }

  // İptal edilen uzaktan davetli (D106 K1; Codex 10. tur): bekleyen uzaktan üyeyken REVOKE'la düşmüş kimlik, iptalden
  // sonraki 30 gün. Oturum rolü değildir (sessionRole null, gelen her zarf süzgeçte düşer); taşıyıcı onunla yalnız imzalı
  // iptali taşıyan sınırlı oturumu kurar (RFC-0003 §6.1 'davetli')
  davetliMi (id) {
    const k = typeof id === 'string' ? id : hex(id)
    const m = this.members.get(k)
    if (!m || m.active || !m.revoked || !m.pendingRemote || !Number.isSafeInteger(m.removedSeq)) return false
    const e = this.events[m.removedSeq]
    return !!e && e.type === T.REVOKE && this.now() < e.ts + DAVETLI_MS
  }

  davetliIds () { return [...this.members.keys()].filter((id) => this.davetliMi(id)) }

  // 8 kişi sınırı için: kişiler ve bekleyen yeni kişiler (uzaktan katılım; cihaz değişimi yeni kişi değildir)
  personCountWithPending () {
    const bekleyen = [...this.members].filter(([id, m]) => this.isPending(id) && m.pendingRemote && m.role !== 'kutu' && !m.extra).length
    return this.personIds().length + bekleyen
  }

  // Aktif telefon kimlikleri (kutu ve bekleyen hariç; ek kimlikler dahil): okuma ve yazma izinleri bunlarla
  phoneIds () { return [...this.members].filter(([id, m]) => m.active && m.role !== 'kutu' && !this.isPending(id)).map(([id]) => id) }
  // Kişiler (yalnız ana kimlikler): n hesabı, 8 üye sınırı, yeter sayılar bunlarla (RFC-0017 §4.3)
  personIds () { return this.phoneIds().filter((id) => !this.members.get(id).extra) }
  boxIds () { return [...this.members].filter(([, m]) => m.active && m.role === 'kutu').map(([id]) => id) }
  activeIds () { return [...this.members].filter(([id, m]) => m.active && !this.isPending(id)).map(([id]) => id) }
  parentIds () { return this.personIds().filter((id) => this.members.get(id).role === 'ebeveyn') }
  // Yetki sahipleri: ailede ebeveynler, ekipte yönetim (sahip ve yönetici; RFC-0005 §4.3)
  authorityIds () { return this.kind === 'ekip' ? authorityIdsEkip(this) : this.parentIds() }

  // Çift sırrının anchorHash'i: iki üyeden sonra katılanın ekleme olayının hash'i (docs/04 §5)
  // v2.1 (§6.2): üye ↔ cihaz ya da misafir: her zaman cihazın DEVICE_ATTACH (misafirde GRANT) özeti;
  // cihaz ↔ cihaz: addedSeq büyük olanınki.
  anchorFor (a, b) {
    const ma = this.entity(a)
    const mb = this.entity(b)
    if (!ma || !mb) throw new Error('UNKNOWN_MEMBER')
    const memA = this.members.has(hex(ma.id))
    const memB = this.members.has(hex(mb.id))
    if (memA !== memB) return memA ? mb.anchor : ma.anchor
    return ma.addedSeq > mb.addedSeq ? ma.anchor : mb.anchor
  }

  // Kabul edilen ön anahtarlar: son iki, oluşturulmasından itibaren rotate+grace (21 gün) dolmamış
  prekeysFor (memberId, now = Date.now()) {
    const m = this.member(memberId)
    if (!m || !m.active) return []
    const life = (this.policy.prekeyRotateDays + this.policy.prekeyGraceDays) * DAY_MS
    return m.prekeys.filter((p) => p.createdAt + life > now)
  }

  verifyPrekey (m, body) {
    return sodium.crypto_sign_verify_detached(body.sig, prekeyDigest(m.id, body), m.signPub)
  }

  eventsFrom (seq) { return this.events.slice(seq) }

  apply (e) {
    const { h, body, newId, q, signers } = this.check(e)
    this._mutate(e, body, h, newId, q, signers)

    this.events.push(e)
    this.hashes.push(h)
    this.head = h
    return h
  }

  // Durumu değiştirmeden tam doğrulama (imza toplarken "yeter sayı tamam mı?" sorusu için)
  check (e) {
    if (e.v !== V) throw new Error('VERSION_UNSUPPORTED')
    if (e.seq !== this.events.length) throw new Error('ORDER_ERROR')
    if (!b4a.equals(e.prev, this.head)) throw new Error('CHAIN_BROKEN')
    if (!Array.isArray(e.sigs) || e.sigs.length === 0) throw new Error('NO_SIGNATURE')
    if (this.events.length === 0 && e.type !== T.GENESIS) throw new Error('GENESIS_ERROR')

    const h = eventHash(e)
    const body = decodeBody(e.type, e.body)
    // Sürüm kapısı (RFC-0003 §2.2 madde 5); KIND muaf
    if (GATED_V21.has(e.type) && !levelAtLeast(this.level, '2.1')) throw new Error('LEVEL_TOO_LOW')
    // Ekipte GENESIS, KIND ve PROTOCOL_LEVEL dışındaki her olay 2.1 ister (RFC-0005 §4.1)
    if (this.kind === 'ekip' && !DUZEYSIZ.has(e.type) && !levelAtLeast(this.level, '2.1')) throw new Error('LEVEL_TOO_LOW')
    if (GATED_V22.has(e.type) && !levelAtLeast(this.level, '2.2')) throw new Error('LEVEL_TOO_LOW')
    if (GATED_V23.has(e.type) && !levelAtLeast(this.level, '2.3')) throw new Error('LEVEL_TOO_LOW')
    const newId = this._newMemberId(e.type, body)
    const signers = this._verifySigs(e, h, body, newId)
    const q = checkQuorum(this, e, body, signers, newId) || {}
    return { h, body, newId, signers, q }
  }

  // GENESIS / ADD_MEMBER / ROTATE_DEVICE / DEVICE_ATTACH / GRANT'ta defterde henüz olmayan imzacı
  _newMemberId (type, body) {
    const cert = newCertOf(type, body)
    if (!cert) return null
    if (!verifyDeviceCert(cert)) throw new Error('INVALID_CERTIFICATE')
    const id = hex(memberIdOf(cert.ukaPub))
    // Tek kimlik kuralı (RFC-0003 §3): üye, cihaz ya da misafirde görülmüş kimlik yeniden eklenemez
    if (this.devices.has(id) || this.grants.has(id)) throw new Error('IDENTITY_ALREADY_EXISTS')
    if (this.members.has(id)) throw new Error(type === T.DEVICE_ATTACH || type === T.GRANT || type === T.APP_ATTACH ? 'IDENTITY_ALREADY_EXISTS' : 'MEMBER_EXISTS') // atılan üye aynı anahtarla dönemez
    return id
  }

  _verifySigs (e, h, body, newId) {
    const signers = new Set()
    for (const { memberId, sig } of e.sigs) {
      const id = hex(memberId)
      if (signers.has(id)) throw new Error('DUPLICATE_SIGNATURE')
      const pub = this._signPubFor(id, e.type, body, newId)
      if (!sodium.crypto_sign_verify_detached(sig, h, pub)) throw new Error('INVALID_SIGNATURE')
      signers.add(id)
    }
    return signers
  }

  _signPubFor (id, type, body, newId) {
    if (id === newId) return newCertOf(type, body).ukaPub
    // Cihaz ve misafir oy vermez (§5.2, kurucu §6.3); cihaz yalnız kendi DEVICE_DETACH'ını imzalar
    const d = this.devices.get(id) || this.grants.get(id)
    if (d) {
      if (!d.active) throw new Error('UNKNOWN_SIGNER')
      if (type === T.DEVICE_DETACH && this.devices.has(id) && hex(body.deviceId) === id) return d.signPub
      throw new Error('DEVICE_CANNOT_VOTE')
    }
    const m = this.members.get(id)
    if (!m || !m.active) throw new Error('UNKNOWN_SIGNER')
    // Ek kimlik oy vermez; yalnız kendi PREKEY, LEAVE, APP_PRIMARY'si ve kişisel koleksiyonun COLLECTION'ı (RFC-0017 §4.3)
    if (m.extra && !extraMaySign(this, id, type, body)) throw new Error('SECONDARY_IDENTITY_CANNOT_VOTE')
    // Bekleyen imzalayamaz; tek istisna: cihaz değişiminde bekleyen ebeveynin kendi ACTIVATE'i (K16)
    if (this.isPending(id) && !(type === T.ACTIVATE_MEMBER && m.pendingRotation && hex(body.memberId) === id)) throw new Error('PENDING_MEMBER')
    // Kutu yalnız kendi LEAVE'ini (ve katılırken kendi ADD_MEMBER'ını, yukarıda) imzalar;
    // K16: ebeveyn cihaz değişiminde tanık olarak ROTATE_DEVICE'ı da imzalayabilir
    if (m.role === 'kutu' && type !== T.LEAVE && type !== T.ROTATE_DEVICE) throw new Error('BOX_CANNOT_VOTE')
    // Ekipte geçici yalnız kendi PREKEY ve LEAVE'ini imzalar (yeni üye ve yeni cihaz olarak imzası yukarıda; RFC-0005 §6.1)
    if (this.kind === 'ekip' && m.role === 'gecici' && !((type === T.PREKEY) || (type === T.LEAVE && hex(body.memberId) === id))) throw new Error('TEMPORARY_CANNOT_VOTE')
    return m.signPub
  }

  // Ana kimlik ayrılınca kişi çıkar: bütün ek kimlikler aynı olayla pasif olur, wipe hepsine uygulanır
  _dropPerson (id, seq, wipe) {
    const m = this.members.get(id)
    if (m.extra) return
    const pid = this.personIdOf(id)
    const p = this.persons.get(pid)
    if (!p || p.primary !== id) return
    for (const x of this.extraIdsOf(pid)) {
      const xm = this.members.get(x)
      xm.active = false
      xm.removedSeq = seq
      if (wipe) xm.wipe = true
    }
    this.persons.delete(pid)
  }

  // Ana kimliğin cihaz değişimi: kişi yeni kimliğe geçer; eski cihaz grubundaki ek kimlikler pasif olur, eski cihaz
  // imzalamadıysa onlara silme emri gider. Başka cihazdaki (sameDevice = false) ek kimlikler kalır (RFC-0017 §4.3).
  _rotatePerson (oldId, newId, seq, oldSigned) {
    const old = this.members.get(oldId)
    if (old.extra) return
    const pid = this.personIdOf(oldId)
    const p = this.persons.get(pid)
    if (p) p.primary = newId
    for (const x of this.extraIdsOf(pid)) {
      const xm = this.members.get(x)
      if (xm.group !== old.group) continue
      xm.active = false
      xm.removedSeq = seq
      if (!oldSigned) xm.wipe = true
    }
  }

  _devirleriDusur (primaryId) {
    const pid = this.personIdOf(primaryId)
    if (!pid || this.persons.get(pid)?.primary !== primaryId) return
    for (const x of this.extraIdsOf(pid)) {
      const xm = this.members.get(x)
      if (xm.pendingPrimary) { xm.pendingPrimary = false; xm.pendingAgainst = null }
    }
  }

  _addMember (id, cert, name, role, seq, anchor, extra = {}) {
    this.members.set(id, {
      id: b4a.from(id, 'hex'),
      name,
      role,
      signPub: cert.ukaPub,
      udaPub: cert.udaPub,
      cert,
      active: true,
      addedSeq: seq,
      anchor,
      prekeys: [],
      ...extra
    })
  }

  _mutate (e, body, h, newId, q = {}, signers = new Set()) {
    switch (e.type) {
      case T.GENESIS:
        this.founderId = newId
        this.persons.set(newId, { primary: newId })
        this.policy = { ...body.policy }
        this.familyName = body.familyName
        this.familyId = hash('family-id', encodeUnsigned(e))
        this._addMember(newId, body.founder, body.displayName, 'ebeveyn', e.seq, h, { group: newId })
        break
      case T.ADD_MEMBER:
        this._addMember(newId, body.deviceCert, body.displayName, body.role, e.seq, h, {
          inviterId: hex(body.inviterId),
          pendingRemote: body.remote,
          activatesAt: body.activatesAt,
          group: newId
        })
        if (body.role !== 'kutu') this.persons.set(newId, { primary: newId })
        if (body.remote && !this.acceptedAt.has(newId)) this.acceptedAt.set(newId, this.now())
        break
      case T.REMOVE_MEMBER: {
        const id = hex(body.memberId)
        const m = this.members.get(id)
        m.active = false
        m.removedSeq = e.seq
        m.wipe = body.wipe
        m.pendingPrimary = false // veto: bekleyen ana kimlik devri düşer (RFC-0019 §11.8 c)
        this._dropPerson(id, e.seq, body.wipe) // ana kimlik çıkınca ek kimlikler de aynı olayla (RFC-0017 §4.3)
        break
      }
      case T.LEAVE: {
        const id = hex(body.memberId)
        const m = this.members.get(id)
        m.active = false
        m.removedSeq = e.seq
        this._dropPerson(id, e.seq, false)
        break
      }
      case T.ROTATE_DEVICE: {
        const old = this.members.get(hex(body.oldMemberId))
        // Kişi bağı yeni kimliğe taşınır (RFC-0019 §11.8 b)
        const kisi = old.personOf ? { personOf: old.personOf } : {}
        // Ana kimliğin her cihaz değişimi (bekleyen dahil) kişinin bekleyen ana kimlik devirlerini düşürür; veto sayılır
        // (RFC-0020 b)
        this._devirleriDusur(hex(body.oldMemberId))
        if (q.pendingRotation) {
          // K16: eski cihaz imzası yok → yeni cihaz bekleyen ebeveyn; eski cihaz 72 sa içinde REMOVE ile iptal edebilir
          this._addMember(newId, body.newDeviceCert, old.name, old.role, e.seq, h, { rotatedFrom: hex(body.oldMemberId), pendingRotation: true, group: newId, ...kisi })
          if (!this.acceptedAt.has(newId)) this.acceptedAt.set(newId, this.now())
          break
        }
        old.active = false
        old.removedSeq = e.seq
        old.rotatedTo = newId
        this._addMember(newId, body.newDeviceCert, old.name, old.role, e.seq, h, { rotatedFrom: hex(body.oldMemberId), group: newId, ...kisi })
        this._rotatePerson(hex(body.oldMemberId), newId, e.seq, rotateOldSigned(this, body, signers))
        break
      }
      case T.ACTIVATE_MEMBER: {
        const m = this.members.get(hex(body.memberId))
        if (m.pendingPrimary) {
          promote(this, m.personOf, hex(body.memberId), e.seq) // APP_PRIMARY 72 saat sonra (RFC-0017 §7)
        } else if (m.pendingRotation) {
          const old = this.members.get(m.rotatedFrom)
          if (old && old.active) {
            old.active = false
            old.removedSeq = e.seq
            old.rotatedTo = hex(body.memberId)
            this._rotatePerson(m.rotatedFrom, hex(body.memberId), e.seq, false)
          }
          m.pendingRotation = false
        } else {
          m.pendingRemote = false
          m.remote = true
        }
        m.activatedSeq = e.seq
        break
      }
      case T.POLICY:
        this.policy = { ...body.policy }
        break
      case T.PLAN:
        this.plans.push({ product: body.product, expiresAt: body.expiresAt, seq: e.seq })
        break
      case T.PREKEY: {
        const m = this.members.get(hex(e.sigs[0].memberId))
        m.prekeys = [body, ...m.prekeys].slice(0, 2) // güncel + bir önceki
        break
      }
      case T.SET_ROLE: {
        const id = hex(body.memberId)
        // Ekipte geçici başka role geçince TERM'i silinir; yeniden geçici olursa yeni TERM gerekir (RFC-0022 f)
        if (this.kind === 'ekip' && this.members.get(id).role === 'gecici' && body.role !== 'gecici') this.terms.delete(kisiAnahtari(this, id))
        this.members.get(id).role = body.role
        for (const x of this.extraIdsOf(this.personIdOf(id))) this.members.get(x).role = body.role // ek kimlikler izler
        break
      }
      case T.LINK:
        this.links.set(hex(body.linkId), { active: true, bridge: hex(body.bridgeLocalId), otherName: body.otherName, visibility: body.visibility, intros: [] })
        break
      case T.UNLINK:
        this.links.get(hex(body.linkId)).active = false
        break
      case T.INTRO:
        this.links.get(hex(body.linkId)).intros.push({ cert: body.introducedCert, displayName: body.displayName, scope: body.scope })
        break
      case T.ASSIGN:
      case T.TERM:
      case T.NOTICE:
        mutateEkip(this, e, body)
        break
      case T.APP_ATTACH:
      case T.APP_PRIMARY:
        mutateV22(this, e, body, h, newId, q)
        break
      case T.GRANT_WRITE:
        mutateV23(this, e, body)
        break
      default:
        mutateV21(this, e, body, h, newId, signers)
    }
    if (this.grants.size) dropOrphanGrants(this, e.seq) // §5.12
    // Kaldırılan ya da düşen misafirliğin bırakma izinleri biter (RFC-0030 §3)
    if (this.grantWrites.size) for (const [id, g] of this.grants) if (!g.active) dropGrantWrites(this, id)
  }

  // Aynı olayın başka kopyasındaki imzaları ekler (K10, kural 3). K17: imzacı o seq'teki defter durumunda
  // bu olayı imzalayabilmeli (aktif, kutu değil, çocuk değil, bekleyen değil, addedSeq < seq); değilse atılır.
  // O-1 (inceleme 5): önce ucuz denetimler (defterde var mı, sonradan mı eklendi, kutu mu, imza geçerli mi);
  // yalnız bunları geçen için geçmiş durum gerekir ve o da `cursor` ile artımlı kurulur (ingest başına tek geçiş).
  mergeSigs (seq, sigs, cursor = null) {
    const e = this.events[seq]
    const h = this.hashes[seq]
    const have = new Set(e.sigs.map((x) => hex(x.memberId)))
    const cands = []
    for (const sg of sigs) {
      const id = hex(sg.memberId)
      if (have.has(id)) continue
      const m = this.members.get(id)
      if (!m || m.addedSeq >= seq || m.role === 'kutu' || m.extra) continue // ek kimlik oyu eklenmez
      if (!sodium.crypto_sign_verify_detached(sg.sig, h, m.signPub)) continue
      cands.push(sg)
      have.add(id)
    }
    if (!cands.length) return 0
    const past = (cursor || this.pastCursor()).at(seq)
    let added = 0
    for (const sg of cands) {
      const id = hex(sg.memberId)
      const m = past.members.get(id)
      // Ekipte çalışan ve geçici imzası sonradan eklenmez (RFC-0005 §6.1)
      if (!m || !m.active || ['kutu', 'cocuk', 'calisan', 'gecici'].includes(m.role) || past.isPending(id)) continue
      const trial = { ...e, sigs: [...e.sigs, { memberId: b4a.from(sg.memberId), sig: b4a.from(sg.sig) }] }
      let once, sonra
      try { once = past.check(e); sonra = past.check(trial) } catch { continue }
      // Olayın sonucunu değiştiren imza (bekleyen değişimi hemen geçerli kılmak gibi) birleştirilmez; baştan kuran cihazla
      // durum ayrışırdı. Hızlandırma ayrı ACTIVATE ile yapılır (RFC-0019 §11.8 d).
      if (etkiOf(e, once, past) !== etkiOf(trial, sonra, past)) continue
      e.sigs = trial.sigs
      added++
    }
    return added
  }

  // Bu defterin seq'ten önceki durumu; ileri doğru artımlı ilerler, geri gidilirse baştan kurulur
  pastCursor () {
    let past = null
    return {
      at: (seq) => {
        if (!past || past.len > seq) past = new Ledger({ now: this.now, acceptedAt: new Map(this.acceptedAt) })
        while (past.len < seq) past.apply(this.events[past.len])
        return past
      }
    }
  }

  // Yerinde değiştirir: çatallanma çözümünde kazanan zincire geçmek için
  replaceWith (events) {
    const next = Ledger.fromEvents(events, { now: this.now, acceptedAt: this.acceptedAt }) // önce tamamı doğrulanır; hata atarsa durum değişmez
    Object.assign(this, next)
  }
}

// İmzacı kümesine bağlı sonuçlar: yeter sayının dönüşü ve imzacıdan türetilen durum alanları
// Kip artık gövdede (RFC-0020 a); burada kalanlar: imzacıdan türetilen durum alanları ve çatallanmadaki güç (ebeveyn
// imzalı DEVICE_DETACH güçlüdür; sonradan eklenen ebeveyn imzası olayı güçlü yapamaz).
function etkiOf (e, r, past) {
  const ids = new Set(e.sigs.map((s) => hex(s.memberId)))
  let ek = ''
  if (e.type === T.ROTATE_DEVICE) ek = 'eski:' + ids.has(hex(r.body.oldMemberId))
  if (e.type === T.DEVICE_DETACH) {
    const parents = new Set(past.parentIds())
    ek = 'kendi:' + (ids.size === 1 && ids.has(hex(r.body.deviceId))) + '|ebeveyn:' + [...ids].some((id) => parents.has(id))
  }
  return JSON.stringify(r.q || {}) + ek
}

function newCertOf (type, body) {
  if (type === T.GENESIS) return body.founder
  if (type === T.ADD_MEMBER || type === T.DEVICE_ATTACH || type === T.APP_ATTACH) return body.deviceCert
  if (type === T.ROTATE_DEVICE) return body.newDeviceCert
  if (type === T.GRANT) return body.to
  return null
}

// İmzasız olay taslağı: sıradaki seq ve prev defterden
function createEvent (ledger, type, body, ts = Date.now()) {
  return { v: V, seq: ledger.len, prev: b4a.from(ledger.head), type, ts, body: encodeBody(type, body), sigs: [] }
}

// me: { memberId, signKeyPair: { secretKey } }
function signEvent (e, me) {
  const sig = b4a.alloc(sodium.crypto_sign_BYTES)
  sodium.crypto_sign_detached(sig, eventHash(e), me.signKeyPair.secretKey)
  e.sigs.push({ memberId: b4a.from(me.memberId), sig })
  return e
}

function genesisEvent (me, { familyName = '', displayName, policy = DEFAULT_POLICY, ts = Date.now() } = {}) {
  const e = createEvent(new Ledger(), T.GENESIS, { familyName, policy, founder: me.deviceCert, displayName }, ts)
  return signEvent(e, me)
}

// Ön anahtar gövdesi (K5). pub: X25519 açık anahtarı (gizli yarısı ratchet/prekey.js'te saklanır)
function prekeyBody (me, pub, createdAt) {
  const body = { prekeyId: prekeyIdOf(pub), pub, createdAt, sig: null }
  body.sig = b4a.alloc(sodium.crypto_sign_BYTES)
  sodium.crypto_sign_detached(body.sig, prekeyDigest(me.memberId, body), me.signKeyPair.secretKey)
  return body
}

module.exports = {
  Ledger,
  T,
  V,
  DAVETLI_MS,
  memberIdOf,
  prekeyIdOf,
  prekeyDigest,
  prekeyBody,
  createEvent,
  signEvent,
  genesisEvent,
  eventHash,
  encodeEvent,
  decodeEvent
}
