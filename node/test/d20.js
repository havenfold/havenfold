// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D20 (inceleme 11, RFC-0026): Mac'in saldırı senaryoları (kollar/D-inceleme-11-testler/saldiri.js) burada tersine:
// her saldırının artık başarısız olduğunu sınar. Kök gerektiren davranış kullanıcı alanında geçici bir kök dizinde
// taklit edilir; sudo yok, sistem ayarı değişmez.
const test = require('brittle')
const b4a = require('b4a')
const c = require('compact-encoding')
const sodium = require('sodium-native')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')
const core = require('@havenfold/core')
const S = require('../release')
const H = require('../health')
const { Guncelleyici } = require('../update')
const { Denetci, baytKes } = require('../supervisor')
const { IPC } = require('../ipc/types')
const C = require('../ipc/frame')
const D = require('./helpers/node-vector')
const V = require('../../core/core/test/helpers/v21')
const { ortam, DEN } = require('./helpers/privilege-env')

const hataOf = async (fn) => { try { await fn(); return null } catch (err) { return err.message } }
const hex = (b) => b4a.toString(b, 'hex')
const birim = (ad) => fs.readFileSync(path.join(__dirname, '../systemd', ad), 'utf8')
const SIMDI = 1_800_000_000_000

function defter () {
  const L = new core.ledger.Ledger({ now: () => V.TS0 })
  for (const f of V.anaAdimlar(L)) L.apply(f())
  return L
}
const NODE = hex(V.C.isci1.memberId)
const onay = (L, bildirim, vc, ek = {}) => S.onayYaz(L.familyId, V.K.kerem, {
  nodeId: V.C.isci1.memberId, op: 'dusur', product: 'havenfold-node', toVersionCode: vc, manifestHash: S.bildirimOzeti(bildirim.subarray(0, -64)),
  channel: '', expiresAt: SIMDI + 3_600_000, ledgerSeq: L.len - 1, ...ek
})

test('1 (kritik): denetçinin dizinindeki kök durumu yok sayılır; yardımcı kendi dizinindeki kökle doğrular', async (t) => {
  const o = ortam()
  const pk = b4a.alloc(32); const sk = b4a.alloc(64); sodium.crypto_sign_keypair(pk, sk)
  fs.writeFileSync(path.join(o.kok, 'var/lib/havenfold/denetci/kok.durum'), c.encode(S.kokDurumuEnc, { keyEpoch: 1, rootPub: pk, nextRootHash: D.KOK_DURUMU.nextRootHash }))
  const kotu = o.yayinla('9.9.9', 9009009, { sk, dosyalar: [{ ad: 'yetki/ana.js', bytes: b4a.from('/* saldırgan */') }, { ad: 'bin/havenfold', bytes: b4a.from('x') }] })
  t.is(await hataOf(() => o.y.isle(DEN, 'paket-ac', kotu.girdi)), 'SIGNATURE_ERROR', 'saldırganın kökü geçmez')
  t.is(await hataOf(() => o.y.isle(DEN, 'surum-gec', { surum: '9.9.9' })), 'UNVERIFIED')
  // Kökün dizini başkasına açıksa yardımcı durum yazmaz
  fs.chmodSync(path.join(o.kok, 'var/lib/havenfold/yetki'), 0o755)
  t.is(await hataOf(() => o.y.isle(DEN, 'paket-ac', o.yayinla('1.2.3', 1002003).girdi)), 'ROOT_STATE_NOT_WRITABLE')
  fs.chmodSync(path.join(o.kok, 'var/lib/havenfold/yetki'), 0o700)
  fs.rmSync(path.join(o.kok, 'var/lib/havenfold/yetki/kok.durum'))
  t.is(await hataOf(() => o.y.isle(DEN, 'durum-oku', {})), 'NO_ROOT_STATE')
  o.sil()
})

test('1 (kritik): yardımcı ve pil birimi güncellenen sürümden çalışmaz', (t) => {
  for (const ad of ['havenfold-yetki.service', 'havenfold-pil.service', 'havenfold-deneme.service', 'havenfold-acilis.service']) {
    const s = birim(ad)
    t.ok(/^ExecStart=\/usr\/lib\/havenfold\/yetki\/node \/usr\/lib\/havenfold\/yetki\/ana\.js/m.test(s), ad + ' sabit yoldan')
    t.absent(/guncel/.test(s.split('\n').filter((x) => !x.startsWith('#')).join('\n')), ad + ' guncel bağını kullanmaz')
  }
})

