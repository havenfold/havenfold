// SPDX-License-Identifier: Apache-2.0
const test = require('brittle')
const b4a = require('b4a')
const { zarf: { Z } } = require('@havenfold/core')
const Gr = require('@havenfold/tasks')
const S = require('..')
const A = require('../../core/records/test/helpers/family')
const G = require('../../core/tasks/test/helpers/task')

const hex = (b) => b4a.toString(b, 'hex')
const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const TA = hex(A.K_TUM_AILE)
const MIN = 60_000
const COKI = 'varlik:' + hex(A.VARLIK_KEDI)

function kur (kim = A.K.husniye) {
  const L = A.anaDefter()
  let simdi = A.TS0 + 3_600_000
  const r = A.replika(L, kim, { now: () => simdi })
  const kayit = new S.RecordApi({ replika: r })
  return { L, r, kayit, saat: (x) => { simdi = x }, now: () => simdi }
}

test('kayıt: koleksiyonlar, yazma, sorgu, yazar imzalı işlemden; ayrılmış alanlar denetlenir; değişiklik bildirilir', (t) => {
  const { kayit } = kur()
  const cols = kayit.collections()
  t.ok(cols.some((c) => c.collectionId === TA && c.writable))
  const kisisel = cols.find((c) => c.kind === 'kisisel')
  t.is(kisisel.okur, false, 'İrem\'in kişisel koleksiyonu okunamaz ama listede (RFC-0019 §11.7 b)')
  t.alike(kisisel.readers, ['uye:' + hex(A.K.irem.memberId)])
  const degisen = []
  kayit.on('change', (cid, ids) => degisen.push([cid, ids]))
  t.is(hataOf(() => kayit.put(TA, null, 'yuva.defter.not', { baslik: 'Wifi', _ai: ['baslik'], _aiyol: 'kural/1' })), 'AI_APPROVAL_REQUIRED')
  const rid = kayit.put(TA, null, 'yuva.defter.not', { baslik: 'Wifi', _src: ['aktarma:bitwarden'], _conf: 90 })
  t.alike(degisen, [[TA, [rid]]])
  const k = kayit.get(TA, rid)
  t.is(k.fields.baslik, 'Wifi')
  t.is(k.authorId, hex(A.K.husniye.memberId))
  t.is(kayit.query(TA, { type: 'yuva.defter.not', where: { baslik: 'Wifi' } }).length, 1)
  t.is(kayit.query(TA, { type: 'yuva.x' }).length, 0)
  t.is(hataOf(() => kayit.put(TA, null, 'yuva.defter.not', { _by: 'x' })), 'RESERVED_FIELD')
  t.is(hataOf(() => kayit.put(TA, null, 'yuva.defter.not', { _src: ['msg:ab'] })), 'INVALID_FIELD_VALUE')
  t.is(hataOf(() => kayit.put(TA, null, 'yuva.defter.not', { _aiyol: 'gizli/model' })), 'AI_APPROVAL_REQUIRED')
  kayit.del(TA, rid)
  t.is(kayit.get(TA, rid), null)
})

test('kayıt: dosya ekleme yeni fileKey ile şifreler, açar', (t) => {
  const { kayit } = kur()
  const a = kayit.attach({ bytes: b4a.from('kira sözleşmesi'), mime: 'text/plain', name: 'kira.txt' })
  const b = kayit.attach({ bytes: b4a.from('kira sözleşmesi'), mime: 'text/plain', name: 'kira.txt' })
  t.not(hex(a.blobRef.fileKey), hex(b.blobRef.fileKey))
  t.is(a.mesajlar.length, 1)
  t.is(b4a.toString(kayit.open(a.blobRef).bytes), 'kira sözleşmesi')
  t.is(hataOf(() => kayit.open({ ...a.blobRef, blobId: b4a.alloc(32) })), 'NO_FILE')
})

