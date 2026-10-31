// SPDX-License-Identifier: Apache-2.0
// ai.js — SDK'nın yapay zeka arayüzü (RFC-0013 §17): @havenfold/ai'nin ürünlere açılan yüzü. Komutlar 270–279.
//
// Model çağırma, dışarı sorma, kota ve onay ekranı platform kodundadır; SDK onları kurulumda kanca olarak alır:
//   yetenek() → YzYetenek · model({ yol, isci, istem, sema?, collectionId? }) → { metin | alanlar, model }
//   gecit(metin) → { metin, model } · kota() → { ay, kalan, gunlukKalan, paket } · krizSiniflandir(metin) → bool
//   onayEkrani({ collectionId, sema, alanlar, sinif }) → { son } | null  (platformun onay ekranı: "Kaydet" dokunuşu)
// Asistanın eli yoktur: SDK hiçbir şeyi kendiliğinden göndermez ya da kaydetmez. Onay ekranı ürün koduna açık değildir;
// jeton yalnız platform kancası "Kaydet" dönünce üretilir ve hedef koleksiyona, sınıfa ve alanlara bağlıdır
// (RFC-0023 madde 104). Kriz bilgisi olaylara ve günlüğe çıkmaz (RFC-0023 §2 f).
const b4a = require('b4a')
const c = require('compact-encoding')
const sodium = require('sodium-native')
const yz = require('@havenfold/ai')
const { kdf: { hash }, v21: { canTask } } = require('@havenfold/core')
const { alanlar: { parseSrc }, kodlama: { field }, hlc: { msOf } } = require('@havenfold/records')
const { Emitter } = require('./api')

const hex = (b) => (typeof b === 'string' ? b : b4a.toString(b, 'hex'))
const unhex = (h) => (typeof h === 'string' ? b4a.from(h, 'hex') : h)
function fail (code) { throw new Error(code) }

const AI_COMMAND = { AI_STATUS: 270, AI_ASK: 271, AI_EXTRACT: 272, AI_SAVE: 273, AI_SEARCH: 274, AI_INDEX: 275, AI_MODEL: 276, AI_EXTERNAL: 277, AI_SETTINGS: 278, AI_QUOTA: 279 }
const VARSAYILAN_AYAR = { gecmis: 30, sorularIsciye: false, bulut: false, takma: null }
const JETON_MS = 10 * 60_000
const DISARI_MS = 5 * 60_000
const DISARI_GUNLUK = 30
const DISARI_MAX = 1024
const DAY = 86_400_000
const PLAN_SAATLIK = 20 // Sohbetten Plana: telefon başına saatte en çok 20 model çağrısı (RFC-0013 §7.7)
// Çekirdeğin verdiği genel koleksiyon adları ad sayılmaz (RFC-0023 §2 d)
const GENEL_ADLAR = new Set(['tüm aile', 'ebeveynler', 'kişisel', 'kasa', 'olaylar', 'bakıcı', 'yönetim'].map(yz.metin.N))
const KASA_AKTARMA = ['bitwarden', 'keepass', '1password']

// RFC-0023 madde 104: jeton özeti hash('hf/yz-onay/', collectionId, tür, recordId, sınıf, adla sıralı alan kodlamaları)
function approvalSummary (collectionId, kayit, sinif) {
  if (!yz.yetenek.SINIFLAR.includes(sinif)) fail('INVALID_CLASS') // RFC-0027 §8 c (D69): yalnız tanımlı sınıflar
  const list = Object.entries(kayit.fields).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([name, value]) => c.encode(field, { name, value }))
  return hash('hf/yz-onay/', unhex(hex(collectionId)), b4a.from(kayit.type), b4a.from(kayit.recordId ? hex(kayit.recordId) : ''), b4a.from(sinif), b4a.concat(list))
}

const rastgeleHex = (n) => { const b = b4a.alloc(n); sodium.randombytes_buf(b); return hex(b) }

class AiApi extends Emitter {
  #onayEkrani
  #jetonlar = new Map() // jetonHex → { ozet, kayit, sinif, at }
  #disari = new Map() // jetonHex → { metin, at }
  #genelSorular = new Map() // N(soru) → at: sor() sonucu 'genel' sınıflı cevaplar (dışarı sormanın önkoşulu)
  #disariSayac = { gun: -1, n: 0 }
  #planCagri = [] // son bir saatteki Sohbetten Plana model çağrılarının zamanları

