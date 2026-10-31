#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// image-try.js — derlenmiş görev imajını düğümün yolundan dener (RFC-0002 §11.1, RFC-0007 §12.1; images/task-ocr)
//
//   node image-try.js --url unix:///…/podman.sock --arsiv <oci-archive> --satir <imaj-satiri.json>
//
// Düğümün kodu (node/podman.js PodmanCalistirici) aynen kullanılır: imajYukle arşivin boyutunu ve hf/release-pkg/
// özetini bildirim satırıyla denetler, podman load ile yükler, yüklenen özetin ociDigest olduğunu doğrular; calistir
// görevi düğümdeki bayraklarla çalıştırır (ağ yok, kök salt okunur, /in salt okunur, /work tmpfs, --userns=keep-id,
// --cap-drop=all, bellek ve süreç sınırı). Girdiler (PNG ve iki sayfalık PDF) imajın kendi Ghostscript'iyle, ağsız
// konteynerde üretilir. Sonra CONTRACT.md'deki çıkış kodları ve çıktılar denetlenir. Yalnız derleme makinesinde (CI).
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { spawnSync } = require('child_process')
const { PodmanCalistirici } = require('../podman')
const { satirOku } = require('./release-build')
const O = require('./release-common')

const PS = `%!PS
/Helvetica-Bold findfont 72 scalefont setfont
72 600 moveto (HAVENFOLD OCR) show
72 480 moveto (DENEME 2026) show
showpage
/Helvetica-Bold findfont 72 scalefont setfont
72 600 moveto (SAYFA IKI) show
showpage
`

