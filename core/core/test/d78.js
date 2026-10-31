// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D78: misafirin sınırlı yazması, defter tarafı (RFC-0030 §3, §5, §8): olay 36 GRANT_WRITE, düzey 2.3, MISAFIR_YAZAR
// yetenek biti ve genişleyen dropKey kuralı.
const test = require('brittle')
const b4a = require('b4a')
const { Ledger, T } = require('../ledger/ledger')
const { CAPS } = require('../protocol/hello')
const { CapsBook, LEVEL_BIT } = require('../protocol/caps')
const { checkJoinCaps } = require('../protocol/join-hello')
const { C, K, hex, olay, anaAdimlar, koleksiyon, misafirEkle, misafirKaldir, K_TUM_AILE, K_KISISEL_IREM, K_KASA, K_OLAYLAR, VARLIK_KEDI, id16 } = require('./helpers/v21')

const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const COKI = 'varlik:' + hex(VARLIK_KEDI)
const TURLER = ['yuva.pet.beslenme', 'yuva.pet.su']

function aile (duzey = '2.3') {
  const L = new Ledger()
  for (const f of anaAdimlar(L)) L.apply(f())
  L.apply(olay(L, T.PROTOCOL_LEVEL, { level: '2.2' }, [K.kerem]))
  if (duzey === '2.3') L.apply(olay(L, T.PROTOCOL_LEVEL, { level: '2.3' }, [K.kerem]))
  L.apply(misafirEkle(L, C.misafir2, [K.kerem]))
  return L
}
const tumAileAnahtarli = (L, imz = [K.kerem]) => koleksiyon(L, imz, { dropKey: b4a.alloc(32, 0x5a) })
const izin = (L, x = {}, imz = [K.husniye]) => olay(L, T.GRANT_WRITE, { grantId: C.misafir2.memberId, collectionId: K_TUM_AILE, types: TURLER, subjects: [COKI], ...x }, imz)

test('D78: düzey 2.3 ve MISAFIR_YAZAR biti', (t) => {
  t.is(CAPS.MISAFIR_YAZAR, 16384)
  t.is(LEVEL_BIT['2.3'], CAPS.MISAFIR_YAZAR | CAPS.COKLU_UYGULAMA | CAPS.LEDGER_V21, 'alt düzeylerin bitleri de')
  const L = aile()
  t.is(L.level, '2.3')
  t.is(hataOf(() => checkJoinCaps(L, CAPS.LEDGER_V21 | CAPS.COKLU_UYGULAMA)), 'UPDATE_REQUIRED')
  t.is(hataOf(() => checkJoinCaps(L, CAPS.LEDGER_V21 | CAPS.COKLU_UYGULAMA | CAPS.MISAFIR_YAZAR)), null)
  const book = new CapsBook()
  for (const id of L.activeIds()) book.record(id, LEVEL_BIT['2.3'], 0)
  t.ok(book.levelReady(L, '2.3', { now: 1 }).ok)
})

test('D78: olay 36 düzey 2.3 ister; dropKey genel koleksiyonda yalnız 2.3\'te', (t) => {
  const L = aile('2.2')
  t.is(hataOf(() => L.check(tumAileAnahtarli(L))), 'INVALID_BODY', '2.2\'de dropKey yalnız olaylar koleksiyonunda')
  t.is(hataOf(() => L.check(izin(L))), 'LEVEL_TOO_LOW')
  const M = aile()
  t.ok(M.check(tumAileAnahtarli(M)), '2.3\'te normal genel koleksiyonda dropKey')
  t.is(hataOf(() => M.check(koleksiyon(M, [K.irem], { collectionId: K_KISISEL_IREM, name: 'Kişisel', kind: 'kisisel', readers: ['uye:' + hex(K.irem.memberId)], writers: ['uye:' + hex(K.irem.memberId)], taskAccess: false, dropKey: b4a.alloc(32, 1) }))), 'INVALID_BODY', 'kişiselde yok')
  t.is(hataOf(() => M.check(koleksiyon(M, [K.kerem, K.husniye], { collectionId: K_KASA, name: 'Kasa', readers: ['rol:ebeveyn'], writers: ['rol:ebeveyn'], sensitivity: 'kasa', taskAccess: false, dropKey: b4a.alloc(32, 1) }))), 'INVALID_BODY', 'kasada yok')
})

