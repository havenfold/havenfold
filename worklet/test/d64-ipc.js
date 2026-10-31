// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D64: ipc.js'in kalan dalları — reddet kancası fırlatınca, kimliksiz ya da nesne olmayan büyük çerçeveler, sunucu
// hatasının kodu ve kimliği, sonra() kancası, metin olarak gelen veri, off yerine removeListener ya da hiçbiri, el
// sıkışmasının bozuk ve eksik ilk çerçeveleri
'use strict'
const test = require('brittle')
const b4a = require('b4a')
const { ipcBagla, cerceveYaz, EN_COK, baslangicBekle } = require('../ipc')
const { ipcCifti, hataOf } = require('./helpers/common')

const bekle = () => new Promise((resolve) => setTimeout(resolve, 10))
const boy = (n) => { const b = b4a.alloc(4); new DataView(b.buffer, b.byteOffset, 4).setUint32(0, n); return b }
const buyuk = 'x'.repeat(EN_COK)
const cozul = (ipc) => ipc.yazilan.map((b) => JSON.parse(b4a.toString(b.subarray(4))))

// off yerine yalnız removeListener olan (ya da ikisi de olmayan) akış
function eskiAkis ({ removeListener = true } = {}) {
  const dinleyiciler = []
  const ipc = {
    yazilan: [],
    on (e, f) { if (e === 'data') dinleyiciler.push(f) },
    write (b) { ipc.yazilan.push(b4a.from(b)) },
    ver (b) { for (const f of [...dinleyiciler]) f(b) },
    dinleyiciSayisi: () => dinleyiciler.length
  }
  if (removeListener) ipc.removeListener = (e, f) => { const i = dinleyiciler.indexOf(f); if (i >= 0) dinleyiciler.splice(i, 1) }
  return ipc
}

const bosSunucu = () => ({ olaylariBagla: () => null, isle: async () => null })

test('d64 ipc: reddet kancası fırlatsa da büyük geri çağrı gönderilmez, kanal düşmez', async (t) => {
  const ipc = ipcCifti()
  let gonder = null
  const sunucu = { olaylariBagla: (g) => { gonder = g }, isle: async () => null, reddet: () => { throw new Error('KANCA') } }
  const bag = ipcBagla({ ipc, sunucu })
  t.is(gonder(JSON.stringify({ cagri: 'onayEkrani', id: 3, veri: buyuk })), false)
  t.is(ipc.yazilan.length, 0, 'reddet kancası varken cevabı sunucu verir; kanal olayı da yazılmaz')
  t.is(bag.durum.atilan, 1)
  t.is(bag.acik, true)
})

test('d64 ipc: büyük çerçevenin kimliği — geri çağrının id\'si, kimliksiz geri çağrı, dizi, düz metin, boş metin', async (t) => {
  const ipc = ipcCifti()
  let gonder = null
  const bag = ipcBagla({ ipc, sunucu: { olaylariBagla: (g) => { gonder = g }, isle: async () => null } })
  // komutId yoksa geri çağrının kendi id'si
  gonder(JSON.stringify({ cagri: 'onayEkrani', id: 11, veri: buyuk }))
  // ne komutId ne id: kanal olayı
  gonder(JSON.stringify({ cagri: 'onayEkrani', veri: buyuk }))
  // nesne ama kimliksiz (dizi): kanal olayı
  gonder(JSON.stringify([buyuk]))
  // nesne olmayan JSON (metin): kanal olayı
  gonder(JSON.stringify(buyuk))
  // boş metin: JSON değil, kanal olayı
  t.is(gonder(''), false)
  // JSON olmayan büyük metin
  gonder(buyuk + '}')
  const kanal = { id: null, olay: 'channel', govde: { hata: 'INVALID_FRAME' } }
  t.alike(cozul(ipc), [{ id: 11, hata: 'INVALID_FRAME' }, kanal, kanal, kanal, kanal, kanal])
  t.is(bag.durum.atilan, 6)
})

