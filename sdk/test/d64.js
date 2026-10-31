// SPDX-License-Identifier: Apache-2.0
// D64: team.js'in kalan dalları — kurucu ve kuruluş bekçileri, varsayılan yer türü, öneriyle uygulanan rol değişiminin
// bekleyen süresi (geçici olmayan rol, bozuk gövde, süresi aşılmış öneri), kimliksiz defter, eski kopyada çıkış, platform
// kancasının boş dönüşü, kayıt katmanının fırlatması ve Map olmayan dosya deposu, yer listesinde çıkarılan üye
const test = require('brittle')
const b4a = require('b4a')
const { ledger: { Ledger, T, encodeEvent, decodeEvent } } = require('@havenfold/core')
const S = require('..')
const D0 = require('../../core/core/test/helpers/ledger')

const { K, TS0 } = D0
const hex = (b) => b4a.toString(b, 'hex')
const id = (k) => hex(k.memberId)
const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const GUN = 86_400_000
const YER = 'a1'.repeat(16)

function saat (t0 = TS0 + 60_000) { let t = t0; const f = () => ++t; f.ileri = (ms) => { t += ms }; f.su = () => t; return f }
function bellek () { const m = new Map(); return { m, get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v) } }

function ekip () {
  const now = saat()
  const { ledger: L } = S.TeamApi.create({ Ledger, me: K.kerem, isletmeAdi: 'Rivera Kuyum', displayName: 'Kerem', yer: { ad: 'Merkez', tur: 'sube' }, ts: TS0, placeId: YER })
  const kisi = (k, Lk = L, o = {}) => { const defter = new S.LedgerApi({ ledger: Lk, me: k, now }); return { k, L: Lk, defter, ekip: new S.TeamApi({ defter, now, ...o }) } }
  return { L, now, kisi, kerem: kisi(K.kerem) }
}
function uyeEkle (x, yeni, role) {
  const r = x.defter.addMember({ deviceCert: yeni.deviceCert, displayName: yeni.ad, role, ceremonyTranscriptHash: b4a.alloc(32, 7) })
  if (r.durum === 'uygulandi') return r
  const y = new S.LedgerApi({ ledger: x.L, me: yeni, now: x.defter.now })
  y.oneriler = x.defter.oneriler
  return y.sign(r.oneriId)
}
const kopyala = (L, K2 = new Ledger()) => { for (const e of L.events.slice(K2.len)) K2.apply(decodeEvent(encodeEvent(e))); return K2 }

// Kayıt katmanı taklidi: iş kapsamı silmesi, bırakma gizlisi ve Yönetim kaydı gözlenir
function sahteKayit ({ putHata = false } = {}) {
  const k = {
    silinen: 0,
    gizliler: [],
    yazilan: [],
    r: { isKapsaminiSil: () => { k.silinen++; return 4 }, addDropSecret: (cid, sk) => k.gizliler.push([cid, sk.byteLength]) },
    depo: { m: null },
    kasaDosyalari: new Set(['x']),
    eklenen: new Set(['y']),
    put: (...a) => { k.yazilan.push(a); if (putHata) throw new Error('VAULT_LOCKED') }
  }
  return k
}

test('d64 ekip: kurucu LedgerApi ister; kuruluşta yer adı gerekli; tür verilmezse şube; düzey 2.1 kalabilir', (t) => {
  t.is(hataOf(() => new S.TeamApi({ defter: {} })), 'NO_LEDGER')
  for (const yer of [null, { ad: 5 }, { ad: '  ' }]) {
    t.is(hataOf(() => S.TeamApi.create({ Ledger, me: K.kerem, isletmeAdi: 'Rivera Kuyum', displayName: 'Kerem', yer, ts: TS0 })), 'NAME_REQUIRED')
  }
  const { ledger: L, placeId } = S.TeamApi.create({ Ledger, me: K.kerem, isletmeAdi: ' Rivera Kuyum ', displayName: 'Kerem', yer: { ad: ' Depo ' }, ts: TS0, duzey: '2.1' })
  t.is(L.places.get(placeId).kind, 'sube')
  t.is(L.places.get(placeId).name, 'Depo')
  t.is(L.familyName, 'Rivera Kuyum')
  t.is(L.events.filter((e) => e.type === T.PROTOCOL_LEVEL).length, 1, 'düzey yükseltilmedi')
})

