// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// erase/ata.js — SATA disklerin `hdparm` çıktılarının ayrıştırılması (RFC-0007 §13.3, §13.4)
//
// Saf: `hdparm -I`, `hdparm -N`, `hdparm --dco-identify`, `hdparm --sanitize-status` metnini alır, komut çalıştırmaz.

const satirlar = (metin) => String(metin || '').split('\n')

// "Security:" bölümü: her satır ya "\t\t<özellik>" (var) ya da "\tnot\t<özellik>" (yok) biçimindedir
function guvenlikCoz (metin) {
  const s = satirlar(metin)
  const bas = s.findIndex((x) => /^Security:\s*$/.test(x.trim()) || /^Security:/.test(x))
  const g = { destek: false, etkin: false, kilitli: false, donmus: false, gelismis: false, sayacBitti: false }
  if (bas < 0) return g
  for (let i = bas + 1; i < s.length; i++) {
    const x = s[i]
    if (/^\S/.test(x)) break // sonraki bölüm (Logical Unit WWN, Checksum …)
    const t = x.trim()
    const yok = /^not\s/.test(t)
    const ad = t.replace(/^not\s+/, '')
    if (/^supported:\s*enhanced erase/.test(ad)) g.gelismis = !yok
    else if (/^supported$/.test(ad)) g.destek = !yok
    else if (/^enabled$/.test(ad)) g.etkin = !yok
    else if (/^locked$/.test(ad)) g.kilitli = !yok
    else if (/^frozen$/.test(ad)) g.donmus = !yok
    else if (/^expired/.test(ad)) g.sayacBitti = !yok
  }
  return g
}

// Komut ve özellik listesi: listede görünen özellik desteklenir ("*" ayrıca etkin demektir). ATA Sanitize burada görünür.
function ozellikVar (metin, ad) {
  return satirlar(metin).some((x) => {
    const m = /^\s*(\*)?\s+(.+?)\s*$/.exec(x)
    return m && m[2] === ad
  })
}

function hdparmCoz (metin) {
  const al = (re) => { const m = re.exec(metin || ''); return m ? m[1].trim() : '' }
  const donus = al(/Nominal Media Rotation Rate:\s*(.+)/)
  const sanitizeVar = ozellikVar(metin, 'SANITIZE feature set')
  return {
    model: al(/Model Number:\s*(.+)/),
    seri: al(/Serial Number:\s*(.+)/),
    ssd: /Solid State Device/i.test(donus),
    donusHizi: /^[0-9]+$/.test(donus) ? Number(donus) : 0,
    guvenlik: guvenlikCoz(metin),
    sanitize: {
      destek: sanitizeVar,
      blok: sanitizeVar && ozellikVar(metin, 'BLOCK_ERASE_EXT command'),
      kripto: sanitizeVar && ozellikVar(metin, 'CRYPTO_SCRAMBLE_EXT command'),
      uzerineYaz: sanitizeVar && ozellikVar(metin, 'OVERWRITE_EXT command')
    }
  }
}

// " max sectors   = 976773168/976773168, HPA is disabled"
function hpaCoz (metin) {
  const m = /max sectors\s*=\s*([0-9]+)\/([0-9]+),\s*HPA is (enabled|disabled)/.exec(metin || '')
  if (!m) return null
  return { gorunen: Number(m[1]), yerel: Number(m[2]), hpa: m[3] === 'enabled' || Number(m[1]) < Number(m[2]) }
}

// DCO, diskin gerçek boyutunu yerel boyuttan küçük gösterebilir. "Real max sectors" yerelden büyükse gizli alan var.
function dcoCoz (metin, yerel) {
  const m = /Real max sectors:\s*([0-9]+)/i.exec(metin || '')
  if (!m) return { var: false, kisitli: false, gercek: 0 }
  const gercek = Number(m[1])
  // hdparm "Real max sectors" değerini son LBA + 1 olarak yazar
  return { var: true, kisitli: Number.isSafeInteger(yerel) && yerel > 0 && gercek > yerel, gercek }
}

// `hdparm --sanitize-status`: "State: SD0 Sanitize Idle" ve "Last Sanitize Operation Completed Without Error"
function sanitizeDurumCoz (metin) {
  const t = String(metin || '')
  const durumSatiri = (/State:\s*(.+)/.exec(t) || [])[1] || ''
  let durum = 'bilinmiyor'
  if (/In Process/i.test(durumSatiri) || /SD2/.test(durumSatiri)) durum = 'suruyor'
  else if (/Completed Without Error/i.test(t)) durum = 'basarili'
  else if (/fail|error/i.test(t)) durum = 'basarisiz'
  const ilerleme = (/Progress:\s*0x[0-9a-f]+\s*\(([0-9]+)%\)/i.exec(t) || [])[1]
  return { durum, ilerleme: ilerleme === undefined ? null : Number(ilerleme), driveStatus: t.replace(/\s+/g, ' ').trim() }
}

// Güvenlik durumunun kısa metni (driveStatus için): "security: not enabled, not locked"
function guvenlikOzeti (g) {
  return `security: ${g.etkin ? 'enabled' : 'not enabled'}, ${g.kilitli ? 'locked' : 'not locked'}${g.donmus ? ', frozen' : ''}`
}

module.exports = { hdparmCoz, guvenlikCoz, hpaCoz, dcoCoz, sanitizeDurumCoz, guvenlikOzeti }
