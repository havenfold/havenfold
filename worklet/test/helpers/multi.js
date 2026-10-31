// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Çok cihazlı testin ana süreci (D34): her cihaz ayrı bir süreçtir (test Node'da koşuyorsa Node, Bare'de Bare);
// bu süreç uygulamaların yerine komut gönderir ve ağın yerine zarfları cihazlar arasında taşır (boru yönlendiricisi).
// Çevrimdışı cihaza giden zarf atılır (gerçek ağda olduğu gibi); yeniden çevrimiçi olunca oturumlar yeniden açılır.
'use strict'
/* global Bare */
const b4a = require('b4a')
const { spawn } = typeof Bare !== 'undefined' ? require('bare-subprocess') : require('child_process')

const YURUTUCU = typeof Bare !== 'undefined' ? Bare.argv[0] : process.execPath
const BETIK = __dirname + '/device.js'

// Bütün cihaz süreçleri (D75): test hata ya da zaman aşımıyla düşse de hiçbiri sahipsiz kalmasın. Çıkışta ve sinyalde
// SIGKILL; ana süreç abort ederse (brittle zaman aşımı) çocuk stdin kapanınca kendini kapatır (device.js).
const COCUKLAR = new Set()
function hepsiniOldur () {
  for (const p of COCUKLAR) { try { p.kill('SIGKILL') } catch {} }
  COCUKLAR.clear()
}
if (typeof Bare !== 'undefined') {
  Bare.on('exit', hepsiniOldur)
} else {
  process.on('exit', hepsiniOldur)
  for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(s, () => { hepsiniOldur(); process.exit(1) })
}

class Cihaz {
  constructor (ag, ad) {
    this.ag = ag
    this.ad = ad
    this.me = null
    this.canli = false
    this.olaylar = []
    this.hatalar = []
    this.bekleyen = new Map()
    this.no = 0
  }

  // o.node: bu cihaz Node'da koşar (kutu: düğüm yazılımı Node'dadır); test Bare'de koşuyorsa PATH'teki node
  async start (o) {
    const yurutucu = o.node ? (typeof Bare !== 'undefined' ? 'node' : process.execPath) : YURUTUCU
    const { node, ...ayar } = o
    o = ayar
    this.p = spawn(yurutucu, [BETIK], { stdio: ['pipe', 'pipe', 'inherit'] })
    COCUKLAR.add(this.p)
    this.cikti = new Promise((resolve) => this.p.on('exit', (kod) => { this.canli = false; COCUKLAR.delete(this.p); resolve(kod) }))
    let tampon = ''
    const hazir = new Promise((resolve, reject) => { this._hazir = resolve; this._hazirDegil = reject })
    this.p.stdout.on('data', (d) => {
      tampon += b4a.toString(d)
      let i
      while ((i = tampon.indexOf('\n')) >= 0) {
        const satir = tampon.slice(0, i)
        tampon = tampon.slice(i + 1)
        if (satir.trim()) this._gelen(JSON.parse(satir))
      }
    })
    this._yaz({ k: 'start', ad: this.ad, cihazAdi: this.ad + ' cihazı', ...o })
    await hazir
    this.canli = true
    this.ag.katildi(this)
  }

  _yaz (j) { this.p.stdin.write(JSON.stringify(j) + '\n') }

  _gelen (j) {
    if (j.k === 'hazir') { this.me = j.me; this._hazir(); return }
    if (j.k === 'cevap') {
      const b = this.bekleyen.get(j.no)
      this.bekleyen.delete(j.no)
      if (b) { if (j.hata) b.reject(new Error(j.hata)); else b.resolve(j.sonuc) }
      return
    }
    if (j.k === 'olay') {
      this.olaylar.push(j)
      if (j.olay === 'core-error' || j.olay === 'cihaz-hata') this.hatalar.push(j.veri)
      if (j.olay === 'cihaz-hata' && !this.canli && this._hazirDegil) this._hazirDegil(new Error(j.veri.hata + ' ' + JSON.stringify(j.veri)))
      return
    }
    if (j.k === 'ag') this.ag.tasi(this, j)
  }

  _cagir (j) {
    const no = ++this.no
    return new Promise((resolve, reject) => { this.bekleyen.set(no, { resolve, reject }); this._yaz({ ...j, no }) })
  }

