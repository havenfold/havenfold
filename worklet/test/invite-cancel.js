// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Codex 10. tur (D106 K4): sınırlı iptal oturumunun eşitleyici ve worklet ucu. Aile tarafında yetkili telefon iptal
// edilen davetliye yalnız imzalı iptali (GUEST_REVOKED) yollar; bekleyen telefon beklerken selam vermez, iptali törende
// aldığı defterle doğrular, "invite-revoked" olayı gider ve örnek silinir. Taşıyıcı ucu core/transport/test/invite-cancel.js.
'use strict'
const test = require('brittle')
const b4a = require('b4a')
const { identity: { createIdentity }, ledger: { Ledger, signEvent, encodeEvent, decodeEvent }, zarf: { Z }, guestView: GV, hello: { CAPS } } = require('@havenfold/core')
const S = require('@havenfold/sdk')
const { Esitleyici } = require('../synchronizer')
const { start } = require('..')
const { urunSunucusu } = require('../example/product')
const { geciciDizin, kaliciAc, ipcCifti, istemci, arsivAnahtari } = require('./helpers/common')

const hex = (b) => b4a.toString(b, 'hex')
const bekle = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function kosul (f, ms = 10000) { const son = Date.now() + ms; while (!(await f())) { if (Date.now() > son) throw new Error('TIMEOUT'); await bekle(10) } }
const kim = (ad) => createIdentity({ seed: 'worklet-davet-iptal/' + ad, platform: 'test' })
const KEREM = kim('kerem')
const IREM = kim('irem')
const kopya = (L) => { const K = new Ledger({ now: L.now }); for (const e of L.events) K.apply(decodeEvent(encodeEvent(e))); return K }

// Kerem ebeveyn, İrem yetişkin; yeni gelen uzaktan eklendi (bekleyen). LS: yeni gelenin törende aldığı defter
function aile (yeni) {
  const now = () => 1_800_000_000_000
  const { ledger: L } = S.LedgerApi.createFamily({ Ledger, me: KEREM, familyName: 'Eser', displayName: 'Kerem', ts: now() - 10_000 })
  L.now = now
  const kerem = new S.LedgerApi({ ledger: L, me: KEREM, now })
  for (const [k, ad, uzaktan] of [[IREM, 'İrem', false], [yeni, 'Saadet', true]]) {
    const r = kerem.addMember({ deviceCert: k.deviceCert, displayName: ad, role: 'yetiskin', ceremonyTranscriptHash: b4a.alloc(32, 3), remote: uzaktan })
    if (r.durum === 'uygulandi') continue
    signEvent(r.event, k)
    if (uzaktan) signEvent(r.event, IREM) // tek ebeveynde bir yetişkin de imzalar (D106 K2)
    L.apply(r.event)
  }
  const LS = kopya(L)
  const iptal = kerem.revokeMember(hex(yeni.memberId)).event
  return { L, LS, iptal, now }
}

function esitleyici (t, kimlik, L, ek = {}) {
  const k = kaliciAc({ dizin: geciciDizin(t), now: L.now, kimlik })
  k.aileBagla(kopya(L))
  t.teardown(() => k.kapat())
  const giden = []
  const hatalar = []
  const e = new Esitleyici({ kalici: k, ag: { gonder: (p, type, bytes) => { giden.push({ p, type, bytes }) } }, hata: (err) => hatalar.push(err.message), ...ek })
  return { k, e, giden, hatalar }
}

test('aile tarafı: yetkili telefon davetliye yalnız imzalı iptali yollar; yetişkin hiçbir şey; eşitleme ve selam yok', (t) => {
  const SAADET = kim('saadet-1')
  const x = aile(SAADET)
  const s = hex(SAADET.memberId)
  const kerem = esitleyici(t, KEREM, x.L)
  kerem.e.baglandi(s)
  t.is(kerem.giden.length, 1, 'tek zarf')
  t.is(kerem.giden[0].type, Z.GUEST_REVOKED)
  t.alike(GV.verifyInviteRevoked(x.LS, kerem.giden[0].bytes, s).grantId, SAADET.memberId, 'yeni gelenin defteriyle doğrulanır')
  t.absent(kerem.e.acik.has(s), 'açık oturumlara girmez (eşitleme, çevrimiçi bilgisi yok)')
  kerem.giden.length = 0
  kerem.e.akit()
  t.alike(kerem.giden, [], 'sonradan da bir şey gitmez')
  const irem = esitleyici(t, IREM, x.L)
  irem.e.baglandi(s)
  t.alike(irem.giden, [], 'yetişkin yollamaz (davetli onu NOT_SIGNER ile reddederdi)')
  // Davetliden gelen her zarf aile tarafında süzgeçte düşer
  t.is(kerem.e.al(s, Z.LEDGER_REQ, b4a.from([0]), 'dogrudan').hata, 'TYPE_NOT_ALLOWED')
})

