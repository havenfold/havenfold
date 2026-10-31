// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// protocol/vectors/export.json üreticisi (RFC-0014 §11).
// Dosyayı yazmak için: node core/core/scripts/vector-gen.js
//
// Parola, salt ve Argon2id parametreleri sabittir; libsodium akış başını (24 B) kendisi rastgele üretir, bu yüzden
// kapların baytları bir kez üretilip fixture.json'a yazılır. Test, sabit kabı açar ve her bozulmuş kopyayı dener.
const b4a = require('b4a')
const K = require('../../export')
const { arsivYaz } = require('../../archive')

const hex = (b) => b4a.toString(b, 'hex')
const MIB = 1024 * 1024
const PAROLA = 'kirmizi-elma-yaprak-2026'
const SALT = b4a.alloc(16, 0x11)
const KDF = { opslimit: 3, memlimit: 64 * MIB }
const ACIK = { urun: 'yuva-defteri', bicim: 'yuva-defter-arsiv', bicimSurum: 1 }

// Sabitler require ile okunur (Bare'de de); yalnız vektör üretiminde Node'un fs'iyle yazılır
let SABITLER = null // bellekteki kopya; require önbelleği aynı süreçte eski içeriği döndürürdü
function muhurlu (ad, girdi, uret) {
  if (!SABITLER) { try { SABITLER = { ...require('./fixture.json') } } catch { SABITLER = {} } }
  let cache = SABITLER
  if (cache[ad] && cache[ad].girdi === girdi) return cache[ad].hex
  // Test sırasında depoya yazılmaz; sabitler yalnız vektör üretiminde (node core/core/scripts/vector-gen.js) yenilenir
  if (process.env.HF_VEKTOR_YAZ !== '1') throw new Error('SABIT_ESKI: ' + ad + ' — node core/core/scripts/vector-gen.js')
  const fs = require('fs')
  const path = require('path')
  cache[ad] = { girdi, hex: uret() }
  fs.writeFileSync(path.join(__dirname, 'fixture.json'), JSON.stringify(cache, null, 1) + '\n')
  return cache[ad].hex
}

const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const kapOf = (ad, icerik) => b4a.from(muhurlu(ad, hex(require('@havenfold/core').kdf.hash('kap-vektor/', icerik)) + PAROLA + hex(SALT) + JSON.stringify({ ...KDF, ...ACIK }), () => hex(K.kapla(icerik, PAROLA, { ...ACIK, ...KDF, salt: SALT }))), 'hex')

// Başlığı yeniden yazar (uzunluk alanı dahil); gövde aynı kalır
function baslikDegistir (kap, f) {
  const { baslik, govde } = K.baslikOku(kap)
  const hb = b4a.from(JSON.stringify(f({ ...baslik })))
  const uz = b4a.alloc(4)
  new DataView(uz.buffer, uz.byteOffset).setUint32(0, hb.byteLength)
  return b4a.concat([K.SIHIR, b4a.from([K.SURUM]), uz, hb, govde])
}

const BEKLENEN = ['EXPORT_PARAMETER', 'EXPORT_PARAMETER', 'EXPORT_PARAMETER', 'EXPORT_PARAMETER', 'EXPORT_TRUNCATED', 'EXPORT_CORRUPT', 'EXPORT_EXCESS', 'EXPORT_UNVERIFIED', 'EXPORT_TRUNCATED', 'EXPORT_UNVERIFIED', 'EXPORT_UNVERIFIED', 'INVALID_EXPORT']

