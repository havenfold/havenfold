// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// protocol/vectors/ledger-v21-v2.json üreticisi (RFC-0003 §11). Belirlenimci: sabit tohum, sabit ts, Ed25519.
// Dosyayı yazmak için: node core/core/scripts/vector-gen.js
const b4a = require('b4a')
const sodium = require('sodium-native')
const { pairSecret, pairSubkeys } = require('../../crypto/pair')
const { sealEnvelopeVektor } = require('../../messaging/seal')
const { buildGuestView } = require('../../protocol/guest-view')
const E = require('../../protocol/retirement')
const PAIR = require('../vectors/yuva-hat/pair.json')
const { Ledger, encodeEvent, decodeEvent } = require('../../ledger/ledger')
const {
  C, K, T, hex, uye, olay, YER_YAZLIK, K_TUM_AILE, K_KISISEL_IREM, K_KASA,
  cihazEkle, cihazCikar, koleksiyon, misafirKaldir, anaAdimlar
} = require('./v21')

function zincir (adimlarOf) {
  const L = new Ledger()
  const olaylar = []
  for (const f of adimlarOf(L)) {
    const e = f()
    L.apply(e)
    olaylar.push({ tur: e.type, olay: hex(encodeEvent(e)), bas: hex(L.head) })
  }
  return { L, olaylar }
}

const kur = (olaylar, onek) => {
  const L = new Ledger()
  for (const o of olaylar.slice(0, onek)) L.apply(decodeEvent(b4a.from(o.olay, 'hex')))
  return L
}

// Ana zincir + 15 cihaz (16 aktif) + bir çıkarma + yeniden 16. cihaz
function cihazAdimlari (L) {
  const adimlar = anaAdimlar(L)
  for (let i = 2; i <= 16; i++) adimlar.push(() => cihazEkle(L, C['isci' + i], [K.kerem]))
  adimlar.push(() => cihazCikar(L, C.isci2, [K.kerem]))
  adimlar.push(() => cihazEkle(L, C.isci17, [K.husniye]))
  return adimlar
}

