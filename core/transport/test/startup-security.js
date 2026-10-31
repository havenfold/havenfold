// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Açılış öncesi güvenlik düzeltmeleri (docs/audit/sinirlar-ve-kapsam-disi.md). Ağ yok: bellek içi sahte DHT.
//   - JOIN_HELLO caps tören MAC'inin kapsamında (RFC-0021 §2 madde 81, RFC-0003 §2.2; İstek 81)
//   - Taşıyıcıda ve törende gelen çerçeveye boyut sınırı (sınırlar 16): tür (1 bayt) ‖ gövde (en çok 1 MiB)
'use strict'
const test = require('brittle')
const b4a = require('b4a')
const c = require('compact-encoding')
const sodium = require('sodium-native')
const DHT = require('hyperdht')
const { kdf, joinHello: J, hello: { CAPS } } = require('@havenfold/core')
const T = require('..')
const A = require('../../records/test/helpers/family')

const hex = (b) => b4a.toString(b, 'hex')
const bekle = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms))
async function kosul (f, ms = 5000) { const son = Date.now() + ms; while (!f()) { if (Date.now() > son) throw new Error('TIMEOUT'); await bekle(2) } }
async function yoklaKosul (tts, f, ms = 5000) { const son = Date.now() + ms; while (!f()) { if (Date.now() > son) throw new Error('TIMEOUT'); for (const x of tts) x.yokla(); await bekle(5) } }

class Yay {
  constructor () { this.d = new Map() }
  on (a, f) { if (!this.d.has(a)) this.d.set(a, []); this.d.get(a).push(f); return this }
  once (a, f) { const g = (...x) => { this.off(a, g); f(...x) }; return this.on(a, g) }
  off (a, f) { this.d.set(a, (this.d.get(a) || []).filter((x) => x !== f)); return this }
  emit (a, ...x) { for (const f of [...(this.d.get(a) || [])]) f(...x) }
}
class SahteSoket extends Yay {
  constructor (hash, remotePublicKey) { super(); this.handshakeHash = hash; this.remotePublicKey = remotePublicKey; this.karsi = null; this.kapali = false }
  write (b) { const k = this.karsi; if (!this.kapali && k && !k.kapali) setTimeout(() => k.emit('data', b4a.from(b)), 0) }
  end () { this.destroy() }
  destroy () { if (this.kapali) return; this.kapali = true; setTimeout(() => this.emit('close'), 0); if (this.karsi) this.karsi.destroy() }
}
class SahteDht extends Yay {
  constructor () { super(); this.dinleyen = new Map() }
  createServer (o, onconn) {
    const dht = this
    const s = { o, onconn, kp: null,
      listen: async (kp) => { s.kp = kp; dht.dinleyen.set(hex(kp.publicKey), s) },
      close: async () => { if (s.kp && dht.dinleyen.get(hex(s.kp.publicKey)) === s) dht.dinleyen.delete(hex(s.kp.publicKey)) } }
    return s
  }

  connect (pk, { keyPair }) {
    const hash = b4a.alloc(32); sodium.randombytes_buf(hash)
    const ara = new SahteSoket(hash, pk)
    const s = this.dinleyen.get(hex(pk))
    setTimeout(() => {
      if (!s || s.o.firewall(keyPair.publicKey)) { ara.destroy(); return }
      const dinle = new SahteSoket(hash, keyPair.publicKey)
      ara.karsi = dinle; dinle.karsi = ara
      ara.emit('open')
      s.onconn(dinle)
    }, 0)
    return ara
  }
}

const aileCihaz = () => { const L = A.anaDefter(); return () => ({ kimlik: A.K.kerem, ledger: L, defter: null, now: Date.now, ad: 'Kerem', cihazAdi: 'telefon' }) }
const yeniCihaz = () => () => ({ kimlik: A.K.u9, ledger: null, defter: null, now: Date.now, ad: 'Ayşe', cihazAdi: 'telefon' })
function olaylar (oturum) {
  const k = { qr: [], sas: [], kapandi: [] }
  for (const ad of Object.keys(k)) oturum.on(ad, (x) => k[ad].push(x))
  return k
}
const CAPS_TAM = CAPS.LEDGER_V21 | CAPS.KAYIT | CAPS.GOREV | CAPS.COKLU_UYGULAMA | CAPS.MISAFIR_YAZAR
const eskiMac = (sec, hs, taraf) => kdf.derive(sec, 'hf/toren/mac', hs, b4a.from(taraf))