function vektorler () {
  const zip = arsivYaz({ ...ACIK, icerik: { kayitlar: [{ tur: 'yuva.defter.not', baslik: 'Wifi', metin: 'Ev ağı', yapay_zeka_alanlari: ['metin'] }] }, dosyalar: [{ ad: 'fatura.txt', bytes: b4a.from('Elektrik faturası, Ekim') }] })
  const kucuk = kapOf('kucuk', zip)
  const tamIcerik = b4a.alloc(2 * K.CHUNK)
  for (let i = 0; i < tamIcerik.byteLength; i++) tamIcerik[i] = i % 251
  const tam = kapOf('tam', tamIcerik) // iki tam parça; son parça da tam boy
  const on = K.baslikOku(kucuk).on.byteLength
  const P = K.CHUNK + K.ABYTES

  const bozuk = [
    { no: 2, aciklama: 'opslimit 2', kap: 'kucuk', bayt: baslikDegistir(kucuk, (h) => ({ ...h, opslimit: 2 })) },
    { no: 2, aciklama: 'memlimit 2 GiB', kap: 'kucuk', bayt: baslikDegistir(kucuk, (h) => ({ ...h, memlimit: 2048 * MIB })) },
    { no: 2, aciklama: 'opslimit 17', kap: 'kucuk', bayt: baslikDegistir(kucuk, (h) => ({ ...h, opslimit: 17 })) },
    { no: 2, aciklama: 'kdf başka', kap: 'kucuk', bayt: baslikDegistir(kucuk, (h) => ({ ...h, kdf: 'scrypt' })) },
    { no: 3, aciklama: 'son parça bütünüyle kesilmiş (parça sınırı)', kap: 'tam', bayt: tam.subarray(0, tam.byteLength - P) },
    { no: 3, aciklama: 'son parçanın ortasından kesilmiş', kap: 'tam', bayt: tam.subarray(0, tam.byteLength - 10) },
    { no: 3, aciklama: 'tam boy son parçadan (TAG_FINAL) sonra fazladan bayt', kap: 'tam', bayt: b4a.concat([tam, b4a.alloc(5)]) },
    { no: 3, aciklama: 'kısa son parçanın sonuna fazladan bayt', kap: 'kucuk', bayt: b4a.concat([kucuk, b4a.alloc(5)]) },
    { no: 3, aciklama: 'akış başından sonra hiç parça yok', kap: 'kucuk', bayt: kucuk.subarray(0, on + K.HEADERBYTES) },
    { no: 4, aciklama: 'başlığın bir baytı değişmiş (urun)', kap: 'kucuk', bayt: (() => { const b = b4a.from(kucuk); const i = b4a.toString(b).indexOf('yuva-defteri'); b[i] = 0x59; return b })() },
    { no: 4, aciklama: 'yanlış parola', kap: 'kucuk', bayt: kucuk, parola: 'yanlis-parola-12345' },
    { no: 4, aciklama: 'sihir değişmiş', kap: 'kucuk', bayt: b4a.concat([b4a.from('HFKAQ'), kucuk.subarray(5)]) }
  ].map((d, i) => {
    const bayt = d.bayt
    // Beklenen hata elle yazılmıştır (inceleme 1 kap 13); kodun ürettiği tutmazsa üretim durur
    const hata = hataOf(() => K.ac(bayt, d.parola || PAROLA))
    if (hata !== BEKLENEN[i]) throw new Error('kap vektörü ' + i + ': ' + hata + ' ≠ ' + BEKLENEN[i])
    return { ...d, bayt: d.kap === 'tam' ? null : hex(bayt), kesim: d.kap === 'tam' ? kesimOf(tam, bayt) : null, hata }
  })

  return {
    aciklama: 'RFC-0014 §11: Havenfold kabı. Kaplar parola, salt ve Argon2id parametreleri sabit üretildi; akış başı libsodium\'un rastgele değeridir ve dosyadaki baytlarla verilir. Bozulmuş kopyalar: küçük kapta tam bayt; büyük ("tam") kapta kesim = { bas: ilk n bayt, ek: sona eklenen bayt hex }.',
    parola: PAROLA,
    salt: hex(SALT),
    kdf: KDF,
    anahtar: hex(K.anahtarTuret(PAROLA, SALT, KDF.opslimit, KDF.memlimit)),
    v1: { kap: hex(kucuk), baslik: K.baslikOku(kucuk).baslik, zip: hex(zip) },
    tam: { kap: hex(tam), icerik: 'bayt i = i mod 251, ' + tamIcerik.byteLength + ' bayt' },
    bozuk
  }
}

