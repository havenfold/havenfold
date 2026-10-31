// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// protocol/retirement.js — emeklilik mesajları ve silme raporu (RFC-0003 §8, RFC-0007 §13.5)
//
// Silme USB'si bu pakette değildir. Burada telefonun ve düğümün saf kısmı var: RETIRE_BEGIN / RETIRE_LIST gövdeleri,
// WIPE_REPORT kodlaması, imzası ve doğrulaması, HFK1 anahtar QR'ı, HFW1 rapor parçaları, wipeReportHash.
const c = require('compact-encoding')
const b4a = require('b4a')
const sodium = require('sodium-native')
const { hash } = require('../crypto/kdf')

const { canonical } = require('../ledger/encoding')
function fail (code) { throw new Error(code) }

function struct (fields) {
  return {
    preencode (state, m) { for (const [k, enc] of fields) enc.preencode(state, m[k]) },
    encode (state, m) { for (const [k, enc] of fields) enc.encode(state, m[k]) },
    decode (state) {
      const m = {}
      for (const [k, enc] of fields) m[k] = enc.decode(state)
      return m
    }
  }
}

// --- base45 (RFC 9285) ------------------------------------------------------------------------------------

const B45 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:'

function base45Encode (buf) {
  let out = ''
  for (let i = 0; i < buf.byteLength; i += 2) {
    if (i + 1 < buf.byteLength) {
      let n = buf[i] * 256 + buf[i + 1]
      const a = n % 45; n = (n - a) / 45
      const b = n % 45
      out += B45[a] + B45[b] + B45[(n - b) / 45]
    } else {
      const n = buf[i]
      out += B45[n % 45] + B45[Math.floor(n / 45)]
    }
  }
  return out
}

function base45Decode (str) {
  const v = [...str].map((ch) => {
    const i = B45.indexOf(ch)
    if (i < 0) fail('INVALID_BASE45')
    return i
  })
  if (v.length % 3 === 1) fail('INVALID_BASE45')
  const out = []
  for (let i = 0; i < v.length; i += 3) {
    if (i + 2 < v.length) {
      const n = v[i] + v[i + 1] * 45 + v[i + 2] * 2025
      if (n > 0xffff) fail('INVALID_BASE45')
      out.push(n >> 8, n & 0xff)
    } else {
      const n = v[i] + v[i + 1] * 45
      if (n > 0xff) fail('INVALID_BASE45')
      out.push(n)
    }
  }
  return b4a.from(out)
}

// --- RETIRE_BEGIN (0x98), RETIRE_LIST (0x99) ----------------------------------------------------------------------
// RETIRE_LIST alan türleri RFC'de yazılı değil (İstekler): holds emanet tutulan kimlikler, blobs dosya kimlikleri
// (RFC-0001 §11, fixed32), shares kasa payı tutulan sırların kimlikleri.

const retireBegin = struct([['deviceId', c.fixed16]])
// shares: pay tutulan sırların kimlikleri (secretId 16 bayt; RFC-0019 §11.3 f)
const retireList = struct([['holds', c.array(c.fixed16)], ['blobs', c.array(c.fixed32)], ['shares', c.array(c.fixed16)]])
const decodeRetireBegin = (b) => canonical(retireBegin, b, 'INVALID_MESSAGE')
const decodeRetireList = (b) => canonical(retireList, b, 'INVALID_MESSAGE')

// --- WIPE_REPORT (RFC-0003 §8 adım 4) ------------------------------------------------------------------------------

const METHODS = ['nvme-sanitize-crypto', 'nvme-sanitize-block', 'ata-sanitize', 'ata-secure-erase', 'overwrite-verify', 'clear-unverified']
const RESULTS = ['ok', 'dogrulanamadi', 'hata']

const reportFields = [
  ['deviceId', c.fixed16], ['serial', c.string], ['model', c.string], ['diskModel', c.string], ['diskSerial', c.string],
  ['method', c.string], ['tool', c.string], ['toolVersion', c.string], ['driveStatus', c.string],
  ['startedAt', c.uint], ['finishedAt', c.uint], ['result', c.string], ['reportPub', c.fixed32]
]
const reportUnsigned = struct(reportFields)
const wipeReport = struct([...reportFields, ['sig', c.fixed64]])

const reportDigest = (unsignedBytes) => hash('hf/wipe-report/', unsignedBytes)

// Silme ortamının yaptığı (testte ve vektörde kullanılır). keyPair: tek kullanımlık Ed25519 rapor anahtarı.
function signWipeReport (report, keyPair) {
  if (!METHODS.includes(report.method) || !RESULTS.includes(report.result)) fail('INVALID_BODY')
  const body = { ...report, reportPub: keyPair.publicKey }
  const unsigned = c.encode(reportUnsigned, body)
  const sig = b4a.alloc(64)
  sodium.crypto_sign_detached(sig, reportDigest(unsigned), keyPair.secretKey)
  return b4a.concat([unsigned, sig])
}

// Telefonun denetimi (adım 6): reportPub anahtar QR'ındakiyle aynı mı, imza geçerli mi. İmza gönderilen baytlar
// üstünden doğrulanır; gövde yeniden kodlanmaz.
function verifyWipeReport (bytes, reportPub) {
  const r = canonical(wipeReport, bytes, 'INVALID_REPORT')
  if (!METHODS.includes(r.method) || !RESULTS.includes(r.result)) fail('INVALID_REPORT')
  if (r.startedAt > r.finishedAt) fail('INVALID_REPORT')
  if (!b4a.equals(r.reportPub, reportPub)) fail('REPORT_KEY_MISMATCH')
  const unsigned = bytes.subarray(0, bytes.byteLength - 64)
  if (!sodium.crypto_sign_verify_detached(r.sig, reportDigest(unsigned), reportPub)) fail('INVALID_SIGNATURE')
  return r
}

