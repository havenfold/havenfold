// SPDX-License-Identifier: AGPL-3.0-only
// receiver.js — hizmet paketlerinin referans alıcısı (RFC-0010 §13.1): arayüzün en küçük uygulaması
//
// İstek işleyici HTTP'den bağımsızdır: istek({ yontem, yol, basliklar, govde, ip }) → { durum, govde, tur }. HTTP sarmalayıcı
// server.js'te. Depo bellek içidir (referans; kalıcı depo kuran alıcı aynı arayüzü uygular). Alıcı paketin içini görmez:
// yalnız dış kabuğu (PAKET, CEVAP) kanonik çözer, sahibin özetini ve hizmetin imzasını denetler.
//
// Listeler JSON'dur, baytlar base64:
//   GET /v1/inbox/{serviceId}?after={t}&afterId={packageId} → { paketler: [{ packageId, t, bytes, dosyalar: [{ blobId, index, boy }] }], devam }
//     (sıra (t, packageId); ilk istek after=0, afterId yok; sonrakiler son paketin t'si ve packageId'siyle, afterId'siz
//     after > 0 400; devam: true ise sayfa doldu, hizmet hemen yeniden ister)
//   GET /v1/r/{packageId}?after={n}     → { cevaplar: [{ n, bytes }] }
// Başlıklar: x-hf-owner (64 hex), x-hf-owner-secret (64 hex), x-hf-auth (cevap.yetkiBasligi; imzalanan yol sorgu dahil).
// RFC'nin tablosunda olmayan iki ek (İstek 12): hizmetin paket dosyasını çekmesi GET /v1/b/{serviceId}/{blobId}/{index}
// (x-hf-auth) ve ack gövdesi: isteğe bağlı 8 bayt u64be useUntil (hizmet paketi açınca bilir); cevap penceresi
// min(useUntil, ack + 30 gün). useUntil verilmezse ack + 30 gün.
//
// Depo sınırları (açılış öncesi inceleme): boş dosya parçası yok (400); bir sahibin bir hizmette paketleri ve dosyaları
// birlikte en çok min(maxMB, dosyaToplam), en çok dosyaAdet parça (413); bir adresin saatte yükleyebileceği bayt ipSaatBayt
// (429; yeni sahip ve paket sayısı ayrıca ipSaat); bir hizmetin deposu servisBayt, bütün depo depoBayt ve depoAdet (507).
// Gelen kutusu sayfalıdır: bir cevapta en çok gelenAdet paket ve gelenBayt (tek paket sınırdan büyükse yalnız o); imleç
// (t, packageId), aynı t'deki paketler sayfalara bölünebilir. Cevaplar da hizmet deposuna sayılır (servisBayt).
// HTTP katmanı gövdeyi okumadan önce onDenetim'e sorar: yanlış yol, eksik sahip başlığı, taşınmayan hizmet ve yolun gövde
// sınırı gövde belleğe alınmadan reddedilir (açılış öncesi inceleme, Codex 4. tur).
// Süpürme en çok supurMs'de bir; adres anahtarı IPv6'da /64 (tek bağlantının adres uzayı sınırı atlatmasın).
const b4a = require('b4a')
const { kart: Kt, paket: P, cevap: C, kodlama: K } = require('@havenfold/services')

const MB = 1024 * 1024
const SAAT = 3_600_000
const SINIR = { paketBayt: 25 * MB, dosyaToplam: 25 * MB, dosyaAdet: 64, ipSaat: 60, ipSaatBayt: 256 * MB, cevapBayt: 10 * MB + 64 * 1024, bagsizDosyaMs: SAAT, ipTabloMs: 30 * 24 * SAAT, depoBayt: 1024 * MB, servisBayt: 512 * MB, depoAdet: 50_000, gelenBayt: 64 * MB, gelenAdet: 100, supurMs: 1000 }

const HEX16 = /^[0-9a-f]{32}$/
const HEX32 = /^[0-9a-f]{64}$/

// Adres anahtarı: IPv4 olduğu gibi (IPv4'e eşlenmiş IPv6 da IPv4); IPv6 ilk 64 bit (/64)
function adresAnahtari (a) {
  a = String(a || '')
  const v4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(a)
  if (v4) return v4[1]
  if (!a.includes(':')) return a
  const [bas, son = ''] = a.split('%')[0].split('::')
  const sol = bas ? bas.split(':') : []
  const sag = son ? son.split(':') : []
  const tam = a.includes('::') ? [...sol, ...Array(Math.max(0, 8 - sol.length - sag.length)).fill('0'), ...sag] : sol
  return tam.slice(0, 4).map((x) => (parseInt(x, 16) || 0).toString(16)).join(':') + '::/64'
}

