// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// transport.js (@havenfold/transport) — telefon ve kutu ağ taşıyıcısı (D43; kollar/D-tasiyici-oneri.md). VARSAYILAN KAPALI.
//
// HyperDHT (Noise, @hyperswarm/secret-stream) üstünde aile oturumları; synchronizer.js'in ağ kancasını ({ gonder, dinle })
// verir. Yuva Hat'ın telefondaki taşıyıcısıyla aynı düzen (yalnız okunarak incelendi, kod kopyalanmadı):
//   - Buluşma: konu ve duyuru yok. Her çift için, çift sırrından (PairBook) saatlik dilimle türetilen anahtar çiftleri:
//     dinleme listenSeed(dilim), arama dialSeed(dilim) (core/crypto/pair.js pairSubkeys). Güvenlik duvarı yalnız o çiftin
//     karşı tarafının e-1, e, e+1 dilimlerindeki arama anahtarını kabul eder.
//   - Aynı çiftte iki oturum olmasın: memberId'si küçük olan arar, büyük olan dinler. Kutu her zaman dinler, telefonlar
//     kutuyu arar (RFC-0028 §7 d, j; telefon başına kutuda tek sunucu).
//   - Dilimler (§7 g): dinleyen yalnız bugünkü dilimi (e) açar; e+1 dilim bitmeden 5 dakika önce açılır. Arayan e ve e-1'i,
//     son 5 dakikada e+1'i de dener.
//   - Arka plan (§7 h): kutulu ailede ve ekipte uygulama arka plandayken (arkaPlan(true)) kişiler arası oturum ve dinleme
//     yoktur, yalnız kutu; kutusuz ailede §6'daki gibi.
//   - Tören anahtarı (§7 c): törenden gelen anahtar çift sırrına girer (cihaz().torenAnahtarlari: peerHex → 32 bayt;
//     iki tarafta da `durum`'da gizli saklanır, worklet/persistence.js).
//   - Oturum: Noise tüneli açılınca iki taraf HELLO (core/protocol/hello.js: el sıkışma özeti üstünde üye imzası) yollar;
//     karşı taraf doğrulanmadan hiçbir zarf işlenmez. Çerçeve: tür (1 bayt) ‖ gövde; HELLO türü 0x01.
//   - Çerçeve sınırı (sınırlar 16): gövde en çok EN_BUYUK_GOVDE (1 MiB; RFC-0001 doğrudan REC_OPS ve düğüm IPC'siyle aynı).
//     Aşan gelen çerçeve işlenmez, oturum kapanır (HELLO'dan önceyse başarısız HELLO sayılır), hata(FRAME_TOO_LARGE, peer)
//     bildirilir; gönderen de aşan zarfı yollamaz (gonder false döner).
//   - Doğrulanan oturum esitleyici'ye baglandi(peer) olur, gelen zarf al(peer, tür, gövde, 'dogrudan'); kopunca koptu.
//   - HELLO başarısızlık sınırı (D48): aynı uzak anahtardan aynı dilimde 3 başarısız HELLO (bozuk, yanlış ilk çerçeve
//     ya da süre aşımı) o çiftin o dilimini kapatır: dinleme sunucusu kapanır, o dilim aranmaz; sonraki dilim yenidir.
//     Sınır yalnız gelen (dinlenen) oturumlarda sayılır: arayan tarafta süre aşımı çoğunlukla yarım kalan delik açmadır
//     (istemcide açılır, karşıya ulaşmaz); arayan kendi dilimini kapatmaz, hızlı dönemle yeniden arar (D68).
//   - Pil ve arka plan (RFC-0028 §6): yeniden arama normalde 30 sn; başlangıçta, yeni üyede, kopuşta, devamda ve ağ
//     değişiminde 3 dk boyunca 5 sn'de bir. askiya() (Bare suspend): arama durur, oturumlar kapanır, dht.suspend();
//     devam() (resume): dht.resume(), buluşma yenilenir, üyeler kısa HELLO süresiyle aranır. agDegisti() (ağ türü
//     değişti; HyperDHT network-change) oturumları kapatıp yeniden kurar. Zamanlayıcılar unref.
//   - Bağlı cihaz (işçi; RFC-0002 §6.1 "cihaz çift kanalı", RFC-0003 §6.1) yalnız `cihazlar: true` ile: telefon işçiyi
//     arar, işçi her zaman dinler (kutunun §7 j kuralı gibi); işçi kutuyu arar (kutu her zaman dinler; RFC-0012 §6.4
//     "cihaz ↔ kutu olağan yerel oturum", D90); HELLO'da karşı tarafın rolü 'cihaz' olabilir. İşçi
//     yalnız üyelerle oturum kurar. RFC-0028 cihaz oturumunu yazmaz; bu uygulamanın önerisidir (varsayılan kapalı).
// Yalnız doğrudan oturum: emanet (HOLD) ve Posta Kutusu bu sürümde yok. Dış ağa bağlanan test yoktur; testte
// hyperdht/testnet'in yerel önyükleme düğümleri ya da sahte DHT kullanılır.
'use strict'
const b4a = require('b4a')
const c = require('compact-encoding')
const DHT = require('hyperdht')
const sodium = require('sodium-native')
const { pairs: { PairBook }, messages: M, hello: H, encoding: { canonical } } = require('@havenfold/core')

