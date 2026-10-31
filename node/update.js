// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// update.js — denetçinin güncelleme akışı: doğrula, aç, zamanla, geç, sağlık bildirimi (RFC-0007 §12.6, RFC-0026)
//
// Saf durum makinesi: yan etkileri kancalardan yapar (yetki yardımcısı, çekirdeklere DURDUR, surum.durum ve bekleyen
// güncelleme yazımı). Durum NODE_HEALTH.software.update alanına karşılık gelir.
//
// Sürüm tekdüzeliği, sağlık penceresi ve geri dönüş yardımcıdadır (RFC-0026 c, d): denetçi geçişten sonra yeniden
// başlar; yeni denetçi sonucu yardımcının kopyasından ('durum-oku') okur. Bekleyen güncelleme kalıcıdır (e).
const b4a = require('b4a')
const S = require('./release')

function fail (code) { throw new Error(code) }

const SAGLIK_MS = 10 * 60_000
const GOREV_BEKLEME_MS = 6 * 3_600_000
// Yardımcının hata kodları; başka hata ve istek gittikten sonra kopan bağlantı (PRIVILEGE_DISCONNECTED: yardımcı denetçiyi
// yeniden başlattı) geçiş olmuş sayılır (Codex 12. tur: kopma NO_PERMISSION'dı, kurulu sürüm eskiye geri yazılıyordu)
const HATA_KODU = /^[A-Z][A-Z0-9_]*$/
const KOPMA = 'PRIVILEGE_DISCONNECTED'

class Guncelleyici {
  // durum: surum.durum ({ urunler }); bekleyen: kalıcı bekleyen güncelleme (bekleyenKaydet'in yazdığı) ya da null;
  // yetki(islem, girdi) → Promise; durdur(neden); kaydet(durum); bekleyenKaydet(bekleyen | null); pencereAcik();
  // gorevler() → { surekli: n, diger: n }; kendiniSina(dizin) → Promise<bool> (bin/havenfold kendini-sina --kuru)
  constructor ({ durum, bekleyen = null, kok, yetki, durdur = () => {}, kaydet = () => {}, bekleyenKaydet = () => {}, pencereAcik = () => true, gorevler = () => ({ surekli: 0, diger: 0 }), kendiniSina = async () => true, simdi = Date.now, urun = 'havenfold-node', os = 'linux', arch = 'amd64' }) {
    this.durum = durum
    this.kok = kok
    this.k = { yetki, durdur, kaydet, bekleyenKaydet, pencereAcik, gorevler, kendiniSina }
    this.simdi = simdi
    this.urun = urun
    this.os = os
    this.arch = arch
    this.bekleyen = bekleyen // { surum, versionCode, acil, bekleBas, revoked, onay (hex | null) }
    this.hal = bekleyen ? 'pencere-bekliyor' : 'guncel'
    this.hata = ''
  }

  get _u () { return this.durum.urunler.find((x) => x.product === this.urun) }

  // Bildirim ve indirilmiş paket önbellekte. onay: ebeveynin başlattığı düşürmede UPDATE_APPROVE baytları (yardımcı
  // doğrular). Kurulu sürümden düşük bildirim sessizce yok sayılır; daha düşük bildirim bekleyenin yerini almaz;
  // bekleyenin ya da verilen listenin geri çektiği sürüm kurulmaz (RFC-0026 e).
  async hazirla ({ bildirimBytes, bildirimYolu, paketYolu, paketOzeti, paketBoyu, onay = null, revoked = [] }) {
    const cekilen = [...new Set([...revoked, ...(this.bekleyen ? this.bekleyen.revoked : [])])]
    const r = S.bildirimKarari(bildirimBytes, this.kok(), this.durum, { urunler: [this.urun], onay: !!onay, revoked: cekilen })
    if (r.karar === 'yok-say' || r.karar === 'ara-surum') return r.karar
    if (r.karar === 'onay-gerekli') return 'yok-say'
    if (cekilen.includes(r.m.versionCode)) return 'yok-say'
    if (this.bekleyen && !onay && r.m.versionCode <= this.bekleyen.versionCode) return 'yok-say'
    const satir = r.m.packages.find((p) => p.os === this.os && p.arch === this.arch)
    if (!satir) fail('MANIFEST_ERROR')
    S.dosyaDenetle(satir, { ozet: paketOzeti, boyut: paketBoyu })
    this.hal = 'indiriliyor'
    await this.k.yetki('paket-ac', { surum: r.m.version, dosya: paketYolu, ozet: b4a.toString(satir.digest, 'hex'), bildirim: bildirimYolu, ...(onay ? { onay } : {}) })
    if (!(await this.k.kendiniSina(r.m.version))) { this._bozuk(r.m.versionCode, 'KURU_DENEME'); return 'hata' }
    this.bekleyen = { surum: r.m.version, versionCode: r.m.versionCode, acil: r.acil, bekleBas: this.simdi(), revoked: [...new Set([...cekilen, ...r.m.revoked])], onay: onay ? b4a.toString(onay, 'hex') : null }
    this.k.bekleyenKaydet(this.bekleyen)
    this.hal = 'pencere-bekliyor'
    return 'kur'
  }

