// SPDX-License-Identifier: Apache-2.0
// api.js — ürünlerin kullandığı arayüzler: Kayit (RFC-0001 §16), Olay (RFC-0006 §15), Gorev (RFC-0002 §14),
// Defter ve kişi (RFC-0003, RFC-0017), ortak işlevler (RFC-0015 §3–§4)
//
// Arayüzler çekirdek nesnelerinin (Replika, YetenekDefteri, OnayDefteri, Presence …) ince sarmalayıcılarıdır ve aynı
// süreçte çalışır. Yuva Hat'ta worklet komutlarıyla (240–249, 250–259, 260–269, 350–364) uygulamaya taşınır.
// Ağa yazmak çağıranın verdiği gonder(peerHex, type, bytes) ile olur; SDK taşıyıcı bilmez. Ağdan gelen her zarf
// çekirdeğin tek giriş noktasından (giris.gelenZarf: oturum süzgeci ve kanonik çözme) geçer.
const b4a = require('b4a')
const sodium = require('sodium-native')
const c = require('compact-encoding')
const { encoding: { decodeBody, canonical } } = require('@havenfold/core')
const {
  giris, zarf: { Z }, ledger: { T, createEvent, signEvent, genesisEvent, memberIdOf }, encoding: { T_NAME },
  proposals: { Proposals }, yerelKanal: Y, guestView, v21: { canTask, levelAtLeast }, v23: { tumAileOf }, quorum: { needsMore, REMOTE_WAIT_MS }, ekip: { TERM_MAX_MS },
  identity: { createIdentity }, hello: { CAPS }
} = require('@havenfold/core')
const { dosya: D, hlc: { msOf }, alanlar: { SRC_MAX }, uygulama: { uygulamaDurumu } } = require('@havenfold/records')
const GELEN_EN_COK = 8 // aynı anda tamamlanmamış gelen dosya (BLOB_DATA); fazlası en eskisini düşürür (blobGeldi)
// Yarım dosyaların bellekteki toplam baytı: en çok tek bir en büyük dosya kadar (8 × 2 GiB değil; Codex 5. tur)
const GELEN_BAYT = (Math.ceil(D.MAX_SIZE / D.CHUNK) + 1) * (D.CHUNK + sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES)
const Ol = require('@havenfold/events')
const Gr = require('@havenfold/tasks')
const Uc = require('@havenfold/edge')
const { resolveMember, personOf, validateFields } = require('./common')

const hex = (b) => (typeof b === 'string' ? b : b4a.toString(b, 'hex'))
const unhex = (h) => (typeof h === 'string' ? b4a.from(h, 'hex') : h)
function fail (code) { throw new Error(code) }
const rastgele16 = () => { const b = b4a.alloc(16); sodium.randombytes_buf(b); return b }

// Bare'de de çalışan küçük olay yayıcı
class Emitter {
  constructor () { this._d = new Map() }
  on (ad, fn) { if (!this._d.has(ad)) this._d.set(ad, []); this._d.get(ad).push(fn); return this }
  off (ad, fn) { this._d.set(ad, (this._d.get(ad) || []).filter((f) => f !== fn)); return this }
  emit (ad, ...a) { for (const f of this._d.get(ad) || []) f(...a) }
}

// Kayıt değerlerinin eşitliği (inceleme SDK 5): bayt dizisi bayt bayt, liste öğe öğe, blobRef blobId ile
function equal (a, b) {
  if (b4a.isBuffer(a) || b4a.isBuffer(b)) return b4a.isBuffer(a) && b4a.isBuffer(b) && b4a.equals(a, b)
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => equal(x, b[i]))
  if (a && b && typeof a === 'object' && typeof b === 'object') return b4a.isBuffer(a.blobId) && b4a.isBuffer(b.blobId) && b4a.equals(a.blobId, b.blobId)
  return a === b
}

// Yapay zeka alanları yalnız kaydet() ile (RFC-0019 §11.7 c)
const YZ_ALANLARI = ['_ai', '_aiyol']
// RFC-0025 §2: kanalın eksik komutları (Yuva Hat çizelgesindeki numaralar korunur)
const CHANNEL_COMMAND = {
  LEDGER_SIGN: 14, PROPOSALS: 225, PROPOSAL_REJECT: 226, TASK_CONSENT: 254,
  // RFC-0002 §14, Ek: RFC-0033 §9 s (channel-task.json): ilerleme ve sonuç 'task' olayıyla; 256–259 boş
  TASK_REQUEST: 250, TASK_CANCEL: 251, MACHINE: 252, DEVICES: 253, STANDING_START: 255,
  // D24: tören Yuva Hat çizelgesinden; diğerleri 352–359 (SDK ortak, RFC-0027'ye işlenecek; kollar/D-durum.md İstek 119)
  INVITE_START: 3, INVITE_CONFIRM: 4, JOIN: 5, INVITE_CANCEL: 205,
  RECORD_MOVE: 249, EXPORT: 390, IMPORT: 391, // RFC-0027 §2–§3 (D28: kap 280/281 → 390/391; 280–289 RFC-0005)
  // RFC-0027 §1a: kasa ürün yöntemleri
  VAULT_STATUS: 365, VAULT_PAPER_SHARE: 366, VAULT_PAPER_PRINTED: 367, VAULT_PERSONAL: 368, VAULT_CHILD_BACKUP: 369,
  // RFC-0027 §1a: bakım, Kalkan, yerel kanal ve D19/D23'ün numarasız kalan ürün yöntemleri (sırayı dell verdi)
  CARE_STATUS: 370, CARE_DOSES: 371, CARE_DOSE_MARK: 372, CARE_HEALTH_SETUP: 373,
  SHIELD_STATUS: 374, SHIELD_DISABLE: 375, SHIELD_GUARDIANS: 376, SHIELD_INVITE_ANSWER: 377, SHIELD_RESULT: 378, SHIELD_NOTIFICATIONS: 379, SHIELD_VISIBILITY: 380,
  LOCAL_MESSAGE: 381, VAULT_PENDING_CHANGES: 382, COLLECTION_SENSITIVITY: 383, AI_PLAN_EXTRACT: 384, CAREGIVER_PREPARE: 385, CAREGIVER_PROPOSE: 386,
  VAULT_SETUP_BK: 387, VAULT_SETUP_VRK: 388, // RFC-0027 §1a (D33)
  VAULT_ARCHIVE_MOVE: 389, // RFC-0027 §1a (D40)
  VAULT_RECOVERY_START: 400, VAULT_RECOVERY_SHARE: 401, VAULT_RECOVERY_FINISH: 402, VAULT_ROTATE: 403, VAULT_RECOVERY_STATUS: 404, VAULT_SHARE_APPROVE: 405, // RFC-0027 §1a, RFC-0004 §5–§6 (D67)
  // RFC-0005 §17 ekip (D45); 288–289 köprü
  TEAM_CREATE: 280, TEAM_ROLE: 281, TEAM_ASSIGN: 282, TEAM_TERM: 283, TEAM_NOTICE: 284, TEAM_REMOVE: 285, TEAM_EXIT_STATUS: 286, TEAM_PLACES: 287,
  BRIDGE_PREPARE: 288, BRIDGE_RECEIVE: 289, // RFC-0005 §15 kişisel köprü (D46)
  LOCAL_DRAFT: 352, PERSONAL_MODE_START: 353, PERSONAL_MODE_MOVE: 354, CARE_PROCESS: 355, CARE_MISSED: 356, CARE_CLAIM: 357, SHIELD_ENABLE: 358, SHIELD_REPORT: 359,
  // RFC-0030 §8.1 misafirin sınırlı yazması (D79); 414–419 ayrılmış
  CAREGIVER_WRITE_GRANT: 410, GUEST_PERMISSIONS: 411, GUEST_DROP: 412, GUEST_MY_WRITES: 413
}
// RFC-0003 §5.4 varlık (D98): ürün sunucusu LedgerApi.addBeing / varlikKaldir'e bağlar; 432–439 ayrılmış
const LEDGER_COMMAND = { BEING_ADD: 430, BEING_REMOVE: 431, CAREGIVER_LIST: 440, CAREGIVER_REMOVE: 441, REMOTE_MEMBER_ACTIVATE: 450, MEMBER_REVOKE: 451 } // 440–441: bakıcı (D99); 450–451: uzaktan üye (D106)
const VARLIK_TUR_MAX = 32 // bayt (RFC-0003 §5.4 "serbest metin"; sınır İstek 176)
const VARLIK_AD_MAX = 64
const ZERO16_HEX = '0'.repeat(32)
// RFC-0034 §8.2: bir telefonda birden çok aile; worklet işler (SDK yöntemi değil), çerçevede aile istemez (425 ister). 426–429 ayrılmış
const FAMILY_COMMAND = { FAMILIES: 420, FAMILY_ADD: 421, JOIN_PREPARE: 422, FAMILY_LEAVE: 423, FAMILY_LOCAL_REMOVE: 424, FAMILY_PERMIT_GRANT: 425 }

// --- Kayıt ----------------------------------------------------------------------------------------------------------

// Dosya parçalarının yerel deposu; varsayılan bellek içi ve sınırlı (inceleme SDK 11). Platform kalıcı depo verir:
// { get(blobIdHex) → chunks | null, set(blobIdHex, chunks), delete(blobIdHex) }
class MemoryBlobStore {
  constructor ({ sinir = 64 * 1024 * 1024 } = {}) { this.sinir = sinir; this.m = new Map(); this.boy = 0 }
  get (k) { const v = this.m.get(k); if (v) { this.m.delete(k); this.m.set(k, v) } return v || null }
  set (k, chunks) {
    this.delete(k)
    const n = chunks.reduce((a, x) => a + x.byteLength, 0)
    this.m.set(k, chunks)
    this.boy += n
    for (const [ek] of this.m) { if (this.boy <= this.sinir || ek === k) break; this.delete(ek) } // en eski önce gider
  }

  delete (k) { const v = this.m.get(k); if (v) { this.boy -= v.reduce((a, x) => a + x.byteLength, 0); this.m.delete(k) } }
}

class RecordApi extends Emitter {
  // dosyaYaz(blobRef, bytes) → yol: platform çözülmüş dosyayı kendi alanına yazar (RFC-0001 §16 { path });
  // dosyaOku(yol) → bayt: attach({ path }) için; dosyaYuklendi(blobRef, mesajlar): yükleme mesajlarını taşıyıcıya verir
  // kasa: { kilitli(), dokun() } (VaultApi): kilitliyken kasa koleksiyonunda okuma, yazma, geçmiş ve kasa kaydındaki
  // dosyayı açma VAULT_LOCKED (RFC-0027 §1); her işlem kilit süresini yeniler
  constructor ({ replika, depo = new MemoryBlobStore(), dosyaYaz = null, dosyaOku = null, dosyaYuklendi = null, kasa = null }) {
    super()
    this.r = replika
    this.kasa = kasa
    this.depo = depo
    this.kanca = { dosyaYaz, dosyaOku, dosyaYuklendi }
    this.tutucular = new D.BlobHaveStore() // BLOB_HAVE ile bildirilen kopyalar (kopyaSayisi, komut 248)
    this.eklenen = new Set() // bu telefonda attach ile eklenen dosyalar (RFC-0025 §1 a)
    this._bekleyen = new Map() // cid|rid → true: dönem anahtarı bekleyen yazımlar
    this._gelen = new Map() // blobIdHex → { total, chunks, bayt }
    this._gelenToplam = 0 // yarım dosyaların bellekteki toplam baytı
    this._gelenBayt = GELEN_BAYT
    // Kasa kayıtlarının andığı dosyalar (D36, inceleme 13 bulgu 8): kilitliyken kasa kayıtları çözülemediği için dosyanın
    // kasaya ait olduğu kayıttan anlaşılamaz; dizin kalıcıdır (worklet durumda tutar), kilitliyken denetim buradan
    this.kasaDosyalari = new Set()
  }

  get _L () { return this.r.ledger }

