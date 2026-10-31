// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// protocol/vectors/task-v2.json üreticisi (RFC-0002 §15). Belirlenimci: sabit tohumlar, sabit zaman, Ed25519.
// Dosyayı yazmak için: node core/core/scripts/vector-gen.js
//
// Zincir ledger-v21.json ana zincirinin devamıdır (yardimci/task.js). Her denetim durumu: zincirin ilk `onek` olayı
// uygulanır, işçi kendi bildirimiyle (`yetenek`) kurulur, `gorulen` görevler sırayla verilir, sonra `gorev` denetlenir.
const b4a = require('b4a')
const K = require('../../encoding')
const { Isci } = require('../../audit')
const { belgeHatasi } = require('../../coordinator')
const { YetenekDefteri } = require('../../capability')
const { OnayDefteri } = require('../../approval')
const Y = require('../../placement')
const G = require('./task')

const { C, U, hex, SIMDI, DAY, ZINCIR, U5_SEQ, id16, id32, ZERO16, defter, caps, capsBayt, gorev, K_TUM_AILE, K_KASA, K_KISISEL_IREM } = G
const HOUR = 3_600_000

// Buffer'ları hex'e çevirir (okunur alanlar için)
function jsonla (v) {
  if (b4a.isBuffer(v)) return hex(v)
  if (Array.isArray(v)) return v.map(jsonla)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, jsonla(x)]))
  return v
}

const imzali = (bytes, signer, tag, familyId) => ({
  bayt: hex(bytes),
  imzaci: hex(signer.memberId),
  etiket: tag,
  ozet: hex(K.digestOf(tag, familyId, bytes.subarray(0, bytes.byteLength - 64)))
})

function kodlama (L) {
  const capsB = capsBayt(L, C.isci1)
  const taskB = K.encodeTask(L.familyId, gorev(L), U.kerem)
  const d = delegasyon(L)
  const dB = K.encodeDelegation(L.familyId, d, U.kerem)
  const subB = altGorev(L, K.decodeDelegation(dB).m, C.isci2)
  const cancelB = K.encodeCancel(L.familyId, { taskId: id16(0x51), by: U.kerem.memberId }, U.kerem)
  const result = { taskId: id16(0x51), status: 'ok', outputs: [], inline: b4a.from('Kira sözleşmesi, sayfa 1'), log: 'ocrmypdf 16.0' }
  return {
    node_caps: { alanlar: jsonla(caps(C.isci1)), ...imzali(capsB, C.isci1, K.ETIKET.NODE_CAPS, L.familyId) },
    task: { alanlar: jsonla(gorev(L)), ...imzali(taskB, U.kerem, K.ETIKET.TASK, L.familyId) },
    task_delegation: { alanlar: jsonla(d), ...imzali(dB, U.kerem, K.ETIKET.TASK_DELEGATION, L.familyId) },
    alt_gorev: { ...imzali(subB, C.isci1, K.ETIKET.TASK_SUB, L.familyId) },
    task_cancel: { ...imzali(cancelB, U.kerem, K.ETIKET.TASK_CANCEL, L.familyId) },
    task_accept: { alanlar: { taskId: hex(id16(0x51)), etaSec: 90 }, bayt: hex(K.encodeAccept({ taskId: id16(0x51), etaSec: 90 })) },
    task_reject: { alanlar: { taskId: hex(id16(0x51)), code: 'MESGUL' }, bayt: hex(K.encodeReject({ taskId: id16(0x51), code: 'MESGUL' })) },
    task_progress: { alanlar: { taskId: hex(id16(0x51)), pct: 62, note: 'sayfa 17' }, bayt: hex(K.encodeProgress({ taskId: id16(0x51), pct: 62, note: 'sayfa 17' })) },
    task_result: { alanlar: jsonla(result), bayt: hex(K.encodeResult(result)) }
  }
}

