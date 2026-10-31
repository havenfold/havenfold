#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// release-build.js — düğüm sürümünün derleme hattı: paket, imaj satırı, birleşik imzasız bildirim (RFC-0007 §12.1, §16;
// RFC-0033 §3, §9 g, h). Kök anahtar yok: bildirim imzasız çıkar, imzayı Kerem çevrimdışı atar (release-sign.js).
//
//   paket        --surum X.Y.Z --kanal kararli|deneme --arch amd64|arm64 --node <ikili> --bare <ikili> --cikti <dizin>
//                [--kok-durum F] [--url-taban URL] [--yayin-zamani ms] [--min-from N] [--acil] [--notlar F]
//                [--deb-dizini D] [--paket-dizini D]
//       node/scripts/pack.sh ile paket dizini (ya da --paket-dizini ile hazır dizin), bağların çözülmesi, kanonik ZIP
//       (havenfold-node-<sürüm>-<arch>.zip), hash('hf/release-pkg/', …) özeti; çıktı dizinine ZIP, imzasız bildirim
//       gövdesi (havenfold-node.bildirim.imzasiz), okunur kopyası (havenfold-node.bildirim.json) ve SHA256SUMS.
//   imaj-satiri  --imaj-bildirimi images/<tür>/imaj-bildirimi.json --arch A --oci-digest sha256:… --arsiv F
//                [--kaynak F] [--url-taban URL] --cikti satir.json
//       Bildirimin images satırı (oci-archive ve kaynak arşivinin adı, boyutu, özeti). "sourceArchive": true olan
//       imajda kaynak arşivi zorunlu (kurucu §17.1).
//   birlestir    --bildirim F [--bildirim F …] [--imaj satir.json …] [--sums F …] --cikti <dizin>
//       Mimarilerin imzasız bildirimlerini tek bildirimde birleştirir (paket satırları mimariye göre sıralı), imaj
//       satırlarını ekler, SHA256SUMS parçalarını birleştirir. Paketler ve imaj arşivleri SHA256SUMS'ta olmalı.
//
// Bildirimin keyEpoch ve nextRootHash alanları --kok-durum verilmezse 0 ve 32 sıfırdır; release-sign.js hazirla
// Kerem'in kök durumuyla doldurur. publishedAt: --yayin-zamani, yoksa SOURCE_DATE_EPOCH, yoksa son kaydın zamanı
// (aynı kayıttan aynı bildirim). URL'ler: <url-taban>/<dosya adı>.
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const b4a = require('b4a')
const c = require('compact-encoding')
const S = require('../release')
const { zipYazDizin } = require('./zip-write')
const O = require('./release-common')

const { fail, hex } = O
const DEPO = path.join(__dirname, '../..')
const MIMARILER = ['amd64', 'arm64']
const ELF_MAKINE = { 62: 'amd64', 183: 'arm64' } // e_machine: EM_X86_64, EM_AARCH64
const LISANSLAR = ['LICENSE', 'NOTICE', 'LICENSES/MPL-2.0.txt', 'LICENSES/node/LICENSE', 'LICENSES/bare/LICENSE', 'LICENSES/bare/NOTICE']
const PAKET_MAX = 1 << 30 // privilege-helper.js PAKET_MAX: düğüm daha büyüğünü açmaz
const OZET_RE = /^sha256:[0-9a-f]{64}$/
const TUR_RE = /^[a-z][a-z0-9.-]*$/
const BILDIRIM = 'havenfold-node.bildirim.imzasiz'

// --- Bağların çözülmesi ----------------------------------------------------------------------------------------

// ZIP sembolik bağ taşımaz (okuyucu yalnız düzenli dosya açar). pack.sh'ın kopyası npm'in bağlarını taşır:
//   node_modules/.bin/*                     → silinir (çalışma anında gerekmez)
//   alt node_modules'taki çalışma alanı bağı → üstteki node_modules'ta aynı ad varsa silinir: Node aramayı üst dizinde
//                                             sürdürür, modül tek kopyadan tek kez yüklenir (geliştirme düzenindeki
//                                             realpath davranışıyla aynı)
//   diğer bağlar (lib/node_modules/@havenfold/core → ../../core/core) → hedefin kopyası
//   kopuk bağ (pakete girmeyen tools/export-open gibi) → silinir, uyarı
//   paketin dışını gösteren bağ               → LINK_OUTSIDE
function ilkBag (kok, goreli = '') {
  for (const ad of fs.readdirSync(path.join(kok, goreli)).sort()) {
    const g = goreli ? goreli + '/' + ad : ad
    const st = fs.lstatSync(path.join(kok, g))
    if (st.isSymbolicLink()) return g
    if (st.isDirectory()) { const b = ilkBag(kok, g); if (b) return b }
  }
  return null
}