const hex = (b) => (typeof b === 'string' ? b : b4a.toString(b, 'hex'))
function fail (code) { throw new Error(code) }

// Özel ve yerel bağlantı adresleri (RFC 1918, 169.254/16, 127/8, IPv6 fe80::/10, fc00::/7). Röleli bağlantıda karşı adres
// rölenindir; yerel sayılmaz (yalnız gerçekten aynı ağdaki oturum).
function yerelAdresMi (h) {
  if (typeof h !== 'string') return false
  const v4 = h.replace(/^::ffff:/, '')
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(v4)
  if (m) {
    const a = +m[1]
    const b = +m[2]
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)
  }
  const l = h.toLowerCase()
  return /^fe[89ab]/.test(l) || /^f[cd]/.test(l) || l === '::1'
}

const DILIM_MS = 60 * 60_000 // buluşma anahtarlarının ömrü
const YOKLAMA_MS = 30_000 // yeniden arama ve dilim yenileme (normal)
const HIZLI_MS = 5_000 // hızlı dönemde arama aralığı ve tik
const HIZLI_SURE_MS = 3 * 60_000 // hızlı dönem
const HELLO_MS = 10_000
const KISA_HELLO_MS = 3_000 // devamdan sonra
const HELLO_SINIRI = 3 // aynı anahtardan aynı dilimde başarısız HELLO
const ORTUSME_MS = 5 * 60_000 // e+1 dilimi bitmeden bu kadar önce açılır (§7 g)
const T_HELLO = 0x01
const EN_BUYUK_GOVDE = 1024 * 1024 // çerçeve: tür (1 bayt) ‖ gövde; alttaki şifreli akışın ileti sınırı 16 MiB

const dilimOf = (t) => Math.floor(t / DILIM_MS)
const u64 = (n) => { const b = b4a.alloc(8); new DataView(b.buffer, b.byteOffset, 8).setBigUint64(0, BigInt(n)); return b }

