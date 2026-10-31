// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// disaster/bluez.js — Linux düğümde Bluetooth LE afet bağı (RFC-0012 §6.2, §6.4, §9.2, §9.3; açıklama 2): reklam, GATT
// hizmeti, tarama, etiket eşleşmesi ve bağ oturumu. BlueZ'e bir köprü üstünden konuşur (dbus-bluez.js; testte benzetim):
//
//   kopru.gattSunucu({ hizmet, nitelikler }) · kopru.gattKaldir() · kopru.bildir(cihaz, uuid, bayt) ·
//   kopru.reklamBaslat({ hizmet }) · kopru.reklamDurdur() · kopru.taramaBaslat({ hizmet }, bulundu(cihaz)) ·
//   kopru.taramaDurdur() · kopru.baglan(cihaz) → { mtu, oku(uuid), yaz(uuid, bayt), bildirimAc(uuid, fn), koptu(fn),
//   kopar() } · kopru.cihaziKopar(cihaz) · kopru.koptu(fn) · kopru.adaptorGeldi(fn) · kopru.mtu(cihaz)
//
// - KAPALI'da yayın, tarama ve GATT hizmeti yoktur (açıklama 2 madde 2): durumUygula(durum) açar ya da kapatır.
// - Güç değişince tarama planı yenilenir (planiYenile; madde 3).
// - Çevre rolünde (reklam yapan) aynı anda tek bağ oturumu yürür: BlueZ'de bildirim niteliğe abone bütün merkezlere gider.
//   Meşgulken gelen ikinci merkezin bağlantısı kapatılır (ATT'de yanıtsız yazma meşgul bildiremez); etiketi doğrulanamayan
//   adres o dilim boyunca yok sayılır (madde 4). Merkez rolünde (tarayan) en çok 3 bağ (§6.4).
// - Bağ, yazma kuyruğu boşalmadan kopartılmaz (madde 5).
// - Tanınan adres (kimlik ve dilim) önbellekte: aynı dilimde yakında eşitlenen cihaza yeniden bağlanılmaz; hata veren
//   adres için geri çekilme (30 sn'den 15 dk'ya katlanarak; inceleme 22 madde 10).
// - Hiçbir Promise hatası süreci düşürmez (bluetoothd yeniden başlarsa); bluetoothd dönünce GATT ve reklam yeniden kaydolur.
// Kutu gibi birleşik cihazda Bluetooth'u kutu süreci kullanır (§6.4); işçi afet mesajını kutuya olağan yerel oturumla bırakır.
const b4a = require('b4a')
const { GattAkisi } = require('./gatt-stream')
const { gorevOrani } = require('./power')

const UUID = {
  HIZMET: '9f6d0001-2c4b-4e7a-8b15-3d0c6a2e71f4',
  TAGS: '9f6d0002-2c4b-4e7a-8b15-3d0c6a2e71f4',
  IN: '9f6d0003-2c4b-4e7a-8b15-3d0c6a2e71f4',
  OUT: '9f6d0004-2c4b-4e7a-8b15-3d0c6a2e71f4',
  PSM: '9f6d0005-2c4b-4e7a-8b15-3d0c6a2e71f4'
}
const EN_COK_BAG = 3
const YOK_SAY_MS = 15 * 60_000
const DILIM_MS = 15 * 60_000
const GERI_ILK_MS = 30_000
const GERI_EN_COK_MS = 15 * 60_000
const BOSALMA_MS = 3000
const ONBELLEK_EN_COK = 256

class AfetBluez {
  /**
   * o: { kopru, afet (DisasterApi), saat?, guc?: GucIzleyici (görev oranı için), zamanlayici?: { setTimeout, clearTimeout } }
   */
  constructor ({ kopru, afet, saat = Date.now, guc = null, zamanlayici = { setTimeout, clearTimeout } }) {
    this.kopru = kopru
    this.afet = afet
    this.saat = saat
    this.guc = guc
    this.z = zamanlayici
    this.yokSay = new Map() // adres → bitiş
    this.onbellek = new Map() // adres → { kimlik, dilim }
    this.geri = new Map() // adres → { bekleMs, son }
    this.merkezBaglar = new Map() // adres → { akis }
    this.cevre = null // { cihaz, akis }
    this.acik = false
    this.taramaZamani = null
    this.olaylar = [] // son işlemler (ölçüm ve tanı; adres yok)
    // Dinleyiciler bir kez (madde 13: birikmez)
    kopru.koptu((cihaz) => {
      if (this.cevre && this.cevre.cihaz === cihaz) this.cevre.akis.koptu()
      this.merkezBaglar.get(cihaz)?.akis?.koptu()
    })
    if (kopru.adaptorGeldi) kopru.adaptorGeldi(() => { if (this.acik) this._sessiz(this._yenidenKaydol(), 'yeniden-kayit') })
  }