test('olay: yaz, sorgula, kural vakası, sahiplen, kapat, rutin durumu', (t) => {
  const { kayit, now, saat } = kur(A.K.husniye) // dönem anahtarını sıralamada ilk okuyucu üretir
  const olay = new S.EventApi({ kayit, now })
  olay.registerType({ tur: 'yuva.pet.eat', v: 1, olay: true, yazar: 'ikisi', ozne: ['varlik'], alanlar: [{ ad: 'miktar', deger: 'int' }], keep: 90 })
  t.is(hataOf(() => olay.write(TA, 'yuva.pet.yok', { subj: COKI })), 'NO_TYPE')
  const kuralId = olay.writeRule(TA, null, { _subj: COKI, kosullar: [['yuva.pet.eat', 'sayi', '', 60, 'ge', 3]], eylem: 'vaka', onem: 2 })
  const rutinId = olay.writeRoutine(TA, null, { _subj: COKI, olay: 'yuva.pet.eat', olcu: 'sayi' })
  for (let i = 0; i < 3; i++) olay.write(TA, 'yuva.pet.eat', { subj: COKI, t: now() - (3 - i) * MIN, miktar: 10 })
  t.is(olay.query(TA, { tur: 'yuva.pet.eat' }).length, 3)
  t.is(olay.query(TA, { tur: 'yuva.pet.eat', limit: 1 })[0].fields.miktar, 10)
  const d = olay.evaluate(TA)
  t.is(d.yeni.length, 1)
  t.is(d.yeni[0].alanlar.kaynak, 'kural:' + kuralId)
  // Telefon vakayı açar ve ilk basamağı yazar
  kayit.put(TA, null, 'hf.vaka', d.yeni[0].alanlar)
  kayit.put(TA, null, 'hf.vaka.basamak', { vaka: d.yeni[0].alanlar.vaka, basamak: 2, sira: 0, _t: now(), _keep: 365 })
  const v = olay.cases(TA)
  t.is(v.length, 1)
  t.is(v[0].durum, 'acik')
  t.alike(v[0].ulasilan, [2, 0])
  saat(now() + MIN)
  olay.claim(TA, v[0].vaka)
  t.is(olay.cases(TA, { durum: 'sahipli' }).length, 1)
  olay.close(TA, v[0].vaka, 'yanlis')
  t.is(olay.cases(TA, { durum: 'kapali' })[0].sonuc, 'yanlis')
  t.is(hataOf(() => olay.close(TA, v[0].vaka, 'belki')), 'INVALID_FIELD_VALUE')
  const rd = olay.routineStatus(TA, rutinId)
  t.is(rd[0].olgun, false)
  t.is(rd[0].bugun, 3)
  t.is(hataOf(() => olay.routineStatus(TA, kuralId)), 'NO_ROUTINE')
  olay.writeCard(TA, null, { _subj: COKI, ad: 'Coki', sorumlu: ['uye:' + hex(A.K.kerem.memberId)] })
  t.is(olay.cards(TA)[0].ad, 'Coki')
})

test('görev: makine kartı, cihazlar, onay; 40 sayfa iki işçiye bölünür, sonuç birleşir', (t) => {
  const L = G.defter()
  const y = new Gr.yetenek.YetenekDefteri({ ledger: L, now: () => G.SIMDI })
  y.al(G.capsBayt(L, G.C.isci1, { cores: 4, load1x100: 40 }))
  y.al(G.capsBayt(L, G.C.isci2, { cores: 2, load1x100: 30 }))
  const onay = new Gr.onay.OnayDefteri()
  const giden = []
  let n = 0
  const gorev = new S.TaskApi({ ledger: L, me: G.U.kerem, yetenekler: y, onay, gonder: (p, ty, b) => giden.push({ p, ty, b }), now: () => G.SIMDI, rastgele: () => b4a.alloc(16, 0xa0 + n++) })
  t.is(gorev.machine().cekirdek, 6)
  t.is(gorev.devices().filter((d) => !d.consentAsked).length, 2)
  const opts = { collectionId: hex(G.K_TUM_AILE), ramMB: 2048, minutes: 30, deadline: G.SIMDI + 3_600_000, units: 40, splittable: true, telefondaYapilabilir: true }
  t.alike(gorev.run('hf.task.ocr', '1.1.0', [], b4a.alloc(0), opts), { yer: 'telefon' }) // onay yok: aday yok
  gorev.consent(hex(G.C.isci1.memberId), true)
  gorev.consent(hex(G.C.isci2.memberId), true)
  const sonuclar = []
  gorev.on('result', (id, r) => sonuclar.push(r))
  const r = gorev.run('hf.task.ocr', '1.1.0', [{ blobId: b4a.alloc(32, 1), fileKey: b4a.alloc(32, 2), size: 9, mime: 'application/pdf' }], b4a.alloc(0), opts)
  t.is(r.taskIds.length, 2)
  t.is(giden.length, 2)
  for (const g of giden) {
    const ad = hex(G.C.isci1.memberId) === g.p ? 'isci1' : 'isci2'
    const isci = new Gr.denetim.Isci({ ledger: L, me: G.C[ad], caps: G.caps(G.C[ad]), now: () => G.SIMDI })
    const c = isci.al(g.b, { from: hex(G.U.kerem.memberId) })
    t.is(c.type, Z.TASK_ACCEPT)
    gorev.receive(g.p, c.type, c.bytes, 'dogrudan')
    gorev.receive(g.p, Z.TASK_RESULT, Gr.kodlama.encodeResult({ taskId: c.task.taskId, status: 'ok', outputs: [], inline: b4a.from(ad + ';'), log: '' }), 'dogrudan')
  }
  t.is(sonuclar.length, 1)
  t.is(b4a.toString(sonuclar[0].inline), 'isci1;isci2;')
  t.is(hataOf(() => gorev.cancel('00'.repeat(16))), 'NO_TASK')
})

