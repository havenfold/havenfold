// SPDX-License-Identifier: Apache-2.0
// D79: RFC-0030 §8.1 kanal komutları 410–413 (CHANNEL_COMMAND ve channel-v4.json); 414–419 ayrılmış. Beklenenler elle.
const test = require('brittle')
const S = require('..')
const V4 = require('../../protocol/vectors/channel-v4.json')

const BEKLENEN = [
  [410, 'CAREGIVER_WRITE_GRANT', 'LedgerApi.grantCaregiverWrite'],
  [411, 'GUEST_PERMISSIONS', 'GuestWriteApi.permissions'],
  [412, 'GUEST_DROP', 'GuestWriteApi.drop'],
  [413, 'GUEST_MY_WRITES', 'GuestWriteApi.myWrites']
]

test('D79: 410–413 CHANNEL_COMMAND\'ta ve channel-v4.json\'da, SDK yöntemlerine bağlı; 414–419 boş', (t) => {
  for (const [no, ad, sdk] of BEKLENEN) {
    t.is(S.CHANNEL_COMMAND[ad], no, ad)
    t.alike(V4.komutlar.find((k) => k.no === no), { no, ad, sdk })
  }
  const kullanilan = new Set(Object.values(S.CHANNEL_COMMAND))
  for (let n = 414; n <= 419; n++) t.absent(kullanilan.has(n), n + ' ayrılmış')
})
