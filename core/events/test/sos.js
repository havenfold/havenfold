// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// protocol/vectors/sos.json (RFC-0031 §9) ve D80 birim testleri: hf.sos alanları, misafirin örtük SOS izni, gösterim,
// afet bağıyla tek bildirim. Vektördeki beklenen değerler dosyada elle seçilmiş durumlardır.
const test = require('brittle')
const b4a = require('b4a')
const { ledger: { Ledger, decodeEvent, encodeEvent, T }, encoding: { eventHash }, guestView: GV, v23 } = require('@havenfold/core')
const { Replika } = require('@havenfold/records')
const { kayitIslemden, kayitlarReplikadan, olayHatasi, olaylar } = require('../event')
const { Katalog } = require('../type')
const S = require('../sos')
const F = require('../../../protocol/vectors/sos.json')
const V = require('../../core/test/helpers/v21')

const hex = (b) => b4a.toString(b, 'hex')
const coz = (h) => decodeEvent(b4a.from(h, 'hex'))
function zincir (ek = null) {
  const L = new Ledger()
  for (const o of F.zincirler.ana) L.apply(coz(o.olay))
  if (ek) L.apply(coz(F.ekler[ek].olay))
  return L
}
function replika (L) {
  const r = new Replika({ ledger: L, me: V.K.kerem, now: () => V.TS0 + 3_600_000 })
  r.sync()
  r.addDropSecret(F.collectionId, b4a.from(F.dropSecret, 'hex'))
  return r
}
const ctxOf = (L, kayitlar) => ({ ledger: L, katalog: new Katalog(), col: L.collections.get(F.collectionId), kayitlar })

test('vektörler: sos.json üretici aynı dosyayı verir (belirlenimci)', (t) => {
  const { vektorler } = require('./helpers/sos-vector')
  t.alike(JSON.parse(JSON.stringify(vektorler())), F)
})

test('vektörler: sos zinciri uygulanır; düzey 2.3, GRANT_WRITE yok, Tüm Aile\'de bırakma anahtarı', (t) => {
  const L = new Ledger()
  for (const o of F.zincirler.ana) {
    const e = coz(o.olay)
    t.is(hex(encodeEvent(e)), o.olay)
    L.apply(e)
    t.is(hex(eventHash(e)), o.bas)
  }
  t.is(L.level, '2.3')
  t.absent(F.zincirler.ana.some((o) => o.tur === 36), 'GRANT_WRITE yok')
  t.is(v23.tumAileOf(L), F.collectionId)
  t.is(hex(L.collections.get(F.collectionId).dropKey), F.dropKey)
  t.is(hex(zincir('iptal').head), F.ekler.iptal.bas)
})

test('vektörler: misafirin SOS bırakmaları (RFC-0031 §4.1)', (t) => {
  t.ok(F.birakmalar.length >= 5)
  for (const b of F.birakmalar) {
    const L = zincir(b.zincir === 'ana' ? null : b.zincir)
    const r = replika(L)
    const s = r.receiveOp(b4a.from(b.drop, 'hex'), 1)
    t.is(s.status === 'gecerli' ? 'gecerli' : s.code, b.kayit, b.aciklama)
    if (b.kayit !== 'gecerli') continue
    const kayitlar = kayitlarReplikadan(r, F.collectionId)
    const k = kayitlar.find((x) => x.type === 'hf.sos')
    t.is(k.yazar, 'misafir')
    t.is(olayHatasi(ctxOf(L, kayitlar), k), b.motor, b.aciklama + ' (motor)')
    // Motor için geçersiz olsa da SOS gösterilir (§3)
    const liste = S.sosListesi(ctxOf(L, kayitlar))
    t.is(liste.length, 1)
    t.is(liste[0].gecerli, b.motor === null)
  }
})

