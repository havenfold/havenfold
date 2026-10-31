// SPDX-License-Identifier: Apache-2.0
// disaster.js — afet modu arayüzü (RFC-0012 §3, §5, §7–§9, §13): durum, elle aç ve kapat, 72 saat sorusu, ayar, mesaj gönderme,
// gelen ve giden mesajlar, yakındaki aile cihazları, etiket listesi ve bağ oturumu. Çekirdek komutları 310–319 (worklet).
//
// Bluetooth, Wi-Fi Direct ve Multipeer köprüleri ürünün yerel modülündedir: modül reklam ve taramayı yapar, AFET_TAGS'i
// etiketler() ile alır, okuduğu listeyi eslestir() ile çözer, açtığı bayt akışını baglan()'a verir (komut 317). Güç, pil,
// sensör ve internet durumu sinyal() ile gelir (komut 316); durum makinesi tik() ile ilerler.
const b4a = require('b4a')
const {
  mesaj: M, durum: S, depo: { Depo }, motor: { Motor }, yerel: Y, denetim: D
} = require('@havenfold/disaster')
const { pairs: { PairBook } } = require('@havenfold/core')
const { Emitter } = require('./api')

const hex = (b) => (typeof b === 'string' ? b : b4a.toString(b, 'hex'))
const unhex = (h) => (typeof h === 'string' ? b4a.from(h, 'hex') : h)
function fail (code) { throw new Error(code) }

// RFC-0012 §13: çekirdek komutları (worklet aralığı 310–319; SDK kanal tablosunda değil)
const DISASTER_COMMAND = {
  DISASTER_STATE: 310, DISASTER_SET: 311, DISASTER_SEND: 312, DISASTER_INBOX: 313, DISASTER_NEARBY: 314, DISASTER_SETTINGS: 315, DISASTER_SIGNAL: 316,
  DISASTER_LINK: 317, DISASTER_TAGS_GET: 318, DISASTER_CLEAR: 319
}
const TUR = { metin: M.KIND.METIN, iyiyim: M.KIND.IYIYIM, sos: M.KIND.SOS, uyari: M.KIND.UYARI, alindi: M.KIND.ALINDI }
const TUR_ADI = Object.fromEntries(Object.entries(TUR).map(([k, v]) => [v, k]))
const DURUM_ADI = { KAPALI: 'kapali', HAZIR: 'hazir', ETKIN: 'etkin' }
const ANAHTAR = 'afet/hal'

class DisasterApi extends Emitter {
  /**
   * o: { me (kimlik: memberId, signKeyPair, deviceCert), defter: () => Ledger, saklama?: { get, set }, saat?, izin?: () => bool }
   * `izin`: platform izinleri (Bluetooth, yakındaki cihazlar) verilmiş mi; yoksa ac() açmaz.
   */
  // bagCekirdegi (RFC-0012 §6.5; D104): { yukseltmeIste (bag) → teklif | null | Promise (grup sahibi: bağı başlatmayan),
  // yukseltmeGeldi (bag, teklif) (başlatan) }; bag: { kimlik (karşı), bag ('bluetooth') }. Verilmezse yükseltme yok
  constructor ({ me, defter, saklama = null, saat = Date.now, izin = () => true, bagCekirdegi = null }) {
    super()
    this.bagCekirdegi = bagCekirdegi
    this._aktifBaglar = new Map() // karşı kimlik → yükseltme kancası (açık Bluetooth bağı)
    this.me = me
    this.defter = defter
    this.saklama = saklama
    this.saat = saat
    this.izin = izin
    this.depo = new Depo({ saklama })
    // Saklama, kalıcı durum yazılmadan önce bekleyen depo yazımını isteyebilir (worklet Kalici.afetSaklama)
    if (saklama && typeof saklama.kaydetmedenOnce === 'function') saklama.kaydetmedenOnce(() => this.depo.kaydet())
    this.etiketKaynagi = new Y.EtiketKaynagi()
    this.motor = new Motor({ meId: me.memberId, defter, ciftler: () => this._ciftler(), depo: this.depo, saat, pil: () => this.s.pil })
    this.s = {
      d: { durum: 'KAPALI', etkinBas: null, elle: false, soru: false }, baslangic: null, hazirDk: S.VARSAYILAN.esikDk,
      internetYok: null, internetVar: null, isaret: null, pil: null, dugum: null, okunan: [], yakin: {}
    }
    this._bekleyen = { kullanici: null, yazdi: false, yerelMesaj: false, surdur: null, uyari: false }
    const j = saklama && saklama.get(ANAHTAR)
    if (j && j.v === 1) this.s = { ...this.s, ...j.s }
  }

