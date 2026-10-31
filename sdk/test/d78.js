// SPDX-License-Identifier: Apache-2.0
// D78: bakıcının sınırlı yazması, SDK uçtan uca (RFC-0030 §3, §5, §6). Ebeveyn Tüm Aile'ye bırakma anahtarı açar ve
// bakıcıya izin verir; bakıcının telefonu GUEST_VIEW'den izni alır, "mama verdim" bırakır ve kendi listesinde görür;
// ailenin telefonu olayı bakıcı yazarıyla görür. REVOKE'tan sonra bırakılan atılır.
const test = require('brittle')
const b4a = require('b4a')
const S = require('..')
const { guestView: GV, giris, ledger: { T } } = require('@havenfold/core')
const { esitleme: ES } = require('@havenfold/records')
const Ol = require('@havenfold/events')
const A = require('../../core/records/test/helpers/family')
const V = require('../../core/core/test/helpers/v21')

const hex = (b) => b4a.toString(b, 'hex')
const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const TA = hex(A.K_TUM_AILE)
const COKI = 'varlik:' + hex(V.VARLIK_KEDI)
const MISAFIR = V.C.misafir2
const BESLENME = { tur: 'yuva.pet.beslenme', v: 1, olay: true, yazar: 'uye', ozne: ['varlik'], alanlar: [{ ad: 'miktar', deger: 'int', zorunlu: false, birim: 'g' }], kapsam: 'topluluk', keep: 90, ozel: false }

function kur () {
  const L = A.anaDefter()
  const saat = { t: V.TS0 + 3_600_000 }
  const now = () => saat.t
  const kerem = new S.LedgerApi({ ledger: L, me: V.K.kerem, now })
  kerem.raiseLevel('2.2')
  const katalog = () => { const k = new Ol.tur.Katalog(); k.turKaydet(BESLENME); return k }
  const kayit = new S.RecordApi({ replika: A.replika(L, V.K.kerem, { now }) })
  const olay = new S.EventApi({ kayit, katalog: katalog(), now })
  // Bakıcı (D25 akışı): ebeveyn hazırlar, misafir imzalar, ebeveyn gönderir
  const { event } = kerem.prepareCaregiver({ deviceCert: MISAFIR.deviceCert, ad: 'Selin', koleksiyonlar: [V.K_BAKICI], expiresAt: V.TS0 + 30 * 86_400_000, ceremonyTranscriptHash: 'cd'.repeat(32) })
  t0(kerem.proposeCaregiver(event, S.LedgerApi.signGuest(event, MISAFIR)).durum === 'uygulandi')
  return { L, saat, now, kerem, kayit, olay, katalog }
}
function t0 (ok) { if (!ok) throw new Error('KURULUM') }

test('D78: ebeveyn izin verir, bakıcı bırakır ve kendi yazdıklarını görür; aile olayı bakıcı yazarıyla görür', (t) => {
  const { L, saat, now, kerem, kayit, olay, katalog } = kur()
  const gid = hex(MISAFIR.memberId)
  const izin = { grantId: gid, collectionId: TA, types: ['yuva.pet.beslenme'], subjects: [COKI] }
  t.is(hataOf(() => kerem.grantCaregiverWrite(izin)), 'LEVEL_TOO_LOW', 'düzey 2.3 yazılmadan')
  // Misafir varken 2.3'e çıkan ebeveyn Tüm Aile'ye bırakma anahtarını kendiliğinden açar (RFC-0031 §4.1, D80)
  const yuk = kerem.raiseLevel('2.3')
  t.is(yuk.sosBirakma.collectionId, TA)
  kayit.r.addDropSecret(yuk.sosBirakma.collectionId, yuk.sosBirakma.secret)
  const ac = kerem.openDropKey(TA)
  t.is(ac.durum, 'uygulandi')
  kayit.r.addDropSecret(ac.birakma.collectionId, ac.birakma.secret)
  t.is(kerem.grantCaregiverWrite(izin).durum, 'uygulandi')
  t.alike(kerem.caregiverWriteGrants(gid), [{ collectionId: TA, types: ['yuva.pet.beslenme'], subjects: [COKI] }])
  t.alike(kerem.familyInfo().misafirler.find((m) => m.grantId === gid).yazma.length, 1)

  // Bakıcının telefonu
  const gv = GV.acceptGuestView(null, GV.buildGuestView(L, gid, V.K.kerem), MISAFIR.memberId)
  const bakici = new S.GuestWriteApi({ kimlik: MISAFIR, gorunum: gv, katalog: katalog(), now })
  t.alike(bakici.permissions(), [{ collectionId: TA, types: ['yuva.pet.beslenme'], subjects: [COKI] }, { collectionId: TA, types: ['hf.sos'], subjects: ['grant:' + gid] }])
  t.is(hataOf(() => bakici.drop(TA, 'yuva.pet.beslenme', { subj: 'uye:' + hex(V.K.ecem.memberId) })), 'SUBJECT_NOT_ALLOWED')
  const olaylar = []
  bakici.on('dropped', (k) => olaylar.push(k))
  const b = bakici.drop(TA, 'yuva.pet.beslenme', { subj: COKI, miktar: 40 })
  t.alike(bakici.myDrops().map((x) => [x.opId, x.type, x.subj, x.alanlar.miktar]), [[b.opId, 'yuva.pet.beslenme', COKI, 40]])
  t.is(olaylar.length, 1)
  t.alike(bakici.myWrites(), [{ recordId: b.recordId, type: 'yuva.pet.beslenme', subj: COKI, at: bakici.myDrops()[0].t }], 'komut 413 biçimi')

  // Ailenin telefonu: misafir oturumundan gelen REC_OPS ağ girişinden geçer, olay "misafir" yazarlı ve sayılır
  const gelen = (m) => { giris.gelenZarf({ myRole: 'uye', peerRole: 'misafir', type: m.type, bytes: m.bytes, yol: 'dogrudan' }); return ES.onOps(kayit.r, m.bytes) }
  const sonuc = gelen(b.mesaj)
  t.alike(sonuc.map((x) => x.status), ['gecerli'])
  const gorulen = olay.query(TA, { tur: 'yuva.pet.beslenme' })
  t.alike(gorulen.map((e) => [e.yazar, e.authorHex, e.fields.miktar]), [['misafir', gid, 40]])

  // REVOKE: sonra bırakılan atılır
  saat.t += 60_000
  kerem._yaz(T.REVOKE, { grantId: MISAFIR.memberId, reason: 'tatil bitti' })
  t.alike(kerem.caregiverWriteGrants(gid), [])
  const gv2 = { ...gv, ledgerLen: L.len, ledgerHead: L.head }
  bakici.updateView(gv2) // eski izinle yeni ledgerSeq (misafir REVOKE'u henüz bilmiyor)
  const b2 = bakici.drop(TA, 'yuva.pet.beslenme', { subj: COKI })
  const s2 = gelen(b2.mesaj)
  t.alike(s2.map((x) => x.code), ['NO_PERMISSION'])
  t.is(bakici.myDrops().length, 2, 'yerel liste gönderileni tutar')
})
