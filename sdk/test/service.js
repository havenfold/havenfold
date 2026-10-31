// SPDX-License-Identifier: Apache-2.0
// RFC-0010 SDK yüzü (komutlar 300–306; açıklama 1): il dizinleri ve yüz yüze kart (dizinsiz); kayıtlardan paket ve tam
// önizleme; sahibin kayıttan türetilmesi; onay; gönderim koşulu her denemede; teslim penceresi; iptal ve başka cihazdan
// silme; gizli onay; çocuğun kişisel koleksiyonu (vektör 14); ekip imzacıları; yurt dışı rıza.
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
const K_KISISEL_ECEM = b4a.alloc(16, 0x3b)
const DIZIN = Y.signCifti('d1'.repeat(32))
const sid = (g) => hex(H.kart.serviceIdOf(Y.signCifti(g.signSeed).publicKey))
const BAKIM = { ...Y.GUVENLIK, category: 'bakim', name: 'Ege Bakım' }
const qr = (g) => H.kart.qrKodla(Y.kartKur(g))
const COKI = 'varlik:' + hex(V.VARLIK_KEDI)

function dizinBaytlari (o = {}) {
  return H.kart.dizinImzala({ version: 1, region: 'TR-35', issuedAt: V.TS0, validUntil: V.TS0 + 14 * GUN, cards: [Y.kartKur(Y.VETERINER), Y.kartKur(BAKIM)], revoked: [H.kart.serviceIdOf(Y.signCifti('e1'.repeat(32)).publicKey)], ...o }, DIZIN.secretKey)
}
const bellek = () => { const m = new Map(); return { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v) } }

function kur (kim = V.K.husniye) {
  const L = A.anaDefter()
  const saat = { t: V.TS0 + GUN }
  const now = () => saat.t
  L.apply(V.koleksiyon(L, [V.K.kerem], { collectionId: PAYLASIMLAR, name: 'Paylaşımlar', kind: 'olaylar', readers: ['rol:ebeveyn', 'rol:yetiskin'], writers: ['rol:ebeveyn', 'rol:yetiskin'], taskAccess: false }))
  L.apply(V.koleksiyon(L, [V.K.ecem], { collectionId: K_KISISEL_ECEM, name: 'Kişisel', kind: 'kisisel', readers: ['uye:' + hex(V.K.ecem.memberId)], writers: ['uye:' + hex(V.K.ecem.memberId)], taskAccess: false }))
  const api = (k, saklama = bellek()) => {
    const defter = new S.LedgerApi({ ledger: L, me: k, now })
    const kayit = new S.RecordApi({ replika: A.replika(L, k, { now }) })
    return { defter, kayit, saklama, hizmet: new S.ServiceApi({ kayit, defter, paylasimlar: PAYLASIMLAR, dizinAnahtarlari: [hex(DIZIN.publicKey)], saklama, now }) }
  }
  return { L, saat, api, ...api(kim) }
}

// Tüm Aile'de Coki'nin iki kaydı (ortak veri), İrem'in ve Ecem'in birer kaydı
function kayitlar (kayit) {
  const coki = [kayit.put(A.K_TUM_AILE, null, 'yuva.pet.kum', { _subj: COKI, adet: 2 }), kayit.put(A.K_TUM_AILE, null, 'yuva.pet.kum', { _subj: COKI, adet: 3, foto: kayit.attach({ bytes: b4a.from('kum') }).blobRef })]
  const irem = kayit.put(A.K_TUM_AILE, null, 'yuva.saglik.not', { _subj: 'uye:' + hex(V.K.irem.memberId), metin: 'tansiyon' })
  const ecem = kayit.put(A.K_TUM_AILE, null, 'yuva.saglik.not', { _subj: 'uye:' + hex(V.K.ecem.memberId), metin: 'aşı' })
  return { coki, irem, ecem }
}
const TASLAK = (serviceId, recordIds, ek = {}) => ({ serviceId, kaynaklar: [{ collectionId: A.K_TUM_AILE, recordIds }], title: 'Coki · son 7 gün', note: 'Az yiyor.', label: 'Hüsniye', ...ek })

