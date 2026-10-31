// SPDX-License-Identifier: Apache-2.0
// RFC-0010 §20 adım 5 (SDK): SHARE_PREVIEW ile başlatandan imzacıya, imzacının kendi kayıtlarıyla denetimi ve onayı,
// başlatanın gönderimi; cevapların çekilmesi ve kaydı (309), başka telefondan cevap; silme isteği ve 'silindi' cevabı.
const test = require('brittle')
const b4a = require('b4a')
const core = require('@havenfold/core')
const S = require('..')
const H = require('@havenfold/services')
const A = require('../../core/records/test/helpers/family')
const V = require('../../core/core/test/helpers/v21')
const Y = require('../../core/services/test/helpers/service-vector')

const hex = (b) => b4a.toString(b, 'hex')
const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const GUN = 86_400_000
const PAYLASIMLAR = b4a.alloc(16, 0x3a)
const VET = H.kart.kartCoz(Y.kartKur(Y.VETERINER))
const SID = hex(VET.serviceId)
const ENC = H.paket.sifreCifti(b4a.from(Y.VETERINER.encSeed, 'hex'))
const IMZA = Y.signCifti(Y.VETERINER.signSeed)
const QR = H.kart.qrKodla(VET.bytes)
const bellek = () => { const m = new Map(); return { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v) } }

function kur () {
  const L = A.anaDefter()
  const saat = { t: V.TS0 + GUN }
  const now = () => saat.t
  L.apply(V.koleksiyon(L, [V.K.kerem], { collectionId: PAYLASIMLAR, name: 'Paylaşımlar', kind: 'olaylar', readers: ['rol:ebeveyn', 'rol:yetiskin'], writers: ['rol:ebeveyn', 'rol:yetiskin'], taskAccess: false }))
  const api = (k) => {
    const defter = new S.LedgerApi({ ledger: L, me: k, now })
    const kayit = new S.RecordApi({ replika: A.replika(L, k, { now }) })
    return { defter, kayit, hizmet: new S.ServiceApi({ kayit, defter, paylasimlar: PAYLASIMLAR, saklama: bellek(), now }), hex: hex(k.memberId) }
  }
  const u = { husniye: api(V.K.husniye), irem: api(V.K.irem), kerem: api(V.K.kerem) }
  // Bellek içi taşıyıcı: herkesin kayıt işlemleri herkese
  const esitle = () => {
    for (const a of Object.values(u)) {
      const msgs = a.kayit.r.outbox.splice(0)
      for (const b of Object.values(u)) if (a !== b) { a.kayit.r.outbox.push(...msgs); A.teslim(a.kayit.r, b.kayit.r) }
    }
    for (const a of Object.values(u)) a.kayit.sync()
  }
  esitle() // dönem anahtarları
  return { L, saat, u, esitle }
}

// Hizmetin tarafı: paketi açar, cevabı kurar
function hizmetCevabi (istek, n, kind, ek = {}) {
  const ac = H.paket.paketAc(istek.bytes, { kart: VET, encSecret: ENC.secretKey })
  return { packageId: istek.packageId, n, bytes: H.cevap.cevapKur({ packageId: b4a.from(istek.packageId, 'hex'), n, replyPub: ac.govde.replyPub, signSecret: IMZA.secretKey, kind, at: V.TS0 + 2 * GUN + n, ...ek }), govde: ac.govde }
}

