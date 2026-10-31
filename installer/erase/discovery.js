// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// erase/discovery.js — silme ortamında disk keşfi (RFC-0007 §13.3)
//
// Saf: `lsblk -J -b -o …` çıktısını ve diske özgü yetenek çıktılarını (nvme id-ctrl, hdparm) birleştirir. Komut
// çalıştırmaz; komutları kabuk (shell.js) çalıştırır, testler sahte çıktı verir.
//
// Dışlananlar: loop, ram, zram, sr, nbd, md, dm, eMMC'nin boot ve rpmb bölümleri ve silme ortamının açıldığı USB.
// Açılış aygıtı, kendisi ya da bir bölümü ISO 9660 dosya sistemi taşıyan ya da canlı ortamın bağlama noktalarında
// bağlı olan disktir (Kurulum USB'si melez ISO'dur: diskin kendisi iso9660 görünür).
const NVME = require('./nvme')
const ATA = require('./ata')

function fail (code) { throw new Error(code) }

// lsblk sütunları (util-linux 2.39). Kabuk bu listeyle çağırır: lsblk -J -b -o <SUTUNLAR>
const SUTUNLAR = ['NAME', 'PATH', 'TYPE', 'SIZE', 'ROTA', 'RM', 'HOTPLUG', 'TRAN', 'MODEL', 'SERIAL', 'FSTYPE', 'LABEL', 'PARTTYPE', 'MOUNTPOINTS']
const ESP_TURU = 'c12a7328-f81f-11d2-ba4b-00a0c93ec93b'
const CANLI_BAGLAMA = ['/cdrom', '/run/live/medium', '/run/initramfs/live', '/media/cdrom', '/isodevice']
const DISLA_AD = /^(loop|ram|zram|sr|nbd|md|dm-|fd)/
const MMC_EK = /^mmcblk[0-9]+(boot[0-9]+|rpmb)$/

// Eski lsblk sürümleri "0"/"1" dizgesi, yenileri true/false verir
const bool = (x) => x === true || x === 1 || x === '1' || x === 'true'
const metin = (x) => (x == null ? '' : String(x).trim())
const boyut = (x) => {
  const n = typeof x === 'string' ? Number(x) : x
  return Number.isSafeInteger(n) && n >= 0 ? n : 0
}

function dugum (d) {
  const mp = Array.isArray(d.mountpoints) ? d.mountpoints : d.mountpoint !== undefined ? [d.mountpoint] : []
  return {
    ad: metin(d.name),
    yol: metin(d.path) || '/dev/' + metin(d.name),
    tur: metin(d.type),
    boyut: boyut(d.size),
    donen: bool(d.rota),
    cikarilabilir: bool(d.rm),
    hotplug: bool(d.hotplug),
    tasima: metin(d.tran).toLowerCase(),
    model: metin(d.model),
    seri: metin(d.serial),
    fstype: metin(d.fstype).toLowerCase(),
    etiket: metin(d.label),
    bolumTuru: metin(d.parttype).toLowerCase(),
    baglama: mp.filter((x) => typeof x === 'string' && x),
    cocuklar: (d.children || []).map(dugum)
  }
}

function lsblkCoz (girdi) {
  let j = girdi
  if (typeof girdi === 'string') {
    try { j = JSON.parse(girdi) } catch { fail('INVALID_LSBLK') }
  }
  if (!j || !Array.isArray(j.blockdevices)) fail('INVALID_LSBLK')
  return j.blockdevices.map(dugum)
}

function* agac (d) { yield d; for (const x of d.cocuklar) yield * agac(x) }

function acilisAygitiMi (d) {
  for (const x of agac(d)) {
    if (x.fstype === 'iso9660') return true
    if (x.baglama.some((m) => CANLI_BAGLAMA.some((c) => m === c || m.startsWith(c + '/')))) return true
  }
  return false
}

function veriYolu (d) {
  if (d.ad.startsWith('nvme') || d.tasima === 'nvme') return 'nvme'
  if (d.tasima === 'usb') return 'usb'
  if (d.ad.startsWith('mmcblk') || d.tasima === 'mmc') return 'mmc'
  if (['sata', 'ata', 'ahci'].includes(d.tasima)) return 'sata'
  return 'diger' // virtio, sas, iscsi …: ATA ve NVMe komutları yok
}

function dislanirMi (d) {
  return d.tur !== 'disk' || DISLA_AD.test(d.ad) || MMC_EK.test(d.ad) || d.boyut === 0
}

