// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D83 adım 3 (RFC-0012 §17): etiket listesi ve eşleşme, yerel ağ duyurusu ve aralığı, yok sayılan adresler, Noise IK + HELLO
// bağ oturumu (bellek içi akış çiftiyle), bağ türü kapısı, bağ üstünde afet eşitlemesi.
const test = require('brittle')
const b4a = require('b4a')
const { Duplex } = require('streamx')
const { zarf: { Z: ZARF } } = require('@havenfold/core')
const M = require('../message')
const T = require('../derivation')
const Y = require('../local')
const { ZINCIR, KIMLIK, defter, ciftler, cihaz, sabitRastgele } = require('./helpers/disaster-vector')

const SN = 1000
const GUN = 20750
const AN = GUN * 86_400_000 + 15 * 3_600_000
const L = defter(ZINCIR)
const id = (ad) => KIMLIK[ad].memberId
const cift = (ben, karsi) => ciftler(L, KIMLIK[ben]).find((x) => b4a.equals(x.id, id(karsi)))

// Bellek içi ham akış çifti (Bluetooth ya da TCP yerine)
function akisCifti () {
  let a = null
  let b = null
  const yap = (karsi) => new Duplex({
    write (d, cb) { karsi().push(d); cb() },
    final (cb) { karsi().push(null); cb() },
    predestroy () { karsi().destroy() }
  })
  a = yap(() => b)
  b = yap(() => a)
  return [a, b]
}

// Bağlanan keşifteki eşleşmeyle (çift ve dilim), karşılayan yalnız kendi çiftleriyle (bağlananı bilmeden)
function bagla (ben, karsi, { bag = Y.BAG.BLUETOOTH, dilim = T.dilimOf(AN), simdiB = AN, ciftA, ciftlerB } = {}) {
  const [x, y] = akisCifti()
  return Promise.allSettled([
    Y.bagKur({ ham: x, baslatan: true, me: KIMLIK[ben], L, eslesme: { cift: ciftA ?? cift(ben, karsi), dilim }, bag }),
    Y.bagKur({ ham: y, baslatan: false, me: KIMLIK[karsi], L, ciftler: ciftlerB ?? ciftler(L, KIMLIK[karsi]), simdi: simdiB, bag })
  ])
}

test('etiket listesi: 25 öğe, 25\'ten çok çiftte dilime göre kayan seçim; boş listede yalnız dolgu', (t) => {
  const cok = Array.from({ length: 30 }, (_, i) => ({ id: b4a.alloc(16, i + 1), pair: b4a.alloc(32, i + 1) }))
  const l1 = Y.etiketListesi({ ciftler: cok, meId: id('kerem'), simdi: AN })
  t.is(l1.tags.length, 25)
  const bulunan = (l, simdi) => cok.filter((x) => l.tags.some((g) => b4a.equals(g, T.etiket(T.afetKey(x.pair), id('kerem'), T.dilimOf(simdi))))).length
  t.is(bulunan(l1, AN), 25)
  t.is(Y.etiketListesi({ ciftler: [], meId: id('kerem'), simdi: AN }).tags.length, 25)
  const a = Y.etiketListesi({ ciftler: cok.slice(0, 3), meId: id('kerem'), simdi: AN, rastgele: sabitRastgele('x') })
  const b = Y.etiketListesi({ ciftler: cok.slice(0, 3), meId: id('kerem'), simdi: AN, rastgele: sabitRastgele('x') })
  t.alike(a, b, 'aynı kaynakla aynı liste')
})