test('1: ROOT_ROTATION\'ı yardımcı kendisi doğrular ve uygular; taahhüde uymayan zincir reddedilir', async (t) => {
  const o = ortam()
  const rot = S.rotasyonYaz({ keyEpoch: 2, newRoot: D.YEDEK.pk, newNextRootHash: b4a.alloc(32, 5), reason: 'planli', publishedAt: 1 }, D.YEDEK.sk)
  const uz = (b) => { const n = b4a.alloc(4); n.writeUInt32BE(b.byteLength); return b4a.concat([n, b]) }
  fs.writeFileSync(path.join(o.onb, 'kok-zinciri.bin'), uz(rot))
  const pk = b4a.alloc(32); const sk = b4a.alloc(64); sodium.crypto_sign_keypair(pk, sk)
  fs.writeFileSync(path.join(o.onb, 'sahte.bin'), uz(S.rotasyonYaz({ keyEpoch: 2, newRoot: pk, newNextRootHash: b4a.alloc(32), reason: 'calinti', publishedAt: 1 }, sk)))
  fs.writeFileSync(path.join(o.onb, 'kisa.bin'), b4a.from([0, 0, 0, 9, 1, 2]))
  t.is(await hataOf(() => o.y.isle(DEN, 'kok-dondur', { zincir: 'var/lib/havenfold/denetci/onbellek/sahte.bin' })), 'COMMITMENT_ERROR')
  t.is(await hataOf(() => o.y.isle(DEN, 'kok-dondur', { zincir: 'var/lib/havenfold/denetci/onbellek/kisa.bin' })), 'FORMAT_ERROR')
  t.alike(await o.y.isle(DEN, 'kok-dondur', { zincir: 'var/lib/havenfold/denetci/onbellek/kok-zinciri.bin' }), { keyEpoch: 2 })
  t.is((await o.y.isle(DEN, 'durum-oku', {})).kok.rootPub, hex(D.YEDEK.pk))
  t.is(await hataOf(() => S.zinciriUygula(D.KOK_DURUMU, [b4a.alloc(10)])), 'FORMAT_ERROR', 'kısa kayıt BICIM (şüpheli)')
  o.sil()
})

test('2 (yüksek): enYuksek\'ten düşük sürüm yalnız o sürüme bağlı ebeveyn onayıyla; surum-geri yalnız pencerede', async (t) => {
  const L = defter()
  const o = ortam({ defter: () => L, nodeId: NODE, simdi: () => SIMDI })
  const eski = o.yayinla('1.2.3', 1002003)
  await o.kur('1.2.5', 1002005)
  t.is((await o.y.isle(DEN, 'durum-oku', {})).enYuksek, 1002005)
  t.is(await hataOf(() => o.y.isle(DEN, 'paket-ac', eski.girdi)), 'APPROVAL_REQUIRED', 'onaysız düşürme yok')
  t.is(await hataOf(() => o.y.isle(DEN, 'surum-geri', {})), 'NO_TRIAL', 'surum-geri koşulsuz değil')
  const baska = o.yayinla('1.2.4', 1002004)
  t.is(await hataOf(() => o.y.isle(DEN, 'paket-ac', { ...eski.girdi, onay: onay(L, baska.bildirim, 1002004) })), 'MANIFEST_ERROR', 'onay başka sürüme taşınamaz')
  const iyi = onay(L, eski.bildirim, 1002003)
  t.is(await hataOf(() => o.y.isle(DEN, 'paket-ac', { ...eski.girdi, onay: onay(L, eski.bildirim, 1002003, { expiresAt: SIMDI - 1 }) })), 'INVALID_DURATION')
  t.alike(await o.y.isle(DEN, 'paket-ac', { ...eski.girdi, onay: iyi }), { dizin: 'opt/havenfold/surumler/1.2.3' })
  await o.y.isle(DEN, 'surum-gec', { surum: '1.2.3' })
  t.is(o.bag('guncel'), 'surumler/1.2.3', 'ebeveyn onaylı düşürme')
  t.is(await hataOf(() => o.y.isle(DEN, 'paket-ac', { ...baska.girdi, onay: iyi })), 'MANIFEST_ERROR')
  o.sil()
})

