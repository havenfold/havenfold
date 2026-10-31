// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// health.js — NODE_HEALTH (0xD8) kodlaması ve imzası, eşik tablosu (RFC-0007 §11)
//
// NODE_HEALTH bakım ve uyarı içindir; donanım ayrıntısı taşır ve yalnız ebeveynlere, canlı doğrudan oturumda gider.
// Seri numarası taşımaz. İmza: Ed25519(kimlik, hash('hf/node-health/', familyId, body)).
const c = require('compact-encoding')
const b4a = require('b4a')
const sodium = require('sodium-native')
const { kdf: { hash } } = require('@havenfold/core')

function fail (code) { throw new Error(code) }

function struct (fields) {
  return {
    preencode (state, m) { for (const [k, enc] of fields) enc.preencode(state, m[k]) },
    encode (state, m) { for (const [k, enc] of fields) enc.encode(state, m[k]) },
    decode (state) { const m = {}; for (const [k, enc] of fields) m[k] = enc.decode(state); return m }
  }
}

// Seçimli alan: c.bool varlık bayrağı (RFC-0001 §3)
function secimli (enc) {
  return {
    preencode (s, v) { c.bool.preencode(s, v != null); if (v != null) enc.preencode(s, v) },
    encode (s, v) { c.bool.encode(s, v != null); if (v != null) enc.encode(s, v) },
    decode (s) { return c.bool.decode(s) ? enc.decode(s) : null }
  }
}

const UPDATE = ['guncel', 'indiriliyor', 'pencere-bekliyor', 'onay-bekliyor', 'geri-alindi', 'hata']
const TPM = ['yok', 'var', 'muhur-ok']
const DISK = ['luks-tpm', 'sifresiz', 'uygulama-sifreli']
const LIMIT = ['cekirdek', 'uretici', 'yok']
const DISK_TUR = ['nvme', 'ssd', 'hdd', 'emmc', 'usb']
const SMART = ['iyi', 'uyari', 'kritik', 'bilinmiyor']
const RETIRE = ['yok', 'tasiniyor', 'hazir']

const software = struct([
  ['product', c.string], ['version', c.string], ['versionCode', c.uint], ['channel', c.string], ['keyEpoch', c.uint],
  ['rootFp', c.fixed32], ['lastManifestAt', c.uint], ['update', c.string], ['pendingVersion', c.string],
  ['osSecurityPending', c.uint], ['rebootRequired', c.bool]
])
const platform = struct([['osRelease', c.string], ['kernel', c.string], ['secureBoot', c.bool], ['tpm', c.string], ['disk', c.string], ['recoveryDelivered', c.bool]])
const battery = struct([['percent', c.uint], ['healthPct', c.uint], ['cycles', c.uint], ['tempC', c.int], ['limit', c.string], ['limitStart', c.uint], ['limitStop', c.uint]])
const power = struct([['onAC', c.bool], ['acLoss24h', c.uint], ['battery', secimli(battery)]])
const thermal = struct([['cpuMaxC', c.int], ['hotMinutes24h', c.uint]])
const disk = struct([['kind', c.string], ['sizeGB', c.uint], ['usedPct', c.uint], ['wearPct', c.int], ['smart', c.string], ['reallocated', c.uint], ['tempC', c.int]])
const net = struct([['wired', c.bool], ['wifiDbm', c.int]])
const sleepGuard = struct([['lid', c.bool], ['targetsMasked', c.bool]])

const OLCUM_ALANLARI = [['software', software], ['platform', platform], ['power', power], ['thermal', thermal], ['disks', c.array(disk)], ['net', net], ['sleepGuard', sleepGuard], ['retire', c.string]]
// IPC SAGLIK_ANLIK gövdesi (imzasız ölçümler): NODE_HEALTH'in kimlik, sıra, uyarı ve imza dışındaki alanları
const olcumEnc = struct(OLCUM_ALANLARI)
const govdeEnc = struct([['nodeId', c.fixed16], ['hostId', c.fixed16], ['seq', c.uint], ...OLCUM_ALANLARI, ['warnings', c.array(c.string)]])