test('d64 ekip: ata dizi ister; yer eklemede ad gerekli, tür verilmezse şube; kayit verildiyse bırakma gizlisi replikaya', (t) => {
  const { kerem, kisi } = ekip()
  t.is(hataOf(() => kerem.ekip.assign(id(K.kerem), YER)), 'INVALID_BODY')
  t.is(hataOf(() => kerem.ekip.places({ ekle: { ad: ' ' } })), 'NAME_REQUIRED')
  t.is(hataOf(() => kerem.ekip.places({ ekle: {} })), 'NAME_REQUIRED')
  const kayit = sahteKayit()
  const k2 = kisi(K.kerem, kerem.L, { kayit })
  const e = k2.ekip.places({ ekle: { ad: 'Ofis' } })
  t.is(e.sonuc.durum, 'uygulandi')
  t.is(kerem.L.places.get(e.sonuc.placeId).kind, 'sube')
  t.alike(e.sonuc.birakma, [], 'gizli çağırana dönmez')
  t.is(kayit.gizliler.length, 1)
  t.is(kayit.gizliler[0][1], 32)
  const olaylar = [...kerem.L.collections.values()].find((c) => c.name === 'Olaylar:Ofis')
  t.is(kayit.gizliler[0][0], olaylar.id, 'Olaylar:Ofis koleksiyonunun gizlisi')
})

test('d64 ekip: çıkış mesajı yalnız çıkarılmış üye için; etkin ya da bilinmeyen üyede NO_TARGET', (t) => {
  const { kerem } = ekip()
  uyeEkle(kerem, K.ecem, 'calisan')
  t.is(hataOf(() => kerem.ekip.exitMessage(id(K.ecem))), 'NO_TARGET')
  t.is(hataOf(() => kerem.ekip.exitMessage('ff'.repeat(32))), 'NO_TARGET')
  const c = kerem.ekip.remove(id(K.ecem))
  t.ok(b4a.equals(kerem.ekip.exitMessage(id(K.ecem)).bytes, c.cikis.bytes), 'yeniden gönderim aynı baytlar')
})

test('d64 ekip: kimliksiz defterde çıkış ve ayrılış NO_IDENTITY', (t) => {
  const { L, now, kerem } = ekip()
  uyeEkle(kerem, K.ecem, 'calisan')
  const c = kerem.ekip.remove(id(K.ecem))
  const e = new S.TeamApi({ defter: new S.LedgerApi({ ledger: kopyala(L), now }), now })
  t.is(hataOf(() => e.receiveExit(id(K.kerem), c.cikis.bytes, 'dogrudan')), 'NO_IDENTITY')
  t.is(hataOf(() => e.leave()), 'NO_IDENTITY')
})