test('defter: kişiler, kişi, resolveMember; son görülme kaba zaman, misafir okuyamaz, açık oturum çevrimiçi', (t) => {
  const L = A.anaDefter()
  let simdi = A.TS0 + 3_600_000
  const cb = new (require('@havenfold/core').caps.CapsBook)()
  t.is(hataOf(() => new S.Presence({ ledger: L, me: A.K.kerem.memberId })), 'CAPS_REQUIRED')
  const g = new S.Presence({ ledger: L, me: A.K.kerem.memberId, caps: cb, now: () => simdi })
  const d = new S.LedgerApi({ ledger: L, gorulme: g })
  t.alike(d.persons().map((k) => k.role).sort(), ['cocuk', 'ebeveyn', 'ebeveyn', 'yetiskin'])
  t.is(d.devices().length, 1)
  t.is(d.resolveMember(hex(A.K.irem.memberId)).name, 'İrem')
  t.is(d.person(hex(A.K.irem.memberId)).primary, hex(A.K.irem.memberId))
  t.alike(d.presence(hex(A.K.irem.memberId)), { lastSeenMs: null, via: 'yok', online: false })
  t.is(d.presenceWithin(hex(A.K.irem.memberId)), null)
  g.sessionOpened(hex(A.K.irem.memberId))
  t.alike(d.presence(hex(A.K.irem.memberId)), { lastSeenMs: simdi, via: 'dogrudan', online: true })
  g.sessionClosed(hex(A.K.irem.memberId))
  simdi += 25 * 3_600_000
  t.is(d.presence(hex(A.K.irem.memberId)).online, false)
  t.is(d.presenceWithin(hex(A.K.irem.memberId)), false)
  t.is(hataOf(() => d.presence(hex(A.C.isci1.memberId))), 'UNAUTHORIZED')
  t.is(hataOf(() => new S.Presence({ ledger: L, me: A.C.misafir1.memberId, caps: cb }).presence(hex(A.K.irem.memberId))), 'UNAUTHORIZED')
  t.is(hataOf(() => d.resolveMember(hex(A.K.irem.memberId), 999)), 'LEDGER_BEHIND')
  const T = A.TS0
  t.is(S.coarseTime(T - 2 * MIN, T), 'az önce')
  t.is(S.coarseTime(T - 12 * MIN, T), '10 dakika önce')
  t.is(S.coarseTime(null, T), null)
  const gece = 1_792_359_000_000 // yerel 00:30
  t.is(S.coarseTime(gece - 2 * 3_600_000, gece), 'dün')
  t.is(S.coarseTime(gece - 3 * 86_400_000, gece), '3 gün önce')
  t.alike(S.COMMAND, { PRESENCE_GET: 350, MEMBER_RESOLVE: 351 })
})