test('duyuru: kodlama, bozuk ve port hataları; aralık tablosu (§9.3); yok sayılan adres', (t) => {
  const l = Y.etiketListesi({ ciftler: [], meId: id('kerem'), simdi: AN })
  t.exception(() => Y.duyuruKodla(l, 0), /DISASTER_PORT/)
  t.exception(() => Y.duyuruKodla(l, 70000), /DISASTER_PORT/)
  const d = Y.duyuruKodla(l, 47871)
  t.is(Y.duyuruCoz(d).port, 47871)
  t.exception(() => Y.duyuruCoz(b4a.alloc(2)), /DISASTER_CORRUPT/)
  t.exception(() => Y.duyuruCoz(b4a.concat([d.subarray(0, -2), b4a.alloc(2)])), /DISASTER_PORT/)
  t.exception(() => Y.duyuruCoz(b4a.concat([b4a.from([0xb0]), d.subarray(1)])), /DISASTER_CORRUPT/)
  const A = Y.duyuruAraligi
  t.is(A({ durum: 'KAPALI' }), null)
  t.is(A({ durum: 'HAZIR', pil: 90 }), 120 * SN)
  t.is(A({ durum: 'ETKIN', pil: 80 }), 30 * SN)
  t.is(A({ durum: 'ETKIN' }), 30 * SN)
  t.is(A({ durum: 'ETKIN', pil: 20 }), 60 * SN)
  t.is(A({ durum: 'ETKIN', pil: 10 }), 120 * SN)
  t.is(A({ durum: 'ETKIN', pil: 10, dugum: { prizde: true } }), 30 * SN)
  t.is(A({ durum: 'HAZIR', pil: 20, dugum: { prizde: false } }), 60 * SN)
  t.is(A({ durum: 'HAZIR', dugum: {} }), 30 * SN)
  const y = new Y.YokSayilan()
  t.absent(y.var('aa:bb', AN))
  y.ekle('aa:bb', AN)
  t.ok(y.var('aa:bb', AN + Y.YOK_SAY_MS - 1))
  t.absent(y.var('aa:bb', AN + Y.YOK_SAY_MS))
  t.is(Y.YEREL_AG.port, 47870)
  t.is(Y.EN_COK_BAG, 3)
})

test('bağ oturumu: Noise IK + HELLO; Bluetooth\'ta LEDGER_REQ oturumu kapatır, yerel ağda geçer; PING → PONG', async (t) => {
  const [a, b] = await bagla('kerem', 'husniye')
  t.is(a.status, 'fulfilled')
  t.is(b.status, 'fulfilled')
  const A = a.value
  const B = b.value
  t.is(A.karsi, KIMLIK.husniye.memberId.toString('hex'))
  t.is(B.rol, 'uye')
  t.ok(A.caps & 512, 'caps\'te AFET')
  const pong = new Promise((resolve) => A.dinle(resolve))
  A.gonder(b4a.from([ZARF.PING]))
  t.alike(await pong, b4a.from([ZARF.PONG]))
  t.exception(() => A.gonder(b4a.from([ZARF.LEDGER_REQ])), /DISASTER_TYPE_FORBIDDEN/, 'yasak tür gönderilmez')
  // karşı taraf yasak tür yollarsa (kapıyı atlayarak) oturum kapanır
  const kapandi = new Promise((resolve) => B.socket.on('close', resolve))
  A.socket.write(b4a.from([ZARF.LEDGER_REQ]))
  await kapandi
  t.is(B.kapandi, 'DISASTER_TYPE_FORBIDDEN')
  t.absent(B.gonder(b4a.from([ZARF.PING])), 'kapalı bağa gönderilmez')
  A.kapat()
  A.kapat()

  const [c, d] = await bagla('kerem', 'irem', { bag: Y.BAG.YEREL })
  const gelen = new Promise((resolve) => d.value.dinle(resolve))
  c.value.gonder(b4a.from([ZARF.LEDGER_REQ, 1]))
  t.alike(await gelen, b4a.from([ZARF.LEDGER_REQ, 1]), 'yerel ağda olağan oturum: bütün türler')
  c.value.kapat()
})

