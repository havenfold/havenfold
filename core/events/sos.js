// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// sos.js — hf.sos alanları, misafirin SOS'u, gösterim ve afet bağıyla tekilleştirme (RFC-0031)
//
// Alanların hepsi isteğe bağlıdır (§3). Kurala uymayan SOS motor için geçersizdir (vaka açmaz) ama yine SOS olarak
// gösterilir: güvenlik olayı hiçbir zaman sessizce yutulmaz. Kayıt katmanının değer kodlamasında map yoktur ve alan
// adları [a-z0-9_.] olur (RFC-0001 §4.1–§4.2); bu yüzden konum [latE5, lonE5, accM, at] listesi, afet bağı afet_mid'dir.
const b4a = require('b4a')

const hex = (b) => b4a.toString(b, 'hex')

const TUR = 'hf.sos'
const YOLLAR = ['dugme', 'zorlama-pin', 'afet']
const MAX_METIN = 64
const LAT_MAX = 90_00000
const LON_MAX = 180_00000
const TEKIL_MS = 7 * 86_400_000 // §6: alıcı bildirim gösterdiği afet_mid'leri 7 gün tutar
const MAX_TEKIL = 4096
const MAX_AFET_MID = 32 // D103: bir afet SOS'unun alıcı sayısı sınırı (aile 8 kişi, kişi başına birkaç kimlik)

const tamsayi = (x) => Number.isSafeInteger(x)

function konumOf (v) {
  if (!Array.isArray(v) || v.length !== 4 || !v.every(tamsayi)) return null
  const [latE5, lonE5, accM, at] = v
  if (Math.abs(latE5) > LAT_MAX || Math.abs(lonE5) > LON_MAX || accM < 0 || at < 0) return null
  return { latE5, lonE5, accM, at }
}

// Motor için geçerlilik (§3, §4.1). k: event.js kayıt görünümü (fields, tf, yazar, authorHex). Dönüş: null ya da kod.
// Alanlar türü belirleyen ilk işlemden (tf) okunur: sonradan gelen put SOS'u motor için geçersiz kılamaz (inceleme 20 B3).
function sosHatasi (k) {
  const f = k.tf
  const subj = k.tf._subj
  // Misafir yalnız kendi grant: öznesiyle; üye uye: öznesiyle (grant: öznesi misafirin örtük iznine ayrılmıştır)
  if (k.yazar === 'misafir' ? subj !== 'grant:' + k.authorHex : !(typeof subj === 'string' && subj.startsWith('uye:'))) return 'INVALID_SOS_SUBJECT'
  const yol = f.yol === undefined ? 'dugme' : f.yol
  if (!YOLLAR.includes(yol)) return 'INVALID_SOS_PATH'
  if (f.konum !== undefined && !konumOf(f.konum)) return 'INVALID_SOS_LOCATION'
  if (f.metin !== undefined && !(typeof f.metin === 'string' && b4a.byteLength(f.metin) <= MAX_METIN)) return 'SOS_METIN'
  if (f.pil !== undefined && !(tamsayi(f.pil) && f.pil >= 0 && f.pil <= 100)) return 'INVALID_SOS_BATTERY'
  if (f.afet_mid !== undefined && !(b4a.isBuffer(f.afet_mid) && f.afet_mid.byteLength === 16)) return 'INVALID_SOS_DISASTER_MID'
  // D103 (RFC-0037 A2): afet SOS'u alıcı başına ayrı mid taşır; kayıt hepsini listeler (her alıcı kendi mid'ini bulur)
  if (f.afet_midler !== undefined && !(Array.isArray(f.afet_midler) && f.afet_midler.length >= 1 && f.afet_midler.length <= MAX_AFET_MID && f.afet_midler.every((x) => b4a.isBuffer(x) && x.byteLength === 16))) return 'INVALID_SOS_DISASTER_MID'
  // RFC-0034 §9 (K2): birden çok aileye yazılan aynı basışın ortak kimliği (16 bayt rastgele, her basışta yeni)
  if (f.ortak_mid !== undefined && !(b4a.isBuffer(f.ortak_mid) && f.ortak_mid.byteLength === 16)) return 'SOS_SHARED_MID'
  if (f.sessiz !== undefined && f.sessiz !== true && f.sessiz !== false) return 'INVALID_SOS_SILENT'
  // Sessiz SOS yalnız zorlama PIN'inden; misafirin zorlama PIN'i ve sessiz SOS'u yoktur (§4.1)
  if (f.sessiz === true && yol !== 'zorlama-pin') return 'INVALID_SOS_SILENT'
  if (k.yazar === 'misafir' && (yol === 'zorlama-pin' || f.sessiz === true)) return 'SOS_FROM_GUEST'
  return null
}

// Kaydın bütün afet mid'leri (hex, tekil): afet_mid ve afet_midler (D103). Bozuk öğe atılır
function afetMidlerOf (f) {
  const out = []
  if (b4a.isBuffer(f.afet_mid) && f.afet_mid.byteLength === 16) out.push(hex(f.afet_mid))
  if (Array.isArray(f.afet_midler)) for (const x of f.afet_midler.slice(0, MAX_AFET_MID)) if (b4a.isBuffer(x) && x.byteLength === 16) out.push(hex(x))
  return [...new Set(out)]
}

// SOS'un afet ve aile bağları (afet_mid, afet_midler, ortak_mid) yalnız SOS'u yazanın kaydı açan işleminden (tf): başka üye
// sonradan ekleyip tekilleştirmeyi saptıramaz (Codex 6. tur)
function afetBaglari (tf) {
  const a = sosAlanlari(tf)
  return { afetMid: a.afetMid, afetMidler: a.afetMidler, ortakMid: a.ortakMid }
}

