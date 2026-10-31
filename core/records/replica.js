// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// replica.js — bir topluluğun kayıt verisi: işlemler, geçerlilik, birleştirme, anahtarlar, kesimler (RFC-0001)
//
// Taşıyıcıdan bağımsızdır: gelen baytları receive* ile alır, göndereceklerini outbox'a koyar. Durum geçerli işlemler
// kümesinin fonksiyonudur (§5); geçerlilik saate ve geliş sırasına bağlı değildir (§7). Defter dışarıda tutulur;
// her defter değişikliğinden sonra sync() çağrılır.
const b4a = require('b4a')
const sodium = require('sodium-native')
const { kdf: { hash }, zarf: { Z } } = require('@havenfold/core')
const { OP, encodeInner, decodeInner, decodeRecDrop, recDrop, MAX_OP_BYTES } = require('./encoding')
const { Hlc, msOf, tooFarAhead, MAX_FUTURE_QUEUE } = require('./hlc')
const { reduceAll, view, appendRecordId, newRecordId, cmp, stamp } = require('./merge')
const { Yetki, erisimVar } = require('./permission')
const I = require('./operation')
const A = require('./key')
const K = require('./cutoff')
const { checkWrite } = require('./fields')
const { sinifaUyar } = require('./class')
const { ekip: { gecerliSure } } = require('@havenfold/core')
const { MAX_FIELDS } = require('./encoding')
const c = require('compact-encoding')

const hex = (b) => b4a.toString(b, 'hex')
const unhex = (s) => b4a.from(s, 'hex')
function fail (code) { throw new Error(code) }
const YEDEK_URETEN_MS = 10 * 60_000

// §12.1, RFC-0019 §11.1 o: mezara yalnız TEMIZLENDI ve imzası doğrulanmış işlemin kesin retleri (koşul 4, 5, 6) girer.
// Çözme ya da biçim hatası, bilinmeyen yazar, şifre çözme ve imza hatası mezarsız atılır (opId imzayı kapsamaz;
// bozulmuş bir kopya gerçek işlemi gömebilirdi) ve bunlar için REC_PRUNE gönderilmez.
// Misafirin bırakmasında atılma nedenleri (RFC-0030 §4 koşul 3–6); hepsi defter ve olay içeriğine bağlı, kesin
const MISAFIR_KODLARI = ['TYPE_NOT_ALLOWED', 'SUBJECT_NOT_ALLOWED', 'EXTRA_FORBIDDEN', 'DROP_TOO_LARGE']
const MAX_MISAFIR_BIRAKMA = 4096
const TOMB_CODES = new Set(['PURGED', 'NO_PERMISSION', 'EPOCH_MISMATCH', 'INVALID_OPERATION_TYPE', 'INVALID_DROP_KEY', 'INVALID_RECORD_ID', 'PERSON_EVENT', ...MISAFIR_KODLARI])
// İmzası doğrulanmamış girdide aynı opId için en çok bu kadar farklı kopya tutulur (§11.1 n)
const MAX_KOPYA = 4

const dropOpIdOf = (w) => hash('hf/rec-drop-op/', w.collectionId, w.dropKeyHash, w.sealed)
const dropSigDigest = (familyId, dropOpId) => hash('hf/rec-drop-sig/', familyId, dropOpId)

// Ekipte cihaz kaydının öznesi: topluluk, kayıt ya da defterde var olan yer, varlık, cihaz (RFC-0006 §4.3, inceleme 7
// bulgu 7). Üye kimliği yer: ya da device: diye yazılamaz.
function ekipOznesi (L, subj) {
  if (subj === 'topluluk') return true
  const m = /^(yer|varlik|device|kayit):([0-9a-f]{32})$/.exec(subj)
  if (!m) return false
  if (m[1] === 'kayit') return true
  if (L.members.has(m[2])) return false
  return m[1] === 'yer' ? L.places.has(m[2]) : m[1] === 'varlik' ? L.beings.has(m[2]) : L.devices.has(m[2])
}

// Defterin gerisinde kalan (ileri dönemli) REC_KEY ve REC_CUTOFF bekletilir; sayısı sınırlı (açılış öncesi inceleme):
// kötü niyetli eş ileri epochSeq'li iletiyle belleği ve kalıcı durumu büyütemez. Dolunca en eski düşer; defter
// yetişince eşitleme anahtarı yeniden ister.
const BEKLEYEN_EN_COK = 256
function bekleyeEkle (liste, bytes) {
  liste.push(b4a.from(bytes))
  if (liste.length > BEKLEYEN_EN_COK) liste.splice(0, liste.length - BEKLEYEN_EN_COK)
}

class Replika {
  // ledger: @havenfold/core Ledger (dışarıda güncellenir). me: { memberId, signKeyPair } — üye ya da cihaz.
  // otomatikAnahtar: sıralamada ilk okuyucu dönem anahtarını kendiliğinden üretir (vektörlerde kapalı)
  // kesimErtele (cid → bool): bu koleksiyonun kesimi şimdi verilmez, ertelenir (telefonda kasa kilitliyken işlemler
  // çözülmemiştir, geçerli küme boş görünür; RFC-0027 §9 h). Ertelenen kesimler ertelenenKesimleriVer() ile verilir.
  constructor ({ ledger, me, hlc = null, now = Date.now, otomatikAnahtar = true, kesimErtele = null }) {
    this.otomatikAnahtar = otomatikAnahtar
    this.kesimErtele = kesimErtele
    // "cid|author|seq|hash" → olay uygulandığında elde olan aday işlemler (opId hex; kalıcı: worklet durumda tutar)
    this.ertelenenKesimler = new Map()
    this.ledger = ledger
    this.me = me
    this.meHex = hex(me.memberId)
    this.hlc = hlc || new Hlc()
    this.now = now
    this.yetki = new Yetki()
    this.keys = new A.KeyStore()
    this.cutoffs = new K.CutoffStore()
    this.ops = new Map() // opIdHex → { kind, bytes, wire, opId, cid, inner, author, status, code }
    this.tomb = new Map() // opIdHex → cid (mezar listesi, §12.1; kutuya REC_PRUNE ile bildirilir)
    this.pruned = new Set() // kutuya budama isteği gönderilen opId'ler
    this.cleaned = new Map() // "cid|recordId" → 'hepsi' (süreli kayıt) ya da deletedAt damgası (§13)
    this.pendingKeys = []
    this.pendingCutoffs = []
    this.writeQueue = []
    this.outbox = []
    this.donemGorulme = new Map() // "cid|seq|hash" → ilk görülme anı (anahtar üretimi yedeği, RFC-0019 §11.1 h)
  }

