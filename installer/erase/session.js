// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// erase/session.js — silme oturumunun akışı (RFC-0007 §13.2 adım 1–8)
//
// Akış burada, komutlar ve aygıt okuma/yazma `sistem` kancasında. Üretimde kanca shell.js'tir (yalnız silme ortamında
// çalışır); testlerde sahte disklerle çalışan bir taklittir. Bu dosya hiçbir komutu kendisi çalıştırmaz.
//
// sistem: {
//   calistir(argv) → Promise<{ status, stdout, stderr }>     // argv[0] komut adı; ATA parolası argv içinde gelir
//   dosyaOku(yol) → Promise<Buffer | null>                   // DMI dosyaları
//   espOku(bolum) → Promise<Buffer | null>                   // ESP salt okunur bağlanır, bilet okunur, ayrılır
//   boyut(yol) → Promise<number>                             // blockdev --getsize64
//   blokOku(yol, ofset, uzunluk) → Promise<Buffer>
//   blokYaz(yol, ofset, buf) → Promise<void>
//   onbellekBosalt(yol) → Promise<void>                      // blockdev --flushbufs + drop_caches
//   bekle(ms), simdi() → ms, rastgeleBayt(n) → Buffer
//   yaz(metin), sor(soru) → Promise<string>, qrGoster(metinler, baslik) → Promise<void> (Enter'a kadar döner)
// }
const b4a = require('b4a')
const K = require('./discovery')
const N = require('./nvme')
const A = require('./ata')
const Y = require('./method')
const O = require('./example')
const B = require('./ticket')
const R = require('./report')
const { Desen } = require('./pattern')

const PARCA = 4 * 1024 * 1024
const YOKLAMA_MS = 5000
const SANITIZE_SINIRI_MS = 12 * 3600 * 1000

const metin = (x) => (b4a.isBuffer(x) ? b4a.toString(x) : String(x || ''))

// smartctl -j -A: ATA öznitelik 5 (Reallocated_Sector_Ct) ham değeri; NVMe'de yok
function yenidenAtanmis (json) {
  try {
    const j = typeof json === 'string' ? JSON.parse(json) : json
    const t = j.ata_smart_attributes && j.ata_smart_attributes.table
    const a = Array.isArray(t) ? t.find((x) => x.id === 5) : null
    return a && a.raw && Number.isSafeInteger(a.raw.value) ? a.raw.value : 0
  } catch { return 0 }
}

class SilmeOturumu {
  constructor ({ sistem, toolVersion }) {
    this.s = sistem
    this.toolVersion = toolVersion
    this.anahtar = null
    this.bilet = null
    this.diskler = []
    this.sonuclar = []
    this.raporlar = []
  }

  async komut (argv, { gizle = null } = {}) {
    const r = await this.s.calistir(argv)
    return { status: r.status, stdout: metin(r.stdout), stderr: metin(r.stderr), argv: gizle ? argv.map((a) => (a === gizle ? '***' : a)) : argv }
  }

  // §13.2 adım 2: bütün ESP'ler salt okunur; bilet aranır
  async biletBul (lsblk) {
    const adaylar = []
    for (const p of K.espBolumleri(lsblk)) adaylar.push(await this.s.espOku(p))
    this.bilet = B.biletSec(adaylar)
    if (this.bilet.yok) this.s.yaz('Bilet yok: cihaz kimliği doğrulanamayacak.')
    else this.s.yaz(`Emeklilik bileti bulundu: ${this.bilet.ids.length} kimlik.`)
    return this.bilet
  }

