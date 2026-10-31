// SPDX-License-Identifier: Apache-2.0
// D77 (RFC-0029 §6): `yuva.bakim` ad alanı Yuva Bakım uygulamasınındır; Yuva Defteri'nin Bakım Masası kendi ad alanını
// kullanır. Doz olayı `yuva.defter.doz-kacirildi`, kural kaynağı `yuva.defter`; sınıf CareDeskApi (BakimApi bir sürüm
// takma ad). Kanal numaraları 355–357 değişmez. Yazılmış veri yok, geçiş gerekmez.
'use strict'
const test = require('brittle')
const S = require('..')
const V4 = require('../../protocol/vectors/channel-v4.json')

test('Bakım Masası adları Yuva Defteri ad alanında; BakimApi takma ad; kanal 355–357 aynı', (t) => {
  t.is(S.DOSE_TYPE, 'yuva.defter.doz-kacirildi')
  t.is(S.RULE_SOURCE, 'yuva.defter')
  t.is(typeof S.CareDeskApi, 'function')
  t.is(S.BakimApi, S.CareDeskApi, 'eski ad bir sürüm takma ad')
  t.ok(S.CARE_TYPES.some((x) => x.tur === 'yuva.defter.doz-kacirildi'))
  t.absent(S.CARE_TYPES.some((x) => x.tur.startsWith('yuva.bakim')), 'yuva.bakim ad alanı kullanılmaz')
  t.alike([S.CHANNEL_COMMAND.CARE_PROCESS, S.CHANNEL_COMMAND.CARE_MISSED, S.CHANNEL_COMMAND.CARE_CLAIM], [355, 356, 357])
  const bakim = V4.komutlar.filter((k) => k.sdk.startsWith('CareDesk'))
  t.ok(bakim.length >= 7)
  t.ok(bakim.every((k) => k.sdk.startsWith('CareDeskApi.')), 'geçerli kanal tablosu yeni sınıf adıyla')
})