  get familyId () { return this.ledger.familyId }

  // --- Defter değişince --------------------------------------------------------------------------------------

  sync () {
    this._catchUp()
    const keys = this.pendingKeys.splice(0)
    for (const b of keys) this.receiveKey(b)
    const cuts = this.pendingCutoffs.splice(0)
    for (const b of cuts) this.receiveCutoff(b)
    this._reevaluate()
    this._autoKeys()
    this._joinPackages()
    this._flushWrites()
    this.temizle()
  }

  // §13 temizlik (belirlenimci: koleksiyonun verisine bağlı)
  temizle () { return require('./cleanup').temizle(this) }

  // Temizlenen işlem: silinir, mezara girer (kutudan REC_PRUNE ile budanır)
  _purge (o) {
    const k = hex(o.opId)
    if (!this.ops.has(k)) return 0
    this.ops.delete(k)
    this.tomb.set(k, o.cid)
    return 1
  }

  // Yetki tablosunu deftere yetiştirir; yeni biten aralıklar için kesim çıkarır. Gelen her mesajdan önce de çağrılır,
  // yoksa geride kalmış tabloyla geçerli bir işlem yetkisiz sayılıp mezara girebilirdi.
  _catchUp () {
    if (this.yetki.shadow.len === this.ledger.len && (this.ledger.len === 0 || b4a.equals(this.yetki.shadow.head, this.ledger.head))) return
    const { from, rebuilt } = this.yetki.update(this.ledger)
    // Çatallanma: başka dalın dönem anahtarları atılır (RFC-0019 §11.1 f)
    if (rebuilt) this.keys.dalaUydur((cid, seq) => this.yetki.epoch(cid, seq)?.hash || null)
    this._issueCutoffs(from)
    this._joinPackages()
  }

  // §9.4: okuyucu eklenince, olaydan sonra okuyucu olan ve sıralamada ilk olan üye anahtar paketini gönderir.
  // history: true ise bütün geçmiş dönemler, false ise yalnız katıldığı dönemler; kesimler de gider.
  // RFC-0019 §11.1 g, m: paket yalnız katılan kimlik şu an okuyucuysa gider; katılmadan önceki dönemler history: true ise,
  // katılmadan sonraki her dönemde ise o dönemde okuyucu olmak gerekir (çıkarılmış okuyucuya yeni anahtar gitmez).
  _joinPackages () {
    this.joinSent = this.joinSent || new Set()
    const simdi = this.ledger.len - 1
    for (const [cid, st] of this.yetki.cols) {
      const col = this.ledger.collections.get(cid)
      for (const j of st.joins) {
        if (j.id === this.meHex || !this._erisimVar(j.id)) continue
        // Alıcı kimlik şu an aktif okuyucu olmalı (RFC-0019 §11.1 m); kişi genişlemesi yalnız dönem seçimindedir
        if (!this.yetki.isReader(cid, j.id, simdi)) continue
        // Aynı olayla katılanların anahtarı yoktur: gönderen, olaydan önce de okuyucu olanlardan seçilir (D35); öyle
        // biri yoksa (koleksiyonun bütün okuyucuları yeni) eski kural
        const ayniOlay = new Set(st.joins.filter((x) => x.seq === j.seq).map((x) => x.id))
        const adaylar = this.yetki.readersAt(cid, j.seq).filter((id) => id !== j.id && this.ledger.members.has(id))
        const eskiler = adaylar.filter((id) => !ayniOlay.has(id))
        const roles = new Map((eskiler.length ? eskiler : adaylar).map((id) => [id, this.ledger.members.get(id).role]))
        if (A.orderReaders(roles)[0] !== this.meHex) continue
        for (const ep of this.yetki.epochs(cid)) {
          if (!this.keys.has(cid, ep.seq, ep.hash)) continue
          const once = ep.seq < j.seq
          if (once ? !col.history && !this._kisiOkuyucu(cid, j.id, ep.seq) : !this._kisiOkuyucu(cid, j.id, ep.seq)) continue
          const k = [cid, j.id, ep.seq, hex(ep.hash), this.keys.entries(cid, ep.seq, ep.hash).length].join('|')
          if (this.joinSent.has(k)) continue
          this.joinSent.add(k)
          const drops = this.keys.dropsOf(cid).filter((d) => this.yetki.dropKeysInEpoch(cid, ep.seq).some((k) => b4a.equals(k, d.pub)))
          const bytes = A.encodeRecKey({ collectionId: unhex(cid), epochSeq: ep.seq, epochHash: ep.hash, keys: this.keys.entries(cid, ep.seq, ep.hash), dropSecrets: drops.map((d) => ({ dropKeyHash: A.dropKeyHashOf(d.pub), secret: d.secret })) })
          this.outbox.push({ type: Z.REC_KEY, cid, bytes, to: [j.id] })
        }
        for (const b of this.cutoffs.messagesOf(cid)) {
          const k = [cid, j.id, hex(b)].join('|')
          if (this.joinSent.has(k)) continue
          this.joinSent.add(k)
          this.outbox.push({ type: Z.REC_CUTOFF, cid, bytes: b, to: [j.id] })
        }
      }
    }
  }

  // Ekipte süresi dolmuş (ya da TERM'i olmayan) geçiciye anahtar ve veri gönderilmez (RFC-0005 §9.1 madde 1–2)
  _erisimVar (id) { return erisimVar(this.ledger, id, this.now()) }

  // RFC-0022 a: süresi dolmuş (ya da TERM'siz) geçicinin okuyucu olduğu koleksiyonlar için yönetim telefonuna öneri.
  // Yeni dönem okuyucu çıkaran bir defter olayıyla açılır; önerilen olay geçicinin REMOVE_MEMBER'ıdır (tek dokunuş).
  // Dönüş: [{ collectionId, geciciler, olay }] (yönetimde değilse boş)
  yeniDonemOnerileri () {
    const L = this.ledger
    if (L.kind !== 'ekip' || !L.authorityIds().includes(this.meHex)) return []
    const seq = L.len - 1
    const out = []
    for (const cid of [...this.yetki.cols.keys()].sort()) {
      const geciciler = this.yetki.readersAt(cid, seq).filter((id) => L.members.get(id)?.role === 'gecici' && !this._erisimVar(id)).sort()
      if (geciciler.length) out.push({ collectionId: cid, geciciler, olay: 'REMOVE_MEMBER', wipe: false }) // RFC-0023 98
    }
    return out
  }

