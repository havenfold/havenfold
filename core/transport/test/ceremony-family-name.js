// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D97: RFC-0036 §4 ve §9 vektör 1–6, 5a — törende aile adı. Kodlama ve MAC protocol/vectors/ceremony-family-name.json'dan
// (MAC'ler kitaplıksız BLAKE2b ile de); tören akışı bellek içi sahte DHT üstünde iki tören taşıyıcısıyla, eski istemci
// AILE_ADI'sız caps ile benzetilir. Beklenenler RFC'den elle yazıldı.
'use strict'
const test = require('brittle')
const b4a = require('b4a')
const c = require('compact-encoding')
const sodium = require('sodium-native')
const DHT = require('hyperdht')
const { kdf, identity: { createIdentity }, ledger: { Ledger }, joinHello: J, messages: { deviceCert } } = require('@havenfold/core')
const T = require('..')
const S = require('../../../sdk')
const V = require('../../../protocol/vectors/ceremony-family-name.json')

const h = (x) => b4a.from(x, 'hex')
const hx = (b) => b4a.toString(b, 'hex')
const u64 = (n) => { const b = b4a.alloc(8); new DataView(b.buffer, b.byteOffset, 8).setBigUint64(0, BigInt(n)); return b }
const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const bekle = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms))
async function kosul (f, ms = 10000) { const son = Date.now() + ms; while (!f()) { if (Date.now() > son) throw new Error('TIMEOUT'); await bekle(2) } }
const durum = (no, i = 0) => V.durumlar.filter((d) => d.no === no)[i]

class Yay {
  constructor () { this.d = new Map() }
  on (a, f) { if (!this.d.has(a)) this.d.set(a, []); this.d.get(a).push(f); return this }
  once (a, f) { const g = (...x) => { this.off(a, g); f(...x) }; return this.on(a, g) }
  off (a, f) { this.d.set(a, (this.d.get(a) || []).filter((x) => x !== f)); return this }
  emit (a, ...x) { for (const f of [...(this.d.get(a) || [])]) f(...x) }
}

// Yazılan çerçeve dht.donustur'dan geçer (yolda değiştirme) ve dht.giden'e kaydedilir
class SahteSoket extends Yay {
  constructor (dht, hash, remotePublicKey) { super(); this.dht = dht; this.handshakeHash = hash; this.remotePublicKey = remotePublicKey; this.karsi = null; this.kapali = false }
  write (b) {
    const k = this.karsi
    const x = this.dht.donustur ? this.dht.donustur(b4a.from(b)) : b4a.from(b)
    this.dht.giden.push(x)
    if (!this.kapali && k && !k.kapali) setTimeout(() => k.emit('data', x), 0)
  }
  end () { this.destroy() }
  destroy () {
    if (this.kapali) return
    this.kapali = true
    setTimeout(() => this.emit('close'), 0)
    if (this.karsi) this.karsi.destroy()
  }
}

class SahteDht {
  constructor () { this.dinleyen = new Map(); this.donustur = null; this.giden = [] }
  createServer (o, onconn) {
    const dht = this
    const s = { o, onconn, kp: null, kapali: false,
      listen: async (kp) => { s.kp = kp; dht.dinleyen.set(hx(kp.publicKey), s) },
      close: async () => { s.kapali = true; if (s.kp) dht.dinleyen.delete(hx(s.kp.publicKey)) } }
    return s
  }

  connect (pk, { keyPair }) {
    const hash = b4a.alloc(32); sodium.randombytes_buf(hash)
    const ara = new SahteSoket(this, hash, pk)
    const s = this.dinleyen.get(hx(pk))
    setTimeout(() => {
      if (!s || s.kapali || s.o.firewall(keyPair.publicKey)) { ara.destroy(); return }
      const dinle = new SahteSoket(this, hash, keyPair.publicKey)
      ara.karsi = dinle; dinle.karsi = ara
      ara.emit('open')
      s.onconn(dinle)
    }, 0)
    return ara
  }
}

const TAM = V.capsYeni
const ESKI = V.capsEski
const kim = (ad) => createIdentity({ seed: 'toren-aile-adi/' + ad, platform: 'test' })
const KEREM = kim('kerem')
const SAADET = kim('saadet')
const AILE_ADI = 'Eser ailesi'

