// SPDX-License-Identifier: Apache-2.0
// protocol/vectors/sdk-v2.json üreticisi (RFC-0015 §7). Belirlenimci.
// Dosyayı yazmak için: node core/core/scripts/vector-gen.js
const b4a = require('b4a')
const { ledger: { Ledger, T, encodeEvent, decodeEvent }, caps: { CapsBook }, hello: { CAPS } } = require('@havenfold/core')
const V = require('../../../core/core/test/helpers/v21')
const { resolveMember, Presence, parseSrc, confOf, validateFields } = require('../../common')

const { K, C, hex, olay, anaAdimlar, TS0 } = V
const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const yaz = (f) => hataOf(() => validateFields(f)) || 'yazilir'

// Ana zincir + İrem iki kez telefon değiştirir (eski telefon imzalamadan, ebeveyn çoğunluğuyla)
function adimlar (L) {
  const rot = (eski, yeni) => () => olay(L, T.ROTATE_DEVICE, { oldMemberId: eski.memberId, newDeviceCert: yeni.deviceCert, ceremonyTranscriptHash: b4a.alloc(32, 7) }, [yeni, K.kerem, K.husniye])
  return [...anaAdimlar(L), rot(K.irem, K.u5), rot(K.u5, K.u6)]
}
const ZINCIR = (() => { const L = new Ledger(); return adimlar(L).map((f) => { const e = f(); L.apply(e); return hex(encodeEvent(e)) }) })()
function defter (z = ZINCIR) { const L = new Ledger(); for (const h of z) L.apply(decodeEvent(b4a.from(h, 'hex'))); return L }

const h32 = (n) => b4a.alloc(32, n).toString('hex')
const h16 = (n) => b4a.alloc(16, n).toString('hex')

function v1 () {
  const ogeler = [
    'msg:' + h32(1) + '/' + h16(2),
    'kayit:' + h16(3) + '/' + h16(4),
    'dosya:' + h32(5),
    'dosya:' + h32(5) + '#s=3',
    'dosya:' + h32(5) + '#t=61500',
    'aktarma:bitwarden',
    'msg:ab',
    'kayit:' + h16(3),
    'dosya:' + h32(5) + '#s=03',
    'web:https://ornek',
    'aktarma:' + 'a'.repeat(192)
  ].map((s) => ({ oge: s, bayt: b4a.byteLength(s), ayrisim: parseSrc(s) }))
  const gecerli = 'kayit:' + h16(3) + '/' + h16(4)
  const listeler = [
    { aciklama: '16 öğe', _src: Array(16).fill(gecerli) },
    { aciklama: '17 öğe', _src: Array(17).fill(gecerli) },
    { aciklama: '201 baytlık öğe', _src: ['aktarma:' + 'a'.repeat(193)] },
    { aciklama: 'biçimi bozuk öğe', _src: ['msg:ab'] }
  ].map((l) => ({ ...l, sonuc: yaz({ _src: l._src }) }))
  return { ogeler, listeler }
}

function v2 () {
  return {
    yazma: [{ _conf: 101 }, { _conf: -1 }, { _conf: 50.5 }, { _conf: 0 }, { _conf: 100 }].map((f) => ({ alanlar: f, sonuc: yaz(f) })),
    okuma: [{ alanlar: {}, conf: confOf({}) }, { alanlar: { _conf: 73 }, conf: confOf({ _conf: 73 }) }, { alanlar: { _conf: 150 }, conf: confOf({ _conf: 150 }) }]
  }
}

function v3 () {
  const L = defter()
  const N = anaAdimlar(new Ledger()).length // ilk ROTATE_DEVICE'ın seq'i
  const durumlar = [
    { memberId: hex(K.irem.memberId), atLedgerSeq: null },
    { memberId: hex(K.irem.memberId), atLedgerSeq: N - 1 },
    { memberId: hex(K.irem.memberId), atLedgerSeq: N },
    { memberId: hex(K.u5.memberId), atLedgerSeq: N },
    { memberId: hex(K.u5.memberId), atLedgerSeq: null },
    { memberId: hex(K.kerem.memberId), atLedgerSeq: null },
    { memberId: hex(C.isci1.memberId), atLedgerSeq: null }
  ].map((d) => ({ ...d, sonuc: resolveMember(L, d.memberId, d.atLedgerSeq) }))
  return { durumlar }
}

// Gözlemler: Hüsniye (HIDE_PRESENCE) 3 saat önce doğrudan; Kerem 40 dakika önce emanetle; Ecem gözlem yok
function v4 () {
  const simdi = TS0 + 10 * 3_600_000
  const gozlem = [
    { uye: hex(K.husniye.memberId), yol: 'dogrudan', an: simdi - 3 * 3_600_000 },
    { uye: hex(K.kerem.memberId), yol: 'emanet', an: simdi - 40 * 60_000 },
    { uye: hex(K.kerem.memberId), yol: 'emanet', an: simdi + 5 * 60_000 } // telefonun saatinden ileri: saat alınır
  ]
  const caps = [{ uye: hex(K.husniye.memberId), caps: CAPS.LEDGER_V21 | CAPS.HIDE_PRESENCE, at: simdi - 3 * 3_600_000 }, { uye: hex(K.kerem.memberId), caps: CAPS.LEDGER_V21, at: simdi - 3_600_000 }]
  const v = { simdi, soran: hex(K.u6.memberId), gozlem, caps, sorular: [] }
  v.sorular = [
    { uye: hex(K.husniye.memberId), islem: 'presence' },
    { uye: hex(K.husniye.memberId), islem: 'presenceWithin' },
    { uye: hex(K.kerem.memberId), islem: 'presence' },
    { uye: hex(K.ecem.memberId), islem: 'presence' },
    { uye: hex(K.ecem.memberId), islem: 'presenceWithin' },
    { uye: hex(C.isci1.memberId), islem: 'presence' }
  ].map((s) => ({ ...s, sonuc: calistir4(v, s) }))
  return v
}

function calistir4 (v, s, zincir = ZINCIR) {
  const L = defter(zincir)
  const cb = new CapsBook()
  for (const c of v.caps) cb.record(c.uye, c.caps, c.at)
  const g = new Presence({ ledger: L, me: v.soran, caps: cb, now: () => v.simdi })
  for (const o of v.gozlem) o.yol === 'dogrudan' ? g.direct(o.uye, o.an) : g.hold(o.uye, o.an)
  try { return g[s.islem](s.uye) } catch (e) { return { hata: e.message } }
}

function v5 () {
  return [{ _by: hex(K.kerem.memberId) }, { _yazar: 'x' }, { _src: ['dosya:' + h32(5)], baslik: 'Kira' }].map((f) => ({ alanlar: f, sonuc: yaz(f) }))
}

function vektorler () {
  return {
    aciklama: 'RFC-0015 §7: ayrılmış alanlar, resolveMember, son görülme. Zincir ledger-v21.json ana zincirinin devamıdır: İrem önce u5, sonra u6 telefonuna geçer (eski telefon imzalamadan, iki ebeveynle). Kimlikler createIdentity({seed: "defter-vektor/<ad>"}). "sonuc: yazilir" SDK\'nın kabul ettiğini, hata kodu reddettiğini gösterir.',
    zincir: ZINCIR,
    v1: v1(),
    v2: v2(),
    v3: v3(),
    v4: v4(),
    v5: v5()
  }
}

module.exports = { vektorler, defter, calistir4, yaz, ZINCIR }
