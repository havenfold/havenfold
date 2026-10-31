// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// edge.js — ucun kendi durumu (RFC-0008 §11.4–§11.6, açıklama 1; inceleme L1 U1, U2, U4, U6, U10)
//
// Uç modundaki cihazın (Android uç, iOS ekran) çekirdek tarafı tek yerde:
//  - Sıra numaraları kalıcı ve monotondur (madde 2): NODE_PROFILE ve UC_STATUS seq'leri ve son kabul edilen yapılandırma
//    saklamada durur, yeniden başlayınca kaldığı yerden artar. Saklanan yapılandırma açılışta yeniden denetlenip geri
//    yüklenir; kabul edilmiş en büyük (seq, özet) taban olarak kalır, ondan eskisi bir daha kazanamaz.
//  - Görünür izleme zorunludur (madde 1): akış açılınca, kapanınca ya da yapılandırma değişince durum "eski" olur ve
//    güncel UC_STATUS üretilmeden hiçbir kare mühürlenemez (muhurlenebilir).
//  - Akış ömrü sürekli denetlenir (madde 4): denetle() pencere, ısı, pil, 24 saat ve defter değişimini (izleyici çıktı ya
//    da rolü değişti, işçi ayrıldı) her çağrıda yeniden sorar; yapılandırmayı imzalayan ebeveyn defterden çıktıysa
//    yapılandırma geçersizdir ve uç 'kapali'ya geçer.
//  - Aynı streamId ikinci kez açılamaz (madde 7); kameranın açılış anı (since) kamera açık kaldıkça sabittir.
//  - Ekran modu (§11.8, adım 9): kartlar yalnız bellekte (yeniden başlayınca silinir), gönderen başına seq tabanı kalıcıdır
//    (eski zarf bir daha kabul edilmez). Yapılandırma ya da defter değişince screenFrom'a artık uymayanın kartları düşer.
//  - Sensör modu (§11.7, adım 9, açıklama 2): olay yalnız `sensor` modunda, listedeki sensörden, pencerede, güncel UC_STATUS
//    yayınlandıktan sonra (durum açık sensörleri ve hedefleri taşır; görünürlük kapısı) ve yalnız yapılandırmadaki hedef
//    koleksiyonlara bırakılır; yetki her çağrıda sorulur; tür başına dakikada bir sınırı kalıcıdır.
// Saklama zorunludur: { get(k), set(k, v) } (değer JSON'a çevrilebilir); platform onu kalıcı yapar.
const b4a = require('b4a')
const K = require('./encoding')
const Y = require('./config')
const A = require('./stream')
const E = require('./screen')
const Sn = require('./sensor')

const { hex, fail } = K
const ANAHTAR = 'uc/durum'

class UcDurumu {
  // defter: () → ucun güncel Ledger'ı; me: ucun kimliği; saklama: { get, set }
  constructor ({ defter, me, saklama, now = Date.now }) {
    if (!saklama || typeof saklama.get !== 'function' || typeof saklama.set !== 'function') fail('STORAGE_REQUIRED')
    this.defter = defter
    this.me = me
    this.meHex = hex(me.memberId)
    this.saklama = saklama
    this.now = now
    const j = saklama.get(ANAHTAR)
    this.s = j && j.v === 1 ? { ...j } : { v: 1, profilSeq: 0, durumSeq: 0, yapilandirma: null, taban: null, since: null, yenidenBasladi: false }
    this.s.ekranSeq = { ...(this.s.ekranSeq || {}) } // gönderen → kabul edilmiş en büyük UC_SCREEN_PUSH seq'i
    this.s.sensorSon = { ...(this.s.sensorSon || {}) } // olay türü → son bırakma anı
    this.yapilandirma = null
    this.akislar = new Map() // streamIdHex → { isteyen, purpose, acilma }
    this.kartlar = new Map() // gönderen → { seq, cards } (yalnız bellekte, §11.8)
    this.guncel = false
    // Yeniden başlayınca açık akış yoktur: kamera kapalı başlar
    this.s.since = null
    this._geriYukle()
    this._kaydet()
  }

