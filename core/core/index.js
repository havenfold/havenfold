// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// @havenfold/core — Havenfold Çekirdeği: kdf, imza, defter, politika, yeter sayı, eşitleme.
// Kaynak dosyalar Yuva Hat'tan kopyalandı; bkz. KAYNAK.md.
module.exports = {
  kdf: require('./crypto/kdf'),
  pair: require('./crypto/pair'),
  deviceCert: require('./crypto/device-cert'),
  encoding: require('./ledger/encoding'),
  ledger: require('./ledger/ledger'),
  policy: require('./ledger/policy'),
  proposals: require('./ledger/proposals'),
  quorum: require('./ledger/quorum'),
  sync: require('./ledger/sync'),
  messages: require('./protocol/messages'),
  hello: require('./protocol/hello'),
  identity: require('./core/identity'),
  pairs: require('./core/pairs'),
  seal: require('./messaging/seal'),
  // Defter v2.1 (RFC-0003)
  v21: require('./ledger/v21'),
  zarf: require('./protocol/envelope'),
  giris: require('./protocol/ingress'),
  caps: require('./protocol/caps'),
  joinHello: require('./protocol/join-hello'),
  guestView: require('./protocol/guest-view'),
  emeklilik: require('./protocol/retirement'),
  kurtarma: require('./protocol/recovery'),
  // Defter v2.2 (RFC-0017)
  v22: require('./ledger/v22'),
  // Defter v2.3 (RFC-0030)
  v23: require('./ledger/v23'),
  // Ekip (RFC-0005)
  ekip: require('./ledger/team'),
  ekipCikis: require('./protocol/team-exit'),
  yerelKanal: require('./protocol/local-channel'),
  // Kişisel köprü (RFC-0005 §15)
  kopru: require('./protocol/bridge')
}
