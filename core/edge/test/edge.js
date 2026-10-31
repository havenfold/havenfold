// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// @havenfold/edge birim testleri (RFC-0008 adım 1–3): vektörlerin dışında kalan dallar ve yerleştirmeyle birleşim.
const test = require('brittle')
const b4a = require('b4a')
const V = require('../../core/test/helpers/v21')
const { ledger: { Ledger } } = require('@havenfold/core')
const { yerlestirme, yetenek: { YetenekDefteri }, kodlama: GK } = require('@havenfold/tasks')
const U = require('..')
const VK = require('./helpers/edge-vector')

const { kodlama: K, profil: P, yapilandirma: Y, durum: D, akis: A, cerceve: C } = U
const { hex } = V
const hata = (f) => { try { f(); return 'kabul' } catch (e) { return e.message } }
const ucHex = hex(V.C.uc1.memberId)
const isciHex = hex(V.C.isci1.memberId)

function anaDefter (n = 16) {
  const L = new Ledger()
  for (const f of V.anaAdimlar(L).slice(0, n)) L.apply(f())
  return L
}
const yapilandirma = (L, d = {}) => VK.yapilandirmaBayt(L, { ...VK.TEMEL_YAPILANDIRMA, ...d })

test('profil: seq yalnız büyür; çıkarılan cihazın profili yok sayılır; kutu üyesi imzalar; tanımsız imzacı reddedilir', (t) => {
  const L = anaDefter()
  const pd = new P.ProfilDefteri({ ledger: L })
  const p = VK.profilOf(VK.PROFILLER.windows)
  pd.al(P.profilKodla(L.familyId, p, V.C.isci1))
  t.is(pd.get(isciHex).runtime, 'windows-yerel')
  t.is(hata(() => pd.al(P.profilKodla(L.familyId, p, V.C.isci1))), 'STALE_MANIFEST')
  t.is(hata(() => pd.al(P.profilKodla(L.familyId, { ...p, nodeId: V.C.isci2.memberId }, V.C.isci2))), 'UNAUTHORIZED')
  const kutu = { ...VK.profilOf(VK.PROFILLER.linux), nodeId: V.K.kutu.memberId, runtime: 'android-kutu', sandbox: 'yok', features: [] }
  t.is(pd.al(P.profilKodla(L.familyId, kutu, V.K.kutu)).runtime, 'android-kutu')
  t.is(P.imzaciOf(L, hex(V.K.kerem.memberId)), null)
  // Uç çıkarılınca (ana zincirin 20. olayı) profili yok sayılır
  const L2 = anaDefter(20)
  const pd2 = new P.ProfilDefteri({ ledger: L })
  pd2.al(P.profilKodla(L.familyId, VK.profilOf(VK.PROFILLER.uc), V.C.uc1))
  pd2.ledger = L2
  t.is(pd2.get(ucHex), null)
})

test('profil: çalışma ortamı, uç modları ve özellik biçimi denetlenir', (t) => {
  const L = anaDefter()
  const p = VK.profilOf(VK.PROFILLER.windows)
  const kod = (x) => hata(() => P.profilKodla(L.familyId, { ...p, ...x }, V.C.isci1))
  t.is(kod({ runtime: 'freebsd' }), 'INVALID_MESSAGE')
  t.is(kod({ idlePolicy: 'bazen' }), 'INVALID_MESSAGE')
  t.is(kod({ ucModes: ['kamera'] }), 'INVALID_MESSAGE') // tepsi uç değildir
  t.is(kod({ runtime: 'ios-ekran', sandbox: 'yok', features: [], ucModes: ['kamera'] }), 'INVALID_MESSAGE') // iOS yalnız ekran (§11.11)
  t.is(kod({ runtime: 'ios-ekran', sandbox: 'yok', features: [], ucModes: ['ekran'] }), 'kabul')
  t.is(kod({ features: [{ type: 'ocr', features: ['metin'] }] }), 'INVALID_MESSAGE')
  t.is(kod({ features: [{ type: 'hf.task.ocr', features: ['metin', 'metin'] }] }), 'INVALID_MESSAGE')
  t.is(kod({ features: [{ type: 'hf.task.ocr', features: ['Metin'] }] }), 'INVALID_MESSAGE')
  t.is(kod({ features: [{ type: 'hf.task.ocr', features: [] }, { type: 'hf.task.ocr', features: [] }] }), 'INVALID_MESSAGE')
  t.is(kod({ ucModes: [] }), 'kabul')
  t.is(hata(() => P.profilCoz(b4a.alloc(10))), 'INVALID_MESSAGE')
  const b = P.profilKodla(L.familyId, p, V.C.isci1)
  t.is(hata(() => P.profilCoz(b4a.concat([b.subarray(0, b.byteLength - 64), b4a.from([0]), b.subarray(b.byteLength - 64)]))), 'INVALID_MESSAGE')
})

