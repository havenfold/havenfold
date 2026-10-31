// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// protocol/envelope.js — çekirdeğin zarf türleri (RFC-0003 §10) ve oturum izinleri (RFC-0003 §6.1)
//
// 0x00–0x7F Yuva Hat'ın türleridir (packages/protocol/zarf-turleri.js); burada yalnız çekirdeğin kullandıkları var.
// Sonraki RFC'lerin aralıkları RFC-0003 §10'dadır; her RFC kendi türünü ve hangi oturumda geçerli olduğunu yazar.

const Z = {
  // Yuva Hat (packages/protocol/zarf-turleri.js)
  HELLO: 0x01,
  HELLO_OK: 0x02,
  JOIN_HELLO: 0x08,
  JOIN_LEDGER: 0x09,
  JOIN_DRAFT: 0x0a,
  JOIN_SIG: 0x0b,
  LEDGER_REQ: 0x10,
  LEDGER_EVENTS: 0x11,
  LEDGER_PROPOSE: 0x12,
  ACK: 0x21,
  READ: 0x22,
  HOLD: 0x23,
  CONV_CTRL: 0x24,
  HOLD_DROP: 0x25,
  PING: 0x7e,
  PONG: 0x7f,

  // Kayıt katmanı (RFC-0001)
  REC_VV: 0x80,
  REC_OPS: 0x81,
  REC_KEY: 0x82,
  REC_KEY_REQ: 0x83,
  BLOB_REQ: 0x84,
  BLOB_DATA: 0x85,
  BLOB_DEL: 0x86,
  REC_IDS: 0x87,
  REC_CUTOFF: 0x88,
  REC_PRUNE: 0x89,
  REC_BUCKETS: 0x8a,
  REC_BUCKET_IDS: 0x8b,

  // Görev katmanı (RFC-0002)
  TASK: 0x90,
  TASK_ACCEPT: 0x91,
  TASK_REJECT: 0x92,
  TASK_PROGRESS: 0x93,
  TASK_RESULT: 0x94,
  TASK_CANCEL: 0x95,
  NODE_CAPS: 0x96,
  TASK_DELEGATION: 0x97,

  // Diğer (RFC-0003 §10)
  RETIRE_BEGIN: 0x98,
  RETIRE_LIST: 0x99,
  GUEST_VIEW: 0x9a,
  KASA_SHARE_REQ: 0x9b,
  KASA_SHARE_RES: 0x9c,
  GUEST_REVOKED: 0x9d,
  KASA_VERSION_REQ: 0x9e,
  KASA_VERSION_RES: 0x9f,

  // RFC-0012 §13 (afet modu): 0xB6–0xB7 ayrılmış. Olağan oturumda ve emanette yalnız AFET_MSG geçer (§8.4);
  // 0xB1–0xB5 yalnız afet bağlarında (core/disaster/local.js).
  AFET_MSG: 0xb0,
  AFET_HAVE: 0xb1,
  AFET_WANT: 0xb2,
  AFET_DONE: 0xb3,
  AFET_TAGS: 0xb4,
  AFET_LINK_UP: 0xb5,

  // RFC-0006 §11.5
  VAKA_UYANDIR: 0xc0,
  VAKA_DUR: 0xc1,

  // RFC-0005 §10.4 (ekip)
  EKIP_CIKIS: 0xc8,
  EKIP_CIKIS_OK: 0xc9,

  // RFC-0010 §16 (hizmet paylaşımı): 0xD3–0xD7 ayrılmış
  SHARE_PREVIEW: 0xd0,
  SHARE_RULE: 0xd1,
  SHARE_RULE_ACK: 0xd2,

  // RFC-0007 §14 (düğüm): 0xDF ayrılmış
  NODE_HEALTH: 0xd8,
  UPDATE_HAVE: 0xd9,
  UPDATE_REQ: 0xda,
  UPDATE_DATA: 0xdb,
  UPDATE_APPROVE: 0xdc,
  RETIRE_STATE: 0xdd,
  NODE_RECOVERY: 0xde,

  // RFC-0008 §12 (uç cihaz ve tepsi): emanetten yalnız UC_CONFIG, UC_SCREEN_PUSH, UC_STATUS, APP_WIPE_REPORT geçer
  NODE_PROFILE: 0xe0,
  UC_CONFIG: 0xe1,
  UC_STREAM_OPEN: 0xe2,
  UC_STREAM_ACCEPT: 0xe3,
  UC_STREAM_CLOSE: 0xe4,
  UC_SCREEN_PUSH: 0xe5,
  UC_STATUS: 0xe6,
  APP_WIPE_REPORT: 0xe7,

  // RFC-0017 §6.2 (yalnız yerel kanal: 0xE8, 0xE9)
  APP_PAIR_REQ: 0xe8,
  APP_PAIR_OK: 0xe9,
  APP_LOCAL_SYNC: 0xea,
  // RFC-0034 §4.6: aile seçen eşleşme isteği (yalnız yerel kanal); 0xEC–0xEF ayrılmış
  APP_PAIR_REQ2: 0xeb,

  // RFC-0019 §9
  BLOB_HAVE: 0xf0,

  // RFC-0027 §1b (dell İstek 121, D31): kurulumda payın sahibine teslimi ve alındısı
  KASA_SHARE_PUT: 0xf1,
  KASA_SHARE_ACK: 0xf2,
  // RFC-0027 §9 g: kasa zarfının kutudaki opak kopyası (gönderme, alındı, etiketle isteme, cevap)
  KASA_ENV_PUT: 0xf3,
  KASA_ENV_ACK: 0xf4,
  KASA_ENV_REQ: 0xf5,
  KASA_ENV_RES: 0xf6
}

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i)
const KAYIT = range(0x80, 0x8b)
const DOSYA = [Z.BLOB_REQ, Z.BLOB_DATA, Z.BLOB_DEL]
const GOREV = range(0x90, 0x97)
const DEFTER = [Z.LEDGER_REQ, Z.LEDGER_EVENTS, Z.LEDGER_PROPOSE]
const TEMEL = [Z.HELLO, Z.HELLO_OK, Z.PING, Z.PONG]
const EMANET = [Z.HOLD, Z.HOLD_DROP] // §6.3: HOLD cihaz ve misafir kimliklerini de kabul eder
const KASA = [Z.KASA_SHARE_REQ, Z.KASA_SHARE_RES, Z.KASA_VERSION_REQ, Z.KASA_VERSION_RES, Z.KASA_SHARE_PUT, Z.KASA_SHARE_ACK] // TPM'li işçi pay tutar (RFC-0004); zarf kopyası (0xF3–0xF6) yalnız kutu, kutu üyedir
const VAKA = [Z.VAKA_UYANDIR, Z.VAKA_DUR]
const GUNCELLEME = [Z.UPDATE_HAVE, Z.UPDATE_REQ, Z.UPDATE_DATA] // RFC-0007 §12.5: cihaz ↔ cihaz, kutu ↔ cihaz
// RFC-0008 §16 (RFC-0003 §6.1 tablosu): üye ↔ cihaz bütün uç ve tepsi türleri; cihaz ↔ cihaz profil (koordinatöre) ve
// uç ile UC_CONFIG hedefi işçi arasındaki akış
const UC = [Z.NODE_PROFILE, Z.UC_CONFIG, Z.UC_STREAM_OPEN, Z.UC_STREAM_ACCEPT, Z.UC_STREAM_CLOSE, Z.UC_SCREEN_PUSH, Z.UC_STATUS, Z.APP_WIPE_REPORT]
const UC_AKIS = [Z.UC_STREAM_OPEN, Z.UC_STREAM_ACCEPT, Z.UC_STREAM_CLOSE]
// Yalnız yerel kanalda geçerli; hiçbir ağ oturumunda (üye ↔ üye dahil) kabul edilmez (inceleme RFC-0017 bulgu 8)
const YEREL = new Set([Z.APP_PAIR_REQ, Z.APP_PAIR_OK, Z.APP_PAIR_REQ2])
// RFC-0012 §8.4, §13: afet bağ zarfları hiçbir olağan oturumda kabul edilmez (yalnız AFET_MSG normal yoldan geçer)
const AFET_BAGI = new Set([Z.AFET_HAVE, Z.AFET_WANT, Z.AFET_DONE, Z.AFET_TAGS, Z.AFET_LINK_UP])

