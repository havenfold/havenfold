// SPDX-License-Identifier: Apache-2.0
// D67: kasa kurtarma ve döndürme (RFC-0004 §5–§6, RFC-0027 §1a 400–404; kurucu T4). Bellek içi: telefonların VaultApi'si
// ve kutunun pay tutucusu (node/box-share.js, taklit TPM) aynı deftere bakar; zarflar elle taşınır. Beklenenler elle.
'use strict'
const test = require('brittle')
const b4a = require('b4a')
const sodium = require('sodium-native')
const S = require('..')
const K = require('@havenfold/vault')
const { ledger: { T } } = require('@havenfold/core')
const A = require('../../core/records/test/helpers/family')
const { KutuPaylari } = require('../../node/box-share')
const { taklitTpm } = require('../../node/tpm')

const hex = (b) => b4a.toString(b, 'hex')
const H = 3_600_000
const Z = { ...K.istek.Z, ...K.teslim.Z }
const hataOf = async (fn) => { try { await fn(); return null } catch (err) { return err.message } }
const { kasaDonemleri, girdi } = require('../../core/vault/test/helpers/input')
// Kasa koleksiyonunun bütün dönemleri, Kerem'in düzenlediği anahtar girdileriyle (zarfın içi)
const zarfIci = (L) => ({ epochs: kasaDonemleri(L).map((ep, i) => ({ epochSeq: ep.seq, epochHash: ep.hash, keys: [girdi(L, ep, 40 + i, A.K.kerem)] })) })
const rastgele = (n) => { const b = b4a.alloc(n); sodium.randombytes_buf(b); return b }
const ANAHTAR = 'ef'.repeat(32) // tutucu telefonların kasa kilidi (onay yalnız kasa açıkken, RFC-0027 §9 a)
const anahtarDogrula = (h) => h === ANAHTAR

function kutuKur (t, L, saat) {
  const dizin = require('../../worklet/test/helpers/common').geciciDizin(t, 'd67-kutu')
  return new KutuPaylari({ ledger: L, me: A.K.kutu, dizin, tpm: taklitTpm({ test: true, anahtar: rastgele(32) }), now: () => saat.v, testKipi: true })
}

// Bir cihazın giden zarflarını alıcılarına taşır; cevapları da (cevap da zarf üretebilir) kuyruğa ekler
function ag (cihazlar) {
  const kimOf = (id) => cihazlar[id]
  const teslim = (from, x) => {
    const c = kimOf(x.to)
    if (!c) return []
    const { tur, api } = c
    if (tur === 'kutu') {
      if (x.type === Z.KASA_SHARE_PUT) return [api.payAl(from, x.bytes, 'dogrudan')]
      if (x.type === Z.KASA_VERSION_REQ) return [api.surumIstegiAl(from, x.bytes, 'dogrudan')].filter(Boolean)
      if (x.type === Z.KASA_SHARE_REQ) return [api.payIstegiAl(from, x.bytes, 'dogrudan')].filter(Boolean)
      return []
    }
    switch (x.type) {
      case Z.KASA_SHARE_PUT: return [api.receiveShare(from, x.bytes, 'dogrudan')]
      case Z.KASA_SHARE_ACK: api.receiveAck(from, x.bytes, 'dogrudan'); return []
      case Z.KASA_VERSION_REQ: return [api.receiveVersionRequest(from, x.bytes, 'dogrudan')].filter(Boolean)
      case Z.KASA_VERSION_RES: api.receiveVersionReply(from, x.bytes, 'dogrudan'); return []
      case Z.KASA_SHARE_REQ: api.receiveShareRequest(from, x.bytes, 'dogrudan'); return []
      case Z.KASA_SHARE_RES: api.receiveShareReply(from, x.bytes, 'dogrudan'); return []
    }
    return []
  }
  // Bütün telefonların giden kuyrukları boşalana kadar
  return function akit () {
    for (let tur = 0; tur < 20; tur++) {
      let is = 0
      for (const [id, c] of Object.entries(cihazlar)) {
        if (c.tur === 'kutu') continue
        const gid = [...c.api.outgoing(), ...c.api.recoveryOutgoing()]
        for (const x of gid) {
          if (!cihazlar[x.to]) continue
          if (x.anahtar === undefined) c.api.sent(x)
          for (const cev of teslim(id, x)) { is++; teslim(x.to, cev) }
          is++
        }
      }
      if (!is) return
    }
  }
}