test('yerleştirme: RFC-0002 §8 adaylarına profil süzgeci (§5); profilsiz düğüm Linux sayılır', (t) => {
  const L = anaDefter()
  let now = V.TS0 + 3_600_000
  const yd = new YetenekDefteri({ ledger: L, now: () => now })
  const caps = (c, cores) => GK.encodeNodeCaps(L.familyId, {
    nodeId: c.memberId, class: 'isci', seq: 1, os: 'linux', arch: 'x64', cpuModel: 'x', cores, ramTotalMB: 8192, ramFreeMB: 4096,
    diskTotalGB: 100, diskFreeGB: 50, accel: [], battery: null, tempC: 40, uptimeSec: 1, load1x100: 0, tpm: false,
    tasks: [{ type: 'hf.task.ocr', version: '1.0.0', maxRamMB: 1024, standing: false, splittable: false }], maxTaskRamMB: 4096,
    storage: { holdGB: 0, blobGB: 0 }, status: 'hazir', running: []
  }, c)
  // isci1 tepsi (windows), isci2 profilsiz (Linux); isci2 defterde değil: ana zincire eklenir
  L.apply(V.cihazEkle(L, V.C.isci2, [V.K.kerem]))
  yd.al(caps(V.C.isci1, 4))
  yd.al(caps(V.C.isci2, 4))
  const pd = new P.ProfilDefteri({ ledger: L })
  pd.al(P.profilKodla(L.familyId, VK.profilOf(VK.PROFILLER.windows), V.C.isci1))
  const onay = { var: () => true }
  const ad = (params) => yerlestirme.adaylar(yd, { type: 'hf.task.ocr', version: '1.0.0', ramMB: 512, uye: 'x', onay, now, uygun: P.yerlestirmeSuzgeci(pd, 'hf.task.ocr', params) }).map((n) => n.id).sort()
  t.alike(ad({ output: 'pdf' }), [hex(V.C.isci2.memberId)])
  t.alike(ad({ output: 'metin' }), [isciHex, hex(V.C.isci2.memberId)].sort())
  // Süzgeç verilmezse eski davranış
  t.is(yerlestirme.adaylar(yd, { type: 'hf.task.ocr', version: '1.0.0', ramMB: 512, uye: 'x', onay, now }).length, 2)
  t.is(P.gerekenOzellik('hf.task.transcribe', {}), null)
  t.is(P.gerekenOzellik('hf.task.backup', {}), null)
  t.is(P.ozellikUyar(null, 'hf.task.vision', {}), true)
  // Kasa payı süzgeci (U8): temel kural ve profil kuralı birlikte
  const lp = new P.ProfilDefteri({ ledger: L })
  lp.al(P.profilKodla(L.familyId, { ...VK.profilOf(VK.PROFILLER.linux), seq: 5 }, V.C.isci1))
  const saglik = (id) => (id === isciHex ? { platform: { tpm: 'muhur-ok' } } : null)
  t.is(P.kasaPayiSuzgeci({ profiller: lp, saglik })(isciHex), true)
  t.is(P.kasaPayiSuzgeci({ profiller: lp, saglik, temel: () => false })(isciHex), false)
  t.is(P.kasaPayiSuzgeci({ profiller: lp, saglik })(hex(V.C.isci2.memberId)), false)
  now += 1
})

