// SPDX-License-Identifier: Apache-2.0
// D45 düşmanca inceleme: KIRMIZI testler. Her test doğru davranışı ister; bugün (eaeda43) kırmızıdır.
// Çalıştırma: HF_KOK=<d45 ağacı> brittle-node kirmizi.js  (Bare: brittle-bare kirmizi.js; HF_KOK yoksa varsayılan yol)
const KOK = __dirname + '/../..' // D49: kollar/D-inceleme-16-testler/kirmizi.js'den
const test = require(KOK + '/node_modules/brittle')
const b4a = require(KOK + '/node_modules/b4a')
const { ledger: { Ledger, T, encodeEvent, decodeEvent, createEvent, signEvent, eventHash }, ekipCikis: EC } = require(KOK + '/node_modules/@havenfold/core')
const { Replika, sealDrop, appendRecordId } = require(KOK + '/node_modules/@havenfold/records/replica')
const { OP } = require(KOK + '/node_modules/@havenfold/records/encoding')
const { fromMs } = require(KOK + '/node_modules/@havenfold/records/hlc')
const S = require(KOK + '/sdk')
const D0 = require(KOK + '/core/core/test/helpers/ledger')
const V = require(KOK + '/core/core/test/helpers/v21')

const { K, TS0 } = D0
const hex = (b) => b4a.toString(b, 'hex')
const id = (k) => hex(k.memberId)
const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const GUN = 86_400_000
const YER = 'a1'.repeat(16)
const DEPO = 'b2'.repeat(16)

function saat (t0 = TS0 + 60_000) { let t = t0; const f = () => ++t; f.ileri = (ms) => { t += ms }; f.su = () => t; return f }

// d45.js'teki kurulumun aynısı: her kişinin kendi LedgerApi'si (ayrı öneri deposu), aynı defter nesnesi
function ekip () {
  const now = saat()
  const { ledger: L } = S.TeamApi.create({ Ledger, me: K.kerem, isletmeAdi: 'Rivera Kuyum', displayName: 'Kerem', yer: { ad: 'Merkez', tur: 'sube' }, ts: TS0, placeId: YER })
  const kisi = (k, Lk = L) => { const defter = new S.LedgerApi({ ledger: Lk, me: k, now }); return { k, L: Lk, defter, ekip: new S.TeamApi({ defter, now }) } }
  return { L, now, kisi, kerem: kisi(K.kerem) }
}
function uyeEkle (x, yeni, role) {
  const r = x.defter.addMember({ deviceCert: yeni.deviceCert, displayName: yeni.ad, role, ceremonyTranscriptHash: b4a.alloc(32, 7) })
  if (r.durum === 'uygulandi') return r
  const y = new S.LedgerApi({ ledger: x.L, me: yeni, now: x.defter.now })
  y.oneriler = x.defter.oneriler
  return y.sign(r.oneriId)
}
// Öneriye bir imza daha ekleyip LEDGER_PROPOSE baytı yapar (ağdaki saldırgan telefonun yapacağı)
const imzaEkle = (e, k) => { const x = decodeEvent(encodeEvent(e)); signEvent(x, k); return encodeEvent(x) }

test('K1 ORTA: geçici bir imza ekleyerek bekleyen ekip önerisini bütün telefonlarda düşürür (TEMPORARY_CANNOT_VOTE → stale)', (t) => {
  const { kerem, kisi } = ekip()
  uyeEkle(kerem, K.ecem, 'calisan')
  uyeEkle(kerem, K.irem, 'calisan')
  uyeEkle(kerem, K.u5, 'gecici')
  kerem.ekip.assign(id(K.irem), [YER])
  // Çalışan Ecem İrem'in çıkarılmasını önerir (D45 ile öneri olur, yönetim bekler)
  const ecem = kisi(K.ecem)
  const r = ecem.ekip.remove(id(K.irem))
  t.is(r.durum, 'oneri')
  const a = kerem.defter.receiveProposal(id(K.ecem), encodeEvent(r.event), 'dogrudan')
  t.is(a.durum, 'waiting', 'Kerem\'in telefonunda bekliyor')
  // Geçici Gül aynı öneriyi kendi imzasıyla yeniden gönderir
  const g = kerem.defter.receiveProposal(id(K.u5), imzaEkle(r.event, K.u5), 'dogrudan')
  t.not(g.durum, 'stale', 'geçicinin imzası öneriyi düşürmemeli (yok sayılmalı)')
  t.ok(kerem.defter.oneriler.items.has(a.oneriId), 'öneri Kerem\'de hâlâ bekliyor olmalı')
})

