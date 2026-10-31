// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// RFC-0010 adım 1–3: kart, dizin ve QR'ın sınırları; gövde kuralları; kural paketi (DELEGE) ve hizmet tarafı denetimi;
// onay yorumunun kenar durumları. Vektörlerde olmayan dalları kapsar.
const test = require('brittle')
const b4a = require('b4a')
const c = require('compact-encoding')
const { ledger: { Ledger } } = require('@havenfold/core')
const V = require('../../core/test/helpers/v21')
const H = require('..')
const Y = require('./helpers/service-vector')

const { kart: Kt, paket: P, onay: O, kodlama: K } = H
const h = (x) => b4a.from(x, 'hex')
const hata = (f) => { try { f(); return 'kabul' } catch (e) { return e.message } }
const GUN = K.GUN_MS
const TS = V.TS0
const vet = () => Kt.kartCoz(Y.kartKur(Y.VETERINER))
const guv = () => Kt.kartCoz(Y.kartKur(Y.GUVENLIK))

test('kart: alan sınırları ve kanonik çözme', (t) => {
  for (const ek of [{ category: 'kuafor' }, { endpoint: 'http://x.example.tr' }, { name: '' }, { region: '' }, { maxMB: 0 }, { maxMB: 26 }]) {
    t.is(hata(() => Y.kartKur({ ...Y.VETERINER, ...ek })), 'CARD_CORRUPT', JSON.stringify(ek))
  }
  const b = Y.kartKur(Y.VETERINER)
  t.is(hata(() => Kt.kartCoz(b4a.concat([b, b4a.from([0])]))), 'CARD_CORRUPT', 'sondaki fazla bayt')
  t.is(hata(() => Kt.kartCoz('kart')), 'CARD_CORRUPT')
  // serviceId signPub'tan türemiyorsa: imzasız kısımda serviceId'nin ilk baytı değişir
  const s = b4a.from(b)
  s[0] ^= 1
  t.is(hata(() => Kt.kartCoz(s)), 'CARD_CORRUPT')
  t.is(hata(() => Kt.dogrula(b4a.alloc(64), b4a.alloc(32), b4a.alloc(3))), 'kabul', 'bozuk anahtar false döner')
  t.is(Kt.dogrula(b4a.alloc(64), b4a.alloc(32), b4a.alloc(3)), false)
})

test('kart: sürüm seçimi', (t) => {
  const a = vet()
  t.is(Kt.kartSec(null, a), a)
  t.is(hata(() => Kt.kartSec(a, guv())), 'SERVICE_MISMATCH')
  const ayniSurum = Kt.kartCoz(Y.kartKur({ ...Y.VETERINER, name: 'Başka ad' }))
  t.is(hata(() => Kt.kartSec(a, ayniSurum)), 'CARD_STALE', 'aynı sürümde farklı kart')
})

