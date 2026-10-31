// SPDX-License-Identifier: Apache-2.0
// edge.js — uç cihazın ürün yüzü (RFC-0008 §13, açıklama 1; komutlar 340–344)
//
// CameraApi üye telefonundadır: uç yapılandırması (341, ebeveyn), görünür izleme durumu (342) ve canlı izleme (343, 344).
// EdgeDevice uç modundaki cihazdadır (Android uç, iOS ekran) ve çekirdeğin UcDurumu'nu (core/edge/edge.js) sarar: kalıcı seq'ler,
// yapılandırmanın geri yüklenmesi, görünür izleme kapısı (güncel UC_STATUS olmadan kare mühürlenmez), akış ömrü. Durumu
// değiştiren her yöntem yayınlanacak UC_STATUS'u da döner. Taşıma platformun işidir: yöntemler gönderilecek baytları döner;
// ağdan gelen her zarf giris.gelenZarf'tan geçer. Çift sırrı platformun PairBook'undan (tören anahtarı dahil) zorunludur.
// Kamera, kodlayıcı ve ön plan hizmeti uygulamanın yerli modülündedir (RFC-0029 §3).
//
// Adım 9 (§11.7, §11.8): ekran modunda üye kartlarını gönderir (CameraApi.sendCard, 345), uç denetler ve yalnız bellekte
// gösterir (EdgeDevice.receiveScreen, kartlar); sensör modunda uç eşik olayını olaylar koleksiyonuna bırakır (EdgeDevice.sensorEvent).
// Uç görev çalıştırmaz (gorevAl → TASK_REJECT DESTEK_YOK).
//
// Adım 8 (§9, Android uç): ebeveyn kaldırmayı başlatır (CameraApi.startRemoval → RETIRE_BEGIN), cihazın başındaki kişi onaylar
// (iki taraflı onay), uç verisini siler ve `uygulama-verisi-silindi` raporunu (APP_WIPE_REPORT) ebeveynlere gönderir
// (EdgeDevice.wipe). Telefon raporu defterdeki cihaz anahtarıyla doğrular (silmeRaporuAl), saklar ve Ebeveynler koleksiyonuna
// `hf.wipe.report` olarak yazar (347; öbür ebeveynler oradan görür), ucu
// DEVICE_DETACH { wipe: true, wipeReportHash } ile çıkarır (ucuCikar). Rapor gelmezse wipeReportHash sıfırdır (madde 8). Gerçek
// silme (Keystore anahtarı, dizinler) yerli modülündür; adımların sonucu `items` olarak verilir. 345, 346 ve 348 sonraki adımlardadır.
const b4a = require('b4a')
const c = require('compact-encoding')
const sodium = require('sodium-native')
const { giris, zarf: { Z }, emeklilik: E } = require('@havenfold/core')
const U = require('@havenfold/edge')
const { Emitter } = require('./api')

const { yapilandirma: Y, durum: D, akis: A, cerceve: C, kodlama: K, silme: S, ekran: Ek, uc: { UcDurumu, gorevReddi } } = U
const { hlc: { Hlc }, esitleme: { recOps } } = require('@havenfold/records')
const G = require('@havenfold/tasks').kodlama
const hex = (b) => (typeof b === 'string' ? b : b4a.toString(b, 'hex'))
const unhex = (x) => (typeof x === 'string' ? b4a.from(x, 'hex') : x)
function fail (code) { throw new Error(code) }
const rastgele = (n) => { const b = b4a.alloc(n); sodium.randombytes_buf(b); return b }
const ssrcUret = () => { const b = rastgele(4); return new DataView(b.buffer, b.byteOffset, 4).getUint32(0) }
const bellekSaklama = () => { const m = new Map(); return { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v) } }

// RFC-0008 §12 (340–349). 346 TRAY_PROFILE ve 348 APP_DATA_WIPE sonraki adımlardadır.
const EDGE_COMMAND = { EDGE_BECOME: 340, EDGE_CONFIGURE: 341, EDGE_STATUS: 342, EDGE_WATCH: 343, EDGE_WATCH_CLOSE: 344, EDGE_CARD_SEND: 345, APP_WIPE_REPORTS: 347 }
const ANAHTAR_EKRAN_SEQ = 'uc/ekran-seq' // telefonda: uç başına gönderilen kartların son seq'i (açıklama 2 madde 2: ms tabanlı)
const ANAHTAR_CFG = 'uc/yapilandirma' // telefonda: ucun bilinen en yeni yapılandırmasının seq, mod ve screenFrom'u
const ANAHTAR_HLC = 'uc/hlc' // uçta: sensör bırakmalarının kayıt saati (kalıcı, monoton)
const ANAHTAR_RAPOR = 'uc/silme-raporu' // cihaz başına en yeni rapor (finishedAt; inceleme L2 madde 4)
const ANAHTAR_ISTEK = 'uc/kaldirma-istekleri' // bu telefonun başlattığı kaldırmalar: ucHex → an
const ANAHTAR_KALDIRMA = 'uc/kaldirma'
const KALDIRMA_SURESI_MS = 24 * 3_600_000 // kaldırma isteği cihazda bu kadar geçerli (L2 madde 5)
const RAPOR_KAYDI = 'hf.wipe.report' // Ebeveynler koleksiyonundaki kayıt (§9.2 madde 7)
const SIFIR32 = b4a.alloc(32)
const VARSAYILAN_ISTEK = { width: 1280, height: 720, fps: 10 }
const ANAHTAR_SEQ = 'uc/yapilandirma-seq'