// QR'ı gören biri olarak gösterene bağlanır ve verilen JOIN_HELLO'yu yollar
async function elleKatil (t, uret) {
  const dht = new SahteDht()
  const tt = T.dhtTorenTasiyici({ dht, cihaz: aileCihaz(), deneysel: true })
  const oturum = await tt.davet({ kind: J.TOREN.UYE, rol: 'yetiskin' })
  t.teardown(() => oturum.cancel())
  const k = olaylar(oturum)
  await kosul(() => k.qr.length === 1)
  const q = T.qrCoz(k.qr[0].qr)
  const s = dht.connect(q.rv, { keyPair: DHT.keyPair(kdf.derive(q.sec, 'hf/toren/arama')) })
  s.on('data', () => {})
  s.once('open', () => s.write(b4a.concat([b4a.from([0x08]), uret(q, s)])))
  await kosul(() => k.sas.length + k.kapandi.length > 0)
  return k
}

test('İstek 81: caps MAC dışında değiştirilirse (eski MAC, dolu caps) gösteren JOIN_HELLO\'yu reddeder', async (t) => {
  const eph = b4a.alloc(32); sodium.crypto_box_keypair(eph, b4a.alloc(32))
  const k = await elleKatil(t, (q, s) => c.encode(J.joinHello, { cert: A.K.u9.deviceCert, name: 'Ayşe', device: 'telefon', eph, mac: eskiMac(q.sec, s.handshakeHash, 'c'), caps: CAPS_TAM }))
  t.alike(k.sas, [], 'resim çıkmaz')
  t.alike(k.kapandi, [{ neden: 'INVALID_CEREMONY' }])
})

test('İstek 81: caps\'i MAC\'in kapsadığından farklı yollanan JOIN_HELLO reddedilir (bit düşürme)', async (t) => {
  const eph = b4a.alloc(32); sodium.crypto_box_keypair(eph, b4a.alloc(32))
  const k = await elleKatil(t, (q, s) => c.encode(J.joinHello, { cert: A.K.u9.deviceCert, name: 'Ayşe', device: 'telefon', eph, mac: T.torenMac(q.sec, s.handshakeHash, 'c', CAPS_TAM), caps: CAPS.LEDGER_V21 }))
  t.alike(k.sas, [])
  t.alike(k.kapandi, [{ neden: 'INVALID_CEREMONY' }])
})

test('İstek 81: caps = 0 (alan yazılmamış, eski istemci) MAC\'i değişmez; MAC denetimini geçer', async (t) => {
  const eph = b4a.alloc(32); sodium.crypto_box_keypair(eph, b4a.alloc(32))
  t.alike(T.torenMac(b4a.alloc(16, 1), b4a.alloc(32, 2), 'c', 0), eskiMac(b4a.alloc(16, 1), b4a.alloc(32, 2), 'c'), 'caps = 0: eski biçim')
  const k = await elleKatil(t, (q, s) => c.encode(J.joinHello, { cert: A.K.u9.deviceCert, name: 'Ayşe', device: 'telefon', eph, mac: eskiMac(q.sec, s.handshakeHash, 'c'), caps: 0 }))
  t.is(k.sas.length, 1, 'resimler çıktı (MAC geçti)')
})

test('İstek 81: iki gerçek taraf dolu caps ile törende aynı 5 resmi görür', async (t) => {
  const dht = new SahteDht()
  const gosteren = T.dhtTorenTasiyici({ dht, cihaz: aileCihaz(), deneysel: true })
  const tarayan = T.dhtTorenTasiyici({ dht, cihaz: yeniCihaz(), deneysel: true })
  const og = await gosteren.davet({ kind: J.TOREN.UYE, rol: 'yetiskin' })
  t.teardown(() => og.cancel())
  const kg = olaylar(og)
  await kosul(() => kg.qr.length === 1)
  const ot = await tarayan.katil(kg.qr[0].qr)
  t.teardown(() => ot.cancel())
  const kt = olaylar(ot)
  await kosul(() => kg.sas.length === 1 && kt.sas.length === 1)
  t.alike(kg.sas[0].resimler, kt.sas[0].resimler)
  t.alike([kg.kapandi, kt.kapandi], [[], []])
})

