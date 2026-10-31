// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D102: RFC-0037 §5.3 ve §12 — worklet SOS alındısını kendisi yazar (kalici.kaydet), yalnız bu cihazda hf.sos'u bildiren
// uygulamaysa (vektör 8; sosBildiren verilmezse her kimlik); yeni geçerli alındı uygulamaya 'sos-received' olayıyla gider.
// hf.uygulama kaydı 'sos-alindi' yeteneğini bildirir (protokol değeri; vektördeki yetenek).
'use strict'
const test = require('brittle')
const S = require('@havenfold/sdk')
const { uygulama: U } = require('@havenfold/records')
const A = require('../../core/records/test/helpers/family')
const { geciciDizin, kaliciAc } = require('./helpers/common')
const V = require('../../protocol/vectors/sos-receipt.json')

const TA = A.hex(A.K_TUM_AILE)
const durum = (no) => V.durumlar.find((d) => d.no === no)

// Hüsniye'nin çekirdeği (Kalici) ve Kerem'in replikası; Kerem SOS yazar, işlem Hüsniye'ye ulaşır
function kur (t, o = {}) {
  const now = () => A.TS0 + 3_600_000
  const L = A.anaDefter()
  const olaylar = []
  const k = kaliciAc({ dizin: geciciDizin(t), now, kimlik: A.K.husniye, appId: 'yuva-acil', olay: (ad, veri) => olaylar.push([ad, veri]), ...o })
  const n = k.aileBagla(A.kopya(L))
  const rK = A.replika(A.kopya(L), A.K.kerem, { now })
  for (let i = 0; i < 2; i++) { A.teslim(n.replika, rK); A.teslim(rK, n.replika); n.replika.sync(); rK.sync() }
  const ol = new S.EventApi({ kayit: new S.RecordApi({ replika: rK }), now })
  const sos = ol.writeSos(TA, {})
  A.teslim(rK, n.replika)
  return { k, n, rK, ol, sos, olaylar }
}

const alindilar = (n) => n.replika.records(TA).filter((r) => r.type === 'hf.sos.alindi')

test('vektör 8: bildiren uygulama bu kimlik değilse yazmaz; yerel kanal yoksa (sosBildiren yok) yazar', (t) => {
  const b = kur(t, { sosBildiren: (familyId) => { t.is(familyId.length, 64); return false } })
  b.k.kaydet()
  t.is(alindilar(b.n).length, 0, durum(8).aciklama)
  // Gönderen tarafta alındı yokken: Hüsniye'nin tek kimliği yeteneği bildirdiği için 'bekliyor' (bilinmiyor değil); defterdeki
  // yetenek değeri okuyanın beklediğinden farklıysa (Codex 11. tur: 'sos-received') burada düşer
  A.teslim(b.n.replika, b.rK)
  t.is(b.ol.sosRecipients(TA, b.sos).find((x) => x.personId === A.hex(A.K.husniye.memberId)).durum, 'bekliyor', 'teslimden önce bekliyor')
  const a = kur(t)
  a.k.kaydet()
  t.is(alindilar(a.n).length, 1, 'sosBildiren verilmedi: yazar')
  t.is(A.hex(alindilar(a.n)[0].fields.sos), a.sos)
  a.k.kaydet()
  t.is(alindilar(a.n).length, 1, 'ikinci kayıtta yazmaz')
  // hf.uygulama yeteneği
  const h = U.kayitlar(a.n.replika).get(A.hex(A.K.husniye.memberId))
  t.alike(h.yetenek, [V.yetenek.deger], 'defterdeki yetenek protokol değeri: ' + V.yetenek.deger)
})