// Açıklama 1 madde 7: çift sırrı zorunlu (tören anahtarsız çift sırrına inilmez)
function ciftGerek (ciftSirri) {
  if (typeof ciftSirri !== 'function') fail('PAIR_SECRET_REQUIRED')
  return ciftSirri
}

class CameraApi extends Emitter {
  // defter: LedgerApi; ciftSirri(peerHex) → 32 bayt (platformun PairBook'u); saklama: { get, set } — uçların bilinen
  // yapılandırma seq'leri ve silme raporları (kalıcı; verilmezse bellekte); kayit: RecordApi (verilirse silme raporu Ebeveynler
  // koleksiyonuna yazılır ve oradan okunur, §9.2 madde 7)
  constructor ({ defter, ciftSirri, saklama = null, kayit = null, now = Date.now }) {
    super()
    this.defter = defter
    this.kayit = kayit
    this.now = now
    this.cift = ciftGerek(ciftSirri)
    this.saklama = saklama || bellekSaklama()
    this.durumlar = new D.DurumDefteri({ ledger: defter.L, now })
    this.akislar = new Map() // streamIdHex → { ucHex, opener, sealer, kabul }
  }

  get _L () { return this.defter.L }
  get _me () { return hex(this.defter.me.memberId) }

  _seqler () { return this.saklama.get(ANAHTAR_SEQ) || {} }
  _seq (ucHex) { return this._seqler()[ucHex] || 0 }
  _seqYaz (ucHex, seq) { if (seq > this._seq(ucHex)) this.saklama.set(ANAHTAR_SEQ, { ...this._seqler(), [ucHex]: seq }) }

  // Kamerası olan uçlar: defterde aktif, class 'uc'
  edges () {
    return [...this._L.devices].filter(([, d]) => d.active && d.class === 'uc').map(([id, d]) => ({ ucId: id, ad: d.name, durum: this.status(id) }))
  }

  // 341 EDGE_CONFIGURE (ebeveyn; biyometri platformda). cfg: { mode, targets, video?, windows?, sensors?, screenFrom?, seq? }
  // seq verilmezse bilinen en büyük seq'in (bu telefonun yazdığı, gördüğü ya da ucun UC_STATUS'unda bildirdiği) bir fazlası.
  // Dönüş { bytes, seq }: uca doğrudan oturum ya da kutu emanetiyle gider. Uygulandı mı UC_STATUS.configSeq'ten (durum())
  configure (ucId, cfg) {
    const ucHex = hex(ucId)
    const d = this._L.devices.get(ucHex)
    if (!d || !d.active || d.class !== 'uc') fail('WRONG_EDGE')
    if (!Y.ebeveynMi(this._L, this._me)) fail('UNAUTHORIZED')
    const seq = cfg.seq ?? this._seq(ucHex) + 1
    const m = {
      ucId: unhex(ucHex), seq, mode: cfg.mode, targets: cfg.targets || [], video: cfg.video || K.VIDEO_VARSAYILAN,
      windows: cfg.windows || [], sensors: cfg.sensors || [], screenFrom: cfg.screenFrom || [], ledgerSeq: this._L.len - 1
    }
    const bytes = Y.yapilandirmaKodla(this._L.familyId, m, this.defter.me)
    // Ucun yapacağı denetimin aynısı: ebeveyn geçersiz yapılandırmayı göndermez
    Y.yapilandirmaDenetle(this._L, bytes, { ucHex })
    this._seqYaz(ucHex, seq)
    this._cfgYaz(ucHex, m)
    return { bytes, seq }
  }

  // Ucun bilinen en yeni yapılandırması (bu telefonun yazdığı ya da gördüğü): kart göndermeden önce mod ve screenFrom
  // telefonda da denetlenir (açıklama 2 madde 4)
  _cfgYaz (ucHex, m) {
    const l = this.saklama.get(ANAHTAR_CFG) || {}
    if (l[ucHex] && l[ucHex].seq >= m.seq) return
    this.saklama.set(ANAHTAR_CFG, { ...l, [ucHex]: { seq: m.seq, mode: m.mode, screenFrom: [...m.screenFrom] } })
  }

  // Başka bir ebeveynin yapılandırmasının kopyası (emanet): seq öğrenilir
  configSeen (fromHex, bytes, yol) {
    giris.gelenZarf({ myRole: 'uye', peerRole: this._L.sessionRole(hex(fromHex)), type: Z.UC_CONFIG, bytes, L: this._L, gonderen: hex(fromHex), yol })
    const { m } = Y.yapilandirmaCoz(bytes)
    this._seqYaz(hex(m.ucId), m.seq)
    this._cfgYaz(hex(m.ucId), m)
    return m.seq
  }

  // UC_STATUS geldi (uçtan doğrudan ya da emanetle): saklanır, configSeq öğrenilir, 'durum' yayılır
  receiveStatus (fromHex, bytes, yol) {
    giris.gelenZarf({ myRole: 'uye', peerRole: this._L.sessionRole(hex(fromHex)), type: Z.UC_STATUS, bytes, L: this._L, gonderen: hex(fromHex), yol })
    const m = this.durumlar.al(bytes, { from: yol === 'dogrudan' ? hex(fromHex) : null })
    this._seqYaz(hex(m.ucId), m.configSeq)
    const s = durumOf(m, this.durumlar.alinma(hex(m.ucId)), this.now())
    this.emit('status', hex(m.ucId), s)
    return s
  }

  // 342 EDGE_STATUS: son durum; son bildirimden bu yana D.CEVRIMDISI_MS geçtiyse çevrimdışı
  status (ucId) {
    const m = this.durumlar.get(hex(ucId))
    return m ? durumOf(m, this.durumlar.alinma(hex(ucId)), this.now()) : null
  }

