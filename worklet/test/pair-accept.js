// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D105: RFC-0017 §6.2 adım 6 — aynı telefonda ikinci uygulama: Hat (ana kimlik, ailesi var) ve Acil (ailesiz). Acil 360,
// Hat 361, Acil 365 ESLES_KABUL → Acil aile üyesi (ek kimlik); Hat 366 YEREL_ESITLE → Acil, Hat'ın kaydını ağ olmadan
// okur. Eski ya da yanlış nonce INVALID_TRANSCRIPT; ailesi olan uygulamada FAMILY_EXISTS. Vektör
// protocol/vectors/pair-accept.json (elle yazıldı).
'use strict'
const test = require('brittle')
const { yerelKanal: Y } = require('@havenfold/core')
const { eslesKabul, yerelEsitle, yerelPaketAl } = require('../local-pairing')
const { geciciDizin, kaliciAc } = require('./helpers/common')
const V = require('../../protocol/vectors/pair-accept.json')

const hataOf = (f) => { try { f(); return null } catch (err) { return err.message } }
const durum = (no) => V.durumlar.find((d) => d.no === no)

function telefon (t) {
  const saat = { t: 1_800_000_000_000 }
  const now = () => saat.t
  const hat = kaliciAc({ dizin: geciciDizin(t, 'hat'), now, appId: 'yuva-hat' })
  hat.aileKur({ aileAdi: 'Rivera', benimAdim: 'Alex' })
  const acil = kaliciAc({ dizin: geciciDizin(t, 'acil'), now, appId: 'yuva-acil' })
  return { hat, acil, saat }
}
const tumAile = (k) => k.nesneler.kayit.collections().find((c) => c.name === 'Tüm Aile').collectionId

test('vektör a: 360 → 361 → 365 → Acil aile üyesi; 366 sonrası Acil, Hat\'ın kaydını ağ olmadan okur; 362 iki kimlik', (t) => {
  const { hat, acil, saat } = telefon(t)
  const TA = tumAile(hat)
  const rid = hat.nesneler.kayit.put(TA, null, 'yuva.defter.not', { baslik: 'Wifi şifresi' })
  const istek = acil.nesneler.defter.pairRequest('yuva-acil') // 360
  saat.t += 30_000
  const ok = hat.nesneler.defter.pairApprove(istek, { approved: true }) // 361 (biyometri onayı)
  saat.t += 30_000
  const r = eslesKabul(acil, ok) // 365
  t.is(r.familyId, V.beklenen.ayniAile ? hat.nesneler.ledger.familyId.toString('hex') : null, 'aynı aile')
  t.is(r.kisiId, hat.nesneler.ledger.personIdOf(hat.kimlik.memberId.toString('hex')), 'Hat\'ın kişisi')
  t.ok(acil.nesneler.aile, 'Acil aileye bağlandı')
  const benAcil = acil.kimlik.memberId.toString('hex')
  t.ok(acil.nesneler.ledger.members.get(benAcil).extra, 'ek kimlik (APP_ATTACH)')
  t.absent(hat.nesneler.ledger.members.has(benAcil), 'Hat henüz bilmiyor: olay yerel kanaldan gelecek')
  const p = yerelEsitle(hat, { olay: r.olay }) // 366
  t.ok(hat.nesneler.ledger.members.has(benAcil), 'Hat olayı deftere aldı (aileye eşitlemeyle yayılır)')
  t.is(hat.nesneler.defter.identities().length, V.beklenen.kimlikSayisi, '362: kişinin iki kimliği')
  t.alike(hat.nesneler.defter.identities().map((x) => x.appId).sort(), V.beklenen.uygulamalar)
  t.ok(p.paketler.length >= 2, 'defter, anahtar ve işlemler')
  const a = yerelPaketAl(acil, { kimlik: hat.kimlik.memberId, paketler: p.paketler })
  t.is(a.islenen, p.paketler.length)
  t.is(acil.nesneler.kayit.get(TA, rid).fields.baslik, 'Wifi şifresi', durum('c').aciklama)
  t.is(acil.nesneler.ledger.len, hat.nesneler.ledger.len)
  // Paket yalnız bu iki kimliğin çift sırrıyla açılır: bozulan mühür reddedilir
  const bozuk = { ...p.paketler[0], kutu: p.paketler[0].kutu.slice(0, -2) + (p.paketler[0].kutu.endsWith('00') ? '01' : '00') }
  t.ok(hataOf(() => yerelPaketAl(acil, { kimlik: hat.kimlik.memberId, paketler: [bozuk] })), 'bozuk mühür')
})

test('vektör b: eski ya da yanlış nonce INVALID_TRANSCRIPT; ailesi olan uygulamada FAMILY_EXISTS; ağdan APP_PAIR_OK yok', (t) => {
  const { hat, acil, saat } = telefon(t)
  const istek = acil.nesneler.defter.pairRequest('yuva-acil')
  const ok = hat.nesneler.defter.pairApprove(istek, { approved: true })
  saat.t += 5 * 60_000 + 1
  t.is(hataOf(() => eslesKabul(acil, ok)), durum('b').hata, '5 dakikadan eski')
  t.absent(acil.nesneler.aile)
  // Başka bir isteğin cevabı (nonce uyuşmaz)
  const ikinci = acil.nesneler.defter.pairRequest('yuva-acil')
  const baska = kaliciAc({ dizin: geciciDizin(t, 'b'), now: () => saat.t, appId: 'yuva-acil' })
  const ok2 = hat.nesneler.defter.pairApprove(baska.nesneler.defter.pairRequest('yuva-acil'), { approved: true })
  t.is(hataOf(() => eslesKabul(acil, ok2)), durum('b').hata, 'yanlış nonce')
  t.ok(ikinci)
  t.is(hataOf(() => eslesKabul(hat, ok)), 'FAMILY_EXISTS')
  t.absent(Y.acceptOn(Y.Z.APP_PAIR_OK, 'ag'), 'APP_PAIR_OK ağdan atılır')
  t.absent(Y.acceptOn(Y.Z.APP_PAIR_REQ, 'ag'))
  t.is(hataOf(() => yerelEsitle(hat, { kimlik: 'ab'.repeat(16) })), 'OUT_OF_GROUP', 'aynı cihaz grubunda olmayan kimliğe paket yok')
})
