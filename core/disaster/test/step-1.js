// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D83 adım 1 (RFC-0012 §17): türetmelerin girdi denetimi, zarf kodlama ve sınırları, iç alanların kuralları, alıcı denetiminin
// dalları, durum makinesinin bütün geçişleri.
const test = require('brittle')
const b4a = require('b4a')
const { ledger: { Ledger } } = require('@havenfold/core')
const T = require('../derivation')
const M = require('../message')
const D = require('../audit')
const S = require('../status')
const { ZINCIR, KIMLIK, defter, ciftler, gondericiCifti } = require('./helpers/disaster-vector')

const MIN = 60_000
const SAAT = 3_600_000
const GUN = 20750
const AN = GUN * 86_400_000
const PAIR = b4a.alloc(32, 7)
const id = (n) => b4a.alloc(16, n)

test('türetmeler: kimlik 16 bayt değilse hata; gün ve dilim', (t) => {
  const key = T.afetKey(PAIR)
  t.exception(() => T.toTag(key, b4a.alloc(15), GUN), /KIMLIK_GECERSIZ/)
  t.exception(() => T.etiket(key, 'x', 1), /KIMLIK_GECERSIZ/)
  t.is(T.gunOf(AN + 1), GUN)
  t.is(T.dilimOf(900_000 * 3 + 5), 3)
  t.is(T.etiket(key, id(1), 5).byteLength, 4)
  t.unlike(T.anahtarCifti(PAIR, id(1), GUN).publicKey, T.anahtarCifti(PAIR, id(1), GUN - 1).publicKey, 'gün değişince Noise anahtarı değişir')
})

test('zarf kodlama: bütün türler kanonik; boy ve liste sınırları', (t) => {
  for (const [tur, m] of [
    [M.Z.AFET_HAVE, { items: [{ mid: id(1), toTag: b4a.alloc(8, 2), prio: 0, hops: 4 }] }],
    [M.Z.AFET_WANT, { mids: [id(1), id(2)] }],
    [M.Z.AFET_DONE, { items: [{ mid: id(1), doneSecret: b4a.alloc(32, 3) }] }],
    [M.Z.AFET_TAGS, { v: 1, slot: 7, tags: Array.from({ length: 25 }, (_, i) => b4a.alloc(4, i)) }],
    [M.Z.AFET_LINK_UP, { kind: 0, name: 'DIRECT-ab', pass: 'parola', port: 47871 }]
  ]) t.alike(M.coz(tur, M.kodla(tur, m)), m)
  t.exception(() => M.kodla(0xb6, {}), /INVALID_DISASTER_TYPE/)
  t.exception(() => M.coz(0xb6, b4a.alloc(1)), /INVALID_DISASTER_TYPE/)
  t.exception(() => M.coz(M.Z.AFET_TAGS, M.kodla(M.Z.AFET_TAGS, { v: 1, slot: 1, tags: [b4a.alloc(4)] })), /DISASTER_CORRUPT/, 'etiket listesi 25 değil')
  t.exception(() => M.coz(M.Z.AFET_TAGS, M.kodla(M.Z.AFET_TAGS, { v: 2, slot: 1, tags: Array.from({ length: 25 }, () => b4a.alloc(4)) })), /DISASTER_CORRUPT/)
  t.exception(() => M.coz(M.Z.AFET_HAVE, M.kodla(M.Z.AFET_HAVE, { items: Array.from({ length: 65 }, (_, i) => ({ mid: id(i % 250), toTag: b4a.alloc(8), prio: 0, hops: 0 })) })), /DISASTER_CORRUPT/, 'HAVE en çok 64')
  t.exception(() => M.coz(M.Z.AFET_MSG, b4a.alloc(601)), /DISASTER_LENGTH/, '600 bayttan büyük zarf')
  t.exception(() => M.coz(M.Z.AFET_WANT, b4a.from([1, 1])), /DISASTER_CORRUPT/, 'eksik bayt')
  t.exception(() => M.coz(M.Z.AFET_WANT, b4a.concat([M.kodla(M.Z.AFET_WANT, { mids: [] }), b4a.from([0])])), /DISASTER_CORRUPT/, 'sondaki fazla bayt')
  t.exception(() => M.kodla(M.Z.AFET_MSG, { mid: id(1), toTag: b4a.alloc(8), prio: 0, hops: 0, expiresDay: 0, doneHash: id(2), nonce: b4a.alloc(24), ct: b4a.alloc(700) }), /DISASTER_LENGTH/)
})