  // Kamerası açık uçlar ve alıcıları (Yuva Hat'taki kapatılamayan satır, §11.6)
  openCameras () { return this.durumlar.acikKameralar() }

  // Açıklama 2 madde 1: sensörü açık uçlar ("Sensör açık" satırı, kamera satırı gibi kapatılamaz): açık sensörler ve olayların
  // gittiği koleksiyonlar, ucun son UC_STATUS'undan
  openSensors () {
    return this.edges().filter((u) => u.durum && u.durum.mode === 'sensor' && u.durum.sensors.length)
      .map((u) => ({ ucId: u.ucId, sensors: [...u.durum.sensors], hedefler: [...u.durum.sensorHedefleri], cevrimici: u.durum.cevrimici }))
  }

  // 343 EDGE_WATCH: canlı izleme isteği. configSeq ucun bildirdiği (UC_STATUS) ya da bilinen; dönüş { streamId, bytes }
  watch (ucId, { want = VARSAYILAN_ISTEK, configSeq = null } = {}) {
    const ucHex = hex(ucId)
    const seq = configSeq ?? (this.durumlar.get(ucHex)?.configSeq || this._seq(ucHex))
    if (!seq) fail('NO_CONFIG')
    const streamId = rastgele(16)
    const bytes = A.akisAcKodla(this._L.familyId, { streamId, ucId: unhex(ucHex), purpose: 'canli', taskId: b4a.alloc(16), want, configSeq: seq, ledgerSeq: this._L.len - 1 }, this.defter.me)
    this.akislar.set(hex(streamId), { ucHex, opener: null, sealer: null, kabul: null })
    return { streamId: hex(streamId), bytes }
  }

  // UC_STREAM_ACCEPT: kareleri açan ve anahtar kare isteğini mühürleyen (ters yön, açıklama 1 madde 5) nesne
  receiveAccept (fromHex, bytes, yol) {
    giris.gelenZarf({ myRole: 'uye', peerRole: this._L.sessionRole(hex(fromHex)), type: Z.UC_STREAM_ACCEPT, bytes, L: this._L, gonderen: hex(fromHex), yol })
    const k = A.kabulCoz(bytes)
    const id = hex(k.streamId)
    const a = this.akislar.get(id)
    if (!a || a.ucHex !== hex(fromHex) || a.kabul) fail('NO_STREAM')
    const pair = this.cift(a.ucHex)
    if (!pair) fail('NO_PAIR')
    a.opener = new C.AkisAcici({ pair, streamId: k.streamId, ssrc: k.ssrc, yon: C.YON.UC })
    a.sealer = new C.AkisMuhurleyici({ pair, streamId: k.streamId, ssrc: k.ssrc, yon: C.YON.ALICI })
    a.kabul = k
    return {
      streamId: id, codec: k.codec, profile: k.profile, width: k.width, height: k.height, fps: k.fps,
      ac: (cerceve) => a.opener.ac(cerceve),
      denetimMuhurle: (yuk, o) => a.sealer.muhurle(yuk, o).cerceve
    }
  }

  // UC_STREAM_CLOSE (uçtan): akış biter, 'stream-closed' yayılır
  receiveClose (fromHex, bytes, yol) {
    giris.gelenZarf({ myRole: 'uye', peerRole: this._L.sessionRole(hex(fromHex)), type: Z.UC_STREAM_CLOSE, bytes, L: this._L, gonderen: hex(fromHex), yol })
    const m = A.kapatCoz(bytes)
    const id = hex(m.streamId)
    const a = this.akislar.get(id)
    if (!a || a.ucHex !== hex(fromHex)) fail('NO_STREAM')
    this._birak(id)
    this.emit('stream-closed', id, m.code)
    return { streamId: id, code: m.code }
  }

  // 344 EDGE_WATCH_CLOSE: izleyen kapatır; uca gidecek UC_STREAM_CLOSE baytları
  stopWatching (streamId) {
    const id = hex(streamId)
    if (!this.akislar.has(id)) fail('NO_STREAM')
    this._birak(id)
    return A.kapatKodla({ streamId: unhex(id), code: 'BITTI', by: this.defter.me.memberId })
  }

  // 345 EDGE_CARD_SEND (§11.8): üye kendisi seçtiği kartları ekran ucuna gönderir; ekran herkesin göreceği yerdedir: ekran
  // `SCREEN_ALERT`nı gösterir, kişi onaylayınca `uyariOnay: true` ile çağırır. Ebeveyn ya da yetişkin (çocuk ve
  // misafir gönderemez); ucun bilinen modu ekran değilse ya da gönderen bilinen screenFrom'a uymuyorsa gönderilmez.
  // cards: [{ id, title, lines, until }] (en çok 12, zarf en çok 32 KB). Dönüş { bytes, seq, uyari }
  sendCard (ucId, cards, { uyariOnay = false } = {}) {
    const ucHex = hex(ucId)
    const d = this._L.devices.get(ucHex)
    if (!d || !d.active || d.class !== 'uc') fail('WRONG_EDGE')
    const ben = this._L.members.get(this._me)
    if (!ben || !ben.active || this._L.sessionRole(this._me) !== 'uye' || !['ebeveyn', 'yetiskin'].includes(ben.role)) fail('UNAUTHORIZED')
    // Açıklama 2 madde 4: uyarı gösterilip onaylanmadan imzalanmaz; ucun bilinen modu ve screenFrom'u telefonda da denetlenir
    if (uyariOnay !== true) fail('NO_ALERT_APPROVAL')
    const durum = this.status(ucHex)
    const cfg = (this.saklama.get(ANAHTAR_CFG) || {})[ucHex]
    const mod = durum && (!cfg || durum.configSeq >= cfg.seq) ? durum.mode : cfg?.mode
    if (mod && mod !== 'ekran') fail('NOT_MODE_SCREEN')
    if (cfg && cfg.mode === 'ekran' && !Ek.kaynakUyar(this._L, cfg.screenFrom, this._me)) fail('SOURCE_NOT_ALLOWED')
    // Açıklama 2 madde 2: sıra max(son + 1, şimdiki ms); telefon verisi silinse de kart eski sayılmaz
    const seqler = this.saklama.get(ANAHTAR_EKRAN_SEQ) || {}
    const seq = Math.max((seqler[ucHex] || 0) + 1, this.now())
    const bytes = Ek.ekranKodla(this._L.familyId, { ucId: unhex(ucHex), seq, cards }, this.defter.me)
    this.saklama.set(ANAHTAR_EKRAN_SEQ, { ...seqler, [ucHex]: seq })
    return { bytes, seq, uyari: Ek.UYARI }
  }