test('bağ oturumu: karşılayan çifti etiketten bulur; önceki dilimin etiketi geçer, iki dilim önceki ve yabancı etiket kapanır', async (t) => {
  const D = T.dilimOf(AN)
  const [a, b] = await bagla('kerem', 'husniye', { dilim: D - 1 })
  t.is(a.status, 'fulfilled', 'önceki dilimin etiketi')
  t.is(b.value.karsi, b4a.toString(id('kerem'), 'hex'), 'karşılayan bağlananı etiketten tanıdı')
  a.value.kapat()
  const [c, d] = await bagla('kerem', 'husniye', { dilim: D - 2 })
  t.is(c.status, 'rejected')
  t.is(d.reason?.message, 'DISASTER_LABEL')
  // Yanlış çift sırrı: etiket karşılayanın hiçbir çiftine uymaz
  const sahte = { id: id('husniye'), pair: b4a.alloc(32, 9) }
  const [, f] = await bagla('kerem', 'husniye', { ciftA: sahte })
  t.is(f.reason?.message, 'DISASTER_LABEL')
  // Gün sınırında: etiketin dilimi dünün son dilimiyse iki taraf da dünün anahtarını kullanır
  const gece = (T.gunOf(AN)) * 86_400_000
  const [g, h] = await bagla('kerem', 'husniye', { dilim: T.dilimOf(gece) - 1, simdiB: gece + 1000 })
  t.is(g.status, 'fulfilled')
  t.is(h.status, 'fulfilled')
  g.value.kapat()
  // Etiket gelmeden akış kapanırsa
  const [x, y] = akisCifti()
  const p = Y.bagKur({ ham: y, baslatan: false, me: KIMLIK.husniye, L, ciftler: ciftler(L, KIMLIK.husniye), simdi: AN, bag: Y.BAG.BLUETOOTH })
  x.write(b4a.alloc(2))
  x.destroy()
  await t.exception(p, /DISASTER_LABEL/)
})

test('bağ oturumu: HELLO bozuk, süre aşımı, caps\'te AFET yok', async (t) => {
  const NoiseSecretStream = require('@hyperswarm/secret-stream')
  const kur = async (davran, ek = {}) => {
    const [x, y] = akisCifti()
    const c = cift('kerem', 'husniye')
    const p = Y.bagKur({ ham: x, baslatan: true, me: KIMLIK.kerem, L, eslesme: { cift: c, dilim: T.dilimOf(AN) }, bag: Y.BAG.BLUETOOTH, ...ek })
    // Elle karşılayan: önce 4 baytlık etiketi okur, sonra Noise
    const etiket = await new Promise((resolve) => y.once('data', resolve))
    t.is(etiket.byteLength, 4)
    const karsi = new NoiseSecretStream(false, Y.onekli(y, etiket.subarray(4)), { pattern: 'IK', keyPair: T.anahtarCifti(cift('husniye', 'kerem').pair, id('husniye'), GUN) })
    karsi.on('error', () => {})
    await karsi.opened
    davran(karsi)
    try { await p; return 'tamam' } catch (e) { return e.message } finally { karsi.destroy() }
  }
  t.is(await kur((k) => k.write(b4a.from([ZARF.PING]))), 'DISASTER_HELLO_CORRUPT')
  t.is(await kur((k) => k.write(b4a.from([ZARF.HELLO, 0xff]))), 'DISASTER_HELLO_CORRUPT')
  const tut = setTimeout(() => {}, 500) // bekçi zamanlayıcısı unref; süreç boşta sayılmasın
  t.is(await kur(() => {}, { sureMs: 50 }), 'DISASTER_HELLO_TIMEOUT')
  clearTimeout(tut)
  const { hello: H, messages: MS } = require('@havenfold/core')
  const c = require('compact-encoding')
  const hello = (caps) => (k) => k.write(b4a.concat([b4a.from([ZARF.HELLO]), c.encode(MS.hello, H.createHello(KIMLIK.husniye, k, L, caps))]))
  t.is(await kur(hello(0)), 'DISASTER_CAPS')
  t.is(await kur((k) => k.write(b4a.concat([b4a.from([ZARF.HELLO]), c.encode(MS.hello, H.createHello(KIMLIK.irem, k, L, 512))]))), 'DISASTER_HELLO_MIXED_IDENTITY')
  t.is(await kur(hello(512)), 'tamam')
})

