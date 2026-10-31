// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// measure-phone.js — telefonda çekirdeğin ölçümü (D26): aile kurma, 1000 kayıt, eşitleme, arama dizini, kap, kasa
//
// Çalıştırma (düşük uç telefon profili: tek çekirdek; bellek tavanı 512 MiB maxRSS ile denetlenir):
//   taskset -c 0 bare scripts/measure-phone.js [kayit sayısı]
//   taskset -c 0 node --max-old-space-size=512 scripts/measure-phone.js [kayit sayısı]   (karşılaştırma)
//   ... scripts/measure-phone.js 20000 --tek   (eşitleme adımı yok: bellekte yalnız telefonun replikası)
// Bare'de V8 yığın sınırı bayrağı yok; tavan, adım başına tepe bellek (maxRSS) eşikle karşılaştırılarak denetlenir.
// Çıktı: Markdown tablo satırları (kollar/D-olcum.md'ye). Ağ yok, dosya yazılmaz; anahtarlar test tohumlarından.
const b4a = require('b4a')
const { ledger: { Ledger }, identity: { createIdentity } } = require('@havenfold/core')
const S = require('@havenfold/sdk')
const K = require('@havenfold/vault')
const A = require('../core/records/test/helpers/family')

const BARE = typeof Bare !== 'undefined'
const ARGV = (BARE ? Bare.argv : process.argv).slice(2)
const N = parseInt(ARGV.find((x) => /^\d+$/.test(x)) || '1000', 10)
// --tek: telefondaki gibi tek replika (eşitleme adımı ikinci bir replika kurar; telefonda o yok)
const TEK = ARGV.includes('--tek')
const TAVAN_MB = 512
// Telefon hedefleri (ms): kullanıcının beklediği işler 1–2 sn, toplu işler arka planda 10 sn
const HEDEF = { 'aile kurma': 1000, 'kayıt yazma': 10_000, 'eşitleme': 10_000, 'arama dizini': 5000, 'kap dışa aktarma': 5000, 'kap açma': 5000, 'kasa kurma': 2000, 'kasa açma (paylardan)': 2000 }

const maxRss = () => (BARE ? require('bare-os').resourceUsage().maxRSS : process.resourceUsage().maxRSS) / 1024 // MiB
const anlikRss = () => (BARE ? require('bare-os').memoryUsage().rss : process.memoryUsage().rss) / 1024 / 1024 // MiB
const simdi = () => Date.now()
const satirlar = []

async function adim (ad, fn) {
  const r0 = maxRss()
  const t0 = simdi()
  const sonuc = await fn()
  const ms = simdi() - t0
  const rss = maxRss()
  const hedef = HEDEF[ad]
  const asim = (hedef && ms > hedef) || rss > TAVAN_MB
  satirlar.push(`| ${ad} | ${ms} | ${rss.toFixed(0)} | +${Math.max(0, rss - r0).toFixed(0)} | ${hedef || '—'} | ${asim ? 'AŞTI' : 'tamam'} |`)
  return sonuc
}

