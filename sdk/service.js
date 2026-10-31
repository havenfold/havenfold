// SPDX-License-Identifier: Apache-2.0
// service.js — hizmet paylaşımının ürün yüzü (RFC-0010 §5, §6, §8.1, §10, §12, açıklama 1; komutlar 300–306)
//
// Hizmet dizinleri (il başına, kalıcı) ve yüz yüze kart; paketin kayıtlardan kurulması ve tam önizlemesi; SHARE_CONSENT
// ile onay; gönderim koşulu ve paketin kurulması; iptal ve alıcıdan silme; Paylaşımlar kaydı. Geçitle konuşma (HTTPS:
// dizin indirme, PUT, DELETE, cevap çekme) platformun işidir: dizin baytları buraya verilir, gonder() ve iptal() alıcıya
// gidecek istekleri döndürür, platform PUT başarılı olunca gonderildi()'yi çağırır. İmzacı başlatandan başkaysa
// SHARE_PREVIEW (0xD0) imzacıya gider, imzacı kendi telefonunda onaylar, başlatan gönderir. Cevaplar (309) platformun
// GET /v1/r isteğiyle gelir, burada açılır ve kaydedilir. Sürekli kural (307–308) sonraki adımdır (§20 adım 7).
const b4a = require('b4a')
const sodium = require('sodium-native')
const c = require('compact-encoding')
const { ledger: { T }, giris, zarf: { Z } } = require('@havenfold/core')
const H = require('@havenfold/services')
const { Emitter } = require('./api')

const { kart: Kt, paket: P, onay: O, kodlama: K, cevap: Cv, onizleme: Oz } = H
const hex = (b) => (typeof b === 'string' ? b : b4a.toString(b, 'hex'))
const unhex = (x) => (typeof x === 'string' ? b4a.from(x, 'hex') : x)
function fail (code) { throw new Error(code) }
const rastgele = (n) => { const b = b4a.alloc(n); sodium.randombytes_buf(b); return b }

// RFC-0010 §16 (300–309 hizmet). 307 RULE_SET ve 308 RULE_STOP sürekli kuralla gelir (§20 adım 7).
const SERVICE_COMMAND = { SERVICE_DIRECTORY: 300, SERVICE_CARD_ADD: 301, SHARE_PREPARE: 302, SHARE_APPROVE: 303, SHARE_SEND: 304, SHARE_CANCEL: 305, SHARE_LIST: 306, REPLY_FETCH: 309 }
const DOSYALAR = c.array(K.dosyaEnc)
const TASLAK_MS = 24 * 3_600_000 // onay gelmezse taslak silinir (§8.1)
const ONIZLEMELI_TASLAK_MS = 7 * 86_400_000
const KALINTI_MS = 30 * 86_400_000 // iptal ve süre kalıntısı ({ shareId, durum })
const A_BEKLEYEN = 'hizmet/bekleyen-onizleme'
const BEKLEYEN_MS = 7 * 86_400_000 // önizlemesi imzacıya gitmiş taslak imzacının onay penceresi boyunca durur (açıklama 2 madde 2)
const ZERO16 = b4a.alloc(16)
const A_DIZIN = 'hizmet/dizinler'
const A_TASLAK = 'hizmet/taslaklar'

// Dosya başvurusu taşıyan değer: koleksiyondaki dosyanın anahtarı hizmete verilmez (§7.1); dosyalar ayrı, yeni anahtarla
const dosyaMi = (v) => !!v && typeof v === 'object' && (b4a.isBuffer(v.blobId) || (Array.isArray(v) && v.some(dosyaMi)))
// Pakete giremeyen alanlar (açıklama 2 madde 1): öğenin `_subj`'u ve aile içi kimlik başvuruları; kişi hizmete yalnız takma
// adıyla görünür. Kimlik taşıyan değer (uye:/grant:/device: ile başlayan metin ya da onu içeren dizi) alanı düşürür.
const KIMLIK_ON = /^(uye|grant|device):/
const kimlikMi = (v) => (typeof v === 'string' && KIMLIK_ON.test(v)) || (Array.isArray(v) && v.some(kimlikMi))
const paketeGirer = (a, v) => a !== '_subj' && !dosyaMi(v) && !kimlikMi(v)

class ServiceApi extends Emitter {
  // kayit: RecordApi; defter: LedgerApi (aynı defter); paylasimlar: Paylaşımlar koleksiyonunun kimliği; dizinAnahtarlari:
  // uygulamanın sabit dizin açık anahtarları (geçerli ve sıradaki, §5.1); saklama: { get(k), set(k, v) } — zorunlu:
  // takma adlar Arşiv katmanında durup yedeğe girer (§7.4), il dizinleri ve taslaklar da burada kalır
  constructor ({ kayit, defter, paylasimlar, dizinAnahtarlari = [], saklama, now = Date.now }) {
    super()
    if (!saklama) fail('STORAGE_REQUIRED')
    this.kayit = kayit
    this.defter = defter
    this.paylasimlarId = hex(paylasimlar)
    this.anahtarlar = dizinAnahtarlari.map(unhex)
    this.now = now
    this.saklama = saklama
    this._dizinler = new Map() // il → çözülmüş dizin
    for (const [il, b] of Object.entries(saklama.get(A_DIZIN) || {})) {
      try { this._dizinler.set(il, Kt.dizinCoz(b4a.from(b, 'hex'), this.anahtarlar)) } catch {}
    }
  }

  get _L () { return this.defter.L }
  get _me () { return hex(this.defter.me.memberId) }
  get _ben () { return this._L.canonical(this._me) }

  // --- Hizmetler (§5; açıklama 1 madde 1–3) ---

  _dizinListesi () { return [...this._dizinler.values()] }

  _iptalli (id) { return this._dizinListesi().some((d) => d.revoked.has(id)) }

  // Rozet güncel dizinden: hizmet güncel bir il dizininde varsa 'dizin'
  _rozet (id) { return this._dizinListesi().some((d) => this.now() <= d.validUntil && d.kartlar.has(id)) ? 'dizin' : 'yuz-yuze' }