  // Zaman kuralı (§12.6 madde 3): kararlı kanalda bakım penceresi; denemede ve acilde hemen. Sürekli olmayan görev en
  // çok 6 saat beklenir; sürekli görevler duraklatılır.
  zamaniGeldi () {
    const b = this.bekleyen
    if (!b) return false
    if (!(b.acil || this._u.channel === 'deneme' || this.k.pencereAcik())) return false
    const g = this.k.gorevler()
    if (g.diger > 0 && this.simdi() - b.bekleBas < GOREV_BEKLEME_MS) return false
    return true
  }

  // Madde 4: çekirdeklere DURDUR, yardımcıyla geçiş. Yardımcı denetçiyi yeniden başlattığı için durum geçişten önce
  // yazılır; cevap gelmeden bağlantı koparsa geçiş olmuş sayılır, sonucu yeni denetçi yardımcıdan okur.
  async gec () {
    const b = this.bekleyen
    if (!b) fail('NOTHING_PENDING')
    this.k.durdur('guncelleme')
    const u = this._u
    const once = { kurulu: u.kurulu, onceki: u.onceki }
    u.onceki = u.kurulu
    u.kurulu = b.versionCode
    this.bekleyen = null
    this.hal = 'indiriliyor'
    this.k.kaydet(this.durum)
    this.k.bekleyenKaydet(null)
    try {
      await this.k.yetki('surum-gec', { surum: b.surum, ...(b.onay ? { onay: b4a.from(b.onay, 'hex') } : {}) })
    } catch (err) {
      if (!HATA_KODU.test(err.message) || err.message === KOPMA) return
      Object.assign(u, once)
      this.bekleyen = b
      this.hal = 'hata'
      this.hata = err.message
      this.k.kaydet(this.durum)
      this.k.bekleyenKaydet(b)
      throw err
    }
  }

  // Denetçinin kendi sınaması geçince (yeni sürümde) sağlığını yardımcıya bildirir; çekirdekler kendileri bildirir
  async denetciSinandi (surum) { return this.k.yetki('saglik-bildir', { surum }) }

  // Sonuç yardımcıdadır. Dönüş: 'bekle' | 'gecti' | 'geri-alindi' | 'geri-alinamadi'
  async saglikDenetle () {
    const r = await this.k.yetki('durum-oku', {})
    const u = this._u
    if (r.deneme) { this.hal = 'indiriliyor'; return 'bekle' }
    const s = r.sonGecis
    // Önceki sürüm yokken geri dönülemedi: sağlıksız sürüm kurulu kalır, bozuk işaretlidir; başarı sayılmaz, enYuksek
    // yükselmez, durum hata (açılış öncesi inceleme, Codex 4. tur)
    if (s && s.yeniKod === u.kurulu && s.durum === 'geri-alinamadi') {
      this._bozuk(s.yeniKod, 'ROLLBACK_FAILED')
      return 'geri-alinamadi'
    }
    if (s && s.yeniKod === u.kurulu && s.durum === 'geri-alindi') {
      u.kurulu = u.onceki
      this.hal = 'geri-alindi'
      this._bozuk(s.yeniKod, 'SAGLIK')
      return 'geri-alindi'
    }
    const enYuksek = Math.max(u.enYuksek, r.enYuksek)
    if (enYuksek !== u.enYuksek) { u.enYuksek = enYuksek; this.k.kaydet(this.durum) }
    if (this.hal === 'indiriliyor' && !this.bekleyen) this.hal = 'guncel'
    return 'gecti'
  }

  _bozuk (versionCode, neden) {
    const u = this._u
    if (!u.bozuk.includes(versionCode)) u.bozuk.push(versionCode)
    this.hata = neden
    if (this.hal !== 'geri-alindi') this.hal = 'hata'
    this.k.kaydet(this.durum)
  }
}

module.exports = { Guncelleyici, SAGLIK_MS, GOREV_BEKLEME_MS }
