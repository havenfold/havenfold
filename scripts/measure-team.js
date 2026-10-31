// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// measure-team.js — 32 kişilik deneme ekibinde dinleme bütçesi ve kutu zorunluluğu ölçümü (RFC-0005 §11, §21 adım 7; D47)
//
// Çalıştırma (düşük uç telefon profili: tek çekirdek):
//   taskset -c 0 bare scripts/measure-team.js [--hizli]
//   taskset -c 0 node scripts/measure-team.js [--hizli]     (karşılaştırma)
// Üç bölüm; ağ yalnız yereldir (HyperDHT testnet, 127.0.0.1), dış ağa ve genel önyükleme düğümlerine bağlanılmaz:
//   1. Defter: 32 kişi + kutu, ataması ve bir yıllık haftalık PREKEY; boyut ve yeni telefonda baştan doğrulama süresi.
//   2. Eşitleme verisi: bir iş günü (kişi başına K kayıt) Ekip koleksiyonunda; telefon başına gönderilen ve alınan bayt
//      kutusuz (her okuyucuya ayrı kopya) ve kutulu (kutuya bir kopya, kutu dağıtır); bir telefonun alma işlemci süresi.
//   3. Dinleme: ayrı bir süreçte tek telefon düğümü N dinleme sunucusu açar (8: yalnız kutular, 16: bütçe, 31: bütçesiz);
//      bekleme penceresinde gönderilen DHT isteği, UDP baytı, işlemci süresi ve gönüllü bağlam değişimi (uyanma).
// Pil telefonda ölçülemediği için yerine işlemci süresi ve uyanma sayısı. Çıktı: Markdown tablolar (kollar/D-olcum.md).
/* global Bare */
'use strict'
const BARE = typeof Bare !== 'undefined'
const ARGV = (BARE ? Bare.argv : process.argv).slice(2)

const ru = () => (BARE ? require('bare-os').resourceUsage() : process.resourceUsage())
const cpuMs = (a, b) => ((b.userCPUTime + b.systemCPUTime) - (a.userCPUTime + a.systemCPUTime)) / 1000
const uyanma = (a, b) => b.voluntaryContextSwitches - a.voluntaryContextSwitches
const kib = (n) => (n / 1024).toFixed(1)

if (ARGV[0] === '--telefon') telefon().catch((err) => { console.error('HATA', err.message); cik(1) })
else main().catch((err) => { console.error('HATA', err.stack || err.message); cik(1) })

function cik (kod) { if (BARE) Bare.exit(kod); else process.exit(kod) }

// --- 3. Dinleme: telefon süreci ------------------------------------------------------------------------------------

async function telefon () {
  const DHT = require('../worklet/node_modules/hyperdht')
  const b4a = require('b4a')
  const [, bootstrapJson, nStr, isinmaStr, sureStr] = ARGV
  const bootstrap = JSON.parse(bootstrapJson)
  const n = parseInt(nStr, 10)
  const dht = new DHT({ bootstrap, ephemeral: true })
  await dht.ready()
  let bayt = 0
  let paket = 0
  for (const s of [dht.io.clientSocket, dht.io.serverSocket]) {
    if (!s || typeof s.trySend !== 'function') continue
    const asil = s.trySend.bind(s)
    s.trySend = (buf, ...r) => { bayt += buf.byteLength; paket++; return asil(buf, ...r) }
  }
  const sunucular = []
  for (let i = 0; i < n; i++) {
    const s = dht.createServer({ firewall: () => true }, () => {})
    const tohum = b4a.alloc(32, 0x47)
    tohum[0] = i + 1
    await s.listen(DHT.keyPair(tohum))
    sunucular.push(s)
  }
  // İlk duyurular bitti; ısınmadan sonra ölçüm penceresi
  await bekle(parseInt(isinmaStr, 10))
  const r0 = ru()
  const istek0 = dht.stats.requests.total
  const b0 = bayt
  const p0 = paket
  const sure = parseInt(sureStr, 10)
  await bekle(sure)
  const r1 = ru()
  const sonuc = { n, sureMs: sure, istek: dht.stats.requests.total - istek0, bayt: bayt - b0, paket: paket - p0, cpuMs: cpuMs(r0, r1), uyanma: uyanma(r0, r1), aktarici: sunucular.reduce((a, s) => a + (s._announcer ? s._announcer.relays.length : 0), 0) }
  for (const s of sunucular) await s.close().catch(() => {})
  await dht.destroy()
  console.log('SONUC ' + JSON.stringify(sonuc))
  cik(0)
}