test('bekleyen telefon: selam vermez; iptal doğrulanınca davetIptal; yetkisiz ya da bozuk iptal hata, etkin üyede yok sayılır', (t) => {
  const SAADET = kim('saadet-2')
  const x = aile(SAADET)
  const k = hex(KEREM.memberId)
  const cagri = []
  const s = esitleyici(t, SAADET, x.LS, { davetIptal: (r) => cagri.push(r) })
  s.e.baglandi(k)
  t.alike(s.giden, [], 'beklerken ebeveyne defter isteği ya da kayıt gitmez')
  // Gelen yön de yalnız iptal (Codex 11. tur): bekleyen telefonun oturum rolü 'davetli'; defter, kayıt ve SDK'nın
  // kendisi çözdüğü türler süzgeçte düşer
  t.is(s.e.benimRol, 'davetli')
  for (const tur of [Z.LEDGER_EVENTS, Z.LEDGER_REQ, Z.REC_OPS, Z.LEDGER_PROPOSE, Z.BLOB_DATA]) {
    t.is(s.e.al(k, tur, b4a.from([0]), 'dogrudan').hata, 'TYPE_NOT_ALLOWED', 'beklerken gelen tür ' + tur)
  }
  t.is(s.e.reddedilen, 5)
  const yetkisiz = GV.encodeGuestRevoked(x.L.familyId, SAADET.memberId, x.iptal, IREM)
  t.is(s.e.al(hex(IREM.memberId), Z.GUEST_REVOKED, yetkisiz, 'dogrudan').hata, 'NOT_SIGNER')
  t.alike(cagri, [], 'yetkisiz iptal silmez')
  const z = GV.encodeGuestRevoked(x.L.familyId, SAADET.memberId, x.iptal, KEREM)
  t.alike(s.e.al(k, Z.GUEST_REVOKED, z, 'dogrudan'), { hata: null })
  t.is(cagri.length, 1, 'davetIptal')
  t.alike(cagri[0].grantId, SAADET.memberId)
  // Etkin üye (bekleyen değil) GUEST_REVOKED'i yok sayar
  const kerem = esitleyici(t, KEREM, x.L, { davetIptal: () => cagri.push('yanlis') })
  t.alike(kerem.e.al(hex(IREM.memberId), Z.GUEST_REVOKED, z, 'dogrudan'), { hata: null })
  t.is(cagri.length, 1)
})

test('worklet: sınırlı oturumdan gelen iptal "invite-revoked" olayı verir, yerel aile silinir (kök sıfırlanır)', async (t) => {
  const ipc = ipcCifti()
  const c = istemci(ipc)
  const ARSIV = arsivAnahtari(93)
  // Taşıyıcının ağ kancası yerine: gelen zarf taşıyıcının yaptığı gibi isl.al ile teslim edilir
  let isl = null
  const ag = { gonder: () => true, dinle: (x) => { isl = x } }
  const w = await start({ urunSunucusu, dizin: geciciDizin(t, 'invite-revoked'), anahtar: b4a.alloc(32, 9), archivePubHex: ARSIV.pubHex, ipc, appId: 'ornek', ag })
  t.teardown(() => w.kapat())
  const SAADET = w.kalici.kimlik
  const x = aile(SAADET)
  w.aileBagla(kopya(x.LS))
  const eskiKimlik = hex(SAADET.memberId)
  t.ok(w.kalici.nesneler.ledger.isPending(eskiKimlik), 'bekleyen üye olarak bağlandı')
  const z = GV.encodeGuestRevoked(x.L.familyId, SAADET.memberId, x.iptal, KEREM)
  isl.baglandi(hex(KEREM.memberId))
  const r = isl.al(hex(KEREM.memberId), Z.GUEST_REVOKED, z, 'dogrudan')
  t.alike(r, { hata: null })
  await kosul(() => c.olaylar.some((o) => o.olay === 'invite-revoked'))
  t.alike(c.olaylar.find((o) => o.olay === 'invite-revoked').veri, { memberId: eskiKimlik })
  await kosul(() => !w.kalici.nesneler.aile && hex(w.kalici.kimlik.memberId) !== eskiKimlik)
  t.pass('kök sıfırlandı: aile yok, yeni kimlik')
})

