// SPDX-License-Identifier: Apache-2.0
// D45: ekip SDK yüzeyi ve kanal (RFC-0005, RFC-0022; Mekan için). Beklenen değerler elle.
const test = require('brittle')
const b4a = require('b4a')
const { ledger: { Ledger, T, encodeEvent, decodeEvent }, encoding: { decodeBody } } = require('@havenfold/core')
const { Replika } = require('@havenfold/records')
const S = require('..')
const D0 = require('../../core/core/test/helpers/ledger')

const { K, TS0 } = D0
const hex = (b) => b4a.toString(b, 'hex')
const id = (k) => hex(k.memberId)
const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const GUN = 86_400_000
const YER = 'a1'.repeat(16)

// Saat: her çağrıda ilerler; ileri() ile atlanır
function saat (t0 = TS0 + 60_000) { let t = t0; const f = () => ++t; f.ileri = (ms) => { t += ms }; f.su = () => t; return f }

// Kerem'in kurduğu ekip; her kişinin kendi defter kopyası ve TeamApi'si
function ekip () {
  const now = saat()
  const { ledger: L, placeId } = S.TeamApi.create({ Ledger, me: K.kerem, isletmeAdi: 'Rivera Kuyum', displayName: 'Kerem', yer: { ad: 'Merkez', tur: 'sube' }, ts: TS0, placeId: YER })
  const kisi = (k, Lk = L) => {
    const defter = new S.LedgerApi({ ledger: Lk, me: k, now })
    return { k, L: Lk, defter, ekip: new S.TeamApi({ defter, now }) }
  }
  return { L, placeId, now, kisi, kerem: kisi(K.kerem) }
}

// Yeni üye: davet edenin önerisi, yeni üyenin imzası (tören akışında aynı telefonda toplanır)
function uyeEkle (x, yeni, role) {
  const r = x.defter.addMember({ deviceCert: yeni.deviceCert, displayName: yeni.ad, role, ceremonyTranscriptHash: b4a.alloc(32, 7) })
  if (r.durum === 'uygulandi') return r
  const y = new S.LedgerApi({ ledger: x.L, me: yeni, now: x.defter.now })
  y.oneriler = x.defter.oneriler
  return y.sign(r.oneriId)
}

const kopyala = (L, K2 = new Ledger()) => { for (const e of L.events.slice(K2.len)) K2.apply(decodeEvent(encodeEvent(e))); return K2 }

test('280 TEAM_CREATE: KIND ekip, kurucu sahip, ekip politikası, ilk yer ve kurucunun ataması, varsayılan koleksiyonlar', (t) => {
  const { L, placeId, kerem } = ekip()
  t.is(L.kind, 'ekip')
  t.is(L.familyName, 'Rivera Kuyum')
  t.is(L.members.get(id(K.kerem)).role, 'sahip')
  t.is(L.policy.maxMembers, 32)
  t.is(placeId, YER)
  t.alike(L.events.slice(1, 4).map((e) => e.type), [T.KIND, T.PROTOCOL_LEVEL, T.PROTOCOL_LEVEL])
  const cols = [...L.collections.values()]
  t.alike(cols.map((c) => c.name), ['Ekip', 'Yönetim', 'Kasa', 'Yer:Merkez', 'Olaylar:Merkez', 'Paylaşımlar'])
  t.alike(cols.find((c) => c.name === 'Kasa').readers, ['rol:sahip'])
  t.is(cols.find((c) => c.name === 'Kasa').sensitivity, 'kasa')
  t.alike(cols.find((c) => c.name === 'Yer:Merkez').readers, ['rol:sahip', 'yer:' + YER + '/rol:yonetici', 'yer:' + YER + '/rol:calisan', 'yer:' + YER + '/rol:gecici'])
  t.is(cols.find((c) => c.name === 'Olaylar:Merkez').kind, 'olaylar')
  const { yerler } = kerem.ekip.places()
  t.is(yerler.length, 1)
  t.alike(yerler[0], { placeId: YER, ad: 'Merkez', tur: 'sube', kisiler: [{ memberId: id(K.kerem), name: 'Kerem', role: 'sahip' }], kutu: null, cihazlar: 0, aydinlatma: false })
  t.is(hataOf(() => S.TeamApi.create({ Ledger, me: K.kerem, isletmeAdi: ' ', displayName: 'Kerem', ts: TS0 })), 'NAME_REQUIRED')
  // Ailede ekip yüzü yok
  const { ledger: A } = S.LedgerApi.createFamily({ Ledger, me: K.kerem, familyName: 'Rivera', displayName: 'Kerem', ts: TS0 })
  t.is(hataOf(() => new S.TeamApi({ defter: new S.LedgerApi({ ledger: A, me: K.kerem }) }).places()), 'TEAM_ONLY')
})