  // RETIRE_BEGIN (0x98, RFC-0003 §8): ebeveyn ucu kaldırmayı başlatır (§9.2 madde 1); uca gidecek baytlar. Uç verisini
  // cihazın başındaki kişi onaylayınca siler (iki taraflı onay, madde 3)
  startRemoval (ucId) {
    const ucHex = hex(ucId)
    const d = this._L.devices.get(ucHex)
    if (!d || !d.active || d.class !== 'uc') fail('WRONG_EDGE')
    if (!Y.ebeveynMi(this._L, this._me)) fail('UNAUTHORIZED')
    this.saklama.set(ANAHTAR_ISTEK, { ...(this.saklama.get(ANAHTAR_ISTEK) || {}), [ucHex]: this.now() })
    return c.encode(E.retireBegin, { deviceId: unhex(ucHex) })
  }

  // Ebeveynler koleksiyonu (RFC-0019 7.8: genel, normal, okuyucusu yalnız rol:ebeveyn); yoksa null
  _ebeveynler () {
    for (const [id, x] of this._L.collections) {
      if (x.kind === 'genel' && x.sensitivity === 'normal' && x.readers.length === 1 && x.readers[0] === 'rol:ebeveyn') return id
    }
    return null
  }

  _raporlarim () { return this.saklama.get(ANAHTAR_RAPOR) || {} }
  // Cihaz başına en yeni (finishedAt) rapor kalır
  _raporSakla (r) {
    const l = this._raporlarim()
    const eski = l[r.deviceId]
    if (!eski || eski.finishedAt < r.finishedAt || (eski.finishedAt === r.finishedAt && eski.hash < r.hash)) this.saklama.set(ANAHTAR_RAPOR, { ...l, [r.deviceId]: r })
  }

  // APP_WIPE_REPORT (0xE7) geldi (doğrudan ya da emanetle): imza defterdeki cihaz anahtarıyla doğrulanır, cihaz başına en yeni
  // rapor saklanır, kayit verildiyse ve Ebeveynler koleksiyonu varsa `hf.wipe.report` kaydı yazılır (öbür ebeveynler de görür;
  // §9.2 madde 7) ve 'wipe-report' yayılır. Dönüş raporun özeti (kayit: 'yazildi' | 'vardi' | 'koleksiyon-yok' | null);
  // ekranda `uyari` en üstte yazılır
  receiveWipeReport (fromHex, bytes, yol) {
    giris.gelenZarf({ myRole: 'uye', peerRole: this._L.sessionRole(hex(fromHex)), type: Z.APP_WIPE_REPORT, bytes, L: this._L, gonderen: hex(fromHex), yol })
    const { m, hash } = S.silmeRaporuDenetle(this._L, bytes, { from: yol === 'dogrudan' ? hex(fromHex) : null })
    const r = raporOzeti(m, hash, this.saklama.get(ANAHTAR_ISTEK)?.[hex(m.deviceId)] ?? null)
    const rb = { ...r, bayt: hex(bytes) }
    this._raporSakla(rb)
    const kayit = this.kayit ? this._kayitYaz(rb) : null
    this.emit('wipe-report', r)
    return { ...r, kayit }
  }

  // Raporun Ebeveynler kaydı (alanlar küçük harf; rapor tam baytlarıyla, okuyan yeniden doğrular)
  // Yazılan rapor işaretlenir: yeni koleksiyonda dönem anahtarı gelene kadar yazım kuyrukta bekler ve sorguda görünmez
  _kayitYaz (r) {
    const cid = this._ebeveynler()
    if (!cid) return 'koleksiyon-yok'
    const l = this._raporlarim()
    const bende = l[r.deviceId]?.hash === r.hash
    if (bende && l[r.deviceId].kaydedildi) return 'vardi'
    const vardi = this.kayit.query(cid, { type: RAPOR_KAYDI, where: { hash: r.hash } }).length > 0
    if (!vardi) this.kayit.put(cid, null, RAPOR_KAYDI, { kind: r.kind, device_id: r.deviceId, trigger: r.trigger, result: r.result, finished_at: r.finishedAt, hash: r.hash, rapor: r.bayt })
    if (bende) this.saklama.set(ANAHTAR_RAPOR, { ...l, [r.deviceId]: { ...l[r.deviceId], kaydedildi: true } })
    return vardi ? 'vardi' : 'yazildi'
  }

