// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Codex 10. tur (D106 K4): iptal yeni üyeye ulaşmıyordu. Bekleyen uzaktan üyeyle oturum yok (K11); iptalle ebeveyn
// tarafında çift sırrı da kalkıyordu. Sınırlı iptal oturumu: bekleyen telefon beklerken yalnız yetkilileri arar; aile
// tarafı onu yalnız iptal ettiyse (30 gün) 'davetli' görür ve tek bir zarf yollar: imzalı REVOKE, GUEST_REVOKED'de.
// Ağ yok: bellek içi sahte DHT (d74.js ile aynı). Beklenenler elle yazıldı.
'use strict'
const test = require('brittle')
const b4a = require('b4a')
const sodium = require('sodium-native')
const { identity: { createIdentity }, ledger: { Ledger, T, signEvent, encodeEvent, decodeEvent, DAVETLI_MS }, pairs: { PairBook }, zarf: { Z, typeAllowed }, guestView: GV } = require('@havenfold/core')
const SDK = require('../../../sdk')
const T2 = require('..')

const hex = (b) => b4a.toString(b, 'hex')
const bekle = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms))
async function yoklaKosul (tts, f, ms = 5000) { const son = Date.now() + ms; while (!f()) { if (Date.now() > son) throw new Error('TIMEOUT'); for (const x of tts) x.yokla(); await bekle(5) } }
const hataOf = (f) => { try { f(); return null } catch (err) { return err.message } }

const kim = (ad) => createIdentity({ seed: 'davet-iptal/' + ad, platform: 'test' })
const KEREM = kim('kerem')
const HUSNIYE = kim('husniye')
const IREM = kim('irem')
const SAADET = kim('saadet')
const NUR = kim('nur')

class Yay {
  constructor () { this.d = new Map() }
  on (a, f) { if (!this.d.has(a)) this.d.set(a, []); this.d.get(a).push(f); return this }
  once (a, f) { const g = (...x) => { this.off(a, g); f(...x) }; return this.on(a, g) }
  off (a, f) { this.d.set(a, (this.d.get(a) || []).filter((x) => x !== f)); return this }
  emit (a, ...x) { for (const f of [...(this.d.get(a) || [])]) f(...x) }
}
class SahteSoket extends Yay {
  constructor (hash, remotePublicKey) { super(); this.handshakeHash = hash; this.remotePublicKey = remotePublicKey; this.karsi = null; this.kapali = false }
  write (b) { const k = this.karsi; if (!this.kapali && k && !k.kapali) setTimeout(() => k.emit('data', b4a.from(b)), 0) }
  destroy () { if (this.kapali) return; this.kapali = true; setTimeout(() => this.emit('close'), 0); if (this.karsi) this.karsi.destroy() }
}
class SahteDht extends Yay {
  constructor () { super(); this.dinleyen = new Map() }
  createServer (o, onconn) {
    const dht = this
    const s = { o, onconn, kp: null,
      listen: async (kp) => { s.kp = kp; dht.dinleyen.set(hex(kp.publicKey), s) },
      close: async () => { if (s.kp && dht.dinleyen.get(hex(s.kp.publicKey)) === s) dht.dinleyen.delete(hex(s.kp.publicKey)) } }
    return s
  }

  connect (pk, { keyPair }) {
    const hash = b4a.alloc(32); sodium.randombytes_buf(hash)
    const ara = new SahteSoket(hash, pk)
    const s = this.dinleyen.get(hex(pk))
    setTimeout(() => {
      if (!s || s.o.firewall(keyPair.publicKey)) { ara.destroy(); return }
      const dinle = new SahteSoket(hash, keyPair.publicKey)
      ara.karsi = dinle; dinle.karsi = ara
      ara.emit('open')
      s.onconn(dinle)
    }, 0)
    return ara
  }
}

const kopya = (L) => { const K = new Ledger({ now: L.now }); for (const e of L.events) K.apply(decodeEvent(encodeEvent(e))); return K }

