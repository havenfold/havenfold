// SPDX-License-Identifier: Apache-2.0
// shield.js — Aile Kalkanı'nın çekirdek tarafı (Yuva Defteri 04 §7, §10; D24)
//
// Arka plan taraması yok; yalnız korunanın verdiğiyle çalışır, hiçbir şey dışarı gitmez. Kalkan:<korunan> kişisel
// koleksiyondur: yalnız korunan imzalar (RFC-0003 §5.9), ebeveyn dahil kimse kendini ekleyemez. Koruyucular okuyucu ve
// yazardır (kabul ve sonuç kayıtları). Görev erişimi kapalıdır. Kural süzgeci (kalıp listesi) ve güvenlik kelimesi
// üründedir; bu modül kayıtları, koleksiyonu, haberi (yerel kanal) ve 'kalkan' olaylarını verir.
const b4a = require('b4a')
const { ledger: { T } } = require('@havenfold/core')
const { Emitter } = require('./api')

const hex = (b) => (typeof b === 'string' ? b : b4a.toString(b, 'hex'))
function fail (code) { throw new Error(code) }

const HABER = ['her_seferinde_sor', 'her_zaman']
const SONUCLAR = ['sorun_yok', 'dolandiricilik', 'emin_degil']
const TURLER = ['mesaj', 'arama', 'diger']
const TUR_ADI = { mesaj: 'mesaj', arama: 'arama', diger: 'durum' }
const BILDIRIM_KEEP = 365
const ONEK = 'Kalkan:'

class ShieldApi extends Emitter {
  // kayit: RecordApi; defter: LedgerApi; yerel: LocalApi (Yuva Hat'a mesaj)
  constructor ({ kayit, defter, yerel = null, now = Date.now }) {
    super()
    this.kayit = kayit
    this.defter = defter
    this.yerel = yerel
    this.now = now
    this._gorulen = new Set() // bildirilmiş kayıtlar ve davetler (olay bir kez)
    this._ilk = true
    kayit.on('change', () => this.scan())
  }

  get _L () { return this.kayit._L }
  get _me () { return this._L.canonical(this.kayit.r.meHex) }

  // Kalkan:<korunan> koleksiyonları (kişisel, okuyabildiğim)
  _kalkanlar () { return this.kayit.collections().filter((c) => c.kind === 'kisisel' && c.name.startsWith(ONEK) && c.okur) }
  _benimki () { return this._kalkanlar().find((c) => this._L.canonical(c.owner) === this._me) || null }

  _ayar (cid) { return this.kayit.query(cid, { type: 'yuva.defter.kalkan' })[0] || null }

  _koruyucuDogrula (koruyucular) {
    const L = this._L
    const k = [...new Set((koruyucular || []).map((x) => L.canonical(hex(x))))]
    if (k.length < 1 || k.length > 2) fail('GUARDIAN_COUNT')
    for (const id of k) if (!id || id === this._me || !['ebeveyn', 'yetiskin'].includes(L.members.get(id)?.role)) fail('INVALID_GUARDIAN')
    return k
  }

  _izinler (cid, koruyucular) {
    const col = this._L.collections.get(cid)
    const liste = ['uye:' + this._me, ...koruyucular.map((x) => 'uye:' + x)]
    return this.defter._yaz(T.COLLECTION, { collectionId: b4a.from(cid, 'hex'), name: col.name, kind: col.kind, readers: liste, writers: liste, sensitivity: col.sensitivity, taskAccess: false, history: col.history, dropKey: b4a.alloc(32) })
  }

  // L07: Kalkan:<ben> kurulur (önce yalnız ben, sonra koruyucular), ayar kaydı yazılır. Koruyucuların telefonunda
  // 'kalkan' { type: 'davet' } olayı çıkar.
  enable (koruyucular, haberVer = 'her_seferinde_sor') {
    if (!HABER.includes(haberVer)) fail('INVALID_INPUT')
    const k = this._koruyucuDogrula(koruyucular)
    const L = this._L
    let c = [...L.collections.values()].find((x) => x.kind === 'kisisel' && x.name.startsWith(ONEK) && L.canonical(x.owner) === this._me)
    if (c && c.readers.length > 1) fail('SHIELD_ENABLED')
    if (!c) {
      const ad = ONEK + (L.members.get(this._me)?.name || '')
      this.defter.openCollection({ name: ad, kind: 'kisisel', readers: ['uye:' + this._me], writers: ['uye:' + this._me], taskAccess: false, history: true })
      c = [...L.collections.values()].find((x) => x.name === ad && L.canonical(x.owner) === this._me)
    }
    this._izinler(c.id, k)
    this.kayit.sync()
    return this._ayarYaz(c.id, k, haberVer, true)
  }

