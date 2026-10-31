// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// vectors/ledger-valid.json ve ledger-invalid.json üreticisi (belirlenimci: sabit tohum, sabit ts, Ed25519).
// Dosyaları yazmak için: node scripts/vector-gen.js
const b4a = require('b4a')
const { Ledger, encodeEvent } = require('../../ledger/ledger')
const { DEFAULT_POLICY } = require('../../ledger/policy')
const { K, T, TS0, ZERO32, olay, ekle, at, prekey, genesis } = require('./ledger')

const hex = (b) => b4a.toString(b, 'hex')

const DAY = 86_400_000
const rotateH = (L, yeni, imz) => olay(L, T.ROTATE_DEVICE, { oldMemberId: K.husniye.memberId, newDeviceCert: yeni.deviceCert, ceremonyTranscriptHash: b4a.alloc(32, 7) }, [yeni, ...imz])

function gecerliZincir () {
  const L = new Ledger()
  const adimlar = [
    () => genesis(),
    () => ekle(L, K.husniye, 'ebeveyn', [K.kerem]),
    () => ekle(L, K.irem, 'yetiskin', [K.kerem, K.husniye]),
    () => ekle(L, K.ecem, 'cocuk', [K.kerem, K.husniye]),
    () => ekle(L, K.kutu, 'kutu', [K.husniye]),
    () => prekey(L, K.kerem, TS0 + 10_000, 1),
    () => prekey(L, K.husniye, TS0 + 11_000, 2),
    () => prekey(L, K.kerem, TS0 + 12_000, 3),
    () => olay(L, T.POLICY, { policy: { ...DEFAULT_POLICY, defaultDisappearSec: 86400 } }, [K.kerem, K.husniye]),
    () => olay(L, T.SET_ROLE, { memberId: K.ecem.memberId, role: 'yetiskin' }, [K.kerem, K.husniye, K.ecem]),
    () => olay(L, T.ROTATE_DEVICE, { oldMemberId: K.irem.memberId, newDeviceCert: K.u5.deviceCert, ceremonyTranscriptHash: b4a.alloc(32, 7) }, [K.u5, K.kerem, K.husniye]),
    () => at(L, K.kutu, [K.kerem]),
    () => olay(L, T.PLAN, { storeReceiptJws: 'jws', product: 'aile', expiresAt: TS0 + 365 * 86_400_000 }, [K.husniye]),
    () => olay(L, T.LEAVE, { memberId: K.ecem.memberId }, [K.ecem]),
    // K15: uzaktan katılım + ACTIVATE_MEMBER
    () => ekle(L, K.u6, 'yetiskin', [K.kerem, K.husniye], { remote: true, activatesAt: TS0 + L.len * 1000 + DAY }),
    () => olay(L, T.ACTIVATE_MEMBER, { memberId: K.u6.memberId }, [K.husniye]),
    // K16: eski cihaz imzası olmadan ebeveyn cihaz değişimi (bekler) ve eski cihazın vetosu
    () => rotateH(L, K.u7, [K.kerem, K.u5, K.u6]),
    () => at(L, K.u7, [K.husniye])
  ]
  const olaylar = []
  for (const f of adimlar) {
    const e = f()
    L.apply(e)
    olaylar.push({ tur: e.type, olay: hex(encodeEvent(e)), bas: hex(L.head) })
  }
  return { L, olaylar }
}

