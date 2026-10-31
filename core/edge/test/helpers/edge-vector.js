// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// protocol/vectors/edge.json üreticisi (RFC-0008 §14 vektörleri 1–9). Belirlenimci: kimlikler ledger-v21 yardımcısının sabit
// tohumlu kimlikleri (core/core/test/yardimci/v21.js), defter zinciri dosyada hex. Her maddenin sonucu calistir() ile
// hesaplanır; test aynı işlevle dosyadaki girdilerden yeniden hesaplar.
const b4a = require('b4a')
const { ledger: { Ledger, encodeEvent, decodeEvent } } = require('@havenfold/core')
const V = require('../../../core/test/helpers/v21')
const P = require('../../profile')
const Y = require('../../config')
const A = require('../../stream')
const C = require('../../frame')
const S = require('../../erasure')
const Ek = require('../../screen')
const Uc = require('../../edge')
const K = require('../../encoding')

const { hex } = V
const h = (x) => b4a.from(x, 'hex')
const hata = (f) => { try { f(); return 'kabul' } catch (e) { return e.message } }
// Vektörlerdeki imzacılar: üyeler ve cihazlar ada göre
const KIM = { kerem: V.K.kerem, husniye: V.K.husniye, irem: V.K.irem, ecem: V.K.ecem, isci1: V.C.isci1, uc1: V.C.uc1, isci2: V.C.isci2, misafir2: V.C.misafir2 }

// Ana zincirin uç eklenene kadarki kısmı (isci1 işçi, uc1 uç; ikisi aktif)
function zincirOf () {
  const L = new Ledger()
  return V.anaAdimlar(L).slice(0, 16).map((f) => { const e = f(); L.apply(e); return hex(encodeEvent(e)) })
}
function defter (zincir) {
  const L = new Ledger()
  for (const x of zincir) L.apply(decodeEvent(h(x)))
  return L
}

// --- 1: NODE_PROFILE ----------------------------------------------------------------------------------------------

const profilOf = (g) => ({
  ...g, nodeId: KIM[g.imzaci].memberId, hostId: h(g.hostId), imzaci: undefined
})

const PROFILLER = {
  windows: {
    imzaci: 'isci1', hostId: hex(b4a.alloc(16, 0xa1)), seq: 1, runtime: 'windows-yerel', sandbox: 'appcontainer-job',
    features: [{ type: 'hf.task.ocr', features: ['metin'] }, { type: 'hf.task.transcribe', features: ['wav', 'opus'] }],
    sharedComputer: true, idlePolicy: 'bostayken', shareEligible: false, ucModes: [], appVersion: '1.0.0', versionCode: 100
  },
  uc: {
    imzaci: 'uc1', hostId: hex(b4a.alloc(16, 0xa2)), seq: 1, runtime: 'android-uc', sandbox: 'yok', features: [],
    sharedComputer: false, idlePolicy: 'her-zaman', shareEligible: false, ucModes: ['kamera', 'kapali'], appVersion: '1.0.0', versionCode: 100
  },
  // Kendi beyanında pay adayı diyen Linux düğümü (telefon beyana bakmaz)
  linux: {
    imzaci: 'isci1', hostId: hex(b4a.alloc(16, 0xa3)), seq: 2, runtime: 'linux-konteyner', sandbox: 'podman',
    features: [{ type: 'hf.task.ocr', features: ['metin', 'pdf'] }], sharedComputer: false, idlePolicy: 'her-zaman',
    shareEligible: true, ucModes: [], appVersion: '1.0.0', versionCode: 100
  }
}

function madde1 (g) {
  const L = defter(g.zincir)
  const out = {}
  for (const [ad, p] of Object.entries(g.profiller)) {
    const bytes = P.profilKodla(L.familyId, profilOf(p), KIM[p.imzaci])
    const bozuk = b4a.from(bytes)
    bozuk[bozuk.byteLength - 1] ^= 1
    out[ad] = {
      bytes: hex(bytes),
      dogrulama: hata(() => new P.ProfilDefteri({ ledger: L }).al(bytes, { from: hex(KIM[p.imzaci].memberId) })),
      bozukImza: hata(() => new P.ProfilDefteri({ ledger: L }).al(bozuk)),
      baskaOturum: hata(() => new P.ProfilDefteri({ ledger: L }).al(bytes, { from: hex(V.C.isci2.memberId) })),
      yanlisKumHavuzu: hata(() => P.profilKodla(L.familyId, { ...profilOf(p), sandbox: p.sandbox === 'yok' ? 'podman' : 'yok' }, KIM[p.imzaci]))
    }
  }
  return out
}

