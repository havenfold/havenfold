// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// scripts/package-try.js — paketlenmiş çekirdeğin Bare'de yüklendiğini ve çalıştığını dener (scripts/package-try.sh).
// Bellek içi IPC ile örnek ürün sunucusuna aile kurdurur, kayıt yazar, yeniden açar ve kaydı okur.
/* global Bare */
'use strict'
const b4a = require('b4a')
const sodium = require('sodium-native')
const { start, ipc: { cerceveYaz, Ayirici } } = require('..')
const { urunSunucusu, KOMUT } = require('../example/product')

const dizin = Bare.argv[Bare.argv.length - 1]
// Deneme anahtarları (yalnız bu deneme; telefonda platform anahtarlığından)
const anahtar = b4a.alloc(32, 9)
const pk = b4a.alloc(32)
sodium.crypto_box_seed_keypair(pk, b4a.alloc(32), b4a.alloc(32, 8))
const archivePubHex = b4a.toString(pk, 'hex')

function telefon () {
  const dinle = []
  let sayac = 0
  const bekleyen = new Map()
  const ayir = new Ayirici({ tamam: (m) => { const j = JSON.parse(m); const b = bekleyen.get(j.id); if (b) { bekleyen.delete(j.id); j.hata ? b.reject(new Error(j.hata)) : b.resolve(j.sonuc) } }, gecersiz: () => {} })
  const ipc = { on: (e, f) => dinle.push(f), write: (b) => ayir.yaz(b) }
  const iste = (komut, govde = {}) => new Promise((resolve, reject) => { const id = ++sayac; bekleyen.set(id, { resolve, reject }); for (const f of dinle) f(cerceveYaz(JSON.stringify({ id, komut, govde }))) })
  return { ipc, iste }
}

async function main () {
  const a = telefon()
  const w = await start({ urunSunucusu, dizin, ipc: a.ipc, appId: 'deneme', anahtar, archivePubHex })
  await a.iste(KOMUT.CREATE_FAMILY, { aileAdi: 'Deneme', benimAdim: 'Alex' })
  const cid = (await a.iste(KOMUT.RECORD_COLLECTIONS))[0].collectionId
  const rid = await a.iste(KOMUT.RECORD_PUT, { collectionId: cid, type: 'yuva.defter.not', fields: { baslik: 'paket' } })
  w.kapat()
  const b = telefon()
  const w2 = await start({ urunSunucusu, dizin, ipc: b.ipc, appId: 'deneme', anahtar, archivePubHex })
  const k = await b.iste(KOMUT.RECORD_GET, { collectionId: cid, recordId: rid })
  if (!k || k.fields.baslik !== 'paket') throw new Error('PACKAGE_TRIAL_FAILED')
  w2.kapat()
  console.log('PAKET TAMAM')
}

main().catch((err) => { console.error(err); Bare.exitCode = 1 })