  _ciftler () {
    return new PairBook({ me: this.me, ledger: this.defter(), now: this.saat }).peers().map((p) => ({ id: p.id, pair: p.pair }))
  }

  _kaydet () { if (this.saklama) this.saklama.set(ANAHTAR, { v: 1, s: this.s }) }

  // --- durum (310, 311, 315, 316) ---

  /** 310 DISASTER_STATE */
  state () {
    const bugun = this.motor.bugun()
    // Normal yola verilen (§8.4) bekleyen sayılmaz: internet dönünce cihaz KAPALI'ya inebilir
    const bekleyen = [...this.depo.giden.values()].filter((x) => !x.teslim && !x.normal && x.m.expiresDay >= bugun).length
    const okunan = new Set(this.s.okunan)
    const yeni = this.depo.gelen.filter((x) => x.ic.kind !== M.KIND.ALINDI && !okunan.has(x.mid)).length
    return {
      durum: DURUM_ADI[this.s.d.durum], baslangic: this.s.baslangic, elle: this.s.d.elle, soru: this.s.d.soru,
      internetYok: this.s.internetYok, pil: this.s.pil, bekleyen, yeni, tasinan: this.depo.tasinan.size
    }
  }

  /** 311 DISASTER_SET: elle aç. Platform izni yoksa açılmaz */
  enable () {
    if (!this.izin()) return { acildi: false, neden: 'izin' }
    this._bekleyen.kullanici = 'ac'
    this.tick()
    return { acildi: true }
  }

  /** 311 DISASTER_SET: elle kapat ya da HAZIR'a in. Kapatılınca önceki işaret (deprem, SOS) yeniden açmaz */
  close (hedef = 'kapali') {
    if (hedef !== 'kapali' && hedef !== 'hazir') fail('DISASTER_TARGET')
    this.s.isaret = null
    if (hedef === 'kapali') { this._bekleyen.kullanici = 'kapat'; return this.tick() }
    this._gec({ durum: 'HAZIR', etkinBas: null, elle: false, soru: false })
    return this.state()
  }

  /** 72 saat sorusunun cevabı */
  keepOn (evet) { this._bekleyen.surdur = !!evet; return this.tick() }

  /** 315 DISASTER_SETTINGS */
  settings () { return { hazirDk: this.s.hazirDk } }
  configure ({ hazirDk } = {}) {
    if (hazirDk != null) {
      if (!Number.isInteger(hazirDk) || hazirDk < 10 || hazirDk > 120) fail('INVALID_DISASTER_SETTINGS')
      this.s.hazirDk = hazirDk
    }
    this._kaydet()
    return this.settings()
  }

  /** 316 DISASTER_SIGNAL: { internet?: bool, pil?: yüzde | null (prizde), dugum?: { pilde, sensor, prizde } } */
  signal ({ internet, pil, dugum } = {}) {
    const simdi = this.saat()
    if (internet === false && this.s.internetYok == null) { this.s.internetYok = simdi; this.s.internetVar = null }
    if (internet === true && this.s.internetYok != null) {
      this.s.internetYok = null
      this.s.internetVar = simdi
      this.emit('disaster', { type: 'internet-dondu' })
    }
    if (pil !== undefined) this.s.pil = pil // null: prizde, pil kuralları uygulanmaz (RFC-0012 açıklama 2 madde 3)
    if (dugum !== undefined) this.s.dugum = dugum
    return this.tick()
  }