async function main () {
  const hex = (b) => b4a.toString(b, 'hex')
  const TA = hex(A.K_TUM_AILE)
  let saat = A.TS0 + 3_600_000
  const now = () => (saat += 1)

  await adim('aile kurma', () => {
    const me = createIdentity({ seed: 'olc/kurucu', platform: 'test' })
    return S.LedgerApi.createFamily({ Ledger, me, familyName: 'Ölçüm', displayName: 'Kurucu', ts: A.TS0 })
  })

  // Ölçüm ailesi: defter v2.1 ana zinciri (5 üye, kutu, işçi, koleksiyonlar)
  const L = A.anaDefter()
  const husR = A.replika(L, A.K.husniye, { now })
  const kayit = new S.RecordApi({ replika: husR })
  const metin = 'Kombi bakımı yapıldı; filtre değişti, basınç 1,5 bar. Servis 0532 111 22 33. '.repeat(3)
  await adim('kayıt yazma', () => {
    for (let i = 0; i < N; i++) kayit.put(TA, null, 'yuva.defter.not', { baslik: 'Not ' + i, metin, etiketler: ['ev', 'bakim'] })
  })

  if (!TEK) await esitleme()
  async function esitleme () {
  const keremR = A.replika(A.kopya(L), A.K.kerem, { now })
  await adim('eşitleme', () => {
    for (let i = 0; i < 4; i++) { A.teslim(husR, keremR); A.teslim(keremR, husR) }
    keremR.sync()
    const sayi = keremR.records(TA).length
    if (sayi < N) throw new Error('ESITLEME_EKSIK ' + sayi)
  })
  }

  const yz = new S.AiApi({ kayit, me: A.K.husniye, now })
  await adim('arama dizini', () => {
    yz.directory('kur', TA)
    return yz.search('filtre basınç')
  })

  // Kap dışa aktarma (D41): akışla, telefondaki gibi dosyaya (burada sayaçlı boş hedef). Anlık bellek her parçada
  // örneklenir: Argon2id'nin 128 MiB'ı (RFC-0014 varsayılanı) anahtar türetilirken kısa süreli, akışın kendisi ayrı satır.
  const kap = new S.ExportApi({ kayit, now, gizliAlanlar: () => [] })
  const parola = 'olcum-parolasi-yirmidort'
  let kapBoy = 0
  let akisBas = null
  let akisTepe = 0
  const rss0 = anlikRss()
  await adim('kap dışa aktarma', () => kap.export({
    koleksiyonlar: [TA],
    parola,
    yaz: (b) => { kapBoy += b.byteLength; const r = anlikRss(); if (akisBas === null) akisBas = r; if (r > akisTepe) akisTepe = r }
  }))
  satirlar.push(`| kap akışı (Argon2id dışı; anlık bellek) | — | ${akisTepe.toFixed(0)} | +${Math.max(0, akisTepe - rss0).toFixed(0)} | — | ${N > 5000 ? 'bilgi' : akisTepe - rss0 > 40 ? 'AŞTI' : 'tamam'} |`) // hedef: 5000 sayfada < 40 MiB
  // Telefondaki dosya yazıcısı Promise döner (D44): her parça yazılana kadar sonraki üretilmez; bellek de ölçülür
  let pTepe = 0
  const rssP = anlikRss()
  await adim('kap dışa aktarma (Promise yazıcı)', () => kap.export({
    koleksiyonlar: [TA],
    parola,
    yaz: (b) => new Promise((resolve) => setTimeout(() => { const r = anlikRss(); if (r > pTepe) pTepe = r; resolve() }, 0))
  }))
  satirlar.push(`| kap akışı, Promise yazıcı (anlık bellek) | — | ${pTepe.toFixed(0)} | +${Math.max(0, pTepe - rssP).toFixed(0)} | — | ${N > 5000 ? 'bilgi' : pTepe - rssP > 40 ? 'AŞTI' : 'tamam'} |`)
  // Açma için kap baytları (iceAl bayt alır; telefon kabı dosyadan açar)
  const dis = await kap.export({ koleksiyonlar: [TA], parola })
  await adim('kap açma', () => kap.import({ bytes: dis.bytes, parola }))

  const kasa = new S.VaultApi({ ledger: L, me: A.K.kerem, now })
  const sir = b4a.alloc(32, 9)
  const kur = await adim('kasa kurma', () => kasa.setupRecoveryKey(hex(A.K_KASA), b4a.from(sir), { kagit: 1 }))
  await adim('kasa açma (paylardan)', () => K.pay.birlestir([K.pay.decodeShare(kur.paylar[0].bytes), K.pay.kagitCoz(kur.kagitlar[0].metin)], { secretId: b4a.from(kur.secretId, 'hex'), kind: K.pay.TUR.KRA, version: kur.version }))

  const baslik = `Çalışma ortamı: ${BARE ? 'Bare ' + Bare.version : 'Node ' + process.version}, kayıt sayısı ${N}${TEK ? ' (tek replika)' : ''}, kap boyu ${(kapBoy / 1024).toFixed(0)} KiB`
  console.log(baslik)
  console.log('| İş | Süre (ms) | Tepe bellek (MiB) | Artış (MiB) | Hedef (ms) | Sonuç |')
  console.log('|----|-----------|-------------------|-------------|------------|-------|')
  for (const s of satirlar) console.log(s)
}

main().catch((err) => { console.error('HATA', err.message); if (BARE) Bare.exit(1); else process.exit(1) })
