// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Sürüm derleme hattı (RFC-0007 §12.1, RFC-0033 §3, §9 g, h): kanonik ZIP yazıcısı okuyucuyla uyumlu ve yeniden
// üretilebilir; bağların çözülmesi; mimari paketlerinin birleşik imzasız bildirimi ve SHA256SUMS; çevrimdışı imza
// (test kök anahtarıyla) → doğrulama → değiştirilmiş bayt reddi; imzalı paketi yetki yardımcısı açar.
const test = require('brittle')
const fs = require('fs')
const os = require('os')
const path = require('path')
const b4a = require('b4a')
const c = require('compact-encoding')
const sodium = require('sodium-native')
const { zip: { zipOku } } = require('@havenfold/export')
const S = require('../release')
const { zipYazDizin, dosyaListesi } = require('../scripts/zip-write')
const D = require('../scripts/release-build')
const I = require('../scripts/release-sign')
const O = require('../scripts/release-common')
const V = require('./helpers/node-vector')
const { ortam, DEN } = require('./helpers/privilege-env')

const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const gecici = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hf-hat-'))
const yaz = (kok, ad, icerik, kip = 0o644) => {
  fs.mkdirSync(path.dirname(path.join(kok, ad)), { recursive: true })
  fs.writeFileSync(path.join(kok, ad), icerik, { mode: kip })
  fs.chmodSync(path.join(kok, ad), kip)
}
// 64 bit ELF başlığı (e_machine 62 x86-64, 183 aarch64); gövdesi önemsiz
const elf = (makine) => { const b = b4a.alloc(64); b.writeUInt32BE(0x7f454c46, 0); b[4] = 2; b[5] = 1; b.writeUInt16LE(makine, 18); return b }

// pack.sh düzeninde küçük bir paket dizini (çalışma zamanları sahte ELF)
function paketDizini (makine = 62) {
  const d = gecici()
  yaz(d, 'node', elf(makine), 0o755)
  yaz(d, 'bare', elf(makine), 0o755)
  yaz(d, 'bin/havenfold', '#!/bin/sh\nexec "$(dirname "$0")/../node" lib/node/bin/havenfold "$@"\n', 0o755)
  yaz(d, 'cekirdek/kutu.js', "require('../lib/node/box')\n")
  yaz(d, 'lib/core/core/index.js', 'module.exports = 1\n')
  yaz(d, 'lib/node/box.js', "require('@havenfold/core')\n")
  yaz(d, 'lib/node/scripts/x.sh', '#!/bin/sh\n', 0o755)
  yaz(d, 'lib/worklet/persistence.js', "require('@havenfold/core')\n")
  yaz(d, 'lib/node_modules/b4a/index.js', '// b4a\n')
  yaz(d, 'lib/node_modules/b4a/package.json', '{}\n')
  fs.mkdirSync(path.join(d, 'lib/node_modules/@havenfold'), { recursive: true })
  fs.symlinkSync('../../core/core', path.join(d, 'lib/node_modules/@havenfold/core'))
  fs.mkdirSync(path.join(d, 'lib/node_modules/.bin'), { recursive: true })
  fs.symlinkSync('../b4a/index.js', path.join(d, 'lib/node_modules/.bin/b4a'))
  fs.mkdirSync(path.join(d, 'lib/worklet/node_modules/@havenfold'), { recursive: true })
  fs.symlinkSync('../../../core/core', path.join(d, 'lib/worklet/node_modules/@havenfold/core'))
  fs.symlinkSync('../../tools/export-open', path.join(d, 'lib/node_modules/export-open')) // pakette yok: kopuk
  yaz(d, 'yetki/ana.js', "require('./lib/node/privilege-main')\n")
  yaz(d, 'yetki/node', elf(makine), 0o755)
  yaz(d, 'yetki/lib/node/privilege-main.js', '// yetki\n')
  for (const f of ['LICENSE', 'NOTICE', 'LICENSES/MPL-2.0.txt', 'LICENSES/node/LICENSE', 'LICENSES/bare/LICENSE', 'LICENSES/bare/NOTICE']) yaz(d, f, f + '\n')
  return d
}