  _kasaDenetle (collectionId) {
    if (this.kasa && this._L.collections.get(hex(collectionId))?.sensitivity === 'kasa') this.kasa.touch()
  }

  // Bütün koleksiyonlar; okunamayan da okur: false ile döner (RFC-0019 §11.7 b)
  collections () {
    const L = this._L
    const me = this.r.meHex
    this.r.sync()
    this._bekleyenleriYay()
    return [...L.collections.values()].map((col) => ({
      collectionId: col.id, name: col.name, kind: col.kind, sensitivity: col.sensitivity, taskAccess: col.taskAccess,
      history: col.history, owner: col.owner, readers: [...col.readers], writers: [...col.writers],
      okur: this.r.yetki.isReader(col.id, me, L.len - 1), writable: this.r.yetki.isWriter(col.id, me, L.len - 1)
    }))
  }

  _kayit (cid, k) {
    return {
      recordId: k.recordId, collectionId: hex(cid), type: k.type, fields: k.fields, authorId: k.authorHex,
      olusturan: k.authorHex, olusturma: msOf(k.stamp.hlc),
      degistiren: hex(k.son.authorId), degisme: msOf(k.son.hlc)
    }
  }

  // Tek kayıt yolu (inceleme SDK 10): yalnız o kaydın işlemleri birleştirilir
  get (collectionId, recordId) {
    this._kasaDenetle(collectionId)
    const k = Ol.olay.kayitlarReplikadan(this.r, hex(collectionId), { recordId: hex(recordId) })[0]
    return k ? this._kayit(collectionId, k) : null
  }

  query (collectionId, { type = null, where = null, limit = Infinity } = {}) {
    this._kasaDenetle(collectionId)
    const out = []
    for (const k of Ol.olay.kayitlarReplikadan(this.r, hex(collectionId))) {
      if (type && k.type !== type) continue
      if (where && !Object.entries(where).every(([a, v]) => equal(k.fields[a], v))) continue
      out.push(this._kayit(collectionId, k))
      if (out.length >= limit) break
    }
    return out
  }

  // Kaydın geçmişi: put, del, append satırları (RFC-0019 8.15). Her satır işlemin kimliğini, yazdığı alanları ve
  // başka bir yazıma kaybettiği alanları taşır ("Ayşe de bu alanı değiştirmişti", D15 3).
  history (collectionId, recordId) {
    this._kasaDenetle(collectionId)
    return this.r.gecmis(hex(collectionId), hex(recordId)).map((x) => ({ op: x.op, opId: x.opId, authorId: x.authorId, at: msOf(x.hlc), alanlar: x.alanlar, kaybeden: x.kaybeden }))
  }

  // Taşıma (Yuva Defteri 01 §5.1; komut 249, RFC-0027 §3): hedefe yeni put, kaynakta del. Yeni kayıt _src, _conf, _ai
  // ve _aiyol'u korur; bunlar yeni yapay zeka çıktısı değil, onaylanmış kaydın kendisidir (D15 6). _src'ye eski kaydın
  // kayit: başvurusu eklenir. degisiklik: taşırken kişinin değiştirdiği alanlar; değişen alan yapay zeka alanı sayılmaz
  // (_ai'den çıkar; hepsi çıkarsa _conf da). Kasa kaynaklı kayıt yalnız kasaya.
  move (kaynakId, recordId, hedefId, degisiklik = null) {
    this._kasaDenetle(hedefId)
    const k = this.get(kaynakId, recordId)
    if (!k) fail('NO_RECORD')
    const L = this._L
    if (L.collections.get(hex(kaynakId))?.sensitivity === 'kasa' && L.collections.get(hex(hedefId))?.sensitivity !== 'kasa') fail('VAULT_SOURCE')
    if (degisiklik && Object.keys(degisiklik).some((a) => a.startsWith('_'))) fail('RESERVED_FIELD')
    const fields = { ...k.fields, ...(degisiklik || {}) }
    if (degisiklik && Array.isArray(fields._ai)) {
      fields._ai = fields._ai.filter((a) => !(a in degisiklik))
      if (!fields._ai.length) { delete fields._ai; delete fields._conf }
    }
    const ref = 'kayit:' + hex(kaynakId) + '/' + hex(recordId)
    const src = Array.isArray(fields._src) ? fields._src.filter((x) => x !== ref) : []
    if (src.length < SRC_MAX) fields._src = [...src, ref]
    const yeni = this._yaz(hedefId, null, k.type, fields)
    this.del(kaynakId, recordId)
    return yeni
  }

  // Genel yazma: yapay zeka alanları reddedilir (kaydet ile yazılır); var olan kayda tür yazılamaz
  put (collectionId, recordId, type, fields) {
    if (YZ_ALANLARI.some((a) => a in fields)) fail('AI_APPROVAL_REQUIRED')
    return this._yaz(collectionId, recordId, type, fields)
  }

  _yaz (collectionId, recordId, type, fields) {
    this._kasaDenetle(collectionId)
    const cid = hex(collectionId)
    const col = this._L.collections.get(cid)
    validateFields(fields, { col })
    if (col && col.sensitivity === 'kasa') for (const id of D.referencedBlobs([{ fields }])) this.kasaDosyalari.add(id)
    const rid = this.r.put(cid, recordId, type, fields)
    this._degisti(cid, rid)
    return rid
  }

  del (collectionId, recordId) {
    this._kasaDenetle(collectionId)
    const cid = hex(collectionId)
    this.r.del(cid, recordId)
    this._degisti(cid, hex(recordId))
  }

  // change yazım gerçekleşince yayılır; dönem anahtarı bekleyen yazım kuyruktan çıkınca (inceleme SDK 25)
  _degisti (cid, rid) {
    if (this.r.kuyrukta(cid, rid)) { this._bekleyen.set(cid + '|' + rid, true); return }
    this.emit('change', cid, [rid])
  }

  _bekleyenleriYay () {
    for (const k of [...this._bekleyen.keys()]) {
      const [cid, rid] = k.split('|')
      if (this.r.kuyrukta(cid, rid)) continue
      this._bekleyen.delete(k)
      this.emit('change', cid, [rid])
    }
  }

  // Defter ya da anahtar değişince çağrılır: replika eşitlenir, bekleyen yazımlar bildirilir
  sync () { this.r.sync(); this._bekleyenleriYay() }

  // Yapay zeka alanlarıyla kayıt yalnız AiApi.save'ten (onay jetonuyla, RFC-0023 madde 104); bu sınıfta yolu yok

  // --- Dosyalar (RFC-0001 §11) ---

  // Her yüklemede yeni rastgele fileKey. Dönüş: blobRef ve yükleme mesajları (BLOB_DATA)
  // bytes ya da path (dosyaOku kancasıyla). dosyaYuklendi kancası varsa yükleme mesajları ona verilir (D15 5).
  attach ({ bytes = null, path = null, mime = 'application/octet-stream', name = '' }) {
    if (!bytes && path !== null) {
      if (!this.kanca.dosyaOku) fail('NO_FILE_READ')
      bytes = this.kanca.dosyaOku(path)
    }
    if (!bytes) fail('NO_FILE')
    const blob = D.encryptBlob(bytes)
    this.depo.set(hex(blob.blobId), blob.chunks)
    this.eklenen.add(hex(blob.blobId))
    const blobRef = { blobId: blob.blobId, fileKey: blob.fileKey, size: blob.size, mime, name }
    const mesajlar = D.uploadMsgs(blob)
    if (this.kanca.dosyaYuklendi) { this.kanca.dosyaYuklendi(blobRef, mesajlar); return { blobRef } }
    return { blobRef, mesajlar }
  }

  // Açılmış dosya: dosyaYaz kancası varsa { path } (RFC-0001 §16), yoksa { bytes }; { bytes: true } ile kanca olsa da
  // bayt (D23 33: OCR'ı bayttan okuyan platform). Parçalar yerelde yoksa NO_FILE. Kasa kaydındaki dosya kilitliyken
  // açılmaz. İkinci değişken eski biçimde parça dizisi de olabilir.
  open (blobRef, secenek = null) {
    const { chunks = null, bytes: baytIste = false } = Array.isArray(secenek) ? { chunks: secenek } : (secenek || {})
    const k = hex(blobRef.blobId)
    if (this.kasa && this._kasaDosyasi(k)) this.kasa.touch()
    const ch = chunks || this.depo.get(k)
    if (!ch) fail('NO_FILE')
    const bytes = D.decryptBlob(blobRef, ch)
    if (this.kanca.dosyaYaz && !baytIste) return { path: this.kanca.dosyaYaz(blobRef, bytes) }
    return { bytes }
  }

  // Dosya bir kasa koleksiyonundaki kayda bağlı mı
  _kasaDosyasi (blobIdHex) {
    if (this.kasaDosyalari.has(blobIdHex)) return true
    const icerir = (v) => (v && typeof v === 'object' && b4a.isBuffer(v.blobId) ? hex(v.blobId) === blobIdHex : Array.isArray(v) && v.some(icerir))
    for (const [cid, col] of this._L.collections) {
      if (col.sensitivity !== 'kasa') continue
      if (this.r.records(cid).some((x) => Object.values(x.fields).some(icerir))) { this.kasaDosyalari.add(blobIdHex); return true }
    }
    return false
  }

  // Gelen BLOB_HAVE (RFC-0019 §9): kutu ya da işçi dosyayı tuttuğunu bildirir; tek giriş noktasından. yol: zarfın
  // geldiği yol ('dogrudan' | 'emanet' | 'posta'; zorunlu, inceleme 11 bulgu 9)
  blobHaveReceived (peerHex, bytes, yol) {
    giris.gelenZarf({ myRole: 'uye', peerRole: this._L.sessionRole(hex(peerHex)), type: Z.BLOB_HAVE, bytes, L: this._L, gonderen: hex(peerHex), yol })
    this.tutucular.al(this._L, bytes)
  }

  // Dosyanın kaç yerde kopyası var (komut 248; Yuva Defteri 01 §6): bu telefon ve BLOB_HAVE bildiren kutu ve işçiler.
  // Başka telefonların kopyası bilinmez; arayüz "en az" der.
  copyCount (blobId) {
    const k = hex(blobId)
    const L = this._L
    const t = this.tutucular.tutucular(k)
    return {
      telefon: this.depo.get(k) ? 1 : 0,
      kutu: t.filter((h) => L.members.get(h)?.role === 'kutu').length,
      isci: t.filter((h) => L.devices.get(h)?.class === 'isci').length
    }
  }

  // Yazımın durumu (D15 16): 'yazildi' | 'kuyrukta' (dönem anahtarı bekleniyor; get o ana kadar null) | 'yok'
  writeStatus (collectionId, recordId) {
    const cid = hex(collectionId)
    const rid = hex(recordId)
    if (this.r.kuyrukta(cid, rid)) return 'kuyrukta'
    return this.r.get(cid, rid) ? 'yazildi' : 'yok'
  }

  // Tutucudan (kutu, işçi, başka telefon) dosyayı isteyen BLOB_REQ
  fetchRequest (blobRef) { return { type: Z.BLOB_REQ, bytes: c.encode(D.blobReq, { blobId: b4a.from(blobRef.blobId), from: 0, count: D.totalOf(blobRef.size) }) } }

