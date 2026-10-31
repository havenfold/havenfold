// SPDX-License-Identifier: Apache-2.0
// D49: inceleme 16 şüphelileri (kollar/D-inceleme-16.md). Beklenen değerler elle.
const test = require('brittle')
const b4a = require('b4a')
const { ledger: { Ledger, T, encodeEvent, decodeEvent, createEvent, signEvent }, ekipCikis: EC, proposals: { PROPOSAL_TTL_MS } } = require('@havenfold/core')
const { Replika, sealDrop, appendRecordId } = require('@havenfold/records/replica')
const { OP } = require('@havenfold/records/encoding')
const { fromMs } = require('@havenfold/records/hlc')
const S = require('..')
const D0 = require('../../core/core/test/helpers/ledger')
const V = require('../../core/core/test/helpers/v21')
const A = require('../../core/records/test/helpers/family')

const { K, TS0 } = D0
const hex = (b) => b4a.toString(b, 'hex')
const id = (k) => hex(k.memberId)
const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const GUN = 86_400_000
const YER = 'a1'.repeat(16)

function saat (t0 = TS0 + 60_000) { let t = t0; const f = () => ++t; f.ileri = (ms) => { t += ms }; f.su = () => t; return f }
function ekip () {
  const now = saat()
  const kurulus = S.TeamApi.create({ Ledger, me: K.kerem, isletmeAdi: 'Rivera Kuyum', displayName: 'Kerem', yer: { ad: 'Merkez', tur: 'sube' }, ts: TS0, placeId: YER })
  const L = kurulus.ledger
  const kisi = (k, Lk = L) => { const defter = new S.LedgerApi({ ledger: Lk, me: k, now }); return { k, L: Lk, defter, ekip: new S.TeamApi({ defter, now }) } }
  return { L, now, kisi, kurulus, kerem: kisi(K.kerem) }
}
function uyeEkle (x, yeni, role) {
  const r = x.defter.addMember({ deviceCert: yeni.deviceCert, displayName: yeni.ad, role, ceremonyTranscriptHash: b4a.alloc(32, 7) })
  if (r.durum === 'uygulandi') return r
  const y = new S.LedgerApi({ ledger: x.L, me: yeni, now: x.defter.now })
  y.oneriler = x.defter.oneriler
  return y.sign(r.oneriId)
}

test('ailede eski davranış: sahibin imzası eksik SHARE_CONSENT öneri olmaz, hata verir', (t) => {
  const L = A.anaDefter()
  const kerem = new S.LedgerApi({ ledger: L, me: A.K.kerem, now: () => A.TS0 + 1000 })
  const r = hataOf(() => kerem._yaz(T.SHARE_CONSENT, { shareId: b4a.alloc(16, 0x77), service: 'veteriner', scope: 'pati', ownerId: A.K.irem.memberId, expiresAt: A.TS0 + 7 * GUN, payloadHash: b4a.alloc(32, 5) }))
  t.is(r, 'NO_OWNER_APPROVAL')
  t.is(kerem.oneriler.items.size, 0)
})