test('281 TEAM_ROLE ve yeter sayı: sahip çıkarma diğer sahiplerin çoğunluğu (öneri, yönetim bekler); geçiciye geçişte süre', (t) => {
  const { L, kerem, kisi } = ekip()
  uyeEkle(kerem, K.husniye, 'sahip')
  const hus = kisi(K.husniye)
  hus.defter.oneriler = kerem.defter.oneriler
  uyeEkle(kerem, K.ecem, 'calisan')
  // Üçüncü sahip: bütün S + yeni. Kerem önerir, bekleyenler yönetim (Hüsniye); çalışan Ecem beklenmez
  const r = kerem.defter.addMember({ deviceCert: K.irem.deviceCert, displayName: 'İrem', role: 'sahip', ceremonyTranscriptHash: b4a.alloc(32, 7) })
  t.is(r.durum, 'oneri')
  const irem = new S.LedgerApi({ ledger: L, me: K.irem, now: kerem.defter.now })
  irem.oneriler = kerem.defter.oneriler
  t.is(irem.sign(r.oneriId).durum, 'oneri', 'yeni üye imzaladı, Hüsniye bekleniyor')
  t.alike(kerem.defter.waitingFor(r.oneriId), [id(K.husniye)], 'çalışan oy vermez, beklenmez')
  t.is(hus.defter.sign(r.oneriId).durum, 'uygulandi')
  t.is(L.members.get(id(K.irem)).role, 'sahip')
  // İrem'i çıkarmak: diğer iki sahibin çoğunluğu (2). Kerem tek başına → öneri
  const c = kerem.ekip.remove(id(K.irem))
  t.is(c.durum, 'oneri', 'NO_OWNER_APPROVAL öneri olur')
  t.absent(c.cikis)
  t.is(hus.defter.sign(c.oneriId).durum, 'uygulandi')
  t.is(L.members.get(id(K.irem)).active, false)
  t.is(kerem.ekip.exitMessage(id(K.irem)).type, 0xc8, 'öneriyle uygulanan çıkarmanın mesajı')
  // Geçiciye geçiş süresiz olmaz; 90 gün sınırı yazan tarafta
  t.is(hataOf(() => kerem.ekip.role(id(K.ecem), 'gecici')), 'TERM_REQUIRED')
  t.is(hataOf(() => kerem.ekip.role(id(K.ecem), 'gecici', { sureSonu: kerem.defter.now() + 91 * GUN })), 'TERM_LIMIT')
  t.is(hataOf(() => kerem.ekip.role(id(K.ecem), 'ebeveyn')), 'INVALID_ROLE')
  const bitis = kerem.defter.now() + 30 * GUN
  const g = kerem.ekip.role(id(K.ecem), 'gecici', { sureSonu: bitis })
  t.is(g.durum, 'uygulandi')
  t.is(g.sure.durum, 'uygulandi')
  t.is(L.members.get(id(K.ecem)).role, 'gecici')
  t.is(L.terms.get(id(K.ecem)).expiresAt, bitis)
  // Çalışana TERM yazılamaz
  uyeEkle(kerem, K.u5, 'calisan')
  t.is(hataOf(() => kerem.ekip.setTerm(id(K.u5), bitis)), 'NOT_TARGET_TEMPORARY')
})

