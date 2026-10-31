// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// synchronizer.js testleri (D34): gelen her zarf tek giriş noktasından, giden her zarf oturum süzgecinden; diskteki kutu
// emaneti açılışta doğrulanır. Çok cihazlı uçtan uca akış test/multi-device.js'de.
'use strict'
const test = require('brittle')
const b4a = require('b4a')
const { giris, zarf: { Z }, sync: S } = require('@havenfold/core')
const { esitleme: E } = require('@havenfold/records')
const { Esitleyici } = require('../synchronizer')
const { kutuKur, kutuGoruntusu, kodla, coz } = require('../persistence')
const A = require('../../core/records/test/helpers/family')
const { geciciDizin, kaliciAc } = require('./helpers/common')

const saat = () => { let t = A.TS0 + 3_600_000; return () => t++ }
const id = (k) => A.hex(k.memberId)

function kur (t, kim) {
  const now = saat()
  const k = kaliciAc({ dizin: geciciDizin(t), now, kimlik: kim })
  k.aileBagla(A.kopya(A.anaDefter()))
  t.teardown(() => k.kapat())
  const giden = []
  const e = new Esitleyici({ kalici: k, ag: { gonder: (p, type, bytes) => { giden.push({ p, type, bytes }) } } })
  return { k, e, giden }
}

test('gelen zarf: kayıt ve defter türleri giris.gelenZarf\'tan geçer; defterde olmayan uçtan gelen atılır', (t) => {
  const { e, giden } = kur(t, A.K.kerem)
  const h = kur(t, A.K.husniye)
  const asil = giris.gelenZarf
  const cagrilar = []
  giris.gelenZarf = (o) => { cagrilar.push([o.type, o.gonderen, o.yol]); return asil(o) }
  t.teardown(() => { giris.gelenZarf = asil })
  e.baglandi(id(A.K.husniye))
  giden.length = 0
  t.alike(e.al(id(A.K.husniye), Z.REC_VV, E.vvFor(h.k.nesneler.replika, id(A.K.kerem)), 'dogrudan'), { hata: null })
  t.alike(e.al(id(A.K.husniye), Z.LEDGER_REQ, S.encodeReq({ fromSeq: 0 }), 'emanet'), { hata: null })
  t.alike(cagrilar, [[Z.REC_VV, id(A.K.husniye), 'dogrudan'], [Z.LEDGER_REQ, id(A.K.husniye), 'emanet']])
  t.ok(giden.some((x) => x.type === Z.LEDGER_EVENTS), 'LEDGER_REQ cevaplandı')
  // Bozuk bayt: kanonik çözme düşürür, işleyiciye ulaşmaz
  t.alike(e.al(id(A.K.husniye), Z.REC_VV, b4a.from([1, 2, 3]), 'dogrudan'), { hata: 'INVALID_MESSAGE' })
  // Defterde olmayan kimlik
  const yabanci = 'ab'.repeat(16)
  e.baglandi(yabanci)
  giden.length = 0
  t.alike(e.al(yabanci, Z.LEDGER_REQ, S.encodeReq({ fromSeq: 0 }), 'dogrudan'), { hata: 'TYPE_NOT_ALLOWED' })
  t.is(e.reddedilen, 1)
  t.alike(giden, [], 'yabancıya hiçbir şey gitmez')
  t.alike(e.al(id(A.K.husniye), Z.REC_OPS, E.packOps([])[0] || b4a.from([0]), 'yok'), { hata: 'INVALID_CHANNEL' }, 'yol zorunlu')
})

test('giden zarf: bağlanan üyeye defter isteği, defter ve kayıt özeti; oturum kapanınca gitmez', (t) => {
  const { e, giden } = kur(t, A.K.kerem)
  e.baglandi(id(A.K.husniye))
  t.alike(giden.map((x) => [x.p, x.type]), [[id(A.K.husniye), Z.LEDGER_REQ], [id(A.K.husniye), Z.LEDGER_EVENTS], [id(A.K.husniye), Z.REC_VV]])
  e.koptu(id(A.K.husniye))
  giden.length = 0
  e.akit()
  t.is(e._gonder(id(A.K.husniye), Z.REC_VV, b4a.alloc(1)), false)
  t.alike(giden, [])
})

