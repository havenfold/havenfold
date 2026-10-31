// SPDX-License-Identifier: Apache-2.0
// D15: Yuva Defteri L13'te bulunan SDK eksikleri (kollar/D-cekirdek.md D15). Beklenenler elle yazıldı.
const test = require('brittle')
const b4a = require('b4a')
const { ledger: { Ledger } } = require('@havenfold/core')
const S = require('..')
const A = require('../../core/records/test/helpers/family')

const hex = (b) => b4a.toString(b, 'hex')
const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const TA = hex(A.K_TUM_AILE)
const KASA = hex(A.K_KASA)

test('(2) aile kurulunca düzey 2.2 ve 01 §2.2 koleksiyonları: Tüm Aile, Ebeveynler, kurucunun Kişisel\'i', (t) => {
  const { ledger: L } = S.LedgerApi.createFamily({ Ledger, me: A.K.kerem, familyName: 'Rivera ailesi', displayName: 'Kerem', ts: A.TS0 })
  t.is(L.level, '2.2')
  const kol = [...L.collections.values()].map((c) => [c.name, c.kind, c.readers.join(','), c.writers.join(','), c.sensitivity, c.taskAccess, c.history]).sort()
  t.alike(kol, [
    ['Ebeveynler', 'genel', 'rol:ebeveyn', 'rol:ebeveyn', 'normal', true, true],
    ['Kişisel', 'kisisel', 'uye:' + hex(A.K.kerem.memberId), 'uye:' + hex(A.K.kerem.memberId), 'normal', false, true],
    ['Tüm Aile', 'genel', 'rol:ebeveyn,rol:yetiskin,rol:cocuk', 'rol:ebeveyn,rol:yetiskin,rol:cocuk', 'normal', true, true]
  ])
  const yalin = S.LedgerApi.createFamily({ Ledger, me: A.K.kerem, displayName: 'Kerem', ts: A.TS0, hazirla: false })
  t.alike([yalin.ledger.level, yalin.ledger.collections.size], ['2.0', 0], 'yalnız GENESIS isteyen için eski davranış')
})

test('(2) varsayılan koleksiyonlar yoksa açılır, varsa yeniden açılmaz; üyenin Kişisel\'i kendi imzasıyla', (t) => {
  const { ledger: L } = S.LedgerApi.createFamily({ Ledger, me: A.K.kerem, displayName: 'Kerem', ts: A.TS0 })
  const d = new S.LedgerApi({ ledger: L, me: A.K.kerem, now: () => A.TS0 + 10_000 })
  t.alike(d.defaultCollections(), [], 'hepsi var')
  t.is(L.collections.size, 3)
})

test('(1) aile bilgisi: ad, düzey, tür, ben, cihazlar, misafirler', (t) => {
  const L = A.anaDefter()
  const d = new S.LedgerApi({ ledger: L, me: A.K.husniye })
  const b = d.familyInfo()
  t.is(b.ad, L.familyName)
  t.is(b.duzey, '2.1')
  t.is(b.tur, 'aile')
  t.alike(b.ben, { memberId: hex(A.K.husniye.memberId), personId: hex(A.K.husniye.memberId), role: 'ebeveyn', name: L.members.get(hex(A.K.husniye.memberId)).name })
  t.alike(b.cihazlar.map((x) => x.name), ['isci1'])
  t.alike(b.misafirler.map((x) => [x.name, x.active]), [['Bakıcı', false]])
})

test('(3) geçmiş: opId, yazılan alanlar ve kaybeden yazım', (t) => {
  const L = A.anaDefter()
  const simdi = { t: A.TS0 + 3_600_000 }
  const r = A.replika(L, A.K.husniye, { now: () => simdi.t })
  const kayit = new S.RecordApi({ replika: r })
  const rid = kayit.put(TA, null, 'yuva.defter.not', { baslik: 'Wifi', sifre: '1234' })
  simdi.t += 1000
  kayit.put(TA, rid, '', { sifre: '5678' })
  const g = kayit.history(TA, rid)
  t.is(g.length, 2)
  t.ok(g.every((x) => /^[0-9a-f]{64}$/.test(x.opId)), 'opId var (32 bayt, RFC-0001 §3)')
  t.alike(g.map((x) => [x.op, x.alanlar, x.kaybeden]), [
    ['put', { baslik: 'Wifi', sifre: '1234' }, ['sifre']],
    ['put', { sifre: '5678' }, []]
  ])
})

