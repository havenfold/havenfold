// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// scripts/public-repo.sh açılış taraması (Codex 12. tur): hariç tutma her eşleşmeye uygulanır, dizgiye gömülü PEM
// anahtarı yakalanır, gitleaks ya da kalıp dosyası yoksa sonuç TAMAM değil EKSİK'tir (betik geçici bir git deposuna
// kopyalanır; ekilen dosyalar orada; taranan kalıplar bu dosyada parçalı yazılır ki gerçek açılış taraması burada
// bulgu görmesin). Kalıp dosyasının satır sonu olmayan son satırı da taranır; geçersiz kalıp "bulgu yok" sayılmaz,
// KESİN hata olur; göreli hedef çağıranın klasörüne göre çözülür (depo köküne değil; bu deponun kendisiyle).
const test = require('brittle')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_' + 'process')

const KOK = path.join(__dirname, '..', '..')
const BETIK = path.join(KOK, 'scripts/public-repo.sh')
const gitVar = () => spawnSync('git', ['--version']).status === 0

// dosyalar: { yol: içerik }; gitleaks: sahte gitleaks PATH'te mi; kaliplar: kalıp dosyası var mı
function kos (t, dosyalar, { gitleaks = true, kaliplar = true } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-acik-'))
  t.teardown(() => fs.rmSync(d, { recursive: true, force: true }))
  const depo = path.join(d, 'depo')
  const bin = path.join(d, 'bin')
  fs.mkdirSync(path.join(depo, 'scripts'), { recursive: true })
  fs.mkdirSync(bin)
  fs.copyFileSync(BETIK, path.join(depo, 'scripts/public-repo.sh'))
  for (const [yol, icerik] of Object.entries(dosyalar)) {
    fs.mkdirSync(path.dirname(path.join(depo, yol)), { recursive: true })
    fs.writeFileSync(path.join(depo, yol), icerik)
  }
  if (gitleaks) fs.writeFileSync(path.join(bin, 'gitleaks'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  const kalip = path.join(d, 'kaliplar.txt')
  if (kaliplar) fs.writeFileSync(kalip, '# boş\n')
  // gitleaks yalnız sahte dizinden gelebilsin: PATH sistem dizinleriyle sınırlı
  const env = { HOME: d, PATH: [bin, '/usr/bin', '/bin'].join(path.delimiter), HF_ACIK_KALIPLAR: kalip, GIT_CONFIG_NOSYSTEM: '1' }
  const git = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], { cwd: depo, env, encoding: 'utf8' })
  git('init', '-q')
  git('add', '-A')
  t.is(git('commit', '-q', '-m', 'ilk').status, 0)
  const r = spawnSync('bash', [path.join(depo, 'scripts/public-repo.sh'), path.join(d, 'cikti', 'agac')], { cwd: depo, env, encoding: 'utf8' })
  const rapor = fs.readFileSync(path.join(d, 'cikti', 'acik-depo-rapor.txt'), 'utf8')
  return { durum: r.status, cikti: r.stdout + r.stderr, rapor }
}

const AT = '@'
const PEM = '-----BEGIN ' + 'PRIVATE KEY-----'

test('public-repo.sh: temiz ağaç TAMAM; izinli adres ve testteki yerel adres bulgu değil', { skip: !gitVar() }, (t) => {
  const r = kos(t, {
    'README.md': 'İletişim: info' + AT + 'havenfolddev.com, örnek: ali' + AT + 'example.com\n',
    'core/test/ag.js': "const IP = '192.168" + ".1.5'\n"
  })
  t.is(r.durum, 0, r.cikti)
  t.ok(/TAMAM/.test(r.cikti))
})

test('public-repo.sh: izinli adresle aynı satırdaki kişisel e-posta kaçmaz', { skip: !gitVar() }, (t) => {
  const r = kos(t, { 'README.md': 'İletişim: info' + AT + 'havenfolddev.com ya da kisi' + AT + 'sirket.com.tr\n' })
  t.is(r.durum, 1, r.cikti)
  t.ok(r.rapor.includes('sirket.com.tr'), 'raporda kişisel adres')
})