  // Kişinin (RFC-0017 §5) herhangi bir kimliği — ana ve ek kimlikler ile cihaz değişimi zincirleri — seq anında
  // koleksiyonun okuyucusu muydu
  _kisiOkuyucu (cid, idHex, seq) {
    const L = this.ledger
    const ids = new Set(K.rotationChain(L, idHex))
    const kisi = L.members.has(idHex) ? L.personIdOf(idHex) : null
    if (kisi) {
      for (const [id, m] of L.members) if (m.personOf === kisi || id === kisi || L.personIdOf(id) === kisi) for (const x of K.rotationChain(L, id)) ids.add(x)
    }
    return [...ids].some((id) => this.yetki.isReader(cid, id, seq))
  }

  // §8.3 kural 2–5: olay uygulanır uygulanmaz, yayımlayanın o anki geçerli kümesindeki (koşul 1–6) işlemler. Kasa
  // kilitliyken (kesimErtele) yayımlayabilecek üye kesimi erteler: işlemleri çözülmemiş, geçerli kümesi eksiktir; kesim
  // kilit açılınca, o anki geçerli kümeyle bir kez verilir (RFC-0027 §9 h)
  _issueCutoffs (fromSeq) {
    const L = this.ledger
    for (const cid of this.yetki.cols.keys()) {
      for (const iv of this.yetki.endedIntervals(cid)) {
        if (iv.to < fromSeq) continue
        const key = K.CutoffStore.key(cid, iv.authorId, iv.to, L.hashAt(iv.to))
        if (this.cutoffs.issued.has(key) || this.ertelenenKesimler.has(key)) continue
        if (!K.canIssue(L, this.yetki, cid, iv.authorId, this.meHex, iv.to)) { this.cutoffs.issued.add(key); continue }
        if (typeof this.kesimErtele === 'function' && this.kesimErtele(cid)) {
          // Kural 2 korunur: liste olay uygulandığında elde olan işlemlerden çıkar. Çözülmemiş işlemin yazarı bilinmez:
          // aday sayılır, kilit açılınca yazar ve aralık yeniden denetlenir
          const aday = [...this.ops.values()].filter((o) => o.cid === cid && (o.inner ? o.author === iv.authorId : (o.author === undefined || o.author === iv.authorId))).map((o) => hex(o.opId))
          this.ertelenenKesimler.set(key, aday)
          continue
        }
        this.cutoffs.issued.add(key)
        this._kesimVer(cid, iv)
      }
    }
  }

  // Ertelenen kesimler (kasa kilidi açılınca): ertelenmesi süren koleksiyonunki beklemede kalır; her biri bir kez
  ertelenenKesimleriVer () {
    if (!this.ertelenenKesimler.size) return 0
    this._catchUp()
    const L = this.ledger
    let n = 0
    for (const cid of this.yetki.cols.keys()) {
      if (typeof this.kesimErtele === 'function' && this.kesimErtele(cid)) continue
      for (const iv of this.yetki.endedIntervals(cid)) {
        const key = K.CutoffStore.key(cid, iv.authorId, iv.to, L.hashAt(iv.to))
        if (!this.ertelenenKesimler.has(key)) continue
        const aday = new Set(this.ertelenenKesimler.get(key))
        this.ertelenenKesimler.delete(key)
        if (this.cutoffs.issued.has(key)) continue
        this.cutoffs.issued.add(key)
        this._kesimVer(cid, iv, aday)
        n++
      }
    }
    if (n) this._reevaluate() // kendi verdiği kesim kendi kopyasında da işlemleri geçerli kılar
    // Dalda artık olmayan (çatallanmayla düşen) ertelenmiş anahtarlar
    for (const key of [...this.ertelenenKesimler.keys()]) {
      const [cid, author, seq, h] = key.split('|')
      const iv = this.yetki.cols.has(cid) && this.yetki.endedIntervals(cid).find((x) => x.authorId === author && x.to === Number(seq))
      if (!iv || hex(L.hashAt(iv.to)) !== h) this.ertelenenKesimler.delete(key)
    }
    return n
  }

  // aday: ertelenen kesimde olay anında elde olan işlemler (yoksa bugünkü bütün işlemler)
  _kesimVer (cid, iv, aday = null) {
    const L = this.ledger
    // Bekletilen (ileri saatli) işlem henüz geçerli kümede değildir (inceleme kayıt 13)
    const list = [...this.ops.values()].filter((o) => o.cid === cid && o.author === iv.authorId && o.base === 'ok' && o.code !== 'FUTURE_CLOCK' &&
      o.inner.ledgerSeq >= iv.from && o.inner.ledgerSeq < iv.to && (!aday || aday.has(hex(o.opId)))).map((o) => o.opId)
    const have = this.cutoffs.union(cid, iv.authorId, iv.to, L.hashAt(iv.to))
    if (list.every((id) => have.has(hex(id)))) return // kural 5
    const msgs = K.makeCutoff({ familyId: this.familyId, collectionId: unhex(cid), authorId: unhex(iv.authorId), eventSeq: iv.to, eventHash: L.hashAt(iv.to), opIds: list, issuer: this.me })
    for (const m of msgs) {
      this.cutoffs.addPart(K.decodeCutoff(m), m)
      this.outbox.push({ type: Z.REC_CUTOFF, cid, bytes: m })
    }
  }

  // --- İşlem alma ------------------------------------------------------------------------------------------------

