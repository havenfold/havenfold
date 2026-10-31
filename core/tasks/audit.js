// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// audit.js — işçinin görev denetimi (RFC-0002 §6.2, §6.3, §9)
//
// İşçi tam defteri tutar ve her görevi kendi kopyasıyla doğrular. Denetimler tablodaki sırayla yapılır; ilk tutmayan
// TASK_REJECT { taskId, code } olur. "X anında" = seq X uygulandıktan sonraki defter (RFC-0001 §3).
// Gördüğü taskId'leri kendi deadline'larına kadar, alt görev sayılarını delegasyonun süresine kadar saklar.
const b4a = require('b4a')
const sodium = require('sodium-native')
const { v21: { canTask }, zarf: { Z }, ekip: { aydinlatmaVar, yerleri } } = require('@havenfold/core')
const K = require('./encoding')
const { turGirdisi } = require('./capability')

const hex = (b) => b4a.toString(b, 'hex')
const isZero = (b) => b.every((x) => x === 0)
const DAY = 86_400_000
const STANDING_MAX_MS = 30 * DAY
const TASK_MAX_MS = 7 * DAY
const DELEGATION_MAX_MS = 24 * 3_600_000
const SEEN_MAX_MS = 30 * DAY
// Saat toleransı (RFC-0019 §11.2 c): işçi üst sınırlarda 2 dakika tanır; telefon üst sınırın 5 dakika altında üretir
const TOLERANS_MS = 2 * 60_000
const URETIM_PAYI_MS = 5 * 60_000

const BACKUP = 'hf.task.backup'

// §6.2 madde 6: durum → hata. 'bakim' tabloda yok; işçi iş almadığı için MESGUL (İstekler).
const DURUM_HATASI = { mesgul: 'MESGUL', sicak: 'SICAK', pil: 'PIL', bakim: 'MESGUL' }

// Sürüm bildirimi girdisinin ekipte çalışabilmesi: ekip: true yalnız kisiOlcer, yuz ve plaka üçü de false iken (§12.1)
function ekipteIzinli (g) {
  return !!g && g.ekip === true && g.kisiOlcer === false && g.yuz === false && g.plaka === false
}
// Kamera kaynağı kullanan görevler (§12.2)
const KAMERA_RE = /^(hf\.task\.vision|mekan\.task\..+)$/

class Red extends Error {
  constructor (code) { super(code); this.code = code }
}
const red = (code) => { throw new Red(code) }

// Delegasyonun kendisi (§9): isteyenin imzası, süresi. İşçi, koordinatör ve NODE_CAPS isteğinde aynı denetim.
// Dönüş: null (geçerli) ya da hata kodu.
function delegasyonHatasi (L, d, now) {
  const req = L.entity(hex(d.requester))
  if (!b4a.isBuffer(d.sig) || d.sig.byteLength !== 64) return 'IMZA_GECERSIZ'
  if (!req || !K.verifySig(K.ETIKET.TASK_DELEGATION, L.familyId, K.delegationBodyOf(d), d.sig, req.signPub)) return 'IMZA_GECERSIZ'
  if (!(d.expiresAt > now && d.expiresAt <= now + DELEGATION_MAX_MS + TOLERANS_MS)) return 'YETKISIZ'
  if (!d.workers.some((w) => b4a.equals(w, d.coordinatorId))) return 'YETKISIZ' // koordinatör dahil
  if (d.ledgerSeq >= L.len) return 'DEFTER_GERIDE'
  const at = L.pastCursor().at(d.ledgerSeq + 1)
  if (at.sessionRole(hex(d.requester)) !== 'uye' || L.sessionRole(hex(d.requester)) !== 'uye') return 'YETKISIZ'
  return null
}

class Isci {
  // ledger: işçinin tam defteri. me: { memberId } (cihaz kimliği). caps: işçinin kendi son NODE_CAPS alanları.
  // imajlar(type) → sürüm bildirimindeki görev imajı girdisi { ekip, kisiOlcer, yuz, plaka } ya da null (RFC-0005 §12.1;
  // bildirim kök anahtarla imzalıdır, doğrulaması düğümdedir)
  constructor ({ ledger, me, caps = null, now = Date.now, imajlar = () => null }) {
    this.imajlar = imajlar
    this.ledger = ledger
    this.me = me
    this.meHex = hex(me.memberId)
    this.caps = caps
    this.now = now
    this.seen = new Map() // taskIdHex → deadline
    this.parts = new Map() // parentTaskIdHex → { ids: Set<taskIdHex>, until }
    this.tasks = new Map() // kabul edilen: taskIdHex → { task, from }
  }

  // Kişi okuyucusu mu: kayıt katmanının okuyucu kümesi (tam defterden, RFC-0019 4.4)
  _okuyucu (cid, id) {
    const { yetki: { readerSet } } = require('@havenfold/records')
    const col = this.ledger.collections.get(cid)
    return !!col && readerSet(this.ledger, col).has(id)
  }

