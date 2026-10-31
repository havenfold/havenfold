// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// request.js — pay isteme ve verme (RFC-0004 §5.1, §5.2)
//
//   KASA_VERSION_REQ (0x9E) { secretId }
//   KASA_VERSION_RES (0x9F) { secretId, version, threshold, total }
//   KASA_SHARE_REQ   (0x9B) { secretId, kind, version, requesterId, holderId, at, reason: 'restore' | 'rotate', sig }
//                            etiket 'hf/kasa-req/'; holderId istenen tutucu, at istek anı (RFC-0019 §11.4 a)
//   KASA_SHARE_RES   (0x9C) { share: KASA_SHARE }
// Mesajlar çift kanalında gider; emanet ya da Posta Kutusu yolunda RFC-0003 §6.4 mührüyle (0x9B–0x9F kapsamda).
const c = require('compact-encoding')
const b4a = require('b4a')
const sodium = require('sodium-native')
const { kdf: { hash }, ledger: { T }, encoding: { decodeBody } } = require('@havenfold/core')
const { kodlama: { struct, decodeCanonical }, yetki: { readerSet } } = require('@havenfold/records')
const { kasaShare, TUR, decodeShare, yaSecretId, encodeShare, rootIdOf } = require('./share')

const hex = (b) => (typeof b === 'string' ? b : b4a.toString(b, 'hex'))
function fail (code) { throw new Error(code) }

const Z = { KASA_SHARE_REQ: 0x9b, KASA_SHARE_RES: 0x9c, KASA_VERSION_REQ: 0x9e, KASA_VERSION_RES: 0x9f }
const BEKLEME_MS = 72 * 3_600_000
const TAZELIK_MS = 5 * 60_000 // istek en çok 5 dakika eski olabilir
const ILERI_MS = 2 * 60_000 // saat kayması toleransı
const GUN_MS = 86_400_000
const NEDEN = ['restore', 'rotate']
// Pay dizinindeki özet: payın kanonik baytlarının özeti (payı açığa çıkarmaz)
const payOzeti = (share) => hex(hash('hf/kasa/pay-dizini', encodeShare(share)))

const versionReq = struct([['secretId', c.fixed16]])
const versionRes = struct([['secretId', c.fixed16], ['version', c.uint], ['threshold', c.uint], ['total', c.uint]])
const shareReqBody = struct([['secretId', c.fixed16], ['kind', c.uint], ['version', c.uint], ['requesterId', c.fixed16], ['holderId', c.fixed16], ['at', c.uint], ['reason', c.string]])
const shareRes = struct([['share', kasaShare]])

const reqDigest = (familyId, body) => hash('hf/kasa-req/', familyId, body)

function payIste (familyId, { secretId, kind, version, holderId, at = Date.now(), reason = 'restore' }, me) {
  if (!NEDEN.includes(reason)) fail('INVALID_MESSAGE')
  const body = c.encode(shareReqBody, { secretId, kind, version, requesterId: me.memberId, holderId: b4a.from(hex(holderId), 'hex'), at, reason })
  const sig = b4a.alloc(64)
  sodium.crypto_sign_detached(sig, reqDigest(familyId, body), me.signKeyPair.secretKey)
  return b4a.concat([body, sig])
}

function payIstegiCoz (bytes) {
  if (bytes.byteLength < 64) fail('INVALID_MESSAGE')
  const body = bytes.subarray(0, bytes.byteLength - 64)
  const m = decodeCanonical(shareReqBody, body, 'INVALID_MESSAGE')
  if (!NEDEN.includes(m.reason) || m.kind > 1) fail('INVALID_MESSAGE')
  return { m, body, sig: bytes.subarray(bytes.byteLength - 64) }
}

