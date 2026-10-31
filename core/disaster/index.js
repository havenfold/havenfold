// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// @havenfold/disaster — afet modu çekirdeği (RFC-0012): türetmeler, afet mesajı ve mühürü, alıcı denetimi, durum makinesi,
// sakla-ilet, yerel ağ keşfi. Bluetooth, Wi-Fi Direct ve Multipeer köprüleri ürünün yerel modülündedir.
module.exports = {
  turetme: require('./derivation'),
  mesaj: require('./message'),
  denetim: require('./audit'),
  durum: require('./status'),
  depo: require('./store'),
  sinir: require('./limit'),
  motor: require('./engine'),
  benzetim: require('./simulation'),
  yerel: require('./local')
}
