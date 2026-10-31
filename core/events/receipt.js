// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// receipt.js — SOS'ta kişi başına teslim, "Aldı" (RFC-0037)
//
// Alıcının çekirdeği SOS kaydını çözünce aynı koleksiyona kendi imzalı hf.sos.alindi kaydını yazar (yazar sınıfı kendi:
// görünüme yalnız oluşturanın işlemleri girer, _subj yazarla aynı; records/class.js). "Aldı" cihaz teslimidir; okundu yoktur
// (K1). Gönderende her alıcı kişi aldı, bekliyor (bütün kimlikleri 'sos-alindi' yeteneğini bildirdi) ya da bilinmiyor.
// Hata kodu yoktur: kurala uymayan alındı sayılmaz.
const b4a = require('b4a')
const { hlc: { msOf }, uygulama: U } = require('@havenfold/records')
const { kayitlarReplikadan } = require('./event')
const V = require('./case')

const hex = (b) => b4a.toString(b, 'hex')

const TUR = 'hf.sos.alindi'
const SOS = 'hf.sos'
const YETENEK = 'sos-alindi'
const KEEP_GUN = 7
const GELECEK_MS = 5 * 60_000 // §5.2 madde 6 (RFC-0006 §4.5 madde 3)
const YAZMA_MS = 86_400_000 // §5.3 c: yalnız son 24 saatteki SOS için yazılır (geçerlilik koşulu değil)

const tamsayi = (x) => Number.isSafeInteger(x)
const sosIdOf = (x) => (b4a.isBuffer(x) && x.byteLength === 16 ? hex(x) : null)

// SOS'u gönderen kişi; misafirin SOS'unda (grant: öznesi) null: her üye alıcıdır (§5.2 madde 4)
function gonderenKisi (L, sos) {
  if (sos.yazar !== 'uye') return null
  return L.personIdOf(sos.authorHex)
}

// Koleksiyonun geçerli alındıları (§5.2): sosRecordId → Map(personId → { t (en erken _t), authorHex })
// ks: kayitlarReplikadan(r, cid) (verilmezse hesaplanır)
function gecerliAlindilar (r, cid, ks = null) {
  cid = typeof cid === 'string' ? cid : hex(cid)
  ks = ks || kayitlarReplikadan(r, cid)
  const L = r.ledger
  const soslar = new Map(ks.filter((k) => k.type === SOS).map((k) => [k.recordId, k]))
  const out = new Map()
  for (const k of ks) {
    if (k.type !== TUR || k.yazar !== 'uye') continue
    // 1: kendi sınıfı (r.durumlar uygular; burada da _subj denetlenir)
    if (k.tf._subj !== 'uye:' + k.authorHex) continue
    // 2: yazar işlemin ledgerSeq anında üye ve koleksiyonun okuyucusu
    const op = r.ops.get(hex(k.stamp.opId))
    const seq = op && op.inner ? op.inner.ledgerSeq : null
    if (seq === null) continue
    const rol = r.rolAt(k.authorHex, seq)
    if (!rol || rol === 'cihaz' || rol === 'kutu' || !r.yetki.isReader(cid, k.authorHex, seq)) continue
    // 3: aynı koleksiyonda bir hf.sos
    const sosId = sosIdOf(k.tf.sos)
    const sos = sosId && soslar.get(sosId)
    if (!sos) continue
    // 4: yazarın kişisi SOS'u gönderen değil
    const kisi = L.personIdOf(k.authorHex)
    if (!kisi || kisi === gonderenKisi(L, sos)) continue
    // 5: sessiz SOS'ta alındı sayılmaz
    if (sos.tf.sessiz === true) continue
    // 6: _t, işlemin hlc'sinden en çok 5 dakika ileride
    const t = k.tf._t
    if (!tamsayi(t) || t > msOf(k.stamp.hlc) + GELECEK_MS) continue
    if (!out.has(sosId)) out.set(sosId, new Map())
    const m = out.get(sosId)
    const cur = m.get(kisi)
    if (!cur || t < cur.t) m.set(kisi, { t, authorHex: k.authorHex })
  }
  return out
}

// Vakası kapalı SOS'lar (§5.3 d): kaynağı cekirdek:hf.sos olan ve olaylarında SOS'u anan vakalar
function kapaliSoslar (ks, cid) {
  const kaynakOf = (kaynak) => (kaynak === 'cekirdek:' + SOS ? { onem: 3, hizmet: true } : null)
  const out = new Set()
  for (const d of V.vakaDurumlari(ks, b4a.from(cid, 'hex'), { sorumluOf: () => [], kaynakOf }).values()) {
    if (!d.kapali || d.kaynak !== 'cekirdek:' + SOS) continue
    for (const id of d.acilis.fields.olaylar || []) out.add(typeof id === 'string' ? id : hex(id))
  }
  return out
}