const ozet = (familyId, body) => hash('hf/node-health/', familyId, body)
const rootFp = (rootPub) => hash('hf/release-root/', rootPub)

function degerDenetle (m) {
  const s = m.software
  const p = m.platform
  if (!UPDATE.includes(s.update) || !TPM.includes(p.tpm) || !DISK.includes(p.disk) || !RETIRE.includes(m.retire)) fail('INVALID_MESSAGE')
  const b = m.power.battery
  if (b && (!LIMIT.includes(b.limit) || b.percent > 100 || b.healthPct > 100)) fail('INVALID_MESSAGE')
  for (const d of m.disks) if (!DISK_TUR.includes(d.kind) || !SMART.includes(d.smart) || d.usedPct > 100 || d.wearPct < -1) fail('INVALID_MESSAGE')
  if (!m.warnings.every((w) => UYARILAR.includes(w))) fail('INVALID_MESSAGE')
}

// kimlik: { memberId, signKeyPair }. Dönüş: body ‖ sig (64)
function saglikYaz (familyId, kimlik, m) {
  const body = c.encode(govdeEnc, { ...m, nodeId: kimlik.memberId })
  degerDenetle(c.decode(govdeEnc, body))
  const sig = b4a.alloc(64)
  sodium.crypto_sign_detached(sig, ozet(familyId, body), kimlik.signKeyPair.secretKey)
  return b4a.concat([body, sig])
}

// Telefon tarafı: imzacı nodeId'nin kendisi; defterde etkin işçi cihazı ya da kutu üyesi. gonderen (hex): oturumun
// karşı ucu, verilirse nodeId ona eşit olmalı; sonSeq: bu düğümden görülen son seq, verilirse seq ondan büyük olmalı
// (tekrar edilen eski ölçüm STALE_MANIFEST). L.entity(id) → { signPub }
function saglikCoz (L, bytes, { gonderen = null, sonSeq = null } = {}) {
  if (!b4a.isBuffer(bytes) || bytes.byteLength < 64) fail('INVALID_MESSAGE')
  const body = bytes.subarray(0, bytes.byteLength - 64)
  const sig = bytes.subarray(bytes.byteLength - 64)
  let m
  try { m = c.decode(govdeEnc, body) } catch { fail('INVALID_MESSAGE') }
  if (!b4a.equals(c.encode(govdeEnc, m), body)) fail('INVALID_MESSAGE')
  degerDenetle(m)
  const id = b4a.toString(m.nodeId, 'hex')
  if (gonderen !== null && gonderen !== id) fail('UNAUTHORIZED')
  const ent = L.entity(id)
  if (!ent) fail('UNAUTHORIZED')
  const dugum = (L.devices.get(id)?.active && L.devices.get(id).class === 'isci') || (L.members.get(id)?.active && L.members.get(id).role === 'kutu')
  if (!dugum) fail('UNAUTHORIZED')
  if (!sodium.crypto_sign_verify_detached(sig, ozet(L.familyId, body), ent.signPub)) fail('INVALID_SIGNATURE')
  if (sonSeq !== null && !(m.seq > sonSeq)) fail('STALE_MANIFEST')
  return m
}

// --- Eşikler (§11.2) ---------------------------------------------------------------------------------------------

const UYARILAR = ['ISI_SUREKLI', 'PIL_SAGLIK_DUSUK', 'PIL_KRITIK', 'PIL_SICAK', 'PIL_AZ', 'PIL_SINIRI_YOK', 'DISK_ASINMA', 'DISK_KRITIK', 'DISK_DOLU',
  'GUNCELLEME_GECIKTI', 'GUNCELLEME_HATA', 'YENIDEN_BASLATMA', 'SIFRESIZ_DISK', 'KURTARMA_TESLIM_YOK', 'UYKU_KORUMASI_YOK', 'SB_GUNCELLEME', 'WIFI']
const DAY = 86_400_000

