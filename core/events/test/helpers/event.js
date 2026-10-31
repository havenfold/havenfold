// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Olay testleri ve vektörleri için aile ve kayıt kurucu (RFC-0006 §17).
//
// Zincir ledger-v21.json ana zincirinin devamıdır: Ebeveynler koleksiyonu eklenir, Olaylar:Ev gerçek bir bırakma
// anahtarıyla güncellenir, isci2 (Olaylar'ın yazarı değil) eklenir. Kayıtlar tek işlemlidir: OpInner baytları ve
// sentetik bir opId (hash('hf/olay-vektor-op/', inner)); motor yalnız iç işlemi ve sıralama damgasını kullanır.
const b4a = require('b4a')
const sodium = require('sodium-native')
const { ledger: { Ledger, encodeEvent, decodeEvent }, kdf: { hash } } = require('@havenfold/core')
const { kodlama: { encodeInner, OP }, hlc: { fromMs }, appendRecordId, birlestir: { newRecordId } } = require('@havenfold/records')
const V = require('../../../core/test/helpers/v21')
const { Katalog } = require('../../type')

const { C, K: U, hex, koleksiyon, cihazEkle, anaAdimlar, K_OLAYLAR, K_TUM_AILE, VARLIK_KEDI, YER_EV } = V

const id16 = (n) => b4a.alloc(16, n)
const K_EBEVEYN = id16(0x36)
const T0 = 1_792_359_000_000 // 18 Ekim 2026 21:30 UTC (RFC-0006 §17 madde 3)
const MIN = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

// Belirlenimci bırakma anahtarı (yalnız test)
const DROP = { publicKey: b4a.alloc(32), secretKey: b4a.alloc(32) }
sodium.crypto_box_seed_keypair(DROP.publicKey, DROP.secretKey, hash('olay-vektor/drop'))

function adimlar (L) {
  return [
    ...anaAdimlar(L),
    () => koleksiyon(L, [U.kerem], { collectionId: K_EBEVEYN, name: 'Ebeveynler', readers: ['rol:ebeveyn'], writers: ['rol:ebeveyn'] }),
    () => koleksiyon(L, [U.husniye], { collectionId: K_OLAYLAR, name: 'Olaylar:Ev', kind: 'olaylar', readers: ['rol:ebeveyn', 'rol:yetiskin'], writers: ['rol:ebeveyn', 'rol:yetiskin', 'device:' + hex(C.isci1.memberId)], dropKey: DROP.publicKey }),
    () => cihazEkle(L, C.isci2, [U.kerem])
  ]
}

const ZINCIR = (() => {
  const L = new Ledger()
  return adimlar(L).map((f) => { const e = f(); L.apply(e); return hex(encodeEvent(e)) })
})()

function defter (olaylar = ZINCIR) {
  const L = new Ledger()
  for (const h of olaylar) L.apply(decodeEvent(b4a.from(h, 'hex')))
  return L
}

// Ürün türleri (Yuva Pati); çekirdek türleri katalogda
const URUN_TURLERI = [
  { tur: 'yuva.pet.beslenme', v: 1, olay: true, yazar: 'ikisi', ozne: ['varlik'], alanlar: [{ ad: 'miktar', deger: 'int', zorunlu: false, birim: 'g' }], kapsam: 'topluluk', keep: 90, ozel: false, ozet: 'yuva.pet.beslenme.ozet' },
  { tur: 'yuva.pet.litter.visit', v: 1, olay: true, yazar: 'cihaz', ozne: ['varlik'], alanlar: [{ ad: 'sure_sn', deger: 'int', zorunlu: false, birim: 'sn' }], kapsam: 'topluluk', keep: 90, ozel: false, ozet: 'yuva.pet.litter.visit.ozet' },
  { tur: 'yuva.pet.litter.urine', v: 1, olay: true, yazar: 'cihaz', ozne: ['varlik'], alanlar: [{ ad: 'ml', deger: 'int', zorunlu: false, birim: 'ml' }], kapsam: 'topluluk', keep: 90, ozel: false, ozet: 'yuva.pet.litter.urine.ozet' },
  { tur: 'yuva.defter.ilac', v: 1, olay: true, yazar: 'uye', ozne: ['uye'], alanlar: [], kapsam: 'topluluk', keep: 365, ozel: true, ozet: 'yuva.defter.ilac.ozet' }
]

// Var olan vektör dosyalarının (event.json, event-v2.json) üretim girdisi dondurulur: o dosyalarda Bakım Masası'nın ilaç
// türü eski adıyla (yuva.bakim.ilac) durur; testler ve yeni kod Yuva Defteri ad alanını kullanır (RFC-0029 §6, D77)
// Aynı nedenle Pati'nin mama türü o dosyalarda eski adıyla (yuva.pet.eat) durur; testler yuva.pet.beslenme (RFC-0032 §11, D81)
const ESKI_AD = { 'yuva.defter.ilac': 'yuva.bakim.ilac', 'yuva.pet.beslenme': 'yuva.pet.eat' }
const VEKTOR_URUN_TURLERI = URUN_TURLERI.map((t) => (ESKI_AD[t.tur] ? { ...t, tur: ESKI_AD[t.tur], ozet: t.ozet && t.ozet.replace(t.tur, ESKI_AD[t.tur]) } : t))

function katalog ({ vektor = false } = {}) {
  const k = new Katalog()
  for (const t of vektor ? VEKTOR_URUN_TURLERI : URUN_TURLERI) k.turKaydet(t)
  return k
}

const COKI = 'varlik:' + hex(VARLIK_KEDI)
const uye = (k) => 'uye:' + hex(k.memberId)
const cihaz = (k) => 'device:' + hex(k.memberId)

// Kayıt kurucu: cihaz yazarında append-event (recordId türetilir), üyede put. n: hlc sayacı (aynı ms'de sıra)
let sayac = 0
function kayit (L, yazar, tur, alanlar, hlcMs, { recordId = null, n = 0 } = {}) {
  const cihazMi = L.devices.has(hex(yazar.memberId))
  const hlc = fromMs(hlcMs) + BigInt(n)
  // Üyenin yeni kaydı: recordId = hash('hf/rec-new/', yazar, recNonce)[0..16] (RFC-0019 §11.1 c)
  const recNonce = !cihazMi && !recordId ? hash('olay-vektor/rid', tur, hlcMs, ++sayac).subarray(0, 16) : null
  const rid = recordId || (cihazMi ? appendRecordId(yazar.memberId, hlc) : newRecordId(yazar.memberId, recNonce))
  const inner = encodeInner({
    recNonce,
    recordId: rid,
    op: cihazMi ? OP.APPEND : OP.PUT,
    type: tur,
    fields: Object.entries(alanlar).map(([name, value]) => ({ name, value })),
    hlc,
    authorId: yazar.memberId,
    ledgerSeq: L.len - 1,
    ledgerHash: L.head
  })
  return { inner: hex(inner), opId: hex(hash('hf/olay-vektor-op/', inner)) }
}

const sifirla = () => { sayac = 0 }

module.exports = { ...V, U, id16, K_EBEVEYN, T0, MIN, HOUR, DAY, DROP, adimlar, ZINCIR, defter, URUN_TURLERI, VEKTOR_URUN_TURLERI, katalog, COKI, uye, cihaz, kayit, sifirla, K_OLAYLAR, K_TUM_AILE, YER_EV }