  // kind: 0 REC_OP, 1 REC_DROP. Dönüş: { opId, status, code }
  receiveOp (bytes, kind = 0) {
    if (kind !== 0 && kind !== 1) return { opId: null, status: 'reddedildi', code: 'INVALID_MESSAGE' }
    this._catchUp()
    let entry
    try {
      if (kind === 0) {
        const { wire, opId } = I.peekOp(bytes)
        entry = { kind, bytes: b4a.from(bytes), wire, opId, cid: hex(wire.collectionId) }
      } else {
        if (bytes.byteLength > MAX_OP_BYTES) fail('OPERATION_TOO_LARGE')
        const wire = decodeRecDrop(bytes)
        entry = { kind, bytes: b4a.from(bytes), wire, opId: dropOpIdOf(wire), cid: hex(wire.collectionId) }
      }
    } catch (err) {
      return { opId: null, status: 'reddedildi', code: err.message }
    }
    const k = hex(entry.opId)
    if (this.tomb.has(k)) return { opId: k, status: 'reddedildi', code: 'TOMBSTONED' }
    const var_ = this.ops.get(k)
    if (var_) {
      // İmzası henüz doğrulanmamış girdi opId'yi kilitlemez: farklı baytlı kopya alternatif olarak saklanır (§11.1 n)
      if (!var_.sigOk && !b4a.equals(var_.bytes, entry.bytes) && !(var_.alternatifler || []).some((x) => b4a.equals(x.bytes, entry.bytes))) {
        var_.alternatifler = var_.alternatifler || []
        if (var_.alternatifler.length + 1 < MAX_KOPYA) {
          var_.alternatifler.push({ bytes: entry.bytes, wire: entry.wire })
          return { opId: k, status: var_.status, code: 'DUPLICATE' }
        }
      }
      return { opId: k, status: var_.status, code: 'REPLAY' }
    }
    this.ops.set(k, entry)
    this._evaluate(entry)
    if (entry.status === 'bekliyor' && entry.code === 'FUTURE_CLOCK' && this._futureCount() > MAX_FUTURE_QUEUE) {
      this.ops.delete(k)
      return { opId: k, status: 'reddedildi', code: 'QUEUE_FULL' }
    }
    return { opId: k, status: entry.status, code: entry.code }
  }

  _futureCount () { let n = 0; for (const o of this.ops.values()) if (o.code === 'FUTURE_CLOCK') n++; return n }

  _reevaluate () {
    for (const o of [...this.ops.values()]) this._evaluate(o)
  }

  // Koşullar 1–6 (base) ve 7 (kesim). Ret: mezar ya da (başka dal) atma.
  _evaluate (o) {
    const r = this._base(o)
    o.base = r.ok ? 'ok' : r.status
    if (!r.ok) {
      o.status = r.status
      o.code = r.code
      if (r.status === 'reddedildi') {
        this.ops.delete(hex(o.opId))
        if (TOMB_CODES.has(r.code)) this.tomb.set(hex(o.opId), o.cid)
      }
      return
    }
    // Temizlenmiş kayda sonradan gelen işlem kaydedilmez (§13, RFC-0006 §14.3); silme ve tür işlemi muaftır
    const cl = this.cleaned.get(o.cid + '|' + hex(o.inner.recordId))
    const muaf = cl && cl !== 'hepsi' && (b4a.equals(o.opId, cl.opId) || (cl.typeOpId && b4a.equals(o.opId, cl.typeOpId)))
    if (cl && !muaf && (cl === 'hepsi' || o.inner.hlc < cl.hlc)) {
      o.status = 'reddedildi'
      o.code = 'PURGED'
      this._purge(o)
      return
    }
    if (tooFarAhead(o.inner.hlc, this.now())) { o.status = 'bekliyor'; o.code = 'FUTURE_CLOCK'; return }
    const k = this._cutoffStatus(o)
    o.status = k.status
    o.code = k.code
    // HLC yalnız geçerli kümeye giren ve ileri saat sınırındaki işlemden gözlenir (RFC-0019 §11.1 a)
    if (o.status === 'gecerli') this.hlc.observe(o.inner.hlc)
  }

  // Denetim sırası (RFC-0019 §11.1 o): çözme → defter dalı (koşul 3) → yazar ve imza (koşul 2) → yetki (4–6).
  _base (o) {
    const L = this.ledger
    if (!o.inner) {
      try {
        o.inner = o.kind === 0 ? this._openOp(o) : this._openDrop(o)
      } catch (err) {
        // Bilinmeyen sürüm mezara girmez, bekler (§11.1 p)
        if (err.message === 'NO_KEY' || err.message === 'VERSION_UNSUPPORTED') return { ok: false, status: 'bekliyor', code: err.message }
        return { ok: false, status: 'reddedildi', code: err.message }
      }
      o.author = hex(o.inner.authorId)
    }
    const inner = o.inner
    // 3: defter — başka dalın işlemi yetkisiz sayılıp mezara girmez
    if (inner.ledgerSeq >= L.len) return { ok: false, status: 'bekliyor', code: 'LEDGER_BEHIND' }
    if (!b4a.equals(inner.ledgerHash, L.hashAt(inner.ledgerSeq))) return { ok: false, status: 'reddedildi', code: 'LEDGER_FORK' }
    // 2: imza, iç authorId'nin anahtarıyla; bozuksa sıradaki kopya denenir (§11.1 n)
    if (!o.sigOk) {
      const ent = L.entity(o.author)
      if (!ent) return { ok: false, status: 'reddedildi', code: 'UNKNOWN_AUTHOR' }
      const dogru = (w) => o.kind === 0
        ? I.verifyOpSig(this.familyId, o.opId, w.sig, ent.signPub)
        : sodium.crypto_sign_verify_detached(w.sig, dropSigDigest(this.familyId, o.opId), ent.signPub)
      while (!dogru(o.wire)) {
        const alt = o.alternatifler && o.alternatifler.shift()
        if (!alt) { o.inner = null; return { ok: false, status: 'reddedildi', code: 'INVALID_SIGNATURE' } }
        o.bytes = alt.bytes
        o.wire = alt.wire
      }
      o.sigOk = true
      o.alternatifler = null
    }
    // 4: yetki
    if (!this.yetki.isWriter(o.cid, o.author, inner.ledgerSeq)) return { ok: false, status: 'reddedildi', code: 'NO_PERMISSION' }
    // Örtük SOS izni (RFC-0031 §4.1) yalnız hf.sos içindir: GRANT_WRITE'ı olmayan misafirin başka türü yazarsızdır
    if (L.grants.has(o.author) && inner.type !== 'hf.sos' && !(this.yetki.birakmaIzni(o.cid, o.author, inner.ledgerSeq) || []).some((k) => !k.ortuk)) {
      return { ok: false, status: 'reddedildi', code: 'NO_PERMISSION' }
    }
    // Ekip: cihazın bıraktığı kayıt kişi öznesi taşıyamaz (RFC-0005 §12.1, kişi başına ölçüm yok)
    if (L.kind === 'ekip' && o.kind === 1) {
      const subj = inner.fields.find((f) => f.name === '_subj')?.value
      if (typeof subj !== 'string' || !ekipOznesi(L, subj)) return { ok: false, status: 'reddedildi', code: 'PERSON_EVENT' }
    }
    // Ekip: işlem anında geçici olan yazarın hlc'si geçerli TERM'i aşamaz (RFC-0005 §9.1 madde 3). Kesin ret değildir:
    // yeni TERM gelince küme yeniden hesaplanır.
    if (L.kind === 'ekip' && this.yetki.roleAt(o.author, inner.ledgerSeq) === 'gecici') {
      const bitis = gecerliSure(L, o.author)
      if (bitis !== null && msOf(inner.hlc) > bitis) return { ok: false, status: 'haric', code: 'TERM_EXPIRED' } // çalışan olduysa TERM yok sayılır
    }
    // 6: tür — append-event yalnız cihaz yazarlarına ve GRANT_WRITE izni olan misafire (RFC-0030 §4); put ve del onlara kapalı
    const birakan = L.devices.has(o.author) || L.grants.has(o.author)
    if (birakan !== (inner.op === OP.APPEND) || birakan !== (o.kind === 1)) return { ok: false, status: 'reddedildi', code: 'INVALID_OPERATION_TYPE' }
    if (L.grants.has(o.author)) {
      const code = this._misafirBirakmasi(o)
      if (code) return { ok: false, status: 'reddedildi', code }
    }
    if (o.kind === 0) {
      // 5: dönem
      if (!this.yetki.epochAllowed(o.cid, inner.ledgerSeq, o.wire.epochSeq)) return { ok: false, status: 'reddedildi', code: 'EPOCH_MISMATCH' }
    } else {
      // §10: ledgerSeq anında yürürlükteki dropKey; recordId kuralı
      const dk = this.yetki.dropKeyAt(o.cid, inner.ledgerSeq)
      if (!dk || !b4a.equals(A.dropKeyHashOf(dk), o.wire.dropKeyHash)) return { ok: false, status: 'reddedildi', code: 'INVALID_DROP_KEY' }
      if (!b4a.equals(appendRecordId(inner.authorId, inner.hlc), inner.recordId)) return { ok: false, status: 'reddedildi', code: 'INVALID_RECORD_ID' }
    }
    return { ok: true }
  }