  setCaps (caps) { this.caps = caps }

  _temizle (now) {
    for (const [id, until] of this.seen) if (until <= now) this.seen.delete(id)
    for (const [id, p] of this.parts) if (p.until <= now) this.parts.delete(id)
    // Süresi geçen kabul edilmiş görev biter; dosya anahtarları sıfırlanır (inceleme görev 4)
    for (const [id, k] of [...this.tasks]) if (k.task.deadline <= now) this.bitir(id)
  }

  // bytes: TASK. from: görevi getiren çift kanalının karşı tarafı (doğrudan oturumda ya da emanet mührünün göndereni).
  // Dönüş: { ok: true, task } ya da { ok: false, code, taskId }. Çözülemeyen mesaj atılır (INVALID_MESSAGE atar).
  // from zorunludur (inceleme görev 7).
  denetle (bytes, { from = null } = {}) {
    const { m: t, body, sig } = K.decodeTask(bytes)
    const now = this.now()
    this._temizle(now)
    try {
      this._denetle(t, body, sig, from, now)
      return { ok: true, task: t }
    } catch (err) {
      if (!(err instanceof Red)) throw err
      for (const i of t.inputs) sodium.sodium_memzero(i.fileKey) // reddedilen görevin anahtarları (görev 11)
      return { ok: false, code: err.code, taskId: t.taskId }
    }
  }

  _denetle (t, body, sig, from, now) {
    const L = this.ledger
    const req = hex(t.requester)
    const id = hex(t.taskId)

    // 0. Görev bu işçiye gönderilmiş
    if (!b4a.equals(t.workerId, this.me.memberId)) red('YANLIS_ISCI')

    // 1. İmzalar
    let d = null
    if (!K.isSubTask(t)) {
      // 1a. Doğrudan görev: isteyenin imzası; başka bir cihazdan gelen doğrudan görev işlenmez (§9).
      // Anahtar defterdeki herhangi bir varlıktan alınır; misafir ya da cihaz isteyen madde 2'de düşer.
      const m = L.entity(req)
      if (!m || !K.verifySig(K.ETIKET.TASK, L.familyId, body, sig, m.signPub)) red('IMZA_GECERSIZ')
      if (from !== req) red('YETKISIZ')
    } else {
      // 1b. Alt görev: delegasyon isteyen imzalı, görev koordinatör imzalı
      d = t.delegation
      if (!d) red('YETKISIZ')
      const coord = L.devices.get(hex(d.coordinatorId))
      const dh = delegasyonHatasi(L, d, now)
      if (dh === 'IMZA_GECERSIZ') red(dh)
      if (!coord || !K.verifySig(K.ETIKET.TASK_SUB, L.familyId, body, sig, coord.signPub)) red('IMZA_GECERSIZ')
      if (dh) red(dh)
      if (!coord.active) red('YETKISIZ')
      if (from !== hex(d.coordinatorId)) red('YETKISIZ')
      if (!b4a.equals(t.parentTaskId, d.taskId)) red('YETKISIZ')
      if (!d.workers.some((w) => b4a.equals(w, this.me.memberId))) red('YETKISIZ')
      if (!d.types.includes(t.type)) red('YETKISIZ')
      if (!b4a.equals(t.requester, d.requester) || !b4a.equals(t.collectionId, d.collectionId)) red('YETKISIZ')
      if (!t.inputs.every((i) => d.inputBlobIds.some((b) => b4a.equals(b, i.blobId)))) red('YETKISIZ')
      // Alt görev belgenin süresini aşamaz ve sürekli olamaz (RFC-0019 §11.2 a)
      if (t.standing !== false || t.deadline > d.expiresAt + TOLERANS_MS) red('YETKISIZ')
      // maxParts'ta yalnız kabul edilen alt görevler sayılır (§11.2 b); aynı taskId'nin tekrarı sayılmaz
      const p = this.parts.get(hex(t.parentTaskId))
      if (p && !p.ids.has(id) && p.ids.size >= d.maxParts) red('YETKISIZ')
    }

    // 2. İsteyen ledgerSeq anında ve bugün aktif üye; misafir ve cihaz görev veremez
    if (t.ledgerSeq >= L.len) red('DEFTER_GERIDE')
    const P = L.pastCursor().at(t.ledgerSeq + 1)
    if (P.sessionRole(req) !== 'uye' || L.sessionRole(req) !== 'uye') red('YETKISIZ')

    // Madde 2'yi geçen görev görülmüş sayılır; en çok 30 gün saklanır (madde 8, inceleme görev 6)
    const tekrar = this.seen.has(id)
    if (!tekrar) this.seen.set(id, Math.min(t.deadline, now + SEEN_MAX_MS))

    // 3. TASK_PERMIT (RFC-0003 §5.11); sürekli görevde isteyen ebeveyn. İki anda da.
    const opts = { continuous: t.standing }
    if (!canTask(P, req, t.type, opts) || !canTask(L, req, t.type, opts)) red('TUR_IZNI_YOK')

    // 4. Koleksiyonda görev erişimi açık ve kasa değil. Yedekte collectionId 16 sıfırdır ve denetim atlanır.
    if (t.type === BACKUP) {
      if (!isZero(t.collectionId)) red('KOLEKSIYON_KAPALI')
    } else {
      for (const X of [P, L]) {
        const col = X.collections.get(hex(t.collectionId))
        if (!col || !col.taskAccess || col.sensitivity === 'kasa') red('KOLEKSIYON_KAPALI')
      }
      // İsteyen koleksiyonun okuyucusu (tam defterden, RFC-0019 4.4)
      if (!this._okuyucu(hex(t.collectionId), req)) red('YETKISIZ')
    }

    // Ekip: kişi ölçen, yüz tanıyan, plaka okuyan imaj çalışmaz; kamera görevi yerin aydınlatması olmadan başlamaz
    // (RFC-0005 §12.1, §12.2). TASK_PERMIT bunları açamaz.
    if (L.kind === 'ekip') {
      if (!ekipteIzinli(this.imajlar(t.type))) red('EKIPTE_YASAK_TUR')
      if (KAMERA_RE.test(t.type) && !aydinlatmaVar(L, L.devices.get(this.meHex)?.placeId)) red('AYDINLATMA_YOK')
      // Yöneticinin sürekli görevi yalnız yönetim alanındaki işçiye (RFC-0005 §13.1, inceleme 7 bulgu 6)
      const kisi = L.canonical(req)
      if (t.standing && kisi && L.members.get(kisi).role === 'yonetici' && !yerleri(L, kisi).includes(L.devices.get(this.meHex)?.placeId)) red('YETKI_ALANI_DISI')
    }

    // 5. Tür ve sürüm; bellek
    const caps = this.caps
    if (!caps || !turGirdisi(caps, t.type, t.version, { standing: t.standing })) red('DESTEK_YOK')
    if (t.limits.ramMB > caps.maxTaskRamMB) red('KAYNAK_YOK')

    // 6. Durum
    if (caps.status !== 'hazir') red(DURUM_HATASI[caps.status] || 'MESGUL')

    // 7. Süre
    const max = t.standing ? STANDING_MAX_MS : TASK_MAX_MS
    if (!(t.deadline > now && t.deadline <= now + max + TOLERANS_MS)) red('SURE_GECERSIZ')

    // 8. Tekrar
    if (tekrar) red('TEKRAR')
  }

