// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// protocol/vectors/service.json üreticisi (RFC-0010 §17 vektörleri 1–8 ve 13). Belirlenimci: anahtarlar sabit tohumlardan,
// rastgele değerler (ephSecret, nonce, packageId, shareId, salt) girdide. Her maddenin sonucu calistir() ile hesaplanır;
// test aynı işlevle dosyadaki girdilerden yeniden hesaplar. Defter zincirleri ledger-v21 yardımcısının belirlenimci
// kimlikleriyle (core/core/test/yardimci/v21.js) kurulur ve dosyada hex olarak durur.
const b4a = require('b4a')
const sodium = require('sodium-native')
const { ledger: { Ledger, encodeEvent, decodeEvent }, kdf: { hashLP, deriveLP } } = require('@havenfold/core')
const V = require('../../../core/test/helpers/v21')
const K = require('../../encoding')
const Kt = require('../../card')
const P = require('../../package')
const O = require('../../approval')

const { T, hex } = V
const h = (x) => b4a.from(x, 'hex')
const tohum = (n) => hex(b4a.alloc(32, n))
const TS = V.TS0
const GUN = K.GUN_MS
const hata = (f) => { try { f(); return 'kabul' } catch (e) { return e.message } }

const signCifti = (seedHex) => {
  const publicKey = b4a.alloc(32)
  const secretKey = b4a.alloc(64)
  sodium.crypto_sign_seed_keypair(publicKey, secretKey, h(seedHex))
  return { publicKey, secretKey }
}

// Kart girdisi: imza ve şifre tohumları + alanlar
const VETERINER = {
  signSeed: tohum(0xa1), encSeed: tohum(0xa2), keyVersion: 2, name: 'Maple Veteriner Kliniği', category: 'veteriner',
  region: 'TR-35', contact: '17 Oak Avenue, Springfield · +1 555 0120', endpoint: 'https://hizmet.example.tr',
  accepts: ['yuva.pet.*'], kural: false, maxMB: 20, keepDays: 365, issuedAt: TS
}
const GUVENLIK = {
  signSeed: tohum(0xb1), encSeed: tohum(0xb2), keyVersion: 1, name: 'Güven Güvenlik', category: 'guvenlik', region: 'TR-35',
  contact: 'Alsancak · 0232 000 00 01', endpoint: 'https://guven.example.tr', accepts: ['mekan.guvenlik.*'], kural: true,
  maxMB: 25, keepDays: 30, issuedAt: TS
}
const YABANCI = { ...VETERINER, signSeed: tohum(0xc1), encSeed: tohum(0xc2), name: 'Vet Abroad', region: 'DE-BE', endpoint: 'https://vet.example.de' }

function kartKur (g) {
  const { signSeed, encSeed, ...alan } = g
  return Kt.kartImzala({ ...alan, encPub: P.sifreCifti(h(encSeed)).publicKey }, signCifti(signSeed).secretKey)
}
// Alan denetimini atlayan imzalı kart (dizinde tek bozuk kart vektörü için)
function hamKart (g) {
  const { signSeed, encSeed, ...alan } = g
  const sc = signCifti(signSeed)
  const govde = K.kodla(K.KART.govde, { ...alan, signPub: sc.publicKey, serviceId: Kt.serviceIdOf(sc.publicKey), encPub: P.sifreCifti(h(encSeed)).publicKey }, 'X')
  return b4a.concat([govde, Kt.imzala(hashLP(K.ETIKET.kart, govde), sc.secretKey)])
}

// Gövde girdisi (hex alanlar buffer'a)
function govdeOf (g, kart) {
  return {
    serviceId: kart.serviceId, shareId: h(g.shareId), kind: g.kind, category: g.category, title: g.title, note: g.note,
    items: g.items.map((x) => ({ type: x.type, fields: P.alanlarKodla(x.alanlar) })),
    files: g.files.map((f) => ({ ...f, blobId: h(f.blobId), fileKey: h(f.fileKey) })),
    issuedAt: g.issuedAt, useUntil: g.useUntil, replyPub: h(g.replyPub),
    sender: { pseudoPub: P.takmaAd(h(g.takmaSeed)).publicKey, label: g.label }
  }
}
const GOVDE = {
  shareId: hex(b4a.alloc(16, 0x51)), kind: 'tek', category: 'veteriner', title: 'Coki · son 7 gün kum kabı',
  note: 'Üç gündür az yiyor.', items: [{ type: 'yuva.pet.kum', alanlar: { _v: 1, _t: TS - GUN, adet: 2 } }],
  files: [{ blobId: hex(b4a.alloc(32, 0x61)), fileKey: hex(b4a.alloc(32, 0x62)), size: 120_000, mime: 'image/jpeg', name: 'kum.jpg' }],
  issuedAt: TS, useUntil: TS + 30 * GUN, replyPub: hex(b4a.alloc(32, 0x63)), takmaSeed: tohum(0x71), label: 'İrem'
}