  // Gelen BLOB_DATA: bütün parçalar gelip blobId doğrulanınca depoya yazılır. Dönüş: 'tamam' | 'eksik'
  blobReceived (peerHex, bytes, yol) {
    const { mesaj: m } = giris.gelenZarf({ myRole: 'uye', peerRole: this._L.sessionRole(hex(peerHex)), type: Z.BLOB_DATA, bytes, L: this._L, gonderen: hex(peerHex), yol })
    const k = hex(m.blobId)
    // Kutunun alıcısıyla aynı sınırlar (core/records/file.js BlobStore.receive): parça sayısı ve boyu; yarım dosya sayısı
    // GELEN_EN_COK (en eskisi düşer). Açılış öncesi inceleme: total = 2^32-1 dizisi ve sınırsız yarım dosya yok. Yarım
    // dosyaların toplam baytı _gelenBayt'ı aşacaksa en eski öbür yarım dosyalar düşer (Codex 5. tur)
    const parca = m.chunk || b4a.alloc(0)
    if (m.total < 1 || m.index >= m.total || m.total > Math.ceil(D.MAX_SIZE / D.CHUNK) + 1 || parca.byteLength > D.CHUNK + sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES) fail('INVALID_MESSAGE')
    let g = this._gelen.get(k)
    if (!g || g.total !== m.total) {
      if (g) this._gelenDusur(k)
      g = { total: m.total, chunks: new Map(), bayt: 0 }
      this._gelen.set(k, g)
      if (this._gelen.size > GELEN_EN_COK) this._gelenDusur(this._gelen.keys().next().value)
    }
    const fark = parca.byteLength - (g.chunks.get(m.index)?.byteLength || 0)
    for (const x of [...this._gelen.keys()]) {
      if (this._gelenToplam + fark <= this._gelenBayt) break
      if (x !== k) this._gelenDusur(x)
    }
    if (this._gelenToplam + fark > this._gelenBayt) { this._gelenDusur(k); fail('INVALID_MESSAGE') }
    g.chunks.set(m.index, b4a.from(parca))
    g.bayt += fark
    this._gelenToplam += fark
    if (g.chunks.size < g.total) return 'eksik'
    g.chunks = Array.from({ length: g.total }, (_, i) => g.chunks.get(i))
    this._gelenDusur(k)
    if (!b4a.equals(D.blobIdOf(g.chunks), m.blobId)) fail('INVALID_FILE')
    this.depo.set(k, g.chunks)
    return 'tamam'
  }

  _gelenDusur (k) {
    const g = this._gelen.get(k)
    if (!g) return
    this._gelenToplam -= g.bayt
    this._gelen.delete(k)
  }

  // Ağdan işlem ya da anahtar gelince taşıyıcı bildirir
  changed (collectionId, recordIds) {
    const cid = hex(collectionId)
    // Kasa kaydının dosyaları dizine (kilit açıkken çözülmüş kayıttan; kilitliyken kayıt zaten çözülemez)
    if (this._L.collections.get(cid)?.sensitivity === 'kasa') {
      for (const rid of recordIds) { const k = this.r.get(cid, hex(rid)); if (k) for (const id of D.referencedBlobs([k])) this.kasaDosyalari.add(id) }
    }
    this.emit('change', cid, recordIds.map(hex))
  }
}

// --- Olay ---------------------------------------------------------------------------------------------------------

const DAVET_EDEN_ONCELIK_MS = 3_600_000 // D106 K3: bekleme bitiminden sonra 1 saat daveti başlatan ebeveynin
const AFET_MIDLER = 'sos/afet-midler' // RFC-0037 §7: SOS kaydı → afet mid'leri (yerel)

class EventApi extends Emitter {
  // saklama: { get(k), set(k, v) } kalıcı küçük durum (afet bağıyla SOS tekilleştirmesi, RFC-0031 §6); verilmezse bellekte
  // sosTekil: birden çok aileli telefonda örnekler arası ortak SosTekil (ortakMid ile tek bildirim, RFC-0034 §9)
  // afet: DisasterApi (ya da { receiptOf(mid) }): SOS alındısında afet ALINDI'sı (RFC-0037 §7); verilmezse afet yolu yok
  constructor ({ kayit, katalog = new Ol.tur.Katalog(), now = Date.now, saklama = null, sosTekil = null, afet = null }) {
    super()
    this.k = kayit
    this.katalog = katalog
    this.now = now
    this.afet = afet
    const m = new Map()
    this._saklama = saklama || { get: (x) => (m.has(x) ? m.get(x) : null), set: (x, v) => m.set(x, v) }
    this._vakaDurumu = new Map() // vakaHex → son bildirilen durum (on('case'))
    this._sosTekil = sosTekil || new Ol.sos.SosTekil({ saklama, now: () => this.now() })
  }

  _cid (collectionId) {
    if (collectionId === undefined || collectionId === null) fail('COLLECTION_REQUIRED')
    return hex(collectionId)
  }

  _ctx (collectionId) {
    const cid = this._cid(collectionId)
    const r = this.k.r
    return { ledger: r.ledger, katalog: this.katalog, collectionId: cid, col: r.ledger.collections.get(cid), kayitlar: Ol.olay.kayitlarReplikadan(r, cid), me: r.ledger.canonical(r.meHex) }
  }

  registerType (tanim) { return this.katalog.turKaydet(tanim) }

  // alanlar: { t?, subj, place?, scope?, conf?, key?, obs?, keep?, src?, ...ürün alanları }
  write (collectionId, tur, alanlar) {
    const { t = this.now(), subj, place, scope, conf, key, obs, keep, src, ...urun } = alanlar
    const f = Ol.olay.olayAlanlari(this.katalog, tur, { t, subj, place, scope, conf, key, obs, keep, src }, urun)
    return this.k.put(collectionId, null, tur, f)
  }

  query (collectionId, { tur = null, ozne = null, from = -Infinity, to = Infinity, limit = Infinity } = {}) {
    const ol = Ol.olay.olaylar(this._ctx(collectionId)).sayilir
      .filter((e) => (!tur || e.type === tur) && (!ozne || e.subj === ozne) && e.t >= from && e.t < to)
      .sort((a, b) => b.t - a.t)
    return ol.slice(0, limit)
  }

  // --- SOS (RFC-0031) ---
  // Üyenin SOS'u (Yuva Acil ya da Yuva Hat'ın zorlama PIN'i). o: { yol?: 'dugme' | 'zorlama-pin' | 'afet', konum?: { latE5,
  // lonE5, accM, at }, metin? (≤ 64 bayt), pil?, afetMid? (16 bayt ya da hex), ortakMid? (16 bayt ya da hex; aynı basış
  // bütün ailelere yazılınca aynı değer, RFC-0034 §9 K2), sessiz?, t? }. Özne yazanın kendisi.
  // afetMidler (RFC-0037 §7): aynı SOS'un afet yolundaki mid'leri (312 DISASTER_SEND'in dönüşü); bu telefonun yerel durumunda
  // tutulur (7 gün) ve sosAlicilari'nda afet ALINDI'sıyla birleşir. D103 (RFC-0037 A2): kayda da afet_midler olarak yazılır
  // (her alıcı kendi mid'ini bulur, ikinci bildirim gösterilmez); afetMid verilmediyse eski alıcılar için ilk mid afet_mid
  writeSos (collectionId, o = {}) {
    const me = this.k.r.ledger.canonical(this.k.r.meHex)
    if (!me) fail('NO_MEMBER')
    const { yol, konum, metin, pil, afetMid, ortakMid, sessiz, t, afetMidler } = o
    if (afetMidler !== undefined && !(Array.isArray(afetMidler) && afetMidler.every((x) => typeof x === 'string' && /^[0-9a-f]{32}$/.test(x)))) fail('INVALID_BODY')
    const alanlar = { subj: 'uye:' + me, ...(t !== undefined ? { t } : {}) }
    if (yol !== undefined) alanlar.yol = yol
    if (konum) alanlar.konum = [konum.latE5, konum.lonE5, konum.accM, konum.at]
    if (metin !== undefined) alanlar.metin = metin
    if (pil !== undefined) alanlar.pil = pil
    if (afetMid !== undefined) alanlar.afet_mid = typeof afetMid === 'string' ? unhex(afetMid) : afetMid
    if (ortakMid !== undefined) alanlar.ortak_mid = typeof ortakMid === 'string' ? unhex(ortakMid) : ortakMid
    if (sessiz !== undefined) alanlar.sessiz = sessiz
    if (afetMidler && afetMidler.length) {
      alanlar.afet_midler = afetMidler.map(unhex)
      if (afetMid === undefined) alanlar.afet_mid = unhex(afetMidler[0])
    }
    // Motor için geçersiz SOS yazılmaz (alıcıda gösterilir ama vaka açmaz); yazan tarafta önceden reddedilir
    const hata = Ol.sos.sosHatasi({ fields: alanlar, tf: { ...alanlar, _subj: alanlar.subj }, yazar: 'uye', authorHex: this.k.r.meHex })
    if (hata) fail(hata)
    const { subj, ...urun } = alanlar
    const rid = this.write(collectionId, 'hf.sos', { subj, ...urun })
    if (afetMidler && afetMidler.length) {
      const simdi = this.now()
      const es = Object.entries(this._saklama.get(AFET_MIDLER) || {}).filter(([, v]) => v && simdi - v.at < 7 * 86_400_000)
      this._saklama.set(AFET_MIDLER, Object.fromEntries([...es, [rid, { midler: [...afetMidler], at: simdi }]]))
    }
    return rid
  }

  // SOS'un alıcıları (RFC-0037 §6): [{ personId, durum: 'aldi' | 'bekliyor' | 'bilinmiyor', at, yol: 'kayit' | 'afet' | null }].
  // aldi: kişinin bir kimliğinden geçerli hf.sos.alindi ya da o kişiye giden afet mid'inin ALINDI'sı; zaman en erken,
  // gösterimde max(at, SOS anı). bekliyor: alındı yok ve kişinin bütün kimlikleri 'sos-alindi' yeteneğini bildirdi. SOS değilse NO_RECORD
  sosRecipients (collectionId, sosRecordId) {
    const cid = this._cid(collectionId)
    const rid = hex(sosRecordId)
    const r = this.k.r
    const kayit = (this._saklama.get(AFET_MIDLER) || {})[rid]
    const afet = (p) => {
      if (!this.afet || !kayit) return null
      let en = null
      for (const mid of kayit.midler) {
        const x = this.afet.receiptOf(mid)
        if (!x || !x.alindi || r.ledger.personIdOf(x.kimlik) !== p) continue
        if (!en || (x.at !== null && (en.t === null || x.at < en.t))) en = { t: x.at }
      }
      return en
    }
    return Ol.alindi.sosAlicilari(r, cid, rid, { afet })
  }

  // Koleksiyonun bütün SOS'ları, motor için geçersiz olanlar dahil (gecerli: false, neden), yeniden eskiye (§3)
  listSos (collectionId) { return Ol.sos.sosListesi(this._ctx(collectionId)) }

  // Bir SOS için bildirim gösterilsin mi (§6): aynı afetMid önce afet mesajıyla, sonra kayıtla (ya da tersi) gelirse
  // yalnız ilki bildirilir; afetMid'i olmayan SOS her zaman bildirilir. 7 gün hatırlanır. kimlik: bildirimin kaynağı (afet
  // mesajının kimliği ya da SOS kaydı); aynı kimlikle tekrar sorulunca aynı cevap. Vaka bildirimleri için bildirimci()
  // bunu kendisi uygular.
  shouldNotifySos (afetMid, kimlik = null) { return this._sosTekil.bildir(afetMid, kimlik) }

  // Bu telefonun tekil bildirimcisi (RFC-0006 §11.3), afet bağıyla tek bildirim içinde (inceleme 20 B1)
  // aile: familyId hex (birden çok aileli telefonda "en çok bir kez" kümesi (aile, vaka, basamak, sıra); RFC-0034 §9)
  notifier ({ me, gosterilen = [], aile = null }) { return new Ol.merdiven.Bildirimci({ me, gosterilen, now: () => this.now(), sosTekil: this._sosTekil, aile }) }

  cards (collectionId) { return [...Ol.kart.kartlar(this._ctx(collectionId).kayitlar).values()].map((x) => ({ ...x.kart, kopyalar: x.kopyalar })) }

  // Ayar kaydı; var olan kaydın türü de denetlenir (inceleme SDK 18)
  _ayar (tur, collectionId, recordId, alanlar) {
    const def = this.katalog.get(tur)
    if (!def || def.olay) fail('NO_TYPE')
    if (recordId) {
      const k = this.k.get(this._cid(collectionId), recordId)
      if (!k) fail('NO_RECORD')
      if (k.type !== tur) fail('TYPE_MISMATCH')
    }
    return this.k.put(collectionId, recordId, recordId ? '' : tur, alanlar)
  }

