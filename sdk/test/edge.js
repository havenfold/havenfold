// SPDX-License-Identifier: Apache-2.0
// RFC-0008 §13 SDK yüzü (340–344) ve açıklama 1: üye telefonu (CameraApi) ile uç (EdgeDevice) arasında yapılandırma, canlı
// izleme, görünür izleme kapısı, kalıcı seq'ler, akış ömrü ve ters yön; çift sırrı iki tarafta defterden (PairBook) aynı çıkar.
const test = require('brittle')
const b4a = require('b4a')
const { ledger: { Ledger }, pairs: { PairBook } } = require('@havenfold/core')
const V = require('../../core/core/test/helpers/v21')
const S = require('..')
const { profil: P } = require('@havenfold/edge')

const { hex } = V
const hata = (f) => { try { f(); return 'kabul' } catch (e) { return e.message } }
const ucHex = hex(V.C.uc1.memberId)
const kerem = hex(V.K.kerem.memberId)
const cift = (L, me) => (peer) => new PairBook({ me, ledger: L }).get(peer)?.pair || null
const bellek = () => { const m = new Map(); return { get: (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), set: (k, v) => m.set(k, JSON.stringify(v)) } }

function kur () {
  const L = new Ledger()
  for (const f of V.anaAdimlar(L).slice(0, 16)) L.apply(f())
  let now = V.TS0 + 3_600_000
  const saat = () => now
  const saklama = bellek()
  const telefon = new S.CameraApi({ defter: new S.LedgerApi({ ledger: L, me: V.K.kerem, now: saat }), ciftSirri: cift(L, V.K.kerem), now: saat })
  const ucKur = () => new S.EdgeDevice({ ledger: L, me: V.C.uc1, ciftSirri: cift(L, V.C.uc1), saklama, now: saat })
  return { L, telefon, uc: ucKur(), ucKur, ilerlet: (ms) => { now += ms } }
}
const KOSUL = { oturum: 'dogrudan', yerel: { gun: 1, dk: 600 }, thermal: 'normal', pil: { percent: 80, onAC: true } }

test('kamera: yapılandır → uç kabul eder → durum yayınlanır → canlı izle → kareler açılır → anahtar kare isteği ters yönde → kapat', (t) => {
  const { L, telefon, uc } = kur()
  t.alike(telefon.edges().map((x) => x.ucId), [ucHex])
  const { bytes, seq } = telefon.configure(ucHex, { mode: 'kamera', targets: ['rol:ebeveyn'] })
  t.is(seq, 1)
  const y = uc.receiveConfig(kerem, bytes, 'emanet')
  t.alike([y.kabul, y.kapat], [true, []])
  // Yapılandırma uygulandı: UC_STATUS.configSeq (açıklama 1 madde 3)
  t.is(telefon.receiveStatus(ucHex, y.durum.bytes, 'emanet').configSeq, 1)
  t.is(uc.mode, 'kamera')
  t.alike(uc.receiveConfig(kerem, bytes, 'dogrudan'), { kabul: false, kapat: [], durum: null })

  const istek = telefon.watch(ucHex, { want: { width: 1920, height: 1080, fps: 30 } })
  const r = uc.receiveStreamRequest(kerem, istek.bytes, 'dogrudan', KOSUL)
  t.ok(r.kabul, 'kabul')
  // Kabul durumu da döner; alıcılar ebeveyn ve yetişkinler; durum kamera açık ve izleyeni gösterir
  t.alike(r.durum.alicilar, [kerem, hex(V.K.husniye.memberId), hex(V.K.irem.memberId)].sort())
  const s = telefon.receiveStatus(ucHex, r.durum.bytes, 'dogrudan')
  t.alike([s.kameraAcik, s.alicilar, s.cevrimici, s.yenidenBasladi], [true, [{ toId: kerem, purpose: 'canli' }], true, false])
  const izleme = telefon.receiveAccept(ucHex, r.kabul, 'dogrudan')
  t.alike([izleme.codec, izleme.width, izleme.height, izleme.fps], ['h264', 1280, 720, 10])
  t.ok(b4a.equals(telefon.cift(ucHex), uc.cift(kerem)))
  const kare = b4a.from('000000016742c01e', 'hex')
  t.alike(izleme.ac(r.muhurle(kare, { ts: 1 })).yuk, kare)
  // Ters yön: alıcının anahtar kare isteği ayrı anahtarla
  const istekKaresi = izleme.denetimMuhurle(b4a.from('anahtar-kare'), { ts: 2 })
  t.alike(b4a.toString(r.denetimAc(istekKaresi).yuk), 'anahtar-kare')
  t.is(hata(() => r.denetimAc(r.muhurle(kare, { ts: 3 }))), 'FRAME_TYPE')
  t.alike(telefon.openCameras().map((x) => x.ucId), [ucHex])

  // İzleyen kapatır; uç yeni durum yayınlar
  const kapat = telefon.stopWatching(istek.streamId)
  const k = uc.receiveClose(kerem, kapat, 'dogrudan')
  t.alike([k.streamId, k.code], [istek.streamId, 'BITTI'])
  t.is(telefon.receiveStatus(ucHex, k.durum.bytes, 'dogrudan').kameraAcik, false)
  t.is(hata(() => r.muhurle(kare, { ts: 4 })), 'STATUS_NOT_PUBLISHED')
  t.is(L.len, 16)
})

