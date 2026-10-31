// SPDX-License-Identifier: Apache-2.0
// D67 saldırı testleri (Mac, bağımsız inceleme). KIRMIZI olanlar doğrulanmış bulgulardır; düzeltmeden sonra yeşil
// olmalı. `sdk/test/` altına d67s-common.js ile birlikte konup `node` ya da `bare` ile koşar.
// Mac (kol/kasa-kurtarma-mac): RFC-0027 §9 a–f kararlarıyla yalnız şu uyarlamalar yapıldı: tutucu telefon onaydan önce
// kasayı açar (S1c, S4a; §9 a), döndüren ikinci okuyucu kasayı açar (S6; §9 b, B5: eski KRA'yı bilmeyen kilitli telefon
// döndüremez). Beklenenler değişmedi.
'use strict'
const test = require('brittle')
const b4a = require('b4a')
const sodium = require('sodium-native')
const { S, K, A, T, hex, H, DK, Z, hataOf, rastgele, id, ANAHTAR, kutuKur, ag, aile, sahtePay, payCevabi, surumCevabi, sahteIstek, KutuPaylari, taklitTpm } = require('./d67s-common')

// Kerem KRA'yı kurar (Kerem, Hüsniye, kutu, 1 kâğıt; eşik 2), telefonu sıfırlanır (kerem2), kurtarma başlar, kutu payı
// gelir; Hüsniye'nin isteği onay bekler
async function kurtarmaOrtasi (t) {
  const a = aile(t)
  let akit = ag(a.cihazlar)
  const kur = await a.kerem.setupRecoveryKey(a.kasaCid, rastgele(32), { kagit: 1 })
  akit()
  const kerem2 = new S.VaultApi({ ledger: a.L, me: A.K.kerem, now: a.now, uygunCihaz: a.uygunCihaz, anahtarDogrula: (h) => h === ANAHTAR })
  a.cihazlar[id('kerem')] = { api: kerem2 }
  akit = ag(a.cihazlar)
  const istekler = []
  a.husniye.on('vault', (x) => { if (x.type === 'pay_istegi') istekler.push(x) })
  kerem2.startRecovery({ tur: 'kra', collectionId: a.kasaCid })
  akit()
  return { ...a, kur, kerem2, akit, istekler }
}

test('S1a ORTA: pay sahibi olmayan bir üye (çocuk Ecem) istenmemiş bir KASA_SHARE_RES ile toplanan payları siler, sürümü 99 yapar; kâğıt artık STALE_VERSION', async (t) => {
  const x = await kurtarmaOrtasi(t)
  t.alike([x.kerem2.recoveryStatus().kurtarma.version, x.kerem2.recoveryStatus().kurtarma.paySayisi], [1, 1], 'kutunun payı geldi')
  const [sahte] = await sahtePay({ secretId: x.kasaCid, kind: K.pay.TUR.KRA, version: 99, holderler: [id('ecem'), id('irem')] })
  const r = x.kerem2.receiveShareReply(id('ecem'), payCevabi(sahte), 'dogrudan')
  t.not(r, 'eklendi', 'istenmemiş (Ecem\'e istek gitmedi) pay kabul edilmemeli')
  const d = x.kerem2.recoveryStatus().kurtarma
  t.alike([d.version, d.paySayisi], [1, 1], 'kutunun payı silinmemeli, sürüm değişmemeli')
  t.is(await hataOf(() => x.kerem2.recoveryShare({ kagit: x.kur.kagitlar[0].metin })), null, 'gerçek kâğıt (sürüm 1) eklenebilmeli')
  t.is(await hataOf(() => x.kerem2.finishRecovery()), null, 'kutu + kâğıt ile kurtarma bitmeli')
})