  // kayit: RecordApi; semalar: Map<'id@v', şema> (uygulamanın içinde gelir); isciModeli: { modelHash, ramMB } (işçide
  // çalışacak dil modeli); ilkKart: IlkEtkilesim (md. 50)
  // gom (gömme modeli, RFC-0013 §9.2, §15.5): { gom(metinler, { tur: 'sorgu' | 'parca' }) → vektörler, onEkler: [sorgu,
  // parça], modelHash, esik (binde) } — anlamsal arama ve kriz anlam katmanı aynı kancayı kullanır (D52). Eski biçim
  // { gom(metin), onEk, modelHash } yalnız kriz anlam katmanını açar. gommeSaklama: { oku(ad), yaz(ad, b), sil(ad) }
  // (worklet: Kalici.gommeSaklama(), platform anahtarıyla şifreli); gommeAnahtar verilirse dosyayı SDK şifreler.
  // kasa: VaultApi (ya da 'kasa' olayı yayan nesne): kilitlenince kasa dizini o anda bellekten silinir (inceleme 18 B3).
  // Gömme dosyasının anahtarı koleksiyonun dönem anahtarından türer (RFC-0013 §9.3); gommeAnahtar (platform anahtarı)
  // verilirse türetmeye girer.
  constructor ({ kayit, me, semalar = new Map(), onayEkrani = null, yetenek = () => yz.yetenek.yetenekKur({}), model = null, gecit = null, kota = null, krizSiniflandir = null, gom = null, gommeSaklama = null, gommeAnahtar = null, gommeSiniri = undefined, isciModeli = null, ilkKart = null, onay = null, kasaAcik = () => false, kasa = null, now = Date.now, bolge = 'TR' }) {
    super()
    this.kayit = kayit
    this.me = hex(me.memberId || me)
    this.semalar = semalar
    this.#onayEkrani = onayEkrani
    this.kanca = { yetenek, model, gecit, kota, krizSiniflandir }
    this.isciModeli = isciModeli
    this.ilkKart = ilkKart
    this.onayDefteri = onay // görev katmanının ilk kullanım onayları (işçi onay zamanı, D15 11)
    this.kasaAcik = kasaAcik // kasa açık mı (platform; kilitlenince kasa dizini bellekten atılır, D15 13)
    this._otomatikDizin = false
    this.now = now
    this.bolge = bolge
    this._ayar = { ...VARSAYILAN_AYAR }
    this.dizinler = new yz.dizin.AnahtarDizin()
    this.dizinli = new Set()
    this._yenidenDizinle = new Set()
    this._parcaMetni = new Map()
    this._turAlanlari = () => null
    // Toplu gömme kancası (onEkler): anlamsal dizin ve kriz anlam katmanı aynı modelden. Gömme dizini bekçiden önce
    // kurulur: bekçinin ilk turunda okuyuculuğu bitmiş koleksiyonların dosyaları da silinir (inceleme 18 B1)
    this.gommeSaklama = gommeSaklama
    this.gomme = null
    if (gom && Array.isArray(gom.onEkler)) {
      this.gomme = new yz.gomme.GommeDizini({ gom: gom.gom, onEkler: gom.onEkler, modelHash: gom.modelHash, esik: gom.esik ?? null, saklama: gommeSaklama, anahtar: gommeAnahtar, anahtarOf: (cid) => this._donemAnahtari(cid), ...(gommeSiniri ? { sinir: gommeSiniri } : {}) })
      this.krizAnlam = new yz.krizAnlam.KrizAnlam({ gom: async (m) => (await gom.gom([m], { tur: 'sorgu' }))[0], onEk: gom.onEkler[0], modelHash: gom.modelHash ? hex(gom.modelHash) : null })
    } else this.krizAnlam = gom ? new yz.krizAnlam.KrizAnlam(gom) : null
    this.bekci = new yz.dizin.DizinBekcisi({ me: this.me, sil: (cid) => this._dizinSil(cid) })
    this.bekci.uygula(this._L)
    this._duyarlilik = new Map([...this._L.collections].map(([cid, col]) => [cid, col.sensitivity]))
    this._dosyalariSupur()
    // Kasa kilitlenince kasa parçaları o anda (bir sonraki çağrıyı beklemeden) bellekten çıkar (B3)
    if (kasa && typeof kasa.on === 'function') kasa.on('vault', (x) => { if (x && x.type === 'kilitlendi') this._kasaDizinleriniSil() })
    // Bulgu 12: bekçi defteri ilerleten yola bağlanır (kayıt katmanından önce); bulgu 2: değişen kayıt yeniden dizinlenir
    const sync = kayit.sync.bind(kayit)
    kayit.sync = () => { this.bekci.uygula(this._L); return sync() }
    kayit.on('change', (cid, ids) => this._kayitDegisti(cid, ids))
  }

  get _L () { return this.kayit._L }

  // Koleksiyonun yazımda kullanılan dönem anahtarı (gömme dosyası bundan türer; RFC-0013 §9.3)
  _donemAnahtari (cid) {
    const L = this._L
    const r = this.kayit.r
    const ep = r.yetki.epochAt(cid, L.len - 1)
    const k = ep && r.keys.preferred(cid, ep.seq, ep.hash)
    return k ? { key: k.key, kimlik: ep.seq + ':' + hex(ep.hash) + ':' + hex(k.keyId) } : null
  }

  // Açılışta ve duyarlılık değişince: dosyası tutulabilecek koleksiyonlar yalnız okunur ve kasa olmayanlar. Gömme
  // kancası yoksa (model silindi) bütün gömme dosyaları silinir (B1, B2, B7; RFC-0013 §9.5)
  _dosyalariSupur () {
    if (!this.gommeSaklama) return
    const tutulacak = new Set(this.gomme ? yz.dizin.dizinlenecekler(this._L, this.me, { kasaAcik: false }) : [])
    for (const cid of this._L.collections.keys()) if (!tutulacak.has(cid)) { try { this.gommeSaklama.sil(yz.gomme.dosyaAdi(cid)) } catch {} }
    if (typeof this.gommeSaklama.liste === 'function') {
      let adlar = []
      try { adlar = this.gommeSaklama.liste() } catch {}
      for (const ad of adlar) { const m = yz.gomme.DOSYA_ADI.exec(ad); if (m && !tutulacak.has(m[1])) { try { this.gommeSaklama.sil(ad) } catch {} } }
    }
  }

  _kasaDizinleriniSil () {
    for (const [cid, col] of this._L.collections) if (col.sensitivity === 'kasa' && this.dizinli.has(cid)) this._dizinSil(cid)
  }

  // Platform defteri başka yoldan ilerletirse de çağırabilir; bütün okuma işlemleri önce bunu yapar. Kasa
  // kilitliyse kasa dizini atılır; dizin bir kez bütün koleksiyonlarla kurulduysa yeni okunur olan eklenir (D15 13).
  ledgerAdvanced () {
    const silinen = this.bekci.uygula(this._L)
    // Duyarlılığı değişen (ör. kasaya çevrilen) koleksiyonun dizini ve dosyası silinip yeniden kurulur (B2)
    let degisen = false
    for (const [cid, col] of this._L.collections) {
      const once = this._duyarlilik.get(cid)
      if (once !== undefined && once !== col.sensitivity) {
        const vardi = this.dizinli.has(cid)
        this._dizinSil(cid)
        if (vardi) this._yenidenDizinle.add(cid)
        degisen = true
      }
      this._duyarlilik.set(cid, col.sensitivity)
    }
    if (degisen) this._dosyalariSupur()
    const okunur = this._okunur()
    for (const cid of [...this._yenidenDizinle]) if (okunur.includes(cid)) { this._yenidenDizinle.delete(cid); this._koleksiyonDizinle(cid) }
    for (const cid of [...this.dizinli]) if (!okunur.includes(cid)) this._dizinSil(cid)
    if (this._otomatikDizin) for (const cid of okunur) if (!this.dizinli.has(cid)) this._koleksiyonDizinle(cid)
    return silinen
  }

