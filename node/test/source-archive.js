// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// images/source-archive.sh imajın içinde çalışan betiği (IC) arm64 ve amd64 ubuntu.sources örnekleriyle sınar.
// release 41181622968 (açık depo), image (arm64): `apt-get -o APT::Snapshot=… update` deb-src eklenince
// "debmetaindex.cc:1350: Assertion `List.back() == Deb' failed" ile çöktü.
//
// Konteyner yerine sahte bir kök kullanılır: IC'deki mutlak yollar geçici dizine çevrilir, apt-get yerine
// aşağıdaki model çalışır. Model apt 2.7.14'ün (Ubuntu 24.04) kaynak listesi kurma adımını izler:
//   apt-pkg/sourcelist.cc   deb822 bölümü: Types > URIs > Suites > Components sırasıyla CreateItem
//   apt-pkg/deb/debmetaindex.cc CreateItemInternal (1300-1360): anlık görüntü sunucusu önce listelerdeki Release
//     dosyasından, yoksa Acquire::Snapshots::URI::Host::<ana makine> tablosundan; bulunamazsa ve kip "?" ise
//     (APT::Snapshot ayarı) anlık görüntü bırakılır, "biz açtıysak" dizin listeden silinir:
//     if (Deb && Deb != PreviousDeb) { assert(List.back() == Deb); … }
//   apt-pkg/init.cc         Host tablosu: archive.ubuntu.com, .archive.ubuntu.com, security.ubuntu.com (ports yok)
// Güncellemede her deb-src girdisi için listeler dizinine apt'nin adlandırdığı gibi bir Sources dosyası yazılır.
// Anlık görüntü kipinde asıl (canlı) depo SHADOWED girdi olarak kalır ve onun Sources dosyası da iner (apt
// test/integration/test-snapshot: anlık görüntülü update'te asıl depo da "Hit: … InRelease"; release 41184626823'te
// listelerde archive.ubuntu.com_ubuntu_dists_noble-backports_main_source_Sources.lz4 vardı).
const test = require('brittle')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const KOK = path.join(__dirname, '..', '..')
const SNAP = '20261015T000000Z'