test('2: onay yalnız ebeveynden; ikinci kez kullanılamaz; yardımcının defteri yoksa düşürme yok', async (t) => {
  const L = defter()
  const o = ortam({ defter: () => L, nodeId: NODE, simdi: () => SIMDI })
  const eski = o.yayinla('1.2.3', 1002003)
  await o.kur('1.2.5', 1002005)
  const yetiskin = S.onayYaz(L.familyId, V.K.irem, { nodeId: V.C.isci1.memberId, op: 'dusur', product: 'havenfold-node', toVersionCode: 1002003, manifestHash: S.bildirimOzeti(eski.bildirim.subarray(0, -64)), channel: '', expiresAt: SIMDI + 3_600_000, ledgerSeq: L.len - 1 })
  t.is(await hataOf(() => o.y.isle(DEN, 'paket-ac', { ...eski.girdi, onay: yetiskin })), 'UNAUTHORIZED')
  const iyi = onay(L, eski.bildirim, 1002003)
  await o.y.isle(DEN, 'paket-ac', { ...eski.girdi, onay: iyi })
  await o.y.isle(DEN, 'surum-gec', { surum: '1.2.3' }) // onay geçişte tükenir
  t.is(await hataOf(() => o.y.isle(DEN, 'paket-ac', { ...eski.girdi, onay: iyi })), 'REPLAY', 'görülen onay kökün dizininde kalıcı')
  const p = ortam({ simdi: () => SIMDI })
  const e2 = p.yayinla('1.2.3', 1002003)
  await p.kur('1.2.5', 1002005)
  t.is(await hataOf(() => p.y.isle(DEN, 'paket-ac', { ...e2.girdi, onay: iyi })), 'APPROVAL_REQUIRED')
  o.sil(); p.sil()
})

test('3 (yüksek): surum-gec denetçiyi öldürse de durum yazılmıştır; sağlık gelmezse yardımcı geri döner; aynı bildirim takılmaz', async (t) => {
  const o = ortam()
  let simdi = SIMDI
  o.y.simdi = () => simdi
  await o.kur('1.2.2', 1002002)
  const durum = { urunler: [{ product: 'havenfold-node', kurulu: 1002002, enYuksek: 1002002, onceki: 0, bozuk: [], channel: 'kararli' }] }
  const kayitlar = []
  const g = new Guncelleyici({
    durum, kok: () => D.KOK_DURUMU, simdi: () => simdi, kaydet: (d) => kayitlar.push(JSON.parse(JSON.stringify(d))),
    yetki: async (islem, girdi) => { const r = await o.y.isle(DEN, islem, girdi); if (islem === 'surum-gec') throw new Error('ECONNRESET (denetçi yeniden başlatıldı)'); return r }
  })
  const a = o.yayinla('1.2.3', 1002003)
  const hz = (x) => x.hazirla({ bildirimBytes: a.bildirim, bildirimYolu: a.girdi.bildirim, paketYolu: a.girdi.dosya, paketOzeti: S.paketOzeti(a.paket), paketBoyu: a.paket.byteLength })
  t.is(await hz(g), 'kur')
  t.is(await hataOf(() => g.gec()), null, 'bağlantının kopması geçişin olduğu anlamına gelir')
  t.is(o.bag('guncel'), 'surumler/1.2.3')
  t.is(kayitlar.at(-1).urunler[0].kurulu, 1002003, 'surum.durum geçişten önce yazıldı')
  const yeni = new Guncelleyici({ durum: JSON.parse(JSON.stringify(kayitlar.at(-1))), kok: () => D.KOK_DURUMU, simdi: () => simdi, yetki: (i, x) => o.y.isle(DEN, i, x) })
  simdi += 60 * 60_000
  t.is(await yeni.saglikDenetle(), 'bekle', 'MERHABA yoksa bir saat sonra da "gecti" değil')
  t.is((await o.y.isle('root', 'deneme-denetle', {})).durum, 'geri-alindi')
  t.is(await yeni.saglikDenetle(), 'geri-alindi')
  t.is(o.bag('guncel'), 'surumler/1.2.2')
  t.is(await hz(yeni), 'yok-say', 'bozuk sürüm yeniden denenmez')
  o.sil()
})