  _okunur () { return yz.dizin.dizinlenecekler(this._L, this.me, { kasaAcik: !!this.kasaAcik() }) }

  _uye () { return this._L.members.get(this.me) || null }

  // Defterdeki adlar (§6.5 madde 1): üye, misafir, varlık, yer, cihaz ve aileye özgü koleksiyon adları
  _adlar () {
    const L = this._L
    const kol = [...L.collections.values()].map((x) => x.name).filter((n) => typeof n === 'string' && !GENEL_ADLAR.has(yz.metin.N(n.split(':')[0])))
    return [...L.members.values()].map((m) => m.name)
      .concat([...L.grants.values()].map((g) => g.name), [...L.beings.values()].map((b) => b.name), [...L.places.values()].map((p) => p.name), [...L.devices.values()].map((d) => d.name), kol)
      .filter((x) => typeof x === 'string' && x)
  }

  // Kriz ekranının "güvendiğin kişi" düğmeleri: kullanıcı seçmediyse defterdeki ebeveyn ve yetişkinler (§12 madde 4)
  _guvenilenler (secilen = null) {
    if (secilen && secilen.length) return secilen
    const L = this._L
    const ben = L.personIdOf(this.me)
    return L.personIds().filter((id) => id !== ben && ['ebeveyn', 'yetiskin', 'sahip', 'yonetici'].includes(L.members.get(id).role))
      .map((id) => ({ uye: id, ad: L.members.get(id).name }))
  }

  // --- 270 AI_STATUS --- krizAnlam: anlam katmanı açık mı; ilkKart: md. 50 kartı gösterilmeli mi
  async status () {
    const y = await this.kanca.yetenek()
    return { ...y, isciler: this._isciler(y), krizAnlam: !!this.krizAnlam, ilkKart: this.ilkKart ? !(await this.ilkKart.anladi(this.me)) : false }
  }

  // İşçiler defterdeki adıyla ve ilk kullanım onayının zamanıyla (D15 11)
  _isciler (y) {
    return (y.isciler || []).map((w) => ({ ...w, ad: this._L.devices.get(hex(w.deviceId))?.name || '', onayAt: this.onayDefteri ? this.onayDefteri.zaman(this.me, hex(w.deviceId)) : null }))
  }

  async isCrisis (metin) {
    return yz.cocuk.krizMi(metin, { anlam: this.krizAnlam ? await this.krizAnlam.skor(metin) : null })
  }

  // Kademeli sonuç (RFC-0024 §5): 'tam' | 'sinir' | null. Cihazda kalır; olaya ve günlüğe çıkmaz.
  async crisisLevel (metin) {
    return yz.cocuk.krizDuzeyi(metin, { anlam: this.krizAnlam ? await this.krizAnlam.skor(metin) : null })
  }

  // Her zaman görünen "Yardım" (RFC-0023 §3 f): kriz ekranının aynısı
  help (guvenilenler = null) { return yz.cocuk.krizCevabi({ bolge: this.bolge, guvenilenler: this._guvenilenler(guvenilenler) }) }

  // md. 50 ilk etkileşim kartı (RFC-0023 §2 g)
  firstCardText () { return yz.asistan.ilkKartMetni(this._uye()?.role) }
  async firstCardAcknowledged () { if (this.ilkKart) await this.ilkKart.anladim(this.me) }

  // --- 271 AI_ASK --- metin: tetik sonrası soru; baglam: "Asistana sor" ile seçilen mesaj { ref: 'msg:…', metin }
  async ask ({ metin, baglam = null, guvenilenler = null }) {
    const L = this._L
    this.ledgerAdvanced()
    if (this.ilkKart && !(await this.ilkKart.anladi(this.me))) return { ilkKart: true, metin: this.firstCardText() }
    const rol = this._uye()?.role || null
    const ayar = this._ayar
    const kisisel = this._kisisel()
    const yetenek = await this.kanca.yetenek()
    const asistan = new yz.asistan.Asistan({
      yetenek,
      rol,
      misafir: L.grants.has(this.me),
      adlar: this._adlar(),
      bolge: this.bolge,
      guvenilenler: this._guvenilenler(guvenilenler),
      ara: async (soru) => this._araParcalar(soru),
      esik: this.gomme ? this.gomme.esik : null,
      model: async (x) => { if (!this.kanca.model) fail('NO_MODEL'); return this.kanca.model(x) },
      krizSiniflandir: this.kanca.krizSiniflandir,
      krizAnlam: this.krizAnlam,
      gecmis: ayar.gecmis === 'kapali' ? null : { ayar: ayar.gecmis, yaz: async (k) => this._gecmisYaz(k) },
      kisisel,
      koleksiyonBilgisi: (cid) => this._kolBilgi(cid),
      sorularIsciye: ayar.sorularIsciye,
      isci: this._isciGirdisi(yetenek),
      simdi: this.now
    })
    const cevap = await asistan.sor({ metin, baglamMesaji: baglam ? this._baglam(baglam) : null })
    if (cevap.kriz) return cevap // kriz ekranı SDK'nın sabit nesnesiyle açılır; olay yayılmaz (RFC-0023 §2 f)
    if (cevap.kaynaklar) { const c = this._celiski(cevap.kaynaklar); if (c.length) cevap.celiski = c }
    if (cevap.sinif === 'genel' && !cevap.hata) this.#genelSorular.set(yz.metin.N(metin), this.now())
    this.emit('ai', { tur: 'cevap' })
    return cevap
  }

