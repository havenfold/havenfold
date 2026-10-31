// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// capability.js — yetenek bildirimi NODE_CAPS, sürüm uyumu ve Ev Makinesi kartı (RFC-0002 §4, §5, §13)
//
// Düğüm tarafı yalnız saf hesapları kullanır (maxTaskRamMB, durum); bildirimi denetçi üretir. Telefon her cihazın son
// bildirimini saklar; 15 dakikadan eski bildirim "çevrimdışı" sayılır.
const b4a = require('b4a')
const K = require('./encoding')

const hex = (b) => b4a.toString(b, 'hex')
function fail (code) { throw new Error(code) }

const MIN = 60_000
const CAPS_ARALIK_MS = 5 * MIN // bağlanınca bir kez, sonra 5 dakikada bir
const CEVRIMDISI_MS = 15 * MIN
const SISTEM_PAYI_MB = 1024
const SICAK_UST = 90
const SICAK_ALT = 80

// --- Düğüm tarafı -----------------------------------------------------------------------------------------------

// ramTotalMB − 1024 − Σ(çalışan görevlerin limits.ramMB) − Σ(konteyner uygulamalarına ayrılan bellek), en az 0
function maxTaskRam ({ ramTotalMB, runningRamMB = [], appRamMB = [] }) {
  const sum = (xs) => xs.reduce((a, b) => a + b, 0)
  return Math.max(0, ramTotalMB - SISTEM_PAYI_MB - sum(runningRamMB) - sum(appRamMB))
}

// Durum (§4 tablosu). Sıcaklık 90 °C'nin üstüne çıkınca 'sicak'; 80 °C'nin altına inene kadar 'sicak' kalır.
// Öncelik: sicak, pil, bakim, mesgul (tabloda sıra yok; güvenlik önce).
function durumHesapla ({ onceki = 'hazir', sicakliklar = [], onAC = true, bakim = false, mesgul = false }) {
  const enSicak = sicakliklar.length ? Math.max(...sicakliklar) : -Infinity
  if (enSicak > SICAK_UST || (onceki === 'sicak' && enSicak >= SICAK_ALT)) return 'sicak'
  if (onAC === false) return 'pil'
  if (bakim) return 'bakim'
  if (mesgul) return 'mesgul'
  return 'hazir'
}

// NODE_CAPS kime gider (§4 "Kime gider", §9): topluluğun aktif üyelerine (kutu dahil); bir cihaza yalnız bu düğümü
// listeleyen, süresi geçmemiş bir delegasyonun koordinatörüyse. Misafire gitmez. Uygulama barındıran düğüm (RFC-0011)
// bu çekirdekte yok.
function capsAlicisiMi (L, meHex, peerHex, delegasyonlar = [], now = Date.now()) {
  const rol = L.sessionRole(peerHex)
  if (rol === 'uye') return true
  if (rol !== 'cihaz') return false
  // Belgenin imzası ve süresi de doğrulanır (RFC-0019 §11.2 f); audit.js capability.js'i kullandığı için geç yüklenir
  const { delegasyonHatasi } = require('./audit')
  return delegasyonlar.some((d) => hex(d.coordinatorId) === peerHex && d.workers.some((w) => hex(w) === meHex) && delegasyonHatasi(L, d, now) === null)
}

// --- Sürüm uyumu (§5) ---------------------------------------------------------------------------------------------

// İşçinin sürümü: MAJOR aynı, MINOR istenene eşit ya da büyük
function surumUyar (have, want) {
  const a = K.VERSION_RE.exec(have)
  const b = K.VERSION_RE.exec(want)
  if (!a || !b) return false
  return Number(a[1]) === Number(b[1]) && Number(a[2]) >= Number(b[2])
}

// Bildirimdeki tür girdisi: tür adı aynı, sürüm uyumlu; sürekli görevde standing de açık
function turGirdisi (caps, type, version, { standing = false } = {}) {
  return caps.tasks.find((t) => t.type === type && surumUyar(t.version, version) && (!standing || t.standing)) || null
}

// --- Telefon tarafı -----------------------------------------------------------------------------------------------

// Bildirimi gönderen defterdeki aktif bir bağlı cihaz (sınıfı defterdekiyle aynı) ya da aktif kutu olmalı
function imzaciOf (L, nodeHex, cls) {
  const d = L.devices.get(nodeHex)
  if (d) return d.active && d.class === cls ? d.signPub : null
  const m = L.members.get(nodeHex)
  if (m && m.role === 'kutu' && cls === 'kutu' && L.sessionRole(nodeHex) === 'uye') return m.signPub
  return null
}

class YetenekDefteri {
  constructor ({ ledger, now = Date.now }) {
    this.ledger = ledger
    this.now = now
    this.son = new Map() // nodeHex → { caps, bytes, receivedAt }
  }

  // from: bildirimi getiren oturumun karşı tarafı (verilirse nodeId ile aynı olmalı)
  al (bytes, { from = null } = {}) {
    const { m, body, sig } = K.decodeNodeCaps(bytes)
    const id = hex(m.nodeId)
    if (from !== null && from !== id) fail('YETKISIZ')
    const pub = imzaciOf(this.ledger, id, m.class)
    if (!pub) fail('YETKISIZ')
    if (!K.verifySig(K.ETIKET.NODE_CAPS, this.ledger.familyId, body, sig, pub)) fail('IMZA_GECERSIZ')
    const prev = this.son.get(id)
    if (prev && m.seq <= prev.caps.seq) fail('STALE_MANIFEST')
    this.son.set(id, { caps: m, bytes, receivedAt: this.now() })
    return m
  }

  // Son bildirimi 15 dakikadan eski olmayan ve defterde hâlâ aktif olan düğümler
  cevrimici (now = this.now()) {
    const out = []
    for (const [id, s] of this.son) {
      if (now - s.receivedAt > CEVRIMDISI_MS) continue
      if (!imzaciOf(this.ledger, id, s.caps.class)) continue
      out.push({ id, caps: s.caps, receivedAt: s.receivedAt })
    }
    return out.sort((a, b) => (a.id < b.id ? -1 : 1))
  }

  get (nodeHex) { return this.son.get(nodeHex)?.caps || null }
}

// Ev Makinesi kartı (§13, kurucu §8.8). Kart bağlı cihazların toplamıdır; kutu kimliği karta girmez (birleşik cihazda
// aynı donanım işçi kimliğiyle zaten sayılır). "En büyük tek iş" her zaman verilir (H5).
function evMakinesi (defter, now = defter.now()) {
  const acik = defter.cevrimici(now).filter((n) => n.caps.class !== 'kutu')
  const sum = (f) => acik.reduce((a, n) => a + f(n.caps), 0)
  return {
    cekirdek: sum((x) => x.cores),
    bellekMB: sum((x) => x.ramTotalMB),
    bosDiskGB: sum((x) => x.diskFreeGB),
    acikCihaz: acik.length,
    enBuyukTekIsMB: acik.reduce((a, n) => Math.max(a, n.caps.maxTaskRamMB), 0),
    calisan: acik.flatMap((n) => n.caps.running.map((r) => ({ nodeId: n.id, taskId: hex(r.taskId), type: r.type, pct: r.pct })))
  }
}

module.exports = {
  CAPS_ARALIK_MS, CEVRIMDISI_MS, SISTEM_PAYI_MB, SICAK_UST, SICAK_ALT,
  maxTaskRam, durumHesapla, capsAlicisiMi, surumUyar, turGirdisi, imzaciOf, YetenekDefteri, evMakinesi
}
