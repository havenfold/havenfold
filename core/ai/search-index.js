// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// search-index.js — koleksiyonlar üzerinde arama (RFC-0013 §9): dizin kapsamı, parçalama, int8 gömme, şifreli bloklar,
// anahtar kelime dizini, karşılıklı sıra birleşimi, dayanaklı sonuç ve dizin silme kuralları
//
// Dizin yalnız telefondadır. Kutu ve işçi koleksiyon anahtarı almaz, dizin tutmaz. Dizin yedeğe girmez, dışa
// aktarılmaz. Asistan kendi cevaplarından beslenmez (hf.ai.konusma ve hf.ai.kupon dizinlenmez).
const b4a = require('b4a')
const c = require('compact-encoding')
const sodium = require('sodium-native')
const { kdf: { derive, hash }, encoding: { canonical } } = require('@havenfold/core')
const { yetki: { Yetki, readerSet } } = require('@havenfold/records')
const { N, kelimeler, tokenTahmini } = require('./text')

function fail (code) { throw new Error(code) }
const hex = (b) => (typeof b === 'string' ? b : b4a.toString(b, 'hex'))
const buf = (x) => (typeof x === 'string' ? b4a.from(x, 'hex') : x)

const DIZINLENMEZ = ['hf.ai.konusma', 'hf.ai.kupon']
const PARCA_BOY = 1200
const ORTUSME = 200
const BLOK_PARCA = 256
const CIHAZ_PARCA = 100_000
const ILK = 50
const RRF_K = 60
const BAGLAM_PARCA = 8
const BUTCE = { telefon: 2500, isci: 6000 }

// --- Kapsam (§9.1, §9.6) -------------------------------------------------------------------------------------------

// Defterin şu anki başında okuyucusu olduğu, normal ya da (kasa açıkken) kasa koleksiyonları. me: kimlik hex.
// Çocukta bu liste kendiliğinden daralır: anahtarı olmayan koleksiyonun okuyucusu değildir. Dönüş: sıralı hex liste.
function dizinlenecekler (L, me, { kasaAcik = false } = {}) {
  const out = []
  for (const [cid, col] of L.collections) {
    if (!readerSet(L, col).has(hex(me))) continue
    if (col.sensitivity === 'normal' || (col.sensitivity === 'kasa' && kasaAcik)) out.push(cid)
  }
  return out.sort()
}

const dizinlenir = (type) => typeof type === 'string' && !DIZINLENMEZ.includes(type)

// §9.5 ilk satır: okuyuculuk bitince o koleksiyonun gömme ve anahtar kelime dizini olay uygulanırken, başka iş
// yapılmadan silinir. Bekçi kendi yetki tablosunu tutar; platform defteri her ilerlettiğinde, kayıt katmanından ve
// başka her işten önce uygula() çağrılır. sil(cid, seq) eşzamanlıdır. Çatallanmada baştan kurulur ve başta okuyucu
// olunmayan her koleksiyon için sil çağrılır (silme tekrarlanabilir olmalı).
class DizinBekcisi {
  constructor ({ me, sil }) {
    if (typeof sil !== 'function') fail('ERASE_REQUIRED')
    this.me = hex(me)
    this.sil = sil
    this.yetki = new Yetki()
  }

  uygula (L) {
    const { from, rebuilt } = this.yetki.update(L)
    const silinen = []
    const son = L.len - 1
    if (rebuilt) {
      for (const cid of this.yetki.cols.keys()) if (!this.yetki.isReader(cid, this.me, son)) silinen.push({ cid, seq: son })
    } else {
      for (const [cid, st] of this.yetki.cols) {
        for (const x of st.readers.get(this.me) || []) if (x.to !== null && x.to >= from) silinen.push({ cid, seq: x.to })
      }
      silinen.sort((a, b) => a.seq - b.seq || (a.cid < b.cid ? -1 : 1))
    }
    for (const x of silinen) this.sil(x.cid, x.seq)
    return silinen
  }
}

// --- Parçalama ve gömme (§9.2) -------------------------------------------------------------------------------------

// Kayıt → "Ad: değer" satırları, tür tanımındaki alan sırasıyla. turAlanlari: [{ ad, etiket? }]. _ alanları girmez.
function kayitMetni (fields, turAlanlari) {
  const satirlar = []
  for (const a of turAlanlari) {
    const v = fields[a.ad]
    if (v === undefined || v === null || a.ad.startsWith('_')) continue
    const s = Array.isArray(v) ? v.map(String).join(', ') : b4a.isBuffer(v) ? null : String(v)
    if (s !== null && s !== '') satirlar.push((a.etiket || a.ad) + ': ' + s)
  }
  return satirlar.join('\n')
}