// Bir kimliği getiren beklemeli olaylar (RFC-0019 §11.4 b): eski cihazın imzalamadığı ROTATE_DEVICE, replaces
// taşıyan APP_ATTACH ve eski ana kimliğin imzalamadığı APP_PRIMARY. Dönüş: [{ seq, eski }] ve önceki kimlikler.
function getirenler (L, cur) {
  const m = L.members.get(cur)
  const out = []
  const onceki = []
  if (m && m.rotatedFrom) {
    const e = L.events[m.addedSeq]
    if (e && e.type === T.ROTATE_DEVICE) {
      const b = decodeBody(T.ROTATE_DEVICE, e.body)
      const imzali = b.oldSigned === null || b.oldSigned === undefined ? e.sigs.some((x) => hex(x.memberId) === m.rotatedFrom) : b.oldSigned
      if (!imzali) out.push({ seq: m.addedSeq, eski: m.rotatedFrom })
    } else if (e && e.type === T.APP_ATTACH) out.push({ seq: m.addedSeq, eski: m.rotatedFrom })
    onceki.push(m.rotatedFrom)
  }
  // Aynı kimlik ayrıca APP_PRIMARY ile ana kimlik olmuş olabilir (inceleme 5 S1): ikisine de bakılır
  for (const e of L.events) {
    if (e.type !== T.APP_PRIMARY) continue
    const b = decodeBody(T.APP_PRIMARY, e.body)
    if (hex(b.newPrimaryId) !== cur) continue
    if (!b.oldSigned) out.push({ seq: e.seq, eski: hex(b.against) })
    onceki.push(hex(b.against))
  }
  return { out, onceki }
}

// İstekçinin kimlik zincirindeki bütün beklemeli değişimler (rotatedFrom ve against geriye izlenir)
function bekleyenDegisimler (L, memberHex) {
  const out = []
  const gorulen = new Set()
  const kuyruk = [memberHex]
  while (kuyruk.length && gorulen.size <= L.members.size) {
    const cur = kuyruk.shift()
    if (gorulen.has(cur)) continue
    gorulen.add(cur)
    const g = getirenler(L, cur)
    out.push(...g.out)
    kuyruk.push(...g.onceki)
  }
  return out
}

// Eski API: yalnız istekçinin kendi olayı (geriye uyum; yeni kod bekleyenDegisimler kullanır)
const imzasizDegisim = (L, memberHex) => bekleyenDegisimler(L, memberHex)[0] || null

const ONAY_MS = 10 * 60_000 // onay istekten sonra en çok 10 dakika (RFC-0021 b)

// Pay sahibi (telefon, kutu, TPM'li işçi). paylar: secretIdHex → { share (KASA_SHARE), rootId? (YA) }.
// me: tutucunun kendi kimliği. ilkGorulme: olay özeti (hex) → uyarının gönderildiği an; sayac: verilen paylar
// { get(k), set(k, v) }. İkisi de kalıcı saklanır ve zorunludur (inceleme 5 S9). uyar(bildirim, alicilar): 72 saat
// kuralına giren olay ilk görüldüğünde beklemeden gönderilecek güvenlik bildirimi (RFC-0021 a).
class PayTutucu {
  constructor ({ ledger, me, now = Date.now, ilkGorulme, sayac, uyar = () => {} }) {
    if (!ilkGorulme || !sayac) fail('STATE_STORE_REQUIRED')
    this.L = ledger
    this.meHex = hex(me.memberId || me)
    this.now = now
    this.paylar = new Map()
    // Pay dizini (D36, inceleme 13 bulgu 6): "secretId|sürüm" → pay özeti. Gizli değildir; telefonda kilitliyken paylar
    // bellekte olmadığında tekrar (DUPLICATE_HOLDER) ve eski sürüm (STALE_VERSION) denetimi bununla yapılır.
    this.dizin = new Map()
    // ertele: true ise yeni sürümün sildiği eski payların baytları hemen sıfırlanmaz, sifirlanacak'a girer; kalıcı yazım
    // başarılı olunca çağıran sifirla() der, düşerse eski hâl geri konabilir (kutu; inceleme 15 B4)
    this.ertele = false
    this.sifirlanacak = []
    this.ilkGorulme = ilkGorulme
    this.verilen = sayac // requester|secretId|version → an
    this.uyar = uyar
    this._onaylar = new Map() // jetonHex → { bytes, from, at }
  }

