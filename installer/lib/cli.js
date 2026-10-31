#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// lib/cli.js — kabuk betiklerinin saf mantığa giriş noktası. Kurulum ortamında USB'deki Node ile, hedefte
// /usr/lib/havenfold/kurulum/node ile çalışır. Komut çalıştırmaz; yalnız verilen dosyaları okur ve stdout'a yazar.
// Sırlar (parolalar) argüman olarak değil, stdin'den ya da dosyadan gelir (argümanlar süreç listesinde görünür).
//
//   on-kontrol    --cpuinfo F --meminfo F --lsblk F --pil 0|1 [--tpm F]      → karar (JSON)
//   host-adi      --dosya F --hex XXXX                                       → yeni autoinstall dosyası
//   depolama      --dosya F --karar F [--parola-dosyasi F]                   → yeni autoinstall dosyası
//   luks-plan     --dump F --clevis F [--pcr7 evet|hayir]                    → plan (JSON)
//   luks-yuvalar  --dump F                                                   → yuva numaraları (boşlukla)
//   kurtarma-kodla                (stdin: 32 bayt)                           → Crockford base32
//   kurtarma-goster               (stdin: kod)                               → 4'lü öbekler
//   kurtarma-duzelt               (stdin: yazılan anahtar)                   → düzeltilmiş kod (satır sonu yok)
//   kurtarma-jetonu --yuva N                                                 → LUKS2 jeton JSON'u
//   pil-adaylari                                                             → aday yollar (satır satır)
//   pil-plani                     (stdin: var olan dosyalar, satır satır)    → plan (JSON)
//   dosya         --ad logind|grub|unattended|sysctl|uyku-hedefleri | --ad nft --kip usb|var-olan
//   dugum-toml    --rol R --kanal K [--pil-sinir S]
//   netplan-wifi  --arayuz A --ssid S (stdin: parola)
//   parola-denetle                (stdin: parola)                            → çıkış 0 ya da hata metni ve 1
//   durum-ozeti   --ram-bayt N --cekirdek S --disk-model S --disk-boyut N --tpm S --sifreleme S [--pil-yuzde N
//                 --pil-sinir S] --ag S                                      → metin
//   rol-sec                       (stdin: giriş)                             → isci | kutu | birlesik, ya da çıkış 1
//   bilgi         --dosya F --alan A                                         → JSON dosyasındaki alan
//   paket-ac      --kok K --bilgi F --usb D                                  → açılan dizin
//   yetki-durumu  --bilgi F [--onceki G]                                     → yetki.durum (var olan korunur)
//   kok-durumu-sec --yeni F [--eski G] --cikti H                             → dönemi düşük olmayan kök durumu
const fs = require('fs')
const path = require('path')

function fail (code) { throw new Error(code) }

function argumanlar (dizi) {
  const a = {}
  for (let i = 0; i < dizi.length; i += 2) {
    if (!dizi[i].startsWith('--') || i + 1 >= dizi.length) fail('INVALID_ARGUMENT')
    a[dizi[i].slice(2)] = dizi[i + 1]
  }
  return a
}

function stdin () { try { return fs.readFileSync(0) } catch { return Buffer.alloc(0) } }
const oku = (f) => fs.readFileSync(f, 'utf8')
const gerekli = (a, ...adlar) => { for (const x of adlar) if (a[x] === undefined) fail('MISSING_ARGUMENT:' + x) }
const yaz = (s) => process.stdout.write(typeof s === 'string' ? s : JSON.stringify(s) + '\n')