test('S1b ORTA: herhangi bir üyenin uydurma KASA_VERSION_RES\'i (sürüm 99) kurtarmayı kilitler: toplanan pay silinir, gerçek kâğıt STALE_VERSION', async (t) => {
  const x = await kurtarmaOrtasi(t)
  t.is(x.kerem2.recoveryStatus().kurtarma.paySayisi, 1)
  x.kerem2.receiveVersionReply(id('ecem'), surumCevabi(x.kasaCid, 99), 'dogrudan')
  t.is(x.kerem2.recoveryStatus().kurtarma.paySayisi, 1, 'tek üyenin sözüyle toplanan pay silinmemeli')
  t.is(await hataOf(() => x.kerem2.recoveryShare({ kagit: x.kur.kagitlar[0].metin })), null, 'gerçek kâğıt eklenebilmeli')
  t.is(await hataOf(() => x.kerem2.finishRecovery()), null, 'kutu + kâğıt ile kurtarma bitmeli')
})

test('S1c DÜŞÜK-ORTA: bir tutucunun ikinci (farklı) payı kabul ediliyor; birleştirme DUPLICATE_HOLDER ile bütünüyle düşer, çıkarma yolu yok', async (t) => {
  const x = await kurtarmaOrtasi(t)
  x.husniye.unlock(ANAHTAR) // §9 a: onay kasa açıkken
  t.alike(x.husniye.approveShare({ jeton: x.istekler[0].jeton, onay: true }), { durum: 'verildi' })
  x.akit()
  t.is(x.kerem2.recoveryStatus().kurtarma.paySayisi, 2)
  const [sahte] = await sahtePay({ secretId: x.kasaCid, kind: K.pay.TUR.KRA, version: 1, holderler: [id('husniye'), id('irem')] })
  const r = x.kerem2.receiveShareReply(id('husniye'), payCevabi(sahte), 'dogrudan')
  t.not(r, 'eklendi', 'aynı tutucudan ikinci pay alınmamalı (RFC-0021 c: her tutucudan en çok bir pay)')
  t.is(await hataOf(() => x.kerem2.finishRecovery()), null, 'kutu + Hüsniye\'nin ilk payı yeter')
})

test('S2 ORTA: 72 saat uyarısı (rotate_pending_share) hiçbir yere gitmiyor: PayTutucu.uyar telefonda ve kutuda bağlı değil', async (t) => {
  const saat = { v: A.TS0 + H }
  const now = () => saat.v
  const L = A.anaDefter()
  const irem = new S.VaultApi({ ledger: L, me: A.K.irem, now })
  const kerem = new S.VaultApi({ ledger: L, me: A.K.kerem, now })
  const husniye = new S.VaultApi({ ledger: L, me: A.K.husniye, now })
  const cihazlar = { [id('irem')]: { api: irem }, [id('kerem')]: { api: kerem }, [id('husniye')]: { api: husniye } }
  await irem.setupBackupKey(rastgele(32), { kisiler: [id('kerem'), id('husniye')], kagit: 1 })
  ag(cihazlar)()
  const tum = []
  for (const k of [kerem, husniye]) { const emit = k.emit.bind(k); k.emit = (ad, v) => { tum.push({ ad, v }); return emit(ad, v) } }
  // Kutu tarafı: uyar verilse bile KutuPaylari onu PayTutucu'ya geçirmiyor
  const kutuUyari = []
  const kutu = new KutuPaylari({ ledger: L, me: A.K.kutu, dizin: require('../../worklet/test/helpers/common').geciciDizin(t, 'd67s-uyar'), tpm: taklitTpm({ test: true, anahtar: rastgele(32) }), now, testKipi: true, uyar: (b, al) => kutuUyari.push({ b, al }) })
  L.apply(A.olay(L, T.ROTATE_DEVICE, { oldMemberId: A.K.irem.memberId, newDeviceCert: A.K.u5.deviceCert, ceremonyTranscriptHash: b4a.alloc(32, 7) }, [A.K.u5, A.K.kerem, A.K.husniye]))
  const yeni = new S.VaultApi({ ledger: L, me: A.K.u5, now })
  delete cihazlar[id('irem')]
  cihazlar[id('u5')] = { api: yeni }
  cihazlar[id('kutu')] = { tur: 'kutu', api: kutu }
  yeni.startRecovery({ tur: 'ya' })
  ag(cihazlar)()
  t.ok(tum.some((x) => x.ad === 'vault' && x.v.type === 'pay_istegi_bekliyor'), 'tutucu bekletti (yalnız kendi ekranına)')
  t.ok(tum.some((x) => (x.v && x.v.type === 'rotate_pending_share')), 'eski cihaza, kişinin kimliklerine ve ebeveynlere rotate_pending_share gitmeli (RFC-0021 a)')
  t.ok(kutuUyari.length > 0, 'kutu da uyarmalı')
})

