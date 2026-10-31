// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// worker.js — işçi motoru: sürekli görevin içinde yalnız kural (RFC-0006 §12)
//
// İşçi olaylar koleksiyonunu okuyamaz; yalnız kendi ürettiği olayları, bellekte ve en çok 1440 dakika tutar. Telefon
// kuralları (recordId'leriyle) ve öznenin sorumlu listesini görev parametresine koyar. Tetiklenince hf.vaka ve ilk
// basamağı REC_DROP ile bırakır, kitleye VAKA_UYANDIR gönderir; sonraki basamakları kendi saatine göre yazar ve
// VAKA_DUR alınca durur. Görev bitince her şey silinir. Kayıtları mühürlemek ve zarfı göndermek çağıranın işidir.
const b4a = require('b4a')
const Kr = require('./rule')
const V = require('./case')
const M = require('./escalation')

const hex = (b) => (typeof b === 'string' ? b : b4a.toString(b, 'hex'))
const PENCERE_MS = 1440 * 60_000

class IsciMotoru {
  // kurallar: [{ recordId, fields, tf, stamp }] (görev parametresindeki hf.kural kayıtları; biçim 2 değerlendirilmez,
  // RFC-0032 §5.5: işçi kapatan olayı göremez). sorumlu: subj → ['uye:…'].
  // sessiz, utcDk: görev parametresindeki sessiz saatler (RFC-0019 §11.5 f); işçi bunlara uyar.
  constructor ({ ledger, collectionId, kurallar = [], sorumlu = {}, sessiz = null, utcDk = 180, now = Date.now }) {
    this.sessiz = sessiz
    this.utcDk = utcDk
    this.L = ledger
    this.cid = b4a.from(hex(collectionId), 'hex')
    this.col = ledger.collections.get(hex(collectionId))
    this.kurallar = kurallar.map(Kr.kuralTanimi).filter((k) => k && k.eylem === 'vaka' && k.bicim !== 2).map((k) => (k.subj === '*' ? k : { ...k, subj: this._ozne(k.subj) }))
    this.sorumluKart = sorumlu
    this.now = now
    this.olaylar = []
    this.vakalar = new Map() // vakaHex → durum
  }

  _sorumlu (subj) { return M.sorumluListesi(this.L, this.col, this.sorumluKart[subj] || null) }

  // uye: özneleri kişiye çözülür (motor.ozneNormal ile aynı; inceleme olay 14)
  _ozne (subj) {
    if (typeof subj !== 'string' || !subj.startsWith('uye:')) return subj
    const id = this.L.resolveMember(subj.slice(4))
    return id ? 'uye:' + id : subj
  }

  _ac (k, t) {
    const { ilk, son } = V.basamaklar(k.onem, k.hizmet)
    const alanlar = V.vakaAlanlari({
      collectionId: this.cid, kaynak: 'kural:' + k.id, subj: t.subj, yon: 0, onem: k.onem, ilk, son,
      pencereBasi: t.pencereBasi, pencereSonu: t.pencereSonu, t: this.now(), deger: t.deger, olaylar: t.katki.map((e) => e.recordId)
    })
    const v = hex(alanlar.vaka)
    if (this.vakalar.has(v)) return []
    const d = { vaka: v, subj: t.subj, onem: k.onem, ilk, son, t: alanlar._t, sorumlu: this._sorumlu(t.subj), ulasilan: null, basamakAni: {}, sureler: k.sureler, sahipli: false, kapali: false, bastirilmis: false, kural: k }
    this.vakalar.set(v, d)
    const out = [{ eylem: 'yaz', tur: 'hf.vaka', alanlar }]
    out.push(...this._basamak(d, ilk, 0, d.t))
    if (k.onem === 3) out.push(...this._basamak(d, 3, 0, d.t))
    return out
  }

  _basamak (d, b, s, t) {
    d.ulasilan = [b, s]
    d.basamakAni[b + ',' + s] = t
    const okuyucular = M.okuyucuKisiler(this.L, this.col)
    const kitle = M.kitle(b, s, { sorumlu: d.sorumlu, okuyucular })
    return [
      { eylem: 'yaz', tur: 'hf.vaka.basamak', alanlar: V.basamakAlanlari(b4a.from(d.vaka, 'hex'), b, s, t) },
      // kitle: kişiler; kimlikler: zarfın gideceği bütün aktif kimlikleri (RFC-0017 §9)
      { eylem: 'uyandir', vaka: d.vaka, basamak: b, sira: s, onem: d.onem, kitle, kimlikler: M.kimlikler(this.L, kitle) }
    ]
  }

  // Kendi ürettiği olay (olay.olayOf biçiminde, sayılır)
  olay (e) {
    e = { ...e, subj: this._ozne(e.subj) }
    const now = this.now()
    this.olaylar = this.olaylar.filter((x) => x.t >= now - PENCERE_MS)
    this.olaylar.push(e)
    const out = []
    for (const k of this.kurallar) {
      if (!Kr.turleri(k).includes(e.type)) continue
      for (const t of Kr.tetikler(k, this.olaylar.filter((x) => x.subj === e.subj), null)) {
        if (t.T === e.t + 1) out.push(...this._ac(k, t))
      }
    }
    return out
  }

  // Zamanla: yok koşulları ve sonraki basamaklar
  tick () {
    const now = this.now()
    this.olaylar = this.olaylar.filter((x) => x.t >= now - PENCERE_MS)
    const out = []
    for (const k of this.kurallar) {
      if (!k.kosullar.some((x) => x.olcu === 'yok') || k.subj === '*') continue
      for (const t of Kr.tetikler(k, this.olaylar, now)) if (t.T === now) out.push(...this._ac(k, t))
    }
    for (const d of this.vakalar.values()) {
      const x = M.sonrakiYazim(d, { sureler: d.sureler, sessiz: this.sessiz, utcDk: this.utcDk, sessizDisi: !!d.kural.sessiz_disi })
      if (x && x.zaman <= now) out.push(...this._basamak(d, x.basamak, x.sira, now))
    }
    return out
  }

  // VAKA_DUR alındı (zarf.UyandirmaKapisi.dur ile doğrulanmış)
  dur (vakaHex) {
    const d = this.vakalar.get(hex(vakaHex))
    if (d) d.sahipli = true
  }

  // Görev bitti ya da iptal edildi: kural durumu silinir
  bitir () {
    this.olaylar = []
    this.vakalar.clear()
  }
}

module.exports = { IsciMotoru, PENCERE_MS }