test('yapılandırma: tablo dışı biçim ve alan hataları', (t) => {
  const L = anaDefter()
  const d = (x) => hata(() => Y.yapilandirmaDenetle(L, yapilandirma(L, x), { ucHex }))
  t.is(d({ targets: ['herkes'] }), 'INVALID_BODY')
  t.is(d({ targets: ['device:isci1', 'device:isci1'] }), 'INVALID_BODY')
  t.is(d({ targets: ['device:' + 'ab'.repeat(16)] }), 'INVALID_TARGET') // defterde olmayan cihaz
  t.is(d({ targets: ['grant:misafir1'] }), 'INVALID_TARGET')
  t.is(d({ mode: 'uyku' }), 'INVALID_BODY')
  t.is(d({ mode: 'ekran', targets: [], screenFrom: ['rol:ebeveyn'] }), 'kabul')
  t.is(d({ mode: 'ekran', targets: [], screenFrom: ['rol:cocuk'] }), 'INVALID_TARGET')
  t.is(d({ mode: 'ekran', targets: [], screenFrom: ['device:isci1'] }), 'INVALID_BODY')
  t.is(d({ screenFrom: ['rol:ebeveyn'] }), 'INVALID_BODY') // ekran dışı modda kaynak
  t.is(d({ mode: 'sensor', targets: [], sensors: ['ivme', 'sicaklik'] }), 'INVALID_BODY')
  t.is(d({ mode: 'sensor', targets: [], sensors: ['ivme', 'ivme'] }), 'INVALID_BODY')
  t.is(d({ sensors: ['ivme'] }), 'INVALID_BODY') // sensör dışı modda sensör
  // Açıklama 2 madde 1: sensör modu hedef koleksiyon ister
  t.is(d({ mode: 'sensor', targets: [], sensors: ['ivme', 'isik'] }), 'INVALID_BODY')
  t.is(d({ mode: 'sensor', targets: ['koleksiyon:' + hex(V.K_OLAYLAR)], sensors: ['ivme', 'isik'] }), 'kabul')
  t.is(d({ windows: [{ days: 0, startMin: 0, endMin: 60 }] }), 'INVALID_BODY')
  t.is(d({ windows: [{ days: 128, startMin: 0, endMin: 60 }] }), 'INVALID_BODY')
  t.is(d({ windows: [{ days: 1, startMin: 1440, endMin: 60 }] }), 'INVALID_BODY')
  t.is(d({ windows: [{ days: 1, startMin: 60, endMin: 60 }] }), 'INVALID_BODY')
  t.is(d({ video: { maxWidth: 0, maxHeight: 720, fps: 10, kbps: 1000 } }), 'INVALID_BODY')
  t.is(d({ video: { maxWidth: 1920, maxHeight: 1080, fps: 15, kbps: 4000 } }), 'kabul')
  t.is(d({ video: { maxWidth: 1920, maxHeight: 1080, fps: 15, kbps: 4001 } }), 'INVALID_BODY')
  // Ebeveyn ledgerSeq anında henüz yoktu (Hüsniye 2. olayda eklendi)
  t.is(d({ imzaci: 'husniye', ledgerSeq: 1 }), 'UNAUTHORIZED')
  // İmza bozuk
  const b = b4a.from(yapilandirma(L))
  b[b.byteLength - 1] ^= 1
  t.is(hata(() => Y.yapilandirmaDenetle(L, b, { ucHex })), 'UNAUTHORIZED')
  t.is(Y.yeniKazanir(null, { m: { seq: 1 } }), true)
})