  // RFC-0030 §4 koşul 3–6: izinli tür ve özne (ledgerSeq anındaki GRANT_WRITE'tan ya da örtük SOS izninden, RFC-0031
  // §4.1), eksiz, kodlanmış olay ≤ 4 KB. Tür ve özne aynı kuraldan sağlanmalı.
  _misafirBirakmasi (o) {
    // Misafirliğin süresi (GRANT expiresAt) bırakmanın hlc'siyle denetlenir: REVOKE yazılmamış olsa da süresi bitmiş
    // misafirin bırakması geçersizdir; örtük SOS izni ve GRANT_WRITE için aynı (inceleme 20 B2, RFC-0030 §3). Defter
    // saate bakmaz (K15); denetim kaydın kendi zamanıyladır.
    const grant = this.ledger.grants.get(o.author)
    if (grant && Number.isSafeInteger(grant.expiresAt) && grant.expiresAt > 0 && msOf(o.inner.hlc) > grant.expiresAt) return 'TERM_EXPIRED'
    const kurallar = (this.yetki.birakmaIzni(o.cid, o.author, o.inner.ledgerSeq) || []).filter((k) => k.types.includes(o.inner.type))
    if (!kurallar.length) return 'TYPE_NOT_ALLOWED'
    const subj = o.inner.fields.find((f) => f.name === '_subj')?.value
    if (!kurallar.some((k) => k.subjects.includes(subj))) return 'SUBJECT_NOT_ALLOWED'
    if (o.inner.fields.some((f) => ekli(f.value))) return 'EXTRA_FORBIDDEN'
    if (o.wire.sealed.byteLength - sodium.crypto_box_SEALBYTES > MAX_MISAFIR_BIRAKMA) return 'DROP_TOO_LARGE'
    return null
  }

  _openOp (o) {
    // Anahtar defterdeki dönemin özetiyle aranır: başka dalın aynı seq'li döneminin anahtarı kullanılmaz
    const ep = this.yetki.epoch(o.cid, o.wire.epochSeq)
    const key = ep && this.keys.get(o.cid, o.wire.epochSeq, ep.hash, o.wire.keyId)
    if (!key) fail('NO_KEY')
    return I.openOp(o.wire, this.familyId, key)
  }

  _openDrop (o) {
    const d = this.keys.drop(o.wire.dropKeyHash)
    if (!d) fail('NO_KEY')
    const sealed = o.wire.sealed
    if (sealed.byteLength < sodium.crypto_box_SEALBYTES) fail('DECRYPT_FAILED')
    const pt = b4a.alloc(sealed.byteLength - sodium.crypto_box_SEALBYTES)
    if (!sodium.crypto_box_seal_open(pt, sealed, d.pub, d.secret)) fail('DECRYPT_FAILED')
    const inner = decodeInner(pt)
    if (inner.op !== OP.APPEND) fail('INVALID_OPERATION_TYPE')
    return inner
  }

  // Koşul 7 (§8.3 kural 7–9)
  _cutoffStatus (o) {
    const iv = this.yetki.writerInterval(o.cid, o.author, o.inner.ledgerSeq)
    if (iv.to === null) return { status: 'gecerli', code: null }
    const L = this.ledger
    const ev = L.events[iv.to]
    if (!this.cutoffs.covers(o.cid, o.author, iv.to, L.hashAt(iv.to), hex(o.opId))) return { status: 'haric', code: 'NOT_IN_CUTOFF' }
    if (msOf(o.inner.hlc) > ev.ts + K.DAY_MS) return { status: 'haric', code: 'TIME_LIMIT' }
    return { status: 'gecerli', code: null }
  }

  // Kutuya gönderilecek REC_PRUNE: yalnız yazarı olduğumuz koleksiyonlar (RFC-0019 §11.1 e); mezarda yalnız temizlenen
  // ve imzadan bağımsız kesin retler vardır.
  pruneMsgs () {
    const E = require('./sync')
    const by = new Map()
    for (const [id, cid] of this.tomb) {
      if (this.pruned.has(id) || !this.yetki.isWriter(cid, this.meHex, this.ledger.len - 1)) continue
      if (!by.has(cid)) by.set(cid, [])
      by.get(cid).push(unhex(id))
      this.pruned.add(id)
    }
    return [...by].map(([cid, ids]) => ({ type: Z.REC_PRUNE, cid, bytes: E.makePrune(this.familyId, cid, ids, this.me) }))
  }