// --- 2: yerleştirme -----------------------------------------------------------------------------------------------

function madde2 (g) {
  const profil = (ad) => (ad === 'yok' ? null : P.profilCoz(h(madde1({ zincir: g.zincir, profiller: { [ad]: PROFILLER[ad] } })[ad].bytes)).m)
  return g.durumlar.map((d) => ({ aday: d.aday, type: d.type, params: d.params, gereken: P.gerekenOzellik(d.type, d.params), uygun: P.ozellikUyar(profil(d.aday), d.type, d.params) }))
}

// --- 3: kasa payı adaylığı ----------------------------------------------------------------------------------------

const madde3 = (g) => g.durumlar.map((d) => ({ ...d, aday: P.kasaPayiAdayi(d.runtime ? { runtime: d.runtime } : null, d.tpm ? { platform: { tpm: d.tpm } } : null) }))

// --- 4: UC_CONFIG -------------------------------------------------------------------------------------------------

const TEMEL_YAPILANDIRMA = {
  ucId: 'uc1', seq: 3, mode: 'kamera', targets: ['device:isci1', 'rol:ebeveyn'],
  video: { maxWidth: 1280, maxHeight: 720, fps: 10, kbps: 1000 }, windows: [{ days: 31, startMin: 480, endMin: 1080 }],
  sensors: [], screenFrom: [], ledgerSeq: 15, imzaci: 'kerem'
}
const hedefCoz = (t) => t.replace(/^(device|uye):([a-z0-9]+)$/, (_, s, ad) => s + ':' + (KIM[ad] ? hex(KIM[ad].memberId) : ad))
const yapilandirmaOf = (g) => ({
  ucId: KIM[g.ucId].memberId, seq: g.seq, mode: g.mode, targets: g.targets.map(hedefCoz), video: g.video, windows: g.windows,
  sensors: g.sensors, screenFrom: g.screenFrom.map(hedefCoz), ledgerSeq: g.ledgerSeq
})
const yapilandirmaBayt = (L, g) => Y.yapilandirmaKodla(L.familyId, yapilandirmaOf(g), KIM[g.imzaci])

function madde4 (g) {
  const L = defter(g.zincir)
  const ucHex = hex(V.C.uc1.memberId)
  const durumlar = g.durumlar.map((d) => {
    const cfg = { ...TEMEL_YAPILANDIRMA, ...d.degisim }
    let bytes
    try { bytes = yapilandirmaBayt(L, cfg) } catch (e) { return { ad: d.ad, sonuc: e.message } }
    return { ad: d.ad, bytes: hex(bytes), sonuc: hata(() => Y.yapilandirmaDenetle(L, bytes, { ucHex })) }
  })
  // Madde 7: eşit seq'li iki yapılandırma, iki geliş sırasında da aynı kazanan
  const a = Y.yapilandirmaDenetle(L, yapilandirmaBayt(L, { ...TEMEL_YAPILANDIRMA, seq: 5, imzaci: 'kerem' }), { ucHex })
  const b = Y.yapilandirmaDenetle(L, yapilandirmaBayt(L, { ...TEMEL_YAPILANDIRMA, seq: 5, imzaci: 'husniye', targets: ['device:isci1'] }), { ucHex })
  const c = Y.yapilandirmaDenetle(L, yapilandirmaBayt(L, { ...TEMEL_YAPILANDIRMA, seq: 4, imzaci: 'husniye' }), { ucHex })
  return {
    durumlar,
    birlesme: {
      ozetler: [hex(a.ozet), hex(b.ozet)],
      abSirasi: hex(Y.kazanan([a, b]).ozet),
      baSirasi: hex(Y.kazanan([b, a]).ozet),
      kucukSeqKaybeder: hex(Y.kazanan([a, c]).ozet) === hex(a.ozet) && hex(Y.kazanan([c, a]).ozet) === hex(a.ozet)
    }
  }
}

// --- 5: UC_STREAM_OPEN denetim tablosu ------------------------------------------------------------------------------