test('sos-received olayı: yeni geçerli alındı uygulamaya; ilk açılışta var olanlar olay üretmez', (t) => {
  const a = kur(t)
  a.k.kaydet()
  const ol = a.olaylar.filter(([ad]) => ad === 'sos-received')
  t.alike(ol, [['sos-received', { collectionId: TA, sos: a.sos, personId: A.hex(A.K.husniye.memberId) }]], 'kendi alındısı (aile ekranı da günceller)')
  // Gönderen tarafta: Kerem'in replikası alındıyı alır, sosAlicilari aldı der
  A.teslim(a.n.replika, a.rK)
  const satir = a.ol.sosRecipients(TA, a.sos).find((x) => x.personId === A.hex(A.K.husniye.memberId))
  t.is(satir.durum, 'aldi')
  const n0 = a.olaylar.length
  a.k.kaydet()
  t.is(a.olaylar.filter(([ad]) => ad === 'sos-received').length, ol.length, 'aynı alındı ikinci kez yayılmaz')
  t.ok(a.olaylar.length >= n0)
})

// Codex 6. tur: SOS işlemi anahtarından (REC_KEY) önce gelirse anahtar gelince alındı yine yazılır (işlem sayısı değişmez,
// kayıt görünüme sonradan girer). Anahtarın geç gelişi Hüsniye'nin anahtar deposundan dönem anahtarı çıkarılıp sonra
// geri verilerek (receiveKey'in yaptığı: anahtar eklenir, _afterKeys bekleyen işlemleri çözer) canlandırılır
test('Codex 6. tur: anahtar SOS\'tan sonra gelince alındı yazılır', (t) => {
  const now = () => A.TS0 + 3_600_000
  const L = A.anaDefter()
  const k = kaliciAc({ dizin: geciciDizin(t), now, kimlik: A.K.husniye, appId: 'yuva-acil' })
  const n = k.aileBagla(A.kopya(L))
  const rK = A.replika(A.kopya(L), A.K.kerem, { now })
  for (let i = 0; i < 2; i++) { A.teslim(n.replika, rK); A.teslim(rK, n.replika); n.replika.sync(); rK.sync() }
  k.kaydet()
  const sakla = [...n.replika.keys.epochs].filter(([, e]) => e.cid === TA)
  t.ok(sakla.length > 0)
  for (const [x] of sakla) n.replika.keys.epochs.delete(x)
  const sos = new S.EventApi({ kayit: new S.RecordApi({ replika: rK }), now }).writeSos(TA, {})
  A.teslim(rK, n.replika, [0x81])
  k.kaydet()
  t.absent(n.replika.records(TA).some((r) => r.recordId === sos), 'SOS henüz çözülmedi')
  t.is(alindilar(n).length, 0)
  for (const [x, e] of sakla) n.replika.keys.epochs.set(x, e)
  n.replika._afterKeys(TA) // anahtar geldi
  t.ok(n.replika.records(TA).some((r) => r.recordId === sos), 'SOS görünümde')
  k.kaydet()
  t.is(alindilar(n).length, 1, 'alındı yazıldı')
  t.is(A.hex(alindilar(n)[0].fields.sos), sos)
})

// Codex 7. tur: SOS işlemi kesim (REC_CUTOFF) gelene kadar geçersiz kalıp sonra geçerli olursa da alındı yazılır. Kesimin
// etkisi (receiveCutoff → _evaluate: durum 'haric' → 'gecerli') işlemin durumu değiştirilerek canlandırılır
test('Codex 7. tur: kesimle geçerli hâle gelen SOS için alındı yazılır', (t) => {
  const a = kur(t)
  const o = [...a.n.replika.ops.values()].find((x) => x.inner && x.cid === TA && A.hex(x.inner.recordId) === a.sos)
  t.ok(o, 'SOS işlemi')
  o.status = 'haric'
  o.code = 'NOT_IN_CUTOFF'
  a.k.kaydet()
  t.absent(a.n.replika.records(TA).some((r) => r.recordId === a.sos), 'SOS kesim beklerken görünmez')
  t.is(alindilar(a.n).length, 0)
  o.status = 'gecerli' // kesim geldi
  o.code = null
  t.ok(a.n.replika.records(TA).some((r) => r.recordId === a.sos))
  a.k.kaydet()
  t.is(alindilar(a.n).length, 1, 'alındı yazıldı')
})