test('S3 DÜŞÜK-ORTA: 405 kilit süresi dolmuşken pay veriyor (payOnayla kilitli() sormuyor)', async (t) => {
  const x = aile(t)
  const akit0 = ag(x.cihazlar)
  await x.kerem.setupRecoveryKey(x.kasaCid, rastgele(32), { kagit: 1 })
  akit0()
  x.husniye.unlock(ANAHTAR)
  const kerem2 = new S.VaultApi({ ledger: x.L, me: A.K.kerem, now: x.now, uygunCihaz: x.uygunCihaz })
  x.cihazlar[id('kerem')] = { api: kerem2 }
  const istekler = []
  x.husniye.on('vault', (e) => { if (e.type === 'pay_istegi') istekler.push(e) })
  kerem2.startRecovery({ tur: 'kra', collectionId: x.kasaCid })
  ag(x.cihazlar)()
  t.is(istekler.length, 1)
  x.saat.v += 6 * DK // 5 dakikalık kilit süresi doldu; hiçbir kasa işlemi kilitli()'yi çağırmadı
  t.is(await hataOf(() => x.husniye.approveShare({ jeton: istekler[0].jeton, onay: true })), 'VAULT_LOCKED', 'kasa kilitliyken 405 pay vermemeli (RFC-0027 §9 a)')
})

test('S4a ORTA: LOCK kurtarılan sırrı silmiyor; 402 kilitlendikten sonra YA\'yı (sirHex) yeniden veriyor', async (t) => {
  const saat = { v: A.TS0 + H }
  const now = () => saat.v
  const L = A.anaDefter()
  const irem = new S.VaultApi({ ledger: L, me: A.K.irem, now })
  const kerem = new S.VaultApi({ ledger: L, me: A.K.kerem, now, anahtarDogrula: (h) => h === ANAHTAR })
  const husniye = new S.VaultApi({ ledger: L, me: A.K.husniye, now, anahtarDogrula: (h) => h === ANAHTAR })
  const cihazlar = { [id('irem')]: { api: irem }, [id('kerem')]: { api: kerem }, [id('husniye')]: { api: husniye } }
  await irem.setupBackupKey(rastgele(32), { kisiler: [id('kerem'), id('husniye')], kagit: 1 })
  ag(cihazlar)()
  for (const k of [kerem, husniye]) k.unlock(ANAHTAR) // §9 a: onay kasa açıkken
  const irem2 = new S.VaultApi({ ledger: L, me: A.K.irem, now, anahtarDogrula: (h) => h === ANAHTAR })
  cihazlar[id('irem')] = { api: irem2 }
  const akit = ag(cihazlar)
  irem2.unlock(ANAHTAR)
  const ist = []
  for (const k of [kerem, husniye]) k.on('vault', (e) => { if (e.type === 'pay_istegi') ist.push([k, e.jeton]) })
  irem2.startRecovery({ tur: 'ya' })
  akit()
  for (const [k, j] of ist) k.approveShare({ jeton: j, onay: true })
  akit()
  const ilk = await irem2.finishRecovery()
  t.ok(ilk.sirHex)
  const sir = irem2._kurtarma.sir
  irem2.lock() // 19 LOCK
  t.ok(sodium.sodium_is_zero(sir), 'LOCK kurtarılan sırrı bellekte sıfırlamalı (RFC-0027 §5 b)')
  const tekrar = await hataOf(async () => { const r = await irem2.finishRecovery(); if (r.sirHex) throw new Error('SECRET_REISSUED') })
  t.not(tekrar, 'SECRET_REISSUED', 'kilitliyken 402 sırrı yeniden vermemeli')
})

