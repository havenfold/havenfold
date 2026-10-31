// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// event.js — olay kaydı, özne başvuruları, motor için geçerlilik, tekil anahtar, düzeltme (RFC-0006 §4, §7)
//
// Olay bir kayıttır. Motor kayıtları şu biçimde görür (Kayit):
//   { recordId (hex), type, fields (okuma görünümü), tf (türü belirleyen işlemin alanları),
//     stamp: { hlc, authorId, opId } (türü belirleyen işlem), yazar: 'uye' | 'cihaz' | 'misafir', authorHex }
// _t, _subj, _key ve _keep yalnız tf'den okunur (§4.2); sonradan gelen put onları kaydıramaz.
const b4a = require('b4a')
const { kdf: { hash } } = require('@havenfold/core')
const { birlestir: { cmp, reduceAll, view }, hlc: { msOf }, alanlar: { checkWrite, confOf }, kodlama: { decodeInner } } = require('@havenfold/records')
const { adGecerli, adAlaniBilinir, KAPSAM } = require('./type')

const hex = (b) => b4a.toString(b, 'hex')
function fail (code) { throw new Error(code) }

const GELECEK_MS = 5 * 60_000
const DAY = 86_400_000
const ID_RE = /^[0-9a-f]{32}$/
const ONEKLER = { uye: 'uye', varlik: 'varlik', yer: 'yer', device: 'device', grant: 'grant', kayit: 'kayit' }

// --- Kayıt görünümü ------------------------------------------------------------------------------------------------

const alanlarOf = (inner) => Object.fromEntries(inner.fields.map((f) => [f.name, f.value]))
// Misafir (RFC-0030): GRANT_WRITE ile bırakır; tanım kaydı, vaka sahiplenme ve kapatma, düzeltme yazamaz
const yazarOf = (L, authorHex) => (L.devices.has(authorHex) ? 'cihaz' : L.grants.has(authorHex) ? 'misafir' : 'uye')

// Replika'nın bir koleksiyonundaki canlı kayıtlar. İşlemler bir kez kayıtlara ayrılır (doğrusal; inceleme SDK 10).
// Kayıt ayrıca son işlemin damgasını (son: { hlc, authorId }) taşır (RFC-0019 8.15).
function kayitlarReplikadan (r, cid, { recordId = null } = {}) {
  cid = typeof cid === 'string' ? cid : hex(cid)
  const rid0 = recordId === null ? null : (typeof recordId === 'string' ? recordId : hex(recordId))
  const valid = r.validOps(cid).filter((o) => rid0 === null || hex(o.inner.recordId) === rid0)
  const byId = new Map(valid.map((o) => [hex(o.opId), o]))
  const byRecord = new Map()
  for (const o of valid) {
    const k = hex(o.inner.recordId)
    if (!byRecord.has(k)) byRecord.set(k, [])
    byRecord.get(k).push(o)
  }
  const out = []
  // Yazar sınıfına uymayan işlemler katılmaz (RFC-0019 §11.1 l)
  const durumlar = r.durumlar ? r.durumlar(cid, rid0 === null ? null : valid) : reduceAll(valid)
  for (const [rid, st] of durumlar) {
    const v = view(b4a.from(rid, 'hex'), st)
    if (!v || !st.typeStamp) continue
    const typeOp = byId.get(hex(st.typeStamp.opId))
    const authorHex = hex(typeOp.inner.authorId)
    const son = [st.lastPut, st.deletedAt].filter(Boolean).sort((a, b) => cmp(b, a))[0]
    out.push({ recordId: rid, type: st.type, fields: v.fields, tf: alanlarOf(typeOp.inner), stamp: st.typeStamp, son, yazar: yazarOf(r.ledger, authorHex), authorHex, uyeAlanlari: uyeAlanlari(r.ledger, byRecord.get(rid) || [], st) })
  }
  return out.sort((a, b) => (a.recordId < b.recordId ? -1 : 1))
}

