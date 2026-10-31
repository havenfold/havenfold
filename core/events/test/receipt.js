// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D102: RFC-0037 §16 vektör 1–7, 9–15 — SOS'ta kişi başına teslim. Ana zincir (ledger-v21: Kerem ve Hüsniye ebeveyn,
// İrem yetişkin, Ecem çocuk, kutu; Tüm Aile) üstünde bellek içi replikalar ve SDK EventApi. Yazma tetiği worklet'in
// yaptığı gibi elle çağrılır (tetik). Beklenenler protocol/vectors/sos-receipt.json'dan (RFC'den elle yazıldı).
// Vektör 8 (bildiren uygulama) worklet/test/sos-receipt.js'te.
const test = require('brittle')
const b4a = require('b4a')
const { ledger: { T, decodeEvent, encodeEvent } } = require('@havenfold/core')
const { uygulama: U, birlestir: { reduceAll } } = require('@havenfold/records')
const Al = require('../receipt')
const { sinifaUyar } = require('../../records/class')
const S = require('../../../sdk')
const A = require('../../records/test/helpers/family')
const { E } = require('../../records/test/helpers/multi-vector')
const V = require('../../../protocol/vectors/sos-receipt.json')

const hex = (b) => b4a.toString(b, 'hex')
const TA = hex(A.K_TUM_AILE)
const DK = 60_000
const durum = (no, i = 0) => V.durumlar.filter((d) => d.no === no)[i]
const id = (k) => hex(k.memberId)

// Aile: kimlik başına replika ve EventApi; dagit bütün çıkışları herkese verir; defter olayı herkese uygular
function aile (kimler, L = A.anaDefter()) {
  const saat = { t: A.TS0 + 3_600_000 }
  const now = () => saat.t
  const x = {}
  let ilk = true
  for (const [ad, kim] of Object.entries(kimler)) {
    const r = A.replika(ilk ? L : A.kopya(L), kim, { now })
    ilk = false
    x[ad] = { r, kim, o: new S.EventApi({ kayit: new S.RecordApi({ replika: r }), now }) }
  }
  const hepsi = Object.values(x).map((y) => y.r)
  const dagit = () => {
    for (let i = 0; i < 4; i++) {
      for (const a of hepsi) {
        a.sync()
        const msgs = a.outbox.splice(0)
        for (const b of hepsi) if (b !== a) { a.outbox.push(...msgs); A.teslim(a, b) }
      }
    }
  }
  const defter = (type, body, imz) => {
    const e = A.olay(hepsi[0].ledger, type, body, imz)
    for (const r of hepsi) r.ledger.apply(decodeEvent(encodeEvent(e)))
    dagit()
  }
  // Worklet'in yazma tetiği (kalici._sosAlindi): yazılacak alındılar şimdi
  const tetik = (ad) => {
    const r = x[ad].r
    const yaz = Al.yazilacaklar(r, TA, { now: now() })
    for (const sos of yaz) r.put(TA, null, Al.TUR, Al.alindiAlanlari(r.meHex, sos, now()))
    return yaz
  }
  dagit()
  return { x, dagit, defter, tetik, saat, now }
}

const satir = (liste, kim) => liste.find((y) => y.personId === id(kim)) || null

test('katalog: hf.sos.alindi ve hf.uygulama.yetenek', (t) => {
  const kat = require('@havenfold/core/protocol/event-types.json').turler
  const k = kat.find((y) => y.tur === V.tur.tur)
  t.alike([k.olay, k.yazar, k.koleksiyon, k.keep], [V.tur.olay, V.tur.yazar, V.tur.koleksiyon, V.tur.keep])
  t.alike(k.alanlar.map((a) => [a.ad, a.deger]), [['sos', 'bytes']])
  t.ok(kat.find((y) => y.tur === V.yetenek.tur).alanlar.some((a) => a.ad === V.yetenek.alan && a.deger === 'list'))
  t.is(Al.YETENEK, V.yetenek.deger)
  t.is(Al.YAZMA_MS, V.sureler.yazmaMs)
  t.is(Al.KEEP_GUN, V.sureler.keepGun)
})

