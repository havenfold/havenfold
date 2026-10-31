// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// erasure.js — `uygulama-verisi-silindi` raporu APP_WIPE_REPORT (RFC-0008 §9; §17 adım 8, Android uç)
//
// Tepsi uygulamasında ve Android uçta işletim sistemi silinmez; yapılabilen tek şey Havenfold verisinin yok edilmesidir ve
// rapor cihazın kendi beyanıdır (§9.1). Bu yüzden RFC-0003'ün WIPE_REPORT'u değil, ayrı bir zarf ve ayrı bir rapor türü:
//
//   body = APP_WIPE_REPORT'un sig dışındaki alanları
//   sig  = Ed25519(cihazın kimlik anahtarı, hashLP('hf/app-wipe-report/', familyId, body))
//   appWipeReportHash = hashLP('hf/app-wipe-report-id/', body ‖ sig)   (DEVICE_DETACH.wipeReportHash)
//
// `result` gönderenin beyanı değildir: §9.3 tablosuyla items ve keyStore'dan hesaplanır, uyuşmayan rapor geçersizdir; `ok` ve
// `dogrulanamadi` için en az bir başarılı `anahtar-imha` ve bir `dosya-silme` gerekir (inceleme L2 madde 1). Android ve iOS
// raporunda `fabrika-ayari-yapilmadi` kalıntısı zorunludur (§9.4); işletim sistemi ile anahtar deposu uyuşmalıdır. Telefon raporu kaydederken ve gösterirken
// UYARI metnini en üste yazar.
const b4a = require('b4a')
const { kdf: { hashLP } } = require('@havenfold/core')
const K = require('./encoding')

const { hex, fail } = K
const UYARI = 'Bu rapor cihazın kendi beyanıdır. İşletim sistemi silinmedi. Cihazı satacak ya da verecekseniz işletim sistemini de sıfırlayın ya da Kurulum USB\'sinin silme modunu kullanın.'
const KAYIT_TURU = 'hf.wipe.report' // "Ebeveynler" koleksiyonuna yazılan kayıt (§9.2 madde 7), alan kind

/**
 * Cihaz raporu kodlar ve imzalar. m: deviceId ve result dışındaki alanlar; result §9.3 kuralıyla hesaplanır.
 * signer: cihazın kimliği { memberId, signKeyPair }
 */
function silmeRaporuKodla (familyId, m, signer) {
  const g = { ...m, deviceId: signer.memberId, kind: 'uygulama-verisi-silindi', result: K.silmeSonucu(m.keyStore, m.items || []) }
  return K.imzaliKodla(K.silmeGovde, K.silmeDenetle, K.ETIKET.APP_WIPE_REPORT, familyId, g, signer.signKeyPair.secretKey)
}

const silmeRaporuCoz = (buf) => K.imzaliCoz(K.silmeGovde, buf, K.silmeDenetle)

const silmeRaporuOzeti = (bytes) => hashLP(K.ETIKET.APP_WIPE_REPORT_ID, bytes)

/**
 * Telefon raporu doğrular (§9.2 madde 7): imza defterdeki cihaz anahtarıyla (cihaz bu arada aileden çıkarılmış olabilir; anahtarı
 * defterde kalır). from verilirse rapor cihazın kendisinden gelmeli (emanette from null). Dönüş { m, hash }.
 */
function silmeRaporuDenetle (L, bytes, { from = null } = {}) {
  const { m, body, sig } = silmeRaporuCoz(bytes)
  const id = hex(m.deviceId)
  if (from !== null && from !== id) fail('UNAUTHORIZED')
  const d = L.devices.get(id)
  // Adım 8 yalnız Android uç (tepsi ve iOS ekran sonraki adımlarda; inceleme L2 madde 6)
  if (!d || d.class !== 'uc') fail('UNAUTHORIZED')
  if (!K.imzaGecerli(K.ETIKET.APP_WIPE_REPORT, L.familyId, body, sig, d.signPub)) fail('INVALID_SIGNATURE')
  return { m, hash: silmeRaporuOzeti(b4a.concat([body, sig])) }
}

module.exports = { UYARI, KAYIT_TURU, silmeRaporuKodla, silmeRaporuCoz, silmeRaporuOzeti, silmeRaporuDenetle }