test('S4b DÜŞÜK-ORTA: onaylanmış ama gönderilememiş pay (KASA_SHARE_RES baytları) LOCK\'tan sonra da bellekte duruyor', async (t) => {
  const x = await (async () => {
    const a = aile(t)
    ag(a.cihazlar)()
    await a.kerem.setupRecoveryKey(a.kasaCid, rastgele(32), { kagit: 1 })
    ag(a.cihazlar)()
    return a
  })()
  x.husniye.unlock(ANAHTAR)
  const kerem2 = new S.VaultApi({ ledger: x.L, me: A.K.kerem, now: x.now, uygunCihaz: x.uygunCihaz })
  kerem2.startRecovery({ tur: 'kra', collectionId: x.kasaCid })
  // Sürüm cevabı ve pay isteği elle; sonra istekçi çevrimdışı
  const soru = kerem2.recoveryOutgoing().find((g) => g.to === id('husniye'))
  kerem2.receiveVersionReply(id('husniye'), x.husniye.receiveVersionRequest(id('kerem'), soru.bytes, 'dogrudan').bytes, 'dogrudan')
  const istek = kerem2.recoveryOutgoing().find((g) => g.type === Z.KASA_SHARE_REQ && g.to === id('husniye'))
  const r = x.husniye.receiveShareRequest(id('kerem'), istek.bytes, 'dogrudan')
  t.alike(x.husniye.approveShare({ jeton: r.jeton, onay: true }), { durum: 'verildi' })
  x.husniye.lock()
  t.absent(x.husniye.recoveryOutgoing().some((g) => g.type === Z.KASA_SHARE_RES), 'kilitliyken pay baytı bellekte kalmamalı (arsive mühürlenmeli ya da atılmalı)')
})

test('S4c ORTA: kilitli (çalınmış) bir okuyucu telefonu KRA\'yı bilmeden 400 + 403 ile döndürüyor; tutucular eski sürümü siler, var olan zarf öksüz kalır', async (t) => {
  const x = aile(t)
  const akit = ag(x.cihazlar)
  const kra = rastgele(32)
  await x.kerem.setupRecoveryKey(x.kasaCid, b4a.from(kra), { kagit: 1 })
  akit()
  t.ok(x.husniye.locked(), 'Hüsniye\'nin kasası kilitli')
  x.husniye.startRecovery({ tur: 'kra', collectionId: x.kasaCid })
  akit()
  const e = await hataOf(() => x.husniye.rotateVault({ tur: 'kra', collectionId: x.kasaCid }))
  t.not(e, null, 'kilitliyken ya da eski KRA bilinmeden döndürme yapılmamalı (zarf yeniden şifrelenemez)')
  akit()
  t.alike(x.kutu.liste(), [x.kasaCid + '|1'], 'kutu eski sürümü (zarfı açan) tutmaya devam etmeli')
})

test('S5 ORTA: 72 saat beklemesindeki yeni cihaz, pay alamadan 400 + 403 ile sahibin YA paylarını sildiriyor (beklemenin dolanımı)', async (t) => {
  const saat = { v: A.TS0 + H }
  const now = () => saat.v
  const L = A.anaDefter()
  const irem = new S.VaultApi({ ledger: L, me: A.K.irem, now })
  const kerem = new S.VaultApi({ ledger: L, me: A.K.kerem, now })
  const husniye = new S.VaultApi({ ledger: L, me: A.K.husniye, now })
  const cihazlar = { [id('irem')]: { api: irem }, [id('kerem')]: { api: kerem }, [id('husniye')]: { api: husniye } }
  const kur = await irem.setupBackupKey(rastgele(32), { kisiler: [id('kerem'), id('husniye')], kagit: 1 })
  ag(cihazlar)()
  for (const c of [kerem, husniye]) c.tutucu.gozle()
  // Eski cihaz imzalamadan ROTATE_DEVICE (72 saat kuralı)
  L.apply(A.olay(L, T.ROTATE_DEVICE, { oldMemberId: A.K.irem.memberId, newDeviceCert: A.K.u5.deviceCert, ceremonyTranscriptHash: b4a.alloc(32, 7) }, [A.K.u5, A.K.kerem, A.K.husniye]))
  const yeni = new S.VaultApi({ ledger: L, me: A.K.u5, now })
  delete cihazlar[id('irem')]
  cihazlar[id('u5')] = { api: yeni }
  const akit = ag(cihazlar)
  const sid = yeni.startRecovery({ tur: 'ya' }).secretId
  akit()
  t.is(yeni.recoveryStatus().kurtarma.paySayisi, 0, 'pay verilmedi (bekleme)')
  t.is(yeni.recoveryStatus().kurtarma.version, 1, 'ama sürüm sorusu cevaplandı')
  const don = await hataOf(() => yeni.rotateVault({ tur: 'ya', kisiler: [id('kerem'), id('husniye')], kagit: 1 }))
  akit()
  t.alike([...kerem.tutucu.paylar.keys()], [sid + '|1'], 'bekleme bitmeden yeni cihaz sahibin paylarını değiştirememeli (döndürme reddi: ' + don + ')')
  t.ok(kur.kagitlar.length)
})

