// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// protocol/guest-view.js — misafir görünümü GUEST_VIEW (0x9A) ve GUEST_REVOKED (0x9D) (RFC-0003 §7, RFC-0019 §5.3–5.4)
//
// Misafir aileden değildir: defter almaz, yalnız kendi koleksiyonlarının kişilerini, olaylarını ve dönemlerini alır.
// Görünümü yalnız misafirliği veren ebeveyn (GRANT.grantedBy'nin rotatedTo ucu) imzalar; ledgerLen yalnız artar.
// İmzacının kimliği değiştiyse görünüm successorProof zinciri taşır (RFC-0020 d): en çok 4 adım, her adım
// { event, newPub }. Misafir zinciri önceki görünümün imzacısından başlayıp doğrular. Bir adım yalnız şunlardan biri
// olabilir: (i) eski imzacının imzasını taşıyan ROTATE_DEVICE ya da APP_PRIMARY (oldSigned), (ii) önceki görünümdeki
// kutunun tanık imzasını taşıyan ROTATE_DEVICE. Başka bir ebeveynin imzası kanıt değildir; kanıt yoksa INVITE_EXPIRED.
const c = require('compact-encoding')
const b4a = require('b4a')
const sodium = require('sodium-native')
const { hash } = require('../crypto/kdf')
const { verifyDeviceCert } = require('../crypto/device-cert')
const { T, decodeBody, eventHash, encodeEvent, decodeEvent, canonical } = require('../ledger/encoding')
const { memberIdOf } = require('../ledger/ledger')
const { parseEntry, levelAtLeast } = require('../ledger/v21')
const { yerleri } = require('../ledger/team')
const { birakmaKurallari } = require('../ledger/v23')

const hex = (b) => b4a.toString(b, 'hex')
const fixed16 = c.fixed16
const isZero = (b) => b.every((x) => x === 0)
// Görünümü imzalayabilen roller: ailede ebeveyn, ekipte sahip ve yönetici (RFC-0005 §14)
const YETKILI = new Set(['ebeveyn', 'sahip', 'yonetici'])
function fail (code) { throw new Error(code) }

function struct (fields) {
  return {
    preencode (state, m) { for (const [k, enc] of fields) enc.preencode(state, m[k]) },
    encode (state, m) { for (const [k, enc] of fields) enc.encode(state, m[k]) },
    decode (state) {
      const m = {}
      for (const [k, enc] of fields) m[k] = enc.decode(state)
      return m
    }
  }
}

const peer = struct([['id', fixed16], ['signPub', c.fixed32], ['udaPub', c.fixed32], ['role', c.string], ['anchor', c.fixed32], ['writerOf', c.array(fixed16)]])
const epoch = struct([['collectionId', fixed16], ['epochSeq', c.uint], ['epochHash', c.fixed32]])
const halefAdimi = struct([['event', c.buffer], ['newPub', c.fixed32]])
const MAX_HALEF = 4
// Misafirin bırakma izni (RFC-0030 §6): koleksiyon, yürürlükteki dropKey, izinli türler ve özneler
const birakma = struct([['collectionId', fixed16], ['dropKey', c.fixed32], ['types', c.array(c.string)], ['subjects', c.array(c.string)]])
// Sondaki seçimli dizi: yoksa ya da boşsa hiç bayt yazılmaz (düzey 2.3'ten önceki görünümle bayt bayt aynı); yazılmış
// boş dizi kanonik değildir (fazladan bayt sayılır)
function sondaDizi (enc) {
  const arr = c.array(enc)
  return {
    preencode (state, v) { if (v && v.length) arr.preencode(state, v) },
    encode (state, v) { if (v && v.length) arr.encode(state, v) },
    decode (state) { return state.start < state.end ? arr.decode(state) : null }
  }
}
const unsignedView = struct([
  ['familyId', c.fixed32], ['ledgerLen', c.uint], ['ledgerHead', c.fixed32], ['grant', c.buffer],
  ['peers', c.array(peer)], ['collections', c.array(c.buffer)], ['epochs', c.array(epoch)], ['signerId', fixed16],
  ['successorProof', c.array(halefAdimi)], ['drops', sondaDizi(birakma)]
])
// GUEST_REVOKED: event REVOKE ya da misafirliği düşüren REMOVE_MEMBER / LEAVE / SET_ROLE (RFC-0020 e); sig = Ed25519(ebeveyn,
// hash('hf/guest-revoked/', familyId, grantId)) (RFC-0019 §5.4, §11.3 b)
const guestRevoked = struct([['grantId', fixed16], ['event', c.buffer], ['signerId', fixed16], ['sig', c.fixed64]])

