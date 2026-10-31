// SPDX-License-Identifier: Apache-2.0
// D23: Yuva Defteri L13 dilim 3'ten SDK eksikleri 3 (kollar/D-cekirdek.md D23). Beklenenler elle yazıldı.
const test = require('brittle')
const b4a = require('b4a')
const S = require('..')
const K = require('@havenfold/vault')
const A = require('../../core/records/test/helpers/family')

const hex = (b) => b4a.toString(b, 'hex')
const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const hataOfA = async (fn) => { try { await fn(); return null } catch (err) { return err.message } }
const TA = hex(A.K_TUM_AILE)
const KASA = hex(A.K_KASA)
const ANAHTAR = 'ab'.repeat(32)
const id = (k) => hex(k.memberId)

function kur (kim = A.K.kerem) {
  const L = A.anaDefter()
  const saat = { t: A.TS0 + 3_600_000 }
  const kasa = new S.VaultApi({ ledger: L, me: kim, now: () => saat.t, anahtarDogrula: (h) => h === ANAHTAR })
  const kayit = new S.RecordApi({ replika: A.replika(L, kim, { now: () => saat.t }), kasa, dosyaYaz: () => '/platform/dosya' })
  return { L, kasa, kayit, saat }
}

test('(29) kilit: 224 ile açılır, 19 ile kapanır, 5 dakika işlemsizlikte kendiliğinden; kilitliyken kasa koleksiyonu VAULT_LOCKED', (t) => {
  const { kasa, kayit, saat } = kur(A.K.husniye) // kasanın dönem anahtarını ilk okuyucu üretir
  t.alike(Object.fromEntries(Object.entries(S.VAULT_COMMAND).filter(([, n]) => n < 387)), { LOCK: 19, UNLOCK: 224, VAULT_STATUS: 365, VAULT_PAPER_SHARE: 366, VAULT_PAPER_PRINTED: 367, VAULT_PERSONAL: 368, VAULT_CHILD_BACKUP: 369 }, '387 ve 388 D33 testinde')
  t.ok(kasa.locked(), 'başta kilitli')
  t.is(hataOf(() => kayit.put(KASA, null, 'yuva.defter.not', { metin: 'x' })), 'VAULT_LOCKED')
  t.is(hataOf(() => kayit.query(KASA)), 'VAULT_LOCKED')
  t.ok(kayit.put(TA, null, 'yuva.defter.not', { metin: 'x' }), 'kasa olmayan koleksiyon etkilenmez')
  t.is(hataOf(() => kasa.unlock('zz')), 'INVALID_KEY')
  t.is(hataOf(() => kasa.unlock('cd'.repeat(32))), 'WRONG_LOCK_KEY')
  kasa.unlock(ANAHTAR)
  t.absent(kasa.locked())
  const { blobRef } = kayit.attach({ bytes: b4a.from('tapu') })
  const rid = kayit.put(KASA, null, 'yuva.defter.belge', { dosya: blobRef })
  saat.t += 4 * 60_000
  t.ok(kayit.get(KASA, rid), 'işlem süreyi yeniler')
  saat.t += 4 * 60_000
  t.ok(kayit.history(KASA, rid).length, '4 dakika sonra hâlâ açık')
  saat.t += 5 * 60_000
  t.is(hataOf(() => kayit.get(KASA, rid)), 'VAULT_LOCKED', '5 dakika işlemsizlik')
  t.is(hataOf(() => kayit.open(blobRef)), 'VAULT_LOCKED', 'kasa kaydındaki dosya açılmaz')
  kasa.unlock(ANAHTAR)
  t.alike(kayit.open(blobRef), { path: '/platform/dosya' })
  kasa.lock()
  t.ok(kasa.locked())
})

test('(33) open: dosyaYaz kancası varken de { bytes: true } ile bayt; eski parça dizisi biçimi çalışır', (t) => {
  const { kayit } = kur()
  const a = kayit.attach({ bytes: b4a.from('fatura') })
  t.alike(kayit.open(a.blobRef), { path: '/platform/dosya' })
  t.alike(kayit.open(a.blobRef, { bytes: true }).bytes, b4a.from('fatura'))
  t.alike(kayit.open(a.blobRef, kayit.depo.get(hex(a.blobRef.blobId))), { path: '/platform/dosya' })
})

test('(29) YA dağıtımı: yetişkinde diğer ebeveyn ve yetişkinler + kâğıt; çocukta ebeveynler + kâğıt ya da yalnız kâğıt', (t) => {
  const { kasa } = kur()
  const d = kasa.bkDistribution()
  t.alike([d.t, d.n, d.kurulur], [2, 3, true])
  t.alike(d.sahipler.map((s) => [s.tur, s.ad]).sort(), [['kagit', 'Kâğıt 1'], ['kisi', A.anaDefter().members.get(id(A.K.husniye)).name], ['kisi', A.anaDefter().members.get(id(A.K.irem)).name]].sort())
  const c = kasa.childBackup(id(A.K.ecem))
  t.alike(c.sahipler.filter((s) => s.tur === 'kisi').map((s) => s.id).sort(), [id(A.K.kerem), id(A.K.husniye)].sort(), 'çocukta ebeveynler')
  t.alike([c.t, c.n], [2, 3])
  const k = kasa.childBackup(id(A.K.ecem), { yalnizKagit: true })
  t.alike(k.sahipler.map((s) => s.tur), ['kagit', 'kagit'])
  t.is(hataOf(() => kasa.childBackup(id(A.K.irem))), 'NOT_CHILD')
})