test('mühür: iç alanların kuralları; sınır dışı hops ve süre; yanlış çiftle açılmaz', (t) => {
  const o = { pair: PAIR, from: id(1), to: id(2), at: AN, gun: GUN }
  const hata = (ek) => { try { M.muhurle({ ...o, ...ek }); return null } catch (e) { return e.message } }
  t.is(hata({ kind: M.KIND.METIN, text: '' }), 'INVALID_DISASTER_TEXT')
  t.is(hata({ kind: M.KIND.METIN, text: 'x'.repeat(257) }), 'INVALID_DISASTER_TEXT')
  t.is(hata({ kind: M.KIND.SOS, text: 'ş'.repeat(33) }), 'INVALID_DISASTER_TEXT', 'bayt sayılır (UTF-8)')
  t.is(hata({ kind: 9, text: 'x' }), 'INVALID_DISASTER_FIELD_KIND')
  t.is(hata({ kind: M.KIND.ALINDI }), 'INVALID_DISASTER_REF', 'ALINDI ref ister')
  t.is(hata({ kind: M.KIND.IYIYIM, ref: id(3) }), 'INVALID_DISASTER_REF')
  t.is(hata({ kind: M.KIND.UYARI, text: 'deprem' }), 'DISASTER_FIELD_ALARM', 'UYARI alarm ister')
  t.is(hata({ kind: M.KIND.SOS, alarm: { kind: 'deprem', level: 1, nearby: [] } }), 'DISASTER_FIELD_ALARM')
  t.is(hata({ kind: M.KIND.UYARI, alarm: { kind: 'sel', level: 1, nearby: [] } }), 'DISASTER_FIELD_ALARM')
  t.is(hata({ kind: M.KIND.UYARI, alarm: { kind: 'deprem', level: 1, nearby: [] }, konum: { latE5: 1, lonE5: 1, accM: 1, at: 1 } }), 'INVALID_DISASTER_LOCATION')
  t.is(hata({ kind: M.KIND.SOS, konum: { latE5: 9_100_000, lonE5: 1, accM: 1, at: 1 } }), 'INVALID_DISASTER_LOCATION')
  t.is(hata({ kind: M.KIND.SOS, battery: 101 }), 'INVALID_DISASTER_BATTERY')
  t.is(hata({ kind: M.KIND.SOS, hops: 5 }), 'DISASTER_LIMIT')
  t.is(hata({ kind: M.KIND.SOS, expiresDay: GUN + 4 }), 'DISASTER_LIMIT')
  t.is(hata({ kind: M.KIND.METIN, text: 'x'.repeat(256), konum: { latE5: -1, lonE5: -2, accM: 3, at: 4 }, battery: 100 }), null)
  const r = M.muhurle({ ...o, kind: M.KIND.ALINDI, ref: id(9) })
  t.is(M.ac(r.msg, b4a.alloc(32, 8)), null, 'başka çift')
  t.is(M.ac({ ...r.msg, ct: b4a.alloc(4) }, PAIR), null, 'kısa ct')
  t.alike(M.ac(r.msg, PAIR).ref, id(9))
  t.is(M.konumYuvarla(M.KIND.METIN, null), null)
})

test('alıcı denetimi: alıcı türü, misafir yalnız üyelerden, kimlik uyuşmazlığı', (t) => {
  const L = defter(ZINCIR)
  const hex = (b) => b4a.toString(b, 'hex')
  t.is(D.kimlikTuru(L, hex(KIMLIK.kutu.memberId)), 'kutu')
  t.is(D.kimlikTuru(L, hex(KIMLIK.isci1.memberId)), 'cihaz')
  t.is(D.kimlikTuru(L, hex(KIMLIK.uc1.memberId)), null, 'çıkarılmış uç')
  t.is(D.kimlikTuru(L, hex(KIMLIK.misafir1.memberId)), 'misafir')
  t.is(D.kimlikTuru(L, hex(KIMLIK.ecem.memberId)), 'telefon')
  t.not(D.gonderebilir('kutu', M.KIND.METIN))
  const msg = (kimden, kime, kind, ek = {}) => M.coz(M.Z.AFET_MSG, M.muhurle({ pair: gondericiCifti(ZINCIR, kimden, kime), from: ek.from ?? KIMLIK[kimden].memberId, to: ek.to ?? KIMLIK[kime].memberId, kind, text: 'x', at: AN, gun: GUN, alarm: ek.alarm }).bytes)
  const den = (m, alici) => D.alici({ msg: m, ciftler: ciftler(L, KIMLIK[alici]), meId: KIMLIK[alici].memberId, L, bugun: GUN, gorulen: new Map() })
  t.is(den(msg('kerem', 'isci1', M.KIND.METIN), 'isci1').neden, 'NOT_RECIPIENT', 'cihaz alıcı değil')
  t.is(den(msg('kerem', 'kutu', M.KIND.METIN), 'kutu').neden, 'NOT_RECIPIENT', 'kutu alıcı değil (yalnız taşır)')
  // İçte "from" çiftin karşı tarafı değil: Kerem, Hüsniye'ye İrem gibi yazıyor
  t.is(den(msg('kerem', 'husniye', M.KIND.METIN, { from: KIMLIK.irem.memberId }), 'husniye').neden, 'IDENTITY_ERROR')
  t.is(den(msg('kerem', 'husniye', M.KIND.METIN, { to: KIMLIK.ecem.memberId }), 'husniye').neden, 'NOT_OPENED', 'toTag başka alıcıya')
  t.ok(den(msg('kerem', 'misafir1', M.KIND.METIN), 'misafir1').gecerli, 'misafir üyeden alır')
  t.is(den(msg('isci1', 'husniye', M.KIND.UYARI, { alarm: { kind: 'elektrik', level: 0, nearby: [] } }), 'husniye').gecerli, true)
  const bos = new Ledger()
  t.is(D.kimlikTuru(bos, hex(KIMLIK.kerem.memberId)), null)
})