// Yalnız üyelerin işlemlerinden birleşen alanlar (son yazan kazanır; silmeden önceki alanlar girmez). Cihazın
// yazdığı alan bunlara girmez: bastirildi gibi karar alanları buradan okunur (D-inceleme-4 bulgu 1).
function uyeAlanlari (L, ops, st) {
  const out = new Map()
  for (const o of ops) {
    const a = hex(o.inner.authorId)
    if (L.devices.has(a) || !L.members.has(a)) continue
    const s = { hlc: o.inner.hlc, authorId: o.inner.authorId, opId: o.opId }
    if (st.deletedAt && cmp(s, st.deletedAt) <= 0) continue
    for (const f of o.inner.fields) {
      const cur = out.get(f.name)
      if (!cur || cmp(s, cur.s) > 0) out.set(f.name, { s, value: f.value })
    }
  }
  return Object.fromEntries([...out].map(([k, v]) => [k, v.value]))
}

// Tek işlemli kayıt (vektörler): inner OpInner baytları, opId 32 B
function kayitIslemden (L, innerBytes, opId) {
  const inner = decodeInner(innerBytes)
  const authorHex = hex(inner.authorId)
  const fields = alanlarOf(inner)
  return {
    recordId: hex(inner.recordId),
    type: inner.type,
    fields,
    tf: fields,
    stamp: { hlc: inner.hlc, authorId: inner.authorId, opId },
    yazar: yazarOf(L, authorHex),
    authorHex,
    uyeAlanlari: yazarOf(L, authorHex) === 'uye' ? fields : {}
  }
}

// Türü belirleyen işlem sırası: (hlc, authorId, opId), küçük önce
const ilkOnce = (a, b) => cmp(a.stamp, b.stamp)

// --- Özne ve yer (§4.3) -----------------------------------------------------------------------------------------

// Dönüş: { tur, id } ya da null. kayitIds: aynı koleksiyondaki kayıtların kimlikleri (kayit: için)
function ozneCoz (L, subj, kayitIds = null) {
  if (subj === 'topluluk') return { tur: 'topluluk', id: null }
  if (typeof subj !== 'string') return null
  const i = subj.indexOf(':')
  const tur = ONEKLER[subj.slice(0, i)]
  const id = subj.slice(i + 1)
  if (!tur || !ID_RE.test(id)) return null
  const var_ = {
    uye: () => L.members.has(id),
    varlik: () => L.beings.has(id),
    yer: () => L.places.has(id),
    device: () => L.devices.has(id),
    grant: () => L.grants.has(id),
    kayit: () => !kayitIds || kayitIds.has(id)
  }[tur]()
  return var_ ? { tur, id } : null
}

const isZeroHex = (h) => !h || /^0+$/.test(h)

// _place yoksa: varlık ve cihazda defterdeki placeId, yerde kendisi
function yerOf (L, k) {
  const p = k.fields._place
  if (typeof p === 'string' && /^yer:[0-9a-f]{32}$/.test(p)) return p.slice(4)
  const o = ozneCoz(L, k.tf._subj)
  if (!o) return null
  if (o.tur === 'yer') return o.id
  const placeId = o.tur === 'varlik' ? L.beings.get(o.id)?.placeId : o.tur === 'device' ? L.devices.get(o.id)?.placeId : null
  return isZeroHex(placeId) ? null : placeId
}

// --- Geçerlilik (§4.5) -----------------------------------------------------------------------------------------

// "Ebeveynler" koleksiyonu: yalnız ebeveynlerin okuduğu, kasa olmayan genel koleksiyon (özel nitelikli veri için)
const ebeveynlerMi = (col) => col.kind === 'genel' && col.sensitivity === 'normal' && col.readers.length === 1 && col.readers[0] === 'rol:ebeveyn'

// Hedefi geçersiz sayan düzeltmeler: yalnız üyenin yazdığı canlı hf.olay.duzelt { hedef, gecersiz: true }
function duzeltilenler (kayitlar) {
  const out = new Set()
  for (const k of kayitlar) {
    if (k.type !== 'hf.olay.duzelt' || k.yazar !== 'uye') continue
    if (k.fields.gecersiz === true && typeof k.fields.hedef === 'string') out.add(k.fields.hedef)
  }
  return out
}