class DhtTasiyici {
  // dht: HyperDHT düğümü (üretimde varsayılan önyükleme; testte testnet). cihaz(): { kimlik, ledger } (aile yoksa null)
  // deneysel: true olmadan kurulmaz (bayrak; RFC onaylanana kadar). hata(err, peerHex): reddedilen çerçeve (FRAME_TOO_LARGE)
  // cihazlar: bağlı cihazlarla (işçi) oturum (yukarıdaki not)
  constructor ({ dht, cihaz, now = Date.now, deneysel = false, cihazlar = false, hata = () => {}, yoklamaMs = YOKLAMA_MS, hizliMs = HIZLI_MS, helloMs = HELLO_MS, kisaHelloMs = KISA_HELLO_MS, caps = H.CAPS.LEDGER_V21 | H.CAPS.KAYIT | H.CAPS.COKLU_UYGULAMA | H.CAPS.MISAFIR_YAZAR | H.CAPS.AILE_ADI | H.CAPS.UZAKTAN_IPTAL }) {
    if (deneysel !== true) fail('EXPERIMENTAL_DISABLED')
    if (!dht) fail('NO_DHT')
    this.dht = dht
    this.cihazlar = cihazlar === true
    this.cihaz = cihaz
    this.now = now
    this.hata = hata
    this.caps = caps
    this.yoklamaMs = yoklamaMs
    this.hizliMs = hizliMs
    this.helloMs = helloMs
    this.kisaHelloMs = kisaHelloMs
    this.isl = null
    this.oturumlar = new Map() // peerHex → { socket, dogrulandi }
    this.sunucular = new Map() // peerHex|dilim → server
    this.aranan = new Set()
    this.basarisiz = new Map() // peerHex|dilim|uzakAnahtar → sayı
    this.kapali = new Set() // peerHex|dilim: HELLO sınırı aşıldı
    this.bilinen = new Set() // gördüğümüz üyeler (yeni üyede hızlı dönem)
    this.kapandi = false
    this.askida = false
    this.hizliBitis = 0
    this.kisaHelloBitis = 0
    this.sonYokla = -Infinity
    this._zaman = null
    this._agFn = () => this.agDegisti()
    this.arka = false // uygulama arka planda mı (§7 h)
  }

  // synchronizer.js'in ağ kancası
  get ag () {
    return {
      gonder: (peer, type, bytes) => this.gonder(peer, type, bytes),
      dinle: (isl) => { this.isl = isl; this.yokla() }
    }
  }

  _cift () {
    const d = this.cihaz()
    // Misafirin telefonu (RFC-0030; D99): defter yerine GUEST_VIEW'den kurulan defter yüzü (guestView.guestLedger)
    if (d && !d.ledger && d.misafirLedger) d.ledger = d.misafirLedger
    if (!d || !d.ledger) return null
    // Tören anahtarları (§7 c): çekirdeğin kalıcı haritası; yeni anahtar gelince çift sırları yeniden hesaplanır
    const tk = d.torenAnahtarlari instanceof Map ? d.torenAnahtarlari : null
    const imza = tk ? [...tk.keys()].sort().join(',') : ''
    if (!this._defter || this._defter.ledger !== d.ledger || this._tkImza !== imza) {
      this._defter = new PairBook({ me: d.kimlik, ledger: d.ledger, now: this.now, ceremonyKeys: tk ? new Map([...tk].map(([k, v]) => [k, b4a.isBuffer(v) ? v : b4a.from(v, 'hex')])) : new Map() })
      this._tkImza = imza
    }
    return { me: d.kimlik, ledger: d.ledger, kitap: this._defter }
  }

  // Başlamış, askıda ve kapalı değil (eşitleme durumu, D100)
  get acik () { return !this.kapandi && !this.askida && !!this._zaman }

  baslat () {
    this._hizlan()
    this.yokla()
    this._zamanla()
    if (typeof this.dht.on === 'function') this.dht.on('network-change', this._agFn)
  }

  // Bare olayları (ya da aynı adlı olayları yayan platform): suspend → askiya, resume → devam; uygulamanın arka plana
  // geçmesi ve öne gelmesi (§7 h): 'arkaplan' → arkaPlan(true), 'onplan' → arkaPlan(false)
  platformaBagla (p) {
    p.on('suspend', () => { this.askiya().catch(() => {}) })
    p.on('resume', () => { this.devam().catch(() => {}) })
    p.on('arkaplan', () => this.arkaPlan(true))
    p.on('onplan', () => this.arkaPlan(false))
  }

