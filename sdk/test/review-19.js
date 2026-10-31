// SPDX-License-Identifier: Apache-2.0
// İnceleme 19 ve RFC-0027 §9 (Mac, kol/kasa-kurtarma-mac): d67s-attack.js'nin dışında kalan kararlar. Beklenenler elle.
//   §9 b  KRA zarfı kasa koleksiyonunda 'hf.kasa.zarf' kaydı; dönem değişiminde yeniden yazılır; kurtarmada açılan dönem
//         anahtarları replikaya girer
//   §9 e  eşzamanlı döndürmede kaybeden geri çeker (gönderilecekler, KRA ve zarf silinir)
//   §9 f  bilinen daha yeni sürüm varken eski sürümle kurtarma bitmez; görülen en büyük sürüm saklanır
//   B1    72 saat beklemesindeki gönderici pay dağıtamaz (tutucu tarafı)
'use strict'
const test = require('brittle')
const b4a = require('b4a')
const sodium = require('sodium-native')
const c = require('compact-encoding')
const S = require('..')
const K = require('@havenfold/vault')
const { ledger: { T } } = require('@havenfold/core')
const { anahtar: AN } = require('@havenfold/records')
const A = require('../../core/records/test/helpers/family')
const { kutuKur, ag, aile, hataOf, rastgele, id, ANAHTAR, H } = require('./d67s-common')

const hex = (b) => b4a.toString(b, 'hex')
const anahtarDogrula = (h) => h === ANAHTAR

// Kasa koleksiyonunun bütün dönemlerine anahtar (kasayı kuran telefonun replikası)
function anahtarlar (r, cid) {
  for (const ep of r.yetki.epochs(cid)) if (!r.keys.has(cid, ep.seq, ep.hash)) r.generateKey(cid, ep.seq)
  r.outbox.length = 0
}

// Bir dönemin anahtar mesajı (REC_KEY) başka replikaya
function donemAnahtari (kaynak, hedef, cid, ep) {
  const keys = kaynak.keys.entries(cid, ep.seq, ep.hash)
  return hedef.receiveKey(AN.encodeRecKey({ collectionId: b4a.from(cid, 'hex'), epochSeq: ep.seq, epochHash: ep.hash, keys, dropSecrets: [] }))
}

// Replikanın çıkışındaki kayıt işlemleri başka replikaya
function islemler (kaynak, hedef) {
  for (const m of kaynak.outbox.splice(0)) if (m.type === 0x81) hedef.receiveOp(m.bytes, m.kind || 0)
}