const bekle = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function surecKos (args) {
  const { spawn } = BARE ? require('../worklet/node_modules/bare-subprocess') : require('child_process')
  const yurutucu = BARE ? Bare.argv[0] : process.execPath
  return new Promise((resolve, reject) => {
    const p = spawn(yurutucu, [__filename, ...args], { stdio: ['ignore', 'pipe', 'inherit'] })
    let cikti = ''
    p.stdout.on('data', (d) => { cikti += d.toString() })
    p.on('exit', (kod) => {
      const s = cikti.split('\n').find((x) => x.startsWith('SONUC '))
      if (kod !== 0 || !s) reject(new Error('TELEFON_SURECI ' + kod)); else resolve(JSON.parse(s.slice(6)))
    })
  })
}

// --- Ana süreç -----------------------------------------------------------------------------------------------------

async function main () {
  const HIZLI = ARGV.includes('--hizli')
  const b4a = require('b4a')
  const { ledger: { Ledger, T, createEvent, signEvent, encodeEvent, decodeEvent, prekeyBody }, identity: { createIdentity } } = require('@havenfold/core')
  const S = require('@havenfold/sdk')
  const { Replika } = require('@havenfold/records')

  const KISI = 32
  const GUN = 86_400_000
  const TS0 = 1_790_000_000_000
  let saat = TS0
  const now = () => ++saat
  const kimlik = (i) => Object.assign(createIdentity({ seed: 'olc-ekip/' + i, platform: 'test' }), { ad: 'Kişi ' + i })
  const K = Array.from({ length: KISI }, (_, i) => kimlik(i))
  const kutu = Object.assign(createIdentity({ seed: 'olc-ekip/kutu', platform: 'test' }), { ad: 'Kutu' })
  const hex = (b) => b4a.toString(b, 'hex')
  const satirlar = []

  // 1. Defter -------------------------------------------------------------------------------------------------------
  const { ledger: L, placeId } = S.TeamApi.create({ Ledger, me: K[0], isletmeAdi: 'Deneme Kafe', displayName: K[0].ad, yer: { ad: 'Merkez', tur: 'sube' }, ts: now() })
  const defter = new S.LedgerApi({ ledger: L, me: K[0], now })
  const ekip = new S.TeamApi({ defter, now })
  const ekle = (yeni, role) => {
    const r = defter.addMember({ deviceCert: yeni.deviceCert, displayName: yeni.ad, role, ceremonyTranscriptHash: b4a.alloc(32, 7) })
    if (r.durum === 'uygulandi') return
    const y = new S.LedgerApi({ ledger: L, me: yeni, now })
    y.oneriler = defter.oneriler
    if (y.sign(r.oneriId).durum !== 'uygulandi') throw new Error('EKLENEMEDI ' + yeni.ad)
  }
  const kurulusOlay = L.len
  for (let i = 1; i < KISI; i++) {
    if (i === 8) { ekle(kutu, 'kutu'); ekip.assign(hex(kutu.memberId), [placeId]) } // 9. kişiden önce kutu (BOX_REQUIRED)
    ekle(K[i], i <= 2 ? 'yonetici' : 'calisan')
    ekip.assign(hex(K[i].memberId), [placeId])
  }
  const uyeOlay = L.len
  const boy = (a, b) => L.events.slice(a, b).reduce((t, e) => t + encodeEvent(e).byteLength, 0)
  // Bir yıl haftalık PREKEY (RFC-0005 §11.1 tablosu: yılda ~1.700 olay)
  for (let h = 0; h < 52; h++) {
    for (const k of K) {
      const pub = b4a.alloc(32, (h % 250) + 1)
      const e = createEvent(L, T.PREKEY, prekeyBody(k, pub, TS0 + h * 7 * GUN), now())
      signEvent(e, k)
      L.apply(e)
    }
  }
  const toplam = boy(0, L.len)
  // Yeni telefon: bütün defteri baştan doğrular (JOIN_LEDGER sonrası)
  const kodlu = L.events.map(encodeEvent)
  const r0 = ru()
  const t0 = Date.now()
  const L2 = new Ledger()
  for (const b of kodlu) L2.apply(decodeEvent(b))
  const dogrulamaMs = Date.now() - t0
  const dogrulamaCpu = cpuMs(r0, ru())
  satirlar.push('### Defter (32 kişi + kutu, bir yıl haftalık PREKEY)', '',
    '| Ölçü | Değer |', '|------|-------|',
    `| Kuruluş olayları (GENESIS … varsayılan koleksiyonlar) | ${kurulusOlay} olay, ${kib(boy(0, kurulusOlay))} KiB |`,
    `| 31 kişi + kutu ekleme ve atama | ${uyeOlay - kurulusOlay} olay, ${kib(boy(kurulusOlay, uyeOlay))} KiB |`,
    `| 52 hafta × 32 PREKEY | ${L.len - uyeOlay} olay, ${kib(boy(uyeOlay, L.len))} KiB |`,
    `| Toplam defter | ${L.len} olay, ${kib(toplam)} KiB |`,
    `| Yeni telefonda baştan doğrulama | ${dogrulamaMs} ms (işlemci ${dogrulamaCpu.toFixed(0)} ms) |`, '')

  // 2. Eşitleme verisi -----------------------------------------------------------------------------------------------
  const KAYIT = HIZLI ? 4 : 10 // kişi başına günlük kayıt
  const cid = [...L.collections.values()].find((c) => c.name === 'Ekip').id
  const rep = K.map((k) => new Replika({ ledger: L, me: k, now }))
  for (const r of rep) r.sync()
  const dagit = (kaynak, haric) => {
    let n = 0
    for (const m of kaynak.outbox.splice(0)) {
      for (const r of rep) {
        if (r === kaynak || r === haric) continue
        if (Array.isArray(m.to) && !m.to.includes(r.meHex)) continue
        if (m.type === 0x82) r.receiveKey(m.bytes)
        else if (m.type === 0x88) r.receiveCutoff(m.bytes)
      }
      n++
    }
    return n
  }
  for (let tur = 0; tur < 3; tur++) for (const r of rep) { r.sync(); dagit(r) }
  const anahtarli = rep.filter((r) => r.keys.epochs.size > 0).length
  // Gün: her kişi KAYIT kayıt yazar; işlem baytları toplanır (bir işlem tek şifreli kopya; alıcı başına aynı bayt)
  const islemler = []
  for (let i = 0; i < KISI; i++) {
    const kayit = new S.RecordApi({ replika: rep[i] })
    for (let j = 0; j < KAYIT; j++) kayit.put(cid, null, 'mekan.not', { baslik: 'Vardiya notu ' + j, metin: 'Kasa sayıldı, raf ' + j + ' dolduruldu. '.repeat(3) })
    for (const m of rep[i].outbox.splice(0)) if (m.type === 0x81) islemler.push({ yazar: i, bytes: m.bytes, kind: m.kind || 0 })
  }
  const islemBayt = islemler.reduce((a, x) => a + x.bytes.byteLength, 0)
  const ortIslem = islemBayt / islemler.length
  const okuyucu = KISI - 1 // Ekip: sahip, yönetici, çalışan (hepsi); kutu okumaz
  const gonderKutusuz = (islemBayt / KISI) * okuyucu
  const gonderKutulu = islemBayt / KISI
  const alma = islemBayt - islemBayt / KISI
  // Bir telefonun alma işlemci süresi: diğer 31 kişinin günlük işlemleri
  const alici = rep[3]
  const ra = ru()
  const ta = Date.now()
  for (const x of islemler) if (x.yazar !== 3) alici.receiveOp(x.bytes, x.kind)
  alici.sync()
  const almaMs = Date.now() - ta
  const almaCpu = cpuMs(ra, ru())
  const goren = alici.records(cid).length
  satirlar.push(`### Eşitleme verisi (Ekip koleksiyonu, bir iş günü: kişi başına ${KAYIT} kayıt, ${KISI} yazar)`, '',
    '| Ölçü | Kutusuz | Kutulu |', '|------|---------|--------|',
    `| Günlük işlem | ${islemler.length} (ortalama ${ortIslem.toFixed(0)} bayt) | aynı |`,
    `| Telefon başına gönderilen | ${kib(gonderKutusuz)} KiB (${okuyucu} kopya) | ${kib(gonderKutulu)} KiB (kutuya 1 kopya) |`,
    `| Telefon başına alınan | ${kib(alma)} KiB | ${kib(alma)} KiB |`,
    `| Kutunun dağıttığı (günlük) | — | ${kib(islemBayt * okuyucu)} KiB (işlem başına ${okuyucu} alıcı) |`,
    `| Çevrimdışı telefonlar için Posta Kutusu'na (günlük, en kötü durum) | ${kib(islemBayt * okuyucu)} KiB | 0 (kutu emaneti) |`,
    `| Bir telefonun alma süresi | ${almaMs} ms (işlemci ${almaCpu.toFixed(0)} ms, ${goren} kayıt) | aynı |`,
    `| Dönem anahtarı olan telefon | ${anahtarli}/${KISI} | |`, '')

  // 3. Dinleme ------------------------------------------------------------------------------------------------------
  const createTestnet = require('../worklet/node_modules/hyperdht/testnet')
  const tn = await createTestnet(HIZLI ? 6 : 10, { teardown: () => {} })
  const bootstrap = JSON.stringify(tn.bootstrap)
  if (!tn.bootstrap.every((x) => x.host === '127.0.0.1')) throw new Error('NOT_LOCAL')
  const ISINMA = HIZLI ? 3000 : 8000
  const SURE = HIZLI ? 10000 : 60000
  const dinleme = []
  for (const n of [0, 8, 16, 31]) dinleme.push(await surecKos(['--telefon', bootstrap, String(n), String(ISINMA), String(SURE)]))
  await tn.destroy()
  const saatlik = (x) => Math.round(x * 3_600_000 / SURE)
  satirlar.push(`### Dinleme (tek telefon düğümü, yerel HyperDHT testnet ${HIZLI ? 6 : 10} düğüm, ölçüm penceresi ${SURE / 1000} sn, saatliğe çevrildi)`, '',
    '| Dinleme sunucusu | Aktarıcı | DHT isteği / saat | UDP gönderim / saat | İşlemci / saat | Uyanma / saat |',
    '|------------------|----------|-------------------|---------------------|----------------|---------------|',
    ...dinleme.map((d) => `| ${d.n}${d.n === 0 ? ' (boşta düğüm)' : d.n === 8 ? ' (yalnız kutular)' : d.n === 16 ? ' (bütçe)' : ' (bütçesiz, 32 kişi)'} | ${d.aktarici} | ${saatlik(d.istek)} | ${kib(saatlik(d.bayt))} KiB (${saatlik(d.paket)} paket) | ${(saatlik(d.cpuMs) / 1000).toFixed(1)} sn | ${saatlik(d.uyanma)} |`), '')

  const baslik = `Çalışma ortamı: ${BARE ? 'Bare ' + Bare.version : 'Node ' + process.version}${HIZLI ? ' (hızlı kip)' : ''}`
  console.log(baslik)
  console.log('')
  for (const s of satirlar) console.log(s)
  cik(0)
}