test('bağ üstünde afet eşitlemesi: Kerem → İrem (taşıyıcı) → Hüsniye; teslim bilgisi ve ALINDI geri döner', async (t) => {
  const s = { t: AN }
  const saat = () => s.t
  const c = { kerem: cihaz(L, 'kerem', saat), irem: cihaz(L, 'irem', saat), husniye: cihaz(L, 'husniye', saat) }
  const r = c.kerem.gonder({ to: id('husniye'), kind: M.KIND.METIN, text: 'Toplanma alanındayız' })
  const esitle = async (ben, karsi) => {
    const [a, b] = await bagla(ben, karsi)
    return Promise.all([Y.afetEsitle(a.value, c[ben], { sessizMs: 20 }), Y.afetEsitle(b.value, c[karsi], { sessizMs: 20 })])
  }
  const [k1, i1] = await esitle('kerem', 'irem')
  t.ok(k1.bitti && i1.bitti)
  t.is(c.irem.depo.tasinan.size, 1)
  const [, h2] = await esitle('irem', 'husniye')
  t.alike(h2.alinan.map((x) => x.ic.text), ['Toplanma alanındayız'])
  t.absent(c.irem.depo.tasinan.has(r.mid), 'aynı bağda gelen teslim bilgisi taşıyıcıdan siler')
  await esitle('husniye', 'irem')
  await esitle('irem', 'kerem')
  t.ok(c.kerem.depo.giden.get(r.mid).teslim)
  t.is(c.kerem.depo.gelen[0].ic.kind, M.KIND.ALINDI)
})

test('bağ üstünde afet eşitlemesi: büyük zarf ve süre aşımı bağı kapatır', async (t) => {
  const saat = () => AN
  const k = cihaz(L, 'kerem', saat)
  const [a, b] = await bagla('kerem', 'irem')
  const p = Y.afetEsitle(a.value, k, { sureMs: 5000 })
  b.value.gonder(b4a.concat([b4a.from([M.Z.AFET_MSG]), b4a.alloc(601)]))
  t.is((await p).kapandi, 'DISASTER_LENGTH')
  const [c, d] = await bagla('kerem', 'irem')
  const tut = setTimeout(() => {}, 500)
  const r = await Y.afetEsitle(c.value, k, { sureMs: 30 })
  clearTimeout(tut)
  t.is(r.kapandi, 'SURE', 'karşı taraf hiç cevap vermezse')
  t.absent(r.bitti)
  d.value.kapat()
  // karşı taraf bağı kapatırsa
  const [e, f] = await bagla('kerem', 'irem')
  const p2 = Y.afetEsitle(e.value, k, { sureMs: 5000 })
  f.value.kapat()
  t.ok((await p2).kapandi)
})

