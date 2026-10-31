// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// permission.js — yetki aralığı tablosu ve dönemler (RFC-0001 §7.2, §9.1)
//
// Her koleksiyon için yazar ve okuyucu aralıkları: kimlik → [{ from, to }]. "X anında" = seq X olayı uygulandıktan
// sonraki durum (§3); kimlik, from ≤ X < to iken yazardır (to = aralığı bitiren olayın seq'i, açıksa null).
// Tablo kendi gölge defterini tutar; defter yalnız ileri giderse artımlı güncellenir, çatallanmada baştan kurulur.
const b4a = require('b4a')
const { ledger: { Ledger, T, memberIdOf }, encoding: { decodeBody }, v21: { parseEntry }, v23: { birakanlarOf, birakmaKurallari }, ekip: { yerleri, gecerliSure } } = require('@havenfold/core')

const hex = (b) => b4a.toString(b, 'hex')

// uye:<id> → kişinin bütün aktif kimlikleri (ana + ek). İzin kişiye verilir (RFC-0017 §5).
function personIdentities (L, v) {
  const id = L.canonical(v)
  return id ? L.identitiesOf(L.personIdOf(id)) : []
}

// Bir durumda koleksiyonun yazarları: kimlik → tür ('uye' | 'cihaz' | 'misafir'). Misafir writers'ta değildir;
// GRANT_WRITE izniyle ya da Tüm Aile'deki örtük SOS izniyle yalnız bırakan yazardır (RFC-0030 §4 koşul 2, RFC-0001
// §7.2 grant: satırı, RFC-0031 §4.1)
function writerSet (L, col) {
  const out = new Map()
  const phones = L.phoneIds()
  for (const s of col.writers) {
    const x = parseEntry(s, L.kind)
    if (!x) continue
    if (x.kind === 'rol') for (const id of phones) if (L.members.get(id).role === x.v) out.set(id, 'uye')
    // Ekip: o yere atanmış ve o roldeki telefonlar (RFC-0005 §8.3); atama ve rol olay anındaki duruma çözülür
    if (x.kind === 'yer') for (const id of phones) if (L.members.get(id).role === x.rol && yerleri(L, id).includes(x.v)) out.set(id, 'uye')
    if (x.kind === 'uye') for (const id of personIdentities(L, x.v)) if (phones.includes(id)) out.set(id, 'uye')
    if (x.kind === 'device' && L.devices.get(x.v)?.active) out.set(x.v, 'cihaz')
  }
  if (L.grants.size) for (const id of birakanlarOf(L, col.id)) out.set(id, 'misafir')
  return out
}

// Okuyucular: kimlik → rol (üyede rolü, misafirde 'misafir'). Misafir GRANT'taki koleksiyonların da okuyucusudur.
function readerSet (L, col) {
  const out = new Map()
  const phones = L.phoneIds()
  for (const s of col.readers) {
    const x = parseEntry(s, L.kind)
    if (!x) continue
    if (x.kind === 'rol') for (const id of phones) if (L.members.get(id).role === x.v) out.set(id, x.v)
    if (x.kind === 'yer') for (const id of phones) if (L.members.get(id).role === x.rol && yerleri(L, id).includes(x.v)) out.set(id, x.rol)
    if (x.kind === 'uye') for (const id of personIdentities(L, x.v)) if (phones.includes(id)) out.set(id, L.members.get(id).role)
    if (x.kind === 'grant' && L.grants.get(x.v)?.active) out.set(x.v, 'misafir')
  }
  // Kapatılan koleksiyon (readers: []) misafiri de kapsar (RFC-0019 §11.1 i)
  if (col.readers.length) for (const [id, g] of L.grants) if (g.active && g.collections.includes(col.id)) out.set(id, 'misafir')
  return out
}

// Ekipte süresi dolmuş ya da TERM'i olmayan geçiciye anahtar, kayıt ve dosya gitmez (RFC-0005 §9.1, RFC-0022 a).
// Bütün gönderim yolları buradan geçer: katılma paketi, yeni anahtar, anahtar yanıtı, eşitleme, BLOB_REQ.
function erisimVar (L, id, now) {
  const bitis = L.kind === 'ekip' ? gecerliSure(L, id) : null
  return bitis === null || now <= bitis
}

class Yetki {
  constructor () { this.reset() }

  reset () {
    this.shadow = new Ledger()
    this.cols = new Map() // colId → { writers, readers: Map<id, [{from,to}]>, epochs: [{ seq, hash, readers }] , w, r }
    this.roller = new Map() // üye kimliği → [{ seq, role }] (rol değiştikçe; çıkarılınca role null)
  }

  // Dönüş: { rebuilt, from } — from: bu çağrıda işlenen ilk seq
  update (ledger) {
    let rebuilt = false
    const n = this.shadow.len
    if (n > ledger.len || (n > 0 && !b4a.equals(this.shadow.hashAt(n - 1), ledger.hashAt(n - 1)))) {
      this.reset()
      rebuilt = true
    }
    const from = this.shadow.len
    for (let i = from; i < ledger.len; i++) {
      const e = ledger.events[i]
      const ctx = this._before(e)
      this.shadow.apply(e)
      this._after(e, ctx)
    }
    return { rebuilt, from }
  }