test('kanonik ZIP: okuyucu açar, iki koşu bayt bayt aynı, sıralı, özet hf/release-pkg/', (t) => {
  const d = gecici()
  yaz(d, 'bin/havenfold', '#!/bin/sh\n', 0o755)
  yaz(d, 'node', 'n', 0o755)
  yaz(d, 'lib/b.js', 'b')
  yaz(d, 'lib/a/ç.js', 'ç'.repeat(3000))
  yaz(d, 'lib/A.txt', 'büyük harf')
  yaz(d, 'lib/bos.txt', '')
  yaz(d, 'lib/calisir.sh', '#!/bin/sh\n', 0o755)
  fs.mkdirSync(path.join(d, 'bos-dizin'))
  const z1 = path.join(d, '..', path.basename(d) + '-1.zip')
  const z2 = path.join(d, '..', path.basename(d) + '-2.zip')
  const r1 = zipYazDizin(d, z1)
  fs.utimesSync(path.join(d, 'lib/b.js'), new Date(2001, 1, 1), new Date(2001, 1, 1)) // zaman damgası arşive girmez
  const r2 = zipYazDizin(d, z2)
  const b1 = fs.readFileSync(z1)
  t.alike(b1, fs.readFileSync(z2), 'aynı dizin → aynı baytlar')
  t.alike(r1.ozet, r2.ozet)
  t.alike(r1.ozet, S.paketOzeti(b1), 'özet hash(hf/release-pkg/, arşiv)')
  t.is(r1.boyut, b1.byteLength)
  const g = zipOku(b1)
  t.alike(g.map((x) => x.ad), ['bin/havenfold', 'lib/A.txt', 'lib/a/ç.js', 'lib/b.js', 'lib/bos.txt', 'lib/calisir.sh', 'node'], 'UTF-8 bayt sırası; boş dizin yok')
  t.is(b4a.toString(g.find((x) => x.ad === 'lib/a/ç.js').bytes), 'ç'.repeat(3000))
  t.alike(r1.izinKaybi, ['lib/calisir.sh'], 'bin/ ve kök çalışma zamanları dışındaki çalıştırılabilir dosya bildirilir')
  t.is(b1.readUInt16LE(10), 0, 'sabit saat')
  t.is(b1.readUInt16LE(12), 0x0021, 'sabit tarih (1980-01-01)')
  fs.symlinkSync('b.js', path.join(d, 'lib/bag.js'))
  t.is(hataOf(() => dosyaListesi(d)), 'ZIP_SYMLINK: lib/bag.js', 'sembolik bağ taşınmaz')
  fs.unlinkSync(path.join(d, 'lib/bag.js'))
  yaz(d, 'lib/aux.js', 'x')
  t.is(hataOf(() => dosyaListesi(d)), 'INVALID_ZIP_NAME: lib/aux.js', 'okuyucunun reddettiği ad yazılmaz')
  for (const f of [d, z1, z2]) fs.rmSync(f, { recursive: true, force: true })
})

test('bağların çözülmesi: .bin silinir, alt çalışma alanı bağı üste düşer, kopuk bağ silinir, dışarısı reddedilir', (t) => {
  const d = paketDizini()
  const u = D.bagCoz(d)
  t.alike(u, ['kopuk bağ silindi: lib/node_modules/export-open'])
  t.ok(fs.lstatSync(path.join(d, 'lib/node_modules/@havenfold/core')).isDirectory(), 'üst düzey bağ kopyalandı')
  t.is(fs.readFileSync(path.join(d, 'lib/node_modules/@havenfold/core/index.js'), 'utf8'), 'module.exports = 1\n')
  t.absent(fs.existsSync(path.join(d, 'lib/worklet/node_modules/@havenfold/core')), 'worklet aramayı lib/node_modules\'ta sürdürür')
  t.absent(fs.existsSync(path.join(d, 'lib/node_modules/.bin/b4a')))
  t.is(dosyaListesi(d).length, 20, 'bağ kalmadı (14 kod ve çalışma zamanı, 6 lisans)')
  fs.symlinkSync('/etc/passwd', path.join(d, 'lib/disari'))
  t.is(hataOf(() => D.bagCoz(d)), 'LINK_OUTSIDE: lib/disari')
  fs.rmSync(d, { recursive: true, force: true })
})