test('(29) YA kurulumu: paylar ve kâğıt satırları; sır sıfırlanır; iki pay sırrı verir; kâğıt basıldı; sürüm artar', async (t) => {
  const { kasa, L } = kur()
  const sir = b4a.alloc(32, 7)
  const r = await kasa.setupBackupKey(sir)
  t.ok(sir.every((x) => x === 0), 'sır bellekte sıfırlandı')
  t.is(r.version, 1)
  t.is(r.paylar.length, 2)
  t.is(r.kagitlar.length, 1)
  const kg = r.kagitlar[0]
  t.ok(kg.metin.startsWith('hfk1:') && kg.qr === kg.metin)
  t.is(kg.satirlar[0], 'hfk1:')
  t.is(kg.satirlar.slice(1).join('').replace(/ /g, ''), kg.metin.slice(5), 'satırlar metnin kendisi')
  t.ok(kg.baslik.endsWith('Kasa payı 1/1, sürüm 1'))
  const geri = await K.pay.birlestir([K.pay.decodeShare(r.paylar[0].bytes), K.pay.kagitCoz(kg.metin)], { secretId: b4a.from(r.secretId, 'hex'), kind: K.pay.TUR.YA, version: 1 })
  t.alike(geri, b4a.alloc(32, 7))
  const me = L.canonical(id(A.K.kerem))
  t.alike(kasa.status().ya.eksikKagit, [1])
  kasa.paperPrinted('ya:' + me, 1)
  t.alike(kasa.status().ya.eksikKagit, [])
  t.is(hataOf(() => kasa.paperPrinted('ya:' + me, 2)), 'NO_PAPER')
  t.is((await kasa.setupBackupKey(b4a.alloc(32, 8))).version, 2)
  t.alike(kasa.status().ya.eksikKagit, [1], 'yeni sürümün kâğıdı basılmadı')
  t.is(await hataOfA(() => kasa.setupBackupKey(b4a.alloc(31))), 'INVALID_SECRET')
})

test('(29) KRA: kasa koleksiyonunun okuyucuları; kâğıtsız tek okuyucu kurulamaz; durum kasaları listeler', async (t) => {
  const { kasa } = kur()
  t.is(await hataOfA(() => kasa.setupRecoveryKey(KASA, b4a.alloc(32, 1))), 'NOT_RECOVERABLE_ON_LOST_PHONE', 'iki ebeveyn, kâğıt yok')
  const r = await kasa.setupRecoveryKey(KASA, b4a.alloc(32, 1), { kagit: 1 })
  t.alike([r.dagitim.t, r.dagitim.n, r.paylar.length, r.kagitlar.length], [2, 3, 1, 1], 'kurucunun kendi payı gönderilmez, tutucusuna yazılır (D31)')
  const d = kasa.status()
  const k = d.kasalar.find((x) => x.collectionId === KASA)
  t.alike([k.kurulu.version, k.kurulu.t, k.kurulu.dondurmeGerekli], [1, 2, false])
  t.is(d.kilitli, true)
})

test('(31) çıkanlar: kim, rol, zaman, nasıl, adı geçen koleksiyonlar; kasa durumunda döndürme gerekir', async (t) => {
  const { L, kasa } = kur()
  await kasa.setupBackupKey(b4a.alloc(32, 3)) // Hüsniye ve İrem pay sahibi
  const ts = A.TS0 + 7_200_000
  const d = new S.LedgerApi({ ledger: L, me: A.K.kerem, now: () => ts })
  const r = d.removeMember(id(A.K.irem), { reason: 'x', wipe: true })
  const d2 = new S.LedgerApi({ ledger: L, me: A.K.husniye, now: () => ts })
  const oid = d2.oneriler.add(r.event, ts)
  t.is(d2.sign(oid).durum, 'uygulandi')
  const c = d.departed()
  t.alike(c, [{ memberId: id(A.K.irem), name: L.members.get(id(A.K.irem)).name, role: 'yetiskin', cikis: ts, tur: 'cikarildi', wipe: true, koleksiyonlar: [hex(A.K_KISISEL_IREM)] }])
  t.alike(d.departed({ rol: 'ebeveyn' }), [])
  t.is(kasa.status().ya.dondurmeGerekli, true, 'pay sahibi çıktı')
})

test('(30) duyarlılık: kişisel koleksiyonu sahibi kasaya alır; ortak koleksiyon bütün ebeveynleri ister; Benim kasam', (t) => {
  const L = A.anaDefter()
  const irem = new S.LedgerApi({ ledger: L, me: A.K.irem, now: () => A.TS0 + 60_000 })
  t.is(irem.setSensitivity(hex(A.K_KISISEL_IREM), 'kasa').durum, 'uygulandi')
  const col = L.collections.get(hex(A.K_KISISEL_IREM))
  t.alike([col.sensitivity, col.taskAccess, col.name, col.kind], ['kasa', false, 'Kişisel', 'kisisel'])
  t.is(hataOf(() => irem.setSensitivity(hex(A.K_KISISEL_IREM), 'kasa')), 'NO_CHANGE')
  const kerem = new S.LedgerApi({ ledger: L, me: A.K.kerem, now: () => A.TS0 + 60_000 })
  t.is(kerem.setSensitivity(TA, 'kasa').durum, 'oneri', 'iki ebeveyn gerekir')
  t.is(hataOf(() => kerem.setSensitivity('ff'.repeat(16), 'kasa')), 'NO_COLLECTION')
  const h = new S.LedgerApi({ ledger: L, me: A.K.husniye, now: () => A.TS0 + 60_000 })
  t.is(h.myPersonalVault().durum, 'uygulandi')
  const bk = [...L.collections.values()].find((x) => x.name === 'Benim kasam')
  t.alike([bk.kind, bk.sensitivity, bk.readers, bk.taskAccess], ['kisisel', 'kasa', ['uye:' + id(A.K.husniye)], false])
})
