// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Ekran ve sensör modları (RFC-0008 §11.7, §11.8; §17 adım 9): ucun kalıcı durumuyla (edge.js) ve telefonun replikasıyla
const test = require('brittle')
const b4a = require('b4a')
const sodium = require('sodium-native')
const V = require('../../core/test/helpers/v21')
const { ledger: { Ledger } } = require('@havenfold/core')
const { hlc: { Hlc } } = require('@havenfold/records')
const { uc: { UcDurumu }, ekran: E, yapilandirma: Y } = require('..')
const VK = require('./helpers/edge-vector')
const AK = require('../../records/test/helpers/family')

const { hex } = V
const hata = (f) => { try { f(); return 'kabul' } catch (e) { return e.message } }
const kerem = hex(V.K.kerem.memberId)
const bellek = () => { const m = new Map(); return { get: (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), set: (k, v) => m.set(k, JSON.stringify(v)) } }
const pil = { percent: 80, tempC: 30, onAC: true }
const HER_GUN = [{ days: 127, startMin: 0, endMin: 1440 }]

function kur () {
  const L = new Ledger()
  for (const f of V.anaAdimlar(L).slice(0, 16)) L.apply(f())
  let now = V.TS0 + 3_600_000
  const saklama = bellek()
  const ucKur = () => new UcDurumu({ defter: () => L, me: V.C.uc1, saklama, now: () => now })
  const cfg = (g) => VK.yapilandirmaBayt(L, { ...VK.TEMEL_YAPILANDIRMA, targets: [], windows: HER_GUN, ...g })
  return { L, saklama, ucKur, cfg, ilerlet: (ms) => { now += ms }, now: () => now }
}
const kartlar = (L, signer, seq, cards, ucId = V.C.uc1.memberId) => E.ekranKodla(L.familyId, { ucId, seq, cards }, signer)
const OLAYLAR = 'koleksiyon:' + hex(V.K_OLAYLAR)
const KART = (until, id = 'ilac') => ({ id, title: 'Akşam ilacı', lines: ['20:00 · 1 tablet'], until })

test('ekran: kartlar screenFrom\'dan; gönderen başına seq tabanı kalıcı, kartlar yalnız bellekte; süresi geçen gösterilmez', (t) => {
  const { L, ucKur, cfg, ilerlet, now } = kur()
  const u = ucKur()
  // Ekran modu değilken atılır
  t.is(hata(() => u.ekranAl(kartlar(L, V.K.kerem, 1, [KART(now() + 60_000)]))), 'NOT_MODE_SCREEN')
  u.yapilandirmaAl(cfg({ seq: 4, mode: 'ekran', screenFrom: ['rol:ebeveyn'] }))
  t.alike(u.ekranAl(kartlar(L, V.K.kerem, 1, [KART(now() + 60_000)]), { from: kerem }), { fromId: kerem, seq: 1, kartSayisi: 1 })
  t.alike(u.gosterilecekKartlar().map((x) => [x.fromId, x.id, x.title]), [[kerem, 'ilac', 'Akşam ilacı']])
  // Aynı ya da küçük seq atılır; büyük seq o gönderenin kartlarını değiştirir
  t.is(hata(() => u.ekranAl(kartlar(L, V.K.kerem, 1, [KART(now() + 60_000, 'baska')]))), 'STALE_CARD')
  u.ekranAl(kartlar(L, V.K.kerem, 2, [KART(now() + 30_000, 'randevu'), KART(now() + 90_000, 'su')]))
  t.alike(u.gosterilecekKartlar().map((x) => x.id), ['randevu', 'su'])
  ilerlet(45_000)
  t.alike(u.gosterilecekKartlar().map((x) => x.id), ['su'])
  // Doğrudan oturumda başkasının adına gelen ve yetişkinin (screenFrom dışı) kartı atılır
  t.is(hata(() => u.ekranAl(kartlar(L, V.K.kerem, 3, [KART(now() + 60_000)]), { from: hex(V.K.husniye.memberId) })), 'UNAUTHORIZED')
  t.is(hata(() => u.ekranAl(kartlar(L, V.K.irem, 1, [KART(now() + 60_000)]))), 'SOURCE_NOT_ALLOWED')

  // Yeniden başlama: kartlar silinir, seq tabanı kalır (eski zarf yeniden oynatılamaz)
  const u2 = ucKur()
  t.alike(u2.gosterilecekKartlar(), [])
  t.is(hata(() => u2.ekranAl(kartlar(L, V.K.kerem, 2, [KART(now() + 60_000)]))), 'STALE_CARD')
  u2.ekranAl(kartlar(L, V.K.kerem, 3, [KART(now() + 60_000)]))
  t.is(u2.gosterilecekKartlar().length, 1)
  // screenFrom değişir: artık izinli olmayanın kartları düşer; mod değişince hepsi
  u2.yapilandirmaAl(cfg({ seq: 5, mode: 'ekran', screenFrom: ['uye:irem'] }))
  t.alike(u2.gosterilecekKartlar(), [])
  u2.ekranAl(kartlar(L, V.K.irem, 1, [KART(now() + 60_000)]))
  t.is(u2.gosterilecekKartlar().length, 1)
  u2.yapilandirmaAl(cfg({ seq: 6, mode: 'kamera', targets: ['rol:ebeveyn'] }))
  t.alike(u2.gosterilecekKartlar(), [])
})

