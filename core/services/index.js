// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// @havenfold/services — hizmet paylaşımı çekirdeği (RFC-0010 §20 adım 1–5): hizmet kartı, hizmet dizini ve QR kartı;
// paket gövdesi, paketin hizmete şifrelenmesi, takma ad ve payloadHash; SHARE_CONSENT yorumu ve iptal; cevap ve alıcı
// başlıkları; SHARE_PREVIEW. Geçitle konuşma (HTTPS) platformun, alıcının kendisi services/receiver'nin işidir.
const { giris } = require('@havenfold/core')
const Oz = require('./preview')
// SHARE_PREVIEW'in kanonik çözücüsü (tek giriş noktası, RFC-0027 §1b); anlam denetimi onizlemeCoz'da
giris.kaydet(Oz.Z_SHARE_PREVIEW, Oz.onizlemeBicim)

module.exports = {
  kodlama: require('./encoding'),
  kart: require('./card'),
  paket: require('./package'),
  onay: require('./approval'),
  cevap: require('./reply'),
  onizleme: Oz
}
