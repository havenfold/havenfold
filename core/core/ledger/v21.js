// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// ledger/v21.js — defter v2.1: cihazlar, misafirler, yerler, varlıklar, koleksiyonlar, izinler (RFC-0003 §4–§5)
//
// Olaylar 13–23'ün kuralları ve durum değişiklikleri. Aile kuralları (quorum.js) aynen kalır; burası yalnız yeni
// türleri bilir. Defter saate bakmaz (K15): misafirin `expiresAt`'i ve 90 gün sınırı yazan tarafın kuralıdır.
const b4a = require('b4a')
const { T } = require('./encoding')
const { dropAllowed, grantWritersOf } = require('./v23')

const hex = (b) => b4a.toString(b, 'hex')
const isZero = (b) => b.every((x) => x === 0)
function fail (code) { throw new Error(code) }

// Düzeyler sırayla; düzey yalnız yükselir (§5.10). '2.2' RFC-0017, '2.3' RFC-0030 ile gelir.
const LEVELS = ['2.0', '2.1', '2.2', '2.3']
const levelAtLeast = (have, want) => LEVELS.indexOf(have) >= LEVELS.indexOf(want)

// §2.2 madde 5: KIND dışındaki bütün yeni olaylar düzey 2.1 ister
const GATED_V21 = new Set([T.DEVICE_ATTACH, T.DEVICE_DETACH, T.PLACE, T.BEING, T.GRANT, T.REVOKE, T.SHARE_CONSENT, T.COLLECTION, T.TASK_PERMIT])

const DEVICE_CLASSES = ['isci', 'uc', 'aksesuar']
const PLACE_KINDS = ['ev', 'yazlik', 'diger']
const COLLECTION_KINDS = ['genel', 'kisisel', 'bakici', 'olaylar']
const SENSITIVITIES = ['normal', 'kasa']
const COMMUNITY_KINDS = ['aile', 'ekip']
const READER_ROLES = ['ebeveyn', 'yetiskin', 'cocuk']

const MAX_DEVICES = 16
const MAX_GRANTS = 4
const MAX_PLACES = 8
const MAX_BEINGS = 32
const MAX_COLLECTIONS = 64

// Koleksiyon izin öğesi: rol:<rol>, uye:<hex16>, grant:<hex16>, device:<hex16> (§5.9)
// Ekipte rol: sahip, yonetici, calisan, gecici ve yer:<placeId hex>/rol:<rol> öznesi (RFC-0005 §8.3); aile rolleri
// ekipte, ekip rolleri ve yer: ailede geçersizdir. kind: topluluğun türü
const ID_RE = /^[0-9a-f]{32}$/
const EKIP_OKUYUCU_ROLLERI = ['sahip', 'yonetici', 'calisan', 'gecici']
const YER_RE = /^([0-9a-f]{32})\/rol:([a-z]+)$/
function parseEntry (s, toplulukTuru = 'aile') {
  const i = s.indexOf(':')
  if (i < 0) return null
  const kind = s.slice(0, i)
  const v = s.slice(i + 1)
  const roller = toplulukTuru === 'ekip' ? EKIP_OKUYUCU_ROLLERI : READER_ROLES
  if (kind === 'rol') return roller.includes(v) ? { kind, v } : null
  if (kind === 'yer') {
    const m = toplulukTuru === 'ekip' && YER_RE.exec(v)
    return m && EKIP_OKUYUCU_ROLLERI.includes(m[2]) ? { kind, v: m[1], rol: m[2] } : null
  }
  if (kind === 'uye' || kind === 'grant' || kind === 'device') return ID_RE.test(v) ? { kind, v } : null
  return null
}

// Görev türü adı (RFC-0002 §5): ad alanlı; '|' gibi ayraç içeremez
const TASK_TYPE_RE = /^(hf|yuva|mekan)\.task\.[a-z0-9][a-z0-9.-]*$/

