// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D74: taşıyıcı üretime hazır (RFC-0028 §7 c, d, e, f, g, h, j). Ağ yok: bellek içi sahte DHT, saat elle.
// Beklenenler elle yazıldı.
'use strict'
const test = require('brittle')
const b4a = require('b4a')
const sodium = require('sodium-native')
const DHT = require('hyperdht')
const { pairs: { PairBook }, ledger: { Ledger }, hello: H } = require('@havenfold/core')
const T = require('..')
const A = require('../../records/test/helpers/family')

const hex = (b) => b4a.toString(b, 'hex')
const bekle = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms))
// Koşul gerçekleşene kadar taşıyıcılar yeniden yoklanır (sahte DHT'de sırayla kurulan taşıyıcılar)
async function yoklaKosul (tts, f, ms = 5000) { const son = Date.now() + ms; while (!f()) { if (Date.now() > son) throw new Error('TIMEOUT'); for (const x of tts) x.yokla(); await bekle(5) } }
async function kosul (f, ms = 5000) { const son = Date.now() + ms; while (!f()) { if (Date.now() > son) throw new Error('TIMEOUT'); await bekle(2) } }

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

const ORTA = T.DILIM_MS * 500_000 + T.DILIM_MS / 2 // dilimin ortası
const isl = () => { const k = { baglandi: [], koptu: [], bilgi: [] }; return { k, isl: { baglandi: (p, b) => { k.baglandi.push(p); k.bilgi.push(b) }, koptu: (p) => k.koptu.push(p), al: () => {} } } }
const kur = (dht, kim, L, now, ek = {}) => new T.DhtTasiyici({ dht, cihaz: () => ({ kimlik: kim, ledger: L, ...ek }), now, deneysel: true, yoklamaMs: 1e9, hizliMs: 1e9 })
const dilimler = (tt, peer) => [...tt.sunucular.keys()].filter((k) => k.startsWith(hex(peer.memberId) + '|')).map((k) => Number(k.split('|')[1])).sort()

test('§7 d, j: kutu her zaman dinler, telefonlar kutuyu arar (kimlik sırasından bağımsız); iki telefonda küçük kimlik arar', async (t) => {
  const L = A.anaDefter()
  const now = () => ORTA
  const dht = new SahteDht()
  const kutu = kur(dht, A.K.kutu, L, now)
  const ik = isl(); kutu.ag.dinle(ik.isl)
  const telefonlar = [A.K.kerem, A.K.husniye, A.K.irem, A.K.ecem].map((k) => { const tt = kur(dht, k, L, now); const i = isl(); tt.ag.dinle(i.isl); return { k, tt, i } })
  t.teardown(async () => { await kutu.kapat(); for (const x of telefonlar) await x.tt.kapat() })
  for (const x of telefonlar) {
    t.alike(dilimler(kutu, x.k), [T.dilimOf(ORTA)], 'kutu ' + hex(x.k.memberId).slice(0, 4) + ' için dinler (yalnız e)')
    t.alike(dilimler(x.tt, A.K.kutu), [], 'telefon kutu için dinlemez')
  }
  await kosul(() => ik.k.baglandi.length === telefonlar.length)
  t.alike(ik.k.baglandi.sort(), telefonlar.map((x) => hex(x.k.memberId)).sort(), 'her telefon kutuya bağlandı')
  t.ok(ik.k.bilgi.every((b) => b && b.caps === (H.CAPS.LEDGER_V21 | H.CAPS.KAYIT | H.CAPS.COKLU_UYGULAMA | H.CAPS.MISAFIR_YAZAR | H.CAPS.AILE_ADI | H.CAPS.UZAKTAN_IPTAL)), 'karşının HELLO.caps değeri iletilir (D77, RFC-0030 §8, RFC-0036, D106)')
  // İki telefon arasında: büyük kimlik dinler
  const [a, b] = [A.K.kerem, A.K.husniye].sort((x, y) => (hex(x.memberId) < hex(y.memberId) ? -1 : 1))
  const buyuk = telefonlar.find((x) => x.k === b)
  const kucuk = telefonlar.find((x) => x.k === a)
  t.is(dilimler(buyuk.tt, a).length, 1)
  t.is(dilimler(kucuk.tt, b).length, 0)
})