  writeCard (collectionId, recordId, alanlar) { return this._ayar('hf.kart', collectionId, recordId, alanlar) }
  writeRoutine (collectionId, recordId, alanlar) { return this._ayar('hf.rutin', collectionId, recordId, alanlar) }
  // RULE_WRITE (265): kural RFC-0006 §9.1 ve RFC-0032'ye uymuyorsa INVALID_RULE (RFC-0032 §14); güncellemede kaydın
  // birleşmiş hâli denetlenir
  writeRule (collectionId, recordId, alanlar) {
    const once = recordId ? this.k.get(this._cid(collectionId), recordId) : null
    if (Ol.kural.kuralHatasi({ ...(once ? once.fields : {}), ...alanlar })) fail('INVALID_RULE')
    return this._ayar('hf.kural', collectionId, recordId, alanlar)
  }

  // Motorun önerdiği yeni vakalar, bastırmalar ve bu telefonun yazacağı basamaklar (çağıran zamanı gelince yazar).
  // Durumu değişen her vaka için 'vaka' olayı yayılır (inceleme SDK 8).
  evaluate (collectionId) {
    const s = Ol.motor.degerlendir(this._ctx(collectionId), this.now())
    for (const v of s.vakalar) {
      const d = { ...v, durum: durumOf(v) }
      const iz = [d.durum, d.ulasilan ? d.ulasilan.join(',') : '', d.bastirilmis].join('|')
      if (this._vakaDurumu.get(v.vaka) === iz) continue
      this._vakaDurumu.set(v.vaka, iz)
      this.emit('case', d)
    }
    return s
  }

  // durum: 'acik' | 'sahipli' | 'cozuldu' | 'kapali' (verilmezse hepsi)
  cases (collectionId, { durum = null } = {}) {
    return this.evaluate(collectionId).vakalar.map((v) => ({ ...v, durum: durumOf(v) })).filter((v) => !durum || v.durum === durum)
  }

  claim (collectionId, vaka) { return this._ayar('hf.vaka.sahip', collectionId, null, Ol.vaka.sahipAlanlari(unhex(vaka), this.now())) }
  close (collectionId, vaka, sonuc) { return this._ayar('hf.vaka.kapat', collectionId, null, Ol.vaka.kapatAlanlari(unhex(vaka), sonuc, this.now())) }

  // Rutinin pencere başına durumu (dizi)
  routineStatus (collectionId, rutinId) {
    const ctx = this._ctx(collectionId)
    const k = ctx.kayitlar.find((x) => x.recordId === hex(rutinId) && x.type === 'hf.rutin')
    const r = k && Ol.rutin.rutinTanimi(k)
    if (!r) fail('NO_ROUTINE')
    const sayilir = Ol.olay.olaylar(ctx).sayilir
    const ol = sayilir.filter((e) => e.type === r.olay && e.subj === r.subj)
    const araliklar = Ol.rutin.kesintiAraliklari(sayilir) // kesinti kopyaları bu koleksiyonda (RFC-0019 §11.5 e)
    return Ol.rutin.rutinDurumu(r, ol, this.now(), { araliklar })
  }
}

// Kapanış çözülmeyi ezmez ama durum tek değerdir: kapali > cozuldu (RFC-0032 §6.3) > sahipli > acik
const durumOf = (v) => (v.kapali ? 'kapali' : v.cozuldu ? 'cozuldu' : v.sahipli ? 'sahipli' : 'acik')

// --- Görev ----------------------------------------------------------------------------------------------------------

class TaskApi extends Emitter {
  // yetenekler: YetenekDefteri; onay: OnayDefteri (kişi başına, personOf ile); gonder(peerHex, type, bytes)
  // profiller: çalışma profilleri (RFC-0008 §10.1; @havenfold/edge ProfilDefteri); verilmezse kurulur, profilAl ile dolar
  constructor ({ ledger, me, yetenekler, onay = null, gonder = () => {}, now = Date.now, rastgele = null, profiller = null }) {
    super()
    this.L = ledger
    this.me = me
    this.y = yetenekler
    this.profiller = profiller || new Uc.profil.ProfilDefteri({ ledger })
    // İlk kullanım onayı kişi başınadır (RFC-0019 4.14)
    this.onay = onay || new Gr.onay.OnayDefteri([], { personOf: (id) => this.L.personIdOf(this.L.resolveMember(id) || id) })
    this.gonder = gonder
    this.now = now
    this.rastgele = rastgele || rastgele16
    this.isler = new Map() // tutamaçHex → iş
    this.byTask = new Map() // taskIdHex → iş
  }

  machine () { return Gr.yetenek.evMakinesi(this.y, this.now()) }

  devices () {
    return this.y.cevrimici(this.now()).map((n) => ({
      deviceId: n.id, class: n.caps.class, name: this.L.devices.get(n.id)?.name || '', status: n.caps.status, cores: n.caps.cores,
      ramTotalMB: n.caps.ramTotalMB, maxTaskRamMB: n.caps.maxTaskRamMB, battery: n.caps.battery, tasks: n.caps.tasks.map((t) => t.type),
      running: n.caps.running.map((r) => ({ taskId: hex(r.taskId), type: r.type, pct: r.pct })),
      consent: this.onay.var(this.me.memberId, n.id), consentAsked: !this.onay.soruGerekli(this.me.memberId, n.id)
    }))
  }

  // Onay ya da geri alma (RFC-0019 8.14): geri alınan onay o işçideki süren işleri iptal eder. Onay yalnız defterde
  // etkin işçiye ve yalnız görev verebilen üyeden (06 Ç7: çocuk görev veremez; TASK_PERMIT izin verdiyse verebilir;
  // misafir ve cihaz hiç). İşçinin sunduğu türlerden biri yeter; işçi çevrimdışıysa yapay zeka türleri (D19 24).
  consent (deviceId, allow) {
    if (allow) {
      const d = this.L.devices.get(hex(deviceId))
      if (!d || !d.active || d.class !== 'isci') fail('NOT_WORKER')
      const n = this.y.cevrimici(this.now()).find((x) => x.id === hex(deviceId))
      const turler = n ? n.caps.tasks.map((t) => t.type) : ['hf.task.ocr', 'hf.task.transcribe', 'hf.task.llm']
      if (!turler.some((t) => canTask(this.L, hex(this.me.memberId), t))) fail('CANNOT_ASSIGN_TASK')
    }
    this.onay.ver(this.me.memberId, hex(deviceId), allow, this.now())
    if (allow) return
    for (const is of new Set(this.isler.values())) {
      if (is.bitti || !is.yrl.p.some((x) => x.isci === hex(deviceId) && (x.durum === 'bekliyor' || x.durum === 'kabul' || x.durum === 'gonderilecek'))) continue
      this.cancel(is.id)
    }
  }

  // RFC-0008 §5: isteğin gerektirdiği özellik (pdf çıktısı, ses biçimi) adayın profilinde; profil göndermeyen Linux sayılır
  _adaylar (type, version, ramMB, standing = false, params = null) {
    const uygun = Uc.profil.yerlestirmeSuzgeci(this.profiller, type, params || {})
    return Gr.yerlestirme.adaylar(this.y, { type, version, ramMB, standing, uye: this.me.memberId, onay: this.onay, now: this.now(), uygun })
  }

  // NODE_PROFILE (0xE0, RFC-0008 §10.1): yalnız doğrudan oturumdan; profil yerleştirmede ve kasa payı adaylığında kullanılır
  receiveProfile (fromHex, bytes, yol) {
    giris.gelenZarf({ myRole: 'uye', peerRole: this.L.sessionRole(hex(fromHex)), type: Z.NODE_PROFILE, bytes, L: this.L, gonderen: hex(fromHex), yol })
    return this.profiller.al(bytes, { from: hex(fromHex) })
  }

  // inputs: blobRef[]; opts: { collectionId, ramMB, minutes, deadline, diskMB?, units?, splittable?, paramsFor?, telefondaYapilabilir? }
  // Dönüş: { id (iş tutamacı), yer: 'isci', taskIds } ya da aday yoksa { yer: 'telefon' | null, hata? }. Olaylar
  // (result, progress) ve cancel tutamaçla çalışır; yeniden denemede taskId değişse de tutamaç sabittir.
  run (type, version, inputs, params, opts) {
    const sirali = this._adaylar(type, version, opts.ramMB, false, params)
    const yer = Gr.yerlestirme.adaySonucu(sirali, !!opts.telefondaYapilabilir)
    if (yer.yer !== 'isci') return yer
    const parcalar = Gr.yerlestirme.planla(sirali, { birim: opts.units || 1, bolunur: !!opts.splittable })
    const now = this.now()
    const yrl = new Gr.yerlestirme.Yerlestirici({
      parcalar,
      adaylar: () => this._adaylar(type, version, opts.ramMB, false, params).map((a) => a.id),
      sure: opts.deadline - now,
      ustSinir: now + Gr.denetim.TASK_MAX_MS - Gr.denetim.URETIM_PAYI_MS,
      now: this.now
    })
    const is = { id: hex(this.rastgele()), type, version, inputs, params, opts, yrl, parcalar, standing: false, bitti: false }
    this.isler.set(is.id, is)
    const taskIds = this._eylemler(is, yrl.baslat())
    return { id: is.id, yer: 'isci', taskIds }
  }

  // Sürekli görev (RFC-0002 §14): tek işçiye, standing: true. Önce standingPermit ile yazar izni defterde olmalı.
  startStanding (type, version, deviceId, params, opts) {
    const is = { id: hex(this.rastgele()), type, version, inputs: [], params, opts, standing: true, bitti: false, yrl: null, parcalar: [] }
    const taskId = this.rastgele()
    const bytes = Gr.istek.gorevKur(this.L, this.me, {
      taskId, workerId: unhex(deviceId), type, version, inputs: [], params, collectionId: unhex(opts.collectionId), deadline: opts.deadline,
      limits: { ramMB: opts.ramMB, minutes: opts.minutes || 0, diskMB: opts.diskMB || 0 }, standing: true
    }, { onay: this.onay, now: this.now() })
    is.taskId = hex(taskId)
    is.isci = hex(deviceId)
    this.isler.set(is.id, is)
    this.byTask.set(is.taskId, is)
    this.gonder(is.isci, Z.TASK, bytes)
    return { id: is.id, taskId: is.taskId }
  }

  // Her eylem ayrı denenir; birinin hatası diğerlerini durdurmaz (inceleme SDK 9)
  _eylemler (is, eylemler) {
    const ids = []
    const kuyruk = [...eylemler]
    while (kuyruk.length) {
      const e = kuyruk.shift()
      try {
        if (e.eylem === 'gonder') {
          if (is.bitti) continue
          const p = is.parcalar[e.parca]
          const taskId = this.rastgele()
          const params = is.opts.paramsFor ? is.opts.paramsFor(p) : is.params
          const deadline = e.deadline ?? is.opts.deadline
          let bytes
          try {
            bytes = Gr.istek.gorevKur(this.L, this.me, {
              taskId, workerId: unhex(e.isci), type: is.type, version: is.version,
              inputs: is.inputs.map((b) => ({ blobId: b.blobId, fileKey: b.fileKey, size: b.size, mime: b.mime })),
              params, collectionId: unhex(is.opts.collectionId), deadline,
              limits: { ramMB: is.opts.ramMB, minutes: is.opts.minutes, diskMB: is.opts.diskMB || 0 }, standing: false
            }, { onay: this.onay, now: this.now() })
          } catch (err) {
            kuyruk.push(...is.yrl.gonderilemedi(e.parca, err.message)) // süre geçmiş ya da onay yok: parça başarısız
            continue
          }
          is.yrl.gonderildi(e.parca, taskId, deadline)
          this.byTask.set(hex(taskId), is)
          this.gonder(e.isci, Z.TASK, bytes)
          ids.push(hex(taskId))
        } else if (e.eylem === 'iptal') {
          this.gonder(e.isci, Z.TASK_CANCEL, Gr.istek.iptalKur(this.L, this.me, unhex(e.taskId)))
        } else if (e.eylem === 'bitti') {
          is.bitti = true
          this.emit('result', is.id, Gr.koordinator.birlestir(unhex(is.yrl.p[0].taskId), e.sonuclar).result)
        } else if (e.eylem === 'basarisiz') {
          if (is.bitti) continue
          is.bitti = true
          // Diğer parçalar da durur
          kuyruk.push(...is.yrl.hepsiniIptal())
          this.emit('result', is.id, { status: 'hata', code: e.code })
        }
      } catch (err) {
        this.emit('error', is.id, err.message)
      }
    }
    return ids
  }

