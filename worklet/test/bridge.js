// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D46: kişisel köprü (RFC-0005 §15, vektör 18) iki uygulama arasında, aynı makinede iki ayrı süreç (test Node'da koşuyorsa
// Node, Bare'de Bare). Ortak dizin işletim sisteminin uygulama grubu yolunun yerine geçer; ağ yok.
'use strict'
/* global Bare */
const test = require('brittle')
const { spawn } = typeof Bare !== 'undefined' ? require('bare-subprocess') : require('child_process')
const { geciciDizin } = require('./helpers/common')

const YURUTUCU = typeof Bare !== 'undefined' ? Bare.argv[0] : process.execPath
const BETIK = __dirname + '/helpers/bridge-app.js'

function uygulama (t, kendi, ortak, dizin) {
  const p = spawn(YURUTUCU, [BETIK, kendi, ortak, dizin], { stdio: ['pipe', 'pipe', 'inherit'] })
  const bekleyen = new Map()
  let no = 0
  let tampon = ''
  let hazir
  const hazirP = new Promise((resolve) => { hazir = resolve })
  const bitti = new Promise((resolve) => p.on('exit', resolve))
  p.stdout.on('data', (parca) => {
    tampon += parca.toString()
    let i
    while ((i = tampon.indexOf('\n')) >= 0) {
      const c = JSON.parse(tampon.slice(0, i))
      tampon = tampon.slice(i + 1)
      if (c.hazir) { hazir(); continue }
      const b = bekleyen.get(c.no)
      bekleyen.delete(c.no)
      if (b) b(c)
    }
  })
  const iste = async (islem, govde = {}) => {
    await hazirP
    const n = ++no
    const r = await new Promise((resolve) => { bekleyen.set(n, resolve); p.stdin.write(JSON.stringify({ no: n, islem, ...govde }) + '\n') })
    if (r.hata) { const e = new Error(r.hata); throw e }
    return r.sonuc
  }
  const kapat = async () => { await iste('bitir'); await bitti }
  t.teardown(() => { try { p.kill() } catch {} })
  return { iste, kapat }
}

const hataOf = async (fn) => { try { await fn(); return null } catch (err) { return err.message } }

test('iki uygulama aynı telefonda: Mekan Hat → Yuva Hat ve geri; iki onay, tekrar ve süreç yeniden açılınca da reddedilir', { timeout: 60000 }, async (t) => {
  const ortak = geciciDizin(t, 'kopru-ortak')
  const mekanDizin = geciciDizin(t, 'kopru-mekan')
  const yuvaDizin = geciciDizin(t, 'kopru-yuva')
  const mekan = uygulama(t, 'ekip', ortak, mekanDizin)
  let yuva = uygulama(t, 'aile', ortak, yuvaDizin)

  t.is(await hataOf(() => mekan.iste('hazirla', { type: 'mekan.durum.cikis', text: 'Çıktım' })), 'BRIDGE_DISABLED', 'düğme varsayılan kapalı')
  await mekan.iste('dugmeler', { turler: ['mekan.durum.cikis'] })
  t.is(await mekan.iste('hazirla', { type: 'mekan.durum.cikis', text: 'Çıktım' }), 'kanal', 'birinci onay: düğme')
  const g = await yuva.iste('gelenler')
  t.is(g.length, 1)
  t.alike({ from: g[0].onizleme.from, type: g[0].onizleme.type, text: g[0].onizleme.text, etiket: g[0].onizleme.etiket, uygulama: g[0].onizleme.uygulama }, { from: 'ekip', type: 'mekan.durum.cikis', text: 'Çıktım', etiket: 'is', uygulama: 'Mekan Hat' }, 'ikinci onay: Yuva Hat önizler; ad platformdan')
  t.alike(await yuva.iste('gelenler'), [], 'paket bir kez teslim edilir')
  // Aynı paket yeniden sokulursa (başka bir uygulama ya da kopya) reddedilir; Yuva Hat yeniden açılınca da
  t.is(await hataOf(() => yuva.iste('al', { metin: g[0].metin })), 'BRIDGE_REPLAY')
  await yuva.kapat()
  yuva = uygulama(t, 'aile', ortak, yuvaDizin)
  t.is(await hataOf(() => yuva.iste('al', { metin: g[0].metin })), 'BRIDGE_REPLAY', 'nonce kalıcı (7 gün)')
  // Ters yön: Yuva Hat → Mekan Hat
  await yuva.iste('dugmeler', { turler: ['yuva.durum.gec'] })
  await yuva.iste('hazirla', { type: 'yuva.durum.gec', text: 'Geç kalacağım' })
  const m = await mekan.iste('gelenler')
  t.alike([m[0].onizleme.type, m[0].onizleme.text, m[0].onizleme.etiket], ['yuva.durum.gec', 'Geç kalacağım', 'aile'])
  // Karşı yönden gelen ama listede olmayan tür (iş verisi Yuva'dan Mekan'a da geçmez) ve yazan uygulamayla uyuşmayan from
  const K = require('@havenfold/core').kopru
  const nonce = (x) => require('b4a').alloc(16, x)
  const ham = (m) => K.ON_EK + K.b64Yaz(require('compact-encoding').encode(K.kopru, { v: 1, ...m }))
  await mekan.iste('koy', { metin: ham({ from: 'aile', type: 'yuva.defter.not', text: 'kayıt', at: Date.now(), nonce: nonce(9) }) })
  await mekan.iste('koy', { metin: K.kopruYaz({ from: 'ekip', type: 'mekan.durum.giris', text: 'sahte', at: Date.now(), nonce: nonce(8) }) })
  const s = await mekan.iste('gelenler')
  t.alike(s.map((x) => x.hata), ['BRIDGE_TYPE', 'BRIDGE_DIRECTION'], 'tür listesi ve yön')
  t.alike(await mekan.iste('gelenler'), [], 'reddedilen paket de kanaldan atıldı')
  // Köprü kapatılınca (ayrılış) gönderilmemiş paketler silinir (RFC-0027 §7 d)
  await mekan.iste('dugmeler', { turler: ['mekan.durum.cikis'] })
  await mekan.iste('hazirla', { type: 'mekan.durum.cikis', text: 'Çıktım' })
  t.is(await mekan.iste('gidenSayisi'), 1)
  await mekan.iste('kapat')
  t.is(await mekan.iste('gidenSayisi'), 0)
  t.alike(await yuva.iste('gelenler'), [])
  await mekan.kapat()
  await yuva.kapat()
})