  _before (e) {
    const L = this.shadow
    if (e.type === T.REMOVE_MEMBER) return { removedBox: L.members.get(hex(decodeBody(T.REMOVE_MEMBER, e.body).memberId))?.role === 'kutu' }
    if (e.type === T.APP_PRIMARY) {
      const b = decodeBody(T.APP_PRIMARY, e.body)
      return { primaryOld: L.persons.get(hex(b.personId))?.primary, oldSigned: b.oldSigned }
    }
    if (e.type === T.APP_ATTACH) {
      const b = decodeBody(T.APP_ATTACH, e.body)
      return { attachNew: hex(memberIdOf(b.deviceCert.ukaPub)), replaces: !!b.replaces }
    }
    if (e.type === T.ROTATE_DEVICE) {
      const b = decodeBody(T.ROTATE_DEVICE, e.body)
      const old = hex(b.oldMemberId)
      // Kip gövdede (RFC-0020 a); v1 zincirinde bayrak yoksa imzalardan
      const oldSigned = b.oldSigned === null || b.oldSigned === undefined ? e.sigs.some((s) => hex(s.memberId) === old) : b.oldSigned
      return { rotateOld: old, rotateNew: hex(memberIdOf(b.newDeviceCert.ukaPub)), oldSigned }
    }
    return {}
  }

  _after (e, ctx) {
    const L = this.shadow
    const s = e.seq
    const h = L.hashAt(s)
    for (const [id, m] of L.members) this._rolYaz(id, s, m.role)
    for (const [id, list] of this.roller) if (!L.members.has(id) && list[list.length - 1].role !== null) list.push({ seq: s, role: null })
    for (const [cid, col] of L.collections) {
      let st = this.cols.get(cid)
      const created = !st
      if (!st) {
        st = { writers: new Map(), readers: new Map(), epochs: [], drops: [], joins: [], izinler: new Map(), w: new Map(), r: new Map() }
        this.cols.set(cid, st)
      }
      const w = writerSet(L, col)
      const r = readerSet(L, col)
      diff(st.writers, st.w, w, s)
      const { removed, added } = diff(st.readers, st.r, r, s)
      // Yeni okuyucular (§9.4 anahtar paketi için); koleksiyonun oluşturulması katılma sayılmaz
      if (!created) for (const id of added) if (r.get(id) !== 'misafir') st.joins.push({ seq: s, id })

      // Cihaz değişimi okuyucu eklemek sayılmaz; eski cihazın imzaladığı ROTATE_DEVICE okuyucu çıkarmak da sayılmaz
      for (const id of [...added]) {
        const m = L.members.get(id)
        if (m?.rotatedFrom && removed.has(m.rotatedFrom)) {
          added.delete(id)
          if (ctx.oldSigned && ctx.rotateOld === m.rotatedFrom) removed.delete(m.rotatedFrom)
        }
      }
      // RFC-0017 §5: replaces taşımayan APP_ATTACH okuyucu eklemek sayılmaz; replaces taşıyan yeni dönem başlatır.
      // Eski imzalı APP_PRIMARY yeni dönem başlatmaz (eski ana kimliğin çıkması okuyucu çıkması sayılmaz).
      let forced = false
      if (ctx.attachNew && added.has(ctx.attachNew)) {
        added.delete(ctx.attachNew)
        if (ctx.replaces) forced = true
      }
      if (ctx.primaryOld && ctx.oldSigned) removed.delete(ctx.primaryOld)
      const kasa = col.sensitivity === 'kasa' && (e.type === T.DEVICE_DETACH || (e.type === T.REMOVE_MEMBER && ctx.removedBox))
      if (created || forced || removed.size > 0 || (!col.history && added.size > 0) || kasa) {
        st.epochs.push({ seq: s, hash: h, readers: new Map(r) })
      }
      // Bırakma anahtarı geçmişi (§10.1): { seq, dropKey } — dropKey 32 sıfırsa yok
      const lastDrop = st.drops[st.drops.length - 1]
      if (!lastDrop ? !col.dropKey.every((x) => x === 0) : !b4a.equals(lastDrop.dropKey, col.dropKey)) st.drops.push({ seq: s, dropKey: col.dropKey })
      // Misafirin bırakma izni geçmişi (RFC-0030 §4 koşul 3–4, RFC-0031 §4.1): kimlik → [{ seq, kaynak, kurallar }];
      // kurallar: GRANT_WRITE ve örtük SOS izni, her biri { types, subjects, ortuk }
      for (const [id, tur] of w) {
        if (tur !== 'misafir') continue
        const kurallar = birakmaKurallari(L, id, cid).map((x) => ({ types: x.types, subjects: x.subjects, ortuk: !!x.ortuk }))
        const kaynak = JSON.stringify(kurallar)
        const list = st.izinler.get(id) || []
        if (!list.length || list[list.length - 1].kaynak !== kaynak) list.push({ seq: s, kaynak, kurallar })
        st.izinler.set(id, list)
      }
      st.w = w
      st.r = r
    }
  }

