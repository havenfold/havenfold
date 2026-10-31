// SPDX-License-Identifier: Apache-2.0
// ceremony.js — yüz yüze törenin SDK yüzeyi (kurucu §6.4, RFC-0003 §2, RFC-0017 §6.3; D24)
//
// Törenin ağ akışı (davet sırrı, rendezvous, JOIN_HELLO, 5 resim, JOIN_DRAFT) platformun çekirdek paketindedir
// (worklet, Air'in kolu). SDK onu 'tasiyici' kancası olarak alır ve kuralları burada uygular: kim davet edebilir, kim
// hangi QR'ı tarayabilir, aynı anda tek tören, 5 resim. Olaylar 'ceremony' adıyla yayılır:
//   { adim: 'qr', qr, kalanSn } (60 sn'de yenilenir) · { adim: 'sas', resimler, karsiAd, karsiCihaz, aileAdi } · { adim: 'tamam', ... } · { adim: 'kapandi', neden }
// Komut numaraları Yuva Hat çizelgesindekilerdir (RFC-0024 §3a gerekçesi).
const b4a = require('b4a')
const c = require('compact-encoding')
const { joinHello: { TOREN } } = require('@havenfold/core')
const { Emitter } = require('./api')

const hex = (b) => (typeof b === 'string' ? b : b4a.toString(b, 'hex'))
function fail (code) { throw new Error(code) }

const CEREMONY_COMMAND = { INVITE_START: 3, INVITE_CONFIRM: 4, JOIN: 5, INVITE_CANCEL: 205 }
const CEREMONY_KINDS = { uye: TOREN.UYE, kutu: TOREN.KUTU, cihaz: TOREN.CIHAZ, misafir: TOREN.MISAFIR, ek_kimlik: TOREN.EK_KIMLIK }
const TUR_ADI = Object.fromEntries(Object.entries(CEREMONY_KINDS).map(([k, v]) => [v, k]))
const AILE_ROLLERI = ['ebeveyn', 'yetiskin', 'cocuk']
const QR_PREFIX = 'yuva://j/2/'
const TTL_SN = 180 // Yuva Hat policy.inviteTtlSec

// QR'ın türü: InviteQR (Yuva Hat docs/05 §2.1) ilk iki alanı { v: uint, kind: uint8 }
function qrKind (kod) {
  if (typeof kod !== 'string' || !kod.startsWith(QR_PREFIX)) fail('INVALID_QR')
  let st
  try {
    st = { start: 0, end: 0, buffer: b4a.from(kod.slice(QR_PREFIX.length), 'base64url') }
    st.end = st.buffer.byteLength
    if (c.uint.decode(st) !== 2) fail('QR_VERSION')
    const kind = c.uint8.decode(st)
    if (!TUR_ADI[kind]) fail('QR_TYPE')
    return TUR_ADI[kind]
  } catch (err) { fail(/^QR_/.test(err.message) ? err.message : 'INVALID_QR') }
}

class CeremonyApi extends Emitter {
  // ledger: defter (ailesiz uygulamada boş); me: kimlik; tasiyici: { davet({ tur, kind, rol }) → oturum, katil(kod) →
  // oturum }; oturum: { on(ad, fn), confirm(ayni), cancel(), ttlSec? } ('qr', 'sas', 'tamam', 'kapandi' olayları)
  constructor ({ ledger, me, tasiyici }) {
    super()
    this.L = ledger
    this.me = me
    this.tasiyici = tasiyici
    this._oturum = null
    this._sas = null
    this._hazirlik = false // taşıyıcı oturumu açarken (eşzamanlı ikinci tören CEREMONY_IN_PROGRESS; inceleme 13)
  }

  get _meHex () { return hex(this.me.memberId || this.me) }

  // Ana kimlik mi (ek kimlik tören yapamaz, D27) ve rolü
  _ben () {
    const L = this.L
    const m = L.members.get(this._meHex)
    if (!m || !m.active) fail('NO_IDENTITY')
    const pid = L.personIdOf(this._meHex)
    if (L.persons.get(pid)?.primary !== this._meHex) fail('SECONDARY_IDENTITY_CANNOT_JOIN')
    return L.members.get(pid).role
  }

  // Aile tarafının yetkisi: üye ve misafir daveti, kutu ve cihaz ekleme ebeveynin; kişinin kendi başka cihazı (ek
  // kimlik) kendisinin. Yetişkin üye davet edebilir (öneri ebeveyn imzasını toplar).
  _aileTarafi (tur) {
    const rol = this._ben()
    if (tur === 'ek_kimlik') return
    if (tur === 'uye' && ['ebeveyn', 'yetiskin'].includes(rol)) return
    if (rol !== 'ebeveyn') fail('UNAUTHORIZED')
  }