function ana ([komut, ...dizi]) {
  const a = argumanlar(dizi)
  const OK = require('./preflight')
  const D = require('./storage')
  const L = require('./luks')
  const P = require('./laptop')
  const I = require('./first-boot')
  switch (komut) {
    case 'on-kontrol':
      gerekli(a, 'cpuinfo', 'meminfo', 'lsblk', 'pil')
      return yaz(OK.karar({ cpuinfo: oku(a.cpuinfo), meminfo: oku(a.meminfo), lsblk: oku(a.lsblk), pil: a.pil === '1', tpmSurum: a.tpm && fs.existsSync(a.tpm) ? oku(a.tpm) : null }))
    case 'host-adi': gerekli(a, 'dosya', 'hex'); return yaz(D.hostAdiYaz(oku(a.dosya), OK.hostAdi(a.hex)))
    case 'depolama': {
      gerekli(a, 'dosya', 'karar')
      const k = JSON.parse(oku(a.karar))
      if (!k.hedef) fail('NO_TARGET')
      const parola = a['parola-dosyasi'] ? oku(a['parola-dosyasi']).trim() : null
      return yaz(D.depolamaEkle(oku(a.dosya), { seri: k.hedef.seri, yol: k.hedef.yol, parola }))
    }
    case 'luks-plan':
      gerekli(a, 'dump', 'clevis')
      return yaz(L.plan({ dump: oku(a.dump), clevis: oku(a.clevis), pcr7Acilir: a.pcr7 === 'evet' ? true : a.pcr7 === 'hayir' ? false : null }))
    case 'luks-yuvalar': gerekli(a, 'dump'); return yaz(L.luksDumpCoz(oku(a.dump)).yuvalar.join(' ') + '\n')
    case 'kurtarma-kodla': return yaz(L.kurtarmaKodla(stdin()))
    case 'kurtarma-goster': return yaz(L.kurtarmaGoster(stdin().toString().trim()) + '\n')
    case 'kurtarma-duzelt': return yaz(L.kurtarmaDuzelt(stdin().toString()))
    case 'kurtarma-jetonu': gerekli(a, 'yuva'); return yaz(L.kurtarmaJetonu(Number(a.yuva)) + '\n')
    case 'pil-adaylari': return yaz(P.PIL_ADAYLARI.join('\n') + '\n')
    case 'pil-plani': return yaz(P.pilPlani(stdin().toString().split('\n')))
    case 'dosya': {
      gerekli(a, 'ad')
      if (a.ad === 'nft') return yaz(P.nftKurallari({ kip: a.kip }))
      const d = { logind: P.LOGIND, grub: P.GRUB, unattended: P.UNATTENDED, sysctl: P.SYSCTL, 'uyku-hedefleri': P.UYKU_HEDEFLERI.join(' ') + '\n' }
      if (!d[a.ad]) fail('NO_FILE')
      return yaz(d[a.ad])
    }
    case 'dugum-toml': return yaz(P.dugumToml({ rol: a.rol, kanal: a.kanal, pil: a['pil-sinir'] ? { limit: a['pil-sinir'] } : null }))
    case 'netplan-wifi': return yaz(I.netplanWifi({ arayuz: a.arayuz, ssid: a.ssid, parola: stdin().toString().replace(/\n$/, '') }))
    case 'parola-denetle': { const h = I.parolaDenetle(stdin().toString().replace(/\n$/, '')); if (h) { yaz(h + '\n'); return 1 } return 0 }
    case 'durum-ozeti': {
      const pil = a['pil-yuzde'] !== undefined ? { yuzde: Number(a['pil-yuzde']), limit: a['pil-sinir'] || 'yok' } : null
      const o = I.durumOzeti({ ramBayt: Number(a['ram-bayt'] || 0), cekirdek: a.cekirdek, disk: a['disk-model'] !== undefined ? { model: a['disk-model'], boyut: Number(a['disk-boyut'] || 0) } : null, tpm: a.tpm, sifreleme: a.sifreleme, pil, ag: a.ag })
      return yaz([...o.satirlar, ...o.uyarilar.map((u) => 'Uyarı: ' + u)].join('\n') + '\n')
    }
    case 'rol-sec': { const r = I.rolSec(stdin().toString()); if (!r) return 1; return yaz(r + '\n') }
    case 'bilgi': {
      gerekli(a, 'dosya', 'alan')
      let v = JSON.parse(oku(a.dosya))
      for (const p of a.alan.split('.')) v = v == null ? undefined : v[p]
      if (v === undefined) fail('NO_FIELD')
      return yaz((typeof v === 'object' ? JSON.stringify(v) : String(v)) + '\n')
    }
    case 'paket-ac': {
      gerekli(a, 'kok', 'bilgi', 'usb')
      const b = JSON.parse(oku(a.bilgi))
      const zip = path.join(a.usb, b.paketAdi)
      return yaz(require('./package').paketAc({ kok: a.kok, surum: b.surum, zipBaytlari: fs.readFileSync(zip), bildirim: fs.readFileSync(path.join(a.usb, 'bildirim.bin')), bildirimOzeti: b.bildirimOzeti }) + '\n')
    }
    case 'yetki-durumu': {
      gerekli(a, 'bilgi')
      const b = JSON.parse(oku(a.bilgi))
      const onceki = a.onceki && fs.existsSync(a.onceki) ? oku(a.onceki) : null
      return yaz(require('./package').yetkiDurumu(b, onceki))
    }
    case 'kok-durumu-sec': {
      gerekli(a, 'yeni', 'cikti')
      const eski = a.eski && fs.existsSync(a.eski) ? fs.readFileSync(a.eski) : null
      fs.writeFileSync(a.cikti, require('./package').kokDurumuSec(fs.readFileSync(a.yeni), eski), { mode: 0o600 })
      return yaz('')
    }
    default: fail('NO_COMMAND')
  }
}

if (require.main === module) {
  try {
    const k = ana(process.argv.slice(2))
    process.exitCode = typeof k === 'number' ? k : 0
  } catch (err) {
    process.stderr.write('hf-cli: ' + err.message + '\n')
    process.exitCode = 2
  }
}

module.exports = { ana, argumanlar }
