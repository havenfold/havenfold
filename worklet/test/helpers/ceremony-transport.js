// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Tören taşıyıcısının test kancası (D34): CeremonyApi'nin beklediği { davet, katil } yüzeyi, süreçler arası boru üstünde.
//
// Gerçek tören taşıyıcısı (HyperDHT'de davet sırrı ve rendezvous, mühürlü JOIN_HELLO, 5 resim) Yuva Hat'tadır ve bu
// pakette değildir (D32 notu a). Bu kanca yalnız testtedir: zarflar düz gider, QR yalnız sahibin kimliğini ve bir
// rastgele sayı taşır. Defter tarafı gerçektir: JOIN_HELLO çekirdeğin kodlamasıyla ve kanonik çözmeyle, yetenek bitleri
// checkJoinCaps ile denetlenir; ADD_MEMBER davet edenin ve yeni gelenin imzasıyla çekirdeğin öneri defterinden uygulanır,
// yeni gelen defteri JOIN_LEDGER ile alıp aileBagla ile bağlar.
//   QR'ı gösteren: üye davetinde aile tarafı (3 INVITE_START), kutu töreninde kutu (kutuDavet)
//   QR'ı tarayan: üye davetinde yeni gelen (5 JOIN), kutu töreninde aile tarafı (5 JOIN)
'use strict'
const b4a = require('b4a')
const c = require('compact-encoding')
const sodium = require('sodium-native')
const { kdf, ledger: { Ledger, T, encodeEvent, decodeEvent, eventHash }, joinHello: J, hello: { CAPS }, sync: S } = require('@havenfold/core')

const hex = (b) => (typeof b === 'string' ? b : b4a.toString(b, 'hex'))
const ONEK = 'yuva://j/2/'
const Z = { JOIN_HELLO: 0x08, JOIN_LEDGER: 0x09, JOIN_DRAFT: 0x0a, JOIN_SIG: 0x0b }
const TOREN_TURLERI = new Set(Object.values(Z))
const qrYapi = { preencode (s, m) { c.uint.preencode(s, 2); c.uint8.preencode(s, m.kind); c.fixed(16).preencode(s, m.sahip); c.fixed32.preencode(s, m.nonce) }, encode (s, m) { c.uint.encode(s, 2); c.uint8.encode(s, m.kind); c.fixed(16).encode(s, m.sahip); c.fixed32.encode(s, m.nonce) }, decode (s) { c.uint.decode(s); return { kind: c.uint8.decode(s), sahip: c.fixed(16).decode(s), nonce: c.fixed32.decode(s) } } }
const CAPS_TAM = CAPS.LEDGER_V21 | CAPS.KAYIT | CAPS.GOREV | CAPS.COKLU_UYGULAMA

function rastgele (n) { const b = b4a.alloc(n); sodium.randombytes_buf(b); return b }

class Oturum {
  constructor () { this.f = new Map(); this.ttlSec = 180; this.onaylandi = null; this.iptal = false }
  on (ad, fn) { if (!this.f.has(ad)) this.f.set(ad, []); this.f.get(ad).push(fn) }
  emit (ad, x) { for (const fn of this.f.get(ad) || []) fn(x) }
  confirm (ayni) { this.onaylandi = !!ayni; if (this.onay) this.onay(this.onaylandi) }
  cancel () { this.iptal = true }
}

