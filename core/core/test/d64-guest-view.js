// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D64: misafir görünümü (GUEST_VIEW, GUEST_REVOKED) ret yolları ve kurulum ayrıntıları (RFC-0003 §7, RFC-0019 §5.3–5.4,
// RFC-0020 d, e). Her test bir davranışı beklenen hata koduyla doğrular. Beklenen değerler elle yazılmıştır.
const test = require('brittle')
const b4a = require('b4a')
const c = require('compact-encoding')
const sodium = require('sodium-native')
const { Ledger, T, decodeEvent, encodeEvent } = require('../ledger/ledger')
const GV = require('../protocol/guest-view')
const V = require('./helpers/v21')
const EK = require('./helpers/team-install')
const { C0, E } = require('../../records/test/helpers/multi-vector')

const { K, C, hex, olay, koleksiyon, misafirEkle, misafirKaldir, anaAdimlar, uye, TS0 } = V
const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const id = (k) => hex(k.memberId)
const kopyaOlay = (e) => decodeEvent(encodeEvent(e))
const X = b4a.alloc(16, 0x5c) // bu dosyanın ek bakıcı koleksiyonu

function anaDefter (n = Infinity) {
  const L = new Ledger({ now: () => TS0 })
  for (const f of anaAdimlar(L).slice(0, n)) L.apply(f())
  return L
}
function cokluDefter () {
  const L = new Ledger({ now: () => TS0 })
  for (const e of C0) L.apply(kopyaOlay(e))
  return L
}
const rotate = (L, eski, yeni, imz) => olay(L, T.ROTATE_DEVICE, { oldMemberId: eski.memberId, newDeviceCert: yeni.deviceCert, ceremonyTranscriptHash: b4a.alloc(32, 7) }, imz)
const primary = (L, kisi, yeni, imz, ek = {}) => olay(L, T.APP_PRIMARY, { personId: kisi.memberId, newPrimaryId: yeni.memberId, ...ek }, imz)
const yer = (L, imz = [K.kerem]) => olay(L, T.PLACE, { placeId: b4a.alloc(16, 0x77), name: 'X', kind: 'ev', remove: false }, imz)
const kabul = (prev, bytes, misafir = C.misafir1) => GV.acceptGuestView(prev, bytes, misafir.memberId)

// Görünümü çözer, değiştirir ve verilen kimlikle yeniden imzalar (saldırganın ya da hatalı ebeveynin ürettiği görünüm)
function yenidenImzala (bytes, imzaci, degistir) {
  const view = c.decode(GV.unsignedView, bytes.subarray(0, bytes.byteLength - 64))
  degistir(view)
  const unsigned = c.encode(GV.unsignedView, view)
  const sig = b4a.alloc(64)
  sodium.crypto_sign_detached(sig, GV.viewDigest(view.familyId, unsigned), imzaci.signKeyPair.secretKey)
  return b4a.concat([unsigned, sig])
}
// Olayın gövdesini bozar (imzalar artık tutmaz; gövde çözülemez)
function govdesiBozuk (e) {
  const k = kopyaOlay(e)
  k.body = b4a.from([0xff, 0xff, 0xff])
  return encodeEvent(k)
}

// --- Ebeveyn tarafı: buildGuestView ve halefZinciri ------------------------------------------------------------

