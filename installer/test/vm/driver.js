#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// driver.js — YALNIZ CI: Kurulum USB'sini sanal makinede (QEMU + OVMF Güvenli Önyükleme + swtpm TPM 2.0) koşturur.
//
//   node installer/test/vm/driver.js --kip kur|ilk|sil --is <dizin> [--iso test.iso] [--dakika N] [--kvm 1|0]
//
//   kur  USB'den (test ISO'su, varsayılan girdi "kur") açılır; ttyS1'deki hf-on-kontrol sorularına "SIL" (TPM
//        denemesi tutmazsa "TAMAM") yazılır. Kurulum bitip makine yeniden başlamak isteyince QEMU çıkar (-no-reboot).
//   ilk  USB'siz, diskten açılır. İlk açılış ekranı ttyS1'dedir (test drop-in'i): yönetici parolası (HF_TEST_PAROLA,
//        iş akışında üretilir, günlüğe yazılmaz), rol 1 (işçi). hf-test-denetim sonuçları ttyS0'a yazar, bir kez
//        yeniden başlatır, sonra kapatır.
//   sil  İki disk (NVMe + SATA) ve USB (varsayılan girdi "sil"). Ekran görüntüsünden (QMP screendump) QR'lar zbarimg
//        ile, yazılar tesseract ile okunur; tuşlar QMP send-key ile basılır: anahtar QR'ı → Enter, "SIL", rapor
//        parçaları toplanınca Enter, "1" (kapat). QR metinleri <is>/qr-sil.json'a yazılır.
//
// <is> dizininde: vars.fd (OVMF değişkenleri), tpm/ (swtpm durumu), diskler; çıktı: seri0-<kip>.log (ttyS0),
// seri1-<kip>.log (ttyS1, parola maskeli), surucu-<kip>.log, qemu-<kip>.log, swtpm-<kip>.log, ekran-<kip>-*.png.
// Çıkış: 0 QEMU kendiliğinden kapandı, 2 zaman aşımı, 1 hata.
const fs = require('fs')
const net = require('net')
const path = require('path')
const { spawn, spawnSync } = require('child_process')
const { StringDecoder } = require('string_decoder')

const OVMF_KOD = '/usr/share/OVMF/OVMF_CODE_4M.secboot.fd'

function argumanlar () {
  const a = { dakika: 60, kvm: '1' }
  const v = process.argv.slice(2)
  for (let i = 0; i < v.length; i += 2) a[v[i].replace(/^--/, '')] = v[i + 1]
  if (!['kur', 'ilk', 'sil'].includes(a.kip) || !a.is) throw new Error('kullanım: --kip kur|ilk|sil --is <dizin>')
  return a
}

const A = argumanlar()
const IS = path.resolve(A.is)
const PAROLA = process.env.HF_TEST_PAROLA || ''
const bekle = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const zaman = () => new Date().toISOString().slice(11, 19)
const maskele = (s) => (PAROLA ? s.split(PAROLA).join('***') : s)
const gunluk = fs.createWriteStream(path.join(IS, `surucu-${A.kip}.log`))
function yaz (s) { const satir = `[${zaman()}] ${maskele(s)}`; console.log(satir); gunluk.write(satir + '\n') }

// --- Süreçler ---------------------------------------------------------------------------------------------------

function swtpmBaslat () {
  const d = path.join(IS, 'tpm')
  fs.mkdirSync(d, { recursive: true })
  const sok = path.join(d, 'swtpm.sock')
  try { fs.unlinkSync(sok) } catch {}
  const p = spawn('swtpm', ['socket', '--tpm2', '--tpmstate', 'dir=' + d, '--ctrl', 'type=unixio,path=' + sok,
    '--log', `level=1,file=${path.join(IS, `swtpm-${A.kip}.log`)}`], { stdio: 'ignore' })
  return { p, sok }
}