  // 300 SERVICE_DIRECTORY: { bytes } verilirse bir il dizini yüklenir ve saklanır (platform GET /v1/dizin/{region} ile
  // indirir). Aynı ilin daha eski sürümü INDEX_STALE. Dönüş { iller, hizmetler }: hizmetler güncel dizinlerdekiler.
  directory ({ bytes = null } = {}) {
    if (bytes) {
      const d = Kt.dizinCoz(unhex(bytes), this.anahtarlar)
      const once = this._dizinler.get(d.region)
      if (once && d.version < once.version) fail('INDEX_STALE')
      this._dizinler.set(d.region, d)
      this.saklama.set(A_DIZIN, Object.fromEntries([...this._dizinler].map(([il, x]) => [il, hex(x.bytes)])))
      this.emit('changed', 'dizin')
    }
    const simdi = this.now()
    const iller = this._dizinListesi().map((d) => ({ region: d.region, version: d.version, validUntil: d.validUntil, guncel: simdi <= d.validUntil, atlanan: d.atlanan.length }))
    const hizmetler = new Map()
    for (const d of this._dizinListesi()) {
      if (simdi > d.validUntil) continue
      for (const [id, k] of d.kartlar) if (!this._iptalli(id)) hizmetler.set(id, Kt.enYeni(hizmetler.get(id), k))
    }
    return { iller, hizmetler: [...hizmetler.values()].map((k) => hizmetOf(k, 'dizin')) }
  }

  // Topluluğun eklediği kartlar (hf.hizmet.kart): aynı hizmetin en yeni geçerli kartı (açıklama 1 madde 2)
  _eklenen () {
    const out = new Map()
    for (const r of this.kayit.query(this.paylasimlarId, { type: 'hf.hizmet.kart' })) {
      let k
      try { k = Kt.kartCoz(r.fields.card) } catch { continue }
      const id = hex(k.serviceId)
      out.set(id, Kt.enYeni(out.get(id), k))
    }
    return out
  }

  // P39 / B44: { eklenen, dizin }; rozet güncel dizinden, kayıttan değil
  services () {
    const eklenen = [...this._eklenen()].filter(([id]) => !this._iptalli(id)).map(([id, k]) => {
      const { kart, trust } = this._kartSonra(id, k)
      return hizmetOf(kart, trust)
    })
    return { eklenen, dizin: this.directory().hizmetler }
  }

  _kartSonra (id, eklenen) {
    try { return Kt.hizmetKarti({ dizinler: this._dizinListesi(), kart: eklenen, serviceId: unhex(id), simdi: this.now() }) } catch { return { kart: eklenen, trust: 'yuz-yuze' } }
  }

  // 301 SERVICE_CARD_ADD: yüz yüze okutulan QR (§5.2). Dizin gerekmez. Bilinen bir dizinin revoked listesindeki hizmet
  // eklenmez; topluluğun kartından eski kart CARD_STALE.
  addCard ({ qr }) {
    const k = Kt.qrCoz(qr)
    const id = hex(k.serviceId)
    if (this._iptalli(id)) fail('NOT_SERVICE_ELIGIBLE')
    const once = this._eklenen().get(id)
    if (!once || Kt.kartSec(once, k) !== once) {
      const t = this.now()
      this.kayit.put(this.paylasimlarId, null, 'hf.hizmet.kart', { _v: 1, _t: t, _subj: 'topluluk', card: k.bytes, trust: this._rozet(id), added_by: this._me, added_at: t })
    }
    const s = this._kartSonra(id, Kt.enYeni(once, k))
    return hizmetOf(s.kart, s.trust)
  }

  // Paylaşım için hizmetin kartı: yüz yüze eklenen dizinsiz geçer; yalnız dizinden seçilen güncel dizin ister
  // onizlemeKarti: imzacının telefonunda SHARE_PREVIEW'deki kart (topluluğun kaydı henüz eşitlenmemişse)
  _kart (serviceId, onizlemeKarti = null) {
    const ek = Kt.enYeni(this._eklenen().get(hex(serviceId)) || null, onizlemeKarti ? Kt.kartCoz(b4a.from(onizlemeKarti, 'hex')) : null)
    return Kt.hizmetKarti({ dizinler: this._dizinListesi(), kart: ek, serviceId: unhex(serviceId), simdi: this.now() })
  }

  // --- Paket (§7, §8.1; açıklama 1 madde 4, 5, 7) ---

  // Üyenin bu hizmetteki takma adı: ilk paylaşımda üretilir, saklamada durur
  _takma (serviceId) {
    const a = 'hizmet/takma/' + hex(serviceId)
    let s = this.saklama.get(a)
    if (!s) { s = hex(P.takmaAd().secretKey); this.saklama.set(a, s) }
    const secretKey = b4a.from(s, 'hex')
    return { secretKey, publicKey: secretKey.subarray(32) }
  }

  // Onayı kim imzalar (§6.2; ailede RFC-0003 §5.7, ekipte RFC-0005 §6.2). Dönüş { hepsi, biri }: hepsi'ndekilerin
  // hepsi ve biri'ndekilerden en az biri imzalar.
  //   aile: ortak veri → bir ebeveyn; yetişkinin verisi → kendisi; çocuğun verisi → bir ebeveyn
  //   ekip: ortak veri → bir sahip; üyenin iş verisi → o üye ve bir sahip
  _imzacilar (ownerId) {
    const L = this._L
    const ekip = L.kind === 'ekip'
    const sahipler = () => L.personIds().filter((id) => L.members.get(id).role === 'sahip')
    if (b4a.equals(unhex(ownerId), ZERO16)) return { hepsi: [], biri: ekip ? sahipler() : L.parentIds() }
    const o = L.canonical(hex(ownerId))
    if (!o) fail('NO_TARGET')
    if (ekip) return { hepsi: [o], biri: sahipler().filter((x) => x !== o) }
    return L.members.get(o).role === 'cocuk' ? { hepsi: [], biri: L.parentIds() } : { hepsi: [o], biri: [] }
  }

  _imzaciMi (ownerId) {
    const i = this._imzacilar(ownerId)
    return i.hepsi.includes(this._ben) || i.biri.includes(this._ben)
  }