const TEMEL_ACMA = { streamId: hex(b4a.alloc(16, 0x5a)), isteyen: 'isci1', purpose: 'analiz', taskId: hex(b4a.alloc(16, 0x7a)), want: { width: 1920, height: 1080, fps: 30 }, configSeq: 3, ledgerSeq: 15 }
const TEMEL_UC = { oturum: 'dogrudan', yerel: { gun: 1, dk: 600 }, thermal: 'normal', pil: { percent: 80, onAC: true, kritik: false }, acikAkis: 0 }

function madde5 (g) {
  const L = defter(g.zincir)
  const ucHex = hex(V.C.uc1.memberId)
  const cfg = Y.yapilandirmaDenetle(L, yapilandirmaBayt(L, TEMEL_YAPILANDIRMA), { ucHex }).m
  return g.satirlar.map((s) => {
    const ac = { ...TEMEL_ACMA, ...s.acma }
    const u = { ...TEMEL_UC, ...s.uc, ucHex, cfg: s.mod ? { ...cfg, mode: s.mod } : cfg }
    let bytes = A.akisAcKodla(L.familyId, { streamId: h(ac.streamId), ucId: V.C.uc1.memberId, purpose: ac.purpose, taskId: h(ac.taskId), want: ac.want, configSeq: ac.configSeq, ledgerSeq: ac.ledgerSeq }, KIM[ac.isteyen])
    if (s.bozukImza) { bytes = b4a.from(bytes); bytes[bytes.byteLength - 1] ^= 1 }
    const r = A.akisAcDenetle(L, bytes, u)
    return { satir: s.satir, ad: s.ad, code: r.kabul ? 'kabul' : r.code, ...(r.kabul ? { want: r.want } : {}) }
  })
}

// --- 6: akış anahtarı ve çerçeve ----------------------------------------------------------------------------------

function madde6 (g) {
  const pair = h(g.pair)
  const streamId = h(g.streamId)
  const keyShare = C.anahtarPayi(pair)
  const mediaKey = C.medyaAnahtari(keyShare, streamId)
  const s = new C.AkisMuhurleyici({ pair, streamId, ssrc: g.ssrc })
  const { cerceve } = s.muhurle(h(g.yuk), { tip: C.TIP.GORUNTU, ts: g.ts, level: g.level })
  const ac = new C.AkisAcici({ pair, streamId, ssrc: g.ssrc })
  const bozuk = b4a.from(cerceve)
  bozuk[7] ^= 1 // başlıktaki ts
  return {
    keyShare: hex(keyShare),
    mediaKey: hex(mediaKey),
    nonce24: hex(C.nonce24(g.ssrc, 0, 0)),
    cerceve: hex(cerceve),
    acilan: hex(new C.AkisAcici({ pair, streamId, ssrc: g.ssrc }).ac(cerceve).yuk),
    bozukBaslik: hata(() => ac.ac(bozuk)),
    tekrar: (() => { const x = new C.AkisAcici({ pair, streamId, ssrc: g.ssrc }); x.ac(cerceve); return hata(() => x.ac(cerceve)) })()
  }
}

// --- 7: APP_WIPE_REPORT --------------------------------------------------------------------------------------------

const raporOf = (g) => ({ ...g, hostId: h(g.hostId), imzaci: undefined })

