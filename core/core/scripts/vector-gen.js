// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// protocol/vectors/ altındaki çekirdek vektörlerini yeniden yazar. Belirlenimcidir; test aynı çıktıyı bekler.
//   node core/core/scripts/vector-gen.js
// Bu betik yalnız geliştirmede çalışır (Node); paketin parçası değildir.
const fs = require('fs')
const path = require('path')
const { vektorler: v21 } = require('../test/helpers/v21-vector')
const { vektorler: kayit } = require('../../records/test/helpers/record-vector')
const { vektorler: coklu } = require('../../records/test/helpers/multi-vector')
const { vektorler: gorev } = require('../../tasks/test/helpers/task-vector')
const { vektorler: olay, jsonla } = require('../../events/test/helpers/event-vector')
const { vektorler: sdk } = require('../../../sdk/test/helpers/sdk-vector')
const { vektorler: kap, vektorlerV2: kapV2 } = require('../../export/test/helpers/export-vector')
const { vektorler: kasa } = require('../../vault/test/helpers/vault-vector')
const { vektorler: ekip, vektorlerV2: ekipV2 } = require('../test/helpers/team-vector')

const out = path.join(__dirname, '../../../protocol/vectors')
process.env.HF_VEKTOR_YAZ = '1'
// D9 (RFC-0019): GRANT grantedBy, kayıt recordId sahipliği ve kasa isteği biçimi değişti; eski dosyalar olduğu gibi
// kalır, yeni durumlar -v2 dosyalarına yazılır. export.json değişmedi.
const v2 = (ad) => (ad === 'export.json' ? ad : ad.replace(/\.json$/, '-v2.json'))
const yaz = (ad0, v) => {
  const ad = v2(ad0)
  fs.writeFileSync(path.join(out, ad), JSON.stringify(v, null, 1) + '\n')
  console.log('protocol/vectors/' + ad + ' yazıldı')
}

yaz('ledger-v21.json', v21())
yaz('record.json', kayit())
yaz('multi-app.json', coklu())
yaz('task.json', gorev())
yaz('event.json', jsonla(olay()))
yaz('sdk.json', sdk())
yaz('export.json', kap())
fs.writeFileSync(path.join(out, 'export-v2.json'), JSON.stringify(kapV2(), null, 1) + '\n') // RFC-0021 e, f; NFC
console.log('protocol/vectors/export-v2.json yazıldı')
kasa().then((v) => yaz('vault.json', v))
// RFC-0005: yeni dosya
fs.writeFileSync(path.join(out, 'team.json'), JSON.stringify(ekip(), null, 1) + '\n')
console.log('protocol/vectors/team.json yazıldı')
// İnceleme 7, RFC-0022: yeni dosya; team.json değişmez
fs.writeFileSync(path.join(out, 'team-v2.json'), JSON.stringify(ekipV2(), null, 1) + '\n')
// RFC-0013: yeni dosya
const { vektorler: yz, vektorlerV2: yzV2 } = require('../../ai/test/helpers/ai-vector')
yz().then((v) => { fs.writeFileSync(path.join(out, 'ai.json'), JSON.stringify(v, null, 1) + '\n'); console.log('protocol/vectors/ai.json yazıldı') })
// RFC-0024 §5 (D16): yeni dosya; ai.json değişmez
yzV2().then((v) => { fs.writeFileSync(path.join(out, 'ai-v2.json'), JSON.stringify(v, null, 1) + '\n'); console.log('protocol/vectors/ai-v2.json yazıldı') })
// RFC-0007: yeni dosya
const { vektorler: dugum } = require('../../../node/test/helpers/node-vector')
fs.writeFileSync(path.join(out, 'node.json'), JSON.stringify(dugum(), null, 1) + '\n')
console.log('protocol/vectors/node.json yazıldı')
// RFC-0030 (D78): yeni dosya
const { vektorler: misafirYazma } = require('../../records/test/helpers/guest-write-vector')
fs.writeFileSync(path.join(out, 'guest-write.json'), JSON.stringify(misafirYazma(), null, 1) + '\n')
console.log('protocol/vectors/guest-write.json yazıldı')
// RFC-0031 (D80): yeni dosya
const { vektorler: sos } = require('../../events/test/helpers/sos-vector')
fs.writeFileSync(path.join(out, 'sos.json'), JSON.stringify(sos(), null, 1) + '\n')
console.log('protocol/vectors/sos.json yazıldı')
// RFC-0032 (D81): yeni dosya; event.json ve event-v2.json değişmez
const { vektorler: olayV3 } = require('../../events/test/helpers/event-v3-vector')
fs.writeFileSync(path.join(out, 'event-v3.json'), JSON.stringify(olayV3(), null, 1) + '\n')
console.log('protocol/vectors/event-v3.json yazıldı')