  // Bu telefondaki raporlardan Ebeveynler'de kaydı olmayanları yazar (koleksiyon rapordan sonra açıldıysa); yazılan sayısı
  writeToParents () {
    if (!this.kayit || !this._ebeveynler()) return 0
    let n = 0
    for (const r of Object.values(this._raporlarim())) if (r.bayt && this._kayitYaz(r) === 'yazildi') n++
    return n
  }

  // 347 APP_WIPE_REPORTS: cihaz başına en yeni rapor (bu telefonun aldıkları ve Ebeveynler'deki kayıtlar; kayıttaki
  // rapor yeniden doğrulanır), finishedAt sırasıyla
  wipeReports () {
    const l = { ...this._raporlarim() }
    const cid = this.kayit ? this._ebeveynler() : null
    if (cid) {
      for (const k of this.kayit.query(cid, { type: RAPOR_KAYDI })) {
        try {
          const { m, hash } = S.silmeRaporuDenetle(this._L, b4a.from(String(k.fields.rapor), 'hex'))
          const r = raporOzeti(m, hash, l[hex(m.deviceId)]?.hash === hex(hash) ? l[hex(m.deviceId)].istek : null)
          const eski = l[r.deviceId]
          if (!eski || eski.finishedAt < r.finishedAt) l[r.deviceId] = r
        } catch {}
      }
    }
    return Object.values(l).map(({ bayt, kaydedildi, ...x }) => x).sort((a, b) => a.finishedAt - b.finishedAt || (a.hash < b.hash ? -1 : 1))
  }

  // Ucu defterden çıkarır (ebeveyn): DEVICE_DETACH { wipe, wipeReportHash }. Yalnız ebeveynin başlattığı kaldırmanın raporu
  // (`emeklilik`) wipe ve özeti girer (madde 7; inceleme L2 madde 5); yoksa ya da rapor `kaldirma` ise wipeReportHash sıfır
  // (madde 8). Dönüş LedgerApi yazımı (uygulandı ya da öneri)
  removeEdge (ucId, { reason = 'uygulama-verisi-silindi' } = {}) {
    const ucHex = hex(ucId)
    const d = this._L.devices.get(ucHex)
    if (!d || !d.active || d.class !== 'uc') fail('WRONG_EDGE')
    const r = this.wipeReports().filter((x) => x.deviceId === ucHex && x.trigger === 'emeklilik').at(-1)
    return this.defter.removeDevice(ucHex, r ? { reason, wipe: true, wipeReportHash: unhex(r.hash) } : { reason, wipe: false })
  }

  // Defterden çıkarılmış uçlar: silindi = rapor özetiyle çıkarıldı (wipe ve sıfır olmayan wipeReportHash); rapor bu telefonda ya
  // da Ebeveynler'deyse o rapor, değilse ucun en yeni raporu (ör. uygulama kaldırılırken: trigger 'kaldirma')
  removed () {
    const raporlar = this.wipeReports()
    return [...this._L.devices].filter(([, d]) => !d.active && d.class === 'uc').map(([id, d]) => {
      const silindi = !!d.wipe && !!d.wipeReportHash && !b4a.equals(d.wipeReportHash, SIFIR32)
      const rapor = (silindi ? raporlar.find((x) => x.hash === hex(d.wipeReportHash)) : raporlar.filter((x) => x.deviceId === id).at(-1)) || null
      return { ucId: id, ad: d.name, silindi, wipeReportHash: silindi ? hex(d.wipeReportHash) : null, rapor, removedSeq: d.removedSeq }
    })
  }

  _birak (id) {
    const a = this.akislar.get(id)
    a?.opener?.kapat()
    a?.sealer?.kapat()
    this.akislar.delete(id)
  }
}

// Arayüzün gösterdiği durum (§11.6, açıklama 1 madde 3, 6)
function durumOf (m, alinma, now) {
  return {
    ucId: hex(m.ucId), mode: m.mode, configSeq: m.configSeq, kameraAcik: m.camera.active, since: m.camera.since,
    alicilar: m.camera.streams.map((s) => ({ toId: hex(s.toId), purpose: s.purpose })), yenidenBasladi: m.yenidenBasladi,
    pil: { ...m.battery }, thermal: m.thermal, seq: m.seq, alinma, cevrimici: now - alinma <= D.CEVRIMDISI_MS,
    sensors: [...m.sensors], sensorHedefleri: m.sensorTargets.map(hex)
  }
}

// Telefonun sakladığı rapor özeti (347): uyarı metni raporla birlikte gösterilir (§9.3); istek: bu telefonun kaldırma isteğinin anı
function raporOzeti (m, hash, istek = null) {
  return {
    istek,
    deviceId: hex(m.deviceId), hostId: hex(m.hostId), kind: m.kind, trigger: m.trigger, os: m.os, osVersion: m.osVersion, appVersion: m.appVersion,
    keyStore: m.keyStore, items: m.items.map((x) => ({ ...x })), residue: [...m.residue], startedAt: m.startedAt, finishedAt: m.finishedAt,
    result: m.result, hash: hex(hash), uyari: S.UYARI
  }
}

// Ucun anındaki pil ve ısı (UcKosulu): UC_STATUS'un battery alanı
const pilOf = (u) => ({ percent: u?.pil?.percent ?? 100, tempC: u?.pil?.tempC ?? 0, onAC: u?.pil?.onAC ?? true })

