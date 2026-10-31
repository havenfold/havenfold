// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Misafir kipinin kalıcılığı (açılış öncesi inceleme): halef görünümüyle yeniden açılış, doğrulanamayan görünümde
// telefon açılır, iptal sonradan gelen görünümle kalkmaz; misafir kuyruğu yeniden gönderilir ve süreyle düşer.
'use strict'
const test = require('brittle')
const b4a = require('b4a')
const { Kalici } = require('../persistence')
const { MisafirEsitleyici } = require('../guest-synchronizer')
const { geciciDizin } = require('./helpers/common')
const { ledger: { Ledger, T }, zarf: { Z } } = require('@havenfold/core')
const GV = require('../../core/core/protocol/guest-view')
const V = require('../../core/core/test/helpers/v21')
const { K, C, hex, olay, misafirKaldir, anaAdimlar, TS0 } = V

const id = (k) => hex(k.memberId)
function anaDefter (n = Infinity) {
  const L = new Ledger({ now: () => TS0 })
  for (const f of anaAdimlar(L).slice(0, n)) L.apply(f())
  return L
}
const rotate = (L, eski, yeni, imz) => olay(L, T.ROTATE_DEVICE, { oldMemberId: eski.memberId, newDeviceCert: yeni.deviceCert, ceremonyTranscriptHash: b4a.alloc(32, 7) }, imz)
const ac = (dizin) => new Kalici({ dizin, testKipi: true, kimlik: C.misafir1, platform: 'test', now: () => TS0 + 1000 })

test('halef görünümüyle yeniden açılış: ebeveyn telefon değiştirdikten sonra misafir telefonu açılır', (t) => {
  const dizin = geciciDizin(t, 'ma1')
  const L = anaDefter(17)
  let k = ac(dizin)
  k.misafirBagla(GV.buildGuestView(L, id(C.misafir1), K.kerem), { toren: true })
  L.apply(rotate(L, K.kerem, K.yeniKerem, [K.yeniKerem, K.kerem, K.husniye]))
  k.misafirBagla(GV.buildGuestView(L, id(C.misafir1), K.yeniKerem))
  t.is(k.nesneler.misafir.gorunum.signerHex, id(K.yeniKerem))
  k.kaydet()
  k.kapat()
  k = ac(dizin)
  t.ok(k.nesneler.misafir, 'misafirlik açılışta sürdü')
  t.is(k.nesneler.misafir.gorunum.signerHex, id(K.yeniKerem))
  t.absent(k.misafirAcilisHatasi)
  k.kapat()
})

test('doğrulanamayan görünüm telefonu açılmaz yapmaz: misafirlik düşer, sebep misafirAcilisHatasi', (t) => {
  const dizin = geciciDizin(t, 'ma2')
  const L = anaDefter(17)
  let k = ac(dizin)
  k.misafirBagla(GV.buildGuestView(L, id(C.misafir1), K.kerem), { toren: true })
  // Durumdaki çapa bozulmuş gibi: görünüm başka bir imzacının çapasıyla doğrulanamaz
  k._misafir.capa.signerHex = id(K.husniye)
  k._misafir.capa.peers.set(id(K.husniye), { role: 'ebeveyn', signPub: K.husniye.signKeyPair.publicKey })
  k.kaydet()
  k.kapat()
  k = ac(dizin)
  t.is(k.nesneler.misafir, null)
  t.ok(k.misafirAcilisHatasi, 'sebep: ' + k.misafirAcilisHatasi)
  k.kapat()
})

test('GUEST_REVOKED sonrası gelen görünüm iptali kaldırmaz; yalnız yeni tören kaldırır', (t) => {
  const dizin = geciciDizin(t, 'ma3')
  const L = anaDefter(17)
  const k = ac(dizin)
  const gv = GV.buildGuestView(L, id(C.misafir1), K.kerem)
  k.misafirBagla(gv, { toren: true })
  const L2 = anaDefter(17)
  const rev = misafirKaldir(L2, C.misafir1, [K.husniye])
  k.misafirIptal(GV.encodeGuestRevoked(L2.familyId, C.misafir1.memberId, rev, K.husniye))
  t.ok(k.nesneler.misafir.iptal)
  // REVOKE'u görmemiş ebeveyn aynı uzunlukta görünüm yollar
  k.misafirBagla(gv)
  t.ok(k.nesneler.misafir.iptal, 'iptal sürüyor')
  k.misafirBagla(gv, { toren: true })
  t.is(k.nesneler.misafir.iptal, null, 'yeni tören iptali kaldırır')
  k.kapat()
})

