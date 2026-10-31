// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
const test = require('brittle')
const b4a = require('b4a')
const sodium = require('sodium-native')
const { ledger: { Ledger, decodeEvent, encodeEvent } } = require('@havenfold/core')
const K = require('../encoding')
const Y = require('../placement')
const { YetenekDefteri } = require('../capability')
const { OnayDefteri } = require('../approval')
const { vektorler, denetimCalistir, belgeCalistir } = require('./helpers/task-vector')
const V = require('../../../protocol/vectors/task-v2.json')

const hex = (b) => b4a.toString(b, 'hex')
const buf = (h) => b4a.from(h, 'hex')

test('vektörler: task.json üretici aynı dosyayı verir (belirlenimci)', (t) => {
  t.alike(JSON.parse(JSON.stringify(vektorler())), V)
})

test('vektörler: zincir uygulanır ve familyId tutar', (t) => {
  const L = new Ledger()
  for (const h of V.zincir) {
    const e = decodeEvent(buf(h))
    t.is(hex(encodeEvent(e)), h)
    L.apply(e)
  }
  t.is(hex(L.familyId), V.familyId)
})

test('vektörler §15 madde 1: NODE_CAPS, TASK, TASK_DELEGATION, alt görev ve TASK_CANCEL imzaları', (t) => {
  const L = new Ledger()
  for (const h of V.zincir) L.apply(decodeEvent(buf(h)))
  const imzalilar = { node_caps: K.decodeNodeCaps, task: K.decodeTask, task_delegation: K.decodeDelegation, alt_gorev: K.decodeTask, task_cancel: K.decodeCancel }
  for (const [ad, coz] of Object.entries(imzalilar)) {
    const v = V.kodlama[ad]
    const bytes = buf(v.bayt)
    const { body, sig } = coz(bytes)
    t.is(hex(K.digestOf(v.etiket, L.familyId, body)), v.ozet, ad + ' özet')
    const pub = L.entity(v.imzaci).signPub
    t.ok(sodium.crypto_sign_verify_detached(sig, buf(v.ozet), pub), ad + ' imza')
    // Bir bayt değişince imza tutmaz
    const bozuk = b4a.from(body)
    bozuk[bozuk.length - 1] ^= 1
    t.absent(K.verifySig(v.etiket, L.familyId, bozuk, sig, pub), ad + ' bozuk gövde')
  }
  // Alt görevin etiketi task-sub, doğrudan görevinki task
  t.is(V.kodlama.alt_gorev.etiket, 'hf/task-sub/')
  t.is(K.taskTag(K.decodeTask(buf(V.kodlama.task.bayt)).m), 'hf/task/')
  // Alanlar baytlardan geri çıkar
  const caps = K.decodeNodeCaps(buf(V.kodlama.node_caps.bayt)).m
  t.is(caps.cpuModel, V.kodlama.node_caps.alanlar.cpuModel)
  t.is(caps.battery.tempC, V.kodlama.node_caps.alanlar.battery.tempC)
  const d = K.decodeDelegation(buf(V.kodlama.task_delegation.bayt)).m
  t.is(d.maxParts, V.kodlama.task_delegation.alanlar.maxParts)
  // İmzasız mesajlar
  t.is(K.decodeAccept(buf(V.kodlama.task_accept.bayt)).etaSec, 90)
  t.is(K.decodeReject(buf(V.kodlama.task_reject.bayt)).code, 'MESGUL')
  t.is(K.decodeProgress(buf(V.kodlama.task_progress.bayt)).pct, 62)
  t.is(b4a.toString(K.decodeResult(buf(V.kodlama.task_result.bayt)).inline), 'Kira sözleşmesi, sayfa 1')
})

test('vektörler §15 madde 2–3: işçi denetimi ve koordinatör durumları', (t) => {
  const zorunlu = {
    2: ['kabul', 'TUR_IZNI_YOK', 'KOLEKSIYON_KAPALI', 'YETKISIZ', 'SURE_GECERSIZ'],
    3: ['kabul', 'YETKISIZ']
  }
  for (const [no, kodlar] of Object.entries(zorunlu)) {
    for (const k of kodlar) t.ok(V.denetimler.some((d) => d.no === Number(no) && d.beklenen === k), 'madde ' + no + ': ' + k)
  }
  for (const d of V.denetimler) t.is(denetimCalistir(V, d), d.beklenen, d.aciklama)
  for (const b of V.belgeler) t.is(belgeCalistir(V, b), b.beklenen, b.aciklama)
})

test('vektörler §15 madde 4: aynı bildirimlerden aynı seçim', (t) => {
  const L = new Ledger()
  for (const h of V.zincir) L.apply(decodeEvent(buf(h)))
  const y = V.yerlestirme
  // Bildirimler farklı sırayla gelse de seçim aynı
  for (const sira of [y.yetenekler, [...y.yetenekler].reverse()]) {
    let saat = 0
    const defter = new YetenekDefteri({ ledger: L, now: () => saat })
    for (const b of sira) { saat = b.alindi; defter.al(buf(b.bayt)) }
    const onay = new OnayDefteri(y.onaylar.map((c) => ({ uye: y.uye, cihaz: c, izin: true, at: 0 })))
    for (const i of y.istekler) {
      const sirali = Y.adaylar(defter, { ...i.istek, uye: y.uye, onay, now: y.simdi })
      t.alike(sirali.map((a) => a.id), i.adaylar)
      t.alike(Y.planla(sirali, i.istek).map((p) => ({ isci: p.isci, from: p.from, to: p.to })), i.parcalar)
    }
  }
})

test('vektörler §15 madde 5: bölme', (t) => {
  const b = Object.fromEntries(V.bolme.map((x) => [x.birim + ':' + x.cekirdekler.join('+'), x.paylar]))
  t.alike(b['40:4+2'], [27, 13])
  t.alike(b['7:3+3+2'], [3, 2, 2])
  for (const x of V.bolme) t.alike(Y.bol(x.birim, x.cekirdekler), x.paylar)
})
