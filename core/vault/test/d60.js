// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D60: Kasa'nın Shamir paylaşımına güvence — shamir-secret-sharing 0.0.4'ün çıktısı bağımsız başvuru gerçeklemesiyle
// (test/helpers/shamir-reference.js) karşılaştırılır; vektörler ve özellik testleri. Beklenenler elle.
const test = require('brittle')
const b4a = require('b4a')
const sodium = require('sodium-native')
const { split, combine } = require('shamir-secret-sharing')
const R = require('./helpers/shamir-reference')
const P = require('../share')

const rastgele = (n) => { const b = b4a.alloc(n); sodium.randombytes_buf(b); return b }
function * secimler (n, k, bas = 0, sec = []) {
  if (sec.length === k) { yield sec; return }
  for (let i = bas; i <= n - (k - sec.length); i++) yield * secimler(n, k, i + 1, [...sec, i])
}

test('alan: başvuru çarpımı AES alanı (0x11b) — elle bilinen değerler', (t) => {
  t.is(R.carp(0x57, 0x83), 0xc1, 'FIPS-197 §4.2 örneği')
  t.is(R.carp(0x57, 0x13), 0xfe, 'FIPS-197 §4.2.1 örneği')
  t.is(R.carp(0x53, R.ters(0x53)), 1)
  for (let a = 1; a < 256; a++) t.is(R.carp(a, R.ters(a)), 1, 'ters ' + a)
})

test('vektör: elle seçilmiş katsayılarla başvuru payları, paket aynı sırrı verir (32 bayt, 2/3 ve 3/5)', async (t) => {
  const sir = b4a.from('00112233445566778899aabbccddeeff0123456789abcdeffedcba9876543210', 'hex')
  for (const [n, esik] of [[3, 2], [5, 3]]) {
    const xler = [1, 2, 3, 0x80, 0xff].slice(0, n)
    const katsayilar = [...sir].map((_, i) => Array.from({ length: esik - 1 }, (_, j) => (i * 37 + j * 101 + 7) & 0xff))
    const paylar = R.bol(sir, xler, katsayilar)
    for (const s of secimler(n, esik)) {
      t.ok(b4a.equals(b4a.from(await combine(s.map((i) => paylar[i]))), sir), `paket ${esik}/${n} [${s}]`)
      t.ok(b4a.equals(b4a.from(R.birlestir(s.map((i) => paylar[i]))), sir), `başvuru ${esik}/${n} [${s}]`)
    }
  }
  // Tek baytlık elle hesap: f(x) = 0x42 + 0x03·x, x = 1 → 0x41, x = 2 → 0x44
  const p = R.bol(b4a.from([0x42]), [1, 2], [[0x03]])
  t.alike([p[0][0], p[1][0]], [0x41, 0x44])
})

test('özellik: rastgele sır, paketin her eşik alt kümesi başvuruyla da aynı sırrı verir (eşik 2–5, 300 deneme)', async (t) => {
  let n = 0
  for (let d = 0; d < 300; d++) {
    const esik = 2 + (d % 4)
    const top = esik + (d % 3)
    const sir = rastgele(32)
    const paylar = await split(new Uint8Array(sir), top, esik)
    t.is(new Set(paylar.map((p) => p[32])).size, top, 'x koordinatları farklı')
    t.ok(paylar.every((p) => p.length === 33 && p[32] !== 0), 'pay düzeni: 32 bayt + sıfır olmayan x')
    for (const s of secimler(top, esik)) {
      const secilen = s.map((i) => paylar[i])
      if (!b4a.equals(b4a.from(R.birlestir(secilen)), sir)) t.fail('başvuru farklı sır: deneme ' + d)
      if (!b4a.equals(b4a.from(await combine(secilen)), sir)) t.fail('paket farklı sır: deneme ' + d)
      n++
    }
  }
  t.ok(n > 1000, n + ' alt küme denendi')
})