function qemuArgumanlari (tpmSok) {
  const kvm = A.kvm === '1'
  const q = [
    '-name', 'hf-' + A.kip,
    '-machine', `q35,smm=on,accel=${kvm ? 'kvm' : 'tcg'}`,
    '-cpu', kvm ? 'host' : 'max',
    '-smp', '2', '-m', '4096',
    '-global', 'driver=cfi.pflash01,property=secure,value=on',
    '-drive', `if=pflash,format=raw,unit=0,readonly=on,file=${OVMF_KOD}`,
    '-drive', `if=pflash,format=raw,unit=1,file=${path.join(IS, 'vars.fd')}`,
    '-chardev', `socket,id=chrtpm,path=${tpmSok}`, '-tpmdev', 'emulator,id=tpm0,chardev=chrtpm', '-device', 'tpm-tis,tpmdev=tpm0',
    '-device', 'qemu-xhci,id=xhci',
    '-nic', 'user,model=virtio-net-pci',
    '-vga', 'std', '-display', 'none',
    '-serial', 'file:' + path.join(IS, `seri0-${A.kip}.log`),
    '-chardev', `socket,id=seri1,path=${path.join(IS, 'seri1.sock')},server=on,wait=off`, '-serial', 'chardev:seri1',
    '-qmp', `unix:${path.join(IS, 'qmp.sock')},server=on,wait=off`
  ]
  if (A.kip === 'kur' || A.kip === 'sil') {
    if (!A.iso) throw new Error('--iso gerekli')
    q.push('-drive', `if=none,id=usb,format=raw,readonly=on,file=${path.resolve(A.iso)}`,
      '-device', 'usb-storage,bus=xhci.0,drive=usb,bootindex=1')
  }
  if (A.kip === 'kur' || A.kip === 'ilk') {
    q.push('-drive', `if=none,id=nvme0,format=qcow2,file=${path.join(IS, 'disk.qcow2')}`,
      '-device', 'nvme,serial=HFTEST0001,drive=nvme0,bootindex=2')
  }
  if (A.kip === 'sil') {
    q.push('-drive', `if=none,id=nvme0,format=raw,file=${path.join(IS, 'sil-nvme.img')}`, '-device', 'nvme,serial=HFSIL0001,drive=nvme0',
      '-device', 'ich9-ahci,id=ahci',
      '-drive', `if=none,id=sata0,format=raw,file=${path.join(IS, 'sil-sata.img')}`, '-device', 'ide-hd,bus=ahci.0,drive=sata0,serial=HFSIL0002,model=HF Test SATA')
  }
  if (A.kip === 'kur') q.push('-no-reboot')
  return q
}

async function baglan (yol, deneme = 100) {
  for (let i = 0; i < deneme; i++) {
    try {
      return await new Promise((resolve, reject) => {
        const s = net.connect(yol)
        s.once('connect', () => resolve(s))
        s.once('error', reject)
      })
    } catch { await bekle(200) }
  }
  throw new Error('bağlanılamadı: ' + yol)
}

// --- QMP ----------------------------------------------------------------------------------------------------------

class Qmp {
  constructor (s) {
    this.s = s
    this.bekleyen = []
    this.tampon = ''
    this.hazir = new Promise((resolve) => { this.hazirOl = resolve })
    s.on('data', (d) => {
      this.tampon += d.toString()
      let i
      while ((i = this.tampon.indexOf('\n')) >= 0) {
        const satir = this.tampon.slice(0, i).trim()
        this.tampon = this.tampon.slice(i + 1)
        if (!satir) continue
        let m
        try { m = JSON.parse(satir) } catch { continue }
        if (m.QMP) { this.hazirOl(); continue }
        if (m.event) { if (!['RTC_CHANGE'].includes(m.event)) yaz('QMP olay: ' + m.event + (m.data ? ' ' + JSON.stringify(m.data) : '')); continue }
        const b = this.bekleyen.shift()
        if (b) b(m)
      }
    })
    s.on('error', () => {})
  }