  status (opIdHex) {
    if (this.tomb.has(opIdHex)) return { status: 'reddedildi', code: 'TOMBSTONED' }
    const o = this.ops.get(opIdHex)
    return o ? { status: o.status, code: o.code } : null
  }

  // --- Okuma -----------------------------------------------------------------------------------------------------

  validOps (cid) { return [...this.ops.values()].filter((o) => o.cid === cid && o.status === 'gecerli') }

  // Yazarın işlemin ledgerSeq anındaki rolü: cihaz ya da üyenin o anki rolü
  rolAt (authorHex, seq) { return this.ledger.devices.has(authorHex) ? 'cihaz' : this.yetki.roleAt(authorHex, seq) }

  // Koleksiyonun kayıt durumları; yazar sınıfına uymayan işlemler katılmaz (RFC-0019 §11.1 l). Misafirin rolü yoktur;
  // tek istisnası geçerli kümeye girmiş hf.sos bırakmasıdır (örtük SOS izni, RFC-0031 §4.1).
  // ops verilirse yalnız onlar (tek kayıt yolu)
  durumlar (cid, ops = null) {
    cid = typeof cid === 'string' ? cid : hex(cid)
    const uyar = (o, type, st) => (type === 'hf.sos' && o.kind === 1 && this.ledger.grants.has(o.author)) || sinifaUyar(type, this.rolAt(o.author, o.inner.ledgerSeq), o, st)
    return reduceAll(ops || this.validOps(cid), uyar)
  }

  // Kaydın geçmişi (RFC-0019 8.15): geçerli işlemler sırayla { op, authorId, hlc, opId }
  gecmis (cid, recordId) {
    cid = typeof cid === 'string' ? cid : hex(cid)
    const rid = typeof recordId === 'string' ? recordId : hex(recordId)
    const ad = { [OP.PUT]: 'put', [OP.DEL]: 'del', [OP.APPEND]: 'append' }
    const ops = this.validOps(cid).filter((o) => hex(o.inner.recordId) === rid)
    // Kaybeden alanlar (D15 3): birleştirmenin kendi sırasıyla; alanın kazananı bu işlem değilse ya da sonra gelen
    // bir silme o alanı düşürdüyse kaybetmiştir. Sahip alanları türü belirleyen işlem dışında yok sayılır (kaybeden).
    const st = this.durumlar(cid, ops).get(rid)
    const kaybeden = (o) => {
      if (o.inner.op === OP.DEL) return []
      return o.inner.fields.map((f) => f.name).filter((n) => {
        const k = st && st.fields.get(n)
        if (!k || !b4a.equals(k.opId, o.opId)) return true
        return !!(st.deletedAt && cmp(stamp(o), st.deletedAt) < 0 && !(st.lastPut && cmp(st.lastPut, st.deletedAt) > 0))
      })
    }
    return ops
      .map((o) => ({
        op: ad[o.inner.op],
        authorId: o.author,
        hlc: o.inner.hlc,
        opId: hex(o.opId),
        alanlar: Object.fromEntries(o.inner.fields.map((f) => [f.name, f.value])),
        kaybeden: kaybeden(o)
      }))
      .sort((a, b) => (a.hlc !== b.hlc ? (a.hlc < b.hlc ? -1 : 1) : a.opId < b.opId ? -1 : 1))
  }

  // Yazım kuyrukta mı (dönem anahtarı bekleniyor)
  kuyrukta (cid, recordId) {
    cid = typeof cid === 'string' ? cid : hex(cid)
    const rid = typeof recordId === 'string' ? recordId : hex(recordId)
    return this.writeQueue.some((i) => i.cid === cid && hex(i.partial.recordId) === rid)
  }

  records (cid) {
    cid = typeof cid === 'string' ? cid : hex(cid)
    const out = []
    for (const [rid, st] of this.durumlar(cid)) {
      const v = view(unhex(rid), st)
      if (v) out.push(v)
    }
    return out.sort((a, b) => (a.recordId < b.recordId ? -1 : 1))
  }

  get (cid, recordId) {
    const r = typeof recordId === 'string' ? recordId : hex(recordId)
    return this.records(cid).find((x) => x.recordId === r) || null
  }

  // --- Yazma (§7.1) ------------------------------------------------------------------------------------------------

  // Yeni kayıt (recordId null): recordId = hash('hf/rec-new/', ben, recNonce)[0..16] ve tür bu işlemde.
  // Var olan kayda tür yazılamaz (TYPE_CANNOT_CHANGE); kayıt başına en çok 256 alan (FIELD_LIMIT).
  put (cid, recordId, type, fields) {
    checkWrite(fields)
    cid = typeof cid === 'string' ? cid : hex(cid)
    const list = Object.entries(fields).map(([name, value]) => ({ name, value }))
    if (!recordId) {
      if (!type) fail('NO_TYPE')
      const recNonce = randomId()
      const rid = newRecordId(this.me.memberId, recNonce)
      this._write(cid, { recordId: rid, op: OP.PUT, type, fields: list, recNonce })
      return hex(rid)
    }
    if (type) fail('TYPE_CANNOT_CHANGE')
    const rid = typeof recordId === 'string' ? unhex(recordId) : recordId
    const cur = this.get(cid, rid)
    if (cur && new Set([...Object.keys(cur.fields), ...list.map((f) => f.name)]).size > MAX_FIELDS) fail('FIELD_LIMIT')
    this._write(cid, { recordId: rid, op: OP.PUT, type: '', fields: list, recNonce: null })
    return hex(rid)
  }

  del (cid, recordId) {
    const rid = typeof recordId === 'string' ? unhex(recordId) : recordId
    this._write(cid, { recordId: rid, op: OP.DEL, type: '', fields: [], recNonce: null })
  }

  _write (cid, partial) {
    this._catchUp()
    cid = typeof cid === 'string' ? cid : hex(cid)
    const L = this.ledger
    if (!this.yetki.isWriter(cid, this.meHex, L.len - 1)) fail('NO_PERMISSION')
    const item = { cid, partial: { ...partial, hlc: this.hlc.next(this.now()), authorId: b4a.from(this.me.memberId) } }
    encodeInner({ ...item.partial, ledgerSeq: 0, ledgerHash: b4a.alloc(32) }) // biçim hatası hemen
    this.writeQueue.push(item)
    this._flushWrites()
  }