  // Kaynak kayıtlardan öğeler ve verinin sahibi (açıklama 1 madde 4): her kaydın _subj'u (uye:<id>) sahibidir; sahipsiz
  // kayıt ortak veridir. Paket tek sahibin verisini taşır (bir shareId'ye bir SHARE_CONSENT onaydır, §6.4): karışıksa
  // MIXED_OWNER, ürün ayrı paketlere böler. Sahip yerelde kalır: öğeye _subj, kimlik başvurusu ve dosya başvurusu
  // girmez (açıklama 2 madde 1).
  _ogeler (kaynaklar, kaynak) {
    const L = this._L
    const kollar = this.kayit.collections()
    const ogeler = []
    const sahipler = new Set()
    for (const x of kaynaklar) {
      const cid = hex(x.collectionId)
      if (!kollar.find((c) => c.collectionId === cid)?.okur) fail('NO_PERMISSION')
      const ids = (x.recordIds || []).map(hex)
      if (!ids.length) fail('RECORD_REQUIRED')
      for (const rid of ids) {
        const r = this.kayit.get(cid, rid) || fail('NO_RECORD')
        const secilen = x.alanlar ? new Set([...x.alanlar, '_v', '_t']) : null
        const alanlar = Object.fromEntries(Object.entries(r.fields).filter(([a, v]) => (!secilen || secilen.has(a)) && paketeGirer(a, v)))
        const subj = typeof r.fields._subj === 'string' ? r.fields._subj : ''
        const sahip = subj.startsWith('uye:') ? L.canonical(subj.slice(4)) : null
        if (subj.startsWith('uye:') && !sahip) fail('NO_TARGET')
        sahipler.add(sahip || hex(ZERO16))
        ogeler.push({ type: r.type, fields: P.alanlarKodla(alanlar) })
      }
    }
    if (kaynak.kisisel) return { ogeler, ownerId: kaynak.ownerId }
    if (sahipler.size > 1) fail('MIXED_OWNER')
    return { ogeler, ownerId: unhex([...sahipler][0]) }
  }

  // 302 SHARE_PREPARE: öğeler kaynak kayıtlardan kurulur, gövde kesinleşir (dosya anahtarları ve replyPub içinde),
  // payloadHash hesaplanır; henüz hiçbir şey yazılmaz. t: { serviceId, kaynaklar: [{ collectionId, recordIds, alanlar? }],
  // title, note?, files? (yeniden şifrelenmiş, §7.1), label, kullanimGun?, sureGun? }. Dönüş tam önizleme (§8.1 adım 2)
  prepare (t) {
    const kaynak = O.kaynakDenetle(this._L, this._me, (t.kaynaklar || []).map((x) => x.collectionId))
    const { kart } = this._kart(t.serviceId)
    const { ogeler, ownerId } = this._ogeler(t.kaynaklar, kaynak)
    const simdi = this.now()
    const shareId = rastgele(16)
    const cevap = P.sifreCifti()
    const takma = this._takma(kart.serviceId)
    const govde = P.govdeKodla({
      serviceId: kart.serviceId, shareId, kind: 'tek', category: kart.category, title: t.title, note: t.note || '',
      items: ogeler, files: t.files || [], issuedAt: simdi, useUntil: simdi + (t.kullanimGun || 30) * K.GUN_MS,
      replyPub: cevap.publicKey, sender: { pseudoPub: takma.publicKey, label: t.label || '' }
    })
    P.boyutDenetle(P.govdeCoz(govde), kart)
    const sureGun = Math.min(t.sureGun || K.SINIR.onayGun.tek, K.SINIR.onayGun.tek)
    const taslak = {
      shareId: hex(shareId), serviceId: hex(kart.serviceId), tur: kaynak.tur, ownerId: hex(ownerId), kisisel: kaynak.kisisel,
      govde: hex(govde), replySecret: hex(cevap.secretKey), salt: null, expiresAt: simdi + sureGun * K.GUN_MS, olusturma: simdi,
      baslatan: this._me, kaynaklar: t.kaynaklar.map((x) => ({ collectionId: hex(x.collectionId), recordIds: x.recordIds.map(hex) }))
    }
    this._taslakYaz(taslak)
    return this._onizleme(taslak, kart)
  }

  // Önizleme paketin tam içeriğidir (açıklama 1 madde 7): öğelerin alanları, dosyalar ve gövde baytları
  _onizleme (x, kart) {
    const body = b4a.from(x.govde, 'hex')
    const g = P.govdeCoz(body)
    return {
      shareId: x.shareId, hizmet: hizmetOf(kart, this._rozet(hex(kart.serviceId))), tur: x.tur, kategori: kart.category,
      ozelNitelikli: K.OZEL_NITELIKLI.includes(kart.category), yurtDisi: Kt.yurtDisi(kart),
      baslik: g.title, not: g.note, ogeler: g.items.map((i) => ({ type: i.type, alanlar: P.alanlarCoz(i.fields) })),
      dosyalar: g.files.map((f) => ({ ad: f.name, mime: f.mime, boyut: f.size })), kullanim: g.useUntil, saklamaGun: kart.keepDays,
      etiket: g.sender.label, govde: body, payloadHash: hex(P.payloadHash(body)), expiresAt: x.expiresAt, ownerId: x.ownerId,
      imzacilar: this._imzacilar(x.ownerId), kaynaklar: x.kaynaklar
    }
  }

  // Onaylı (defterde onayı olan) taslak düşmez; önizlemesi gitmiş ya da gelmiş taslak 7 gün, diğeri 24 saat durur. İptal
  // edilmiş ya da süresi geçmiş (gönderilmeden) taslaktan açık gövde, paket baytları ve sırlar silinir; yalnız { shareId, durum,
  // olusturma } kalır (açıklama 3 madde 2). Kalıntılar 30 gün sonra düşer.
  _taslaklar () {
    const onaylar = O.onaylar(this._L)
    const simdi = this.now()
    const ham = this.saklama.get(A_TASLAK) || []
    let degisti = false
    const out = []
    for (const x of ham) {
      const o = onaylar.get(x.shareId)
      if (!x.govde) { if (simdi - x.olusturma < KALINTI_MS) out.push(x); else degisti = true; continue }
      const bitti = o && (o.durum === 'iptal' || (simdi > o.expiresAt && !x.gonderim))
      if (bitti) { out.push({ shareId: x.shareId, durum: o.durum === 'iptal' ? 'iptal' : 'suresi-gecti', olusturma: x.olusturma }); degisti = true; continue }
      if (o || simdi - x.olusturma < (x.onizlemeGitti || x.onizleme ? ONIZLEMELI_TASLAK_MS : TASLAK_MS)) out.push(x)
      else degisti = true
    }
    if (degisti) this.saklama.set(A_TASLAK, out)
    return out.filter((x) => x.govde)
  }

