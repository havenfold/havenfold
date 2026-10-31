// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// guest-synchronizer.js — misafir (bakıcı) telefonunun eşitlemesi (RFC-0019 §11.3, RFC-0030; D99)
//
// Misafirin defteri yoktur; yalnız ebeveynin imzaladığı görünüm (GUEST_VIEW) vardır. Oturumlar görünümdeki aile
// üyeleriyledir (taşıyıcı misafiri arayan taraf yapar). Giden: mühürlü bırakmalar (REC_OPS; GuestWriteApi.drop),
// açık her üye oturumuna; açık oturum yoksa kalıcı kuyrukta bekler. Gelen: güncel GUEST_VIEW (izinler, bırakma
// anahtarları, süre) ve GUEST_REVOKED (misafirlik bitti). Başka tür oturum süzgecinde (giris) atılır.
//
// Kuyruk (açılış öncesi inceleme): sokete yazmak teslim sayılmaz. Bırakma KUYRUK_MS boyunca kuyrukta kalır ve her yeni
// üye oturumuna bir kez gider (işlemler kimlikleriyle tekrar edilebilir: aynı işlem iki kez uygulanmaz). Kuyruk dolarsa
// en eski bırakma atılır ve uygulamaya { durum: 'kuyruk-tasti', atilan } bildirilir. Aynı GUEST_VIEW'in tekrarı yok
// sayılır (durum yazılmaz).
'use strict'
const b4a = require('b4a')
const { giris, zarf: { Z } } = require('@havenfold/core')

const hex = (b) => (typeof b === 'string' ? b : b4a.toString(b, 'hex'))
const KUYRUK_EN_COK = 256
const KUYRUK_MS = 72 * 3_600_000

class MisafirEsitleyici {
  // kalici: Kalici (nesneler.misafir misafir kipinde dolu); ag: { gonder(peerHex, type, bytes) }; olay(ad, veri): uygulamaya
  constructor ({ kalici, ag, degisti = () => {}, hata = () => {}, olay = () => {} }) {
    this.kalici = kalici
    this.ag = ag
    this.degisti = degisti
    this.hata = hata
    this.olay = olay
    this.acik = new Set()
    this.gonderilen = new Map() // peerHex → bu oturumda gönderilen bırakmalar (hex)
  }

  // İptal ya da süre doldu (Kalici.misafirBitti)
  _bitti () { return typeof this.kalici.misafirBitti === 'function' ? !!this.kalici.misafirBitti() : !!(this.m && this.m.iptal) }

  _simdi () { return typeof this.kalici.now === 'function' ? this.kalici.now() : Date.now() }

  get m () { return this.kalici.nesneler.misafir }
  _uye (p) { const m = this.m; return !!m && m.ledger.sessionRole(p) === 'uye' }

  baglandi (peerHex) {
    if (!this.m) return
    this.acik.add(hex(peerHex))
    this.bosalt()
  }

  koptu (peerHex) { this.acik.delete(hex(peerHex)); this.gonderilen.delete(hex(peerHex)) }

  // Kuyruk öğesi { b: hex, t } (eski biçim: yalnız hex); süresi geçenler düşer
  _kuyruk () {
    const m = this.m
    const simdi = this._simdi()
    return ((m && m.saklama.get('kuyruk')) || []).map((x) => (typeof x === 'string' ? { b: x, t: simdi } : x)).filter((x) => x && typeof x.b === 'string' && simdi - x.t < KUYRUK_MS)
  }

  // mesaj: { type: REC_OPS, bytes } (GuestWriteApi.drop sonucu). Dönüş: en az bir üyeye gitti mi
  gonder (mesaj) {
    const m = this.m
    if (!m) throw new Error('NOT_GUEST')
    if (this._bitti()) throw new Error('GUEST_ACCESS_ENDED')
    if (!mesaj || mesaj.type !== Z.REC_OPS || !(mesaj.bytes instanceof Uint8Array)) throw new Error('INVALID_BODY')
    const tum = [...this._kuyruk(), { b: hex(mesaj.bytes), t: this._simdi() }]
    const atilan = Math.max(0, tum.length - KUYRUK_EN_COK)
    m.saklama.set('kuyruk', tum.slice(-KUYRUK_EN_COK))
    this.degisti()
    if (atilan) this.olay('guest', { durum: 'kuyruk-tasti', atilan })
    return this.bosalt() > 0
  }

  // Kuyruktaki bırakmaları açık üye oturumlarına yollar; her bırakma bir oturuma bir kez. Kuyruktan çıkmaz (süreyle
  // düşer). Dönüş: bu çağrıda en az bir üyeye giden bırakma sayısı
  bosalt () {
    const m = this.m
    if (!m || this._bitti()) return 0
    const hedef = [...this.acik].filter((p) => this._uye(p))
    if (!hedef.length) return 0
    const kuyruk = this._kuyruk()
    let giden = 0
    for (const x of kuyruk) {
      let gitti = false
      for (const p of hedef) {
        if (!this.gonderilen.has(p)) this.gonderilen.set(p, new Set())
        const g = this.gonderilen.get(p)
        if (g.has(x.b)) continue
        try { if (this.ag.gonder(p, Z.REC_OPS, b4a.from(x.b, 'hex')) !== false) { g.add(x.b); gitti = true } } catch (err) { this.hata(err) }
      }
      if (gitti) giden++
    }
    m.saklama.set('kuyruk', kuyruk) // süresi geçenler düşmüş hâliyle
    return giden
  }

  al (peerHex, type, bytes, yol = 'dogrudan') {
    const m = this.m
    if (!m) return { hata: 'NOT_GUEST' }
    const p = hex(peerHex)
    const onceki = this.kalici._misafir
    if (type === Z.GUEST_VIEW && onceki && b4a.isBuffer(bytes) && b4a.equals(onceki.bayt, bytes)) return { hata: null } // tekrar
    try {
      giris.gelenZarf({ myRole: 'misafir', peerRole: m.ledger.sessionRole(p), type, bytes, yol })
      if (type === Z.GUEST_VIEW) {
        this.kalici.misafirBagla(bytes)
        this.olay('guest', { durum: 'gorunum' })
      } else if (type === Z.GUEST_REVOKED) {
        const r = this.kalici.misafirIptal(bytes)
        this.olay('guest', { durum: 'bitti', neden: r.neden })
      }
      return { hata: null }
    } catch (err) {
      if (!err || err.message !== 'TYPE_NOT_ALLOWED') this.hata(err)
      return { hata: (err && err.message) || 'INTERNAL_ERROR' }
    } finally {
      this.degisti()
    }
  }
}

module.exports = { MisafirEsitleyici }