test('§9 b: KRA zarfı kasa kaydı; yalnız son dönemin anahtarı olan yeni telefon kurtarınca eski dönem anahtarları replikaya girer; döndürme ve dönem değişimi zarfı yeniden yazar', async (t) => {
  const saat = { v: A.TS0 + H }
  const now = () => saat.v
  const L = A.anaDefter()
  const cid = [...L.collections.values()].find((x) => x.sensitivity === 'kasa').id
  const kutuId = id('kutu')
  const uygunCihaz = (x) => x === kutuId
  const rK = A.replika(L, A.K.kerem, { now })
  anahtarlar(rK, cid)
  const donemler = rK.yetki.epochs(cid)
  t.ok(donemler.length >= 2, 'kasanın birden çok dönemi var')
  const kerem = new S.VaultApi({ ledger: L, me: A.K.kerem, now, uygunCihaz, anahtarDogrula })
  kerem.kayit = new S.RecordApi({ replika: rK, kasa: kerem })
  const { kutu } = kutuKur(t, L, saat)
  // Kasa kilitliyken zarf yazılamaz (dönem anahtarları arşivde): kurulum geçer, zarf kasa açılınca
  const kur = await kerem.setupRecoveryKey(cid, rastgele(32), { kagit: 1 })
  t.is(kerem.status().kasalar.find((x) => x.collectionId === cid).zarf, null, 'kilitliyken zarf yok')
  kerem.unlock(ANAHTAR)
  const z1 = kerem.status().kasalar.find((x) => x.collectionId === cid).zarf
  t.alike([z1.version, z1.envSeq, z1.donem, z1.sonDonem], [1, 1, donemler.length, donemler.at(-1).seq], 'kilit açılınca zarf yazıldı')
  t.alike(kerem.renewEnvelope(), [], 'dönem listesi değişmediyse yeniden yazılmaz')
  for (const p of kur.paylar) if (p.sahip.id === kutuId) kutu.payAl(id('kerem'), p.teslim.bytes, 'dogrudan')

  // Yeni telefon: aynı kimlik, yalnız son dönemin anahtarı ve kasa kayıtları (zarf dahil)
  const r2 = A.replika(L, A.K.kerem, { now, otomatikAnahtar: false })
  t.is(donemAnahtari(rK, r2, cid, donemler.at(-1)).status, 'tamam')
  islemler(rK, r2)
  const kerem2 = new S.VaultApi({ ledger: L, me: A.K.kerem, now, uygunCihaz, anahtarDogrula })
  kerem2.kayit = new S.RecordApi({ replika: r2, kasa: kerem2 })
  t.is(r2.keys.epochList(cid).length, 1)
  kerem2.startRecovery({ tur: 'kra', collectionId: cid })
  const soru = kerem2.recoveryOutgoing().find((g) => g.to === kutuId)
  kerem2.receiveVersionReply(kutuId, kutu.surumIstegiAl(id('kerem'), soru.bytes, 'dogrudan').bytes, 'dogrudan')
  const istek = kerem2.recoveryOutgoing().find((g) => g.to === kutuId && g.type === K.istek.Z.KASA_SHARE_REQ)
  t.is(kerem2.receiveShareReply(kutuId, kutu.payIstegiAl(id('kerem'), istek.bytes, 'dogrudan').bytes, 'dogrudan'), 'eklendi')
  t.alike(kerem2.recoveryShare({ kagit: kur.kagitlar[0].metin }), { durum: 'eklendi', paySayisi: 2 })
  t.is(await hataOf(() => kerem2.finishRecovery()), 'VAULT_LOCKED', 'zarf kaydı ve anahtarlar kasanın içeriği: kasa açık olmalı')
  kerem2.unlock(ANAHTAR)
  const acik = await kerem2.finishRecovery()
  t.alike([acik.zarf, acik.donem, acik.anahtar], [1, donemler.length, donemler.length - 1], 'zarf kayıttan açıldı, eksik dönem anahtarları eklendi')
  t.is(r2.keys.epochList(cid).length, donemler.length, 'yeni telefonun replikasında bütün dönemler')

  // Döndürme: yeni KRA bu telefonda saklanır, zarf sürüm 2 ile yeniden yazılır, eski zarf kaydı silinir
  const don = await kerem2.rotateVault({ tur: 'kra', collectionId: cid, kagit: 1 })
  t.is(don.version, 2)
  const z2 = kerem2.status().kasalar.find((x) => x.collectionId === cid).zarf
  t.alike([z2.version, z2.envSeq, z2.donem], [2, 1, donemler.length])
  const kayitlar = kerem2.kayit.query(cid, { type: S.ENVELOPE_TYPE })
  t.alike(kayitlar.map((x) => x.fields.surum), [2], 'yalnız yeni zarf kaydı')
  t.is(await hataOf(() => K.zarf.zarfAc(L, b4a.alloc(32), kayitlar[0].fields.zarf, { okuyucuMu: () => true })), 'ENVELOPE_OPEN_FAILED')

  // Dönem değişimi (kutu çıkarıldı: kasada yeni dönem); yeni dönemin anahtarı gelince zarf yeniden yazılır
  L.apply(A.olay(L, T.REMOVE_MEMBER, { memberId: A.K.kutu.memberId, reason: 'test', wipe: false }, [A.K.kerem, A.K.husniye]))
  r2.sync()
  t.alike(kerem2.renewEnvelope(), [], 'yeni dönemin anahtarı yokken değişiklik yok')
  r2.generateKey(cid)
  const [z3] = kerem2.renewEnvelope()
  t.alike([z3.version, z3.envSeq, z3.donem, z3.sonDonem > z2.sonDonem], [2, 2, donemler.length + 1, true], 'yeni dönemle yeniden yazıldı (envSeq arttı)')
  t.is(kerem2.kayit.query(cid, { type: S.ENVELOPE_TYPE }).length, 1, 'eski kayıt silindi')
  // Kilitliyken yazılmaz ve kilit süresini uzatmaz
  kerem2.lock()
  t.alike(kerem2.renewEnvelope(), [])
})

