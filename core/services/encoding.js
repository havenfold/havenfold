// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// encoding.js — RFC-0010 tel biçimleri (§4.1, §5.1, §7.1, §7.2, §9.1) ve sabitler (§16)
//
// Kodlama RFC-0001 §3'teki gibidir: compact-encoding, en kısa c.uint, seçimli alanda varlık bayrağı (c.bool), imza
// gönderilen baytlar üzerinden. Çözme kanoniktir: yeniden kodlanınca aynı baytlar (RFC-0019 §11.3 d).
//
// Türetme: RFC-0010 formülleri `hash`/`derive` yazar; etiketler RFC-0027 §8 b'den sonra koda girdiği için uzunluk
// önekli biçimle (hashLP/deriveLP) üretilir (D83'teki afet kararıyla aynı). Etiketlerin listesi ETIKET'te.
const c = require('compact-encoding')
const b4a = require('b4a')

const GUN_MS = 86_400_000
const MB = 1024 * 1024

const KATEGORILER = ['veteriner', 'bakim', 'saglik', 'guvenlik', 'usta', 'tedarikci', 'cagri', 'destek']
const KURAL_KATEGORILERI = ['guvenlik', 'bakim', 'cagri'] // §9.1
const OZEL_NITELIKLI = ['saglik', 'bakim'] // §14: onay ekranında açık rıza metni

// §16 Sınırlar
const SINIR = {
  paketMB: 25,
  oge: 64,
  dosya: 8,
  baslik: 120,
  not: 2048,
  etiket: 64,
  kullanimGun: 365,
  teslimGun: 7,
  onayGun: { tek: 7, gizli: 7, kural: 30 }, // §6.1 yazan tarafın sınırları
  kuralPaketGun: 50,
  kuralKullanimGun: 90,
  dizinGun: 14,
  cevap: 16, // hizmet bir pakete en çok 16 cevap (§8.3)
  cevapMetin: 4096,
  cevapDosya: 4,
  cevapMB: 10,
  cevapGun: 30, // alıcı cevapları useUntil ya da 30 gün sonra siler (§13.1)
  saatPayi: 5 * 60_000, // x-hf-auth ±5 dakika
  nonceSure: 10 * 60_000 // aynı nonce 10 dakika içinde ikinci kez kabul edilmez
}
const CEVAP_TURLERI = ['makbuz', 'ret', 'mesaj', 'belge', 'silindi']

const ETIKET = {
  serviceId: 'hf/service-id/',
  kart: 'hf/service-card/',
  qr: 'hf/service-card-qr/',
  dizin: 'hf/service-dir/',
  svc: 'hf/share-svc/',
  payload: 'hf/share-payload/',
  pkg: 'hf/share-pkg/',
  dh: 'hf/share-dh/',
  key: 'hf/share-key/',
  ad: 'hf/share-ad/',
  ct: 'hf/share-ct/',
  owner: 'hf/share-owner/',
  kural: 'hf/share-rule/',
  delege: 'hf/share-deleg/',
  inbox: 'hf/share-inbox/',
  onizleme: 'hf/share-preview/',
  cevapDh: 'hf/share-reply-dh/',
  cevapKey: 'hf/share-reply-key/',
  cevapAd: 'hf/share-reply-ad/',
  cevap: 'hf/share-reply/'
}

// Seçimli alan: varlık bayrağı (bool), sonra değer
function optional (enc) {
  return {
    preencode (s, v) { c.bool.preencode(s, v != null); if (v != null) enc.preencode(s, v) },
    encode (s, v) { c.bool.encode(s, v != null); if (v != null) enc.encode(s, v) },
    decode (s) { return c.bool.decode(s) ? enc.decode(s) : null }
  }
}
function struct (alanlar) {
  return {
    preencode (s, m) { for (const [k, e] of alanlar) e.preencode(s, m[k]) },
    encode (s, m) { for (const [k, e] of alanlar) e.encode(s, m[k]) },
    decode (s) { const m = {}; for (const [k, e] of alanlar) m[k] = e.decode(s); return m }
  }
}
// İmzalı yapı: imzasız kısım ve sonunda 64 baytlık imza
function imzali (alanlar) {
  const govde = struct(alanlar)
  return { govde, tam: struct([...alanlar, ['sig', c.fixed64]]) }
}

const fixed24 = c.fixed(24)

const KART = imzali([
  ['serviceId', c.fixed16], ['signPub', c.fixed32], ['encPub', c.fixed32], ['keyVersion', c.uint],
  ['name', c.string], ['category', c.string], ['region', c.string], ['contact', c.string], ['endpoint', c.string],
  ['accepts', c.array(c.string)], ['kural', c.bool], ['maxMB', c.uint], ['keepDays', c.uint], ['issuedAt', c.uint]
])
const DIZIN = imzali([
  ['version', c.uint], ['region', c.string], ['issuedAt', c.uint], ['validUntil', c.uint],
  ['cards', c.array(c.buffer)], ['revoked', c.array(c.fixed16)]
])