  get L () { return this.defter() }
  get mod () { return this.yapilandirma ? this.yapilandirma.m.mode : 'kapali' }
  get configSeq () { return this.yapilandirma ? this.yapilandirma.m.seq : 0 }
  get cfg () { return this.yapilandirma ? this.yapilandirma.m : null }

  _kaydet () { this.saklama.set(ANAHTAR, { ...this.s }) }

  // Saklanan yapılandırma yeniden denetlenir: imzacı artık ebeveyn değilse geri yüklenmez (uç 'kapali'); taban kalır
  _geriYukle () {
    if (!this.s.yapilandirma) return
    try { this.yapilandirma = Y.yapilandirmaDenetle(this.L, b4a.from(this.s.yapilandirma, 'hex'), { ucHex: this.meHex }) } catch { this.yapilandirma = null }
  }

  // Taban (kabul edilmiş en büyük seq ve özet) karşısında yeni yapılandırma kazanır mı (§11.4 madde 7)
  _tabaniGecer (y) {
    const t = this.s.taban
    return !t || Y.yeniKazanir({ m: { seq: t.seq }, ozet: b4a.from(t.ozet, 'hex') }, y)
  }

  /** 340: NODE_PROFILE'ın sıradaki seq'i (kalıcı) */
  profilSeq () {
    this.s.profilSeq++
    this._kaydet()
    return this.s.profilSeq
  }

  /**
   * UC_CONFIG: §11.4 tablosu (hata kodu atar); eski ya da kaybeden yapılandırma { kabul: false }. Kabulde uyuşmayan akışlar
   * kapanır: { kabul: true, kapatilan: [{ streamId, code }] }. Durum eskir (configSeq değişti).
   */
  yapilandirmaAl (bytes) {
    const y = Y.yapilandirmaDenetle(this.L, bytes, { ucHex: this.meHex })
    if (!this._tabaniGecer(y)) return { kabul: false, kapatilan: [] }
    this.yapilandirma = y
    this.s.yapilandirma = hex(bytes)
    this.s.taban = { seq: y.m.seq, ozet: hex(y.ozet) }
    const kapatilan = []
    for (const [id, a] of this.akislar) {
      if (y.m.mode !== 'kamera' || !A.hedefUyar(y.m, { ...a.isteyen, purpose: a.purpose })) kapatilan.push({ streamId: id, code: 'YAPILANDIRMA_DEGISTI' })
    }
    for (const k of kapatilan) this._birak(k.streamId)
    this._kartlariSuz()
    this.guncel = false
    this._kaydet()
    return { kabul: true, kapatilan }
  }

  // Açıklama 1 madde 4, açıklama 2 madde 3: yapılandırmayı imzalayan ebeveyn defterden çıktıysa (ya da rolü değiştiyse)
  // yapılandırma yeni imzaya kadar geçersizdir; kartlar yeniden süzülür. Her sensör olayında ve ekran çağrısında sorulur
  _yetkiDenetle () {
    if (this.yapilandirma && !Y.ebeveynMi(this.L, hex(this.yapilandirma.m.signerId))) {
      this.yapilandirma = null
      this.s.yapilandirma = null
      this.guncel = false
      this._kaydet()
    }
    this._kartlariSuz()
  }

  // Ekran modunda değilse ya da gönderen artık screenFrom'a uymuyorsa (rolü değişti, çıkarıldı) kartları düşer
  _kartlariSuz () {
    const cfg = this.cfg
    for (const from of [...this.kartlar.keys()]) {
      if (!cfg || cfg.mode !== 'ekran' || !E.kaynakUyar(this.L, cfg.screenFrom, from)) this.kartlar.delete(from)
    }
  }

  /**
   * UC_SCREEN_PUSH (§11.8): screen.js denetimi (atılma kodu atılır) ve gönderen başına kalıcı seq tabanı: eşit ya da küçük seq
   * STALE_CARD ile atılır. Kabulde o gönderenin kartları yenisiyle değişir. from: doğrudan oturumda gönderen (emanette null)
   */
  ekranAl (bytes, { from = null } = {}) {
    this._yetkiDenetle()
    const { m } = E.ekranAlDenetle(this.L, bytes, { ucHex: this.meHex, cfg: this.cfg, from })
    const gonderen = hex(m.fromId)
    if (m.seq <= (this.s.ekranSeq[gonderen] || 0)) fail('STALE_CARD')
    this.s.ekranSeq = { ...this.s.ekranSeq, [gonderen]: m.seq }
    this.kartlar.set(gonderen, { seq: m.seq, cards: m.cards.map((x) => ({ id: x.id, title: x.title, lines: [...x.lines], until: x.until })) })
    this._kaydet()
    return { fromId: gonderen, seq: m.seq, kartSayisi: m.cards.length }
  }

