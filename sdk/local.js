// SPDX-License-Identifier: Apache-2.0
// local.js — aynı telefondaki uygulamalar arası yerel kanal (RFC-0017 §10) ve ailesiz kişisel mod (RFC-0017 §6.4; D24)
//
// Yerel kanal yalnız taşıyıcıdır; kalıcı sır tutulmaz (§6.1). Metin derin bağlantıya yazılmaz, kanaldan geçer.
// Taslak Yuva Hat'ın yazma kutusuna düşer; göndermeyi kişi yapar. Kalkan haberi gibi kişinin başlattığı mesajı Yuva Hat
// gönderir (Yuva Defteri 04 §7.2). Kanal kancası platformdadır: { var() → Yuva Hat kurulu mu, birak(zarf) }.
//
// Kişisel mod: ailesi olmayan ya da ailesi düzey 2.2'de olmayan ikinci uygulama verisini yalnız telefonda tutar; düzey
// gelince kişinin Kişisel koleksiyonuna bir kez taşınır. Saklama kancası platformdadır ({ get, set }; kalıcı, şifreli).
const b4a = require('b4a')
const sodium = require('sodium-native')
const { v21: { levelAtLeast } } = require('@havenfold/core')
const { validateFields } = require('./common')

const hex = (b) => (typeof b === 'string' ? b : b4a.toString(b, 'hex'))
function fail (code) { throw new Error(code) }

const TEXT_MAX = 4096 // bayt
const YZ_ALANLARI = ['_ai', '_aiyol']
const ID16 = /^[0-9a-f]{32}$/
const ID32 = /^[0-9a-f]{64}$/

function hedefDogrula (h) {
  if (!h || typeof h !== 'object') fail('INVALID_TARGET')
  if (h.tur === 'sohbet' && typeof h.convId === 'string' && ID32.test(h.convId)) return { tur: 'sohbet', convId: h.convId }
  if (h.tur === 'kisi' && typeof h.personId === 'string' && ID16.test(h.personId)) return { tur: 'kisi', personId: h.personId }
  if (h.tur === 'yanit' && ID16.test(h.recordId || '') && ID16.test(h.personId || '')) return { tur: 'yanit', recordId: h.recordId, personId: h.personId }
  fail('INVALID_TARGET')
}

function metinDogrula (metin) {
  if (typeof metin !== 'string' || !metin.trim() || b4a.byteLength(metin) > TEXT_MAX) fail('INVALID_TEXT')
  return metin
}

class LocalApi {
  constructor ({ kanal = null, now = Date.now } = {}) {
    this.kanal = kanal
    this.now = now
  }

  _var () { return !!this.kanal && typeof this.kanal.var === 'function' && !!this.kanal.var() }

  // Taslağı Yuva Hat'ın yazma kutusuna bırakır. Dönüş: { yol: 'yerel' | 'yok' } (Yuva Hat yoksa 'yok')
  dropDraft (hedef, metin) {
    const h = hedefDogrula(hedef)
    metinDogrula(metin)
    if (!this._var()) return { yol: 'yok' }
    this.kanal.birak({ v: 1, tur: 'taslak', hedef: h, metin, at: this.now() })
    return { yol: 'yerel' }
  }

  // Kalkan aile mesajı kontrolü (Yuva Defteri 04 §4.2 madde 4; D32): korunanın Yuva Hat sohbetinde son gün sayısı
  // içinde bu kişiden para isteyen mesaj var mı. Soru yerel kanaldan (kanal.sor); Yuva Hat yoksa ya da cevap
  // vermezse 'bilinmiyor'. Dönüş: 'var' | 'yok' | 'bilinmiyor'
  async moneyRequestMessage (personId, { gun = 3 } = {}) {
    if (typeof personId !== 'string' || !ID16.test(personId)) fail('INVALID_TARGET')
    if (!this._var() || typeof this.kanal.sor !== 'function') return 'bilinmiyor'
    try {
      const r = await this.kanal.sor({ v: 1, tur: 'para_istegi', personId, gun })
      return r === 'var' || r === 'yok' ? r : 'bilinmiyor'
    } catch { return 'bilinmiyor' }
  }

  // Kişinin başlattığı mesaj (Kalkan haberi): Yuva Hat her alıcıya birebir sohbette gönderir. alicilar: personId[]
  dropMessage (alicilar, metin) {
    if (!Array.isArray(alicilar) || !alicilar.length || alicilar.length > 8 || !alicilar.every((x) => typeof x === 'string' && ID16.test(x))) fail('INVALID_TARGET')
    metinDogrula(metin)
    if (!this._var()) return { yol: 'yok' }
    this.kanal.birak({ v: 1, tur: 'mesaj', alicilar: [...new Set(alicilar)], metin, at: this.now() })
    return { yol: 'yerel' }
  }
}