function ustteVar (kok, parcalar) {
  const i = parcalar.lastIndexOf('node_modules')
  if (i < 0) return false
  const ad = parcalar.slice(i + 1)
  if (!(ad.length === 1 || (ad.length === 2 && ad[0].startsWith('@')))) return false
  for (let d = parcalar.slice(0, i); d.length > 0;) {
    d = d.slice(0, -1)
    if (d[d.length - 1] === 'node_modules') continue
    try { fs.lstatSync(path.join(kok, ...d, 'node_modules', ...ad)); return true } catch {}
  }
  return false
}

function bagCoz (kok) {
  kok = path.resolve(kok)
  const uyarilar = []
  for (let b = ilkBag(kok); b; b = ilkBag(kok)) {
    const tam = path.join(kok, b)
    const parcalar = b.split('/')
    const k = parcalar.findIndex((p, i) => (p === '.bin' || p === '.hf-bin') && parcalar[i - 1] === 'node_modules')
    if (k > 0) { fs.unlinkSync(tam); continue }
    const hedef = path.resolve(path.dirname(tam), fs.readlinkSync(tam))
    if (hedef !== kok && !hedef.startsWith(kok + path.sep)) fail('LINK_OUTSIDE', b)
    if (tam.startsWith(hedef + path.sep)) fail('LINK_LOOP', b)
    if (!fs.existsSync(hedef)) { fs.unlinkSync(tam); uyarilar.push('kopuk bağ silindi: ' + b); continue }
    fs.unlinkSync(tam)
    if (ustteVar(kok, parcalar)) continue
    fs.cpSync(hedef, tam, { recursive: true, dereference: true })
  }
  return uyarilar
}

// --- Yardımcılar -----------------------------------------------------------------------------------------------

function elfMimari (yol) {
  const b = b4a.alloc(20)
  const fd = fs.openSync(yol, 'r')
  try { if (fs.readSync(fd, b, 0, 20, 0) < 20) return null } finally { fs.closeSync(fd) }
  if (b.readUInt32BE(0) !== 0x7f454c46 || b[4] !== 2) return null // ELF, 64 bit
  return ELF_MAKINE[b[5] === 1 ? b.readUInt16LE(18) : b.readUInt16BE(18)] || 'bilinmeyen'
}

function yayinZamani (a) {
  if (a['yayin-zamani'] !== undefined) return tamsayi(a['yayin-zamani'], '--yayin-zamani')
  if (process.env.SOURCE_DATE_EPOCH) return tamsayi(process.env.SOURCE_DATE_EPOCH, 'SOURCE_DATE_EPOCH') * 1000
  const r = spawnSync('git', ['log', '-1', '--format=%ct'], { cwd: DEPO, encoding: 'utf8' })
  if (r.status !== 0 || !/^\d+\n?$/.test(r.stdout)) fail('NO_RELEASE_TIME', '--yayin-zamani ya da SOURCE_DATE_EPOCH')
  return Number(r.stdout.trim()) * 1000
}

function tamsayi (s, ad) {
  if (!/^(0|[1-9]\d*)$/.test(String(s)) || !Number.isSafeInteger(Number(s))) fail('INVALID_ARGUMENT', ad)
  return Number(s)
}

const adres = (taban, ad) => (taban ? [taban.replace(/\/+$/, '') + '/' + ad] : [])

// Kurulum USB'sinin çevrimdışı Ubuntu paketleri (installerDebs): ad, sürüm (dosya adından: <ad>_<sürüm>_<mimari>.deb)
function debListesi (dizin) {
  return fs.readdirSync(dizin).filter((x) => x.endsWith('.deb')).sort().map((ad) => {
    const r = /^[^_]+_([^_]+)_[^_]+\.deb$/.exec(ad)
    if (!r) fail('INVALID_DEB_NAME', ad)
    return { name: ad, version: decodeURIComponent(r[1]), digest: O.dosyaOzetleri(path.join(dizin, ad)).digest }
  })
}

// Pakete geliştirme bağımlılığı girmesin: kök ve worklet kilidinde dev olarak işaretli üst düzey paketler
function gelistirmeBagimliliklari (paketDizini) {
  const out = []
  for (const [kilit, alt] of [['package-lock.json', 'lib'], ['worklet/package-lock.json', 'lib/worklet']]) {
    let l
    try { l = JSON.parse(fs.readFileSync(path.join(DEPO, kilit), 'utf8')).packages } catch { continue }
    for (const [k, v] of Object.entries(l)) {
      if (!v.dev || !k.startsWith('node_modules/') || k.indexOf('/node_modules/', 1) >= 0) continue
      if (fs.existsSync(path.join(paketDizini, alt, k))) out.push(path.join(alt, k))
    }
  }
  return out
}