// Misafir töreni (Codex 4. tur): eski, geçerli bir GUEST_VIEW kullanıcı resimleri onaylayıp bu törenin GRANT'ını
// imzalamadan bağlanamaz (yerel iptali kaldırırdı). Gösteren taraf kötü niyetli: SAS'tan sonra taslak yerine görünüm yollar.
test('misafir töreni: onaylanıp imzalanmış GRANT olmadan gelen GUEST_VIEW bağlanmaz', async (t) => {
  const dht = new SahteDht()
  const soketler = []
  const asil = dht.createServer.bind(dht)
  dht.createServer = (o, onconn) => asil(o, (s) => { soketler.push(s); onconn(s) })
  const gosteren = T.dhtTorenTasiyici({ dht, cihaz: aileCihaz(), deneysel: true })
  const baglanan = []
  const misafir = () => ({ kimlik: A.K.u9, ledger: null, defter: null, now: Date.now, ad: 'Ayşe', cihazAdi: 'telefon', misafirBagla: (b, g) => baglanan.push([b, g]), torenAnahtariKaydet: () => {} })
  const tarayan = T.dhtTorenTasiyici({ dht, cihaz: misafir, deneysel: true })
  const dene = async (onayla) => {
    const og = await gosteren.davet({ kind: J.TOREN.MISAFIR })
    t.teardown(() => og.cancel())
    const kg = olaylar(og)
    await kosul(() => kg.qr.length === 1)
    const ot = await tarayan.katil(kg.qr[0].qr)
    t.teardown(() => ot.cancel())
    const kt = olaylar(ot)
    const tamam = []
    ot.on('tamam', (x) => tamam.push(x))
    await kosul(() => kt.sas.length === 1 && soketler.length > 0)
    if (onayla) ot.confirm(true) // misafir onayladı, ama taslak (GRANT) gelmedi
    soketler.at(-1).write(b4a.concat([b4a.from([0x9a]), b4a.alloc(200, 7)]))
    await kosul(() => kt.kapandi.length + tamam.length > 0)
    return { kapandi: kt.kapandi, tamam }
  }
  t.alike(await dene(false), { kapandi: [{ neden: 'INVALID_CEREMONY' }], tamam: [] }, 'onaysız')
  t.alike(await dene(true), { kapandi: [{ neden: 'INVALID_CEREMONY' }], tamam: [] }, 'onaylı ama imzalanmış taslak yok')
  t.is(baglanan.length, 0, 'misafirBagla hiç çağrılmadı')
})

