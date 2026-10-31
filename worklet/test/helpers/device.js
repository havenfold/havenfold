// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Çok cihazlı testin tek cihazı (D34): ayrı bir Node ya da Bare sürecinde @havenfold/worklet'i başlatır.
//
// Ana süreçle stdin/stdout üstünde satır başına bir JSON konuşur. Gelen:
//   { k: 'start', dizin, anahtarHex, archivePubHex, sayac, ad, cihazAdi }   sırlar argv'ye yazılmaz (worklet sözleşmesi 1)
//   { k: 'iste', no, komut, govde, aile? }   RFC-0024 komutu (bellek içi IPC üstünden ürün sunucusuna; aile: RFC-0034)
//   { k: 'ag', from, type, b, yol }   ağdan zarf (b: hex); tören türleri tören taşıyıcısına, gerisi eşitleyiciye
//   { k: 'bag', peer } / { k: 'kop', peer }   doğrudan oturum açıldı / kapandı
//   { k: 'kutuQr', no }   kutunun tören QR'ı;  { k: 'kutuSayi', no }   kutunun emanetindeki işlem sayısı
//   { k: 'kutuPaylari', no }   kutunun tuttuğu paylar ('secretId|sürüm'; node/box-share.js, taklit TPM)
//   { k: 'kutuZarflari', no }   kutunun tuttuğu kasa zarfı kopyaları ({ collectionId, version, envSeq, sonDonem }; §9 g)
// start'ta dht: [{ host, port }] (yerel testnet önyüklemesi) verilirse ağ ve tören bu sürecin HyperDHT düğümü üstünden
// yürür (worklet/tasiyici, deneysel; D43): boru yönlendiricisi kullanılmaz.
// start'ta kutuPay: { dizin, tpmAnahtarHex } verilirse bu süreç kutunun pay tutucusunu kurar (yalnız Node: düğüm
// yazılımı Node'dadır); kutuUygun: true ise KRA ve YA'da kutu cihaz payı alır (uygunCihaz)
//   { k: 'kapat', no, yazmadan }
// Giden: { k: 'hazir', me }, { k: 'cevap', no, sonuc | hata }, { k: 'olay', olay, veri }, { k: 'ag', to, type, b }
'use strict'
/* global Bare */
const b4a = require('b4a')
const { start } = require('../..')
const { urunSunucusu } = require('../../example/product')
const { ipcCifti, istemci } = require('./common')
const { torenTasiyici, TOREN_TURLERI } = require('./ceremony-transport')

let yazici
let okuyucu
let bitir
if (typeof Bare !== 'undefined') {
  const Pipe = require('bare-pipe')
  const i = new Pipe(0)
  const o = new Pipe(1)
  okuyucu = (f) => i.on('data', f)
  yazici = (s) => o.write(s)
  bitir = () => { i.destroy(); o.end(); o.on('finish', () => Bare.exit(0)) }
  // Ana süreç ölünce (zaman aşımında brittle abort eder, çıkış kancası çalışmaz) stdin kapanır: çocuk da kapanır (D75)
  i.on('end', () => Bare.exit(0))
  i.on('close', () => Bare.exit(0))
} else {
  okuyucu = (f) => process.stdin.on('data', f)
  yazici = (s) => process.stdout.write(s)
  bitir = () => process.stdout.write('', () => process.exit(0))
  process.stdin.on('end', () => process.exit(0))
  process.stdin.on('close', () => process.exit(0))
  process.stdout.on('error', () => process.exit(0)) // ana süreç gitti (EPIPE)
}
const yaz = (j) => yazici(JSON.stringify(j) + '\n')

let w = null
let cl = null
let agIsl = null
let kimlik = { ad: '', cihazAdi: '' }
let kutuPayAyar = null
let dhtDugum = null
let dhtTasiyici = null
let kutuTt = null
let kp = null
// Kutunun pay tutucusu: aile bağlandıktan sonra bir kez kurulur (yeniden başlatmada mühürden yükler)
function kutuPaylari () {
  if (kp) return kp
  const n = w.kalici.nesneler
  if (!kutuPayAyar || !n.aile) throw new Error('NO_BOX_SHARE')
  const { KutuPaylari } = require('../../../node/box-share')
  const { taklitTpm } = require('../../../node/tpm')
  require('#fs').mkdirSync(kutuPayAyar.dizin, { recursive: true }) // kutu Bare'de de koşar (D62)
  kp = new KutuPaylari({ ledger: n.ledger, me: w.kalici.kimlik, dizin: kutuPayAyar.dizin, tpm: taklitTpm({ test: true, anahtar: b4a.from(kutuPayAyar.tpmAnahtarHex, 'hex') }), testKipi: true })
  return kp
}