function temelBildirim (a, surum) {
  const kanal = a.kanal
  if (!S.KANALLAR.includes(kanal)) fail('INVALID_ARGUMENT', '--kanal kararli|deneme')
  const kok = a['kok-durum'] ? O.kokDurumuOku(a['kok-durum']) : null
  const notes = a.notlar ? fs.readFileSync(a.notlar, 'utf8') : ''
  if (b4a.byteLength(notes) > 4096) fail('NOTES_TOO_LARGE', '4 KB')
  return {
    format: 1,
    product: 'havenfold-node',
    version: surum,
    versionCode: S.versionCode(surum),
    channel: kanal,
    publishedAt: yayinZamani(a),
    minFrom: a['min-from'] !== undefined ? tamsayi(a['min-from'], '--min-from') : 0,
    urgent: a.acil === true,
    packages: [],
    images: [],
    assets: [],
    installer: [], // ISO'nun özeti bildirime girmez (RFC-0033 §9 h): ayrı SHA256SUMS
    installerDebs: a['deb-dizini'] ? debListesi(a['deb-dizini']) : [],
    revoked: [],
    catalogKeys: [],
    keyEpoch: kok ? kok.keyEpoch : 0,
    nextRootHash: kok ? kok.nextRootHash : b4a.alloc(32),
    notes
  }
}

function bildirimYaz (cikti, m) {
  const body = c.encode(S.manifestGovde, m)
  fs.writeFileSync(path.join(cikti, BILDIRIM), body, { mode: 0o644 })
  fs.writeFileSync(path.join(cikti, 'havenfold-node.bildirim.json'), O.jsonla({ ...m, imzasiz: true, bildirimOzeti: hex(S.bildirimOzeti(body)) }), { mode: 0o644 })
  return body
}

// --- paket -----------------------------------------------------------------------------------------------------

function paket (a) {
  O.gerekli(a, ['surum', 'kanal', 'arch', 'cikti'])
  const surum = a.surum
  S.versionCode(surum)
  if (!MIMARILER.includes(a.arch)) fail('INVALID_ARGUMENT', '--arch amd64|arm64')
  const m = temelBildirim(a, surum)
  fs.mkdirSync(a.cikti, { recursive: true })
  const sahne = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-surum-'))
  const uyarilar = []
  try {
    let dizin = a['paket-dizini']
    if (!dizin) {
      O.gerekli(a, ['node', 'bare'])
      dizin = path.join(sahne, 'paket')
      const r = spawnSync('bash', [path.join(DEPO, 'node/scripts/pack.sh'), dizin], {
        encoding: 'utf8', env: { ...process.env, HF_NODE_BIN: path.resolve(a.node), HF_BARE_BIN: path.resolve(a.bare) }
      })
      if (r.status !== 0) fail('PACK_FAILED', (r.stderr || '').trim())
      const dev = gelistirmeBagimliliklari(dizin)
      if (dev.length) fail('DEV_DEPENDENCY', dev.slice(0, 5).join(', ') + ' (npm ci --omit=dev)')
    }
    uyarilar.push(...bagCoz(dizin))
    // Çalışma zamanları paketin mimarisinde olmalı (yanlış ikili düğümde açılışta değil burada yakalanır)
    for (const ikili of ['node', 'bare', 'yetki/node']) {
      const p = path.join(dizin, ikili)
      if (!fs.existsSync(p)) fail('NO_BINARY', ikili)
      const ma = elfMimari(p)
      if (ma !== a.arch) fail('BINARY_ARCH_MISMATCH', `${ikili}: ${ma || 'ELF değil'}, beklenen ${a.arch}`)
    }
    // Dağıtılan ikililerin ve Havenfold'un lisans metinleri pakette (Node MIT, Bare Apache-2.0 §4; pack.sh; Codex 12. tur)
    for (const f of LISANSLAR) if (!fs.existsSync(path.join(dizin, f))) fail('NO_LICENSE', f)
    const ad = `havenfold-node-${surum}-${a.arch}.zip`
    const zip = path.join(a.cikti, ad)
    const z = zipYazDizin(dizin, zip)
    if (z.boyut > PAKET_MAX) fail('PACKAGE_TOO_LARGE', `${z.boyut} bayt; düğümün sınırı ${PAKET_MAX}`)
    if (z.izinKaybi.length) uyarilar.push(`açılınca 0644 olacak ${z.izinKaybi.length} çalıştırılabilir dosya (ör. ${z.izinKaybi.slice(0, 3).join(', ')})`)
    const oz = O.dosyaOzetleri(zip)
    if (!b4a.equals(oz.digest, z.ozet) || oz.size !== z.boyut) fail('DIGEST_MISMATCH', 'yazılan ZIP okunurken farklı')
    m.packages = [{ os: 'linux', arch: a.arch, name: ad, size: z.boyut, digest: z.ozet, urls: adres(a['url-taban'], ad) }]
    const body = bildirimYaz(a.cikti, m)
    fs.writeFileSync(path.join(a.cikti, 'SHA256SUMS'), O.sumsYaz(new Map([[ad, oz.sha256]])), { mode: 0o644 })
    return { ad, girdi: z.girdi, boyut: z.boyut, ozet: hex(z.ozet), sha256: oz.sha256, bildirimOzeti: hex(S.bildirimOzeti(body)), uyarilar }
  } finally {
    fs.rmSync(sahne, { recursive: true, force: true })
  }
}