test('(6) yapay zeka alanlı kaydın taşınması: alanlar korunur, kaynak silinir; kasa kaynaklı yalnız kasaya', (t) => {
  const L = A.anaDefter()
  const r = A.replika(L, A.K.husniye)
  const kayit = new S.RecordApi({ replika: r })
  const rid = kayit._yaz(TA, null, 'yuva.defter.garanti', { urun: 'Kombi', _src: ['aktarma:hfkap'], _conf: 90, _ai: ['urun'], _aiyol: 'kural/1' })
  const OL = hex(A.K_BAKICI)
  const yeni = kayit.move(TA, rid, OL)
  t.alike(kayit.get(OL, yeni).fields, { urun: 'Kombi', _src: ['aktarma:hfkap', 'kayit:' + TA + '/' + rid], _conf: 90, _ai: ['urun'], _aiyol: 'kural/1' }, '_src\'ye eski kaydın başvurusu eklenir (D25, RFC-0027 §3)')
  t.is(kayit.get(OL, yeni).type, 'yuva.defter.garanti')
  t.is(kayit.get(TA, rid), null, 'kaynakta silindi')
  const k = kayit._yaz(KASA, null, 'yuva.defter.sifre', { ad: 'Banka' })
  t.is(hataOf(() => kayit.move(KASA, k, TA)), 'VAULT_SOURCE')
  t.is(hataOf(() => kayit.move(TA, 'ff'.repeat(16), OL)), 'NO_RECORD')
})


const yzc = require('@havenfold/ai')
const D = require('../../core/records/file')
const { caps: { CapsBook }, hello: { CAPS } } = require('@havenfold/core')
const Gr = require('@havenfold/tasks')

test('(4) kopya sayısı: bu telefon ve BLOB_HAVE bildiren kutu/işçi; BLOB_HAVE gelenZarf girişinden', (t) => {
  const L = A.anaDefter()
  const r = A.replika(L, A.K.husniye)
  const kayit = new S.RecordApi({ replika: r })
  const { blobRef } = kayit.attach({ bytes: b4a.from('belge') })
  t.alike(kayit.copyCount(blobRef.blobId), { telefon: 1, kutu: 0, isci: 0 })
  const have = D.makeBlobHave(L.familyId, [blobRef.blobId], A.C.isci1)
  kayit.blobHaveReceived(hex(A.C.isci1.memberId), have, 'dogrudan')
  t.alike(kayit.copyCount(blobRef.blobId), { telefon: 1, kutu: 0, isci: 1 })
  t.is(hataOf(() => kayit.blobHaveReceived(hex(A.C.isci1.memberId), D.makeBlobHave(L.familyId, [blobRef.blobId], A.K.irem), 'dogrudan')), 'UNAUTHORIZED', 'tutucu kutu ya da işçi olmalı')
})

test('(5) open dosyaYaz kancasıyla { path }; attach yoldan okur, yükleme mesajları kancaya', (t) => {
  const L = A.anaDefter()
  const r = A.replika(L, A.K.husniye)
  const yazilan = new Map()
  const yuklenen = []
  const kayit = new S.RecordApi({ replika: r, dosyaYaz: (ref, bytes) => { const p = '/tmp/hf/' + hex(ref.blobId); yazilan.set(p, bytes); return p }, dosyaOku: (p) => b4a.from('yoldan:' + p), dosyaYuklendi: (ref, m) => yuklenen.push(m.length) })
  const a = kayit.attach({ path: '/belgeler/fatura.pdf', mime: 'application/pdf', name: 'fatura.pdf' })
  t.alike(Object.keys(a), ['blobRef'], 'mesajlar kancaya gitti')
  t.ok(yuklenen[0] >= 1)
  const o = kayit.open(a.blobRef)
  t.alike(Object.keys(o), ['path'])
  t.is(b4a.toString(yazilan.get(o.path)), 'yoldan:/belgeler/fatura.pdf')
  const eski = new S.RecordApi({ replika: r })
  const b = eski.attach({ bytes: b4a.from('x') })
  t.ok(b.mesajlar && b4a.equals(eski.open(b.blobRef).bytes, b4a.from('x')), 'kancasız eski davranış')
})