  _taslakYaz (x) {
    this._taslaklar()
    this.saklama.set(A_TASLAK, [...(this.saklama.get(A_TASLAK) || []).filter((y) => y.shareId !== x.shareId), x])
  }

  _taslak (shareId) { return this._taslaklar().find((x) => x.shareId === hex(shareId)) || fail('NO_DRAFT') }

  // 303 SHARE_APPROVE (§8.1 adım 3): imzacı SHARE_CONSENT'i yazar. Özel nitelikli kategoride açık rıza metninin
  // sürümü, yurt dışı hizmette ayrı rıza zorunludur (§14). Ekipte üyenin iş verisinde ikinci imza (sahip) gerekirse
  // olay öneri olur ve diğer imzacı LedgerApi.sign ile tamamlar. İmzacı başkasıysa NOT_SIGNER (SHARE_PREVIEW sonraki adım).
  // payloadHash: ekranda gösterilen önizlemenin özeti; imza aynı içeriğe atılır (açıklama 2 madde 2)
  confirm ({ shareId, payloadHash = null, consentTextVersion = null, yurtDisiRiza = false }) {
    const x = this._taslak(shareId)
    if (O.onaylar(this._L).has(x.shareId) || x.oneriId) fail('APPROVAL_EXISTS')
    if (payloadHash == null) fail('SUMMARY_REQUIRED')
    if (hex(payloadHash) !== hex(P.payloadHash(b4a.from(x.govde, 'hex')))) fail('SUMMARY_MISMATCH')
    const { kart } = this._kart(x.serviceId, x.kart)
    if (K.OZEL_NITELIKLI.includes(kart.category) && !Number.isSafeInteger(consentTextVersion)) fail('CONSENT_TEXT_REQUIRED')
    if (Kt.yurtDisi(kart) && yurtDisiRiza !== true) fail('ABROAD_CONSENT_REQUIRED')
    if (!this._imzaciMi(x.ownerId)) fail('NOT_SIGNER')
    const govde = b4a.from(x.govde, 'hex')
    const r = O.onayGovdesi({
      shareId: b4a.from(x.shareId, 'hex'), serviceId: kart.serviceId, tur: x.tur, kategori: kart.category, ownerId: b4a.from(x.ownerId, 'hex'),
      expiresAt: x.expiresAt, payloadHash: P.payloadHash(govde), simdi: this.now()
    })
    const s = this.defter._yaz(T.SHARE_CONSENT, r.govde)
    const ek = { salt: r.salt && hex(r.salt), consentTextVersion, yurtDisi: Kt.yurtDisi(kart) }
    if (s.durum === 'oneri') {
      this._taslakYaz({ ...x, ...ek, oneriId: s.oneriId })
      return { shareId: x.shareId, durum: 'oneri', oneriId: s.oneriId, waitingFor: s.waitingFor }
    }
    this._taslakYaz({ ...x, ...ek })
    this.emit('changed', 'paylasim')
    return { shareId: x.shareId, durum: 'uygulandi', seq: s.event.seq }
  }

  // 304 SHARE_SEND (§8.1 adım 4–5): gönderim koşulu her çağrıda denetlenir; iptal edilmiş ya da süresi geçmiş onayla
  // yeniden deneme dahil hiçbir şey gitmez (açıklama 1 madde 6). Aynı onayla bir paket: yeniden deneme aynı baytları
  // döndürür (§8.2). Teslim penceresi gönderim anından 7 gündür (madde 5). Dönüş: platformun PUT /v1/p/{serviceId}/{packageId}
  // isteği { endpoint, serviceId, packageId, bytes, owner }; PUT başarılı olunca gonderildi() çağrılır.
  send ({ shareId }) {
    const x = this._taslak(shareId)
    if (x.onizleme) fail('INITIATOR_SENDS')
    const { kart } = this._kart(x.serviceId)
    const onay = O.onaylar(this._L).get(x.shareId)
    const govde = b4a.from(x.govde, 'hex')
    O.gonderimDenetle({ onay, govdeBytes: govde, serviceId: kart.serviceId, simdi: this.now(), salt: x.salt && b4a.from(x.salt, 'hex') })
    if (x.gonderim) return x.gonderim.istek
    const takma = this._takma(kart.serviceId)
    const ic = P.icImzala(kart.serviceId, govde, takma.secretKey)
    const simdi = this.now()
    const p = P.paketKur({ kart, ic, expiresAt: simdi + K.SINIR.teslimGun * K.GUN_MS, simdi })
    const ownerSecret = rastgele(32)
    const istek = { endpoint: kart.endpoint, serviceId: hex(kart.serviceId), packageId: hex(p.packageId), bytes: p.bytes, owner: P.sahipOzeti(ownerSecret) }
    this._taslakYaz({ ...x, gonderim: { istek, ctHash: hex(p.ctHash), serviceName: kart.name, category: kart.category, ownerSecret: hex(ownerSecret), sentAt: simdi, kayitli: false } })
    return istek
  }

  // Alıcı PUT'u kabul edince (201 ya da 409 tekrar): hf.paylasim.gonderildi yazılır (§8.1 adım 6). İkinci çağrı bir şey yazmaz.
  sent ({ shareId }) {
    const x = this._taslak(shareId)
    const gd = x.gonderim || fail('NO_DELIVERY')
    if (gd.kayitli) return { packageId: gd.istek.packageId }
    const onay = O.onaylar(this._L).get(x.shareId) || fail('NO_APPROVAL')
    const g = P.govdeCoz(b4a.from(x.govde, 'hex'))
    const yer = O.kayitYeri({ onay, paylasimlar: this.paylasimlarId, kisisel: x.kisisel })
    this.kayit.put(yer, null, 'hf.paylasim.gonderildi', {
      _v: 1, _t: gd.sentAt, _subj: 'topluluk', share_id: unhex(x.shareId), package_id: unhex(gd.istek.packageId), service_id: unhex(gd.istek.serviceId),
      service_name: gd.serviceName, category: gd.category, kind: 'tek', seq_no: 0, payload_hash: onay.payloadHash, ct_hash: unhex(gd.ctHash),
      size: gd.istek.bytes.byteLength + g.files.reduce((a, f) => a + f.size, 0), file_count: g.files.length, sent_at: gd.sentAt, sender_id: this._me,
      consent_seq: onay.seq, owner_secret: unhex(gd.ownerSecret), reply_secret: unhex(x.replySecret), consent_text_version: x.consentTextVersion ?? 0,
      ...(x.yurtDisi ? { yurt_disi: true } : {}), ...(x.salt ? { salt: unhex(x.salt) } : {})
    })
    this._taslakYaz({ ...x, gonderim: { ...gd, kayitli: true } })
    this.emit('changed', 'paylasim')
    return { packageId: gd.istek.packageId }
  }

