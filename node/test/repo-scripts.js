// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// scripts/ altındaki denetim ve ölçüm araçlarının ad değişikliğinden kalan kırıkları (Codex 12. tur): kapsam tablosunun
// kritik kalıpları bugünkü dosya adlarıyla eşleşir ve eşleşmeyen kalıp boşa düşmez (kapsam koşulmaz; c8 özeti geçici
// dosyada elle yazılır); check.sh'ın sahipsiz süreç kalıbı bugünkü cihaz yardımcısını bulur; measure-startup.js'in
// çocuk betikleri var.
const test = require('brittle')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_' + 'process')

const KOK = path.join(__dirname, '../..')
const BETIK = path.join(KOK, 'scripts/coverage-table.js')
const KRITIK = ['core/vault/share.js', 'core/export/zip.js', 'core/core/protocol/messages.js', 'worklet/persistence.js', 'worklet/ipc.js',
  'sdk/vault.js', 'sdk/team.js', 'core/ai/embedding.js', 'core/services/card.js', 'sdk/service.js', 'services/receiver/receiver.js',
  'core/edge/edge.js', 'sdk/edge.js']

function kos (t, dallar) { // dallar: { yol: [kapsanan, toplam] }
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-kapsam-'))
  t.teardown(() => fs.rmSync(d, { recursive: true, force: true }))
  const x = (k, n) => ({ covered: k, total: n, pct: 0 })
  const ozet = { total: { lines: x(1, 1), branches: x(1, 1), functions: x(1, 1) } }
  for (const [g, [k, n]] of Object.entries(dallar)) ozet[path.join(KOK, g)] = { lines: x(1, 1), branches: x(k, n), functions: x(1, 1) }
  fs.writeFileSync(path.join(d, 'ozet.json'), JSON.stringify(ozet))
  const r = spawnSync(process.execPath, [BETIK, '--ozet', path.join(d, 'ozet.json')], { encoding: 'utf8' })
  return { durum: r.status, cikti: r.stdout + r.stderr }
}
const hepsi = (k, n) => Object.fromEntries(KRITIK.map((g) => [g, [k, n]]))

test('kapsam tablosu: bütün kritik modüller eşikte → TAMAM', (t) => {
  const r = kos(t, hepsi(95, 100))
  t.is(r.durum, 0, r.cikti)
  for (const g of KRITIK) t.ok(r.cikti.includes('`' + g + '`'), 'tabloda: ' + g)
})

test('kapsam tablosu: yeni adlı kritik modül eşik altında → çıkış 1 (eski kalıplar bunları görmüyordu)', (t) => {
  for (const g of ['core/vault/share.js', 'worklet/persistence.js', 'services/receiver/receiver.js', 'sdk/edge.js']) {
    const r = kos(t, { ...hepsi(95, 100), [g]: [50, 100] })
    t.is(r.durum, 1, g + ': ' + r.cikti)
    t.ok(/eşik altı/.test(r.cikti), g)
  }
})

test('kapsam tablosu: özette karşılığı olmayan kritik kalıp → çıkış 1', (t) => {
  const d = hepsi(95, 100)
  delete d['sdk/team.js']
  const r = kos(t, d)
  t.is(r.durum, 1, r.cikti)
  t.ok(/hiçbir dosyaya uymayan kritik desen: .*team/.test(r.cikti), r.cikti)
})

test('check.sh: sahipsiz süreç kalıbı bugünkü cihaz yardımcısının komut satırıyla eşleşir', (t) => {
  const m = fs.readFileSync(path.join(KOK, 'scripts/check.sh'), 'utf8').match(/awk '\$2 == 1 && \/(.+?)\/ \{print \$1\}'/)
  t.ok(m, 'awk kalıbı bulundu')
  const yardimci = path.join(KOK, 'worklet/test/helpers/device.js')
  t.ok(fs.existsSync(yardimci))
  t.ok(fs.readFileSync(path.join(KOK, 'worklet/test/helpers/multi.js'), 'utf8').includes("__dirname + '/device.js'"), 'multi.js bu yardımcıyı başlatır')
  t.ok(new RegExp(m[1].replace(/\\\//g, '/')).test(process.execPath + ' ' + yardimci + ' --ad a'), m[1])
})

test('measure-startup.js: surec() ile çağrılan her çocuk betik scripts/measure-startup/ altında var', (t) => {
  const kaynak = fs.readFileSync(path.join(KOK, 'scripts/measure-startup.js'), 'utf8')
  const adlar = [...kaynak.matchAll(/surec\('([a-z-]+)'/g), ...kaynak.matchAll(/\[\['([a-z-]+)', 'kaynaktan'\]/g)].map((x) => x[1])
  t.ok(adlar.length >= 3, adlar.join(', '))
  for (const a of adlar) t.ok(fs.existsSync(path.join(KOK, 'scripts/measure-startup', a + '.js')), a + '.js')
})

test('node/package.json files: npm paketindeki her göreli require paketin içinde çözülür', (t) => {
  const r = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: path.join(KOK, 'node'), encoding: 'utf8' })
  t.is(r.status, 0, r.stderr)
  const dosyalar = new Set(JSON.parse(r.stdout)[0].files.map((f) => f.path))
  for (const d of ['disaster/', 'edge/', 'deploy/', 'bundle/']) t.ok([...dosyalar].some((f) => f.startsWith(d)), 'pakette: ' + d)
  const eksik = []
  for (const f of dosyalar) {
    // bundle/ paket düzeninin girişleridir (../lib/…): npm paketinde çözülmez
    if (!f.endsWith('.js') || f.startsWith('bundle/')) continue
    const kaynak = fs.readFileSync(path.join(KOK, 'node', f), 'utf8')
    for (const [, yol] of kaynak.matchAll(/require\(['"](\.\.?\/[^'"]+)['"]\)/g)) {
      const h = path.posix.normalize(path.posix.join(path.posix.dirname(f), yol))
      if (h.startsWith('..')) continue
      if (![h, h + '.js', h + '.json', h + '/index.js'].some((x) => dosyalar.has(x))) eksik.push(f + ' → ' + yol)
    }
  }
  t.alike(eksik, [], 'çözülmeyen require yok')
})