// Uzun metin 1200 karakterlik parçalara, 200 karakter örtüşmeyle, boşlukta kesilerek bölünür. Karakter: kod noktası.
// Boşluk yoksa tam sınırdan kesilir. Dönüş: [string]
function parcala (metin, { boy = PARCA_BOY, ortusme = ORTUSME } = {}) {
  const k = Array.from(metin)
  const bosluk = (i) => /\s/u.test(k[i])
  const out = []
  let bas = 0
  while (bas < k.length) {
    while (bas < k.length && bosluk(bas)) bas++
    if (bas >= k.length) break
    let bit = Math.min(bas + boy, k.length)
    if (bit < k.length) {
      let j = bit
      while (j > bas && !bosluk(j)) j-- // kesim yeri: sınırdaki ya da ondan önceki son boşluk
      if (j > bas) bit = j
    }
    out.push(k.slice(bas, bit).join('').trim())
    if (bit >= k.length) break
    // Sonraki parça, kesimden 200 karakter önceki ilk kelime başından başlar; en az bir karakter ilerler
    let s = Math.max(bas + 1, bit - ortusme)
    while (s < bit && !bosluk(s - 1)) s++
    bas = s
  }
  return out.filter((x) => x)
}

// Vektör birim uzunluğa getirilir, her bileşen round(v × 127) ile int8 olur (yarım sıfırdan uzağa yuvarlanır)
function nicemle (v) {
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0))
  if (!(n > 0)) fail('INVALID_VECTOR')
  const out = new Int8Array(v.length)
  for (let i = 0; i < v.length; i++) {
    const x = (v[i] / n) * 127
    out[i] = Math.max(-127, Math.min(127, Math.sign(x) * Math.round(Math.abs(x))))
  }
  return out
}

function icCarpim (a, b) {
  if (a.length !== b.length) fail('SIZE_MISMATCH')
  let t = 0
  for (let i = 0; i < a.length; i++) t += a[i] * b[i]
  return t
}

// §9.2: cihaz başına en çok 100 000 parça. Aşılırsa hlc'si en eski kayıtların parçaları gömme dizininden çıkar
// (anahtar kelime dizininde kalır). parcalar: [{ id, hlc }]. Dönüş: gömme dizininden çıkacak parça kimlikleri.
function gommeSinirla (parcalar, sinir = CIHAZ_PARCA) {
  if (parcalar.length <= sinir) return []
  const sirali = [...parcalar].sort((a, b) => (a.hlc < b.hlc ? -1 : a.hlc > b.hlc ? 1 : a.id < b.id ? -1 : 1))
  return sirali.slice(0, parcalar.length - sinir).map((x) => x.id)
}

// Gömme dayanağı: iç çarpım, bildirimdeki binde eşiği aşar mı (int8 ölçeği 127²; tamsayı karşılaştırma)
const esikAsar = (carpim, esikBinde) => carpim * 1000 > esikBinde * 127 * 127

// --- Şifreli bloklar (§9.3) ----------------------------------------------------------------------------------------

const indexKey = (K, collectionId) => derive(K, 'hf/ai-index/', buf(collectionId))
const blokAD = (collectionId, keyId, blokNo, modelHash) => hash('hf/ai-index-ad/', buf(collectionId), buf(keyId), blokNo, buf(modelHash))

const parcaEnc = {
  preencode (st, m) { c.string.preencode(st, m.ref); c.buffer.preencode(st, m.vec) },
  encode (st, m) { c.string.encode(st, m.ref); c.buffer.encode(st, m.vec) },
  decode (st) { return { ref: c.string.decode(st), vec: c.buffer.decode(st) } }
}
const blokEnc = c.array(parcaEnc)

// parcalar: [{ ref: _src biçimi, vec: Int8Array }] (en çok 256, aynı boyut). Dönüş: nonce (24) ‖ ct. Nonce her zaman
// rastgeledir; sabit nonce yalnız blokSifreleVektor'de (inceleme 8 madde 2).
const blokSifrele = (g) => blokSifreleVektor(g, null)

