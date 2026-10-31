// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// package.js — paket gövdesi, takma ad, payloadHash, paketin hizmete şifrelenmesi ve hizmet tarafında açılması
// (RFC-0010 §7, §9.1 KURAL ve DELEGE)
//
//   payloadHash = hashLP('hf/share-payload/', PAKET_GOVDE)
//   PAKET_IC.sig = Ed25519(imzalayan, hashLP('hf/share-pkg/', serviceId, body))
//                  imzalayan: tek ve silme → takma ad; kural → DELEGE.delegatePub
//   dh = hashLP('hf/share-dh/', X25519(ephSecret, encPub), ephPub, encPub)
//   k  = deriveLP(dh, 'hf/share-key/')
//   AD = hashLP('hf/share-ad/', serviceId, packageId, u64be(keyVersion), ephPub, u64be(expiresAt))
//   ct = XChaCha20-Poly1305(k, nonce, PAKET_IC, AD)
// Algoritmalar kurucu §13.2'dekilerdir; yeni ilkel yoktur. ephSecret, dh ve k kullanıldıktan sonra sıfırlanır.
const sodium = require('sodium-native')
const b4a = require('b4a')
const { kdf: { hashLP, deriveLP } } = require('@havenfold/core')
const K = require('./encoding')
const { kodlama: KK } = require('@havenfold/records')
const c = require('compact-encoding')
const { imzala, dogrula } = require('./card')

const { ETIKET, SINIR, GUN_MS, MB } = K
const TURLER = ['tek', 'kural', 'silme']
const ABYTES = sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES

function fail (kod) { throw new Error(kod) }
const rastgele = (n) => { const b = b4a.alloc(n); sodium.randombytes_buf(b); return b }

/** Takma ad (§7.4): her üye, her hizmet için ayrı ve rastgele Ed25519 çifti. seed yalnız vektör yolunda */
function takmaAd (seed = null) {
  const publicKey = b4a.alloc(32)
  const secretKey = b4a.alloc(64)
  if (seed) sodium.crypto_sign_seed_keypair(publicKey, secretKey, seed)
  else sodium.crypto_sign_keypair(publicKey, secretKey)
  return { publicKey, secretKey }
}

/** Hizmetin X25519 şifreleme çifti (Hizmet Masası ve referans alıcı; vektör için seed) */
function sifreCifti (seed = null) {
  const publicKey = b4a.alloc(32)
  const secretKey = b4a.alloc(32)
  if (seed) sodium.crypto_box_seed_keypair(publicKey, secretKey, seed)
  else sodium.crypto_box_keypair(publicKey, secretKey)
  return { publicKey, secretKey }
}

// §7.1 ve §16 sınırları; tür ile seçimli alanlar tutarlı olmalı
function govdeAlanlari (m) {
  if (m.v !== 1 || !TURLER.includes(m.kind) || !K.KATEGORILER.includes(m.category)) fail('BODY_CORRUPT')
  if (K.bayt(m.title) > SINIR.baslik || K.bayt(m.note) > SINIR.not || K.bayt(m.sender.label) > SINIR.etiket) fail('BODY_CORRUPT')
  if (m.items.length > SINIR.oge || m.files.length > SINIR.dosya) fail('BODY_CORRUPT')
  for (const i of m.items) {
    let al
    try { al = alanlarCoz(i.fields) } catch { fail('BODY_CORRUPT') }
    // Aile içi kimlik pakete girmez (açıklama 2 madde 1): _subj ve uye:/grant:/device: başvuruları
    if (Object.entries(al).some(([a, v]) => a === '_subj' || kimlikMi(v))) fail('IDENTITY_IN_PACKAGE')
  }
  if (m.useUntil < m.issuedAt || m.useUntil > m.issuedAt + SINIR.kullanimGun * GUN_MS) fail('BODY_CORRUPT')
  if ((m.kind === 'kural') !== (m.ruleProof != null)) fail('BODY_CORRUPT')
  if ((m.kind === 'silme') !== (m.ref != null)) fail('BODY_CORRUPT')
  if (m.kind === 'silme' && (m.items.length || m.files.length)) fail('BODY_CORRUPT') // silme veri taşımaz (§7.1)
  if (m.kind === 'tek' && m.seqNo !== 0) fail('BODY_CORRUPT')
}

const KIMLIK_ON = /^(uye|grant|device):/
const kimlikMi = (v) => (typeof v === 'string' && KIMLIK_ON.test(v)) || (Array.isArray(v) && v.some(kimlikMi))

// Öğenin alanları RFC-0001 §4.3'teki { name, value } listesinin kodlamasıdır (kayıt katmanının alan biçimi)
const ALANLAR = c.array(KK.field)

