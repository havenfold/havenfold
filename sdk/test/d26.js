// SPDX-License-Identifier: Apache-2.0
// DP26 (inceleme 20, D80 bulguları): afet bağıyla tek bildirim Bildirimci'nin içinde (B1), süresi bitmiş misafirin SOS'u
// geçersiz (B2), sonraki put SOS'u geçersiz kılamaz (B3), öneri yolunda uygulanan GRANT da örtük SOS iznini açar (B4).
const test = require('brittle')
const b4a = require('b4a')
const S = require('..')
const { guestView: GV, giris } = require('@havenfold/core')
const { esitleme: ES } = require('@havenfold/records')
const A = require('../../core/records/test/helpers/family')
const V = require('../../core/core/test/helpers/v21')

const hex = (b) => b4a.toString(b, 'hex')
const TA = hex(A.K_TUM_AILE)
const MISAFIR = V.C.misafir2
const GUN = 86_400_000

function kur ({ gun = 30 } = {}) {
  const L = A.anaDefter()
  const saat = { t: V.TS0 + 3_600_000 }
  const now = () => saat.t
  const kerem = new S.LedgerApi({ ledger: L, me: V.K.kerem, now })
  kerem.raiseLevel('2.2')
  kerem.raiseLevel('2.3')
  const kayit = new S.RecordApi({ replika: A.replika(L, V.K.husniye, { now }) })
  const olay = new S.EventApi({ kayit, now })
  const { event } = kerem.prepareCaregiver({ deviceCert: MISAFIR.deviceCert, ad: 'Selin', koleksiyonlar: [V.K_BAKICI], expiresAt: V.TS0 + gun * GUN, ceremonyTranscriptHash: 'cd'.repeat(32) })
  return { L, saat, now, kerem, kayit, olay, event }
}

function bakiciKur (k) {
  const r = k.kerem.proposeCaregiver(k.event, S.LedgerApi.signGuest(k.event, MISAFIR))
  k.kayit.r.addDropSecret(r.sosBirakma.collectionId, r.sosBirakma.secret)
  const gv = GV.acceptGuestView(null, GV.buildGuestView(k.L, hex(MISAFIR.memberId), V.K.kerem), MISAFIR.memberId)
  return new S.GuestWriteApi({ kimlik: MISAFIR, gorunum: gv, now: k.now })
}

// Önerilen SOS vakasını ve ilk basamağını (2: aile) bu telefon yazar
function vakaAc (k) {
  const a = k.olay.evaluate(TA).yeni.find((y) => y.alanlar.kaynak === 'cekirdek:hf.sos').alanlar
  k.kayit.put(TA, null, 'hf.vaka', a)
  k.kayit.put(TA, null, 'hf.vaka.basamak', { vaka: a.vaka, basamak: 2, sira: 0, _t: k.now(), _keep: 365 })
}

const ailedeAl = (k, b) => {
  giris.gelenZarf({ myRole: 'uye', peerRole: 'misafir', type: b.mesaj.type, bytes: b.mesaj.bytes, yol: 'dogrudan' })
  return ES.onOps(k.kayit.r, b.mesaj.bytes)
}

test('DP26 B1: afet mesajı gösterildiyse SOS vakası bildirim göstermez; tersinde afet mesajı sessiz; aynı kimliğe aynı cevap', (t) => {
  const k = kur()
  const bakici = bakiciKur(k)
  const mid = b4a.alloc(16, 0xab)
  t.alike(ailedeAl(k, bakici.sos({ yol: 'afet', afetMid: mid })).map((x) => x.status), ['gecerli'])
  vakaAc(k)
  const vaka = k.olay.cases(TA).find((v) => v.sos)
  t.is(vaka.afetMid, hex(mid), 'motor vakaya afet bağını ekler')
  const me = hex(V.K.husniye.memberId)

  // Önce afet mesajı (uygulama gösterdi): vaka bildirimi gösterilmez
  t.ok(k.olay.shouldNotifySos(mid, 'afet:m1'))
  t.ok(k.olay.shouldNotifySos(mid, 'afet:m1'), 'aynı kimlikle aynı cevap')
  const b = k.olay.notifier({ me })
  const durumlar = k.olay.cases(TA).map((v) => ({ ...v, sessiz: false }))
  t.alike(b.guncelle(durumlar).filter((x) => x.eylem === 'goster'), [], 'vaka sessiz')
  t.alike(b.guncelle(durumlar), [], 'tekrar sorulunca da sessiz')

  // Ters sıra: vaka önce gösterilir, sonra gelen afet mesajı gösterilmez
  const k2 = kur()
  const bakici2 = bakiciKur(k2)
  ailedeAl(k2, bakici2.sos({ yol: 'afet', afetMid: mid }))
  vakaAc(k2)
  const b2 = k2.olay.notifier({ me })
  t.is(b2.guncelle(k2.olay.cases(TA).map((v) => ({ ...v, sessiz: false }))).filter((x) => x.eylem === 'goster').length, 1, 'vaka bildirildi')
  t.absent(k2.olay.shouldNotifySos(mid, 'afet:m1'), 'afet mesajı ikinci geliş')
  t.absent(k2.olay.shouldNotifySos(mid, 'afet:m1'), 'aynı cevap')
})

test('DP26 B2: GRANT süresi bitmiş (REVOKE yazılmamış) misafirin SOS bırakması geçersiz', (t) => {
  const k = kur({ gun: 1 })
  const bakici = bakiciKur(k)
  k.saat.t = V.TS0 + 2 * GUN
  const sonuc = ailedeAl(k, bakici.sos({ yol: 'dugme' }))
  t.alike(sonuc.map((x) => [x.status, x.code]), [['reddedildi', 'TERM_EXPIRED']])
  t.is(k.olay.listSos(TA).length, 0)
})

test('DP26 B3: sonradan gelen put SOS\'u motor için geçersiz kılamaz', (t) => {
  const k = kur()
  const rid = k.olay.writeSos(TA, { yol: 'dugme', metin: 'Yardım' })
  k.kayit.put(TA, rid, null, { metin: 'x'.repeat(65) })
  const s = k.olay.listSos(TA)[0]
  t.is(s.gecerli, true)
  t.is(k.olay.evaluate(TA).yeni.filter((y) => y.alanlar.kaynak === 'cekirdek:hf.sos').length, 1, 'vaka yine açılır')
})

test('DP26 B4: öneri yolunda (sign) uygulanan GRANT da Tüm Aile\'ye bırakma anahtarı açar', (t) => {
  const k = kur()
  const e = { ...k.event, sigs: [S.LedgerApi.signGuest(k.event, MISAFIR)] }
  const id = k.kerem.oneriler.add(e, k.now())
  t.ok(id, 'öneri')
  const r = k.kerem.sign(id)
  t.is(r.durum, 'uygulandi')
  t.is(r.sosBirakma && r.sosBirakma.collectionId, TA)
  t.absent(k.L.collections.get(TA).dropKey.every((x) => x === 0))
})