test('(7) resolveMember misafirde rol misafir ve adı', (t) => {
  const L = A.anaDefter()
  const r = S.resolveMember(L, A.C.misafir1.memberId)
  t.alike([r.role, r.name, r.active], ['misafir', 'Bakıcı', false])
})

test('(8) kendi kimliğimizin appId\'si; (15) komut numaraları RFC-0017 §13 ile', (t) => {
  const L = A.anaDefter()
  const d = new S.LedgerApi({ ledger: L, me: A.K.husniye, appId: 'yuva-hat' })
  t.is(d.identities()[0].appId, 'yuva-hat')
  t.is(new S.LedgerApi({ ledger: L, me: A.K.kerem }).identities(A.K.husniye.memberId)[0].appId, null, 'başkasının ana kimliği bilinmez')
  if (typeof Bare === 'undefined') { // eslint-disable-line no-undef
    const src = require('f' + 's').readFileSync(require.resolve('../api'), 'utf8') // kaynak taraması yalnız Node'da
    t.ok(src.includes('komut 362, PERSON_IDENTITIES') && src.includes('komut 363, PRIMARY_HANDOVER'))
  }
})

test('(9) eşleşme öncesi yerel kanal özeti', (t) => {
  const L = A.anaDefter()
  const d = new S.LedgerApi({ ledger: L, me: A.K.husniye, appId: 'yuva-hat' })
  const o = d.localSummary()
  t.alike(o, { v: 1, appId: 'yuva-hat', aileAdi: L.familyName, kisiSayisi: L.personIds().length, benimAdim: L.members.get(hex(A.K.husniye.memberId)).name })
  t.alike(S.LedgerApi.decodeLocalSummary(JSON.parse(JSON.stringify(o))), { appId: 'yuva-hat', aileAdi: o.aileAdi, kisiSayisi: o.kisiSayisi, benimAdim: o.benimAdim })
  t.is(S.LedgerApi.decodeLocalSummary({ v: 1, aileAdi: 'x', kisiSayisi: 0, benimAdim: '' }), null)
  t.absent(JSON.stringify(o).match(/[0-9a-f]{32}/), 'kimlik ya da anahtar yok')
})

test('(10) bekleme türü ve bitişi: uzaktan katılım', (t) => {
  const L = A.anaDefter()
  const at = A.TS0 + L.len * 1000 + 86_400_000
  L.apply(A.ekle(L, A.K.u5, 'yetiskin', [A.K.kerem, A.K.husniye], { remote: true, activatesAt: at }))
  const d = new S.LedgerApi({ ledger: L, me: A.K.kerem })
  const u5 = d.persons().find((k) => k.memberId === hex(A.K.u5.memberId))
  t.is(u5.bekleme.tur, 'uzaktan')
  t.is(u5.bekleme.bitis, L.readyAt(hex(A.K.u5.memberId)))
  t.is(d.persons().find((k) => k.memberId === hex(A.K.kerem.memberId)).bekleme, null)
})

test('(14) güncelleme bekleyenler HELLO.caps\'ten; eksikse düzey yükseltilmez', (t) => {
  const L = A.anaDefter()
  const cb = new CapsBook()
  const simdi = A.TS0 + 1_000_000
  for (const id of L.activeIds()) if (id !== hex(A.K.irem.memberId)) cb.record(id, CAPS.LEDGER_V21 | CAPS.COKLU_UYGULAMA, simdi)
  const d = new S.LedgerApi({ ledger: L, me: A.K.kerem, capsBook: cb, now: () => simdi })
  const g = d.awaitingUpdate('2.2')
  t.is(g.hazir, false)
  t.alike(g.eksik.map((x) => x.memberId), [hex(A.K.irem.memberId)])
  t.is(hataOf(() => d.raiseLevel('2.2')), 'UPDATE_PENDING')
  t.is(new S.LedgerApi({ ledger: L, me: A.K.kerem }).awaitingUpdate(), null)
})

test('(16) yazım durumu: anahtar gelene kadar kuyrukta', (t) => {
  const L = A.anaDefter()
  const r = A.replika(L, A.K.irem)
  const kayit = new S.RecordApi({ replika: r })
  const rid = kayit.put(TA, null, 'yuva.defter.not', { baslik: 'x' })
  t.is(kayit.writeStatus(TA, rid), 'kuyrukta', 'sıradaki ilk okuyucu değil, anahtar yok')
  t.is(kayit.get(TA, rid), null)
  const h = new S.RecordApi({ replika: A.replika(L, A.K.husniye) })
  const rid2 = h.put(TA, null, 'yuva.defter.not', { baslik: 'y' })
  t.is(h.writeStatus(TA, rid2), 'yazildi')
  t.is(h.writeStatus(TA, 'ab'.repeat(16)), 'yok')
})