// --- imaj-satiri -----------------------------------------------------------------------------------------------

function imajSatiri (a) {
  O.gerekli(a, ['imaj-bildirimi', 'arch', 'oci-digest', 'arsiv', 'cikti'])
  const ib = JSON.parse(fs.readFileSync(a['imaj-bildirimi'], 'utf8'))
  if (typeof ib.type !== 'string' || !TUR_RE.test(ib.type)) fail('INVALID_IMAGE_MANIFEST', 'type')
  S.versionCode(ib.version)
  if (!MIMARILER.includes(a.arch)) fail('INVALID_ARGUMENT', '--arch amd64|arm64')
  if (!OZET_RE.test(a['oci-digest'])) fail('INVALID_ARGUMENT', '--oci-digest sha256:<64 onaltılık>')
  if (!Number.isSafeInteger(ib.ramMB) || ib.ramMB < 1) fail('INVALID_IMAGE_MANIFEST', 'ramMB')
  const p = ib.policy || {}
  for (const k of ['ekip', 'kisiOlcer', 'yuz', 'plaka']) if (typeof p[k] !== 'boolean') fail('INVALID_IMAGE_MANIFEST', 'policy.' + k)
  if (ib.sourceArchive === true && !a.kaynak) fail('NO_SOURCE_ARCHIVE', ib.type + ' kaynak arşivi ister (--kaynak)')
  const ar = O.dosyaOzetleri(a.arsiv)
  const arAd = path.basename(a.arsiv)
  let sourceArchive = null
  const sums = { [arAd]: ar.sha256 }
  if (a.kaynak) {
    const k = O.dosyaOzetleri(a.kaynak)
    const kAd = path.basename(a.kaynak)
    sourceArchive = { name: kAd, digest: k.digest, urls: adres(a['url-taban'], kAd) }
    sums[kAd] = k.sha256
  }
  const satir = {
    type: ib.type,
    version: ib.version,
    arch: a.arch,
    ociDigest: a['oci-digest'],
    archive: { name: arAd, size: ar.size, digest: ar.digest, urls: adres(a['url-taban'], arAd) },
    sourceArchive,
    ramMB: ib.ramMB,
    policy: { ekip: p.ekip, kisiOlcer: p.kisiOlcer, yuz: p.yuz, plaka: p.plaka }
  }
  c.encode(S.manifestGovde, { ...temelBos(), images: [satir] }) // satır kodlanabilir olmalı
  fs.writeFileSync(a.cikti, O.jsonla({ satir, sha256: sums }), { mode: 0o644 })
  return satir
}

function temelBos () {
  return { format: 1, product: 'havenfold-node', version: '0.0.0', versionCode: 0, channel: 'deneme', publishedAt: 0, minFrom: 0, urgent: false, packages: [], images: [], assets: [], installer: [], installerDebs: [], revoked: [], catalogKeys: [], keyEpoch: 0, nextRootHash: b4a.alloc(32), notes: '' }
}

// JSON satırından (onaltılık özetler) kodlanabilir satır
const bayt32 = (h, ad) => { if (typeof h !== 'string' || !/^[0-9a-f]{64}$/.test(h)) fail('INVALID_IMAGE_LINE', ad); return b4a.from(h, 'hex') }
function satirOku (yol) {
  const { satir: s, sha256 } = JSON.parse(fs.readFileSync(yol, 'utf8'))
  return {
    satir: {
      ...s,
      archive: { ...s.archive, digest: bayt32(s.archive.digest, 'archive.digest') },
      sourceArchive: s.sourceArchive ? { ...s.sourceArchive, digest: bayt32(s.sourceArchive.digest, 'sourceArchive.digest') } : null
    },
    sha256: sha256 || {}
  }
}