// cihaz(): { kimlik, ledger (null: ailesiz), defter, aileBagla(L), now, ad, cihazAdi }; gonder(peerHex, type, bytes)
function torenTasiyici ({ cihaz, gonder }) {
  let o = null // { oturum, nonce, rol: 'gosteren' | 'tarayan', aile: boolean, kind, rol, karsi, helloBen, helloKarsi, taslak, transkript }

  const benimHello = (nonce) => {
    const d = cihaz()
    const eph = rastgele(32)
    return c.encode(J.joinHello, { cert: d.kimlik.deviceCert, name: d.ad, device: d.cihazAdi, eph, mac: kdf.hash('hf/test-toren/mac', nonce, eph), caps: CAPS_TAM })
  }

  function sas () {
    const ilk = o.rol === 'gosteren' ? o.helloBen : o.helloKarsi
    const ikinci = o.rol === 'gosteren' ? o.helloKarsi : o.helloBen
    o.transkript = kdf.hash('hf/test-toren/transkript', o.nonce, ilk, ikinci)
    const m = J.decodeJoinHello(o.helloKarsi)
    o.karsiCert = m.cert
    o.karsiAd = m.name
    o.oturum.emit('sas', { resimler: [...o.transkript.subarray(0, 5)].map((x) => x % 64), karsiAd: m.name, karsiCihaz: m.device })
    if (o.aile) J.checkJoinCaps(cihaz().ledger, m.caps)
  }

  // Aile tarafı: kullanıcı onaylayınca ADD_MEMBER taslağı (davet edenin imzasıyla) yeni gelene
  function taslakGonder () {
    const d = cihaz()
    const rol = o.kind === J.TOREN.KUTU ? 'kutu' : o.uyeRol
    const r = d.defter.addMember({ deviceCert: o.karsiCert, displayName: o.karsiAd, role: rol, ceremonyTranscriptHash: o.transkript })
    if (r.durum !== 'oneri') throw new Error('INVALID_CEREMONY')
    o.oneriId = r.oneriId
    o.taslak = encodeEvent(r.event)
    gonder(o.karsi, Z.JOIN_DRAFT, o.taslak)
  }

  // Yeni gelen: kendi onayından sonra taslağı imzalar
  function taslakImzala () {
    const d = cihaz()
    const e = decodeEvent(o.taslak)
    if (e.type !== T.ADD_MEMBER) throw new Error('INVALID_CEREMONY')
    const { signEvent } = require('@havenfold/core').ledger
    signEvent(e, d.kimlik)
    gonder(o.karsi, Z.JOIN_SIG, encodeEvent(e))
  }

  function kapat (neden) { const s = o && o.oturum; o = null; if (s) s.emit('kapandi', { neden }) }

  const api = {
    TOREN_TURLERI,

    // 3 INVITE_START: QR'ı aile tarafı gösterir
    async davet ({ kind, rol }) {
      const nonce = rastgele(32)
      o = { oturum: new Oturum(), nonce, rol: 'gosteren', aile: true, kind, uyeRol: rol }
      const qr = ONEK + b4a.toString(c.encode(qrYapi, { kind, sahip: cihaz().kimlik.memberId, nonce }), 'base64url')
      setTimeout(() => o && o.oturum.emit('qr', { qr, kalanSn: 60 }), 0)
      o.oturum.onay = (ayni) => { if (ayni && o.helloKarsi) taslakGonder() }
      return o.oturum
    },

    // Kutu: QR'ı kutu gösterir; kutunun ekranı yoktur, 5 resmi aile tarafında kişi karşılaştırır (kendiliğinden onay)
    kutuDavet () {
      const nonce = rastgele(32)
      o = { oturum: new Oturum(), nonce, rol: 'gosteren', aile: false, kind: J.TOREN.KUTU, kendiliginden: true }
      o.oturum.onaylandi = true
      return ONEK + b4a.toString(c.encode(qrYapi, { kind: J.TOREN.KUTU, sahip: cihaz().kimlik.memberId, nonce }), 'base64url')
    },

    // 5 JOIN: QR'ı tarayan; kutu QR'ında aile tarafıdır
    async katil (kod) {
      const q = c.decode(qrYapi, b4a.from(kod.slice(ONEK.length), 'base64url'))
      const aile = !!cihaz().ledger
      o = { oturum: new Oturum(), nonce: q.nonce, rol: 'tarayan', aile, kind: q.kind, karsi: hex(q.sahip) }
      o.helloBen = benimHello(q.nonce)
      o.oturum.onay = (ayni) => { if (!ayni) return; if (o.aile && o.helloKarsi) taslakGonder(); else if (!o.aile && o.taslak) taslakImzala() }
      gonder(o.karsi, Z.JOIN_HELLO, o.helloBen)
      return o.oturum
    },

    // Boru taşıyıcısından gelen tören zarfı
    al (fromHex, type, bytes) {
      if (!o) return
      try {
        if (type === Z.JOIN_HELLO) {
          J.decodeJoinHello(bytes) // kanonik çözme
          o.helloKarsi = b4a.from(bytes)
          if (o.rol === 'gosteren') {
            o.karsi = hex(fromHex)
            o.helloBen = benimHello(o.nonce)
            gonder(o.karsi, Z.JOIN_HELLO, o.helloBen)
          }
          sas()
          return
        }
        if (hex(fromHex) !== o.karsi) return
        if (type === Z.JOIN_DRAFT && !o.aile) {
          o.taslak = b4a.from(bytes)
          if (o.oturum.onaylandi) taslakImzala()
          return
        }
        if (type === Z.JOIN_SIG && o.aile) {
          const d = cihaz()
          const e = decodeEvent(bytes)
          if (!b4a.equals(eventHash(e), eventHash(decodeEvent(o.taslak)))) throw new Error('INVALID_CEREMONY')
          const id = d.defter.oneriler.add(e, d.now())
          if (id !== o.oneriId || d.defter.oneriler.tryApply(id) !== 'applied') throw new Error('INVALID_CEREMONY')
          d.defter.changed()
          gonder(o.karsi, Z.JOIN_LEDGER, S.encodeEvents(S.answerReq(d.ledger, { fromSeq: 0 })))
          const s = o.oturum
          const memberId = hex(o.karsiCert.ukaPub ? require('@havenfold/core').ledger.memberIdOf(o.karsiCert.ukaPub) : b4a.alloc(16))
          o = null
          s.emit('tamam', { memberId })
          return
        }
        if (type === Z.JOIN_LEDGER && !o.aile) {
          const d = cihaz()
          const m = S.decodeEvents(bytes)
          const L = new Ledger({ now: d.now })
          const r = S.ingest(L, { fromSeq: 0, events: m.events })
          if (r.needFrom !== undefined || !L.members.get(hex(d.kimlik.memberId))) throw new Error('INVALID_CEREMONY')
          d.aileBagla(L)
          const s = o.oturum
          o = null
          s.emit('tamam', { memberId: hex(d.kimlik.memberId) })
        }
      } catch (err) {
        kapat(err.message)
      }
    }
  }
  return api
}

module.exports = { torenTasiyici, TOREN_TURLERI }