test('D64 kurulum: uye: okuyucusu kişiye çözülür; ayrılan üye görünüme girmez; misafirin defter yüzü', (t) => {
  const L = anaDefter(16) // misafir yok
  L.apply(koleksiyon(L, [K.kerem], {
    collectionId: X,
    name: 'Bakıcı 2',
    kind: 'bakici',
    readers: ['rol:ebeveyn', uye(K.irem), uye(K.husniye)],
    writers: ['rol:ebeveyn'],
    taskAccess: false,
    history: false
  }))
  L.apply(misafirEkle(L, C.misafir1, [K.kerem], { collections: [X] }))
  L.apply(olay(L, T.LEAVE, { memberId: K.irem.memberId }, [K.irem]))
  const gv = GV.buildGuestView(L, id(C.misafir1), K.kerem)
  const v = kabul(null, gv)
  t.ok(v.peers.has(id(K.husniye)), 'uye: okuyucu kişiye çözülür')
  t.absent(v.peers.has(id(K.irem)), 'ayrılan üye yok')
  t.ok(v.collections.has(hex(X)))
  t.alike(v.peers.get(id(K.kerem)).writerOf, [X], 'ebeveyn yazar')

  // Misafirin defter yüzü. Ebeveyn görünüme cihaz eşi koyarsa (ör. ileride olaylar yazarı) oturumda cihaz sayılır.
  const cihazli = kabul(null, yenidenImzala(gv, K.kerem, (w) => {
    w.peers.push({ id: C.isci1.memberId, signPub: C.isci1.signKeyPair.publicKey, udaPub: C.isci1.deviceCert.udaPub, role: 'cihaz', anchor: b4a.alloc(32, 4), writerOf: [] })
  }))
  const D = GV.guestLedger(cihazli)
  t.is(D.sessionRole(id(C.misafir1)), 'misafir')
  t.is(D.sessionRole(id(C.isci1)), 'cihaz')
  t.is(D.sessionRole(id(K.kerem)), 'uye')
  t.is(D.sessionRole(id(K.irem)), null, 'görünümde olmayan')
  t.is(D.entity(id(K.irem)), null)
  t.is(D.entity(id(C.isci1)).role, 'cihaz')
  t.absent(D.isPending(id(K.kerem)))
  t.alike(D.anchorFor(C.misafir1.memberId, K.kerem.memberId), D.anchorFor(K.kerem.memberId, C.misafir1.memberId), 'çapa sıradan bağımsız')
  t.alike(D.anchorFor(C.misafir1.memberId, C.isci1.memberId), b4a.alloc(32, 4))
  t.alike(D.activeDeviceIds(), [])
  t.alike(D.activeGrantIds(), [])
  t.alike(D.activeIds().sort(), [...cihazli.peers.keys()].sort())
})

test('D64 kurulum: ekipte yer: okuyucusu yalnız o yere atanmış o roldeki kişiyi görünüme koyar', (t) => {
  const L = EK.ekip()
  L.apply(V.ekle(L, K.u5, 'calisan', [K.kerem]))
  L.apply(EK.ata(L, K.u5, [EK.YER_A], [K.kerem]))
  L.apply(V.ekle(L, K.u6, 'calisan', [K.kerem]))
  L.apply(EK.ata(L, K.u6, [EK.YER_B], [K.kerem]))
  L.apply(koleksiyon(L, [K.kerem], {
    collectionId: X,
    name: 'Bakıcı A',
    kind: 'bakici',
    readers: ['rol:sahip', 'yer:' + hex(EK.YER_A) + '/rol:calisan'],
    writers: ['rol:sahip'],
    taskAccess: false,
    history: false
  }))
  L.apply(misafirEkle(L, C.misafir1, [K.kerem], { collections: [X] }))
  const v = kabul(null, GV.buildGuestView(L, id(C.misafir1), K.kerem))
  t.ok(v.peers.has(id(K.u5)), 'A şubesinin çalışanı')
  t.absent(v.peers.has(id(K.u6)), 'B şubesinin çalışanı yok')
  t.is(v.peers.get(id(K.kerem)).role, 'sahip', 'ekipte sahip görünüm imzalar')
})

test('D64 halefZinciri: kimlik değişimi yoksa zincir boş; en çok son 4 adım', (t) => {
  const L = anaDefter(17)
  t.alike(GV.halefZinciri(L, id(K.kerem), id(K.husniye)), [], 'Hüsniye Kerem\'in halefi değil')
  const sira = [K.kerem, K.yeniKerem, K.u5, K.u6, K.u7, K.u8]
  for (let i = 1; i < sira.length; i++) L.apply(rotate(L, sira[i - 1], sira[i], [sira[i], sira[i - 1], K.husniye]))
  const z = GV.halefZinciri(L, id(K.kerem), id(K.u8))
  t.is(z.length, GV.MAX_HALEF)
  t.alike(z[z.length - 1].newPub, K.u8.deviceCert.ukaPub)
  t.alike(decodeEvent(z[0].event).body, L.events[L.member(K.u5.memberId).addedSeq].body, 'ilk adım yeniKerem → u5')
})