  /** Durum makinesini ilerlet (§5.2); zamanlayıcıyla ya da sinyalden sonra çağrılır */
  tick () {
    const b = this._bekleyen
    const once = this.s.d
    const g = {
      simdi: this.saat(), internetYok: this.s.internetYok, internetVar: this.s.internetVar, isaret: this.s.isaret,
      kullanici: b.kullanici, yazdi: b.yazdi, yerelMesaj: b.yerelMesaj, dugum: this.s.dugum, bekleyen: this.state().bekleyen,
      surdur: b.surdur, esikDk: this.s.hazirDk, uyari: b.uyari
    }
    this._bekleyen = { kullanici: null, yazdi: false, yerelMesaj: false, surdur: null, uyari: false }
    // Depo günde bir temizlenir: süresi geçen taşınan ve giden, 7 günden eski teslim, görülen ve gelen (Codex 6. tur: ürün
    // temizliği hiç çağrılmıyordu)
    const bugun = this.motor.bugun()
    if (this.s.temizGun !== bugun) { this.depo.temizle(bugun); this.s.temizGun = bugun }
    const d = S.gecis(once, g)
    this._gec(d)
    if (d.soru && !once.soru) this.emit('disaster', { type: 'sursun-mu' })
    return this.state()
  }

  _gec (d) {
    const degisti = d.durum !== this.s.d.durum
    this.s.d = d
    if (degisti) this.s.baslangic = this.saat()
    this._kaydet()
    if (degisti) this.emit('disaster', { type: 'durum', hal: this.state() })
  }

  // --- mesajlar (312, 313, 319) ---

  /**
   * 312 DISASTER_SEND: her alıcı için ayrı mühürlenir. tur: 'metin' | 'iyiyim' | 'sos' | 'uyari' (yalnız bağlı cihaz).
   * konum yaklaşığa yuvarlanır (İYİYİM, METİN); { tamKonum: true } yuvarlamaz. SOS yuvarlanmaz.
   * Dönüş: mid'ler (hex), alıcı sırasıyla. Hata: INVALID_DISASTER_KIND, NO_DISASTER_RECEIVER, DISASTER_CANNOT_SEND, NO_DISASTER_PAIR, DISASTER_SEND_LIMIT, INVALID_DISASTER_*
   */
  send (tur, alicilar, metin = '', konum = null, { tamKonum = false, alarm = null } = {}) {
    const kind = TUR[tur]
    if (!kind || kind === M.KIND.ALINDI) fail('INVALID_DISASTER_KIND')
    if (!Array.isArray(alicilar) || !alicilar.length) fail('NO_DISASTER_RECEIVER')
    const mids = this.motor.gonderHepsi(alicilar.map(unhex), { kind, text: metin, konum: konum ?? undefined, tam: tamKonum, alarm: alarm ?? undefined, battery: this.s.pil ?? undefined }).map((r) => r.mid)
    if (kind === M.KIND.SOS) this.s.isaret = this.saat()
    if (this.s.d.durum === 'HAZIR') this._bekleyen.yazdi = true
    this.tick()
    return mids
  }

  // Giden mid'in geçerli ALINDI'sı: yalnız o mesajın alıcısından (ALINDI'nın göndereni = gidenin to'su; motor teslimi aynı
  // kuralla işaretler). Başka üyenin aynı ref'li ALINDI'sı sayılmaz (Codex 6. tur: sahte alındı)
  _alindi (mid, g) {
    return this.depo.gelen.find((x) => x.ic.kind === M.KIND.ALINDI && x.ic.ref && hex(x.ic.ref) === mid && hex(x.ic.from) === g.to) || null
  }

  /** 313 DISASTER_INBOX: gelen ve giden mesajlar, en yeni önce. ALINDI ayrı mesaj olarak değil, gidenin durumu olarak görünür */
  messages () {
    const okunan = new Set(this.s.okunan)
    const out = []
    for (const x of this.depo.gelen) {
      if (x.ic.kind === M.KIND.ALINDI) continue
      out.push({
        mid: x.mid, tur: TUR_ADI[x.ic.kind], yon: 'gelen', kimlik: hex(x.ic.from), at: x.ic.at, metin: x.ic.text, konum: x.ic.konum ?? null,
        alarm: x.ic.alarm ? { ...x.ic.alarm, nearby: x.ic.alarm.nearby.map(hex) } : null, pil: x.ic.battery ?? null,
        durum: x.dogrudan ? 'dogrudan' : 'tasindi', okundu: okunan.has(x.mid)
      })
    }
    for (const [mid, x] of this.depo.giden) {
      if (x.kind === M.KIND.ALINDI) continue
      const g = { mid, tur: TUR_ADI[x.kind], yon: 'giden', kimlik: x.to, at: x.at, durum: x.teslim || this._alindi(mid, x) ? 'alindi' : 'yolda' }
      if (x.normal) g.normalYoldan = 'gitti'
      out.push(g)
    }
    return out.sort((a, b) => b.at - a.at)
  }

