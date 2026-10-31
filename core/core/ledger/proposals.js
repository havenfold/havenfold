// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// worklet/ledger/proposals.js — imza toplama (LEDGER_PROPOSE, docs/05 §4)
//
// Yeter sayı eksik taslak burada bekler. İmzalar eklendikçe ledger.check() ile denenir;
// tamamlanınca deftere işlenir. 24 saatte toplanamazsa ya da defter başka yöne ilerlerse düşer.
const sodium = require('sodium-native')
const b4a = require('b4a')
const { eventHash, memberIdOf, T } = require('./ledger')
const { decodeBody, encodeEvent, decodeEvent } = require('./encoding')
const { needsMore, checkQuorum } = require('./quorum')

const PROPOSAL_TTL_MS = 86_400_000
// D106 K2: uzaktan eklemenin (ADD_MEMBER remote) öbür imzaları için süre, olayın kendi (imzalı) zamanından. Her telefon
// öneriyi kabulde, imzada ve uygulamada aynı son tarihe göre düşürür: tören QUORUM_TIMEOUT ile kapandıktan sonra
// saklanan öneri imzalanıp üye eklenemez (Codex 10. tur). Tören bu son tarihten sonra saat payı kadar daha açık kalır
// (core/transport/ceremony.js), son anda başka telefonda tamamlanan ekleme ona ulaşsın
const UZAKTAN_ONAY_MS = 600_000
// Y-1 (inceleme 7): öneri yolu yalnız yeter sayı isteyen türlere açık. ACTIVATE, PREKEY, LEAVE, PLAN gibi tek
// imzalı olaylar yalnız eşitleme yolundan gelir (orada ilk kabul bekletmesi, K15, uygulanır).
// RFC-0003 §5.14: v2.1'in yeter sayı ya da ebeveyn imzası isteyen olayları da öneri yolundan gelir
const PROPOSABLE = new Set([
  T.ADD_MEMBER, T.REMOVE_MEMBER, T.ROTATE_DEVICE, T.POLICY, T.SET_ROLE, T.LINK, T.ASSIGN, T.TERM, T.NOTICE,
  T.DEVICE_ATTACH, T.DEVICE_DETACH, T.PLACE, T.BEING, T.GRANT, T.REVOKE, T.SHARE_CONSENT, T.COLLECTION, T.PROTOCOL_LEVEL, T.TASK_PERMIT,
  T.GRANT_WRITE
])
// İnceleme 16 K1, K2: geçici, ek kimlik ve alanı dışındaki yöneticinin imzası öneriyi düşürmez; o imza atılır
const SIG_ERRORS = new Set(['INVALID_SIGNATURE', 'UNKNOWN_SIGNER', 'BOX_CANNOT_VOTE', 'PENDING_MEMBER', 'DEVICE_CANNOT_VOTE', 'TEMPORARY_CANNOT_VOTE', 'SECONDARY_IDENTITY_CANNOT_VOTE', 'OUT_OF_SCOPE'])
const OY_VEREMEZ = new Set(['BOX_CANNOT_VOTE', 'TEMPORARY_CANNOT_VOTE', 'SECONDARY_IDENTITY_CANNOT_VOTE'])
const hex = (b) => b4a.toString(b, 'hex')

// Önerinin son tarihi: uzaktan ADD_MEMBER'da ts + UZAKTAN_ONAY_MS, başka türde null (24 saat ömür yeter)
function sonTarih (event) {
  if (event.type !== T.ADD_MEMBER) return null
  try { return decodeBody(T.ADD_MEMBER, event.body).remote ? event.ts + UZAKTAN_ONAY_MS : null } catch { return null }
}

class Proposals {
  constructor (ledger) {
    this.ledger = ledger
    this.items = new Map() // proposalId → { event, createdAt }
    this.rejected = new Map() // proposalId → bu ana kadar yok sayılır (yerel ret, E-3)
  }

  // İmzalar birleştirilmeden önce doğrulanır; doğrulanamayan atılır
  // Öneri olamayan tür için null
  add (event, now = Date.now()) {
    if (!PROPOSABLE.has(event.type)) return null
    const id = hex(eventHash(event))
    if (this.rejected.has(id)) return null // reddettiğimiz öneri başkasından yeniden gelince geri dönmez
    // Önerinin ömrü olayın kendi (imzalı) zamanından: süresi dolan öneri eski imzalarla yeniden gönderilince yeni 24 saat
    // almaz (inceleme 16 şüpheli)
    if (now - event.ts > PROPOSAL_TTL_MS) return null
    if (this._doldu(event, now)) return null
    let cur = this.items.get(id)
    if (!cur) {
      cur = { event: { ...event, sigs: [] }, createdAt: Math.min(now, event.ts) }
      this.items.set(id, cur)
    }
    this._merge(cur.event, event.sigs.filter((sg) => this._valid(cur.event, sg)))
    return id
  }