  _hizlan () { this.hizliBitis = this.now() + HIZLI_SURE_MS }

  // Uygulama arka plana geçti ya da öne geldi (§7 h). Kutulu ailede ve ekipte arka planda yalnız kutuyla oturum
  arkaPlan (acik) {
    this.arka = !!acik
    if (this.kapandi || this.askida) return
    if (!this.arka) this._hizlan()
    this.yokla()
  }

  // Arka plan kuralı bu ailede kişiler arası oturumu kapatıyor mu
  _yalnizKutu (L) {
    if (!this.arka || typeof L.boxIds !== 'function') return false
    return L.kind === 'ekip' || L.boxIds().length > 0
  }

  _zamanla () {
    if (this._zaman) clearInterval(this._zaman)
    this._zaman = setInterval(() => this._tik(), this.hizliMs)
    if (this._zaman.unref) this._zaman.unref()
  }

  // Hızlı dönemde her tikte (5 sn), sonra yoklama aralığında (30 sn) bir
  _tik () {
    if (this.kapandi || this.askida) return
    const t = this.now()
    if (t < this.hizliBitis || t - this.sonYokla >= this.yoklamaMs) this.yokla()
  }

  // Dinleme sunucularını dilime göre kurar, eksik oturumları arar (aile değişince de çağrılır)
  yokla () {
    if (this.kapandi || this.askida) return
    const x = this._cift()
    if (!x) return
    this.sonYokla = this.now()
    const benHex = hex(x.me.memberId)
    const t = this.now()
    const e = dilimOf(t)
    const sonDakikalar = t >= (e + 1) * DILIM_MS - ORTUSME_MS
    // Misafirin defter yüzünde (guestLedger) members yok; rol görünümdeki eşten (D99)
    const rolu = (id) => (x.ledger.members ? x.ledger.members.get(id)?.role : x.ledger.entity(id)?.role) || null
    const benKutu = rolu(benHex) === 'kutu'
    const benCihaz = this.cihazlar && x.ledger.sessionRole(benHex) === 'cihaz'
    // Misafir oturumu (D99): misafir aile üyelerini arar, üye dinler; cihaz ve kutu misafirle oturum kurmaz
    const benMisafir = x.ledger.sessionRole(benHex) === 'misafir'
    // Sınırlı iptal oturumu (D106; Codex 10. tur): bekleyen uzaktan üye beklerken yalnız yetkilileri (ebeveyn; ekipte sahip
    // ve yönetici) arar ya da dinler; iptal edilen davetliyle yalnız yetkili telefon konuşur (imzalı iptali o yollar).
    // Kimin arayacağı iki telefon arasındaki kural (küçük kimlik arar): bekleme süresi dolunca da aynı
    const benDavetli = typeof x.kitap.benimRolum === 'function' && x.kitap.benimRolum() === 'davetli'
    const yetkili = new Set(typeof x.ledger.authorityIds === 'function' ? x.ledger.authorityIds() : [])
    const benYetkili = yetkili.has(benHex) && !benKutu
    const yalnizKutu = this._yalnizKutu(x.ledger)
    const istenen = new Set()
    for (const p of x.kitap.peers({ davetli: true })) {
      const karsiCihaz = this.cihazlar && p.session === 'cihaz' && !benCihaz
      const karsiMisafir = p.session === 'misafir' && !benCihaz && !benKutu && !benMisafir
      const karsiDavetli = p.session === 'davetli' && benYetkili && !benCihaz && !benMisafir
      if (benMisafir && p.session !== 'uye') continue
      if (benDavetli && !yetkili.has(p.hex)) continue
      if (p.session !== 'uye' && !karsiCihaz && !karsiMisafir && !karsiDavetli) continue
      const karsiKutu = rolu(p.hex) === 'kutu'
      if (yalnizKutu && !karsiKutu && !benKutu) {
        // Arka planda kişiler arası oturum yok (§7 h): açık oturum da kapanır
        const o = this.oturumlar.get(p.hex)
        if (o) { this.oturumlar.delete(p.hex); if (o.dogrulandi && this.isl) this.isl.koptu(p.hex); o.socket.destroy() }
        continue
      }
      if (!this.bilinen.has(p.hex)) { if (this.bilinen.size) this._hizlan(); this.bilinen.add(p.hex) }
      // Kutu her zaman dinler, telefon kutuyu arar; iki telefon arasında küçük kimlik arar (§7 d, j)
      // İşçi her zaman dinler, telefon işçiyi arar (cihazlar: true)
      // İşçi kutuyu arar (RFC-0012 §6.4, D90)
      const arar = benMisafir ? true : karsiMisafir ? false : benKutu ? false : benCihaz ? karsiKutu : karsiKutu || karsiCihaz ? true : benHex < p.hex
      if (arar) { this._ara(p, e, sonDakikalar); continue }
      for (const d of sonDakikalar ? [e, e + 1] : [e]) {
        if (this.kapali.has(p.hex + '|' + d)) continue
        istenen.add(p.hex + '|' + d)
        this._dinle(p, d)
      }
    }
    for (const [k, s] of this.sunucular) if (!istenen.has(k)) { s.close().catch(() => {}); this.sunucular.delete(k) }
    // Geçmiş dilimlerin sayaçları
    const dilimi = (k) => Number(k.split('|')[1])
    for (const k of this.kapali) if (dilimi(k) < e - 1) this.kapali.delete(k)
    for (const k of this.basarisiz.keys()) if (dilimi(k) < e - 1) this.basarisiz.delete(k)
  }

