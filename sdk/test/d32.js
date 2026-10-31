// SPDX-License-Identifier: Apache-2.0
// D32: Yuva Defteri'nin istekleri (kol/defter L-durum L20, kol/defter-air A-durum). Beklenenler elle yazıldı.
const test = require('brittle')
const b4a = require('b4a')
const S = require('..')
const A = require('../../core/records/test/helpers/family')

const hex = (b) => b4a.toString(b, 'hex')
const id = (k) => hex(k.memberId)
const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const TA = hex(A.K_TUM_AILE)

test('L20 a: Bakım Masası Sağlık: koleksiyonları yanında öbür koleksiyonlardaki ilaç sahiplerini de gösterir', (t) => {
  const L = A.anaDefter()
  const kayit = new S.RecordApi({ replika: A.replika(L, A.K.husniye) })
  const bakim = new S.CareDeskApi({ kayit, olay: new S.EventApi({ kayit }), now: () => A.TS0 + 3_600_000 })
  kayit.put(TA, null, 'yuva.defter.ilac', { kisi: 'uye:' + id(A.K.ecem), baslik: 'Şurup', saatler: ['08:00'] })
  kayit.put(TA, null, 'yuva.defter.ilac', { kisi: 'uye:' + id(A.K.ecem), baslik: 'Vitamin', saatler: ['20:00'] })
  const d = bakim.status()
  t.is(d.kisiler.length, 1, 'aynı kişi ve koleksiyon bir kez')
  t.alike([d.kisiler[0].personId, d.kisiler[0].collectionId, d.kisiler[0].koleksiyonAdi, d.kisiler[0].kasaGibi], [id(A.K.ecem), TA, 'Tüm Aile', false])
  t.ok(d.kisiler[0].gorenler.includes(id(A.K.irem)), 'rol tabanlı okuyucular da görenler arasında')
})

test('L20 b: güvenlik kelimesinin kasa koleksiyonu; okuyucular değişir; KRA koşulu', (t) => {
  const L = A.anaDefter()
  const now = () => A.TS0 + 60_000
  const kerem = new S.ShieldApi({ kayit: new S.RecordApi({ replika: A.replika(L, A.K.kerem) }), defter: new S.LedgerApi({ ledger: L, me: A.K.kerem, now }), now })
  const r = kerem.wordCollection({ cocuklarOkur: false })
  t.is(r.durum, 'oneri', 'kasa: bütün ebeveynler imzalar')
  const d2 = new S.LedgerApi({ ledger: L, me: A.K.husniye, now })
  t.is(d2.sign(d2.oneriler.add(r.event, A.TS0 + 60_000)).durum, 'uygulandi')
  const k = kerem.wordStatus()
  t.alike([k.okuyucuKisi, k.kraKurulur, k.cocuklarOkur], [3, true, false], 'iki ebeveyn ve bir yetişkin')
  const col = L.collections.get(k.collectionId)
  t.alike([col.name, col.sensitivity, col.taskAccess, col.readers], ['Kalkan', 'kasa', false, ['rol:ebeveyn', 'rol:yetiskin']])
  const r2 = kerem.wordCollection({ cocuklarOkur: true })
  t.is(d2.sign(d2.oneriler.add(r2.event, A.TS0 + 60_000)).durum, 'uygulandi')
  t.alike([kerem.wordStatus().okuyucuKisi, kerem.wordStatus().cocuklarOkur], [4, true])
})

test('L20 c: kişisel modda kayıt komutları PersonalMode\'a (RecordApi yüzü, tek koleksiyon)', (t) => {
  const km = new S.PersonalMode({ now: () => A.TS0 })
  const k = km.kayitApi()
  t.alike(k.collections(), [], 'başlamadan koleksiyon yok')
  km.start()
  const cid = k.collections()[0].collectionId
  t.is(cid, S.PERSONAL_MODE_COLLECTION)
  const rid = k.put(cid, null, 'yuva.defter.not', { baslik: 'Wifi' })
  k.put(cid, rid, '', { sifre: '1' })
  t.alike(k.get(cid, rid).fields, { baslik: 'Wifi', sifre: '1' })
  t.is(k.query(cid, { type: 'yuva.defter.not' }).length, 1)
  t.is(hataOf(() => k.get(TA, rid)), 'NO_COLLECTION')
  k.del(cid, rid)
  t.is(k.get(cid, rid), null)
})

test('L20 d: tören sas olayında karşı tarafın adı ve cihazı', async (t) => {
  const o = new S.Emitter()
  o.confirm = () => {}
  o.cancel = () => {}
  const tr = new S.CeremonyApi({ ledger: A.anaDefter(), me: A.K.kerem, tasiyici: { davet: async () => o } })
  const ol = []
  tr.on('ceremony', (x) => ol.push(x))
  await tr.startInvite('uye', 'cocuk')
  o.emit('sas', { resimler: ['a', 'b', 'c', 'd', 'e'], karsiAd: 'Noor', karsiCihaz: 'iPhone' })
  t.alike(ol[0], { adim: 'sas', resimler: ['a', 'b', 'c', 'd', 'e'], karsiAd: 'Noor', karsiCihaz: 'iPhone', aileAdi: null }) // aileAdi: RFC-0036 (D97)
  tr.cancel()
})

test('L20 e: Kalkan para isteyen mesaj sorusu yerel kanaldan; Yuva Hat yoksa bilinmiyor', async (t) => {
  const sorular = []
  const y = new S.LocalApi({ kanal: { var: () => true, birak: () => {}, sor: async (q) => { sorular.push(q); return 'var' } } })
  t.is(await y.moneyRequestMessage(id(A.K.irem)), 'var')
  t.alike(sorular, [{ v: 1, tur: 'para_istegi', personId: id(A.K.irem), gun: 3 }])
  t.is(await new S.LocalApi({ kanal: { var: () => true, birak: () => {} } }).moneyRequestMessage(id(A.K.irem)), 'bilinmiyor', 'soru kancası yok')
  t.is(await new S.LocalApi().moneyRequestMessage(id(A.K.irem)), 'bilinmiyor')
  t.is(await new S.LocalApi({ kanal: { var: () => true, birak: () => {}, sor: async () => { throw new Error('x') } } }).moneyRequestMessage(id(A.K.irem)), 'bilinmiyor')
})
