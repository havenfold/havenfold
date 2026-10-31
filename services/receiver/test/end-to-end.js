// SPDX-License-Identifier: AGPL-3.0-only
// Uçtan uca (RFC-0010 §8.1, §8.3, §12): telefonun SDK'sı (ServiceApi) paketi hazırlar, onaylar ve alıcıya yükler; hizmet
// gelen kutusundan çeker, açar, ack ve makbuz yazar; telefon cevabı çeker ve kaydeder; iptal edilen başka paket teslimden
// önce alıcıdan silinir.
const test = require('brittle')
const b4a = require('b4a')
const S = require('@havenfold/sdk')
const { paket: P, cevap: C, kart: Kt } = require('@havenfold/services')
const A = require('../../../core/records/test/helpers/family')
const V = require('../../../core/core/test/helpers/v21')
const Y = require('../../../core/services/test/helpers/service-vector')
const { Alici } = require('../receiver')

const hex = (b) => b4a.toString(b, 'hex')
const GUN = 86_400_000
const PAYLASIMLAR = b4a.alloc(16, 0x3a)
const KART = Y.kartKur(Y.VETERINER)
const kart = Kt.kartCoz(KART)
const SID = hex(kart.serviceId)
const IMZA = Y.signCifti(Y.VETERINER.signSeed)
const ENC = P.sifreCifti(b4a.from(Y.VETERINER.encSeed, 'hex'))
const bellek = () => { const m = new Map(); return { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v) } }

test('telefon → alıcı → hizmet → cevap → telefon; iptalde silme', (t) => {
  const L = A.anaDefter()
  const saat = { t: V.TS0 + GUN }
  const now = () => saat.t
  L.apply(V.koleksiyon(L, [V.K.kerem], { collectionId: PAYLASIMLAR, name: 'Paylaşımlar', kind: 'olaylar', readers: ['rol:ebeveyn', 'rol:yetiskin'], writers: ['rol:ebeveyn', 'rol:yetiskin'], taskAccess: false }))
  const defter = new S.LedgerApi({ ledger: L, me: V.K.husniye, now })
  const kayit = new S.RecordApi({ replika: A.replika(L, V.K.husniye, { now }) })
  const telefon = new S.ServiceApi({ kayit, defter, paylasimlar: PAYLASIMLAR, saklama: bellek(), now })
  const alici = new Alici({ kartlar: [KART], now })
  const istek = (yontem, yol, basliklar = {}, govde = b4a.alloc(0)) => alici.istek({ yontem, yol, basliklar, govde, ip: '10.0.0.1' })
  const auth = (yontem, yol) => C.yetkiBasligi({ serviceId: kart.serviceId, signSecret: IMZA.secretKey, t: saat.t, yontem, yol })

  // Telefon: yüz yüze kart (alıcının kartı), kayıttan paket, onay, gönderim
  t.is(telefon.addCard({ qr: Kt.qrKodla(istek('GET', '/v1/kart/' + SID).govde) }).dogrulama, 'yuz-yuze')
  const kum = kayit.put(A.K_TUM_AILE, null, 'yuva.pet.kum', { _subj: 'varlik:' + hex(V.VARLIK_KEDI), adet: 2 })
  const o = telefon.prepare({ serviceId: SID, kaynaklar: [{ collectionId: A.K_TUM_AILE, recordIds: [kum] }], title: 'Coki · kum kabı', label: 'Hüsniye' })
  telefon.confirm({ shareId: o.shareId, payloadHash: o.payloadHash })
  const g = telefon.send({ shareId: o.shareId })
  t.is(istek('PUT', `/v1/p/${g.serviceId}/${g.packageId}`, { 'x-hf-owner': g.owner }, g.bytes).durum, 201)
  telefon.sent({ shareId: o.shareId })

  // İptal edilen ikinci paylaşım: teslimden önce alıcıdan silinir
  const o2 = telefon.prepare({ serviceId: SID, kaynaklar: [{ collectionId: A.K_TUM_AILE, recordIds: [kum] }], title: 'ikinci' })
  telefon.confirm({ shareId: o2.shareId, payloadHash: o2.payloadHash })
  const g2 = telefon.send({ shareId: o2.shareId })
  istek('PUT', `/v1/p/${g2.serviceId}/${g2.packageId}`, { 'x-hf-owner': g2.owner }, g2.bytes)
  telefon.sent({ shareId: o2.shareId })
  const ip = telefon.cancel({ shareId: o2.shareId })
  t.alike(ip.sil.map((s) => istek('DELETE', `/v1/p/${s.serviceId}/${s.packageId}`, { 'x-hf-owner-secret': s.ownerSecret }).durum), [204])

  // Hizmet: gelen kutusu, açma, ack, makbuz
  saat.t += 60_000
  const gYol = `/v1/inbox/${SID}?after=0`
  const gelen = istek('GET', gYol, { 'x-hf-auth': auth('GET', gYol) }).govde.paketler
  t.alike(gelen.map((x) => x.packageId), [g.packageId], 'iptal edilen paket gelmez')
  const ac = P.paketAc(b4a.from(gelen[0].bytes, 'base64'), { kart, encSecret: ENC.secretKey })
  t.alike([ac.govde.title, P.alanlarCoz(ac.govde.items[0].fields).adet], ['Coki · kum kabı', 2])
  const ackYol = `/v1/ack/${SID}/${g.packageId}`
  t.is(istek('POST', ackYol, { 'x-hf-auth': auth('POST', ackYol) }).durum, 204)
  const cYol = `/v1/r/${g.packageId}/0`
  const cv = C.cevapKur({ packageId: b4a.from(g.packageId, 'hex'), n: 0, replyPub: ac.govde.replyPub, signSecret: IMZA.secretKey, kind: 'makbuz', text: 'Aldık, bakıyoruz.', at: saat.t })
  t.is(istek('PUT', cYol, { 'x-hf-auth': auth('PUT', cYol) }, cv).durum, 201)

  // Telefon: cevap istekleri, alıcıdan çekme, açma ve kayıt
  const ci = telefon.replyRequests({ shareId: o.shareId })
  const cevaplar = ci.flatMap((r) => istek('GET', `/v1/r/${r.packageId}?after=${r.after}`, { 'x-hf-owner-secret': r.ownerSecret }).govde.cevaplar.map((x) => ({ packageId: r.packageId, n: x.n, bytes: b4a.from(x.bytes, 'base64') })))
  t.alike(telefon.receiveReply({ shareId: o.shareId, cevaplar }).yeni.map((x) => [x.kind, x.text]), [['makbuz', 'Aldık, bakıyoruz.']])
  t.is(telefon.shares().find((x) => x.shareId === o.shareId).durum, 'acildi')
  t.is(telefon.replyRequests({ shareId: o.shareId })[0].after, 0)
})
