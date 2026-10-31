// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// capability.js — yetenek özeti, uygun işçi, seçim işlevi yol(is, sinif, girdi), görevin koleksiyonu ve "Dışarı sor"
// düğmesinin koşulu (RFC-0013 §5, §6.3, §6.4, §11 kural 3)
//
// Model çağırma platform kodundadır; burada yalnız kararın belirlenimci kısmı vardır. YzYetenek tele çıkmaz.
const b4a = require('b4a')
const { tokenTahmini } = require('./text')

function fail (code) { throw new Error(code) }
const hex = (b) => (typeof b === 'string' ? b : b4a.toString(b, 'hex'))

const ISLER = ['cikar', 'cevap', 'ozet', 'yaziya', 'gom', 'ara']
const SINIFLAR = ['kasa', 'aile', 'genel']
const PLATFORMLAR = ['apple-fm', 'gemini-nano']
const APPLE_BAGLAM = 4096
const APPLE_SINIR = 2800 // 4096'dan istem ve cevaba pay (§5.4)
const GEMINI_PAY = 1296
const YAZIYA_TELEFON_MS = 2 * 60_000
const GOM_TELEFON_PARCA = 200
const NO_ELIGIBLE_DEVICE = 'Bu iş için evde uygun cihaz yok.'

// §5.1. isletim: işletim sisteminin bildirdiği { id, surum, tr } ya da null; bildirim: geçerli model bildirimi
// (platform satırları); uye: { rol, paket, bulutAyar, kalan }.
function yetenekKur ({ isletim = null, bildirim = { platform: [] }, konusma = false, ocr = false, gomme = null, isciler = [], uye = {} } = {}) {
  let platform = null
  if (isletim) {
    if (!PLATFORMLAR.includes(isletim.id)) fail('INVALID_PLATFORM')
    const satir = (bildirim.platform || []).find((p) => p.id === isletim.id && p.surum === isletim.surum)
    // platform.tr: işletim sistemi tr diyor VE bildirimde o platform ve sürüm için tr = true
    const tr = !!isletim.tr && !!satir && satir.tr === true
    const baglamToken = isletim.id === 'apple-fm' ? APPLE_BAGLAM : (satir ? satir.baglamToken : 0)
    platform = { id: isletim.id, surum: isletim.surum, tr, baglamToken }
  }
  const bulutAcik = !!uye.paket && (uye.rol === 'ebeveyn' || uye.rol === 'yetiskin') && !!uye.bulutAyar
  return { platform, konusma: !!konusma, ocr: !!ocr, gomme, isciler, bulut: { acik: bulutAcik, kalan: bulutAcik ? (uye.kalan || 0) : 0 } }
}

// Telefondaki dil modelinin token sınırı: Apple 2800, Gemini Nano bildirimdeki baglamToken − 1296
function platformSiniri (platform) {
  if (!platform) return 0
  if (platform.id === 'apple-fm') return APPLE_SINIR
  return Math.max(0, platform.baglamToken - GEMINI_PAY)
}

// §5.3. yetenek.isciler RFC-0002 §8'deki sırayla verilir (gorev yerlestirme.adaylar); her öğe:
//   { deviceId, aday (§8 madde 1: son 15 dk, 'hazir', tür ve sürüm), modeller: [{ modelHash, kullanilir }], maxTaskRamMB, onay }
// girdi: { model: { modelHash, ramMB }, izin (TASK_PERMIT, RFC-0003 §5.11), koleksiyon: { taskAccess, sensitivity } }
function uygunIsciler (yetenek, girdi = {}) {
  const m = girdi.model
  const k = girdi.koleksiyon
  if (!m || !k || !girdi.izin) return [] // madde 4
  if (!k.taskAccess || k.sensitivity === 'kasa') return [] // madde 5
  return (yetenek.isciler || []).filter((w) =>
    w.aday === true && // madde 1
    (w.modeller || []).some((x) => hex(x.modelHash) === hex(m.modelHash) && x.kullanilir === true) && m.ramMB <= w.maxTaskRamMB && // madde 2
    w.onay === true // madde 3
  ).map((w) => w.deviceId)
}

