// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// İş akışlarının sürüm ve kurulum mantığı (Codex 12. tur): release.yml taslak korumasının kabuk adımı sahte gh ile
// koşturulur; koşul ve önbellek anahtarı ifadeleri metin olarak denetlenir (GitHub ifadeleri yerelde çalışmaz).
const test = require('brittle')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_' + 'process')

const AKIS = path.join(__dirname, '../../.github/workflows')
const oku = (ad) => fs.readFileSync(path.join(AKIS, ad), 'utf8')
const jqVar = () => spawnSync('jq', ['--version']).status === 0

// Adı verilen adımın "run: |" bloğu (girintisi atılmış)
function adimBetigi (metin, ad) {
  const satirlar = metin.split('\n')
  const i = satirlar.findIndex((s) => s.trim() === '- name: ' + ad)
  if (i < 0) throw new Error('adım yok: ' + ad)
  const r = satirlar.findIndex((s, k) => k > i && /^\s+run: \|$/.test(s))
  const girinti = satirlar[r].match(/^\s*/)[0].length + 2
  const govde = []
  for (let k = r + 1; k < satirlar.length; k++) {
    const s = satirlar[k]
    if (s.trim() && s.match(/^\s*/)[0].length < girinti) break
    govde.push(s.slice(girinti))
  }
  return govde.join('\n')
}

// İş düzeyindeki "if:" satırı
function isKosulu (metin, is) {
  const satirlar = metin.split('\n')
  const i = satirlar.indexOf('  ' + is + ':')
  if (i < 0) throw new Error('iş yok: ' + is)
  return satirlar.slice(i + 1).find((s) => /^ {4}if: /.test(s)).trim()
}

// Sahte gh: "release view" ortamdaki JSON'u (yoksa hata) gerçek jq ile süzer; diğer çağrılar günlüğe yazılır
function koshTaslak (t, release) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-akis-'))
  t.teardown(() => fs.rmSync(d, { recursive: true, force: true }))
  fs.writeFileSync(path.join(d, 'gh'), [
    '#!/usr/bin/env bash',
    'echo "$*" >> "$GUNLUK"',
    'if [ "$1 $2" = "release view" ]; then',
    '  [ -n "$RELEASE" ] || exit 1',
    '  while [ $# -gt 0 ]; do [ "$1" = --jq ] && { printf "%s" "$RELEASE" | jq -r "$2"; exit; }; shift; done',
    'fi'
  ].join('\n'), { mode: 0o755 })
  const gunluk = path.join(d, 'gunluk')
  fs.writeFileSync(gunluk, '')
  const r = spawnSync('bash', ['-e', '-c', adimBetigi(oku('release.yml'), 'Taslak release')], {
    encoding: 'utf8',
    env: { ...process.env, PATH: d + path.delimiter + process.env.PATH, GUNLUK: gunluk, RELEASE: release ? JSON.stringify(release) : '', ETIKET: 'v0.1.0-alfa', KANAL: 'deneme', GITHUB_REPOSITORY: 'havenfold/havenfold', GITHUB_SHA: 'a'.repeat(40) }
  })
  return { durum: r.status, cikti: r.stdout + r.stderr, gunluk: fs.readFileSync(gunluk, 'utf8') }
}

test('release.yml: yayımlanmış ya da imzalanmış release yeniden koşuda ezilmez; taslak imzasız olan kalır', { skip: !jqVar() }, (t) => {
  const yok = koshTaslak(t, null)
  t.is(yok.durum, 0, yok.cikti)
  t.ok(/release create v0\.1\.0-alfa .*--draft/.test(yok.gunluk), 'release yoksa taslak oluşturulur')

  const taslak = koshTaslak(t, { isDraft: true, assets: [{ name: 'SHA256SUMS' }, { name: 'havenfold-node.bildirim.imzasiz' }] })
  t.is(taslak.durum, 0, taslak.cikti)
  t.absent(/release create/.test(taslak.gunluk), 'var olan taslak yeniden oluşturulmaz')

  const yayimli = koshTaslak(t, { isDraft: false, assets: [{ name: 'SHA256SUMS' }] })
  t.is(yayimli.durum, 1, 'yayımlanmış release: iş durur, sonraki işler yüklemez')
  t.ok(/yayımlanmış ya da imzalanmış/.test(yayimli.cikti))

  for (const imzali of ['SHA256SUMS.sig', 'havenfold-node.bildirim']) {
    const r = koshTaslak(t, { isDraft: true, assets: [{ name: 'SHA256SUMS' }, { name: imzali }] })
    t.is(r.durum, 1, 'taslak ama imzalı (' + imzali + '): iş durur')
  }
})

test('release.yml: birleştirme arm64 imajı başarısız ya da iptal olunca koşmaz; yalnız kapalı depoda atlanabilir', (t) => {
  const k = isKosulu(oku('release.yml'), 'birlestir')
  t.ok(k.includes("needs.imaj-arm64.result == 'success'"), k)
  t.ok(k.includes("needs.imaj-arm64.result == 'skipped' && github.event.repository.private"), k)
  t.absent(k.includes("!= 'failure'"), 'cancelled sonucu geçmez')
})

test('install.yml: ISO önbellek anahtarı Node sürümünü, iş akışını ve kök package.json\'u kapsar; yeniden derleme koşuya özel', (t) => {
  const m = oku('install.yml')
  const i = m.indexOf('- name: ISO önbellek anahtarı')
  const adim = m.slice(i, m.indexOf('- name:', i + 1))
  for (const f of ["'package.json'", "'package-lock.json'", "'.github/workflows/install.yml'", "'worklet/**'"]) t.ok(adim.includes(f), 'hashFiles: ' + f)
  t.ok(/\$HF_NODE_SURUM/.test(adim), 'anahtarda Node sürümü')
  t.ok(/YENIDEN: \$\{\{ inputs\.yeniden_derle && github\.run_id/.test(adim) && /\$\{YENIDEN:\+-\$YENIDEN\}/.test(adim), 'yeniden derlemede koşu kimliği')
  // Kurulum ve silme işleri iso işinin anahtarını açar: yeniden derlenen ISO'yu bulurlar
  t.is((m.match(/key: \$\{\{ needs\.iso\.outputs\.anahtar \}\}/g) || []).length, 2)
})