test('yapılandırma: değişince uyuşmayan akışlar kapanır', (t) => {
  const L = anaDefter()
  const m = Y.yapilandirmaDenetle(L, yapilandirma(L, { targets: ['device:isci1'] }), { ucHex }).m
  const akislar = [
    { streamId: 'a', id: isciHex, sinif: 'isci', rol: null, purpose: 'analiz' },
    { streamId: 'b', id: hex(V.K.kerem.memberId), sinif: 'uye', rol: 'ebeveyn', purpose: 'canli' }
  ]
  t.alike(Y.kapanacakAkislar(m, akislar), ['b'])
  t.alike(Y.kapanacakAkislar({ ...m, mode: 'kapali' }, akislar), ['a', 'b'])
})

test('durum: uç imzalar, yetişkinlere gider; seq ve gönderim kuralı; açık kameralar', (t) => {
  const L = anaDefter()
  const dd = new D.DurumDefteri({ ledger: L })
  const durum = (x = {}) => ({
    ucId: V.C.uc1.memberId, seq: 1, mode: 'kamera', camera: { active: true, streams: [{ toId: V.C.isci1.memberId, purpose: 'analiz' }], since: V.TS0 },
    battery: { percent: 80, tempC: 31, onAC: true }, thermal: 'normal', configSeq: 3, yenidenBasladi: false, ...x
  })
  const b = D.durumKodla(L.familyId, durum(), V.C.uc1)
  t.is(dd.al(b, { from: ucHex }).mode, 'kamera')
  t.is(hata(() => dd.al(b)), 'STALE_MANIFEST')
  t.is(hata(() => dd.al(b, { from: isciHex })), 'UNAUTHORIZED')
  t.is(hata(() => dd.al(D.durumKodla(L.familyId, durum({ ucId: V.C.isci1.memberId }), V.C.isci1))), 'UNAUTHORIZED') // işçi uç değil
  const bozuk = b4a.from(D.durumKodla(L.familyId, durum({ seq: 2 }), V.C.uc1))
  bozuk[bozuk.byteLength - 1] ^= 1
  t.is(hata(() => dd.al(bozuk)), 'INVALID_SIGNATURE')
  t.alike(dd.acikKameralar(), [{ ucId: ucHex, alicilar: [{ toId: isciHex, purpose: 'analiz' }], since: V.TS0 }])
  t.is(typeof dd.alinma(ucHex), 'number')
  t.is(dd.alinma(isciHex), null)
  t.is(dd.get(isciHex), null)
  t.alike(D.durumAlicilari(L), [hex(V.K.kerem.memberId), hex(V.K.husniye.memberId), hex(V.K.irem.memberId)].sort())
  // Biçim
  t.is(hata(() => D.durumKodla(L.familyId, durum({ thermal: 'ilik' }), V.C.uc1)), 'INVALID_MESSAGE')
  t.is(hata(() => D.durumKodla(L.familyId, durum({ camera: { active: false, streams: [{ toId: V.C.isci1.memberId, purpose: 'analiz' }], since: 0 } }), V.C.uc1)), 'INVALID_MESSAGE')
  t.is(hata(() => D.durumKodla(L.familyId, durum({ camera: { active: true, streams: [{ toId: V.C.isci1.memberId, purpose: 'kayit' }], since: 0 } }), V.C.uc1)), 'INVALID_MESSAGE')
  // Ne zaman gönderilir
  const a = durum()
  const now = V.TS0
  t.is(D.gondermeli(null, a, null, now), true)
  t.is(D.gondermeli(a, durum({ seq: 2 }), now, now + 60_000), false)
  t.is(D.gondermeli(a, durum({ camera: { active: false, streams: [], since: 0 } }), now, now + 60_000), true)
  t.is(D.gondermeli(a, durum({ camera: { active: true, streams: [{ toId: V.K.kerem.memberId, purpose: 'canli' }], since: 0 } }), now, now + 60_000), true)
  t.is(D.gondermeli(a, a, now, now + D.DURUM_ARALIK_MS), true)
  t.is(D.gondermeli(a, durum({ configSeq: 4 }), now, now + 60_000), true)
  t.is(D.gondermeli(a, durum({ camera: { active: false, streams: [], since: 0 }, yenidenBasladi: true }), now, now + 60_000), true)
  t.is(hata(() => D.durumKodla(L.familyId, durum({ yenidenBasladi: true }), V.C.uc1)), 'INVALID_MESSAGE')
  t.is(dd.get(ucHex).configSeq, 3)
})