// Kerem'in ailesi (tek ebeveyn: yeni üyeyi kendisi ve yeni gelen imzalar) ve yeni gelen
function kur ({ aileCaps = TAM, yeniCaps = TAM, ortu = null } = {}) {
  let saat = 1_800_000_000_000
  const now = () => saat
  const { ledger: L } = S.LedgerApi.createFamily({ Ledger, me: KEREM, familyName: AILE_ADI, displayName: 'Kerem', ts: saat - 1000 })
  const defter = new S.LedgerApi({ ledger: L, me: KEREM, now })
  const dht = new SahteDht()
  const aileCihaz = { kimlik: KEREM, ledger: ortu ? ortu(L) : L, defter, aileBagla: () => {}, now, ad: 'Kerem', cihazAdi: 'Pixel' }
  const gelen = { baglanan: null, misafir: null }
  const yeniCihaz = { kimlik: SAADET, ledger: null, defter: null, now, ad: 'Saadet', cihazAdi: 'iPhone', aileBagla: (x) => { gelen.baglanan = x }, misafirBagla: (b, o) => { gelen.misafir = { b, o } } }
  const aile = T.dhtTorenTasiyici({ dht, cihaz: () => aileCihaz, deneysel: true, caps: aileCaps })
  const yeni = T.dhtTorenTasiyici({ dht, cihaz: () => yeniCihaz, deneysel: true, caps: yeniCaps })
  return { L, dht, aile, yeni, gelen, aileCihaz, yeniCihaz, ileri: (ms) => { saat += ms } }
}

function izle (o, onayla = true) {
  const k = {}
  o.on('sas', (x) => { k.sas = x; if (onayla) o.confirm(true) })
  o.on('tamam', (x) => { k.tamam = x })
  o.on('kapandi', (x) => { k.kapandi = x })
  return k
}
const bitti = (k) => !!(k.tamam || k.kapandi)

// Aile tarafı QR'ı gösterir (üye ya da misafir), yeni gelen tarar; iki taraf da onaylar
async function toren (x, kind = J.TOREN.UYE) {
  const oa = await x.aile.davet({ kind, rol: kind === J.TOREN.UYE ? 'yetiskin' : null })
  const ka = izle(oa)
  const qr = await new Promise((resolve) => oa.on('qr', (q) => resolve(q.qr)))
  const kb = izle(await x.yeni.katil(qr))
  await kosul(() => bitti(ka) && bitti(kb))
  await bekle(80) // soketlerin kapanışı
  return { a: ka, b: kb }
}

// JOIN_HELLO çerçeveleri (tür 0x08)
const hellolar = (dht) => dht.giden.filter((b) => b[0] === 0x08).map((b) => J.decodeJoinHello(b.subarray(1)))

test('vektör 1: kodlama, kanonik kural ve MAC (kitaplık ve doğrudan BLAKE2b)', (t) => {
  t.is(J.AILE_ADI_EN_UZUN, V.enUzun)
  t.is(require('@havenfold/core').hello.CAPS.AILE_ADI, V.AILE_ADI)
  for (const d of V.mac) {
    t.is(hx(T.torenMac(h(V.sec), h(V.handshakeHash), d.taraf, d.caps, d.aileAdi)), d.mac, d.taraf + ' ' + d.aileAdi)
    const out = b4a.alloc(32)
    sodium.crypto_generichash_batch(out, [b4a.from('yuva/v2/hf/toren/mac'), h(V.handshakeHash), b4a.from(d.taraf), u64(d.caps), ...(d.aileAdi !== null ? [b4a.from(d.aileAdi)] : [])], h(V.sec))
    t.is(hx(out), d.mac, 'doğrudan BLAKE2b')
  }
  t.not(V.mac[0].mac, V.mac[2].mac, 'ad MAC\'i değiştirir')
  const K = V.kodlama
  const k = createIdentity({ seed: K.kimlikTohumu, platform: 'test' })
  const m = J.decodeJoinHello(h(K.adli.hex))
  t.is(m.familyName, K.adli.aileAdi)
  t.is(m.caps, K.adli.caps)
  t.alike(c.encode(deviceCert, m.cert), c.encode(deviceCert, k.deviceCert))
  t.is(hx(m.mac), V.mac[0].mac, 'MAC adı kapsar')
  t.is(hx(J.encodeJoinHello({ cert: k.deviceCert, name: K.ad, device: K.cihaz, eph: h(K.eph), mac: m.mac, caps: K.adli.caps, familyName: K.adli.aileAdi })), K.adli.hex, 'yeniden kodlama aynı')
  t.is(J.decodeJoinHello(h(K.adsiz.hex)).familyName, null)
  for (const g of K.gecersiz) t.is(hataOf(() => J.decodeJoinHello(h(g.hex))), g.hata, g.aciklama)
  t.is(J.decodeJoinHello(h(K.sinir.hex)).familyName, 'ş'.repeat(128), K.sinir.aciklama)
  t.is(hataOf(() => J.encodeJoinHello({ ...m, caps: ESKI })), 'INVALID_MESSAGE', 'kodlayıcı da bitsiz adı yazmaz')
  t.is(hataOf(() => J.encodeJoinHello({ ...m, familyName: '' })), 'INVALID_MESSAGE')
})