// Codex 12. tur: bekleme biterken yarış. Bekleme süresi her telefonda kendi kabul anından sayılır (readyAt); daveti
// başlatan ebeveyn süresi dolunca ACTIVATE_MEMBER'ı yazar ve oturum açılınca defteri yollar. Bekleyen telefonun süresi
// birkaç dakika sonra dolarsa (töreni geç bitirdi ya da saati geride) o defter beklerken süzgeçte düşer; süresi dolunca
// bekleyen telefon açık oturumlarını selamlamalı, yoksa oturum kopana dek etkinleşmez ve eşitlenmez
test('bekleme biterken: etkinleştirme süre dolmadan geldiyse bekleyen telefon süresi dolunca açık oturumu selamlar', (t) => {
  const T0 = 1_800_000_000_000
  let saat = T0
  const now = () => saat
  const SAADET = kim('saadet-3')
  const { ledger: L } = S.LedgerApi.createFamily({ Ledger, me: KEREM, familyName: 'Eser', displayName: 'Kerem', ts: T0 - 10_000 })
  L.now = now
  const kerem0 = new S.LedgerApi({ ledger: L, me: KEREM, now })
  for (const [k, ad, uzaktan] of [[IREM, 'İrem', false], [SAADET, 'Saadet', true]]) {
    const r = kerem0.addMember({ deviceCert: k.deviceCert, displayName: ad, role: 'yetiskin', ceremonyTranscriptHash: b4a.alloc(32, 3), remote: uzaktan })
    if (r.durum === 'uygulandi') continue
    signEvent(r.event, k)
    if (uzaktan) signEvent(r.event, IREM)
    L.apply(r.event)
  }
  const s = hex(SAADET.memberId)
  const k = hex(KEREM.memberId)
  const kerem = esitleyici(t, KEREM, L)
  saat = T0 + 5 * 60_000 // bekleyen telefon defteri 5 dakika sonra kabul etti
  const saadet = esitleyici(t, SAADET, L)
  const DS = saadet.k.nesneler.ledger
  t.ok(DS.readyAt(s) > kerem.k.nesneler.ledger.readyAt(s), 'bekleyenin süresi daha geç dolar')
  const aktar = () => {
    for (let i = 0; i < 6; i++) {
      for (const [a, b, ad] of [[kerem, saadet, k], [saadet, kerem, s]]) {
        const l = a.giden.splice(0)
        for (const m of l) b.e.al(ad, m.type, m.bytes, 'dogrudan')
      }
    }
  }
  // Ebeveynin süresi doldu, bekleyeninki dolmadı: ebeveyn yazar; taşıyıcı oturumu açar
  saat = kerem.k.nesneler.ledger.readyAt(s) + 1000
  t.ok(saat < DS.readyAt(s))
  t.is(kerem.k.nesneler.defter.activateMember(s).durum, 'uygulandi')
  kerem.e.baglandi(s)
  const gizli = CAPS.LEDGER_V21 | CAPS.HIDE_PRESENCE
  saadet.e.baglandi(k, { caps: gizli })
  aktar()
  t.ok(DS.isPending(s), 'beklerken gelen defter düştü')
  t.ok(saadet.e.reddedilen > 0)
  t.absent(saadet.e.beklemeYokla(), 'süre dolmadan yoklama bir şey yapmaz')
  t.alike(saadet.giden, [])
  // Bekleyenin süresi dolar; oturum açık kalır. start.js'in düzenli yoklamasında eşitleme açılır
  saat = DS.readyAt(s) + 1000
  t.ok(saadet.e.beklemeYokla())
  aktar()
  t.absent(saadet.k.nesneler.ledger.isPending(s), 'süresi dolunca açık oturumdan etkinleşme gelir')
  t.ok(saadet.e.acik.has(k), 'ebeveyn açık oturumlarda')
  t.is(saadet.k.nesneler.caps.get(k).caps, gizli, 'beklerken gelen HELLO yetenekleri kaybolmaz (HIDE_PRESENCE)')
})

