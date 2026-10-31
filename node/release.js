// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// release.js — sürüm bildirimi, kök durumu ve döndürülmesi, sürüm kararı, UPDATE_APPROVE (RFC-0007 §12.1–12.4)
//
// Topluluğa bağlı olmayan imzalar familyId içermez: sig = Ed25519(kök, hash('<etiket>', body)). Kök anahtarın gizli
// yarısı hiçbir zaman bu makinede ya da düğümde değildir; burada yalnız doğrulama vardır (vektör üreticisi test
// anahtarıyla imzalar).
const c = require('compact-encoding')
const b4a = require('b4a')
const sodium = require('sodium-native')
const { kdf: { hash, PREFIX } } = require('@havenfold/core')
const { struct, secimli } = require('./health')

function fail (code) { throw new Error(code) }
const hex = (b) => b4a.toString(b, 'hex')

// --- Sürüm kodu (§3) ---------------------------------------------------------------------------------------------

function versionCode (s) {
  const m = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(s)
  if (!m) fail('INVALID_VERSION')
  const [a, b, d] = m.slice(1).map(Number)
  if (b >= 1000 || d >= 1000 || !Number.isSafeInteger(a * 1_000_000)) fail('INVALID_VERSION')
  return a * 1_000_000 + b * 1000 + d
}

// --- RELEASE_MANIFEST (§12.1) ------------------------------------------------------------------------------------

const urls = c.array(c.string)
const dosya = struct([['name', c.string], ['size', c.uint], ['digest', c.fixed32], ['urls', urls]])
const paket = struct([['os', c.string], ['arch', c.string], ['name', c.string], ['size', c.uint], ['digest', c.fixed32], ['urls', urls]])
const kaynakArsivi = struct([['name', c.string], ['digest', c.fixed32], ['urls', urls]])
const politika = struct([['ekip', c.bool], ['kisiOlcer', c.bool], ['yuz', c.bool], ['plaka', c.bool]])
const imaj = struct([['type', c.string], ['version', c.string], ['arch', c.string], ['ociDigest', c.string], ['archive', dosya], ['sourceArchive', secimli(kaynakArsivi)], ['ramMB', c.uint], ['policy', politika]])
const kurulum = struct([['arch', c.string], ['name', c.string], ['size', c.uint], ['sha256', c.fixed32], ['urls', urls]])
const deb = struct([['name', c.string], ['version', c.string], ['digest', c.fixed32]])
const seckiAnahtari = struct([['pub', c.fixed32], ['validUntil', c.uint]])

const manifestGovde = struct([
  ['format', c.uint], ['product', c.string], ['version', c.string], ['versionCode', c.uint], ['channel', c.string],
  ['publishedAt', c.uint], ['minFrom', c.uint], ['urgent', c.bool], ['packages', c.array(paket)], ['images', c.array(imaj)],
  ['assets', c.array(dosya)], ['installer', c.array(kurulum)], ['installerDebs', c.array(deb)], ['revoked', c.array(c.uint)],
  ['catalogKeys', c.array(seckiAnahtari)], ['keyEpoch', c.uint], ['nextRootHash', c.fixed32], ['notes', c.string]
])
const KANALLAR = ['kararli', 'deneme']

const imzala = (etiket, body, gizli) => { const sig = b4a.alloc(64); sodium.crypto_sign_detached(sig, hash(etiket, body), gizli); return sig }
const dogru = (etiket, body, sig, pub) => sodium.crypto_sign_verify_detached(sig, hash(etiket, body), pub)

function kanonik (enc, buf, code) {
  let m
  try { m = c.decode(enc, buf) } catch { fail(code) }
  if (!b4a.equals(c.encode(enc, m), buf)) fail(code)
  return m
}

const bildirimOzeti = (body) => hash('hf/release/', body)