// Kerem ve Hüsniye ebeveyn, İrem yetişkin; Saadet uzaktan eklendi (bekleyen). Saadet'in defteri törenin sonundaki kopya
function kur () {
  const saat = { t: 1_800_000_000_000 }
  const now = () => saat.t
  const { ledger: L } = SDK.LedgerApi.createFamily({ Ledger, me: KEREM, familyName: 'Eser', displayName: 'Kerem', ts: saat.t - 10_000 })
  L.now = now
  const kerem = new SDK.LedgerApi({ ledger: L, me: KEREM, now })
  const ekle = (k, ad, role, uzaktan = false) => {
    const r = kerem.addMember({ deviceCert: k.deviceCert, displayName: ad, role, ceremonyTranscriptHash: b4a.alloc(32, ad.length), remote: uzaktan })
    if (r.durum === 'uygulandi') return
    signEvent(r.event, k)
    for (const x of [HUSNIYE]) if (L.members.get(hex(x.memberId))?.active && !r.event.sigs.some((s) => b4a.equals(s.memberId, x.memberId))) signEvent(r.event, x)
    L.apply(r.event)
  }
  ekle(HUSNIYE, 'Hüsniye', 'ebeveyn')
  ekle(IREM, 'İrem', 'yetiskin')
  ekle(SAADET, 'Saadet', 'yetiskin', true)
  const LS = kopya(L) // Saadet'in törende aldığı defter
  return { L, LS, kerem, saat, now }
}

function iptalEt (x) {
  const r = x.kerem.revokeMember(hex(SAADET.memberId))
  if (r.durum !== 'uygulandi') throw new Error('NO_CANCEL')
  return r.event
}

test('Ledger.davetliMi: yalnız iptal edilen uzaktan davetli, 30 gün; oturum rolü değişmez', (t) => {
  const x = kur()
  const s = hex(SAADET.memberId)
  t.ok(x.L.isPending(s), 'Saadet bekleyen')
  t.absent(x.L.davetliMi(s), 'iptal edilmeden davetli değil (K11 aynen)')
  const e = iptalEt(x)
  t.ok(x.L.davetliMi(s), 'iptalden sonra davetli')
  t.is(x.L.sessionRole(s), null, 'oturum rolü yok: gelen zarf süzgeçte düşer')
  t.alike(x.L.davetliIds(), [s])
  t.absent(x.L.davetliMi(hex(IREM.memberId)), 'etkin üye davetli değil')
  x.saat.t = e.ts + DAVETLI_MS
  t.absent(x.L.davetliMi(s), '30 gün sonra davetli değil')
})

test('PairBook: davetli çifti yalnız istenince; iki taraf aynı çift sırrını kurar; önbelleğe girmez', (t) => {
  const x = kur()
  const s = hex(SAADET.memberId)
  const k = hex(KEREM.memberId)
  const bekleyen = new PairBook({ me: SAADET, ledger: x.LS })
  t.is(bekleyen.benimRolum(), 'davetli', 'bekleyen telefon beklerken davetli')
  t.is(bekleyen.get(k), null, 'istenmeden çift yok (afet yolu ve mühür görmez)')
  t.alike(bekleyen.peers(), [], 'eş listesi bugünkü gibi boş')
  const kb = bekleyen.get(k, { davetli: true })
  t.ok(kb && kb.session === 'uye', 'istenince ebeveynle sınırlı çift')
  const aile = new PairBook({ me: KEREM, ledger: x.L })
  t.is(aile.get(s, { davetli: true }), null, 'iptal edilmeden aile tarafında çift yok (K11)')
  iptalEt(x)
  t.is(aile.get(s), null, 'iptalden sonra da istenmeden yok')
  t.absent(aile.peers().some((p) => p.hex === s), 'olağan eş listesinde yok')
  const p = aile.peers({ davetli: true }).find((y) => y.hex === s)
  t.ok(p && p.session === 'davetli', 'taşıyıcının eş listesinde davetli')
  t.alike(p.pair, kb.pair, 'iki taraf aynı çift sırrı')
  t.absent(aile.cache.has(s), 'davetli çifti önbellekte değil')
  // Bekleme süresi dolunca bekleyen telefon üye gibi kurar (bugünkü kural)
  x.LS.now = () => x.LS.readyAt(s) + 1
  t.is(bekleyen.benimRolum(), 'uye')
})

