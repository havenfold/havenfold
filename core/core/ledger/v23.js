// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// ledger/v23.js — defter v2.3: misafirin sınırlı yazması (RFC-0030 §3, §5)
//
// Olay 36 GRANT_WRITE, bir misafire bir koleksiyona izinli türler ve özneler için mühürlü olay bırakma izni verir.
// Misafir yine hiçbir koleksiyonun writers listesine girmez (GUEST_CANNOT_WRITE); izin L.grantWrites'ta durur ve kayıt
// katmanının yetki aralığı tablosuna grant: satırı olarak girer (RFC-0001 §7.2). Aynı çiftin yeni olayı öncekinin
// yerine geçer; types boşsa izin kalkar; REVOKE ve misafirliğin düşmesi bütün izinleri bitirir.
const b4a = require('b4a')
const { T } = require('./encoding')
// v21 bu dosyayı yüklerken henüz hazır değildir (döngüsel require); çağrı anında alınır
const levelAtLeast = (have, want) => require('./v21').levelAtLeast(have, want)

const hex = (b) => b4a.toString(b, 'hex')
function fail (code) { throw new Error(code) }

const GATED_V23 = new Set([T.GRANT_WRITE])
const MAX_TYPES = 16
const MAX_SUBJECTS = 8
const MAX_COLLECTIONS_PER_GRANT = 2
// Ürün olay türü (RFC-0006 §5.1 ad biçimi); hf. türü bırakılamaz
const TYPE_RE = /^(yuva|mekan)(\.[a-z0-9][a-z0-9-]*){1,5}$/
const MAX_TYPE = 64
const SUBJECT_RE = /^(uye|varlik|yer):([0-9a-f]{32})$/

const key = (grantId, cid) => grantId + '|' + cid

// Bırakmaya izin verilebilen koleksiyon: normal, kişisel değil (RFC-0030 §3, §5)
const dropAllowed = (col) => col.sensitivity === 'normal' && col.kind !== 'kisisel' && col.kind !== 'kasa'

// RFC-0006 §4.3: defterde var olmuş üye, varlık ya da yer
function subjectOk (L, s) {
  const m = typeof s === 'string' && SUBJECT_RE.exec(s)
  if (!m) return false
  if (m[1] === 'uye') return L.members.has(m[2])
  if (m[1] === 'varlik') return L.beings.has(m[2])
  return L.places.has(m[2])
}

function checkV23 (L, e, body, signers) {
  if (e.type !== T.GRANT_WRITE) fail('UNKNOWN_EVENT')
  if (!L.parentIds().some((id) => signers.has(id))) fail('NO_PARENT_SIGNATURE')
  const gid = hex(body.grantId)
  if (!L.grants.get(gid)?.active) fail('NO_TARGET')
  const cid = hex(body.collectionId)
  const col = L.collections.get(cid)
  if (!col || !dropAllowed(col)) fail('NOT_COLLECTION_ELIGIBLE')
  if (col.dropKey.every((x) => x === 0)) fail('NO_DROP_KEY')
  const { types, subjects } = body
  if (types.length > MAX_TYPES || new Set(types).size !== types.length) fail('INVALID_BODY')
  if (!types.every((x) => b4a.byteLength(x) <= MAX_TYPE && TYPE_RE.test(x))) fail('INVALID_BODY')
  // Özne kuralı izni kaldıran olayda da (types boş) aynıdır (§3 tablosu)
  subjectsCheck(L, subjects)
  if (types.length === 0) return
  const others = [...L.grantWrites.keys()].filter((k) => k.startsWith(gid + '|') && k !== key(gid, cid))
  if (others.length >= MAX_COLLECTIONS_PER_GRANT) fail('GUEST_LIMIT')
}

function subjectsCheck (L, subjects) {
  if (subjects.length < 1 || subjects.length > MAX_SUBJECTS || new Set(subjects).size !== subjects.length) fail('INVALID_BODY')
  if (!subjects.every((s) => subjectOk(L, s))) fail('INVALID_BODY')
}

function mutateV23 (L, e, body) {
  const k = key(hex(body.grantId), hex(body.collectionId))
  if (body.types.length === 0) L.grantWrites.delete(k)
  else L.grantWrites.set(k, { types: [...body.types], subjects: [...body.subjects], seq: e.seq })
}

// Misafirin bütün izinleri (REVOKE ya da misafirliğin düşmesi)
function dropGrantWrites (L, grantId) {
  for (const k of [...L.grantWrites.keys()]) if (k.startsWith(grantId + '|')) L.grantWrites.delete(k)
}

// Tüm Aile (kurucu §7.8): bütün rollerin okuduğu normal genel koleksiyon. Birden çok varsa ilk açılanı (en küçük seq).
const TUM_AILE = ['rol:cocuk', 'rol:ebeveyn', 'rol:yetiskin']
function tumAileOf (L) {
  let best = null
  for (const col of L.collections.values()) {
    if (col.kind !== 'genel' || col.sensitivity !== 'normal' || col.readers.length !== TUM_AILE.length) continue
    if (![...col.readers].sort().every((x, i) => x === TUM_AILE[i])) continue
    if (!best || col.createdSeq < best.createdSeq) best = col
  }
  return best ? best.id : null
}

// Misafirin örtük SOS izni (RFC-0031 §4.1): düzey 2.3'te her aktif misafir Tüm Aile'ye yalnız hf.sos, yalnız kendi
// grant: öznesiyle bırakır. GRANT_WRITE'tan ayrı bir kuraldır; onunla birleşmez (tür ve özne çifti karışmasın).
const SOS_TUR = 'hf.sos'
function ortukSos (L, grantHex, cidHex) {
  if (!levelAtLeast(L.level, '2.3') || !L.grants.get(grantHex)?.active || tumAileOf(L) !== cidHex) return null
  return { types: [SOS_TUR], subjects: ['grant:' + grantHex], seq: L.grants.get(grantHex).addedSeq, ortuk: true }
}

// Misafirin bir koleksiyondaki bırakma kuralları: GRANT_WRITE (varsa) ve örtük SOS izni (varsa)
const birakmaKurallari = (L, grantHex, cidHex) => [L.grantWriteOf(grantHex, cidHex), ortukSos(L, grantHex, cidHex)].filter(Boolean)

// Bir koleksiyonda GRANT_WRITE izni olan misafirler (yalnız aktif misafirlikler). Defter kuralları (misafirli
// koleksiyon) yalnız bunu sayar; örtük SOS izni defterin geçerlilik kurallarını değiştirmez.
const grantWritersOf = (L, cid) => [...L.grantWrites.keys()].filter((k) => k.endsWith('|' + cid)).map((k) => k.slice(0, k.indexOf('|'))).filter((id) => L.grants.get(id)?.active)

// Bırakabilen misafirler: GRANT_WRITE izni olanlar ve düzey 2.3'te Tüm Aile'de bütün aktif misafirler (RFC-0031 §4.1)
function birakanlarOf (L, cid) {
  const out = new Set(grantWritersOf(L, cid))
  if (levelAtLeast(L.level, '2.3') && tumAileOf(L) === cid) for (const [id, g] of L.grants) if (g.active) out.add(id)
  return [...out]
}

module.exports = { GATED_V23, checkV23, mutateV23, dropGrantWrites, grantWritersOf, birakanlarOf, dropAllowed, tumAileOf, ortukSos, birakmaKurallari, SOS_TUR, MAX_TYPES, MAX_SUBJECTS, MAX_COLLECTIONS_PER_GRANT }