  // Bu paylaşımın gönderim kayıtları: Paylaşımlar'da ya da (gizli onayda) okunabilen kişisel koleksiyonlarda
  // silme: silme paketlerinin kayıtları da (varsayılan yalnız veri paketi)
  _gonderimKayitlari (id, { silme = false } = {}) {
    const kollar = [this.paylasimlarId, ...this.kayit.collections().filter((c) => c.kind === 'kisisel' && c.okur).map((c) => c.collectionId)]
    return kollar.flatMap((cid) => this.kayit.query(cid, { type: 'hf.paylasim.gonderildi' }).map((r) => r.fields).filter((f) => hex(f.share_id) === id && (silme || f.kind !== 'silme')))
  }

  // 305 SHARE_CANCEL (§12.1; açıklama 1 madde 6): onaylanmamış taslak silinir; onaylı paylaşımda iptal SHARE_CONSENT'i
  // yazılır (imzacı kuralı onayınkiyle aynı; ekipte ikinci imza gerekirse öneri). Gönderilmiş paket için silme isteği
  // Paylaşımlar kaydındaki owner_secret'ten kurulur: paketi başka bir cihaz göndermiş olsa da. Başka bir cihaz zaten
  // iptal etmişse yeni olay yazılmaz, yalnız silme isteği döner. Hizmet paketi çekmişse alıcı 409 verir; arayüz
  // "Hizmetten silmesini iste" önerir (§12.2).
  cancel ({ shareId }) {
    const id = hex(shareId)
    const x = this._taslaklar().find((y) => y.shareId === id) || null
    const onay = O.onaylar(this._L).get(id)
    if (!onay) {
      if (!x) fail('NO_SHARE')
      this.saklama.set(A_TASLAK, (this.saklama.get(A_TASLAK) || []).filter((y) => y.shareId !== id))
      this.emit('changed', 'paylasim')
      return { durum: 'silindi', sil: [] }
    }
    const sil = this._silmeIstekleri(id, x)
    if (onay.iptal) { this._taslaklar(); return { durum: 'iptal', seq: onay.iptal.seq, sil } }
    // İptal defter olayıdır; Paylaşımlar'ın her okuyucusu yazabilir (açıklama 3 madde 1). Gizli onayın kaynağı sahibin kişisel
    // koleksiyonudur: onu yalnız sahibi iptal eder
    if (!this._okuyucuMu()) fail('NO_PERMISSION')
    if (onay.tur === 'gizli' && hex(onay.ownerId) !== this._ben) fail('NO_PERMISSION')
    const s = this.defter._yaz(T.SHARE_CONSENT, O.iptalGovdesi(onay))
    if (s.durum === 'oneri') return { durum: 'oneri', oneriId: s.oneriId, waitingFor: s.waitingFor, sil: [] }
    const yer = onay.tur === 'gizli' ? (x && x.kisisel) || this._gonderimYeri(id) : this.paylasimlarId
    if (yer) this.kayit.put(yer, null, 'hf.paylasim.iptal', { _v: 1, _t: this.now(), _subj: 'topluluk', share_id: unhex(id), consent_seq: onay.seq, by: this._me, deleted_at_gateway: false })
    this._taslaklar() // taslağın gövdesi ve sırları silinir
    this.emit('changed', 'paylasim')
    return { durum: 'iptal', seq: s.event.seq, sil }
  }

  // Paylaşımlar'ın okuyucusu mu (aile: ebeveyn, yetişkin; ekip: sahip, yönetici; RFC-0010 §10.1)
  _okuyucuMu () {
    const ben = this._ben
    const rol = ben && this._L.members.get(ben)?.role
    return ['ebeveyn', 'yetiskin', 'sahip', 'yonetici'].includes(rol)
  }

  // DELETE /v1/p/{serviceId}/{packageId} istekleri (x-hf-owner-secret): kayıtlardan ve bu telefonda henüz kaydı
  // yazılmamış gönderimden
  _silmeIstekleri (id, x) {
    const out = new Map()
    const ekle = (sid, pid, sir) => {
      const kart = this._eklenen().get(sid) || this._dizinListesi().map((d) => d.kartlar.get(sid)).find(Boolean)
      out.set(pid, { endpoint: kart ? kart.endpoint : null, serviceId: sid, packageId: pid, ownerSecret: sir })
    }
    for (const f of this._gonderimKayitlari(id)) ekle(hex(f.service_id), hex(f.package_id), hex(f.owner_secret))
    if (x && x.gonderim && !out.has(x.gonderim.istek.packageId)) ekle(x.gonderim.istek.serviceId, x.gonderim.istek.packageId, x.gonderim.ownerSecret)
    return [...out.values()]
  }

  // --- Önizleme (SHARE_PREVIEW 0xD0, §8.1 adım 2) ---

  // Başlatan imzacı değilse: önizleme zarfı imzacılara gider (doğrudan oturum, emanet ya da Posta Kutusu; K12 mührü
  // taşıyıcıda). Dönüş { type, bytes, kime }; kime imzacıların kimlikleri.
  sendPreview ({ shareId }) {
    const x = this._taslak(shareId)
    if (x.onizleme) fail('NOT_INITIATOR')
    if (x.tur !== 'tek') fail('PREVIEW_UNNEEDED') // gizli paylaşımın imzacısı başlatanın kendisi
    const L = this._L
    const bytes = Oz.onizlemeKur({
      familyId: L.familyId, shareId: unhex(x.shareId), card: this._kart(x.serviceId).kart.bytes, body: b4a.from(x.govde, 'hex'),
      sources: x.kaynaklar.map((k) => ({ collectionId: unhex(k.collectionId), recordIds: k.recordIds.map(unhex) })), fromId: this.defter.me.memberId,
      signSecret: this.defter.me.signKeyPair.secretKey
    })
    const i = this._imzacilar(x.ownerId)
    return { type: Z.SHARE_PREVIEW, bytes, kime: [...new Set([...i.hepsi, ...i.biri])].filter((id) => id !== this._ben) }
  }

