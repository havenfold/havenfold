// SPDX-License-Identifier: Apache-2.0
// ServiceApi kenar durumları: bozuk saklama ve bozuk kart kaydı atlanır; okunamayan kaynak, eksik kayıt kimlikleri,
// bilinmeyen sahip; öneri olan onay ve iptal; imzacı olmayanın iptali; başka telefonun istekleri; önizlemede
// sayı uyuşmazlığı, karışık sahip ve bayt/dizi alanları; ret cevabı.
const test = require('brittle')
const b4a = require('b4a')
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
const COKI = 'varlik:' + hex(V.VARLIK_KEDI)

function kur (saklamaIlk = {}) {
  const L = A.anaDefter()
  const now = () => V.TS0 + GUN
  L.apply(V.koleksiyon(L, [V.K.kerem], { collectionId: PAYLASIMLAR, name: 'Paylaşımlar', kind: 'olaylar', readers: ['rol:ebeveyn', 'rol:yetiskin'], writers: ['rol:ebeveyn', 'rol:yetiskin'], taskAccess: false }))
  const api = (k, ilk = {}) => {
    const m = new Map(Object.entries(ilk))
    const saklama = { get: (a) => (m.has(a) ? m.get(a) : null), set: (a, v) => m.set(a, v) }
    const defter = new S.LedgerApi({ ledger: L, me: k, now })
    const kayit = new S.RecordApi({ replika: A.replika(L, k, { now }) })
    return { defter, kayit, hizmet: new S.ServiceApi({ kayit, defter, paylasimlar: PAYLASIMLAR, saklama, now }), hex: hex(k.memberId) }
  }
  const u = { husniye: api(V.K.husniye, saklamaIlk), irem: api(V.K.irem), kerem: api(V.K.kerem) }
  const esitle = () => {
    for (const a of Object.values(u)) {
      const msgs = a.kayit.r.outbox.splice(0)
      for (const b of Object.values(u)) if (a !== b) { a.kayit.r.outbox.push(...msgs); A.teslim(a.kayit.r, b.kayit.r) }
    }
    for (const a of Object.values(u)) a.kayit.sync()
  }
  esitle()
  return { L, u, esitle }
}

test('bozuk saklama ve bozuk kart kaydı atlanır; kaynak ve kayıt hataları', (t) => {
  const { u, esitle } = kur({ 'hizmet/dizinler': { 'TR-35': 'abcd' } })
  t.alike(u.husniye.hizmet.directory().iller, [], 'saklamadaki bozuk dizin atlanır')
  u.husniye.kayit.put(PAYLASIMLAR, null, 'hf.hizmet.kart', { _v: 1, _t: 1, _subj: 'topluluk', card: b4a.alloc(5) })
  u.husniye.hizmet.addCard({ qr: QR })
  t.is(u.husniye.hizmet.services().eklenen.length, 1)
  const h = u.husniye.hizmet
  t.is(hataOf(() => h.prepare({ serviceId: SID, title: 'x' })), 'SOURCE_REQUIRED')
  t.is(hataOf(() => h.prepare({ serviceId: SID, kaynaklar: [{ collectionId: A.K_TUM_AILE }], title: 'x' })), 'RECORD_REQUIRED')
  const yabanci = h.kayit.put(A.K_TUM_AILE, null, 'yuva.saglik.not', { _subj: 'uye:' + hex(b4a.alloc(16, 0x77)), metin: 'x' })
  t.is(hataOf(() => h.prepare({ serviceId: SID, kaynaklar: [{ collectionId: A.K_TUM_AILE, recordIds: [yabanci] }], title: 'x' })), 'NO_TARGET')
  esitle()
  u.irem.hizmet.addCard({ qr: QR })
  t.is(hataOf(() => u.irem.hizmet.prepare({ serviceId: SID, kaynaklar: [{ collectionId: A.K_BAKICI, recordIds: [yabanci] }], title: 'x' })), 'NO_PERMISSION', 'okunamayan koleksiyon')
  t.is(hataOf(() => h.confirm({ shareId: hex(b4a.alloc(16)) })), 'NO_DRAFT')
  // Dosya başvurusu dizisi de öğeye girmez
  const f = h.kayit.attach({ bytes: b4a.from('a') }).blobRef
  const r = h.kayit.put(A.K_TUM_AILE, null, 'yuva.pet.kum', { _subj: COKI, fotolar: [f, f], adet: 1 })
  t.alike(Object.keys(h.prepare({ serviceId: SID, kaynaklar: [{ collectionId: A.K_TUM_AILE, recordIds: [r] }], title: 'x' }).ogeler[0].alanlar).sort(), ['adet'])
})