// Derleme → birleştirme → imza → doğrulama
function derle (t, k) {
  const cikti = gecici()
  const ortak = { surum: '1.2.3', kanal: 'kararli', 'yayin-zamani': '1761300000000', 'url-taban': 'https://ornek.invalid/v1.2.3', 'min-from': '1000000' }
  const sonuc = {}
  for (const [arch, makine] of [['amd64', 62], ['arm64', 183]]) {
    const pd = paketDizini(makine)
    sonuc[arch] = D.paket({ ...ortak, arch, cikti: path.join(cikti, arch), 'paket-dizini': pd, ...k })
    fs.rmSync(pd, { recursive: true, force: true })
  }
  return { cikti, sonuc, ortak }
}

test('paket: ZIP, imzasız bildirim, SHA256SUMS; yanlış mimarideki çalışma zamanı reddedilir', (t) => {
  const { cikti, sonuc, ortak } = derle(t)
  const a = sonuc.amd64
  t.is(a.ad, 'havenfold-node-1.2.3-amd64.zip')
  t.alike(a.uyarilar, ['kopuk bağ silindi: lib/node_modules/export-open', 'açılınca 0644 olacak 2 çalıştırılabilir dosya (ör. lib/node/scripts/x.sh, yetki/node)'])
  const zip = fs.readFileSync(path.join(cikti, 'amd64', a.ad))
  t.is(b4a.toString(S.paketOzeti(zip), 'hex'), a.ozet)
  const m = O.govdeCoz(fs.readFileSync(path.join(cikti, 'amd64', D.BILDIRIM)))
  t.is(m.versionCode, 1002003)
  t.is(m.keyEpoch, 0, 'kök durumu verilmedi: imzalamada doldurulur')
  t.alike(m.packages.map((p) => [p.os, p.arch, p.name, p.size, b4a.toString(p.digest, 'hex'), p.urls]), [['linux', 'amd64', a.ad, zip.byteLength, a.ozet, ['https://ornek.invalid/v1.2.3/' + a.ad]]])
  t.is(fs.readFileSync(path.join(cikti, 'amd64/SHA256SUMS'), 'utf8'), require('crypto').createHash('sha256').update(zip).digest('hex') + '  ' + a.ad + '\n')
  // Aynı girdi → aynı paket ve aynı bildirim (yeniden üretilebilir)
  const ikinci = derle(t)
  t.is(ikinci.sonuc.amd64.ozet, a.ozet)
  t.is(ikinci.sonuc.arm64.bildirimOzeti, sonuc.arm64.bildirimOzeti)
  fs.rmSync(ikinci.cikti, { recursive: true, force: true })
  const pd = paketDizini(183)
  t.is(hataOf(() => D.paket({ ...ortak, arch: 'amd64', cikti: path.join(cikti, 'x'), 'paket-dizini': pd })), 'BINARY_ARCH_MISMATCH: node: arm64, beklenen amd64')
  fs.rmSync(pd, { recursive: true, force: true })
  fs.rmSync(cikti, { recursive: true, force: true })
})