test('§7 g: e+1 dilimi yalnız dilim bitmeden 5 dakika önce açılır; arayan son dakikalarda e+1\'i de dener', async (t) => {
  const L = A.anaDefter()
  let saat = ORTA
  const dht = new SahteDht()
  const [a, b] = [A.K.kerem, A.K.husniye].sort((x, y) => (hex(x.memberId) < hex(y.memberId) ? -1 : 1))
  const dinleyen = kur(dht, b, L, () => saat)
  dinleyen.ag.dinle(isl().isl)
  t.teardown(() => dinleyen.kapat())
  const e = T.dilimOf(saat)
  t.alike(dilimler(dinleyen, a), [e], 'ortada yalnız e')
  saat = (e + 1) * T.DILIM_MS - T.ORTUSME_MS - 1
  dinleyen.yokla()
  t.alike(dilimler(dinleyen, a), [e], '5 dk 1 ms kala hâlâ yalnız e')
  saat += 1
  dinleyen.yokla()
  t.alike(dilimler(dinleyen, a), [e, e + 1], 'son 5 dakikada e ve e+1')
  saat = (e + 1) * T.DILIM_MS + 1
  dinleyen.yokla()
  t.alike(dilimler(dinleyen, a), [e + 1], 'yeni dilimde yalnız yeni e; eski kapandı')
  t.ok(dinleyen.sunucular.size <= 6, 'dinleme bütçesi: çift başına en çok bir sunucu (örtüşme dışında)')
})

test('§7 h: kutulu ailede arka planda yalnız kutu; kişiler arası oturum kapanır, öne gelince yeniden; kutusuz ailede değişmez', async (t) => {
  const L = A.anaDefter()
  const now = () => ORTA
  const dht = new SahteDht()
  const kerem = kur(dht, A.K.kerem, L, now)
  const hus = kur(dht, A.K.husniye, L, now)
  const kutu = kur(dht, A.K.kutu, L, now)
  const ik = isl(); const ih = isl()
  kerem.ag.dinle(ik.isl); hus.ag.dinle(ih.isl); kutu.ag.dinle(isl().isl)
  t.teardown(async () => { for (const x of [kerem, hus, kutu]) await x.kapat() })
  await yoklaKosul([kerem, hus, kutu], () => ih.k.baglandi.includes(hex(A.K.kerem.memberId)) && ih.k.baglandi.includes(hex(A.K.kutu.memberId)))
  const platform = new Yay()
  hus.platformaBagla(platform)
  platform.emit('arkaplan')
  t.ok(hus.arka, 'platformun arka plan olayı')
  t.ok(ih.k.koptu.includes(hex(A.K.kerem.memberId)), 'arka planda Kerem oturumu kapandı')
  t.absent(hus.oturumlar.has(hex(A.K.kerem.memberId)))
  t.ok(hus.oturumlar.get(hex(A.K.kutu.memberId))?.dogrulandi, 'kutu oturumu açık')
  t.alike([...hus.sunucular.keys()].filter((k) => !k.startsWith(hex(A.K.kutu.memberId))), [], 'kişiler için dinleme sunucusu yok')
  platform.emit('onplan')
  t.absent(hus.arka)
  await yoklaKosul([kerem, hus], () => ih.k.baglandi.filter((x) => x === hex(A.K.kerem.memberId)).length === 2)
  t.pass('öne gelince Kerem\'le yeniden bağlandı')

  // Kutusuz aile: arka planda kişiler arası oturum sürer (§6)
  const { ledger: L2 } = require('@havenfold/sdk').LedgerApi.createFamily({ Ledger, me: A.K.kerem, displayName: 'Kerem', ts: A.TS0 })
  const dht2 = new SahteDht()
  const tek = kur(dht2, A.K.kerem, L2, now)
  tek.ag.dinle(isl().isl)
  t.teardown(() => tek.kapat())
  tek.arkaPlan(true)
  t.absent(tek._yalnizKutu(L2), 'kutusuz ailede arka plan kuralı yok')
  t.ok(tek._yalnizKutu(L), 'kutulu ailede var')
})