// Koleksiyon okuyucuları arasında aktif bir ebeveyn var mı (misafirli koleksiyon kuralı, RFC-0019 §11.1 i)
function ebeveynOkuyucuVar (L, readers) {
  const parents = new Set(L.parentIds())
  return readers.some((s) => {
    if (s === 'rol:ebeveyn') return parents.size > 0
    const x = parseEntry(s)
    return !!x && x.kind === 'uye' && parents.has(L.canonical(x.v))
  })
}

// Ekipte aynı kural yönetimle (sahip ya da yönetici; RFC-0005 §14)
function yonetimOkuyucuVar (L, readers) {
  const yonetim = new Set(L.authorityIds())
  const roller = new Set(L.authorityIds().map((id) => L.members.get(id).role))
  return readers.some((s) => {
    const x = parseEntry(s, L.kind)
    if (!x) return false
    if (x.kind === 'rol') return roller.has(x.v)
    if (x.kind === 'yer') return roller.has(x.rol)
    return x.kind === 'uye' && yonetim.has(L.canonical(x.v))
  })
}

// Koleksiyonu gösteren aktif misafirlikler
const aktifMisafirlikler = (L, cid) => [...L.grants.values()].filter((g) => g.active && g.collections.includes(cid))

// TASK_PERMIT.subject: rol:<rol> ya da uye:<hex16> (§5.11). Kutu rolü de konu olabilir.
function parseSubject (s, toplulukTuru = 'aile') {
  const e = parseEntry(s, toplulukTuru)
  if (e && e.kind === 'uye') return e
  const roller = toplulukTuru === 'ekip' ? ['sahip', 'yonetici', 'calisan', 'gecici', 'kutu'] : ['ebeveyn', 'yetiskin', 'cocuk', 'kutu']
  if (s.startsWith('rol:') && roller.includes(s.slice(4))) return { kind: 'rol', v: s.slice(4) }
  return null
}

// SHARE_CONSENT'in iptal biçimi (RFC-0010 §12.1, açıklama 3 madde 1)
const iptalBicimi = (b) => b.scope === 'iptal' && b.expiresAt === 0 && isZero(b.payloadHash)
// İmzacılardan biri bugün aktif, rolü verilen rollerden biri olan kişi mi (ek kimlik kişisine çözülür)
const okuyucuImzasi = (L, signers, roller) => [...signers].some((id) => {
  const c = L.canonical(id)
  return !!c && L.personIds().includes(c) && roller.includes(L.members.get(c).role)
})