// Yalnız vektör üreticisi ve testler: test kök anahtarıyla imzalı bildirim
function bildirimYaz (m, kokGizli) {
  const body = c.encode(manifestGovde, m)
  return b4a.concat([body, imzala('hf/release/', body, kokGizli)])
}

// §12.1 doğrulama sırası 1–4 (biçim, kök dönemi, imza, taahhüt). Dönüş: { m, body, ozet }
function bildirimCoz (bytes, kok) {
  if (!b4a.isBuffer(bytes) || bytes.byteLength < 65) fail('FORMAT_ERROR')
  const body = bytes.subarray(0, bytes.byteLength - 64)
  const sig = bytes.subarray(bytes.byteLength - 64)
  const m = kanonik(manifestGovde, body, 'FORMAT_ERROR')
  if (m.format !== 1 || !KANALLAR.includes(m.channel) || b4a.byteLength(m.notes) > 4096) fail('FORMAT_ERROR')
  if (versionCode(m.version) !== m.versionCode) fail('FORMAT_ERROR')
  if (m.keyEpoch !== kok.keyEpoch) fail('ROOT_EPOCH_ERROR') // büyükse önce kök döndürme zinciri istenir
  if (!dogru('hf/release/', body, sig, kok.rootPub)) fail('SIGNATURE_ERROR')
  if (!b4a.equals(m.nextRootHash, kok.nextRootHash)) fail('COMMITMENT_ERROR')
  return { m, body, ozet: bildirimOzeti(body) }
}

// §12.1 madde 9: dosya özeti. Akışla: dosyaOzeti() → { guncelle(parca), bitir() }
function dosyaOzeti () {
  const st = b4a.alloc(sodium.crypto_generichash_STATEBYTES)
  sodium.crypto_generichash_init(st, null, 32)
  sodium.crypto_generichash_update(st, b4a.from(PREFIX + 'hf/release-pkg/'))
  return {
    guncelle (p) { sodium.crypto_generichash_update(st, p) },
    bitir () { const out = b4a.alloc(32); sodium.crypto_generichash_final(st, out); return out }
  }
}
const paketOzeti = (bytes) => hash('hf/release-pkg/', bytes)

// Listedeki boyut ve özetle karşılaştırır: girdi { size, digest }, dosya { ozet, boyut } (akışla hesaplanmış)
function dosyaDenetle (girdi, { ozet, boyut }) {
  if (boyut !== girdi.size || !b4a.isBuffer(ozet) || !b4a.equals(ozet, girdi.digest)) fail('DIGEST_MISMATCH')
}

// --- Kök durumu ve döndürme (§12.2) ------------------------------------------------------------------------------

const kokDurumuEnc = struct([['keyEpoch', c.uint], ['rootPub', c.fixed32], ['nextRootHash', c.fixed32]])
const rootHash = (pub) => hash('hf/release-root/', pub)
const rotasyonGovde = struct([['keyEpoch', c.uint], ['newRoot', c.fixed32], ['newNextRootHash', c.fixed32], ['reason', c.string], ['publishedAt', c.uint]])
const NEDENLER = ['planli', 'calinti', 'kayip']

function rotasyonYaz (m, yeniGizli) {
  const body = c.encode(rotasyonGovde, m)
  return b4a.concat([body, imzala('hf/root-rotation/', body, yeniGizli)])
}

// Kabul edilince yeni kök durumu döner. Eski kökün imzası istenmez (kaybolmuş olabilir).
function rotasyonUygula (kok, bytes) {
  if (!b4a.isBuffer(bytes) || bytes.byteLength < 65) fail('FORMAT_ERROR')
  const body = bytes.subarray(0, bytes.byteLength - 64)
  const sig = bytes.subarray(bytes.byteLength - 64)
  const m = kanonik(rotasyonGovde, body, 'FORMAT_ERROR')
  if (!NEDENLER.includes(m.reason)) fail('FORMAT_ERROR')
  if (m.keyEpoch !== kok.keyEpoch + 1) fail('ROOT_EPOCH_ERROR')
  if (!b4a.equals(rootHash(m.newRoot), kok.nextRootHash)) fail('COMMITMENT_ERROR')
  if (!dogru('hf/root-rotation/', body, sig, m.newRoot)) fail('SIGNATURE_ERROR')
  return { keyEpoch: m.keyEpoch, rootPub: b4a.from(m.newRoot), nextRootHash: b4a.from(m.newNextRootHash) }
}