test('4 (yüksek, işlevsel): paket kökündeki node ve bare çalıştırılabilir açılır', async (t) => {
  const o = ortam()
  const a = o.yayinla('1.2.3', 1002003, { dosyalar: [{ ad: 'node', bytes: b4a.from('ELF') }, { ad: 'bare', bytes: b4a.from('ELF') }, { ad: 'bin/havenfold', bytes: b4a.from('x') }, { ad: 'lib/node', bytes: b4a.from('x') }] })
  await o.y.isle(DEN, 'paket-ac', a.girdi)
  const d = path.join(o.kok, 'opt/havenfold/surumler/1.2.3')
  t.is(fs.statSync(path.join(d, 'node')).mode & 0o777, 0o755)
  t.is(fs.statSync(path.join(d, 'bare')).mode & 0o777, 0o755)
  t.is(fs.statSync(path.join(d, 'lib/node')).mode & 0o777, 0o644, 'yalnız kökteki çalışma zamanları')
  o.sil()
})

function denetciOrtami (ek = {}) {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-denetci-'))
  for (const d of ['run/havenfold/kutu', 'run/havenfold/isci', 'run/havenfold/gorev', 'var/lib/havenfold/yedek/kutu', 'var/lib/havenfold/yedek/isci', 'var/lib/havenfold/denetci']) fs.mkdirSync(path.join(kok, d), { recursive: true })
  const den = new Denetci({ kok, hostId: b4a.alloc(16, 7), surum: '1.2.3', ...ek })
  return { kok, den }
}
async function istek (den, kapsam, type, mesaj) {
  const b = den.uc(kapsam).baglan('havenfold-' + kapsam)
  const { cikis } = await b.al(C.cerceveYaz(type, 1, mesaj))
  return cikis.map((f) => C.mesajCoz(f.subarray(4)))
}

test('5 (orta): kutu çekirdeği yedek yolunda bağla kapsam dışı dosyaya ulaşamaz; kaynağı denetçi silmez', async (t) => {
  const { kok, den } = denetciOrtami()
  const blob = b4a.alloc(32, 0xab)
  const isciBlok = path.join(kok, 'var/lib/havenfold/yedek/isci', hex(blob))
  fs.writeFileSync(isciBlok, b4a.alloc(100, 1))
  fs.symlinkSync(path.join(kok, 'var/lib/havenfold/yedek/isci'), path.join(kok, 'run/havenfold/kutu/l'))
  const [r1] = await istek(den, 'kutu', IPC.YEDEK_YAZ, { blobId: blob, path: 'run/havenfold/kutu/l/' + hex(blob), size: 100 })
  t.is(r1.mesaj.code, 'INVALID_PATH', 'dizin bağı')
  t.ok(fs.existsSync(isciBlok), 'işçinin bloğu yerinde')
  fs.writeFileSync(path.join(kok, 'var/lib/havenfold/denetci/kok.durum'), b4a.alloc(65, 1))
  fs.symlinkSync(path.join(kok, 'var/lib/havenfold/denetci/kok.durum'), path.join(kok, 'run/havenfold/kutu/d'))
  const [r2] = await istek(den, 'kutu', IPC.YEDEK_YAZ, { blobId: b4a.alloc(32, 1), path: 'run/havenfold/kutu/d', size: 65 })
  t.is(r2.mesaj.code, 'INVALID_PATH', 'dosya bağı')
  t.ok(fs.existsSync(path.join(kok, 'var/lib/havenfold/denetci/kok.durum')))
  fs.mkdirSync(path.join(kok, 'run/havenfold/kutu/alt'))
  fs.writeFileSync(path.join(kok, 'run/havenfold/kutu/alt/b'), b4a.alloc(3))
  const [r3] = await istek(den, 'kutu', IPC.YEDEK_YAZ, { blobId: b4a.alloc(32, 2), path: 'run/havenfold/kutu/alt/b', size: 3 })
  t.is(r3.mesaj.code, 'INVALID_PATH', 'alt dizin yok')
  fs.writeFileSync(path.join(kok, 'run/havenfold/kutu/blok'), b4a.alloc(10, 7))
  const [r4] = await istek(den, 'kutu', IPC.YEDEK_YAZ, { blobId: b4a.alloc(32, 3), path: 'run/havenfold/kutu/blok', size: 10 })
  t.is(r4.mesaj.ok, true)
  t.alike(fs.readFileSync(path.join(kok, 'var/lib/havenfold/yedek/kutu', '03'.repeat(32))), b4a.alloc(10, 7))
  const [r5] = await istek(den, 'kutu', IPC.YEDEK_YAZ, { blobId: b4a.alloc(32, 3), path: 'run/havenfold/kutu/blok', size: 10 })
  t.ok(r5.mesaj.code, 'var olan yedek üstüne yazılmaz')
  fs.rmSync(kok, { recursive: true, force: true })
})

