// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// ipc.js — Bare Kit IPC (BareKit.IPC) üstünde RFC-0024 çerçeveleri
//
// Akışta her çerçeve: uzunluk(4, büyük sonlu, işaretsiz) ‖ UTF-8 JSON. Uzunluk 1..1 MiB. Sınır dışı uzunluk eşzamanlamanın
// kaybıdır (RFC-0027 §5 d): worklet { id: null, olay: 'channel', govde: { hata: 'INVALID_FRAME' } } yollar ve akışı
// kapatır; uygulama worklet'i yeniden başlatır (önekini unutmuş bir yazım sonraki ~2 GB'ı yutmaz). Fırlatan komut
// { id, hata } ile döner. 1 MiB'ı aşan cevap ya da geri çağrı ilgili komutu INVALID_FRAME ile reddeder; kimliksiz
// olay atılır ve kanal olayıyla bildirilir. Gelen çerçeveler sıraya sokulmaz: her biri
// hemen sunucuya verilir ve cevap hazır olduğunda yazılır; 273 onay ekranını beklerken geri çağrının cevabı ({ cagriId })
// sonraki bir çerçeveyle gelir. Sunucunun olay ({ olay, veri }) ve geri çağrı ({ cagri, id, veri }) çerçeveleri de aynı
// yoldan uygulamaya gider.
//
// ipc: 'data' olayı ve write(bayt) olan herhangi bir akış (Bare Kit'te BareKit.IPC; testte bellek içi çift).
// sunucu: { isle(metin) → Promise<metin | null>, olaylariBagla(gonder) → bırak } (ürünün komut sunucusu).
'use strict'
const b4a = require('b4a')

const EN_COK = 1024 * 1024 // RFC-0024 §2
const BOY = 4

function boyYaz (n) {
  const b = b4a.alloc(BOY)
  new DataView(b.buffer, b.byteOffset, BOY).setUint32(0, n)
  return b
}

// Tek çerçeve (uzunluk önekiyle). Metin 1 MiB'ı aşarsa null.
function cerceveYaz (metin) {
  const govde = b4a.from(metin)
  if (govde.byteLength === 0 || govde.byteLength > EN_COK) return null
  return b4a.concat([boyYaz(govde.byteLength), govde])
}

// Akıştan çerçeve ayırıcı: parça parça gelen baytları toplar; her tam çerçevede tamam(metin), geçersiz uzunlukta gecersiz().
// durOnGecersiz: geçersiz uzunluktan sonra hiçbir bayt işlenmez (worklet tarafı); verilmezse gövde atlanır (uygulama tarafı)
class Ayirici {
  constructor ({ tamam, gecersiz, durOnGecersiz = false }) {
    this.dur = durOnGecersiz
    this.durdu = false
    this.tamam = tamam
    this.gecersiz = gecersiz
    this.parcalar = []
    this.boy = 0 // toplanan bayt
    this.bekle = -1 // beklenen gövde uzunluğu (-1: önek bekleniyor)
    this.at = 0 // atlanacak bayt (geçersiz çerçevenin gövdesi)
  }

  _al (n) {
    const b = this.parcalar.length === 1 ? this.parcalar[0] : b4a.concat(this.parcalar)
    const out = b.subarray(0, n)
    const kalan = b.subarray(n)
    this.parcalar = kalan.byteLength ? [kalan] : []
    this.boy = kalan.byteLength
    return out
  }

  yaz (parca) {
    if (this.durdu || !parca || parca.byteLength === 0) return
    let p = parca
    if (this.at > 0) {
      const n = Math.min(this.at, p.byteLength)
      this.at -= n
      p = p.subarray(n)
      if (p.byteLength === 0) return
    }
    this.parcalar.push(p)
    this.boy += p.byteLength
    for (;;) {
      if (this.bekle < 0) {
        if (this.boy < BOY) return
        const o = this._al(BOY)
        const n = new DataView(o.buffer, o.byteOffset, BOY).getUint32(0)
        if (n === 0 || n > EN_COK) {
          if (this.dur) { this.durdu = true; this.parcalar = []; this.boy = 0; this.gecersiz(); return }
          this.gecersiz()
          // Gövdeyi atla: elde olanı düş, kalanını sonraki parçalardan say
          const d = Math.min(n, this.boy)
          this._al(d)
          this.at = n - d
          if (this.at > 0) return
          continue
        }
        this.bekle = n
      }
      if (this.boy < this.bekle) return
      const g = this._al(this.bekle)
      this.bekle = -1
      this.tamam(b4a.toString(g))
    }
  }
}

/**
 * Sunucuyu IPC akışına bağlar. Dönüş: { kapat(), durum } — durum.gelen / giden / gecersiz / atilan sayaçları.
 * sonra(): her isle bittikten sonra (cevap yazılmadan önce) çağrılır; başlatıcı durumu orada diske yazar.
 */