class EdgeDevice extends Emitter {
  // ledger: ucun defteri (ya da defter: () → güncel defter); me: ucun kimliği; ciftSirri(peerHex) → 32 bayt (zorunlu);
  // saklama: { get, set } kalıcı (zorunlu; seq'ler ve yapılandırma, açıklama 1 madde 2)
  constructor ({ ledger = null, defter = null, me, ciftSirri, saklama, now = Date.now }) {
    super()
    this.defter = defter || (() => ledger)
    this.me = me
    this.meHex = hex(me.memberId)
    this.now = now
    this.cift = ciftGerek(ciftSirri)
    this.saklama = saklama
    this.u = new UcDurumu({ defter: this.defter, me, saklama, now })
    this.silindi = false
    const sonHlc = saklama.get(ANAHTAR_HLC)
    this.hlc = new Hlc({ last: sonHlc ? BigInt(sonHlc) : 0n, persist: (h) => saklama.set(ANAHTAR_HLC, h.toString()) })
    this.muhur = new Map() // streamIdHex → { muhurleyici, acici }
    this.kosul = null // son bilinen pil ve ısı
  }

  get L () { return this.defter() }
  get mode () { return this.silindi ? 'kapali' : this.u.mod }

  // Silindikten sonra uç hiçbir şey kabul etmez, üretmez ve mühürlemez (inceleme L2 madde 2)
  _canli () { if (this.silindi) fail('DELETED') }

  // 340 EDGE_BECOME: tören sonrası bu cihaz uç olur; NODE_PROFILE (seq kalıcı; doğrudan oturumla üyelere ve koordinatöre)
  become ({ runtime = 'android-uc', modlar = null, hostId, appVersion, versionCode }) {
    this._canli()
    const d = this.L.devices.get(this.meHex)
    if (!d || !d.active || d.class !== 'uc') fail('NOT_EDGE')
    const ucModes = modlar || K.UC_MODLARI[runtime] || fail('INVALID_MESSAGE')
    return U.profil.profilKodla(this.L.familyId, {
      nodeId: this.me.memberId, hostId: unhex(hostId), seq: this.u.profilSeq(), runtime, sandbox: 'yok', features: [], sharedComputer: false,
      idlePolicy: 'her-zaman', shareEligible: false, ucModes, appVersion, versionCode
    }, this.me)
  }

  // Yayınlanacak UC_STATUS ve alıcıları (aktif ebeveyn ve yetişkinler)
  _durum (u = this.kosul) {
    const m = this.u.durum({ battery: pilOf(u), thermal: u?.thermal || 'normal' })
    return { bytes: D.durumKodla(this.L.familyId, m, this.me), alicilar: D.durumAlicilari(this.L) }
  }

  _kapatBayt (id, code) {
    const x = this.muhur.get(hex(id))
    if (x) { x.muhurleyici.kapat(); x.acici.kapat(); this.muhur.delete(hex(id)) }
    this.emit('stream-closed', hex(id), code)
    return A.kapatKodla({ streamId: unhex(id), code, by: this.me.memberId })
  }

  // UC_CONFIG (ebeveynden doğrudan ya da kutu emanetiyle). Dönüş { kabul, kapat: [UC_STREAM_CLOSE], durum }: eski ya da
  // kaybeden yapılandırma yok sayılır (kabul false, durum null); kabulde uyuşmayan akışlar kapanır ve yeni durum yayınlanır
  receiveConfig (fromHex, bytes, yol) {
    this._canli()
    giris.gelenZarf({ myRole: 'cihaz', peerRole: this.L.sessionRole(hex(fromHex)), type: Z.UC_CONFIG, bytes, L: this.L, gonderen: hex(fromHex), yol })
    const r = this.u.yapilandirmaAl(bytes)
    if (!r.kabul) return { kabul: false, kapat: [], durum: null }
    const kapat = r.kapatilan.map((k) => this._kapatBayt(k.streamId, k.code))
    this.emit('config', this.u.cfg)
    return { kabul: true, kapat, durum: this._durum() }
  }

  // UC_STREAM_OPEN. u: { oturum: 'dogrudan' | 'role', yerel: { gun, dk }, thermal, pil: { percent, onAC, tempC?, kritik? } }
  // Kabulde { kabul: UC_STREAM_ACCEPT, durum: UC_STATUS (önce yayınlanır), streamId, muhurle, denetimAc }; değilse
  // { kapat: UC_STREAM_CLOSE, code }. muhurle güncel durum olmadan STATUS_NOT_PUBLISHED atar (açıklama 1 madde 1)
  receiveStreamRequest (fromHex, bytes, yol, u) {
    this._canli()
    giris.gelenZarf({ myRole: 'cihaz', peerRole: this.L.sessionRole(hex(fromHex)), type: Z.UC_STREAM_OPEN, bytes, L: this.L, gonderen: hex(fromHex), yol })
    this.kosul = u
    const reddet = (streamId, code) => ({ kapat: A.kapatKodla({ streamId, code, by: this.me.memberId }), code })
    const m = A.akisAcCoz(bytes).m
    // İsteği isteyenin kendisi getirmeli (başkasının adına akış yok) ve çift sırrı olmalı
    const pair = hex(m.requesterId) === hex(fromHex) ? this.cift(hex(fromHex)) : null
    if (!pair) return reddet(m.streamId, 'IZIN_YOK')
    const r = this.u.akisIstegi(bytes, u)
    if (!r.kabul) return reddet(r.streamId, r.code)
    const id = hex(r.m.streamId)
    const ssrc = ssrcUret()
    const muhurleyici = new C.AkisMuhurleyici({ pair, streamId: r.m.streamId, ssrc, yon: C.YON.UC })
    const acici = new C.AkisAcici({ pair, streamId: r.m.streamId, ssrc, yon: C.YON.ALICI })
    this.muhur.set(id, { muhurleyici, acici })
    this.emit('stream', id, { toId: r.isteyen.id, purpose: r.m.purpose })
    return {
      kabul: A.kabulKodla(A.kabulOf(r.m, r.want, { ssrc })),
      durum: this._durum(u),
      streamId: id,
      muhurle: (yuk, o) => {
        this._canli()
        if (!this.u.muhurlenebilir(id)) fail('STATUS_NOT_PUBLISHED')
        return muhurleyici.muhurle(yuk, o).cerceve
      },
      denetimAc: (cerceve) => { this._canli(); return acici.ac(cerceve) }
    }
  }

