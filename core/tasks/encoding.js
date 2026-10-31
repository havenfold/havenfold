// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// encoding.js — görev katmanının tel biçimleri ve imzaları (RFC-0002 §3, §4, §6, §9)
//
//   body = sig alanı dışındaki alanların kodlaması (sig her mesajda son alandır, 64 B)
//   sig  = Ed25519(imzalayan, hash('<etiket>', familyId, body))
// Etiketler: hf/node-caps/, hf/task/, hf/task-sub/, hf/task-cancel/, hf/task-delegation/.
// Bütün gövdeler kanonik çözülür (RFC-0001 §3): en kısa olmayan c.uint ve sondaki fazla bayt reddedilir. İmza
// gönderilen baytlar üzerinden doğrulanır; TASK içindeki delegation kanonik olduğu için yeniden kodlanınca aynı baytı verir.
const c = require('compact-encoding')
const b4a = require('b4a')
const sodium = require('sodium-native')
const { kdf: { hash } } = require('@havenfold/core')
const { struct, decodeCanonical } = require('@havenfold/records').kodlama

function fail (code) { throw new Error(code) }
const isZero = (b) => b.every((x) => x === 0)

const ETIKET = {
  NODE_CAPS: 'hf/node-caps/',
  TASK: 'hf/task/',
  TASK_SUB: 'hf/task-sub/',
  TASK_CANCEL: 'hf/task-cancel/',
  TASK_DELEGATION: 'hf/task-delegation/'
}

const MAX_INLINE = 32 * 1024
const MAX_LOG = 4 * 1024

const CLASSES = ['kutu', 'isci', 'uc', 'aksesuar']
const STATUSES = ['hazir', 'mesgul', 'sicak', 'pil', 'bakim']
const RESULT_STATUSES = ['ok', 'hata', 'iptal', 'sure']

// Tür adı ad alanlıdır (§5); sürüm MAJOR.MINOR.PATCH
const TYPE_RE = /^(hf|yuva|mekan)\.task\.[a-z0-9][a-z0-9.-]*$/
const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

// Seçimli alan: önce c.bool varlık bayrağı, sonra değer; null "bayrak false" demektir (RFC-0001 §3)
function optional (enc) {
  const has = (v) => v !== null && v !== undefined
  return {
    preencode (state, v) { c.bool.preencode(state, has(v)); if (has(v)) enc.preencode(state, v) },
    encode (state, v) { c.bool.encode(state, has(v)); if (has(v)) enc.encode(state, v) },
    decode (state) { return c.bool.decode(state) ? enc.decode(state) : null }
  }
}

// c.buffer boşu null çözer; görev alanlarında boş bayt dizisi döner
const bytes = {
  preencode (state, v) { c.buffer.preencode(state, v) },
  encode (state, v) { c.buffer.encode(state, v) },
  decode (state) { return c.buffer.decode(state) || b4a.alloc(0) }
}

// --- NODE_CAPS (0x96, §4) -----------------------------------------------------------------------------------------

const battery = struct([['percent', c.uint], ['healthPct', c.uint], ['cycles', c.uint], ['tempC', c.int], ['onAC', c.bool]])
const taskEntry = struct([['type', c.string], ['version', c.string], ['maxRamMB', c.uint], ['standing', c.bool], ['splittable', c.bool]])
const storage = struct([['holdGB', c.uint], ['blobGB', c.uint]])
const runningEntry = struct([['taskId', c.fixed16], ['type', c.string], ['pct', c.uint]])

const nodeCapsBody = struct([
  ['nodeId', c.fixed16], ['class', c.string], ['seq', c.uint],
  ['os', c.string], ['arch', c.string], ['cpuModel', c.string],
  ['cores', c.uint], ['ramTotalMB', c.uint], ['ramFreeMB', c.uint], ['diskTotalGB', c.uint], ['diskFreeGB', c.uint],
  ['accel', c.array(c.string)], ['battery', optional(battery)], ['tempC', c.int], ['uptimeSec', c.uint],
  ['load1x100', c.uint], ['tpm', c.bool], ['tasks', c.array(taskEntry)], ['maxTaskRamMB', c.uint],
  ['storage', storage], ['status', c.string], ['running', c.array(runningEntry)]
])

