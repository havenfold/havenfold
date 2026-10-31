// SPDX-License-Identifier: AGPL-3.0-only
// Referans alıcı (RFC-0010 §13.1): paket ve dosya yükleme, sahibin silmesi, gelen kutusu ve ack, cevap yazma ve çekme,
// süreler, sınırlar; service.json vektörleri 11 ve 12'nin alıcı beklentileri; paket açma aracı; HTTP sarmalayıcı.
const test = require('brittle')
const b4a = require('b4a')
const { kart: Kt, paket: P, cevap: C, kodlama: K } = require('@havenfold/services')
const Y = require('../../../core/services/test/helpers/service-vector')
const F2 = require('../../../protocol/vectors/service.json')
const { Alici } = require('../receiver')
const { paketiAc, cevapYaz, duz } = require('../tools')

const hex = (b) => b4a.toString(b, 'hex')
const GUN = K.GUN_MS
const TS = Y.GOVDE.issuedAt
const h = (x) => b4a.from(x, 'hex')
const KART = Y.kartKur(Y.VETERINER)
const kart = Kt.kartCoz(KART)
const SID = hex(kart.serviceId)
const IMZA = Y.signCifti(Y.VETERINER.signSeed)
const ENC = P.sifreCifti(h(Y.VETERINER.encSeed))
const TAKMA = P.takmaAd(h(Y.GOVDE.takmaSeed))

function kur (sinir = {}) {
  const saat = { t: TS + GUN }
  const a = new Alici({ kartlar: [KART], now: () => saat.t, sinir })
  return { a, saat }
}
// Telefonun paketi: { bytes, pid, sir, owner, replySecret }. Sahip sırrı sayaçtan: her paketinki ayrı ve testlerdeki
// yanlış sırlardan (alloc(32, 1) gibi) farklı. Eskiden tek rastgele bayttı (255 değer): iki paketin sırrı ara ara
// çakışıyor, 403 yerine 204 / 204 yerine 404 dönüyordu (CI'de kararsız vektör 11–12 ve akış testi)
let sirSayaci = 0
function sahipSirri () {
  const sir = b4a.alloc(32, 0xa5)
  new DataView(sir.buffer, sir.byteOffset, 32).setUint32(0, ++sirSayaci)
  return sir
}
function paket (saat, ek = {}) {
  const cevap = P.sifreCifti()
  const govde = P.govdeKodla({ ...Y.govdeOf(Y.GOVDE, kart), replyPub: cevap.publicKey, ...ek })
  const r = P.paketKur({ kart, ic: P.icImzala(kart.serviceId, govde, TAKMA.secretKey), expiresAt: saat.t + 7 * GUN, simdi: saat.t })
  const sir = sahipSirri()
  return { bytes: r.bytes, pid: hex(r.packageId), sir, owner: P.sahipOzeti(sir), replySecret: cevap.secretKey }
}
const auth = (saat, yontem, yol, nonce = null) => C.yetkiBasligi({ serviceId: kart.serviceId, signSecret: IMZA.secretKey, t: saat.t, yontem, yol, nonce })
const put = (a, p, ip = '1.1.1.1') => a.istek({ yontem: 'PUT', yol: `/v1/p/${SID}/${p.pid}`, basliklar: { 'x-hf-owner': p.owner }, govde: p.bytes, ip }).durum

test('paket: yükleme, tekrar, biçim, hizmet yok, süre, boyut, IP sınırı; kart ve dizin', (t) => {
  const { a, saat } = kur({ ipSaat: 2, paketBayt: 4000 })
  const p = paket(saat)
  t.is(put(a, p), 201)
  t.is(put(a, p), 409, 'aynı packageId')
  t.is(a.istek({ yontem: 'PUT', yol: `/v1/p/${SID}/${p.pid}`, govde: p.bytes }).durum, 400, 'x-hf-owner yok')
  const q = paket(saat)
  t.is(a.istek({ yontem: 'PUT', yol: `/v1/p/${hex(b4a.alloc(16, 1))}/${q.pid}`, basliklar: { 'x-hf-owner': q.owner }, govde: q.bytes, ip: '2.2.2.2' }).durum, 410)
  t.is(a.istek({ yontem: 'PUT', yol: `/v1/p/${SID}/${hex(b4a.alloc(16, 2))}`, basliklar: { 'x-hf-owner': q.owner }, govde: q.bytes, ip: '2.2.2.2' }).durum, 400, 'yoldaki packageId paketinkiyle aynı değil')
  t.is(a.istek({ yontem: 'PUT', yol: `/v1/p/${SID}/${q.pid}`, basliklar: { 'x-hf-owner': q.owner }, govde: b4a.alloc(10), ip: '6.6.6.6' }).durum, 400, 'bozuk PAKET')
  t.is(a.istek({ yontem: 'PUT', yol: `/v1/p/${SID}/${q.pid}`, basliklar: { 'x-hf-owner': q.owner }, govde: b4a.alloc(4001), ip: '3.3.3.3' }).durum, 413)
  t.is(put(a, q, '1.1.1.1'), 429, 'IP başına saatte 2 (testte; tekrar da sayılır)')
  saat.t += 3_600_001
  t.is(put(a, q, '1.1.1.1'), 201, 'bir saat sonra')
  t.alike(a.istek({ yontem: 'GET', yol: `/v1/kart/${SID}` }).govde, KART)
  t.is(a.istek({ yontem: 'GET', yol: `/v1/kart/${hex(b4a.alloc(16))}` }).durum, 404)
  t.is(a.istek({ yontem: 'GET', yol: '/v1/dizin/TR-35' }).durum, 404, 'dizin yalnız Eser geçidinde')
  t.is(a.istek({ yontem: 'GET', yol: '/v2/x' }).durum, 404)
  t.is(a.istek({ yontem: 'GET', yol: `/v1/p/${SID}/${p.pid}` }).durum, 405)
  t.is(a.istek({ yontem: 'PATCH', yol: `/v1/b/${SID}/${hex(b4a.alloc(32))}/0` }).durum, 405)
  t.is(a.istek({ yontem: 'GET', yol: '/v1/bilinmeyen' }).durum, 404)
  // Paketin süresi (expiresAt) geçerse teslim edilmemiş paket silinir
  const r = paket(saat)
  t.is(put(a, r, '4.4.4.4'), 201)
  saat.t += 8 * GUN
  t.is(a.istek({ yontem: 'DELETE', yol: `/v1/p/${SID}/${r.pid}`, basliklar: { 'x-hf-owner-secret': hex(r.sir) } }).durum, 404)
  // Süresi 7 günden uzun paket kabul edilmez
  const u = paket(saat)
  const pp = P.paketCoz(u.bytes)
  const uzun = require('compact-encoding').encode(K.PAKET, { ...pp, expiresAt: saat.t + 8 * GUN })
  t.is(a.istek({ yontem: 'PUT', yol: `/v1/p/${SID}/${u.pid}`, basliklar: { 'x-hf-owner': u.owner }, govde: uzun, ip: '5.5.5.5' }).durum, 400)
})