test('vektör 1, 2: alıcı bir kez yazar; gönderende aldı, bekliyor, bilinmiyor', (t) => {
  const { x, dagit, tetik, saat } = aile({ kerem: A.K.kerem, hus: A.K.husniye, irem: A.K.irem, ecem: A.K.ecem })
  U.kendiKaydiniYaz(x.irem.r, 'yuva-defteri', [Al.YETENEK])
  U.kendiKaydiniYaz(x.hus.r, 'yuva-acil', [Al.YETENEK])
  const sos = x.kerem.o.writeSos(TA, {})
  dagit()
  saat.t += DK
  t.alike(tetik('hus'), [sos], durum(1).aciklama)
  t.is(tetik('hus').length, durum(1).ikinci, 'ikinci kez yazılmaz (kuyrukta ya da görünümde)')
  dagit()
  const k = x.kerem.r.records(TA).find((y) => y.type === Al.TUR)
  t.is(k.fields._subj, 'uye:' + id(A.K.husniye))
  t.is(hex(k.fields.sos), sos)
  t.is(k.fields._keep, 7)
  t.is(tetik('hus').length, 0, 'yeniden başlatmada da (görünümde var)')
  const l = x.kerem.o.sosRecipients(TA, sos)
  t.alike(l.map((y) => y.personId).sort(), [id(A.K.husniye), id(A.K.irem), id(A.K.ecem)].sort(), 'gönderen ve kutu alıcı değil')
  const b = durum(2).beklenen
  t.alike(satir(l, A.K.husniye), { personId: id(A.K.husniye), durum: b.husniye, at: saat.t, yol: 'kayit' })
  t.is(satir(l, A.K.irem).durum, b.irem)
  t.is(satir(l, A.K.ecem).durum, b.ecem)
  t.alike(x.irem.o.sosRecipients(TA, sos).map((y) => y.durum).sort(), l.map((y) => y.durum).sort(), 'SOS\'u okuyabilen herkes görür (K3)')
  t.exception(() => x.kerem.o.sosRecipients(TA, k.recordId), /NO_RECORD/)
})

test('vektör 3, 4: başkası adına alındı ve başkasının alındısına put sayılmaz; cihaz ve kutu uymaz', (t) => {
  const { x, dagit, tetik, saat } = aile({ kerem: A.K.kerem, hus: A.K.husniye, irem: A.K.irem })
  const sos = x.kerem.o.writeSos(TA, {})
  dagit()
  x.irem.r.put(TA, null, Al.TUR, { ...Al.alindiAlanlari(id(A.K.husniye), sos, saat.t) })
  dagit()
  t.is(satir(x.kerem.o.sosRecipients(TA, sos), A.K.husniye).durum !== 'aldi', true, durum(3).aciklama)
  t.is(satir(x.kerem.o.sosRecipients(TA, sos), A.K.irem).durum !== 'aldi', true, 'İrem de sayılmaz (_subj kendisi değil)')
  saat.t += DK
  tetik('hus')
  dagit()
  const at = satir(x.kerem.o.sosRecipients(TA, sos), A.K.husniye).at
  const rid = x.kerem.r.records(TA).find((y) => y.type === Al.TUR && y.fields._subj === 'uye:' + id(A.K.husniye)).recordId
  saat.t += DK
  x.irem.r.put(TA, rid, '', { _t: A.TS0 })
  x.irem.r.del(TA, rid)
  dagit()
  t.is(satir(x.kerem.o.sosRecipients(TA, sos), A.K.husniye).at, at, 'başkasının put ve del\'i görünümü değiştirmez')
  const ops = x.kerem.r.validOps(TA).filter((o) => hex(o.inner.recordId) === rid)
  const st = reduceAll(ops).values().next().value
  for (const rol of durum(4).roller) t.is(sinifaUyar(Al.TUR, rol, ops[0], st), durum(4).beklenen, rol)
})

test('vektör 5: sessiz SOS — kimse yazmaz, dışarıdan yazılan sayılmaz', (t) => {
  const { x, dagit, tetik, saat } = aile({ kerem: A.K.kerem, hus: A.K.husniye })
  const sos = x.kerem.o.writeSos(TA, { yol: 'zorlama-pin', sessiz: true })
  dagit()
  saat.t += DK
  t.is(tetik('hus').length, durum(5).yazilacak)
  x.hus.r.put(TA, null, Al.TUR, Al.alindiAlanlari(id(A.K.husniye), sos, saat.t))
  dagit()
  t.is(x.kerem.o.sosRecipients(TA, sos).filter((y) => y.durum === 'aldi').length, durum(5).aldi)
})

// Düzey 2.2 ve Kerem'in ek kimliği (APP_ATTACH, RFC-0017)
function ekKimlikli () {
  const a = aile({ kerem: A.K.kerem, defter: E.keremDefter, hus: A.K.husniye })
  a.defter(T.PROTOCOL_LEVEL, { level: '2.2' }, [A.K.kerem])
  a.defter(T.APP_ATTACH, { deviceCert: E.keremDefter.deviceCert, personId: A.K.kerem.memberId, appId: 'yuva-defteri', sameDevice: true, replaces: null, ceremonyTranscriptHash: b4a.alloc(32, 7) }, [E.keremDefter, A.K.kerem])
  return a
}

