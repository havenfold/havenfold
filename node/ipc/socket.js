// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// ipc/socket.js — Unix soketi taşıyıcısı (yalnız Node; denetçi, havenfold komutu ve yetki yardımcısı)
//
// Node'un çekirdeğinde SO_PEERCRED yoktur. Karşı ucun kullanıcısını veren işlev (kimlikBul) bu yüzden dışarıdan
// verilir ve zorunludur: verilmezse dinleme başlamaz. Pakette bunu sağlayan yerel eklenti yok (İstek 107).
// Soket dosyasının izni (0660, grup) ikinci savunma hattıdır, yerine geçmez.
const net = require('net')
const fs = require('fs')

function dinle ({ yol, uc, kimlikBul, izin = 0o660 }) {
  if (typeof kimlikBul !== 'function') throw new Error('NO_PEERCRED')
  try { fs.unlinkSync(yol) } catch {}
  const sunucu = net.createServer((soket) => {
    let b = null
    // Karşı uç bağlantıyı koparırsa (ECONNRESET, çekirdek kapanırken) denetçi düşmez; bağlantı bırakılır
    soket.on('error', () => soket.destroy())
    Promise.resolve().then(() => kimlikBul(soket)).then((kullanici) => {
      b = uc.baglan(kullanici)
      if (!b) { soket.destroy(); return }
      b.yaziciBagla((f) => soket.write(f))
      soket.on('close', () => b.birak())
      soket.on('data', async (parca) => {
        const { cikis, kapat } = await b.al(parca)
        for (const f of cikis) soket.write(f)
        if (kapat) soket.destroy()
      })
    }, () => soket.destroy())
  })
  return new Promise((resolve, reject) => {
    sunucu.once('error', reject)
    sunucu.listen(yol, () => { fs.chmodSync(yol, izin); resolve(sunucu) })
  })
}

// İstemci: bağlanır, çerçeve gönderir, gelen çerçeveleri okuyucuya verir
function baglan (yol) {
  return new Promise((resolve, reject) => {
    const s = net.createConnection(yol, () => resolve(s))
    s.once('error', reject)
  })
}

module.exports = { dinle, baglan }
