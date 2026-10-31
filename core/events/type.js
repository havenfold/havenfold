// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// type.js — olay türü adları, tür tanımı ve katalog (RFC-0006 §5, §6)
//
// Türler uygulamanın içinde gelen sabit tanımlarla bilinir; uzaktan tür indirilmez. Çekirdek türleri
// protocol/event-types.json'dadır (RFC-0019 7.1); ürün türlerini SDK başlangıçta turKaydet ile verir.
const b4a = require('b4a')
const CEKIRDEK = require('@havenfold/core/protocol/event-types.json') // kanonik kopya protocol/'da; aynılığı core testi denetler

function fail (code) { throw new Error(code) }

const NS = ['hf', 'yuva', 'mekan']
// §5.1: hf. modülleri; yeni modül yalnız RFC ile
const HF_MODULLER = ['device', 'task', 'backup', 'wipe', 'sos', 'kayit', 'kasa', 'grant', 'olay', 'rutin', 'kural', 'vaka', 'kart', 'saklama', 'ai', 'ekip', 'hizmet', 'paylasim', 'node', 'uc', 'app', 'aile-izni', 'uygulama'] // aile-izni: RFC-0034 §4.4 (K1); uygulama: RFC-0036 §3
const AD_RE = /^(hf|yuva|mekan)(\.[a-z0-9][a-z0-9-]*){1,5}$/
const MAX_AD = 64
const OZNE = ['uye', 'varlik', 'yer', 'device', 'grant', 'kayit', 'topluluk']
const YAZAR = ['uye', 'cihaz', 'ikisi', 'kendi'] // kendi: yalnız hf. türlerinde (RFC-0036 §3.3)
const KAPSAM = ['topluluk', 'kisisel', 'bag', 'hizmet']
const DEGER = ['null', 'false', 'true', 'bool', 'int', 'string', 'bytes', 'blobRef', 'list'] // RFC-0001 §4.2 etiket adları; bool: false ya da true
const ALAN_RE = /^[a-z0-9][a-z0-9_.]*$/
const BILINEN_V = 1

// Ad biçimi doğru mu (§5.1). hf. adlarında ikinci parça listedeki modüllerden biri olmalı.
function adGecerli (ad) {
  if (typeof ad !== 'string' || b4a.byteLength(ad) > MAX_AD || !AD_RE.test(ad)) return false
  const [ns, modul] = ad.split('.')
  if (ns === 'hf' && !HF_MODULLER.includes(modul)) return false
  return true
}

// Motorun değerlendirdiği ad alanı mı (üç ad alanı dışındakiler kaydedilir ama değerlendirilmez)
const adAlaniBilinir = (ad) => typeof ad === 'string' && NS.includes(ad.split('.')[0])

function tanimDogrula (t) {
  if (!t || typeof t !== 'object' || !adGecerli(t.tur)) fail('INVALID_TYPE')
  if (!Number.isInteger(t.v) || t.v < 1 || typeof t.olay !== 'boolean') fail('INVALID_TYPE')
  if (!YAZAR.includes(t.yazar) || (t.yazar === 'kendi' && !t.tur.startsWith('hf.')) || !Array.isArray(t.ozne) || !t.ozne.length || !t.ozne.every((o) => OZNE.includes(o))) fail('INVALID_TYPE')
  if (!Array.isArray(t.alanlar)) fail('INVALID_TYPE')
  for (const a of t.alanlar) {
    if (!a || !ALAN_RE.test(a.ad) || b4a.byteLength(a.ad) > MAX_AD || !DEGER.includes(a.deger)) fail('INVALID_TYPE')
  }
  if (t.kapsam !== undefined && !KAPSAM.includes(t.kapsam)) fail('INVALID_TYPE')
  if (t.keep !== undefined && !(Number.isInteger(t.keep) && t.keep >= 0)) fail('INVALID_TYPE')
  if (t.ozel !== undefined && typeof t.ozel !== 'boolean') fail('INVALID_TYPE')
  if (t.onem !== undefined && !(Number.isInteger(t.onem) && t.onem >= 0 && t.onem <= 3)) fail('INVALID_TYPE')
  return {
    kapsam: 'topluluk',
    keep: 0,
    ozel: false,
    ozet: t.tur + '.ozet',
    onem: 0,
    ...t
  }
}

class Katalog {
  // adAlani: ürünün ad alanı ('yuva' ya da 'mekan'); verilirse turKaydet başka ad alanını reddeder (inceleme olay 21)
  constructor ({ cekirdek = true, adAlani = null } = {}) {
    this.m = new Map()
    this.adAlani = adAlani
    if (cekirdek) for (const t of CEKIRDEK.turler) this._ekle(t)
  }

  _ekle (tanim) {
    const t = tanimDogrula(tanim)
    this.m.set(t.tur, Object.freeze(t))
    return t
  }

  // Ürün türü. hf. türleri yalnız çekirdek kataloğundan gelir; aynı tür ikinci kez kaydedilirse sonraki geçer
  // (uygulama güncellemesi tanımı değiştirebilir)
  turKaydet (tanim) {
    const ns = tanim && typeof tanim.tur === 'string' ? tanim.tur.split('.')[0] : null
    if (ns === 'hf' || (this.adAlani && ns !== this.adAlani)) fail('TYPE_NAME_FIELD')
    return this._ekle(tanim)
  }

  get (tur) { return this.m.get(tur) || null }
  olaylar () { return [...this.m.values()].filter((t) => t.olay) }
}

module.exports = { NS, HF_MODULLER, OZNE, YAZAR, KAPSAM, DEGER, BILINEN_V, MAX_AD, adGecerli, adAlaniBilinir, tanimDogrula, Katalog, CEKIRDEK }