  komut (execute, args) {
    return new Promise((resolve) => {
      this.bekleyen.push(resolve)
      this.s.write(JSON.stringify(args ? { execute, arguments: args } : { execute }) + '\n')
      setTimeout(() => resolve({ error: { desc: 'QMP zaman aşımı' } }), 30000)
    })
  }
}

let qmp = null
let ekranNo = 0

async function ekran (ad) {
  if (!qmp) return null
  const dosya = path.join(IS, `ekran-${A.kip}-${ad}.png`)
  const r = await qmp.komut('screendump', { filename: dosya, format: 'png' })
  if (r.error) { yaz('screendump: ' + r.error.desc); return null }
  return dosya
}

const QCODE = { ' ': 'spc', '\r': 'ret', '-': 'minus', '.': 'dot', '/': 'slash' }
async function tuslar (metin) {
  for (const ch of metin) {
    let keys
    if (/[a-z0-9]/.test(ch)) keys = [ch]
    else if (/[A-Z]/.test(ch)) keys = ['shift', ch.toLowerCase()]
    else if (QCODE[ch]) keys = [QCODE[ch]]
    else throw new Error('tuş yok: ' + ch)
    await qmp.komut('send-key', { keys: keys.map((k) => ({ type: 'qcode', data: k })) })
    await bekle(120)
  }
}

function qrOku (png) {
  const r = spawnSync('zbarimg', ['--raw', '-q', '-Sdisable', '-Sqrcode.enable', png], { encoding: 'utf8', timeout: 20000 })
  return r.status === 0 ? r.stdout.split('\n').map((x) => x.replace(/\r$/, '')).filter(Boolean) : []
}

function yaziOku (png) {
  const ters = png.replace(/\.png$/, '-ocr.png')
  spawnSync('convert', [png, '-negate', '-scale', '200%', ters], { timeout: 20000 })
  const r = spawnSync('tesseract', [ters, '-', '--psm', '6'], { encoding: 'utf8', timeout: 30000 })
  try { fs.unlinkSync(ters) } catch {}
  return r.status === 0 ? r.stdout : ''
}

// --- ttyS1 (kur, ilk) -------------------------------------------------------------------------------------------

function seri1Isle (s, kurallar) {
  const kayit = fs.createWriteStream(path.join(IS, `seri1-${A.kip}.log`))
  const dec = new StringDecoder('utf8')
  let tampon = ''
  let mesgul = false
  s.on('data', async (d) => {
    const m = dec.write(d)
    kayit.write(maskele(m))
    tampon = (tampon + m).slice(-4000)
    if (mesgul) return
    const temiz = tampon.replace(/\r/g, '')
    for (const k of kurallar) {
      if (!k.desen.test(temiz)) continue
      mesgul = true
      tampon = ''
      yaz('ttyS1: ' + k.ad)
      if (k.not) notlar.push(k.not)
      await bekle(k.bekle || 1500) // `read -s` yankıyı kapatmadan yazılmasın
      if (k.yanit !== null) s.write(k.yanit + '\r')
      if (k.bitir) kurulumBitti(k.ad)
      mesgul = false
      break
    }
  })
  s.on('error', () => {})
}

const notlar = []
let kurulumBitti = () => {}

const KURALLAR = {
  kur: [
    { ad: 'onay sorusu → SIL', desen: /SIL yazın\.\s*\n> ?$/, yanit: 'SIL' },
    { ad: 'TPM yok sorusu → TAMAM', desen: /TAMAM yazın\.\s*\n> ?$/, yanit: 'TAMAM', not: 'tpm-yok' },
    { ad: 'pil sorusu → H', desen: /\(E\/H\) $/, yanit: 'H', not: 'pil-soruldu' },
    // error-commands çalıştı: kurulum durdu, QEMU'yu beklemeden kapat (subiquity hata ekranında sonsuza dek bekler)
    { ad: 'kurulum hata verdi (error-commands) → QEMU kapatılıyor', desen: /\[hf-test\] çıkış [0-9]+: \/cdrom\/hf-test\/hata-gunlugu/, yanit: null, bitir: true, bekle: 5000, not: 'kurulum-hatasi' }
  ],
  ilk: [
    { ad: 'yönetici parolası', desen: /\nParola: $/, yanit: PAROLA },
    { ad: 'parola yeniden', desen: /\nYeniden: $/, yanit: PAROLA },
    { ad: 'rol → 1 (işçi)', desen: /Seçim: $/, yanit: '1' },
    { ad: 'Wi-Fi soruldu (kablolu ağ görülmedi)', desen: /Ağ adı \(SSID\): $/, yanit: null, not: 'wifi-soruldu' }
  ]
}

