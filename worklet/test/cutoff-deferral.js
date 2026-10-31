// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// RFC-0027 §9 h (Mac, kol/kesim-erteleme): kasa kilitliyken üye çıkarılırsa kesim verilmez, ertelenir; ertelenen kesim
// kalıcıdır (yeniden başlatmada kaybolmaz), kilit açılınca o anki geçerli kümeyle bir kez verilir. Node ve Bare.
'use strict'
const test = require('brittle')
const b4a = require('b4a')
const { ledger: { T } } = require('@havenfold/core')
const A = require('../../core/records/test/helpers/family')
const { replikaGoruntusu, replikaKur, kodla, coz } = require('../persistence')

const hex = (b) => b4a.toString(b, 'hex')
const CID = hex(A.K_KASA)
const REC_CUTOFF = 0x88

function kur () {
  const L = A.anaDefter()
  const now = () => A.TS0 + 3_600_000
  const kerem = A.replika(L, A.K.kerem, { now })
  for (const ep of kerem.yetki.epochs(CID)) if (!kerem.keys.has(CID, ep.seq, ep.hash)) kerem.generateKey(CID, ep.seq)
  // Hüsniye kasayı kilitli tutar: kesimi erteler
  let kilitli = true
  const husniye = A.replika(L, A.K.husniye, { now, kesimErtele: (cid) => kilitli && cid === CID })
  A.teslim(kerem, husniye) // anahtarlar
  const rid = kerem.put(CID, null, 'yuva.defter.belge', { ad: 'Pasaport' })
  A.teslim(kerem, husniye) // Kerem'in kasa kaydı
  husniye.outbox.length = 0
  return { L, now, kerem, husniye, rid, ac: () => { kilitli = false }, kilitle: () => { kilitli = true } }
}

const kesimler = (r) => r.outbox.filter((m) => m.type === REC_CUTOFF)

test('kilitli kasada çıkarılan üyenin kesimi ertelenir, yeniden başlatmada korunur, kilit açılınca bir kez verilir', (t) => {
  const x = kur()
  t.ok(x.husniye.get(CID, x.rid), 'Hüsniye Kerem\'in kaydını görüyor')
  // Kerem'in ikinci kaydı çıkarılmadan önce yazılmış ama Hüsniye'ye ancak çıkarmadan sonra ulaşacak (RFC-0001 §8.3 kural 2)
  const gec = x.kerem.put(CID, null, 'yuva.defter.belge', { ad: 'Geç gelen' })
  const gecMesaj = x.kerem.outbox.splice(0).filter((m) => m.type === 0x81)
  // Kerem çıkarılır (telefonu kayıp); Hüsniye'nin kasası kilitli
  x.L.apply(A.olay(x.L, T.REMOVE_MEMBER, { memberId: A.K.kerem.memberId, reason: 'kayip', wipe: false }, [A.K.husniye, A.K.irem]))
  x.husniye.sync()
  for (const m of gecMesaj) x.husniye.receiveOp(m.bytes, m.kind || 0)
  t.alike(kesimler(x.husniye), [], 'kilitliyken kesim yok')
  t.is(x.husniye.ertelenenKesimler.size, 1, 'kesim ertelendi')
  t.absent(x.husniye.get(CID, x.rid), 'kesim olmadan çıkarılanın kaydı geçersiz (NOT_IN_CUTOFF)')

  // Yeniden başlatma: durum diske yazılır ve okunur (worklet replikaGoruntusu / replikaKur, JSON)
  let kilitli = true
  const g = coz(kodla(replikaGoruntusu(x.husniye)))
  t.alike(g.ertelenenKesimler, [...x.husniye.ertelenenKesimler], 'ertelenen kesim durumda')
  const h2 = replikaKur(g, { ledger: x.L, me: A.K.husniye, now: x.now, hlcYaz: () => {}, kesimErtele: (cid) => kilitli && cid === CID })
  t.is(h2.ertelenenKesimler.size, 1, 'yeniden başlatmada korundu')
  h2.sync()
  t.alike(kesimler(h2), [], 'açılışta (kilitli) hâlâ yok')

  // Kilit açılır: kesim o anki geçerli kümeyle verilir; ikinci kez verilmez
  kilitli = false
  t.is(h2.ertelenenKesimleriVer(), 1)
  const k = kesimler(h2)
  t.is(k.length, 1, 'kesim verildi')
  t.is(h2.ertelenenKesimler.size, 0)
  t.ok(h2.get(CID, x.rid), 'çıkarılanın kaydı yeniden geçerli')
  t.absent(h2.get(CID, gec), 'olaydan sonra gelen işlem ertelenen kesime de girmez (kural 2)')
  t.is(h2.ertelenenKesimleriVer(), 0, 'iki kez verilmez')
  h2.sync()
  t.is(kesimler(h2).length, 1, 'eşitleme de yeniden vermez')
  // Yeniden başlatmada da: verilen kesim verilenKesimler'de, ertelenen yok (çıkış gönderildi)
  h2.outbox.length = 0
  const g2 = coz(kodla(replikaGoruntusu(h2)))
  t.alike(g2.ertelenenKesimler, [])
  const h3 = replikaKur(g2, { ledger: x.L, me: A.K.husniye, now: x.now, hlcYaz: () => {}, kesimErtele: () => false })
  h3.sync()
  t.is(h3.ertelenenKesimleriVer(), 0)
  t.alike(kesimler(h3).length, 0)
  t.ok(h3.get(CID, x.rid), 'kesim parçası durumda: kayıt geçerli kalır')
})

test('kesim ertelenmeyen (açık ya da kasa olmayan) koleksiyonda eskisi gibi hemen verilir; bozuk ertelenen listesi STATE_CORRUPT', (t) => {
  const x = kur()
  x.ac()
  x.L.apply(A.olay(x.L, T.REMOVE_MEMBER, { memberId: A.K.kerem.memberId, reason: 'kayip', wipe: false }, [A.K.husniye, A.K.irem]))
  x.husniye.sync()
  t.ok(kesimler(x.husniye).length >= 1, 'açıkken hemen verilir')
  t.is(x.husniye.ertelenenKesimler.size, 0)
  const g = coz(kodla(replikaGoruntusu(x.husniye)))
  g.ertelenenKesimler = [['a|b|1|c', [5]]]
  let hata = null
  try { replikaKur(g, { ledger: x.L, me: A.K.husniye, now: x.now, hlcYaz: () => {} }) } catch (err) { hata = err.message }
  t.is(hata, 'STATE_CORRUPT')
  delete g.ertelenenKesimler // eski durum (alan yok) açılır
  t.is(replikaKur(g, { ledger: x.L, me: A.K.husniye, now: x.now, hlcYaz: () => {} }).ertelenenKesimler.size, 0)
})
