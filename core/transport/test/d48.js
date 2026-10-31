// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D48: taşıyıcı deneme sürümünün eksikleri (RFC-0028 §6, §9; bayrak arkasında). Ağ yok: bellek içi sahte DHT
// (createServer/listen/close, connect, güvenlik duvarı, suspend/resume, network-change). Saat elle ilerler.
'use strict'
const test = require('brittle')
const b4a = require('b4a')
const sodium = require('sodium-native')
const DHT = require('hyperdht')
const { pairs: { PairBook } } = require('@havenfold/core')
const T = require('..')
const A = require('../../records/test/helpers/family')

const hex = (b) => b4a.toString(b, 'hex')
const u64 = (n) => { const b = b4a.alloc(8); new DataView(b.buffer, b.byteOffset, 8).setBigUint64(0, BigInt(n)); return b }
const bekle = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms))
// Koşul gerçekleşene kadar (yük altında sabit bekleme yetmez; D68)
async function kosul (f, ms = 5000) { const son = Date.now() + ms; while (!f()) { if (Date.now() > son) throw new Error('TIMEOUT'); await bekle(2) } }

// Küçük olay yayıcı (Node ve Bare)
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
  destroy () {
    if (this.kapali) return
    this.kapali = true
    setTimeout(() => this.emit('close'), 0)
    if (this.karsi) this.karsi.destroy()
  }
}

class SahteDht extends Yay {
  constructor () { super(); this.dinleyen = new Map(); this.baglanti = 0; this.olaylar = [] }
  createServer (o, onconn) {
    const dht = this
    const s = { o, onconn, kp: null, kapali: false,
      listen: async (kp) => { s.kp = kp; dht.dinleyen.set(hex(kp.publicKey), s) },
      close: async () => { s.kapali = true; if (s.kp && dht.dinleyen.get(hex(s.kp.publicKey)) === s) dht.dinleyen.delete(hex(s.kp.publicKey)) } }
    return s
  }

  connect (pk, { keyPair }) {
    this.baglanti++
    const hash = b4a.alloc(32); sodium.randombytes_buf(hash)
    const ara = new SahteSoket(hash, pk)
    const s = this.dinleyen.get(hex(pk))
    setTimeout(() => {
      if (!s || s.kapali || s.o.firewall(keyPair.publicKey)) { ara.destroy(); return }
      const dinle = new SahteSoket(hash, keyPair.publicKey)
      ara.karsi = dinle; dinle.karsi = ara
      ara.emit('open')
      s.onconn(dinle)
    }, 0)
    return ara
  }

  async suspend () { this.olaylar.push('suspend') }
  async resume () { this.olaylar.push('resume') }
}

function islem () {
  const k = { baglandi: [], koptu: [], al: [] }
  return { k, isl: { baglandi: (p) => k.baglandi.push(p), koptu: (p) => k.koptu.push(p), al: (p, t, b) => k.al.push([p, t]) } }
}

const kur = (dht, kim, L, now) => new T.DhtTasiyici({ dht, cihaz: () => ({ kimlik: kim, ledger: L }), now, deneysel: true, yoklamaMs: 1e9, hizliMs: 1e9 })