  _ayarYaz (cid, koruyucular, haberVer, aktif) {
    const a = this._ayar(cid)
    const f = { korunan: 'uye:' + this._me, koruyucular: koruyucular.map((x) => 'uye:' + x), haber_ver: haberVer, aktif }
    if (a) { this.kayit.put(cid, a.recordId, '', f); return cid }
    this.kayit.put(cid, null, 'yuva.defter.kalkan', { ...f, bastirilan_kaliplar: [] })
    return cid
  }

  setGuardians (koruyucular, haberVer) {
    const c = this._benimki()
    if (!c) fail('SHIELD_DISABLED')
    if (!HABER.includes(haberVer)) fail('INVALID_INPUT')
    const k = this._koruyucuDogrula(koruyucular)
    this._izinler(c.collectionId, k) // çıkan koruyucu için yeni dönem başlar (RFC-0001 §9.1)
    this.kayit.sync()
    return this._ayarYaz(c.collectionId, k, haberVer, true)
  }

  // Kapatma: koruyucular çıkar, ayar 'aktif: false'; kayıtlar korunanda kalır (kişisel koleksiyonun sahibi okuyucudur)
  close () {
    const c = this._benimki()
    if (!c) fail('SHIELD_DISABLED')
    const a = this._ayar(c.collectionId)
    this._izinler(c.collectionId, [])
    this.kayit.sync()
    if (a) this.kayit.put(c.collectionId, a.recordId, '', { koruyucular: [], aktif: false })
  }

  // L08: koruyucu daveti cevabı (koruyucunun telefonunda)
  answerInvite (korunan, kabul) {
    const c = this._korunanin(korunan)
    return this.kayit.put(c.collectionId, null, 'yuva.defter.kalkan_kabul', { koruyucu: 'uye:' + this._me, kabul: !!kabul, zaman: this.now() })
  }

  _korunanin (korunan) {
    const id = this._L.canonical(hex(korunan))
    const c = this._kalkanlar().find((x) => this._L.canonical(x.owner) === id)
    if (!c || id === this._me) fail('NO_SHIELD')
    return c
  }

  // Haber ver (04 §7.2): kalkan_bildirimi kaydı; Yuva Hat varsa koruyuculara mesaj. sonuc: { tur, anlatim, isaretler,
  // ekranGoruntusu? (BlobRef) }. Dönüş: { recordId, yol: 'mesaj' | 'kayit' }
  report (sonuc, goruntuyuEkle = false) {
    const c = this._benimki()
    if (!c) fail('SHIELD_DISABLED')
    if (!sonuc || !TURLER.includes(sonuc.tur) || typeof sonuc.anlatim !== 'string') fail('INVALID_INPUT')
    const a = this._ayar(c.collectionId)
    const f = { tur: sonuc.tur, anlatim: sonuc.anlatim, isaretler: Array.isArray(sonuc.isaretler) ? sonuc.isaretler.filter((x) => typeof x === 'string') : [], sonuc: 'acik', zaman: this.now(), _keep: BILDIRIM_KEEP }
    if (goruntuyuEkle && sonuc.ekranGoruntusu) f.ekran_goruntusu = sonuc.ekranGoruntusu
    const recordId = this.kayit.put(c.collectionId, null, 'yuva.defter.kalkan_bildirimi', f)
    const koruyucular = (a?.fields.koruyucular || []).map((x) => this._L.canonical(x.slice(4))).filter(Boolean)
    let yol = 'kayit'
    if (this.yerel && koruyucular.length) {
      const ad = this._L.members.get(this._me)?.name || ''
      const saat = new Date(this.now() + 180 * 60_000).toISOString().slice(11, 16)
      yol = this.yerel.dropMessage(koruyucular, `Kalkan: ${ad} şüpheli bir ${TUR_ADI[sonuc.tur]} bildirdi (${saat}). Ayrıntı Defter → Kalkan'da.`).yol === 'yerel' ? 'mesaj' : 'kayit'
    }
    return { recordId, yol }
  }

  // L05 "Sorun yokmuş", L09 sonuç: korunan ya da koruyucu
  writeResult (collectionId, recordId, sonuc) {
    if (!SONUCLAR.includes(sonuc)) fail('INVALID_INPUT')
    const cid = hex(collectionId)
    const k = this.kayit.get(cid, recordId)
    if (!k || k.type !== 'yuva.defter.kalkan_bildirimi') fail('NO_RECORD')
    this.kayit.put(cid, recordId, '', { sonuc, kapatan: 'uye:' + this._me })
  }

  // Koruyucu olarak gördüklerim ve kendi bildirimlerim, yeniden eskiye
  notifications () {
    const L = this._L
    const out = []
    for (const c of this._kalkanlar()) {
      for (const k of this.kayit.query(c.collectionId, { type: 'yuva.defter.kalkan_bildirimi' })) {
        out.push({ collectionId: c.collectionId, recordId: k.recordId, korunan: L.canonical(c.owner), benim: L.canonical(c.owner) === this._me, ...k.fields })
      }
    }
    return out.sort((a, b) => (b.zaman || 0) - (a.zaman || 0))
  }

