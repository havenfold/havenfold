// SPDX-License-Identifier: Apache-2.0
// vault.js — SDK'nın kasa arayüzü (RFC-0004, RFC-0027 §1; D23 29): kilit, durum, YA ve KRA kurulumu, kâğıt pay, çocuk
// yedeği. @havenfold/vault'nın ürünlere açılan yüzü.
//
// Sırlar (YA, KRA) platformdadır; SDK onları kurulumda bir kez alır, payları üretir ve belleği sıfırlar. Kâğıt payın
// metni yalnız kurulum sonucunda döner, saklanmaz; saklanan yalnız dağıtımın özeti (sürüm, eşik, sahipler, hangi
// kâğıdın basıldığı). Kilit durumu bu telefondadır: 5 dakika işlemsizlikte kendiliğinden kilitlenir (Yuva Defteri 05
// §2.3). Kilitliyken RecordApi kasa koleksiyonunda VAULT_LOCKED döner (kasa kancası).
//
// Kurtarma ve döndürme (RFC-0004 §5–§6, D67): telefon kaybolunca yeni telefon pay sahiplerine önce sürümü sorar
// (KASA_VERSION_REQ), o sürümün payını ister (KASA_SHARE_REQ, imzalı); kutu ve TPM'li işçi denetimler geçince sormadan,
// telefon kullanıcının onayıyla verir (KASA_SHARE_RES). Kâğıt pay okutulur. Eşik kadar pay birleşince YA platforma döner
// (sahibinin sırrı), KRA kanala çıkmaz: verilen kasa zarflarını açar. Hemen ardından döndürme: yeni sır, sürüm bir
// artar, paylar bugünkü sahiplere yeniden dağıtılır (tutucular eski sürümü siler), verilen zarflar yeni KRA ile yeniden
// şifrelenir. Kurtarma durumu bellektedir (sır yalnız birleştirmeyle döndürme arasında, sonra sıfırlanır).
//
// İnceleme 19 ve RFC-0027 §9 (Mac): sürüm cevabı yalnız sorulan ve pay tutabilecek kimlikten, pay cevabı yalnız payı
// istenen tutucudan alınır; toplanan paylar sürüme göre durur, silinmez; tutucu başına bir pay (B2, B8). LOCK kurtarılan
// sırrı, toplanan payları ve gönderilmemiş onaylı payları sıfırlar (B4, B10). Tutucu telefon onayı yalnız kasa açıkken
// verir (§9 a, B9); kilitliyken gelen istek de bütün denetimlerden geçer, aynı istekçi ve sürüm için tek bekleyen istek
// durur, onay gelişten 10 dakika geçerlidir (B11, B12). Döndürme eski sırrı bilmeyi ister: YA'da bu telefonda kurulmuş
// ya da kurtarılmış olmalı, KRA'da kurtarılmış, bu telefonda saklı ya da kasa açık olmalı (B1, B5). Görülen en büyük
// sürüm saklanır, döndürme ondan bir fazlasıdır; bilinen daha yeni sürüm varken eski sürümle kurtarma STALE_VERSION (§9 f,
// B7). Eşzamanlı döndürmede commit'i küçük olan dağıtım kazanır, kaybeden geri çeker (§9 e, B6). KRA zarfı kasa
// koleksiyonunda 'hf.kasa.zarf' kaydıdır: KRA'yı bilen telefon kasa açıkken her dönem değişiminde yeniden üretir,
// kurtarmada açılan dönem anahtarları replikaya girer (§9 b). Ailede kutu varsa zarfın opak kopyası kutuya da gider;
// KRA'yı kurtaran telefon onu KRA'dan türetilen etiketle kutudan ister (§9 g). Kutu yoksa ve hiçbir zarf açılamazsa
// (tam felaket) 402 NO_ENVELOPE.
const b4a = require('b4a')
const sodium = require('sodium-native')
const K = require('@havenfold/vault')
const { giris } = require('@havenfold/core')
const { Emitter } = require('./api')

const hex = (b) => (typeof b === 'string' ? b : b4a.toString(b, 'hex'))
function fail (code) { throw new Error(code) }

const VAULT_COMMAND = { LOCK: 19, UNLOCK: 224, VAULT_STATUS: 365, VAULT_PAPER_SHARE: 366, VAULT_PAPER_PRINTED: 367, VAULT_PERSONAL: 368, VAULT_CHILD_BACKUP: 369, VAULT_SETUP_BK: 387, VAULT_SETUP_VRK: 388, VAULT_ARCHIVE_MOVE: 389, VAULT_RECOVERY_START: 400, VAULT_RECOVERY_SHARE: 401, VAULT_RECOVERY_FINISH: 402, VAULT_ROTATE: 403, VAULT_RECOVERY_STATUS: 404, VAULT_SHARE_APPROVE: 405 } // RFC-0027 §1, §1a (400–405 D67)
const LOCK_MS = 5 * 60_000
const SATIR_GRUP = 4 // kâğıtta 4 karakterlik gruplar
const SATIR_BOY = 6 // satır başına grup

class MemoryStorage {
  constructor () { this.m = new Map() }
  get (k) { return this.m.has(k) ? JSON.parse(this.m.get(k)) : null }
  set (k, v) { this.m.set(k, JSON.stringify(v)) }
  delete (k) { this.m.delete(k) }
}

// Saklamanın bir öneki (PayTutucu'nun ilk görülme ve verilen pay kayıtları için)
// (Map gibi: olmayan anahtar undefined; PayTutucu has() ile ilk görülmeyi sorar, D67)
const onekli = (s, onek) => ({ get: (k) => { const v = s.get(onek + k); return v === null ? undefined : v }, has: (k) => s.get(onek + k) !== null, set: (k, v) => s.set(onek + k, v) })
// Saklamada 'gonderilecek:' önekli anahtarlar pay baytı taşır (gizli): telefonda arsive gider (worklet, D29)
const TO_SEND = 'gonderilecek:'
// Kilitliyken gelen alındının silmesi (D36, inceleme 13 bulgu 3): pay baytları o an bellekte değil; kilit açılınca
// uygulanır. Gizli değil (yalnız sahip kimlikleri)
const TO_DELETE = 'silinecek:'
// Bu telefonun bildiği KRA (RFC-0027 §9 b): kurulumda ya da döndürmede saklanır; zarfı her dönem değişiminde yeniden
// üretmek için. Gizli: telefonda arsive gider (Arşiv mühürlü, kilitliyken bellekte değil)
const VRK_SECRET = 'kra-sir:'
// Görülen en büyük sürüm (§9 f): sır kurtarıldıktan sonra da saklanır; döndürme ondan bir fazlası. Gizli değil
const SEEN = 'gorulen:'
// Bu telefonun yazdığı son zarfın özeti (kayıt kimliği, sürüm, envSeq, son dönem); değişiklik denetimi için. Gizli değil
const ENVELOPE = 'zarf:'
// Zarfın kutuya giden kopyası (RFC-0027 §9 g): { version, envSeq, put (KASA_ENV_PUT hex), kutular: { id: true } }. Zarf
// KRA ile şifreli, etiket KRA'dan tek yönlü: gizli değil
const ENVELOPE_BOX = 'zarf-kutu:'
// Arsive giden (gizli) saklama önekleri
const GIZLI = [TO_SEND, VRK_SECRET]
const isSecret = (k) => typeof k === 'string' && GIZLI.some((o) => k.startsWith(o))
// Kasa zarfının kayıt türü (RFC-0027 §9 b)
// Alanlar: surum (KRA sürümü), env_sira (envSeq), son_donem (lastEpochSeq), zarf (KASA_ENVELOPE baytları)
const ENVELOPE_TYPE = 'hf.kasa.zarf'
const dagitimMi = (k) => typeof k === 'string' && (k.startsWith('ya:') || k.startsWith('kra:'))

// Kâğıt payın basılacak biçimi (RFC-0004 §4.4): QR'ın içeriği metnin kendisi; insanın okuyacağı satırlar
function paperLines (metin) {
  const govde = metin.slice(5)
  const gruplar = govde.match(new RegExp('.{1,' + SATIR_GRUP + '}', 'g')) || []
  const satirlar = []
  for (let i = 0; i < gruplar.length; i += SATIR_BOY) satirlar.push(gruplar.slice(i, i + SATIR_BOY).join(' '))
  return { qr: metin, satirlar: ['hfk1:', ...satirlar] }
}