test('akış: pencere, ısı ve pil, istek indirme, kabul ve kapatma biçimleri', (t) => {
  // Gece yarısını aşan pencere: Cuma 22:00 – Cumartesi 06:00
  const w = [{ days: 1 << 4, startMin: 1320, endMin: 360 }]
  t.is(A.penceredeMi(w, { gun: 4, dk: 1380 }), true)
  t.is(A.penceredeMi(w, { gun: 5, dk: 120 }), true)
  t.is(A.penceredeMi(w, { gun: 5, dk: 1380 }), false)
  t.is(A.penceredeMi(w, { gun: 3, dk: 1380 }), false)
  t.is(A.penceredeMi([], { gun: 0, dk: 0 }), true)
  t.is(A.isiPilKodu({ pil: { percent: 90, onAC: true, kritik: true } }), 'PIL')
  t.is(A.isiPilKodu({ thermal: 'kisildi', pil: { percent: 5, onAC: true } }), null)
  t.is(A.isiPilKodu({}), null)
  t.alike(A.istenenIndir({ width: 640, height: 480, fps: 5 }, K.VIDEO_VARSAYILAN), { width: 640, height: 480, fps: 5 })
  const kabul = A.kabulOf({ streamId: b4a.alloc(16, 1) }, { width: 1280, height: 720, fps: 10 }, { ssrc: 7 })
  t.alike(A.kabulCoz(A.kabulKodla(kabul)), { ...kabul, streamId: b4a.alloc(16, 1) })
  t.is(hata(() => A.kabulKodla({ ...kabul, codec: 'vp8' })), 'INVALID_MESSAGE')
  t.is(hata(() => A.kabulKodla({ ...kabul, ssrc: 2 ** 32 })), 'INVALID_MESSAGE')
  const kapat = { streamId: b4a.alloc(16, 1), code: 'YAPILANDIRMA_DEGISTI', by: V.C.uc1.memberId }
  t.alike(A.kapatCoz(A.kapatKodla(kapat)), kapat)
  t.is(hata(() => A.kapatKodla({ ...kapat, code: 'kucuk' })), 'INVALID_MESSAGE')
  t.is(hata(() => A.kapatCoz('x')), 'INVALID_MESSAGE')
  t.ok(A.KAPAT_KODLARI.includes('SURE_DOLDU'))
  t.is(A.AKIS_SURESI_MS, 86_400_000)
})

test('akış: başka uca açılan istek, kutunun isteği, defteri ileride olan istek ve bilinmeyen amaç reddedilir', (t) => {
  const L = anaDefter()
  const cfg = Y.yapilandirmaDenetle(L, yapilandirma(L), { ucHex }).m
  const u = { ucHex, cfg, oturum: 'dogrudan', yerel: { gun: 1, dk: 600 }, thermal: 'normal', pil: { percent: 80, onAC: true }, acikAkis: 0 }
  const ac = (signer, x = {}) => A.akisAcKodla(L.familyId, { streamId: b4a.alloc(16, 2), ucId: V.C.uc1.memberId, purpose: 'analiz', taskId: b4a.alloc(16, 3), want: { width: 1, height: 1, fps: 1 }, configSeq: 3, ledgerSeq: 15, ...x }, signer)
  t.is(A.akisAcDenetle(L, ac(V.C.isci1, { ucId: V.C.isci1.memberId }), u).code, 'IZIN_YOK')
  t.is(A.akisAcDenetle(L, ac(V.K.kutu, { purpose: 'canli', taskId: b4a.alloc(16) }), u).code, 'IZIN_YOK')
  t.is(A.akisAcDenetle(L, ac(V.C.isci1, { ledgerSeq: 99 }), u).code, 'IZIN_YOK')
  t.is(A.akisAcDenetle(L, ac(V.C.isci1), { ...u, cfg: null }).code, 'IZIN_YOK')
  t.is(A.akisAcDenetle(L, ac(V.C.isci1, { taskId: b4a.alloc(16) }), u).code, 'IZIN_YOK') // analizde taskId boş olamaz
  t.is(hata(() => ac(V.C.isci1, { purpose: 'kayit' })), 'INVALID_MESSAGE')
  t.is(A.isteyenOf(L, hex(V.C.misafir1.memberId)), null)
  // Üye hedefi uye:<id> ile
  const cfg2 = Y.yapilandirmaDenetle(L, yapilandirma(L, { targets: ['uye:irem'] }), { ucHex }).m
  t.is(A.akisAcDenetle(L, ac(V.K.irem, { purpose: 'canli', taskId: b4a.alloc(16) }), { ...u, cfg: cfg2 }).kabul, true)
})