// L: olaydan önceki Ledger. signers: Set<hex> (doğrulanmış). newId: yeni cihaz ya da misafirin hex'i.
function checkV21 (L, e, body, signers, newId) {
  const parents = L.parentIds()
  const anyParent = () => parents.some((id) => signers.has(id))
  const needParent = () => { if (!anyParent()) fail('NO_PARENT_SIGNATURE') }

  switch (e.type) {
    case T.DEVICE_ATTACH: {
      if (!DEVICE_CLASSES.includes(body.class)) fail('INVALID_BODY')
      if (!signers.has(newId)) fail('NO_NEW_DEVICE_APPROVAL')
      needParent()
      if (isZero(body.ceremonyTranscriptHash)) fail('INVALID_TRANSCRIPT')
      if (L.activeDeviceIds().length >= MAX_DEVICES) fail('DEVICE_LIMIT')
      if (!isZero(body.placeId) && !L.places.get(hex(body.placeId))?.active) fail('NO_PLACE')
      return
    }

    case T.DEVICE_DETACH: {
      const id = hex(body.deviceId)
      if (!L.devices.get(id)?.active) fail('NO_TARGET')
      if (!isZero(body.wipeReportHash) && !body.wipe) fail('INVALID_BODY')
      // Cihaz yalnız kendi çıkışını imzalar; başka cihazın imzası _signPubFor'da DEVICE_CANNOT_VOTE ile düşer
      if (!signers.has(id)) needParent()
      return
    }

    case T.PLACE: {
      needParent()
      if (!PLACE_KINDS.includes(body.kind) || isZero(body.placeId)) fail('INVALID_BODY') // 16 sıfır "yok" demektir
      const p = L.places.get(hex(body.placeId))
      if (body.remove) {
        if (!p?.active) fail('NO_TARGET')
        return
      }
      if (!p?.active && countActive(L.places) >= MAX_PLACES) fail('PLACE_LIMIT')
      return
    }

    case T.BEING: {
      needParent()
      if (isZero(body.beingId)) fail('INVALID_BODY')
      const b = L.beings.get(hex(body.beingId))
      if (body.remove) {
        if (!b?.active) fail('NO_TARGET')
        return
      }
      if (!isZero(body.placeId) && !L.places.get(hex(body.placeId))?.active) fail('NO_PLACE')
      if (!b?.active && countActive(L.beings) >= MAX_BEINGS) fail('BEING_LIMIT')
      return
    }

    case T.GRANT: {
      if (!signers.has(newId)) fail('NO_NEW_DEVICE_APPROVAL')
      needParent()
      // grantedBy imzacılardan biri ve ebeveyn olmalı; misafirlik ona bağlıdır (RFC-0019 §11.3 a)
      const by = hex(body.grantedBy)
      if (!signers.has(by) || !parents.includes(by)) fail('INVALID_BODY')
      if (isZero(body.ceremonyTranscriptHash)) fail('INVALID_TRANSCRIPT')
      if (body.taskTypes.length !== 0) fail('INVALID_BODY') // misafir görev veremez (v2.1)
      if (L.activeGrantIds().length >= MAX_GRANTS) fail('GUEST_LIMIT')
      for (const cid of body.collections) {
        const col = L.collections.get(hex(cid))
        if (!col || col.kind !== 'bakici' || col.sensitivity !== 'normal') fail('NOT_COLLECTION_ELIGIBLE')
        if (!ebeveynOkuyucuVar(L, col.readers)) fail('NO_PARENT_READER')
      }
      return
    }

    case T.REVOKE: {
      needParent()
      // D106 (İstek 181 K1): uzaktan eklenmiş, etkinleşmemiş üyenin daveti; herhangi bir ebeveynin imzası yeter
      const um = L.members.get(hex(body.grantId))
      if (um) {
        if (!um.active || !um.pendingRemote || !L.isPending(hex(body.grantId))) fail('NO_TARGET')
        return
      }
      // Ebeveyni ayrıldığı için düşmüş misafirliğe de yazılabilir (kayıt ve GUEST_REVOKED için; RFC-0019 §11.3 b)
      const g = L.grants.get(hex(body.grantId))
      if (!g || !(g.active || (g.orphaned && !g.revoked))) fail('NO_TARGET')
      return
    }

    case T.SHARE_CONSENT: {
      // RFC-0010 açıklama 3 madde 1: iptal biçimini (scope 'iptal', expiresAt 0, payloadHash sıfır) Paylaşımlar'ın herhangi bir
      // okuyucusu (aktif ebeveyn ya da yetişkin) de yazabilir; başka biçim için aşağıdaki imzacı kuralı geçerlidir
      if (iptalBicimi(body) && okuyucuImzasi(L, signers, ['ebeveyn', 'yetiskin'])) return
      // Sahip üyeyse o imzalar, çocuksa bir ebeveyn; ortak veride (16 sıfır) herhangi bir ebeveyn
      if (isZero(body.ownerId)) return needParent()
      const owner = L.canonical(hex(body.ownerId))
      if (!owner || !L.personIds().includes(owner)) fail('NO_TARGET')
      if (L.members.get(owner).role === 'cocuk') return needParent()
      if (!signers.has(owner)) fail('NO_OWNER_APPROVAL')
      return
    }

    case T.KIND: {
      // Yalnız seq 1'de, tek imzacı kurucu; düzey kapısından muaf (§5.8)
      if (e.seq !== 1 || !(signers.size === 1 && signers.has(L.founderId))) fail('KIND_ERROR')
      if (!COMMUNITY_KINDS.includes(body.kind)) fail('INVALID_BODY') // 'ekip' RFC-0005 ile geçerli
      return
    }

    case T.COLLECTION:
      return checkCollection(L, body, signers)

    case T.PROTOCOL_LEVEL:
      needParent()
      return levelDenetle(L, body)

    case T.TASK_PERMIT: {
      needParent()
      return taskPermitDenetle(L, body)
    }

    default:
      fail('UNKNOWN_EVENT')
  }
}

