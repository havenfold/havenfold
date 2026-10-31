// SPDX-License-Identifier: Apache-2.0
// D28: kanal komut numaraları tekil ve RFC-0003 §10 aralık tablosuyla (protocol/command-ranges.json) çakışmıyor
const test = require('brittle')
const S = require('..')
const AR = require('../../protocol/command-ranges.json')
const V4 = require('../../protocol/vectors/channel-v4.json')
const VG = require('../../protocol/vectors/channel-task.json') // 250–255 (RFC-0002 Ek: RFC-0033 §9 s)

// Kanaldaki bütün adlı numaralar: SDK kanal komutları, kasa kilidi, yapay zeka, SDK ortak
const hepsi = () => [
  ...Object.entries(S.CHANNEL_COMMAND), ...Object.entries(S.VAULT_COMMAND), ...Object.entries(S.AI_COMMAND), ...Object.entries(S.COMMAND),
  ...Object.entries(S.SERVICE_COMMAND), // RFC-0010 §16 (300–309)
  ...Object.entries(S.EDGE_COMMAND), // RFC-0008 §12 (340–344)
  ...Object.entries(S.LEDGER_COMMAND) // RFC-0003 §5.4 varlık (430–431; D98)
]

test('aynı numara iki ada verilmez; aynı ad iki numaraya verilmez', (t) => {
  const noAd = new Map()
  const adNo = new Map()
  for (const [ad, no] of hepsi()) {
    t.ok(!noAd.has(no) || noAd.get(no) === ad, no + ': ' + ad + (noAd.has(no) ? ' / ' + noAd.get(no) : ''))
    t.ok(!adNo.has(ad) || adNo.get(ad) === no, ad)
    noAd.set(no, ad)
    adNo.set(ad, no)
  }
})

test('her numara izinli aralıkta; 0–239 yalnız Yuva Hat çizelgesindeki adıyla', (t) => {
  for (const [ad, no] of hepsi()) {
    if (no < 240) { t.is(AR.yuvaHatCizelgesi[ad], no, ad + ' Yuva Hat çizelgesinde aynı numarayla'); continue }
    const a = AR.araliklar.find((x) => no >= x.bas && no <= x.son)
    t.ok(a && a.sdk, `${ad} ${no} → ${a ? a.sahip : 'aralık yok'}`)
  }
  // Tablo kendi içinde: aralıklar örtüşmez ve boşluksuz 0–399
  const s = [...AR.araliklar].sort((a, b) => a.bas - b.bas)
  s.forEach((x, i) => t.is(x.bas, i ? s[i - 1].son + 1 : 0, x.sahip))
  t.is(s.at(-1).son, 459) // 450–459 defter: uzaktan üye (RFC-0003 §5.1; D106)
  t.is(AR.araliklar.find((x) => x.bas === 280).sdk, true, '280–289 RFC-0005 ekip (D45: TeamApi)')
})

test('channel-v4.json ve channel-task.json geçerli tablo: CHANNEL_COMMAND\'un tamamı, her ad bir SDK yöntemine bağlı', (t) => {
  const tablo = [...V4.komutlar, ...VG.komutlar.filter((k) => !V4.komutlar.some((x) => x.no === k.no))]
  t.alike(Object.fromEntries(tablo.map((k) => [k.ad, k.no])), S.CHANNEL_COMMAND)
  for (const k of tablo) {
    const [sinif, yontem] = k.sdk.split('.')
    t.is(typeof (S[sinif].prototype[yontem] || S[sinif][yontem]), 'function', k.sdk) // TeamApi.create statik
  }
  t.alike(V4.yerine, { VAULT_STATUS: { eski: 229, yeni: 365 }, EXPORT: { eski: 280, yeni: 390 }, IMPORT: { eski: 281, yeni: 391 } })
})

// D36 (inceleme 13): her numara aralığının RFC'lerinden birinde (adıyla ya da "numarası N olur" atamasıyla) ya da
// aralık sıra tablosuna bırakılmışsa channel-v4.json'da yazılı; başka bir RFC numarayı "ayrılmış" sayıyorsa aralığın
// RFC'lerinden biri o RFC'yi "Etkilenen RFC'ler" satırında anar. Belgeler dosyadan okunduğu için yalnız Node'da.
test('her numara aralığının RFC\'sinde tanımlı; "ayrılmış" diyen RFC etkilenenler arasında', { skip: typeof Bare !== 'undefined' }, (t) => {
  const fs = require('fs')
  const kok = __dirname + '/../../docs/rfc/'
  const rfc = new Map(fs.readdirSync(kok).filter((f) => /^RFC-\d{4}-.*\.md$/.test(f)).map((f) => [f.slice(0, 8), fs.readFileSync(kok + f, 'utf8')]))
  const etkilenen = (ad) => ((rfc.get(ad) || '').match(/Etkilenen RFC'ler: ([^\n]*)/) || [, ''])[1].match(/\d{4}/g) || []
  const sayi = (n) => new RegExp('(^|[^0-9.])' + n + '([^0-9]|$)')
  const v4 = new Set(V4.komutlar.map((k) => k.no))
  // Aralığın sıra tablosu channel-v4.json dışında bir vektör dosyasıysa (D98: asset.json) numaralar oradan
  const siraNo = (dosya) => new Set((require('../../protocol/vectors/' + dosya).komutlar || []).map((k) => k.no))
  const adlar = new Map(hepsi())
  for (const [ad, no] of adlar) {
    if (no < 240) continue
    const a = AR.araliklar.find((x) => no >= x.bas && no <= x.son)
    t.ok(Array.isArray(a.rfc) && a.rfc.length, `${a.bas}–${a.son} aralığının RFC'leri yazılı`)
    const satirlar = a.rfc.flatMap((r) => (rfc.get(r) || '').split('\n'))
    const tanimli = satirlar.some((s) => sayi(no).test(s) && (s.includes(ad) || /olur/.test(s))) || (a.sira === 'channel-v4.json' && v4.has(no)) || (!!a.sira && a.sira !== 'channel-v4.json' && siraNo(a.sira).has(no))
    t.ok(tanimli, `${no} ${ad}: ${a.rfc.join(', ')}${a.sira ? ' ya da ' + a.sira : ''}`)
    // "N ayrılmış", "`a–b` ayrılmış", "| N | ayrılmış |", "a–b … için ayrılmış" (aynı hücrede); "ayrılmıştı" geçmiş zamandır
    for (const [r, metin] of rfc) {
      if (a.rfc.includes(r)) continue
      for (const s of metin.split('\n')) {
        const m = [...s.matchAll(/`?(\d{3})(?:[–-](\d{3}))?`?(?: \|)?[^|,;.]{0,40}?ayrılmış(?!t)/g)]
        if (m.some((x) => no >= +x[1] && no <= +(x[2] || x[1]))) t.ok(a.rfc.some((y) => etkilenen(y).includes(r.slice(4))), `${no} ${ad}: ${r} "ayrılmış" diyor; ${a.rfc.join('/')} onu etkilenenlerde anmalı`)
      }
    }
  }
})