test('lisanslar: pack.sh çalışma zamanlarının ve Havenfold\'un metinlerini koyar; eksikse paket derlenmez', (t) => {
  // runtime.sh düzeni (ikili.LICENSE yanında) ve npm/resmî arşiv düzeni (../LICENSE, ../NOTICE)
  const k = gecici()
  t.teardown(() => fs.rmSync(k, { recursive: true, force: true }))
  yaz(k, 'cz/node', elf(62), 0o755)
  yaz(k, 'cz/node.LICENSE', 'Node.js lisansı\n')
  yaz(k, 'bare-runtime-linux-x64/bin/bare', elf(62), 0o755)
  yaz(k, 'bare-runtime-linux-x64/LICENSE', 'Bare lisansı\n')
  yaz(k, 'bare-runtime-linux-x64/NOTICE', 'Bare bildirimi\n')
  const hedef = path.join(k, 'paket')
  const DEPO = path.join(__dirname, '../..')
  const r = require('child_' + 'process').spawnSync('bash', [path.join(DEPO, 'node/scripts/pack.sh'), hedef, '--bagla'], {
    encoding: 'utf8', env: { ...process.env, HF_NODE_BIN: path.join(k, 'cz/node'), HF_BARE_BIN: path.join(k, 'bare-runtime-linux-x64/bin/bare') }
  })
  t.is(r.status, 0, r.stderr)
  t.absent(/lisans metni yok/.test(r.stderr), r.stderr)
  t.is(fs.readFileSync(path.join(hedef, 'LICENSES/node/LICENSE'), 'utf8'), 'Node.js lisansı\n')
  t.is(fs.readFileSync(path.join(hedef, 'LICENSES/bare/LICENSE'), 'utf8'), 'Bare lisansı\n')
  t.is(fs.readFileSync(path.join(hedef, 'LICENSES/bare/NOTICE'), 'utf8'), 'Bare bildirimi\n')
  t.ok(fs.readFileSync(path.join(hedef, 'LICENSE'), 'utf8').length > 0)
  t.ok(fs.existsSync(path.join(hedef, 'NOTICE')) && fs.existsSync(path.join(hedef, 'LICENSES/MPL-2.0.txt')))

  const cikti = gecici()
  t.teardown(() => fs.rmSync(cikti, { recursive: true, force: true }))
  for (const eksik of ['LICENSES/node/LICENSE', 'LICENSES/bare/NOTICE', 'NOTICE']) {
    const pd = paketDizini()
    fs.rmSync(path.join(pd, eksik))
    t.is(hataOf(() => D.paket({ surum: '1.2.3', kanal: 'kararli', arch: 'amd64', 'yayin-zamani': '1761300000000', cikti, 'paket-dizini': pd })), 'NO_LICENSE: ' + eksik)
    fs.rmSync(pd, { recursive: true, force: true })
  }
})