test('sensör: yalnız sensör modunda, listedeki sensörden, pencerede ve güncel durum yayınlandıktan sonra; tür başına dakikada bir; telefon bırakmayı açar', (t) => {
  const { L, ucKur, cfg, ilerlet } = kur()
  const u = ucKur()
  const hlc = new Hlc()
  const ol = (sensor, value = 120, yerel = { gun: 2, dk: 600 }) => u.sensorOlayi({ sensor, value, yerel, hlc: hlc.next(V.TS0 + 3_600_000) })
  t.is(hata(() => ol('ivme')), 'NOT_MODE_SENSOR')
  u.yapilandirmaAl(cfg({ seq: 4, mode: 'sensor', sensors: ['ivme', 'isik'], targets: [OLAYLAR], windows: [{ days: 31, startMin: 480, endMin: 1080 }] }))
  // Görünürlük kapısı: mod değişti, güncel UC_STATUS yayınlanmadan olay bırakılmaz
  t.is(hata(() => ol('ivme')), 'STATUS_NOT_PUBLISHED')
  // Durum açık sensörleri ve olayların gittiği koleksiyonu taşır (açıklama 2 madde 1)
  const d = u.durum({ battery: pil })
  t.alike([d.mode, d.sensors, d.sensorTargets.map(hex)], ['sensor', ['ivme', 'isik'], [hex(V.K_OLAYLAR)]])
  t.is(hata(() => ol('basinc')), 'SENSOR_DISABLED')
  t.is(hata(() => ol('ivme', 120, { gun: 5, dk: 600 })), 'OUT_OF_WINDOW') // cumartesi (yerel hata; akış kapatma kodu PENCERE_DISI telde kalır)
  // Olaylar koleksiyonunda bırakma izni yok (writers'ta device:<uç> değil)
  t.is(hata(() => ol('ivme')), 'NO_DROP_PERMISSION')

  // Ebeveyn izni verir: writers'a device:<uç>, gerçek bırakma anahtarı (RFC-0003 §5.9; sürekli görevdeki kural)
  const pub = b4a.alloc(32)
  const secret = b4a.alloc(32)
  sodium.crypto_box_keypair(pub, secret)
  L.apply(V.koleksiyon(L, [V.K.husniye], {
    collectionId: V.K_OLAYLAR, name: 'Olaylar:Ev', kind: 'olaylar', readers: ['rol:ebeveyn', 'rol:yetiskin'],
    writers: ['rol:ebeveyn', 'rol:yetiskin', 'device:' + hex(V.C.isci1.memberId), 'device:' + hex(V.C.uc1.memberId)], dropKey: pub
  }))
  const r = ol('ivme', 120)
  t.is(r.length, 1)
  t.alike([r[0].collectionId, r[0].type], [hex(V.K_OLAYLAR), 'hf.uc.hareket'])
  // Dakikada bir: aynı tür sessizce düşer, başka tür bırakılır; sınır yeniden başlamada da geçerli
  t.is(ol('ivme', 300), null)
  t.is(ol('isik', 5).length, 1)
  const u3 = ucKur()
  t.is(hata(() => u3.sensorOlayi({ sensor: 'ivme', value: 1, yerel: { gun: 2, dk: 600 }, hlc: hlc.next(V.TS0) })), 'STATUS_NOT_PUBLISHED')
  u3.durum({ battery: pil })
  t.is(u3.sensorOlayi({ sensor: 'ivme', value: 1, yerel: { gun: 2, dk: 600 }, hlc: hlc.next(V.TS0 + 3_600_000) }), null)
  ilerlet(61_000)
  t.is(ol('ivme', 90).length, 1)

  // Telefon (okuyucu, gizli yarı onda) bırakmayı geçerli sayar; gövde RFC-0006 §4.2 alanları ve sensor, value
  const tel = AK.replika(L, V.K.husniye)
  tel.addDropSecret(hex(V.K_OLAYLAR), secret)
  t.alike(tel.receiveOp(r[0].bytes, 1).status, 'gecerli')
  const k = tel.ops.get(r[0].opId)
  const alan = (ad) => k.inner.fields.find((f) => f.name === ad)?.value
  t.alike([k.inner.type, alan('_v'), alan('_subj'), alan('sensor'), alan('value')], ['hf.uc.hareket', 1, 'device:' + hex(V.C.uc1.memberId), 'ivme', 120])
})