class MemoryPersonalModeStorage {
  constructor () { this.m = new Map() }
  get (k) { return this.m.has(k) ? JSON.parse(this.m.get(k)) : null }
  set (k, v) { this.m.set(k, JSON.stringify(v)) }
}

const ANAHTAR = 'kisisel-mod'

class PersonalMode {
  constructor ({ saklama = new MemoryPersonalModeStorage(), now = Date.now } = {}) {
    this.saklama = saklama
    this.now = now
  }

  _d () { return this.saklama.get(ANAHTAR) || { aktif: false, tasindi: null, kayitlar: {} } }
  _yaz (d) { this.saklama.set(ANAHTAR, d) }

  get active () { return this._d().aktif }

  // Ailesiz başlama (komut 353): yerel defter yok, kimlik yok; kayıtlar yalnız bu telefonda
  start () {
    const d = this._d()
    if (d.tasindi) fail('ALREADY_MOVED')
    d.aktif = true
    this._yaz(d)
  }

  _aktif () { const d = this._d(); if (!d.aktif) fail('PERSONAL_MODE_DISABLED'); return d }

  // Kayıtlar JSON değerleriyle (dosya yok: dosya gerekirse taşımadan sonra eklenir)
  put (recordId, type, fields) {
    const d = this._aktif()
    // Yapay zeka alanları yalnız onay jetonuyla yazılır (RFC-0023 madde 104; inceleme 13 bulgu 10)
    if (fields && YZ_ALANLARI.some((a) => a in fields)) fail('AI_APPROVAL_REQUIRED')
    if (recordId && !d.kayitlar[recordId]) fail('NO_RECORD')
    if (!recordId && (typeof type !== 'string' || !/^(hf|yuva|mekan)\.[a-z0-9_.-]+$/.test(type))) fail('INVALID_TYPE')
    const id = recordId || hex(rastgele(16))
    const eski = d.kayitlar[id]
    d.kayitlar[id] = { type: eski ? eski.type : type, fields: { ...(eski ? eski.fields : {}), ...fields }, at: this.now() }
    this._yaz(d)
    return id
  }

  get (recordId) { const k = this._d().kayitlar[recordId]; return k ? { recordId, ...k } : null }
  query ({ type = null } = {}) { return Object.entries(this._d().kayitlar).filter(([, k]) => !type || k.type === type).map(([recordId, k]) => ({ recordId, ...k })) }
  del (recordId) { const d = this._aktif(); delete d.kayitlar[recordId]; this._yaz(d) }

  // Düzey 2.2 geldi ve kişinin Kişisel koleksiyonu var mı. Dönüş: collectionId | null
  movable (L, me) {
    if (!L || !L.len || !levelAtLeast(L.level, '2.2')) return null
    const ben = L.canonical(hex(me.memberId || me))
    for (const [cid, col] of L.collections) if (col.kind === 'kisisel' && col.owner && L.canonical(col.owner) === ben && col.sensitivity !== 'kasa' && col.name === 'Kişisel') return cid
    return null
  }

  // Komut 354: kişisel mod verisini Kişisel'e bir kez taşır. kayit: RecordApi (aileli). Dönüş: [{ tur, sayi }] tür sırasıyla.
  // Önce bütün kayıtlar doğrulanır (biri geçersizse hiçbiri yazılmaz); yazılan her kayıt işaretlenir, yarıda kalan taşıma
  // yeniden denenince yazılmışlar atlanır (inceleme 13 bulgu 11)
  move (kayit, L, me) {
    const d = this._d()
    if (d.tasindi) fail('ALREADY_MOVED')
    const cid = this.movable(L, me)
    if (!cid) fail('NO_LEVEL')
    const col = L.collections.get(cid)
    d.tasinanlar = d.tasinanlar || {}
    const kalan = Object.entries(d.kayitlar).filter(([id]) => !d.tasinanlar[id])
    for (const [, k] of kalan) {
      if (YZ_ALANLARI.some((a) => a in k.fields)) fail('AI_APPROVAL_REQUIRED')
      validateFields(k.fields, { col })
    }
    for (const [id, k] of kalan) {
      kayit._yaz(cid, null, k.type, k.fields)
      d.tasinanlar[id] = k.type
      this._yaz(d)
    }
    const sayi = new Map()
    for (const tur of Object.values(d.tasinanlar)) sayi.set(tur, (sayi.get(tur) || 0) + 1)
    this._yaz({ aktif: false, tasindi: { collectionId: cid, at: this.now() }, kayitlar: {} })
    return [...sayi.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([tur, n]) => ({ tur, sayi: n }))
  }
}