test('U2: güncel durum üretilmeden kare yok; ikinci akış öncekini de bekletir', (t) => {
  const { telefon, uc } = kur()
  uc.receiveConfig(kerem, telefon.configure(ucHex, { mode: 'kamera', targets: ['rol:ebeveyn'] }).bytes, 'dogrudan')
  const a = uc.receiveStreamRequest(kerem, telefon.watch(ucHex).bytes, 'dogrudan', KOSUL)
  t.ok(a.muhurle(b4a.alloc(4), { ts: 0 }))
  const b = uc.receiveStreamRequest(kerem, telefon.watch(ucHex).bytes, 'dogrudan', KOSUL)
  t.ok(b.kabul)
  // Kabul durumu üretti: ikisi de güncel
  t.ok(a.muhurle(b4a.alloc(4), { ts: 1 }))
  // Uç bir akışı kapatınca durum dönen kapatma ile yeniden üretilir
  const k = uc.closeStream(b.streamId, 'SICAK')
  t.ok(k.durum.bytes.byteLength > 64)
  t.ok(a.muhurle(b4a.alloc(4), { ts: 2 }))
})

test('U1: uç yeniden başlayınca seq\'ler kaldığı yerden; yapılandırma geri yüklenir; ebeveyn seq\'i ucun durumundan öğrenir (U3)', (t) => {
  const { L, telefon, uc, ucKur } = kur()
  const y = uc.receiveConfig(kerem, telefon.configure(ucHex, { mode: 'kamera', targets: ['rol:ebeveyn'] }).bytes, 'dogrudan')
  telefon.receiveStatus(ucHex, y.durum.bytes, 'dogrudan')
  const p1 = new P.ProfilDefteri({ ledger: L }).al(uc.become({ hostId: hex(b4a.alloc(16, 1)), appVersion: '1.0.0', versionCode: 1 }))
  t.is(p1.seq, 1)
  // Yeniden başlama: aynı saklama
  const uc2 = ucKur()
  t.is(uc2.mode, 'kamera')
  const d = uc2.buildStatus(KOSUL)
  t.not(hata(() => telefon.receiveStatus(ucHex, d.bytes, 'dogrudan')), 'STALE_MANIFEST')
  t.is(telefon.status(ucHex).configSeq, 1)
  t.is(new P.ProfilDefteri({ ledger: L }).al(uc2.become({ hostId: hex(b4a.alloc(16, 1)), appVersion: '1.0.0', versionCode: 1 })).seq, 2)
  // Başka telefon (seq bilmeyen Hüsniye) ucun durumundan öğrenip bir fazlasıyla yazar
  const husniye = new S.CameraApi({ defter: new S.LedgerApi({ ledger: L, me: V.K.husniye }), ciftSirri: cift(L, V.K.husniye) })
  husniye.receiveStatus(ucHex, uc2.buildStatus(KOSUL).bytes, 'emanet')
  t.is(husniye.configure(ucHex, { mode: 'kamera', targets: ['rol:ebeveyn'] }).seq, 2)
  // İzleyen (seq bilmeyen İrem) izleme isteğinde ucun bildirdiği configSeq'i kullanır
  const irem = new S.CameraApi({ defter: new S.LedgerApi({ ledger: L, me: V.K.irem }), ciftSirri: cift(L, V.K.irem) })
  t.is(hata(() => irem.watch(ucHex)), 'NO_CONFIG')
  irem.receiveStatus(ucHex, uc2.buildStatus(KOSUL).bytes, 'emanet')
  t.ok(irem.watch(ucHex).bytes)
})

test('U4: akış ömrü — pencere bitince ve 24 saat dolunca kapanır; değişmeyince durum yok; emanetle ve rölede akış açılmaz', (t) => {
  const { telefon, uc, ilerlet } = kur()
  uc.receiveConfig(kerem, telefon.configure(ucHex, { mode: 'kamera', targets: ['rol:ebeveyn'], windows: [{ days: 127, startMin: 480, endMin: 1080 }] }).bytes, 'dogrudan')
  const a = telefon.watch(ucHex)
  const r = uc.receiveStreamRequest(kerem, a.bytes, 'dogrudan', KOSUL)
  telefon.receiveAccept(ucHex, r.kabul, 'dogrudan')
  t.alike(uc.check(KOSUL), { kapat: [], durum: null })
  const p = uc.check({ ...KOSUL, yerel: { gun: 1, dk: 1100 } })
  t.is(p.kapat.length, 1)
  t.alike(telefon.receiveClose(ucHex, p.kapat[0], 'dogrudan'), { streamId: a.streamId, code: 'PENCERE_DISI' })
  t.ok(p.durum)
  // Emanetten gelen akış isteği girişte atılır; kutu rölesi ROLE_YASAK
  const c = telefon.watch(ucHex)
  t.is(hata(() => uc.receiveStreamRequest(kerem, c.bytes, 'emanet', KOSUL)), 'DIRECT_ONLY')
  t.is(uc.receiveStreamRequest(kerem, c.bytes, 'dogrudan', { ...KOSUL, oturum: 'role' }).code, 'ROLE_YASAK')
  const d = telefon.watch(ucHex)
  t.ok(uc.receiveStreamRequest(kerem, d.bytes, 'dogrudan', KOSUL).kabul)
  ilerlet(24 * 3_600_000)
  const dolan = uc.check(KOSUL)
  t.is(telefon.receiveClose(ucHex, dolan.kapat[0], 'dogrudan').code, 'SURE_DOLDU')
  // Yeni yapılandırma uyuşmayan akışı kapatır
  const e = telefon.watch(ucHex)
  telefon.receiveAccept(ucHex, uc.receiveStreamRequest(kerem, e.bytes, 'dogrudan', KOSUL).kabul, 'dogrudan')
  const y = uc.receiveConfig(kerem, telefon.configure(ucHex, { mode: 'kamera', targets: ['device:' + hex(V.C.isci1.memberId)] }).bytes, 'dogrudan')
  t.is(telefon.receiveClose(ucHex, y.kapat[0], 'dogrudan').code, 'YAPILANDIRMA_DEGISTI')
  // Durum eskiyse çevrimdışı
  telefon.receiveStatus(ucHex, uc.buildStatus({ ...KOSUL, pil: { percent: 50, onAC: false } }).bytes, 'emanet')
  ilerlet(21 * 60_000)
  t.is(telefon.status(ucHex).cevrimici, false)
  // yenidenBasladi (§11.2) durumda görünür
  t.is(telefon.receiveStatus(ucHex, uc.restarted(true).bytes, 'dogrudan').yenidenBasladi, true)
})