// Defter zincirleri
function zincirOf (adimlar) {
  const L = new Ledger()
  return adimlar(L).map((f) => { const e = f(); L.apply(e); return hex(encodeEvent(e)) })
}
function defter (zincir) {
  const L = new Ledger()
  for (const x of zincir) L.apply(decodeEvent(h(x)))
  return L
}
const sc = (L, body, imz) => V.olay(L, T.SHARE_CONSENT, body, imz)
const PAY1 = b4a.alloc(16, 0x51)
const PAY2 = b4a.alloc(16, 0x52)
const PAY3 = b4a.alloc(16, 0x53)
const PAY4 = b4a.alloc(16, 0x54)
const OZET = b4a.alloc(32, 0x55)
const svc = (g) => 'hizmet:' + hex(Kt.serviceIdOf(signCifti(g.signSeed).publicKey))
const SALT = b4a.alloc(32, 0x57)

// Vektör 7 ve 13: ana zincir (scope 'pati' olan ilk onay biçim bozuk) + onay, tekrar, sahibi farklı iptal, iptal, gizli
const ZINCIR_YORUM = zincirOf((L) => [
  ...V.anaAdimlar(L),
  () => sc(L, { shareId: PAY1, service: svc(VETERINER), scope: 'tek:veteriner', ownerId: V.K.irem.memberId, expiresAt: TS + 7 * GUN, payloadHash: OZET }, [V.K.irem]),
  () => sc(L, { shareId: PAY1, service: svc(VETERINER), scope: 'tek:veteriner', ownerId: V.K.irem.memberId, expiresAt: TS + 5 * GUN, payloadHash: OZET }, [V.K.irem]),
  () => sc(L, { shareId: PAY1, service: svc(VETERINER), scope: 'iptal', ownerId: V.ZERO16, expiresAt: 0, payloadHash: V.ZERO32 }, [V.K.kerem]),
  () => sc(L, { shareId: PAY1, service: svc(VETERINER), scope: 'iptal', ownerId: V.K.irem.memberId, expiresAt: 0, payloadHash: V.ZERO32 }, [V.K.irem]),
  () => sc(L, { shareId: PAY1, service: svc(VETERINER), scope: 'iptal', ownerId: V.K.irem.memberId, expiresAt: 0, payloadHash: V.ZERO32 }, [V.K.irem]),
  () => sc(L, { shareId: PAY2, service: svc(VETERINER), scope: 'tek:veteriner', ownerId: V.ZERO16, expiresAt: TS + 7 * GUN, payloadHash: OZET }, [V.K.kerem]),
  () => sc(L, { shareId: PAY3, service: 'hizmet:abc', scope: 'tek:veteriner', ownerId: V.ZERO16, expiresAt: TS + 7 * GUN, payloadHash: OZET }, [V.K.kerem]),
  () => sc(L, { shareId: PAY4, service: O.gizliService(Kt.serviceIdOf(signCifti(VETERINER.signSeed).publicKey), SALT), scope: 'gizli', ownerId: V.K.irem.memberId, expiresAt: TS + 7 * GUN, payloadHash: OZET }, [V.K.irem]),
  // Açıklama 3 madde 1: Paylaşımlar'ın okuyucusu (yetişkin İrem) ebeveynin ortak veri onayını iptal eder; defter kabul eder
  () => sc(L, { shareId: PAY2, service: svc(VETERINER), scope: 'iptal', ownerId: V.ZERO16, expiresAt: 0, payloadHash: V.ZERO32 }, [V.K.irem])
])

// Vektör 8: kural onayını tek ebeveyn imzalar; o ebeveyn REMOVE_MEMBER ile çıkar
const PAY_KURAL = b4a.alloc(16, 0x58)
const kuralZinciri = (cikar) => zincirOf((L) => [
  ...V.anaAdimlar(L),
  () => sc(L, { shareId: PAY_KURAL, service: svc(GUVENLIK), scope: 'kural:guvenlik', ownerId: V.ZERO16, expiresAt: TS + 30 * GUN, payloadHash: OZET }, [V.K.husniye]),
  ...(cikar ? [() => V.olay(L, T.REMOVE_MEMBER, { memberId: V.K.husniye.memberId, reason: 'test', wipe: false }, [V.K.kerem, V.K.irem])] : [])
])