test('dizin: bozuk girdi, tekrarlı kart, eski dizin ve yurt dışı', (t) => {
  const d = Y.signCifti('dd'.repeat(32))
  const kartlar = [Y.kartKur(Y.VETERINER)]
  const m = { version: 1, region: 'TR-35', issuedAt: TS, validUntil: TS + GUN, cards: kartlar, revoked: [] }
  t.is(hata(() => Kt.dizinImzala({ ...m, validUntil: TS - 1 }, d.secretKey)), 'INDEX_CORRUPT')
  const yeni = Y.kartKur({ ...Y.VETERINER, issuedAt: TS + 1 })
  const iki = Kt.dizinCoz(Kt.dizinImzala({ ...m, cards: [yeni, kartlar[0]] }, d.secretKey), [d.publicKey])
  t.is(iki.kartlar.size, 1, 'aynı serviceId iki kez: yenisi kalır')
  t.is([...iki.kartlar.values()][0].issuedAt, TS + 1)
  t.is(Kt.enYeni(vet(), null).name, 'Maple Veteriner Kliniği')
  t.is(Kt.enYeni(vet(), guv()).name, 'Maple Veteriner Kliniği', 'başka hizmetin kartı karışmaz')
  // İmzası geçerli ama validUntil 14 günü aşan dizin (eski araçla imzalanmış): imzayı elle kur
  const uzun = c.encode(K.DIZIN.govde, { ...m, validUntil: TS + 15 * GUN })
  const imzali = b4a.concat([uzun, Kt.imzala(require('@havenfold/core').kdf.hashLP(K.ETIKET.dizin, uzun), d.secretKey)])
  t.is(hata(() => Kt.dizinCoz(imzali, [d.publicKey])), 'INDEX_CORRUPT')
  t.is(hata(() => Kt.dizinCoz(b4a.alloc(10), [d.publicKey])), 'INDEX_CORRUPT')
  const dz = Kt.dizinCoz(Kt.dizinImzala(m, d.secretKey), [d.publicKey])
  t.is(hata(() => Kt.dizinTaze(null, TS)), 'INDEX_STALE')
  t.is(hata(() => Kt.hizmetKarti({ dizin: dz, simdi: TS })), 'NO_SERVICE')
  t.is(hata(() => Kt.hizmetKarti({ dizin: dz, serviceId: b4a.alloc(16, 1), simdi: TS })), 'NO_SERVICE')
  t.is(Kt.hizmetKarti({ dizin: dz, kart: vet(), simdi: TS }).trust, 'dizin', 'yüz yüze okutulan kart dizinde varsa dizindeki esas')
  t.is(Kt.yurtDisi(vet()), false)
  t.is(Kt.yurtDisi(Kt.kartCoz(Y.kartKur(Y.YABANCI))), true)
})

test('QR ve base32: kanonik çözme', (t) => {
  t.is(K.b32(b4a.from('foobar')), 'MZXW6YTBOI')
  t.alike(K.b32Coz('MZXW6YTBOI', 'X'), b4a.from('foobar'))
  for (const s of ['A', 'ABC', 'ABCDEF', 'MZXW6YTBO1', 'MZXW6YTBOJ', 7]) t.is(hata(() => K.b32Coz(s, 'X')), 'X', String(s))
  t.is(hata(() => Kt.qrCoz('HFH1:AAAAAAA')), 'INVALID_QR', 'sağlamadan kısa')
  t.is(hata(() => Kt.qrCoz(null)), 'INVALID_QR')
})

const govde = (ek = {}, kart = vet()) => ({ ...Y.govdeOf(Y.GOVDE, kart), ...ek })

test('gövde: tür ve sınır kuralları', (t) => {
  const g = govde()
  const kurallar = [
    { v: 2 }, { kind: 'toplu' }, { title: 'x'.repeat(121) }, { note: 'x'.repeat(2049) },
    { sender: { ...g.sender, label: 'ç'.repeat(33) } }, { items: Array(65).fill(g.items[0]) }, { files: Array(9).fill(g.files[0]) },
    { useUntil: g.issuedAt - 1 }, { useUntil: g.issuedAt + 366 * GUN }, { kind: 'kural' }, { ruleProof: { rule: b4a.alloc(1), delegation: b4a.alloc(1) } },
    { kind: 'silme' }, { ref: b4a.alloc(16) }, { kind: 'silme', ref: b4a.alloc(16) }, { seqNo: 1 }
  ]
  kurallar.push({ category: 'kuafor' }, { items: [{ type: 'x', fields: b4a.from([1, 2]) }] }) // B15, B16
  for (const ek of kurallar) t.is(hata(() => P.govdeKodla({ ...g, ...ek })), 'BODY_CORRUPT', Object.keys(ek).join())
  t.is(hata(() => P.alanlarKodla({ 'Büyük': 1 })), 'INVALID_FIELD_NAME')
  for (const al of [{ _subj: 'varlik:aa' }, { yazan: 'uye:aa' }, { l: ['x', 'grant:bb'] }, { c: 'device:cc' }]) {
    t.is(hata(() => P.govdeKodla({ ...g, items: [{ type: 'x', fields: P.alanlarKodla(al) }] })), 'IDENTITY_IN_PACKAGE', JSON.stringify(al))
  }
  t.is(hata(() => P.govdeKodla({ ...g, items: [{ type: 'x', fields: P.alanlarKodla({ metin: 'uyelik', adet: 2 }) }] })), 'kabul')
  t.is(hata(() => P.alanlarKodla({ x: () => 1 })), 'INVALID_FIELD')
  const silme = P.govdeKodla({ ...g, kind: 'silme', ref: b4a.alloc(16, 4), items: [], files: [] })
  t.is(P.govdeCoz(silme).ref.byteLength, 16, 'silme paketi yalnız ref taşır')
  t.is(hata(() => P.govdeCoz(b4a.concat([silme, b4a.from([1])]))), 'BODY_CORRUPT')
  t.is(hata(() => P.govdeKodla({ ...g, title: 5 })), 'BODY_CORRUPT', 'kodlanamayan alan')
})