function madde7 (g) {
  const L = defter(g.zincir)
  const out = {}
  for (const [ad, r] of Object.entries(g.raporlar)) {
    const imzaci = KIM[r.imzaci]
    const kodla = () => S.silmeRaporuKodla(L.familyId, raporOf(r), imzaci)
    const sonuc = hata(kodla)
    if (sonuc !== 'kabul') { out[ad] = { kodlama: sonuc }; continue }
    const bytes = kodla()
    if (r.os === 'windows') {
      const { m } = S.silmeRaporuCoz(bytes)
      out[ad] = { bayt: hex(bytes), result: m.result, appWipeReportHash: hex(S.silmeRaporuOzeti(bytes)), dogrulama: hata(() => S.silmeRaporuDenetle(L, bytes)) }
      continue
    }
    const { m, hash } = S.silmeRaporuDenetle(L, bytes, { from: hex(imzaci.memberId) })
    const bozuk = b4a.from(bytes)
    bozuk[bozuk.byteLength - 1] ^= 1
    out[ad] = {
      bayt: hex(bytes),
      result: m.result,
      appWipeReportHash: hex(hash),
      bozukImza: hata(() => S.silmeRaporuDenetle(L, bozuk)),
      baskaGonderen: hata(() => S.silmeRaporuDenetle(L, bytes, { from: hex(KIM.kerem.memberId) }))
    }
  }
  // Beyan edilen result tablodan hesaplanandan farklıysa rapor geçersiz (cihaz "ok" diye yazamaz)
  const yalanci = K.imzaliKodla(K.silmeGovde, (x) => x, K.ETIKET.APP_WIPE_REPORT, L.familyId,
    { ...raporOf(g.raporlar.android), deviceId: KIM.uc1.memberId, kind: 'uygulama-verisi-silindi', items: [{ what: 'veri', method: 'dosya-silme', ok: false }], result: 'ok' },
    KIM.uc1.signKeyPair.secretKey)
  out.yalanciSonuc = hata(() => S.silmeRaporuDenetle(L, yalanci))
  return out
}

// --- 8: UC_SCREEN_PUSH --------------------------------------------------------------------------------------------

const ekranCfg = (g) => ({ mode: g.mode || 'ekran', screenFrom: (g.screenFrom || []).map(hedefCoz) })
// Uzun satır dosyada uzunluğuyla durur (satirBoyu): 33 KB'lık metin vektöre yazılmaz
const kartlarOf = (g) => g.cards.map(({ satirBoyu, ...x }) => ({ ...x, lines: satirBoyu ? ['x'.repeat(satirBoyu)] : x.lines || [] }))

function madde8 (g) {
  const L = defter(g.zincir)
  const ucHex = hex(KIM.uc1.memberId)
  const out = {}
  for (const d of g.durumlar) {
    const imzaci = KIM[d.gonderen]
    const m = { ucId: KIM.uc1.memberId, seq: d.seq || 1, cards: kartlarOf(d) }
    // Büyük zarf: üretici sınırı atlayarak imzalar (uç atmalı)
    const bytes = d.sinirsiz
      ? K.imzaliKodla(Ek.ekranGovde, (x) => x, Ek.ETIKET, L.familyId, { ...m, fromId: imzaci.memberId }, imzaci.signKeyPair.secretKey)
      : (() => { try { return Ek.ekranKodla(L.familyId, m, imzaci) } catch (e) { return e.message } })()
    if (typeof bytes === 'string') { out[d.ad] = { kodlama: bytes }; continue }
    if (d.bozukImza) bytes[bytes.byteLength - 1] ^= 1
    out[d.ad] = {
      boy: bytes.byteLength,
      ...(d.ad === 'gecerli' ? { bayt: hex(bytes) } : {}),
      sonuc: hata(() => Ek.ekranAlDenetle(L, bytes, { ucHex, cfg: ekranCfg({ ...g.yapilandirma, ...d.yapilandirma }), from: hex(imzaci.memberId) }))
    }
  }
  // Seq sırası ucun kalıcı durumunda (UcDurumu, bellek saklaması; yapılandırmayı Hüsniye imzalar)
  const m = new Map()
  const u = new Uc.UcDurumu({ defter: () => L, me: KIM.uc1, saklama: { get: (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), set: (k, v) => m.set(k, JSON.stringify(v)) }, now: () => 1791990000000 })
  u.yapilandirmaAl(yapilandirmaBayt(L, { ...TEMEL_YAPILANDIRMA, seq: 4, mode: 'ekran', targets: [], screenFrom: ['rol:ebeveyn'], imzaci: 'husniye' }))
  out.sira = g.sira.map((seq) => hata(() => u.ekranAl(Ek.ekranKodla(L.familyId, { ucId: KIM.uc1.memberId, seq, cards: [{ id: 'k', title: 'K', lines: [], until: 1792000000000 }] }, KIM.kerem))))
  return out
}

// --- 9: uç görev almaz ----------------------------------------------------------------------------------------------