test('dosya: yükleme, tekrar, toplam boyut; hizmet yetkiyle çeker', (t) => {
  const { a, saat } = kur({ dosyaToplam: 10 })
  const p = paket(saat)
  const yol = (i) => `/v1/b/${SID}/${hex(b4a.alloc(32, 7))}/${i}`
  t.is(a.istek({ yontem: 'PUT', yol: yol(0), basliklar: { 'x-hf-owner': p.owner }, govde: b4a.alloc(6) }).durum, 201)
  t.is(a.istek({ yontem: 'PUT', yol: yol(0), basliklar: { 'x-hf-owner': p.owner }, govde: b4a.alloc(1) }).durum, 409)
  t.is(a.istek({ yontem: 'PUT', yol: yol(1), basliklar: { 'x-hf-owner': p.owner }, govde: b4a.alloc(6) }).durum, 413)
  t.is(a.istek({ yontem: 'PUT', yol: yol(1) }).durum, 400)
  t.is(a.istek({ yontem: 'PUT', yol: `/v1/b/${hex(b4a.alloc(16, 3))}/${hex(b4a.alloc(32))}/0`, basliklar: { 'x-hf-owner': p.owner } }).durum, 410)
  t.is(a.istek({ yontem: 'GET', yol: yol(0) }).durum, 401)
  t.is(a.istek({ yontem: 'GET', yol: yol(0), basliklar: { 'x-hf-auth': auth(saat, 'GET', yol(0)) } }).govde.byteLength, 6)
  t.is(a.istek({ yontem: 'GET', yol: yol(5), basliklar: { 'x-hf-auth': auth(saat, 'GET', yol(5)) } }).durum, 404)
})