// --- Misafir tarafı: biçim, imzacı ve GRANT ---------------------------------------------------------------------

test('D64 acceptGuestView: kısa ya da çözülemeyen bayt INVALID_VIEW', (t) => {
  t.is(hataOf(() => kabul(null, b4a.alloc(10))), 'INVALID_VIEW', '64 bayttan kısa')
  t.is(hataOf(() => kabul(null, b4a.alloc(200, 0xab))), 'INVALID_VIEW', 'çözülemeyen gövde')
  const gv = GV.buildGuestView(anaDefter(17), id(C.misafir1), K.kerem)
  t.is(hataOf(() => kabul(null, b4a.concat([gv.subarray(0, -64), b4a.from([0]), gv.subarray(-64)]))), 'INVALID_VIEW', 'sonda fazladan bayt')
})

test('D64 acceptGuestView: imzacı görünümde yoksa ya da yetkili rolde değilse NOT_SIGNER', (t) => {
  const L = anaDefter(17)
  const gv = GV.buildGuestView(L, id(C.misafir1), K.kerem)
  t.is(hataOf(() => kabul(null, yenidenImzala(gv, K.irem, (v) => { v.signerId = K.irem.memberId }))), 'NOT_SIGNER', 'İrem görünümde yok')
  t.is(hataOf(() => kabul(null, yenidenImzala(gv, K.kerem, (v) => { v.peers.find((p) => b4a.equals(p.id, K.kerem.memberId)).role = 'yetiskin' }))), 'NOT_SIGNER', 'imzacının rolü yetişkin')
  // Aynı imzacı ama görünümdeki açık anahtar öncekinden farklı: önceki görünümdeki anahtar esastır
  const v1 = kabul(null, gv)
  L.apply(yer(L))
  const gv2 = GV.buildGuestView(L, id(C.misafir1), K.kerem)
  t.is(hataOf(() => kabul(v1, yenidenImzala(gv2, K.husniye, (v) => { v.peers.find((p) => b4a.equals(p.id, K.kerem.memberId)).signPub = K.husniye.signKeyPair.publicKey }))), 'NOT_SIGNER')
  t.is(kabul(v1, gv2).ledgerLen, 18, 'gerçek görünüm kabul')
})

test('D64 acceptGuestView: GRANT bozuk, töreni yok, sertifikası geçersiz ya da misafir imzalamamışsa INVALID_VIEW', (t) => {
  const L = anaDefter(16)
  const L2 = anaDefter(16)
  L.apply(misafirEkle(L, C.misafir1, [K.kerem]))
  const gv = GV.buildGuestView(L, id(C.misafir1), K.kerem)
  const grantIle = (e) => yenidenImzala(gv, K.kerem, (v) => { v.grant = encodeEvent(e) })
  t.is(hataOf(() => kabul(null, yenidenImzala(gv, K.kerem, (v) => { v.grant = b4a.from([1, 2, 3]) }))), 'INVALID_VIEW', 'çözülemeyen GRANT')
  t.is(hataOf(() => kabul(null, grantIle(misafirEkle(L2, C.misafir1, [K.kerem], { ceremonyTranscriptHash: b4a.alloc(32) })))), 'INVALID_VIEW', 'tören özeti sıfır')
  const kotuSertifika = { ...C.misafir1.deviceCert, dbaSig: b4a.alloc(8, 1) }
  t.is(hataOf(() => kabul(null, grantIle(misafirEkle(L2, C.misafir1, [K.kerem], { to: kotuSertifika })))), 'INVALID_VIEW', 'sertifika geçersiz')
  const imzasiz = olay(L2, T.GRANT, { ...require('../ledger/encoding').decodeBody(T.GRANT, L.events[16].body) }, [K.kerem])
  t.is(hataOf(() => kabul(null, grantIle(imzasiz))), 'INVALID_VIEW', 'misafirin kendi imzası yok')
})