  // 3 INVITE_START: QR'ı bu telefon gösterir (üye ya da misafir daveti). Dönüş: { ttlSec }. Misafirde bitis (ms):
  // misafirliğin sonu (verilmezse 24 saat, en çok 90 gün; D99). Defterde görülmüş bakıcıyla tören IDENTITY_ALREADY_EXISTS ile kapanır.
  // uzaktan (D101): üye töreni uzaktan katılım olarak (ADD_MEMBER remote, 24 saat bekleme)
  async startInvite (tur, rol = null, { bitis = null, uzaktan = false } = {}) {
    if (!['uye', 'misafir'].includes(tur)) fail('INVALID_TYPE')
    if (tur === 'uye' && !AILE_ROLLERI.includes(rol)) fail('INVALID_ROLE')
    if (uzaktan && tur !== 'uye') fail('INVALID_TYPE')
    this._aileTarafi(tur)
    return this._bagla(await this._hazirla(() => this.tasiyici.davet({ tur, kind: CEREMONY_KINDS[tur], rol: tur === 'uye' ? rol : null, ...(tur === 'misafir' && bitis !== null ? { bitis } : {}), ...(uzaktan ? { uzaktan: true } : {}) })))
  }

  // Oturum açılırken başka tören başlamaz; taşıyıcı düşerse yeniden denenebilir
  async _hazirla (ac) {
    if (this._oturum || this._hazirlik) fail('CEREMONY_IN_PROGRESS')
    this._hazirlik = true
    try { return await ac() } finally { this._hazirlik = false }
  }

  // 5 JOIN: QR'ı bu telefon tarar. Kutu, cihaz ve ek kimlik QR'ında bu telefon aile tarafıdır (yetki denetlenir);
  // üye ve misafir QR'ında yeni gelendir (ailesiz uygulama da katılabilir).
  async join (kod) {
    const tur = qrKind(kod)
    if (['kutu', 'cihaz', 'ek_kimlik'].includes(tur)) this._aileTarafi(tur)
    else if (this.L.len > 0) fail('ALREADY_IN_FAMILY')
    this._bagla(await this._hazirla(() => this.tasiyici.katil(kod)))
    return { tur }
  }

  _bagla (o) {
    this._oturum = o
    this._sas = null
    const bu = (f) => (x) => { if (this._oturum === o) f(x || {}) }
    o.on('qr', bu((x) => this.emit('ceremony', { adim: 'qr', qr: x.qr, kalanSn: x.kalanSn })))
    o.on('sas', bu((x) => {
      if (!Array.isArray(x.resimler) || x.resimler.length !== 5) { o.cancel(); return this._kapandi('INVALID_CEREMONY') }
      this._sas = x.resimler
      // Karşı tarafın JOIN_HELLO'daki adı ve cihazı (D32, L20 d): kullanıcı resimlerle birlikte görür; yeni gelen
      // ailenin adını da (RFC-0036 §4.3 madde 4; aile tarafında ya da eski karşıyla null)
      this.emit('ceremony', { adim: 'sas', resimler: [...x.resimler], karsiAd: typeof x.karsiAd === 'string' ? x.karsiAd : '', karsiCihaz: typeof x.karsiCihaz === 'string' ? x.karsiCihaz : '', aileAdi: typeof x.aileAdi === 'string' ? x.aileAdi : null })
    }))
    o.on('tamam', bu((x) => { this._oturum = null; this._sas = null; this.emit('ceremony', { adim: 'tamam', ...x }) }))
    o.on('kapandi', bu((x) => this._kapandi(x.neden || 'kapandi')))
    return { ttlSec: Number.isSafeInteger(o.ttlSec) ? o.ttlSec : TTL_SN }
  }

  _kapandi (neden) {
    this._oturum = null
    this._sas = null
    this.emit('ceremony', { adim: 'kapandi', neden })
  }

  // 4 INVITE_CONFIRM: 5 resim aynı (true) ya da farklı (false); farklıysa tören kapanır
  confirm (ayni) {
    if (!this._oturum || !this._sas) fail('NO_CEREMONY')
    this._oturum.confirm(!!ayni)
    if (!ayni) { this._oturum.cancel(); this._kapandi('farkli') }
  }

  // 205 INVITE_CANCEL
  cancel () {
    if (!this._oturum) return
    this._oturum.cancel()
    this._kapandi('kullanici')
  }

  get inProgress () { return !!this._oturum || this._hazirlik }
}

module.exports = { CeremonyApi, CEREMONY_COMMAND, CEREMONY_KINDS, qrKind: qrKind, QR_PREFIX }