test('törenle gelen görünüm yalnız bu törende imzalanan GRANT\'ı taşıyorsa bağlanır; değilse iptal ve durum değişmez (Codex 4. tur)', (t) => {
  const dizin = geciciDizin(t, 'ma5')
  const L = anaDefter(17)
  const k = ac(dizin)
  const gv = GV.buildGuestView(L, id(C.misafir1), K.kerem)
  k.misafirBagla(gv, { toren: true })
  const L2 = anaDefter(17)
  const rev = misafirKaldir(L2, C.misafir1, [K.husniye])
  k.misafirIptal(GV.encodeGuestRevoked(L2.familyId, C.misafir1.memberId, rev, K.husniye))
  const onceki = k.nesneler.misafir
  let hataKodu = null
  try { k.misafirBagla(gv, { toren: true, grantHash: b4a.alloc(32, 1) }) } catch (err) { hataKodu = err.message }
  t.is(hataKodu, 'VIEW_NOT_FOR_CEREMONY')
  t.is(k.nesneler.misafir, onceki, 'durum değişmedi')
  t.ok(k.nesneler.misafir.iptal, 'iptal sürüyor')
  k.misafirBagla(gv, { toren: true, grantHash: onceki.gorunum.grantHash })
  t.is(k.nesneler.misafir.iptal, null, 'bu törende imzalanan GRANT: yeni tören iptali kaldırır')
  k.kapat()
})

test('misafir kuyruğu: sokete yazmak teslim sayılmaz; her yeni oturuma bir kez; 72 saatte düşer; taşma bildirilir', (t) => {
  const dizin = geciciDizin(t, 'ma4')
  const L = anaDefter(17)
  const saat = { t: TS0 + 1000 }
  const k = new Kalici({ dizin, testKipi: true, kimlik: C.misafir1, platform: 'test', now: () => saat.t })
  k.misafirBagla(GV.buildGuestView(L, id(C.misafir1), K.kerem), { toren: true })
  const giden = []
  const olaylar = []
  const es = new MisafirEsitleyici({ kalici: k, ag: { gonder: (p, type, b) => { giden.push(p); return true } }, olay: (ad, v) => olaylar.push(v) })
  const uye = id(K.kerem)
  es.baglandi(uye)
  t.ok(es.gonder({ type: Z.REC_OPS, bytes: b4a.from('aa', 'hex') }))
  t.is(giden.length, 1)
  es.bosalt()
  t.is(giden.length, 1, 'aynı oturuma ikinci kez gitmez')
  es.koptu(uye)
  es.baglandi(uye)
  t.is(giden.length, 2, 'yeni oturumda yeniden gider (kuyruktan çıkmamıştı)')
  saat.t += 72 * 3_600_000 + 1
  es.koptu(uye)
  es.baglandi(uye)
  t.is(giden.length, 2, '72 saat sonra düştü')
  es.koptu(uye)
  for (let i = 0; i < 257; i++) es.gonder({ type: Z.REC_OPS, bytes: b4a.from([i & 255, i >> 8]) })
  t.ok(olaylar.some((x) => x.durum === 'kuyruk-tasti' && x.atilan === 1), 'taşma bildirildi')
  k.kapat()
})

test('iptal bildirimi: misafirliği veren ebeveyn ayrılınca öbür ebeveyn açık misafir oturumuna GUEST_REVOKED yollar', (t) => {
  const { Esitleyici } = require('../synchronizer')
  const { ledger: { decodeEvent, encodeEvent } } = require('@havenfold/core')
  const dizin = geciciDizin(t, 'ma5')
  const L = anaDefter(17)
  const kopya = new Ledger({ now: () => TS0 })
  for (const e of L.events) kopya.apply(decodeEvent(encodeEvent(e)))
  const k = new Kalici({ dizin, testKipi: true, kimlik: K.husniye, platform: 'test', now: () => TS0 + 1000 })
  k.aileBagla(kopya)
  const giden = []
  const es = new Esitleyici({ kalici: k, ag: { gonder: (p, type, b) => { giden.push({ p, type, b }); return true } } })
  const mis = id(C.misafir1)
  es.baglandi(mis)
  const gorunum = GV.acceptGuestView(null, GV.buildGuestView(L, mis, K.kerem), C.misafir1.memberId)
  // Kerem (misafirliği veren) ayrılır
  const R = k.nesneler.ledger
  R.apply(olay(R, T.LEAVE, { memberId: K.kerem.memberId }, [K.kerem]))
  es.akit()
  const rev = giden.find((x) => x.p === mis && x.type === Z.GUEST_REVOKED)
  t.ok(rev, 'GUEST_REVOKED gitti')
  t.is(GV.verifyGuestRevoked(gorunum, rev.b).neden, 'ebeveyn-ayrildi', 'misafir doğrular')
  k.kapat()
})

