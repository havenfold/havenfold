// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// encoding.js — RFC-0008 tel biçimleri (§9.3, §10.1, §11.4, §11.5, §11.6) ve imzaları
//
//   body = sig alanı dışındaki alanların kodlaması (sig her mesajda son alandır, 64 B)
//   sig  = Ed25519(imzalayan, hashLP('<etiket>', familyId, body))
// RFC-0008 formülleri `hash` yazar; etiketler RFC-0027 §8 b'den sonra koda girdiği için uzunluk önekli biçimle (hashLP,
// deriveLP; D69) üretilir (RFC-0010 ve RFC-0012'nin kodlarıyla aynı karar). Kodlama RFC-0001 §3'tekiyle aynıdır:
// compact-encoding, kanonik çözme (en kısa c.uint, sonda fazla bayt yok); imza gönderilen baytlar üzerinden doğrulanır.
const c = require('compact-encoding')
const b4a = require('b4a')
const sodium = require('sodium-native')
const { kdf: { hashLP } } = require('@havenfold/core')
const { struct, decodeCanonical } = require('@havenfold/records').kodlama

function fail (code) { throw new Error(code) }
const hex = (b) => (typeof b === 'string' ? b : b4a.toString(b, 'hex'))

const ETIKET = {
  NODE_PROFILE: 'hf/node-profile/',
  UC_CONFIG: 'hf/uc-config/',
  UC_STREAM_OPEN: 'hf/uc-stream-open/',
  UC_STATUS: 'hf/uc-status/',
  UC_SCREEN: 'hf/uc-screen/',
  APP_WIPE_REPORT: 'hf/app-wipe-report/',
  APP_WIPE_REPORT_ID: 'hf/app-wipe-report-id/'
}

// §10.1
const RUNTIME = ['linux-konteyner', 'windows-yerel', 'macos-yerel', 'android-uc', 'android-kutu', 'ios-ekran']
const SANDBOX = ['podman', 'appcontainer-job', 'app-sandbox', 'yok']
// Çalışma ortamı ile kum havuzu eşleşmesi (§4.1, §6, §10.2): yanlış eşleşen beyan geçersizdir
const RUNTIME_SANDBOX = {
  'linux-konteyner': 'podman', 'windows-yerel': 'appcontainer-job', 'macos-yerel': 'app-sandbox',
  'android-uc': 'yok', 'android-kutu': 'yok', 'ios-ekran': 'yok'
}
const IDLE = ['her-zaman', 'bostayken']
// §3, §11.1: uç modları; iOS yalnız ekran (§11.11)
const MODLAR = ['kamera', 'sensor', 'ekran', 'kapali']
const UC_MODLARI = { 'android-uc': MODLAR, 'ios-ekran': ['ekran'] }
const SENSORLER = ['ivme', 'isik', 'yakinlik', 'basinc']
const AMACLAR = ['analiz', 'canli']
const ISI = ['normal', 'kisildi', 'durdu']
const TYPE_RE = /^(hf|yuva|mekan)\.task\.[a-z0-9][a-z0-9.-]*$/ // RFC-0002 §5 (core/tasks encoding.js ile aynı)
const OZELLIK_RE = /^[a-z0-9][a-z0-9.+-]{0,31}$/

// §11.4 madde 6 ve varsayılan
const VIDEO_SINIR = { maxWidth: 1920, maxHeight: 1080, fps: 15, kbps: 4000 }
const VIDEO_VARSAYILAN = { maxWidth: 1280, maxHeight: 720, fps: 10, kbps: 1000 }
const GUN_DK = 1440

// --- NODE_PROFILE (0xE0, §10.1) -----------------------------------------------------------------------------------

const ozellikGirdisi = struct([['type', c.string], ['features', c.array(c.string)]])
const profilGovde = struct([
  ['nodeId', c.fixed16], ['hostId', c.fixed16], ['seq', c.uint], ['runtime', c.string], ['sandbox', c.string],
  ['features', c.array(ozellikGirdisi)], ['sharedComputer', c.bool], ['idlePolicy', c.string], ['shareEligible', c.bool],
  ['ucModes', c.array(c.string)], ['appVersion', c.string], ['versionCode', c.uint]
])

