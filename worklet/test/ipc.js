// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// ipc.js testleri: uzunluk önekli çerçeveler, parçalı ve birleşik gelen baytlar, büyük ve bozuk çerçeve, sırasız cevap,
// olay ve geri çağrı
'use strict'
const test = require('brittle')
const b4a = require('b4a')
const { ipcBagla, cerceveYaz, Ayirici, EN_COK } = require('../ipc')
const { ipcCifti, istemci, hataOf } = require('./helpers/common')

const boy = (n) => { const b = b4a.alloc(4); new DataView(b.buffer, b.byteOffset, 4).setUint32(0, n); return b }

// Sunucu taklidi: komut 1 yankı, 2 bir sözü bekler (3 çözer), 4 geri çağrı açar, 5 çok büyük cevap, 6 fırlatır
function yanki () {
  let gonder = null
  let bekleyen = null
  let cagri = null
  const sunucu = {
    async isle (metin) {
      let j
      try { j = JSON.parse(metin) } catch { return JSON.stringify({ id: null, hata: 'INVALID_FRAME' }) }
      if ('cagriId' in j) { cagri(j.sonuc); return null }
      if (j.komut === 1) return JSON.stringify({ id: j.id, sonuc: j.govde })
      if (j.komut === 2) { await new Promise((resolve) => { bekleyen = resolve }); return JSON.stringify({ id: j.id, sonuc: 'ikinci bitti' }) }
      if (j.komut === 3) { bekleyen(); return JSON.stringify({ id: j.id, sonuc: 'üçüncü' }) }
      if (j.komut === 4) {
        const s = await new Promise((resolve) => { cagri = resolve; gonder(JSON.stringify({ cagri: 'onayEkrani', id: 7, veri: { alan: 'tarih' } })) })
        return JSON.stringify({ id: j.id, sonuc: { kullanici: s } })
      }
      if (j.komut === 5) return JSON.stringify({ id: j.id, sonuc: 'x'.repeat(EN_COK) })
      if (j.komut === 6) throw new Error('beklenmedik')
      return JSON.stringify({ id: j.id, hata: 'NO_COMMAND' })
    },
    olaylariBagla (g) { gonder = g; return () => { gonder = null } },
    olay (veri) { gonder(JSON.stringify({ olay: 'kayit-degisim', veri })) }
  }
  return sunucu
}

test('ayırıcı: tek tek baytlarla, birleşik parçalarla ve UTF-8 çok baytlı karakterlerle', (t) => {
  const gelen = []
  const a = new Ayirici({ tamam: (m) => gelen.push(m), gecersiz: () => gelen.push('INVALID') })
  const c1 = cerceveYaz('{"id":1,"ad":"Hüsniye ğüşiöç 🏠"}')
  const c2 = cerceveYaz('{"id":2}')
  for (const b of c1) a.yaz(b4a.from([b]))
  a.yaz(b4a.concat([c2, c1.subarray(0, 5)]))
  a.yaz(c1.subarray(5))
  t.alike(gelen, ['{"id":1,"ad":"Hüsniye ğüşiöç 🏠"}', '{"id":2}', '{"id":1,"ad":"Hüsniye ğüşiöç 🏠"}'])
})

test('ayırıcı: 0 ve 1 MiB üstü uzunluk geçersiz; gövde atlanır, sonraki çerçeve okunur', (t) => {
  const gelen = []
  const a = new Ayirici({ tamam: (m) => gelen.push(m), gecersiz: () => gelen.push('INVALID') })
  a.yaz(boy(0))
  const buyuk = EN_COK + 1
  a.yaz(b4a.concat([boy(buyuk), b4a.alloc(1000, 0x61)]))
  a.yaz(b4a.alloc(buyuk - 1000 - 10, 0x61))
  a.yaz(b4a.concat([b4a.alloc(10, 0x61), cerceveYaz('{"id":3}')]))
  t.alike(gelen, ['INVALID', 'INVALID', '{"id":3}'])
  t.is(cerceveYaz(''), null)
  t.is(cerceveYaz('x'.repeat(EN_COK + 1)), null)
  t.ok(cerceveYaz('x'.repeat(EN_COK)))
})