test('S6 ORTA: iki okuyucu aynı anda döndürünce paylar iki ayrı sürüm 2\'ye bölünüyor; RFC-0004 §6 eşitlik kuralı (kraKazanan) uygulanmıyor', async (t) => {
  const x = aile(t)
  const hatalar = []
  const akit = ag(x.cihazlar, hatalar)
  await x.kerem.setupRecoveryKey(x.kasaCid, rastgele(32)) // Kerem, Hüsniye, kutu; eşik 2
  akit()
  x.husniye.startRecovery({ tur: 'kra', collectionId: x.kasaCid })
  akit()
  t.is(x.husniye.recoveryStatus().kurtarma.version, 1)
  // İkisi birbirini görmeden döndürür (Hüsniye eski KRA'yı bilmez: kasayı açar, zarf dönem anahtarlarından; §9 b)
  x.husniye.unlock(ANAHTAR)
  const a = await x.kerem.rotateVault({ tur: 'kra', collectionId: x.kasaCid })
  const b = await x.husniye.rotateVault({ tur: 'kra', collectionId: x.kasaCid })
  t.alike([a.version, b.version], [2, 2])
  akit()
  const commitOf = (tut) => { const v = tut.paylar.get(x.kasaCid + '|2'); return v ? hex(v.share.commit) : null }
  const c = [commitOf(x.kerem.tutucu), commitOf(x.husniye.tutucu), commitOf(x.kutu.tutucu)]
  t.comment('hatalar: ' + [...new Set(hatalar.map((h) => h.hata))].join(','))
  t.ok(c.every((v) => v && v === c[0]), 'bütün tutucular aynı sürüm 2 dağıtımında birleşmeli (bugün: ' + c.map((v) => v && v.slice(0, 6)).join(' / ') + ')')
})

test('S7 ORTA: eski kâğıtlarla (sürüm 1) kurtarılınca döndürme sürüm 2\'yi yeniden üretir; tutucuların gerçek sürüm 2\'siyle çakışır (DUPLICATE_HOLDER), yeni YA dağıtılamaz', async (t) => {
  const saat = { v: A.TS0 + H }
  const now = () => saat.v
  const L = A.anaDefter()
  const irem = new S.VaultApi({ ledger: L, me: A.K.irem, now })
  const kerem = new S.VaultApi({ ledger: L, me: A.K.kerem, now })
  const husniye = new S.VaultApi({ ledger: L, me: A.K.husniye, now })
  const cihazlar = { [id('irem')]: { api: irem }, [id('kerem')]: { api: kerem }, [id('husniye')]: { api: husniye } }
  const v1 = await irem.setupBackupKey(rastgele(32), { yalnizKagit: true }) // iki kâğıt
  const v2 = await irem.rotateVault({ tur: 'ya', kisiler: [id('kerem'), id('husniye')], kagit: 1 })
  ag(cihazlar)()
  t.is(v2.version, 2)
  // İrem'in telefonu sıfırlandı; çekmecede eski iki kâğıt (sürüm 1) var
  const irem2 = new S.VaultApi({ ledger: L, me: A.K.irem, now })
  cihazlar[id('irem')] = { api: irem2 }
  const hatalar = []
  const akit = ag(cihazlar, hatalar)
  irem2.startRecovery({ tur: 'ya' })
  for (const k of v1.kagitlar) irem2.recoveryShare({ kagit: k.metin })
  await irem2.finishRecovery() // sürüm 1 YA (eski)
  akit() // sürüm 2 cevapları şimdi gelir: k.sir dolu olduğu için yok sayılır
  const don = await irem2.rotateVault({ tur: 'ya', kisiler: [id('kerem'), id('husniye')], kagit: 1 })
  akit()
  t.comment('döndürme sürümü ' + don.version + '; tutucu hataları: ' + [...new Set(hatalar.map((h) => h.hata))].join(','))
  t.ok(don.version > 2, 'döndürme bilinen en büyük sürümün (2) üstüne çıkmalı')
  t.ok(irem2.status().ya.sahipler.every((s) => s.tur === 'kagit' || s.teslim), 'yeni YA\'nın payları teslim edilebilmeli')
})

