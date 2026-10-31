// SPDX-License-Identifier: Apache-2.0
// index.d.ts'teki "Hata …" listelerinin her kodu çalışan kodda geçer (Codex 12. tur: ad değişikliğinden sonra tiplerde
// eski Türkçe kodlar kalmıştı: YETKISIZ yerine UNAUTHORIZED, BEKLEMEDE yerine ON_HOLD, SILINDI yerine DELETED; err.code'u
// tipteki adla karşılaştıran uygulama hatayı hiç yakalamaz). "X_*" biçimi önek sayılır.
'use strict'
const test = require('brittle')
// Kaynak taraması yalnız Node'da (type-events.js ile aynı düzen)
const NODE = typeof Bare === 'undefined' // eslint-disable-line no-undef
const fs = NODE ? require('f' + 's') : null
const path = NODE ? require('pa' + 'th') : null

test('index.d.ts hata listelerindeki kodlar çalışan kodda var', { skip: !NODE }, (t) => {
  const KOK = path.join(__dirname, '..', '..')
  const DTS = fs.readFileSync(path.join(__dirname, '..', 'index.d.ts'), 'utf8')
  const dizgiler = new Set()
  const gez = (d) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name)
      if (f.isDirectory()) { if (f.name !== 'test' && f.name !== 'node_modules') gez(p) } else if (f.name.endsWith('.js')) {
        for (const m of fs.readFileSync(p, 'utf8').matchAll(/'([A-Z][A-Z0-9_]+)'/g)) dizgiler.add(m[1])
      }
    }
  }
  for (const d of ['sdk', 'core', 'worklet']) gez(path.join(KOK, d))
  const kodlar = new Set()
  for (const m of DTS.matchAll(/\bHata:? ([^.\n]*(?:\n\s*\*[^.\n]*)*)/g)) {
    for (const k of m[1].matchAll(/\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)*(?:_\*)?/g)) if (k[0].length > 2) kodlar.add(k[0])
  }
  t.ok(kodlar.size >= 100, 'tiplerde ' + kodlar.size + ' hata kodu')
  for (const k of kodlar) {
    const var_ = k.endsWith('_*') ? [...dizgiler].some((d) => d.startsWith(k.slice(0, -1))) : dizgiler.has(k)
    t.ok(var_, k)
  }
  // SDK'nın yerel kodları İngilizcedir; bu Türkçe adlar yalnız telde (görev reddi, uç akışı kapatma) yaşar
  for (const eski of ['YETKISIZ', 'BEKLEMEDE', 'SILINDI', 'PENCERE_DISI']) t.absent(kodlar.has(eski), 'tiplerin hata listesinde ' + eski + ' yok')
})

test('SDK dışa açık işlev adları: eşitlik yardımcısı equal (ad değişikliğinde esit anahtarı kalmıştı)', (t) => {
  const S = require('..')
  t.is(typeof S.equal, 'function')
  t.ok(S.equal([1, 'a'], [1, 'a']))
  t.absent('esit' in S)
})