  // Önizleme imzacıya teslim edildi (platformun zarf kuyruğundan; açıklama 3 madde 3): taslak imzacının onay penceresi boyunca durur
  deliverPreview ({ shareId }) {
    const x = this._taslaklar().find((y) => y.shareId === hex(shareId))
    if (x && !x.onizlemeGitti) { this._taslakYaz({ ...x, onizlemeGitti: true }); this.emit('changed', 'paylasim') }
  }

  // İmzacının telefonu: gelen SHARE_PREVIEW (giriş noktası; yol 'dogrudan' | 'emanet' | 'posta'). Zarf gelenZarf'tan
  // geçer, sonra gönderen (başlatabilen rolde: çocuk, geçici, misafir değil), imza, kart ve gövde denetlenir. Öğeler imzacının
  // kendi kayıtlarıyla karşılaştırılır: her öğe kaynak kaydın alanlarının bir alt kümesi olmalı (SOURCE_MISMATCH). Sahip
  // imzacının kendi kopyasındaki kaynak kaydın _subj'undan (açıklama 2 madde 1); imzacı değilsem NOT_SIGNER. Aynı shareId
  // için ikinci önizleme PREVIEW_EXISTS. Onay süresi önizlemenin geldiği andan 7 gün. Sonra onayla({ shareId, payloadHash }).
  // peerRole: oturumdaki rol (platformun eşitleyicisi verir); üye dışından gelen önizleme oturum süzgecinde düşer. Kaynak kayıtlar
  // bu telefona henüz eşitlenmediyse önizleme bekletilir (null döner) ve kayıtlar gelince bekleyenOnizlemeler() yeniden dener
  receivePreview (fromHex, bytes, yol, peerRole = 'uye', { bekleyenden = false } = {}) {
    const L = this._L
    giris.gelenZarf({ myRole: 'uye', peerRole, type: Z.SHARE_PREVIEW, bytes, L, gonderen: fromHex, yol })
    const o = Oz.onizlemeCoz(bytes, { ledger: L, fromHex })
    const baslatan = L.canonical(K.hex(o.fromId))
    if (!baslatan || !O.BASLATAN_ROLLER.includes(L.members.get(baslatan).role)) fail('UNAUTHORIZED')
    if ((this.saklama.get(A_TASLAK) || []).some((x) => x.shareId === K.hex(o.shareId))) fail('PREVIEW_EXISTS')
    const kart = Kt.hizmetKarti({ dizinler: this._dizinListesi(), kart: Kt.enYeni(this._eklenen().get(K.hex(o.kart.serviceId)) || null, o.kart), serviceId: o.kart.serviceId, simdi: this.now() }).kart
    const kaynaklar = o.sources.map((s) => ({ collectionId: K.hex(s.collectionId), recordIds: s.recordIds.map(K.hex) }))
    const kayitlar = kaynaklar.flatMap((s) => s.recordIds.map((rid) => this.kayit.get(s.collectionId, rid)))
    if (kayitlar.length !== o.govde.items.length) fail('SOURCE_MISMATCH')
    if (kayitlar.some((r) => !r) && !bekleyenden) {
      const l = (this.saklama.get(A_BEKLEYEN) || []).filter((y) => y.shareId !== K.hex(o.shareId))
      this.saklama.set(A_BEKLEYEN, [...l, { shareId: K.hex(o.shareId), fromHex, bytes: K.hex(bytes), yol, peerRole, t: this.now() }])
      this.emit('preview', K.hex(o.shareId))
      return null
    }
    const sahipler = new Set()
    o.govde.items.forEach((it, i) => {
      const r = kayitlar[i]
      const al = P.alanlarCoz(it.fields)
      if (!r || r.type !== it.type || !Object.entries(al).every(([a, v]) => esitDeger(r.fields[a], v))) fail('SOURCE_MISMATCH')
      const subj = typeof r.fields._subj === 'string' ? r.fields._subj : ''
      sahipler.add(subj.startsWith('uye:') ? L.canonical(subj.slice(4)) || fail('NO_TARGET') : K.hex(ZERO16))
    })
    if (sahipler.size > 1) fail('MIXED_OWNER')
    const ownerId = [...sahipler][0] || K.hex(ZERO16)
    if (!this._imzaciMi(ownerId)) fail('NOT_SIGNER')
    const taslak = {
      shareId: K.hex(o.shareId), serviceId: K.hex(kart.serviceId), tur: 'tek', ownerId, kisisel: null, govde: K.hex(o.body), replySecret: null, salt: null,
      expiresAt: this.now() + K.SINIR.onayGun.tek * K.GUN_MS, olusturma: this.now(), baslatan: fromHex, kaynaklar, onizleme: true, kart: K.hex(kart.bytes)
    }
    this._taslakYaz(taslak)
    this.emit('preview', taslak.shareId)
    return this._onizleme(taslak, kart)
  }

  // Bekletilen önizlemeleri yeniden dener (kayıt değişince); kayıtlar hâlâ yoksa bekler, 7 günde düşer. Dönüş: kabul edilenler
  pendingPreviews () {
    const l = this.saklama.get(A_BEKLEYEN) || []
    if (!l.length) return []
    const kalan = []
    const kabul = []
    for (const y of l) {
      if (this.now() - y.t > BEKLEYEN_MS) continue
      const kaynaklarVar = (() => {
        try {
          const m = Oz.onizlemeBicim(b4a.from(y.bytes, 'hex'))
          return m.sources.every((s) => s.recordIds.every((rid) => this.kayit.get(K.hex(s.collectionId), K.hex(rid))))
        } catch { return null }
      })()
      if (kaynaklarVar === null) continue
      if (!kaynaklarVar) { kalan.push(y); continue }
      try { kabul.push(this.receivePreview(y.fromHex, b4a.from(y.bytes, 'hex'), y.yol, y.peerRole, { bekleyenden: true })) } catch {}
    }
    this.saklama.set(A_BEKLEYEN, kalan)
    return kabul
  }

  // --- Silme isteği ve cevaplar (§8.3, §12.2; komut 309) ---