function vektorler () {
  const ana = zincir(anaAdimlar)
  const cihaz = zincir(cihazAdimlari)
  const N = ana.olaylar.length
  const durumlar = []
  const gecersiz = (no, aciklama, z, onek, yap, hata) => {
    const L = kur(z === 'ana' ? ana.olaylar : cihaz.olaylar, onek)
    durumlar.push({ no, aciklama, zincir: z, onek, olay: hex(encodeEvent(yap(L))), hata })
  }
  const gecerli = (no, aciklama, z, sira) => {
    const o = (z === 'ana' ? ana : cihaz).olaylar[sira]
    durumlar.push({ no, aciklama, zincir: z, onek: sira, olay: o.olay, gecerli: true, bas: o.bas })
  }

  gecersiz(2, 'PROTOCOL_LEVEL yokken DEVICE_ATTACH', 'ana', 6, (L) => cihazEkle(L, C.isci2, [K.kerem]), 'LEVEL_TOO_LOW')
  gecerli(2, 'KIND seq 1\'de kurucunun tek imzasıyla, düzey kapısından muaf', 'ana', 1)
  gecerli(3, 'Cihaz kendi DEVICE_DETACH\'ını imzalar', 'ana', 19)
  gecersiz(3, 'Cihaz başka bir cihazın DEVICE_DETACH\'ını imzalar', 'ana', 19, (L) => cihazCikar(L, C.uc1, [C.isci1]), 'DEVICE_CANNOT_VOTE')
  gecersiz(4, 'Ebeveyn, yetişkinin kişisel koleksiyonuna kendini ekler', 'ana', N, (L) => koleksiyon(L, [K.kerem], {
    collectionId: K_KISISEL_IREM, name: 'Kişisel', kind: 'kisisel', readers: [uye(K.irem), uye(K.kerem)], writers: [uye(K.irem)], taskAccess: false
  }), 'PERSONAL_COLLECTION')
  gecersiz(5, 'Kasa koleksiyonunda taskAccess: true', 'ana', N, (L) => koleksiyon(L, [K.kerem, K.husniye], {
    collectionId: K_KASA, name: 'Kasa', readers: ['rol:ebeveyn'], writers: ['rol:ebeveyn'], sensitivity: 'kasa', taskAccess: true
  }), 'VAULT_RULE')
  gecersiz(5, 'Kasa koleksiyonunda grant: okuyucu', 'ana', 17, (L) => koleksiyon(L, [K.kerem, K.husniye], {
    collectionId: b4a.alloc(16, 0x36), name: 'Bakıcı kasası', kind: 'bakici', readers: ['rol:ebeveyn', 'grant:' + hex(C.misafir1.memberId)], writers: ['rol:ebeveyn'], sensitivity: 'kasa', taskAccess: false
  }), 'VAULT_RULE')
  gecersiz(6, '17. cihaz', 'cihaz', N + 15, (L) => cihazEkle(L, C.isci18, [K.kerem]), 'DEVICE_LIMIT')
  gecerli(6, 'Bir cihaz çıkarıldıktan sonra 16. cihaz', 'cihaz', N + 16)
  gecersiz(9, 'Daha önce üye olmuş kimlik cihaz olarak eklenir', 'ana', N, (L) => cihazEkle(L, K.ecem, [K.kerem]), 'IDENTITY_ALREADY_EXISTS')
  gecersiz(10, 'Aynı misafir için ikinci REVOKE', 'ana', N, (L) => misafirKaldir(L, C.misafir1, [K.kerem]), 'NO_TARGET')

  // §11 madde 8: ebeveynin yazdığı DEVICE_DETACH dalı güçlüdür, cihazın kendi yazdığı değildir.
  // B dalının ilk olayı daha çok imzacılıdır; A dalı yalnız güçlüyse kazanır.
  const dal = (adimlar) => {
    const L = kur(ana.olaylar, N)
    return adimlar.map((f) => { const e = f(L); L.apply(e); return hex(encodeEvent(e)) })
  }
  const yazlik = (L) => olay(L, T.PLACE, { placeId: YER_YAZLIK, name: 'Yazlık', kind: 'yazlik', remove: false }, [K.kerem])
  const dalB = dal([(L) => koleksiyon(L, [K.kerem, K.husniye], { collectionId: K_TUM_AILE, name: 'Tüm Aile 2' })])
  const catallanma = [
    { aciklama: 'Ebeveynin imzaladığı DEVICE_DETACH güçlüdür: A kazanır', onek: N, dalA: dal([yazlik, (L) => cihazCikar(L, C.isci1, [K.husniye])]), dalB, kazanan: 'A' },
    { aciklama: 'Cihazın kendi DEVICE_DETACH\'ı güçlü değildir: imzacı sayısıyla B kazanır', onek: N, dalA: dal([yazlik, (L) => cihazCikar(L, C.isci1, [C.isci1])]), dalB, kazanan: 'B' }
  ]

  return {
    aciklama: 'RFC-0003 §11: defter v2.1. olay = encodeEvent (compact-encoding), bas = olaydan sonra eventHash. Kimlikler createIdentity({seed: "defter-vektor/<ad>"}) (üyeler) ve "ledger-v21/<ad>" (cihaz, misafir). Durum: zincirin ilk `onek` olayı uygulanır, sonra `olay` ya `hata` ile reddedilir ya da geçerlidir. §11 madde 1: ana zincir 13–23 numaralı olayların her birini içerir. Madde 7 (KIND ekip) RFC-0005 vektörlerindedir (RFC-0005 §18); bu çekirdek RFC-0005\'i henüz uygulamıyor.',
    zincirler: { ana: ana.olaylar, cihaz: cihaz.olaylar },
    durumlar,
    catallanma,
    ertelenen: [{ no: 7, aciklama: 'KIND ekip → RFC-0005 ile geçerli; vektörler RFC-0005 §18' }],
    kripto: kripto(ana)
  }
}