test('boyut, sahip özeti ve rastgele yol', (t) => {
  const k = vet() // maxMB 20
  t.is(P.boyutDenetle(govde(), k), 120_000)
  t.is(hata(() => P.boyutDenetle(govde({ files: [{ ...govde().files[0], size: 21 * K.MB }] }), k)), 'SIZE_OVERRUN')
  t.is(P.sahipOzeti(b4a.alloc(32, 1)).length, 64)
  const ta = P.takmaAd()
  const sc = P.sifreCifti()
  t.is(ta.secretKey.byteLength, 64)
  t.is(sc.publicKey.byteLength, 32)
  // Rastgele ephSecret, nonce ve packageId ile kurulan paket açılır; iki kurulum farklı baytlar verir
  const kart = { ...k, encPub: sc.publicKey }
  const ic = P.icImzala(k.serviceId, P.govdeKodla(govde()), ta.secretKey)
  const a = P.paketKur({ kart, ic, expiresAt: TS + GUN, simdi: TS })
  const b = P.paketKur({ kart, ic, expiresAt: TS + GUN, simdi: TS })
  t.not(b4a.toString(a.bytes, 'hex'), b4a.toString(b.bytes, 'hex'))
  t.is(hata(() => P.paketAc(a.bytes, { kart, encSecret: sc.secretKey })), 'INVALID_SIGNATURE', 'gövdenin takma adı başka anahtar')
  t.is(hata(() => P.paketKur({ kart, ic, expiresAt: TS, simdi: TS })), 'INVALID_DURATION')
})

test('hizmet tarafı: sürüm işlevi, kısa ct, sürüm uyuşmazlığı', (t) => {
  const k = vet()
  const enc = P.sifreCifti(h(Y.VETERINER.encSeed))
  const ta = P.takmaAd(h(Y.GOVDE.takmaSeed))
  const ic = P.icImzala(k.serviceId, P.govdeKodla(govde()), ta.secretKey)
  const r = P.paketKur({ kart: k, ic, expiresAt: TS + GUN, simdi: TS })
  t.is(P.paketAc(r.bytes, { kart: { ...k, keyVersion: 9 }, encSecret: (v) => (v === 2 ? enc.secretKey : null) }).govde.kind, 'tek')
  t.is(hata(() => P.paketAc(r.bytes, { kart: k, encSecret: () => null })), 'NO_KEY_VERSION')
  const p = P.paketCoz(r.bytes)
  t.is(hata(() => P.paketAc(c.encode(K.PAKET, { ...p, ct: b4a.alloc(4) }), { kart: k, encSecret: enc.secretKey })), 'PACKAGE_OPEN_FAILED')
  t.is(hata(() => P.paketAc(c.encode(K.PAKET, { ...p, v: 2 }), { kart: k, encSecret: enc.secretKey })), 'SERVICE_MISMATCH')
  t.is(hata(() => P.paketAc(c.encode(K.PAKET, { ...p, ephPub: b4a.alloc(32) }), { kart: k, encSecret: enc.secretKey })), 'INVALID_KEY')
  t.is(hata(() => P.paketCoz(b4a.alloc(3))), 'PACKAGE_CORRUPT')
})