// kok-zinciri.bin: art arda döndürmeler (her biri u32be uzunluk önekli); geride kalan düğüm baştan uygular
function zinciriUygula (kok, kayitlar) {
  let k = kok
  for (const r of kayitlar) {
    if (!b4a.isBuffer(r) || r.byteLength < 65) fail('FORMAT_ERROR')
    const m = kanonik(rotasyonGovde, r.subarray(0, r.byteLength - 64), 'FORMAT_ERROR')
    if (m.keyEpoch <= k.keyEpoch) continue
    k = rotasyonUygula(k, r)
  }
  return k
}

// --- surum.durum ve sürüm kararı (§12.3) -------------------------------------------------------------------------

const urunDurumu = struct([['product', c.string], ['kurulu', c.uint], ['enYuksek', c.uint], ['onceki', c.uint], ['bozuk', c.array(c.uint)], ['channel', c.string]])
const surumDurumuEnc = struct([['urunler', c.array(urunDurumu)]])

// Dönüş: 'kur' | 'yok-say' | 'onay-gerekli' | 'ara-surum'. onay: gelen sürüme bağlı geçerli UPDATE_APPROVE { op: 'dusur' }
function surumKarari ({ kurulu, enYuksek, gelen, minFrom = 0, onay = false, bozuk = [] }) {
  if (bozuk.includes(gelen)) return 'yok-say' // bozuk işaretli sürüm yeniden denenmez
  if (gelen === kurulu) return 'yok-say'
  if (gelen < enYuksek || gelen < kurulu) return onay ? 'kur' : 'onay-gerekli' // düşürme yalnız ebeveyn onayıyla
  if (minFrom > kurulu) return 'ara-surum'
  return 'kur'
}

// Bildirimin tamamı (§12.1 5–8): ürün ve kanal bu düğümün değilse yok sayılır
function bildirimKarari (bytes, kok, durum, { urunler = ['havenfold-node'], onay = false, revoked = [] } = {}) {
  const { m, ozet } = bildirimCoz(bytes, kok)
  const u = durum.urunler.find((x) => x.product === m.product)
  if (!urunler.includes(m.product) || !u) return { karar: 'yok-say', neden: 'urun', m }
  if (m.channel !== u.channel) return { karar: 'yok-say', neden: 'kanal', m }
  // Kurulu sürüm geri çekildiyse güncelleme hemen yapılır
  const acil = m.urgent || m.revoked.includes(u.kurulu) || revoked.includes(u.kurulu)
  return { karar: surumKarari({ kurulu: u.kurulu, enYuksek: u.enYuksek, gelen: m.versionCode, minFrom: m.minFrom, onay, bozuk: u.bozuk }), acil, m, ozet }
}

// --- UPDATE_APPROVE (0xDC, §12.4) --------------------------------------------------------------------------------

const onayGovde = struct([
  ['nodeId', c.fixed16], ['op', c.string], ['product', c.string], ['toVersionCode', c.uint], ['manifestHash', c.fixed32],
  ['channel', c.string], ['expiresAt', c.uint], ['ledgerSeq', c.uint], ['signerId', c.fixed16]
])
const approvalSummary = (familyId, body) => hash('hf/update-approve/', familyId, body)
const ONAY_MS = 24 * 3_600_000

