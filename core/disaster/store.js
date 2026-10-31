// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// store.js — sakla-ilet deposu (RFC-0012 §8.3): taşınan mesajlar, kendi giden mesajları, teslim bilgileri, görülen mid'ler,
// gelen kutusu. Taşıyıcı deposu en çok 1000 mesaj ve 512 KB; dolunca atma sırası: süresi geçen → teslim edilen → en eski
// ALINDI → METİN → İYİYİM → UYARI; SOS ancak depo yalnız SOS'la doluysa, en eskiden. Kendi giden mesajları ayrıdır: teslim edilmeyen süre
// dolana kadar, teslim edilen teslimden sonra 7 gün durur (gönderen alındıyı görsün; Codex 6. tur). Kalıcılık: `saklama` ({ get, set }) verilirse değişiklikler aynı turun sonunda tek yazımla
// yazılır (kaydet() hemen yazar). `saklama` Hat katmanının şifreli deposu olmalıdır: gelen kutusunun açık metnini ve çift
// sırrından türeyen doneSecret'ları tutar. Gelen kutusu 7 günden eski ve 1000'i aşan kayıtları budar (inceleme 21 B11).
const b4a = require('b4a')
const T = require('./derivation')
const M = require('./message')

const hex = (b) => b4a.toString(b, 'hex')
const unhex = (s) => b4a.from(s, 'hex')
const SINIR = { adet: 1000, bayt: 512 * 1024, teslimGun: 7, gorulenGun: 7, gelenGun: 7, gelen: 1000 }
// Atma sırası: önce ALINDI (prio 4), METİN (3), İYİYİM (2), UYARI (1); SOS (0) en son
const ATMA = [4, 3, 2, 1, 0]
const ANAHTAR = 'afet/depo'

class Depo {
  constructor ({ saklama = null, sinir = SINIR } = {}) {
    this.saklama = saklama
    this.sinir = sinir
    this.tasinan = new Map() // midHex → { m, boy, sira, kaynak (komşu kimliği hex) }
    this.giden = new Map() // midHex → { m, doneSecret, to (hex), kind, at, teslim, teslimGun, normal (§8.4 normal yola verildi) }
    this.teslim = new Map() // midHex → { doneSecret, gun, kaynak }
    this.gorulen = new Map() // midHex → gün
    this.gelen = [] // { mid (hex), ic, gun, dogrudan (gönderenden doğrudan mı, taşıyıcıyla mı) }
    this.sira = 0
    this.surum = 0 // her değişiklikte artar; yeniden eşitleme kararı için (§9.2)
    if (saklama) this._yukle()
  }

  bilir (midHex) { return this.tasinan.has(midHex) || this.giden.has(midHex) || this.teslim.has(midHex) || this.gorulen.has(midHex) }
  boy () { let n = 0; for (const x of this.tasinan.values()) n += x.boy; return n }

  /** Taşınacak mesajı ekle; depo doluysa sırayla at. Dönüş: atılan mid'ler (hex) */
  tasi (m, bugun, kaynak = null) {
    const k = hex(m.mid)
    if (this.bilir(k)) return []
    const boy = M.kodla(M.Z.AFET_MSG, m).byteLength
    this.tasinan.set(k, { m, boy, sira: ++this.sira, kaynak })
    const atilan = this._sigdir(bugun)
    this._degisti()
    return atilan
  }

  _sigdir (bugun) {
    const atilan = []
    const dolu = () => this.tasinan.size > this.sinir.adet || this.boy() > this.sinir.bayt
    const at = (k) => { this.tasinan.delete(k); atilan.push(k) }
    const sirayla = (suz) => [...this.tasinan].filter(([k, x]) => suz(k, x)).sort((a, b) => a[1].sira - b[1].sira)
    const adimlar = [(k, x) => x.m.expiresDay < bugun, (k) => this.teslim.has(k), ...ATMA.map((p) => (k, x) => x.m.prio === p)]
    for (const suz of adimlar) {
      for (const [k] of sirayla(suz)) { if (!dolu()) return atilan; at(k) }
    }
    return atilan
  }

  /** Taşınan ve kendi giden mesajlar; süresi geçmemiş, teslim edilmemiş, önceliğe göre (§8.2 madde 5) */
  sunulacak (bugun) {
    const liste = []
    for (const [k, x] of this.giden) if (!x.teslim && x.m.expiresDay >= bugun) liste.push({ k, m: x.m, kendi: true, to: x.to })
    for (const [k, x] of this.tasinan) if (x.m.expiresDay >= bugun) liste.push({ k, m: x.m, kendi: false, kaynak: x.kaynak })
    return liste.sort((a, b) => a.m.prio - b.m.prio)
  }

  al (midHex) { return (this.giden.get(midHex) ?? this.tasinan.get(midHex))?.m ?? null }

  // --- kendi giden ---
  gidenEkle (m, doneSecret, bilgi) {
    this.giden.set(hex(m.mid), { m, doneSecret, teslim: false, ...bilgi })
    this._degisti()
  }