// Ölçüm girdisi (o anki değerler ve sayaçlar):
//   cpuC, oncekiDurum, hotMinutes24h, onAC, battery { percent, healthPct, limit } | null, pilSicak45Dk, pilSicak50Dk
//   (sürekli dakika; SurekliSayac), disks [{ wearPct, smart, usedPct, reallocated, oncekiReallocated }],
//   lastManifestAt, update, rebootRequired, rebootRequiredSince, disk, recoveryDelivered, torenAt, lid,
//   targetsMasked, sbPending, wired, simdi
// Dönüş: { status: 'hazir' | 'sicak' | 'pil' | 'bakim', warnings (§11.3 sırasıyla), kapat, yedekKabul, bildir }
// Aynı ölçünün iki eşiği birden aşılırsa yalnız ağır olanı yazılır (healthPct 39 → PIL_KRITIK, PIL_SAGLIK_DUSUK değil).
function esikler (o) {
  const w = new Set()
  let bakim = false
  // İşlemci: > 90 °C sicak; sicak'tan 80 °C altında çıkılır (histerezis)
  const sicak = o.cpuC > 90 || (o.oncekiDurum === 'sicak' && o.cpuC >= 80)
  if (o.hotMinutes24h > 60) w.add('ISI_SUREKLI')
  const b = o.battery || null
  if (b) {
    if (b.healthPct > 0 && b.healthPct < 40) { w.add('PIL_KRITIK'); bakim = true } else if (b.healthPct > 0 && b.healthPct < 60) w.add('PIL_SAGLIK_DUSUK')
    if ((o.pilSicak50Dk || 0) >= 10) { w.add('PIL_KRITIK'); bakim = true } else if ((o.pilSicak45Dk || 0) >= 30) w.add('PIL_SICAK')
    if (!o.onAC && b.percent <= 25) w.add('PIL_AZ')
    if (b.limit === 'yok') w.add('PIL_SINIRI_YOK')
  }
  let yedekKabul = true
  for (const d of o.disks || []) {
    if (d.wearPct >= 90) w.add('DISK_ASINMA')
    if (d.smart === 'kritik' || (Number.isSafeInteger(d.oncekiReallocated) && d.reallocated > d.oncekiReallocated)) { w.add('DISK_KRITIK'); yedekKabul = false }
    if (d.usedPct >= 90) { w.add('DISK_DOLU'); yedekKabul = false }
  }
  const s = o.simdi
  if (o.lastManifestAt !== undefined && s - o.lastManifestAt > 30 * DAY) w.add('GUNCELLEME_GECIKTI')
  if (o.update === 'hata' || o.update === 'geri-alindi') w.add('GUNCELLEME_HATA')
  if (o.rebootRequired && s - o.rebootRequiredSince > 7 * DAY) w.add('YENIDEN_BASLATMA')
  if (o.disk === 'sifresiz') w.add('SIFRESIZ_DISK')
  if (o.disk === 'luks-tpm' && !o.recoveryDelivered && Number.isFinite(o.torenAt) && s - o.torenAt > 7 * DAY) w.add('KURTARMA_TESLIM_YOK')
  if (o.lid === false || o.targetsMasked === false) w.add('UYKU_KORUMASI_YOK')
  if (o.sbPending) w.add('SB_GUNCELLEME')
  if (o.wired === false) w.add('WIFI')
  const status = bakim ? 'bakim' : sicak ? 'sicak' : !o.onAC ? 'pil' : 'hazir'
  const kapat = !!b && !o.onAC && b.percent <= 15 // dosya sistemini korumak için düzgün kapanış
  return { status, warnings: UYARILAR.filter((x) => w.has(x)), kapat, yedekKabul, bildir: w.has('PIL_AZ') }
}

// Sürekli koşul sayacı: koşul kesintisiz sürdükçe dakika döner; kesilince sıfırlanır
class SurekliSayac {
  constructor () { this.bas = null }
  guncelle (kosul, simdi) {
    if (!kosul) { this.bas = null; return 0 }
    if (this.bas === null) this.bas = simdi
    return Math.floor((simdi - this.bas) / 60_000)
  }
}

module.exports = { UYARILAR, olcumEnc, govdeEnc, saglikYaz, saglikCoz, esikler, SurekliSayac, rootFp, secimli, struct }