  // §13.3: lsblk + her disk için yetenek çıktıları
  async kesfet () {
    const l = await this.komut(['lsblk', '-J', '-b', '-o', K.SUTUNLAR.join(',')])
    if (l.status !== 0) throw new Error('LSBLK_ERROR')
    const lsblk = K.lsblkCoz(l.stdout)
    const adaylar = K.diskleriBul(lsblk)
    const ek = { nvme: {}, hdparm: {}, hpa: {}, dco: {}, luks: {}, smart: {} }
    for (const d of adaylar) {
      if (d.veriYolu === 'nvme') {
        const r = await this.komut(['nvme', 'id-ctrl', d.yol, '-o', 'json'])
        if (r.status === 0) ek.nvme[d.yol] = r.stdout
      } else if (d.veriYolu !== 'mmc') {
        const r = await this.komut(['hdparm', '-I', d.yol])
        if (r.status === 0) ek.hdparm[d.yol] = r.stdout
        if (d.donen || (r.status === 0 && !A.hdparmCoz(r.stdout).ssd)) {
          const n = await this.komut(['hdparm', '-N', d.yol])
          if (n.status === 0) ek.hpa[d.yol] = n.stdout
          const c = await this.komut(['hdparm', '--dco-identify', d.yol])
          if (c.status === 0) ek.dco[d.yol] = c.stdout
          const s = await this.komut(['smartctl', '-j', '-A', d.yol])
          if (s.stdout) ek.smart[d.yol] = yenidenAtanmis(s.stdout)
        }
      }
      const bolumler = [d.yol, ...((lsblk.find((x) => x.yol === d.yol) || { cocuklar: [] }).cocuklar.map((x) => x.yol))]
      for (const b of bolumler) ek.luks[b] = (await this.komut(['cryptsetup', 'isLuks', b])).status === 0
    }
    this.diskler = K.diskleriBul(lsblk, ek).map((d) => ({ ...d, yenidenAtanmis: ek.smart[d.yol] || 0 }))
    return { lsblk, diskler: this.diskler }
  }

  // Harici ve çıkarılabilir diskler ayrıca onay ister (§13.3)
  async secimYap () {
    this.s.yaz('Diskler:')
    for (const d of this.diskler) this.s.yaz('  ' + K.tabloSatiri(d))
    for (const d of this.diskler) {
      if (!d.harici) continue
      const c = (await this.s.sor(`${d.yol} harici ya da çıkarılabilir bir disk. Bu disk de silinsin mi? (E/H)`)).trim().toUpperCase()
      d.secili = c === 'E'
    }
    return this.diskler.filter((d) => d.secili)
  }

  async ornekOku (disk, konumlar) {
    const m = new Map()
    for (const k of konumlar) m.set(k, await this.s.blokOku(disk.yol, k, O.BLOK))
    return m
  }

  async yoklama (argv, coz) {
    const bas = this.s.simdi()
    while (true) {
      const r = await this.komut(argv)
      const d = r.status === 0 ? coz(r.stdout) : null
      if (d && d.durum !== 'suruyor') return d
      if (this.s.simdi() - bas > SANITIZE_SINIRI_MS) return d || { durum: 'basarisiz', driveStatus: 'yoklama süresi doldu' }
      await this.s.bekle(YOKLAMA_MS)
    }
  }

  async uzerineYaz (disk, boyut, dogrula) {
    const desen = new Desen({ anahtar: this.s.rastgeleBayt(32), nonce: this.s.rastgeleBayt(24) })
    try {
      let sonYuzde = -1
      for (let o = 0; o < boyut; o += PARCA) {
        await this.s.blokYaz(disk.yol, o, desen.parca(o, Math.min(PARCA, boyut - o)))
        const y = Math.floor((o / boyut) * (dogrula ? 50 : 100))
        if (y >= sonYuzde + 5) { sonYuzde = y; this.s.yaz(`  ${disk.yol}: %${y}`) }
      }
      await this.s.onbellekBosalt(disk.yol)
      if (!dogrula) return { tamam: true }
      for (let o = 0; o < boyut; o += PARCA) {
        if (!desen.dogrula(o, await this.s.blokOku(disk.yol, o, Math.min(PARCA, boyut - o)))) return { tamam: false, ofset: o }
        const y = 50 + Math.floor((o / boyut) * 50)
        if (y >= sonYuzde + 5) { sonYuzde = y; this.s.yaz(`  ${disk.yol}: %${y}`) }
      }
      return { tamam: true }
    } finally { desen.sil() }
  }