test('dizinler il başına ve kalıcı; yüz yüze kart dizinsiz; rozet güncel dizinden; bozuk kart dizini düşürmez', (t) => {
  const k = kur()
  t.alike(k.hizmet.directory(), { iller: [], hizmetler: [] })
  // Dizin yokken yüz yüze kart eklenir ve paylaşılır (açıklama 1 madde 1)
  const vet = k.hizmet.addCard({ qr: qr(Y.VETERINER) })
  t.is(vet.dogrulama, 'yuz-yuze')
  const r = kayitlar(k.kayit)
  t.is(k.hizmet.prepare(TASLAK(sid(Y.VETERINER), r.coki)).hizmet.dogrulama, 'yuz-yuze')
  // İzmir dizini gelince rozet 'dizin'; Ankara dizini ayrı il, sürümü İzmir'le karşılaştırılmaz
  const bozuk = Y.hamKart({ ...Y.YABANCI, signSeed: 'c5'.repeat(32), category: 'kuafor' })
  const d = k.hizmet.directory({ bytes: dizinBaytlari({ version: 5, cards: [Y.kartKur(Y.VETERINER), Y.kartKur(BAKIM), bozuk] }) })
  t.alike(d.iller.map((x) => [x.region, x.atlanan]), [['TR-35', 1]])
  t.is(d.hizmetler.length, 2, 'bozuk kart yalnız kendisi atlanır')
  t.is(k.hizmet.services().eklenen[0].dogrulama, 'dizin')
  k.hizmet.directory({ bytes: dizinBaytlari({ version: 1, region: 'TR-06', cards: [] }) })
  t.is(hataOf(() => k.hizmet.directory({ bytes: dizinBaytlari({ version: 4 }) })), 'INDEX_STALE', 'aynı ilin eski sürümü')
  // Kalıcı: aynı saklamayla yeni ServiceApi dizinleri bilir
  const k2 = k.api(V.K.husniye, k.saklama)
  t.is(k2.hizmet.directory().iller.length, 2)
  // Dizin eskiyince rozet düşer, yüz yüze eklenen hâlâ paylaşılır; yalnız dizinden seçilen INDEX_STALE
  k.saat.t = V.TS0 + 15 * GUN
  t.is(k.hizmet.services().eklenen[0].dogrulama, 'yuz-yuze')
  t.ok(k.hizmet.prepare(TASLAK(sid(Y.VETERINER), r.coki)))
  t.is(hataOf(() => k.hizmet.prepare(TASLAK(sid(BAKIM), r.coki))), 'INDEX_STALE')
  t.is(hataOf(() => k.hizmet.prepare(TASLAK(hex(b4a.alloc(16, 1)), r.coki))), 'NO_SERVICE')
  t.is(hataOf(() => new S.ServiceApi({ kayit: k.kayit, defter: k.defter, paylasimlar: PAYLASIMLAR })), 'STORAGE_REQUIRED')
})