test('282 TEAM_ASSIGN ve 287 TEAM_PLACES: yer ekleme ve kaldırma, yönetici yalnız kendi alanında atar', (t) => {
  const { L, kerem, kisi } = ekip()
  const e = kerem.ekip.places({ ekle: { ad: 'Depo', tur: 'depo', placeId: 'b2'.repeat(16) } })
  t.is(e.sonuc.durum, 'uygulandi')
  t.alike(e.sonuc.koleksiyonlar.map((x) => x.durum), ['uygulandi', 'uygulandi'])
  t.alike(e.yerler.map((y) => y.ad), ['Merkez', 'Depo'])
  t.ok([...L.collections.values()].some((c) => c.name === 'Yer:Depo'))
  t.is(hataOf(() => kerem.ekip.places({ ekle: { ad: 'X', tur: 'ev' } })), 'INVALID_BODY', 'ev aile yer türü')
  uyeEkle(kerem, K.husniye, 'yonetici')
  uyeEkle(kerem, K.ecem, 'calisan')
  t.is(kerem.ekip.assign(id(K.husniye), [YER]).durum, 'uygulandi')
  t.is(kerem.ekip.assign(id(K.ecem), ['b2'.repeat(16)]).durum, 'uygulandi')
  const hus = kisi(K.husniye)
  t.is(hataOf(() => hus.ekip.assign(id(K.ecem), [YER])), 'OUT_OF_SCOPE', 'Ecem Depo\'da; Hüsniye yalnız Merkez')
  t.is(kerem.ekip.assign(id(K.ecem), [YER]).durum, 'uygulandi')
  t.is(hus.ekip.assign(id(K.ecem), []).durum, 'uygulandi', 'kendi alanındaki çalışan')
  const m = kerem.ekip.places().yerler.find((y) => y.ad === 'Merkez')
  t.alike(m.kisiler.map((x) => x.name), ['Kerem', 'Hüsniye'])
  // Kaldırılan yer listeden ve atamalardan düşer
  const k = kerem.ekip.places({ kaldir: 'b2'.repeat(16) })
  t.is(k.sonuc.durum, 'uygulandi')
  t.alike(k.yerler.map((y) => y.ad), ['Merkez'])
  t.is(hataOf(() => kerem.ekip.places({ kaldir: 'b2'.repeat(16) })), 'NO_PLACE')
})

test('283 TEAM_TERM: geçicinin süresi dolunca yazdığı kayıt geçerli kümeye girmez; yeni TERM geri açar', (t) => {
  const { L, kerem, now } = ekip()
  uyeEkle(kerem, K.ecem, 'gecici')
  const bitis = now.su() + 2 * GUN
  t.is(kerem.ekip.setTerm(id(K.ecem), bitis).durum, 'uygulandi')
  t.is(kerem.ekip.assign(id(K.ecem), [YER]).durum, 'uygulandi')
  const yer = [...L.collections.values()].find((c) => c.name === 'Yer:Merkez').id
  const Le = kopyala(L)
  const rk = new Replika({ ledger: L, me: K.kerem, now })
  const re = new Replika({ ledger: Le, me: K.ecem, now })
  rk.sync()
  const teslim = (a, b) => { for (const m of a.outbox.splice(0)) { if (m.type === 0x81) b.receiveOp(m.bytes, m.kind || 0); else if (m.type === 0x82) b.receiveKey(m.bytes) } }
  teslim(rk, re)
  re.sync()
  const ke = new S.RecordApi({ replika: re })
  const kk = new S.RecordApi({ replika: rk })
  ke.put(yer, null, 'mekan.not', { metin: 'süre içinde' })
  now.ileri(3 * GUN)
  ke.put(yer, null, 'mekan.not', { metin: 'süre dolduktan sonra' })
  teslim(re, rk)
  t.alike(kk.query(yer).map((x) => x.fields.metin), ['süre içinde'], 'süresi dolan geçicinin kaydı hariç')
  t.is(kerem.ekip.setTerm(id(K.ecem), now.su() + 10 * GUN).durum, 'uygulandi')
  rk.sync()
  t.alike(kk.query(yer).map((x) => x.fields.metin).sort(), ['süre dolduktan sonra', 'süre içinde'], 'uzatma geri açar')
})