test('akış: gelen kutusu teslim eder, sahibin silmesi teslimden sonra 409; ack ile içerik silinir; cevap yazılır ve çekilir', (t) => {
  const { a, saat } = kur()
  const p = paket(saat)
  const q = paket(saat)
  const blob = `/v1/b/${SID}/${hex(b4a.alloc(32, 8))}/0`
  a.istek({ yontem: 'PUT', yol: blob, basliklar: { 'x-hf-owner': p.owner }, govde: b4a.from('dosya') })
  t.is(put(a, p), 201)
  t.is(put(a, q), 201)
  const sil = (x, sir) => a.istek({ yontem: 'DELETE', yol: `/v1/p/${SID}/${x.pid}`, basliklar: { 'x-hf-owner-secret': sir } }).durum
  t.is(sil(q, hex(b4a.alloc(32, 1))), 403)
  t.is(sil(q, 'xyz'), 403)
  t.is(sil(q, hex(q.sir)), 204, 'teslimden önce sahip siler')
  t.is(sil(q, hex(q.sir)), 404)
  saat.t += 1000
  const gYol = `/v1/inbox/${SID}?after=0`
  t.is(a.istek({ yontem: 'GET', yol: gYol }).durum, 401)
  const nonce = b4a.alloc(16, 4)
  const g = a.istek({ yontem: 'GET', yol: gYol, basliklar: { 'x-hf-auth': auth(saat, 'GET', gYol, nonce) } })
  t.is(g.durum, 200)
  t.alike(g.govde.paketler.map((x) => [x.packageId, x.dosyalar.length]), [[p.pid, 1]])
  t.is(a.istek({ yontem: 'GET', yol: gYol, basliklar: { 'x-hf-auth': auth(saat, 'GET', gYol, nonce) } }).durum, 401, 'aynı nonce')
  t.is(sil(p, hex(p.sir)), 409, 'teslim edildi')
  // Hizmet açar (paket baytları gelen kutusundan)
  const ac = P.paketAc(b4a.from(g.govde.paketler[0].bytes, 'base64'), { kart, encSecret: ENC.secretKey })
  t.is(ac.govde.title, Y.GOVDE.title)
  // ack: useUntil ile; dosya ve paket baytları silinir
  const ackYol = `/v1/ack/${SID}/${p.pid}`
  const uu = b4a.alloc(8)
  new DataView(uu.buffer, uu.byteOffset).setBigUint64(0, BigInt(saat.t + 2 * GUN))
  t.is(a.istek({ yontem: 'POST', yol: ackYol, basliklar: { 'x-hf-auth': auth(saat, 'POST', ackYol) }, govde: b4a.alloc(3) }).durum, 400)
  t.is(a.istek({ yontem: 'POST', yol: ackYol, basliklar: { 'x-hf-auth': auth(saat, 'POST', ackYol) }, govde: uu }).durum, 204)
  t.is(a.istek({ yontem: 'POST', yol: `/v1/ack/${SID}/${q.pid}`, basliklar: { 'x-hf-auth': auth(saat, 'POST', `/v1/ack/${SID}/${q.pid}`) } }).durum, 404)
  t.is(a.istek({ yontem: 'GET', yol: blob, basliklar: { 'x-hf-auth': auth(saat, 'GET', blob) } }).durum, 404, 'ack ile dosya silindi')
  t.is(a.istek({ yontem: 'GET', yol: `/v1/inbox/${SID}?after=0`, basliklar: { 'x-hf-auth': auth(saat, 'GET', `/v1/inbox/${SID}?after=0`) } }).govde.paketler.length, 0)
  // Cevap
  const cYol = (n) => `/v1/r/${p.pid}/${n}`
  const cevap = (n, ek = {}) => C.cevapKur({ packageId: h(p.pid), n, replyPub: ac.govde.replyPub, signSecret: IMZA.secretKey, kind: 'makbuz', text: 'Alındı.', at: saat.t, ...ek })
  t.is(a.istek({ yontem: 'PUT', yol: cYol(0), basliklar: { 'x-hf-auth': auth(saat, 'PUT', cYol(0)) }, govde: cevap(1) }).durum, 400, 'yoldaki n cevabınkiyle aynı değil')
  t.is(a.istek({ yontem: 'PUT', yol: cYol(0), basliklar: { 'x-hf-auth': auth(saat, 'PUT', cYol(0)) }, govde: b4a.alloc(5) }).durum, 400)
  t.is(a.istek({ yontem: 'PUT', yol: cYol(0), basliklar: { 'x-hf-auth': auth(saat, 'PUT', cYol(0)) }, govde: cevap(0) }).durum, 201)
  t.is(a.istek({ yontem: 'PUT', yol: cYol(1), basliklar: { 'x-hf-auth': auth(saat, 'PUT', cYol(1)) }, govde: cevap(1, { kind: 'mesaj', text: 'Yarın gelin.' }) }).durum, 201)
  const rYol = `/v1/r/${p.pid}?after=0`
  t.is(a.istek({ yontem: 'GET', yol: rYol }).durum, 403)
  const l = a.istek({ yontem: 'GET', yol: rYol, basliklar: { 'x-hf-owner-secret': hex(p.sir) } }).govde.cevaplar
  t.alike(l.map((x) => x.n), [1])
  const hepsi = a.istek({ yontem: 'GET', yol: `/v1/r/${p.pid}`, basliklar: { 'x-hf-owner-secret': hex(p.sir) } }).govde.cevaplar
  t.alike(hepsi.map((x) => C.cevapAc(b4a.from(x.bytes, 'base64'), { packageId: h(p.pid), replySecret: p.replySecret, signPub: kart.signPub }).kind), ['makbuz', 'mesaj'])
  // Cevap penceresi bitince 410, içerik silinir; iz 30 gün sonra gider
  saat.t += 2 * GUN + 1
  t.is(a.istek({ yontem: 'PUT', yol: cYol(2), basliklar: { 'x-hf-auth': auth(saat, 'PUT', cYol(2)) }, govde: cevap(2) }).durum, 410)
  t.alike(a.istek({ yontem: 'GET', yol: `/v1/r/${p.pid}`, basliklar: { 'x-hf-owner-secret': hex(p.sir) } }).govde.cevaplar, [])
  saat.t += 31 * GUN
  t.is(a.istek({ yontem: 'PUT', yol: cYol(2), basliklar: { 'x-hf-auth': auth(saat, 'PUT', cYol(2)) }, govde: cevap(2) }).durum, 404)
})

test('vektör 11 ve 12: alıcının HTTP durumları (service.json)', (t) => {
  const m11 = F2.maddeler.find((m) => m.no === 11)
  const m12 = F2.maddeler.find((m) => m.no === 12)
  const { a, saat } = kur()
  const gozlenen11 = {}
  const gozlenen12 = {}
  // 12: gelen kutusu yetkisi ve nonce; sahibin silmesi
  const p = paket(saat)
  const q = paket(saat)
  put(a, p)
  put(a, q)
  const gYol = `/v1/inbox/${SID}?after=0`
  const nonce = h(m12.girdi.nonce)
  gozlenen12.ilk = a.istek({ yontem: 'GET', yol: gYol, basliklar: { 'x-hf-auth': auth(saat, 'GET', gYol, nonce) } }).durum
  gozlenen12.ayniNonce = a.istek({ yontem: 'GET', yol: gYol, basliklar: { 'x-hf-auth': auth(saat, 'GET', gYol, nonce) } }).durum
  const r = paket(saat)
  put(a, r)
  gozlenen12.yanlisSahip = a.istek({ yontem: 'DELETE', yol: `/v1/p/${SID}/${r.pid}`, basliklar: { 'x-hf-owner-secret': hex(q.sir) } }).durum
  gozlenen12.dogruSahipSilme = a.istek({ yontem: 'DELETE', yol: `/v1/p/${SID}/${r.pid}`, basliklar: { 'x-hf-owner-secret': hex(r.sir) } }).durum
  gozlenen12.teslimdenSonraSilme = a.istek({ yontem: 'DELETE', yol: `/v1/p/${SID}/${p.pid}`, basliklar: { 'x-hf-owner-secret': hex(p.sir) } }).durum
  t.alike(gozlenen12, m12.alici)
  t.is(P.sahipOzeti(h(m12.girdi.ownerSecret)), m12.beklenen.owner)
  // 11: cevap n tekrarı, 16. cevap, teslim edilmemiş pakete cevap, useUntil sonrası, yetkisiz
  const teslimsiz = paket(saat)
  put(a, teslimsiz)
  const ackYol = `/v1/ack/${SID}/${p.pid}`
  const uu = b4a.alloc(8)
  new DataView(uu.buffer, uu.byteOffset).setBigUint64(0, BigInt(saat.t + GUN))
  a.istek({ yontem: 'POST', yol: ackYol, basliklar: { 'x-hf-auth': auth(saat, 'POST', ackYol) }, govde: uu })
  const cevap = (pid, n) => C.cevapKur({ packageId: h(pid), n, replyPub: P.sifreCifti().publicKey, signSecret: IMZA.secretKey, kind: 'makbuz', at: saat.t })
  const yaz = (pid, n, ek = {}) => a.istek({ yontem: 'PUT', yol: `/v1/r/${pid}/${n}`, basliklar: { 'x-hf-auth': auth(saat, 'PUT', `/v1/r/${pid}/${n}`) }, govde: n < 16 ? cevap(pid, n) : cevap(pid, 0), ...ek }).durum
  gozlenen11.yetkisiz = yaz(p.pid, 0, { basliklar: {} })
  gozlenen11.ilkCevap = yaz(p.pid, 0)
  gozlenen11.ayniN = yaz(p.pid, 0)
  gozlenen11.n16 = yaz(p.pid, 16)
  gozlenen11.teslimsizCevap = yaz(teslimsiz.pid, 0)
  saat.t += GUN + 1
  gozlenen11.useUntilSonrasi = yaz(p.pid, 1)
  t.alike(gozlenen11, m11.alici)
})

