// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// RFC-0005 §15 kişisel köprü (D46, vektör 18): KOPRU kodlaması, taşıma metni ve alan uygulamanın kararları —
// protocol/vectors/bridge.json. Beklenen değerler elle.
const test = require('brittle')
const b4a = require('b4a')
const c = require('compact-encoding')
const K = require('../protocol/bridge')
const { vektorler } = require('./helpers/bridge-vector')
const F = require('../../../protocol/vectors/bridge.json')

const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }

test('vektörler: bridge.json üretici aynı dosyayı verir (belirlenimci)', (t) => {
  t.alike(JSON.parse(JSON.stringify(vektorler())), F)
})

test('bridge.json girdilerinden yeniden hesap: kodlama, taşıma metni, alan uygulamanın kararları', (t) => {
  for (const g of F.gecerli) {
    const m = { ...g.alanlar, nonce: b4a.from(g.alanlar.nonce, 'hex') }
    t.is(b4a.toString(c.encode(K.kopru, { v: 1, ...m }), 'hex'), g.bytes)
    t.is(K.kopruYaz(m), g.metin)
    const geri = K.kopruCoz(g.metin)
    t.alike(Object.keys(geri), ['v', 'from', 'type', 'text', 'at', 'nonce'], 'familyId, kimlik, ad, yer taşımaz')
    t.alike({ ...geri, nonce: b4a.toString(geri.nonce, 'hex') }, { v: 1, ...g.alanlar })
  }
  let saat = 1_790_000_010_000
  const defter = { aile: new K.NonceDefteri({ now: () => saat }), ekip: new K.NonceDefteri({ now: () => saat }) }
  for (const d of F.durumlar) {
    const r = hataOf(() => { const m = K.kopruCoz(d.metin, { kendi: d.kendi, simdi: saat }); defter[d.kendi].gor(m.nonce) })
    t.is(r || 'gecerli', d.beklenen, d.aciklama)
  }
  for (const d of F.tazelik) t.is(hataOf(() => K.kopruCoz(d.metin, { kendi: 'aile', simdi: d.simdi })) || 'gecerli', d.beklenen, d.aciklama)
  saat += K.NONCE_MS + 1
  t.is(hataOf(() => K.kopruCoz(F.gecerli[0].metin, { kendi: 'aile', simdi: saat })) || 'gecerli', F.yediGunSonra)
})

test('elle yazılmış beklenenler ve sınırlar', (t) => {
  t.alike(F.durumlar.map((d) => d.beklenen), ['gecerli', 'BRIDGE_REPLAY', 'gecerli', 'gecerli', 'BRIDGE_TEXT', 'BRIDGE_TYPE', 'BRIDGE_TYPE', 'BRIDGE_DIRECTION', 'BRIDGE_VERSION', 'INVALID_BRIDGE', 'INVALID_BRIDGE', 'BRIDGE_TEXT', 'BRIDGE_TEXT', 'BRIDGE_TEXT', 'INVALID_BRIDGE', 'BRIDGE_VERSION'])
  t.alike(F.tazelik.map((d) => d.beklenen), ['BRIDGE_STALE', 'gecerli', 'BRIDGE_AHEAD', 'gecerli'])
  t.is(F.yediGunSonra, 'BRIDGE_STALE', 'yakalanan paket 7 gün sonra yeniden kabul edilmez (inceleme 17 B1)')
  t.is(hataOf(() => K.kopruCoz(F.gecerli[0].metin, { kaynak: 'aile' })), 'BRIDGE_SOURCE', 'yazan uygulama paketin from\'u değil')
  t.alike(F.turler, { ekip: ['mekan.durum.giris', 'mekan.durum.cikis', 'mekan.durum.gec', 'mekan.durum.serbest'], aile: ['yuva.durum.gec', 'yuva.durum.serbest'] })
  t.is(F.gecerli[0].metin.slice(0, 9), 'hfkopru1:')
  t.ok(F.gecerli.every((g) => b4a.byteLength(g.metin) <= 1024))
  t.is(hataOf(() => K.kopruYaz({ from: 'ekip', type: 'mekan.durum.cikis', text: 'ç'.repeat(141), at: 1, nonce: b4a.alloc(16) })), 'BRIDGE_TEXT', '282 bayt (çok baytlı harf)')
  t.is(hataOf(() => K.kopruCoz('hfkopru1:' + 'A'.repeat(1100))), 'INVALID_BRIDGE', '1 KB üstü')
  t.is(hataOf(() => K.kopruCoz('hfkopru1:AB+/')), 'INVALID_BRIDGE', 'base64url dışı harf')
})

test('nonce defteri: en çok 1000 kayıt, en eskisi silinir; her nonce kendi anahtarında', (t) => {
  const m = new Map()
  const d = new K.NonceDefteri({ saklama: { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v), delete: (k) => m.delete(k) }, now: () => 1 })
  const n = (i) => { const b = b4a.alloc(16); b[0] = i >> 8; b[1] = i & 255; return b }
  for (let i = 0; i < 1500; i++) d.gor(n(i))
  t.is([...m.keys()].filter((k) => k.startsWith('kopru/nonce/')).length, 1000)
  t.is(d.boyut(), 1000)
  t.is(hataOf(() => d.gor(n(1499))), 'BRIDGE_REPLAY')
  t.is(hataOf(() => d.gor(n(0))), null, 'en eskisi düştü (tazelik penceresi zaten reddeder)')
})

test('base64url: b4a base64 ile aynı (dolgusuz, - ve _); dolgu bitleri sıfır olmayan yazım reddedilir', (t) => {
  for (let n = 0; n < 40; n++) {
    const b = b4a.alloc(n)
    for (let i = 0; i < n; i++) b[i] = (i * 37 + n * 11) & 255
    const beklenen = b4a.toString(b, 'base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    t.is(K.b64Yaz(b), beklenen)
    t.ok(b4a.equals(K.b64Oku(beklenen), b))
  }
  t.is(hataOf(() => K.b64Oku('AB')), 'INVALID_BRIDGE', 'AB: dolgu bitleri sıfır değil (doğrusu AA)')
  t.is(hataOf(() => K.b64Oku('A')), 'INVALID_BRIDGE')
})
