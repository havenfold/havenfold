// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Adım 2: yetenek özeti, uygun işçi, yol(is, sinif, girdi) ve "Dışarı sor" (RFC-0013 §19 3). Beklenenler elle yazıldı.
const test = require('brittle')
const { yetenek: y } = require('..')

const MH = 'aa'.repeat(32)
const BILDIRIM = { platform: [{ id: 'apple-fm', surum: '26.1', tr: true, baglamToken: 4096 }, { id: 'gemini-nano', surum: '2', tr: true, baglamToken: 6000 }, { id: 'gemini-nano', surum: '1', tr: false, baglamToken: 4000 }] }
const ISCI = { deviceId: 'd1'.repeat(16), aday: true, modeller: [{ modelHash: MH, kullanilir: true }], maxTaskRamMB: 6000, onay: true }
const KOL = { taskAccess: true, sensitivity: 'normal' }
const ISGIRDI = { model: { modelHash: MH, ramMB: 4000 }, izin: true, koleksiyon: KOL }
const kb = (n) => 'a'.repeat(n * 1024)

test('yetenek özeti: platform.tr iki koşul ister', (t) => {
  t.is(y.yetenekKur({ isletim: { id: 'apple-fm', surum: '26.1', tr: true }, bildirim: BILDIRIM }).platform.tr, true)
  t.is(y.yetenekKur({ isletim: { id: 'apple-fm', surum: '26.1', tr: false }, bildirim: BILDIRIM }).platform.tr, false, 'işletim sistemi tr demiyor')
  t.is(y.yetenekKur({ isletim: { id: 'apple-fm', surum: '26.2', tr: true }, bildirim: BILDIRIM }).platform.tr, false, 'bildirimde sürüm yok')
  t.is(y.yetenekKur({ isletim: { id: 'gemini-nano', surum: '1', tr: true }, bildirim: BILDIRIM }).platform.tr, false, 'bildirimde tr = false')
  const g = y.yetenekKur({ isletim: { id: 'gemini-nano', surum: '2', tr: true }, bildirim: BILDIRIM })
  t.is(g.platform.baglamToken, 6000)
  t.is(y.platformSiniri(g.platform), 4704)
  t.is(y.platformSiniri(y.yetenekKur({ isletim: { id: 'apple-fm', surum: '26.1', tr: true }, bildirim: BILDIRIM }).platform), 2800)
  t.is(y.yetenekKur({ uye: { paket: true, rol: 'ebeveyn', bulutAyar: true, kalan: 9 } }).bulut.acik, true)
  t.is(y.yetenekKur({ uye: { paket: true, rol: 'cocuk', bulutAyar: true } }).bulut.acik, false)
  t.is(y.yetenekKur({ uye: { paket: false, rol: 'yetiskin', bulutAyar: true } }).bulut.acik, false)
})