test('oturum tablosu: davetli ↔ üye yalnız GUEST_REVOKED, yalnız üyeden', (t) => {
  t.ok(typeAllowed('uye', 'davetli', Z.GUEST_REVOKED, 'giden'), 'üye yollar')
  t.ok(typeAllowed('davetli', 'uye', Z.GUEST_REVOKED, 'gelen'), 'davetli alır')
  t.absent(typeAllowed('davetli', 'uye', Z.GUEST_REVOKED, 'giden'), 'davetli yollayamaz')
  t.absent(typeAllowed('uye', 'davetli', Z.GUEST_REVOKED, 'gelen'))
  for (const tur of [Z.LEDGER_EVENTS, Z.LEDGER_REQ, Z.REC_OPS, Z.GUEST_VIEW, Z.HOLD]) {
    t.absent(typeAllowed('uye', 'davetli', tur, 'giden'), 'başka tür yok: ' + tur)
    t.absent(typeAllowed('davetli', 'uye', tur, 'giden'))
  }
  t.absent(typeAllowed('davetli', 'davetli', Z.GUEST_REVOKED), 'davetli ↔ davetli yok')
})

test('verifyInviteRevoked: bilinen yetkilinin imzası, bu aile ve bu kimlik; yetişkin, başka kimlik ve bozuk imza reddedilir', (t) => {
  const x = kur()
  const e = iptalEt(x)
  const s = hex(SAADET.memberId)
  const z = GV.encodeGuestRevoked(x.L.familyId, SAADET.memberId, e, KEREM)
  t.alike(GV.verifyInviteRevoked(x.LS, z, s).grantId, SAADET.memberId, 'Kerem\'in zarfı geçerli')
  t.ok(GV.verifyInviteRevoked(x.LS, GV.encodeGuestRevoked(x.L.familyId, SAADET.memberId, e, HUSNIYE), s), 'öbür ebeveyn de yollayabilir')
  t.is(hataOf(() => GV.verifyInviteRevoked(x.LS, GV.encodeGuestRevoked(x.L.familyId, SAADET.memberId, e, IREM), s)), 'NOT_SIGNER', 'yetişkin yetkili değil')
  t.is(hataOf(() => GV.verifyInviteRevoked(x.LS, z, hex(NUR.memberId))), 'INVALID_VIEW', 'başka kimliğin iptali')
  t.is(hataOf(() => GV.verifyInviteRevoked(x.LS, GV.encodeGuestRevoked(b4a.alloc(32, 9), SAADET.memberId, e, KEREM), s)), 'INVALID_SIGNATURE', 'başka ailenin imzası')
  const bozuk = b4a.from(z)
  bozuk[bozuk.length - 1] ^= 1
  t.is(hataOf(() => GV.verifyInviteRevoked(x.LS, bozuk, s)), 'INVALID_SIGNATURE')
  // REVOKE değil, başka olay: reddedilir
  const baska = x.L.events[x.L.len - 2]
  t.is(hataOf(() => GV.verifyInviteRevoked(x.LS, GV.encodeGuestRevoked(x.L.familyId, SAADET.memberId, baska, KEREM), s)), 'INVALID_VIEW')
  t.is(hataOf(() => GV.verifyInviteRevoked(x.LS, b4a.from([1, 2, 3]), s)), 'INVALID_VIEW')
})