test('d64 ekip: eski kopyada çıkış 7 gün bekler; sonra iş kapsamı silinir, boş dönen platform kancası sıfır sayar', (t) => {
  const { L, now, kerem } = ekip()
  uyeEkle(kerem, K.ecem, 'calisan')
  const Le = kopyala(L) // Ecem'in kopyası atamadan önce kalır
  kerem.ekip.assign(id(K.ecem), [YER])
  const c = kerem.ekip.remove(id(K.ecem))
  let cagri = 0
  const ecem = new S.TeamApi({ defter: new S.LedgerApi({ ledger: Le, me: K.ecem, now }), now })
  t.alike(ecem.receiveExit(id(K.kerem), c.cikis.bytes, 'posta', { sil: () => { cagri++ } }), { durum: 'bekliyor' }, 'son bağlantı şimdi: kopya eski, beklenir')
  t.is(cagri, 0)
  const s = ecem.receiveExit(id(K.kerem), c.cikis.bytes, 'posta', { sil: ({ kapsam }) => { cagri++; t.is(kapsam, 'is'); return null }, sonBaglanti: now.su() - 8 * GUN })
  t.is(s.durum, 'silindi')
  t.is(cagri, 1)
  t.alike([s.kapsam, s.istenen, s.collections, s.convs, s.blobs], ['is', 'is', 0, 0, 0])
  t.is(kerem.ekip.receiveReceipt(id(K.ecem), s.makbuz.bytes, 'posta').scope, 1)
})

test('d64 ekip: kayıt katmanı Map olmayan depoyla iş kapsamını siler; Yönetim kaydı fırlatsa da makbuz kabul edilir', (t) => {
  const { L, now, kerem, kisi } = ekip()
  uyeEkle(kerem, K.ecem, 'calisan')
  const ka = sahteKayit()
  const ecem = new S.TeamApi({ defter: new S.LedgerApi({ ledger: L, me: K.ecem, now }), kayit: ka, now })
  let olay = null
  ecem.on('job-scope', (x) => { olay = x })
  const r = ecem.leave()
  t.is(r.durum, 'uygulandi')
  t.alike([r.collections, r.convs, r.blobs], [4, 0, 0], 'depo Map değil: dosya sayılmaz')
  t.is(ka.silinen, 1)
  t.is(ka.kasaDosyalari.size + ka.eklenen.size, 0)
  t.alike(olay, { defter: true, collections: 4, blobs: 0 })
  const kk = sahteKayit({ putHata: true })
  const yon = kisi(K.kerem, L, { kayit: kk })
  const m = yon.ekip.receiveReceipt(id(K.ecem), r.makbuz.bytes, 'posta')
  t.is(m.memberId, id(K.ecem))
  t.is(kk.yazilan.length, 1, 'Yönetim kaydı denendi')
  t.is(kk.yazilan[0][2], 'hf.ekip.cikis')
  t.is(kk.yazilan[0][3].kapsam, 'is')
  t.is(kk.yazilan[0][0], [...L.collections.values()].find((c) => c.name === 'Yönetim').id)
})

test('d64 ekip: üye olmayan göndericinin makbuzu giriş noktasında reddedilir', (t) => {
  const { kerem } = ekip()
  const hata = hataOf(() => kerem.ekip.receiveReceipt('ee'.repeat(32), b4a.alloc(10), 'posta'))
  t.is(hata, 'TYPE_NOT_ALLOWED', 'üye olmayandan yalnız oturumsuz tür geçmez')
  t.is(kerem.ekip.exitStatus().length, 0)
})