test('vektör 6, 9: gönderenin ek kimliği yazmaz ve sayılmaz; kişinin iki kimliği tek satır, en erken zaman', (t) => {
  const { x, dagit, tetik, saat } = ekKimlikli()
  const sos = x.kerem.o.writeSos(TA, {})
  dagit()
  t.is(tetik('defter').length, durum(6).yazilacak, durum(6).aciklama)
  x.defter.r.put(TA, null, Al.TUR, Al.alindiAlanlari(id(E.keremDefter), sos, saat.t))
  dagit()
  const kerem = x.hus.r.ledger.personIdOf(id(A.K.kerem))
  t.absent(x.hus.o.sosRecipients(TA, sos).some((y) => y.personId === kerem), 'gönderen kişi listede yok')
  t.absent(x.hus.o.sosRecipients(TA, sos).some((y) => y.durum === 'aldi'), 'ek kimliğin alındısı sayılmaz')
  // Hüsniye'nin SOS'u: Kerem'in iki kimliği de yazar
  const sos2 = x.hus.o.writeSos(TA, {})
  dagit()
  saat.t += DK
  tetik('defter')
  const ilk = saat.t
  saat.t += DK
  tetik('kerem')
  dagit()
  const l = x.hus.o.sosRecipients(TA, sos2).filter((y) => y.personId === kerem)
  t.is(l.length, durum(9).satir, durum(9).aciklama)
  t.alike([l[0].durum, l[0].at], ['aldi', ilk])
  t.is(x.hus.r.records(TA).filter((y) => y.type === Al.TUR && hex(y.fields.sos) === sos2).length, 2, 'iki kayıt')
})

test('vektör 7, 10: aynı afet/ortak mid\'li iki SOS ikisine de; 24 saatten eski ve kapalı vaka yazmaz, sahipli yazar', (t) => {
  const { x, dagit, tetik, saat } = aile({ kerem: A.K.kerem, hus: A.K.husniye, irem: A.K.irem })
  const mid = 'ab'.repeat(16)
  const s1 = x.kerem.o.writeSos(TA, { afetMid: mid, ortakMid: 'cd'.repeat(16) })
  const s2 = x.kerem.o.writeSos(TA, { afetMid: mid, ortakMid: 'cd'.repeat(16) })
  dagit()
  t.alike(tetik('hus'), [s1, s2].sort(), durum(7).aciklama)
  // Eski SOS
  const eski = x.irem.o.writeSos(TA, { t: saat.t - Al.YAZMA_MS - DK })
  dagit()
  t.absent(tetik('hus').includes(eski), '24 saatten eski')
  // Kapalı vaka: Hüsniye motorun önerdiği SOS vakasını yazar, Kerem kapatır
  const s3 = x.irem.o.writeSos(TA, {})
  dagit()
  const vaka = (yazan, sos) => {
    const s = yazan.o.evaluate(TA)
    const y = s.yeni.find((v) => (v.alanlar.olaylar || []).map((z) => (typeof z === 'string' ? z : hex(z))).includes(sos))
    yazan.r.put(TA, null, 'hf.vaka', y.alanlar)
    dagit()
    return hex(y.alanlar.vaka)
  }
  const v3 = vaka(x.hus, s3)
  x.kerem.o.close(TA, v3, 'yanlis')
  dagit()
  t.absent(tetik('kerem').includes(s3), 'kapalı vaka')
  const s4 = x.hus.o.writeSos(TA, {})
  dagit()
  const v4 = vaka(x.irem, s4)
  x.irem.o.claim(TA, v4)
  dagit()
  t.ok(tetik('kerem').includes(s4), 'sahipli vaka')
})

test('vektör 11: kayıt alanları (ortak_mid yok); alındı aile örneği başına (kayıt yalnız kendi koleksiyonunda)', (t) => {
  const { x, dagit, tetik } = aile({ kerem: A.K.kerem, hus: A.K.husniye })
  const sos = x.kerem.o.writeSos(TA, { ortakMid: 'cd'.repeat(16) })
  dagit()
  tetik('hus')
  dagit()
  const k = x.kerem.r.records(TA).find((y) => y.type === Al.TUR)
  t.alike(Object.keys(k.fields).sort(), durum(11).alanlar)
  t.is(hex(k.fields.sos), sos)
})