test('K2 DÜŞÜK-ORTA: alanı dışındaki yönetici waitingFor\'da görünür; imzalayınca öneri düşer (OUT_OF_SCOPE → stale)', (t) => {
  const { kerem, kisi } = ekip()
  kerem.ekip.places({ ekle: { ad: 'Depo', tur: 'depo', placeId: DEPO } })
  uyeEkle(kerem, K.husniye, 'yonetici')
  uyeEkle(kerem, K.ecem, 'calisan')
  uyeEkle(kerem, K.irem, 'calisan')
  kerem.ekip.assign(id(K.husniye), [YER])
  kerem.ekip.assign(id(K.irem), [DEPO])
  const r = kisi(K.ecem).ekip.remove(id(K.irem))
  t.is(r.durum, 'oneri')
  const a = kerem.defter.receiveProposal(id(K.ecem), encodeEvent(r.event), 'dogrudan')
  t.is(a.durum, 'waiting')
  t.absent(a.waitingFor.includes(id(K.husniye)), 'Merkez yöneticisi Depo\'daki çalışan için beklenmemeli')
  const h = kerem.defter.receiveProposal(id(K.husniye), imzaEkle(r.event, K.husniye), 'dogrudan')
  t.not(h.durum, 'stale', 'alan dışı imza öneriyi düşürmemeli')
  t.ok(kerem.defter.oneriler.items.has(a.oneriId))
})

test('K3 ORTA: 90 gün sınırı imzalayan telefonda denetlenmez; çalışanın taslağı 10 yıllık TERM olarak tek dokunuşla uygulanır', (t) => {
  const { L, kerem, kisi, now } = ekip()
  uyeEkle(kerem, K.ecem, 'calisan')
  uyeEkle(kerem, K.u5, 'gecici')
  kerem.ekip.setTerm(id(K.u5), now.su() + 2 * GUN)
  // Ecem'in (değiştirilmiş) uygulaması TeamApi.setTerm'nin denetimini atlayıp ham TERM yazar → D45'le öneri olur
  const ecem = kisi(K.ecem)
  const on = now.su() + 3650 * GUN
  const r = ecem.defter._yaz(T.TERM, { memberId: K.u5.memberId, expiresAt: on })
  t.is(r.durum, 'oneri')
  const a = kerem.defter.receiveProposal(id(K.ecem), encodeEvent(r.event), 'dogrudan')
  // Arayüzün gösterdiği öneri listesinde süre yok: yalnız tür ve hedef
  const liste = kerem.defter.listProposals().find((x) => x.proposalId === a.oneriId)
  t.ok(liste && ('expiresAt' in liste || 'sure' in liste), 'imzalayan sahip süreyi görebilmeli')
  const s = hataOf(() => kerem.defter.sign(a.oneriId))
  t.is(s, 'TERM_LIMIT', 'yazan tarafın 90 gün kuralı imzada da uygulanmalı')
  t.not(L.terms.get(id(K.u5)).expiresAt, on, '10 yıllık süre deftere girmemeli')
})

test('K4 DÜŞÜK: ayrılan üye aynı LEAVE için ikinci makbuz verebilir (sıfır özet + LEAVE özeti; RFC-0022 e tek kullanımlık)', (t) => {
  const { L, kerem, kisi } = ekip()
  uyeEkle(kerem, K.ecem, 'calisan')
  const ecem = kisi(K.ecem)
  const r = ecem.ekip.leave({ sil: () => ({ collections: 1 }) })
  t.is(r.durum, 'uygulandi')
  kerem.ekip.receiveReceipt(id(K.ecem), r.makbuz.bytes, 'posta')
  const ikinci = EC.makbuzYaz(L.familyId, K.ecem, { eventHash: eventHash(r.event), scope: EC.KAPSAM.TAM, collections: 99, convs: 99, blobs: 99, finishedAt: 1 })
  const h = hataOf(() => kerem.ekip.receiveReceipt(id(K.ecem), ikinci, 'posta'))
  t.ok(h === 'DUPLICATE_RECEIPT' || h === 'INVALID_RECEIPT', 'aynı ayrılış için ikinci makbuz reddedilmeli (bugün: ' + h + ')')
  t.is(Object.keys(kerem.ekip._makbuzlar()).length, 1)
})

test('K5 DÜŞÜK: sahip "iş verisini silme" deyince de "silindi" makbuzu üretilir; yönetimde "geldi" görünür', (t) => {
  const { kerem, kisi } = ekip()
  uyeEkle(kerem, K.husniye, 'sahip')
  const hus = kisi(K.husniye)
  let silindi = 0
  const r = hus.ekip.leave({ isVerisiniSil: false, sil: () => { silindi++; return {} } })
  t.is(r.durum, 'uygulandi')
  t.is(silindi, 0, 'silme çağrılmadı')
  t.absent(r.makbuz, 'silme yapılmadıysa silme makbuzu olmamalı')
  if (r.makbuz) kerem.ekip.receiveReceipt(id(K.husniye), r.makbuz.bytes, 'posta')
  t.not(kerem.ekip.exitStatus()[0].makbuz.durum, 'geldi', 'yönetim "iş verisini sildiğini bildirdi" görmemeli')
})