test('§9 b, B5: eski KRA\'yı bilmeyen kilitli okuyucu döndüremez; kasası açık okuyucu döndürür ve kendi KRA\'sını saklar', async (t) => {
  const x = aile(t)
  await x.kerem.setupRecoveryKey(x.kasaCid, rastgele(32))
  ag(x.cihazlar)()
  t.is(await hataOf(() => x.husniye.rotateVault({ tur: 'kra', collectionId: x.kasaCid })), 'VAULT_LOCKED')
  x.husniye.unlock(ANAHTAR)
  const r = await x.husniye.rotateVault({ tur: 'kra', collectionId: x.kasaCid })
  t.is(r.version, 2, 'tuttuğu payın sürümünden bir fazla')
  t.is(x.husniye.saklama.get(S.VRK_SECRET + 'kra:' + x.kasaCid).version, 2)
  t.ok(S.isSecret(S.VRK_SECRET + 'kra:' + x.kasaCid) && !S.isSecret(S.SEEN + 'kra:' + x.kasaCid), 'KRA arsive gider, görülen sürüm gitmez')
})

test('§9 e: eşzamanlı döndürmede kaybeden telefon geri çeker: payları gitmez, KRA\'sı silinir, durumda kaybetti', async (t) => {
  const x = aile(t)
  const akit = ag(x.cihazlar)
  await x.kerem.setupRecoveryKey(x.kasaCid, rastgele(32), { kagit: 1 })
  akit()
  x.husniye.unlock(ANAHTAR)
  const geri = []
  for (const k of [x.kerem, x.husniye]) k.on('vault', (e) => { if (e.type === 'dondurme_geri_cekildi') geri.push(k) })
  const a = await x.kerem.rotateVault({ tur: 'kra', collectionId: x.kasaCid, kagit: 1 })
  const b = await x.husniye.rotateVault({ tur: 'kra', collectionId: x.kasaCid, kagit: 1 })
  akit()
  t.is(geri.length, 1, 'tam bir telefon geri çekti')
  const kaybeden = geri[0]
  const kazanan = kaybeden === x.kerem ? x.husniye : x.kerem
  const ozet = (k) => k.status().kasalar.find((y) => y.collectionId === x.kasaCid).kurulu
  t.alike([ozet(kaybeden).kaybetti, ozet(kazanan).kaybetti], [true, false])
  t.alike(kaybeden.outgoing(), [], 'kaybedenin payları artık gitmez')
  t.is(kaybeden.saklama.get(S.VRK_SECRET + 'kra:' + x.kasaCid), null, 'kaybedenin KRA\'sı silindi')
  t.ok(kazanan.saklama.get(S.VRK_SECRET + 'kra:' + x.kasaCid))
  const kz = kazanan === x.kerem ? a : b
  const kb = kazanan === x.kerem ? b : a
  t.ok(b4a.compare(K.pay.kagitCoz(kz.kagitlar[0].metin).commit, K.pay.kagitCoz(kb.kagitlar[0].metin).commit) < 0, 'kazananın commit\'i küçük')
  // Kazananın kâğıdı ve kutunun payı birlikte açar (kutu kazananın payını tutar)
  const kutuPay = [...x.kutu.tutucu.paylar.values()][0].share
  t.ok(await K.pay.birlestir([kutuPay, K.pay.kagitCoz(kz.kagitlar[0].metin)], { secretId: b4a.from(x.kasaCid, 'hex'), kind: K.pay.TUR.KRA, version: 2 }))
  t.is(await hataOf(() => K.pay.birlestir([kutuPay, K.pay.kagitCoz(kb.kagitlar[0].metin)], { secretId: b4a.from(x.kasaCid, 'hex'), kind: K.pay.TUR.KRA, version: 2 })), 'INSUFFICIENT_SHARE', 'kaybedenin kâğıdı geçersiz')
  // Kaybedenin geç gelen payı kazananın tutucusunda reddedilir (alındı yok)
  const gec = kb.paylar.find((p) => p.sahip.id === id(kazanan === x.kerem ? 'kerem' : 'husniye'))
  if (gec) t.is(await hataOf(() => kazanan.receiveShare(id(kaybeden === x.kerem ? 'kerem' : 'husniye'), gec.teslim.bytes, 'dogrudan')), 'ROTATION_LOST')
})