test('S8 DÜŞÜK: kilitli tutucu yetkisiz istekçiyi de kullanıcıya soruyor (YA sahibi / KRA okuyucusu / 72 saat / günlük sınır denetimi atlanıyor); istekler sınırsız birikiyor', async (t) => {
  const x = aile(t)
  await x.kerem.setupRecoveryKey(x.kasaCid, rastgele(32), { kagit: 1 })
  ag(x.cihazlar)()
  x.husniye.tutucu.paylar.clear() // kilitliyken paylar arsivde
  t.ok(x.husniye.locked())
  const olay = []
  x.husniye.on('vault', (e) => { if (e.type === 'pay_istegi') olay.push(e) })
  // Okuyucu olmayan çocuk Ecem, kasa payını ister
  const b = K.istek.payIste(x.L.familyId, { secretId: b4a.from(x.kasaCid, 'hex'), kind: K.pay.TUR.KRA, version: 1, holderId: A.K.husniye.memberId, at: x.saat.v }, A.K.ecem)
  const r = x.husniye.receiveShareRequest(id('ecem'), b, 'dogrudan')
  t.alike(r, { durum: 'red', red: 'UNAUTHORIZED' }, 'okuyucu olmayanın isteği kullanıcıya sorulmamalı (bugün: ' + JSON.stringify(r) + ')')
  t.is(olay.length, 0)
  // Yetkili istekçiden 30 istek: 30 ayrı onay ekranı
  for (let i = 0; i < 30; i++) {
    x.saat.v += 1000
    x.husniye.receiveShareRequest(id('kerem'), K.istek.payIste(x.L.familyId, { secretId: b4a.from(x.kasaCid, 'hex'), kind: K.pay.TUR.KRA, version: 1, holderId: A.K.husniye.memberId, at: x.saat.v }, A.K.kerem), 'dogrudan')
  }
  t.ok(x.husniye.recoveryStatus().istekler.length <= 1, 'aynı istekçi ve sır için bekleyen tek istek olmalı (bugün ' + x.husniye.recoveryStatus().istekler.length + ')')
  x.saat.v += 11 * DK
  x.husniye.receiveShareRequest(id('kerem'), K.istek.payIste(x.L.familyId, { secretId: b4a.from(x.kasaCid, 'hex'), kind: K.pay.TUR.KRA, version: 1, holderId: A.K.husniye.memberId, at: x.saat.v }, A.K.kerem), 'dogrudan')
  t.ok(x.husniye._kilitliIstek.size <= 1, 'süresi dolan kilitli isteklerin baytları da silinmeli (bugün ' + x.husniye._kilitliIstek.size + ')')
})