function ipcBagla ({ ipc, sunucu, sonra = null }) {
  if (!ipc || typeof ipc.on !== 'function' || typeof ipc.write !== 'function') throw new Error('NO_IPC')
  const durum = { gelen: 0, giden: 0, gecersiz: 0, atilan: 0 }
  let acik = true

  const yaz = (c) => { durum.giden++; ipc.write(c) }
  const kanalHatasi = (hata) => yaz(cerceveYaz(JSON.stringify({ id: null, olay: 'channel', govde: { hata } })))

  // Dönüş: gönderildi mi. 1 MiB'ı aşan çerçeve gönderilmez: cevapsa aynı kimlikle, geri çağrıysa çağrının ait olduğu
  // komutun kimliğiyle (komutId, yoksa id) INVALID_FRAME; kimliksiz olaysa kanal olayı. Sunucunun reddet(id, hata)
  // kancası varsa bekleyen işi bırakır.
  function gonder (metin) {
    if (!acik) return false
    const c = cerceveYaz(metin)
    if (c) { yaz(c); return true }
    durum.atilan++
    let id = null
    try {
      const j = JSON.parse(metin)
      if (j && typeof j === 'object' && 'cagri' in j && typeof sunucu.reddet === 'function') {
        // Sunucu bekleyen çağrıyı bırakır; komutun cevabını ({ id, hata }) kendisi verir
        try { sunucu.reddet(j.id, 'INVALID_FRAME') } catch {}
        return false
      }
      if (j && typeof j === 'object') id = 'cagri' in j ? (j.komutId ?? j.id ?? null) : (j.id ?? null)
    } catch {}
    if (id === null) kanalHatasi('INVALID_FRAME')
    else yaz(cerceveYaz(JSON.stringify({ id, hata: 'INVALID_FRAME' })))
    return false
  }

  // Gelen metnin kimliği (sunucu fırlatırsa cevap o kimlikle döner)
  function kimligi (metin) {
    try { const j = JSON.parse(metin); return j && typeof j === 'object' && (typeof j.id === 'number' || typeof j.id === 'string') ? j.id : null } catch { return null }
  }

  async function isle (metin) {
    let cevap
    try {
      cevap = await sunucu.isle(metin)
    } catch (err) {
      const kod = err && /^[A-Z][A-Z0-9_]{1,63}$/.test(err.message) ? err.message : 'INTERNAL_ERROR'
      cevap = JSON.stringify({ id: kimligi(metin), hata: kod })
    }
    if (sonra) try { sonra() } catch {}
    if (cevap) gonder(cevap)
  }

  const ayirici = new Ayirici({
    durOnGecersiz: true,
    tamam: (metin) => { durum.gelen++; isle(metin) },
    gecersiz: () => {
      durum.gecersiz++
      kanalHatasi('INVALID_FRAME')
      kapat() // eşzamanlama kayboldu: uygulama worklet'i yeniden başlatır
    }
  })

  const veri = (p) => { if (acik) ayirici.yaz(typeof p === 'string' ? b4a.from(p) : p) }

  let birak = null
  function kapat () {
    if (!acik) return
    acik = false
    if (typeof ipc.off === 'function') ipc.off('data', veri)
    else if (typeof ipc.removeListener === 'function') ipc.removeListener('data', veri)
    if (typeof birak === 'function') birak()
  }
  ipc.on('data', veri)
  birak = sunucu.olaylariBagla(gonder)

  return { durum, gonder, kapat, get acik () { return acik } }
}

// Başlangıç el sıkışması (RFC-0027 §5 a): uygulama ilk çerçeveyle platform anahtarını verir (Yuva Hat START 1 gibi):
//   { id, komut: 1, govde: { anahtarHex, archivePubHex, sayac } }
// Anahtar argv'ye ya da dosyaya yazılmaz. Dönüş: { id, anahtar, archivePubHex, sayac }; cevabı çağıran verir
// (start bittikten sonra { id, sonuc: { hazir: true } } ya da { id, hata }). Başka ilk çerçeve NO_START.
const BASLANGIC = 1
function baslangicBekle ({ ipc }) {
  if (!ipc || typeof ipc.on !== 'function') return Promise.reject(new Error('NO_IPC'))
  return new Promise((resolve, reject) => {
    const bitir = (f) => { if (typeof ipc.off === 'function') ipc.off('data', veri); else if (typeof ipc.removeListener === 'function') ipc.removeListener('data', veri); f() }
    const ayirici = new Ayirici({
      durOnGecersiz: true,
      gecersiz: () => bitir(() => reject(new Error('INVALID_FRAME'))),
      tamam: (metin) => {
        let j = null
        try { j = JSON.parse(metin) } catch {}
        const g = j && j.govde
        if (!j || j.komut !== BASLANGIC || !g || typeof g.anahtarHex !== 'string' || !/^[0-9a-f]{64}$/.test(g.anahtarHex)) return bitir(() => reject(new Error('NO_START')))
        bitir(() => resolve({ id: j.id, anahtar: b4a.from(g.anahtarHex, 'hex'), archivePubHex: g.archivePubHex || null, sayac: Number.isSafeInteger(g.sayac) ? g.sayac : null }))
      }
    })
    const veri = (p) => ayirici.yaz(typeof p === 'string' ? b4a.from(p) : p)
    ipc.on('data', veri)
  })
}

module.exports = { ipcBagla, cerceveYaz, Ayirici, EN_COK, baslangicBekle, BASLANGIC }
