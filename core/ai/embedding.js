// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// embedding.js — telefondaki anlamsal arama dizini (RFC-0013 §9.2–§9.5; D52, inceleme 18)
//
// Platformun gömme kancası: gom(metinler, { tur: 'sorgu' | 'parca' }) → [Float32Array | number[]] (eşzamanlı ya da
// Promise). onEkler: bildirimdeki [sorgu öneki, parça öneki] (e5: 'query: ', 'passage: '). Vektörler birim uzunluğa
// getirilip int8 saklanır (dizin.nicemle).
//
// Kalıcılık (RFC-0013 §9.3): koleksiyon başına ayrı dosya (saklama.oku/yaz/sil, ad 'gomme-<collectionId>'), durum
// dosyasının dışında. Dosya anahtarı koleksiyonun yazımda kullanılan dönem anahtarından türer:
// derive(dönem anahtarı, 'hf/yz/dizin', platform anahtarı) (anahtarOf kancası; platform anahtarı verilmezse boş).
// Dönem değişince (üye çıkarma) eski dosya açılmaz, silinir ve dizin yeniden kurulur. Parça metninin özeti de anahtarlıdır
// (derive(dosya anahtarı, 'hf/yz/ozet')): dosyadan sözlükle metin çıkarılamaz. Dönem anahtarı yoksa ya da koleksiyon kasaysa
// parçalar yalnız bellekte. Dosya türetilmiş veridir: okunamazsa (bozuk, yabancı, başka dönem ya da model) silinir ve
// yeniden gömülür; hiçbir hata saklamadan dışarı çıkmaz (inceleme 18 W1/W2).
//
// Cihaz sınırı 100 000 parça (§9.2) yalnız kalıcı parçalara uygulanır, gömmeden önce: son yazımı en yeni olanlar içeride,
// gerisi dışarıda (anahtar kelime dizininde kalır). Dışarıda kalanların kimlik ve özeti dosyada: açılışta yeniden
// gömülmezler; yer açılınca yeniden alınırlar (inceleme 18 B5).
const b4a = require('b4a')
const c = require('compact-encoding')
const sodium = require('sodium-native')
const { kdf: { derive, hash }, encoding: { canonical } } = require('@havenfold/core')
const { nicemle, icCarpim, CIHAZ_PARCA } = require('./search-index')
const { N } = require('./text')

function fail (code) { throw new Error(code) }
const hex = (b) => (typeof b === 'string' ? b : b4a.toString(b, 'hex'))
const ILK = 50
const TOPLU = 32
const SURUM = 2
const BOS = b4a.alloc(0)

const parcaEnc = {
  preencode (s, m) { c.string.preencode(s, m.id); c.string.preencode(s, m.rid); c.uint.preencode(s, m.hlc); c.fixed(16).preencode(s, m.ozet); c.buffer.preencode(s, m.vec) },
  encode (s, m) { c.string.encode(s, m.id); c.string.encode(s, m.rid); c.uint.encode(s, m.hlc); c.fixed(16).encode(s, m.ozet); c.buffer.encode(s, m.vec) },
  decode (s) { return { id: c.string.decode(s), rid: c.string.decode(s), hlc: c.uint.decode(s), ozet: c.fixed(16).decode(s), vec: c.buffer.decode(s) } }
}
// vec boşsa parça sınır dışındadır (yalnız kimlik ve özet)
const icerikEnc = {
  preencode (s, m) { c.uint.preencode(s, m.v); c.fixed32.preencode(s, m.modelHash); c.uint.preencode(s, m.boyut); c.array(parcaEnc).preencode(s, m.parcalar) },
  encode (s, m) { c.uint.encode(s, m.v); c.fixed32.encode(s, m.modelHash); c.uint.encode(s, m.boyut); c.array(parcaEnc).encode(s, m.parcalar) },
  decode (s) { return { v: c.uint.decode(s), modelHash: c.fixed32.decode(s), boyut: c.uint.decode(s), parcalar: c.array(parcaEnc).decode(s) } }
}
// Dosya: anahtarın kimliği (dönem ve anahtar; gizli değil) ‖ nonce ‖ şifreli içerik
const dosyaEnc = {
  preencode (s, m) { c.string.preencode(s, m.kimlik); c.fixed(24).preencode(s, m.nonce); c.buffer.preencode(s, m.ct) },
  encode (s, m) { c.string.encode(s, m.kimlik); c.fixed(24).encode(s, m.nonce); c.buffer.encode(s, m.ct) },
  decode (s) { return { kimlik: c.string.decode(s), nonce: c.fixed(24).decode(s), ct: c.buffer.decode(s) } }
}