class VaultApi extends Emitter {
  // ledger: defter; me: kimlik; anahtarDogrula(archiveKeyHex) → bool (platform: kasa arşiv anahtarı); saklama: { get, set }
  // (dağıtım özetleri, kalıcı); uygunCihaz(id) → bool (TPM mühürlü kutu ve işçiler, kurulumdan)
  // arsivTasi(eskiArchiveKeyHex, yeniArchivePubHex) → { oge }: platformun arşivi yeni anahtara taşıması (389, D40)
  // kayit: RecordApi (kasa zarfı kaydı ve dönem anahtarları için, RFC-0027 §9 b; sonradan da atanabilir)
  // kasaProfil: { profiller, saglik } verilirse cihaz payı adaylığına RFC-0008 §10.1 kuralı da eklenir (linux-konteyner ve
  // TPM mührü doğrulanmış; @havenfold/edge profil.kasaPayiSuzgeci)
  constructor ({ ledger, me, now = Date.now, kilitMs = LOCK_MS, anahtarDogrula = null, saklama = new MemoryStorage(), uygunCihaz = () => false, tutucu = null, defter = null, arsivTasi = null, kayit = null, kasaProfil = null }) {
    super()
    this.defter = defter // kasa koleksiyonunu kurmak için (388, Yuva Defteri 05 §2.2)
    this.kayit = kayit
    this.L = ledger
    this.me = me
    this.now = now
    this.kilitMs = kilitMs
    if (kasaProfil) uygunCihaz = require('@havenfold/edge').profil.kasaPayiSuzgeci({ ...kasaProfil, temel: uygunCihaz })
    this.kanca = { anahtarDogrula, uygunCihaz, arsivTasi }
    this.saklama = saklama
    this._son = null // kilit açıkken son işlem zamanı
    // Bu telefonun tuttuğu paylar (başkalarının sırları; RFC-0004 §4.4, RFC-0027 §1b)
    // 72 saat kuralına giren olay ilk görülünce güvenlik bildirimi (RFC-0021 a; inceleme 19 B3): 'guvenlik' olayı
    // { type: 'rotate_pending_share', seq, eski, yeni, bitis, alicilar }; platform alıcılara gönderir
    this.tutucu = tutucu || new K.istek.PayTutucu({ ledger, me, now, ilkGorulme: onekli(saklama, 'tutucu-ilk:'), sayac: onekli(saklama, 'tutucu-verilen:'), uyar: (b, alicilar) => this.emit('security-alert', { ...b, alicilar }) })
    this._kurtarma = null // bu telefonun yürüttüğü kurtarma (400–404)
    this._istekler = new Map() // tutucu tarafı: kullanıcının onayını bekleyen pay istekleri (jetonHex → bilgi)
    this._kilitliIstek = new Map() // kilitliyken gelen isteklerin jetonları (jetonHex → true); bilgi için
    this._giden = [] // kurtarma zarfları: { to, type, bytes } (sürüm sorusu, pay isteği, onaylanan pay)
    // Döndüren telefon eski sırrı, yeni paylardan eşik kadar alındı gelene kadar tutar (§9 e): anahtar → { version, t, sir }
    this._eskiSir = new Map()
    this._kutuZarfIstek = new Set() // kutudan zarfı istenen kasa koleksiyonları (§9 g)
  }

  get _meHex () { return hex(this.me.memberId || this.me) }

  // --- Kilit (19 LOCK, 224 UNLOCK) ---

  // LOCK: kilit olayı önce (worklet gönderilecekleri gönderip arsivi yazar), sonra bellekteki sırlar sıfırlanır:
  // kurtarılan sır ve toplanan paylar (B4), gönderilmemiş onaylı pay baytları (B10), döndürmede tutulan eski sır
  lock () {
    const once = this._son !== null
    this._son = null
    if (once) { this.emit('lock', { kilitli: true }); this.emit('vault', { type: 'kilitlendi' }) }
    this._kurtarmaKapat()
    for (const x of this._giden) if (x.type === K.istek.Z.KASA_SHARE_RES) sodium.sodium_memzero(x.bytes)
    this._giden = this._giden.filter((x) => x.type !== K.istek.Z.KASA_SHARE_RES)
    for (const a of [...this._eskiSir.keys()]) this._eskiSirSil(a)
    this._kutuZarfIstek.clear()
  }

  unlock (archiveKeyHex) {
    if (typeof archiveKeyHex !== 'string' || !/^[0-9a-f]{64}$/.test(archiveKeyHex)) fail('INVALID_KEY')
    if (typeof this.kanca.anahtarDogrula !== 'function' || !this.kanca.anahtarDogrula(archiveKeyHex)) fail('WRONG_LOCK_KEY')
    this._son = this.now()
    this._silinecekler()
    this.emit('lock', { kilitli: false })
    this.emit('vault', { type: 'acildi' })
    this._zarfDene() // kilitliyken kaçan dönem değişimleri (RFC-0027 §9 b)
  }

  // 389 VAULT_ARCHIVE_MOVE (D40): Arşiv anahtar çifti değişince (cihaz değişimi, biyometri sıfırlama) kasa öğeleri eski
  // gizli anahtarla açılıp yeni açık anahtara mühürlenir; eski gizli anahtar kanıttır. Kilit durumu değişmez.
  moveArchive (eskiArchiveKeyHex, yeniArchivePubHex) {
    for (const h of [eskiArchiveKeyHex, yeniArchivePubHex]) if (typeof h !== 'string' || !/^[0-9a-f]{64}$/.test(h)) fail('INVALID_KEY')
    if (typeof this.kanca.arsivTasi !== 'function') fail('NO_ARCHIVE')
    const r = this.kanca.arsivTasi(eskiArchiveKeyHex, yeniArchivePubHex)
    this.emit('vault', { type: 'arsiv_tasindi' })
    return r
  }

  // 5 dakika işlemsizlikte kendiliğinden kilitlenir
  locked () {
    if (this._son === null) return true
    if (this.now() - this._son >= this.kilitMs) { this.lock(); return true }
    return false
  }

  // Kasa koleksiyonunda her işlem (RecordApi çağırır): kilitliyse VAULT_LOCKED, değilse süre yenilenir
  touch () {
    if (this.locked()) fail('VAULT_LOCKED')
    this._son = this.now()
  }

  // --- Dağıtım (RFC-0004 §3) ---

  _ad (s) {
    if (s.tur === 'kagit') return 'Kâğıt ' + parseInt(s.id.slice(30), 16)
    if (s.tur === 'cihaz') return this.L.devices.get(s.id)?.name || (this.L.members.get(s.id)?.name) || ''
    return this.L.members.get(s.id)?.name || ''
  }

  _adli (dagitim) { return { ...dagitim, sahipler: dagitim.sahipler.map((s) => ({ ...s, ad: this._ad(s) })) } }

  // YA dağıtımı (önizleme). sahip: sırrın sahibi (varsayılan ben). Varsayılan kişiler: yetişkinde diğer ebeveyn ve
  // yetişkinler, çocukta ebeveynler; yalnizKagit: kişi yok, 2 kâğıt (RFC-0004 §3.2).
  bkDistribution ({ sahip = null, kisiler = null, kagit = null, yalnizKagit = false } = {}) {
    const L = this.L
    const s = L.canonical(hex(sahip || this._meHex))
    if (!s) fail('INVALID_MEMBER')
    const cocuk = L.members.get(s)?.role === 'cocuk'
    let k = kisiler ? kisiler.map(hex) : K.esik.kisiAdaylari(L, { haric: s }).filter((id) => !cocuk || L.members.get(id).role === 'ebeveyn')
    if (yalnizKagit) k = []
    const d = K.esik.yaDagitim(L, { sahip: s, kisiler: k, kagit: kagit ?? (yalnizKagit ? 2 : 1), uygunCihaz: this.kanca.uygunCihaz })
    return this._adli(d)
  }

  // KRA dağıtımı (önizleme): kasa koleksiyonunun okuyucuları + kâğıt
  vrkDistribution (collectionId, { kagit = 0 } = {}) {
    return this._adli(K.esik.kraDagitim(this.L, { collectionId: hex(collectionId), kagit, uygunCihaz: this.kanca.uygunCihaz }))
  }

  // Çocuğun YA yedeği (RFC-0004 §3.2): varsayılan ebeveynler + 1 kâğıt; çocuk "yalnız kâğıt" seçebilir
  childBackup (cocukId, { yalnizKagit = false } = {}) {
    const id = this.L.canonical(hex(cocukId))
    if (this.L.members.get(id)?.role !== 'cocuk') fail('NOT_CHILD')
    return this.bkDistribution({ sahip: id, yalnizKagit })
  }

  // --- Kurulum: sırdan paylar ---

  // sir: 32 bayt (platformun YA'sı); kurulduktan sonra belleği sıfırlanır. Dönüş: { secretId, version, dagitim,
  // paylar: [{ sahip, bytes }] (kişi ve cihaz payları; platform sahibine mühürleyip gönderir), kagitlar: [{ sira, metin,
  // qr, satirlar, baslik }] (yalnız burada döner) }
  async setupBackupKey (sir, secenek = {}) {
    const L = this.L
    const sahip = L.canonical(hex(secenek.sahip || this._meHex))
    // Pay sahiplerini sırrın sahibi seçer (RFC-0004 §3; inceleme 13 bulgu 9): başkasının YA'sı bu telefonda kurulmaz
    if (sahip !== L.canonical(this._meHex)) { if (b4a.isBuffer(sir)) sodium.sodium_memzero(sir); fail('UNAUTHORIZED') }
    const dagitim = this.bkDistribution(secenek)
    const secretId = K.pay.yaSecretId(L.familyId, K.pay.rootIdOf(L, sahip))
    return this._kur(sir, { anahtar: 'ya:' + sahip, secretId, kind: K.pay.TUR.YA, dagitim, rootId: K.pay.rootIdOf(L, sahip) })
  }