test('§7 c: tören anahtarı çift sırrına girer; iki tarafta aynı anahtarla oturum kurulur, farklıysa kurulmaz', async (t) => {
  const L = A.anaDefter()
  const now = () => ORTA
  const kerem = hex(A.K.kerem.memberId)
  const hus = hex(A.K.husniye.memberId)
  const anahtar = b4a.alloc(32, 9)
  const yalin = new PairBook({ me: A.K.kerem, ledger: L }).get(hus).pair
  const anahtarli = new PairBook({ me: A.K.kerem, ledger: L, ceremonyKeys: new Map([[hus, anahtar]]) }).get(hus).pair
  t.not(hex(yalin), hex(anahtarli), 'anahtar çift sırrını değiştirir')
  // Aynı anahtar: bağlanır
  const dht = new SahteDht()
  const a = kur(dht, A.K.kerem, L, now, { torenAnahtarlari: new Map([[hus, hex(anahtar)]]) })
  const b = kur(dht, A.K.husniye, L, now, { torenAnahtarlari: new Map([[kerem, hex(anahtar)]]) })
  const ia = isl(); const ib = isl()
  a.ag.dinle(ia.isl); b.ag.dinle(ib.isl)
  t.teardown(async () => { await a.kapat(); await b.kapat() })
  await yoklaKosul([a, b], () => ia.k.baglandi.includes(hus))
  t.pass('aynı tören anahtarıyla oturum')
  // Yalnız bir tarafta anahtar: buluşma anahtarları farklı, oturum yok
  const dht2 = new SahteDht()
  const c = kur(dht2, A.K.kerem, L, now, { torenAnahtarlari: new Map([[hus, hex(anahtar)]]) })
  const d = kur(dht2, A.K.husniye, L, now)
  const ic = isl(); c.ag.dinle(ic.isl); d.ag.dinle(isl().isl)
  t.teardown(async () => { await c.kapat(); await d.kapat() })
  for (let i = 0; i < 10; i++) { c.yokla(); d.yokla(); await bekle(6) }
  t.absent(ic.k.baglandi.includes(hus), 'tek taraflı anahtarla bağlanılmaz')
  // Yeni anahtar gelince (harita değişir) çift sırları yeniden hesaplanır
  const m = new Map()
  const e = kur(new SahteDht(), A.K.kerem, L, now, { torenAnahtarlari: m })
  const once = hex(e._cift().kitap.get(hus).pair)
  m.set(hus, hex(anahtar))
  t.is(hex(e._cift().kitap.get(hus).pair), hex(anahtarli), 'yeni anahtar hemen geçerli')
  t.not(once, hex(anahtarli))
})

test('§7 e, f: önyükleme listesi paketle gelir (genel = HyperDHT varsayılanı, EserX boş), uygulama başına ayrı DHT düğümü', async (t) => {
  t.alike(T.ONYUKLEME.genel, DHT.BOOTSTRAP, 'genel düğümler HyperDHT sürümüyle aynı')
  t.alike(T.ONYUKLEME.eserx, [], 'EserX listesi şimdilik boş')
  t.alike(T.onyukleme(), DHT.BOOTSTRAP)
  t.alike(T.onyukleme({ genel: ['1.2.3.4@a.b:1'], eserx: ['c.d:2'] }), ['1.2.3.4@a.b:1', 'c.d:2'])
  for (const kotu of [{ genel: [] }, { genel: ['http://x'] }, { genel: [5] }]) t.exception(() => T.onyukleme(kotu), /INVALID_BOOTSTRAP/)
  const d1 = T.dhtAc({ bootstrap: [], ephemeral: true })
  const d2 = T.dhtAc({ bootstrap: [], ephemeral: true })
  t.not(d1, d2, 'her uygulama kendi düğümü')
  t.ok(d1 instanceof DHT)
  await d1.destroy()
  await d2.destroy()
})