// Gösterim için alanlar: bozuk alan gösterilmez (null), SOS'un kendisi her zaman gösterilir
function sosAlanlari (fields) {
  const f = fields || {}
  return {
    yol: YOLLAR.includes(f.yol) ? f.yol : 'dugme',
    konum: f.konum === undefined ? null : konumOf(f.konum),
    metin: typeof f.metin === 'string' ? f.metin : null,
    pil: tamsayi(f.pil) && f.pil >= 0 && f.pil <= 100 ? f.pil : null,
    afetMid: b4a.isBuffer(f.afet_mid) && f.afet_mid.byteLength === 16 ? hex(f.afet_mid) : null,
    afetMidler: afetMidlerOf(f),
    ortakMid: b4a.isBuffer(f.ortak_mid) && f.ortak_mid.byteLength === 16 ? hex(f.ortak_mid) : null,
    sessiz: f.sessiz === true
  }
}

// Bir koleksiyonun bütün SOS'ları, geçerli olsun olmasın, yeniden eskiye. ctx: olay.olaylar ile aynı.
// Dönüş: [{ recordId, t, subj, yazar, authorHex, ...sosAlanlari, gecerli, neden }]
function sosListesi (ctx) {
  const { olayHatasi, duzeltilenler } = require('./event')
  const duz = duzeltilenler(ctx.kayitlar)
  const ids = new Set(ctx.kayitlar.map((k) => k.recordId))
  const out = []
  for (const k of ctx.kayitlar) {
    if (k.type !== TUR) continue
    const neden = olayHatasi(ctx, k, duz, ids)
    const t = tamsayi(k.tf._t) ? k.tf._t : null
    out.push({ recordId: k.recordId, t, subj: typeof k.tf._subj === 'string' ? k.tf._subj : null, yazar: k.yazar, authorHex: k.authorHex, ...sosAlanlari(k.fields), ...afetBaglari(k.tf), gecerli: !neden, neden })
  }
  return out.sort((a, b) => (b.t ?? 0) - (a.t ?? 0) || (a.recordId < b.recordId ? -1 : 1))
}

// Afet bağıyla tek bildirim (§6): aynı afet_mid önce afet mesajıyla, sonra kayıtla (ya da tersi) gelirse ikinci geliş
// bildirim göstermez. Kayıt [afetMid, an, kimlik] üçlüsüdür: kimlik ilk gösterilen bildirimin kaynağıdır (SOS kaydı ya
// da vaka, afet mesajı). Aynı kimlikle sorulunca cevap aynı kalır (inceleme 20 B1); "görüldü" yalnız isaretle() ile,
// bildirim gerçekten gösterilince yazılır. saklama: { get(k), set(k, v) } kalıcı küçük durum (verilmezse bellekte).
const ANAHTAR = 'sos/afet-mid'
class SosTekil {
  constructor ({ saklama = null, now = Date.now } = {}) {
    const m = new Map()
    this.saklama = saklama || { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v) }
    this.now = now
  }

  _id (afetMid) {
    if (afetMid === null || afetMid === undefined) return null
    const id = typeof afetMid === 'string' ? afetMid : hex(afetMid)
    return /^[0-9a-f]{32}$/.test(id) ? id : null
  }

  // Süresi geçmemiş kayıtlar: afetMid → { at, kimlik }. Eski biçim (afetMid → an) kimliksiz okunur.
  _kayitlar () {
    const simdi = this.now()
    const out = new Map()
    for (const [k, v] of Object.entries(this.saklama.get(ANAHTAR) || {})) {
      const x = typeof v === 'number' ? { at: v, kimlik: null } : v && typeof v.at === 'number' ? { at: v.at, kimlik: typeof v.kimlik === 'string' ? v.kimlik : null } : null
      if (x && simdi - x.at < TEKIL_MS) out.set(k, x)
    }
    return out
  }

  // Bildirim gösterilsin mi; hiçbir şey yazmaz. afetMid yoksa her zaman. kimlik: bu bildirimin kaynağı (aynı kimliğe aynı cevap)
  // afetMid liste de olabilir (D103: kaydın alıcı başına mid'leri): biri başka kaynakla görüldüyse gösterilmez
  gosterilsinMi (afetMid, kimlik = null) {
    if (Array.isArray(afetMid)) return afetMid.every((m) => this.gosterilsinMi(m, kimlik))
    const id = this._id(afetMid)
    if (!id) return true
    const x = this._kayitlar().get(id)
    return !x || (kimlik !== null && x.kimlik === kimlik)
  }

  // Bildirim gösterildi: afetMid ilk kez görüldüyse kimlikle yazılır
  isaretle (afetMid, kimlik = null) {
    if (Array.isArray(afetMid)) { for (const m of afetMid) this.isaretle(m, kimlik); return }
    const id = this._id(afetMid)
    if (!id) return
    const kayit = this._kayitlar()
    if (kayit.has(id)) return
    kayit.set(id, { at: this.now(), kimlik })
    this.saklama.set(ANAHTAR, Object.fromEntries([...kayit].sort((a, b) => a[1].at - b[1].at).slice(-MAX_TEKIL)))
  }

  // Sor ve göster (uygulamanın kendisi bildirim gösterecekse): Dönüş true → bildirim göster. Aynı kimlikle tekrar
  // çağrılınca aynı cevap; kimliksiz çağrıda ikinci geliş false.
  bildir (afetMid, kimlik = null) {
    const r = this.gosterilsinMi(afetMid, kimlik)
    if (r) this.isaretle(afetMid, kimlik)
    return r
  }
}

module.exports = { TUR, YOLLAR, MAX_METIN, TEKIL_MS, MAX_AFET_MID, sosHatasi, sosAlanlari, sosListesi, konumOf, afetMidlerOf, SosTekil }