  // İşçiden gelen cevap (TASK_ACCEPT, TASK_REJECT, TASK_PROGRESS, TASK_RESULT), tek giriş noktasından
  receive (fromHex, type, bytes, yol) {
    if (![Z.TASK_ACCEPT, Z.TASK_REJECT, Z.TASK_PROGRESS, Z.TASK_RESULT].includes(type)) return
    const { mesaj: m } = giris.gelenZarf({ myRole: 'uye', peerRole: this.L.sessionRole(hex(fromHex)), type, bytes, L: this.L, gonderen: hex(fromHex), yol })
    const id = hex(m.taskId)
    const is = this.byTask.get(id)
    if (!is) return
    if (is.standing) {
      if (type === Z.TASK_PROGRESS) this.emit('progress', is.id, { pct: m.pct, note: m.note })
      if (type === Z.TASK_RESULT) { is.bitti = true; this.emit('result', is.id, m) }
      if (type === Z.TASK_REJECT) { is.bitti = true; this.emit('result', is.id, { status: 'hata', code: m.code }) }
      return
    }
    if (type === Z.TASK_ACCEPT) this._eylemler(is, is.yrl.kabul(id, fromHex))
    if (type === Z.TASK_REJECT) this._eylemler(is, is.yrl.red(id, fromHex))
    if (type === Z.TASK_PROGRESS) this.emit('progress', is.id, { pct: m.pct, note: m.note })
    if (type === Z.TASK_RESULT) this._eylemler(is, is.yrl.sonuc(id, fromHex, m))
  }

  tick () { for (const is of new Set(this.isler.values())) if (is.yrl && !is.bitti) this._eylemler(is, is.yrl.tick(this.now())) }

  // İşin bütün parçaları iptal edilir; iptal edilen parça başka işçiye gitmez (inceleme SDK 4). id: tutamaç ya da taskId
  cancel (id) {
    const is = this.isler.get(hex(id)) || this.byTask.get(hex(id))
    if (!is) fail('NO_TASK')
    if (is.bitti) return
    is.bitti = true
    if (is.standing) this.gonder(is.isci, Z.TASK_CANCEL, Gr.istek.iptalKur(this.L, this.me, unhex(is.taskId)))
    else this._eylemler({ ...is, bitti: false }, is.yrl.hepsiniIptal())
    this.emit('result', is.id, { status: 'iptal' })
  }

  // Sürekli görev: önce yazar izni (COLLECTION gövdesi), sonra görev. Olayı imzalayıp yazmak çağıranın işi.
  standingPermit (collectionId, deviceId) { return Gr.surekli.izinEkle(this.L, unhex(collectionId), unhex(deviceId)) }
}

// --- Defter ve kişi ------------------------------------------------------------------------------------------------

// Defter yazma yüzeyi (inceleme SDK 15; komut 360–364): aile kurma, üye ve cihaz ekleme ve çıkarma, öneriler,
// eşleşme ve ana kimlik devri. Olaylar me ile imzalanır; eksik imzalar öneriye girer (Proposals, waitingFor).
// Olaylar: 'ledger' (yeni olay), 'security' ({ type: 'app_primary_pending', ... }), 'pair' (eşleşme adımları).
class LedgerApi extends Emitter {
  // appId: bu uygulamanın kimliği (defter ana kimliğin uygulamasını taşımaz; kendi kimliğimiz için buradan, D15 8)
  // capsBook: HELLO yetenek defteri (düzey ve güncelleme bekleyenler, D15 14)
  // uygulamaOf(memberHex) → appId | null: kimliğin hf.uygulama kaydı (RFC-0036 §3.3 madde 5; kayıt katmanı olan çekirdek verir)
  constructor ({ ledger, me = null, gorulme = null, now = Date.now, appId = null, capsBook = null, uygulamaOf = null }) {
    super()
    this.L = ledger
    this.uygulamaOf = uygulamaOf
    this.me = me
    this.g = gorulme
    this.now = now
    this.appId = appId
    this.capsBook = capsBook
    this.oneriler = new Proposals(ledger)
    this._izlenen = 0
  }

  // Yeni aile (RFC-0024 komut 2): kurucunun GENESIS olayı; hazirla ise düzey (varsayılan 2.2; RFC-0030 §8.1'in 2.3'ü İstek 154'ten sonra) ve Yuva Defteri 01 §2.2'nin
  // varsayılan koleksiyonları (Tüm Aile, Ebeveynler, kurucunun Kişisel'i). Dönüş: defter, GENESIS ve sonraki olaylar.
  static createFamily ({ Ledger, me, familyName = '', displayName, policy, ts = Date.now(), hazirla = true, duzey = '2.2' }) {
    const e = genesisEvent(me, { familyName, displayName, ...(policy ? { policy } : {}), ts })
    const L = new Ledger()
    L.apply(e)
    const olaylar = []
    if (hazirla) {
      let saat = ts
      const d = new LedgerApi({ ledger: L, me, now: () => ++saat })
      olaylar.push(d.raiseLevel(duzey).event)
      for (const r of d.defaultCollections()) olaylar.push(r.event)
    }
    return { ledger: L, event: e, olaylar }
  }

  // Eşleşme öncesi (ailesiz) uygulama (D19 27): boş defterle kurulur; yalnız eşleşme (pairRequest, pairAccept) ve
  // yerel kanal keşfi anlamlıdır. pairAccept'in döndürdüğü defterle yeni bir LedgerApi kurulur.
  static withoutFamily ({ Ledger, me, appId = null, now = Date.now }) {
    return new LedgerApi({ ledger: new Ledger(), me, appId, now })
  }

  get hasFamily () { return this.L.len > 0 }

  // Aile bilgisi (RFC-0024 komut 200)
  familyInfo () {
    const L = this.L
    const id = this.me ? hex(this.me.memberId) : null
    const m = id && L.members.get(id)
    return {
      ad: L.familyName,
      duzey: L.level,
      tur: L.kind,
      ben: m ? { memberId: id, personId: L.personIdOf(id), role: m.role, name: m.name } : null,
      cihazlar: this.devices(),
      misafirler: [...L.grants.values()].map((g) => ({ grantId: hex(g.id), name: g.name, collections: [...g.collections], expiresAt: g.expiresAt, active: g.active, yazma: this.caregiverWriteGrants(g.id) }))
    }
  }

  // Düzey yükseltme; capsBook verilmişse herkes biti bildirmiş olmalı (RFC-0003 §2.2 madde 4)
  // Düzey 2.3'e çıkılırken misafir varsa Tüm Aile'ye bırakma anahtarı da açılır (RFC-0031 §4.1; sonuçta sosBirakma).
  raiseLevel (level) {
    const g = this.capsBook && this.L.len > 1 ? this.awaitingUpdate(level) : null
    if (g && !g.hazir) fail('UPDATE_PENDING')
    const r = this._yaz(T.PROTOCOL_LEVEL, { level })
    return r.durum === 'uygulandi' && this.L.activeGrantIds().length ? this._sosAnahtari(r) : r
  }

  // COLLECTION (RFC-0003 §5.9); collectionId verilmezse rastgele
  openCollection ({ collectionId = null, name, kind = 'genel', readers, writers, sensitivity = 'normal', taskAccess = false, history = true, dropKey = b4a.alloc(32) }) {
    return this._yaz(T.COLLECTION, { collectionId: collectionId ? unhex(collectionId) : rastgele16(), name, kind, readers, writers, sensitivity, taskAccess, history, dropKey })
  }

  // Koleksiyonun duyarlılığını değiştirir (D23 30): diğer bütün alanlar aynı kalır. Kasaya geçişte görev erişimi
  // kapanır (kasa kuralı). Kişisel koleksiyonu yalnız sahibi; ortak koleksiyonu kasaya almak bütün ebeveynleri ister
  // (öneri olur). Kapatılmış koleksiyonun duyarlılığı değişmez (RFC-0021 79).
  setSensitivity (collectionId, sensitivity) {
    const col = this.L.collections.get(hex(collectionId))
    if (!col) fail('NO_COLLECTION')
    if (col.readers.length === 0) fail('CLOSED')
    if (col.sensitivity === sensitivity) fail('NO_CHANGE')
    return this._yaz(T.COLLECTION, {
      collectionId: unhex(col.id), name: col.name, kind: col.kind, readers: [...col.readers], writers: [...col.writers], sensitivity,
      taskAccess: sensitivity === 'kasa' ? false : col.taskAccess, history: col.history, dropKey: col.dropKey ? unhex(col.dropKey) : b4a.alloc(32)
    })
  }

  // "Benim kasam" (Yuva Defteri 05): yalnız sahibinin okuduğu kişisel kasa koleksiyonu; sahibi tek imzayla açar
  myPersonalVault ({ name = 'Benim kasam' } = {}) {
    if (!this.me) fail('NO_IDENTITY')
    const ben = 'uye:' + this.L.canonical(hex(this.me.memberId))
    return this.openCollection({ name, kind: 'kisisel', readers: [ben], writers: [ben], sensitivity: 'kasa', taskAccess: false, history: true })
  }

  // Çıkan ve ayrılan üyeler (D23 31; Yuva Defteri 05 §8): kim, rolü, ne zaman (olayın zamanı), nasıl ve hâlâ izin
  // listesinde adı geçen koleksiyonlar (değiştirilecekler). rol verilirse yalnız o rol (ör. 'ebeveyn').
  departed ({ rol = null } = {}) {
    const L = this.L
    const out = []
    for (const e of L.events) {
      if (e.type !== T.REMOVE_MEMBER && e.type !== T.LEAVE) continue
      const b = decodeBody(e.type, e.body)
      const id = hex(b.memberId)
      const m = L.members.get(id)
      if (!m || m.active || (rol && m.role !== rol)) continue
      const koleksiyonlar = [...L.collections.values()].filter((c) => [...c.readers, ...c.writers].includes('uye:' + id)).map((c) => c.id)
      out.push({ memberId: id, name: m.name, role: m.role, cikis: e.ts, tur: e.type === T.LEAVE ? 'ayrildi' : 'cikarildi', ...(e.type === T.REMOVE_MEMBER ? { wipe: b.wipe } : {}), koleksiyonlar })
    }
    return out
  }