// Büyük kabın bozulmuş kopyası: baştaki n bayt ve sona eklenen bayt
function kesimOf (tam, b) {
  const n = Math.min(tam.byteLength, b.byteLength)
  return { bas: n, ek: hex(b.subarray(n)) }
}

function bozukBayt (dosya, d) {
  if (d.bayt) return b4a.from(d.bayt, 'hex')
  const tam = b4a.from(dosya.tam.kap, 'hex')
  return b4a.concat([tam.subarray(0, d.kesim.bas), b4a.from(d.kesim.ek, 'hex')])
}

// export-v2.json (inceleme 6, RFC-0021 e, f; RFC-0019 §11.6 a): parola NFC ve kanonik ZIP olumsuzları. Beklenenler elle.
const { zipYaz } = require('../../zip')
function vektorlerV2 () {
  const nfc = 'çay-şeker-ağaç-2026'
  const nfd = nfc.normalize('NFD')
  const kap = b4a.from(muhurlu('nfc', hex(require('@havenfold/core').kdf.hash('kap-vektor/nfc', b4a.from(nfc))), () => hex(K.kapla(b4a.from('nfc'), nfc, { ...ACIK, ...KDF, salt: SALT }))), 'hex')
  const durum = (aciklama, zip, beklenen) => {
    const hata = hataOf(() => require('../../zip').zipOku(zip))
    if (hata !== beklenen) throw new Error('kap-v2 ' + aciklama + ': ' + hata + ' ≠ ' + beklenen)
    return { aciklama, zip: hex(zip), hata: beklenen }
  }
  const iki = b4a.from(zipYaz([{ ad: 'a.txt', bytes: b4a.from('aaaa') }, { ad: 'b.txt', bytes: b4a.from('bbbb') }]))
  const ortusen = b4a.from(iki)
  const cd2 = ortusen.lastIndexOf(b4a.from([0x50, 0x4b, 0x01, 0x02]))
  new DataView(ortusen.buffer, ortusen.byteOffset).setUint32(cd2 + 42, 0, true) // ikinci girdi de ilk veriyi gösterir
  const yerelAd = b4a.from(iki)
  yerelAd[30] = 0x78 // yerel ad 'x.txt', merkez 'a.txt'
  return {
    aciklama: 'RFC-0014 ekleri: parola NFC (RFC-0019 §11.6 a); kanonik ZIP ve güvenli adlar (RFC-0021 e, f). Beklenen hatalar elle yazılmıştır.',
    nfc: { parola: nfc, parolaNfdHex: hex(b4a.from(nfd)), kap: hex(kap), icerik: 'nfc' },
    zip: [
      durum('iki girdi aynı veriyi gösterir (üst üste binme)', ortusen, 'INVALID_ZIP'),
      durum('yerel başlıktaki ad merkezdekinden farklı', yerelAd, 'INVALID_ZIP'),
      durum('ſ ile s harf katlamasında çakışır', (() => {
        // Yazıcı çakışmayı reddettiği için ikinci ad sonradan, yerel ve merkezde birlikte değiştirilir
        const z = b4a.from(zipYaz([{ ad: 'ſ.txt', bytes: b4a.alloc(1) }, { ad: 't.txt', bytes: b4a.alloc(1) }]))
        for (let i = z.indexOf(b4a.from('t.txt')); i >= 0; i = z.indexOf(b4a.from('t.txt'), i + 1)) z[i] = 0x73
        return z
      })(), 'INVALID_ZIP_NAME'),
      durum('sonda yorum (EOCD dosyanın sonunda değil)', b4a.concat([iki, b4a.alloc(3)]), 'INVALID_ZIP')
    ],
    adlar: [['CON', false], ['nul.txt', false], ['COM1', false], ['x.txt:gizli', false], ['nokta.', false], ['bosluk ', false], ['dosyalar/fatura.pdf', true]]
      .map(([ad, gecerli]) => { if (require('../../zip').adGecerli(ad) !== gecerli) throw new Error('kap-v2 ad ' + ad); return { ad, gecerli } })
  }
}

module.exports = { vektorler, vektorlerV2, bozukBayt, PAROLA }