test('d64 ipc: sunucu hatası — kod biçimine uyan ileti kod olur, uymayan ve ileti olmayan INTERNAL_ERROR; kimlik metinden', async (t) => {
  const ipc = ipcCifti()
  const sunucu = {
    olaylariBagla: () => null,
    isle: async (m) => {
      if (m.startsWith('{"id":"s"')) throw new Error('UNAUTHORIZED')
      if (m === 'null') throw null // eslint-disable-line no-throw-literal
      if (m.startsWith('{"id":{')) throw new Error('kucuk harfli ileti')
      throw new Error('X') // tek harf: biçime uymaz
    }
  }
  let sonraSayisi = 0
  ipcBagla({ ipc, sunucu, sonra: () => { sonraSayisi++; throw new Error('DISK') } })
  ipc.ver(cerceveYaz('{"id":"s","komut":1}'))
  ipc.ver(cerceveYaz('null'))
  ipc.ver(cerceveYaz('{"id":{"a":1},"komut":1}'))
  ipc.ver(cerceveYaz('bozuk{'))
  ipc.ver(cerceveYaz('{"id":7}'))
  await bekle()
  t.alike(cozul(ipc), [
    { id: 's', hata: 'UNAUTHORIZED' },
    { id: null, hata: 'INTERNAL_ERROR' },
    { id: null, hata: 'INTERNAL_ERROR' },
    { id: null, hata: 'INTERNAL_ERROR' },
    { id: 7, hata: 'INTERNAL_ERROR' }
  ], 'metin kimlik, null gövde, nesne kimlik ve bozuk JSON')
  t.is(sonraSayisi, 5, 'sonra() her işten sonra çağrılır; fırlatması cevabı engellemez')
})

test('d64 ipc: metin olarak gelen veri bayta çevrilir; off yoksa removeListener ile bırakılır', async (t) => {
  const ipc = eskiAkis()
  const bag = ipcBagla({ ipc, sunucu: { olaylariBagla: () => null, isle: async (m) => JSON.stringify({ id: JSON.parse(m).id, sonuc: 'tamam' }) } })
  // uzunluk 8 (önek baytları ASCII, UTF-8'de olduğu gibi kalır)
  ipc.ver('\0\0\0\b{"id":1}')
  await bekle()
  t.alike(cozul(ipc), [{ id: 1, sonuc: 'tamam' }])
  t.is(bag.durum.gelen, 1)
  bag.kapat()
  t.is(ipc.dinleyiciSayisi(), 0, 'removeListener ile bırakıldı')
  bag.kapat()
  t.is(bag.acik, false, 'ikinci kapat etkisiz')
})

test('d64 ipc: ne off ne removeListener varsa kapat yine de akışı keser', async (t) => {
  const ipc = eskiAkis({ removeListener: false })
  const bag = ipcBagla({ ipc, sunucu: bosSunucu() })
  bag.kapat()
  t.is(bag.acik, false)
  t.is(ipc.dinleyiciSayisi(), 1, 'dinleyici kalır ama veri işlenmez')
  ipc.ver(cerceveYaz('{"id":1}'))
  t.is(bag.durum.gelen, 0)
})

test('d64 baslangicBekle: IPC yoksa NO_IPC; bozuk uzunluk INVALID_FRAME; bozuk JSON ve eksik govde NO_START', async (t) => {
  t.is(await hataOf(baslangicBekle({ ipc: null })), 'NO_IPC')
  t.is(await hataOf(baslangicBekle({ ipc: { on: 1 } })), 'NO_IPC')

  const a = ipcCifti()
  const pa = baslangicBekle({ ipc: a })
  a.ver(boy(0))
  t.is(await hataOf(pa), 'INVALID_FRAME')
  t.is(a.dinleyiciSayisi(), 0)

  const b = ipcCifti()
  const pb = baslangicBekle({ ipc: b })
  b.ver(cerceveYaz('{bozuk'))
  t.is(await hataOf(pb), 'NO_START')

  const c = ipcCifti()
  const pc = baslangicBekle({ ipc: c })
  c.ver(cerceveYaz(JSON.stringify({ id: 1, komut: 1 })))
  t.is(await hataOf(pc), 'NO_START', 'govde yok')

  const d = ipcCifti()
  const pd = baslangicBekle({ ipc: d })
  d.ver(cerceveYaz(JSON.stringify({ id: 1, komut: 1, govde: { anahtarHex: 5 } })))
  t.is(await hataOf(pd), 'NO_START', 'anahtar metin değil')
})

test('d64 baslangicBekle: metin verisi, removeListener ile bırakma; archivePubHex ve sayaç yoksa null', async (t) => {
  const ipc = eskiAkis()
  const p = baslangicBekle({ ipc })
  const metin = JSON.stringify({ id: 'ilk', komut: 1, govde: { anahtarHex: '0f'.repeat(32), sayac: 1.5 } })
  ipc.ver(b4a.toString(boy(metin.length), 'latin1') + metin)
  const s = await p
  t.alike([s.id, s.anahtar, s.archivePubHex, s.sayac], ['ilk', b4a.alloc(32, 0x0f), null, null])
  t.is(ipc.dinleyiciSayisi(), 0)

  const ipc2 = eskiAkis({ removeListener: false })
  const p2 = baslangicBekle({ ipc: ipc2 })
  ipc2.ver(cerceveYaz(JSON.stringify({ id: 2, komut: 9 })))
  t.is(await hataOf(p2), 'NO_START', 'bırakma yolu olmayan akışta da sonuçlanır')
})