test('imaj satırı ve birleştirme: tek bildirim, mimariye göre sıralı paketler, SHA256SUMS bütün dosyaları kapsar', (t) => {
  const { cikti, sonuc, ortak } = derle(t)
  const ib = path.join(__dirname, '../../images/task-ocr/imaj-bildirimi.json')
  yaz(cikti, 'hf-task-ocr-1.0.0-amd64.tar', 'oci arşivi')
  yaz(cikti, 'hf.task.ocr-1.0.0-amd64-kaynak.tar', 'kaynak')
  const imaj = { 'imaj-bildirimi': ib, arch: 'amd64', 'oci-digest': 'sha256:' + 'ab'.repeat(32), arsiv: path.join(cikti, 'hf-task-ocr-1.0.0-amd64.tar'), cikti: path.join(cikti, 'imaj-amd64.json'), 'url-taban': ortak['url-taban'] }
  t.is(hataOf(() => D.imajSatiri(imaj)), 'NO_SOURCE_ARCHIVE: hf.task.ocr kaynak arşivi ister (--kaynak)', 'AGPL araçlı imaj kaynak arşivsiz olmaz')
  const satir = D.imajSatiri({ ...imaj, kaynak: path.join(cikti, 'hf.task.ocr-1.0.0-amd64-kaynak.tar') })
  t.is(satir.type, 'hf.task.ocr')
  t.is(satir.ramMB, 1024)
  t.alike(satir.archive.digest, S.paketOzeti(b4a.from('oci arşivi')))
  t.alike(satir.policy, { ekip: true, kisiOlcer: false, yuz: false, plaka: false })
  const bir = path.join(cikti, 'bir')
  const arg = { bildirim: ['arm64', 'amd64'].map((x) => path.join(cikti, x, D.BILDIRIM)), imaj: [imaj.cikti], sums: ['arm64', 'amd64'].map((x) => path.join(cikti, x, 'SHA256SUMS')), cikti: bir }
  const r = D.birlestir(arg)
  t.alike(r.paketler, ['amd64', 'arm64'])
  t.alike(r.imajlar, ['hf.task.ocr/amd64'])
  const m = O.govdeCoz(fs.readFileSync(path.join(bir, D.BILDIRIM)))
  t.alike(m.packages.map((p) => b4a.toString(p.digest, 'hex')), [sonuc.amd64.ozet, sonuc.arm64.ozet])
  t.is(m.images[0].sourceArchive.name, 'hf.task.ocr-1.0.0-amd64-kaynak.tar')
  t.alike([...O.sumsCoz(fs.readFileSync(path.join(bir, 'SHA256SUMS'), 'utf8')).keys()], ['havenfold-node-1.2.3-amd64.zip', 'havenfold-node-1.2.3-arm64.zip', 'hf-task-ocr-1.0.0-amd64.tar', 'hf.task.ocr-1.0.0-amd64-kaynak.tar'])
  t.is(hataOf(() => D.birlestir({ ...arg, bildirim: [arg.bildirim[0], arg.bildirim[0]], cikti: path.join(cikti, 'y') })), 'DUPLICATE_PACKAGE: linux/arm64')
  t.is(hataOf(() => D.birlestir({ ...arg, sums: [arg.sums[0]], cikti: path.join(cikti, 'y') })), 'SHA256SUMS_INCOMPLETE: havenfold-node-1.2.3-amd64.zip')
  // Başka sürümün bildirimi birleşmez
  const pd = paketDizini()
  D.paket({ ...ortak, surum: '1.2.4', arch: 'amd64', cikti: path.join(cikti, 'baska'), 'paket-dizini': pd })
  fs.rmSync(pd, { recursive: true, force: true })
  t.ok(/^MANIFEST_MISMATCH/.test(hataOf(() => D.birlestir({ ...arg, bildirim: [arg.bildirim[0], path.join(cikti, 'baska', D.BILDIRIM)], cikti: path.join(cikti, 'y') }))))
  fs.rmSync(cikti, { recursive: true, force: true })
})