test('süreler ve sınırlar (açıklama 2 madde 3, 4): ack\'siz teslim paket expiresAt\'te silinir; bağsız dosya 1 saatte; paket + dosya min(maxMB, 25); vekil; adres tablosu', (t) => {
  const { a, saat } = kur({ ipSaat: 2 })
  const p = paket(saat)
  t.is(put(a, p), 201)
  const gYol = `/v1/inbox/${SID}?after=0`
  t.is(a.istek({ yontem: 'GET', yol: gYol, basliklar: { 'x-hf-auth': auth(saat, 'GET', gYol) } }).govde.paketler.length, 1)
  // Teslim edildi ama ack yok: cevap yazılamaz, expiresAt'te silinir
  const cYol = `/v1/r/${p.pid}/0`
  t.is(a.istek({ yontem: 'PUT', yol: cYol, basliklar: { 'x-hf-auth': auth(saat, 'PUT', cYol) }, govde: b4a.alloc(3) }).durum, 404)
  saat.t += 7 * GUN + 1
  t.is(a.istek({ yontem: 'DELETE', yol: `/v1/p/${SID}/${p.pid}`, basliklar: { 'x-hf-owner-secret': hex(p.sir) } }).durum, 404, 'silindi')
  // Pakete bağlanmamış dosya 1 saat sonra gider; bağlanmış kalır
  const q = paket(saat)
  const yolB = (n) => `/v1/b/${SID}/${hex(b4a.alloc(32, n))}/0`
  t.is(a.istek({ yontem: 'PUT', yol: yolB(1), basliklar: { 'x-hf-owner': 'ab'.repeat(32) }, govde: b4a.alloc(4), ip: '7.7.7.7' }).durum, 201)
  t.is(a.istek({ yontem: 'PUT', yol: yolB(2), basliklar: { 'x-hf-owner': q.owner }, govde: b4a.alloc(4), ip: '7.7.7.7' }).durum, 201)
  t.is(put(a, q, '8.8.8.8'), 201)
  saat.t += 3_600_001
  const cek = (n) => a.istek({ yontem: 'GET', yol: yolB(n), basliklar: { 'x-hf-auth': auth(saat, 'GET', yolB(n)) } }).durum
  t.alike([cek(1), cek(2)], [404, 200])
  // Paket + dosyalar en çok min(maxMB, 25): VETERINER 20 MB
  const r = paket(saat)
  t.is(a.istek({ yontem: 'PUT', yol: yolB(3), basliklar: { 'x-hf-owner': r.owner }, govde: b4a.alloc(20 * 1024 * 1024 - 100), ip: '9.9.9.9' }).durum, 201)
  t.is(put(a, r, '9.9.9.9'), 413, 'paket dosyalarla birlikte sınırı aşar')
  t.is(a.istek({ yontem: 'PUT', yol: yolB(4), basliklar: { 'x-hf-owner': r.owner }, govde: b4a.alloc(200), ip: '9.9.9.9' }).durum, 413)
  // Yeni sahip adres sınırına sayılır (saatte 2, testte)
  t.is(a.istek({ yontem: 'PUT', yol: yolB(5), basliklar: { 'x-hf-owner': 'cd'.repeat(32) }, govde: b4a.alloc(1), ip: '9.9.9.9' }).durum, 201)
  t.is(a.istek({ yontem: 'PUT', yol: yolB(6), basliklar: { 'x-hf-owner': 'ef'.repeat(32) }, govde: b4a.alloc(1), ip: '9.9.9.9' }).durum, 429)
  // 30 gündür görülmeyen adresin kaydı düşer
  t.ok(a.ip.has('9.9.9.9'))
  saat.t += 31 * GUN
  a.istek({ yontem: 'GET', yol: '/v1/dizin/TR-35' })
  t.absent(a.ip.has('9.9.9.9'))
  t.is(a.sahipIp.size, 0)
})