test('SHARE_PREVIEW: başlatan hazırlar, imzacı kendi kayıtlarıyla denetleyip onaylar, başlatan gönderir', (t) => {
  const { u, esitle } = kur()
  u.husniye.hizmet.addCard({ qr: QR })
  const not = u.husniye.kayit.put(A.K_TUM_AILE, null, 'yuva.saglik.not', { _subj: 'uye:' + u.irem.hex, metin: 'tansiyon 13/8' })
  esitle()
  const o = u.husniye.hizmet.prepare({ serviceId: SID, kaynaklar: [{ collectionId: A.K_TUM_AILE, recordIds: [not] }], title: 'İrem · tansiyon', label: 'Hüsniye' })
  t.is(hataOf(() => u.husniye.hizmet.confirm({ shareId: o.shareId, payloadHash: o.payloadHash })), 'NOT_SIGNER')
  const z = u.husniye.hizmet.sendPreview({ shareId: o.shareId })
  t.alike([z.type, z.kime], [core.zarf.Z.SHARE_PREVIEW, [u.irem.hex]])
  // Giriş noktası gelenZarf'tan geçer; bozuk bayt reddedilir
  const asil = core.giris.gelenZarf
  const gorulen = []
  core.giris.gelenZarf = (x) => { gorulen.push(x.type); return asil(x) }
  try {
    t.is(hataOf(() => u.irem.hizmet.receivePreview(u.husniye.hex, b4a.from([1, 2]), 'emanet')), 'INVALID_MESSAGE')
    const on = u.irem.hizmet.receivePreview(u.husniye.hex, z.bytes, 'emanet')
    t.alike(gorulen, [0xd0, 0xd0])
    t.alike([on.shareId, on.ogeler[0].alanlar.metin, on.ownerId, on.payloadHash], [o.shareId, 'tansiyon 13/8', u.irem.hex, o.payloadHash])
  } finally { core.giris.gelenZarf = asil }
  t.is(u.irem.hizmet.shares().find((x) => x.shareId === o.shareId).durum, 'onay-bekliyor')
  t.is(hataOf(() => u.irem.hizmet.sendPreview({ shareId: o.shareId })), 'NOT_INITIATOR')
  t.is(hataOf(() => u.irem.hizmet.send({ shareId: o.shareId })), 'INITIATOR_SENDS')
  // İmzacı olmayan (Kerem) aynı önizlemeyi alırsa
  t.is(hataOf(() => u.kerem.hizmet.receivePreview(u.husniye.hex, z.bytes, 'dogrudan')), 'NOT_SIGNER')
  t.is(hataOf(() => u.irem.hizmet.receivePreview(u.kerem.hex, z.bytes, 'dogrudan')), 'SENDER_MISMATCH')
  t.is(u.irem.hizmet.confirm({ shareId: o.shareId, payloadHash: o.payloadHash }).durum, 'uygulandi')
  const istek = u.husniye.hizmet.send({ shareId: o.shareId })
  t.is(H.paket.paketAc(istek.bytes, { kart: VET, encSecret: ENC.secretKey }).govde.title, 'İrem · tansiyon')
  // Başlatan (imzacı değil, okuyucu) iptal eder: defterde iptal olayı ve Paylaşımlar kaydı (açıklama 3 madde 1); alıcıdan siler
  const ip = u.husniye.hizmet.cancel({ shareId: o.shareId })
  t.alike([ip.durum, ip.sil.map((x) => x.packageId)], ['iptal', [istek.packageId]])
  t.is(hataOf(() => u.husniye.hizmet.send({ shareId: o.shareId })), 'NO_DRAFT')
  t.is(u.husniye.hizmet.shares().find((x) => x.shareId === o.shareId).durum, 'iptal')
  t.is(H.onay.onaylar(u.irem.defter.L).get(o.shareId).durum, 'iptal', 'imzacının telefonunda da onay iptal: başka cihaz gönderemez')
  t.is(u.irem.hizmet.cancel({ shareId: o.shareId }).durum, 'iptal')
})

test('SHARE_PREVIEW: kaynak kayıtlar eşitlenmeden gelirse bekler, kayıtlar gelince kabul edilir; teslimde "gitti"; üye dışından düşer', (t) => {
  const { u, esitle } = kur()
  u.husniye.hizmet.addCard({ qr: QR })
  esitle()
  const not = u.husniye.kayit.put(A.K_TUM_AILE, null, 'yuva.saglik.not', { _subj: 'uye:' + u.irem.hex, metin: 'geç gelen' })
  u.husniye.kayit.sync()
  const o = u.husniye.hizmet.prepare({ serviceId: SID, kaynaklar: [{ collectionId: A.K_TUM_AILE, recordIds: [not] }], title: 'x' })
  const z = u.husniye.hizmet.sendPreview({ shareId: o.shareId })
  // Kayıt İrem'e henüz gelmedi: önizleme bekletilir
  t.is(u.irem.hizmet.receivePreview(u.husniye.hex, z.bytes, 'dogrudan'), null)
  t.is(u.irem.hizmet.shares().find((x) => x.shareId === o.shareId), undefined)
  t.alike(u.irem.hizmet.pendingPreviews(), [], 'kayıt hâlâ yok: bekler')
  esitle()
  const kabul = u.irem.hizmet.pendingPreviews()
  t.alike(kabul.map((x) => x.shareId), [o.shareId])
  t.is(u.irem.hizmet.shares().find((x) => x.shareId === o.shareId).durum, 'onay-bekliyor')
  t.alike(u.irem.hizmet.pendingPreviews(), [])
  // Oturum rolü süzgeci: cihaz oturumundan önizleme gelmez
  t.is(hataOf(() => u.irem.hizmet.receivePreview(u.husniye.hex, z.bytes, 'dogrudan', 'cihaz')), 'TYPE_NOT_ALLOWED')
  // Başlatanın taslağı "önizleme gitti"yi yalnız teslimde yazar
  const taslak = () => u.husniye.hizmet._taslak(o.shareId)
  t.absent(taslak().onizlemeGitti)
  u.husniye.hizmet.deliverPreview({ shareId: o.shareId })
  t.is(taslak().onizlemeGitti, true)
})