test('kamera: hatalı yollar — çift sırrı zorunlu (U7), başkasının getirdiği istek, aynı akış, yetişkin yapılandıramaz, uç modları', (t) => {
  const { L, telefon, uc } = kur()
  t.is(hata(() => new S.CameraApi({ defter: new S.LedgerApi({ ledger: L, me: V.K.kerem }) })), 'PAIR_SECRET_REQUIRED')
  t.is(hata(() => new S.EdgeDevice({ ledger: L, me: V.C.uc1, saklama: bellek() })), 'PAIR_SECRET_REQUIRED')
  t.is(hata(() => new S.EdgeDevice({ ledger: L, me: V.C.uc1, ciftSirri: cift(L, V.C.uc1) })), 'STORAGE_REQUIRED')
  uc.receiveConfig(kerem, telefon.configure(V.C.uc1.memberId, { mode: 'kamera', targets: ['rol:ebeveyn'], video: { maxWidth: 640, maxHeight: 480, fps: 5, kbps: 500 } }).bytes, 'dogrudan')
  // Kerem'in isteğini Hüsniye getirirse: IZIN_YOK
  const a = telefon.watch(ucHex)
  t.is(uc.receiveStreamRequest(hex(V.K.husniye.memberId), a.bytes, 'dogrudan', KOSUL).code, 'IZIN_YOK')
  // Aynı streamId ikinci kez: IZIN_YOK (U6)
  const r = uc.receiveStreamRequest(kerem, a.bytes, 'dogrudan', KOSUL)
  t.ok(r.kabul)
  t.is(uc.receiveStreamRequest(kerem, a.bytes, 'dogrudan', KOSUL).code, 'IZIN_YOK')
  // Çift sırrı olmayan uç: IZIN_YOK; çift sırrı olmayan telefon: NO_PAIR; başka uçtan gelen kabul: NO_STREAM
  const ucCiftsiz = new S.EdgeDevice({ ledger: L, me: V.C.uc1, ciftSirri: () => null, saklama: bellek() })
  t.is(ucCiftsiz.receiveStreamRequest(kerem, telefon.watch(ucHex).bytes, 'dogrudan', KOSUL).code, 'IZIN_YOK')
  const telefonCiftsiz = new S.CameraApi({ defter: new S.LedgerApi({ ledger: L, me: V.K.kerem }), ciftSirri: () => null })
  telefonCiftsiz.akislar.set(a.streamId, { ucHex, opener: null, kabul: null })
  t.is(hata(() => telefonCiftsiz.receiveAccept(ucHex, r.kabul, 'dogrudan')), 'NO_PAIR')
  t.is(hata(() => telefon.receiveAccept(hex(V.C.isci1.memberId), r.kabul, 'dogrudan')), 'NO_STREAM')
  const k = uc.closeStream(a.streamId, 'SICAK')
  t.is(hata(() => telefon.receiveClose(hex(V.C.isci1.memberId), k.kapat, 'dogrudan')), 'NO_STREAM')
  t.is(hata(() => uc.receiveClose(kerem, telefon.stopWatching(a.streamId), 'dogrudan')), 'NO_STREAM')
  t.is(hata(() => telefon.stopWatching(a.streamId)), 'NO_STREAM')
  // Yetişkin yapılandıramaz; uç olmayana yapılandırma yok
  const irem = new S.CameraApi({ defter: new S.LedgerApi({ ledger: L, me: V.K.irem }), ciftSirri: cift(L, V.K.irem) })
  t.is(hata(() => irem.configure(ucHex, { mode: 'kamera', targets: ['rol:ebeveyn'] })), 'UNAUTHORIZED')
  t.is(hata(() => irem.configure(hex(V.C.isci1.memberId), { mode: 'kapali' })), 'WRONG_EDGE')
  t.is(hata(() => irem.receiveAccept(ucHex, b4a.from([1]), 'dogrudan')), 'INVALID_MESSAGE')
  // Başka ebeveynin yapılandırması (emanet kopyası) seq'i öğretir
  const husniye = new S.CameraApi({ defter: new S.LedgerApi({ ledger: L, me: V.K.husniye }), ciftSirri: cift(L, V.K.husniye) })
  t.is(irem.configSeen(hex(V.K.husniye.memberId), husniye.configure(ucHex, { mode: 'kamera', targets: ['rol:ebeveyn'], seq: 7 }).bytes, 'emanet'), 7)
  // Uç olma: iOS ekran yalnız ekran; tanımsız ortam reddedilir; işçi uç olamaz
  t.alike(new P.ProfilDefteri({ ledger: L }).al(uc.become({ runtime: 'ios-ekran', hostId: b4a.alloc(16, 2), appVersion: '1', versionCode: 1 })).ucModes, ['ekran'])
  t.is(hata(() => uc.become({ runtime: 'windows-yerel', hostId: hex(b4a.alloc(16)), appVersion: '1', versionCode: 1 })), 'INVALID_MESSAGE')
  t.alike(new P.ProfilDefteri({ ledger: L }).al(uc.become({ modlar: ['kamera'], hostId: hex(b4a.alloc(16)), appVersion: '1', versionCode: 1 })).ucModes, ['kamera'])
  const isci = new S.EdgeDevice({ ledger: L, me: V.C.isci1, ciftSirri: cift(L, V.C.isci1), saklama: bellek() })
  t.is(hata(() => isci.become({ hostId: hex(b4a.alloc(16, 1)), appVersion: '1.0.0', versionCode: 1 })), 'NOT_EDGE')
})

