#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// export-open — Havenfold dışa aktarma kabını açar ve içindeki arşivi bir klasöre çıkarır (RFC-0014 §8).
//
//   export-open <dosya> [hedef-klasör]      parolayı sorar (terminalde gizli), arşivi çıkarır
//   export-open --header <dosya>            yalnız başlığı gösterir (parola gerekmez; eski adı --baslik)
// Terminal değilse parola standart girdinin ilk satırından okunur. Parola hiçbir yere yazılmaz.
// Kap akışla çözülür ve düz ZIP hedef klasörde geçici bir dosyaya (0600) yazılır; girdiler oradan çıkarılır, geçici
// dosya silinir. Klasörler 0700, dosyalar 0600 ve yalnız yeni dosya olarak (wx) yazılır.
const fs = require('fs')
const path = require('path')
const { baslikCoz, acAkis, zipOkuDosya } = require('./open')

const IYI = {
  INVALID_EXPORT: 'Bu bir Havenfold kabı değil ya da dosya bozuk.',
  EXPORT_VERSION: 'Kabın sürümü bu araçtan yeni. Aracı güncelleyin.',
  EXPORT_PARAMETER: 'Kabın şifreleme ayarları izin verilen aralıkta değil; dosya açılmaz.',
  EXPORT_UNVERIFIED: 'Parola yanlış ya da dosya değiştirilmiş.',
  EXPORT_CORRUPT: 'Dosyanın bir bölümü bozuk ya da değiştirilmiş.',
  EXPORT_TRUNCATED: 'Dosya eksik: sonu kesilmiş.',
  EXPORT_EXCESS: 'Dosyanın sonuna fazladan veri eklenmiş; dosya açılmaz.',
  EXPORT_MEMORY: 'Bu kabı açmak için yeterli bellek yok.',
  INVALID_ZIP: 'Kabın içindeki arşiv bozuk.',
  INVALID_ZIP_NAME: 'Arşivde güvensiz ya da tekrar eden bir dosya adı var; açılmaz.',
  ZIP_ENCRYPTED: 'Arşivde şifreli girdi var; Havenfold arşivi değil.',
  ZIP_COMPRESSION: 'Arşivde desteklenmeyen sıkıştırma var.',
  ZIP_CHECKSUM: 'Arşivdeki bir dosyanın sağlaması tutmuyor.',
  ZIP_TOO_LARGE: 'Arşiv bu sürümün sınırından (2 GiB) büyük.',
  TARGET_EXISTS: 'Hedef zaten var; export-open yeni bir klasör oluşturur.'
}

// Ham terminal girdisi: karakterler kod noktası olarak; silme son kod noktasını siler (iki birimlik karakterler
// bozulmaz). Dönüş satırı biter; satır sonu parolaya eklenmez.
function parolaIsle (p, parca) {
  for (const ch of parca) {
    if (ch === '\r' || ch === '\n' || ch === '\u0004') return { p, bitti: true }
    if (ch === '\u0003') return { p, iptal: true }
    if (ch === '\u007f' || ch === '\b') p = Array.from(p).slice(0, -1).join('')
    else if (ch >= ' ') p += ch
  }
  return { p, bitti: false }
}

// Terminal değilse ilk satır; satır sonu (\r\n ya da \n) atılır
const ilkSatir = (veri) => veri.split(/\r?\n/)[0].replace(/\r$/, '')

function parolaSor (soru) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      let veri = ''
      process.stdin.setEncoding('utf8')
      process.stdin.on('data', (d) => { veri += d })
      process.stdin.on('end', () => resolve(ilkSatir(veri)))
      return
    }
    process.stderr.write(soru)
    const stdin = process.stdin
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    let p = ''
    const dinle = (d) => {
      const r = parolaIsle(p, d)
      p = r.p
      if (r.iptal) { process.stderr.write('\n'); process.exit(130) }
      if (r.bitti) { stdin.setRawMode(false); stdin.pause(); stdin.removeListener('data', dinle); process.stderr.write('\n'); resolve(p) }
    }
    stdin.on('data', dinle)
  })
}

function baslikOkuDosya (dosya) {
  const fd = fs.openSync(dosya, 'r')
  try {
    const b = Buffer.alloc(10 + 4096)
    const n = fs.readSync(fd, b, 0, b.length, 0)
    return baslikCoz(b.subarray(0, n)).baslik
  } finally { fs.closeSync(fd) }
}

