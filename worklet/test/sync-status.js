// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D100: eşitleme durumu (sdk/sync.js) — iki telefonun eşitleyicisi bellek içi ağla: bekleyen yazım (anahtar
// kuyruğu ve teyitsiz işlem), REC_VV teyidi ve son eşitleme anı, çevrimiçi üyeler, taşıyıcı, olay, kalıcılık.
// Ağa yeni mesaj eklenmez (giden türler bugünküler).
'use strict'
const test = require('brittle')
const { zarf: { Z } } = require('@havenfold/core')
const { esitleme: E } = require('@havenfold/records')
const S = require('@havenfold/sdk')
const { Esitleyici } = require('../synchronizer')
const A = require('../../core/records/test/helpers/family')
const { geciciDizin, kaliciAc } = require('./helpers/common')

const id = (k) => A.hex(k.memberId)
const TA = A.hex(A.K_TUM_AILE)

// İki telefon; ag.gonder kuyruğa yazar, pompa sırayla teslim eder (oturum açık değilse düşer)
function aile (t) {
  let saat = A.TS0 + 3_600_000
  const now = () => saat
  const L = A.anaDefter()
  const tel = {}
  const kuyruk = []
  const acik = new Set()
  for (const [ad, kim] of [['kerem', A.K.kerem], ['hus', A.K.husniye]]) {
    const dizin = geciciDizin(t, ad)
    const k = kaliciAc({ dizin, now, kimlik: kim })
    k.aileBagla(A.kopya(L))
    t.teardown(() => k.kapat())
    const olaylar = []
    const x = { k, kim, dizin, olaylar, tasAcik: true }
    x.e = new Esitleyici({ kalici: k, ag: { gonder: (p, type, bytes) => { kuyruk.push({ from: id(kim), to: p, type, bytes }) } }, tasiyiciAcik: () => x.tasAcik, olay: (ad2, veri) => olaylar.push([ad2, veri]) })
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
  const kopar = () => { acik.clear(); tel.kerem.e.koptu(id(A.K.husniye)); tel.hus.e.koptu(id(A.K.kerem)) }
  return { tel, pompa, bagla, kopar, kuyruk, ileri: (ms) => { saat += ms }, now }
}

const durum = (x) => x.k.nesneler.esitleme.status()

test('bekleyen yazım: çevrimdışıyken kuyrukta; bağlanınca anahtar, işlem ve REC_VV teyidi; son eşitleme anı', (t) => {
  const { tel, bagla, kopar, pompa, ileri, now } = aile(t)
  const { kerem, hus } = tel
  kerem.e.akit()
  t.alike(durum(kerem), { tasiyici: true, cevrimici: [], bekleyenYazim: 0, sonEsitleme: null }, 'başlangıç')
  kerem.k.nesneler.kayit.put(TA, null, 'yuva.defter.not', { baslik: 'çevrimdışı' })
  kerem.e.akit()
  t.is(durum(kerem).bekleyenYazim, 1, 'yazım bekliyor (Tüm Aile anahtarı Hüsniye\'de üretilir: kuyrukta)')
  t.is(kerem.olaylar.at(-1)[0], 'sync-status')
  t.is(kerem.olaylar.at(-1)[1].bekleyenYazim, 1, 'olay uygulamaya')
  ileri(1000)
  bagla()
  for (let i = 0; i < 4; i++) { kerem.e.akit(); hus.e.akit(); pompa() }
  t.alike(durum(kerem).cevrimici, [id(A.K.husniye)], 'Hüsniye çevrimiçi')
  t.is(hus.k.nesneler.kayit.query(TA).filter((r) => r.fields.baslik === 'çevrimdışı').length, 1, 'kayıt Hüsniye\'de')
  t.is(durum(kerem).bekleyenYazim, 0, 'REC_VV teyidiyle bekleyen kalmadı')
  t.is(durum(kerem).sonEsitleme, now())
  // Çevrimiçiyken yazım: gider, Hüsniye'nin özetiyle teyit edilir
  ileri(1000)
  kerem.k.nesneler.kayit.put(TA, null, 'yuva.defter.not', { baslik: 'çevrimiçi' })
  kerem.e.akit()
  t.is(durum(kerem).bekleyenYazim, 1, 'gönderildi, teyit bekliyor')
  for (let i = 0; i < 3; i++) { pompa(); kerem.e.akit(); hus.e.akit() }
  t.is(durum(kerem).bekleyenYazim, 0)
  t.is(durum(kerem).sonEsitleme, now(), 'son eşitleme ilerledi')
  // Kopunca: çevrimiçi boş; çevrimdışı yazım bekler, son eşitleme değişmez
  kopar()
  const son = durum(kerem).sonEsitleme
  ileri(1000)
  kerem.k.nesneler.kayit.put(TA, null, 'yuva.defter.not', { baslik: 'yine çevrimdışı' })
  kerem.e.akit()
  t.alike(durum(kerem), { tasiyici: true, cevrimici: [], bekleyenYazim: 1, sonEsitleme: son })
  // Kalıcı: kapat–aç sonrası bekleyen ve son eşitleme aynı
  kerem.k.kaydet()
  const k2 = kaliciAc({ dizin: kerem.dizin, now, kimlik: A.K.kerem })
  t.alike(k2.nesneler.esitleme.status(), { tasiyici: false, cevrimici: [], bekleyenYazim: 1, sonEsitleme: son }, 'yeniden açılışta (taşıyıcıyı start bildirir)')
})

test('okuyucusu yalnız ben olan koleksiyon beklemez; taşıyıcı durumu; aynı durum ikinci kez yayılmaz', (t) => {
  const { tel } = aile(t)
  const { kerem } = tel
  const irem = kaliciAc({ dizin: geciciDizin(t, 'irem'), now: () => A.TS0 + 3_600_000, kimlik: A.K.irem })
  irem.aileBagla(A.kopya(A.anaDefter()))
  t.teardown(() => irem.kapat())
  const olaylar = []
  const e = new Esitleyici({ kalici: irem, ag: { gonder: () => {} }, olay: (ad, v) => olaylar.push(v) })
  irem.nesneler.kayit.put(A.hex(A.K_KISISEL_IREM), null, 'yuva.defter.not', { baslik: 'kişisel' })
  e.akit()
  t.is(irem.nesneler.replika.writeQueue.length, 0, 'İrem kendi kişisel koleksiyonunun anahtarını üretti')
  t.is(irem.nesneler.esitleme.status().bekleyenYazim, 0, 'kişisel koleksiyondaki yazım beklemez')
  const n = olaylar.length
  e.akit()
  t.is(olaylar.length, n, 'değişmeyen durum yeniden yayılmaz')
  kerem.tasAcik = false
  kerem.e.esitlemeGuncelle()
  t.is(durum(kerem).tasiyici, false, 'taşıyıcı askıda')
  t.is(kerem.olaylar.at(-1)[1].tasiyici, false)
})

test('SDK SyncStatus: teyit, kalıcı biçim ve temizlik', (t) => {
  let saat = 10
  const d = new S.SyncStatus({ now: () => saat })
  const ol = []
  d.on('sync-status', (x) => ol.push(x))
  d.written('aa'); d.written('bb')
  t.is(d.status().bekleyenYazim, 2)
  saat = 20
  d.confirmed(['aa'])
  t.is(d.status().sonEsitleme, null, 'bekleyen kaldıkça son eşitleme yok')
  d.confirmed(['bb'])
  t.is(d.status().sonEsitleme, 20)
  t.alike(d.toJSON(), { bekleyen: [], son: 20 })
  const d2 = new S.SyncStatus({ durum: { bekleyen: ['cc', 'dd', 7], son: 5 } })
  t.alike(d2.toJSON(), { bekleyen: ['cc', 'dd'], son: 5 }, 'geçersiz öğe atılır')
  d2.clear((x) => x === 'cc')
  t.is(d2.status().bekleyenYazim, 1, 'geçerli kümede olmayan sayılmaz')
  t.ok(ol.length >= 3)
  t.ok(typeof E.teyitler === 'function' && Z.REC_VV > 0)
  // Codex 6. tur: anahtar bekleyen yazım (kuyruk) varken boş teyit son eşitlemeyi ilerletmez
  const kuyruk = { writeQueue: [{}] }
  const d3 = new S.SyncStatus({ replika: kuyruk, now: () => saat, durum: { bekleyen: [], son: 5 } })
  saat = 30
  d3.confirmed([])
  t.alike([d3.status().bekleyenYazim, d3.status().sonEsitleme], [1, 5], 'kuyrukta yazım: son eşitleme ilerlemez')
  kuyruk.writeQueue.length = 0
  d3.confirmed([])
  t.is(d3.status().sonEsitleme, 30, 'kuyruk boşalınca ilerler')
})