  // Yeni sürüm gelince aynı sırrın eski sürümleri silinir (döndürme, inceleme kasa 13). YA payında rootId zorunlu ve
  // secretId ile tutarlı.
  ekle (pay, meta = {}) {
    const sid = hex(pay.share.secretId)
    if (pay.share.kind === TUR.YA && (!meta.rootId || hex(yaSecretId(this.L.familyId, meta.rootId)) !== sid)) fail('INVALID_ROOT')
    const surumOf = (k) => Number(k.slice(k.indexOf('|') + 1))
    if ([...this.dizin.keys()].some((k) => k.startsWith(sid + '|') && surumOf(k) > pay.share.version)) fail('STALE_VERSION')
    for (const [k, v] of [...this.paylar]) {
      if (k.startsWith(sid + '|') && v.share.version < pay.share.version) { this._sifirla(v.share.share); this.paylar.delete(k) }
    }
    if ([...this.paylar.values()].some((v) => hex(v.share.secretId) === sid && v.share.version > pay.share.version)) fail('STALE_VERSION')
    for (const k of [...this.dizin.keys()]) if (k.startsWith(sid + '|') && surumOf(k) < pay.share.version) this.dizin.delete(k)
    this.paylar.set(sid + '|' + pay.share.version, { ...meta, share: pay.share })
    this.dizin.set(sid + '|' + pay.share.version, payOzeti(pay.share))
  }

  _sifirla (b) { if (this.ertele) this.sifirlanacak.push(b); else sodium.sodium_memzero(b) }

  // Ertelenen sıfırlamalar (kalıcı yazım başarılı olduktan sonra)
  sifirla () { for (const b of this.sifirlanacak.splice(0)) sodium.sodium_memzero(b) }

  // Yeni dağıtımda artık tutucu değilsek pay silinir
  sil (secretId) {
    const sid = hex(secretId)
    for (const [k, v] of [...this.paylar]) if (k.startsWith(sid + '|')) { sodium.sodium_memzero(v.share.share); this.paylar.delete(k) }
    for (const k of [...this.dizin.keys()]) if (k.startsWith(sid + '|')) this.dizin.delete(k)
  }

  // Defteri her uyguladığında çağrılır: yeni olayların ilk görülme anı (olay özetiyle) ve 72 saat kuralına giren
  // olayda beklemeden uyarı. Alıcılar: kişinin bütün aktif kimlikleri, olayın düşürdüğü eski kimlik, diğer ebeveynler.
  gozle () {
    const L = this.L
    const now = this.now()
    for (let i = 0; i < L.len; i++) {
      const k = hex(L.hashAt(i))
      if (this.ilkGorulme.has(k)) continue
      this.ilkGorulme.set(k, now)
      const u = this._uyari(i)
      if (u) this.uyar({ type: 'rotate_pending_share', seq: i, eski: u.eski, yeni: u.yeni, bitis: now + BEKLEME_MS }, u.alicilar)
    }
  }

  _uyari (seq) {
    const L = this.L
    const e = L.events[seq]
    let yeni = null
    if (e.type === T.ROTATE_DEVICE || e.type === T.APP_ATTACH) {
      for (const [id, m] of L.members) if (m.addedSeq === seq && m.rotatedFrom) yeni = id
    } else if (e.type === T.APP_PRIMARY) yeni = hex(decodeBody(T.APP_PRIMARY, e.body).newPrimaryId)
    if (!yeni) return null
    const d = getirenler(L, yeni).out.find((x) => x.seq === seq)
    if (!d) return null
    const pid = L.personIdOf(L.resolveMember(yeni) || yeni)
    const alicilar = new Set([...(pid ? L.identitiesOf(pid) : []), d.eski, ...L.parentIds()])
    return { eski: d.eski, yeni, alicilar: [...alicilar].sort() }
  }

  // İstekçinin bu sırrı sormaya ve istemeye yetkisi (RFC-0004 §5.2 koşul 1–3; inceleme 19 B13): YA'da sırrın kök
  // zincirinin bugünkü ucu, KRA'da kasa koleksiyonunun bugünkü okuyucusu (ek kimlik değil). Kutu ve cihaz istemez.
  yetkili (secretId, req) {
    const L = this.L
    const sid = hex(secretId)
    const rm = L.members.get(req)
    if (!rm || L.sessionRole(req) !== 'uye' || rm.role === 'kutu') return false
    const col = L.collections.get(sid)
    if (col && col.sensitivity === 'kasa') return !rm.extra && readerSet(L, col).has(req)
    const kok = rootIdOf(L, req)
    return hex(yaSecretId(L.familyId, kok)) === sid && L.resolveMember(kok) === req
  }