test('screen.js denetimleri: kart gövdesi, gönderen ve kaynak; sensor.js: geçersiz sensör ve değer, bırakma izni koşulları', (t) => {
  const { L, cfg, now } = kur()
  const ucHex = hex(V.C.uc1.memberId)
  const ekranCfg = { mode: 'ekran', screenFrom: ['rol:ebeveyn', 'uye:' + hex(V.K.irem.memberId)] }
  const zarf = (signer, cards, ek = {}) => E.ekranKodla(L.familyId, { ucId: V.C.uc1.memberId, seq: 1, cards, ...ek }, signer)
  const denetle = (bytes, o = {}) => hata(() => E.ekranAlDenetle(L, bytes, { ucHex, cfg: ekranCfg, ...o }))
  // Gövde: aynı kimlikli iki kart, kimliksiz ya da süresiz kart
  t.is(hata(() => zarf(V.K.kerem, [KART(now()), KART(now())])), 'INVALID_MESSAGE')
  t.is(hata(() => zarf(V.K.kerem, [{ ...KART(now()), id: '' }])), 'INVALID_MESSAGE')
  t.is(hata(() => zarf(V.K.kerem, [KART(0)])), 'INVALID_MESSAGE')
  t.is(hata(() => E.ekranCoz(b4a.alloc(10))), 'INVALID_MESSAGE')
  // Başka uca, üye olmayandan (işçi), yapılandırmasız uca, çocuktan
  t.is(denetle(E.ekranKodla(L.familyId, { ucId: V.C.isci1.memberId, seq: 1, cards: [KART(now())] }, V.K.kerem)), 'WRONG_EDGE')
  t.is(denetle(zarf(V.C.isci1, [KART(now())])), 'UNAUTHORIZED')
  t.is(denetle(zarf(V.K.kerem, [KART(now())]), { cfg: null }), 'NOT_MODE_SCREEN')
  t.is(denetle(zarf(V.K.ecem, [KART(now())]), { cfg: { mode: 'ekran', screenFrom: ['rol:ebeveyn', 'uye:' + hex(V.K.ecem.memberId)] } }), 'SOURCE_NOT_ALLOWED')
  // uye: ile adlandırılan yetişkin ve rolüyle ebeveyn kabul; kaynakUyar defterde olmayan için false
  t.is(denetle(zarf(V.K.irem, [KART(now())])), 'kabul')
  t.is(denetle(zarf(V.K.husniye, [KART(now())])), 'kabul')
  t.is(E.kaynakUyar(L, ['rol:ebeveyn'], '00'.repeat(16)), false)

  // Sensör: tanımsız sensör, tam sayı olmayan değer ve an
  const Sn = require('../sensor')
  const hlc = new Hlc()
  const o = (x) => hata(() => Sn.sensorBirakmasi(L, { me: V.C.uc1, collectionId: V.K_OLAYLAR, sensor: 'ivme', value: 1, t: V.TS0, hlc: hlc.next(V.TS0), ...x }))
  t.is(o({ sensor: 'sicaklik' }), 'INVALID_SENSOR')
  t.is(o({ value: 1.5 }), 'INVALID_VALUE')
  t.is(o({ t: -1 }), 'INVALID_VALUE')
  // Bırakma izni: olaylar dışı koleksiyon, bırakma anahtarı kapalı koleksiyon, writers'ta olmayan uç, aktif olmayan uç
  t.is(Sn.birakabilir(L, V.K_TUM_AILE, V.C.uc1.memberId), false)
  t.is(Sn.birakabilir(L, V.K_OLAYLAR, V.C.uc1.memberId), false)
  t.is(Sn.birakabilir(L, V.K_OLAYLAR, V.C.isci1.memberId), true)
  t.is(Sn.birakabilir(L, b4a.alloc(16, 0x77), V.C.uc1.memberId), false)
  t.is(o({}), 'NO_DROP_PERMISSION')
  const pub = b4a.alloc(32)
  sodium.crypto_box_keypair(pub, b4a.alloc(32))
  const kol = (dropKey) => L.apply(V.koleksiyon(L, [V.K.husniye], {
    collectionId: V.K_OLAYLAR, name: 'Olaylar:Ev', kind: 'olaylar', readers: ['rol:ebeveyn', 'rol:yetiskin'],
    writers: ['rol:ebeveyn', 'device:' + ucHex], dropKey
  }))
  kol(b4a.alloc(32))
  t.is(Sn.birakabilir(L, V.K_OLAYLAR, V.C.uc1.memberId), false, 'bırakma anahtarı kapalı')
  kol(pub)
  t.is(Sn.birakabilir(L, V.K_OLAYLAR, V.C.uc1.memberId), true)
  L.apply(V.cihazCikar(L, V.C.uc1, [V.C.uc1]))
  t.is(Sn.birakabilir(L, V.K_OLAYLAR, V.C.uc1.memberId), false, 'uç aileden çıktı')
  void cfg
})