function madde9 (g) {
  const G = require('@havenfold/tasks').kodlama
  const L = defter(g.zincir)
  const sifir = b4a.alloc(16)
  const task = G.encodeTask(L.familyId, {
    taskId: h(g.gorev.taskId), parentTaskId: sifir, workerId: KIM.uc1.memberId, type: g.gorev.type, version: g.gorev.version,
    requester: KIM.kerem.memberId, inputs: [], params: b4a.from(JSON.stringify(g.gorev.params)), collectionId: sifir,
    ledgerSeq: L.len - 1, deadline: g.gorev.deadline, limits: g.gorev.limits, standing: false, delegation: null
  }, KIM.kerem)
  const { m } = G.decodeTask(task)
  return { task: hex(task), taskReject: hex(G.encodeReject(Uc.gorevReddi(m.taskId))), code: Uc.GOREV_RED_KODU }
}

const CALISTIR = { 1: madde1, 2: madde2, 3: madde3, 4: madde4, 5: madde5, 6: madde6, 7: madde7, 8: madde8, 9: madde9 }
const calistir = (m) => CALISTIR[m.no](m.girdi)

// Android uç (emeklilik), Windows tepsi (dpapi), başarısız öğeli ve kalıntısı eksik Android raporu
const ANDROID_OGELERI = [
  { what: 'keystore-sarma-anahtari', method: 'anahtar-imha', ok: true },
  { what: 'veri-dizinleri', method: 'dosya-silme', ok: true },
  { what: 'uc-durumu', method: 'dosya-silme', ok: true }
]
const SILME_RAPORLARI = {
  android: {
    imzaci: 'uc1', hostId: hex(b4a.alloc(16, 0xa2)), trigger: 'emeklilik', os: 'android', osVersion: '14', appVersion: '1.0.0', keyStore: 'android-keystore',
    items: ANDROID_OGELERI, residue: ['fabrika-ayari-yapilmadi'], startedAt: 1792000000000, finishedAt: 1792000004000
  },
  // Tepsi (adım 8'in tepsi kısmı sonra): kodlama ve result kuralı; doğrulama yalnız uçta (inceleme L2 madde 6)
  windows: {
    imzaci: 'isci1', hostId: hex(b4a.alloc(16, 0xa1)), trigger: 'kaldirma', os: 'windows', osVersion: '10.0.22631', appVersion: '1.0.0', keyStore: 'dpapi',
    items: [{ what: 'dpapi-sarma-anahtari', method: 'anahtar-imha', ok: true }, { what: 'veri-dizinleri', method: 'dosya-silme', ok: true }],
    residue: ['sayfa-dosyasi', 'disk-sifresiz'], startedAt: 1792000000000, finishedAt: 1792000009000
  },
  // Keystore anahtarı yok edilmeden "silindi" denemez (L2 madde 1)
  androidAnahtarsiz: {
    imzaci: 'uc1', hostId: hex(b4a.alloc(16, 0xa2)), trigger: 'emeklilik', os: 'android', osVersion: '14', appVersion: '1.0.0', keyStore: 'android-keystore',
    items: [{ what: 'veri-dizinleri', method: 'dosya-silme', ok: true }], residue: ['fabrika-ayari-yapilmadi'], startedAt: 1792000000000, finishedAt: 1792000004000
  },
  // İşletim sistemi ile anahtar deposu uyuşmaz (L2 madde 6)
  androidDpapi: {
    imzaci: 'uc1', hostId: hex(b4a.alloc(16, 0xa2)), trigger: 'emeklilik', os: 'android', osVersion: '14', appVersion: '1.0.0', keyStore: 'dpapi',
    items: ANDROID_OGELERI, residue: ['fabrika-ayari-yapilmadi'], startedAt: 1792000000000, finishedAt: 1792000004000
  },
  androidHata: {
    imzaci: 'uc1', hostId: hex(b4a.alloc(16, 0xa2)), trigger: 'kaldirma', os: 'android', osVersion: '14', appVersion: '1.0.0', keyStore: 'strongbox',
    items: [ANDROID_OGELERI[0], { what: 'veri-dizinleri', method: 'dosya-silme', ok: false }], residue: ['fabrika-ayari-yapilmadi'], startedAt: 1792000000000, finishedAt: 1792000002000
  },
  androidKalintisiz: {
    imzaci: 'uc1', hostId: hex(b4a.alloc(16, 0xa2)), trigger: 'emeklilik', os: 'android', osVersion: '14', appVersion: '1.0.0', keyStore: 'android-keystore',
    items: ANDROID_OGELERI, residue: [], startedAt: 1792000000000, finishedAt: 1792000004000
  }
}