// Codex 5. tur: misafir GRANT'ı imzaladıktan sonra töreni iptal eder; geciken GUEST_VIEW artık bağlanmaz
test('misafir töreni: iptal edilen törene geciken GUEST_VIEW bağlanmaz', async (t) => {
  const { ledger: { T: OT, createEvent } } = require('@havenfold/core')
  const dht = new SahteDht()
  const soketler = []
  const asil = dht.createServer.bind(dht)
  dht.createServer = (o, onconn) => asil(o, (s) => { soketler.push(s); onconn(s) })
  const L = A.anaDefter()
  let ot = null
  const defter = {
    prepareCaregiver: ({ deviceCert, ad, expiresAt, ceremonyTranscriptHash }) => ({ event: createEvent(L, OT.GRANT, { to: deviceCert, name: ad, collections: [], taskTypes: [], expiresAt, ceremonyTranscriptHash, grantedBy: A.K.kerem.memberId }) }),
    // Misafirin imzası geldi: misafir töreni iptal eder, ardından (geciken) görünüm yola çıkar
    proposeCaregiver: () => { ot.cancel(); soketler.at(-1).write(b4a.concat([b4a.from([0x9a]), b4a.alloc(200, 7)])); return { durum: 'red' } }
  }
  const gosteren = T.dhtTorenTasiyici({ dht, cihaz: () => ({ kimlik: A.K.kerem, ledger: L, defter, now: Date.now, ad: 'Kerem', cihazAdi: 'telefon' }), deneysel: true })
  const baglanan = []
  const misafir = () => ({ kimlik: A.K.u9, ledger: null, defter: null, now: Date.now, ad: 'Ayşe', cihazAdi: 'telefon', misafirBagla: (b, g) => baglanan.push([b, g]), torenAnahtariKaydet: () => {} })
  const tarayan = T.dhtTorenTasiyici({ dht, cihaz: misafir, deneysel: true })
  const og = await gosteren.davet({ kind: J.TOREN.MISAFIR })
  t.teardown(() => og.cancel())
  const kg = olaylar(og)
  await kosul(() => kg.qr.length === 1)
  ot = await tarayan.katil(kg.qr[0].qr)
  const kt = olaylar(ot)
  const tamam = []
  ot.on('tamam', (x) => tamam.push(x))
  await kosul(() => kt.sas.length === 1 && kg.sas.length === 1)
  ot.confirm(true)
  og.confirm(true) // taslak gider, misafir imzalar, gösterenin bakiciOner'i çalışır
  await kosul(() => kt.kapandi.length > 0)
  await bekle(100)
  t.alike(kt.kapandi, [{ neden: 'kullanici' }])
  t.alike(tamam, [])
  t.is(baglanan.length, 0, 'iptalden sonra misafirBagla çağrılmadı')
})

// ---------------------------------------------------------------- çerçeve sınırı

const ORTA = T.DILIM_MS * 500_000 + T.DILIM_MS / 2
function iki (t, ek = {}) {
  const L = A.anaDefter()
  const now = () => ORTA
  const dht = new SahteDht()
  const kayit = { al: [], koptu: [], hata: [] }
  const kur = (kim) => new T.DhtTasiyici({ dht, cihaz: () => ({ kimlik: kim, ledger: L }), now, deneysel: true, yoklamaMs: 1e9, hizliMs: 1e9, hata: (err, peer) => kayit.hata.push([err.message, peer]), ...ek })
  const kerem = kur(A.K.kerem)
  const hus = kur(A.K.husniye)
  const bag = { kerem: [], hus: [] }
  kerem.ag.dinle({ baglandi: (p) => bag.kerem.push(p), koptu: (p) => kayit.koptu.push(['kerem', p]), al: (p, tur, b) => kayit.al.push(['kerem', tur, b.byteLength]) })
  hus.ag.dinle({ baglandi: (p) => bag.hus.push(p), koptu: (p) => kayit.koptu.push(['hus', p]), al: (p, tur, b) => kayit.al.push(['hus', tur, b.byteLength]) })
  t.teardown(async () => { await kerem.kapat(); await hus.kapat() })
  return { kerem, hus, bag, kayit }
}

test('Sınırlar 16: doğrulanmış oturumda 1 MiB\'ı aşan gövde oturumu kapatır (FRAME_TOO_LARGE); sınırdaki gövde geçer', async (t) => {
  const { kerem, hus, bag, kayit } = iki(t)
  await yoklaKosul([kerem, hus], () => bag.kerem.length && bag.hus.length)
  const kHex = hex(A.K.kerem.memberId)
  const hHex = hex(A.K.husniye.memberId)
  t.is(T.EN_BUYUK_GOVDE, 1024 * 1024, 'gövde sınırı 1 MiB (düğüm IPC\'si ve RFC-0001 doğrudan REC_OPS ile aynı)')

  // Sınırda: tür + tam 1 MiB gövde işlenir
  hus.oturumlar.get(kHex).socket.write(b4a.concat([b4a.from([0x80]), b4a.alloc(T.EN_BUYUK_GOVDE)]))
  await kosul(() => kayit.al.length === 1)
  t.alike(kayit.al, [['kerem', 0x80, T.EN_BUYUK_GOVDE]])

  // Bir bayt fazlası: işlenmez, oturum kapanır, hata koduyla bildirilir
  hus.oturumlar.get(kHex).socket.write(b4a.concat([b4a.from([0x80]), b4a.alloc(T.EN_BUYUK_GOVDE + 1)]))
  await kosul(() => kayit.koptu.length === 2)
  t.is(kayit.al.length, 1, 'büyük çerçeve eşitleyiciye gitmedi')
  t.alike(kayit.hata, [['FRAME_TOO_LARGE', hHex]])
  t.absent(kerem.oturumlar.has(hHex), 'oturum kapandı')
})