test('D78: GRANT_WRITE kuralları (§3, §16)', (t) => {
  const L = aile()
  t.is(hataOf(() => L.check(izin(L))), 'NO_DROP_KEY')
  L.apply(tumAileAnahtarli(L))
  t.is(hataOf(() => L.check(izin(L, {}, [K.irem]))), 'NO_PARENT_SIGNATURE')
  t.is(hataOf(() => L.check(izin(L, { grantId: C.misafir1.memberId }))), 'NO_TARGET', 'kaldırılmış misafir')
  t.is(hataOf(() => L.check(izin(L, { grantId: K.irem.memberId }))), 'NO_TARGET', 'üye misafir değil')
  t.is(hataOf(() => L.check(izin(L, { collectionId: K_KASA }))), 'NOT_COLLECTION_ELIGIBLE')
  t.is(hataOf(() => L.check(izin(L, { collectionId: K_KISISEL_IREM }))), 'NOT_COLLECTION_ELIGIBLE')
  t.is(hataOf(() => L.check(izin(L, { collectionId: id16(0x77) }))), 'NOT_COLLECTION_ELIGIBLE', 'olmayan koleksiyon')
  t.is(hataOf(() => L.check(izin(L, { types: ['hf.vaka.sahip'] }))), 'INVALID_BODY')
  t.is(hataOf(() => L.check(izin(L, { types: ['pet.beslenme'] }))), 'INVALID_BODY', 'ad alanı yok')
  t.is(hataOf(() => L.check(izin(L, { types: Array.from({ length: 17 }, (_, i) => 'yuva.pet.t' + i) }))), 'INVALID_BODY', '16\'dan çok tür')
  t.is(hataOf(() => L.check(izin(L, { types: ['yuva.pet.su', 'yuva.pet.su'] }))), 'INVALID_BODY', 'yinelenen tür')
  t.is(hataOf(() => L.check(izin(L, { subjects: [] }))), 'INVALID_BODY', 'öznesiz')
  t.is(hataOf(() => L.check(izin(L, { subjects: ['topluluk'] }))), 'INVALID_BODY')
  t.is(hataOf(() => L.check(izin(L, { subjects: ['device:' + hex(C.isci1.memberId)] }))), 'INVALID_BODY')
  t.is(hataOf(() => L.check(izin(L, { subjects: Array.from({ length: 9 }, (_, i) => 'varlik:' + hex(id16(0x60 + i))) }))), 'INVALID_BODY', '8\'den çok özne')
  t.ok(L.check(izin(L, { subjects: [COKI, 'uye:' + hex(K.ecem.memberId), 'yer:' + hex(id16(0x11))] })))

  L.apply(izin(L))
  t.alike(L.grantWriteOf(hex(C.misafir2.memberId), hex(K_TUM_AILE)), { types: TURLER, subjects: [COKI], seq: L.len - 1 })
  t.is(L.grantWriteOf(hex(C.misafir2.memberId), hex(K_OLAYLAR)), null)

  // İkinci koleksiyon olur, üçüncüsü olmaz; aynı çiftin yenisi yerine geçer (sınıra takılmaz)
  L.apply(izin(L, { collectionId: K_OLAYLAR }))
  L.apply(koleksiyon(L, [K.kerem], { collectionId: id16(0x36), name: 'Pati', dropKey: b4a.alloc(32, 0x36) }))
  t.is(hataOf(() => L.check(izin(L, { collectionId: id16(0x36) }))), 'GUEST_LIMIT')
  L.apply(izin(L, { types: ['yuva.pet.kum'] }))
  t.alike(L.grantWriteOf(hex(C.misafir2.memberId), hex(K_TUM_AILE)).types, ['yuva.pet.kum'], 'yeni olay öncekinin yerine')
  // types boş: izin kalkar, yer açılır
  L.apply(izin(L, { types: [] }))
  t.is(L.grantWriteOf(hex(C.misafir2.memberId), hex(K_TUM_AILE)), null)
  t.ok(L.check(izin(L, { collectionId: id16(0x36) })))

  // Bırakma izni olan koleksiyon kasa olamaz
  t.is(hataOf(() => L.check(koleksiyon(L, [K.kerem, K.husniye], { collectionId: K_OLAYLAR, name: 'Olaylar:Ev', kind: 'olaylar', readers: ['rol:ebeveyn', 'rol:yetiskin'], writers: ['rol:ebeveyn', 'rol:yetiskin'], sensitivity: 'kasa', taskAccess: false, dropKey: b4a.alloc(32, 9) }))), 'VAULT_RULE')

  // REVOKE bütün izinleri bitirir
  L.apply(misafirKaldir(L, C.misafir2, [K.kerem]))
  t.is(L.grantWriteOf(hex(C.misafir2.memberId), hex(K_OLAYLAR)), null)
  t.is(hataOf(() => L.check(izin(L, { collectionId: K_OLAYLAR }))), 'NO_TARGET')
})