  // Yuva Defteri 01 §2.2: ebeveyn ilk açtığında Tüm Aile ve Ebeveynler, her üye için kendi Kişisel'i; yoksa açılır.
  // Kişisel'i yalnız sahibi imzalar. Dönüş: yazılan olayların sonuçları
  defaultCollections () {
    const L = this.L
    const id = hex(this.me.memberId)
    const ben = L.members.get(id)
    if (!ben) fail('NO_MEMBER')
    const ayni = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])
    const var_ = (kosul) => [...L.collections.values()].some((c) => c.readers.length > 0 && kosul(c))
    const TUM = ['rol:ebeveyn', 'rol:yetiskin', 'rol:cocuk']
    const out = []
    if (ben.role === 'ebeveyn') {
      if (!var_((c) => c.kind === 'genel' && c.sensitivity === 'normal' && ayni(c.readers, TUM))) out.push(this.openCollection({ name: 'Tüm Aile', readers: TUM, writers: TUM, taskAccess: true }))
      if (!var_((c) => c.kind === 'genel' && c.sensitivity === 'normal' && ayni(c.readers, ['rol:ebeveyn']))) out.push(this.openCollection({ name: 'Ebeveynler', readers: ['rol:ebeveyn'], writers: ['rol:ebeveyn'], taskAccess: true }))
    }
    const kisi = L.canonical(id)
    if (!var_((c) => c.kind === 'kisisel' && c.readers.length === 1 && c.readers[0].startsWith('uye:') && L.canonical(c.readers[0].slice(4)) === kisi)) {
      const uye = 'uye:' + kisi
      out.push(this.openCollection({ name: 'Kişisel', kind: 'kisisel', readers: [uye], writers: [uye], taskAccess: false }))
    }
    return out
  }

  // Kişiler (ana kimlikler): sınırlar ve oylar bunları sayar (RFC-0017). Kutu kişi değildir. Bekleyenler bekleyen:
  // true ile döner (inceleme SDK 24).
  persons () {
    const L = this.L
    // Uzaktan katılımı bekleyen yeni kişiler de (personIds onları dışarıda bırakır; D15 10)
    const bekleyenKisiler = [...L.members].filter(([id, m]) => m.active && L.isPending(id) && m.pendingRemote && !m.extra && m.role !== 'kutu').map(([id]) => id)
    return [...L.personIds(), ...bekleyenKisiler].map((id) => {
      const m = this.L.members.get(id)
      return { memberId: id, name: m.name, role: m.role, identities: this.L.identitiesOf(this.L.personIdOf(id)), bekleyen: this.L.isPending(id), bekleme: this.waiting(id) }
    })
  }

  // Kişinin bekleyen işi (D15 10): uzaktan katılım, cihaz değişimi ya da ana kimlik devri; bitiş defterin saatiyle
  // (L.readyAt). Dönüş: null | { tur: 'uzaktan' | 'cihaz-degisimi' | 'ana-devir', memberId, bitis }
  waiting (memberId) {
    const L = this.L
    const id = hex(memberId)
    const pid = L.personIdOf(id)
    const kimlikler = new Set([id, ...L.identitiesOf(pid)])
    for (const [x, m] of L.members) {
      if (!m.active) continue
      if (m.pendingRemote && kimlikler.has(x)) return { tur: 'uzaktan', memberId: x, bitis: L.readyAt(x) }
      if (m.pendingRotation && kimlikler.has(m.rotatedFrom)) return { tur: 'cihaz-degisimi', memberId: x, bitis: L.readyAt(x) }
      if (m.pendingPrimary && m.personOf === pid) return { tur: 'ana-devir', memberId: x, bitis: L.readyAt(x) }
    }
    return null
  }

  // Düzey için güncelleme bekleyenler (D15 14): HELLO.caps'te biti (2.2 için COKLU_UYGULAMA) son 30 günde
  // bildirmemiş aktif üyeler ve bekleyen üyeler. capsBook yoksa bilinmez (null).
  awaitingUpdate (level = '2.2') {
    if (!this.capsBook) return null
    const r = this.capsBook.levelReady(this.L, level, { now: this.now(), me: this.me ? hex(this.me.memberId) : null })
    const ad = (x) => this.L.members.get(x)?.name || ''
    return { hazir: r.ok, eksik: r.missing.map((x) => ({ memberId: x, name: ad(x) })), bekleyen: r.pending.map((x) => ({ memberId: x, name: ad(x) })) }
  }

  // Eşleşme öncesi yerel kanal özeti (RFC-0017 §6.2 adım 1–2; D15 9): ailesi olan uygulama bunu yerel kanala koyar,
  // yeni uygulama "Bu telefonda <uygulama>'da '<aile>' var" diye sorar. Sır yoktur: anahtar ve kimlik taşımaz.
  localSummary () {
    if (!this.me) fail('NO_IDENTITY')
    const m = this.L.members.get(hex(this.me.memberId))
    return { v: 1, appId: this.appId, aileAdi: this.L.familyName, kisiSayisi: this.L.personIds().length, benimAdim: m ? m.name : '' }
  }

  // Yerel kanaldan okunan özetin denetimi; geçersizse null
  static decodeLocalSummary (o) {
    if (!o || o.v !== 1 || typeof o.aileAdi !== 'string' || !Number.isSafeInteger(o.kisiSayisi) || o.kisiSayisi < 1 || typeof o.benimAdim !== 'string') return null
    if (o.appId !== null && typeof o.appId !== 'string') return null
    return { appId: o.appId, aileAdi: o.aileAdi.slice(0, 64), kisiSayisi: o.kisiSayisi, benimAdim: o.benimAdim.slice(0, 64) }
  }

  devices () { return this.L.activeDeviceIds().map((id) => ({ deviceId: id, name: this.L.devices.get(id).name, class: this.L.devices.get(id).class })) }
  resolveMember (memberId, atLedgerSeq) { return resolveMember(this.L, memberId, atLedgerSeq) }
  person (memberId) { return personOf(this.L, memberId) }

  presence (memberId) {
    if (!this.g) fail('NO_PRESENCE')
    return this.g.presence(memberId)
  }

  presenceWithin (memberId, saat = 24) {
    if (!this.g) fail('NO_PRESENCE')
    return this.g.presenceWithin(memberId, saat)
  }

  // Kişinin kimlikleri (komut 362, PERSON_IDENTITIES; RFC-0017 §13): { memberId, appId, sameDevice, primary }.
  // appId (RFC-0036 §3.3 madde 5): ek kimlikte APP_ATTACH.appId, öbüründe kendi hf.uygulama kaydı (uygulamaOf: kayıt
  // katmanını bilen çekirdek verir), yoksa null (bilinmiyor). Kendi kimliğimizin kaydı henüz yoksa kurulumdaki appId.
  identities (memberId = this.me && this.me.memberId) {
    const L = this.L
    const pid = L.personIdOf(L.resolveMember(hex(memberId)) || hex(memberId))
    const primary = L.persons.get(pid)?.primary
    return L.identitiesOf(pid).map((id) => {
      const m = L.members.get(id)
      const benim = this.me && id === hex(this.me.memberId)
      const kayit = this.uygulamaOf ? this.uygulamaOf(id) : null
      return { memberId: id, appId: m.appId || kayit || (benim ? this.appId : null), sameDevice: m.extra ? !!m.sameDevice : true, primary: id === primary }
    })
  }

  // Kişide bu uygulama var mı (RFC-0036 §3.3 madde 6): 'var' | 'yok' | 'bilinmiyor'. Kutu sayılmaz.
  personAppStatus (personId, appId) {
    if (!this.L.members.has(hex(personId))) return 'bilinmiyor'
    return uygulamaDurumu(this.identities(personId).filter((k) => this.L.members.get(k.memberId).role !== 'kutu'), appId)
  }

  // Aynı cihazdaki uygulamalar (komut 364): kişinin bu cihaz grubundaki kimlikleri
  localApps () {
    const me = this.L.members.get(hex(this.me.memberId))
    return this.identities().filter((x) => this.L.members.get(x.memberId).group === me.group)
  }

  // --- Yazma ---

  _yaz (type, body) {
    if (!this.me) fail('NO_IDENTITY')
    const e = createEvent(this.L, type, body, this.now())
    signEvent(e, this.me)
    return this._dene(e)
  }

  // Yeter sayı tamsa uygulanır; değilse öneri olur (diğer imzacılar sign() ile ekler)
  _dene (e) {
    try {
      this.L.apply(e)
      this._yeniOlaylar()
      return { durum: 'uygulandi', event: e }
    } catch (err) {
      // Ekipte sahip ve yönetim imzası eksikliği de öneri olur (D45); ailede değil (inceleme 16)
      // Yeni üyenin ve yeni cihazın (işçi töreni, DEVICE_ATTACH) kendi imzası törende JOIN_SIG ile gelir
      if (err.message !== 'NO_NEW_MEMBER_APPROVAL' && err.message !== 'NO_NEW_DEVICE_APPROVAL' && !needsMore(this.L, err.message)) throw err
      const id = this.oneriler.add(e, this.now())
      if (!id) throw err
      return { durum: 'oneri', oneriId: id, waitingFor: this.oneriler.waitingFor(id), event: e }
    }
  }

  // Öneriye imza ekler; tamamlanınca uygulanır
  sign (oneriId) {
    const e = this.oneriler.get(oneriId)
    // Ekipte TERM'in 90 gün sınırı imzalayan telefonda da (inceleme 16 K3; defter de reddeder)
    if (e && e.type === T.TERM && decodeBody(T.TERM, e.body).expiresAt > e.ts + TERM_MAX_MS) fail('TERM_LIMIT')
    this.oneriler.sign(oneriId, this.me)
    const r = this.oneriler.tryApply(oneriId)
    if (r === 'applied') { this._yeniOlaylar(); return this._sosSonrasi(e, { durum: 'uygulandi', event: e }) }
    if (r === 'stale') return { durum: 'dustu', oneriId }
    return { durum: 'oneri', oneriId, waitingFor: this.oneriler.waitingFor(oneriId) }
  }

  // Başkasından gelen öneri (LEDGER_PROPOSE): baytlar tek giriş noktasından (oturum süzgeci, kanonik çözme)
  receiveProposal (fromHex, bytes, yol) {
    const { mesaj: event } = giris.gelenZarf({ myRole: 'uye', peerRole: this.L.sessionRole(hex(fromHex)), type: Z.LEDGER_PROPOSE, bytes, L: this.L, gonderen: hex(fromHex), yol })
    const id = this.oneriler.add(event, this.now())
    if (!id) fail('PROPOSAL_NOT_ALLOWED')
    const r = this.oneriler.tryApply(id)
    if (r === 'applied') this._yeniOlaylar()
    const sonuc = { oneriId: id, durum: r, waitingFor: r === 'waiting' ? this.oneriler.waitingFor(id) : [] }
    return r === 'applied' ? this._sosSonrasi(event, sonuc) : sonuc
  }

  waitingFor (oneriId) { return this.oneriler.waitingFor(oneriId) }

  // Bekleyen öneriler (RFC-0025 §2, komut 225): tür, hedef, wipe (çıkarmada), imzalayanlar, beklenenler, zaman
  listProposals () {
    const L = this.L
    return [...this.oneriler.items].map(([id, it]) => {
      const e = it.event
      let body = null
      try { body = decodeBody(e.type, e.body) } catch {}
      return {
        proposalId: id,
        type: T_NAME[e.type] || String(e.type),
        hedef: body ? oneriHedefi(e.type, body) : null,
        ...(body && typeof body.wipe === 'boolean' ? { wipe: body.wipe } : {}),
        ...(body && e.type === T.TERM ? { expiresAt: body.expiresAt } : {}), // geçicinin süresi imzadan önce görünsün (inceleme 16 K3)
        imzalar: e.sigs.map((x) => hex(x.memberId)),
        waitingFor: this.oneriler.waitingFor(id),
        zaman: it.createdAt
      }
    }).sort((a, b) => a.zaman - b.zaman || (a.proposalId < b.proposalId ? -1 : 1))
  }

  // Yerel ret (komut 226): öneri bu telefonda düşer, kimseye bir şey gitmez
  rejectProposal (oneriId) {
    if (!this.oneriler.items.has(oneriId)) fail('NO_PROPOSAL')
    this.oneriler.reject(oneriId, this.now())
  }

  // --- Bakıcı önerisi (D19 23; D25, RFC-0019 §11.3) --- İki adım: ebeveyn telefonu hazırlar (bakıcı koleksiyonu
  // verilmezse 'Bakıcı:<ad>' açılır), misafirin telefonu olayı imzalar (misafirImzala), ebeveyn kendi imzasıyla gönderir.
  // Dönüş (hazırla): { event, koleksiyon? (COLLECTION sonucu) }; misafirin imzası olmadan GRANT geçersizdir.
  prepareCaregiver ({ deviceCert, ad, koleksiyonlar = null, expiresAt, ceremonyTranscriptHash }) {
    if (!this.me) fail('NO_IDENTITY')
    if (typeof ad !== 'string' || !ad.trim()) fail('NAME_REQUIRED')
    // grantedBy imzacı ebeveyn olmalı (RFC-0019 §11.3 a); başkasının hazırladığı öneri hiç tamamlanamaz
    if (this.L.members.get(this.L.canonical(hex(this.me.memberId)) || '')?.role !== 'ebeveyn') fail('PARENT_REQUIRED')
    let koleksiyon = null
    let cids = koleksiyonlar ? koleksiyonlar.map(hex) : null
    if (!cids) {
      koleksiyon = this.openCollection({ name: 'Bakıcı:' + ad.trim(), kind: 'bakici', readers: ['rol:ebeveyn'], writers: ['rol:ebeveyn'], history: false })
      if (koleksiyon.durum !== 'uygulandi') return { koleksiyon, event: null }
      cids = [hex(decodeBody(T.COLLECTION, koleksiyon.event.body).collectionId)]
    }
    const event = createEvent(this.L, T.GRANT, {
      to: deviceCert, name: ad.trim(), collections: cids.map(unhex), taskTypes: [], expiresAt, ceremonyTranscriptHash: unhex(ceremonyTranscriptHash), grantedBy: this.me.memberId
    }, this.now())
    return { event, koleksiyon }
  }

  // Bakıcılar (D99): süren ve biten misafirlikler. bitis: GRANT expiresAt (ms); aktif: defterde iptal edilmemiş
  caregivers () {
    return [...this.L.grants.values()].map((g) => ({ grantId: hex(g.id), ad: g.name, bitis: g.expiresAt, koleksiyonlar: [...g.collections], aktif: !!g.active, verenId: g.grantedBy }))
  }

  // Bakıcıyı kaldırır (RFC-0003 §5.5 olay 18 REVOKE; D99): herhangi bir ebeveyn. Dönüş: _yaz sonucu ve iptal: GUEST_REVOKED
  // baytları (misafire açık oturumdan gider; RFC-0019 §11.3 b)
  removeCaregiver (grantId, { neden = '' } = {}) {
    if (!this.me) fail('NO_IDENTITY')
    if (this.L.members.get(this.L.canonical(hex(this.me.memberId)) || '')?.role !== 'ebeveyn') fail('PARENT_REQUIRED')
    const g = typeof grantId === 'string' ? this.L.grants.get(grantId) : null
    if (!g || !(g.active || (g.orphaned && !g.revoked))) fail('NO_TARGET')
    if (typeof neden !== 'string' || b4a.byteLength(neden) > 128) fail('INVALID_BODY')
    const r = this._yaz(T.REVOKE, { grantId: b4a.from(grantId, 'hex'), reason: neden })
    const iptal = r.durum === 'uygulandi' ? guestView.encodeGuestRevoked(this.L.familyId, b4a.from(grantId, 'hex'), r.event, this.me) : null
    return { ...r, iptal }
  }

  // Misafirin telefonunda: hazırlanan GRANT olayına misafirin imzası (kendi kimliğiyle)
  static signGuest (event, misafir) {
    const e = { ...event, sigs: [...event.sigs] }
    signEvent(e, misafir)
    return e.sigs.find((x) => b4a.equals(x.memberId, misafir.memberId))
  }

  // Ebeveyn telefonunda: misafirin imzası ve kendi imzasıyla deftere (yeter sayı tamsa) ya da öneri
  proposeCaregiver (event, misafirImzasi) {
    if (!this.me) fail('NO_IDENTITY')
    if (event.type !== T.GRANT || !misafirImzasi) fail('INVALID_BODY')
    const e = { ...event, sigs: [misafirImzasi] }
    signEvent(e, this.me)
    const r = this._dene(e)
    return r.durum === 'uygulandi' ? this._sosAnahtari(r) : r
  }

  // RFC-0031 §4.1: düzey 2.3'te misafir ekleyen ya da düzeyi yazan ebeveyn telefonu, Tüm Aile'de dropKey yoksa açar
  // (misafirin örtük hf.sos izni). Açılırsa sonuca sosBirakma: { collectionId, secret } eklenir; gizli yarı bu
  // telefonun replikasına verilir (RecordApi.r.addDropSecret), birakmaAnahtariAc'taki gibi.
  // Öneri yolunda (sign, oneriAl) uygulanan GRANT ya da misafirli düzey yükseltmesi de misafirin örtük SOS iznini açar
  // (inceleme 20 B4)
  _sosSonrasi (e, r) {
    if (e.type === T.GRANT || (e.type === T.PROTOCOL_LEVEL && this.L.activeGrantIds().length)) return this._sosAnahtari(r)
    return r
  }

  _sosAnahtari (r) {
    const L = this.L
    const cid = levelAtLeast(L.level, '2.3') ? tumAileOf(L) : null
    if (!cid || !L.collections.get(cid).dropKey.every((x) => x === 0) || this.L.members.get(L.canonical(hex(this.me.memberId)) || '')?.role !== 'ebeveyn') return r
    // Asıl olay uygulandı; anahtar açılamazsa hata sonuca yazılır, atılmaz (sonra birakmaAnahtariAc ile denenir)
    try {
      const a = this.openDropKey(cid)
      return { ...r, sosBirakma: a.birakma, sosAnahtarOlayi: a }
    } catch (err) {
      return { ...r, sosHata: err.message }
    }
  }

  // --- Bakıcının bırakma izni (RFC-0030 §3, §5) --- Düzey 2.3 ister. Koleksiyonda dropKey yoksa önce
  // birakmaAnahtariAc; types boş verilirse izin kalkar.
  grantCaregiverWrite ({ grantId, collectionId, types, subjects }) {
    return this._yaz(T.GRANT_WRITE, { grantId: unhex(grantId), collectionId: unhex(collectionId), types, subjects })
  }

  // Koleksiyona yeni bırakma anahtarı: diğer alanlar aynı kalır. Dönüş: _yaz sonucu ve birakma: { collectionId, secret };
  // gizli yarı bu telefonun replikasına verilir (RecordApi.r.addDropSecret), oradan okuyuculara gider. Öneri olursa da
  // verilir: anahtar defterde yürürlüğe girene kadar kullanılmaz.
  openDropKey (collectionId) {
    const col = this.L.collections.get(hex(collectionId))
    if (!col) fail('NO_COLLECTION')
    if (col.readers.length === 0) fail('CLOSED')
    const pk = b4a.alloc(32)
    const sk = b4a.alloc(32)
    sodium.crypto_box_keypair(pk, sk)
    let r
    try {
      r = this._yaz(T.COLLECTION, {
        collectionId: unhex(col.id), name: col.name, kind: col.kind, readers: [...col.readers], writers: [...col.writers],
        sensitivity: col.sensitivity, taskAccess: col.taskAccess, history: col.history, dropKey: pk
      })
    } catch (err) {
      sodium.sodium_memzero(sk)
      throw err
    }
    return { ...r, birakma: { collectionId: col.id, secret: sk } }
  }

  // Misafirin bırakma izinleri: [{ collectionId, types, subjects }]
  caregiverWriteGrants (grantId) {
    const gid = hex(grantId)
    return [...this.L.collections.keys()].sort().map((cid) => ({ cid, gw: this.L.grantWriteOf(gid, cid) })).filter((x) => x.gw)
      .map(({ cid, gw }) => ({ collectionId: cid, types: [...gw.types], subjects: [...gw.subjects] }))
  }

  // --- Varlık: hayvan, bitki… (RFC-0003 §5.4, olay 16 BEING; D98) ---
  // İmzacı herhangi bir ebeveyn: ebeveyn yazınca hemen uygulanır; yetişkin yazınca öneri olur, bir ebeveyn LEDGER_SIGN (14)
  // ile tamamlar. Çocuk, kutu, misafir ve ailesiz kimlik yazamaz (PARENT_REQUIRED, NO_MEMBER). En çok 32 aktif varlık
  // (BEING_LIMIT), düzey 2.1 (LEVEL_TOO_LOW).
  beings () {
    return [...this.L.beings.values()].filter((b) => b.active).map((b) => ({ varlikId: b.id, tur: b.kind, ad: b.name, yerId: b.placeId === ZERO16_HEX ? null : b.placeId }))
  }

  _varlikYazari () {
    if (!this.me) fail('NO_IDENTITY')
    const id = hex(this.me.memberId)
    const m = this.L.members.get(this.L.canonical(id) || id) // kutunun kişi kimliği yok
    if (!m || !m.active) fail('NO_MEMBER')
    if (m.role !== 'ebeveyn' && m.role !== 'yetiskin') fail('PARENT_REQUIRED')
  }

  // o: { tur (kedi, kopek…; 1–32 bayt), ad (1–64 bayt), yerId? (PLACE), varlikId? (16 bayt hex; yoksa rastgele) }
  // Dönüş: { durum: 'uygulandi' | 'oneri', oneriId?, waitingFor?, varlikId }
  addBeing ({ tur, ad, yerId = null, varlikId = null } = {}) {
    this._varlikYazari()
    if (typeof tur !== 'string' || !tur || b4a.byteLength(tur) > VARLIK_TUR_MAX) fail('INVALID_BODY')
    if (typeof ad !== 'string' || !ad.trim() || b4a.byteLength(ad) > VARLIK_AD_MAX) fail('INVALID_BODY')
    if (yerId !== null && !(typeof yerId === 'string' && /^[0-9a-f]{32}$/.test(yerId))) fail('INVALID_BODY')
    if (varlikId !== null && !(typeof varlikId === 'string' && /^[0-9a-f]{32}$/.test(varlikId))) fail('INVALID_BODY')
    const id = varlikId ? b4a.from(varlikId, 'hex') : (() => { const b = b4a.alloc(16); sodium.randombytes_buf(b); return b })()
    const r = this._yaz(T.BEING, { beingId: id, kind: tur, name: ad, placeId: yerId ? b4a.from(yerId, 'hex') : b4a.alloc(16), remove: false })
    return { ...r, varlikId: hex(id) }
  }

  // Varlığı aile kaydından kaldırır (remove: true); ebeveyn hemen, yetişkin öneriyle
  removeBeing (varlikId) {
    this._varlikYazari()
    const b = typeof varlikId === 'string' ? this.L.beings.get(varlikId) : null
    if (!b || !b.active) fail('NO_TARGET')
    const r = this._yaz(T.BEING, { beingId: b4a.from(b.id, 'hex'), kind: b.kind, name: b.name, placeId: b4a.from(b.placeId, 'hex'), remove: true })
    return { ...r, varlikId: b.id }
  }

  // remote: uzaktan katılım (kurucu ilke 2, K15): bütün ebeveynler (tek ebeveynde bir yetişkin de) imzalar, üye 24 saat
  // bekleyendir; activatesAt verilmezse şimdi + 24 saat (+1 dk pay: olayın ts'i biraz sonra alınır)
  addMember ({ deviceCert, displayName, role, ceremonyTranscriptHash, remote = false, activatesAt = 0 }) {
    if (remote && !activatesAt) activatesAt = this.now() + REMOTE_WAIT_MS + 60_000
    return this._yaz(T.ADD_MEMBER, { deviceCert, displayName, role, inviterId: this.me.memberId, ceremonyTranscriptHash, remote, activatesAt })
  }

  // Uzaktan ekleme tören içinde tamamlanır mı (D101): bu telefonun ve yeni gelenin imzası yeter sayıyı tutuyor mu.
  // Defter durumu değişmeden denenir (L.check, atılan bir deneme kimliğiyle). Dönüş: null ya da defterin hata kodu
  // (NO_PARENT_APPROVAL, NO_ADULT_APPROVAL, NO_QUORUM, MEMBER_LIMIT …)
  remoteMissing (role) {
    if (!this.me) fail('NO_IDENTITY')
    const deneme = createIdentity({ platform: 'deneme' })
    const e = createEvent(this.L, T.ADD_MEMBER, { deviceCert: deneme.deviceCert, displayName: 'deneme', role, inviterId: this.me.memberId, ceremonyTranscriptHash: b4a.alloc(32, 1), remote: true, activatesAt: this.now() + REMOTE_WAIT_MS + 60_000 }, this.now())
    signEvent(e, this.me)
    signEvent(e, deneme)
    try { this.L.check(e); return null } catch (err) { return err.message }
  }

  // Bekleyen üyeyi etkinleştirir (ACTIVATE_MEMBER; K15): uzaktan eklenen ya da cihaz değişimiyle bekleyen; herhangi bir
  // ebeveyn, bekleme bitince. Süre dolmadan WAITING_IN_PROGRESS (defter de erken olayı bekletir); bekleyen değilse BEKLEMIYOR
  // D106 K3: uzaktan eklenen üyeyi daveti başlatan ebeveynin telefonu bekleme bitince kendiliğinden yazar
  // (uzaktanEtkinlestirilecekler); öbür ebeveynler bekleme bitiminden 1 saat sonrasına kadar INVITE_ER_PENDING alır
  activateMember (memberId) {
    const id = hex(memberId)
    const m = this.L.members.get(id)
    if (!m || !m.active || !(this.L.isPending(id) || m.pendingPrimary)) fail('NOT_WAITING')
    const hazir = this.L.readyAt(id)
    if (this.now() < hazir) fail('WAITING_IN_PROGRESS')
    if (m.pendingRemote && m.inviterId && this.me && m.inviterId !== hex(this.me.memberId) && this.L.members.get(m.inviterId)?.active && this.now() < hazir + DAVET_EDEN_ONCELIK_MS) fail('INVITE_ER_PENDING')
    return this._yaz(T.ACTIVATE_MEMBER, { memberId: unhex(id) })
  }

  // Bu telefonun kendiliğinden etkinleştireceği uzaktan üyeler (D106 K3): daveti bu kimlik başlatmış, bekleme bitmiş
  remoteToActivate () {
    if (!this.me) return []
    const ben = hex(this.me.memberId)
    const simdi = this.now()
    return [...this.L.members].filter(([id, m]) => m.active && m.pendingRemote && this.L.isPending(id) && m.inviterId === ben && simdi >= this.L.readyAt(id)).map(([id]) => id)
  }

  // D106 K1 (ii): bekleyen uzaktan üyenin davetini iptal eder (REVOKE; herhangi bir ebeveyn, tek imza). Defter kuralı
  // yeni olduğu için ailenin bütün aktif telefonları, kutusu, cihazları ve cihaz değişimiyle bekleyen telefonları
  // (defteri onlar da doğrular) son 30 günde UZAKTAN_IPTAL bitini bildirmiş olmalı (eski sürüm olayı reddeder ve
  // eşitlemesi takılırdı); değilse UPDATE_PENDING (eksik: hex listesi; Codex 10. tur). Öbür uzaktan bekleyenler
  // sorulmaz: oturumları olmadığı için bitleri burada görülmez, uzaktan tören biti zaten ister (core/transport/ceremony.js);
  // sorulsalardı iki uzaktan davet birbirinin iptalini 24 saat kilitlerdi
  revokeMember (memberId, { reason = 'iptal' } = {}) {
    const id = hex(memberId)
    const m = this.L.members.get(id)
    if (!m || !m.active || !m.pendingRemote || !this.L.isPending(id)) fail('NO_TARGET')
    if (this.capsBook) {
      const ben = this.me ? hex(this.me.memberId) : null
      const degisim = this.L.pendingIds().filter((x) => !this.L.members.get(x).pendingRemote)
      const eksik = [...this.L.activeIds(), ...degisim, ...this.L.activeDeviceIds()].filter((x) => x !== ben && x !== id && !this.capsBook.has(x, CAPS.UZAKTAN_IPTAL, this.now()))
      if (eksik.length) { const err = new Error('UPDATE_PENDING'); err.eksik = eksik; throw err }
    }
    return this._yaz(T.REVOKE, { grantId: unhex(id), reason })
  }

  removeMember (memberId, { reason = '', wipe = false } = {}) { return this._yaz(T.REMOVE_MEMBER, { memberId: unhex(memberId), reason, wipe }) }
  leave () { return this._yaz(T.LEAVE, { memberId: this.me.memberId }) }
  changeRole (memberId, role) { return this._yaz(T.SET_ROLE, { memberId: unhex(memberId), role }) }

  addDevice ({ deviceCert, cls, name, placeId, caps, ceremonyTranscriptHash }) {
    return this._yaz(T.DEVICE_ATTACH, { deviceCert, class: cls, name, placeId: unhex(placeId), caps, ceremonyTranscriptHash })
  }

  removeDevice (deviceId, { reason = '', wipe = false, wipeReportHash = b4a.alloc(32) } = {}) {
    return this._yaz(T.DEVICE_DETACH, { deviceId: unhex(deviceId), reason, wipe, wipeReportHash })
  }

  // Ana kimliği bu kişinin başka bir kimliğine devreder (komut 363, PRIMARY_HANDOVER; RFC-0017 §13). Eski kimlik imzalıyorsa hemen; değilse 72 saat.
  handOverPrimary (newPrimaryId, { yeni = null } = {}) {
    const L = this.L
    const pid = L.personIdOf(hex(this.me.memberId))
    const primary = L.persons.get(pid)?.primary
    const e = createEvent(L, T.APP_PRIMARY, {
      personId: unhex(pid), newPrimaryId: unhex(newPrimaryId), against: unhex(primary),
      oldSigned: primary === hex(this.me.memberId), parentSigned: false
    }, this.now())
    signEvent(e, this.me)
    if (yeni && hex(yeni.memberId) !== hex(this.me.memberId)) signEvent(e, yeni)
    return this._dene(e)
  }

  // --- Eşleşme (komut 360–361, RFC-0017 §6.2) ---

  // Yeni uygulama: APP_PAIR_REQ baytları; familyId (hex ya da bayt) verilirse APP_PAIR_REQ2 (RFC-0034 §4.6, komut 360).
  // Türü pairTuru verir (yerel kanala bırakılırken)
  pairRequest (appId, { familyId = null } = {}) {
    const f = familyId === null ? null : typeof familyId === 'string' ? (/^[0-9a-f]{64}$/.test(familyId) ? b4a.from(familyId, 'hex') : fail('NO_FAMILY')) : familyId
    this._pair = new Y.PairNew({ me: this.me, appId, now: this.now, familyId: f })
    const bytes = this._pair.request()
    this.emit('pair', { adim: 'istek', appId })
    return bytes
  }

  get pairKind () { return this._pair ? this._pair.tur : null }

  // Ana kimlik: kullanıcının onayıyla APP_PAIR_OK
  pairApprove (reqBytes, { approved, replaces = null }) {
    // Yerel kanal girişi (RFC-0017 §6.2); 0xE8 ve 0xEB kanonik çözmeyle ayrılır (RFC-0034 §4.6)
    let tur = Z.APP_PAIR_REQ
    try { canonical(Y.pairReq, reqBytes, 'INVALID_MESSAGE') } catch { try { canonical(Y.pairReq2, reqBytes, 'INVALID_MESSAGE'); tur = Z.APP_PAIR_REQ2 } catch {} }
    giris.gelenZarf({ kanal: 'yerel', type: tur, bytes: reqBytes })
    const r = new Y.PairOld({ me: this.me, ledger: this.L, now: this.now }).answer(reqBytes, { approved, replaces })
    this.emit('pair', { adim: 'onay' })
    return r
  }

  // Yeni uygulama: APP_PAIR_OK'i kabul eder; dönüş defter ve imzalı APP_ATTACH
  pairAccept (okBytes) {
    if (!this._pair) fail('PAIRING_STATUS')
    giris.gelenZarf({ kanal: 'yerel', type: Z.APP_PAIR_OK, bytes: okBytes })
    const r = this._pair.accept(okBytes)
    this.emit('pair', { adim: 'tamam' })
    return r
  }

  // Defter dışarıdan değişince (eşitleme) çağrılır: yeni olaylar ve güvenlik bildirimleri yayılır
  changed () { this._yeniOlaylar() }

  _yeniOlaylar () {
    const L = this.L
    for (; this._izlenen < L.len; this._izlenen++) {
      const e = L.events[this._izlenen]
      this.emit('ledger', e)
      // Kişimin bekleyen ana kimlik devri (inceleme RFC-0017 11): veto için uyarı
      if (e.type === T.APP_PRIMARY && this.me) {
        const pid = L.personIdOf(hex(this.me.memberId))
        const yeni = L.members.get(hex(decodeBody(T.APP_PRIMARY, e.body).newPrimaryId))
        if (yeni && yeni.pendingPrimary && yeni.personOf === pid) this.emit('security', { type: 'app_primary_pending', memberId: hex(yeni.id), seq: e.seq })
      }
      // D106 K1 (i): uzaktan ekleme bekliyor; ebeveynlere "<ad> uzaktan ekleniyor, <bitiş>'e kadar iptal edebilirsiniz"
      if (e.type === T.ADD_MEMBER && this.me && L.members.get(hex(this.me.memberId))?.role === 'ebeveyn') {
        const b = decodeBody(T.ADD_MEMBER, e.body)
        const id = hex(memberIdOf(b.deviceCert.ukaPub))
        const m = L.members.get(id)
        if (b.remote && m && m.active && L.isPending(id)) this.emit('security', { type: 'uzaktan_ekleniyor', memberId: id, ad: m.name, bitis: L.readyAt(id), seq: e.seq })
      }
      if (e.type === T.REVOKE && L.members.has(hex(decodeBody(T.REVOKE, e.body).grantId))) this.emit('security', { type: 'uzaktan_iptal', memberId: hex(decodeBody(T.REVOKE, e.body).grantId), seq: e.seq })
    }
  }
}