const tt = torenTasiyici({
  cihaz: () => w.tasiyiciCihazi(kimlik),
  gonder: (to, type, bytes) => yaz({ k: 'ag', to, type, b: b4a.toString(bytes, 'hex') })
})

const ag = {
  gonder: (to, type, bytes) => { yaz({ k: 'ag', to, type, b: b4a.toString(bytes, 'hex') }); return true },
  dinle: (isl) => { agIsl = isl }
}

async function isle (j) {
  switch (j.k) {
    case 'start': {
      kimlik = { ad: j.ad, cihazAdi: j.cihazAdi }
      const ipc = ipcCifti()
      cl = istemci(ipc)
      cl.olaylar.push = (x) => { yaz({ k: 'olay', olay: x.olay, veri: x.veri, ...(x.aile ? { aile: x.aile } : {}) }); return 0 }
      kutuPayAyar = j.kutuPay || null
      const uygunCihaz = j.kutuUygun ? (id) => !!w && w.kalici.nesneler.aile && w.kalici.nesneler.ledger.members.get(id)?.role === 'kutu' : () => false
      let agK = ag
      let ttK = tt
      if (j.dht && j.tekAyar) {
        // D76: uygulamanın tek ayarı (start({ tasiyici: { deneysel: true } })); çekirdek taşıyıcıyı kendisi kurar
        w = await start({ urunSunucusu, dizin: j.dizin, anahtar: b4a.from(j.anahtarHex, 'hex'), archivePubHex: j.archivePubHex, sayac: j.sayac ?? null, ipc, appId: 'ornek', uygunCihaz, tasiyici: { deneysel: true, onyukleme: j.dht, ad: kimlik.ad, cihazAdi: kimlik.cihazAdi, yoklamaMs: j.yoklamaMs || undefined } })
        yaz({ k: 'hazir', me: b4a.toString(w.kalici.kimlik.memberId, 'hex') })
        return
      }
      if (j.dht) {
        const DHT = require('hyperdht')
        const { DhtTasiyici } = require('@havenfold/transport')
        const { dhtTorenTasiyici } = require('@havenfold/transport/ceremony')
        // Aynı makinedeki yerel testnet'te düğümler doğrudan erişilebilir sayılır (firewalled: false): genç düğümler
        // arasında aynı makinede delik açma arada bir yarıda kalıyor (istemci açılır, sunucuya bağlantı gelmez). Telefonda
        // delik açma gerçek ağda yapılır; bu seçenek yalnız testte (kollar/D-tasiyici-oneri.md §8)
        dhtDugum = new DHT({ bootstrap: j.dht, firewalled: false })
        const cihazOf = () => (w ? w.tasiyiciCihazi(kimlik) : null)
        const zaman = j.yoklamaMs ? { yoklamaMs: j.yoklamaMs, hizliMs: j.yoklamaMs } : {}
        if (j.kutuTasiyici) {
          // D58: kutu düğüm yazılımının taşıyıcısıyla (node/box-transport.js, kutu rolüyle)
          const kt = require('../../../node/box-transport').kutuTasiyici({ dht: dhtDugum, cihaz: cihazOf, deneysel: true, ...zaman })
          dhtTasiyici = kt.tasiyici
          ttK = kt.toren
        } else {
          dhtTasiyici = new DhtTasiyici({ dht: dhtDugum, cihaz: cihazOf, deneysel: true, ...zaman })
          ttK = dhtTorenTasiyici({ dht: dhtDugum, cihaz: cihazOf, tamam: () => dhtTasiyici.yokla(), deneysel: true })
        }
        agK = dhtTasiyici.ag
        kutuTt = ttK
      }
      w = await start({ urunSunucusu, dizin: j.dizin, anahtar: b4a.from(j.anahtarHex, 'hex'), archivePubHex: j.archivePubHex, sayac: j.sayac ?? null, ipc, appId: 'ornek', torenTasiyici: ttK, ag: agK, uygunCihaz, kutuPay: kutuPayAyar ? { payAl: (p, b, yol) => kutuPaylari().payAl(p, b, yol), surumIstegiAl: (p, b, yol) => kutuPaylari().surumIstegiAl(p, b, yol), payIstegiAl: (p, b, yol) => kutuPaylari().payIstegiAl(p, b, yol), zarfAl: (p, b, yol) => kutuPaylari().zarfAl(p, b, yol), zarfIstegiAl: (p, b, yol) => kutuPaylari().zarfIstegiAl(p, b, yol) } : null })
      if (dhtTasiyici) dhtTasiyici.baslat()
      yaz({ k: 'hazir', me: b4a.toString(w.kalici.kimlik.memberId, 'hex') })
      return
    }
    case 'iste':
      try { yaz({ k: 'cevap', no: j.no, sonuc: await cl.iste(j.komut, j.govde || {}, j.aile) }) } catch (err) { yaz({ k: 'cevap', no: j.no, hata: err.message }) }
      return
    case 'ag': {
      const bytes = b4a.from(j.b, 'hex')
      if (TOREN_TURLERI.has(j.type)) tt.al(j.from, j.type, bytes)
      else if (agIsl) agIsl.al(j.from, j.type, bytes, j.yol || 'dogrudan')
      return
    }
    case 'bag': if (agIsl) agIsl.baglandi(j.peer); return
    case 'kop': if (agIsl) agIsl.koptu(j.peer); return
    case 'kutuQr': yaz({ k: 'cevap', no: j.no, sonuc: await (kutuTt || tt).kutuDavet() }); return
    case 'kutuSayi': {
      const k = w.kalici.kutu()
      yaz({ k: 'cevap', no: j.no, sonuc: k ? [...k.cols.values()].reduce((n, x) => n + x.ops.size, 0) : null })
      return
    }
    case 'torenAnahtarlari': {
      // Anahtarın kendisi değil, özeti (iki tarafın aynı anahtarı tuttuğu karşılaştırılır)
      const { kdf } = require('@havenfold/core')
      const m = w.kalici.torenAnahtarlari || new Map()
      yaz({ k: 'cevap', no: j.no, sonuc: Object.fromEntries([...m].map(([p, v]) => [p, b4a.toString(kdf.hash('test/toren-ozet', b4a.from(v, 'hex')), 'hex')])) })
      return
    }
    case 'kutuPaylari':
      try { yaz({ k: 'cevap', no: j.no, sonuc: kutuPaylari().liste() }) } catch (err) { yaz({ k: 'cevap', no: j.no, hata: err.message }) }
      return
    case 'kutuZarflari':
      try { yaz({ k: 'cevap', no: j.no, sonuc: kutuPaylari().zarfListesi() }) } catch (err) { yaz({ k: 'cevap', no: j.no, hata: err.message }) }
      return
    case 'kapat':
      if (dhtTasiyici) await dhtTasiyici.kapat()
      if (dhtDugum) await dhtDugum.destroy()
      w.kapat({ yazmadan: !!j.yazmadan })
      yaz({ k: 'cevap', no: j.no, sonuc: { sayac: w.kalici.sayac } })
      bitir()
  }
}

let tampon = ''
let sira = Promise.resolve()
okuyucu((d) => {
  tampon += b4a.toString(d)
  let i
  while ((i = tampon.indexOf('\n')) >= 0) {
    const satir = tampon.slice(0, i)
    tampon = tampon.slice(i + 1)
    if (!satir.trim()) continue
    const j = JSON.parse(satir)
    // Komutlar sırayla; ağ zarfları da aynı sırada (boru sırası korunur)
    sira = sira.then(() => isle(j)).catch((err) => yaz({ k: 'olay', olay: 'cihaz-hata', veri: { hata: err.message, neden: err.neden, dosya: err.dosya, yigin: String(err.stack || '').split('\n').slice(0, 4).join(' | ') } }))
  }
})