test('D64 acceptGuestView: ilk görünümde GRANT\'ı veren imzacı değilse ya da imzalamamışsa NOT_SIGNER', (t) => {
  const L = anaDefter(16)
  const L2 = anaDefter(16)
  L.apply(misafirEkle(L, C.misafir1, [K.kerem]))
  const gv = GV.buildGuestView(L, id(C.misafir1), K.kerem)
  const grantIle = (e) => yenidenImzala(gv, K.kerem, (v) => { v.grant = encodeEvent(e) })
  // GRANT Hüsniye'nin; görünümü Kerem imzalıyor
  t.is(hataOf(() => kabul(null, grantIle(misafirEkle(L2, C.misafir1, [K.husniye])))), 'NOT_SIGNER')
  // grantedBy Kerem yazıyor ama Kerem imzalamamış
  t.is(hataOf(() => kabul(null, grantIle(misafirEkle(L2, C.misafir1, [K.husniye], { grantedBy: K.kerem.memberId })))), 'NOT_SIGNER')
})

// --- Misafir tarafı: önceki görünümle süreklilik -------------------------------------------------------------------

test('D64 acceptGuestView: önceki görünümden farklı aile ya da GRANT INVALID_VIEW; aynı uzunlukta başka baş VIEW_STALE', (t) => {
  const L = anaDefter(17)
  const gv = GV.buildGuestView(L, id(C.misafir1), K.kerem)
  const v1 = kabul(null, gv)
  t.is(hataOf(() => kabul(v1, yenidenImzala(gv, K.kerem, (v) => { v.familyId = b4a.alloc(32, 0x0f) }))), 'INVALID_VIEW', 'başka aile')
  const yeniGrant = misafirEkle(anaDefter(16), C.misafir1, [K.kerem], { name: 'Başka bakıcı' })
  t.is(hataOf(() => kabul(v1, yenidenImzala(gv, K.kerem, (v) => { v.grant = encodeEvent(yeniGrant) }))), 'INVALID_VIEW', 'başka GRANT')
  t.is(hataOf(() => kabul(v1, yenidenImzala(gv, K.kerem, (v) => { v.ledgerHead = b4a.alloc(32, 0x01) }))), 'VIEW_STALE', 'aynı uzunluk, başka baş')
  t.is(kabul(v1, gv).ledgerLen, 17, 'aynı görünüm yeniden kabul edilir')
})

// --- Misafir tarafı: koleksiyonlar ----------------------------------------------------------------------------------

test('D64 acceptGuestView: koleksiyon bozuk, türü yanlış, eksik ya da yetkisiz imzalı', (t) => {
  const L = anaDefter(17)
  const gv = GV.buildGuestView(L, id(C.misafir1), K.kerem)
  const kolIle = (cols) => yenidenImzala(gv, K.kerem, (v) => { v.collections = cols })
  const kol = L.events[L.collections.get(hex(V.K_BAKICI)).seq]
  t.is(hataOf(() => kabul(null, kolIle([b4a.from([9, 9, 9])]))), 'INVALID_VIEW', 'çözülemeyen olay')
  const turuYanlis = kopyaOlay(kol)
  turuYanlis.type = T.PLACE // gövde koleksiyon gövdesi olarak çözülür, tür tutmaz
  t.is(hataOf(() => kabul(null, kolIle([encodeEvent(turuYanlis)]))), 'INVALID_VIEW', 'tür COLLECTION değil')
  t.is(hataOf(() => kabul(null, kolIle([]))), 'INVALID_VIEW', 'misafirin koleksiyonu eksik')
  const L2 = anaDefter(11)
  const iremin = koleksiyon(L2, [K.irem], { collectionId: V.K_BAKICI, name: 'Bakıcı', kind: 'bakici', readers: ['rol:ebeveyn'], writers: ['rol:ebeveyn'], taskAccess: false, history: false })
  t.is(hataOf(() => kabul(null, kolIle([encodeEvent(iremin)]))), 'INVALID_SIGNATURE', 'imzacı ebeveyn değil')
  const sahte = kopyaOlay(kol)
  sahte.sigs[0].sig = b4a.alloc(64, 3)
  t.is(hataOf(() => kabul(null, kolIle([encodeEvent(sahte)]))), 'INVALID_SIGNATURE', 'imza tutmuyor')
})