function validateNodeCaps (m) {
  if (!CLASSES.includes(m.class) || !STATUSES.includes(m.status)) fail('INVALID_MESSAGE')
  for (const t of m.tasks) if (!TYPE_RE.test(t.type) || !VERSION_RE.test(t.version)) fail('INVALID_MESSAGE')
  if (new Set(m.tasks.map((t) => t.type)).size !== m.tasks.length) fail('INVALID_MESSAGE')
  for (const r of m.running) if (r.pct > 100) fail('INVALID_MESSAGE')
  return m
}

// --- TASK_DELEGATION (0x97, §9) -----------------------------------------------------------------------------------

const delegationFields = [
  ['taskId', c.fixed16], ['coordinatorId', c.fixed16], ['workers', c.array(c.fixed16)], ['types', c.array(c.string)],
  ['collectionId', c.fixed16], ['inputBlobIds', c.array(c.fixed32)], ['maxParts', c.uint], ['expiresAt', c.uint],
  ['requester', c.fixed16], ['ledgerSeq', c.uint]
]
const delegationBody = struct(delegationFields)
const delegation = struct([...delegationFields, ['sig', c.fixed64]])

function validateDelegation (m) {
  for (const t of m.types) if (!TYPE_RE.test(t)) fail('INVALID_MESSAGE')
  return m
}

// --- TASK (0x90, §6.1) --------------------------------------------------------------------------------------------

const fileRef = struct([['blobId', c.fixed32], ['fileKey', c.fixed32], ['size', c.uint], ['mime', c.string]])
const limits = struct([['ramMB', c.uint], ['minutes', c.uint], ['diskMB', c.uint]])

const taskBody = struct([
  ['taskId', c.fixed16], ['parentTaskId', c.fixed16], ['workerId', c.fixed16], ['type', c.string], ['version', c.string],
  ['requester', c.fixed16], ['inputs', c.array(fileRef)], ['params', bytes], ['collectionId', c.fixed16],
  ['ledgerSeq', c.uint], ['deadline', c.uint], ['limits', limits], ['standing', c.bool],
  ['delegation', optional(delegation)]
])

function validateTask (m) {
  if (!TYPE_RE.test(m.type) || !VERSION_RE.test(m.version)) fail('INVALID_MESSAGE')
  if (m.delegation) validateDelegation(m.delegation)
  return m
}

// Alt görev: ana görevi gösterir ya da delegasyon taşır (§6.2 madde 1b ikisini birlikte ister)
const isSubTask = (m) => !isZero(m.parentTaskId) || !!m.delegation

// --- Diğer mesajlar (§6.3) ----------------------------------------------------------------------------------------

const taskAccept = struct([['taskId', c.fixed16], ['etaSec', c.uint]])
const taskReject = struct([['taskId', c.fixed16], ['code', c.string]])
const taskProgress = struct([['taskId', c.fixed16], ['pct', c.uint], ['note', c.string]])
const taskResult = struct([
  ['taskId', c.fixed16], ['status', c.string], ['outputs', c.array(fileRef)], ['inline', bytes], ['log', c.string]
])
const taskCancelBody = struct([['taskId', c.fixed16], ['by', c.fixed16]])

function validateProgress (m) {
  if (m.pct > 100) fail('INVALID_MESSAGE')
  return m
}

function validateResult (m) {
  if (!RESULT_STATUSES.includes(m.status)) fail('INVALID_MESSAGE')
  if (m.inline.byteLength > MAX_INLINE || b4a.byteLength(m.log) > MAX_LOG) fail('INVALID_MESSAGE')
  return m
}

// --- İmza -------------------------------------------------------------------------------------------------------

const digestOf = (tag, familyId, body) => hash(tag, familyId, body)