// ctx: { ledger, col (defterdeki koleksiyon), katalog, kayitlar }. Dönüş: null (geçerli) ya da neden kodu.
function olayHatasi (ctx, k, duzeltilen = duzeltilenler(ctx.kayitlar), kayitIds = null) {
  const def = ctx.katalog.get(k.type)
  if (!adAlaniBilinir(k.type) || !adGecerli(k.type) || !def || !def.olay) return 'NO_TYPE' // 1
  if (k.fields._v !== def.v) return 'VERSION_UNKNOWN' // 1: türün tanımındaki sürüm
  const t = k.tf._t
  if (!Number.isSafeInteger(t) || t < 0) return 'FIELD_MISSING' // 2
  const o = ozneCoz(ctx.ledger, k.tf._subj, kayitIds)
  if (!o || !def.ozne.includes(o.tur)) return 'INVALID_SUBJECT' // 2
  if (t > msOf(k.stamp.hlc) + GELECEK_MS) return 'GELECEK' // 3
  // 4: misafirin olayı üye sınıfındaki türlerde geçerlidir (RFC-0030 §7)
  if (def.yazar !== 'ikisi' && def.yazar !== (k.yazar === 'misafir' ? 'uye' : k.yazar)) return 'INVALID_AUTHOR_CLASS'
  const scope = k.fields._scope
  if (scope !== undefined && scope !== null && !KAPSAM.includes(scope)) return 'KAPSAM' // 5
  if (scope === 'kisisel' && ctx.col.kind !== 'kisisel') return 'KAPSAM'
  const conf = k.fields._conf
  if (conf !== undefined && conf !== null && !(Number.isInteger(conf) && conf >= 0 && conf <= 100)) return 'INVALID_CONFIDENCE' // 6
  if (duzeltilen.has(k.recordId)) return 'DUZELTILDI' // 7
  // §4.6 ve §5.2: kasa koleksiyonuna olay yazılmaz; özel nitelikli tür yalnız Ebeveynler'de ya da kişiselde
  if (ctx.col.sensitivity === 'kasa') return 'KASA'
  if (def.ozel && !(ctx.col.kind === 'kisisel' || ebeveynlerMi(ctx.col))) return 'OZEL'
  // RFC-0031 §3, §4.1: hf.sos alanları ve misafirin SOS'u
  if (k.type === 'hf.sos') return require('./sos').sosHatasi(k)
  return null
}

// Motorun gördüğü olay
function olayOf (k) {
  return {
    recordId: k.recordId,
    type: k.type,
    t: k.tf._t,
    subj: k.tf._subj,
    key: b4a.isBuffer(k.tf._key) && k.tf._key.byteLength === 16 ? hex(k.tf._key) : null,
    conf: confOf(k.fields),
    fields: k.fields,
    stamp: k.stamp,
    yazar: k.yazar,
    authorHex: k.authorHex,
    obs: typeof k.fields._obs === 'string' ? k.fields._obs : null
  }
}

// Koleksiyonun olayları: geçerli ve tekilleştirilmiş (sayilir: _conf ≥ 50), belirsiz (_conf < 50), geçersiz
function olaylar (ctx) {
  const duz = duzeltilenler(ctx.kayitlar)
  const ids = new Set(ctx.kayitlar.map((k) => k.recordId))
  const gecerli = []
  const gecersiz = []
  for (const k of ctx.kayitlar) {
    const def = ctx.katalog.get(k.type)
    if (!def || !def.olay) {
      if (k.tf._t !== undefined && !def) gecersiz.push({ recordId: k.recordId, neden: 'NO_TYPE' })
      continue
    }
    const h = olayHatasi(ctx, k, duz, ids)
    if (h) gecersiz.push({ recordId: k.recordId, neden: h })
    else gecerli.push(olayOf(k))
  }
  // Tekil anahtar: aynı tür ve aynı _key → türü belirleyen işlemi en küçük olan
  const asil = new Map()
  const tekil = []
  for (const e of gecerli.sort(ilkOnce)) {
    if (!e.key) { tekil.push(e); continue }
    const k = e.type + '|' + e.key
    if (asil.has(k)) continue
    asil.set(k, e)
    tekil.push(e)
  }
  return {
    sayilir: tekil.filter((e) => e.conf >= 50),
    belirsiz: tekil.filter((e) => e.conf < 50),
    gecersiz
  }
}