  // Tek disk: önce LUKS, sonra diskin yöntemi, önce/sonra örnek, sonuç
  async diskSil (disk) {
    const startedAt = this.s.simdi()
    const olcum = { notlar: [] }
    let plan = { method: 'clear-unverified', tur: 'uzerine-yaz' }
    try {
      plan = Y.yontemSec(disk)
      if (plan.gerek === 'uyku') {
        this.s.yaz(`${disk.yol} donmuş; uyku–uyanma döngüsü deneniyor (5 sn).`)
        await this.komut(Y.UYKU)
        const r = await this.komut(['hdparm', '-I', disk.yol])
        if (r.status === 0) disk.ata = A.hdparmCoz(r.stdout)
        plan = Y.yontemSec(disk, { uykuDenendi: true })
      }
      const k = Y.komutlar(plan, disk)
      this.s.yaz(`${disk.yol}: ${plan.method}, tahmini süre ~${Math.ceil(Y.tahminiSure(plan, disk.boyut) / 60)} dk`)
      // Önce LUKS: bütün anahtar yuvaları ve başlık alanı
      for (const argv of k.luks) {
        const r = await this.komut(argv)
        if (r.status !== 0) { olcum.hata = true; olcum.notlar.push('LUKS silinemedi: ' + argv[3]) }
        const n = Math.min(Y.LUKS_BASLIK, await this.s.boyut(argv[3]))
        await this.s.blokYaz(argv[3], 0, this.s.rastgeleBayt(n))
        // Başlığın rastgele baytları donanım silmesinden ÖNCE diske inmeli: sonra inen kirli sayfa silineni yeniden
        // yazar ve örnek denetimi tutmaz (sanal makinede NVMe Format'ta görüldü)
        await this.s.onbellekBosalt(argv[3])
      }
      await this.s.onbellekBosalt(disk.yol)
      let once = null
      if (plan.ornek) {
        const konumlar = O.konumlar(disk.boyut, this.s.rastgeleBayt)
        once = new Map([...(await this.ornekOku(disk, konumlar))].map(([kk, v]) => [kk, O.ozet(v)]))
      }
      if (plan.tur === 'nvme-sanitize') {
        const r = await this.komut(k.baslat)
        if (r.status !== 0) olcum.hata = true
        else olcum.sanitizeLog = await this.yoklama(k.durum, N.sanitizeLogCoz)
      } else if (plan.tur === 'nvme-format') {
        if ((await this.komut(k.baslat)).status !== 0) olcum.hata = true
      } else if (plan.tur === 'ata-sanitize') {
        const r = await this.komut(k.baslat)
        if (r.status !== 0) olcum.hata = true
        else olcum.ataSanitize = await this.yoklama(k.durum, A.sanitizeDurumCoz)
      } else if (plan.tur === 'ata-guvenlik') {
        // Geçici kullanıcı parolası: rastgele, yalnız bellekte
        const parola = b4a.toString(this.s.rastgeleBayt(12), 'hex')
        const yer = (argv) => argv.map((a) => (a === Y.PAROLA ? parola : a))
        if ((await this.komut(yer(k.parolaKur), { gizle: parola })).status !== 0) olcum.hata = true
        else if ((await this.komut(yer(k.baslat), { gizle: parola })).status !== 0) {
          olcum.hata = true
          await this.komut(yer(k.kaldir), { gizle: parola })
        }
        const d = await this.komut(k.durum)
        if (d.status === 0) olcum.guvenlikSonra = A.guvenlikCoz(d.stdout)
      } else {
        let boyut = disk.boyut
        if (k.hpa) {
          const r = await this.komut(k.hpa)
          const n = await this.komut(['hdparm', '-N', disk.yol])
          const h = n.status === 0 ? A.hpaCoz(n.stdout) : null
          olcum.hpaKaldirildi = r.status === 0 && !!h && !h.hpa
          if (olcum.hpaKaldirildi) boyut = await this.s.boyut(disk.yol)
        }
        olcum.dogrulama = await this.uzerineYaz(disk, boyut, plan.dogrula)
        if (k.sonra) {
          const r = await this.komut(k.sonra)
          olcum.notlar.push(r.status === 0 ? 'mmc sanitize tamam' : 'mmc sanitize desteklenmiyor')
        }
        olcum.reallocated = disk.yenidenAtanmis || 0
      }
      if (once && !olcum.hata) {
        await this.s.onbellekBosalt(disk.yol)
        olcum.ornek = O.karsilastir(once, await this.ornekOku(disk, [...once.keys()]))
      }
    } catch (err) {
      olcum.hata = true
      olcum.notlar.push('hata: ' + err.message)
    }
    const s = Y.sonucDegerlendir(plan, olcum)
    const sonuc = { disk: { yol: disk.yol, model: disk.model, seri: disk.seri }, method: plan.method || 'clear-unverified', ...s, startedAt, finishedAt: Math.max(startedAt, this.s.simdi()) }
    this.s.yaz(`${disk.yol}: ${sonuc.result}${sonuc.uyari ? ' — ' + sonuc.uyari : ''}`)
    return sonuc
  }