test('ipc: istek ve cevap; 1 MiB sınırında çerçeve; bozuk çerçeve sunucunun hatasıyla döner', async (t) => {
  const ipc = ipcCifti()
  const bag = ipcBagla({ ipc, sunucu: yanki() })
  const c = istemci(ipc)
  t.alike(await c.iste(1, { a: 'ğ', b: [1, 2] }), { a: 'ğ', b: [1, 2] })
  // Tam 1 MiB'lık istek geçer
  const dolgu = EN_COK - b4a.byteLength(JSON.stringify({ id: 2, komut: 1, govde: '' }))
  t.is((await c.iste(1, 'y'.repeat(dolgu))).length, dolgu)
  // Bozuk JSON
  ipc.ver(cerceveYaz('{bozuk'))
  await new Promise((resolve) => setTimeout(resolve, 10))
  t.alike(c.hatalar.pop(), { id: null, hata: 'INVALID_FRAME' })
  t.is(bag.durum.gelen, 3)
  bag.kapat()
  t.is(ipc.dinleyiciSayisi(), 0)
})

test('ipc: sınır dışı uzunluk eşzamanlamanın kaybıdır: kanal olayı, akış kapanır (RFC-0027 §5 d)', async (t) => {
  for (const n of [0, EN_COK + 1]) {
    const ipc = ipcCifti()
    const bag = ipcBagla({ ipc, sunucu: yanki() })
    const c = istemci(ipc)
    ipc.ver(b4a.concat([boy(n), b4a.alloc(100, 0x7b)]))
    t.alike(c.olaylar, [{ id: null, olay: 'channel', govde: { hata: 'INVALID_FRAME' } }], 'uzunluk ' + n)
    t.is(bag.durum.gecersiz, 1)
    t.is(bag.acik, false, 'akış kapandı; uygulama worklet\'i yeniden başlatır')
    t.is(ipc.dinleyiciSayisi(), 0)
    ipc.ver(cerceveYaz(JSON.stringify({ id: 1, komut: 1, govde: 'sonra' })))
    t.is(bag.durum.gelen, 0, 'kapandıktan sonra işlenmez')
  }
})

test('ipc: sıraya sokulmaz — bekleyen isteğin cevabı sonraki istekle çözülür', async (t) => {
  const ipc = ipcCifti()
  ipcBagla({ ipc, sunucu: yanki() })
  const c = istemci(ipc)
  const sira = []
  const ikinci = c.iste(2).then((x) => sira.push(x))
  const ucuncu = c.iste(3).then((x) => sira.push(x))
  await Promise.all([ikinci, ucuncu])
  t.alike(sira, ['üçüncü', 'ikinci bitti'])
})

test('ipc: geri çağrı uygulamaya gider, cevabı (cagriId) aynı kanaldan döner; olaylar', async (t) => {
  const ipc = ipcCifti()
  const s = yanki()
  ipcBagla({ ipc, sunucu: s })
  const c = istemci(ipc, { cagri: (j) => ({ gordu: j.veri.alan, onay: true }) })
  t.alike(await c.iste(4), { kullanici: { gordu: 'tarih', onay: true } })
  s.olay({ collectionId: 'ab', recordIds: ['cd'] })
  t.alike(c.olaylar, [{ olay: 'kayit-degisim', veri: { collectionId: 'ab', recordIds: ['cd'] } }])
})