test('§9 f: bilinen daha yeni sürüm varken eski sürümle kurtarma bitmez; görülen sürüm sır kurtarıldıktan sonra da saklanır', async (t) => {
  const saat = { v: A.TS0 + H }
  const now = () => saat.v
  const L = A.anaDefter()
  const irem = new S.VaultApi({ ledger: L, me: A.K.irem, now })
  const kerem = new S.VaultApi({ ledger: L, me: A.K.kerem, now })
  const husniye = new S.VaultApi({ ledger: L, me: A.K.husniye, now })
  const cihazlar = { [id('irem')]: { api: irem }, [id('kerem')]: { api: kerem }, [id('husniye')]: { api: husniye } }
  const v1 = await irem.setupBackupKey(rastgele(32), { yalnizKagit: true }) // iki kâğıt, eşik 2
  t.is((await irem.rotateVault({ tur: 'ya', kisiler: [id('kerem'), id('husniye')], kagit: 1 })).version, 2)
  ag(cihazlar)()
  // Yeni telefon önce eski kâğıtlarla (sürüm 1) kurtarır; sürüm 2'yi sonra öğrenir: sır eskidir, 402 yeniden vermez
  const irem2 = new S.VaultApi({ ledger: L, me: A.K.irem, now })
  cihazlar[id('irem')] = { api: irem2 }
  irem2.startRecovery({ tur: 'ya' })
  for (const k of v1.kagitlar) irem2.recoveryShare({ kagit: k.metin })
  t.is((await irem2.finishRecovery()).version, 1, 'daha yenisi bilinmiyorken eski sürüm açılır')
  ag(cihazlar)()
  t.is(irem2.recoveryStatus().kurtarma.bilinen, 2)
  t.is(await hataOf(() => irem2.finishRecovery()), 'STALE_VERSION', 'daha yeni sürüm biliniyor: eski sır verilmez')
  t.is((await irem2.rotateVault({ tur: 'ya', kisiler: [id('kerem'), id('husniye')], kagit: 1 })).version, 3, 'döndürme görülen en büyük sürümden bir fazla')
  // Sürüm önce öğrenilirse eski kâğıt hiç eklenmez
  ag(cihazlar)() // irem2'nin sürüm 3 payları teslim
  const irem3 = new S.VaultApi({ ledger: L, me: A.K.irem, now })
  cihazlar[id('irem')] = { api: irem3 }
  irem3.startRecovery({ tur: 'ya' })
  ag(cihazlar)()
  t.is(irem3.recoveryStatus().kurtarma.version, 3)
  t.is(await hataOf(() => irem3.recoveryShare({ kagit: v1.kagitlar[0].metin })), 'STALE_VERSION')
  // Sürüm cevabı yalnız pay tutabilecek kimlikten: çocuk Ecem'in uydurma sürümü yok sayılır (B2)
  t.is(irem3.receiveVersionReply(id('ecem'), c.encode(K.istek.versionRes, { secretId: b4a.from(v1.secretId, 'hex'), version: 9, threshold: 2, total: 3 }), 'dogrudan'), 'yetkisiz')
  t.is(irem3.recoveryStatus().kurtarma.version, 3)
})

test('B1 (tutucu tarafı): 72 saat beklemesindeki gönderici pay dağıtamaz (BEKLEMEDE); bekleme bitince alınır. B3: uyarı telefonda guvenlik olayı', async (t) => {
  const saat = { v: A.TS0 + H }
  const now = () => saat.v
  const L = A.anaDefter()
  const irem = new S.VaultApi({ ledger: L, me: A.K.irem, now })
  const kerem = new S.VaultApi({ ledger: L, me: A.K.kerem, now })
  const kur = await irem.setupBackupKey(rastgele(32), { kisiler: [id('kerem'), id('husniye')], kagit: 1 })
  kerem.receiveShare(id('irem'), kur.paylar.find((p) => p.sahip.id === id('kerem')).teslim.bytes, 'dogrudan')
  const uyari = []
  kerem.on('security-alert', (u) => uyari.push(u))
  L.apply(A.olay(L, T.ROTATE_DEVICE, { oldMemberId: A.K.irem.memberId, newDeviceCert: A.K.u5.deviceCert, ceremonyTranscriptHash: b4a.alloc(32, 7) }, [A.K.u5, A.K.kerem, A.K.husniye]))
  // Saldırgan istemci: yeni cihaz SDK'yı atlayıp kendi ürettiği sürüm 2 payını gönderir
  const [sahte] = await K.pay.paylariUret(rastgele(32), { secretId: b4a.from(kur.secretId, 'hex'), kind: K.pay.TUR.YA, version: 2, dagitim: { kurulur: true, t: 2, n: 2, sahipler: [{ id: id('kerem') }, { id: K.esik.kagitId(1) }] } })
  const put = K.teslim.payTeslimi(sahte, id('irem'))
  t.is(await hataOf(() => kerem.receiveShare(id('u5'), put, 'dogrudan')), 'ON_HOLD')
  t.alike([...kerem.tutucu.paylar.keys()], [kur.secretId + '|1'], 'sahibin payı yerinde')
  t.is(uyari.length, 1, 'olay ilk görülünce uyarı')
  t.alike([uyari[0].type, uyari[0].eski, uyari[0].yeni], ['rotate_pending_share', id('irem'), id('u5')])
  t.ok(uyari[0].alicilar.includes(id('irem')), 'eski cihaza da')
  saat.v += 73 * H
  t.is(kerem.receiveShare(id('u5'), put, 'dogrudan').durum, 'yeni', '72 saat sonra yeni cihaz sahibin yerine geçer')
})

