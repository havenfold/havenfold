// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// worklet/ledger/sync.js — çatallanma kuralı (docs/04 §4.4) ve LEDGER_REQ / LEDGER_EVENTS (§4.5)
//
// Defter küçüktür (8 üye, birkaç yüz olay); çatallanmada ortak önekten yeniden kurmak yeterince ucuz.
const c = require('compact-encoding')
const b4a = require('b4a')
const { Ledger, T, eventHash, encodeEvent, decodeEvent, memberIdOf } = require('./ledger')
const { decodeBody } = require('./encoding')

const ledgerReq = {
  preencode (state, m) { c.uint.preencode(state, m.fromSeq) },
  encode (state, m) { c.uint.encode(state, m.fromSeq) },
  decode (state) { return { fromSeq: c.uint.decode(state) } }
}

const ledgerEvents = {
  preencode (state, m) { c.uint.preencode(state, m.fromSeq); c.array(c.buffer).preencode(state, m.events) },
  encode (state, m) { c.uint.encode(state, m.fromSeq); c.array(c.buffer).encode(state, m.events) },
  decode (state) { return { fromSeq: c.uint.decode(state), events: c.array(c.buffer).decode(state) } }
}

const MAX_FORK_DEPTH = 2 // ayrışma noktası len − 2'den eskiyse dal reddedilir (K10)
const hex = (b) => b4a.toString(b, 'hex')

// RFC-0003 §9 (K10 güncellemesi). L: olaydan önceki defter durumu (o daldaki). Ebeveyn = kişinin ana kimliği; ek
// kimliğin imzası ebeveyn imzası sayılmaz (inceleme RFC-0017 bulgu 6).
// Ekipte yetki imzası sahip ya da yönetici imzasıdır (RFC-0005 §6.3)
const parentSigned = (e, L) => { const p = new Set(L.authorityIds()); return e.sigs.some((s) => p.has(hex(s.memberId))) }
// RFC-0017 §4.5: eski ana kimliğin ya da bir ebeveynin imzaladığı APP_PRIMARY de güçlüdür; kip gövdeden (RFC-0020 a).
// ACTIVATE_MEMBER güçlü değildir (RFC-0019 §8.11, RFC-0020 c).
const appPrimaryStrong = (e) => { try { const b = decodeBody(T.APP_PRIMARY, e.body); return b.oldSigned || b.parentSigned } catch { return false } }
const isStrong = (e, L) => e.type === T.REMOVE_MEMBER || e.type === T.ROTATE_DEVICE || e.type === T.REVOKE ||
                           (e.type === T.DEVICE_DETACH && parentSigned(e, L)) ||
                           (e.type === T.APP_PRIMARY && appPrimaryStrong(e))
// Cihazın yalnız kendi imzaladığı DEVICE_DETACH çıkarma sayılmaz (RFC-0019 5.5); ekipte yalnız yönetim imzası
// sayılır, çalışanın ortak imzası ayrılışı atma yapmaz (RFC-0005 §6.3, inceleme 7 bulgu 9)
const isRemoval = (e, L = null) => e.type === T.REMOVE_MEMBER || e.type === T.LEAVE || e.type === T.REVOKE ||
                         (e.type === T.DEVICE_DETACH && signerCount(e, L) > 0)

// §5.14: çatallanmada yalnız üye imzaları sayılır. Cihaz ve misafir yalnız kendi ekleme ya da çıkış olayını
// imzalayabildiği için olayın kendisinden bilinir; defter durumu gerekmez.
function deviceSignerOf (e) {
  try {
    const body = decodeBody(e.type, e.body)
    if (e.type === T.DEVICE_ATTACH) return hex(memberIdOf(body.deviceCert.ukaPub))
    if (e.type === T.GRANT) return hex(memberIdOf(body.to.ukaPub))
    if (e.type === T.DEVICE_DETACH) return hex(body.deviceId)
  } catch {}
  return null
}
// L verilirse ve ekipse yalnız yönetim (sahip, yönetici) imzaları sayılır (RFC-0005 §6.3)
function signerCount (e, L = null) {
  const ids = new Set(e.sigs.map((s) => hex(s.memberId)))
  ids.delete(deviceSignerOf(e))
  if (L && L.kind === 'ekip') {
    const yonetim = new Set(L.authorityIds())
    return [...ids].filter((id) => yonetim.has(id)).length
  }
  return ids.size
}