const viewDigest = (familyId, unsignedBytes) => hash('hf/guest-view/', familyId, unsignedBytes)
const revokedDigest = (familyId, grantId) => hash('hf/guest-revoked/', familyId, grantId)

// Ebeveyn tarafı. grantHex: misafirin kimliği. me: misafirliği veren ebeveynin bugünkü kimliği.
function buildGuestView (L, grantHex, me, { epochs = [], now = null } = {}) {
  const g = L.grants.get(grantHex)
  if (!g || !g.active) fail('NO_TARGET')
  // Süresi dolan misafire yeni görünüm gitmez (defter saate bakmaz; süre burada; Codex 9. tur)
  if (typeof now === 'function' && Number.isSafeInteger(g.expiresAt) && now() >= g.expiresAt) fail('EXPIRED')
  const meHex = hex(me.memberId)
  if (L.resolveMember(g.grantedBy) !== meHex) fail('NOT_SIGNER')
  if (!L.authorityIds().includes(meHex)) fail('NOT_SIGNER') // yetkisi inen artık imzalayamaz

  const grantEvent = L.events[g.addedSeq]
  const cols = g.collections.map((cid) => L.collections.get(cid))
  const peers = new Map() // hex → peer
  const add = (id, writerOf) => {
    const e = L.entity(id)
    const p = peers.get(id) || {
      id: b4a.from(id, 'hex'),
      signPub: e.signPub,
      udaPub: e.udaPub,
      role: L.members.has(id) ? e.role : 'cihaz',
      anchor: L.anchorFor(id, grantHex),
      writerOf: []
    }
    if (writerOf && !p.writerOf.some((x) => hex(x) === writerOf)) p.writerOf.push(b4a.from(writerOf, 'hex'))
    peers.set(id, p)
  }
  const membersOf = (entries) => {
    const out = new Set()
    for (const s of entries) {
      const x = parseEntry(s, L.kind)
      if (!x) continue
      if (x.kind === 'rol') for (const id of L.phoneIds()) if (L.members.get(id).role === x.v) out.add(id)
      // uye: kişiye çözülür; kişinin bütün aktif kimlikleri (RFC-0017 §5)
      if (x.kind === 'uye') { const p = L.canonical(x.v); if (p) for (const id of L.identitiesOf(L.personIdOf(p))) out.add(id) }
      if (x.kind === 'device' && L.devices.get(x.v)?.active) out.add(x.v)
      if (x.kind === 'yer') for (const id of L.phoneIds()) if (L.members.get(id).role === x.rol && yerleri(L, id).includes(x.v)) out.add(id)
    }
    return out
  }
  for (const col of cols) {
    for (const id of membersOf(col.readers)) add(id, null)
    for (const id of membersOf(col.writers)) add(id, col.id)
  }
  add(meHex, null) // imzacı her zaman listede
  // Kutu, sonraki görünümlerdeki kutu tanıklı halef kanıtı için (RFC-0020 d)
  for (const id of L.boxIds()) add(id, null)

  const view = {
    familyId: L.familyId,
    ledgerLen: L.len,
    ledgerHead: L.head,
    grant: encodeEvent(grantEvent),
    peers: [...peers.values()],
    collections: cols.map((col) => encodeEvent(L.events[col.seq])),
    epochs,
    signerId: me.memberId,
    successorProof: halefZinciri(L, g.grantedBy, meHex),
    // Yalnız düzey 2.3'te (RFC-0030 §6)
    drops: levelAtLeast(L.level, '2.3') ? birakmaIzinleri(L, grantHex) : null
  }
  const unsigned = c.encode(unsignedView, view)
  const sig = b4a.alloc(64)
  sodium.crypto_sign_detached(sig, viewDigest(view.familyId, unsigned), me.signKeyPair.secretKey)
  return b4a.concat([unsigned, sig])
}