function levelDenetle (L, body) {
  if (!LEVELS.includes(body.level)) fail('INVALID_BODY')
  if (levelAtLeast(L.level, body.level)) fail('LEVEL_CANNOT_DOWNGRADE')
}

function taskPermitDenetle (L, body) {
  const subj = parseSubject(body.subject, L.kind)
  if (!subj) fail('INVALID_BODY')
  if (body.taskTypes.length === 0 || new Set(body.taskTypes).size !== body.taskTypes.length) fail('INVALID_BODY')
  if (!body.taskTypes.every((x) => TASK_TYPE_RE.test(x))) fail('INVALID_BODY')
  // Kutu yalnız yedek işi verebilir (kurucu §8.4, RFC-0019 §11.2 e)
  const kutu = (subj.kind === 'rol' && subj.v === 'kutu') || (subj.kind === 'uye' && L.members.get(subj.v)?.role === 'kutu')
  if (kutu && body.allow && !body.taskTypes.every((x) => x === 'hf.task.backup')) fail('INVALID_BODY')
}

// Önceki okuyucuların hepsi uye: girdisi ve hiçbiri bugün ailede değil
function okuyuculariCikmis (L, prev) {
  if (!prev.readers.length) return false
  return prev.readers.every((s) => {
    const x = parseEntry(s)
    return !!x && x.kind === 'uye' && !L.canonical(x.v)
  })
}

// RFC-0005 §8.3 imza tablosu (yukarıdan aşağı, ilk uyan geçerli)
function ekipKoleksiyonImzasi (L, body, signers, prev, kasa) {
  const { S, Y } = require('./team').roller(L)
  const { alanda, yerleri } = require('./team')
  const anyS = S.some((id) => signers.has(id))
  if (kasa || prev?.sensitivity === 'kasa') {
    if (!(S.length > 0 && S.every((id) => signers.has(id)))) fail('NO_OWNER_APPROVAL')
    return
  }
  // Olaylar koleksiyonunda yalnız device: yazarları ve/veya dropKey değişiyorsa yönetici de yazabilir
  if (prev && body.kind === 'olaylar') {
    const cihazsiz = (l) => l.filter((x) => !x.startsWith('device:'))
    const ayni = body.name === prev.name && body.sensitivity === prev.sensitivity && body.taskAccess === prev.taskAccess &&
      body.history === prev.history && JSON.stringify(body.readers) === JSON.stringify(prev.readers) &&
      JSON.stringify(cihazsiz(body.writers)) === JSON.stringify(cihazsiz(prev.writers))
    if (ayni) {
      if (anyS) return
      const yerler = [...new Set(prev.readers.map((x) => parseEntry(x, 'ekip')).filter((x) => x && x.kind === 'yer').map((x) => x.v))]
      const imzaci = Y.filter((y) => signers.has(y) && alanda(L, y, yerler))
      if (!imzaci.length) fail(Y.some((y) => signers.has(y)) ? 'OUT_OF_SCOPE' : 'NO_MANAGEMENT_SIGNATURE')
      // Eklenen cihaz yazarı yöneticinin alanındaki bir yerde olmalı (RFC-0022 c)
      const eklenen = body.writers.filter((x) => x.startsWith('device:') && !prev.writers.includes(x)).map((x) => L.devices.get(x.slice(7))?.placeId)
      if (imzaci.some((y) => eklenen.every((p) => p && yerleri(L, y).includes(p)))) return
      fail('OUT_OF_SCOPE')
    }
  }
  if (!anyS) fail('NO_OWNER_SIGNATURE')
}