  // 388 VAULT_SETUP_VRK. collectionId null: 'Kasa' koleksiyonu kurulur (ailede ebeveynler, ekipte sahipler okur ve yazar; kasa
  // duyarlılığı; bütün ebeveynlerin ya da sahiplerin imzası; RFC-0005 §8.3). Öneri beklerse pay üretilmez: { koleksiyon: { durum: 'oneri', … } } döner. sir verilmezse KRA
  // burada üretilir (pay dağıtılır, sır bellekte kalmaz).
  async setupRecoveryKey (collectionId, sir = null, { kagit = 0 } = {}) {
    let koleksiyon = null
    if (collectionId === null || collectionId === undefined) {
      if (!this.defter) fail('NO_LEDGER')
      const rol = this.L.kind === 'ekip' ? 'rol:sahip' : 'rol:ebeveyn'
      koleksiyon = this.defter.openCollection({ name: 'Kasa', kind: 'genel', readers: [rol], writers: [rol], sensitivity: 'kasa', taskAccess: false, history: true })
      if (koleksiyon.durum !== 'uygulandi') return { koleksiyon }
      collectionId = [...this.L.collections.values()].filter((c) => c.name === 'Kasa' && c.sensitivity === 'kasa').map((c) => c.id).at(-1)
    }
    if (sir === null) { sir = b4a.alloc(K.pay.SIR); sodium.randombytes_buf(sir) }
    const cid = hex(collectionId)
    // KRA bu telefonda Arşiv mühürlü saklanır: zarfı dönem değişimlerinde yeniden üretmek için (RFC-0027 §9 b)
    const kopya = b4a.isBuffer(sir) && sir.byteLength === K.pay.SIR ? b4a.from(sir) : null
    try {
      const dagitim = this.vrkDistribution(cid, { kagit })
      const r = await this._kur(sir, { anahtar: 'kra:' + cid, secretId: b4a.from(cid, 'hex'), kind: K.pay.TUR.KRA, dagitim })
      this._kraSakla('kra:' + cid, r.version, kopya)
      this._zarfDene(cid, { zorla: true })
      return koleksiyon ? { ...r, collectionId: cid, koleksiyon } : { ...r, collectionId: cid }
    } finally {
      if (kopya) sodium.sodium_memzero(kopya)
      if (b4a.isBuffer(sir)) sodium.sodium_memzero(sir)
    }
  }

  _kraSakla (anahtar, version, kra) {
    this.saklama.set(VRK_SECRET + anahtar, { version, sir: hex(kra) })
  }

  // Bu telefonun saklı KRA'sı (kilitliyken telefonda arsivde, burada yok): { version, kra (kopya; çağıran sıfırlar) }
  _kraSakli (anahtar) {
    const o = this.saklama.get(VRK_SECRET + anahtar)
    return o && typeof o.sir === 'string' && /^[0-9a-f]{64}$/.test(o.sir) ? { version: o.version, kra: b4a.from(o.sir, 'hex') } : null
  }

  _gorulen (anahtar) { const v = this.saklama.get(SEEN + anahtar); return Number.isSafeInteger(v) ? v : 0 }
  // Bu telefonun tuttuğu payın (kilitliyken pay dizinindeki) en büyük sürümü
  _tutulan (secretIdHex) { return Math.max(0, ...[...this.tutucu.dizin.keys()].filter((x) => x.startsWith(secretIdHex + '|')).map((x) => Number(x.slice(secretIdHex.length + 1)))) }
  _gorulenYaz (anahtar, version) { if (Number.isSafeInteger(version) && version > this._gorulen(anahtar)) this.saklama.set(SEEN + anahtar, version) }

  async _kur (sir, { anahtar, secretId, kind, dagitim, rootId = null, surum = null }) {
    try {
      if (!b4a.isBuffer(sir) || sir.byteLength !== K.pay.SIR) fail('INVALID_SECRET')
      if (!dagitim.kurulur) fail(dagitim.neden || 'INVALID_THRESHOLD')
      const once = this.saklama.get(anahtar)
      const version = surum ?? (once ? once.version + 1 : 1)
      const ham = await K.pay.paylariUret(sir, { secretId, kind, version, dagitim })
      const commit = hex(ham[0].commit) // eşzamanlı döndürmede kazananı belirler (RFC-0027 §9 e)
      const aile = this.L.familyName || ''
      const kagitlar = []
      const paylar = []
      const gonderilecek = {} // sahip → KASA_SHARE_PUT (hex)
      const kendi = [] // bu telefonun kendi tuttuğu paylar
      let sira = 0
      ham.forEach((p, i) => {
        const s = dagitim.sahipler[i]
        if (s.tur === 'kagit') {
          sira++
          const metin = K.pay.kagitKodla(p)
          kagitlar.push({ sira, metin, ...paperLines(metin), baslik: (aile ? aile + ' · ' : '') + `Kasa payı ${sira}/${dagitim.sahipler.filter((x) => x.tur === 'kagit').length}, sürüm ${version}` })
        } else if (this.L.canonical(s.id) === this.L.canonical(this._meHex)) {
          // Kendi payımız (KRA'da kurucu da okuyucudur): bu telefonun tutucusuna, teslim gerekmez
          this.tutucu.ekle({ share: { ...p, share: b4a.from(p.share) } }, kind === K.pay.TUR.YA ? { rootId } : {})
          kendi.push(s.id)
        } else {
          const teslim = K.teslim.payTeslimi(p, rootId)
          gonderilecek[s.id] = b4a.toString(teslim, 'hex')
          paylar.push({ sahip: { tur: s.tur, id: s.id, ad: s.ad }, bytes: K.pay.encodeShare(p), teslim: { to: s.id, type: K.teslim.Z.KASA_SHARE_PUT, bytes: teslim } })
        }
        sodium.sodium_memzero(p.share)
      })
      const ozet = {
        secretId: hex(secretId), kind, version, commit, t: dagitim.t, n: dagitim.n, sahipler: dagitim.sahipler.map(({ tur, id }) => ({ tur, id })), basildi: kagitlar.map(() => false), at: this.now(),
        teslim: Object.fromEntries([...Object.keys(gonderilecek).map((id) => [id, false]), ...kendi.map((id) => [id, true])])
      }
      this.saklama.set(anahtar, ozet)
      this._gorulenYaz(anahtar, version)
      this.saklama.set(TO_SEND + anahtar, gonderilecek) // ACK gelene kadar (yeniden gönderim)
      this._silinecekKaldir(TO_DELETE + anahtar) // eski sürümün ertelenen silmesi yeni sürüme uygulanmaz
      this.emit('vault', { type: 'kuruldu', anahtar })
      if (kagitlar.length) this.emit('vault', { type: 'kagit_gerekli', anahtar })
      return { secretId: hex(secretId), version, dagitim, paylar, kagitlar }
    } finally {
      if (b4a.isBuffer(sir)) sodium.sodium_memzero(sir)
    }
  }

  // 366 VAULT_PAPER_SHARE: kâğıt payı üretir (kurulum ya da kâğıt yenileme; yeni sürüm). Kâğıdın metni saklanmadığı için
  // yalnız bu sonuçta döner. secenek: { tur: 'ya' | 'kra', collectionId? (kra), sir, kagit?, ...yaKur seçenekleri }
  async paperShare ({ tur = 'ya', collectionId = null, sir, ...secenek } = {}) {
    if (tur === 'kra') return this.setupRecoveryKey(collectionId, sir, { kagit: secenek.kagit ?? 1 })
    if (tur !== 'ya') fail('INVALID_TYPE')
    return this.setupBackupKey(sir, secenek)
  }

  // Kâğıt basıldı (RFC-0004 §6 kâğıt pay): basılmayan kâğıt durumda "eksik" görünür, hatırlatma ürünün işidir
  paperPrinted (anahtar, sira) {
    const o = this.saklama.get(anahtar)
    if (!o || !Number.isSafeInteger(sira) || sira < 1 || sira > o.basildi.length) fail('NO_PAPER')
    o.basildi[sira - 1] = true
    this.saklama.set(anahtar, o)
  }

  // --- Pay teslimi (RFC-0027 §1b; KASA_SHARE_PUT 0xF1, KASA_SHARE_ACK 0xF2) ---

  _anahtarlar () { return [...(this.saklama.anahtarlar ? this.saklama.anahtarlar() : this._bilinenler())] }
  _bilinenler () {
    const L = this.L
    const out = ['ya:' + L.canonical(this._meHex)]
    for (const c of L.collections.values()) if (c.sensitivity === 'kasa') out.push('kra:' + c.id)
    return out
  }

  // Alındısı gelmemiş paylar: platform her sahibe doğrudan oturumda ya da emanetle gönderir (Posta Kutusu değil)
  outgoing () {
    const out = []
    for (const anahtar of this._anahtarlar()) {
      if (!dagitimMi(anahtar)) continue
      const o = this.saklama.get(anahtar)
      const g = o && o.teslim ? this.saklama.get(TO_SEND + anahtar) : null
      if (!g) continue
      for (const [id, tamam] of Object.entries(o.teslim)) if (!tamam && g[id]) out.push({ to: id, type: K.teslim.Z.KASA_SHARE_PUT, bytes: b4a.from(g[id], 'hex'), anahtar })
    }
    return out
  }

  // Tutucu tarafı: gelen KASA_SHARE_PUT (tek giriş noktası). Dönüş: gönderilecek alındı { to, type, bytes }
  receiveShare (fromHex, bytes, yol) {
    const L = this.L
    giris.gelenZarf({ myRole: 'uye', peerRole: L.sessionRole(hex(fromHex)), type: K.teslim.Z.KASA_SHARE_PUT, bytes, L, gonderen: hex(fromHex), yol })
    const r = K.teslim.teslimAl(this.tutucu, hex(fromHex), bytes)
    if (r.durum === 'degisti') this._geriCek(r.share)
    this.emit('vault', { type: 'pay_alindi', durum: r.durum })
    return { to: hex(fromHex), type: K.teslim.Z.KASA_SHARE_ACK, bytes: r.alindi, durum: r.durum }
  }