  // Açılmış paket için hizmetten silmesini iste: 'silme' paketi (ref = packageId), onay gerektirmez, veri taşımaz. Aynı
  // takma adla imzalanır; yalnız paketi gönderen üye isteyebilir. Dönüş: platformun PUT isteği; cevabı ('silindi') 309 ile gelir.
  requestDeletion ({ shareId }) {
    const x = this._taslak(shareId)
    const gd = x.gonderim || fail('NO_DELIVERY')
    const { kart } = this._kart(x.serviceId)
    const simdi = this.now()
    const cevap = P.sifreCifti()
    const takma = this._takma(kart.serviceId)
    const govde = P.govdeKodla({
      serviceId: kart.serviceId, shareId: unhex(x.shareId), kind: 'silme', category: kart.category, title: '', issuedAt: simdi, useUntil: simdi + K.SINIR.cevapGun * K.GUN_MS,
      replyPub: cevap.publicKey, sender: { pseudoPub: takma.publicKey, label: '' }, ref: unhex(gd.istek.packageId)
    })
    const p = P.paketKur({ kart, ic: P.icImzala(kart.serviceId, govde, takma.secretKey), expiresAt: simdi + K.SINIR.teslimGun * K.GUN_MS, simdi })
    const ownerSecret = rastgele(32)
    const istek = { endpoint: kart.endpoint, serviceId: hex(kart.serviceId), packageId: hex(p.packageId), bytes: p.bytes, owner: P.sahipOzeti(ownerSecret) }
    this._taslakYaz({ ...x, silmeler: [...(x.silmeler || []), { istek, ownerSecret: hex(ownerSecret), replySecret: hex(cevap.secretKey), ref: gd.istek.packageId }] })
    // Silme paketinin sırları da Paylaşımlar kaydında (başka telefon cevabını okuyabilsin, alıcıdan silebilsin; açıklama 2)
    const onay = O.onaylar(this._L).get(x.shareId)
    if (onay) {
      this.kayit.put(O.kayitYeri({ onay, paylasimlar: this.paylasimlarId, kisisel: x.kisisel }), null, 'hf.paylasim.gonderildi', {
        _v: 1, _t: simdi, _subj: 'topluluk', share_id: unhex(x.shareId), package_id: p.packageId, service_id: kart.serviceId, service_name: kart.name, category: kart.category,
        kind: 'silme', seq_no: 0, ref: unhex(gd.istek.packageId), ct_hash: p.ctHash, size: p.bytes.byteLength, file_count: 0, sent_at: simdi, sender_id: this._me,
        consent_seq: onay.seq, owner_secret: ownerSecret, reply_secret: cevap.secretKey
      })
    }
    this.emit('changed', 'paylasim')
    return istek
  }

  // Paylaşımın paketleri ve cevap anahtarları: gönderim kayıtları, bu telefondaki gönderim ve silme paketleri
  _paketler (id) {
    const x = this._taslaklar().find((y) => y.shareId === id) || null
    const out = new Map()
    for (const f of this._gonderimKayitlari(id, { silme: true })) out.set(hex(f.package_id), { serviceId: hex(f.service_id), ownerSecret: hex(f.owner_secret), replySecret: hex(f.reply_secret), silme: f.kind === 'silme' })
    if (x && x.gonderim && x.replySecret && !out.has(x.gonderim.istek.packageId)) out.set(x.gonderim.istek.packageId, { serviceId: x.serviceId, ownerSecret: x.gonderim.ownerSecret, replySecret: x.replySecret })
    for (const s of (x && x.silmeler) || []) out.set(s.istek.packageId, { serviceId: x.serviceId, ownerSecret: s.ownerSecret, replySecret: s.replySecret, silme: true })
    return out
  }

  // Kaydedilmiş cevaplar (hf.paylasim.cevap): Paylaşımlar'da ya da gizli paylaşımda kişisel koleksiyonda
  _cevapKayitlari (pids) {
    const kollar = [this.paylasimlarId, ...this.kayit.collections().filter((c) => c.kind === 'kisisel' && c.okur).map((c) => c.collectionId)]
    return kollar.flatMap((cid) => this.kayit.query(cid, { type: 'hf.paylasim.cevap' }).map((r) => r.fields).filter((f) => pids.has(hex(f.package_id))))
  }

  // Platformun GET {endpoint}/v1/r/{packageId}?after={n} istekleri (x-hf-owner-secret); after kaydedilen son cevap
  replyRequests ({ shareId }) {
    const id = hex(shareId)
    const paketler = this._paketler(id)
    const kayitli = this._cevapKayitlari(new Set(paketler.keys()))
    return [...paketler].map(([pid, p]) => {
      const kart = this._eklenen().get(p.serviceId) || this._dizinListesi().map((d) => d.kartlar.get(p.serviceId)).find(Boolean)
      const ns = kayitli.filter((f) => hex(f.package_id) === pid).map((f) => f.n)
      return { endpoint: kart ? kart.endpoint : null, packageId: pid, after: ns.length ? Math.max(...ns) : -1, ownerSecret: p.ownerSecret }
    })
  }

  // 309 REPLY_FETCH: alıcıdan gelen cevaplar ({ packageId, n, bytes }) açılır, hizmetin imzası karttaki signPub ile
  // doğrulanır, kaydedilmemiş olanlar hf.paylasim.cevap olarak yazılır. Geçersiz cevap atılır (atlanan).
  // Dönüş { yeni: [{ packageId, n, kind, text, at, dosya }], atlanan }
  receiveReply ({ shareId, cevaplar }) {
    const id = hex(shareId)
    const onay = O.onaylar(this._L).get(id) || fail('NO_SHARE')
    const paketler = this._paketler(id)
    const x = this._taslaklar().find((y) => y.shareId === id) || null
    const gorulen = new Set(this._cevapKayitlari(new Set(paketler.keys())).map((f) => hex(f.package_id) + '/' + f.n))
    const yeni = []
    let atlanan = 0
    for (const cv of cevaplar || []) {
      const pid = typeof cv.packageId === 'string' ? cv.packageId : hex(cv.packageId || b4a.alloc(0))
      const p = paketler.get(pid)
      let m
      try {
        if (!p) fail('NO_PACKAGE')
        const kart = this._bilinenKart(p.serviceId, x && x.kart)
        m = Cv.cevapAc(unhex(cv.bytes), { packageId: unhex(pid), replySecret: unhex(p.replySecret), signPub: kart.signPub })
      } catch { atlanan++; continue }
      if (gorulen.has(pid + '/' + m.n)) continue
      gorulen.add(pid + '/' + m.n)
      const yer = O.kayitYeri({ onay, paylasimlar: this.paylasimlarId, kisisel: (x && x.kisisel) || this._gonderimYeri(id) })
      this.kayit.put(yer, null, 'hf.paylasim.cevap', { _v: 1, _t: this.now(), _subj: 'topluluk', share_id: unhex(id), package_id: unhex(pid), n: m.n, kind: m.kind, text: m.text, files: c.encode(DOSYALAR, m.files), at: m.at })
      yeni.push({ packageId: pid, n: m.n, kind: m.kind, text: m.text, at: m.at, dosya: m.files.length })
    }
    if (yeni.length) this.emit('changed', 'paylasim')
    return { yeni, atlanan }
  }