// RFC-0036'dan önceki çözücü (core/core/protocol/join-hello.js, D96 sürümü): caps'ten sonrasını bilmez
const eskiYapi = {
  preencode (s, m) { deviceCert.preencode(s, m.cert); c.string.preencode(s, m.name); c.string.preencode(s, m.device); c.fixed32.preencode(s, m.eph); c.fixed32.preencode(s, m.mac); if (m.caps) c.uint.preencode(s, m.caps) },
  encode (s, m) { deviceCert.encode(s, m.cert); c.string.encode(s, m.name); c.string.encode(s, m.device); c.fixed32.encode(s, m.eph); c.fixed32.encode(s, m.mac); if (m.caps) c.uint.encode(s, m.caps) },
  decode (s) { const m = { cert: deviceCert.decode(s), name: c.string.decode(s), device: c.string.decode(s), eph: c.fixed32.decode(s), mac: c.fixed32.decode(s) }; m.caps = s.start < s.end ? c.uint.decode(s) : 0; return m }
}
function eskiCoz (buf) {
  let m
  try { m = c.decode(eskiYapi, buf) } catch { throw new Error('INVALID_MESSAGE') }
  if (!b4a.equals(c.encode(eskiYapi, m), buf)) throw new Error('INVALID_MESSAGE')
  return m
}

test('vektör 2: eski çözücü adlı JOIN_HELLO\'yu reddeder; aile tarafı bitsiz karşıya adı yazmaz', async (t) => {
  t.is(hataOf(() => eskiCoz(h(V.kodlama.adli.hex))), durum(2).hata, durum(2).aciklama)
  t.ok(eskiCoz(h(V.kodlama.adsiz.hex)), 'adsız JOIN_HELLO eski çözücüde geçer')
  const x = kur({ yeniCaps: ESKI })
  const r = await toren(x)
  t.ok(r.a.tamam && r.b.tamam, 'tören tamamlandı')
  t.ok(hellolar(x.dht).every((m) => m.familyName === null), durum(2, 1).aciklama)
  t.is(r.b.sas.aileAdi, durum(2, 1).aileAdi)
})

test('vektör 3: yolda ad değiştirilir ya da silinir → INVALID_CEREMONY', async (t) => {
  for (const [i, degistir] of [[0, (m) => ({ ...m, familyName: 'Başka aile' })], [1, (m) => ({ ...m, familyName: null })]]) {
    const x = kur()
    x.dht.donustur = (b) => {
      if (b[0] !== 0x08) return b
      const m = J.decodeJoinHello(b.subarray(1))
      return m.familyName === null ? b : b4a.concat([b4a.from([0x08]), J.encodeJoinHello(degistir(m))])
    }
    const r = await toren(x)
    t.is(r.b.kapandi && r.b.kapandi.neden, durum(3, i).hata, durum(3, i).aciklama)
    t.absent(r.b.sas, 'resimler gösterilmedi')
    t.is(x.gelen.baglanan, null)
  }
})

test('vektör 4: JOIN_LEDGER\'daki ad JOIN_HELLO\'dakinden farklı → FAMILY_NAME_MISMATCH, bağlanmaz', async (t) => {
  // Değiştirilmiş aile istemcisi: JOIN_HELLO'da başka ad söyler (defter aynı)
  const x = kur({ ortu: (L) => Object.create(L, { familyName: { value: 'Sahte aile' } }) })
  const r = await toren(x)
  t.is(r.b.sas.aileAdi, 'Sahte aile', 'ekranda söylenen ad')
  t.is(r.b.kapandi && r.b.kapandi.neden, durum(4).hata, durum(4).aciklama)
  t.is(x.gelen.baglanan, null, 'aileye bağlanmadı (worklet katılım örneğini tören kapanınca siler)')
  t.ok(r.a.tamam, 'aile tarafı ADD_MEMBER\'ı uyguladı (ebeveyn çıkarır)')
})