  // RFC-0037 §7: giden bir mid'in alıcısı ve ALINDI'sı: { kimlik, alindi, at } (at: ALINDI'nın anı; yalnız AFET_DONE geldiyse
  // null) ya da mid bilinmiyorsa null
  receiptOf (mid) {
    const g = this.depo.giden.get(mid)
    if (!g || g.kind === M.KIND.ALINDI) return null
    const a = this._alindi(mid, g)
    return { kimlik: g.to, alindi: !!(a || g.teslim), at: a ? a.ic.at : null }
  }

  markRead (mid) {
    if (!this.s.okunan.includes(mid)) this.s.okunan.push(mid)
    this.s.okunan = this.s.okunan.slice(-1000)
    this._kaydet()
  }

  /**
   * §8.4 normal yol dönünce: teslim edilmemiş kendi mesajları (ALINDI'lar dahil), olağan oturumla ya da emanetle (RFC-0003
   * §6.4 mührüyle) gönderilmek üzere. Dönüş: [{ to, mid, tur: 0xB0, govde }]
   */
  handToNormalPath () {
    const out = this.motor.normalYolaVer()
    this.tick()
    return out
  }

  /**
   * §8.4: olağan oturumdan ya da emanetten gelen AFET_MSG gövdesi. Dönüş: { gecerli, mid? , neden? }. Aynı mid afet
   * bağından ya da normal yoldan önceden geldiyse bir kez işlenir (neden: REPLAY)
   */
  takeFromNormalPath (govde) {
    const r = this.motor.normalYoldanAl(govde)
    if (!r.gecerli) return { gecerli: false, neden: r.neden }
    this._gelen({ mid: r.mid, ic: r.ic })
    return { gecerli: true, mid: r.mid }
  }

  /**
   * Normal yol (RFC-0031 §8.4, RFC-0012 §8.4; D104): worklet'in ürün zarfı kancalarına (c.urunZarfi, c.zarfGonder; kalıcı
   * kuyruk, alıcı aktif üye telefonu) bağlanır. Gelen AFET_MSG giriş noktasından geçip normalYoldanAl'a gider. Dönüş
   * { gonder () → sayı }: internet dönünce teslim edilmemiş kendi mesajlarını öncelik sırasıyla (SOS önce) normal yolun kalıcı
   * kuyruğuna verir (önceden verilmiş olanı yeniden vermez); yalnız kuyruğa giren mesaj `normal` işaretlenir. Kuyruk doluysa (QUEUE_FULL) kalanlar afet yolunda
   * bekler ve sonraki gonder() çağrısında yeniden denenir; hiçbir mesaj sessizce düşmez (Codex 7. tur).
   */
  setupNormalPath ({ urunZarfi, zarfGonder }) {
    const { giris } = require('@havenfold/core')
    urunZarfi(M.Z.AFET_MSG, (p, bytes, yol, rol) => {
      giris.gelenZarf({ myRole: 'uye', peerRole: rol, type: M.Z.AFET_MSG, bytes, L: this.defter(), gonderen: hex(p), yol })
      const r = this.takeFromNormalPath(bytes)
      if (!r.gecerli && r.neden !== 'REPLAY') throw new Error(r.neden || 'INVALID_DISASTER') // tekrar sessizce düşer
    })
    return {
      gonder: () => {
        let n = 0
        for (const x of this.motor.normalYolaVer({ isaretle: false })) {
          if (this.depo.giden.get(x.mid)?.normal) continue // zaten kalıcı kuyrukta ya da gitti
          try {
            zarfGonder(x.to, x.tur, x.govde, x.mid)
          } catch (err) {
            if (err && err.message === 'QUEUE_FULL') break // kalanlar sonraki çağrıda
            continue // alıcı üye telefonu değilse (ör. misafir) afet bağında kalır
          }
          this.motor.normalIsaretle(x.mid)
          n++
        }
        this.tick()
        return n
      }
    }
  }