  /** Kendi giden mesajım teslim edildi (AFET_DONE ya da alıcının ALINDI'sı): teslim günüyle */
  gidenTeslim (midHex, bugun) {
    const g = this.giden.get(midHex)
    if (!g || g.teslim) return
    g.teslim = true
    g.teslimGun = bugun
    this._degisti()
  }

  /** AFET_DONE öğesi: doneSecret'ın özeti tutan mesajı siler; tutmayan ya da bilinmeyen yok sayılır. Dönüş: tuttu mu */
  teslimEt (mid, doneSecret, bugun) {
    const k = hex(mid)
    const t = this.tasinan.get(k)
    const g = this.giden.get(k)
    const m = (t ?? g)?.m
    if (!m || !b4a.equals(T.doneHash(doneSecret), m.doneHash)) return false
    this.tasinan.delete(k)
    if (g && !g.teslim) { g.teslim = true; g.teslimGun = bugun }
    this.teslim.set(k, { doneSecret, gun: bugun, kaynak: t?.kaynak ?? null })
    this._degisti()
    return true
  }

  /** Alıcı olarak: açtığım mesajın doneSecret'ı yayılmak üzere saklanır, gelen kutusuna girer */
  aldim (mid, doneSecret, ic, bugun, kaynak = null, dogrudan = false) {
    const k = hex(mid)
    this.tasinan.delete(k)
    this.teslim.set(k, { doneSecret, gun: bugun, kaynak })
    this.gorulen.set(k, bugun)
    this.gelen.push({ mid: k, ic, gun: bugun, dogrudan })
    if (this.gelen.length > this.sinir.gelen) this.gelen.splice(0, this.gelen.length - this.sinir.gelen)
    this._degisti()
  }

  /** Süresi geçenleri ve 7 günden eski teslim ve görülen kayıtlarını at */
  temizle (bugun) {
    for (const [k, x] of [...this.tasinan]) if (x.m.expiresDay < bugun) this.tasinan.delete(k)
    for (const [k, x] of [...this.giden]) {
      // Eski biçimden (teslim günü yok) gelen teslim: ilk temizlik günü teslim günü sayılır ve yazılır (sonlu göç)
      if (x.teslim && !Number.isInteger(x.teslimGun)) x.teslimGun = bugun
      if (x.teslim ? x.teslimGun < bugun - this.sinir.teslimGun : x.m.expiresDay < bugun) this.giden.delete(k)
    }
    for (const [k, x] of [...this.teslim]) if (x.gun < bugun - this.sinir.teslimGun) this.teslim.delete(k)
    for (const [k, g] of [...this.gorulen]) if (g < bugun - this.sinir.gorulenGun) this.gorulen.delete(k)
    this.gelen = this.gelen.filter((x) => x.gun >= bugun - this.sinir.gelenGun)
    this._degisti()
  }

  /** Taşıyıcı deposunu boşalt (komut 319); kendi giden mesajlarına ve gelen kutusuna dokunmaz */
  bosalt () { this.tasinan.clear(); this._degisti() }

  // --- kalıcılık ---
  toJSON () {
    const m = (x) => hex(M.kodla(M.Z.AFET_MSG, x))
    return {
      v: 1,
      sira: this.sira,
      tasinan: [...this.tasinan.values()].map((x) => [m(x.m), x.sira, x.kaynak]),
      giden: [...this.giden.values()].map((x) => ({ ...x, m: m(x.m), doneSecret: hex(x.doneSecret) })),
      teslim: [...this.teslim].map(([k, x]) => [k, hex(x.doneSecret), x.gun, x.kaynak]),
      gorulen: [...this.gorulen],
      gelen: this.gelen.map((x) => ({ mid: x.mid, gun: x.gun, dogrudan: x.dogrudan, ic: hex(M.icKodla(x.ic)) }))
    }
  }

  _degisti () {
    this.surum++
    if (!this.saklama || this._bekliyor) return
    this._bekliyor = true
    queueMicrotask(() => { if (this._bekliyor) this.kaydet() })
  }

  /** Bekleyen değişiklikleri hemen yaz */
  kaydet () {
    this._bekliyor = false
    if (this.saklama) this.saklama.set(ANAHTAR, this.toJSON())
  }

  _yukle () {
    const j = this.saklama.get(ANAHTAR)
    if (!j || j.v !== 1) return
    const m = (s) => M.coz(M.Z.AFET_MSG, unhex(s))
    this.sira = j.sira
    for (const [s, sira, kaynak] of j.tasinan) { const x = m(s); this.tasinan.set(hex(x.mid), { m: x, boy: s.length / 2, sira, kaynak }) }
    for (const x of j.giden) { const g = m(x.m); this.giden.set(hex(g.mid), { ...x, m: g, doneSecret: unhex(x.doneSecret) }) }
    for (const [k, d, gun, kaynak] of j.teslim) this.teslim.set(k, { doneSecret: unhex(d), gun, kaynak })
    for (const [k, g] of j.gorulen) this.gorulen.set(k, g)
    this.gelen = j.gelen.map((x) => ({ mid: x.mid, gun: x.gun, dogrudan: !!x.dogrudan, ic: M.icCoz(unhex(x.ic)) }))
  }
}

module.exports = { Depo, SINIR, ANAHTAR }
