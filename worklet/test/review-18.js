// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D52 düşmanca inceleme: gerçek Kalici.gommeSaklama ile kırmızı testler (Node ve Bare).
// Node: node saldiri-worklet.js   Bare: bare saldiri-worklet.js
const W = __dirname + '/../..' // D54: kollar/D-inceleme-18-testler/saldiri-worklet.js'den
const test = require(W + '/node_modules/brittle')
const b4a = require(W + '/node_modules/b4a')
const fs = typeof Bare !== 'undefined' ? require(W + '/worklet/node_modules/bare-fs') : require('fs')
const S = require(W + '/sdk')
const A = require(W + '/core/records/test/helpers/family')
const { Kalici } = require(W + '/worklet/persistence')
const { metin: { N, kelimeler } } = require(W + '/core/ai')

const hex = (b) => b4a.toString(b, 'hex')
const TA = hex(A.K_TUM_AILE)
const MODEL = 'ab'.repeat(32)
const ARSIV_PUB = 'aa'.repeat(32)
let sayac = 0

function geciciDizin (t) {
  const d = __dirname + '/.gecici/d-' + Date.now().toString(36) + '-' + (sayac++)
  fs.mkdirSync(d, { recursive: true })
  t.teardown(() => { try { fs.rmSync(d, { recursive: true, force: true }) } catch {} })
  return d
}

const gom = async (metinler) => metinler.map((m) => {
  const v = new Float32Array(16)
  for (const k of kelimeler(N(m.replace(/^(query|passage): /, '')))) v[[...k].reduce((a, ch) => (a * 31 + ch.codePointAt(0)) >>> 0, 7) % 15] += 1
  v[15] += 0.05
  return v
})

function yzKur (saklama, kayit) {
  return new S.AiApi({ kayit, me: A.K.husniye, now: () => A.TS0 + 3_600_000, gom: { gom, onEkler: ['query: ', 'passage: '], modelHash: MODEL, esik: 500 }, gommeSaklama: saklama })
}

async function hazirla (t) {
  const dizin = geciciDizin(t)
  const k = new Kalici({ dizin, anahtar: b4a.alloc(32, 0x52), archivePubHex: ARSIV_PUB, now: () => 1_800_000_000_000 })
  t.teardown(() => k.kapat())
  const s = k.gommeSaklama()
  const L = A.anaDefter()
  const r = A.replika(L, A.K.husniye)
  const kayit = new S.RecordApi({ replika: r })
  kayit.put(TA, null, 'yuva.defter.not', { baslik: 'Kombi servisi' })
  const yz = yzKur(s, kayit)
  yz.directory('kur')
  await yz.processEmbedding()
  const yol = dizin + '/gomme/' + TA
  return { dizin, k, s, kayit, yol }
}

async function dene (f) { try { return { ok: true, v: await f() } } catch (e) { return { ok: false, hata: e.message } } }

test('KIRMIZI W1: bozuk gomme dosyası (tek bit) → dizin(kur) ve ara() ilk çağrı STATE_CORRUPT fırlatıyor (dosya silinmiyor; aynı örnekte sonraki çağrıda üstüne yazılarak düzelir)', async (t) => {
  const x = await hazirla(t)
  t.ok(fs.existsSync(x.yol), 'önkoşul: dosya diskte')
  const b = fs.readFileSync(x.yol)
  b[b.byteLength - 1] ^= 1
  fs.writeFileSync(x.yol, b)
  const yz = yzKur(x.s, x.kayit)
  const kur = await dene(() => yz.directory('kur'))
  t.ok(kur.ok, 'bozuk dosyada dizin kurulmalı (silinip yeniden gömülmeli); sonuç: ' + JSON.stringify(kur))
  const ara = await dene(() => yz.search('kombi'))
  t.ok(ara.ok && ara.v.length === 1, 'arama çalışmalı; sonuç: ' + JSON.stringify(ara.ok ? ara.v.length : ara))
  // ikinci açılış: hâlâ bozuk mu?
  const yz2 = yzKur(x.s, x.kayit)
  const kur2 = await dene(() => yz2.directory('kur'))
  t.ok(kur2.ok, 'ikinci açılışta da düşmemeli; sonuç: ' + JSON.stringify(kur2))
})

test('KIRMIZI W2: gomme/ dizinine konan açık kip dosya (platform anahtarı gerekmez) → dizin(kur) STATE_MODE_MISMATCH ile düşüyor', async (t) => {
  const x = await hazirla(t)
  // Açık kip başlığı: MAGIC ‖ SURUM ‖ kip=ACIK (Depo biçimi). İçerik önemsiz: oku() kip denetiminde fırlatır
  const ham = fs.readFileSync(x.yol)
  const sahte = b4a.concat([ham.subarray(0, 5), b4a.from([0]), b4a.alloc(40)])
  fs.writeFileSync(x.yol, sahte)
  const yz = yzKur(x.s, x.kayit)
  const kur = await dene(() => yz.directory('kur'))
  t.ok(kur.ok, 'yabancı dosya dizini düşürmemeli; sonuç: ' + JSON.stringify(kur))
})

test('KIRMIZI W3: gomme/ altındaki yarım yazım (.tmp-) açılışta temizlenmiyor (Depo.temizle yalnız kök ve dosyalar/)', async (t) => {
  const x = await hazirla(t)
  const tmp = x.yol + '.tmp-abcdef012345'
  fs.writeFileSync(tmp, fs.readFileSync(x.yol)) // atomikYaz yarıda kaldı: tam içerikli geçici kopya
  x.k.kapat()
  const k2 = new Kalici({ dizin: x.dizin, anahtar: b4a.alloc(32, 0x52), archivePubHex: ARSIV_PUB, now: () => 1_800_000_000_000 })
  t.teardown(() => k2.kapat())
  const s2 = k2.gommeSaklama()
  s2.sil('gomme-' + TA) // okuyuculuk bitti: dosya silindi
  t.absent(fs.existsSync(tmp), 'koleksiyonun geçici kopyası da silinmeli / açılışta temizlenmeli')
})

test('YESIL W4: gomme dosyası diskte şifreli; başka koleksiyonun adına taşınan dosya açılmıyor (AD dosya adı)', async (t) => {
  const x = await hazirla(t)
  const ham = fs.readFileSync(x.yol)
  t.absent(b4a.toString(ham).includes('Kombi') || b4a.toString(ham).includes(TA), 'düz metin ya da kimlik yok')
  const baska = 'cd'.repeat(16)
  fs.writeFileSync(x.dizin + '/gomme/' + baska, ham)
  const r = await dene(() => x.s.oku('gomme-' + baska))
  t.is(r.ok, false, 'yer değiştirilmiş dosya reddedilir: ' + JSON.stringify(r))
})
