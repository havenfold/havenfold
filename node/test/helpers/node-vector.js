// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// protocol/vectors/node.json üreticisi (RFC-0007 §16). Bu görevde 1–7 ve 12 var (8–11 adım 5 ve 8 ile gelir).
// Kök ve yedek kök anahtarları yalnız test tohumundan türetilir; gerçek sürüm kök anahtarı ajan makinelerinde yoktur.
// Beklenen değerler (karar, hata kodu) elle yazılır; üretici hesapladığını beklenenle karşılaştırır, uymazsa durur.
const b4a = require('b4a')
const c = require('compact-encoding')
const sodium = require('sodium-native')
const S = require('../../release')
const H = require('../../health')
const C = require('../../ipc/frame')
const { IPC } = require('../../ipc/types')
const { ledger: { Ledger, encodeEvent }, kdf: { hash } } = require('@havenfold/core')
const V = require('../../../core/core/test/helpers/v21')

const hex = (b) => b4a.toString(b, 'hex')
const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }

function anahtar (tohum) {
  const pk = b4a.alloc(32)
  const sk = b4a.alloc(64)
  sodium.crypto_sign_seed_keypair(pk, sk, hash('test/' + tohum))
  return { pk, sk }
}

const KOK = anahtar('dugum-vektor/kok')
const YEDEK = anahtar('dugum-vektor/yedek-kok')
const YEDEK2 = anahtar('dugum-vektor/yedek-kok-2')
const SAHTE = anahtar('dugum-vektor/sahte')
const KOK_DURUMU = { keyEpoch: 1, rootPub: KOK.pk, nextRootHash: S.rootHash(YEDEK.pk) }
const PAKET = b4a.from('havenfold-node 1.2.3 paket içeriği (vektör)')

function bildirim (ek = {}) {
  return {
    format: 1,
    product: 'havenfold-node',
    version: '1.2.3',
    versionCode: 1002003,
    channel: 'kararli',
    publishedAt: V.TS0,
    minFrom: 1000000,
    urgent: false,
    packages: [{ os: 'linux', arch: 'amd64', name: 'havenfold-node-1.2.3-amd64.zip', size: PAKET.byteLength, digest: S.paketOzeti(PAKET), urls: ['https://github.com/havenfold/havenfold/releases/download/v1.2.3/havenfold-node-1.2.3-amd64.zip'] }],
    images: [{ type: 'hf.task.ocr', version: '1.0.0', arch: 'amd64', ociDigest: 'sha256:' + 'ab'.repeat(32), archive: { name: 'ocr.oci', size: 10, digest: b4a.alloc(32, 1), urls: [] }, sourceArchive: { name: 'ocr-src.tar', digest: b4a.alloc(32, 2), urls: [] }, ramMB: 512, policy: { ekip: true, kisiOlcer: false, yuz: false, plaka: false } }],
    assets: [],
    installer: [],
    installerDebs: [],
    revoked: [],
    catalogKeys: [],
    keyEpoch: 1,
    nextRootHash: S.rootHash(YEDEK.pk),
    notes: 'Vektör bildirimi',
    ...ek
  }
}

function bek (no, aciklama, gercek, beklenen) {
  if (JSON.stringify(gercek) !== JSON.stringify(beklenen)) throw new Error(`dugum ${no} ${aciklama}: ${JSON.stringify(gercek)} ≠ ${JSON.stringify(beklenen)}`)
  return { aciklama, beklenen }
}

