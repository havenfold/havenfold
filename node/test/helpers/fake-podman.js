// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Sahte podman: PATH'e konan betik. Çağrıları kayıt dizinine yazar; davranışı SAHTE_KIP belirler (bu makinede Podman
// yok). run: ok (çıktı yazar, girdi listesini kopyalar) | ocr (tek çıktı: girdinin özeti) | hata (çıkış 2) | log (uzun çıktı) | bekle (kill gelene kadar);
// kill: bekleyen run'a işaret bırakır; load: yüklenen ad; image inspect: SAHTE_OZET.
const fs = require('fs')
const os = require('os')
const path = require('path')

const BETIK = `#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const kayit = process.env.SAHTE_KAYIT
const args = process.argv.slice(2)
fs.appendFileSync(path.join(kayit, 'cagrilar.jsonl'), JSON.stringify(args) + '\\n')
let i = 0
while (i < args.length && args[i].startsWith('--')) i++
const alt = args[i]
const son = args[args.length - 1]
const deger = (on) => { const a = args.find((x) => x.startsWith(on)); return a ? a.slice(on.length) : null }
// D89: görüntü görevinin pod'u ve akış sunucusu (SAHTE_POD=hata: pod kurulamaz; SAHTE_SUNUCU=hata: sunucu başlamaz;
// SAHTE_PODLAR: pod ps çıktısı)
if (alt === 'pod') {
  const p = args[i + 1]
  if (p === 'create') process.exit(process.env.SAHTE_POD === 'hata' ? 1 : 0)
  if (p === 'rm') process.exit(0)
  if (p === 'ps') { process.stdout.write((process.env.SAHTE_PODLAR || '').split(',').filter(Boolean).join('\\n')); process.exit(0) }
}
if (alt === 'run' && args.includes('--detach')) process.exit(process.env.SAHTE_SUNUCU === 'hata' ? 1 : 0)
if (alt === 'run') {
  const kip = process.env.SAHTE_KIP || 'ok'
  const ad = deger('--name=')
  const hacim = (hedef) => { const v = args.find((x) => x.startsWith('--volume=') && x.includes(':' + hedef + ':')); return v.slice(9).split(':')[0] }
  if (kip === 'ok') {
    const giris = hacim('/in')
    const cikis = hacim('/out')
    fs.writeFileSync(path.join(cikis, 'metin.txt'), 'tamam')
    if (fs.existsSync(path.join(giris, 'girdiler.json'))) {
      fs.copyFileSync(path.join(giris, 'girdiler.json'), path.join(cikis, 'girdiler.json'))
      const izin = (ad) => (fs.statSync(path.join(giris, ad)).mode & 0o777).toString(8)
      fs.writeFileSync(path.join(cikis, 'izinler.json'), JSON.stringify({ params: izin('params'), sifir: izin('0'), paramsIcerik: fs.readFileSync(path.join(giris, 'params'), 'utf8') }))
    }
    console.log('hf: tamam')
    process.exit(0)
  }
  if (kip === 'ocr') {
    // Tek çıktı: girdinin özeti ve dil listesi (girdinin doğru çözülüp konduğunu gösterir)
    const ozet = require('crypto').createHash('sha256').update(fs.readFileSync(path.join(hacim('/in'), '0'))).digest('hex')
    const p = JSON.parse(fs.readFileSync(path.join(hacim('/in'), 'params'), 'utf8'))
    fs.writeFileSync(path.join(hacim('/out'), 'metin.txt'), 'ocr:' + ozet + ':' + p.langs.join('+'))
    console.log('hf: TAMAM')
    process.exit(0)
  }
  if (kip === 'hata') { console.error('hf: INVALID_INPUT'); process.exit(2) }
  if (kip === 'log') { process.stdout.write('ç'.repeat(5000) + 'SON\\n'); process.exit(0) }
  if (kip === 'bekle') {
    const isaret = path.join(kayit, 'kill-' + ad)
    const bas = Date.now()
    setInterval(() => {
      if (fs.existsSync(isaret)) process.exit(137)
      if (Date.now() - bas > 20000) process.exit(99)
    }, 20)
    return
  }
}
if (alt === 'kill') { fs.writeFileSync(path.join(kayit, 'kill-' + son), ''); process.exit(0) }
if (alt === 'rm' || alt === 'rmi') process.exit(0)
if (alt === 'load') { console.log('Loaded image: localhost/hf-task-ocr:1.0.0'); process.exit(0) }
if (alt === 'image' && args[i + 1] === 'inspect') { console.log(process.env.SAHTE_OZET || ''); process.exit(0) }
process.exit(125)
`

// Dönüş: { ortam (spawn env), kayit, cagrilar(), sil() }
function sahtePodman (kip = 'ok', ek = {}) {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-podman-'))
  const bin = path.join(kok, 'bin')
  const kayit = path.join(kok, 'kayit')
  fs.mkdirSync(bin)
  fs.mkdirSync(kayit)
  fs.writeFileSync(path.join(bin, 'podman'), BETIK, { mode: 0o755 })
  return {
    kok,
    kayit,
    ortam: { ...process.env, INVOCATION_ID: undefined, PATH: bin + path.delimiter + process.env.PATH, SAHTE_KAYIT: kayit, SAHTE_KIP: kip, ...ek },
    cagrilar: () => {
      const p = path.join(kayit, 'cagrilar.jsonl')
      return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim().split('\n').map((s) => JSON.parse(s)) : []
    },
    sil: () => fs.rmSync(kok, { recursive: true, force: true })
  }
}

module.exports = { sahtePodman }