// Misafirin bırakma izinleri, koleksiyon kimliği sırasıyla; aynı koleksiyonda önce GRANT_WRITE, sonra örtük SOS izni
// (Tüm Aile'ye hf.sos, özne grant:<kendisi>; RFC-0031 §4.1). dropKey her zaman koleksiyonun bugünkü anahtarı; anahtar
// yoksa satır konmaz (ebeveyn telefonu misafir eklerken ya da düzeyi yazarken açar).
function birakmaIzinleri (L, grantHex) {
  const out = []
  for (const cid of [...L.collections.keys()].sort()) {
    const col = L.collections.get(cid)
    if (isZero(col.dropKey)) continue
    for (const k of birakmaKurallari(L, grantHex, cid)) out.push({ collectionId: b4a.from(cid, 'hex'), dropKey: col.dropKey, types: k.types, subjects: k.subjects })
  }
  return out
}

// Misafirliği verenden bugünkü imzacıya kimlik değişimleri (ROTATE_DEVICE ya da APP_PRIMARY olayları), en eski önce.
// Zayıf adımlar da konur; misafir hangisinin kanıt olduğuna kendisi karar verir. En çok son 4 adım.
function halefZinciri (L, fromHex, toHex) {
  const adimlar = []
  let cur = toHex
  for (let i = 0; cur !== fromHex && i < 64; i++) {
    const m = L.members.get(cur)
    let e = null
    if (m && m.rotatedFrom && L.events[m.addedSeq]?.type === T.ROTATE_DEVICE) e = L.events[m.addedSeq]
    else e = [...L.events].reverse().find((x) => x.type === T.APP_PRIMARY && hex(decodeBody(T.APP_PRIMARY, x.body).newPrimaryId) === cur) || null
    if (!e) break
    adimlar.unshift({ event: encodeEvent(e), newPub: m.signPub })
    cur = e.type === T.ROTATE_DEVICE ? hex(decodeBody(T.ROTATE_DEVICE, e.body).oldMemberId) : hex(decodeBody(T.APP_PRIMARY, e.body).against)
  }
  return adimlar.slice(-MAX_HALEF)
}

// Halef kanıtı (RFC-0020 d): önceki imzacıdan view.signerId'ye zincir. Dönüş: yeni imzacının açık anahtarı.
function halefAnahtari (prev, view) {
  const proof = view.successorProof
  if (!proof.length || proof.length > MAX_HALEF) fail('INVITE_EXPIRED')
  let cur = prev.signerHex
  let curPub = prev.peers.get(cur)?.signPub
  // Zincirin önceki imzacıdan başlayan kısmı
  let i = 0
  const eskiOf = (e) => {
    try {
      if (e.type === T.ROTATE_DEVICE) return hex(decodeBody(T.ROTATE_DEVICE, e.body).oldMemberId)
      if (e.type === T.APP_PRIMARY) return hex(decodeBody(T.APP_PRIMARY, e.body).against)
    } catch {}
    return null
  }
  const olaylar = proof.map((p) => { try { return decodeEvent(p.event) } catch { fail('INVITE_EXPIRED') } })
  while (i < olaylar.length && eskiOf(olaylar[i]) !== cur) i++
  if (i === olaylar.length || !curPub) fail('INVITE_EXPIRED')
  const kutular = [...prev.peers.values()].filter((p) => p.role === 'kutu')
  for (; i < olaylar.length; i++) {
    const e = olaylar[i]
    const newPub = proof[i].newPub
    const h = eventHash(e)
    const imzali = (pub, id) => e.sigs.some((s) => hex(s.memberId) === id && sodium.crypto_sign_verify_detached(s.sig, h, pub))
    let yeni
    let guclu = false
    if (e.type === T.ROTATE_DEVICE) {
      const b = decodeBody(T.ROTATE_DEVICE, e.body)
      if (hex(b.oldMemberId) !== cur || !verifyDeviceCert(b.newDeviceCert) || !b4a.equals(b.newDeviceCert.ukaPub, newPub)) fail('INVITE_EXPIRED')
      yeni = hex(memberIdOf(newPub))
      if (b.oldSigned === true && imzali(curPub, cur)) guclu = true
      else if (kutular.some((k) => imzali(k.signPub, hex(k.id)))) guclu = true
    } else if (e.type === T.APP_PRIMARY) {
      const b = decodeBody(T.APP_PRIMARY, e.body)
      yeni = hex(b.newPrimaryId)
      if (hex(b.against) !== cur || hex(memberIdOf(newPub)) !== yeni) fail('INVITE_EXPIRED')
      if (b.oldSigned === true && imzali(curPub, cur)) guclu = true
    } else fail('INVITE_EXPIRED')
    if (!guclu || !imzali(newPub, yeni)) fail('INVITE_EXPIRED')
    cur = yeni
    curPub = newPub
  }
  if (cur !== hex(view.signerId)) fail('INVITE_EXPIRED')
  return curPub
}