test('durum makinesi: elle aç ve kapat, HAZIR\'da yazınca, düğümde pil ve sensör, yerel mesaj, 72 saat ve "sürsün mü"', (t) => {
  const g = (ek) => ({ simdi: AN, internetYok: null, internetVar: null, isaret: null, kullanici: null, yazdi: false, yerelMesaj: false, dugum: null, bekleyen: 0, surdur: null, ...ek })
  const kapali = { durum: 'KAPALI', etkinBas: null, elle: false }
  const hazir = { durum: 'HAZIR', etkinBas: null, elle: false }
  t.alike(S.gecis(kapali, g({ kullanici: 'ac' })), { durum: 'ETKIN', etkinBas: AN, elle: true, soru: false, soruBas: null, kapatildi: null })
  t.is(S.gecis({ durum: 'ETKIN', etkinBas: AN, elle: true }, g({ kullanici: 'kapat' })).durum, 'KAPALI')
  t.is(S.gecis(hazir, g({ yazdi: true })).durum, 'ETKIN')
  t.is(S.gecis(kapali, g({ yazdi: true })).durum, 'KAPALI', 'KAPALI\'da yazmak ETKİN yapmaz')
  t.is(S.gecis(kapali, g({ dugum: { pilde: true } })).durum, 'ETKIN')
  t.is(S.gecis(kapali, g({ dugum: { sensor: true } })).durum, 'ETKIN')
  t.is(S.gecis(kapali, g({ dugum: {} })).durum, 'KAPALI')
  t.is(S.gecis(kapali, g({ yerelMesaj: true })).durum, 'HAZIR')
  t.is(S.gecis(kapali, g({ uyari: true })).durum, 'ETKIN', 'D88: kutuya işçinin UYARI\'sı geldi (§10 adım 3)')
  t.is(S.gecis(kapali, g({ internetYok: AN - 11 * MIN, esikDk: 10 })).durum, 'HAZIR', 'eşik ayarı 10 dk')
  t.is(S.gecis(kapali, g({ internetYok: AN - 11 * MIN, esikDk: 1 })).durum, 'HAZIR', 'eşik en az 10 dk')
  t.is(S.gecis(kapali, g({ internetYok: AN - 60 * MIN, esikDk: 500 })).durum, 'KAPALI', 'eşik en çok 120 dk')
  t.is(S.gecis(kapali, g({ isaret: AN - 7 * SAAT, internetYok: AN - 10 * MIN })).durum, 'KAPALI', '6 saatten eski işaret')
  t.is(S.gecis(kapali, g({ isaret: AN - MIN, internetYok: AN - MIN })).durum, 'KAPALI', 'internet 2 dk yok değil')
  const elle = { durum: 'ETKIN', etkinBas: AN - 72 * SAAT, elle: true }
  const soruldu = S.gecis(elle, g({ internetYok: AN - 80 * SAAT }))
  t.alike(soruldu, { durum: 'ETKIN', etkinBas: AN - 72 * SAAT, elle: true, soru: true, soruBas: AN }, '72 saat: sorulur')
  t.alike(S.gecis(soruldu, g({ simdi: AN + 9 * MIN, internetYok: AN - 80 * SAAT })), soruldu, 'soru 10 dk açık kalır')
  t.is(S.gecis(soruldu, g({ simdi: AN + 10 * MIN, internetYok: AN - 80 * SAAT })).durum, 'HAZIR', 'cevap yoksa HAZIR')
  t.ok(S.gecis(elle, g({ simdi: AN + 5 * SAAT, internetYok: AN - 80 * SAAT })).soru, 'B6: tık geç gelse de önce sorulur')
  t.alike(S.gecis(soruldu, g({ surdur: true, internetYok: AN - 80 * SAAT })), { durum: 'ETKIN', etkinBas: AN, elle: true, soru: false, soruBas: null, kapatildi: null }, 'sürsün: yeniden 72 saat')
  t.is(S.gecis(soruldu, g({ surdur: false, internetYok: AN - 80 * SAAT })).durum, 'HAZIR')
  t.is(S.gecis({ durum: 'ETKIN', etkinBas: AN - 72 * SAAT, elle: false }, g({})).durum, 'HAZIR', 'kendiliğinden açılan 72 saatte sormadan HAZIR')
  t.alike(S.gecis({ durum: 'ETKIN', etkinBas: AN - SAAT, elle: false }, g({ internetYok: AN - 2 * SAAT })), { durum: 'ETKIN', etkinBas: AN - SAAT, elle: false, soru: false, soruBas: null })
  t.is(S.gecis(hazir, g({ internetVar: AN - 9 * MIN })).durum, 'HAZIR', '10 dk dolmadı')
  t.is(S.gecis(hazir, g({ internetVar: AN - 10 * MIN })).durum, 'KAPALI')
})