test('kart: revoked, sürüm, aynı sürümde yeni tarih; kayıt', (t) => {
  const { hizmet, kayit } = kur()
  hizmet.directory({ bytes: dizinBaytlari() })
  t.is(hizmet.addCard({ qr: qr(Y.VETERINER) }).dogrulama, 'dizin')
  const ab = hizmet.addCard({ qr: qr(Y.YABANCI) })
  t.alike([ab.dogrulama, ab.yurtDisi, ab.il], ['yuz-yuze', true, 'DE-BE'])
  t.is(hataOf(() => hizmet.addCard({ qr: qr({ ...Y.VETERINER, signSeed: 'e1'.repeat(32) }) })), 'NOT_SERVICE_ELIGIBLE')
  t.is(hataOf(() => hizmet.addCard({ qr: 'HFH1:AAAA' })), 'INVALID_QR')
  hizmet.addCard({ qr: qr(Y.YABANCI) })
  t.is(kayit.query(PAYLASIMLAR, { type: 'hf.hizmet.kart' }).length, 2, 'aynı kart ikinci kez yazılmaz')
  t.is(hizmet.addCard({ qr: qr({ ...Y.YABANCI, keyVersion: 5 }) }).keyVersion, 5)
  t.is(hataOf(() => hizmet.addCard({ qr: qr({ ...Y.YABANCI, keyVersion: 1 }) })), 'CARD_STALE')
  const yeniAdres = hizmet.addCard({ qr: qr({ ...Y.YABANCI, keyVersion: 5, issuedAt: Y.YABANCI.issuedAt + 1, contact: 'Yeni adres' }) })
  t.is(yeniAdres.iletisim, 'Yeni adres', 'aynı sürümde büyük issuedAt kazanır')
  const f = kayit.query(PAYLASIMLAR, { type: 'hf.hizmet.kart' }).map((x) => x.fields).find((x) => x.trust === 'dizin')
  t.alike([f._subj, f.added_by], ['topluluk', hex(V.K.husniye.memberId)])
})

test('hazırla: öğeler kayıtlardan, dosya başvurusu yok; tam önizleme; sahip kayıttan', (t) => {
  const { hizmet, kayit, L } = kur()
  hizmet.directory({ bytes: dizinBaytlari() })
  const r = kayitlar(kayit)
  const o = hizmet.prepare(TASLAK(sid(Y.VETERINER), r.coki))
  t.alike(o.ogeler.map((i) => [i.type, i.alanlar.adet, 'foto' in i.alanlar]), [['yuva.pet.kum', 2, false], ['yuva.pet.kum', 3, false]])
  t.is(hex(H.paket.payloadHash(o.govde)), o.payloadHash)
  t.alike([o.tur, o.ownerId, o.etiket], ['tek', hex(b4a.alloc(16)), 'Hüsniye'])
  t.alike(o.imzacilar, { hepsi: [], biri: L.parentIds() })
  // Seçilen alanlar
  t.alike(Object.keys(hizmet.prepare(TASLAK(sid(Y.VETERINER), [r.coki[0]], { kaynaklar: [{ collectionId: A.K_TUM_AILE, recordIds: [r.coki[0]], alanlar: [] }] })).ogeler[0].alanlar), [])
  // Aile içi kimlik pakete girmez (açıklama 2 madde 1): _subj ve uye:/grant: başvuruları düşer; sahip yine kayıttan
  const kimlikli = kayit.put(A.K_TUM_AILE, null, 'yuva.saglik.not', { _subj: 'uye:' + hex(V.K.irem.memberId), metin: 'x', yazan: 'uye:' + hex(V.K.kerem.memberId), gorenler: ['grant:' + hex(b4a.alloc(16, 1))], etiket: 'uyelik' })
  const ki = hizmet.prepare(TASLAK(sid(Y.VETERINER), [kimlikli]))
  t.alike(ki.ogeler[0].alanlar, { metin: 'x', etiket: 'uyelik' })
  t.is(ki.ownerId, hex(V.K.irem.memberId))
  t.absent(b4a.toString(ki.govde, 'hex').includes(hex(V.K.irem.memberId)), 'gövde baytlarında sahibin kimliği yok')
  // Yetişkinin verisi: sahip kayıttan (çağıranın beyanı yok), imzacı kendisi
  const ir = hizmet.prepare(TASLAK(sid(Y.VETERINER), [r.irem]))
  t.alike([ir.ownerId, ir.imzacilar], [hex(V.K.irem.memberId), { hepsi: [hex(V.K.irem.memberId)], biri: [] }])
  t.is(hataOf(() => hizmet.confirm({ shareId: ir.shareId, payloadHash: ir.payloadHash })), 'NOT_SIGNER', 'Hüsniye İrem yerine onaylayamaz')
  // Çocuğun ortak koleksiyondaki verisi: bir ebeveyn
  t.alike(hizmet.prepare(TASLAK(sid(Y.VETERINER), [r.ecem])).imzacilar.biri, L.parentIds())
  t.is(hataOf(() => hizmet.prepare(TASLAK(sid(Y.VETERINER), [r.coki[0], r.irem]))), 'MIXED_OWNER')
  t.is(hataOf(() => hizmet.prepare(TASLAK(sid(Y.VETERINER), []))), 'RECORD_REQUIRED')
  t.is(hataOf(() => hizmet.prepare(TASLAK(sid(Y.VETERINER), [hex(b4a.alloc(16, 9))]))), 'NO_RECORD')
  t.is(hataOf(() => hizmet.prepare(TASLAK(sid(Y.VETERINER), r.coki, { files: [{ blobId: b4a.alloc(32), fileKey: b4a.alloc(32), size: 21 * 1024 * 1024, mime: 'video/mp4', name: 'v.mp4' }] }))), 'SIZE_OVERRUN')
})