test('HELLO sınırı: aynı anahtardan aynı dilimde 3 bozuk HELLO o dilimi kapatır; sonraki dilim yeniden açılır', async (t) => {
  const L = A.anaDefter()
  let saat = 1_800_000_000_000
  const now = () => saat
  const dht = new SahteDht()
  const kerem = kur(dht, A.K.kerem, L, now) // Kerem'in kimliği büyük: dinler
  const { isl } = islem()
  kerem.ag.dinle(isl)
  t.teardown(() => kerem.kapat())
  const hus = new PairBook({ me: A.K.husniye, ledger: L }).peers().find((p) => p.hex === hex(A.K.kerem.memberId))
  const e = T.dilimOf(saat)
  const sunucu = () => kerem.sunucular.has(hex(A.K.husniye.memberId) + '|' + e)
  t.ok(sunucu(), 'dilim e dinleniyor')
  // Saldırgan Hüsniye'nin arama anahtarını biliyor (çift sırrını ele geçirmiş) ama HELLO'su bozuk
  // Kerem'in sayacı: başarısız HELLO'lar ve kapalı dilimler (her bozuk bağlantıda biri artar)
  const sayac = () => [...kerem.basarisiz.values()].reduce((a, b) => a + b, 0) + kerem.kapali.size * 100
  const kotu = async () => {
    const once = sayac()
    const s = dht.connect(DHT.keyPair(hus.sub.peerListenSeed(u64(e))).publicKey, { keyPair: DHT.keyPair(hus.sub.dialSeed(u64(e))) })
    await new Promise((resolve) => { s.once('open', () => { s.write(b4a.from([0x01, 0xff, 0xff])); resolve() }); s.once('close', resolve) })
    await kosul(() => sayac() !== once)
  }
  await kotu(); await kotu()
  t.ok(sunucu(), 'iki başarısızlıktan sonra açık')
  await kotu()
  t.absent(sunucu(), 'üçüncüde dilim kapandı')
  kerem.yokla()
  t.absent(sunucu(), 'yoklama kapalı dilimi yeniden açmaz')
  // Sonraki dilim bitişe 5 dakika kala açılır (RFC-0028 §7 g; D74)
  const ortada = saat
  saat = (e + 1) * T.DILIM_MS - T.ORTUSME_MS
  kerem.yokla()
  t.ok(kerem.sunucular.has(hex(A.K.husniye.memberId) + '|' + (e + 1)), 'sonraki dilim açık')
  t.absent(sunucu(), 'kapalı dilim kapalı kalır')
  saat = ortada
  // Süre aşımı da başarısızlıktır (HELLO göndermeyen bağlantı): İrem'in çiftinde
  kerem.helloMs = 20
  const irem = new PairBook({ me: A.K.irem, ledger: L }).peers().find((p) => p.hex === hex(A.K.kerem.memberId))
  const iremSunucu = () => kerem.sunucular.has(hex(A.K.irem.memberId) + '|' + e)
  for (let i = 0; i < 3; i++) {
    const s = dht.connect(DHT.keyPair(irem.sub.peerListenSeed(u64(e))).publicKey, { keyPair: DHT.keyPair(irem.sub.dialSeed(u64(e))) })
    const once = sayac()
    await new Promise((resolve) => s.once('close', resolve))
    await kosul(() => sayac() !== once)
  }
  t.absent(iremSunucu(), 'üç süre aşımında dilim kapandı')
  saat += T.DILIM_MS * 2
  kerem.yokla()
  t.ok(sunucu() === false && kerem.sunucular.has(hex(A.K.husniye.memberId) + '|' + (e + 2)), 'iki dilim sonra yeni dilimler')
  t.absent([...kerem.kapali].some((k) => Number(k.split('|')[1]) < e + 1), 'eski kapalı dilim kaydı temizlendi')
})

test('iki taşıyıcı: HELLO ile oturum; kopuşta hızlı dönem; ağ değişince oturum kapanıp yeniden kurulur', async (t) => {
  const L = A.anaDefter()
  let saat = 1_800_000_000_000
  const now = () => saat
  const dht = new SahteDht()
  const kerem = kur(dht, A.K.kerem, L, now)
  const hus = kur(dht, A.K.husniye, L, now)
  const ik = islem(); const ih = islem()
  kerem.ag.dinle(ik.isl)
  hus.ag.dinle(ih.isl)
  t.teardown(async () => { await kerem.kapat(); await hus.kapat() })
  await kosul(() => ih.k.baglandi.length && ik.k.baglandi.length)
  t.alike(ih.k.baglandi, [hex(A.K.kerem.memberId)], 'Hüsniye Kerem\'e bağlandı (küçük kimlik arar)')
  t.ok(ik.k.baglandi.includes(hex(A.K.husniye.memberId)))
  t.ok(hus.gonder(hex(A.K.kerem.memberId), 0x81, b4a.from([1, 2])))
  await kosul(() => ik.k.al.length)
  t.alike(ik.k.al, [[hex(A.K.husniye.memberId), 0x81]])
  // Hızlı dönem bitti; kopuş yeniden hızlandırır
  saat += T.HIZLI_SURE_MS + 1
  t.ok(hus.hizliBitis < saat)
  const once = dht.baglanti
  dht.emit('network-change') // baslat() çağrılmadı: elle
  hus.agDegisti()
  await kosul(() => ih.k.baglandi.length === 2 && hus.oturumlar.get(hex(A.K.kerem.memberId))?.dogrulandi)
  t.ok(hus.hizliBitis > saat, 'ağ değişimi hızlı dönem açar')
  t.ok(dht.baglanti > once, 'yeniden arandı')
  t.is(ih.k.koptu.length, 1, 'eski oturum koptu')
  t.is(ih.k.baglandi.length, 2, 'yeni oturum kuruldu')
  t.ok(hus.oturumlar.get(hex(A.K.kerem.memberId))?.dogrulandi)
  // Kopuş (karşı taraf kapattı) hızlı dönem açar
  saat += T.HIZLI_SURE_MS + 1
  kerem.oturumlar.get(hex(A.K.husniye.memberId)).socket.destroy()
  await kosul(() => hus.hizliBitis > saat)
  t.ok(hus.hizliBitis > saat, 'kopuşta hızlı dönem')
})