// --- Misafir tarafı: halef kanıtı (RFC-0020 d) ----------------------------------------------------------------------

// Kerem'in v1'i; ardından eski imzalı ROTATE_DEVICE ile yeniKerem'in gerçek görünümü
function halefKurulumu () {
  const L = anaDefter(17)
  const v1 = kabul(null, GV.buildGuestView(L, id(C.misafir1), K.kerem))
  const R = anaDefter(17)
  const rot = rotate(L, K.kerem, K.yeniKerem, [K.yeniKerem, K.kerem, K.husniye])
  L.apply(rot)
  const gv2 = GV.buildGuestView(L, id(C.misafir1), K.yeniKerem)
  const adim = { event: encodeEvent(rot), newPub: K.yeniKerem.deviceCert.ukaPub }
  return { L, R, v1, gv2, rot, adim }
}

test('D64 halef: kanıt yok, 4 adımdan uzun ya da çözülemeyen adım INVITE_EXPIRED', (t) => {
  const { v1, gv2, adim } = halefKurulumu()
  const kanitla = (proof) => yenidenImzala(gv2, K.yeniKerem, (v) => { v.successorProof = proof })
  t.is(kabul(v1, gv2).signerHex, id(K.yeniKerem), 'gerçek zincir kabul')
  t.is(hataOf(() => kabul(v1, kanitla([]))), 'INVITE_EXPIRED', 'kanıt yok')
  t.is(hataOf(() => kabul(v1, kanitla([adim, adim, adim, adim, adim]))), 'INVITE_EXPIRED', '5 adım')
  t.is(hataOf(() => kabul(v1, kanitla([{ event: b4a.from([7, 7]), newPub: adim.newPub }, adim]))), 'INVITE_EXPIRED', 'çözülemeyen adım')
})

test('D64 halef: önceki imzacıyla başlamayan adımlar atlanır; hiçbiri başlamıyorsa INVITE_EXPIRED', (t) => {
  const { R, v1, gv2, rot, adim } = halefKurulumu()
  const kanitla = (proof) => yenidenImzala(gv2, K.yeniKerem, (v) => { v.successorProof = proof })
  const ilgisiz = { event: encodeEvent(yer(R)), newPub: adim.newPub }
  const bozukDegisim = { event: govdesiBozuk(rot), newPub: adim.newPub }
  t.is(kabul(v1, kanitla([ilgisiz, bozukDegisim, adim])).signerHex, id(K.yeniKerem), 'baştaki ilgisiz ve bozuk adımlar atlandı')
  const husniyeninki = { event: encodeEvent(rotate(R, K.husniye, K.u9, [K.u9, K.husniye, K.kerem])), newPub: K.u9.deviceCert.ukaPub }
  t.is(hataOf(() => kabul(v1, kanitla([ilgisiz, husniyeninki]))), 'INVITE_EXPIRED', 'zincir Kerem\'den başlamıyor')
})