function v1 () {
  const gecerli = S.bildirimYaz(bildirim(), KOK.sk)
  const satir = S.bildirimCoz(gecerli, KOK_DURUMU).m.packages[0]
  const bozukPaket = b4a.from(PAKET)
  bozukPaket[0] ^= 1
  const durumlar = [
    { ...bek(1, 'geçerli bildirim', hataOf(() => S.bildirimCoz(gecerli, KOK_DURUMU)), null), bildirim: hex(gecerli) },
    { ...bek(1, 'bir baytı değişmiş paket', hataOf(() => S.dosyaDenetle(satir, { ozet: S.paketOzeti(bozukPaket), boyut: bozukPaket.byteLength })), 'DIGEST_MISMATCH'), bildirim: hex(gecerli), paket: hex(bozukPaket) },
    { ...bek(1, 'yanlış nextRootHash', hataOf(() => S.bildirimCoz(S.bildirimYaz(bildirim({ nextRootHash: b4a.alloc(32, 9) }), KOK.sk), KOK_DURUMU)), 'COMMITMENT_ERROR'), bildirim: hex(S.bildirimYaz(bildirim({ nextRootHash: b4a.alloc(32, 9) }), KOK.sk)) },
    { ...bek(1, 'keyEpoch ileri', hataOf(() => S.bildirimCoz(S.bildirimYaz(bildirim({ keyEpoch: 2 }), KOK.sk), KOK_DURUMU)), 'ROOT_EPOCH_ERROR'), bildirim: hex(S.bildirimYaz(bildirim({ keyEpoch: 2 }), KOK.sk)) },
    { ...bek(1, 'sahte anahtarla imza', hataOf(() => S.bildirimCoz(S.bildirimYaz(bildirim(), SAHTE.sk), KOK_DURUMU)), 'SIGNATURE_ERROR'), bildirim: hex(S.bildirimYaz(bildirim(), SAHTE.sk)) },
    { ...bek(1, 'versionCode sürümle uyuşmuyor', hataOf(() => S.bildirimCoz(S.bildirimYaz(bildirim({ versionCode: 1002004 }), KOK.sk), KOK_DURUMU)), 'FORMAT_ERROR'), bildirim: hex(S.bildirimYaz(bildirim({ versionCode: 1002004 }), KOK.sk)) },
    { ...bek(1, 'sonda fazla bayt', hataOf(() => S.bildirimCoz(b4a.concat([gecerli.subarray(0, -64), b4a.from([0]), gecerli.subarray(-64)]), KOK_DURUMU)), 'FORMAT_ERROR'), bildirim: hex(b4a.concat([gecerli.subarray(0, -64), b4a.from([0]), gecerli.subarray(-64)])) }
  ]
  return { paket: hex(PAKET), paketOzeti: hex(S.paketOzeti(PAKET)), bildirimOzeti: hex(S.bildirimOzeti(gecerli.subarray(0, -64))), durumlar }
}

function v2 () {
  const rot = (m, sk) => S.rotasyonYaz({ keyEpoch: 2, newRoot: YEDEK.pk, newNextRootHash: S.rootHash(YEDEK2.pk), reason: 'calinti', publishedAt: V.TS0, ...m }, sk)
  const kabul = rot({}, YEDEK.sk)
  const yeni = S.rotasyonUygula(KOK_DURUMU, kabul)
  const eskiKokleImzali = S.bildirimYaz(bildirim({ keyEpoch: 2, nextRootHash: S.rootHash(YEDEK2.pk) }), KOK.sk)
  const yeniKokleImzali = S.bildirimYaz(bildirim({ keyEpoch: 2, nextRootHash: S.rootHash(YEDEK2.pk) }), YEDEK.sk)
  return {
    kokDurumu: { keyEpoch: 1, rootPub: hex(KOK.pk), nextRootHash: hex(KOK_DURUMU.nextRootHash) },
    durumlar: [
      { ...bek(2, 'taahhüde uyan anahtar', hataOf(() => S.rotasyonUygula(KOK_DURUMU, kabul)), null), rotasyon: hex(kabul) },
      { ...bek(2, 'taahhüde uymayan anahtar (eski kökle imzalı olsa bile)', hataOf(() => S.rotasyonUygula(KOK_DURUMU, rot({ newRoot: SAHTE.pk }, KOK.sk))), 'COMMITMENT_ERROR'), rotasyon: hex(rot({ newRoot: SAHTE.pk }, KOK.sk)) },
      { ...bek(2, 'dönemi atlayan', hataOf(() => S.rotasyonUygula(KOK_DURUMU, rot({ keyEpoch: 3 }, YEDEK.sk))), 'ROOT_EPOCH_ERROR'), rotasyon: hex(rot({ keyEpoch: 3 }, YEDEK.sk)) },
      { ...bek(2, 'döndürmeden sonra eski kökle imzalı bildirim', hataOf(() => S.bildirimCoz(eskiKokleImzali, yeni)), 'SIGNATURE_ERROR'), bildirim: hex(eskiKokleImzali) },
      { ...bek(2, 'döndürmeden sonra yeni kökle imzalı bildirim', hataOf(() => S.bildirimCoz(yeniKokleImzali, yeni)), null), bildirim: hex(yeniKokleImzali) }
    ],
    sonra: { keyEpoch: yeni.keyEpoch, rootPub: hex(yeni.rootPub), nextRootHash: hex(yeni.nextRootHash) }
  }
}