// Taşıyıcılar: Kerem, Hüsniye (ebeveyn), İrem (yetişkin) iptalden sonraki defterle; Saadet törendeki defterle
const ORTA = T2.DILIM_MS * 500_000 + T2.DILIM_MS / 2
function tasiyici (dht, kimlik, L) {
  const k = { baglandi: [], gelen: [] }
  const tt = new T2.DhtTasiyici({ dht, cihaz: () => ({ kimlik, ledger: L }), now: () => ORTA, deneysel: true, yoklamaMs: 1e9, hizliMs: 1e9 })
  tt.ag.dinle({
    baglandi: (p) => {
      k.baglandi.push(p)
      // Eşitleyicinin işi (worklet/synchronizer.js _davetIptaliYolla): yetkili telefon davetliye imzalı iptali yollar
      if (L.davetliMi(p) && L.authorityIds().includes(hex(kimlik.memberId))) {
        const m = L.members.get(p)
        tt.ag.gonder(p, Z.GUEST_REVOKED, GV.encodeGuestRevoked(L.familyId, b4a.from(p, 'hex'), L.events[m.removedSeq], kimlik))
      }
    },
    koptu: () => {},
    al: (p, type, bytes) => k.gelen.push({ p, type, bytes })
  })
  return { tt, k }
}

test('taşıyıcı: iptal edilmeden bekleyenle oturum yok; iptalden sonra yalnız ebeveynler bağlanır ve imzalı iptal ulaşır', async (t) => {
  const x = kur()
  const dht = new SahteDht()
  const s = hex(SAADET.memberId)
  const aile = [KEREM, HUSNIYE, IREM].map((kimlik) => ({ kimlik, ...tasiyici(dht, kimlik, x.L) }))
  const saadet = tasiyici(dht, SAADET, x.LS)
  const hepsi = [...aile.map((a) => a.tt), saadet.tt]
  t.teardown(async () => { for (const tt of hepsi) await tt.kapat() })
  for (let i = 0; i < 20; i++) { for (const tt of hepsi) tt.yokla(); await bekle(5) }
  t.alike(saadet.k.baglandi, [], 'iptal edilmeden kimse bekleyenle oturum kurmaz (K11)')
  t.ok(aile.every((a) => !a.k.baglandi.includes(s)))
  iptalEt(x)
  await yoklaKosul(hepsi, () => saadet.k.gelen.length >= 2)
  const ebeveynler = [KEREM, HUSNIYE].map((k) => hex(k.memberId)).sort()
  t.alike([...new Set(saadet.k.baglandi)].sort(), ebeveynler, 'Saadet yalnız ebeveynlere bağlandı (yetişkin İrem değil)')
  t.absent(aile.find((a) => a.kimlik === IREM).k.baglandi.includes(s), 'yetişkin davetliyle oturum kurmaz')
  for (const g of saadet.k.gelen) {
    t.is(g.type, Z.GUEST_REVOKED)
    t.alike(GV.verifyInviteRevoked(x.LS, g.bytes, s).grantId, SAADET.memberId, 'iptal doğrulandı')
  }
  // Davetli aileye bir şey yollayamaz: aile tarafının gelen zarfları süzgeçte düşer (oturum rolü yok)
  t.is(x.L.sessionRole(s), null)
})

test('HELLO: iptal edilen davetli yalnız taşıyıcının istediği yerde (afet yolu ve öbürleri NOT_MEMBER)', async (t) => {
  const x = kur()
  iptalEt(x)
  const dht = new SahteDht()
  const { hello: H, messages: M } = require('@havenfold/core')
  const c = require('compact-encoding')
  const yakalanan = []
  const kerem = tasiyici(dht, KEREM, x.L)
  const saadet = tasiyici(dht, SAADET, x.LS)
  const asil = H.verifyHello
  H.verifyHello = (h, socket, L, peerHex, o) => { const r = asil(h, socket, L, peerHex, o); if (peerHex === hex(SAADET.memberId)) yakalanan.push({ h, socket, L, peerHex, r }); return r }
  t.teardown(async () => { H.verifyHello = asil; await kerem.tt.kapat(); await saadet.tt.kapat() })
  await yoklaKosul([kerem.tt, saadet.tt], () => yakalanan.length > 0)
  const y = yakalanan[0]
  t.is(y.r.role, 'davetli', 'taşıyıcı davetliyi tanır')
  t.alike(asil(y.h, y.socket, y.L, y.peerHex), { ok: false, code: 'NOT_MEMBER' }, 'seçeneksiz (afet yolu) tanımaz')
  t.ok(M && c)
})
