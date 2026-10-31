// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// ipc/types.js — düğüm içi yerel IPC mesaj türleri ve gövdeleri (RFC-0007 §6.3)
//
// Zarf türü değildir, ağa çıkmaz; ayrı ad alanıdır. 1–39 RFC-0007'nindir, 40–49 RFC-0008'e ayrılmıştır (40–43 uç
// akışı, §11.5; 44–49 boş). 1–23 RFC'deki
// tablodur. 24–30 bu uygulamanın önerisidir (havenfold komutu ↔ çekirdek ve yetki yardımcısı; kollar/D-durum.md
// İstek 106): RFC'ye girene kadar yalnız aynı paket sürümünün parçaları arasında kullanılır.
const c = require('compact-encoding')
const b4a = require('b4a')
const { kodlama: { limits, optional } } = require('@havenfold/tasks')

function struct (fields) {
  return {
    preencode (state, m) { for (const [k, enc] of fields) enc.preencode(state, m[k]) },
    encode (state, m) { for (const [k, enc] of fields) enc.encode(state, m[k]) },
    decode (state) { const m = {}; for (const [k, enc] of fields) m[k] = enc.decode(state); return m }
  }
}

const IPC = {
  MERHABA: 1,
  SAGLIK_ANLIK: 2,
  GOREV_HAZIRLA: 3,
  GOREV_HAZIR: 4,
  GOREV_BASLAT: 5,
  GOREV_ILERLEME: 6,
  GOREV_BITTI: 7,
  TASK_CANCEL: 8,
  GOREV_TEMIZLE: 9,
  YEDEK_YAZ: 10,
  YEDEK_OKU: 11,
  YEDEK_SIL: 12,
  YEDEK_CEVAP: 13,
  GUNCELLEME_BILDIRIMI: 14,
  GUNCELLEME_ONAYI: 15,
  GUNCELLEME_DURUM: 16,
  PAKET_ISTE: 17,
  PAKET_PARCA: 18,
  RETIRE_STATUS: 19,
  KAYNAK_AG: 20,
  DURDUR: 21,
  RECOVERY_KEY: 22,
  HATA: 23,
  // Öneri (İstek 106)
  DURUM_ISTE: 24,
  DURUM_CEVAP: 25,
  KATIL_BASLAT: 26,
  KATIL_QR: 27,
  KATIL_SONUC: 28,
  YETKI_ISTEK: 29,
  YETKI_CEVAP: 30,
  // RFC-0008 §11.5: işçi çekirdeği uçtan aldığı kareleri denetçiye verir
  AKIS_AC: 40,
  AKIS_KARE: 41,
  AKIS_KAPAT: 42,
  ANAHTAR_KARE_ISTE: 43
}
const AKIS_KODEKLER = ['h264']

const KOK_ROLLER = ['kutu', 'isci']
const DURDUR_NEDEN = ['guncelleme', 'yeniden-baslatma', 'emeklilik']

// Sağlık ölçümleri (imzasız; çekirdek NODE_HEALTH ve NODE_CAPS'e çevirip imzalar). Biçim health.js'tedir.
const saglikOlcum = { preencode (s, m) { require('../health').olcumEnc.preencode(s, m) }, encode (s, m) { require('../health').olcumEnc.encode(s, m) }, decode (s) { return require('../health').olcumEnc.decode(s) } }