const tekil = (xs) => new Set(xs).size === xs.length

function profilDenetle (m) {
  if (!RUNTIME.includes(m.runtime) || RUNTIME_SANDBOX[m.runtime] !== m.sandbox || !IDLE.includes(m.idlePolicy)) fail('INVALID_MESSAGE')
  for (const f of m.features) if (!TYPE_RE.test(f.type) || !tekil(f.features) || !f.features.every((x) => OZELLIK_RE.test(x))) fail('INVALID_MESSAGE')
  if (!tekil(m.features.map((f) => f.type))) fail('INVALID_MESSAGE')
  const izinli = UC_MODLARI[m.runtime] || []
  if (!tekil(m.ucModes) || !m.ucModes.every((x) => izinli.includes(x))) fail('INVALID_MESSAGE')
  return m
}

// --- UC_CONFIG (0xE1, §11.4) --------------------------------------------------------------------------------------

const video = struct([['maxWidth', c.uint], ['maxHeight', c.uint], ['fps', c.uint], ['kbps', c.uint]])
const pencere = struct([['days', c.uint], ['startMin', c.uint], ['endMin', c.uint]])
const yapilandirmaGovde = struct([
  ['ucId', c.fixed16], ['seq', c.uint], ['mode', c.string], ['targets', c.array(c.string)], ['video', video],
  ['windows', c.array(pencere)], ['sensors', c.array(c.string)], ['screenFrom', c.array(c.string)],
  ['ledgerSeq', c.uint], ['signerId', c.fixed16]
])

// --- UC_STREAM_* (0xE2–0xE4, §11.5) -------------------------------------------------------------------------------

const boyut = struct([['width', c.uint], ['height', c.uint], ['fps', c.uint]])
const akisAcGovde = struct([
  ['streamId', c.fixed16], ['ucId', c.fixed16], ['requesterId', c.fixed16], ['purpose', c.string], ['taskId', c.fixed16],
  ['want', boyut], ['configSeq', c.uint], ['ledgerSeq', c.uint]
])
const akisKabul = struct([
  ['streamId', c.fixed16], ['codec', c.string], ['profile', c.string], ['width', c.uint], ['height', c.uint], ['fps', c.uint], ['ssrc', c.uint]
])
const akisKapat = struct([['streamId', c.fixed16], ['code', c.string], ['by', c.fixed16]])

function akisAcDenetle (m) {
  if (!AMACLAR.includes(m.purpose)) fail('INVALID_MESSAGE')
  return m
}
function kabulDenetle (m) {
  if (m.codec !== 'h264' || m.ssrc > 0xffffffff || !m.width || !m.height || !m.fps) fail('INVALID_MESSAGE')
  return m
}
function kapatDenetle (m) {
  if (!/^[A-Z][A-Z0-9_]{1,31}$/.test(m.code)) fail('INVALID_MESSAGE')
  return m
}

// --- UC_STATUS (0xE6, §11.6) --------------------------------------------------------------------------------------

const akisOzeti = struct([['toId', c.fixed16], ['purpose', c.string]])
const kamera = struct([['active', c.bool], ['streams', c.array(akisOzeti)], ['since', c.uint]])
const pil = struct([['percent', c.uint], ['tempC', c.int], ['onAC', c.bool]])
// Açıklama 1 madde 3: configSeq (uygulanan yapılandırmanın seq'i, yoksa 0); madde 6: yenidenBasladi (§11.2 dokunulması gerekiyor)
// Açıklama 2 madde 1: sensör modunda açık sensörler ve olayların gittiği koleksiyonlar (görünür izleme, ilke 7)
const durumGovde = struct([
  ['ucId', c.fixed16], ['seq', c.uint], ['mode', c.string], ['configSeq', c.uint], ['camera', kamera], ['battery', pil], ['thermal', c.string],
  ['yenidenBasladi', c.bool], ['sensors', c.array(c.string)], ['sensorTargets', c.array(c.fixed16)]
])