const SAHTE_APT = `#!${process.execPath}
'use strict'
const fs = require('fs')
const path = require('path')
const KOK = process.env.HF_SAHTE_KOK
const LISTE = path.join(KOK, 'etc/apt/sources.list.d/ubuntu.sources')
const LISTS = path.join(KOK, 'var/lib/apt/lists')
const H = 'Acquire::Snapshots::URI::Host::'
const cfg = new Map([ // apt-pkg/init.cc (2.7.14)
  ['Acquire::Snapshots::URI::Origin::Ubuntu', 'https://snapshot.ubuntu.com/ubuntu/@SNAPSHOTID@/'],
  [H + 'archive.ubuntu.com', 'https://snapshot.ubuntu.com/@PATH@/@SNAPSHOTID@/'],
  [H + '.archive.ubuntu.com', 'https://snapshot.ubuntu.com/@PATH@/@SNAPSHOTID@/'],
  [H + 'security.ubuntu.com', 'https://snapshot.ubuntu.com/@PATH@/@SNAPSHOTID@/'],
  [H + 'deb.debian.org', 'https://snapshot.debian.org/archive/@PATH@/@SNAPSHOTID@/']
])
const a = process.argv.slice(2)
let komut = null
for (let i = 0; i < a.length; i++) {
  if (a[i] === '-o') { const s = a[++i]; const j = s.indexOf('='); cfg.set(s.slice(0, j), s.slice(j + 1)) }
  else if (!a[i].startsWith('-') && komut === null) komut = a[i]
}
fs.appendFileSync(path.join(KOK, 'apt-cagrilari.txt'), JSON.stringify(a) + '\\n')
if (process.env.HF_SAHTE_HOST_YOK) cfg.delete(H + process.env.HF_SAHTE_HOST_YOK) // tabloyu bilmeyen apt
if (komut === 'source') process.exit(0)
if (komut !== 'update') { console.error('sahte apt-get: ' + komut); process.exit(100) }

const dosyaAdi = (u) => u.replace(/^[a-z]+:\\/\\//, '').replace(/\\//g, '_')
const List = []
const girdiler = []
const al = (uri, dist) => {
  let d = List.find((x) => x.uri === uri && x.dist === dist)
  if (!d) { d = { uri, dist }; List.push(d) }
  return d
}
const sunucu = (uri, dist) => {
  if (fs.existsSync(path.join(LISTS, dosyaAdi(uri + 'dists/' + dist + '/InRelease')))) return cfg.get('Acquire::Snapshots::URI::Origin::Ubuntu')
  for (let h = new URL(uri).hostname; h; ) {
    if (cfg.get(H + h)) return cfg.get(H + h)
    const i = h.indexOf('.', 1); h = i < 0 ? '' : h.slice(i)
  }
  return ''
}
const ekle = (src, uri, dist, comp) => {
  let snap = cfg.get('APT::Snapshot') ? cfg.get('APT::Snapshot') + '?' : ''
  if (snap) {
    const onceki = List.length ? List[List.length - 1] : null
    const deb = al(uri, dist)
    const s = sunucu(uri, dist)
    if (!s || s === 'no') {
      if (!snap.endsWith('?')) { console.error('E: Snapshots not supported for ' + uri + ' ' + dist); process.exit(100) }
      if (deb !== onceki) {
        if (List[List.length - 1] !== deb) {
          console.error("apt-get: ./apt-pkg/deb/debmetaindex.cc:1350: bool debSLTypeDebian::CreateItemInternal(...) const: Assertion \`List.back() == Deb' failed.")
          process.exit(134)
        }
        List.pop()
      }
    } else {
      snap = snap.slice(0, -1)
      const yol = new URL(uri).pathname.replace(/^\\/+|\\/+$/g, '')
      const suri = s.replace('@SNAPSHOTID@', snap).replace('@PATH@', yol)
      al(suri, dist)
      girdiler.push({ src, uri: suri, dist, comp })
    }
  }
  // nosnapshot: asıl depo da (anlık görüntü varsa SHADOWED olarak) listede kalır; update onun dizinlerini de indirir
  al(uri, dist)
  girdiler.push({ src, uri, dist, comp })
}
const bolumler = fs.readFileSync(LISTE, 'utf8').split(/\\n\\s*\\n/).map((b) => {
  const m = {}
  for (const l of b.split('\\n')) {
    if (l.startsWith('#')) continue
    const k = l.indexOf(':')
    if (k > 0) m[l.slice(0, k)] = l.slice(k + 1).trim().split(/\\s+/)
  }
  return m
}).filter((m) => m.Types)
for (const b of bolumler) for (const t of b.Types) for (const u of b.URIs) for (const s of b.Suites) for (const c of b.Components) ekle(t === 'deb-src', u, s, c)
fs.mkdirSync(LISTS, { recursive: true })
for (const g of girdiler) if (g.src) fs.writeFileSync(path.join(LISTS, dosyaAdi(g.uri + 'dists/' + g.dist + '/' + g.comp + '/source/Sources') + '.lz4'), '')
`

// docker.io/library/ubuntu:24.04 içindeki /etc/apt/sources.list.d/ubuntu.sources (yorumlar kısaltıldı)
const kaynaklar = (ana, guvenlik) => `# Ubuntu sources have moved to the /etc/apt/sources.list.d/ubuntu.sources
## Note that the sources.list format is deprecated.

Types: deb
URIs: ${ana}
Suites: noble noble-updates noble-backports
Components: main universe restricted multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg

## Ubuntu security updates. Aside from URIs and Suites,
## this should mirror your choices in the previous section.
Types: deb
URIs: ${guvenlik}
Suites: noble-security
Components: main universe restricted multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
`
const AMD64 = kaynaklar('http://archive.ubuntu.com/ubuntu/', 'http://security.ubuntu.com/ubuntu/')
const ARM64 = kaynaklar('http://ports.ubuntu.com/ubuntu-ports/', 'http://ports.ubuntu.com/ubuntu-ports/')

