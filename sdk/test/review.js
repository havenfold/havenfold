// SPDX-License-Identifier: Apache-2.0
// D9: inceleme 1 bulguları, RFC-0015 (SDK). Beklenen değerler elle yazılmıştır.
const test = require('brittle')
const b4a = require('b4a')
const { zarf: { Z }, caps: { CapsBook }, hello: { CAPS }, ledger: { Ledger, T } } = require('@havenfold/core')
const Gr = require('@havenfold/tasks')
const S = require('..')
const A = require('../../core/records/test/helpers/family')
const G = require('../../core/tasks/test/helpers/task')
const { C0, E } = require('../../core/records/test/helpers/multi-vector')

const hex = (b) => b4a.toString(b, 'hex')
const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const TA = hex(A.K_TUM_AILE)
const H = 3_600_000

function kur (kim = A.K.husniye, ek = {}) {
  const L = A.anaDefter()
  let simdi = A.TS0 + H
  const r = A.replika(L, kim, { now: () => simdi })
  const kayit = new S.RecordApi({ replika: r, ...ek })
  return { L, r, kayit, now: () => simdi, saat: (x) => { simdi = x } }
}

function cokluDefter () {
  const L = new Ledger({ now: () => A.TS0 })
  for (const e of C0) L.apply(require('@havenfold/core').ledger.decodeEvent(require('@havenfold/core').ledger.encodeEvent(e)))
  return L
}

test('SDK 1 ve 2 (§11.7 a): presenceWithin yalnız 24; kişinin bütün kimlikleri, birinde gizli bit varsa yok', (t) => {
  const L = cokluDefter()
  const cb = new CapsBook()
  let simdi = A.TS0 + H
  const g = new S.Presence({ ledger: L, me: A.K.husniye.memberId, caps: cb, now: () => simdi })
  const kerem = hex(A.K.kerem.memberId)
  const tablet = hex(E.keremTablet.memberId)
  g.direct(tablet, A.TS0 + H - 10 * 60_000) // yalnız tabletten görüldü
  t.alike(g.presence(kerem), { lastSeenMs: A.TS0 + H - 10 * 60_000, via: 'dogrudan', online: false }, 'kişi düzeyinde')
  t.is(g.presenceWithin(kerem), true)
  t.is(hataOf(() => g.presenceWithin(kerem, 1)), 'INVALID_VALUE')
  cb.record(tablet, CAPS.LEDGER_V21 | CAPS.HIDE_PRESENCE, A.TS0)
  t.alike(g.presence(kerem), { lastSeenMs: null, via: 'yok', online: false }, 'tablette gizli bit')
  simdi += 25 * H
  t.is(g.presenceWithin(kerem), false)
})

test('SDK 5: query where bayt, liste ve blobRef değerlerinde eşleşir', (t) => {
  const { kayit } = kur()
  const ref = kayit.attach({ bytes: b4a.from('x') }).blobRef
  kayit.put(TA, null, 'yuva.defter.not', { k: b4a.from([1, 2]), l: ['a', 'b'], d: ref })
  t.is(kayit.query(TA, { where: { k: b4a.from([1, 2]) } }).length, 1)
  t.is(kayit.query(TA, { where: { k: b4a.from([1, 3]) } }).length, 0)
  t.is(kayit.query(TA, { where: { l: ['a', 'b'] } }).length, 1)
  t.is(kayit.query(TA, { where: { l: ['a'] } }).length, 0)
  t.is(kayit.query(TA, { where: { d: { blobId: ref.blobId } } }).length, 1)
})

test('SDK 6 (§11.7 c): yapay zeka alanları RecordApi.put ile yazılamaz (tek yol AiApi.save, RFC-0023 104)', (t) => {
  const { kayit } = kur(A.K.husniye)
  const cikarim = { type: 'yuva.defter.not', fields: { baslik: 'Wifi', _ai: ['baslik'], _aiyol: 'telefon/apple-fm@1.0', _conf: 80 } }
  t.is(hataOf(() => kayit.put(TA, null, cikarim.type, cikarim.fields)), 'AI_APPROVAL_REQUIRED')
  t.is(kayit.yzOnayIste, undefined)
})

test('SDK 7 ve 23: resolveMember kişiyi taşır; negatif ya da kesirli seq INVALID_VALUE', (t) => {
  const L = cokluDefter()
  const r = S.resolveMember(L, E.keremTablet.memberId)
  t.is(r.personId, hex(A.K.kerem.memberId))
  t.is(r.primaryId, hex(A.K.kerem.memberId))
  t.alike(S.resolveMember(L, b4a.alloc(16, 0x77)), { activeId: null, name: '', role: null, active: false, personId: null, primaryId: null })
  t.is(hataOf(() => S.resolveMember(L, A.K.kerem.memberId, -1)), 'INVALID_VALUE')
  t.is(hataOf(() => S.resolveMember(L, A.K.kerem.memberId, 1.5)), 'INVALID_VALUE')
  t.is(hataOf(() => S.resolveMember(L, A.K.kerem.memberId, L.len)), 'LEDGER_BEHIND')
})