// Kerem'in belgesi: koordinatör isci1, işçiler isci1 + isci2, en çok 2 parça, 12 saat
function delegasyon (L, ek = {}) {
  return {
    taskId: id16(0x71),
    coordinatorId: C.isci1.memberId,
    workers: [C.isci1.memberId, C.isci2.memberId],
    types: ['hf.task.ocr'],
    collectionId: K_TUM_AILE,
    inputBlobIds: [id32(0x61)],
    maxParts: 2,
    expiresAt: SIMDI + 12 * HOUR,
    requester: U.kerem.memberId,
    ledgerSeq: L.len - 1,
    ...ek
  }
}

// Koordinatörün alt görevi (imza hf/task-sub/)
function altGorev (L, d, isci, ek = {}, imzaci = C.isci1) {
  return K.encodeTask(L.familyId, gorev(L, {
    taskId: id16(0x81),
    parentTaskId: d.taskId,
    workerId: isci.memberId,
    params: b4a.from('{"langs":["tur"],"pages":[28,40],"output":"text"}'),
    delegation: d,
    deadline: d.expiresAt, // alt görev belgenin süresini aşamaz (RFC-0019 §11.2 a)
    ...ek
  }), imzaci)
}

function denetimler (L) {
  const N = ZINCIR.length
  const out = []
  // isci: denetleyen işçi; yetenekEk: bildirimindeki değişiklik; gorulen: önce verilen görevler (bayt)
  const durum = (no, aciklama, bytes, beklenen, { isci = C.isci1, yetenekEk = {}, gorulen = [], from, onek = N, simdi = SIMDI } = {}) => {
    const LL = defter(onek)
    const yetenek = capsBayt(LL, isci, yetenekEk)
    out.push({
      no, aciklama, onek, simdi,
      isci: hex(isci.memberId),
      yetenek: hex(yetenek),
      // Oturumun karşı tarafı zorunlu (inceleme görev 7); verilmezse görevin isteyeni
      from: from === undefined ? hex(K.decodeTask(bytes).m.requester) : from,
      gorulen: gorulen.map(hex),
      gorev: hex(bytes),
      beklenen
    })
  }
  const t = (ek = {}, imz = U.kerem) => K.encodeTask(L.familyId, gorev(L, ek), imz)

  // §15 madde 2
  durum(2, 'Geçerli görev: ebeveyn, Tüm Aile, OCR 1.1.0 (işçide 1.2.0)', t(), 'kabul', { from: hex(U.kerem.memberId) })
  durum(2, 'Çocuk isteyen (hf.task.transcribe; çocuğa yalnız OCR açık)', t({ requester: U.ecem.memberId, type: 'hf.task.transcribe', version: '1.0.0' }, U.ecem), 'TUR_IZNI_YOK')
  durum(2, 'Çocuk isteyen, TASK_PERMIT ile açılmış OCR', t({ requester: U.ecem.memberId }, U.ecem), 'kabul')
  durum(2, 'Kasa koleksiyonu', t({ collectionId: K_KASA }), 'KOLEKSIYON_KAPALI')
  durum(2, 'Atılmış üye: ledgerSeq anında aktif, bugün değil', t({ requester: U.u5.memberId, ledgerSeq: U5_SEQ }, U.u5), 'YETKISIZ')
  durum(2, '8 günlük deadline', t({ deadline: SIMDI + 8 * DAY }), 'SURE_GECERSIZ')
  // Diğer denetimler
  durum(2, 'workerId başka işçi', t({ workerId: C.isci2.memberId }), 'YANLIS_ISCI')
  durum(2, 'İmza isteyenin değil', t({}, U.husniye), 'IMZA_GECERSIZ')
  durum(2, 'Doğrudan görev başka bir cihazdan gelir', t(), 'YETKISIZ', { from: hex(C.isci2.memberId) })
  durum(2, 'Misafir isteyen', t({ requester: C.misafir2.memberId }, C.misafir2), 'YETKISIZ')
  durum(2, 'Kutu yalnız yedek işi verir: OCR', t({ requester: U.kutu.memberId }, U.kutu), 'TUR_IZNI_YOK')
  durum(2, 'Kutu yedek işi verir (collectionId 16 sıfır)', t({ requester: U.kutu.memberId, type: 'hf.task.backup', version: '1.0.0', collectionId: ZERO16 }, U.kutu), 'kabul')
  durum(2, 'Yedekte collectionId sıfır değil', t({ type: 'hf.task.backup', version: '1.0.0' }), 'KOLEKSIYON_KAPALI')
  durum(2, 'Görev erişimi kapalı koleksiyon (kişisel)', t({ requester: U.irem.memberId, collectionId: K_KISISEL_IREM }, U.irem), 'KOLEKSIYON_KAPALI')
  durum(2, 'ledgerSeq işçinin defterinin ötesinde', t({ ledgerSeq: N }), 'DEFTER_GERIDE')
  durum(2, 'MAJOR farklı (2.0.0)', t({ version: '2.0.0' }), 'DESTEK_YOK')
  durum(2, 'MINOR büyük (1.3.0; işçide 1.2.0)', t({ version: '1.3.0' }), 'DESTEK_YOK')
  durum(2, 'limits.ramMB > maxTaskRamMB', t(), 'KAYNAK_YOK', { yetenekEk: { maxTaskRamMB: 1024 } })
  durum(2, 'İşçi meşgul', t(), 'MESGUL', { yetenekEk: { status: 'mesgul' } })
  durum(2, 'İşçi sıcak', t(), 'SICAK', { yetenekEk: { status: 'sicak' } })
  durum(2, 'İşçi pilde', t(), 'PIL', { yetenekEk: { status: 'pil' } })
  durum(2, 'deadline geçmiş', t({ deadline: SIMDI }), 'SURE_GECERSIZ')
  durum(2, 'Sürekli görev: yetişkin veremez', t({ requester: U.irem.memberId, type: 'hf.task.vision', version: '1.0.0', collectionId: G.K_OLAYLAR, standing: true, deadline: SIMDI + 20 * DAY }, U.irem), 'TUR_IZNI_YOK')
  durum(2, 'Sürekli görev: ebeveyn, 20 gün', t({ type: 'hf.task.vision', version: '1.0.0', collectionId: G.K_OLAYLAR, standing: true, deadline: SIMDI + 20 * DAY }), 'kabul')
  durum(2, 'Sürekli görev: 31 gün', t({ type: 'hf.task.vision', version: '1.0.0', collectionId: G.K_OLAYLAR, standing: true, deadline: SIMDI + 31 * DAY }), 'SURE_GECERSIZ')
  durum(2, 'Sürekli görev: işçinin bildiriminde standing kapalı tür', t({ standing: true, deadline: SIMDI + 20 * DAY }), 'DESTEK_YOK')
  durum(2, 'Aynı taskId ikinci kez', t(), 'TEKRAR', { gorulen: [t()] })

  // §15 madde 3: koordinatör
  const d = K.decodeDelegation(K.encodeDelegation(L.familyId, delegasyon(L), U.kerem)).m
  const coord = hex(C.isci1.memberId)
  const sub = (isci, ek, imz) => altGorev(L, d, isci, ek, imz)
  durum(3, 'Geçerli alt görev (isci1 → isci2)', sub(C.isci2), 'kabul', { isci: C.isci2, from: coord })
  durum(3, 'Belgede olmayan işçi (isci3)', sub(C.isci3), 'YETKISIZ', { isci: C.isci3, from: coord })
  durum(3, 'Alt görevin deadline\'ı belgenin süresini aşar', sub(C.isci2, { deadline: d.expiresAt + 3 * 60_000 }), 'YETKISIZ', { isci: C.isci2, from: coord })
  durum(3, 'Sürekli alt görev', sub(C.isci2, { standing: true }), 'YETKISIZ', { isci: C.isci2, from: coord })
  const eski = K.decodeDelegation(K.encodeDelegation(L.familyId, delegasyon(L, { expiresAt: SIMDI - 1 }), U.kerem)).m
  durum(3, 'Süresi geçmiş belge', altGorev(L, eski, C.isci2), 'YETKISIZ', { isci: C.isci2, from: coord })
  durum(3, 'maxParts aşımı: aynı ana görev için üçüncü ayrı alt görev', sub(C.isci2, { taskId: id16(0x83) }), 'YETKISIZ', {
    isci: C.isci2, from: coord, gorulen: [sub(C.isci2, { taskId: id16(0x81) }), sub(C.isci2, { taskId: id16(0x82) })]
  })
  durum(3, 'Belgede olmayan girdi', sub(C.isci2, { inputs: [{ blobId: id32(0x63), fileKey: id32(0x64), size: 10, mime: 'image/jpeg' }] }), 'YETKISIZ', { isci: C.isci2, from: coord })
  durum(3, 'Belgede olmayan tür', sub(C.isci2, { type: 'hf.task.transcribe', version: '1.0.0' }), 'YETKISIZ', { isci: C.isci2, from: coord })
  durum(3, 'Alt görevi koordinatör değil başka işçi imzalamış', sub(C.isci2, {}, C.isci3), 'IMZA_GECERSIZ', { isci: C.isci2, from: coord })
  durum(3, 'Alt görev koordinatörden başka bir oturumdan gelir', sub(C.isci2), 'YETKISIZ', { isci: C.isci2, from: hex(C.isci3.memberId) })
  durum(3, 'Belgenin imzası isteyenin değil', altGorev(L, { ...d, sig: K.decodeDelegation(K.encodeDelegation(L.familyId, delegasyon(L), U.husniye)).m.sig }, C.isci2), 'IMZA_GECERSIZ', { isci: C.isci2, from: coord })
  return out
}