function onayYaz (familyId, imzaci, m) {
  const body = c.encode(onayGovde, { ...m, signerId: imzaci.memberId })
  const sig = b4a.alloc(64)
  sodium.crypto_sign_detached(sig, approvalSummary(familyId, body), imzaci.signKeyPair.secretKey)
  return b4a.concat([body, sig])
}

// Ebeveyn: ailede 'ebeveyn', ekipte 'sahip' (RFC-0005 yönetim karşılığı)
const ebeveynMi = (L, id) => { const u = L.members.get(id); return !!u && u.active && !L.isPending(id) && u.role === (L.kind === 'ekip' ? 'sahip' : 'ebeveyn') }

// L: düğümün defter kopyası; me: kendi kimliği (hex); gorulen: Map<özetHex, expiresAt> (kalıcı); kok: hedef
// bildirimi doğrulamak için; hedef: dusur'da hedef bildirimin baytları
function onayDenetle (L, bytes, { me, simdi = Date.now(), gorulen, kok = null, hedef = null }) {
  if (!b4a.isBuffer(bytes) || bytes.byteLength < 65) fail('FORMAT_ERROR')
  const body = bytes.subarray(0, bytes.byteLength - 64)
  const sig = bytes.subarray(bytes.byteLength - 64)
  const m = kanonik(onayGovde, body, 'FORMAT_ERROR')
  if (!['dusur', 'kanal'].includes(m.op)) fail('FORMAT_ERROR')
  if (m.op === 'kanal' && (!KANALLAR.includes(m.channel) || m.toVersionCode !== 0 || !m.manifestHash.every((x) => x === 0))) fail('FORMAT_ERROR')
  if (m.op === 'dusur' && m.channel !== '') fail('FORMAT_ERROR')
  if (hex(m.nodeId) !== me) fail('WRONG_NODE') // 1
  const sid = hex(m.signerId)
  // Ucuz denetimler önce: bugünkü ebeveyn ve imza; geçmiş defter (pastCursor) en son kurulur (inceleme 11 şüpheli 2)
  if (!ebeveynMi(L, sid) || m.ledgerSeq >= L.len) fail('UNAUTHORIZED') // 2
  if (!sodium.crypto_sign_verify_detached(sig, approvalSummary(L.familyId, body), L.members.get(sid).signPub)) fail('INVALID_SIGNATURE') // 3
  if (!ebeveynMi(L.pastCursor().at(m.ledgerSeq + 1), sid)) fail('UNAUTHORIZED') // 2: imza anında da ebeveyndi
  if (!(m.expiresAt > simdi && m.expiresAt <= simdi + ONAY_MS)) fail('INVALID_DURATION') // 4
  if (m.op === 'dusur') { // 5
    if (!hedef || !kok) fail('MANIFEST_ERROR')
    let h
    try { h = bildirimCoz(hedef, kok) } catch { fail('MANIFEST_ERROR') }
    if (!b4a.equals(h.ozet, m.manifestHash) || h.m.versionCode !== m.toVersionCode || h.m.product !== m.product) fail('MANIFEST_ERROR')
  }
  const k = hex(hash('hf/update-approve/', L.familyId, body)) // 6: aynı onay ikinci kez kullanılmaz
  for (const [x, t] of gorulen) if (t <= simdi) gorulen.delete(x)
  if (gorulen.has(k)) fail('REPLAY')
  gorulen.set(k, m.expiresAt)
  return m
}

module.exports = {
  KANALLAR,
  versionCode,
  manifestGovde,
  bildirimYaz,
  bildirimCoz,
  bildirimOzeti,
  bildirimKarari,
  dosyaOzeti,
  paketOzeti,
  dosyaDenetle,
  kokDurumuEnc,
  rootHash,
  rotasyonGovde,
  rotasyonYaz,
  rotasyonUygula,
  zinciriUygula,
  surumDurumuEnc,
  surumKarari,
  onayGovde,
  onayYaz,
  onayDenetle,
  ONAY_MS
}