function icBetik () {
  const betik = fs.readFileSync(path.join(KOK, 'images/source-archive.sh'), 'utf8')
  const m = /read -r -d '' IC <<'IC_BETIK' \|\| true\n([\s\S]*?)\nIC_BETIK\n/.exec(betik)
  if (!m) throw new Error('IC_BETIK bulunamadı')
  return m[1]
}

function calistir (t, sources, ekEnv = {}) {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-kaynak-'))
  t.teardown(() => fs.rmSync(kok, { recursive: true, force: true }))
  for (const d of ['etc/apt/sources.list.d', 'var/lib/apt/lists', 'kaynak', 'kaynak-liste', 'bin', 'usr/share/doc/bash']) fs.mkdirSync(path.join(kok, d), { recursive: true })
  fs.writeFileSync(path.join(kok, 'etc/apt/sources.list.d/ubuntu.sources'), sources)
  fs.writeFileSync(path.join(kok, 'usr/share/doc/bash/copyright'), 'License: GPL-3+\n')
  const bin = path.join(kok, 'bin')
  fs.writeFileSync(path.join(bin, 'apt-get'), SAHTE_APT, { mode: 0o755 })
  fs.writeFileSync(path.join(bin, 'dpkg-query'), "#!/bin/sh\nprintf 'bash\\t5.2.21-2ubuntu4\\tbash\\t5.2.21-2ubuntu4\\nlibc6:arm64\\t2.39-0ubuntu8.6\\tglibc\\t2.39-0ubuntu8.6\\n'\n", { mode: 0o755 })
  if (spawnSync('sed', ['--version']).status !== 0) { // BSD sed (macOS): -i son ek ister
    fs.writeFileSync(path.join(bin, 'sed'), '#!/bin/sh\nif [ "$1" = -i ]; then shift; exec /usr/bin/sed -i \'\' "$@"; fi\nexec /usr/bin/sed "$@"\n', { mode: 0o755 })
  }
  const ic = icBetik()
    .split('/etc/apt/sources.list.d/ubuntu.sources').join(path.join(kok, 'etc/apt/sources.list.d/ubuntu.sources'))
    .split('/var/lib/apt/lists').join(path.join(kok, 'var/lib/apt/lists'))
    .split('/kaynak-liste').join(path.join(kok, 'kaynak-liste'))
    .split('cd /kaynak\n').join(`cd ${path.join(kok, 'kaynak')}\n`)
    .split('/usr/share/doc/').join(path.join(kok, 'usr/share/doc') + '/')
  const r = spawnSync('bash', ['-c', ic], {
    encoding: 'utf8',
    env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, SNAP, HEPSI: '0', HF_SAHTE_KOK: kok, ...ekEnv }
  })
  const oku = (f) => { try { return fs.readFileSync(path.join(kok, f), 'utf8') } catch { return '' } }
  return {
    kod: r.status,
    hata: r.stderr,
    listeler: fs.readdirSync(path.join(kok, 'var/lib/apt/lists')).sort(),
    cagrilar: oku('apt-cagrilari.txt').split('\n').filter(Boolean).map((l) => JSON.parse(l)),
    kaynaklarTxt: oku('kaynak-liste/KAYNAKLAR.txt'),
    sources: oku('etc/apt/sources.list.d/ubuntu.sources')
  }
}

const BILESEN = ['main', 'multiverse', 'restricted', 'universe']
const beklenenListeler = (suites) => suites.flatMap((s) => BILESEN
  .map((c) => `snapshot.ubuntu.com_ubuntu_${SNAP}_dists_${s}_${c}_source_Sources.lz4`)).sort()