  // Uç akışı kapatır; dönüş { kapat: UC_STREAM_CLOSE, durum }
  closeStream (streamId, code) {
    this._canli()
    this.u.akisKapat(streamId, code)
    return { kapat: this._kapatBayt(streamId, code), durum: this._durum() }
  }

  // İzleyen kapattı; dönüş { streamId, code, durum }
  receiveClose (fromHex, bytes, yol) {
    this._canli()
    giris.gelenZarf({ myRole: 'cihaz', peerRole: this.L.sessionRole(hex(fromHex)), type: Z.UC_STREAM_CLOSE, bytes, L: this.L, gonderen: hex(fromHex), yol })
    const m = A.kapatCoz(bytes)
    const id = hex(m.streamId)
    const a = this.u.acikAkislar().find((x) => x.streamId === id)
    if (!a || a.toId !== hex(fromHex)) fail('NO_STREAM')
    this.u.akisKapat(id, m.code)
    this._kapatBayt(id, m.code)
    return { streamId: id, code: m.code, durum: this._durum() }
  }

  // Akış ömrü (açıklama 1 madde 4): platform düzenli (dakikada bir) ve defter değişince çağırır. Dönüş { kapat, durum }
  check (u) {
    this._canli()
    this.kosul = u
    const once = this.u.mod
    const kapatilan = this.u.denetle(u)
    const kapat = kapatilan.map((k) => this._kapatBayt(k.streamId, k.code))
    const degisti = kapatilan.length > 0 || once !== this.u.mod
    return { kapat, durum: degisti ? this._durum(u) : null }
  }

  // §11.2: kamera yeniden başlatmadan sonra dokunulmayı bekliyor (madde 6)
  restarted (v) {
    this._canli()
    this.u.yenidenBasladiYaz(v)
    return this._durum()
  }

  // UC_STATUS: 15 dakikada bir ya da platform istediğinde
  buildStatus (u = this.kosul) {
    this._canli()
    this.kosul = u
    return this._durum(u)
  }

  // UC_SCREEN_PUSH (§11.8, ekran modu): denetim ve kalıcı seq tabanı çekirdekte (edge.js); kartlar yalnız bellekte. Uymayan zarf
  // atılır (hata kodu). Dönüş { fromId, seq, kartSayisi }; 'kartlar' yayılır
  receiveScreen (fromHex, bytes, yol) {
    this._canli()
    giris.gelenZarf({ myRole: 'cihaz', peerRole: this.L.sessionRole(hex(fromHex)), type: Z.UC_SCREEN_PUSH, bytes, L: this.L, gonderen: hex(fromHex), yol })
    const r = this.u.ekranAl(bytes, { from: yol === 'dogrudan' ? hex(fromHex) : null })
    this.emit('cards', this.cards())
    return r
  }

  // Ekranda gösterilecek kartlar (süresi geçmemiş; gönderenle). Ekran saati ve bağlantı durumunu platform kendisi gösterir
  cards () { return this.silindi ? [] : this.u.gosterilecekKartlar() }

  /**
   * Sensör olayı (§11.7, sensör modu): yerli modül eşiği aşınca çağırır. o: { sensor: 'ivme' | 'isik' | 'yakinlik' |
   * 'basinc', value (tam sayı), yerel: { gun, dk } }. Koşullar çekirdekte (edge.js: mod, sensör listesi, pencere, güncel UC_STATUS,
   * bırakma izni; dakikada birden sık olay null). Dönüş { olaylar: [{ collectionId, opId, recordId, type }], mesaj: REC_OPS }
   * ya da null; mesaj ailenin telefonlarına gider (uç olayları okuyamaz)
   */
  sensorEvent ({ sensor, value, yerel }) {
    this._canli()
    const l = this.u.sensorOlayi({ sensor, value, yerel, hlc: this.hlc.next(this.now()) })
    if (!l) return null
    return {
      olaylar: l.map(({ bytes, ...x }) => x),
      mesaj: { type: Z.REC_OPS, bytes: c.encode(recOps, { items: l.map((x) => ({ kind: 1, bytes: x.bytes })) }) }
    }
  }

  // TASK (§11.9): uç görev çalıştırmaz; dönüş gönderene gidecek TASK_REJECT { code: 'DESTEK_YOK' }
  receiveTask (fromHex, bytes, yol) {
    this._canli()
    giris.gelenZarf({ myRole: 'cihaz', peerRole: this.L.sessionRole(hex(fromHex)), type: Z.TASK, bytes, L: this.L, gonderen: hex(fromHex), yol })
    const { m } = G.decodeTask(bytes)
    return { type: Z.TASK_REJECT, bytes: G.encodeReject(gorevReddi(m.taskId)) }
  }

  // Uç defterden çıkarıldı mı (rapor gelmeden çıkarılmış olabilir, §9.2 madde 8): platform yerel verisini siler
  removed () {
    const d = this.L.devices.get(this.meHex)
    return !d || !d.active
  }