test('D78: GRANT_WRITE öneri yolundan da gelir; olay adı', (t) => {
  const { PROPOSABLE } = require('../ledger/proposals')
  t.ok(PROPOSABLE.has(T.GRANT_WRITE))
  t.is(T.GRANT_WRITE, 36)
})

test('D78: GUEST_VIEW drops alanı yalnız düzey 2.3\'te; görünüm koleksiyonu okutmaz (RFC-0030 §6)', (t) => {
  const GV = require('../protocol/guest-view')
  const c = require('compact-encoding')
  const gid = hex(C.misafir2.memberId)
  const L22 = aile('2.2')
  const eski = GV.buildGuestView(L22, gid, K.kerem)
  t.is(c.decode(GV.unsignedView, eski.subarray(0, eski.byteLength - 64)).drops, null, '2.2: alan hiç yazılmaz')
  t.alike(GV.acceptGuestView(null, eski, C.misafir2.memberId).drops, [])

  const L = aile()
  t.alike(GV.acceptGuestView(null, GV.buildGuestView(L, gid, K.kerem), C.misafir2.memberId).drops, [], '2.3: izin yoksa boş dizi')
  L.apply(tumAileAnahtarli(L))
  L.apply(izin(L))
  const gv = GV.acceptGuestView(null, GV.buildGuestView(L, gid, K.kerem), C.misafir2.memberId)
  // Tüm Aile'de GRANT_WRITE satırından sonra örtük SOS izni (RFC-0031 §4.1, D80)
  t.alike(gv.drops, [
    { collectionId: hex(K_TUM_AILE), dropKey: b4a.alloc(32, 0x5a), types: TURLER, subjects: [COKI] },
    { collectionId: hex(K_TUM_AILE), dropKey: b4a.alloc(32, 0x5a), types: ['hf.sos'], subjects: ['grant:' + gid] }
  ])
  t.absent(gv.collections.has(hex(K_TUM_AILE)), 'koleksiyonun kendisi görünümde değil')
  // Okuyucu değişip dropKey yenilenince görünüm yeni anahtarı taşır (§5)
  L.apply(koleksiyon(L, [K.kerem], { readers: ['rol:ebeveyn', 'rol:yetiskin'], writers: ['rol:ebeveyn', 'rol:yetiskin'], dropKey: b4a.alloc(32, 0x5b) }))
  t.alike(GV.acceptGuestView(gv, GV.buildGuestView(L, gid, K.kerem), C.misafir2.memberId).drops[0].dropKey, b4a.alloc(32, 0x5b))
  L.apply(misafirKaldir(L, C.misafir2, [K.kerem]))
  t.is(hataOf(() => GV.buildGuestView(L, gid, K.kerem)), 'NO_TARGET')
})
