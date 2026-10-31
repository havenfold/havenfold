// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// share.js — KASA_SHARE, kimlikler, kâğıt pay, pay üretimi ve birleştirme (RFC-0004 §4.2–§4.4, §5.3)
//
//   YA secretId = hash('hf/kasa-ya-id/', familyId, rootId)[0..16];  KRA secretId = collectionId
//   commit      = hash('hf/kasa-commit/', secretId, u64be(version), sır)
//   kâğıt       = 'hfk1:' + base32(KASA_SHARE ‖ hash('hf/kasa-paper/', KASA_SHARE)[0..4])
// Shamir yalnız denetlenmiş shamir-secret-sharing kütüphanesiyle (H7); payın son baytı x koordinatıdır.
const c = require('compact-encoding')
const b4a = require('b4a')
const { kdf: { hash } } = require('@havenfold/core')
const { kodlama: { struct, decodeCanonical } } = require('@havenfold/records')
const sodium = require('sodium-native')
const { split, combine } = require('shamir-secret-sharing')
const { ozDenetim } = require('./random') // kaynak yaması

const hex = (b) => (typeof b === 'string' ? b : b4a.toString(b, 'hex'))
function fail (code) { throw new Error(code) }

const TUR = { YA: 0, KRA: 1 }
const SIR = 32

const kasaShare = struct([
  ['secretId', c.fixed16], ['kind', c.uint], ['version', c.uint], ['threshold', c.uint], ['total', c.uint],
  ['share', c.fixed(SIR + 1)], ['holderId', c.fixed16], ['commit', c.fixed32]
])

const yaSecretId = (familyId, rootId) => hash('hf/kasa-ya-id/', familyId, b4a.from(hex(rootId), 'hex')).subarray(0, 16)
const commitOf = (secretId, version, sir) => hash('hf/kasa-commit/', secretId, version, sir)

// Sırrın sahibinin cihaz değişimi zincirindeki ilk kimliği (rotatedFrom geriye izlenir)
function rootIdOf (L, memberId) {
  let k = hex(memberId)
  for (let i = 0; i <= L.members.size && L.members.get(k)?.rotatedFrom; i++) k = L.members.get(k).rotatedFrom
  return k
}

const encodeShare = (m) => c.encode(kasaShare, m)
function decodeShare (buf) {
  const m = decodeCanonical(kasaShare, buf, 'INVALID_SHARE')
  if (m.kind > 1 || m.threshold < 2 || m.total < m.threshold || m.total > 255) fail('INVALID_SHARE')
  if (m.share[SIR] === 0) fail('INVALID_SHARE') // x = 0 sırrın kendisidir (inceleme kasa 18)
  return m
}

// --- Kâğıt (§4.4) ---------------------------------------------------------------------------------------------

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
function base32 (buf) {
  let bits = 0
  let v = 0
  let out = ''
  for (const x of buf) {
    v = (v << 8) | x
    bits += 8
    while (bits >= 5) { out += B32[(v >>> (bits - 5)) & 31]; bits -= 5 }
  }
  if (bits) out += B32[(v << (5 - bits)) & 31]
  return out
}
function base32Coz (s) {
  let bits = 0
  let v = 0
  const out = []
  for (const ch of s) {
    const i = B32.indexOf(ch)
    if (i < 0) fail('INVALID_PAPER')
    v = (v << 5) | i
    bits += 5
    if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8 }
  }
  if (bits >= 5 || (v & ((1 << bits) - 1)) !== 0) fail('INVALID_PAPER') // dolgu bitleri sıfır, en kısa biçim
  return b4a.from(out)
}

function kagitKodla (pay) {
  const enc = encodeShare(pay)
  return 'hfk1:' + base32(b4a.concat([enc, hash('hf/kasa-paper/', enc).subarray(0, 4)]))
}

function kagitCoz (metin) {
  if (typeof metin !== 'string' || !metin.startsWith('hfk1:')) fail('INVALID_PAPER')
  const b = base32Coz(metin.slice(5).toUpperCase())
  if (b.byteLength < 5) fail('INVALID_PAPER')
  const enc = b.subarray(0, b.byteLength - 4)
  if (!b4a.equals(hash('hf/kasa-paper/', enc).subarray(0, 4), b.subarray(b.byteLength - 4))) fail('PAPER_CHECKSUM')
  return decodeShare(enc)
}

// --- Üretim ve birleştirme ---------------------------------------------------------------------------------------