  _olay (tur, ek = {}) {
    this.olaylar.push({ tur, an: this.saat(), ...ek })
    if (this.olaylar.length > 100) this.olaylar.shift()
  }

  // Hiçbir Promise hatası yakalanmadan kalmaz (madde 4)
  _sessiz (p, tur = 'hata') { return Promise.resolve(p).catch((e) => this._olay(tur, { neden: e && e.message })) }

  _dilimSonu () { return (Math.floor(this.saat() / DILIM_MS) + 1) * DILIM_MS }

  // Süresi dolan kayıtları buda (madde 15)
  _buda () {
    const t = this.saat()
    for (const [k, v] of this.yokSay) if (t >= v) this.yokSay.delete(k)
    for (const [k, v] of this.geri) if (t - v.son >= GERI_EN_COK_MS * 2) this.geri.delete(k)
    const d = Math.floor(t / DILIM_MS)
    for (const [k, v] of this.onbellek) if (v.dilim < d - 1) this.onbellek.delete(k)
    while (this.onbellek.size > ONBELLEK_EN_COK) this.onbellek.delete(this.onbellek.keys().next().value)
  }

  // --- açma ve kapatma (madde 2, 3, 13) ---

  /** Afet durumuna göre: KAPALI'da her şey kapalı, HAZIR ve ETKİN'de açık */
  async durumUygula (durum) { return durum === 'kapali' ? this.kapat() : this.ac() }

  async ac () {
    if (this.acik) return
    this.acik = true
    await this._sessiz(this._kaydol(), 'kayit-hata')
    await this._sessiz(this._taramaPlanla(), 'tarama-hata')
  }

  async kapat () {
    this.acik = false
    this.z.clearTimeout(this.taramaZamani)
    this.taramaZamani = null
    await this._sessiz(this.kopru.taramaDurdur())
    await this._sessiz(this.kopru.reklamDurdur())
    if (this.kopru.gattKaldir) await this._sessiz(this.kopru.gattKaldir())
    this.cevre?.akis.koptu()
    for (const m of this.merkezBaglar.values()) m.akis?.koptu()
  }

  /** Güç değişti: görev oranına göre tarama planı baştan (madde 3) */
  async planiYenile () {
    if (!this.acik) return
    this.z.clearTimeout(this.taramaZamani)
    this.taramaZamani = null
    await this._sessiz(this.kopru.taramaDurdur())
    await this._sessiz(this._taramaPlanla(), 'tarama-hata')
  }

  async _kaydol () {
    await this.kopru.gattSunucu({
      hizmet: UUID.HIZMET,
      nitelikler: {
        [UUID.TAGS]: { bayraklar: ['read'], oku: () => this.afet.tags().bayt },
        [UUID.IN]: { bayraklar: ['write-without-response'], yaz: (cihaz, bayt) => this._inYazildi(cihaz, bayt) },
        [UUID.OUT]: { bayraklar: ['notify'] },
        [UUID.PSM]: { bayraklar: ['read'], oku: () => b4a.from([0, 0]) } // L2CAP CoC yok: 0
      }
    })
    await this.kopru.reklamBaslat({ hizmet: UUID.HIZMET })
  }

  // bluetoothd yeniden başladı: eski kayıtlar gitti
  async _yenidenKaydol () {
    await this._kaydol()
    await this.planiYenile()
  }

  // Eski adlar (D85): baslat afet durumuna göre açar
  async baslat () { await this.durumUygula(this.afet.state().durum); return this }
  async durdur () { return this.kapat() }

  // --- çevre rolü (madde 4, 7, 8) ---

  /** IN'e yazıldı. Dönüş: kabul edildi mi (reddedilen merkezin bağlantısı kapatılır) */
  _inYazildi (cihaz, bayt) {
    this._buda()
    const ys = this.yokSay.get(cihaz)
    const reddet = (neden) => { this._olay('cevre-ret', { neden }); this._sessiz(this.kopru.cihaziKopar?.(cihaz)); return false }
    if (ys != null && this.saat() < ys) return reddet('yok-sayildi')
    if (this.cevre && this.cevre.cihaz !== cihaz) return reddet('mesgul')
    if (!this.cevre) {
      if (!this.acik) return reddet('kapali')
      if (this.merkezBaglar.size >= EN_COK_BAG) return reddet('dolu')
      const akis = new GattAkisi({ yaz: (p) => this.kopru.bildir(cihaz, UUID.OUT, p), mtu: this.kopru.mtu?.(cihaz) })
      akis.on('error', () => {})
      const c = { cihaz, akis }
      this.cevre = c
      this._olay('cevre-bag')
      this._sessiz((async () => {
        try {
          const r = await this.afet.connect({ ham: akis, baslatan: false, bag: 'bluetooth' })
          this._olay('cevre-bitti', { bitti: r.bitti, alinan: r.alinan.length })
        } catch (e) {
          // Etiketi ya da el sıkışması doğrulanamayan adres o dilim boyunca yok sayılır
          this.yokSay.set(cihaz, this._dilimSonu())
          this._olay('cevre-hata', { neden: e.message })
          await this._sessiz(this.kopru.cihaziKopar?.(cihaz))
        } finally {
          await akis.bosalinca(BOSALMA_MS) // madde 5
          if (this.cevre === c) this.cevre = null
          akis.koptu()
        }
      })())
    }
    this.cevre.akis.al(bayt)
    return true
  }