test('yeniden arama zamanlaması (§6): hızlı dönemde her tikte, sonra 30 sn; yeni üye ve kopuş hızlandırır', async (t) => {
  const L = A.anaDefter()
  let saat = 1_800_000_000_000
  const now = () => saat
  const dht = new SahteDht()
  const tt = new T.DhtTasiyici({ dht, cihaz: () => ({ kimlik: A.K.husniye, ledger: L }), now, deneysel: true, hizliMs: 1e9 })
  t.teardown(() => tt.kapat())
  let n = 0
  const asil = tt.yokla.bind(tt)
  tt.yokla = () => { n++; asil() }
  tt.baslat()
  t.is(n, 1, 'başlangıçta hemen')
  saat += T.HIZLI_MS; tt._tik()
  saat += T.HIZLI_MS; tt._tik()
  t.is(n, 3, 'hızlı dönemde her tikte')
  saat += T.HIZLI_SURE_MS
  tt._tik()
  const m = n
  saat += T.HIZLI_MS; tt._tik()
  t.is(n, m, 'hızlı dönem bitti: 5 sn sonra arama yok')
  saat += T.YOKLAMA_MS; tt._tik()
  t.is(n, m + 1, '30 sn sonra arama')
  // Yeni üye görülünce hızlı dönem
  tt.bilinen.delete(hex(A.K.irem.memberId))
  tt.yokla()
  t.ok(tt.hizliBitis > saat, 'yeni üye hızlı dönem açar')
})

test('suspend/resume (Bare olayları): askıda arama ve oturum yok, dht.suspend; devamda dht.resume, hızlı ve kısa HELLO', async (t) => {
  const L = A.anaDefter()
  let saat = 1_800_000_000_000
  const now = () => saat
  const dht = new SahteDht()
  const kerem = kur(dht, A.K.kerem, L, now)
  const hus = kur(dht, A.K.husniye, L, now)
  const ik = islem(); const ih = islem()
  kerem.ag.dinle(ik.isl)
  hus.ag.dinle(ih.isl)
  t.teardown(async () => { await kerem.kapat(); await hus.kapat() })
  await kosul(() => ih.k.baglandi.length === 1)
  t.is(ih.k.baglandi.length, 1)
  const platform = new Yay()
  hus.platformaBagla(platform)
  platform.emit('suspend')
  await kosul(() => dht.olaylar.length === 1 && ih.k.koptu.length === 1)
  t.alike(dht.olaylar, ['suspend'])
  t.ok(hus.askida)
  t.is(ih.k.koptu.length, 1, 'oturum kapandı')
  t.is(hus.oturumlar.size, 0)
  const once = dht.baglanti
  hus.yokla(); hus._tik(); hus.agDegisti()
  await bekle(20)
  t.is(dht.baglanti, once, 'askıdayken arama yok')
  saat += T.HIZLI_SURE_MS * 2
  platform.emit('resume')
  await kosul(() => dht.olaylar.length === 2 && ih.k.baglandi.length === 2)
  t.alike(dht.olaylar, ['suspend', 'resume'])
  t.absent(hus.askida)
  t.ok(hus.hizliBitis > saat)
  t.is(ih.k.baglandi.length, 2, 'devamda yeniden bağlandı')
  t.is(hus.oturumlar.get(hex(A.K.kerem.memberId)).helloMs, T.KISA_HELLO_MS, 'devamda kısa HELLO süresi')
})

test('QR çözme kanonik (D50 bulanık test bulgusu): kesik ve fazla baytlı QR kodlu hata, sürüm QR_VERSION', (t) => {
  const { qrCoz } = require('../ceremony')
  const c = require('compact-encoding')
  const govde = b4a.concat([c.encode(c.uint, 2), b4a.from([1]), b4a.alloc(8, 1), b4a.alloc(16, 2), b4a.alloc(32, 3), b4a.alloc(16, 4), c.encode(c.uint, 1_800_000_000)])
  const qr = (b) => 'yuva://j/2/' + b4a.toString(b, 'base64url')
  const hataOf = (f) => { try { f(); return null } catch (err) { return err.message } }
  t.is(qrCoz(qr(govde)).exp, 1_800_000_000)
  t.is(hataOf(() => qrCoz(qr(b4a.from([2, 1, 5])))), 'INVALID_QR', 'kesik (önce "Out of bounds")')
  t.is(hataOf(() => qrCoz(qr(b4a.concat([govde, b4a.from([0])])))), 'INVALID_QR', 'sonda fazla bayt')
  t.is(hataOf(() => qrCoz(qr(b4a.concat([b4a.from([3]), govde.subarray(1)])))), 'QR_VERSION')
  t.is(hataOf(() => qrCoz('yuva://j/2/a+b/')), 'INVALID_QR', 'base64url dışı')
})