// Vekil adreslerinin karşılaştırılması: IPv4'e eşlenmiş IPv6 (::ffff:a.b.c.d) IPv4 sayılır, harf büyüklüğü önemsiz
// (Node çift yığınlı soketlerde 127.0.0.1'i ::ffff:127.0.0.1 diye verir; Codex 5. tur)
function adresNormal (a) {
  a = String(a || '').trim().toLowerCase()
  const v4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a)
  return v4 ? v4[1] : a
}

const cevap = (durum, govde = null) => ({ durum, govde, tur: govde == null ? null : b4a.isBuffer(govde) ? 'application/octet-stream' : 'application/json' })

class Alici {
  // kartlar: bu alıcının taşıdığı hizmetlerin kart baytları; now: saat; vekil: ters vekil arkasındaysa { adresler: [ip],
  // baslik: 'x-forwarded-for' } (yalnız bu adreslerden gelen istekte istemci adresi başlıktan okunur; açıklama 2 madde 4)
  constructor ({ kartlar = [], now = Date.now, sinir = {}, vekil = null } = {}) {
    this.now = now
    this.sinir = { ...SINIR, ...sinir }
    this.vekil = vekil ? { adresler: new Set((vekil.adresler || []).map(adresNormal)), baslik: (vekil.baslik || 'x-forwarded-for').toLowerCase() } : null
    this.hizmetler = new Map() // serviceIdHex → kart
    this.paketler = new Map() // packageIdHex → { serviceId, bytes, owner, t, expiresAt, teslim, ack, cevapSonu, cevaplar: Map }
    this.dosyalar = new Map() // serviceId/blobId/index → { bytes, owner, t }
    this.ip = new Map() // ip → { yeni: [t] (saatlik yeni sahip ve paket), son: t }
    this.sahipIp = new Map() // sahip özeti → ilk görülen an (yeni sahip IP sınırına sayılır)
    this.yetki = new C.YetkiDefteri()
    for (const b of kartlar) this.kartEkle(b)
  }

  // Hizmetin kartı: aynı imza anahtarıyla daha yeni kart eskisinin yerine geçer
  kartEkle (bytes) {
    const k = Kt.kartCoz(b4a.from(bytes))
    const id = K.hex(k.serviceId)
    this.hizmetler.set(id, Kt.kartSec(this.hizmetler.get(id) || null, k))
    return id
  }

  // Süresi geçenleri siler (açıklama 2 madde 3):
  // - ack edilmemiş her paket (teslim edilmiş olsa da) PAKET.expiresAt'te, dosyalarıyla;
  // - ack edilmiş paketin cevapları cevap penceresi (min(useUntil, ack + 30 gün)) bitince; izi 30 gün daha kalır ki geç cevap
  //   410 alsın (yalnız kimlik, sahip özeti ve süre; içerik yok);
  // - pakete bağlanmamış dosyalar 1 saatte; 30 gündür görülmeyen adreslerin sınır kayıtları.
  _supur () {
    const simdi = this.now()
    if (this._supuruldu !== undefined && simdi >= this._supuruldu && simdi - this._supuruldu < this.sinir.supurMs) return
    this._supuruldu = simdi
    for (const [id, p] of this.paketler) {
      if (!p.ack && simdi > p.expiresAt) this._sil(id)
      else if (p.cevapSonu !== null && simdi > p.cevapSonu) {
        p.cevaplar.clear()
        if (simdi > p.cevapSonu + K.SINIR.cevapGun * K.GUN_MS) this._sil(id)
      }
    }
    const bagli = new Set([...this.paketler.values()].filter((p) => p.bytes).map((p) => p.serviceId + '|' + p.owner))
    for (const [a, d] of this.dosyalar) if (!bagli.has(a.split('/')[0] + '|' + d.owner) && simdi - d.t > this.sinir.bagsizDosyaMs) this.dosyalar.delete(a)
    for (const [ip, x] of this.ip) if (simdi - x.son > this.sinir.ipTabloMs) this.ip.delete(ip)
    for (const [o, t] of this.sahipIp) if (simdi - t > this.sinir.ipTabloMs) this.sahipIp.delete(o)
  }