test('U8: görev yerleştirmesi profil süzgeciyle (NODE_PROFILE girişi); kasa payı adaylığı profil kuralıyla', (t) => {
  const { L } = kur()
  const gorev = new S.TaskApi({ ledger: L, me: V.K.kerem, yetenekler: new (require('@havenfold/tasks').yetenek.YetenekDefteri)({ ledger: L }) })
  const isci = hex(V.C.isci1.memberId)
  const profil = P.profilKodla(L.familyId, { nodeId: V.C.isci1.memberId, hostId: b4a.alloc(16, 1), seq: 1, runtime: 'windows-yerel', sandbox: 'appcontainer-job', features: [{ type: 'hf.task.ocr', features: ['metin'] }], sharedComputer: true, idlePolicy: 'bostayken', shareEligible: false, ucModes: [], appVersion: '1', versionCode: 1 }, V.C.isci1)
  t.is(hata(() => gorev.receiveProfile(isci, profil, 'emanet')), 'DIRECT_ONLY')
  t.is(gorev.receiveProfile(isci, profil, 'dogrudan').runtime, 'windows-yerel')
  const uygun = P.yerlestirmeSuzgeci(gorev.profiller, 'hf.task.ocr', { output: 'pdf' })
  t.is(uygun({ id: isci }), false)
  const kasa = new S.VaultApi({ ledger: L, me: V.K.kerem, uygunCihaz: () => true, kasaProfil: { profiller: gorev.profiller, saglik: () => ({ platform: { tpm: 'muhur-ok' } }) } })
  t.is(kasa.kanca.uygunCihaz(isci), false) // tepsi işçisi pay tutmaz
  t.is(new S.VaultApi({ ledger: L, me: V.K.kerem, uygunCihaz: () => true }).kanca.uygunCihaz(isci), true)
})

test('kamera: komut numaraları RFC-0008 §12 aralığında', (t) => {
  t.alike(S.EDGE_COMMAND, { EDGE_BECOME: 340, EDGE_CONFIGURE: 341, EDGE_STATUS: 342, EDGE_WATCH: 343, EDGE_WATCH_CLOSE: 344, EDGE_CARD_SEND: 345, APP_WIPE_REPORTS: 347 })
  for (const y of ['configure', 'status', 'watch', 'stopWatching', 'startRemoval', 'receiveWipeReport', 'wipeReports', 'writeToParents', 'removeEdge', 'removed', 'sendCard', 'openSensors']) t.is(typeof S.CameraApi.prototype[y], 'function')
  for (const y of ['become', 'receiveRemoval', 'removal', 'wipe', 'removed', 'receiveScreen', 'cards', 'sensorEvent', 'receiveTask']) t.is(typeof S.EdgeDevice.prototype[y], 'function')
})

// Adım 8 (§9): yerli silme adımlarının sonuçları (Android uç)
const SILME = { hostId: hex(b4a.alloc(16, 0xa2)), os: 'android', osVersion: '14', appVersion: '1.0.0', keyStore: 'android-keystore',
  items: [{ what: 'keystore-sarma-anahtari', method: 'anahtar-imha', ok: true }, { what: 'veri-dizinleri', method: 'dosya-silme', ok: true }] }