test('6, 7 (orta): bekleyen kalıcı; daha düşük ya da geri çekilmiş bildirim bekleyenin yerini almaz; yardımcı da kurmaz', async (t) => {
  const o = ortam()
  const durum = { urunler: [{ product: 'havenfold-node', kurulu: 1002002, enYuksek: 1002002, onceki: 0, bozuk: [], channel: 'kararli' }] }
  const bekleyenler = []
  const g = new Guncelleyici({ durum, kok: () => D.KOK_DURUMU, yetki: (i, x) => o.y.isle(DEN, i, x), pencereAcik: () => false, bekleyenKaydet: (b) => bekleyenler.push(b) })
  const hz = (x, a) => x.hazirla({ bildirimBytes: a.bildirim, bildirimYolu: a.girdi.bildirim, paketYolu: a.girdi.dosya, paketOzeti: S.paketOzeti(a.paket), paketBoyu: a.paket.byteLength })
  const yeni = o.yayinla('1.2.5', 1002005, { ek: { revoked: [1002004], urgent: true } })
  const cekilen = o.yayinla('1.2.4', 1002004)
  t.is(await hz(g, yeni), 'kur')
  t.is(await hz(g, cekilen), 'yok-say', 'geri çekilmiş ve bekleyenden düşük')
  t.is(g.bekleyen.versionCode, 1002005)
  t.is(await hataOf(() => o.y.isle(DEN, 'paket-ac', cekilen.girdi)), 'VERSION_REVOKED', 'yardımcı geri çekilen sürümü kurmaz')
  // Yeniden başlayan denetçi: bekleyen kalıcı kayıttan, aynı acil sürüm takılmaz
  const g2 = new Guncelleyici({ durum, bekleyen: bekleyenler.at(-1), kok: () => D.KOK_DURUMU, yetki: (i, x) => o.y.isle(DEN, i, x), pencereAcik: () => false })
  t.is(g2.bekleyen.versionCode, 1002005)
  t.is(g2.zamaniGeldi(), true, 'acil bekleyen hâlâ acil')
  const g3 = new Guncelleyici({ durum, kok: () => D.KOK_DURUMU, yetki: (i, x) => o.y.isle(DEN, i, x) })
  t.is(await hz(g3, yeni), 'kur', 'kayıt kaybolsa da aynı sürüm yeniden hazırlanır (VERSION_EXISTS değil)')
  o.sil()
})

test('8 (orta): systemd sertleştirmesi ve soket dizinleri', (t) => {
  const y = birim('havenfold-yetki.service').split('\n')
  for (const s of ['ProtectSystem=strict', 'CapabilityBoundingSet=CAP_DAC_READ_SEARCH', 'SystemCallFilter=@system-service', 'RestrictAddressFamilies=AF_UNIX', 'PrivateNetwork=yes', 'PrivateDevices=yes', 'RestrictSUIDSGID=yes', 'ProtectKernelTunables=yes', 'ProtectControlGroups=yes', 'NoNewPrivileges=yes']) t.ok(y.includes(s), 'yetki: ' + s)
  const p = birim('havenfold-pil.service').split('\n')
  for (const s of ['ProtectSystem=strict', 'CapabilityBoundingSet=', 'PrivateNetwork=yes', 'RestrictAddressFamilies=AF_UNIX']) t.ok(p.includes(s), 'pil: ' + s)
  const e = birim('havenfold-ekran.service')
  t.ok(e.includes('\nUser=havenfold-ekran\n') && !/User=havenfold-denetci/.test(e), 'ekran ayrı kullanıcıyla')
  const tmp = fs.readFileSync(path.join(__dirname, '../deploy/tmpfiles.conf'), 'utf8').split('\n').map((x) => x.split(/\s+/))
  const dizin = (p) => tmp.find((x) => x[1] === p).slice(2, 5)
  t.alike(dizin('/run/havenfold/kutu'), ['0750', 'havenfold-kutu', 'havenfold-yonetim'])
  t.alike(dizin('/run/havenfold/isci'), ['0750', 'havenfold-isci', 'havenfold-yonetim'])
  t.alike(dizin('/run/havenfold/denetci'), ['0750', 'havenfold-denetci', 'havenfold-cekirdek'])
  t.alike(dizin('/var/lib/havenfold/yetki'), ['0700', 'root', 'root'])
  const su = fs.readFileSync(path.join(__dirname, '../deploy/sysusers.conf'), 'utf8')
  for (const m of ['m     havenfold-kutu      havenfold-cekirdek', 'm     havenfold-isci      havenfold-cekirdek', 'u     havenfold-ekran']) t.ok(su.includes(m), m)
  t.ok(birim('havenfold-denetci.service').includes('/run/havenfold/denetci-yonetim'))
  t.ok(birim('havenfold-yetki.socket').includes('SocketGroup=havenfold-denetci'), 'RFC-0033 §9 l: yalnız denetçinin grubu')
  t.ok(birim('havenfold-deneme.timer').includes('OnUnitActiveSec=1min'))
})

