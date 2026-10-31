// SPDX-License-Identifier: Apache-2.0
// guest.js — misafirin (bakıcının) telefonunda sınırlı yazma (RFC-0030 §6): izinler, bırakma ve "Senin yazdıkların"
//
// Misafir ailenin koleksiyonunu okuyamaz; ebeveynin GRANT_WRITE ile izin verdiği koleksiyona, izinli tür ve özne için
// mühürlü olay bırakır. İzinler kabul edilmiş GUEST_VIEW'in drops alanından gelir. Bırakılan olay bu telefonda ayrıca
// tutulur (saklama); başkalarının yazdığı görünmez. Ağa yazmak çağıranındır: birak() REC_OPS mesajını döndürür,
// çağıran onu ailenin telefonlarına (misafir ↔ üye oturumu) gönderir.
const b4a = require('b4a')
const c = require('compact-encoding')
const { zarf: { Z } } = require('@havenfold/core')
const { misafir: { birakmaHazirla }, hlc: { Hlc }, esitleme: { recOps } } = require('@havenfold/records')
const Ol = require('@havenfold/events')
const { Emitter } = require('./api')

const hex = (b) => (typeof b === 'string' ? b : b4a.toString(b, 'hex'))
function fail (code) { throw new Error(code) }

const ANAHTAR = 'misafir/biraktiklarim'
const MAX_LISTE = 500

class GuestWriteApi extends Emitter {
  // kimlik: misafirin kimliği ({ memberId, signKeyPair }). gorunum: guestView.acceptGuestView sonucu. katalog: ürün
  // türlerinin kayıtlı olduğu Ol.tur.Katalog. saklama: { get(k), set(k, v) } kalıcı küçük durum; verilmezse bellekte.
  // hlc: kayıt saati (Hlc; kalıcı olması çağıranın işi)
  constructor ({ kimlik, gorunum, katalog = new Ol.tur.Katalog(), saklama = null, now = Date.now, hlc = new Hlc() }) {
    super()
    if (!kimlik || !gorunum) fail('INVALID_BODY')
    this.me = kimlik
    this.gv = gorunum
    this.katalog = katalog
    this.now = now
    this.hlc = hlc
    const m = new Map()
    this.saklama = saklama || { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v) }
  }

  // Yeni GUEST_VIEW kabul edilince (yenilenen dropKey ve değişen izinler bundan sonra geçerli)
  updateView (gorunum) { this.gv = gorunum }

  // İzinli koleksiyonlar: [{ collectionId, types, subjects }] (düzey 2.3'ten önce ya da izin yoksa boş)
  permissions () { return this.gv.drops.map((d) => ({ collectionId: d.collectionId, types: [...d.types], subjects: [...d.subjects] })) }

  // alanlar: { t?, subj, conf?, ...ürün alanları }. Dönüş: { opId, recordId, mesaj: { type: REC_OPS, bytes } }
  drop (collectionId, tur, alanlar) {
    const { t = this.now(), subj, conf, ...urun } = alanlar || {}
    const f = Ol.olay.olayAlanlari(this.katalog, tur, { t, subj, conf }, urun)
    const fields = Object.entries(f).map(([name, value]) => ({ name, value }))
    const b = birakmaHazirla({ gv: this.gv, signer: this.me, collectionId: hex(collectionId), type: tur, fields, hlc: this.hlc.next(this.now()) })
    const kayit = { opId: hex(b.opId), recordId: hex(b.recordId), collectionId: hex(collectionId), type: tur, t, subj, alanlar: urun, zaman: this.now() }
    this.saklama.set(ANAHTAR, [kayit, ...this.myDrops()].slice(0, MAX_LISTE))
    this.emit('dropped', kayit)
    return { opId: kayit.opId, recordId: kayit.recordId, mesaj: { type: Z.REC_OPS, bytes: c.encode(recOps, { items: [{ kind: 1, bytes: b.bytes }] }) } }
  }

  // Bakıcının SOS'u (RFC-0031 §4.1): Tüm Aile'ye hf.sos, özne grant:<kendisi>; ayrı izin gerekmez (düzey 2.3 ve Tüm
  // Aile'de bırakma anahtarı olmalı). o: { yol?: 'dugme' | 'afet', konum?: { latE5, lonE5, accM, at }, metin?, pil?,
  // afetMid? (16 bayt ya da hex), t? }. Zorlama PIN'i ve sessiz SOS misafirde yoktur. Dönüş: birak() ile aynı.
  sos (o = {}) {
    const subj = 'grant:' + hex(this.me.memberId)
    const satir = this.gv.drops.find((d) => d.types.includes('hf.sos') && d.subjects.includes(subj))
    if (!satir) fail('NOT_PERMITTED')
    const { yol, konum, metin, pil, afetMid, t } = o
    if (yol !== undefined && yol !== 'dugme' && yol !== 'afet') fail('INVALID_FIELD_VALUE')
    const alanlar = { subj, ...(t !== undefined ? { t } : {}) }
    if (yol !== undefined) alanlar.yol = yol
    if (konum) alanlar.konum = [konum.latE5, konum.lonE5, konum.accM, konum.at]
    if (metin !== undefined) alanlar.metin = metin
    if (pil !== undefined) alanlar.pil = pil
    if (afetMid !== undefined) alanlar.afet_mid = typeof afetMid === 'string' ? b4a.from(afetMid, 'hex') : afetMid
    const hata = Ol.sos.sosHatasi({ fields: alanlar, tf: { ...alanlar, _subj: subj }, yazar: 'misafir', authorHex: hex(this.me.memberId) })
    if (hata) fail(hata)
    return this.drop(satir.collectionId, 'hf.sos', alanlar)
  }

  // "Senin yazdıkların": bu telefondan bırakılanlar, yeniden eskiye (tam kayıt)
  myDrops ({ collectionId = null, limit = Infinity } = {}) {
    const l = this.saklama.get(ANAHTAR) || []
    return l.filter((x) => !collectionId || x.collectionId === hex(collectionId)).slice(0, limit)
  }

  // Komut 413 GUEST_MY_WRITES (RFC-0030 §8.1): [{ recordId, type, subj, at }]; at olayın anı (_t)
  myWrites ({ collectionId = null } = {}) {
    return this.myDrops({ collectionId }).map((x) => ({ recordId: x.recordId, type: x.type, subj: x.subj, at: x.t }))
  }
}

module.exports = { GuestWriteApi }