  // Bağlamın başvurusu zorunludur (RFC-0023 §2 h): "Asistana sor" mesajı msg:, "Bu belgeye sor" kayit: ya da dosya:
  // (D15 12). kayit: bağlamının metni kayıttan okunur; dosya: için metni platform verir (OCR). Sınıf kaynaktan.
  _baglam (b) {
    const p = b && typeof b.ref === 'string' ? parseSrc(b.ref) : null
    if (!p || !['msg', 'kayit', 'dosya'].includes(p.tur)) fail('REFERENCE_REQUIRED')
    let metin = String(b.metin || '')
    let col = null
    if (p.tur === 'kayit') {
      const k = this.kayit.get(p.collectionId, p.recordId)
      if (!k) fail('NO_RECORD')
      metin = yz.dizin.kayitMetni(k.fields, this._turAlanlari(k.type) || Object.keys(k.fields).sort().map((ad) => ({ ad })))
      col = this._L.collections.get(p.collectionId)
    }
    if (p.tur === 'dosya') col = this._dosyaKoleksiyonu(p.blobId)
    const sinif = p.tur === 'msg' ? 'aile' : col?.sensitivity === 'normal' ? 'aile' : 'kasa'
    return { ref: b.ref, metin, sinif, taskAccess: !!col?.taskAccess, sensitivity: col?.sensitivity || 'normal', okuyucuSayisi: col ? col.readers.length : 0, collectionId: col ? col.id : null }
  }

  // Çelişki (D15 13): aynı türden iki kaynak kayıt aynı alanda farklı değer taşıyorsa cevap bunu söyler
  _celiski (kaynaklar) {
    const kayitlar = kaynaklar.map((ref) => {
      const p = parseSrc(ref)
      const k = p?.tur === 'kayit' ? this.kayit.get(p.collectionId, p.recordId) : null
      return k ? { ref, k } : null
    }).filter(Boolean)
    const out = []
    for (let i = 0; i < kayitlar.length; i++) {
      for (let j = i + 1; j < kayitlar.length; j++) {
        const a = kayitlar[i]
        const b = kayitlar[j]
        if (a.k.type !== b.k.type) continue
        for (const alan of Object.keys(a.k.fields)) {
          if (alan.startsWith('_') || !(alan in b.k.fields)) continue
          if (JSON.stringify(a.k.fields[alan]) !== JSON.stringify(b.k.fields[alan])) out.push({ alan, kaynaklar: [a.ref, b.ref] })
        }
      }
    }
    return out
  }

  _kolBilgi (cid) {
    const col = this._L.collections.get(hex(cid))
    return col ? { taskAccess: !!col.taskAccess, sensitivity: col.sensitivity, okuyucuSayisi: col.readers.length } : null
  }

  // İşçi yolu (bulgu 4, doğrulama 12): izin (TASK_PERMIT) defterden; model kurulumda verilmediyse yetenekteki aday ve
  // ilk kullanım onaylı işçinin kullanılabilir modeli ('kullanilir' = modelin RAM'i işçiye sığıyor, §15.4)
  _isciGirdisi (yetenek = null) {
    let model = this.isciModeli
    if (!model && yetenek) {
      const w = (yetenek.isciler || []).find((x) => x.aday && x.onay && (x.modeller || []).some((m) => m.kullanilir))
      const m = w && w.modeller.find((x) => x.kullanilir)
      if (m) model = { modelHash: m.modelHash, ramMB: 0 }
    }
    if (!model) return null
    return { model, izin: canTask(this._L, this.me, 'hf.task.llm') }
  }

  _kisisel () {
    for (const [cid, col] of this._L.collections) if (col.kind === 'kisisel' && col.readers.length === 1 && this._L.canonical(col.readers[0].slice(4)) === this._L.canonical(this.me)) return cid
    return null
  }

  _gecmisYaz (k) {
    const cid = this._kisisel()
    if (!cid) return null // Kişisel koleksiyon yoksa geçmiş yazılmaz
    return this.kayit._yaz(cid, null, k.type, k.fields)
  }

  // --- Kaynağın sınıfı (RFC-0023 §2 a): kayit: → koleksiyonun duyarlılığı; dosya: → dosyayı taşıyan kaydın
  // koleksiyonu, bulunamazsa en sıkı (kasa); msg: → aile; aktarma: parola yöneticisi → kasa. Çağıranınki yok sayılır.
  _kaynakSiniflari (kaynaklar) {
    const L = this._L
    const out = []
    for (const s of kaynaklar) {
      const p = parseSrc(s)
      if (!p) fail('INVALID_SOURCE')
      if (p.tur === 'kayit') out.push(L.collections.get(p.collectionId)?.sensitivity === 'kasa' ? 'kasa' : 'aile')
      else if (p.tur === 'dosya') out.push(this._dosyaSinifi(p.blobId))
      else if (p.tur === 'aktarma') out.push(KASA_AKTARMA.includes(p.bicim) ? 'kasa' : 'aile')
      else out.push('aile')
    }
    return out
  }

  // Dosyaya başvuran kayıtların koleksiyonları
  _dosyaKoleksiyonlari (blobIdHex) {
    const L = this._L
    const icerir = (v) => (v && typeof v === 'object' && b4a.isBuffer(v.blobId) ? hex(v.blobId) === blobIdHex : Array.isArray(v) && v.some(icerir))
    const out = []
    for (const [cid, col] of L.collections) {
      if (this.kayit.r.records(cid).some((k) => Object.values(k.fields).some(icerir))) out.push(col)
    }
    return out
  }