// Bu kimliğin yazacağı alındılar (§5.3 a–e; f'yi çağıran söyler: bildiren uygulama bu kimlik mi). Dönüş: [sosRecordId]
function yazilacaklar (r, cid, { now, ks = null } = {}) {
  cid = typeof cid === 'string' ? cid : hex(cid)
  const L = r.ledger
  const me = r.meHex
  const m = L.members.get(me)
  if (!m || !m.active || m.role === 'kutu' || L.isPending(me)) return []
  const seq = L.len - 1
  if (!r.yetki.isReader(cid, me, seq) || !r.yetki.isWriter(cid, me, seq)) return []
  ks = ks || kayitlarReplikadan(r, cid)
  const benimKisi = L.personIdOf(me)
  // e: bu kimliğin bu SOS için alındısı (görünümde ya da yazım kuyruğunda)
  const yazilmis = new Set()
  for (const k of ks) if (k.type === TUR && k.authorHex === me && sosIdOf(k.tf.sos)) yazilmis.add(sosIdOf(k.tf.sos))
  for (const i of r.writeQueue) {
    if (i.cid !== cid || i.partial.type !== TUR) continue
    const f = i.partial.fields.find((x) => x.name === 'sos')
    if (f && sosIdOf(f.value)) yazilmis.add(sosIdOf(f.value))
  }
  let kapali = null
  const out = []
  for (const k of ks) {
    if (k.type !== SOS || yazilmis.has(k.recordId)) continue
    if (gonderenKisi(L, k) === benimKisi) continue // a
    if (k.tf.sessiz === true) continue // b
    const t = k.tf._t
    if (!tamsayi(t) || t < now - YAZMA_MS) continue // c
    if (!kapali) kapali = kapaliSoslar(ks, cid)
    if (kapali.has(k.recordId)) continue // d
    out.push(k.recordId)
  }
  return out.sort()
}

// Alındı kaydının alanları (§5.1)
const alindiAlanlari = (me, sosRecordId, t) => ({ _subj: 'uye:' + me, _t: t, _keep: KEEP_GUN, sos: b4a.from(sosRecordId, 'hex') })

// Gönderende alıcılar (§6): SOS'un koleksiyonunu okuyan kişiler, gönderen hariç (kutu, cihaz, misafir alıcı değil).
// afet(personId) → { t } | null: afet yolundaki ALINDI (§7; çağıran yerel eşlemeden verir).
// Dönüş: [{ personId, durum: 'aldi' | 'bekliyor' | 'bilinmiyor', at, yol }] (personId sırasıyla). SOS yoksa NO_RECORD.
function sosAlicilari (r, cid, sosRecordId, { afet = () => null } = {}) {
  cid = typeof cid === 'string' ? cid : hex(cid)
  const rid = typeof sosRecordId === 'string' ? sosRecordId : hex(sosRecordId)
  const L = r.ledger
  const ks = kayitlarReplikadan(r, cid)
  const sos = ks.find((k) => k.recordId === rid && k.type === SOS)
  if (!sos) throw new Error('NO_RECORD')
  const gonderen = gonderenKisi(L, sos)
  const sessiz = sos.tf.sessiz === true
  const alindi = sessiz ? new Map() : gecerliAlindilar(r, cid, ks).get(rid) || new Map()
  const sosT = tamsayi(sos.tf._t) ? sos.tf._t : null
  const seq = L.len - 1
  const yetenekler = U.kayitlar(r)
  const kisiler = new Set()
  for (const id of L.personIds()) {
    const p = L.personIdOf(id)
    if (!p || p === gonderen || L.members.get(id)?.role === 'kutu') continue
    if (L.identitiesOf(p).some((x) => r.yetki.isReader(cid, x, seq))) kisiler.add(p)
  }
  const out = []
  for (const p of [...kisiler].sort()) {
    const k = alindi.get(p)
    const a = sessiz ? null : afet(p)
    const adaylar = [k ? { t: k.t, yol: 'kayit' } : null, a && tamsayi(a.t) ? { t: a.t, yol: 'afet' } : (a ? { t: null, yol: 'afet' } : null)].filter(Boolean)
    if (adaylar.length) {
      const enErken = adaylar.filter((x) => x.t !== null).sort((x, y) => x.t - y.t)[0] || adaylar[0]
      const at = enErken.t === null ? null : (sosT !== null ? Math.max(enErken.t, sosT) : enErken.t)
      out.push({ personId: p, durum: 'aldi', at, yol: enErken.yol })
      continue
    }
    // bekliyor: kişinin koleksiyonu okuyan bütün aktif kimlikleri 'sos-alindi' bildirdi (§6.3)
    const okuyan = L.identitiesOf(p).filter((x) => r.yetki.isReader(cid, x, seq))
    const hepsi = okuyan.length > 0 && okuyan.every((x) => (U.kimlikYetenekleri(L, yetenekler, x) || []).includes(YETENEK))
    out.push({ personId: p, durum: hepsi ? 'bekliyor' : 'bilinmiyor', at: null, yol: null })
  }
  return out
}

module.exports = { TUR, YETENEK, KEEP_GUN, YAZMA_MS, gecerliAlindilar, yazilacaklar, alindiAlanlari, sosAlicilari, kapaliSoslar }
