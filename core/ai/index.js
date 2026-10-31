// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// @havenfold/ai — yapay zeka katmanının telefon ve işçi tarafındaki ortak kodu (RFC-0013)
//
// Model çağırma platform kodundadır (Apple Foundation Models, Gemini Nano, işçi görev imajları); burada yalnız
// belirlenimci parçalar ve arayüzler vardır.
module.exports = {
  metin: require('./text'),
  cozucu: require('./resolver'),
  engel: require('./block-filter'),
  cikarma: require('./extraction'),
  plan: require('./plan'),
  yetenek: require('./capability'),
  dizin: require('./search-index'),
  asistan: require('./assistant'),
  cocuk: require('./child'),
  krizAnlam: require('./crisis-semantic'),
  gomme: require('./embedding')
}