test('ters vekil: yalnız yapılandırılmış vekilden gelen istekte adres başlıktan', (t) => {
  const saat = { t: TS + GUN }
  const a = new Alici({ kartlar: [KART], now: () => saat.t, sinir: { ipSaat: 1 }, vekil: { adresler: ['127.0.0.1'] } })
  const gonder = (ip, xff) => { const p = paket(saat); return a.istek({ yontem: 'PUT', yol: `/v1/p/${SID}/${p.pid}`, basliklar: { 'x-hf-owner': p.owner, ...(xff ? { 'x-forwarded-for': xff } : {}) }, govde: p.bytes, ip }).durum }
  // Vekil gördüğü adresi sona ekler ($proxy_add_x_forwarded_for); öncesini istemci yazabilir: son değer sayılır
  t.is(gonder('127.0.0.1', '9.9.9.1, 1.2.3.4'), 201)
  t.is(gonder('127.0.0.1', '5.6.7.8'), 201, 'vekil arkasında farklı istemciler ayrı sayılır')
  t.is(gonder('127.0.0.1', '1.2.3.4'), 429)
  t.is(gonder('127.0.0.1', '7.7.7.7, 1.2.3.4'), 429, 'istemcinin yazdığı ilk değerle sınır atlatılmaz')
  t.is(gonder('10.0.0.9', '9.9.9.9'), 201, 'vekil olmayanın başlığı yok sayılır')
  t.is(gonder('10.0.0.9', '8.8.8.8'), 429)
  t.is(gonder('127.0.0.1', ''), 201, 'başlıksız vekil isteği vekilin adresiyle')
  // Codex 5. tur: çift yığınlı soket vekili ::ffff:127.0.0.1 diye verir; yapılandırılan 127.0.0.1 ile eşleşir
  t.is(a.adres('::ffff:127.0.0.1', { 'x-forwarded-for': '3.3.3.3' }), '3.3.3.3')
  t.is(a.adres('::FFFF:127.0.0.1', { 'x-forwarded-for': '3.3.3.4' }), '3.3.3.4')
  t.is(gonder('::ffff:127.0.0.1', '6.6.6.6'), 201, 'eşlenmiş adresten gelen vekil isteği istemcinin adresiyle')
  const v6 = new Alici({ kartlar: [KART], vekil: { adresler: ['::1', '::FFFF:10.0.0.1'] } })
  t.is(v6.adres('::1', { 'x-forwarded-for': '4.4.4.4' }), '4.4.4.4')
  t.is(v6.adres('10.0.0.1', { 'x-forwarded-for': '4.4.4.5' }), '4.4.4.5', 'yapılandırmadaki eşlenmiş adres de IPv4 sayılır')
})

test('paket açma aracı: gövde JSON, öğe alanları çözülmüş', (t) => {
  const saat = { t: TS + GUN }
  const p = paket(saat)
  const j = paketiAc({ kartBytes: KART, encSecret: ENC.secretKey, paketBytes: p.bytes })
  t.alike([j.packageId, j.kind, j.title, j.ogeler[0].type, j.ogeler[0].alanlar.adet, j.dosyalar.length, j.ref], [p.pid, 'tek', Y.GOVDE.title, 'yuva.pet.kum', 2, 1, null])
  t.alike(duz({ a: [b4a.from([1]), 2n] }), { a: ['01', '2'] })
  // Cevaplar: makbuz telefonda açılır; silindi yalnız silme paketine; ret imzası geçersiz pakete de
  const yaz = (o) => cevapYaz({ kartBytes: KART, signSecret: IMZA.secretKey, encSecret: ENC.secretKey, at: TS, ...o })
  const m = yaz({ paketBytes: p.bytes, kind: 'makbuz', text: 'Alındı.' })
  t.alike(C.cevapAc(h(m.cevap), { packageId: h(p.pid), replySecret: p.replySecret, signPub: kart.signPub }).text, 'Alındı.')
  for (const kind of ['silindi', 'reklam']) t.exception(() => yaz({ paketBytes: p.bytes, kind }), /REPLY_CORRUPT/)
  const silme = P.govdeKodla({ ...Y.govdeOf(Y.GOVDE, kart), kind: 'silme', items: [], files: [], ref: b4a.alloc(16, 5) })
  const sp = P.paketKur({ kart, ic: P.icImzala(kart.serviceId, silme, TAKMA.secretKey), expiresAt: saat.t + GUN, simdi: saat.t })
  t.is(yaz({ paketBytes: sp.bytes, kind: 'silindi' }).ref, hex(b4a.alloc(16, 5)))
  t.is(paketiAc({ kartBytes: KART, encSecret: ENC.secretKey, paketBytes: sp.bytes }).ref, hex(b4a.alloc(16, 5)))
  const sahte = P.paketKur({ kart, ic: P.icImzala(kart.serviceId, P.govdeKodla(Y.govdeOf(Y.GOVDE, kart)), P.takmaAd().secretKey), expiresAt: saat.t + GUN, simdi: saat.t })
  t.exception(() => yaz({ paketBytes: sahte.bytes, kind: 'makbuz' }), /INVALID_SIGNATURE/)
  t.is(yaz({ paketBytes: sahte.bytes, kind: 'ret', text: 'İmza doğrulanamadı.' }).n, 0)
  t.exception(() => yaz({ paketBytes: b4a.alloc(10), kind: 'ret' }), /PACKAGE_CORRUPT/)
})

test('depo sınırları (açılış öncesi inceleme): boş parça yok; sahip başına parça sayısı; bütün depo bayt ve adet sınırı', (t) => {
  const { a, saat } = kur({ ipSaat: 1, dosyaAdet: 3, depoBayt: 40, depoAdet: 6 })
  const sahip = 'ab'.repeat(32)
  const yolB = (n) => `/v1/b/${SID}/${hex(b4a.alloc(32, n))}/0`
  const yukle = (n, boy, owner = sahip, ip = '7.7.7.7') => a.istek({ yontem: 'PUT', yol: yolB(n), basliklar: { 'x-hf-owner': owner }, govde: b4a.alloc(boy), ip }).durum
  t.is(yukle(1, 0), 400, 'boş parça bellekte kayıt açmaz')
  t.alike([yukle(1, 5), yukle(2, 5), yukle(3, 5)], [201, 201, 201])
  t.is(yukle(4, 5), 413, 'aynı sahip hız sınırına takılmasa da parça sayısı sınırlı')
  t.is(a.dosyalar.size, 3)
  // Bütün depo: başka sahip (yeni adres) 40 baytı aşamaz
  t.is(yukle(5, 30, 'cd'.repeat(32), '8.8.8.8'), 507, '15 + 30 > 40')
  t.is(yukle(5, 20, 'cd'.repeat(32), '8.8.8.8'), 201)
  const p = paket(saat)
  t.is(put(a, p, '9.9.9.9'), 507, 'paket de bütün depo sınırına sayılır')
})