test('Sınırlar 16: gönderen de sınırı aşan zarfı yollamaz (karşı oturumu kapatırdı)', async (t) => {
  const { kerem, hus, bag } = iki(t)
  await yoklaKosul([kerem, hus], () => bag.kerem.length && bag.hus.length)
  const kHex = hex(A.K.kerem.memberId)
  t.is(hus.gonder(kHex, 0x80, b4a.alloc(T.EN_BUYUK_GOVDE + 1)), false)
  t.is(hus.gonder(kHex, 0x80, b4a.alloc(16)), true)
})

test('Sınırlar 16: HELLO\'dan önce gelen büyük çerçeve başarısız HELLO sayılır ve oturumu kapatır', async (t) => {
  const { kerem, hus, kayit } = iki(t)
  // Kerem büyük kimlik: dinler; Hüsniye arar. Hüsniye'nin HELLO'su yerine büyük çerçeve
  const kHex = hex(A.K.kerem.memberId)
  const hHex = hex(A.K.husniye.memberId)
  const buyukKimlik = kHex > hHex ? kerem : hus
  const kucukKimlik = buyukKimlik === kerem ? hus : kerem
  const kucukHex = buyukKimlik === kerem ? hHex : kHex
  kucukKimlik._oturum = function (peerHex, socket) { socket.on('error', () => {}); socket.write(b4a.concat([b4a.from([0x01]), b4a.alloc(T.EN_BUYUK_GOVDE + 1)])) }
  buyukKimlik.yokla(); kucukKimlik.yokla()
  await kosul(() => [...buyukKimlik.basarisiz.values()].some((n) => n >= 1))
  t.alike(kayit.hata.map((x) => x[0]), ['FRAME_TOO_LARGE'])
  t.is(kayit.hata[0][1], kucukHex)
})

test('Sınırlar 16: törende 1 MiB\'ı aşan çerçeve töreni FRAME_TOO_LARGE ile kapatır', async (t) => {
  const k = await elleKatil(t, () => b4a.alloc(T.EN_BUYUK_GOVDE + 1))
  t.alike(k.sas, [])
  t.alike(k.kapandi, [{ neden: 'FRAME_TOO_LARGE' }])
})

// ---------------------------------------------------------------- bellekte sıfırlama

test('Sınırlar 14: taşıyıcı kapanınca tören anahtarlarının ve çift sırlarının bellekteki kopyaları sıfırlanır', async (t) => {
  const L = A.anaDefter()
  const hus = hex(A.K.husniye.memberId)
  const tt = new T.DhtTasiyici({ dht: new SahteDht(), cihaz: () => ({ kimlik: A.K.kerem, ledger: L, torenAnahtarlari: new Map([[hus, '07'.repeat(32)]]) }), now: () => ORTA, deneysel: true, yoklamaMs: 1e9, hizliMs: 1e9 })
  tt.yokla()
  const anahtar = tt._defter.ceremonyKeys.get(hus)
  const cift = tt._defter.get(hus).pair
  t.absent(sodium.sodium_is_zero(anahtar))
  t.absent(sodium.sodium_is_zero(cift))
  await tt.kapat()
  t.ok(sodium.sodium_is_zero(anahtar), 'tören anahtarının kopyası sıfır')
  t.ok(sodium.sodium_is_zero(cift), 'çift sırrı sıfır')
})