  _dinle (p, d) {
    const k = p.hex + '|' + d
    if (this.sunucular.has(k)) return
    const kp = DHT.keyPair(p.sub.listenSeed(u64(d)))
    const izinli = [d - 1, d, d + 1].map((x) => DHT.keyPair(p.sub.peerDialSeed(u64(x))).publicKey)
    const s = this.dht.createServer({ firewall: (remote) => !izinli.some((pk) => b4a.equals(pk, remote)) }, (socket) => this._oturum(p.hex, socket, d, true))
    this.sunucular.set(k, s)
    s.listen(kp).catch(() => this.sunucular.delete(k))
  }

  _ara (p, e, sonDakikalar = false) {
    if (this.oturumlar.has(p.hex) || this.aranan.has(p.hex)) return
    const hedefler = (sonDakikalar ? [e, e + 1, e - 1] : [e, e - 1]).filter((d) => !this.kapali.has(p.hex + '|' + d))
    if (!hedefler.length) return
    this.aranan.add(p.hex)
    const dene = (i) => {
      if (i >= hedefler.length || this.kapandi || this.askida) { this.aranan.delete(p.hex); return }
      const d = hedefler[i]
      const socket = this.dht.connect(DHT.keyPair(p.sub.peerListenSeed(u64(d))).publicKey, { keyPair: DHT.keyPair(p.sub.dialSeed(u64(e))) })
      let acildi = false
      socket.once('open', () => { acildi = true; this.aranan.delete(p.hex); this._oturum(p.hex, socket, d, false) })
      socket.on('error', () => {})
      socket.once('close', () => { if (!acildi) dene(i + 1) })
    }
    dene(0)
  }

  // Başarısız HELLO: aynı uzak anahtardan aynı dilimde HELLO_SINIRI'nda o dilim kapanır
  _basarisiz (peerHex, d, uzak) {
    const k = peerHex + '|' + d + '|' + (uzak ? hex(uzak) : '')
    const n = (this.basarisiz.get(k) || 0) + 1
    this.basarisiz.set(k, n)
    if (n < HELLO_SINIRI) return
    const kd = peerHex + '|' + d
    this.kapali.add(kd)
    const s = this.sunucular.get(kd)
    if (s) { s.close().catch(() => {}); this.sunucular.delete(kd) }
  }

