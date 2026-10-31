// SPDX-License-Identifier: Apache-2.0
const test = require('brittle')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { ac, baslik, zipOku } = require('../open')
const F = require('../../../protocol/vectors/export.json')

const buf = (h) => Buffer.from(h, 'hex')
const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const bozukBayt = (d) => d.bayt ? buf(d.bayt) : Buffer.concat([buf(F.tam.kap).subarray(0, d.kesim.bas), buf(d.kesim.ek)])

test('export-open: vektörlerdeki kabı kütüphaneden bağımsız açar; bozuk kopyalarda aynı hata', (t) => {
  const { icerik, baslik: h } = ac(buf(F.v1.kap), F.parola)
  t.is(icerik.toString('hex'), F.v1.zip)
  t.is(h.urun, 'yuva-defteri')
  t.alike(zipOku(icerik).map((g) => g.ad), ['icerik.json', 'dosyalar/fatura.txt', 'BENIOKU.txt'])
  t.is(ac(buf(F.tam.kap), F.parola).icerik.length, 131072)
  for (const d of F.bozuk) t.is(hataOf(() => ac(bozukBayt(d), d.parola || F.parola)), d.hata, d.aciklama)
})

test('export-open: komut satırı — başlık, açma, yanlış parola, dolu hedef', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-open-'))
  const dosya = path.join(dir, 'aile.yuvadefter')
  fs.writeFileSync(dosya, buf(F.v1.kap))
  const calis = (args, girdi) => spawnSync(process.execPath, [path.join(__dirname, '..', 'export-open.js'), ...args], { input: girdi, encoding: 'utf8' })
  for (const bayrak of ['--header', '--baslik']) {
    const b = calis([bayrak, dosya])
    t.is(b.status, 0, bayrak)
    t.is(JSON.parse(b.stdout).bicim, 'yuva-defter-arsiv', bayrak)
  }
  const y = calis([dosya, path.join(dir, 'y')], 'yanlis-parola-1234\n')
  t.is(y.status, 1)
  t.ok(y.stderr.includes('Parola yanlış'))
  const r = calis([dosya, path.join(dir, 'acik')], F.parola + '\n')
  t.is(r.status, 0, r.stderr)
  t.is(fs.readFileSync(path.join(dir, 'acik', 'dosyalar', 'fatura.txt'), 'utf8'), 'Elektrik faturası, Ekim')
  t.ok(fs.existsSync(path.join(dir, 'acik', 'BENIOKU.txt')))
  t.is(calis([dosya, path.join(dir, 'acik')], F.parola + '\n').status, 2)
  t.is(calis([]).status, 2)
  t.alike(baslik(buf(F.v1.kap)).baslik, F.v1.baslik)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('export-open: 0600/0700 izinleri, tekrar eden ad, zip bombası, başlık hata yolları, parola girişi', (t) => {
  const K = require('../../../core/export/export')
  const { zipYaz } = require('../../../core/export/zip')
  const { cikar, parolaIsle, ilkSatir } = require('../export-open')
  const HIZLI = { urun: 'u', bicim: 'b', opslimit: 3, memlimit: 64 * 1024 * 1024 }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-open-'))
  const dosya = path.join(dir, 'k.hfkap')
  fs.writeFileSync(dosya, K.kapla(zipYaz([{ ad: 'a/b.txt', bytes: Buffer.from('gizli') }]), 'uzun-bir-parola-123', HIZLI))
  cikar(dosya, path.join(dir, 'o'), 'uzun-bir-parola-123')
  t.is(fs.statSync(path.join(dir, 'o', 'a', 'b.txt')).mode & 0o777, 0o600)
  t.is(fs.statSync(path.join(dir, 'o', 'a')).mode & 0o777, 0o700)
  t.absent(fs.readdirSync(path.join(dir, 'o')).some((x) => x.startsWith('.export-open-')), 'geçici dosya silindi')
  // Tekrar eden ad (büyük/küçük harf): ZIP'i elle kurup kapla
  const z = Buffer.from(zipYaz([{ ad: 'A.txt', bytes: Buffer.from('1') }, { ad: 'b.txt', bytes: Buffer.from('2') }]))
  const i = z.lastIndexOf(Buffer.from('b.txt'))
  z.write('a.txt', i)
  const j = z.indexOf(Buffer.from('b.txt'))
  z.write('a.txt', j)
  fs.writeFileSync(dosya, K.kapla(z, 'uzun-bir-parola-123', HIZLI))
  t.is(hataOf(() => cikar(dosya, path.join(dir, 'p'), 'uzun-bir-parola-123')), 'INVALID_ZIP_NAME')
  // Başlık: null JSON ve dolgusuz salt
  const on = (h) => { const hb = Buffer.from(h); const u = Buffer.alloc(4); u.writeUInt32BE(hb.length); return Buffer.concat([Buffer.from('HFKAP'), Buffer.from([1]), u, hb, Buffer.alloc(24)]) }
  t.is(hataOf(() => baslik(on('null'))), 'INVALID_EXPORT')
  const h = { ...baslik(buf(F.v1.kap)).baslik }
  t.is(hataOf(() => baslik(on(JSON.stringify({ ...h, salt: h.salt.replace(/=+$/, '') })))), 'INVALID_EXPORT')
  // Parola girişi: satır sonu eklenmez, silme kod noktası siler
  t.is(ilkSatir('parola-12345\r\n'), 'parola-12345')
  t.alike(parolaIsle('a😀', '\u007f'), { p: 'a', bitti: false })
  t.alike(parolaIsle('', 'abc\r'), { p: 'abc', bitti: true })
  fs.rmSync(dir, { recursive: true, force: true })
})

test('export-open inceleme 6: üst üste binen girdi, yerel ad, yarım çıktı yok, var olan hedef, denetim karakteri', (t) => {
  const K = require('../../../core/export/export')
  const { zipYaz } = require('../../../core/export/zip')
  const { cikar, temiz } = require('../export-open')
  const HIZLI = { urun: 'u', bicim: 'b', opslimit: 3, memlimit: 64 * 1024 * 1024 }
  const V2 = require('../../../protocol/vectors/export-v2.json')
  for (const d of V2.zip) t.is(hataOf(() => zipOku(buf(d.zip))), d.hata, d.aciklama)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-open-'))
  const dosya = path.join(dir, 'k.hfkap')
  // İkinci girdinin CRC'si bozuk: hiçbir dosya kalmaz
  const z = Buffer.from(zipYaz([{ ad: 'a.txt', bytes: Buffer.from('1') }, { ad: 'b.txt', bytes: Buffer.from('2') }]))
  const i = z.lastIndexOf(Buffer.from('2'))
  z[i] = 0x33
  fs.writeFileSync(dosya, K.kapla(z, 'uzun-bir-parola-123', HIZLI))
  t.is(hataOf(() => cikar(dosya, path.join(dir, 'o'), 'uzun-bir-parola-123')), 'ZIP_CHECKSUM')
  t.absent(fs.existsSync(path.join(dir, 'o')))
  t.alike(fs.readdirSync(dir).filter((x) => x.startsWith('.export-open-')), [], 'geçici klasör silindi')
  // Var olan hedef (boş da olsa) reddedilir
  fs.mkdirSync(path.join(dir, 'var'))
  t.is(hataOf(() => cikar(dosya, path.join(dir, 'var'), 'uzun-bir-parola-123')), 'TARGET_EXISTS')
  t.is(temiz('a\u001b[31mb\u0007'), 'a[31mb')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('export-open --baslik: doğrulanmamış başlıktaki C1 denetim ve yön karakterleri terminale gitmez (Codex 12. tur)', (t) => {
  const { temiz } = require('../export-open')
  t.is(temiz('a\u009b31mb\u202ec\u2066d\u200fe'), 'a31mbcde')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-open-'))
  t.teardown(() => fs.rmSync(dir, { recursive: true, force: true }))
  const asil = buf(F.v1.kap)
  const uz = asil.readUInt32BE(6)
  const h = JSON.parse(asil.subarray(10, 10 + uz).toString('utf8'))
  const hb = Buffer.from(JSON.stringify({ ...h, urun: 'yuva\u009b2J\u202edefteri' }))
  const u = Buffer.alloc(4)
  u.writeUInt32BE(hb.length)
  const dosya = path.join(dir, 'k.hfkap')
  fs.writeFileSync(dosya, Buffer.concat([asil.subarray(0, 6), u, hb, asil.subarray(10 + uz)]))
  const b = spawnSync(process.execPath, [path.join(__dirname, '..', 'export-open.js'), '--baslik', dosya], { encoding: 'utf8' })
  t.is(b.status, 0, b.stderr)
  t.absent(/[\u0080-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(b.stdout), 'çıktıda C1 ya da yön karakteri yok')
  t.is(JSON.parse(b.stdout).urun, 'yuva2Jdefteri')
})