test('KRA: sıfırlanmış telefon kurtarır (sürüm sorulur, telefon onayla, kutu kendiliğinden pay verir), zarf açılır; döndürmeden sonra eski paylar açmaz', async (t) => {
  t.alike([S.VAULT_COMMAND.VAULT_RECOVERY_START, S.VAULT_COMMAND.VAULT_RECOVERY_SHARE, S.VAULT_COMMAND.VAULT_RECOVERY_FINISH, S.VAULT_COMMAND.VAULT_ROTATE, S.VAULT_COMMAND.VAULT_RECOVERY_STATUS, S.VAULT_COMMAND.VAULT_SHARE_APPROVE], [400, 401, 402, 403, 404, 405])
  const saat = { v: A.TS0 + H }
  const now = () => saat.v
  const L = A.anaDefter()
  const kasaCid = [...L.collections.values()].find((c) => c.sensitivity === 'kasa').id
  const kutuId = hex(A.K.kutu.memberId)
  const uygunCihaz = (id) => id === kutuId
  const kerem = new S.VaultApi({ ledger: L, me: A.K.kerem, now, uygunCihaz })
  const husniye = new S.VaultApi({ ledger: L, me: A.K.husniye, now, uygunCihaz, anahtarDogrula })
  const kutu = kutuKur(t, L, saat)
  const cihazlar = { [hex(A.K.kerem.memberId)]: { api: kerem }, [hex(A.K.husniye.memberId)]: { api: husniye }, [kutuId]: { tur: 'kutu', api: kutu } }
  let akit = ag(cihazlar)
  const kra = rastgele(32)
  const kraKopya = b4a.from(kra)
  const kur = await kerem.setupRecoveryKey(kasaCid, kra, { kagit: 1 })
  t.alike([kur.version, kur.dagitim.t, kur.dagitim.n], [1, 2, 4], 'Kerem, Hüsniye, kutu ve kâğıt; eşik 2')
  akit()
  t.alike(kutu.liste(), [kasaCid + '|1'])
  // Kasanın zarfı (RFC-0004 §4.6): kurtaran bunu KRA ile açar
  const zarf = K.zarf.zarfYaz(L.familyId, kraKopya, { collectionId: b4a.from(kasaCid, 'hex'), version: 1, envSeq: 1, ic: zarfIci(L) }, A.K.kerem)

  // Kerem'in telefonu sıfırlandı: aynı kimlik, boş saklama (kasa özeti ve kendi payı yok)
  const kerem2 = new S.VaultApi({ ledger: L, me: A.K.kerem, now, uygunCihaz })
  cihazlar[hex(A.K.kerem.memberId)] = { api: kerem2 }
  akit = ag(cihazlar)
  t.is(await hataOf(() => kerem2.finishRecovery()), 'NO_RECOVERY')
  const bas = kerem2.startRecovery({ tur: 'kra', collectionId: kasaCid })
  t.alike([bas.tur, bas.secretId], ['kra', kasaCid])
  t.ok(kerem2.recoveryOutgoing().every((x) => x.type === Z.KASA_VERSION_REQ && x.to !== hex(A.K.kerem.memberId)), 'önce sürüm sorulur, kendine değil')
  const olaylar = []
  husniye.on('vault', (x) => olaylar.push(x))
  akit()
  let d = kerem2.recoveryStatus()
  t.alike([d.kurtarma.version, d.kurtarma.esik, d.kurtarma.paySayisi], [1, 2, 1], 'kutu kendiliğinden verdi; Hüsniye onay bekliyor')
  const istek = olaylar.find((x) => x.type === 'pay_istegi')
  t.ok(istek, 'Hüsniye\'nin telefonunda pay isteği')
  t.is(istek.kimden, hex(A.K.kerem.memberId))
  t.alike(husniye.recoveryStatus().istekler.map((x) => [x.jeton, x.kimden, x.tur]), [[istek.jeton, hex(A.K.kerem.memberId), 'kra']])
  t.is(await hataOf(() => kerem2.finishRecovery()), 'INSUFFICIENT_SHARE', 'tek payla açılmaz')
  t.is(await hataOf(() => husniye.approveShare({ jeton: istek.jeton, onay: true })), 'VAULT_LOCKED', 'onay yalnız kasa açıkken (§9 a)')
  husniye.unlock(ANAHTAR)
  t.alike(husniye.approveShare({ jeton: istek.jeton, onay: true }), { durum: 'verildi' })
  t.alike(husniye.approveShare({ jeton: istek.jeton, onay: true }), { durum: 'red', red: 'NO_APPROVAL' }, 'jeton bir kez')
  akit()
  d = kerem2.recoveryStatus()
  t.alike([d.kurtarma.paySayisi, d.kurtarma.hazir], [2, true])
  const acik = await kerem2.finishRecovery({ zarflar: [hex(zarf)] })
  t.alike([acik.tur, acik.version, acik.collectionId, acik.zarf, acik.donem > 0], ['kra', 1, kasaCid, 1, true], 'KRA birleşti, zarf açıldı')
  t.absent('sirHex' in acik, 'KRA kanala çıkmaz')
  t.ok(kerem2.recoveryStatus().kurtarma.tamam)

  // Döndürme (403): yeni KRA, sürüm 2, paylar yeniden; eski sürümün payları silinir; zarf yeni KRA ile yeniden
  // şifrelenir (RFC-0004 §6), yeni zarf platforma döner
  const don = await kerem2.rotateVault({ tur: 'kra', collectionId: kasaCid, kagit: 1, zarflar: [hex(zarf)] })
  t.alike([don.version, don.dagitim.n, don.zarflar.length], [2, 4, 1])
  t.absent('sirHex' in don)
  t.is(kerem2.recoveryStatus().kurtarma, null, 'kurtarma kapandı, sır bellekten silindi')
  akit()
  t.alike(kutu.liste(), [kasaCid + '|2'], 'kutuda yalnız yeni sürüm')
  t.alike([...husniye.tutucu.paylar.keys()], [kasaCid + '|2'], 'Hüsniye\'de yalnız yeni sürüm')
  t.ok(kerem2.status().kasalar.find((x) => x.collectionId === kasaCid).kurulu.sahipler.every((s) => s.tur === 'kagit' || s.teslim), 'yeni paylar teslim')

  // Eski paylar artık açmaz: eski iki pay (kâğıt 1 ve Kerem'in eski telefonundaki pay) eski KRA'yı verir, o da yeni
  // zarfı açmaz; yeni kurtarmada sürüm 2 bulunur, eski kâğıt eklenmez
  const yeniZarf = b4a.from(don.zarflar[0], 'hex')
  const eskiPaylar = [K.pay.kagitCoz(kur.kagitlar[0].metin), [...kerem.tutucu.paylar.values()][0].share]
  const eskiKra = await K.pay.birlestir(eskiPaylar, { secretId: b4a.from(kasaCid, 'hex'), kind: K.pay.TUR.KRA, version: 1 })
  t.ok(b4a.equals(eskiKra, kraKopya), 'eski paylar yalnız eski KRA\'yı verir')
  t.is(await hataOf(() => K.zarf.zarfAc(L, eskiKra, yeniZarf, { okuyucuMu: () => true })), 'ENVELOPE_OPEN_FAILED', 'eski KRA yeni zarfı açmaz')
  t.is(await hataOf(() => K.pay.birlestir(eskiPaylar, { secretId: b4a.from(kasaCid, 'hex'), kind: K.pay.TUR.KRA, version: 2 })), 'VERSION_MISMATCH')
  kerem2.startRecovery({ tur: 'kra', collectionId: kasaCid })
  akit()
  t.is(kerem2.recoveryStatus().kurtarma.version, 2)
  t.is(await hataOf(() => kerem2.recoveryShare({ kagit: kur.kagitlar[0].metin })), 'STALE_VERSION')
  t.alike(kerem2.recoveryShare({ kagit: don.kagitlar[0].metin }), { durum: 'eklendi', paySayisi: 2 }, 'yeni kâğıt eklenir (kutunun payıyla iki)')
  const acik2 = await kerem2.finishRecovery({ zarflar: [don.zarflar[0]] })
  t.alike([acik2.version, acik2.zarf], [2, 1], 'yeni paylar yeni zarfı açar')
  t.is(await hataOf(() => kerem2.finishRecovery({ zarflar: [hex(zarf)] })), 'ENVELOPE_OPEN_FAILED', 'eski zarf yeni KRA ile açılmaz')
})