test('öneri olan onay ve iptal; imzacı olmayanın iptali; başka telefonun istekleri; ret cevabı', (t) => {
  const { u, esitle } = kur()
  const h = u.husniye.hizmet
  h.addCard({ qr: QR })
  const kum = h.kayit.put(A.K_TUM_AILE, null, 'yuva.pet.kum', { _subj: COKI, adet: 2 })
  // Defterin öneri dönüşü (ekipte ikinci imza beklenirken olduğu gibi)
  const asil = u.husniye.defter._yaz
  u.husniye.defter._yaz = () => ({ durum: 'oneri', oneriId: 'o1', waitingFor: [u.kerem.hex] })
  const a = h.prepare({ serviceId: SID, kaynaklar: [{ collectionId: A.K_TUM_AILE, recordIds: [kum] }], title: 'x' })
  t.alike(h.confirm({ shareId: a.shareId, payloadHash: a.payloadHash }), { shareId: a.shareId, durum: 'oneri', oneriId: 'o1', waitingFor: [u.kerem.hex] })
  t.is(h.shares().find((x) => x.shareId === a.shareId).durum, 'oneri')
  t.is(hataOf(() => h.confirm({ shareId: a.shareId, payloadHash: a.payloadHash })), 'APPROVAL_EXISTS')
  u.husniye.defter._yaz = asil
  const b = h.prepare({ serviceId: SID, kaynaklar: [{ collectionId: A.K_TUM_AILE, recordIds: [kum] }], title: 'y' })
  h.confirm({ shareId: b.shareId, payloadHash: b.payloadHash })
  const g = h.send({ shareId: b.shareId })
  h.sent({ shareId: b.shareId })
  esitle()
  // Kerem kartı kendisi eklemedi; Hüsniye'nin kart kaydı eşitlenince uç adresini bilir
  t.is(u.kerem.hizmet.replyRequests({ shareId: b.shareId })[0].endpoint, 'https://hizmet.example.tr')
  // Ret cevabı ve aynı andaki iki cevap; cevaplar dizisi verilmezse boş; packageId bayt olarak
  const ac = H.paket.paketAc(g.bytes, { kart: VET, encSecret: ENC.secretKey })
  const cv = (n, kind) => ({ packageId: b4a.from(g.packageId, 'hex'), bytes: H.cevap.cevapKur({ packageId: b4a.from(g.packageId, 'hex'), n, replyPub: ac.govde.replyPub, signSecret: IMZA.secretKey, kind, at: 5 }) })
  t.alike(h.receiveReply({ shareId: b.shareId }), { yeni: [], atlanan: 0 })
  t.is(h.receiveReply({ shareId: b.shareId, cevaplar: [cv(1, 'ret'), cv(0, 'makbuz')] }).yeni.length, 2)
  t.alike(h.replies({ shareId: b.shareId }).map((x) => x.n), [0, 1])
  t.is(h.shares().find((x) => x.shareId === b.shareId).durum, 'ret')
  u.husniye.defter._yaz = () => ({ durum: 'oneri', oneriId: 'o2', waitingFor: [] })
  t.alike(h.cancel({ shareId: b.shareId }), { durum: 'oneri', oneriId: 'o2', waitingFor: [], sil: [] })
  u.husniye.defter._yaz = asil
  // İrem yetişkin, ortak veride imzacı değil ama Paylaşımlar'ın okuyucusu: iptal olayını yazar ve kayıttaki sırla siler
  // (açıklama 3 madde 1); sonra Kerem'de yeni olay yazılmaz, silme isteği yine döner
  const len = u.irem.defter.L.len
  const ir = u.irem.hizmet.cancel({ shareId: b.shareId })
  t.alike([ir.durum, ir.sil.map((x) => x.packageId)], ['iptal', [g.packageId]])
  t.is(u.irem.defter.L.len, len + 1)
  t.is(u.kerem.hizmet.cancel({ shareId: b.shareId }).sil[0].ownerSecret.length, 64, 'Kerem kayıttaki sırla siler')
  t.is(u.irem.defter.L.len, len + 1)
  t.is(hataOf(() => u.irem.hizmet.send({ shareId: b.shareId })), 'NO_DRAFT')
})