// --- Silme ekranı -----------------------------------------------------------------------------------------------

async function silmeSur (bitti) {
  const qr = { hfk1: null, hfw1: {}, toplam: null, ekranlar: [] }
  let durum = 'hfk1'
  let t0 = Date.now()
  let sonOcr = 0
  let sonEh = 0
  const kaydet = () => fs.writeFileSync(path.join(IS, 'qr-sil.json'), JSON.stringify({ hfk1: qr.hfk1, hfw1: Object.values(qr.hfw1) }, null, 1))
  kaydet()
  while (!bitti()) {
    await bekle(2500)
    const png = await ekran('anlik')
    if (!png) continue
    const okunan = qrOku(png)
    for (const t of okunan) {
      if (t.startsWith('HFK1:') && !qr.hfk1) { qr.hfk1 = t; yaz('QR: HFK1 okundu (' + t.length + ' karakter)'); kaydet() }
      const m = /^HFW1:([0-9]+)\/([0-9]+):/.exec(t)
      if (m && !qr.hfw1[m[1]]) { qr.hfw1[m[1]] = t; qr.toplam = Number(m[2]); yaz(`QR: HFW1 ${m[1]}/${m[2]}`); kaydet() }
    }
    const simdi = Date.now()
    let metin = null
    const ocr = () => { if (metin === null) metin = yaziOku(png); return metin }
    if (simdi - sonOcr > 30000) {
      sonOcr = simdi
      const satirlar = ocr().split('\n').filter((x) => x.trim()).slice(-6)
      yaz(`ekran [${durum}]: ` + satirlar.join(' ⏎ '))
      fs.copyFileSync(png, path.join(IS, `ekran-sil-${String(++ekranNo).padStart(2, '0')}.png`))
    }
    if (durum === 'hfk1') {
      if (qr.hfk1) { fs.copyFileSync(png, path.join(IS, 'ekran-sil-hfk1.png')); await bekle(1000); await tuslar('\r'); durum = 'sil'; t0 = Date.now(); yaz('tuş: Enter (anahtar QR\'ı okundu)'); continue }
      // Harici disk sorusu yalnız anahtar QR'ından önce gelir; uzun süre QR yoksa ekrana bakılır
      if (simdi - t0 > 60000 && simdi - sonEh > 20000) {
        sonEh = simdi
        if (/\(E\s*\/\s*H\)/.test(ocr())) { yaz('ekran: harici disk sorusu → H'); await tuslar('H\r') }
      }
    } else if (durum === 'sil') {
      if (/SIL\s+yaz/i.test(ocr()) || Date.now() - t0 > 10000) { await tuslar('SIL\r'); durum = 'rapor'; t0 = Date.now(); yaz('tuş: SIL Enter') }
    } else if (durum === 'rapor') {
      if (qr.toplam && Object.keys(qr.hfw1).length === qr.toplam) {
        fs.copyFileSync(png, path.join(IS, 'ekran-sil-hfw1.png'))
        await tuslar('\r'); durum = 'secim'; t0 = Date.now(); yaz('tuş: Enter (bütün rapor parçaları okundu)')
      }
    } else if (durum === 'secim') {
      if (/Kapat/i.test(ocr()) || Date.now() - t0 > 8000) { await tuslar('1\r'); durum = 'kapanis'; t0 = Date.now(); yaz('tuş: 1 Enter (kapat)') }
    } else if (durum === 'kapanis' && Date.now() - t0 > 20000) {
      // casper kapanışta "kurulum ortamını çıkarın, Enter'a basın" diyebilir
      t0 = Date.now(); yaz('ekran: kapanış bekleniyor → Enter'); await tuslar('\r')
    }
  }
  return qr
}

