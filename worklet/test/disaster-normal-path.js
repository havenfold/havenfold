// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D104: afet mesajının normal yolu (RFC-0031 §8.4) ve ürün saklaması (§8.3). İki telefonun eşitleyicisi bellek içi ağla;
// DisasterApi.setupNormalPath worklet'in ürün zarfı kancalarına (urunZarfi, zarfGonder) bağlanır. Saklama Kalici.afetSaklama.
// Vektör protocol/vectors/disaster-normal-path.json (elle yazıldı).
'use strict'
const test = require('brittle')
const S = require('@havenfold/sdk')
const { Esitleyici } = require('../synchronizer')
const A = require('../../core/records/test/helpers/family')
const { geciciDizin, kaliciAc } = require('./helpers/common')
const V = require('../../protocol/vectors/disaster-normal-path.json')

const id = (k) => A.hex(k.memberId)
const durum = (no) => V.durumlar.find((d) => d.no === no)

function aile (t) {
  const saat = { t: A.TS0 + 3_600_000 }
  const now = () => saat.t
  const L = A.anaDefter()
  const tel = {}
  const kuyruk = []
  const acik = new Set()
  for (const [ad, kim] of [['kerem', A.K.kerem], ['hus', A.K.husniye]]) {
    const dizin = geciciDizin(t, ad)
    const k = kaliciAc({ dizin, now, kimlik: kim })
    k.aileBagla(A.kopya(L))
    t.teardown(() => k.kapat())
    const x = { k, kim, dizin }
    x.e = new Esitleyici({ kalici: k, ag: { gonder: (p, type, bytes) => { kuyruk.push({ from: id(kim), to: p, type, bytes }) } } })
    x.afet = new S.DisasterApi({ me: kim, defter: () => k.nesneler.ledger, saklama: k.afetSaklama(), saat: now })
    x.yol = x.afet.setupNormalPath({ urunZarfi: (type, fn, teslim) => x.e.urunZarfi(type, fn, teslim), zarfGonder: (p, type, bytes, mid) => x.e.zarfGonder(p, type, bytes, mid) })
    tel[ad] = x
  }
  const ofId = (h) => Object.values(tel).find((x) => id(x.kim) === h)
  const pompa = () => {
    for (let i = 0; i < 500 && kuyruk.length; i++) {
      const m = kuyruk.shift()
      if (acik.has(m.from + m.to)) ofId(m.to).e.al(m.from, m.type, m.bytes, 'dogrudan')
    }
  }
  const bagla = () => { acik.add(id(A.K.kerem) + id(A.K.husniye)); acik.add(id(A.K.husniye) + id(A.K.kerem)); tel.kerem.e.baglandi(id(A.K.husniye)); tel.hus.e.baglandi(id(A.K.kerem)); pompa() }
  return { tel, pompa, bagla, kuyruk, saat, now }
}

const gelenler = (x) => x.afet.messages().filter((m) => m.yon === 'gelen')

test('vektör a: çevrimdışı iki afet mesajı ağ gelince normal yoldan bir kez teslim; aynı mid ikinci kez işlenmez', (t) => {
  const { tel, pompa, bagla, kuyruk, saat } = aile(t)
  const { kerem, hus } = tel
  kerem.afet.send('metin', [id(A.K.husniye)], 'Toplanma alanındayız')
  saat.t += 10 * 60_000
  kerem.afet.send('iyiyim', [id(A.K.husniye)])
  t.is(kerem.yol.gonder(), 2, 'iki mesaj normal yola (kalıcı kuyruk; alıcı çevrimdışı)')
  t.is(gelenler(hus).length, 0)
  bagla()
  for (let i = 0; i < 3; i++) { kerem.e.akit(); hus.e.akit(); pompa() }
  t.is(gelenler(hus).length, durum('a').gelen, durum('a').aciklama)
  t.alike(gelenler(hus).map((m) => m.tur).sort(), ['iyiyim', 'metin'])
  // Aynı zarf ikinci kez (ör. önce Bluetooth'la gelmiş gibi): bir kez işlenir
  const ilk = kerem.afet.depo.giden.values().next().value
  const { mesaj: M } = require('@havenfold/disaster')
  const r = hus.afet.takeFromNormalPath(M.kodla(M.Z.AFET_MSG, ilk.m))
  t.alike([r.gecerli, r.neden], [false, 'REPLAY'], 'tekrar (çekirdeğin tekrar engeli)')
  t.is(gelenler(hus).length, durum('a').gelen)
  t.is(kuyruk.length, 0)
})

test('vektör c: afet hâli ve teslim edilmemiş giden kuyruk yeniden açılışta korunur', (t) => {
  const { tel, now } = aile(t)
  const { kerem } = tel
  kerem.afet.enable() // elle ETKİN
  const mids = kerem.afet.send('metin', [id(A.K.husniye)], 'Pil azaldı')
  const hal = kerem.afet.state()
  t.is(hal.durum, 'etkin', 'afet modu açık')
  kerem.k.kaydet()
  const k2 = kaliciAc({ dizin: kerem.dizin, now, kimlik: A.K.kerem })
  const a2 = new S.DisasterApi({ me: A.K.kerem, defter: () => k2.nesneler.ledger, saklama: k2.afetSaklama(), saat: now })
  t.alike(a2.messages().filter((m) => m.yon === 'giden').map((m) => m.mid), mids, 'giden kuyruk korundu')
  t.is(a2.state().durum, hal.durum, 'afet hâli korundu')
})

// Codex 7. tur: normal yolun kalıcı kuyruğu (64) dolunca en eski zarf sessizce atılıyordu; SOS önce girdiği için düşüyor,
// gönderende de bekleyen sayılmıyordu. Şimdi SOS önce sıraya girer, kuyruğa giremeyen mesaj normal sayılmaz ve sonra gider
test('Codex 7. tur: kuyruk dolunca SOS düşmez; kuyruğa giremeyen afet yolunda bekler, sonra gider', (t) => {
  const { tel, pompa, bagla } = aile(t)
  const { kerem, hus } = tel
  const [sos] = kerem.afet.send('sos', [id(A.K.husniye)], 'Enkazdayım')
  const { mesaj: M } = require('@havenfold/disaster')
  for (let i = 0; i < 64; i++) kerem.afet.motor.gonder({ to: A.K.husniye.memberId, kind: M.KIND.METIN, text: 'm' + i }, { sinirsiz: true })
  t.is(kerem.yol.gonder(), 64, 'kuyruğa 64 mesaj girdi')
  t.is(kerem.afet.state().bekleyen, 1, 'giremeyen bir mesaj afet yolunda bekliyor (sessizce düşmedi)')
  t.ok(kerem.afet.depo.giden.get(sos).normal, 'SOS önce sıraya girdi')
  bagla()
  for (let i = 0; i < 3; i++) { kerem.e.akit(); hus.e.akit(); pompa() }
  t.ok(gelenler(hus).some((m) => m.mid === sos && m.tur === 'sos'), 'SOS ulaştı')
  t.is(gelenler(hus).length, 64)
  t.is(kerem.yol.gonder(), 1, 'kuyruk boşalınca kalan gider')
  for (let i = 0; i < 3; i++) { kerem.e.akit(); hus.e.akit(); pompa() }
  t.is(gelenler(hus).length, 65, 'hepsi ulaştı')
})