/** Kaydın alanları ({ ad: değer }) → öğenin fields baytları. Ad kuralı ve değer türleri kayıt katmanınınki */
function alanlarKodla (alanlar) {
  const l = Object.entries(alanlar).map(([name, value]) => { KK.validateName(name); return { name, value } })
  try { return c.encode(ALANLAR, l) } catch { fail('INVALID_FIELD') }
}

/** Öğenin fields baytları → { ad: değer }; kanonik çözme */
function alanlarCoz (bytes) {
  return Object.fromEntries(KK.decodeCanonical(ALANLAR, bytes, 'INVALID_FIELD').map((f) => [f.name, f.value]))
}

/** PAKET_GOVDE baytları. Gövde onaydan önce kesinleşir: replyPub ve dosya anahtarları içindedir (§7.1) */
function govdeKodla (m) {
  const g = { v: 1, seqNo: 0, note: '', items: [], files: [], ruleProof: null, ref: null, ...m }
  govdeAlanlari(g)
  return K.kodla(K.GOVDE, g, 'BODY_CORRUPT')
}

function govdeCoz (bytes) {
  const m = K.kanonik(K.GOVDE, bytes, 'BODY_CORRUPT')
  govdeAlanlari(m)
  return m
}

/** SHARE_CONSENT.payloadHash (§6.1): tek ve gizli onayda gövdenin özeti */
const payloadHash = (govdeBytes) => hashLP(ETIKET.payload, govdeBytes)

/** hf.paylasim.gonderildi.ctHash (§10.2) */
const ctHash = (paketBytes) => hashLP(ETIKET.ct, paketBytes)

/** x-hf-owner (§13.1): alıcı yalnız özeti saklar */
const sahipOzeti = (ownerSecret) => K.hex(hashLP(ETIKET.owner, ownerSecret))

/** Gövdenin dosyalarının toplamı (§7.3): hizmetin maxMB'ı ve 25 MB */
function boyutDenetle (govde, kart) {
  const toplam = govde.files.reduce((a, f) => a + f.size, 0)
  if (toplam > Math.min(kart.maxMB, SINIR.paketMB) * MB) fail('SIZE_OVERRUN')
  return toplam
}

const pkgOzeti = (serviceId, body) => hashLP(ETIKET.pkg, serviceId, body)

/** PAKET_IC: gövde ve imzası. secretKey: tek/silme → takma adın, kural → DELEGE'nin gizli anahtarı */
function icImzala (serviceId, body, secretKey) {
  return K.kodla(K.PAKET_IC, { body, sig: imzala(pkgOzeti(serviceId, body), secretKey) }, 'PACKAGE_CORRUPT')
}

function anahtar (paylasilan, ephPub, encPub) {
  if (K.sifirMi(paylasilan)) fail('INVALID_KEY')
  const dh = hashLP(ETIKET.dh, paylasilan, ephPub, encPub)
  const k = deriveLP(dh, ETIKET.key)
  sodium.sodium_memzero(dh)
  sodium.sodium_memzero(paylasilan)
  return k
}
function x25519 (secret, pub) {
  const out = b4a.alloc(32)
  try { sodium.crypto_scalarmult(out, secret, pub) } catch { fail('INVALID_KEY') } // sıfır sonuç sodium'da hata
  return out
}

const adOf = (p) => hashLP(ETIKET.ad, p.serviceId, p.packageId, p.keyVersion, p.ephPub, p.expiresAt)

/**
 * Paketi kurar ve hizmetin encPub'ına şifreler (§7.2).
 * { kart, ic (PAKET_IC baytları), expiresAt, simdi, packageId?, ephSecret?, nonce? } → { bytes, packageId, ctHash }
 * packageId, ephSecret ve nonce yalnız vektör yolunda verilir; üretim yolunda rastgeledir. ephSecret her durumda
 * kopyalanıp kullanılır ve kopyası sıfırlanır.
 */
function paketKur ({ kart, ic, expiresAt, simdi, packageId = null, ephSecret = null, nonce = null }) {
  if (!(expiresAt > simdi) || expiresAt > simdi + SINIR.teslimGun * GUN_MS) fail('INVALID_DURATION')
  const eph = ephSecret ? b4a.from(ephSecret) : rastgele(32)
  const ephPub = b4a.alloc(32)
  sodium.crypto_scalarmult_base(ephPub, eph)
  let k
  try { k = anahtar(x25519(eph, kart.encPub), ephPub, kart.encPub) } finally { sodium.sodium_memzero(eph) }
  const p = { v: 1, serviceId: kart.serviceId, packageId: packageId || rastgele(16), keyVersion: kart.keyVersion, ephPub, nonce: nonce || rastgele(24), expiresAt }
  const ct = b4a.alloc(ic.byteLength + ABYTES)
  sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(ct, ic, adOf(p), null, p.nonce, k)
  sodium.sodium_memzero(k)
  const bytes = K.kodla(K.PAKET, { ...p, ct }, 'PACKAGE_CORRUPT')
  return { bytes, packageId: p.packageId, ctHash: ctHash(bytes) }
}