  _dosyaKoleksiyonu (blobIdHex) { return this._dosyaKoleksiyonlari(blobIdHex)[0] || null }

  // RFC-0025 §1: kayda bağlı dosya, bağlı olduğu koleksiyonların en sıkısı (b); bu telefonda yeni eklenen ve hiçbir
  // kayıtta olmayan dosya 'aile' (a; hedef kasa seçilirse kayıt kasa olur); başka yerden gelip bağsız kalan 'kasa' (c)
  _dosyaSinifi (blobIdHex) {
    const kol = this._dosyaKoleksiyonlari(blobIdHex)
    if (kol.length) return kol.some((c) => c.sensitivity === 'kasa') ? 'kasa' : 'aile'
    return this.kayit.eklenen && this.kayit.eklenen.has(blobIdHex) ? 'aile' : 'kasa'
  }

  _kaynakKoleksiyonlari (kaynaklar) {
    const out = []
    for (const s of kaynaklar) {
      const p = parseSrc(s)
      const cid = p?.tur === 'kayit' ? p.collectionId : p?.tur === 'dosya' ? this._dosyaKoleksiyonuId(p.blobId) : null
      const b = cid && this._kolBilgi(cid)
      if (b) out.push({ collectionId: cid, ...b })
    }
    return out
  }

  _dosyaKoleksiyonuId (blobIdHex) {
    const col = this._dosyaKoleksiyonu(blobIdHex)
    return col ? col.id : null
  }

  // Belge türü (D19 21): uygulamanın şemalarından anahtar kelimesi metinde en çok geçenin adı; yoksa null
  documentType (metin) { return yz.cikarma.belgeTuru(String(metin || ''), [...this.semalar.values()]) }

  // --- 272 AI_EXTRACT --- Kural motoru her zaman; model yolu varsa çıktısı denetlenip birleştirilir. Sınıf ve görev
  // koleksiyonu kaynaktan ve defterden (bulgu 4, 5). semaAdi null → belgeTuru. secenek (D19 21, D46):
  //   isci: deviceId (yalnız bu işçi; uygun değilse NO_ELIGIBLE_DEVICE) · yalnizTelefon: işçiye gitmez ·
  //   hedef: kaydedilecek koleksiyon (kaynak yoksa görev koleksiyonu odur; kasa ise sınıf kasa, RFC-0025 §1 a)
  async remove (semaAdi, girdi, kaynak = [], { isci: seciliIsci = null, yalnizTelefon = false, hedef = null } = {}) {
    if (semaAdi === null) semaAdi = this.documentType(girdi && girdi.metin)
    const sema = this.semalar.get(semaAdi)
    if (!sema) fail('NO_SCHEMA')
    if (!girdi || typeof girdi.metin !== 'string') fail('INVALID_INPUT') // blobRef yolu: platform OCR'dan sonra metinle çağırır
    if (seciliIsci && yalnizTelefon) fail('INVALID_OPTION')
    const hedefKol = hedef ? this._L.collections.get(hex(hedef)) : null
    if (hedef && !hedefKol) fail('NO_COLLECTION')
    const hedefSinif = hedefKol ? [hedefKol.sensitivity === 'kasa' ? 'kasa' : 'aile'] : []
    const sinif = yz.engel.enSiki(yz.engel.sinifBelirle(girdi.metin, { adlar: this._adlar(), bagli: kaynak.length > 0 }), ...this._kaynakSiniflari(kaynak), ...hedefSinif)
    const kural = { ...yz.cikarma.kuralCikar(sema, girdi.metin, { kaynak }), sinif }
    const kollar = this._kaynakKoleksiyonlari(kaynak)
    if (hedefKol && !kollar.length) kollar.push({ collectionId: hedefKol.id, ...this._kolBilgi(hedefKol.id) })
    const gk = yz.yetenek.gorevKoleksiyonu(kollar, { kisisel: this._kisisel(), sorularIsciye: this._ayar.sorularIsciye })
    let yetenek = await this.kanca.yetenek()
    if (yalnizTelefon) yetenek = { ...yetenek, isciler: [] }
    if (seciliIsci) yetenek = { ...yetenek, platform: null, isciler: (yetenek.isciler || []).filter((w) => hex(w.deviceId) === hex(seciliIsci)) }
    const isci = this._isciGirdisi(yetenek)
    const kb = gk.collectionId ? this._kolBilgi(gk.collectionId) : null
    const y = yz.yetenek.yol('cikar', sinif, { metin: girdi.metin, ...(isci || {}), koleksiyon: kb && gk.cikarilan === 0 ? kb : null }, yetenek)
    if (seciliIsci && y.yol !== 'isci') fail('NO_ELIGIBLE_DEVICE')
    if ((y.yol !== 'telefon' && y.yol !== 'isci') || !this.kanca.model) return kural
    const r = await this.kanca.model({ yol: y.yol, isci: y.isci || null, collectionId: y.yol === 'isci' ? gk.collectionId : null, istem: yz.asistan.istemKur([girdi.metin], 'alan-cikar'), sema })
    const m = yz.cikarma.denetle(sema, r.alanlar || {}, girdi.metin, { yol: y.yol, model: r.model, kaynak })
    return { ...yz.cikarma.birlestir(sema, m, kural), sinif }
  }

  // Defterdeki kişiler: 'uye:<hex>' → ad (kisi alanları)
  _kisiler () {
    const L = this._L
    return new Map(L.personIds().map((id) => ['uye:' + id, L.members.get(id)?.name]).filter(([, ad]) => typeof ad === 'string' && ad))
  }

