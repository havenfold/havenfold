// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// protocol/vectors/sos.json üreticisi (RFC-0031 §9). Belirlenimci: sabit tohumlar, sabit ts, Ed25519.
// crypto_box_seal rastgele geçici anahtar kullandığı için mühürlü baytlar sos-fixture.json'da tutulur; girdi değişince
// yalnız vektör üretiminde (node core/core/scripts/vector-gen.js) yenilenir.
const b4a = require('b4a')
const sodium = require('sodium-native')
const { ledger: { Ledger, encodeEvent, decodeEvent }, kdf: { hash } } = require('@havenfold/core')
const { kodlama: { encodeInner, OP }, hlc: { fromMs } } = require('@havenfold/records')
const V = require('../../../core/test/helpers/v21')

const { C, K, T, TS0, hex, olay, anaAdimlar, koleksiyon, misafirEkle, misafirKaldir, K_TUM_AILE, VARLIK_KEDI } = V
const MISAFIR = C.misafir2
const GRANT = 'grant:' + hex(MISAFIR.memberId)
const KEREM = 'uye:' + hex(K.kerem.memberId)
const MID = hash('sos-vektor/afet-mid').subarray(0, 16)
const MID2 = hash('sos-vektor/afet-mid-2').subarray(0, 16)
const DAY = 86_400_000

// Belirlenimci bırakma anahtarı (yalnız test)
const DROP = { publicKey: b4a.alloc(32), secretKey: b4a.alloc(32) }
sodium.crypto_box_seed_keypair(DROP.publicKey, DROP.secretKey, hash('sos-vektor/drop'))

// Ana zincir: v2.1 ana zinciri, düzey 2.2, misafir, düzey 2.3, Tüm Aile'ye bırakma anahtarı. GRANT_WRITE yok: misafirin
// SOS'u örtük izinle (RFC-0031 §4.1).
function anaZincir (L) {
  return [
    ...anaAdimlar(L).map((f) => ['v21', f]),
    ['duzey22', () => olay(L, T.PROTOCOL_LEVEL, { level: '2.2' }, [K.kerem])],
    ['misafir', () => misafirEkle(L, MISAFIR, [K.kerem])],
    ['duzey23', () => olay(L, T.PROTOCOL_LEVEL, { level: '2.3' }, [K.kerem])],
    ['anahtar', () => koleksiyon(L, [K.kerem], { dropKey: DROP.publicKey })]
  ]
}
const EKLER = { iptal: (L) => misafirKaldir(L, MISAFIR, [K.kerem]) }

// JSON'da değer: bytes { bytes: hex }, diğerleri olduğu gibi
const jsonDeger = (v) => (b4a.isBuffer(v) ? { bytes: hex(v) } : v)
const degerJson = (v) => (v && typeof v === 'object' && !Array.isArray(v) && typeof v.bytes === 'string' ? b4a.from(v.bytes, 'hex') : v)

let SABITLER = null
function muhurlu (ad, girdi, uret) {
  if (!SABITLER) { try { SABITLER = { ...require('./sos-fixture.json') } } catch { SABITLER = {} } }
  if (SABITLER[ad] && SABITLER[ad].girdi === girdi) return SABITLER[ad].hex
  if (process.env.HF_VEKTOR_YAZ !== '1') throw new Error('SABIT_ESKI: ' + ad + ' — node core/core/scripts/vector-gen.js')
  SABITLER[ad] = { girdi, hex: uret() }
  require('f' + 's').writeFileSync(require('pa' + 'th').join(__dirname, 'sos-fixture.json'), JSON.stringify(SABITLER, null, 1) + '\n')
  return SABITLER[ad].hex
}

const alanlar = (subj, urun) => [{ name: '_subj', value: subj }, { name: '_t', value: TS0 }, { name: '_v', value: 1 }, ...Object.entries(urun).map(([name, value]) => ({ name, value }))]