test('kutu emaneti: kapat–aç sonrası aynı; opId ya da koleksiyonu tutmayan, boyu uymayan kopya STATE_CORRUPT', (t) => {
  const L = A.anaDefter()
  const r = A.replika(A.kopya(L), A.K.husniye) // Tüm Aile'nin dönem anahtarını ilk okuyucu Hüsniye üretir
  const cid = A.hex(A.K_TUM_AILE)
  r.put(cid, null, 'yuva.defter.not', { baslik: 'x' })
  const op = r.outbox.find((m) => m.type === Z.REC_OPS)
  const kutu = kutuKur(null, { ledger: L, now: Date.now })
  t.alike(kutu.accept(id(A.K.husniye), 0, op.bytes), { ok: true, code: null })
  const g = kutuGoruntusu(kutu)
  const k2 = kutuKur(coz(JSON.parse(JSON.stringify(kodla(g)))), { ledger: L, now: Date.now }) // diskteki biçimden
  t.is(k2.set(cid).size, 1)
  t.is(k2.used, kutu.used)
  t.alike(E.bucketsOf(k2.set(cid)).flat(), E.bucketsOf(kutu.set(cid)).flat())
  const hataOf = (f) => { try { f(); return null } catch (err) { return err.message } }
  t.is(hataOf(() => kutuKur({ ...g, koleksiyonlar: [{ ...g.koleksiyonlar[0], cid: '00'.repeat(16) }] }, { ledger: L, now: Date.now })), 'STATE_CORRUPT', 'başka koleksiyonun adına')
  t.is(hataOf(() => kutuKur({ ...g, kullanilan: g.kullanilan + 1 }, { ledger: L, now: Date.now })), 'STATE_CORRUPT', 'kullanım uymuyor')
  const bozuk = b4a.from(op.bytes)
  bozuk[3] ^= 1
  const kop = { ...g.koleksiyonlar[0], ops: [{ kind: 0, kopyalar: [g.koleksiyonlar[0].ops[0].kopyalar[0], { ...g.koleksiyonlar[0].ops[0].kopyalar[0], bytes: bozuk }] }] }
  t.is(hataOf(() => kutuKur({ ...g, koleksiyonlar: [kop] }, { ledger: L, now: Date.now })), 'STATE_CORRUPT', 'aynı opId altında başka işlem')
})

test('ürün zarfı (SHARE_PREVIEW): işleyiciye ham baytla ve oturum rolüyle; kalıcı kuyruk, teslimde bildirim; yalnız üye telefonu', (t) => {
  const { k, e, giden } = kur(t, A.K.kerem)
  const gelen = []
  const teslim = []
  t.exception(() => e.urunZarfi(Z.REC_VV, () => {}), /TYPE_NOT_ALLOWED/)
  t.exception(() => e.zarfGonder(id(A.K.husniye), Z.REC_VV, b4a.alloc(1)), /TYPE_NOT_ALLOWED/)
  t.exception(() => e.zarfGonder(id(A.K.kutu), Z.SHARE_PREVIEW, b4a.alloc(1), 'x'), /INVALID_RECEIVER/, 'kutuya önizleme gitmez')
  t.exception(() => e.zarfGonder('ab'.repeat(16), Z.SHARE_PREVIEW, b4a.alloc(1), 'x'), /INVALID_RECEIVER/)
  e.baglandi(id(A.K.husniye))
  // İşleyici yokken atılır
  t.alike(e.al(id(A.K.husniye), Z.SHARE_PREVIEW, b4a.from([1]), 'dogrudan'), { hata: null })
  e.urunZarfi(Z.SHARE_PREVIEW, (p, bytes, yol, rol) => { gelen.push([p, b4a.toString(bytes, 'hex'), yol, rol]); if (bytes[0] === 9) throw new Error('INVALID_MESSAGE') }, (p, kim) => teslim.push([p, kim]))
  t.alike(e.al(id(A.K.husniye), Z.SHARE_PREVIEW, b4a.from([1, 2]), 'emanet'), { hata: null })
  t.alike(e.al(id(A.K.husniye), Z.SHARE_PREVIEW, b4a.from([9]), 'dogrudan'), { hata: 'INVALID_MESSAGE' })
  t.alike(gelen, [[id(A.K.husniye), '0102', 'emanet', 'uye'], [id(A.K.husniye), '09', 'dogrudan', 'uye']])
  giden.length = 0
  t.is(e.zarfGonder(id(A.K.husniye), Z.SHARE_PREVIEW, b4a.from([7]), 's1'), true)
  t.alike(giden.map((x) => [x.p, x.type]), [[id(A.K.husniye), Z.SHARE_PREVIEW]])
  t.alike(teslim, [[id(A.K.husniye), 's1']])
  // Çevrimdışı alıcı: kalıcı kuyrukta bekler (aynı kimlikle ikinci zarf öncekinin yerine), bağlanınca gider ve teslim bildirilir
  giden.length = 0
  t.is(e.zarfGonder(id(A.K.irem), Z.SHARE_PREVIEW, b4a.from([8]), 's2'), false)
  t.is(e.zarfGonder(id(A.K.irem), Z.SHARE_PREVIEW, b4a.from([8, 8]), 's2'), false)
  t.is(k.urunSaklama('esitleyici/').get('kuyruk').length, 1)
  t.alike(giden, [])
  const e2 = new Esitleyici({ kalici: k, ag: { gonder: (p, type, bytes) => { giden.push({ p, type, bytes }) } } })
  e2.urunZarfi(Z.SHARE_PREVIEW, () => {}, (p, kim) => teslim.push([p, kim]))
  e2.baglandi(id(A.K.irem))
  const g = giden.filter((x) => x.type === Z.SHARE_PREVIEW)
  t.alike(g.map((x) => [x.p, b4a.toString(x.bytes, 'hex')]), [[id(A.K.irem), '0808']], 'yeni eşitleyici (yeniden açılış) kalıcı kuyruğu gönderir')
  const sira = giden.map((x) => x.type)
  t.ok(sira.indexOf(Z.SHARE_PREVIEW) > sira.indexOf(Z.REC_VV), 'kayıt özetinden sonra')
  t.alike(teslim.at(-1), [id(A.K.irem), 's2'])
  t.alike(k.urunSaklama('esitleyici/').get('kuyruk'), [])
})

