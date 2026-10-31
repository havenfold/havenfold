// SPDX-License-Identifier: Apache-2.0
// D69 (RFC-0027 §8; İstek 145 c): onay özeti yalnız tanımlı sınıflarla (kasa, aile, genel) kurulur; başka sınıf
// INVALID_CLASS (sınıf metni özette uzunluk öneksiz birleşir, tanımsız değer başka bir girdiyle karışabilirdi).
'use strict'
const test = require('brittle')
const { approvalSummary } = require('../ai')

const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }

test('approvalSummary: sınıf SINIFLAR\'da değilse INVALID_CLASS', (t) => {
  const kayit = { type: 'hf.not', recordId: null, fields: { baslik: 'x' } }
  for (const s of ['kasa', 'aile', 'genel']) t.is(approvalSummary('ab'.repeat(16), kayit, s).byteLength, 32, s)
  for (const s of ['', 'ile', 'Aile', 'genel ', null, undefined, 5]) t.is(hataOf(() => approvalSummary('ab'.repeat(16), kayit, s)), 'INVALID_CLASS', String(s))
})