test('D84 B3: yerel ağ olağan oturumu esitleyici kancasına bağlanır; olağan oturum süzgecinde yalnız AFET_MSG', async (t) => {
  const { zarf } = require('@havenfold/core')
  const [a, b] = await bagla('kerem', 'irem', { bag: Y.BAG.YEREL })
  const olaylar = []
  const isl = {
    baglandi: (p, o) => olaylar.push(['baglandi', p, o.caps & 512]),
    al: (p, tur, govde, kaynak) => olaylar.push(['al', tur, b4a.toString(govde, 'hex'), kaynak]),
    koptu: (p) => olaylar.push(['koptu', p])
  }
  const o = Y.olaganOturum(b.value, isl)
  const gelen = new Promise((resolve) => a.value.dinle(resolve))
  t.ok(o.gonder(ZARF.LEDGER_REQ, b4a.from([7])))
  t.absent(o.gonder(ZARF.HELLO, b4a.alloc(1)), 'HELLO yeniden gönderilmez')
  t.alike(await gelen, b4a.from([ZARF.LEDGER_REQ, 7]))
  const alindi = new Promise((resolve) => { const al = isl.al; isl.al = (...x) => { al(...x); resolve() } })
  a.value.gonder(b4a.from([ZARF.REC_OPS, 1, 2]))
  await alindi
  const koptu = new Promise((resolve) => { const k = isl.koptu; isl.koptu = (p) => { k(p); resolve() } })
  o.kapat()
  await koptu
  const irem = b4a.toString(id('kerem'), 'hex')
  t.alike(olaylar, [['baglandi', irem, 512], ['al', ZARF.REC_OPS, '0102', 'dogrudan'], ['koptu', irem]])
  // RFC-0012 §8.4, §13: AFET_MSG misafir ve cihaz oturumlarında da geçer; bağ zarfları (0xB1–0xB5) hiçbir olağan oturumda
  t.is(ZARF.AFET_MSG, 0xb0)
  t.ok(zarf.typeAllowed('uye', 'misafir', ZARF.AFET_MSG, 'gelen'))
  t.ok(zarf.typeAllowed('uye', 'cihaz', ZARF.AFET_MSG, 'gelen'))
  t.ok(zarf.typeAllowed('uye', 'uye', ZARF.AFET_MSG, 'gelen'))
  for (const tur of [0xb1, 0xb2, 0xb3, 0xb4, 0xb5]) t.absent(zarf.typeAllowed('uye', 'uye', tur, 'gelen'), 'olağan oturumda ' + tur)
})

test('D84 B7, B8: dinle()\'den önce gelen çerçeveler sırayla verilir; olağan kapanışta son yazı karşıya ulaşır', async (t) => {
  const [a, b] = await bagla('kerem', 'husniye')
  const A = a.value
  const B = b.value
  A.gonder(b4a.from([M.Z.AFET_WANT, 0]))
  A.gonder(b4a.from([M.Z.AFET_DONE, 0]))
  await new Promise((resolve) => setTimeout(resolve, 20))
  const gelen = []
  B.dinle((x) => gelen.push(x[0]))
  t.alike(gelen, [M.Z.AFET_WANT, M.Z.AFET_DONE], 'dinleyiciden önce gelenler kaybolmadı')
  // son DONE yazılıp hemen kapatılır: karşı taraf yine alır
  const son = new Promise((resolve) => { B.dinleyici = (x) => resolve(x[0]) })
  A.gonder(b4a.from([M.Z.AFET_DONE, 0]))
  A.kapat()
  t.is(await son, M.Z.AFET_DONE)
  t.is(A.kapandi, 'BITTI')
  const kapandi = new Promise((resolve) => A.socket.once('close', resolve))
  B.kapat()
  await kapandi
  t.pass('iki taraf da kapatınca soket kapanır')
  // karşı hiç kapatmazsa süre sonunda zorla
  const [c, d] = await bagla('kerem', 'husniye')
  const zorla = new Promise((resolve) => c.value.socket.once('close', resolve))
  const tut = setTimeout(() => {}, 500)
  c.value.kapat('BITTI', { sureMs: 30 })
  await zorla
  clearTimeout(tut)
  d.value.kapat()
})

test('D87 madde 1: etiket listesi dilim başına bir kez; aynı dilimde iki okuma aynı, sonraki dilimde yeni (açıklama 2 madde 1)', (t) => {
  const k = new Y.EtiketKaynagi()
  const c = ciftler(L, KIMLIK.kerem).slice(0, 3)
  const a = k.liste({ ciftler: c, meId: id('kerem'), simdi: AN })
  const b = k.liste({ ciftler: c, meId: id('kerem'), simdi: AN + 60_000 })
  t.alike(a, b, 'dolgu ve sıra aynı: kesişim büyüklüğü sızdırmaz')
  b.tags[0][0] ^= 1
  t.alike(k.liste({ ciftler: c, meId: id('kerem'), simdi: AN }), a, 'dönen kopya değiştirilse de kaynak aynı')
  t.alike(k.liste({ ciftler: ciftler(L, KIMLIK.kerem), meId: id('kerem'), simdi: AN }), a, 'dilim içinde çift kümesi değişse de liste aynı')
  const d = k.liste({ ciftler: c, meId: id('kerem'), simdi: AN + 15 * 60_000 })
  t.not(d.slot, a.slot)
  t.unlike(d.tags, a.tags)
  t.unlike(k.liste({ ciftler: c, meId: id('irem'), simdi: AN + 15 * 60_000 }).tags, d.tags, 'başka kimlik')
})