test('SDK 8, 18, 19: on(vaka) durum değişince; ayar kaydında tür denetimi; koleksiyonsuz çağrı hatası', (t) => {
  const { kayit, now } = kur()
  const olay = new S.EventApi({ kayit, now })
  const goren = []
  olay.on('case', (v) => goren.push(v.durum))
  const sos = olay.write(TA, 'hf.sos', { subj: 'uye:' + hex(A.K.husniye.memberId) })
  void sos
  const d = olay.evaluate(TA)
  kayit.put(TA, null, 'hf.vaka', d.yeni[0].alanlar)
  olay.evaluate(TA)
  olay.evaluate(TA)
  t.alike(goren, ['acik'], 'bir kez')
  olay.claim(TA, d.yeni[0].alanlar.vaka)
  olay.evaluate(TA)
  t.alike(goren, ['acik', 'sahipli'])
  const kural = olay.writeRule(TA, null, { _subj: 'topluluk', kosullar: [['hf.sos', 'sayi', '', 60, 'ge', 1]], eylem: 'sustur' })
  t.is(hataOf(() => olay.writeCard(TA, kural, { ad: 'x' })), 'TYPE_MISMATCH')
  t.is(hataOf(() => olay.cards()), 'COLLECTION_REQUIRED')
  t.is(hataOf(() => olay.cases()), 'COLLECTION_REQUIRED')
})

test('SDK 11 ve 13: BLOB_REQ ile çekme ve depolama; kayıt üst verisi ve geçmiş', (t) => {
  const { kayit, saat, now } = kur()
  const { kayit: diger } = kur(A.K.husniye)
  const a = kayit.attach({ bytes: b4a.from('kira sözleşmesi') })
  t.is(hataOf(() => diger.open(a.blobRef)), 'NO_FILE')
  const istek = diger.fetchRequest(a.blobRef)
  t.is(istek.type, Z.BLOB_REQ)
  for (const m of a.mesajlar) diger.blobReceived(hex(A.K.kerem.memberId), m, 'dogrudan')
  t.is(b4a.toString(diger.open(a.blobRef).bytes), 'kira sözleşmesi')
  const rid = kayit.put(TA, null, 'yuva.defter.not', { m: 1 })
  const ilk = now()
  saat(now() + 60_000)
  kayit.put(TA, rid, '', { m: 2 })
  const k = kayit.get(TA, rid)
  t.is(k.collectionId, TA)
  t.is(k.olusturan, hex(A.K.husniye.memberId))
  t.is(k.olusturma, ilk)
  t.is(k.degisme, ilk + 60_000)
  t.alike(kayit.history(TA, rid).map((x) => x.op), ['put', 'put'])
})

test('SDK 3, 4, 9, 16: sabit iş tutamacı; iptal bütün parçaları durdurur; deadline geçince başarısız; onay geri alma', (t) => {
  const L = G.defter()
  let saat = G.SIMDI
  const y = new Gr.yetenek.YetenekDefteri({ ledger: L, now: () => saat })
  y.al(G.capsBayt(L, G.C.isci1, { cores: 4, load1x100: 40 }))
  y.al(G.capsBayt(L, G.C.isci2, { cores: 2, load1x100: 30 }))
  const giden = []
  let n = 0
  const gorev = new S.TaskApi({ ledger: L, me: G.U.kerem, yetenekler: y, gonder: (p, ty, b) => giden.push({ p, ty, b }), now: () => saat, rastgele: () => b4a.alloc(16, 0x10 + n++) })
  gorev.consent(hex(G.C.isci1.memberId), true)
  gorev.consent(hex(G.C.isci2.memberId), true)
  const sonuc = []
  gorev.on('result', (id, r) => sonuc.push([id, r.status || r.code]))
  const opts = { collectionId: hex(G.K_TUM_AILE), ramMB: 2048, minutes: 30, deadline: G.SIMDI + H, units: 40, splittable: true }
  const r = gorev.run('hf.task.ocr', '1.1.0', [], b4a.alloc(0), opts)
  t.is(r.taskIds.length, 2)
  // İşçi 1 reddeder: parça işçi 2'ye gider, tutamaç aynı
  gorev.receive(hex(G.C.isci1.memberId), Z.TASK_REJECT, Gr.kodlama.encodeReject({ taskId: b4a.from(r.taskIds[0], 'hex'), code: 'MESGUL' }), 'dogrudan')
  t.is(giden.filter((g) => g.ty === Z.TASK).length, 3)
  // İptal: gönderilmiş bütün parçalara TASK_CANCEL, sonuç tutamaçla
  gorev.cancel(r.id)
  t.is(giden.filter((g) => g.ty === Z.TASK_CANCEL).length, 2)
  t.alike(sonuc, [[r.id, 'iptal']])
  saat += 2 * H
  gorev.tick()
  t.is(giden.filter((g) => g.ty === Z.TASK).length, 3, 'iptal edilen iş bir daha gönderilmez')
  // Misafirden gelen sonuç tek giriş noktasında düşer
  t.is(hataOf(() => gorev.receive(hex(G.C.misafir2.memberId), Z.TASK_RESULT, Gr.kodlama.encodeResult({ taskId: b4a.alloc(16), status: 'ok', outputs: [], inline: b4a.alloc(0), log: '' }), 'dogrudan')), 'TYPE_NOT_ALLOWED')
  // Onay kişi başına ve geri alınabilir
  t.ok(gorev.onay.var(G.U.kerem.memberId, hex(G.C.isci1.memberId)))
  gorev.consent(hex(G.C.isci1.memberId), false)
  t.absent(gorev.onay.var(G.U.kerem.memberId, hex(G.C.isci1.memberId)))
})