  status () {
    const L = this._L
    const c = this._benimki()
    const a = c ? this._ayar(c.collectionId) : null
    const kabuller = {}
    if (c) for (const k of this.kayit.query(c.collectionId, { type: 'yuva.defter.kalkan_kabul' })) kabuller[L.canonical(k.fields.koruyucu.slice(4))] = k.fields.kabul
    return {
      acik: !!(a && a.fields.aktif !== false && c.readers.length > 1),
      collectionId: c ? c.collectionId : null,
      koruyucular: (a?.fields.koruyucular || []).map((x) => L.canonical(x.slice(4))),
      haberVer: a?.fields.haber_ver || 'her_seferinde_sor',
      kabuller,
      korudugum: this._kalkanlar().filter((x) => L.canonical(x.owner) !== this._me).map((x) => L.canonical(x.owner))
    }
  }

  // Güvenlik kelimesinin koleksiyonu (Yuva Defteri 04 §6, §10; D32): 'Kalkan' adlı kasa duyarlılıklı ortak koleksiyon;
  // okuyucular ebeveyn ve yetişkin, istenirse çocuk; yazarlar ebeveyn ve yetişkin. Kasa kuralı gereği bütün ebeveynlerin
  // imzası gerekir (öneri olur). Var olan koleksiyonda okuyucular değişir.
  wordCollection ({ cocuklarOkur = false } = {}) {
    const okur = ['rol:ebeveyn', 'rol:yetiskin', ...(cocuklarOkur ? ['rol:cocuk'] : [])]
    const yazar = ['rol:ebeveyn', 'rol:yetiskin']
    const c = this._kelimeKoleksiyonu()
    if (!c) return this.defter.openCollection({ name: 'Kalkan', kind: 'genel', readers: okur, writers: yazar, sensitivity: 'kasa', taskAccess: false, history: true })
    return this.defter._yaz(T.COLLECTION, { collectionId: b4a.from(c.id, 'hex'), name: c.name, kind: c.kind, readers: okur, writers: yazar, sensitivity: 'kasa', taskAccess: false, history: c.history, dropKey: b4a.alloc(32) })
  }

  _kelimeKoleksiyonu () { return [...this._L.collections.values()].find((x) => x.name === 'Kalkan' && x.kind === 'genel' && x.sensitivity === 'kasa' && x.readers.length) || null }

  // KRA koşulu (04 §6.1): kelime koleksiyonunu okuyan telefon (kişi) ≥ 3 değilse uygulamada saklama zorunlu
  wordStatus () {
    const L = this._L
    const c = this._kelimeKoleksiyonu()
    if (!c) return { collectionId: null, okuyucuKisi: 0, kraKurulur: false, cocuklarOkur: false }
    const kisi = new Set(L.personIds().filter((id) => {
      const m = L.members.get(id)
      return m && m.active && c.readers.includes('rol:' + m.role)
    }))
    return { collectionId: c.id, okuyucuKisi: kisi.size, kraKurulur: kisi.size >= 3, cocuklarOkur: c.readers.includes('rol:cocuk') }
  }

  // L13: "Kalkan doğrulamasında görün" (Tüm Aile'de uye_tercihi; değer yalnız kendi yazdığım işlemden okunur)
  setVisibility (acik, tumAile) {
    const cid = hex(tumAile)
    const ben = this.kayit.query(cid, { type: 'yuva.defter.uye_tercihi' }).find((k) => k.fields.uye === 'uye:' + this._me && this._L.canonical(k.olusturan) === this._me)
    if (ben) return this.kayit.put(cid, ben.recordId, '', { kalkan_gorunur: !!acik })
    return this.kayit.put(cid, null, 'yuva.defter.uye_tercihi', { uye: 'uye:' + this._me, kalkan_gorunur: !!acik })
  }

  // Değişiklikte: yeni koruyuculuk daveti ve başkasının yazdığı yeni bildirim için 'kalkan' olayı (bir kez)
  scan () {
    const L = this._L
    for (const c of this._kalkanlar()) {
      const korunan = L.canonical(c.owner)
      if (korunan !== this._me && !this._gorulen.has('d:' + c.collectionId)) {
        this._gorulen.add('d:' + c.collectionId)
        const cevap = this.kayit.query(c.collectionId, { type: 'yuva.defter.kalkan_kabul' }).some((k) => k.fields.koruyucu === 'uye:' + this._me)
        if (!cevap) this.emit('shield', { type: 'davet', korunan })
      }
      for (const k of this.kayit.query(c.collectionId, { type: 'yuva.defter.kalkan_bildirimi' })) {
        if (this._gorulen.has('b:' + k.recordId)) continue
        this._gorulen.add('b:' + k.recordId)
        if (L.canonical(k.olusturan) !== this._me) this.emit('shield', { type: 'bildirim', collectionId: c.collectionId, recordId: k.recordId })
      }
    }
  }
}

module.exports = { ShieldApi }