function durumDenetle (m) {
  if (!MODLAR.includes(m.mode) || !ISI.includes(m.thermal) || m.battery.percent > 100) fail('INVALID_MESSAGE')
  if (!m.camera.streams.every((s) => AMACLAR.includes(s.purpose))) fail('INVALID_MESSAGE')
  if (m.camera.streams.length && !m.camera.active) fail('INVALID_MESSAGE')
  if (m.yenidenBasladi && m.camera.active) fail('INVALID_MESSAGE') // dokunulması bekleyen kamera açık olamaz
  if (!tekil(m.sensors) || !m.sensors.every((x) => SENSORLER.includes(x))) fail('INVALID_MESSAGE')
  if (m.mode !== 'sensor' && (m.sensors.length || m.sensorTargets.length)) fail('INVALID_MESSAGE')
  return m
}

// --- APP_WIPE_REPORT (0xE7, §9.3) ---------------------------------------------------------------------------------

const SILME_TETIK = ['emeklilik', 'kaldirma']
const SILME_OS = ['windows', 'macos', 'android', 'ios']
// Sarma anahtarı donanımda ya da işletim sisteminin korumalı deposundaysa sonuç doğrulanabilir (§9.3 tablo)
const ANAHTAR_DEPOSU_KORUMALI = ['tpm', 'secure-enclave', 'strongbox', 'android-keystore', 'ios-keychain']
const ANAHTAR_DEPOSU = [...ANAHTAR_DEPOSU_KORUMALI, 'dpapi', 'macos-keychain']
// İşletim sistemi ile anahtar deposu uyuşmalı (inceleme L2 madde 6): Android'de Keystore, iOS'ta Secure Enclave ya da anahtar zinciri
const OS_ANAHTAR_DEPOSU = {
  android: ['strongbox', 'android-keystore'], ios: ['secure-enclave', 'ios-keychain'], windows: ['tpm', 'dpapi'], macos: ['secure-enclave', 'macos-keychain']
}
const SILME_YONTEMI = ['anahtar-imha', 'dosya-silme']
const SILME_SONUCU = ['ok', 'dogrulanamadi', 'hata']
// §9.4 kalıntı kodları; Android ve iOS'ta fabrika ayarı her zaman kalıntıdır
const KALINTI = ['sayfa-dosyasi', 'hazirda-bekletme', 'isletim-sistemi-yedegi', 'disk-sifresiz', 'fabrika-ayari-yapilmadi']

const silmeOgesi = struct([['what', c.string], ['method', c.string], ['ok', c.bool]])
const silmeGovde = struct([
  ['deviceId', c.fixed16], ['hostId', c.fixed16], ['kind', c.string], ['trigger', c.string], ['os', c.string], ['osVersion', c.string],
  ['appVersion', c.string], ['keyStore', c.string], ['items', c.array(silmeOgesi)], ['residue', c.array(c.string)],
  ['startedAt', c.uint], ['finishedAt', c.uint], ['result', c.string]
])

/**
 * §9.3 `result` kuralı: bir öğe başarısızsa hata. Sarma anahtarı yok edilmeden (en az bir başarılı `anahtar-imha`) ya da veri
 * silinmeden (en az bir başarılı `dosya-silme`) rapor silindi diyemez: biri yoksa hata (inceleme L2 madde 1; §9.2 adım 2 ve 3).
 * Değilse anahtar deposu korumalıysa ok, dpapi ya da macOS anahtar zinciriyse dogrulanamadi.
 */
function silmeSonucu (keyStore, items) {
  if (!items.length || items.some((x) => !x.ok)) return 'hata'
  if (!items.some((x) => x.method === 'anahtar-imha') || !items.some((x) => x.method === 'dosya-silme')) return 'hata'
  return ANAHTAR_DEPOSU_KORUMALI.includes(keyStore) ? 'ok' : 'dogrulanamadi'
}

