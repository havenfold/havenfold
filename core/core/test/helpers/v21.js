// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Defter v2.1 test ve vektör yardımcısı: belirlenimci kimlikler ve olay kurucular (RFC-0003).
const b4a = require('b4a')
const { createIdentity } = require('../../core/identity')
const { T } = require('../../ledger/ledger')
const { K, TS0, olay, ekle, genesis } = require('./ledger')

const ZERO16 = b4a.alloc(16)
const ZERO32 = b4a.alloc(32)
const DAY = 86_400_000
const hex = (b) => b4a.toString(b, 'hex')

// Cihaz ve misafir kimlikleri
const C = {}
const cihazKimligi = (ad) => Object.assign(createIdentity({ seed: 'ledger-v21/' + ad, platform: 'test' }), { ad })
for (const ad of ['isci1', 'uc1', 'misafir1', 'misafir2']) C[ad] = cihazKimligi(ad)
for (let i = 2; i <= 18; i++) C['isci' + i] = cihazKimligi('isci' + i)

// Sabit kimlikler (16 bayt) ve anahtarlar
const id16 = (n) => b4a.alloc(16, n)
const YER_EV = id16(0x11)
const YER_YAZLIK = id16(0x12)
const VARLIK_KEDI = id16(0x21)
const K_TUM_AILE = id16(0x31)
const K_KISISEL_IREM = id16(0x32)
const K_BAKICI = id16(0x33)
const K_OLAYLAR = id16(0x34)
const K_KASA = id16(0x35)
const PAYLASIM = id16(0x41)

const uye = (k) => 'uye:' + hex(k.memberId)

const seviye = (L, imz = [K.kerem]) => olay(L, T.PROTOCOL_LEVEL, { level: '2.1' }, imz)
const tur = (L, kind = 'aile', imz = [K.kerem]) => olay(L, T.KIND, { kind }, imz)

const cihazEkle = (L, c, imz, ek = {}) => olay(L, T.DEVICE_ATTACH, {
  deviceCert: c.deviceCert,
  class: 'isci',
  name: c.ad,
  placeId: ZERO16,
  caps: b4a.from('caps:' + c.ad),
  ceremonyTranscriptHash: b4a.alloc(32, 7),
  ...ek
}, [c, ...imz])

const cihazCikar = (L, c, imz, ek = {}) => olay(L, T.DEVICE_DETACH, {
  deviceId: c.memberId, reason: 'test', wipe: false, wipeReportHash: ZERO32, ...ek
}, imz)

const koleksiyon = (L, imz, ek) => olay(L, T.COLLECTION, {
  collectionId: K_TUM_AILE,
  name: 'Tüm Aile',
  kind: 'genel',
  readers: ['rol:ebeveyn', 'rol:yetiskin', 'rol:cocuk'],
  writers: ['rol:ebeveyn', 'rol:yetiskin', 'rol:cocuk'],
  sensitivity: 'normal',
  taskAccess: true,
  history: true,
  dropKey: ZERO32,
  ...ek
}, imz)

const misafirEkle = (L, m, imz, ek = {}) => olay(L, T.GRANT, {
  grantedBy: imz[0].memberId,
  to: m.deviceCert,
  name: 'Bakıcı',
  collections: [K_BAKICI],
  taskTypes: [],
  expiresAt: TS0 + 30 * DAY,
  ceremonyTranscriptHash: b4a.alloc(32, 7),
  ...ek
}, [m, ...imz])

const misafirKaldir = (L, m, imz) => olay(L, T.REVOKE, { grantId: m.memberId, reason: 'test' }, imz)

// Ana zincir: her v2.1 olayı en az bir kez geçer (RFC-0003 §11 madde 1)
function anaAdimlar (L) {
  return [
    () => genesis(),
    () => tur(L, 'aile'),
    () => ekle(L, K.husniye, 'ebeveyn', [K.kerem]),
    () => ekle(L, K.irem, 'yetiskin', [K.kerem, K.husniye]),
    () => ekle(L, K.ecem, 'cocuk', [K.kerem, K.husniye]),
    () => ekle(L, K.kutu, 'kutu', [K.husniye]),
    () => seviye(L),
    () => olay(L, T.PLACE, { placeId: YER_EV, name: 'Ev', kind: 'ev', remove: false }, [K.kerem]),
    () => olay(L, T.BEING, { beingId: VARLIK_KEDI, kind: 'kedi', name: 'Coki', placeId: YER_EV, remove: false }, [K.husniye]),
    () => koleksiyon(L, [K.kerem]),
    () => koleksiyon(L, [K.irem], { collectionId: K_KISISEL_IREM, name: 'Kişisel', kind: 'kisisel', readers: [uye(K.irem)], writers: [uye(K.irem)], taskAccess: false }),
    () => koleksiyon(L, [K.kerem], { collectionId: K_BAKICI, name: 'Bakıcı', kind: 'bakici', readers: ['rol:ebeveyn'], writers: ['rol:ebeveyn'], taskAccess: false, history: false }),
    () => koleksiyon(L, [K.husniye], { collectionId: K_OLAYLAR, name: 'Olaylar:Ev', kind: 'olaylar', readers: ['rol:ebeveyn', 'rol:yetiskin'], writers: ['rol:ebeveyn', 'rol:yetiskin', 'device:' + hex(C.isci1.memberId)], dropKey: b4a.alloc(32, 9) }),
    () => koleksiyon(L, [K.kerem, K.husniye], { collectionId: K_KASA, name: 'Kasa', kind: 'genel', readers: ['rol:ebeveyn'], writers: ['rol:ebeveyn'], sensitivity: 'kasa', taskAccess: false }),
    () => cihazEkle(L, C.isci1, [K.kerem], { placeId: YER_EV }),
    () => cihazEkle(L, C.uc1, [K.husniye], { class: 'uc' }),
    () => misafirEkle(L, C.misafir1, [K.kerem]),
    () => olay(L, T.TASK_PERMIT, { subject: 'rol:cocuk', taskTypes: ['hf.task.ocr'], allow: true }, [K.kerem]),
    () => olay(L, T.SHARE_CONSENT, { shareId: PAYLASIM, service: 'veteriner', scope: 'pati', ownerId: K.irem.memberId, expiresAt: TS0 + 7 * DAY, payloadHash: b4a.alloc(32, 5) }, [K.irem]),
    () => cihazCikar(L, C.uc1, [C.uc1]), // §11 madde 3: cihaz kendi çıkışını imzalar
    () => misafirKaldir(L, C.misafir1, [K.husniye])
  ]
}

module.exports = {
  C, K, T, TS0, DAY, ZERO16, ZERO32, id16, hex, uye, olay, ekle, genesis,
  YER_EV, YER_YAZLIK, VARLIK_KEDI, K_TUM_AILE, K_KISISEL_IREM, K_BAKICI, K_OLAYLAR, K_KASA, PAYLASIM,
  seviye, tur, cihazEkle, cihazCikar, koleksiyon, misafirEkle, misafirKaldir, anaAdimlar
}