function countActive (map) {
  let n = 0
  for (const x of map.values()) if (x.active) n++
  return n
}

// §5.9: yapı kuralları önce (kalıcı hatalar), sonra imzalar (öneri bekleyebilir)
function checkCollection (L, body, signers) {
  const ekip = L.kind === 'ekip'
  if (!COLLECTION_KINDS.includes(body.kind) || !SENSITIVITIES.includes(body.sensitivity)) fail('INVALID_BODY')
  if (ekip && body.kind === 'kisisel') fail('NO_IN_TEAM_PERSONAL') // kişinin kişisel verisi kendi ailesindedir
  if (isZero(body.collectionId)) fail('INVALID_BODY')
  const cid = hex(body.collectionId)
  const prev = L.collections.get(cid) || null
  if (prev && prev.kind !== body.kind) fail('TYPE_IMMUTABLE')
  if (!prev && L.collections.size >= MAX_COLLECTIONS) fail('COLLECTION_LIMIT')

  const readers = body.readers.map((x) => parseEntry(x, L.kind))
  const writers = body.writers.map((x) => parseEntry(x, L.kind))
  if (readers.some((r) => !r || r.kind === 'device') || writers.some((w) => !w)) fail('INVALID_BODY')
  if (new Set(body.readers).size !== body.readers.length || new Set(body.writers).size !== body.writers.length) fail('INVALID_BODY')

  // uye:<id> rotatedTo zincirinin aktif ucuna, sonra kişiye (ana kimliğe) çözülür (§5.13, RFC-0017 §5);
  // aktif kişi olmalı, kutu olamaz
  const persons = new Set(L.personIds())
  const resolveUye = (v) => {
    const id = L.canonical(v)
    if (!id || !persons.has(id)) fail('INVALID_MEMBER')
    return id
  }
  const key = (x) => (x.kind === 'uye' ? 'uye:' + resolveUye(x.v) : x.kind === 'yer' ? 'yer:' + x.v + '/rol:' + x.rol : x.kind + ':' + x.v)
  if (ekip) for (const x of [...readers, ...writers]) if (x.kind === 'yer' && !L.places.get(x.v)?.active) fail('NO_PLACE')
  const readerKeys = new Set(readers.map(key))
  const writerKeys = writers.map(key)

  const kasa = body.sensitivity === 'kasa'
  // Bırakma izni olan misafir de misafirli sayar (RFC-0030 §3: kasa koleksiyonuna bırakılmaz)
  const misafirli = readers.some((r) => r.kind === 'grant') || aktifMisafirlikler(L, cid).length > 0 || grantWritersOf(L, cid).length > 0
  if (kasa && (body.taskAccess || writers.some((w) => w.kind === 'device') || misafirli)) fail('VAULT_RULE')
  // Ekipte kasa okuyucusu yalnız sahip ve yöneticiler (RFC-0005 §8.3)
  if (ekip && kasa && !readers.every((r) => (r.kind === 'rol' && ['sahip', 'yonetici'].includes(r.v)) || (r.kind === 'uye' && ['sahip', 'yonetici'].includes(L.members.get(resolveUye(r.v)).role)))) fail('VAULT_RULE')
  // Misafirli koleksiyonda en az bir ebeveyn okuyucudur; kapatma (readers: []) misafiri de kapsar
  if (misafirli && body.readers.length > 0 && !(ekip ? yonetimOkuyucuVar(L, body.readers) : ebeveynOkuyucuVar(L, body.readers))) fail('NO_PARENT_READER')
  if (writers.some((w) => w.kind === 'device') && body.kind !== 'olaylar') fail('DEVICE_WRITER_FORBIDDEN')
  if ([...readers, ...writers].some((x) => x.kind === 'grant') && body.kind !== 'bakici') fail('GUEST_FORBIDDEN')
  // dropKey: olaylar koleksiyonunda; düzey 2.3'ten sonra her normal, kişisel olmayan koleksiyonda (RFC-0030 §5)
  if (!isZero(body.dropKey) && body.kind !== 'olaylar' && !(levelAtLeast(L.level, '2.3') && dropAllowed(body))) fail('INVALID_BODY')
  if (writers.some((w) => w.kind === 'grant')) fail('GUEST_CANNOT_WRITE')
  writers.forEach((w, i) => { if ((w.kind === 'rol' || w.kind === 'uye' || w.kind === 'yer') && !readerKeys.has(writerKeys[i])) fail('NOT_WRITER_READER') })

  // Kişisel koleksiyonun sahibi oluşturan olaydaki tek uye: okuyucudur; hiç değişmez
  let owner = null
  if (body.kind === 'kisisel') {
    if (prev) owner = L.canonical(prev.owner)
    else {
      const uyeler = readers.filter((r) => r.kind === 'uye')
      if (uyeler.length !== 1) fail('PERSONAL_COLLECTION')
      owner = resolveUye(uyeler[0].v)
    }
    if (!owner || !readerKeys.has('uye:' + owner)) fail('PERSONAL_COLLECTION')
  }

  if (ekip) return ekipKoleksiyonImzasi(L, body, signers, prev, kasa)

  // İmza kuralları (yukarıdan aşağı, ilk uyan geçerli)
  const parents = L.parentIds()
  // Okuyucularının hepsi aileden çıkmış koleksiyonu herhangi bir ebeveyn tek imzayla kapatır (RFC-0019 §11.3 c)
  const kapatma = body.readers.length === 0 && body.writers.length === 0
  if (prev && kapatma && okuyuculariCikmis(L, prev)) {
    // Kapatmada yalnız readers ve writers değişir; ad, tür, kasa niteliği ve diğerleri aynı kalır (inceleme 3 S3)
    const ayni = body.name === prev.name && body.kind === prev.kind && body.sensitivity === prev.sensitivity &&
      body.taskAccess === prev.taskAccess && body.history === prev.history && b4a.equals(body.dropKey, prev.dropKey)
    if (!ayni) fail('INVALID_CLOSE')
    if (!parents.some((id) => signers.has(id))) fail('NO_PARENT_SIGNATURE')
    return
  }
  // Kişisel: yalnız sahibi kişi; kişinin ana ve ek kimlikleri imzalayabilir (RFC-0017 §4.3)
  if (body.kind === 'kisisel') {
    if (signers.size === 0 || ![...signers].every((id) => L.canonical(id) === owner)) fail('PERSONAL_COLLECTION')
    return
  }
  if (prev && prev.readers.length === 1) {
    const only = parseEntry(prev.readers[0])
    if (only && only.kind === 'uye') {
      const id = L.canonical(only.v)
      if (!id || !signers.has(id)) fail('NO_READER_APPROVAL')
    }
  }
  if (kasa || prev?.sensitivity === 'kasa') {
    if (!(parents.length > 0 && parents.every((id) => signers.has(id)))) fail('NO_PARENT_APPROVAL')
    return
  }
  if (!parents.some((id) => signers.has(id))) fail('NO_PARENT_SIGNATURE')
}