test('d64 ekip: bekleyen süre — geçici olmayan rol uygulanınca düşer; bozuk gövde yok sayılır; süre aşıldıysa hata olayı', (t) => {
  const { L, now, kerem, kisi } = ekip()
  uyeEkle(kerem, K.husniye, 'sahip')
  uyeEkle(kerem, K.ecem, 'calisan')
  const saklama = bellek()
  const hus = kisi(K.husniye, L, { saklama })
  hus.defter.oneriler = kerem.defter.oneriler
  const olaylar = []
  hus.ekip.on('term', (x) => olaylar.push(x))
  // Ecem için bekleyen süre var; ama uygulanan rol yönetici: kayıt düşer, süre yazılmaz
  saklama.set('ekip/bekleyen-sure', { [id(K.ecem)]: now.su() + 10 * GUN, diger: 1 })
  // Bozuk SET_ROLE gövdesi: hiçbir şey değişmez
  hus.defter.emit('ledger', { type: T.SET_ROLE, body: b4a.alloc(2) })
  t.ok(id(K.ecem) in saklama.get('ekip/bekleyen-sure'))
  t.is(hus.ekip.role(id(K.ecem), 'yonetici').durum, 'uygulandi')
  t.alike(saklama.get('ekip/bekleyen-sure'), { diger: 1 }, 'yalnız Ecem\'in kaydı düştü')
  t.is(olaylar.length, 0)
  t.absent(L.terms.get(id(K.ecem)))
  // Sahip Kerem'i geçiciye: öneri (Kerem imzalar). İmza 90 günü aşan bir zamana kalırsa süre yazılamaz: hata olayı
  const bitis = now.su() + 89 * GUN
  const g = hus.ekip.role(id(K.kerem), 'gecici', { sureSonu: bitis })
  t.is(g.durum, 'oneri')
  t.is(saklama.get('ekip/bekleyen-sure')[id(K.kerem)], bitis)
  saklama.set('ekip/bekleyen-sure', { ...saklama.get('ekip/bekleyen-sure'), [id(K.kerem)]: now.su() + 91 * GUN })
  t.is(kerem.defter.sign(g.oneriId).durum, 'uygulandi')
  hus.defter.changed()
  t.is(L.members.get(id(K.kerem)).role, 'gecici')
  t.alike(olaylar, [{ memberId: id(K.kerem), hata: 'TERM_LIMIT' }])
  t.absent(id(K.kerem) in saklama.get('ekip/bekleyen-sure'), 'kayıt hatada da düşer')
})

test('d64 ekip: yer listesinde çıkarılan üye görünmez', (t) => {
  const { kerem } = ekip()
  uyeEkle(kerem, K.ecem, 'calisan')
  kerem.ekip.assign(id(K.ecem), [YER])
  t.alike(kerem.ekip.places().yerler[0].kisiler.map((x) => x.name), ['Kerem', K.ecem.ad])
  kerem.ekip.remove(id(K.ecem))
  t.alike(kerem.ekip.places().yerler[0].kisiler.map((x) => x.name), ['Kerem'])
})

test('d64 ekip: tam silme makbuzu Yönetim kaydına tam kapsam olarak yazılır; Map depodaki dosyalar silinip sayılır', (t) => {
  const { L, now, kerem, kisi } = ekip()
  uyeEkle(kerem, K.ecem, 'calisan')
  uyeEkle(kerem, K.irem, 'calisan')
  const Le = kopyala(L)
  const c = kerem.ekip.remove(id(K.ecem), { wipe: true, reason: 'kayıp telefon' })
  const ecem = new S.TeamApi({ defter: new S.LedgerApi({ ledger: Le, me: K.ecem, now }), now })
  const s = ecem.receiveExit(id(K.kerem), c.cikis.bytes, 'dogrudan', { sil: ({ kapsam }) => ({ collections: kapsam === 'tam' ? 6 : 0, convs: 2, blobs: 1 }) })
  t.alike([s.durum, s.kapsam, s.istenen], ['silindi', 'tam', 'tam'])
  const kk = sahteKayit()
  const yon = kisi(K.kerem, L, { kayit: kk })
  yon.ekip.receiveReceipt(id(K.ecem), s.makbuz.bytes, 'posta')
  t.alike([kk.yazilan[0][3].kapsam, kk.yazilan[0][3].koleksiyon, kk.yazilan[0][3].sohbet, kk.yazilan[0][3].dosya], ['tam', 6, 2, 1])

  const ka = sahteKayit()
  const silinen = []
  ka.depo = { m: new Map([['d1', 1], ['d2', 2]]), delete: (k) => { silinen.push(k); ka.depo.m.delete(k) } }
  const irem = new S.TeamApi({ defter: new S.LedgerApi({ ledger: L, me: K.irem, now }), kayit: ka, now })
  const r = irem.leave()
  t.is(r.blobs, 2)
  t.alike(silinen, ['d1', 'd2'])
  t.is(ka.depo.m.size, 0)
})