// Kabı hedef klasöre çıkarır (akışla). Hedef yoktur ve export-open onu kendisi oluşturur (inceleme 6 Y4): girdiler önce
// hedefin yanında yeni bir geçici klasöre çıkarılır, bütün arşiv doğrulanınca yeniden adlandırılır; hatada geçici
// klasör silinir, yarım çıktı kalmaz (Y2). Her üst klasörün gerçek yolu geçici klasörün içinde kalmalı.
function cikar (dosya, hedef, parola) {
  const kok = path.resolve(hedef)
  if (fs.existsSync(kok)) throw new Error('TARGET_EXISTS')
  const gecici = fs.mkdtempSync(path.join(path.dirname(kok), '.export-open-'))
  fs.chmodSync(gecici, 0o700)
  const zipYol = path.join(gecici, '.arsiv.zip')
  const giris = fs.openSync(dosya, 'r')
  let cikis = fs.openSync(zipYol, 'wx', 0o600)
  let h
  try {
    let off = 0
    h = acAkis((n) => { const b = Buffer.alloc(n); const r = fs.readSync(giris, b, 0, n, off); off += r; return b.subarray(0, r) }, (m) => fs.writeSync(cikis, m), parola).baslik
    fs.closeSync(cikis)
    cikis = null
    const icerik = path.join(gecici, 'icerik')
    fs.mkdirSync(icerik, { mode: 0o700 })
    const gercekKok = fs.realpathSync(icerik)
    const zfd = fs.openSync(zipYol, 'r')
    try {
      zipOkuDosya(zfd, (g) => {
        const yol = path.resolve(icerik, g.ad)
        if (!yol.startsWith(icerik + path.sep)) throw new Error('INVALID_ZIP_NAME')
        fs.mkdirSync(path.dirname(yol), { recursive: true, mode: 0o700 })
        const ust = fs.realpathSync(path.dirname(yol)) // sembolik bağ izlenmez
        if (ust !== gercekKok && !ust.startsWith(gercekKok + path.sep)) throw new Error('INVALID_ZIP_NAME')
        const fd = fs.openSync(yol, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600)
        try { fs.writeSync(fd, g.bytes) } finally { fs.closeSync(fd) }
      })
    } finally { fs.closeSync(zfd) }
    fs.unlinkSync(zipYol)
    fs.renameSync(icerik, kok)
  } finally {
    fs.closeSync(giris)
    if (cikis !== null) try { fs.closeSync(cikis) } catch {}
    fs.rmSync(gecici, { recursive: true, force: true })
  }
  return h
}

// Başlıktaki metin terminale yazılmadan önce denetim karakterleri (ANSI kaçış dizisi, C1 dahil) ve yön karakterleri atılır
const temiz = (x) => String(x).replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')

async function ana (argv, { parola = null } = {}) {
  // --header; --baslik eski ad (Codex 12. tur: --header verilince dosya adı sanılıp 'Kullanım' basılıyordu)
  if ((argv[0] === '--header' || argv[0] === '--baslik') && argv[1]) {
    // Başlık doğrulanmamıştır; JSON C1 ve yön karakterlerini kaçışlamaz, dizgiler temizlenir (Codex 12. tur)
    console.log(JSON.stringify(baslikOkuDosya(argv[1]), (k, v) => (typeof v === 'string' ? temiz(v) : v), 2))
    return 0
  }
  const [dosya, hedefArg] = argv
  if (!dosya || dosya.startsWith('-')) {
    console.error('Kullanım: export-open <dosya> [hedef-klasör]  |  export-open --header <dosya>')
    return 2
  }
  baslikOkuDosya(dosya)
  const hedef = hedefArg || dosya.replace(/\.[^./]+$/, '') + '-acik'
  if (fs.existsSync(hedef)) {
    console.error('Hedef zaten var; export-open yeni bir klasör oluşturur: ' + hedef)
    return 2
  }
  const p = parola === null ? await parolaSor('Parola: ') : parola
  const h = cikar(dosya, hedef, p)
  console.log(`Açıldı: ${temiz(h.urun)} · ${temiz(h.bicim)} ${temiz(h.bicimSurum)} → ${hedef}`)
  return 0
}

if (require.main === module) {
  ana(process.argv.slice(2)).then((k) => { process.exitCode = k }, (err) => {
    console.error(IYI[err.message] || 'Açılamadı: ' + err.message)
    process.exitCode = 1
  })
}

module.exports = { ana, cikar, parolaIsle, ilkSatir, temiz, IYI }
