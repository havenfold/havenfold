// SPDX-License-Identifier: Apache-2.0
// D80: SOS alanları ve bakıcının SOS'u, SDK uçtan uca (RFC-0031). Düzey 2.3'te misafir eklenince ebeveyn telefonu Tüm
// Aile'ye bırakma anahtarı açar; bakıcının telefonu GUEST_VIEW'deki örtük satırla SOS bırakır; ailenin telefonu SOS'u
// görür ve vaka açılır. Üyenin SOS'u alanlarıyla yazılır; geçersiz alanlı SOS yazılmadan reddedilir.
const test = require('brittle')
const b4a = require('b4a')
const S = require('..')
const { guestView: GV, giris } = require('@havenfold/core')
const { esitleme: ES } = require('@havenfold/records')
const A = require('../../core/records/test/helpers/family')
const V = require('../../core/core/test/helpers/v21')

const hex = (b) => b4a.toString(b, 'hex')
const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const TA = hex(A.K_TUM_AILE)
const MISAFIR = V.C.misafir2

// kim: replikanın sahibi (Tüm Aile'nin dönem anahtarını sıralamada ilk okuyucu Hüsniye üretir)
function kur (kim = V.K.kerem) {
  const L = A.anaDefter()
  const saat = { t: V.TS0 + 3_600_000 }
  const now = () => saat.t
  const kerem = new S.LedgerApi({ ledger: L, me: V.K.kerem, now })
  kerem.raiseLevel('2.2')
  kerem.raiseLevel('2.3')
  const kayit = new S.RecordApi({ replika: A.replika(L, kim, { now }) })
  const olay = new S.EventApi({ kayit, now })
  return { L, saat, now, kerem, kayit, olay }
}

function bakiciEkle ({ kerem }) {
  const { event } = kerem.prepareCaregiver({ deviceCert: MISAFIR.deviceCert, ad: 'Selin', koleksiyonlar: [V.K_BAKICI], expiresAt: V.TS0 + 30 * 86_400_000, ceremonyTranscriptHash: 'cd'.repeat(32) })
  return kerem.proposeCaregiver(event, S.LedgerApi.signGuest(event, MISAFIR))
}

test('D80: 2.3\'te bakıcı eklenince Tüm Aile\'ye bırakma anahtarı açılır; ikinci bakıcıda yeniden açılmaz', (t) => {
  const k = kur()
  t.ok(k.L.collections.get(TA).dropKey.every((x) => x === 0), 'önce anahtar yok')
  const r = bakiciEkle(k)
  t.is(r.durum, 'uygulandi')
  t.is(r.sosBirakma.collectionId, TA)
  t.is(r.sosAnahtarOlayi.durum, 'uygulandi')
  t.absent(k.L.collections.get(TA).dropKey.every((x) => x === 0))
  // Anahtar varken başka bir düzey yazımı ya da misafir yeniden açmaz
  t.absent(k.kerem._sosAnahtari({ durum: 'uygulandi' }).sosBirakma)
})

test('D80: bakıcı SOS gönderir; aile görür, vaka açılır; bakıcıda sessiz ve zorlama-pin yok', (t) => {
  const k = kur()
  const r = bakiciEkle(k)
  k.kayit.r.addDropSecret(r.sosBirakma.collectionId, r.sosBirakma.secret)
  const gid = hex(MISAFIR.memberId)
  const gv = GV.acceptGuestView(null, GV.buildGuestView(k.L, gid, V.K.kerem), MISAFIR.memberId)
  const bakici = new S.GuestWriteApi({ kimlik: MISAFIR, gorunum: gv, now: k.now })
  t.alike(bakici.permissions(), [{ collectionId: TA, types: ['hf.sos'], subjects: ['grant:' + gid] }], 'GRANT_WRITE olmadan örtük satır')
  t.is(hataOf(() => bakici.sos({ yol: 'zorlama-pin' })), 'INVALID_FIELD_VALUE')
  t.is(hataOf(() => bakici.sos({ metin: 'x'.repeat(65) })), 'SOS_METIN')
  t.is(hataOf(() => bakici.drop(TA, 'hf.sos', { subj: 'uye:' + hex(V.K.kerem.memberId) })), 'SUBJECT_NOT_ALLOWED')

  const mid = b4a.alloc(16, 0xab)
  const b = bakici.sos({ yol: 'afet', metin: 'Coki düştü', pil: 35, konum: { latE5: 4101234, lonE5: 2898765, accM: 15, at: k.now() - 1000 }, afetMid: mid })
  t.is(bakici.myWrites()[0].type, 'hf.sos', '"Senin yazdıkların"da görünür')

  // Ailenin telefonu: misafir oturumundan gelen REC_OPS
  giris.gelenZarf({ myRole: 'uye', peerRole: 'misafir', type: b.mesaj.type, bytes: b.mesaj.bytes, yol: 'dogrudan' })
  t.alike(ES.onOps(k.kayit.r, b.mesaj.bytes).map((x) => x.status), ['gecerli'])
  const liste = k.olay.listSos(TA)
  t.is(liste.length, 1)
  const s = liste[0]
  t.alike([s.yazar, s.subj, s.yol, s.metin, s.pil, s.afetMid, s.sessiz, s.gecerli], ['misafir', 'grant:' + gid, 'afet', 'Coki düştü', 35, hex(mid), false, true])
  t.alike(s.konum, { latE5: 4101234, lonE5: 2898765, accM: 15, at: k.now() - 1000 })
  const v = k.olay.evaluate(TA)
  t.is(v.yeni.length, 1, 'vaka önerilir')
  t.is(v.yeni[0].alanlar.kaynak, 'cekirdek:hf.sos')

  // Afet bağı: aynı afetMid'li afet mesajı daha önce bildirildiyse kayıt yeniden bildirmez
  t.ok(k.olay.shouldNotifySos(mid), 'ilk geliş (afet mesajı)')
  t.absent(k.olay.shouldNotifySos(s.afetMid), 'kayıt: tek bildirim')
})

test('D80: üyenin SOS\'u alanlarıyla; sessiz yalnız zorlama-pin ile; geçersiz alanlı SOS yazılmaz', (t) => {
  const k = kur(V.K.husniye)
  const ben = 'uye:' + hex(V.K.husniye.memberId)
  t.is(hataOf(() => k.olay.writeSos(TA, { yol: 'dugme', sessiz: true })), 'INVALID_SOS_SILENT')
  t.is(hataOf(() => k.olay.writeSos(TA, { pil: 120 })), 'INVALID_SOS_BATTERY')
  t.is(hataOf(() => k.olay.writeSos(TA, { afetMid: 'ab' })), 'INVALID_SOS_DISASTER_MID')
  k.olay.writeSos(TA, { yol: 'zorlama-pin', sessiz: true, konum: { latE5: 1, lonE5: 2, accM: 3, at: 4 } })
  k.saat.t += 1000
  k.olay.writeSos(TA, {})
  const l = k.olay.listSos(TA)
  t.alike(l.map((x) => [x.subj, x.yol, x.sessiz, x.gecerli]), [[ben, 'dugme', false, true], [ben, 'zorlama-pin', true, true]], 'yeniden eskiye')
  t.is(k.olay.query(TA, { tur: 'hf.sos' }).length, 2)
})
