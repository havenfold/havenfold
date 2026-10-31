// SPDX-License-Identifier: Apache-2.0
// D46 (0e01853) düşmanca inceleme — temiz bulunanların kanıtı (YEŞİL olmalı): vektör 18'in bağımsız çözümü ve RFC-0005
// §15/§18 ile birebir karşılaştırması, sızıntı alanları, karıştırma (fuzz) ile tür/280 bayt/yön atlatma denemesi.
'use strict'
const KOK = __dirname + '/../..' // D49: kollar/D-inceleme-17-testler/temiz.js'den
const test = require(KOK + '/node_modules/brittle')
const b4a = require(KOK + '/node_modules/b4a')
const K = require(KOK + '/core/core/protocol/bridge.js')
const { BridgeApi } = require(KOK + '/sdk/bridge.js')
const F = require(KOK + '/protocol/vectors/bridge.json')

// --- bağımsız çözücü (compact-encoding ve bridge.js kullanılmaz) ---
const ALF = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
function b64urlCoz (s) {
  const out = []
  let acc = 0
  let bit = 0
  for (const ch of s) {
    const v = ALF.indexOf(ch)
    if (v < 0) throw new Error('harf')
    acc = (acc << 6) | v
    bit += 6
    if (bit >= 8) { bit -= 8; out.push((acc >> bit) & 255) }
  }
  return Uint8Array.from(out)
}
function utf8 (u8) { let s = ''; for (const b of u8) s += '%' + b.toString(16).padStart(2, '0'); return decodeURIComponent(s) }
function oku (u8) {
  let i = 0
  const uint = () => {
    const p = u8[i++]
    if (p < 0xfd) return p
    const n = p === 0xfd ? 2 : p === 0xfe ? 4 : 8
    let v = 0
    for (let k = n - 1; k >= 0; k--) v = v * 256 + u8[i + k]
    i += n
    return v
  }
  const str = () => { const n = uint(); const s = u8.subarray(i, i + n); i += n; return { s: utf8(s), n } }
  const v = uint(); const from = str(); const type = str(); const text = str(); const at = uint()
  const nonce = Array.from(u8.subarray(i, i + 16)).map((b) => b.toString(16).padStart(2, '0')).join(''); i += 16
  return { v, from: from.s, type: type.s, text: text.s, textBayt: text.n, at, nonce, artik: u8.length - i }
}
const hexOf = (u8) => Array.from(u8).map((b) => b.toString(16).padStart(2, '0')).join('')

// RFC-0005 §15.2 tablosu elle
const RFC_TURLER = { ekip: ['mekan.durum.giris', 'mekan.durum.cikis', 'mekan.durum.gec', 'mekan.durum.serbest'], aile: ['yuva.durum.gec', 'yuva.durum.serbest'] }

test('vektör 18 bağımsız çözüm: bytes ↔ metin ↔ alanlar, RFC §15.2 türleri, §18 madde 18 durumları', (t) => {
  t.alike(F.turler, RFC_TURLER, 'tür listesi RFC §15.2 ile birebir')
  t.alike(K.TURLER, RFC_TURLER)
  for (const g of F.gecerli) {
    t.ok(g.metin.startsWith('hfkopru1:'))
    t.ok(g.metin.length <= 1024)
    const u8 = b64urlCoz(g.metin.slice(9))
    t.is(hexOf(u8), g.bytes, 'taşıma metni bytes ile aynı')
    const m = oku(u8)
    t.alike({ v: m.v, from: m.from, type: m.type, text: m.text, at: m.at, nonce: m.nonce, artik: m.artik }, { v: 1, ...g.alanlar, artik: 0 })
    t.ok(m.textBayt <= 280)
  }
  t.is(oku(b4a.from(F.gecerli[2].bytes, 'hex')).textBayt, 280, 'sınır vakası tam 280 bayt')
  const d = Object.fromEntries(F.durumlar.map((x) => [x.aciklama, x]))
  t.is(oku(b64urlCoz(d['281 baytlık metin'].metin.slice(9))).textBayt, 281, '281 bayt vakası gerçekten 281')
  t.is(d['281 baytlık metin'].beklenen, 'BRIDGE_TEXT')
  const tl = oku(b64urlCoz(d['listede olmayan tür (iş verisi)'].metin.slice(9)))
  t.ok(!RFC_TURLER.ekip.includes(tl.type) && !RFC_TURLER.aile.includes(tl.type), 'listede olmayan tür gerçekten listede değil')
  t.is(d['aynı nonce ikinci kez'].metin, F.gecerli[0].metin, 'aynı nonce vakası aynı paket')
  t.is(d['aynı nonce ikinci kez'].beklenen, 'BRIDGE_REPLAY')
})

