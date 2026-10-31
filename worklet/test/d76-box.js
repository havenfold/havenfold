// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D76: Aile Kutusu ekleme uçtan uca. Gerçek kutu süreci (node/box.js; test kipinde taklit TPM, anahtarı dizinde) ve
// telefon (tek ayarla taşıyıcı: start({ tasiyici: { deneysel: true } })) yerel HyperDHT testnet'inde. Telefon aile
// kurar; `havenfold katil`'in konuştuğu yönetim soketinden kutunun QR'ı alınır, telefon okutur; iki tarafta aynı 5 resim
// (kutuda adlarıyla), ebeveyn onaylar, kutu ADD_MEMBER(kutu) ile ailede. Kayıt kutunun emanetine gider; kutu yeniden
// başlatılınca kimliği, ailesi ve emaneti yerinde (platform anahtarı TPM mühürlü). Dış ağa bağlanılmaz. Node koşusu.
'use strict'
const test = require('brittle')
const b4a = require('b4a')
const sodium = require('sodium-native')
const NODE = typeof Bare === 'undefined' // eslint-disable-line no-undef

test('Aile Kutusu ekleme: QR yönetim soketinden, 5 resim iki tarafta aynı, kutu ailede, emanet ve yeniden başlatma', { skip: !NODE, timeout: 240000 }, async (t) => {
  const createTestnet = require('hyperdht/testnet')
  const { spawn } = require('child_' + 'process')
  const path = require('pa' + 'th')
  const { KOMUT } = require('../example/product')
  const { geciciDizin, arsivAnahtari } = require('./helpers/common')
  const { BoruAgi, bekle, yukCarpani } = require('./helpers/multi')
  const { IPC } = require('../../node/ipc/types')
  const { cerceveYaz, mesajCoz, CerceveOkuyucu } = require('../../node/ipc/frame')
  const { baglan } = require('../../node/ipc/socket')
  const ADLAR = require('../../node/sas-names.json').adlar
  const rastgeleHex = (n) => { const b = b4a.alloc(n); sodium.randombytes_buf(b); return b4a.toString(b, 'hex') }

  const tn = await createTestnet(3, t.teardown)
  const kutuDizin = geciciDizin(t, 'd76-kutu')
  // Unix soket yolu kısa olmalı (macOS'ta en çok 104 bayt): deneme klasörü yerine os.tmpdir() altında kısa ad
  const fs = require('f' + 's')
  const soketDizini = fs.mkdtempSync(path.join(require('o' + 's').tmpdir(), 'hf-'))
  t.teardown(() => fs.rmSync(soketDizini, { recursive: true, force: true }))
  const soket = path.join(soketDizini, 'k.sock')
  const ortam = { ...process.env, INVOCATION_ID: undefined, HF_KUTU_DIZIN: kutuDizin, HF_KUTU_SOKET: soket, HF_TEST_KIPI: '1', HF_ONYUKLEME: JSON.stringify(tn.bootstrap), HF_KUTU_ADI: 'Aile Kutusu' }
  const surecler = []
  const kutuAc = async () => {
    const p = spawn(process.execPath, [path.join(__dirname, '../../node/box.js')], { env: ortam, stdio: ['pipe', 'pipe', 'inherit'] })
    surecler.push(p)
    // Kutu başlayamazsa (ör. SOCKET_PATH_TOO_LONG) süreç çıkar: zaman aşımı beklenmez, kutunun hatası görünür
    let cikti = ''
    await new Promise((resolve, reject) => {
      const z = setTimeout(() => reject(new Error('TIMEOUT: kutu başladı')), 30000 * yukCarpani())
      p.stdout.on('data', (d) => { cikti += d; if (cikti.includes('başladı')) { clearTimeout(z); resolve() } })
      p.once('exit', (kod) => { clearTimeout(z); reject(new Error('KUTU_BASLAMADI (çıkış ' + kod + '): ' + cikti.trim())) })
    })
    return p
  }
  const kutuKapat = (p) => new Promise((resolve) => { p.once('exit', resolve); p.kill('SIGTERM') })
  t.teardown(() => { for (const p of surecler) try { p.kill('SIGKILL') } catch {} })

  // Yönetim soketi istemcisi (bin/havenfold'un yaptığı)
  const akis = async (type, mesaj, f) => {
    const s = await baglan(soket)
    const okuyucu = new CerceveOkuyucu()
    s.write(cerceveYaz(type, 1, mesaj))
    return new Promise((resolve, reject) => {
      s.on('data', (parca) => { for (const b of okuyucu.besle(parca)) { const m = mesajCoz(b); if (f(m) === false) { s.destroy(); resolve() } } })
      s.on('error', reject)
      s.on('close', resolve)
    })
  }
  const durum = async () => { let d = null; await akis(IPC.DURUM_ISTE, {}, (m) => { d = JSON.parse(m.mesaj.json); return false }); return d }

  let kutu = await kutuAc()
  const d0 = await durum()
  t.alike([d0.bagli, d0.aile, d0.tpm, d0.disk, d0.tasiyici.acik], [false, null, 'taklit (test)', 'sifresiz', true], 'ailesiz kutu, taşıyıcı açık')

  // `havenfold katil` kesilirse (bağlantı kapanır) kutu töreni bırakır: yeni tören hemen başlar (CEREMONY_IN_PROGRESS değil)
  await akis(IPC.KATIL_BASLAT, { rol: 'kutu' }, (m) => (m.type === IPC.KATIL_QR ? false : undefined))
  const yeniden = []
  await akis(IPC.KATIL_BASLAT, { rol: 'kutu' }, (m) => { yeniden.push(m); return false })
  t.is(yeniden[0].type, IPC.KATIL_QR, 'kesilen törenden sonra yeni QR')

  const ag = new BoruAgi()
  ag.cevrimdisiYap('A')
  const A = ag.cihaz('A')
  await A.start({ dizin: geciciDizin(t, 'd76-A'), anahtarHex: rastgeleHex(32), archivePubHex: arsivAnahtari(76).pubHex, dht: tn.bootstrap, tekAyar: true, yoklamaMs: 500 })
  t.teardown(async () => { if (A.canli) await A.kapat().catch(() => {}) })
  await A.iste(KOMUT.CREATE_FAMILY, { aileAdi: 'Rivera', benimAdim: 'Alex' })

  // `havenfold katil` akışı: QR (resimsiz), telefon okutunca resim adları, sonra sonuç
  const kutuOlaylari = []
  const katil = akis(IPC.KATIL_BASLAT, { rol: 'kutu' }, (m) => { kutuOlaylari.push(m); if (m.type === IPC.KATIL_SONUC) return false })
  const qr = (await bekle(() => kutuOlaylari.find((m) => m.type === IPC.KATIL_QR && m.mesaj.qr), { neden: 'kutu QR', sure: 30000 })).mesaj
  t.alike(qr.resimler, [], 'QR önce resimsiz')
  t.ok(qr.kalanSn > 0 && qr.kalanSn <= 180)
  t.alike(await A.iste(KOMUT.JOIN, { kod: qr.qr }), { tur: 'kutu' }, 'telefon QR\'ı Aile Kutusu olarak tanır')
  const sas = await bekle(() => A.toren('sas'), { neden: 'telefonda 5 resim', sure: 45000 * yukCarpani() })
  const kutuResimleri = (await bekle(() => kutuOlaylari.find((m) => m.type === IPC.KATIL_QR && m.mesaj.resimler.length === 5), { neden: 'kutuda 5 resim', sure: 30000 })).mesaj.resimler
  t.alike(kutuResimleri, sas.resimler.map((i) => ADLAR[i]), 'kutunun yazdığı adlar telefonun resimleriyle aynı')
  await A.iste(KOMUT.INVITE_CONFIRM, { ayni: true }) // ebeveyn onayı (biyometri platformda)
  await katil
  const sonuc = kutuOlaylari.find((m) => m.type === IPC.KATIL_SONUC).mesaj
  t.alike(sonuc, { ok: true, code: '' }, 'kutu ailede')
  const d1 = await bekle(async () => { const d = await durum(); return d.bagli ? d : null }, { neden: 'kutu bağlı', sure: 30000 })
  t.alike([d1.aile.ad, d1.aile.uye], ['Rivera', 1])
  t.absent((await A.iste(KOMUT.MEMBERS)).some((x) => x.memberId === d1.id), 'kutu kişi listesinde görünmez (kişi değil, cihaz rolü)')

  // Kayıt kutunun emanetine gider (telefon kutuyu arar, kutu dinler)
  const tum = (await A.iste(KOMUT.RECORD_COLLECTIONS)).find((x) => x.name === 'Tüm Aile').collectionId
  await A.iste(KOMUT.RECORD_PUT, { collectionId: tum, type: 'yuva.defter.not', fields: { baslik: 'kutuya' } })
  const d2 = await bekle(async () => { const d = await durum(); return d.depolama.emanet >= 1 ? d : null }, { neden: 'kutu emaneti', sure: 45000 * yukCarpani() })
  t.ok(d2.tasiyici.oturum >= 1, 'kutuyla oturum')
  // D77: kutunun oturumu telefonun çevrimiçi bilgisine gider (PRESENCE_GET 350)
  const pr = await bekle(async () => { const x = await A.iste(KOMUT.PRESENCE_GET, { memberId: d1.id }); return x.online ? x : null }, { neden: 'kutu çevrimiçi', sure: 30000 })
  t.alike([pr.online, pr.via], [true, 'dogrudan'], 'Aile ekranında kutu çevrimiçi')
  t.alike((await A.torenAnahtarlari())[d1.id] !== undefined, true, 'tören anahtarı telefonda (çift sırrı)')

  // Yeniden başlatma: kimlik, aile ve emanet yerinde (platform anahtarı TPM mühürlü, durum şifreli)
  await kutuKapat(kutu)
  const kapali = await bekle(async () => { const x = await A.iste(KOMUT.PRESENCE_GET, { memberId: d1.id }); return x.online ? null : x }, { neden: 'kutu çevrimdışı', sure: 45000 })
  t.alike([kapali.online, kapali.via], [false, 'dogrudan'], 'kutu kapanınca çevrimdışı, son görülme kalır')
  kutu = await kutuAc()
  const d3 = await durum()
  t.alike([d3.id, d3.bagli, d3.aile.ad], [d1.id, true, 'Rivera'], 'yeniden başlayan kutu aynı kimlikle ailede')
  t.ok(d3.depolama.emanet >= d2.depolama.emanet, 'emanet diskten')
  // Ailedeki kutu ikinci törene girmez
  const ikinci = []
  await akis(IPC.KATIL_BASLAT, { rol: 'kutu' }, (m) => { ikinci.push(m); return false })
  t.alike(ikinci[0].mesaj, { ok: false, code: 'ALREADY_IN_FAMILY' })
  t.alike(A.hatalar, [], 'telefonda çekirdek hatası yok')
  await kutuKapat(kutu)
})
