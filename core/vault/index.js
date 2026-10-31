// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// @havenfold/vault — kasa: Shamir payları, eşik, yedek dizini, kasa zarfı, pay isteme ve döndürme (RFC-0004).
// Bağımsız güvenlik denetiminden önce yayına girmez (kurucu §13.3).
// Pay teslimi zarflarının kanonik çözücüleri (tek giriş noktası, RFC-0027 §1b)
const { giris } = require('@havenfold/core')
const T = require('./delivery')
const I = require('./request')
giris.kaydet(T.Z.KASA_SHARE_PUT, T.payTeslimiCoz)
giris.kaydet(T.Z.KASA_SHARE_ACK, T.alindiCoz)
// Pay isteme ve sürüm sorma (RFC-0004 §5.1; D67)
giris.kaydet(I.Z.KASA_SHARE_REQ, (b) => I.payIstegiCoz(b).m)
giris.kaydet(I.Z.KASA_SHARE_RES, I.payCevabiCoz)
giris.kaydet(I.Z.KASA_VERSION_REQ, I.surumIstegiCoz)
giris.kaydet(I.Z.KASA_VERSION_RES, I.surumCevabiCoz)
// Zarfın kutudaki opak kopyası (RFC-0027 §9 g)
const KZ = require('./box-envelope')
giris.kaydet(KZ.Z.KASA_ENV_PUT, KZ.putCoz)
giris.kaydet(KZ.Z.KASA_ENV_ACK, KZ.ackCoz)
giris.kaydet(KZ.Z.KASA_ENV_REQ, KZ.reqCoz)
giris.kaydet(KZ.Z.KASA_ENV_RES, KZ.resCoz)

module.exports = {
  // Rastgelelik kaynağının iç durumu dışa verilmez (inceleme 5 S6)
  rastgele: (({ sodiumKaynak, ozDenetim }) => ({ sodiumKaynak, ozDenetim }))(require('./random')),
  esik: require('./threshold'),
  pay: require('./share'),
  yedek: require('./backup'),
  zarf: require('./envelope'),
  istek: I,
  dondurme: require('./rotation'),
  teslim: T,
  kutuZarf: KZ
}