test('adres anahtarı: IPv6 /64, IPv4\'e eşlenmiş IPv6 IPv4; bir /64\'ün adresleri tek sayılır', (t) => {
  const { adresAnahtari } = require('../receiver')
  t.is(adresAnahtari('1.2.3.4'), '1.2.3.4')
  t.is(adresAnahtari('::ffff:1.2.3.4'), '1.2.3.4')
  t.is(adresAnahtari('2001:db8:1:2:aaaa::1'), '2001:db8:1:2::/64')
  t.is(adresAnahtari('2001:db8:1:2:bbbb:cccc:dddd:eeee'), '2001:db8:1:2::/64')
  t.is(adresAnahtari('2001:db8::5'), '2001:db8:0:0::/64')
  const saat = { t: TS + GUN }
  const a = new Alici({ kartlar: [KART], now: () => saat.t, sinir: { ipSaat: 1 } })
  const gonder = (ip) => { const p = paket(saat); return a.istek({ yontem: 'PUT', yol: `/v1/p/${SID}/${p.pid}`, basliklar: { 'x-hf-owner': p.owner }, govde: p.bytes, ip }).durum }
  t.is(gonder('2001:db8:1:2::10'), 201)
  t.is(gonder('2001:db8:1:2::11'), 429, 'aynı /64')
  t.is(gonder('2001:db8:1:3::10'), 201, 'başka /64')
})

test('kotalar (açılış öncesi inceleme): sahip başına paketler de sayılır; adres saatlik bayt; hizmet deposu; ack penceresi', (t) => {
  const { a, saat } = kur({ ipSaat: 100 })
  const p = paket(saat)
  const boy = p.bytes.byteLength
  // Aynı sahibin ikinci paketi sahip toplamına sayılır (min(maxMB, dosyaToplam))
  const k = kur({ ipSaat: 100, dosyaToplam: boy + 10 })
  const p1 = paket(k.saat)
  t.is(put(k.a, p1), 201)
  const p2 = paket(k.saat)
  t.is(k.a.istek({ yontem: 'PUT', yol: `/v1/p/${SID}/${p2.pid}`, basliklar: { 'x-hf-owner': p1.owner }, govde: p2.bytes, ip: '1.1.1.1' }).durum, 413, 'aynı sahip ikinci paket')
  // Adres başına saatlik bayt
  const b = kur({ ipSaat: 100, ipSaatBayt: boy * 2 + 1 })
  t.alike([put(b.a, paket(b.saat)), put(b.a, paket(b.saat)), put(b.a, paket(b.saat))], [201, 201, 429])
  b.saat.t += 3_600_001
  t.is(put(b.a, paket(b.saat)), 201, 'saat dolunca yeniden')
  // Hizmet deposu
  const s = kur({ ipSaat: 100, servisBayt: boy + 1 })
  t.alike([put(s.a, paket(s.saat), '1.1.1.1'), put(s.a, paket(s.saat), '2.2.2.2')], [201, 507])
  // ack: sıfır ya da geçmiş useUntil reddedilir
  t.is(put(a, p), 201)
  const aYol = `/v1/ack/${SID}/${p.pid}`
  const g = Buffer.alloc(8)
  t.is(a.istek({ yontem: 'POST', yol: aYol, basliklar: { 'x-hf-auth': auth(saat, 'POST', aYol) }, govde: g }).durum, 400, 'useUntil 0')
})

test('gelen kutusu sayfalı: en çok gelenAdet paket; imleç (t, packageId); aynı t sayfalara bölünür, kaybolmaz', (t) => {
  const { a, saat } = kur({ ipSaat: 100, gelenAdet: 2 })
  for (let i = 0; i < 3; i++) { t.is(put(a, paket(saat), '1.1.1.' + i), 201); saat.t += 1000 }
  for (let i = 0; i < 3; i++) t.is(put(a, paket(saat), '1.1.2.' + i), 201) // son üçü aynı t
  const al = (imlec) => { const y = `/v1/inbox/${SID}?${imlec}`; return a.istek({ yontem: 'GET', yol: y, basliklar: { 'x-hf-auth': auth(saat, 'GET', y) } }).govde }
  const gorulen = []
  let imlec = 'after=0'
  const sayfalar = []
  for (let i = 0; i < 5; i++) {
    const g = al(imlec)
    sayfalar.push([g.paketler.length, g.devam])
    gorulen.push(...g.paketler.map((x) => x.packageId))
    if (!g.devam) break
    const son = g.paketler.at(-1)
    imlec = `after=${son.t}&afterId=${son.packageId}`
  }
  t.alike(sayfalar, [[2, true], [2, true], [2, false]], 'her sayfa en çok gelenAdet (Codex 4. tur: aynı t sınırı aşmaz)')
  t.is(new Set(gorulen).size, 6, 'hepsi bir kez')
  // Codex 5. tur: afterId'siz after > 0 (eski istemci aynı t'deki kalanları atlardı) ve bozuk imleç 400
  const durum = (imlec) => { const y = `/v1/inbox/${SID}?${imlec}`; return a.istek({ yontem: 'GET', yol: y, basliklar: { 'x-hf-auth': auth(saat, 'GET', y) } }).durum }
  t.is(durum(`after=${saat.t}`), 400)
  t.is(durum(`after=${saat.t}&afterId=xyz`), 400)
  t.is(durum('after=-1'), 400)
  t.is(durum('after=1e3'), 400)
  t.is(durum(`after=0&afterId=${'0'.repeat(32)}`), 200)
  // Bayt sınırı da kesin: tek paket sınırdan büyükse yalnız o
  const b = kur({ ipSaat: 100 })
  const boy = paket(b.saat).bytes.byteLength
  const k = kur({ ipSaat: 100, gelenBayt: boy + 1 })
  for (let i = 0; i < 3; i++) t.is(put(k.a, paket(k.saat), '1.1.3.' + i), 201)
  const y = `/v1/inbox/${SID}?after=0`
  t.is(k.a.istek({ yontem: 'GET', yol: y, basliklar: { 'x-hf-auth': auth(k.saat, 'GET', y) } }).govde.paketler.length, 1)
  const kucuk = kur({ ipSaat: 100, gelenBayt: 1 })
  t.is(put(kucuk.a, paket(kucuk.saat)), 201)
  t.is(kucuk.a.istek({ yontem: 'GET', yol: y, basliklar: { 'x-hf-auth': auth(kucuk.saat, 'GET', y) } }).govde.paketler.length, 1, 'ilerleme: sınırdan büyük tek paket')
})