// Diskin bölümleri (ve kendisi) arasında LUKS başlığı olanlar: luks[yol] = true (cryptsetup isLuks sonucu) ya da
// lsblk fstype 'crypto_luks'
function luksBolumleri (d, luks = {}) {
  const out = []
  for (const x of agac(d)) {
    if (x.tur !== 'disk' && x.tur !== 'part') continue
    if (luks[x.yol] === true || (luks[x.yol] === undefined && x.fstype === 'crypto_luks')) out.push(x.yol)
  }
  return out
}

// Keşif: lsblk ağacı + yetenek çıktıları → silinebilecek diskler. ek: { nvme: { yol: id-ctrl json },
// hdparm: { yol: hdparm -I metni }, hpa: { yol: hdparm -N metni }, dco: { yol: --dco-identify metni }, luks: { yol: bool } }
// İç diskler seçili gelir; USB, çıkarılabilir ve hotplug diskler listelenir ama seçili değildir (§13.3).
function diskleriBul (lsblk, ek = {}) {
  const kok = Array.isArray(lsblk) ? lsblk : lsblkCoz(lsblk)
  const out = []
  for (const d of kok) {
    if (dislanirMi(d) || acilisAygitiMi(d)) continue
    const yolTuru = veriYolu(d)
    const harici = yolTuru === 'usb' || d.cikarilabilir || d.hotplug
    const disk = {
      ad: d.ad,
      yol: d.yol,
      boyut: d.boyut,
      veriYolu: yolTuru,
      donen: d.donen,
      cikarilabilir: d.cikarilabilir,
      harici,
      model: d.model,
      seri: d.seri,
      luks: luksBolumleri(d, ek.luks || {}),
      nvme: null,
      ata: null,
      hpa: null,
      dco: null,
      secili: !harici
    }
    if (yolTuru === 'nvme' && ek.nvme && ek.nvme[d.yol] !== undefined) {
      disk.nvme = NVME.idCtrlCoz(ek.nvme[d.yol])
      disk.model = disk.model || disk.nvme.model
      disk.seri = disk.seri || disk.nvme.seri
    }
    if (ek.hdparm && ek.hdparm[d.yol] !== undefined) {
      disk.ata = ATA.hdparmCoz(ek.hdparm[d.yol])
      disk.model = disk.model || disk.ata.model
      disk.seri = disk.seri || disk.ata.seri
      if (disk.ata.ssd) disk.donen = false
    }
    if (ek.hpa && ek.hpa[d.yol] !== undefined) disk.hpa = ATA.hpaCoz(ek.hpa[d.yol])
    if (ek.dco && ek.dco[d.yol] !== undefined) disk.dco = ATA.dcoCoz(ek.dco[d.yol], disk.hpa ? disk.hpa.yerel : 0)
    out.push(disk)
  }
  return out
}

// ESP bölümleri: bölüm türü EFI System ya da (MBR'de) vfat + "EFI" etiketi. Bilet yalnız bunlarda aranır (§13.2 adım 2)
function espBolumleri (lsblk) {
  const kok = Array.isArray(lsblk) ? lsblk : lsblkCoz(lsblk)
  const out = []
  for (const d of kok) {
    if (acilisAygitiMi(d)) continue
    for (const x of agac(d)) {
      if (x.tur !== 'part') continue
      if (x.bolumTuru === ESP_TURU || x.bolumTuru === '0xef' || (x.fstype === 'vfat' && /^EFI/i.test(x.etiket))) out.push(x.yol)
    }
  }
  return out
}

const GB = 1e9
function boyutMetni (n) {
  if (n >= 1e12) return (n / 1e12).toFixed(1).replace(/\.0$/, '') + ' TB'
  return Math.round(n / GB) + ' GB'
}

// Ekran tablosu satırı: yol, veri yolu, boyut, model, seri son 4 hane, seçili mi
function tabloSatiri (d) {
  const tur = d.veriYolu === 'nvme' ? 'NVMe' : d.veriYolu === 'sata' ? (d.donen ? 'SATA HDD' : 'SATA SSD') : d.veriYolu === 'usb' ? 'USB' : d.veriYolu === 'mmc' ? 'eMMC/SD' : (d.donen ? 'HDD' : 'disk')
  const seri = d.seri ? '…' + d.seri.slice(-4) : '—'
  return `${d.secili ? '[x]' : '[ ]'} ${d.yol}  ${tur}  ${boyutMetni(d.boyut)}  ${d.model || '—'}  ${seri}${d.harici ? '  (harici)' : ''}`
}

module.exports = { SUTUNLAR, ESP_TURU, lsblkCoz, diskleriBul, espBolumleri, acilisAygitiMi, veriYolu, tabloSatiri, boyutMetni, bool }