test('D64 halef: ROTATE_DEVICE adımında eski kimlik, sertifika ya da yeni anahtar tutmazsa INVITE_EXPIRED', (t) => {
  const { L, R, v1, gv2, adim } = halefKurulumu()
  const kanitla = (proof) => yenidenImzala(gv2, K.yeniKerem, (v) => { v.successorProof = proof })
  t.is(hataOf(() => kabul(v1, kanitla([{ event: adim.event, newPub: K.u9.deviceCert.ukaPub }]))), 'INVITE_EXPIRED', 'newPub sertifikayla tutmuyor')
  // İkinci adım yeniKerem'den değil yine Kerem'den başlıyor
  const ikinci = rotate(R, K.kerem, K.u8, [K.u8, K.kerem, K.husniye])
  t.is(hataOf(() => kabul(v1, kanitla([adim, { event: encodeEvent(ikinci), newPub: K.u8.deviceCert.ukaPub }]))), 'INVITE_EXPIRED', 'kopuk zincir')
  // Sertifikası geçersiz (dolu dbaSig) değişim
  const kotu = olay(R, T.ROTATE_DEVICE, { oldMemberId: K.kerem.memberId, newDeviceCert: { ...K.yeniKerem.deviceCert, dbaSig: b4a.alloc(8, 1) }, ceremonyTranscriptHash: b4a.alloc(32, 7) }, [K.yeniKerem, K.kerem])
  t.is(hataOf(() => kabul(v1, kanitla([{ event: encodeEvent(kotu), newPub: adim.newPub }]))), 'INVITE_EXPIRED', 'sertifika geçersiz')
  // Zincirin ortasında değişim olmayan olay
  t.is(hataOf(() => kabul(v1, kanitla([adim, { event: encodeEvent(yer(L)), newPub: adim.newPub }]))), 'INVITE_EXPIRED', 'değişim olmayan adım')
})

test('D64 halef: zincir görünümün imzacısında bitmiyorsa INVITE_EXPIRED', (t) => {
  const { v1, gv2 } = halefKurulumu()
  // u8 kendini ebeveyn yazıp yeniKerem'in zincirini kanıt diye gösteriyor
  const sahte = yenidenImzala(gv2, K.u8, (v) => {
    const p = v.peers.find((x) => b4a.equals(x.id, K.yeniKerem.memberId))
    v.peers.push({ ...p, id: K.u8.memberId, signPub: K.u8.signKeyPair.publicKey })
    v.signerId = K.u8.memberId
  })
  t.is(hataOf(() => kabul(v1, sahte)), 'INVITE_EXPIRED')
})

test('D64 halef: APP_PRIMARY adımında anahtar tutmazsa ya da eski ana kimlik imzalamamışsa INVITE_EXPIRED', (t) => {
  const M = cokluDefter()
  M.apply(misafirEkle(M, C.misafir2, [K.kerem]))
  const w1 = kabul(null, GV.buildGuestView(M, id(C.misafir2), K.kerem), C.misafir2)
  const M0 = cokluDefter()
  M0.apply(misafirEkle(M0, C.misafir2, [K.kerem]))
  const zayif = primary(M0, K.kerem, E.keremDefter, [E.keremDefter], { oldSigned: false })
  M.apply(primary(M, K.kerem, E.keremDefter, [E.keremDefter, K.kerem]))
  const gv2 = GV.buildGuestView(M, id(C.misafir2), E.keremDefter)
  const kanitla = (proof) => yenidenImzala(gv2, E.keremDefter, (v) => { v.successorProof = proof })
  const [adim] = c.decode(GV.unsignedView, gv2.subarray(0, -64)).successorProof
  t.is(kabul(w1, gv2, C.misafir2).signerHex, id(E.keremDefter), 'gerçek devir kabul')
  t.is(hataOf(() => kabul(w1, kanitla([{ event: adim.event, newPub: K.u9.deviceCert.ukaPub }]), C.misafir2)), 'INVITE_EXPIRED', 'newPub yeni ana kimliğin değil')
  t.is(hataOf(() => kabul(w1, kanitla([{ event: encodeEvent(zayif), newPub: adim.newPub }]), C.misafir2)), 'INVITE_EXPIRED', 'eski ana kimliğin imzası yok')
  // İkinci adım kopuk: against yine Kerem
  t.is(hataOf(() => kabul(w1, kanitla([adim, adim]), C.misafir2)), 'INVITE_EXPIRED', 'kopuk zincir')
})

// --- GUEST_REVOKED ----------------------------------------------------------------------------------------------------