test('Codex 9. tur: süresi dolan misafirle oturum kurulmaz (iki tarafta da çift sırrı yok)', async (t) => {
  const GV = require('../../core/protocol/guest-view')
  const L = A.anaDefter(17)
  const misHex = hex(A.C.misafir1.memberId)
  const gorunum = GV.acceptGuestView(null, GV.buildGuestView(L, misHex, A.K.kerem), A.C.misafir1.memberId)
  const simdi = Math.floor(L.grants.get(misHex).expiresAt / T.DILIM_MS) * T.DILIM_MS + 3 * T.DILIM_MS / 2 // süre dolduktan sonra
  const dht = new SahteDht()
  const ac = (cihaz) => new T.DhtTasiyici({ dht, cihaz, now: () => simdi, deneysel: true, yoklamaMs: 1e9, hizliMs: 1e9 })
  const misafir = ac(() => ({ kimlik: A.C.misafir1, ledger: null, misafirLedger: GV.guestLedger(gorunum) }))
  const kerem = ac(() => ({ kimlik: A.K.kerem, ledger: L }))
  const bag = []
  kerem.ag.dinle({ baglandi: (p) => bag.push(p), koptu () {}, al () {} })
  misafir.ag.dinle({ baglandi () {}, koptu () {}, al () {} })
  t.teardown(async () => { await misafir.kapat(); await kerem.kapat() })
  for (let i = 0; i < 40; i++) { for (const x of [misafir, kerem]) x.yokla(); await bekle(5) }
  t.absent(bag.includes(misHex), 'oturum yok')
})

test('açılış öncesi inceleme: kutu misafir oturumunu kabul etmez; ebeveyn telefonu kabul eder', async (t) => {
  const GV = require('../../core/protocol/guest-view')
  const L = A.anaDefter(17) // misafir1'in GRANT'ı dahil
  const misHex = hex(A.C.misafir1.memberId)
  // Taşıyıcı misafirliğin süresini uygular (Codex 9. tur): saat misafirlik bitmeden, bir dilimin ortasında
  const simdi = Math.floor((L.grants.get(misHex).expiresAt - 2 * T.DILIM_MS) / T.DILIM_MS) * T.DILIM_MS + T.DILIM_MS / 2
  const now = () => simdi
  const dht = new SahteDht()
  const gorunum = GV.acceptGuestView(null, GV.buildGuestView(L, misHex, A.K.kerem), A.C.misafir1.memberId)
  // Görünüme bugün yalnız telefon üyeleri girer; kutunun da girdiği durum (misafir kutuyu arar): kutu yine reddetmeli
  const kHex = hex(A.K.kutu.memberId)
  const kutuE = L.entity(kHex)
  gorunum.peers.set(kHex, { id: A.K.kutu.memberId, signPub: kutuE.signPub, udaPub: kutuE.udaPub, role: 'kutu', anchor: L.anchorFor(kHex, misHex), writerOf: [] })
  const ac = (cihaz) => new T.DhtTasiyici({ dht, cihaz, now, deneysel: true, yoklamaMs: 1e9, hizliMs: 1e9 })
  const misafir = ac(() => ({ kimlik: A.C.misafir1, ledger: null, misafirLedger: GV.guestLedger(gorunum) }))
  const kutu = ac(() => ({ kimlik: A.K.kutu, ledger: L }))
  const kerem = ac(() => ({ kimlik: A.K.kerem, ledger: L }))
  const bag = { kutu: [], kerem: [] }
  kutu.ag.dinle({ baglandi: (p) => bag.kutu.push(p), koptu () {}, al () {} })
  kerem.ag.dinle({ baglandi: (p) => bag.kerem.push(p), koptu () {}, al () {} })
  misafir.ag.dinle({ baglandi () {}, koptu () {}, al () {} })
  t.teardown(async () => { await misafir.kapat(); await kutu.kapat(); await kerem.kapat() })
  await yoklaKosul([misafir, kutu, kerem], () => bag.kerem.includes(misHex))
  for (let i = 0; i < 20; i++) { for (const x of [misafir, kutu, kerem]) x.yokla(); await bekle(5) }
  t.ok(bag.kerem.includes(misHex), 'ebeveyn telefonu misafirle oturum kurar')
  t.absent(bag.kutu.includes(misHex), 'kutu misafirle oturum kurmaz')
})