test('cevaplar hizmet deposuna sayılır (servisBayt; Codex 4. tur)', (t) => {
  const { a, saat } = kur()
  const p = paket(saat)
  t.is(put(a, p), 201)
  const ackYol = `/v1/ack/${SID}/${p.pid}`
  t.is(a.istek({ yontem: 'POST', yol: ackYol, basliklar: { 'x-hf-auth': auth(saat, 'POST', ackYol) } }).durum, 204) // paket baytları silinir
  const ac = P.paketAc(p.bytes, { kart, encSecret: ENC.secretKey })
  const cevap = (n) => C.cevapKur({ packageId: h(p.pid), n, replyPub: ac.govde.replyPub, signSecret: IMZA.secretKey, kind: 'mesaj', text: 'x'.repeat(500), at: saat.t })
  const yaz = (n) => { const y = `/v1/r/${p.pid}/${n}`; return a.istek({ yontem: 'PUT', yol: y, basliklar: { 'x-hf-auth': auth(saat, 'PUT', y) }, govde: cevap(n) }).durum }
  a.sinir.servisBayt = 2 * cevap(0).byteLength + 10 // paket ack ile silindi: hizmet deposunda yalnız cevaplar
  const sonuc = []
  for (let n = 0; n < 4; n++) sonuc.push(yaz(n))
  t.alike(sonuc, [201, 201, 507, 507])
})

test('ön denetim (gövde okunmadan): yol, yöntem, sahip başlığı, hizmet; yolun gövde sınırı', (t) => {
  const { a, saat } = kur()
  const o = (yontem, yol, basliklar = {}) => a.onDenetim({ yontem, yol, basliklar })
  const owner = { 'x-hf-owner': hex(b4a.alloc(32, 1)) }
  const yok = hex(b4a.alloc(16, 9))
  const pid = hex(b4a.alloc(16, 3))
  t.alike(o('PUT', '/v2/p'), { durum: 404 })
  t.alike(o('PUT', `/v1/p/${SID}/xyz`, owner), { durum: 404 })
  t.alike(o('POST', `/v1/p/${SID}/${pid}`, owner), { durum: 405 })
  t.alike(o('PUT', `/v1/p/${SID}/${pid}`), { durum: 400 }, 'sahip başlığı yok')
  t.alike(o('PUT', `/v1/p/${yok}/${pid}`, owner), { durum: 410 })
  t.alike(o('PUT', `/v1/p/${SID}/${pid}`, owner), { enCok: Math.min(25, kart.maxMB) * 1024 * 1024 })
  t.alike(o('PUT', `/v1/b/${SID}/${hex(b4a.alloc(32, 2))}/0`, owner), { enCok: Math.min(25, kart.maxMB) * 1024 * 1024 })
  t.alike(o('PUT', `/v1/r/${pid}/0`), { durum: 404 }, 'paket yok')
  const p = paket(saat)
  t.is(put(a, p), 201)
  t.alike(o('PUT', `/v1/r/${p.pid}/0`), { enCok: 10 * 1024 * 1024 + 64 * 1024 })
  t.alike(o('POST', `/v1/ack/${SID}/${p.pid}`), { enCok: 8 })
  t.alike(o('GET', `/v1/inbox/${SID}?after=0`), { enCok: 0 })
  t.alike(o('GET', `/v1/kart/${SID}`), { enCok: 0 })
  t.alike(o('DELETE', `/v1/p/${SID}/${p.pid}`), { enCok: 0 })
  t.is(a.adres('::ffff:1.2.3.4'), '1.2.3.4')
})

test('sunucu: alıcının beklenmedik hatası 500, süreç düşmez; bildirilen boy sınırı aşıyorsa gövde okunmadan 413', { skip: typeof Bare !== 'undefined' }, async (t) => { // eslint-disable-line no-undef
  const { sunucuKur } = require('../server')
  const s = sunucuKur({ istek () { throw new Error('beklenmedik') } }, { enCokBayt: 10 })
  await new Promise((resolve) => s.listen(0, '127.0.0.1', resolve))
  const kok = 'http://127.0.0.1:' + s.address().port
  try {
    t.is((await fetch(kok + '/v1/kart/x')).status, 500)
    t.is((await fetch(kok + '/v1/kart/x')).status, 500, 'ikinci istek de: sunucu ayakta')
    t.is((await fetch(kok + '/v1/p/x/y', { method: 'PUT', body: Buffer.alloc(11) })).status, 413)
  } finally {
    await new Promise((resolve) => s.close(resolve))
  }
})