/** Alıcının ve hizmetin gördüğü dış kabuk (geçit içeriği görmez) */
const paketCoz = (bytes) => K.kanonik(K.PAKET, bytes, 'PACKAGE_CORRUPT')

/** KURAL baytları ve ruleHash (§9.1) */
const kuralKodla = (m) => K.kodla(K.KURAL, m, 'RULE_CORRUPT')
const ruleHash = (kuralBytes) => hashLP(ETIKET.kural, kuralBytes)

/** DELEGE: takma adın, kural için ürettiği anahtarı yetkilendirmesi */
function delegeImzala (m, takmaSecret) {
  const govde = K.kodla(K.DELEGE.govde, m, 'DELEGATION_CORRUPT')
  return b4a.concat([govde, imzala(hashLP(ETIKET.delege, govde), takmaSecret)])
}
function delegeCoz (bytes, pseudoPub) {
  const m = K.kanonik(K.DELEGE.tam, bytes, 'DELEGATION_CORRUPT')
  if (!dogrula(m.sig, hashLP(ETIKET.delege, bytes.subarray(0, bytes.byteLength - 64)), pseudoPub)) fail('INVALID_SIGNATURE')
  return m
}

/**
 * Hizmet tarafında açma ve denetim (§7.2 "Hizmetin denetimi"; kural paketinde §9.2'deki zincirin imza kısmı):
 * ct çözülür; imza doğrulanır; body.serviceId hizmetin kendisi; useUntil ≥ issuedAt. Biri tutmazsa hata kodu (hizmet
 * gönderene `ret` cevabı yazar). encSecret: tek anahtar ya da keyVersion → gizli anahtar işlevi (eski sürümle
 * şifrelenmiş, teslim bekleyen paketler için).
 * Dönüş { paket, govde, body } — kuralın günlük sınırı ve aynı shareId'deki takma ad tutarlılığı hizmetin kaydıyla
 * denetlenir (bu paketin dışında).
 */
function paketAc (bytes, { kart, encSecret }) {
  const p = paketCoz(bytes)
  if (p.v !== 1 || !b4a.equals(p.serviceId, kart.serviceId)) fail('SERVICE_MISMATCH')
  const sk = typeof encSecret === 'function' ? encSecret(p.keyVersion) : (p.keyVersion === kart.keyVersion ? encSecret : null)
  if (!sk) fail('NO_KEY_VERSION')
  const pub = b4a.alloc(32)
  sodium.crypto_scalarmult_base(pub, sk)
  const k = anahtar(x25519(sk, p.ephPub), p.ephPub, pub)
  if (p.ct.byteLength < ABYTES) fail('PACKAGE_OPEN_FAILED')
  const ic = b4a.alloc(p.ct.byteLength - ABYTES)
  try { sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(ic, null, p.ct, adOf(p), p.nonce, k) } catch { fail('PACKAGE_OPEN_FAILED') } finally { sodium.sodium_memzero(k) }
  const { body, sig } = K.kanonik(K.PAKET_IC, ic, 'PACKAGE_CORRUPT')
  const g = govdeCoz(body)
  if (!b4a.equals(g.serviceId, kart.serviceId)) fail('SERVICE_MISMATCH')
  let imzalayan = g.sender.pseudoPub
  if (g.kind === 'kural') {
    const d = delegeCoz(g.ruleProof.delegation, g.sender.pseudoPub)
    if (!b4a.equals(d.ruleHash, ruleHash(g.ruleProof.rule)) || !b4a.equals(d.serviceId, kart.serviceId)) fail('INVALID_SIGNATURE')
    imzalayan = d.delegatePub
  }
  if (!dogrula(sig, pkgOzeti(g.serviceId, body), imzalayan)) fail('INVALID_SIGNATURE')
  return { paket: p, govde: g, body }
}

module.exports = {
  TURLER, alanlarKodla, alanlarCoz, takmaAd, sifreCifti, govdeKodla, govdeCoz, payloadHash, ctHash, sahipOzeti, boyutDenetle, icImzala,
  paketKur, paketCoz, paketAc, kuralKodla, ruleHash, delegeImzala, delegeCoz, adOf, x25519
}