test('özellik: eşik altı paydan bilgi çıkmaz — her aday sır baytı tutarlı ve paylar sırdan bağımsız dağılır', async (t) => {
  // Cebirsel (eşik 3): (0, v) ve iki pay her v için bir polinom belirler; üçüncü pay o polinomun üstünde ancak v gerçek
  // sır baytıysa durur. Yani iki pay 256 adayın hepsiyle uyumlu (bilgi yok), üç pay yalnız gerçek sırla
  const sir = rastgele(32)
  const paylar = await split(new Uint8Array(sir), 5, 3)
  const lagrange = (xs, ys, x) => {
    let t2 = 0
    for (let j = 0; j < xs.length; j++) {
      let l = 1
      for (let m = 0; m < xs.length; m++) if (m !== j) l = R.carp(l, R.carp(x ^ xs[m], R.ters(xs[j] ^ xs[m])))
      t2 ^= R.carp(ys[j], l)
    }
    return t2
  }
  const [p0, p1, p2] = paylar
  const adaylar = []
  for (let v = 0; v < 256; v++) if (lagrange([0, p0[32], p1[32]], [v, p0[0], p1[0]], p2[32]) === p2[0]) adaylar.push(v)
  t.alike(adaylar, [sir[0]], 'üç pay (eşik) yalnız gerçek sır baytıyla uyumlu')
  // İki payla her v için bir 2. dereceden polinom var: (0, v), p0, p1 noktalarından geçer ve öbür x'lerde farklı değerler
  // verir; hiçbir v elenemez
  const ikiPaylaElenen = []
  for (let v = 0; v < 256; v++) if (lagrange([0, p0[32], p1[32]], [v, p0[0], p1[0]], 0) !== v) ikiPaylaElenen.push(v)
  t.is(ikiPaylaElenen.length, 0, 'iki pay (eşik altı) hiçbir adayı elemez')
  // İstatistik: eşik 2'de tek payın ilk baytı, sır 0x00 da olsa 0xff de olsa düzgün dağılır (ki-kare, sd 255)
  const kikare = async (bayt) => {
    const say = new Array(256).fill(0)
    const N = 8192
    for (let i = 0; i < N; i++) { const p = await split(new Uint8Array(32).fill(bayt), 2, 2); say[p[0][0]]++ }
    const bek = N / 256
    return say.reduce((a, s) => a + (s - bek) ** 2 / bek, 0)
  }
  for (const b of [0x00, 0xff]) {
    const k = await kikare(b)
    t.ok(k < 340, `sır 0x${b.toString(16)}: ki-kare ${k.toFixed(0)} (sd 255, p≈0,0003 sınırı 340)`)
  }
})

test('bozuk pay reddi: kütüphane bütünlük denetlemez, pay katmanı commit ile reddeder; aynı x ve x = 0', async (t) => {
  const sir = rastgele(32)
  const paylar = await split(new Uint8Array(sir), 3, 2)
  const bozuk = new Uint8Array(paylar[0]); bozuk[5] ^= 1
  t.absent(b4a.equals(b4a.from(await combine([bozuk, paylar[1]])), sir), 'kütüphane bozuk payla başka sır verir (bütünlük yok)')
  const hataOf = async (f) => { try { await f(); return null } catch (e) { return e.message } }
  t.ok(await hataOf(() => combine([paylar[0], paylar[0]])), 'aynı x koordinatlı iki pay reddedilir')
  t.is(await hataOf(() => R.birlestir([paylar[0], paylar[0]])), 'INVALID_SHARE')
  const sifirX = new Uint8Array(paylar[1]); sifirX[32] = 0
  t.is(await hataOf(() => R.birlestir([paylar[0], sifirX])), 'INVALID_SHARE', 'x = 0 sırrın kendisidir, pay olamaz')
  // Pay katmanı (core/vault/share.js birlestir): commit uyuşmazsa SHARE_CORRUPT
  const secretId = b4a.alloc(16, 9)
  const sahipler = [1, 2, 3].map((i) => ({ id: b4a.toString(b4a.alloc(16, i), 'hex') }))
  const kasaPaylari = await P.paylariUret(sir, { secretId, kind: P.TUR.KRA, version: 1, dagitim: { t: 2, n: 3, kurulur: true, sahipler } })
  t.ok(b4a.equals(await P.birlestir(kasaPaylari.slice(0, 2), { secretId, kind: P.TUR.KRA, version: 1 }), sir))
  const k0 = { ...kasaPaylari[0], share: b4a.from(kasaPaylari[0].share) }
  k0.share[3] ^= 0x40
  t.is(await hataOf(() => P.birlestir([k0, kasaPaylari[1]], { secretId, kind: P.TUR.KRA, version: 1 })), 'SHARE_CORRUPT')
  t.ok(b4a.equals(await P.birlestir([k0, kasaPaylari[1], kasaPaylari[2]], { secretId, kind: P.TUR.KRA, version: 1 }), sir), 'bozuk pay dışarıda kalır, sağlam ikisiyle açılır')
})