test('kilit: LOCK döndürmede tutulan eski sırrı da siler; yeni paylardan eşik kadar alındı gelince eski sır silinir', async (t) => {
  const x = aile(t)
  const akit = ag(x.cihazlar)
  await x.kerem.setupRecoveryKey(x.kasaCid, rastgele(32), { kagit: 1 })
  akit()
  x.husniye.unlock(ANAHTAR)
  const kerem2 = new S.VaultApi({ ledger: x.L, me: A.K.kerem, now: x.now, uygunCihaz: x.uygunCihaz })
  x.cihazlar[id('kerem')] = { api: kerem2 }
  const akit2 = ag(x.cihazlar)
  const ist = []
  x.husniye.on('vault', (e) => { if (e.type === 'pay_istegi') ist.push(e) })
  kerem2.startRecovery({ tur: 'kra', collectionId: x.kasaCid })
  akit2()
  x.husniye.approveShare({ jeton: ist[0].jeton, onay: true })
  akit2()
  await kerem2.finishRecovery()
  await kerem2.rotateVault({ tur: 'kra', collectionId: x.kasaCid })
  const es = kerem2._eskiSir.get('kra:' + x.kasaCid)
  t.ok(es && !sodium.sodium_is_zero(es.sir), 'eski sır alındılar gelene kadar tutulur')
  const sir = es.sir
  akit2()
  t.ok(sodium.sodium_is_zero(sir) && !kerem2._eskiSir.size, 'eşik kadar alındı: eski sır silindi')
})