test('YA: cihaz değişiminden sonra yeni telefon kurtarır; tutucu 72 saat bekletir, sonra onayla verir; döndürme yeni YA ve sürüm 2', async (t) => {
  const saat = { v: A.TS0 + H }
  const now = () => saat.v
  const L = A.anaDefter()
  const irem = new S.VaultApi({ ledger: L, me: A.K.irem, now })
  const kerem = new S.VaultApi({ ledger: L, me: A.K.kerem, now, anahtarDogrula })
  const husniye = new S.VaultApi({ ledger: L, me: A.K.husniye, now, anahtarDogrula })
  const cihazlar = { [hex(A.K.irem.memberId)]: { api: irem }, [hex(A.K.kerem.memberId)]: { api: kerem }, [hex(A.K.husniye.memberId)]: { api: husniye } }
  let akit = ag(cihazlar)
  const ya = rastgele(32)
  const yaHex = hex(ya)
  const kur = await irem.setupBackupKey(ya, { kisiler: [hex(A.K.kerem.memberId), hex(A.K.husniye.memberId)], kagit: 1 })
  t.alike([kur.dagitim.t, kur.dagitim.n], [2, 3])
  akit()
  for (const c of [kerem, husniye]) c.tutucu.gozle()

  // İrem'in telefonu kayboldu: yeni telefon (u5) eski telefonun imzası olmadan
  L.apply(A.olay(L, T.ROTATE_DEVICE, { oldMemberId: A.K.irem.memberId, newDeviceCert: A.K.u5.deviceCert, ceremonyTranscriptHash: b4a.alloc(32, 7) }, [A.K.u5, A.K.kerem, A.K.husniye]))
  const yeni = new S.VaultApi({ ledger: L, me: A.K.u5, now })
  delete cihazlar[hex(A.K.irem.memberId)]
  cihazlar[hex(A.K.u5.memberId)] = { api: yeni }
  akit = ag(cihazlar)
  const olaylar = []
  for (const c of [kerem, husniye]) c.on('vault', (x) => olaylar.push(x))
  const bas = yeni.startRecovery({ tur: 'ya' })
  t.is(bas.secretId, hex(K.pay.yaSecretId(L.familyId, hex(A.K.irem.memberId))), 'sırrın kökü eski kimlik')
  akit()
  const bekle = olaylar.filter((x) => x.type === 'pay_istegi_bekliyor')
  t.is(bekle.length, 2, 'iki tutucu da 72 saat bekletir')
  t.ok(bekle.every((x) => x.bitis >= saat.v + 71 * H), 'bitiş 72 saat sonra')
  t.is(yeni.recoveryStatus().kurtarma.paySayisi, 0)

  // 72 saat sonra istek yinelenir (istek en çok 5 dakika eski olabilir)
  saat.v += 73 * H
  yeni.startRecovery({ tur: 'ya' })
  akit()
  for (const c of [kerem, husniye]) {
    const ist = c.recoveryStatus().istekler
    t.is(ist.length, 1)
    c.unlock(ANAHTAR)
    t.alike(c.approveShare({ jeton: ist[0].jeton, onay: c === kerem }), c === kerem ? { durum: 'verildi' } : { durum: 'reddedildi' })
  }
  akit()
  t.is(yeni.recoveryStatus().kurtarma.paySayisi, 1, 'Hüsniye reddetti')
  t.is(await hataOf(() => yeni.recoveryShare({ kagit: 'hfk1:AAAA' })), 'INVALID_PAPER')
  t.alike(yeni.recoveryShare({ kagit: kur.kagitlar[0].metin }), { durum: 'eklendi', paySayisi: 2 })
  t.alike(yeni.recoveryShare({ kagit: kur.kagitlar[0].metin }), { durum: 'zaten', paySayisi: 2 })
  const acik = await yeni.finishRecovery()
  t.alike([acik.tur, acik.version, acik.sirHex], ['ya', 1, yaHex], 'YA platforma döner')

  const don = await yeni.rotateVault({ tur: 'ya', kisiler: [hex(A.K.kerem.memberId), hex(A.K.husniye.memberId)], kagit: 1 })
  t.is(don.version, 2)
  t.not(don.sirHex, yaHex, 'yeni YA')
  t.ok(/^[0-9a-f]{64}$/.test(don.sirHex))
  akit()
  t.alike([...kerem.tutucu.paylar.keys()], [bas.secretId + '|2'], 'tutucuda yalnız yeni sürüm')
  t.is(await hataOf(() => yeni.rotateVault({ tur: 'ya' })), null, 'sahibi yeniden döndürebilir (sürüm 3)')
})

