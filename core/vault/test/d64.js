// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D64: test kapsamı — yedek dizininin ve kasa zarfının biçim retleri. Mühürlü dizin ve zarf gövdesi elle kurulur
// (imza ve AEAD gerçek anahtarlarla; yalnız test verisi), böylece retler imza ve şifre denetiminden sonra sınanır.
const test = require('brittle')
const b4a = require('b4a')
const c = require('compact-encoding')
const sodium = require('sodium-native')
const { ledger: { Ledger } } = require('@havenfold/core')
const Y = require('../backup')
const Zf = require('../envelope')
const V = require('../../core/test/helpers/v21')
const { kasaDonemleri } = require('./helpers/input')

const { K, anaAdimlar, K_KASA } = V
const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
function ana () { const L = new Ledger(); for (const f of anaAdimlar(L)) L.apply(f()); return L }
const oku = { okuyucuMu: () => true }
const NPUB = sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES
const ABYTES = sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES

const ya = b4a.alloc(32, 1)
const sid = b4a.alloc(16, 2)
const dizin = (version, seq) => ({ memberRootId: b4a.alloc(16), version, seq, blocks: [] })

test('yedek: mühürlü kısım boş ya da kısaysa INVALID_INDEX', (t) => {
  t.is(hataOf(() => Y.dizinAc(ya, c.encode(Y.muhurluDizin, { secretId: sid, version: 1, seq: 1, sealed: b4a.alloc(0) }))), 'INVALID_INDEX', 'mühür boş')
  t.is(hataOf(() => Y.dizinAc(ya, c.encode(Y.muhurluDizin, { secretId: sid, version: 1, seq: 1, sealed: b4a.alloc(NPUB + ABYTES - 1) }))), 'INVALID_INDEX', 'mühür kısa')
  t.is(Y.dizinAc(ya, Y.dizinMuhurle(ya, sid, dizin(1, 1))).seq, 1, 'geçerli dizin açılır')
})

test('yedek: açık sürüm ve seq ile mühürdeki dizin farklıysa INVALID_INDEX', (t) => {
  // AD açık alanlarla (version 1, seq 3) kurulur, mühürlü dizin başka sürüm ve seq taşır: şifre doğrulanır, dizin reddedilir
  const nonce = b4a.alloc(NPUB, 9)
  for (const [v, s] of [[2, 3], [1, 4]]) {
    const pt = c.encode(Y.backupIndex, dizin(v, s))
    const ct = b4a.alloc(pt.byteLength + ABYTES)
    sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(ct, pt, Y.adOf(sid, 1, 3), null, nonce, ya)
    const bytes = c.encode(Y.muhurluDizin, { secretId: sid, version: 1, seq: 3, sealed: b4a.concat([nonce, ct]) })
    t.is(hataOf(() => Y.dizinAc(ya, bytes)), 'INVALID_INDEX', 'mühürde version ' + v + ', seq ' + s)
  }
})

// İmzalı zarf gövdesi; ct verilmezse ic AD ile şifrelenir
function imzaliZarf (L, kra, m, ic = null) {
  const govde = { collectionId: K_KASA, version: 1, envSeq: 1, nonce: b4a.alloc(24, 4), writerId: K.kerem.memberId, ...m }
  if (ic) {
    const pt = c.encode(Zf.zarfIci, ic)
    govde.ct = b4a.alloc(pt.byteLength + ABYTES)
    sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(govde.ct, pt, Zf.adOf(govde), null, govde.nonce, kra)
  }
  const body = c.encode(Zf.zarfBody, govde)
  const sig = b4a.alloc(64)
  sodium.crypto_sign_detached(sig, Zf.digestOf(L.familyId, body), K.kerem.signKeyPair.secretKey)
  return b4a.concat([body, sig])
}

test('zarf: imzadan kısa bayt ve imzalı ama boş ya da kısa ct INVALID_ENVELOPE', (t) => {
  const L = ana()
  const kra = b4a.alloc(32, 3)
  const ep = kasaDonemleri(L)[0]
  t.is(hataOf(() => Zf.zarfAc(L, kra, b4a.alloc(63), oku)), 'INVALID_ENVELOPE', '64 bayttan kısa')
  t.is(hataOf(() => Zf.zarfAc(L, kra, imzaliZarf(L, kra, { lastEpochSeq: ep.seq, ct: b4a.alloc(0) }), oku)), 'INVALID_ENVELOPE', 'ct boş')
  t.is(hataOf(() => Zf.zarfAc(L, kra, imzaliZarf(L, kra, { lastEpochSeq: ep.seq, ct: b4a.alloc(ABYTES - 1) }), oku)), 'INVALID_ENVELOPE', 'ct ABYTES\'tan kısa')
})

test('zarf: açık lastEpochSeq şifreli dönemlerin en büyüğüyle aynı değilse INVALID_ENVELOPE', (t) => {
  const L = ana()
  const kra = b4a.alloc(32, 3)
  const ep = kasaDonemleri(L)[0]
  const ic = { epochs: [{ epochSeq: ep.seq, epochHash: ep.hash, keys: [] }], dropSecrets: [] }
  t.is(hataOf(() => Zf.zarfAc(L, kra, imzaliZarf(L, kra, { lastEpochSeq: ep.seq + 1 }, ic), oku)), 'INVALID_ENVELOPE', 'lastEpochSeq büyük')
  t.is(Zf.zarfAc(L, kra, imzaliZarf(L, kra, { lastEpochSeq: ep.seq }, ic), oku).lastEpochSeq, ep.seq, 'aynıysa açılır')
})

test('zarf: defterde olan ama kasa koleksiyonunun dönemi olmayan kayıt INVALID_ENVELOPE', (t) => {
  const L = ana()
  const kra = b4a.alloc(32, 3)
  const donemler = kasaDonemleri(L).map((e) => e.seq)
  t.absent(donemler.includes(0), 'defterin ilk kaydı kasa dönemi değil')
  const ic = { epochs: [{ epochSeq: 0, epochHash: L.hashAt(0), keys: [] }], dropSecrets: [] }
  const z = Zf.zarfYaz(L.familyId, kra, { collectionId: K_KASA, version: 1, envSeq: 2, ic }, K.kerem)
  t.is(hataOf(() => Zf.zarfAc(L, kra, z, oku)), 'INVALID_ENVELOPE')
})