// Aynı prev'e sahip iki geçerli olaydan kazananı döner (a ya da b). Her telefon aynı sonuca varır.
// L: ayrışmadan önceki defter (ekipte imza sayımı için); verilmezse bütün üye imzaları sayılır
function forkWinner (a, b, L = null) {
  // 1. Atma / ayrılma kazanır (güvenlik önce)
  if (isRemoval(a, L) !== isRemoval(b, L)) return isRemoval(a, L) ? a : b
  // 2. PREKEY her zaman kaybeder
  const pa = a.type === T.PREKEY
  const pb = b.type === T.PREKEY
  if (pa !== pb) return pa ? b : a
  // 3. Daha çok farklı imzacı
  const sa = signerCount(a, L)
  const sb = signerCount(b, L)
  if (sa !== sb) return sa > sb ? a : b
  // 4. eventHash'i sözlükte küçük olan
  return b4a.compare(eventHash(a), eventHash(b)) <= 0 ? a : b
}

// Karşı tarafın HELLO'daki (ledgerLen, ledgerHead) bilgisine göre istek; gerek yoksa null.
// Karşı taraf gerideyse (bizim zincirimizin öneki) o bizden ister; biz istemeyiz.
function makeReq (ledger, peerLen, peerHead) {
  if (peerLen === ledger.len && b4a.equals(peerHead, ledger.head)) return null
  if (peerLen < ledger.len && b4a.equals(ledger.hashAt(peerLen - 1), peerHead)) return null
  if (peerLen > ledger.len) return { fromSeq: ledger.len } // önek uymazsa ingest() needFrom: 0 döner
  return { fromSeq: 0 } // aynı ya da kısa uzunlukta farklı baş: çatallanma
}

function answerReq (ledger, req) {
  const fromSeq = Math.min(req.fromSeq, ledger.len)
  return { fromSeq, events: ledger.eventsFrom(fromSeq).map(encodeEvent) }
}

// LEDGER_EVENTS'i deftere işler. Doğrulanamayan olay kabul edilmez: hata atar (gönderen engellenir).
// Dönüş: { added, dropped: [kaybeden kendi olaylarımız], replaced, needFrom? }
function ingest (ledger, msg) {
  const events = msg.events.map((b) => (b4a.isBuffer(b) ? decodeEvent(b) : b))
  const out = { added: 0, dropped: [], replaced: false }
  let cursor = null
  for (let i = 0; i < events.length; i++) {
    const e = events[i]
    if (e.seq !== msg.fromSeq + i) throw new Error('ORDER_ERROR')

    if (e.seq > ledger.len) return { ...out, needFrom: ledger.len }

    if (e.seq === ledger.len) {
      if (!b4a.equals(e.prev, ledger.head)) {
        if (msg.fromSeq > 0) return { ...out, needFrom: 0 }
        throw new Error('CHAIN_BROKEN')
      }
      // K15: süresinden önce gelen ACTIVATE (ve ardındakiler) bekletilir; süre dolunca retryDeferred
      if (ledger.tooEarly(e)) {
        // İnceleme 10 Y1: önce imza ve yeter sayı (check süreye bakmaz); geçersiz ACTIVATE bekletilmez, reddedilir.
        // Yoksa kasaya yazılan sahte bekletme süre dolunca her açılışta bakım turunu düşürüyordu.
        ledger.check(e)
        ledger.deferred = events.slice(i)
        return { ...out, deferred: ledger.deferred.length }
      }
      ledger.apply(e)
      out.added++
      continue
    }

    // e.seq < ledger.len: bizde de var. Aynı olaysa yeni (doğrulanmış) imzaları birleştir (K10)
    if (b4a.equals(eventHash(e), ledger.hashAt(e.seq))) {
      if (!cursor) cursor = ledger.pastCursor() // O-1: geçmiş durum tek geçişte, artımlı
      ledger.mergeSigs(e.seq, e.sigs, cursor)
      continue
    }
    if (!b4a.equals(e.prev, ledger.hashAt(e.seq - 1))) {
      if (msg.fromSeq > 0) return { ...out, needFrom: 0 }
      throw new Error('CHAIN_BROKEN')
    }
    // K10: çatallanma kuralı yalnız eşzamanlı olaylara; eski bir noktadan açılan dal reddedilir.
    // K17: alarm yalnız gelen dal kazanacak olsaydı; bizim dal korunuyorsa sessizce kaybeder
    // (ör. bir hafta çevrimdışı kalıp yerelde PREKEY yayınlamış dürüst cihaz).
    if (e.seq < ledger.len - MAX_FORK_DEPTH) {
      if (keepMineOf(ledger.events.slice(e.seq), events.slice(i), ledger.events.slice(0, e.seq)) || buildBranch(ledger, e.seq, events.slice(i)).early) return { ...out, lost: events.slice(i) }
      throw new Error('fork_too_deep')
    }
    return { ...out, ...resolveFork(ledger, e.seq, events.slice(i)) }
  }
  return out
}