function signBytes (tag, familyId, body, secretKey) {
  const sig = b4a.alloc(64)
  sodium.crypto_sign_detached(sig, digestOf(tag, familyId, body), secretKey)
  return sig
}

const verifySig = (tag, familyId, body, sig, pub) => !!pub && sodium.crypto_sign_verify_detached(sig, digestOf(tag, familyId, body), pub)

// İmzalı mesaj: body ‖ sig. Dönüş: { m, body, sig } (m.sig dolu)
function encodeSigned (enc, validate, tag, familyId, m, secretKey) {
  const body = c.encode(enc, validate({ ...m }))
  const sig = signBytes(tag, familyId, body, secretKey)
  return b4a.concat([body, sig])
}

function decodeSigned (enc, validate, buf) {
  if (!b4a.isBuffer(buf) || buf.byteLength < 64) fail('INVALID_MESSAGE')
  const body = buf.subarray(0, buf.byteLength - 64)
  const sig = buf.subarray(buf.byteLength - 64)
  const m = validate(decodeCanonical(enc, body, 'INVALID_MESSAGE'))
  m.sig = sig
  return { m, body, sig }
}

const dec = (enc, validate = (m) => m) => (buf) => validate(decodeCanonical(enc, buf, 'INVALID_MESSAGE'))
const encOf = (enc, validate = (m) => m) => (m) => c.encode(enc, validate({ ...m }))

// signer: { signKeyPair: { secretKey } }
const encodeNodeCaps = (familyId, m, signer) => encodeSigned(nodeCapsBody, validateNodeCaps, ETIKET.NODE_CAPS, familyId, m, signer.signKeyPair.secretKey)
const decodeNodeCaps = (buf) => decodeSigned(nodeCapsBody, validateNodeCaps, buf)

const encodeDelegation = (familyId, m, signer) => encodeSigned(delegationBody, validateDelegation, ETIKET.TASK_DELEGATION, familyId, m, signer.signKeyPair.secretKey)
const decodeDelegation = (buf) => decodeSigned(delegationBody, validateDelegation, buf)
// TASK içindeki delegasyonun imzalanan baytları
const delegationBodyOf = (d) => c.encode(delegationBody, d)

// Doğrudan görevde imzalayan isteyendir (hf/task/), alt görevde koordinatör (hf/task-sub/)
const taskTag = (m) => (isSubTask(m) ? ETIKET.TASK_SUB : ETIKET.TASK)
const encodeTask = (familyId, m, signer) => encodeSigned(taskBody, validateTask, taskTag(m), familyId, m, signer.signKeyPair.secretKey)
const decodeTask = (buf) => decodeSigned(taskBody, validateTask, buf)

const encodeCancel = (familyId, m, signer) => encodeSigned(taskCancelBody, (x) => x, ETIKET.TASK_CANCEL, familyId, m, signer.signKeyPair.secretKey)
const decodeCancel = (buf) => decodeSigned(taskCancelBody, (x) => x, buf)

module.exports = {
  ETIKET, MAX_INLINE, MAX_LOG, CLASSES, STATUSES, RESULT_STATUSES, TYPE_RE, VERSION_RE,
  optional, battery, taskEntry, nodeCapsBody, delegationBody, delegation, fileRef, limits, taskBody,
  taskAccept, taskReject, taskProgress, taskResult, taskCancelBody,
  isSubTask, taskTag, digestOf, signBytes, verifySig,
  encodeNodeCaps, decodeNodeCaps, encodeDelegation, decodeDelegation, delegationBodyOf,
  encodeTask, decodeTask, encodeCancel, decodeCancel,
  encodeAccept: encOf(taskAccept),
  decodeAccept: dec(taskAccept),
  encodeReject: encOf(taskReject),
  decodeReject: dec(taskReject),
  encodeProgress: encOf(taskProgress, validateProgress),
  decodeProgress: dec(taskProgress, validateProgress),
  encodeResult: encOf(taskResult, validateResult),
  decodeResult: dec(taskResult, validateResult)
}