test('S9 DÜŞÜK: kilitliyken gelen istek, kilit 5 dakikadan sonra açılınca REQUEST_STALE ile düşüyor (RFC-0021 b: tazelik yalnız ilk denetimde, onay 10 dakika)', async (t) => {
  const x = aile(t)
  await x.kerem.setupRecoveryKey(x.kasaCid, rastgele(32), { kagit: 1 })
  ag(x.cihazlar)()
  const sakli = new Map(x.husniye.tutucu.paylar)
  x.husniye.tutucu.paylar.clear()
  const istek = K.istek.payIste(x.L.familyId, { secretId: b4a.from(x.kasaCid, 'hex'), kind: K.pay.TUR.KRA, version: 1, holderId: A.K.husniye.memberId, at: x.saat.v }, A.K.kerem)
  const r = x.husniye.receiveShareRequest(id('kerem'), istek, 'dogrudan')
  t.is(r.durum, 'onay')
  x.saat.v += 6 * DK // kullanıcı bildirime 6 dakika sonra bakıp biyometriyle açtı
  x.husniye.unlock(ANAHTAR)
  for (const [k, v] of sakli) x.husniye.tutucu.paylar.set(k, v)
  t.alike(x.husniye.approveShare({ jeton: r.jeton, onay: true }), { durum: 'verildi' })
})

test('S10 DÜŞÜK: sürüm sorusu yetkisiz: pay sahibi olmayan çocuk, kasanın kimde olduğunu, sürümünü, eşiğini ve pay sayısını öğreniyor (kutu ve kilitli telefon dahil)', async (t) => {
  const x = aile(t)
  await x.kerem.setupRecoveryKey(x.kasaCid, rastgele(32), { kagit: 1 })
  ag(x.cihazlar)()
  const soru = K.istek.surumIste(b4a.from(x.kasaCid, 'hex'))
  const kutuCev = x.kutu.surumIstegiAl(id('ecem'), soru, 'dogrudan')
  const telCev = x.husniye.receiveVersionRequest(id('ecem'), soru, 'dogrudan')
  t.comment('kutu: ' + (kutuCev && JSON.stringify({ ...K.istek.surumCevabiCoz(kutuCev.bytes), secretId: undefined })))
  t.is(kutuCev, null, 'KRA okuyucusu olmayana sürüm cevabı verilmemeli')
  t.is(telCev, null)
})

test('S11 DÜŞÜK: 403 YA\'da `sahip` seçeneği yaDagitimi\'ne geçiyor: sahibin kendisi kendi YA\'sının payını tutuyor (yaKur bunu YETKISIZ ile reddeder)', async (t) => {
  const x = aile(t)
  const irem = new S.VaultApi({ ledger: x.L, me: A.K.irem, now: x.now })
  await irem.setupBackupKey(rastgele(32), { kisiler: [id('kerem'), id('husniye')], kagit: 1 })
  let don = null
  const e = await hataOf(async () => { don = await irem.rotateVault({ tur: 'ya', sahip: id('kerem') }) })
  t.is(e, 'UNAUTHORIZED', 'başkasının adıyla dağıtım reddedilmeli' + (don ? ' (bugün sahipler: ' + don.dagitim.sahipler.map((s) => s.ad || s.tur).join(', ') + ')' : ''))
})

test('S12 DÜŞÜK: kutu her pay isteğinde (imzası bozuk olanda da) TPM ile mühürleyip diske yazıyor: her üye kutuya sınırsız TPM işi yaptırabilir', async (t) => {
  const saat = { v: A.TS0 + H }
  const L = A.anaDefter()
  const tpm = taklitTpm({ test: true, anahtar: rastgele(32) })
  const orj = tpm.muhurle
  let n = 0
  tpm.muhurle = function (b) { n++; return orj.call(this, b) }
  const { kutu } = kutuKur(t, L, saat, { tpm })
  const kasaCid = [...L.collections.values()].find((c) => c.sensitivity === 'kasa').id
  for (let i = 0; i < 20; i++) {
    const b = sahteIstek(L.familyId, { secretId: kasaCid, kind: 1, version: 1, requesterId: id('kerem'), holderId: id('kutu'), at: saat.v }, A.K.ecem)
    t.is(kutu.payIstegiAl(id('ecem'), b, 'dogrudan'), null)
  }
  t.is(n, 0, 'durum değişmeyen (reddedilen) istek mühürlü yazım yapmamalı (bugün ' + n + ')')
})