test('çerçeve: sıra dışı gelen pencere içinde açılır; pencerenin gerisi ve başka ssrc açılmaz; 16 bit dönüşü tahmin edilir', (t) => {
  const pair = b4a.alloc(32, 9)
  const streamId = b4a.alloc(16, 8)
  const s = new C.AkisMuhurleyici({ pair, streamId, ssrc: 5 })
  const ac = new C.AkisAcici({ pair, streamId, ssrc: 5 })
  const f = []
  for (let i = 0; i < 70; i++) f.push(s.muhurle(b4a.from([i]), { ts: i }).cerceve)
  t.is(ac.ac(f[2]).yuk[0], 2)
  t.is(ac.ac(f[0]).yuk[0], 0) // geride ama pencerede
  t.is(hata(() => ac.ac(f[0])), 'REPLAY')
  t.is(ac.ac(f[69]).yuk[0], 69)
  t.is(hata(() => ac.ac(f[3])), 'REPLAY') // 66 geride: pencerenin dışı
  t.is(ac.ac(f[10]).yuk[0], 10)
  t.is(hata(() => new C.AkisAcici({ pair, streamId, ssrc: 6 }).ac(f[1])), 'FRAME_DECODE_FAILED')
  t.is(hata(() => ac.ac(b4a.alloc(5))), 'FRAME_TOO_SHORT')
  const surum = b4a.from(f[1]); surum[0] = (2 << 6) | (1 << 4)
  t.is(hata(() => ac.ac(surum)), 'FRAME_VERSION')
  const tip = b4a.from(f[1]); tip[0] = (1 << 6) | (3 << 4)
  t.is(hata(() => ac.ac(tip)), 'FRAME_TYPE')
  // Uç denetim izini mühürleyemez; denetim izi alıcıdan uca ayrı anahtar ve ssrc'yle gider (açıklama 1 madde 5)
  t.is(hata(() => s.muhurle(b4a.from('x'), { tip: C.TIP.DENETIM, ts: 0 })), 'FRAME_TYPE')
  const ters = new C.AkisMuhurleyici({ pair, streamId, ssrc: 5, yon: C.YON.ALICI })
  const tersAc = new C.AkisAcici({ pair, streamId, ssrc: 5, yon: C.YON.ALICI })
  const denetim = ters.muhurle(b4a.from('anahtar-kare'), { ts: 0 })
  t.is(tersAc.ac(denetim.cerceve).tip, C.TIP.DENETIM)
  t.is(hata(() => ac.ac(denetim.cerceve)), 'FRAME_TYPE') // görüntü açıcısı denetim izini açmaz
  t.is(hata(() => tersAc.ac(f[1])), 'FRAME_TYPE')
  t.is(C.tersSsrc(5), 0xfffffffa)
  t.not(b4a.toString(C.tersAnahtar(C.anahtarPayi(pair), streamId), 'hex'), b4a.toString(C.medyaAnahtari(C.anahtarPayi(pair), streamId), 'hex'))
  t.is(hata(() => new C.AkisMuhurleyici({ pair, streamId, ssrc: 5, yon: 'yan' })), 'INVALID_DIRECTION')
  // 16 bitlik seq dönüşü: sayaç 65540 başlıkta 4 olarak gider, alıcı en yüksek görülene göre çözer
  t.is(C.tahmin(65530, 4), 65540)
  t.is(C.tahmin(65540, 65530), 65530)
  t.is(C.tahmin(-1, 9), 9)
  const s2 = new C.AkisMuhurleyici({ pair, streamId, ssrc: 5 })
  s2.sayac = 2 ** 48
  t.is(hata(() => s2.muhurle(b4a.alloc(1), { ts: 0 })), 'COUNTER_EXHAUSTED')
  t.is(hata(() => new C.AkisAcici({ pair: { pair }, streamId, ssrc: 5 })), 'INVALID_PAIR')
  t.is(hata(() => new C.AkisMuhurleyici({ pair: b4a.alloc(16), streamId, ssrc: 5 })), 'INVALID_PAIR')
  s.kapat()
  ac.kapat()
  t.ok(b4a.equals(s.key, b4a.alloc(32)))
})