  _sil (id) {
    const p = this.paketler.get(id)
    if (!p) return
    for (const [a, d] of this.dosyalar) if (d.owner === p.owner && a.startsWith(p.serviceId + '/')) this.dosyalar.delete(a)
    this.paketler.delete(id)
  }

  _sahip (basliklar) { const o = basliklar['x-hf-owner']; return typeof o === 'string' && HEX32.test(o) ? o : null }

  _sahipSirri (basliklar, p) {
    let sir
    try { sir = C.sahipSirri(basliklar['x-hf-owner-secret']) } catch { return false }
    return P.sahipOzeti(sir) === p.owner
  }

  _yetkili (basliklar, serviceId, yontem, yol) {
    const k = this.hizmetler.get(serviceId)
    if (!k) return false
    try { this.yetki.denetle({ baslik: basliklar['x-hf-auth'], serviceId: k.serviceId, signPub: k.signPub, yontem, yol, simdi: this.now() }); return true } catch { return false }
  }

  // Adres başına saatte en çok ipSaat yeni paket ya da yeni sahip (dosya yüklemeye başlayan) (§13.1)
  _sinirli (ip) {
    const simdi = this.now()
    const x = this._ipKaydi(ip, simdi)
    if (x.yeni.length >= this.sinir.ipSaat) return true
    x.yeni.push(simdi)
    return false
  }

  _ipKaydi (ip, simdi) {
    const x = this.ip.get(ip) || { yeni: [], bayt: [], son: simdi }
    x.yeni = x.yeni.filter((t) => simdi - t < SAAT)
    x.bayt = x.bayt.filter((b) => simdi - b.t < SAAT)
    x.son = simdi
    this.ip.set(ip, x)
    return x
  }

  // Adresin saatlik bayt kotası: aşacaksa true; aşmıyorsa sayılır
  _baytSiniri (ip, n) {
    const simdi = this.now()
    const x = this._ipKaydi(ip, simdi)
    if (x.bayt.reduce((a, b) => a + b.n, 0) + n > this.sinir.ipSaatBayt) return true
    x.bayt.push({ t: simdi, n })
    return false
  }

  // İstemcinin adresi: yapılandırılmış ters vekilden gelen istekte vekilin başlığındaki SON adres (vekil kendi gördüğü
  // adresi sona ekler; öncekileri istemci yazabilir). IPv6 adresi /64 önekine indirilir.
  _adres (ip, basliklar) {
    let a = ip
    if (this.vekil && this.vekil.adresler.has(adresNormal(ip))) {
      const b = basliklar[this.vekil.baslik]
      const son = typeof b === 'string' ? b.split(',').map((x) => x.trim()).filter(Boolean).at(-1) : ''
      if (son) a = son
    }
    return adresAnahtari(a)
  }

  // Paketin hizmetindeki üst sınır (açıklama 1 madde 3, açıklama 2 madde 3): min(maxMB, 25) MB
  _ust (sid) { return Math.min(this.hizmetler.get(sid).maxMB * MB, this.sinir.dosyaToplam) }

  // Bütün deponun bayt ve kayıt sayısı (paket, dosya, cevap); ek bayt ve kayıtla sınırı aşar mı
  _depoDolu (ekBayt, ekAdet = 1) {
    let bayt = ekBayt
    let adet = ekAdet + this.dosyalar.size
    for (const d of this.dosyalar.values()) bayt += d.bytes.byteLength
    for (const p of this.paketler.values()) {
      adet += 1 + p.cevaplar.size
      bayt += p.bytes ? p.bytes.byteLength : 0
      for (const c of p.cevaplar.values()) bayt += c.byteLength
    }
    return bayt > this.sinir.depoBayt || adet > this.sinir.depoAdet
  }

  _sahipParcaSayisi (sid, owner) {
    let n = 0
    for (const [k, d] of this.dosyalar) if (d.owner === owner && k.startsWith(sid + '/')) n++
    return n
  }

  // Sahibin bu hizmetteki dosyaları ve paketleri (bayt)
  _sahipDosyalari (sid, owner) {
    let n = 0
    for (const [k, d] of this.dosyalar) if (d.owner === owner && k.startsWith(sid + '/')) n += d.bytes.byteLength
    for (const p of this.paketler.values()) if (p.owner === owner && p.serviceId === sid && p.bytes) n += p.bytes.byteLength
    return n
  }