const ozetle = (o) => ({ durum: o.durum, neden: o.neden, tur: o.tur, kategori: o.kategori, seq: o.seq, iptal: o.iptal && o.iptal.seq, yokSayilan: o.yokSayilan })

function calistir (m) {
  const g = m.girdi
  if (m.tur === 'kart') {
    const bytes = kartKur(g.kart)
    const k = Kt.kartCoz(bytes)
    const kucuk = Kt.kartCoz(kartKur({ ...g.kart, keyVersion: g.kart.keyVersion - 1 }))
    const buyuk = Kt.kartCoz(kartKur({ ...g.kart, keyVersion: g.kart.keyVersion + 1 }))
    const bozuk = b4a.from(bytes)
    bozuk[bozuk.byteLength - 1] ^= 1
    return {
      kart: hex(bytes), serviceId: hex(k.serviceId), signPub: hex(k.signPub), encPub: hex(k.encPub), sig: hex(k.sig),
      imzaBozuk: hata(() => Kt.kartCoz(bozuk)), kucukSurum: hata(() => Kt.kartSec(k, kucuk)),
      buyukSurum: Kt.kartSec(k, buyuk).keyVersion, ayniKart: Kt.kartSec(k, Kt.kartCoz(bytes)).keyVersion,
      ayniSurumYeniTarih: Kt.kartSec(k, Kt.kartCoz(kartKur({ ...g.kart, issuedAt: g.kart.issuedAt + 1 }))).issuedAt - g.kart.issuedAt,
      ayniSurumEskiTarih: hata(() => Kt.kartSec(k, Kt.kartCoz(kartKur({ ...g.kart, issuedAt: g.kart.issuedAt - 1 }))))
    }
  }
  if (m.tur === 'dizin') {
    const dizinCifti = signCifti(g.dizinSeed)
    const kartlar = [...g.kartlar.map(kartKur), ...g.bozukKartlar.map(hamKart)]
    const revoked = g.revoked.map((x) => Kt.serviceIdOf(signCifti(x).publicKey))
    const bytes = Kt.dizinImzala({ version: g.version, region: g.region, issuedAt: g.issuedAt, validUntil: g.validUntil, cards: kartlar, revoked }, dizinCifti.secretKey)
    const d = Kt.dizinCoz(bytes, [signCifti(g.digerSeed).publicKey, dizinCifti.publicKey])
    const yuzYuze = Kt.kartCoz(kartKur(g.yuzYuze))
    const iptalli = Kt.kartCoz(kartKur(g.iptalli))
    return {
      dizin: hex(bytes), kartSayisi: d.kartlar.size, atlanan: d.atlanan, revoked: [...d.revoked],
      yanlisAnahtar: hata(() => Kt.dizinCoz(bytes, [signCifti(g.digerSeed).publicKey])),
      dizindeki: Kt.hizmetKarti({ dizin: d, serviceId: kartlar[0].subarray(0, 16), simdi: g.simdi }).trust,
      yuzYuze: Kt.hizmetKarti({ dizin: d, kart: yuzYuze, simdi: g.simdi }).trust,
      yuzYuzeEskiDizinle: Kt.hizmetKarti({ dizin: d, kart: yuzYuze, simdi: g.validUntil + 1 }).trust,
      yuzYuzeDizinsiz: Kt.hizmetKarti({ dizinler: [], kart: yuzYuze, simdi: g.simdi }).trust,
      iptalli: hata(() => Kt.hizmetKarti({ dizin: d, kart: iptalli, simdi: g.simdi })),
      eskiDizin: hata(() => Kt.hizmetKarti({ dizin: d, serviceId: kartlar[0].subarray(0, 16), simdi: g.validUntil + 1 })),
      uzunGecerlilik: hata(() => Kt.dizinImzala({ version: 1, region: g.region, issuedAt: g.issuedAt, validUntil: g.issuedAt + 15 * GUN, cards: [], revoked: [] }, dizinCifti.secretKey))
    }
  }
  if (m.tur === 'qr') {
    const bytes = kartKur(g.kart)
    const qr = Kt.qrKodla(bytes)
    const govde = qr.slice(Kt.QR_PREFIX.length)
    const harf = qr.slice(0, g.harf) + (qr[g.harf] === 'A' ? 'B' : 'A') + qr.slice(g.harf + 1)
    const ham = K.b32Coz(govde, 'X')
    ham[g.bayt] ^= 0x01
    return {
      qr, okunan: hex(Kt.qrCoz(qr).serviceId), sagla: hex(hashLP(K.ETIKET.qr, bytes).subarray(0, 4)),
      harfDegisince: hata(() => Kt.qrCoz(harf)), baytDegisince: hata(() => Kt.qrCoz(Kt.QR_PREFIX + K.b32(ham))),
      kucukHarf: hata(() => Kt.qrCoz(Kt.QR_PREFIX + govde.toLowerCase())), onekYok: hata(() => Kt.qrCoz(govde))
    }
  }
  if (m.tur === 'paket') {
    const kartB = kartKur(g.kart)
    const kart = Kt.kartCoz(kartB)
    const govde = P.govdeKodla(govdeOf(g.govde, kart))
    const takma = P.takmaAd(h(g.govde.takmaSeed))
    const ic = P.icImzala(kart.serviceId, govde, takma.secretKey)
    const r = P.paketKur({ kart, ic, expiresAt: g.expiresAt, simdi: g.simdi, packageId: h(g.packageId), ephSecret: h(g.ephSecret), nonce: h(g.nonce) })
    // k ve AD bağımsız hesap (RFC-0010 §7.2 formülü)
    const ephPub = b4a.alloc(32)
    sodium.crypto_scalarmult_base(ephPub, h(g.ephSecret))
    const ortak = b4a.alloc(32)
    sodium.crypto_scalarmult(ortak, h(g.ephSecret), kart.encPub)
    const k = deriveLP(hashLP(K.ETIKET.dh, ortak, ephPub, kart.encPub), K.ETIKET.key)
    const p = P.paketCoz(r.bytes)
    const enc = P.sifreCifti(h(g.kart.encSeed))
    const acilan = P.paketAc(r.bytes, { kart, encSecret: enc.secretKey })
    const bozuk = b4a.from(r.bytes)
    bozuk[bozuk.byteLength - 1] ^= 1
    return {
      govde: hex(govde), payloadHash: hex(P.payloadHash(govde)), ic: hex(ic), ephPub: hex(ephPub), k: hex(k),
      ad: hex(P.adOf(p)), ct: hex(p.ct), paket: hex(r.bytes), ctHash: hex(r.ctHash),
      acilan: { title: acilan.govde.title, kind: acilan.govde.kind, label: acilan.govde.sender.label },
      ctBozuk: hata(() => P.paketAc(bozuk, { kart, encSecret: enc.secretKey })),
      yanlisAnahtar: hata(() => P.paketAc(r.bytes, { kart, encSecret: P.sifreCifti(h(g.kart.signSeed)).secretKey })),
      eskiSurum: hata(() => P.paketAc(r.bytes, { kart: { ...kart, keyVersion: kart.keyVersion + 1 }, encSecret: enc.secretKey })),
      sifirAnahtar: hata(() => P.paketKur({ kart: { ...kart, encPub: b4a.alloc(32) }, ic, expiresAt: g.expiresAt, simdi: g.simdi })),
      uzunTeslim: hata(() => P.paketKur({ kart, ic, expiresAt: g.simdi + 8 * GUN, simdi: g.simdi })),
      kimlikliOge: hata(() => P.govdeKodla({ ...govdeOf(g.govde, kart), items: [{ type: 'yuva.pet.kum', fields: P.alanlarKodla({ _subj: 'uye:' + hex(V.K.irem.memberId), adet: 2 }) }] }))
    }
  }
  if (m.tur === 'ozet') {
    const kart = Kt.kartCoz(kartKur(g.kart))
    const govde = P.govdeKodla(govdeOf(g.govde, kart))
    const onay = { durum: 'gecerli', tur: 'tek', service: 'hizmet:' + hex(kart.serviceId), payloadHash: P.payloadHash(govde), expiresAt: g.expiresAt }
    const degisik = P.govdeKodla(govdeOf({ ...g.govde, [g.alan]: g.yeni }, kart))
    return {
      ayni: hata(() => O.gonderimDenetle({ onay, govdeBytes: govde, serviceId: kart.serviceId, simdi: g.simdi })),
      alanDegisince: hata(() => O.gonderimDenetle({ onay, govdeBytes: degisik, serviceId: kart.serviceId, simdi: g.simdi })),
      sureGecince: hata(() => O.gonderimDenetle({ onay, govdeBytes: govde, serviceId: kart.serviceId, simdi: g.expiresAt + 1 })),
      baskaHizmet: hata(() => O.gonderimDenetle({ onay, govdeBytes: govde, serviceId: b4a.alloc(16, 9), simdi: g.simdi }))
    }
  }
  if (m.tur === 'takma') {
    const a = Kt.kartCoz(kartKur(g.kartA))
    const b = Kt.kartCoz(kartKur(g.kartB))
    const takma = P.takmaAd(h(g.takmaSeed))
    const body = P.govdeKodla(govdeOf(g.govde, a))
    const { sig } = K.kanonik(K.PAKET_IC, P.icImzala(a.serviceId, body, takma.secretKey), 'X')
    const ozet = (id) => hashLP(K.ETIKET.pkg, id, body)
    // B'ye, A'nın serviceId'li gövdeyle kurulmuş paket: B açar ama gövde onun değildir
    const ic = P.icImzala(a.serviceId, body, takma.secretKey)
    const r = P.paketKur({ kart: b, ic, expiresAt: g.simdi + GUN, simdi: g.simdi, packageId: b4a.alloc(16, 1), ephSecret: b4a.alloc(32, 2), nonce: b4a.alloc(24, 3) })
    return {
      takmaPub: hex(takma.publicKey), sig: hex(sig),
      kendiHizmeti: Kt.dogrula(sig, ozet(a.serviceId), takma.publicKey),
      baskaHizmet: Kt.dogrula(sig, ozet(b.serviceId), takma.publicKey),
      baskaHizmeteGiden: hata(() => P.paketAc(r.bytes, { kart: b, encSecret: P.sifreCifti(h(g.kartB.encSeed)).secretKey }))
    }
  }
  if (m.tur === 'yorum') {
    const L = defter(g.zincir)
    const on = O.onaylar(L)
    return { defterUzunlugu: L.len, onaylar: Object.fromEntries([...on].map(([id, o]) => [id, ozetle(o)])) }
  }
  if (m.tur === 'kural-imzaci') {
    const once = O.onaylar(defter(g.once)).get(hex(PAY_KURAL))
    const sonra = O.onaylar(defter(g.sonra)).get(hex(PAY_KURAL))
    return { once: ozetle(once), sonra: ozetle(sonra) }
  }
  if (m.tur === 'gizli') {
    const kart = Kt.kartCoz(kartKur(g.kart))
    const salt = h(g.salt)
    const L = defter(g.zincir)
    const onay = O.onaylar(L).get(g.shareId)
    const govde = P.govdeKodla(govdeOf(g.govde, kart))
    const yeni = O.onayGovdesi({ shareId: h(g.shareId), serviceId: kart.serviceId, tur: 'gizli', ownerId: V.K.irem.memberId, expiresAt: g.simdi + GUN, payloadHash: P.payloadHash(govde), simdi: g.simdi, salt })
    const yerler = { paylasimlar: g.paylasimlar, kisisel: g.kisisel }
    return {
      commit: O.gizliService(kart.serviceId, salt), yeniService: yeni.govde.service, yeniScope: yeni.govde.scope,
      yorum: ozetle(onay), kayitYeri: O.kayitYeri({ onay, ...yerler }),
      tekKayitYeri: O.kayitYeri({ onay: { tur: 'tek' }, ...yerler }),
      tuzsuzGonderim: hata(() => O.gonderimDenetle({ onay: { ...onay, payloadHash: P.payloadHash(govde) }, govdeBytes: govde, serviceId: kart.serviceId, simdi: g.simdi })),
      tuzluGonderim: hata(() => O.gonderimDenetle({ onay: { ...onay, payloadHash: P.payloadHash(govde) }, govdeBytes: govde, serviceId: kart.serviceId, simdi: g.simdi, salt })),
      ortakVeri: hata(() => O.onayGovdesi({ serviceId: kart.serviceId, tur: 'gizli', expiresAt: g.simdi + GUN, payloadHash: OZET, simdi: g.simdi }))
    }
  }
  if (['cevap', 'baslik', 'kaynak'].includes(m.tur)) return require('./service-step-45-vector').calistir(m) // adım 4–5
  throw new Error('BILINMEYEN_MADDE ' + m.tur)
}