test('Kurtarma retleri: yetkisiz istekçi, yanlış tutucudan gelen pay, başka sırrın sürüm cevabı, okuyucu olmayanın KRA kurtarması', async (t) => {
  const saat = { v: A.TS0 + H }
  const now = () => saat.v
  const L = A.anaDefter()
  const kasaCid = [...L.collections.values()].find((c) => c.sensitivity === 'kasa').id
  const irem = new S.VaultApi({ ledger: L, me: A.K.irem, now })
  t.is(await hataOf(() => irem.startRecovery({ tur: 'kra', collectionId: kasaCid })), 'UNAUTHORIZED', 'İrem kasa okuyucusu değil')
  t.is(await hataOf(() => irem.startRecovery({ tur: 'xx' })), 'INVALID_TYPE')
  t.is(await hataOf(() => irem.rotateVault({ tur: 'kra', collectionId: kasaCid })), 'UNAUTHORIZED')
  t.is(await hataOf(() => irem.rotateVault({ tur: 'ya' })), 'VERSION_UNKNOWN', 'kurulmamış ve kurtarılmamış sır döndürülmez')
  t.is(await hataOf(() => irem.approveShare({ jeton: 'ab'.repeat(16), onay: true })), null)
  t.alike(irem.approveShare({ jeton: 'ab'.repeat(16), onay: true }), { durum: 'red', red: 'NO_APPROVAL' })
  const kerem = new S.VaultApi({ ledger: L, me: A.K.kerem, now })
  kerem.startRecovery({ tur: 'kra', collectionId: kasaCid })
  // Başka sırrın sürüm cevabı yok sayılır
  t.is(kerem.receiveVersionReply(hex(A.K.husniye.memberId), require('compact-encoding').encode(K.istek.versionRes, { secretId: b4a.alloc(16, 9), version: 5, threshold: 2, total: 3 }), 'dogrudan'), 'bilinmiyor')
  t.is(kerem.recoveryStatus().kurtarma.version, null)
  // Pay cevabı yalnız payın tutucusundan
  const [p] = await K.pay.paylariUret(rastgele(32), { secretId: b4a.from(kasaCid, 'hex'), kind: K.pay.TUR.KRA, version: 1, dagitim: { kurulur: true, t: 2, n: 2, sahipler: [{ id: hex(A.K.husniye.memberId) }, { id: hex(A.K.irem.memberId) }] } })
  const res = require('compact-encoding').encode(K.istek.shareRes, { share: p })
  t.is(kerem.receiveShareReply(hex(A.K.irem.memberId), res, 'dogrudan'), 'yanlis_tutucu')
  t.is(kerem.receiveShareReply(hex(A.K.husniye.memberId), res, 'dogrudan'), 'istenmedi', 'istenmemiş pay alınmaz (inceleme 19 B2)')
  // Sürüm cevabı yalnız sorulan ve pay tutabilecek kimlikten: İrem kasa okuyucusu değil (yok sayılır); Hüsniye'nin
  // cevabıyla pay istenir, sonra pay alınır
  t.is(kerem.receiveVersionReply(hex(A.K.irem.memberId), require('compact-encoding').encode(K.istek.versionRes, { secretId: b4a.from(kasaCid, 'hex'), version: 9, threshold: 2, total: 2 }), 'dogrudan'), 'yetkisiz')
  t.is(kerem.receiveVersionReply(hex(A.K.husniye.memberId), require('compact-encoding').encode(K.istek.versionRes, { secretId: b4a.from(kasaCid, 'hex'), version: 1, threshold: 2, total: 2 }), 'dogrudan'), 'kaydedildi')
  t.is(kerem.receiveShareReply(hex(A.K.husniye.memberId), res, 'dogrudan'), 'eklendi')
  t.is(await hataOf(() => kerem.receiveShareReply(hex(A.K.husniye.memberId), res, 'posta')), null, 'emanet ve posta mühürlü yolla gelebilir')
  t.is(await hataOf(() => kerem.receiveShareReply(hex(A.K.husniye.memberId), b4a.alloc(3), 'dogrudan')), 'INVALID_MESSAGE')
  // Her giriş noktası gelenZarf'tan geçer: bozuk bayt INVALID_MESSAGE, yol verilmezse INVALID_CHANNEL
  const h = hex(A.K.husniye.memberId)
  for (const f of ['receiveVersionRequest', 'receiveVersionReply', 'receiveShareRequest']) t.is(await hataOf(() => kerem[f](h, b4a.alloc(3), 'dogrudan')), 'INVALID_MESSAGE', f)
  for (const f of ['receiveVersionRequest', 'receiveVersionReply', 'receiveShareRequest', 'receiveShareReply']) t.is(await hataOf(() => kerem[f](h, b4a.alloc(3))), 'INVALID_CHANNEL', f)
})