  // KASA_VERSION_REQ'e cevap; from: soranın kimliği (zorunlu, B13: sürüm sorusu yalnız yetkili istekçiye). dizinle:
  // paylar bellekte değilse (telefonda kasa kilitliyken arşivde) sürüm pay dizininden, eşik 0 ile
  surum (bytes, { from = null, dizinle = false } = {}) {
    const m = decodeCanonical(versionReq, bytes, 'INVALID_MESSAGE')
    this.gozle()
    if (!from || !this.yetkili(m.secretId, hex(from))) return null
    const k = [...this.paylar.values()].filter((p) => b4a.equals(p.share.secretId, m.secretId)).sort((a, b) => b.share.version - a.share.version)[0]
    if (k) return c.encode(versionRes, { secretId: m.secretId, version: k.share.version, threshold: k.share.threshold, total: k.share.total })
    if (!dizinle) return null
    const sid = hex(m.secretId)
    const v = [...this.dizin.keys()].filter((x) => x.startsWith(sid + '|')).map((x) => Number(x.slice(sid.length + 1))).sort((a, b) => b - a)[0]
    return v ? c.encode(versionRes, { secretId: m.secretId, version: v, threshold: 0, total: 0 }) : null
  }

  // Bir kimliğin zincirindeki beklemeli değişimlerden en geç biteni (RFC-0021 a): { bitis, bildir }; yoksa bitis 0
  bekleme (memberHex) {
    this.gozle()
    const L = this.L
    let bitis = 0
    let bildir = null
    for (const x of bekleyenDegisimler(L, memberHex)) {
      const an = this.ilkGorulme.get(hex(L.hashAt(x.seq)))
      if (an !== undefined && an + BEKLEME_MS > bitis) { bitis = an + BEKLEME_MS; bildir = x.eski }
    }
    return { bitis, bildir }
  }

  // Aynı sürümde daha küçük commit'li dağıtımın payı eskisinin yerine geçer (RFC-0027 §9 e, eşzamanlı döndürme)
  degistir (pay, meta = {}) {
    const k = hex(pay.share.secretId) + '|' + pay.share.version
    const eski = this.paylar.get(k)
    if (eski) this._sifirla(eski.share.share)
    this.paylar.set(k, { ...meta, share: pay.share })
    this.dizin.set(k, payOzeti(pay.share))
  }

  // Denetimler; tazelik yalnız ilk denetimde (RFC-0021 b). dizinle: pay bellekte değilse (telefonda kasa kilitliyken
  // arşivde) pay dizini yeter; bütün diğer denetimler yine çalışır (inceleme 19 B11), pay onayda yeniden aranır
  _denetle (bytes, from, { tazelik, dizinle = false }) {
    this.gozle()
    const L = this.L
    let d
    try { d = payIstegiCoz(bytes) } catch { return { red: 'INVALID_MESSAGE' } }
    const { m, body, sig } = d
    const req = hex(m.requesterId)
    const rm = L.members.get(req)
    if (!rm || !sodium.crypto_sign_verify_detached(sig, reqDigest(L.familyId, body), rm.signPub)) return { red: 'INVALID_SIGNATURE' }
    if (!from || hex(from) !== req) return { red: 'UNAUTHORIZED' }
    if (hex(m.holderId) !== this.meHex) return { red: 'UNAUTHORIZED' }
    const now = this.now()
    if (tazelik && (m.at < now - TAZELIK_MS || m.at > now + ILERI_MS)) return { red: 'REQUEST_STALE' }
    if (L.sessionRole(req) !== 'uye' || rm.role === 'kutu') return { red: 'UNAUTHORIZED' }
    const anahtar = hex(m.secretId) + '|' + m.version
    const k = this.paylar.get(anahtar)
    if (k ? k.share.kind !== m.kind : !(dizinle && this.dizin.has(anahtar))) return { red: 'PAY_YOK' }
    // YA: istekçi sırrın sahibinin rootId zincirinin bugünkü ucu; ana kimliğe çözülmez (RFC-0019 §11.4 c). Pay
    // bellekte değilse kök istekçinin zincirinden bulunur ve secretId'yi vermelidir
    if (m.kind === TUR.YA) {
      const kok = k ? hex(k.rootId) : rootIdOf(L, req)
      if (!k && hex(yaSecretId(L.familyId, kok)) !== hex(m.secretId)) return { red: 'UNAUTHORIZED' }
      if (L.resolveMember(kok) !== req) return { red: 'UNAUTHORIZED' }
    }
    // KRA: istekçi bugün kasa koleksiyonunun okuyucusu; ek kimlik KRA payı istemez
    if (m.kind === TUR.KRA) {
      if (rm.extra) return { red: 'UNAUTHORIZED' }
      const col = L.collections.get(hex(m.secretId))
      if (!col || col.sensitivity !== 'kasa' || !readerSet(L, col).has(req)) return { red: 'UNAUTHORIZED' }
    }
    // Zincirdeki beklemeli değişimlerin her biri için uyarıdan itibaren 72 saat (RFC-0021 a)
    const { bitis, bildir } = this.bekleme(req)
    if (now < bitis) return { bekle: bitis, bildir }
    const vk = req + '|' + hex(m.secretId) + '|' + m.version
    const son = this.verilen.get(vk)
    if (son !== undefined && now - son < GUN_MS) return { red: 'DAILY_LIMIT' }
    return { ok: true, m, k, vk }
  }

