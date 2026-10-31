// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// protocol/vectors/bridge.json üreticisi (RFC-0005 §18 vektör 18, D46): KOPRU kodlaması, taşıma metni ve alan
// uygulamanın kararları. Girdiler elle kurulur (rastgelelik yok); beklenen sonuçlar elle yazılır, üretici hesapladığını
// beklenenle karşılaştırır.
const b4a = require('b4a')
const c = require('compact-encoding')
const K = require('../../protocol/bridge')

const hex = (b) => b4a.toString(b, 'hex')
const AT = 1_790_000_000_000

function bek (aciklama, gercek, beklenen) {
  if (gercek !== beklenen) throw new Error(`kopru ${aciklama}: ${gercek} ≠ ${beklenen}`)
  return beklenen
}

// Kodlayıcının denetimini atlayarak (geçersiz paket üretmek için) taşıma metni
const hamMetin = (m) => K.ON_EK + K.b64Yaz(c.encode(K.kopru, m))

function vektorler () {
  const n = (x) => b4a.alloc(16, x)
  const cikis = { from: 'ekip', type: 'mekan.durum.cikis', text: 'İşten çıktım', at: AT, nonce: n(1) }
  const gec = { from: 'aile', type: 'yuva.durum.gec', text: 'Geç kalacağım', at: AT + 1000, nonce: n(2) }
  const sinir = { from: 'ekip', type: 'mekan.durum.serbest', text: 'x'.repeat(280), at: AT + 2000, nonce: n(3) }
  const gecerli = [cikis, gec, sinir].map((m) => ({ alanlar: { ...m, nonce: hex(m.nonce) }, bytes: hex(c.encode(K.kopru, { v: 1, ...m })), metin: K.kopruYaz(m) }))
  bek('çıkış metni öneki', gecerli[0].metin.startsWith('hfkopru1:'), true)
  const sonuc = (fn) => { try { fn(); return 'gecerli' } catch (err) { return err.message } }
  // Alan uygulama: Yuva Hat (aile) ve Mekan Hat (ekip); durumlar sırayla, aynı nonce defteriyle
  const tanim = [
    ['aile', 'Mekan Hat → Yuva Hat: işten çıktım', gecerli[0].metin, 'gecerli'],
    ['aile', 'aynı nonce ikinci kez', gecerli[0].metin, 'BRIDGE_REPLAY'],
    ['ekip', 'Yuva Hat → Mekan Hat: geç kalacağım', gecerli[1].metin, 'gecerli'],
    ['aile', '280 baytlık metin', gecerli[2].metin, 'gecerli'],
    ['aile', '281 baytlık metin', hamMetin({ v: 1, ...sinir, text: 'x'.repeat(281), nonce: n(4) }), 'BRIDGE_TEXT'],
    ['aile', 'listede olmayan tür (iş verisi)', hamMetin({ v: 1, ...cikis, type: 'mekan.kamera.olay', nonce: n(5) }), 'BRIDGE_TYPE'],
    ['aile', 'aile türü ekipten gelmiş gibi', hamMetin({ v: 1, ...cikis, type: 'yuva.durum.gec', nonce: n(6) }), 'BRIDGE_TYPE'],
    ['ekip', 'kendi tarafından gelen paket', hamMetin({ v: 1, ...cikis, nonce: n(7) }), 'BRIDGE_DIRECTION'],
    ['aile', 'sürüm 2', hamMetin({ v: 2, ...cikis, nonce: n(8) }), 'BRIDGE_VERSION'],
    ['aile', 'sonda fazla bayt', K.ON_EK + K.b64Yaz(b4a.concat([c.encode(K.kopru, { v: 1, ...cikis, nonce: n(9) }), b4a.from([0])])), 'INVALID_BRIDGE'],
    ['aile', 'önek yok', gecerli[0].metin.slice(9), 'INVALID_BRIDGE'],
    ['aile', 'boş metin', hamMetin({ v: 1, ...cikis, text: ' ', nonce: n(10) }), 'BRIDGE_TEXT'],
    ['aile', 'yalnız görünmez karakter (U+200B)', hamMetin({ v: 1, ...cikis, text: '\u200b', nonce: n(11) }), 'BRIDGE_TEXT'],
    ['aile', 'bidi denetim karakteri (U+202E)', hamMetin({ v: 1, ...cikis, text: 'Çıktım\u202e', nonce: n(12) }), 'BRIDGE_TEXT'],
    ['aile', 'from __proto__', hamMetin({ v: 1, ...cikis, from: '__proto__', nonce: n(13) }), 'INVALID_BRIDGE'],
    ['aile', 'sürüm 2, ek alanlı', K.ON_EK + K.b64Yaz(b4a.concat([c.encode(K.kopru, { v: 2, ...cikis, nonce: n(14) }), b4a.from([3, 0x61, 0x62, 0x63])])), 'BRIDGE_VERSION']
  ]
  let saat = AT + 10_000
  const defter = { aile: new K.NonceDefteri({ now: () => saat }), ekip: new K.NonceDefteri({ now: () => saat }) }
  const durumlar = tanim.map(([kendi, aciklama, metin, beklenen]) => ({
    kendi, aciklama, metin,
    beklenen: bek(aciklama, sonuc(() => { const m = K.kopruCoz(metin, { kendi, simdi: saat }); defter[kendi].gor(m.nonce) }), beklenen)
  }))
  // Tazelik (RFC-0027 §7 c, inceleme 17 B1–B2): at geçmişe 7 gün, ileriye 5 dakika. Yakalanan paket 7 gün sonra eski
  const tazelik = [
    ['7 gün + 1 ms sonra aynı paket', gecerli[0].metin, AT + K.NONCE_MS + 1, 'BRIDGE_STALE'],
    ['7 gün içinde (sınırda)', gecerli[2].metin, AT + 2000 + K.NONCE_MS, 'gecerli'],
    ['5 dakika + 1 ms ileride', gecerli[0].metin, AT - K.ILERI_MS - 1, 'BRIDGE_AHEAD'],
    ['5 dakika ileride (sınırda)', gecerli[0].metin, AT - K.ILERI_MS, 'gecerli']
  ].map(([aciklama, metin, simdi, beklenen]) => ({ aciklama, metin, simdi, beklenen: bek(aciklama, sonuc(() => K.kopruCoz(metin, { kendi: 'aile', simdi })), beklenen) }))
  saat += K.NONCE_MS + 1
  const yediGunSonra = bek('7 gün sonra aynı paket', sonuc(() => K.kopruCoz(gecerli[0].metin, { kendi: 'aile', simdi: saat })), 'BRIDGE_STALE')
  return {
    aciklama: 'RFC-0005 §15.4, RFC-0027 §7 KOPRU { v: uint, from: string, type: string, text: string (≤ 280 bayt), at: uint, nonce: fixed16 }; taşıma metni "hfkopru1:" + base64url (dolgusuz, kanonik), ≤ 1 KB. Ağa çıkmaz; kriptografi yok. durumlar sırayla uygulanır; kendi: alan uygulamanın topluluk türü (aile: Yuva Hat, ekip: Mekan Hat), her biri kendi nonce defteriyle; simdi = AT + 10 sn. tazelik: at geçmişe 7 gün (BRIDGE_STALE), ileriye 5 dakika (BRIDGE_AHEAD); sürüm alanı önce okunur (BRIDGE_VERSION).',
    turler: K.TURLER,
    gecerli,
    durumlar,
    tazelik,
    yediGunSonra
  }
}

module.exports = { vektorler, AT }