test('SHARE_PREVIEW: imzacının kaydı farklıysa SOURCE_MISMATCH; gizli paylaşımda önizleme gereksiz', (t) => {
  const { u, esitle } = kur()
  u.husniye.hizmet.addCard({ qr: QR })
  const not = u.husniye.kayit.put(A.K_TUM_AILE, null, 'yuva.saglik.not', { _subj: 'uye:' + u.irem.hex, metin: 'eski' })
  esitle()
  const o = u.husniye.hizmet.prepare({ serviceId: SID, kaynaklar: [{ collectionId: A.K_TUM_AILE, recordIds: [not] }], title: 'x' })
  const z = u.husniye.hizmet.sendPreview({ shareId: o.shareId })
  u.irem.kayit.put(A.K_TUM_AILE, not, null, { metin: 'yeni' })
  t.is(hataOf(() => u.irem.hizmet.receivePreview(u.husniye.hex, z.bytes, 'dogrudan')), 'SOURCE_MISMATCH')
  esitle()
  const kis = u.irem.kayit.put(A.K_KISISEL_IREM, null, 'yuva.saglik.not', { metin: 'kendi' })
  u.irem.hizmet.addCard({ qr: QR })
  const g = u.irem.hizmet.prepare({ serviceId: SID, kaynaklar: [{ collectionId: A.K_KISISEL_IREM, recordIds: [kis] }], title: 'y' })
  t.is(hataOf(() => u.irem.hizmet.sendPreview({ shareId: g.shareId })), 'PREVIEW_UNNEEDED')
})

test('cevaplar (309): açılır, imza doğrulanır, bir kez kaydedilir; başka telefon kayıttaki sırla çeker; durum açıldı', (t) => {
  const { u, esitle } = kur()
  u.husniye.hizmet.addCard({ qr: QR })
  const kum = u.husniye.kayit.put(A.K_TUM_AILE, null, 'yuva.pet.kum', { _subj: 'varlik:' + hex(V.VARLIK_KEDI), adet: 2 })
  const o = u.husniye.hizmet.prepare({ serviceId: SID, kaynaklar: [{ collectionId: A.K_TUM_AILE, recordIds: [kum] }], title: 'Coki' })
  u.husniye.hizmet.confirm({ shareId: o.shareId, payloadHash: o.payloadHash })
  const istek = u.husniye.hizmet.send({ shareId: o.shareId })
  t.alike(u.husniye.hizmet.replyRequests({ shareId: o.shareId }).map((x) => [x.packageId, x.after]), [[istek.packageId, -1]], 'kayıttan önce yerel gönderimden')
  u.husniye.hizmet.sent({ shareId: o.shareId })
  const c0 = hizmetCevabi(istek, 0, 'makbuz', { text: 'Alındı.' })
  const dosya = { blobId: b4a.alloc(32, 5), fileKey: b4a.alloc(32, 6), size: 1200, mime: 'application/pdf', name: 'rapor.pdf' }
  const c1 = hizmetCevabi(istek, 1, 'belge', { text: 'Rapor ekte.', files: [dosya] })
  const sahte = { packageId: istek.packageId, n: 2, bytes: H.cevap.cevapKur({ packageId: b4a.from(istek.packageId, 'hex'), n: 2, replyPub: c0.govde.replyPub, signSecret: Y.signCifti('99'.repeat(32)).secretKey, kind: 'mesaj', at: 1 }) }
  const r = u.husniye.hizmet.receiveReply({ shareId: o.shareId, cevaplar: [c0, c1, sahte, { packageId: hex(b4a.alloc(16)), bytes: c0.bytes }, { packageId: istek.packageId, bytes: b4a.alloc(3) }] })
  t.alike(r.yeni.map((x) => [x.n, x.kind, x.dosya]), [[0, 'makbuz', 0], [1, 'belge', 1]])
  t.is(r.atlanan, 3, 'başka imza, bilinmeyen paket, bozuk bayt')
  t.alike(u.husniye.hizmet.receiveReply({ shareId: o.shareId, cevaplar: [c0, c1] }).yeni, [], 'ikinci kez kaydedilmez')
  t.alike(u.husniye.hizmet.replyRequests({ shareId: o.shareId })[0].after, 1)
  const l = u.husniye.hizmet.replies({ shareId: o.shareId })
  t.alike(l.map((x) => [x.n, x.text]), [[0, 'Alındı.'], [1, 'Rapor ekte.']])
  t.alike(l[1].dosyalar, [{ blobId: hex(dosya.blobId), fileKey: hex(dosya.fileKey), size: 1200, mime: 'application/pdf', name: 'rapor.pdf' }])
  const satir = u.husniye.hizmet.shares().find((x) => x.shareId === o.shareId)
  t.alike([satir.durum, satir.cevap], ['acildi', 2])
  // Başka telefon (Kerem): Paylaşımlar kaydındaki reply_secret ile açar
  esitle()
  u.kerem.hizmet.addCard({ qr: QR })
  const ik = u.kerem.hizmet.replyRequests({ shareId: o.shareId })
  t.alike([ik[0].packageId, ik[0].after, H.paket.sahipOzeti(b4a.from(ik[0].ownerSecret, 'hex'))], [istek.packageId, 1, istek.owner])
  const c2 = hizmetCevabi(istek, 2, 'mesaj', { text: 'Yarın gelin.' })
  t.alike(u.kerem.hizmet.receiveReply({ shareId: o.shareId, cevaplar: [c2] }).yeni.map((x) => x.text), ['Yarın gelin.'])
  t.is(hataOf(() => u.kerem.hizmet.receiveReply({ shareId: hex(b4a.alloc(16, 9)), cevaplar: [] })), 'NO_SHARE')
})

