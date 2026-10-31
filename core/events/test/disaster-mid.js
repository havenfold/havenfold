// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D103: afet SOS'unda alıcı başına mid (RFC-0037 A2; RFC-0031 §6). Kayıt bütün alıcı mid'lerini afet_midler'de taşır;
// her alıcı kendi aldığı mid'i bulur. Vektör protocol/vectors/disaster-mid.json (elle yazıldı).
const test = require('brittle')
const b4a = require('b4a')
const Ol = require('..')
const S = require('../../../sdk')
const A = require('../../records/test/helpers/family')
const V = require('../../../protocol/vectors/disaster-mid.json')

const hex = (b) => b4a.toString(b, 'hex')
const TA = hex(A.K_TUM_AILE)
const durum = (no) => V.durumlar.find((d) => d.no === no)
const id = (k) => hex(k.memberId)

// Kerem ve üç alıcı (replika + EventApi)
function aile () {
  const now = () => A.TS0 + 3_600_000
  const L = A.anaDefter()
  const x = {}
  let ilk = true
  for (const [ad, kim] of [['kerem', A.K.kerem], ['husniye', A.K.husniye], ['irem', A.K.irem], ['ecem', A.K.ecem]]) {
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
  dagit()
  return { x, dagit }
}

// Alıcı afet mesajını aldı ve bildirim gösterdi (kimlik: afet mesajı)
const afetleAldi = (y, mid) => y.o.shouldNotifySos(mid, 'afet:' + mid)
// Kayıt geldi: vakanın bildirimi gösterilsin mi (Bildirimci'nin kullandığı liste ve kimlik)
function kayitBildirimi (y, sosRid) {
  const s = y.o.listSos(TA).find((k) => k.recordId === sosRid)
  return y.o.shouldNotifySos(s.afetMidler.length ? s.afetMidler : null, 'vaka:' + sosRid)
}

test('vektör 1: kayıt bütün alıcı mid\'lerini taşır; üç alıcıda da ikinci bildirim yok', (t) => {
  const { x, dagit } = aile()
  const alicilar = V.alicilar.map((a) => x[a])
  V.midler.forEach((m, i) => t.ok(afetleAldi(alicilar[i], m), 'afet bildirimi ' + V.alicilar[i]))
  const sos = x.kerem.o.writeSos(TA, { yol: 'afet', afetMidler: V.midler })
  dagit()
  const k = x.husniye.r.records(TA).find((r) => r.recordId === sos)
  t.alike(k.fields.afet_midler.map(hex), V.midler, 'afet_midler kayıtta')
  t.is(hex(k.fields.afet_mid), V.midler[0], 'eski alıcılar için afet_mid ilk mid')
  t.alike(alicilar.map((y) => kayitBildirimi(y, sos)), durum(1).kayitBildirimi, durum(1).aciklama)
  // Motorun vaka verisi ve Bildirimci: SOS vakasında üç mid de var; afetle almış alıcıda gösterilmez
  const v = x.husniye.o.cases(TA).find((d) => d.sos) || null
  const d = { vaka: 'aa'.repeat(16), subj: 'uye:' + id(A.K.kerem), sos: true, onem: 3, gecerli: [[3, 0]], sorumlu: [], okuyucular: [id(A.K.irem)], afetMid: V.midler[0], afetMidler: V.midler, ortakMid: null, sessiz: false }
  const b = x.irem.o.notifier({ me: id(A.K.irem) })
  t.alike(b.guncelle([d]), [], 'İrem: bildirim yok (kendi mid\'i b2 listede)')
  if (v) t.alike(v.afetMidler, V.midler, 'motorun vakası bütün mid\'leri taşır')
  else t.alike(Ol.sos.afetMidlerOf(k.fields), V.midler)
})

test('vektör 2, 3: eski biçimde yalnız ilk alıcı; afetle almayan alıcıya bildirim', (t) => {
  const { x, dagit } = aile()
  const alicilar = V.alicilar.map((a) => x[a])
  V.midler.forEach((m, i) => afetleAldi(alicilar[i], m))
  const sos = x.kerem.o.writeSos(TA, { yol: 'afet', afetMid: V.midler[0] })
  dagit()
  t.alike(alicilar.map((y) => kayitBildirimi(y, sos)), durum(2).kayitBildirimi, durum(2).aciklama)
  const { x: x2, dagit: d2 } = aile()
  const sos2 = x2.kerem.o.writeSos(TA, { yol: 'afet', afetMidler: V.midler })
  d2()
  t.alike([kayitBildirimi(x2.husniye, sos2)], durum(3).kayitBildirimi, durum(3).aciklama)
})

test('vektör 4: biçim denetimi', (t) => {
  const f = (liste) => Ol.sos.sosHatasi({ tf: { _subj: 'uye:' + 'ab'.repeat(16), afet_midler: liste }, yazar: 'uye', authorHex: 'ab'.repeat(16) })
  t.is(f([b4a.alloc(16, 1), b4a.alloc(16, 2)]), null)
  t.is(f([]), durum(4).hata, 'boş liste')
  t.is(f(Array.from({ length: Ol.sos.MAX_AFET_MID + 1 }, (_, i) => b4a.alloc(16, i))), durum(4).hata, '33 öğe')
  t.is(f([b4a.alloc(15)]), durum(4).hata, '15 bayt')
  t.is(Ol.sos.MAX_AFET_MID, V.alan.enCok)
})

// Codex 6. tur: başka üye SOS kaydına sonradan afet_midler/afet_mid/ortak_mid ekleyerek gerçek SOS'un bildirimini
// bastıramaz; bağlar SOS'u yazanın kaydı açan işleminden okunur
test('Codex 6. tur: başkasının eklediği afet mid\'i SOS bildirimini bastırmaz', (t) => {
  const { x, dagit } = aile()
  const gorulen = 'ee'.repeat(16) // Hüsniye'nin daha önce afetle gördüğü başka bir mid
  t.ok(afetleAldi(x.husniye, gorulen))
  const sos = x.kerem.o.writeSos(TA, { yol: 'afet', afetMidler: [V.midler[2]] })
  dagit()
  // İrem kaydın alanlarına görülmüş mid'i ekler (birleşmiş alanlar değişir, SOS'u yazan değişmez)
  x.irem.o.k.put(TA, sos, undefined, { afet_midler: [b4a.from(V.midler[2], 'hex'), b4a.from(gorulen, 'hex')], afet_mid: b4a.from(gorulen, 'hex'), ortak_mid: b4a.from(gorulen, 'hex') })
  dagit()
  const k = x.husniye.r.records(TA).find((r) => r.recordId === sos)
  t.alike(k.fields.afet_midler.map(hex), [V.midler[2], gorulen], 'birleşmiş alan değişti')
  const s = x.husniye.o.listSos(TA).find((y) => y.recordId === sos)
  t.alike([s.afetMidler, s.afetMid, s.ortakMid], [[V.midler[2]], V.midler[2], null], 'liste SOS\'u yazanın bağlarını gösterir')
  t.is(kayitBildirimi(x.husniye, sos), true, 'Hüsniye\'ye bildirim gösterilir')
  // Motorun SOS vakası (Bildirimci'nin girdisi) da: vakayı ve basamaklarını SOS'u yazan açar
  const sv = x.kerem.o.evaluate(TA).yeni.find((y) => y.alanlar.kaynak === 'cekirdek:hf.sos')
  t.ok(sv, 'motor SOS vakası önerdi')
  x.kerem.o.k.put(TA, null, 'hf.vaka', sv.alanlar)
  for (const [b, sira] of sv.basamaklar) x.kerem.o.k.put(TA, null, 'hf.vaka.basamak', Ol.vaka.basamakAlanlari(sv.alanlar.vaka, b, sira, A.TS0 + 3_600_000))
  dagit()
  const v = x.husniye.o.cases(TA).find((d) => d.sos)
  t.ok(v, 'Hüsniye\'de SOS vakası')
  t.alike([v.afetMidler, v.afetMid, v.ortakMid], [[V.midler[2]], V.midler[2], null], 'motorun vakası da yazanın bağlarını taşır')
})