test('onayla → gönder → gonderildi: koşul her denemede; teslim penceresi gönderimden 7 gün; kayıt PUT\'tan sonra', (t) => {
  const { hizmet, kayit, L, saat } = kur()
  hizmet.directory({ bytes: dizinBaytlari() })
  const vet = H.kart.kartCoz(Y.kartKur(Y.VETERINER))
  const r = kayitlar(kayit)
  const o = hizmet.prepare(TASLAK(sid(Y.VETERINER), r.coki, { sureGun: 2 }))
  t.is(hataOf(() => hizmet.send({ shareId: o.shareId })), 'NO_APPROVAL')
  t.is(hizmet.shares().find((x) => x.shareId === o.shareId).durum, 'taslak')
  const once = L.len
  const ok = hizmet.confirm({ shareId: o.shareId, payloadHash: o.payloadHash })
  t.alike([ok.durum, ok.seq, L.len], ['uygulandi', once, once + 1])
  t.is(hataOf(() => hizmet.confirm({ shareId: o.shareId, payloadHash: o.payloadHash })), 'APPROVAL_EXISTS')
  saat.t += GUN + 1
  const istek = hizmet.send({ shareId: o.shareId })
  const p = H.paket.paketCoz(istek.bytes)
  t.is(p.expiresAt, saat.t + 7 * GUN, 'PAKET.expiresAt onayın süresine bağlı değil')
  t.is(kayit.query(PAYLASIMLAR, { type: 'hf.paylasim.gonderildi' }).length, 0, 'PUT\'tan önce kayıt yok')
  t.is(hizmet.shares().find((x) => x.shareId === o.shareId).durum, 'gonderiliyor')
  t.alike(hizmet.send({ shareId: o.shareId }), istek, 'yeniden deneme aynı baytlar')
  t.alike(hizmet.sent({ shareId: o.shareId }), { packageId: istek.packageId })
  hizmet.sent({ shareId: o.shareId })
  const k = kayit.query(PAYLASIMLAR, { type: 'hf.paylasim.gonderildi' })
  t.is(k.length, 1)
  t.alike([hex(k[0].fields.package_id), k[0].fields.consent_seq, k[0].fields.service_name], [istek.packageId, ok.seq, 'Maple Veteriner Kliniği'])
  const ac = H.paket.paketAc(istek.bytes, { kart: vet, encSecret: H.paket.sifreCifti(b4a.from(Y.VETERINER.encSeed, 'hex')).secretKey })
  t.is(ac.govde.items.length, 2)
  t.is(hizmet.shares().find((x) => x.shareId === o.shareId).durum, 'gonderildi')
  // Onayın süresi geçince yeniden deneme de yok
  saat.t += GUN
  t.is(hataOf(() => hizmet.send({ shareId: o.shareId })), 'TERM_EXPIRED')
  t.is(hataOf(() => hizmet.sent({ shareId: hizmet.prepare(TASLAK(sid(Y.VETERINER), r.coki)).shareId })), 'NO_DELIVERY')
  // Dizin eskise de gelen cevap okunur (yalnız dizinde olan hizmet; inceleme A2 madde 9); kaydın _t'si yerel saat
  saat.t = V.TS0 + 15 * GUN
  const ac2 = H.paket.paketAc(istek.bytes, { kart: vet, encSecret: H.paket.sifreCifti(b4a.from(Y.VETERINER.encSeed, 'hex')).secretKey })
  const cv = H.cevap.cevapKur({ packageId: b4a.from(istek.packageId, 'hex'), n: 0, replyPub: ac2.govde.replyPub, signSecret: Y.signCifti(Y.VETERINER.signSeed).secretKey, kind: 'makbuz', at: 7 })
  t.is(hizmet.receiveReply({ shareId: o.shareId, cevaplar: [{ packageId: istek.packageId, bytes: cv }] }).yeni.length, 1)
  const kc = kayit.query(PAYLASIMLAR, { type: 'hf.paylasim.cevap' })[0].fields
  t.alike([kc._t, kc.at], [saat.t, 7])
})