test('Kurtarma ve döndürme sınırları: kurtarma yokken kâğıt, zarfsız eski anahtar, geçersiz koleksiyon ve jeton, reddedilen istek, payı olmayan tutucunun sürümü', async (t) => {
  const saat = { v: A.TS0 + H }
  const now = () => saat.v
  const L = A.anaDefter()
  const kasaCid = [...L.collections.values()].find((c) => c.sensitivity === 'kasa').id
  const uygunCihaz = (id) => id === hex(A.K.kutu.memberId)
  const kerem = new S.VaultApi({ ledger: L, me: A.K.kerem, now, uygunCihaz })
  const husniye = new S.VaultApi({ ledger: L, me: A.K.husniye, now })
  const irem = new S.VaultApi({ ledger: L, me: A.K.irem, now })
  t.is(await hataOf(() => kerem.recoveryShare({ kagit: 'hfk1:AAAA' })), 'NO_RECOVERY')
  t.is(await hataOf(() => kerem.startRecovery({ tur: 'kra', collectionId: 'ab'.repeat(16) })), 'NO_COLLECTION')
  t.is(await hataOf(() => kerem.startRecovery({ tur: 'kra', collectionId: 5 })), 'NO_COLLECTION')
  await kerem.setupRecoveryKey(kasaCid, rastgele(32))
  t.is(await hataOf(() => kerem.rotateVault({ tur: 'kra', collectionId: kasaCid, zarflar: ['00'] })), 'NO_OLD_KEY', 'zarfı yeniden şifrelemek için eski KRA kurtarmadan bellekte olmalı')
  const r = await kerem.rotateVault({ tur: 'kra', collectionId: kasaCid })
  t.is(r.version, 2, 'kurulu özetten sürüm bir artar (kurtarmasız döndürme: pay sahibi çıkınca)')
  kerem.startRecovery({ tur: 'kra', collectionId: kasaCid })
  t.is(await hataOf(() => kerem.finishRecovery()), 'INSUFFICIENT_SHARE', 'sürüm bilinmeden')
  t.is(await hataOf(() => kerem.finishRecovery({ zarflar: 'x' })), 'INSUFFICIENT_SHARE')
  // Payı olmayan tutucu sürüm sorusuna cevap vermez
  const soru = kerem.recoveryOutgoing().find((x) => x.to === hex(A.K.irem.memberId))
  t.is(irem.receiveVersionRequest(hex(A.K.kerem.memberId), soru.bytes, 'dogrudan'), null)
  // Okuyucu olmayan İrem'in KRA isteği reddedilir (sorulmaz)
  const istek = K.istek.payIste(L.familyId, { secretId: b4a.from(kasaCid, 'hex'), kind: K.pay.TUR.KRA, version: 2, holderId: A.K.husniye.memberId, at: saat.v }, A.K.irem)
  t.alike(husniye.receiveShareRequest(hex(A.K.irem.memberId), istek, 'dogrudan'), { durum: 'red', red: 'PAY_YOK' })
  t.alike(husniye.approveShare({ jeton: 42, onay: true }), { durum: 'red', red: 'NO_APPROVAL' })
  t.alike(husniye.approveShare({ jeton: 'cd'.repeat(16) }), { durum: 'red', red: 'NO_APPROVAL' })
  t.alike(kerem.recoveryStatus().istekler, [])
})

