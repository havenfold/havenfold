// SPDX-License-Identifier: Apache-2.0
// common.js — SDK ortak alanları ve yardımcıları (RFC-0015)
//
// Ayrılmış alanların doğrulaması kayıt katmanındadır (@havenfold/records fields.js); SDK her yazmada checkStrict
// uygular. resolveMember yalnız defter olaylarından hesaplanır. Son görülme telefonun kendi gözlemidir: topluluk
// içinde dolaşan bir durum verisi oluşmaz, paylaşılan duruma yazılmaz.
const b4a = require('b4a')
const { hello: { CAPS } } = require('@havenfold/core')
const { alanlar: { RESERVED, checkStrict, parseSrc, confOf } } = require('@havenfold/records')

const hex = (b) => (typeof b === 'string' ? b : b4a.toString(b, 'hex'))
function fail (code) { throw new Error(code) }

const COMMAND = { PRESENCE_GET: 350, MEMBER_RESOLVE: 351 } // 352–359 SDK ortak işlevleri için ayrılmış
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

// --- Üye kimliği (§4) ---------------------------------------------------------------------------------------------

// rotatedTo zincirinin aktif ucu. atLedgerSeq verilirse "o anda" (seq uygulandıktan sonraki defter, RFC-0001 §3).
// Dönüş kişiyi de taşır: personId ve kişinin ana kimliği primaryId (RFC-0017; inceleme SDK 7). Üye yoksa role null.
function resolveMember (L, memberId, atLedgerSeq = null) {
  const id = hex(memberId)
  let X = L
  if (atLedgerSeq !== null && atLedgerSeq !== undefined) {
    if (!Number.isSafeInteger(atLedgerSeq) || atLedgerSeq < 0) fail('INVALID_VALUE')
    if (atLedgerSeq >= L.len) fail('LEDGER_BEHIND')
    X = L.pastCursor().at(atLedgerSeq + 1)
  }
  const m = X.members.get(id)
  // Misafir (GRANT): rol 'misafir', adı misafirliğin adı (D15 7)
  const g = !m && X.grants.get(id)
  if (g) return { activeId: g.active ? id : null, name: g.name, role: 'misafir', active: !!g.active, personId: null, primaryId: null }
  if (!m) return { activeId: null, name: '', role: null, active: false, personId: null, primaryId: null }
  const activeId = X.resolveMember(id)
  const uc = activeId ? X.members.get(activeId) : m
  const personId = activeId ? X.personIdOf(activeId) : null
  const primaryId = personId ? X.persons.get(personId)?.primary || null : null
  return { activeId, name: uc.name, role: uc.role, active: activeId !== null, personId, primaryId }
}

// Kişi (RFC-0017): kimliğin kişisi, ana kimliği ve aktif kimlikleri
function personOf (L, memberId) {
  const r = L.resolveMember(hex(memberId))
  if (!r) return null
  const personId = L.personIdOf(r)
  const primary = L.persons.get(personId)?.primary || null
  return { personId, primary, identities: L.identitiesOf(personId), extra: L.isExtra(r) }
}

// --- Son görülme (§3) ---------------------------------------------------------------------------------------------

class Presence {
  // caps: CapsBook (üyelerin son HELLO.caps değeri; HIDE_PRESENCE biti buradan okunur)
  constructor ({ ledger, me, caps, now = Date.now }) {
    if (!caps) fail('CAPS_REQUIRED') // HIDE_PRESENCE caps'ten okunur; yoksa gizli üye görünürdü (inceleme SDK 17)
    this.ledger = ledger
    this.me = hex(me)
    this.caps = caps
    this.now = now
    this.son = new Map() // memberHex → { dogrudan, emanet }
    this.acik = new Set() // açık doğrudan oturumlar
  }

  _k (id) {
    const k = hex(id)
    if (!this.son.has(k)) this.son.set(k, { dogrudan: null, emanet: null })
    return this.son.get(k)
  }

  // Aktif cihazla başarılı HELLO ya da açık oturum
  direct (memberId, at = this.now()) { this._k(memberId).dogrudan = Math.max(this._k(memberId).dogrudan || 0, at) }
  sessionOpened (memberId) { this.acik.add(hex(memberId)); this.direct(memberId) }
  sessionClosed (memberId) { this.direct(memberId); this.acik.delete(hex(memberId)) }