  // Noise tüneli açık: HELLO takası, doğrulama, sonra zarflar
  // gelen: dinleme sunucusuna gelen oturum (HELLO sınırı burada sayılır); false: bizim aradığımız
  _oturum (peerHex, socket, d, gelen) {
    const x = this._cift()
    if (!x || this.kapandi || this.askida) { socket.destroy(); return }
    const eski = this.oturumlar.get(peerHex)
    if (eski) eski.socket.destroy()
    const o = { socket, dogrulandi: false, hata: false, helloMs: this.now() < this.kisaHelloBitis ? this.kisaHelloMs : this.helloMs }
    this.oturumlar.set(peerHex, o)
    const red = () => { o.hata = true; socket.destroy() }
    const zaman = setTimeout(red, o.helloMs)
    socket.on('error', () => {})
    socket.on('close', () => {
      clearTimeout(zaman)
      if (o.hata && !o.dogrulandi) {
        if (gelen) this._basarisiz(peerHex, d, socket.remotePublicKey)
        else if (!this.kapandi && !this.askida) this._hizlan() // yarım bağlantı: yakında yeniden ara
      }
      if (this.oturumlar.get(peerHex) !== o) return
      this.oturumlar.delete(peerHex)
      if (o.dogrulandi) {
        if (this.isl) this.isl.koptu(peerHex)
        if (!this.kapandi && !this.askida) this._hizlan() // kopuşta hızlı arama
      }
    })
    socket.on('data', (b) => {
      if (!b || b.byteLength < 1) return o.dogrulandi ? socket.destroy() : red()
      if (b.byteLength > 1 + EN_BUYUK_GOVDE) {
        try { this.hata(new Error('FRAME_TOO_LARGE'), peerHex) } catch {}
        return o.dogrulandi ? socket.destroy() : red()
      }
      const tur = b[0]
      const govde = b.subarray(1)
      if (!o.dogrulandi) {
        if (tur !== T_HELLO) return red() // doğrulanmadan zarf yok
        let h
        try { h = canonical(M.hello, govde, 'INVALID_MESSAGE') } catch { return red() } // kanonik: fazla bayt yok (inceleme 3 S7)
        // Örnek kapanırken çift defteri null olabilir: oturum reddedilir, işleyici düşmez (açılış öncesi inceleme)
        const xc = this._cift()
        if (!xc) return red()
        const sonuc = H.verifyHello(h, socket, xc.ledger, peerHex, { davetli: true })
        const benH = hex(xc.me.memberId)
        const benM = xc.ledger.sessionRole(benH) === 'misafir'
        // Misafir oturumunu yalnız telefon üyesi kabul eder: kutu ve cihaz misafirle oturum kurmaz (eş seçimiyle aynı kural)
        const benKC = xc.ledger.sessionRole(benH) === 'cihaz' || (xc.ledger.members ? xc.ledger.members.get(benH)?.role : xc.ledger.entity(benH)?.role) === 'kutu'
        // İptal edilen davetliyle yalnız yetkili telefon (D106; Codex 10. tur)
        const benY = !benM && !benKC && typeof xc.ledger.authorityIds === 'function' && xc.ledger.authorityIds().includes(benH)
        if (!sonuc.ok || !(sonuc.role === 'uye' || (this.cihazlar && sonuc.role === 'cihaz') || (sonuc.role === 'misafir' && !benM && !benKC) || (sonuc.role === 'davetli' && benY))) return red()
        o.dogrulandi = true
        clearTimeout(zaman)
        // caps: çevrimiçi gizliliği (HIDE_PRESENCE; D77). yerel: karşı uç yerel ağ adresinden (RFC-0012 §10 "nearby"; D90)
        if (this.isl) this.isl.baglandi(peerHex, { caps: h.caps, yerel: yerelAdresMi(socket.rawStream && socket.rawStream.remoteHost) })
        return
      }
      if (tur === T_HELLO) return
      if (this.isl) this.isl.al(peerHex, tur, b4a.from(govde), 'dogrudan')
    })
    socket.write(b4a.concat([b4a.from([T_HELLO]), c.encode(M.hello, H.createHello(x.me, socket, x.ledger, this.caps))]))
  }