  iste (komut, govde = {}, aile) { return this._cagir({ k: 'iste', komut, govde, ...(aile ? { aile } : {}) }) }
  kutuQr () { return this._cagir({ k: 'kutuQr' }) }
  kutuSayi () { return this._cagir({ k: 'kutuSayi' }) }
  kutuPaylari () { return this._cagir({ k: 'kutuPaylari' }) }
  torenAnahtarlari () { return this._cagir({ k: 'torenAnahtarlari' }) }
  kutuZarflari () { return this._cagir({ k: 'kutuZarflari' }) }

  async kapat ({ yazmadan = false } = {}) {
    this.ag.ayrildi(this)
    const r = await this._cagir({ k: 'kapat', yazmadan })
    await this.cikti
    return r
  }

  // Son gelen tören olayı (adim)
  // aile: yalnız o örneğin olayları (RFC-0034; birden çok örnekte olay aile taşır)
  toren (adim, aile) { return this.olaylar.filter((x) => x.olay === 'ceremony' && x.veri.adim === adim && (aile === undefined || x.aile === aile)).at(-1)?.veri || null }
}

class BoruAgi {
  constructor () {
    this.cihazlar = new Map() // ad → Cihaz
    this.cevrimdisi = new Set()
    this.sayac = { zarf: 0, atilan: 0 }
  }

  cihaz (ad) {
    if (!this.cihazlar.has(ad)) this.cihazlar.set(ad, new Cihaz(this, ad))
    return this.cihazlar.get(ad)
  }

  _acik (c) { return c.canli && !this.cevrimdisi.has(c.ad) }
  _uclar (c) { return [...this.cihazlar.values()].filter((x) => x !== c && this._acik(x)) }

  _bag (a, b) { a._yaz({ k: 'bag', peer: b.me }); b._yaz({ k: 'bag', peer: a.me }) }
  _kop (a, b) { if (a.canli) a._yaz({ k: 'kop', peer: b.me }); if (b.canli) b._yaz({ k: 'kop', peer: a.me }) }

  katildi (c) { if (!this.cevrimdisi.has(c.ad)) for (const x of this._uclar(c)) this._bag(c, x) }
  ayrildi (c) { if (this._acik(c)) for (const x of this._uclar(c)) this._kop(c, x) }

  cevrimdisiYap (ad) {
    const c = this.cihaz(ad)
    if (this._acik(c)) for (const x of this._uclar(c)) this._kop(c, x)
    this.cevrimdisi.add(ad)
  }

  cevrimiciYap (ad) {
    this.cevrimdisi.delete(ad)
    const c = this.cihaz(ad)
    if (c.canli) for (const x of this._uclar(c)) this._bag(c, x)
  }

  tasi (kimden, j) {
    const kime = [...this.cihazlar.values()].find((x) => x.me === j.to)
    if (!kime || !this._acik(kimden) || !this._acik(kime)) { this.sayac.atilan++; return }
    this.sayac.zarf++
    kime._yaz({ k: 'ag', from: kimden.me, type: j.type, b: j.b, yol: 'dogrudan' })
  }
}

// Koşul sağlanana kadar yoklar (en çok sure ms); dönüş son değer
// Bekleme süresi makinenin yüküyle büyür (D68: tam kontrol ve bulanık test aynı anda koşarken yerel testnet yavaşlar).
// Çarpan: 1 dakikalık yük ortalaması / çekirdek sayısı × 2, en az 1 en çok 4; HF_BEKLEME_CARPANI verilirse o
/* global Bare */
function yukCarpani () {
  const BARE = typeof Bare !== 'undefined'
  const env = BARE ? (Bare.env || {}) : process.env
  if (env.HF_BEKLEME_CARPANI) return Math.max(1, Number(env.HF_BEKLEME_CARPANI) || 1)
  try {
    const os = BARE ? require('bare-os') : require('o' + 's') // Bare düz yazılmış require('os')'i önceden çözer
    const n = BARE ? os.availableParallelism() : (os.availableParallelism ? os.availableParallelism() : os.cpus().length)
    return Math.min(4, Math.max(1, 2 * os.loadavg()[0] / Math.max(1, n)))
  } catch { return 1 }
}

async function bekle (f, { sure = 20000, aralik = 50, neden = 'koşul' } = {}) {
  const son = Date.now() + sure * yukCarpani()
  let hata = null
  while (Date.now() < son) {
    try { const v = await f(); if (v) return v } catch (err) { hata = err }
    await new Promise((resolve) => setTimeout(resolve, aralik))
  }
  throw new Error('TIMEOUT: ' + neden + (hata ? ' (' + hata.message + ')' : ''))
}

const uyu = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

module.exports = { BoruAgi, Cihaz, bekle, uyu, hepsiniOldur, yukCarpani }