  // Eşzamanlı döndürme (RFC-0027 §9 e, inceleme 19 B6): bu telefonun aynı sürüm dağıtımından küçük commit'li bir pay
  // geldi; bu telefon kaybetti. Kendi dağıtımını geri çeker (gönderilecek paylar silinir, alındılar yok sayılır),
  // kazananın sürümüne geçer; KRA'da kendi KRA'sı ve zarfı silinir, kâğıtları geçersizdir.
  _geriCek (share) {
    for (const anahtar of this._anahtarlar()) {
      if (!dagitimMi(anahtar)) continue
      const o = this.saklama.get(anahtar)
      if (!o || o.kaybetti || o.secretId !== hex(share.secretId) || o.version !== share.version || !o.commit || o.commit === hex(share.commit)) continue
      if (b4a.compare(share.commit, b4a.from(o.commit, 'hex')) >= 0) continue
      this.saklama.set(anahtar, { ...o, kaybetti: true, commit: hex(share.commit), teslim: {}, basildi: [] })
      this._silinecekKaldir(TO_SEND + anahtar)
      this._eskiSirSil(anahtar)
      const ks = this.saklama.get(VRK_SECRET + anahtar)
      if (ks && ks.version === o.version) {
        this._silinecekKaldir(VRK_SECRET + anahtar)
        const z = this.saklama.get(ENVELOPE + anahtar)
        if (z && z.version === o.version) {
          if (this.kayit && !this.locked() && z.recordId) { try { this._sessiz(() => this.kayit.del(anahtar.slice(4), z.recordId)) } catch {} }
          this._silinecekKaldir(ENVELOPE + anahtar)
        }
        this._silinecekKaldir(ENVELOPE_BOX + anahtar) // kutudaki kopyayı kazananınki geçersiz kılar (aynı sürüm, başka etiket)
      }
      this.emit('vault', { type: 'dondurme_geri_cekildi', anahtar, version: o.version })
    }
  }

  _eskiSirSil (anahtar) {
    const es = this._eskiSir.get(anahtar)
    if (es) sodium.sodium_memzero(es.sir)
    this._eskiSir.delete(anahtar)
  }

  // Gönderen tarafı: gelen KASA_SHARE_ACK (tek giriş noktası). Dönüş: 'teslim' | 'bilinmiyor'
  receiveAck (fromHex, bytes, yol) {
    const L = this.L
    const { mesaj: m } = giris.gelenZarf({ myRole: 'uye', peerRole: L.sessionRole(hex(fromHex)), type: K.teslim.Z.KASA_SHARE_ACK, bytes, L, gonderen: hex(fromHex), yol })
    const kim = hex(m.holderId)
    if (!K.teslim.ayniKimlik(L, kim, hex(fromHex))) fail('UNAUTHORIZED') // alındıyı payın sahibi verir (cihazda tam kimlik)
    for (const anahtar of this._anahtarlar()) {
      if (!dagitimMi(anahtar)) continue
      const o = this.saklama.get(anahtar)
      if (!o || !o.teslim || o.kaybetti || o.secretId !== hex(m.secretId) || o.version !== m.version || !(kim in o.teslim)) continue
      o.teslim[kim] = true
      this.saklama.set(anahtar, o)
      const g = this.saklama.get(TO_SEND + anahtar)
      if (g) {
        delete g[kim]
        this.saklama.set(TO_SEND + anahtar, g)
      } else {
        // Pay baytları bellekte değil (telefonda kilitliyken arşivde): silme kilit açılınca, yalnız aynı sürümün payına
        // (inceleme 14 Y2: kilitliyken kurulan yeni sürümün payı silinmesin)
        let sil = this.saklama.get(TO_DELETE + anahtar)
        if (!sil || Array.isArray(sil) || sil.version !== m.version) sil = { version: m.version, kimler: [] }
        if (!sil.kimler.includes(kim)) sil.kimler.push(kim)
        this.saklama.set(TO_DELETE + anahtar, sil)
      }
      this.emit('vault', { type: 'teslim', anahtar, sahip: kim })
      // Yeni paylardan eşik kadarı alındıysa döndürmede tutulan eski sır sıfırlanır (§9 e)
      const es = this._eskiSir.get(anahtar)
      if (es && es.version === o.version && Object.values(o.teslim).filter(Boolean).length >= Math.min(o.t, Object.keys(o.teslim).length)) this._eskiSirSil(anahtar)
      return 'teslim'
    }
    return 'bilinmiyor'
  }

  // Kilitliyken ertelenen alındı silmeleri: arşivden gelen pay baytlarından teslim edilmişler çıkar
  _silinecekler () {
    for (const anahtar of this._anahtarlar()) {
      if (!anahtar.startsWith(TO_DELETE)) continue
      const asil = anahtar.slice(TO_DELETE.length)
      const sil = this.saklama.get(anahtar)
      const o = this.saklama.get(asil)
      const g = this.saklama.get(TO_SEND + asil)
      // D36 biçimi (sürümsüz dizi) o anki sürüme uygulanır
      const kimler = Array.isArray(sil) ? sil : sil && o && sil.version === o.version ? sil.kimler : []
      if (g && kimler.length) {
        for (const kim of kimler) delete g[kim]
        this.saklama.set(TO_SEND + asil, g)
      }
      this._silinecekKaldir(anahtar) // uygulansın ya da eskimiş olsun, kayıt kalkar
    }
  }

  _silinecekKaldir (anahtar) {
    if (this.saklama.get(anahtar) === null) return
    if (this.saklama.delete) this.saklama.delete(anahtar)
    else this.saklama.set(anahtar, null)
  }

  // --- Kurtarma (RFC-0004 §5; 400–402, 404) ---

  // Sırrın kimliği ve türü. YA: bu kişinin sırrı (kökü cihaz değişimi zincirinin ilk kimliği); KRA: bugün okuyucusu
  // olduğum kasa koleksiyonu
  _sir (tur, collectionId) {
    const L = this.L
    const me = this._meHex
    if (tur === 'ya') {
      const rootId = K.pay.rootIdOf(L, me)
      const sahip = L.canonical(me)
      return { tur, anahtar: 'ya:' + sahip, secretId: hex(K.pay.yaSecretId(L.familyId, rootId)), kind: K.pay.TUR.YA, rootId, collectionId: null }
    }
    if (tur !== 'kra') fail('INVALID_TYPE')
    const cid = typeof collectionId === 'string' || b4a.isBuffer(collectionId) ? hex(collectionId) : ''
    const col = L.collections.get(cid)
    if (!col || col.sensitivity !== 'kasa') fail('NO_COLLECTION')
    if (L.members.get(me)?.extra || !require('@havenfold/records').yetki.readerSet(L, col).has(me)) fail('UNAUTHORIZED')
    return { tur, anahtar: 'kra:' + cid, secretId: cid, kind: K.pay.TUR.KRA, rootId: null, collectionId: cid }
  }

  _kurtarmaKapat () {
    const k = this._kurtarma
    if (k && k.sir) sodium.sodium_memzero(k.sir)
    if (k) for (const p of k.paylar) sodium.sodium_memzero(p.share)
    // Elinde bu nesne kalan çağrı (aynı çağrıda süre dolup kilitlendiyse) sıfırlanmış sırrı kullanamasın
    if (k) { k.sir = null; k.paylar = []; k.kapandi = true }
    this._kurtarma = null
    this._giden = this._giden.filter((x) => x.type === K.istek.Z.KASA_SHARE_RES)
  }

  // Bu sırrın payını tutabilecek kimlik mi (sürüm cevabı ve pay yalnız onlardan; inceleme 19 B2): kutu ve TPM'li
  // işçiler; KRA'da kasanın okuyucusu olan yetişkinler, YA'da sahibi dışındaki yetişkinler
  _tutucuAdayi (k, id) {
    const L = this.L
    if (L.boxIds().includes(id) || L.activeDeviceIds().some((d) => d === id && L.devices.get(d).class === 'isci')) return true
    const kisi = L.canonical(id)
    if (!kisi) return false
    if (k.kind === K.pay.TUR.KRA) { try { return K.esik.kisiAdaylari(L).includes(kisi) && K.esik.kasaOkuyuculari(L, k.collectionId).includes(kisi) } catch { return false } }
    return K.esik.kisiAdaylari(L, { haric: L.canonical(this._meHex) }).includes(kisi)
  }

  // Kurtarmanın hedef sürümündeki paylar (tutucu başına bir)
  _guncelPaylar (k) { return k.paylar.filter((x) => x.version === k.version) }

