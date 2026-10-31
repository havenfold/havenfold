// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// engine.js — sakla ve ilet (RFC-0012 §8, §9): mesaj gönderme, bağ oturumunda eşitleme (DONE → HAVE → WANT → MSG), taşıma.
// Bağdan bağımsızdır: oturum çerçeve alır ve çerçeve döndürür (çerçeve = tür baytı ‖ gövde). Bağ türü denetimi (§6.3 madde 3)
// ve Noise ile HELLO bağ katmanındadır; buraya yalnız kimliği doğrulanmış aile cihazıyla kurulan oturum gelir.
//
// Oturumun bitişi: her HAVE çerçevesine bir WANT döner (boş da olsa). HAVE en çok 64 öğe taşır; 64'ten az öğeli HAVE son
// çerçevedir (öğe sayısı 64'ün katıysa sona boş HAVE eklenir). Oturum, karşının son HAVE'i geldiğinde, her HAVE'imize WANT
// döndüğünde ve istediğimiz bütün mesajlar geldiğinde biter.
const b4a = require('b4a')
const T = require('./derivation')
const M = require('./message')
const D = require('./audit')
const { Gonderim, Komsular, PIL_ESIK } = require('./limit')

const hex = (b) => b4a.toString(b, 'hex')
const TASIR = ['telefon', 'kutu', 'cihaz'] // §8.1: misafir taşımaz
const ALIR = ['telefon', 'misafir']

const YUKSELT = { adet: 20, bayt: 16 * 1024 } // RFC-0012 §6.1: iki yönde bekleyen 20 mesaj ya da 16 KB aşılınca
const cerceve = (tur, m) => b4a.concat([b4a.from([tur]), M.kodla(tur, m)])

class Motor {
  /**
   * o: { meId (16 B), defter: () => Ledger, ciftler: () => [{ id, pair }], depo: Depo, saat: () => ms, pil?: () => yüzde | null }
   */
  constructor ({ meId, defter, ciftler, depo, saat = Date.now, pil = () => null }) {
    this.meId = meId
    this.defter = defter
    this.ciftler = ciftler
    this.depo = depo
    this.saat = saat
    this.pil = pil
    this.gonderim = new Gonderim()
    this.komsular = new Komsular()
  }

  get tur () { return D.kimlikTuru(this.defter(), hex(this.meId)) }
  bugun () { return T.gunOf(this.saat()) }

  /** Bana gelen mesajların toTag'leri ([bugün − 3, bugün + 1]); alıcı değilsem boş */
  etiketlerim () {
    if (!ALIR.includes(this.tur)) return new Set()
    return new Set(D.etiketler(this.ciftler(), this.meId, this.bugun()).map((x) => hex(x.toTag)))
  }

  /**
   * Mesaj gönder (§7, §9.1). o: { to (16 B), kind, text?, konum?, tam?, ref?, alarm?, battery? }
   * Dönüş: { mid (hex), msg }. Hata: DISASTER_CANNOT_SEND, NO_DISASTER_PAIR, DISASTER_SEND_LIMIT, INVALID_DISASTER_*
   */
  gonder (o, { sinirsiz = false } = {}) {
    const L = this.defter()
    const tur = this.tur
    if (!D.gonderebilir(tur, o.kind)) throw new Error('DISASTER_CANNOT_SEND')
    const toHex = hex(o.to)
    // misafir yalnız üyelerle yazışır (§8.1); kimse aile dışına göndermez
    const aliciTuru = D.kimlikTuru(L, toHex)
    if (!ALIR.includes(aliciTuru) || ((tur === 'misafir' || aliciTuru === 'misafir') && tur !== 'telefon' && aliciTuru !== 'telefon')) throw new Error('DISASTER_CANNOT_SEND')
    const cift = this.ciftler().find((c) => b4a.equals(c.id, o.to))
    if (!cift) throw new Error('NO_DISASTER_PAIR')
    const simdi = this.saat()
    const engel = sinirsiz ? null : this.gonderim.izinOlay(o.kind, [toHex], simdi, o.alarm?.kind)
    if (engel) { const e = new Error(engel.neden); e.bekleMs = engel.bekleMs; throw e }
    const r = M.muhurle({ ...o, pair: cift.pair, from: this.meId, at: simdi, gun: this.bugun() })
    this.depo.gidenEkle(r.msg, r.doneSecret, { to: toHex, kind: o.kind, at: simdi })
    if (!sinirsiz) this.gonderim.kaydetOlay(o.kind, [toHex], simdi, o.alarm?.kind)
    return { mid: hex(r.msg.mid), msg: r.msg }
  }