test('Kilitli tutucu: paylar arşivdeyken sürüm dizinden verilir (eşik 0), istek sorulur; onay kilit açılınca, denetimler yeniden', async (t) => {
  const saat = { v: A.TS0 + H }
  const now = () => saat.v
  const L = A.anaDefter()
  const kasaCid = [...L.collections.values()].find((c) => c.sensitivity === 'kasa').id
  const uygunCihaz = (id) => id === hex(A.K.kutu.memberId)
  const ANAHTAR = 'ef'.repeat(32)
  const kerem = new S.VaultApi({ ledger: L, me: A.K.kerem, now, uygunCihaz })
  const husniye = new S.VaultApi({ ledger: L, me: A.K.husniye, now, anahtarDogrula: (h) => h === ANAHTAR })
  const kur = await kerem.setupRecoveryKey(kasaCid, rastgele(32))
  husniye.receiveShare(hex(A.K.kerem.memberId), kur.paylar.find((p) => p.sahip.id === hex(A.K.husniye.memberId)).teslim.bytes, 'dogrudan')
  // Kilitlenince paylar arşive gider (worklet): bellekte yalnız pay dizini kalır
  const sakli = new Map(husniye.tutucu.paylar)
  husniye.tutucu.paylar.clear()
  t.ok(husniye.locked())
  const yeni = new S.VaultApi({ ledger: L, me: A.K.kerem, now })
  yeni.startRecovery({ tur: 'kra', collectionId: kasaCid })
  const soru = yeni.recoveryOutgoing().find((x) => x.to === hex(A.K.husniye.memberId))
  const cev = husniye.receiveVersionRequest(hex(A.K.kerem.memberId), soru.bytes, 'dogrudan')
  t.alike(K.istek.surumCevabiCoz(cev.bytes).threshold, 0, 'kilitliyken eşik bilinmez')
  yeni.receiveVersionReply(hex(A.K.husniye.memberId), cev.bytes, 'dogrudan')
  t.alike([yeni.recoveryStatus().kurtarma.version, yeni.recoveryStatus().kurtarma.esik], [1, null])
  const istek = yeni.recoveryOutgoing().find((x) => x.type === Z.KASA_SHARE_REQ)
  const r = husniye.receiveShareRequest(hex(A.K.kerem.memberId), istek.bytes, 'dogrudan')
  t.is(r.durum, 'onay')
  t.ok(husniye.recoveryStatus().istekler[0].kilitli)
  t.is(await hataOf(() => husniye.approveShare({ jeton: r.jeton, onay: true })), 'VAULT_LOCKED')
  t.is(husniye.recoveryStatus().istekler.length, 1, 'istek yerinde')
  husniye.unlock(ANAHTAR)
  for (const [k, v] of sakli) husniye.tutucu.paylar.set(k, v) // kilit açılınca arşivden
  t.alike(husniye.approveShare({ jeton: r.jeton, onay: true }), { durum: 'verildi' })
  yeni.receiveShareReply(hex(A.K.husniye.memberId), husniye.recoveryOutgoing()[0].bytes, 'dogrudan')
  t.alike([yeni.recoveryStatus().kurtarma.esik, yeni.recoveryStatus().kurtarma.paySayisi], [2, 1], 'eşik paydan')
  // Kilitliyken gelen ikinci istek de bütün denetimlerden geçer (inceleme 19 B11): günlük sınır hemen
  husniye.lock()
  husniye.tutucu.paylar.clear()
  t.alike(husniye.receiveShareRequest(hex(A.K.kerem.memberId), istek.bytes, 'dogrudan'), { durum: 'red', red: 'DAILY_LIMIT' })
  t.alike(husniye.recoveryStatus().istekler, [], 'sorulmadı')
  // Günlük sınır kilitliyken gelen istekte de onay anında yeniden denetlenir: ertesi gün gelen istek, onaydan önce başka
  // bir pay verilirse düşer
  saat.v += 25 * H
  const yeniIstek = () => K.istek.payIste(L.familyId, { secretId: b4a.from(kasaCid, 'hex'), kind: K.pay.TUR.KRA, version: 1, holderId: A.K.husniye.memberId, at: saat.v }, A.K.kerem)
  const r2 = husniye.receiveShareRequest(hex(A.K.kerem.memberId), yeniIstek(), 'dogrudan')
  t.is(r2.durum, 'onay')
  husniye.unlock(ANAHTAR)
  for (const [k, v] of sakli) husniye.tutucu.paylar.set(k, v)
  const r3 = husniye.receiveShareRequest(hex(A.K.kerem.memberId), yeniIstek(), 'dogrudan')
  t.alike(husniye.recoveryStatus().istekler.map((x) => x.jeton), [r3.jeton], 'aynı istekçi ve sürüm için tek bekleyen istek')
  t.alike(husniye.approveShare({ jeton: r2.jeton, onay: true }), { durum: 'red', red: 'NO_APPROVAL' }, 'eski jeton düştü')
  t.alike(husniye.approveShare({ jeton: r3.jeton, onay: true }), { durum: 'verildi' })
  t.alike(husniye.approveShare({ jeton: r3.jeton, onay: false }), { durum: 'red', red: 'NO_APPROVAL' })
})