test('9 (orta): giriş kuralında yol zorunlu; SDK girişleri yol, L ve gönderen verir', async (t) => {
  const govde = b4a.alloc(10)
  t.is(await hataOf(() => core.giris.gelenZarf({ myRole: 'uye', peerRole: 'cihaz', type: core.zarf.Z.NODE_HEALTH, bytes: govde })), 'INVALID_CHANNEL', 'yol verilmezse geçmez')
  t.is(await hataOf(() => core.giris.gelenZarf({ myRole: 'uye', peerRole: 'cihaz', type: core.zarf.Z.NODE_HEALTH, bytes: govde, yol: 'posta' })), 'DIRECT_ONLY')
  const src = fs.readFileSync(path.join(__dirname, '../../sdk/api.js'), 'utf8').split('\n')
  const cagrilar = src.filter((s) => s.includes('giris.gelenZarf(') && !s.includes("kanal: 'yerel'"))
  t.ok(cagrilar.length >= 4)
  for (const s of cagrilar) t.ok(/yol \}\)/.test(s) && /L: this\.(_L|L)/.test(s) && /gonderen: hex\(/.test(s), s.trim().slice(0, 60))
})

test('10 (düşük-orta): görev günlüğü bayt sınırında, karakter bölünmeden kesilir', async (t) => {
  t.is(baytKes('ş'.repeat(3000), 4096), 'ş'.repeat(2048))
  t.is(baytKes('a' + 'ş'.repeat(2048), 4096), 'a' + 'ş'.repeat(2047), 'yarım karakter yok')
  t.is(baytKes('kısa', 4096), 'kısa')
  const { kok, den } = denetciOrtami({ calistir: async () => ({ status: 'tamam', exitCode: 0, log: 'ş'.repeat(3000) }) })
  const taskId = b4a.alloc(16, 3)
  den.gorevler.set(hex(taskId), { dir: kok, type: 'x', version: '1', limits: {}, standing: false })
  const [f] = await istek(den, 'isci', IPC.GOREV_BASLAT, { taskId })
  t.is(f.type, IPC.GOREV_BITTI, 'işçi tarafında çözülür')
  t.is(b4a.byteLength(f.mesaj.log), 4096)
  fs.rmSync(kok, { recursive: true, force: true })
})

test('11 (düşük): eski imzalı bildirim düğümü onay-bekliyor\'a sokmaz', async (t) => {
  const o = ortam()
  const durum = { urunler: [{ product: 'havenfold-node', kurulu: 1002005, enYuksek: 1002005, onceki: 0, bozuk: [], channel: 'kararli' }] }
  const g = new Guncelleyici({ durum, kok: () => D.KOK_DURUMU, yetki: (i, x) => o.y.isle(DEN, i, x) })
  const a = o.yayinla('1.2.3', 1002003)
  t.is(await g.hazirla({ bildirimBytes: a.bildirim, bildirimYolu: a.girdi.bildirim, paketYolu: a.girdi.dosya, paketOzeti: S.paketOzeti(a.paket), paketBoyu: a.paket.byteLength }), 'yok-say')
  t.is(g.hal, 'guncel')
  o.sil()
})