// dagitim: esik.yaDagitim / kraDagitim sonucu ({ t, n, kurulur, neden, sahipler }); kurulamayan dağıtımda pay
// üretilmez (inceleme kasa 9). Dönüş: KASA_SHARE listesi (sahiplerle aynı sırada).
async function paylariUret (sir, { secretId, kind, version, dagitim }) {
  if (sir.byteLength !== SIR) fail('INVALID_SECRET')
  if (!dagitim || !dagitim.kurulur) fail((dagitim && dagitim.neden) || 'INVALID_THRESHOLD')
  const { t: threshold, sahipler } = dagitim
  if (sahipler.length !== dagitim.n || sahipler.length < threshold || threshold < 2) fail('INVALID_THRESHOLD')
  await ozDenetim()
  const kopya = new Uint8Array(sir)
  let shares
  try { shares = await split(kopya, sahipler.length, threshold) } finally { sodium.sodium_memzero(kopya) }
  const commit = commitOf(secretId, version, sir)
  const out = shares.map((share, i) => ({ secretId: b4a.from(secretId), kind, version, threshold, total: sahipler.length, share: b4a.from(share), holderId: b4a.from(sahipler[i].id, 'hex'), commit }))
  for (const x of shares) sodium.sodium_memzero(x)
  return out
}

function * secimler (n, k, bas = 0, sec = []) {
  if (sec.length === k) { yield sec; return }
  for (let i = bas; i <= n - (k - sec.length); i++) yield * secimler(n, k, i + 1, [...sec, i])
}

// §5.3 ve RFC-0021 c: yalnız beklenen (secretId, kind, version) payları kullanılır; sürüm dizinden (KASA_VERSION_RES)
// gelir. Her pay kâğıt payla aynı denetimden geçer; tutucu başına bir pay (DUPLICATE_HOLDER); eşik 2 ya da 3. Paylar
// commit'e göre gruplanır; her kombinasyonda x'ler farklıdır; kütüphane hatası kombinasyon başına yakalanır.
// Hatalar: VERSION_MISMATCH (beklenen sürümde pay yok), INSUFFICIENT_SHARE, SHARE_CORRUPT, DUPLICATE_HOLDER, INVALID_THRESHOLD
async function birlestir (paylar, { secretId, kind, version } = {}) {
  if (!secretId || kind === undefined || !Number.isSafeInteger(version)) fail('VERSION_REQUIRED')
  if (!paylar.length) fail('INSUFFICIENT_SHARE')
  const uygun = []
  let baskaSurum = false
  for (const p of paylar) {
    let d
    try { d = decodeShare(encodeShare(p)) } catch { continue } // biçimi bozuk pay yok sayılır
    if (!b4a.equals(d.secretId, secretId) || d.kind !== kind) continue
    if (d.version !== version) { baskaSurum = true; continue }
    if (d.threshold !== 2 && d.threshold !== 3) fail('INVALID_THRESHOLD')
    if (uygun.some((x) => b4a.equals(x.holderId, d.holderId) && !b4a.equals(x.share, d.share))) fail('DUPLICATE_HOLDER')
    if (!uygun.some((x) => b4a.equals(x.share, d.share))) uygun.push(d)
  }
  if (!uygun.length) fail(baskaSurum ? 'VERSION_MISMATCH' : 'INSUFFICIENT_SHARE')
  const gruplar = new Map()
  for (const p of uygun) {
    const k = [p.threshold, hex(p.commit)].join('|')
    if (!gruplar.has(k)) gruplar.set(k, [])
    gruplar.get(k).push(p)
  }
  let yeterli = false
  for (const g of [...gruplar.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, x]) => x)) {
    const p0 = g[0]
    const t = p0.threshold
    if (new Set(g.map((p) => p.share[SIR])).size < t) continue
    yeterli = true
    for (const s of secimler(g.length, t)) {
      if (new Set(s.map((i) => g[i].share[SIR])).size < t) continue
      let ham
      try { ham = await combine(s.map((i) => new Uint8Array(g[i].share))) } catch { continue }
      const sir = b4a.from(ham)
      sodium.sodium_memzero(ham) // kütüphanenin dizisi (inceleme 5 S10)
      if (b4a.equals(commitOf(p0.secretId, p0.version, sir), p0.commit)) return sir
      sodium.sodium_memzero(sir)
    }
  }
  fail(yeterli ? 'SHARE_CORRUPT' : 'INSUFFICIENT_SHARE')
}

module.exports = { TUR, SIR, kasaShare, yaSecretId, commitOf, rootIdOf, encodeShare, decodeShare, base32, base32Coz, kagitKodla, kagitCoz, paylariUret, birlestir }