test('§9 g: zarfın kutudaki opak kopyası; hiç dönem anahtarı olmayan yeni telefon zarfı kutudan KRA etiketiyle alır; yanlış etiket, hız sınırı, eski kopya', async (t) => {
  const saat = { v: A.TS0 + H }
  const now = () => saat.v
  const L = A.anaDefter()
  const cid = [...L.collections.values()].find((x) => x.sensitivity === 'kasa').id
  const kutuId = id('kutu')
  const uygunCihaz = (x) => x === kutuId
  const rK = A.replika(L, A.K.kerem, { now })
  anahtarlar(rK, cid)
  const donemler = rK.yetki.epochs(cid)
  const kerem = new S.VaultApi({ ledger: L, me: A.K.kerem, now, uygunCihaz, anahtarDogrula })
  kerem.kayit = new S.RecordApi({ replika: rK, kasa: kerem })
  const { kutu } = kutuKur(t, L, saat)
  kerem.unlock(ANAHTAR)
  const kur = await kerem.setupRecoveryKey(cid, rastgele(32), { kagit: 1 })
  for (const p of kur.paylar) if (p.sahip.id === kutuId) kutu.payAl(id('kerem'), p.teslim.bytes, 'dogrudan')
  t.is(kerem.status().kasalar.find((x) => x.collectionId === cid).zarf.kutu, false, 'kopya henüz kutuda değil')
  const [put] = kerem.outgoingEnvelopes()
  t.alike([put.to, put.type], [kutuId, K.kutuZarf.Z.KASA_ENV_PUT])
  const ack = kutu.zarfAl(id('kerem'), put.bytes, 'dogrudan')
  t.is(ack.durum, 'yeni')
  t.is(kerem.receiveEnvelopeAck(kutuId, ack.bytes, 'dogrudan'), 'teslim')
  t.is(kerem.status().kasalar.find((x) => x.collectionId === cid).zarf.kutu, true)
  t.alike(kerem.outgoingEnvelopes(), [], 'alındı geldi: yeniden gönderilmez')
  t.alike(kutu.zarfListesi().map((x) => [x.collectionId, x.version, x.envSeq]), [[cid, 1, 1]])
  t.is(kutu.zarfAl(id('kerem'), put.bytes, 'dogrudan').durum, 'tekrar')
  // Kutu zarfı açamaz: tuttuğu baytlar KRA'sız açılmaz, içinde dönem anahtarı düz durmaz
  const kopya = b4a.from(kutu.zarflar.kopyalar[0].zarf, 'hex')
  t.is(await hataOf(() => K.zarf.zarfAc(L, b4a.alloc(32), kopya, { okuyucuMu: () => true })), 'ENVELOPE_OPEN_FAILED')
  const anahtar0 = rK.keys.entries(cid, donemler[0].seq, donemler[0].hash)[0].key
  t.is(b4a.indexOf(kopya, anahtar0), -1, 'dönem anahtarı kopyada açık değil')
  // Yetkisiz gönderen (okuyucu olmayan İrem) ve imzasız/başkasının zarfı
  t.is(await hataOf(() => kutu.zarfAl(id('irem'), put.bytes, 'dogrudan')), 'UNAUTHORIZED')

  // Tam felaket: yeni telefonun hiçbir dönem anahtarı yok, kayıtları okuyamaz
  const r2 = A.replika(L, A.K.kerem, { now, otomatikAnahtar: false })
  const kerem2 = new S.VaultApi({ ledger: L, me: A.K.kerem, now, uygunCihaz, anahtarDogrula })
  kerem2.kayit = new S.RecordApi({ replika: r2, kasa: kerem2 })
  kerem2.unlock(ANAHTAR)
  kerem2.startRecovery({ tur: 'kra', collectionId: cid })
  const soru = kerem2.recoveryOutgoing().find((g) => g.to === kutuId)
  kerem2.receiveVersionReply(kutuId, kutu.surumIstegiAl(id('kerem'), soru.bytes, 'dogrudan').bytes, 'dogrudan')
  const istek = kerem2.recoveryOutgoing().find((g) => g.to === kutuId && g.type === K.istek.Z.KASA_SHARE_REQ)
  kerem2.receiveShareReply(kutuId, kutu.payIstegiAl(id('kerem'), istek.bytes, 'dogrudan').bytes, 'dogrudan')
  kerem2.recoveryShare({ kagit: kur.kagitlar[0].metin })
  const acik = await kerem2.finishRecovery()
  t.alike([acik.zarf, acik.kutu], [0, 'istendi'])
  const zreq = kerem2.recoveryOutgoing().find((g) => g.type === K.kutuZarf.Z.KASA_ENV_REQ)
  t.ok(zreq && zreq.to === kutuId, 'zarf kutudan istendi')
  // Yanlış etiket (KRA bilinmeden): sessiz ret; okuyucu olmayan: ret
  t.is(kutu.zarfIstegiAl(id('kerem'), K.kutuZarf.zarfIste(cid, rastgele(32)), 'dogrudan'), null)
  t.is(kutu.zarfIstegiAl(id('irem'), zreq.bytes, 'dogrudan'), null, 'okuyucu olmayan doğru etiketle de alamaz')
  const res = kutu.zarfIstegiAl(id('kerem'), zreq.bytes, 'dogrudan')
  t.is(res.type, K.kutuZarf.Z.KASA_ENV_RES)
  t.is(kerem2.receiveEnvelopeReply(id('irem'), res.bytes, 'dogrudan'), 'bilinmiyor', 'yalnız kutudan')
  t.is(kerem2.receiveEnvelopeReply(kutuId, res.bytes, 'dogrudan'), 'acildi')
  const kz = kerem2.recoveryStatus().kurtarma.kutuZarfi
  t.alike([kz.zarf, kz.donem, kz.anahtar, kz.eksikDonem], [1, donemler.length, donemler.length, 0], 'bütün dönem anahtarları kutudaki zarftan')
  t.is(r2.keys.epochList(cid).length, donemler.length)
  t.is(kerem2.receiveEnvelopeReply(kutuId, res.bytes, 'dogrudan'), 'bilinmiyor', 'istenmeyen ikinci cevap yok sayılır')
  // Hız sınırı: istekçi başına 24 saatte 10 istek (doğru etiketle de)
  for (let i = 0; i < 10; i++) kutu.zarfIstegiAl(id('kerem'), zreq.bytes, 'dogrudan')
  t.is(kutu.zarfIstegiAl(id('kerem'), zreq.bytes, 'dogrudan'), null, 'hız sınırı')
  saat.v += 25 * H
  t.ok(kutu.zarfIstegiAl(id('kerem'), zreq.bytes, 'dogrudan'), 'ertesi gün yeniden')

  // Süre doldu: kasa kendiliğinden kilitlendi, kurtarılan sır silindi (aynı çağrıda eski nesne kullanılmaz)
  t.is(await hataOf(() => kerem2.rotateVault({ tur: 'kra', collectionId: cid })), 'VAULT_LOCKED')
  t.is(kerem2.recoveryStatus().kurtarma, null)
  // Döndürme (kasa açık; zarf dönem anahtarlarından): yeni sürüm kopyası eskisinin yerine geçer
  kerem2.unlock(ANAHTAR)
  const don = await kerem2.rotateVault({ tur: 'kra', collectionId: cid, kagit: 1 })
  const [put2] = kerem2.outgoingEnvelopes()
  t.is(kutu.zarfAl(id('kerem'), put2.bytes, 'dogrudan').durum, 'yeni')
  t.alike(kutu.zarfListesi().map((x) => x.version), [don.version], 'kutuda yalnız yeni sürüm')
  t.is(await hataOf(() => kutu.zarfAl(id('kerem'), put.bytes, 'dogrudan')), 'STALE_VERSION', 'eski sürüm kopyası geri konamaz')
  // Kalıcılık: kutu yeniden başlayınca kopya mühürlü dosyadan
  const k2 = kutuKur(t, L, saat, { dizin: kutu.yol.slice(0, kutu.yol.lastIndexOf('/')), tpm: kutu.tpm }).kutu
  t.alike(k2.zarfListesi(), kutu.zarfListesi())
})