// Bu RFC'nin kripto parçaları (§6.2 taskKey, §6.4 mühür, §7 GUEST_VIEW imzası, §8 silme raporu).
// Kripto kodu vektörsüz kaydedilmez (kol D kuralı).
function kripto (ana) {
  const h = (s) => b4a.from(s, 'hex')
  const g = PAIR.girdi
  const pair = pairSecret({ myUdaSecret: h(g.aSecret), theirUdaPub: h(g.bPub), myId: h(g.idA), theirId: h(g.idB), familyId: h(g.familyId), anchorHash: h(g.anchorHash), ceremonyKey: h(g.ceremonyKey) })
  const sub = pairSubkeys(pair, h(g.idA), h(g.idB))
  const zarfId = b4a.alloc(16, 0x2a)
  const nonce = b4a.alloc(24, 0x24)
  const govde = b4a.from('havenfold muhur vektoru')
  const muhur = [0x82, 0x94, 0x9c].map((tur) => ({
    tur,
    anahtar: tur >= 0x90 && tur <= 0x97 ? 'hf/task/' : 'ctrl',
    muhurlu: hex(sealEnvelopeVektor(pair, h(g.idA), h(g.idB), tur, govde, zarfId, nonce))
  }))

  const L = kur(ana.olaylar, 17) // misafir1 aktif, GRANT'ı Kerem imzaladı
  const gorunum = buildGuestView(L, hex(C.misafir1.memberId), K.kerem)

  const anahtar = { publicKey: b4a.alloc(32), secretKey: b4a.alloc(64) }
  sodium.crypto_sign_seed_keypair(anahtar.publicKey, anahtar.secretKey, b4a.alloc(32, 0x5a))
  const rapor = (disk, method) => E.signWipeReport({
    deviceId: C.isci1.memberId, serial: 'SN-1', model: 'Lenovo T480', diskModel: 'NVMe ' + disk, diskSerial: 'D-' + disk,
    method, tool: 'havenfold-sil', toolVersion: '1.0.0', driveStatus: 'sanitize ok', startedAt: 1790000000000, finishedAt: 1790000600000, result: 'ok'
  }, anahtar)
  const r1 = rapor('A', 'nvme-sanitize-block')
  const r2 = rapor('B', 'ata-sanitize')
  const anahtarQr = E.encodeKeyQr({ hostId: b4a.alloc(16, 0x48), ids: [C.isci1.memberId], retireNonce: b4a.alloc(16, 0x4e), reportPub: anahtar.publicKey, disks: 2, toolVersion: '1.0.0' })

  return {
    aciklama: 'Girdi Yuva Hat pair.json. taskKey = derive(pair, "hf/task/"). Mühür: nonce(24) ‖ XChaCha20-Poly1305(anahtar, gövde, AD = gönderen ‖ alıcı ‖ tür ‖ zarf id), gönderen idA, alıcı idB. Görünüm: ana zincirin ilk 17 olayından sonra Kerem\'in misafir1 için GUEST_VIEW\'i. Silme: rapor anahtarı tohumu 32 × 0x5a.',
    taskKey: hex(sub.taskKey),
    muhur: { zarfId: hex(zarfId), nonce: hex(nonce), govde: hex(govde), durumlar: muhur },
    misafirGorunumu: { onek: 17, misafir: hex(C.misafir1.memberId), gorunum: hex(gorunum) },
    silme: {
      raporPub: hex(anahtar.publicKey),
      raporlar: [hex(r1), hex(r2)],
      raporKimlikleri: [hex(E.wipeReportId(r1)), hex(E.wipeReportId(r2))],
      tekDiskOzeti: hex(E.wipeReportHash([r1])),
      kumeOzeti: hex(E.wipeReportHash([r1, r2])),
      anahtarQr,
      parcalar128: E.encodeReportChunks([r1, r2], E.CHUNK_KONSOL)
    }
  }
}

module.exports = { vektorler }