  // Denetler ve cevabı üretir: TASK_ACCEPT ya da TASK_REJECT baytları
  al (bytes, { from = null, etaSec = 0 } = {}) {
    const r = this.denetle(bytes, { from })
    if (!r.ok) return { ...r, type: Z.TASK_REJECT, bytes: K.encodeReject({ taskId: r.taskId, code: r.code }) }
    this.tasks.set(hex(r.task.taskId), { task: r.task, from })
    const d = r.task.delegation
    if (d) {
      const pid = hex(r.task.parentTaskId)
      const p = this.parts.get(pid) || { ids: new Set(), until: d.expiresAt }
      p.ids.add(hex(r.task.taskId))
      p.until = Math.max(p.until, d.expiresAt)
      this.parts.set(pid, p)
    }
    return { ...r, type: Z.TASK_ACCEPT, bytes: K.encodeAccept({ taskId: r.task.taskId, etaSec }) }
  }

  // TASK_CANCEL (§6.3): isteyen ya da (alt görevde) koordinatör, etiket hf/task-cancel/
  iptal (bytes) {
    const { m, body, sig } = K.decodeCancel(bytes)
    const id = hex(m.taskId)
    const k = this.tasks.get(id)
    if (!k) throw new Error('GOREV_YOK')
    const t = k.task
    const by = hex(m.by)
    const yetkili = t.delegation ? hex(t.delegation.coordinatorId) : hex(t.requester)
    if (by !== yetkili) throw new Error('YETKISIZ')
    const ent = this.ledger.entity(by)
    if (!ent || !K.verifySig(K.ETIKET.TASK_CANCEL, this.ledger.familyId, body, sig, ent.signPub)) throw new Error('IMZA_GECERSIZ')
    this.bitir(id) // başarılı iptal görevi bitirir (inceleme görev 4)
    return t
  }

  // İş bitince (sonuç gönderildi ya da iptal) girdiler ve dosya anahtarları silinir (§11.1 "Bitiş")
  bitir (taskIdHex) {
    const k = this.tasks.get(taskIdHex)
    if (!k) return false
    for (const i of k.task.inputs) sodium.sodium_memzero(i.fileKey)
    this.tasks.delete(taskIdHex)
    return true
  }
}

module.exports = { Isci, ekipteIzinli, KAMERA_RE, delegasyonHatasi, DURUM_HATASI, STANDING_MAX_MS, TASK_MAX_MS, DELEGATION_MAX_MS, SEEN_MAX_MS, TOLERANS_MS, URETIM_PAYI_MS, BACKUP }