test('kural paketi: DELEGE zinciri hizmet tarafında doğrulanır', (t) => {
  const k = guv()
  const enc = P.sifreCifti(h(Y.GUVENLIK.encSeed))
  const ta = P.takmaAd(b4a.alloc(32, 0x31))
  const delege = P.takmaAd(b4a.alloc(32, 0x32))
  const rule = P.kuralKodla({ ruleId: b4a.alloc(16, 0x58), serviceId: k.serviceId, category: 'guvenlik', triggers: ['mekan.guvenlik.alarm'], placeId: b4a.alloc(16), include: ['olay', 'kare'], maxPerDay: 50, useDays: 30, expiresAt: TS + 30 * GUN })
  const ruleHash = P.ruleHash(rule)
  const delegation = P.delegeImzala({ ruleHash, serviceId: k.serviceId, delegatePub: delege.publicKey, expiresAt: TS + 30 * GUN }, ta.secretKey)
  const kur = (ek = {}, imzalayan = delege.secretKey) => {
    const body = P.govdeKodla({ ...govde({}, k), kind: 'kural', category: 'guvenlik', seqNo: 3, ruleProof: { rule, delegation }, sender: { pseudoPub: ta.publicKey, label: 'Şube' }, ...ek })
    return P.paketKur({ kart: k, ic: P.icImzala(k.serviceId, body, imzalayan), expiresAt: TS + GUN, simdi: TS }).bytes
  }
  const ac = (b) => P.paketAc(b, { kart: k, encSecret: enc.secretKey })
  t.is(ac(kur()).govde.seqNo, 3)
  t.is(hata(() => ac(kur({}, ta.secretKey))), 'INVALID_SIGNATURE', 'paket takma adla imzalı, delegeyle değil')
  t.is(hata(() => ac(kur({ ruleProof: { rule: b4a.concat([rule, b4a.from([0])]), delegation } }))), 'INVALID_SIGNATURE', 'ruleHash tutmaz')
  t.is(hata(() => ac(kur({ sender: { pseudoPub: delege.publicKey, label: 'x' } }))), 'INVALID_SIGNATURE', 'DELEGE başka takma adla')
  const baskaHizmet = P.delegeImzala({ ruleHash, serviceId: b4a.alloc(16, 7), delegatePub: delege.publicKey, expiresAt: TS }, ta.secretKey)
  t.is(hata(() => ac(kur({ ruleProof: { rule, delegation: baskaHizmet } }))), 'INVALID_SIGNATURE', 'DELEGE başka hizmete')
  t.is(hata(() => P.delegeCoz(b4a.alloc(5), ta.publicKey)), 'DELEGATION_CORRUPT')
  t.is(hata(() => P.kuralKodla({})), 'RULE_CORRUPT')
})

test('onay: biçim ve yazan tarafın sınırları', (t) => {
  t.is(O.scopeOf('kural:veteriner'), null, 'veteriner kural kategorisi değil')
  t.is(O.scopeOf('tek:kuafor'), null)
  t.alike(O.scopeOf('kural:cagri'), { tur: 'kural', kategori: 'cagri' })
  t.is(O.serviceOf('hizmet:' + 'A'.repeat(32)), null, 'büyük harf hex')
  const k = vet()
  const ph = b4a.alloc(32, 1)
  const tek = O.onayGovdesi({ serviceId: k.serviceId, tur: 'tek', kategori: 'veteriner', expiresAt: TS + GUN, payloadHash: ph, simdi: TS })
  t.is(tek.govde.scope, 'tek:veteriner')
  t.is(tek.salt, null)
  t.is(tek.govde.shareId.byteLength, 16)
  t.is(O.onayGovdesi({ serviceId: k.serviceId, tur: 'gizli', ownerId: b4a.alloc(16, 2), expiresAt: TS + GUN, payloadHash: ph, simdi: TS }).salt.byteLength, 32)
  t.is(hata(() => O.onayGovdesi({ serviceId: k.serviceId, tur: 'tek', kategori: 'veteriner', expiresAt: TS + 8 * GUN, payloadHash: ph, simdi: TS })), 'INVALID_DURATION')
  t.is(hata(() => O.onayGovdesi({ serviceId: k.serviceId, tur: 'kural', kategori: 'guvenlik', expiresAt: TS + 31 * GUN, payloadHash: ph, simdi: TS })), 'INVALID_DURATION')
  t.is(O.onayGovdesi({ serviceId: k.serviceId, tur: 'kural', kategori: 'guvenlik', expiresAt: TS + 30 * GUN, payloadHash: ph, simdi: TS }).govde.scope, 'kural:guvenlik')
  t.is(hata(() => O.onayGovdesi({ serviceId: k.serviceId, tur: 'kural', kategori: 'veteriner', expiresAt: TS + GUN, payloadHash: ph, simdi: TS })), 'INVALID_COVERAGE')
  t.is(hata(() => O.onayGovdesi({ serviceId: k.serviceId, tur: 'iptal', expiresAt: TS + GUN, payloadHash: ph, simdi: TS })), 'INVALID_COVERAGE')
  t.is(hata(() => O.onayGovdesi({ serviceId: k.serviceId, tur: 'tek', kategori: 'veteriner', expiresAt: TS + GUN, payloadHash: b4a.alloc(3), simdi: TS })), 'INVALID_SUMMARY')
  t.is(hata(() => O.kayitYeri({ onay: { tur: 'gizli' } })), 'NO_PERSONAL')
  t.is(hata(() => O.kayitYeri({ onay: { tur: 'tek' } })), 'NO_SHARES')
  t.is(hata(() => O.gonderimDenetle({ onay: null })), 'NO_APPROVAL')
  t.is(hata(() => O.gonderimDenetle({ onay: { durum: 'gecerli', tur: 'kural' } })), 'NO_APPROVAL', 'kural onayıyla tek paket gitmez')
})

