// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// ipc/server.js — IPC bağlantısının taşıyıcıdan bağımsız kısmı (RFC-0007 §6.1)
//
// Dinleyen taraf her bağlantıda karşı ucun kullanıcısını (SO_PEERCRED) alır; beklenen kullanıcı değilse bağlantı
// kurulmaz. Bir soketten gelen istek yalnız o soketin kapsamına uygulanır (kutu soketinden gelen YEDEK_OKU yalnız
// kutu yedeğine bakar). Çözülemeyen çerçeve HATA ile cevaplanır; 1 MiB'ı aşan çerçeve bağlantıyı kapatır.
const { IPC } = require('./types')
const { CerceveOkuyucu, cerceveYaz, mesajCoz, hataCercevesi } = require('./frame')

function fail (code) { throw new Error(code) }

// isleyiciler: { [type]: (mesaj, { kapsam, kullanici, reqId }) → yanıtlar } ; yanıt: { type, mesaj, yon?, reqId? }
// gelenYon: bu uçta karşıdan gelen mesajların yönü ('istek'; MERHABA cevabını bekleyen istemcide 'cevap').
class IpcUcu {
  constructor ({ kapsam, beklenen, isleyiciler, gelenYon = () => 'istek' }) {
    if (!beklenen || !beklenen.size) fail('NO_EXPECTED_USER')
    this.kapsam = kapsam
    this.beklenen = beklenen
    this.isleyiciler = isleyiciler
    this.gelenYon = gelenYon
    this.acik = new Set() // yazıcısı bağlı bağlantılar (yayinla için)
  }

  // Bu uçtaki bütün açık bağlantılara cevapsız bildirim (reqId 0). Örnek: güç değişince SAGLIK_ANLIK yeniden (RFC-0012
  // §10; supervisor-main.js). Dönüş: gönderilen bağlantı sayısı
  yayinla (type, mesaj) {
    let n = 0
    for (const b of this.acik) if (b.gonder(type, mesaj)) n++
    return n
  }

  // kullanici: SO_PEERCRED'den çözülen kullanıcı adı. Dönüş: Baglanti ya da null (kapat)
  baglan (kullanici) {
    if (typeof kullanici !== 'string' || !this.beklenen.has(kullanici)) return null
    return new Baglanti(this, kullanici)
  }
}

class Baglanti {
  constructor (uc, kullanici) {
    this.uc = uc
    this.kullanici = kullanici
    this.okuyucu = new CerceveOkuyucu()
    this.kapali = false
    this.yazici = null
  }

  // Taşıyıcı (socket.js) yazıcıyı bağlar; bağlantı kapanınca birak()
  yaziciBagla (fn) { this.yazici = fn; this.uc.acik.add(this) }
  birak () { this.kapali = true; this.yazici = null; this.uc.acik.delete(this) }

  gonder (type, mesaj) {
    if (this.kapali || !this.yazici) return false
    this.yazici(cerceveYaz(type, 0, mesaj, 'istek'))
    return true
  }

  // Gelen baytlar → { cikis: [çerçeve], kapat: bool }
  async al (parca) {
    if (this.kapali) return { cikis: [], kapat: true }
    let mesajlar
    try { mesajlar = this.okuyucu.besle(parca) } catch { this.kapali = true; return { cikis: [], kapat: true } }
    const cikis = []
    for (const b of mesajlar) {
      let m
      try { m = mesajCoz(b, this.uc.gelenYon(this)) } catch (err) {
        cikis.push(hataCercevesi(err.reqId || 0, err.message))
        continue
      }
      const f = this.uc.isleyiciler[m.type]
      if (!f) { cikis.push(hataCercevesi(m.reqId, 'UNSUPPORTED')); continue }
      try {
        const yanit = await f(m.mesaj, { kapsam: this.uc.kapsam, kullanici: this.kullanici, reqId: m.reqId, baglanti: this })
        for (const y of [].concat(yanit || [])) cikis.push(cerceveYaz(y.type, y.reqId ?? m.reqId, y.mesaj, y.yon || 'istek'))
      } catch (err) {
        cikis.push(hataCercevesi(m.reqId, /^[A-Z_]+$/.test(err.message) ? err.message : 'INTERNAL_ERROR'))
      }
    }
    return { cikis, kapat: false }
  }
}

module.exports = { IpcUcu, Baglanti, IPC }