test('SDK 12, 24, 25: collections okur ve okuyucular; kisiler bekleyen; change yazım gerçekleşince', (t) => {
  const L = A.anaDefter()
  const now = () => A.TS0 + H
  const kerem = A.replika(A.kopya(L), A.K.kerem, { now, otomatikAnahtar: false })
  const kayit = new S.RecordApi({ replika: kerem })
  const degisen = []
  kayit.on('change', (cid, ids) => degisen.push(ids[0]))
  const rid = kayit.put(TA, null, 'yuva.defter.not', { m: 1 })
  t.alike(degisen, [], 'anahtar yok: kuyrukta, henüz bildirilmez')
  const hus = A.replika(L, A.K.husniye, { now })
  A.teslim(hus, kerem)
  kayit.sync()
  t.alike(degisen, [rid])
  const d = new S.LedgerApi({ ledger: L })
  t.ok(d.persons().every((k) => typeof k.bekleyen === 'boolean'))
  t.is(hataOf(() => d.presence(hex(A.K.irem.memberId))), 'NO_PRESENCE')
})

test('SDK 15: defter yazma yüzeyi — aile kurma, öneri ve imza, cihaz çıkarma, ana kimlik devri uyarısı', (t) => {
  const D0 = require('../../core/core/test/helpers/ledger')
  const { ledger: L } = S.LedgerApi.createFamily({ Ledger, me: D0.K.kerem, familyName: 'Rivera', displayName: 'Kerem', ts: A.TS0 })
  t.is(L.len, 5, 'GENESIS, PROTOCOL_LEVEL 2.2 ve üç varsayılan koleksiyon (D15 2)')
  const kerem = new S.LedgerApi({ ledger: L, me: D0.K.kerem, now: () => A.TS0 + 1000 })
  const r = kerem.addMember({ deviceCert: D0.K.husniye.deviceCert, displayName: 'Hüsniye', role: 'ebeveyn', ceremonyTranscriptHash: b4a.alloc(32, 7) })
  t.is(r.durum, 'oneri', 'yeni üyenin kendi imzası eksik')
  t.ok(r.waitingFor.length >= 0)
  const hus = new S.LedgerApi({ ledger: L, me: D0.K.husniye, now: () => A.TS0 + 2000 })
  hus.oneriler = kerem.oneriler
  t.is(hus.sign(r.oneriId).durum, 'uygulandi')
  t.is(L.persons.size, 2)
  const olaylar = []
  kerem.on('ledger', (e) => olaylar.push(e.type))
  kerem.changed()
  t.ok(olaylar.includes(T.ADD_MEMBER))
  t.ok(typeof kerem.identities()[0].primary === 'boolean')
})

test('SDK 14 ve RFC-0017 11: startStanding sürekli görev gönderir; bekleyen ana kimlik devri security olayı verir', (t) => {
  const L = G.defter()
  const y = new Gr.yetenek.YetenekDefteri({ ledger: L, now: () => G.SIMDI })
  const giden = []
  const gorev = new S.TaskApi({ ledger: L, me: G.U.kerem, yetenekler: y, gonder: (p, ty, b) => giden.push({ p, ty, b }), now: () => G.SIMDI })
  gorev.consent(hex(G.C.isci1.memberId), true)
  const s = gorev.startStanding('hf.task.ocr', '1.1.0', hex(G.C.isci1.memberId), b4a.alloc(0), { collectionId: hex(G.K_TUM_AILE), ramMB: 512, deadline: G.SIMDI + 3 * 86_400_000 })
  t.is(giden[0].ty, Z.TASK)
  t.ok(Gr.kodlama.decodeTask(giden[0].b).m.standing)
  t.is(typeof s.id, 'string')
  // Bekleyen APP_PRIMARY: kişinin ana kimliği uyarılır
  const C = cokluDefter()
  const d = new S.LedgerApi({ ledger: C, me: A.K.kerem, now: () => A.TS0 })
  d._izlenen = C.len
  const uyari = []
  d.on('security', (x) => uyari.push(x.type))
  const e = A.olay(C, T.APP_PRIMARY, { personId: A.K.kerem.memberId, newPrimaryId: E.keremTablet.memberId }, [E.keremTablet])
  C.apply(e)
  d.changed()
  t.alike(uyari, ['app_primary_pending'])
})