const wipeReportId = (bytes) => hash('hf/wipe-report-id/', bytes)

// Tek disk: rapor kimliği. Birden çok disk: kimlikler bayt sırasıyla dizilip hf/wipe-report-set/ (RFC-0007 §13.5)
function wipeReportHash (reports) {
  if (reports.length === 0) fail('NO_REPORT')
  if (reports.length === 1) return wipeReportId(reports[0])
  const ids = reports.map(wipeReportId).sort(b4a.compare)
  return hash('hf/wipe-report-set/', b4a.concat(ids))
}

// --- HFK1 anahtar QR'ı (RFC-0007 §13.5) ------------------------------------------------------------------------------

const wipeKeyQr = struct([
  ['v', c.uint], ['hostId', c.fixed16], ['ids', c.array(c.fixed16)], ['retireNonce', c.fixed16],
  ['reportPub', c.fixed32], ['disks', c.uint], ['toolVersion', c.string]
])

const encodeKeyQr = (m) => 'HFK1:' + base45Encode(c.encode(wipeKeyQr, { v: 1, ...m }))

function decodeKeyQr (text) {
  if (!text.startsWith('HFK1:')) fail('INVALID_QR')
  let m
  try { m = canonical(wipeKeyQr, base45Decode(text.slice(5)), 'INVALID_QR') } catch { fail('INVALID_QR') }
  if (m.v !== 1) fail('INVALID_QR')
  return m
}

// --- HFW1 rapor parçaları ------------------------------------------------------------------------------------------

const wipeSet = struct([['reports', c.array(c.buffer)]])
const CHUNK_QR = 384
const CHUNK_KONSOL = 128

function encodeReportChunks (reports, size = CHUNK_QR) {
  const buf = c.encode(wipeSet, { reports })
  const total = Math.ceil(buf.byteLength / size)
  const out = []
  for (let i = 0; i < total; i++) out.push(`HFW1:${i + 1}/${total}:` + base45Encode(buf.subarray(i * size, (i + 1) * size)))
  return out
}

// Parçalar herhangi bir sırayla okunabilir; eksik ya da çelişen parça hatadır
function joinReportChunks (texts) {
  const parts = new Map()
  let total = null
  for (const t of texts) {
    const m = /^HFW1:([0-9]+)\/([0-9]+):(.*)$/.exec(t)
    if (!m) fail('INVALID_QR')
    const i = Number(m[1])
    const n = Number(m[2])
    if (total === null) total = n
    if (n !== total || i < 1 || i > n) fail('INVALID_QR')
    const data = base45Decode(m[3])
    if (parts.has(i) && !b4a.equals(parts.get(i), data)) fail('INVALID_QR')
    parts.set(i, data)
  }
  if (total === null || parts.size !== total) fail('CHUNK_MISSING')
  const buf = b4a.concat([...Array(total)].map((_, i) => parts.get(i + 1)))
  try { return canonical(wipeSet, buf, 'INVALID_QR').reports } catch { fail('INVALID_QR') }
}

// Telefon: anahtar QR'ı + rapor parçaları → doğrulanmış raporlar ve DEVICE_DETACH'e girecek özet.
// Başka bir silme oturumundan gelen parça imzayı bozar.
// biletsiz: true — RFC-0007 §13.2 adım 4: bilet yoksa telefon "Kimlik doğrulanamadı; bu cihazı siz mi seçtiniz?" diye
// sorar. Biletsiz oturum §13.5'teki gibidir: ids boş, hostId ve retireNonce 16 sıfır, her raporun deviceId'si 16 sıfır.
// Seçenek verilirse böyle bir oturum biçim ve imza denetiminden geçer ve sonuçta biletsiz: true döner (telefon sormalı);
// seçenek yoksa ya da bilet varsa davranış değişmez (biletsiz: false).
function verifyWipe (keyQrText, chunkTexts, { biletsiz = false } = {}) {
  const key = decodeKeyQr(keyQrText)
  const raw = joinReportChunks(chunkTexts)
  if (raw.length !== key.disks) fail('REPORT_COUNT_MISMATCH')
  const reports = raw.map((b) => verifyWipeReport(b, key.reportPub))
  const sifir = b4a.alloc(16)
  const kimliksiz = biletsiz === true && key.ids.length === 0
  if (kimliksiz) {
    if (!b4a.equals(key.hostId, sifir) || !b4a.equals(key.retireNonce, sifir) || reports.some((r) => !b4a.equals(r.deviceId, sifir))) fail('INVALID_REPORT')
  } else if (!key.ids.length || reports.some((r) => !b4a.equals(r.deviceId, key.ids[0]))) {
    // Rapor bu cihazın: deviceId anahtar QR'ındaki ilk kimlik (inceleme RFC-0003 bulgu 17)
    fail('INVALID_REPORT')
  }
  return { key, reports, raw, wipeReportHash: wipeReportHash(raw), anyError: reports.some((r) => r.result === 'hata'), biletsiz: kimliksiz }
}

module.exports = {
  base45Encode,
  base45Decode,
  retireBegin,
  retireList,
  decodeRetireBegin,
  decodeRetireList,
  METHODS,
  RESULTS,
  wipeReport,
  signWipeReport,
  verifyWipeReport,
  wipeReportId,
  wipeReportHash,
  wipeKeyQr,
  encodeKeyQr,
  decodeKeyQr,
  wipeSet,
  CHUNK_QR,
  CHUNK_KONSOL,
  encodeReportChunks,
  joinReportChunks,
  verifyWipe
}
