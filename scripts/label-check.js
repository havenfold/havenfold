// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// label-check.js — türetme etiketlerinin önek denetimi (RFC-0027 §8 d; D69)
//
//   node scripts/label-check.js           denetler; izin listesinde olmayan önek çifti varsa çıkış kodu 1
//   node scripts/label-check.js --liste   bütün etiketleri (etiket, işlev, dosya:satır) basar
//
// Test dışı koddaki (core, sdk, worklet, node, tools; node_modules ve test dizinleri hariç) derive, hash, deriveLP ve
// hashLP çağrılarının düz yazılmış etiketleri toplanır ve ikili karşılaştırılır: bir etiket başka bir etiketin önekiyse
// (ilk parça etiketin devamı gibi okunabilir) çift sayılır. Bilinen beş çift gerekçesiyle izinlidir
// (kollar/D-turetme-analizi.md §3). Değişkenle verilen etiketler (sarmalayıcılar) taranmaz; birleştirmeyle yazılanın
// ('hf/task/' + x) düz yazılmış başı alınır.
'use strict'
const fs = require('fs')
const path = require('path')

const KOK = path.join(__dirname, '..')
const DIZINLER = ['core', 'sdk', 'worklet', 'node', 'tools']
const IZINLI = {
  'hf/worklet/arsiv|hf/worklet/arsiv-oge': 'arşiv içeriği parcalariYaz başlığıyla başlar, "-oge" ile başlayamaz; iki özet hiçbir yerde karşılaştırılmaz',
  'hf/yz/dizin|hf/yz/dizin-ad/': 'biri anahtarlı (derive) biri anahtarsız (hash): BLAKE2b parametre bloğu ayrışır',
  'hf/yz/ozet|hf/yz/ozet/': 'biri anahtarlı (derive) biri anahtarsız (hash)',
  'mailbox|mailbox-seal': 'Yuva Hat etiketi; toplam boylar farklı (7+24 ile 12)',
  'prekey|prekey-id': 'Yuva Hat etiketi; toplam boylar farklı (70 ile 41)'
}

function dosyalar (d, out = []) {
  for (const ad of fs.readdirSync(d, { withFileTypes: true })) {
    if (ad.name === 'node_modules' || ad.name === 'test' || ad.name.startsWith('.')) continue
    const y = path.join(d, ad.name)
    if (ad.isDirectory()) dosyalar(y, out)
    else if (ad.name.endsWith('.js')) out.push(y)
  }
  return out
}

// Kaynaktaki i konumundan başlayan argümanın sonu (üst düzey virgül ya da kapanan parantez)
function argSonu (s, i) {
  let derin = 0
  let tirnak = null
  for (; i < s.length; i++) {
    const ch = s[i]
    if (tirnak) { if (ch === '\\') i++; else if (ch === tirnak) tirnak = null; continue }
    if (ch === "'" || ch === '"' || ch === '`') tirnak = ch
    else if ('([{'.includes(ch)) derin++
    else if (')]}'.includes(ch)) { if (!derin) return i; derin-- } else if (ch === ',' && !derin) return i
  }
  return -1
}

const DIZGI = /^\s*(['"])((?:\\.|(?!\1).)*)\1/

function etiketler () {
  const out = []
  for (const d of DIZINLER) {
    const kok = path.join(KOK, d)
    if (!fs.existsSync(kok)) continue
    for (const f of dosyalar(kok)) {
      const s = fs.readFileSync(f, 'utf8')
      const re = /(?<![\w$.])(?:kdf\.)?(derive|deriveLP|hash|hashLP)\(/g
      let m
      while ((m = re.exec(s))) {
        let i = m.index + m[0].length
        if (m[1].startsWith('derive')) { const son = argSonu(s, i); if (son < 0 || s[son] !== ',') continue; i = son + 1 }
        const d2 = DIZGI.exec(s.slice(i))
        if (!d2) continue
        const satir = s.slice(0, m.index).split('\n').length
        out.push({ etiket: d2[2], islev: m[1], yer: path.relative(KOK, f) + ':' + satir })
      }
    }
  }
  return out
}

function denetle () {
  const hepsi = etiketler()
  const tekil = [...new Set(hepsi.map((x) => x.etiket))].sort()
  const ciftler = []
  for (const a of tekil) for (const b of tekil) if (a !== b && b.startsWith(a)) ciftler.push(a + '|' + b)
  const izinsiz = ciftler.filter((k) => !IZINLI[k])
  const eskimis = Object.keys(IZINLI).filter((k) => !ciftler.includes(k))
  return { hepsi, tekil, ciftler, izinsiz, eskimis }
}

if (require.main === module) {
  const r = denetle()
  if (process.argv.includes('--liste')) for (const x of r.hepsi) console.log(x.etiket + '\t' + x.islev + '\t' + x.yer)
  for (const k of r.izinsiz) {
    const [a, b] = k.split('|')
    const yer = (e) => r.hepsi.filter((x) => x.etiket === e).map((x) => x.islev + ' ' + x.yer).join(', ')
    console.log(`ÖNEK ÇİFTİ: "${a}" (${yer(a)}) < "${b}" (${yer(b)}) — yeni etiketi değiştirin ya da gerekçesiyle izin listesine yazın`)
  }
  for (const k of r.eskimis) console.log('İZİN LİSTESİNDE ESKİMİŞ ÇİFT: ' + k)
  const sorun = r.izinsiz.length + r.eskimis.length
  console.log(sorun ? 'ETIKET_DENETIMI SORUNLU ' + sorun : `ETIKET_DENETIMI TAMAM ${r.tekil.length} etiket, ${r.ciftler.length} izinli çift`)
  process.exit(sorun ? 1 : 0)
}

module.exports = { denetle, etiketler, IZINLI }