test('iptal: taslak silinir; iptalden sonra yeniden deneme yok; başka cihaz kayıttaki owner_secret ile siler', (t) => {
  const k = kur()
  const keremApi = k.api(V.K.kerem)
  const kerem = keremApi.hizmet
  k.hizmet.directory({ bytes: dizinBaytlari() })
  const r = kayitlar(k.kayit)
  const s = sid(Y.VETERINER)
  const a = k.hizmet.prepare(TASLAK(s, r.coki))
  t.alike(k.hizmet.cancel({ shareId: a.shareId }), { durum: 'silindi', sil: [] })
  t.is(hataOf(() => k.hizmet.cancel({ shareId: a.shareId })), 'NO_SHARE')
  const b = k.hizmet.prepare(TASLAK(s, r.coki))
  k.hizmet.confirm({ shareId: b.shareId, payloadHash: b.payloadHash })
  const g = k.hizmet.send({ shareId: b.shareId })
  // Gönderilmiş ama kaydı yazılmamışken iptal: yerel gönderimden silme isteği
  const ip = k.hizmet.cancel({ shareId: b.shareId })
  t.is(ip.durum, 'iptal')
  t.alike(ip.sil.map((x) => [x.packageId, H.paket.sahipOzeti(b4a.from(x.ownerSecret, 'hex')), x.endpoint]), [[g.packageId, g.owner, 'https://hizmet.example.tr']])
  t.is(hataOf(() => k.hizmet.send({ shareId: b.shareId })), 'NO_DRAFT', 'iptalden sonra yeniden deneme yok: taslağın gövdesi ve sırları silindi')
  t.alike(k.saklama.get('hizmet/taslaklar').find((x) => x.shareId === b.shareId), { shareId: b.shareId, durum: 'iptal', olusturma: k.saklama.get('hizmet/taslaklar').find((x) => x.shareId === b.shareId).olusturma })
  t.is(k.kayit.query(PAYLASIMLAR, { type: 'hf.paylasim.iptal' }).length, 1)
  t.alike(kerem.cancel({ shareId: b.shareId }).sil, [], 'Kerem\'de kayıt da yerel gönderim de yok')
  // Gönderilip kaydı yazılmış paylaşımı başka cihaz (Kerem) iptal eder ve kayıttaki sırla siler
  const c = k.hizmet.prepare(TASLAK(s, r.coki))
  k.hizmet.confirm({ shareId: c.shareId, payloadHash: c.payloadHash })
  const gc = k.hizmet.send({ shareId: c.shareId })
  k.hizmet.sent({ shareId: c.shareId })
  A.teslim(k.kayit.r, keremApi.kayit.r)
  keremApi.kayit.sync()
  kerem.addCard({ qr: qr(Y.VETERINER) })
  const ik = kerem.cancel({ shareId: c.shareId })
  t.alike([ik.durum, ik.sil.length, ik.sil[0].packageId], ['iptal', 1, gc.packageId])
  t.is(H.paket.sahipOzeti(b4a.from(ik.sil[0].ownerSecret, 'hex')), gc.owner)
  // Başka cihaz zaten iptal ettiyse yeni olay yazılmaz, silme isteği yine döner
  const len = k.L.len
  t.is(k.hizmet.cancel({ shareId: c.shareId }).sil.length, 1)
  t.is(k.L.len, len)
  t.is(k.hizmet.shares().find((x) => x.shareId === c.shareId).durum, 'iptal')
})