test('ipc: 1 MiB üstü cevap aynı kimlikle INVALID_FRAME; sunucu fırlatırsa { id, hata }', async (t) => {
  const ipc = ipcCifti()
  const bag = ipcBagla({ ipc, sunucu: yanki() })
  const c = istemci(ipc)
  t.is(await hataOf(c.iste(5)), 'INVALID_FRAME')
  t.is(bag.durum.atilan, 1)
  ipc.ver(cerceveYaz(JSON.stringify({ id: 99, komut: 6 })))
  await new Promise((resolve) => setTimeout(resolve, 10))
  t.alike(c.hatalar.pop(), { id: 99, hata: 'INTERNAL_ERROR' }, 'kimlik metinden ayrıştırılır')
})

test('ipc: 1 MiB üstü geri çağrı ilgili komutu reddeder; kimliksiz büyük olay kanal olayıyla bildirilir', async (t) => {
  const ipc = ipcCifti()
  let gonder = null
  const reddedilen = []
  const sunucu = {
    olaylariBagla: (g) => { gonder = g },
    isle: async (m) => {
      const j = JSON.parse(m)
      if (j.komut === 1) { gonder(JSON.stringify({ cagri: 'onayEkrani', id: 5, komutId: j.id, veri: 'x'.repeat(EN_COK) })); return null }
      return null
    }
  }
  const bag = ipcBagla({ ipc, sunucu })
  const c = istemci(ipc)
  t.is(await hataOf(c.iste(1)), 'INVALID_FRAME', 'reddet kancası yoksa komutun kimliğiyle')
  sunucu.reddet = (id, kod) => reddedilen.push([id, kod])
  gonder(JSON.stringify({ cagri: 'onayEkrani', id: 6, komutId: 9, veri: 'x'.repeat(EN_COK) }))
  t.alike(reddedilen, [[6, 'INVALID_FRAME']], 'kanca varsa sunucu bırakır, cevabı kendisi verir')
  gonder(JSON.stringify({ olay: 'buyuk', veri: 'x'.repeat(EN_COK) }))
  t.alike(c.olaylar.at(-1), { id: null, olay: 'channel', govde: { hata: 'INVALID_FRAME' } })
  t.is(bag.durum.atilan, 3)
})

test('ipc: kapandıktan sonra gelen bayt işlenmez, olay gönderilmez; IPC yoksa NO_IPC', async (t) => {
  const ipc = ipcCifti()
  const s = yanki()
  const bag = ipcBagla({ ipc, sunucu: s })
  bag.kapat()
  t.absent(bag.gonder('{"olay":"x"}'))
  t.is(ipc.yazilan.length, 0)
  let err = null
  try { ipcBagla({ ipc: null, sunucu: s }) } catch (e) { err = e.message }
  t.is(err, 'NO_IPC')
})

test('baslangicBekle: ilk çerçeve platform anahtarını verir; başka ilk çerçeve NO_START (RFC-0027 §5 a)', async (t) => {
  const { baslangicBekle } = require('../ipc')
  const ipc = ipcCifti()
  const p = baslangicBekle({ ipc })
  ipc.ver(cerceveYaz(JSON.stringify({ id: 1, komut: 1, govde: { anahtarHex: 'ab'.repeat(32), archivePubHex: 'cd'.repeat(32), sayac: 4 } })))
  const b = await p
  t.alike([b.id, b.anahtar, b.archivePubHex, b.sayac], [1, b4a.alloc(32, 0xab), 'cd'.repeat(32), 4])
  t.is(ipc.dinleyiciSayisi(), 0, 'el sıkışmadan sonra dinlemez')
  const ipc2 = ipcCifti()
  const p2 = baslangicBekle({ ipc: ipc2 })
  ipc2.ver(cerceveYaz(JSON.stringify({ id: 1, komut: 200, govde: {} })))
  t.is(await hataOf(p2), 'NO_START')
  const ipc3 = ipcCifti()
  const p3 = baslangicBekle({ ipc: ipc3 })
  ipc3.ver(cerceveYaz(JSON.stringify({ id: 1, komut: 1, govde: { anahtarHex: 'kisa' } })))
  t.is(await hataOf(p3), 'NO_START')
})