const dosyaAdi = (cid) => 'gomme-' + hex(cid)
const DOSYA_ADI = /^gomme-([0-9a-f]{32})$/
// Anahtarsız özet (yalnız bellekte, dosyaya yazılmayan parçalar için; inceleme 18 B6)
const metinOzeti = (metin, anahtar = null) => (anahtar ? hash('hf/yz/ozet/', anahtar, b4a.from(metin)) : hash('hf/ai-index-parca/', b4a.from(metin))).subarray(0, 16)

class GommeDizini {
  // anahtarOf(cid) → { key, kimlik } | null: koleksiyonun yazımda kullanılan dönem anahtarı (kimlik: dönem ve anahtar
  // kimliği, metin). anahtar: platform anahtarı (isteğe bağlı, türetmeye girer).
  constructor ({ gom, onEkler = ['', ''], modelHash, esik = null, saklama = null, anahtarOf = null, anahtar = null, sinir = CIHAZ_PARCA, toplu = TOPLU }) {
    if (typeof gom !== 'function') fail('NO_EMBEDDING')
    if (!Array.isArray(onEkler) || onEkler.length !== 2 || !onEkler.every((x) => typeof x === 'string')) fail('INVALID_PREFIX')
    this.gom = gom
    this.onEkler = onEkler
    this.modelHash = typeof modelHash === 'string' ? b4a.from(modelHash, 'hex') : modelHash
    if (!b4a.isBuffer(this.modelHash) || this.modelHash.byteLength !== 32) fail('INVALID_MODEL')
    this.esik = esik
    this.saklama = saklama
    this.anahtarOf = typeof anahtarOf === 'function' ? anahtarOf : () => null
    this.anahtar = anahtar
    this.sinir = sinir
    this.toplu = toplu
    this.boyut = null
    this.parcalar = new Map() // id → { id, cid, rid, hlc, ozet, vec: Int8Array | null, metin, kalici, disarida }
    this.kirli = new Set()
    this.yuklenen = new Set()
  }

  get boyutu () { let n = 0; for (const p of this.parcalar.values()) if (p.vec) n++; return n }

  // --- Anahtar ve dosya ---

  _dosyaAnahtari (cid) {
    let a = null
    try { a = this.anahtarOf(cid) } catch {}
    if (!a || !b4a.isBuffer(a.key) || typeof a.kimlik !== 'string') return null
    return { k: derive(a.key, 'hf/yz/dizin', this.anahtar || BOS), kimlik: a.kimlik }
  }

  _silDosya (cid) {
    if (!this.saklama) return
    try { this.saklama.sil(dosyaAdi(cid)) } catch {}
  }

  // Koleksiyonun dosyasını belleğe alır (bir kez). Açılamayan dosya silinir: yeniden gömülür (W1/W2, dönem değişimi)
  yukle (cid) {
    cid = hex(cid)
    if (this.yuklenen.has(cid) || !this.saklama) return
    this.yuklenen.add(cid)
    let d
    try {
      const b = this.saklama.oku(dosyaAdi(cid))
      if (!b) return
      const da = this._dosyaAnahtari(cid)
      if (!da) return // anahtar şimdilik yok (kasa kilitli ya da dönem anahtarı bekleniyor): dosyaya dokunulmaz
      const f = canonical(dosyaEnc, b4a.from(b), 'INDEX_CORRUPT')
      if (f.kimlik !== da.kimlik) fail('INDEX_EPOCH') // dönem değişti: yeniden kurulur
      if (f.ct.byteLength < 16) fail('INDEX_CORRUPT')
      const pt = b4a.alloc(f.ct.byteLength - 16)
      const ad = hash('hf/yz/dizin-ad/', b4a.from(cid, 'hex'), this.modelHash, b4a.from(f.kimlik))
      sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(pt, null, f.ct, ad, f.nonce, da.k)
      d = canonical(icerikEnc, pt, 'INDEX_CORRUPT')
      if (d.v !== SURUM || !b4a.equals(d.modelHash, this.modelHash) || (this.boyut !== null && d.boyut !== this.boyut)) fail('INDEX_CORRUPT')
      if (!d.parcalar.every((p) => p.vec.byteLength === 0 || p.vec.byteLength === d.boyut)) fail('INDEX_CORRUPT')
      sodium.sodium_memzero(da.k)
    } catch {
      this._silDosya(cid)
      return
    }
    if (d.parcalar.some((p) => p.vec.byteLength)) this.boyut = d.boyut
    for (const p of d.parcalar) {
      if (this.parcalar.has(p.id)) continue
      const vec = p.vec.byteLength ? new Int8Array(b4a.from(p.vec)) : null
      this.parcalar.set(p.id, { id: p.id, cid, rid: p.rid, hlc: p.hlc, ozet: b4a.from(p.ozet), vec, metin: null, kalici: true, disarida: !vec, yuklendi: true })
    }
  }