// Koordinatörün ana görevle belgeyi karşılaştırması (§9)
function belgeler (L) {
  const ana = gorev(L, { taskId: id16(0x71) })
  const d = (ek) => K.encodeDelegation(L.familyId, delegasyon(L, ek), U.kerem)
  const durum = (aciklama, gorevEk, belge, beklenen) => ({
    aciklama, koordinator: hex(C.isci1.memberId), simdi: SIMDI, gorev: hex(K.encodeTask(L.familyId, { ...ana, ...gorevEk }, U.kerem)), belge: hex(belge), beklenen
  })
  return [
    durum('Belge ana görevle tutarlı', {}, d(), null),
    durum('Belgenin taskId başka', { taskId: id16(0x72) }, d(), 'YETKISIZ'),
    durum('Belgedeki girdiler ana görevinkinden farklı', {}, d({ inputBlobIds: [id32(0x61), id32(0x63)] }), 'YETKISIZ'),
    durum('Koordinatör belgedeki işçiler arasında değil', {}, d({ workers: [C.isci2.memberId] }), 'YETKISIZ'),
    durum('Belge 24 saatten uzun', {}, d({ expiresAt: SIMDI + 25 * HOUR }), 'YETKISIZ')
  ]
}

// §15 madde 4: aynı bildirimlerden aynı seçim
function yerlestirme (L) {
  const bildirim = [
    { ad: 'isci1', ek: { cores: 4, load1x100: 100 } },
    { ad: 'isci2', ek: { cores: 2, load1x100: 50 } }, // isci1 ile eşit oran: kimlik sırası
    { ad: 'isci3', ek: {}, once: 16 * 60_000 }, // 15 dakikadan eski: çevrimdışı
    { ad: 'isci4', ek: { tasks: [{ type: 'hf.task.ocr', version: '2.0.0', maxRamMB: 2048, standing: false, splittable: true }] } },
    { ad: 'isci5', ek: { maxTaskRamMB: 1024 } },
    { ad: 'isci6', ek: {} }, // onay yok
    { ad: 'isci7', ek: { status: 'mesgul' } },
    { ad: 'isci8', ek: { cores: 8, load1x100: 80, battery: null, tasks: [{ type: 'hf.task.ocr', version: '1.1.5', maxRamMB: 2048, standing: false, splittable: true }, { type: 'hf.task.backup', version: '1.0.0', maxRamMB: 256, standing: false, splittable: false }] } }
  ]
  const yetenekler = bildirim.map((b) => ({ ad: b.ad, bayt: hex(capsBayt(L, C[b.ad], b.ek)), alindi: SIMDI - (b.once || 60_000) }))
  yetenekler.push({ ad: 'kutu', bayt: hex(capsBayt(L, U.kutu, { class: 'kutu', cores: 2, load1x100: 10, tasks: [{ type: 'hf.task.backup', version: '1.0.0', maxRamMB: 256, standing: false, splittable: false }] })), alindi: SIMDI - 60_000 })
  const onaylar = ['isci1', 'isci2', 'isci3', 'isci4', 'isci5', 'isci7', 'isci8'].map((a) => hex(C[a].memberId)).concat(hex(U.kutu.memberId))

  const kur = () => {
    let saat = 0
    const defterY = new YetenekDefteri({ ledger: L, now: () => saat })
    for (const y of yetenekler) { saat = y.alindi; defterY.al(b4a.from(y.bayt, 'hex')) }
    const onay = new OnayDefteri(onaylar.map((c) => ({ uye: hex(U.kerem.memberId), cihaz: c, izin: true, at: 0 })))
    return { defterY, onay }
  }
  const istek = (type, version, ramMB, birim, bolunur) => {
    const { defterY, onay } = kur()
    const sirali = Y.adaylar(defterY, { type, version, ramMB, uye: U.kerem.memberId, onay, now: SIMDI })
    return {
      istek: { type, version, ramMB, birim, bolunur },
      adaylar: sirali.map((a) => a.id),
      parcalar: Y.planla(sirali, { birim, bolunur }).map((p) => ({ isci: p.isci, from: p.from, to: p.to }))
    }
  }
  return {
    simdi: SIMDI,
    uye: hex(U.kerem.memberId),
    yetenekler,
    onaylar,
    istekler: [
      istek('hf.task.ocr', '1.1.0', 2048, 40, true),
      istek('hf.task.ocr', '1.1.0', 2048, 1, false),
      istek('hf.task.backup', '1.0.0', 128, 1, false)
    ]
  }
}