test('S13 DÜŞÜK: 403 dağıtım ya da zarf hatasında yeni sır sıfırlanmadan bırakılıyor', async (t) => {
  const x = aile(t)
  const irem = new S.VaultApi({ ledger: x.L, me: A.K.irem, now: x.now })
  await irem.setupBackupKey(rastgele(32), { kisiler: [id('kerem'), id('husniye')], kagit: 1 })
  const orj = K.dondurme.yeniSir
  let yakalanan = null
  K.dondurme.yeniSir = () => { yakalanan = orj(); return yakalanan }
  try {
    t.is(await hataOf(() => irem.rotateVault({ tur: 'ya', kisiler: [id('ecem')] })), 'NOT_SHARE_OWNER_ELIGIBLE')
  } finally { K.dondurme.yeniSir = orj }
  t.ok(yakalanan && sodium.sodium_is_zero(yakalanan), 'hata yolunda yeni sır sıfırlanmalı')
})

test('S14 YÜKSEK (yalnız Bare; D62\'den, D67\'nin günlük sınırını da etkiler): Bare\'de kutu yeniden başlatılınca mühürlü paylar yüklenemiyor, KutuPaylari "Incorrect buffer size" ile açılmıyor', async (t) => {
  const saat = { v: A.TS0 + H }
  const L = A.anaDefter()
  const kasaCid = [...L.collections.values()].find((c) => c.sensitivity === 'kasa').id
  const kutuId = id('kutu')
  const kerem = new S.VaultApi({ ledger: L, me: A.K.kerem, now: () => saat.v, uygunCihaz: (x) => x === kutuId })
  const k1 = kutuKur(t, L, saat)
  await kerem.setupRecoveryKey(kasaCid, rastgele(32), { kagit: 1 })
  ag({ [id('kerem')]: { api: kerem }, [kutuId]: { tur: 'kutu', api: k1.kutu } })()
  const istek = () => K.istek.payIste(L.familyId, { secretId: b4a.from(kasaCid, 'hex'), kind: 1, version: 1, holderId: A.K.kutu.memberId, at: saat.v }, A.K.kerem)
  t.ok(k1.kutu.payIstegiAl(id('kerem'), istek(), 'dogrudan'), 'ilk istek: pay')
  let k2 = null
  t.is(await hataOf(() => { k2 = kutuKur(t, L, saat, { dizin: k1.dizin, tpm: k1.tpm }).kutu }), null, 'kutu yeniden başlayabilmeli (Bare: JSON.stringify(Buffer) dizi verir, kodla/coz { $h } yapmıyor)')
  if (!k2) return
  t.alike(k2.liste(), [kasaCid + '|1'], 'pay mühürden geri gelir')
  t.is(k2.payIstegiAl(id('kerem'), istek(), 'dogrudan'), null, 'günlük sınır mühürlü dosyadan')
})

test('S8b DÜŞÜK: süresi dolan kilitli isteğin jetonuyla 405, TypeError ile çöküyor (_istekler silinmiş, _kilitliIstek kalmış)', async (t) => {
  const x = aile(t)
  await x.kerem.setupRecoveryKey(x.kasaCid, rastgele(32), { kagit: 1 })
  ag(x.cihazlar)()
  const sakli = new Map(x.husniye.tutucu.paylar)
  x.husniye.tutucu.paylar.clear()
  const ist = () => K.istek.payIste(x.L.familyId, { secretId: b4a.from(x.kasaCid, 'hex'), kind: 1, version: 1, holderId: A.K.husniye.memberId, at: x.saat.v }, A.K.kerem)
  const r1 = x.husniye.receiveShareRequest(id('kerem'), ist(), 'dogrudan')
  x.saat.v += 11 * DK
  x.husniye.receiveShareRequest(id('kerem'), ist(), 'dogrudan') // temizlik: ilk isteğin _istekler kaydı silinir
  x.husniye.unlock(ANAHTAR)
  for (const [k, v] of sakli) x.husniye.tutucu.paylar.set(k, v)
  let r = null
  const e = await hataOf(() => { r = x.husniye.approveShare({ jeton: r1.jeton, onay: true }) })
  t.is(e, null, 'fırlatmamalı (bugün: ' + e + ')')
  t.alike(r, { durum: 'red', red: 'NO_APPROVAL' })
})
