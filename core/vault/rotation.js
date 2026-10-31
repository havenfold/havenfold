// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// rotation.js — döndürme (RFC-0004 §6)
//
// Aynı sır yeniden bölünmez: yeni sır üretilir, version artar. YA'da dizin yeni YA ile yeniden mühürlenir ve eskisi
// tutuculardan silinir (PayTutucu.ekle yeni sürüm gelince eski payı siler); pay sahibi çalındıysa bloklar sonraki
// gecelerde yeni fileKey'lerle yeniden yüklenir. KRA'da zarflar yeni KRA ile yeniden şifrelenir. Birden çok yeni KRA
// olursa en büyük version, eşitlikte en küçük hash('hf/kasa-kra/', KRA) geçerlidir.
const b4a = require('b4a')
const sodium = require('sodium-native')
const { kdf: { hash } } = require('@havenfold/core')
const { SIR, paylariUret } = require('./share')
const { dizinAc, dizinMuhurle, blokSifrele } = require('./backup')
const { zarfAc, zarfYaz } = require('./envelope')

function yeniSir () {
  const s = b4a.alloc(SIR)
  sodium.randombytes_buf(s)
  return s
}

// adaylar: [{ version, kra }]
function kraKazanan (adaylar) {
  return [...adaylar].sort((a, b) => b.version - a.version || b4a.compare(hash('hf/kasa-kra/', a.kra), hash('hf/kasa-kra/', b.kra)))[0] || null
}

// Yeni sürüm: yeni sır ve payları. dagitim: esik.yaDagitim / kraDagitim (bugünkü sahipler). Dönüş: { sir, version, paylar }
async function dondur ({ secretId, kind, eskiVersion, dagitim }) {
  const sir = yeniSir()
  const version = eskiVersion + 1
  const paylar = await paylariUret(sir, { secretId, kind, version, dagitim })
  return { sir, version, paylar }
}

// YA: dizin yeni YA ve yeni sürümle yeniden mühürlenir; seq bir artar. calindi: eski bir pay sahibi güvenilmez;
// bloklar yeniden yüklenmeli (yeniden yüklenen blokların listesi döner, yükleme gece işidir).
function dizinDondur ({ eskiYa, yeniYa, secretId, muhurlu, yeniVersion, calindi = false }) {
  const d = dizinAc(eskiYa, muhurlu)
  const yeni = { ...d, version: yeniVersion, seq: d.seq + 1 }
  return { muhurlu: dizinMuhurle(yeniYa, secretId, yeni), yenidenYuklenecek: calindi ? d.blocks.map((b) => b.blokNo) : [] }
}

// Bir bloğun yeni fileKey ile yeniden şifrelenmesi ve dizindeki girdinin değişmesi
function blokYenile (dizin, blokNo, bytes) {
  const { blok, chunks } = blokSifrele(blokNo, bytes)
  return { dizin: { ...dizin, seq: dizin.seq + 1, blocks: dizin.blocks.map((b) => (b.blokNo === blokNo ? blok : b)) }, chunks }
}

// KRA: zarflar yeni KRA ve yeni sürümle yeniden şifrelenir (yazan: döndüren okuyucu)
function zarflariDondur (L, { eskiKra, yeniKra, zarflar, yeniVersion, okuyucuMu, writer }) {
  return zarflar.map((b) => {
    const z = zarfAc(L, eskiKra, b, { okuyucuMu })
    return zarfYaz(L.familyId, yeniKra, { collectionId: z.collectionId, version: yeniVersion, envSeq: z.envSeq, ic: z.ic }, writer)
  })
}

module.exports = { yeniSir, kraKazanan, dondur, dizinDondur, blokYenile, zarflariDondur }