  gonder (peerHex, type, bytes) {
    const o = this.oturumlar.get(hex(peerHex))
    if (!o || !o.dogrulandi || type === T_HELLO || bytes.byteLength > EN_BUYUK_GOVDE) return false
    o.socket.write(b4a.concat([b4a.from([type]), bytes]))
    return true
  }

  // Oturumları hemen düşürür ve kopuşu bildirir (soketin kapanışı eşzamansız; ardından gelen arama beklemesin)
  _oturumlariKapat () {
    for (const [peerHex, o] of [...this.oturumlar]) {
      this.oturumlar.delete(peerHex)
      if (o.dogrulandi && this.isl) this.isl.koptu(peerHex)
      o.socket.destroy()
    }
    this.aranan.clear()
  }

  // Bare suspend (RFC-0028 §6): arama durur, oturumlar kapanır, dinleme sunucuları bırakılır, dht.suspend()
  async askiya () {
    if (this.kapandi || this.askida) return
    this.askida = true
    if (this._zaman) { clearInterval(this._zaman); this._zaman = null }
    this._oturumlariKapat()
    for (const s of this.sunucular.values()) s.close().catch(() => {})
    this.sunucular.clear()
    if (typeof this.dht.suspend === 'function') await this.dht.suspend()
  }

  // Bare resume: dht.resume(), buluşma yenilenir, üyeler hızlı ve kısa HELLO süresiyle aranır
  async devam () {
    if (this.kapandi || !this.askida) return
    if (typeof this.dht.resume === 'function') await this.dht.resume()
    this.askida = false
    this.kisaHelloBitis = this.now() + HIZLI_SURE_MS
    this._hizlan()
    this.yokla()
    this._zamanla()
  }

  // Ağ türü değişti (Wi-Fi ↔ mobil): oturumlar kapanır ve yeniden kurulur
  agDegisti () {
    if (this.kapandi || this.askida) return
    this._oturumlariKapat()
    this._hizlan()
    this.yokla()
  }

  async kapat () {
    this.kapandi = true
    if (this._zaman) clearInterval(this._zaman)
    if (typeof this.dht.off === 'function') this.dht.off('network-change', this._agFn)
    for (const o of this.oturumlar.values()) o.socket.destroy()
    this.oturumlar.clear()
    await Promise.all([...this.sunucular.values()].map((s) => s.close().catch(() => {})))
    this.sunucular.clear()
    // Sınırlar 14: tören anahtarlarının (hex'ten açılan kopyalar) ve çift sırlarının bellekteki kopyaları sıfırlanır.
    // Yalnız kapanışta: çalışırken eski defterin sırları açık sunucuların güvenlik duvarında kullanılıyor olabilir
    if (this._defter) {
      for (const k of this._defter.ceremonyKeys.values()) if (b4a.isBuffer(k)) sodium.sodium_memzero(k)
      for (const v of this._defter.cache.values()) sodium.sodium_memzero(v.pair)
      this._defter = null
    }
  }
}

module.exports = { yerelAdresMi, DhtTasiyici, EN_BUYUK_GOVDE, DILIM_MS, dilimOf, YOKLAMA_MS, HIZLI_MS, HIZLI_SURE_MS, HELLO_MS, KISA_HELLO_MS, HELLO_SINIRI, ORTUSME_MS }
