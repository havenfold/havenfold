// SPDX-License-Identifier: Apache-2.0
// bridge.js — kişisel köprü (RFC-0005 §15; D46): aynı telefondaki ekip (Mekan Hat) ve aile (Yuva Hat) uygulaması arasında
// kişinin kendi yazdığı kendi durumu. Komutlar 288 BRIDGE_PREPARE, 289 BRIDGE_RECEIVE (RFC-0005 §17).
//
// Otomatik akış yoktur: gönderen uygulamada düğme (kişinin seçtiği türlerde görünür; varsayılan hiçbiri), alan uygulamada
// önizleme. Alan uygulama paketi kişi onaylarsa kişinin kendi mesajı olarak gönderir; SDK göndermez. Taşıma işletim
// sisteminin aynı geliştiricinin uygulamaları arasındaki kısıtlı yoludur (iOS uygulama grubu kabı, Android imza düzeyli
// niyet); kanca platformdadır: kanal.birak(metin). Paket iş verisi, ad, işletme, yer taşımaz; kriptografi yok.
const b4a = require('b4a')
const sodium = require('sodium-native')
const { kopru: K } = require('@havenfold/core')

function fail (code) { throw new Error(code) }

const BRIDGE_COMMAND = { BRIDGE_PREPARE: 288, BRIDGE_RECEIVE: 289 }

class BridgeApi {
  // kendi: bu uygulamanın topluluk türü ('ekip' | 'aile'). saklama: { get(k), set(k, v) } kalıcı (düğme seçimi ve
  // görülen nonce'lar; yalnız bu telefonda). kanal: { birak(metin) } işletim sistemi yolu (verilmezse metin döner)
  // kanal (platform, RFC-0027 §7): birak(metin) kendi yön klasörüne yazar; temizle() bu uygulamanın gönderilmemiş
  // paketlerini siler (isteğe bağlı)
  constructor ({ kendi, saklama = null, kanal = null, now = Date.now }) {
    if (!K.yonVar(kendi)) fail('INVALID_BRIDGE')
    this.kendi = kendi
    const m = new Map()
    this.saklama = saklama || { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v) }
    this.kanal = kanal
    this.now = now
    this.nonce = new K.NonceDefteri({ saklama: this.saklama, now })
  }

  // Bu yönde geçebilecek türler (§15.2)
  kinds () { return K.TURLER[this.kendi].slice() }

  // Kişinin ayarı: hangi türlerde köprü düğmesi görünür (varsayılan hiçbiri). İşletme ya da aile bunu bilmez.
  // Düğme kapanınca kanaldaki gönderilmemiş paketler silinir (inceleme 17 Ş3)
  buttons (turler = null) {
    if (turler !== null) {
      if (!Array.isArray(turler) || turler.some((x) => !K.TURLER[this.kendi].includes(x))) fail('BRIDGE_TYPE')
      const once = this.saklama.get('kopru/dugmeler') || []
      this.saklama.set('kopru/dugmeler', [...new Set(turler)])
      if (once.some((x) => !turler.includes(x))) this._temizle()
    }
    return this.saklama.get('kopru/dugmeler') || []
  }

  _temizle () { if (this.kanal && typeof this.kanal.temizle === 'function') this.kanal.temizle() }

  // Ekipten ayrılınca ya da çıkarılınca (RFC-0027 §7 d): iki yöndeki düğmeler kapanır, gönderilmemiş paketler silinir.
  // TeamApi kopru verildiyse ayrılışta ve silmede bunu çağırır; aile tarafının BridgeApi'si için uygulama çağırır.
  close () {
    this.saklama.set('kopru/dugmeler', [])
    this._temizle()
  }

  // 288 BRIDGE_PREPARE: kişi düğmeye bastı. Tür kişinin açtığı düğmelerden olmalı (BRIDGE_DISABLED). Dönüş: { metin, yol }
  // (yol: 'kanal' platform yoluna bırakıldı, 'metin' çağıran taşır)
  prepare ({ type, text }) {
    if (!K.TURLER[this.kendi].includes(type)) fail('BRIDGE_TYPE')
    if (!this.buttons().includes(type)) fail('BRIDGE_DISABLED')
    const nonce = b4a.alloc(16)
    sodium.randombytes_buf(nonce)
    const metin = K.kopruYaz({ from: this.kendi, type, text, at: this.now(), nonce })
    if (this.kanal && typeof this.kanal.birak === 'function') { this.kanal.birak(metin); return { metin, yol: 'kanal' } }
    return { metin, yol: 'metin' }
  }

  // 289 BRIDGE_RECEIVE: öbür uygulamadan gelen taşıma metni. Denetlenir (tür listesi, 280 bayt, yön, 7 gün içinde aynı nonce
  // BRIDGE_REPLAY) ve önizleme döner; kişi onaylarsa uygulama kendi mesajı olarak "iş" ya da "aile" etiketiyle gönderir.
  // kaynak: platformun bildirdiği yazan uygulamanın türü (okunan yön klasörü; RFC-0027 §7 a), uygulama: onun görünen adı
  // (önizleme paketteki from'u değil bunu gösterir). sil(): başarıyla alınan paketi kanaldan siler (§7 c; bir kez teslim)
  receive (metin, { kaynak = null, uygulama = null, sil = null } = {}) {
    const simdi = this.now()
    const m = K.kopruCoz(metin, { kendi: this.kendi, simdi, kaynak })
    this.nonce.gor(m.nonce, simdi)
    if (typeof sil === 'function') sil()
    const o = { from: m.from, type: m.type, text: m.text, at: m.at, etiket: m.from === 'ekip' ? 'is' : 'aile' }
    return uygulama ? { ...o, uygulama } : o
  }
}

module.exports = { BridgeApi, BRIDGE_COMMAND }