// Misafir tarafı. prev: bir önceki kabul edilen görünüm (ilkinde null). myId: misafirin kendi kimliği.
// Dönüş: kabul edilen görünüm; geçersizse hata.
function acceptGuestView (prev, bytes, myId) {
  if (bytes.byteLength < 64) fail('INVALID_VIEW')
  const unsigned = bytes.subarray(0, bytes.byteLength - 64)
  const sig = bytes.subarray(bytes.byteLength - 64)
  let view
  try { view = canonical(unsignedView, unsigned, 'INVALID_VIEW') } catch { fail('INVALID_VIEW') }

  const peers = new Map(view.peers.map((p) => [hex(p.id), p]))
  const signerHex = hex(view.signerId)
  const self = peers.get(signerHex)
  // İmzacı ebeveyn olmalı (görünümdeki rolü); önceki görünümdekinden farklıysa halef kanıtı gerekir
  if (!self || !YETKILI.has(self.role)) fail('NOT_SIGNER')
  let pub
  if (!prev) pub = self.signPub
  else if (signerHex === prev.signerHex) pub = prev.peers.get(signerHex)?.signPub || self.signPub
  else pub = halefAnahtari(prev, view)
  if (!b4a.equals(pub, self.signPub)) fail('NOT_SIGNER')
  if (!sodium.crypto_sign_verify_detached(sig, viewDigest(view.familyId, unsigned), pub)) fail('INVALID_SIGNATURE')

  // GRANT bizim kimliğimize olmalı, töreni (transkript) ve bizim imzamızı taşımalı; grantedBy (ilk görünümde imzacı) imzalamış
  let grantEvent, grant
  try {
    grantEvent = decodeEvent(view.grant)
    grant = decodeBody(T.GRANT, grantEvent.body)
  } catch { fail('INVALID_VIEW') }
  if (grantEvent.type !== T.GRANT || !b4a.equals(memberIdOf(grant.to.ukaPub), myId)) fail('INVALID_VIEW')
  if (isZero(grant.ceremonyTranscriptHash) || !verifyDeviceCert(grant.to)) fail('INVALID_VIEW')
  const grantHash = eventHash(grantEvent)
  const imzaladi = (id, p) => grantEvent.sigs.some((s) => hex(s.memberId) === id && sodium.crypto_sign_verify_detached(s.sig, grantHash, p))
  if (!imzaladi(hex(myId), grant.to.ukaPub)) fail('INVALID_VIEW') // misafirin kendi imzası
  const grantor = hex(grant.grantedBy)
  if (!prev) {
    if (grantor !== signerHex || !imzaladi(grantor, pub)) fail('NOT_SIGNER')
  }

  if (prev) {
    if (!b4a.equals(prev.familyId, view.familyId) || !b4a.equals(prev.grantHash, grantHash)) fail('INVALID_VIEW')
    if (view.ledgerLen < prev.ledgerLen) fail('VIEW_STALE')
    if (view.ledgerLen === prev.ledgerLen && !b4a.equals(view.ledgerHead, prev.ledgerHead)) fail('VIEW_STALE')
  }

  // Koleksiyonlar: misafirin bütün koleksiyonları, bir ebeveynin geçerli imzasıyla
  const collections = new Map()
  for (const buf of view.collections) {
    let e, body
    try { e = decodeEvent(buf); body = decodeBody(T.COLLECTION, e.body) } catch { fail('INVALID_VIEW') }
    if (e.type !== T.COLLECTION) fail('INVALID_VIEW')
    const h = eventHash(e)
    const ok = e.sigs.some((x) => {
      const p = peers.get(hex(x.memberId)) || (prev && prev.peers.get(hex(x.memberId)))
      return p && YETKILI.has(p.role) && sodium.crypto_sign_verify_detached(x.sig, h, p.signPub)
    })
    if (!ok) fail('INVALID_SIGNATURE')
    collections.set(hex(body.collectionId), body)
  }
  for (const cid of grant.collections) if (!collections.has(hex(cid))) fail('INVALID_VIEW')

  return {
    familyId: view.familyId,
    ledgerLen: view.ledgerLen,
    ledgerHead: view.ledgerHead,
    grantId: b4a.from(myId),
    grantHash,
    grant,
    grantDogrulandi: true,
    expiresAt: grant.expiresAt,
    peers,
    collections,
    epochs: view.epochs,
    // Bırakma izinleri (RFC-0030 §6): okunamayan koleksiyonlara yalnız mühürlü bırakma
    drops: (view.drops || []).map((d) => ({ collectionId: hex(d.collectionId), dropKey: d.dropKey, types: d.types, subjects: d.subjects })),
    signerHex
  }
}