  /** Ekranda gösterilecek kartlar: süresi (until) geçmemiş ve gönderen hâlâ yetkili olanlar (açıklama 2 madde 3), gönderenle */
  gosterilecekKartlar () {
    this._yetkiDenetle()
    const t = this.now()
    const out = []
    for (const [from, k] of this.kartlar) for (const x of k.cards) if (x.until > t) out.push({ fromId: from, ...x, lines: [...x.lines] })
    return out
  }

  /**
   * Sensör olayı (§11.7, açıklama 2): u: { sensor, value, yerel: { gun, dk }, hlc }. Koşullar her çağrıda: yapılandırmayı
   * imzalayan hâlâ ebeveyn, `sensor` modu (NOT_MODE_SENSOR), sensör yapılandırmada (SENSOR_DISABLED), pencerede (OUT_OF_WINDOW),
   * güncel UC_STATUS yayınlanmış (STATUS_NOT_PUBLISHED; durum açık sensörleri ve hedefleri taşır), olay yalnız yapılandırmadaki
   * hedef koleksiyonlara: okuyucuları hâlâ evin bütün ebeveyn ve yetişkinleri (INVALID_TARGET) ve uç yazabilir
   * (NO_DROP_PERMISSION). Tür başına dakikada birden sık olay sessizce düşer (null); saat geri alındıysa sınır yeniden başlar.
   * Dönüş: [{ collectionId, bytes, opId, recordId, type }] ya da null
   */
  sensorOlayi ({ sensor, value, yerel, hlc }) {
    this._yetkiDenetle()
    const cfg = this.cfg
    if (!cfg || cfg.mode !== 'sensor') fail('NOT_MODE_SENSOR')
    if (!cfg.sensors.includes(sensor)) fail('SENSOR_DISABLED')
    if (!A.penceredeMi(cfg.windows, yerel)) fail('OUT_OF_WINDOW')
    if (!this.guncel) fail('STATUS_NOT_PUBLISHED')
    const type = Sn.SENSOR_TURU[sensor]
    const t = this.now()
    const son = this.s.sensorSon[type]
    if (typeof son === 'number' && t >= son && t - son < Sn.ARALIK_MS) return null
    const L = this.L
    const koleksiyonlar = Y.sensorHedefleri(cfg)
    if (koleksiyonlar.some((id) => !Y.sensorHedefiGecerli(L, id))) fail('INVALID_TARGET')
    if (koleksiyonlar.some((id) => !Sn.birakabilir(L, id, this.me.memberId))) fail('NO_DROP_PERMISSION')
    const out = koleksiyonlar.map((collectionId) => ({ collectionId, ...Sn.sensorBirakmasi(L, { me: this.me, collectionId, sensor, value, t, hlc }) }))
    this.s.sensorSon = { ...this.s.sensorSon, [type]: t }
    this._kaydet()
    return out
  }

  /**
   * UC_STREAM_OPEN: §11.5 tablosu; aynı streamId ikinci kez IZIN_YOK. u: akis.akisAcDenetle'nin koşulları (oturum, yerel,
   * thermal, pil). Kabulde akış kaydedilir ve durum eskir: kare mühürlenmeden önce UC_STATUS üretilmeli.
   */
  akisIstegi (bytes, u) {
    const r = A.akisAcDenetle(this.L, bytes, { ...u, ucHex: this.meHex, cfg: this.cfg, acikAkis: this.akislar.size })
    if (!r.kabul) return r
    const id = hex(r.m.streamId)
    if (this.akislar.has(id)) return { kabul: false, code: 'IZIN_YOK', streamId: r.m.streamId }
    this.akislar.set(id, { isteyen: r.isteyen, purpose: r.m.purpose, acilma: this.now() })
    if (this.s.since === null) this.s.since = this.now()
    this.s.yenidenBasladi = false
    this.guncel = false
    this._kaydet()
    return r
  }