  /** Uygulamanın kendi yükseltme teklifi (RFC-0012 §6.5): açık Bluetooth bağına AFET_LINK_UP. Dönüş: gönderildi mi */
  upgradeOffer (bag, teklif) {
    const k = this._aktifBaglar.get(hex(bag && bag.kimlik ? bag.kimlik : bag))
    return !!k && k.gonder(teklif)
  }

  // --- Yuva Kutusu: işçinin UYARI'sı ve kutunun çapa davranışı (RFC-0012 §10, §17 adım 8; D88) ---

  /**
   * İşçi (bağlı cihaz): deprem ya da elektrik UYARI'sını her aile telefonuna ayrı mühürler (misafire ve kutuya değil; Acil
   * 05 §3). o: { tur: 'deprem' | 'elektrik', seviye (deprem: sensör ölçeğinde, elektrik: 0), yakindakiler: kimlik hex[]
   * (işçinin kendi son 10 dk'daki yerel oturumları; H4), metin? }. Pil sinyali varsa iç alana girer.
   * Dönüş: { mids, govdeler: [{ to, rol, mid, govde }] } — govdeler kutuya olağan yerel oturumla bırakılır (AFET_MSG).
   */
  sendAlert ({ tur, seviye = 0, yakindakiler = [], metin = null }) {
    if (tur !== 'deprem' && tur !== 'elektrik') fail('DISASTER_ALERT_TYPE')
    if (!Number.isInteger(seviye) || seviye < 0) fail('DISASTER_FIELD_ALARM')
    const L = this.defter()
    const alicilar = this._ciftler().map((c) => hex(c.id)).filter((k) => D.kimlikTuru(L, k) === 'telefon')
    if (!alicilar.length) fail('NO_DISASTER_RECEIVER')
    const alarm = { kind: tur, level: seviye, nearby: yakindakiler.map(unhex) }
    const mids = this.send('uyari', alicilar, metin ?? tur, null, { alarm })
    const govdeler = mids.map((mid) => {
      const g = this.depo.giden.get(mid)
      return { to: g.to, rol: L.members.get(g.to)?.role ?? null, mid, govde: M.kodla(M.Z.AFET_MSG, g.m) }
    })
    return { mids, govdeler }
  }

  /**
   * Kutu: işçinin olağan yerel oturumla bıraktığı UYARI (AFET_MSG gövdesi). Taşınır ve kutu ETKİN'e geçer (§10 adım 3).
   * kaynak doğrulanmış oturumun karşı tarafıdır (HELLO; çağıran taşıyıcı verir). Yalnız kutuda (inceleme 24 madde 3).
   */
  fromWorker (govde, kaynak) {
    if (this.motor.tur !== 'kutu') return { tasindi: false, neden: 'NOT_BOX' }
    const r = this.motor.tasimayaAl(govde, hex(kaynak))
    if (r.tasindi) { this._bekleyen.uyari = true; this.tick() }
    return r
  }

  /** Telefon: gelen deprem ve elektrik uyarıları (Acil A46, A47), en yeni önce */
  alerts () {
    return this.messages().filter((m) => m.yon === 'gelen' && m.tur === 'uyari' && m.alarm).map((m) => ({
      mid: m.mid, tur: m.alarm.kind, seviye: m.alarm.level, evdekiler: m.alarm.nearby, zaman: m.at, pil: m.pil, kimlik: m.kimlik, okundu: m.okundu
    }))
  }

  /** Taşınan mesaj sayısı ve boyu (içerik açılamaz) */
  relayed () { return { adet: this.depo.tasinan.size, bayt: this.depo.boy() } }

  /** 319 DISASTER_CLEAR: taşıyıcı deposunu boşalt */
  clear () { this.depo.bosalt(); return this.relayed() }

  // --- keşif ve bağ (314, 317, 318) ---

  /** 318 DISASTER_TAGS_GET: reklam için etiket listesi; port verilirse yerel ağ duyurusu da */
  tags ({ port = null } = {}) {
    // Açıklama 2 madde 1: dilim boyunca aynı liste (Bluetooth TAGS ve yerel ağ duyurusu ortak)
    const liste = this.etiketKaynagi.liste({ ciftler: this._ciftler(), meId: this.me.memberId, simdi: this.saat() })
    return { liste, bayt: M.kodla(M.Z.AFET_TAGS, liste), duyuru: port ? Y.duyuruKodla(liste, port) : null }
  }