test('adım 8: ebeveyn kaldırmayı başlatır → cihazda onay → uç siler ve raporlar → telefon doğrular, saklar, wipe ve özetle çıkarır', (t) => {
  const { L, telefon, uc } = kur()
  // Ebeveyn başlatmadan uç "emeklilik" raporu üretemez (iki taraflı onay)
  t.is(hata(() => uc.wipe({ ...SILME, trigger: 'emeklilik' })), 'REMOVAL_NOT_REQUESTED')
  // Yetişkin başlatamaz; başkasına yönelik istek reddedilir
  const irem = new S.CameraApi({ defter: new S.LedgerApi({ ledger: L, me: V.K.irem }), ciftSirri: cift(L, V.K.irem) })
  t.is(hata(() => irem.startRemoval(ucHex)), 'UNAUTHORIZED')
  t.is(hata(() => uc.receiveRemoval(kerem, b4a.from([0x11]), 'dogrudan')), 'INVALID_MESSAGE')
  const istek = telefon.startRemoval(ucHex)
  const liste = uc.receiveRemoval(kerem, istek, 'dogrudan')
  t.alike(require('@havenfold/core').emeklilik.decodeRetireList(liste), { holds: [], blobs: [], shares: [] })
  t.is(uc.removal().from, kerem)

  // Cihazın başındaki kişi onayladı: uç kendi durumunu da siler; rapor ebeveynlere
  const r = uc.wipe({ ...SILME, trigger: 'emeklilik' })
  t.is(r.result, 'ok')
  t.alike(r.alicilar, [kerem, hex(V.K.husniye.memberId)].sort())
  t.is(uc.saklama.get('uc/durum'), null)
  t.is(uc.removal(), null)
  t.is(hata(() => uc.wipe({ ...SILME, trigger: 'kaldirma' })), 'DELETED')

  // Telefon doğrular: Android'de fabrika ayarı kalıntısı, ucun kendi öğesi, uyarı metni
  const rapor = telefon.receiveWipeReport(ucHex, r.bytes, 'dogrudan')
  t.alike([rapor.deviceId, rapor.result, rapor.hash, rapor.residue], [ucHex, 'ok', r.hash, ['fabrika-ayari-yapilmadi']])
  t.alike(rapor.items.map((x) => x.what), ['keystore-sarma-anahtari', 'veri-dizinleri', 'uc-durumu'])
  t.ok(rapor.uyari.startsWith('Bu rapor cihazın kendi beyanıdır. İşletim sistemi silinmedi.'))
  t.alike(telefon.wipeReports().map((x) => x.hash), [r.hash])
  // Aynı rapor ikinci kez gelirse çoğalmaz; başka cihazdan gelen kopya reddedilir
  telefon.receiveWipeReport(ucHex, r.bytes, 'emanet')
  t.is(telefon.wipeReports().length, 1)
  t.is(hata(() => telefon.receiveWipeReport(hex(V.C.isci1.memberId), r.bytes, 'dogrudan')), 'UNAUTHORIZED')

  // Çıkarma: DEVICE_DETACH { wipe: true, wipeReportHash } (iki ebeveynin imzası gerekebilir)
  const y = telefon.removeEdge(ucHex)
  if (y.durum === 'oneri') new S.LedgerApi({ ledger: L, me: V.K.husniye }).sign(y.oneriId)
  const d = L.devices.get(ucHex)
  t.alike([d.active, d.wipe, hex(d.wipeReportHash)], [false, true, r.hash])
  t.alike(telefon.removed().map((x) => [x.ucId, x.silindi, x.wipeReportHash, x.rapor && x.rapor.result]), [[ucHex, true, r.hash, 'ok']])
  t.is(uc.removed(), true)
  t.alike(telefon.edges(), [])
})

test('adım 8: rapor gelmeden çıkarılan uç (madde 8) yerelde siler, alıcısı yok; result kuralı; bozuk rapor', (t) => {
  const { L, telefon, uc, ucKur } = kur()
  // Uygulama kaldırılıyor (cihazın başındaki kişi): bir öğe başarısız → hata
  const ikinci = ucKur()
  const hataRaporu = ikinci.wipe({ ...SILME, trigger: 'kaldirma', items: [SILME.items[0], { what: 'veri-dizinleri', method: 'dosya-silme', ok: false }] })
  t.is(hataRaporu.result, 'hata')
  t.is(telefon.receiveWipeReport(ucHex, hataRaporu.bytes, 'dogrudan').result, 'hata')
  const bozuk = b4a.from(hataRaporu.bytes)
  bozuk[bozuk.byteLength - 1] ^= 1
  t.is(hata(() => telefon.receiveWipeReport(ucHex, bozuk, 'dogrudan')), 'INVALID_SIGNATURE')

  // Bu telefonda rapor yokken çıkarma: wipe false, özet sıfır
  const yeni = new S.CameraApi({ defter: new S.LedgerApi({ ledger: L, me: V.K.husniye }), ciftSirri: cift(L, V.K.husniye) })
  const y = yeni.removeEdge(ucHex)
  if (y.durum === 'oneri') new S.LedgerApi({ ledger: L, me: V.K.kerem }).sign(y.oneriId)
  t.alike([L.devices.get(ucHex).wipe, yeni.removed()[0].silindi], [false, false])
  // Çıkarılmış uç: emeklilik raporu kaldırma isteği olmadan da üretilir (ebeveynin kararı defterde) ama gidecek kimse yok
  t.is(uc.removed(), true)
  const r = uc.wipe({ ...SILME, trigger: 'emeklilik' })
  t.alike([r.result, r.alicilar], ['ok', []])
  // Çıkarılmış cihazla oturum yok: rapor giriş süzgecinden geçmez
  t.is(hata(() => telefon.receiveWipeReport(ucHex, r.bytes, 'dogrudan')), 'TYPE_NOT_ALLOWED')
})

test('L2 madde 1, 2: anahtar imhası bildirilmezse hata; silindikten sonra uç hiçbir şey kabul etmez, açık akış kapanış bildirimiyle kapanır', (t) => {
  const { telefon, uc, ucKur } = kur()
  uc.receiveConfig(kerem, telefon.configure(ucHex, { mode: 'kamera', targets: ['rol:ebeveyn'] }).bytes, 'dogrudan')
  const istek = telefon.watch(ucHex)
  const a = uc.receiveStreamRequest(kerem, istek.bytes, 'dogrudan', KOSUL)
  t.ok(a.kabul)
  uc.receiveRemoval(kerem, telefon.startRemoval(ucHex), 'dogrudan')
  // Yerli modül Keystore anahtarını yok ettiğini bildirmedi: rapor "silindi" diyemez
  const r = uc.wipe({ ...SILME, trigger: 'emeklilik', items: [SILME.items[1]] })
  t.is(r.result, 'hata')
  t.alike(telefon.receiveWipeReport(ucHex, r.bytes, 'dogrudan').items.filter((x) => !x.ok).map((x) => x.what), ['sarma-anahtari-imhasi-bildirilmedi'])
  // Açık akış kapanış bildirimiyle kapandı; mühürleme ve her giriş SILINDI
  t.alike(r.kapat.map((x) => x.toId), [kerem])
  t.is(require('@havenfold/edge').akis.kapatCoz(r.kapat[0].bytes).code, 'BITTI')
  t.is(hata(() => a.muhurle(b4a.alloc(4), { ts: 1 })), 'DELETED')
  t.is(hata(() => uc.receiveConfig(kerem, telefon.configure(ucHex, { mode: 'kamera', targets: ['rol:ebeveyn'] }).bytes, 'dogrudan')), 'DELETED')
  t.is(hata(() => uc.receiveStreamRequest(kerem, telefon.watch(ucHex).bytes, 'dogrudan', KOSUL)), 'DELETED')
  for (const f of [() => uc.buildStatus(KOSUL), () => uc.check(KOSUL), () => uc.restarted(true), () => uc.become({ hostId: SILME.hostId, appVersion: '1', versionCode: 1 })]) t.is(hata(f), 'DELETED')
  t.is(uc.mode, 'kapali')
  // Kalıcı durum diske geri yazılmadı: yeniden açılan uç boş başlar
  t.is(uc.saklama.get('uc/durum'), null)
  t.is(ucKur().mode, 'kapali')
})