function v3 () {
  const satirlar = [
    ['yeni sürüm', { kurulu: 1002002, enYuksek: 1002002, gelen: 1002003, minFrom: 1000000 }, 'kur'],
    ['aynı sürüm', { kurulu: 1002003, enYuksek: 1002003, gelen: 1002003 }, 'yok-say'],
    ['düşük sürüm, onay yok', { kurulu: 1002003, enYuksek: 1002003, gelen: 1002002 }, 'onay-gerekli'],
    ['düşük sürüm, onay var', { kurulu: 1002003, enYuksek: 1002003, gelen: 1002002, onay: true }, 'kur'],
    ['enYuksek altında yeni (onaylı düşürmeden sonra)', { kurulu: 1002001, enYuksek: 1002003, gelen: 1002002 }, 'onay-gerekli'],
    ['minFrom kuruluyu aşar', { kurulu: 1000005, enYuksek: 1000005, gelen: 1002003, minFrom: 1001000 }, 'ara-surum'],
    ['bozuk işaretli', { kurulu: 1002002, enYuksek: 1002002, gelen: 1002003, bozuk: [1002003] }, 'yok-say']
  ]
  return satirlar.map(([a, g, b]) => ({ girdi: g, ...bek(3, a, S.surumKarari(g), b) }))
}

function v4 () {
  return [
    { surum: '1.2.3', ...bek(4, "'1.2.3'", hataOf(() => S.versionCode('1.2.3')) || S.versionCode('1.2.3'), 1002003) },
    { surum: '1.1000.0', ...bek(4, "'1.1000.0'", hataOf(() => S.versionCode('1.1000.0')), 'INVALID_VERSION') },
    { surum: '01.2.3', ...bek(4, "başta sıfır", hataOf(() => S.versionCode('01.2.3')), 'INVALID_VERSION') },
    { surum: '0.0.0', ...bek(4, "'0.0.0'", hataOf(() => S.versionCode('0.0.0')) || S.versionCode('0.0.0'), 0) }
  ]
}

// Vektör 5: düğüm (C.isci1) ana aile zincirinde; Kerem ebeveyn, İrem yetişkin
function v5 () {
  const L = new Ledger({ now: () => V.TS0 })
  for (const f of V.anaAdimlar(L)) L.apply(f())
  const simdi = V.TS0 + 3_600_000
  const gecerli = S.bildirimYaz(bildirim({ version: '1.2.2', versionCode: 1002002 }), KOK.sk)
  const ozet = S.bildirimOzeti(gecerli.subarray(0, -64))
  const onay = (imzaci, ek = {}) => S.onayYaz(L.familyId, imzaci, { nodeId: V.C.isci1.memberId, op: 'dusur', product: 'havenfold-node', toVersionCode: 1002002, manifestHash: ozet, channel: '', expiresAt: simdi + 3_600_000, ledgerSeq: L.len - 1, ...ek })
  const me = hex(V.C.isci1.memberId)
  const gorulen = new Map()
  const den = (b) => hataOf(() => S.onayDenetle(L, b, { me, simdi, gorulen, kok: KOK_DURUMU, hedef: gecerli }))
  const iyi = onay(V.K.kerem)
  return {
    zincir: L.events.map((e) => hex(encodeEvent(e))),
    simdi,
    nodeId: me,
    hedefBildirim: hex(gecerli),
    durumlar: [
      { onay: hex(iyi), ...bek(5, 'geçerli düşürme', den(iyi), null) },
      { onay: hex(iyi), ...bek(5, 'aynı onay ikinci kez', den(iyi), 'REPLAY') },
      { onay: hex(onay(V.K.irem)), ...bek(5, 'yetişkin imzası', den(onay(V.K.irem)), 'UNAUTHORIZED') },
      { onay: hex(onay(V.K.kerem, { expiresAt: simdi + 25 * 3_600_000 })), ...bek(5, '25 saatlik expiresAt', den(onay(V.K.kerem, { expiresAt: simdi + 25 * 3_600_000 })), 'INVALID_DURATION') },
      { onay: hex(onay(V.K.kerem, { nodeId: V.C.uc1.memberId })), ...bek(5, 'başka düğüm', den(onay(V.K.kerem, { nodeId: V.C.uc1.memberId })), 'WRONG_NODE') },
      { onay: hex(onay(V.K.kerem, { manifestHash: b4a.alloc(32, 5) })), ...bek(5, 'bildirim özeti tutmuyor', den(onay(V.K.kerem, { manifestHash: b4a.alloc(32, 5) })), 'MANIFEST_ERROR') }
    ]
  }
}