async function ana (a) {
  O.gerekli(a, ['url', 'arsiv', 'satir'])
  const { satir } = satirOku(a.satir)
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-imaj-'))
  fs.mkdirSync(path.join(kok, 'var/lib/havenfold/denetci'), { recursive: true })
  const p = new PodmanCalistirici({ url: a.url, kok, podman: a.podman || 'podman' })
  const ref = await p.imajYukle(satir, a.arsiv)
  console.log(`yüklendi ve özeti doğrulandı: ${ref}`)

  // Girdiler: imajın Ghostscript'i, ağsız ve salt okunur konteynerde
  const g = path.join(kok, 'girdi')
  fs.mkdirSync(g)
  fs.writeFileSync(path.join(g, 'metin.ps'), PS)
  for (const [aygit, ad, ek] of [['pnggray', 'girdi.png', ['-dFirstPage=1', '-dLastPage=1']], ['pdfwrite', 'girdi.pdf', []]]) {
    const r = spawnSync(a.podman || 'podman', ['--remote', '--url=' + a.url, 'run', '--rm', '--network=none', '--read-only', '--userns=keep-id',
      '--tmpfs=/tmp', '--volume=' + g + ':/o:rw', '--entrypoint=gs', ref,
      '-q', '-dSAFER', '-dBATCH', '-dNOPAUSE', '-r200', '-sDEVICE=' + aygit, ...ek, '-sOutputFile=/o/' + ad, '/o/metin.ps'], { encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`gs (${aygit}): ${r.stderr || r.stdout}`)
  }

  const durumlar = [
    { ad: 'PNG → metin', girdi: 'girdi.png', mime: 'image/png', params: { langs: ['eng'], output: 'text' }, kod: 0, cikti: 'metin.txt', icerir: ['HAVENFOLD', 'DENEME'] },
    { ad: 'PNG → aranabilir PDF', girdi: 'girdi.png', mime: 'image/png', params: { langs: ['tur', 'eng'], output: 'pdf' }, kod: 0, cikti: 'cikti.pdf', basi: '%PDF' },
    { ad: 'PDF 2. sayfa → metin', girdi: 'girdi.pdf', mime: 'application/pdf', params: { langs: ['eng'], pages: [2, 2], output: 'text' }, kod: 0, cikti: 'metin.txt', icerir: ['SAYFA'], icermez: ['HAVENFOLD'] },
    { ad: 'PDF → aranabilir PDF', girdi: 'girdi.pdf', mime: 'application/pdf', params: { langs: ['tur'], output: 'pdf' }, kod: 0, cikti: 'cikti.pdf', basi: '%PDF' },
    { ad: 'fazla alan → INVALID_INPUT', girdi: 'girdi.png', mime: 'image/png', params: { langs: ['eng'], output: 'text', fazla: 1 }, kod: 2 },
    { ad: 'imajda olmayan dil → DIL_YOK', girdi: 'girdi.png', mime: 'image/png', params: { langs: ['deu'], output: 'text' }, kod: 3 },
    { ad: 'görüntüde 2. sayfa → SAYFA_GECERSIZ', girdi: 'girdi.png', mime: 'image/png', params: { langs: ['eng'], pages: [2, 2], output: 'text' }, kod: 4 },
    { ad: 'belgenin dışı → SAYFA_GECERSIZ', girdi: 'girdi.pdf', mime: 'application/pdf', params: { langs: ['eng'], pages: [1, 5], output: 'text' }, kod: 4 },
    { ad: 'bozuk girdi → hata', girdi: 'metin.ps', mime: 'application/pdf', params: { langs: ['eng'], output: 'text' }, kodlar: [2, 10] }
  ]
  let hata = 0
  for (const d of durumlar) {
    const taskId = crypto.randomBytes(16).toString('hex')
    const dir = path.join(kok, 'gorev', taskId)
    fs.mkdirSync(path.join(dir, 'in'), { recursive: true })
    fs.mkdirSync(path.join(dir, 'out'))
    fs.writeFileSync(path.join(dir, 'in/params'), JSON.stringify(d.params))
    const bytes = fs.readFileSync(path.join(g, d.girdi))
    fs.writeFileSync(path.join(dir, 'in/girdiler.json'), JSON.stringify([{ ad: '0', mime: d.mime, size: bytes.byteLength }]))
    fs.writeFileSync(path.join(dir, 'in/0'), bytes)
    const t0 = Date.now()
    const r = await p.calistir({ taskId, dir, type: satir.type, version: satir.version, limits: { ramMB: satir.ramMB, diskMB: 512, minutes: 5 } })
    const sorun = []
    if (d.kodlar ? !d.kodlar.includes(r.exitCode) : r.exitCode !== d.kod) sorun.push(`çıkış kodu ${r.exitCode}, beklenen ${d.kodlar ? d.kodlar.join('|') : d.kod}`)
    if (r.status !== (r.exitCode === 0 ? 'ok' : 'hata')) sorun.push('durum ' + r.status)
    let ozet = ''
    if (d.cikti) {
      const f = path.join(dir, 'out', d.cikti)
      if (!fs.existsSync(f)) sorun.push(d.cikti + ' yok')
      else {
        const b = fs.readFileSync(f)
        if (d.basi && b.subarray(0, d.basi.length).toString('latin1') !== d.basi) sorun.push(d.cikti + ' PDF değil')
        const metin = b.toString('utf8')
        for (const x of d.icerir || []) if (!metin.toUpperCase().includes(x)) sorun.push(`metinde ${x} yok`)
        for (const x of d.icermez || []) if (metin.toUpperCase().includes(x)) sorun.push(`metinde ${x} var`)
        ozet = d.basi ? `${b.byteLength} bayt` : JSON.stringify(metin.replace(/\s+/g, ' ').trim().slice(0, 60))
      }
    }
    const gunluk = r.log.trim().split('\n').filter((s) => s.startsWith('hf: ')).pop() || ''
    console.log(`${sorun.length ? 'HATA' : 'tamam'}  ${d.ad}: kod ${r.exitCode} (${gunluk}) ${ozet} ${Date.now() - t0} ms${sorun.length ? ' — ' + sorun.join('; ') : ''}`)
    if (sorun.length) { hata++; console.log(r.log) }
  }
  fs.rmSync(kok, { recursive: true, force: true })
  return hata
}

if (require.main === module) {
  ana(O.argumanlar(process.argv.slice(2))).then((hata) => {
    console.log(hata ? `${hata} durum başarısız` : 'İMAJ DENEMESİ: TAMAM')
    process.exitCode = hata ? 1 : 0
  }, (err) => {
    console.error('imaj-dene: ' + err.message)
    process.exitCode = 1
  })
}
