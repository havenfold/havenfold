// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// protocol/vectors/guest-write.json üreticisi (RFC-0030 §15). Belirlenimci: sabit tohumlar, sabit ts, Ed25519.
// crypto_box_seal rastgele geçici anahtar kullandığı için mühürlü baytlar guest-write-fixture.json'da tutulur; girdi
// değişince yalnız vektör üretiminde (node core/core/scripts/vector-gen.js) yenilenir.
const b4a = require('b4a')
const sodium = require('sodium-native')
const { ledger: { Ledger, encodeEvent, decodeEvent }, kdf: { hash } } = require('@havenfold/core')
const { encodeInner, OP } = require('../../encoding')
const { fromMs } = require('../../hlc')
const V = require('../../../core/test/helpers/v21')

const { C, K, T, TS0, hex, olay, anaAdimlar, koleksiyon, misafirEkle, misafirKaldir, K_TUM_AILE, K_KASA, VARLIK_KEDI } = V
const COKI = 'varlik:' + hex(VARLIK_KEDI)
const MISAFIR = C.misafir2
const TURLER = ['yuva.pet.beslenme', 'yuva.pet.su']

// Belirlenimci bırakma anahtarı (yalnız test)
const DROP = { publicKey: b4a.alloc(32), secretKey: b4a.alloc(32) }
sodium.crypto_box_seed_keypair(DROP.publicKey, DROP.secretKey, hash('misafir-yazma-vektor/drop'))

const izin = (L, x = {}) => olay(L, T.GRANT_WRITE, { grantId: MISAFIR.memberId, collectionId: K_TUM_AILE, types: TURLER, subjects: [COKI], ...x }, [K.husniye])

// Ana zincir: v2.1 ana zinciri, düzey 2.2, misafir, düzey 2.3, Tüm Aile'ye bırakma anahtarı, GRANT_WRITE
function anaZincir (L) {
  return [
    ...anaAdimlar(L).map((f) => ['v21', f]),
    ['duzey22', () => olay(L, T.PROTOCOL_LEVEL, { level: '2.2' }, [K.kerem])],
    ['misafir', () => misafirEkle(L, MISAFIR, [K.kerem])],
    ['duzey23', () => olay(L, T.PROTOCOL_LEVEL, { level: '2.3' }, [K.kerem])],
    ['anahtar', () => koleksiyon(L, [K.kerem], { dropKey: DROP.publicKey })],
    ['izin', () => izin(L)]
  ]
}
const EKLER = {
  bos: (L) => izin(L, { types: [] }),
  iptal: (L) => misafirKaldir(L, MISAFIR, [K.kerem])
}

let SABITLER = null
function muhurlu (ad, girdi, uret) {
  if (!SABITLER) { try { SABITLER = { ...require('./guest-write-fixture.json') } } catch { SABITLER = {} } }
  if (SABITLER[ad] && SABITLER[ad].girdi === girdi) return SABITLER[ad].hex
  if (process.env.HF_VEKTOR_YAZ !== '1') throw new Error('SABIT_ESKI: ' + ad + ' — node core/core/scripts/vector-gen.js')
  SABITLER[ad] = { girdi, hex: uret() }
  require('f' + 's').writeFileSync(require('pa' + 'th').join(__dirname, 'guest-write-fixture.json'), JSON.stringify(SABITLER, null, 1) + '\n')
  return SABITLER[ad].hex
}

