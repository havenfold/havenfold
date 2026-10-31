// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// erase/method.js — silme yöntemi seçimi, komut planı ve sonucun değerlendirilmesi (RFC-0007 §13.4)
//
// Saf. Her disk için tablodaki ilk uyan satır seçilir. `blkdiscard` (TRIM) hiçbir satırda yoktur; sanitize sayılmaz
// (kurucu belge §9.5). Blok silme şifreleme silmeden önce gelir: diskin iç şifreleme uygulamasının doğruluğuna dayanmaz.
// method adları WIPE_REPORT'taki listeyle aynıdır (core/core/protocol/retirement.js METHODS).
const { denetleyici } = require('./nvme')
const { guvenlikOzeti } = require('./ata')

function fail (code) { throw new Error(code) }

const UYARI_DOGRULANAMADI = 'Temizlendi, doğrulanamadı; fiziksel imha önerilir.'
const PAROLA = '<ATA_PAROLA>' // kabuk bellekteki rastgele parolayla değiştirir; günlüğe ve ekrana yazılmaz
const LUKS_BASLIK = 16 * 1024 * 1024 // cryptsetup erase'ten sonra üzerine yazılan başlık alanı

// disk: kesif.diskleriBul çıktısı. secenek.uykuDenendi: donmuş SATA SSD için uyku–uyanma döngüsü yapıldı mı.
// Dönüş: { method, tur, beklenen, ornek, ... } ya da { gerek: 'uyku' } (önce rtcwake, sonra yeniden keşif ve seçim).
function yontemSec (disk, { uykuDenendi = false } = {}) {
  const yol = disk.veriYolu
  const ssdMi = !disk.donen
  // NVMe
  if (yol === 'nvme' && ssdMi) {
    const n = disk.nvme
    if (n && n.sanitize.blok) return { method: 'nvme-sanitize-block', tur: 'nvme-sanitize', sanact: 2, beklenen: 'ok', ornek: true }
    if (n && n.sanitize.kripto) return { method: 'nvme-sanitize-crypto', tur: 'nvme-sanitize', sanact: 4, beklenen: 'ok', ornek: true }
    if (n && n.format.var) return { method: 'clear-unverified', tur: 'nvme-format', ses: n.format.kriptoSilme ? 2 : 1, beklenen: 'dogrulanamadi', ornek: true }
    return { method: 'clear-unverified', tur: 'uzerine-yaz', dogrula: false, beklenen: 'dogrulanamadi', ornek: true }
  }
  // Dönen disk (SATA, USB ya da başka veri yolu): tek geçişli akış deseni + tam okuma
  if (disk.donen) {
    const gizli = !!(disk.dco && disk.dco.kisitli)
    return { method: 'overwrite-verify', tur: 'uzerine-yaz', dogrula: true, hpaKaldir: !!(disk.hpa && disk.hpa.hpa), beklenen: gizli ? 'dogrulanamadi' : 'ok', ornek: false }
  }
  // SATA SSD
  if (yol === 'sata') {
    const a = disk.ata
    if (a && a.guvenlik.donmus && (a.sanitize.blok || a.sanitize.kripto || a.guvenlik.destek)) {
      if (!uykuDenendi) return { gerek: 'uyku' }
      return { method: 'clear-unverified', tur: 'uzerine-yaz', dogrula: false, beklenen: 'dogrulanamadi', ornek: true, not: 'disk donmuş' }
    }
    if (a && a.sanitize.blok) return { method: 'ata-sanitize', tur: 'ata-sanitize', islem: 'blok', beklenen: 'ok', ornek: true }
    if (a && a.sanitize.kripto) return { method: 'ata-sanitize', tur: 'ata-sanitize', islem: 'kripto', beklenen: 'ok', ornek: true }
    if (a && a.guvenlik.destek && !a.guvenlik.kilitli && !a.guvenlik.sayacBitti) {
      return { method: 'ata-secure-erase', tur: 'ata-guvenlik', gelismis: a.guvenlik.gelismis, beklenen: 'ok', ornek: true }
    }
    return { method: 'clear-unverified', tur: 'uzerine-yaz', dogrula: false, beklenen: 'dogrulanamadi', ornek: true }
  }
  // eMMC: tam üzerine yazma + mmc sanitize
  if (yol === 'mmc') return { method: 'clear-unverified', tur: 'mmc', dogrula: false, beklenen: 'dogrulanamadi', ornek: false }
  // USB ya da SD (dönmeyen) ve diğerleri
  return { method: 'clear-unverified', tur: 'uzerine-yaz', dogrula: false, beklenen: 'dogrulanamadi', ornek: false }
}