// §6.1 oturum tablosu. Anahtar: iki rolün sözlük sırasıyla birleşimi. Üye ↔ üye bugünkü gibi (sınırsız).
// Misafir ↔ cihaz ve misafir ↔ misafir oturumu kurulmaz.
const SESSION = {
  'cihaz|uye': new Set([...TEMEL, ...EMANET, ...DEFTER, ...KAYIT, ...GOREV, ...KASA, ...VAKA, Z.RETIRE_BEGIN, Z.RETIRE_LIST, Z.BLOB_HAVE,
    Z.NODE_HEALTH, ...GUNCELLEME, Z.UPDATE_APPROVE, Z.NODE_RECOVERY, Z.AFET_MSG, ...UC]), // AFET_MSG: işçinin UYARI'sı normal yoldan (RFC-0012 §8.4); NODE_RECOVERY: düğüm → töreni yapan ebeveyn, alındı geri (RFC-0007 §13.6); UC: RFC-0008 §16
  'cihaz|cihaz': new Set([...TEMEL, ...GOREV, ...DOSYA, ...GUNCELLEME, Z.NODE_PROFILE, ...UC_AKIS]),
  // Misafire LEDGER_* gönderilmez ve misafirden gelen cevaplanmaz; kayıt yalnız misafirin koleksiyonları, yalnız okuma
  'misafir|uye': new Set([...TEMEL, ...EMANET, Z.GUEST_VIEW, Z.GUEST_REVOKED, ...KAYIT, Z.AFET_MSG]), // AFET_MSG: RFC-0012 §8.1, §8.4
  // Sınırlı iptal oturumu (D106; Codex 10. tur): bekleyen uzaktan üye (beklerken) ya da iptal edilen davetli ↔ yetkili.
  // Tek iş: yetkili, daveti iptal eden REVOKE'u GUEST_REVOKED zarfında yollar. Aile tarafında davetli oturum rolü
  // taşımadığı için (Ledger.davetliMi) ondan gelen her zarf süzgeçte düşer
  'davetli|uye': new Set([...TEMEL, Z.GUEST_REVOKED])
}

