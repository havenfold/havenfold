// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// local-pairing.js — aynı telefonda ikinci uygulamanın aileye katılması, §6.2 adım 6 (RFC-0017; D105)
//
//   365 ESLES_KABUL (yeni uygulama): yerel kanaldan okunan APP_PAIR_OK. LedgerApi.pairAccept nonce'u (kendi 360
//       isteğiyle aynı, 5 dakikadan genç), defteri ve olayı doğrular, APP_ATTACH'i bu kimlikle imzalar; burada olay
//       deftere uygulanır ve aile bağlanır (eşitleme başlar). Dönüş { familyId, kisiId, olay }: olay tam imzalı
//       APP_ATTACH (hex); ürün yerel kanala bırakır, eski uygulama 366'da deftere alır. Ailede kimse yeni kimliği henüz
//       tanımadığı için olay ağa ancak eski uygulamanın defteri üstünden yayılır (İstek 184).
//   366 YEREL_ESITLE (eski uygulama): (olay verilirse önce deftere alınır) aynı kişinin aynı cihaz grubundaki yeni
//       kimliğine ilk paket: defter, ortak koleksiyonların anahtarları (ve kesimleri) ve işlemleri; her biri iki
//       kimliğin çift sırrıyla APP_LOCAL_SYNC (0xEA) olarak mühürlü (RFC-0003 §6.4). Yalnız hız içindir: yeni
//       kimlik aynı verileri okuyuculardan da alır (RFC-0001 §9.4).
//   Paketi alan (yeni uygulama): yerelPaketAl — mühür açılır, iç zarf tek giriş noktasından geçer ve işlenir.
// Bunlar yalnız yerel kanaldadır; ağdan gelen APP_PAIR_REQ/OK atılır (yerelKanal.acceptOn).
const b4a = require('b4a')
const sodium = require('sodium-native')
const { giris, ledger: { T, encodeEvent, decodeEvent }, encoding: { decodeBody }, sync: S, yerelKanal: Y, pair: { pairSecret }, zarf: { Z } } = require('@havenfold/core')
const { esitleme: E, anahtar: An } = require('@havenfold/records')

const hex = (b) => (typeof b === 'string' ? b : b4a.toString(b, 'hex'))
const unhex = (h) => (typeof h === 'string' ? b4a.from(h, 'hex') : h)
function fail (code) { throw new Error(code) }
const rastgele = (n) => { const b = b4a.alloc(n); sodium.randombytes_buf(b); return b }

// Komut 365'in hata kodları (D105): nonce uyuşmazlığı ve süresi geçmiş istek INVALID_TRANSCRIPT
const KABUL_HATASI = { PAIRING_NONCE: 'INVALID_TRANSCRIPT', PAIRING_EXPIRED: 'INVALID_TRANSCRIPT' }

// kalici: ailesiz Kalici (nesneler.defter: LedgerApi.withoutFamily, 360 bunun üstünde yapılmış olmalı); aileBagla(L): start'ın
// sarmalayıcısı (eşitlemeyi başlatır; verilmezse kalici.aileBagla)
function eslesKabul (kalici, okBytes, { aileBagla = (L) => kalici.aileBagla(L) } = {}) {
  if (kalici.nesneler.aile) fail('FAMILY_EXISTS')
  let r
  try { r = kalici.nesneler.defter.pairAccept(unhex(okBytes)) } catch (err) { fail(KABUL_HATASI[err.message] || err.message) }
  const { ledger, event } = r
  ledger.apply(event)
  ledger.now = kalici.now
  aileBagla(ledger)
  const me = hex(kalici.kimlik.memberId)
  return { familyId: hex(ledger.familyId), kisiId: ledger.personIdOf(me), olay: hex(encodeEvent(event)) }
}

// Çift sırrı (RFC-0003 §6.2): iki kimliğin defterdeki anahtarlarıyla
function ciftSirri (L, kim, peerHex) {
  const p = L.members.get(peerHex)
  if (!p || !p.active) fail('NO_MEMBER')
  return pairSecret({ myUdaSecret: kim.uda.secretKey, theirUdaPub: p.udaPub, myId: kim.memberId, theirId: unhex(peerHex), familyId: L.familyId, anchorHash: L.anchorFor(kim.memberId, unhex(peerHex)) })
}