// Codex 12. tur: misafir istenmemiş dosya (BLOB_DATA) yollayıp ebeveyn telefonunun diskine yazdıramaz; telefon dosyayı
// yalnız selamlaştığı üyelerden ister, misafirin bırakmasında dosya eki yok (RFC-0030 madde 5). Üyeden gelen dosya alınır
test('misafirden gelen BLOB_DATA süzgeçte düşer, depoya yazılmaz', (t) => {
  const c = require('compact-encoding')
  const { ledger: { Ledger, encodeEvent, decodeEvent } } = require('@havenfold/core')
  const { dosya: D } = require('@havenfold/records')
  const L0 = A.anaDefter(17)
  const mis = id(A.C.misafir1)
  const simdi = L0.grants.get(mis).expiresAt - 3_600_000
  const now = () => simdi
  const L = new Ledger({ now })
  for (const e of L0.events) L.apply(decodeEvent(encodeEvent(e)))
  const k = kaliciAc({ dizin: geciciDizin(t), now, kimlik: A.K.kerem })
  k.aileBagla(L)
  t.teardown(() => k.kapat())
  const e = new Esitleyici({ kalici: k, ag: { gonder: () => true } })
  t.is(L.sessionRole(mis), 'misafir')
  const dosya = (x) => {
    const chunk = b4a.alloc(1000, x)
    const blobId = D.blobIdOf([chunk])
    return { hex: A.hex(blobId), bytes: c.encode(D.blobData, { blobId, index: 0, total: 1, chunk }) }
  }
  const a = dosya(0x41)
  t.is(e.al(mis, Z.BLOB_DATA, a.bytes, 'dogrudan').hata, 'TYPE_NOT_ALLOWED')
  t.absent(k.nesneler.kayit.depo.get(a.hex), 'misafirin dosyası depoda yok')
  const b = dosya(0x42)
  t.is(e.al(id(A.K.husniye), Z.BLOB_DATA, b.bytes, 'dogrudan').hata, null)
  t.ok(k.nesneler.kayit.depo.get(b.hex), 'üyenin dosyası alınır')
})

// Codex 12. tur (kurucu §6.8, RFC-0034 §4.5): çıkarılan telefon kendi çıkarılmasını görmeli (wipe: true ise siler). Yeni
// olaylar yalnız geçerli üyelere gidiyordu; çıkarılan telefon açık oturumda bile REMOVE_MEMBER'ı hiç almıyordu. Açık ve
// selamlaşılmış oturuma, çıkarılmasına kadarki olaylar bir kez yollanır (LEAVE yankısı gibi; yeni protokol türü yok),
// sonrasındaki olaylar gitmez
test('çıkarılan telefon açık oturumdan kendi çıkarılmasını alır; sonraki olaylar gitmez', (t) => {
  const k = kur(t, A.K.kerem)
  const i = kur(t, A.K.irem)
  const K = id(A.K.kerem)
  const I = id(A.K.irem)
  const aktar = () => {
    for (let n = 0; n < 6; n++) {
      for (const [a, b, ad] of [[k, i, K], [i, k, I]]) for (const m of a.giden.splice(0)) b.e.al(ad, m.type, m.bytes, 'dogrudan')
    }
  }
  k.e.baglandi(I)
  i.e.baglandi(K)
  aktar()
  t.ok(k.e.selamlanan.has(I))
  const DK = k.k.nesneler.ledger
  const { ledger: { signEvent } } = require('@havenfold/core')
  // İki ebeveyn imzalar (Hüsniye'nin imzası doğrudan)
  const yaz = (r) => { if (r.durum !== 'uygulandi') { signEvent(r.event, A.K.husniye); DK.apply(r.event) } }
  const once = DK.len
  yaz(k.k.nesneler.defter.removeMember(I, { wipe: true }))
  t.is(DK.len, once + 1)
  k.e.akit()
  const giden = k.giden.filter((m) => m.p === I)
  aktar()
  const DI = i.k.nesneler.ledger
  t.is(DI.len, DK.len, 'çıkarılan telefonun defteri çıkarılmasına kadar')
  t.absent(DI.members.get(I).active)
  t.ok(DI.members.get(I).wipe, 'wipe: true görüldü (start.js uyelikOf → silinmeli)')
  t.is(giden.length, 1)
  // Sonraki olaylar çıkarılana gitmez
  yaz(k.k.nesneler.defter.removeMember(id(A.K.ecem)))
  t.is(DK.len, once + 2)
  k.e.akit()
  t.alike(k.giden.filter((m) => m.p === I), [], 'çıkarılmadan sonraki olay gitmez')
})