test('çevrimdışı imza: test kökü → doğrulama; değiştirilmiş bayt, başka anahtar ve başka SHA256SUMS reddedilir', (t) => {
  const { cikti } = derle(t)
  const bir = path.join(cikti, 'bir')
  D.birlestir({ bildirim: ['amd64', 'arm64'].map((x) => path.join(cikti, x, D.BILDIRIM)), imaj: [], sums: ['amd64', 'arm64'].map((x) => path.join(cikti, x, 'SHA256SUMS')), cikti: bir })
  const kokDurum = path.join(cikti, 'kok.durum')
  fs.writeFileSync(kokDurum, c.encode(S.kokDurumuEnc, V.KOK_DURUMU))
  const anahtar = path.join(cikti, 'kok.anahtar')
  fs.writeFileSync(anahtar, V.KOK.sk, { mode: 0o600 })
  const ortak = { bildirim: path.join(bir, I.IMZASIZ), 'kok-durum': kokDurum, sums: path.join(bir, 'SHA256SUMS') }

  // 1) Yerelde imza (--anahtar)
  const r = I.imzala({ ...ortak, anahtar, cikti: path.join(cikti, 'imzali') })
  t.ok(r.dolduruldu, 'keyEpoch ve nextRootHash kök durumundan')
  t.absent(r.uyari)
  t.absent(JSON.stringify(r).includes(b4a.toString(V.KOK.sk, 'hex').slice(0, 32)), 'anahtar çıktıya girmez')
  const imzali = fs.readFileSync(path.join(cikti, 'imzali/havenfold-node.bildirim'))
  const { m } = S.bildirimCoz(imzali, V.KOK_DURUMU)
  t.is(m.keyEpoch, 1)
  t.alike(m.nextRootHash, V.KOK_DURUMU.nextRootHash)
  const sums = fs.readFileSync(path.join(cikti, 'imzali/SHA256SUMS'))
  const sumsSig = fs.readFileSync(path.join(cikti, 'imzali/SHA256SUMS.sig'))
  t.ok(sodium.crypto_sign_verify_detached(sumsSig, sums, V.KOK.pk), 'SHA256SUMS.sig kökle geçerli')
  t.ok(fs.readFileSync(path.join(cikti, 'imzali/kok-acik.pem'), 'utf8').startsWith('-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA'))

  // 2) Değiştirilmiş bayt
  for (const i of [5, imzali.byteLength - 70, imzali.byteLength - 1]) {
    const bozuk = b4a.from(imzali)
    bozuk[i] ^= 1
    t.ok(['SIGNATURE_ERROR', 'FORMAT_ERROR'].includes(hataOf(() => S.bildirimCoz(bozuk, V.KOK_DURUMU))), 'bayt ' + i)
  }
  const bozukSums = b4a.from(sums)
  bozukSums[0] = bozukSums[0] === 0x61 ? 0x62 : 0x61
  t.absent(sodium.crypto_sign_verify_detached(sumsSig, bozukSums, V.KOK.pk), 'SHA256SUMS değişince imza geçmez')

  // 3) Dışarıda imza: hazirla → imzalanacak baytlar → (Ed25519) → birlestir
  const h = I.hazirla({ ...ortak, cikti: path.join(cikti, 'disari') })
  t.ok(h.ozet.includes('kök dönemi 1'))
  const imzalanacak = fs.readFileSync(path.join(cikti, 'disari/bildirim.imzalanacak'))
  t.is(imzalanacak.byteLength, 32)
  const sig = b4a.alloc(64)
  sodium.crypto_sign_detached(sig, imzalanacak, V.KOK.sk)
  fs.writeFileSync(path.join(cikti, 'disari/bildirim.imza'), b4a.toString(sig, 'hex') + '\n') // onaltılık da olur
  fs.writeFileSync(path.join(cikti, 'disari/SHA256SUMS.sig'), sumsSig)
  const dis = { bildirim: path.join(cikti, 'disari', I.IMZASIZ), imza: path.join(cikti, 'disari/bildirim.imza'), 'kok-durum': kokDurum, sums: path.join(cikti, 'disari/SHA256SUMS'), 'sums-imza': path.join(cikti, 'disari/SHA256SUMS.sig') }
  I.birlestir({ ...dis, cikti: path.join(cikti, 'disari/cikti') })
  t.alike(fs.readFileSync(path.join(cikti, 'disari/cikti/havenfold-node.bildirim')), imzali, 'iki yol aynı imzalı bildirimi verir (Ed25519 belirlenimci)')
  t.is(hataOf(() => I.birlestir({ ...dis, 'sums-imza': path.join(cikti, 'disari/bildirim.imza'), cikti: path.join(cikti, 'y') })), 'SIGNATURE_ERROR: SHA256SUMS.sig')
  fs.writeFileSync(path.join(cikti, 'kotu.imza'), b4a.alloc(64, 1))
  t.is(hataOf(() => I.birlestir({ ...dis, imza: path.join(cikti, 'kotu.imza'), cikti: path.join(cikti, 'y') })), 'SIGNATURE_ERROR')
  t.absent(fs.existsSync(path.join(cikti, 'y')), 'doğrulanmayan hiçbir şey yazılmaz')

  // 4) Başka anahtar; tohum ve PEM biçimleri
  const sahte = path.join(cikti, 'sahte.anahtar')
  fs.writeFileSync(sahte, b4a.alloc(32, 7), { mode: 0o600 })
  t.is(hataOf(() => I.imzala({ ...ortak, anahtar: sahte, cikti: path.join(cikti, 'y') })), 'ROOT_MISMATCH: anahtar kök durumundaki rootPub değil')
  const pem = path.join(cikti, 'kok.pem')
  const der = b4a.concat([b4a.from('302e020100300506032b657004220420', 'hex'), V.KOK.sk.subarray(0, 32)])
  fs.writeFileSync(pem, '-----BEGIN PRIVATE KEY-----\n' + b4a.toString(der, 'base64') + '\n-----END PRIVATE KEY-----\n', { mode: 0o644 })
  const p = I.imzala({ ...ortak, anahtar: pem, cikti: path.join(cikti, 'pem') })
  t.ok(p.uyari && p.uyari.includes('chmod 600'), 'başkalarına açık anahtar dosyası uyarılır')
  t.alike(fs.readFileSync(path.join(cikti, 'pem/havenfold-node.bildirim')), imzali, 'PEM tohumu aynı anahtar')
  // Kök alanları dolu ve farklı gövde imzalanmaz
  const baskaKok = path.join(cikti, 'baska.durum')
  fs.writeFileSync(baskaKok, c.encode(S.kokDurumuEnc, { ...V.KOK_DURUMU, keyEpoch: 2 }))
  t.ok(/^ROOT_MISMATCH/.test(hataOf(() => I.hazirla({ ...ortak, bildirim: path.join(cikti, 'disari', I.IMZASIZ), 'kok-durum': baskaKok, cikti: path.join(cikti, 'y') }))))
  fs.rmSync(cikti, { recursive: true, force: true })
})