  _yaz (cid) {
    if (!this.saklama) return
    const parcalar = [...this.parcalar.values()].filter((p) => p.cid === cid && p.kalici && (p.vec || p.disarida))
    if (!parcalar.length) { this._silDosya(cid); return }
    const da = this._dosyaAnahtari(cid)
    if (!da) { this._silDosya(cid); return }
    const pt = c.encode(icerikEnc, { v: SURUM, modelHash: this.modelHash, boyut: this.boyut || 0, parcalar: parcalar.map((p) => ({ id: p.id, rid: p.rid, hlc: p.hlc, ozet: p.ozet, vec: p.vec ? b4a.from(p.vec.buffer, p.vec.byteOffset, p.vec.byteLength) : BOS })) })
    const nonce = b4a.alloc(24)
    sodium.randombytes_buf(nonce)
    const ad = hash('hf/yz/dizin-ad/', b4a.from(cid, 'hex'), this.modelHash, b4a.from(da.kimlik))
    const ct = b4a.alloc(pt.byteLength + 16)
    sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(ct, pt, ad, null, nonce, da.k)
    sodium.sodium_memzero(pt)
    sodium.sodium_memzero(da.k)
    try { this.saklama.yaz(dosyaAdi(cid), c.encode(dosyaEnc, { kimlik: da.kimlik, nonce, ct })) } catch {}
  }

  // Saklamadaki bu koleksiyonların dışındaki bütün dizin dosyalarını siler (saklama liste() verirse; B1, B2, B7)
  supur (tutulacak = new Set()) {
    if (!this.saklama || typeof this.saklama.liste !== 'function') return []
    const silinen = []
    let adlar = []
    try { adlar = this.saklama.liste() } catch {}
    for (const ad of adlar) {
      const m = DOSYA_ADI.exec(ad)
      if (m && !tutulacak.has(m[1])) { this._silDosya(m[1]); silinen.push(m[1]) }
    }
    return silinen
  }

  // --- Parçalar ---

  // Parça (AiApi kayıt dizinlerken). Aynı metinle yüklenmiş vektör varsa yeniden gömülmez. kalici: false (kasa)
  ekle ({ id, collectionId, recordId, hlc = 0, metin, kalici = true }) {
    const cid = hex(collectionId)
    this.yukle(cid)
    const da = kalici ? this._dosyaAnahtari(cid) : null
    const ozet = metinOzeti(this.onEkler[1] + N(metin), da ? derive(da.k, 'hf/yz/ozet') : null)
    if (da) sodium.sodium_memzero(da.k)
    const p = this.parcalar.get(id)
    if (p && b4a.equals(p.ozet, ozet) && (p.vec || p.disarida)) { p.metin = metin; p.kalici = kalici && !!da; p.hlc = hlc; p.yuklendi = false; return }
    this.parcalar.set(id, { id, cid, rid: hex(recordId), hlc, ozet, vec: null, metin, kalici: kalici && !!da, disarida: false })
    if (kalici) this.kirli.add(cid)
  }

  kayitSil (collectionId, recordId) {
    const cid = hex(collectionId)
    const rid = hex(recordId)
    for (const [id, p] of this.parcalar) if (p.cid === cid && p.rid === rid) { this._unut(id, p); this.kirli.add(cid) }
  }