// Plan için çalıştırılacak komutlar (argv dizileri). Kabuk sırayla çalıştırır; testler sırayı denetler.
function komutlar (plan, disk) {
  const y = disk.yol
  const k = {}
  if (plan.tur === 'nvme-sanitize') {
    const d = denetleyici(y)
    k.baslat = ['nvme', 'sanitize', d, '--sanact=' + plan.sanact]
    k.durum = ['nvme', 'sanitize-log', d, '-o', 'json']
  } else if (plan.tur === 'nvme-format') {
    k.baslat = ['nvme', 'format', y, '--ses=' + plan.ses, '--force']
  } else if (plan.tur === 'ata-sanitize') {
    k.baslat = ['hdparm', '--yes-i-know-what-i-am-doing', plan.islem === 'blok' ? '--sanitize-block-erase' : '--sanitize-crypto-scramble', y]
    k.durum = ['hdparm', '--sanitize-status', y]
  } else if (plan.tur === 'ata-guvenlik') {
    k.parolaKur = ['hdparm', '--user-master', 'u', '--security-set-pass', PAROLA, y]
    k.baslat = ['hdparm', '--user-master', 'u', plan.gelismis ? '--security-erase-enhanced' : '--security-erase', PAROLA, y]
    k.kaldir = ['hdparm', '--user-master', 'u', '--security-disable', PAROLA, y]
    k.durum = ['hdparm', '-I', y]
  } else if (plan.tur === 'mmc') {
    k.sonra = ['mmc', 'sanitize', y]
  }
  if (plan.hpaKaldir && disk.hpa) k.hpa = ['hdparm', '--yes-i-know-what-i-am-doing', '-N', 'p' + disk.hpa.yerel, y]
  k.luks = disk.luks.map((b) => ['cryptsetup', 'erase', '-q', b])
  return k
}

const UYKU = ['rtcwake', '-m', 'mem', '-s', '5']

// driveStatus en çok 512 bayt; çok baytlı karakter bölünmez
function kisalt (s, sinir = 512) {
  const enc = new TextEncoder()
  if (enc.encode(s).byteLength <= sinir) return s
  let out = ''
  for (const ch of s) {
    if (enc.encode(out + ch + '…').byteLength > sinir) break
    out += ch
  }
  return out + '…'
}

// Sonuç (§13.4 tablosunun son iki sütunu). olcum:
//   hata: komut hata verdi · ornek: { hata } · sanitizeLog: nvme.sanitizeLogCoz · ataSanitize: ata.sanitizeDurumCoz
//   guvenlikSonra: ata.guvenlikCoz · dogrulama: { tamam } · hpaKaldirildi: bool | null · reallocated · notlar: []
function sonucDegerlendir (plan, olcum = {}) {
  const notlar = [...(olcum.notlar || [])]
  let result
  let durum = ''
  if (plan.tur === 'nvme-sanitize') {
    const s = olcum.sanitizeLog
    durum = s ? s.driveStatus : ''
    result = !olcum.hata && s && s.durum === 'basarili' ? 'ok' : 'hata'
  } else if (plan.tur === 'nvme-format') {
    durum = 'format-ses=' + plan.ses
    result = olcum.hata ? 'hata' : 'dogrulanamadi'
  } else if (plan.tur === 'ata-sanitize') {
    const s = olcum.ataSanitize
    durum = s ? s.driveStatus : ''
    result = !olcum.hata && s && s.durum === 'basarili' ? 'ok' : 'hata'
  } else if (plan.tur === 'ata-guvenlik') {
    const g = olcum.guvenlikSonra
    durum = g ? guvenlikOzeti(g) : ''
    result = !olcum.hata && g && !g.etkin && !g.kilitli ? 'ok' : 'hata'
    if (g && g.kilitli) notlar.push('disk kilitli kaldı')
  } else if (plan.method === 'overwrite-verify') {
    const tamam = !olcum.hata && olcum.dogrulama && olcum.dogrulama.tamam
    durum = tamam ? 'overwrite: tam okuma eşleşti' : 'overwrite: doğrulama tutmadı'
    if (!tamam) result = 'hata'
    else {
      const sebep = []
      if (plan.hpaKaldir && olcum.hpaKaldirildi !== true) sebep.push('HPA kaldırılamadı')
      if ((olcum.reallocated || 0) > 0) sebep.push('yeniden atanmış sektör ' + olcum.reallocated)
      if (plan.beklenen === 'dogrulanamadi') sebep.push('DCO gizli alanı var')
      notlar.push(...sebep)
      if (plan.hpaKaldir && olcum.hpaKaldirildi === true) notlar.push('HPA kaldırıldı')
      result = sebep.length ? 'dogrulanamadi' : 'ok'
    }
  } else {
    // clear-unverified: tam üzerine yazma (eMMC'de ardından mmc sanitize)
    durum = plan.tur === 'mmc' ? 'overwrite + mmc sanitize' : 'overwrite'
    if (plan.not) notlar.push(plan.not)
    result = olcum.hata ? 'hata' : 'dogrulanamadi'
  }
  if (olcum.ornek && olcum.ornek.hata) { result = 'hata'; notlar.push('örnek bloklar değişmedi') }
  const driveStatus = kisalt([durum, ...notlar].filter(Boolean).join('; '))
  return { result, driveStatus, uyari: plan.method === 'clear-unverified' ? UYARI_DOGRULANAMADI : null }
}

// Tahmini süre (saniye), ekranda gösterilir. NVMe ve SSD birkaç dakika; HDD'de yazma ve okuma birlikte
// (1 TB ≈ 5–6 saat, yaklaşık 100 MB/s ortalama).
function tahminiSure (plan, boyut) {
  if (['nvme-sanitize', 'nvme-format', 'ata-sanitize', 'ata-guvenlik'].includes(plan.tur)) return 5 * 60
  const hiz = 100e6
  return Math.ceil((boyut / hiz) * (plan.dogrula ? 2 : 1))
}

module.exports = { yontemSec, komutlar, sonucDegerlendir, tahminiSure, kisalt, UYKU, PAROLA, LUKS_BASLIK, UYARI_DOGRULANAMADI }