// Her durum: geçerli zincirin ilk `onek` olayı uygulanır, sonra `olay` hata kodu `hata` ile reddedilmelidir.
function gecersizDurumlar () {
  const { olaylar } = gecerliZincir()
  const durumlar = []
  const kur = (onek) => {
    const L = new Ledger()
    for (const o of olaylar.slice(0, onek)) L.apply(require('../../ledger/ledger').decodeEvent(b4a.from(o.olay, 'hex')))
    return L
  }
  const ekleDurum = (ad, onek, f, hata) => {
    const L = kur(onek)
    const e = f(L)
    durumlar.push({ ad, onek, olay: hex(encodeEvent(e)), hata })
  }
  const bozulmus = (e, fn) => { fn(e); return e }

  ekleDurum('kurucu olmadan GENESIS (başkası imzalar)', 0, () => {
    const e = genesis()
    e.sigs = []
    return require('../../ledger/ledger').signEvent(e, K.husniye)
  }, 'UNKNOWN_SIGNER')
  ekleDurum('imzasız GENESIS', 0, () => bozulmus(genesis(), (e) => { e.sigs = [] }), 'NO_SIGNATURE')
  ekleDurum('GENESIS olmadan ilk olay', 0, (L) => {
    const e = genesis()
    e.type = T.LEAVE
    return e
  }, 'GENESIS_ERROR')
  ekleDurum('ikinci GENESIS', 1, () => bozulmus(genesis(), (e) => { e.seq = 1 }), 'CHAIN_BROKEN')
  ekleDurum('yanlış prev', 1, (L) => bozulmus(ekle(L, K.husniye, 'ebeveyn', [K.kerem]), (e) => { e.prev = b4a.alloc(32, 9) }), 'CHAIN_BROKEN')
  ekleDurum('yanlış seq', 1, (L) => bozulmus(ekle(L, K.husniye, 'ebeveyn', [K.kerem]), (e) => { e.seq = 5 }), 'ORDER_ERROR')
  ekleDurum('imzadan sonra değişen ts', 1, (L) => bozulmus(ekle(L, K.husniye, 'ebeveyn', [K.kerem]), (e) => { e.ts += 1 }), 'INVALID_SIGNATURE')
  ekleDurum('yeni üyenin imzası yok', 1, (L) => bozulmus(ekle(L, K.husniye, 'ebeveyn', [K.kerem]), (e) => { e.sigs.pop() }), 'NO_NEW_MEMBER_APPROVAL')
  ekleDurum('eksik imza: n=2, tek ebeveyn yetişkin ekler', 2, (L) => ekle(L, K.irem, 'yetiskin', [K.kerem]), 'NO_QUORUM')
  ekleDurum('çocuk ekleme: bütün ebeveynler gerekir', 3, (L) => ekle(L, K.ecem, 'cocuk', [K.kerem, K.irem]), 'NO_PARENT_APPROVAL')
  ekleDurum('üçüncü ebeveyn', 3, (L) => ekle(L, K.u6, 'ebeveyn', [K.kerem, K.husniye]), 'PARENT_LIMIT')
  ekleDurum('kutunun imza denemesi', 5, (L) => ekle(L, K.u6, 'yetiskin', [K.kerem, K.husniye, K.kutu]), 'BOX_CANNOT_VOTE')
  ekleDurum('ikinci kutu', 5, (L) => ekle(L, K.kutu2, 'kutu', [K.kerem]), 'BOX_LIMIT')
  ekleDurum('kutu ebeveyn imzasız', 4, (L) => ekle(L, K.kutu, 'kutu', [K.irem]), 'NO_PARENT_SIGNATURE')
  ekleDurum('hedef kendini oylar', 4, (L) => at(L, K.irem, [K.kerem, K.husniye, K.irem]), 'TARGET_CANNOT_SELF_VOTE')
  ekleDurum('çift imza', 1, (L) => bozulmus(ekle(L, K.husniye, 'ebeveyn', [K.kerem]), (e) => { e.sigs.push(e.sigs[0]) }), 'DUPLICATE_SIGNATURE')
  ekleDurum('PREKEY başkası imzalar', 5, (L) => {
    const e = prekey(L, K.kerem, TS0 + 50_000)
    e.sigs = []
    return require('../../ledger/ledger').signEvent(e, K.husniye)
  }, 'PREKEY_SIGNATURE')
  ekleDurum('PREKEY iki imzacı', 5, (L) => {
    const e = prekey(L, K.kerem, TS0 + 50_000)
    return require('../../ledger/ledger').signEvent(e, K.husniye)
  }, 'PREKEY_SIGNER')
  ekleDurum('kutu PREKEY yayınlayamaz', 5, (L) => prekey(L, K.kutu, TS0 + 50_000), 'BOX_CANNOT_VOTE')
  ekleDurum('PREKEY eski tarihli', 6, (L) => prekey(L, K.kerem, TS0 + 9_000), 'PREKEY_STALE')
  ekleDurum('politika 8 üye sınırını aşamaz', 8, (L) => olay(L, T.POLICY, { policy: { ...DEFAULT_POLICY, maxMembers: 9 } }, [K.kerem, K.husniye]), 'INVALID_POLICY')
  ekleDurum('politika tek ebeveynle', 8, (L) => olay(L, T.POLICY, { policy: DEFAULT_POLICY }, [K.kerem, K.irem]), 'NO_PARENT_APPROVAL')
  ekleDurum('atılan üye imzalayamaz', 12, (L) => olay(L, T.PLAN, { storeReceiptJws: 'x', product: 'aile', expiresAt: 1 }, [K.kutu]), 'UNKNOWN_SIGNER')
  ekleDurum('atılan üye aynı anahtarla dönemez', 12, (L) => ekle(L, K.kutu, 'kutu', [K.kerem]), 'MEMBER_EXISTS')
  ekleDurum('uzaktan katılımda 24 saat bekleme', 3, (L) => ekle(L, K.ecem, 'cocuk', [K.kerem, K.husniye], { remote: true, activatesAt: L.events[L.len - 1].ts }), 'REMOTE_WAITING')
  ekleDurum('bilinmeyen olay türü', 1, (L) => bozulmus(ekle(L, K.husniye, 'ebeveyn', [K.kerem]), (e) => { e.type = 42 }), 'UNKNOWN_EVENT')
  // K15 / K16 (inceleme 2)
  ekleDurum('ACTIVATE yetişkin imzasıyla', 15, (L) => olay(L, T.ACTIVATE_MEMBER, { memberId: K.u6.memberId }, [K.u5]), 'NO_PARENT_SIGNATURE')
  ekleDurum('bekleyen üye imzalar', 15, (L) => olay(L, T.PLAN, { storeReceiptJws: 'x', product: 'aile', expiresAt: 1 }, [K.u6]), 'PENDING_MEMBER')
  ekleDurum('beklemeyen üyeye ACTIVATE', 16, (L) => olay(L, T.ACTIVATE_MEMBER, { memberId: K.u6.memberId }, [K.kerem]), 'NOT_WAITING')
  ekleDurum('ebeveyn değişiminde yetişkin çoğunluğu yok', 16, (L) => rotateH(L, K.u7, [K.kerem, K.u5]), 'NO_ADULT_APPROVAL')
  ekleDurum('ebeveyn değişimi beklerken ikincisi', 17, (L) => rotateH(L, K.u8, [K.kerem, K.u5, K.u6]), 'PENDING_CHANGE')
  return durumlar
}

function vektorler () {
  const { L, olaylar } = gecerliZincir()
  const gecerli = {
    aciklama: 'docs/04 §4 + KARARLAR K10–K17: geçerli Aile Defteri zinciri (sonunda uzaktan katılım + ACTIVATE_MEMBER, eski cihaz imzasız ebeveyn değişimi ve vetosu). olay = encodeEvent (compact-encoding), bas = her olaydan sonra eventHash. Kimlikler createIdentity({seed: "defter-vektor/<ad>"}).',
    olaylar,
    familyId: hex(L.familyId),
    bas: hex(L.head),
    uyeler: [...L.members.values()].map((m) => ({ memberId: hex(m.id), ad: m.name, rol: m.role, aktif: m.active }))
  }
  const gecersiz = {
    aciklama: 'docs/04 §4: her durumda ledger-valid.json zincirinin ilk `onek` olayı uygulanır; `olay` `hata` koduyla reddedilmeli.',
    durumlar: gecersizDurumlar()
  }
  return { gecerli, gecersiz }
}

module.exports = { vektorler, gecerliZincir }