  async cihazBilgisi () {
    const oku = async (ad) => metin(await this.s.dosyaOku('/sys/class/dmi/id/' + ad))
    return R.cihazBilgisi({ productSerial: await oku('product_serial'), sysVendor: await oku('sys_vendor'), productName: await oku('product_name') })
  }

  // Bütün akış. Dönüş: { secim: 'kapat' | 'yeniden-kur' | 'iptal', raporlar, sonuclar }
  async calis () {
    const s = this.s
    s.yaz('Havenfold silme modu. Bu bilgisayardaki diskler silinecek.')
    try {
      const { lsblk } = await this.kesfet()
      await this.biletBul(lsblk)
      const secili = await this.secimYap()
      if (!secili.length) { s.yaz('Silinecek disk yok.'); return { secim: 'iptal', raporlar: [], sonuclar: [] } }
      // §13.2 adım 4: anahtar QR'ı (silmeden önce)
      this.anahtar = R.raporAnahtari()
      const qr = R.anahtarQr({ bilet: this.bilet, anahtar: this.anahtar, diskSayisi: secili.length, toolVersion: this.toolVersion })
      await s.qrGoster([qr], 'Anahtar QR\'ı: ebeveyn telefonuyla okutun, sonra Enter.')
      // Adım 5: onay
      const onay = (await s.sor(`${secili.length} disk silinecek. Devam için SIL yazın.`)).trim()
      if (onay !== 'SIL') { s.yaz('Onay verilmedi; hiçbir disk silinmedi.'); return { secim: 'iptal', raporlar: [], sonuclar: [] } }
      // Adım 6–7
      const cihaz = await this.cihazBilgisi()
      for (const d of secili) this.sonuclar.push(await this.diskSil(d))
      this.raporlar = this.sonuclar.map((sonuc) => R.raporYaz({ bilet: this.bilet, cihaz, sonuc, toolVersion: this.toolVersion, anahtar: this.anahtar }))
      if (this.sonuclar.some((x) => x.method === 'clear-unverified')) s.yaz(Y.UYARI_DOGRULANAMADI)
      await s.qrGoster(R.raporParcalari(this.raporlar, { konsol: true }), 'Rapor QR\'ları dönüyor (ok tuşlarıyla elle de geçilir). Telefon "Rapor alındı" deyince Enter.')
      // Adım 8
      const c = (await s.sor('1) Kapat  2) Havenfold\'u yeniden kur')).trim()
      return { secim: c === '2' ? 'yeniden-kur' : 'kapat', raporlar: this.raporlar, sonuclar: this.sonuclar }
    } finally {
      R.anahtariSil(this.anahtar) // her iki durumda da (ve hata olsa da) anahtar silinir
    }
  }
}

module.exports = { SilmeOturumu, yenidenAtanmis, PARCA }