test('vektörler: üyenin SOS alanları, motor için geçerlilik ve gösterim (RFC-0031 §3)', (t) => {
  const L = zincir()
  t.ok(F.motor.length >= 8)
  for (const m of F.motor) {
    const k = kayitIslemden(L, b4a.from(m.ic, 'hex'), b4a.from(m.opId, 'hex'))
    const { degerJson } = require('./helpers/sos-vector')
    for (const [ad, v] of Object.entries(m.alanlar)) t.alike(k.fields[ad], degerJson(v), m.aciklama + ': ' + ad)
    t.is(k.yazar, 'uye')
    const ctx = ctxOf(L, [k])
    t.is(olayHatasi(ctx, k), m.beklenen, m.aciklama)
    t.is(olaylar(ctx).sayilir.length, m.beklenen === null ? 1 : 0, 'geçersiz SOS vaka açmaz')
    const g = S.sosListesi(ctx)
    t.is(g.length, 1, 'her durumda gösterilir')
    t.alike({ yol: g[0].yol, sessiz: g[0].sessiz }, m.gosterim)
  }
})

test('vektörler: afet bağıyla tek bildirim (RFC-0031 §6)', (t) => {
  for (const d of F.tekil) {
    let simdi = 0
    const tk = new S.SosTekil({ now: () => simdi })
    for (const a of d.adimlar) {
      simdi = a.t
      t.is(tk.bildir(a.afetMid), a.bildir, d.aciklama + ' — ' + a.kaynak)
    }
  }
})

test('D80: SosTekil kalıcı saklamayla yeniden açılınca hatırlar; 16 bayt da kabul eder', (t) => {
  const m = new Map()
  const saklama = { get: (k) => m.get(k) ?? null, set: (k, v) => m.set(k, v) }
  const mid = b4a.alloc(16, 9)
  t.ok(new S.SosTekil({ saklama, now: () => 1 }).bildir(mid))
  t.absent(new S.SosTekil({ saklama, now: () => 2 }).bildir(hex(mid)), 'yeni nesne aynı saklamadan okur')
})

test('D80: örtük izin düzey 2.3\'e ve aktif misafirliğe bağlı; GUEST_VIEW satırı', (t) => {
  const gid = F.grantId
  const L = zincir()
  t.alike(v23.ortukSos(L, gid, F.collectionId).subjects, ['grant:' + gid])
  t.is(v23.ortukSos(L, gid, hex(V.K_BAKICI)), null, 'yalnız Tüm Aile')
  t.alike(v23.birakanlarOf(L, F.collectionId), [gid])
  t.alike(v23.grantWritersOf(L, F.collectionId), [], 'defter kuralları örtük izni saymaz')
  const gv = GV.acceptGuestView(null, GV.buildGuestView(L, gid, V.K.kerem), V.C.misafir2.memberId)
  t.alike(gv.drops, [{ collectionId: F.collectionId, dropKey: b4a.from(F.dropKey, 'hex'), types: ['hf.sos'], subjects: ['grant:' + gid] }])
  // Düzey 2.2'de örtük izin yok
  const L22 = new Ledger()
  for (const o of F.zincirler.ana) { const e = coz(o.olay); if (e.type === T.PROTOCOL_LEVEL && L22.level === '2.2') break; L22.apply(e) }
  t.is(L22.level, '2.2')
  t.is(v23.ortukSos(L22, gid, F.collectionId), null)
  // REVOKE'tan sonra yok
  t.is(v23.ortukSos(zincir('iptal'), gid, F.collectionId), null)
})

test('D80: misafirin SOS\'u vaka açar; sorumlular ebeveynler, kaynak cekirdek:hf.sos (RFC-0031 §4.1)', (t) => {
  const { degerlendir } = require('../engine')
  const L = zincir()
  const r = replika(L)
  const b = F.birakmalar.find((x) => x.kayit === 'gecerli' && x.motor === null)
  t.is(r.receiveOp(b4a.from(b.drop, 'hex'), 1).status, 'gecerli')
  const ctx = { ledger: L, collectionId: F.collectionId, katalog: new Katalog(), kayitlar: kayitlarReplikadan(r, F.collectionId), me: L.canonical(r.meHex) }
  const s = degerlendir(ctx, V.TS0 + 5000)
  t.is(s.yeni.length, 1)
  const a = s.yeni[0].alanlar
  t.is(a.kaynak, 'cekirdek:hf.sos')
  t.is(a._subj, 'grant:' + F.grantId)
  // Sorumlu listesi ebeveynlerdir (misafirin kartı yoktur)
  const M = require('../escalation')
  const sorumlu = M.sorumluListesi(L, L.collections.get(F.collectionId), null)
  t.ok(sorumlu.length > 0 && sorumlu.every((id) => L.members.get(id).role === 'ebeveyn'))
})
