// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D76: gerçek TPM mührü (tpm2-tools). TPM yerine taklit araçlar: birincil anahtar, mühürlü nesnenin oluşturulması,
// yüklenmesi ve açılması. Anahtar yalnız ilk açılışta üretilir; sonraki açılışlar aynı anahtarı TPM'den açar. TPM
// komutları sırası ve ortam (TPM2TOOLS_TCTI) denetlenir. Gerçek TPM'li koşu kurulumdan sonra bu makinede (`havenfold durum`).
const test = require('brittle')
const fs = require('fs')
const os = require('os')
const path = require('path')
const b4a = require('b4a')
const { sistemTpm, tpmGercekMi } = require('../tpm')
const { KutuPaylari } = require('../box-share')
const A = require('../../core/records/test/helpers/family')

const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
function dizin (t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-d76-tpm-'))
  t.teardown(() => fs.rmSync(d, { recursive: true, force: true }))
  return d
}

// TPM taklidi: mühürlü nesne gerçekte TPM'nin anahtarıyla şifrelidir; burada "TPM içi" bir anahtarla XOR'lanır.
// Dosyalar arası taşınan yalnız mühürlü baytlardır; açılmış anahtar dosyaya yazılmaz.
function taklitAraclar () {
  const ic = b4a.alloc(32, 0x5a) // TPM'nin kendi anahtarı (taklit)
  const kayit = []
  const xor = (b) => b4a.from(b.map((x, i) => x ^ ic[i % 32]))
  const arg = (args, ad) => args[args.indexOf(ad) + 1]
  const calistir = (komut, args, { girdi, env }) => {
    const ad = path.basename(komut)
    kayit.push([ad, env.TPM2TOOLS_TCTI])
    if (ad === 'tpm2_createprimary') { fs.writeFileSync(arg(args, '-c'), 'birincil'); return { status: 0, stdout: b4a.alloc(0) } }
    if (ad === 'tpm2_create') {
      if (fs.readFileSync(arg(args, '-C'), 'utf8') !== 'birincil') return { status: 1, stdout: b4a.alloc(0) }
      fs.writeFileSync(arg(args, '-u'), 'pub')
      fs.writeFileSync(arg(args, '-r'), xor(girdi))
      return { status: 0, stdout: b4a.alloc(0) }
    }
    if (ad === 'tpm2_load') { fs.writeFileSync(arg(args, '-c'), fs.readFileSync(arg(args, '-r'))); return { status: 0, stdout: b4a.alloc(0) } }
    if (ad === 'tpm2_unseal') return { status: 0, stdout: xor(fs.readFileSync(arg(args, '-c'))) }
    return { status: 127, stdout: b4a.alloc(0) }
  }
  return { calistir, kayit }
}

test('gerçek TPM: ilk açılışta anahtar mühürlenir, sonra aynı anahtar açılır; mühür kalıcı, açık anahtar diskte yok', (t) => {
  const d = dizin(t)
  const { calistir, kayit } = taklitAraclar()
  const t1 = sistemTpm({ dizin: d, calistir })
  t.ok(tpmGercekMi(t1), 'gerçek TPM nesnesi')
  t.alike(kayit.map((x) => x[0]), ['tpm2_createprimary', 'tpm2_create', 'tpm2_load', 'tpm2_unseal'])
  t.ok(kayit.every((x) => x[1] === 'device:/dev/tpmrm0'), 'TCTI aygıtı')
  t.alike(fs.readdirSync(d).sort(), ['muhur.priv', 'muhur.pub'], 'geçici bağlam dosyaları silindi')
  const muhur = t1.muhurle(b4a.from('pay baytları'))
  kayit.length = 0
  const t2 = sistemTpm({ dizin: d, calistir }) // yeniden başlatma
  t.alike(kayit.map((x) => x[0]), ['tpm2_createprimary', 'tpm2_load', 'tpm2_unseal'], 'anahtar yeniden üretilmez')
  t.alike(t2.ac(muhur), b4a.from('pay baytları'), 'yeniden başlatmada mühür açılır')
  t.is(hataOf(() => t2.ac(b4a.alloc(80))), 'SEAL_CORRUPT')
  // KutuPaylari gerçek TPM'yi test kipi olmadan kabul eder
  t.ok(new KutuPaylari({ ledger: A.anaDefter(), me: A.K.kutu, dizin: dizin(t), tpm: t2 }))
})

test('gerçek TPM: araç hatası NO_TPM, açılan nesne 32 bayt değilse SEAL_CORRUPT', (t) => {
  t.is(hataOf(() => sistemTpm({ dizin: dizin(t), calistir: () => ({ status: 1, stdout: b4a.alloc(0) }) })), 'NO_TPM')
  const { calistir } = taklitAraclar()
  const kisa = (k, a, o) => (path.basename(k) === 'tpm2_unseal' ? { status: 0, stdout: b4a.alloc(5) } : calistir(k, a, o))
  t.is(hataOf(() => sistemTpm({ dizin: dizin(t), calistir: kisa })), 'SEAL_CORRUPT')
})

test('gerçek TPM: geçici dizin her çağrıda yeni (mkdtemp); önceden bırakılmış bağ izlenmez, bağ dizin reddedilir', (t) => {
  const d = dizin(t)
  const dis = dizin(t)
  fs.symlinkSync(dis, path.join(d, '.gecici-' + process.pid)) // eski sabit ad: kökken izlenirse araçlar dışarı yazardı
  const { calistir } = taklitAraclar()
  const argumanlar = []
  const sar = (k, a, o) => { argumanlar.push(...a); return calistir(k, a, o) }
  t.ok(tpmGercekMi(sistemTpm({ dizin: d, calistir: sar })))
  t.alike(fs.readdirSync(dis), [], 'bağın hedefine yazılmadı')
  const gecici = argumanlar.filter((a) => a.includes('.gecici-'))
  t.ok(gecici.length && gecici.every((a) => !a.startsWith(path.join(d, '.gecici-' + process.pid) + '/')), 'araçlar yeni geçici dizine yazdı')
  const bag = path.join(dizin(t), 'bag')
  fs.symlinkSync(dis, bag)
  t.is(hataOf(() => sistemTpm({ dizin: bag, calistir })), 'NO_DIR')
})

test('kutu: Unix soket yolu 103 baytı aşarsa açık hata SOCKET_PATH_TOO_LONG (macOS 104, Linux 108 bayt sınırı)', async (t) => {
  const { kutuyuBaslat, ayarlar } = require('../box')
  const d = dizin(t)
  const a = { ...ayarlar({}), dizin: d, soket: path.join(d, 'x'.repeat(120), 'k.sock'), test: true }
  let hata = null
  try { const k = await kutuyuBaslat(a); await k.kapat() } catch (err) { hata = err.message }
  t.is(hata, 'SOCKET_PATH_TOO_LONG')
})