test('waitingFor: sahip yapılan hedef ve yeni üye de beklenir; geçiciye geçiş öneriyle uygulanınca süre yazılır', (t) => {
  const { L, kerem, kisi } = ekip()
  uyeEkle(kerem, K.husniye, 'sahip')
  uyeEkle(kerem, K.ecem, 'calisan')
  const hus = kisi(K.husniye)
  hus.defter.oneriler = kerem.defter.oneriler
  // Yeni üye: davet eden ve yeni üyenin imzası; diğer sahip
  const r = kerem.defter.addMember({ deviceCert: K.irem.deviceCert, displayName: 'İrem', role: 'sahip', ceremonyTranscriptHash: b4a.alloc(32, 7) })
  t.alike(kerem.defter.waitingFor(r.oneriId).sort(), [id(K.husniye), id(K.irem)].sort())
  t.ok(L.members.get(id(K.ecem))?.active, 'Ecem üye ' + JSON.stringify(L.members.get(id(K.ecem)) && L.members.get(id(K.ecem)).role))
  // SET_ROLE → sahip: hedef de imzalar
  const s = kerem.ekip.role(id(K.ecem), 'sahip')
  t.is(s.durum, 'oneri')
  t.alike(kerem.defter.waitingFor(s.oneriId).sort(), [id(K.husniye), id(K.ecem)].sort())
  kerem.defter.rejectProposal(s.oneriId)
  // Geçiciye geçiş iki sahiple öneri değil (herhangi bir sahip); ama sahip→geçici diğer sahipler ister
  kerem.defter.rejectProposal(r.oneriId) // İrem'in önerisi
  const u = uyeEkle(kerem, K.u5, 'sahip')
  t.is(hus.defter.sign(u.oneriId).durum, 'uygulandi', 'üçüncü sahip: bütün sahipler')
  const bitis = kerem.defter.now() + 30 * GUN
  const g = hus.ekip.role(id(K.u5), 'gecici', { sureSonu: bitis })
  t.is(g.durum, 'oneri', 'sahipten geçiciye: hedef ve diğer bütün sahipler')
  const u5 = new S.LedgerApi({ ledger: L, me: K.u5, now: kerem.defter.now })
  u5.oneriler = kerem.defter.oneriler
  t.is(u5.sign(g.oneriId).durum, 'oneri')
  t.is(kerem.defter.sign(g.oneriId).durum, 'uygulandi')
  hus.defter.changed()
  t.is(L.members.get(id(K.u5)).role, 'gecici')
  t.is(L.terms.get(id(K.u5))?.expiresAt, bitis, 'öneren telefon süreyi yazdı')
})

test('öneri ömrü olayın zamanından: 24 saati geçen öneri eski imzalarla yeniden gelince kabul edilmez', (t) => {
  const { kerem, kisi, now } = ekip()
  uyeEkle(kerem, K.ecem, 'calisan')
  uyeEkle(kerem, K.irem, 'calisan')
  const o = kisi(K.irem).ekip.remove(id(K.ecem))
  t.is(o.durum, 'oneri', 'çalışanın önerisi yönetim bekler')
  t.is(kerem.defter.receiveProposal(id(K.irem), encodeEvent(o.event), 'dogrudan').durum, 'waiting')
  kerem.defter.oneriler.expire(now.su() + PROPOSAL_TTL_MS + 1)
  now.ileri(PROPOSAL_TTL_MS + 1000)
  const hataYok = hataOf(() => kerem.defter.receiveProposal(id(K.irem), encodeEvent(o.event), 'dogrudan'))
  t.is(hataYok, 'PROPOSAL_NOT_ALLOWED', 'süresi dolmuş öneri yeniden 24 saat almaz')
})

test('tam kapsam istenip yalnız iş kapsamı silinirse makbuz TAM demez; yönetim dar makbuzu reddeder', (t) => {
  const { L, kerem, now } = ekip()
  uyeEkle(kerem, K.ecem, 'calisan')
  const Le = new Ledger(); for (const e of L.events) Le.apply(decodeEvent(encodeEvent(e)))
  const ecem = new S.TeamApi({ defter: new S.LedgerApi({ ledger: Le, me: K.ecem, now }), now })
  const c = kerem.ekip.remove(id(K.ecem), { wipe: true })
  const s = ecem.receiveExit(id(K.kerem), c.cikis.bytes, 'dogrudan')
  t.is(s.istenen, 'tam')
  t.is(s.kapsam, 'is', 'kancasız yol sohbetleri silemez')
  t.is(hataOf(() => kerem.ekip.receiveReceipt(id(K.ecem), s.makbuz.bytes, 'posta')), 'INVALID_RECEIPT')
  // Platform kancasıyla tam
  const Le2 = new Ledger(); for (const e of L.events.slice(0, c.event.seq)) Le2.apply(decodeEvent(encodeEvent(e)))
  const ecem2 = new S.TeamApi({ defter: new S.LedgerApi({ ledger: Le2, me: K.ecem, now }), now })
  const s2 = ecem2.receiveExit(id(K.kerem), c.cikis.bytes, 'dogrudan', { sil: ({ kapsam }) => ({ collections: kapsam === 'tam' ? 6 : 0, convs: 2 }) })
  t.is(s2.kapsam, 'tam')
  t.is(kerem.ekip.receiveReceipt(id(K.ecem), s2.makbuz.bytes, 'posta').scope, EC.KAPSAM.TAM)
})