  // İmzacının açık anahtarı: defterdeki aktif üye ya da olayın yeni üyesinin sertifikası
  _valid (event, sg) {
    const sid = hex(sg.memberId)
    // Çıkarılan üyenin imzası öneriyi düşürürdü (TARGET_CANNOT_SELF_VOTE → stale): kayıp telefon kendi çıkarılmasını
    // böyle engelleyemesin diye hiç alınmaz
    if (sid === this.removeTarget(event)) return false
    // İnceleme 16: Aile Kutusu yalnız LEAVE ve ROTATE_DEVICE (tanık) imzalar (ledger _signPubFor); başka öneride imzası
    // BOX_CANNOT_VOTE ile öneriyi düşürürdü
    if (this.ledger.member(sid)?.role === 'kutu' && event.type !== T.ROTATE_DEVICE) return false
    // İnceleme 16 K1: geçici ve ek kimlik de (defterin imza kuralı, ledger _signPubFor) kutu gibi elenir
    if (this.ledger.member(sid)?.active) {
      try { this.ledger._signPubFor(sid, event.type, decodeBody(event.type, event.body), null) } catch (err) { if (OY_VEREMEZ.has(err.message)) return false }
    }
    let pub = this.ledger.member(sid)?.active ? this.ledger.member(sid).signPub : null
    if (!pub) {
      // Yeni üye, cihaz ya da misafirin kendi imzası; cihazın kendi çıkışı. Cihaz ve misafir imzaları olayın ilk
      // halinde bulunur (§5.14); başka bir öneride atılır.
      try {
        const body = decodeBody(event.type, event.body)
        const cert = event.type === T.ADD_MEMBER || event.type === T.DEVICE_ATTACH
          ? body.deviceCert
          : event.type === T.ROTATE_DEVICE ? body.newDeviceCert : event.type === T.GRANT ? body.to : null
        if (cert && hex(memberIdOf(cert.ukaPub)) === sid) pub = cert.ukaPub
        const d = this.ledger.devices.get(sid)
        if (event.type === T.DEVICE_DETACH && d?.active && hex(body.deviceId) === sid) pub = d.signPub
      } catch {}
    }
    return !!pub && sodium.crypto_sign_verify_detached(sg.sig, eventHash(event), pub)
  }

  get (id) { return this.items.get(id)?.event || null }

  _simdi () { return typeof this.ledger.now === 'function' ? this.ledger.now() : Date.now() }

  _doldu (event, now) {
    const s = sonTarih(event)
    return s !== null && now > s
  }

  // Kendi imzamızı ekler (LEDGER_SIGN)
  sign (id, me) {
    const it = this.items.get(id)
    if (!it) throw new Error('NO_PROPOSAL')
    if (this._doldu(it.event, this._simdi())) { this.items.delete(id); throw new Error('PROPOSAL_EXPIRED') }
    const sig = b4a.alloc(sodium.crypto_sign_BYTES)
    sodium.crypto_sign_detached(sig, eventHash(it.event), me.signKeyPair.secretKey)
    this._merge(it.event, [{ memberId: me.memberId, sig }])
    return { memberId: me.memberId, sig }
  }

  _merge (event, sigs) {
    const have = new Set(event.sigs.map((s) => hex(s.memberId)))
    for (const s of sigs) if (!have.has(hex(s.memberId))) { event.sigs.push(s); have.add(hex(s.memberId)) }
  }

  // Deftere işlenebiliyorsa işler. Dönüş: 'applied' | 'waiting' | 'stale' (düştü)
  tryApply (id) {
    const it = this.items.get(id)
    if (!it) return 'stale'
    if (this._doldu(it.event, this._simdi())) { this.items.delete(id); return 'stale' }
    // Süresinden önce gelen olay ve (veto dışında) bekletme sırasında yerel olay uygulanmaz (Y-1, D-a)
    if (this.ledger.tooEarly(it.event)) return 'waiting'
    if (this.ledger.deferred && it.event.type !== T.REMOVE_MEMBER) return 'waiting'
    try {
      this.ledger.check(it.event)
    } catch (err) {
      if (needsMore(this.ledger, err.message)) return 'waiting'
      if (SIG_ERRORS.has(err.message)) {
        // Yalnız artık geçersiz olan imzaları (atılan, bekleyen imzacı, alanı dışındaki yönetici) at, yeniden dene
        const before = it.event.sigs.length
        const disari = err.message === 'OUT_OF_SCOPE' ? this._alanDisi(it.event) : new Set()
        it.event.sigs = it.event.sigs.filter((sg) => this._valid(it.event, sg) && !this.ledger.isPending(hex(sg.memberId)) && !disari.has(hex(sg.memberId)))
        if (it.event.sigs.length < before) return this.tryApply(id)
      }
      this.items.delete(id) // zincir ilerledi ya da geçersiz: imzacılar yeniden imzalar
      return 'stale'
    }
    this.ledger.apply(it.event)
    this.items.delete(id)
    return 'applied'
  }