  /**
   * Aynı mesajı birden çok alıcıya: her alıcı için ayrı mühür; hız sınırı tek gönderim sayılır (§9.1: bir SOS, birçok alıcı).
   * Önce hepsi denetlenir; biri engelliyse hiçbiri gönderilmez. Dönüş: [{ mid, msg }]
   */
  gonderHepsi (alicilar, o) {
    const simdi = this.saat()
    const hexler = alicilar.map(hex)
    const engel = this.gonderim.izinOlay(o.kind, hexler, simdi, o.alarm?.kind)
    if (engel) { const e = new Error(engel.neden); e.bekleMs = engel.bekleMs; throw e }
    const out = alicilar.map((to) => this.gonder({ ...o, to }, { sinirsiz: true }))
    this.gonderim.kaydetOlay(o.kind, hexler, simdi, o.alarm?.kind)
    return out
  }

  oturum (karsiId) { return new Oturum(this, karsiId) }

  /**
   * §8.4 normal yol dönünce: teslim edilmemiş ve süresi geçmemiş kendi mesajları, olağan oturumla ya da emanetle (RFC-0003
   * §6.4 mührüyle) gönderilmek üzere, öncelik sırasıyla (SOS önce). Verilen mesajlar `normal` işaretlenir ve bekleyen
   * sayılmaz; { isaretle: false } işaretlemez: çağıran mesaj kalıcı kuyruğa girince normalIsaretle(mid) der (Codex 7. tur:
   * kuyruğa giremeyen mesaj normal sayılıp afet yolundan da düşmesin). Zarf aynıdır (aynı mid).
   * Dönüş: [{ to (hex), mid (hex), tur: 0xB0, govde }]
   */
  normalYolaVer ({ isaretle = true } = {}) {
    const bugun = this.bugun()
    const out = []
    const liste = [...this.depo.giden].filter(([, x]) => !x.teslim && x.m.expiresDay >= bugun).sort((a, b) => a[1].m.prio - b[1].m.prio || a[1].at - b[1].at)
    for (const [mid, x] of liste) {
      out.push({ to: x.to, mid, tur: M.Z.AFET_MSG, govde: M.kodla(M.Z.AFET_MSG, x.m) })
      if (isaretle) x.normal = true
    }
    if (out.length && isaretle) this.depo._degisti()
    return out
  }

  /** normalYolaVer({ isaretle: false })'un verdiği mesaj normal yolun kalıcı kuyruğuna girdi */
  normalIsaretle (midHex) {
    const x = this.depo.giden.get(midHex)
    if (!x || x.normal) return
    x.normal = true
    this.depo._degisti()
  }

  /**
   * §8.4: olağan oturumdan ya da emanetten gelen AFET_MSG gövdesi. Yalnız bana gelen açılır; başkasınınki atılır (taşıyıcı
   * normal yoldan taşımaz). Alındı bilgisi gönderene yine bir AFET_MSG (ALINDI) olarak döner: normalYolaVer() ile.
   * Dönüş: { gecerli, ic, mid } ya da { gecerli: false, neden }
   */
  normalYoldanAl (govde) {
    let m
    try { m = M.coz(M.Z.AFET_MSG, govde) } catch (e) { return { gecerli: false, neden: e.message } }
    if (!this.etiketlerim().has(hex(m.toTag))) return { gecerli: false, neden: 'NOT_RECIPIENT' }
    const r = this._ac(m, null)
    return r.gecerli ? { gecerli: true, ic: r.ic, mid: hex(m.mid) } : r
  }

  /**
   * §10 adım 3 (kutunun çapa davranışı): aynı evdeki bağlı cihaz (işçi) mühürlediği UYARI'ları olağan yerel oturumla kutuya
   * bırakır; kutu taşıyıcı olarak depolar ve yerel bağlarla dağıtır. Yalnız taşıyıcı (kutu, telefon) ve yalnız aktif bağlı
   * cihazdan; içerik açılmaz (kutu alıcı değildir), öncelik UYARI olmalı. Dönüş: { tasindi, neden? }
   */
  tasimayaAl (govde, kaynakHex) {
    if (!TASIR.includes(this.tur)) return { tasindi: false, neden: 'NOT_CARRIER' }
    if (D.kimlikTuru(this.defter(), kaynakHex) !== 'cihaz') return { tasindi: false, neden: 'INVALID_SOURCE' }
    let m
    try { m = M.coz(M.Z.AFET_MSG, govde) } catch (e) { return { tasindi: false, neden: e.message } }
    if (m.prio !== M.PRIO[M.KIND.UYARI]) return { tasindi: false, neden: 'INVALID_PRIORITY' }
    const bugun = this.bugun()
    if (m.hops > M.SINIR.hops || m.expiresDay > bugun + M.SINIR.sure + 1 || m.expiresDay < bugun) return { tasindi: false, neden: 'LIMIT_REACHED' }
    if (this.depo.bilir(hex(m.mid))) return { tasindi: false, neden: 'REPLAY' }
    // §9.2 komşu kotası bu yolda da (inceleme 24 madde 3)
    if (!this.komsular.kabulEt(kaynakHex, this.saat())) return { tasindi: false, neden: 'KOTA' }
    this.depo.tasi(m, bugun, kaynakHex)
    return { tasindi: true }
  }