  _unut (id, p) {
    if (p.vec) p.vec.fill(0)
    p.metin = null
    this.parcalar.delete(id)
  }

  // Okuyuculuk bitti, kasa kilitlendi, duyarlılık değişti ya da dizin silindi: bellekten ve dosyadan hemen (§9.5)
  koleksiyonSil (collectionId) {
    const cid = hex(collectionId)
    for (const [id, p] of this.parcalar) if (p.cid === cid) this._unut(id, p)
    this.kirli.delete(cid)
    this.yuklenen.delete(cid)
    this._silDosya(cid)
  }

  // Dizinle başlamış ama bu koleksiyonda artık olmayan (yüklenmiş eski) parçaları bırakır
  ayikla (collectionId, gecerliIdler) {
    const cid = hex(collectionId)
    for (const [id, p] of this.parcalar) if (p.cid === cid && !gecerliIdler.has(id)) { this._unut(id, p); this.kirli.add(cid) }
  }

  // Sınır (§9.2): yalnız kalıcı parçalar sayılır; son yazımı en yeni olanlar içeride. Dönüş: içeride kalacakların kümesi
  _sinirla () {
    const kalici = [...this.parcalar.values()].filter((p) => p.kalici)
    const sirali = kalici.sort((a, b) => b.hlc - a.hlc || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    const iceride = new Set(sirali.slice(0, this.sinir).map((p) => p.id))
    for (const p of sirali) {
      const icerde = iceride.has(p.id)
      if (!icerde && !p.disarida) { if (p.vec) p.vec.fill(0); p.vec = null; p.disarida = true; this.kirli.add(p.cid) }
      if (icerde && p.disarida) { p.disarida = false; this.kirli.add(p.cid) } // yer açıldı: yeniden gömülür
    }
  }

  // Bekleyen parçaları toplu gömer; sınırı önce uygular; kirli koleksiyonların dosyalarını yazar. Dönüş: gömülen sayısı
  async isle () {
    this._sinirla()
    const bekleyen = [...this.parcalar.values()].filter((p) => !p.vec && !p.disarida && typeof p.metin === 'string')
    let n = 0
    for (let i = 0; i < bekleyen.length; i += this.toplu) {
      const grup = bekleyen.slice(i, i + this.toplu)
      const vs = await this.gom(grup.map((p) => this.onEkler[1] + N(p.metin)), { tur: 'parca' })
      if (!Array.isArray(vs) || vs.length !== grup.length) fail('INVALID_EMBEDDING')
      grup.forEach((p, j) => {
        const q = nicemle(Array.from(vs[j]))
        if (this.boyut === null) this.boyut = q.length
        if (q.length !== this.boyut) fail('SIZE_MISMATCH')
        if (this.parcalar.get(p.id) !== p) return // bu arada silindi
        p.vec = q
        if (p.kalici) this.kirli.add(p.cid)
        n++
      })
    }
    for (const cid of this.kirli) this._yaz(cid)
    this.kirli.clear()
    return n
  }

  // Sorgu vektörüyle iç çarpım, ilk 50. Dönüş: [{ id, collectionId, recordId, carpim }] (int8 ölçeği 127²)
  async ara (sorgu, { koleksiyonlar = null, limit = ILK } = {}) {
    const adaylar = () => [...this.parcalar.values()].filter((p) => p.vec && (!koleksiyonlar || koleksiyonlar.includes(p.cid)))
    if (!adaylar().length || !String(sorgu).trim()) return []
    const [v] = await this.gom([this.onEkler[0] + N(sorgu)], { tur: 'sorgu' })
    const q = nicemle(Array.from(v))
    if (q.length !== this.boyut) fail('SIZE_MISMATCH')
    // Gömme beklenirken silinen (kilitlenen) parçalar artık adaylarda yok (B3b)
    return adaylar().map((p) => ({ id: p.id, collectionId: p.cid, recordId: p.rid, carpim: icCarpim(q, p.vec) }))
      .sort((a, b) => b.carpim - a.carpim || (a.collectionId + a.recordId < b.collectionId + b.recordId ? -1 : a.collectionId + a.recordId > b.collectionId + b.recordId ? 1 : a.id < b.id ? -1 : 1))
      .slice(0, limit)
  }
}

module.exports = { GommeDizini, dosyaAdi, metinOzeti, DOSYA_ADI }
