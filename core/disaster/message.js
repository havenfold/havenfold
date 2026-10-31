// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// message.js — afet zarfları (RFC-0012 §6.2, §6.5, §7, §8.2): kodlama, mühür ve açma, konum yuvarlama, alan sınırları
//
//   AFET_MSG (0xB0)  { mid, toTag, prio, hops, expiresDay, doneHash, nonce, ct }
//   AD  = hashLP('hf/afet-ad/', mid, toTag, u64be(prio), u64be(expiresDay), doneHash)
//   ct  = XChaCha20-Poly1305(afetKey, nonce, encode(AfetInner), AD)
// `hops` AD'ye girmez: taşıyıcılar azaltır. Çözme kanoniktir: yeniden kodlanınca aynı baytlar (RFC-0019 §11.3 d).
const c = require('compact-encoding')
const b4a = require('b4a')
const sodium = require('sodium-native')
const { kdf: { hashLP } } = require('@havenfold/core')
const T = require('./derivation')

const Z = { AFET_MSG: 0xb0, AFET_HAVE: 0xb1, AFET_WANT: 0xb2, AFET_DONE: 0xb3, AFET_TAGS: 0xb4, AFET_LINK_UP: 0xb5 }
const KIND = { METIN: 1, IYIYIM: 2, SOS: 3, UYARI: 4, ALINDI: 5 }
const PRIO = { [KIND.SOS]: 0, [KIND.UYARI]: 1, [KIND.IYIYIM]: 2, [KIND.METIN]: 3, [KIND.ALINDI]: 4 }