// Yön kısıtları: gönderen rolü → gönderemeyeceği türler. Misafir yazamaz (REC_OPS; tek istisna bıraktığı olaylar,
// RFC-0030 §4, yalnız giris.gelenZarf'ta), kasa ve görev göndermez; cihaz emekliliği başlatmaz (RETIRE_BEGIN üyeden gelir).
const GONDEREMEZ = {
  misafir: new Set([Z.REC_OPS, Z.REC_CUTOFF, Z.REC_PRUNE, Z.BLOB_DEL, Z.GUEST_VIEW, Z.GUEST_REVOKED]),
  cihaz: new Set([Z.RETIRE_BEGIN, Z.GUEST_VIEW, Z.GUEST_REVOKED, Z.UPDATE_APPROVE]), // onayı ebeveyn verir (RFC-0007 §12.4)
  davetli: new Set([Z.GUEST_REVOKED])
}

const pairKey = (a, b) => [a, b].sort().join('|')

// İki rol arasında oturum kurulur mu?
function sessionAllowed (myRole, peerRole) {
  if (!myRole || !peerRole) return false
  if (myRole === 'uye' && peerRole === 'uye') return true
  return pairKey(myRole, peerRole) in SESSION
}

// Bu oturumda bu tür gönderilebilir ya da cevaplanabilir mi? yon: 'gelen' (karşı taraf gönderdi) | 'giden' | null
// (iki yön). Gelen her zarf bu süzgeçten geçer.
function typeAllowed (myRole, peerRole, type, yon = null) {
  if (!sessionAllowed(myRole, peerRole)) return false
  if (YEREL.has(type) || AFET_BAGI.has(type)) return false
  if (yon === 'gelen' && GONDEREMEZ[peerRole]?.has(type)) return false
  if (yon === 'giden' && GONDEREMEZ[myRole]?.has(type)) return false
  if (myRole === 'uye' && peerRole === 'uye') return true
  return SESSION[pairKey(myRole, peerRole)].has(type)
}

// RFC-0007 §14: emanetten gelirse atılan, yalnız doğrudan oturumdaki düğüm türleri; RFC-0008 §12: NODE_PROFILE ve UC_STREAM_*
const YALNIZ_DOGRUDAN_DUGUM = new Set([Z.NODE_HEALTH, Z.UPDATE_HAVE, Z.UPDATE_REQ, Z.UPDATE_DATA, Z.NODE_RECOVERY, Z.NODE_PROFILE, ...UC_AKIS])
// RFC-0027 §1b: yalnız doğrudan oturum ya da emanet; Posta Kutusu'ndan gelirse atılır (pay teslimi). RFC-0010 §16: SHARE_RULE
// gizli anahtar taşır, Posta Kutusu yolu kapalı. RFC-0008 §12: uç ve tepsi türlerinin hiçbiri Posta Kutusu'na gitmez
const POSTASIZ = new Set([Z.KASA_SHARE_PUT, Z.KASA_SHARE_ACK, Z.KASA_ENV_PUT, Z.KASA_ENV_ACK, Z.KASA_ENV_REQ, Z.KASA_ENV_RES,
  Z.SHARE_RULE, ...UC])

module.exports = { Z, KAYIT, GOREV, DOSYA, DEFTER, GUNCELLEME, UC, UC_AKIS, YALNIZ_DOGRUDAN_DUGUM, POSTASIZ, sessionAllowed, typeAllowed }