// 366: dönüş { kimlik, paketler: [{ id, kutu }] } (hex). olay: 365'in döndürdüğü APP_ATTACH (yerel kanaldan); kimlik:
// yeni kimlik (olay verilmezse)
function yerelEsitle (kalici, { olay = null, kimlik = null } = {}) {
  const n = kalici.nesneler
  if (!n.aile) fail('NO_FAMILY')
  const L = n.ledger
  if (olay) {
    const e = decodeEvent(unhex(olay))
    if (e.type !== T.APP_ATTACH) fail('PAIRING_EVENT')
    const yeni = hex(require('@havenfold/core').ledger.memberIdOf(decodeBody(T.APP_ATTACH, e.body).deviceCert.ukaPub))
    if (!L.members.has(yeni)) {
      L.apply(e) // bütün kurallar ve iki imza (ana kimlik ve yeni kimlik) defterde denetlenir
      n.replika.sync()
      n.defter.changed()
    }
    kimlik = yeni
  }
  if (!kimlik) fail('INVALID_BODY')
  const peer = hex(kimlik)
  const me = kalici.kimlik
  if (!Y.sameGroup(L, me.memberId, peer)) fail('OUT_OF_GROUP')
  const pair = ciftSirri(L, me, peer)
  const r = n.replika
  const icler = [{ type: Z.LEDGER_EVENTS, body: S.encodeEvents(S.answerReq(L, { fromSeq: 0 })) }]
  r._catchUp()
  for (const cid of E.commonCollections(r, peer)) {
    // Anahtarlar ve kesimler: okuyucu istemiş gibi (answerKeyReq yetkiyi denetler)
    const epochs = r.keys.epochList(cid).map((x) => x.epochSeq)
    if (epochs.length) {
      try {
        for (const x of r.answerKeyReq(peer, An.encodeRecKeyReq({ collectionId: unhex(cid), epochs }))) icler.push({ type: x.type, body: x.bytes })
      } catch {}
    }
    const items = [...r.ops.values()].filter((o) => o.cid === cid && o.inner).map((o) => ({ kind: o.kind, bytes: o.bytes }))
    for (const body of E.packOps(items)) icler.push({ type: Z.REC_OPS, body })
  }
  const paketler = icler.map((x) => {
    const id = rastgele(16)
    return { id: hex(id), kutu: hex(Y.sealLocalSync({ ledger: L, pair, me, peerId: unhex(peer), type: x.type, body: x.body, id })) }
  })
  sodium.sodium_memzero(pair)
  return { kimlik: peer, paketler }
}

// Yeni uygulama: 366'nın paketleri. kimlik: eski uygulamanın kimliği (aynı kişinin ana kimliği). Dönüş { islenen }
function yerelPaketAl (kalici, { kimlik, paketler }) {
  const n = kalici.nesneler
  if (!n.aile) fail('NO_FAMILY')
  const L = n.ledger
  const peer = hex(kimlik)
  const me = kalici.kimlik
  const pair = ciftSirri(L, me, peer)
  const r = n.replika
  let islenen = 0
  try {
    for (const p of Array.isArray(paketler) ? paketler : []) {
      const m = Y.openLocalSync({ ledger: L, pair, me, peerId: unhex(peer), box: unhex(p.kutu), id: unhex(p.id) })
      const mesaj = giris.gelenZarf({ myRole: 'uye', peerRole: L.sessionRole(peer), type: m.type, bytes: m.body, L, gonderen: peer, yol: 'dogrudan' }).mesaj
      if (m.type === Z.LEDGER_EVENTS) { S.ingest(L, mesaj); r.sync(); n.defter.changed() } else if (m.type === Z.REC_KEY) r.receiveKey(m.body)
      else if (m.type === Z.REC_CUTOFF) r.receiveCutoff(m.body)
      else if (m.type === Z.REC_OPS) E.onOps(r, m.body)
      else continue
      islenen++
    }
  } finally { sodium.sodium_memzero(pair) }
  if (n.kayit) n.kayit.sync()
  return { islenen }
}

module.exports = { eslesKabul, yerelEsitle, yerelPaketAl, KABUL_HATASI }