  // 400 VAULT_RECOVERY_START: sürüm sorusu ailenin bütün etkin kimliklerine (pay sahipleri kim olduğunu bu telefon artık
  // bilmez; tutmayan ya da yetkisiz bulan cevap vermez). Yeniden çağrılınca istekler yinelenir (72 saat beklemesinden
  // sonra; istek en çok 5 dakika eski olabilir), gelen paylar korunur.
  startRecovery ({ tur = 'ya', collectionId = null } = {}) {
    const s = this._sir(tur, collectionId)
    const L = this.L
    const me = this._meHex
    const k = this._kurtarma && this._kurtarma.secretId === s.secretId ? this._kurtarma : null
    if (!k) this._kurtarmaKapat()
    // taban: bu telefonda kurulmuş, kurtarılmış ya da tutulan en büyük sürüm (daha eskisi STALE_VERSION, §9 f)
    const once = this.saklama.get(s.anahtar)
    const taban = Math.max(once ? once.version : 0, this._tutulan(s.secretId))
    this._kurtarma = k || { ...s, version: null, esik: null, surumler: new Map(), paylar: [], istenen: new Set(), soruldu: new Set(), buTur: new Set(), sir: null, eski: false, taban }
    this._kurtarma.buTur.clear()
    this._giden = this._giden.filter((x) => x.type === K.istek.Z.KASA_SHARE_RES)
    const soru = K.istek.surumIste(b4a.from(s.secretId, 'hex'))
    const adaylar = [...L.members].filter(([id, m]) => m.active && id !== me && !L.isPending(id)).map(([id]) => id)
    for (const [id, d] of L.devices || []) if (d.active && !adaylar.includes(id)) adaylar.push(id)
    for (const to of adaylar.sort()) { this._kurtarma.soruldu.add(to); this._giden.push({ to, type: K.istek.Z.KASA_VERSION_REQ, bytes: soru }) }
    // Sürümü bilinen tutuculara pay isteği hemen
    for (const [h, v] of this._kurtarma.surumler) if (v === this._kurtarma.version) this._payIste(h)
    this.emit('vault', { type: 'kurtarma_basladi', tur, secretId: s.secretId })
    return { tur, secretId: s.secretId, soruldu: adaylar.length }
  }

  _payIste (holder) {
    const k = this._kurtarma
    if (k.sir || k.buTur.has(holder + '|' + k.version)) return
    k.buTur.add(holder + '|' + k.version)
    k.istenen.add(holder + '|' + k.version) // pay cevabı yalnız istenen tutucudan ve sürümden (B2)
    const bytes = K.istek.payIste(this.L.familyId, { secretId: b4a.from(k.secretId, 'hex'), kind: k.kind, version: k.version, holderId: holder, at: this.now(), reason: 'restore' }, this.me)
    this._giden.push({ to: holder, type: K.istek.Z.KASA_SHARE_REQ, bytes })
  }

  // Gönderilecek kurtarma zarfları; platform gönderince gonderildi(x) der (oturumu açık olmayana sonra gider)
  recoveryOutgoing () { return [...this._giden] }
  sent (x) { const i = this._giden.indexOf(x); if (i >= 0) this._giden.splice(i, 1) }

  // Gelen KASA_VERSION_RES (tek giriş noktası). Yalnız sorulan ve bu sırrın payını tutabilecek kimlikten; daha yeni
  // sürüm toplanan payları silmez (B2). Sır kurtarıldıktan sonra gelen sürüm de görülen en büyük sürüme yazılır, daha
  // yeniyse kurtarılan sır eskidir (§9 f). Dönüş: 'kaydedildi' | 'yetkisiz' | 'bilinmiyor'
  receiveVersionReply (fromHex, bytes, yol) {
    const L = this.L
    const from = hex(fromHex)
    const { mesaj: m } = giris.gelenZarf({ myRole: 'uye', peerRole: L.sessionRole(from), type: K.istek.Z.KASA_VERSION_RES, bytes, L, gonderen: from, yol })
    const k = this._kurtarma
    if (!k || hex(m.secretId) !== k.secretId) return 'bilinmiyor'
    if (!k.soruldu.has(from) || !this._tutucuAdayi(k, from)) return 'yetkisiz'
    k.surumler.set(from, m.version)
    this._gorulenYaz(k.anahtar, m.version)
    if (k.sir) {
      if (m.version > k.version) k.eski = true
    } else if (k.version === null || m.version > k.version) {
      k.version = m.version
      k.esik = m.threshold || (this._guncelPaylar(k)[0] || {}).threshold || null
      for (const [h, v] of k.surumler) if (v === k.version) this._payIste(h)
    } else if (m.version === k.version) {
      if (!k.esik && m.threshold) k.esik = m.threshold
      this._payIste(from)
    }
    this.emit('vault', { type: 'kurtarma_surum', kimden: from, version: m.version })
    return 'kaydedildi'
  }

  // kaynak: 'kagit' ya da payı veren tutucu. Tutucu başına bir pay (RFC-0021 c; B8): aynı tutucunun aynı sürümde ikinci,
  // farklı payı alınmaz
  _payEkle (p) {
    const k = this._kurtarma
    if (p.kind !== k.kind || hex(p.secretId) !== k.secretId) fail('INVALID_SHARE')
    if (p.version < Math.max(k.version ?? 0, k.taban)) fail('STALE_VERSION')
    if (k.version === null || p.version > k.version) k.version = p.version // sürüm henüz bilinmiyorsa (kâğıt ilk) ya da daha yeni kâğıt
    this._gorulenYaz(k.anahtar, p.version)
    const ayni = k.paylar.find((x) => x.version === p.version && b4a.equals(x.holderId, p.holderId))
    if (ayni) return b4a.equals(ayni.share, p.share) && b4a.equals(ayni.commit, p.commit) ? 'zaten' : 'tutucu_tekrar'
    k.paylar.push(p)
    k.esik = p.threshold // eşik payın kendisinden (kilitli tutucunun sürüm cevabında eşik yok)
    this.emit('vault', { type: 'kurtarma_pay', paySayisi: this._guncelPaylar(k).length, esik: k.esik })
    return 'eklendi'
  }

  // Gelen KASA_SHARE_RES (tek giriş noktası; pay kâğıt payla aynı denetimden geçer, RFC-0021 c). Pay yalnız tutucusundan
  // ve yalnız ondan istenmiş sürüm için (B2). Dönüş: 'eklendi' | 'zaten' | 'tutucu_tekrar' | 'yanlis_tutucu' |
  // 'istenmedi' | 'bilinmiyor'
  receiveShareReply (fromHex, bytes, yol) {
    const L = this.L
    const from = hex(fromHex)
    const { mesaj: p } = giris.gelenZarf({ myRole: 'uye', peerRole: L.sessionRole(from), type: K.istek.Z.KASA_SHARE_RES, bytes, L, gonderen: from, yol })
    const k = this._kurtarma
    if (!k || k.sir || hex(p.secretId) !== k.secretId || p.kind !== k.kind) return 'bilinmiyor'
    if (!K.teslim.ayniKimlik(L, hex(p.holderId), from)) return 'yanlis_tutucu'
    if (!k.istenen.has(from + '|' + p.version)) return 'istenmedi'
    // Pay kurtarmanın kendi tamponunda durur (kapanışta ve LOCK'ta sıfırlanır); gelen tampon çağıranındır
    const kopya = { ...p, secretId: b4a.from(p.secretId), holderId: b4a.from(p.holderId), commit: b4a.from(p.commit), share: b4a.from(p.share) }
    let r
    try { r = this._payEkle(kopya) } catch { r = 'bilinmiyor' }
    if (r !== 'eklendi') sodium.sodium_memzero(kopya.share)
    return r
  }

  // 401 VAULT_RECOVERY_SHARE: kâğıt pay (yeni telefonla okutulur). Dönüş: { durum: 'eklendi' | 'zaten', paySayisi }
  recoveryShare ({ kagit } = {}) {
    this.locked()
    const k = this._kurtarma
    if (!k || k.sir) fail('NO_RECOVERY')
    const p = K.pay.kagitCoz(kagit)
    let durum
    try { durum = this._payEkle(p) } catch (err) { sodium.sodium_memzero(p.share); throw err }
    if (durum === 'tutucu_tekrar') { sodium.sodium_memzero(p.share); fail('DUPLICATE_HOLDER') }
    if (durum !== 'eklendi') sodium.sodium_memzero(p.share)
    return { durum, paySayisi: this._guncelPaylar(k).length }
  }