test('yetki ve rıza: çocuk başlatamaz; çocuğun kişiseli yok (vektör 14); açık rıza; yurt dışı ayrı rıza', (t) => {
  const k = kur()
  k.hizmet.directory({ bytes: dizinBaytlari() })
  const r = kayitlar(k.kayit)
  t.is(hataOf(() => k.hizmet.prepare(TASLAK(sid(Y.VETERINER), r.coki, { kaynaklar: [{ collectionId: K_KISISEL_ECEM, recordIds: r.coki }] }))), 'CHILD_PERSONAL')
  t.is(hataOf(() => k.hizmet.prepare(TASLAK(sid(Y.VETERINER), r.coki, { kaynaklar: [] }))), 'SOURCE_REQUIRED')
  const cocuk = k.api(V.K.ecem).hizmet
  t.is(hataOf(() => cocuk.prepare(TASLAK(sid(Y.VETERINER), r.coki))), 'NO_PERMISSION')
  const ip = k.hizmet.prepare(TASLAK(sid(Y.VETERINER), r.coki))
  k.hizmet.confirm({ shareId: ip.shareId, payloadHash: ip.payloadHash })
  t.is(hataOf(() => cocuk.cancel({ shareId: ip.shareId })), 'NO_PERMISSION', 'çocuk Paylaşımlar\'ın okuyucusu değil')
  const b = k.hizmet.prepare(TASLAK(sid(BAKIM), r.coki))
  t.is(b.ozelNitelikli, true)
  t.is(hataOf(() => k.hizmet.confirm({ shareId: b.shareId, payloadHash: b.payloadHash })), 'CONSENT_TEXT_REQUIRED')
  k.hizmet.confirm({ shareId: b.shareId, payloadHash: b.payloadHash, consentTextVersion: 1 })
  k.hizmet.send({ shareId: b.shareId })
  k.hizmet.sent({ shareId: b.shareId })
  t.is(k.kayit.query(PAYLASIMLAR, { type: 'hf.paylasim.gonderildi' })[0].fields.consent_text_version, 1)
  k.hizmet.addCard({ qr: qr(Y.YABANCI) })
  const y = k.hizmet.prepare(TASLAK(sid(Y.YABANCI), r.coki))
  t.is(y.yurtDisi, true)
  t.is(hataOf(() => k.hizmet.confirm({ shareId: y.shareId, payloadHash: y.payloadHash })), 'ABROAD_CONSENT_REQUIRED')
  k.hizmet.confirm({ shareId: y.shareId, payloadHash: y.payloadHash, yurtDisiRiza: true })
  k.hizmet.send({ shareId: y.shareId })
  k.hizmet.sent({ shareId: y.shareId })
  t.ok(k.kayit.query(PAYLASIMLAR, { type: 'hf.paylasim.gonderildi' }).some((x) => x.fields.yurt_disi === true))
})