// §15 madde 5
function bolme () {
  return [[40, [4, 2]], [7, [3, 3, 2]], [10, [1, 1, 1]], [2, [4, 2, 2]]].map(([birim, cekirdekler]) => ({ birim, cekirdekler, paylar: Y.bol(birim, cekirdekler) }))
}

function vektorler () {
  const L = defter()
  return {
    aciklama: 'RFC-0002 §15: görev katmanı. Zincir ledger-v21.json ana zincirinin (21 olay) devamıdır: U5 (yetişkin) eklenir, isci2…isci8 eklenir, misafir2 eklenir, U5 atılır. Kimlikler createIdentity({seed: "defter-vektor/<ad>"}) (üyeler) ve "ledger-v21/<ad>" (cihazlar, misafirler). İmza: sig = Ed25519(imzalayan, hash(etiket, familyId, body)); body = sig dışındaki alanlar, sig son 64 bayt. hash, kdf.js\'teki etiketli BLAKE2b-256 (önek "yuva/v2/").',
    zincir: ZINCIR,
    familyId: hex(L.familyId),
    kodlama: kodlama(L),
    denetimler: denetimler(L),
    belgeler: belgeler(L),
    yerlestirme: yerlestirme(L),
    bolme: bolme()
  }
}

// Vektör dosyasındaki bir denetim durumunu baştan çalıştırır (test ve üretici aynı yolu kullanır)
function denetimCalistir (dosya, d) {
  const L = defter(d.onek, dosya.zincir)
  const yetenek = K.decodeNodeCaps(b4a.from(d.yetenek, 'hex')).m
  const isci = new Isci({ ledger: L, me: { memberId: b4a.from(d.isci, 'hex') }, caps: yetenek, now: () => d.simdi })
  // Önce verilenler kabul edilir (maxParts yalnız kabul edilenleri sayar, RFC-0019 §11.2 b)
  for (const g of d.gorulen) isci.al(b4a.from(g, 'hex'), { from: d.from })
  const r = isci.denetle(b4a.from(d.gorev, 'hex'), { from: d.from })
  return r.ok ? 'kabul' : r.code
}

function belgeCalistir (dosya, b) {
  const L = defter(dosya.zincir.length, dosya.zincir)
  const task = K.decodeTask(b4a.from(b.gorev, 'hex')).m
  const d = K.decodeDelegation(b4a.from(b.belge, 'hex')).m
  return belgeHatasi(L, b4a.from(b.koordinator, 'hex'), task, d, b.simdi)
}

module.exports = { vektorler, denetimCalistir, belgeCalistir, jsonla, delegasyon, altGorev }