test('L2 madde 4, 5: kaldırma isteği 24 saat ve isteyen ebeveynken geçerli; yalnız emeklilik raporu çıkarmaya girer; cihaz başına en yeni rapor', (t) => {
  const { L, telefon, uc, ucKur, ilerlet } = kur()
  uc.receiveRemoval(kerem, telefon.startRemoval(ucHex), 'dogrudan')
  ilerlet(25 * 3_600_000)
  t.is(uc.removal(), null)
  t.is(hata(() => uc.wipe({ ...SILME, trigger: 'emeklilik' })), 'REMOVAL_NOT_REQUESTED')
  // Uygulama kaldırılırken (cihazın başındaki kişi): rapor saklanır ama ucu silindi diye çıkarmaz
  const eski = ucKur().wipe({ ...SILME, trigger: 'kaldirma' })
  ilerlet(1000)
  const yeni = ucKur().wipe({ ...SILME, trigger: 'kaldirma' })
  telefon.receiveWipeReport(ucHex, yeni.bytes, 'dogrudan')
  telefon.receiveWipeReport(ucHex, eski.bytes, 'dogrudan')
  t.alike(telefon.wipeReports().map((x) => x.hash), [yeni.hash])
  const y = telefon.removeEdge(ucHex)
  if (y.durum === 'oneri') new S.LedgerApi({ ledger: L, me: V.K.husniye }).sign(y.oneriId)
  t.alike([L.devices.get(ucHex).wipe, hex(L.devices.get(ucHex).wipeReportHash)], [false, hex(b4a.alloc(32))])
  const k = telefon.removed()[0]
  t.alike([k.silindi, k.rapor.trigger, k.rapor.istek !== null], [false, 'kaldirma', true])
})

test('L2 madde 3: rapor Ebeveynler koleksiyonuna hf.wipe.report olarak yazılır; öbür ebeveyn kayıttan doğrulayıp görür', (t) => {
  const A = require('../../core/records/test/helpers/family')
  const { L, uc } = kur()
  const dK = new S.LedgerApi({ ledger: L, me: V.K.kerem })
  const ac = dK.openCollection({ name: 'Ebeveynler', readers: ['rol:ebeveyn'], writers: ['rol:ebeveyn'] })
  if (ac.durum === 'oneri') new S.LedgerApi({ ledger: L, me: V.K.husniye }).sign(ac.oneriId)
  const rK = A.replika(L, V.K.kerem)
  const rH = A.replika(L, V.K.husniye)
  const esitle = () => { for (let i = 0; i < 3; i++) { rK.sync(); rH.sync(); A.teslim(rK, rH); A.teslim(rH, rK) } }
  esitle()
  const kameraK = new S.CameraApi({ defter: dK, kayit: new S.RecordApi({ replika: rK }), ciftSirri: cift(L, V.K.kerem) })
  const kameraH = new S.CameraApi({ defter: new S.LedgerApi({ ledger: L, me: V.K.husniye }), kayit: new S.RecordApi({ replika: rH }), ciftSirri: cift(L, V.K.husniye) })
  uc.receiveRemoval(kerem, kameraK.startRemoval(ucHex), 'dogrudan')
  const r = uc.wipe({ ...SILME, trigger: 'emeklilik' })
  t.is(kameraK.receiveWipeReport(ucHex, r.bytes, 'dogrudan').kayit, 'yazildi')
  t.is(kameraK.receiveWipeReport(ucHex, r.bytes, 'emanet').kayit, 'vardi')
  esitle()
  // Hüsniye raporu almadı; Ebeveynler'deki kayıttan yeniden doğrular
  t.alike(kameraH.wipeReports().map((x) => [x.deviceId, x.result, x.hash, x.trigger]), [[ucHex, 'ok', r.hash, 'emeklilik']])
  // Ebeveynler'i olmayan ailede kayıt yazılmaz, rapor telefonda kalır
  const { telefon: t2, uc: u2, L: L2 } = kur()
  const k2 = new S.CameraApi({ defter: new S.LedgerApi({ ledger: L2, me: V.K.kerem }), kayit: new S.RecordApi({ replika: A.replika(L2, V.K.kerem) }), ciftSirri: cift(L2, V.K.kerem) })
  u2.receiveRemoval(kerem, t2.startRemoval(ucHex), 'dogrudan')
  t.is(k2.receiveWipeReport(ucHex, u2.wipe({ ...SILME, trigger: 'emeklilik' }).bytes, 'dogrudan').kayit, 'koleksiyon-yok')
  t.is(k2.writeToParents(), 0)
  // Koleksiyon sonra açılınca bekleyen rapor yazılır (bir kez); dönen listede iç alan yok
  const ac2 = new S.LedgerApi({ ledger: L2, me: V.K.kerem }).openCollection({ name: 'Ebeveynler', readers: ['rol:ebeveyn'], writers: ['rol:ebeveyn'] })
  if (ac2.durum === 'oneri') new S.LedgerApi({ ledger: L2, me: V.K.husniye }).sign(ac2.oneriId)
  t.is(k2.writeToParents(), 1)
  t.is(k2.writeToParents(), 0)
  t.absent('bayt' in k2.wipeReports()[0])
})