test('onay yorumu: ilk olay iptalse onay geçersiz; iptalin iptali yok sayılır; yorum defteri değiştirmez', (t) => {
  const L = new Ledger()
  const id = b4a.alloc(16, 0x61)
  const svc = 'hizmet:' + b4a.toString(vet().serviceId, 'hex')
  const adim = [
    ...V.anaAdimlar(L),
    () => V.olay(L, V.T.SHARE_CONSENT, { shareId: id, service: svc, scope: 'iptal', ownerId: V.ZERO16, expiresAt: 0, payloadHash: V.ZERO32 }, [V.K.kerem]),
    () => V.olay(L, V.T.SHARE_CONSENT, { shareId: id, service: svc, scope: 'iptal', ownerId: V.ZERO16, expiresAt: 0, payloadHash: V.ZERO32 }, [V.K.kerem]),
    () => V.olay(L, V.T.SHARE_CONSENT, { shareId: id, service: svc, scope: 'iptal', ownerId: V.ZERO16, expiresAt: 5, payloadHash: V.ZERO32 }, [V.K.kerem])
  ]
  for (const f of adim) L.apply(f())
  const once = L.len
  const o = O.onaylar(L).get(b4a.toString(id, 'hex'))
  t.is(o.durum, 'gecersiz')
  t.is(o.neden, 'FORMAT_CORRUPT')
  t.is(o.iptal.seq, o.seq + 1, 'iptal kaydı tutulur ama geçersiz onay geçerli olmaz')
  t.alike(o.yokSayilan, [o.seq + 2])
  t.is(L.len, once)
  t.alike(O.iptalGovdesi(o), { shareId: id, service: svc, scope: 'iptal', ownerId: V.ZERO16, expiresAt: 0, payloadHash: V.ZERO32 })
})

test('kural onayı: imzacılardan biri aktif kaldıkça geçerli', (t) => {
  const L = new Ledger()
  const id = b4a.alloc(16, 0x62)
  const svc = 'hizmet:' + b4a.toString(guv().serviceId, 'hex')
  const adim = [
    ...V.anaAdimlar(L),
    () => V.olay(L, V.T.SHARE_CONSENT, { shareId: id, service: svc, scope: 'kural:guvenlik', ownerId: V.ZERO16, expiresAt: TS + 30 * GUN, payloadHash: b4a.alloc(32, 1) }, [V.K.husniye, V.K.kerem]),
    () => V.olay(L, V.T.REMOVE_MEMBER, { memberId: V.K.husniye.memberId, reason: 'test', wipe: false }, [V.K.kerem, V.K.irem])
  ]
  for (const f of adim) L.apply(f())
  t.is(O.onaylar(L).get(b4a.toString(id, 'hex')).durum, 'gecerli')
})