test('açıklama 2: sensör hedefi yapılandırmada ve okuyucuları evin bütün yetişkinleri; yetki her çağrıda; saat geri alınınca sınır kilitlenmez', (t) => {
  const { L, ucKur, cfg, ilerlet } = kur()
  const u = ucKur()
  const hlc = new Hlc()
  const ol = (sensor = 'ivme') => u.sensorOlayi({ sensor, value: 1, yerel: { gun: 2, dk: 600 }, hlc: hlc.next(V.TS0 + 3_600_000) })
  // Hedefsiz, kamera hedefli, koleksiyon olmayan ya da olaylar olmayan hedef reddedilir; kamera modunda koleksiyon hedefi olmaz
  t.is(hata(() => u.yapilandirmaAl(cfg({ seq: 4, mode: 'sensor', sensors: ['ivme'], targets: [] }))), 'INVALID_BODY')
  t.is(hata(() => u.yapilandirmaAl(cfg({ seq: 4, mode: 'sensor', sensors: ['ivme'], targets: [OLAYLAR, 'rol:ebeveyn'] }))), 'INVALID_BODY')
  t.is(hata(() => u.yapilandirmaAl(cfg({ seq: 4, mode: 'sensor', sensors: ['ivme'], targets: ['koleksiyon:' + hex(V.K_TUM_AILE)] }))), 'INVALID_TARGET')
  t.is(hata(() => u.yapilandirmaAl(cfg({ seq: 4, mode: 'sensor', sensors: ['ivme'], targets: ['koleksiyon:' + '77'.repeat(16)] }))), 'INVALID_TARGET')
  t.is(hata(() => u.yapilandirmaAl(cfg({ seq: 4, mode: 'kamera', targets: [OLAYLAR] }))), 'INVALID_BODY')

  // Geçerli hedef, yazma izni, gerçek bırakma anahtarı; Hüsniye imzalar
  const pub = b4a.alloc(32)
  sodium.crypto_box_keypair(pub, b4a.alloc(32))
  const olaylar = (readers) => L.apply(V.koleksiyon(L, [V.K.husniye], {
    collectionId: V.K_OLAYLAR, name: 'Olaylar:Ev', kind: 'olaylar', readers, writers: ['rol:ebeveyn', 'device:' + hex(V.C.uc1.memberId)], dropKey: pub
  }))
  olaylar(['rol:ebeveyn', 'rol:yetiskin'])
  u.yapilandirmaAl(cfg({ seq: 4, mode: 'sensor', sensors: ['ivme'], targets: [OLAYLAR], imzaci: 'husniye' }))
  u.durum({ battery: pil })
  t.is(ol().length, 1)
  // Saat geri alınır: sınır kilitlenmez, olay bırakılır
  ilerlet(-10 * 60_000)
  t.is(ol().length, 1)
  t.is(ol(), null)
  // Hedefin okuyucularından yetişkinler çıkarsa (veri bazı yetişkinlerden gizli kalırdı) olay yazılmaz; her çağrıda sorulur
  olaylar(['rol:ebeveyn'])
  ilerlet(61_000)
  t.is(hata(() => ol()), 'INVALID_TARGET')
  t.is(Y.okuyucuKapsar(L, L.collections.get(hex(V.K_OLAYLAR))), false)
  olaylar(['rol:ebeveyn', 'uye:' + hex(V.K.irem.memberId)])
  t.is(ol().length, 1, 'yetişkin kişi olarak okuyucu')
  // Yapılandırmayı imzalayan ebeveyn aileden ayrılınca bir sonraki olayda yapılandırma düşer
  L.apply(V.olay(L, V.T.LEAVE, { memberId: V.K.husniye.memberId }, [V.K.husniye]))
  ilerlet(61_000)
  t.is(hata(() => ol()), 'NOT_MODE_SENSOR')
  t.is(u.mod, 'kapali')
})

test('açıklama 2 madde 3: kart gönderen aileden çıkınca kartları gösterilmez ve yeni kartı atılır', (t) => {
  const { L, ucKur, cfg, now } = kur()
  const u = ucKur()
  u.yapilandirmaAl(cfg({ seq: 4, mode: 'ekran', screenFrom: ['rol:ebeveyn'], imzaci: 'husniye' }))
  u.ekranAl(kartlar(L, V.K.kerem, 1, [KART(now() + 60_000)]))
  t.is(u.gosterilecekKartlar().length, 1)
  L.apply(V.olay(L, V.T.LEAVE, { memberId: V.K.kerem.memberId }, [V.K.kerem]))
  t.alike(u.gosterilecekKartlar(), [])
  t.is(hata(() => u.ekranAl(kartlar(L, V.K.kerem, 2, [KART(now() + 60_000)]))), 'SOURCE_NOT_ALLOWED')
})