  // Emanet ya da Posta Kutusu yoluyla gelen geçerli mesaj: zaman mesajın hlc'si; telefonun saatinden ileriyse saat
  hold (memberId, hlcMs) {
    const t = Math.min(hlcMs, this.now())
    const s = this._k(memberId)
    s.emanet = Math.max(s.emanet || 0, t)
  }

  // Hedef kişinin bütün kimlikleri (RFC-0017 §5): ana ve ek kimlikler, cihaz değişimi zincirleri
  _hedef (memberId) {
    const L = this.ledger
    if (L.sessionRole(this.me) !== 'uye') fail('UNAUTHORIZED') // misafir kimsenin son görülmesini okuyamaz
    const id = L.resolveMember(hex(memberId))
    if (!id || L.sessionRole(id) !== 'uye') fail('UNAUTHORIZED') // yalnız aktif üyeler; misafir için çağrılamaz
    const pid = L.personIdOf(id)
    const ids = new Set(L.identitiesOf(pid))
    ids.add(id)
    // Kişinin geçmiş kimlikleri (eski telefonlar): son görülme onlardan da gelebilir
    for (const [x] of L.members) if (L.resolveMember(x) && ids.has(L.resolveMember(x))) ids.add(x)
    return [...ids]
  }

  // Üyenin son bildirdiği HELLO.caps değeri belirler; kişinin bir kimliğinde bile açıksa kişi gizlidir (RFC-0019 §11.7 a)
  _gizli (ids) {
    return ids.some((id) => {
      const s = this.caps.get(id)
      return !!s && (s.caps & CAPS.HIDE_PRESENCE) === CAPS.HIDE_PRESENCE
    })
  }

  // Kişinin bütün kimliklerinin en yeni gözlemi
  _gozlem (ids) {
    let en = null
    for (const id of ids) {
      const s = this.son.get(id)
      if (!s) continue
      for (const [via, t] of [['dogrudan', s.dogrudan], ['emanet', s.emanet]]) {
        if (t !== null && (!en || t > en.lastSeenMs)) en = { lastSeenMs: t, via }
      }
    }
    return en
  }

  presence (memberId) {
    const ids = this._hedef(memberId)
    const g = this._gozlem(ids)
    if (!g || this._gizli(ids)) return { lastSeenMs: null, via: 'yok', online: false }
    return { ...g, online: ids.some((id) => this.acik.has(id)) }
  }

  // Aile Kalkanı doğrulaması: yalnız "son 24 saatte görüldü mü"; zaman dönmez. Gözlem yoksa null. Süre sabittir;
  // başka bir süre gizli üyenin görülme anını daraltmaya yarardı (RFC-0019 §11.7 a). HIDE_PRESENCE açık üyede de çalışır.
  presenceWithin (memberId, saat = 24) {
    if (saat !== 24) fail('INVALID_VALUE')
    const g = this._gozlem(this._hedef(memberId))
    if (!g) return null
    return this.now() - g.lastSeenMs <= 24 * HOUR
  }
}

// Kaba zaman: saniye hassasiyeti yok ("az önce", "10 dakika önce", "bugün", "dün", "3 gün önce")
function coarseTime (lastSeenMs, now, { utcDk = 180 } = {}) {
  if (lastSeenMs === null || lastSeenMs === undefined) return null
  const fark = Math.max(0, now - lastSeenMs)
  if (fark < 5 * MIN) return 'az önce'
  if (fark < HOUR) return Math.floor(fark / (5 * MIN)) * 5 + ' dakika önce'
  const gun = (t) => Math.floor((t + utcDk * MIN) / DAY)
  const g = gun(now) - gun(lastSeenMs)
  if (g === 0) return fark < 3 * HOUR ? Math.floor(fark / HOUR) + ' saat önce' : 'bugün'
  if (g === 1) return 'dün'
  return g + ' gün önce'
}

// --- Alanlar (§2) ------------------------------------------------------------------------------------------------

// Yazmadan önce: tanımsız _ alanı (RESERVED_FIELD), aralık dışı _conf, biçimi bozuk _src … (INVALID_FIELD_VALUE)
const validateFields = (fields, opts) => checkStrict(fields, opts)

module.exports = { COMMAND, RESERVED, resolveMember, personOf: personOf, Presence, coarseTime: coarseTime, validateFields: validateFields, parseSrc, confOf }