  // 402 VAULT_RECOVERY_FINISH: eşik kadar pay birleşir, commit doğrulanır (RFC-0004 §5.3). YA: { sirHex } platforma (sahibin
  // sırrı); KRA kanala çıkmaz: verilen zarflar (hex) ve kasa koleksiyonundaki 'hf.kasa.zarf' kayıtları açılır, dönem
  // anahtarları replikaya girer (RFC-0027 §9 b): { zarf: açılan sayısı, donem: birleşen dönem sayısı, anahtar: eklenen }.
  // Bilinen daha yeni sürüm varken eski sürümle bitmez (STALE_VERSION, §9 f). Sır döndürmeye (403) ya da LOCK'a kadar
  // bellekte kalır.
  async finishRecovery ({ zarflar = [] } = {}) {
    this.locked() // süre dolduysa önce kilitlenir (kurtarma kapanır)
    const k = this._kurtarma
    if (!k) fail('NO_RECOVERY')
    if (k.sir && k.eski) fail('STALE_VERSION')
    if (!k.sir) {
      if (k.version === null) fail('INSUFFICIENT_SHARE')
      const paylar = this._guncelPaylar(k)
      if (!paylar.length) fail(k.paylar.length ? 'STALE_VERSION' : 'INSUFFICIENT_SHARE')
      k.sir = await K.pay.birlestir(paylar, { secretId: b4a.from(k.secretId, 'hex'), kind: k.kind, version: k.version })
      this._gorulenYaz(k.anahtar, k.version)
    }
    const out = { tur: k.tur, version: k.version, secretId: k.secretId }
    if (k.tur === 'ya') out.sirHex = hex(k.sir)
    else {
      out.collectionId = k.collectionId
      // Kayıtlardaki zarflar ve açılan anahtarlar kasanın içeriğidir: replika bağlıysa kasa açık olmalı
      if (this.kayit && this.locked()) fail('VAULT_LOCKED')
      const acilan = this._zarflariAc(k.sir, zarflar)
      for (const z of this._zarfKayitlari(k.collectionId)) {
        try { acilan.push(this._zarfAc(k.sir, z.fields.zarf)) } catch {} // başka sürümün ya da bozuk zarf
      }
      // Kutudaki opak kopya (§9 g): etiket KRA'dan; cevap gelince zarfCevabiAl açar (kurtarmaDurumu kutuZarfi)
      const kutular = this.L.boxIds()
      if (kutular.length && !k.kutuIstendi) {
        const etiket = K.kutuZarf.zarfEtiketi(k.sir, this.L.familyId, k.collectionId)
        const istek = K.kutuZarf.zarfIste(k.collectionId, etiket)
        for (const to of kutular) this._giden.push({ to, type: K.kutuZarf.Z.KASA_ENV_REQ, bytes: istek })
        this._kutuZarfIstek.add(k.collectionId)
        k.kutuIstendi = true
      }
      // Kutusu olmayan ailede tam felaket: hiçbir zarf açılmadı ve kasanın dönem anahtarları eksik (§9 g)
      if (!acilan.length && !kutular.length && this._donemEksik(k.collectionId)) fail('NO_ENVELOPE')
      const birlesik = K.zarf.donemleriBirlestir(acilan)
      out.zarf = acilan.length
      out.donem = birlesik.epochs.length
      out.anahtar = this._anahtarEkle(k.collectionId, birlesik)
      out.kutu = k.kutuIstendi ? (k.kutuZarfi ? 'alindi' : 'istendi') : 'yok'
      for (const z of acilan) for (const e of z.ic.epochs) for (const g of e.keys) sodium.sodium_memzero(g.key)
      for (const z of acilan) for (const d of z.ic.dropSecrets) sodium.sodium_memzero(d.secret)
    }
    this.emit('vault', { type: 'kurtarildi', tur: k.tur, version: k.version })
    return out
  }

  _zarfAc (kra, zarf) {
    const L = this.L
    const okuyucuMu = this._okuyucuMu(this._kurtarma ? this._kurtarma.collectionId : '')
    return K.zarf.zarfAc(L, kra, b4a.isBuffer(zarf) ? zarf : b4a.from(zarf, 'hex'), { okuyucuMu })
  }

  _zarflariAc (kra, zarflar) {
    if (!Array.isArray(zarflar)) fail('INVALID_BODY')
    return zarflar.map((z) => this._zarfAc(kra, z))
  }

  // Kasanın anahtarı olmayan dönemi var mı (replika bağlı değilse bilinmez: var sayılır)
  _donemEksik (cid) {
    const r = this.kayit && this.kayit.r
    if (!r) return true
    return r.yetki.epochs(cid).some((ep) => !r.keys.has(cid, ep.seq, ep.hash))
  }

  // Gelen KASA_ENV_RES (tek giriş noktası; §9 g): yalnız kutudan ve yalnız istenen koleksiyon için. Zarf kurtarmadaki
  // KRA ile (döndürmeden sonra tutulan eski KRA ile de) açılır, dönem anahtarları replikaya girer. Dönüş: 'acildi' |
  // 'acilmadi' | 'bilinmiyor'
  receiveEnvelopeReply (fromHex, bytes, yol) {
    const L = this.L
    const from = hex(fromHex)
    const { mesaj: m } = giris.gelenZarf({ myRole: 'uye', peerRole: L.sessionRole(from), type: K.kutuZarf.Z.KASA_ENV_RES, bytes, L, gonderen: from, yol })
    if (!L.boxIds().includes(from)) return 'bilinmiyor'
    const cid = hex(K.kutuZarf.baslik(m.zarf).m.collectionId)
    if (!this._kutuZarfIstek.has(cid)) return 'bilinmiyor'
    const k = this._kurtarma && this._kurtarma.collectionId === cid && this._kurtarma.sir ? this._kurtarma : null
    const es = this._eskiSir.get('kra:' + cid)
    const kra = k ? k.sir : es ? es.sir : null
    if (!kra) return 'bilinmiyor'
    let z
    try { z = this._zarfAcKra(kra, cid, m.zarf) } catch { return 'acilmadi' }
    this._kutuZarfIstek.delete(cid)
    const birlesik = K.zarf.donemleriBirlestir([z])
    const sonuc = { zarf: 1, donem: birlesik.epochs.length, sonDonem: z.lastEpochSeq, envSeq: z.envSeq, anahtar: this._anahtarEkle(cid, birlesik) }
    // Eski kopya geri konmuşsa (kutu diski) son dönemden sonrası eksik kalır: bilgi olarak (anahtarlar REC_KEY_REQ ile)
    const r = this.kayit && this.kayit.r
    sonuc.eksikDonem = r ? r.yetki.epochs(cid).filter((ep) => !r.keys.has(cid, ep.seq, ep.hash)).length : null
    for (const e of z.ic.epochs) for (const g of e.keys) sodium.sodium_memzero(g.key)
    for (const d of z.ic.dropSecrets) sodium.sodium_memzero(d.secret)
    if (k) k.kutuZarfi = sonuc
    this.emit('vault', { type: 'kutu_zarfi', collectionId: cid, ...sonuc })
    return 'acildi'
  }

  // Açılan dönem anahtarları replikaya (RFC-0027 §9 b): her girdi çekirdeğin doğrulamasından geçer, bırakma sırları
  // dönemin bırakma anahtarlarıyla eşleşmeli. Dönüş: yeni eklenen anahtar sayısı
  _anahtarEkle (cid, birlesik) {
    const r = this.kayit && this.kayit.r
    if (!r) return 0
    const A = require('@havenfold/records').anahtar
    const L = this.L
    let n = 0
    for (const e of birlesik.epochs) {
      const ep = r.yetki.epoch(cid, e.epochSeq)
      if (!ep || !b4a.equals(ep.hash, e.epochHash)) continue
      for (const entry of e.keys) {
        if (r.keys.get(cid, ep.seq, ep.hash, entry.keyId)) continue
        try {
          const { role } = A.verifyKeyEntry({ familyId: L.familyId, collectionId: b4a.from(cid, 'hex'), epoch: ep, entry, signPubOf: (id) => L.entity(id)?.signPub })
          r.keys.add(cid, ep, { keyId: b4a.from(entry.keyId), key: b4a.from(entry.key), issuerId: b4a.from(entry.issuerId), sig: b4a.from(entry.sig) }, role)
          n++
        } catch {}
      }
    }
    const tum = r.yetki.epochs(cid).flatMap((ep) => r.yetki.dropKeysInEpoch(cid, ep.seq))
    for (const d of birlesik.dropSecrets) {
      const pub = A.dropPubOf(d.secret)
      if (!b4a.equals(A.dropKeyHashOf(pub), d.dropKeyHash) || !tum.some((x) => b4a.equals(x, pub)) || r.keys.drop(d.dropKeyHash)) continue
      r.keys.addDrop(cid, pub, b4a.from(d.secret))
    }
    r._afterKeys(cid)
    if (n) this.emit('vault', { type: 'anahtar_eklendi', collectionId: cid, anahtar: n })
    return n
  }

  // 404 VAULT_RECOVERY_STATUS: yürüyen kurtarma ve onay bekleyen pay istekleri (tutucu tarafı)
  recoveryStatus () {
    this._istekTemizle()
    const k = this._kurtarma
    return {
      kurtarma: k ? { tur: k.tur, secretId: k.secretId, collectionId: k.collectionId, version: k.version, esik: k.esik, paySayisi: this._guncelPaylar(k).length, hazir: k.esik !== null && this._guncelPaylar(k).length >= k.esik, tamam: !!k.sir, eski: k.eski, kutuZarfi: k.kutuZarfi || (k.kutuIstendi ? 'istendi' : null), bilinen: this._gorulen(k.anahtar), cevaplayan: [...k.surumler.keys()].sort(), istenen: [...k.istenen].filter((x) => x.endsWith('|' + k.version)).map((x) => x.split('|')[0]).sort() } : null,
      istekler: [...this._istekler.values()].map((x) => ({ ...x, ad: this.L.members.get(x.kimden)?.name || '' })),
      kilitli: this.locked()
    }
  }

  // --- Döndürme (RFC-0004 §6; 403) ---