  // Hizmetin deposu (paket, dosya, cevap baytları) ek baytla servisBayt'ı aşar mı
  _servisDolu (sid, ekBayt) {
    let n = ekBayt
    for (const [k, d] of this.dosyalar) if (k.startsWith(sid + '/')) n += d.bytes.byteLength
    for (const p of this.paketler.values()) {
      if (p.serviceId !== sid) continue
      n += p.bytes ? p.bytes.byteLength : 0
      for (const c of p.cevaplar.values()) n += c.byteLength
    }
    return n > this.sinir.servisBayt
  }

  // HTTP katmanının ön denetimi, gövde okunmadan: { yontem, yol, basliklar } → { durum } (hemen reddet) ya da { enCok } (bu
  // yolun en büyük gövdesi, bayt). Kalıplar istek'tekilerle aynı; asıl denetimler istek'te yeniden yapılır.
  onDenetim ({ yontem, yol, basliklar = {} }) {
    const p = yol.split('?')[0].split('/').filter(Boolean)
    if (p[0] !== 'v1') return { durum: 404 }
    const r = p.slice(1)
    const yukleme = (sid, enCok) => !this._sahip(basliklar) ? { durum: 400 } : this.hizmetler.has(sid) ? { enCok: enCok(sid) } : { durum: 410 }
    if (r[0] === 'b' && r.length === 4 && HEX16.test(r[1]) && HEX32.test(r[2]) && /^\d{1,6}$/.test(r[3])) {
      return yontem === 'PUT' ? yukleme(r[1], (sid) => this._ust(sid)) : yontem === 'GET' ? { enCok: 0 } : { durum: 405 }
    }
    if (r[0] === 'p' && r.length === 3 && HEX16.test(r[1]) && HEX16.test(r[2])) {
      return yontem === 'PUT' ? yukleme(r[1], (sid) => Math.min(this.sinir.paketBayt, this._ust(sid))) : yontem === 'DELETE' ? { enCok: 0 } : { durum: 405 }
    }
    if (yontem === 'PUT' && r[0] === 'r' && r.length === 3 && HEX16.test(r[1]) && /^\d{1,2}$/.test(r[2])) {
      return this.paketler.has(r[1]) ? { enCok: this.sinir.cevapBayt } : { durum: 404 }
    }
    if (yontem === 'POST' && r[0] === 'ack' && r.length === 3 && HEX16.test(r[1]) && HEX16.test(r[2])) return { enCok: 8 }
    if (yontem === 'GET' && r.length === 2 && (r[0] === 'kart' || r[0] === 'dizin' || ((r[0] === 'r' || r[0] === 'inbox') && HEX16.test(r[1])))) return { enCok: 0 }
    return { durum: 404 }
  }

  // İstemcinin sınır anahtarı (HTTP katmanının istemci başına eşzamanlılık sınırı için; _adres ile aynı)
  adres (ip, basliklar = {}) { return this._adres(ip, basliklar) }

  // { yontem, yol (sorgu dahil), basliklar (küçük harf), govde (Buffer), ip } → { durum, govde, tur }
  istek ({ yontem, yol, basliklar = {}, govde = b4a.alloc(0), ip = '' }) {
    this._supur()
    ip = this._adres(ip, basliklar)
    const [yolu, sorgu = ''] = yol.split('?')
    const q = Object.fromEntries(sorgu.split('&').filter(Boolean).map((x) => x.split('=')))
    const p = yolu.split('/').filter(Boolean)
    if (p[0] !== 'v1') return cevap(404)
    const r = p.slice(1)
    if (yontem === 'GET' && r[0] === 'dizin' && r.length === 2) return cevap(404) // dizin yalnız Eser geçidinde
    if (yontem === 'GET' && r[0] === 'kart' && r.length === 2) {
      const k = this.hizmetler.get(r[1])
      return k ? cevap(200, k.bytes) : cevap(404)
    }
    if (r[0] === 'b' && r.length === 4 && HEX16.test(r[1]) && HEX32.test(r[2]) && /^\d{1,6}$/.test(r[3])) {
      return yontem === 'PUT' ? this._dosyaYukle(r, basliklar, govde, ip) : yontem === 'GET' ? this._dosyaCek(r, basliklar, yol) : cevap(405)
    }
    if (r[0] === 'p' && r.length === 3 && HEX16.test(r[1]) && HEX16.test(r[2])) {
      if (yontem === 'PUT') return this._paketYukle(r[1], r[2], basliklar, govde, ip)
      if (yontem === 'DELETE') return this._paketSil(r[2], basliklar)
      return cevap(405)
    }
    if (yontem === 'GET' && r[0] === 'r' && r.length === 2 && HEX16.test(r[1])) return this._cevaplar(r[1], basliklar, q)
    if (yontem === 'PUT' && r[0] === 'r' && r.length === 3 && HEX16.test(r[1]) && /^\d{1,2}$/.test(r[2])) return this._cevapYaz(r[1], Number(r[2]), basliklar, govde, yol)
    if (yontem === 'GET' && r[0] === 'inbox' && r.length === 2 && HEX16.test(r[1])) return this._gelen(r[1], basliklar, q, yol)
    if (yontem === 'POST' && r[0] === 'ack' && r.length === 3 && HEX16.test(r[1]) && HEX16.test(r[2])) return this._ack(r[1], r[2], basliklar, govde, yol)
    return cevap(404)
  }