test('vektör 12: afet ALINDI\'sı kayıt alındısıyla birleşir (sosYaz afetMidler, yerel)', (t) => {
  const { x, dagit, tetik, saat } = aile({ kerem: A.K.kerem, hus: A.K.husniye })
  const giden = new Map() // mid → { kimlik, alindi, at }
  const r = x.kerem.r
  const o = new S.EventApi({ kayit: new S.RecordApi({ replika: r }), now: () => saat.t, afet: { receiptOf: (mid) => giden.get(mid) || null } })
  // Sahte yüzey gerçek DisasterApi'ninkiyle aynı ad (Codex 12. tur: EventApi eski alindiOf'u çağırıyordu)
  t.is(typeof S.DisasterApi.prototype.receiptOf, 'function')
  const mid = '11'.repeat(16)
  giden.set(mid, { kimlik: id(A.K.husniye), alindi: false, at: null })
  const sos = o.writeSos(TA, { afetMidler: [mid] })
  t.is(satir(o.sosRecipients(TA, sos), A.K.husniye).durum !== 'aldi', true, 'ALINDI yokken')
  const afetAni = saat.t + 30_000
  giden.set(mid, { kimlik: id(A.K.husniye), alindi: true, at: afetAni })
  t.alike(satir(o.sosRecipients(TA, sos), A.K.husniye), { personId: id(A.K.husniye), durum: 'aldi', at: afetAni, yol: 'afet' })
  dagit()
  saat.t += 5 * DK
  tetik('hus')
  dagit()
  const s = o.sosRecipients(TA, sos).filter((y) => y.personId === id(A.K.husniye))
  t.is(s.length, 1, 'tek satır')
  t.ok(x.kerem.r.records(TA).some((y) => y.type === Al.TUR), 'kayıt alındısı da var')
  t.alike([s[0].durum, s[0].at, s[0].yol], ['aldi', afetAni, 'afet'], 'en erken zaman (afet önce)')
  t.exception(() => o.writeSos(TA, { afetMidler: ['xyz'] }), /INVALID_BODY/)
})

test('vektör 13: gelecekteki _t sayılmaz; SOS\'tan önceki _t SOS anına çekilir', (t) => {
  const { x, dagit, saat } = aile({ kerem: A.K.kerem, hus: A.K.husniye, irem: A.K.irem })
  const sos = x.kerem.o.writeSos(TA, {})
  dagit()
  x.hus.r.put(TA, null, Al.TUR, Al.alindiAlanlari(id(A.K.husniye), sos, saat.t + 6 * DK))
  x.irem.r.put(TA, null, Al.TUR, Al.alindiAlanlari(id(A.K.irem), sos, saat.t - 10 * DK))
  dagit()
  const l = x.kerem.o.sosRecipients(TA, sos)
  t.not(satir(l, A.K.husniye).durum, 'aldi', '_t > hlc + 5 dk')
  t.alike([satir(l, A.K.irem).durum, satir(l, A.K.irem).at], ['aldi', saat.t], 'at = sos._t')
})

test('vektör 14, 15: sınıfsız birleştirme hata vermez; 7 gün sonra alındı temizlenir, SOS kalır', (t) => {
  const { x, dagit, tetik, saat } = aile({ kerem: A.K.kerem, hus: A.K.husniye })
  U.kendiKaydiniYaz(x.hus.r, 'yuva-acil', [Al.YETENEK])
  const sos = x.kerem.o.writeSos(TA, {})
  dagit()
  tetik('hus')
  dagit()
  const ops = x.kerem.r.validOps(TA)
  t.ok([...reduceAll(ops).values()].some((st) => st.type === Al.TUR), 'yazar sınıfını bilmeyen birleştirme alındıyı görür')
  t.ok(ops.every((o) => x.kerem.r.status(hex(o.opId)).status === 'gecerli'))
  t.is(satir(x.kerem.o.sosRecipients(TA, sos), A.K.husniye).durum, 'aldi')
  saat.t += 8 * 86_400_000
  x.kerem.o.write(TA, 'hf.sos', { subj: 'uye:' + id(A.K.kerem) }) // M ilerlesin (temizlik koleksiyondaki son işleme göre)
  x.kerem.r.temizle()
  t.ok(x.kerem.r.records(TA).some((y) => y.recordId === sos), 'SOS kalır (365 gün)')
  t.absent(x.kerem.r.records(TA).some((y) => y.type === Al.TUR), 'alındı temizlendi')
  t.is(satir(x.kerem.o.sosRecipients(TA, sos), A.K.husniye).durum, 'bekliyor')
})