  // 403 VAULT_ROTATE: yeni sır, sürüm görülen en büyük sürümden bir fazla (§9 f), paylar bugünkü sahiplere. YA'yı sahibi,
  // KRA'yı okuyucu döndürür. Eski sırrı bilmeden döndürülmez (inceleme 19 B1, B5): YA bu telefonda kurulmuş ya da
  // kurtarılmış olmalı; KRA kurtarılmış, bu telefonda saklı ya da kasa açık (zarf dönem anahtarlarından yeniden üretilir)
  // olmalı. YA: { sirHex } (yeni YA platforma); KRA: yeni KRA bu telefonda saklanır, zarf kaydı yeniden yazılır; verilen
  // zarflar (eski KRA kurtarmadan bellekteyse) yeni KRA ile yeniden şifrelenir: { zarflar }. Kurtarma kapanır; eski sır
  // yeni paylardan eşik kadar alındı gelene kadar tutulur (§9 e).
  async rotateVault ({ tur = 'ya', collectionId = null, zarflar = [], ...secenek } = {}) {
    this.locked() // süre dolduysa önce kilitlenir (kurtarma ve sır kapanır)
    const s = this._sir(tur, collectionId)
    const L = this.L
    // Başkasının adıyla YA dağıtımı yok (B13; yaKur ile aynı)
    if (s.tur === 'ya' && secenek.sahip !== undefined && secenek.sahip !== null && L.canonical(hex(secenek.sahip)) !== L.canonical(this._meHex)) fail('UNAUTHORIZED')
    const k = this._kurtarma && this._kurtarma.secretId === s.secretId ? this._kurtarma : null
    const once = this.saklama.get(s.anahtar)
    const bilinen = Math.max(once ? once.version : 0, k && k.version !== null ? k.version : 0, this._gorulen(s.anahtar), this._tutulan(s.secretId))
    if (!bilinen) fail('VERSION_UNKNOWN')
    const eskiBilinen = !!(k && k.sir)
    if (s.tur === 'ya' && !once && !eskiBilinen) fail('NO_OLD_KEY')
    if (s.tur === 'kra' && !eskiBilinen && !this.saklama.get(VRK_SECRET + s.anahtar) && this.locked()) fail('VAULT_LOCKED')
    if (zarflar.length && !eskiBilinen) fail('NO_OLD_KEY')
    const sir = K.dondurme.yeniSir()
    const yeniKra = s.tur === 'kra' ? b4a.from(sir) : null
    let r = null
    let yeniHex = null
    let yeniZarflar = null
    try {
      const dagitim = s.tur === 'ya' ? this.bkDistribution(secenek) : this.vrkDistribution(s.collectionId, { kagit: secenek.kagit ?? 0 })
      if (zarflar.length) {
        const okuyucuMu = this._okuyucuMu(s.collectionId)
        yeniZarflar = K.dondurme.zarflariDondur(L, { eskiKra: k.sir, yeniKra, zarflar: zarflar.map((z) => b4a.from(z, 'hex')), yeniVersion: bilinen + 1, okuyucuMu, writer: this.me }).map(hex)
      }
      if (s.tur === 'ya') yeniHex = hex(sir)
      r = await this._kur(sir, { anahtar: s.anahtar, secretId: b4a.from(s.secretId, 'hex'), kind: s.kind, dagitim, rootId: s.rootId, surum: bilinen + 1 })
      if (yeniKra) this._kraSakla(s.anahtar, r.version, yeniKra)
    } finally {
      sodium.sodium_memzero(sir) // hata yolunda da (B13)
      if (yeniKra) sodium.sodium_memzero(yeniKra)
    }
    if (eskiBilinen) {
      this._eskiSirSil(s.anahtar)
      this._eskiSir.set(s.anahtar, { version: r.version, sir: b4a.from(k.sir) })
    }
    if (k) this._kurtarmaKapat()
    if (s.tur === 'kra') this._zarfDene(s.collectionId, { zorla: true })
    this.emit('vault', { type: 'donduruldu', tur, version: r.version })
    return { ...r, ...(s.tur === 'ya' ? { sirHex: yeniHex } : { collectionId: s.collectionId }), ...(yeniZarflar ? { zarflar: yeniZarflar } : {}) }
  }

  // --- Kasa zarfı kaydı (RFC-0027 §9 b) ---

  // Kayıt yazımı kasanın kilit süresini uzatmaz (kendiliğinden iş, kullanıcı işlemi değil)
  _sessiz (fn) {
    const son = this._son
    try { return fn() } finally { if (this._son !== null) this._son = son }
  }

  _zarfKayitlari (cid) {
    if (!this.kayit || this.locked()) return []
    return this._sessiz(() => this.kayit.query(cid, { type: ENVELOPE_TYPE })).filter((x) => b4a.isBuffer(x.fields.zarf))
  }

  // Bütün saklı KRA'lar için zarfı gerekirse yeniden üretir (kasa açıkken; worklet her değişiklikte ve kilit açılınca
  // çağırır). Hata kilidi ve eşitlemeyi düşürmez: 'kasa' olayı { type: 'zarf_hatasi', collectionId, hata }
  renewEnvelope () {
    const out = []
    if (!this.kayit || this.locked()) return out
    for (const col of this.L.collections.values()) {
      if (col.sensitivity !== 'kasa' || !this.saklama.get(VRK_SECRET + 'kra:' + col.id)) continue
      const r = this._zarfDene(col.id)
      if (r) out.push(r)
    }
    return out
  }

  _zarfDene (cid = null, secenek = {}) {
    if (cid === null) return this.renewEnvelope()
    try { return this._zarfYaz(cid, secenek) } catch (err) { this.emit('vault', { type: 'zarf_hatasi', collectionId: cid, hata: err.message }); return null }
  }

  // Zarf bu telefonun replikasındaki bütün dönem anahtarları ve bırakma sırlarıyla, saklı KRA ile yazılır; aynı sürümün
  // açılabilen zarflarındaki dönemler de birleşir (başka KRA sahibi telefonun bildikleri kaybolmaz). Yeni kayıt yazılınca
  // eski zarf kayıtları silinir. Dönem listesi değişmediyse (zorla değilse) yazılmaz. Dönüş: özet ya da null
  _zarfYaz (cid, { zorla = false } = {}) {
    const r = this.kayit && this.kayit.r
    if (!r || this.locked()) return null
    const anahtar = 'kra:' + cid
    const sakli = this._kraSakli(anahtar)
    if (!sakli) return null
    const { kra, version } = sakli
    try {
      const donemler = r.keys.epochList(cid)
      if (!donemler.length) return null
      const son = donemler[donemler.length - 1]
      const imza = donemler.map((e) => e.epochSeq + ':' + hex(e.epochHash)).join(',')
      const o = this.saklama.get(ENVELOPE + anahtar)
      if (!zorla && o && o.version === version && o.imza === imza) return null
      const A = require('@havenfold/records').anahtar
      const kendi = {
        ic: {
          epochs: donemler.map((e) => ({ epochSeq: e.epochSeq, epochHash: e.epochHash, keys: r.keys.entries(cid, e.epochSeq, e.epochHash) })),
          dropSecrets: r.keys.dropsOf(cid).map((d) => ({ dropKeyHash: A.dropKeyHashOf(d.pub), secret: d.secret }))
        }
      }
      const kayitlar = this._zarfKayitlari(cid)
      const acilan = [kendi]
      let envSeq = o && o.version === version ? o.envSeq : 0
      for (const x of kayitlar) {
        if (x.fields.surum !== version) continue
        if (Number.isSafeInteger(x.fields.env_sira) && x.fields.env_sira > envSeq) envSeq = x.fields.env_sira
        try { acilan.push(this._zarfAcKra(kra, cid, x.fields.zarf)) } catch {}
      }
      const ic = K.zarf.donemleriBirlestir(acilan)
      const sonDonem = Math.max(...ic.epochs.map((e) => e.epochSeq))
      const bytes = K.zarf.zarfYaz(this.L.familyId, kra, { collectionId: b4a.from(cid, 'hex'), version, envSeq: envSeq + 1, ic }, this.me)
      for (const z of acilan.slice(1)) for (const e of z.ic.epochs) for (const g of e.keys) sodium.sodium_memzero(g.key)
      const recordId = this._sessiz(() => {
        const rid = this.kayit.put(cid, null, ENVELOPE_TYPE, { surum: version, env_sira: envSeq + 1, son_donem: sonDonem, zarf: bytes })
        for (const x of kayitlar) if (x.recordId !== rid) this.kayit.del(cid, x.recordId)
        return rid
      })
      const ozet = { version, envSeq: envSeq + 1, sonDonem, donem: ic.epochs.length, imza, recordId: hex(recordId) }
      this.saklama.set(ENVELOPE + anahtar, ozet)
      // Kutudaki opak kopya yenilenir (§9 g): kutu eskisini siler; alındı gelene kadar zarfGidecekler
      const put = K.kutuZarf.zarfGonder(K.kutuZarf.zarfEtiketi(kra, this.L.familyId, cid), bytes)
      this.saklama.set(ENVELOPE_BOX + anahtar, { version, envSeq: envSeq + 1, put: hex(put), kutular: {} })
      this.emit('vault', { type: 'zarf_yazildi', collectionId: cid, version, envSeq: ozet.envSeq, sonDonem })
      return { collectionId: cid, ...ozet }
    } finally {
      sodium.sodium_memzero(kra)
    }
  }

  // Zarfın kutuya gidecek kopyaları (§9 g): alındısı gelmemiş her kutuya KASA_ENV_PUT
  outgoingEnvelopes () {
    const out = []
    const kutular = this.L.boxIds()
    if (!kutular.length) return out
    for (const col of this.L.collections.values()) {
      if (col.sensitivity !== 'kasa') continue
      const z = this.saklama.get(ENVELOPE_BOX + 'kra:' + col.id)
      if (!z || typeof z.put !== 'string') continue
      for (const to of kutular) if (!z.kutular[to]) out.push({ to, type: K.kutuZarf.Z.KASA_ENV_PUT, bytes: b4a.from(z.put, 'hex') })
    }
    return out
  }