test('adım 9 ekran: üye kart gönderir (345, uyarıyla); uç screenFrom\'a göre kabul eder, yalnız bellekte gösterir; çocuk gönderemez; Posta Kutusu yok', (t) => {
  const { L, telefon, uc, ucKur } = kur()
  uc.receiveConfig(kerem, telefon.configure(ucHex, { mode: 'ekran', screenFrom: ['rol:ebeveyn'] }).bytes, 'dogrudan')
  const until = V.TS0 + 7_200_000
  const k1 = telefon.sendCard(ucHex, [{ id: 'ilac', title: 'Akşam ilacı', lines: ['20:00 · 1 tablet'], until }], { uyariOnay: true })
  t.is(k1.uyari, 'Bu kart evdeki ekranda, odadaki herkesin göreceği şekilde gösterilecek.')
  t.alike(uc.receiveScreen(kerem, k1.bytes, 'dogrudan'), { fromId: kerem, seq: k1.seq, kartSayisi: 1 })
  t.alike(uc.cards().map((x) => [x.fromId, x.title, x.lines]), [[kerem, 'Akşam ilacı', ['20:00 · 1 tablet']]])
  // Emanetle de gelir; aynı zarf ikinci kez atılır; Posta Kutusu yolu kapalı
  const k2 = telefon.sendCard(ucHex, [{ id: 'su', title: 'Su iç', lines: [], until }], { uyariOnay: true })
  t.is(k2.seq, k1.seq + 1, 'aynı milisaniyede son + 1')
  t.is(uc.receiveScreen(kerem, k2.bytes, 'emanet').seq, k2.seq)
  t.is(hata(() => uc.receiveScreen(kerem, k2.bytes, 'dogrudan')), 'STALE_CARD')
  t.is(hata(() => uc.receiveScreen(kerem, telefon.sendCard(ucHex, [{ id: 'x', title: 'x', lines: [], until }], { uyariOnay: true }).bytes, 'posta')), 'MAILBOX_FORBIDDEN')
  // Yetişkin screenFrom'da değil: atılır; çocuk hiç gönderemez
  const irem = new S.CameraApi({ defter: new S.LedgerApi({ ledger: L, me: V.K.irem }), ciftSirri: cift(L, V.K.irem) })
  t.is(hata(() => uc.receiveScreen(hex(V.K.irem.memberId), irem.sendCard(ucHex, [{ id: 'n', title: 'Not', lines: [], until }], { uyariOnay: true }).bytes, 'dogrudan')), 'SOURCE_NOT_ALLOWED')
  const ecem = new S.CameraApi({ defter: new S.LedgerApi({ ledger: L, me: V.K.ecem }), ciftSirri: cift(L, V.K.ecem) })
  t.is(hata(() => ecem.sendCard(ucHex, [{ id: 'n', title: 'Not', lines: [], until }], { uyariOnay: true })), 'UNAUTHORIZED')
  t.is(hata(() => telefon.sendCard(hex(V.C.isci1.memberId), [])), 'WRONG_EDGE')
  // Yeniden başlayan uçta kartlar yok
  t.alike(ucKur().cards(), [])
})

test('açıklama 2 madde 2, 4: uyarı onayı olmadan imzalanmaz; telefon ucun modunu ve screenFrom\'u bilir; telefon verisi silinse de kart eski sayılmaz', (t) => {
  const { L, telefon, uc, ilerlet } = kur()
  const kart = [{ id: 'ilac', title: 'Akşam ilacı', lines: [], until: V.TS0 + 86_400_000 }]
  // Kamera modundaki uca (telefon durumdan bilir) kart gönderilmez
  const y = uc.receiveConfig(kerem, telefon.configure(ucHex, { mode: 'kamera', targets: ['rol:ebeveyn'] }).bytes, 'dogrudan')
  telefon.receiveStatus(ucHex, y.durum.bytes, 'dogrudan')
  t.is(hata(() => telefon.sendCard(ucHex, kart, { uyariOnay: true })), 'NOT_MODE_SCREEN')
  const y2 = uc.receiveConfig(kerem, telefon.configure(ucHex, { mode: 'ekran', screenFrom: ['rol:yetiskin'] }).bytes, 'dogrudan')
  telefon.receiveStatus(ucHex, y2.durum.bytes, 'dogrudan')
  t.is(hata(() => telefon.sendCard(ucHex, kart)), 'NO_ALERT_APPROVAL')
  t.is(S.SCREEN_ALERT, 'Bu kart evdeki ekranda, odadaki herkesin göreceği şekilde gösterilecek.')
  // Kerem ebeveyn; screenFrom yalnız yetişkin: telefon bilir ve göndermez
  t.is(hata(() => telefon.sendCard(ucHex, kart, { uyariOnay: true })), 'SOURCE_NOT_ALLOWED')
  uc.receiveConfig(kerem, telefon.configure(ucHex, { mode: 'ekran', screenFrom: ['rol:ebeveyn'] }).bytes, 'dogrudan')
  const k = telefon.sendCard(ucHex, kart, { uyariOnay: true })
  uc.receiveScreen(kerem, k.bytes, 'dogrudan')
  // Telefonun verisi silindi (yeni saklama): sıra ms tabanlı olduğundan bir sonraki kart yine kabul
  ilerlet(1000)
  const yeni = new S.CameraApi({ defter: new S.LedgerApi({ ledger: L, me: V.K.kerem, now: () => V.TS0 + 3_601_000 }), ciftSirri: cift(L, V.K.kerem), now: () => V.TS0 + 3_601_000 })
  const k2 = yeni.sendCard(ucHex, kart, { uyariOnay: true })
  t.ok(k2.seq > k.seq)
  t.is(uc.receiveScreen(kerem, k2.bytes, 'dogrudan').seq, k2.seq)
})