  _birak (id) {
    this.akislar.delete(id)
    if (!this.akislar.size) this.s.since = null
  }

  /** Akışı kapatır (uç ya da izleyen); durum eskir */
  akisKapat (streamId, _code) {
    const id = hex(streamId)
    if (!this.akislar.has(id)) fail('NO_STREAM')
    this._birak(id)
    this.guncel = false
    this._kaydet()
  }

  /**
   * Akış ömrü (madde 4): her çağrıda bütün açık akışlar yeniden sorulur. u: { yerel: { gun, dk }, thermal, pil }.
   * Dönüş: kapanan akışlar [{ streamId, code }]; yapılandırmanın imzacısı ebeveyn değilse yapılandırma düşer ('kapali').
   */
  denetle (u) {
    const L = this.L
    this._yetkiDenetle()
    const cfg = this.cfg
    const t = this.now()
    const ip = A.isiPilKodu(u)
    const kapatilan = []
    for (const [id, a] of this.akislar) {
      const isteyen = A.isteyenOf(L, a.isteyen.id)
      let code = null
      if (!cfg || cfg.mode !== 'kamera') code = 'YAPILANDIRMA_DEGISTI'
      else if (!isteyen || !A.hedefUyar(cfg, { ...isteyen, purpose: a.purpose })) code = 'IZIN_YOK'
      else if (!A.penceredeMi(cfg.windows, u.yerel)) code = 'PENCERE_DISI'
      else if (ip) code = ip
      else if (t - a.acilma >= A.AKIS_SURESI_MS) code = 'SURE_DOLDU'
      if (code) kapatilan.push({ streamId: id, code })
    }
    for (const k of kapatilan) this._birak(k.streamId)
    if (kapatilan.length) this.guncel = false
    this._kartlariSuz()
    this._kaydet()
    return kapatilan
  }

  /** §11.2: kamera yeniden başlatmadan sonra dokunulmayı bekliyor (madde 6); durum eskir */
  yenidenBasladiYaz (v) {
    if (this.s.yenidenBasladi === !!v) return
    this.s.yenidenBasladi = !!v
    this.guncel = false
    this._kaydet()
  }

  /** UC_STATUS gövdesi (seq kalıcı ve monoton); üretilince durum güncel sayılır */
  durum ({ battery, thermal = 'normal' }) {
    this.s.durumSeq++
    const streams = [...this.akislar.values()].map((a) => ({ toId: b4a.from(a.isteyen.id, 'hex'), purpose: a.purpose }))
    const m = {
      ucId: this.me.memberId, seq: this.s.durumSeq, mode: this.mod, configSeq: this.configSeq,
      camera: { active: streams.length > 0, streams, since: streams.length ? this.s.since : 0 },
      battery, thermal, yenidenBasladi: streams.length ? false : this.s.yenidenBasladi,
      // Açıklama 2 madde 1: sensör modunda açık sensörler ve olayların gittiği koleksiyonlar
      sensors: this.mod === 'sensor' ? [...this.cfg.sensors] : [],
      sensorTargets: this.mod === 'sensor' ? Y.sensorHedefleri(this.cfg).map((x) => b4a.from(x, 'hex')) : []
    }
    this.guncel = true
    this._kaydet()
    return m
  }

  /** Bu akışın karesi mühürlenebilir mi: akış açık ve son UC_STATUS onu gösteriyor (madde 1) */
  muhurlenebilir (streamId) { return this.guncel && this.akislar.has(hex(streamId)) }

  acikAkislar () {
    return [...this.akislar].map(([streamId, a]) => ({ streamId, toId: a.isteyen.id, purpose: a.purpose, acilma: a.acilma }))
  }
}

// §11.9: uç görev çalıştırmaz; TASK gelirse TASK_REJECT { taskId, code: 'DESTEK_YOK' } (vektör 9). Kodlama görev paketinin
const GOREV_RED_KODU = 'DESTEK_YOK'
const gorevReddi = (taskId) => ({ taskId, code: GOREV_RED_KODU })

module.exports = { ANAHTAR, UcDurumu, GOREV_RED_KODU, gorevReddi }
