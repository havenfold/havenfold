// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Test yardımcıları: geçici dizin, bellek içi IPC çifti, uygulama tarafı istemci
'use strict'
const fs = require('#fs')
const b4a = require('b4a')
const { Ayirici, cerceveYaz } = require('../../ipc')

const KOK = __dirname + '/../../.gecici'

// Her çağrıda yeni ve boş bir dizin; test bitince silinir
function geciciDizin (t, ad = 'd') {
  const d = KOK + '/' + ad + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
  fs.mkdirSync(d, { recursive: true })
  if (t && typeof t.teardown === 'function') t.teardown(() => { try { fs.rmSync(d, { recursive: true, force: true }) } catch {} })
  return d
}

// Bare Kit IPC'nin bellek içi karşılığı: worklet tarafı 'data' dinler ve write eder; uygulama tarafı ver() ile bayt verir,
// yazılanları yazilan[] dizisinde toplar
function ipcCifti () {
  const dinleyiciler = []
  const ipc = {
    yazilan: [],
    on (e, f) { if (e === 'data') dinleyiciler.push(f) },
    off (e, f) { const i = dinleyiciler.indexOf(f); if (i >= 0) dinleyiciler.splice(i, 1) },
    write (b) { ipc.yazilan.push(b4a.from(b)); if (ipc.alici) ipc.alici(b) },
    ver (b) { for (const f of [...dinleyiciler]) f(b) },
    dinleyiciSayisi: () => dinleyiciler.length,
    alici: null
  }
  return ipc
}

// Uygulama tarafı: istek gönderir, cevapları kimlikle eşler; olay ve geri çağrıları toplar
function istemci (ipc, { cagri = null } = {}) {
  let sayac = 0
  const bekleyen = new Map()
  const olaylar = []
  const hatalar = []
  const ayir = new Ayirici({
    tamam: (metin) => {
      const j = JSON.parse(metin)
      if ('cagri' in j) {
        Promise.resolve(cagri ? cagri(j) : null).then((sonuc) => ipc.ver(cerceveYaz(JSON.stringify({ cagriId: j.id, sonuc }))))
        return
      }
      if ('olay' in j) { olaylar.push(j); return }
      const b = bekleyen.get(j.id)
      if (!b) { hatalar.push(j); return }
      bekleyen.delete(j.id)
      if (j.hata) b.reject(new Error(j.hata))
      else b.resolve(j.sonuc)
    },
    gecersiz: () => hatalar.push({ hata: 'INVALID_INCOMING' })
  })
  ipc.alici = (b) => ayir.yaz(b4a.from(b))
  return {
    olaylar,
    hatalar,
    // aile: RFC-0034 çerçeve alanı (yerelNo); verilmezse çerçevede yok
    iste (komut, govde = {}, aile) {
      const id = ++sayac
      return new Promise((resolve, reject) => {
        bekleyen.set(id, { resolve, reject })
        ipc.ver(cerceveYaz(JSON.stringify(aile === undefined ? { id, komut, govde } : { id, komut, govde, aile })))
      })
    }
  }
}

// Arşiv katmanının anahtar çifti (testte tohumdan; gerçekte biyometriyle açılan platform anahtarlığında)
function arsivAnahtari (tohum = 7) {
  const sodium = require('sodium-native')
  const pk = b4a.alloc(32)
  const sk = b4a.alloc(32)
  sodium.crypto_box_seed_keypair(pk, sk, b4a.alloc(32, tohum))
  return { pubHex: b4a.toString(pk, 'hex'), skHex: b4a.toString(sk, 'hex') }
}

// Kalici: testte açık kip (testKipi); aynı dizinin önceki örneği kapatılır (dizin kilidi, RFC-0027 §5 f)
const acik = new Map()
function kaliciAc (o) {
  const { Kalici } = require('../../persistence')
  const d = String(o.dizin).replace(/\/$/, '')
  if (acik.has(d)) { acik.get(d).kapat(); acik.delete(d) }
  const k = new Kalici({ testKipi: true, ...o })
  acik.set(d, k)
  return k
}

const hataOf = async (p) => { try { await p; return null } catch (err) { return err.message } }
const hataOfSenk = (f) => { try { f(); return null } catch (err) { return err.message } }

module.exports = { geciciDizin, ipcCifti, istemci, hataOf, hataOfSenk, kaliciAc, arsivAnahtari }
