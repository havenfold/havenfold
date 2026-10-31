// SPDX-License-Identifier: AGPL-3.0-only
// server.js — referans alıcının HTTP sarmalayıcısı. TLS önünde bir ters vekilde sonlanır (kurucu §13.2: protokol dışı TLS).
//   node server.js <port> <kart dosyası (hex)> [<kart dosyası> …]
//   HF_VEKIL=127.0.0.1 (virgülle birden çok): bu adreslerden gelen istekte istemci adresi x-forwarded-for'un son değeri
//   (vekil gördüğü adresi sona ekler; öncesini istemci yazabilir)
//   HF_SOURCE=<adres>: çalışan sürümün kaynağı (AGPL-3.0 §13). GET /source bu adresi verir, her cevap x-hf-source
//   başlığını taşır. Varsayılan bu depo; değiştirilmiş sürümü işleten, kendi kaynağının adresini ve kaydını verir.
//   Eski adlar da çalışır: HF_KAYNAK, GET /kaynak ve x-hf-kaynak başlığı (Codex 12. tur).
const http = require('http')
const { Alici } = require('./receiver')

const KAYNAK = 'https://github.com/havenfold/havenfold'

// Sunucu katmanının sınırları (açılış öncesi inceleme): en çok enCokBaglanti eşzamanlı bağlantı; istek en çok istekMs;
// alıcının beklenmedik hatası 500 olur, süreç düşmez (bellek içi depo kaybolmasın). Gövde belleğe alınmadan önce
// (Codex 4. tur): alıcının ön denetimi (onDenetim: yanlış yol, eksik sahip başlığı, taşınmayan hizmet) ve yolun gövde
// sınırı; bildirilen boy (content-length) sınırı aşıyorsa 413; bir istemcinin (alıcının adres anahtarı) en çok
// istemciIstek eşzamanlı isteği (429); bütün isteklerin bellekte bekleyen gövdeleri birlikte en çok bekleyenBayt (503;
// bildirilen boy baştan ayrılır, bildirilmemişse geldikçe).
function sunucuKur (alici, { enCokBayt = 26 * 1024 * 1024, kaynak = KAYNAK, enCokBaglanti = 512, istekMs = 120_000, bekleyenBayt = 256 * 1024 * 1024, istemciIstek = 8 } = {}) {
  let bekleyen = 0
  const istemciler = new Map() // adres anahtarı → eşzamanlı istek
  const s = http.createServer((req, res) => {
    res.setHeader('x-hf-source', kaynak)
    res.setHeader('x-hf-kaynak', kaynak)
    // Gövde okunmaz; cevap yazılır ve bağlantı kapanır
    const reddet = (durum) => {
      res.writeHead(durum, { connection: 'close' })
      res.end(() => req.destroy())
    }
    if (req.method === 'GET' && (req.url === '/source' || req.url === '/kaynak')) {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(kaynak + '\n')
      return
    }
    const basliklar = Object.fromEntries(Object.entries(req.headers).map(([a, v]) => [a.toLowerCase(), Array.isArray(v) ? v[0] : v]))
    let on
    try {
      on = typeof alici.onDenetim === 'function' ? alici.onDenetim({ yontem: req.method, yol: req.url, basliklar }) : { enCok: enCokBayt }
    } catch {
      on = { durum: 500 }
    }
    if (on.durum) return reddet(on.durum)
    const sinir = Math.min(enCokBayt, on.enCok)
    const bildirilen = Number(req.headers['content-length'])
    if (Number.isFinite(bildirilen) && bildirilen > sinir) return reddet(413)
    const ip = req.socket.remoteAddress || ''
    let adres
    try { adres = typeof alici.adres === 'function' ? alici.adres(ip, basliklar) : ip } catch { adres = ip }
    if ((istemciler.get(adres) || 0) >= istemciIstek) return reddet(429)
    istemciler.set(adres, (istemciler.get(adres) || 0) + 1)
    let ayrilan = 0
    let birakildi = false
    res.on('close', () => {
      if (birakildi) return
      birakildi = true
      bekleyen -= ayrilan
      const n = istemciler.get(adres) - 1
      if (n > 0) istemciler.set(adres, n)
      else istemciler.delete(adres)
    })
    const ayir = (n) => {
      if (n <= ayrilan) return true
      if (bekleyen + n - ayrilan > bekleyenBayt) return false
      bekleyen += n - ayrilan
      ayrilan = n
      return true
    }
    if (Number.isFinite(bildirilen) && !ayir(bildirilen)) return reddet(503)
    const parcalar = []
    let boy = 0
    let durdu = false
    req.on('data', (b) => {
      if (durdu) return
      boy += b.byteLength
      const durum = boy > sinir ? 413 : !ayir(boy) ? 503 : 0
      if (durum) {
        durdu = true
        parcalar.length = 0
        reddet(durum)
        return
      }
      parcalar.push(b)
    })
    req.on('end', () => {
      if (durdu) return
      let c
      let govde
      try {
        c = alici.istek({ yontem: req.method, yol: req.url, basliklar, govde: Buffer.concat(parcalar), ip })
        govde = c.govde == null ? null : Buffer.isBuffer(c.govde) ? c.govde : Buffer.from(JSON.stringify(c.govde))
      } catch {
        c = { durum: 500 }
        govde = null
      }
      res.writeHead(c.durum, govde ? { 'content-type': c.tur, 'content-length': govde.byteLength } : {})
      res.end(govde)
    })
  })
  s.maxConnections = enCokBaglanti
  s.requestTimeout = istekMs
  s.bekleyenBayt = () => bekleyen // test ve gözlem için
  return s
}

/* c8 ignore start */ // komut satırı girişi; işlevler testte
if (require.main === module) {
  const fs = require('fs')
  const [port, ...kartlar] = process.argv.slice(2)
  const vekil = process.env.HF_VEKIL ? { adresler: process.env.HF_VEKIL.split(',').map((x) => x.trim()), baslik: 'x-forwarded-for' } : null
  const alici = new Alici({ kartlar: kartlar.map((f) => Buffer.from(fs.readFileSync(f, 'utf8').trim(), 'hex')), vekil })
  sunucuKur(alici, { kaynak: process.env.HF_SOURCE || process.env.HF_KAYNAK || KAYNAK }).listen(Number(port) || 8480, () => console.log('hizmet alıcısı dinliyor: ' + (Number(port) || 8480)))
}
/* c8 ignore stop */

module.exports = { sunucuKur, KAYNAK }