  // RETIRE_BEGIN (ebeveynden): kaldırma istendi, kalıcı yazılır; cihazın başındaki kişi onaylayınca sil({ trigger: 'emeklilik' }).
  // Dönüş ebeveyne gidecek RETIRE_LIST (uç emanet, dosya ve kasa payı tutmaz: boş)
  receiveRemoval (fromHex, bytes, yol) {
    this._canli()
    const { mesaj } = giris.gelenZarf({ myRole: 'cihaz', peerRole: this.L.sessionRole(hex(fromHex)), type: Z.RETIRE_BEGIN, bytes, L: this.L, gonderen: hex(fromHex), yol })
    if (hex(mesaj.deviceId) !== this.meHex) fail('WRONG_EDGE')
    if (!Y.ebeveynMi(this.L, hex(fromHex))) fail('UNAUTHORIZED')
    this.saklama.set(ANAHTAR_KALDIRMA, { from: hex(fromHex), t: this.now() })
    this.emit('removal', hex(fromHex))
    return c.encode(E.retireList, { holds: [], blobs: [], shares: [] })
  }

  // Bekleyen kaldırma isteği (cihazın ekranında "Havenfold verisini sil" onayı): 24 saat geçerli ve isteyen hâlâ aktif ebeveyn
  // olmalı (inceleme L2 madde 5); yoksa null
  removal () {
    if (this.silindi) return null
    const k = this.saklama.get(ANAHTAR_KALDIRMA)
    if (!k || this.now() - k.t > KALDIRMA_SURESI_MS || !Y.ebeveynMi(this.L, k.from)) return null
    return k
  }

  /**
   * Verisini sil ve raporla (§9.2 madde 4–5). Platform yerli silme adımlarını yapmış ve sonuçlarını `items` olarak verir
   * (Keystore anahtarı `anahtar-imha`, dizinler `dosya-silme`); burada ucun kendi kalıcı durumu silinir ve öğe olarak eklenir.
   * Yerli adımlarda başarılı anahtar imhası ya da veri silme yoksa yerine başarısız öğe yazılır: rapor `hata` olur (L2 madde 1).
   * Açık akışlar kapanır; kapanış bildirimleri `kapat` ile döner (alıcısına gider). Bundan sonra uç hiçbir şey kabul etmez.
   * trigger 'emeklilik': ebeveyn başlatmış olmalı (kaldirmaAl) ya da uç defterden çıkarılmış olmalı; 'kaldirma': cihazın başındaki
   * kişi uygulamayı kaldırıyor (§7.3). Android ve iOS'ta `fabrika-ayari-yapilmadi` kalıntısı eklenir. Dönüş { bytes, hash,
   * result, alicilar, kapat }: alıcılar aktif ebeveynler (çıkarılmış uçta oturum yoktur, alıcı da yok). Kimlik anahtarını
   * bellekten silmek platformun işidir (madde 6: ilk ACK ya da 10 dakika).
   */
  wipe ({ trigger, hostId, os = 'android', osVersion = '', appVersion = '', keyStore, items = [], residue = [], startedAt = null }) {
    this._canli()
    if (trigger === 'emeklilik' && !this.removal() && !this.removed()) fail('REMOVAL_NOT_REQUESTED')
    const baslangic = startedAt ?? this.now()
    const L = this.L
    // Açık akışlar kapanış bildirimiyle kapanır; sonra ucun kalıcı durumu (seq'ler, yapılandırma, kaldırma isteği) silinir
    const kapat = this.u.acikAkislar().map((a) => {
      this.u.akisKapat(a.streamId, 'BITTI')
      return { toId: a.toId, bytes: this._kapatBayt(a.streamId, 'BITTI') }
    })
    this.silindi = true
    this.u = null
    let ok = true
    try { for (const a of [U.uc.ANAHTAR, ANAHTAR_KALDIRMA, ANAHTAR_HLC]) this.saklama.set(a, null) } catch { ok = false }
    // Yerli adımlarda anahtar imhası ya da veri silme yoksa rapor "silindi" diyemez
    const yerli = [...items]
    if (!yerli.some((x) => x.method === 'anahtar-imha' && x.ok)) yerli.push({ what: 'sarma-anahtari-imhasi-bildirilmedi', method: 'anahtar-imha', ok: false })
    if (!yerli.some((x) => x.method === 'dosya-silme' && x.ok)) yerli.push({ what: 'veri-silme-bildirilmedi', method: 'dosya-silme', ok: false })
    const kalinti = new Set(residue)
    if (os === 'android' || os === 'ios') kalinti.add('fabrika-ayari-yapilmadi')
    const bytes = S.silmeRaporuKodla(L.familyId, {
      hostId: unhex(hostId), trigger, os, osVersion, appVersion, keyStore,
      items: [...yerli, { what: 'uc-durumu', method: 'dosya-silme', ok }], residue: K.KALINTI.filter((x) => kalinti.has(x)),
      startedAt: baslangic, finishedAt: Math.max(baslangic, this.now())
    }, this.me)
    const { m } = S.silmeRaporuCoz(bytes)
    const alicilar = this.removed() ? [] : L.phoneIds().filter((id) => Y.ebeveynMi(L, id)).sort()
    this.emit('wiped', m.result)
    return { bytes, hash: hex(S.silmeRaporuOzeti(bytes)), result: m.result, alicilar, kapat }
  }
}

// Kart gönderilmeden önce ekranda gösterilecek uyarı (§11.8; açıklama 2 madde 4)
const SCREEN_ALERT = Ek.UYARI

module.exports = { EDGE_COMMAND, SCREEN_ALERT, CameraApi, EdgeDevice }