  // --- Sohbetten Plana (RFC-0013 §7.7, D19 20) --- mesaj: { ref: 'msg:…', metin, at (hlc ms), yazar? (memberId) };
  // semalar: { etkinlik: 'id@v', yapilacak: 'id@v' }. Kart yalnız bu telefonda: olay yayılmaz, hiçbir şey yazılmaz.
  // Ön süzgece takılmayan mesaj null. Model, telefonda çalışabiliyorsa saatte en çok 20 kez çağrılır; sınır dolunca
  // kart yalnız kuraldan. Aynı mesajdan aynı türde kayıt varsa zatenEklendi: { collectionId, recordId } (ilk işlemi
  // küçük olan asıl). Dönüş: { tur, sema, cikarim (sinif'li), zatenEklendi } | null
  async extractPlan (mesaj, { semalar } = {}) {
    const p = mesaj && typeof mesaj.ref === 'string' ? parseSrc(mesaj.ref) : null
    if (!p || p.tur !== 'msg') fail('REFERENCE_REQUIRED')
    const s = {}
    for (const tur of ['etkinlik', 'yapilacak']) { s[tur] = semalar && this.semalar.get(semalar[tur]); if (!s[tur]) fail('NO_SCHEMA') }
    const kart = yz.plan.planCikar(String(mesaj.metin || ''), { at: mesaj.at, kaynak: [mesaj.ref], kisiler: this._kisiler(), yazar: mesaj.yazar ? 'uye:' + this._L.canonical(hex(mesaj.yazar)) : null, semalar: s })
    if (!kart) return null
    const sema = s[kart.tur]
    let cikarim = kart.cikarim
    const yetenek = await this.kanca.yetenek()
    const y = yz.yetenek.yol('cikar', 'aile', { metin: mesaj.metin }, { ...yetenek, isciler: [] })
    const saat = this.now() - 3_600_000
    this.#planCagri = this.#planCagri.filter((t) => t > saat)
    if (y.yol === 'telefon' && this.kanca.model && this.#planCagri.length < PLAN_SAATLIK) {
      this.#planCagri.push(this.now())
      const r = await this.kanca.model({ yol: 'telefon', isci: null, collectionId: null, istem: yz.asistan.istemKur([mesaj.metin], 'plan-cikar'), sema })
      cikarim = yz.cikarma.birlestir(sema, yz.cikarma.denetle(sema, r.alanlar || {}, mesaj.metin, { yol: 'telefon', model: r.model, kaynak: [mesaj.ref], kisiler: this._kisiler() }), cikarim)
    }
    return { tur: kart.tur, sema: kart.sema, cikarim: { ...cikarim, sinif: 'aile' }, zatenEklendi: this._zatenEklendi(mesaj.ref, sema.hedef) }
  }

  _zatenEklendi (ref, type) {
    let en = null
    for (const cid of this._okunur()) {
      for (const k of this.kayit.r.records(cid)) {
        if (k.type !== type || !Array.isArray(k.fields._src) || !k.fields._src.includes(ref)) continue
        const ilk = this.kayit.r.gecmis(cid, hex(k.recordId))[0]?.opId || ''
        if (!en || ilk < en.ilk) en = { collectionId: cid, recordId: hex(k.recordId), ilk }
      }
    }
    return en ? { collectionId: en.collectionId, recordId: en.recordId } : null
  }