  /** Bana gelen mesajı denetle ve gelen kutusuna al; ALINDI mühürle; ALINDI ise kendi gidenimi teslim say */
  _ac (m, karsi, karsiTuru = null) {
    const bugun = this.bugun()
    const r = D.alici({ msg: m, ciftler: this.ciftler(), meId: this.meId, L: this.defter(), bugun, gorulen: this.depo.gorulen })
    if (!r.gecerli) return r
    const ds = T.doneSecret(T.afetKey(r.cift.pair), m.mid)
    const dogrudan = karsi == null || hex(r.ic.from) === karsi
    // Misafirin mesajının teslim bilgisi misafire de gider (§8.1): kaynak gönderen misafirdir, kimin getirdiği değil (B12)
    const gonderenMisafir = D.kimlikTuru(this.defter(), hex(r.ic.from)) === 'misafir'
    this.depo.aldim(m.mid, ds, r.ic, bugun, gonderenMisafir ? hex(r.ic.from) : (karsiTuru === 'misafir' ? karsi : null), dogrudan)
    if (r.ic.kind === M.KIND.ALINDI) {
      const g = this.depo.giden.get(hex(r.ic.ref))
      if (g && b4a.equals(r.ic.from, b4a.from(g.to, 'hex'))) this.depo.gidenTeslim(hex(r.ic.ref), bugun)
    } else if (ALIR.includes(D.kimlikTuru(this.defter(), hex(r.ic.from)))) {
      // Alındı bilgisi gönderene ayrı bir mesajla gider (alıcı olmayan işçi ve uca değil: onlara yalnız DONE)
      try { this.gonder({ to: r.ic.from, kind: M.KIND.ALINDI, ref: m.mid }, { sinirsiz: true }) } catch {}
    }
    return { gecerli: true, ic: r.ic, ds }
  }

  esitlemeGerekli (karsiId) { return this.komsular.esitlemeGerekli(hex(karsiId), this.depo.surum, this.saat()) }
}

class Oturum {
  constructor (motor, karsiId) {
    this.motor = motor
    this.karsi = hex(karsiId)
    this.karsiTuru = D.kimlikTuru(motor.defter(), this.karsi)
    if (!this.karsiTuru) throw new Error('DISASTER_NOT_IN_FAMILY')
    this.sunulan = new Map() // midHex → m
    this.istenen = new Set()
    this.bekleyenWant = 0
    this.karsiHaveBitti = false
    this.basladi = false
    this.alinan = [] // bu oturumda gelen kutusuna düşenler
    this.bitti = false
    // Yükseltme kararı (RFC-0012 §6.5): iki yönde bekleyen mesaj sayısı ve bildiğimiz bayt (karşının mesaj boyları HAVE'de
    // yok; yalnız sayısı)
    this.giden = { adet: 0, bayt: 0 }
    this.gelecek = 0
  }

  /** İki yönde bekleyen veri 16 KB'ı ya da 20 mesajı aştı mı (Wi-Fi Direct ve Multipeer yükseltmesi, §6.5) */
  yukseltmeGerekli () {
    return this.giden.adet + this.gelecek > YUKSELT.adet || this.giden.bayt > YUKSELT.bayt
  }

  /** Oturumun ilk çerçeveleri: DONE (varsa), sonra HAVE */
  basla () {
    this.basladi = true
    const { depo } = this.motor
    const bugun = this.motor.bugun()
    const out = []
    const misafir = this.karsiTuru === 'misafir'
    // Misafire yalnız onun bıraktığı mesajların teslim bilgisi gider (§8.1: ailenin trafiğini görmez)
    const done = [...depo.teslim].filter(([, x]) => !misafir || x.kaynak === this.karsi).map(([k, x]) => ({ mid: b4a.from(k, 'hex'), doneSecret: x.doneSecret }))
    if (done.length) out.push(cerceve(M.Z.AFET_DONE, { items: done }))
    // Misafire yalnız kendi yazdığımız ve ona giden mesajlar sunulur
    const liste = depo.sunulacak(bugun).filter((x) => (misafir ? x.kendi && x.to === this.karsi : x.kaynak !== this.karsi))
    for (const x of liste) this.sunulan.set(x.k, x.m)
    const items = liste.map((x) => ({ mid: x.m.mid, toTag: x.m.toTag, prio: x.m.prio, hops: x.m.hops }))
    for (let i = 0; i <= items.length; i += M.SINIR.have) {
      out.push(cerceve(M.Z.AFET_HAVE, { items: items.slice(i, i + M.SINIR.have) }))
      this.bekleyenWant++
    }
    return out
  }