  _dosyaYukle ([, sid, blobId, index], basliklar, govde, ip) {
    const owner = this._sahip(basliklar)
    if (!owner) return cevap(400)
    if (!this.hizmetler.has(sid)) return cevap(410)
    if (!govde.byteLength) return cevap(400)
    const a = sid + '/' + blobId + '/' + Number(index)
    if (this.dosyalar.has(a)) return cevap(409)
    if (this._sahipDosyalari(sid, owner) + govde.byteLength > this._ust(sid)) return cevap(413)
    if (this._sahipParcaSayisi(sid, owner) >= this.sinir.dosyaAdet) return cevap(413)
    if (this._depoDolu(govde.byteLength) || this._servisDolu(sid, govde.byteLength)) return cevap(507)
    if (!this.sahipIp.has(owner)) {
      if (this._sinirli(ip)) return cevap(429)
      this.sahipIp.set(owner, this.now())
    }
    if (this._baytSiniri(ip, govde.byteLength)) return cevap(429)
    this.dosyalar.set(a, { bytes: b4a.from(govde), owner, t: this.now() })
    return cevap(201)
  }

  _dosyaCek ([, sid, blobId, index], basliklar, yol) {
    if (!this._yetkili(basliklar, sid, 'GET', yol)) return cevap(401)
    const d = this.dosyalar.get(sid + '/' + blobId + '/' + Number(index))
    return d ? cevap(200, d.bytes) : cevap(404)
  }

  _paketYukle (sid, pid, basliklar, govde, ip) {
    const owner = this._sahip(basliklar)
    if (!owner) return cevap(400)
    if (govde.byteLength > this.sinir.paketBayt) return cevap(413)
    if (!this.hizmetler.has(sid)) return cevap(410)
    if (govde.byteLength + this._sahipDosyalari(sid, owner) > this._ust(sid)) return cevap(413) // paket + dosyalar
    if (this._sinirli(ip)) return cevap(429)
    if (this.paketler.has(pid)) return cevap(409)
    if (this._depoDolu(govde.byteLength) || this._servisDolu(sid, govde.byteLength)) return cevap(507)
    if (this._baytSiniri(ip, govde.byteLength)) return cevap(429)
    let p
    try { p = P.paketCoz(b4a.from(govde)) } catch { return cevap(400) }
    const simdi = this.now()
    if (K.hex(p.serviceId) !== sid || K.hex(p.packageId) !== pid) return cevap(400)
    if (!(p.expiresAt > simdi) || p.expiresAt > simdi + K.SINIR.teslimGun * K.GUN_MS) return cevap(400)
    this.paketler.set(pid, { serviceId: sid, bytes: b4a.from(govde), owner, t: simdi, expiresAt: p.expiresAt, teslim: false, ack: false, cevapSonu: null, cevaplar: new Map() })
    return cevap(201)
  }

  _paketSil (pid, basliklar) {
    const p = this.paketler.get(pid)
    if (!p) return cevap(404)
    if (!this._sahipSirri(basliklar, p)) return cevap(403)
    if (p.teslim) return cevap(409)
    this._sil(pid)
    return cevap(204)
  }

  _cevaplar (pid, basliklar, q) {
    const p = this.paketler.get(pid)
    if (!p || !this._sahipSirri(basliklar, p)) return cevap(403)
    const after = q.after === undefined ? -1 : Number(q.after)
    const l = [...p.cevaplar].filter(([n]) => n > after).sort((a, b) => a[0] - b[0]).map(([n, b]) => ({ n, bytes: b4a.toString(b, 'base64') }))
    return cevap(200, { cevaplar: l })
  }