// Olay doğrulandıktan sonra durum değişikliği. h: olayın özeti (çapa).
function mutateV21 (L, e, body, h, newId, signers) {
  switch (e.type) {
    case T.DEVICE_ATTACH: {
      const cert = body.deviceCert
      L.devices.set(newId, {
        id: b4a.from(newId, 'hex'),
        class: body.class,
        name: body.name,
        placeId: hex(body.placeId),
        signPub: cert.ukaPub,
        udaPub: cert.udaPub,
        cert,
        caps: body.caps || b4a.alloc(0),
        active: true,
        addedSeq: e.seq,
        anchor: h
      })
      break
    }
    case T.DEVICE_DETACH: {
      const d = L.devices.get(hex(body.deviceId))
      d.active = false
      d.removedSeq = e.seq
      d.wipe = body.wipe
      d.wipeReportHash = body.wipeReportHash
      d.detachedBy = signers.has(hex(body.deviceId)) ? 'kendisi' : 'ebeveyn'
      break
    }
    case T.PLACE: {
      const id = hex(body.placeId)
      if (body.remove) {
        L.places.get(id).active = false
        // Kaldırılan yerin atamaları düşer; yeniden eklenen yer onları geri getirmez (RFC-0022 f)
        for (const a of L.assignments.values()) a.placeIds = a.placeIds.filter((p) => p !== id)
      } else L.places.set(id, { id, name: body.name, kind: body.kind, active: true })
      break
    }
    case T.BEING: {
      const id = hex(body.beingId)
      if (body.remove) L.beings.get(id).active = false
      else L.beings.set(id, { id, kind: body.kind, name: body.name, placeId: hex(body.placeId), active: true })
      break
    }
    case T.GRANT: {
      const cert = body.to
      // Misafirliğin bağlı olduğu ebeveyn gövdede yazılıdır; imza sırasına bağlı değildir (RFC-0019 §11.3 a)
      const grantedBy = hex(body.grantedBy)
      L.grants.set(newId, {
        id: b4a.from(newId, 'hex'),
        name: body.name,
        signPub: cert.ukaPub,
        udaPub: cert.udaPub,
        cert,
        collections: body.collections.map(hex),
        taskTypes: body.taskTypes,
        expiresAt: body.expiresAt,
        active: true,
        addedSeq: e.seq,
        anchor: h,
        grantedBy
      })
      break
    }
    case T.REVOKE: {
      const id = hex(body.grantId)
      const um = L.members.get(id)
      if (um) {
        // Bekleyen uzaktan üyenin daveti iptal (D106 K1, K4): üye düşer, kişisi kalkar; yerel ailesi silinir (wipe)
        um.active = false
        um.removedSeq = e.seq
        um.revoked = true
        um.wipe = true
        L.persons.delete(id)
        L.acceptedAt.delete(id)
        break
      }
      const g = L.grants.get(id)
      if (g.active) { g.active = false; g.removedSeq = e.seq }
      g.revoked = true
      break
    }
    case T.SHARE_CONSENT:
      break // yalnız onay kaydı; paket biçimi RFC-0010'da
    case T.KIND:
      L.kind = body.kind
      // Ekip: kurucu ebeveyn değil sahip olur (RFC-0005 §4.1)
      if (body.kind === 'ekip') L.members.get(L.founderId).role = 'sahip'
      break
    case T.COLLECTION: {
      const id = hex(body.collectionId)
      const prev = L.collections.get(id)
      let owner = prev ? prev.owner : null
      if (!prev && body.kind === 'kisisel') owner = L.canonical(parseEntry(body.readers.find((r) => r.startsWith('uye:'))).v)
      L.collections.set(id, {
        id,
        name: body.name,
        kind: body.kind,
        owner,
        readers: [...body.readers],
        writers: [...body.writers],
        sensitivity: body.sensitivity,
        taskAccess: body.taskAccess,
        history: body.history,
        dropKey: body.dropKey,
        seq: e.seq,
        createdSeq: prev ? prev.createdSeq : e.seq,
        hash: h
      })
      break
    }
    case T.PROTOCOL_LEVEL:
      L.level = body.level
      break
    case T.TASK_PERMIT:
      for (const type of body.taskTypes) L.permits.set(body.subject + '|' + type, { allow: body.allow, seq: e.seq })
      break
  }
}