test('iptal bildirimi (Codex 5. tur): cihaz değiştirmiş ebeveyn ayrılınca da GUEST_REVOKED gider', (t) => {
  const { Esitleyici } = require('../synchronizer')
  const { ledger: { decodeEvent, encodeEvent } } = require('@havenfold/core')
  const dizin = geciciDizin(t, 'ma6')
  const L = anaDefter(17)
  L.apply(rotate(L, K.kerem, K.yeniKerem, [K.yeniKerem, K.kerem, K.husniye]))
  const kopya = new Ledger({ now: () => TS0 })
  for (const e of L.events) kopya.apply(decodeEvent(encodeEvent(e)))
  const k = new Kalici({ dizin, testKipi: true, kimlik: K.husniye, platform: 'test', now: () => TS0 + 1000 })
  k.aileBagla(kopya)
  const giden = []
  const es = new Esitleyici({ kalici: k, ag: { gonder: (p, type, b) => { giden.push({ p, type, b }); return true } } })
  const mis = id(C.misafir1)
  es.baglandi(mis)
  // Misafirin elindeki görünüm halefin (yeniKerem) imzasıyla; GRANT'ın grantedBy'ı eski kimlik (kerem)
  const ilk = GV.acceptGuestView(null, GV.buildGuestView(anaDefter(17), mis, K.kerem), C.misafir1.memberId)
  const gorunum = GV.acceptGuestView(ilk, GV.buildGuestView(L, mis, K.yeniKerem), C.misafir1.memberId)
  const R = k.nesneler.ledger
  t.is(R.grants.get(mis).grantedBy, id(K.kerem))
  R.apply(olay(R, T.LEAVE, { memberId: K.yeniKerem.memberId }, [K.yeniKerem]))
  t.absent(R.grants.get(mis).active, 'misafirlik düştü')
  es.akit()
  const rev = giden.find((x) => x.p === mis && x.type === Z.GUEST_REVOKED)
  t.ok(rev, 'GUEST_REVOKED gitti')
  t.is(GV.verifyGuestRevoked(gorunum, rev.b).neden, 'ebeveyn-ayrildi', 'misafir doğrular')
  k.kapat()
})

// Codex 9. tur: misafirliğin süresi (GRANT expiresAt) oturum katmanında uygulanır: süre dolunca ebeveyn tarafında çift sırrı
// ve yeni görünüm yok; misafir tarafında çift sırrı yok, bırakma yapılmaz, yerel kuyruk ve küçük durum silinir
test('Codex 9. tur: misafirlik süresi dolunca oturum, görünüm ve bırakma biter; yerel veri silinir', (t) => {
  const { PairBook } = require('../../core/core/core/pairs')
  const L = anaDefter(17)
  const mis = id(C.misafir1)
  const g = L.grants.get(mis)
  t.ok(g && g.active && Number.isSafeInteger(g.expiresAt), 'misafirlik var')
  const saat = { t: g.expiresAt - 60_000 }
  const now = () => saat.t
  t.ok(new PairBook({ me: K.kerem, ledger: L, now }).get(mis), 'süre dolmadan çift sırrı')
  const gv = GV.buildGuestView(L, mis, K.kerem, { now })
  const k = new Kalici({ dizin: geciciDizin(t, 'ma7'), testKipi: true, kimlik: C.misafir1, platform: 'test', now: () => saat.t })
  k.misafirBagla(gv, { toren: true })
  const es = new MisafirEsitleyici({ kalici: k, ag: { gonder: () => true }, olay: () => {} })
  t.ok(new PairBook({ me: C.misafir1, ledger: k.nesneler.misafir.ledger, now }).get(id(K.kerem)), 'misafir tarafında çift sırrı')
  es.gonder({ type: Z.REC_OPS, bytes: b4a.from('aa', 'hex') })
  k.kaydet()
  t.is(k.misafirBitti(), null)
  t.is(k.nesneler.misafir.saklama.get('kuyruk').length, 1)
  saat.t = g.expiresAt
  const pb = new PairBook({ me: K.kerem, ledger: L, now })
  t.is(pb.get(mis), null, 'ebeveyn: süresi dolan misafirle çift sırrı yok')
  t.absent(pb.peers().some((p) => p.hex === mis))
  let hataKodu = null
  try { GV.buildGuestView(L, mis, K.kerem, { now }) } catch (err) { hataKodu = err.message }
  t.is(hataKodu, 'EXPIRED', 'yeni görünüm yok')
  t.is(new PairBook({ me: C.misafir1, ledger: k.nesneler.misafir.ledger, now }).get(id(K.kerem)), null, 'misafir: çift sırrı yok')
  t.is(k.misafirBitti(), 'suresi-doldu')
  hataKodu = null
  try { es.gonder({ type: Z.REC_OPS, bytes: b4a.from('bb', 'hex') }) } catch (err) { hataKodu = err.message }
  t.is(hataKodu, 'GUEST_ACCESS_ENDED')
  k.kaydet()
  t.absent(k.nesneler.misafir.saklama.get('kuyruk'), 'yerel kuyruk silindi')
  k.kapat()
})