function vektorler () {
  const maddeler = [
    { no: 1, tur: 'kart', aciklama: 'HIZMET_KARTI: kodlama, serviceId türetimi, imza; keyVersion küçük kart → red; aynı sürümde büyük issuedAt kazanır', girdi: { kart: VETERINER } },
    {
      no: 2,
      tur: 'dizin',
      aciklama: 'HIZMET_DIZINI: imza; validUntil geçmiş dizinle yeni paylaşım → INDEX_STALE (yüz yüze kart dizinsiz geçer); revoked içindeki hizmet → red; bozuk kart yalnız kendisi atlanır',
      girdi: { dizinSeed: tohum(0xd1), digerSeed: tohum(0xd2), version: 7, region: 'TR-35', issuedAt: TS, validUntil: TS + 14 * GUN, kartlar: [VETERINER, GUVENLIK], bozukKartlar: [{ ...YABANCI, signSeed: tohum(0xc5), category: 'kuafor' }], revoked: [tohum(0xe1)], yuzYuze: YABANCI, iptalli: { ...VETERINER, signSeed: tohum(0xe1) }, simdi: TS + GUN }
    },
    { no: 3, tur: 'qr', aciklama: 'QR kartı: HFH1: kodlaması ve sağlama; tek bayt değişince → red', girdi: { kart: GUVENLIK, harf: 20, bayt: 40 } },
    {
      no: 4,
      tur: 'paket',
      aciklama: 'Sabit ephSecret, nonce ve anahtarlarla PACKAGE_ERROR: k, AD, ct, packageId; hizmet tarafında açma; aile içi kimlik pakete girmez (açıklama 2 madde 1)',
      girdi: { kart: VETERINER, govde: GOVDE, packageId: hex(b4a.alloc(16, 0x81)), ephSecret: tohum(0x82), nonce: hex(b4a.alloc(24, 0x83)), expiresAt: TS + 7 * GUN, simdi: TS }
    },
    { no: 5, tur: 'ozet', aciklama: 'payloadHash: gövdenin bir alanı değişince onay tutmaz → gönderim yok', girdi: { kart: VETERINER, govde: GOVDE, alan: 'note', yeni: 'Üç gündür az yiyor!', expiresAt: TS + 7 * GUN, simdi: TS + GUN } },
    { no: 6, tur: 'takma', aciklama: 'Takma ad imzası; başka hizmetin serviceId\'siyle imza doğrulaması → red', girdi: { kartA: VETERINER, kartB: YABANCI, govde: GOVDE, takmaSeed: GOVDE.takmaSeed, simdi: TS } },
    {
      no: 7,
      tur: 'yorum',
      aciklama: 'Onay yorumu: ilk SHARE_CONSENT onay; aynı shareId ikinci kez tek → yok sayılır; ownerId farklı iptal → yok sayılır; iptal → iptal; bozuk scope ve kısa hex → geçersiz; okuyucu (yetişkin) iptal biçimini yazar → iptal (açıklama 3 madde 1). Hepsi defterde kabul edilir',
      girdi: { zincir: ZINCIR_YORUM }
    },
    { no: 8, tur: 'kural-imzaci', aciklama: 'Kural onayını imzalayan tek ebeveyn REMOVE_MEMBER ile çıkar → kural iptal sayılır', girdi: { once: kuralZinciri(false), sonra: kuralZinciri(true) } },
    {
      no: 13,
      tur: 'gizli',
      aciklama: 'gizli onay: commit türetimi; Paylaşımlar\'a kayıt yazılmaz, kişisel koleksiyona yazılır',
      girdi: { kart: VETERINER, govde: GOVDE, salt: hex(SALT), shareId: hex(PAY4), zincir: ZINCIR_YORUM, simdi: TS, paylasimlar: hex(b4a.alloc(16, 0x91)), kisisel: hex(V.K_KISISEL_IREM) }
    }
  ]
  for (const m of maddeler) m.beklenen = calistir(m)
  maddeler.push(...require('./service-step-45-vector').maddeler()) // adım 4–5: 11, 12, 14
  maddeler.sort((a, b) => a.no - b.no)
  return {
    rfc: 'RFC-0010 §17', etiketBicimi: 'hashLP/deriveLP (RFC-0027 §8 b)',
    basliklar: 'x-hf-auth = hex(u64be(t) ‖ nonce(16) ‖ sig(64)); imzalanan yol sorgu dahil', maddeler
  }
}

module.exports = { vektorler, calistir, kartKur, hamKart, govdeOf, signCifti, defter, VETERINER, GUVENLIK, YABANCI, GOVDE, ZINCIR_YORUM, kuralZinciri, PAY_KURAL }