const canliListeler = (onek, suites) => suites.flatMap((s) => BILESEN.map((c) => `${onek}_dists_${s}_${c}_source_Sources.lz4`))
const anlik = (listeler) => listeler.filter((f) => f.startsWith('snapshot.ubuntu.com_'))
const HEPSI = ['noble', 'noble-backports', 'noble-security', 'noble-updates']

test('source-archive.sh: arm64 (ports.ubuntu.com) deb-src anlık görüntüden, apt çökmez', (t) => {
  const r = calistir(t, ARM64)
  t.is(r.kod, 0, r.hata)
  t.absent(/Assertion/.test(r.hata), 'debmetaindex.cc:1350 iddiası yok')
  t.ok(/^Types: deb deb-src$/m.test(r.sources), 'deb-src eklendi')
  t.alike(anlik(r.listeler), beklenenListeler(HEPSI), 'her deb-src dizini snapshot.ubuntu.com/ubuntu altından (ports yolu yok)')
  t.alike(r.listeler, [...beklenenListeler(HEPSI), ...canliListeler('ports.ubuntu.com_ubuntu-ports', HEPSI)].sort(),
    'gölge (canlı) dizinler de iner ve hata sayılmaz (release 41184626823)')
  t.ok(/^bash\t5\.2\.21-2ubuntu4\tgpl$/m.test(r.kaynaklarTxt), 'kaynak paket indirildi')
  t.ok(/^glibc\t2\.39-0ubuntu8\.6\tcopyright-yok$/m.test(r.kaynaklarTxt), 'mimari ekli ikili paketin kaynağı')
  for (const c of r.cagrilar) t.ok(c.includes(`APT::Snapshot=${SNAP}`), 'her apt-get çağrısı aynı anlık görüntüyle: ' + c.slice(-2).join(' '))
})

test('source-archive.sh: amd64 davranışı aynı (apt tablosundaki sunucu)', (t) => {
  const r = calistir(t, AMD64)
  t.is(r.kod, 0, r.hata)
  t.alike(anlik(r.listeler), beklenenListeler(HEPSI), 'archive ve security aynı anlık görüntü adresinde')
  t.ok(r.listeler.includes('archive.ubuntu.com_ubuntu_dists_noble-backports_main_source_Sources.lz4'), 'gölge canlı dizin yerinde, hata değil')
  t.ok(/^bash\t5\.2\.21-2ubuntu4\tgpl$/m.test(r.kaynaklarTxt))
})

test('source-archive.sh: anlık görüntü sunucusu bilinmeyen depo açık hatayla durur', (t) => {
  const r = calistir(t, kaynaklar('http://ayna.example.org/ubuntu/', 'http://security.ubuntu.com/ubuntu/'))
  t.is(r.kod, 2, 'kod 2')
  t.ok(r.hata.includes('HATA: anlık görüntü sunucusu bilinmeyen depo: http://ayna.example.org/ubuntu/'), r.hata)
  t.is(r.cagrilar.length, 0, 'apt-get çağrılmadı')
})

test('source-archive.sh: apt anlık görüntüyü sessizce bırakırsa durur', (t) => {
  // Tek Suite'li bölümde apt çökmez, ports için sunucu bulamazsa canlı arşive döner (ör. -o ayarını tanımayan apt)
  const tek = `Types: deb
URIs: http://ports.ubuntu.com/ubuntu-ports/
Suites: noble
Components: main
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
`
  const r = calistir(t, tek, { HF_SAHTE_HOST_YOK: 'ports.ubuntu.com' })
  t.is(r.kod, 2, 'kod 2')
  t.alike(r.listeler, ['ports.ubuntu.com_ubuntu-ports_dists_noble_main_source_Sources.lz4'], 'yalnız canlı dizin indi')
  t.ok(r.hata.includes(`HATA: anlık görüntüden kaynak dizini inmedi: noble/main (${SNAP})`), r.hata)
  t.absent(r.cagrilar.some((c) => c.includes('source')), 'kaynak indirilmeye başlanmadı')
})
