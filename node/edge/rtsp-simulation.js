// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// edge/rtsp-simulation.js — havenfold-rtsp (mediamtx) yerine benzetim (D86; ikili bu adımda indirilmez ve kurulmaz).
// Aynı sözleşme: görevin ağ ad alanında yalnız 127.0.0.1:8554 dinler, kareleri denetçiden akis.sock ile alır, görev
// konteyneri rtsp://127.0.0.1:8554/<sourceId hex> adresinden okur (RFC-0008 §11.5 madde 3–5). Gerçek RTSP konuşmaz:
// okuyucu "OKU /<sourceId hex>\n" yazar, "TAMAM\n" ya da "YOK\n" alır; sonra her kare uzunluk (u32be) ‖ key (u8) ‖
// ts (u32be) ‖ veri olarak gelir. Yeni okuyucu bir anahtar kareden başlar; bağlanınca denetçiden anahtar kare istenir.
// Disk yazılmaz: kareler yalnız bellekte geçer (Bakım YB12, YB2). Görevin pod'unda ayrı, sertleştirilmiş bir konteynerde
// çalışır (podman.js akisPodKur; inceleme 23 madde 2). Geri basınç (madde 6): en çok 4 okuyucu; bir okuyucunun bekleyen
// verisi sınırı aşınca kareleri atlanır ve sonraki anahtar kareden sürer. KAPAT yalnız güncel yazardan (madde 5).
const net = require('net')
const fs = require('fs')
const b4a = require('b4a')
const A = require('./stream-socket')

const GERI_DONGU = '127.0.0.1'
const PORT = 8554
const EN_COK_OKUYUCU = 4
const OKUYUCU_TAMPON = 2 * 1024 * 1024

function fail (code) { throw new Error(code) }

class RtspBenzetimi {
  /** o: { soketYolu (akis.sock), sourceHex, adres?: yalnız '127.0.0.1', port?: 8554 (testte 0) } */
  constructor ({ soketYolu, sourceHex, adres = GERI_DONGU, port = PORT }) {
    if (adres !== GERI_DONGU) fail('ADDRESS_FORBIDDEN') // §11.5 madde 4, 6: ev ağı, internet ve diğer görevler ulaşamaz
    if (!/^[0-9a-f]{32}$/.test(sourceHex)) fail('INVALID_SOURCE')
    this.soketYolu = soketYolu
    this.sourceHex = sourceHex
    this.adres = adres
    this.port = port
    this.okuyucular = new Set() // { soket, hazir: anahtar kare görüldü mü }
    this.denetci = null // akis.sock üstündeki bağlantı
    this.kareSayisi = 0
    this.kapandi = null
  }

  async baslat () {
    try { fs.unlinkSync(this.soketYolu) } catch {}
    this.akisSunucu = net.createServer((s) => this._denetciBaglandi(s))
    await new Promise((resolve, reject) => { this.akisSunucu.once('error', reject); this.akisSunucu.listen(this.soketYolu, resolve) })
    // Denetçi başka kullanıcı (havenfold-denetci); görev dizini havenfold-gorev grubunda (2770): grup okur-yazar
    fs.chmodSync(this.soketYolu, 0o660)
    this.rtsp = net.createServer((s) => this._okuyucu(s))
    await new Promise((resolve, reject) => { this.rtsp.once('error', reject); this.rtsp.listen(this.port, this.adres, resolve) })
    this.port = this.rtsp.address().port
    return this
  }

  _denetciBaglandi (s) {
    // Tek yazar: akış yenilenince (24 saat) yeni bağlantı eskisinin yerini alır
    if (this.denetci) this.denetci.destroy()
    this.denetci = s
    const ok = new A.Okuyucu()
    s.on('data', (p) => {
      let cs
      try { cs = ok.besle(p) } catch { s.destroy(); return }
      for (const c of cs) {
        if (s !== this.denetci) return // yenilenmiş akışın eski yazarı: hiçbir çerçevesi işlenmez (madde 5)
        if (c.tur === A.TUR.KARE) this._kare(A.kareCoz(c.govde))
        else if (c.tur === A.TUR.KAPAT) this._kapat(b4a.toString(c.govde))
      }
    })
    s.on('error', () => {})
    s.on('close', () => { if (this.denetci === s) this.denetci = null })
    if (this.okuyucular.size) s.write(A.anahtarIste())
  }

  _kare ({ key, ts, data }) {
    this.kareSayisi++
    const g = b4a.alloc(9 + data.byteLength)
    const dv = new DataView(g.buffer, g.byteOffset, g.byteLength)
    dv.setUint32(0, 5 + data.byteLength)
    g[4] = key ? 1 : 0
    dv.setUint32(5, ts >>> 0)
    g.set(data, 9)
    for (const o of this.okuyucular) {
      if (o.soket.writableLength > OKUYUCU_TAMPON) { o.hazir = false; o.atilan = (o.atilan || 0) + 1; continue }
      if (!o.hazir && !key) continue
      o.hazir = true
      o.soket.write(g)
    }
  }

  _okuyucu (s) {
    s.on('error', () => {}) // macOS okunmamış veriyle kapanan sokette RST verir: ECONNRESET/EPIPE kapanıştır
    if (this.okuyucular.size >= EN_COK_OKUYUCU) { s.destroy(); return }
    let tampon = ''
    const o = { soket: s, hazir: false }
    const ilk = (p) => {
      tampon += b4a.toString(p)
      const i = tampon.indexOf('\n')
      if (i < 0) { if (tampon.length > 256) s.destroy(); return }
      s.removeListener('data', ilk)
      if (tampon.slice(0, i) !== 'OKU /' + this.sourceHex) { s.end('YOK\n'); return }
      s.write('TAMAM\n')
      this.okuyucular.add(o)
      if (this.denetci) this.denetci.write(A.anahtarIste())
    }
    s.on('data', ilk)
    s.on('close', () => this.okuyucular.delete(o))
  }

  _kapat (kod) {
    this.kapandi = kod
    for (const o of this.okuyucular) o.soket.end()
  }

  async kapat () {
    for (const o of this.okuyucular) o.soket.destroy()
    if (this.denetci) this.denetci.destroy()
    await Promise.all([this.akisSunucu, this.rtsp].filter(Boolean).map((x) => new Promise((resolve) => x.close(() => resolve()))))
    try { fs.unlinkSync(this.soketYolu) } catch {}
  }
}

// Giriş: node rtsp-simulation.js --soket <akis.sock> --kaynak <sourceId hex> (yetki yardımcısı, görevin ad alanında başlatır)
function ana (argv = process.argv.slice(2)) {
  const deger = (ad) => { const i = argv.indexOf(ad); return i >= 0 ? argv[i + 1] : null }
  const b = new RtspBenzetimi({ soketYolu: deger('--soket'), sourceHex: deger('--kaynak') || '', port: Number(deger('--port') || PORT) })
  b.baslat().then(() => {
    const dur = () => { b.kapat().finally(() => process.exit(0)) }
    process.once('SIGTERM', dur)
    process.once('SIGINT', dur)
  }, (err) => { console.error('havenfold-rtsp (benzetim): ' + err.message); process.exit(1) })
}

if (require.main === module) ana()

module.exports = { RtspBenzetimi, GERI_DONGU, PORT, EN_COK_OKUYUCU, OKUYUCU_TAMPON, ana }