// Tür → { istek, cevap } gövde kodlayıcıları. Aynı türün iki yönü ayrı gövde taşıyabilir (MERHABA).
const GOVDE = {
  [IPC.MERHABA]: { istek: struct([['rol', c.string], ['surum', c.string]]), cevap: struct([['hostId', c.fixed16], ['denetciSurum', c.string]]) },
  [IPC.SAGLIK_ANLIK]: { istek: struct([['olcum', saglikOlcum], ['caps', c.buffer]]) },
  [IPC.GOREV_HAZIRLA]: { istek: struct([['taskId', c.fixed16], ['type', c.string], ['version', c.string], ['limits', limits], ['standing', c.bool], ['sourceId', optional(c.fixed16)]]) },
  [IPC.GOREV_HAZIR]: { istek: struct([['taskId', c.fixed16], ['dir', c.string], ['ok', c.bool], ['code', c.string]]) },
  [IPC.GOREV_BASLAT]: { istek: struct([['taskId', c.fixed16]]) },
  [IPC.GOREV_ILERLEME]: { istek: struct([['taskId', c.fixed16], ['pct', c.uint], ['note', c.string]]) },
  [IPC.GOREV_BITTI]: { istek: struct([['taskId', c.fixed16], ['status', c.string], ['exitCode', c.int], ['log', c.string]]) },
  [IPC.TASK_CANCEL]: { istek: struct([['taskId', c.fixed16]]) },
  [IPC.GOREV_TEMIZLE]: { istek: struct([['taskId', c.fixed16]]) },
  [IPC.YEDEK_YAZ]: { istek: struct([['blobId', c.fixed32], ['path', c.string], ['size', c.uint]]) },
  [IPC.YEDEK_OKU]: { istek: struct([['blobId', c.fixed32]]) },
  [IPC.YEDEK_SIL]: { istek: struct([['blobId', c.fixed32]]) },
  [IPC.YEDEK_CEVAP]: { istek: struct([['blobId', c.fixed32], ['ok', c.bool], ['path', c.string]]) },
  [IPC.GUNCELLEME_BILDIRIMI]: { istek: struct([['manifest', c.buffer]]) },
  [IPC.GUNCELLEME_ONAYI]: { istek: struct([['approve', c.buffer], ['signerPub', c.fixed32], ['signerRole', c.string]]) },
  [IPC.GUNCELLEME_DURUM]: { istek: struct([['state', c.string], ['pendingVersion', c.string], ['error', c.string]]) },
  [IPC.PAKET_ISTE]: { istek: struct([['digest', c.fixed32], ['size', c.uint]]) },
  [IPC.PAKET_PARCA]: { istek: struct([['digest', c.fixed32], ['offset', c.uint], ['path', c.string]]) },
  [IPC.RETIRE_STATUS]: { istek: struct([['phase', c.string], ['retireNonce', c.fixed16]]) },
  [IPC.KAYNAK_AG]: { istek: struct([['taskId', c.fixed16], ['addr', c.string], ['port', c.uint]]) },
  [IPC.DURDUR]: { istek: struct([['neden', c.string]]) },
  // Cevap gövdesi RFC'de yazılı değil (§6.3 tablosunda yalnız istek): MERHABA gibi aynı türün cevap yönü. var: oku'da
  // dosya var mı, sil'de silindi mi; anahtar: oku'da 32 bayt, değilse boş
  [IPC.RECOVERY_KEY]: { istek: struct([['istek', c.string]]), cevap: struct([['var', c.bool], ['anahtar', c.buffer]]) },
  [IPC.HATA]: { istek: struct([['reqId', c.uint], ['code', c.string], ['detail', c.string]]) },
  [IPC.DURUM_ISTE]: { istek: struct([]) },
  [IPC.DURUM_CEVAP]: { istek: struct([['json', c.string]]) },
  [IPC.KATIL_BASLAT]: { istek: struct([['rol', c.string]]) },
  [IPC.KATIL_QR]: { istek: struct([['qr', c.string], ['resimler', c.array(c.string)], ['kalanSn', c.uint]]) },
  [IPC.KATIL_SONUC]: { istek: struct([['ok', c.bool], ['code', c.string]]) },
  [IPC.YETKI_ISTEK]: { istek: struct([['islem', c.string], ['girdi', c.string]]) }, // girdi: JSON
  [IPC.YETKI_CEVAP]: { istek: struct([['ok', c.bool], ['code', c.string], ['cikti', c.string]]) },
  // Cevap yönü RFC'de yok (RECOVERY_KEY gibi): denetçi ad alanını ve akış sunucusunu kurunca akışın kimliğini döner
  [IPC.AKIS_AC]: { istek: struct([['taskId', c.fixed16], ['sourceId', c.fixed16], ['streamId', c.fixed16], ['codec', c.string], ['width', c.uint], ['height', c.uint], ['fps', c.uint]]), cevap: struct([['streamId', c.fixed16]]) },
  [IPC.AKIS_KARE]: { istek: struct([['streamId', c.fixed16], ['ts', c.uint], ['key', c.bool], ['data', c.buffer]]) },
  [IPC.AKIS_KAPAT]: { istek: struct([['streamId', c.fixed16], ['code', c.string]]) },
  [IPC.ANAHTAR_KARE_ISTE]: { istek: struct([['streamId', c.fixed16]]) }
}

// Gövde değer denetimleri (kanonik çözmeden sonra)
const DENETIM = {
  [IPC.MERHABA]: (m, yon) => yon === 'cevap' || KOK_ROLLER.includes(m.rol),
  [IPC.DURDUR]: (m) => DURDUR_NEDEN.includes(m.neden),
  [IPC.RECOVERY_KEY]: (m, yon) => (yon === 'cevap' ? [0, 32].includes(m.anahtar ? m.anahtar.byteLength : 0) : ['oku', 'sil'].includes(m.istek)),
  [IPC.GOREV_ILERLEME]: (m) => m.pct <= 100,
  [IPC.GOREV_BITTI]: (m) => b4a.byteLength(m.log) <= 4096,
  [IPC.AKIS_AC]: (m, yon) => yon === 'cevap' || AKIS_KODEKLER.includes(m.codec) && m.width >= 1 && m.width <= 4096 && m.height >= 1 && m.height <= 4096 && m.fps >= 1 && m.fps <= 60,
  [IPC.AKIS_KARE]: (m) => m.data.byteLength >= 1,
  [IPC.AKIS_KAPAT]: (m) => /^[A-Z][A-Z0-9_]{1,31}$/.test(m.code)
}

module.exports = { IPC, GOVDE, DENETIM, KOK_ROLLER, DURDUR_NEDEN, struct }