  /** Gelen çerçeveyi işle; dönüş: gönderilecek çerçeveler. Hata fırlarsa bağ katmanı oturumu kapatır */
  al (buf) {
    if (!buf || buf.byteLength < 1) throw new Error('DISASTER_CORRUPT')
    const tur = buf[0]
    const m = M.coz(tur, buf.subarray(1))
    const out = this._isle(tur, m)
    this._bittiMi()
    return out
  }

  _isle (tur, m) {
    const mo = this.motor
    const bugun = mo.bugun()
    if (tur === M.Z.AFET_DONE) {
      for (const x of m.items) mo.depo.teslimEt(x.mid, x.doneSecret, bugun)
      return []
    }
    if (tur === M.Z.AFET_HAVE) {
      if (m.items.length < M.SINIR.have) this.karsiHaveBitti = true
      const mids = this._iste(m.items, bugun)
      for (const x of mids) this.istenen.add(hex(x))
      this.gelecek += mids.length
      return [cerceve(M.Z.AFET_WANT, { mids })]
    }
    if (tur === M.Z.AFET_WANT) {
      this.bekleyenWant = Math.max(0, this.bekleyenWant - 1)
      const gidecek = m.mids.map((x) => this.sunulan.get(hex(x))).filter(Boolean).sort((a, b) => a.prio - b.prio)
      // Yayılan kopyada hops bir azalır (§8.2 madde 4)
      const out = gidecek.map((x) => cerceve(M.Z.AFET_MSG, { ...x, hops: Math.max(0, x.hops - 1) }))
      this.giden.adet += out.length
      for (const b of out) this.giden.bayt += b.byteLength
      return out
    }
    if (tur === M.Z.AFET_MSG) return this._mesaj(m, bugun)
    return [] // AFET_TAGS ve AFET_LINK_UP bağ katmanının işidir
  }

  // §8.2 madde 3: kendi etiketimse her zaman; taşıyıcıysam hops > 0 ve bende yoksa. Komşu kotası ve pil kuralı (§9.2, §9.3)
  _iste (items, bugun) {
    const mo = this.motor
    const benim = mo.etiketlerim()
    const tasir = TASIR.includes(mo.tur)
    const pil = mo.pil()
    let kota = mo.komsular.kalan(this.karsi, mo.saat())
    const out = []
    for (const x of [...items].sort((a, b) => a.prio - b.prio)) {
      const k = hex(x.mid)
      if (mo.depo.bilir(k) || this.istenen.has(k)) continue
      if (benim.has(hex(x.toTag))) { out.push(x.mid); continue }
      if (!tasir || x.hops === 0 || x.hops > M.SINIR.hops || kota === 0) continue
      if (pil != null && pil < PIL_ESIK && x.prio > M.PRIO[M.KIND.IYIYIM]) continue
      out.push(x.mid)
      kota--
    }
    return out
  }

  _mesaj (m, bugun) {
    const mo = this.motor
    const k = hex(m.mid)
    if (!this.istenen.delete(k)) return [] // istenmeyen mesaj atılır
    if (mo.etiketlerim().has(hex(m.toTag))) {
      const r = mo._ac(m, this.karsi, this.karsiTuru)
      if (!r.gecerli) return []
      this.alinan.push({ mid: k, ic: r.ic })
      // Teslim bilgisi aynı oturumda (§8.2)
      return [cerceve(M.Z.AFET_DONE, { items: [{ mid: m.mid, doneSecret: r.ds }] })]
    }
    // §9.2 (inceleme 21 B9): hops AD'de olmadığı için taşıyıcı sınırları kendisi uygular. expiresDay gönderenin gün + 3'ü;
    // gönderenin günü alıcı penceresindeki gibi en çok bugün + 1 olabilir
    if (m.hops > M.SINIR.hops || m.expiresDay > bugun + M.SINIR.sure + 1 || m.expiresDay < bugun) return []
    if (!TASIR.includes(mo.tur) || !mo.komsular.kabulEt(this.karsi, mo.saat())) return []
    mo.depo.tasi(m, bugun, this.karsi)
    return []
  }

  _bittiMi () {
    if (this.bitti || !this.basladi || !this.karsiHaveBitti || this.bekleyenWant > 0 || this.istenen.size > 0) return
    this.bitti = true
    this.motor.komsular.esitlendi(this.karsi, this.motor.depo.surum, this.motor.saat())
  }
}

module.exports = { Motor, Oturum, cerceve, TASIR, ALIR }