function silmeDenetle (m) {
  if (m.kind !== 'uygulama-verisi-silindi' || !SILME_TETIK.includes(m.trigger) || !SILME_OS.includes(m.os) || !ANAHTAR_DEPOSU.includes(m.keyStore)) fail('INVALID_MESSAGE')
  if (!OS_ANAHTAR_DEPOSU[m.os].includes(m.keyStore)) fail('INVALID_MESSAGE')
  if (!m.items.every((x) => x.what && SILME_YONTEMI.includes(x.method))) fail('INVALID_MESSAGE')
  if (!tekil(m.residue) || !m.residue.every((x) => KALINTI.includes(x))) fail('INVALID_MESSAGE')
  if ((m.os === 'android' || m.os === 'ios') && !m.residue.includes('fabrika-ayari-yapilmadi')) fail('INVALID_MESSAGE')
  if (m.finishedAt < m.startedAt || !SILME_SONUCU.includes(m.result) || m.result !== silmeSonucu(m.keyStore, m.items)) fail('INVALID_MESSAGE')
  return m
}

// --- İmza ---------------------------------------------------------------------------------------------------------

const ozetOf = (tag, familyId, body) => hashLP(tag, familyId, body)

function imzala (tag, familyId, body, secretKey) {
  const sig = b4a.alloc(64)
  sodium.crypto_sign_detached(sig, ozetOf(tag, familyId, body), secretKey)
  return sig
}

const imzaGecerli = (tag, familyId, body, sig, pub) =>
  !!pub && b4a.isBuffer(sig) && sig.byteLength === 64 && sodium.crypto_sign_verify_detached(sig, ozetOf(tag, familyId, body), pub)

// İmzalı mesaj: body ‖ sig
function imzaliKodla (enc, denetle, tag, familyId, m, secretKey) {
  let body
  try { body = c.encode(enc, denetle({ ...m })) } catch (e) { fail(/^[A-Z][A-Z0-9_]+$/.test(e.message) ? e.message : 'INVALID_MESSAGE') }
  return b4a.concat([body, imzala(tag, familyId, body, secretKey)])
}

// Dönüş: { m, body, sig }; denetim çağıranın (tablolar sıralı denetlenir, §11.4, §11.5)
function imzaliCoz (enc, buf, denetle = (m) => m) {
  if (!b4a.isBuffer(buf) || buf.byteLength < 64) fail('INVALID_MESSAGE')
  const body = buf.subarray(0, buf.byteLength - 64)
  const sig = buf.subarray(buf.byteLength - 64)
  const m = denetle(decodeCanonical(enc, body, 'INVALID_MESSAGE'))
  return { m, body, sig }
}

const duzKodla = (enc, denetle) => (m) => { try { return c.encode(enc, denetle({ ...m })) } catch { fail('INVALID_MESSAGE') } }
const duzCoz = (enc, denetle) => (buf) => {
  if (!b4a.isBuffer(buf)) fail('INVALID_MESSAGE')
  return denetle(decodeCanonical(enc, buf, 'INVALID_MESSAGE'))
}

module.exports = {
  ETIKET, RUNTIME, SANDBOX, RUNTIME_SANDBOX, IDLE, MODLAR, UC_MODLARI, SENSORLER, AMACLAR, ISI, TYPE_RE,
  VIDEO_SINIR, VIDEO_VARSAYILAN, GUN_DK,
  SILME_TETIK, SILME_OS, ANAHTAR_DEPOSU, ANAHTAR_DEPOSU_KORUMALI, OS_ANAHTAR_DEPOSU, SILME_YONTEMI, SILME_SONUCU, KALINTI,
  profilGovde, yapilandirmaGovde, akisAcGovde, akisKabul, akisKapat, durumGovde, silmeGovde,
  profilDenetle, akisAcDenetle, durumDenetle, silmeDenetle, silmeSonucu,
  ozetOf, imzala, imzaGecerli, imzaliKodla, imzaliCoz, hex, fail,
  kabulKodla: duzKodla(akisKabul, kabulDenetle),
  kabulCoz: duzCoz(akisKabul, kabulDenetle),
  kapatKodla: duzKodla(akisKapat, kapatDenetle),
  kapatCoz: duzCoz(akisKapat, kapatDenetle)
}