// §5.12: GRANT'ı veren ebeveynin rotatedTo zincirinin aktif ucu kalmadıysa misafirlik aynı olayla düşer
function dropOrphanGrants (L, seq) {
  for (const g of L.grants.values()) {
    if (!g.active) continue
    // Veren hâlâ defterde ve ebeveyn olmalı: ebeveynlikten indirilenin misafirlikleri düşer (RFC-0020 e)
    const veren = L.resolveMember(g.grantedBy)
    const yetkili = L.kind === 'ekip' ? ['sahip', 'yonetici'] : ['ebeveyn']
    if (veren && yetkili.includes(L.members.get(veren)?.role)) continue
    g.active = false
    g.removedSeq = seq
    g.orphaned = true
  }
}

// TASK_PERMIT kararı (§5.11). memberHex: aktif üye. continuous: sürekli görev.
const DEFAULT_TASK = {
  ebeveyn: () => true,
  yetiskin: () => true,
  cocuk: () => false,
  kutu: (type) => type === 'hf.task.backup',
  // Ekip (RFC-0005 §13.1)
  sahip: () => true,
  yonetici: () => true,
  calisan: (type) => ['hf.task.ocr', 'hf.task.transcribe', 'hf.task.llm'].includes(type),
  gecici: () => false
}