// Misafirin çift sırları için PairBook'a verilen defter yüzü (§7: anahtarlar peers'tan, çapa anchor'dan). grants: misafirin
// kendi süresi (PairBook now verilince uygular)
function guestLedger (view) {
  const meHex = hex(view.grantId)
  return {
    grants: new Map([[meHex, { expiresAt: view.expiresAt }]]),
    familyId: view.familyId,
    head: view.ledgerHead,
    len: view.ledgerLen,
    isPending: () => false,
    sessionRole: (id) => (id === meHex ? 'misafir' : view.peers.has(id) ? (view.peers.get(id).role === 'cihaz' ? 'cihaz' : 'uye') : null),
    entity: (id) => view.peers.get(id) || null,
    anchorFor: (a, b) => {
      const other = hex(a) === meHex ? hex(b) : hex(a)
      return view.peers.get(other).anchor
    },
    activeIds: () => [...view.peers.keys()],
    activeDeviceIds: () => [],
    activeGrantIds: () => []
  }
}

// Ebeveyn tarafı: event REVOKE, ya da misafirliği veren ebeveynin REMOVE_MEMBER / LEAVE olayı
function encodeGuestRevoked (familyId, grantId, event, signer) {
  const sig = b4a.alloc(64)
  sodium.crypto_sign_detached(sig, revokedDigest(familyId, grantId), signer.signKeyPair.secretKey)
  return c.encode(guestRevoked, { grantId, event: encodeEvent(event), signerId: signer.memberId, sig })
}