// Kişisel modda kayıt komutlarının (240–244) gideceği tek koleksiyonun kimliği (D32): uygulama ailesizken bu kimlikle
// RecordApi'nin yüzünü kullanır; taşımadan sonra kayıtlar gerçek Kişisel koleksiyondadır
const PERSONAL_MODE_COLLECTION = '00'.repeat(16)

PersonalMode.prototype.kayitApi = function () {
  const km = this
  const denetle = (cid) => { if (hex(cid) !== PERSONAL_MODE_COLLECTION) fail('NO_COLLECTION') }
  const kayit = (k) => (k ? { recordId: k.recordId, collectionId: PERSONAL_MODE_COLLECTION, type: k.type, fields: k.fields, olusturma: k.at, degisme: k.at } : null)
  return {
    collections: () => (km.active ? [{ collectionId: PERSONAL_MODE_COLLECTION, name: 'Kişisel', kind: 'kisisel', sensitivity: 'normal', taskAccess: false, history: false, owner: null, readers: [], writers: [], okur: true, writable: true, kisiselMod: true }] : []),
    get: (cid, rid) => { denetle(cid); return kayit(km.get(hex(rid))) },
    query: (cid, { type = null, limit = Infinity } = {}) => { denetle(cid); return km.query({ type }).slice(0, limit).map(kayit) },
    put: (cid, rid, type, fields) => { denetle(cid); return km.put(rid ? hex(rid) : null, type, fields) },
    del: (cid, rid) => { denetle(cid); km.del(hex(rid)) }
  }
}

function rastgele (n) { const b = b4a.alloc(n); sodium.randombytes_buf(b); return b }

// --- Bildiren uygulama (RFC-0017 §9; RFC-0034 §4.6, §9) -----------------------------------------------------------
// Bir olayı bu cihazda yalnız bir uygulama bildirir; seçim aile başınadır: yalnız o ailede kimliği olan uygulamalar aday,
// "ana kimlik" o ailedeki ana kimliktir. uygulamalar: yerel kanaldaki aile listeleri (bu uygulama dahil)
// [{ appId, aileler: [{ familyId (hex), kimlik: 'ana' | 'ek' }] }]. olay: 'mesaj' (mesaj, arama, bas-konuş), 'defter'
// (yuva.defter.* hatırlatması, asistan, Kalkan), 'vaka' (kayitTuru'nun önekine göre), 'sos' (hf.sos), 'cekirdek'
// (güvenlik, kasa payı, imza bekleyen öneri, hf.sos dışındaki hf. türleri). Dönüş: appId ya da (ailede uygulama yoksa) null.
const BILDIREN = { mesaj: 'yuva-hat', defter: 'yuva-defteri', sos: 'yuva-acil' }
const VAKA_ONEKI = [['yuva.acil.', 'yuva-acil'], ['yuva.pet.', 'yuva-pati'], ['yuva.bakim.', 'yuva-bakim'], ['yuva.cocuk.', 'yuva-bakim'], ['yuva.defter.', 'yuva-defteri']]

function reportingApp ({ uygulamalar, familyId, olay, kayitTuru = null }) {
  if (typeof familyId !== 'string' || !ID32.test(familyId)) fail('NO_FAMILY')
  const adaylar = []
  for (const u of Array.isArray(uygulamalar) ? uygulamalar : []) {
    if (!u || typeof u.appId !== 'string') continue
    const a = (Array.isArray(u.aileler) ? u.aileler : []).find((x) => x && x.familyId === familyId)
    if (a) adaylar.push({ appId: u.appId, ana: a.kimlik === 'ana' })
  }
  if (!adaylar.length) return null
  let hedef = null
  if (olay === 'vaka') hedef = (VAKA_ONEKI.find(([o]) => typeof kayitTuru === 'string' && kayitTuru.startsWith(o)) || [])[1] || null
  else if (BILDIREN[olay]) hedef = BILDIREN[olay]
  else if (olay !== 'cekirdek') fail('INVALID_EVENT')
  if (hedef && adaylar.some((x) => x.appId === hedef)) return hedef
  // Geri düşme: o ailedeki ana kimlik, o da yoksa appId sırasıyla ilk uygulama
  const ana = adaylar.find((x) => x.ana)
  if (ana) return ana.appId
  return adaylar.map((x) => x.appId).sort()[0]
}

module.exports = { LocalApi, PersonalMode, MemoryPersonalModeStorage, TEXT_MAX, PERSONAL_MODE_COLLECTION, reportingApp: reportingApp }