test('12 (düşük): yardımcı önbellekte bağ, FIFO ve aygıt izlemez; dosya bir kez okunur', async (t) => {
  const o = ortam()
  const a = o.yayinla('1.2.3', 1002003)
  const dis = path.join(o.kok, 'baska-yer.bildirim')
  fs.renameSync(path.join(o.kok, a.girdi.bildirim), dis)
  fs.symlinkSync(dis, path.join(o.kok, a.girdi.bildirim))
  t.is(await hataOf(() => o.y.isle(DEN, 'paket-ac', a.girdi)), 'INVALID_PATH', 'dosya bağı')
  fs.rmSync(path.join(o.kok, a.girdi.bildirim))
  fs.symlinkSync('/dev/zero', path.join(o.kok, a.girdi.bildirim))
  t.is(await hataOf(() => o.y.isle(DEN, 'paket-ac', a.girdi)), 'INVALID_PATH', '/dev/zero')
  fs.rmSync(path.join(o.kok, a.girdi.bildirim))
  execFileSync('mkfifo', [path.join(o.kok, a.girdi.bildirim)])
  t.is(await hataOf(() => o.y.isle(DEN, 'paket-ac', a.girdi)), 'INVALID_PATH', 'FIFO takılmaz')
  fs.rmSync(path.join(o.kok, a.girdi.bildirim))
  fs.writeFileSync(path.join(o.kok, a.girdi.bildirim), b4a.alloc((1 << 20) + 1))
  t.is(await hataOf(() => o.y.isle(DEN, 'paket-ac', a.girdi)), 'SIZE_OVERRUN')
  // Önbellek dizininin kendisi bağ
  const p = ortam()
  const b = p.yayinla('1.2.3', 1002003)
  const gercek = path.join(p.kok, 'gercek-onbellek')
  fs.renameSync(p.onb, gercek)
  fs.symlinkSync(gercek, p.onb)
  t.is(await hataOf(() => p.y.isle(DEN, 'paket-ac', b.girdi)), 'INVALID_PATH')
  o.sil(); p.sil()
})

test('şüpheliler: sağlık ölçümü gönderene ve etkin düğüme bağlı, seq artmalı; onayda imza geçmiş defterden önce', async (t) => {
  const L = defter()
  const F = require('../../protocol/vectors/node.json')
  const L6 = new core.ledger.Ledger({ now: () => 0 })
  for (const h of F[6].zincir) L6.apply(core.ledger.decodeEvent(b4a.from(h, 'hex')))
  const bytes = b4a.from(F[6].pilli.bytes, 'hex')
  const m = H.saglikCoz(L6, bytes)
  const id = hex(m.nodeId)
  t.is(await hataOf(() => H.saglikCoz(L6, bytes, { gonderen: id })), null)
  t.is(await hataOf(() => H.saglikCoz(L6, bytes, { gonderen: hex(V.K.kerem.memberId) })), 'UNAUTHORIZED', 'başkasının ölçümünü ileten')
  t.is(await hataOf(() => H.saglikCoz(L6, bytes, { sonSeq: m.seq })), 'STALE_MANIFEST')
  t.is(await hataOf(() => H.saglikCoz(L6, bytes, { sonSeq: m.seq - 1 })), null)
  // Bozuk imzalı onay geçmiş defter kurulmadan reddedilir
  let kuruldu = 0
  const asil = L.pastCursor.bind(L)
  L.pastCursor = () => { kuruldu++; return asil() }
  const hedef = S.bildirimYaz(D.bildirim({ version: '1.2.2', versionCode: 1002002 }), D.KOK.sk)
  const b2 = onay(L, hedef, 1002002, { expiresAt: V.TS0 + 3_600_000 })
  b2[b2.byteLength - 1] ^= 1
  t.is(await hataOf(() => S.onayDenetle(L, b2, { me: NODE, simdi: V.TS0, gorulen: new Map(), kok: D.KOK_DURUMU, hedef })), 'INVALID_SIGNATURE')
  t.is(kuruldu, 0, 'pastCursor çağrılmadı')
})

test('açılış öncesi inceleme: önceki sürüm yokken (ilk geçişin denemesi) geri dönüş "geri alındı" demez', async (t) => {
  const o = ortam()
  t.teardown(o.sil)
  const a = o.yayinla('1.0.0', 1000000)
  await o.y.isle(DEN, 'paket-ac', a.girdi)
  await o.y.isle(DEN, 'surum-gec', { surum: '1.0.0' })
  const r = await o.y.isle(DEN, 'surum-geri', {})
  t.is(r.durum, 'geri-alinamadi')
  t.is(o.bag('guncel'), 'surumler/1.0.0', 'tek sürüm guncel kalır')
  const d = o.y.durumOku()
  t.ok(d.bozuk.includes(1000000), 'bozuk işaretlendi')
  t.is(d.deneme, null)
})
