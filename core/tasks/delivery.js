// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// delivery.js — görev zarflarının yolları ve sonucun teslimi (RFC-0002 §4, §6.1, §6.3; kurucu §11)
//
// Yollar: doğrudan oturum (Noise), kutu emaneti (RFC-0003 §6.4 mührü, anahtar derive(pair, 'hf/task/')), Posta Kutusu.
// Görev zarfları Posta Kutusu'na gitmez; NODE_CAPS emanete de gitmez (§4 "Kime gider").
// İsteyen çevrimdışıysa işçi TASK_RESULT'ı kutuya HOLD { forMemberId, fromMemberId, sealed } ile bırakır; kutu yoksa
// sonuç işçide 7 gün bekler. Sonucu koleksiyona isteyen telefon yazar; işçi yazmaz (sürekli görev hariç).
const b4a = require('b4a')
const { zarf: { Z, GOREV }, seal: { sealEnvelope, openEnvelope } } = require('@havenfold/core')
const sodium = require('sodium-native')
const { kdf: { hash } } = require('@havenfold/core')
const { encryptBlob, encryptBlobVektor } = require('@havenfold/records').dosya
const K = require('./encoding')

const hex = (b) => (typeof b === 'string' ? b : b4a.toString(b, 'hex'))
function fail (code) { throw new Error(code) }

const YOL = { DOGRUDAN: 'dogrudan', EMANET: 'emanet', POSTA: 'posta' }
const BEKLEME_MS = 7 * 86_400_000
const ILERLEME_ARALIK_MS = 10_000

function yolUygun (type, yol) {
  if (!GOREV.includes(type)) return false
  if (yol === YOL.DOGRUDAN) return true
  if (yol === YOL.EMANET) return type !== Z.NODE_CAPS
  return false
}

// Emanet mührü (RFC-0019 4.10): AD'deki zarf kimliği taskId ‖ sıra; sıra aynı görevde gönderenin artan sayacıdır.
// Mührün AD'si 16 baytlık kimlik taşıdığı için kimlik hash('hf/task-zarf/', taskId, u64be(sıra))[0..16]'dır. HOLD
// nesnesi türü ve zarf kimliğini taşır.
const zarfKimligi = (taskId, sira) => hash('hf/task-zarf/', taskId, sira).subarray(0, 16)

function emanetMuhurle (pair, fromId, forId, type, bytes, taskId, sira) {
  if (!yolUygun(type, YOL.EMANET)) fail('PATH_FORBIDDEN')
  if (!Number.isSafeInteger(sira) || sira < 0) fail('INVALID_ORDER')
  const zarfId = zarfKimligi(taskId, sira)
  return { forMemberId: forId, fromMemberId: fromId, type, zarfId, sealed: sealEnvelope(pair, fromId, forId, type, bytes, zarfId) }
}

function emanetAc (pair, hold) {
  if (!yolUygun(hold.type, YOL.EMANET)) fail('PATH_FORBIDDEN')
  return openEnvelope(pair, hold.fromMemberId, hold.forMemberId, hold.type, hold.sealed, hold.zarfId)
}

// Günlük en çok 4 KB (UTF-8 karakteri bölünmeden)
function logKirp (s) {
  if (b4a.byteLength(s) <= K.MAX_LOG) return s
  let out = ''
  for (const ch of s) {
    if (b4a.byteLength(out + ch) > K.MAX_LOG) break
    out += ch
  }
  return out
}

// Çıktı (§6.3): ≤ 32 KB satır içi; büyükse yeni rastgele fileKey ile dosya, BLOB_DATA ile gider
// fileKey dışarıdan verilemez; her çıktıya yeni rastgele anahtar (inceleme görev 10)
const ciktiHazirla = (data, { mime = 'application/octet-stream' } = {}) => hazirla(data, mime, encryptBlob)

// Yalnız test vektörleri: sabit fileKey
const ciktiHazirlaVektor = (data, { mime = 'application/octet-stream', fileKey }) => hazirla(data, mime, (d) => encryptBlobVektor(d, fileKey))

function hazirla (data, mime, sifrele) {
  if (data.byteLength <= K.MAX_INLINE) return { inline: data, outputs: [], blob: null }
  const blob = sifrele(data)
  return { inline: b4a.alloc(0), outputs: [{ blobId: blob.blobId, fileKey: blob.fileKey, size: blob.size, mime }], blob }
}

// İşçide teslim edilemeyen sonuçlar (kutu yok, isteyen çevrimdışı): 7 gün bekler, sonra silinir
class SonucKutusu {
  constructor ({ now = Date.now } = {}) {
    this.now = now
    this.m = new Map() // taskIdHex → { requester, bytes, at }
  }

  ekle (taskId, requester, bytes) { this.m.set(hex(taskId), { requester: hex(requester), bytes, at: this.now() }) }

  // Isteyen bağlanınca gönderilecekler
  bekleyenler (requester) {
    this.temizle()
    return [...this.m].filter(([, v]) => v.requester === hex(requester)).map(([id, v]) => ({ taskId: id, bytes: v.bytes }))
  }

  // Sonuç baytları dosya anahtarlarını taşır: silinirken sıfırlanır (inceleme görev 11)
  teslimEdildi (taskId) {
    const v = this.m.get(hex(taskId))
    if (!v) return false
    sodium.sodium_memzero(v.bytes)
    return this.m.delete(hex(taskId))
  }

  temizle (now = this.now()) {
    const silinen = []
    for (const [id, v] of this.m) if (now - v.at >= BEKLEME_MS) { sodium.sodium_memzero(v.bytes); this.m.delete(id); silinen.push(id) }
    return silinen
  }
}

// TASK_PROGRESS en çok 10 saniyede bir (işçi tarafı)
class IlerlemeSiniri {
  constructor ({ now = Date.now } = {}) { this.now = now; this.son = new Map() }
  gonderilsinMi (taskId, now = this.now()) {
    const k = hex(taskId)
    const s = this.son.get(k)
    if (s !== undefined && now - s < ILERLEME_ARALIK_MS) return false
    this.son.set(k, now)
    return true
  }

  unut (taskId) { this.son.delete(hex(taskId)) }
}

// Sonuç nasıl gider: doğrudan bağlantı varsa doğrudan; yoksa defterde aktif kutu varsa emanet; yoksa işçide bekler
function sonucYolu (L, { dogrudan }) {
  if (dogrudan) return YOL.DOGRUDAN
  return L.boxIds().length ? YOL.EMANET : 'bekle'
}

module.exports = { YOL, BEKLEME_MS, ILERLEME_ARALIK_MS, yolUygun, zarfKimligi, emanetMuhurle, emanetAc, logKirp, ciktiHazirla, ciktiHazirlaVektor, SonucKutusu, IlerlemeSiniri, sonucYolu }