  _gelen (sid, basliklar, q, yol) {
    if (!this._yetkili(basliklar, sid, 'GET', yol)) return cevap(401)
    // İmleç: ilk istek after=0 (ya da yok); sonrakiler son paketin t'si ve packageId'si. afterId'siz after > 0 400: eski
    // istemci aynı t'de sayfaya sığmayan paketleri sessizce atlamasın (Codex 5. tur)
    const after = q.after === undefined ? 0 : /^\d{1,16}$/.test(q.after) ? Number(q.after) : NaN
    if (!Number.isSafeInteger(after)) return cevap(400)
    const afterId = q.afterId === undefined ? null : HEX16.test(q.afterId) ? q.afterId : undefined
    if (afterId === undefined || (after > 0 && afterId === null)) return cevap(400)
    // Sahibe göre dosyalar bir kez (paket × dosya taraması yok)
    const sahipDosya = new Map()
    for (const [a, d] of this.dosyalar) {
      if (!a.startsWith(sid + '/')) continue
      const [, blobId, index] = a.split('/')
      if (!sahipDosya.has(d.owner)) sahipDosya.set(d.owner, [])
      sahipDosya.get(d.owner).push({ blobId, index: Number(index), boy: d.bytes.byteLength })
    }
    const sonra = ([pid, p]) => p.t > after || (afterId !== null && p.t === after && pid > afterId)
    const adaylar = [...this.paketler].filter((x) => x[1].serviceId === sid && !x[1].ack && sonra(x))
      .sort((x, y) => x[1].t - y[1].t || (x[0] < y[0] ? -1 : 1))
    // Sayfa kesin: en çok gelenAdet paket ve gelenBayt (ilk paket sınırdan büyükse yalnız o); sonraki istek son paketin
    // (t, packageId) imleciyle gelir
    const out = []
    let bayt = 0
    let devam = false
    for (const [pid, p] of adaylar) {
      if (out.length && (out.length >= this.sinir.gelenAdet || bayt + p.bytes.byteLength > this.sinir.gelenBayt)) { devam = true; break }
      p.teslim = true
      bayt += p.bytes.byteLength
      out.push({ packageId: pid, t: p.t, bytes: b4a.toString(p.bytes, 'base64'), dosyalar: sahipDosya.get(p.owner) || [] })
    }
    return cevap(200, { paketler: out, devam })
  }

  _ack (sid, pid, basliklar, govde, yol) {
    if (!this._yetkili(basliklar, sid, 'POST', yol)) return cevap(401)
    const p = this.paketler.get(pid)
    if (!p || p.serviceId !== sid) return cevap(404)
    const simdi = this.now()
    let useUntil = Infinity
    if (govde.byteLength === 8) {
      useUntil = Number(new DataView(govde.buffer, govde.byteOffset).getBigUint64(0))
      if (!(useUntil > simdi)) return cevap(400) // geçmiş ya da sıfır pencere yok
    } else if (govde.byteLength) return cevap(400)
    for (const [a, d] of this.dosyalar) if (d.owner === p.owner && a.startsWith(sid + '/')) this.dosyalar.delete(a)
    p.bytes = null
    p.teslim = true
    p.ack = true
    p.cevapSonu = Math.min(useUntil, simdi + K.SINIR.cevapGun * K.GUN_MS)
    return cevap(204)
  }

  _cevapYaz (pid, n, basliklar, govde, yol) {
    const p = this.paketler.get(pid)
    if (!p) return cevap(404)
    if (!this._yetkili(basliklar, p.serviceId, 'PUT', yol)) return cevap(401)
    if (!p.ack) return cevap(404) // hizmet yalnız aldığı (ack ettiği) pakete cevap verir; pencere ack ile başlar
    if (p.cevapSonu !== null && this.now() > p.cevapSonu) return cevap(410)
    if (n >= K.SINIR.cevap || p.cevaplar.has(n)) return cevap(409)
    if (govde.byteLength > this.sinir.cevapBayt) return cevap(413)
    let c
    try { c = C.cevapCoz(b4a.from(govde)) } catch { return cevap(400) }
    if (K.hex(c.packageId) !== pid || c.n !== n) return cevap(400)
    if (this._depoDolu(govde.byteLength) || this._servisDolu(p.serviceId, govde.byteLength)) return cevap(507)
    p.cevaplar.set(n, b4a.from(govde))
    return cevap(201)
  }
}

module.exports = { adresAnahtari, Alici, SINIR }