function vektorler () {
  const { dropOpIdOf, dropSigDigest } = require('../../replica')
  const { recDrop } = require('../../encoding')
  const c = require('compact-encoding')
  const I = require('../../operation')
  const A = require('../../key')

  const L = new Ledger()
  const adlar = {}
  const ana = []
  for (const [ad, f] of anaZincir(L)) {
    const e = f()
    L.apply(e)
    if (ad !== 'v21') adlar[ad] = e.seq
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

  // Defter durumları: onek olay uygulanmadan önceki zincir uzunluğu
  const defter = []
  const gecersiz = (aciklama, onek, yap, hata) => { const M = kur(onek); defter.push({ aciklama, onek, olay: hex(encodeEvent(yap(M))), hata }) }
  defter.push({ aciklama: 'Geçerli GRANT_WRITE: herhangi bir ebeveyn, normal koleksiyon, ürün türleri, varlık öznesi', onek: adlar.izin, olay: ana[adlar.izin].olay, gecerli: true, bas: ana[adlar.izin].bas })
  gecersiz('Kasa koleksiyonuna GRANT_WRITE', L.len, (M) => izin(M, { collectionId: K_KASA }), 'NOT_COLLECTION_ELIGIBLE')
  gecersiz('Düzey 2.2\'de olay 36', adlar.duzey23, (M) => izin(M), 'LEVEL_TOO_LOW')
  gecersiz('Bırakma anahtarı olmayan koleksiyon', adlar.anahtar, (M) => izin(M), 'NO_DROP_KEY')
  gecersiz('hf. türü izin verilemez', L.len, (M) => izin(M, { types: ['hf.vaka.sahip'] }), 'INVALID_BODY')
  gecersiz('Ebeveyn olmayan imzacı', L.len, (M) => olay(M, T.GRANT_WRITE, { grantId: MISAFIR.memberId, collectionId: K_TUM_AILE, types: TURLER, subjects: [COKI] }, [K.irem]), 'NO_PARENT_SIGNATURE')
  gecersiz('Kaldırılmış misafir', L.len, (M) => izin(M, { grantId: C.misafir1.memberId }), 'NO_TARGET')

  // Bırakmalar: misafirin REC_DROP'u, gözlemci kerem (Tüm Aile okuyucusu, dropSecret elinde)
  let n = 0
  const birakmalar = []
  const birak = (ad, aciklama, zincir, { type = 'yuva.pet.beslenme', subj = COKI, op = OP.APPEND } = {}, beklenen) => {
    const M = zincir === 'ana' ? L : ekler[zincir].M
    const hlc = fromMs(TS0 + 1000) + BigInt(n++)
    const seq = M.len - 1
    const inner = {
      recordId: require('../../replica').appendRecordId(MISAFIR.memberId, hlc), op, type, hlc, authorId: MISAFIR.memberId,
      ledgerSeq: seq, ledgerHash: M.hashAt(seq), fields: [{ name: '_subj', value: subj }, { name: '_t', value: TS0 }, { name: '_v', value: 1 }]
    }
    const ic = encodeInner(inner)
    // op'u zorlamadan mühürler (op = 1 durumu için; sealDrop op'u 2 yapar)
    const bytes = muhurlu(ad, hex(ic) + hex(DROP.publicKey), () => {
      const sealed = b4a.alloc(ic.byteLength + sodium.crypto_box_SEALBYTES)
      sodium.crypto_box_seal(sealed, ic, DROP.publicKey)
      const w = { collectionId: K_TUM_AILE, dropKeyHash: A.dropKeyHashOf(DROP.publicKey), sealed, sig: null }
      w.sig = I.sign(dropSigDigest(L.familyId, dropOpIdOf(w)), MISAFIR.signKeyPair.secretKey)
      return hex(c.encode(recDrop, w))
    })
    birakmalar.push({ aciklama, zincir, ledgerSeq: seq, ic: hex(ic), drop: bytes, beklenen })
  }
  birak('gecerli', 'İzinli tür ve öznede bırakma', 'ana', {}, 'gecerli')
  birak('tur', 'İzinsiz türde bırakma', 'ana', { type: 'yuva.pet.kum' }, 'TYPE_NOT_ALLOWED')
  birak('ozne', 'İzinsiz öznede bırakma', 'ana', { subj: 'uye:' + hex(K.ecem.memberId) }, 'SUBJECT_NOT_ALLOWED')
  birak('op1', 'op = 1 (put)', 'ana', { op: OP.PUT }, 'INVALID_OPERATION_TYPE')
  birak('iptal', 'REVOKE\'tan sonra bırakma', 'iptal', {}, 'NO_PERMISSION')
  birak('bos', 'types boş GRANT_WRITE\'tan sonra bırakma', 'bos', {}, 'NO_PERMISSION')

  return {
    aciklama: 'RFC-0030 §15: misafirin sınırlı yazması. zincirler.ana v2.1 ana zinciri (ledger-v21-v2.json ile aynı adımlar), düzey 2.2, misafir (C.misafir2), düzey 2.3, Tüm Aile\'ye bırakma anahtarı (tohum hash(\'misafir-yazma-vektor/drop\'); gizli yarısı dropSecret, yalnız test) ve GRANT_WRITE. ekler: ananın sonuna tek olay (bos: types boş GRANT_WRITE, iptal: REVOKE). defter: onek uzunluğundaki ana zincirde olay uygulanır. birakmalar: ilgili zincirin bütününde gözlemci kerem, dropSecret elinde; REC_DROP sonucu (gecerli ya da atılma kodu). Kodlama: RFC-0001 §3, olay 36 gövdesi RFC-0030 §3.',
    grantId: hex(MISAFIR.memberId),
    collectionId: hex(K_TUM_AILE),
    dropKey: hex(DROP.publicKey),
    dropSecret: hex(DROP.secretKey),
    zincirler: { ana },
    ekler: Object.fromEntries(Object.entries(ekler).map(([k, v]) => [k, { olay: v.olay, bas: v.bas }])),
    defter,
    birakmalar
  }
}

module.exports = { vektorler }