  // Yazar, yetkisini ya da okuyucuyu çıkaran olayı gördükten sonra eski dönemle yazmaz: o anki dönemin anahtarı
  // yoksa işlem kuyrukta bekler.
  _flushWrites () {
    const L = this.ledger
    const keep = []
    for (const item of this.writeQueue) {
      const seq = L.len - 1
      if (!this.yetki.isWriter(item.cid, this.meHex, seq)) continue // yetki bitti: yazılmaz
      const ep = this.yetki.epochAt(item.cid, seq)
      const k = ep && this.keys.preferred(item.cid, ep.seq, ep.hash)
      if (!k) { keep.push(item); continue }
      const inner = { ...item.partial, ledgerSeq: seq, ledgerHash: L.hashAt(seq) }
      const bytes = I.sealOp({ familyId: this.familyId, collectionId: unhex(item.cid), epochSeq: ep.seq, key: k.key, inner, signer: this.me })
      this.receiveOp(bytes, 0)
      this.outbox.push({ type: Z.REC_OPS, cid: item.cid, kind: 0, bytes })
    }
    this.writeQueue = keep
  }

  // --- Anahtarlar (§9) -------------------------------------------------------------------------------------------

  // Dönem anında okuyucu olan ve sıralamada ilk olan üye kendiliğinden üretir; anahtarı 10 dakika görünmezse sıradaki
  // (RFC-0019 §11.1 h). Misafirli koleksiyonda yalnız ebeveyn üretir; uygun üreten yoksa üretilmez, sync düşmez.
  // otomatikAnahtar koleksiyon başına işlev de olabilir (cid → bool): telefonda kasa kilitliyken anahtar Arşiv'dedir,
  // yokluğu üretim gerekçesi değildir (D40)
  _autoKeys () {
    if (!this.otomatikAnahtar) return
    const now = this.now()
    for (const cid of this.yetki.cols.keys()) {
      if (typeof this.otomatikAnahtar === 'function' && !this.otomatikAnahtar(cid)) continue
      const ep = this.yetki.epochAt(cid, this.ledger.len - 1)
      if (!ep || this.keys.has(cid, ep.seq, ep.hash)) continue
      const k = cid + '|' + ep.seq + '|' + hex(ep.hash)
      if (!this.donemGorulme.has(k)) this.donemGorulme.set(k, now)
      const sira = Math.floor((now - this.donemGorulme.get(k)) / YEDEK_URETEN_MS)
      if (A.ureten(ep.readers, sira) !== this.meHex) continue
      try { this.generateKey(cid) } catch {}
    }
  }

  generateKey (cid, epochSeq = null) {
    cid = typeof cid === 'string' ? cid : hex(cid)
    const ep = epochSeq === null ? this.yetki.epochAt(cid, this.ledger.len - 1) : this.yetki.epoch(cid, epochSeq)
    if (!ep) fail('NO_EPOCH')
    if (!A.ureteBilenler(ep.readers).includes(this.meHex)) fail('KEY_UNAUTHORIZED')
    const key = b4a.alloc(32)
    sodium.randombytes_buf(key)
    const entry = A.makeKeyEntry({ familyId: this.familyId, collectionId: unhex(cid), epochSeq: ep.seq, epochHash: ep.hash, key, issuer: this.me })
    const role = A.verifyKeyEntry({ familyId: this.familyId, collectionId: unhex(cid), epoch: ep, entry, signPubOf: (id) => this.ledger.entity(id)?.signPub }).role
    this.keys.add(cid, ep, entry, role)
    const bytes = A.encodeRecKey({ collectionId: unhex(cid), epochSeq: ep.seq, epochHash: ep.hash, keys: [entry], dropSecrets: [] })
    // Yalnız dönemin okuyucularına (misafir dahil); kutu ve işçi koleksiyon anahtarı almaz
    const to = [...ep.readers.keys()].filter((id) => id !== this.meHex && this._erisimVar(id))
    this.outbox.push({ type: Z.REC_KEY, cid, bytes, to })
    this._afterKeys(cid)
    return entry
  }

  // Bırakma anahtarının gizli yarısı (olaylar koleksiyonunu öneren üye üretir, §10.1)
  addDropSecret (cid, secret) {
    cid = typeof cid === 'string' ? cid : hex(cid)
    this.keys.addDrop(cid, A.dropPubOf(secret), secret)
    this._afterKeys(cid)
  }

  // Dönüş: { status: 'tamam' | 'bekliyor' | 'reddedildi', code }
  receiveKey (bytes) {
    this._catchUp()
    let m
    try { m = A.decodeRecKey(bytes) } catch (err) { return { status: 'reddedildi', code: err.message } }
    const L = this.ledger
    const cid = hex(m.collectionId)
    if (m.epochSeq >= L.len) { bekleyeEkle(this.pendingKeys, bytes); return { status: 'bekliyor', code: 'LEDGER_BEHIND' } }
    const ep = this.yetki.epoch(cid, m.epochSeq)
    if (!ep || !b4a.equals(ep.hash, m.epochHash)) return { status: 'reddedildi', code: 'EPOCH_MISMATCH' }
    // Okuyucu olmadığımız koleksiyonun anahtarını saklamayız: history: true'da bugün okuyucu olmak, false'ta dönem anında.
    // Okuyuculuk kişiye göredir (RFC-0017 §5): ek kimlik, kişinin dönemdeki okuyuculuğuyla anahtarı alır.
    const col = L.collections.get(cid)
    // Alıcı kimlik (ben) şu an aktif okuyucu olmalı (RFC-0019 §11.1 m)
    const readerNow = this.yetki.isReader(cid, this.meHex, L.len - 1)
    if (!(col.history ? readerNow : readerNow && this._kisiOkuyucu(cid, this.meHex, ep.seq))) return { status: 'reddedildi', code: 'NOT_READER' }
    const signPubOf = (id) => L.entity(id)?.signPub
    let bad = null
    for (const entry of m.keys) {
      try {
        const { role } = A.verifyKeyEntry({ familyId: this.familyId, collectionId: m.collectionId, epoch: ep, entry, signPubOf })
        this.keys.add(cid, ep, entry, role)
      } catch (err) { bad = err.message }
    }
    const inEpoch = this.yetki.dropKeysInEpoch(cid, m.epochSeq)
    for (const d of m.dropSecrets) {
      const pub = A.dropPubOf(d.secret)
      if (!b4a.equals(A.dropKeyHashOf(pub), d.dropKeyHash) || !inEpoch.some((k) => b4a.equals(k, pub))) { bad = 'INVALID_DROP_KEY'; continue }
      this.keys.addDrop(cid, pub, d.secret)
    }
    this._afterKeys(cid)
    return bad ? { status: 'reddedildi', code: bad } : { status: 'tamam', code: null }
  }