test('silme isteği: silme paketi ref ile, onay istemez; silindi cevabı durumu değiştirir', (t) => {
  const { u, esitle } = kur()
  u.husniye.hizmet.addCard({ qr: QR })
  const kum = u.husniye.kayit.put(A.K_TUM_AILE, null, 'yuva.pet.kum', { _subj: 'varlik:' + hex(V.VARLIK_KEDI), adet: 2 })
  const o = u.husniye.hizmet.prepare({ serviceId: SID, kaynaklar: [{ collectionId: A.K_TUM_AILE, recordIds: [kum] }], title: 'Coki' })
  t.is(hataOf(() => u.husniye.hizmet.requestDeletion({ shareId: o.shareId })), 'NO_DELIVERY')
  u.husniye.hizmet.confirm({ shareId: o.shareId, payloadHash: o.payloadHash })
  const istek = u.husniye.hizmet.send({ shareId: o.shareId })
  u.husniye.hizmet.sent({ shareId: o.shareId })
  const s = u.husniye.hizmet.requestDeletion({ shareId: o.shareId })
  const ac = H.paket.paketAc(s.bytes, { kart: VET, encSecret: ENC.secretKey })
  t.alike([ac.govde.kind, hex(ac.govde.ref), ac.govde.items.length, hex(ac.govde.sender.pseudoPub)], ['silme', istek.packageId, 0, hex(H.paket.paketAc(istek.bytes, { kart: VET, encSecret: ENC.secretKey }).govde.sender.pseudoPub)])
  const cv = { packageId: s.packageId, n: 0, bytes: H.cevap.cevapKur({ packageId: b4a.from(s.packageId, 'hex'), n: 0, replyPub: ac.govde.replyPub, signSecret: IMZA.secretKey, kind: 'silindi', at: V.TS0 + 3 * GUN }) }
  t.is(u.husniye.hizmet.receiveReply({ shareId: o.shareId, cevaplar: [cv] }).yeni[0].kind, 'silindi')
  t.is(u.husniye.hizmet.shares().find((x) => x.shareId === o.shareId).durum, 'silindi')
  t.is(u.husniye.hizmet.replyRequests({ shareId: o.shareId }).length, 2, 'asıl paket ve silme paketi')
  // Silme paketinin sırrı Paylaşımlar kaydında: başka telefon da cevabını okur (inceleme A2 madde 10)
  esitle()
  u.kerem.hizmet.addCard({ qr: QR })
  t.alike(u.kerem.hizmet.replyRequests({ shareId: o.shareId }).map((x) => x.packageId).sort(), [istek.packageId, s.packageId].sort())
  t.is(u.kerem.hizmet.shares().find((x) => x.shareId === o.shareId).packageId, istek.packageId, 'liste veri paketini gösterir')
})

test('gizli paylaşımın cevabı kişisel koleksiyona yazılır', (t) => {
  const { u, esitle } = kur()
  u.irem.hizmet.addCard({ qr: QR })
  esitle()
  const kis = u.irem.kayit.put(A.K_KISISEL_IREM, null, 'yuva.saglik.not', { metin: 'kendi' })
  const o = u.irem.hizmet.prepare({ serviceId: SID, kaynaklar: [{ collectionId: A.K_KISISEL_IREM, recordIds: [kis] }], title: 'g' })
  u.irem.hizmet.confirm({ shareId: o.shareId, payloadHash: o.payloadHash })
  const istek = u.irem.hizmet.send({ shareId: o.shareId })
  u.irem.hizmet.sent({ shareId: o.shareId })
  u.irem.hizmet.receiveReply({ shareId: o.shareId, cevaplar: [hizmetCevabi(istek, 0, 'makbuz')] })
  t.is(u.irem.kayit.query(A.K_KISISEL_IREM, { type: 'hf.paylasim.cevap' }).length, 1)
  t.is(u.irem.kayit.query(PAYLASIMLAR, { type: 'hf.paylasim.cevap' }).length, 0)
})