const ogeEnc = struct([['type', c.string], ['fields', c.buffer]])
const dosyaEnc = struct([['blobId', c.fixed32], ['fileKey', c.fixed32], ['size', c.uint], ['mime', c.string], ['name', c.string]])
const GOVDE = struct([
  ['v', c.uint], ['serviceId', c.fixed16], ['shareId', c.fixed16], ['seqNo', c.uint], ['kind', c.string],
  ['category', c.string], ['title', c.string], ['note', c.string], ['items', c.array(ogeEnc)], ['files', c.array(dosyaEnc)],
  ['issuedAt', c.uint], ['useUntil', c.uint], ['replyPub', c.fixed32],
  ['sender', struct([['pseudoPub', c.fixed32], ['label', c.string]])],
  ['ruleProof', optional(struct([['rule', c.buffer], ['delegation', c.buffer]]))],
  ['ref', optional(c.fixed16)]
])
const PAKET_IC = struct([['body', c.buffer], ['sig', c.fixed64]])
const PAKET = struct([
  ['v', c.uint], ['serviceId', c.fixed16], ['packageId', c.fixed16], ['keyVersion', c.uint], ['ephPub', c.fixed32],
  ['nonce', fixed24], ['expiresAt', c.uint], ['ct', c.buffer]
])
const KURAL = struct([
  ['ruleId', c.fixed16], ['serviceId', c.fixed16], ['category', c.string], ['triggers', c.array(c.string)],
  ['placeId', c.fixed16], ['include', c.array(c.string)], ['maxPerDay', c.uint], ['useDays', c.uint], ['expiresAt', c.uint]
])
// §8.3 cevap: dış kabuk ve imzalı iç
const CEVAP = struct([['packageId', c.fixed16], ['n', c.uint], ['ephPub', c.fixed32], ['nonce', fixed24], ['ct', c.buffer]])
const CEVAP_IC = imzali([['kind', c.string], ['text', c.string], ['files', c.array(dosyaEnc)], ['at', c.uint]])
// §8.1 SHARE_PREVIEW (0xD0): başlatan → imzacı
const ONIZLEME = imzali([
  ['familyId', c.fixed32], ['shareId', c.fixed16], ['card', c.buffer], ['body', c.buffer],
  ['sources', c.array(struct([['collectionId', c.fixed16], ['recordIds', c.array(c.fixed16)]]))], ['fromId', c.fixed16]
])
const DELEGE = imzali([['ruleHash', c.fixed32], ['serviceId', c.fixed16], ['delegatePub', c.fixed32], ['expiresAt', c.uint]])

function kanonik (enc, buf, kod) {
  if (!b4a.isBuffer(buf)) throw new Error(kod)
  let m
  try { m = c.decode(enc, buf) } catch { throw new Error(kod) }
  let tekrar
  try { tekrar = c.encode(enc, m) } catch { throw new Error(kod) }
  if (!b4a.equals(tekrar, buf)) throw new Error(kod)
  return m
}

function kodla (enc, m, kod) {
  try { return c.encode(enc, m) } catch { throw new Error(kod) }
}

// RFC 4648 base32: büyük harf, dolgusuz (§5.2). Çözme kanonik: artık bitler sıfır, başka harf yok.
const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
function b32 (buf) {
  let out = ''
  let bit = 0
  let deger = 0
  for (const x of buf) {
    deger = (deger << 8) | x
    bit += 8
    while (bit >= 5) { out += ABC[(deger >>> (bit - 5)) & 31]; bit -= 5 }
    deger &= (1 << bit) - 1
  }
  if (bit) out += ABC[(deger << (5 - bit)) & 31]
  return out
}
function b32Coz (s, kod) {
  if (typeof s !== 'string' || [1, 3, 6].includes(s.length % 8)) throw new Error(kod)
  const out = b4a.alloc(Math.floor(s.length * 5 / 8))
  let bit = 0
  let deger = 0
  let i = 0
  for (const ch of s) {
    const v = ABC.indexOf(ch)
    if (v < 0) throw new Error(kod)
    deger = (deger << 5) | v
    bit += 5
    if (bit >= 8) { out[i++] = (deger >>> (bit - 8)) & 255; bit -= 8 }
    deger &= (1 << bit) - 1
  }
  if (deger !== 0) throw new Error(kod)
  return out
}

const hex = (b) => b4a.toString(b, 'hex')
const bayt = (s) => (typeof s === 'string' ? b4a.byteLength(s) : Infinity)
const sifirMi = (b) => b.every((x) => x === 0)

module.exports = {
  GUN_MS, MB, KATEGORILER, KURAL_KATEGORILERI, OZEL_NITELIKLI, SINIR, ETIKET, CEVAP_TURLERI,
  KART, DIZIN, GOVDE, PAKET_IC, PAKET, KURAL, DELEGE, CEVAP, CEVAP_IC, ONIZLEME, dosyaEnc,
  optional, struct, kanonik, kodla, b32, b32Coz, hex, bayt, sifirMi
}