// Yalnız test vektörleri: sabit nonce
function blokSifreleVektor ({ K, keyId, collectionId, blokNo, modelHash, parcalar }, nonce) {
  if (!Array.isArray(parcalar) || !parcalar.length || parcalar.length > BLOK_PARCA) fail('INVALID_BLOCK')
  const boyut = parcalar[0].vec.length
  if (!parcalar.every((p) => typeof p.ref === 'string' && p.vec instanceof Int8Array && p.vec.length === boyut)) fail('INVALID_BLOCK')
  const pt = c.encode(blokEnc, parcalar.map((p) => ({ ref: p.ref, vec: b4a.from(p.vec.buffer, p.vec.byteOffset, p.vec.byteLength) })))
  const ad = blokAD(collectionId, keyId, blokNo, modelHash)
  const k = indexKey(K, collectionId)
  if (!nonce) {
    nonce = b4a.alloc(24)
    sodium.randombytes_buf(nonce)
  }
  const ct = b4a.alloc(pt.byteLength + 16)
  sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(ct, pt, ad, null, nonce, k)
  sodium.sodium_memzero(k)
  sodium.sodium_memzero(pt)
  return b4a.concat([nonce, ct])
}

function blokCoz ({ K, keyId, collectionId, blokNo, modelHash, bytes }) {
  if (!b4a.isBuffer(bytes) || bytes.byteLength < 24 + 16) fail('INDEX_CORRUPT')
  const ad = blokAD(collectionId, keyId, blokNo, modelHash)
  const k = indexKey(K, collectionId)
  const pt = b4a.alloc(bytes.byteLength - 24 - 16)
  let ok = true
  try { sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(pt, null, bytes.subarray(24), ad, bytes.subarray(0, 24), k) } catch { ok = false }
  sodium.sodium_memzero(k)
  if (!ok) fail('INDEX_CORRUPT')
  let ps
  try { ps = canonical(blokEnc, pt, 'INDEX_CORRUPT') } catch { fail('INDEX_CORRUPT') }
  return ps.map((p) => ({ ref: p.ref, vec: new Int8Array(b4a.from(p.vec)) }))
}

// --- Anahtar kelime dizini -----------------------------------------------------------------------------------------
// Platformda SQLite FTS5 (BM25) kullanılır. Bu, aynı sıralamayı veren başvuru gerçeklemesidir (k1 = 1.2, b = 0.75);
// testlerde ve SQLite'sız ortamda kullanılır. Kayıt durumundan fazlasını içermez.

// Anlamlı kelime: 2 harften uzun ve sık geçen bağlaçlardan değil (dayanaklı sonuç, §9.4 madde 6)
const BOS_KELIMELER = new Set(['ve', 'ile', 'bir', 'bu', 'şu', 'o', 'ne', 'mi', 'mı', 'mu', 'mü', 'için', 'de', 'da', 'ki',
  'ya', 'veya', 'ama', 'gibi', 'kadar', 'daha', 'en', 'çok', 'az', 'her', 'hiç', 'nasıl', 'neden', 'nerede', 'hangi',
  'kim', 'ben', 'sen', 'biz', 'siz', 'onlar', 'var', 'yok', 'olan', 'olarak', 'diye', 'sonra', 'önce'])
const anlamli = (k) => Array.from(k).length > 2 && !BOS_KELIMELER.has(k)
const anlamliKelimeler = (metin) => [...new Set(kelimeler(N(metin)).filter(anlamli))]

// Eş anlamlılar (D15 13): sorgu terimi gruptaki öbür kelimelerle genişler; eşleşen eş anlamlı da anlamlı sayılır.
// Küçük, uygulamayla gelen bir tablodur (N biçiminde).
const ES_ANLAMLI = [['şifre', 'parola'], ['wifi', 'kablosuz', 'modem'], ['doktor', 'hekim'], ['araba', 'araç', 'otomobil'],
  ['garanti', 'teminat'], ['fatura', 'makbuz'], ['ilaç', 'hap'], ['tamir', 'onarım', 'servis'], ['adres', 'konum'],
  ['telefon', 'numara'], ['randevu', 'görüşme'], ['kira', 'kiralama'], ['okul', 'öğretmen'], ['veteriner', 'veterinerlik']]
const ES = new Map()
for (const g of ES_ANLAMLI) for (const k of g) ES.set(k, g)
const esAnlamlilarla = (ks) => [...new Set(ks.flatMap((k) => ES.get(k) || [k]))]

class AnahtarDizin {
  constructor () { this.parcalar = new Map() } // id → { id, collectionId, recordId, ref, terimler: Map, uzunluk }

  // id: parçanın kimliği (ör. recordId hex + '#' + no)
  ekle ({ id, collectionId, recordId, ref, metin }) {
    const ks = kelimeler(N(metin))
    const terimler = new Map()
    for (const k of ks) terimler.set(k, (terimler.get(k) || 0) + 1)
    this.parcalar.set(id, { id, collectionId: hex(collectionId), recordId: hex(recordId), ref, terimler, uzunluk: ks.length })
  }