  _afterKeys (cid) {
    for (const o of [...this.ops.values()]) if (o.cid === cid && o.code === 'NO_KEY') this._evaluate(o)
    this._flushWrites()
  }

  // §9.5: isteyen, istenen dönemleri almaya yetkili mi. Dönüş: gönderilecek REC_KEY ve kesim baytları.
  answerKeyReq (requesterHex, bytes) {
    const m = A.decodeRecKeyReq(bytes)
    const cid = hex(m.collectionId)
    const L = this.ledger
    const col = L.collections.get(cid)
    if (!col) fail('NO_COLLECTION')
    const now = L.len - 1
    // Okuyuculuk kişiye göredir: cihaz değişimi zinciri ve kişinin ek kimlikleri (RFC-0017 §5)
    if (!this.yetki.isReader(cid, requesterHex, now) || !this._erisimVar(requesterHex)) fail('UNAUTHORIZED')
    const out = []
    for (const seq of m.epochs) {
      const ep = this.yetki.epoch(cid, seq)
      if (!ep || !this.keys.has(cid, seq, ep.hash)) continue
      if (!col.history && !this._kisiOkuyucu(cid, requesterHex, seq)) fail('UNAUTHORIZED')
      const entries = this.keys.entries(cid, seq, ep.hash)
      const drops = this.keys.dropsOf(cid).filter((d) => this.yetki.dropKeysInEpoch(cid, seq).some((k) => b4a.equals(k, d.pub)))
      out.push({ type: Z.REC_KEY, bytes: A.encodeRecKey({ collectionId: m.collectionId, epochSeq: seq, epochHash: ep.hash, keys: entries, dropSecrets: drops.map((d) => ({ dropKeyHash: A.dropKeyHashOf(d.pub), secret: d.secret })) }) })
    }
    for (const b of this.cutoffs.messagesOf(cid)) out.push({ type: Z.REC_CUTOFF, bytes: b })
    return out
  }

  // --- Ekipten ayrılış (RFC-0005 §10.2) ---------------------------------------------------------------------------

  // İş kapsamını siler: bütün koleksiyonların dönem anahtarları, işlemleri, kesimleri ve yerel durumu. Dönüş: silinen
  // koleksiyon sayısı. Dosyalar ve sohbetler kendi katmanlarında silinir (makbuzdaki blobs, convs).
  isKapsaminiSil () {
    const cols = new Set([...this.ops.values()].map((o) => o.cid))
    for (const cid of this.yetki.cols.keys()) cols.add(cid)
    for (const [, e] of this.keys.epochs || []) for (const v of e.keys?.values?.() || []) if (v.key) sodium.sodium_memzero(v.key)
    this.keys = new A.KeyStore()
    this.cutoffs = new K.CutoffStore()
    this.ops.clear()
    this.tomb.clear()
    this.cleaned.clear()
    this.pendingKeys = []
    this.pendingCutoffs = []
    this.writeQueue = []
    this.outbox = []
    return cols.size
  }

  // --- Kesim alma (§8.3 kural 4) ----------------------------------------------------------------------------------

  receiveCutoff (bytes) {
    this._catchUp()
    let m
    try { m = K.decodeCutoff(bytes) } catch (err) { return { status: 'reddedildi', code: err.message } }
    const L = this.ledger
    if (m.eventSeq >= L.len) { bekleyeEkle(this.pendingCutoffs, bytes); return { status: 'bekliyor', code: 'LEDGER_BEHIND' } }
    const cid = hex(m.collectionId)
    const author = hex(m.authorId)
    const issuer = hex(m.issuerId)
    if (!b4a.equals(L.hashAt(m.eventSeq), m.eventHash)) return { status: 'reddedildi', code: 'LEDGER_FORK' }
    if (!this.yetki.endsAt(cid, author, m.eventSeq)) return { status: 'reddedildi', code: 'RANGE_NOT_ENDED' }
    if (!K.canIssue(L, this.yetki, cid, author, issuer, m.eventSeq)) return { status: 'reddedildi', code: 'CUTOFF_UNAUTHORIZED' }
    const pub = L.entity(issuer)?.signPub
    if (!pub || !sodium.crypto_sign_verify_detached(m.sig, K.cutoffDigest(this.familyId, m), pub)) return { status: 'reddedildi', code: 'INVALID_SIGNATURE' }
    let r
    try { r = this.cutoffs.addPart(m, b4a.from(bytes)) } catch (err) { return { status: 'reddedildi', code: err.message } }
    if (r === 'tamam') for (const o of [...this.ops.values()]) if (o.cid === cid && o.author === author) this._evaluate(o)
    return { status: r === 'tamam' ? 'tamam' : 'bekliyor', code: r === 'tamam' ? null : 'CHUNK_MISSING' }
  }
}

function randomId () {
  const b = b4a.alloc(16)
  sodium.randombytes_buf(b)
  return b
}

// Değerde dosya başvurusu (blobRef) var mı; listeler iç içe en çok iki düzey (RFC-0001 §4.2)
const ekli = (v) => Array.isArray(v) ? v.some(ekli) : !!v && typeof v === 'object' && b4a.isBuffer(v.blobId)

// Yalnız yazan cihaz ve GRANT_WRITE izni olan misafir (§10.2, RFC-0030 §4): sealed = crypto_box_seal(encode(OpInner, op = 2), dropKey)
function sealDrop ({ familyId, collectionId, dropKey, inner, signer }) {
  const pt = encodeInner({ ...inner, op: OP.APPEND })
  const sealed = b4a.alloc(pt.byteLength + sodium.crypto_box_SEALBYTES)
  sodium.crypto_box_seal(sealed, pt, dropKey)
  const w = { collectionId, dropKeyHash: A.dropKeyHashOf(dropKey), sealed, sig: null }
  w.sig = I.sign(dropSigDigest(familyId, dropOpIdOf(w)), signer.signKeyPair.secretKey)
  return c.encode(recDrop, w)
}

module.exports = { Replika, sealDrop, appendRecordId, dropOpIdOf, dropSigDigest, TOMB_CODES, MAX_KOPYA, MAX_MISAFIR_BIRAKMA, ekli }