test('285 TEAM_REMOVE ve 286 TEAM_EXIT_STATUS: çalışanın telefonu iş kapsamını siler, makbuz tek kullanımlık; sahip silmez', (t) => {
  const { L, kerem, kisi, now } = ekip()
  uyeEkle(kerem, K.husniye, 'sahip')
  uyeEkle(kerem, K.ecem, 'calisan')
  uyeEkle(kerem, K.irem, 'calisan')
  kerem.ekip.assign(id(K.ecem), [YER])
  const Le = kopyala(L)
  const ekipCol = [...L.collections.values()].find((c) => c.name === 'Ekip').id
  const rk = new Replika({ ledger: L, me: K.kerem, now })
  const re = new Replika({ ledger: Le, me: K.ecem, now })
  rk.sync()
  const kk = new S.RecordApi({ replika: rk })
  kk.put(ekipCol, null, 'mekan.not', { metin: 'vardiya' })
  for (const m of rk.outbox.splice(0)) { if (m.type === 0x81) re.receiveOp(m.bytes, m.kind || 0); else if (m.type === 0x82) re.receiveKey(m.bytes) }
  re.sync()
  const ke = new S.RecordApi({ replika: re })
  t.is(ke.query(ekipCol).length, 1)
  const ecem = new S.TeamApi({ defter: new S.LedgerApi({ ledger: Le, me: K.ecem, now }), kayit: ke, now })
  // Çıkarma: kurucu sahip tek başına çalışanı çıkarır
  const c = kerem.ekip.remove(id(K.ecem), { reason: 'işten ayrıldı' })
  t.is(c.durum, 'uygulandi')
  t.is(c.cikis.type, 0xc8)
  t.alike(kerem.ekip.exitStatus().map((x) => [x.name, x.tur, x.makbuz.durum]), [['Ecem', 'cikarildi', 'bekleniyor']])
  // Ecem'in telefonu (kopyası güncel): olayı doğrular, siler, makbuz verir
  const s = ecem.receiveExit(id(K.kerem), c.cikis.bytes, 'dogrudan')
  t.is(s.durum, 'silindi')
  t.is(s.kapsam, 'is')
  t.ok(s.collections >= 1)
  t.is(re.ops.size, 0, 'iş kapsamı silindi')
  t.is(s.makbuz.type, 0xc9)
  const m = kerem.ekip.receiveReceipt(id(K.ecem), s.makbuz.bytes, 'posta')
  t.is(m.memberId, id(K.ecem))
  t.is(hataOf(() => kerem.ekip.receiveReceipt(id(K.ecem), s.makbuz.bytes, 'posta')), 'DUPLICATE_RECEIPT')
  t.is(hataOf(() => kerem.ekip.receiveReceipt(id(K.irem), s.makbuz.bytes, 'posta')), 'UNAUTHORIZED', 'başkasının makbuzu')
  // Çıkarılan üyeden makbuz dışında tür geçmez (tek giriş noktası, RFC-0022 e)
  t.is(hataOf(() => require('@havenfold/core').giris.gelenZarf({ myRole: 'uye', peerRole: 'uye', type: 0x81, bytes: b4a.alloc(0), L, gonderen: id(K.ecem), yol: 'posta' })), 'TYPE_NOT_ALLOWED')
  t.alike(kerem.ekip.exitStatus().map((x) => [x.name, x.makbuz.durum]), [['Ecem', 'geldi']])
  const Li = kopyala(L)
  const irem = new S.TeamApi({ defter: new S.LedgerApi({ ledger: Li, me: K.irem, now }), now })
  const ir = kerem.ekip.remove(id(K.irem))
  t.is(irem.receiveExit(id(K.kerem), ir.cikis.bytes, 'dogrudan').durum, 'silindi')
  // 30 gün makbuz gelmezse "gelmedi"
  now.ileri(31 * GUN)
  t.alike(kerem.ekip.exitStatus().map((x) => [x.name, x.makbuz.durum]), [['İrem', 'gelmedi'], ['Ecem', 'geldi']])
  // Başka sahiplerce çıkarılan sahip iş kapsamını kendiliğinden silmez (§10.3)
  const Lh = kopyala(L)
  const hus = new S.TeamApi({ defter: new S.LedgerApi({ ledger: Lh, me: K.husniye, now }), now })
  const hc = kerem.ekip.remove(id(K.husniye))
  t.is(hc.durum, 'uygulandi', 'iki sahipten biri ötekini çıkarır')
  t.is(hus.receiveExit(id(K.kerem), hc.cikis.bytes, 'dogrudan').durum, 'sahip')
  t.is(hataOf(() => kisi(K.u5).ekip.receiveExit(id(K.kerem), hc.cikis.bytes, 'dogrudan')), 'TARGET_NOT_ME')
})

test('kendi isteğiyle ayrılış: önce iş kapsamı silinir, sıfır özetli makbuz, sonra LEAVE; son sahip ayrılamaz ve hiçbir şey silinmez', (t) => {
  const { L, kerem, now } = ekip()
  uyeEkle(kerem, K.ecem, 'calisan')
  let silindi = 0
  const ecem = new S.TeamApi({ defter: new S.LedgerApi({ ledger: L, me: K.ecem, now }), now })
  const r = ecem.leave({ sil: ({ kapsam }) => { silindi++; t.is(kapsam, 'is'); return { collections: 3, convs: 1, blobs: 2 } } })
  t.is(r.durum, 'uygulandi')
  t.is(r.event.type, T.LEAVE)
  t.is(silindi, 1)
  t.alike([r.collections, r.convs, r.blobs], [3, 1, 2])
  const m = kerem.ekip.receiveReceipt(id(K.ecem), r.makbuz.bytes, 'posta')
  t.is(m.eventHash, '00'.repeat(32))
  t.alike(kerem.ekip.exitStatus().map((x) => [x.name, x.tur, x.makbuz.durum]), [['Ecem', 'ayrildi', 'geldi']])
  uyeEkle(kerem, K.irem, 'calisan')
  t.is(hataOf(() => kerem.ekip.leave({ sil: () => { silindi++ } })), 'LAST_OWNER')
  t.is(silindi, 1, 'son sahipte silme çağrılmadı')
})