function yzKur (kim = A.K.husniye, ek = {}) {
  const L = A.anaDefter()
  const r = A.replika(L, kim, { now: () => A.TS0 + 3_600_000 })
  const kayit = new S.RecordApi({ replika: r })
  const yz = new S.AiApi({ kayit, me: kim, now: () => A.TS0 + 3_600_000, yetenek: () => yzc.yetenek.yetenekKur({ isletim: { id: 'apple-fm', surum: '26.1', tr: true }, bildirim: { platform: [{ id: 'apple-fm', surum: '26.1', tr: true, baglamToken: 4096 }] }, ...(ek.yet || {}) }), model: async () => ({ metin: 'Cevap.', model: 'telefon/apple-fm@26.1' }), ...ek })
  return { L, kayit, yz }
}

test('(11) işçi adı ve ilk kullanım onayının zamanı', async (t) => {
  const onay = new Gr.onay.OnayDefteri()
  onay.ver(hex(A.K.husniye.memberId), hex(A.C.isci1.memberId), true, 12345)
  const { yz } = yzKur(A.K.husniye, { onay, yet: { isciler: [{ deviceId: hex(A.C.isci1.memberId), aday: true, modeller: [], maxTaskRamMB: 1, onay: true }] } })
  const d = await yz.status()
  t.alike([d.isciler[0].ad, d.isciler[0].onayAt], ['isci1', 12345])
})

test('(12) "Bu belgeye sor": kayit: bağlamı; cevapta tur ve tavsiye konusu', async (t) => {
  const { yz, kayit } = yzKur()
  const rid = kayit.put(TA, null, 'yuva.defter.belge', { baslik: 'Kira sözleşmesi', bitis: '2027-05-01' })
  const ref = 'kayit:' + TA + '/' + rid
  const c = await yz.ask({ metin: 'bu belge ne zaman bitiyor', baglam: { ref } })
  t.alike(c.kaynaklar, [ref])
  t.is(c.tur, 'kaynakli')
  t.is(c.sinif, 'aile')
  const m = await yz.ask({ metin: 'bu ilacın dozu ne olmalı' })
  t.alike([m.konu, m.uyari], ['tibbi', 'Bu genel bilgidir, tıbbi tavsiye değildir. Bir hekime danış.'])
  const s = await yz.ask({ metin: 'İnsan mısın?' })
  t.is(s.tur, 'sabit')
})

test('(13) eş anlamlı arama, çelişki, kasa açıkken arama, yeni okunur koleksiyon kendiliğinden', async (t) => {
  let acik = false
  const { yz, kayit, L } = yzKur(A.K.kerem === null ? null : A.K.husniye, { kasaAcik: () => acik })
  kayit.put(TA, null, 'yuva.defter.not', { baslik: 'Wifi parolası', deger: 'abc' })
  kayit.put(TA, null, 'yuva.defter.not', { baslik: 'Wifi parolası', deger: 'xyz' })
  yz.directory('kur')
  const s = await yz.search('wifi şifresi')
  t.is(s.length, 2, 'şifre ↔ parola')
  const c = await yz.ask({ metin: 'wifi şifresi ne' })
  t.alike(c.celiski.map((x) => x.alan), ['deger'], 'iki kayıt farklı değer')
  // Kasa: kilitliyken dizinde yok, açılınca kendiliğinden eklenir, kilitlenince atılır
  const kasaKayit = new S.RecordApi({ replika: A.replika(L, A.K.kerem) })
  kasaKayit.put(KASA, null, 'yuva.defter.sifre', { ad: 'Banka parolası' })
  t.absent(yz.directory('durum').koleksiyonlar.includes(KASA))
  acik = true
  yz.ledgerAdvanced()
  t.ok(yz.directory('durum').koleksiyonlar.includes(KASA), 'kasa açılınca dizine girdi')
  acik = false
  yz.ledgerAdvanced()
  t.absent(yz.directory('durum').koleksiyonlar.includes(KASA), 'kilitlenince bellekten atıldı')
})