// Önerinin hedefi: çıkarılan üye, cihaz, misafir, koleksiyon … (başlıkta "<ad> ve sil" yazılabilsin; D19 22)
function oneriHedefi (type, b) {
  if (b.deviceCert && type === T.ADD_MEMBER) return hex(memberIdOf(b.deviceCert.ukaPub))
  if (b.deviceCert && type === T.DEVICE_ATTACH) return hex(memberIdOf(b.deviceCert.ukaPub))
  if (b.to && type === T.GRANT) return hex(memberIdOf(b.to.ukaPub))
  for (const k of ['memberId', 'deviceId', 'grantId', 'collectionId', 'placeId', 'beingId', 'personId', 'subjectId', 'oldMemberId', 'linkId']) {
    if (b[k] && b4a.isBuffer(b[k])) return hex(b[k])
  }
  return null
}

// Ağdan ya da yerel kanaldan zarf baytı alan bütün SDK giriş noktaları; her biri giris.gelenZarf'tan geçer.
// Yeni bir giriş eklenirse buraya yazılır; sdk/test/ingress.js listeyi ve kaynağı denetler (D12).
const ENTRY_POINTS = ['RecordApi.blobReceived', 'RecordApi.blobHaveReceived', 'TaskApi.receive', 'LedgerApi.receiveProposal', 'LedgerApi.pairApprove', 'LedgerApi.pairAccept', 'VaultApi.receiveShare', 'VaultApi.receiveAck', 'VaultApi.receiveVersionRequest', 'VaultApi.receiveVersionReply', 'VaultApi.receiveShareRequest', 'VaultApi.receiveShareReply', 'VaultApi.receiveEnvelopeAck', 'VaultApi.receiveEnvelopeReply', 'TeamApi.receiveExit', 'TeamApi.receiveReceipt', 'ServiceApi.receivePreview',
  // RFC-0008 §13 (uç cihaz)
  'CameraApi.configSeen', 'CameraApi.receiveStatus', 'CameraApi.receiveAccept', 'CameraApi.receiveClose',
  'CameraApi.receiveWipeReport', 'EdgeDevice.receiveConfig', 'EdgeDevice.receiveStreamRequest', 'EdgeDevice.receiveClose', 'EdgeDevice.receiveRemoval', 'EdgeDevice.receiveScreen', 'EdgeDevice.receiveTask', 'TaskApi.receiveProfile']

module.exports = { Emitter, MemoryBlobStore, RecordApi, EventApi, TaskApi, LedgerApi, equal, ENTRY_POINTS, CHANNEL_COMMAND, FAMILY_COMMAND, LEDGER_COMMAND }
