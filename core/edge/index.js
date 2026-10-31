// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// @havenfold/edge — uç cihaz çekirdeği (RFC-0008 §17 adım 1–3, 8, 9): çalışma profili NODE_PROFILE, yerleştirmede özellik
// denetimi ve kasa payı adaylığı; uç yapılandırması UC_CONFIG ve görünür izleme UC_STATUS; kamera akışı UC_STREAM_* ve çerçeve
// şifrelemesi; ucun kalıcı durumu ve görünür izleme kapısı (edge.js, açıklama 1); `uygulama-verisi-silindi` raporu APP_WIPE_REPORT
// (erasure.js); ekran modu UC_SCREEN_PUSH (screen.js) ve sensör modu (sensor.js). Android'in kamerası, sensör okuması, ön plan
// hizmeti ve açılış davranışı bu pakette değildir; uç modunu kullanan ürünün yerli modülündedir (RFC-0029 §3). Tepsi
// uygulaması (adım 5–8) ve iOS ekran uygulaması sonraki adımlardır.
module.exports = {
  kodlama: require('./encoding'),
  profil: require('./profile'),
  yapilandirma: require('./config'),
  durum: require('./status'),
  akis: require('./stream'),
  cerceve: require('./frame'),
  uc: require('./edge'),
  silme: require('./erasure'),
  ekran: require('./screen'),
  sensor: require('./sensor')
}