test('açıklama 2 madde 1: sensör modunda durum açık sensörleri ve hedef koleksiyonu taşır; telefon "Sensör açık" satırını gösterir', (t) => {
  const { telefon, uc } = kur()
  const y = uc.receiveConfig(kerem, telefon.configure(ucHex, { mode: 'sensor', sensors: ['ivme', 'yakinlik'], targets: ['koleksiyon:' + hex(V.K_OLAYLAR)] }).bytes, 'dogrudan')
  const d = telefon.receiveStatus(ucHex, y.durum.bytes, 'dogrudan')
  t.alike([d.mode, d.sensors, d.sensorHedefleri], ['sensor', ['ivme', 'yakinlik'], [hex(V.K_OLAYLAR)]])
  t.alike(telefon.openSensors(), [{ ucId: ucHex, sensors: ['ivme', 'yakinlik'], hedefler: [hex(V.K_OLAYLAR)], cevrimici: true }])
  // Sensör hedefi olmayan yapılandırma telefonda da imzalanmaz
  t.is(hata(() => telefon.configure(ucHex, { mode: 'sensor', sensors: ['ivme'] })), 'INVALID_BODY')
  t.is(hata(() => telefon.configure(ucHex, { mode: 'sensor', sensors: ['ivme'], targets: ['koleksiyon:' + hex(V.K_TUM_AILE)] })), 'INVALID_TARGET')
})

test('adım 9 sensör ve görev: eşik olayı olaylar koleksiyonuna bırakılır (REC_OPS), telefon açar; uç görev almaz (DESTEK_YOK); silindikten sonra hiçbiri', (t) => {
  const sodium = require('sodium-native')
  const A = require('../../core/records/test/helpers/family')
  const ES = require('@havenfold/records').esitleme
  const { L, telefon, uc } = kur()
  uc.receiveConfig(kerem, telefon.configure(ucHex, { mode: 'sensor', sensors: ['ivme'], targets: ['koleksiyon:' + hex(V.K_OLAYLAR)] }).bytes, 'dogrudan')
  const yerel = { gun: 1, dk: 600 }
  // Yapılandırma kabulü güncel UC_STATUS'u da üretir (görünürlük kapısı açık; kapı çekirdek testinde)
  t.is(hata(() => uc.sensorEvent({ sensor: 'ivme', value: 120, yerel })), 'NO_DROP_PERMISSION')
  const pub = b4a.alloc(32)
  const secret = b4a.alloc(32)
  sodium.crypto_box_keypair(pub, secret)
  L.apply(V.koleksiyon(L, [V.K.husniye], {
    collectionId: V.K_OLAYLAR, name: 'Olaylar:Ev', kind: 'olaylar', readers: ['rol:ebeveyn', 'rol:yetiskin'],
    writers: ['rol:ebeveyn', 'rol:yetiskin', 'device:' + hex(V.C.isci1.memberId), 'device:' + ucHex], dropKey: pub
  }))
  const o = uc.sensorEvent({ sensor: 'ivme', value: 120, yerel })
  t.alike(o.olaylar.map((x) => [x.collectionId, x.type]), [[hex(V.K_OLAYLAR), 'hf.uc.hareket']])
  t.is(uc.sensorEvent({ sensor: 'ivme', value: 130, yerel }), null)
  const tel = A.replika(L, V.K.husniye)
  tel.addDropSecret(hex(V.K_OLAYLAR), secret)
  t.alike(ES.onOps(tel, o.mesaj.bytes).map((x) => x.status), ['gecerli'])

  // Görev: TASK → TASK_REJECT DESTEK_YOK
  const G = require('@havenfold/tasks').kodlama
  const sifir = b4a.alloc(16)
  const task = G.encodeTask(L.familyId, {
    taskId: b4a.alloc(16, 0x9a), parentTaskId: sifir, workerId: V.C.uc1.memberId, type: 'hf.task.ocr', version: '1.0.0', requester: V.K.kerem.memberId,
    inputs: [], params: b4a.from('{}'), collectionId: sifir, ledgerSeq: L.len - 1, deadline: V.TS0 + 86_400_000, limits: { ramMB: 512, minutes: 5, diskMB: 64 }, standing: false, delegation: null
  }, V.K.kerem)
  const red = uc.receiveTask(kerem, task, 'dogrudan')
  t.alike(G.decodeReject(red.bytes), { taskId: b4a.alloc(16, 0x9a), code: 'DESTEK_YOK' })

  // Silindikten sonra ekran, sensör ve görev SILINDI; kartlar boş
  uc.receiveRemoval(kerem, telefon.startRemoval(ucHex), 'dogrudan')
  uc.wipe({ ...SILME, trigger: 'emeklilik' })
  for (const f of [() => uc.sensorEvent({ sensor: 'ivme', value: 1, yerel }), () => uc.receiveTask(kerem, task, 'dogrudan'), () => uc.receiveScreen(kerem, b4a.alloc(80), 'dogrudan')]) t.is(hata(f), 'DELETED')
  t.alike(uc.cards(), [])
})