// Codex 12. tur (D106 K3): daveti başlatan ebeveynin çekirdeği bekleme bitince ACTIVATE_MEMBER'ı kendiliğinden yazar.
// Yoklamanın kapısı ad değişikliğinde eski yöntem adında (uzaktanEtkinlestirilecekler) kalmıştı ve her seferinde erken
// dönüyordu: üye biri elle etkinleştirene dek bekleyen kalırdı
test('worklet: daveti başlatan ebeveynin çekirdeği bekleme bitince uzaktan üyeyi kendiliğinden etkinleştirir', async (t) => {
  const T0 = 1_800_000_000_000
  let saat = T0
  const now = () => saat
  const ipc = ipcCifti()
  istemci(ipc)
  const ARSIV = arsivAnahtari(94)
  const w = await start({ urunSunucusu, dizin: geciciDizin(t, 'remote-activate'), anahtar: b4a.alloc(32, 9), archivePubHex: ARSIV.pubHex, ipc, appId: 'ornek', ag: { gonder: () => true }, now, kasaDenetimMs: 10 })
  t.teardown(() => w.kapat())
  const BEN = w.kalici.kimlik
  const SAADET = kim('saadet-4')
  const { ledger: L } = S.LedgerApi.createFamily({ Ledger, me: BEN, familyName: 'Eser', displayName: 'Kerem', ts: T0 - 10_000 })
  L.now = now
  const ben = new S.LedgerApi({ ledger: L, me: BEN, now })
  for (const [k, ad, uzaktan] of [[IREM, 'İrem', false], [SAADET, 'Saadet', true]]) {
    const r = ben.addMember({ deviceCert: k.deviceCert, displayName: ad, role: 'yetiskin', ceremonyTranscriptHash: b4a.alloc(32, 3), remote: uzaktan })
    if (r.durum === 'uygulandi') continue
    signEvent(r.event, k)
    if (uzaktan) signEvent(r.event, IREM)
    L.apply(r.event)
  }
  w.aileBagla(kopya(L))
  const s = hex(SAADET.memberId)
  const D = () => w.kalici.nesneler.ledger
  t.ok(D().isPending(s))
  await bekle(50)
  t.ok(D().isPending(s), 'süre dolmadan etkinleşmez')
  saat = D().readyAt(s) + 1000
  await kosul(() => !D().isPending(s), 3000)
  t.pass('süre dolunca kendiliğinden etkinleşti')
})

// Codex 13. tur: taşıyıcı bağlantıyı baglandi(p, { caps }) ile bildirir; start.js'in ağ kancası ikinci argümanı
// atıyordu. Doğrudan eşitleyici testleri geçerken gerçek başlatma yolunda HELLO yetenekleri hiç kaydedilmiyordu:
// HIDE_PRESENCE'li üye çevrimiçi görünür, UZAKTAN_IPTAL bildirilmemiş sayılır ve davet iptali UPDATE_PENDING olurdu
test('worklet: start() ağ kancası HELLO yeteneklerini eşitleyiciye geçirir (caps saklama, gizlilik, davet iptali)', async (t) => {
  const ipc = ipcCifti()
  istemci(ipc)
  const ARSIV = arsivAnahtari(95)
  let isl = null
  const ag = { gonder: () => true, dinle: (x) => { isl = x } }
  const w = await start({ urunSunucusu, dizin: geciciDizin(t, 'start-caps'), anahtar: b4a.alloc(32, 9), archivePubHex: ARSIV.pubHex, ipc, appId: 'ornek', ag })
  t.teardown(() => w.kapat())
  const BEN = w.kalici.kimlik
  const SAADET = kim('saadet-5')
  const now = () => 1_800_000_000_000
  const { ledger: L } = S.LedgerApi.createFamily({ Ledger, me: BEN, familyName: 'Eser', displayName: 'Kerem', ts: now() - 10_000 })
  L.now = now
  const ben = new S.LedgerApi({ ledger: L, me: BEN, now })
  for (const [k, ad, uzaktan] of [[IREM, 'İrem', false], [SAADET, 'Saadet', true]]) {
    const r = ben.addMember({ deviceCert: k.deviceCert, displayName: ad, role: 'yetiskin', ceremonyTranscriptHash: b4a.alloc(32, 3), remote: uzaktan })
    if (r.durum === 'uygulandi') continue
    signEvent(r.event, k)
    if (uzaktan) signEvent(r.event, IREM)
    L.apply(r.event)
  }
  w.aileBagla(kopya(L))
  const n = w.kalici.nesneler
  const irem = hex(IREM.memberId)
  const s = hex(SAADET.memberId)
  t.ok(n.ledger.isPending(s), 'Saadet bekleyen uzaktan üye')
  t.ok(isl, 'ağ kancası bağlandı')
  const caps = CAPS.LEDGER_V21 | CAPS.HIDE_PRESENCE | CAPS.UZAKTAN_IPTAL
  isl.baglandi(irem, { caps })
  t.ok(n.caps.get(irem), 'HELLO yetenekleri kaydedildi')
  t.is(n.caps.get(irem)?.caps, caps)
  t.is(n.defter.presence(irem).online, false, 'HIDE_PRESENCE: oturum açıkken de görünmez')
  let r = null
  try { r = n.defter.revokeMember(s) } catch (err) { r = { hata: err.message } }
  t.not(r && r.hata, 'UPDATE_PENDING', 'İrem UZAKTAN_IPTAL bildirdi: iptal yazılabilir')
  t.absent(n.ledger.members.get(s).active && n.ledger.isPending(s), 'davet iptal edildi')
})
