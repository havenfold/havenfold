// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// İşçi töreni ve görev uçtan uca (kurucu §6.4, RFC-0002 §4, §6, §7, RFC-0003 §5.1, §6.1, RFC-0007 §9, RFC-0028):
// yerel HyperDHT testnet'inde telefon çekirdeği worklet'in kendisidir (baslat; tek ayarla taşıyıcı), işçi ayrı süreçtir
// (paketteki cekirdek/isci.js), denetçi bu süreçte sahte podman'la çalışır.
//   1. İşçi ailesiz başlar; `havenfold katil --rol isci`'nin konuştuğu yönetim soketinden QR alınır, telefon okutur, iki
//      tarafta aynı 5 resim, ebeveyn onaylar: DEVICE_ATTACH (işçi ve ebeveyn imzalı), işçi ailede.
//   2. İşçi NODE_CAPS yayar, telefon Ev Makinesi'nde görür. Telefon törenden sonra yeni bir koleksiyon açar; işçinin
//      defteri eşitlenir (görev o koleksiyonla gider, işçi kendi defteriyle denetler).
//   3. Uygulama telefona yalnız kanal komutlarıyla konuşur (RFC-0002 Ek: RFC-0033 §9 s; örnek ürün sunucusu
//      taskChannel'ı katar): 253 DEVICES ve 252 MACHINE işçiyi gösterir, 245 ile dosya eklenir, 254 ilk kullanım onayı,
//      250 TASK_REQUEST hf.task.ocr ister; işçi girdiyi BLOB_REQ ile çeker, denetçiye çalıştırtır; ilerleme (basladi) ve
//      sonuç uygulamaya 'gorev' olayıyla gelir. İkinci iş konteynerde beklerken 251 TASK_CANCEL: telefonda iptal
//      sonucu, işçide konteyner öldürülür.
//   4. Kurtarma anahtarı (RFC-0007 §8.5, §13.6): işçi denetçi ve yetki yardımcısının soketi (taklit kök) üzerinden okur, töreni
//      yapan telefona NODE_RECOVERY ile yollar; telefon Ebeveynler'e hf.node.luks-kurtarma kaydı yazar, alındı döner,
//      dosya silinir.
//   5. İşçi yeniden başlar: aynı kimlikle ailede (kimlik, defter, tören anahtarı kalıcı katmanda).
// Dış ağa bağlanılmaz; test bitince işçi süreci kalmaz. Node koşusu (süreç ve soket kullanır).
const test = require('brittle')
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const b4a = require('b4a')
const sodium = require('sodium-native')
const { spawn, spawnSync } = require('child_process')
const createTestnet = require('hyperdht/testnet')
const { denetciyiBaslat } = require('../supervisor-main')
const { PodmanCalistirici } = require('../podman')
const { YetkiYardimcisi } = require('../privilege-helper')
const { YETKI_SOKETI, yetkiSunucusu } = require('../privilege-socket')
const { IPC } = require('../ipc/types')
const { baglan } = require('../ipc/socket')
const { cerceveYaz, mesajCoz, CerceveOkuyucu } = require('../ipc/frame')
const { sahtePodman } = require('./helpers/fake-podman')

const DEPO = path.join(__dirname, '../..')
const URL = 'unix:///run/havenfold/podman/podman.sock'
const OCR = 'localhost/hf-task-ocr@sha256:' + 'a'.repeat(64)
const ADLAR = require('../sas-names.json').adlar