  kayitSil (collectionId, recordId) {
    for (const [id, p] of this.parcalar) if (p.collectionId === hex(collectionId) && p.recordId === hex(recordId)) this.parcalar.delete(id)
  }

  koleksiyonSil (collectionId) {
    for (const [id, p] of this.parcalar) if (p.collectionId === hex(collectionId)) this.parcalar.delete(id)
  }

  get boyut () { return this.parcalar.size }

  // Dönüş: [{ id, collectionId, recordId, ref, puan, eslesen: [anlamlı kelimeler] }] en çok limit; eşitlikte sıra
  ara (sorgu, { limit = ILK, koleksiyonlar = null } = {}) {
    const q = esAnlamlilarla(kelimeler(N(sorgu)))
    const hepsi = [...this.parcalar.values()].filter((p) => !koleksiyonlar || koleksiyonlar.includes(p.collectionId))
    if (!q.length || !hepsi.length) return []
    const ort = hepsi.reduce((a, p) => a + p.uzunluk, 0) / hepsi.length
    const df = new Map(q.map((k) => [k, hepsi.filter((p) => p.terimler.has(k)).length]))
    const out = []
    for (const p of hepsi) {
      let puan = 0
      const eslesen = []
      for (const k of q) {
        const f = p.terimler.get(k)
        if (!f) continue
        const n = df.get(k)
        const idf = Math.log(1 + (hepsi.length - n + 0.5) / (n + 0.5))
        puan += idf * (f * 2.2) / (f + 1.2 * (1 - 0.75 + 0.75 * p.uzunluk / ort))
        if (anlamli(k)) eslesen.push(k)
      }
      if (puan > 0) out.push({ id: p.id, collectionId: p.collectionId, recordId: p.recordId, ref: p.ref, puan, eslesen })
    }
    return out.sort((a, b) => b.puan - a.puan || sira(a, b)).slice(0, limit)
  }
}

// Eşitlik çözümü: (collectionId, recordId) bayt sırası, sonra parça kimliği
function sira (a, b) {
  const x = b4a.compare(b4a.from(a.collectionId + a.recordId, 'hex'), b4a.from(b.collectionId + b.recordId, 'hex'))
  if (x) return x
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

// --- Birleştirme ve bağlam (§9.4) ----------------------------------------------------------------------------------

// Karşılıklı sıra birleşimi: puan = Σ 1 / (60 + sıra), sıra 1'den başlar. listeler: [[{ id, collectionId, recordId, … }]]
function rrf (listeler, { k = RRF_K } = {}) {
  const m = new Map()
  for (const liste of listeler) {
    liste.forEach((x, i) => {
      const o = m.get(x.id) || { ...x, puan: 0 }
      o.puan += 1 / (k + i + 1)
      m.set(x.id, o)
    })
  }
  return [...m.values()].sort((a, b) => b.puan - a.puan || sira(a, b))
}

// İlk 8 parça bütçe içinde bağlama girer (telefon 2500, işçi 6000 tahmini token). Bütçeyi aşan ilk parçada durur.
function baglam (siralilar, { yer = 'telefon', metinOf = (x) => x.metin } = {}) {
  const butce = BUTCE[yer]
  if (!butce) fail('INVALID_PLACE')
  const out = []
  let t = 0
  for (const x of siralilar.slice(0, BAGLAM_PARCA)) {
    const n = tokenTahmini(metinOf(x))
    if (t + n > butce) break
    t += n
    out.push(x)
  }
  return out
}

// Dayanaklı: FTS'de en az bir anlamlı kelimesi eşleşen ya da iç çarpımı eşiği aşan parça (§9.4 madde 6)
const dayanakli = (x, { esik = null } = {}) =>
  (Array.isArray(x.eslesen) && x.eslesen.length > 0) || (esik !== null && Number.isFinite(x.carpim) && esikAsar(x.carpim, esik))

module.exports = {
  DIZINLENMEZ,
  BLOK_PARCA,
  CIHAZ_PARCA,
  gommeSinirla,
  BUTCE,
  dizinlenecekler,
  dizinlenir,
  DizinBekcisi,
  kayitMetni,
  parcala,
  nicemle,
  icCarpim,
  esikAsar,
  indexKey,
  blokAD,
  blokSifrele,
  blokSifreleVektor,
  blokCoz,
  anlamliKelimeler,
  ES_ANLAMLI,
  esAnlamlilarla,
  AnahtarDizin,
  rrf,
  baglam,
  dayanakli
}