// --- Ana akış ---------------------------------------------------------------------------------------------------

async function ana () {
  const tpm = swtpmBaslat()
  for (let i = 0; i < 50 && !fs.existsSync(tpm.sok); i++) await bekle(100)
  const args = qemuArgumanlari(tpm.sok)
  yaz('qemu-system-x86_64 ' + args.join(' '))
  const qlog = fs.openSync(path.join(IS, `qemu-${A.kip}.log`), 'w')
  const q = spawn('qemu-system-x86_64', args, { stdio: ['ignore', qlog, qlog] })
  let cikis = null
  const bitis = new Promise((resolve) => q.on('exit', (kod, sinyal) => { cikis = { kod, sinyal }; resolve() }))
  qmp = new Qmp(await baglan(path.join(IS, 'qmp.sock')))
  await qmp.hazir
  await qmp.komut('qmp_capabilities')
  yaz('QEMU başladı, QMP hazır')
  if (KURALLAR[A.kip]) seri1Isle(await baglan(path.join(IS, 'seri1.sock')), KURALLAR[A.kip])

  let sinir = Date.now() + Number(A.dakika) * 60000
  let erken = false
  kurulumBitti = (ad) => { yaz('erken bitiş: ' + ad); erken = true; sinir = Date.now() }
  const periyodik = setInterval(async () => {
    if (cikis) return
    const png = await ekran('son')
    if (png && ++ekranNo % 5 === 0) fs.copyFileSync(png, path.join(IS, `ekran-${A.kip}-${String(ekranNo).padStart(3, '0')}.png`))
  }, A.kip === 'sil' ? 3600000 : 120000)

  let silme = null
  if (A.kip === 'sil') silme = silmeSur(() => cikis !== null || Date.now() > sinir)
  const zamanAsimi = new Promise((resolve) => {
    const t = setInterval(() => { if (cikis || Date.now() > sinir) { clearInterval(t); resolve() } }, 1000)
  })
  await Promise.race([bitis, zamanAsimi])
  clearInterval(periyodik)
  let kod = 0
  if (!cikis) {
    yaz(erken ? 'Kurulum hata verdi: ekran görüntüsü alınıp QEMU kapatılıyor' : `ZAMAN AŞIMI (${A.dakika} dk): ekran görüntüsü alınıp QEMU kapatılıyor`)
    await ekran('zamanasimi')
    await qmp.komut('quit')
    await Promise.race([bitis, bekle(15000)])
    if (!cikis) q.kill('SIGKILL')
    kod = 2
  } else {
    yaz(`QEMU çıktı: kod ${cikis.kod}${cikis.sinyal ? ' sinyal ' + cikis.sinyal : ''}`)
  }
  if (silme) {
    const qr = await silme
    yaz(`silme QR'ları: HFK1 ${qr.hfk1 ? 'var' : 'YOK'}, HFW1 ${Object.keys(qr.hfw1).length}/${qr.toplam ?? '?'}`)
  }
  if (notlar.length) yaz('notlar: ' + notlar.join(', '))
  fs.writeFileSync(path.join(IS, `sonuc-${A.kip}.json`), JSON.stringify({ kip: A.kip, kod, notlar, cikis }) + '\n')
  try { tpm.p.kill() } catch {}
  return kod
}

ana().then((k) => { gunluk.end(); process.exitCode = k }, (err) => { yaz('HATA: ' + err.stack); gunluk.end(); process.exitCode = 1 })