test('sızıntı: hazırlanan paketin alanları yalnız v, from, type, text, at, nonce; nonce rastgele', (t) => {
  const s = new Map()
  const mekan = new BridgeApi({ kendi: 'ekip', saklama: { get: (k) => s.get(k) ?? null, set: (k, v) => s.set(k, v) } })
  mekan.buttons(['mekan.durum.cikis'])
  const a = mekan.prepare({ type: 'mekan.durum.cikis', text: 'Çıktım' })
  const b = mekan.prepare({ type: 'mekan.durum.cikis', text: 'Çıktım' })
  const ma = oku(b64urlCoz(a.metin.slice(9)))
  const mb = oku(b64urlCoz(b.metin.slice(9)))
  t.is(ma.artik, 0, 'pakette başka bayt yok')
  t.not(ma.nonce, mb.nonce, 'iki paketin nonce\'u farklı (bağlanamaz)')
  t.alike(Object.keys(a).sort(), ['metin', 'yol'])
  const yuva = new BridgeApi({ kendi: 'aile' })
  t.alike(Object.keys(yuva.receive(a.metin)).sort(), ['at', 'etiket', 'from', 'text', 'type'])
})

test('karıştırma: 60 000 bozulmuş paketten kabul edilen hiçbiri tür/yön/280 bayt kuralını çiğnemez', (t) => {
  let tohum = 12345
  const rnd = () => { tohum = (tohum * 1103515245 + 12345) & 0x7fffffff; return tohum }
  const tabanlar = F.gecerli.map((g) => b4a.from(g.bytes, 'hex'))
  let kabul = 0
  let ihlal = 0
  for (let i = 0; i < 60000; i++) {
    const tab = tabanlar[rnd() % tabanlar.length]
    let u = b4a.from(tab)
    const islem = rnd() % 3
    if (islem === 0) { for (let k = 0; k < 1 + (rnd() % 3); k++) u[rnd() % u.length] = rnd() & 255 }
    else if (islem === 1) { const p = rnd() % u.length; u = b4a.concat([u.subarray(0, p), b4a.from([rnd() & 255]), u.subarray(p)]) }
    else { const p = rnd() % u.length; u = b4a.concat([u.subarray(0, p), u.subarray(p + 1)]) }
    const metin = K.ON_EK + K.b64Yaz(u)
    for (const kendi of ['aile', 'ekip']) {
      let m
      try { m = K.kopruCoz(metin, { kendi }) } catch { continue }
      kabul++
      const ok = m.from !== kendi && RFC_TURLER[m.from] && RFC_TURLER[m.from].includes(m.type) && b4a.byteLength(m.text) <= 280 && m.v === 1
      if (!ok) ihlal++
    }
  }
  t.comment(`kabul edilen bozulmuş paket: ${kabul}, ihlal: ${ihlal}`)
  t.is(ihlal, 0)
})

test('üst sınır: en büyük geçerli paket 1 KB altında; sınır baytta (karakterde değil)', (t) => {
  const m = K.kopruYaz({ from: 'ekip', type: 'mekan.durum.serbest', text: 'ğ'.repeat(140), at: Number.MAX_SAFE_INTEGER, nonce: b4a.alloc(16, 255) })
  t.ok(m.length <= 1024, `en büyük: ${m.length} bayt`)
  let hata = null
  try { K.kopruYaz({ from: 'ekip', type: 'mekan.durum.serbest', text: 'ğ'.repeat(140) + 'x', at: 1, nonce: b4a.alloc(16) }) } catch (e) { hata = e.message }
  t.is(hata, 'BRIDGE_TEXT', '281 bayt (çok baytlı)')
})