test('uçtan uca: derlenen ve imzalanan paketi yetki yardımcısı paket-ac ile açar', async (t) => {
  const o = ortam()
  const cikti = gecici()
  const pd = paketDizini()
  const r = D.paket({ surum: '1.2.3', kanal: 'kararli', arch: 'amd64', 'yayin-zamani': '1761300000000', cikti, 'paket-dizini': pd, 'min-from': '1000000' })
  fs.rmSync(pd, { recursive: true, force: true })
  fs.writeFileSync(path.join(cikti, 'kok.durum'), c.encode(S.kokDurumuEnc, V.KOK_DURUMU))
  fs.writeFileSync(path.join(cikti, 'kok.anahtar'), V.KOK.sk, { mode: 0o600 })
  I.imzala({ bildirim: path.join(cikti, I.IMZASIZ), anahtar: path.join(cikti, 'kok.anahtar'), 'kok-durum': path.join(cikti, 'kok.durum'), cikti: path.join(cikti, 'imzali') })
  fs.copyFileSync(path.join(cikti, r.ad), path.join(o.onb, '1.2.3.zip'))
  fs.copyFileSync(path.join(cikti, 'imzali/havenfold-node.bildirim'), path.join(o.onb, '1.2.3.bildirim'))
  const sonuc = await o.y.isle(DEN, 'paket-ac', { surum: '1.2.3', dosya: 'var/lib/havenfold/denetci/onbellek/1.2.3.zip', ozet: r.ozet, bildirim: 'var/lib/havenfold/denetci/onbellek/1.2.3.bildirim' })
  t.alike(sonuc, { dizin: 'opt/havenfold/surumler/1.2.3' })
  const s = path.join(o.kok, 'opt/havenfold/surumler/1.2.3')
  t.is(fs.statSync(path.join(s, 'bin/havenfold')).mode & 0o777, 0o755)
  t.is(fs.statSync(path.join(s, 'node')).mode & 0o777, 0o755)
  t.is(fs.statSync(path.join(s, 'lib/node/box.js')).mode & 0o777, 0o644)
  t.is(fs.readFileSync(path.join(s, 'lib/node_modules/@havenfold/core/index.js'), 'utf8'), 'module.exports = 1\n')
  o.sil()
  fs.rmSync(cikti, { recursive: true, force: true })
})