test('D64 verifyGuestRevoked: bozuk ileti, başka misafir ya da çözülemeyen olay INVALID_VIEW', (t) => {
  const L = anaDefter(17)
  const view = kabul(null, GV.buildGuestView(L, id(C.misafir1), K.kerem))
  const rev = misafirKaldir(L, C.misafir1, [K.husniye])
  const ileti = GV.encodeGuestRevoked(L.familyId, C.misafir1.memberId, rev, K.husniye)
  t.is(hataOf(() => GV.verifyGuestRevoked(view, b4a.alloc(20, 1))), 'INVALID_VIEW', 'çözülemeyen ileti')
  t.is(hataOf(() => GV.verifyGuestRevoked(view, b4a.concat([ileti, b4a.from([0])]))), 'INVALID_VIEW', 'sonda bayt')
  t.is(hataOf(() => GV.verifyGuestRevoked(view, GV.encodeGuestRevoked(L.familyId, C.misafir2.memberId, rev, K.husniye))), 'INVALID_VIEW', 'başka misafirin kimliği')
  const bozuk = decodeEvent(govdesiBozuk(rev))
  t.is(hataOf(() => GV.verifyGuestRevoked(view, GV.encodeGuestRevoked(L.familyId, C.misafir1.memberId, bozuk, K.husniye))), 'INVALID_VIEW', 'gövde çözülemiyor')
  const baskasi = misafirKaldir(L, C.misafir2, [K.husniye])
  t.is(hataOf(() => GV.verifyGuestRevoked(view, GV.encodeGuestRevoked(L.familyId, C.misafir1.memberId, baskasi, K.husniye))), 'INVALID_SIGNATURE', 'REVOKE başka misafirin')
})

test('D64 verifyGuestRevoked: ebeveynlik düşüşü yetkili imzası ister; ilgisiz olay INVALID_VIEW', (t) => {
  const L = anaDefter(17)
  const view = kabul(null, GV.buildGuestView(L, id(C.misafir1), K.kerem))
  const dogrula = (e) => GV.verifyGuestRevoked(view, GV.encodeGuestRevoked(L.familyId, C.misafir1.memberId, e, K.husniye))
  const rol = (kim, role, imz) => olay(L, T.SET_ROLE, { memberId: kim.memberId, role }, imz)
  t.is(hataOf(() => dogrula(rol(K.kerem, 'yetiskin', [K.irem]))), 'INVALID_SIGNATURE', 'yalnız İrem imzalı')
  t.is(hataOf(() => dogrula(rol(K.kerem, 'ebeveyn', [K.kerem, K.husniye]))), 'INVALID_VIEW', 'yetki düşmüyor')
  t.is(hataOf(() => dogrula(rol(K.husniye, 'yetiskin', [K.kerem, K.husniye]))), 'INVALID_VIEW', 'misafirliği veren değil')
  t.is(hataOf(() => dogrula(yer(L))), 'INVALID_VIEW', 'ilgisiz olay türü')
})

test('D64 verifyGuestRevoked: ayrılmayı yalnız ebeveynin kendisi, çıkarmayı bir yetkili imzalar', (t) => {
  const L = anaDefter(17)
  const view = kabul(null, GV.buildGuestView(L, id(C.misafir1), K.kerem))
  const dogrula = (e) => GV.verifyGuestRevoked(view, GV.encodeGuestRevoked(L.familyId, C.misafir1.memberId, e, K.husniye))
  t.is(hataOf(() => dogrula(olay(L, T.LEAVE, { memberId: K.kerem.memberId }, [K.husniye]))), 'INVALID_SIGNATURE', 'Kerem\'in ayrılmasını Hüsniye imzalamış')
  t.is(hataOf(() => dogrula(olay(L, T.LEAVE, { memberId: K.husniye.memberId }, [K.husniye]))), 'INVALID_VIEW', 'ayrılan misafirliği veren değil')
  const cikar = (imz) => olay(L, T.REMOVE_MEMBER, { memberId: K.kerem.memberId, reason: 'aile kararı', wipe: false }, imz)
  t.is(hataOf(() => dogrula(cikar([K.irem]))), 'INVALID_SIGNATURE', 'çıkarmayı yetişkin imzalamış')
  const r = dogrula(cikar([K.husniye]))
  t.is(r.neden, 'ebeveyn-ayrildi')
  t.is(r.reason, 'aile kararı', 'çıkarmanın gerekçesi taşınır')
  t.alike(r.grantId, C.misafir1.memberId)
})
