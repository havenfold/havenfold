// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Test ve vektör yardımcısı: belirlenimci kimlikler ve olay kurucu.
const b4a = require('b4a')
const { createIdentity } = require('../../core/identity')
const { Ledger, T, createEvent, signEvent, genesisEvent, prekeyBody } = require('../../ledger/ledger')
const { levelAtLeast } = require('../../ledger/v21')
const { DEFAULT_POLICY } = require('../../ledger/policy')

const TS0 = 1_790_000_000_000 // sabit zaman (vektörler belirlenimci olsun)
const ZERO32 = b4a.alloc(32)
const ZERO16 = b4a.alloc(16)

const GORUNEN = { kerem: 'Kerem', husniye: 'Hüsniye', irem: 'İrem', ecem: 'Ecem' }
const kimlik = (ad) => Object.assign(createIdentity({ seed: 'defter-vektor/' + ad, platform: 'test' }), { ad: GORUNEN[ad] || ad })

// Dört kurgu test kimliği + yedekler. Adlar Yuva Hat'tan gelen donmuş vektör baytlarında durur (core/core/KAYNAK.md);
// aşağıdaki roller (ebeveyn, yetişkin, çocuk) yalnız protokol testinin rolleridir, kimseyi anlatmaz.
const K = {}
for (const ad of ['kerem', 'husniye', 'irem', 'ecem', 'kutu', 'kutu2', 'u5', 'u6', 'u7', 'u8', 'u9', 'yeniKerem']) K[ad] = kimlik(ad)

// type, body, imzacılar (kimlik dizisi), ts
// Kolaylık: verilmeyen kip bayrakları (RFC-0020 a, b) imzacılardan ve defterden doldurulur; vektörler bu alanları
// baytlarında açıkça taşır. MODE_MISMATCH testleri bayrağı açıkça verir.
function olay (ledger, type, body, imzacilar, ts = TS0 + ledger.len * 1000) {
  const imzali = (id) => imzacilar.some((k) => b4a.equals(k.memberId, id))
  if (type === T.ROTATE_DEVICE && body.oldSigned === undefined && levelAtLeast(ledger.level, '2.1')) body = { ...body, oldSigned: imzali(body.oldMemberId) }
  if (type === T.APP_PRIMARY) {
    const primary = ledger.persons.get(b4a.toString(body.personId, 'hex'))?.primary
    const against = body.against || (primary ? b4a.from(primary, 'hex') : b4a.alloc(16))
    const parentSigned = body.parentSigned ?? ledger.parentIds().some((id) => id !== primary && imzali(b4a.from(id, 'hex')))
    body = { ...body, against, oldSigned: body.oldSigned ?? imzali(against), parentSigned }
  }
  const e = createEvent(ledger, type, body, ts)
  for (const k of imzacilar) signEvent(e, k)
  return e
}

const ekle = (ledger, yeni, rol, imzacilar, ek = {}) => olay(ledger, T.ADD_MEMBER, {
  deviceCert: yeni.deviceCert,
  displayName: yeni.ad,
  role: rol,
  inviterId: (imzacilar[0] || yeni).memberId,
  ceremonyTranscriptHash: b4a.alloc(32, 7),
  remote: false,
  activatesAt: 0,
  ...ek
}, [...imzacilar, yeni])

const at = (ledger, hedef, imzacilar) => olay(ledger, T.REMOVE_MEMBER, { memberId: hedef.memberId, reason: 'test', wipe: true }, imzacilar)

const prekey = (ledger, sahip, createdAt, tohum = 1) => {
  const pub = b4a.alloc(32, tohum) // defter yalnız imzaya bakar; X25519 geçerliliği ratchet'te
  return olay(ledger, T.PREKEY, prekeyBody(sahip, pub, createdAt), [sahip])
}

function genesis () {
  return genesisEvent(K.kerem, { familyName: 'Eser', displayName: 'Kerem', policy: DEFAULT_POLICY, ts: TS0 })
}

// İki ebeveyn, bir yetişkin, bir çocuk ve kutu (test rolleri)
function tamAile () {
  const L = new Ledger()
  L.apply(genesis())
  L.apply(ekle(L, K.husniye, 'ebeveyn', [K.kerem]))
  L.apply(ekle(L, K.irem, 'yetiskin', [K.kerem, K.husniye]))
  L.apply(ekle(L, K.ecem, 'cocuk', [K.kerem, K.husniye]))
  L.apply(ekle(L, K.kutu, 'kutu', [K.husniye]))
  L.apply(prekey(L, K.kerem, TS0 + 10_000))
  return L
}

module.exports = { K, T, TS0, ZERO16, ZERO32, olay, ekle, at, prekey, genesis, tamAile }