// Vektör 6: NODE_HEALTH; seçimli battery alanının varlık bayrağı
function v6 () {
  const L = new Ledger({ now: () => V.TS0 })
  for (const f of V.anaAdimlar(L)) L.apply(f())
  const olcum = {
    software: { product: 'havenfold-node', version: '1.2.3', versionCode: 1002003, channel: 'kararli', keyEpoch: 1, rootFp: H.rootFp(KOK.pk), lastManifestAt: V.TS0, update: 'guncel', pendingVersion: '', osSecurityPending: 0, rebootRequired: false },
    platform: { osRelease: 'Ubuntu 24.04', kernel: '6.8.0', secureBoot: true, tpm: 'muhur-ok', disk: 'luks-tpm', recoveryDelivered: true },
    power: { onAC: true, acLoss24h: 0, battery: { percent: 80, healthPct: 91, cycles: 120, tempC: 31, limit: 'cekirdek', limitStart: 60, limitStop: 80 } },
    thermal: { cpuMaxC: 55, hotMinutes24h: 0 },
    disks: [{ kind: 'nvme', sizeGB: 512, usedPct: 40, wearPct: 3, smart: 'iyi', reallocated: 0, tempC: 38 }],
    net: { wired: true, wifiDbm: 0 },
    sleepGuard: { lid: true, targetsMasked: true },
    retire: 'yok',
    warnings: []
  }
  const pilli = H.saglikYaz(L.familyId, V.C.isci1, { hostId: b4a.alloc(16, 0xaa), seq: 1, ...olcum })
  const pilsiz = H.saglikYaz(L.familyId, V.C.isci1, { hostId: b4a.alloc(16, 0xaa), seq: 2, ...olcum, power: { onAC: true, acLoss24h: 0, battery: null } })
  const govde = (b) => b.subarray(0, -64)
  const bayrakYeri = (b) => { const m = c.decode(H.govdeEnc, govde(b)); return m.power.battery === null ? 'yok' : 'var' }
  const bozuk = b4a.from(pilli)
  bozuk[bozuk.byteLength - 1] ^= 1
  return {
    zincir: L.events.map((e) => hex(encodeEvent(e))),
    pilli: { bytes: hex(pilli), ...bek(6, 'battery var', bayrakYeri(pilli), 'var') },
    pilsiz: { bytes: hex(pilsiz), ...bek(6, 'battery yok', bayrakYeri(pilsiz), 'yok') },
    bozukImza: { bytes: hex(bozuk), ...bek(6, 'imza bozuk', hataOf(() => H.saglikCoz(L, bozuk)), 'INVALID_SIGNATURE') },
    gecerli: bek(6, 'imzalı gövde çözülür', hataOf(() => H.saglikCoz(L, pilli)), null)
  }
}