test('boy sınırları (açılış öncesi inceleme): WANT ≤ 64, DONE ≤ 4096; bağda 256 KiB üstü çerçeve oturumu kapatır', (t) => {
  const mid = () => b4a.alloc(16, 1)
  const want = (n) => M.kodla(M.Z.AFET_WANT, { mids: Array.from({ length: n }, mid) })
  t.is(M.coz(M.Z.AFET_WANT, want(64)).mids.length, 64)
  t.exception(() => M.coz(M.Z.AFET_WANT, want(65)), /DISASTER_CORRUPT/)
  const done = (n) => M.kodla(M.Z.AFET_DONE, { items: Array.from({ length: n }, () => ({ mid: mid(), doneSecret: b4a.alloc(32, 2) })) })
  t.is(M.coz(M.Z.AFET_DONE, done(4096)).items.length, 4096)
  t.exception(() => M.coz(M.Z.AFET_DONE, done(4097)), /DISASTER_CORRUPT/)
  t.ok(1 + done(4096).byteLength <= 1 + M.SINIR.cerceve, 'en büyük meşru DONE çerçeve sınırının altında')

  const olay = {}
  let yokEdildi = false
  const soket = { on (ad, fn) { olay[ad] = fn }, once () {}, write () {}, end () {}, destroy () { yokEdildi = true } }
  const o = new Y.BagOturumu(soket, { bag: Y.BAG.BLUETOOTH, karsi: 'aa', rol: 'aile', caps: 0 })
  const gelen = []
  o.dinle((b) => gelen.push(b))
  olay.data(b4a.concat([b4a.from([M.Z.AFET_DONE]), b4a.alloc(M.SINIR.cerceve + 1)]))
  t.is(o.kapandi, 'DISASTER_LENGTH')
  t.ok(yokEdildi, 'hemen kapanır')
  t.is(gelen.length, 0, 'çerçeve dinleyiciye gitmez')
})

test('yerel ağ bağı olağan doğrudan oturumdur: 256 KiB üstü REC_OPS geçer, sınır taşıyıcınınki (1 MiB; Codex 12. tur)', (t) => {
  const kur = () => {
    const olay = {}
    const s = { yok: false, on (ad, fn) { olay[ad] = fn }, once () {}, write () {}, end () {}, destroy () { s.yok = true } }
    const o = new Y.BagOturumu(s, { bag: Y.BAG.YEREL, karsi: 'aa', rol: 'aile', caps: 0 })
    const gelen = []
    o.dinle((b) => gelen.push(b))
    return { o, s, gelen, al: (b) => olay.data(b) }
  }
  // records/sync.js onIds REC_OPS'u DIRECT_MAX'a (1 MiB) kadar paketler
  const a = kur()
  a.al(b4a.concat([b4a.from([ZARF.REC_OPS]), b4a.alloc(300 * 1024)]))
  t.is(a.o.kapandi, null, '300 KiB REC_OPS oturumu kapatmaz')
  t.is(a.gelen.length, 1, 'çerçeve dinleyiciye gider')
  a.al(b4a.concat([b4a.from([ZARF.REC_OPS]), b4a.alloc(Y.YEREL_CERCEVE)]))
  t.is(a.gelen.length, 2, 'tam 1 MiB gövde geçer')
  const b = kur()
  b.al(b4a.concat([b4a.from([ZARF.REC_OPS]), b4a.alloc(Y.YEREL_CERCEVE + 1)]))
  t.is(b.o.kapandi, 'DISASTER_LENGTH')
  t.ok(b.s.yok, 'taşıyıcı sınırının üstü hemen kapanır')
  t.is(Y.YEREL_CERCEVE, 1024 * 1024)
})