test('ayrılış: LEAVE önce yazılır, silme ondan sonra', (t) => {
  const { L, kerem, kisi } = ekip()
  uyeEkle(kerem, K.ecem, 'calisan')
  let lenSilerken = null
  const r = kisi(K.ecem).ekip.leave({ sil: () => { lenSilerken = L.len; return {} } })
  t.is(r.event.type, T.LEAVE)
  t.is(lenSilerken, r.event.seq + 1, 'silme LEAVE uygulandıktan sonra')
})

test('Mekan kuralları SDK üstünden: PERSON_EVENT (cihaz kaydı kişi öznesi), NO_DISCLOSURE (aydınlatmasız yerde kamera görevi)', (t) => {
  const { L, kerem, kurulus, now } = ekip()
  const dev = V.C.isci1
  // Cihaz töreni: sahip ve cihazın imzası
  const e = createEvent(L, T.DEVICE_ATTACH, { deviceCert: dev.deviceCert, class: 'isci', name: 'kamera', placeId: b4a.from(YER, 'hex'), caps: b4a.from('caps'), ceremonyTranscriptHash: b4a.alloc(32, 7) }, now())
  signEvent(e, dev); signEvent(e, K.kerem); L.apply(e)
  const col = [...L.collections.values()].find((c) => c.name === 'Olaylar:Merkez')
  t.is(kerem.defter._yaz(T.COLLECTION, { collectionId: b4a.from(col.id, 'hex'), name: col.name, kind: col.kind, readers: col.readers, writers: [...col.writers, 'device:' + id(dev)], sensitivity: col.sensitivity, taskAccess: col.taskAccess, history: col.history, dropKey: b4a.from(col.dropKey) }).durum, 'uygulandi')
  const rk = new Replika({ ledger: L, me: K.kerem, now })
  rk.sync()
  for (const x of kurulus.birakma) rk.addDropSecret(x.collectionId, x.secret)
  const birak = (subj) => {
    const hlc = fromMs(now())
    return rk.receiveOp(sealDrop({ familyId: L.familyId, collectionId: b4a.from(col.id, 'hex'), dropKey: b4a.from(col.dropKey), signer: dev, inner: { recordId: appendRecordId(dev.memberId, hlc), op: OP.APPEND, type: 'mekan.kasa.bos', fields: [{ name: '_subj', value: subj }, { name: '_t', value: now.su() }], hlc, authorId: dev.memberId, ledgerSeq: L.len - 1, ledgerHash: L.head } }), 1)
  }
  t.is(birak('uye:' + id(K.kerem)).code, 'PERSON_EVENT')
  t.is(birak('yer:' + YER).status, 'gecerli')
  // İşçi: aydınlatma yokken kamera görevi NO_DISCLOSURE; TeamApi.privacyNotice sonrası kabul
  const { Isci } = require('@havenfold/tasks').denetim
  const G = require('../../core/tasks/test/helpers/task')
  const Kd = require('@havenfold/tasks').kodlama
  const izin = { ekip: true, kisiOlcer: false, yuz: false, plaka: false }
  const SIMDI = now.su()
  const isci = () => new Isci({ ledger: L, me: dev, caps: G.caps(dev, { tasks: [{ type: 'hf.task.vision', version: '1.0.0', standing: true }] }), now: () => SIMDI, imajlar: () => izin })
  const yer = [...L.collections.values()].find((c) => c.name === 'Yer:Merkez').id
  const gorev = (n) => Kd.encodeTask(L.familyId, { ...G.gorev(L, { requester: K.kerem.memberId, collectionId: b4a.from(yer, 'hex'), workerId: dev.memberId, type: 'hf.task.vision', version: '1.0.0', taskId: b4a.alloc(16, n), deadline: SIMDI + 3_600_000 }) }, K.kerem)
  const kod = (x) => (x.ok ? 'kabul' : x.code)
  t.is(kod(isci().denetle(gorev(1), { from: id(K.kerem) })), 'AYDINLATMA_YOK') // TASK_REJECT kodu, telde Türkçe
  kerem.ekip.privacyNotice({ placeId: YER, textBlobId: b4a.alloc(32, 1), signBlobId: b4a.alloc(32, 2), textVersion: 'mekan-aydinlatma-2026.1', cameraCount: 1 })
  t.is(kod(isci().denetle(gorev(2), { from: id(K.kerem) })), 'kabul')
})