test('§9 g: kutusu olmayan ailede tam felaket NO_ENVELOPE; aynı etiketle eski envSeq kopyası STALE_ENVELOPE', async (t) => {
  const saat = { v: A.TS0 + H }
  const now = () => saat.v
  const L = A.anaDefter()
  const cid = [...L.collections.values()].find((x) => x.sensitivity === 'kasa').id
  const kutuId = id('kutu')
  const rK = A.replika(L, A.K.kerem, { now })
  anahtarlar(rK, cid)
  const kerem = new S.VaultApi({ ledger: L, me: A.K.kerem, now, uygunCihaz: (x) => x === kutuId, anahtarDogrula })
  kerem.kayit = new S.RecordApi({ replika: rK, kasa: kerem })
  const { kutu } = kutuKur(t, L, saat)
  kerem.unlock(ANAHTAR)
  const kur = await kerem.setupRecoveryKey(cid, rastgele(32), { kagit: 2 }) // Kerem, Hüsniye, 2 kâğıt, kutu: eşik 3
  const husniye = new S.VaultApi({ ledger: L, me: A.K.husniye, now, anahtarDogrula })
  husniye.receiveShare(id('kerem'), kur.paylar.find((p) => p.sahip.id === id('husniye')).teslim.bytes, 'dogrudan')
  const [put1] = kerem.outgoingEnvelopes()
  kutu.zarfAl(id('kerem'), put1.bytes, 'dogrudan')
  // Yeni dönem: zarf envSeq 2; kutu kopyayı yeniler, envSeq 1 geri konamaz
  L.apply(A.olay(L, T.REMOVE_MEMBER, { memberId: A.K.kutu.memberId, reason: 'test', wipe: false }, [A.K.kerem, A.K.husniye]))
  rK.sync()
  rK.generateKey(cid)
  const [z] = kerem.renewEnvelope()
  t.is(z.envSeq, 2)
  t.alike(kerem.outgoingEnvelopes(), [], 'kutu artık ailede değil: kopya gönderilmez')
  // (kutu çıkarıldı; kopya kurallarını aynı defterin kutusuz hâlinden önce sınamak için kutunun kendi kuralı)
  // Kutusuz aile: hiç anahtarı olmayan yeni telefon kâğıtlarla KRA'yı kurtarır, zarf yok
  const r2 = A.replika(L, A.K.kerem, { now, otomatikAnahtar: false })
  const kerem2 = new S.VaultApi({ ledger: L, me: A.K.kerem, now, anahtarDogrula })
  kerem2.kayit = new S.RecordApi({ replika: r2, kasa: kerem2 })
  kerem2.unlock(ANAHTAR)
  kerem2.startRecovery({ tur: 'kra', collectionId: cid })
  const soru = kerem2.recoveryOutgoing().find((g) => g.to === id('husniye'))
  kerem2.receiveVersionReply(id('husniye'), husniye.receiveVersionRequest(id('kerem'), soru.bytes, 'dogrudan').bytes, 'dogrudan')
  const ist = kerem2.recoveryOutgoing().find((g) => g.to === id('husniye') && g.type === K.istek.Z.KASA_SHARE_REQ)
  const { jeton } = husniye.receiveShareRequest(id('kerem'), ist.bytes, 'dogrudan')
  husniye.unlock(ANAHTAR)
  husniye.approveShare({ jeton, onay: true })
  kerem2.receiveShareReply(id('husniye'), husniye.recoveryOutgoing()[0].bytes, 'dogrudan')
  for (const k of kur.kagitlar) kerem2.recoveryShare({ kagit: k.metin })
  t.is(await hataOf(() => kerem2.finishRecovery()), 'NO_ENVELOPE', 'kutu yok, hiçbir zarf okunamıyor: açık hata')
  // Okunabilir zarf kaydı varsa (yeni dönemin anahtarı gelmiş) NO_ENVELOPE değil
  const ep = r2.yetki.epochs(cid).at(-1)
  r2.receiveKey(AN.encodeRecKey({ collectionId: b4a.from(cid, 'hex'), epochSeq: ep.seq, epochHash: ep.hash, keys: rK.keys.entries(cid, ep.seq, ep.hash), dropSecrets: [] }))
  islemler(rK, r2)
  const acik = await kerem2.finishRecovery()
  t.alike([acik.zarf, acik.kutu, acik.anahtar > 0], [1, 'yok', true])
})

