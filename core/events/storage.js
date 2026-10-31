// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// storage.js — süreli kayıt ve koleksiyon sınırı (RFC-0006 §14)
//
// Temizliğin kendisi kayıt katmanındadır (@havenfold/records cleanup.js, RFC-0001 §13 eklemesi): eşik M koleksiyondaki
// en büyük geçerli hlc'nin milisaniyesidir; süresi dolan kaydın bütün işlemleri silinir ve recordId mezara girer.
const { temizlik: { effectiveKeep, DAY_MS } } = require('@havenfold/records')

// Etkin süre (gün; Infinity süresiz): k = _keep, her uyan hf.saklama için min(k, gun), _conf < 50 ise min(k, 7)
const etkinSure = (keep, tur, conf, saklama) => effectiveKeep(keep, tur, conf, saklama)

// Süresi doldu mu: _t + k × 86400000 < M
const suresiDoldu = (t, k, M) => k !== Infinity && t + k * DAY_MS < M

module.exports = { etkinSure, suresiDoldu }