// §5.4 seçim işlevi; ilk uyan satır geçerlidir. girdi: { metin | token, sure (ms), parcaSayisi, kasaAcik, + uygunIsciler girdisi }
// Dönüş: { yol: 'telefon' | 'isci' | 'kural' | null, satir, isci?, mod? ('karma' | 'anahtar'), hata? }
function yol (is, sinif, girdi = {}, yetenek) {
  if (!ISLER.includes(is)) fail('INVALID_JOB')
  if (!SINIFLAR.includes(sinif)) fail('INVALID_CLASS')
  const token = Number.isSafeInteger(girdi.token) ? girdi.token : tokenTahmini(girdi.metin || '')
  const p = yetenek.platform
  const telefonModeli = !!p && p.tr && token <= platformSiniri(p)
  const model = ['cikar', 'cevap', 'ozet'].includes(is)
  const r = (satir, y, ek = {}) => ({ yol: y, satir, ...ek })
  if (sinif === 'kasa') {
    if (model && telefonModeli) return r(1, 'telefon')
    if (is === 'cikar') return r(2, 'kural')
    if (is === 'ara' || is === 'gom') return girdi.kasaAcik ? r(3, 'telefon', is === 'ara' ? { mod: yetenek.gomme ? 'karma' : 'anahtar' } : {}) : r(3, null, { hata: 'VAULT_LOCKED' })
    if (is === 'yaziya' && yetenek.konusma) return r(4, 'telefon')
    return r(5, null, { hata: 'VAULT_NOT_POSSIBLE' })
  }
  if (is === 'ara') return r(6, 'telefon', { mod: yetenek.gomme ? 'karma' : 'anahtar' }) // gömme yoksa yalnız anahtar kelime
  if (is === 'yaziya' && yetenek.konusma && Number.isFinite(girdi.sure) && girdi.sure <= YAZIYA_TELEFON_MS) return r(7, 'telefon')
  if (is === 'gom' && yetenek.gomme && Number.isSafeInteger(girdi.parcaSayisi) && girdi.parcaSayisi <= GOM_TELEFON_PARCA) return r(8, 'telefon')
  if (model && telefonModeli) return r(9, 'telefon')
  const isciler = uygunIsciler(yetenek, girdi)
  if (isciler.length) return r(10, 'isci', { isci: isciler[0] })
  if (is === 'cikar') return r(11, 'kural')
  return r(12, null, { hata: 'NO_ELIGIBLE_DEVICE', mesaj: NO_ELIGIBLE_DEVICE })
}

// §6.4 madde 1 ve §11 kural 3: "Dışarı sor" yalnız bulut açıksa, sınıf genelse, süzgeç geçtiyse ve çocuk değilse
const disariGoster = (yetenek, { sinif, engel = [], rol }) =>
  rol !== 'cocuk' && !!yetenek.bulut?.acik && sinif === 'genel' && engel.length === 0

// §6.3: işçiye giden görevin koleksiyonu. parcalar: [{ collectionId, taskAccess, sensitivity, okuyucuSayisi }].
// Dönüş: { collectionId | null, giden: [parça], cikarilan: sayı }. Kaynak yoksa soru sahibinin Kişisel koleksiyonu,
// yalnız "Sorularım evdeki cihaza gidebilir" açıksa.
function gorevKoleksiyonu (parcalar, { kisisel = null, sorularIsciye = false } = {}) {
  if (!parcalar.length) return { collectionId: kisisel && sorularIsciye ? hex(kisisel) : null, giden: [], cikarilan: 0 }
  const giden = parcalar.filter((x) => x.taskAccess === true && x.sensitivity !== 'kasa')
  if (!giden.length) return { collectionId: null, giden, cikarilan: parcalar.length }
  const en = [...giden].sort((a, b) => a.okuyucuSayisi - b.okuyucuSayisi || b4a.compare(b4a.from(hex(a.collectionId), 'hex'), b4a.from(hex(b.collectionId), 'hex')))[0]
  return { collectionId: hex(en.collectionId), giden, cikarilan: parcalar.length - giden.length }
}

module.exports = {
  ISLER,
  SINIFLAR,
  APPLE_SINIR,
  GEMINI_PAY,
  NO_ELIGIBLE_DEVICE,
  yetenekKur,
  platformSiniri,
  uygunIsciler,
  yol,
  disariGoster,
  gorevKoleksiyonu
}