test('§9 g: kutu aynı etiketle eski envSeq kopyasını almaz (STALE_ENVELOPE); başka etiketli aynı sürüm (eşzamanlı döndürme) ayrı tutulur', async (t) => {
  const saat = { v: A.TS0 + H }
  const L = A.anaDefter()
  const cid = [...L.collections.values()].find((x) => x.sensitivity === 'kasa').id
  const { kutu } = kutuKur(t, L, saat)
  const r = A.replika(L, A.K.kerem)
  anahtarlar(r, cid)
  const eps = r.yetki.epochs(cid)
  const ic = (n) => ({ epochs: eps.slice(0, n).map((e) => ({ epochSeq: e.seq, epochHash: e.hash, keys: r.keys.entries(cid, e.seq, e.hash) })) })
  const kra = rastgele(32)
  const z = (envSeq, n = eps.length, k = kra) => K.zarf.zarfYaz(L.familyId, k, { collectionId: b4a.from(cid, 'hex'), version: 3, envSeq, ic: ic(n) }, A.K.kerem)
  const et = K.kutuZarf.zarfEtiketi(kra, L.familyId, cid)
  t.is(kutu.zarfAl(id('kerem'), K.kutuZarf.zarfGonder(et, z(2)), 'dogrudan').durum, 'yeni')
  t.is(await hataOf(() => kutu.zarfAl(id('kerem'), K.kutuZarf.zarfGonder(et, z(1)), 'dogrudan')), 'STALE_ENVELOPE', 'eski kopya geri konamaz')
  t.is(await hataOf(() => kutu.zarfAl(id('kerem'), K.kutuZarf.zarfGonder(et, z(3, 1)), 'dogrudan')), 'STALE_ENVELOPE', 'son dönemi geri giden kopya')
  const kra2 = rastgele(32)
  t.is(kutu.zarfAl(id('kerem'), K.kutuZarf.zarfGonder(K.kutuZarf.zarfEtiketi(kra2, L.familyId, cid), z(1, eps.length, kra2)), 'dogrudan').durum, 'yeni', 'başka KRA (etiket) aynı sürüm')
  t.is(kutu.zarfListesi().length, 2)
  // Hüsniye, Kerem'in imzasıyla yazılmış zarfı kendi adına gönderemez
  t.is(await hataOf(() => kutu.zarfAl(id('husniye'), K.kutuZarf.zarfGonder(et, z(4)), 'dogrudan')), 'UNAUTHORIZED')
  t.is(await hataOf(() => kutu.zarfAl(id('kerem'), b4a.alloc(10), 'dogrudan')), 'INVALID_MESSAGE')
  t.is(await hataOf(() => kutu.zarfAl(id('kerem'), K.kutuZarf.zarfGonder(et, z(5)), 'posta')), 'MAILBOX_FORBIDDEN')
})