test('public-repo.sh: içeriğinde /test/ geçen satırdaki iç ağ adresi kaçmaz (hariç tutma yalnız yolda)', { skip: !gitVar() }, (t) => {
  const r = kos(t, { 'docs/ag.md': 'Deneme sunucusu 10.0' + '.0.7 (bkz. /test/ klasörü)\n' })
  t.is(r.durum, 1, r.cikti)
  t.ok(r.rapor.includes('docs/ag.md'))
})

test('public-repo.sh: dizgiye gömülü PEM anahtarı yakalanır; PEM üreten ve okuyan kod bulgu değil', { skip: !gitVar() }, (t) => {
  const kod = "const pem = '" + PEM + "\\n' + der.toString('base64')\nconst r = /^" + PEM + '\\r?\\n([A-Za-z0-9+/=]+)/\n'
  const temiz = kos(t, { 'lib/imza.js': kod })
  t.is(temiz.durum, 0, temiz.cikti)
  const r = kos(t, { 'lib/anahtar.js': "const k = '" + PEM + '\\n' + 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSj' + "'\n" })
  t.is(r.durum, 1, r.cikti)
  t.ok(r.rapor.includes('lib/anahtar.js'))
})

test('public-repo.sh: gitleaks ya da kalıp dosyası yoksa sonuç EKSİK (çıkış 2), TAMAM değil', { skip: !gitVar() }, (t) => {
  const icerik = { 'README.md': 'Merhaba\n' }
  for (const s of [{ gitleaks: false }, { kaliplar: false }]) {
    const r = kos(t, icerik, s)
    t.is(r.durum, 2, JSON.stringify(s) + ': ' + r.cikti)
    t.absent(/TAMAM/.test(r.cikti))
    t.ok(/EKSİK/.test(r.cikti))
  }
})

test('public-repo.sh: kalıp dosyası son satırı, geçersiz kalıp, göreli hedef', { timeout: 120_000 }, (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-acik-'))
  const eskiYer = !fs.existsSync(path.join(KOK, 'acik'))
  t.teardown(() => {
    fs.rmSync(d, { recursive: true, force: true })
    if (eskiYer) { fs.rmSync(path.join(KOK, 'acik'), { recursive: true, force: true }); fs.rmSync(path.join(KOK, 'acik-depo-rapor.txt'), { force: true }) }
  })
  const kaliplar = path.join(d, 'kaliplar.txt')
  fs.writeFileSync(kaliplar, '# deneme\nbozuk\t(Havenfold\nson\tSPDX-License-Identifier')
  const r = spawnSync('bash', [path.join(KOK, 'scripts/public-repo.sh'), 'acik', '--kayit', 'HEAD'], { cwd: d, encoding: 'utf8', env: { ...process.env, HF_ACIK_KALIPLAR: kaliplar, PATH: '/usr/bin:/bin:' + path.dirname(process.execPath) } })
  t.ok(fs.existsSync(path.join(d, 'acik', 'README.md')), 'ağaç çağıranın klasöründe')
  t.absent(fs.existsSync(path.join(KOK, 'acik')), 'depo köküne yazılmadı')
  const rapor = fs.existsSync(path.join(d, 'acik-depo-rapor.txt')) ? fs.readFileSync(path.join(d, 'acik-depo-rapor.txt'), 'utf8') : ''
  t.ok(/\n## son \(\d+ satır\)/.test(rapor), 'satır sonu olmayan son satır tarandı')
  t.ok(rapor.includes('bozuk') && rapor.includes('geçersiz kalıp'), 'geçersiz kalıp raporda')
  t.is(r.status, 1, 'geçersiz kalıp KESİN')
})