  // Gelen KASA_ENV_ACK (tek giriş noktası; §9 g): kutu kopyayı tuttu. Dönüş: 'teslim' | 'bilinmiyor'
  receiveEnvelopeAck (fromHex, bytes, yol) {
    const L = this.L
    const from = hex(fromHex)
    const { mesaj: m } = giris.gelenZarf({ myRole: 'uye', peerRole: L.sessionRole(from), type: K.kutuZarf.Z.KASA_ENV_ACK, bytes, L, gonderen: from, yol })
    if (!L.boxIds().includes(from)) return 'bilinmiyor'
    const anahtar = 'kra:' + hex(m.collectionId)
    const z = this.saklama.get(ENVELOPE_BOX + anahtar)
    if (!z || z.version !== m.version || z.envSeq !== m.envSeq) return 'bilinmiyor'
    z.kutular[from] = true
    this.saklama.set(ENVELOPE_BOX + anahtar, z)
    this.emit('vault', { type: 'zarf_kutuda', collectionId: hex(m.collectionId), version: m.version, envSeq: m.envSeq })
    return 'teslim'
  }

  // Zarfı yazan, zarfın son döneminde ya da bugün kasanın okuyucusu olmalı (envelope.js): sonradan çıkarılmış (kayıp)
  // telefonun yazdığı zarf da, dönemin ortasında katılan (history: true kasada okuyucu eklemek dönem başlatmaz)
  // okuyucunun yazdığı zarf da açılır
  _okuyucuMu (cid) {
    const L = this.L
    const y = new (require('@havenfold/records').yetki.Yetki)()
    y.update(L)
    return (id, seq) => Number.isSafeInteger(seq) && seq < L.len && (y.isReader(cid, id, seq) || y.isReader(cid, id, L.len - 1))
  }

  _zarfAcKra (kra, cid, zarf) {
    const L = this.L
    const okuyucuMu = this._okuyucuMu(cid)
    return K.zarf.zarfAc(L, kra, zarf, { okuyucuMu })
  }

  // --- Pay sahibi tarafı (RFC-0004 §5.2) ---

  // Gelen KASA_VERSION_REQ (tek giriş noktası). Yalnız yetkili istekçiye (B13); kilitliyken paylar arşivde: sürüm pay
  // dizininden, eşik 0 (istekçi eşiği paydan alır). Dönüş: cevap { to, type, bytes } ya da null
  receiveVersionRequest (fromHex, bytes, yol) {
    const L = this.L
    const from = hex(fromHex)
    giris.gelenZarf({ myRole: 'uye', peerRole: L.sessionRole(from), type: K.istek.Z.KASA_VERSION_REQ, bytes, L, gonderen: from, yol })
    const r = this.tutucu.surum(bytes, { from, dizinle: true })
    return r ? { to: from, type: K.istek.Z.KASA_VERSION_RES, bytes: r } : null
  }

  _istekSil (j) {
    this._istekler.delete(j)
    this._kilitliIstek.delete(j)
    this.tutucu._onaylar.delete(j)
  }

  // Süresi dolan (10 dakika) bekleyen istekler bütün kayıtlarıyla silinir (B11)
  _istekTemizle () {
    const now = this.now()
    for (const [j, x] of [...this._istekler]) if (now - x.at > K.istek.ONAY_MS) this._istekSil(j)
    for (const j of [...this._kilitliIstek.keys()]) if (!this._istekler.has(j)) this._kilitliIstek.delete(j)
    this.tutucu.onaylariTemizle()
  }

  // Gelen KASA_SHARE_REQ (tek giriş noktası). Denetimler geçerse kullanıcıya sorulur: 'kasa' olayı { type: 'pay_istegi',
  // jeton, kimden, tur }; 72 saat beklemesinde { type: 'pay_istegi_bekliyor', kimden, bitis }. Kasa kilitliyken paylar
  // arşivdedir: pay dizininde varsa bütün diğer denetimlerden geçen istek yine sorulur (B11); onay kilit açıkken verilir.
  // Aynı istekçi, sır ve sürüm için tek bekleyen istek (yenisi eskisinin yerine). Dönüş: { durum }
  receiveShareRequest (fromHex, bytes, yol) {
    const L = this.L
    const from = hex(fromHex)
    const { mesaj: m } = giris.gelenZarf({ myRole: 'uye', peerRole: L.sessionRole(from), type: K.istek.Z.KASA_SHARE_REQ, bytes, L, gonderen: from, yol })
    this._istekTemizle()
    const kilitli = this.locked()
    const r = this.tutucu.denetle(bytes, { from, dizinle: kilitli })
    if (r.bekle) {
      this.emit('vault', { type: 'pay_istegi_bekliyor', kimden: from, bitis: r.bekle })
      return { durum: 'bekle', bitis: r.bekle }
    }
    if (!r.onayGerekli) return { durum: 'red', red: r.red }
    const sid = hex(m.secretId)
    for (const [j, x] of [...this._istekler]) if (x.kimden === from && x.secretId === sid && x.version === m.version) this._istekSil(j)
    const jeton = hex(r.jeton)
    const bilgi = { jeton, kimden: from, tur: m.kind === K.pay.TUR.YA ? 'ya' : 'kra', secretId: sid, version: m.version, at: this.now(), kilitli }
    this._istekler.set(jeton, bilgi)
    if (kilitli) this._kilitliIstek.set(jeton, true)
    this.emit('vault', { type: 'pay_istegi', jeton, kimden: from, tur: bilgi.tur })
    return { durum: 'onay', jeton }
  }

  // 405 VAULT_SHARE_APPROVE: kullanıcı izin verdi ya da vermedi. İzin yalnız kasa açıkken (biyometri; RFC-0027 §9 a, B9);
  // kilitliyken VAULT_LOCKED, istek yerinde kalır. Verilince pay istekçiye gider (KASA_SHARE_RES; tazelik dışındaki
  // denetimler yeniden çalışır, onay istekten en çok 10 dakika sonra). Dönüş: { durum: 'verildi' | 'reddedildi' | 'red', red? }
  approveShare ({ jeton, onay = false } = {}) {
    const j = typeof jeton === 'string' && /^[0-9a-f]{32}$/.test(jeton) ? jeton : ''
    this._istekTemizle()
    const bilgi = this._istekler.get(j)
    if (!bilgi) return { durum: 'red', red: 'NO_APPROVAL' }
    if (!onay) { this._istekSil(j); return { durum: 'reddedildi' } }
    if (this.locked()) fail('VAULT_LOCKED')
    this._son = this.now() // kasa işlemi: kilit süresi yenilenir
    this._istekler.delete(j)
    this._kilitliIstek.delete(j)
    const r = this.tutucu.ver(b4a.from(j, 'hex'))
    if (!r.ver) return { durum: 'red', red: r.red || 'NO_APPROVAL' }
    this._giden.push({ to: bilgi.kimden, type: K.istek.Z.KASA_SHARE_RES, bytes: r.ver })
    this.emit('vault', { type: 'pay_verildi', kimden: bilgi.kimden })
    return { durum: 'verildi' }
  }

  // --- Durum (Ayarlar → Kasa, RFC-0004 §7) ---

  _ozet (anahtar, collectionId = null) {
    const o = this.saklama.get(anahtar)
    if (!o) return null
    const sahipler = o.sahipler.map((s) => ({ ...s, ad: this._ad(s), teslim: s.tur === 'kagit' ? null : !o.teslim || o.teslim[s.id] === true }))
    // kaybetti: eşzamanlı döndürmede bu telefonun dağıtımı geri çekildi, geçerli olan başka telefonunki (RFC-0027 §9 e);
    // bilinen: görülen en büyük sürüm (§9 f)
    return {
      version: o.version, t: o.t, n: o.n, sahipler, at: o.at, kaybetti: !!o.kaybetti, bilinen: Math.max(o.version, this._gorulen(anahtar)),
      eksikKagit: o.basildi.map((b, i) => (b ? null : i + 1)).filter(Boolean),
      dondurmeGerekli: K.esik.dondurmeGerekli(this.L, o.sahipler, { uygunCihaz: this.kanca.uygunCihaz, collectionId })
    }
  }

  // Bu telefonun yazdığı son kasa zarfı (RFC-0027 §9 b): { version, envSeq, sonDonem, donem } ya da null
  _zarfOzeti (cid) {
    const z = this.saklama.get(ENVELOPE + 'kra:' + cid)
    if (!z) return null
    const k = this.saklama.get(ENVELOPE_BOX + 'kra:' + cid)
    const kutular = this.L.boxIds()
    // kutu: kutudaki kopya bu zarf mı (kutu yoksa null; §9 g)
    const kutu = kutular.length ? !!(k && k.version === z.version && k.envSeq === z.envSeq && kutular.every((x) => k.kutular[x])) : null
    return { version: z.version, envSeq: z.envSeq, sonDonem: z.sonDonem, donem: z.donem, kutu }
  }

  // Dönüş: { kilitli, ya: özet | null, kasalar: [{ collectionId, ad, kurulu: özet | null, onizleme: dağıtım, zarf }] }
  status () {
    const L = this.L
    const me = L.canonical(this._meHex)
    const kasalar = [...L.collections.values()].filter((c) => c.sensitivity === 'kasa' && c.readers.length > 0).map((c) => {
      let onizleme = null
      try { onizleme = this.vrkDistribution(c.id) } catch {}
      return { collectionId: c.id, ad: c.name, kurulu: this._ozet('kra:' + c.id, c.id), onizleme, zarf: this._zarfOzeti(c.id) }
    })
    return { kilitli: this.locked(), ya: this._ozet('ya:' + me), kasalar }
  }
}

module.exports = { VaultApi, MemoryStorage, VAULT_COMMAND, LOCK_MS, paperLines: paperLines, TO_SEND, TO_DELETE, VRK_SECRET, SEEN, ENVELOPE, ENVELOPE_BOX, ENVELOPE_TYPE, isSecret: isSecret }