// --- Yazma -----------------------------------------------------------------------------------------------------

// _key = hash('hf/olay-anahtar/', hash('hf/olay-tur/', tür adı), parça_1, …)[0..16]; parçalar sabit boyutlu (RFC-0006
// §4.5, RFC-0027 §8 c; D69): kimlik 16 bayt, tamsayı u64be (0 ≤ n < 2^64). Başka boy birleşimi belirsiz kılardı.
const U64 = 1n << 64n
function anahtar (tur, ...parcalar) {
  for (const p of parcalar) {
    const ok = b4a.isBuffer(p) ? p.byteLength === 16 : typeof p === 'bigint' ? p >= 0n && p < U64 : Number.isSafeInteger(p) && p >= 0
    if (!ok) fail('KEY_CHUNK')
  }
  return hash('hf/olay-anahtar/', hash('hf/olay-tur/', tur), ...parcalar).subarray(0, 16)
}

// Gün numarası (§6.1): floor((_t + utc_dk × 60000) / 86400000)
const gunNumarasi = (t, utcDk = 0) => Math.floor((t + utcDk * 60_000) / DAY)

// Olay alanları (put ya da append-event için). urun: altçizgisiz ürün alanları, düz değerler.
function olayAlanlari (katalog, tur, { t, subj, place, scope, conf, key, obs, keep, src }, urun = {}) {
  const def = katalog.get(tur)
  if (!def || !def.olay || !adGecerli(tur)) fail('NO_TYPE')
  if (!Number.isSafeInteger(t) || t < 0) fail('INVALID_FIELD_VALUE')
  if (!(subj === 'topluluk' || /^(uye|varlik|yer|device|grant|kayit):[0-9a-f]{32}$/.test(subj))) fail('INVALID_FIELD_VALUE')
  for (const [ad, v] of Object.entries(urun)) {
    if (ad.startsWith('_')) fail('RESERVED_FIELD')
    if (v && typeof v === 'object' && !b4a.isBuffer(v) && !Array.isArray(v) && !b4a.isBuffer(v.blobId)) fail('INVALID_FIELD_VALUE') // iç içe nesne yok
  }
  const f = { _v: def.v, _t: t, _subj: subj, _scope: scope || def.kapsam }
  if (place) f._place = place
  if (conf !== undefined && conf !== null) f._conf = conf
  if (key) f._key = key
  if (obs) f._obs = obs
  if (src) f._src = src
  // Saklama: türün varsayılanı; düşük güvende en çok 7 gün (§14.1)
  let k = keep !== undefined ? keep : def.keep
  if (conf !== undefined && conf !== null && conf < 50) k = k > 0 ? Math.min(k, 7) : 7
  if (k > 0) f._keep = k
  const all = { ...f, ...urun }
  checkWrite(all)
  return all
}

// Gözlem kesintisinin içeriksiz kopyası (RFC-0019 §11.5 e): Ebeveynler'e yazılan hf.device.offline/online olayının
// olayların koleksiyonuna da yazılan kopyası. Yalnız tür, özne ve an taşır; kopya: true vaka açmaz.
const KESINTI_TURLERI = ['hf.device.offline', 'hf.device.online']
function kesintiKopyasi (katalog, tur, { t, subj }) {
  if (!KESINTI_TURLERI.includes(tur)) fail('NO_TYPE')
  const f = olayAlanlari(katalog, tur, { t, subj })
  return { _v: f._v, _t: f._t, _subj: f._subj, _scope: f._scope, ...(f._keep ? { _keep: f._keep } : {}), kopya: true }
}

module.exports = {
  KESINTI_TURLERI, kesintiKopyasi,
  GELECEK_MS, kayitlarReplikadan, kayitIslemden, ilkOnce, ozneCoz, yerOf, ebeveynlerMi, duzeltilenler,
  olayHatasi, olayOf, olaylar, anahtar, gunNumarasi, olayAlanlari
}