function canTask (L, memberHex, type, { continuous = false } = {}) {
  if (L.grants.has(memberHex) || L.devices.has(memberHex)) return false // misafir (v2.1) ve cihaz görev vermez
  if (!L.members.get(memberHex)?.active || L.isPending(memberHex)) return false
  // Ek kimlik kişinin verebildiği görevleri verir (RFC-0017 §4.3): karar kişinin ana kimliğiyle. Kutu kişi değildir.
  const person = L.members.get(memberHex).role === 'kutu' ? memberHex : L.canonical(memberHex)
  if (!person) return false
  memberHex = person
  const m = L.members.get(person)
  // Sürekli görev: ailede ebeveyn, ekipte sahip ya da yönetici; TASK_PERMIT bunu değiştiremez (RFC-0005 §13.1)
  if (continuous) return L.kind === 'ekip' ? ['sahip', 'yonetici'].includes(m.role) : m.role === 'ebeveyn'
  // Ekipte geçici görev veremez; TASK_PERMIT bunu açamaz (RFC-0005 §5.1, RFC-0022 f)
  if (L.kind === 'ekip' && m.role === 'gecici') return false
  // uye: kaydı rol: kaydından önce; aynı kişiye çözülen uye: kayıtlarından en büyük seq'li geçerli
  let best = null
  for (const [k, v] of L.permits) {
    const bar = k.lastIndexOf('|')
    if (k.slice(bar + 1) !== type || !k.startsWith('uye:')) continue
    if (L.canonical(k.slice(4, bar)) !== memberHex) continue
    if (!best || v.seq > best.seq) best = v
  }
  if (best) return best.allow
  const byRole = L.permits.get('rol:' + m.role + '|' + type)
  if (byRole) return byRole.allow
  return (DEFAULT_TASK[m.role] || (() => false))(type)
}

module.exports = { iptalBicimi, okuyucuImzasi,
  LEVELS,
  levelAtLeast,
  GATED_V21,
  DEVICE_CLASSES,
  PLACE_KINDS,
  COLLECTION_KINDS,
  MAX_DEVICES,
  MAX_GRANTS,
  MAX_PLACES,
  MAX_BEINGS,
  MAX_COLLECTIONS,
  parseEntry,
  checkCollection,
  levelDenetle,
  taskPermitDenetle,
  yonetimOkuyucuVar,
  EKIP_OKUYUCU_ROLLERI,
  parseSubject,
  checkV21,
  mutateV21,
  dropOrphanGrants,
  canTask,
  ebeveynOkuyucuVar,
  TASK_TYPE_RE
}