test('zarf: uç türleri numaralı; üye ↔ cihaz ve uç ↔ işçi oturumunda; profil ve akış yalnız doğrudan; hiçbiri Posta Kutusu\'ndan', (t) => {
  const { zarf: Z, giris } = require('@havenfold/core')
  t.alike([Z.Z.NODE_PROFILE, Z.Z.UC_CONFIG, Z.Z.UC_STREAM_OPEN, Z.Z.UC_STREAM_ACCEPT, Z.Z.UC_STREAM_CLOSE, Z.Z.UC_SCREEN_PUSH, Z.Z.UC_STATUS, Z.Z.APP_WIPE_REPORT], [0xe0, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7])
  t.ok(Z.typeAllowed('cihaz', 'uye', Z.Z.UC_CONFIG, 'gelen'))
  t.ok(Z.typeAllowed('cihaz', 'cihaz', Z.Z.UC_STREAM_OPEN, 'gelen'))
  t.ok(Z.typeAllowed('cihaz', 'cihaz', Z.Z.NODE_PROFILE, 'gelen'))
  t.absent(Z.typeAllowed('cihaz', 'cihaz', Z.Z.UC_CONFIG, 'gelen'))
  t.absent(Z.typeAllowed('misafir', 'uye', Z.Z.UC_STATUS, 'gelen'))
  const gel = (type, yol) => hata(() => giris.gelenZarf({ myRole: 'uye', peerRole: 'cihaz', type, bytes: b4a.alloc(1), yol }))
  t.is(gel(Z.Z.UC_STREAM_OPEN, 'emanet'), 'DIRECT_ONLY')
  t.is(gel(Z.Z.NODE_PROFILE, 'emanet'), 'DIRECT_ONLY')
  t.is(gel(Z.Z.UC_STATUS, 'emanet'), 'kabul')
  t.is(gel(Z.Z.UC_STATUS, 'posta'), 'MAILBOX_FORBIDDEN')
  t.is(gel(Z.Z.UC_CONFIG, 'posta'), 'MAILBOX_FORBIDDEN')
})

test('kodlama: imzalı mesajın kısa ve bozuk gövdesi', (t) => {
  t.is(hata(() => K.imzaliCoz(K.durumGovde, 'x')), 'INVALID_MESSAGE')
  t.is(hata(() => K.imzaliCoz(K.durumGovde, b4a.alloc(70))), 'INVALID_MESSAGE')
  t.is(K.imzaGecerli(K.ETIKET.UC_STATUS, b4a.alloc(32), b4a.alloc(1), b4a.alloc(10), b4a.alloc(32)), false)
  t.is(K.imzaGecerli(K.ETIKET.UC_STATUS, b4a.alloc(32), b4a.alloc(1), b4a.alloc(64), null), false)
})