test('K6 ORTA (işlev): kur ve yerler\'in Olaylar/Paylaşımlar bırakma anahtarının gizlisi kimsede yok; cihaz kaydı okunamaz', (t) => {
  // D49 uyarlaması: kur bırakma anahtarlarının gizlisini döndürür (birakma), uygulama kurucunun replikasına verir
  const now = saat()
  const kurulus = S.TeamApi.create({ Ledger, me: K.kerem, isletmeAdi: 'Rivera Kuyum', displayName: 'Kerem', yer: { ad: 'Merkez', tur: 'sube' }, ts: TS0, placeId: YER })
  const L = kurulus.ledger
  const kerem = { defter: new S.LedgerApi({ ledger: L, me: K.kerem, now }) }
  // Merkez'e işçi cihazı (sahip + cihaz imzası)
  const dev = V.C.isci1
  const e = createEvent(L, T.DEVICE_ATTACH, { deviceCert: dev.deviceCert, class: 'isci', name: 'kamera', placeId: b4a.from(YER, 'hex'), caps: b4a.from('caps'), ceremonyTranscriptHash: b4a.alloc(32, 7) }, now())
  signEvent(e, dev); signEvent(e, K.kerem); L.apply(e)
  const col = [...L.collections.values()].find((c) => c.name === 'Olaylar:Merkez')
  const dk = b4a.from(col.dropKey)
  // Sürekli görev öncesi telefonun yaptığı gibi device: yazarı eklenir (aynı dropKey)
  const u = kerem.defter._yaz(T.COLLECTION, { collectionId: b4a.from(col.id, 'hex'), name: col.name, kind: col.kind, readers: col.readers, writers: [...col.writers, 'device:' + id(dev)], sensitivity: col.sensitivity, taskAccess: col.taskAccess, history: col.history, dropKey: dk })
  t.is(u.durum, 'uygulandi')
  const rk = new Replika({ ledger: L, me: K.kerem, now })
  rk.sync()
  for (const x of kurulus.birakma) rk.addDropSecret(x.collectionId, x.secret)
  t.alike(kurulus.birakma.map((x) => L.collections.get(x.collectionId).name).sort(), ['Olaylar:Merkez', 'Paylaşımlar'])
  const hlc = fromMs(now.su())
  const bytes = sealDrop({ familyId: L.familyId, collectionId: b4a.from(col.id, 'hex'), dropKey: dk, signer: dev, inner: { recordId: appendRecordId(dev.memberId, hlc), op: OP.APPEND, type: 'mekan.kasa.bos', fields: [{ name: '_subj', value: 'yer:' + YER }, { name: '_t', value: now.su() }], hlc, authorId: dev.memberId, ledgerSeq: L.len - 1, ledgerHash: L.head } })
  const s = rk.receiveOp(bytes, 1)
  t.is(s.status, 'gecerli', 'kurucu sahip kendi Olaylar koleksiyonuna bırakılan kaydı açabilmeli (bugün: ' + s.status + ' ' + (s.code || '') + ')')
  t.ok(rk.keys.dropsOf(col.id).length > 0, 'bırakma anahtarının gizlisi kurucuda olmalı')
})

test('K7 DÜŞÜK: ayrılış ve çıkış silmesinde (varsayılan yol) bekleyen öneriler silinmez (RFC-0005 §10.2 madde 6)', (t) => {
  const { L, kerem, kisi, now } = ekip()
  uyeEkle(kerem, K.ecem, 'calisan')
  uyeEkle(kerem, K.irem, 'calisan')
  uyeEkle(kerem, K.husniye, 'sahip')
  // Ecem'in telefonunda bekleyen bir öneri (D45 yolu)
  const Le = new Ledger(); for (const e of L.events) Le.apply(decodeEvent(encodeEvent(e)))
  const ecem = new S.TeamApi({ defter: new S.LedgerApi({ ledger: Le, me: K.ecem, now }), now })
  t.is(ecem.d.removeMember(id(K.irem)).durum, 'oneri')
  t.is(ecem.d.oneriler.items.size, 1)
  const c = kerem.ekip.remove(id(K.ecem))
  const s = ecem.receiveExit(id(K.kerem), c.cikis.bytes, 'dogrudan')
  t.is(s.durum, 'silindi')
  t.is(ecem.d.oneriler.items.size, 0, 'iş kapsamı silinince bekleyen öneriler de silinmeli')
})

test('K8 DÜŞÜK: yerler({ ekle }) var olan etkin placeId ile yeri yeniden adlandırır ve ikinci Yer:/Olaylar: koleksiyonlarını açar', (t) => {
  const { L, kerem } = ekip()
  const once = L.collections.size
  const r = hataOf(() => kerem.ekip.places({ ekle: { ad: 'Merkez 2', tur: 'sube', placeId: YER } }))
  t.ok(r === 'PLACE_ALREADY_EXISTS' || r === 'INVALID_BODY', 'etkin yer yeniden eklenmemeli (bugün: ' + r + ')')
  t.is(L.collections.size, once, 'yinelenen koleksiyon açılmamalı (bugün +' + (L.collections.size - once) + ')')
})