  // Ekip (inceleme 16 K2): imzası olayı OUT_OF_SCOPE yapan yönetici. Her yönetici, yönetici olmayan imzacılarla
  // birlikte tek başına denenir (yeter sayı işlevi, imza yeniden doğrulanmaz). Dönüş: kimlik kümesi
  _yetkiDenemesi (event, ids) {
    const L = this.ledger
    try {
      const body = decodeBody(event.type, event.body)
      let newId = null
      try { newId = L._newMemberId(event.type, body) } catch {}
      checkQuorum(L, event, body, new Set(ids), newId)
      return null
    } catch (err) { return err.message }
  }

  _alanDisi (event, adaylar = null) {
    const L = this.ledger
    const imzali = event.sigs.map((s) => hex(s.memberId))
    const yonetici = (id) => L.members.get(id)?.role === 'yonetici'
    const taban = imzali.filter((id) => !yonetici(id))
    const out = new Set()
    for (const y of adaylar || imzali.filter(yonetici)) if (this._yetkiDenemesi(event, [...taban, y]) === 'OUT_OF_SCOPE') out.add(y)
    return out
  }

  // Henüz imzalamamış ebeveyn ve oy veren üyeler (arayüz "onay bekleniyor" listesi). Çıkarılan üye kendi
  // çıkarılmasına oy veremez (quorum TARGET_CANNOT_SELF_VOTE); listede yer almaz.
  waitingFor (id) {
    const it = this.items.get(id)
    if (!it) return []
    const signed = new Set(it.event.sigs.map((s) => hex(s.memberId)))
    const target = this.removeTarget(it.event)
    // Oy verenler kişilerdir; ek kimlik oy vermez (RFC-0017 §4.3). Ekipte yalnız yönetim oy verir (RFC-0005 §6.1)
    const L = this.ledger
    if (L.kind !== 'ekip') return L.personIds().filter((m) => !signed.has(m) && m !== target && L.members.get(m).role !== 'cocuk')
    // Ekipte yalnız yönetim oy verir; alanı dışındaki yönetici beklenmez (inceleme 16 K2). Yeni üye (ADD_MEMBER) ve sahip
    // yapılan hedef (SET_ROLE → sahip) de imzalar
    const yon = (r) => r === 'sahip' || r === 'yonetici'
    const adaylar = L.personIds().filter((m) => !signed.has(m) && m !== target && yon(L.members.get(m).role))
    const disari = this._alanDisi(it.event, adaylar.filter((m) => L.members.get(m).role === 'yonetici'))
    const out = adaylar.filter((m) => !disari.has(m))
    try {
      const body = decodeBody(it.event.type, it.event.body)
      let ek = null
      if (it.event.type === T.ADD_MEMBER) ek = hex(memberIdOf(body.deviceCert.ukaPub))
      if (it.event.type === T.SET_ROLE && body.role === 'sahip') ek = hex(body.memberId)
      if (ek && !signed.has(ek) && !out.includes(ek)) out.push(ek)
    } catch {}
    return out
  }

  removeTarget (event) {
    if (event.type !== T.REMOVE_MEMBER) return null
    try { return hex(decodeBody(T.REMOVE_MEMBER, event.body).memberId) } catch { return null }
  }

  // Yerel ret (E-3): öneri silinir, süresi boyunca yeniden kabul edilmez. Protokolde ret iletisi yok; öneren taraf
  // yeter sayıya ulaşamaz ve öneri 24 saatte düşer.
  reject (id, now = Date.now()) {
    const it = this.items.get(id)
    if (!it) throw new Error('NO_PROPOSAL')
    this.items.delete(id)
    this.rejected.set(id, it.createdAt + PROPOSAL_TTL_MS)
    return null
  }

  expire (now = Date.now()) {
    let n = 0
    for (const [id, it] of this.items) if (now - it.createdAt > PROPOSAL_TTL_MS || this._doldu(it.event, now)) { this.items.delete(id); n++ }
    for (const [id, until] of this.rejected) if (now > until) { this.rejected.delete(id); n++ }
    return n
  }

  // Yeniden açılışta öneriler kaybolmasın (E-3): imzalar her yüklemede yeniden doğrulanır
  toJSON () {
    return {
      items: [...this.items.values()].map((it) => ({ e: hex(encodeEvent(it.event)), at: it.createdAt })),
      rejected: Object.fromEntries(this.rejected)
    }
  }

  // Kasa kaydı bozuk ya da eski biçimdeyse (P17 fuzz) açılış düşmez: geçersiz parça atlanır
  load (saved) {
    if (!saved || typeof saved !== 'object') return
    const rej = saved.rejected
    if (rej && typeof rej === 'object' && !Array.isArray(rej)) {
      for (const [id, until] of Object.entries(rej)) if (/^[0-9a-f]{64}$/.test(id) && Number.isSafeInteger(until)) this.rejected.set(id, until)
    }
    if (!Array.isArray(saved.items)) return
    for (const r of saved.items) {
      if (!r || typeof r !== 'object' || typeof r.e !== 'string' || !Number.isSafeInteger(r.at)) continue
      try { this.add(decodeEvent(b4a.from(r.e, 'hex')), r.at) } catch {}
    }
  }
}

module.exports = { Proposals, PROPOSAL_TTL_MS, UZAKTAN_ONAY_MS, PROPOSABLE, sonTarih }