  // 1. aşama (inceleme kasa 12). from: oturumun karşı tarafı, zorunlu ve istekçiyle aynı. dizinle: _denetle'deki gibi.
  // Dönüş: { onayGerekli: true, jeton } · { bekle: an, bildir } · { red: kod }. İstek baytları ve geliş anı tutucuda
  // kalır; onay gelişten en çok 10 dakika sonraya kadar (RFC-0021 b, inceleme 19 B12)
  denetle (bytes, { from, dizinle = false } = {}) {
    const r = this._denetle(bytes, from, { tazelik: true, dizinle })
    if (!r.ok) return r
    const jeton = b4a.alloc(16)
    sodium.randombytes_buf(jeton)
    this._onaylar.set(hex(jeton), { bytes: b4a.from(bytes), from: hex(from), at: this.now() })
    return { onayGerekli: true, jeton }
  }

  // Süresi dolan onay kayıtları (istek baytları) silinir
  onaylariTemizle () {
    const now = this.now()
    for (const [j, o] of this._onaylar) if (now - o.at > ONAY_MS) this._onaylar.delete(j)
  }

  // 2. aşama: kullanıcı (biyometri) onayından sonra, jetonla. Onay en çok 10 dakika geçerli; tazelik dışındaki bütün
  // denetimler yeniden çalışır (RFC-0021 b). Günlük sınır burada tüketilir.
  ver (jeton) {
    const k = b4a.isBuffer(jeton) ? hex(jeton) : ''
    const o = this._onaylar.get(k)
    this._onaylar.delete(k)
    if (!o) return { red: 'NO_APPROVAL' }
    if (this.now() - o.at > ONAY_MS) return { red: 'APPROVAL_EXPIRED' }
    const r = this._denetle(o.bytes, o.from, { tazelik: false })
    if (!r.ok) return r
    this.verilen.set(r.vk, this.now())
    return { ver: c.encode(shareRes, { share: r.k.share }) }
  }

  // Onay istemeyen tutucu (kutu, TPM'li işçi): iki aşama birlikte
  iste (bytes, opts = {}) {
    const r = this.denetle(bytes, opts)
    return r.onayGerekli ? this.ver(r.jeton) : r
  }
}

// Ağdan gelen pay kâğıt payla aynı denetimden geçer (RFC-0021 c)
const payCevabiCoz = (bytes) => decodeShare(c.encode(kasaShare, decodeCanonical(shareRes, bytes, 'INVALID_MESSAGE').share))
const surumIste = (secretId) => c.encode(versionReq, { secretId })
const surumIstegiCoz = (bytes) => decodeCanonical(versionReq, bytes, 'INVALID_MESSAGE')
const surumCevabiCoz = (bytes) => decodeCanonical(versionRes, bytes, 'INVALID_MESSAGE')

module.exports = { Z, payOzeti, BEKLEME_MS, TAZELIK_MS, ONAY_MS, getirenler, bekleyenDegisimler, versionReq, versionRes, shareReqBody, shareRes, reqDigest, payIste, payIstegiCoz, imzasizDegisim, PayTutucu, payCevabiCoz, surumIste, surumIstegiCoz, surumCevabiCoz }