  // Cevap imzasının doğrulanması için hizmetin bilinen herhangi geçerli kartı (eski dizindeki de, önizlemedeki de; imza
  // anahtarı değişmez): yeni paylaşım için dizin tazeliği gerekir, gelen cevabı okumak için gerekmez (inceleme A2 madde 9)
  _bilinenKart (sid, onizlemeKarti = null) {
    let k = this._eklenen().get(sid) || null
    for (const d of this._dizinListesi()) k = Kt.enYeni(k, d.kartlar.get(sid) || null)
    if (onizlemeKarti) k = Kt.enYeni(k, Kt.kartCoz(b4a.from(onizlemeKarti, 'hex')))
    return k || fail('NO_SERVICE')
  }

  // Gizli paylaşımın kaydının durduğu kişisel koleksiyon (başka telefondan cevap çekilirken)
  _gonderimYeri (id) {
    for (const col of this.kayit.collections().filter((c) => c.kind === 'kisisel' && c.okur)) {
      if (this.kayit.query(col.collectionId, { type: 'hf.paylasim.gonderildi' }).some((r) => hex(r.fields.share_id) === id)) return col.collectionId
    }
    return null
  }

  // Bir paylaşımın kaydedilmiş cevapları, n sırasıyla: [{ packageId, n, kind, text, at, dosyalar }]
  replies ({ shareId }) {
    const pids = new Set(this._paketler(hex(shareId)).keys())
    return this._cevapKayitlari(pids).sort((a, b) => a.at - b.at || a.n - b.n).map((f) => ({
      packageId: hex(f.package_id), n: f.n, kind: f.kind, text: f.text, at: f.at,
      dosyalar: c.decode(DOSYALAR, f.files).map((d) => ({ blobId: hex(d.blobId), fileKey: hex(d.fileKey), size: d.size, mime: d.mime, name: d.name }))
    }))
  }

  // 306 SHARE_LIST (§10.4): defterdeki onaylar, bu telefondaki taslaklar ve gönderim kayıtları birlikte.
  // durum: 'taslak' | 'onay-bekliyor' (imzacıda önizleme) | 'oneri' | 'onaylandi' | 'gonderiliyor' | 'gonderildi' | 'acildi'
  // (makbuz ya da mesaj geldi) | 'ret' | 'silindi' | 'iptal' | 'gecersiz'.
  // Gizli onayda hizmet adı yalnız sahibinde.
  shares () {
    const onaylar = O.onaylar(this._L)
    const taslaklar = new Map(this._taslaklar().map((x) => [x.shareId, x]))
    const eklenen = this._eklenen()
    const ad = (sid) => { const k = eklenen.get(sid) || this._dizinListesi().map((d) => d.kartlar.get(sid)).find(Boolean); return k ? k.name : null }
    const out = []
    for (const [id, o] of onaylar) {
      const x = taslaklar.get(id)
      const kayit = this._gonderimKayitlari(id)[0]
      const sv = O.serviceOf(o.service)
      const sid = x ? x.serviceId : kayit ? hex(kayit.service_id) : sv && sv.tur === 'hizmet' ? sv.deger : null
      const bekleyen = !kayit && x && x.gonderim
      const cv = this._cevapKayitlari(new Set(this._paketler(id).keys())).map((f) => f.kind)
      const cevapDurumu = cv.includes('silindi') ? 'silindi' : cv.includes('ret') ? 'ret' : cv.length ? 'acildi' : null
      const durum = o.durum === 'iptal' ? 'iptal' : o.durum === 'gecersiz' ? 'gecersiz' : cevapDurumu || (kayit ? 'gonderildi' : bekleyen ? 'gonderiliyor' : 'onaylandi')
      out.push({
        shareId: id, tur: o.tur, kategori: o.kategori, hizmet: sid, hizmetAdi: sid && ad(sid), durum, neden: o.neden, onaySeq: o.seq,
        ownerId: hex(o.ownerId), expiresAt: o.expiresAt, cevap: cv.length, gonderildi: kayit ? kayit.sent_at : null, packageId: kayit ? hex(kayit.package_id) : bekleyen ? x.gonderim.istek.packageId : null
      })
    }
    for (const x of taslaklar.values()) {
      if (onaylar.has(x.shareId)) continue
      out.push({ shareId: x.shareId, tur: x.tur, kategori: null, hizmet: x.serviceId, hizmetAdi: ad(x.serviceId), durum: x.oneriId ? 'oneri' : x.onizleme ? 'onay-bekliyor' : 'taslak', neden: null, onaySeq: null, ownerId: x.ownerId, expiresAt: x.expiresAt, cevap: 0, gonderildi: null, packageId: null })
    }
    return out
  }
}

// Kayıttaki değer ile öğedeki değer aynı mı (bayt, dizi, düz değer)
function esitDeger (a, b) {
  if (b4a.isBuffer(a) || b4a.isBuffer(b)) return b4a.isBuffer(a) && b4a.isBuffer(b) && b4a.equals(a, b)
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => esitDeger(x, b[i]))
  if (typeof a === 'bigint' || typeof b === 'bigint') { try { return BigInt(a) === BigInt(b) } catch { return false } }
  return a === b
}

// Ürünlere giden hizmet satırı (Pati Hizmet, Bakım Uzman)
function hizmetOf (k, trust) {
  return {
    serviceId: hex(k.serviceId), ad: k.name, kategori: k.category, il: k.region, iletisim: k.contact, endpoint: k.endpoint,
    dogrulama: trust, kural: k.kural, maxMB: Math.min(k.maxMB, K.SINIR.paketMB), saklamaGun: k.keepDays, keyVersion: k.keyVersion, yurtDisi: Kt.yurtDisi(k)
  }
}

module.exports = { ServiceApi, SERVICE_COMMAND }