  /** Taranan cihazın etiket listesi (bayt) ya da yerel ağ duyurusu: eşleşen aile kimliği ya da null */
  match ({ bayt = null, duyuru = null }) {
    let liste
    let port = null
    try {
      if (duyuru) ({ liste, port } = Y.duyuruCoz(duyuru))
      else liste = M.coz(M.Z.AFET_TAGS, bayt)
    } catch { return null }
    const r = Y.eslestir({ liste, ciftler: this._ciftler(), simdi: this.saat() })
    return r ? { kimlik: hex(r.cift.id), dilim: r.dilim, port } : null
  }

  /** Aynı komşuyla eşitleme gerekli mi (§9.2: yeni mesaj yoksa 5 dakikada bir) */
  syncNeeded (kimlik) { return this.motor.esitlemeGerekli(unhex(kimlik)) }

  /**
   * 317 DISASTER_LINK: yerel modülün açtığı bayt akışında bağ oturumu (§6.3, açıklama 1 madde 2). Bağlanan eslestir()'in
   * sonucunu (eslesme: { kimlik, dilim }) verir; karşılayan bağlananı bilmez, etiketten bulur.
   * bag: 'bluetooth' | 'wifi-direct' | 'multipeer' | 'yerel'. Afet bağında eşitleme yapılır ve bağ kapanır:
   * { bitti, kapandi, alinan }. Yerel ağda HELLO'dan sonraki olağan oturum döner (BagOturumu); çekirdeğin oturum katmanı devralır.
   */
  async connect ({ ham, baslatan, eslesme = null, bag }) {
    const ciftler = this._ciftler()
    const o = { ham, baslatan, me: this.me, L: this.defter(), bag }
    if (baslatan) {
      const cift = eslesme && ciftler.find((x) => hex(x.id) === hex(eslesme.kimlik))
      if (!cift) { ham.destroy?.(); fail('NO_DISASTER_PAIR') }
      o.eslesme = { cift, dilim: eslesme.dilim }
    } else {
      o.ciftler = ciftler
      o.simdi = this.saat()
    }
    const b = await Y.bagKur(o)
    this._yakin(b.karsi, bag)
    if (bag === Y.BAG.YEREL) return b
    const bc = this.bagCekirdegi
    const bagBilgi = { kimlik: b.karsi, bag }
    const yukseltme = bc ? {
      iste: () => (typeof bc.yukseltmeIste === 'function' ? bc.yukseltmeIste(bagBilgi) : null),
      geldi: (teklif) => { if (typeof bc.yukseltmeGeldi === 'function') bc.yukseltmeGeldi(bagBilgi, teklif) }
    } : { iste: () => null, geldi: () => {} }
    this._aktifBaglar.set(b.karsi, yukseltme)
    let r
    try { r = await Y.afetEsitle(b, this.motor, { yukseltme }) } finally { this._aktifBaglar.delete(b.karsi) }
    this._yakin(b.karsi, bag)
    for (const x of r.alinan) this._gelen(x)
    if (r.alinan.length) { this._bekleyen.yerelMesaj = true; this.tick() }
    return r
  }

  _gelen (x) {
    if (x.ic.kind === M.KIND.SOS || (x.ic.kind === M.KIND.UYARI && x.ic.alarm?.kind === 'deprem')) this.s.isaret = this.saat()
    const m = this.messages().find((y) => y.mid === x.mid)
    if (m) this.emit('disaster', { type: 'mesaj', mesaj: m })
  }

  _yakin (kimlik, bag) {
    this.s.yakin[kimlik] = { bag, son: this.saat() }
    this._kaydet()
  }

  /** 314 DISASTER_NEARBY: son 15 dakikada bağ kurulan aile cihazları */
  nearby () {
    const L = this.defter()
    const simdi = this.saat()
    return Object.entries(this.s.yakin).filter(([, x]) => simdi - x.son < Y.YOK_SAY_MS).map(([kimlik, x]) => ({
      kimlik, tur: D.kimlikTuru(L, kimlik), bag: x.bag, sonEsitleme: x.son
    })).filter((x) => x.tur)
  }
}

module.exports = { DisasterApi, DISASTER_COMMAND, DISASTER_KIND: TUR }