// Misafir tarafı. Dönüş: { grantId, neden: 'iptal' | 'ebeveyn-ayrildi' | 'ebeveynlik-dustu', reason }
function verifyGuestRevoked (view, bytes) {
  let m, e
  try {
    m = canonical(guestRevoked, bytes, 'INVALID_VIEW')
    e = decodeEvent(m.event)
  } catch { fail('INVALID_VIEW') }
  if (!b4a.equals(m.grantId, view.grantId)) fail('INVALID_VIEW')
  const imzaci = view.peers.get(hex(m.signerId))
  if (!imzaci || !YETKILI.has(imzaci.role)) fail('NOT_SIGNER')
  if (!sodium.crypto_sign_verify_detached(m.sig, revokedDigest(view.familyId, m.grantId), imzaci.signPub)) fail('INVALID_SIGNATURE')
  const h = eventHash(e)
  const peerImzali = (yalniz = null) => e.sigs.some((x) => {
    const p = view.peers.get(hex(x.memberId))
    return p && (yalniz ? hex(x.memberId) === yalniz : YETKILI.has(p.role)) && sodium.crypto_sign_verify_detached(x.sig, h, p.signPub)
  })
  let body
  try { body = decodeBody(e.type, e.body) } catch { fail('INVALID_VIEW') }
  if (e.type === T.REVOKE) {
    if (!b4a.equals(body.grantId, view.grantId) || !peerImzali()) fail('INVALID_SIGNATURE')
    return { grantId: body.grantId, neden: 'iptal', reason: body.reason }
  }
  // Misafirliği verenin ebeveynlikten indirilmesi (RFC-0020 e)
  if (e.type === T.SET_ROLE && hex(body.memberId) === view.signerHex && !YETKILI.has(body.role)) {
    if (!peerImzali()) fail('INVALID_SIGNATURE')
    return { grantId: b4a.from(view.grantId), neden: 'ebeveynlik-dustu', reason: '' }
  }
  // Misafirliği veren ebeveynin ayrılması ya da çıkarılması (RFC-0003 §5.12)
  if ((e.type === T.LEAVE || e.type === T.REMOVE_MEMBER) && hex(body.memberId) === view.signerHex) {
    if (!(e.type === T.LEAVE ? peerImzali(view.signerHex) : peerImzali())) fail('INVALID_SIGNATURE')
    return { grantId: b4a.from(view.grantId), neden: 'ebeveyn-ayrildi', reason: e.type === T.REMOVE_MEMBER ? body.reason : '' }
  }
  fail('INVALID_VIEW')
}

// Bekleyen uzaktan üye tarafı (D106 K4; Codex 10. tur): daveti iptal eden REVOKE, sınırlı iptal oturumundan GUEST_REVOKED
// zarfıyla gelir. L: yeni gelenin törende aldığı defter (iptali görmez). Yetki zarf imzasındadır: imzalayan o defterde
// yetkili (ebeveyn; ekipte sahip ya da yönetici) ve imza bu aile ve bu kimlik içindir (revokedDigest). Olay REVOKE ve bu
// kimliğin davetini iptal ediyor olmalı; imzacısı törenden sonra katılmış olabileceği için olay imzası aranmaz (tek
// ebeveynin iptali yeter, K1). Dönüş: { grantId, reason }
function verifyInviteRevoked (L, bytes, meHex) {
  let m, e, body
  try {
    m = canonical(guestRevoked, bytes, 'INVALID_VIEW')
    e = decodeEvent(m.event)
    body = decodeBody(e.type, e.body)
  } catch { fail('INVALID_VIEW') }
  if (hex(m.grantId) !== meHex || e.type !== T.REVOKE || hex(body.grantId) !== meHex) fail('INVALID_VIEW')
  const imzaciHex = hex(m.signerId)
  const imzaci = L.members.get(imzaciHex)
  if (!imzaci || !L.authorityIds().includes(imzaciHex)) fail('NOT_SIGNER')
  if (!sodium.crypto_sign_verify_detached(m.sig, revokedDigest(L.familyId, m.grantId), imzaci.signPub)) fail('INVALID_SIGNATURE')
  return { grantId: m.grantId, reason: body.reason }
}

module.exports = { MAX_HALEF, halefZinciri, unsignedView, guestRevoked, viewDigest, revokedDigest, buildGuestView, acceptGuestView, guestLedger, encodeGuestRevoked, verifyGuestRevoked, verifyInviteRevoked }