test('284 TEAM_NOTICE ve Mekan kuralları: ekipte kişisel koleksiyon yok, kasa okuyucusu çalışan olamaz', (t) => {
  const { L, kerem } = ekip()
  t.is(hataOf(() => kerem.ekip.privacyNotice({ placeId: YER, textVersion: 'mekan-aydinlatma-2026.1' })), 'NOTICE_MISSING')
  const a = kerem.ekip.privacyNotice({ placeId: YER, textBlobId: b4a.alloc(32, 1), signBlobId: b4a.alloc(32, 2), textVersion: 'mekan-aydinlatma-2026.1', cameraCount: 2 })
  t.is(a.durum, 'uygulandi')
  t.is(kerem.ekip.places().yerler[0].aydinlatma, true)
  t.is(decodeBody(T.NOTICE, a.event.body).cameraCount, 2)
  t.is(kerem.ekip.privacyNotice({ placeId: YER, remove: true }).durum, 'uygulandi')
  t.is(kerem.ekip.places().yerler[0].aydinlatma, false)
  t.is(hataOf(() => kerem.defter.openCollection({ name: 'Kişisel', kind: 'kisisel', readers: ['uye:' + id(K.kerem)], writers: ['uye:' + id(K.kerem)] })), 'NO_IN_TEAM_PERSONAL')
  t.is(hataOf(() => kerem.defter.openCollection({ name: 'Kasa 2', readers: ['rol:calisan'], writers: ['rol:calisan'], sensitivity: 'kasa' })), 'VAULT_RULE')
  t.is(hataOf(() => kerem.defter.openCollection({ name: 'Aile', readers: ['rol:ebeveyn'], writers: ['rol:ebeveyn'] })), 'INVALID_BODY', 'aile rolü ekipte yok')
  t.is(L.kind, 'ekip')
})

// Codex 9. tur: ekipte kasa kişi payı adayları sahip, yönetici ve çalışan (RFC-0005 §5.1); geçici değil. Ekibin varsayılan
// Kasa koleksiyonu sahiplerin (VAULT_RULE'na uyar)
test('Codex 9. tur: ekipte kasa pay adayları ve varsayılan Kasa koleksiyonu', (t) => {
  const E = require('@havenfold/vault').esik
  const x = ekip()
  const hus = Object.assign({}, K.husniye, { ad: 'Hüsniye' })
  const irem = Object.assign({}, K.irem, { ad: 'İrem' })
  t.is(uyeEkle(x.kerem, hus, 'yonetici').durum, 'uygulandi')
  t.is(uyeEkle(x.kerem, irem, 'calisan').durum, 'uygulandi')
  const adaylar = E.kisiAdaylari(x.L, { haric: id(K.kerem) })
  t.alike(adaylar.sort(), [id(K.husniye), id(K.irem)].sort(), 'yönetici ve çalışan')
  t.ok(E.kisiAdaylari(x.L).includes(id(K.kerem)), 'sahip')
  const d = E.yaDagitim(x.L, { sahip: id(K.kerem), kisiler: [id(K.husniye), id(K.irem)], kagit: 1 })
  t.ok(d.kurulur, 'YA dağıtımı kurulur')
  const k = x.kerem.defter.openCollection({ name: 'Kasa', kind: 'genel', readers: ['rol:sahip'], writers: ['rol:sahip'], sensitivity: 'kasa', taskAccess: false, history: true })
  t.is(k.durum, 'uygulandi', 'ekibin Kasa koleksiyonu (rol:sahip)')
})

test('kanal: 280–287 CHANNEL_COMMAND\'ta, her biri TeamApi yöntemine bağlı', (t) => {
  const beklenen = { TEAM_CREATE: 280, TEAM_ROLE: 281, TEAM_ASSIGN: 282, TEAM_TERM: 283, TEAM_NOTICE: 284, TEAM_REMOVE: 285, TEAM_EXIT_STATUS: 286, TEAM_PLACES: 287 }
  for (const [ad, no] of Object.entries(beklenen)) t.is(S.CHANNEL_COMMAND[ad], no, ad)
  t.alike(S.TEAM_COMMAND, beklenen)
  t.is(typeof S.TeamApi.create, 'function')
  for (const y of ['role', 'assign', 'setTerm', 'privacyNotice', 'remove', 'exitStatus', 'places']) t.is(typeof S.TeamApi.prototype[y], 'function', y)
})