// §7.1, §9.2
const SINIR = {
  metin: { [KIND.METIN]: 256, [KIND.IYIYIM]: 64, [KIND.SOS]: 64, [KIND.UYARI]: 64, [KIND.ALINDI]: 0 },
  ct: 420,
  zarf: 600,
  hops: 4,
  sure: 3, // expiresDay ≤ gün + 3
  have: 64,
  // WANT bir HAVE'e cevaptır (en çok have kadar mid); DONE oturum başında bütün teslim bilgisini taşır (depo en çok 1000
  // mesaj, teslim 7 gün). Bağ katmanı her çerçeveyi cerceve baytında keser (local.js BagOturumu._al)
  want: 64,
  done: 4096,
  cerceve: 256 * 1024,
  etiket: 25
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
const fixed4 = c.fixed(4)
const fixed8 = c.fixed(8)

const konumEnc = struct([['latE5', c.int], ['lonE5', c.int], ['accM', c.uint], ['at', c.uint]])
const alarmEnc = struct([['kind', c.string], ['level', c.uint], ['nearby', c.array(c.fixed16)]])
const icEnc = struct([
  ['kind', c.uint], ['from', c.fixed16], ['to', c.fixed16], ['at', c.uint], ['text', c.string],
  ['konum', optional(konumEnc)], ['ref', optional(c.fixed16)], ['alarm', optional(alarmEnc)], ['battery', optional(c.uint)]
])
const msgEnc = struct([
  ['mid', c.fixed16], ['toTag', fixed8], ['prio', c.uint], ['hops', c.uint], ['expiresDay', c.uint], ['doneHash', c.fixed16],
  ['nonce', c.fixed(24)], ['ct', c.buffer]
])
const haveEnc = struct([['items', c.array(struct([['mid', c.fixed16], ['toTag', fixed8], ['prio', c.uint], ['hops', c.uint]]))]])
const wantEnc = struct([['mids', c.array(c.fixed16)]])
const doneEnc = struct([['items', c.array(struct([['mid', c.fixed16], ['doneSecret', c.fixed32]]))]])
const tagsEnc = struct([['v', c.uint], ['slot', c.uint], ['tags', c.array(fixed4)]])
const linkEnc = struct([['kind', c.uint], ['name', c.string], ['pass', c.string], ['port', c.uint]])
const ENC = { [Z.AFET_MSG]: msgEnc, [Z.AFET_HAVE]: haveEnc, [Z.AFET_WANT]: wantEnc, [Z.AFET_DONE]: doneEnc, [Z.AFET_TAGS]: tagsEnc, [Z.AFET_LINK_UP]: linkEnc }

function kanonik (enc, buf, kod) {
  let m
  try { m = c.decode(enc, buf) } catch { throw new Error(kod) }
  let tekrar
  try { tekrar = c.encode(enc, m) } catch { throw new Error(kod) }
  if (!b4a.equals(tekrar, buf)) throw new Error(kod)
  return m
}

/** Zarf gövdesi (tür baytı ayrı); sınırlar ve kanonik çözme */
function kodla (tur, m) {
  const enc = ENC[tur]
  if (!enc) throw new Error('INVALID_DISASTER_TYPE')
  const b = c.encode(enc, m)
  if (tur === Z.AFET_MSG && b.byteLength > SINIR.zarf) throw new Error('DISASTER_LENGTH')
  return b
}
function coz (tur, buf) {
  const enc = ENC[tur]
  if (!enc) throw new Error('INVALID_DISASTER_TYPE')
  if (tur === Z.AFET_MSG && buf.byteLength > SINIR.zarf) throw new Error('DISASTER_LENGTH') // §9.2: büyükse oturum kapanır
  const m = kanonik(enc, buf, 'DISASTER_CORRUPT')
  if (tur === Z.AFET_HAVE && m.items.length > SINIR.have) throw new Error('DISASTER_CORRUPT')
  if (tur === Z.AFET_WANT && m.mids.length > SINIR.want) throw new Error('DISASTER_CORRUPT')
  if (tur === Z.AFET_DONE && m.items.length > SINIR.done) throw new Error('DISASTER_CORRUPT')
  if (tur === Z.AFET_TAGS && (m.v !== 1 || m.tags.length !== SINIR.etiket)) throw new Error('DISASTER_CORRUPT')
  return m
}

const ad = (m) => hashLP('hf/afet-ad/', m.mid, m.toTag, m.prio, m.expiresDay, m.doneHash)

/** §7.3 (açıklama 1 madde 3): SOS yuvarlanmaz; İYİYİM ve METİN 1000'in katına (0,01°, ~1,1 km), "tam konum"da yuvarlanmaz */
function konumYuvarla (kind, konum, tam = false) {
  if (!konum) return null
  if (kind === KIND.SOS || tam) return { ...konum }
  const y = (v) => Math.round(v / 1000) * 1000
  return { ...konum, latE5: y(konum.latE5), lonE5: y(konum.lonE5) }
}

const bayt = (s) => b4a.byteLength(s, 'utf8')

/** §7.1, §7.4 madde 7: alanlar sınırlar içinde ve türe uygun mu; değilse hata kodu */
function icGecerli (ic) {
  if (!Object.values(KIND).includes(ic.kind)) return 'INVALID_DISASTER_FIELD_KIND'
  if (bayt(ic.text) > SINIR.metin[ic.kind]) return 'INVALID_DISASTER_TEXT'
  if (ic.kind === KIND.METIN && !ic.text) return 'INVALID_DISASTER_TEXT'
  if ((ic.kind === KIND.ALINDI) !== (ic.ref != null)) return 'INVALID_DISASTER_REF'
  if ((ic.alarm != null) !== (ic.kind === KIND.UYARI)) return 'DISASTER_FIELD_ALARM' // alarm yalnız UYARI'da, UYARI'da zorunlu
  if (ic.alarm && !['deprem', 'elektrik'].includes(ic.alarm.kind)) return 'DISASTER_FIELD_ALARM'
  if ((ic.kind === KIND.UYARI || ic.kind === KIND.ALINDI) && ic.konum) return 'INVALID_DISASTER_LOCATION'
  if (ic.konum) {
    const k = ic.konum
    if (Math.abs(k.latE5) > 90_00000 || Math.abs(k.lonE5) > 180_00000) return 'INVALID_DISASTER_LOCATION'
  }
  if (ic.battery != null && ic.battery > 100) return 'INVALID_DISASTER_BATTERY'
  return null
}

/**
 * Mühürle (§7.2). o: { pair, from, to, kind, text?, konum?, tam?, ref?, alarm?, battery?, at, gun, hops?, expiresDay?, mid?, nonce? }
 * mid ve nonce yalnız vektörlerde verilir. Dönüş: { msg, bytes, doneSecret }
 */
// AFET_LINK_UP teklifinin alanları (RFC-0012 §6.5): kind 0 Wi-Fi Direct (grup adı 1–32 bayt SSID, parola 8–63 bayt WPA,
// port 1–65535), kind 1 Multipeer (hizmet adı `hf-afet`, parola boş, port 0). Geçersizse hata kodu, geçerliyse null.
// Platforma yalnız geçerli teklif verilir (Codex 7. tur)
function linkHatasi (t) {
  if (!t || typeof t.name !== 'string' || typeof t.pass !== 'string' || !Number.isSafeInteger(t.port)) return 'INVALID_DISASTER_LINK'
  if (t.kind === 0) {
    if (bayt(t.name) < 1 || bayt(t.name) > 32 || bayt(t.pass) < 8 || bayt(t.pass) > 63 || t.port < 1 || t.port > 65535) return 'INVALID_DISASTER_LINK'
    return null
  }
  if (t.kind === 1) return t.name === 'hf-afet' && t.pass === '' && t.port === 0 ? null : 'INVALID_DISASTER_LINK'
  return 'INVALID_DISASTER_LINK'
}

function muhurle (o) {
  const key = T.afetKey(o.pair)
  const ic = { kind: o.kind, from: o.from, to: o.to, at: o.at, text: o.text ?? '', konum: konumYuvarla(o.kind, o.konum, o.tam), ref: o.ref ?? null, alarm: o.alarm ?? null, battery: o.battery ?? null }
  const hata = icGecerli(ic)
  if (hata) throw new Error(hata)
  const hops = o.hops ?? SINIR.hops
  const expiresDay = o.expiresDay ?? o.gun + SINIR.sure
  if (hops > SINIR.hops || expiresDay > o.gun + SINIR.sure) throw new Error('DISASTER_LIMIT')
  const mid = o.mid ?? rastgele(16)
  const nonce = o.nonce ?? rastgele(24)
  const ds = T.doneSecret(key, mid)
  const m = { mid, toTag: T.toTag(key, o.to, o.gun), prio: PRIO[o.kind], hops, expiresDay, doneHash: T.doneHash(ds), nonce, ct: null }
  const duz = c.encode(icEnc, ic)
  const ct = b4a.alloc(duz.byteLength + sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES)
  sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(ct, duz, ad(m), null, nonce, key)
  if (ct.byteLength > SINIR.ct) throw new Error('DISASTER_LENGTH')
  m.ct = ct
  return { msg: m, bytes: kodla(Z.AFET_MSG, m), doneSecret: ds }
}

/** Aç: afetKey'le; açılmazsa null (yanlış çift ya da değiştirilmiş açık alan) */
function ac (m, pair) {
  const key = T.afetKey(pair)
  const ABYTES = sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES
  if (m.ct.byteLength < ABYTES || m.ct.byteLength > SINIR.ct) return null
  const duz = b4a.alloc(m.ct.byteLength - ABYTES)
  try {
    sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(duz, null, m.ct, ad(m), m.nonce, key)
  } catch { return null }
  try { return kanonik(icEnc, duz, 'DISASTER_CORRUPT') } catch { return null }
}

const icKodla = (ic) => c.encode(icEnc, ic)
const icCoz = (b) => c.decode(icEnc, b)

function rastgele (n) { const b = b4a.alloc(n); sodium.randombytes_buf(b); return b }

module.exports = { Z, KIND, PRIO, SINIR, kodla, coz, ad, konumYuvarla, icGecerli, linkHatasi, muhurle, ac, rastgele, icEnc, icKodla, icCoz }