test('D84 B6: elle kapatma, kapatmadan önceki işaret ve internet kesintisiyle geri dönmez', (t) => {
  const g = (ek) => ({ simdi: AN, internetYok: AN - 3 * SAAT, internetVar: null, isaret: AN - SAAT, kullanici: null, yazdi: false, yerelMesaj: false, dugum: null, bekleyen: 1, surdur: null, ...ek })
  let d = S.gecis({ durum: 'KAPALI', etkinBas: null, elle: false }, g({}))
  t.is(d.durum, 'ETKIN', 'işaret + internet yok')
  d = S.gecis(d, g({ kullanici: 'kapat' }))
  t.is(d.durum, 'KAPALI')
  t.is(d.kapatildi, AN)
  d = S.gecis(d, g({ simdi: AN + MIN }))
  t.is(d.durum, 'KAPALI', 'eski işaret yeniden açmaz')
  t.is(S.gecis(d, g({ simdi: AN + 20 * MIN })).durum, 'KAPALI', 'internet kesintisi kapatmadan sayılır: 30 dk dolmadı')
  t.is(S.gecis(d, g({ simdi: AN + 31 * MIN })).durum, 'HAZIR', 'kapatmadan 30 dk sonra yine internet yok')
  t.is(S.gecis(d, g({ simdi: AN + 3 * MIN, isaret: AN + 2 * MIN })).durum, 'ETKIN', 'kapatmadan sonraki yeni işaret açar')
  t.is(S.gecis(d, g({ simdi: AN + MIN, yerelMesaj: true })).durum, 'HAZIR', 'yeni yerel mesaj')
  t.is(S.gecis(d, g({ kullanici: 'ac' })).kapatildi, null, 'elle açınca kapatma unutulur')
})

test('D84 B5: alıcı penceresi [bugün − 3, bugün + 1] (açıklama 1 madde 4)', (t) => {
  const L = defter(ZINCIR)
  const pair = gondericiCifti(ZINCIR, 'kerem', 'husniye')
  const me = KIMLIK.husniye.memberId
  const sinan = (gun, n) => M.muhurle({ pair, from: KIMLIK.kerem.memberId, to: me, kind: M.KIND.METIN, text: 'x', at: AN, gun, mid: id(n), nonce: b4a.alloc(24, n) }).msg
  const den = (gun, n) => D.alici({ msg: sinan(gun, n), ciftler: ciftler(L, KIMLIK.husniye), meId: me, L, bugun: GUN, gorulen: new Map() })
  t.ok(den(GUN - 3, 1).gecerli, '3 gün önce gönderilmiş (expiresDay = bugün) açılır')
  t.ok(den(GUN + 1, 2).gecerli, 'saati bir gün ileri gönderen')
  t.is(den(GUN - 4, 3).neden, 'NOT_OPENED', '4 gün önceki gün denenmez')
  t.is(den(GUN + 2, 4).neden, 'NOT_OPENED')
  t.is(D.etiketler(ciftler(L, KIMLIK.husniye), me, GUN).length, ciftler(L, KIMLIK.husniye).length * 5)
})