test('önizleme: sayı uyuşmazlığı, karışık sahip, sahipsiz öğe; bayt ve dizi alanları karşılaştırılır', (t) => {
  const { L, u, esitle } = kur()
  const h = u.husniye.hizmet
  h.addCard({ qr: QR })
  const r1 = h.kayit.put(A.K_TUM_AILE, null, 'yuva.saglik.not', { _subj: 'uye:' + u.irem.hex, metin: 'a', ek: b4a.from([1, 2]), etiketler: ['x', 'y'] })
  const r2 = h.kayit.put(A.K_TUM_AILE, null, 'yuva.pet.kum', { _subj: COKI, adet: 1 })
  const r3 = h.kayit.put(A.K_TUM_AILE, null, 'yuva.pet.not', { metin: 'sahipsiz' })
  esitle()
  u.irem.hizmet.addCard({ qr: QR })
  esitle()
  const govdeOf = (kayitlar) => H.paket.govdeKodla({
    serviceId: VET.serviceId, shareId: b4a.alloc(16, 0x66), kind: 'tek', category: 'veteriner', title: 'el', issuedAt: V.TS0, useUntil: V.TS0 + GUN,
    replyPub: b4a.alloc(32, 1), sender: { pseudoPub: b4a.alloc(32, 2), label: '' },
    items: kayitlar.map((rid) => { const { _subj, ...al } = h.kayit.get(A.K_TUM_AILE, rid).fields; return { type: h.kayit.get(A.K_TUM_AILE, rid).type, fields: H.paket.alanlarKodla(al) } })
  })
  const zarf = (body, recordIds, kim = V.K.husniye) => H.onizleme.onizlemeKur({ familyId: L.familyId, shareId: b4a.alloc(16, 0x66), card: VET.bytes, body, sources: [{ collectionId: A.K_TUM_AILE, recordIds: recordIds.map((x) => b4a.from(x, 'hex')) }], fromId: kim.memberId, signSecret: kim.signKeyPair.secretKey })
  const al = (body, ids) => u.irem.hizmet.receivePreview(u.husniye.hex, zarf(body, ids), 'dogrudan')
  // Başlatanın rolü denetlenir (§18): çocuk başlatamaz
  t.is(hataOf(() => u.irem.hizmet.receivePreview(hex(V.K.ecem.memberId), zarf(govdeOf([r1]), [r1], V.K.ecem), 'dogrudan')), 'UNAUTHORIZED')
  t.is(hataOf(() => al(govdeOf([r1]), [r1, r2])), 'SOURCE_MISMATCH', 'öğe sayısı kaynaklarla aynı değil')
  t.is(hataOf(() => al(govdeOf([r1, r2]), [r1, r2])), 'MIXED_OWNER')
  t.is(hataOf(() => al(govdeOf([r2]), [r1])), 'SOURCE_MISMATCH', 'tür farklı')
  const on = al(govdeOf([r1]), [r1])
  t.alike(on.ogeler[0].alanlar.etiketler, ['x', 'y'], 'bayt ve dizi alanları eşleşir')
  t.is(on.ownerId, u.irem.hex, 'sahip İrem\'in kendi kopyasındaki kayıttan')
  t.is(hataOf(() => al(govdeOf([r1]), [r1])), 'PREVIEW_EXISTS', 'aynı shareId ikinci kez')
  t.is(hataOf(() => u.irem.hizmet.confirm({ shareId: on.shareId })), 'SUMMARY_REQUIRED')
  t.is(hataOf(() => u.irem.hizmet.confirm({ shareId: on.shareId, payloadHash: hex(b4a.alloc(32)) })), 'SUMMARY_MISMATCH')
  t.is(u.irem.hizmet.confirm({ shareId: on.shareId, payloadHash: on.payloadHash }).durum, 'uygulandi')
  t.is(hataOf(() => u.kerem.hizmet.receivePreview(u.husniye.hex, zarf(govdeOf([r3]), [r3]).subarray(0), 'dogrudan') && null), null, 'sahipsiz öğe ortak veridir; Kerem ebeveyn olarak imzacı')
  t.is(hataOf(() => u.irem.hizmet.receivePreview(u.husniye.hex, H.onizleme.onizlemeKur({ familyId: L.familyId, shareId: b4a.alloc(16, 0x67), card: VET.bytes, body: H.paket.govdeKodla({ ...H.paket.govdeCoz(govdeOf([r3])), shareId: b4a.alloc(16, 0x67) }), sources: [{ collectionId: A.K_TUM_AILE, recordIds: [b4a.from(r3, 'hex')] }], fromId: V.K.husniye.memberId, signSecret: V.K.husniye.signKeyPair.secretKey }), 'dogrudan')), 'NOT_SIGNER', 'İrem ortak veride imzacı değil')
})