test('HTTP sarmalayıcı: yerel bağlantıda kart ve paket', { skip: typeof Bare !== 'undefined' }, async (t) => { // eslint-disable-line no-undef
  const { sunucuKur } = require('../server')
  const { a, saat } = kur()
  const s = sunucuKur(a, { enCokBayt: 100_000, kaynak: 'https://ornek.com/alici@abc123' })
  await new Promise((resolve) => s.listen(0, '127.0.0.1', resolve))
  const kok = 'http://127.0.0.1:' + s.address().port
  try {
    for (const yol of ['/source', '/kaynak']) {
      const kaynak = await fetch(kok + yol)
      t.is(await kaynak.text(), 'https://ornek.com/alici@abc123\n', 'AGPL §13: kaynak adresi ' + yol)
    }
    const k = await fetch(kok + '/v1/kart/' + SID)
    t.is(k.status, 200)
    t.is(k.headers.get('x-hf-source'), 'https://ornek.com/alici@abc123', 'her cevapta kaynak başlığı')
    t.is(k.headers.get('x-hf-kaynak'), 'https://ornek.com/alici@abc123', 'eski başlık adı da')
    t.alike(b4a.from(await k.arrayBuffer()), KART)
    const p = paket(saat)
    const r = await fetch(kok + `/v1/p/${SID}/${p.pid}`, { method: 'PUT', headers: { 'x-hf-owner': p.owner }, body: p.bytes })
    t.is(r.status, 201)
    const g = await fetch(kok + `/v1/r/${p.pid}`, { headers: { 'x-hf-owner-secret': hex(p.sir) } })
    t.alike(await g.json(), { cevaplar: [] })
  } finally {
    await new Promise((resolve) => s.close(resolve))
  }
  // 413: sunucu gövdeyi okumayı bırakıp cevabı yazar ve bağlantıyı keser. Gövde büyükse istemci hâlâ gönderirken
  // bağlantı kesilir ve yavaş makinede cevap yerine bağlantı hatası görülür (CI'da c8 altında bir kez). Sınır küçük
  // tutulur: gövde tek seferde soket arabelleğine sığar, istemci göndermeyi bitirmiş olur.
  const k = sunucuKur(a, { enCokBayt: 1000 })
  await new Promise((resolve) => k.listen(0, '127.0.0.1', resolve))
  try {
    const p = paket(saat)
    const buyuk = await fetch('http://127.0.0.1:' + k.address().port + `/v1/p/${SID}/${p.pid}`, { method: 'PUT', headers: { 'x-hf-owner': p.owner }, body: b4a.alloc(4000) })
    t.is(buyuk.status, 413, '413 yazılır, bağlantı sonra kapanır')
  } finally {
    await new Promise((resolve) => k.close(resolve))
  }
})

// Gövde belleğe alınmadan (Codex 4. tur): yanlış yol alıcıya ulaşmadan reddedilir; istemci başına eşzamanlı istek ve
// bütün bekleyen gövdeler sınırlı; biten ya da kopan istek ayrılan baytı bırakır
test('sunucu: ön denetim, istemci başına eşzamanlılık ve toplam bekleyen gövde bütçesi', { skip: typeof Bare !== 'undefined' }, async (t) => { // eslint-disable-line no-undef
  const http = require('http')
  const { sunucuKur } = require('../server')
  const { a, saat } = kur()
  let cagri = 0
  const sayac = { onDenetim: (x) => a.onDenetim(x), adres: (ip, b) => b['x-test-ip'] || ip, istek: (x) => { cagri++; return a.istek(x) } }
  const s = sunucuKur(sayac, { bekleyenBayt: 1000, istemciIstek: 2 })
  await new Promise((resolve) => s.listen(0, '127.0.0.1', resolve))
  const port = s.address().port
  // Gövdesi bitmeyen istek: başlıklar gider, gövdenin bir kısmı yazılır; cevap gelirse durumu döner
  const acik = []
  const baslat = (yol, basliklar, boy, yazilan) => new Promise((resolve) => {
    const r = http.request({ port, host: '127.0.0.1', method: 'PUT', path: yol, headers: { ...basliklar, 'content-length': boy }, agent: false }, (c) => { c.resume(); resolve(c.statusCode) })
    r.on('error', () => resolve('kopuk'))
    r.write(Buffer.alloc(yazilan))
    acik.push(r)
    setTimeout(() => resolve('bekliyor'), 300)
  })
  try {
    const p = paket(saat)
    t.ok(p.bytes.byteLength < 1000)
    const ow = (ip) => ({ 'x-hf-owner': p.owner, 'x-test-ip': ip })
    t.is(await baslat('/v1/yok', ow('1'), 600, 10), 404, 'yanlış yol gövde okunmadan')
    t.is(await baslat(`/v1/p/${SID}/${p.pid}`, { 'x-test-ip': '1' }, 600, 10), 400, 'sahip başlığı yok')
    t.is(await baslat(`/v1/p/${SID}/${p.pid}`, ow('1'), 600, 10), 'bekliyor')
    t.is(s.bekleyenBayt(), 600, 'bildirilen boy ayrıldı')
    t.is(await baslat(`/v1/p/${SID}/${p.pid}`, ow('2'), 600, 10), 503, 'toplam bütçe doldu')
    t.is(await baslat(`/v1/p/${SID}/${p.pid}`, ow('1'), 300, 10), 'bekliyor')
    t.is(await baslat(`/v1/p/${SID}/${p.pid}`, ow('1'), 10, 1), 429, 'aynı istemcinin üçüncü eşzamanlı isteği')
    t.is(cagri, 0, 'alıcının işleyicisi hiç çağrılmadı')
    for (const r of acik) r.destroy()
    acik.length = 0
    await new Promise((resolve) => setTimeout(resolve, 200))
    t.is(s.bekleyenBayt(), 0, 'kopan istekler bütçeyi bıraktı')
    const r = await fetch(`http://127.0.0.1:${port}/v1/p/${SID}/${p.pid}`, { method: 'PUT', headers: ow('2'), body: p.bytes })
    t.is(r.status, 201, 'bütçe boşalınca istek alıcıya ulaşır')
    t.is(cagri, 1)
  } finally {
    for (const r of acik) r.destroy()
    await new Promise((resolve) => s.close(resolve))
  }
})
