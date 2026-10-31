// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Kişisel köprü testinin uygulama süreci (D46): aynı telefondaki bir uygulama (Mekan Hat: ekip, Yuva Hat: aile). Ortak
// dizin işletim sisteminin aynı geliştiricinin uygulamalarına verdiği kısıtlı yolun (iOS uygulama grubu kabı) yerine
// geçer; her uygulamanın kendi dizininde kalıcı ayarı (düğmeler, görülen nonce'lar) durur.
// Bağımsız değişkenler: kendi ortakDizin kendiDizin. Komutlar stdin'den satır satır JSON; cevaplar stdout'a.
'use strict'
/* global Bare */
const BARE = typeof Bare !== 'undefined'
const fs = require(BARE ? 'bare-fs' : 'f' + 's')
const { BridgeApi } = require('@havenfold/sdk')

const [kendi, ortak, kendiDizin] = (BARE ? Bare.argv : process.argv).slice(2)
const ayarDosyasi = kendiDizin + '/kopru.json'
const ayar = (() => { try { return JSON.parse(fs.readFileSync(ayarDosyasi, 'utf8')) } catch { return {} } })()
const saklama = {
  get: (k) => (k in ayar ? ayar[k] : null),
  set: (k, v) => { ayar[k] = v; fs.writeFileSync(ayarDosyasi, JSON.stringify(ayar)) }
}
const hedef = kendi === 'ekip' ? 'aile' : 'ekip'
// Yön klasörleri (RFC-0027 §7 a): yalnız kendi yönüne yazar, yalnız karşı yönden okur; yazanı klasör söyler
const giden = `${ortak}/${kendi}-${hedef}`
const gelen = `${ortak}/${hedef}-${kendi}`
for (const d of [giden, gelen]) fs.mkdirSync(d, { recursive: true })
const UYGULAMA = { ekip: 'Mekan Hat', aile: 'Yuva Hat' }
let sira = 0
const kanal = {
  birak: (metin) => fs.writeFileSync(`${giden}/${Date.now()}-${sira++}.txt`, metin),
  temizle: () => { for (const ad of fs.readdirSync(giden)) fs.unlinkSync(giden + '/' + ad) }
}
const kopru = new BridgeApi({ kendi, saklama, kanal })

let okuyucu, yazici, bitir
if (BARE) {
  const Pipe = require('bare-pipe')
  const i = new Pipe(0)
  const o = new Pipe(1)
  okuyucu = (f) => i.on('data', f)
  yazici = (s) => o.write(s)
  bitir = () => { i.destroy(); o.end(); o.on('finish', () => Bare.exit(0)) }
} else {
  okuyucu = (f) => process.stdin.on('data', f)
  yazici = (s) => process.stdout.write(s)
  bitir = () => process.stdout.write('', () => process.exit(0))
}

// Karşı yönün klasöründeki paketler. Başarıyla alınanı SDK kanaldan siler (al'ın sil kancası, RFC-0027 §7 c);
// reddedilen paketi bu uygulama atar (yeniden önizlenmesin)
function gelenler () {
  const out = []
  for (const ad of fs.readdirSync(gelen).sort()) {
    const yol = gelen + '/' + ad
    const metin = fs.readFileSync(yol, 'utf8')
    try { out.push({ onizleme: kopru.receive(metin, { kaynak: hedef, uygulama: UYGULAMA[hedef], sil: () => fs.unlinkSync(yol) }), metin }) } catch (err) { fs.unlinkSync(yol); out.push({ hata: err.message, metin }) }
  }
  return out
}

// Sınama için: karşı yön klasörüne ham paket koyar (o yöndeki uygulama yazmış gibi; işletim sistemi başka uygulamaya
// bu klasörü açmaz)
const koy = (g) => { fs.writeFileSync(`${gelen}/koy-${sira++}.txt`, g.metin); return true }

const islemler = {
  dugmeler: (g) => kopru.buttons(g.turler || null),
  hazirla: (g) => kopru.prepare({ type: g.type, text: g.text }).yol,
  gelenler: () => gelenler(),
  al: (g) => kopru.receive(g.metin, { kaynak: hedef }),
  koy: (g) => koy(g),
  kapat: () => { kopru.close(); return true },
  gidenSayisi: () => fs.readdirSync(giden).length,
  bitir: () => { setTimeout(bitir, 10); return true }
}

let tampon = ''
okuyucu((parca) => {
  tampon += parca.toString()
  let i
  while ((i = tampon.indexOf('\n')) >= 0) {
    const satir = tampon.slice(0, i)
    tampon = tampon.slice(i + 1)
    const g = JSON.parse(satir)
    try { yazici(JSON.stringify({ no: g.no, sonuc: islemler[g.islem](g) }) + '\n') } catch (err) { yazici(JSON.stringify({ no: g.no, hata: err.message }) + '\n') }
  }
})
yazici(JSON.stringify({ hazir: kendi }) + '\n')