function vektorler () {
  const { dropOpIdOf, dropSigDigest, appendRecordId, kodlama: { recDrop }, islem: I, anahtar: A } = require('@havenfold/records')
  const c = require('compact-encoding')

  const L = new Ledger()
  const ana = []
  for (const [, f] of anaZincir(L)) {
    const e = f()
    L.apply(e)
    ana.push({ tur: e.type, olay: hex(encodeEvent(e)), bas: hex(L.head) })
  }
  const kur = (n) => { const M = new Ledger(); for (let i = 0; i < n; i++) M.apply(decodeEvent(encodeEvent(L.events[i]))); return M }
  const ekler = {}
  for (const [ad, f] of Object.entries(EKLER)) {
    const M = kur(L.len)
    const e = f(M)
    M.apply(e)
    ekler[ad] = { olay: hex(encodeEvent(e)), bas: hex(M.head), M }
  }

  // Misafirin bırakmaları: gözlemci kerem (Tüm Aile okuyucusu, dropSecret elinde). kayit: kayıt katmanının sonucu;
  // motor: geçerli bırakmada motorun kararı (null geçerli, değilse neden; SOS her durumda gösterilir)
  let n = 0
  const birakmalar = []
  const birak = (ad, aciklama, zincir, { type = 'hf.sos', subj = GRANT, urun = {} }, kayit, motor) => {
    const M = zincir === 'ana' ? L : ekler[zincir].M
    const hlc = fromMs(TS0 + 1000) + BigInt(n++)
    const seq = M.len - 1
    const inner = { recordId: appendRecordId(MISAFIR.memberId, hlc), op: OP.APPEND, type, hlc, authorId: MISAFIR.memberId, ledgerSeq: seq, ledgerHash: M.hashAt(seq), fields: alanlar(subj, urun) }
    const ic = encodeInner(inner)
    const bytes = muhurlu(ad, hex(ic) + hex(DROP.publicKey), () => {
      const sealed = b4a.alloc(ic.byteLength + sodium.crypto_box_SEALBYTES)
      sodium.crypto_box_seal(sealed, ic, DROP.publicKey)
      const w = { collectionId: K_TUM_AILE, dropKeyHash: A.dropKeyHashOf(DROP.publicKey), sealed, sig: null }
      w.sig = I.sign(dropSigDigest(L.familyId, dropOpIdOf(w)), MISAFIR.signKeyPair.secretKey)
      return hex(c.encode(recDrop, w))
    })
    birakmalar.push({ aciklama, zincir, ledgerSeq: seq, ic: hex(ic), drop: bytes, kayit, ...(kayit === 'gecerli' ? { motor } : {}) })
  }
  birak('gecerli', 'Misafirin Tüm Aile\'ye hf.sos bırakması, özne grant:<kendisi>, GRANT_WRITE yok', 'ana', { urun: { yol: 'dugme', metin: 'Bahçedeyiz, Coki düştü', pil: 40 } }, 'gecerli', null)
  birak('afet', 'Misafirin afet modunda gönderdiği SOS (yol afet, afet_mid)', 'ana', { urun: { yol: 'afet', afet_mid: MID } }, 'gecerli', null)
  birak('ozne', 'Misafirin başka özneyle SOS\'u (kendi grant: öznesi değil)', 'ana', { subj: KEREM }, 'SUBJECT_NOT_ALLOWED')
  birak('sessiz', 'Misafirin sessiz SOS\'u (yol zorlama-pin, sessiz: true): kayıt geçer, motor için geçersiz, gösterilir', 'ana', { urun: { yol: 'zorlama-pin', sessiz: true } }, 'gecerli', 'SOS_FROM_GUEST')
  birak('urun', 'Örtük izin yalnız hf.sos içindir: GRANT_WRITE olmadan ürün türü', 'ana', { type: 'yuva.pet.beslenme', subj: 'varlik:' + hex(VARLIK_KEDI) }, 'NO_PERMISSION')
  birak('iptal', 'REVOKE\'tan sonra misafirin SOS\'u', 'iptal', {}, 'NO_PERMISSION')

  // Üyenin SOS'u: motor için geçerlilik (RFC-0031 §3). Gösterim: yol ve sessiz her zaman okunur.
  const motor = []
  const uye = (aciklama, urun, beklenen, gosterim, subj = KEREM) => {
    const hlc = fromMs(TS0 + 2000) + BigInt(n++)
    const inner = { recordId: appendRecordId(K.kerem.memberId, hlc), op: OP.APPEND, type: 'hf.sos', hlc, authorId: K.kerem.memberId, ledgerSeq: L.len - 1, ledgerHash: L.head, fields: alanlar(subj, urun) }
    const ic = encodeInner(inner)
    motor.push({ aciklama, ic: hex(ic), opId: hex(hash('sos-vektor/op', ic)), alanlar: Object.fromEntries(Object.entries(urun).map(([k, v]) => [k, jsonDeger(v)])), beklenen, gosterim })
  }
  uye('Alanı olmayan hf.sos: geçerli, yol dugme sayılır', {}, null, { yol: 'dugme', sessiz: false })
  uye('Tam alanlı dugme', { yol: 'dugme', konum: [4101234, 2898765, 12, TS0 - 5000], metin: 'Mutfaktayım, düştüm', pil: 23 }, null, { yol: 'dugme', sessiz: false })
  uye('Sessiz SOS: yol zorlama-pin, sessiz true', { yol: 'zorlama-pin', sessiz: true, konum: [4101234, 2898765, 30, TS0] }, null, { yol: 'zorlama-pin', sessiz: true })
  uye('sessiz true ama yol dugme: motor için geçersiz, gösterilir', { yol: 'dugme', sessiz: true }, 'INVALID_SOS_SILENT', { yol: 'dugme', sessiz: true })
  uye('65 baytlık metin: motor için geçersiz', { metin: 'a'.repeat(65) }, 'SOS_METIN', { yol: 'dugme', sessiz: false })
  uye('64 baytlık çok baytlı metin (32 × ş): geçerli', { metin: 'ş'.repeat(32) }, null, { yol: 'dugme', sessiz: false })
  uye('Bilinmeyen yol', { yol: 'saat' }, 'INVALID_SOS_PATH', { yol: 'dugme', sessiz: false })
  uye('Konum dört tamsayı değil', { konum: [4101234, 2898765, 12] }, 'INVALID_SOS_LOCATION', { yol: 'dugme', sessiz: false })
  uye('Pil 101', { pil: 101 }, 'INVALID_SOS_BATTERY', { yol: 'dugme', sessiz: false })
  uye('afet_mid 16 bayt değil', { yol: 'afet', afet_mid: b4a.alloc(8, 1) }, 'INVALID_SOS_DISASTER_MID', { yol: 'afet', sessiz: false })
  uye('Üye grant: öznesiyle yazamaz (misafirin örtük iznine ayrılmış)', {}, 'INVALID_SOS_SUBJECT', { yol: 'dugme', sessiz: false }, GRANT)

  // Afet bağı (§6): alıcı telefonun bildirim kararı, sırayla
  const tekil = [
    { aciklama: 'Aynı afet_mid önce afet mesajıyla, sonra kayıtla: tek bildirim', adimlar: [{ kaynak: 'afet', afetMid: hex(MID), t: TS0, bildir: true }, { kaynak: 'kayit', afetMid: hex(MID), t: TS0 + 60_000, bildir: false }] },
    { aciklama: 'Önce kayıt, sonra afet mesajı: tek bildirim', adimlar: [{ kaynak: 'kayit', afetMid: hex(MID2), t: TS0, bildir: true }, { kaynak: 'afet', afetMid: hex(MID2), t: TS0 + 1000, bildir: false }] },
    { aciklama: 'afet_mid\'i olmayan SOS her zaman bildirilir', adimlar: [{ kaynak: 'kayit', afetMid: null, t: TS0, bildir: true }, { kaynak: 'kayit', afetMid: null, t: TS0 + 1000, bildir: true }] },
    { aciklama: '7 gün sonra aynı afet_mid yeniden bildirilir', adimlar: [{ kaynak: 'afet', afetMid: hex(MID), t: TS0, bildir: true }, { kaynak: 'kayit', afetMid: hex(MID), t: TS0 + 7 * DAY, bildir: true }] }
  ]

  return {
    aciklama: 'RFC-0031 §9: hf.sos alanları ve misafirin SOS\'u. zincirler.ana v2.1 ana zinciri (ledger-v21-v2.json ile aynı adımlar), düzey 2.2, misafir (C.misafir2), düzey 2.3, Tüm Aile\'ye bırakma anahtarı (tohum hash(\'sos-vektor/drop\'); gizli yarısı dropSecret, yalnız test); GRANT_WRITE yok. ekler.iptal: REVOKE. birakmalar: misafirin REC_DROP\'u, gözlemci kerem; kayit: kayıt katmanının sonucu (gecerli ya da atılma kodu); motor: geçerli bırakmada motorun kararı (null geçerli). motor: üyenin (kerem) hf.sos işlemi (ic: OpInner, opId), beklenen: null ya da motor için geçersizlik kodu; gosterim: alıcının okuduğu yol ve sessiz (SOS her durumda gösterilir). Alan kodlaması: konum [latE5, lonE5, accM, at] listesi, afet bağı afet_mid (16 bayt); kayıt katmanında map yok, alan adı [a-z0-9_.] (RFC-0001 §4.1–§4.2). tekil: alıcının bildirim kararı sırayla (aynı afet_mid 7 gün içinde bir kez).',
    grantId: hex(MISAFIR.memberId),
    collectionId: hex(K_TUM_AILE),
    dropKey: hex(DROP.publicKey),
    dropSecret: hex(DROP.secretKey),
    zincirler: { ana },
    ekler: Object.fromEntries(Object.entries(ekler).map(([k, v]) => [k, { olay: v.olay, bas: v.bas }])),
    birakmalar,
    motor,
    tekil
  }
}

module.exports = { vektorler, degerJson }