test('vektör 3: yönlendirme', (t) => {
  const tr = y.yetenekKur({ isletim: { id: 'apple-fm', surum: '26.1', tr: true }, bildirim: BILDIRIM })
  const yok = y.yetenekKur({})
  const isciVar = y.yetenekKur({ isciler: [ISCI] })
  const onaysiz = y.yetenekKur({ isciler: [{ ...ISCI, onay: false }] })

  t.alike(y.yol('cikar', 'kasa', { metin: kb(1) }, tr), { yol: 'telefon', satir: 1 })
  t.alike(y.yol('ozet', 'kasa', { metin: kb(1) }, yok), { yol: null, satir: 5, hata: 'VAULT_NOT_POSSIBLE' })
  t.alike(y.yol('ozet', 'aile', { metin: kb(20), ...ISGIRDI }, isciVar), { yol: 'isci', satir: 10, isci: ISCI.deviceId })
  t.alike(y.yol('ozet', 'aile', { metin: kb(20), ...ISGIRDI }, onaysiz), { yol: null, satir: 12, hata: 'NO_ELIGIBLE_DEVICE', mesaj: 'Bu iş için evde uygun cihaz yok.' })
  t.alike(y.yol('cikar', 'aile', { metin: kb(1) }, yok), { yol: 'kural', satir: 11 })
  t.is(y.disariGoster(y.yetenekKur({ uye: { paket: true, rol: 'cocuk', bulutAyar: true } }), { sinif: 'genel', engel: [], rol: 'cocuk' }), false)

  // Diğer satırlar
  t.alike(y.yol('ozet', 'kasa', { metin: kb(20) }, tr), { yol: null, satir: 5, hata: 'VAULT_NOT_POSSIBLE' }, '20 KB telefon sınırını aşar; kasa işçiye gitmez')
  t.alike(y.yol('cikar', 'kasa', { metin: kb(20) }, isciVar), { yol: 'kural', satir: 2 })
  t.alike(y.yol('ara', 'kasa', { kasaAcik: true }, yok), { yol: 'telefon', satir: 3, mod: 'anahtar' })
  t.alike(y.yol('gom', 'kasa', { kasaAcik: false }, yok), { yol: null, satir: 3, hata: 'VAULT_LOCKED' })
  t.alike(y.yol('yaziya', 'kasa', {}, y.yetenekKur({ konusma: true })), { yol: 'telefon', satir: 4 })
  t.alike(y.yol('ara', 'aile', {}, y.yetenekKur({ gomme: { modelHash: MH, esik: 800 } })), { yol: 'telefon', satir: 6, mod: 'karma' })
  t.alike(y.yol('yaziya', 'aile', { sure: 120_000 }, y.yetenekKur({ konusma: true })), { yol: 'telefon', satir: 7 })
  t.alike(y.yol('yaziya', 'aile', { sure: 120_001 }, y.yetenekKur({ konusma: true })), { yol: null, satir: 12, hata: 'NO_ELIGIBLE_DEVICE', mesaj: 'Bu iş için evde uygun cihaz yok.' })
  t.alike(y.yol('gom', 'aile', { parcaSayisi: 200 }, y.yetenekKur({ gomme: { modelHash: MH, esik: 800 } })), { yol: 'telefon', satir: 8 })
  t.alike(y.yol('cevap', 'genel', { token: 2800 }, tr), { yol: 'telefon', satir: 9 })
  t.alike(y.yol('cevap', 'genel', { token: 2801 }, tr), { yol: null, satir: 12, hata: 'NO_ELIGIBLE_DEVICE', mesaj: 'Bu iş için evde uygun cihaz yok.' })
  t.exception(() => y.yol('uydur', 'aile', {}, yok), /INVALID_JOB/)
})

test('uygun işçi koşulları (§5.3)', (t) => {
  const ile = (w, g = {}) => y.uygunIsciler(y.yetenekKur({ isciler: [{ ...ISCI, ...w }] }), { ...ISGIRDI, ...g })
  t.alike(ile({}), [ISCI.deviceId])
  t.alike(ile({ aday: false }), [], 'madde 1')
  t.alike(ile({ modeller: [{ modelHash: MH, kullanilir: false }] }), [], 'madde 2: kullanılamaz')
  t.alike(ile({ maxTaskRamMB: 3999 }), [], 'madde 2: RAM')
  t.alike(ile({ onay: false }), [], 'madde 3')
  t.alike(ile({}, { izin: false }), [], 'madde 4')
  t.alike(ile({}, { koleksiyon: { taskAccess: false, sensitivity: 'normal' } }), [], 'madde 5')
  t.alike(ile({}, { koleksiyon: { taskAccess: true, sensitivity: 'kasa' } }), [], 'madde 5: kasa')
})

test('"Dışarı sor" ve görevin koleksiyonu', (t) => {
  const acik = y.yetenekKur({ uye: { paket: true, rol: 'yetiskin', bulutAyar: true } })
  t.is(y.disariGoster(acik, { sinif: 'genel', engel: [], rol: 'yetiskin' }), true)
  t.is(y.disariGoster(acik, { sinif: 'aile', engel: [], rol: 'yetiskin' }), false)
  t.is(y.disariGoster(acik, { sinif: 'genel', engel: ['telefon'], rol: 'yetiskin' }), false)
  const A = '02'.repeat(16)
  const B = '01'.repeat(16)
  const C = '00'.repeat(16)
  t.alike(y.gorevKoleksiyonu([
    { collectionId: A, taskAccess: true, sensitivity: 'normal', okuyucuSayisi: 2 },
    { collectionId: B, taskAccess: true, sensitivity: 'normal', okuyucuSayisi: 2 },
    { collectionId: C, taskAccess: false, sensitivity: 'normal', okuyucuSayisi: 1 }
  ]).collectionId, B, 'okuyucusu en az, eşitlikte bayt sırası; taskAccess kapalı olan çıkarılır')
  t.is(y.gorevKoleksiyonu([{ collectionId: C, taskAccess: false, sensitivity: 'normal', okuyucuSayisi: 1 }]).cikarilan, 1)
  t.is(y.gorevKoleksiyonu([], { kisisel: A }).collectionId, null, 'anahtar kapalıyken soru işçiye gitmez')
  t.is(y.gorevKoleksiyonu([], { kisisel: A, sorularIsciye: true }).collectionId, A)
})
