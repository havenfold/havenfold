// SPDX-License-Identifier: Apache-2.0
// index.d.ts'te on/once/off (ad: …) ile bildirilen her olay adını çalışan kod yayar (Codex 11. tur: ad değişikliğinden
// sonra tipler eski Türkçe olay adlarında kalmıştı; eski ada abone olan kod olayı sessizce kaçırır).
'use strict'
const test = require('brittle')
// Kaynak taraması yalnız Node'da (kaynak platformdan bağımsız). Modül adları birleştirilerek yazılır: Bare yükleyicisi düz
// yazılmış require('fs')'i yüklemeden önce çözmeye çalışır (sdk/test/ingress.js ile aynı düzen)
const NODE = typeof Bare === 'undefined' // eslint-disable-line no-undef
const fs = NODE ? require('f' + 's') : null
const path = NODE ? require('pa' + 'th') : null

test('index.d.ts olay adları çalışan kodda yayılıyor', { skip: !NODE }, (t) => {
  const KOK = path.join(__dirname, '..', '..')
  const DTS = fs.readFileSync(path.join(__dirname, '..', 'index.d.ts'), 'utf8')
  const yayilan = new Set()
  for (const dir of ['sdk', 'worklet', 'core/transport']) {
    for (const f of fs.readdirSync(path.join(KOK, dir)).filter((x) => x.endsWith('.js'))) {
      for (const m of fs.readFileSync(path.join(KOK, dir, f), 'utf8').matchAll(/\.emit\(\s*'([^']+)'/g)) yayilan.add(m[1])
    }
  }
  const adlar = new Set()
  for (const m of DTS.matchAll(/\b(?:on|once|off) \(ad: ((?:'[^']+'(?: \| )?)+), fn:/g)) {
    for (const q of m[1].matchAll(/'([^']+)'/g)) adlar.add(q[1])
  }
  t.ok(adlar.size >= 20, 'tiplerde ' + adlar.size + ' olay adı')
  for (const ad of adlar) t.ok(yayilan.has(ad), ad)
})

// d.ts'te "Hata …" ya da "neden: …" ile anılan her kod çalışan kodda dizgi olarak geçer (Codex 12. tur: ad değişikliğinden
// sonra YETKISIZ, BEKLEMEDE, SILINDI gibi eski kodlar kalmış, tel kodu DESTEK_YOK ise NOT_SUPPORTED diye çevrilmişti; d.ts'e
// güvenip e.message === 'YETKISIZ' yazan ürün kodu hiç eşleşmez). Sonu * olan ad bir önek ailesidir (INVALID_DISASTER_*)
test('index.d.ts hata kodları çalışan kodda', { skip: !NODE }, (t) => {
  const KOK = path.join(__dirname, '..', '..')
  const DTS = fs.readFileSync(path.join(__dirname, '..', 'index.d.ts'), 'utf8')
  const metin = []
  const gez = (d) => {
    for (const x of fs.readdirSync(path.join(KOK, d), { withFileTypes: true })) {
      if (['node_modules', 'test', '.gecici'].includes(x.name)) continue
      const g = path.join(d, x.name)
      if (x.isDirectory()) gez(g)
      else if (g.endsWith('.js')) metin.push(fs.readFileSync(path.join(KOK, g), 'utf8'))
    }
  }
  for (const d of ['core', 'sdk', 'worklet']) gez(d)
  const kod = metin.join('\n')
  let n = 0
  for (const m of DTS.matchAll(/\b(?:Hata|hata|neden:)\s+((?:[A-Z][A-Z0-9_]+\*?(?: \([^)]*\))?(?:, | ya da | veya )?)+)/g)) {
    for (const k of m[1].matchAll(/\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+|[A-Z]{4,})\b(?!\*)/g)) {
      n++
      if (!new RegExp('[\'"`]' + k[1] + '[\'"`:]').test(kod)) t.fail('d.ts hata kodu kodda yok: ' + k[1])
    }
  }
  t.ok(n >= 100, n + ' hata kodu denetlendi')
})