// K10: ayrışmadan sonra REMOVE_MEMBER ya da ROTATE_DEVICE içeren dal içermeyene karşı kaybetmez.
// İki taraf da iki dalı tümüyle gördüğü için karar simetriktir.
// prefix: ortak önekin olayları. Güçlü olay her dalda kendi önceki durumuyla değerlendirilir (§9: ebeveyn imzalı
// DEVICE_DETACH); iki taraf aynı olayları gördüğü için karar simetriktir.
function keepMineOf (mineBranch, theirs, prefix = null) {
  const sm = branchStrong(prefix, mineBranch)
  const st = branchStrong(prefix, theirs)
  if (sm !== st) return sm
  // İki dal da PREKEY ile başlıyorsa (çevrimdışı dönen cihaz) uzun dal kazanır; kaybeden ön anahtar yeniden yayınlanır
  if (mineBranch[0].type === T.PREKEY && theirs[0].type === T.PREKEY && mineBranch.length !== theirs.length) return mineBranch.length > theirs.length
  let L = null
  if (prefix) { try { L = Ledger.fromEvents(prefix) } catch { L = null } }
  return forkWinner(mineBranch[0], theirs[0], L && L.kind === 'ekip' ? L : null) === mineBranch[0]
}

function branchStrong (prefix, branch) {
  // Ebeveyn imzası gerektirmeyen türler durum olmadan bilinir
  if (branch.some((e) => e.type === T.REMOVE_MEMBER || e.type === T.ROTATE_DEVICE || e.type === T.REVOKE)) return true
  if (branch.some((e) => e.type === T.APP_PRIMARY && appPrimaryStrong(e))) return true
  if (!branch.some((e) => e.type === T.DEVICE_DETACH)) return false
  if (!prefix) return false
  let L
  try { L = Ledger.fromEvents(prefix) } catch { return false }
  for (const e of branch) {
    if (isStrong(e, L)) return true
    try { L.apply(e) } catch { return false }
  }
  return false
}

// K15: bekletilen olayları süresi dolunca yeniden dener. Dönüş ingest sonucu ya da null.
function retryDeferred (ledger) {
  const d = ledger.deferred
  if (!d || !d.length) return null
  if (ledger.tooEarly(d[0])) return { added: 0, deferred: d.length }
  ledger.deferred = null
  if (d[0].seq !== ledger.len) return null // defter başka yoldan ilerledi; eşitleme yeniden ister
  return ingest(ledger, { fromSeq: d[0].seq, events: d })
}

// Gelen dalı ortak önek üstünde kurar. Y-1 (inceleme 5): her olayda tooEarly; süresi dolmamış ACTIVATE'e
// gelinirse dal orada kesilir ve `early` döner (çatallanma ACTIVATE bekletmesini aşamaz). Kabul anları kopya
// üzerinde tutulur ki kaybeden daldaki ADD/ROTATE kalıcı kayda geçmesin. Geçersiz olay hata atar.
function buildBranch (ledger, seq, theirs) {
  const theirLedger = Ledger.fromEvents(ledger.events.slice(0, seq), { now: ledger.now, acceptedAt: new Map(ledger.acceptedAt) })
  for (const e of theirs) {
    if (theirLedger.tooEarly(e)) return { theirLedger, early: true }
    theirLedger.apply(e)
  }
  return { theirLedger, early: false }
}

// Çatallanma: ledger'ın seq'ten sonraki kolu ile theirs (seq'ten başlar) karşılaştırılır.
function resolveFork (ledger, seq, theirs) {
  const prefix = ledger.events.slice(0, seq)
  const { early } = buildBranch(ledger, seq, theirs) // geçersizse hata: bu kol kabul edilmez
  const mineBranch = ledger.events.slice(seq)
  // Süresi dolmamış ACTIVATE içeren dal kazanamaz; süre dolunca eşitleme kararı yeniden verir
  if (early || keepMineOf(mineBranch, theirs, prefix)) return { added: 0, dropped: [], replaced: false, lost: theirs }
  const dropped = ledger.events.slice(seq)
  ledger.replaceWith([...prefix, ...theirs])
  return { added: theirs.length, dropped, replaced: true }
}

const encodeReq = (m) => c.encode(ledgerReq, m)
const decodeReq = (b) => { try { return c.decode(ledgerReq, b) } catch { throw new Error('CORRUPT_LEDGER') } }
const encodeEvents = (m) => c.encode(ledgerEvents, m)
// P17: ağdan gelen gövde; bozuksa kodlu hata (eskiden "Out of bounds" gibi ham metin güvenlik olayına kod olarak gidiyordu)
const decodeEvents = (b) => { try { return c.decode(ledgerEvents, b) } catch { throw new Error('CORRUPT_LEDGER') } }

module.exports = { isStrong, isRemoval, signerCount, MAX_FORK_DEPTH, retryDeferred, keepMineOf, buildBranch, forkWinner, makeReq, answerReq, ingest, resolveFork, ledgerReq, ledgerEvents, encodeReq, decodeReq, encodeEvents, decodeEvents }