async function bekle (f, { sure = 60000, neden = '' } = {}) {
  const son = Date.now() + sure
  for (;;) {
    const x = await f()
    if (x) return x
    if (Date.now() > son) throw new Error('TIMEOUT: ' + neden)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

// Yönetim soketi akışı (bin/havenfold'un yaptığı): f(m) false dönerse kapanır
async function akis (soket, type, mesaj, f) {
  const s = await baglan(soket)
  const ok = new CerceveOkuyucu()
  s.write(cerceveYaz(type, 1, mesaj))
  return new Promise((resolve, reject) => {
    s.on('data', (x) => { for (const b of ok.besle(x)) if (f(mesajCoz(b)) === false) { s.destroy(); resolve() } })
    s.on('error', reject)
    s.on('close', resolve)
  })
}

test('işçi töreni ve görev: telefon (worklet) işçiyi ekler, defter eşitlenir, uygulama kanal komutlarıyla hf.task.ocr ister ve iptal eder', { timeout: 300000 }, async (t) => {
  const tn = await createTestnet(3, t.teardown)

  // Düğüm (işçi rolü): dizinler, kayıtlı OCR imajı, denetçi bu süreçte
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'h')) // kısa: Unix soket yolu macOS'ta en çok 104 bayt
  t.teardown(() => fs.rmSync(kok, { recursive: true, force: true }))
  for (const d of ['etc/havenfold', 'var/lib/havenfold/denetci', 'var/lib/havenfold/isci', 'run/havenfold/denetci', 'run/havenfold/denetci-yonetim', 'run/havenfold/isci', 'run/havenfold/gorev']) fs.mkdirSync(path.join(kok, d), { recursive: true })
  fs.writeFileSync(path.join(kok, 'etc/havenfold/dugum.toml'), 'rol = "isci"\nkanal = "kararli"\n')
  fs.writeFileSync(path.join(kok, 'var/lib/havenfold/denetci/imajlar.json'), JSON.stringify({ 'hf.task.ocr@1.0.0': { ref: OCR, ramMB: 512 } }))
  const sp = sahtePodman('ocr')
  t.teardown(() => sp.sil())
  const calistirici = new PodmanCalistirici({ url: URL, kok, cekirdek: 2, ramMB: 4096, ortam: sp.ortam })
  // İlk açılışın yazdığı kurtarma anahtarı (kökün dizini 0700, dosya 0600; installer/target/hf-luks-yenile)
  const yetkiDizini = path.join(kok, 'var/lib/havenfold/yetki')
  fs.mkdirSync(yetkiDizini, { recursive: true, mode: 0o700 })
  fs.chmodSync(yetkiDizini, 0o700)
  const kurtarmaAnahtari = crypto.randomBytes(32)
  fs.writeFileSync(path.join(yetkiDizini, 'luks-kurtarma'), kurtarmaAnahtari, { mode: 0o600 })
  // Yetki yardımcısı soket kipinde (RFC-0033 §9 l): dizin 0750, soket 0660; denetçi üretimdeki gibi kancasız açılır ve
  // yardımcının soketine bağlanır
  const yetkiSoketi = await yetkiSunucusu({ y: new YetkiYardimcisi({ kok }), yol: path.join(kok, YETKI_SOKETI), gid: process.getgid(), bostaMs: 0 })
  t.teardown(() => yetkiSoketi.close())
  const den = await denetciyiBaslat({ kok }, { calistirici, kimlikBul: () => 'havenfold-isci' })
  t.teardown(() => den.kapat())

  // İşçi süreci: paketteki giriş dosyası ve node
  const pd = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-gp-'))
  t.teardown(() => fs.rmSync(pd, { recursive: true, force: true }))
  const hedef = path.join(pd, 'surum')
  t.is(spawnSync('bash', [path.join(DEPO, 'node/scripts/pack.sh'), hedef, '--bagla'], { encoding: 'utf8' }).status, 0, 'paket düzeni')
  const surecler = []
  t.teardown(() => { for (const p of surecler) try { p.kill('SIGKILL') } catch {} })
  const isciAc = async () => {
    const p = spawn(path.join(hedef, 'node'), [path.join(hedef, 'cekirdek/isci.js')], {
      env: { ...process.env, INVOCATION_ID: undefined, HF_KOK: kok, HF_ONYUKLEME: JSON.stringify(tn.bootstrap), HF_TEST_KIPI: '1', HF_ISCI_ADI: 'Lenovo' },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    surecler.push(p)
    p.cikti = ''
    p.stdout.on('data', (d) => { p.cikti += d })
    p.stderr.on('data', (d) => { p.cikti += d })
    p.bitti = new Promise((resolve) => p.once('exit', resolve))
    await bekle(() => /başladı|başlatılamadı/.test(p.cikti), { neden: 'işçi başladı' })
    return p
  }
  const isciKapat = async (p) => { p.stdin.end(); return p.bitti }
  let isci = await isciAc()
  t.ok(/havenfold-isci: başladı · kimlik [0-9a-f]{8} · ailede hayır .* türler hf\.task\.ocr@1\.0\.0/.test(isci.cikti), 'işçi ailesiz başladı: ' + isci.cikti.trim().split('\n').pop())
  const yonetim = path.join(kok, 'run/havenfold/isci/yonetim.sock')
  const durum = async () => { let d = null; await akis(yonetim, IPC.DURUM_ISTE, {}, (m) => { d = JSON.parse(m.mesaj.json); return false }); return d }
  const d0 = await durum()
  t.alike([d0.bagli, d0.aile, d0.tpm], [false, null, 'taklit (test)'])

  // Telefon: worklet çekirdeği (baslat), tek ayarla taşıyıcı; örnek ürün sunucusu (görev komutları dahil), uygulama
  // tarafı bellek içi IPC
  const { start, TASK_COMMAND: GK } = require('../../worklet')
  const { urunSunucusu } = require('../../worklet/example/product')
  const { ipcCifti, istemci } = require('../../worklet/test/helpers/common')
  const ipc = ipcCifti()
  const uyg = istemci(ipc)
  const gorevOlaylari = () => uyg.olaylar.filter((o) => o.olay === 'task').map((o) => o.veri)
  let c = null
  const telDizin = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-tel-'))
  t.teardown(() => fs.rmSync(telDizin, { recursive: true, force: true }))
  const anahtar = b4a.alloc(32)
  sodium.randombytes_buf(anahtar)
  const arsivPk = b4a.alloc(32)
  sodium.crypto_box_keypair(arsivPk, b4a.alloc(32))
  const w = await start({ urunSunucusu: (x) => { c = x; return urunSunucusu(x) }, dizin: telDizin, anahtar, archivePubHex: b4a.toString(arsivPk, 'hex'), ipc, tasiyici: { deneysel: true, onyukleme: tn.bootstrap, yoklamaMs: 500, ad: 'Kerem', cihazAdi: 'telefon' } })
  t.teardown(() => w.kapat())
  c.aileKur({ aileAdi: 'Rivera', benimAdim: 'Alex' })

  // 1. Tören: işçinin QR'ı yönetim soketinden (havenfold katil --rol isci), telefon okutur
  const olaylar = []
  const katil = akis(yonetim, IPC.KATIL_BASLAT, { rol: 'isci' }, (m) => { olaylar.push(m); if (m.type === IPC.KATIL_SONUC) return false })
  const qr = (await bekle(() => olaylar.find((m) => m.type === IPC.KATIL_QR && m.mesaj.qr), { neden: 'işçi QR' })).mesaj.qr
  const toren = new c.S.CeremonyApi({ ledger: c.nesneler.defter.L, me: c.kimlik, tasiyici: c.torenTasiyici })
  const torenOlay = []
  toren.on('ceremony', (x) => torenOlay.push(x))
  t.alike(await toren.join(qr), { tur: 'cihaz' }, 'telefon QR\'ı cihaz (işçi) töreni olarak tanır')
  const sas = await bekle(() => torenOlay.find((x) => x.adim === 'sas'), { neden: 'telefonda 5 resim' })
  t.is(sas.karsiAd, 'Lenovo')
  const isciResim = (await bekle(() => olaylar.find((m) => m.type === IPC.KATIL_QR && m.mesaj.resimler.length === 5), { neden: 'işçide 5 resim' })).mesaj.resimler
  t.alike(isciResim, sas.resimler.map((i) => ADLAR[i]), 'işçinin yazdığı adlar telefonun resimleriyle aynı')
  toren.confirm(true)
  await katil
  t.alike(olaylar.find((m) => m.type === IPC.KATIL_SONUC).mesaj, { ok: true, code: '' }, 'işçi ailede')
  const L = c.nesneler.ledger
  const isciId = d0.id
  const cihaz = await bekle(() => L.devices.get(isciId), { neden: 'DEVICE_ATTACH telefonda' })
  t.alike([cihaz.active, cihaz.class, cihaz.name], [true, 'isci', 'Lenovo'], 'DEVICE_ATTACH telefonun defterinde')
  t.ok((await durum()).bagli, 'işçi kendi defterinde aktif işçi')

  // 2. Yetenek bildirimi (kanaldan: 253 DEVICES, 252 MACHINE) ve defter eşitlemesi
  const dev = await bekle(async () => (await uyg.iste(GK.DEVICES)).find((x) => x.deviceId === isciId), { neden: 'işçinin NODE_CAPS bildirimi', sure: 90000 })
  t.alike([dev.status, dev.tasks, dev.name, dev.consent], ['hazir', ['hf.task.ocr'], 'Lenovo', false], '253 DEVICES: işçi hazır, onay yok')
  const kart = await uyg.iste(GK.MACHINE)
  t.alike([kart.acikCihaz, kart.cekirdek > 0, kart.enBuyukTekIsMB > 0, kart.calisan], [1, true, true, []], '252 MACHINE: Ev Makinesi kartı')
  c.nesneler.defter.openCollection({ name: 'Belgeler', readers: ['rol:ebeveyn'], writers: ['rol:ebeveyn'], taskAccess: true })
  c.esitleyici.akit()
  const belgeler = [...L.collections.values()].find((x) => x.name === 'Belgeler')
  t.ok(belgeler, 'koleksiyon telefonda')
  await bekle(async () => (await durum()).defterUzunlugu === L.len, { neden: 'işçinin defteri eşitlendi' })

  // 3. Görev kanaldan: dosya (245), ilk kullanım onayı (254), hf.task.ocr (250), 'gorev' olayları
  const icerik = b4a.from('%PDF-1.7 telefondaki belge ' + 'x'.repeat(70000)) // iki parça
  const blobRef = await uyg.iste(245, { bytes: { $b: b4a.toString(icerik, 'base64') }, mime: 'application/pdf', name: 'belge.pdf' })
  const ocr = { type: 'hf.task.ocr', version: '1.0.0', inputs: [{ ...blobRef, mime: 'application/pdf' }], params: { langs: ['tur'], output: 'text' }, opts: { collectionId: belgeler.id, ramMB: 512, minutes: 1, diskMB: 64, deadline: Date.now() + 3_600_000 } }
  t.alike(await uyg.iste(GK.TASK_REQUEST, ocr), { yer: null, hata: 'NO_ELIGIBLE_DEVICE' }, 'onaysız işçi seçilmez (RFC-0002 §7)')
  t.is(await uyg.iste(GK.TASK_CONSENT, { deviceId: isciId, allow: true }), null, '254 TASK_CONSENT')
  const is = await uyg.iste(GK.TASK_REQUEST, ocr)
  t.alike([is.yer, is.taskIds.length], ['isci', 1], '250 TASK_REQUEST: iş tutamacı')
  const s = await bekle(() => gorevOlaylari().find((o) => o.id === is.id && o.tur === 'result'), { neden: 'gorev olayı (sonuç)', sure: 60000 })
  t.alike([s.status, b4a.toString(b4a.from(s.inline.$b, 'base64'))], ['ok', 'ocr:' + crypto.createHash('sha256').update(icerik).digest('hex') + ':tur'], 'sonuç uygulamada gorev olayıyla; girdi işçide doğru çözüldü, koleksiyon işçinin defterinde')
  t.alike(gorevOlaylari().filter((o) => o.id === is.id && o.tur === 'progress').map((o) => [o.pct, o.note]), [[0, 'basladi']], 'işçinin TASK_PROGRESS\'i gorev olayı')
  t.ok(sp.cagrilar().some((a) => a.includes('run') && a.includes('--network=none') && a.at(-1) === OCR), 'konteyner denetçiden')

  // İptal (251): ikinci iş konteynerde beklerken
  sp.ortam.SAHTE_KIP = 'bekle'
  const runSayisi = () => sp.cagrilar().filter((a) => a.includes('run')).length
  const once = runSayisi()
  const is2 = await uyg.iste(GK.TASK_REQUEST, ocr)
  t.is(is2.yer, 'isci')
  await bekle(() => runSayisi() > once, { neden: 'ikinci konteyner çalışıyor' })
  t.is(await uyg.iste(GK.TASK_CANCEL, { id: is2.id }), null, '251 TASK_CANCEL')
  t.is(gorevOlaylari().find((o) => o.id === is2.id && o.tur === 'result').status, 'iptal', 'iptal sonucu gorev olayıyla')
  await bekle(() => sp.cagrilar().some((a) => a.includes('kill')), { neden: 'işçide konteyner öldürüldü (TASK_CANCEL → TASK_CANCEL)' })
  t.is(await uyg.iste(GK.TASK_CANCEL, { id: is2.id }), null, 'bitmiş iş: sessiz')
  sp.ortam.SAHTE_KIP = 'ocr'

  // 4. Kurtarma anahtarı töreni yapan telefona; alındıdan sonra düğümde silinir
  const ebeveynler = [...L.collections.values()].find((x) => x.name === 'Ebeveynler')
  const kayit = await bekle(() => c.nesneler.kayit.query(ebeveynler.id, { type: 'hf.node.luks-kurtarma' })[0], { neden: 'NODE_RECOVERY telefonda' })
  t.alike([kayit.fields.node_id, kayit.fields.ad, b4a.equals(kayit.fields.anahtar, kurtarmaAnahtari)], [isciId, 'Lenovo', true], 'anahtar Ebeveynler\'de (Kasa yok)')
  await bekle(() => !fs.existsSync(path.join(yetkiDizini, 'luks-kurtarma')), { neden: 'alındıdan sonra dosya silindi' })
  t.pass('kurtarma dosyası düğümde silindi')

  // 5. Yeniden başlama: aynı kimlik, ailede
  t.is(await isciKapat(isci), 0, 'işçi düzgün kapandı')
  isci = await isciAc()
  t.ok(new RegExp('kimlik ' + isciId.slice(0, 8) + ' · ailede evet').test(isci.cikti), 'yeniden başlayan işçi aynı kimlikle ailede: ' + isci.cikti.trim().split('\n').pop())
  t.is(await isciKapat(isci), 0)
  const kalan = spawnSync('pgrep', ['-f', hedef + '/cekirdek/isci.js'], { encoding: 'utf8' })
  t.is(kalan.stdout.trim(), '', 'işçi süreci kalmadı')
})