// --- birlestir -------------------------------------------------------------------------------------------------

function birlestir (a) {
  O.gerekli(a, ['cikti'])
  if (!a.bildirim.length) fail('MISSING_ARGUMENT', '--bildirim')
  const govdeler = a.bildirim.map((f) => O.govdeCoz(fs.readFileSync(f)))
  // Paket satırları dışında bütün alanlar aynı olmalı (aynı sürüm, kanal, yayın zamanı, kök alanları)
  const ortak = (m) => b4a.toString(c.encode(S.manifestGovde, { ...m, packages: [], images: [] }), 'hex')
  for (const m of govdeler) if (ortak(m) !== ortak(govdeler[0])) fail('MANIFEST_MISMATCH', `${m.version} ${m.channel} ${m.publishedAt}`)
  const packages = govdeler.flatMap((m) => m.packages)
  const anahtar = new Set()
  for (const p of packages) {
    const k = p.os + '/' + p.arch
    if (anahtar.has(k)) fail('DUPLICATE_PACKAGE', k)
    anahtar.add(k)
  }
  packages.sort((x, y) => (x.os + '/' + x.arch < y.os + '/' + y.arch ? -1 : 1))
  const sums = new Map()
  const ekle = (ad, h) => {
    if (sums.has(ad) && sums.get(ad) !== h) fail('SHA256SUMS_CONFLICT', ad)
    sums.set(ad, h)
  }
  for (const f of a.sums) for (const [ad, h] of O.sumsCoz(fs.readFileSync(f, 'utf8'))) ekle(ad, h)
  const images = []
  const imajAnahtar = new Set()
  for (const f of a.imaj) {
    const { satir, sha256 } = satirOku(f)
    const k = satir.type + '@' + satir.version + '/' + satir.arch
    if (imajAnahtar.has(k)) fail('DUPLICATE_IMAGE', k)
    imajAnahtar.add(k)
    images.push(satir)
    for (const [ad, h] of Object.entries(sha256)) ekle(ad, h)
  }
  images.sort((x, y) => (x.type + '/' + x.arch < y.type + '/' + y.arch ? -1 : 1))
  const m = { ...govdeler[0], packages, images }
  // Yayına giden her dosya SHA256SUMS'ta
  for (const ad of [...packages.map((p) => p.name), ...images.map((i) => i.archive.name), ...images.filter((i) => i.sourceArchive).map((i) => i.sourceArchive.name)]) {
    if (!sums.has(ad)) fail('SHA256SUMS_INCOMPLETE', ad)
  }
  fs.mkdirSync(a.cikti, { recursive: true })
  const body = bildirimYaz(a.cikti, m)
  fs.writeFileSync(path.join(a.cikti, 'SHA256SUMS'), O.sumsYaz(sums), { mode: 0o644 })
  return { surum: m.version, kanal: m.channel, paketler: packages.map((p) => p.arch), imajlar: images.map((i) => i.type + '/' + i.arch), bildirimOzeti: hex(S.bildirimOzeti(body)), dosyalar: sums.size }
}

module.exports = { paket, imajSatiri, birlestir, bagCoz, elfMimari, satirOku, BILDIRIM }

if (require.main === module) {
  const [alt, ...arg] = process.argv.slice(2)
  try {
    let r
    if (alt === 'paket') r = paket(O.argumanlar(arg, { bayrak: ['acil'] }))
    else if (alt === 'imaj-satiri') r = imajSatiri(O.argumanlar(arg))
    else if (alt === 'birlestir') r = birlestir(O.argumanlar(arg, { tekrar: ['bildirim', 'imaj', 'sums'] }))
    else {
      console.error('kullanım: release-build.js paket | imaj-satiri | birlestir … (ayrıntı dosyanın başında)')
      process.exit(1)
    }
    for (const u of r.uyarilar || []) console.error('UYARI: ' + u)
    delete r.uyarilar
    console.log(JSON.stringify(r, null, 1))
    if (alt !== 'imaj-satiri') console.log('Bildirim İMZASIZDIR: kök anahtarla çevrimdışı imzalanır (node/scripts/release-sign.js, docs/surum.md).')
  } catch (err) {
    console.error('surum-derle: ' + err.message)
    process.exit(1)
  }
}
