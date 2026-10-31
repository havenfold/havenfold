// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// RFC-0010 adım 4–5 çekirdek parçaları: cevabın sınırları ve açılması, alıcı başlıkları, SHARE_PREVIEW (kurma, giriş
// noktası, imzacının denetimi). Vektörlerde olmayan dalları kapsar.
const test = require('brittle')
const b4a = require('b4a')
const c = require('compact-encoding')
const { ledger: { Ledger }, giris, zarf: { Z } } = require('@havenfold/core')
const V = require('../../core/test/helpers/v21')
const H = require('..')
const Y = require('./helpers/service-vector')

const { cevap: C, paket: P, kodlama: K, onizleme: Oz, kart: Kt } = H
const hata = (f) => { try { f(); return 'kabul' } catch (e) { return e.message } }
const h = (x) => b4a.from(x, 'hex')
const TS = V.TS0
const IMZA = Y.signCifti(Y.VETERINER.signSeed)
const PID = b4a.alloc(16, 0x81)

test('cevap: sınırlar, açma hataları, rastgele yol', (t) => {
  const reply = P.sifreCifti()
  const kur = (ek = {}) => C.cevapKur({ packageId: PID, n: 0, replyPub: reply.publicKey, signSecret: IMZA.secretKey, kind: 'belge', at: TS, ...ek })
  t.is(hata(() => kur({ n: -1 })), 'REPLY_LIMIT')
  t.is(hata(() => kur({ n: 1.5 })), 'REPLY_LIMIT')
  t.is(hata(() => kur({ text: 'x'.repeat(4097) })), 'REPLY_CORRUPT')
  const f = { blobId: b4a.alloc(32), fileKey: b4a.alloc(32), size: 1, mime: 'application/pdf', name: 'a.pdf' }
  t.is(hata(() => kur({ files: Array(5).fill(f) })), 'REPLY_CORRUPT')
  t.is(hata(() => kur({ files: [{ ...f, size: 11 * K.MB }] })), 'SIZE_OVERRUN')
  t.is(hata(() => kur({ at: -1 })), 'REPLY_CORRUPT', 'kodlanamayan alan')
  const b = kur({ files: [f], text: 'Rapor ekte.' })
  const ac = (x, ek = {}) => C.cevapAc(x, { packageId: PID, replySecret: reply.secretKey, signPub: IMZA.publicKey, ...ek })
  t.alike([ac(b).kind, ac(b).files.length], ['belge', 1])
  t.is(hata(() => ac(b, { replySecret: P.sifreCifti().secretKey })), 'REPLY_OPEN_FAILED')
  const d = C.cevapCoz(b)
  t.is(hata(() => ac(c.encode(K.CEVAP, { ...d, ct: b4a.alloc(3) }))), 'REPLY_OPEN_FAILED')
  t.is(hata(() => ac(c.encode(K.CEVAP, { ...d, n: 16 }))), 'REPLY_LIMIT')
  t.is(hata(() => ac(c.encode(K.CEVAP, { ...d, ephPub: b4a.alloc(32) }))), 'INVALID_KEY')
  t.is(hata(() => C.cevapCoz(b4a.alloc(2))), 'REPLY_CORRUPT')
  t.not(b4a.toString(kur(), 'hex'), b4a.toString(kur(), 'hex'), 'rastgele eph ve nonce')
})

test('başlıklar: biçim, saat ve nonce defteri temizliği, sahip sırrı', (t) => {
  for (const s of [null, 'ab', 'z'.repeat(176), 'f'.repeat(176)]) t.is(hata(() => C.yetkiCoz(s)), 'NO_PERMISSION', String(s).slice(0, 4))
  const sid = Kt.serviceIdOf(IMZA.publicKey)
  const d = new C.YetkiDefteri()
  const b = (t0) => C.yetkiBasligi({ serviceId: sid, signSecret: IMZA.secretKey, t: t0, yontem: 'GET', yol: '/v1/x' })
  t.is(d.denetle({ baslik: b(TS), serviceId: sid, signPub: IMZA.publicKey, yontem: 'GET', yol: '/v1/x', simdi: TS }), TS)
  t.is(d.gorulen.size, 1)
  d.denetle({ baslik: b(TS + 11 * 60_000), serviceId: sid, signPub: IMZA.publicKey, yontem: 'GET', yol: '/v1/x', simdi: TS + 11 * 60_000 })
  t.is(d.gorulen.size, 1, '10 dakikadan eski nonce düşer')
  t.is(hata(() => d.denetle({ baslik: b(TS), serviceId: sid, signPub: IMZA.publicKey, yontem: 'POST', yol: '/v1/x', simdi: TS })), 'NO_PERMISSION', 'başka yöntem')
  t.is(hata(() => C.sahipSirri('kısa')), 'NO_OWNER')
  t.is(C.sahipSirri('aa'.repeat(32)).byteLength, 32)
})