test('gizli onay (kişisel kaynak): defterde yalnız taahhüt; kayıt kişisel koleksiyona', (t) => {
  const k = kur(V.K.irem)
  k.hizmet.directory({ bytes: dizinBaytlari() })
  const not = k.kayit.put(A.K_KISISEL_IREM, null, 'yuva.saglik.not', { metin: 'tansiyon' })
  const ortak = k.kayit.put(A.K_TUM_AILE, null, 'yuva.pet.kum', { _subj: COKI, adet: 1 })
  const s = sid(Y.VETERINER)
  t.is(hataOf(() => k.hizmet.prepare(TASLAK(s, [], { kaynaklar: [{ collectionId: A.K_KISISEL_IREM, recordIds: [not] }, { collectionId: A.K_TUM_AILE, recordIds: [ortak] }] }))), 'MIXED_SOURCE')
  const o = k.hizmet.prepare(TASLAK(s, [], { kaynaklar: [{ collectionId: A.K_KISISEL_IREM, recordIds: [not] }] }))
  t.alike([o.tur, o.imzacilar.hepsi], ['gizli', [hex(V.K.irem.memberId)]])
  k.hizmet.confirm({ shareId: o.shareId, payloadHash: o.payloadHash })
  const onay = H.onay.onaylar(k.L).get(o.shareId)
  t.alike([onay.scope, onay.service.startsWith('gizli:'), onay.service.includes(s)], ['gizli', true, false])
  k.hizmet.send({ shareId: o.shareId })
  k.hizmet.sent({ shareId: o.shareId })
  t.is(k.kayit.query(PAYLASIMLAR, { type: 'hf.paylasim.gonderildi' }).length, 0)
  const kis = k.kayit.query(A.K_KISISEL_IREM, { type: 'hf.paylasim.gonderildi' })
  t.is(onay.service, H.onay.gizliService(b4a.from(s, 'hex'), kis[0].fields.salt))
  t.is(k.hizmet.shares().find((x) => x.shareId === o.shareId).hizmetAdi, 'Maple Veteriner Kliniği')
  const satir = k.api(V.K.kerem).hizmet.shares().find((x) => x.shareId === o.shareId)
  t.alike([satir.tur, satir.hizmet, satir.durum], ['gizli', null, 'onaylandi'])
  t.is(hataOf(() => k.api(V.K.kerem).hizmet.cancel({ shareId: o.shareId })), 'NO_PERMISSION', 'gizli onayı yalnız sahibi iptal eder')
  t.is(k.hizmet.cancel({ shareId: o.shareId }).sil.length, 1)
  t.is(k.kayit.query(A.K_KISISEL_IREM, { type: 'hf.paylasim.iptal' }).length, 1)
})

test('ekip: ortak veride bir sahip; üyenin iş verisinde üye ve bir sahip; yönetici imzacı değil', (t) => {
  const k = kur()
  const L = k.L
  // İmzacı listesi yalnız L.kind ve rollerden okunur; ekip defteri kurmadan rolleri geçici değiştir
  const asil = L.kind
  const rol = new Map(L.personIds().map((id) => [id, L.members.get(id).role]))
  L.kind = 'ekip'
  L.members.get(hex(V.K.kerem.memberId)).role = 'sahip'
  L.members.get(hex(V.K.husniye.memberId)).role = 'yonetici'
  try {
    t.alike(k.hizmet._imzacilar(b4a.alloc(16)), { hepsi: [], biri: [hex(V.K.kerem.memberId)] })
    t.alike(k.hizmet._imzacilar(V.K.irem.memberId), { hepsi: [hex(V.K.irem.memberId)], biri: [hex(V.K.kerem.memberId)] })
    t.is(k.hizmet._imzaciMi(b4a.alloc(16)), false, 'yönetici imzacı değil')
  } finally {
    L.kind = asil
    for (const [id, r] of rol) L.members.get(id).role = r
  }
})

test('takma ad hizmete özel ve kalıcı; SERVICE_COMMAND 300–306, 309', (t) => {
  const k = kur()
  k.hizmet.directory({ bytes: dizinBaytlari() })
  const r = kayitlar(k.kayit)
  const pseudo = (s) => hex(H.paket.govdeCoz(k.hizmet.prepare(TASLAK(s, r.coki)).govde).sender.pseudoPub)
  t.is(pseudo(sid(Y.VETERINER)), pseudo(sid(Y.VETERINER)), 'aynı hizmete aynı takma ad')
  t.not(pseudo(sid(Y.VETERINER)), pseudo(sid(BAKIM)), 'iki hizmet aynı kişiyi eşleyemez')
  t.is(k.saklama.get('hizmet/takma/' + sid(Y.VETERINER)).length, 128, 'saklamada')
  t.alike(Object.values(S.SERVICE_COMMAND), [300, 301, 302, 303, 304, 305, 306, 309])
})