test('vektör 5: kind 1 ve 2 (aile tarayan) ad yok; yeni gelen ad gönderirse INVALID_CEREMONY', async (t) => {
  for (const kind of durum(5).kinds) {
    const x = kur()
    const dugum = { kimlik: kim('dugum' + kind), ledger: null, now: x.aileCihaz.now, ad: 'Kutu', cihazAdi: 'kutu', aileBagla: () => {} }
    const dt = T.dhtTorenTasiyici({ dht: x.dht, cihaz: () => dugum, deneysel: true })
    const { qr, oturum } = kind === 1 ? await dt.kutuDavet({ oturumla: true }) : await dt.isciDavet({ oturumla: true })
    const kd = izle(oturum)
    const ka = izle(await x.aile.katil(qr))
    await kosul(() => !!ka.sas && !!kd.sas)
    const aileninki = hellolar(x.dht)[0]
    t.is(aileninki.caps & V.AILE_ADI, V.AILE_ADI, 'aile tarafı biti bildirir')
    t.is(aileninki.familyName, durum(5).aileAdi, 'kind ' + kind + ': aile tarafı tarayanken ad yazmaz')
    t.is(kd.sas.aileAdi, null)
    oturum.cancel()
    await kosul(() => bitti(ka))
    await bekle(80)
  }
  // Yeni gelen (değiştirilmiş istemci) JOIN_HELLO'ya ad koyar
  const x = kur()
  const oa = await x.aile.davet({ kind: J.TOREN.UYE, rol: 'yetiskin' })
  const ka = izle(oa)
  const q = T.qrCoz(await new Promise((resolve) => oa.on('qr', (y) => resolve(y.qr))))
  const soket = x.dht.connect(q.rv, { keyPair: DHT.keyPair(kdf.derive(q.sec, 'hf/toren/arama')) })
  soket.once('open', () => {
    const eph = b4a.alloc(32); sodium.randombytes_buf(eph)
    const familyName = 'Benim ailem'
    soket.write(b4a.concat([b4a.from([0x08]), J.encodeJoinHello({ cert: SAADET.deviceCert, name: 'Saadet', device: 'iPhone', eph, mac: T.torenMac(q.sec, soket.handshakeHash, 'c', TAM, familyName), caps: TAM, familyName })]))
  })
  await kosul(() => bitti(ka))
  t.is(ka.kapandi && ka.kapandi.neden, durum(5, 1).hata, durum(5, 1).aciklama)
  t.absent(ka.sas)
  await bekle(80)
})

test('vektör 5a: misafir töreni — ad gelir, GUEST_VIEW karşılaştırılmaz, misafir örneğine verilir; bitsiz misafire ad yok', async (t) => {
  const x = kur()
  const r = await toren(x, J.TOREN.MISAFIR)
  t.ok(r.a.tamam && r.b.tamam, 'tören tamamlandı (FAMILY_NAME_MISMATCH yok)')
  t.is(r.b.sas.aileAdi, durum('5a').aileAdi)
  t.ok(x.gelen.misafir, 'GUEST_VIEW misafir örneğine')
  t.is(x.gelen.misafir.o.aileAdi, durum('5a').aileAdi, 'ad misafir örneğinin yerel durumuna')
  t.is(x.gelen.baglanan, null, 'defter bağlanmadı')
  const y = kur({ yeniCaps: ESKI })
  const r2 = await toren(y, J.TOREN.MISAFIR)
  t.ok(r2.b.tamam)
  t.is(r2.b.sas.aileAdi, durum('5a', 1).aileAdi, durum('5a', 1).aciklama)
  t.is(y.gelen.misafir.o.aileAdi, null)
})

test('vektör 6: dört karışım — sas.aileAdi, tören tamamlanır', async (t) => {
  const caps = { yeni: TAM, eski: ESKI }
  for (const [yeniGelen, aile, beklenen] of durum(6).karisimlar) {
    const x = kur({ yeniCaps: caps[yeniGelen], aileCaps: caps[aile] })
    const r = await toren(x)
    t.ok(r.a.tamam && r.b.tamam, `yeni gelen ${yeniGelen}, aile ${aile}: tamam`)
    t.is(r.b.sas.aileAdi, beklenen, 'yeni gelenin ekranında')
    t.is(r.a.sas.aileAdi, null, 'aile tarafında ad gösterilmez')
    t.is(x.gelen.baglanan && x.gelen.baglanan.familyName, AILE_ADI, 'defter bağlandı')
  }
})