function defter () {
  const L = new Ledger()
  for (const f of V.anaAdimlar(L)) L.apply(f())
  return L
}

test('SHARE_PREVIEW: kurma, giriş noktası, imzacının denetimi', (t) => {
  const L = defter()
  const kart = Kt.kartCoz(Y.kartKur(Y.VETERINER))
  const govde = P.govdeKodla(Y.govdeOf(Y.GOVDE, kart))
  const g = P.govdeCoz(govde)
  const m = { familyId: L.familyId, shareId: g.shareId, card: kart.bytes, body: govde, sources: [{ collectionId: V.K_TUM_AILE, recordIds: [b4a.alloc(16, 1)] }], fromId: V.K.irem.memberId }
  const bytes = Oz.onizlemeKur({ ...m, signSecret: V.K.irem.signKeyPair.secretKey })
  const o = Oz.onizlemeCoz(bytes, { ledger: L, fromHex: b4a.toString(V.K.irem.memberId, 'hex') })
  t.alike([o.govde.title, b4a.toString(o.kart.serviceId, 'hex'), o.sources.length], [Y.GOVDE.title, b4a.toString(kart.serviceId, 'hex'), 1])
  // Tek giriş noktası: uye ↔ uye oturumunda 0xD0 kanonik çözücüden geçer; bozuk bayt reddedilir
  t.is(Z.SHARE_PREVIEW, Oz.Z_SHARE_PREVIEW)
  t.is(giris.gelenZarf({ myRole: 'uye', peerRole: 'uye', type: Z.SHARE_PREVIEW, bytes, yol: 'dogrudan' }).mesaj.familyId.byteLength, 32)
  t.is(hata(() => giris.gelenZarf({ myRole: 'uye', peerRole: 'uye', type: Z.SHARE_PREVIEW, bytes: b4a.alloc(4), yol: 'dogrudan' })), 'INVALID_MESSAGE')
  t.is(hata(() => giris.gelenZarf({ myRole: 'uye', peerRole: 'uye', type: Z.SHARE_RULE, bytes: b4a.alloc(4), yol: 'posta' })), 'MAILBOX_FORBIDDEN', 'SHARE_RULE Posta Kutusu yolunda değil')
  // İmzacının denetimi
  const coz = (b, ek = {}) => Oz.onizlemeCoz(b, { ledger: L, ...ek })
  t.is(hata(() => coz(bytes, { fromHex: b4a.toString(V.K.kerem.memberId, 'hex') })), 'SENDER_MISMATCH')
  t.is(hata(() => coz(Oz.onizlemeKur({ ...m, familyId: b4a.alloc(32), signSecret: V.K.irem.signKeyPair.secretKey }))), 'FAMILY_MISMATCH')
  t.is(hata(() => coz(Oz.onizlemeKur({ ...m, fromId: b4a.alloc(16, 9), signSecret: V.K.irem.signKeyPair.secretKey }))), 'UNAUTHORIZED')
  t.is(hata(() => coz(Oz.onizlemeKur({ ...m, signSecret: V.K.kerem.signKeyPair.secretKey }))), 'INVALID_SIGNATURE')
  t.is(hata(() => coz(Oz.onizlemeKur({ ...m, shareId: b4a.alloc(16), signSecret: V.K.irem.signKeyPair.secretKey }))), 'PREVIEW_CORRUPT')
  t.is(hata(() => coz(bytes, { ledger: new Ledger() })), 'FAMILY_MISMATCH')
  t.is(hata(() => Oz.onizlemeKur({ ...m, card: null, signSecret: V.K.irem.signKeyPair.secretKey })), 'PREVIEW_CORRUPT')
})