// Vektör 7: eşik tablosu
function v7 () {
  const DAY = 86_400_000
  const s = V.TS0 + 40 * DAY
  const taban = { cpuC: 50, onAC: true, battery: null, disks: [], lastManifestAt: s, update: 'guncel', rebootRequired: false, disk: 'luks-tpm', recoveryDelivered: true, lid: true, targetsMasked: true, wired: true, simdi: s }
  const satirlar = [
    ['healthPct 39', { battery: { percent: 90, healthPct: 39, limit: 'cekirdek' } }, { status: 'bakim', warnings: ['PIL_KRITIK'] }],
    ['healthPct 59', { battery: { percent: 90, healthPct: 59, limit: 'cekirdek' } }, { status: 'hazir', warnings: ['PIL_SAGLIK_DUSUK'] }],
    ['işlemci 91 °C', { cpuC: 91 }, { status: 'sicak', warnings: [] }],
    ['sıcaktan 85 °C (histerezis)', { cpuC: 85, oncekiDurum: 'sicak' }, { status: 'sicak', warnings: [] }],
    ['sıcaktan 79 °C', { cpuC: 79, oncekiDurum: 'sicak' }, { status: 'hazir', warnings: [] }],
    ['prizde değil, %20', { onAC: false, battery: { percent: 20, healthPct: 90, limit: 'yok' } }, { status: 'pil', warnings: ['PIL_AZ', 'PIL_SINIRI_YOK'] }],
    ['pil 50 °C 10 dk', { battery: { percent: 90, healthPct: 90, limit: 'cekirdek' }, pilSicak50Dk: 10 }, { status: 'bakim', warnings: ['PIL_KRITIK'] }],
    ['pil 45 °C 30 dk', { battery: { percent: 90, healthPct: 90, limit: 'cekirdek' }, pilSicak45Dk: 30 }, { status: 'hazir', warnings: ['PIL_SICAK'] }],
    ['disk dolu ve aşınmış', { disks: [{ wearPct: 92, smart: 'iyi', usedPct: 95, reallocated: 0 }] }, { status: 'hazir', warnings: ['DISK_ASINMA', 'DISK_DOLU'] }],
    ['bildirim 31 gün önce, Wi-Fi, şifresiz', { lastManifestAt: s - 31 * DAY, wired: false, disk: 'sifresiz' }, { status: 'hazir', warnings: ['GUNCELLEME_GECIKTI', 'SIFRESIZ_DISK', 'WIFI'] }],
    ['geri alındı, 8 gündür yeniden başlatma, kapak', { update: 'geri-alindi', rebootRequired: true, rebootRequiredSince: s - 8 * DAY, lid: false }, { status: 'hazir', warnings: ['GUNCELLEME_HATA', 'YENIDEN_BASLATMA', 'UYKU_KORUMASI_YOK'] }]
  ]
  return satirlar.map(([a, g, b]) => {
    const r = H.esikler({ ...taban, ...g })
    return { girdi: g, ...bek(7, a, { status: r.status, warnings: r.warnings }, b) }
  }).concat([{ girdi: { onAC: false, battery: { percent: 15, healthPct: 90, limit: 'cekirdek' } }, ...bek(7, '%15 prizde değil → kapat', H.esikler({ ...taban, onAC: false, battery: { percent: 15, healthPct: 90, limit: 'cekirdek' } }).kapat, true) }])
}

function v12 () {
  const f = C.cerceveYaz(IPC.GOREV_BASLAT, 7, { taskId: b4a.alloc(16, 1) })
  return {
    cerceve: hex(f),
    ...bek(12, 'GOREV_BASLAT reqId 7', hex(f), '00000013' + '05' + '07' + '10' + '01'.repeat(16)),
    enBuyuk: C.EN_BUYUK,
    bilinmeyen: { ipcMsg: hex(c.encode(C.ipcMsg, { type: 99, reqId: 5, body: b4a.alloc(0) })), hata: hex(C.hataCercevesi(5, 'BILINMEYEN_TUR')) }
  }
}

function vektorler () {
  return {
    rfc: 'RFC-0007',
    not: 'Numaralar §16 ile aynı; 8–11 adım 5 ve 8 ile (yeni dosyada) gelir. Kök anahtarlar test tohumundandır (hash("yuva/v2/test/dugum-vektor/…")).',
    kokPub: hex(KOK.pk),
    yedekPub: hex(YEDEK.pk),
    1: v1(),
    2: v2(),
    3: v3(),
    4: v4(),
    5: v5(),
    6: v6(),
    7: v7(),
    12: v12()
  }
}

module.exports = { vektorler, KOK, YEDEK, KOK_DURUMU, PAKET, bildirim }