function vektorler () {
  const zincir = zincirOf()
  const maddeler = [
    { no: 1, aciklama: 'NODE_PROFILE kodlaması ve imzası (hashLP hf/node-profile/): tepsi işçisi, Android uç, Linux düğümü; bozuk imza, başka oturumdan gelen, kum havuzu çalışma ortamıyla uyuşmayan', girdi: { zincir, profiller: PROFILLER } },
    {
      no: 2,
      aciklama: 'Yerleştirme özellik denetimi (§5): tepsi işçisinde pdf çıktılı OCR ve audio/mp4 ses aday değil, metin OCR ve wav aday; profil göndermeyen cihaz Linux listesiyle; uç görev almaz',
      girdi: {
        zincir,
        durumlar: [
          { aday: 'windows', type: 'hf.task.ocr', params: { output: 'pdf' } },
          { aday: 'windows', type: 'hf.task.ocr', params: { output: 'metin' } },
          { aday: 'windows', type: 'hf.task.transcribe', params: { mime: 'audio/mp4' } },
          { aday: 'windows', type: 'hf.task.transcribe', params: { mime: 'audio/wav' } },
          { aday: 'windows', type: 'hf.task.llm', params: {} },
          { aday: 'yok', type: 'hf.task.ocr', params: { output: 'pdf' } },
          { aday: 'yok', type: 'hf.task.transcribe', params: { mime: 'audio/mp4' } },
          { aday: 'yok', type: 'hf.task.transcribe', params: { mime: 'audio/flac' } },
          { aday: 'uc', type: 'hf.task.backup', params: {} }
        ]
      }
    },
    {
      no: 3,
      aciklama: 'Kasa payı adaylığı (§10.1): yalnız linux-konteyner ve TPM mührü doğrulanmış; tepsi ve profil göndermeyen aday değil',
      girdi: { durumlar: [{ runtime: 'windows-yerel', tpm: 'muhur-ok' }, { runtime: 'linux-konteyner', tpm: 'muhur-ok' }, { runtime: 'linux-konteyner', tpm: 'var' }, { runtime: null, tpm: 'muhur-ok' }, { runtime: 'android-kutu', tpm: null }] }
    },
    {
      no: 4,
      aciklama: 'UC_CONFIG denetimi (§11.4, açıklama 2 madde 1): geçerli; yetişkin imzası YETKISIZ; device: hedefi uç INVALID_TARGET; rol:cocuk ve çocuk üye INVALID_TARGET; 30 kare/sn INVALID_BODY; sensör modunda alıcı hedefi INVALID_BODY; başka uca WRONG_EDGE; sensör hedefi olaylar koleksiyonu (hedefsiz INVALID_BODY, olaylar olmayan ya da okuyucuları bütün yetişkinleri kapsamayan INVALID_TARGET), kamerada koleksiyon hedefi INVALID_BODY; eşit seq iki geliş sırasında aynı kazanan',
      girdi: {
        zincir,
        durumlar: [
          { ad: 'gecerli', degisim: {} },
          { ad: 'yetiskin-imzasi', degisim: { imzaci: 'irem' } },
          { ad: 'hedef-uc', degisim: { targets: ['device:uc1'] } },
          { ad: 'rol-cocuk', degisim: { targets: ['rol:cocuk'] } },
          { ad: 'cocuk-uye', degisim: { targets: ['uye:ecem'] } },
          { ad: '30-kare', degisim: { video: { maxWidth: 1280, maxHeight: 720, fps: 30, kbps: 1000 } } },
          { ad: 'sensor-modunda-hedef', degisim: { mode: 'sensor', sensors: ['ivme'] } },
          { ad: 'baska-uc', degisim: { ucId: 'isci1' } },
          { ad: 'defter-geride', degisim: { ledgerSeq: 99 } },
          // Açıklama 2 madde 1: sensör hedefi olaylar koleksiyonu, okuyucuları evin bütün ebeveyn ve yetişkinleri
          { ad: 'sensor-olaylar-hedefi', degisim: { mode: 'sensor', sensors: ['ivme'], targets: ['koleksiyon:' + hex(V.K_OLAYLAR)] } },
          { ad: 'sensor-hedefsiz', degisim: { mode: 'sensor', sensors: ['ivme'], targets: [] } },
          { ad: 'sensor-genel-koleksiyon', degisim: { mode: 'sensor', sensors: ['ivme'], targets: ['koleksiyon:' + hex(V.K_TUM_AILE)] } },
          { ad: 'sensor-kasa-koleksiyonu', degisim: { mode: 'sensor', sensors: ['ivme'], targets: ['koleksiyon:' + hex(V.K_KASA)] } },
          { ad: 'kamerada-koleksiyon', degisim: { targets: ['koleksiyon:' + hex(V.K_OLAYLAR)] } }
        ]
      }
    },
    {
      no: 5,
      aciklama: 'UC_STREAM_OPEN denetim tablosu (§11.5): her satır için girdi → UC_STREAM_CLOSE kodu; kabulde istek video sınırlarına indirilir',
      girdi: {
        zincir,
        satirlar: [
          { satir: 0, ad: 'isci-analiz', acma: {}, uc: {} },
          { satir: 0, ad: 'ebeveyn-canli', acma: { isteyen: 'kerem', purpose: 'canli', taskId: hex(b4a.alloc(16)) }, uc: {} },
          { satir: 1, ad: 'bozuk-imza', acma: {}, uc: {}, bozukImza: true },
          { satir: 1, ad: 'cocuk-ister', acma: { isteyen: 'ecem', purpose: 'canli', taskId: hex(b4a.alloc(16)) }, uc: {} },
          { satir: 2, ad: 'mod-sensor', acma: {}, uc: {}, mod: 'sensor' },
          { satir: 3, ad: 'yetiskin-hedefte-degil', acma: { isteyen: 'irem', purpose: 'canli', taskId: hex(b4a.alloc(16)) }, uc: {} },
          { satir: 3, ad: 'isci-canli', acma: { purpose: 'canli', taskId: hex(b4a.alloc(16)) }, uc: {} },
          { satir: 4, ad: 'eski-yapilandirma', acma: { configSeq: 2 }, uc: {} },
          { satir: 5, ad: 'cumartesi', acma: {}, uc: { yerel: { gun: 5, dk: 600 } } },
          { satir: 5, ad: 'aksam', acma: {}, uc: { yerel: { gun: 1, dk: 1100 } } },
          { satir: 6, ad: 'kutu-rolesi', acma: {}, uc: { oturum: 'role' } },
          { satir: 7, ad: 'sicak', acma: {}, uc: { thermal: 'durdu' } },
          { satir: 7, ad: 'pil', acma: {}, uc: { pil: { percent: 20, onAC: false, kritik: false } } },
          { satir: 8, ad: 'mesgul', acma: {}, uc: { acikAkis: 2 } }
        ]
      }
    },
    {
      no: 6,
      aciklama: 'Akış anahtarı ve çerçeve (§11.5): keyShare = deriveLP(pair, hf/uc-stream/), mediaKey = derive(keyShare, media, streamId, 0), nonce24 = ssrc‖dönem‖sayaç‖12 sıfır, XChaCha20-Poly1305 çerçeve; başlığı değiştirilmiş çerçeve açılmaz; aynı çerçeve ikinci kez açılmaz',
      girdi: { pair: hex(b4a.alloc(32, 0x3c)), streamId: hex(b4a.alloc(16, 0x5a)), ssrc: 0x01020304, ts: 90000, level: 1, yuk: hex(b4a.from('000000016742c01e', 'hex')) }
    },
    {
      no: 7,
      aciklama: 'APP_WIPE_REPORT (§9.3): kodlama, imza (hashLP hf/app-wipe-report/), appWipeReportHash (hashLP hf/app-wipe-report-id/); result kuralı: Android anahtar deposu ok, dpapi dogrulanamadi, bir öğe başarısız hata, anahtar imhası yoksa hata; doğrulama yalnız uçta (tepsi YETKISIZ); bozuk imza, başka gönderen, Android raporunda fabrika ayarı kalıntısı eksik, işletim sistemiyle uyuşmayan anahtar deposu, beyan edilen result tablodan farklı',
      girdi: { zincir, raporlar: SILME_RAPORLARI }
    },
    {
      no: 8,
      aciklama: 'UC_SCREEN_PUSH (§11.8): imza (hashLP hf/uc-screen/); screenFrom dışından gelen atılır (SOURCE_NOT_ALLOWED); 33 KB atılır (TOO_LARGE, çözülmeden); 13 kart CARD_COUNT; bozuk imza; ekran modunda olmayan uç atar; uye: ile adlandırılan yetişkin kabul; çocuk (adıyla listede olsa da) SOURCE_NOT_ALLOWED; aileden olmayan YETKISIZ; seq sırası: aynı ya da küçük seq STALE_CARD, ms tabanlı büyük seq kabul',
      girdi: {
        zincir,
        yapilandirma: { screenFrom: ['rol:ebeveyn'] },
        durumlar: [
          { ad: 'gecerli', gonderen: 'kerem', cards: [{ id: 'ilac', title: 'Akşam ilacı', lines: ['20:00 · 1 tablet'], until: 1792000000000 }] },
          { ad: 'screenFrom-disi', gonderen: 'irem', cards: [{ id: 'not', title: 'Not', lines: [], until: 1792000000000 }] },
          { ad: 'uye-ile-izinli', gonderen: 'irem', yapilandirma: { screenFrom: ['rol:ebeveyn', 'uye:irem'] }, cards: [{ id: 'not', title: 'Not', lines: [], until: 1792000000000 }] },
          { ad: '33-kb', gonderen: 'kerem', sinirsiz: true, cards: [{ id: 'buyuk', title: 'Büyük', satirBoyu: 33 * 1024, until: 1792000000000 }] },
          { ad: '33-kb-uretici', gonderen: 'kerem', cards: [{ id: 'buyuk', title: 'Büyük', satirBoyu: 33 * 1024, until: 1792000000000 }] },
          { ad: '13-kart', gonderen: 'kerem', cards: Array.from({ length: 13 }, (_, i) => ({ id: 'k' + i, title: 'Kart', lines: [], until: 1792000000000 })) },
          { ad: 'bozuk-imza', gonderen: 'kerem', bozukImza: true, cards: [{ id: 'ilac', title: 'Akşam ilacı', lines: [], until: 1792000000000 }] },
          { ad: 'kamera-modu', gonderen: 'kerem', yapilandirma: { mode: 'kamera' }, cards: [{ id: 'ilac', title: 'Akşam ilacı', lines: [], until: 1792000000000 }] },
          // Çocuk adıyla screenFrom'da olsa da atılır; aileden olmayan (misafir kimliği) atılır
          { ad: 'cocuk', gonderen: 'ecem', yapilandirma: { screenFrom: ['rol:ebeveyn', 'uye:ecem'] }, cards: [{ id: 'not', title: 'Not', lines: [], until: 1792000000000 }] },
          { ad: 'misafir', gonderen: 'misafir2', cards: [{ id: 'not', title: 'Not', lines: [], until: 1792000000000 }] }
        ],
        // Ucun kalıcı seq tabanı (açıklama 1 madde 2, açıklama 2 madde 2): aynı zarf ikinci kez STALE_CARD, ms tabanlı yeni seq kabul
        sira: [1792000000000, 1792000000000, 1792000000500, 1792000000400]
      }
    },
    {
      no: 9,
      aciklama: 'Uç görev çalıştırmaz (§11.9): TASK gelirse TASK_REJECT { taskId, code: DESTEK_YOK }',
      girdi: { zincir, gorev: { taskId: hex(b4a.alloc(16, 0x9a)), type: 'hf.task.ocr', version: '1.0.0', deadline: 1792000000000, limits: { ramMB: 512, minutes: 5, diskMB: 64 }, params: { output: 'metin' } } }
    }
  ]
  return {
    rfc: 'RFC-0008 §14',
    etiketBicimi: 'hashLP/deriveLP (RFC-0027 §8 b)',
    aciklama: 'RFC-0008 §14 vektörleri 1–9 (adım 1–3, 8 ve 9). Defter zinciri ledger-v21 ana zincirinin ilk 16 olayı (isci1 işçi, uc1 uç aktif). İmzalar hashLP (RFC-0027 §8 b, D69).',
    maddeler: maddeler.map((m) => ({ ...m, beklenen: calistir(m) }))
  }
}

module.exports = { vektorler, calistir, defter, KIM, TEMEL_YAPILANDIRMA, yapilandirmaBayt, yapilandirmaOf, PROFILLER, profilOf }
