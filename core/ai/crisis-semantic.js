// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// crisis-semantic.js — kriz tespitinin anlam katmanı (RFC-0023 §2): telefondaki gömme modeliyle en yakın komşu
//
// Cümle gömülür; kriz örneklerine ve zararsız örneklere kosinüs benzerliğiyle bakılır. Kriz kümesindeki en yakın k
// örneğin ortalaması eşiği geçer ve zararsız kümeninkini en az 'fark' kadar aşarsa kriz sayılır. Katman yalnız tespit
// ekler; listenin tespitini kaldıramaz. Cümle, gömme ve sonuç cihazdan çıkmaz, geçmişe yazılmaz.
// gom(metin) → Float32Array | number[] (eşzamanlı ya da Promise): platformun gömme modeli (§15.5); onEk: modelin
// bildirimdeki parça/sorgu öneki (ör. e5 için 'query: ').
const ORNEKLER = require('./crisis-examples.json')
const { N } = require('./text')

function fail (code) { throw new Error(code) }

function birim (v) {
  const a = Float64Array.from(v)
  let n = 0
  for (const x of a) n += x * x
  n = Math.sqrt(n)
  if (!(n > 0)) fail('INVALID_VECTOR')
  for (let i = 0; i < a.length; i++) a[i] /= n
  return a
}

function carp (a, b) {
  if (a.length !== b.length) fail('SIZE_MISMATCH')
  let t = 0
  for (let i = 0; i < a.length; i++) t += a[i] * b[i]
  return t
}

class KrizAnlam {
  // modelHash: eşik tablosundan seçim için. Tablo girdisi { yuksek, dusuk } (RFC-0024 §5 d); eski tek eşikli biçim
  // yüksek eşik sayılır, düşük eşik yoksa sınır sonucu yoktur. esik / dusuk verilirse tablo yerine onlar (ölçüm, test).
  constructor ({ gom, onEk = '', modelHash = null, ornekler = ORNEKLER, esik = null, dusuk = undefined }) {
    if (typeof gom !== 'function') fail('NO_EMBEDDING')
    this.gom = gom
    this.onEk = onEk
    this.ornekler = ornekler
    const girdi = ornekler.esikler[modelHash] || ornekler.esikler.varsayilan
    const iki = girdi && girdi.yuksek ? girdi : { yuksek: girdi, dusuk: null }
    this.esik = esik || iki.yuksek
    this.dusuk = dusuk !== undefined ? dusuk : (esik ? null : iki.dusuk || null)
    this.surum = ornekler.surum
    this._hazir = null
  }

  async _vektor (metin) { return birim(await this.gom(this.onEk + N(metin))) }

  // Örnek kümelerini bir kez gömer
  hazirla () {
    if (!this._hazir) {
      this._hazir = (async () => {
        const kriz = []
        for (const [kume, cumleler] of Object.entries(this.ornekler.kriz)) for (const c of cumleler) kriz.push({ kume, v: await this._vektor(c) })
        const zararsiz = []
        for (const c of this.ornekler.zararsiz) zararsiz.push({ v: await this._vektor(c) })
        return { kriz, zararsiz }
      })()
    }
    return this._hazir
  }

  // Cümlenin örneklere benzerlikleri, büyükten küçüğe: { kriz: { <küme>: [..] }, zararsiz: [..] }
  async benzerlikler (metin) {
    const { kriz, zararsiz } = await this.hazirla()
    const v = await this._vektor(metin)
    const out = { kriz: {}, zararsiz: zararsiz.map((x) => carp(v, x.v)).sort((a, b) => b - a) }
    for (const x of kriz) (out.kriz[x.kume] = out.kriz[x.kume] || []).push(carp(v, x.v))
    for (const k of Object.keys(out.kriz)) out.kriz[k].sort((a, b) => b - a)
    return out
  }

  // Küme başına: o kümenin en yakın k örneğinin ortalaması kümenin eşiğini geçer ve zararsız kümeninkini en az
  // 'fark' kadar aşarsa kriz. Eşik { esik, fark, k, kumeler: { <küme>: { esik?, fark?, k? } } } (inceleme 9).
  // Dönüş: { kriz, kume (tetikleyen ya da en benzer), benzerlik, zararsizBenzerlik }
  // RFC-0024 §5: kriz yüksek eşikle; sinir, yüksek eşiği geçmeyip düşük eşiği geçen benzerlik
  async skor (metin) {
    const b = await this.benzerlikler(metin)
    const y = karar(b, this.esik)
    const d = this.dusuk ? karar(b, this.dusuk) : null
    return { ...y, sinir: !y.kriz && !!(d && d.kriz) }
  }
}

const ort = (s, k) => { const a = s.slice(0, k); return a.reduce((x, y) => x + y, 0) / a.length }

// Saf karar: benzerlikler ve eşik tablosundan (ölçüm betiği eşik aramasında bunu doğrudan kullanır)
function karar (b, taban) {
  let en = null
  for (const kume of Object.keys(b.kriz)) {
    const p = { ...taban, ...((taban.kumeler || {})[kume] || {}) }
    const kk = ort(b.kriz[kume], p.k)
    const zz = ort(b.zararsiz, p.k)
    const r = { kriz: kk >= p.esik && kk - zz >= p.fark, kume, benzerlik: kk, zararsizBenzerlik: zz }
    if (r.kriz ? (!en || !en.kriz || r.benzerlik > en.benzerlik) : (!en || (!en.kriz && r.benzerlik > en.benzerlik))) en = r
  }
  return en
}

module.exports = { KrizAnlam, ORNEKLER, birim, carp, karar }