  // Onay: platformun ekranı hedef koleksiyonu ve alanları gösterir; "Kaydet" dönünce tek kullanımlık jeton
  async requestApproval (collectionId, semaAdi, cikarim) {
    const cid = hex(collectionId)
    const sema = this.semalar.get(semaAdi)
    if (!sema) fail('NO_SCHEMA')
    if (typeof this.#onayEkrani !== 'function') fail('NO_APPROVAL_SCREEN')
    const col = this._L.collections.get(cid)
    if (!col) fail('NO_COLLECTION')
    const sinif = cikarim.sinif
    if (!yz.yetenek.SINIFLAR.includes(sinif)) fail('INVALID_CLASS')
    if (sinif === 'kasa' && col.sensitivity !== 'kasa') fail('VAULT_SOURCE') // §8.6, RFC-0023 §2 a
    const alanlar = yz.cikarma.ekranAlanlari(sema, cikarim)
    const r = await this.#onayEkrani({ collectionId: cid, sema, hedef: sema.hedef, alanlar: alanlar.map((x) => ({ ...x })), sinif })
    if (!r || !r.son) return null
    const son = yz.cikarma.sonDogrula(sema, r.son)
    const kayit = { type: sema.hedef, recordId: null, fields: yz.cikarma.kayitAlanlari(sema, cikarim, alanlar, son, { col }) }
    const jeton = rastgeleHex(16)
    this.#jetonlar.set(jeton, { ozet: hex(approvalSummary(cid, kayit, sinif)), kayit, at: this.now() })
    return jeton
  }

  // --- 273 AI_SAVE --- RFC-0025 §2: kaydet(collectionId, cikarim, { ek, sema }) onay ekranını kendisi açar ve
  // yapay zeka alanlarıyla ürünün ek alanlarını (dosya, kaynak kişi, hatırlatma; yapay zeka sayılmaz) aynı işlemde
  // yazar; kullanıcı kapatırsa null (D19 25). Eski yol: onayIste'nin jetonuyla kaydet(collectionId, cikarim, jeton).
  async save (collectionId, cikarim, ucuncu = {}) {
    const cid = hex(collectionId)
    if (typeof ucuncu === 'string') return this._jetonlaKaydet(cid, cikarim, ucuncu)
    const { ek = {}, sema: semaAdi = cikarim.sema } = ucuncu || {}
    const sema = this.semalar.get(semaAdi)
    if (!sema) fail('NO_SCHEMA')
    const semaAlanlari = new Set(sema.alanlar.map((a) => a.ad))
    for (const k of Object.keys(ek)) if (!/^[a-z0-9_.]+$/.test(k) || semaAlanlari.has(k) || ['_src', '_conf', '_ai', '_aiyol'].includes(k)) fail('INVALID_EXTRA_FIELD')
    const jeton = await this.requestApproval(cid, semaAdi, cikarim)
    if (jeton === null) return null
    const j = this.#jetonlar.get(jeton)
    j.kayit = { ...j.kayit, fields: { ...ek, ...j.kayit.fields } }
    j.ozet = hex(approvalSummary(cid, j.kayit, cikarim.sinif))
    return this._jetonlaKaydet(cid, cikarim, jeton)
  }

  async _jetonlaKaydet (cid, cikarim, onayJetonu) {
    const j = typeof onayJetonu === 'string' ? this.#jetonlar.get(onayJetonu) : null
    if (!j) fail('INVALID_APPROVAL_TOKEN')
    this.#jetonlar.delete(onayJetonu)
    if (this.now() - j.at > JETON_MS) fail('APPROVAL_EXPIRED')
    if (hex(approvalSummary(cid, j.kayit, cikarim.sinif)) !== j.ozet) fail('INVALID_APPROVAL_TOKEN')
    if (JSON.stringify(cikarim.kaynak) !== JSON.stringify(j.kayit.fields._src || []) || cikarim.model !== j.kayit.fields._aiyol) fail('INVALID_APPROVAL_TOKEN')
    return this.kayit._yaz(cid, null, j.kayit.type, j.kayit.fields)
  }

  // --- 274 AI_SEARCH ---
  async search (metin, { koleksiyonlar = null, limit = 8 } = {}) {
    const r = await this._araParcalar(metin, { koleksiyonlar })
    const out = r.slice(0, limit)
    if (r.anlamsalHata) out.anlamsalHata = r.anlamsalHata
    return out
  }

  // §9.4: anahtar kelime (ilk 50) + gömme kancası varsa anlamsal (ilk 50), karşılıklı sıra birleşimi. Anlamsal
  // listedeki parça iç çarpımını (carpim) taşır: dayanak eşiği için (§9.4 madde 6)
  async _araParcalar (metin, { koleksiyonlar = null } = {}) {
    this.ledgerAdvanced()
    const L = this._L
    const okunur = this._okunur()
    const kapsam = (koleksiyonlar || okunur).map(hex).filter((x) => okunur.includes(x))
    const anahtar = this.dizinler.ara(metin, { koleksiyonlar: kapsam })
    const listeler = [anahtar]
    const carpim = new Map()
    let anlamsalHata = null
    if (this.gomme) {
      // Arama her zaman çalışır (§9.4): anlamsal adım düşerse yalnız anahtar kelime, hata kodu sonuçta (B4)
      try {
        await this.gomme.isle()
        const anlamsal = (await this.gomme.ara(metin, { koleksiyonlar: kapsam.filter((x) => this.dizinli.has(x)) })).filter((x) => this._parcaMetni.has(x.id))
        for (const x of anlamsal) carpim.set(x.id, x.carpim)
        const es = new Map(anahtar.map((x) => [x.id, x]))
        listeler.push(anlamsal.map((x) => ({ ...x, ref: 'kayit:' + x.collectionId + '/' + x.recordId, eslesen: es.get(x.id)?.eslesen || [] })))
      } catch (err) {
        anlamsalHata = err && /^[A-Z][A-Z0-9_]{2,63}$/.test(err.message) ? err.message : 'EMBEDDING_ERROR'
        this.emit('ai', { tur: 'gomme-hata', kod: anlamsalHata })
      }
    }
    // Gömme beklenirken kasa kilitlenmiş ya da okuyuculuk bitmiş olabilir: kapsam yeniden (B3b)
    this.ledgerAdvanced()
    const simdiOkunur = new Set(this._okunur())
    const sonuc = yz.dizin.rrf(listeler).filter((x) => simdiOkunur.has(x.collectionId) && this._parcaMetni.has(x.id)).map((x) => {
      const col = L.collections.get(x.collectionId)
      return { ...x, ...(carpim.has(x.id) ? { carpim: carpim.get(x.id) } : {}), metin: this._parcaMetni.get(x.id) || '', sinif: col?.sensitivity === 'kasa' ? 'kasa' : 'aile', taskAccess: !!col?.taskAccess, sensitivity: col?.sensitivity, okuyucuSayisi: col?.readers.length || 0 }
    })
    if (anlamsalHata) sonuc.anlamsalHata = anlamsalHata
    return sonuc
  }

  // Bekleyen parçaları gömer ve dizin dosyalarını yazar (platform şarjda ya da boşta çağırabilir; ara da çağırır)
  async processEmbedding () { return this.gomme ? this.gomme.isle() : 0 }

  // --- 275 AI_INDEX --- anahtar kelime dizini (başvuru gerçeklemesi; platformda FTS5). turAlanlari(type) → [{ ad, etiket }]
  directory (islem, collectionId = null, { turAlanlari = null } = {}) {
    this.ledgerAdvanced()
    if (islem === 'durum') return { koleksiyonlar: [...this.dizinli].sort(), parca: this.dizinler.boyut, ...(this.gomme ? { gomulu: this.gomme.boyutu } : {}) }
    if (islem === 'sil') { if (collectionId) this._dizinSil(hex(collectionId)); else for (const x of [...this.dizinli]) this._dizinSil(x); return this.directory('durum') }
    if (islem !== 'kur') fail('INVALID_OPERATION')
    if (turAlanlari) this._turAlanlari = turAlanlari
    const okunur = this._okunur()
    const hedef = collectionId ? [hex(collectionId)] : okunur
    if (!collectionId) this._otomatikDizin = true // bütün dizin kuruldu: yeni okunur koleksiyon kendiliğinden eklenir
    for (const cid of hedef) {
      if (!okunur.includes(cid)) fail('UNAUTHORIZED')
      this._koleksiyonDizinle(cid)
    }
    this.emit('ai', { tur: 'dizin', koleksiyonlar: hedef })
    return this.directory('durum')
  }

  _koleksiyonDizinle (cid) {
    this.dizinler.koleksiyonSil(cid)
    const idler = new Set()
    const st = this.gomme ? this.kayit.r.durumlar(cid) : null // son yazım zamanı (sınırda en eskiler çıkar)
    for (const k of this.kayit.r.records(cid)) for (const id of this._kayitDizinle(cid, k, this._sonYazim(st, k))) idler.add(id)
    if (this.gomme) this.gomme.ayikla(cid, idler) // dosyadan yüklenmiş ama artık olmayan parçalar
    this.dizinli.add(cid)
  }

  _sonYazim (st, k) {
    const x = st && st.get(hex(k.recordId))
    return x && x.lastPut ? msOf(x.lastPut.hlc) : 0
  }

  _kayitDizinle (cid, k, hlc = 0) {
    if (!yz.dizin.dizinlenir(k.type)) return []
    const alanlar = this._turAlanlari(k.type) || Object.keys(k.fields).sort().map((ad) => ({ ad }))
    const rid = hex(k.recordId)
    const kalici = this._L.collections.get(cid)?.sensitivity !== 'kasa' // kasa dizini yalnız bellekte
    return yz.dizin.parcala(yz.dizin.kayitMetni(k.fields, alanlar)).map((p, i) => {
      const id = cid + '|' + rid + '#' + i // koleksiyonlu kimlik (inceleme 18 şüpheli)
      this.dizinler.ekle({ id, collectionId: cid, recordId: rid, ref: 'kayit:' + cid + '/' + rid, metin: p })
      this._parcaMetni.set(id, p)
      if (this.gomme) this.gomme.ekle({ id, collectionId: cid, recordId: rid, hlc, metin: p, kalici })
      return id
    })
  }

  // §9.5 satır 2: silinen ya da değişen kaydın parçaları çıkar; değişen kayıt yeniden parçalanır (bulgu 2)
  _kayitDegisti (cid, ids) {
    cid = hex(cid)
    if (!this.dizinli.has(cid)) return
    const st = this.gomme ? this.kayit.r.durumlar(cid) : null
    for (const rid of ids) {
      const r = hex(rid)
      for (const id of [...this._parcaMetni.keys()]) if (id.startsWith(cid + '|' + r + '#')) this._parcaMetni.delete(id)
      this.dizinler.kayitSil(cid, r)
      if (this.gomme) this.gomme.kayitSil(cid, r)
      const k = this.kayit.r.get(cid, r)
      if (k) this._kayitDizinle(cid, k, this._sonYazim(st, k))
    }
  }

  _dizinSil (cid) {
    this.dizinler.koleksiyonSil(cid)
    if (this.gomme) this.gomme.koleksiyonSil(cid)
    else if (this.gommeSaklama) { try { this.gommeSaklama.sil(yz.gomme.dosyaAdi(cid)) } catch {} } // model silinmiş (B7)
    this.dizinli.delete(cid)
    for (const k of [...this._parcaMetni.keys()]) if (!this.dizinler.parcalar.has(k)) this._parcaMetni.delete(k)
    this.emit('ai', { tur: 'dizin-silindi', collectionId: cid })
  }

  // --- 276 AI_MODEL --- model dosyaları platformda (adım 3); burada yalnız arayüz
  async model () { fail('ON_PLATFORM') }

  // --- 277 AI_EXTERNAL --- iki adım (RFC-0023 §2 e): hazırla, gösterilen metne ve cevabın 'genel' sınıfına bağlı
  // 5 dakikalık tek kullanımlık jeton döner; disariSor jetonsuz ya da değişmiş metinle reddeder. 1 KB üstü süzgece girmez.
  async prepareExternal (metin) {
    if (typeof metin !== 'string' || b4a.byteLength(metin) > DISARI_MAX) return { engel: ['uzun'] }
    const engel = yz.engel.engel(metin, { adlar: this._adlar() })
    if (engel.length) return { engel }
    const y = await this.kanca.yetenek()
    if (!yz.yetenek.disariGoster(y, { sinif: 'genel', engel, rol: this._uye()?.role })) return { engel: ['bulut-kapali'] }
    const at = this.#genelSorular.get(yz.metin.N(metin))
    if (at === undefined || this.now() - at > DISARI_MS) return { engel: ['genel-cevap-yok'] }
    const jeton = rastgeleHex(16)
    this.#disari.set(jeton, { metin, at: this.now() })
    return { gidecek: metin, jeton }
  }

  async askExternal (gidecek, jeton) {
    const j = typeof jeton === 'string' ? this.#disari.get(jeton) : null
    if (!j) fail('NO_EXTERNAL_APPROVAL')
    this.#disari.delete(jeton)
    if (j.metin !== gidecek || this.now() - j.at > DISARI_MS) fail('NO_EXTERNAL_APPROVAL')
    const gun = Math.floor(this.now() / DAY)
    if (this.#disariSayac.gun !== gun) this.#disariSayac = { gun, n: 0 }
    if (this.#disariSayac.n >= DISARI_GUNLUK) fail('DAILY_LIMIT') // kişi başına günde 30 (RFC-0013 §16.2)
    if (!this.kanca.gecit) fail('NO_GATEWAY')
    this.#disariSayac.n++
    const r = await this.kanca.gecit(gidecek)
    return yz.asistan.cevapKur({ metin: r.metin, yol: 'disari', model: 'disari/' + r.model, sinif: 'genel' })
  }

  // --- 278 AI_SETTINGS ---
  async settings (degisen = null) {
    if (degisen) {
      if (degisen.gecmis !== undefined && !['kapali', 7, 30, 365].includes(degisen.gecmis)) fail('INVALID_SETTINGS')
      this._ayar = { ...this._ayar, ...degisen }
    }
    return { ...this._ayar }
  }

  // --- 279 AI_QUOTA ---
  async quota () { return this.kanca.kota ? this.kanca.kota() : { ay: null, kalan: 0, gunlukKalan: 0, paket: false } }
}

module.exports = { AiApi, AI_COMMAND, approvalSummary: approvalSummary }