  // --- merkez rolü (madde 10) ---

  async _bulundu (cihaz) {
    this._buda()
    const simdi = this.saat()
    if (!this.acik) return 'kapali'
    if (this.yokSay.has(cihaz)) return 'yok-sayildi'
    const g = this.geri.get(cihaz)
    if (g && simdi - g.son < g.bekleMs) return 'geri-cekildi'
    const o = this.onbellek.get(cihaz)
    if (o && o.dilim === Math.floor(simdi / DILIM_MS) && !this.afet.syncNeeded(o.kimlik)) return 'gerek-yok' // bağlanmadan
    if (this.merkezBaglar.has(cihaz) || this.merkezBaglar.size + (this.cevre ? 1 : 0) >= EN_COK_BAG) return 'dolu'
    const kayit = { akis: null }
    this.merkezBaglar.set(cihaz, kayit)
    let bag = null
    let sonuc = 'hata'
    try {
      bag = await this.kopru.baglan(cihaz)
      const eslesme = this.afet.match({ bayt: await bag.oku(UUID.TAGS) })
      if (!eslesme) { this.yokSay.set(cihaz, simdi + YOK_SAY_MS); this._olay('eslesmedi'); return (sonuc = 'eslesmedi') } // §6.2
      this.onbellek.delete(cihaz)
      this.onbellek.set(cihaz, { kimlik: eslesme.kimlik, dilim: Math.floor(simdi / DILIM_MS) })
      if (!this.afet.syncNeeded(eslesme.kimlik)) { this._olay('yakin-esitlendi'); return (sonuc = 'gerek-yok') } // §9.2
      const akis = new GattAkisi({ yaz: (p) => bag.yaz(UUID.IN, p), mtu: bag.mtu })
      akis.on('error', () => {})
      kayit.akis = akis
      bag.koptu(() => akis.koptu())
      await bag.bildirimAc(UUID.OUT, (p) => akis.al(p))
      this._olay('merkez-bag')
      const r = await this.afet.connect({ ham: akis, baslatan: true, eslesme, bag: 'bluetooth' })
      this._olay('merkez-bitti', { bitti: r.bitti, alinan: r.alinan.length })
      await akis.bosalinca(BOSALMA_MS) // madde 5: son parçalar (DONE, ALINDI) gitmeden kopartılmaz
      return (sonuc = r.bitti ? 'bitti' : 'yarim')
    } catch (e) {
      this._olay('merkez-hata', { neden: e.message })
      return 'hata'
    } finally {
      this.merkezBaglar.delete(cihaz)
      kayit.akis?.koptu()
      if (sonuc === 'hata') {
        const once = this.geri.get(cihaz)
        this.geri.set(cihaz, { bekleMs: Math.min(GERI_EN_COK_MS, once ? once.bekleMs * 2 : GERI_ILK_MS), son: this.saat() })
      } else this.geri.delete(cihaz)
      if (bag) await this._sessiz(bag.kopar()) // §6.4: iş bitince bağlantı kapanır
    }
  }

  /** §9.3 görev oranına göre tarama: sürekli ya da pencereli; reklam her zaman */
  async _taramaPlanla () {
    if (!this.acik) return
    const oran = gorevOrani(this.guc?.son ?? { prizde: null, pil: null })
    await this.kopru.taramaBaslat({ hizmet: UUID.HIZMET }, (cihaz) => { this._sessiz(this._bulundu(cihaz)) })
    if (oran.tarama.acikMs === Infinity) return
    this.taramaZamani = this.z.setTimeout(() => this._sessiz((async () => {
      await this.kopru.taramaDurdur()
      if (!this.acik) return
      this.taramaZamani = this.z.setTimeout(() => this._sessiz(this._taramaPlanla(), 'tarama-hata'), oran.tarama.aralikMs - oran.tarama.acikMs)
    })(), 'tarama-hata'), oran.tarama.acikMs)
  }
}

module.exports = { AfetBluez, UUID, EN_COK_BAG, YOK_SAY_MS, GERI_ILK_MS, GERI_EN_COK_MS }