  _rolYaz (id, seq, role) {
    const list = this.roller.get(id)
    if (!list) this.roller.set(id, [{ seq, role }])
    else if (list[list.length - 1].role !== role) list.push({ seq, role })
  }

  // Üyenin seq anındaki rolü (üye değilse null). Cihazların rolü yoktur.
  roleAt (id, seq) {
    let cur = null
    for (const x of this.roller.get(id) || []) if (x.seq <= seq) cur = x.role
    return cur
  }

  col (cid) { return this.cols.get(typeof cid === 'string' ? cid : hex(cid)) || null }

  // Aralık: { from, to } ya da null
  writerInterval (cid, id, seq) { return find(this.col(cid)?.writers, id, seq) }
  readerInterval (cid, id, seq) { return find(this.col(cid)?.readers, id, seq) }
  isWriter (cid, id, seq) { return !!this.writerInterval(cid, id, seq) }
  isReader (cid, id, seq) { return !!this.readerInterval(cid, id, seq) }

  readersAt (cid, seq) {
    const st = this.col(cid)
    if (!st) return []
    return [...st.readers].filter(([, iv]) => iv.some((x) => contains(x, seq))).map(([id]) => id)
  }

  // Bir kimliğin bir koleksiyonda tam olarak toSeq = eventSeq ile biten yazar aralığı var mı (§8.3 kural 4)
  endsAt (cid, id, eventSeq) {
    const iv = this.col(cid)?.writers.get(id)
    return iv ? iv.find((x) => x.to === eventSeq) || null : null
  }

  // Yazarın aralıklarını bitiren olaylar (kesim için)
  endedIntervals (cid) {
    const st = this.col(cid)
    const out = []
    if (!st) return out
    for (const [id, iv] of st.writers) for (const x of iv) if (x.to !== null) out.push({ authorId: id, ...x })
    return out
  }

  // Misafirin seq anındaki bırakma kuralları: [{ types, subjects, ortuk }] ya da null (yazar aralığı da denetlenir)
  birakmaIzni (cid, id, seq) {
    let cur = null
    for (const x of this.col(cid)?.izinler.get(id) || []) if (x.seq <= seq) cur = x
    return cur && this.isWriter(cid, id, seq) ? cur.kurallar : null
  }

  epochs (cid) { return this.col(cid)?.epochs || [] }
  epoch (cid, epochSeq) { return this.epochs(cid).find((x) => x.seq === epochSeq) || null }

  // seq anında yürürlükteki bırakma anahtarı (yoksa null)
  dropKeyAt (cid, seq) {
    let cur = null
    for (const x of this.col(cid)?.drops || []) if (x.seq <= seq) cur = x.dropKey
    return cur && !cur.every((b) => b === 0) ? cur : null
  }

  // Dönem içinde (epochSeq ≤ x < sonraki dönem) yürürlükte olmuş bırakma anahtarları
  dropKeysInEpoch (cid, epochSeq) {
    const next = this.epochs(cid).find((x) => x.seq > epochSeq)
    const end = next ? next.seq : Infinity
    const out = []
    const atStart = this.dropKeyAt(cid, epochSeq)
    if (atStart) out.push(atStart)
    for (const x of this.col(cid)?.drops || []) if (x.seq > epochSeq && x.seq < end && !x.dropKey.every((b) => b === 0)) out.push(x.dropKey)
    return out
  }

  // seq anında yürürlükteki dönem
  epochAt (cid, seq) {
    let cur = null
    for (const x of this.epochs(cid)) if (x.seq <= seq) cur = x
    return cur
  }

  // §7 koşul 5: ledgerSeq anındaki dönem ya da ondan sonraki ilk dönem
  epochAllowed (cid, ledgerSeq, epochSeq) {
    const cur = this.epochAt(cid, ledgerSeq)
    if (cur && cur.seq === epochSeq) return true
    const next = this.epochs(cid).find((x) => x.seq > ledgerSeq)
    return !!next && next.seq === epochSeq
  }
}

function contains (x, seq) { return x.from <= seq && (x.to === null || seq < x.to) }
function find (map, id, seq) {
  const iv = map?.get(typeof id === 'string' ? id : hex(id))
  if (!iv) return null
  return iv.find((x) => contains(x, seq)) || null
}

// prev → next küme değişimi: yeni gelenlere aralık açılır, gidenlerinki s ile kapanır
function diff (table, prev, next, s) {
  const removed = new Set()
  const added = new Set()
  for (const id of prev.keys()) {
    if (next.has(id)) continue
    const iv = table.get(id)
    iv[iv.length - 1].to = s
    removed.add(id)
  }
  for (const id of next.keys()) {
    if (prev.has(id)) continue
    if (!table.has(id)) table.set(id, [])
    table.get(id).push({ from: s, to: null })
    added.add(id)
  }
  return { removed, added }
}

module.exports = { Yetki, writerSet, readerSet, erisimVar }
